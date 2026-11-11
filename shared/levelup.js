// Montée de niveau, pour toute classe et tout multiclassage (PHB 2024).
// La même fonction sert à l'aperçu dans la fenêtre et à l'action du serveur.
import { isPlainObject, newId } from './patch.js';
import { applyAutoSlots } from './model.js';
import { addFeatures } from './features.js';
import {
  ABILITIES, ABILITY_SHORT, SKILLS, abilityMod, classKey, defaultResources, featuresAt, isAsiLevel,
  num, totalLevel,
} from './rules.js';
import {
  CLASSES, INVOCATIONS, asiLevels, casting, classDef, maxSpellLevel, meetsPrereq, prereqText, subclassChoices,
} from './classes.js';

export class LevelUpError extends Error {}
const fail = msg => { throw new LevelUpError(msg); };
const str = (v, n = 80) => String(v ?? '').trim().slice(0, n);

export function levelTarget(doc, { classIndex = 0, newClass = null } = {}) {
  if (newClass) {
    const def = CLASSES[newClass];
    if (!def) fail('Classe inconnue');
    if ((doc.classes || []).some(c => classKey(c.name) === newClass)) fail(`Déjà ${def.name} : monte cette classe directement`);
    return { key: newClass, def, name: def.name, subclass: '', from: 0, to: 1, isNew: true, hitDie: def.hitDie, index: (doc.classes || []).length };
  }
  const i = Math.max(0, Math.min((doc.classes || []).length - 1, num(classIndex)));
  const c = doc.classes?.[i];
  if (!c) fail('Classe introuvable');
  const key = classKey(c.name);
  const def = CLASSES[key] || null;
  const from = Math.max(0, num(c.level, 1));
  if (from >= 20) fail(`${c.name} est déjà niveau 20`);
  return { key, def, name: c.name || '?', subclass: c.subclass || '', from, to: from + 1, isNew: false, hitDie: num(c.hitDie) || def?.hitDie || 8, index: i };
}

// Tout ce qu'il faut demander au joueur pour cette montée de niveau.
export function levelUpOptions(doc, sel = {}) {
  const t = levelTarget(doc, sel);
  const L = t.to;
  const def = t.def;
  const firstClass = !(doc.classes || []).some(c => c.name);
  const subclassNeeded = !!def && !t.subclass && L >= 3;
  const sub = subclassNeeded ? str(sel.subclass) : t.subclass;
  const asi = asiLevels(t.name).includes(L);
  // Epic Boon au niveau 19 dans le PHB 2024 ; l'Artificer de Tasha's y garde un ASI.
  const epic = L === 19 && !asi;

  const choices = [
    ...(def?.choices?.[L] || []).map((c, i) => ({ id: `c${L}_${i}`, count: 1, ...c })),
    ...subclassChoices(t.name, sub, L).map((c, i) => ({ id: `s${L}_${i}`, count: 1, ...c })),
  ];
  const picks = isPlainObject(sel.picks) ? sel.picks : {};
  // Divine Order Thaumaturge, Primal Order Magician : un cantrip de plus.
  const bonusCantrips = choices.filter(c => c.cantrip && [].concat(picks[c.id] || []).includes(c.cantrip)).length;
  if (def?.invocations) {
    const n = def.invocations(L) - (t.from ? def.invocations(t.from) : 0);
    if (n > 0) choices.push({ id: 'inv', type: 'text', label: 'Eldritch Invocation', options: INVOCATIONS, count: n });
  }

  let spells = null;
  const cast = casting(t.name, sub);
  if (cast) {
    const maxLevel = maxSpellLevel(t.name, L, sub);
    const before = t.from ? (cast.cantrips ? cast.cantrips(t.from) : 0) : 0;
    const cantrips = (cast.cantrips ? Math.max(0, cast.cantrips(L) - before) : 0) + bonusCantrips;
    let leveled = cast.spellbook ? (t.from === 0 ? 6 : cast.spellbook) : Math.max(0, cast.prepared(L) - (t.from ? cast.prepared(t.from) : 0));
    if (!maxLevel) leveled = 0;
    spells = {
      // Bard 10, Magical Secrets : les listes du Cleric, du Druid et du Wizard s'ajoutent.
      cantrips, leveled, maxLevel, list: t.key === 'bard' && L >= 10 ? ['Bard', 'Cleric', 'Druid', 'Wizard'] : cast.list, ability: cast.ability, mode: cast.mode,
      label: cast.spellbook ? 'Sorts ajoutés au grimoire' : 'Nouveaux sorts',
      arcanum: def?.arcanum?.[L] || null,
      totalPrepared: cast.prepared(L), totalCantrips: cast.cantrips ? cast.cantrips(L) : 0,
    };
  }

  let multiclass = null;
  if (t.isNew && !firstClass) {
    const current = (doc.classes || []).filter(c => c.name).map(c => classDef(c.name)).filter(Boolean);
    const okNew = meetsPrereq(def, doc.abilities);
    const okOld = current.every(d => meetsPrereq(d, doc.abilities));
    multiclass = {
      profs: def.multiclassProfs, ok: okNew && okOld,
      text: [`${def.name} : ${prereqText(def)}`, ...current.map(d => `${d.name} : ${prereqText(d)}`)].join(' · '),
    };
  }

  return {
    target: t, level: L, total: totalLevel(doc) + 1, subclass: sub, subclassNeeded, subclasses: def?.subclasses || [],
    asi, epic, choices, spells, multiclass, hpAverage: t.hitDie / 2 + 1, features: featuresAt(t.name, sub, L),
  };
}

