import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankCharacter } from '../shared/model.js';
import { CHAR_ACTIONS, PARTY_ACTIONS, ActionError } from '../shared/actions.js';
import {
  autoSlots, pactSlotsFor, preparedCap, payFromPurse, splitEvenly, toBase, rollExpression,
  carryLimits, encumbrance, DEFAULT_CURRENCY,
} from '../shared/rules.js';
import { diff, applyPatches, clone } from '../shared/patch.js';
import { renderEntries, toText } from '../shared/render5e.js';

const wizard = () => {
  const d = blankCharacter({ name: 'Ren', className: 'Wizard', subclass: 'School of Illusion', level: 5 });
  d.abilities.int = 16; d.abilities.con = 12;
  d.hp = { max: 20, current: 20, temp: 0 };
  return d;
};

test('emplacements et pacte', () => {
  assert.deepEqual(Object.values(autoSlots(wizard())).slice(0, 4), [4, 3, 2, 0]);
  assert.deepEqual(pactSlotsFor(5), { max: 2, level: 3 });
  assert.deepEqual(pactSlotsFor(11), { max: 3, level: 5 });
  const wl = blankCharacter({ className: 'Warlock', level: 5 });
  assert.equal(wl.spellcasting.pact.max, 2);
  assert.equal(wl.spellcasting.mode, 'prepared', 'en 2024, le Warlock prépare ses sorts');
  assert.equal(blankCharacter({ className: 'Warlock', level: 5, edition: '2014' }).spellcasting.mode, 'known');
});

test('cap de sorts préparés = mod INT + niveau de magicien', () => {
  const d = wizard();
  assert.equal(preparedCap(d), 3 + 5);
  d.spellcasting.prepCapOverride = 9;
  assert.equal(preparedCap(d), 9);
});

test('les PV temporaires absorbent les dégâts en premier', () => {
  const d = wizard();
  d.hp.temp = 5;
  CHAR_ACTIONS.damage(d, { amount: 8 });
  assert.equal(d.hp.temp, 0);
  assert.equal(d.hp.current, 17);
});

test('0 PV : Unconscious, échec automatique, puis soins = jets de mort remis à zéro', () => {
  const d = wizard();
  CHAR_ACTIONS.damage(d, { amount: 25 });
  assert.equal(d.hp.current, 0);
  assert.ok(d.conditions.includes('Unconscious'));
  CHAR_ACTIONS.damage(d, { amount: 2 });
  assert.equal(d.deathSaves.fail, 1);
  CHAR_ACTIONS.deathSave(d, { roll: 12 });
  assert.equal(d.deathSaves.success, 1);
  CHAR_ACTIONS.heal(d, { amount: 3 });
  assert.equal(d.hp.current, 3);
  assert.deepEqual(d.deathSaves, { success: 0, fail: 0 });
  assert.ok(!d.conditions.includes('Unconscious'));
});

test('dégâts massifs signalés', () => {
  const d = wizard();
  const r = CHAR_ACTIONS.damage(d, { amount: 45 });
  assert.match(r.toast, /mort instantanée/);
});

test('concentration : DD affiché, remplacement au second sort', () => {
  const d = wizard();
  d.spells.a = { name: 'Hold Person', level: 2, concentration: true, prepared: true };
  d.spells.b = { name: 'Detect Magic', level: 1, concentration: true, ritual: true, prepared: true };
  CHAR_ACTIONS.castSpell(d, { spellId: 'a', slotLevel: 2 });
  assert.equal(d.spellcasting.slots[2].used, 1);
  assert.equal(d.concentration.name, 'Hold Person');
  const r = CHAR_ACTIONS.castSpell(d, { spellId: 'b', ritual: true });
  assert.equal(d.spellcasting.slots[1].used, 0, 'un rituel ne dépense rien');
  assert.match(r.toast, /Hold Person terminée/);
  const dmg = CHAR_ACTIONS.damage(d, { amount: 30 - 13 });
  assert.match(dmg.toast, /CON DD 10/);
});

test('plus d’emplacement = refus', () => {
  const d = wizard();
  d.spells.a = { name: 'Fireball', level: 3, prepared: true };
  CHAR_ACTIONS.castSpell(d, { spellId: 'a', slotLevel: 3 });
  CHAR_ACTIONS.castSpell(d, { spellId: 'a', slotLevel: 3 });
  assert.throws(() => CHAR_ACTIONS.castSpell(d, { spellId: 'a', slotLevel: 3 }), ActionError);
});

