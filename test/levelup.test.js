import { featuresText } from '../shared/features.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankCharacter } from '../shared/model.js';
import { clone } from '../shared/patch.js';
import { CLASSES } from '../shared/classes.js';
import { applyLevelUp, levelUpOptions, LevelUpError } from '../shared/levelup.js';
import { CHAR_ACTIONS } from '../shared/actions.js';

test('chaque classe monte de 1 à 20 sans erreur', () => {
  for (const key of Object.keys(CLASSES)) {
    const d = blankCharacter({});
    applyLevelUp(d, { newClass: key });
    for (let l = 2; l <= 20; l++) {
      const o = levelUpOptions(d, { classIndex: 0 });
      applyLevelUp(d, { classIndex: 0, hpBase: Math.ceil(o.target.hitDie / 2), subclass: o.subclassNeeded ? o.subclasses[0] : '' });
    }
    assert.equal(d.classes[0].level, 20, key);
    assert.ok(d.classes[0].subclass, `${key} : sous-classe choisie au niveau 3`);
  }
});

test('Wizard : sous-classe au 3, deux sorts de grimoire, emplacements', () => {
  const d = blankCharacter({ className: 'Wizard', level: 2 });
  const o = levelUpOptions(d, { classIndex: 0 });
  assert.equal(o.subclassNeeded, true);
  assert.equal(o.spells.leveled, 2);
  assert.equal(o.spells.maxLevel, 2);
  applyLevelUp(d, { classIndex: 0, subclass: 'Illusionist', hpBase: 4, spells: [{ name: 'Web', level: 2, source: 'XPHB' }] });
  assert.equal(d.classes[0].subclass, 'Illusionist');
  assert.equal(d.spellcasting.slots[2].max, 2);
  assert.ok(Object.values(d.spells).some(s => s.name === 'Web' && !s.prepared));
  assert.throws(() => applyLevelUp(clone(d), { classIndex: 0, hpBase: 4, spells: [{ name: 'Fireball', level: 3 }] }), LevelUpError);
});

test('ASI : +2, CON rétroactive sur les PV, plafond 20', () => {
  const f = blankCharacter({ className: 'Fighter', level: 3 });
  f.abilities.con = 15;
  f.hp = { max: 30, current: 30, temp: 0 };
  const r = applyLevelUp(f, { classIndex: 0, hpBase: 6, asi: { mode: 'asi11', a1: 'con', a2: 'str' } });
  assert.equal(f.abilities.con, 16);
  assert.equal(f.hp.max, 30 + 6 + 3 + 3, 'dé + nouveau CON + 1 PV par niveau précédent');
  assert.equal(r.hpChange, 12);
  const g = blankCharacter({ className: 'Fighter', level: 3 });
  g.abilities.str = 19;
  assert.throws(() => applyLevelUp(g, { classIndex: 0, hpBase: 6, asi: { mode: 'asi2', a1: 'str' } }), /20/);
});

test('multiclasse : prérequis, emplacements combinés, maîtrises', () => {
  const d = blankCharacter({ className: 'Wizard', level: 4 });
  d.abilities.int = 16; d.abilities.wis = 12;
  const o = levelUpOptions(d, { newClass: 'cleric' });
  assert.equal(o.multiclass.ok, false, 'WIS 12 < 13');
  applyLevelUp(d, { newClass: 'cleric', hpBase: 5, picks: { c1_0: ['Protector'] } });
  assert.equal(d.classes[1].name, 'Cleric');
  assert.deepEqual([1, 2, 3].map(l => d.spellcasting.slots[l].max), [4, 3, 2], 'niveau de lanceur 5');
  assert.match(d.proficiencies, /Medium armor/);
  assert.match(featuresText(d), /Divine Order : Protector/);
  assert.ok(Object.values(d.featureList).some(f => f.name === 'Divine Order' && f.group.startsWith('NIVEAU 5')));
  assert.throws(() => levelUpOptions(d, { newClass: 'wizard' }), /Déjà Wizard/);
});

