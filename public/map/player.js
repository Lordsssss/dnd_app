// L'onglet « Carte » d'un joueur : la carte de la TV sous son brouillard, ses tokens à déplacer,
// et le calque où chacun colle des images et dessine. Le MJ peut verrouiller la vue sur la TV,
// bloquer les tokens ou couper les images et les dessins ; le serveur vérifie tout, cet écran
// ne fait que suivre.
import '/app/store.js';
import { t, tx } from '/shared/i18n.js';
import { applyUpdate } from '/shared/map/ops.js';
import { indexFor } from '/shared/map/view.js';
import { lineOfSight } from '/shared/map/vision.js';
import { sceneBounds } from '/shared/map/scene.js';
import { html, render, useEffect, useRef, useState } from '/app/html.js';
import { campaignId, connectMap, getToken, goLogin, viewAs } from './net.js';
import { loadMap } from './images.js';
import { boundsRect, drawScene, fitCamera, label } from './render.js';
import { OverlayLayer, PEN_COLORS, PEN_WIDTHS, defaultImageSize, fetchPaste, pickTransfer, uploadPaste } from './overlay.js';

const savedPen = (() => { try { return JSON.parse(localStorage.getItem('mapPen')) || {}; } catch { return {}; } })();

const P = {
  conn: 'connecting',
  denied: null,
  me: null,
  campaign: null,
  table: { lock: false, blockTokens: false, draw: true, onTv: true },
  canDraw: false,
  sceneId: null,
  doc: null,
  frozenDoc: null,
  rev: 0,
  mapImage: null,
  mapPath: null,
  size: { w: 800, h: 600 },
  cam: { x: 0, y: 0, z: 20 },
  framed: false,
  tool: 'move',        // 'move' : vue, tokens et images ; 'pen' : dessiner ; 'erase' : effacer
  pen: { color: PEN_COLORS.includes(savedPen.color) ? savedPen.color : PEN_COLORS[0], width: PEN_WIDTHS.includes(savedPen.width) ? savedPen.width : PEN_WIDTHS[1] },
  draft: null,         // trait en cours : { points, color, width }
  drag: null,          // token en cours de déplacement
  settling: null,      // positions gardées jusqu'à la réponse du serveur
  pointer: null,       // dernière position de la souris, en cases
  selItem: null,
  toasts: [],
};

let conn = null;
let overlay = null;
let canvas = null;
let drawScheduled = false;
const subs = new Set();
const notify = () => { for (const fn of subs) fn(); };

function requestDraw() {
  if (drawScheduled) return;
  drawScheduled = true;
  requestAnimationFrame(() => { drawScheduled = false; draw(); });
}
const refresh = () => { notify(); requestDraw(); };

let toastSeq = 0;
function toast(text, kind = 'info', ms = 3500) {
  const it = { id: ++toastSeq, text: tx(text), kind };
  P.toasts = [...P.toasts.slice(-2), it];
  notify();
  setTimeout(() => { P.toasts = P.toasts.filter(x => x.id !== it.id); notify(); }, ms);
}

// --------------------------------------------------------------- Caméra

const tvRect = doc => doc.tvCamera || boundsRect(doc);
const locked = () => !!P.table.lock && !!P.doc;
function camera() {
  if (!P.doc) return P.cam;
  return locked() ? fitCamera(tvRect(P.doc), P.size.w, P.size.h) : P.cam;
}
function frameTv() {
  if (!P.doc) return;
  P.cam = fitCamera(tvRect(P.doc), P.size.w, P.size.h);
  requestDraw();
}
const toWorld = (sx, sy) => { const c = camera(); return { x: c.x + sx / c.z, y: c.y + sy / c.z }; };

// --------------------------------------------------------------- Dessin

// Gelée par le MJ : la carte reste telle qu'elle était, comme sur la TV.
const shown = () => (P.doc?.frozen && P.frozenDoc ? P.frozenDoc : P.doc);