test('repos court : dés de vie + CON, ressources de repos court, pacte, Arcane Recovery', () => {
  const d = wizard();
  d.hp.current = 5;
  d.spellcasting.slots[1].used = 3;
  d.spellcasting.slots[2].used = 1;
  const r = CHAR_ACTIONS.shortRest(d, { hitDice: [{ die: 'd6', roll: 4 }, { die: 'd6', roll: 1 }], arcane: [1, 2] });
  assert.equal(d.hp.current, 5 + 5 + 2);
  assert.equal(d.hitDiceUsed.d6, 2);
  assert.equal(d.spellcasting.slots[1].used, 2);
  assert.equal(d.spellcasting.slots[2].used, 0);
  assert.match(r.toast, /Arcane Recovery/);
  assert.throws(() => CHAR_ACTIONS.shortRest(d, { arcane: [1] }), /déjà utilisé/);
  const big = wizard();
  big.spellcasting.slots[3].used = 1; big.spellcasting.slots[1].used = 1;
  assert.throws(() => CHAR_ACTIONS.shortRest(big, { arcane: [3, 1] }), /3 niveaux/);

  const f = blankCharacter({ className: 'Fighter', level: 5 });
  const sw = Object.values(f.resources).find(x => x.name === 'Second Wind');
  const as = Object.values(f.resources).find(x => x.name === 'Action Surge');
  sw.used = 3; as.used = 1;
  CHAR_ACTIONS.shortRest(f, {});
  assert.equal(sw.used, 2, 'Second Wind regagne une utilisation');
  assert.equal(as.used, 0);

  const w = blankCharacter({ className: 'Warlock', level: 5 });
  w.spellcasting.pact.used = 2;
  CHAR_ACTIONS.shortRest(w, {});
  assert.equal(w.spellcasting.pact.used, 0);
});

test('repos long : PV max, emplacements, moitié des dés de vie, exhaustion -1', () => {
  const d = wizard();
  d.hp.current = 1; d.hp.temp = 4;
  d.hitDiceUsed.d6 = 5;
  d.exhaustion = 2;
  d.spellcasting.slots[1].used = 4;
  CHAR_ACTIONS.longRest(d, {}, { rules: {} });
  assert.equal(d.hp.current, 20);
  assert.equal(d.hp.temp, 0);
  assert.equal(d.hitDiceUsed.d6, 3, '5 dés : on en récupère 2');
  assert.equal(d.exhaustion, 1);
  assert.equal(d.spellcasting.slots[1].used, 0);
});

test('montée de niveau : PV, emplacements, ressources', () => {
  const f = blankCharacter({ className: 'Fighter', level: 8 });
  f.hp = { max: 60, current: 50, temp: 0 };
  CHAR_ACTIONS.levelUp(f, { classIndex: 0, hpGain: 7 });
  assert.equal(f.classes[0].level, 9);
  assert.equal(f.hp.max, 67);
  assert.ok(Object.values(f.resources).some(r => r.name === 'Indomitable' && r.max === 1));
  const w = wizard();
  CHAR_ACTIONS.levelUp(w, { hpGain: 4 });
  assert.equal(w.spellcasting.slots[3].max, 3);
});

test('monnaie : paiement avec rendu, partage du fonds', () => {
  // Taux maison d'une campagne : 1 po = 100 pa.
  const D = [{ key: 'pc', label: 'pc', value: 1 }, { key: 'pa', label: 'pa', value: 100 }, { key: 'po', label: 'po', value: 10000 }];
  const p = payFromPurse({ po: 1, pa: 30, pc: 0 }, 50 * 100, D, 'pa');
  assert.equal(toBase(p, D), 10000 + 3000 - 5000);
  assert.equal(p.po, 0); assert.equal(p.pa, 80);
  assert.equal(payFromPurse({ pa: 2 }, 500, D, 'pa'), null);
  const s = splitEvenly({ po: 1, pa: 1 }, 3, D);
  assert.equal(s.shareBase, Math.floor(10100 / 3));
  assert.equal(toBase(s.remainder, D), 10100 - 3 * s.shareBase);
});

test('charge portée et encombrement', () => {
  const d = wizard();
  d.abilities.str = 10;
  assert.equal(carryLimits(d).capacity, 150);
  d.inventory.a = { name: 'Plomb', qty: 3, weight: 40 };
  assert.equal(encumbrance(d, { coinWeight: false }).level, 'heavy');
  d.inventory.a.stored = true;
  assert.equal(encumbrance(d, { coinWeight: false }).level, 'ok');
});

