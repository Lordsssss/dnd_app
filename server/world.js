// Carte du monde : un fichier .map d'Azgaar's Fantasy Map Generator, lu tel quel, plus une
// couche de lore tenue par l'application (maps/_monde.json).
//
// Le .map garde le dessin (SVG) et les données : bourgs, États, provinces, cultures, religions,
// marqueurs. Les versions récentes d'Azgaar n'y enregistrent ni les icônes ni les noms des
// bourgs, ni les marqueurs : la page les dessine elle-même à partir des données, ce qui les rend
// cliquables et permet de n'en montrer qu'une partie aux joueurs.
//
// La couche de lore : nom corrigé, note du coffre, notes du MJ, texte pour les joueurs, et
// « connu » (visible des joueurs), par entité : b<id> bourg, s<id> État, p<id> province,
// m<id> marqueur, l<id> lac, r<id> religion, a<id> lieu ajouté dans l'application. Les noms corrigés peuvent
// être réécrits dans le .map pour qu'Azgaar les montre aussi.
import fs from 'node:fs';
import path from 'node:path';

export class WorldError extends Error {
  constructor(status, msg, vars) { super(msg); this.status = status; this.vars = vars; }
}

const MAX = { name: 80, full: 120, mj: 20_000, pub: 5_000, kind: 40, deity: 120, form: 40, type: 40 };
// À changer quand la construction du SVG de fond change : les navigateurs le reprennent.
const SVG_VERSION = 5;
const KEY_RE = /^[bspmlar]\d+$/;

// Groupes du SVG inutiles ici : dessinés par la page, vides, ou propres à l'éditeur d'Azgaar.
const DROP_GROUPS = [
  'burgIcons', 'markers', 'emblems', 'armies', 'journeys', 'fogging', 'ruler', 'debug', 'scaleBar', 'legend',
  'goods', 'markets', 'tradeAnimation', 'cells', 'gridOverlay', 'coordinates', 'compass', 'texture',
  'temperature', 'prec', 'population', 'zones', 'vignette',
];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------- Lecture du .map

function sniff(line) {
  const head = line.slice(0, 400);
  if (head.startsWith('[0,{"i":1,"type":')) return 'features';
  if (head.startsWith('[0,{"cell":') || (head.startsWith('[0,{') && head.includes('"cell":') && head.includes('"population":') && !head.includes('"formName"'))) return 'burgs';
  if (head.startsWith('[0,{') && head.includes('"formName"') && head.includes('"burg":')) return 'provinces';
  if (head.startsWith('[{') && head.includes('"name":"Neutrals"')) return 'states';
  if (head.startsWith('[{') && head.includes('"name":"No religion"')) return 'religions';
  if (head.startsWith('[{') && head.includes('"base":') && head.includes('"shield"')) return 'cultures';
  if (head.startsWith('[{"icon":') || (head.startsWith('[{') && head.includes('"icon":') && head.includes('"type":') && head.includes('"x":') && head.includes('"cell":'))) return 'markers';
  return null;
}

function numbers(line) {
  if (!line || !/^-?\d/.test(line)) return null;
  const parts = line.split(',');
  const out = new Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const v = Number(parts[i]);
    if (Number.isNaN(v)) return null;
    out[i] = v;
  }
  return out;
}

