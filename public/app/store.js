// État client, routes et synchronisation WebSocket (reconnexion et resynchro automatiques).
// La campagne ouverte est dans l'adresse : /c/<id>. La page d'accueil (/) liste les campagnes.
import { applyPatch, pathKey, startsWith } from '/shared/patch.js';
import { DEFAULT_CURRENCY } from '/shared/rules.js';
import { setLang, getLang, normLang, t, tx } from '/shared/i18n.js';

export const LS = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};

// ---------------------------------------------------------------- Routes

export function parseRoute(pathname = location.pathname) {
  let m;
  if ((m = /^\/c\/([\w-]+)\/mj\/?(\w+)?\/?$/.exec(pathname))) return { name: 'dm', cid: m[1], tab: m[2] || 'members' };
  if ((m = /^\/c\/([\w-]+)\/?$/.exec(pathname))) return { name: 'campaign', cid: m[1] };
  if ((m = /^\/invite\/([\w-]+)\/?$/.exec(pathname))) return { name: 'invite', code: m[1] };
  if (/^\/admin\/?$/.test(pathname)) return { name: 'admin' };
  return { name: 'home' };
}

setLang(LS.get('lang', navigator.language?.startsWith('fr') ? 'fr' : 'en'));

export const store = {
  token: LS.get('token'),
  account: null,
  campaigns: [],
  signup: 'invite',
  route: parseRoute(),
  me: null,
  chars: {},
  owners: {},
  party: { v: 0, data: { stash: {}, fund: {}, log: {} } },
  rolls: [],
  stacks: {},
  config: { currency: DEFAULT_CURRENCY, coinWeight: true, rules: {}, campaign: null },
  conn: 'offline',
  ready: false,
  denied: null,
  view: { charId: null, page: LS.get('page', 'main') },
  ui: {
    theme: LS.get('theme', null),
    fit: LS.get('fit', 'width'),
    rollMode: null,
    logOpen: false,
    modal: null,
    pencil: { on: false, color: 'k', tool: 'pen' },
  },
  toasts: [],
  lastRoll: null,
  lang: getLang(),
};

// ---------------------------------------------------------------- Abonnements

const subs = new Set();
let scheduled = false;
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function notify() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => { scheduled = false; for (const fn of subs) fn(); });
}

export function setUi(patch) { Object.assign(store.ui, patch); notify(); }
export function setView(patch) {
  Object.assign(store.view, patch);
  if (patch.page) LS.set('page', patch.page);
  notify();
}
export function setTheme(th) {
  store.ui.theme = th;
  LS.set('theme', th);
  if (th) document.documentElement.setAttribute('data-theme', th);
  else document.documentElement.removeAttribute('data-theme');
  notify();
}
export function setFit(f) { store.ui.fit = f; LS.set('fit', f); notify(); }
export function openModal(modal) { store.ui.modal = modal; notify(); }
export function closeModal() { store.ui.modal = null; notify(); }

export function changeLang(l) {
  const lang = setLang(normLang(l));
  store.lang = lang;
  LS.set('lang', lang);
  document.documentElement.lang = lang;
  if (store.token && store.account) api('/api/account/profile', { method: 'POST', body: { lang } }).catch(() => {});
  // Les messages du serveur (actions, erreurs) suivent la langue à la prochaine connexion.
  if (ws) connect();
  notify();
}

let toastSeq = 0;
export function toast(text, opts = {}) {
  if (!text) return;
  const tt = { id: ++toastSeq, text: tx(text), kind: opts.kind || 'info', action: opts.action || null, ms: opts.ms || (opts.action ? 7000 : 3500) };
  store.toasts = [...store.toasts.slice(-3), tt];
  notify();
  setTimeout(() => { store.toasts = store.toasts.filter(x => x.id !== tt.id); notify(); }, tt.ms);
}
export function dismissToast(id) { store.toasts = store.toasts.filter(x => x.id !== id); notify(); }

// ---------------------------------------------------------------- Navigation

export function navigate(path, { replace = false } = {}) {
  if (path !== location.pathname) history[replace ? 'replaceState' : 'pushState'](null, '', path);
  onRoute();
}

