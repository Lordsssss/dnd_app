// Atlas : la carte du monde et les autres cartes de la campagne — une ville, une région — dans une
// même page, avec un panneau pour passer de l'une à l'autre. Les lieux sont posés par-dessus, une
// fiche par lieu. Le MJ voit tout et corrige le lore ; un joueur ne voit que ce que le groupe connaît.
import { t, tx, setLang } from '/shared/i18n.js';
import { html, render, useEffect, useMemo, useRef, useState } from '/app/html.js';
import { renderMarkdown } from './markdown.js';

// ---------------------------------------------------------------- Accès

const token = () => { try { return JSON.parse(localStorage.getItem('token')); } catch { return null; } };
// L'adresse : /c/<campagne>/cartes/<carte>, ou /c/<campagne>/monde pour la carte du monde.
const ROUTE = /^\/c\/([\w-]+)\/(monde|cartes)(?:\/([\w-]+))?/.exec(location.pathname) || [];
const CID = ROUTE[1] || '';
// La carte du monde garde son adresse d'API ; les autres sont dans l'atlas.
const WORLD = 'monde';
const W = path => (S.src === WORLD ? `/api/c/${CID}/monde${path}` : `/api/c/${CID}/atlas/${S.src}${path}`);
// Vue joueur du MJ : ?as=<compte> ; le serveur rend les cartes telles que ce joueur les voit.
const AS = new URLSearchParams(location.search).get('as') || null;
const fileUrl = ref => `/api/file?ref=${encodeURIComponent(ref)}`;

async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    headers: { ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(AS ? { 'X-View-As': AS } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) { const e = new Error(data?.error || `Erreur ${res.status}`); e.status = res.status; throw e; }
  return data;
}

// Le thème clair ou sombre choisi sur la page des fiches.
try { const th = String(localStorage.getItem('theme') || '').replace(/"/g, ''); if (th && th !== 'null') document.documentElement.setAttribute('data-theme', th); } catch { /* stockage indisponible */ }

// La langue choisie sur la page des fiches.
try { setLang(JSON.parse(localStorage.getItem('lang')) || 'fr'); } catch { /* stockage indisponible */ }

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};

const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const narrow = () => window.innerWidth <= 760;

// Le texte pour les joueurs : du Markdown léger, une ligne seule faisant un paragraphe.
const md = s => renderMarkdown(String(s || '').replace(/([^\n])\n(?!\n|\s*([-*]|\d+\.)\s)/g, '$1\n\n'));

// ---------------------------------------------------------------- Vocabulaire

const GROUPS = {
  capital: 'Capitale', city: 'Ville', town: 'Bourg', village: 'Village', hamlet: 'Hameau', fort: 'Fort',
  monastery: 'Monastère', caravanserai: 'Caravansérail', trading_post: 'Comptoir',
};
// À partir de quel zoom un bourg apparaît (1 = carte entière), comme les groupes d'Azgaar.
const MIN_ZOOM = { capital: 0, city: 1.2, town: 1.6, fort: 2, monastery: 2, caravanserai: 2, trading_post: 2, village: 2.5, hamlet: 3 };
// Le nom vient un peu plus tard que le point, pour que la carte reste lisible.
const LABEL_FACTOR = 1.5;
const ICON_PX = { capital: 8, city: 6.5, town: 5, village: 4, hamlet: 3.5 };
const FONT_PX = { capital: 14, city: 12.5, town: 11.5 };
const FEATURES = [['port', 'Port'], ['walls', 'Remparts'], ['citadel', 'Citadelle'], ['plaza', 'Marché'], ['temple', 'Temple'], ['shanty', 'Bidonville']];
const LAYERS = [
  ['regions', 'États', true], ['provs', 'Provinces', false], ['borders', 'Frontières', true],
  ['routes', 'Routes', true], ['rivers', 'Rivières', true], ['labels', 'Noms des États', true],
  ['places', 'Lieux', true], ['markers', 'Marqueurs', true],
];
const fmtInt = n => n.toLocaleString('fr-CA');

// ---------------------------------------------------------------- État de la page

const S = {
  data: null, svg: null, error: null, view: null, size: { w: 1, h: 1 },
  sel: null, layers: Object.fromEntries(LAYERS.map(([k, , d]) => [k, LS.get(`world.layer.${k}`, d)])),
  mode: null, draft: null, playerView: false, notes: null, toasts: [], upload: false,
  // L'atlas : la liste des cartes, celle qui est ouverte, sa version chargée.
  list: null, src: null, loadedV: null, side: LS.get('atlas.side', true), newMap: false,
  labelStep: LS.get('atlas.labels', typeof window !== 'undefined' && window.innerWidth <= 760 ? 1 : 2),
};
// Le SVG du monde est lourd : gardé quand on passe à une autre carte.
let worldSvg = null;
const subs = new Set();
let queued = false;
function refresh() {
  if (queued) return;
  queued = true;
  // Pas requestAnimationFrame : un onglet en arrière-plan ne se redessinerait jamais.
  queueMicrotask(() => { queued = false; for (const f of subs) f(); });
}
function useWorld() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force(x => x + 1); subs.add(f); return () => subs.delete(f); }, []);
}
function toast(text, kind = 'info') {
  const item = { id: Math.random(), text: tx(text), kind };
  S.toasts = [...S.toasts, item];
  refresh();
  setTimeout(() => { S.toasts = S.toasts.filter(x => x !== item); refresh(); }, 4000);
}

const isDm = () => S.data?.role === 'dm' && !S.playerView;
const dmList = () => S.list?.role === 'dm' && !AS;
const isAtlas = () => !!S.data?.atlas;
const shown = x => !S.playerView || x.known;
const viewKey = () => (S.src === WORLD ? `world.view:${CID}` : `atlas.view:${CID}:${S.src}`);
const versionOf = src => (src === WORLD ? S.list?.world?.v ?? null : S.list?.maps.find(m => m.id === src)?.v ?? null);
const mapName = () => (S.src === WORLD ? S.data?.name || tx('Carte du monde') : S.list?.maps.find(m => m.id === S.src)?.name || S.data?.name || '');

// ---------------------------------------------------------------- Chargement

async function loadList() {
  try {
    S.list = await api(`/api/c/${CID}/atlas`);
  } catch (e) {
    S.error = e.status === 401 || e.status === 403 ? 'login' : e.message;
  }
  refresh();
}

// La carte à ouvrir : celle de l'adresse, sinon la dernière ouverte, sinon le monde.
function firstSrc() {
  const l = S.list;
  if (!l) return null;
  const ok = src => (src === WORLD ? !!l.world : l.maps.some(m => m.id === src));
  for (const want of [ROUTE[2] === 'monde' ? WORLD : ROUTE[3], LS.get(`atlas.last:${CID}`, null)]) if (want && ok(want)) return want;
  if (l.world?.exists) return WORLD;
  if (l.maps.length) return l.maps[0].id;
  return l.world ? WORLD : null;
}

function openMap(src) {
  if (narrow()) S.side = false;
  if (src === S.src) { refresh(); return; }
  Object.assign(S, { src, data: null, view: null, sel: null, mode: null, draft: null, upload: false, newMap: false, svg: src === WORLD ? worldSvg : null });
  if (src) {
    LS.set(`atlas.last:${CID}`, src);
    const url = `/c/${CID}/cartes/${src}${location.search}`;
    if (location.pathname + location.search !== url) history.replaceState(null, '', url);
  }
  refresh();
  if (src) load();
}

async function load() {
  const src = S.src;
  if (!src) return;
  try {
    const data = await api(W(''));
    if (src !== S.src) return;
    const svg = data.mode === 'azgaar' && !S.svg ? await api(W('/svg')) : null;
    if (src !== S.src) return;
    S.data = data;
    if (svg) { S.svg = svg; worldSvg = svg; }
    if (data.mode === 'image') S.svg = null;
    S.error = null;
    S.loadedV = data.v ?? versionOf(src);
    if (!S.view && data && !data.missing) {
      const saved = LS.get(viewKey(), null);
      S.view = saved && S.size.w > 1 ? clampView(saved, data) : saved || fullView(data);
    }
    if (S.sel && S.sel !== 'party' && !entities().has(S.sel)) S.sel = null;
    document.title = `${mapName()} · ${tx('Atlas')}`;
  } catch (e) {
    if (src !== S.src) return;
    // Une carte retirée, ou cachée de nouveau aux joueurs : on passe à une autre.
    if (e.status === 404 && src !== WORLD) {
      await loadList();
      const next = firstSrc();
      openMap(next && next !== src ? next : null);
      return;
    }
    S.error = e.status === 401 || e.status === 403 ? 'login' : e.message;
  }
  refresh();
}

