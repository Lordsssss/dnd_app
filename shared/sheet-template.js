// Modèle de fiche JSON et vérification d'une fiche avant import.
// Le même modèle sert au bouton « Copier le modèle JSON », à la consigne pour une IA, au guide
// docs/CAMPAIGN-SETUP.md et à tools/check-sheet.mjs : un seul endroit à tenir à jour.
import { isPlainObject } from './patch.js';
import { ABILITIES, SKILLS, num } from './rules.js';
import { CLASSES } from './classes.js';
import { FEATURE_KINDS } from './features.js';

// Une fiche complète, 5e 2024, telle que l'import l'accepte. Les collections (attaques, sorts,
// objets…) sont des tableaux : l'application leur donne ses identifiants à l'import.
export const SHEET_EXAMPLE = {
  format: 'dnd-sheet',
  version: 2,
  character: {
    edition: '2024',
    name: 'Mira Thornwood',
    race: 'Wood Elf',
    background: 'Guide',
    alignment: 'Neutral Good',
    appearance: 'Short, freckled, green cloak patched at the elbows.',
    classes: [{ name: 'Ranger', subclass: 'Hunter', level: 3, hitDie: 10 }],
    abilities: { str: 12, dex: 17, con: 14, int: 10, wis: 15, cha: 8 },
    saves: { str: true, dex: true, con: false, int: false, wis: false, cha: false },
    skills: { perception: 1, stealth: 2, survival: 1, nature: 1, athletics: 1 },
    skillBonus: {},
    ac: 15,
    speed: '35 ft',
    initiativeBonus: 0,
    hp: { max: 28, current: 28, temp: 0 },
    attacks: [
      { name: 'Longbow', bonus: '+5', damage: '1d8+3', type: 'Piercing · Ammunition, Heavy, Two-Handed · range 150/600 ft · Slow' },
      { name: 'Shortsword', bonus: '+5', damage: '1d6+3', type: 'Piercing · Finesse, Light · Vex' },
    ],
    resources: [
      { name: 'Favored Enemy', max: 2, used: 0, reset: 'long' },
    ],
    featureList: [
      { group: 'RANGER', kind: 'class', name: 'Favored Enemy', text: 'You always have Hunter\'s Mark prepared. You can cast it twice without expending a spell slot, and you regain all expended uses when you finish a Long Rest.' },
      { group: 'RANGER', kind: 'class', name: 'Weapon Mastery', text: 'Longbow (Slow), Shortsword (Vex).' },
      { group: 'RANGER', kind: 'class', name: 'Deft Explorer', text: 'Expertise in Stealth. Two extra languages: Sylvan, Goblin.' },
      { group: 'RANGER · HUNTER', kind: 'subclass', name: 'Hunter\'s Prey', text: 'Colossus Slayer: once per turn, an extra 1d8 damage to a creature missing any of its Hit Points.' },
      { group: 'WOOD ELF', kind: 'species', name: 'Darkvision', text: '60 ft.' },
      { group: 'FEATS', kind: 'feat', name: 'Alert', text: 'Add your Proficiency Bonus to Initiative. You can swap Initiative with a willing ally.' },
    ],
    proficiencies: 'Armor: Light, Medium, Shields. Weapons: Simple, Martial. Tools: Cartographer\'s Tools. Languages: Common, Elvish, Sylvan, Goblin.',
    personality: { traits: 'Talks to birds.', ideals: 'Nature first.', bonds: 'Her lost brother.', flaws: 'Trusts no city guard.' },
    spellcasting: { ability: 'wis', mode: 'prepared' },
    spells: [
      { name: 'Hunter\'s Mark', level: 1, source: 'XPHB', always: true, concentration: true, notes: 'Favored Enemy' },
      { name: 'Goodberry', level: 1, source: 'XPHB', prepared: true },
      { name: 'Ensnaring Strike', level: 1, source: 'XPHB', prepared: true, concentration: true },
      { name: 'Cure Wounds', level: 1, source: 'XPHB', prepared: false },
    ],
    inventory: [
      { name: 'Studded Leather Armor', qty: 1, weight: 13, equipped: true },
      { name: 'Longbow', qty: 1, weight: 2, equipped: true },
      { name: 'Arrows', qty: 40, weight: 0.05 },
      { name: 'Potion of Healing', qty: 2, weight: 0.5, consumable: true },
      { name: 'Cloak of Elvenkind', qty: 1, weight: 1, attunement: true, attuned: true, rarity: 'uncommon' },
    ],
    currency: { gp: 15, sp: 8 },
    notes: { backstory: 'Grew up in the Thornwood, guide for caravans until the road burned.', allies: '', session: '', free: '' },
  },
};

