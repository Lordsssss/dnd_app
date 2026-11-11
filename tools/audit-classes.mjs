// Compare les données de classe de l'application (shared/classes.js, rules.js) aux tableaux
// officiels de 5etools, niveau par niveau : emplacements, cantrips, sorts préparés, invocations,
// ressources, colonnes du tableau, capacités et niveaux d'Ability Score Improvement.
//   node tools/audit-classes.mjs [dossier 5etools]
// Rien n'est écrit : la sortie liste les écarts. Code de sortie 1 s'il y en a.
import fs from 'node:fs';
import path from 'node:path';
import { CLASSES, asiLevels, casting } from '../shared/classes.js';
import { blankCharacter } from '../shared/model.js';
import { autoSlots, defaultResources, pactSlotsFor, casterInfo } from '../shared/rules.js';

const dir = process.argv[2] || '5etools';
const SOURCES = { artificer: 'TCE' };

const plain = v => {
  if (v == null) return '';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.replace(/\{@\w+\s+([^|}]+)[^}]*\}/g, '$1').trim();
  if (v.type === 'dice') return (v.toRoll || []).map(d => `${d.number}d${d.faces}`).join('+');
  if (v.type === 'bonus') return `+${v.value}`;
  if (v.type === 'bonusSpeed') return `+${v.value} ft.`;
  if (v.value != null) return String(v.value);
  return JSON.stringify(v);
};

function loadClass(key) {
  const file = path.join(dir, 'class', `class-${key}.json`);
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  const src = SOURCES[key] || 'XPHB';
  const c = d.class.find(x => x.source === src);
  const feats = (d.classFeature || []).filter(f => f.source === src && f.className === c.name && (f.classSource || src) === src);
  return { c, feats };
}

const issues = [];
const note = (cls, lvl, what, app, official) => issues.push(`${cls.padEnd(10)} niv. ${String(lvl).padStart(2)}  ${what.padEnd(24)} app : ${String(app).padEnd(14)} officiel : ${official}`);

