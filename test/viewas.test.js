// Vue joueur : le MJ regarde la campagne avec le compte d'un de ses joueurs, sans changer de
// session. Il reçoit ce que ce joueur recevrait, et ne peut rien écrire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, login, api, ws, PNG } from './helpers.js';

async function setup() {
  const s = await start();
  const mj = await login(s.base, 'mj', '9999');
  const ren = await login(s.base, 'ren', '1111');
  const socks = [];
  const open = (...a) => { const c = ws(...a); socks.push(c); return c; };
  const stop = async () => { for (const c of socks) c.close(); await s.stop(); };
  return { s, mj: mj.body.token, ren: ren.body.token, open, stop };
}

test('vue joueur des fiches : ce que voit le joueur, sa fiche à lui, et aucune écriture', async () => {
  const x = await setup();
  try {
    const dm = x.open(x.s.port, '/ws', { t: 'hello', token: x.mj, campaign: 'c1' });
    const asDm = await dm.next(m => m.t === 'welcome');
    assert.ok('secret' in asDm.state.chars[x.s.b].data, 'le MJ voit le secret de Brakka');

    const pv = x.open(x.s.port, '/ws', { t: 'hello', token: x.mj, campaign: 'c1', as: 'u-ren' });
    const w = await pv.next(m => m.t === 'welcome');
    assert.equal(w.me.role, 'player');
    assert.equal(w.me.charId, x.s.a, 'la fiche de Ren');
    assert.deepEqual(w.me.preview, { by: 'MJ', name: 'Ren' });
    assert.equal(w.state.chars[x.s.a].data.secret.text, 'SECRET-REN', 'son propre secret');
    assert.ok(!('secret' in w.state.chars[x.s.b].data), 'pas celui de Brakka');

    for (const msg of [
      { t: 'set', doc: x.s.a, ops: [[['name'], 'Pirate']] },
      { t: 'act', doc: x.s.a, name: 'shortRest', args: {} },
      { t: 'undo', doc: x.s.a },
      { t: 'roll', roll: { label: 'Test', total: 12 } },
    ]) {
      const r = await pv.request(msg);
      assert.equal(r.ok, false, msg.t);
      assert.match(r.error, /lecture seule/);
    }
    assert.equal(x.s.engine.docs.get(x.s.a).data.name, 'Ren', 'rien n’a changé');
    assert.ok(!x.s.app.hub.online('c1').has('u-ren'), 'Ren n’apparaît pas en ligne');

    // Le joueur regardé change de mot de passe : la vue se ferme, la session du MJ reste ouverte.
    x.s.app.hub.kick(c => c.accountId === 'u-ren', 'Mot de passe changé : reconnecte-toi');
    assert.equal((await pv.next(m => m.t === 'denied' || m.t === 'logout')).t, 'denied');
    assert.ok(!dm.msgs.some(m => m.t === 'logout'), 'l’onglet du MJ n’est pas touché');
  } finally { await x.stop(); }
});

test('vue joueur : seulement le MJ, seulement vers un joueur de la campagne', async () => {
  const x = await setup();
  try {
    const bea = (await login(x.s.base, 'bea', '3333')).body.token;
    for (const [token, as] of [[x.ren, 'u-brakka'], [x.mj, 'u-bea'], [x.mj, 'u-mj'], [x.mj, 'u-inconnu'], [bea, 'u-ren']]) {
      const c = x.open(x.s.port, '/ws', { t: 'hello', token, campaign: 'c1', as });
      assert.equal((await c.next(m => m.t === 'denied' || m.t === 'welcome')).t, 'denied', `${as}`);
    }
  } finally { await x.stop(); }
});

test('vue joueur par l’API : les routes répondent comme au joueur, et rien ne s’écrit', async () => {
  const x = await setup();
  try {
    const as = who => ({ 'X-View-As': who });
    const dm = api(x.s.base, x.mj);
    assert.equal((await dm('/api/c/c1/map/players')).status, 200);
    assert.equal((await dm('/api/c/c1/map/players', { headers: as('u-ren') })).status, 403, 'une route du MJ refuse la vue joueur');
    assert.equal((await dm('/api/c/c1/map/memes/shelf', { headers: as('u-ren') })).status, 200, 'une route de joueur répond');
    const up = await dm('/api/c/c1/assets?kind=portrait&name=p.png', { method: 'POST', raw: PNG, headers: as('u-ren') });
    assert.equal(up.status, 403);
    assert.match(up.body.error, /lecture seule/);
    assert.equal((await dm('/api/c/c1/map/memes/shelf', { headers: as('u-bea') })).status, 403);
    assert.equal((await api(x.s.base, x.ren)('/api/c/c1/map/memes/shelf', { headers: as('u-brakka') })).status, 403, 'un joueur ne regarde pas par les yeux d’un autre');
  } finally { await x.stop(); }
});

test('vue joueur de la carte : les tokens du joueur regardé, sans rien déplacer ni poser', async () => {
  const x = await setup();
  try {
    const call = api(x.s.base, x.mj);
    const img = await call('/api/c/c1/assets?kind=map&name=m.png', { method: 'POST', raw: PNG });
    const scene = (await call('/api/c/c1/map/scenes', { method: 'POST', body: { name: 'Salle', image: img.body.ref, cols: 10, rows: 10 } })).body.id;
    const dm = x.open(x.s.port, '/ws/map', { t: 'hello', token: x.mj, campaign: 'c1', role: 'dm' });
    await dm.next(m => m.t === 'welcome');
    await dm.request({ t: 'open', scene });
    await dm.request({ t: 'tvScene', scene });
    await dm.request({ t: 'op', scene, op: { type: 'token.add', tokens: [
      { id: 'pr', kind: 'pc', name: 'Ren', x: 2.5, y: 2.5 },
      { id: 'pb', kind: 'pc', name: 'Brakka', x: 3.5, y: 2.5 },
    ] } });

    const pv = x.open(x.s.port, '/ws/map', { t: 'hello', token: x.mj, campaign: 'c1', role: 'player', as: 'u-ren' });
    const w = await pv.next(m => m.t === 'welcome');
    assert.deepEqual(w.me.preview, { by: 'MJ', name: 'Ren' });
    assert.equal((await pv.next(m => m.t === 'table')).table.muted, undefined, 'les réglages tels qu’un joueur les reçoit');
    const sc = await pv.next(m => m.t === 'scene');
    assert.equal(sc.doc.tokens.find(t => t.id === 'pr').own, true);
    assert.equal(sc.doc.tokens.find(t => t.id === 'pb').own, undefined, 'pas les tokens des autres, même pour le MJ');

    const move = await pv.request({ t: 'op', scene, op: { type: 'token.move', moves: [{ id: 'pr', x: 4.5, y: 4.5 }] } });
    assert.match(move.error, /lecture seule/);
    assert.match((await pv.request({ t: 'meme', action: 'add', meme: { kind: 'text', text: 'lol', x: 1, y: 1 } })).error, /lecture seule/);
    assert.match((await pv.request({ t: 'react', emoji: '💀', x: 1, y: 1 })).error, /lecture seule/);

    const bad = x.open(x.s.port, '/ws/map', { t: 'hello', token: x.ren, campaign: 'c1', role: 'player', as: 'u-brakka' });
    assert.equal((await bad.next(m => m.t === 'denied' || m.t === 'welcome')).t, 'denied');
  } finally { await x.stop(); }
});
