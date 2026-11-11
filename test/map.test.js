import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockingSegments, cutWallsUnder, eraseSegments, normalizeScene, SceneError, sceneBounds, serializeScene, sortFolders, wallIssues, weldWalls } from '../shared/map/scene.js';
import { buildIndex, lineOfSight, pointInPolygon, visibilityPolygon } from '../shared/map/vision.js';
import { applyUpdate, MapDoc } from '../shared/map/ops.js';
import { barsOnTv, computeView, forTv, hpBarOf, namesOnTv, tvTokens } from '../shared/map/view.js';
import * as tracker from '../shared/map/tracker.js';
import { bestiaryLink, footprintOf, initiativeMod } from '../shared/map/monster.js';

// Deux pièces de 10 × 10 séparées par un mur en x = 10, percé d'une porte de y = 4 à y = 6.
const twoRooms = (open = false) => normalizeScene({
  name: 'Test', image: 'x.png', grid: { cols: 20, rows: 10 },
  walls: [
    { id: 'w1', points: [[10, 0], [10, 4]] },
    { id: 'w2', points: [[10, 6], [10, 10]] },
    { id: 'd1', kind: 'door', open, points: [[10, 4], [10, 6]] },
  ],
});
const indexOf = s => buildIndex(blockingSegments(s.walls), sceneBounds(s));

// Tirages prévisibles : d20 donne (valeur - 1) / 20.
const dice = (...values) => { let i = 0; return () => (values[i++ % values.length] - 1) / 20 + 1e-6; };

test('le format refuse ce qui est faux et dit où', () => {
  assert.throws(() => normalizeScene({ grid: {} }), SceneError);
  assert.throws(() => normalizeScene({ grid: { cols: 2, rows: 2 }, walls: [{ points: [[1, 1]] }] }), /walls\[0\]/);
  assert.throws(() => normalizeScene({ grid: { cols: 2, rows: 2 }, walls: [{ kind: 'mur', points: [[0, 0], [1, 1]] }] }), /kind/);
  assert.throws(() => normalizeScene({ grid: { cols: 2, rows: 2 }, walls: [{ points: [[0, 'a'], [1, 1]] }] }), /walls\[0\], point 0/);
});

test('un fichier écrit à la main reçoit ses identifiants et survit à un aller-retour', () => {
  const s = normalizeScene({
    name: 'Main', image: 'a.png', grid: { cols: 75, rows: 75 },
    walls: [{ points: [[0, 0], [5, 0]] }, { kind: 'door', group: 'levier-bleu', points: [[5, 0], [7, 0]] }, { id: 'w1', points: [[7, 0], [9, 0]] }],
  });
  assert.equal(new Set(s.walls.map(w => w.id)).size, 3);
  assert.equal(s.grid.feetPerCell, 5);
  assert.deepEqual(normalizeScene(JSON.parse(serializeScene(s))), s);
  assert.equal(serializeScene(s).split('\n').filter(l => l.includes('"points"')).length, 3, 'une entrée par ligne');
});

test('les extrémités presque jointes sont soudées, un mur posé sur un autre y crée un sommet', () => {
  const welded = weldWalls([
    { id: 'a', kind: 'wall', points: [[0, 0], [5, 0]] },
    { id: 'b', kind: 'wall', points: [[5.01, 0.005], [5, 5]] },
    { id: 'c', kind: 'wall', points: [[2, 0.01], [2, 3]] },
  ]);
  assert.deepEqual(welded[1].points[0], [5, 0]);
  assert.deepEqual(welded[0].points, [[0, 0], [2, 0.01], [5, 0]]);
});

test('une extrémité libre est signalée, une boucle fermée non', () => {
  const s = normalizeScene({
    grid: { cols: 10, rows: 10 },
    walls: [
      { id: 'room', points: [[1, 1], [4, 1], [4, 4], [1, 4], [1, 1]] },
      { id: 'free', points: [[6, 6], [8, 6]] },
    ],
  });
  const { dangling } = wallIssues(s);
  assert.deepEqual(dangling.map(d => d.wall), ['free', 'free']);
});

