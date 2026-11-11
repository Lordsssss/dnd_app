// Fenêtre de montée de niveau : choix en menus déroulants, aperçu des changements, confirmation.
import { featuresText } from '/shared/features.js';
import { html, useEffect, useMemo, useState } from './html.js';
import { clone } from '/shared/patch.js';
import { ABILITIES, ABILITY_NAMES, ABILITY_SHORT, ORDINAL, SKILLS, abilityMod, num, profBonus, signed, totalLevel } from '/shared/rules.js';
import { CLASSES, casting, meetsPrereq, modernSubclass, prereqText, classDef } from '/shared/classes.js';
import { applyLevelUp, levelUpOptions } from '/shared/levelup.js';
import { act, charDoc, closeModal, toast, undo } from './store.js';
import { Modal } from './ui.js';
import { data5e, fold } from './data.js';
import { rollDie, showRoll } from './dice.js';
import { Icon } from './icons.js';
import { Peek, Rendered } from './compendium.js';
import { t as tr } from '/shared/i18n.js';

const EMPTY_ASI = { mode: '', a1: '', a2: '', feat: '', featAbility: '', boon: '', boonAbility: '' };

function useSpellIndex() {
  const [list, setList] = useState(null);
  useEffect(() => { data5e.spells().then(setList); }, []);
  return list;
}

function useFeats() {
  const [list, setList] = useState([]);
  useEffect(() => { data5e.feats().then(setList); }, []);
  return list;
}

// Données 5etools de la classe qui monte et de sa sous-classe (texte des capacités).
function useClassData(className, subclassName) {
  const [cls, setCls] = useState(null);
  const [sub, setSub] = useState(null);
  useEffect(() => {
    let alive = true;
    setCls(null);
    if (className) data5e.klass(className).then(c => alive && setCls(c));
    return () => { alive = false; };
  }, [className]);
  const match = cls && subclassName ? findSubclass(cls, subclassName) : null;
  useEffect(() => {
    let alive = true;
    setSub(null);
    if (cls && match) data5e.subclass(cls.name, match.classSource, match.shortName, match.source).then(s => alive && setSub(s));
    return () => { alive = false; };
  }, [cls?.name, match?.shortName, match?.source]);
  return { cls, sub };
}

function findSubclass(cls, name) {
  const n = fold(name);
  // Sur une classe 2024, « The Archfey » est l'Archfey Patron.
  const modern = cls.source === 'XPHB' && modernSubclass(name);
  return (modern && cls.subclasses.find(s => fold(s.name) === fold(modern)))
    || cls.subclasses.find(s => fold(s.name) === n)
    || cls.subclasses.find(s => n.includes(fold(s.shortName)) || fold(s.name).includes(n))
    || null;
}

// ---------------------------------------------------------------- Choix tirés de 5etools

const SKILL_KEYS = Object.fromEntries(SKILLS.map(s => [fold(s.name), s.key]));
const nameIn = (text, name) => new RegExp(`(^|[^\\w-])${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`, 'i').test(text);

function useLevelInfo(t, subclass) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    let alive = true;
    setInfo(null);
    if (t?.name) data5e.levelup(t.name, subclass || t.subclass || '', t.from, t.to).then(v => alive && setInfo(v));
    return () => { alive = false; };
  }, [t?.name, t?.from, t?.to, subclass]);
  return info;
}

// Une liste d'options (invocations, infusions…) : la version de l'édition de la classe d'abord.
function useOptionList(types, classSource) {
  const [list, setList] = useState(null);
  const key = types.join(',');
  useEffect(() => {
    let alive = true;
    data5e.options(key).then(all => {
      if (!alive) return;
      const best = new Map();
      const score = o => (o.source === classSource ? 0 : classSource === 'XPHB' ? 2 : o.source === 'XPHB' ? 3 : 1);
      for (const o of all) {
        const k = fold(o.name);
        if (!best.has(k) || score(o) < score(best.get(k))) best.set(k, o);
      }
      // L'édition de la classe d'abord ; les options d'autres livres ensuite, à valider avec le MJ.
      setList([...best.values()].sort((a, b) => (score(a) ? 1 : 0) - (score(b) ? 1 : 0) || a.name.localeCompare(b.name)));
    });
    return () => { alive = false; };
  }, [key, classSource]);
  return list;
}

function OptionDesc({ o }) {
  if (!o) return null;
  return html`<details class="peek"><summary>Description de ${o.name}${o.prereq ? html` <span class="muted small">· ${o.prereq}</span>` : null}</summary><${Rendered} entries=${o.entries} /></details>`;
}