// Ce que l'IA doit savoir pour remplir une fiche ; le modèle suit.
export const SHEET_RULES = [
  'Answer with one JSON object only, same shape as the example. No comments, no text around it.',
  'Rules: D&D 5e 2024 (Player\'s Handbook 2024) unless the DM says 2014. Put "edition": "2014" for a 2014 sheet.',
  'Units are imperial: "30 ft", weights in lb. Never meters or kilograms.',
  'Class names in English, as in the Player\'s Handbook: Artificer, Barbarian, Bard, Cleric, Druid, Fighter, Monk, Paladin, Ranger, Rogue, Sorcerer, Warlock, Wizard. Multiclass: one entry per class in "classes".',
  'abilities: the six scores, 1 to 30. saves: true for a proficient saving throw.',
  'skills: 1 = proficient, 2 = Expertise. Keys: acrobatics, animalHandling, arcana, athletics, deception, history, insight, intimidation, investigation, medicine, nature, perception, performance, persuasion, religion, sleightOfHand, stealth, survival. Leave out the others.',
  'Spell slots, Proficiency Bonus, modifiers, save DC and spell attack are computed by the app: do not write them.',
  'spells: level 0 for cantrips. "always": true for spells a feature always keeps prepared (they do not count against the limit). "prepared": true for the others prepared today.',
  'featureList: one entry per feature, feat or trait. Copy the rules text in full, word for word. Never summarize. kind is one of: class, subclass, species, background, feat, item, other. group is the heading it appears under.',
  'resources: limited uses. reset is "long" (Long Rest), "short" (Short Rest restores all) or "short1" (Short Rest restores one use).',
  'currency: use the coin keys of the campaign (the DM tells you; often gp, sp, cp or po, pa, pc).',
  'Unknown fields are kept but unused. Missing fields get their defaults.',
];

// La consigne complète à coller dans une IA, avec le modèle. `coins` : clés de monnaie de la campagne.
// Le modèle adapté à la campagne : son édition, ses pièces (la plus forte et la suivante).
export function sheetExample({ coins = null, edition = '2024' } = {}) {
  const ex = JSON.parse(JSON.stringify(SHEET_EXAMPLE));
  ex.character.edition = edition === '2014' ? '2014' : '2024';
  if (Array.isArray(coins) && coins.length) {
    const keys = coins.map(c => c.key || c);
    ex.character.currency = { [keys[keys.length - 1]]: 15, [keys[Math.max(0, keys.length - 2)]]: 8 };
  }
  return ex;
}

export function sheetPrompt({ coins = null, edition = '2024' } = {}) {
  const ex = sheetExample({ coins, edition });
  const rules = SHEET_RULES.map(r => `- ${r}`);
  if (Array.isArray(coins) && coins.length) rules.push(`- This campaign's coins: ${coins.map(c => c.key || c).join(', ')}.`);
  return [
    'Fill in a D&D character sheet for the "D&D Table" app, from the character I describe below or from the sheet I attach.',
    '',
    ...rules,
    '',
    'Example:',
    JSON.stringify(ex, null, 2),
    '',
    'My character:',
  ].join('\n');
}