test('Warlock 11 : Mystic Arcanum ; Eldritch Knight : sorts de tiers lanceur', () => {
  const w = blankCharacter({ className: 'Warlock', subclass: 'Archfey Patron', level: 10 });
  const o = levelUpOptions(w, { classIndex: 0 });
  assert.equal(o.spells.arcanum, 6);
  applyLevelUp(w, { classIndex: 0, hpBase: 5, spells: [{ name: 'Mass Suggestion', level: 6, source: 'XPHB' }] });
  assert.ok(Object.values(w.resources).some(r => r.name === 'Mystic Arcanum (6)'));
  assert.equal(w.spellcasting.pact.max, 3);
  const ek = blankCharacter({ className: 'Fighter', level: 2 });
  const e = levelUpOptions(ek, { classIndex: 0, subclass: 'Eldritch Knight' });
  assert.equal(e.spells.cantrips, 2);
  assert.equal(e.spells.leveled, 3);
  applyLevelUp(ek, { classIndex: 0, subclass: 'Eldritch Knight', hpBase: 6 });
  assert.equal(ek.spellcasting.slots[1].max, 2);
});

test('premier niveau : PV max du dé, sauvegardes, expertise', () => {
  const d = blankCharacter({});
  d.abilities.con = 14;
  applyLevelUp(d, { newClass: 'rogue', expertise: ['stealth', 'perception'] });
  assert.equal(d.hp.max, 10);
  assert.ok(d.saves.dex && d.saves.int);
  assert.equal(d.skills.stealth, 2);
  assert.throws(() => applyLevelUp(clone(d), { classIndex: 0, hpBase: 4, expertise: ['arcana'] }), /Expertise/);
});

test('l’action levelUp accepte encore l’ancien format', () => {
  const f = blankCharacter({ className: 'Fighter', level: 8 });
  f.hp = { max: 60, current: 50, temp: 0 };
  CHAR_ACTIONS.levelUp(f, { classIndex: 0, hpGain: 7 });
  assert.equal(f.hp.max, 67);
});

test('niveau 19 : Epic Boon en 2024, ASI pour l’Artificer de Tasha’s', () => {
  const f = levelUpOptions(blankCharacter({ className: 'Fighter', level: 18 }), { classIndex: 0 });
  assert.equal(f.epic, true);
  assert.equal(f.asi, false);
  const a = levelUpOptions(blankCharacter({ className: 'Artificer', level: 18 }), { classIndex: 0 });
  assert.equal(a.epic, false);
  assert.equal(a.asi, true);
});

test('choix de classe et de sous-classe : Blessed Strikes, Elemental Fury, Champion, Hunter', () => {
  const labels = (cls, lvl, sub = '') => {
    const d = blankCharacter({ className: cls, level: lvl - 1 });
    d.classes[0].subclass = sub;
    return levelUpOptions(d, { classIndex: 0 }).choices.map(c => c.label);
  };
  assert.ok(labels('Cleric', 7).includes('Blessed Strikes'));
  assert.ok(labels('Druid', 7).includes('Elemental Fury'));
  assert.ok(labels('Fighter', 7, 'Champion').includes('Fighting Style'));
  assert.ok(labels('Ranger', 7, 'Hunter').includes('Defensive Tactics'));
  assert.ok(labels('Bard', 3, 'College of Lore').includes('Bonus Proficiencies'));
  assert.deepEqual(labels('Fighter', 7, 'Battle Master'), []);
});

test('Thaumaturge et Magician : un cantrip de plus au niveau 1', () => {
  const base = levelUpOptions(blankCharacter({}), { newClass: 'cleric' }).spells.cantrips;
  const thau = levelUpOptions(blankCharacter({}), { newClass: 'cleric', picks: { c1_0: ['Thaumaturge'] } }).spells.cantrips;
  assert.equal(thau, base + 1);
  const mag = levelUpOptions(blankCharacter({}), { newClass: 'druid', picks: { c1_0: ['Magician'] } }).spells.cantrips;
  assert.equal(mag, levelUpOptions(blankCharacter({}), { newClass: 'druid' }).spells.cantrips + 1);
});

