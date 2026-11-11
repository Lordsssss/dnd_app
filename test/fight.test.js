import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTokens, groupKey, newFight, next, setRow, split, start } from '../shared/map/tracker.js';
import { MapDoc } from '../shared/map/ops.js';

// Dés truqués : 10, puis 15, puis 5…
const dice = (...rolls) => { let i = 0; return () => (rolls[i++ % rolls.length] - 1) / 20; };

const tokens = [
  { id: 'p1', name: 'Ilya Voss', kind: 'pc' },
  { id: 'p2', name: 'Brakka', kind: 'pc' },
  { id: 'g1', name: 'Gobelin 1', kind: 'enemy', init: 2 },
  { id: 'g2', name: 'Gobelin 2', kind: 'enemy', init: 2 },
  { id: 'w1', name: 'Loup', kind: 'enemy', init: 3, ref: { t: 'monster', name: 'Wolf', source: 'XMM' } },
  { id: 'w2', name: 'Loup alpha', kind: 'enemy', init: 4, ref: { t: 'monster', name: 'Wolf', source: 'XMM' } },
];

test('identiques : même fiche, sinon même nom sans numéro', () => {
  assert.equal(groupKey(tokens[2]), groupKey(tokens[3]));
  assert.equal(groupKey(tokens[4]), groupKey(tokens[5]), 'même fiche du bestiaire malgré deux noms');
  assert.notEqual(groupKey(tokens[2]), groupKey(tokens[4]));
});

test('un combat depuis la sélection : PJ sans nombre, un jet par groupe', () => {
  const f = addTokens(newFight(), tokens, dice(10, 15));
  assert.equal(f.rows.length, 4);
  const gob = f.rows.find(r => r.name === 'Gobelin ×2');
  assert.deepEqual(gob.tokenIds, ['g1', 'g2']);
  assert.equal(gob.total, 12);
  const wolves = f.rows.find(r => r.tokenIds.includes('w1'));
  assert.deepEqual(wolves.tokenIds, ['w1', 'w2']);
  assert.equal(wolves.total, 19, 'le plus haut modificateur du groupe');
  assert.deepEqual(f.rows.slice(-2).map(r => r.kind), ['pc', 'pc'], 'PJ en bas en attendant leur nombre');
  assert.equal(addTokens(f, tokens).rows.length, 4, 'rien en double');
});

test('tant que personne n\'a joué, saisir l\'initiative d\'un PJ remet le bon tour en tête', () => {
  let f = start(addTokens(newFight(), tokens, dice(10, 15)), tokens);
  assert.equal(f.rows.find(r => r.id === f.current).tokenIds[0], 'w1');
  const ren = f.rows.find(r => r.tokenIds[0] === 'p1');
  f = setRow(f, ren.id, { total: 22 });
  assert.equal(f.current, ren.id, 'Ren joue en premier');
  f = next(f, tokens);
  const second = f.current;
  const brakka = f.rows.find(r => r.tokenIds[0] === 'p2');
  f = setRow(f, brakka.id, { total: 25 });
  assert.equal(f.current, second, 'une fois le combat en cours, le tour ne bouge plus');
});

test('séparer un groupe : une ligne et un jet par token', () => {
  const f = addTokens(newFight(), tokens.slice(2, 4), dice(10, 15, 5));
  const g = split(f, f.rows[0].id, tokens, dice(15, 5));
  assert.equal(g.rows.length, 2);
  assert.deepEqual(g.rows.map(r => r.tokenIds.length), [1, 1]);
});

test('l\'opération fight.create lance le combat d\'un coup', () => {
  const doc = new MapDoc({ name: 'Test', image: 'x.png', grid: { cols: 10, rows: 10, feetPerCell: 5 }, walls: [] }, { tokens: tokens.map((t, i) => ({ ...t, x: i + 0.5, y: 0.5 })) }, { rng: dice(10) });
  doc.apply({ type: 'fight.create', tokenIds: ['p1', 'g1', 'g2'] });
  assert.equal(doc.doc.fight.started, true);
  assert.equal(doc.doc.fight.round, 1);
  assert.equal(doc.doc.fight.rows.length, 2);
  doc.apply({ type: 'fight.addTokens', tokenIds: ['g1', 'w1'] });
  assert.equal(doc.doc.fight.rows.length, 3, 'seul le loup s\'ajoute');
});