test('un mur qui finit au bord de l\'image n\'a rien de libre', () => {
  const s = normalizeScene({ grid: { cols: 10, rows: 10 }, walls: [{ id: 'a', points: [[0, 5], [5, 5]] }] });
  assert.deepEqual(wallIssues(s).dangling.map(d => [d.x, d.y]), [[5, 5]]);
});

test('la gomme coupe une ligne brisée en deux, une porte ouvre le mur qu\'elle recouvre', () => {
  const walls = [{ id: 'a', kind: 'wall', points: [[0, 0], [2, 0], [4, 0], [6, 0]] }];
  const erased = eraseSegments(walls, [{ wall: 'a', seg: 1 }]);
  assert.deepEqual(erased.map(w => w.points), [[[0, 0], [2, 0]], [[4, 0], [6, 0]]]);
  assert.notEqual(erased[0].id, erased[1].id);

  const long = [{ id: 'm', kind: 'wall', points: [[0, 0], [10, 0], [10, 5]] }];
  const cut = cutWallsUnder(long, [4, 0], [6, 0]);
  assert.deepEqual(cut.map(w => w.points), [[[0, 0], [4, 0]], [[6, 0], [10, 0], [10, 5]]]);
  assert.deepEqual(cutWallsUnder(long, [4, 1], [6, 1]), long, 'une porte à côté du mur n\'y touche pas');
});

test('la vue s\'arrête au mur et à la porte fermée, pas à la porte ouverte', () => {
  const closed = indexOf(twoRooms(false));
  const open = indexOf(twoRooms(true));
  const p = visibilityPolygon(closed, 5, 5);
  assert.ok(pointInPolygon(p, 9, 5));
  assert.ok(!pointInPolygon(p, 11, 5), 'porte fermée');
  assert.ok(!pointInPolygon(p, 15, 2), 'derrière le mur');
  assert.ok(!lineOfSight(closed, 5, 5, 15, 5));

  const q = visibilityPolygon(open, 5, 5);
  assert.ok(pointInPolygon(q, 15, 5), 'dans l\'axe de la porte ouverte');
  assert.ok(!pointInPolygon(q, 11, 0.5), 'le long du mur, derrière l\'angle');
  assert.ok(lineOfSight(open, 5, 5, 15, 5));
});

test('aucun rayon ne fuit par un angle soudé', () => {
  const s = normalizeScene({
    grid: { cols: 30, rows: 30 },
    walls: [{ id: 'r', points: [[5, 5], [15, 5], [15, 15], [5, 15], [5, 5]] }],
  });
  const ix = indexOf(s);
  for (const [ox, oy] of [[10, 10], [6, 6], [14.5, 5.5], [5.5, 14.5], [7.25, 11.75]]) {
    const p = visibilityPolygon(ix, ox, oy);
    for (let i = 0; i < p.length; i += 2) {
      assert.ok(p[i] >= 5 - 1e-3 && p[i] <= 15 + 1e-3 && p[i + 1] >= 5 - 1e-3 && p[i + 1] <= 15 + 1e-3, `sommet hors de la pièce depuis ${ox},${oy} : ${p[i]},${p[i + 1]}`);
    }
  }
});

test('le contour reste léger et le calcul rapide avec beaucoup de murs', () => {
  const walls = [];
  for (let i = 0; i < 40; i++) {
    for (let j = 0; j < 40; j++) walls.push({ points: [[i * 2 + 1, j * 2 + 1], [i * 2 + 1.5, j * 2 + 1]] });
  }
  const s = normalizeScene({ grid: { cols: 82, rows: 82 }, walls });
  const ix = indexOf(s);
  const t0 = performance.now();
  const p = visibilityPolygon(ix, 40.25, 40.5);
  const ms = performance.now() - t0;
  assert.ok(p.length / 2 < 3000, `trop de sommets : ${p.length / 2}`);
  assert.ok(ms < 500, `trop lent : ${ms} ms`);

  const single = normalizeScene({ grid: { cols: 20, rows: 20 }, walls: [{ points: [[0, 10], [20, 10]] }] });
  assert.ok(visibilityPolygon(indexOf(single), 5, 5).length / 2 <= 8, 'un mur droit ne coûte que ses extrémités');
});

