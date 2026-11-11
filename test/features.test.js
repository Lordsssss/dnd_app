import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFeatures, bodyOf, featuresText } from '../shared/features.js';
import { normalizeCharacter, blankCharacter } from '../shared/model.js';

const SAMPLE = `CA 18 = 13 de carapace + 4 DEX.

FIGHTER · CHAMPION
- Improved Critical : critique sur 19 ou 20.
- Second Wind : action bonus, récupère 1d10 + 5 PV.

Skilled:
You gain proficiency in any combination of three skills.

Proficiency:

Tools Proficiency:
-Forgery Kit: Ability: Dexterity
Utilize: Mimic 10 or fewer words.`;

test('un bloc de texte devient une liste, sans perdre un mot', () => {
  const items = splitFeatures(SAMPLE);
  assert.deepEqual(items.map(f => f.name), ['CA 18 = 13 de carapace + 4 DEX.', 'Improved Critical', 'Second Wind', 'Skilled', 'Tools Proficiency']);
  assert.equal(items[1].group, 'FIGHTER · CHAMPION');
  assert.equal(items[1].text, 'Improved Critical : critique sur 19 ou 20.');
  assert.equal(bodyOf(items[1]), 'critique sur 19 ou 20.');
  const joined = items.map(f => `${f.group} ${f.name} ${f.text}`).join(' ');
  for (const w of SAMPLE.split(/\s+/).filter(Boolean)) assert.ok(joined.includes(w.replace(/^-/, '').replace(/:$/, '')), `mot perdu : ${w}`);
});

test('une ancienne fiche est convertie une seule fois, l’original gardé', () => {
  const d = normalizeCharacter({ ...blankCharacter({ name: 'A' }), features: SAMPLE });
  assert.equal(Object.keys(d.featureList).length, 5);
  assert.equal(d.features, '');
  assert.equal(d.meta.featuresBefore, SAMPLE);
  const again = normalizeCharacter(d);
  assert.equal(Object.keys(again.featureList).length, 5, 'idempotent');
  assert.match(featuresText(again), /Improved Critical/);
});
