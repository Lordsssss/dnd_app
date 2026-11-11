// Les 12 classes du PHB 2024 : progression, capacités, ressources et choix
// à faire en montant de niveau. Données pures, sans dépendance.

const T = arr => lvl => arr[Math.max(1, Math.min(20, lvl)) - 1];

export const FIGHTING_STYLES = [
  'Archery', 'Blind Fighting', 'Defense', 'Dueling', 'Great Weapon Fighting', 'Interception',
  'Protection', 'Thrown Weapon Fighting', 'Two-Weapon Fighting', 'Unarmed Fighting',
];

export const METAMAGIC = [
  'Careful Spell', 'Distant Spell', 'Empowered Spell', 'Extended Spell', 'Heightened Spell',
  'Quickened Spell', 'Seeking Spell', 'Subtle Spell', 'Transmuted Spell', 'Twinned Spell',
];

export const INVOCATIONS = [
  'Agonizing Blast', 'Armor of Shadows', 'Ascendant Step', "Devil's Sight", 'Devouring Blade',
  'Eldritch Mind', 'Eldritch Smite', 'Eldritch Spear', 'Fiendish Vigor', 'Gaze of Two Minds',
  'Gift of the Depths', 'Gift of the Protectors', 'Investment of the Chain Master',
  'Lessons of the First Ones', 'Lifedrinker', 'Mask of Many Faces', 'Master of Myriad Forms',
  'Misty Visions', 'One with Shadows', 'Otherworldly Leap', 'Pact of the Blade', 'Pact of the Chain',
  'Pact of the Tome', 'Repelling Blast', 'Thirsting Blade', 'Visions of Distant Realms',
  'Whispers of the Grave', 'Witch Sight',
];

const ASI = 'Ability Score Improvement';
const SUB = 'Subclass feature';
const STD_ASI = [4, 8, 12, 16];
const FULL_PREP = [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22];
const HALF_PREP = [2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15];
const THIRD_PREP = [0, 0, 3, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 13];
const c234 = l => (l >= 10 ? 4 : l >= 4 ? 3 : 2);
const c345 = l => (l >= 10 ? 5 : l >= 4 ? 4 : 3);

