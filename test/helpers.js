// Un serveur complet pour les tests : deux campagnes, un MJ par campagne, deux joueurs.
//   c1 « Alpha » : mj (MJ, admin), ren et brakka (joueurs), chacun sa fiche
//   c2 « Beta »  : bea (MJ), et ren y joue aussi une autre fiche
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { openDb } from '../server/db.js';
import { Engine } from '../server/engine.js';
import { createApp } from '../server/app.js';
import { FiveETools } from '../server/data5e.js';
import { blankCharacter } from '../shared/model.js';
import { DEFAULTS } from '../server/config.js';
import { hashPin } from '../server/accounts.js';

export const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000400000003008060000000000000000', 'hex');

export async function start({ signup = 'invite', library = null, secretDeathSaves = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-test-'));
  const db = openDb(path.join(dir, 'f.sqlite'));
  const acc = (id, login, name, secret, extra = {}) => db.putAccount({ id, login, name, pinHash: hashPin(secret), mustChange: false, secretKind: 'pin', ...extra });
  acc('u-mj', 'mj', 'MJ', '9999', { isAdmin: true });
  acc('u-ren', 'ren', 'Ren', '1111');
  acc('u-brakka', 'brakka', 'Brakka', '2222');
  acc('u-bea', 'bea', 'Béa', '3333');
  db.putCampaign({ id: 'c1', name: 'Alpha', settings: { secretDeathSaves } });
  db.putCampaign({ id: 'c2', name: 'Beta', settings: {} });
  db.setMember('c1', 'u-mj', 'dm');
  db.setMember('c1', 'u-ren', 'player');
  db.setMember('c1', 'u-brakka', 'player');
  db.setMember('c2', 'u-bea', 'dm');
  db.setMember('c2', 'u-ren', 'player');
  const engine = new Engine({ db, random: () => 12 }).load();
  const ren = blankCharacter({ name: 'Ren', className: 'Wizard', level: 5 });
  ren.secret = { text: 'SECRET-REN', goals: '', drawing: {} };
  const a = engine.createCharacter(ren, { campaign: 'c1', owner: 'u-ren' });
  const b = engine.createCharacter(blankCharacter({ name: 'Brakka', className: 'Warlock', level: 5 }), { campaign: 'c1', owner: 'u-brakka' });
  const x = engine.createCharacter(blankCharacter({ name: 'Ren-Beta', className: 'Fighter', level: 2 }), { campaign: 'c2', owner: 'u-ren' });
  const cfg = { ...DEFAULTS, port: 0, dataDir: path.join(dir, 'data'), backupDir: path.join(dir, 'bk'), signup, libraryDir: library, trustProxy: false };
  const app = createApp({ engine, db, cfg, data5e: new FiveETools(path.join(dir, 'none')).load() });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const stop = async () => { await new Promise(r => { app.server.close(r); app.server.closeAllConnections(); }); db.close(); };
  return { dir, db, engine, app, a, b, x, port, base, stop };
}

export async function login(base, loginName, secret) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', body: JSON.stringify({ login: loginName, secret }) });
  return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie') };
}

export function api(base, token) {
  return async (p, { method = 'GET', body, raw, headers = {} } = {}) => {
    const r = await fetch(`${base}${p}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers };
  };
}

export function ws(port, pathName, hello) {
  const sock = new WebSocket(`ws://127.0.0.1:${port}${pathName}`);
  const msgs = [];
  const waiters = [];
  sock.on('message', raw => {
    const m = JSON.parse(raw.toString());
    const w = waiters.find(x => x.pred(m));
    if (w) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); } else msgs.push(m);
  });
  const next = (pred, ms = 3000) => {
    const i = msgs.findIndex(pred);
    if (i >= 0) return Promise.resolve(msgs.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      waiters.push(w);
      setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); reject(new Error(`timeout (${pathName})`)); } }, ms);
    });
  };
  const ready = new Promise(r => sock.on('open', () => { if (hello) sock.send(JSON.stringify(hello)); r(); }));
  let seq = 0;
  const send = m => sock.send(JSON.stringify(m));
  const request = async m => { const id = ++seq + 1000; send({ ...m, id }); return next(x => x.t === 'ack' && x.id === id); };
  return { sock, msgs, next, ready, send, request, close: () => sock.close() };
}
