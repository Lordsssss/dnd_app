// Atlas : les cartes d'une campagne autres que le monde. Le MJ prépare tout caché ; un joueur
// ne reçoit que les cartes, les lieux et les infos révélés, jamais les notes du MJ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, login, api, PNG } from './helpers.js';

async function setup() {
  const s = await start();
  const mj = api(s.base, (await login(s.base, 'mj', '9999')).body.token);
  const ren = api(s.base, (await login(s.base, 'ren', '1111')).body.token);
  const bea = api(s.base, (await login(s.base, 'bea', '3333')).body.token);
  const up = await mj('/api/c/c1/assets?kind=world&name=ville.png', { method: 'POST', raw: PNG });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  return { s, mj, ren, bea, ref: up.body.ref };
}

test('atlas : une carte cachée, des lieux révélés un à un, sans les notes du MJ', async () => {
  const x = await setup();
  try {
    const made = await x.mj('/api/c/c1/atlas', { method: 'POST', body: { name: 'Port-Sel', image: x.ref } });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const mid = made.body.id;

    // Une carte pas encore montrée : rien pour le joueur.
    assert.deepEqual((await x.ren('/api/c/c1/atlas')).body.maps, []);
    assert.equal((await x.ren(`/api/c/c1/atlas/${mid}`)).status, 404);
    const dmList = (await x.mj('/api/c/c1/atlas')).body;
    assert.equal(dmList.maps[0].name, 'Port-Sel');
    assert.equal(dmList.maps[0].known, false);

    // Un quartier en zone, deux lieux en points ; un seul connu.
    const added = await x.mj(`/api/c/c1/atlas/${mid}/places`, { method: 'POST', body: { places: [
      { name: 'Les Docks', kind: 'quartier', shape: [[0, 0], [40, 0], [40, 30], [0, 30]], known: true, label: false },
      { name: 'La Taverne', num: '1', x: 10, y: 12, known: true, pub: 'Bruyante.', mj: 'Le patron ment.',
        facts: [{ text: 'Une porte arrière.', known: true }, { text: 'Un passage vers les égouts.' }] },
      { name: 'Le Repaire', x: 30, y: 20, pub: 'Secret.' },
    ] } });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.deepEqual(added.body.map(p => p.key), ['a1', 'a2', 'a3']);
    await x.mj(`/api/c/c1/atlas/${mid}`, { method: 'PATCH', body: { known: true } });

    const seen = (await x.ren(`/api/c/c1/atlas/${mid}`)).body;
    assert.equal(seen.role, 'player');
    assert.deepEqual(seen.added.map(p => p.name), ['Les Docks', 'La Taverne']);
    const tav = seen.added.find(p => p.key === 'a2');
    assert.equal(tav.pub, 'Bruyante.');
    assert.ok(!('mj' in tav), 'pas de notes du MJ');
    assert.deepEqual(tav.facts.map(f => f.text), ['Une porte arrière.'], 'seulement les infos révélées');
    const docks = seen.added.find(p => p.key === 'a1');
    assert.equal(docks.shape.length, 1);
    assert.deepEqual([docks.x, docks.y], [20, 15], 'le nom d’une zone va à son centre');
    assert.equal(docks.label, false);

    // Révéler une info, puis un lieu : la version de la carte avance, le joueur les reçoit.
    const v0 = (await x.ren('/api/c/c1/atlas')).body.maps[0].v;
    const dm = (await x.mj(`/api/c/c1/atlas/${mid}`)).body;
    const facts = dm.added.find(p => p.key === 'a2').facts.map(f => ({ ...f, known: true }));
    assert.equal((await x.mj(`/api/c/c1/atlas/${mid}/entity`, { method: 'POST', body: { key: 'a2', patch: { facts } } })).status, 200);
    await x.mj(`/api/c/c1/atlas/${mid}/entity`, { method: 'POST', body: { key: 'a3', patch: { known: true } } });
    const after = (await x.ren(`/api/c/c1/atlas/${mid}`)).body;
    assert.equal(after.added.find(p => p.key === 'a2').facts.length, 2);
    assert.ok(after.added.some(p => p.key === 'a3'));
    assert.ok((await x.ren('/api/c/c1/atlas')).body.maps[0].v > v0, 'la liste annonce le changement');

    // Vue joueur du MJ : la même chose que Ren, et aucune écriture.
    const asRen = await x.mj(`/api/c/c1/atlas/${mid}`, { headers: { 'X-View-As': 'u-ren' } });
    assert.equal(asRen.body.role, 'player');
    assert.ok(!asRen.body.added.some(p => 'mj' in p));
    const blocked = await x.mj(`/api/c/c1/atlas/${mid}/entity`, { method: 'POST', body: { key: 'a2', patch: { name: 'X' } }, headers: { 'X-View-As': 'u-ren' } });
    assert.equal(blocked.status, 403);

    // Retirer un lieu, puis la carte.
    assert.equal((await x.mj(`/api/c/c1/atlas/${mid}/place/a3`, { method: 'DELETE' })).status, 200);
    assert.equal((await x.mj(`/api/c/c1/atlas/${mid}`)).body.added.length, 2);
    assert.equal((await x.mj(`/api/c/c1/atlas/${mid}`, { method: 'DELETE' })).status, 200);
    assert.equal((await x.mj(`/api/c/c1/atlas/${mid}`)).status, 404);
  } finally { await x.s.stop(); }
});