// Coupe le texte en lignes, retrouve le SVG et les tableaux utiles, sans dépendre de leur
// position exacte : elle change d'une version d'Azgaar à l'autre.
export function parseMap(text) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(nl);
  const params = lines[0].split('|');
  if (!/^\d+\.\d+/.test(params[0] || '')) throw new WorldError(400, 'Ce fichier ne ressemble pas à un .map d\'Azgaar');
  let settings = {};
  try { settings = JSON.parse(lines[1]); } catch { /* très ancien format : réglages en texte */ }
  const svgStart = lines.findIndex(l => l.trimStart().startsWith('<svg'));
  let svgEnd = -1;
  for (let i = Math.max(0, svgStart); i < lines.length; i++) if (lines[i].includes('</svg>')) { svgEnd = i; break; }
  if (svgStart < 0 || svgEnd < 0) throw new WorldError(400, 'SVG introuvable dans le .map');

  const at = {};
  const data = {};
  for (let i = svgEnd + 1; i < lines.length; i++) {
    const kind = sniff(lines[i]);
    if (!kind || at[kind] != null) continue;
    at[kind] = i;
    data[kind] = JSON.parse(lines[i]);
  }
  for (const k of ['burgs', 'states', 'provinces']) if (!data[k]) throw new WorldError(400, `Données « ${k} » introuvables dans le .map`);

  // Tableaux par cellule : on reconnaît l'État, la culture et la province à ce qu'ils valent
  // sous les bourgs et au centre des provinces.
  const burgs = data.burgs.filter(b => b && !b.removed && b.i);
  const provinces = data.provinces.filter(p => p && !p.removed && p.i);
  const packLen = Math.max(...burgs.map(b => b.cell)) + 1;
  const cellArrays = [];
  for (let i = svgEnd + 1; i < lines.length; i++) {
    if (lines[i].length < packLen) continue;
    const a = numbers(lines[i]);
    if (a && a.length >= packLen) cellArrays.push({ i, a });
  }
  const score = (a, items, cell, value) => items.filter(x => a[cell(x)] === value(x)).length / Math.max(1, items.length);
  const best = test => cellArrays.map(c => ({ ...c, s: test(c.a) })).sort((x, y) => y.s - x.s)[0];
  const stateArr = best(a => score(a, burgs, b => b.cell, b => b.state));
  const provArr = best(a => score(a, provinces, p => p.center, p => p.i));
  const nRel = (data.religions || []).length;
  const relArr = cellArrays.find(c => c.i === stateArr?.i + 1 && Math.max(...c.a) < Math.max(1, nRel));
  // Les biomes suivent la ligne des bourgs : des entiers, au plus le nombre de biomes.
  let biomeList = [];
  try { biomeList = JSON.parse(lines[3]); } catch { /* ancien format */ }
  const biomeArr = cellArrays.find(c => c.i === at.burgs + 1 && Math.max(...c.a) < Math.max(1, biomeList.length));
  const cells = {
    province: provArr?.s > 0.8 ? provArr.a : null,
    religion: relArr ? relArr.a : null,
    biome: biomeArr ? biomeArr.a : null,
  };

  return { nl, lines, params, settings, svgStart, svgEnd, at, data, cells, biomes: biomeList.map(b => b?.name || '') };
}

// ---------------------------------------------------------------- SVG de fond

// Coupe un nom en n lignes aussi égales que possible, entre les mots.
function splitLines(words, n) {
  if (n <= 1 || words.length < 2) return [words.join(' ')];
  let best = null;
  const walk = (from, left, acc) => {
    if (left === 1) {
      const lines = [...acc, words.slice(from).join(' ')];
      const worst = Math.max(...lines.map(l => l.length));
      if (!best || worst < best.worst) best = { lines, worst };
      return;
    }
    for (let i = from + 1; i <= words.length - left + 1; i++) walk(i, left - 1, [...acc, words.slice(from, i).join(' ')]);
  };
  walk(0, Math.min(n, words.length), []);
  return best.lines;
}

// Nouveau texte d'une étiquette d'État, sur une courbe de longueur fixe. Azgaar coupe les noms
// longs en deux lignes : on garde ce découpage. Un nom nettement plus long qu'un nom d'une
// seule ligne passe sur deux lignes ; s'il reste plus long que l'ancien, la police diminue,
// une seule fois, avec 12 % de marge car les lettres n'ont pas toutes la même largeur.
function relabel(inner, name) {
  const spans = [...inner.matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g)];
  const oldLines = spans.length ? spans.map(m => m[2].trim()) : [inner.replace(/<[^>]+>/g, '').trim()];
  if (oldLines.join(' ') === name) return inner;
  const words = name.trim().split(/\s+/);
  const oldMax = Math.max(1, ...oldLines.map(l => l.length));
  let n = Math.max(1, oldLines.length);
  if (n === 1 && name.length > oldMax * 1.15 && words.length > 1) n = 2;
  const lines = splitLines(words, n);
  const newMax = Math.max(...lines.map(l => l.length));
  return inner.replace(/(<textPath\b[^>]*>)[\s\S]*?(<\/textPath>)/, (m, open, close) => {
    let tag = open;
    if (newMax > oldMax) {
      const k = Math.min(1, (0.88 * oldMax) / newMax);
      tag = tag.replace(/font-size="([\d.]+)(%|px)"/, (fm, v, u) => `font-size="${Math.round(Number(v) * k * 10) / 10}${u}"`);
    }
    const body = lines.length === 1
      ? esc(lines[0])
      : lines.map((l, i) => `<tspan x="0" dy="${i === 0 ? `${-(lines.length - 1) / 2}em` : '1em'}">${esc(l)}${i < lines.length - 1 ? ' ' : ''}</tspan>`).join('');
    return `${tag}${body}${close}`;
  });
}