function onRoute() {
  const prev = store.route;
  store.route = parseRoute();
  closeModal();
  const prevCid = prev?.name === 'campaign' ? prev.cid : null;
  const cid = store.route.name === 'campaign' ? store.route.cid : null;
  if (cid !== prevCid) {
    disconnect();
    store.denied = null;
    if (cid && store.account && !store.account.mustChange) connect();
  }
  if (store.route.name === 'home' && store.account) refreshMe();
  notify();
}
if (typeof window !== 'undefined') window.addEventListener('popstate', onRoute);

// Les liens internes changent de page sans recharger.
export function linkClick(e) {
  const a = e.currentTarget;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
}

// ---------------------------------------------------------------- Accès

export const currentCampaign = () => (store.route.name === 'campaign' || store.route.name === 'dm' ? store.route.cid : null);
export const isDm = () => store.me?.role === 'dm';
export function myCharId() { return store.me?.charId || null; }
// Celui qui agit dans un dialogue de groupe : la fiche jouée, ou, pour le MJ, la fiche affichée.
export function actorId() { return myCharId() || (isDm() ? store.view.charId : null); }
export function canEdit(charId) {
  if (!charId || !store.chars[charId]) return false;
  return isDm() || myCharId() === charId;
}
export const canPartyAct = () => isDm() || !!myCharId();
export function charDoc(id) { return store.chars[id]?.data || null; }
export function charIds() {
  return Object.keys(store.chars).sort((a, b) => {
    if (a === myCharId()) return -1;
    if (b === myCharId()) return 1;
    return (Number(store.chars[a].data.meta?.createdAt) || 0) - (Number(store.chars[b].data.meta?.createdAt) || 0)
      || String(store.chars[a].data.name).localeCompare(String(store.chars[b].data.name));
  });
}
// Les fiches de ce compte dans la campagne, qu'il peut « jouer ».
export const mineIds = () => store.me?.mine || [];

// ---------------------------------------------------------------- WebSocket

let ws = null;
let seq = 0;
let retry = 0;
let reconnectTimer = null;
const waiting = new Map();
const pendingPaths = new Map();
let outbox = [];

const playKey = cid => `play:${cid}`;

function wsUrl() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

function disconnect() {
  clearTimeout(reconnectTimer);
  const s = ws;
  ws = null;
  try { s?.close(); } catch { /* déjà fermé */ }
  store.conn = 'offline';
  store.ready = false;
  store.me = null;
  store.chars = {};
  store.stacks = {};
  outbox = [];
  waiting.clear();
  pendingPaths.clear();
}

export function connect() {
  const cid = currentCampaign();
  if (!store.token || !cid || store.route.name !== 'campaign') return;
  clearTimeout(reconnectTimer);
  try { ws?.close(); } catch { /* déjà fermé */ }
  store.conn = 'connecting';
  notify();
  const sock = new WebSocket(wsUrl());
  ws = sock;
  sock.onopen = () => { retry = 0; sock.send(JSON.stringify({ t: 'hello', token: store.token, campaign: cid, play: LS.get(playKey(cid)), lang: getLang() })); };
  sock.onmessage = ev => { if (ws === sock) onMessage(JSON.parse(ev.data)); };
  sock.onclose = () => {
    if (ws !== sock) return;
    store.conn = 'offline';
    for (const [, w] of waiting) w.resolve({ ok: false, error: t('Connexion perdue'), lost: true });
    waiting.clear();
    pendingPaths.clear();
    notify();
    if (store.token && !store.denied) {
      const delay = Math.min(8000, 500 * 2 ** retry++);
      reconnectTimer = setTimeout(connect, delay);
    }
  };
  sock.onerror = () => { /* onclose suit */ };
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { if (store.conn === 'offline') connect(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && store.conn === 'offline' && store.token) connect();
  });
  setInterval(() => { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'ping' })); }, 25_000);
}

function rawSend(msg) {
  if (ws?.readyState === 1 && store.conn === 'online') { ws.send(JSON.stringify(msg)); return true; }
  return false;
}

function request(msg) {
  msg.id = ++seq;
  return new Promise(resolve => {
    if (rawSend(msg)) waiting.set(msg.id, { resolve, msg });
    else { outbox.push(msg); resolve({ ok: true, queued: true }); }
  });
}