export const CLASSES = {
  // Hors PHB 2024 : version Tasha's Cauldron of Everything (infusions, Arcane Firearm).
  artificer: {
    name: 'Artificer', hitDie: 8, prereq: { all: ['int'] }, saves: ['con', 'int'],
    multiclassProfs: "Light armor, Medium armor, Shields, Thieves' Tools, Tinker's Tools",
    asi: [4, 8, 12, 16, 19],
    caster: 'halfUp', ability: 'int', mode: 'prepared', list: 'Artificer',
    cantrips: T([2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4]),
    // Préparés : INT + moitié du niveau, arrondie à l'inférieur. Ici, la part qui dépend du niveau.
    prepared: l => Math.max(1, Math.floor(l / 2)),
    subclasses: ['Alchemist', 'Armorer', 'Artillerist', 'Battle Smith'],
    features: {
      1: ['Magical Tinkering', 'Spellcasting'], 2: ['Infuse Item'], 3: ['Artificer Specialist', 'The Right Tool for the Job'],
      5: [SUB], 6: ['Tool Expertise'], 7: ['Flash of Genius'], 9: [SUB], 10: ['Magic Item Adept'],
      11: ['Spell-Storing Item'], 14: ['Magic Item Savant'], 15: [SUB], 18: ['Magic Item Master'], 20: ['Soul of Artifice'],
    },
    resources: (l, m) => (l >= 7 ? [{ name: 'Flash of Genius', max: Math.max(1, m.int), reset: 'long' }] : []),
    info: l => (l >= 2 ? { Infusions: `${l >= 18 ? 12 : l >= 14 ? 10 : l >= 10 ? 8 : l >= 6 ? 6 : 4} connues, ${l >= 18 ? 6 : l >= 14 ? 5 : l >= 10 ? 4 : l >= 6 ? 3 : 2} actives` } : {}),
  },
  barbarian: {
    name: 'Barbarian', hitDie: 12, prereq: { all: ['str'] }, saves: ['str', 'con'],
    multiclassProfs: 'Shields, Martial weapons',
    subclasses: ['Path of the Berserker', 'Path of the Wild Heart', 'Path of the World Tree', 'Path of the Zealot'],
    features: {
      1: ['Rage', 'Unarmored Defense', 'Weapon Mastery'], 2: ['Danger Sense', 'Reckless Attack'],
      3: ['Barbarian Subclass', 'Primal Knowledge'], 5: ['Extra Attack', 'Fast Movement'], 6: [SUB],
      7: ['Feral Instinct', 'Instinctive Pounce'], 9: ['Brutal Strike'], 10: [SUB], 11: ['Relentless Rage'],
      13: ['Improved Brutal Strike'], 14: [SUB], 15: ['Persistent Rage'], 17: ['Improved Brutal Strike'],
      18: ['Indomitable Might'], 20: ['Primal Champion'],
    },
    choices: { 3: [{ type: 'skill', label: 'Primal Knowledge', count: 1, skills: ['animalHandling', 'athletics', 'intimidation', 'nature', 'perception', 'survival'] }] },
    resources: l => [{ name: 'Rage', max: T([2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6])(l), reset: 'short1' }],
    info: l => ({ 'Rage Damage': `+${l >= 16 ? 4 : l >= 9 ? 3 : 2}`, 'Weapon Mastery': `${l >= 10 ? 4 : l >= 4 ? 3 : 2} armes` }),
  },
  bard: {
    name: 'Bard', hitDie: 8, prereq: { all: ['cha'] }, saves: ['dex', 'cha'],
    multiclassProfs: 'Light armor, une compétence, un instrument de musique',
    caster: 'full', ability: 'cha', mode: 'known', list: 'Bard', cantrips: T([2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]), prepared: T(FULL_PREP),
    subclasses: ['College of Dance', 'College of Glamour', 'College of Lore', 'College of Valor'],
    features: {
      1: ['Bardic Inspiration', 'Spellcasting'], 2: ['Expertise', 'Jack of All Trades'], 3: ['Bard Subclass'],
      5: ['Font of Inspiration'], 6: [SUB], 7: ['Countercharm'], 9: ['Expertise'], 10: ['Magical Secrets'],
      14: [SUB], 18: ['Superior Inspiration'], 20: ['Words of Creation'],
    },
    choices: { 2: [{ type: 'expertise', count: 2 }], 9: [{ type: 'expertise', count: 2 }] },
    resources: (l, m) => [{ name: 'Bardic Inspiration', max: Math.max(1, m.cha), reset: l >= 5 ? 'short' : 'long' }],
    info: l => ({ 'Bardic Inspiration': `d${l >= 15 ? 12 : l >= 10 ? 10 : l >= 5 ? 8 : 6}` }),
  },
  cleric: {
    name: 'Cleric', hitDie: 8, prereq: { all: ['wis'] }, saves: ['wis', 'cha'],
    multiclassProfs: 'Light armor, Medium armor, Shields',
    caster: 'full', ability: 'wis', mode: 'prepared', list: 'Cleric', cantrips: c345, prepared: T(FULL_PREP),
    subclasses: ['Life Domain', 'Light Domain', 'Trickery Domain', 'War Domain'],
    features: {
      1: ['Spellcasting', 'Divine Order'], 2: ['Channel Divinity'], 3: ['Cleric Subclass'], 5: ['Sear Undead'],
      6: [SUB], 7: ['Blessed Strikes'], 10: ['Divine Intervention'], 14: ['Improved Blessed Strikes'],
      17: [SUB], 20: ['Greater Divine Intervention'],
    },
    choices: {
      1: [{ type: 'select', label: 'Divine Order', options: ['Protector', 'Thaumaturge'], cantrip: 'Thaumaturge' }],
      7: [{ type: 'select', label: 'Blessed Strikes', options: ['Divine Strike', 'Potent Spellcasting'] }],
    },
    resources: l => (l >= 2 ? [{ name: 'Channel Divinity', max: l >= 18 ? 4 : l >= 6 ? 3 : 2, reset: 'short1' }] : []),
  },
  druid: {
    name: 'Druid', hitDie: 8, prereq: { all: ['wis'] }, saves: ['int', 'wis'],
    multiclassProfs: 'Light armor, Shields',
    caster: 'full', ability: 'wis', mode: 'prepared', list: 'Druid', cantrips: c234, prepared: T(FULL_PREP),
    subclasses: ['Circle of the Land', 'Circle of the Moon', 'Circle of the Sea', 'Circle of the Stars'],
    features: {
      1: ['Spellcasting', 'Druidic', 'Primal Order'], 2: ['Wild Shape', 'Wild Companion'], 3: ['Druid Subclass'],
      5: ['Wild Resurgence'], 6: [SUB], 7: ['Elemental Fury'], 10: [SUB], 14: [SUB],
      15: ['Improved Elemental Fury'], 18: ['Beast Spells'], 20: ['Archdruid'],
    },
    choices: {
      1: [{ type: 'select', label: 'Primal Order', options: ['Magician', 'Warden'], cantrip: 'Magician' }],
      7: [{ type: 'select', label: 'Elemental Fury', options: ['Potent Spellcasting', 'Primal Strike'] }],
    },
    resources: l => (l >= 2 ? [{ name: 'Wild Shape', max: l >= 17 ? 4 : l >= 6 ? 3 : 2, reset: 'short1' }] : []),
  },
  fighter: {
    name: 'Fighter', hitDie: 10, prereq: { any: ['str', 'dex'] }, saves: ['str', 'con'],
    multiclassProfs: 'Light armor, Medium armor, Shields, Martial weapons',
    asi: [4, 6, 8, 12, 14, 16],
    subclasses: ['Battle Master', 'Champion', 'Eldritch Knight', 'Psi Warrior'],
    features: {
      1: ['Fighting Style', 'Second Wind', 'Weapon Mastery'], 2: ['Action Surge', 'Tactical Mind'], 3: ['Fighter Subclass'],
      5: ['Extra Attack', 'Tactical Shift'], 7: [SUB], 9: ['Indomitable', 'Tactical Master'], 10: [SUB],
      11: ['Two Extra Attacks'], 13: ['Indomitable (two uses)', 'Studied Attacks'], 15: [SUB],
      17: ['Action Surge (two uses)', 'Indomitable (three uses)'], 18: [SUB], 20: ['Three Extra Attacks'],
    },
    choices: { 1: [{ type: 'select', label: 'Fighting Style', options: FIGHTING_STYLES }] },
    resources: l => [
      { name: 'Second Wind', max: l >= 10 ? 4 : l >= 4 ? 3 : 2, reset: 'short1' },
      ...(l >= 2 ? [{ name: 'Action Surge', max: l >= 17 ? 2 : 1, reset: 'short' }] : []),
      ...(l >= 9 ? [{ name: 'Indomitable', max: l >= 17 ? 3 : l >= 13 ? 2 : 1, reset: 'long' }] : []),
    ],
    info: l => ({ 'Weapon Mastery': `${l >= 16 ? 6 : l >= 10 ? 5 : l >= 4 ? 4 : 3} armes`, Attaques: `${l >= 20 ? 4 : l >= 11 ? 3 : l >= 5 ? 2 : 1} par action` }),
  },
  monk: {
    name: 'Monk', hitDie: 8, prereq: { all: ['dex', 'wis'] }, saves: ['str', 'dex'],
    multiclassProfs: 'aucune',
    subclasses: ['Warrior of Mercy', 'Warrior of Shadow', 'Warrior of the Elements', 'Warrior of the Open Hand'],
    features: {
      1: ['Martial Arts', 'Unarmored Defense'], 2: ["Monk's Focus", 'Unarmored Movement', 'Uncanny Metabolism'],
      3: ['Deflect Attacks', 'Monk Subclass'], 4: ['Slow Fall'], 5: ['Extra Attack', 'Stunning Strike'],
      6: ['Empowered Strikes', SUB], 7: ['Evasion'], 9: ['Acrobatic Movement'], 10: ['Heightened Focus', 'Self-Restoration'],
      11: [SUB], 13: ['Deflect Energy'], 14: ['Disciplined Survivor'], 15: ['Perfect Focus'], 17: [SUB],
      18: ['Superior Defense'], 20: ['Body and Mind'],
    },
    resources: l => (l >= 2 ? [{ name: 'Focus Points', max: l, reset: 'short' }] : []),
    info: l => ({ 'Martial Arts': `d${l >= 17 ? 12 : l >= 11 ? 10 : l >= 5 ? 8 : 6}` }),
  },
  paladin: {
    name: 'Paladin', hitDie: 10, prereq: { all: ['str', 'cha'] }, saves: ['wis', 'cha'],
    multiclassProfs: 'Light armor, Medium armor, Shields, Martial weapons',
    caster: 'half', ability: 'cha', mode: 'prepared', list: 'Paladin', prepared: T(HALF_PREP),
    subclasses: ['Oath of Devotion', 'Oath of Glory', 'Oath of the Ancients', 'Oath of Vengeance'],
    features: {
      1: ['Lay on Hands', 'Spellcasting', 'Weapon Mastery'], 2: ['Fighting Style', "Paladin's Smite"],
      3: ['Channel Divinity', 'Paladin Subclass'], 5: ['Extra Attack', 'Faithful Steed'], 6: ['Aura of Protection'],
      7: [SUB], 9: ['Abjure Foes'], 10: ['Aura of Courage'], 11: ['Radiant Strikes'], 14: ['Restoring Touch'],
      15: [SUB], 18: ['Aura Expansion'], 20: [SUB],
    },
    choices: { 2: [{ type: 'select', label: 'Fighting Style', options: FIGHTING_STYLES }] },
    resources: l => [
      { name: 'Lay on Hands', max: 5 * l, reset: 'long' },
      ...(l >= 3 ? [{ name: 'Channel Divinity', max: l >= 11 ? 3 : 2, reset: 'short1' }] : []),
    ],
  },
  ranger: {
    name: 'Ranger', hitDie: 10, prereq: { all: ['dex', 'wis'] }, saves: ['str', 'dex'],
    multiclassProfs: 'Light armor, Medium armor, Shields, Martial weapons, une compétence',
    caster: 'half', ability: 'wis', mode: 'known', list: 'Ranger', prepared: T(HALF_PREP),
    subclasses: ['Beast Master', 'Fey Wanderer', 'Gloom Stalker', 'Hunter'],
    features: {
      1: ['Spellcasting', 'Favored Enemy', 'Weapon Mastery'], 2: ['Deft Explorer', 'Fighting Style'],
      3: ['Ranger Subclass'], 5: ['Extra Attack'], 6: ['Roving'], 7: [SUB], 9: ['Expertise'], 10: ['Tireless'],
      11: [SUB], 13: ['Relentless Hunter'], 14: ["Nature's Veil"], 15: [SUB], 17: ['Precise Hunter'],
      18: ['Feral Senses'], 20: ['Foe Slayer'],
    },
    choices: {
      2: [{ type: 'select', label: 'Fighting Style', options: FIGHTING_STYLES }, { type: 'expertise', count: 1 }],
      9: [{ type: 'expertise', count: 2 }],
    },
    resources: l => [{ name: 'Favored Enemy', max: T([2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6])(l), reset: 'long' }],
  },
  rogue: {
    name: 'Rogue', hitDie: 8, prereq: { all: ['dex'] }, saves: ['dex', 'int'],
    multiclassProfs: "Light armor, une compétence, Thieves' Tools",
    asi: [4, 8, 10, 12, 16],
    subclasses: ['Arcane Trickster', 'Assassin', 'Soulknife', 'Thief'],
    features: {
      1: ['Expertise', 'Sneak Attack', "Thieves' Cant", 'Weapon Mastery'], 2: ['Cunning Action'],
      3: ['Rogue Subclass', 'Steady Aim'], 5: ['Cunning Strike', 'Uncanny Dodge'], 6: ['Expertise'],
      7: ['Evasion', 'Reliable Talent'], 9: [SUB], 11: ['Improved Cunning Strike'], 13: [SUB],
      14: ['Devious Strikes'], 15: ['Slippery Mind'], 17: [SUB], 18: ['Elusive'], 20: ['Stroke of Luck'],
    },
    choices: { 1: [{ type: 'expertise', count: 2 }], 6: [{ type: 'expertise', count: 2 }] },
    info: l => ({ 'Sneak Attack': `${Math.ceil(l / 2)}d6` }),
  },
  sorcerer: {
    name: 'Sorcerer', hitDie: 6, prereq: { all: ['cha'] }, saves: ['con', 'cha'],
    multiclassProfs: 'aucune',
    caster: 'full', ability: 'cha', mode: 'known', list: 'Sorcerer', cantrips: T([4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6]),
    prepared: T([2, 4, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22]),
    subclasses: ['Aberrant Sorcery', 'Clockwork Sorcery', 'Draconic Sorcery', 'Wild Magic Sorcery'],
    features: {
      1: ['Spellcasting', 'Innate Sorcery'], 2: ['Font of Magic', 'Metamagic'], 3: ['Sorcerer Subclass'],
      5: ['Sorcerous Restoration'], 6: [SUB], 7: ['Sorcery Incarnate'], 10: ['Metamagic'], 14: [SUB],
      17: ['Metamagic'], 18: [SUB], 20: ['Arcane Apotheosis'],
    },
    choices: {
      2: [{ type: 'select', label: 'Metamagic', options: METAMAGIC, count: 2 }],
      10: [{ type: 'select', label: 'Metamagic', options: METAMAGIC, count: 2 }],
      17: [{ type: 'select', label: 'Metamagic', options: METAMAGIC, count: 2 }],
    },
    resources: l => [
      { name: 'Innate Sorcery', max: 2, reset: 'long' },
      ...(l >= 2 ? [{ name: 'Sorcery Points', max: l, reset: 'long' }] : []),
    ],
  },
  warlock: {
    name: 'Warlock', hitDie: 8, prereq: { all: ['cha'] }, saves: ['wis', 'cha'],
    multiclassProfs: 'Light armor',
    caster: 'pact', ability: 'cha', mode: 'known', list: 'Warlock', cantrips: c234,
    prepared: T([2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15]),
    invocations: T([1, 3, 3, 3, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10]),
    subclasses: ['Archfey Patron', 'Celestial Patron', 'Fiend Patron', 'Great Old One Patron'],
    features: {
      1: ['Eldritch Invocations', 'Pact Magic'], 2: ['Magical Cunning'], 3: ['Warlock Subclass'], 6: [SUB],
      9: ['Contact Patron'], 10: [SUB], 11: ['Mystic Arcanum (6th level)'], 13: ['Mystic Arcanum (7th level)'],
      14: [SUB], 15: ['Mystic Arcanum (8th level)'], 17: ['Mystic Arcanum (9th level)'], 20: ['Eldritch Master'],
    },
    arcanum: { 11: 6, 13: 7, 15: 8, 17: 9 },
    resources: (l, m, sub) => [
      ...(l >= 2 ? [{ name: 'Magical Cunning', max: 1, reset: 'long' }] : []),
      ...(l >= 3 && /archfey/i.test(sub || '') ? [{ name: 'Steps of the Fey', max: Math.max(1, m.cha), reset: 'long' }] : []),
      ...Object.entries({ 11: 6, 13: 7, 15: 8, 17: 9 }).filter(([lv]) => l >= +lv).map(([, sl]) => ({ name: `Mystic Arcanum (${sl})`, max: 1, reset: 'long' })),
    ],
  },
  wizard: {
    name: 'Wizard', hitDie: 6, prereq: { all: ['int'] }, saves: ['int', 'wis'],
    multiclassProfs: 'aucune',
    caster: 'full', ability: 'int', mode: 'prepared', list: 'Wizard', cantrips: c345, spellbook: 2,
    prepared: T([4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 18, 19, 21, 22, 23, 24, 25]),
    subclasses: ['Abjurer', 'Diviner', 'Evoker', 'Illusionist'],
    features: {
      1: ['Spellcasting', 'Ritual Adept', 'Arcane Recovery'], 2: ['Scholar'], 3: ['Wizard Subclass'],
      5: ['Memorize Spell'], 6: [SUB], 10: [SUB], 14: [SUB], 18: ['Spell Mastery'], 20: ['Signature Spells'],
    },
    choices: {
      2: [{ type: 'expertise', label: 'Scholar', count: 1, skills: ['arcana', 'history', 'investigation', 'medicine', 'nature', 'religion'] }],
      18: [{ type: 'text', label: 'Spell Mastery', count: 2, hint: 'un sort de niveau 1 et un de niveau 2 du grimoire' }],
      20: [{ type: 'text', label: 'Signature Spells', count: 2, hint: 'deux sorts de niveau 3 du grimoire' }],
    },
    resources: () => [{ name: 'Arcane Recovery', max: 1, reset: 'long' }],
  },
};