// Retire un élément <g id="…"> et tout son contenu.
export function removeGroup(svg, id) {
  const start = svg.indexOf(`<g id="${id}"`);
  if (start < 0) return svg;
  const tagEnd = svg.indexOf('>', start);
  if (svg[tagEnd - 1] === '/') return svg.slice(0, start) + svg.slice(tagEnd + 1);
  const re = /<g\b[^>]*?(\/?)>|<\/g>/g;
  re.lastIndex = tagEnd + 1;
  let depth = 1;
  let m;
  while ((m = re.exec(svg))) {
    if (m[0] === '</g>') depth -= 1;
    else if (!m[1]) depth += 1;
    if (depth === 0) return svg.slice(0, start) + svg.slice(m.index + 4);
  }
  return svg;
}

export function buildBaseSvg(parsed, stateLabels = {}) {
  let svg = parsed.lines.slice(parsed.svgStart, parsed.svgEnd + 1).join('\n');
  svg = svg.slice(0, svg.indexOf('</svg>') + 6);
  for (const id of DROP_GROUPS) svg = removeGroup(svg, id);
  const w = Number(parsed.params[4]) || 1866;
  const h = Number(parsed.params[5]) || 954;
  svg = svg.replace(/<svg\b[^>]*>/, `<svg id="worldBase" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">`);
  svg = svg.replace(' style="cursor: default;"', '');
  // Noms d'États corrigés : le texte de leur étiquette.
  svg = svg.replace(/(<text id="stateLabel(\d+)"[^>]*>)([\s\S]*?)(<\/text>)/g, (m, open, id, inner, close) => {
    const name = stateLabels[id];
    if (!name) return m;
    return open + relabel(inner, name) + close;
  });
  return svg;
}

// Centre approximatif d'un lac : la moyenne des points de son contour.
function featureCenters(parsed, ids) {
  const svg = parsed.lines.slice(parsed.svgStart, parsed.svgEnd + 1).join('\n');
  const out = {};
  for (const id of ids) {
    const m = new RegExp(`<path d="([^"]+)" id="feature_${id}"`).exec(svg) || new RegExp(`<path id="feature_${id}"[^>]*? d="([^"]+)"`).exec(svg);
    if (!m) continue;
    const n = m[1].match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    let sx = 0, sy = 0, k = 0;
    for (let i = 0; i + 1 < n.length; i += 2) { sx += n[i]; sy += n[i + 1]; k++; }
    if (k) out[id] = { x: sx / k, y: sy / k };
  }
  return out;
}

const BIOMES_FR = {
  Marine: 'Mer', 'Hot desert': 'Désert chaud', 'Cold desert': 'Désert froid', Savanna: 'Savane', Grassland: 'Prairie',
  'Tropical seasonal forest': 'Forêt tropicale sèche', 'Temperate deciduous forest': 'Forêt tempérée', 'Tropical rainforest': 'Forêt tropicale humide',
  'Temperate rainforest': 'Forêt tempérée humide', Taiga: 'Taïga', Tundra: 'Toundra', Glacier: 'Glacier', Wetland: 'Marais',
};

function glyph(icon) {
  const m = /^glyph-([0-9a-f-]+)$/i.exec(icon || '');
  if (!m) return '📍';
  try { return String.fromCodePoint(...m[1].split('-').map(h => parseInt(h, 16))); } catch { return '📍'; }
}

