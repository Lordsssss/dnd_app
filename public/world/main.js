// Carte du monde : le dessin d'Azgaar en fond, les lieux par-dessus, une fiche par lieu.
// Le MJ voit tout et corrige le lore ; un joueur ne voit que ce que le groupe connaît.
import { t, tx, setLang } from '/shared/i18n.js';
import { html, render, useEffect, useMemo, useRef, useState } from '/app/html.js';
import { renderMarkdown } from './markdown.js';

// ---------------------------------------------------------------- Accès

const token = () => { try { return JSON.parse(localStorage.getItem('token')); } catch { return null; } };
// La campagne est dans l'adresse : /c/<id>/monde. Chaque campagne a son monde.
const CID = (/^\/c\/([\w-]+)\//.exec(location.pathname) || [])[1] || '';
const W = path => `/api/c/${CID}/monde${path}`;
const fileUrl = ref => `/api/file?ref=${encodeURIComponent(ref)}`;

async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    headers: { ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) { const e = new Error(data?.error || `Erreur ${res.status}`); e.status = res.status; throw e; }
  return data;
}

// La langue choisie sur la page des fiches.
try { setLang(JSON.parse(localStorage.getItem('lang')) || 'fr'); } catch { /* stockage indisponible */ }

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};

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
const fmtPop = n => (n >= 1000 ? `${Math.round(n / 100) / 10} k`.replace('.', ',') : String(n));
const fmtInt = n => n.toLocaleString('fr-CA');

// ---------------------------------------------------------------- État de la page

const S = {
  data: null, svg: null, error: null, view: null, size: { w: 1, h: 1 },
  sel: null, layers: Object.fromEntries(LAYERS.map(([k, , d]) => [k, LS.get(`world.layer.${k}`, d)])),
  mode: null, playerView: false, notes: null, toasts: [], upload: false,
};
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
const shown = x => !S.playerView || x.known;

async function load() {
  try {
    const data = await api(W(''));
    const svg = data.mode === 'azgaar' && !S.svg ? await api(W('/svg')) : null;
    S.data = data;
    if (svg) S.svg = svg;
    if (data.mode === 'image') S.svg = null;
    S.error = null;
    if (!S.view && data && !data.missing) S.view = LS.get(`world.view:${CID}`, null) || fullView(data);
  } catch (e) {
    S.error = e.status === 401 || e.status === 403 ? 'login' : e.message;
  }
  refresh();
}

