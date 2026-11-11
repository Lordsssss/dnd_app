// Simule le bouton Level up pour chaque classe et chaque sous-classe, niveau 1 à 20, et liste
// ce que la fenêtre propose : choix de l'application, options et dons tirés de 5etools, sorts
// donnés, Weapon Mastery, sorts à choisir. Sert à repérer un choix manquant ou en double.
//   node tools/audit-levelup.mjs [dossier 5etools] [classe]
import { FiveETools } from '../server/data5e.js';
import { CLASSES } from '../shared/classes.js';
import { blankCharacter } from '../shared/model.js';
import { levelUpOptions } from '../shared/levelup.js';

const dir = process.argv[2] || '5etools';
const only = (process.argv[3] || '').toLowerCase();
const d5 = new FiveETools(dir, ['XPHB', 'XDMG', 'XMM', 'PHB', 'DMG', 'MM', 'TCE', 'XGE']).load();
const SOURCES = { artificer: 'TCE' };

// Ce que la fenêtre montre, avec la même règle de recouvrement que levelup-dialog.js.
function offered(opt, info) {
  const covered = new Set();
  if (info?.optional.some(p => p.types.includes('EI'))) covered.add('Eldritch Invocation');
  if (info?.optional.some(p => p.types.includes('MM'))) covered.add('Metamagic');
  if (info?.feats.some(f => f.categories.includes('Fighting Style')) || info?.optional.some(p => p.types.some(x => x.startsWith('FS')))) covered.add('Fighting Style');
  const out = [];
  if (opt.subclassNeeded) out.push('SOUS-CLASSE');
  if (opt.asi) out.push('ASI/don');
  if (opt.epic) out.push('Epic Boon');
  for (const c of opt.choices.filter(c => !covered.has(c.label))) out.push(c.type === 'expertise' ? `expertise ×${c.count}${c.skills ? ` (${c.skills.join('/')})` : ''}` : `${c.label} ×${c.count}${c.type === 'skill' ? ' (compétence)' : ''}`);
  if (info) {
    for (const p of info.optional.filter(p => p.count)) out.push(`[5e] ${p.name} +${p.count} (${p.types.join('/')}, ${p.owner})`);
    for (const f of info.feats) out.push(`[5e don] ${f.name} ×${f.count} (${f.categories.join('/')})`);
    for (const s of info.sets) out.push(`[5e ensemble] ${s.set}`);
    if (info.mastery) out.push(`[5e] Weapon Mastery +${info.mastery}`);
    for (const g of info.additional) {
      for (const s of g.spells) out.push(`[5e sort ${g.owner}] ${s.name} (${s.mode}${s.note ? `, ${s.note}` : ''})`);
      for (const p of g.picks) out.push(`[5e choix ${g.owner}] ${p.count} sort(s) ${p.from ? p.from.map(x => x.name).join('/') : `niv. ${(p.levels || []).join(',')} ${(p.classes || []).join('/')} ${(p.schools || []).join('/')}`} (${p.mode}${p.note ? `, ${p.note}` : ''})`);
      for (const t of g.info) out.push(`[5e info ${g.owner}] ${t}`);
    }
  }
  const sp = opt.spells;
  if (sp && (sp.cantrips || sp.leveled || sp.arcanum)) out.push(`sorts : ${sp.cantrips ? `${sp.cantrips} cantrip(s), ` : ''}${sp.leveled} sort(s) ≤ ${sp.maxLevel}${sp.arcanum ? `, arcanum ${sp.arcanum}` : ''} · liste ${[].concat(sp.list).join('/')}`);
  return out;
}

for (const [key, def] of Object.entries(CLASSES)) {
  if (only && key !== only) continue;
  const src = SOURCES[key] || 'XPHB';
  const k = d5.klass(def.name, src);
  const subs = (k?.subclasses || []).filter(s => s.classSource === src).map(s => s.name);
  console.log(`\n=== ${def.name} ${src} · sous-classes 5etools : ${subs.join(', ')}`);
  for (const sub of ['', ...subs]) {
    const lines = [];
    for (let L = 1; L <= 20; L++) {
      const doc = blankCharacter({ className: def.name, level: Math.max(1, L - 1), edition: '2024' });
      if (L === 1) doc.classes = [];
      if (sub && L - 1 >= 3) doc.classes[0].subclass = sub;
      const sel = L === 1 ? { newClass: key } : { classIndex: 0, subclass: sub };
      if (L === 1) sel.picks = { c1_0: ['Thaumaturge', 'Magician'] };
      let opt;
      try { opt = levelUpOptions(doc, sel); } catch (e) { lines.push(`${L}: ERREUR ${e.message}`); continue; }
      const info = d5.levelInfo(def.name, src, opt.subclass || '', L - 1, L);
      let out = offered(opt, info);
      // Pour une sous-classe, ne garder que ce qui lui est propre.
      if (sub) out = out.filter(x => /subclass\)|sort subclass|info subclass|choix subclass|ensemble/.test(x) || !/^(SOUS-CLASSE|ASI|Epic|sorts :|\[5e\] (Weapon|Infusions|Metamagic|Eldritch)|\[5e don\] Epic|\[5e sort class)/.test(x) && !(def.choices?.[L] || []).some(c => x.startsWith(c.label || 'expertise')));
      if (out.length) lines.push(`${String(L).padStart(2)}: ${out.join(' | ')}`);
    }
    console.log(`--- ${sub || '(classe)'}`);
    for (const l of lines) console.log(`  ${l}`);
  }
}