// ---------------------------------------------------------------- Données pour la page

export function extractWorld(parsed) {
  const { data, settings, cells, params } = parsed;
  const units = settings.units || {};
  const popScale = Number(units.population?.scale) || 1000;
  const urban = Number(units.population?.urbanization?.rate) || 1;
  const religionsAt = cells.religion;
  const burgs = data.burgs.filter(b => b && !b.removed && b.i).map(b => ({
    i: b.i, name: b.name, x: b.x, y: b.y, state: b.state || 0, culture: b.culture || 0,
    province: cells.province ? cells.province[b.cell] || 0 : 0,
    religion: religionsAt ? religionsAt[b.cell] || 0 : 0,
    biome: cells.biome ? BIOMES_FR[parsed.biomes?.[cells.biome[b.cell]]] || parsed.biomes?.[cells.biome[b.cell]] || '' : '',
    group: b.group || (b.capital ? 'capital' : 'town'), capital: !!b.capital,
    population: Math.round((b.population || 0) * popScale * urban),
    port: !!b.port, walls: !!b.walls, citadel: !!b.citadel, plaza: !!b.plaza, temple: !!b.temple, shanty: !!b.shanty,
    type: b.type || '',
  }));
  const states = data.states.filter(s => s && !s.removed).map(s => ({
    i: s.i, name: s.name, full: s.fullName || s.name, form: s.formName || s.form || '', color: s.color || null,
    capital: s.capital || 0, culture: s.culture || 0,
  }));
  const provinces = data.provinces.filter(p => p && !p.removed && p.i).map(p => ({
    i: p.i, name: p.name, full: p.fullName || p.name, form: p.formName || '', state: p.state, burg: p.burg || 0, color: p.color || null,
  }));
  const cultures = (data.cultures || []).filter(c => c && !c.removed).map(c => ({ i: c.i, name: c.name, type: c.type || '' }));
  const religions = (data.religions || []).filter(r => r && !r.removed).map(r => ({ i: r.i, name: r.name, type: r.type || '', form: r.form || '', deity: r.deity || '' }));
  const markers = (data.markers || []).filter(m => m && !m.removed).map(m => ({
    i: m.i, type: m.type || '', name: m.name || m.type || 'Marqueur', note: m.note || '', x: m.x, y: m.y, icon: glyph(m.icon),
  }));
  const lakeIds = (data.features || []).filter(f => f && f.type === 'lake').map(f => f.i);
  const centers = featureCenters(parsed, lakeIds);
  const lakes = (data.features || []).filter(f => f && f.type === 'lake' && centers[f.i]).map(f => ({
    i: f.i, name: f.name || 'Lac', x: centers[f.i].x, y: centers[f.i].y, cells: f.cells || 0,
  }));
  return {
    name: settings.lore?.name || 'Monde',
    year: settings.lore?.calendar?.year ?? null,
    era: settings.lore?.calendar?.era || '',
    width: Number(params[4]) || 1866,
    height: Number(params[5]) || 954,
    distance: { unit: units.distance?.unit || 'mi', scale: Number(units.distance?.scale) || 1 },
    version: params[0],
    burgs, states, provinces, cultures, religions, markers, lakes,
  };
}

// ---------------------------------------------------------------- Réécriture du .map