async function reloadSvg() {
  S.svg = S.data?.mode === 'azgaar' ? await api(W('/svg')) : null;
  if (S.svg) worldSvg = S.svg;
  refresh();
}

// Les joueurs voient les révélations du MJ sans recharger : la liste porte la version de chaque
// carte, la carte ouverte se recharge quand la sienne change.
async function poll() {
  if (document.hidden || !S.list || S.error) return;
  let l;
  try { l = await api(`/api/c/${CID}/atlas`); } catch { return; }
  S.list = l;
  if (S.src && S.src !== WORLD && !l.maps.some(m => m.id === S.src)) { openMap(firstSrc()); return; }
  if (!S.src) { const next = firstSrc(); if (next) openMap(next); }
  else if (S.data && !S.mode && versionOf(S.src) != null && versionOf(S.src) !== S.loadedV) await load();
  refresh();
}

// Les éléments cliquables, quel que soit leur genre, par leur clé (b456, p26, s9…).
function entities() {
  const d = S.data;
  if (!d) return new Map();
  const m = new Map();
  for (const list of [d.burgs, d.provinces, d.states, d.markers, d.lakes, d.added]) for (const x of list || []) m.set(x.key, x);
  return m;
}

function kindOf(key) {
  return { b: 'burg', p: 'province', s: 'state', m: 'marker', l: 'lake', a: 'added' }[key?.[0]] || null;
}

// ---------------------------------------------------------------- Vue : déplacement et zoom

// Toute la carte, centrée, quel que soit le format de l'écran.
function fullView(d = S.data) {
  const r = S.size.h / S.size.w;
  const w = Math.max(d.width, d.height / r);
  return { x: (d.width - w) / 2, y: (d.height - w * r) / 2, w, h: w * r };
}

function fitAspect(v) {
  const r = S.size.h / S.size.w;
  return { ...v, h: v.w * r };
}
// La vue reste sur la carte : au plus loin, toute la carte, centrée ; sur un axe où la carte
// est plus petite que l'écran, elle reste au milieu ; sinon ses bords ne quittent pas l'écran.
function clampView(v, d = S.data) {
  const full = fullView(d);
  const w = Math.max(d.width / 40, Math.min(full.w, v.w));
  const h = w * (S.size.h / S.size.w);
  const fit = (pos, span, total) => (span >= total ? (total - span) / 2 : Math.max(0, Math.min(total - span, pos)));
  return { x: fit(v.x, w, d.width), y: fit(v.y, h, d.height), w, h };
}
function setView(v) {
  S.view = clampView(v);
  LS.set(viewKey(), S.view);
  applyBaseView();
  refresh();
}
function zoom() { return S.data.width / S.view.w; }
function toMap(px, py) {
  const k = S.view.w / S.size.w;
  return { x: S.view.x + px * k, y: S.view.y + py * k };
}
let baseSvgEl = null;
function applyBaseView() {
  if (baseSvgEl && S.view) baseSvgEl.setAttribute('viewBox', `${S.view.x} ${S.view.y} ${S.view.w} ${S.view.h}`);
}
function centerOn(x, y, z = Math.max(zoom(), 5)) {
  const w = S.data.width / z;
  const h = w * (S.size.h / S.size.w);
  setView({ x: x - w / 2, y: y - h / 2, w });
}
function posOf(e) {
  if (!e) return null;
  if (Number.isFinite(e.x)) return { x: e.x, y: e.y };
  const d = S.data;
  if (e.key?.[0] === 'p' && e.burg) { const b = d.burgs.find(x => x.i === e.burg); if (b) return b; }
  if (e.key?.[0] === 's' && e.capital) { const b = d.burgs.find(x => x.i === e.capital); if (b) return b; }
  return null;
}

// ---------------------------------------------------------------- Calque des lieux

const polyPath = pts => `M${pts.map(p => `${p[0]},${p[1]}`).join(' L')} Z`;

// La taille des noms sur la carte, réglable (A− / A+) et gardée par appareil : une télé, un
// téléphone et un portable ne lisent pas à la même distance.
const LABEL_STEPS = [0.85, 1, 1.2, 1.45, 1.75];
const labelScale = () => LABEL_STEPS[S.labelStep] ?? 1;
const measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
const widths = new Map();
const CHIP_FONT = 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
function textWidth(text, px) {
  const key = `${px}|${text}`;
  if (!widths.has(key)) {
    measureCtx.font = `600 ${px}px ${CHIP_FONT}`;
    widths.set(key, measureCtx.measureText(text).width);
  }
  return widths.get(key);
}

// Une étiquette lisible sur n'importe quel fond : texte clair sur une pastille sombre, à taille
// fixe à l'écran. Cachée aux joueurs : pastille claire, bord pointillé, et le mot « caché ».
function chipSize(name, hidden, k) {
  const sc = labelScale();
  const px = 15 * sc;
  const padX = 8 * sc;
  const tag = hidden ? ` · ${tx('caché')}` : '';
  return { w: (textWidth(name + tag, px) + padX * 2) * k, h: 25 * sc * k, px, padX, tag };
}
function chip(left, cy, name, k, { hidden = false, sel = false } = {}) {
  const { w, h, px, padX, tag } = chipSize(name, hidden, k);
  return html`<g class=${`w-chip ${hidden ? 'hidden' : ''} ${sel ? 'sel' : ''}`}>
    <rect x=${left} y=${cy - h / 2} width=${w} height=${h} rx=${7 * k} stroke-width=${1.5 * k}
      stroke-dasharray=${hidden ? `${5 * k} ${3 * k}` : null} />
    <text x=${left + padX * k} y=${cy + px * 0.36 * k} font-size=${px * k}>${name}${tag ? html`<tspan class="w-chip-tag">${tag}</tspan>` : null}</text>
  </g>`;
}

