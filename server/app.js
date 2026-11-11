// Serveur HTTP + WebSocket : assemble la base, le moteur des fiches, les campagnes, la carte,
// les mondes, les fichiers et les routes.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { APP_DIR, resolveFromApp } from './config.js';
import { ActionError } from '../shared/actions.js';
import { SceneError } from '../shared/map/scene.js';
import { tl, normLang } from '../shared/i18n.js';
import { HttpError, Router, send, readBody, readRaw, parseCookies, within, serveFile } from './http.js';
import { checkPin, hashPin } from './accounts.js';
import { Campaigns, isDmRole } from './campaigns.js';
import { AssetStore, Library } from './assets.js';
import { createAudit } from './audit.js';
import { createMapServer } from './map/index.js';
import { Worlds } from './worlds.js';
import { WorldError } from './world.js';
import { createBridge } from './bridge.js';
import { createSheetHub } from './ws.js';
import { registerAuth } from './routes/auth.js';
import { registerCampaigns } from './routes/campaigns.js';
import { registerContent } from './routes/content.js';
import { registerAdmin } from './routes/admin.js';
import { register5e } from './routes/data5e.js';

const PUBLIC = path.join(APP_DIR, 'public');
const SHARED = path.join(APP_DIR, 'shared');
const VENDOR = {
  'preact.mjs': 'node_modules/preact/dist/preact.module.js',
  'hooks.mjs': 'node_modules/preact/hooks/dist/hooks.module.js',
  'htm.mjs': 'node_modules/htm/dist/htm.module.js',
};
export const SESSION_DAYS = 60;
export const COOKIE = 'dndt';
// Une vérification factice quand l'identifiant n'existe pas : même durée de réponse.
export const DUMMY_HASH = hashPin('0000000000');

// Pages de l'application : une coquille HTML par outil, la campagne est dans l'adresse.
const PAGES = [
  [/^\/c\/[\w-]+\/carte\/tv\/?$/, 'tv.html'],
  [/^\/c\/[\w-]+\/carte\/?$/, 'carte.html'],
  [/^\/c\/[\w-]+\/monde\/?$/, 'monde.html'],
];

