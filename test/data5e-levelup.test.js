// Ce que levelInfo tire des sorts additionnels de 5etools : sorts donnés, sorts au choix,
// usages innés, ensembles nommés, domaines 2014 sur une classe 2024, noms 2014 des sous-classes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FiveETools } from '../server/data5e.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-5e-'));
fs.mkdirSync(path.join(dir, 'class'));
const sub = (name, extra) => ({ name, shortName: name, source: 'XPHB', className: 'Wizard', classSource: 'XPHB', subclassFeatures: [], ...extra });
fs.writeFileSync(path.join(dir, 'class', 'class-wizard.json'), JSON.stringify({
  class: [{
    name: 'Wizard', source: 'XPHB', hd: { faces: 6 },
    classFeatures: ['Spellcasting|Wizard|XPHB|1', { classFeature: 'Wizard Subclass|Wizard|XPHB|3', gainSubclassFeature: true }],
    additionalSpells: [{ innate: { _: { ritual: ['detect magic|xphb'] } } }],
  }],
  subclass: [
    sub('Illusionist', { additionalSpells: [{
      known: { 3: ['minor illusion|xphb#c', { choose: 'level=0;1;2|class=Wizard|school=I' }, { choose: 'level=0;1;2|class=Wizard|school=I' }], 7: [{ choose: 'level=0;1;2;3;4|class=Wizard|school=I' }] },
      prepared: { 6: ['summon fey|xphb'] },
    }] }),
    sub('Old Domain', { additionalSpells: [{ prepared: { 1: ['bless'], 3: ['aid'] }, innate: { 3: { daily: { '1e': ['aid'] } } } }] }),
    sub('Twin Lands', { additionalSpells: [{ name: 'North', prepared: { 3: ['fog cloud'] } }, { name: 'South', prepared: { 3: ['burning hands'] } }] }),
    sub('Lone Land', { additionalSpells: [{ name: 'Only', known: { 3: ['shield'] } }] }),
    sub('Scion', { additionalSpells: [{ innate: { 3: [{ choose: { from: ['blade ward|xphb#c', 'chill touch|xphb#c'], count: 1 } }] } }] }),
    sub('School of Illusion', { source: 'PHB', additionalSpells: [] }),
  ],
}));
const d5 = new FiveETools(dir, ['XPHB', 'PHB']).load();
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('levelInfo : sorts au choix fusionnés, filtres lus', () => {
  const i = d5.levelInfo('Wizard', 'XPHB', 'Illusionist', 2, 3);
  const g = i.additional.find(a => a.owner === 'subclass');
  assert.deepEqual(g.spells.map(s => s.name), ['Minor Illusion']);
  assert.equal(g.picks.length, 1);
  assert.equal(g.picks[0].count, 2);
  assert.deepEqual(g.picks[0].levels, [0, 1, 2]);
  assert.deepEqual(g.picks[0].schools, ['Illusion']);
  assert.equal(g.picks[0].mode, 'known');
  // Au niveau 7, un seul choix, jusqu'au niveau 4 ; rien du niveau 3 ne revient.
  const j = d5.levelInfo('Wizard', 'XPHB', 'Illusionist', 6, 7).additional.find(a => a.owner === 'subclass');
  assert.equal(j.spells.length, 0);
  assert.equal(j.picks[0].count, 1);
});

test('levelInfo : « _ » vaut le niveau où la classe est prise, usage inné lisible', () => {
  const one = d5.levelInfo('Wizard', 'XPHB', '', 0, 1).additional.find(a => a.owner === 'class');
  assert.equal(one.spells[0].name, 'Detect Magic');
  assert.equal(one.spells[0].note, 'rituel seulement');
  assert.equal(d5.levelInfo('Wizard', 'XPHB', '', 4, 5).additional.length, 0);
});

test('levelInfo : un domaine 2014 donne ses sorts du niveau 1 quand la sous-classe est prise', () => {
  const g = d5.levelInfo('Wizard', 'XPHB', 'Old Domain', 2, 3).additional.find(a => a.owner === 'subclass');
  assert.deepEqual(g.spells.map(s => s.name).sort(), ['Aid', 'Bless']);
  assert.match(g.spells.find(s => s.name === 'Aid').note, /1 fois par Long Rest/);
  assert.equal(d5.levelInfo('Wizard', 'XPHB', 'Old Domain', 3, 4).additional.length, 0);
});

test('levelInfo : plusieurs ensembles à choisir, un ensemble seul donné tel quel', () => {
  assert.deepEqual(d5.levelInfo('Wizard', 'XPHB', 'Twin Lands', 2, 3).sets.map(s => s.set), ['North', 'South']);
  const lone = d5.levelInfo('Wizard', 'XPHB', 'Lone Land', 2, 3);
  assert.equal(lone.sets.length, 0);
  assert.equal(lone.additional.find(a => a.owner === 'subclass').spells[0].name, 'Shield');
});

test('levelInfo : choix dans une liste fermée', () => {
  const p = d5.levelInfo('Wizard', 'XPHB', 'Scion', 2, 3).additional.find(a => a.owner === 'subclass').picks[0];
  assert.deepEqual(p.from.map(s => s.name), ['Blade Ward', 'Chill Touch']);
  assert.equal(p.mode, 'innate');
});

test('levelInfo : « School of Illusion » sur une fiche 2024 désigne l’Illusionist', () => {
  assert.equal(d5.levelInfo('Wizard', 'XPHB', 'School of Illusion', 6, 7).subclass.name, 'Illusionist');
});
