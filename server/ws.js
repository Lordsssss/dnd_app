// Canal temps réel des fiches. Une connexion = un onglet sur une campagne :
//   hello { token, campaign, play, lang }
// `play` choisit, parmi les fiches du compte dans cette campagne, celle que l'onglet joue.
import { WebSocketServer } from 'ws';
import { ActionError, PARTY_ACTIONS } from '../shared/actions.js';
import { tl, normLang } from '../shared/i18n.js';
import { isDmRole } from './campaigns.js';

export function createSheetHub({ engine, db, campaigns, audit, accountOfToken }) {
  const clients = new Set();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2_000_000 });
  wss.on('error', () => {});
  let nextId = 1;

  function sendWs(c, msg) {
    if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  }

  const seatName = a => (a.role === 'dm' && !a.charId ? 'MJ' : engine.docs.get(a.charId)?.data.name || a.accountName);

  function logWs(c, msg, result) {
    const who = { account: c.auth.accountName, seat: seatName(c.auth), ip: c.ip, campaign: c.auth.campaign };
    if (msg.t === 'set') {
      if (!result?.changed) return;
      const party = engine.docs.get(msg.doc)?.kind === 'party';
      const target = party ? '' : engine.docs.get(msg.doc)?.data.name || '';
      audit.log({ ...who, kind: party ? 'party' : 'sheet', action: party ? 'Réserve : modification' : result.label, detail: target !== who.seat ? target : '', mergeKey: `${msg.doc}|${result.mergeKey}` });
    } else if (msg.t === 'act') {
      const party = Object.hasOwn(PARTY_ACTIONS, msg.name);
      audit.log({ ...who, kind: party ? 'party' : 'sheet', action: result?.label || msg.name, detail: result?.toast || '' });
    } else if (msg.t === 'undo') {
      audit.log({ ...who, kind: 'sheet', action: result?.toast || 'Annulation' });
    } else if (msg.t === 'roll') {
      const r = msg.roll || {};
      audit.log({ ...who, kind: 'roll', action: `${String(r.label || 'Jet').slice(0, 80)} : ${Math.trunc(Number(r.total) || 0)}`, detail: String(r.detail || '').slice(0, 160) });
    }
  }

  function welcome(c, msg) {
    const acc = accountOfToken(msg.token);
    if (!acc) return sendWs(c, { t: 'logout', reason: tl(normLang(msg.lang), 'Session expirée : reconnecte-toi') });
    if (acc.mustChange) { sendWs(c, { t: 'mustChange' }); c.ws.close(); return undefined; }
    const lang = normLang(msg.lang || acc.lang);
    const cid = String(msg.campaign || '');
    const membership = campaigns.role(acc.id, cid);
    if (!membership) return sendWs(c, { t: 'denied', reason: tl(lang, 'Tu ne fais pas partie de cette campagne') });
    db.touchSession(msg.token);
    const role = isDmRole(membership) ? 'dm' : 'player';
    const mine = engine.charsOwnedBy(acc.id, cid).map(x => x.id);
    let charId = null;
    if (mine.includes(msg.play)) charId = msg.play;
    else if (role === 'player') charId = mine[0] || null;
    c.token = msg.token;
    c.auth = { id: c.id, role, membership, charId, campaign: cid, accountId: acc.id, accountName: acc.name, lang };
    const client = c.auth;
    return sendWs(c, {
      t: 'welcome',
      me: { role, membership, charId, campaign: cid, accountId: acc.id, mine },
      state: engine.stateFor(client),
      rolls: db.recentRolls(cid, 100, { withPrivate: role === 'dm' }),
      stacks: engine.stacksFor(client),
      config: { campaign: campaigns.publicInfo(cid) },
    });
  }

  wss.on('connection', (ws, req, ip) => {
    const c = { id: `k${nextId++}`, ws, auth: null, token: null, alive: true, ip };
    clients.add(c);
    ws.on('pong', () => { c.alive = true; });
    ws.on('close', () => clients.delete(c));
    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const reply = (ok, extra = {}) => msg.id != null && sendWs(c, { t: 'ack', id: msg.id, ok, ...extra });
      const lang = c.auth?.lang || 'fr';
      try {
        if (msg.t === 'hello') return welcome(c, msg);
        if (!c.auth) return reply(false, { error: tl(lang, 'Non connecté') });
        const client = c.auth;
        switch (msg.t) {
          case 'ping': return sendWs(c, { t: 'pong' });
          case 'sync': return sendWs(c, { t: 'state', state: engine.stateFor(client) });
          case 'set': { const r = engine.handleSet(client, msg); logWs(c, msg, r); return reply(true); }
          case 'act': {
            const result = engine.handleAction(client, { ...msg, lang });
            logWs(c, msg, result);
            return reply(true, { result: { ...result, toast: result.toast ? tl(lang, result.toast) : result.toast } });
          }
          case 'undo': { const result = engine.handleUndo(client, { ...msg, lang }); logWs(c, msg, result); return reply(true, { result }); }
          case 'roll': {
            const forChar = client.role === 'dm' && engine.campaignOf(msg.roll?.charId) === client.campaign ? msg.roll.charId : null;
            engine.handleRoll(client, msg.roll, { charId: forChar });
            logWs(c, msg);
            return reply(true);
          }
          default: return reply(false, { error: tl(lang, 'Message inconnu') });
        }
      } catch (e) {
        if (!(e instanceof ActionError)) console.error(e);
        return reply(false, { error: e instanceof ActionError ? tl(lang, e.message) : tl(lang, 'Erreur serveur') });
      }
    });
  });

  const inCampaign = (c, cid) => c.auth && c.auth.campaign === cid;

  engine.on('patch', ev => {
    for (const c of clients) {
      if (!inCampaign(c, ev.campaign)) continue;
      const p = engine.filterPatches(c.auth, ev.doc, ev.patches);
      sendWs(c, { t: 'patch', doc: ev.doc, v: ev.v, p, mine: ev.origin === c.id, id: ev.origin === c.id ? ev.opId : undefined, k: ev.kind });
    }
  });
  engine.on('stacks', ev => {
    for (const c of clients) if (inCampaign(c, ev.campaign) && engine.canEditDoc(c.auth, ev.doc)) sendWs(c, { t: 'stacks', doc: ev.doc, stacks: ev.stacks });
  });
  engine.on('doc', ev => {
    const e = engine.docs.get(ev.doc);
    if (!e) return;
    for (const c of clients) {
      if (!inCampaign(c, ev.campaign)) continue;
      // Une fiche donnée à ce compte : l'onglet d'un joueur sans fiche la prend.
      if (c.auth.role === 'player' && !c.auth.charId && e.owner === c.auth.accountId) c.auth.charId = e.id;
      if (c.auth.role === 'player' && c.auth.charId === e.id && e.owner !== c.auth.accountId) c.auth.charId = null;
      sendWs(c, { t: 'doc', doc: ev.doc, v: e.v, data: engine.viewOf(c.auth, e), owner: e.owner, me: { charId: c.auth.charId, mine: engine.charsOwnedBy(c.auth.accountId, c.auth.campaign).map(x => x.id) } });
    }
  });
  engine.on('docDeleted', ev => {
    for (const c of clients) {
      if (!inCampaign(c, ev.campaign)) continue;
      if (c.auth.charId === ev.doc) c.auth.charId = null;
      sendWs(c, { t: 'docDeleted', doc: ev.doc });
    }
  });
  engine.on('roll', roll => {
    for (const c of clients) if (inCampaign(c, roll.campaign) && (!roll.private || c.auth.role === 'dm')) sendWs(c, { t: 'roll', roll });
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
    clients,
    upgrade: (req, socket, head, ip) => wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req, ip)),
    // `predicate` reçoit { accountId, campaign, token } ; la connexion est fermée avec un motif.
    kick(predicate, reason) {
      for (const c of clients) {
        if (!c.auth || !predicate({ accountId: c.auth.accountId, campaign: c.auth.campaign, token: c.token })) continue;
        sendWs(c, { t: 'logout', reason: tl(c.auth.lang, reason), soft: true });
        c.ws.close();
      }
    },
    // Rôle changé dans une campagne : les onglets concernés se reconnectent avec leurs nouveaux droits.
    refresh(predicate) {
      for (const c of clients) {
        if (!c.auth || !predicate({ accountId: c.auth.accountId, campaign: c.auth.campaign })) continue;
        sendWs(c, { t: 'reconnect' });
        c.ws.close();
      }
    },
    online(cid) {
      const out = new Map();
      for (const c of clients) if (c.auth?.campaign === cid) out.set(c.auth.accountId, seatName(c.auth));
      return out;
    },
    close() {
      clearInterval(heartbeat);
      for (const c of clients) c.ws.terminate();
    },
  };
}