function snapToken(x, y, size = 1) {
  if (size % 2 === 0) return { x: Math.round(x), y: Math.round(y) };
  return { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
}

function ownRing(ctx, tk, z, pos) {
  const r = ((tk.size || 1) / 2) * 1.02;
  ctx.save();
  ctx.strokeStyle = 'rgba(79,195,255,.9)';
  ctx.lineWidth = 2 / z;
  ctx.setLineDash([5 / z, 4 / z]);
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function overlays(ctx, z) {
  const doc = shown();
  const d = P.drag;
  for (const tk of doc.tokens) {
    if (!tk.own) continue;
    const pos = d?.moved && d.id === tk.id ? d.to : P.settling?.get(tk.id) || tk;
    ownRing(ctx, tk, z, pos);
  }
  if (d?.moved && !d.pan) {
    ctx.save();
    ctx.strokeStyle = d.blocked ? '#ff5a4f' : '#ffe066';
    ctx.lineWidth = 3 / z;
    ctx.setLineDash([9 / z, 6 / z]);
    ctx.beginPath();
    ctx.moveTo(d.from.x, d.from.y);
    ctx.lineTo(d.to.x, d.to.y);
    ctx.stroke();
    ctx.restore();
    label(ctx, d.blocked ? tx('Un mur bloque le passage') : `${d.feet} ft`, d.to.x, d.to.y - ((d.size || 1) / 2) - 16 / z, z, 15);
  }
}

function draw() {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const doc = shown();
  if (!doc) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    overlay?.render({ doc: null, cam: P.cam });
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const cam = camera();
  const positions = new Map(P.settling || []);
  if (P.drag?.moved && !P.drag.pan) positions.set(P.drag.id, P.drag.to);
  const rev = doc === P.doc ? P.rev : -1;
  drawScene(ctx, doc, cam, {
    role: 'tv', dpr, rev, mapImage: P.mapImage, live: P.live || {},
    fog: { alpha: 1, soft: Math.min(4, cam.z * dpr * 0.03) },
    dragging: positions.size ? positions : null, onImage: requestDraw, afterFog: overlays,
  });
  overlay?.render({ doc, cam, draft: P.draft });
}

// --------------------------------------------------------------- Connexion

async function useMap(path) {
  if (path === P.mapPath) return;
  P.mapPath = path;
  P.mapImage = null;
  requestDraw();
  if (!path) return;
  try {
    const m = await loadMap(path);
    if (P.mapPath === path) { P.mapImage = m; requestDraw(); }
  } catch (e) { toast(e.message, 'error', 6000); }
}

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      P.me = m.me;
      P.campaign = m.campaign;
      if (m.campaign) document.title = `${tx('Carte')} · ${m.campaign.name}`;
      if (!m.tvScene) { P.doc = null; P.sceneId = null; }
      refresh();
      break;
    case 'scenes':
      // La TV n'affiche plus rien : l'onglet non plus.
      if (!m.tvScene) { P.doc = null; P.sceneId = null; overlay?.setAll([]); refresh(); }
      break;
    case 'table': {
      // La vue verrouillée devient la vue libre au déverrouillage : rien ne saute.
      const before = camera();
      const wasLocked = P.table.lock;
      P.table = m.table;
      P.canDraw = !!m.canDraw;
      if (!P.canDraw) { P.tool = 'move'; P.draft = null; }
      if (wasLocked && !P.table.lock) P.cam = before;
      if (P.table.lock && P.drag?.pan) P.drag = null;
      refresh();
      break;
    }
    case 'summon':
      frameTv();
      toast('Le MJ a ramené la vue sur la TV', 'info', 2000);
      break;
    case 'scene': {
      const changed = m.scene !== P.sceneId;
      P.sceneId = m.scene;
      P.doc = m.doc;
      P.rev = m.rev + 1;
      P.frozenDoc = m.doc.frozen ? structuredClone(m.doc) : null;
      P.drag = null;
      P.settling = null;
      P.draft = null;
      if (changed || !P.framed) { P.framed = true; frameTv(); }
      useMap(P.doc.image);
      refresh();
      break;
    }
    case 'update': {
      if (m.scene !== P.sceneId || !P.doc) return;
      const wasFrozen = !!P.doc.frozen;
      applyUpdate(P.doc, m);
      P.rev = m.rev + 1;
      if (!wasFrozen && P.doc.frozen) P.frozenDoc = structuredClone(P.doc);
      if (!P.doc.frozen) P.frozenDoc = null;
      if (m.set.image !== undefined) useMap(P.doc.image);
      refresh();
      break;
    }
    case 'live':
      if (m.scene === P.sceneId) { P.live = { ...(P.live || {}), ...m.live }; requestDraw(); }
      break;
    case 'overlay': if (m.scene === P.sceneId) { overlay?.setAll(m.items); refresh(); } break;
    case 'itemSet': if (m.scene === P.sceneId) { overlay?.set(m.item); notify(); } break;
    case 'itemGone': if (m.scene === P.sceneId) { overlay?.remove(m.ids); notify(); } break;
    default: break;
  }
}

