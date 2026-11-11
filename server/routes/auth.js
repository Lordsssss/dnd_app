// Comptes : connexion, inscription, invitation, secret, profil, récupération.
import { HttpError, send } from '../http.js';
import { qrSvg } from '../lan.js';
import {
  hashPin, loginKey, newAccountId, normalizeRecovery, publicAccount, recoveryCode, secretKindOf, secretProblem, uniqueLogin,
} from '../accounts.js';
import { classSummary } from '../../shared/model.js';
import { totalLevel } from '../../shared/rules.js';
import { LANGS, normLang } from '../../shared/i18n.js';

export function registerAuth(S) {
  const { router, db, engine, campaigns, audit, guard, rateLimit, clearRate, newSession, cookieFor, checkPin, dummyHash, joinUrl } = S;

  const signupMode = () => db.getSetting('signup', 'invite');

  // Ce que la page d'accueil montre : le compte, ses campagnes et ses fiches dans chacune.
  function meOf(account) {
    const list = campaigns.campaignsOf(account.id).map(({ campaign: c, role }) => {
      const chars = engine.charsIn(c.id);
      const mine = chars.filter(x => x.owner === account.id);
      return {
        id: c.id, name: c.name, description: c.description, role,
        members: db.membersOf(c.id).length,
        chars: chars.length,
        mine: mine.map(x => ({ id: x.id, name: x.data.name || 'Sans nom', cls: classSummary(x.data), level: totalLevel(x.data) })),
        bridge: !!c.bridge,
      };
    }).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return { account: publicAccount(account), campaigns: list, signup: signupMode() };
  }
  S.meOf = meOf;

  function loginResponse(ctx, account, extra = {}) {
    const token = newSession(account);
    db.putAccount({ ...account, lastLogin: Date.now() });
    send(ctx.res, 200, { token, ...meOf(account), ...extra }, 'application/json; charset=utf-8', { 'Set-Cookie': cookieFor(token) });
  }

  router.get('/api/config/public', () => ({ signup: signupMode(), langs: LANGS }));

  router.post('/api/login', async ctx => {
    const body = await ctx.body();
    const login = loginKey(body.login);
    const secret = body.secret ?? body.pin;
    rateLimit(ctx.ip, login);
    const acc = login ? db.getAccountByLogin(login) : null;
    const ok = checkPin(secret, acc ? acc.pinHash : dummyHash) && !!acc;
    if (!ok) {
      audit.log({ kind: 'auth', action: 'Échec de connexion', detail: `identifiant « ${String(body.login || '').slice(0, 40)} »`, ip: ctx.ip });
      throw new HttpError(403, 'Identifiant ou mot de passe incorrect');
    }
    clearRate(ctx.ip, login);
    audit.log({ kind: 'auth', action: acc.mustChange ? 'Première connexion' : 'Connexion', account: acc.name, ip: ctx.ip });
    loginResponse(ctx, acc);
  });

  router.post('/api/logout', ctx => {
    const a = ctx.auth();
    if (a?.kind === 'session') {
      db.deleteSession(a.token);
      audit.log({ kind: 'auth', action: 'Déconnexion', account: a.account.name, ip: ctx.ip });
    }
    send(ctx.res, 200, { ok: true }, 'application/json; charset=utf-8', { 'Set-Cookie': cookieFor(null) });
  });

  router.get('/api/me', ctx => meOf(guard.session(ctx)));

  // Inscription : ouverte, ou sur invitation selon le réglage de l'admin.
  router.post('/api/signup', async ctx => {
    const b = await ctx.body();
    rateLimit(ctx.ip, 'signup', 5);
    const mode = signupMode();
    const invite = b.invite ? campaigns.invite(b.invite) : null;
    if (b.invite && !invite) throw new HttpError(404, 'Invitation expirée ou inconnue');
    if (mode === 'closed' || (mode === 'invite' && !invite)) throw new HttpError(403, 'Les inscriptions se font sur invitation d\'un MJ');
    const name = String(b.name || '').trim().slice(0, 40);
    if (!name) throw new HttpError(400, 'Nom obligatoire');
    const login = loginKey(b.login || name);
    if (login.length < 3) throw new HttpError(400, 'Identifiant de 3 caractères ou plus : lettres, chiffres, point, tiret');
    if (db.getAccountByLogin(login)) throw new HttpError(400, 'L\'identifiant « {login} » est déjà pris', { login });
    const problem = secretProblem(b.secret);
    if (problem) throw new HttpError(400, problem);
    const recovery = recoveryCode();
    const acc = {
      id: newAccountId(), login, name, pinHash: hashPin(b.secret), mustChange: false, isAdmin: false,
      lang: normLang(b.lang || ctx.lang), secretKind: 'password', recoveryHash: hashPin(normalizeRecovery(recovery)),
    };
    db.putAccount(acc);
    let joined = null;
    if (invite) joined = campaigns.acceptInvite(invite.code, acc.id);
    audit.log({ kind: 'auth', action: 'Inscription', account: name, detail: joined ? `invitation · ${campaigns.get(joined.campaign)?.name}` : '', ip: ctx.ip });
    loginResponse(ctx, db.getAccount(acc.id), { recovery, joined });
  });

  // Mot de passe oublié : le code de récupération montré à l'inscription.
  router.post('/api/recover', async ctx => {
    const b = await ctx.body();
    const login = loginKey(b.login);
    rateLimit(ctx.ip, `recover|${login}`, 5);
    const acc = login ? db.getAccountByLogin(login) : null;
    const ok = acc?.recoveryHash && checkPin(normalizeRecovery(b.code), acc.recoveryHash);
    if (!ok) throw new HttpError(403, 'Identifiant ou code de récupération incorrect');
    const problem = secretProblem(b.secret);
    if (problem) throw new HttpError(400, problem);
    const recovery = recoveryCode();
    const next = { ...acc, pinHash: hashPin(b.secret), mustChange: false, secretKind: 'password', recoveryHash: hashPin(normalizeRecovery(recovery)) };
    db.putAccount(next);
    db.deleteAccountSessions(acc.id);
    S.kick(c => c.accountId === acc.id, 'Mot de passe changé : reconnecte-toi');
    audit.log({ kind: 'auth', action: 'Récupération du compte', account: acc.name, ip: ctx.ip });
    loginResponse(ctx, next, { recovery });
  });

  router.post('/api/account/secret', async ctx => {
    const a = ctx.auth();
    const acc = guard.session(ctx);
    const body = await ctx.body();
    if (!acc.mustChange) {
      rateLimit(ctx.ip, `secret|${acc.id}`);
      if (!checkPin(body.current, acc.pinHash)) {
        audit.log({ kind: 'auth', action: 'Changement de mot de passe refusé', account: acc.name, detail: 'secret actuel incorrect', ip: ctx.ip });
        throw new HttpError(403, 'Mot de passe actuel incorrect');
      }
    }
    const secret = String(body.secret ?? body.pin ?? '');
    const problem = secretProblem(secret, { allowPin: acc.secretKind === 'pin' });
    if (problem) throw new HttpError(400, problem);
    if (checkPin(secret, acc.pinHash)) throw new HttpError(400, 'Choisis un mot de passe différent de l\'actuel');
    const next = { ...acc, pinHash: hashPin(secret), mustChange: false, secretKind: secretKindOf(secret) };
    let recovery = null;
    if (!next.recoveryHash) { recovery = recoveryCode(); next.recoveryHash = hashPin(normalizeRecovery(recovery)); }
    db.putAccount(next);
    db.deleteAccountSessions(acc.id, a.token);
    S.kick(c => c.accountId === acc.id && c.token !== a.token, 'Mot de passe changé : reconnecte-toi');
    audit.log({ kind: 'auth', action: acc.mustChange ? 'Mot de passe choisi' : 'Mot de passe changé', account: acc.name, ip: ctx.ip });
    return { ...meOf(next), recovery };
  });

  router.post('/api/account/recovery', async ctx => {
    const acc = guard.user(ctx);
    const body = await ctx.body();
    rateLimit(ctx.ip, `secret|${acc.id}`);
    if (!checkPin(body.current, acc.pinHash)) throw new HttpError(403, 'Mot de passe actuel incorrect');
    const recovery = recoveryCode();
    db.putAccount({ ...acc, recoveryHash: hashPin(normalizeRecovery(recovery)) });
    audit.log({ kind: 'auth', action: 'Nouveau code de récupération', account: acc.name, ip: ctx.ip });
    return { recovery };
  });

  router.post('/api/account/profile', async ctx => {
    const acc = guard.session(ctx);
    const b = await ctx.body();
    const next = { ...acc };
    if (typeof b.name === 'string' && b.name.trim()) next.name = b.name.trim().slice(0, 40);
    if (typeof b.lang === 'string') next.lang = normLang(b.lang);
    db.putAccount(next);
    return meOf(next);
  });

  // ------------------------------------------------------------ Invitations

  router.get('/api/invite/:code', ctx => {
    const i = campaigns.invite(ctx.params.code);
    if (!i) throw new HttpError(404, 'Invitation expirée ou inconnue');
    const c = campaigns.get(i.campaign_id);
    return { campaign: { id: c.id, name: c.name, description: c.description }, role: i.role, signup: signupMode() };
  });

  router.post('/api/invite/:code/accept', ctx => {
    const acc = guard.user(ctx);
    const r = campaigns.acceptInvite(ctx.params.code, acc.id);
    audit.log({ kind: 'dm', campaign: r.campaign, action: 'Invitation acceptée', account: acc.name, detail: r.role, ip: ctx.ip });
    S.hub.refresh(c => c.accountId === acc.id && c.campaign === r.campaign);
    return { ...r, me: meOf(acc) };
  });

  // QR code d'une adresse de cette application (lien d'invitation, page d'accueil).
  router.get('/api/qr.svg', ctx => {
    guard.user(ctx);
    const p = ctx.query('path') || '/';
    if (!p.startsWith('/')) throw new HttpError(400, 'Adresse invalide');
    return send(ctx.res, 200, qrSvg(joinUrl(p)), 'image/svg+xml');
  });
}