test('Primal Knowledge : une compétence de la liste du Barbarian, maîtrisée', () => {
  const d = blankCharacter({ className: 'Barbarian', level: 2 });
  const o = levelUpOptions(d, { classIndex: 0 });
  const c = o.choices.find(x => x.type === 'skill');
  assert.equal(c.label, 'Primal Knowledge');
  const ok = clone(d);
  applyLevelUp(ok, { classIndex: 0, hpBase: 7, subclass: 'Path of the Berserker', picks: { [c.id]: ['survival'] } });
  assert.equal(ok.skills.survival, 1);
  assert.match(featuresText(ok), /Primal Knowledge : Survival/);
  // Hors liste : ignorée.
  const bad = clone(d);
  applyLevelUp(bad, { classIndex: 0, hpBase: 7, picks: { [c.id]: ['arcana'] } });
  assert.ok(!bad.skills.arcana);
});

test('Scholar : expertise limitée à six compétences', () => {
  const d = blankCharacter({ className: 'Wizard', level: 1 });
  d.skills.arcana = 1; d.skills.stealth = 1;
  applyLevelUp(clone(d), { classIndex: 0, hpBase: 4, expertise: ['arcana'] });
  assert.throws(() => applyLevelUp(clone(d), { classIndex: 0, hpBase: 4, expertise: ['stealth'] }), /Expertise/);
  const done = clone(d);
  applyLevelUp(done, { classIndex: 0, hpBase: 4, expertise: ['arcana'] });
  assert.equal(done.skills.arcana, 2);
  assert.match(featuresText(done), /Scholar : Arcana/);
});

test('Bard 10 : Magical Secrets ouvre les listes Cleric, Druid et Wizard', () => {
  const o = levelUpOptions(blankCharacter({ className: 'Bard', level: 9 }), { classIndex: 0 });
  assert.deepEqual(o.spells.list, ['Bard', 'Cleric', 'Druid', 'Wizard']);
  assert.equal(levelUpOptions(blankCharacter({ className: 'Bard', level: 8 }), { classIndex: 0 }).spells.list, 'Bard');
});

test('sorts donnés : toujours préparés, sauf un ajout au grimoire', () => {
  const d = blankCharacter({ className: 'Wizard', level: 6 });
  d.classes[0].subclass = 'Illusionist';
  applyLevelUp(d, {
    classIndex: 0, hpBase: 4,
    grantedSpells: [{ name: 'Phantasmal Killer', level: 4, source: 'XPHB', always: false }, { name: 'Summon Fey', level: 3, source: 'XPHB' }],
  });
  const by = n => Object.values(d.spells).find(s => s.name === n);
  assert.ok(!by('Phantasmal Killer').always);
  assert.equal(by('Summon Fey').always, true);
  assert.match(featuresText(d), /Sorts ajoutés au grimoire : Phantasmal Killer/);
});

test('capacités : les noms de 5etools remplacent « Gloom Stalker feature »', () => {
  const d = blankCharacter({ className: 'Ranger', level: 6 });
  d.classes[0].subclass = 'Gloom Stalker';
  const plain = clone(d);
  applyLevelUp(plain, { classIndex: 0, hpBase: 6 });
  assert.match(featuresText(plain), /Gloom Stalker feature/);
  applyLevelUp(d, { classIndex: 0, hpBase: 6, features: [{ name: 'Iron Mind', kind: 'subclass' }] });
  const f = Object.values(d.featureList).find(x => x.name === 'Iron Mind');
  assert.equal(f.kind, 'subclass');
  assert.doesNotMatch(featuresText(d), /Gloom Stalker feature/);
});