// Où poser le nom d'un point sans recouvrir un autre nom ni un autre point : à droite, à gauche,
// au-dessus, en dessous… Le premier endroit libre gagne ; sans place, le nom attend qu'on zoome.
function placeLabels(pins, zones, k) {
  const boxes = [];
  const v = S.view;
  const inView = b => b.x0 >= v.x && b.x1 <= v.x + v.w && b.y0 >= v.y && b.y1 <= v.y + v.h;
  const free = b => inView(b) && !boxes.some(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  const out = new Map();
  for (const a of pins) boxes.push({ x0: a.x - a.r, y0: a.y - a.r, x1: a.x + a.r, y1: a.y + a.r });
  for (const z of zones) {
    const { w, h } = chipSize(z.name, !z.known, k);
    const b = { x0: z.x - w / 2, y0: z.y - h / 2, x1: z.x + w / 2, y1: z.y + h / 2 };
    boxes.push(b);
    out.set(z.key, { left: b.x0, cy: z.y });
  }
  const g = 5 * k;
  const order = [...pins].sort((p, q) => (q.key === S.sel) - (p.key === S.sel) || (q.known - p.known) || (Number(p.num) || 999) - (Number(q.num) || 999));
  for (const a of order) {
    const { w, h } = chipSize(a.name, !a.known, k);
    const { x, y, r } = a;
    const spots = [
      [x + r + g, y], [x - r - g - w, y],
      [x - w / 2, y - r - g - h / 2], [x - w / 2, y + r + g + h / 2],
      [x + r * 0.7, y - r - h / 2], [x + r * 0.7, y + r + h / 2],
      [x - r * 0.7 - w, y - r - h / 2], [x - r * 0.7 - w, y + r + h / 2],
      [x + r + g, y - h - g], [x + r + g, y + h + g], [x - r - g - w, y - h - g], [x - r - g - w, y + h + g],
    ];
    let pick = null;
    for (const [left, cy] of spots) {
      const b = { x0: left, y0: cy - h / 2, x1: left + w, y1: cy + h / 2 };
      if (free(b)) { pick = { left, cy, b }; break; }
    }
    if (!pick && a.key === S.sel) pick = { left: spots[0][0], cy: y, b: { x0: spots[0][0], y0: y - h / 2, x1: spots[0][0] + w, y1: y + h / 2 } };
    if (!pick) continue;
    boxes.push(pick.b);
    out.set(a.key, { left: pick.left, cy: pick.cy });
  }
  return out;
}

// Les lieux d'une carte de l'atlas : les zones d'abord (un quartier, une forêt), cliquables sur
// toute leur surface, puis les points par-dessus, numérotés ou en losange, puis leurs noms.
function atlasItems(k) {
  const d = S.data;
  const sel = S.sel;
  const sc = labelScale();
  const items = [];
  const list = d.added.filter(shown);
  const zones = list.filter(x => x.shape);
  const pins = list.filter(x => !x.shape).map(a => ({ ...a, r: 11 * sc * k }));
  const named = zones.filter(a => a.label !== false || !a.known || sel === a.key);
  const spots = placeLabels(pins.filter(a => a.label !== false || a.key === sel), named, k);
  for (const a of zones) {
    items.push(html`<g key=${a.key} class=${`w-area ${a.known ? 'known' : 'hidden'} ${sel === a.key ? 'sel' : ''}`} data-key=${a.key}>
      <title>${a.name}</title>
      ${a.shape.map((poly, i) => html`<path key=${i} d=${polyPath(poly)} stroke-width=${(a.known ? 2.5 : 3) * k} stroke-dasharray=${a.known ? null : `${9 * k} ${6 * k}`} />`)}
    </g>`);
  }
  for (const a of pins) {
    const { r } = a;
    const num = String(a.num || '');
    items.push(html`<g key=${a.key} class=${`w-pin ${a.known ? 'known' : 'hidden'} ${num ? 'num' : ''} ${sel === a.key ? 'sel' : ''}`} data-key=${a.key}>
      <title>${a.name}</title>
      ${num
        ? html`<circle cx=${a.x} cy=${a.y} r=${r} stroke-width=${2.2 * k} stroke-dasharray=${a.known ? null : `${4 * k} ${3 * k}`} />
          <text class="w-pin-num" x=${a.x} y=${a.y + (num.length > 2 ? 3.6 : 4.6) * sc * k} font-size=${(num.length > 2 ? 10 : 13) * sc * k}>${num}</text>`
        : html`<path d=${`M${a.x},${a.y - r} L${a.x + r},${a.y} L${a.x},${a.y + r} L${a.x - r},${a.y} Z`} stroke-width=${2 * k} stroke-dasharray=${a.known ? null : `${4 * k} ${3 * k}`} />`}
    </g>`);
  }
  // Les noms par-dessus tout, chacun cliquable comme son lieu.
  for (const a of [...named, ...pins]) {
    const at = spots.get(a.key);
    if (!at) continue;
    items.push(html`<g key=${`n-${a.key}`} class="w-name" data-key=${a.key}>${chip(at.left, at.cy, a.name, k, { hidden: !a.known, sel: sel === a.key })}</g>`);
  }
  // La zone en cours de tracé.
  if (S.draft?.length) {
    const pts = S.draft;
    items.push(html`<g key="draft" class="w-draft">
      <polyline points=${pts.map(p => p.join(',')).join(' ')} stroke-width=${2 * k} />
      ${pts.map((p, i) => html`<circle key=${i} cx=${p[0]} cy=${p[1]} r=${(i === 0 ? 6 : 4) * k} stroke-width=${1.5 * k} />`)}
    </g>`);
  }
  return items;
}

function Overlay() {
  const d = S.data;
  const v = S.view;
  const k = v.w / S.size.w; // unités de carte par pixel d'écran
  const z = zoom();
  const pad = 40 * k;
  const inView = p => p.x >= v.x - pad && p.x <= v.x + v.w + pad && p.y >= v.y - pad && p.y <= v.y + v.h + pad;
  const sel = S.sel;
  const items = [];

  if (isAtlas()) items.push(...atlasItems(k));
  else if (S.layers.places) {
    for (const b of d.burgs) {
      if (!shown(b) || !inView(b)) continue;
      const g = b.group in MIN_ZOOM ? b.group : 'town';
      // Un lieu connu des joueurs, ou sélectionné, se voit à tout zoom.
      if (z < (MIN_ZOOM[g] ?? 3) && !b.known && sel !== b.key && !(g === 'capital')) continue;
      const r = (ICON_PX[g] || 3.5) * k * (b.known && isDm() ? 1.1 : 1);
      const fs = (FONT_PX[g] || 10.5) * k * labelScale();
      const showLabel = g === 'capital' || z >= (MIN_ZOOM[g] ?? 3) * LABEL_FACTOR || b.known || sel === b.key;
      items.push(html`<g key=${b.key} class=${`w-burg g-${g} ${b.known ? 'known' : ''} ${sel === b.key ? 'sel' : ''}`} data-key=${b.key}>
        ${g === 'capital'
          ? html`<rect x=${b.x - r} y=${b.y - r} width=${r * 2} height=${r * 2} stroke-width=${1.4 * k} />`
          : html`<circle cx=${b.x} cy=${b.y} r=${r} stroke-width=${1.2 * k} />`}
        ${showLabel ? html`<text x=${b.x} y=${b.y - r - 3 * k} font-size=${fs} stroke-width=${3 * k}>${b.name}</text>` : null}
      </g>`);
    }
    for (const l of d.lakes) {
      if (!shown(l) || !inView(l) || (z < 1.5 && !l.known && sel !== l.key)) continue;
      items.push(html`<g key=${l.key} class=${`w-lake ${sel === l.key ? 'sel' : ''}`} data-key=${l.key}>
        <text x=${l.x} y=${l.y} font-size=${11 * k * labelScale()} stroke-width=${3 * k}>${l.name}</text>
      </g>`);
    }
    for (const a of d.added) {
      if (!shown(a) || !inView(a)) continue;
      if (z < 2.5 && sel !== a.key && S.data.mode !== 'image') continue;
      const r = 6 * k;
      items.push(html`<g key=${a.key} class=${`w-added ${a.known ? 'known' : ''} ${sel === a.key ? 'sel' : ''}`} data-key=${a.key}>
        <path d=${`M${a.x},${a.y - r} L${a.x + r},${a.y} L${a.x},${a.y + r} L${a.x - r},${a.y} Z`} stroke-width=${1.4 * k} />
        <text x=${a.x} y=${a.y - r - 3 * k} font-size=${12 * k * labelScale()} stroke-width=${3 * k}>${a.name}</text>
      </g>`);
    }
  }
  if (S.layers.markers && !isAtlas()) {
    for (const m of d.markers) {
      if (!shown(m) || !inView(m)) continue;
      if (z < 2.5 && !m.known && sel !== m.key) continue;
      items.push(html`<g key=${m.key} class=${`w-marker ${sel === m.key ? 'sel' : ''}`} data-key=${m.key}>
        <circle cx=${m.x} cy=${m.y} r=${9 * k} stroke-width=${1.2 * k} />
        <text x=${m.x} y=${m.y + 4.2 * k} font-size=${12 * k}>${m.icon}</text>
      </g>`);
    }
  }
  if (d.party && (!S.playerView || d.party.known !== false)) {
    const p = d.party;
    items.push(html`<g key="party" class=${`w-party ${sel === 'party' ? 'sel' : ''}`} data-key="party">
      <path d=${`M${p.x},${p.y} l${-7 * k},${-16 * k} a${8 * k},${8 * k} 0 1 1 ${14 * k},0 z`} stroke-width=${1.5 * k} />
      <text x=${p.x} y=${p.y - 13.5 * k} font-size=${10 * k}>⚑</text>
    </g>`);
  }
  return html`<svg class="w-over" viewBox=${`${v.x} ${v.y} ${v.w} ${v.h}`} preserveAspectRatio="xMidYMid meet">${items}</svg>`;
}

// ---------------------------------------------------------------- Scène

const BANNERS = {
  add: 'Clique sur la carte pour placer le nouveau lieu.',
  party: 'Clique sur la carte pour placer le groupe.',
  move: 'Clique sur la nouvelle position du lieu.',
  zone: 'Clique les coins de la zone, puis sur le premier point ou Entrée pour finir. Retour arrière retire le dernier point.',
};

function Stage() {
  const stage = useRef(null);
  const base = useRef(null);

  useEffect(() => {
    if (!base.current) return;
    base.current.innerHTML = S.svg || '';
    baseSvgEl = S.svg ? base.current.querySelector('svg') : null;
    if (baseSvgEl) { baseSvgEl.removeAttribute('width'); baseSvgEl.removeAttribute('height'); }
    applyBaseView();
    applyLayers();
  }, [S.svg]);

  useEffect(() => {
    const el = stage.current;
    // La scène change de taille (fiche ouverte, panneau, fenêtre) : même zoom, même centre.
    const fit = () => {
      const r = el.getBoundingClientRect();
      const prev = S.size;
      const first = prev.w === 1;
      S.size = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
      if (S.view) {
        if (first) S.view = LS.get(viewKey(), null) ? clampView(S.view) : fullView();
        else if (prev.w !== S.size.w || prev.h !== S.size.h) {
          const k = S.view.w / prev.w;
          const cx = S.view.x + S.view.w / 2;
          const cy = S.view.y + S.view.h / 2;
          const w = k * S.size.w;
          const h = w * (S.size.h / S.size.w);
          S.view = clampView({ x: cx - w / 2, y: cy - h / 2, w, h });
        } else S.view = clampView(S.view);
        applyBaseView();
      }
      refresh();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();

    const pointers = new Map();
    let drag = null;
    let pinch = null;
    const local = e => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = e => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), view: { ...S.view }, mid: toMap((a.x + b.x) / 2, (a.y + b.y) / 2) };
        drag = null;
      } else drag = { start: local(e), view: { ...S.view }, moved: false };
    };
    const move = e => {
      if (!pointers.has(e.pointerId) || !S.view) return;
      pointers.set(e.pointerId, local(e));
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const f = pinch.dist / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const w = pinch.view.w * f;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        setView({ x: pinch.mid.x - (mx / S.size.w) * w, y: pinch.mid.y - (my / S.size.w) * w, w });
        return;
      }
      if (!drag) return;
      const p = local(e);
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      el.classList.add('panning');
      const k = drag.view.w / S.size.w;
      setView({ x: drag.view.x - dx * k, y: drag.view.y - dy * k, w: drag.view.w });
    };
    const up = e => {
      pointers.delete(e.pointerId);
      el.classList.remove('panning');
      if (pointers.size < 2) pinch = null;
      if (drag && !drag.moved && S.view) click(e, local(e));
      drag = null;
    };
    const wheel = e => {
      e.preventDefault();
      if (!S.view) return;
      const p = local(e);
      const at = toMap(p.x, p.y);
      const f = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      const w = S.view.w * f;
      setView({ x: at.x - (p.x / S.size.w) * w, y: at.y - (p.y / S.size.w) * w, w });
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, []);

  const banner = S.mode && (BANNERS[S.mode] || BANNERS[S.mode.split(':')[0] === 'reshape' ? 'zone' : 'move']);
  const zoning = S.mode === 'zone' || S.mode?.startsWith('reshape:');
  return html`<div class=${`w-stage ${S.mode ? `mode-${S.mode.split(':')[0]}` : ''} ${isAtlas() ? 'atlas' : ''}`} ref=${stage}>
    <div class="w-base" ref=${base}></div>
    ${S.data?.mode === 'image' && S.view ? html`<svg class="w-img" viewBox=${`${S.view.x} ${S.view.y} ${S.view.w} ${S.view.h}`} preserveAspectRatio="xMidYMid meet">
      <image href=${fileUrl(S.data.image)} x="0" y="0" width=${S.data.width} height=${S.data.height} />
    </svg>` : null}
    ${S.view && S.data ? html`<${Overlay} />` : null}
    ${banner ? html`<div class="w-banner">${banner}
      ${zoning ? html`<button type="button" class="btn tiny" disabled=${(S.draft?.length || 0) < 3} onClick=${finishZone}>Terminer</button>` : null}
      <button type="button" class="btn tiny" onClick=${cancelMode}>Annuler</button></div>` : null}
    <${Scale} />
  </div>`;
}

