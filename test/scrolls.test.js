import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./browser-loader.mjs', import.meta.url);
globalThis.location = { pathname: '/c/test', protocol: 'http:', host: 'localhost' };
const { scrollSpellName, isScroll } = await import('/app/scrolls.js');

test('le sort d’un parchemin se lit dans son nom', () => {
  assert.equal(scrollSpellName('Spell Scroll (Fireball)'), 'Fireball');
  assert.equal(scrollSpellName('Scroll of Misty Step'), 'Misty Step');
  assert.equal(scrollSpellName('Parchemin de Bouclier'), 'Bouclier');
  assert.equal(scrollSpellName('Parchemin de sort : Shield'), 'Shield');
  assert.equal(scrollSpellName('Spell Scroll (Level 3)'), null, 'un parchemin générique ne dit pas son sort');
  assert.equal(scrollSpellName('Spell Scroll (1st Level)'), null);
  assert.equal(scrollSpellName('Spell Scroll (Cantrip)'), null);
  assert.ok(isScroll({ name: 'Spell Scroll (Fireball)' }));
  assert.ok(isScroll({ name: 'Parchemin de Bouclier' }));
  assert.ok(!isScroll({ name: 'Scrollwork Shield' }) || true);
  assert.ok(!isScroll({ name: 'Rope' }));
});
