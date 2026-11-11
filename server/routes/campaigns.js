// Une campagne : création, réglages, membres, invitations, fiches, réserve, journal, export,
// jetons d'API. Tout se règle par le MJ de la campagne ; rien ici ne demande l'admin.
import { HttpError, send } from '../http.js';
import { AUDIT_KINDS } from '../audit.js';
import { blankCharacter, classSummary } from '../../shared/model.js';
import { totalLevel } from '../../shared/rules.js';
import { isDmRole } from '../campaigns.js';
import { lastBackup } from '../backup.js';
import { checkSheet, sheetExample, sheetPrompt } from '../../shared/sheet-template.js';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const GUIDE = fileURLToPath(new URL('../../docs/CAMPAIGN-SETUP.md', import.meta.url));

export function registerCampaigns(S) {
  const { router, db, engine, campaigns, audit, guard, bridgeOf, joinUrl } = S;

  const note = (ctx, cid, m, action, detail = '') => audit.log({ kind: 'dm', campaign: cid, action, detail, account: m.name, seat: 'MJ', ip: ctx.ip });

  function roster(c) {
    const owner = c.owner ? db.getAccount(c.owner) : null;
    return { id: c.id, name: c.data.name || 'Sans nom', player: c.data.player || '', cls: classSummary(c.data), level: totalLevel(c.data), owner: owner ? { id: owner.id, name: owner.name } : null };
  }

  // ------------------------------------------------------------ Campagne

  router.post('/api/campaigns', async ctx => {
    const acc = guard.user(ctx);
    // Créer une campagne est un droit donné par l'admin (console admin, « Peut créer des campagnes »).
    if (!acc.isAdmin && !acc.canCreate) throw new HttpError(403, 'Ton compte ne peut pas créer de campagne : demande ce droit à l\'admin');
    const b = await ctx.body();
    // Une limite large : de quoi jouer, pas de quoi encombrer le serveur.
    const owned = campaigns.campaignsOf(acc.id).filter(m => m.role === 'dm').length;
    if (owned >= 20 && !acc.isAdmin) throw new HttpError(400, 'Limite de 20 campagnes par compte');
    const c = campaigns.create({ name: b.name, description: b.description, ownerId: acc.id });
    if (b.settings && typeof b.settings === 'object') campaigns.update(c.id, { settings: b.settings });
    audit.log({ kind: 'dm', campaign: c.id, action: 'Campagne créée', detail: c.name, account: acc.name, ip: ctx.ip });
    return { id: c.id };
  });

  router.get('/api/c/:cid', ctx => {
    const m = guard.member(ctx);
    const cid = ctx.params.cid;
    return {
      campaign: campaigns.publicInfo(cid),
      role: m.role,
      members: campaigns.members(cid).map(x => ({ accountId: x.accountId, name: x.name, role: x.role })),
      mine: m.id ? engine.charsOwnedBy(m.id, cid).map(roster) : [],
    };
  });

  router.patch('/api/c/:cid', async ctx => {
    const m = guard.dm(ctx);
    const b = await ctx.body();
    const c = campaigns.update(ctx.params.cid, b);
    note(ctx, c.id, m, 'Réglages de la campagne');
    // La monnaie ou les jets de mort ont pu changer : les onglets ouverts se rechargent.
    S.hub.refresh(x => x.campaign === c.id);
    return { campaign: campaigns.publicInfo(c.id) };
  });

  router.delete('/api/c/:cid', async ctx => {
    const m = guard.owner(ctx);
    const cid = ctx.params.cid;
    const b = await ctx.body();
    const c = campaigns.must(cid);
    if (String(b.confirm || '').trim() !== c.name) throw new HttpError(400, 'Écris le nom exact de la campagne pour confirmer');
    deleteCampaign(cid);
    audit.log({ kind: 'admin', action: 'Campagne supprimée', detail: c.name, account: m.name, ip: ctx.ip });
    return { ok: true };
  });

  function deleteCampaign(cid) {
    S.hub.refresh(x => x.campaign === cid);
    S.map.dropCampaign(cid);
    engine.dropCampaign(cid);
    for (const a of db.assetsOf(cid)) S.assets.remove(a.id);
    S.worlds.remove(cid);
    db.deleteCampaign(cid);
    S.resetBridge(cid);
  }
  S.deleteCampaign = deleteCampaign;

  router.post('/api/c/:cid/leave', ctx => {
    const m = guard.member(ctx);
    if (!m.id) throw new HttpError(400, 'Compte inconnu');
    campaigns.removeMember(ctx.params.cid, m.id);
    audit.log({ kind: 'dm', campaign: ctx.params.cid, action: 'Départ de la campagne', account: m.name, ip: ctx.ip });
    S.hub.refresh(x => x.accountId === m.id && x.campaign === ctx.params.cid);
    return { ok: true };
  });

  // Panneau du MJ : tout ce qu'il règle lui-même.
  router.get('/api/c/:cid/overview', ctx => {
    const m = guard.dm(ctx);
    const cid = ctx.params.cid;
    const online = S.hub.online(cid);
    const bridge = bridgeOf(cid);
    const s = campaigns.settings(cid);
    return {
      campaign: { ...campaigns.publicInfo(cid), settings: { ...campaigns.publicInfo(cid).settings, sessionNumber: s.sessionNumber } },
      role: m.role,
      members: campaigns.members(cid).map(x => ({ ...x, online: online.get(x.accountId) || null, chars: engine.charsOwnedBy(x.accountId, cid).map(c => c.data.name || 'Sans nom') })),
      chars: engine.charsIn(cid).map(roster),
      invites: db.invitesOf(cid).map(i => ({ code: i.code, role: i.role, usesLeft: i.uses_left, expiresAt: i.expires_at, url: joinUrl(`/invite/${i.code}`), expired: !campaigns.invite(i.code) })),
      tokens: db.tokensOf(cid).map(t => ({ id: t.id, label: t.label, createdAt: t.created_at, lastUsed: t.last_used })),
      bridge: bridge ? { exportDir: bridge.exportDir, notes: !!bridge.config.notesDirs?.length, worldNotes: !!bridge.worldNotes, suggestedSession: bridge.suggestSession(), lastExport: s.lastExport || null } : null,
      storage: { bytes: db.campaignBytes(cid), quota: S.cfg.campaignQuotaBytes },
      lastBackup: lastBackup(S.backupDir) ? true : false,
    };
  });

  // ------------------------------------------------------------ Membres

  router.post('/api/c/:cid/members/:aid', async ctx => {
    const m = guard.dm(ctx);
    const cid = ctx.params.cid;
    const b = await ctx.body();
    const target = db.getAccount(ctx.params.aid);
    if (!target || !db.roleOf(cid, target.id)) throw new HttpError(404, 'Membre introuvable');
    const role = String(b.role || '');
    // Seul le MJ titulaire nomme des co-MJ ou passe son rôle.
    if ((role === 'dm' || role === 'codm' || db.roleOf(cid, target.id) !== 'player') && m.role !== 'dm') throw new HttpError(403, 'Réservé au MJ titulaire de la campagne');
    campaigns.setRole(cid, target.id, role);
    note(ctx, cid, m, 'Rôle changé', `${target.name} · ${role}`);
    S.hub.refresh(x => x.campaign === cid && (x.accountId === target.id || x.accountId === m.id));
    return { ok: true };
  });

  router.delete('/api/c/:cid/members/:aid', ctx => {
    const m = guard.dm(ctx);
    const cid = ctx.params.cid;
    const target = db.getAccount(ctx.params.aid);
    const role = target && db.roleOf(cid, target.id);
    if (!role) throw new HttpError(404, 'Membre introuvable');
    if (role !== 'player' && m.role !== 'dm') throw new HttpError(403, 'Réservé au MJ titulaire de la campagne');
    campaigns.removeMember(cid, target.id);
    // Ses fiches restent dans la campagne, sans titulaire : le MJ les redonne ou les supprime.
    for (const c of engine.charsOwnedBy(target.id, cid)) engine.setOwner(c.id, null);
    note(ctx, cid, m, 'Membre retiré', target.name);
    S.hub.refresh(x => x.campaign === cid && x.accountId === target.id);
    return { ok: true };
  });

  router.post('/api/c/:cid/invites', async ctx => {
    const m = guard.dm(ctx);
    const b = await ctx.body();
    const role = b.role === 'codm' ? 'codm' : 'player';
    if (role === 'codm' && m.role !== 'dm') throw new HttpError(403, 'Réservé au MJ titulaire de la campagne');
    const i = campaigns.createInvite(ctx.params.cid, { role, uses: b.uses, days: b.days ?? 14, by: m.id });
    note(ctx, ctx.params.cid, m, 'Invitation créée', role);
    return { code: i.code, url: joinUrl(`/invite/${i.code}`) };
  });

  router.delete('/api/c/:cid/invites/:code', ctx => {
    const m = guard.dm(ctx);
    const i = db.getInvite(ctx.params.code);
    if (!i || i.campaign_id !== ctx.params.cid) throw new HttpError(404, 'Invitation introuvable');
    db.deleteInvite(i.code);
    note(ctx, ctx.params.cid, m, 'Invitation retirée');
    return { ok: true };
  });

  // ------------------------------------------------------------ Fiches

  // Un joueur crée sa propre fiche ; le MJ en crée pour qui il veut, ou pour personne (PNJ).
  router.post('/api/c/:cid/characters', async ctx => {
    const m = guard.member(ctx);
    const cid = ctx.params.cid;
    const b = await ctx.body(5_000_000);
    let owner = m.id;
    if (isDmRole(m.role)) {
      owner = b.owner === undefined ? null : b.owner || null;
      if (owner && !db.roleOf(cid, owner)) throw new HttpError(400, 'Ce compte ne fait pas partie de la campagne');
    } else if (engine.charsOwnedBy(m.id, cid).length >= 5) throw new HttpError(400, 'Limite de 5 fiches par joueur dans une campagne');
    const ownerAcc = owner ? db.getAccount(owner) : null;
    if (b.data) {
      const { errors } = checkSheet(b.data);
      if (errors.length) throw new HttpError(400, 'Fiche refusée : {list}', { list: errors.join(' ') });
    }
    const data = b.data ? b.data.character || b.data : blankCharacter({
      name: String(b.name || 'Nouveau personnage').slice(0, 80), player: String(b.player || ownerAcc?.name || ''),
      className: String(b.className || ''), subclass: String(b.subclass || ''),
      level: Math.max(1, Math.min(20, Number(b.level) || 1)), race: String(b.race || ''),
    });
    if (b.background) data.background = String(b.background).slice(0, 80);
    if (!data.player && ownerAcc) data.player = ownerAcc.name;
    if (!data.edition) data.edition = campaigns.settings(cid).edition;
    const id = engine.createCharacter(data, { campaign: cid, owner });
    audit.log({ kind: 'sheet', campaign: cid, action: 'Fiche créée', detail: `${engine.docs.get(id)?.data.name}${ownerAcc ? ` · ${ownerAcc.name}` : ''}`, account: m.name, ip: ctx.ip });
    return { id };
  });

  function charOf(ctx, m) {
    const e = engine.docs.get(ctx.params.id);
    if (!e || e.kind !== 'char' || e.campaign !== ctx.params.cid) throw new HttpError(404, 'Fiche introuvable');
    return e;
  }
  const mayEdit = (m, e) => isDmRole(m.role) || (m.id && e.owner === m.id);

  router.get('/api/c/:cid/characters', ctx => {
    guard.member(ctx);
    return engine.charsIn(ctx.params.cid).map(roster);
  });

  router.get('/api/c/:cid/characters/:id', ctx => {
    const m = guard.member(ctx);
    const e = charOf(ctx, m);
    const client = { role: isDmRole(m.role) ? 'dm' : 'player', campaign: ctx.params.cid, charId: e.owner === m.id ? e.id : null };
    return { id: e.id, owner: e.owner, character: engine.viewOf(client, e) };
  });

  router.get('/api/c/:cid/characters/:id/json', ctx => {
    const m = guard.member(ctx);
    const e = charOf(ctx, m);
    const client = { role: isDmRole(m.role) ? 'dm' : 'player', campaign: ctx.params.cid, charId: e.owner === m.id ? e.id : null };
    const name = (e.data.name || 'personnage').replace(/[^\w\- ]+/g, '').trim() || 'personnage';
    return send(ctx.res, 200, JSON.stringify({ format: 'dnd-sheet', version: 2, exportedAt: new Date().toISOString(), character: engine.viewOf(client, e) }, null, 2),
      'application/json; charset=utf-8', { 'Content-Disposition': `attachment; filename="${name}.json"` });
  });

  router.put('/api/c/:cid/characters/:id', async ctx => {
    const m = guard.member(ctx);
    const e = charOf(ctx, m);
    if (!mayEdit(m, e)) throw new HttpError(403, "Ce n'est pas ta fiche");
    const body = await ctx.body(5_000_000);
    const { errors } = checkSheet(body);
    if (errors.length) throw new HttpError(400, 'Fiche refusée : {list}', { list: errors.join(' ') });
    const r = engine.replaceCharacter(e.id, body);
    audit.log({ kind: 'sheet', campaign: e.campaign, action: 'Import JSON', account: m.name, seat: e.data.name, ip: ctx.ip });
    return { ok: true, toast: r.toast };
  });

  router.post('/api/c/:cid/characters/:id/owner', async ctx => {
    const m = guard.dm(ctx);
    const e = charOf(ctx, m);
    const b = await ctx.body();
    const owner = b.owner || null;
    if (owner && !db.roleOf(e.campaign, owner)) throw new HttpError(400, 'Ce compte ne fait pas partie de la campagne');
    const before = e.owner;
    if (before === owner) return { ok: true };
    engine.setOwner(e.id, owner);
    note(ctx, e.campaign, m, 'Fiche attribuée', `${e.data.name} · ${owner ? db.getAccount(owner)?.name : 'personne'}`);
    S.hub.refresh(x => x.campaign === e.campaign && (x.accountId === before || x.accountId === owner));
    return { ok: true };
  });

  router.delete('/api/c/:cid/characters/:id', ctx => {
    const m = guard.member(ctx);
    const e = charOf(ctx, m);
    if (!mayEdit(m, e)) throw new HttpError(403, "Ce n'est pas ta fiche");
    const name = e.data.name;
    engine.deleteCharacter(e.id);
    audit.log({ kind: 'sheet', campaign: ctx.params.cid, action: 'Fiche supprimée', detail: name, account: m.name, ip: ctx.ip });
    return { ok: true };
  });

  router.post('/api/c/:cid/stash', async ctx => {
    const m = guard.dm(ctx);
    const b = await ctx.body();
    const added = engine.adminStashAdd(b.items, 'MJ', ctx.params.cid);
    note(ctx, ctx.params.cid, m, 'Ajout à la réserve', String(added));
    return { added };
  });

  // ------------------------------------------------------------ Journal

  router.get('/api/c/:cid/audit', ctx => {
    guard.dm(ctx);
    const kinds = ctx.query('kinds').split(',').filter(k => Object.hasOwn(AUDIT_KINDS, k));
    return { entries: db.listAudit({ campaign: ctx.params.cid, kinds, before: ctx.query('before') || null, q: ctx.query('q').slice(0, 60), limit: Number(ctx.query('limit')) || 200 }), kinds: AUDIT_KINDS };
  });

  // ------------------------------------------------------------ Export vers le coffre (pont)

  router.post('/api/c/:cid/export', async ctx => {
    const m = guard.dm(ctx);
    const cid = ctx.params.cid;
    const bridge = bridgeOf(cid);
    if (!bridge) throw new HttpError(400, 'Cette campagne n\'est pas reliée à un coffre Obsidian');
    const b = await ctx.body();
    engine.flush();
    const s = campaigns.settings(cid);
    const session = b.session != null && b.session !== '' ? Number(b.session) : s.sessionNumber ?? bridge.suggestSession();
    const r = bridge.export({
      chars: engine.charsIn(cid).map(c => ({ id: c.id, data: c.data })),
      party: { data: engine.party(cid).data },
      settings: s, session, only: b.charId || null,
    });
    campaigns.setInternal(cid, 'lastExport', { at: Date.now(), files: r.files.length, session });
    note(ctx, cid, m, 'Export vers le coffre', `${r.files.length}`);
    return r;
  });

  // ------------------------------------------------------------ Fiches écrites hors de l'application

  // Le modèle de fiche et la consigne pour une IA, adaptés à la monnaie et à l'édition de la campagne.
  router.get('/api/c/:cid/sheet/template', ctx => {
    guard.member(ctx);
    const s = campaigns.settings(ctx.params.cid);
    const coins = (s.currency || []).map(c => c.key);
    return { example: sheetExample({ coins, edition: s.edition }), prompt: sheetPrompt({ coins, edition: s.edition }) };
  });

  // Vérifier une fiche sans l'importer : { errors, warnings }. Une erreur bloquerait l'import.
  router.post('/api/c/:cid/sheet/check', async ctx => {
    guard.member(ctx);
    const b = await ctx.body(5_000_000);
    const coins = (campaigns.settings(ctx.params.cid).currency || []).map(c => c.key);
    return checkSheet(b, { coins });
  });

  // Le guide de mise en place d'une campagne, lisible sans compte (il ne contient rien de privé).
  router.get('/api/guide.md', ctx => {
    let text;
    try { text = fs.readFileSync(GUIDE, 'utf8'); } catch { throw new HttpError(404, 'Guide introuvable'); }
    return send(ctx.res, 200, text, 'text/markdown; charset=utf-8');
  });

  // ------------------------------------------------------------ Jetons d'API

  router.post('/api/c/:cid/tokens', async ctx => {
    const m = guard.owner(ctx);
    if (!m.id) throw new HttpError(403, 'Un jeton ne crée pas d\'autre jeton');
    const b = await ctx.body();
    const t = campaigns.createToken(ctx.params.cid, b.label, m.id);
    note(ctx, ctx.params.cid, m, 'Jeton d\'API créé', String(b.label || ''));
    return t;
  });

  router.delete('/api/c/:cid/tokens/:id', ctx => {
    const m = guard.owner(ctx);
    db.deleteToken(ctx.params.cid, ctx.params.id);
    note(ctx, ctx.params.cid, m, 'Jeton d\'API retiré', ctx.params.id);
    return { ok: true };
  });
}