export function createApp({ engine, db, cfg, data5e }) {
  const attempts = new Map();
  const audit = createAudit(db);
  const campaigns = new Campaigns(db);
  const dataDir = resolveFromApp(cfg.dataDir);
  const filesDir = path.join(dataDir, 'files');
  const backupDir = resolveFromApp(cfg.backupDir);
  const assets = new AssetStore(db, filesDir, { maxBytes: cfg.maxUploadBytes, quotaBytes: cfg.campaignQuotaBytes });
  const library = new Library(cfg.libraryDir ? resolveFromApp(cfg.libraryDir) : null);
  engine.settingsOf = cid => campaigns.settings(cid);
  db.pruneSessions(Date.now() - SESSION_DAYS * 86_400_000);
  if (db.getSetting('signup') == null) db.setSetting('signup', cfg.signup || 'invite');

  // Ponts vers un coffre : construits à la demande, oubliés quand l'admin les change.
  const bridgeCache = new Map();
  function bridgeOf(cid) {
    if (bridgeCache.has(cid)) return bridgeCache.get(cid);
    const c = db.getCampaign(cid);
    const b = c?.bridge ? createBridge(c.bridge, { db, backupDir }) : null;
    bridgeCache.set(cid, b);
    return b;
  }
  const worlds = new Worlds(db, filesDir, { bridgeOf });
  function resetBridge(cid) { bridgeCache.delete(cid); worlds.forget(cid); }

  // ------------------------------------------------------------ Authentification

  // Le compte derrière un jeton de session, ou null.
  function accountOfToken(token) {
    if (!token || String(token).startsWith('dt_')) return null;
    const s = db.getSession(String(token));
    if (!s?.account_id) return null;
    return db.getAccount(s.account_id);
  }

  function resolveAuth(req) {
    const h = req.headers.authorization || '';
    let token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
    let viaCookie = false;
    if (!token) {
      // Le cookie ne sert qu'aux lectures (images dans une balise <img>) : jamais à une écriture.
      if (req.method !== 'GET' && req.method !== 'HEAD') return null;
      token = parseCookies(req)[COOKIE] || null;
      viaCookie = true;
    }
    if (!token) return null;
    if (token.startsWith('dt_')) {
      if (viaCookie) return null;
      const t = campaigns.tokenAuth(token);
      return t ? { kind: 'api', apiToken: t, account: { id: null, name: `API · ${t.label}`, isAdmin: false } } : null;
    }
    const account = accountOfToken(token);
    return account ? { kind: 'session', token, account } : null;
  }

  function clientIp(req) {
    const remote = req.socket.remoteAddress || '';
    const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    const fwd = req.headers['x-forwarded-for'];
    if (cfg.trustProxy !== false && loopback && fwd) return String(fwd).split(',').pop().trim();
    return remote;
  }

  function rateLimit(ip, id, max = 8) {
    const k = `${ip}|${id}`;
    const now = Date.now();
    const a = attempts.get(k);
    if (!a || now - a.first > 5 * 60_000) { attempts.set(k, { count: 1, first: now }); return; }
    a.count++;
    if (a.count > max) throw new HttpError(429, 'Trop de tentatives : réessaie dans quelques minutes');
  }
  const clearRate = (ip, id) => attempts.delete(`${ip}|${id}`);

  // Les gardes : chacune rend ce qu'il faut savoir de la personne, ou lève une erreur.
  const guard = {
    session(ctx) {
      const a = ctx.auth();
      if (!a || a.kind !== 'session') throw new HttpError(401, 'Non connecté');
      return a.account;
    },
    user(ctx) {
      const acc = guard.session(ctx);
      if (acc.mustChange) throw new HttpError(403, 'Choisis d\'abord ton mot de passe');
      return acc;
    },
    admin(ctx) {
      const acc = guard.user(ctx);
      if (!acc.isAdmin) throw new HttpError(403, 'Réservé à l\'admin');
      return acc;
    },
    // Membre de la campagne de l'adresse. Un jeton d'API vaut MJ, pour sa campagne seulement.
    member(ctx, cid = ctx.params.cid) {
      campaigns.must(cid);
      const a = ctx.auth();
      if (!a) throw new HttpError(401, 'Non connecté');
      if (a.kind === 'api') {
        if (a.apiToken.campaign_id !== cid) throw new HttpError(403, 'Ce jeton ne vaut que pour sa campagne');
        return { id: null, name: a.account.name, role: 'dm', api: true, account: a.account };
      }
      const acc = guard.user(ctx);
      const role = campaigns.role(acc.id, cid);
      if (!role) throw new HttpError(403, 'Tu ne fais pas partie de cette campagne');
      return { id: acc.id, name: acc.name, role, account: acc };
    },
    dm(ctx, cid = ctx.params.cid) {
      const m = guard.member(ctx, cid);
      if (!isDmRole(m.role)) throw new HttpError(403, 'Réservé au MJ de la campagne');
      return m;
    },
    owner(ctx, cid = ctx.params.cid) {
      const m = guard.member(ctx, cid);
      if (m.role !== 'dm') throw new HttpError(403, 'Réservé au MJ titulaire de la campagne');
      return m;
    },
  };

  function cookieFor(token, maxAge = SESSION_DAYS * 86_400) {
    const secure = cfg.https || String(cfg.publicUrl || '').startsWith('https:') ? '; Secure' : '';
    return `${COOKIE}=${token ? encodeURIComponent(token) : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? maxAge : 0}${secure}`;
  }

  function newSession(account) {
    const token = crypto.randomBytes(24).toString('hex');
    db.addSession(token, account.id);
    return token;
  }

  function joinUrl(pathname = '/') {
    const base = cfg.publicUrl || `http://localhost:${cfg.port}`;
    return new URL(pathname, base).toString();
  }

  // ------------------------------------------------------------ Assemblage

  const router = new Router();
  const shared = {
    db, engine, cfg, data5e, campaigns, assets, library, worlds, audit, guard, router,
    bridgeOf, resetBridge, rateLimit, clearRate, newSession, cookieFor, joinUrl, accountOfToken,
    checkPin, dummyHash: DUMMY_HASH, backupDir, dataDir,
    kick: () => {}, // remplacé plus bas, une fois le canal des fiches créé
  };

  const map = createMapServer({ db, engine, campaigns, assets, library, cfg, audit, authToken: accountOfToken, router, guard });
  const hub = createSheetHub({ engine, db, campaigns, audit, accountOfToken });
  shared.map = map;
  shared.hub = hub;
  // Fermer les connexions d'un compte (secret changé, compte supprimé, rôle retiré…).
  shared.kick = (predicate, reason) => { hub.kick(predicate, reason); map.kick(predicate, reason); };

  registerAuth(shared);
  registerCampaigns(shared);
  registerContent(shared);
  registerAdmin(shared);
  register5e(shared);

  // ------------------------------------------------------------ HTTP

  function errorStatus(e) {
    if (e instanceof HttpError || e instanceof WorldError) return e.status;
    if (e instanceof ActionError || e instanceof SceneError) return 400;
    return 500;
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://local');
    let authCache;
    const ctx = {
      req, res, url, params: {}, ip: clientIp(req),
      lang: normLang(req.headers['x-lang'] || 'fr'),
      query: k => url.searchParams.get(k) || '',
      body: (limit = 5_000_000) => readBody(req, limit),
      raw: limit => readRaw(req, limit),
      auth: () => (authCache === undefined ? (authCache = resolveAuth(req)) : authCache),
    };
    try {
      if (url.pathname.startsWith('/api/')) {
        const m = router.match(req.method, url.pathname);
        if (!m) throw new HttpError(404, 'Route inconnue');
        if (m.methodNotAllowed) throw new HttpError(405, 'Méthode non autorisée');
        ctx.params = m.params;
        const out = await m.handler(ctx);
        if (out !== undefined && !res.headersSent) send(res, 200, out);
        return undefined;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée');
      for (const [re, file] of PAGES) if (re.test(url.pathname)) return serveFile(req, res, path.join(PUBLIC, file));
      if (url.pathname.startsWith('/vendor/')) {
        const rel = VENDOR[url.pathname.slice(8)];
        if (!rel) throw new HttpError(404, 'Introuvable');
        // Les modules Preact importent « preact » : on réécrit vers nos URLs.
        return serveFile(req, res, path.join(APP_DIR, rel), { rewrite: t => t.replace(/from\s*"preact"/g, 'from"/vendor/preact.mjs"').replace(/from\s*'preact'/g, "from'/vendor/preact.mjs'") });
      }
      if (url.pathname.startsWith('/shared/')) {
        const f = within(SHARED, url.pathname.slice(8));
        if (!f) throw new HttpError(404, 'Introuvable');
        return serveFile(req, res, f);
      }
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const f = within(PUBLIC, rel);
      if (!f) throw new HttpError(404, 'Introuvable');
      // Toute autre adresse sans extension (/, /c/…, /admin, /invite/…) ouvre l'application.
      if (!fs.existsSync(f) && !path.extname(f)) return serveFile(req, res, path.join(PUBLIC, 'index.html'));
      return serveFile(req, res, f);
    } catch (e) {
      const status = errorStatus(e);
      if (status === 500) console.error(e);
      const msg = status === 500 && !(e instanceof HttpError) ? 'Erreur serveur' : e.message || 'Erreur';
      return send(res, status, { error: tl(ctx.lang, msg, e.vars) });
    }
  }

  const server = cfg.https
    ? https.createServer({ cert: fs.readFileSync(resolveFromApp(cfg.https.cert)), key: fs.readFileSync(resolveFromApp(cfg.https.key)) }, handler)
    : http.createServer(handler);

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://local');
    if (pathname === '/ws') hub.upgrade(req, socket, head, clientIp(req));
    else if (pathname === '/ws/map') map.upgrade(req, socket, head);
    else socket.destroy();
  });
  server.on('close', () => { hub.close(); map.close(); });

  return { server, map, hub, audit, campaigns, assets, worlds, bridgeOf, router };
}

export { send };
