// Le calque de la table : les images collées et les traits dessinés par les joueurs et le MJ,
// au-dessus de la carte et du brouillard. Rangé à part de l'état de la scène, pour ne jamais
// entrer dans l'annulation du MJ. Chacun ne déplace et n'efface que ce qu'il a posé.
import crypto from 'node:crypto';
import { SceneError } from '../../shared/map/scene.js';

const MAX_PER_SCENE = 400;
const MAX_POINTS = 2000;
export const STROKE_COLORS = ['#e40712', '#ffd24a', '#5aa9ff', '#7ee787', '#c58bff', '#ff9f43', '#ffffff', '#000000'];
export const STROKE_WIDTHS = [0.06, 0.12, 0.25];

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const r2 = v => Math.round(Number(v) * 100) / 100;
const r3 = v => Math.round(Number(v) * 1000) / 1000;
const clean = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 60);

function fail(msg) { throw new SceneError(msg); }

// Ce qu'on peut changer sur une image posée : sa place et sa taille. Les champs absents restent.
export function cleanImagePatch(p = {}) {
  const out = {};
  if ('x' in p) { if (!isNum(p.x)) fail('Position invalide'); out.x = r3(p.x); }
  if ('y' in p) { if (!isNum(p.y)) fail('Position invalide'); out.y = r3(p.y); }
  if ('size' in p) { if (!isNum(p.size)) fail('Taille invalide'); out.size = Math.max(0.3, Math.min(60, r3(p.size))); }
  return out;
}

// Un trait : une suite de points en cases, sans doublons voisins.
function cleanPoints(raw) {
  if (!Array.isArray(raw)) fail('Trait invalide');
  const out = [];
  for (const p of raw.slice(0, MAX_POINTS)) {
    if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) fail('Trait invalide');
    const q = [r2(p[0]), r2(p[1])];
    const last = out[out.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  if (!out.length) fail('Trait invalide');
  // Un simple clic laisse un point : il devient un trait minuscule, visible.
  if (out.length === 1) out.push([r2(out[0][0] + 0.01), out[0][1]]);
  return out;
}

export function createOverlayStore(raw) {
  const q = {
    list: raw.prepare('SELECT data FROM map_overlay WHERE campaign_id = ? AND scene = ? ORDER BY created_at, id'),
    get: raw.prepare('SELECT data FROM map_overlay WHERE campaign_id = ? AND scene = ? AND id = ?'),
    count: raw.prepare('SELECT COUNT(*) n FROM map_overlay WHERE campaign_id = ? AND scene = ?'),
    put: raw.prepare(`INSERT INTO map_overlay (campaign_id, scene, id, data, account, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(campaign_id, scene, id) DO UPDATE SET data = excluded.data`),
    del: raw.prepare('DELETE FROM map_overlay WHERE campaign_id = ? AND scene = ? AND id = ?'),
    clearScene: raw.prepare('DELETE FROM map_overlay WHERE campaign_id = ? AND scene = ?'),
    mine: raw.prepare('SELECT id FROM map_overlay WHERE campaign_id = ? AND scene = ? AND account = ?'),
    ofAccount: raw.prepare('SELECT scene, id FROM map_overlay WHERE campaign_id = ? AND account = ?'),
  };
  const parse = r => JSON.parse(r.data);

  return {
    list(cid, scene) { return q.list.all(cid, scene).map(parse); },
    get(cid, scene, id) { const r = q.get.get(cid, scene, id); return r ? parse(r) : null; },

    // Une image (déjà vérifiée par l'appelant) ou un trait.
    add(cid, scene, raw, { by, byName }) {
      if (q.count.get(cid, scene).n >= MAX_PER_SCENE) fail('Cette carte est pleine : effacez quelques images ou traits');
      const now = Date.now();
      const base = { id: `o${crypto.randomBytes(5).toString('hex')}`, by, byName: clean(byName), at: now };
      let item;
      if (raw.kind === 'stroke') {
        const points = cleanPoints(raw.points);
        item = {
          ...base, kind: 'stroke', points, x: points[0][0], y: points[0][1],
          color: STROKE_COLORS.includes(raw.color) ? raw.color : STROKE_COLORS[0],
          width: STROKE_WIDTHS.includes(Number(raw.width)) ? Number(raw.width) : STROKE_WIDTHS[1],
        };
      } else {
        if (!raw.image) fail('Image manquante');
        const p = cleanImagePatch({ size: 4, ...raw });
        if (!('x' in p) || !('y' in p)) fail('Position invalide');
        item = { ...base, kind: 'image', image: String(raw.image), x: p.x, y: p.y, size: p.size };
      }
      q.put.run(cid, scene, item.id, JSON.stringify(item), by, now);
      return item;
    },

    // Seule une image se déplace ou change de taille ; un trait s'efface et se redessine.
    update(cid, scene, id, patch) {
      const it = this.get(cid, scene, id);
      if (!it) fail('Cet élément n\'existe plus');
      if (it.kind !== 'image') fail('Un trait ne se déplace pas : efface-le et redessine-le');
      const next = { ...it, ...cleanImagePatch(patch) };
      q.put.run(cid, scene, id, JSON.stringify(next), it.by, it.at);
      return next;
    },

    remove(cid, scene, id) { q.del.run(cid, scene, id); },
    // Tout ce qu'un compte a posé sur une carte : ses ids, effacés.
    removeMine(cid, scene, accountId) {
      const ids = q.mine.all(cid, scene, accountId).map(r => r.id);
      for (const id of ids) q.del.run(cid, scene, id);
      return ids;
    },
    clearScene(cid, scene) { q.clearScene.run(cid, scene); },
    // Tout ce qu'un compte a posé dans la campagne : { scène: [ids] }.
    ofAccount(cid, accountId) {
      const out = {};
      for (const r of q.ofAccount.all(cid, accountId)) (out[r.scene] || (out[r.scene] = [])).push(r.id);
      return out;
    },
  };
}