function fightDoc(rng) {
  return new MapDoc(twoRooms(false), {}, { rng });
}

test('un déplacement révèle, la pièce d\'à côté reste noire, et l\'annulation oublie ce qu\'il a révélé', () => {
  const m = fightDoc();
  const u = m.apply({ type: 'token.add', tokens: [{ id: 'pc', kind: 'pc', name: 'Ren', x: 5, y: 5 }, { id: 'e', kind: 'enemy', name: 'Gobelin', x: 15, y: 5 }] });
  assert.equal(u.add.pc.length, 1, 'le PJ voit');
  assert.ok(!u.add.e, 'l\'ennemi n\'éclaire rien');
  let v = computeView(m.doc);
  assert.ok(!v.seen.has('e'), 'porte fermée : ennemi caché');
  assert.ok(v.seen.has('pc'));

  const door = m.apply({ type: 'door.toggle', id: 'd1' });
  assert.equal(door.add.pc.length, 1, 'la porte ouverte révèle la suite');
  v = computeView(m.doc);
  assert.ok(v.seen.has('e'), 'porte ouverte : ennemi visible');
  assert.equal(m.doc.explored.pc.length, 2);

  m.undo();
  assert.equal(m.doc.explored.pc.length, 1, 'annuler la porte oublie ce qu\'elle a montré');
  assert.equal(m.doc.walls.find(w => w.id === 'd1').open, false);
  const redo = m.redo();
  assert.equal(m.doc.explored.pc.length, 2, 'rétablir le rend');
  assert.equal(redo.add.pc.length, 1);
});

test('revenir à une position connue n\'ajoute rien, et le gel de la TV ne révèle pas', () => {
  const m = fightDoc();
  m.apply({ type: 'token.add', tokens: [{ id: 'pc', kind: 'pc', name: 'Ren', x: 5, y: 5 }] });
  m.apply({ type: 'token.move', moves: [{ id: 'pc', x: 3, y: 3 }] });
  m.apply({ type: 'token.move', moves: [{ id: 'pc', x: 5, y: 5 }] });
  assert.equal(m.doc.explored.pc.length, 2);

  m.apply({ type: 'frozen.set', value: true });
  m.apply({ type: 'token.move', moves: [{ id: 'pc', x: 8, y: 8 }] });
  assert.equal(m.doc.explored.pc.length, 2, 'gelée : rien de révélé');
  const thaw = m.apply({ type: 'frozen.set', value: false });
  assert.equal(thaw.add.pc.length, 1, 'dégelée : la position finale seulement');
});

test('un ennemi caché ne se voit jamais, un token peut donner la vue, et la vue d\'un seul token isole', () => {
  const s = normalizeScene({ grid: { cols: 20, rows: 10 }, walls: [{ id: 'm', points: [[10, 0], [10, 10]] }] });
  const m = new MapDoc(s);
  m.apply({ type: 'token.add', tokens: [
    { id: 'a', kind: 'pc', name: 'A', x: 2, y: 5 },
    { id: 'b', kind: 'pc', name: 'B', x: 18, y: 5 },
    { id: 'e', kind: 'enemy', name: 'E', x: 4, y: 5, hidden: true },
    { id: 'f', kind: 'enemy', name: 'F', x: 16, y: 5 },
    { id: 'pet', kind: 'ally', name: 'P', x: 3, y: 2 },
  ] });
  let v = computeView(m.doc);
  assert.ok(!v.seen.has('e'), 'caché, malgré la ligne de vue');
  assert.ok(v.seen.has('f'), 'B le voit');
  assert.equal(v.sources.length, 2);
  assert.ok(!m.doc.explored.pet, 'un allié ne donne pas la vue par défaut');
  m.apply({ type: 'token.update', id: 'pet', patch: { vision: true } });
  assert.equal(m.doc.explored.pet.length, 1);

  m.apply({ type: 'view.set', mode: 'token', tokenId: 'a' });
  v = computeView(m.doc);
  assert.deepEqual(v.sources.map(t => t.id), ['a']);
  assert.ok(!v.seen.has('b'), 'le coéquipier derrière le mur disparaît');
  assert.ok(!v.seen.has('f'));
  assert.equal(v.explored.length, 1, 'seulement la mémoire de ce token');

  m.apply({ type: 'token.update', id: 'e', patch: { hidden: false } });
  assert.ok(computeView(m.doc).seen.has('e'), 'révélé en un clic');
});

