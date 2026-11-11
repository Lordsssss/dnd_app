import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { Engine } from '../server/engine.js';
import { blankCharacter } from '../shared/model.js';

function setup({ secretDeathSaves = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-eng-'));
  const db = openDb(path.join(dir, 'f.sqlite'));
  const settings = { c1: { secretDeathSaves }, c2: { secretDeathSaves } };
  const engine = new Engine({ db, settingsOf: cid => settings[cid] || {}, random: () => 15 }).load();
  const a = engine.createCharacter({ ...blankCharacter({ name: 'Ren', className: 'Wizard', level: 5 }), secret: { text: 'Je suis un isekai', goals: '', drawing: {} } }, { campaign: 'c1', owner: 'u1' });
  const b = engine.createCharacter(blankCharacter({ name: 'Brakka', className: 'Warlock', level: 5 }), { campaign: 'c1', owner: 'u2' });
  const x = engine.createCharacter(blankCharacter({ name: 'Autre', className: 'Fighter', level: 2 }), { campaign: 'c2', owner: 'u1' });
  const events = [];
  engine.on('patch', e => events.push(e));
  return {
    dir, db, engine, a, b, x, events, settings,
    pa: { id: 'k1', role: 'player', charId: a, campaign: 'c1' },
    pb: { id: 'k2', role: 'player', charId: b, campaign: 'c1' },
    dm: { id: 'k3', role: 'dm', charId: null, campaign: 'c1' },
    other: { id: 'k4', role: 'dm', charId: null, campaign: 'c2' },
  };
}

test('la page secrète ne part jamais chez les autres joueurs', () => {
  const { engine, a, pa, pb, dm } = setup();
  assert.equal(engine.stateFor(pb).chars[a].data.secret, undefined);
  assert.equal(engine.stateFor(pa).chars[a].data.secret.text, 'Je suis un isekai');
  assert.equal(engine.stateFor(dm).chars[a].data.secret.text, 'Je suis un isekai');
  const patches = [[['secret', 'text'], 'x'], [['hp', 'current'], 3]];
  assert.deepEqual(engine.filterPatches(pb, a, patches), [[['hp', 'current'], 3]]);
  assert.equal(engine.filterPatches(dm, a, patches).length, 2);
});

test('permissions : sa fiche pour un joueur, toutes les fiches de sa campagne pour le MJ', () => {
  const { engine, a, b, pa, dm } = setup();
  assert.throws(() => engine.handleSet(pa, { doc: b, ops: [[['hp', 'current'], 1]] }), /pas ta fiche/);
  engine.handleSet(dm, { doc: a, ops: [[['hp', 'current'], 1]] });
  assert.equal(engine.docs.get(a).data.hp.current, 1);
  assert.throws(() => engine.handleSet(pa, { doc: a, ops: [[['meta', 'x'], 1]] }), /non modifiable/);
  assert.throws(() => engine.handleSet(pa, { doc: a, ops: [[['__proto__', 'x'], 1]] }), /invalide/);
  assert.throws(() => engine.handleAction(pa, { doc: b, name: 'damage', args: { amount: 1 } }), /pas ta fiche/);
  engine.handleSet(pa, { doc: a, ops: [[['hp', 'current'], 7]] });
  assert.equal(engine.docs.get(a).data.hp.current, 7);
});

test('harmonisation limitée à 3 côté serveur', () => {
  const { engine, a, pa } = setup();
  for (const k of ['i1', 'i2', 'i3', 'i4']) engine.handleSet(pa, { doc: a, ops: [[['inventory', k], { name: k, qty: 1, attunement: true }]] });
  for (const k of ['i1', 'i2', 'i3']) engine.handleSet(pa, { doc: a, ops: [[['inventory', k, 'attuned'], true]] });
  assert.throws(() => engine.handleSet(pa, { doc: a, ops: [[['inventory', 'i4', 'attuned'], true]] }), /Maximum 3/);
  assert.equal(engine.docs.get(a).data.inventory.i4.attuned, undefined, 'valeur annulée');
});

test('les sorts préparés ne sont jamais bloqués : la fiche avertit, le joueur décide', () => {
  const { engine, a, pa } = setup();
  engine.handleSet(pa, { doc: a, ops: [[['abilities', 'int'], 10]] });
  for (let i = 0; i < 20; i++) engine.handleSet(pa, { doc: a, ops: [[['spells', `s${i}`], { name: `S${i}`, level: 1, prepared: true }]] });
  assert.equal(Object.values(engine.docs.get(a).data.spells).filter(s => s.prepared).length, 20);
});

test('une campagne ne voit ni ne touche les fiches d’une autre', () => {
  const { engine, a, x, other, dm } = setup();
  assert.deepEqual(Object.keys(engine.stateFor(other).chars), [x]);
  assert.ok(!Object.keys(engine.stateFor(dm).chars).includes(x));
  assert.throws(() => engine.handleSet(other, { doc: a, ops: [[['hp', 'current'], 1]] }), /introuvable/);
  assert.throws(() => engine.handleAction(other, { doc: a, name: 'damage', args: { amount: 1 } }), /introuvable/);
  assert.equal(engine.visibleTo(other, a), false);
});

test('jets de mort secrets : le MJ seul voit le décompte, le serveur lance le dé', () => {
  const { engine, a, pa, pb, dm } = setup();
  const rolls = [];
  engine.on('roll', r => rolls.push(r));
  engine.handleAction(pa, { doc: a, name: 'damage', args: { amount: 999 } });
  assert.equal(engine.stateFor(pa).chars[a].data.deathSaves, undefined, 'même le joueur ne voit pas ses jets');
  assert.equal(engine.stateFor(pb).chars[a].data.deathSaves, undefined);
  assert.deepEqual(engine.stateFor(dm).chars[a].data.deathSaves, { success: 0, fail: 0 });
  const r = engine.handleAction(pa, { doc: a, name: 'deathSave', args: { roll: 1 } });
  assert.equal(engine.docs.get(a).data.deathSaves.success, 1, 'le d20 du serveur (15) remplace celui du navigateur');
  assert.ok(!/Succès|1\/3/.test(r.toast || ''), `rien du décompte dans le message : ${r.toast}`);
  assert.equal(rolls.at(-1).private, true);
  assert.deepEqual(engine.filterPatches(pa, a, [[['deathSaves', 'success'], 1]]), []);
  assert.throws(() => engine.handleSet(pa, { doc: a, ops: [[['deathSaves', 'fail'], 0]] }), /secrets/);
});

test('jets de mort publics quand la campagne le choisit', () => {
  const { engine, a, pb } = setup({ secretDeathSaves: false });
  assert.deepEqual(engine.stateFor(pb).chars[a].data.deathSaves, { success: 0, fail: 0 });
});

test('annuler / rétablir, y compris un repos', () => {
  const { engine, a, pa } = setup();
  const doc = () => engine.docs.get(a).data;
  engine.handleAction(pa, { doc: a, name: 'damage', args: { amount: 4 } });
  const hpAfter = doc().hp.current;
  engine.handleAction(pa, { doc: a, name: 'longRest', args: {} });
  assert.equal(doc().hp.current, doc().hp.max);
  engine.handleUndo(pa, { doc: a });
  assert.equal(doc().hp.current, hpAfter, 'le repos est annulé');
  engine.handleUndo(pa, { doc: a, redo: true });
  assert.equal(doc().hp.current, doc().hp.max);
  // Saisie rapide fusionnée en une seule entrée d'annulation.
  engine.handleSet(pa, { doc: a, ops: [[['notes', 'free'], 'a']] });
  engine.handleSet(pa, { doc: a, ops: [[['notes', 'free'], 'ab']] });
  engine.handleSet(pa, { doc: a, ops: [[['notes', 'free'], 'abc']] });
  engine.handleUndo(pa, { doc: a });
  assert.equal(doc().notes.free, '');
});

test('annuler une ancienne modification d’un objet donné ne le duplique pas', () => {
  const { engine, a, b, pa } = setup();
  engine.handleSet(pa, { doc: a, ops: [[['inventory', 'x'], { name: 'Rope', qty: 1 }]] });
  engine.handleSet(pa, { doc: a, ops: [[['inventory', 'x', 'notes'], 'nouée']] });
  engine.handleAction(pa, { doc: a, name: 'transfer', args: { from: a, to: b, itemId: 'x', qty: 1 } });
  engine.handleUndo(pa, { doc: a });
  assert.equal(engine.docs.get(a).data.inventory.x, undefined);
  assert.equal(Object.values(engine.docs.get(b).data.inventory).length, 1);
});

test('dessin : pile d’annulation séparée', () => {
  const { engine, a, pa } = setup();
  engine.handleSet(pa, { doc: a, ops: [[['drawings', 'notes', 's1'], { c: 'k', w: 2, p: [1, 1, 0.5, 5, 5, 0.5] }]] });
  engine.handleSet(pa, { doc: a, ops: [[['hp', 'current'], 2]] });
  engine.handleUndo(pa, { doc: a, stack: 'draw:notes' });
  assert.deepEqual(engine.docs.get(a).data.drawings.notes, {});
  assert.equal(engine.docs.get(a).data.hp.current, 2);
});

test('persistance SQLite', () => {
  const { engine, a, pa, db, dir } = setup();
  engine.handleSet(pa, { doc: a, ops: [[['name'], 'Ilya Voss']] });
  engine.flush();
  db.close();
  const db2 = openDb(path.join(dir, 'f.sqlite'));
  const e2 = new Engine({ db: db2 }).load();
  assert.equal(e2.docs.get(a).data.name, 'Ilya Voss');
  assert.equal(e2.docs.get(a).campaign, 'c1');
  assert.equal(e2.docs.get(a).owner, 'u1');
  db2.close();
});
