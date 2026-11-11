// Règles 5e pures, partagées entre le serveur et les tablettes.
// Ce fichier est servi tel quel au navigateur.
import { SUBCLASS_FEATURES, asiLevels, classDef } from './classes.js';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
export const ABILITY_NAMES = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};
export const ABILITY_SHORT = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };

export const SKILLS = [
  { key: 'acrobatics', name: 'Acrobatics', ability: 'dex' },
  { key: 'animalHandling', name: 'Animal Handling', ability: 'wis' },
  { key: 'arcana', name: 'Arcana', ability: 'int' },
  { key: 'athletics', name: 'Athletics', ability: 'str' },
  { key: 'deception', name: 'Deception', ability: 'cha' },
  { key: 'history', name: 'History', ability: 'int' },
  { key: 'insight', name: 'Insight', ability: 'wis' },
  { key: 'intimidation', name: 'Intimidation', ability: 'cha' },
  { key: 'investigation', name: 'Investigation', ability: 'int' },
  { key: 'medicine', name: 'Medicine', ability: 'wis' },
  { key: 'nature', name: 'Nature', ability: 'int' },
  { key: 'perception', name: 'Perception', ability: 'wis' },
  { key: 'performance', name: 'Performance', ability: 'cha' },
  { key: 'persuasion', name: 'Persuasion', ability: 'cha' },
  { key: 'religion', name: 'Religion', ability: 'int' },
  { key: 'sleightOfHand', name: 'Sleight of Hand', ability: 'dex' },
  { key: 'stealth', name: 'Stealth', ability: 'dex' },
  { key: 'survival', name: 'Survival', ability: 'wis' },
];

export const SCHOOLS = {
  A: 'Abjuration', C: 'Conjuration', D: 'Divination', E: 'Enchantment',
  V: 'Evocation', I: 'Illusion', N: 'Necromancy', T: 'Transmutation',
};

export const HIT_DIE = {
  barbarian: 12, fighter: 10, paladin: 10, ranger: 10,
  bard: 8, cleric: 8, druid: 8, monk: 8, rogue: 8, warlock: 8, artificer: 8,
  sorcerer: 6, wizard: 6,
};

const CASTER = {
  bard: 'full', cleric: 'full', druid: 'full', sorcerer: 'full', wizard: 'full',
  paladin: 'half', ranger: 'half', artificer: 'halfUp', warlock: 'pact',
};
const THIRD_SUBCLASSES = ['eldritch knight', 'arcane trickster'];

export const SPELLCASTING_DEFAULTS = {
  wizard: { ability: 'int', mode: 'prepared' },
  warlock: { ability: 'cha', mode: 'known' },
  cleric: { ability: 'wis', mode: 'prepared' },
  druid: { ability: 'wis', mode: 'prepared' },
  paladin: { ability: 'cha', mode: 'prepared' },
  artificer: { ability: 'int', mode: 'prepared' },
  sorcerer: { ability: 'cha', mode: 'known' },
  bard: { ability: 'cha', mode: 'known' },
  ranger: { ability: 'wis', mode: 'known' },
  fighter: { ability: 'int', mode: 'known' },
  rogue: { ability: 'int', mode: 'known' },
};