test('la TV n\'écrit un nom que sous un token ouvert par le MJ et vu par le groupe', () => {
  const s = normalizeScene({ grid: { cols: 20, rows: 10 }, walls: [{ id: 'm', points: [[10, 0], [10, 10]] }] });
  // Un token d'une scène enregistrée avant l'option n'a pas le champ : il reste sans nom.
  const m = new MapDoc(s, { tokens: [{ id: 'old', kind: 'enemy', name: 'Ancien', x: 5, y: 2, size: 1 }] });
  m.apply({ type: 'token.add', tokens: [
    { id: 'a', kind: 'pc', name: 'A', x: 2, y: 5 },
    { id: 'e', kind: 'enemy', name: 'Gobelin', x: 4, y: 5, notes: 'Secret du MJ', hp: { current: 3, max: 7 } },
    { id: 'h', kind: 'enemy', name: 'Assassin', x: 6, y: 5, hidden: true },
    { id: 'far', kind: 'enemy', name: 'Derrière le mur', x: 16, y: 5 },
  ] });
  const names = () => namesOnTv(m.doc, computeView(m.doc).seen).map(t => t.id);
  assert.equal(m.doc.tokens.find(t => t.id === 'e').showName, false, 'éteint par défaut');
  assert.deepEqual(names(), [], 'aucun nom tant que le MJ n\'en ouvre pas');

  m.apply({ type: 'token.update', ids: ['old', 'e', 'h', 'far'], patch: { showName: 'oui' } });
  assert.equal(m.doc.tokens.find(t => t.id === 'e').showName, true, 'le champ reste un booléen');
  assert.deepEqual(names().sort(), ['e', 'old'], 'ni le token caché ni celui hors de vue');

  m.apply({ type: 'token.update', id: 'h', patch: { hidden: false } });
  assert.ok(names().includes('h'), 'révélé, son nom suit');
  m.undo();
  assert.ok(!names().includes('h'), 'annuler le recache');

  m.apply({ type: 'token.update', id: 'e', patch: { showName: false } });
  assert.ok(!names().includes('e'));
  m.apply({ type: 'token.update', id: 'e', patch: { showName: true } });
  assert.ok(names().includes('e'));
  m.apply({ type: 'token.update', id: 'e', patch: { name: '   ' } });
  assert.ok(!names().includes('e'), 'un nom vide ne dessine pas d\'étiquette');
});

test('dégâts et soins rapides : les PV restent entre 0 et le maximum, et s\'annulent', () => {
  const m = new MapDoc(normalizeScene({ grid: { cols: 10, rows: 10 } }));
  m.apply({ type: 'token.add', tokens: [
    { id: 'a', kind: 'enemy', name: 'A', x: 1, y: 1, hp: { current: 10, max: 12 } },
    { id: 'b', kind: 'enemy', name: 'B', x: 2, y: 1, hp: { current: 3, max: 7 } },
    { id: 'n', kind: 'npc', name: 'Sans PV', x: 3, y: 1 },
  ] });
  const hp = id => m.doc.tokens.find(t => t.id === id).hp;
  m.apply({ type: 'token.hp', ids: ['a', 'b', 'n'], delta: -5 });
  assert.deepEqual(hp('a'), { current: 5, max: 12 });
  assert.deepEqual(hp('b'), { current: 0, max: 7 }, 'jamais sous 0');
  assert.equal(hp('n'), null, 'un token sans PV suivis reste sans PV');
  m.apply({ type: 'token.hp', id: 'a', delta: 40 });
  assert.equal(hp('a').current, 12, 'jamais au-dessus du maximum');
  m.undo();
  assert.equal(hp('a').current, 5);
  assert.throws(() => m.apply({ type: 'token.hp', id: 'a', delta: 'beaucoup' }), SceneError);
  assert.equal(m.doc.tokens.find(t => t.id === 'a').showHp, false, 'la barre sur la TV est éteinte par défaut');
});