function Scale() {
  if (!S.view || !S.data || !S.data.distance) return null;
  const k = S.view.w / S.size.w; // unités de carte par pixel
  const unitsPerMile = 1 / (S.data.distance.scale || 1);
  const target = 120 * k / unitsPerMile; // milles pour ~120 px
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  const miles = steps.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), steps[0]);
  const px = (miles * unitsPerMile) / k;
  return html`<div class="w-scale"><span style=${{ width: `${px}px` }}></span>${miles} ${S.data.distance.unit === 'mi' ? 'milles' : S.data.distance.unit}</div>`;
}

function applyLayers() {
  if (!baseSvgEl) return;
  for (const [id, , def] of LAYERS) {
    const g = baseSvgEl.querySelector(`#${id}`);
    if (!g) continue;
    const on = S.layers[id] ?? def;
    // Les provinces restent cliquables même masquées : on les rend transparentes.
    if (id === 'provs') { g.style.opacity = on ? '1' : '0'; g.style.display = ''; } else g.style.display = on ? '' : 'none';
    if (id === 'provs') {
      const pb = baseSvgEl.querySelector('#provinceBorders');
      if (pb) pb.style.display = on ? '' : 'none';
    }
  }
}

function cancelMode() { S.mode = null; S.draft = null; refresh(); }

// Une zone tracée : nouvelle, ou la nouvelle forme d'une zone existante.
async function finishZone() {
  const pts = S.draft || [];
  const mode = S.mode;
  if (pts.length < 3) { toast('Une zone demande au moins trois points.', 'error'); return; }
  S.mode = null; S.draft = null;
  if (mode === 'zone') {
    const name = prompt(tx('Nom de la zone'), tx('Nouvelle zone'));
    if (!name) { refresh(); return; }
    try { const r = await api(W('/place'), { method: 'POST', body: { name, shape: pts } }); await load(); select(r.key); } catch (x) { toast(x.message, 'error'); }
    return;
  }
  if (mode?.startsWith('reshape:')) await save(mode.slice(8), { shape: pts });
  refresh();
}

async function click(e, p) {
  const at = toMap(p.x, p.y);
  if (S.mode === 'zone' || S.mode?.startsWith('reshape:')) {
    const pts = S.draft || [];
    const k = S.view.w / S.size.w;
    if (pts.length >= 3 && Math.hypot(at.x - pts[0][0], at.y - pts[0][1]) < 12 * k) { await finishZone(); return; }
    S.draft = [...pts, [round2(at.x), round2(at.y)]];
    refresh();
    return;
  }
  if (S.mode === 'add') {
    S.mode = null;
    const name = prompt(tx('Nom du nouveau lieu'), tx('Nouveau lieu'));
    if (!name) { refresh(); return; }
    try { const r = await api(W('/place'), { method: 'POST', body: { name, x: round2(at.x), y: round2(at.y) } }); await load(); select(r.key); } catch (x) { toast(x.message, 'error'); }
    return;
  }
  if (S.mode === 'party') {
    S.mode = null;
    try { await api(W('/party'), { method: 'POST', body: { x: round2(at.x), y: round2(at.y), known: S.data.party?.known !== false } }); await load(); select('party'); } catch (x) { toast(x.message, 'error'); }
    return;
  }
  if (S.mode?.startsWith('move:')) {
    const key = S.mode.slice(5);
    S.mode = null;
    await save(key, { x: round2(at.x), y: round2(at.y) });
    return;
  }
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const hit = el?.closest('[data-key]');
  if (hit) { select(hit.dataset.key); return; }
  if (isAtlas()) { select(null); return; }
  const prov = el?.closest('[id^="province"]');
  const pid = prov && /^province(\d+)$/.exec(prov.id)?.[1];
  const known = entities();
  if (pid && known.has(`p${pid}`) && shown(known.get(`p${pid}`))) { select(`p${pid}`); return; }
  // Une province inconnue des joueurs : on montre l'État dont elle fait partie.
  const stateEl = el?.closest('[id^="state"]');
  let sid = stateEl && /^state(\d+)$/.exec(stateEl.id)?.[1];
  if (!sid && pid) sid = S.data.provinces.find(x => String(x.i) === pid)?.state;
  if (!sid && pid && S.data.role !== 'dm') {
    const b = S.data.burgs.find(x => String(x.province) === pid);
    sid = b?.state;
  }
  if (sid && known.has(`s${sid}`) && Number(sid) !== 0) { select(`s${sid}`); return; }
  select(null);
}

const round2 = n => Math.round(n * 100) / 100;

function select(key) {
  S.sel = key;
  refresh();
}

async function save(key, patch) {
  try {
    if (key === 'party') await api(W('/party'), { method: 'POST', body: { ...S.data.party, ...patch } });
    else await api(W('/entity'), { method: 'POST', body: { key, patch } });
    await load();
    if (patch.full !== undefined || patch.name !== undefined) { if (key[0] === 's' && !isAtlas()) await reloadSvg(); }
  } catch (x) { toast(x.message, 'error'); }
}

