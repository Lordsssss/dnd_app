// Le modèle de fiche, sa vérification, et le guide qui le reproduit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SHEET_EXAMPLE, checkSheet, sheetExample, sheetPrompt } from '../shared/sheet-template.js';
import { normalizeCharacter } from '../shared/model.js';
import { CHAR_ACTIONS } from '../shared/actions.js';
import { blankCharacter } from '../shared/model.js';

test('le modèle passe la vérification et s’importe tel quel', () => {
  assert.deepEqual(checkSheet(SHEET_EXAMPLE, { coins: ['cp', 'sp', 'gp', 'pp'] }), { errors: [], warnings: [] });
  const doc = blankCharacter({ name: 'Avant' });
  CHAR_ACTIONS.importSheet(doc, { data: SHEET_EXAMPLE });
  assert.equal(doc.name, 'Mira Thornwood');
  assert.equal(Object.keys(doc.spells).length, 4);
  assert.equal(Object.keys(doc.featureList).length, 6);
  assert.equal(Object.values(doc.featureList)[0].text.startsWith('You always have Hunter'), true, 'texte gardé mot pour mot');
  assert.equal(doc.spellcasting.slots[1].max, 3, 'emplacements calculés depuis la classe');
  assert.equal(doc.skills.stealth, 2);
});

test('le modèle prend les pièces et l’édition de la campagne', () => {
  const ex = sheetExample({ coins: ['pc', 'pa', 'po'], edition: '2014' });
  assert.deepEqual(Object.keys(ex.character.currency).sort(), ['pa', 'po']);
  assert.equal(ex.character.edition, '2014');
  assert.equal(SHEET_EXAMPLE.character.currency.gp, 15, 'le modèle de base reste intact');
  const p = sheetPrompt({ coins: ['pc', 'pa', 'po'] });
  assert.match(p, /coins: pc, pa, po/);
  assert.match(p, /word for word/);
  assert.match(p, /imperial/);
  const json = p.split('Example:\n')[1].split('\n\nMy character:')[0];
  assert.deepEqual(JSON.parse(json).character.currency, { po: 15, pa: 8 });
});

test('vérification : erreurs bloquantes et avertissements', () => {
  const r = checkSheet({ character: {
    name: '', classes: [{ name: 'Wizzard', level: 25 }], abilities: { str: 40, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    speed: '9 m', skills: { perception: 3, sneaking: 1 }, spells: [{ name: 'Fireball', level: 12 }],
    featureList: [{ name: 'Rage', kind: 'power', text: '' }], resources: [{ name: 'Rage', max: 2, reset: 'dawn' }],
    currency: { gold: 3 }, mystery: 1,
    attacks: [{ name: 'Dague', type: 'portée 6 m' }],
  } }, { coins: ['pc', 'pa', 'po'] });
  const all = r.errors.join('\n');
  for (const want of [/name/, /level vaut « 25 »/, /abilities.str/, /Fireball/]) assert.match(all, want);
  const w = r.warnings.join('\n');
  for (const want of [/Wizzard/, /9 m/, /perception/, /sneaking/, /power/, /sans texte/, /dawn/, /currency.gold/, /mystery/, /Dague.*métrique/]) assert.match(w, want);
  assert.deepEqual(checkSheet('texte').errors.length, 1);
  assert.equal(checkSheet({ character: { name: 'X', classes: [{ name: 'Fighter', level: 15 }, { name: 'Rogue', level: 6 }] } }).errors[0], 'Niveau total 21 : 20 au plus.');
});

test('le guide montre le modèle tel que l’application le donne', () => {
  const md = fs.readFileSync(new URL('../docs/CAMPAIGN-SETUP.md', import.meta.url), 'utf8');
  const block = /```json\n([\s\S]*?)\n```/.exec(md)[1];
  assert.deepEqual(JSON.parse(block), SHEET_EXAMPLE, 'docs/CAMPAIGN-SETUP.md à mettre à jour : node tools/check-sheet.mjs --template');
  for (const route of ['/sheet/template', '/sheet/check', '/characters']) assert.ok(md.includes(route), route);
  assert.ok(normalizeCharacter(JSON.parse(block).character).name);
});