test('la TV ne reçoit ni token caché, ni PV exacts, ni notes, et une barre seulement si le MJ l\'ouvre', () => {
  const s = normalizeScene({ grid: { cols: 20, rows: 10 }, walls: [{ id: 'm', points: [[10, 0], [10, 10]] }] });
  const m = new MapDoc(s);
  m.apply({ type: 'token.add', tokens: [
    { id: 'a', kind: 'pc', name: 'A', x: 2, y: 5, hp: { current: 20, max: 20 }, showHp: true },
    { id: 'e', kind: 'enemy', name: 'Gobelin', x: 4, y: 5, hp: { current: 3, max: 7 }, notes: 'Secret du MJ', ref: { t: 'beast', id: 'gob' }, showHp: true },
    { id: 'off', kind: 'enemy', name: 'Sans barre', x: 5, y: 5, hp: { current: 5, max: 9 } },
    { id: 'h', kind: 'enemy', name: 'Assassin', x: 6, y: 5, hp: { current: 30, max: 30 }, hidden: true, showHp: true, showName: true },
    { id: 'far', kind: 'enemy', name: 'Loin', x: 16, y: 5, hp: { current: 8, max: 8 }, showHp: true },
  ] });
  const tv = tvTokens(m.doc.tokens);
  assert.deepEqual(tv.map(t => t.id), ['a', 'e', 'off', 'far'], 'le token caché n\'est pas envoyé');
  for (const t of tv) {
    assert.ok(!('hp' in t) && !('notes' in t) && !('ref' in t), `${t.id} : rien que le MJ garde`);
    assert.ok(!JSON.stringify(t).includes('Secret'));
  }
  const e = tv.find(t => t.id === 'e');
  assert.equal(e.hpBar, 0.45, '3 / 7 arrondi au vingtième');
  assert.equal(tv.find(t => t.id === 'off').hpBar, null, 'barre éteinte : rien du tout');

  assert.equal(hpBarOf({ hp: { current: 1, max: 200 } }), 0.05, 'encore debout : un trait de barre');
  assert.equal(hpBarOf({ hp: { current: 0, max: 200 } }), 0);
  assert.equal(hpBarOf({ hp: null }), null);

  const doc = { ...m.doc, tokens: tv };
  const seen = computeView(doc).seen;
  assert.deepEqual(barsOnTv(doc, seen).map(t => t.id), ['a', 'e'], 'pas de barre hors de vue');

  // Les messages du serveur : la scène complète et les mises à jour des tokens passent par le même filtre.
  const scene = forTv({ t: 'scene', scene: 'x', doc: m.doc });
  assert.deepEqual(scene.doc.tokens, tv);
  assert.equal(m.doc.tokens.length, 5, 'le document du MJ n\'est pas touché');
  const u = forTv({ t: 'update', scene: 'x', ...m.apply({ type: 'token.hp', id: 'e', delta: -1 }) });
  assert.equal(u.set.tokens.find(t => t.id === 'e').hpBar, 0.3);
  assert.ok(!JSON.stringify(u).includes('"current"'));
  const walls = { t: 'update', set: { walls: [] } };
  assert.equal(forTv(walls), walls, 'sans tokens, le message passe tel quel');
});

