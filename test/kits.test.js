import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, login, api, ws } from './helpers.js';
import { applyKitToDoc, normalizeKit, kitTakes } from '../shared/kits.js';

let n = 0;
const newId = p => `${p}-new${++n}`;

function sheet() {
  return {
    name: 'Brakka',
    currency: { pc: 0, pa: 45, po: 2 },
    inventory: {
      i1: { name: 'Longsword +1', qty: 1, notes: '', attunement: true, attuned: true, equipped: true, order: 0 },
      i2: { name: 'Potion of Healing', qty: 2, notes: '', consumable: true, order: 1 },
      i3: { name: 'Lantern', qty: 1, notes: 'Bosselée', order: 2 },
      i4: { name: 'Grimoire', qty: 1, notes: 'Ne se perd jamais', order: 3 },
    },
  };
}

test('lots : retirer selon le sort de chaque objet, ranger le reste, puis donner', () => {
  const doc = sheet();
  const kit = normalizeKit({
    name: 'La cellule',
    take: { rest: 'keep', money: 'keep', items: [{ id: 'i4', name: 'Grimoire', fate: 'stay' }, { id: 'gone', name: 'lantern', fate: 'lose' }] },
    give: { items: [{ name: 'Dagger (prêtée)', qty: 2, notes: 'Prêtée par le geôlier.', equipped: true }], currency: { pa: 3 } },
  });
  assert.ok(kitTakes(kit));
  const r = applyKitToDoc(doc, kit, { newId });
  const names = Object.values(doc.inventory).map(i => i.name).sort();
  assert.deepEqual(names, ['Dagger (prêtée)', 'Grimoire'], 'le grimoire reste, le reste part, l’arme arrive');
  assert.deepEqual(doc.currency, { pc: 0, pa: 3, po: 0 }, 'la bourse est vidée, puis reçoit le lot');
  assert.equal(r.removed.find(x => x.name === 'Lantern').fate, 'lose', 'retrouvée par son nom quand l’id ne correspond plus');
  assert.deepEqual(r.kept.items.map(i => i.name), ['Longsword +1', 'Potion of Healing'], 'rangés pour plus tard, dans l’ordre de la fiche');
  assert.equal(r.kept.items[0].attuned, true, 'l’harmonisation est gardée');
  assert.deepEqual(r.kept.currency, { pa: 45, po: 2 });
  assert.deepEqual(r.warnings, []);
});

test('lots : rendre empile les objets simples et respecte la limite d’harmonisation', () => {
  const doc = sheet();
  doc.inventory.i5 = { name: 'Ring', qty: 1, attunement: true, attuned: true, order: 4 };
  doc.inventory.i6 = { name: 'Amulet', qty: 1, attunement: true, attuned: true, order: 5 };
  const kit = normalizeKit({ give: { items: [{ name: 'Potion of Healing', qty: 1, consumable: true }, { name: 'Cloak', attunement: true, attuned: true }] } });
  assert.equal(kitTakes(kit), false);
  const r = applyKitToDoc(doc, kit, { newId });
  assert.equal(doc.inventory.i2.qty, 3, 'la potion s’ajoute à la pile');
  const cloak = Object.values(doc.inventory).find(i => i.name === 'Cloak');
  assert.ok(cloak && !cloak.attuned, 'quatrième objet harmonisé refusé : il arrive sans harmonisation');
  assert.deepEqual(r.warnings, [{ kind: 'attune', name: 'Cloak' }]);
});

test('lots : un objet visé introuvable est signalé, rien d’autre ne bouge', () => {
  const doc = sheet();
  const r = applyKitToDoc(doc, normalizeKit({ take: { items: [{ id: 'x', name: 'Dragon Slayer', fate: 'lose' }] } }), { newId });
  assert.equal(Object.keys(doc.inventory).length, 4);
  assert.deepEqual(r.warnings, [{ kind: 'missing', name: 'Dragon Slayer' }]);
});