// Applique les noms corrigés au .map : bourgs, États, provinces, marqueurs, lacs, et le
// texte des étiquettes d'États dans le SVG. Rien d'autre ne change.
export function applyNames(parsed, entities, party = null) {
  const lines = [...parsed.lines];
  const { at } = parsed;
  const touched = [];
  const edit = (kind, fn) => {
    if (at[kind] == null) return;
    const arr = JSON.parse(lines[at[kind]]);
    if (fn(arr)) { lines[at[kind]] = JSON.stringify(arr); touched.push(kind); }
  };
  const ov = (prefix, id) => entities[`${prefix}${id}`] || null;
  edit('burgs', arr => {
    let n = 0;
    for (const b of arr) {
      const o = b && ov('b', b.i);
      if (o?.name && o.name !== b.name) { b.name = o.name; n++; }
    }
    return n > 0;
  });
  edit('states', arr => {
    let n = 0;
    for (const s of arr) {
      const o = s && ov('s', s.i);
      if (!o) continue;
      if (o.name && o.name !== s.name) { s.name = o.name; n++; }
      if (o.full && o.full !== s.fullName) { s.fullName = o.full; n++; }
    }
    return n > 0;
  });
  edit('provinces', arr => {
    let n = 0;
    for (const p of arr) {
      const o = p && ov('p', p.i);
      if (!o) continue;
      if (o.name && o.name !== p.name) { p.name = o.name; n++; }
      if (o.full && o.full !== p.fullName) { p.fullName = o.full; n++; }
    }
    return n > 0;
  });
  edit('markers', arr => {
    let n = 0;
    for (const m of arr) {
      const o = m && ov('m', m.i);
      if (o?.name && o.name !== m.name) { m.name = o.name; n++; }
      if (m?.type === 'party' && party && Number.isFinite(party.x)) {
        if (m.x !== party.x || m.y !== party.y) { m.x = party.x; m.y = party.y; if (Number.isInteger(party.cell)) m.cell = party.cell; n++; }
      }
    }
    return n > 0;
  });
  edit('religions', arr => {
    let n = 0;
    for (const r of arr) {
      const o = r && ov('r', r.i);
      if (!o) continue;
      for (const k of ['name', 'deity', 'form', 'type']) if (o[k] && o[k] !== r[k]) { r[k] = o[k]; n++; }
    }
    return n > 0;
  });
  edit('features', arr => {
    let n = 0;
    for (const f of arr) {
      const o = f && f.type === 'lake' && ov('l', f.i);
      if (o?.name && o.name !== f.name) { f.name = o.name; n++; }
    }
    return n > 0;
  });
  // Étiquettes d'États dans le SVG : le nom complet, comme Azgaar l'affiche.
  const labels = {};
  for (const [k, o] of Object.entries(entities)) if (k[0] === 's' && (o.full || o.name)) labels[k.slice(1)] = o.full || o.name;
  if (Object.keys(labels).length) {
    for (let i = parsed.svgStart; i <= parsed.svgEnd; i++) {
      if (!lines[i].includes('stateLabel')) continue;
      const next = lines[i].replace(/(<text id="stateLabel(\d+)"[^>]*>)([\s\S]*?)(<\/text>)/g, (m, open, id, inner, close) => {
        if (!labels[id]) return m;
        return open + relabel(inner, labels[id]) + close;
      });
      if (next !== lines[i]) { lines[i] = next; if (!touched.includes('labels')) touched.push('labels'); }
    }
  }
  return { text: lines.join(parsed.nl), touched };
}

// ---------------------------------------------------------------- Le service

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function clean(v, max) {
  return String(v ?? '').replace(/\r\n/g, '\n').slice(0, max);
}

