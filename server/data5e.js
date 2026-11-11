// Chargement des données JSON de 5etools (dossier .dnd-sheet/5etools/, copie de data/).
// Tout est chargé au démarrage, sauf le texte des livres et aventures, lu à la demande.
// `npm run 5etools` met le dossier à jour (voir fetch5e.js).
import fs from 'node:fs';
import path from 'node:path';
import { SCHOOLS } from '../shared/rules.js';
import { modernSubclass } from '../shared/classes.js';
import { readDownloadInfo } from './fetch5e.js';

// Fichiers d'outillage du site 5etools : rien à afficher pour une table.
const SKIP_FILE = /^(foundry-|makebrew|makecards|converter|renderdemo|changelog|encounterbuilder|msbcr|monsterfeatures|names|life|loot|homecrafts|fluff-homecrafts|encounters|gendata-maps|gendata-nav|gendata-subclass|gendata-tag|bookref-)/;
const LAZY_DIRS = new Set(['adventure', 'book']);

// Catégories génériques : clé du JSON → identifiant de type dans l'application.
const GENERIC = {
  monster: 'monster', feat: 'feat', optionalfeature: 'opt', background: 'background', condition: 'condition',
  disease: 'disease', status: 'status', action: 'action', variantrule: 'variantrule', language: 'language',
  sense: 'sense', skill: 'skill', deity: 'deity', reward: 'reward', trap: 'trap', hazard: 'hazard', object: 'object',
  vehicle: 'vehicle', psionic: 'psionic', cult: 'cult', boon: 'boon', table: 'table', deck: 'deck', recipe: 'recipe',
  facility: 'facility', charoption: 'charoption', itemMastery: 'itemMastery', legendaryGroup: 'legendaryGroup',
  tableGroup: 'table',
};

export const KINDS = {
  spell: 'Sort', item: 'Objet', monster: 'Créature', feat: 'Don', opt: 'Option de classe', race: 'Espèce',
  background: 'Historique', class: 'Classe', subclass: 'Sous-classe', classFeature: 'Capacité de classe',
  subclassFeature: 'Capacité de sous-classe', condition: 'Condition', disease: 'Maladie', status: 'État',
  action: 'Action', variantrule: 'Règle', language: 'Langue', sense: 'Sens', skill: 'Compétence', deity: 'Divinité',
  reward: 'Récompense', trap: 'Piège', hazard: 'Danger', object: 'Objet de décor', vehicle: 'Véhicule',
  psionic: 'Psionique', cult: 'Culte', boon: 'Faveur', table: 'Table', deck: 'Jeu de cartes', recipe: 'Recette',
  facility: 'Bastion', charoption: 'Option de création', itemMastery: 'Weapon Mastery', legendaryGroup: 'Antre',
  book: 'Livre', adventure: 'Aventure', bookSection: 'Section de livre',
};

// Types d'options de classe (optionalfeatures.json).
export const OPT_TYPES = {
  EI: 'Eldritch Invocation', MM: 'Metamagic', 'FS:F': 'Fighting Style', 'FS:P': 'Fighting Style',
  'FS:R': 'Fighting Style', 'FS:B': 'Fighting Style', AI: 'Artificer Infusion', AS: 'Arcane Shot',
  ED: 'Elemental Discipline', PB: 'Pact Boon', RN: 'Rune', 'MV:B': 'Maneuver', 'MV:C2-UA': 'Maneuver',
};

// Les styles de combat réservés au Paladin et au Ranger (Blessed Warrior, Druidic Warrior) gardent
// leur propre catégorie : un Fighter ne les voit pas.
const FEAT_CATEGORIES = {
  O: 'Origin', G: 'General', FS: 'Fighting Style', 'FS:P': 'Fighting Style (Paladin)', 'FS:R': 'Fighting Style (Ranger)',
  EB: 'Epic Boon', D: 'Dragonmark',
};
const ABIL = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' };
const SIZES = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan', V: 'Varies' };

function walk(dir, out = [], depth = 0) {
  if (depth > 4) return out;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!LAZY_DIRS.has(e.name) && !['img', 'homebrew'].includes(e.name)) walk(p, out, depth + 1); }
    else if (e.name.endsWith('.json') && !e.name.startsWith('_')) out.push(p);
  }
  return out;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

const low = s => String(s ?? '').toLowerCase();
const key = (name, source) => `${low(name)}|${low(source)}`;
const fold = s => low(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

// Identifiants de capacités de classe, tels qu'écrits dans les fichiers de classe.
function cfKey(name, className, classSource, level, source) {
  const cs = classSource || 'PHB';
  return [name, className, cs, level, source || cs].map(low).join('|');
}
function sfKey(name, className, classSource, shortName, subSource, level, source) {
  const cs = classSource || 'PHB', ss = subSource || 'PHB';
  return [name, className, cs, shortName, ss, level, source || ss].map(low).join('|');
}
function cfKeyFromUid(uid) {
  const [name, className, classSource, level, source] = String(uid).split('|');
  return cfKey(name, className, classSource, level, source);
}
function sfKeyFromUid(uid) {
  const [name, className, classSource, shortName, subSource, level, source] = String(uid).split('|');
  return sfKey(name, className, classSource, shortName, subSource, level, source);
}

// ------------------------------------------------------------ _copy / _mod
// Les variantes 5etools reprennent une autre entrée et la modifient. On couvre les
// opérations courantes ; ce qui reste exotique garde le texte de l'original.
function replaceTxt(v, re, withStr) {
  if (typeof v === 'string') return v.replace(re, withStr);
  if (Array.isArray(v)) return v.map(x => replaceTxt(x, re, withStr));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replaceTxt(x, re, withStr)]));
  return v;
}
function applyMod(obj, mods) {
  const out = { ...obj };
  for (const [prop, list] of Object.entries(mods || {})) {
    for (const m of [].concat(list)) {
      if (!m || typeof m !== 'object') continue;
      if (m.mode === 'replaceTxt') {
        let re;
        try { re = new RegExp(m.replace, m.flags || 'g'); } catch { continue; }
        const props = prop === '*' ? (m.props || ['entries', 'trait', 'action', 'bonus', 'reaction', 'legendary']) : [prop];
        for (const p of props) if (out[p] != null) out[p] = replaceTxt(out[p], re, m.with ?? '');
        continue;
      }
      if (prop === '*' || prop === '_') continue;
      const arr = Array.isArray(out[prop]) ? [...out[prop]] : [];
      const items = [].concat(m.items ?? []);
      const nameOf = x => (typeof x === 'string' ? x : x?.name);
      switch (m.mode) {
        case 'appendArr': out[prop] = [...arr, ...items]; break;
        case 'prependArr': out[prop] = [...items, ...arr]; break;
        case 'insertArr': arr.splice(m.index ?? arr.length, 0, ...items); out[prop] = arr; break;
        case 'removeArr': {
          const names = [].concat(m.names ?? m.items ?? []).map(nameOf);
          out[prop] = arr.filter(x => !names.includes(nameOf(x)));
          break;
        }
        case 'replaceArr': {
          const target = typeof m.replace === 'string' ? m.replace : m.replace?.index;
          const i = typeof target === 'number' ? target : arr.findIndex(x => nameOf(x) === target);
          if (i >= 0) { arr.splice(i, 1, ...items); out[prop] = arr; }
          break;
        }
        case 'replaceOrAppendArr': {
          const i = arr.findIndex(x => nameOf(x) === m.replace);
          if (i >= 0) arr.splice(i, 1, ...items); else arr.push(...items);
          out[prop] = arr;
          break;
        }
        case 'appendIfNotExistsArr': for (const it of items) if (!arr.some(x => nameOf(x) === nameOf(it))) arr.push(it); out[prop] = arr; break;
        default: break;
      }
    }
  }
  return out;
}