async function uploadImage(file, kind, folder) {
  return api(`/api/c/${CID}/assets?kind=${kind}&name=${encodeURIComponent(file.name)}&folder=${encodeURIComponent(folder)}`, { method: 'POST', raw: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
}

// ---------------------------------------------------------------- Fiche d'un lieu

function Field({ label, value, onSave, multiline = false, placeholder = '', list, rows = 4 }) {
  const [v, setV] = useState(value || '');
  useEffect(() => { setV(value || ''); }, [value]);
  const commit = () => { if ((v || '') !== (value || '')) onSave(v); };
  return html`<label class="w-field">${label}
    ${multiline
      ? html`<textarea class="txt" rows=${rows} placeholder=${placeholder} value=${v} onInput=${e => setV(e.target.value)} onBlur=${commit}></textarea>`
      : html`<input class="txt" placeholder=${placeholder} value=${v} list=${list} onInput=${e => setV(e.target.value)} onBlur=${commit} onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />`}
  </label>`;
}

function NoteView({ file }) {
  const [text, setText] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setText(null);
    setErr('');
    api(`/api/c/${CID}/monde/note?file=${encodeURIComponent(file)}`).then(r => setText(r.text)).catch(e => setErr(e.message));
  }, [file]);
  if (err) return html`<p class="warn small">${err}</p>`;
  if (text == null) return html`<p class="muted small">Chargement de la note…</p>`;
  return html`<div class="w-note md" dangerouslySetInnerHTML=${{ __html: renderMarkdown(text) }}></div>`;
}

const link = (key, label) => html`<button type="button" class="linkish" onClick=${() => { const e = entities().get(key); select(key); const p = posOf(e); if (p) centerOn(p.x, p.y); }}>${label}</button>`;

// Ce que le joueur lit sur la fiche : l'image, le texte, les infos révélées. Le MJ voit la même
// chose dans l'encadré « Ce que voient les joueurs ».
function PlayerBody({ e }) {
  const facts = (e.facts || []).filter(f => f.known !== false && f.text);
  const empty = !e.pub && !facts.length && !e.image;
  return html`
    ${e.image ? html`<a class="w-pimg" href=${fileUrl(e.image)} target="_blank" rel="noopener"><img src=${fileUrl(e.image)} alt="" /></a>` : null}
    ${e.pub ? html`<div class="w-pub md" dangerouslySetInnerHTML=${{ __html: md(e.pub) }}></div>` : null}
    ${facts.length ? html`<ul class="w-facts-list">${facts.map(f => html`<li key=${f.id} class="md" dangerouslySetInnerHTML=${{ __html: md(f.text) }}></li>`)}</ul>` : null}
    ${empty ? html`<p class="muted small">Le groupe n'en sait pas plus.</p>` : null}`;
}

// Un interrupteur qu'on lit d'un coup d'œil : allumé, vert plein ; éteint, pointillé gris. Le mot
// est toujours écrit, la couleur ne fait que le confirmer.
function Switch({ on, onClick, onLabel, offLabel, title, small = false }) {
  return html`<button type="button" class=${`w-switch ${on ? 'on' : 'off'} ${small ? 'small' : ''}`} aria-pressed=${on ? 'true' : 'false'} title=${title} onClick=${onClick}>
    <span class="w-switch-dot"></span><span>${on ? onLabel : offLabel}</span>
  </button>`;
}

function PlayerPreview({ e, kind }) {
  if (kind === 'party') return null;
  const hiddenFacts = (e.facts || []).filter(f => !f.known).length;
  return html`<section class=${`w-pview ${e.known ? '' : 'off'}`}>
    <header><b>Ce que voient les joueurs</b></header>
    ${e.known ? html`<${PlayerBody} e=${e} />`
      : kind === 'state' ? html`<p class="w-pview-none">Seulement son nom, écrit sur la carte.</p>`
        : html`<p class="w-pview-none">Rien : ce lieu est caché.</p>`}
    ${e.known && hiddenFacts ? html`<p class="w-pview-more">${t('{n} info(s) encore cachée(s).', { n: hiddenFacts })}</p>` : null}
  </section>`;
}