// Un monde par campagne. Le stockage est fourni par l'appelant (voir worlds.js) :
//   mapFile()       chemin du .map d'Azgaar, ou null
//   image()         { ref, width, height } d'une simple image de carte, ou null
//   loadOverlay()   la couche de lore ; saveOverlay(o) l'enregistre
//   notes           { list(), read(rel), valid(rel) } : notes du coffre (pont de la campagne), ou null
//   beforeWrite()   appelé avant de réécrire le .map (pour garder la version précédente)
export function createWorld({ mapFile, image = () => null, loadOverlay, saveOverlay: storeOverlay, notes: vault = null, beforeWrite = () => {} }) {
  let cache = null; // { file, mtime, size, parsed, world, baseSvg, baseKey }

  function load() {
    const file = mapFile();
    if (!file || !fs.existsSync(file)) return null;
    const st = fs.statSync(file);
    if (cache && cache.file === file && cache.mtime === st.mtimeMs && cache.size === st.size) return cache;
    const parsed = parseMap(fs.readFileSync(file, 'utf8'));
    cache = { file, mtime: st.mtimeMs, size: st.size, parsed, world: extractWorld(parsed), baseSvg: null, baseKey: null };
    return cache;
  }

  function overlay() {
    const o = loadOverlay() || {};
    return { format: 1, entities: o.entities || {}, added: o.added || [], party: o.party || null, nextId: o.nextId || 1 };
  }
  function saveOverlay(o) { storeOverlay(o); }

  function stateLabelNames(o) {
    const out = {};
    for (const [k, e] of Object.entries(o.entities)) if (k[0] === 's' && (e.full || e.name)) out[k.slice(1)] = e.full || e.name;
    return out;
  }

  function baseSvg() {
    const c = load();
    if (!c) throw new WorldError(404, 'Aucune carte du monde : envoie un fichier .map d\'Azgaar ou une image');
    const o = overlay();
    const labels = stateLabelNames(o);
    const key = `${SVG_VERSION}|${c.mtime}|${JSON.stringify(labels)}`;
    if (c.baseKey !== key) { c.baseSvg = buildBaseSvg(c.parsed, labels); c.baseKey = key; }
    return { svg: c.baseSvg, etag: `"${Math.round(c.mtime).toString(36)}-${key.length.toString(36)}-${hash(key)}"` };
  }

  // Ce que voit un rôle : tout pour le MJ ; pour un joueur, les États et ce qui est « connu »,
  // sans notes du MJ ni lien vers le coffre.
  function view(role) {
    const c = load();
    const o = overlay();
    const dm = role === 'dm';
    const keep = x => dm || x.known;
    const added = o.added.map(a => {
      const out = { ...a, key: `a${a.id}`, i: a.id };
      if (!dm) { delete out.note; delete out.mj; }
      return out;
    }).filter(keep);
    const party = o.party && (dm || o.party.known) ? o.party : null;
    if (!c) {
      const img = image();
      if (!img) return { missing: true, role: dm ? 'dm' : 'player', vault: !!vault };
      // Une simple image : les lieux ajoutés et le groupe, sans les données d'Azgaar.
      return {
        role: dm ? 'dm' : 'player', mode: 'image', image: img.ref, name: '', width: img.width || 2000, height: img.height || 1500,
        burgs: [], provinces: [], markers: [], lakes: [], states: [], cultures: [], religions: [], added, party, vault: !!vault,
      };
    }
    const ent = (prefix, id) => o.entities[`${prefix}${id}`] || {};
    const merge = (prefix, x) => {
      const e = ent(prefix, x.i);
      const base = { ...x, key: `${prefix}${x.i}`, known: !!e.known, origName: x.name };
      if (e.name) base.name = e.name;
      if (e.full) base.full = e.full;
      if (e.kind) base.kind = e.kind;
      for (const k of ['deity', 'form', 'type']) if (e[k]) base[k] = e[k];
      if (dm) Object.assign(base, { note: e.note || '', mj: e.mj || '', pub: e.pub || '' });
      else if (e.pub) base.pub = e.pub;
      return base;
    };
    const w = c.world;
    const burgs = w.burgs.map(b => merge('b', b)).filter(keep);
    const provinces = w.provinces.map(p => merge('p', p)).filter(keep);
    const markers = w.markers.filter(m => m.type !== 'party').map(m => merge('m', m)).filter(keep);
    const lakes = w.lakes.map(l => merge('l', l)).filter(keep);
    const states = w.states.map(s => merge('s', s));
    const out = {
      role: dm ? 'dm' : 'player', mode: 'azgaar', name: w.name, year: w.year, era: w.era, width: w.width, height: w.height, distance: w.distance,
      burgs, provinces, markers, lakes, added, party, vault: !!vault,
      // Pour un joueur, un État inconnu ne montre que son nom, déjà écrit sur la carte.
      states: dm ? states : states.map(s => (s.known ? s : { i: s.i, key: s.key, name: s.name, full: s.full, color: s.color, known: false })),
      cultures: w.cultures,
      religions: w.religions.map(r => merge('r', r)).map(r => (dm ? r : { i: r.i, key: r.key, name: r.name, deity: r.deity })),
    };
    if (dm) Object.assign(out, { file: path.basename(c.file), version: w.version });
    return out;
  }

  function validNote(rel) {
    if (!rel) return '';
    if (!vault) throw new WorldError(400, 'Cette campagne n\'est pas reliée à un coffre Obsidian');
    const ok = vault.valid(rel);
    if (!ok) throw new WorldError(400, 'Note introuvable dans le coffre');
    return ok;
  }

  function patchEntity(key, patch) {
    if (!KEY_RE.test(String(key))) throw new WorldError(400, 'Élément inconnu');
    const o = overlay();
    if (key[0] === 'a') {
      const a = o.added.find(x => `a${x.id}` === key);
      if (!a) throw new WorldError(404, 'Lieu introuvable');
      applyPatch(a, patch, true);
    } else {
      const e = { ...(o.entities[key] || {}) };
      applyPatch(e, patch, false);
      if (Object.values(e).some(v => v !== '' && v !== false && v != null)) o.entities[key] = e;
      else delete o.entities[key];
    }
    saveOverlay(o);
    return { ok: true };
  }

  function applyPatch(e, patch, added) {
    for (const k of ['name', 'full', 'mj', 'pub', 'kind', 'deity', 'form', 'type']) {
      if (typeof patch[k] === 'string') {
        const v = clean(patch[k], MAX[k]).trim();
        if (v || !added || k !== 'name') e[k] = v;
        if (!v && !added) delete e[k];
      }
    }
    if ('note' in patch) { const n = validNote(patch.note); if (n) e.note = n; else delete e.note; }
    if ('known' in patch) { if (patch.known) e.known = true; else if (added) e.known = false; else delete e.known; }
    if (added) {
      if (Number.isFinite(patch.x)) e.x = patch.x;
      if (Number.isFinite(patch.y)) e.y = patch.y;
    }
  }

  function addPlace({ name, x, y, kind = 'lieu' }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new WorldError(400, 'Position invalide');
    const o = overlay();
    const id = o.nextId++;
    const a = { id, name: clean(name || 'Nouveau lieu', MAX.name).trim() || 'Nouveau lieu', kind: clean(kind, MAX.kind), x, y, known: false };
    o.added.push(a);
    saveOverlay(o);
    return { id, key: `a${id}` };
  }

  function removePlace(key) {
    const o = overlay();
    const n = o.added.length;
    o.added = o.added.filter(x => `a${x.id}` !== key);
    if (o.added.length === n) throw new WorldError(404, 'Lieu introuvable');
    saveOverlay(o);
    return { ok: true };
  }

  function setParty(p) {
    const o = overlay();
    if (p === null) o.party = null;
    else {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new WorldError(400, 'Position invalide');
      o.party = { x: p.x, y: p.y, known: p.known !== false, label: clean(p.label || 'Le groupe', 60) };
    }
    saveOverlay(o);
    return { ok: true };
  }

  // Les notes du coffre qu'on peut lier à un lieu : seulement par le pont de la campagne.
  function notes() {
    return vault ? vault.list() : [];
  }

  function note(rel) {
    const file = validNote(rel);
    return { file, text: vault.read(file) };
  }

  // Écrit les noms corrigés dans le .map, à sa place : Azgaar le rouvre avec ces noms.
  function writeMap() {
    const c = load();
    if (!c) throw new WorldError(404, 'Aucune carte du monde');
    const o = overlay();
    let party = null;
    if (o.party) {
      const near = c.parsed.data.burgs.filter(b => b && !b.removed && b.i)
        .map(b => ({ b, d: Math.hypot(b.x - o.party.x, b.y - o.party.y) })).sort((a, b) => a.d - b.d)[0];
      party = { x: Math.round(o.party.x * 100) / 100, y: Math.round(o.party.y * 100) / 100, cell: near?.b.cell };
    }
    const { text, touched } = applyNames(c.parsed, o.entities, party);
    if (!touched.length) return { file: path.basename(c.file), touched };
    beforeWrite(c.file);
    writeAtomic(c.file, text);
    cache = null;
    return { file: path.basename(c.file), touched };
  }

  function reset() { cache = null; }

  return { load, view, baseSvg, patchEntity, addPlace, removePlace, setParty, notes, note, writeMap, mapFile, reset };
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