function isParty(docId) { return docId === store.party?.id; }

function applyLocal(docId, ops) {
  const entry = isParty(docId) ? store.party : store.chars[docId];
  if (!entry) return;
  for (const op of ops) applyPatch(entry.data, op);
}

function trackPending(msg) {
  pendingPaths.set(msg.id, msg.ops.map(([path]) => ({ doc: msg.doc, path, key: pathKey(path) })));
}

function blockedByPending(docId, path) {
  for (const list of pendingPaths.values()) {
    for (const p of list) if (p.doc === docId && startsWith(path, p.path)) return true;
  }
  return false;
}

function flushOutbox() {
  const q = outbox;
  outbox = [];
  for (const msg of q) {
    if (msg.t === 'set') { applyLocal(msg.doc, msg.ops); trackPending(msg); }
    if (rawSend(msg)) waiting.set(msg.id, { resolve: () => {}, msg });
  }
}

function onMessage(m) {
  switch (m.t) {
    case 'welcome': {
      store.me = m.me;
      const c = m.config.campaign;
      store.config = { ...store.config, campaign: c, currency: c.settings.currency, coinWeight: c.settings.coinWeight !== false, rules: c.settings.rules || {}, edition: c.settings.edition, secretDeathSaves: !!c.settings.secretDeathSaves };
      loadState(m.state);
      store.rolls = m.rolls || [];
      store.stacks = m.stacks || {};
      store.conn = 'online';
      store.ready = true;
      store.denied = null;
      if (!store.view.charId || !store.chars[store.view.charId]) store.view.charId = m.me.charId || charIds()[0] || null;
      flushOutbox();
      notify();
      break;
    }
    case 'state': loadState(m.state); notify(); break;
    case 'patch': {
      const entry = isParty(m.doc) ? store.party : store.chars[m.doc];
      if (!entry) { requestSync(); break; }
      if (m.v !== entry.v + 1) { requestSync(); break; }
      entry.v = m.v;
      if (m.mine && m.k === 'set') pendingPaths.delete(m.id);
      else for (const p of m.p) if (!blockedByPending(m.doc, p[0])) applyPatch(entry.data, p);
      notify();
      break;
    }
    case 'ack': {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      if (!m.ok) {
        if (w?.msg.t === 'set') { pendingPaths.delete(m.id); requestSync(); }
        if (!w || w.msg.t !== 'roll') toast(m.error || t('Action refusée'), { kind: 'error' });
      }
      w?.resolve(m);
      break;
    }
    case 'stacks': store.stacks = { ...store.stacks, [m.doc]: m.stacks }; notify(); break;
    case 'doc':
      store.chars[m.doc] = { v: m.v, data: m.data, owner: m.owner };
      if (m.me) store.me = { ...store.me, ...m.me };
      if (!store.view.charId) store.view.charId = m.doc;
      notify();
      break;
    case 'docDeleted':
      delete store.chars[m.doc];
      if (store.me?.charId === m.doc) store.me = { ...store.me, charId: null, mine: (store.me.mine || []).filter(x => x !== m.doc) };
      if (store.view.charId === m.doc) store.view.charId = charIds()[0] || null;
      notify();
      break;
    case 'roll':
      store.rolls = [...store.rolls.slice(-199), m.roll];
      notify();
      break;
    case 'reconnect': store.ready = false; notify(); break;
    case 'denied':
      store.denied = m.reason;
      store.ready = false;
      notify();
      break;
    case 'logout': logout(m.reason); break;
    case 'mustChange':
      if (store.account) store.account = { ...store.account, mustChange: true };
      store.ready = false;
      ws = null;
      notify();
      break;
    default: break;
  }
}

function loadState(state) {
  store.chars = state.chars;
  store.party = state.party;
  pendingPaths.clear();
}

function requestSync() { rawSend({ t: 'sync' }); }

// Jouer une autre de ses fiches dans cette campagne.
export function playChar(charId) {
  const cid = currentCampaign();
  LS.set(playKey(cid), charId);
  store.view.charId = charId;
  store.ready = false;
  connect();
}

// ---------------------------------------------------------------- Écritures

export function setPath(docId, path, value) {
  return setOps(docId, [value === undefined ? [path] : [path, value]]);
}