function Card() {
  const d = S.data;
  const key = S.sel;
  const [openNote, setOpenNote] = useState(false);
  useEffect(() => { setOpenNote(false); }, [key]);
  if (!key || !d) return null;
  const dm = isDm();
  const byKey = entities();
  const party = key === 'party';
  const e = party ? { ...d.party, name: d.party?.label || 'Le groupe' } : byKey.get(key);
  if (!e) return null;
  const kind = party ? 'party' : kindOf(key);
  const state = s => d.states.find(x => x.i === s);
  const prov = p => d.provinces.find(x => x.i === p);
  const culture = c => d.cultures.find(x => x.i === c);
  const religion = r => d.religions.find(x => x.i === r);
  const title = kind === 'state' || kind === 'province' ? e.full || e.name : e.name;

  const facts = [];
  if (kind === 'burg') {
    facts.push(['Genre', GROUPS[e.group] || e.group]);
    const st = state(e.state);
    if (st && e.state) facts.push(['État', st.known || dm ? link(st.key, st.full || st.name) : st.full || st.name]);
    const pv = prov(e.province);
    if (pv) facts.push(['Province', link(pv.key, pv.full || pv.name)]);
    if (dm || e.known) {
      facts.push(['Population', fmtInt(e.population)]);
      if (culture(e.culture)?.i) facts.push(['Culture', culture(e.culture).name]);
      if (religion(e.religion)?.i) facts.push(['Religion', religion(e.religion).name]);
      if (e.biome) facts.push(['Paysage', e.biome]);
    }
  } else if (kind === 'state') {
    if (e.form) facts.push(['Régime', e.form]);
    const cap = d.burgs.find(b => b.i === e.capital);
    if (cap) facts.push(['Capitale', link(cap.key, cap.name)]);
    if (dm) facts.push(['Provinces', String(d.provinces.filter(p => p.state === e.i).length)]);
  } else if (kind === 'province') {
    const st = state(e.state);
    if (st) facts.push(['État', link(st.key, st.full || st.name)]);
    const cap = d.burgs.find(b => b.i === e.burg);
    if (cap) facts.push(['Chef-lieu', link(cap.key, cap.name)]);
    const inside = d.burgs.filter(b => b.province === e.i);
    if (inside.length) facts.push(['Lieux', html`<span class="w-chips">${inside.slice(0, 24).map(b => link(b.key, b.name))}</span>`]);
  } else if (kind === 'marker') {
    facts.push(['Genre', e.type]);
    if (dm && e.note) facts.push(['Azgaar', e.note]);
  } else if (kind === 'added' && !isAtlas()) {
    if (e.kind) facts.push(['Genre', e.kind]);
  }
  const chips = kind === 'burg' && (dm || e.known) ? FEATURES.filter(([k]) => e[k]).map(([, l]) => l) : [];
  // Une carte de l'atlas porte le nom de ce lieu : un lien pour l'ouvrir.
  const plan = !isAtlas() && !party ? S.list?.maps.find(m => fold(m.name) === fold(e.name) || fold(m.name) === fold(e.full)) : null;
  const kindLabel = isAtlas() && kind === 'added'
    ? e.kind || (e.shape ? 'Zone' : 'Lieu')
    : party ? 'Position du groupe' : { burg: 'Lieu', state: 'État', province: 'Province', marker: 'Marqueur', lake: 'Lac', added: 'Lieu ajouté' }[kind];

  return html`<aside class="w-card">
    <header>
      <div>
        <p class="w-kind">${kindLabel}</p>
        <h2>${kind === 'marker' ? `${e.icon} ` : ''}${e.num ? html`<span class="w-num">${e.num}</span> ` : null}${title}</h2>
        ${dm && e.origName && e.origName !== e.name ? html`<p class="muted small">Dans Azgaar : ${e.origName}</p>` : null}
      </div>
      <button type="button" class="icon-btn" aria-label="Fermer" onClick=${() => select(null)}>✕</button>
    </header>
    ${facts.length ? html`<dl class="w-facts">${facts.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>` : null}
    ${chips.length ? html`<p class="w-chips">${chips.map(c => html`<span class="badge">${c}</span>`)}</p>` : null}
    ${plan ? html`<p><button type="button" class="btn small" onClick=${() => openMap(plan.id)}>${t('Ouvrir la carte de {name}', { name: plan.name })} ›</button></p>` : null}
    ${!dm && kind !== 'party' ? html`<${PlayerBody} e=${e} />` : null}
    ${dm && !party ? html`<${Switch} on=${!!e.known} onLabel="Visible par les joueurs" offLabel="Caché aux joueurs"
      title=${e.known ? 'Clic pour le cacher' : 'Clic pour le montrer aux joueurs'} onClick=${() => save(key, { known: !e.known })} />` : null}
    ${dm ? html`<${PlayerPreview} e=${e} kind=${kind} />` : null}
    ${dm ? html`<${DmEdit} e=${e} keyId=${key} kind=${kind} openNote=${openNote} setOpenNote=${setOpenNote} />` : null}
  </aside>`;
}

// Les infos d'un lieu, que le MJ révèle une à une : cochée, le joueur la voit.
function FactsEditor({ e, keyId }) {
  const [rows, setRows] = useState(e.facts || []);
  const sig = JSON.stringify(e.facts || []);
  useEffect(() => { setRows(e.facts || []); }, [sig]);
  const commit = next => { setRows(next); if (JSON.stringify(next.filter(f => f.text.trim())) !== sig) save(keyId, { facts: next.filter(f => f.text.trim()) }); };
  const at = (i, patch) => rows.map((x, j) => (j === i ? { ...x, ...patch } : x));
  return html`<div class="w-facts-edit">
    <div class="w-field">Infos à révéler</div>
    ${rows.map((f, i) => html`<div class=${`w-fact-row ${f.known ? 'on' : 'off'}`} key=${f.id || `n${i}`}>
      <div class="w-fact-head">
        <${Switch} small on=${!!f.known} onLabel="Révélée" offLabel="Cachée" title=${f.known ? 'Les joueurs la voient : clic pour la cacher' : 'Clic pour la révéler aux joueurs'}
          onClick=${() => commit(at(i, { known: !f.known }))} />
        <button type="button" class="icon-btn" title="Retirer cette info" onClick=${() => commit(rows.filter((_, j) => j !== i))}>✕</button>
      </div>
      <textarea class="txt" rows=${Math.max(2, Math.ceil((f.text || '').length / 42))} value=${f.text} placeholder="Ce que le groupe peut apprendre ici." onInput=${ev => setRows(at(i, { text: ev.target.value }))} onBlur=${() => commit(rows)}></textarea>
    </div>`)}
    <button type="button" class="btn tiny" onClick=${() => setRows([...rows, { id: '', text: '', known: false }])}>+ Info</button>
  </div>`;
}

function DmEdit({ e, keyId, kind, openNote, setOpenNote }) {
  const imgRef = useRef(null);
  if (kind === 'party') {
    return html`<div class="w-edit">
      <${Switch} on=${e.known !== false} onLabel="Visible par les joueurs" offLabel="Caché aux joueurs" onClick=${() => save('party', { known: e.known === false })} />
      <${Field} label="Étiquette" value=${e.label} onSave=${v => save('party', { label: v })} />
      <div class="row-btns">
        <button type="button" class="btn small" onClick=${() => { S.mode = 'party'; refresh(); }}>Déplacer le groupe</button>
        <button type="button" class="btn small ghost" onClick=${async () => { await api(W('/party'), { method: 'POST', body: { clear: true } }); select(null); load(); }}>Retirer</button>
      </div>
    </div>`;
  }
  const named = kind === 'state' || kind === 'province';
  const atlasPlace = isAtlas() && kind === 'added';
  const remove = async () => { if (!confirm(t('Retirer « {name} » ?', { name: e.name }))) return; await api(W(`/place/${keyId}`), { method: 'DELETE' }); select(null); load(); };
  const sendImg = async ev => {
    const f = ev.target.files?.[0];
    ev.target.value = '';
    if (!f) return;
    try { const a = await uploadImage(f, 'image', tx('Atlas')); await save(keyId, { image: a.ref }); } catch (x) { toast(x.message, 'error'); }
  };
  return html`<div class="w-edit">
    <${Field} label="Nom" value=${e.name} placeholder=${e.origName} onSave=${v => save(keyId, { name: v })} />
    ${named ? html`<${Field} label="Nom complet" value=${e.full} placeholder=${e.origName} onSave=${v => save(keyId, { full: v })} />` : null}
    ${atlasPlace ? html`<div class="w-row2">
      <${Field} label="Genre" value=${e.kind} placeholder="taverne, quartier, temple…" onSave=${v => save(keyId, { kind: v })} />
      <${Field} label="Numéro" value=${e.num} placeholder="7" onSave=${v => save(keyId, { num: v })} />
    </div>
    <${Switch} small on=${e.label !== false} onLabel="Nom écrit sur la carte" offLabel="Nom pas écrit sur la carte" onClick=${() => save(keyId, { label: e.label === false })} />` : null}
    ${S.data.vault ? html`<${Field} label="Note du coffre" value=${e.note} placeholder="Dossier/Note.md" list="w-notes" onSave=${v => save(keyId, { note: v.trim() })} />` : null}
    ${e.note && S.data.vault ? html`<button type="button" class="btn tiny ghost" onClick=${() => setOpenNote(!openNote)}>${openNote ? 'Masquer la note' : 'Lire la note'}</button>` : null}
    ${e.note && openNote ? html`<${NoteView} file=${e.note} />` : null}
    <${Field} label="Pour les joueurs" multiline value=${e.pub} placeholder="Ce que le groupe sait de ce lieu, visible sur sa carte." onSave=${v => save(keyId, { pub: v })} />
    ${atlasPlace ? html`<${FactsEditor} e=${e} keyId=${keyId} />` : null}
    <${Field} label="Notes du MJ" multiline value=${e.mj} placeholder="Jamais montré aux joueurs." onSave=${v => save(keyId, { mj: v })} />
    ${atlasPlace ? html`<div class="row-btns">
      <button type="button" class="btn small" onClick=${() => imgRef.current?.click()}>${e.image ? 'Changer l\'image' : '+ Image'}</button>
      ${e.image ? html`<button type="button" class="btn small ghost" onClick=${() => save(keyId, { image: null })}>Retirer l'image</button>` : null}
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden ref=${imgRef} onChange=${sendImg} />
    </div>` : null}
    ${kind === 'added' ? html`<div class="row-btns">
      ${!isAtlas() ? html`<${Field} label="Genre" value=${e.kind} placeholder="donjon, ruine, camp…" onSave=${v => save(keyId, { kind: v })} />` : null}
      ${e.shape
        ? html`<button type="button" class="btn small" onClick=${() => { S.mode = `reshape:${keyId}`; S.draft = []; refresh(); }}>Redessiner la zone</button>`
        : html`<button type="button" class="btn small" onClick=${() => { S.mode = `move:${keyId}`; refresh(); }}>Déplacer</button>`}
      <button type="button" class="btn small danger ghost" onClick=${remove}>Retirer</button>
    </div>` : null}
  </div>`;
}

// ---------------------------------------------------------------- Recherche

function Search() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (qq.length < 2 || !S.data) return [];
    const out = [];
    for (const [key, e] of entities()) {
      if (!shown(e) && !(key[0] === 's')) continue;
      const names = [e.name, e.full, e.origName].filter(Boolean).map(s => s.toLowerCase());
      const hit = names.find(n => n.includes(qq));
      if (!hit) continue;
      out.push({ key, e, score: (hit.startsWith(qq) ? 0 : 1) + (e.known ? -0.5 : 0) + (key[0] === 'b' ? (e.group === 'capital' ? 0 : e.group === 'city' ? 0.1 : 0.3) : 0) });
    }
    return out.sort((a, b) => a.score - b.score).slice(0, 14);
  }, [q, S.data, S.playerView]);
  const go = ({ key, e }) => {
    setOpen(false);
    select(key);
    const p = posOf(e);
    if (p) centerOn(p.x, p.y, key[0] === 's' ? 2.5 : key[0] === 'p' ? 4 : isAtlas() ? Math.max(zoom(), 2) : 6);
  };
  const label = e => ({ b: GROUPS[e.group] || 'Lieu', p: 'Province', s: 'État', m: 'Marqueur', l: 'Lac', a: e.kind || (e.shape ? 'Zone' : 'Lieu') });
  return html`<div class="w-search">
    <input class="txt" type="search" placeholder="Chercher un lieu…" value=${q}
      onInput=${e => { setQ(e.target.value); setOpen(true); }} onFocus=${() => setOpen(true)}
      onKeyDown=${e => { if (e.key === 'Enter' && list[0]) go(list[0]); if (e.key === 'Escape') setOpen(false); }} />
    ${open && list.length ? html`<ul class="w-results">${list.map(r => html`<li><button type="button" onClick=${() => go(r)}>
      <b>${r.e.full && r.key[0] !== 'b' ? r.e.full : r.e.name}</b><small>${label(r.e)[r.key[0]]}${r.e.known && isDm() ? ' · connu' : ''}</small>
    </button></li>`)}</ul>` : null}
  </div>`;
}