test('transfert vers la réserve et journal', () => {
  const a = blankCharacter({ name: 'A' }), b = blankCharacter({ name: 'B' });
  a.inventory.x = { name: 'Potion of Healing', qty: 3, weight: 0.5 };
  b.inventory.y = { name: 'Potion of Healing', qty: 1, weight: 0.5 };
  const party = { stash: {}, fund: {}, log: {} };
  const docs = { a, b };
  const ctx = { party, char: id => docs[id], charIds: ['a', 'b'], actorName: 'A', now: 1, denoms: DEFAULT_CURRENCY };
  PARTY_ACTIONS.transfer(ctx, { from: 'a', to: 'b', itemId: 'x', qty: 2 });
  assert.equal(a.inventory.x.qty, 1);
  assert.equal(b.inventory.y.qty, 3, 'empilé avec la potion existante');
  PARTY_ACTIONS.transfer(ctx, { from: 'a', to: 'stash', itemId: 'x' });
  assert.equal(Object.keys(a.inventory).length, 0);
  assert.equal(Object.values(party.stash)[0].qty, 1);
  assert.equal(Object.keys(party.log).length, 2);
});

test('diff / patch : aller-retour', () => {
  const a = wizard();
  const b = clone(a);
  b.hp.current = 3; b.spells.q = { name: 'X', level: 1 }; delete b.resources[Object.keys(b.resources)[0]];
  const { fwd, inv } = diff(a, b);
  assert.deepEqual(applyPatches(clone(a), fwd), b);
  assert.deepEqual(applyPatches(clone(b), inv), a);
});

test('formules de dés', () => {
  const r = rollExpression('2d6+3', () => 0.999);
  assert.equal(r.total, 15);
  assert.equal(rollExpression('nope'), null);
});

test('rendu des entrées 5etools : balises échappées et résolues', () => {
  const h = renderEntries(['A {@damage 8d6} hit, {@spell Magic Missile|XPHB}, {@scaledamage 8d6|3-9|1d6}, <script>']);
  assert.match(h, /<span class="dice roll" data-roll="8d6"[^>]*>8d6<\/span>/, 'les dés se lancent d\'un toucher');
  assert.match(h, /data-k="spell" data-n="Magic Missile" data-s="XPHB"/);
  assert.match(h, />1d6</);
  assert.match(h, /&lt;script&gt;/);
  assert.equal(toText([{ type: 'entries', name: 'Hit', entries: ['{@dc 15} {@hit 5}'] }]), 'Hit. DC 15 +5');
  const links = renderEntries(['{@creature Wolf|XMM}, {@variantrule Bonus Action|XPHB}, {@deity Mystra|Faerûnian|PHB|la déesse}, {@filter bêtes|bestiary|type=beast}, {@book le PHB|XPHB|1|Combat}, {@classFeature Wild Shape|Druid|XPHB|2}, {@hit 4}']);
  assert.match(links, /data-k="monster" data-n="Wolf"/);
  assert.match(links, /data-k="variantrule" data-n="Bonus Action"/);
  assert.match(links, /data-k="deity" data-n="Mystra" data-s="PHB">la déesse</);
  assert.match(links, /data-filter="bestiary\|type=beast"/);
  assert.match(links, /data-book="book\|XPHB\|1\|Combat"/);
  assert.match(links, /data-k="classFeature" data-n="Wild Shape" data-s="XPHB" data-x="/);
  assert.match(links, /data-roll="1d20\+4"/);
});

test('bloc de statistiques d\'une créature', async () => {
  const { renderMonster } = await import('../shared/render5e.js');
  const h = renderMonster({ name: 'Wolf', size: ['M'], type: 'beast', alignment: ['U'], ac: [12], hp: { average: 11, formula: '2d8 + 2' }, speed: { walk: 40 },
    str: 14, dex: 15, con: 12, int: 3, wis: 12, cha: 6, skill: { perception: '+5' }, senses: ['Darkvision 60 ft.'], passive: 15, cr: '1/4',
    action: [{ name: 'Bite', entries: ['{@atkr m} {@hit 4}, reach 5 ft. {@h}5 ({@damage 1d6 + 2}) Piercing damage.'] }] });
  assert.match(h, /Medium beast, unaligned/);
  assert.match(h, /data-roll="2d8\+2"/);
  assert.match(h, /Bite/);
  assert.match(h, /data-roll="1d6\+2"/);
  assert.match(h, /Passive Perception 15/);
  assert.doesNotMatch(h, /XP/, 'jamais d\'XP sur une créature');
});
