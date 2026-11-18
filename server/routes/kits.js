// Lots préparés du MJ : objets donnés ou retirés d'une fiche en un clic, préparés avant la séance.
import crypto from 'node:crypto';
import { HttpError } from '../http.js';
import { ActionError } from '../../shared/actions.js';
import { kitTakes, normalizeKit } from '../../shared/kits.js';

const HISTORY = 20;

export function registerKits(S) {
  const { router, db, engine, audit, guard } = S;
  const note = (ctx, cid, m, action, detail = '') => audit.log({ kind: 'dm', campaign: cid, action, detail, account: m.name, seat: 'MJ', ip: ctx.ip });
  const newKitId = () => `k${crypto.randomBytes(6).toString('hex')}`;
  // Ce que le panneau affiche : le lot, son historique, et de quoi annuler sans l'inventaire d'avant.
  const view = k => {
    const { undo, campaign, ...rest } = k;
    return { ...rest, undo: undo ? { charId: undo.charId, name: undo.name, at: undo.at, createdKit: undo.createdKit || null } : null };
  };
  function kitOf(ctx) {
    const k = db.getKit(ctx.params.id);
    if (!k || k.campaign !== ctx.params.cid) throw new HttpError(404, 'Lot introuvable');
    return k;
  }
  function charIn(cid, id) {
    const e = engine.docs.get(String(id || ''));
    if (!e || e.kind !== 'char' || e.campaign !== cid) throw new HttpError(404, 'Fiche introuvable');
    return e;
  }

  router.get('/api/c/:cid/kits', ctx => {
    guard.dm(ctx);
    return db.kitsOf(ctx.params.cid).map(view)
      .sort((a, b) => (a.folder || '').localeCompare(b.folder || '', 'fr', { numeric: true }) || a.order - b.order || a.name.localeCompare(b.name, 'fr'));
  });

  router.post('/api/c/:cid/kits', async ctx => {
    const m = guard.dm(ctx);
    const cid = ctx.params.cid;
    const kit = normalizeKit(await ctx.body(2_000_000));
    if (kit.target) charIn(cid, kit.target);
    const id = newKitId();
    db.putKit(cid, id, { ...kit, history: [] });
    note(ctx, cid, m, 'Lot créé', kit.name);
    return view({ id, ...kit, history: [] });
  });

  router.put('/api/c/:cid/kits/:id', async ctx => {
    const m = guard.dm(ctx);
    const cid = ctx.params.cid;
    const cur = kitOf(ctx);
    const kit = normalizeKit(await ctx.body(2_000_000));
    if (kit.target && kit.target !== cur.target) charIn(cid, kit.target);
    const next = { ...kit, history: cur.history || [], undo: cur.undo || null };
    db.putKit(cid, cur.id, next);
    note(ctx, cid, m, 'Lot modifié', kit.name);
    return view({ id: cur.id, ...next });
  });

  router.delete('/api/c/:cid/kits/:id', ctx => {
    const m = guard.dm(ctx);
    const cur = kitOf(ctx);
    db.deleteKit(ctx.params.cid, cur.id);
    note(ctx, ctx.params.cid, m, 'Lot supprimé', cur.name);
    return { ok: true };
  });

  // Appliquer : retirer, puis donner. Ce qui est rangé part dans un nouveau lot, à rendre plus tard.
  router.post('/api/c/:cid/kits/:id/apply', async ctx => {
    const m = guard.dm(ctx);
    const cid = ctx.params.cid;
    const cur = kitOf(ctx);
    const b = await ctx.body();
    const charId = b.charId || cur.target;
    if (!charId) throw new HttpError(400, 'Choisis la fiche qui reçoit le lot');
    const e = charIn(cid, charId);
    if (kitTakes(cur) && cur.target && cur.target !== charId) throw new HttpError(400, 'Ce lot retire des objets de {name} seulement', { name: engine.docs.get(cur.target)?.data.name || '?' });
    let r;
    try { r = engine.applyKit(e.id, cid, normalizeKit(cur)); } catch (err) {
      if (err instanceof ActionError) throw new HttpError(400, err.message);
      throw err;
    }
    const now = Date.now();
    let created = null;
    if (r.kept.items.length || Object.keys(r.kept.currency).length) {
      const name = cur.keepName || `${cur.name} · à rendre`;
      created = { id: newKitId(), name };
      const back = normalizeKit({
        name, folder: cur.folder, target: e.id, order: num(cur.order) + 0.5,
        note: `Rangé par « ${cur.name} ».`,
        give: { items: r.kept.items, currency: r.kept.currency },
      });
      db.putKit(cid, created.id, { ...back, history: [] });
    }
    const history = [{ at: now, charId: e.id, name: r.name, by: m.name }, ...(cur.history || [])].slice(0, HISTORY);
    const undo = { charId: e.id, name: r.name, at: now, before: r.before, createdKit: created };
    db.putKit(cid, cur.id, { ...normalizeKit(cur), history, undo });
    note(ctx, cid, m, 'Lot appliqué', `${cur.name} → ${r.name}`);
    return { name: r.name, removed: r.removed, given: r.given, warnings: r.warnings, created };
  });

  // Annuler la dernière application : la fiche retrouve son inventaire et sa bourse d'avant,
  // et le lot « à rendre » qu'elle avait créé disparaît.
  router.post('/api/c/:cid/kits/:id/undo', ctx => {
    const m = guard.dm(ctx);
    const cid = ctx.params.cid;
    const cur = kitOf(ctx);
    if (!cur.undo?.before) throw new HttpError(400, 'Rien à annuler');
    const e = charIn(cid, cur.undo.charId);
    const name = engine.restoreItems(e.id, cid, cur.undo.before);
    const made = cur.undo.createdKit?.id ? db.getKit(cur.undo.createdKit.id) : null;
    if (made && made.campaign === cid) db.deleteKit(cid, made.id);
    db.putKit(cid, cur.id, { ...normalizeKit(cur), history: (cur.history || []).filter(h => h.at !== cur.undo.at), undo: null });
    note(ctx, cid, m, 'Lot annulé', `${cur.name} → ${name}`);
    return { ok: true, name };
  });
}

function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