export const SKILL_KEYS = SKILLS.map(s => s.key);
const KNOWN_KEYS = new Set([
  'schema', 'edition', 'name', 'player', 'race', 'background', 'alignment', 'xp', 'appearance', 'classes', 'abilities', 'saves',
  'skills', 'skillBonus', 'saveBonus', 'profOverride', 'inspiration', 'ac', 'speed', 'initiativeBonus', 'hp', 'hitDiceUsed',
  'deathSaves', 'exhaustion', 'conditions', 'autoUnconscious', 'concentration', 'attacks', 'resources', 'features', 'featureList',
  'proficiencies', 'personality', 'spellcasting', 'spells', 'infusions', 'inventory', 'currency', 'notes', 'drawings', 'secret',
  'carryMultiplier', 'portrait', 'meta', 'campaign', 'musicRemote',
]);
const RESETS = new Set(['long', 'short', 'short1', 'none', '']);
const METRIC = /\b\d+(?:[.,]\d+)?\s*(?:m|mètres?|metres?|meters?|km|kg|kilos?|cm)\b/i;
const list = v => (Array.isArray(v) ? v : isPlainObject(v) ? Object.values(v) : []);

// Vérifie une fiche avant import. Rend { errors, warnings } : une erreur bloque l'import (il
// échouerait ou donnerait une fiche vide), un avertissement signale ce qui sera ignoré ou douteux.
// `coins` : les clés de monnaie de la campagne.
export function checkSheet(input, { coins = null } = {}) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(input)) return { errors: ['Le fichier ne contient pas un objet JSON.'], warnings };
  const d = isPlainObject(input.character) ? input.character : input;
  if (!String(d.name || '').trim()) errors.push('« name » est vide : la fiche n\'a pas de nom.');

  for (const k of Object.keys(d)) if (!KNOWN_KEYS.has(k)) warnings.push(`Champ inconnu « ${k} » : gardé, mais l'application ne s'en sert pas.`);
  if (d.edition && !['2014', '2024'].includes(String(d.edition))) warnings.push(`« edition » vaut « ${d.edition} » : 2024 ou 2014 attendu.`);

  // Classes
  const classes = Array.isArray(d.classes) ? d.classes : [];
  if (d.classes !== undefined && !Array.isArray(d.classes)) errors.push('« classes » doit être un tableau : [{ "name": "Fighter", "level": 3 }].');
  let total = 0;
  classes.forEach((c, i) => {
    if (!isPlainObject(c)) { errors.push(`classes[${i}] n'est pas un objet.`); return; }
    const lvl = Number(c.level);
    if (!Number.isInteger(lvl) || lvl < 1 || lvl > 20) errors.push(`classes[${i}].level vaut « ${c.level} » : un entier de 1 à 20.`);
    else total += lvl;
    if (c.name && !CLASSES[String(c.name).trim().toLowerCase()]) warnings.push(`Classe « ${c.name} » inconnue de l'application : pas d'emplacements ni de montée de niveau automatiques. Homebrew ? Sinon, le nom anglais du Player's Handbook.`);
    if (!String(c.name || '').trim()) warnings.push(`classes[${i}] n'a pas de nom de classe.`);
  });
  if (total > 20) errors.push(`Niveau total ${total} : 20 au plus.`);

  // Caractéristiques, sauvegardes, compétences
  if (d.abilities !== undefined) {
    if (!isPlainObject(d.abilities)) errors.push('« abilities » doit être un objet : { "str": 10, … }.');
    else {
      for (const ab of ABILITIES) {
        if (d.abilities[ab] === undefined) { warnings.push(`abilities.${ab} manque : 10 par défaut.`); continue; }
        const v = Number(d.abilities[ab]);
        if (!Number.isFinite(v) || v < 1 || v > 30) errors.push(`abilities.${ab} vaut « ${d.abilities[ab]} » : de 1 à 30.`);
      }
      for (const k of Object.keys(d.abilities)) if (!ABILITIES.includes(k)) warnings.push(`abilities.${k} : clé inconnue (str, dex, con, int, wis, cha).`);
    }
  }
  if (isPlainObject(d.saves)) for (const k of Object.keys(d.saves)) if (!ABILITIES.includes(k)) warnings.push(`saves.${k} : clé inconnue (str, dex, con, int, wis, cha).`);
  if (isPlainObject(d.skills)) {
    for (const [k, v] of Object.entries(d.skills)) {
      if (!SKILL_KEYS.includes(k)) warnings.push(`skills.${k} : compétence inconnue. Clés attendues : ${SKILL_KEYS.join(', ')}.`);
      else if (![0, 1, 2, true, false].includes(v)) warnings.push(`skills.${k} vaut « ${v} » : 1 (maîtrise) ou 2 (Expertise).`);
    }
  }

  // Points de vie, vitesse
  if (isPlainObject(d.hp)) {
    if (!(num(d.hp.max) > 0)) warnings.push('hp.max manque ou vaut 0.');
    if (num(d.hp.current) > num(d.hp.max) + num(d.hp.temp) && num(d.hp.max) > 0) warnings.push('hp.current dépasse hp.max.');
  }
  if (d.speed && METRIC.test(String(d.speed))) warnings.push(`« speed » vaut « ${d.speed} » : en pieds, « 30 ft ».`);

  // Collections
  list(d.spells).forEach((s, i) => {
    if (!isPlainObject(s) || !String(s.name || '').trim()) { warnings.push(`spells[${i}] sans nom : ignoré.`); return; }
    const l = Number(s.level ?? 0);
    if (!Number.isInteger(l) || l < 0 || l > 9) errors.push(`Sort « ${s.name} » : level vaut « ${s.level} », de 0 (cantrip) à 9.`);
  });
  list(d.featureList).forEach((f, i) => {
    if (!isPlainObject(f) || !String(f.name || '').trim()) { warnings.push(`featureList[${i}] sans nom.`); return; }
    if (f.kind && !FEATURE_KINDS.includes(f.kind)) warnings.push(`Capacité « ${f.name} » : kind « ${f.kind} » inconnu, devient « other » (${FEATURE_KINDS.join(', ')}).`);
    if (!String(f.text || '').trim()) warnings.push(`Capacité « ${f.name} » sans texte : copier le texte de la règle mot pour mot.`);
  });
  list(d.resources).forEach((r, i) => {
    if (!isPlainObject(r) || !String(r.name || '').trim()) { warnings.push(`resources[${i}] sans nom.`); return; }
    if (!(num(r.max) >= 0)) warnings.push(`Ressource « ${r.name} » : max invalide.`);
    if (r.reset !== undefined && !RESETS.has(String(r.reset))) warnings.push(`Ressource « ${r.name} » : reset « ${r.reset} » inconnu (long, short, short1).`);
  });
  list(d.inventory).forEach((it, i) => {
    if (!isPlainObject(it) || !String(it.name || '').trim()) { warnings.push(`inventory[${i}] sans nom.`); return; }
    if (it.qty !== undefined && !(Number(it.qty) >= 0)) warnings.push(`Objet « ${it.name} » : qty invalide.`);
    if (it.weight !== undefined && !(Number(it.weight) >= 0)) warnings.push(`Objet « ${it.name} » : weight invalide, en lb.`);
  });
  list(d.attacks).forEach((a, i) => {
    if (!isPlainObject(a) || !String(a.name || '').trim()) warnings.push(`attacks[${i}] sans nom.`);
  });
  for (const k of ['spells', 'featureList', 'resources', 'inventory', 'attacks', 'infusions']) {
    if (d[k] !== undefined && !Array.isArray(d[k]) && !isPlainObject(d[k])) errors.push(`« ${k} » doit être un tableau.`);
  }

  // Monnaie
  if (isPlainObject(d.currency) && Array.isArray(coins) && coins.length) {
    const keys = coins.map(c => c.key || c);
    for (const k of Object.keys(d.currency)) if (!keys.includes(k)) warnings.push(`currency.${k} : pièce inconnue dans cette campagne (${keys.join(', ')}).`);
  }

  // Unités : du métrique dans un texte libre.
  const texts = [
    ...list(d.featureList).map(f => [`Capacité « ${f?.name} »`, f?.text]),
    ...list(d.attacks).map(a => [`Attaque « ${a?.name} »`, `${a?.type || ''} ${a?.notes || ''}`]),
  ];
  for (const [where, txt] of texts) if (METRIC.test(String(txt || ''))) warnings.push(`${where} : unité métrique, écrire en pieds et en livres.`);

  return { errors, warnings };
}
