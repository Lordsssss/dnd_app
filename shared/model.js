// Structure d'une fiche et normalisation (import JSON, anciennes versions).
import { clone, isPlainObject, newId } from './patch.js';
import { cleanFeature, splitFeatures } from './features.js';
import {
  ABILITIES, HIT_DIE, SPELLCASTING_DEFAULTS, autoSlots, casterInfo, classKey,
  defaultResources, num, pactSlotsFor,
} from './rules.js';

export const SCHEMA = 1;

export const SAVE_PROFS = {
  barbarian: ['str', 'con'], bard: ['dex', 'cha'], cleric: ['wis', 'cha'], druid: ['int', 'wis'],
  fighter: ['str', 'con'], monk: ['str', 'dex'], paladin: ['wis', 'cha'], ranger: ['str', 'dex'],
  rogue: ['dex', 'int'], sorcerer: ['con', 'cha'], warlock: ['wis', 'cha'], wizard: ['int', 'wis'],
  artificer: ['con', 'int'],
};

// Clés de premier niveau qu'un joueur peut modifier sur sa propre fiche.
export const EDITABLE_KEYS = new Set([
  'name', 'race', 'background', 'alignment', 'xp', 'classes', 'abilities', 'saves', 'skills',
  'skillBonus', 'saveBonus', 'profOverride', 'inspiration', 'ac', 'speed', 'initiativeBonus',
  'hp', 'hitDiceUsed', 'deathSaves', 'exhaustion', 'conditions', 'concentration', 'attacks',
  'resources', 'features', 'featureList', 'proficiencies', 'personality', 'spellcasting', 'spells', 'inventory',
  'currency', 'notes', 'drawings', 'secret', 'carryMultiplier', 'portrait', 'appearance', 'infusions', 'edition',
]);

function emptySlots() {
  const s = {};
  for (let l = 1; l <= 9; l++) s[l] = { max: 0, used: 0 };
  return s;
}

export function template() {
  return {
    schema: SCHEMA,
    name: '', player: '', race: '', background: '', alignment: '', xp: '', appearance: '',
    classes: [{ name: '', subclass: '', level: 1 }],
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saves: { str: false, dex: false, con: false, int: false, wis: false, cha: false },
    skills: {}, skillBonus: {}, saveBonus: 0, profOverride: null,
    inspiration: false, ac: 10, speed: '30 ft', initiativeBonus: 0,
    hp: { max: 10, current: 10, temp: 0 },
    hitDiceUsed: {},
    deathSaves: { success: 0, fail: 0 },
    exhaustion: 0,
    conditions: [],
    autoUnconscious: false,
    concentration: null,
    attacks: {},
    resources: {},
    features: '', featureList: {}, proficiencies: '',
    personality: { traits: '', ideals: '', bonds: '', flaws: '' },
    spellcasting: {
      ability: 'int', mode: 'none', prepCapOverride: null, dcBonus: 0, attackBonus: 0,
      slotsAuto: true, slots: emptySlots(), pact: { max: 0, level: 0, used: 0 },
    },
    spells: {},
    infusions: {},
    inventory: {},
    currency: {},
    notes: { backstory: '', allies: '', session: '', free: '' },
    drawings: { notes: {} },
    secret: { text: '', goals: '', drawing: {} },
    carryMultiplier: 1,
    meta: { createdAt: Date.now() },
  };
}

// Recalcule les emplacements standards (sorts + pacte) à partir des classes.
export function applyAutoSlots(doc) {
  const sc = doc.spellcasting;
  if (sc.slotsAuto === false) return;
  const auto = autoSlots(doc);
  for (let l = 1; l <= 9; l++) {
    const cur = sc.slots[l] || { max: 0, used: 0 };
    sc.slots[l] = { max: auto[l], used: Math.min(num(cur.used), auto[l]) };
  }
  const pact = pactSlotsFor(casterInfo(doc).warlockLevel);
  sc.pact = { max: pact.max, level: pact.level, used: Math.min(num(sc.pact?.used), pact.max) };
}

export function blankCharacter({ name = '', player = '', className = '', subclass = '', level = 1, race = '', edition = '2024' } = {}) {
  const doc = template();
  Object.assign(doc, { name, player, race, edition: edition === '2014' ? '2014' : '2024' });
  const k = classKey(className);
  doc.classes = [{ name: className, subclass, level: num(level, 1) }];
  if (HIT_DIE[k]) doc.classes[0].hitDie = HIT_DIE[k];
  for (const ab of SAVE_PROFS[k] || []) doc.saves[ab] = true;
  const sc = SPELLCASTING_DEFAULTS[k];
  if (sc && (k !== 'fighter' && k !== 'rogue')) {
    doc.spellcasting.ability = sc.ability;
    // En 2024, toutes les classes préparent leurs sorts (Warlock, Sorcerer, Bard et Ranger compris).
    doc.spellcasting.mode = doc.edition === '2024' ? 'prepared' : sc.mode;
  }
  applyAutoSlots(doc);
  let order = 0;
  for (const r of defaultResources(className, subclass, level, doc)) {
    doc.resources[newId('r')] = { ...r, order: order++ };
  }
  return doc;
}