function start() {
  conn = connectMap('player', {
    on: onMessage,
    onState(s, reason) {
      P.conn = s;
      if (s === 'denied') P.denied = reason || tx('Tu ne fais pas partie de cette campagne');
      notify();
    },
  });
}

async function send(msg) {
  const r = await conn.request(msg);
  if (!r.ok) toast(r.error || 'Action refusée', 'error');
  return r;
}

// Vue joueur du MJ : l'onglet tel que le joueur le voit, sans rien pouvoir y faire.
let readOnlyShown = 0;
function previewBlocked() {
  if (!P.me?.preview) return false;
  if (Date.now() - readOnlyShown > 2500) { readOnlyShown = Date.now(); toast('Vue joueur : lecture seule', 'info', 2500); }
  return true;
}

// --------------------------------------------------------------- Images et traits

const mine = it => it.by === P.me?.id;

function viewCenter() {
  const c = camera();
  return { x: c.x + P.size.w / (2 * c.z), y: c.y + P.size.h / (2 * c.z) };
}

// Une image collée, glissée ou choisie : envoyée, puis posée là où pointe la souris.
async function pasteImage(src, at = P.pointer || viewCenter()) {
  if (previewBlocked()) return;
  if (!P.canDraw) { toast('Le MJ a coupé tes images et tes dessins', 'error'); return; }
  try {
    toast('Image en route…', 'info', 1500);
    const image = src.file ? await uploadPaste(src.file) : await fetchPaste(src.url);
    send({ t: 'draw', action: 'add', item: { kind: 'image', image: image.ref, x: at.x, y: at.y, size: defaultImageSize(camera(), P.size) } });
  } catch (e) { toast(e.message, 'error', 5000); }
}

function pickFile() {
  if (previewBlocked()) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp';
  input.onchange = () => { if (input.files[0]) pasteImage({ file: input.files[0] }, viewCenter()); };
  input.click();
}

function setTool(tool) {
  if (tool !== 'move' && previewBlocked()) return;
  P.tool = tool;
  P.draft = null;
  overlay?.select(null);
  refresh();
}

function setPen(patch) {
  P.pen = { ...P.pen, ...patch };
  try { localStorage.setItem('mapPen', JSON.stringify(P.pen)); } catch { /* stockage indisponible */ }
  if (P.tool !== 'pen') P.tool = 'pen';
  refresh();
}

function clearMine() {
  if (previewBlocked()) return;
  const n = overlay?.countBy(P.me?.id) || 0;
  if (!n) { toast('Rien à effacer : tu n\'as rien posé sur cette carte', 'info', 2500); return; }
  if (!confirm(tx('Effacer tout ce que tu as collé et dessiné sur cette carte ?'))) return;
  send({ t: 'draw', action: 'clearMine' });
}

// La gomme : un trait à soi sous le doigt s'efface. Une image s'efface en la touchant.
const erasing = new Set();
function eraseAt(w) {
  const it = overlay?.strokeAt(w.x, w.y, camera().z, x => mine(x) && !erasing.has(x.id));
  if (!it) return;
  erasing.add(it.id);
  send({ t: 'draw', action: 'remove', ids: [it.id] }).finally(() => erasing.delete(it.id));
}

// --------------------------------------------------------------- Souris et doigts

