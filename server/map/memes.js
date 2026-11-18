// Memes posés sur la carte : un calque au-dessus de la scène, rangé à part de son état pour ne
// jamais entrer dans l'annulation du MJ. Chaque meme posé passe aussi dans la mèmothèque de la
// campagne, où la table retrouve ses blagues.
import crypto from 'node:crypto';
import { SceneError } from '../../shared/map/scene.js';

export const MEME_TTL = [10, 60]; // Durées possibles, en secondes ; sinon le meme reste.
const MAX_PER_SCENE = 150;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const r3 = v => Math.round(Number(v) * 1000) / 1000;
const text = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max);

function fail(msg) { throw new SceneError(msg); }

// Ce qu'un client peut changer sur un meme. Les champs absents restent tels quels.
export function cleanMemePatch(p = {}) {
  const out = {};
  if ('x' in p) { if (!isNum(p.x)) fail('Position du meme invalide'); out.x = r3(p.x); }
  if ('y' in p) { if (!isNum(p.y)) fail('Position du meme invalide'); out.y = r3(p.y); }
  if ('size' in p) { if (!isNum(p.size)) fail('Taille du meme invalide'); out.size = Math.max(0.3, Math.min(60, r3(p.size))); }
  if ('rot' in p) out.rot = isNum(p.rot) ? Math.round((((p.rot % 360) + 360) % 360) * 10) / 10 : 0;
  if ('top' in p) out.top = text(p.top, 120);
  if ('bottom' in p) out.bottom = text(p.bottom, 120);
  if ('text' in p) out.text = text(p.text, 200);
  if ('attach' in p) out.attach = p.attach ? text(p.attach, 60) : null;
  return out;
}

export function memeKey(m) {
  return crypto.createHash('sha1').update([m.kind, m.image || '', m.top || '', m.bottom || '', m.text || ''].join('\u0001')).digest('hex').slice(0, 16);
}

export function createMemeStore(raw) {
  const q = {
    list: raw.prepare('SELECT data FROM map_memes WHERE campaign_id = ? AND scene = ? ORDER BY created_at'),
    get: raw.prepare('SELECT data FROM map_memes WHERE campaign_id = ? AND scene = ? AND id = ?'),
    count: raw.prepare('SELECT COUNT(*) n FROM map_memes WHERE campaign_id = ? AND scene = ?'),
    put: raw.prepare(`INSERT INTO map_memes (campaign_id, scene, id, data, account, expires, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(campaign_id, scene, id) DO UPDATE SET data = excluded.data, expires = excluded.expires`),
    del: raw.prepare('DELETE FROM map_memes WHERE campaign_id = ? AND scene = ? AND id = ?'),
    clearScene: raw.prepare('DELETE FROM map_memes WHERE campaign_id = ? AND scene = ?'),
    ofAccount: raw.prepare('SELECT scene, id FROM map_memes WHERE campaign_id = ? AND account = ?'),
    expired: raw.prepare('SELECT scene, id FROM map_memes WHERE campaign_id = ? AND expires IS NOT NULL AND expires <= ?'),
    allExpiring: raw.prepare('SELECT campaign_id, scene, id, expires FROM map_memes WHERE expires IS NOT NULL'),
    shelfPut: raw.prepare(`INSERT INTO meme_shelf (campaign_id, key, data, uses, last_used) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(campaign_id, key) DO UPDATE SET uses = uses + 1, last_used = excluded.last_used`),
    shelfList: raw.prepare('SELECT key, data, uses, last_used FROM meme_shelf WHERE campaign_id = ? ORDER BY uses DESC, last_used DESC LIMIT 400'),
    shelfDel: raw.prepare('DELETE FROM meme_shelf WHERE campaign_id = ? AND key = ?'),
  };
  const parse = r => JSON.parse(r.data);

  return {
    list(cid, scene) {
      const now = Date.now();
      return q.list.all(cid, scene).map(parse).filter(m => !m.expires || m.expires > now);
    },
    get(cid, scene, id) {
      const r = q.get.get(cid, scene, id);
      return r ? parse(r) : null;
    },

    // Un meme neuf. `meme` a déjà été vérifié par l'appelant pour l'image ; ici la forme.
    add(cid, scene, raw, { by, byName }) {
      if (q.count.get(cid, scene).n >= MAX_PER_SCENE) fail('Trop de memes sur cette carte : le MJ doit faire un peu de ménage');
      const kind = raw.kind === 'text' ? 'text' : 'image';
      const base = cleanMemePatch({ top: '', bottom: '', text: '', rot: 0, attach: null, size: kind === 'text' ? 1 : 4, ...raw });
      if (!('x' in base) || !('y' in base)) fail('Position du meme invalide');
      if (kind === 'text' && !base.text.trim()) fail('Texte vide');
      if (kind === 'image' && !raw.image) fail('Image manquante');
      const ttl = MEME_TTL.includes(Number(raw.ttl)) ? Number(raw.ttl) : null;
      const now = Date.now();
      const meme = {
        id: `m${crypto.randomBytes(5).toString('hex')}`, kind, image: kind === 'image' ? String(raw.image) : '',
        ...base, by, byName: text(byName, 60), at: now, expires: ttl ? now + ttl * 1000 : null,
      };
      if (kind === 'text') { meme.top = ''; meme.bottom = ''; } else meme.text = '';
      q.put.run(cid, scene, meme.id, JSON.stringify(meme), by, meme.expires, now);
      const shelf = { kind, image: meme.image, top: meme.top, bottom: meme.bottom, text: meme.text, size: meme.size, name: text(raw.name, 120) };
      q.shelfPut.run(cid, memeKey(shelf), JSON.stringify(shelf), now);
      return meme;
    },

    update(cid, scene, id, patch) {
      const m = this.get(cid, scene, id);
      if (!m) fail('Ce meme n\'existe plus');
      const next = { ...m, ...cleanMemePatch(patch) };
      if (next.kind === 'text' && !next.text.trim()) fail('Texte vide');
      if (next.kind === 'text') { next.top = ''; next.bottom = ''; } else next.text = '';
      q.put.run(cid, scene, id, JSON.stringify(next), m.by, next.expires, m.at);
      return next;
    },

    remove(cid, scene, id) { q.del.run(cid, scene, id); },
    clearScene(cid, scene) { q.clearScene.run(cid, scene); },
    // Tous les memes d'un compte dans la campagne : { scene: [ids] }.
    ofAccount(cid, accountId) {
      const out = {};
      for (const r of q.ofAccount.all(cid, accountId)) (out[r.scene] || (out[r.scene] = [])).push(r.id);
      return out;
    },
    expired(cid, now = Date.now()) { return q.expired.all(cid, now); },
    expiring() { return q.allExpiring.all().map(r => ({ campaign: r.campaign_id, scene: r.scene, id: r.id, expires: r.expires })); },

    shelf(cid, search = '') {
      const s = String(search || '').trim().toLowerCase();
      return q.shelfList.all(cid).map(r => ({ key: r.key, ...JSON.parse(r.data), uses: r.uses, lastUsed: r.last_used }))
        .filter(m => !s || [m.top, m.bottom, m.text, m.name].some(v => String(v || '').toLowerCase().includes(s)))
        .slice(0, 120);
    },
    shelfRemove(cid, key) { q.shelfDel.run(cid, String(key)); },
  };
}
