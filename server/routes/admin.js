// Console admin : comptes, campagnes vues de l'extérieur, ponts vers un coffre, serveur.
// L'admin répare (secret oublié, MJ parti, campagne à supprimer) sans lire le contenu des
// campagnes dont il n'est pas membre.
import path from 'node:path';
import { HttpError } from '../http.js';
import { hashPin, loginKey, newAccountId, publicAccount, tempPin } from '../accounts.js';
import { AUDIT_KINDS } from '../audit.js';
import { dailyBackup, lastBackup } from '../backup.js';
import { fetch5eTools } from '../fetch5e.js';
import { normalizeBridge } from '../bridge.js';
import { resolveFromApp } from '../config.js';

export function registerAdmin(S) {
  const { router, db, engine, campaigns, audit, guard, data5e, cfg } = S;
  let fetching5e = null;
  const note = (ctx, acc, action, detail = '') => audit.log({ kind: 'admin', action, detail, account: acc.name, seat: 'Admin', ip: ctx.ip });

  router.get('/api/admin/overview', ctx => {
    guard.admin(ctx);
    const accounts = db.listAccounts();
    return {
      signup: db.getSetting('signup', 'invite'),
      accounts: accounts.map(a => ({
        ...publicAccount(a), lastLogin: a.lastLogin || null, createdAt: a.createdAt || null,
        campaigns: campaigns.campaignsOf(a.id).map(m => ({ id: m.campaign.id, name: m.campaign.name, role: m.role })),
      })),
      campaigns: campaigns.list().map(c => ({
        id: c.id, name: c.name, createdAt: c.createdAt,
        members: db.membersOf(c.id).map(m => ({ accountId: m.accountId, name: m.name, role: m.role })),
        chars: engine.charsIn(c.id).length,
        scenes: db.scenesOf(c.id).length,
        bytes: db.campaignBytes(c.id),
        bridge: c.bridge,
      })),
      server: {
        data5e: data5e.status(), fetching5e: !!fetching5e,
        library: S.library.dir, libraryCount: S.map.tokens.list.length,
        lastBackup: lastBackup(S.backupDir), backupDir: S.backupDir, dataDir: S.dataDir,
        publicUrl: cfg.publicUrl || null, node: process.version, uptime: Math.round(process.uptime()),
      },
    };
  });

  router.post('/api/admin/settings', async ctx => {
    const acc = guard.admin(ctx);
    const b = await ctx.body();
    if (b.signup) {
      if (!['invite', 'open', 'closed'].includes(b.signup)) throw new HttpError(400, 'Réglage inconnu');
      db.setSetting('signup', b.signup);
      note(ctx, acc, 'Inscriptions', b.signup);
    }
    return { ok: true, signup: db.getSetting('signup', 'invite') };
  });

  // ------------------------------------------------------------ Comptes

  router.post('/api/admin/accounts', async ctx => {
    const acc = guard.admin(ctx);
    const b = await ctx.body();
    const name = String(b.name || '').trim().slice(0, 40);
    if (!name) throw new HttpError(400, 'Nom obligatoire');
    const login = loginKey(b.login || name);
    if (!login) throw new HttpError(400, 'Identifiant invalide : lettres et chiffres');
    if (db.getAccountByLogin(login)) throw new HttpError(400, 'L\'identifiant « {login} » est déjà pris', { login });
    const pin = tempPin();
    const a = { id: newAccountId(), login, name, pinHash: hashPin(pin), mustChange: true, isAdmin: !!b.isAdmin, canCreate: !!b.canCreate, secretKind: 'pin' };
    db.putAccount(a);
    note(ctx, acc, 'Compte créé', `${name} (${login})`);
    return { account: publicAccount(a), pin };
  });

  router.post('/api/admin/accounts/:id', async ctx => {
    const acc = guard.admin(ctx);
    const target = db.getAccount(ctx.params.id);
    if (!target) throw new HttpError(404, 'Compte introuvable');
    const b = await ctx.body();
    const next = { ...target };
    if (typeof b.name === 'string' && b.name.trim()) next.name = b.name.trim().slice(0, 40);
    if (typeof b.login === 'string' && b.login.trim()) {
      const login = loginKey(b.login);
      if (!login) throw new HttpError(400, 'Identifiant invalide : lettres et chiffres');
      const other = db.getAccountByLogin(login);
      if (other && other.id !== target.id) throw new HttpError(400, 'L\'identifiant « {login} » est déjà pris', { login });
      next.login = login;
    }
    if (typeof b.isAdmin === 'boolean') {
      if (!b.isAdmin && target.id === acc.id) throw new HttpError(400, 'Tu ne peux pas retirer ton propre accès admin');
      next.isAdmin = b.isAdmin;
    }
    if (typeof b.canCreate === 'boolean') next.canCreate = b.canCreate;
    db.putAccount(next);
    const what = typeof b.canCreate === 'boolean' && b.canCreate !== !!target.canCreate ? (b.canCreate ? ' · peut créer des campagnes' : ' · ne peut plus créer de campagne') : '';
    note(ctx, acc, 'Compte modifié', `${target.name}${next.name !== target.name ? ` → ${next.name}` : ''}${what}`);
    return { account: publicAccount(next) };
  });

  router.post('/api/admin/accounts/:id/reset', ctx => {
    const acc = guard.admin(ctx);
    const target = db.getAccount(ctx.params.id);
    if (!target) throw new HttpError(404, 'Compte introuvable');
    const pin = tempPin();
    db.putAccount({ ...target, pinHash: hashPin(pin), mustChange: true, secretKind: 'pin' });
    const a = ctx.auth();
    db.deleteAccountSessions(target.id, target.id === acc.id ? a.token : '');
    S.kick(c => c.accountId === target.id && c.token !== a.token, 'Mot de passe réinitialisé par l\'admin');
    note(ctx, acc, 'Mot de passe réinitialisé', target.name);
    return { pin, login: target.login };
  });

  router.delete('/api/admin/accounts/:id', ctx => {
    const acc = guard.admin(ctx);
    const target = db.getAccount(ctx.params.id);
    if (!target) throw new HttpError(404, 'Compte introuvable');
    if (target.id === acc.id) throw new HttpError(400, 'Impossible de supprimer ton propre compte');
    const solo = campaigns.campaignsOf(target.id).filter(m => m.role === 'dm' && !db.membersOf(m.campaign.id).some(x => x.role === 'dm' && x.accountId !== target.id));
    if (solo.length) throw new HttpError(400, 'Ce compte est le seul MJ de : {list}. Donne d\'abord ce rôle à quelqu\'un d\'autre', { list: solo.map(m => m.campaign.name).join(', ') });
    S.kick(c => c.accountId === target.id, 'Compte supprimé');
    for (const c of engine.charsOwnedBy(target.id)) engine.setOwner(c.id, null);
    db.deleteAccount(target.id);
    note(ctx, acc, 'Compte supprimé', target.name);
    return { ok: true };
  });

  // ------------------------------------------------------------ Campagnes

  // Réparation : donner le rôle de MJ titulaire à un compte (MJ parti, campagne orpheline).
  router.post('/api/admin/campaigns/:cid/owner', async ctx => {
    const acc = guard.admin(ctx);
    const cid = ctx.params.cid;
    campaigns.must(cid);
    const b = await ctx.body();
    const target = db.getAccount(String(b.accountId || ''));
    if (!target) throw new HttpError(404, 'Compte introuvable');
    campaigns.setRole(cid, target.id, 'dm');
    S.hub.refresh(c => c.campaign === cid);
    note(ctx, acc, 'MJ de campagne changé', `${campaigns.get(cid).name} · ${target.name}`);
    return { ok: true };
  });

  router.post('/api/admin/campaigns/:cid/bridge', async ctx => {
    const acc = guard.admin(ctx);
    const cid = ctx.params.cid;
    campaigns.must(cid);
    const b = await ctx.body();
    const bridge = normalizeBridge(b.bridge);
    // Un coffre ne sert qu'à une campagne : deux campagnes dans le même dossier, c'est le mélange à éviter.
    if (bridge) {
      const clash = campaigns.list().find(c => c.id !== cid && c.bridge && path.resolve(c.bridge.vaultDir) === bridge.vaultDir);
      if (clash) throw new HttpError(400, 'Ce coffre est déjà relié à la campagne « {name} »', { name: clash.name });
    }
    campaigns.setBridge(cid, bridge);
    S.resetBridge(cid);
    note(ctx, acc, bridge ? 'Pont vers un coffre réglé' : 'Pont vers un coffre retiré', `${campaigns.get(cid).name}${bridge ? ` · ${bridge.vaultDir}` : ''}`);
    return { bridge };
  });

  router.delete('/api/admin/campaigns/:cid', async ctx => {
    const acc = guard.admin(ctx);
    const c = campaigns.must(ctx.params.cid);
    const b = await ctx.body();
    if (String(b.confirm || '').trim() !== c.name) throw new HttpError(400, 'Écris le nom exact de la campagne pour confirmer');
    S.deleteCampaign(c.id);
    note(ctx, acc, 'Campagne supprimée', c.name);
    return { ok: true };
  });

  // ------------------------------------------------------------ Serveur

  router.get('/api/admin/audit', ctx => {
    guard.admin(ctx);
    const kinds = ctx.query('kinds').split(',').filter(k => Object.hasOwn(AUDIT_KINDS, k));
    // Le journal du serveur : connexions et actions d'admin, pas le contenu des campagnes.
    return { entries: db.listAudit({ campaign: null, kinds, before: ctx.query('before') || null, q: ctx.query('q').slice(0, 60), limit: Number(ctx.query('limit')) || 200 }), kinds: AUDIT_KINDS };
  });

  router.post('/api/admin/fetch5e', async ctx => {
    const acc = guard.admin(ctx);
    if (!fetching5e) fetching5e = fetch5eTools(resolveFromApp(cfg.fiveEToolsDir)).finally(() => { fetching5e = null; });
    const r = await fetching5e;
    data5e.load();
    data5e.buildHeadingsLater();
    note(ctx, acc, 'Mise à jour 5etools', String(r.downloaded));
    return { ...r, status: data5e.status() };
  });

  router.post('/api/admin/reload5e', ctx => {
    guard.admin(ctx);
    data5e.load();
    data5e.buildHeadingsLater();
    return data5e.status();
  });

  router.post('/api/admin/backup', ctx => {
    const acc = guard.admin(ctx);
    engine.flush();
    S.map.flush();
    const file = dailyBackup(db, S.backupDir, { keep: cfg.backupKeepDays, force: true });
    note(ctx, acc, 'Sauvegarde manuelle', path.basename(file || ''));
    return { file };
  });

  router.post('/api/admin/library/reload', ctx => {
    guard.admin(ctx);
    S.map.tokens.load();
    return { count: S.map.tokens.list.length };
  });
}