function tokenAt(doc, x, y) {
  for (let i = doc.tokens.length - 1; i >= 0; i--) {
    const tk = doc.tokens[i];
    if (!tk.own) continue;
    const r = (tk.size || 1) / 2;
    if (Math.abs(x - tk.x) <= r && Math.abs(y - tk.y) <= r) return tk;
  }
  return null;
}

function dragTarget(d, w, free) {
  const doc = P.doc;
  const raw = { x: d.from.x + (w.x - d.start.x), y: d.from.y + (w.y - d.start.y) };
  const to = free ? raw : snapToken(raw.x, raw.y, d.size);
  const b = sceneBounds(doc);
  to.x = Math.max(b.minX, Math.min(b.maxX, to.x));
  to.y = Math.max(b.minY, Math.min(b.maxY, to.y));
  // Une diagonale compte une case, comme la règle du MJ.
  const cells = Math.max(Math.abs(to.x - d.from.x), Math.abs(to.y - d.from.y));
  d.to = to;
  d.feet = Math.round(cells) * (doc.grid.feetPerCell || 5);
  d.blocked = !lineOfSight(indexFor(doc), d.from.x, d.from.y, to.x, to.y);
}

function bindCanvas(el) {
  const pointers = new Map();
  let pinch = null;

  const pos = e => { const r = el.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };

  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId);
    const { sx, sy } = pos(e);
    pointers.set(e.pointerId, { sx, sy });
    overlay?.select(null);
    // Deux doigts : on zoome, même au milieu d'un trait.
    if (pointers.size === 2 && !locked()) {
      const [a, b] = [...pointers.values()];
      P.drag = null;
      P.draft = null;
      pinch = { d: Math.hypot(a.sx - b.sx, a.sy - b.sy), mid: { sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 }, cam: { ...P.cam } };
      requestDraw();
      return;
    }
    if (e.button === 2) return;
    const w = toWorld(sx, sy);
    const doc = shown();
    if (!doc) return;
    if (P.tool === 'pen' && P.canDraw) {
      P.draft = { points: [[w.x, w.y]], color: P.pen.color, width: P.pen.width, sx, sy };
      requestDraw();
      return;
    }
    if (P.tool === 'erase' && P.canDraw) { P.drag = { erase: true }; eraseAt(w); return; }
    const tok = !P.doc.frozen && !P.table.blockTokens ? tokenAt(doc, w.x, w.y) : null;
    if (tok && previewBlocked()) return;
    if (tok) {
      P.drag = { id: tok.id, size: tok.size || 1, from: { x: tok.x, y: tok.y }, start: w, sx, sy, moved: false, to: { x: tok.x, y: tok.y }, feet: 0 };
    } else if (!locked()) {
      P.drag = { pan: true, sx, sy, cam: { ...P.cam } };
    }
  });

  el.addEventListener('pointermove', e => {
    const { sx, sy } = pos(e);
    P.pointer = toWorld(sx, sy);
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { sx, sy });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.sx - b.sx, a.sy - b.sy);
      const z = Math.max(1.5, Math.min(260, pinch.cam.z * (d / Math.max(1, pinch.d))));
      const wx = pinch.cam.x + pinch.mid.sx / pinch.cam.z;
      const wy = pinch.cam.y + pinch.mid.sy / pinch.cam.z;
      const mx = (a.sx + b.sx) / 2;
      const my = (a.sy + b.sy) / 2;
      P.cam = { z, x: wx - mx / z, y: wy - my / z };
      requestDraw();
      return;
    }
    if (P.draft) {
      // Un point tous les deux pixels : un trait fluide sans milliers de points.
      if (Math.hypot(sx - P.draft.sx, sy - P.draft.sy) < 2) return;
      P.draft.sx = sx;
      P.draft.sy = sy;
      P.draft.points.push([P.pointer.x, P.pointer.y]);
      requestDraw();
      return;
    }
    const d = P.drag;
    if (!d) return;
    if (d.erase) { eraseAt(P.pointer); return; }
    if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 4) return;
    d.moved = true;
    if (d.pan) {
      if (locked()) { P.drag = null; return; }
      P.cam = { ...d.cam, x: d.cam.x - (sx - d.sx) / d.cam.z, y: d.cam.y - (sy - d.sy) / d.cam.z };
    } else dragTarget(d, toWorld(sx, sy), e.altKey);
    requestDraw();
  });

  const end = e => {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (P.draft) {
      const draft = P.draft;
      P.draft = null;
      if (previewBlocked()) { requestDraw(); return; }
      const points = draft.points.map(p => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
      // Le trait reste affiché jusqu'à ce que le serveur le renvoie.
      const pending = { id: `draft-${Date.now()}`, kind: 'stroke', points, color: draft.color, width: draft.width, by: P.me?.id };
      overlay?.set(pending);
      send({ t: 'draw', action: 'add', item: { kind: 'stroke', points, color: draft.color, width: draft.width } })
        .finally(() => overlay?.remove([pending.id]));
      requestDraw();
      return;
    }
    const d = P.drag;
    P.drag = null;
    if (!d || d.pan || d.erase || !d.moved) { requestDraw(); return; }
    if (d.blocked) { toast('Un mur bloque le passage', 'error', 2000); requestDraw(); return; }
    const settling = new Map([[d.id, d.to]]);
    P.settling = settling;
    send({ t: 'op', scene: P.sceneId, op: { type: 'token.move', moves: [{ id: d.id, x: d.to.x, y: d.to.y }] } })
      .finally(() => { if (P.settling === settling) P.settling = null; requestDraw(); });
    requestDraw();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('wheel', e => {
    e.preventDefault();
    if (locked()) return;
    const { sx, sy } = pos(e);
    const w = toWorld(sx, sy);
    const z = Math.max(1.5, Math.min(260, P.cam.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0014))));
    P.cam = { z, x: w.x - sx / z, y: w.y - sy / z };
    requestDraw();
  }, { passive: false });
}