// Une progression d'options : nouvelles à choisir, et une à remplacer si on veut.
function OptionProgression({ p, info, doc, level, picks, setPicks, repl, setRepl }) {
  const list = useOptionList(p.types, info.source);
  const text = `${featuresText(doc)}\n${Object.values(doc.infusions || {}).map(i => i.name).join('\n')}`;
  if (!list) return html`<div class="lv-row"><label>${p.name}</label><p class="muted small">Chargement…</p></div>`;
  const known = list.filter(o => nameIn(text, o.name));
  const vals = picks || [];
  const avail = list.filter(o => (o.minLevel || 0) <= level && !known.includes(o));
  const set = (i, v) => { const next = [...vals]; next[i] = v; setPicks(next); };
  const byName = n => list.find(o => o.name === n);
  return html`<div class="lv-row">
    <label>${p.name} <span class="muted">· ${p.count ? `${p.count} nouvelle${p.count > 1 ? 's' : ''}, ` : ''}${p.total} au total</span></label>
    <div class="lv-picks">
      ${Array.from({ length: p.count }, (_, i) => html`<div class="pick-col" key=${i}>
        <select class="sel" value=${vals[i] || ''} onChange=${e => set(i, e.target.value)}>
          <option value="">Choisir…</option>
          ${avail.filter(o => !vals.some((v, j) => j !== i && v === o.name)).map(o => html`<option value=${o.name}>${o.name}${o.prereq ? ` · ${o.prereq}` : ''} · ${o.source}</option>`)}
        </select>
        <${OptionDesc} o=${byName(vals[i])} />
      </div>`)}
      ${known.length ? html`<div class="pick-col">
        <span class="muted small">Déjà connues : ${known.map(o => o.name).join(', ')}</span>
        <div class="lv-picks">
          <select class="sel" value=${repl?.from || ''} onChange=${e => setRepl({ ...repl, from: e.target.value })}>
            <option value="">Remplacer une option (facultatif)…</option>
            ${known.map(o => html`<option value=${o.name}>${o.name}</option>`)}
          </select>
          ${repl?.from ? html`<select class="sel" value=${repl?.to || ''} onChange=${e => setRepl({ ...repl, to: e.target.value })}>
            <option value="">par…</option>
            ${avail.filter(o => !vals.includes(o.name)).map(o => html`<option value=${o.name}>${o.name} · ${o.source}</option>`)}
          </select>` : null}
        </div>
        <${OptionDesc} o=${byName(repl?.to)} />
      </div>` : null}
    </div>
  </div>`;
}

// Weapon Mastery : de nouvelles armes à maîtriser.
function MasteryPicks({ count, total, doc, values, onChange }) {
  const [weapons, setWeapons] = useState([]);
  useEffect(() => { data5e.mastery().then(setWeapons); }, []);
  const text = featuresText(doc);
  const known = weapons.filter(w => new RegExp(`Weapon Mastery[^\\n]*\\b${w.name}\\b`, 'i').test(text));
  const set = (i, v) => { const next = [...values]; next[i] = v; onChange(next); };
  return html`<div class="lv-row">
    <label>Weapon Mastery <span class="muted">· ${count} nouvelle${count > 1 ? 's' : ''}, ${total} au total</span></label>
    <div class="lv-picks">
      ${Array.from({ length: count }, (_, i) => html`<select class="sel" key=${i} value=${values[i] || ''} onChange=${e => set(i, e.target.value)}>
        <option value="">Choisir une arme…</option>
        ${weapons.filter(w => !known.includes(w) && !values.some((v, j) => j !== i && v === w.name)).map(w => html`<option value=${w.name}>${w.name} · ${w.mastery}</option>`)}
      </select>`)}
      ${known.length ? html`<span class="muted small">Déjà maîtrisées : ${known.map(w => w.name).join(', ')}</span>` : null}
    </div>
  </div>`;
}

// Tout ce que la classe demande de choisir à ce niveau d'après 5etools, et ce qu'elle donne d'office.
export function DataChoices({ info, doc, level, subclassName, feats, st, setSt, index }) {
  const upd = patch => setSt({ ...st, ...patch });
  const text = featuresText(doc);
  const chosenSet = info.sets.find(s => nameIn(text, s.set));
  const set = chosenSet || info.sets.find(s => s.set === st.set);
  const granted = [...info.additional, ...(set ? [set] : [])];
  const grantedSpells = uniqueSpells(granted.flatMap(g => g.spells));
  const exclude = new Set([...Object.values(doc.spells || {}).map(s => fold(s.name)), ...grantedSpells.map(s => fold(s.name))]);
  const pickList = granted.flatMap(g => g.picks || []);
  return html`
    ${info.optional.filter(p => p.count || p.total).map(p => html`<${OptionProgression} key=${p.name} p=${p} info=${info} doc=${doc} level=${level}
      picks=${st.opt[p.name]} setPicks=${v => upd({ opt: { ...st.opt, [p.name]: v } })}
      repl=${st.repl[p.name]} setRepl=${v => upd({ repl: { ...st.repl, [p.name]: v } })} />`)}
    ${info.feats.filter(f => f.categories[0] !== 'Epic Boon').map(f => html`<div class="lv-row" key=${f.name}>
      <label>${f.name} <span class="muted">· don</span></label>
      <div class="lv-picks">${Array.from({ length: f.count }, (_, i) => html`<${FeatPicker} key=${i} feats=${feats} categories=${f.categories}
        value=${(st.feat[f.name] || [])[i] || ''} placeholder=${`Choisir : ${f.name}`}
        onChange=${v => { const next = [...(st.feat[f.name] || [])]; next[i] = v; upd({ feat: { ...st.feat, [f.name]: next } }); }} />`)}</div>
    </div>`)}
    ${info.sets.length ? html`<div class="lv-row">
      <label>${subclassName || 'Sous-classe'} <span class="muted">· choix</span></label>
      <div class="lv-picks">${chosenSet ? html`<span>${chosenSet.set} <span class="muted small">(déjà choisi)</span></span>`
        : html`<select class="sel" value=${st.set || ''} onChange=${e => upd({ set: e.target.value })}>
          <option value="">Choisir…</option>${info.sets.map(s => html`<option value=${s.set}>${s.set}</option>`)}</select>`}</div>
    </div>` : null}
    ${info.mastery ? html`<${MasteryPicks} count=${info.mastery} total=${info.masteryTotal} doc=${doc} values=${st.mastery} onChange=${v => upd({ mastery: v })} />` : null}
    ${info.multiclassSkills ? html`<div class="lv-row">
      <label>Compétence de multiclasse <span class="muted">· ${info.multiclassSkills.count}</span></label>
      <div class="lv-picks">${Array.from({ length: info.multiclassSkills.count }, (_, i) => html`<select class="sel" key=${i} value=${st.skills[i] || ''}
        onChange=${e => { const next = [...st.skills]; next[i] = e.target.value; upd({ skills: next }); }}>
        <option value="">Choisir…</option>
        ${info.multiclassSkills.from.map(s => SKILL_KEYS[fold(s)]).filter(k => k && !num(doc.skills?.[k])).map(k => html`<option value=${k}>${SKILLS.find(s => s.key === k).name}</option>`)}
      </select>`)}</div>
    </div>` : null}
    ${grantedSpells.length || granted.some(g => g.info.length) ? html`<div class="lv-row">
      <label>Sorts donnés <span class="muted">· toujours préparés</span></label>
      <div class="pick-col">
        ${grantedSpells.map(s => html`<${Peek} key=${s.name} kind="spell" name=${s.name} source=${s.source} label=${`${s.name} · ${s.level ? tr('niveau {n}', { n: s.level }) : 'cantrip'}${s.note ? ` · ${tr(s.note)}` : ''}`} />`)}
        ${granted.flatMap(g => g.info).map(t => html`<p class="muted small">${t}</p>`)}
      </div>
    </div>` : null}
    ${pickList.map((p, k) => html`<${SpellPickers} key=${`pick${k}`} count=${p.count} label=${pickLabel(p)}
      options=${pickOptions(index, p, exclude)} values=${st.picks[k] || []} hasIndex=${!!index?.length}
      onChange=${v => upd({ picks: { ...st.picks, [k]: v } })} levelRange=${(p.levels || []).join(', ')} />`)}`;
}