for (const key of Object.keys(CLASSES)) {
  const def = CLASSES[key];
  const { c, feats } = loadClass(key);
  // Le tableau de la classe, colonne par colonne : { libellé: [valeur au niveau 1..20] }.
  const cols = {};
  for (const g of c.classTableGroups || []) {
    const labels = (g.colLabels || []).map(plain);
    const rows = g.rows || g.rowsSpellProgression || [];
    labels.forEach((lab, i) => { cols[g.rowsSpellProgression ? `slot ${lab}` : lab] = rows.map(r => plain(r[i])); });
  }

  for (let L = 1; L <= 20; L++) {
    const doc = blankCharacter({ className: def.name, level: L, edition: '2024' });
    for (const ab of ['str', 'dex', 'con', 'int', 'wis', 'cha']) doc.abilities[ab] = 14;
    const cast = casting(def.name, '');

    // Emplacements de sort.
    const slots = autoSlots(doc);
    for (const [lab, vals] of Object.entries(cols)) {
      const m = /^slot (\d)/.exec(lab);
      if (!m) continue;
      const want = Number(vals[L - 1]) || 0;
      if ((slots[m[1]] || 0) !== want) note(def.name, L, `emplacements niv. ${m[1]}`, slots[m[1]] || 0, want);
    }
    if (cols['Spell Slots']) {
      const p = pactSlotsFor(casterInfo(doc).warlockLevel);
      if (p.max !== Number(cols['Spell Slots'][L - 1])) note(def.name, L, 'emplacements de pacte', p.max, cols['Spell Slots'][L - 1]);
      const lvl = Number(String(cols['Slot Level'][L - 1]).replace(/\D/g, ''));
      if (p.level !== lvl) note(def.name, L, 'niveau de pacte', p.level, lvl);
    }
    // Cantrips, sorts préparés.
    if (c.cantripProgression && cast?.cantrips) {
      if (cast.cantrips(L) !== c.cantripProgression[L - 1]) note(def.name, L, 'cantrips', cast.cantrips(L), c.cantripProgression[L - 1]);
    }
    if (c.preparedSpellsProgression && cast?.prepared && !cast.spellbook) {
      if (cast.prepared(L) !== c.preparedSpellsProgression[L - 1]) note(def.name, L, 'sorts préparés', cast.prepared(L), c.preparedSpellsProgression[L - 1]);
    }
    if (c.preparedSpellsProgression && cast?.spellbook) {
      if (cast.prepared(L) !== c.preparedSpellsProgression[L - 1]) note(def.name, L, 'sorts préparés', cast.prepared(L), c.preparedSpellsProgression[L - 1]);
    }
    if (def.invocations && cols.Invocations) {
      if (def.invocations(L) !== Number(cols.Invocations[L - 1])) note(def.name, L, 'invocations', def.invocations(L), cols.Invocations[L - 1]);
    }
    // Ressources de la classe contre les colonnes du tableau.
    const res = Object.fromEntries(defaultResources(def.name, '', L, doc).map(r => [r.name, r.max]));
    const RES = { Rages: 'Rage', 'Channel Divinity': 'Channel Divinity', 'Wild Shape': 'Wild Shape', 'Focus Points': 'Focus Points', 'Sorcery Points': 'Sorcery Points', 'Second Wind': 'Second Wind', 'Favored Enemy': 'Favored Enemy' };
    for (const [col, name] of Object.entries(RES)) {
      if (!cols[col]) continue;
      const want = Number(cols[col][L - 1]) || 0;
      if ((res[name] || 0) !== want) note(def.name, L, name, res[name] || 0, want);
    }
    // Colonnes affichées (dés, nombres d'armes, infusions).
    const info = def.info ? def.info(L) : {};
    const INFO = { 'Rage Damage': 'Rage Damage', 'Weapon Mastery': 'Weapon Mastery', 'Bardic Die': 'Bardic Inspiration', 'Martial Arts': 'Martial Arts', 'Sneak Attack': 'Sneak Attack' };
    for (const [col, k] of Object.entries(INFO)) {
      if (!cols[col]) continue;
      const want = String(cols[col][L - 1]).replace(/^1d/, 'd');
      const got = String(info[k] ?? '').replace(/ armes$/, '');
      if (got !== want && got.replace(/^\+/, '') !== want.replace(/^\+/, '')) note(def.name, L, col, got || '—', want);
    }
    if (key === 'artificer' && L >= 2) {
      const known = Number(cols['Infusions Known']?.[L - 1]);
      const items = Number(cols['Infused Items']?.[L - 1]);
      if (info.Infusions !== `${known} connues, ${items} actives`) note(def.name, L, 'infusions', info.Infusions, `${known} connues, ${items} actives`);
    }
    // Capacités du niveau.
    const official = feats.filter(f => f.level === L).map(f => f.name).filter(n => !/^Ability Score Improvement$|^Epic Boon$/.test(n));
    const mine = (def.features[L] || []).filter(n => n !== 'Subclass feature');
    const missing = official.filter(n => !mine.some(m => m.toLowerCase() === n.toLowerCase()) && !/Subclass Feature/i.test(n));
    if (missing.length) note(def.name, L, 'capacités absentes', mine.join(', ') || '—', missing.join(', '));
  }
  // Niveaux d'Ability Score Improvement.
  const asiOfficial = feats.filter(f => /^Ability Score Improvement$/.test(f.name)).map(f => f.level).sort((a, b) => a - b);
  const asiMine = asiLevels(def.name).filter(l => l < 19);
  if (asiOfficial.join() !== asiMine.join()) note(def.name, 0, 'niveaux ASI', asiMine.join(','), asiOfficial.join(','));
}

console.log(issues.length ? issues.join('\n') : 'Aucun écart.');
console.log(`\n${issues.length} écart(s).`);
process.exitCode = issues.length ? 1 : 0;