function cleanSpell(s, fallbackLevel) {
  if (!isPlainObject(s) || !str(s.name)) return null;
  const out = {
    name: str(s.name, 100), level: Math.max(0, Math.min(9, num(s.level, fallbackLevel))),
    school: str(s.school, 30), prepared: false, notes: str(s.notes, 300),
  };
  if (s.source) out.source = str(s.source, 20);
  if (s.always) out.always = true;
  if (s.ritual) out.ritual = true;
  if (s.concentration) out.concentration = true;
  for (const k of ['time', 'range']) if (s[k]) out[k] = str(s[k], 60);
  if (!s.source) out.custom = true;
  return out;
}

// Applique la montée de niveau sur un brouillon de fiche.
// ch : { classIndex | newClass, subclass, hpBase | hpGain, asi: { mode, a1, a2, feat, featAbility },
//        picks: { [id]: [valeurs] }, expertise: [compétences], spells: [sorts], addFeatures,
//        features: [{ name, kind }] (noms 5etools des capacités gagnées, facultatif) }
export function applyLevelUp(doc, ch = {}) {
  const opt = levelUpOptions(doc, ch);
  const t = opt.target;
  const oldCon = abilityMod(doc, 'con');
  const oldTotal = totalLevel(doc);
  const firstClass = !(doc.classes || []).some(c => c.name);
  const lines = [];

  // Classe
  let cls;
  if (t.isNew) {
    cls = { name: t.def.name, subclass: '', level: 1, hitDie: t.def.hitDie };
    doc.classes = firstClass ? [cls] : [...doc.classes, cls];
    if (firstClass) for (const ab of t.def.saves) doc.saves[ab] = true;
  } else {
    cls = doc.classes[t.index];
    cls.level = t.to;
  }
  if (opt.subclassNeeded && opt.subclass) cls.subclass = opt.subclass;
  const total = totalLevel(doc);

  // Caractéristiques
  const a = ch.asi || {};
  const raise = (ab, n, cap) => {
    if (!ABILITIES.includes(ab)) fail('Caractéristique invalide');
    const v = num(doc.abilities[ab], 10) + n;
    if (v > cap) fail(`${ABILITY_SHORT[ab]} ne peut pas dépasser ${cap}`);
    doc.abilities[ab] = v;
  };
  if (opt.asi && a.mode) {
    if (a.mode === 'asi2') { raise(a.a1, 2, 20); lines.push(`Ability Score Improvement : ${ABILITY_SHORT[a.a1]} +2`); }
    else if (a.mode === 'asi11') {
      if (a.a1 === a.a2) fail('Choisis deux caractéristiques différentes');
      raise(a.a1, 1, 20); raise(a.a2, 1, 20);
      lines.push(`Ability Score Improvement : ${ABILITY_SHORT[a.a1]} +1, ${ABILITY_SHORT[a.a2]} +1`);
    } else if (a.mode === 'feat') {
      if (!str(a.feat)) fail('Indique le nom du don');
      if (a.featAbility) raise(a.featAbility, 1, 20);
      lines.push(`Don : ${str(a.feat)}${a.featAbility ? ` (${ABILITY_SHORT[a.featAbility]} +1)` : ''}`);
    }
  }
  if (opt.epic && a.boon) {
    if (a.boonAbility) raise(a.boonAbility, 1, 30);
    lines.push(`Epic Boon : ${str(a.boon)}${a.boonAbility ? ` (${ABILITY_SHORT[a.boonAbility]} +1)` : ''}`);
  }

  // Magie
  const cast = casting(cls.name, cls.subclass);
  if (cast && (doc.spellcasting.mode === 'none' || firstClass)) {
    doc.spellcasting.ability = cast.ability;
    doc.spellcasting.mode = cast.mode;
  }

  // Points de vie, dont l'effet rétroactif d'un changement de CON
  const newCon = abilityMod(doc, 'con');
  let gain;
  if (ch.hpGain != null && ch.hpBase == null) gain = Math.max(1, num(ch.hpGain));
  else if (firstClass) gain = t.hitDie + newCon;
  else {
    if (ch.hpBase == null || ch.hpBase === '') fail('Choisis les points de vie');
    gain = Math.max(1, Math.min(t.hitDie, Math.max(1, num(ch.hpBase))) + newCon);
  }
  const retro = firstClass ? 0 : (newCon - oldCon) * oldTotal;
  if (firstClass) {
    // Premier niveau du personnage : dé de vie maximum + CON, à la place des PV par défaut.
    doc.hp.max = Math.max(1, gain);
    doc.hp.current = doc.hp.max;
  } else {
    doc.hp.max = Math.max(1, num(doc.hp.max) + gain + retro);
    doc.hp.current = Math.max(0, num(doc.hp.current) + gain + retro);
  }

  applyAutoSlots(doc);

  // Ressources de toutes les classes
  for (const c of doc.classes) {
    for (const def of defaultResources(c.name, c.subclass, c.level, doc)) {
      const ex = Object.values(doc.resources || {}).find(r => classKey(r.name) === classKey(def.name));
      if (ex) ex.max = def.max;
      else {
        const order = Object.values(doc.resources || {}).reduce((m, r) => Math.max(m, num(r.order)), -1) + 1;
        doc.resources[newId('r')] = { ...def, order };
      }
    }
  }

  // Choix de classe
  const picks = isPlainObject(ch.picks) ? ch.picks : {};
  const skillName = k => SKILLS.find(s => s.key === k)?.name || k;
  for (const c of opt.choices) {
    if (c.type === 'expertise') continue;
    const vals = [].concat(picks[c.id] || []).map(v => str(v)).filter(Boolean).slice(0, c.count);
    if (c.type === 'skill') {
      // Maîtrise de compétence : dans la liste permise, et une seule fois chacune.
      const keys = [...new Set(vals)].filter(k => SKILLS.some(s => s.key === k) && (!c.skills || c.skills.includes(k)));
      for (const k of keys) doc.skills[k] = Math.max(1, num(doc.skills[k]));
      if (keys.length) lines.push(`${c.label} : ${keys.map(skillName).join(', ')}`);
      continue;
    }
    if (vals.length) lines.push(`${c.label} : ${vals.join(', ')}`);
  }
  const exp = [].concat(ch.expertise || []).filter(k => SKILLS.some(s => s.key === k));
  const expChoices = opt.choices.filter(c => c.type === 'expertise');
  const expMax = expChoices.reduce((n, c) => n + c.count, 0);
  if (exp.length > expMax) fail(`Expertise : ${expMax} compétence${expMax > 1 ? 's' : ''} maximum`);
  // Scholar (Wizard) : l'expertise se limite à six compétences.
  const expAllowed = expChoices.every(c => c.skills) ? new Set(expChoices.flatMap(c => c.skills)) : null;
  if (expAllowed && exp.some(k => !expAllowed.has(k))) fail(`Expertise : ${[...expAllowed].map(skillName).join(', ')}`);
  for (const k of exp) doc.skills[k] = 2;
  if (exp.length) lines.push(`${expChoices.length === 1 && expChoices[0].label ? expChoices[0].label : 'Expertise'} : ${exp.map(skillName).join(', ')}`);

  // Choix tirés des données 5etools : infusions, invocations, manœuvres, dons de classe,
  // Weapon Mastery, terrain du Circle of the Land… Une ligne par choix dans Features & Traits.
  for (const l of [].concat(ch.extraLines || []).slice(0, 40)) {
    const t = str(l, 300);
    if (t) lines.push(t);
  }
  // Infusions apprises : elles rejoignent la page Infusions, pas encore actives.
  doc.infusions = doc.infusions || {};
  const swap = isPlainObject(ch.infusionSwap) ? ch.infusionSwap : null;
  if (swap?.from && swap?.to) {
    const old = Object.entries(doc.infusions).find(([, i]) => String(i.name).toLowerCase() === String(swap.from).toLowerCase());
    if (old) delete doc.infusions[old[0]];
  }
  for (const n of [...[].concat(ch.infusions || []), ...(swap?.to ? [swap.to] : [])].slice(0, 14)) {
    const name = str(n, 80);
    if (!name) continue;
    if (Object.values(doc.infusions).some(i => String(i.name).toLowerCase() === name.toLowerCase()) && !/^replicate magic item$/i.test(name)) continue;
    doc.infusions[newId('f')] = { name, active: false };
  }

  // Compétences gagnées en multiclasse.
  const skillProfs = [].concat(ch.skillProfs || []).filter(k => SKILLS.some(s => s.key === k)).slice(0, 4);
  for (const k of skillProfs) doc.skills[k] = Math.max(1, num(doc.skills[k]));
  if (skillProfs.length) lines.push(`Compétence : ${skillProfs.map(k => SKILLS.find(s => s.key === k).name).join(', ')}`);

  // Sorts
  const have = new Set(Object.values(doc.spells || {}).map(s => String(s.name).toLowerCase()));
  const added = [];
  for (const raw of [].concat(ch.spells || []).slice(0, 30)) {
    const s = cleanSpell(raw, 1);
    if (!s || have.has(s.name.toLowerCase())) continue;
    if (opt.spells && s.level > Math.max(opt.spells.maxLevel, opt.spells.arcanum || 0)) fail(`${s.name} : sort de niveau trop élevé`);
    have.add(s.name.toLowerCase());
    const order = Object.values(doc.spells || {}).reduce((m, x) => Math.max(m, num(x.order)), -1) + 1;
    doc.spells[newId('s')] = { ...s, order };
    added.push(s.name);
  }
  if (added.length) lines.push(`Sorts : ${added.join(', ')}`);
  // Sorts donnés par la classe ou la sous-classe : toujours préparés, hors limite.
  const granted = [], book = [];
  for (const raw of [].concat(ch.grantedSpells || []).slice(0, 20)) {
    // Un sort ajouté au grimoire (Savant du Wizard) n'est pas toujours préparé.
    const s = cleanSpell({ ...raw, always: raw?.always !== false }, 1);
    if (!s) continue;
    const list = s.always ? granted : book;
    const ex = Object.values(doc.spells || {}).find(x => String(x.name).toLowerCase() === s.name.toLowerCase());
    if (ex) { if (s.always) ex.always = true; if (s.notes && !ex.notes) ex.notes = s.notes; list.push(s.name); continue; }
    const order = Object.values(doc.spells || {}).reduce((m, x) => Math.max(m, num(x.order)), -1) + 1;
    doc.spells[newId('s')] = { ...s, order };
    list.push(s.name);
  }
  if (granted.length) lines.push(`Sorts toujours préparés : ${granted.join(', ')}`);
  if (book.length) lines.push(`Sorts ajoutés au grimoire : ${book.join(', ')}`);

  // Multiclasse : maîtrises gagnées
  if (opt.multiclass && opt.multiclass.profs && opt.multiclass.profs !== 'aucune') {
    doc.proficiencies = `${String(doc.proficiencies || '').trim()}\nMulticlasse ${t.def.name} : ${opt.multiclass.profs}.`.trim();
  }

  if (ch.addFeatures !== false) {
    const head = `NIVEAU ${total} · ${cls.name} ${cls.level}${cls.subclass ? `, ${cls.subclass}` : ''}`;
    // Noms des capacités : ceux de 5etools quand la fenêtre les a (« Iron Mind » plutôt que
    // « Gloom Stalker feature »), sinon la table de l'application.
    const given = [].concat(ch.features || []).filter(f => isPlainObject(f) && str(f.name)).slice(0, 20)
      .map(f => ({ name: str(f.name), kind: f.kind === 'subclass' ? 'subclass' : 'class' }));
    const subOwn = f => cls.subclass && (featuresAt(cls.name, cls.subclass, cls.level) || []).includes(f) && !(featuresAt(cls.name, '', cls.level) || []).includes(f);
    const feats = given.length ? given : opt.features.map(f => ({ name: f, kind: subOwn(f) ? 'subclass' : 'class' }));
    // « Divine Order : Protector » remplace la ligne « Divine Order » seule.
    const named = new Set(lines.map(l => l.split(' : ')[0]));
    const kindOf = n => feats.find(f => f.name === n)?.kind || 'class';
    const body = [...feats.filter(f => !named.has(f.name)).map(f => f.name), ...lines];
    if (body.length) addFeatures(doc, body.map(l => ({ name: l.split(' : ')[0], group: head, kind: kindOf(l.split(' : ')[0]), text: l })));
  }

  return {
    label: `Level up → ${total}`,
    toast: `${cls.name} ${cls.level} · ${gain + retro >= 0 ? '+' : ''}${gain + retro} PV max`,
    hpChange: gain + retro, lines,
  };
}

export { isAsiLevel };