// ---------------------------------------------------------------- Panneau des cartes

async function patchMap(id, patch) {
  try { await api(`/api/c/${CID}/atlas/${id}`, { method: 'PATCH', body: patch }); await loadList(); if (id === S.src) await load(); } catch (x) { toast(x.message, 'error'); }
}

function NewMap() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const send = async ev => {
    const f = ev.target.files?.[0];
    ev.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const a = await uploadImage(f, 'world', tx('Atlas'));
      const r = await api(`/api/c/${CID}/atlas`, { method: 'POST', body: { name: name.trim() || f.name.replace(/\.[^.]+$/, ''), image: a.ref } });
      S.newMap = false;
      await loadList();
      openMap(r.id);
    } catch (x) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  return html`<div class="w-newmap">
    <input class="txt" placeholder="Nom : une ville, une région…" value=${name} onInput=${e => setName(e.target.value)} />
    <button type="button" class="btn small primary" disabled=${busy} onClick=${() => ref.current?.click()}>${busy ? 'Envoi…' : 'Choisir l\'image'}</button>
    <input type="file" accept="image/png,image/jpeg,image/webp" hidden ref=${ref} onChange=${send} />
    <p class="muted small">La carte reste cachée aux joueurs jusqu'à ce que tu la montres.</p>
  </div>`;
}

function MapTools({ m }) {
  const imgRef = useRef(null);
  const maps = S.list.maps;
  const i = maps.findIndex(x => x.id === m.id);
  // Monter ou descendre : on renumérote toute la liste dans le nouvel ordre.
  const moveBy = async dir => {
    const j = i + dir;
    if (j < 0 || j >= maps.length) return;
    const order = maps.map(x => x.id);
    [order[i], order[j]] = [order[j], order[i]];
    try { for (const [n, id] of order.entries()) await api(`/api/c/${CID}/atlas/${id}`, { method: 'PATCH', body: { order: n } }); } catch (x) { toast(x.message, 'error'); }
    loadList();
  };
  const rename = () => { const n = prompt(tx('Nom de la carte'), m.name); if (n && n.trim() && n.trim() !== m.name) patchMap(m.id, { name: n.trim() }); };
  const remove = async () => {
    if (!confirm(t('Retirer la carte « {name} » et tous ses lieux ? L\'image reste dans la bibliothèque.', { name: m.name }))) return;
    try { await api(`/api/c/${CID}/atlas/${m.id}`, { method: 'DELETE' }); await loadList(); openMap(firstSrc()); } catch (x) { toast(x.message, 'error'); }
  };
  const swapImage = async ev => {
    const f = ev.target.files?.[0];
    ev.target.value = '';
    if (!f) return;
    try { const a = await uploadImage(f, 'world', tx('Atlas')); await patchMap(m.id, { image: a.ref }); } catch (x) { toast(x.message, 'error'); }
  };
  return html`<div class="w-side-tools">
    <button type="button" class="btn tiny" onClick=${rename}>Renommer</button>
    <button type="button" class="btn tiny" title="Une nouvelle image aux mêmes proportions : les lieux suivent" onClick=${() => imgRef.current?.click()}>Changer l'image</button>
    <button type="button" class="btn tiny" disabled=${i <= 0} title="Monter" onClick=${() => moveBy(-1)}>↑</button>
    <button type="button" class="btn tiny" disabled=${i >= maps.length - 1} title="Descendre" onClick=${() => moveBy(1)}>↓</button>
    <button type="button" class="btn tiny danger ghost" onClick=${remove}>Retirer</button>
    <input type="file" accept="image/png,image/jpeg,image/webp" hidden ref=${imgRef} onChange=${swapImage} />
  </div>`;
}

function Side() {
  const l = S.list;
  const dm = dmList();
  const cur = l.maps.find(m => m.id === S.src);
  return html`<nav class="w-side">
    <div class="w-side-head">Cartes</div>
    ${l.world ? html`<div class=${`w-side-row ${S.src === WORLD ? 'on' : ''}`}>
      <button type="button" class="w-side-item" onClick=${() => openMap(WORLD)}><span class="w-side-ico">🌍</span><span class="w-side-name">Carte du monde</span>${dm && !l.world.exists ? html`<small class="w-tag">vide</small>` : null}</button>
    </div>` : null}
    ${l.maps.map(m => html`<div key=${m.id} class=${`w-side-row ${S.src === m.id ? 'on' : ''}`}>
      <button type="button" class="w-side-item" onClick=${() => openMap(m.id)}><span class="w-side-ico">🗺</span><span class="w-side-name">${m.name}</span></button>
      ${dm ? html`<${Switch} small on=${!!m.known} onLabel="Visible" offLabel="Cachée" title=${m.known ? 'Visible des joueurs : clic pour la cacher' : 'Cachée aux joueurs : clic pour la montrer'} onClick=${() => patchMap(m.id, { known: !m.known })} />` : null}
    </div>`)}
    ${dm && cur ? html`<${MapTools} m=${cur} />` : null}
    ${dm ? html`<button type="button" class=${`btn small w-side-add ${S.newMap ? 'on' : ''}`} onClick=${() => { S.newMap = !S.newMap; refresh(); }}>+ Nouvelle carte</button>
      ${S.newMap ? html`<${NewMap} />` : null}` : null}
  </nav>`;
}

// ---------------------------------------------------------------- Barre du haut

function setLabels(dir) {
  S.labelStep = Math.max(0, Math.min(LABEL_STEPS.length - 1, S.labelStep + dir));
  LS.set('atlas.labels', S.labelStep);
  refresh();
}

