// Contenu d'une campagne : images envoyées, bestiaire, carte du monde.
import { HttpError, send } from '../http.js';
import { ASSET_KINDS, cleanFolder } from '../assets.js';
import { isDmRole } from '../campaigns.js';
import { normalizeBeast, monsterToBeast } from '../../shared/bestiary.js';
import crypto from 'node:crypto';

export function registerContent(S) {
  const { router, db, campaigns, assets, library, worlds, audit, guard, data5e, bridgeOf } = S;
  const note = (ctx, cid, m, kind, action, detail = '') => audit.log({ kind, campaign: cid, action, detail, account: m.name, seat: 'MJ', ip: ctx.ip });

  // ------------------------------------------------------------ Images

  // Envoi brut : le corps de la requête est l'image. ?kind=map|token|portrait|world|image&name=…
  // Un joueur peut envoyer le portrait de son personnage ; le reste est l'affaire du MJ.
  router.post('/api/c/:cid/assets', async ctx => {
    const m = guard.member(ctx);
    const cid = ctx.params.cid;
    const kind = ASSET_KINDS.includes(ctx.query('kind')) ? ctx.query('kind') : 'image';
    if (!isDmRole(m.role) && kind !== 'portrait') throw new HttpError(403, 'Réservé au MJ de la campagne');
    const buffer = await ctx.raw(S.cfg.maxUploadBytes + 1);
    const a = assets.save({ campaign: cid, kind, name: ctx.query('name') || 'image', buffer, by: m.id, folder: ctx.query('folder') });
    note(ctx, cid, m, 'dm', 'Image envoyée', `${a.name} · ${kind}`);
    return { ...a, ref: `asset:${a.id}` };
  });

  router.get('/api/c/:cid/assets', ctx => {
    guard.dm(ctx);
    const kind = ASSET_KINDS.includes(ctx.query('kind')) ? ctx.query('kind') : null;
    return db.assetsOf(ctx.params.cid, kind).map(a => ({ ...a, file: undefined, ref: `asset:${a.id}` }));
  });

  router.patch('/api/c/:cid/assets/:id', async ctx => {
    guard.dm(ctx);
    const a = db.getAsset(ctx.params.id);
    if (!a || a.campaign !== ctx.params.cid) throw new HttpError(404, 'Image introuvable');
    const b = await ctx.body();
    const next = { ...a };
    if (typeof b.name === 'string' && b.name.trim()) next.name = b.name.trim().slice(0, 120);
    if (ASSET_KINDS.includes(b.kind)) next.kind = b.kind;
    if (typeof b.folder === 'string') next.folder = cleanFolder(b.folder);
    db.putAsset(next);
    return { ok: true };
  });

  router.delete('/api/c/:cid/assets/:id', ctx => {
    const m = guard.dm(ctx);
    const a = db.getAsset(ctx.params.id);
    if (!a || a.campaign !== ctx.params.cid) throw new HttpError(404, 'Image introuvable');
    assets.remove(a.id);
    note(ctx, ctx.params.cid, m, 'dm', 'Image supprimée', a.name);
    return { ok: true };
  });

  // Une image par sa référence : `asset:<id>` (membres de sa campagne) ou `lib:<chemin>`
  // (bibliothèque globale, tout compte connecté). Lue aussi par le cookie, pour les balises <img>.
  router.get('/api/file', ctx => {
    const a = ctx.auth();
    if (!a) throw new HttpError(401, 'Non connecté');
    const ref = ctx.query('ref');
    if (ref.startsWith('lib:')) {
      if (a.kind === 'session' && a.account.mustChange) throw new HttpError(403, 'Choisis d\'abord ton mot de passe');
      return library.serve(ctx.req, ctx.res, ref.slice(4));
    }
    if (ref.startsWith('asset:')) {
      const asset = db.getAsset(ref.slice(6));
      if (!asset) throw new HttpError(404, 'Image introuvable');
      if (asset.campaign) {
        if (a.kind === 'api') { if (a.apiToken.campaign_id !== asset.campaign) throw new HttpError(403, 'Image d\'une autre campagne'); }
        else if (!campaigns.role(a.account.id, asset.campaign)) throw new HttpError(403, 'Image d\'une autre campagne');
      }
      return assets.serve(ctx.req, ctx.res, asset);
    }
    throw new HttpError(400, 'Référence d\'image invalide');
  });

  // ------------------------------------------------------------ Bestiaire

  router.get('/api/c/:cid/bestiary', ctx => {
    guard.dm(ctx);
    return db.beastsOf(ctx.params.cid).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  });

  router.get('/api/c/:cid/bestiary/:id', ctx => {
    guard.dm(ctx);
    const b = db.getBeast(ctx.params.id);
    if (!b || b.campaign !== ctx.params.cid) throw new HttpError(404, 'Créature introuvable');
    return b;
  });

  router.post('/api/c/:cid/bestiary', async ctx => {
    const m = guard.dm(ctx);
    const cid = ctx.params.cid;
    const raw = await ctx.body();
    const beast = normalizeBeast(raw);
    const id = `b${crypto.randomBytes(6).toString('hex')}`;
    db.putBeast(cid, id, beast);
    note(ctx, cid, m, 'map', 'Bestiaire : ajout', beast.name);
    return { id, ...beast };
  });

  // Copier une créature de 5etools dans le bestiaire, pour la retoucher.
  router.post('/api/c/:cid/bestiary/from5e', async ctx => {
    const m = guard.dm(ctx);
    const cid = ctx.params.cid;
    const b = await ctx.body();
    const e = data5e.entry('monster', String(b.name || ''), String(b.source || ''));
    if (!e?.monster) throw new HttpError(404, 'Créature absente des données 5etools');
    const beast = monsterToBeast(e.monster);
    const id = `b${crypto.randomBytes(6).toString('hex')}`;
    db.putBeast(cid, id, beast);
    note(ctx, cid, m, 'map', 'Bestiaire : copie de 5etools', beast.name);
    return { id, ...beast };
  });

  router.put('/api/c/:cid/bestiary/:id', async ctx => {
    const m = guard.dm(ctx);
    const cid = ctx.params.cid;
    const cur = db.getBeast(ctx.params.id);
    if (!cur || cur.campaign !== cid) throw new HttpError(404, 'Créature introuvable');
    const raw = await ctx.body();
    const beast = normalizeBeast({ ...cur, ...raw });
    db.putBeast(cid, cur.id, beast);
    note(ctx, cid, m, 'map', 'Bestiaire : modification', beast.name);
    return { id: cur.id, ...beast };
  });

  router.delete('/api/c/:cid/bestiary/:id', ctx => {
    const m = guard.dm(ctx);
    const cur = db.getBeast(ctx.params.id);
    if (!cur || cur.campaign !== ctx.params.cid) throw new HttpError(404, 'Créature introuvable');
    db.deleteBeast(ctx.params.cid, cur.id);
    note(ctx, ctx.params.cid, m, 'map', 'Bestiaire : suppression', cur.name);
    return { ok: true };
  });

  // Coffre → bestiaire : chaque bloc de stats des notes devient une entrée, mise à jour si elle existe.
  router.post('/api/c/:cid/bestiary/sync', ctx => {
    const m = guard.dm(ctx);
    const cid = ctx.params.cid;
    const bridge = bridgeOf(cid);
    if (!bridge) throw new HttpError(400, 'Cette campagne n\'est pas reliée à un coffre Obsidian');
    const existing = db.beastsOf(cid);
    const byOrigin = new Map(existing.filter(x => x.origin?.file).map(x => [`${x.origin.file}|${x.origin.title}`, x]));
    let added = 0, updated = 0;
    for (const blk of bridge.statBlocks()) {
      const key = `${blk.file}|${blk.title}`;
      const prev = byOrigin.get(key);
      const beast = normalizeBeast({
        ...(prev || {}),
        name: blk.name, kind: 'markdown', body: [`**${blk.title}**`, ...blk.body].join('\n'),
        size: blk.size || prev?.size || 1, init: blk.init ?? prev?.init ?? null,
        origin: { file: blk.file, title: blk.title, link: blk.link || '' },
      });
      if (prev) { db.putBeast(cid, prev.id, beast); updated++; } else { db.putBeast(cid, `b${crypto.randomBytes(6).toString('hex')}`, beast); added++; }
    }
    note(ctx, cid, m, 'map', 'Bestiaire synchronisé avec le coffre', `${added} ajout(s), ${updated} mise(s) à jour`);
    return { added, updated };
  });

  // ------------------------------------------------------------ Carte du monde

  const world = cid => worlds.of(cid);
  const worldNote = (ctx, m, action, detail = '') => audit.log({ kind: 'world', campaign: ctx.params.cid, action, detail, account: m.name, seat: 'MJ', ip: ctx.ip, mergeKey: `monde|${action}|${detail}` });

  router.get('/api/c/:cid/monde', ctx => {
    const m = guard.member(ctx);
    return world(ctx.params.cid).view(isDmRole(m.role) ? 'dm' : 'player');
  });
  router.get('/api/c/:cid/monde/svg', ctx => {
    guard.member(ctx);
    const { svg, etag } = world(ctx.params.cid).baseSvg();
    if (ctx.req.headers['if-none-match'] === etag) { ctx.res.writeHead(304, { ETag: etag }); ctx.res.end(); return undefined; }
    return send(ctx.res, 200, svg, 'image/svg+xml; charset=utf-8', { ETag: etag, 'Cache-Control': 'private, no-cache' });
  });
  router.post('/api/c/:cid/monde/entity', async ctx => {
    const m = guard.dm(ctx);
    const b = await ctx.body();
    const r = world(ctx.params.cid).patchEntity(String(b.key || ''), b.patch || {});
    worldNote(ctx, m, 'Monde : fiche modifiée', String(b.key || ''));
    return r;
  });
  router.post('/api/c/:cid/monde/place', async ctx => {
    const m = guard.dm(ctx);
    const b = await ctx.body();
    const r = world(ctx.params.cid).addPlace({ name: b.name, x: Number(b.x), y: Number(b.y), kind: b.kind });
    worldNote(ctx, m, 'Monde : lieu ajouté', String(b.name || ''));
    return r;
  });
  router.delete('/api/c/:cid/monde/place/:key', ctx => {
    const m = guard.dm(ctx);
    if (!/^a\d+$/.test(ctx.params.key)) throw new HttpError(400, 'Lieu introuvable');
    worldNote(ctx, m, 'Monde : lieu retiré', ctx.params.key);
    return world(ctx.params.cid).removePlace(ctx.params.key);
  });
  router.post('/api/c/:cid/monde/party', async ctx => {
    guard.dm(ctx);
    const b = await ctx.body();
    return world(ctx.params.cid).setParty(b.clear ? null : { x: Number(b.x), y: Number(b.y), known: b.known !== false, label: b.label });
  });
  router.get('/api/c/:cid/monde/notes', ctx => { guard.dm(ctx); return world(ctx.params.cid).notes(); });
  router.get('/api/c/:cid/monde/note', ctx => { guard.dm(ctx); return world(ctx.params.cid).note(ctx.query('file')); });
  router.post('/api/c/:cid/monde/write', ctx => {
    const m = guard.dm(ctx);
    const r = world(ctx.params.cid).writeMap();
    worldNote(ctx, m, 'Monde : noms écrits dans le .map', r.touched.join(', ') || 'rien à changer');
    return r;
  });
  // Un fichier .map d'Azgaar, envoyé brut (jusqu'à 60 Mo).
  router.post('/api/c/:cid/monde/map', async ctx => {
    const m = guard.dm(ctx);
    const text = (await ctx.raw(60_000_000)).toString('utf8');
    worlds.setMap(ctx.params.cid, text);
    worldNote(ctx, m, 'Monde : nouveau fichier .map', ctx.query('name'));
    return world(ctx.params.cid).view('dm');
  });
  router.post('/api/c/:cid/monde/image', async ctx => {
    const m = guard.dm(ctx);
    const b = await ctx.body();
    const ref = String(b.ref || '');
    const a = ref.startsWith('asset:') ? db.getAsset(ref.slice(6)) : null;
    if (!a || a.campaign !== ctx.params.cid) throw new HttpError(400, 'Image introuvable');
    worlds.setImage(ctx.params.cid, ref);
    worldNote(ctx, m, 'Monde : image de carte', a.name);
    return world(ctx.params.cid).view('dm');
  });
  router.delete('/api/c/:cid/monde/map', ctx => {
    const m = guard.dm(ctx);
    worlds.clear(ctx.params.cid);
    worldNote(ctx, m, 'Monde : carte retirée');
    return { ok: true };
  });
  router.get('/api/c/:cid/monde/download', ctx => {
    guard.dm(ctx);
    const buf = worlds.mapText(ctx.params.cid);
    if (!buf) throw new HttpError(404, 'Aucun fichier .map');
    const name = (campaigns.get(ctx.params.cid)?.name || 'monde').replace(/[^\w\- ]+/g, '').trim() || 'monde';
    return send(ctx.res, 200, buf, 'application/octet-stream', { 'Content-Disposition': `attachment; filename="${name}.map"` });
  });
}