// ------------------------------------------------------------ Textes courts

function timeText(time) {
  if (!Array.isArray(time)) return '';
  return time.map(t => {
    const unit = { action: 'action', bonus: 'bonus action', reaction: 'reaction', minute: 'minute', hour: 'hour', round: 'round' }[t.unit] || t.unit;
    const n = t.number ?? 1;
    return `${n} ${unit}${n > 1 && !['action', 'bonus action', 'reaction'].includes(unit) ? 's' : ''}${t.condition ? `, ${t.condition}` : ''}`;
  }).join(' or ');
}

function rangeText(r) {
  if (!r) return '';
  if (r.type === 'special') return 'Special';
  const d = r.distance || {};
  if (r.type === 'point') {
    if (d.type === 'self') return 'Self';
    if (d.type === 'touch') return 'Touch';
    if (d.type === 'sight') return 'Sight';
    if (d.type === 'unlimited') return 'Unlimited';
    if (d.type === 'plane') return 'Unlimited on the same plane';
    return `${d.amount} ${d.type === 'feet' ? 'ft' : d.type === 'miles' ? (d.amount === 1 ? 'mile' : 'miles') : d.type}`;
  }
  const shape = { line: 'line', cone: 'cone', cube: 'cube', sphere: 'sphere', radius: 'radius', hemisphere: 'hemisphere', cylinder: 'cylinder', emanation: 'emanation' }[r.type] || r.type;
  return `Self (${d.amount ?? ''}-${d.type === 'feet' ? 'ft' : d.type} ${shape})`;
}

function componentsText(c) {
  if (!c) return '';
  const parts = [];
  if (c.v) parts.push('V');
  if (c.s) parts.push('S');
  if (c.m) parts.push(`M (${typeof c.m === 'string' ? c.m : c.m.text || ''})`);
  if (c.r) parts.push('R');
  return parts.join(', ');
}

function durationText(dur) {
  if (!Array.isArray(dur)) return '';
  return dur.map(d => {
    if (d.type === 'instant') return 'Instantaneous';
    if (d.type === 'permanent') return d.ends ? `Until ${d.ends.map(e => ({ dispel: 'dispelled', trigger: 'triggered' }[e] || e)).join(' or ')}` : 'Permanent';
    if (d.type === 'special') return 'Special';
    if (d.type === 'timed') {
      const a = d.duration?.amount ?? 1, u = d.duration?.type || '';
      const t = `${a} ${u}${a > 1 ? 's' : ''}`;
      return d.concentration ? `Concentration, up to ${t}` : t;
    }
    return d.type;
  }).join(' or ');
}