// Lanceurs d'un tiers : la magie vient de la sous-classe.
export const THIRD_CASTERS = {
  'eldritch knight': { ability: 'int', mode: 'known', list: 'Wizard', cantrips: l => (l >= 10 ? 3 : l >= 3 ? 2 : 0), prepared: T(THIRD_PREP) },
  'arcane trickster': { ability: 'int', mode: 'known', list: 'Wizard', cantrips: l => (l >= 10 ? 4 : l >= 3 ? 3 : 0), prepared: T(THIRD_PREP) },
};

export const SUBCLASS_FEATURES = {
  champion: { 3: ['Improved Critical', 'Remarkable Athlete'], 7: ['Additional Fighting Style'], 10: ['Heroic Warrior'], 15: ['Superior Critical'], 18: ['Survivor'] },
  illusion: { 3: ['Illusion Savant', 'Improved Illusions'], 6: ['Phantasmal Creatures'], 10: ['Illusory Self'], 14: ['Illusory Reality'] },
  archfey: { 3: ['Archfey Spells', 'Steps of the Fey'], 6: ['Misty Escape'], 10: ['Beguiling Defenses'], 14: ['Bewitching Magic'] },
  stars: { 3: ['Star Map', 'Starry Form'], 6: ['Cosmic Omen'], 10: ['Twinkling Constellations'], 14: ['Full of Stars'] },
  artillerist: { 3: ['Artillerist Spells', 'Eldritch Cannon', 'Tool Proficiency'], 5: ['Arcane Firearm'], 9: ['Explosive Cannon'], 15: ['Fortified Position'] },
};