const FULL_SLOTS = [
  [], [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2],
  [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

export const ORDINAL = ['Cantrip', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];

export function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function mod(score) {
  return Math.floor((num(score, 10) - 10) / 2);
}

export function signed(n) {
  n = num(n);
  return n >= 0 ? `+${n}` : `${n}`;
}

export function classKey(name) {
  return String(name || '').trim().toLowerCase();
}

export function totalLevel(doc) {
  const sum = (doc.classes || []).reduce((s, c) => s + Math.max(0, num(c.level)), 0);
  return Math.max(1, sum);
}

export function classLevel(doc, name) {
  const c = (doc.classes || []).find(c => classKey(c.name) === classKey(name));
  return c ? num(c.level) : 0;
}

export function profBonus(doc) {
  if (doc.profOverride != null && doc.profOverride !== '') return num(doc.profOverride, 2);
  return 2 + Math.floor((totalLevel(doc) - 1) / 4);
}

export function abilityMod(doc, ab) {
  return mod(doc.abilities?.[ab]);
}

export function saveBonus(doc, ab) {
  return abilityMod(doc, ab) + (doc.saves?.[ab] ? profBonus(doc) : 0) + num(doc.saveBonus);
}

export function skillBonus(doc, key) {
  const sk = SKILLS.find(s => s.key === key);
  if (!sk) return 0;
  const rank = num(doc.skills?.[key]);
  return abilityMod(doc, sk.ability) + rank * profBonus(doc) + num(doc.skillBonus?.[key]);
}

export function passive(doc, key) {
  return 10 + skillBonus(doc, key);
}

// ---------- Infusions (Artificer, Tasha's) ----------

// Infusions connues et objets infusés à la fois, selon le niveau d'Artificer. null : pas d'infusions.
export function infusionLimits(doc) {
  const l = classLevel(doc, 'artificer');
  if (l < 2) return null;
  return {
    known: l >= 18 ? 12 : l >= 14 ? 10 : l >= 10 ? 8 : l >= 6 ? 6 : 4,
    active: l >= 18 ? 6 : l >= 14 ? 5 : l >= 10 ? 4 : l >= 6 ? 3 : 2,
  };
}

// Infusions qui donnent un bonus fixe à la CA.
const INFUSION_AC = {
  'enhanced defense': l => (l >= 10 ? 2 : 1),
  'repulsion shield': () => 1,
};

// Une infusion agit si elle est active et si son objet, quand il est choisi, est équipé.
export function infusionApplies(doc, inf) {
  if (!inf?.active) return false;
  const it = inf.itemId ? doc.inventory?.[inf.itemId] : null;
  return !it || !!it.equipped;
}

export function acBonuses(doc) {
  const l = classLevel(doc, 'artificer');
  return Object.values(doc.infusions || {})
    .filter(i => INFUSION_AC[classKey(i.name)] && infusionApplies(doc, i))
    .map(i => ({ name: i.name, value: INFUSION_AC[classKey(i.name)](l) }));
}

// CA finale : la valeur de la fiche plus les bonus automatiques.
export function armorClass(doc) {
  return num(doc.ac) + acBonuses(doc).reduce((s, b) => s + b.value, 0);
}

export function initiative(doc) {
  return abilityMod(doc, 'dex') + num(doc.initiativeBonus);
}

export function hitDiceOf(doc) {
  const out = {};
  for (const c of doc.classes || []) {
    const die = num(c.hitDie) || HIT_DIE[classKey(c.name)] || 8;
    const k = `d${die}`;
    out[k] = (out[k] || 0) + Math.max(0, num(c.level));
  }
  return Object.entries(out)
    .sort((a, b) => num(b[0].slice(1)) - num(a[0].slice(1)))
    .map(([die, max]) => ({ die, size: num(die.slice(1)), max, used: Math.min(max, num(doc.hitDiceUsed?.[die])) }));
}

// ---------- Sorts ----------

export function casterInfo(doc) {
  const classes = doc.classes || [];
  let lvl = 0, casters = 0, warlock = 0;
  for (const c of classes) {
    const k = classKey(c.name), l = num(c.level);
    const sub = classKey(c.subclass);
    let kind = CASTER[k];
    if (!kind && THIRD_SUBCLASSES.some(s => sub.includes(s))) kind = 'third';
    if (!kind) continue;
    if (kind === 'pact') { warlock += l; continue; }
    casters++;
    if (kind === 'full') lvl += l;
    else if (kind === 'halfUp') lvl += Math.ceil(l / 2);
    else if (kind === 'half') lvl += classes.length === 1 ? Math.ceil(l / 2) : Math.floor(l / 2);
    else if (kind === 'third') lvl += classes.length === 1 ? Math.ceil(l / 3) : Math.floor(l / 3);
  }
  return { casterLevel: Math.min(20, lvl), warlockLevel: warlock, casters };
}

export function autoSlots(doc) {
  const { casterLevel } = casterInfo(doc);
  const row = FULL_SLOTS[casterLevel] || [];
  const out = {};
  for (let l = 1; l <= 9; l++) out[l] = row[l - 1] || 0;
  return out;
}

export function pactSlotsFor(warlockLevel) {
  const l = num(warlockLevel);
  if (l <= 0) return { max: 0, level: 0 };
  const max = l === 1 ? 1 : l <= 10 ? 2 : l <= 16 ? 3 : 4;
  const level = Math.min(5, Math.ceil(l / 2));
  return { max, level };
}

export function spellAbility(doc) {
  return doc.spellcasting?.ability || 'int';
}

export function spellDC(doc) {
  return 8 + profBonus(doc) + abilityMod(doc, spellAbility(doc)) + num(doc.spellcasting?.dcBonus);
}

export function spellAttack(doc) {
  return profBonus(doc) + abilityMod(doc, spellAbility(doc)) + num(doc.spellcasting?.attackBonus);
}

// Cap de sorts préparés : mod de la caractéristique + niveau du magicien (min 1).
export function preparedCap(doc) {
  const sc = doc.spellcasting || {};
  if (sc.prepCapOverride != null && sc.prepCapOverride !== '') return num(sc.prepCapOverride);
  const prepClass = (doc.classes || []).find(c => SPELLCASTING_DEFAULTS[classKey(c.name)]?.mode === 'prepared');
  const lvl = prepClass ? num(prepClass.level) : totalLevel(doc);
  const k = classKey(prepClass?.name);
  // Artificer (Tasha's) : moitié du niveau arrondie à l'inférieur.
  const base = k === 'paladin' ? Math.ceil(lvl / 2) : k === 'artificer' ? Math.floor(lvl / 2) : lvl;
  return Math.max(1, abilityMod(doc, spellAbility(doc)) + base);
}

// Limites de sorts d'après les tableaux de classe de 5etools : en 2024, chaque classe donne
// son nombre de sorts préparés et de cantrips par niveau. `classData` : { clé de classe → klass() }.
// Une classe sans tableau (2014, homebrew) retombe sur la formule mod + niveau. La limite
// n'est qu'un repère : la fiche avertit, elle ne bloque jamais.
export function spellLimits(doc, classData = {}) {
  let prepared = 0, cantrips = 0, known = 0, fromTable = false, anyCantrips = false, anyKnown = false;
  for (const c of doc.classes || []) {
    const sp = classData[classKey(c.name)]?.spells;
    const lvl = Math.max(1, Math.min(20, num(c.level, 1)));
    if (!sp) continue;
    if (Array.isArray(sp.prepared)) { prepared += num(sp.prepared[lvl - 1]); fromTable = true; }
    if (Array.isArray(sp.cantrips)) { cantrips += num(sp.cantrips[lvl - 1]); anyCantrips = true; }
    if (Array.isArray(sp.known)) { known += num(sp.known[lvl - 1]); anyKnown = true; }
  }
  const override = doc.spellcasting?.prepCapOverride;
  const hasOverride = override != null && override !== '';
  return {
    prepared: hasOverride ? num(override) : fromTable ? prepared : preparedCap(doc),
    preparedFrom: hasOverride ? 'override' : fromTable ? 'table' : 'formula',
    cantrips: anyCantrips ? cantrips : null,
    known: anyKnown ? known : null,
  };
}

export function cantripCount(doc) {
  return Object.values(doc.spells || {}).filter(s => num(s.level) === 0 && !s.always).length;
}

export function knownCount(doc) {
  return Object.values(doc.spells || {}).filter(s => num(s.level) > 0 && !s.always).length;
}

export function preparedCount(doc) {
  return Object.values(doc.spells || {}).filter(s => num(s.level) > 0 && s.prepared && !s.always).length;
}

export function spellList(doc) {
  return Object.entries(doc.spells || {})
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => num(a.level) - num(b.level) || String(a.name).localeCompare(String(b.name)));
}

export function isPreparedMode(doc) {
  return (doc.spellcasting?.mode || 'none') === 'prepared';
}

// Un sort est « dans la main » : préparé (mode préparé), connu (mode connu), ou toujours préparé.
export function spellReady(doc, s) {
  if (num(s.level) === 0) return true;
  if (s.always) return true;
  return isPreparedMode(doc) ? !!s.prepared : true;
}

export function availableSlotLevels(doc, minLevel) {
  const out = [];
  const slots = doc.spellcasting?.slots || {};
  for (let l = Math.max(1, num(minLevel)); l <= 9; l++) {
    const s = slots[l];
    if (s && num(s.max) - num(s.used) > 0) out.push({ level: l, pact: false, left: num(s.max) - num(s.used) });
  }
  const p = doc.spellcasting?.pact;
  if (p && num(p.max) - num(p.used) > 0 && num(p.level) >= num(minLevel)) {
    out.push({ level: num(p.level), pact: true, left: num(p.max) - num(p.used) });
  }
  return out;
}

export function castableNow(doc, s) {
  const lvl = num(s.level);
  if (lvl === 0) return true;
  if (s.ritual && (isPreparedMode(doc) || spellReady(doc, s))) return true;
  if (!spellReady(doc, s)) return false;
  return availableSlotLevels(doc, lvl).length > 0;
}

// ---------- Inventaire et monnaie ----------

// Taux du Player's Handbook : 1 po = 10 pa = 100 pc, 1 pp = 10 po. Chaque campagne peut
// changer les pièces, leurs noms et leurs taux dans ses réglages.
export const DEFAULT_CURRENCY = [
  { key: 'pc', label: 'pc', name: 'cuivre', value: 1 },
  { key: 'pa', label: 'pa', name: 'argent', value: 10 },
  { key: 'po', label: 'po', name: 'or', value: 100 },
  { key: 'pp', label: 'pp', name: 'platine', value: 1000 },
];

export function denomsAsc(denoms = DEFAULT_CURRENCY) {
  return [...denoms].sort((a, b) => a.value - b.value);
}

export function toBase(purse, denoms = DEFAULT_CURRENCY) {
  return denoms.reduce((s, d) => s + Math.max(0, num(purse?.[d.key])) * d.value, 0);
}

export function fromBase(total, denoms = DEFAULT_CURRENCY) {
  const out = {};
  let rest = Math.max(0, Math.floor(total));
  for (const d of denomsAsc(denoms).reverse()) {
    out[d.key] = Math.floor(rest / d.value);
    rest -= out[d.key] * d.value;
  }
  return out;
}

export function coinCount(purse, denoms = DEFAULT_CURRENCY) {
  return denoms.reduce((s, d) => s + Math.max(0, num(purse?.[d.key])), 0);
}

export function formatPurse(purse, denoms = DEFAULT_CURRENCY, { empty = '0' } = {}) {
  const parts = denomsAsc(denoms).reverse()
    .filter(d => num(purse?.[d.key]) > 0)
    .map(d => `${num(purse[d.key])} ${d.label}`);
  return parts.length ? parts.join(', ') : `${empty} ${denomsAsc(denoms)[0]?.label || ''}`.trim();
}

export function formatBase(total, denoms = DEFAULT_CURRENCY) {
  return formatPurse(fromBase(total, denoms), denoms);
}

// Paie `amount` (en unité de base) en commençant par la dénomination
// annoncée, puis les plus grosses pièces, et rend la monnaie si besoin.
export function payFromPurse(purse, amount, denoms = DEFAULT_CURRENCY, prefer) {
  amount = Math.max(0, Math.floor(amount));
  if (toBase(purse, denoms) < amount) return null;
  const p = {};
  for (const d of denoms) p[d.key] = Math.max(0, num(purse?.[d.key]));
  let rest = amount;
  const desc = denomsAsc(denoms).reverse();
  const order = prefer ? [desc.find(d => d.key === prefer), ...desc.filter(d => d.key !== prefer)].filter(Boolean) : desc;
  for (const d of order) {
    const use = Math.min(p[d.key], Math.floor(rest / d.value));
    p[d.key] -= use;
    rest -= use * d.value;
  }
  if (rest > 0) {
    const breaker = denomsAsc(denoms).find(d => d.value > rest && p[d.key] > 0);
    if (!breaker) return null;
    p[breaker.key] -= 1;
    const change = fromBase(breaker.value - rest, denoms.filter(d => d.value < breaker.value));
    for (const [k, v] of Object.entries(change)) p[k] += v;
  }
  return p;
}

export function splitEvenly(fund, n, denoms = DEFAULT_CURRENCY) {
  const total = toBase(fund, denoms);
  const share = Math.floor(total / Math.max(1, n));
  return { share: fromBase(share, denoms), shareBase: share, remainder: fromBase(total - share * n, denoms) };
}

export function itemList(coll) {
  return Object.entries(coll || {})
    .map(([id, it]) => ({ id, ...it }))
    .sort((a, b) => num(a.order) - num(b.order) || String(a.name).localeCompare(String(b.name)));
}

export function carriedWeight(doc, { coinWeight = true, denoms = DEFAULT_CURRENCY } = {}) {
  let w = 0;
  for (const it of Object.values(doc.inventory || {})) {
    if (it.stored) continue;
    w += Math.max(0, Number(it.weight) || 0) * Math.max(0, Number(it.qty ?? 1) || 0);
  }
  if (coinWeight) w += coinCount(doc.currency, denoms) / 50;
  return Math.round(w * 100) / 100;
}

export function carryLimits(doc) {
  const str = num(doc.abilities?.str, 10);
  const mult = num(doc.carryMultiplier, 1) || 1;
  return { encumbered: str * 5 * mult, heavy: str * 10 * mult, capacity: str * 15 * mult };
}

export function encumbrance(doc, opts) {
  const w = carriedWeight(doc, opts);
  const lim = carryLimits(doc);
  let level = 'ok';
  if (w > lim.capacity) level = 'over';
  else if (w > lim.heavy) level = 'heavy';
  else if (w > lim.encumbered) level = 'encumbered';
  return { weight: w, ...lim, level };
}

export function attunedCount(doc) {
  return Object.values(doc.inventory || {}).filter(i => i.attuned).length;
}

export const MAX_ATTUNED = 3;

// ---------- Conditions ----------

export const CONDITIONS = [
  ['Blinded', "Can't see; automatically fails any check that requires sight. Attack rolls against the creature have advantage, and its own attack rolls have disadvantage."],
  ['Charmed', "Can't attack the charmer or target it with harmful abilities or magical effects. The charmer has advantage on any ability check to interact socially with the creature."],
  ['Deafened', "Can't hear; automatically fails any check that requires hearing."],
  ['Frightened', "Disadvantage on ability checks and attack rolls while the source of fear is within line of sight. Can't willingly move closer to the source of its fear."],
  ['Grappled', "Speed is 0 and can't increase. Disadvantage on attack rolls against any target other than the grappler. The grappler can drag or carry the creature, at extra movement cost. Ends if the grappler is Incapacitated or the distance exceeds the grapple's range."],
  ['Incapacitated', "Can't take any action, Bonus Action or Reaction. Concentration is broken. Can't speak. Disadvantage on Initiative rolls if Incapacitated when rolling."],
  ['Invisible', "Can't be seen without magic or a special sense. Advantage on Initiative. Attack rolls against it have disadvantage and its attack rolls have advantage, unless the attacker can somehow see it. Effects that require the target to be seen don't affect it."],
  ['Paralyzed', "Incapacitated; speed 0. Automatically fails Strength and Dexterity saving throws. Attack rolls against it have advantage. Any attack that hits from within 5 ft is a critical hit."],
  ['Petrified', "Turned to stone with everything it carries, weight ×10, stops aging. Incapacitated, speed 0. Attacks against it have advantage; fails Strength and Dexterity saves. Resistance to all damage, immune to Poisoned."],
  ['Poisoned', 'Disadvantage on attack rolls and ability checks.'],
  ['Prone', "Only movement option is to crawl or spend half its speed to stand up. Disadvantage on attack rolls. Attacks against it have advantage within 5 ft, disadvantage otherwise."],
  ['Restrained', "Speed 0. Disadvantage on attack rolls and Dexterity saving throws. Attack rolls against it have advantage."],
  ['Stunned', "Incapacitated. Automatically fails Strength and Dexterity saving throws. Attack rolls against it have advantage."],
  ['Unconscious', "Incapacitated and Prone, drops what it's holding. Speed 0. Unaware of its surroundings. Fails Strength and Dexterity saves. Attacks against it have advantage, and any hit from within 5 ft is a critical hit."],
].map(([name, text]) => ({ name, text }));

export const EXHAUSTION_TEXT =
  'Each level of Exhaustion gives −2 to every d20 Test (ability checks, attack rolls, saving throws) and −5 ft of speed per level. A Long Rest removes 1 level. The creature dies at level 6.';

// ---------- Dés ----------

// Lance une expression « 2d6+3 », « d20-1 », « 1d8 + 1d6 + 2 ».
export function rollExpression(expr, rng = Math.random) {
  const clean = String(expr || '').replace(/\s+/g, '').toLowerCase();
  if (!clean || !/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(clean)) return null;
  const terms = clean.match(/[+-]?(\d*d\d+|\d+)/g);
  let total = 0;
  const parts = [];
  for (const t of terms) {
    const sign = t.startsWith('-') ? -1 : 1;
    const body = t.replace(/^[+-]/, '');
    if (body.includes('d')) {
      const [cnt, sides] = body.split('d');
      const n = Math.min(100, cnt === '' ? 1 : num(cnt));
      const s = num(sides);
      if (s < 1) return null;
      const dice = [];
      for (let i = 0; i < n; i++) dice.push(1 + Math.floor(rng() * s));
      const sum = dice.reduce((a, b) => a + b, 0);
      total += sign * sum;
      parts.push({ kind: 'dice', sign, sides: s, dice });
    } else {
      total += sign * num(body);
      parts.push({ kind: 'flat', sign, value: num(body) });
    }
  }
  return { total, parts, expr: clean };
}

export function d20(rng = Math.random) {
  return 1 + Math.floor(rng() * 20);
}

// ---------- Montée de niveau ----------
// Les tables de classes sont dans classes.js ; la logique de montée dans levelup.js.

export function isAsiLevel(className, level) {
  return asiLevels(className).includes(num(level)) || num(level) === 19;
}

// Capacités gagnées à ce niveau de classe, hors amélioration de caractéristique.
export function featuresAt(className, subclass, level) {
  const def = classDef(className);
  const base = def?.features?.[level] || [];
  const subKey = Object.keys(SUBCLASS_FEATURES).find(s => classKey(subclass).includes(s));
  const own = subKey ? SUBCLASS_FEATURES[subKey][level] || [] : [];
  const out = [];
  for (const f of base) {
    if (f !== 'Subclass feature') out.push(f);
    else if (own.length) out.push(...own);
    else out.push(subclass ? `${subclass} feature` : 'Subclass feature');
  }
  if (!base.includes('Subclass feature')) for (const f of own) if (!out.includes(f)) out.push(f);
  return out;
}

export function defaultResources(className, subclass, level, doc) {
  const def = classDef(className);
  if (!def?.resources) return [];
  const mods = Object.fromEntries(ABILITIES.map(a => [a, abilityMod(doc, a)]));
  return def.resources(num(level), mods, subclass)
    .filter(r => r.max > 0)
    .map(r => ({ name: r.name, max: r.max, used: 0, reset: r.reset }));
}

export function resourceMaxFor(name, doc, className, level) {
  const r = defaultResources(className, '', level, doc).find(x => classKey(x.name) === classKey(name));
  return r ? r.max : null;
}

export const RESET_LABELS = {
  short: 'Repos court',
  short1: 'Repos court (+1), long (tout)',
  long: 'Repos long',
  none: 'Manuel',
};