test('lots : routes du MJ, fiche mise à jour en direct, lot « à rendre », annulation, isolation', async () => {
  const s = await start();
  try {
    const mj = await login(s.base, 'mj', '9999');
    const call = api(s.base, mj.body.token);
    const ren = await login(s.base, 'ren', '1111');
    const bea = await login(s.base, 'bea', '3333');
    // La fiche de Brakka (s.b) porte deux objets et un peu d'argent.
    s.engine.docs.get(s.b).data.inventory = { a: { name: 'Sickle', qty: 1, order: 0 }, b: { name: 'Orb', qty: 1, order: 1 } };
    s.engine.docs.get(s.b).data.currency = { pa: 12 };

    const made = await call('/api/c/c1/kits', { method: 'POST', body: {
      name: 'Prison', folder: 'Session 2', target: s.b, keepName: 'Coffre du geôlier',
      take: { rest: 'keep', money: 'keep', items: [{ id: 'a', name: 'Sickle', fate: 'lose' }] },
      give: { items: [{ name: 'Club (prêté)', qty: 1 }] },
    } });
    assert.equal(made.status, 200);
    assert.equal((await call('/api/c/c1/kits')).body.length, 1);

    // Ni un joueur de la campagne, ni le MJ d'une autre.
    assert.equal((await api(s.base, ren.body.token)('/api/c/c1/kits')).status, 403);
    assert.equal((await api(s.base, bea.body.token)('/api/c/c1/kits')).status, 403);
    assert.equal((await api(s.base, bea.body.token)(`/api/c/c1/kits/${made.body.id}/apply`, { method: 'POST', body: { charId: s.b } })).status, 403);
    // Pas de fiche d'une autre campagne comme cible.
    assert.equal((await call('/api/c/c1/kits', { method: 'POST', body: { name: 'x', target: s.x } })).status, 404);
    assert.equal((await call(`/api/c/c1/kits/${made.body.id}/apply`, { method: 'POST', body: { charId: s.x } })).status, 404);

    const sock = ws(s.port, '/ws', { t: 'hello', token: ren.body.token, campaign: 'c1' });
    await sock.next(m => m.t === 'welcome');
    const ap = await call(`/api/c/c1/kits/${made.body.id}/apply`, { method: 'POST', body: {} });
    assert.equal(ap.status, 200);
    assert.equal(ap.body.created.name, 'Coffre du geôlier');
    const live = await sock.next(m => m.t === 'patch' && m.doc === s.b);
    assert.ok(live.p.length, 'les autres fiches ouvertes voient le changement');
    const inv = Object.values(s.engine.docs.get(s.b).data.inventory).map(i => i.name);
    assert.deepEqual(inv, ['Club (prêté)']);
    assert.equal(s.engine.stack(`${s.b}|sheet`).undo.length, 0, 'le joueur ne peut pas annuler le lot depuis sa fiche');

    const list = (await call('/api/c/c1/kits')).body;
    const back = list.find(k => k.name === 'Coffre du geôlier');
    assert.deepEqual(back.give.items.map(i => i.name), ['Orb'], 'la faucille est perdue, l’orbe est rangé');
    assert.deepEqual(back.give.currency, { pa: 12 });
    assert.equal(list.find(k => k.id === made.body.id).undo.name, 'Brakka');
    assert.equal(list.find(k => k.id === made.body.id).undo.before, undefined, 'l’inventaire d’avant reste sur le serveur');

    // Annuler : tout revient, le lot « à rendre » disparaît.
    assert.equal((await call(`/api/c/c1/kits/${made.body.id}/undo`, { method: 'POST' })).status, 200);
    assert.deepEqual(Object.values(s.engine.docs.get(s.b).data.inventory).map(i => i.name).sort(), ['Orb', 'Sickle']);
    assert.equal(s.engine.docs.get(s.b).data.currency.pa, 12);
    assert.equal((await call('/api/c/c1/kits')).body.length, 1);
    assert.deepEqual((await call('/api/c/c1/kits')).body[0].history, [], 'l’application annulée sort de l’historique');
    assert.equal((await call(`/api/c/c1/kits/${made.body.id}/undo`, { method: 'POST' })).status, 400);

    // Un lot qui retire ne s'applique qu'à sa fiche ; un lot qui donne va à qui on veut.
    assert.equal((await call(`/api/c/c1/kits/${made.body.id}/apply`, { method: 'POST', body: { charId: s.a } })).status, 400);
    const gift = await call('/api/c/c1/kits', { method: 'POST', body: { name: 'Laissez-passer', give: { items: [{ name: 'Laissez-passer' }] } } });
    assert.equal((await call(`/api/c/c1/kits/${gift.body.id}/apply`, { method: 'POST', body: {} })).status, 400, 'sans cible, il faut choisir la fiche');
    assert.equal((await call(`/api/c/c1/kits/${gift.body.id}/apply`, { method: 'POST', body: { charId: s.a } })).status, 200);
    assert.ok(Object.values(s.engine.docs.get(s.a).data.inventory).some(i => i.name === 'Laissez-passer'));

    assert.equal((await call(`/api/c/c1/kits/${gift.body.id}`, { method: 'PUT', body: { name: 'Laissez-passer royal', give: { items: [] } } })).body.name, 'Laissez-passer royal');
    assert.equal((await call(`/api/c/c1/kits/${gift.body.id}`, { method: 'DELETE' })).status, 200);
    sock.close();
  } finally { await s.stop(); }
});