test('atlas : le joueur ne change rien, l’autre campagne ne voit rien', async () => {
  const x = await setup();
  try {
    const mid = (await x.mj('/api/c/c1/atlas', { method: 'POST', body: { name: 'Port-Sel', image: x.ref, known: true } })).body.id;
    for (const [path, method, body] of [
      ['/api/c/c1/atlas', 'POST', { name: 'X', image: x.ref }],
      [`/api/c/c1/atlas/${mid}`, 'PATCH', { known: false }],
      [`/api/c/c1/atlas/${mid}/place`, 'POST', { name: 'X', x: 1, y: 1 }],
      [`/api/c/c1/atlas/${mid}/entity`, 'POST', { key: 'a1', patch: {} }],
      [`/api/c/c1/atlas/${mid}`, 'DELETE', null],
    ]) {
      const r = await x.ren(path, { method, body });
      assert.equal(r.status, 403, `${method} ${path}`);
    }
    // Béa est MJ d'une autre campagne : 403 partout ici.
    assert.equal((await x.bea('/api/c/c1/atlas')).status, 403);
    assert.equal((await x.bea(`/api/c/c1/atlas/${mid}`)).status, 403);
    assert.equal((await x.bea(`/api/c/c1/atlas/${mid}/place`, { method: 'POST', body: { x: 1, y: 1 } })).status, 403);
    // Une image d'une autre campagne ne sert pas de fond.
    const other = await x.bea('/api/c/c2/assets?kind=world&name=b.png', { method: 'POST', raw: PNG });
    assert.equal((await x.mj('/api/c/c1/atlas', { method: 'POST', body: { name: 'Vol', image: other.body.ref } })).status, 400);
    // La carte d'une campagne n'existe pas dans l'autre.
    assert.equal((await x.bea(`/api/c/c2/atlas/${mid}`)).status, 404);
  } finally { await x.s.stop(); }
});

test('atlas : la page s’ouvre à /cartes et à /cartes/<carte>', async () => {
  const x = await setup();
  try {
    for (const p of ['/c/c1/cartes', '/c/c1/cartes/m123abc', '/c/c1/monde']) {
      const r = await fetch(`${x.s.base}${p}`);
      assert.equal(r.status, 200, p);
      assert.match(await r.text(), /world\/main\.js/);
    }
  } finally { await x.s.stop(); }
});