// Un même sort donné deux fois par 5etools (préparé, et gratuit une fois par jour) : une ligne.
function uniqueSpells(list) {
  const out = [];
  for (const s of list) {
    const ex = out.find(x => fold(x.name) === fold(s.name));
    if (!ex) out.push({ ...s });
    else if (s.note && !ex.note) ex.note = s.note;
  }
  return out;
}

// Sort au choix donné par la classe : « Savant : sort d'Abjuration », « cantrip de Druid »…
function pickLabel(p) {
  if (p.from) return `${tr('Sort au choix')} · ${p.from.map(s => s.name).join(', ')}`;
  const lv = p.levels || [];
  const what = lv.length === 1 && lv[0] === 0 ? tr('Cantrip au choix') : tr('Sort au choix');
  return `${what}${p.schools ? ` · ${p.schools.join(', ')}` : ''}${p.classes ? ` · ${tr('liste {l}', { l: p.classes.join(', ') })}` : ''}`;
}

function pickOptions(index, p, exclude) {
  if (p.from) return p.from.filter(s => !exclude.has(fold(s.name)));
  const seen = new Set();
  return (index || []).filter(s => {
    if (p.levels && !p.levels.includes(s.level)) return false;
    if (p.classes && !(s.classes || []).some(c => p.classes.some(x => fold(x) === fold(c)))) return false;
    if (p.schools && !p.schools.some(x => fold(x) === fold(s.school))) return false;
    const k = fold(s.name);
    if (seen.has(k) || exclude.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Lignes, sorts et compétences à envoyer avec la montée de niveau.
function dataOutputs(info, doc, st, subclassName) {
  if (!info) return { extraLines: [], grantedSpells: [], skillProfs: [], infusions: [], infusionSwap: null };
  const lines = [];
  for (const p of info.optional) {
    const v = (st.opt[p.name] || []).filter(Boolean);
    if (v.length) lines.push(`${p.name} : ${v.join(', ')}`);
    const r = st.repl[p.name];
    if (r?.from && r?.to) lines.push(`${p.name} : ${r.from} remplacé par ${r.to}`);
  }
  for (const f of info.feats) {
    const v = (st.feat[f.name] || []).filter(Boolean);
    if (v.length) lines.push(`${f.name} : ${v.join(', ')}`);
  }
  const text = featuresText(doc);
  const chosenSet = info.sets.find(s => nameIn(text, s.set));
  const set = chosenSet || info.sets.find(s => s.set === st.set);
  if (set && !chosenSet) lines.push(`${subclassName || 'Sous-classe'} : ${set.set}`);
  const m = st.mastery.filter(Boolean);
  if (m.length) lines.push(`Weapon Mastery : ${m.join(', ')}`);
  const granted = [...info.additional, ...(set ? [set] : [])];
  for (const g of granted) for (const t of g.info) lines.push(t);
  const owner = g => (g.owner === 'subclass' ? subclassName : info.class);
  const origin = (g, note) => [`${owner(g) || ''}${g.set ? `, ${g.set}` : ''}`, note].filter(Boolean).join(' · ');
  const seen = new Set();
  const grantedSpells = [];
  for (const g of granted) {
    for (const s of uniqueSpells(g.spells)) {
      if (seen.has(fold(s.name))) continue;
      seen.add(fold(s.name));
      grantedSpells.push({ ...s, notes: origin(g, s.note) });
    }
  }
  // Sorts au choix : toujours préparés, sauf ceux qui rejoignent un grimoire (Savant du Wizard).
  const spellbook = !!casting(info.class, '')?.spellbook;
  let k = 0;
  for (const g of granted) {
    for (const p of g.picks || []) {
      for (const s of (st.picks[k++] || []).filter(Boolean)) {
        if (seen.has(fold(s.name))) continue;
        seen.add(fold(s.name));
        grantedSpells.push({ ...s, notes: origin(g, p.note), always: !(p.mode === 'known' && spellbook) });
      }
    }
  }
  // Les infusions choisies rejoignent aussi la page Infusions de la fiche.
  const ai = info.optional.find(p => p.types.includes('AI'));
  const aiSwap = ai ? st.repl[ai.name] : null;
  return {
    extraLines: lines, grantedSpells, skillProfs: st.skills.filter(Boolean),
    infusions: ai ? (st.opt[ai.name] || []).filter(Boolean) : [],
    infusionSwap: aiSwap?.from && aiSwap?.to ? aiSwap : null,
  };
}

const EMPTY_DATA = { opt: {}, repl: {}, feat: {}, set: '', mastery: [], skills: [], picks: {} };

// Le texte d'un choix de classe se trouve dans les dons (styles de combat 2024)
// ou dans les options de classe (métamagie, invocations, styles 2014).
const CHOICE_KIND = { 'Fighting Style': 'feat', Metamagic: 'opt', 'Eldritch Invocation': 'opt' };

// Capacités gagnées à ce niveau, avec leur texte complet quand 5etools est là.
// « Subclass Feature » n'est qu'un renvoi vers la sous-classe, dont les capacités suivent.
const ownFeatures = (cls, level) => (cls?.features || []).filter(f => f.level === level && !/^(Ability Score Improvement|Epic Boon|Subclass Feature)$/i.test(f.name));
const subFeatures = (sub, level) => (sub?.features || []).filter(f => f.level === level);

// Noms envoyés avec la montée de niveau ; la capacité qui ne fait que nommer la sous-classe est laissée.
function gainedNames(cls, sub, level) {
  if (!cls || !level) return undefined;
  // Sous-classe absente de 5etools (ou pas encore chargée) : la table de l'application.
  if (!sub && (cls.features || []).some(f => f.level === level && /^Subclass Feature$/i.test(f.name))) return undefined;
  const names = [
    ...ownFeatures(cls, level).map(f => ({ name: f.name, kind: 'class' })),
    ...subFeatures(sub, level).filter(f => fold(f.name) !== fold(sub.name) && fold(f.name) !== fold(sub.shortName || '')).map(f => ({ name: f.name, kind: 'subclass' })),
  ];
  return names.length ? names : undefined;
}

function GainedFeatures({ level, cls, sub, fallback }) {
  const own = ownFeatures(cls, level);
  const subs = subFeatures(sub, level);
  if (!cls) {
    return fallback.length ? html`<ul class="effects">${fallback.map(f => html`<li><b>${f}</b></li>`)}</ul>` : null;
  }
  const all = [...own, ...subs];
  if (!all.length) return html`<p class="muted small">Aucune nouvelle capacité à ce niveau.</p>`;
  return html`<div class="gained">${all.map(f => html`<details class="peek" key=${f.name + f.source}>
    <summary><b>${f.name}</b> <span class="muted small">${f.source}</span></summary>
    <${Rendered} entries=${f.entries} />
  </details>`)}</div>`;
}

function AbilitySelect({ value, onChange, doc, add, cap = 20, placeholder = 'Caractéristique…' }) {
  return html`<select class="sel" value=${value} onChange=${e => onChange(e.target.value)}>
    <option value="">${placeholder}</option>
    ${ABILITIES.map(a => {
      const cur = num(doc.abilities[a], 10);
      return html`<option value=${a} disabled=${cur + add > cap}>${ABILITY_NAMES[a]} ${cur} → ${Math.min(cap, cur + add)}</option>`;
    })}
  </select>`;
}

// Liste des sorts proposés : ceux de la classe, au bon niveau, pas déjà sur la fiche.
function spellOptions(index, list, minLevel, maxLevel, exclude) {
  const seen = new Set();
  return (index || []).filter(s => {
    if (s.level < minLevel || s.level > maxLevel) return false;
    const lists = [].concat(list || []);
    if (lists.length && s.classes?.length && !s.classes.some(c => lists.some(l => fold(c) === fold(l)))) return false;
    const k = fold(s.name);
    if (seen.has(k) || exclude.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function SpellPickers({ count, options, values, onChange, label, levelRange, hasIndex }) {
  if (!count) return null;
  const set = (i, v) => { const next = [...values]; next[i] = v; onChange(next); };
  return html`<div class="lv-row">
    <label>${label} <span class="muted">· ${count} au choix</span></label>
    <div class="lv-picks">
      ${Array.from({ length: count }, (_, i) => hasIndex
        ? html`<div class="pick-col"><select class="sel" value=${values[i] ? `${values[i].name}|${values[i].source}` : ''}
            onChange=${e => set(i, options.find(o => `${o.name}|${o.source}` === e.target.value) || null)}>
            <option value="">— choisir plus tard —</option>
            ${options.filter(o => !values.some((v, j) => j !== i && v && fold(v.name) === fold(o.name))).map(o =>
              html`<option value=${`${o.name}|${o.source}`}>${o.level ? `${o.level} · ` : ''}${o.name}${o.concentration ? ' (C)' : ''}${o.ritual ? ' (R)' : ''} · ${o.source}</option>`)}
          </select>
          ${values[i] ? html`<${Peek} kind="spell" name=${values[i].name} source=${values[i].source} label=${`Description de ${values[i].name}`} />` : null}</div>`
        : html`<input class="txt" placeholder=${`Nom du sort${levelRange ? `, niveau ${levelRange}` : ''}`} value=${values[i]?.name || ''}
            onInput=${e => set(i, e.target.value.trim() ? { name: e.target.value.trim(), level: values[i]?.level ?? 1 } : null)} />`)}
    </div>
  </div>`;
}

// Choix d'un don dans les données 5etools, avec son texte ; « Autre » pour écrire à la main.
// Sans catégorie : les dons d'un ASI, sans les Origin, les Epic Boon ni les styles réservés au Paladin et au Ranger.
const NOT_GENERAL = new Set(['Epic Boon', 'Origin', 'Fighting Style (Paladin)', 'Fighting Style (Ranger)']);
function FeatPicker({ feats, value, onChange, category, categories, placeholder }) {
  const cats = categories || (category ? [category] : null);
  const list = feats.filter(f => (cats ? cats.includes(f.category) : !NOT_GENERAL.has(f.category)));
  const seen = new Set();
  const opts = list.filter(f => { const k = fold(f.name); if (seen.has(k)) return false; seen.add(k); return true; });
  const known = opts.find(f => fold(f.name) === fold(value));
  const [other, setOther] = useState(!!value && !known);
  if (!opts.length || other) {
    return html`<div class="pick-col"><input class="txt" placeholder=${placeholder} value=${value} onInput=${e => onChange(e.target.value)} />
      ${opts.length ? html`<button type="button" class="btn tiny ghost" onClick=${() => { setOther(false); onChange(''); }}>Choisir dans la liste</button>` : null}</div>`;
  }
  return html`<div class="pick-col">
    <select class="sel" value=${known ? known.name : ''} onChange=${e => { if (e.target.value === '__other') { setOther(true); onChange(''); } else onChange(e.target.value); }}>
      <option value="">${placeholder}</option>
      ${opts.map(f => html`<option value=${f.name}>${f.name}${f.prereq ? ` · ${f.prereq}` : ''} · ${f.source}</option>`)}
      <option value="__other">Autre (écrire le nom)…</option>
    </select>
    ${known ? html`<${Peek} kind="feat" name=${known.name} source=${known.source} label=${`Description de ${known.name}`} open />` : null}
  </div>`;
}

export function LevelUp({ id }) {
  const doc = charDoc(id);
  const hasClass = (doc.classes || []).some(c => c.name);
  const [target, setTarget] = useState(hasClass ? '0' : 'new');
  const [newKey, setNewKey] = useState('');
  const [subclass, setSubclass] = useState('');
  const [subOther, setSubOther] = useState('');
  const [hpMode, setHpMode] = useState('avg');
  const [rolled, setRolled] = useState(null);
  const [manual, setManual] = useState('');
  const [asi, setAsi] = useState(EMPTY_ASI);
  const [picks, setPicks] = useState({});
  const [expertise, setExpertise] = useState([]);
  const [cantrips, setCantrips] = useState([]);
  const [spells, setSpells] = useState([]);
  const [arcanum, setArcanum] = useState([]);
  const [addFeatures, setAddFeatures] = useState(true);
  const [dst, setDst] = useState(EMPTY_DATA);
  const index = useSpellIndex();
  const feats = useFeats();

  // Changer de classe remet les choix à zéro.
  useEffect(() => {
    setSubclass(''); setSubOther(''); setRolled(null); setManual(''); setAsi(EMPTY_ASI);
    setPicks({}); setExpertise([]); setCantrips([]); setSpells([]); setArcanum([]); setDst(EMPTY_DATA);
  }, [target, newKey]);

  const sel = target === 'new' ? { newClass: newKey || null } : { classIndex: Number(target) };
  const sub = subclass === '__other' ? subOther.trim() : subclass;
  let opt = null, optError = null;
  if (target !== 'new' || newKey) {
    try { opt = levelUpOptions(doc, { ...sel, subclass: sub, picks }); } catch (e) { optError = e.message; }
  }

  const { cls: cls5e, sub: sub5e } = useClassData(opt?.target?.name, opt?.subclass);
  // Sous-classes proposées : celles de 5etools quand elles sont là (toutes les sources), sinon le PHB 2024.
  const subOptions = cls5e?.subclasses?.length
    ? cls5e.subclasses.map(s => ({ value: s.name, label: `${s.name} · ${s.source}` }))
    : (opt?.subclasses || []).map(s => ({ value: s, label: s }));

  // Choix et dons que 5etools décrit pour ce niveau (infusions, invocations, manœuvres…).
  const info = useLevelInfo(opt?.target, opt?.subclass);
  const covered = new Set();
  if (info?.optional.some(p => p.types.includes('EI'))) covered.add('Eldritch Invocation');
  if (info?.optional.some(p => p.types.includes('MM'))) covered.add('Metamagic');
  if (info?.feats.some(f => f.categories.includes('Fighting Style')) || info?.optional.some(p => p.types.some(x => x.startsWith('FS')))) covered.add('Fighting Style');
  const choices = (opt?.choices || []).filter(c => !covered.has(c.label));
  const hasData = !!info && (info.optional.some(p => p.count || p.total) || info.feats.some(f => f.categories[0] !== 'Epic Boon')
    || info.sets.length || info.mastery || info.multiclassSkills || info.additional.length);

  const hpBase = !opt ? null : hpMode === 'avg' ? opt.hpAverage : hpMode === 'roll' ? rolled : manual === '' ? null : Number(manual);
  const firstClass = !hasClass;
  const keptPicks = Object.fromEntries(Object.entries(picks).filter(([k]) => choices.some(c => c.id === k)));
  const ch = {
    ...sel, subclass: sub, hpBase: firstClass ? undefined : hpBase, asi, picks: keptPicks, expertise: expertise.filter(Boolean), addFeatures,
    features: gainedNames(cls5e, sub5e, opt?.target?.to),
    spells: [...cantrips, ...spells, ...arcanum].filter(Boolean).map(s => ({ ...s, notes: arcanum.includes(s) ? 'Mystic Arcanum : 1 fois par repos long, sans emplacement.' : s.notes })),
    ...dataOutputs(info, doc, dst, opt?.subclass),
  };

  const preview = useMemo(() => {
    if (!opt) return null;
    try {
      const d = clone(doc);
      const r = applyLevelUp(d, ch);
      return { d, r };
    } catch (e) { return { error: e.message }; }
  }, [JSON.stringify(ch), doc]);

  const exclude = new Set(Object.values(doc.spells || {}).map(s => fold(s.name)));
  const hasIndex = !!index?.length;
  const sp = opt?.spells;
  const cantripOpts = sp ? spellOptions(index, sp.list, 0, 0, exclude) : [];
  const spellOpts = sp ? spellOptions(index, sp.list, 1, sp.maxLevel, exclude) : [];
  const arcanumOpts = sp?.arcanum ? spellOptions(index, sp.list, sp.arcanum, sp.arcanum, exclude) : [];
  const expChoices = opt?.choices.filter(c => c.type === 'expertise') || [];
  const expCount = expChoices.reduce((n, c) => n + c.count, 0);
  // Scholar (Wizard) : six compétences seulement.
  const expSkills = expChoices.length && expChoices.every(c => c.skills) ? new Set(expChoices.flatMap(c => c.skills)) : null;
  const expLabel = expChoices.length === 1 && expChoices[0].label ? expChoices[0].label : 'Expertise';

  const confirm = () => act('levelUp', ch).then(r => {
    if (!r.ok) return;
    closeModal();
    const undoId = r.result?.undoId;
    toast(r.result?.toast || 'Niveau gagné', undoId ? { action: { label: 'Annuler', run: () => undo({ entryId: undoId }) } } : {});
  });

  const t = opt?.target;
  const summary = preview?.d ? changesList(doc, preview.d, preview.r, opt) : [];
  const title = t ? `Level up · ${t.name} ${t.to}` : 'Level up';

  return html`<${Modal} title=${title} wide cls="levelup" footer=${html`
      <button type="button" class="btn" onClick=${closeModal}>Annuler</button>
      <span class="grow"></span>
      ${preview?.error ? html`<span class="lv-err">${preview.error}</span>` : null}
      <button type="button" class="btn primary big" disabled=${!preview?.d} onClick=${confirm}>
        ${opt ? tr('Confirmer le niveau {n}', { n: opt.total }) : tr('Confirmer')}
      </button>`}>

    <section class="lv-sec">
      <h4>Classe</h4>
      <div class="lv-row">
        <label>Classe qui monte</label>
        <select class="sel" value=${target} onChange=${e => setTarget(e.target.value)}>
          ${(doc.classes || []).map((c, i) => c.name ? html`<option value=${String(i)}>${c.name}${c.subclass ? ` (${c.subclass})` : ''} ${c.level} → ${num(c.level) + 1}</option>` : null)}
          <option value="new">${hasClass ? 'Nouvelle classe (multiclasse)…' : 'Choisir la classe de départ…'}</option>
        </select>
      </div>
      ${target === 'new' ? html`<div class="lv-row">
        <label>Nouvelle classe</label>
        <select class="sel" value=${newKey} onChange=${e => setNewKey(e.target.value)}>
          <option value="">Choisir…</option>
          ${Object.entries(CLASSES).filter(([k]) => !(doc.classes || []).some(c => fold(c.name) === k)).map(([k, d]) => {
            const ok = !hasClass || meetsPrereq(d, doc.abilities);
            return html`<option value=${k}>${d.name} · d${d.hitDie}${hasClass ? ` · ${prereqText(d)} ${ok ? '✓' : '✗'}` : ''}</option>`;
          })}
        </select>
      </div>` : null}
      ${optError ? html`<p class="alert warn">${optError}</p>` : null}
      ${opt?.multiclass ? html`<p class=${`alert ${opt.multiclass.ok ? '' : 'warn'}`}>${Icon.info()}
        <span>Prérequis du multiclassage : ${opt.multiclass.text}.${opt.multiclass.ok ? '' : ' Non rempli : à valider avec le MJ.'}
        Maîtrises gagnées : ${opt.multiclass.profs}.</span></p>` : null}
      ${opt?.subclassNeeded ? html`<div class="lv-row">
        <label>Sous-classe <span class="muted">· niveau ${opt.level}</span></label>
        <div class="lv-picks">
          <select class="sel" value=${subclass} onChange=${e => setSubclass(e.target.value)}>
            <option value="">Choisir plus tard</option>
            ${subOptions.map(s => html`<option value=${s.value}>${s.label}</option>`)}
            <option value="__other">Autre…</option>
          </select>
          ${subclass === '__other' ? html`<input class="txt" placeholder="Nom de la sous-classe" value=${subOther} onInput=${e => setSubOther(e.target.value)} />` : null}
        </div>
      </div>
      ${sub5e?.features?.[0] ? html`<details class="peek" open>
        <summary>${sub5e.name} <span class="muted small">${sub5e.source}</span></summary>
        <${Rendered} entries=${sub5e.features[0].entries} />
      </details>` : null}` : null}
    </section>

    ${opt && !firstClass ? html`<section class="lv-sec">
      <h4>Points de vie <span class="muted">· d${t.hitDie} + CON ${signed(abilityMod(preview?.d || doc, 'con'))}</span></h4>
      <div class="lv-row">
        <label>Méthode</label>
        <div class="lv-picks">
          <select class="sel" value=${hpMode} onChange=${e => setHpMode(e.target.value)}>
            <option value="avg">Moyenne : ${opt.hpAverage}</option>
            <option value="roll">Lancer le d${t.hitDie}</option>
            <option value="manual">Valeur choisie à la table</option>
          </select>
          ${hpMode === 'roll' ? html`<button type="button" class="btn" onClick=${() => { const v = rollDie(t.hitDie); setRolled(v); showRoll({ label: `Level up d${t.hitDie}`, total: v, detail: `d${t.hitDie} (${v})` }); }}>
            ${Icon.d20()} ${rolled != null ? `Résultat : ${rolled}` : 'Lancer'}</button>` : null}
          ${hpMode === 'manual' ? html`<input class="num" inputMode="numeric" placeholder=${`1 à ${t.hitDie}`} value=${manual} onInput=${e => setManual(e.target.value.replace(/\D/g, ''))} />` : null}
        </div>
      </div>
    </section>` : null}

    ${opt?.asi || opt?.epic ? html`<section class="lv-sec">
      <h4>${opt.epic && !opt.asi ? 'Epic Boon' : 'Ability Score Improvement ou don'}</h4>
      ${opt.asi ? html`<div class="lv-row">
        <label>Choix</label>
        <div class="lv-picks">
          <select class="sel" value=${asi.mode} onChange=${e => setAsi({ ...EMPTY_ASI, mode: e.target.value })}>
            <option value="">Choisir plus tard</option>
            <option value="asi2">+2 à une caractéristique</option>
            <option value="asi11">+1 à deux caractéristiques</option>
            <option value="feat">Un don</option>
          </select>
          ${asi.mode === 'asi2' ? html`<${AbilitySelect} doc=${doc} add=${2} value=${asi.a1} onChange=${v => setAsi({ ...asi, a1: v })} />` : null}
          ${asi.mode === 'asi11' ? html`
            <${AbilitySelect} doc=${doc} add=${1} value=${asi.a1} onChange=${v => setAsi({ ...asi, a1: v })} />
            <${AbilitySelect} doc=${doc} add=${1} value=${asi.a2} onChange=${v => setAsi({ ...asi, a2: v })} />` : null}
          ${asi.mode === 'feat' ? html`
            <${FeatPicker} feats=${feats} value=${asi.feat} placeholder="Choisir un don (Alert, War Caster…)" onChange=${v => setAsi({ ...asi, feat: v })} />
            <${AbilitySelect} doc=${doc} add=${1} value=${asi.featAbility} placeholder="+1 donné par le don (facultatif)" onChange=${v => setAsi({ ...asi, featAbility: v })} />` : null}
        </div>
      </div>` : null}
      ${opt.epic ? html`<div class="lv-row">
        <label>Epic Boon</label>
        <div class="lv-picks">
          <${FeatPicker} feats=${feats} category="Epic Boon" value=${asi.boon} placeholder="Boon of Combat Prowess, Boon of Fate…" onChange=${v => setAsi({ ...asi, boon: v })} />
          <${AbilitySelect} doc=${doc} add=${1} cap=${30} value=${asi.boonAbility} placeholder="+1 (max 30)" onChange=${v => setAsi({ ...asi, boonAbility: v })} />
        </div>
      </div>` : null}
    </section>` : null}

    ${opt && (choices.length || expCount || hasData) ? html`<section class="lv-sec">
      <h4>Choix de classe${info ? html` <span class="muted">· d'après ${info.class} ${info.source}</span>` : null}</h4>
      ${info ? html`<${DataChoices} info=${info} doc=${doc} level=${t.to} subclassName=${opt.subclass} feats=${feats} st=${dst} setSt=${setDst} index=${index} />` : null}
      ${choices.filter(c => c.type !== 'expertise').map(c => html`<div class="lv-row" key=${c.id}>
        <label>${c.label}${c.count > 1 ? html` <span class="muted">· ${c.count}</span>` : null}</label>
        <div class="lv-picks">
          ${Array.from({ length: c.count }, (_, i) => {
            const vals = picks[c.id] || [];
            const set = v => { const next = [...vals]; next[i] = v; setPicks({ ...picks, [c.id]: next }); };
            const peek = CHOICE_KIND[c.label] && vals[i] ? html`<${Peek} kind=${CHOICE_KIND[c.label]} name=${vals[i]} label=${`Description de ${vals[i]}`} />` : null;
            if (c.type === 'skill') {
              // Maîtrise de compétence : celles de la liste que la fiche n'a pas encore.
              return html`<select class="sel" value=${vals[i] || ''} onChange=${e => set(e.target.value)}>
                <option value="">Choisir une compétence…</option>
                ${SKILLS.filter(sk => (!c.skills || c.skills.includes(sk.key)) && !num(doc.skills?.[sk.key]) && !vals.some((v, j) => j !== i && v === sk.key))
                  .map(sk => html`<option value=${sk.key}>${sk.name}</option>`)}
              </select>`;
            }
            return c.type === 'select'
              ? html`<div class="pick-col"><select class="sel" value=${vals[i] || ''} onChange=${e => set(e.target.value)}>
                  <option value="">Choisir…</option>
                  ${c.options.filter(o => !vals.some((v, j) => j !== i && v === o)).map(o => html`<option value=${o}>${o}</option>`)}
                </select>${peek}</div>`
              : html`<div class="pick-col"><input class="txt" list=${`dl-${c.id}`} placeholder=${c.hint || 'Choisir ou écrire…'} value=${vals[i] || ''} onInput=${e => set(e.target.value)} />${peek}</div>`;
          })}
          ${c.type === 'text' && c.options ? html`<datalist id=${`dl-${c.id}`}>${c.options.map(o => html`<option value=${o} />`)}</datalist>` : null}
        </div>
      </div>`)}
      ${expCount ? html`<div class="lv-row">
        <label>${expLabel} <span class="muted">· ${expCount}</span></label>
        <div class="lv-picks">
          ${Array.from({ length: expCount }, (_, i) => html`<select class="sel" value=${expertise[i] || ''}
            onChange=${e => { const next = [...expertise]; next[i] = e.target.value; setExpertise(next); }}>
            <option value="">Choisir…</option>
            ${SKILLS.filter(s => num(doc.skills?.[s.key]) < 2 && (!expSkills || expSkills.has(s.key)) && !expertise.some((v, j) => j !== i && v === s.key))
              .sort((a, b) => num(doc.skills?.[b.key]) - num(doc.skills?.[a.key]))
              .map(s => html`<option value=${s.key}>${s.name}${num(doc.skills?.[s.key]) ? '' : ' (pas maîtrisée)'}</option>`)}
          </select>`)}
        </div>
      </div>` : null}
    </section>` : null}

    ${sp && (sp.cantrips || sp.leveled || sp.arcanum) ? html`<section class="lv-sec">
      <h4>Sorts <span class="muted">· liste ${[].concat(sp.list).join(', ')}, jusqu'au niveau ${sp.maxLevel}</span></h4>
      ${!hasIndex ? html`<p class="muted small">Pas de données 5etools : écris les noms à la main, ou laisse vide et ajoute-les plus tard depuis la page Sorts.</p>` : null}
      <${SpellPickers} count=${sp.cantrips} label="Cantrips" options=${cantripOpts} values=${cantrips} onChange=${setCantrips} hasIndex=${hasIndex} levelRange="0" />
      <${SpellPickers} count=${sp.leveled} label=${sp.label} options=${spellOpts} values=${spells} onChange=${setSpells} hasIndex=${hasIndex} levelRange=${`1 à ${sp.maxLevel}`} />
      ${sp.arcanum ? html`<${SpellPickers} count=${1} label=${`Mystic Arcanum, niveau ${sp.arcanum}`} options=${arcanumOpts} values=${arcanum} onChange=${setArcanum} hasIndex=${hasIndex} levelRange=${String(sp.arcanum)} />` : null}
    </section>` : null}

    ${opt ? html`<section class="lv-sec">
      <h4>Capacités gagnées <span class="muted">· ${t.name} ${t.to}${opt.subclass ? `, ${opt.subclass}` : ''}${cls5e ? ` · texte ${cls5e.source}` : ''}</span></h4>
      <${GainedFeatures} level=${t.to} cls=${cls5e} sub=${sub5e} fallback=${opt.features} />
    </section>` : null}

    ${opt ? html`<section class="lv-sec lv-summary">
      <h4>Ce qui change</h4>
      ${preview?.error ? html`<p class="alert warn">${preview.error}</p>` : html`<ul class="effects">${summary.map(l => html`<li>${l}</li>`)}</ul>`}
      <label class="check"><input type="checkbox" checked=${addFeatures} onChange=${e => setAddFeatures(e.target.checked)} /> Ajouter les capacités et les choix dans Features & Traits</label>
      <p class="muted small">Le texte complet de chaque capacité est dans « Capacités gagnées », tiré des données 5etools du portable. Tout s'annule avec ↶ après confirmation.</p>
    </section>` : null}
  <//>`;
}

function changesList(before, after, r, opt) {
  const out = [];
  const lvA = totalLevel(before), lvB = totalLevel(after);
  const t = opt.target;
  out.push(html`Niveau <b>${hasName(before) ? lvA : 0} → ${lvB}</b> · ${t.name} ${t.from} → ${t.to}${after.classes[t.index]?.subclass ? `, ${after.classes[t.index].subclass}` : ''}`);
  if (num(before.hp.max) !== num(after.hp.max)) out.push(html`HP max <b>${num(before.hp.max)} → ${num(after.hp.max)}</b>`);
  if (profBonus(before) !== profBonus(after)) out.push(html`Proficiency Bonus <b>${signed(profBonus(before))} → ${signed(profBonus(after))}</b>`);
  for (const a of ABILITIES) {
    if (num(before.abilities[a]) !== num(after.abilities[a])) out.push(html`${ABILITY_NAMES[a]} <b>${before.abilities[a]} → ${after.abilities[a]}</b>`);
  }
  const slots = [];
  for (let l = 1; l <= 9; l++) {
    const x = num(before.spellcasting.slots[l]?.max), y = num(after.spellcasting.slots[l]?.max);
    if (x !== y) slots.push(`${ORDINAL[l]} ${x} → ${y}`);
  }
  if (slots.length) out.push(html`Emplacements de sorts : <b>${slots.join(', ')}</b>`);
  const pa = before.spellcasting.pact || {}, pb = after.spellcasting.pact || {};
  if (num(pa.max) !== num(pb.max) || num(pa.level) !== num(pb.level)) out.push(html`Pact Magic <b>${num(pa.max)} × niv. ${num(pa.level)} → ${num(pb.max)} × niv. ${num(pb.level)}</b>`);
  if (opt.spells) out.push(html`PHB 2024 pour ${t.name} ${t.to} : ${opt.spells.totalCantrips ? `${opt.spells.totalCantrips} cantrips, ` : ''}${opt.spells.totalPrepared} sorts préparés ou connus`);
  const res = r => Object.fromEntries(Object.values(r.resources || {}).map(x => [fold(x.name), x]));
  const rb = res(before), ra = res(after);
  for (const [k, x] of Object.entries(ra)) {
    if (!rb[k]) out.push(html`Nouvelle ressource : <b>${x.name}</b> · ${x.max}`);
    else if (num(rb[k].max) !== num(x.max)) out.push(html`${x.name} <b>${num(rb[k].max)} → ${x.max}</b>`);
  }
  const def = classDef(t.name);
  if (def?.info) {
    const ib = t.from ? def.info(t.from) : {}, ia = def.info(t.to);
    for (const [k, v] of Object.entries(ia)) if (ib[k] !== v) out.push(html`${k} <b>${ib[k] ? `${ib[k]} → ` : ''}${v}</b>`);
  }
  const named = new Set(r.lines.map(l => l.split(' : ')[0]));
  for (const f of opt.features.filter(f => !named.has(f))) out.push(html`<b>${f}</b>`);
  for (const l of r.lines) out.push(l);
  return out;
}

function hasName(doc) {
  return (doc.classes || []).some(c => c.name);
}