test('une porte d\'un groupe ouvre toutes les portes de ce groupe', () => {
  const s = normalizeScene({
    grid: { cols: 20, rows: 10 },
    walls: [
      { id: 'a', kind: 'door', group: 'levier-bleu', points: [[1, 1], [2, 1]] },
      { id: 'b', kind: 'door', group: 'levier-bleu', points: [[5, 1], [6, 1]] },
      { id: 'c', kind: 'door', group: 'levier-rouge', points: [[8, 1], [9, 1]] },
    ],
  });
  const m = new MapDoc(s);
  m.apply({ type: 'door.toggle', id: 'a' });
  assert.deepEqual(m.doc.walls.map(w => w.open), [true, true, false]);
});

test('une porte tracée sur un mur l\'ouvre, le déplacement d\'un sommet garde les murs joints', () => {
  const s = normalizeScene({ grid: { cols: 20, rows: 10 }, walls: [
    { id: 'm', points: [[0, 5], [20, 5]] },
    { id: 'n', points: [[10, 5], [10, 9]] },
  ] });
  const m = new MapDoc(s);
  m.apply({ type: 'wall.moveVertex', from: [10, 5], to: [11, 5] });
  assert.deepEqual(m.doc.walls.find(w => w.id === 'n').points[0], [11, 5]);
  assert.ok(m.doc.walls.find(w => w.id === 'm').points.some(p => p[0] === 11 && p[1] === 5));
  m.apply({ type: 'wall.add', kind: 'door', points: [[3, 5], [5, 5]] });
  assert.ok(lineOfSight(indexOf(m.doc), 4, 1, 4, 9) === false, 'fermée, elle bloque');
  const door = m.doc.walls.find(w => w.kind === 'door');
  m.apply({ type: 'door.toggle', id: door.id });
  assert.ok(lineOfSight(indexOf(m.doc), 4, 1, 4, 9), 'ouverte, plus rien ne bloque : le mur dessous est coupé');
});

test('initiative : un jet par groupe, le plus haut modificateur, les PJ en attente de leur nombre', () => {
  const m = fightDoc(dice(10, 1, 5, 5));
  m.apply({ type: 'token.add', tokens: [
    { id: 'p1', kind: 'pc', name: 'Ren', x: 1, y: 1 },
    { id: 'p2', kind: 'pc', name: 'Brakka', x: 2, y: 1 },
    { id: 'g1', kind: 'enemy', name: 'Stirge', x: 3, y: 1, init: 3 },
    { id: 'g2', kind: 'enemy', name: 'Stirge', x: 4, y: 1, init: 3 },
    { id: 'o', kind: 'enemy', name: 'Otyugh', x: 5, y: 1, init: 0 },
    { id: 'h', kind: 'enemy', name: 'Harpy', x: 6, y: 1, init: 1 },
  ] });
  m.apply({ type: 'fight.new' });
  assert.deepEqual(m.doc.fight.rows.map(r => r.name), ['Ren', 'Brakka']);
  assert.ok(m.doc.fight.rows.every(r => r.total === null));

  m.apply({ type: 'fight.addGroup', tokenIds: ['g1', 'g2', 'o'], name: 'Coin nord' });
  const group = m.doc.fight.rows.find(r => r.name === 'Coin nord');
  assert.equal(group.mod, 3, 'le plus haut du groupe');
  assert.equal(group.total, group.roll + 3);
  assert.equal(m.doc.fight.rows[0].id, group.id, 'les lignes sans nombre restent en bas');

  m.apply({ type: 'fight.addEach', tokenIds: ['h'] });
  const harpy = m.doc.fight.rows.find(r => r.name === 'Harpy');
  assert.deepEqual(harpy.tokenIds, ['h']);

  const ren = m.doc.fight.rows.find(r => r.name === 'Ren');
  m.apply({ type: 'fight.row', rowId: ren.id, patch: { total: 25 } });
  assert.equal(m.doc.fight.rows[0].name, 'Ren', 'le nombre saisi classe la ligne');

  // Déplacer un token vers un autre groupe le retire du premier.
  m.apply({ type: 'fight.addToRow', rowId: harpy.id, tokenIds: ['o'] });
  assert.deepEqual(m.doc.fight.rows.find(r => r.name === 'Coin nord').tokenIds, ['g1', 'g2']);
});