// --------------------------------------------------------------- Interface

function MapView() {
  const wrap = useRef(null);
  const ref = useRef(null);
  const layer = useRef(null);
  useEffect(() => {
    canvas = ref.current;
    overlay = new OverlayLayer(layer.current, {
      interactive: true,
      canEdit: it => P.canDraw && !P.me?.preview && mine(it),
      mode: () => P.tool,
      onUpdate: (id, patch) => send({ t: 'draw', action: 'update', itemId: id, patch }),
      onRemove: id => send({ t: 'draw', action: 'remove', ids: [id] }),
      onSelect: id => { P.selItem = id; },
    });
    const fit = () => {
      const r = wrap.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      P.size = { w: r.width, h: r.height };
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      requestDraw();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(wrap.current);
    fit();
    bindCanvas(canvas);
    start();
    return () => ro.disconnect();
  }, []);
  return html`<div class=${`mc-wrap pl-wrap tool-${P.tool}`} ref=${wrap}>
    <canvas class="mc" ref=${ref}></canvas>
    <div class="ov-layer" ref=${layer}></div>
  </div>`;
}

function Banners() {
  const out = [];
  if (P.me?.preview) out.push(['preview', `👁 ${t('Vue joueur : {name}, en lecture seule', { name: P.me.name })}`]);
  if (P.table.lock) out.push(['lock', 'Le MJ a verrouillé la vue sur la TV']);
  if (P.doc?.frozen) out.push(['warn', 'Carte gelée : le MJ replace la scène']);
  else if (P.table.blockTokens) out.push(['warn', 'Le MJ a bloqué les tokens']);
  if (!out.length) return null;
  return html`<div class="pl-banners">${out.map(([k, text]) => html`<div class=${`pl-banner ${k}`}>${k === 'lock' ? '🔒 ' : ''}${text}</div>`)}</div>`;
}

function Toolbar() {
  if (!P.doc) return null;
  const recenter = locked() ? null : html`<button type="button" class="btn tiny" title="Revenir au cadrage de la TV" onClick=${frameTv}>⤢</button>`;
  if (!P.canDraw) {
    return html`<div class="pl-bar"><span class="muted small">Le MJ a coupé les images et les dessins</span>${recenter}</div>`;
  }
  const tool = (id, icon, text, title) => html`<button type="button" class=${`btn tiny ${P.tool === id ? 'on' : ''}`} title=${title} onClick=${() => setTool(id)}>${icon} ${text}</button>`;
  return html`<div class="pl-bar">
    <div class="pl-tools">
      ${tool('move', '✋', 'Déplacer', 'Bouger la vue, tes tokens et tes images')}
      ${tool('pen', '✎', 'Dessiner', 'Dessiner à main levée')}
      ${tool('erase', '⌫', 'Gomme', 'Toucher un de tes traits ou une de tes images l\'efface')}
    </div>
    ${P.tool === 'pen' ? html`<div class="pl-pen">
      ${PEN_COLORS.map(c => html`<button type="button" class=${`swatch ${P.pen.color === c ? 'on' : ''}`} aria-label=${c} style=${{ background: c }} onClick=${() => setPen({ color: c })}></button>`)}
      ${PEN_WIDTHS.map((w, i) => html`<button type="button" class=${`pen-w ${P.pen.width === w ? 'on' : ''}`} title=${['Fin', 'Moyen', 'Épais'][i]} onClick=${() => setPen({ width: w })}><span style=${{ width: `${4 + i * 4}px`, height: `${4 + i * 4}px` }}></span></button>`)}
    </div>` : null}
    <span class="sep"></span>
    <button type="button" class="btn tiny" title="Une image ou un GIF · aussi Ctrl+V ou glisser-déposer" onClick=${pickFile}>🖼 Image</button>
    <button type="button" class="btn tiny danger ghost" title="Effacer tout ce que tu as collé et dessiné sur cette carte" onClick=${clearMine}>🗑 Tout effacer</button>
    ${recenter}
  </div>`;
}

function TopLine() {
  return html`<header class="pl-top">
    <a class="home" href=${`/c/${campaignId}${viewAs ? `?as=${encodeURIComponent(viewAs)}` : ''}`} title="Retour aux fiches">⚔</a>
    <span class="camp-name">${P.campaign?.name || ''}</span>
    <span class="grow"></span>
    <span class=${`conn-dot ${P.conn}`} title=${P.conn === 'online' ? 'Connecté' : 'Hors ligne'}></span>
  </header>`;
}

function App() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force(x => x + 1);
    subs.add(fn);
    const key = e => {
      const tg = e.target;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') { P.draft = null; overlay?.select(null); setTool('move'); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && P.selItem && overlay?.get(P.selItem)) send({ t: 'draw', action: 'remove', ids: [P.selItem] });
    };
    const paste = e => {
      const tg = e.target;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return;
      if (!P.doc) return;
      const src = pickTransfer(e.clipboardData);
      if (src) { e.preventDefault(); pasteImage(src); }
    };
    const over = e => { if (P.doc && P.canDraw) e.preventDefault(); };
    const drop = e => {
      if (!P.doc) return;
      e.preventDefault();
      const src = pickTransfer(e.dataTransfer);
      if (!src) return;
      const r = canvas.getBoundingClientRect();
      pasteImage(src, toWorld(e.clientX - r.left, e.clientY - r.top));
    };
    window.addEventListener('keydown', key);
    window.addEventListener('paste', paste);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      subs.delete(fn);
      window.removeEventListener('keydown', key);
      window.removeEventListener('paste', paste);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
  if (!getToken()) {
    return html`<div class="join"><div class="join-card"><h1>Carte</h1><p class="muted">Connecte-toi d'abord à l'application.</p>
      <button type="button" class="btn primary" onClick=${goLogin}>Se connecter</button></div></div>`;
  }
  if (P.denied) {
    return html`<div class="join"><div class="join-card"><h1>Carte</h1><p>${P.denied}</p>
      <a class="btn" href="/">Mes campagnes</a></div></div>`;
  }
  return html`<div class="pl-app">
    <${TopLine} />
    <div class="pl-main">
      <${MapView} />
      ${!P.doc && P.conn === 'online' ? html`<div class="mc-msg big">La TV n'affiche aucune carte pour l'instant.</div>` : null}
      <${Banners} />
      <${Toolbar} />
    </div>
    <div class="map-toasts">${P.toasts.map(x => html`<div key=${x.id} class=${`m-toast ${x.kind}`}>${x.text}</div>`)}</div>
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