function TopBar() {
  const d = S.data;
  const dmRole = d?.role === 'dm';
  const atlasMap = isAtlas();
  const [menu, setMenu] = useState(false);
  const toggle = id => {
    S.layers = { ...S.layers, [id]: !S.layers[id] };
    LS.set(`world.layer.${id}`, S.layers[id]);
    applyLayers();
    refresh();
  };
  const toggleSide = () => { S.side = !S.side; if (!narrow()) LS.set('atlas.side', S.side); refresh(); };
  const setMode = m => { S.mode = S.mode === m ? null : m; S.draft = m === 'zone' && S.mode ? [] : null; refresh(); };
  const writeMap = async () => {
    if (!confirm(tx('Écrire les noms corrigés dans le fichier .map ? Azgaar les montrera à la prochaine ouverture. La version précédente est gardée sur le serveur.'))) return;
    try {
      const r = await api(W('/write'), { method: 'POST' });
      toast(r.touched.length ? `Écrit dans ${r.file} : ${r.touched.join(', ')}` : 'Rien à changer dans le .map');
      await reloadSvg();
      load();
    } catch (x) { toast(x.message, 'error'); }
  };
  const ready = d && !d.missing;
  return html`<header class="w-top">
    <a class="w-home" href=${`/c/${CID}${AS ? `?as=${encodeURIComponent(AS)}` : ''}`} title="Retour aux fiches">⚔</a>
    <button type="button" class=${`btn small w-side-btn ${S.side ? 'on' : ''}`} title="Les cartes" onClick=${toggleSide}>☰</button>
    <div class="w-title"><b>${S.src ? mapName() : 'Atlas'}</b>${!atlasMap && d?.year ? html`<small>An ${d.year}${d.era ? ` · ${d.era}` : ''}</small>` : atlasMap ? html`<small>Atlas</small>` : null}</div>
    ${AS ? html`<span class="w-preview" title="Ce que voit un joueur, en lecture seule">👁 Vue joueur</span>` : null}
    ${ready ? html`<${Search} />` : null}
    <div class="grow"></div>
    ${ready ? html`<div class="w-tools">
      ${!atlasMap ? html`<button type="button" class="btn small" onClick=${() => setMenu(!menu)}>Calques</button>` : null}
      ${dmRole ? html`
        <button type="button" class=${`btn small ${S.mode === 'add' ? 'on' : ''}`} disabled=${S.playerView} title=${atlasMap ? 'Un lieu : une taverne, un temple, une porte…' : 'Un lieu absent d\'Azgaar : donjon, ruine, camp…'} onClick=${() => setMode('add')}>+ Lieu</button>
        ${atlasMap ? html`<button type="button" class=${`btn small ${S.mode === 'zone' ? 'on' : ''}`} disabled=${S.playerView} title="Une zone cliquable : un quartier, une forêt, un domaine" onClick=${() => setMode('zone')}>+ Zone</button>` : null}
        <button type="button" class=${`btn small ${S.mode === 'party' ? 'on' : ''}`} disabled=${S.playerView} onClick=${() => setMode('party')}>⚑ Groupe</button>
        <div class="w-seg" role="group" aria-label="Vue">
          <button type="button" class=${S.playerView ? '' : 'on'} title="Tout, caché compris" onClick=${() => { S.playerView = false; refresh(); }}>Vue MJ</button>
          <button type="button" class=${S.playerView ? 'on' : ''} title="Seulement ce que les joueurs voient" onClick=${() => { S.playerView = true; S.mode = null; S.draft = null; refresh(); }}>Vue joueurs</button>
        </div>
        ${d.mode === 'azgaar' ? html`<button type="button" class="btn small" disabled=${S.playerView} title="Réécrit les noms corrigés dans le fichier .map, pour Azgaar" onClick=${writeMap}>Écrire dans le .map</button>
          <a class="btn small" href=${W('/download')} download title="Télécharger le .map, avec les noms écrits">⤓ .map</a>` : null}
        ${!atlasMap ? html`<button type="button" class="btn small" disabled=${S.playerView} title="Remplacer la carte : un .map d'Azgaar ou une image" onClick=${() => { S.mode = null; S.upload = true; refresh(); }}>Changer de carte</button>` : null}` : null}
      ${ready ? html`<div class="w-seg" role="group" aria-label="Taille des noms">
        <button type="button" disabled=${S.labelStep <= 0} title="Noms plus petits" onClick=${() => setLabels(-1)}>A−</button>
        <button type="button" disabled=${S.labelStep >= LABEL_STEPS.length - 1} title="Noms plus gros" onClick=${() => setLabels(1)}>A+</button>
      </div>` : null}
      <button type="button" class="btn small" title="Toute la carte" onClick=${() => setView(fullView())}>⤢</button>
    </div>` : null}
    ${menu && !atlasMap ? html`<div class="w-layers" onPointerLeave=${() => setMenu(false)}>
      ${LAYERS.map(([id, label]) => html`<label class="check"><input type="checkbox" checked=${!!S.layers[id]} onChange=${() => toggle(id)} /> ${label}</label>`)}
    </div>` : null}
  </header>`;
}

// ---------------------------------------------------------------- Envoi d'une carte du monde

// Une carte du monde : un fichier .map d'Azgaar (États, bourgs, provinces cliquables) ou une
// simple image (les lieux s'ajoutent à la main). La couche de lore reste quand on change de carte.
function UploadWorld() {
  const [busy, setBusy] = useState(false);
  const mapRef = useRef(null);
  const imgRef = useRef(null);
  const done = async () => { S.upload = false; S.svg = null; worldSvg = null; S.view = null; await loadList(); await load(); };
  const sendMap = async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      await api(W(`/map?name=${encodeURIComponent(f.name)}`), { method: 'POST', raw: await f.text(), headers: { 'Content-Type': 'text/plain' } });
      await done();
    } catch (x) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  const sendImage = async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const a = await uploadImage(f, 'world', '');
      await api(W('/image'), { method: 'POST', body: { ref: a.ref } });
      await done();
    } catch (x) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  return html`<div class="w-up">
    <p>Deux façons d'avoir une carte du monde :</p>
    <div class="w-up-opt">
      <b>Un fichier .map d'Azgaar</b>
      <p class="muted small">Dessine le monde dans <a href="https://azgaar.github.io/Fantasy-Map-Generator/" target="_blank" rel="noopener">Azgaar's Fantasy Map Generator</a>, enregistre-le en .map, envoie-le ici. Bourgs, États et provinces deviennent cliquables.</p>
      <button type="button" class="btn primary" disabled=${busy} onClick=${() => mapRef.current?.click()}>${busy ? 'Envoi…' : 'Envoyer un .map'}</button>
      <input type="file" accept=".map" hidden ref=${mapRef} onChange=${sendMap} />
    </div>
    <div class="w-up-opt">
      <b>Une image</b>
      <p class="muted small">Une carte dessinée ailleurs (Inkarnate, Wonderdraft, scan). Tu y places les lieux et le groupe toi-même.</p>
      <button type="button" class="btn" disabled=${busy} onClick=${() => imgRef.current?.click()}>${busy ? 'Envoi…' : 'Envoyer une image'}</button>
      <input type="file" accept="image/png,image/jpeg,image/webp" hidden ref=${imgRef} onChange=${sendImage} />
    </div>
    <p class="muted small">Une ville, une région ou un quartier va plutôt dans « + Nouvelle carte », dans le panneau des cartes.</p>
  </div>`;
}

function Pane() {
  if (!S.src) {
    return html`<div class="w-pane"><div class="join-card"><h1>Atlas</h1>
      <p>${dmList() ? 'Aucune carte pour l\'instant. Ajoute une carte du monde ou une « Nouvelle carte » dans le panneau.' : 'Le MJ n\'a pas encore montré de carte.'}</p></div></div>`;
  }
  if (S.src === WORLD && (S.data?.missing || S.upload)) {
    return html`<div class="w-pane"><div class="join-card w-upload"><h1>Carte du monde</h1>
      ${S.data?.role === 'dm' ? html`<${UploadWorld} />` : html`<p>Le MJ n'a pas encore mis de carte du monde.</p>`}
      ${S.upload ? html`<div class="row-btns"><button type="button" class="btn ghost" onClick=${() => { S.upload = false; refresh(); }}>Annuler</button></div>` : null}</div></div>`;
  }
  if (!S.data) return html`<div class="w-pane"><div class="boot">Chargement de la carte…</div></div>`;
  return html`<${Stage} /><${Card} />`;
}

// ---------------------------------------------------------------- Coquille

function App() {
  useWorld();
  useEffect(() => {
    if (narrow()) S.side = false;
    loadList().then(() => { if (S.list) openMap(firstSrc()); });
    const timer = setInterval(poll, 12_000);
    const vis = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', vis);
    const k = e => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '');
      if (e.key === 'Escape') { if (S.mode) cancelMode(); else select(null); refresh(); return; }
      const zoning = S.mode === 'zone' || S.mode?.startsWith('reshape:');
      if (zoning && !typing && e.key === 'Enter') { e.preventDefault(); finishZone(); }
      if (zoning && !typing && e.key === 'Backspace' && S.draft?.length) { e.preventDefault(); S.draft = S.draft.slice(0, -1); refresh(); }
    };
    window.addEventListener('keydown', k);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', vis); window.removeEventListener('keydown', k); };
  }, []);
  useEffect(() => {
    if (S.data?.role === 'dm' && S.data.vault && !S.notes) api(`/api/c/${CID}/monde/notes`).then(n => { S.notes = n; refresh(); }).catch(() => {});
  }, [S.data]);
  if (S.error === 'login') {
    return html`<div class="join"><div class="join-card"><h1>Atlas</h1><p>${token() ? 'Tu ne fais pas partie de cette campagne.' : 'Connecte-toi d\'abord à l\'application.'}</p><a class="btn primary" href="/">Mes campagnes</a></div></div>`;
  }
  if (S.error) return html`<div class="join"><div class="join-card"><h1>Atlas</h1><p class="warn">${S.error}</p><button type="button" class="btn" onClick=${() => { S.error = null; loadList().then(load); }}>Réessayer</button></div></div>`;
  if (!S.list) return html`<div class="boot">Chargement de la carte…</div>`;
  return html`<div class=${`w-app ${S.sel ? 'with-card' : ''} ${S.side ? 'side-open' : ''}`}>
    <${TopBar} />
    <main class="w-main">
      ${S.side ? html`<${Side} />` : null}
      ${S.side && narrow() ? html`<div class="w-side-back" onClick=${() => { S.side = false; refresh(); }}></div>` : null}
      <${Pane} />
    </main>
    ${S.notes ? html`<datalist id="w-notes">${S.notes.map(n => html`<option value=${n} />`)}</datalist>` : null}
    <div class="w-toasts">${S.toasts.map(x => html`<div class=${`w-toast ${x.kind}`}>${x.text}</div>`)}</div>
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