export function setOps(docId, ops) {
  const msg = { t: 'set', doc: docId, ops };
  applyLocal(docId, ops);
  msg.id = ++seq;
  notify();
  return new Promise(resolve => {
    if (rawSend(msg)) { trackPending(msg); waiting.set(msg.id, { resolve, msg }); }
    else { outbox.push(msg); resolve({ ok: true, queued: true }); }
  });
}

export async function act(name, args = {}, docId = actorId()) {
  const r = await request({ t: 'act', doc: docId, name, args });
  if (r.queued) toast(t('Hors ligne : action envoyée à la reconnexion'));
  return r;
}

// Annuler sur la fiche affichée (le MJ peut annuler sur toutes les fiches de sa campagne).
export async function undo({ stack = 'sheet', redo = false, entryId = null, doc = store.view.charId } = {}) {
  const r = await request({ t: 'undo', doc, stack, redo, entryId });
  if (r.ok && r.result?.toast) toast(r.result.toast);
  return r;
}

export function sendRoll(roll) {
  return request({ t: 'roll', roll: { ...roll, charId: roll.charId ?? store.view.charId } });
}

// ---------------------------------------------------------------- HTTP

export async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'X-Lang': getLang(),
      ...(store.token ? { Authorization: `Bearer ${store.token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && store.token && !path.startsWith('/api/login')) logout(t('Session expirée : reconnecte-toi'));
    throw new Error(data?.error || t('Erreur {status}', { status: res.status }));
  }
  return data;
}

// Envoi d'une image d'une campagne : le corps de la requête est le fichier.
export function uploadAsset(cid, file, kind, folder = '') {
  return api(`/api/c/${cid}/assets?kind=${encodeURIComponent(kind)}&name=${encodeURIComponent(file.name)}&folder=${encodeURIComponent(folder || '')}`, { method: 'POST', raw: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
}

// Adresse d'une image par sa référence (asset:… ou lib:…).
export const fileUrl = ref => (ref ? `/api/file?ref=${encodeURIComponent(ref)}` : '');

// ---------------------------------------------------------------- Compte

function setMe(r) {
  store.account = r.account;
  store.campaigns = r.campaigns || [];
  if (r.signup) store.signup = r.signup;
  if (r.account?.lang && r.account.lang !== getLang()) {
    store.lang = setLang(r.account.lang);
    LS.set('lang', store.lang);
    document.documentElement.lang = store.lang;
  }
}

function setToken(token) {
  store.token = token;
  LS.set('token', token);
}

export async function login(loginName, secret) {
  const r = await api('/api/login', { method: 'POST', body: { login: loginName, secret } });
  setToken(r.token);
  setMe(r);
  if (!r.account.mustChange) onRoute();
  notify();
  return r;
}

export async function signup(data) {
  const r = await api('/api/signup', { method: 'POST', body: { ...data, lang: getLang() } });
  setToken(r.token);
  setMe(r);
  notify();
  return r;
}

export async function recover(data) {
  const r = await api('/api/recover', { method: 'POST', body: data });
  setToken(r.token);
  setMe(r);
  notify();
  return r;
}

export async function refreshMe() {
  if (!store.token) return null;
  try { setMe(await api('/api/me')); notify(); } catch { /* hors ligne : on garde ce qu'on a */ }
  return store.account;
}

// Au chargement, avec un jeton gardé : qui est connecté, et doit-il encore choisir son mot de passe ?
export async function resume() {
  if (!store.token) { notify(); return; }
  try {
    setMe(await api('/api/me'));
    if (!store.account.mustChange) connect();
  } catch (e) {
    if (!store.token) return;
    store.conn = 'offline';
    setTimeout(resume, 3000);
  }
  notify();
}

export async function changeSecret({ current, secret }) {
  const r = await api('/api/account/secret', { method: 'POST', body: { current, secret } });
  const first = store.account?.mustChange;
  setMe(r);
  if (first) onRoute();
  notify();
  return r;
}

export function logout(reason) {
  const token = store.token;
  if (token && !reason) fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  setToken(null);
  store.account = null;
  store.campaigns = [];
  disconnect();
  if (reason) toast(reason, { kind: 'error' });
  notify();
}
