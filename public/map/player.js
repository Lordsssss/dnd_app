// L'onglet « Carte » d'un joueur : la carte de la TV sous son brouillard, ses tokens à déplacer,
// et le calque de memes. Le MJ peut verrouiller la vue sur la TV, bloquer les tokens ou couper
// les memes ; le serveur vérifie tout, cet écran ne fait que suivre.
import '/app/store.js';
import { tx } from '/shared/i18n.js';
import { applyUpdate } from '/shared/map/ops.js';
import { indexFor } from '/shared/map/view.js';
import { lineOfSight } from '/shared/map/vision.js';
import { sceneBounds } from '/shared/map/scene.js';
import { html, render, useEffect, useRef, useState } from '/app/html.js';
import { campaignId, connectMap, getToken, goLogin } from './net.js';
import { loadMap } from './images.js';
import { boundsRect, drawScene, fitCamera, label, viewFor } from './render.js';
import {
  MemeMaker, MemeOverlay, REACTIONS, ShelfDialog, defaultSize, fetchMeme, pickTransfer, uploadMeme,
} from './memes.js';

const P = {
  conn: 'connecting',
  denied: null,
  me: null,
  campaign: null,
  table: { lock: false, blockTokens: false, memes: true, memesOnTv: true, serious: false },
  canMeme: false,
  sceneId: null,
  doc: null,
  frozenDoc: null,
  rev: 0,
  mapImage: null,
  mapPath: null,
  size: { w: 800, h: 600 },
  cam: { x: 0, y: 0, z: 20 },
  framed: false,
  drag: null,          // token en cours de déplacement
  settling: null,      // positions gardées jusqu'à la réponse du serveur
  dialog: null,
  menu: null,          // menu des memes ouvert par un appui long : { sx, sy, w }
  armed: null,         // réaction prête à poser au prochain clic
  pin: null,           // meme en attente d'un token où se coller
  pointer: null,       // dernière position de la souris, en cases
  selMeme: null,
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
  const t = { id: ++toastSeq, text: tx(text), kind };
  P.toasts = [...P.toasts.slice(-2), t];
  notify();
  setTimeout(() => { P.toasts = P.toasts.filter(x => x.id !== t.id); notify(); }, ms);
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

function ownRing(ctx, t, z, pos) {
  const r = ((t.size || 1) / 2) * 1.02;
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
  for (const t of doc.tokens) {
    if (!t.own) continue;
    const pos = d?.moved && d.id === t.id ? d.to : P.settling?.get(t.id) || t;
    ownRing(ctx, t, z, pos);
  }
  if (P.pin) {
    for (const t of doc.tokens) {
      const r = ((t.size || 1) / 2) * 1.08;
      ctx.save();
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 2.5 / z;
      ctx.beginPath();
      ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  if (d?.moved) {
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
  if (P.drag?.moved) positions.set(P.drag.id, P.drag.to);
  const rev = doc === P.doc ? P.rev : -1;
  drawScene(ctx, doc, cam, {
    role: 'tv', dpr, rev, mapImage: P.mapImage, live: P.live || {},
    fog: { alpha: 1, soft: Math.min(4, cam.z * dpr * 0.03) },
    dragging: positions.size ? positions : null, onImage: requestDraw, afterFog: overlays,
  });
  overlay?.render({ doc, cam, seen: viewFor(doc, rev).seen, hidden: P.table.serious, positions });
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
      P.canMeme = !!m.canMeme;
      if (!P.canMeme) { P.armed = null; P.menu = null; }
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
      P.pin = null;
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
    case 'memes': if (m.scene === P.sceneId) { overlay?.setAll(m.memes); requestDraw(); } break;
    case 'memeSet': if (m.scene === P.sceneId) overlay?.set(m.meme); break;
    case 'memeGone': if (m.scene === P.sceneId) overlay?.remove(m.ids); break;
    case 'react': if (m.scene === P.sceneId) overlay?.react(m.r); break;
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

// --------------------------------------------------------------- Memes

function memeAt() {
  if (P.pointer) return P.pointer;
  const c = camera();
  return { x: c.x + P.size.w / (2 * c.z), y: c.y + P.size.h / (2 * c.z) };
}

async function takeImage(src, at = memeAt()) {
  if (!P.canMeme) { toast('Le MJ a coupé tes memes', 'error'); return; }
  try {
    toast('Image en route…', 'info', 1500);
    const image = src.file ? await uploadMeme(src.file) : await fetchMeme(src.url);
    P.dialog = { kind: 'maker', mk: 'image', image, at };
    notify();
  } catch (e) { toast(e.message, 'error', 5000); }
}

function placeMeme({ kind, image, top, bottom, text, ttl, at, size }) {
  const cam = camera();
  send({ t: 'meme', action: 'add', meme: {
    kind, image: image?.ref || image || '', name: image?.name || '', top, bottom, text, ttl,
    x: at.x, y: at.y, size: size || defaultSize(kind, cam, P.size),
  } });
}

function react(emoji, at) {
  if (!P.canMeme) return;
  const doc = shown();
  const t = doc && emoji !== 'ping' ? tokenAt(doc, at.x, at.y, false) : null;
  send({ t: 'react', emoji, x: at.x, y: at.y, token: t?.id || null });
}

function pinMeme(m) {
  const at = overlay.where(m);
  if (!at) return;
  if (m.attach) { send({ t: 'meme', action: 'update', memeId: m.id, patch: { attach: null, x: at.x, y: at.y } }); return; }
  P.pin = { id: m.id, at };
  refresh();
}

function pickFile(at) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp';
  input.onchange = () => { if (input.files[0]) takeImage({ file: input.files[0] }, at); };
  input.click();
}

// --------------------------------------------------------------- Souris et doigts

function tokenAt(doc, x, y, ownOnly = true) {
  for (let i = doc.tokens.length - 1; i >= 0; i--) {
    const t = doc.tokens[i];
    if (ownOnly && !t.own) continue;
    const r = (t.size || 1) / 2;
    if (Math.abs(x - t.x) <= r && Math.abs(y - t.y) <= r) return t;
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
  let press = null;

  const pos = e => { const r = el.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };
  const openMenu = (sx, sy) => {
    if (!P.canMeme) return;
    P.menu = { sx, sy, w: toWorld(sx, sy) };
    P.drag = null;
    notify();
  };

  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId);
    const { sx, sy } = pos(e);
    pointers.set(e.pointerId, { sx, sy });
    overlay?.select(null);
    if (P.menu) { P.menu = null; notify(); }
    if (pointers.size === 2 && !locked()) {
      const [a, b] = [...pointers.values()];
      P.drag = null;
      clearTimeout(press?.timer);
      press = null;
      pinch = { d: Math.hypot(a.sx - b.sx, a.sy - b.sy), mid: { sx: (a.sx + b.sx) / 2, sy: (a.sy + b.sy) / 2 }, cam: { ...P.cam } };
      return;
    }
    if (e.button === 2) return;
    const w = toWorld(sx, sy);
    const doc = shown();
    if (!doc) return;
    if (P.pin) {
      const t = tokenAt(doc, w.x, w.y, false);
      const pin = P.pin;
      P.pin = null;
      if (t) send({ t: 'meme', action: 'update', memeId: pin.id, patch: { attach: t.id, x: pin.at.x - t.x, y: pin.at.y - t.y } });
      else toast('Pas de token ici', 'info', 1500);
      refresh();
      return;
    }
    if (P.armed) { react(P.armed, w); return; }
    const tok = !P.doc.frozen && !P.table.blockTokens ? tokenAt(doc, w.x, w.y) : null;
    if (tok) {
      P.drag = { id: tok.id, size: tok.size || 1, from: { x: tok.x, y: tok.y }, start: w, sx, sy, moved: false, to: { x: tok.x, y: tok.y }, feet: 0 };
    } else if (!locked()) {
      P.drag = { pan: true, sx, sy, cam: { ...P.cam } };
    }
    // Appui long du doigt : le menu des memes, à cet endroit. À la souris : le clic droit.
    if (e.pointerType !== 'mouse') press = { sx, sy, timer: setTimeout(() => { if (!P.drag?.moved) openMenu(sx, sy); press = null; }, 520) };
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
    const d = P.drag;
    if (press && Math.hypot(sx - press.sx, sy - press.sy) > 8) { clearTimeout(press.timer); press = null; }
    if (!d) return;
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
    if (press) { clearTimeout(press.timer); press = null; }
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    const d = P.drag;
    P.drag = null;
    if (!d || d.pan || !d.moved) { requestDraw(); return; }
    if (d.blocked) { toast('Un mur bloque le passage', 'error', 2000); requestDraw(); return; }
    const settling = new Map([[d.id, d.to]]);
    P.settling = settling;
    send({ t: 'op', scene: P.sceneId, op: { type: 'token.move', moves: [{ id: d.id, x: d.to.x, y: d.to.y }] } })
      .finally(() => { if (P.settling === settling) P.settling = null; requestDraw(); });
    requestDraw();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('contextmenu', e => { e.preventDefault(); const { sx, sy } = pos(e); openMenu(sx, sy); });
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
    overlay = new MemeOverlay(layer.current, {
      interactive: true,
      canEdit: m => P.canMeme && (m.by === P.me?.id || !!P.me?.dm),
      onUpdate: (id, patch) => send({ t: 'meme', action: 'update', memeId: id, patch }),
      onRemove: id => send({ t: 'meme', action: 'remove', ids: [id] }),
      onEdit: m => { P.dialog = { kind: 'maker', mk: m.kind, image: m.image ? { ref: m.image } : null, edit: m }; notify(); },
      onPin: pinMeme,
      onSelect: id => { P.selMeme = id; },
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
  return html`<div class="mc-wrap pl-wrap" ref=${wrap}>
    <canvas class="mc" ref=${ref}></canvas>
    <div class="meme-host" ref=${layer}></div>
  </div>`;
}

function Banners() {
  const out = [];
  if (P.table.lock) out.push(['lock', 'Le MJ a verrouillé la vue sur la TV']);
  if (P.doc?.frozen) out.push(['warn', 'Carte gelée : le MJ replace la scène']);
  else if (P.table.blockTokens) out.push(['warn', 'Le MJ a bloqué les tokens']);
  if (P.table.serious) out.push(['info', 'Mode sérieux : memes cachés']);
  if (P.pin) out.push(['info', 'Touche un token pour y coller le meme · Échap pour annuler']);
  if (P.armed) out.push(['info', 'Touche la carte pour poser la réaction · Échap pour arrêter']);
  if (!out.length) return null;
  return html`<div class="pl-banners">${out.map(([k, text]) => html`<div class=${`pl-banner ${k}`}>${k === 'lock' ? '🔒 ' : ''}${text}</div>`)}</div>`;
}

function MemeMenu() {
  const m = P.menu;
  if (!m) return null;
  const close = () => { P.menu = null; notify(); };
  const left = Math.max(8, Math.min(P.size.w - 268, m.sx - 130));
  const top = Math.max(52, Math.min(P.size.h - 150, m.sy - 20));
  return html`<div class="meme-menu" style=${{ left: `${left}px`, top: `${top}px` }} onPointerDown=${e => e.stopPropagation()}>
    <div class="meme-menu-row">
      ${REACTIONS.map(r => html`<button type="button" class="react-b" onClick=${() => { react(r, m.w); close(); }}>${r}</button>`)}
      <button type="button" class="react-b ping-b" title="Repère : « ici ! »" onClick=${() => { react('ping', m.w); close(); }}>📍</button>
    </div>
    <div class="meme-menu-row">
      <button type="button" class="chip" onClick=${() => { close(); pickFile(m.w); }}>🖼 Image</button>
      <button type="button" class="chip" onClick=${() => { P.menu = null; P.dialog = { kind: 'maker', mk: 'text', at: m.w }; notify(); }}>Aa Texte</button>
      <button type="button" class="chip" onClick=${() => { P.menu = null; P.dialog = { kind: 'shelf', at: m.w }; notify(); }}>📚 Mèmothèque</button>
    </div>
  </div>`;
}

function Toolbar() {
  if (!P.doc) return null;
  if (!P.canMeme) {
    // Rien à proposer (vue verrouillée, mode sérieux) : pas de barre du tout.
    if (P.table.serious && locked()) return null;
    return html`<div class="pl-bar">
      ${P.table.serious ? null : html`<span class="muted small">Le MJ a coupé les memes</span>`}
      ${locked() ? null : html`<button type="button" class="btn tiny" title="Revenir au cadrage de la TV" onClick=${frameTv}>⤢</button>`}
    </div>`;
  }
  const arm = r => { P.armed = P.armed === r ? null : r; refresh(); };
  return html`<div class="pl-bar">
    <div class="pl-reacts">
      ${REACTIONS.map(r => html`<button type="button" class=${`react-b ${P.armed === r ? 'on' : ''}`} onClick=${() => arm(r)}>${r}</button>`)}
      <button type="button" class=${`react-b ping-b ${P.armed === 'ping' ? 'on' : ''}`} title="Repère : « ici ! »" onClick=${() => arm('ping')}>📍</button>
    </div>
    <span class="sep"></span>
    <button type="button" class="btn tiny" title="Une image ou un GIF · aussi Ctrl+V ou glisser-déposer" onClick=${() => pickFile(memeAt())}>🖼 Image</button>
    <button type="button" class="btn tiny" onClick=${() => { P.dialog = { kind: 'maker', mk: 'text', at: memeAt() }; notify(); }}>Aa Texte</button>
    <button type="button" class="btn tiny" onClick=${() => { P.dialog = { kind: 'shelf', at: memeAt() }; notify(); }}>📚 Mèmothèque</button>
    ${locked() ? null : html`<button type="button" class="btn tiny" title="Revenir au cadrage de la TV" onClick=${frameTv}>⤢</button>`}
  </div>`;
}

function Dialogs() {
  const d = P.dialog;
  if (!d) return null;
  const close = () => { P.dialog = null; notify(); };
  if (d.kind === 'shelf') {
    return html`<${ShelfDialog} onClose=${close} toast=${toast} onPick=${m => {
      P.dialog = { kind: 'maker', mk: m.kind, image: m.image ? { ref: m.image, name: m.name } : null, initial: m, at: d.at, size: m.size };
      notify();
    }} />`;
  }
  if (d.kind === 'maker') {
    return html`<${MemeMaker} kind=${d.mk} image=${d.image} initial=${d.edit || d.initial || {}} edit=${d.edit} onClose=${close} onDone=${v => {
      close();
      if (d.edit) send({ t: 'meme', action: 'update', memeId: d.edit.id, patch: d.mk === 'text' ? { text: v.text } : { top: v.top, bottom: v.bottom } });
      else placeMeme({ kind: d.mk, image: d.image, ...v, at: d.at || memeAt(), size: d.size });
    }} />`;
  }
  return null;
}

function TopLine() {
  return html`<header class="pl-top">
    <a class="home" href=${`/c/${campaignId}`} title="Retour aux fiches">⚔</a>
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
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') { P.pin = null; P.armed = null; P.menu = null; overlay?.select(null); refresh(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && P.selMeme && overlay?.get(P.selMeme)) send({ t: 'meme', action: 'remove', ids: [P.selMeme] });
    };
    const paste = e => {
      if (P.dialog || !P.doc) return;
      const src = pickTransfer(e.clipboardData);
      if (src) { e.preventDefault(); takeImage(src); }
    };
    const over = e => { if (P.doc && P.canMeme) e.preventDefault(); };
    const drop = e => {
      if (!P.doc) return;
      e.preventDefault();
      const src = pickTransfer(e.dataTransfer);
      if (!src) return;
      const r = canvas.getBoundingClientRect();
      takeImage(src, toWorld(e.clientX - r.left, e.clientY - r.top));
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
      <${MemeMenu} />
      <${Toolbar} />
    </div>
    <${Dialogs} />
    <div class="map-toasts">${P.toasts.map(t => html`<div key=${t.id} class=${`m-toast ${t.kind}`}>${t.text}</div>`)}</div>
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