// Prérequis d'un don ou d'une option, en texte court.
function prereqText(prereq) {
  if (!Array.isArray(prereq) || !prereq.length) return '';
  return prereq.map(p => {
    const parts = [];
    if (p.level) parts.push(typeof p.level === 'object' ? `${p.level.class?.name || ''} niveau ${p.level.level}`.trim() : `niveau ${p.level}`);
    for (const a of p.ability || []) parts.push(Object.entries(a).map(([k, v]) => `${ABIL[k] || k} ${v}`).join(' ou '));
    if (p.race) parts.push(p.race.map(r => r.name + (r.subrace ? ` (${r.subrace})` : '')).join(' ou '));
    if (p.spellcasting || p.spellcasting2020 || p.spellcastingFeature) parts.push('lanceur de sorts');
    if (p.feat) parts.push(p.feat.map(f => String(f).split('|')[0]).join(', '));
    if (p.feature) parts.push(p.feature.join(', '));
    if (p.pact) parts.push(`Pact of the ${p.pact}`);
    if (p.patron) parts.push(`${p.patron} Patron`);
    if (p.spell) parts.push(p.spell.map(s => String(s).split('|')[0].replace(/#c$/, '')).join(', '));
    if (p.proficiency) parts.push(p.proficiency.map(x => Object.entries(x).map(([k, v]) => `${k} ${v}`).join(' ')).join(', '));
    if (p.other) parts.push(p.other);
    if (p.otherSummary?.entry) parts.push(p.otherSummary.entry);
    return parts.filter(Boolean).join(', ');
  }).filter(Boolean).join(' ; ');
}

function crText(cr) {
  if (cr == null) return '';
  return typeof cr === 'object' ? cr.cr || '' : String(cr);
}
function crValue(cr) {
  const s = crText(cr);
  if (!s || s === 'Unknown' || s === '—') return null;
  if (s.includes('/')) { const [a, b] = s.split('/'); return Number(a) / Number(b); }
  return Number(s);
}
function monsterType(t) {
  if (!t) return '';
  if (typeof t === 'string') return t;
  const base = typeof t.type === 'string' ? t.type : (t.type?.choose || []).join(' or ');
  const tags = (t.tags || []).map(x => (typeof x === 'string' ? x : x.tag)).filter(Boolean);
  return `${t.swarmSize ? `swarm of ${SIZES[t.swarmSize] || t.swarmSize} ` : ''}${base}${tags.length ? ` (${tags.join(', ')})` : ''}`;
}

// Les listes de classes ont changé de place selon les versions de 5etools.
function classesFromLookup(lookup, name, source) {
  const out = new Set();
  const byName = lookup?.[low(source)]?.[low(name)];
  for (const group of [byName?.class, byName?.classVariant]) {
    if (!group) continue;
    for (const src of Object.values(group)) for (const cls of Object.keys(src || {})) out.add(cls);
  }
  return out;
}

// Lecture de `{@filter …}` : « challenge rating=[&0;&1/4] », « type=beast », « speed type=!fly;!swim »…
function parseFilters(parts) {
  const out = [];
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    const k = low(p.slice(0, i).trim());
    const raw = p.slice(i + 1).trim();
    const range = /^\[(.*?);(.*?)\]$/.exec(raw);
    if (range) {
      const v = s => { const t = s.replace(/^&/, '').trim(); return t === '' ? null : t.includes('/') ? Number(t.split('/')[0]) / Number(t.split('/')[1]) : Number(t); };
      out.push({ k, min: v(range[1]), max: v(range[2]) });
    } else {
      const vals = raw.split(';').map(s => s.trim()).filter(Boolean);
      out.push({ k, yes: vals.filter(v => !v.startsWith('!')).map(low), no: vals.filter(v => v.startsWith('!')).map(v => low(v.slice(1))) });
    }
  }
  return out;
}

export class FiveETools {
  constructor(dir, preferred = []) {
    this.dir = dir;
    this.preferred = preferred.map(s => s.toUpperCase());
    this.reset();
  }

  reset() {
    this.cat = new Map();           // type → Map(nom|source → entrée)
    this.fluff = new Map();         // type|nom|source → { entries }
    this.spells = new Map();
    this.items = new Map();
    this.races = new Map();
    this.classes = [];
    this.subclasses = [];
    this.cf = new Map();
    this.sf = new Map();
    this.books = [];                // index des livres et aventures (books.json, adventures.json)
    this.bookCache = new Map();
    this.headings = null;           // index des titres de section, construit en tâche de fond
    this.files = 0;
    this.error = null;
    this._spellIndex = null; this._itemIndex = null; this._search = null; this._featIndex = null;
    // Raccourcis gardés pour le code existant.
    this.feats = this.catMap('feat');
    this.opts = this.catMap('opt');
    this.backgrounds = this.catMap('background');
    this.actions = this.catMap('action');
    this.conditions = this.catMap('condition');
  }

  catMap(kind) {
    if (!this.cat.has(kind)) this.cat.set(kind, new Map());
    return this.cat.get(kind);
  }

  rank(source) {
    const i = this.preferred.indexOf(String(source).toUpperCase());
    return i < 0 ? 100 : i;
  }

  load() {
    this.reset();
    if (!fs.existsSync(this.dir)) { this.error = `Dossier introuvable : ${this.dir}`; return this; }
    const files = walk(this.dir).filter(f => !SKIP_FILE.test(path.basename(f)));
    let lookup = null, oldSources = null;
    for (const f of files) {
      const base = path.basename(f);
      if (base === 'gendata-spell-source-lookup.json') lookup = readJson(f);
      else if (base === 'sources.json' && path.basename(path.dirname(f)) === 'spells') oldSources = readJson(f);
    }
    for (const f of files) {
      const base = path.basename(f);
      if (base === 'gendata-spell-source-lookup.json' || base === 'sources.json' || base === 'index.json') continue;
      const j = readJson(f);
      if (!j || typeof j !== 'object') continue;
      let used = false;
      if (Array.isArray(j.spell)) { for (const s of j.spell) this.addSpell(s, lookup, oldSources); used = true; }
      for (const k of ['item', 'baseitem']) {
        if (Array.isArray(j[k])) { for (const it of j[k]) if (it?.name && it?.source) this.items.set(key(it.name, it.source), it); used = true; }
      }
      // Objets magiques génériques (Weapon, +1 ; Armor of Resistance…).
      if (Array.isArray(j.magicvariant)) {
        for (const mv of j.magicvariant) {
          const src = mv.inherits?.source || mv.source;
          if (mv.name && src) this.items.set(key(mv.name, src), { ...(mv.inherits || {}), name: mv.name, source: src, type: mv.type || 'GV', entries: mv.inherits?.entries || mv.entries || [] });
        }
        used = true;
      }
      if (Array.isArray(j.race)) { this.addRaces(j); used = true; }
      if (Array.isArray(j.class) || Array.isArray(j.classFeature)) { this.addClassFile(j); used = true; }
      if (Array.isArray(j.book) && base === 'books.json') { for (const b of j.book) this.books.push({ ...b, kind: 'book' }); used = true; }
      if (Array.isArray(j.adventure) && base === 'adventures.json') { for (const b of j.adventure) this.books.push({ ...b, kind: 'adventure' }); used = true; }
      for (const [jk, kind] of Object.entries(GENERIC)) {
        if (!Array.isArray(j[jk])) continue;
        const map = this.catMap(kind);
        for (const x of j[jk]) if (x?.name && x?.source) map.set(key(x.name, x.source), x);
        used = true;
      }
      for (const [jk, list] of Object.entries(j)) {
        if (!jk.endsWith('Fluff') || !Array.isArray(list)) continue;
        const kind = GENERIC[jk.slice(0, -5)] || jk.slice(0, -5);
        for (const x of list) if (x?.name && x?.source) this.fluff.set(`${kind}|${key(x.name, x.source)}`, x);
        used = true;
      }
      if (used) this.files++;
    }
    if (!this.files) this.error = `Aucun fichier 5etools reconnu dans ${this.dir}`;
    return this;
  }

  // Index des titres de section des livres et aventures, sans bloquer le serveur.
  buildHeadingsLater() {
    if (this.headings || this._buildingHeadings) return;
    this._buildingHeadings = true;
    const out = [];
    const list = [...this.books];
    const step = () => {
      const b = list.shift();
      if (!b) { this.headings = out; this._search = null; this._buildingHeadings = false; return; }
      const data = this.bookFile(b.kind, b.id, { cache: false });
      (data || []).forEach((ch, idx) => {
        const visit = (e, depth) => {
          if (!e || typeof e !== 'object' || depth > 4) return;
          if (Array.isArray(e)) { e.forEach(x => visit(x, depth)); return; }
          if (e.name && typeof e.name === 'string' && (e.type === 'section' || e.type === 'entries' || e.type === 'inset')) {
            out.push({ k: 'bookSection', n: e.name, s: b.source, x: `${b.name} › ${ch.name || ''}`, bk: b.kind, id: b.id, ch: idx });
          }
          if (e.entries) visit(e.entries, depth + 1);
        };
        visit(ch.entries || [], 0);
      });
      setImmediate(step);
    };
    setImmediate(step);
  }

  addRaces(j) {
    for (const r of j.race) if (r?.name && r?.source) this.races.set(key(r.name, r.source), r);
    // Les sous-espèces (Rock Gnome, High Elf…) deviennent des entrées à part entière.
    for (const s of j.subrace || []) {
      if (!s.name || !s.raceName) continue;
      const parent = this.races.get(key(s.raceName, s.raceSource));
      const name = `${s.name} ${s.raceName}`;
      const source = s.source || s.raceSource;
      this.races.set(key(name, source), {
        ...(parent || {}), ...s, name, source, _parent: s.raceName,
        entries: [...(parent?.entries || []), ...(s.entries || [])],
      });
    }
  }

  addClassFile(j) {
    for (const c of j.class || []) if (c.name && !c._copy) this.classes.push(c);
    for (const s of j.subclass || []) if (s.name) this.subclasses.push(s);
    for (const f of j.classFeature || []) this.cf.set(cfKey(f.name, f.className, f.classSource, f.level, f.source), f);
    for (const f of j.subclassFeature || []) this.sf.set(sfKey(f.name, f.className, f.classSource, f.subclassShortName, f.subclassSource, f.level, f.source), f);
    for (const k of ['classFluff', 'subclassFluff']) {
      for (const x of j[k] || []) if (x?.name && x?.source) this.fluff.set(`${k.slice(0, -5)}|${key(x.name, x.source)}`, x);
    }
  }

  // ------------------------------------------------------------ Copies et références

  resolveCopy(map, x, keyFn, depth = 0) {
    if (!x?._copy || depth > 4) return x;
    const base = map.get(keyFn(x._copy));
    if (!base) return x;
    const { _copy, _mod, ...own } = x;
    let merged = { ...this.resolveCopy(map, base, keyFn, depth + 1), ...own };
    const mods = _mod || _copy._mod;
    if (mods) merged = applyMod(merged, mods);
    delete merged._copy;
    return merged;
  }

  get(kind, name, source) {
    const map = this.cat.get(kind);
    if (!map) return null;
    return this.resolveCopy(map, this.find(map, name, source), c => key(c.name, c.source));
  }

  classFeature(uid) {
    const f = this.cf.get(cfKeyFromUid(uid));
    return f ? this.resolveCopy(this.cf, f, c => cfKey(c.name, c.className, c.classSource, c.level, c.source)) : null;
  }

  subclassFeature(uid) {
    const f = this.sf.get(sfKeyFromUid(uid));
    return f ? this.resolveCopy(this.sf, f, c => sfKey(c.name, c.className, c.classSource, c.subclassShortName, c.subclassSource, c.level, c.source)) : null;
  }

  // Remplace les renvois internes par le texte qu'ils désignent.
  inline(entries, depth = 0) {
    if (depth > 4 || entries == null) return entries;
    if (Array.isArray(entries)) return entries.map(e => this.inline(e, depth));
    if (typeof entries !== 'object') return entries;
    if (entries.type === 'refClassFeature' || entries.type === 'refSubclassFeature' || entries.type === 'refOptionalfeature') {
      let f = null;
      if (entries.type === 'refClassFeature') f = this.classFeature(entries.classFeature);
      else if (entries.type === 'refSubclassFeature') f = this.subclassFeature(entries.subclassFeature);
      else {
        const [n, s] = String(entries.optionalfeature).split('|');
        f = this.find(this.opts, n, s || 'PHB');
      }
      return f ? { type: 'entries', name: f.name, entries: this.inline(f.entries || [], depth + 1) } : null;
    }
    if (entries.entries) return { ...entries, entries: this.inline(entries.entries, depth + 1) };
    if (entries.items) return { ...entries, items: this.inline(entries.items, depth + 1) };
    return entries;
  }

  // ------------------------------------------------------------ Sorts et objets

  addSpell(s, lookup, oldSources) {
    if (!s?.name || !s?.source) return;
    const classes = classesFromLookup(lookup, s.name, s.source);
    for (const c of s.classes?.fromClassList || []) classes.add(c.name);
    for (const c of s.classes?.fromClassListVariant || []) classes.add(c.name);
    for (const c of oldSources?.[s.source]?.[s.name]?.class || []) classes.add(c.name);
    s._classes = [...classes].sort();
    this.spells.set(key(s.name, s.source), s);
  }

  spellIndex() {
    if (!this._spellIndex) {
      this._spellIndex = [...this.spells.values()].map(s => ({
        name: s.name, source: s.source, level: s.level ?? 0,
        school: SCHOOLS[s.school] || s.school || '',
        ritual: !!s.meta?.ritual,
        concentration: !!(s.duration || []).some(d => d.concentration),
        classes: s._classes,
      })).sort((a, b) => a.name.localeCompare(b.name) || this.rank(a.source) - this.rank(b.source));
    }
    return this._spellIndex;
  }

  itemIndex() {
    if (!this._itemIndex) {
      this._itemIndex = [...this.items.values()]
        .map(it => ({
          name: it.name, source: it.source, rarity: it.rarity && it.rarity !== 'none' ? it.rarity : '',
          weight: it.weight || 0, attunement: !!it.reqAttune, type: String(it.type || '').split('|')[0],
          charges: it.charges ? Number(it.charges) || 0 : 0,
        })).sort((a, b) => a.name.localeCompare(b.name) || this.rank(a.source) - this.rank(b.source));
    }
    return this._itemIndex;
  }

  find(map, name, source) {
    if (!map || !name) return null;
    if (source) {
      const hit = map.get(key(name, source));
      if (hit) return hit;
    }
    const n = low(name);
    let all = [...map.values()].filter(x => low(x.name) === n);
    if (!all.length) { const f = fold(name); all = [...map.values()].filter(x => fold(x.name) === f); }
    all.sort((a, b) => this.rank(a.source) - this.rank(b.source));
    return all[0] || null;
  }

  spell(name, source) {
    const s = this.find(this.spells, name, source);
    if (!s) return null;
    return {
      name: s.name, source: s.source, page: s.page, level: s.level ?? 0,
      school: SCHOOLS[s.school] || s.school || '',
      ritual: !!s.meta?.ritual,
      concentration: !!(s.duration || []).some(d => d.concentration),
      time: timeText(s.time), range: rangeText(s.range), components: componentsText(s.components),
      duration: durationText(s.duration), classes: s._classes || [],
      entries: s.entries || [], higher: s.entriesHigherLevel || [],
    };
  }

  item(name, source) {
    let it = this.find(this.items, name, source);
    if (!it) return null;
    it = this.resolveCopy(this.items, it, c => key(c.name, c.source));
    return {
      name: it.name, source: it.source, page: it.page, rarity: it.rarity && it.rarity !== 'none' ? it.rarity : '',
      weight: it.weight || 0, attunement: it.reqAttune === true ? 'requires attunement' : it.reqAttune ? `requires attunement ${it.reqAttune}` : '',
      value: it.value || null, type: String(it.type || '').split('|')[0],
      dmg: [it.dmg1, it.dmgType].filter(Boolean).join(' '), ac: it.ac || null,
      entries: it.entries || [], charges: it.charges || null,
    };
  }

  condition(name) {
    const c = this.find(this.conditions, name, this.preferred[0]) || this.find(this.cat.get('status'), name);
    return c ? { name: c.name, source: c.source, entries: c.entries || [] } : null;
  }

  // ------------------------------------------------------------ Dons et options de classe

  featIndex() {
    if (!this._featIndex) {
      this._featIndex = [...this.feats.values()].map(f => ({
        name: f.name, source: f.source, category: FEAT_CATEGORIES[f.category] || '',
        prereq: prereqText(f.prerequisite),
        ability: (f.ability || []).flatMap(a => (a.choose?.from ? a.choose.from : Object.keys(a).filter(k => ABIL[k]))),
        repeatable: !!f.repeatable,
      })).sort((a, b) => a.name.localeCompare(b.name) || this.rank(a.source) - this.rank(b.source));
    }
    return this._featIndex;
  }

  feat(name, source) {
    const f = this.get('feat', name, source);
    if (!f) return null;
    return { name: f.name, source: f.source, page: f.page, category: FEAT_CATEGORIES[f.category] || '', prereq: prereqText(f.prerequisite), entries: this.inline(f.entries || []) };
  }

  optFeatures(types) {
    const want = new Set(String(types || '').split(',').filter(Boolean));
    return [...this.opts.values()]
      .filter(o => (o.featureType || []).some(t => want.has(t)))
      .map(o => ({
        name: o.name, source: o.source, type: (o.featureType || []).map(t => OPT_TYPES[t] || t).join(', '), prereq: prereqText(o.prerequisite),
        // Niveau de classe minimum, pour cacher ce qu'on ne peut pas encore prendre.
        minLevel: Math.max(0, ...(o.prerequisite || []).map(p => (typeof p.level === 'object' ? Number(p.level.level) : Number(p.level)) || 0)),
        entries: this.inline(o.entries || []),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || this.rank(a.source) - this.rank(b.source));
  }

  // ------------------------------------------------------------ Classes

  pickClass(name, source) {
    const list = this.classes.filter(c => low(c.name) === low(name));
    if (source) { const hit = list.find(c => low(c.source) === low(source)); if (hit) return hit; }
    return list.sort((a, b) => this.rank(a.source) - this.rank(b.source))[0] || null;
  }

  klass(name, source) {
    const c = this.pickClass(name, source);
    if (!c) return null;
    const features = [];
    for (const ref of c.classFeatures || []) {
      const uid = typeof ref === 'string' ? ref : ref.classFeature;
      const f = this.classFeature(uid);
      if (f) features.push({ name: f.name, level: f.level, source: f.source, entries: this.inline(f.entries || []) });
    }
    const seen = new Map();
    for (const s of this.subclasses) {
      if (low(s.className) !== low(c.name) || low(s.classSource || 'PHB') !== low(c.source)) continue;
      const k = low(s.shortName || s.name);
      const cur = seen.get(k);
      if (!cur || this.rank(s.source) < this.rank(cur.source)) seen.set(k, s);
    }
    const subclasses = [...seen.values()]
      .map(s => ({ name: s.name, shortName: s.shortName || s.name, source: s.source, classSource: s.classSource || 'PHB' }))
      .sort((a, b) => this.rank(a.source) - this.rank(b.source) || a.name.localeCompare(b.name));
    // Tableau de progression de la classe, tel quel (le client l'affiche).
    const table = (c.classTableGroups || []).map(g => ({ title: g.title || '', colLabels: g.colLabels || [], rows: g.rows || g.rowsSpellProgression || [] }));
    // Nombre de sorts par niveau de classe, tel que la classe le donne (2024 : sorts préparés).
    const spells = {
      prepared: c.preparedSpellsProgression || null,
      cantrips: c.cantripProgression || null,
      known: c.spellsKnownProgression || null,
      formula: c.preparedSpells || null,
      caster: c.casterProgression || null,
      ability: c.spellcastingAbility || null,
    };
    return { name: c.name, source: c.source, subclassTitle: c.subclassTitle || 'Subclass', hd: c.hd?.faces || null, features, subclasses, table, spells };
  }

  // Les classes jouables, une par nom, dans la source préférée ; pour créer une fiche.
  classList() {
    const best = new Map();
    for (const c of this.classes) {
      if (c.isSidekick || c.isReprinted) continue;
      const k = low(c.name);
      const cur = best.get(k);
      if (!cur || this.rank(c.source) < this.rank(cur.source)) best.set(k, c);
    }
    return [...best.values()].map(c => ({ name: c.name, source: c.source })).sort((a, b) => a.name.localeCompare(b.name));
  }

  subclass(className, classSource, shortName, source) {
    const s = this.subclasses.find(x => low(x.className) === low(className) && low(x.classSource || 'PHB') === low(classSource)
      && (low(x.shortName) === low(shortName) || low(x.name) === low(shortName)) && (!source || low(x.source) === low(source)));
    if (!s) return null;
    const features = [];
    for (const uid of s.subclassFeatures || []) {
      const f = this.subclassFeature(uid);
      if (f) features.push({ name: f.name, level: f.level, source: f.source, entries: this.inline(f.entries || []) });
    }
    return { name: s.name, shortName: s.shortName, source: s.source, classSource: s.classSource || 'PHB', features };
  }

  // ------------------------------------------------------------ Montée de niveau
  // Tout ce que 5etools sait du passage from → to dans une classe : options à choisir
  // (infusions, invocations, métamagie, manœuvres…), dons imposés, sorts ajoutés par la
  // classe ou la sous-classe, Weapon Mastery, compétences de multiclasse.

  levelInfo(className, classSource, subclassName, from, to) {
    const c = this.pickClass(className, classSource);
    if (!c) return null;
    from = Math.max(0, Number(from) || 0);
    to = Math.max(1, Number(to) || 1);
    // Progression cumulée : tableau par niveau, ou objet { niveau: total depuis ce niveau }.
    const at = (prog, L) => {
      if (!prog || L < 1) return 0;
      if (Array.isArray(prog)) return Number(prog[Math.min(L, prog.length) - 1]) || 0;
      let v = 0;
      for (const [k, n] of Object.entries(prog)) if (Number(k) <= L) v = Math.max(v, Number(n) || 0);
      return v;
    };
    const sub = subclassName ? this.findSubclassOf(c, subclassName) : null;
    const subFull = sub ? this.resolveCopy(new Map(this.subclasses.map(s => [`${low(s.name)}|${low(s.source)}|${low(s.classSource)}`, s])), sub, x => `${low(x.name)}|${low(x.source)}|${low(x.classSource || 'PHB')}`) : null;

    const optional = [];
    for (const [owner, list] of [['class', c.optionalfeatureProgression], ['subclass', subFull?.optionalfeatureProgression]]) {
      for (const p of list || []) {
        const total = at(p.progression, to), before = at(p.progression, from);
        if (total <= 0) continue;
        optional.push({ name: p.name, types: p.featureType || [], owner, total, count: Math.max(0, total - before) });
      }
    }
    const feats = [];
    for (const list of [c.featProgression, subFull?.featProgression]) {
      for (const p of list || []) {
        const n = at(p.progression, to) - at(p.progression, from);
        if (n > 0) feats.push({ name: p.name, categories: (p.category || []).map(x => FEAT_CATEGORIES[x] || x), count: n });
      }
    }

    // Sorts ajoutés à ce niveau : « blur|xphb », « mending|xphb#c ».
    const spellRef = s => {
      if (typeof s !== 'string') return null;
      const [ref, flag] = s.split('#');
      const [n, src] = ref.split('|');
      // Sans source, un sort de classe 2014 (Tasha's…) est celui du PHB 2014.
      const sp = this.spell(n, src || (c.source === 'XPHB' ? 'XPHB' : 'PHB'));
      return sp ? { name: sp.name, source: sp.source, level: sp.level, school: sp.school, ritual: sp.ritual, concentration: sp.concentration, time: sp.time, range: sp.range } : { name: n.replace(/\b\w/g, m => m.toUpperCase()), source: src ? src.toUpperCase() : '', level: flag === 'c' ? 0 : 1 };
    };
    const subclassLevel = this.subclassLevel(c);
    // Un sort « au choix » : un filtre 5etools (« level=0;1;2|class=Wizard|school=A ») ou une liste.
    const parseChoose = (choose, count, mode, note) => {
      const out = { mode, count: Math.max(1, Number(count) || 1), note: note || '', levels: null, classes: null, schools: null, from: null };
      if (choose && typeof choose === 'object') {
        out.from = (choose.from || []).map(x => spellRef(x)).filter(Boolean).map(s => ({ name: s.name, source: s.source, level: s.level }));
        out.count = Math.max(1, Number(choose.count) || out.count);
        return out;
      }
      for (const part of String(choose || '').split('|')) {
        const [k, v] = part.split('=');
        const vals = String(v || '').split(';').map(x => x.trim()).filter(Boolean);
        if (low(k) === 'level') out.levels = vals.map(Number).filter(n => !Number.isNaN(n));
        else if (low(k) === 'class') out.classes = vals.map(x => x.replace(/\b\w/g, m => m.toUpperCase()));
        else if (low(k) === 'school') out.schools = vals.map(x => SCHOOLS[x.toUpperCase()] || x);
      }
      return out;
    };
    // Usage d'un sort inné : « 1 fois par Long Rest », « rituel »…
    const USAGE = {
      ritual: () => 'rituel seulement',
      will: () => 'à volonté',
      daily: n => `${/^\d+/.test(n) ? n.replace(/e$/, '') : (ABIL[n] || n).toUpperCase()} fois par Long Rest, sans emplacement`,
      rest: n => `${/^\d+/.test(n) ? n.replace(/e$/, '') : (ABIL[n] || n).toUpperCase()} fois par Short Rest, sans emplacement`,
      resource: (n, set) => `${n} ${set.resourceName || 'point'}${Number(n) > 1 ? 's' : ''}`,
    };
    const additional = [];
    for (const [owner, list] of [['class', c.additionalSpells], ['subclass', subFull?.additionalSpells]]) {
      // « _ » : dès le niveau où la classe ou la sous-classe est prise. Une sous-classe prise à ce
      // niveau donne aussi ses sorts des niveaux antérieurs (domaines 2014 : sorts du niveau 1).
      const gain = owner === 'subclass' ? subclassLevel : 1;
      const lo = owner === 'subclass' && from < subclassLevel ? 0 : from;
      (list || []).forEach((set, i) => {
        const spells = [];
        const picks = [];
        const info = [];
        const collect = (v, mode, note) => {
          if (Array.isArray(v)) {
            for (const s of v) {
              if (typeof s === 'string') { const r = spellRef(s); if (r) spells.push({ ...r, mode, note }); }
              else if (s?.choose) picks.push(parseChoose(s.choose, s.count, mode, note));
            }
            return;
          }
          if (!v || typeof v !== 'object') return;
          for (const [k, w] of Object.entries(v)) {
            if (USAGE[k] && Array.isArray(w)) collect(w, mode, USAGE[k]('1', set));
            else if (USAGE[k]) for (const [n, arr] of Object.entries(w || {})) collect(arr, mode, USAGE[k](n, set));
            else collect(w, mode, note);
          }
        };
        for (const mode of ['prepared', 'known', 'innate']) {
          for (const [k, v] of Object.entries(set[mode] || {})) {
            const lv = k === '_' ? gain : Number(k);
            if (!(lv > lo && lv <= to)) continue;
            collect(v, mode, '');
          }
        }
        // Un même sort donné deux fois (préparé, et gratuit une fois par jour) : une seule ligne.
        const merged = [];
        for (const s of spells) {
          const ex = merged.find(x => fold(x.name) === fold(s.name));
          if (!ex) merged.push(s);
          else if (s.note && !ex.note) ex.note = s.note;
        }
        spells.length = 0;
        spells.push(...merged);
        // Deux choix identiques au même niveau : un seul choix de 2 sorts.
        const pickList = [];
        for (const p of picks) {
          const k = JSON.stringify({ ...p, count: 0 });
          const ex = pickList.find(x => JSON.stringify({ ...x, count: 0 }) === k);
          if (ex) ex.count += p.count;
          else pickList.push(p);
        }
        picks.length = 0;
        picks.push(...pickList);
        // Liste étendue (Warlock 2014) : des sorts ajoutés à la liste, à apprendre normalement.
        if (set.expanded && from < gain && to >= gain) {
          const all = Object.values(set.expanded).flat().filter(x => typeof x === 'string').map(x => spellRef(x)?.name).filter(Boolean);
          if (all.length) info.push(`Liste de sorts étendue : ${all.join(', ')}`);
        }
        if (spells.length || picks.length || info.length) additional.push({ owner, set: set.name || null, index: i, spells, picks, info });
      });
    }
    // Plusieurs ensembles nommés (Circle of the Land) : il faut en choisir un. Un ensemble seul
    // (Lunar Sorcery) est donné tel quel.
    const named = additional.filter(a => a.set);
    const sets = named.length > 1 ? named : [];
    if (named.length === 1) named[0].set = null;

    const mastery = (c.itemMasteriesProgression || c.itemMasteries) && c.itemMasteriesProgression
      ? Math.max(0, at(c.itemMasteriesProgression, to) - at(c.itemMasteriesProgression, from)) : 0;

    let multiclassSkills = null;
    if (from === 0) {
      const sk = c.multiclassing?.proficienciesGained?.skills?.[0]?.choose;
      if (sk) multiclassSkills = { count: sk.count || 1, from: sk.from || [] };
    }
    const cantrips = c.cantripProgression ? at(c.cantripProgression, to) - at(c.cantripProgression, from) : null;
    return {
      class: c.name, source: c.source, hd: c.hd?.faces || null, subclassLevel, subclass: subFull ? { name: subFull.name, source: subFull.source } : null,
      optional, feats, additional: additional.filter(a => !a.set), sets, mastery, masteryTotal: c.itemMasteriesProgression ? at(c.itemMasteriesProgression, to) : 0,
      multiclassSkills, cantrips,
    };
  }

  subclassLevel(c) {
    for (const ref of c.classFeatures || []) if (typeof ref === 'object' && ref.gainSubclassFeature) return Number(String(ref.classFeature).split('|')[3]) || 3;
    return 3;
  }

  findSubclassOf(c, name) {
    const list = this.subclasses.filter(s => low(s.className) === low(c.name) && low(s.classSource || 'PHB') === low(c.source));
    const pick = arr => arr.sort((a, b) => this.rank(a.source) - this.rank(b.source))[0] || null;
    const exact = n => pick(list.filter(s => fold(s.name) === n));
    // Classe 2024 : « The Archfey » ou « School of Illusion » désignent la version 2024.
    const modern = c.source === 'XPHB' ? modernSubclass(name) : null;
    const n = fold(name);
    return (modern && exact(fold(modern))) || exact(n) || pick(list.filter(s => n.includes(fold(s.shortName)) || fold(s.name).includes(n)));
  }

  // Armes qui ont une propriété Weapon Mastery (PHB 2024).
  masteryWeapons() {
    const out = new Map();
    for (const it of this.items.values()) {
      if (!Array.isArray(it.mastery) || !it.mastery.length || it.rarity && it.rarity !== 'none') continue;
      const k = low(it.name);
      const cur = out.get(k);
      if (!cur || this.rank(it.source) < this.rank(cur.source)) out.set(k, { name: it.name, source: it.source, mastery: it.mastery.map(m => String(m).split('|')[0]).join(', ') });
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  // ------------------------------------------------------------ Livres et aventures

  bookList() {
    return this.books.map(b => ({ kind: b.kind, id: b.id, name: b.name, source: b.source, group: b.group || '', published: b.published || '', contents: b.contents || [] }))
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'book' ? -1 : 1) || (a.group === 'core' ? 0 : 1) - (b.group === 'core' ? 0 : 1) || a.name.localeCompare(b.name));
  }

  bookFile(kind, id, { cache = true } = {}) {
    const k = `${kind}|${low(id)}`;
    if (this.bookCache.has(k)) return this.bookCache.get(k);
    const file = path.join(this.dir, kind === 'adventure' ? 'adventure' : 'book', `${kind}-${low(id)}.json`);
    const j = readJson(file);
    const data = (j?.[`${kind}Data`]?.[0]?.data) || j?.data || null;
    if (data && cache) {
      this.bookCache.set(k, data);
      if (this.bookCache.size > 6) this.bookCache.delete(this.bookCache.keys().next().value);
    }
    return data;
  }

  bookChapter(kind, id, ch) {
    const b = this.books.find(x => x.kind === kind && low(x.id) === low(id));
    if (!b) return null;
    const data = this.bookFile(kind, b.id);
    if (!data) return null;
    const i = Math.max(0, Math.min(data.length - 1, Number(ch) || 0));
    return { kind, id: b.id, name: b.name, source: b.source, chapter: i, chapters: data.map(c => c.name || ''), title: data[i].name || '', entries: this.inline(data[i].entries || []) };
  }

  // Chapitre qui contient une section donnée (liens {@book Titre|XPHB|3|Combat}).
  findChapter(kind, id, ch, section) {
    if (ch !== '' && ch != null && !Number.isNaN(Number(ch))) return Number(ch);
    const b = this.books.find(x => x.kind === kind && low(x.id) === low(id));
    if (!b || !section) return 0;
    const i = (b.contents || []).findIndex(c => (c.headers || []).some(h => low(typeof h === 'string' ? h : h.header) === low(section)) || low(c.name) === low(section));
    return Math.max(0, i);
  }

  // ------------------------------------------------------------ Filtres {@filter}

  filter(category, filterStr) {
    const f = parseFilters(String(filterStr || '').split('|'));
    const has = (k) => f.find(x => x.k === k);
    const yesNo = (rule, vals) => {
      if (!rule) return true;
      const v = vals.map(low);
      if (rule.yes?.length && !rule.yes.some(y => v.includes(y))) return false;
      if (rule.no?.length && rule.no.some(n => v.includes(n))) return false;
      return true;
    };
    const range = (rule, val) => !rule || (val != null && (rule.min == null || val >= rule.min) && (rule.max == null || val <= rule.max));
    const src = has('source');
    const out = [];
    if (category === 'bestiary') {
      for (const m0 of this.catMap('monster').values()) {
        const m = m0._copy ? this.get('monster', m0.name, m0.source) : m0;
        if (!m || !range(has('challenge rating') || has('cr'), crValue(m.cr))) continue;
        const type = typeof m.type === 'string' ? m.type : typeof m.type?.type === 'string' ? m.type.type : '';
        if (!yesNo(has('type'), [type])) continue;
        if (!yesNo(has('speed type'), Object.keys(m.speed || {}).filter(k => k !== 'canHover' && k !== 'choose'))) continue;
        if (!yesNo(has('miscellaneous'), [m.type?.swarmSize ? 'swarm' : ''].filter(Boolean))) continue;
        if (!yesNo(has('size'), (m.size || []).map(s => SIZES[s] || s))) continue;
        if (!yesNo(src, [m.source])) continue;
        out.push({ k: 'monster', n: m.name, s: m.source, x: `CR ${crText(m.cr)} · ${monsterType(m.type)}`, cr: crValue(m.cr) });
      }
      out.sort((a, b) => (a.cr ?? 99) - (b.cr ?? 99) || a.n.localeCompare(b.n));
    } else if (category === 'spells') {
      const schools = Object.fromEntries(Object.entries(SCHOOLS).flatMap(([k, v]) => [[low(k), v], [low(v), v]]));
      for (const s of this.spellIndex()) {
        if (!yesNo(has('level'), [String(s.level)])) continue;
        const sch = has('school');
        if (sch && !yesNo({ yes: (sch.yes || []).map(x => low(schools[x] || x)), no: (sch.no || []).map(x => low(schools[x] || x)) }, [s.school])) continue;
        if (!yesNo(has('class'), s.classes || [])) continue;
        if (!yesNo(src, [s.source])) continue;
        out.push({ k: 'spell', n: s.name, s: s.source, x: `${s.level ? `niveau ${s.level}` : 'cantrip'} · ${s.school}` });
      }
    } else if (category === 'items') {
      for (const it of this.itemIndex()) {
        if (!yesNo(has('rarity'), [it.rarity || 'none'])) continue;
        if (!yesNo(has('type'), [it.type])) continue;
        if (!yesNo(src, [it.source])) continue;
        out.push({ k: 'item', n: it.name, s: it.source, x: it.rarity });
      }
    } else if (category === 'feats') {
      for (const ft of this.featIndex()) {
        if (!yesNo(has('category'), [ft.category])) continue;
        if (!yesNo(src, [ft.source])) continue;
        out.push({ k: 'feat', n: ft.name, s: ft.source, x: ft.category });
      }
    }
    // Une seule version par nom : la source préférée.
    const seen = new Map();
    for (const r of out) {
      const k = low(r.n);
      const cur = seen.get(k);
      if (!cur || this.rank(r.s) < this.rank(cur.s)) seen.set(k, r);
    }
    return out.filter(r => seen.get(low(r.n)) === r).slice(0, 5000);
  }

  // ------------------------------------------------------------ Recherche globale

  searchIndex() {
    if (this._search && !(this.headings && !this._searchHasHeadings)) return this._search;
    const out = [];
    const push = (k, x, extra = '') => out.push({ k, n: x.name, s: x.source, x: extra });
    for (const s of this.spellIndex()) push('spell', s, s.level ? `niveau ${s.level}` : 'cantrip');
    for (const it of this.itemIndex()) push('item', it, it.rarity);
    for (const r of this.races.values()) push('race', r);
    for (const [kind, map] of this.cat) {
      for (const x of map.values()) {
        let extra = '';
        if (kind === 'monster') extra = `CR ${crText(x.cr)}`;
        else if (kind === 'opt') extra = (x.featureType || []).map(t => OPT_TYPES[t] || t).join(', ');
        else if (kind === 'feat') extra = FEAT_CATEGORIES[x.category] || '';
        else if (kind === 'deity') extra = x.pantheon || '';
        push(kind, x, extra);
      }
    }
    const classSeen = new Set();
    for (const c of this.classes) { if (!classSeen.has(key(c.name, c.source))) { classSeen.add(key(c.name, c.source)); push('class', c); } }
    for (const f of this.cf.values()) if (f.entries) out.push({ k: 'classFeature', n: f.name, s: f.source, x: `${f.className} ${f.level}`, cls: f.className, cs: f.classSource, lv: f.level });
    for (const f of this.sf.values()) if (f.entries) out.push({ k: 'subclassFeature', n: f.name, s: f.source, x: `${f.className} (${f.subclassShortName}) ${f.level}`, cls: f.className, cs: f.classSource, sub: f.subclassShortName, ss: f.subclassSource, lv: f.level });
    for (const b of this.books) out.push({ k: b.kind, n: b.name, s: b.source, x: b.group || '', id: b.id, bk: b.kind });
    if (this.headings) out.push(...this.headings);
    for (const e of out) e.f = fold(e.n);
    this._searchHasHeadings = !!this.headings;
    this._search = out;
    return out;
  }

  search(q, kind, limit = 100) {
    const fq = fold(q).trim();
    if (fq.length < 2) return [];
    const kinds = kind ? new Set(String(kind).split(',')) : null;
    const hits = this.searchIndex().filter(e => (!kinds || kinds.has(e.k)) && e.f.includes(fq));
    const order = k => (k === 'bookSection' ? 2 : k === 'classFeature' || k === 'subclassFeature' ? 1 : 0);
    hits.sort((a, b) => (a.f === fq ? 0 : 1) - (b.f === fq ? 0 : 1) || (a.f.startsWith(fq) ? 0 : 1) - (b.f.startsWith(fq) ? 0 : 1)
      || order(a.k) - order(b.k) || a.n.localeCompare(b.n) || this.rank(a.s) - this.rank(b.s));
    return hits.slice(0, limit).map(({ f, ...e }) => e);
  }

  // Une entrée de n'importe quel type, prête à afficher : { kind, name, source, meta, entries, fluff, monster }.
  entry(kind, name, source, extra = {}) {
    if (kind === 'optionalfeature') kind = 'opt';
    if (kind === 'creature') kind = 'monster';
    const meta = [];
    let x = null;
    const fluffOf = (k, it) => {
      const fl = this.fluff.get(`${k}|${key(it.name, it.source)}`);
      return fl ? this.inline(this.resolveCopy(this.fluff, fl, c => `${k}|${key(c.name, c.source)}`).entries || []) : null;
    };
    switch (kind) {
      case 'spell': {
        const s = this.spell(name, source);
        if (!s) return null;
        return { kind, name: s.name, source: s.source, meta: [s.level ? `Niveau ${s.level}, ${s.school}` : `Cantrip, ${s.school}`, s.time, s.range, s.components, s.duration, s.classes.length ? `Classes : ${s.classes.join(', ')}` : ''], entries: [...s.entries, ...s.higher], fluff: fluffOf('spell', s) };
      }
      case 'item': {
        const it = this.item(name, source);
        if (!it) return null;
        return { kind, name: it.name, source: it.source, meta: [it.type, it.rarity, it.attunement, it.dmg, it.ac ? `AC ${it.ac}` : '', it.weight ? `${it.weight} lb` : ''], entries: it.entries, fluff: fluffOf('item', it) };
      }
      case 'feat': {
        const f = this.feat(name, source);
        if (!f) return null;
        return { kind, name: f.name, source: f.source, meta: [f.category, f.prereq ? `Prérequis : ${f.prereq}` : ''], entries: f.entries };
      }
      case 'monster': {
        const m = this.get('monster', name, source);
        if (!m) return null;
        const monster = { ...m };
        for (const k of ['trait', 'action', 'bonus', 'reaction', 'legendary', 'mythic']) if (monster[k]) monster[k] = this.inline(monster[k]);
        const lg = m.legendaryGroup ? this.get('legendaryGroup', m.legendaryGroup.name, m.legendaryGroup.source) : null;
        return { kind, name: m.name, source: m.source, meta: [`CR ${crText(m.cr)}`, monsterType(m.type)], entries: [], monster, lair: lg ? this.inline([...(lg.lairActions || []), ...(lg.regionalEffects || [])]) : null, fluff: fluffOf('monster', m) };
      }
      case 'class': {
        const c = this.klass(name, source);
        if (!c) return null;
        return { kind, name: c.name, source: c.source, meta: [c.hd ? `Hit Die d${c.hd}` : '', `${c.subclasses.length} sous-classes`], entries: [], klass: c, fluff: fluffOf('class', c) };
      }
      case 'subclass': {
        const s = this.subclass(extra.cls || name, extra.cs || 'XPHB', extra.sub || name, source);
        if (!s) return null;
        return { kind, name: s.name, source: s.source, meta: [], entries: s.features.map(f => ({ type: 'entries', name: `Niveau ${f.level} · ${f.name}`, entries: f.entries })) };
      }
      case 'opt': x = this.get('opt', name, source); if (x) meta.push((x.featureType || []).map(t => OPT_TYPES[t] || t).join(', '), x.prerequisite ? `Prérequis : ${prereqText(x.prerequisite)}` : ''); break;
      case 'race': {
        x = this.resolveCopy(this.races, this.find(this.races, name, source), c => key(c.name, c.source));
        if (x) meta.push(x.size ? `Taille ${x.size.join('/')}` : '', x.speed ? `Vitesse ${typeof x.speed === 'number' ? x.speed : x.speed.walk ?? ''} ft` : '', x.darkvision ? `Darkvision ${x.darkvision} ft` : '');
        break;
      }
      case 'classFeature': {
        x = this.classFeature([name, extra.cls, extra.cs, extra.lv, source].join('|'));
        if (x) meta.push(`${x.className} niveau ${x.level}`);
        break;
      }
      case 'subclassFeature': {
        x = this.subclassFeature([name, extra.cls, extra.cs, extra.sub, extra.ss, extra.lv, source].join('|'));
        if (x) meta.push(`${x.className}, ${x.subclassShortName}, niveau ${x.level}`);
        break;
      }
      case 'deity': x = this.get(kind, name, source); if (x) meta.push(x.pantheon, x.title, (x.domains || []).join(', '), x.alignment ? `Alignement ${x.alignment.join('')}` : '', x.symbol ? `Symbole : ${x.symbol}` : ''); break;
      case 'table': {
        x = this.get(kind, name, source);
        if (x && !x.entries) x = { ...x, entries: x.tables ? x.tables.map(t => ({ ...t, type: 'table' })) : [{ ...x, type: 'table', name: undefined }] };
        break;
      }
      case 'deck': {
        x = this.get(kind, name, source);
        if (x) x = { ...x, entries: [...(x.entries || []), { type: 'list', items: (x.cards || []).map(c => (typeof c === 'string' ? c.split('|')[0] : c.uid || c.name || '')) }] };
        break;
      }
      case 'vehicle': x = this.get(kind, name, source); if (x) meta.push(x.vehicleType || '', x.capCrew ? `Équipage ${x.capCrew}` : '', x.pace ? `Allure ${x.pace} mph` : ''); break;
      case 'legendaryGroup': x = this.get(kind, name, source); if (x) x = { ...x, entries: [...(x.lairActions || []), ...(x.regionalEffects || []), ...(x.mythicEncounter || [])] }; break;
      case 'itemMastery': case 'variantrule': case 'language': case 'sense': case 'skill': case 'reward': case 'trap': case 'hazard':
      case 'object': case 'psionic': case 'cult': case 'boon': case 'recipe': case 'facility': case 'charoption': case 'action':
      case 'background': case 'condition': case 'disease': case 'status':
        x = this.get(kind, name, source);
        if (x?.time) meta.push(timeText(x.time));
        if (kind === 'language' && x) meta.push(x.type || '', (x.typicalSpeakers || []).map(s => String(s).replace(/\{@\w+ ([^|}]+)[^}]*\}/g, '$1')).join(', '));
        if (kind === 'recipe' && x?.ingredients) x = { ...x, entries: [{ type: 'list', items: x.ingredients.map(i => (typeof i === 'string' ? i : i.item || '')) }, ...(x.instructions || x.entries || [])] };
        break;
      default: return null;
    }
    if (!x) return null;
    const entries = x.entries || (x.entry ? [x.entry] : []);
    return { kind, name: x.name, source: x.source, meta: meta.filter(Boolean), entries: this.inline(entries), fluff: fluffOf(kind, x) };
  }

  status() {
    const size = k => this.cat.get(k)?.size || 0;
    return {
      dir: this.dir, files: this.files, spells: this.spells.size, items: this.items.size, conditions: this.conditions.size,
      feats: size('feat'), options: size('opt'), classes: new Set(this.classes.map(c => c.name)).size,
      races: this.races.size, backgrounds: size('background'), monsters: size('monster'), rules: size('variantrule'),
      deities: size('deity'), books: this.books.length, headings: this.headings ? this.headings.length : null,
      error: this.error, download: (info => (info ? (({ sha, ...rest }) => rest)(info) : null))(readDownloadInfo(this.dir)),
    };
  }
}