test('initiative : un groupe vaincu reste affiché et son tour est sauté, le token reste sur la carte', () => {
  const m = fightDoc(dice(20, 10));
  m.apply({ type: 'token.add', tokens: [
    { id: 'p', kind: 'pc', name: 'Ren', x: 1, y: 1 },
    { id: 'g1', kind: 'enemy', name: 'Stirge', x: 3, y: 1 },
    { id: 'g2', kind: 'enemy', name: 'Stirge', x: 4, y: 1 },
  ] });
  m.apply({ type: 'fight.new' });
  m.apply({ type: 'fight.addGroup', tokenIds: ['g1', 'g2'], name: 'Stirges' });
  const pc = m.doc.fight.rows.find(r => r.kind === 'pc');
  m.apply({ type: 'fight.row', rowId: pc.id, patch: { total: 5 } });
  m.apply({ type: 'fight.start' });
  const stirges = m.doc.fight.rows.find(r => r.name === 'Stirges');
  assert.equal(m.doc.fight.current, stirges.id);
  assert.equal(m.doc.fight.round, 1);

  m.apply({ type: 'token.update', ids: ['g1'], patch: { defeated: true } });
  m.apply({ type: 'fight.next' });
  assert.equal(m.doc.fight.current, pc.id);
  m.apply({ type: 'fight.next' });
  assert.equal(m.doc.fight.current, stirges.id, 'un seul vaincu : le groupe joue encore');
  assert.equal(m.doc.fight.round, 2);

  m.apply({ type: 'token.update', ids: ['g2'], patch: { defeated: true } });
  m.apply({ type: 'fight.next' });
  m.apply({ type: 'fight.next' });
  assert.equal(m.doc.fight.current, pc.id, 'tous vaincus : tour sauté');
  assert.equal(m.doc.fight.round, 3);
  assert.ok(tracker.isOut(m.doc.fight.rows.find(r => r.id === stirges.id), m.doc.tokens));
  assert.equal(m.doc.fight.rows.length, 2, 'la ligne reste');
  assert.equal(m.doc.tokens.length, 3, 'les tokens restent');

  m.apply({ type: 'fight.prev' });
  assert.equal(m.doc.fight.round, 2, 'revenir en arrière passe le groupe vaincu et rend le round');
  m.apply({ type: 'fight.end' });
  assert.equal(m.doc.fight, null);
  assert.equal(m.doc.tokens.length, 3, 'la fin du combat ne touche pas à la carte');
});

test('supprimer un token le retire de son groupe, et passe le tour si la ligne disparaît', () => {
  const m = fightDoc(dice(20, 10, 5));
  m.apply({ type: 'token.add', tokens: [{ id: 'a', name: 'A', x: 1, y: 1 }, { id: 'b', name: 'B', x: 2, y: 1 }] });
  m.apply({ type: 'fight.addEach', tokenIds: ['a', 'b'] });
  m.apply({ type: 'fight.start' });
  const first = m.doc.fight.current;
  const firstToken = m.doc.fight.rows.find(r => r.id === first).tokenIds[0];
  m.apply({ type: 'token.remove', ids: [firstToken] });
  assert.equal(m.doc.fight.rows.length, 1);
  assert.equal(m.doc.fight.current, m.doc.fight.rows[0].id);
});

test('les clients reconstruisent le même état à partir des mises à jour', () => {
  const m = fightDoc();
  const copy = structuredClone(m.doc);
  const updates = [];
  const push = u => { if (u) updates.push(u); };
  push(m.apply({ type: 'token.add', tokens: [{ id: 'p', kind: 'pc', name: 'R', x: 5, y: 5 }] }));
  push(m.apply({ type: 'token.move', moves: [{ id: 'p', x: 3, y: 3 }] }));
  push(m.apply({ type: 'door.toggle', id: 'd1' }));
  push(m.undo());
  push(m.undo());
  push(m.redo());
  push(m.apply({ type: 'fog.reset' }));
  push(m.undo());
  for (const u of updates) applyUpdate(copy, JSON.parse(JSON.stringify(u)));
  assert.deepEqual(copy, JSON.parse(JSON.stringify(m.doc)));
});