// Choix propres à une sous-classe, par classe puis par nom de sous-classe (recherche partielle).
const FIGHTER_SKILLS = ['acrobatics', 'animalHandling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'persuasion', 'survival'];
export const SUBCLASS_CHOICES = {
  bard: { lore: { 3: [{ type: 'skill', label: 'Bonus Proficiencies', count: 3 }] } },
  fighter: {
    champion: { 7: [{ type: 'select', label: 'Fighting Style', options: FIGHTING_STYLES }] },
    'battle master': { 3: [{ type: 'skill', label: 'Student of War', count: 1, skills: FIGHTER_SKILLS }] },
  },
  ranger: {
    'beast master': { 3: [{ type: 'select', label: 'Primal Companion', options: ['Beast of the Land', 'Beast of the Sea', 'Beast of the Sky'] }] },
    'fey wanderer': { 3: [{ type: 'skill', label: 'Otherworldly Glamour', count: 1, skills: ['deception', 'performance', 'persuasion'] }] },
    hunter: {
      3: [{ type: 'select', label: "Hunter's Prey", options: ['Colossus Slayer', 'Horde Breaker'] }],
      7: [{ type: 'select', label: 'Defensive Tactics', options: ['Escape the Horde', 'Multiattack Defense'] }],
    },
  },
  sorcerer: { draconic: { 6: [{ type: 'select', label: 'Elemental Affinity', options: ['Acid', 'Cold', 'Fire', 'Lightning', 'Poison'] }] } },
};

export function subclassChoices(className, subclass, level) {
  const table = SUBCLASS_CHOICES[String(className || '').trim().toLowerCase()];
  const s = String(subclass || '').toLowerCase();
  if (!table || !s) return [];
  const k = Object.keys(table).find(x => s.includes(x));
  return k ? table[k][level] || [] : [];
}

// Noms 2014 d'une sous-classe dont le PHB 2024 a une nouvelle version : sur une fiche 2024,
// « The Archfey » est l'Archfey Patron.
const MODERN_SUBCLASSES = {
  'the archfey': 'Archfey Patron', 'the fiend': 'Fiend Patron', 'the great old one': 'Great Old One Patron', 'the celestial': 'Celestial Patron',
  'school of abjuration': 'Abjurer', 'school of divination': 'Diviner', 'school of evocation': 'Evoker', 'school of illusion': 'Illusionist',
  'draconic bloodline': 'Draconic Sorcery', 'wild magic': 'Wild Magic Sorcery', 'aberrant mind': 'Aberrant Sorcery', 'clockwork soul': 'Clockwork Sorcery',
  'way of the open hand': 'Warrior of the Open Hand', 'way of shadow': 'Warrior of Shadow', 'way of mercy': 'Warrior of Mercy',
};
export function modernSubclass(name) {
  return MODERN_SUBCLASSES[String(name || '').trim().toLowerCase()] || null;
}

export function classDef(name) {
  return CLASSES[String(name || '').trim().toLowerCase()] || null;
}

export function thirdCaster(subclass) {
  const s = String(subclass || '').toLowerCase();
  const k = Object.keys(THIRD_CASTERS).find(x => s.includes(x));
  return k ? THIRD_CASTERS[k] : null;
}

export function asiLevels(name) {
  return classDef(name)?.asi || STD_ASI;
}

// Plus haut niveau de sort accessible à ce niveau de classe (0 = aucun).
export function maxSpellLevel(name, level, subclass) {
  const d = classDef(name);
  const l = Number(level) || 0;
  if (d?.caster === 'full') return Math.min(9, Math.ceil(l / 2));
  if (d?.caster === 'half' || d?.caster === 'halfUp') return l < 1 ? 0 : Math.min(5, Math.ceil(l / 4));
  if (d?.caster === 'pact') return Math.min(5, Math.ceil(l / 2));
  if (thirdCaster(subclass)) return l < 3 ? 0 : l < 7 ? 1 : l < 13 ? 2 : l < 19 ? 3 : 4;
  return 0;
}

// Magie propre à la classe (ou à sa sous-classe pour Eldritch Knight / Arcane Trickster).
export function casting(name, subclass) {
  const d = classDef(name);
  if (d?.caster) return d;
  return thirdCaster(subclass);
}

export function meetsPrereq(def, abilities) {
  const ok = ab => (Number(abilities?.[ab]) || 0) >= 13;
  if (!def?.prereq) return true;
  return def.prereq.all ? def.prereq.all.every(ok) : def.prereq.any.some(ok);
}

export function prereqText(def) {
  if (!def?.prereq) return '';
  const up = a => a.toUpperCase();
  return def.prereq.all ? def.prereq.all.map(up).join(' et ') + ' 13' : def.prereq.any.map(up).join(' ou ') + ' 13';
}