function fillDefaults(target, tpl) {
  for (const [k, v] of Object.entries(tpl)) {
    if (!(k in target) || target[k] === undefined) target[k] = clone(v);
    else if (isPlainObject(v) && isPlainObject(target[k]) && !COLLECTIONS.has(k)) fillDefaults(target[k], v);
  }
}

const COLLECTIONS = new Set(['attacks', 'resources', 'spells', 'infusions', 'inventory', 'skills', 'skillBonus', 'hitDiceUsed', 'currency', 'notes', 'drawing', 'featureList']);

// Les collections peuvent arriver sous forme de tableau (import d'une autre
// version) : on les convertit en objets indexés par id.
function toKeyed(v) {
  if (Array.isArray(v)) {
    const out = {};
    v.forEach((it, i) => {
      if (!isPlainObject(it)) return;
      const id = typeof it.id === 'string' && it.id ? it.id : newId('i');
      const copy = { ...it, order: it.order ?? i };
      delete copy.id;
      out[id] = copy;
    });
    return out;
  }
  return isPlainObject(v) ? v : {};
}

export function normalizeCharacter(input) {
  const doc = isPlainObject(input) ? clone(input) : {};
  delete doc.id;
  const hasSlots = isPlainObject(doc.spellcasting?.slots);
  for (const k of ['attacks', 'resources', 'spells', 'infusions', 'inventory', 'featureList']) doc[k] = toKeyed(doc[k]);
  for (const [fid, f] of Object.entries(doc.featureList)) doc.featureList[fid] = cleanFeature(f, f.order);
  // Ancienne fiche : le bloc de texte devient une liste, mot pour mot. Le bloc d'origine est
  // gardé dans meta.featuresBefore, au cas où le découpage tomberait mal.
  if (!Object.keys(doc.featureList).length && typeof doc.features === 'string' && doc.features.trim()) {
    for (const f of splitFeatures(doc.features)) doc.featureList[newId('f')] = f;
    doc.meta = { ...(isPlainObject(doc.meta) ? doc.meta : {}), featuresBefore: doc.features };
    doc.features = '';
  }
  if (doc.drawings && !isPlainObject(doc.drawings)) doc.drawings = {};
  if (doc.drawings) doc.drawings.notes = toKeyed(doc.drawings.notes);
  if (doc.secret && !isPlainObject(doc.secret)) doc.secret = { text: String(doc.secret) };
  if (doc.secret) doc.secret.drawing = toKeyed(doc.secret.drawing);
  if (!Array.isArray(doc.classes) || !doc.classes.length) doc.classes = undefined;
  if (!Array.isArray(doc.conditions)) doc.conditions = [];
  fillDefaults(doc, template());
  for (const ab of ABILITIES) doc.abilities[ab] = num(doc.abilities[ab], 10);
  if (!doc.spellcasting.slots) doc.spellcasting.slots = emptySlots();
  for (let l = 1; l <= 9; l++) if (!isPlainObject(doc.spellcasting.slots[l])) doc.spellcasting.slots[l] = { max: 0, used: 0 };
  // Fiche écrite à la main sans emplacements : on les calcule depuis la classe.
  if (!hasSlots && doc.spellcasting.slotsAuto !== false) applyAutoSlots(doc);
  doc.schema = SCHEMA;
  return doc;
}

export function blankParty() {
  return { stash: {}, fund: {}, log: {} };
}

export function normalizeParty(input) {
  const p = isPlainObject(input) ? clone(input) : {};
  p.stash = toKeyed(p.stash);
  p.fund = isPlainObject(p.fund) ? p.fund : {};
  p.log = isPlainObject(p.log) ? p.log : {};
  return p;
}

export function className(doc) {
  return (doc.classes || []).map(c => c.name).filter(Boolean).join(' / ');
}

export function classSummary(doc) {
  return (doc.classes || [])
    .filter(c => c.name)
    .map(c => `${c.name}${c.subclass ? ` (${c.subclass})` : ''} ${num(c.level, 1)}`)
    .join(' / ');
}
