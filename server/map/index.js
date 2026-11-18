// Carte de table d'une campagne : routes HTTP et canal temps réel. Le MJ et les co-MJ y ont
// tous les droits ; la TV est une fenêtre du même compte. Un joueur s'y connecte depuis son
// onglet « Carte » : il voit ce que voit la TV, déplace ses tokens et pose des memes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { SceneError } from '../../shared/map/scene.js';
import { opLabel } from '../../shared/map/ops.js';
import { forPlayer, forTv, indexFor } from '../../shared/map/view.js';
import { lineOfSight } from '../../shared/map/vision.js';
import { sceneBounds } from '../../shared/map/scene.js';
import { isDmRole } from '../campaigns.js';
import { canMeme, patchTable, rateLimiter, tableOf } from './table.js';
import { createMemeStore } from './memes.js';
import { fetchImage } from './fetchimg.js';
import { SceneStore } from './store.js';
import { TokenCatalog, assetItems } from './tokens.js';
import { createDamageLog, hpSnapshot, logsHp } from './damage.js';
import { HttpError } from '../http.js';
import { APP_DIR } from '../config.js';

export function createMapServer({ db, engine, campaigns, assets, library, cfg, audit = null, authToken, router, guard }) {
  const tokens = new TokenCatalog(library.dir);
  const stores = new Map();
  const clients = new Set();
  const damage = createDamageLog(db.db);
  const memes = createMemeStore(db.db);
  const memeLimit = rateLimiter(10, 60_000);
  const reactLimit = rateLimiter(40, 60_000);
  const fetchLimit = rateLimiter(10, 60_000);

  function storeOf(cid) {
    let s = stores.get(cid);
    if (!s) {
      s = new SceneStore(db, cid, { onListChange: () => broadcastAll(cid, listMessage(cid)) });
      stores.set(cid, s);
    }
    return s;
  }

  const listMessage = cid => ({ t: 'scenes', scenes: storeOf(cid).list(), tvScene: campaigns.settings(cid).tvScene || null });

  function logOp(c, cid, sceneId, op) {
    if (!audit || !op?.type || op.type === 'token.move') return;
    const scene = storeOf(cid).list().find(s => s.id === sceneId);
    audit.log({ kind: 'map', campaign: cid, action: opLabel(op.type), account: c.accountName, seat: 'MJ', detail: scene?.name || sceneId, mergeKey: `${sceneId}|${op.type}` });
  }

  // Une image de carte ou de token doit venir de la campagne ou de la bibliothèque globale.
  function checkImageRef(cid, ref) {
    const r = String(ref || '');
    if (!r) return '';
    if (r.startsWith('asset:')) {
      const a = db.getAsset(r.slice(6));
      if (a && (a.campaign === cid || a.campaign === null)) return r;
    } else if (r.startsWith('lib:') && library.resolve(r.slice(4))) return r;
    throw new HttpError(400, 'Image introuvable');
  }

  function sceneMessage(cid, id) {
    const doc = storeOf(cid).open(id);
    return {
      t: 'scene', scene: id, doc: doc.doc, rev: doc.rev,
      canUndo: doc.undoStack.length > 0, canRedo: doc.redoStack.length > 0,
      undoLabel: doc.undoStack.at(-1)?.label || null, redoLabel: doc.redoStack.at(-1)?.label || null,
    };
  }

  function publish(cid, id, update) {
    storeOf(cid).markDirty(id, update.roots);
    broadcast(cid, id, { t: 'update', scene: id, ...update });
    if (update.roots.some(r => ['name', 'folder', 'fog', 'image'].includes(r))) broadcastAll(cid, listMessage(cid));
  }

  // ------------------------------------------------------------ Auto-murs

  // Le traceur Python lit l'image et propose des murs ; le MJ les accepte ou les corrige.
  function autoWalls(cid, sceneId, { tiles = null, floor = null, stone = null, threshold = null } = {}) {
    const doc = storeOf(cid).open(sceneId).doc;
    const ref = String(doc.image || '');
    let file = null;
    if (ref.startsWith('asset:')) { const a = db.getAsset(ref.slice(6)); if (a) file = assets.fileOf(a); }
    else if (ref.startsWith('lib:')) file = library.resolve(ref.slice(4));
    if (!file) throw new HttpError(400, 'Cette carte n\'a pas d\'image lisible');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'murs-'));
    const out = path.join(tmp, 'scene.json');
    const args = [path.join(APP_DIR, 'tools', 'map_walls.py'), 'trace', file, '--cols', String(doc.grid.cols), '--rows', String(doc.grid.rows), '--image-ref', ref, '--name', doc.name, '--out', out];
    if (tiles && /^\d{1,3}(x\d{1,3})?$/.test(String(tiles))) args.push('--tiles', String(tiles));
    if (threshold && Number(threshold) > 0) args.push('--threshold', String(Math.round(Number(threshold))));
    if (floor && /^[\d,\- ]+$/.test(String(floor))) args.push('--floor', String(floor));
    if (stone && /^[\d.,]+$/.test(String(stone))) args.push('--stone', String(stone));
    return new Promise((resolve, reject) => {
      execFile(cfg.python || 'python3', args, { timeout: 120_000, maxBuffer: 4_000_000 }, (err, stdout, stderr) => {
        try {
          if (err) return reject(new HttpError(500, 'Traceur de murs indisponible : {detail}', { detail: String(stderr || err.message).trim().split('\n').pop().slice(0, 200) }));
          const scene = JSON.parse(fs.readFileSync(out, 'utf8'));
          return resolve({ walls: scene.walls || [], log: String(stdout).trim().split('\n').slice(-3).join(' ') });
        } catch (e) { return reject(new HttpError(500, 'Résultat du traceur illisible : {detail}', { detail: e.message })); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
      });
    });
  }

  // ------------------------------------------------------------ HTTP (MJ de la campagne)

  const dm = guard.dm;
  router.get('/api/c/:cid/map/scenes', ctx => { dm(ctx); return storeOf(ctx.params.cid).list(); });
  router.post('/api/c/:cid/map/scenes', async ctx => {
    const a = dm(ctx);
    const cid = ctx.params.cid;
    const b = await ctx.body();
    if (!String(b.name || '').trim()) throw new HttpError(400, 'Nom obligatoire');
    const image = checkImageRef(cid, b.image);
    const id = storeOf(cid).create({
      name: String(b.name).trim().slice(0, 80), folder: b.folder ? String(b.folder).trim().slice(0, 60) : undefined, fog: b.fog !== false,
      image, imageSize: b.imageSize, cols: Number(b.cols), rows: Number(b.rows), feetPerCell: Number(b.feetPerCell) || 5,
      offset: Array.isArray(b.offset) ? b.offset.map(Number) : undefined, walls: Array.isArray(b.walls) ? b.walls : [],
    });
    audit?.log({ kind: 'map', campaign: cid, action: 'Carte créée', account: a.name, seat: 'MJ', detail: String(b.name) });
    return { id };
  });
  router.post('/api/c/:cid/map/scenes/import', async ctx => {
    const a = dm(ctx);
    const cid = ctx.params.cid;
    const b = await ctx.body(20_000_000);
    const list = Array.isArray(b.scenes) ? b.scenes : [b];
    const ids = [];
    for (const item of list.slice(0, 50)) {
      const scene = item.scene || item;
      if (scene.image) scene.image = checkImageRef(cid, scene.image);
      ids.push(storeOf(cid).importScene(String(item.id || ''), scene, item.state || null));
    }
    audit?.log({ kind: 'map', campaign: cid, action: 'Cartes importées', account: a.name, seat: 'MJ', detail: String(ids.length) });
    return { ids };
  });
  router.get('/api/c/:cid/map/scenes/:id', ctx => {
    dm(ctx);
    const doc = storeOf(ctx.params.cid).open(ctx.params.id);
    return { id: ctx.params.id, scene: doc.sceneData(), state: doc.stateData() };
  });
  // Remplacer la scène (murs, grille, image) sans toucher aux tokens : pour l'API et Claude.
  router.put('/api/c/:cid/map/scenes/:id', async ctx => {
    const a = dm(ctx);
    const cid = ctx.params.cid;
    const b = await ctx.body(10_000_000);
    const raw = b.scene || b;
    if (raw.image) raw.image = checkImageRef(cid, raw.image);
    const update = storeOf(cid).replaceScene(ctx.params.id, raw);
    publish(cid, ctx.params.id, update);
    for (const c of clients) if (c.campaign === cid && c.scene === ctx.params.id) send(c, sceneMessage(cid, ctx.params.id));
    audit?.log({ kind: 'map', campaign: cid, action: 'Scène remplacée', account: a.name, seat: 'MJ', detail: ctx.params.id });
    return { ok: true };
  });
  router.delete('/api/c/:cid/map/scenes/:id', ctx => {
    const a = dm(ctx);
    const cid = ctx.params.cid;
    storeOf(cid).remove(ctx.params.id);
    memes.clearScene(cid, ctx.params.id);
    if (campaigns.settings(cid).tvScene === ctx.params.id) campaigns.setInternal(cid, 'tvScene', null);
    audit?.log({ kind: 'map', campaign: cid, action: 'Carte supprimée', account: a.name, seat: 'MJ', detail: ctx.params.id });
    return { ok: true };
  });
  router.post('/api/c/:cid/map/scenes/:id/autowalls', async ctx => {
    dm(ctx);
    const b = await ctx.body();
    return autoWalls(ctx.params.cid, ctx.params.id, b);
  });

  // Les joueurs de la campagne et leurs fiches : pour donner un token à un joueur, ou lui couper les memes.
  router.get('/api/c/:cid/map/players', ctx => {
    dm(ctx);
    const cid = ctx.params.cid;
    const chars = engine.charsIn(cid);
    return campaigns.members(cid).filter(m => m.role === 'player').map(m => ({
      id: m.accountId, name: m.name, chars: chars.filter(c => c.owner === m.accountId).map(c => ({ id: c.id, name: c.data.name || 'Sans nom' })),
    }));
  });

  // La mèmothèque : chaque meme déjà posé dans la campagne, les plus utilisés d'abord.
  router.get('/api/c/:cid/map/memes/shelf', ctx => {
    guard.member(ctx);
    return memes.shelf(ctx.params.cid, ctx.query('q'));
  });
  router.delete('/api/c/:cid/map/memes/shelf/:key', ctx => {
    dm(ctx);
    memes.shelfRemove(ctx.params.cid, ctx.params.key);
    return { ok: true };
  });
  // Une image collée par son adresse : le serveur va la chercher et la range avec les memes.
  router.post('/api/c/:cid/map/memes/fetch', async ctx => {
    const m = guard.member(ctx);
    const cid = ctx.params.cid;
    if (!canMeme(tableOf(campaigns, cid), m.id, m.role)) throw new HttpError(403, 'Le MJ a coupé tes memes');
    if (!fetchLimit(m.id || 'api')) throw new HttpError(429, 'Doucement : 10 memes par minute au plus');
    const b = await ctx.body();
    const buffer = await fetchImage(b.url);
    let name = 'meme';
    try { name = decodeURIComponent(new URL(String(b.url)).pathname.split('/').pop() || 'meme'); } catch { /* nom par défaut */ }
    const a = assets.save({ campaign: cid, kind: 'meme', name, buffer, by: m.id, folder: 'Memes' });
    return { ref: `asset:${a.id}`, name: a.name, width: a.width, height: a.height };
  });

  // Journal des PV de la campagne : chaque coup, pour les statistiques. Lecture seule.
  router.get('/api/c/:cid/map/damage-log', ctx => { dm(ctx); return damage.list(ctx.params.cid); });

  router.get('/api/c/:cid/map/images', ctx => {
    dm(ctx);
    return db.assetsOf(ctx.params.cid, 'map').map(x => ({ id: x.id, path: `asset:${x.id}`, name: x.name, folder: x.folder || '', bytes: x.size, width: x.width, height: x.height, mtime: x.createdAt }));
  });
  router.get('/api/c/:cid/map/tokens', ctx => {
    dm(ctx);
    const extra = assetItems(db.assetsOf(ctx.params.cid, 'token'));
    return tokens.search(ctx.query('q'), Number(ctx.query('limit')) || 60, extra);
  });
  router.get('/api/c/:cid/map/tokens/suggest', ctx => {
    dm(ctx);
    const extra = assetItems(db.assetsOf(ctx.params.cid, 'token'));
    return tokens.suggest(ctx.query('name'), 24, extra);
  });
  router.get('/api/c/:cid/map/library', ctx => { dm(ctx); return campaigns.settings(ctx.params.cid).library; });
  router.post('/api/c/:cid/map/library', async ctx => {
    dm(ctx);
    const cid = ctx.params.cid;
    const b = await ctx.body();
    const group = b.group === 'characters' ? 'characters' : 'monsters';
    const lib = campaigns.settings(cid).library;
    lib[group] = { ...(lib[group] || {}) };
    if (b.value) lib[group][String(b.key).slice(0, 120)] = b.value;
    else delete lib[group][String(b.key)];
    campaigns.setInternal(cid, 'library', lib);
    return { ok: true };
  });
  // Les personnages de cette campagne : leurs noms, rien d'autre de leurs fiches.
  router.get('/api/c/:cid/map/party', ctx => {
    dm(ctx);
    return engine.charsIn(ctx.params.cid).map(c => ({ id: c.id, name: c.data.name || 'Sans nom' }));
  });

  // ------------------------------------------------------------ WebSocket

  const wss = new WebSocketServer({ noServer: true, maxPayload: 5_000_000 });

  // ------------------------------------------------------------ Joueurs

  const norm = v => String(v || '').trim().toLowerCase();
  // Les comptes qui déplacent ce token : le joueur de la fiche liée, ceux que le MJ a ajoutés.
  // Un PJ sans fiche liée se rattache à la fiche de même nom, ou dont c'est le premier mot.
  function controllers(cid, t) {
    const ids = new Set(Array.isArray(t.control) ? t.control : []);
    if (t.ref?.t === 'char') {
      const ch = engine.charsIn(cid).find(x => x.id === t.ref.id);
      if (ch?.owner) ids.add(ch.owner);
    } else if (t.kind === 'pc' && !t.ref && norm(t.name)) {
      const n = norm(t.name);
      const chars = engine.charsIn(cid);
      const ch = chars.find(x => norm(x.data?.name) === n) || chars.find(x => norm(x.data?.name).split(/\s+/)[0] === n);
      if (ch?.owner) ids.add(ch.owner);
    }
    return ids;
  }
  const mineFor = c => t => c.isDm || controllers(c.campaign, t).has(c.accountId);

  // La TV ne reçoit ni tokens cachés, ni PV exacts, ni notes ; un joueur non plus, ni la liste
  // des cartes, ni l'initiative. Tout message passe par ici.
  function shape(c, msg) {
    if (c.role === 'tv') return forTv(msg);
    if (c.role !== 'player') return msg;
    if (msg.t === 'scenes' || msg.t === 'welcome') return { ...msg, scenes: [] };
    return forPlayer(msg, mineFor(c));
  }
  function send(c, msg) {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(shape(c, msg)));
  }
  function broadcast(cid, sceneId, msg, except = null) {
    for (const c of clients) if (c !== except && c.authed && c.campaign === cid && c.scene === sceneId) send(c, msg);
  }
  function broadcastAll(cid, msg, except = null) {
    for (const c of clients) if (c !== except && c.authed && c.campaign === cid) send(c, msg);
  }

  function openFor(c, id) {
    const msg = sceneMessage(c.campaign, id);
    c.scene = id;
    send(c, msg);
    sendMemes(c);
  }

  // La TV et les onglets des joueurs suivent la carte envoyée sur la TV.
  function setTvScene(cid, id) {
    campaigns.setInternal(cid, 'tvScene', id);
    broadcastAll(cid, listMessage(cid));
    for (const c of clients) if (c.authed && c.campaign === cid && (c.role === 'tv' || c.role === 'player')) openFor(c, id);
  }

  // ------------------------------------------------------------ Réglages de la table

  function tableMessage(c) {
    const table = tableOf(campaigns, c.campaign);
    const { muted, ...pub } = table;
    return { t: 'table', table: c.role === 'dm' ? table : pub, canMeme: canMeme(table, c.accountId, c.accountRole) };
  }
  function broadcastTable(cid) {
    for (const c of clients) if (c.authed && c.campaign === cid) { send(c, tableMessage(c)); sendMemes(c); }
  }

  // Un déplacement demandé par un joueur : ses tokens seulement, visibles, dans la carte, sans
  // traverser un mur ni une porte fermée, et pas quand le MJ a gelé la carte ou bloqué les tokens.
  function playerMove(c, msg) {
    const cid = c.campaign;
    if (!c.scene || msg.scene !== c.scene) throw new SceneError('Cette carte n\'est plus sur la TV');
    if (msg.op?.type !== 'token.move') throw new SceneError('Réservé au MJ de la campagne');
    const doc = storeOf(cid).open(c.scene);
    const d = doc.doc;
    if (d.frozen) throw new SceneError('La carte est gelée : attends le MJ');
    if (!c.isDm && tableOf(campaigns, cid).blockTokens) throw new SceneError('Le MJ a bloqué les tokens');
    const moves = Array.isArray(msg.op.moves) ? msg.op.moves.slice(0, 12) : [];
    if (!moves.length) throw new SceneError('Aucun déplacement');
    const b = sceneBounds(d);
    const ix = indexFor(d);
    const mine = mineFor(c);
    for (const m of moves) {
      const t = d.tokens.find(x => x.id === m?.id);
      if (!t || t.hidden) throw new SceneError('Token introuvable');
      if (!mine(t)) throw new SceneError('Ce token n\'est pas à toi');
      if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) throw new SceneError('Position du token invalide');
      if (m.x < b.minX || m.x > b.maxX || m.y < b.minY || m.y > b.maxY) throw new SceneError('Hors de la carte');
      if (!lineOfSight(ix, t.x, t.y, m.x, m.y)) throw new SceneError('Un mur bloque le passage');
    }
    publish(cid, c.scene, doc.apply({ type: 'token.move', moves: moves.map(m => ({ id: m.id, x: m.x, y: m.y })) }));
  }

  // ------------------------------------------------------------ Memes

  // Le MJ les reçoit toujours (son écran les cache en mode sérieux) ; la TV, si le MJ l'a permis.
  function seesMemes(c, table = tableOf(campaigns, c.campaign)) {
    if (c.role === 'dm') return true;
    if (table.serious) return false;
    return c.role === 'tv' ? table.memesOnTv : true;
  }
  function sendMemes(c) {
    if (!c.scene) return;
    send(c, { t: 'memes', scene: c.scene, memes: seesMemes(c) ? memes.list(c.campaign, c.scene) : [] });
  }
  function memeEvent(cid, scene, msg) {
    const table = tableOf(campaigns, cid);
    for (const c of clients) if (c.authed && c.campaign === cid && c.scene === scene && seesMemes(c, table)) send(c, msg);
  }
  function memeGone(cid, scene, ids) {
    if (ids.length) memeEvent(cid, scene, { t: 'memeGone', scene, ids });
  }

  const expiryTimers = new Map();
  function scheduleExpiry(cid, scene, id, expires) {
    const key = `${cid}|${scene}|${id}`;
    clearTimeout(expiryTimers.get(key));
    const timer = setTimeout(() => {
      expiryTimers.delete(key);
      if (!memes.get(cid, scene, id)) return;
      memes.remove(cid, scene, id);
      memeGone(cid, scene, [id]);
    }, Math.max(0, expires - Date.now()));
    timer.unref?.();
    expiryTimers.set(key, timer);
  }
  for (const m of memes.expiring()) scheduleExpiry(m.campaign, m.scene, m.id, m.expires);

  function memeImage(cid, ref) {
    try { return checkImageRef(cid, ref); } catch { throw new SceneError('Image introuvable'); }
  }
  function memeTarget(doc, id) {
    if (!id) return null;
    const t = doc.tokens.find(x => x.id === id);
    if (!t || t.hidden) throw new SceneError('Token introuvable');
    return t.id;
  }

  function memeAction(c, msg) {
    const cid = c.campaign;
    const scene = c.scene;
    if (!scene) throw new SceneError('Aucune carte ouverte');
    const table = tableOf(campaigns, cid);
    const allowed = canMeme(table, c.accountId, c.accountRole);
    const dm = c.isDm && c.role !== 'tv';
    const doc = () => storeOf(cid).open(scene).doc;
    const mustOwn = m => {
      if (!m) throw new SceneError('Ce meme n\'existe plus');
      if (dm) return;
      if (!allowed) throw new SceneError('Le MJ a coupé tes memes');
      if (m.by !== c.accountId) throw new SceneError('Ce meme n\'est pas à toi');
    };
    switch (msg.action) {
      case 'add': {
        if (!allowed) throw new SceneError('Le MJ a coupé tes memes');
        if (!dm && !memeLimit(c.accountId)) throw new SceneError('Doucement : 10 memes par minute au plus');
        const raw = { ...(msg.meme || {}) };
        if (raw.kind !== 'text') raw.image = memeImage(cid, raw.image);
        raw.attach = memeTarget(doc(), raw.attach);
        const meme = memes.add(cid, scene, raw, { by: c.accountId, byName: c.accountName });
        if (meme.expires) scheduleExpiry(cid, scene, meme.id, meme.expires);
        memeEvent(cid, scene, { t: 'memeSet', scene, meme });
        audit?.log({ kind: 'map', campaign: cid, action: 'Meme posé', account: c.accountName, seat: dm ? 'MJ' : 'Joueur', detail: meme.text || [meme.top, meme.bottom].filter(Boolean).join(' / ') || raw.name || '', mergeKey: 'meme' });
        return { memeId: meme.id };
      }
      case 'update': {
        mustOwn(memes.get(cid, scene, String(msg.memeId || '')));
        const patch = { ...(msg.patch || {}) };
        if ('attach' in patch) patch.attach = memeTarget(doc(), patch.attach);
        const meme = memes.update(cid, scene, String(msg.memeId), patch);
        memeEvent(cid, scene, { t: 'memeSet', scene, meme });
        return {};
      }
      case 'remove': {
        const ids = (Array.isArray(msg.ids) ? msg.ids : [msg.memeId]).map(String).slice(0, 200);
        for (const id of ids) mustOwn(memes.get(cid, scene, id));
        for (const id of ids) memes.remove(cid, scene, id);
        memeGone(cid, scene, ids);
        return {};
      }
      case 'clear': {
        if (!dm) throw new SceneError('Réservé au MJ de la campagne');
        memes.clearScene(cid, scene);
        for (const x of clients) if (x.authed && x.campaign === cid && x.scene === scene) sendMemes(x);
        return {};
      }
      // Tous les memes d'un joueur, sur toutes les cartes de la campagne.
      case 'wipe': {
        if (!dm) throw new SceneError('Réservé au MJ de la campagne');
        for (const [sid, ids] of Object.entries(memes.ofAccount(cid, String(msg.account || '')))) {
          for (const id of ids) memes.remove(cid, sid, id);
          memeGone(cid, sid, ids);
        }
        return {};
      }
      default: throw new SceneError('Message inconnu');
    }
  }

  // Réactions : un emoji ou un repère qui s'envole et disparaît, jamais gardé.
  const REACTIONS = new Set(['💀', '😂', '🔥', '❗', '👀', '🎲', '❤️', '😱', '👏', '🤡', 'ping']);
  function react(c, msg) {
    const cid = c.campaign;
    if (!c.scene) throw new SceneError('Aucune carte ouverte');
    const dm = c.isDm && c.role !== 'tv';
    if (!canMeme(tableOf(campaigns, cid), c.accountId, c.accountRole)) throw new SceneError('Le MJ a coupé tes memes');
    if (!dm && !reactLimit(c.accountId)) throw new SceneError('Doucement avec les réactions');
    if (!REACTIONS.has(msg.emoji)) throw new SceneError('Réaction inconnue');
    if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) throw new SceneError('Position invalide');
    const token = msg.token ? memeTarget(storeOf(cid).open(c.scene).doc, String(msg.token)) : null;
    memeEvent(cid, c.scene, { t: 'react', scene: c.scene, r: { id: `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, emoji: msg.emoji, x: msg.x, y: msg.y, token, by: c.accountName } });
  }

  wss.on('connection', ws => {
    const c = { ws, authed: false, role: null, scene: null, campaign: null, alive: true };
    clients.add(c);
    ws.on('pong', () => { c.alive = true; });
    ws.on('close', () => clients.delete(c));
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const reply = (ok, extra = {}) => { if (msg.id != null) send(c, { t: 'ack', id: msg.id, ok, ...extra }); };
      try {
        if (msg.t === 'hello') {
          const who = authToken(msg.token);
          const cid = String(msg.campaign || '');
          const role = who ? campaigns.role(who.id, cid) : null;
          const wants = msg.role === 'tv' ? 'tv' : msg.role === 'player' ? 'player' : 'dm';
          if (wants === 'player' && !role) return send(c, { t: 'denied', reason: 'Tu ne fais pas partie de cette campagne' });
          if (wants !== 'player' && !isDmRole(role)) return send(c, { t: 'denied', reason: 'Réservé au MJ de la campagne' });
          // Vue joueur : le MJ regarde l'onglet d'un de ses joueurs, sans rien pouvoir y faire.
          let seen = who;
          let preview = null;
          if (wants === 'player' && msg.as) {
            const target = campaigns.previewTarget(who.id, cid, msg.as);
            if (!target) return send(c, { t: 'denied', reason: 'Vue joueur impossible : ce compte ne joue pas dans cette campagne' });
            seen = target;
            preview = { by: who.name, name: target.name };
          }
          const accountRole = preview ? 'player' : role;
          Object.assign(c, { authed: true, accountId: seen.id, accountName: seen.name, realAccountId: who.id, accountRole, isDm: isDmRole(accountRole), preview, campaign: cid, role: wants, token: msg.token });
          send(c, { ...listMessage(cid), t: 'welcome', role: c.role, campaign: campaigns.publicInfo(cid), me: { id: seen.id, name: seen.name, dm: c.isDm, preview } });
          send(c, tableMessage(c));
          const tv = campaigns.settings(cid).tvScene;
          if (c.role !== 'dm' && tv && storeOf(cid).has(tv)) openFor(c, tv);
          return undefined;
        }
        if (!c.authed) return reply(false, { error: 'Non connecté' });
        const cid = c.campaign;
        // Un joueur ne fait que trois choses : déplacer ses tokens, poser des memes, réagir.
        if (c.role === 'player') {
          if (c.preview && ['op', 'meme', 'react'].includes(msg.t)) return reply(false, { error: 'Vue joueur : lecture seule' });
          if (msg.t === 'op') { playerMove(c, msg); return reply(true); }
          if (msg.t === 'meme') return reply(true, memeAction(c, msg));
          if (msg.t === 'react') { react(c, msg); return reply(true); }
          return reply(false, { error: 'Réservé au MJ de la campagne' });
        }
        switch (msg.t) {
          case 'open': openFor(c, msg.scene); return reply(true);
          case 'meme': return reply(true, memeAction(c, msg));
          case 'react': react(c, msg); return reply(true);
          case 'table': {
            if (c.role !== 'dm') return reply(false, { error: 'Réservé au MJ de la campagne' });
            patchTable(campaigns, cid, msg.patch || {});
            broadcastTable(cid);
            return reply(true);
          }
          // Ramène une fois la vue de chaque joueur sur le cadrage de la TV, sans la verrouiller.
          case 'summon': {
            if (c.role !== 'dm') return reply(false, { error: 'Réservé au MJ de la campagne' });
            for (const x of clients) if (x.authed && x.campaign === cid && x.role === 'player') send(x, { t: 'summon' });
            return reply(true);
          }
          case 'op': {
            const doc = storeOf(cid).open(msg.scene);
            const before = logsHp(msg.op?.type) ? hpSnapshot(doc.doc) : null;
            publish(cid, msg.scene, doc.apply(msg.op));
            logOp(c, cid, msg.scene, msg.op);
            if (before) {
              const sceneName = storeOf(cid).list().find(s => s.id === msg.scene)?.name;
              damage.record({ campaign: cid, scene: msg.scene, sceneName, account: c.accountName, doc: doc.doc, before, op: msg.op });
            }
            return reply(true);
          }
          case 'undo':
          case 'redo': {
            const doc = storeOf(cid).open(msg.scene);
            const before = hpSnapshot(doc.doc);
            const update = msg.t === 'undo' ? doc.undo() : doc.redo();
            if (update) publish(cid, msg.scene, update);
            if (update) damage.undo({ campaign: cid, scene: msg.scene, doc: doc.doc, before, redo: msg.t === 'redo' });
            return reply(true);
          }
          case 'tvScene': storeOf(cid).open(msg.scene); setTvScene(cid, msg.scene); return reply(true);
          case 'live': broadcast(cid, c.scene, { t: 'live', scene: c.scene, live: msg.live }, c); return undefined;
          case 'tvSize': broadcastAll(cid, { t: 'tvSize', w: msg.w, h: msg.h }, c); return undefined;
          default: return reply(false, { error: 'Message inconnu' });
        }
      } catch (e) {
        const known = e instanceof SceneError || e instanceof HttpError;
        if (!known) console.error(e);
        return reply(false, { error: known ? e.message : 'Erreur serveur' });
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) { c.ws.terminate(); clients.delete(c); continue; }
      c.alive = false;
      try { c.ws.ping(); } catch { /* socket déjà fermé */ }
    }
  }, 20_000);
  heartbeat.unref?.();

  return {
    upgrade: (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req)),
    // Compte supprimé, secret changé, rôle retiré : sa carte et sa TV se ferment aussi.
    kick: (predicate, reason) => {
      for (const c of clients) {
        if (!c.authed) continue;
        const ids = [...new Set([c.realAccountId, c.accountId])];
        if (!ids.some(accountId => predicate({ accountId, campaign: c.campaign, token: c.token }))) continue;
        send(c, { t: 'denied', reason });
        c.ws.close();
      }
    },
    storeOf,
    dropCampaign(cid) {
      const s = stores.get(cid);
      if (s) s.close();
      stores.delete(cid);
      for (const c of clients) if (c.campaign === cid) { send(c, { t: 'denied', reason: 'Campagne supprimée' }); c.ws.close(); }
    },
    flush: () => { for (const s of stores.values()) s.flush(); },
    close: () => {
      clearInterval(heartbeat);
      for (const t of expiryTimers.values()) clearTimeout(t);
      for (const c of clients) c.ws.terminate();
      for (const s of stores.values()) s.close();
    },
    tokens,
  };
}
