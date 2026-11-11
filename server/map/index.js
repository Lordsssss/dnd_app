// Carte de table d'une campagne : routes HTTP et canal temps réel. Réservée au MJ et aux co-MJ
// de la campagne ; la TV est une fenêtre du même compte. Les joueurs ne s'y connectent pas.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { SceneError } from '../../shared/map/scene.js';
import { opLabel } from '../../shared/map/ops.js';
import { SceneStore } from './store.js';
import { TokenCatalog, assetItems } from './tokens.js';
import { HttpError } from '../http.js';
import { APP_DIR } from '../config.js';

export function createMapServer({ db, engine, campaigns, assets, library, cfg, audit = null, authToken, router, guard }) {
  const tokens = new TokenCatalog(library.dir);
  const stores = new Map();
  const clients = new Set();

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
    if (campaigns.settings(cid).tvScene === ctx.params.id) campaigns.setInternal(cid, 'tvScene', null);
    audit?.log({ kind: 'map', campaign: cid, action: 'Carte supprimée', account: a.name, seat: 'MJ', detail: ctx.params.id });
    return { ok: true };
  });
  router.post('/api/c/:cid/map/scenes/:id/autowalls', async ctx => {
    dm(ctx);
    const b = await ctx.body();
    return autoWalls(ctx.params.cid, ctx.params.id, b);
  });

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

  function send(c, msg) {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
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
  }

  function setTvScene(cid, id) {
    campaigns.setInternal(cid, 'tvScene', id);
    broadcastAll(cid, listMessage(cid));
    for (const c of clients) if (c.authed && c.campaign === cid && c.role === 'tv') openFor(c, id);
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
          if (!who || (role !== 'dm' && role !== 'codm')) return send(c, { t: 'denied', reason: 'Réservé au MJ de la campagne' });
          Object.assign(c, { authed: true, accountId: who.id, accountName: who.name, campaign: cid, role: msg.role === 'tv' ? 'tv' : 'dm', token: msg.token });
          send(c, { ...listMessage(cid), t: 'welcome', role: c.role, campaign: campaigns.publicInfo(cid) });
          const tv = campaigns.settings(cid).tvScene;
          if (c.role === 'tv' && tv && storeOf(cid).has(tv)) openFor(c, tv);
          return undefined;
        }
        if (!c.authed) return reply(false, { error: 'Non connecté' });
        const cid = c.campaign;
        switch (msg.t) {
          case 'open': openFor(c, msg.scene); return reply(true);
          case 'op': {
            const doc = storeOf(cid).open(msg.scene);
            publish(cid, msg.scene, doc.apply(msg.op));
            logOp(c, cid, msg.scene, msg.op);
            return reply(true);
          }
          case 'undo':
          case 'redo': {
            const doc = storeOf(cid).open(msg.scene);
            const update = msg.t === 'undo' ? doc.undo() : doc.redo();
            if (update) publish(cid, msg.scene, update);
            return reply(true);
          }
          case 'tvScene': storeOf(cid).open(msg.scene); setTvScene(cid, msg.scene); return reply(true);
          case 'live': broadcast(cid, c.scene, { t: 'live', scene: c.scene, live: msg.live }, c); return undefined;
          case 'tvSize': broadcastAll(cid, { t: 'tvSize', w: msg.w, h: msg.h }, c); return undefined;
          default: return reply(false, { error: 'Message inconnu' });
        }
      } catch (e) {
        if (!(e instanceof SceneError)) console.error(e);
        return reply(false, { error: e instanceof SceneError ? e.message : 'Erreur serveur' });
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
        if (!c.authed || !predicate({ accountId: c.accountId, campaign: c.campaign, token: c.token })) continue;
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
      for (const c of clients) c.ws.terminate();
      for (const s of stores.values()) s.close();
    },
    tokens,
  };
}