test('créature : initiative du bloc 2024, sinon DEX ; emprise et lien 5etools', () => {
  assert.equal(initiativeMod({ dex: 9, cr: { cr: '10' }, initiative: { proficiency: 2 } }), -1 + 2 * 4);
  assert.equal(initiativeMod({ dex: 14, cr: '1/4' }), 2);
  assert.equal(initiativeMod({ dex: 14, cr: '1/8', initiative: 5 }), 5);
  assert.equal(initiativeMod({ dex: 19, cr: '8', initiative: { proficiency: 1 } }), 4 + 3);
  assert.equal(initiativeMod({}), 0);
  assert.equal(footprintOf({ size: ['L'] }), 2);
  assert.equal(footprintOf({ size: ['T'] }), 1);
  assert.equal(footprintOf({ size: ['G'] }), 4);
  assert.equal(bestiaryLink('Twig Blight', 'XMM'), 'https://5e.tools/bestiary.html#twig%20blight_xmm');
});

test('une carte sans brouillard montre tout sauf ce qui est caché, et ne garde aucune mémoire', () => {
  const s = normalizeScene({ grid: { cols: 20, rows: 10 }, fog: false, folder: 'Général', walls: [{ id: 'm', points: [[10, 0], [10, 10]] }] });
  assert.equal(s.fog, false);
  assert.deepEqual(normalizeScene(JSON.parse(serializeScene(s))), s, 'le fichier garde fog et folder');
  const m = new MapDoc(s);
  m.apply({ type: 'token.add', tokens: [
    { id: 'p', kind: 'pc', name: 'R', x: 2, y: 5 },
    { id: 'n', kind: 'npc', name: 'Tavernier', x: 15, y: 5 },
    { id: 'h', kind: 'enemy', name: 'Caché', x: 16, y: 5, hidden: true },
  ] });
  const v = computeView(m.doc);
  assert.ok(v.seen.has('n'), 'visible derrière le mur');
  assert.ok(!v.seen.has('h'));
  assert.deepEqual(m.doc.explored, {});
  assert.equal(m.doc.tokens[1].kind, 'npc');
  m.apply({ type: 'scene.set', fog: true, folder: 'Session 8' });
  assert.equal(m.doc.folder, 'Session 8');
  assert.equal(m.doc.explored.p.length, 1, 'remettre le brouillard révèle depuis les PJ');
  assert.ok(!computeView(m.doc).seen.has('n'));
});

test('les dossiers se rangent : Général, puis les sessions dans l\'ordre', () => {
  assert.deepEqual(sortFolders(['Session 10', 'Autre', 'Sessions 5-6', 'Général', 'Session 2']), ['Général', 'Session 2', 'Sessions 5-6', 'Session 10', 'Autre']);
});

test('un token garde son orientation, et le groupe partage une mémoire de ce qu\'il a déjà vu', () => {
  const s = normalizeScene({ grid: { cols: 20, rows: 10 } });
  const m = new MapDoc(s, { explored: { _party: [{ k: 'import', p: [10, 0, 12, 0, 12, 2, 10, 2] }] } });
  m.apply({ type: 'token.add', tokens: [{ id: 'p', kind: 'pc', name: 'R', x: 2, y: 5, rotation: 375 }] });
  assert.equal(m.doc.tokens[0].rotation, 15);
  m.apply({ type: 'token.update', id: 'p', patch: { rotation: -30 } });
  assert.equal(m.doc.tokens[0].rotation, 330);
  assert.equal(computeView(m.doc).explored.length, 2);
  m.apply({ type: 'fog.reset' });
  assert.equal(computeView(m.doc).explored.length, 1, 'remise à zéro : il ne reste que la vue actuelle');
});