async function reloadSvg() {
  S.svg = S.data?.mode === 'azgaar' ? await api(W('/svg')) : null;
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
function setView(v) {
  const d = S.data;
  const w = Math.max(d.width / 40, Math.min(d.width * 1.6, v.w));
  S.view = fitAspect({ x: v.x, y: v.y, w });
  LS.set(`world.view:${CID}`, S.view);
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

function Overlay() {
  const d = S.data;
  const v = S.view;
  const k = v.w / S.size.w; // unités de carte par pixel d'écran
  const z = zoom();
  const pad = 40 * k;
  const inView = p => p.x >= v.x - pad && p.x <= v.x + v.w + pad && p.y >= v.y - pad && p.y <= v.y + v.h + pad;
  const sel = S.sel;
  const items = [];

  if (S.layers.places) {
    for (const b of d.burgs) {
      if (!shown(b) || !inView(b)) continue;
      const g = b.group in MIN_ZOOM ? b.group : 'town';
      // Un lieu connu des joueurs, ou sélectionné, se voit à tout zoom.
      if (z < (MIN_ZOOM[g] ?? 3) && !b.known && sel !== b.key && !(g === 'capital')) continue;
      const r = (ICON_PX[g] || 3.5) * k * (b.known && isDm() ? 1.1 : 1);
      const fs = (FONT_PX[g] || 10.5) * k;
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
        <text x=${l.x} y=${l.y} font-size=${11 * k} stroke-width=${3 * k}>${l.name}</text>
      </g>`);
    }
    for (const a of d.added) {
      if (!shown(a) || !inView(a)) continue;
      if (z < 2.5 && sel !== a.key && S.data.mode !== 'image') continue;
      const r = 6 * k;
      items.push(html`<g key=${a.key} class=${`w-added ${a.known ? 'known' : ''} ${sel === a.key ? 'sel' : ''}`} data-key=${a.key}>
        <path d=${`M${a.x},${a.y - r} L${a.x + r},${a.y} L${a.x},${a.y + r} L${a.x - r},${a.y} Z`} stroke-width=${1.4 * k} />
        <text x=${a.x} y=${a.y - r - 3 * k} font-size=${12 * k} stroke-width=${3 * k}>${a.name}</text>
      </g>`);
    }
  }
  if (S.layers.markers) {
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

function Stage() {
  const stage = useRef(null);
  const base = useRef(null);

  useEffect(() => {
    if (!base.current || !S.svg) return;
    base.current.innerHTML = S.svg;
    baseSvgEl = base.current.querySelector('svg');
    if (baseSvgEl) { baseSvgEl.removeAttribute('width'); baseSvgEl.removeAttribute('height'); }
    applyBaseView();
    applyLayers();
  }, [S.svg]);

  useEffect(() => {
    const el = stage.current;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const first = S.size.w === 1;
      S.size = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
      if (S.view) { S.view = first && !LS.get(`world.view:${CID}`, null) ? fullView() : fitAspect(S.view); applyBaseView(); }
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
      if (!pointers.has(e.pointerId)) return;
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
      if (drag && !drag.moved) click(e, local(e));
      drag = null;
    };
    const wheel = e => {
      e.preventDefault();
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

  return html`<div class=${`w-stage ${S.mode ? `mode-${S.mode}` : ''}`} ref=${stage}>
    <div class="w-base" ref=${base}></div>
    ${S.data?.mode === 'image' && S.view ? html`<svg class="w-img" viewBox=${`${S.view.x} ${S.view.y} ${S.view.w} ${S.view.h}`} preserveAspectRatio="xMidYMid meet">
      <image href=${fileUrl(S.data.image)} x="0" y="0" width=${S.data.width} height=${S.data.height} />
    </svg>` : null}
    ${S.view && S.data ? html`<${Overlay} />` : null}
    ${S.mode ? html`<div class="w-banner">${S.mode === 'add' ? 'Clique sur la carte pour placer le nouveau lieu.' : S.mode === 'party' ? 'Clique sur la carte pour placer le groupe.' : 'Clique sur la nouvelle position du lieu.'} <button type="button" class="btn tiny" onClick=${() => { S.mode = null; refresh(); }}>Annuler</button></div>` : null}
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

async function click(e, p) {
  const at = toMap(p.x, p.y);
  if (S.mode === 'add') {
    S.mode = null;
    const name = prompt(tx('Nom du nouveau lieu'), 'Nouveau lieu');
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
    if (patch.full !== undefined || patch.name !== undefined) { if (key[0] === 's') await reloadSvg(); }
  } catch (x) { toast(x.message, 'error'); }
}

// ---------------------------------------------------------------- Fiche d'un lieu

function Field({ label, value, onSave, multiline = false, placeholder = '', list }) {
  const [v, setV] = useState(value || '');
  useEffect(() => { setV(value || ''); }, [value]);
  const commit = () => { if ((v || '') !== (value || '')) onSave(v); };
  return html`<label class="w-field">${label}
    ${multiline
      ? html`<textarea class="txt" rows="4" placeholder=${placeholder} value=${v} onInput=${e => setV(e.target.value)} onBlur=${commit}></textarea>`
      : html`<input class="txt" placeholder=${placeholder} value=${v} list=${list} onInput=${e => setV(e.target.value)} onBlur=${commit} onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />`}
  </label>`;
}

function NoteView({ file }) {
  const [text, setText] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setText(null);
    setErr('');
    api(W(`/note?file=${encodeURIComponent(file)}`)).then(r => setText(r.text)).catch(e => setErr(e.message));
  }, [file]);
  if (err) return html`<p class="warn small">${err}</p>`;
  if (text == null) return html`<p class="muted small">Chargement de la note…</p>`;
  return html`<div class="w-note md" dangerouslySetInnerHTML=${{ __html: renderMarkdown(text) }}></div>`;
}

const link = (key, label) => html`<button type="button" class="linkish" onClick=${() => { const e = entities().get(key); select(key); const p = posOf(e); if (p) centerOn(p.x, p.y); }}>${label}</button>`;

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
  } else if (kind === 'added') {
    if (e.kind) facts.push(['Genre', e.kind]);
  }
  const chips = kind === 'burg' && (dm || e.known) ? FEATURES.filter(([k]) => e[k]).map(([, l]) => l) : [];

  return html`<aside class="w-card">
    <header>
      <div>
        <p class="w-kind">${party ? 'Position du groupe' : { burg: 'Lieu', state: 'État', province: 'Province', marker: 'Marqueur', lake: 'Lac', added: 'Lieu ajouté' }[kind]}${e.known && dm ? html` · <span class="w-known">connu des joueurs</span>` : null}</p>
        <h2>${kind === 'marker' ? `${e.icon} ` : ''}${title}</h2>
        ${dm && e.origName && e.origName !== e.name ? html`<p class="muted small">Dans Azgaar : ${e.origName}</p>` : null}
      </div>
      <button type="button" class="icon-btn" aria-label="Fermer" onClick=${() => select(null)}>✕</button>
    </header>
    ${facts.length ? html`<dl class="w-facts">${facts.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>` : null}
    ${chips.length ? html`<p class="w-chips">${chips.map(c => html`<span class="badge">${c}</span>`)}</p>` : null}
    ${!dm && e.pub ? html`<div class="w-pub">${e.pub.split('\n').map(l => html`<p>${l}</p>`)}</div>` : null}
    ${!dm && !e.pub && kind !== 'party' ? html`<p class="muted small">Le groupe n'en sait pas plus.</p>` : null}
    ${dm ? html`<${DmEdit} e=${e} keyId=${key} kind=${kind} openNote=${openNote} setOpenNote=${setOpenNote} />` : null}
  </aside>`;
}

function DmEdit({ e, keyId, kind, openNote, setOpenNote }) {
  if (kind === 'party') {
    return html`<div class="w-edit">
      <label class="check"><input type="checkbox" checked=${e.known !== false} onChange=${ev => save('party', { known: ev.target.checked })} /> Visible des joueurs</label>
      <${Field} label="Étiquette" value=${e.label} onSave=${v => save('party', { label: v })} />
      <div class="row-btns">
        <button type="button" class="btn small" onClick=${() => { S.mode = 'party'; refresh(); }}>Déplacer le groupe</button>
        <button type="button" class="btn small ghost" onClick=${async () => { await api(W('/party'), { method: 'POST', body: { clear: true } }); select(null); load(); }}>Retirer</button>
      </div>
    </div>`;
  }
  const named = kind === 'state' || kind === 'province';
  return html`<div class="w-edit">
    <label class="check"><input type="checkbox" checked=${!!e.known} onChange=${ev => save(keyId, { known: ev.target.checked })} /> Connu des joueurs</label>
    <${Field} label="Nom" value=${e.name} placeholder=${e.origName} onSave=${v => save(keyId, { name: v })} />
    ${named ? html`<${Field} label="Nom complet" value=${e.full} placeholder=${e.origName} onSave=${v => save(keyId, { full: v })} />` : null}
    ${S.data.vault ? html`<${Field} label="Note du coffre" value=${e.note} placeholder="Dossier/Note.md" list="w-notes" onSave=${v => save(keyId, { note: v.trim() })} />` : null}
    ${e.note && S.data.vault ? html`<button type="button" class="btn tiny ghost" onClick=${() => setOpenNote(!openNote)}>${openNote ? 'Masquer la note' : 'Lire la note'}</button>` : null}
    ${e.note && openNote ? html`<${NoteView} file=${e.note} />` : null}
    <${Field} label="Pour les joueurs" multiline value=${e.pub} placeholder="Ce que le groupe sait de ce lieu, visible sur sa carte." onSave=${v => save(keyId, { pub: v })} />
    <${Field} label="Notes du MJ" multiline value=${e.mj} placeholder="Jamais montré aux joueurs." onSave=${v => save(keyId, { mj: v })} />
    ${kind === 'added' ? html`<div class="row-btns">
      <${Field} label="Genre" value=${e.kind} placeholder="donjon, ruine, camp…" onSave=${v => save(keyId, { kind: v })} />
      <button type="button" class="btn small" onClick=${() => { S.mode = `move:${keyId}`; refresh(); }}>Déplacer</button>
      <button type="button" class="btn small danger ghost" onClick=${async () => { if (!confirm(t('Retirer « {name} » ?', { name: e.name }))) return; await api(W(`/place/${keyId}`), { method: 'DELETE' }); select(null); load(); }}>Retirer</button>
    </div>` : null}
  </div>`;
}

// ---------------------------------------------------------------- Recherche

function Search() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2 || !S.data) return [];
    const out = [];
    for (const [key, e] of entities()) {
      if (!shown(e) && !(key[0] === 's')) continue;
      const names = [e.name, e.full, e.origName].filter(Boolean).map(s => s.toLowerCase());
      const hit = names.find(n => n.includes(t));
      if (!hit) continue;
      out.push({ key, e, score: (hit.startsWith(t) ? 0 : 1) + (e.known ? -0.5 : 0) + (key[0] === 'b' ? (e.group === 'capital' ? 0 : e.group === 'city' ? 0.1 : 0.3) : 0) });
    }
    return out.sort((a, b) => a.score - b.score).slice(0, 14);
  }, [q, S.data, S.playerView]);
  const go = ({ key, e }) => {
    setOpen(false);
    select(key);
    const p = posOf(e);
    if (p) centerOn(p.x, p.y, key[0] === 's' ? 2.5 : key[0] === 'p' ? 4 : 6);
  };
  const label = e => ({ b: GROUPS[e.group] || 'Lieu', p: 'Province', s: 'État', m: 'Marqueur', l: 'Lac', a: e.kind || 'Lieu' });
  return html`<div class="w-search">
    <input class="txt" type="search" placeholder="Chercher un lieu…" value=${q}
      onInput=${e => { setQ(e.target.value); setOpen(true); }} onFocus=${() => setOpen(true)}
      onKeyDown=${e => { if (e.key === 'Enter' && list[0]) go(list[0]); if (e.key === 'Escape') setOpen(false); }} />
    ${open && list.length ? html`<ul class="w-results">${list.map(r => html`<li><button type="button" onClick=${() => go(r)}>
      <b>${r.e.full && r.key[0] !== 'b' ? r.e.full : r.e.name}</b><small>${label(r.e)[r.key[0]]}${r.e.known && isDm() ? ' · connu' : ''}</small>
    </button></li>`)}</ul>` : null}
  </div>`;
}

// ---------------------------------------------------------------- Barre du haut

function TopBar() {
  const d = S.data;
  const dmRole = d?.role === 'dm';
  const [menu, setMenu] = useState(false);
  const toggle = id => {
    S.layers = { ...S.layers, [id]: !S.layers[id] };
    LS.set(`world.layer.${id}`, S.layers[id]);
    applyLayers();
    refresh();
  };
  const writeMap = async () => {
    if (!confirm(tx('Écrire les noms corrigés dans le fichier .map ? Azgaar les montrera à la prochaine ouverture. La version précédente est gardée sur le serveur.'))) return;
    try {
      const r = await api(W('/write'), { method: 'POST' });
      toast(r.touched.length ? `Écrit dans ${r.file} : ${r.touched.join(', ')}` : 'Rien à changer dans le .map');
      await reloadSvg();
      load();
    } catch (x) { toast(x.message, 'error'); }
  };
  return html`<header class="w-top">
    <a class="w-home" href=${`/c/${CID}`} title="Retour aux fiches">⚔</a>
    <div class="w-title"><b>${d?.name || 'Carte du monde'}</b>${d?.year ? html`<small>An ${d.year}${d.era ? ` · ${d.era}` : ''}</small>` : null}</div>
    <${Search} />
    <div class="grow"></div>
    <div class="w-tools">
      <button type="button" class="btn small" onClick=${() => setMenu(!menu)}>Calques</button>
      ${dmRole ? html`
        <button type="button" class=${`btn small ${S.mode === 'add' ? 'on' : ''}`} disabled=${S.playerView} title="Un lieu absent d'Azgaar : donjon, ruine, camp…" onClick=${() => { S.mode = S.mode === 'add' ? null : 'add'; refresh(); }}>+ Lieu</button>
        <button type="button" class=${`btn small ${S.mode === 'party' ? 'on' : ''}`} disabled=${S.playerView} onClick=${() => { S.mode = S.mode === 'party' ? null : 'party'; refresh(); }}>⚑ Groupe</button>
        <button type="button" class=${`btn small ${S.playerView ? 'on' : ''}`} title="Voir la carte comme les joueurs" onClick=${() => { S.playerView = !S.playerView; S.mode = null; refresh(); }}>${S.playerView ? 'Vue joueurs' : 'Vue MJ'}</button>
        ${d.mode === 'azgaar' ? html`<button type="button" class="btn small" disabled=${S.playerView} title="Réécrit les noms corrigés dans le fichier .map, pour Azgaar" onClick=${writeMap}>Écrire dans le .map</button>
          <a class="btn small" href=${W('/download')} download title="Télécharger le .map, avec les noms écrits">⤓ .map</a>` : null}
        <button type="button" class="btn small" disabled=${S.playerView} title="Remplacer la carte : un .map d'Azgaar ou une image" onClick=${() => { S.mode = null; S.upload = true; refresh(); }}>Changer de carte</button>` : null}
      <button type="button" class="btn small" title="Toute la carte" onClick=${() => setView(fullView())}>⤢</button>
    </div>
    ${menu ? html`<div class="w-layers" onPointerLeave=${() => setMenu(false)}>
      ${LAYERS.map(([id, label]) => html`<label class="check"><input type="checkbox" checked=${!!S.layers[id]} onChange=${() => toggle(id)} /> ${label}</label>`)}
    </div>` : null}
  </header>`;
}

// ---------------------------------------------------------------- Envoi d'une carte

// Une carte du monde : un fichier .map d'Azgaar (États, bourgs, provinces cliquables) ou une
// simple image (les lieux s'ajoutent à la main). La couche de lore reste quand on change de carte.
function UploadWorld() {
  const [busy, setBusy] = useState(false);
  const mapRef = useRef(null);
  const imgRef = useRef(null);
  const sendMap = async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      await api(W(`/map?name=${encodeURIComponent(f.name)}`), { method: 'POST', raw: await f.text(), headers: { 'Content-Type': 'text/plain' } });
      S.upload = false; S.svg = null; S.view = null;
      await load();
    } catch (x) { toast(x.message, 'error'); } finally { setBusy(false); }
  };
  const sendImage = async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const a = await api(`/api/c/${CID}/assets?kind=world&name=${encodeURIComponent(f.name)}`, { method: 'POST', raw: f, headers: { 'Content-Type': f.type || 'application/octet-stream' } });
      await api(W('/image'), { method: 'POST', body: { ref: a.ref } });
      S.upload = false; S.svg = null; S.view = null;
      await load();
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
  </div>`;
}

// ---------------------------------------------------------------- Coquille

function App() {
  useWorld();
  useEffect(() => {
    load();
    const k = e => { if (e.key === 'Escape') { if (S.mode) S.mode = null; else select(null); refresh(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    if (S.data?.role === 'dm' && S.data.vault && !S.notes) api(W('/notes')).then(n => { S.notes = n; refresh(); }).catch(() => {});
  }, [S.data]);
  if (S.error === 'login') {
    return html`<div class="join"><div class="join-card"><h1>Carte du monde</h1><p>${token() ? 'Tu ne fais pas partie de cette campagne.' : 'Connecte-toi d\'abord à l\'application.'}</p><a class="btn primary" href="/">Mes campagnes</a></div></div>`;
  }
  if (S.error) return html`<div class="join"><div class="join-card"><h1>Carte du monde</h1><p class="warn">${S.error}</p><button type="button" class="btn" onClick=${load}>Réessayer</button></div></div>`;
  if (!S.data) return html`<div class="boot">Chargement de la carte…</div>`;
  if (S.data.missing || S.upload) {
    return html`<div class="join"><div class="join-card w-upload"><h1>Carte du monde</h1>
      ${S.data.role === 'dm' ? html`<${UploadWorld} />` : html`<p>Le MJ n'a pas encore mis de carte du monde.</p>`}
      <div class="row-btns">${S.upload ? html`<button type="button" class="btn ghost" onClick=${() => { S.upload = false; refresh(); }}>Annuler</button>` : null}<a class="btn ghost" href=${`/c/${CID}`}>Retour aux fiches</a></div></div></div>`;
  }
  return html`<div class=${`w-app ${S.sel ? 'with-card' : ''}`}>
    <${TopBar} />
    <main class="w-main">
      <${Stage} />
      <${Card} />
    </main>
    ${S.notes ? html`<datalist id="w-notes">${S.notes.map(n => html`<option value=${n} />`)}</datalist>` : null}
    <div class="w-toasts">${S.toasts.map(t => html`<div class=${`w-toast ${t.kind}`}>${t.text}</div>`)}</div>
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
