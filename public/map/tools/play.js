// Outils de jeu : sélection et déplacement des tokens, règle, gabarits, dessin, pose de tokens.
// Un outil répond à down, move, up, key, et dessine son état dans overlay.
import { app, op, requestDraw, notify, selectedTokens, sendLive, snapToken, tokenAt, toWorld } from '../state.js';
import { drawDrawing, drawTemplate, label, templatePath, tokenBox } from '../render.js';
import { tokenImage } from '../images.js';

const DRAG_PX = 4;

// Une liste de positions autour d'un point, les plus proches d'abord : un groupe ne s'empile pas.
export function spreadAround(cx, cy, count, size) {
  const out = [];
  const step = Math.max(1, size);
  for (let r = 0; out.length < count && r < 64; r++) {
    const ring = [];
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) === r) ring.push([i, j]);
      }
    }
    ring.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
    for (const [i, j] of ring) if (out.length < count) out.push({ x: cx + i * step, y: cy + j * step });
  }
  return out;
}

export function rotateTokens(tokens, by) {
  for (const t of tokens) op({ type: 'token.update', id: t.id, patch: { rotation: (t.rotation || 0) + by } });
}

// --------------------------------------------------------------- Poignées : tourner, redimensionner

const HANDLE_PX = 8;
const KNOB_GAP_PX = 28;

function singleSelected() {
  if (app.mode !== 'play' || app.selection.size !== 1 || !app.doc) return null;
  const [id] = app.selection;
  return app.doc.tokens.find(t => t.id === id) || null;
}

// Le cadre de l'image, tourné avec elle : coins, poignée de rotation au-dessus, d'échelle en bas à droite.
function handleGeom(t) {
  const box = tokenBox(t, tokenImage(t.image));
  const a = ((t.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const at = (lx, ly) => ({ x: t.x + lx * cos - ly * sin, y: t.y + lx * sin + ly * cos });
  const hw = Math.max(box.w, 0.4) / 2;
  const hh = Math.max(box.h, 0.4) / 2;
  return {
    corners: [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)],
    edge: at(0, -hh),
    rotate: at(0, -hh - KNOB_GAP_PX / app.cam.z),
    scale: at(hw, hh),
  };
}

function handleAt(w) {
  const t = singleSelected();
  if (!t) return null;
  const g = handleGeom(t);
  const reach = (HANDLE_PX * 1.6) / app.cam.z;
  if (Math.hypot(w.x - g.rotate.x, w.y - g.rotate.y) <= reach) return { kind: 'rotate', t };
  if (Math.hypot(w.x - g.scale.x, w.y - g.scale.y) <= reach) return { kind: 'scale', t };
  return null;
}

function drawHandles(ctx, z) {
  const t = singleSelected();
  if (!t || app.t.drag?.moved) return;
  const g = handleGeom(t);
  const r = HANDLE_PX / z;
  ctx.save();
  ctx.strokeStyle = '#6fb1ff';
  ctx.lineWidth = 1.5 / z;
  ctx.setLineDash([5 / z, 4 / z]);
  ctx.beginPath();
  g.corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(g.edge.x, g.edge.y);
  ctx.lineTo(g.rotate.x, g.rotate.y);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 2 / z;
  ctx.beginPath();
  ctx.arc(g.rotate.x, g.rotate.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(g.scale.x - r * 0.85, g.scale.y - r * 0.85, r * 1.7, r * 1.7);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  const h = app.t.handle;
  if (h) label(ctx, h.kind === 'rotate' ? `${Math.round(t.rotation || 0)}°` : `× ${(t.scale || 1).toFixed(2)}`, g.rotate.x, g.rotate.y - 18 / z, z);
}

// --------------------------------------------------------------- Sélection

function doorAt(w) {
  if (!app.doc) return null;
  const reach = Math.max(0.45, 11 / app.cam.z);
  let best = null;
  for (const d of app.doc.walls) {
    if (d.kind !== 'door') continue;
    const m = doorMid(d);
    const dist = Math.hypot(m[0] - w.x, m[1] - w.y);
    if (dist <= reach && (!best || dist < best.dist)) best = { d, dist };
  }
  return best?.d || null;
}

export function doorMid(d) {
  const a = d.points[0];
  const b = d.points[d.points.length - 1];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export const selectTool = {
  id: 'select',
  // Double-clic sur un token : ses détails (PV, conditions, notes, bloc de stats).
  dbl(p) {
    const t = tokenAt(p.x, p.y);
    if (!t) return;
    app.dialog = { kind: 'token', id: t.id };
    notify();
  },
  cursor: () => {
    if (app.t.handle) return app.t.handle.kind === 'rotate' ? 'grabbing' : 'nwse-resize';
    if (app.t.overHandle) return app.t.overHandle === 'rotate' ? 'grab' : 'nwse-resize';
    return app.t.drag?.moved ? 'grabbing' : app.hover ? 'grab' : app.t.door ? 'pointer' : 'default';
  },
  down(w, e) {
    const h = handleAt(w);
    if (h) {
      app.t = { handle: { kind: h.kind, id: h.t.id, rotation: h.t.rotation || 0, scale: h.t.scale || 1, dist: Math.max(0.05, Math.hypot(w.x - h.t.x, w.y - h.t.y)) } };
      requestDraw();
      return;
    }
    const door = doorAt(w);
    const tok = tokenAt(w.x, w.y);
    if (door && !tok) { app.t = { door, start: w, sx: e.offsetX, sy: e.offsetY }; return; }
    if (tok) {
      if (e.shiftKey) {
        if (app.selection.has(tok.id)) app.selection.delete(tok.id);
        else app.selection.add(tok.id);
      } else if (!app.selection.has(tok.id)) {
        app.selection = new Set([tok.id]);
      }
      const from = new Map(selectedTokens().map(t => [t.id, { x: t.x, y: t.y, size: t.size }]));
      app.t = { drag: { from, start: w, sx: e.offsetX, sy: e.offsetY, moved: false, free: e.altKey, positions: new Map() } };
      notify();
    } else {
      if (!e.shiftKey) app.selection = new Set();
      app.t = { box: { a: w, b: w, add: e.shiftKey, base: new Set(app.selection) } };
      notify();
    }
    requestDraw();
  },
  move(w, e) {
    const { drag, box, handle } = app.t;
    if (handle) {
      const t = app.doc?.tokens.find(x => x.id === handle.id);
      if (!t) return;
      // Aperçu local ; le serveur reçoit la valeur finale au relâchement. Alt : sans calage.
      if (handle.kind === 'rotate') {
        let deg = (Math.atan2(w.y - t.y, w.x - t.x) * 180) / Math.PI + 90;
        if (!e.altKey) deg = Math.round(deg / 15) * 15;
        t.rotation = ((deg % 360) + 360) % 360;
      } else {
        let k = (handle.scale * Math.hypot(w.x - t.x, w.y - t.y)) / handle.dist;
        k = Math.max(0.2, Math.min(8, k));
        t.scale = e.altKey ? Math.round(k * 100) / 100 : Math.round(k * 20) / 20;
      }
      requestDraw();
      return;
    }
    if (drag) {
      if (!drag.moved && Math.hypot(e.offsetX - drag.sx, e.offsetY - drag.sy) < DRAG_PX) return;
      drag.moved = true;
      const dx = w.x - drag.start.x;
      const dy = w.y - drag.start.y;
      drag.positions = new Map();
      // Le groupe garde sa forme : on cale un token, les autres suivent du même écart.
      const first = drag.from.values().next().value;
      const snapped = e.altKey ? { x: first.x + dx, y: first.y + dy } : snapToken(first.x + dx, first.y + dy, first.size);
      const ox = snapped.x - first.x;
      const oy = snapped.y - first.y;
      for (const [id, p] of drag.from) drag.positions.set(id, { x: p.x + ox, y: p.y + oy });
      requestDraw();
      return;
    }
    if (box) {
      box.b = w;
      const x0 = Math.min(box.a.x, box.b.x);
      const x1 = Math.max(box.a.x, box.b.x);
      const y0 = Math.min(box.a.y, box.b.y);
      const y1 = Math.max(box.a.y, box.b.y);
      const next = new Set(box.base);
      for (const t of app.doc?.tokens || []) if (t.x >= x0 && t.x <= x1 && t.y >= y0 && t.y <= y1) next.add(t.id);
      app.selection = next;
      notify();
      requestDraw();
      return;
    }
    const tok = tokenAt(w.x, w.y);
    const id = tok ? tok.id : null;
    if (id !== app.hover) { app.hover = id; notify(); requestDraw(); }
    app.t.door = doorAt(w);
    app.t.overHandle = handleAt(w)?.kind || null;
  },
  up(w, e) {
    const { drag, door, start, handle } = app.t;
    app.t = {};
    if (handle) {
      const t = app.doc?.tokens.find(x => x.id === handle.id);
      if (!t) return;
      const patch = handle.kind === 'rotate' ? { rotation: t.rotation || 0 } : { scale: t.scale || 1 };
      const before = handle.kind === 'rotate' ? handle.rotation : handle.scale;
      if (Object.values(patch)[0] === before) { requestDraw(); return; }
      op({ type: 'token.update', id: t.id, patch }).then(r => {
        if (r.ok) return;
        if (handle.kind === 'rotate') t.rotation = handle.rotation; else t.scale = handle.scale;
        requestDraw();
      });
      requestDraw();
      return;
    }
    if (door && start) {
      const near = Math.hypot(w.x - start.x, w.y - start.y) * app.cam.z < DRAG_PX * 2;
      if (near) op({ type: 'door.toggle', id: door.id });
    }
    if (drag?.moved) {
      const moves = [...drag.positions].map(([id, p]) => ({ id, x: p.x, y: p.y }));
      // On garde la position provisoire jusqu'à la réponse du serveur : pas de saut à l'écran.
      app.t = { settling: drag.positions };
      op({ type: 'token.move', moves }).finally(() => {
        if (app.t.settling === drag.positions) app.t = {};
        requestDraw();
      });
    } else if (drag && !e.shiftKey && app.selection.size > 1) {
      const hit = tokenAt(w.x, w.y);
      if (hit) { app.selection = new Set([hit.id]); notify(); }
    }
    requestDraw();
  },
  key(e) {
    const ids = [...app.selection];
    if (!ids.length) return false;
    const tokens = selectedTokens();
    switch (e.key.toLowerCase()) {
      case 'delete':
      case 'backspace': op({ type: 'token.remove', ids }); return true;
      case 'h': op({ type: 'token.update', ids, patch: { hidden: !tokens.every(t => t.hidden) } }); return true;
      case 'd': op({ type: 'token.update', ids, patch: { defeated: !tokens.every(t => t.defeated) } }); return true;
      case 'q': rotateTokens(tokens, -15); return true;
      case 'e': rotateTokens(tokens, 15); return true;
      case 'escape': app.selection = new Set(); notify(); requestDraw(); return true;
      default: return false;
    }
  },
  overlay(ctx, z) {
    drawHandles(ctx, z);
    const { box } = app.t;
    if (!box) return;
    ctx.save();
    ctx.strokeStyle = '#6fb1ff';
    ctx.fillStyle = 'rgba(111,177,255,.14)';
    ctx.lineWidth = 1.5 / z;
    ctx.beginPath();
    ctx.rect(box.a.x, box.a.y, box.b.x - box.a.x, box.b.y - box.a.y);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  },
};

// --------------------------------------------------------------- Pose de tokens

export const placeTool = {
  id: 'place',
  cursor: () => 'copy',
  positions(w) {
    const p = app.placing;
    const size = p.tokens[0]?.size || 1;
    const c = snapToken(w.x, w.y, size);
    return spreadAround(c.x, c.y, p.tokens.length, size);
  },
  down() {},
  move(w) { app.t.at = w; requestDraw(); },
  up(w) {
    const p = app.placing;
    if (!p) return;
    const spots = this.positions(w);
    const tokens = p.tokens.map((t, i) => ({ ...t, x: spots[i].x, y: spots[i].y }));
    op({ type: 'token.add', tokens });
    app.selection = new Set(tokens.map(t => t.id));
    app.placing = null;
    app.tool = 'select';
    app.t = {};
    notify();
    requestDraw();
  },
  key(e) {
    if (e.key === 'Escape') { app.placing = null; app.tool = 'select'; app.t = {}; notify(); requestDraw(); return true; }
    return false;
  },
  overlay(ctx, z) {
    const at = app.t.at;
    if (!at || !app.placing) return;
    const spots = this.positions(at);
    ctx.save();
    ctx.strokeStyle = '#ffe066';
    ctx.lineWidth = 2 / z;
    spots.forEach((s, i) => {
      const r = (app.placing.tokens[i]?.size || 1) / 2;
      ctx.strokeRect(s.x - r, s.y - r, r * 2, r * 2);
    });
    ctx.restore();
    label(ctx, app.placing.title || 'Clic pour poser', at.x, at.y - 24 / z, z);
  },
};

// --------------------------------------------------------------- Règle

function feetBetween(a, b) {
  const per = app.doc.grid.feetPerCell;
  return Math.round(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))) * per;
}

const cellCenter = w => [Math.floor(w.x) + 0.5, Math.floor(w.y) + 0.5];

export const rulerTool = {
  id: 'ruler',
  cursor: () => 'crosshair',
  down(w, e) {
    const a = e.altKey ? [w.x, w.y] : cellCenter(w);
    app.t = { ruler: { a, b: a } };
    sendLive({ ruler: { a, b: a, label: '0 ft' } });
  },
  move(w, e) {
    const r = app.t.ruler;
    if (!r) return;
    r.b = e.altKey ? [w.x, w.y] : cellCenter(w);
    sendLive({ ruler: { a: r.a, b: r.b, label: `${feetBetween(r.a, r.b)} ft` } });
  },
  up() { app.t = {}; requestDraw(); },
  key(e) {
    if (e.key === 'Escape') { sendLive({ ruler: null }); return true; }
    return false;
  },
};

// --------------------------------------------------------------- Gabarits

function snapHalf(w) { return { x: Math.round(w.x * 2) / 2, y: Math.round(w.y * 2) / 2 }; }
function snapGrid(w) { return { x: Math.round(w.x), y: Math.round(w.y) }; }

function draftFrom(origin, w, shape) {
  const per = app.doc.grid.feetPerCell;
  const cells = Math.hypot(w.x - origin.x, w.y - origin.y);
  const feet = Math.max(per, Math.round(cells) * per);
  return { shape, x: origin.x, y: origin.y, feet: shape === 'square' ? feet * 2 : feet, angle: Math.atan2(w.y - origin.y, w.x - origin.x), width: per, color: '#ff8a3d' };
}

function templateHit(w) {
  const ctx = app.canvas?.getContext('2d');
  if (!ctx || !app.doc) return null;
  for (let i = app.doc.templates.length - 1; i >= 0; i--) {
    if (ctx.isPointInPath(templatePath(app.doc.templates[i], app.doc.grid.feetPerCell), w.x, w.y)) return app.doc.templates[i];
  }
  return null;
}

export const templateTool = {
  id: 'template',
  cursor: () => 'crosshair',
  down(w, e) {
    const shape = app.templateShape;
    const origin = e.altKey ? w : shape === 'circle' || shape === 'square' ? snapGrid(w) : snapHalf(w);
    app.t = { origin, sx: e.offsetX, sy: e.offsetY, moved: false, hit: templateHit(w), draft: null };
  },
  move(w, e) {
    const s = app.t;
    if (!s.origin) return;
    if (!s.moved && Math.hypot(e.offsetX - s.sx, e.offsetY - s.sy) < DRAG_PX) return;
    s.moved = true;
    s.draft = draftFrom(s.origin, w, app.templateShape);
    requestDraw();
  },
  up() {
    const s = app.t;
    app.t = {};
    if (s.moved && s.draft) op({ type: 'template.add', template: s.draft });
    else if (s.hit) op({ type: 'template.remove', ids: [s.hit.id] });
    requestDraw();
  },
  overlay(ctx, z) {
    const d = app.t.draft;
    if (!d) return;
    drawTemplate(ctx, d, app.doc, z);
    label(ctx, `${d.feet} ft`, d.x, d.y - 18 / z, z);
  },
};

// --------------------------------------------------------------- Dessin

export const drawTool = {
  id: 'draw',
  cursor: () => (app.draw.shape === 'erase' ? 'not-allowed' : 'crosshair'),
  down(w) {
    if (app.draw.shape === 'erase') {
      const hit = drawingAt(w);
      if (hit) op({ type: 'drawing.remove', ids: [hit.id] });
      return;
    }
    app.t = { stroke: { shape: app.draw.shape, color: app.draw.color, width: app.draw.width, points: [[w.x, w.y], [w.x, w.y]] } };
  },
  move(w) {
    const s = app.t.stroke;
    if (!s) return;
    if (s.shape === 'pen') {
      const last = s.points[s.points.length - 1];
      if (Math.hypot(last[0] - w.x, last[1] - w.y) > 4 / app.cam.z) s.points.push([w.x, w.y]);
    } else s.points[1] = [w.x, w.y];
    requestDraw();
  },
  up() {
    const s = app.t.stroke;
    app.t = {};
    if (s && (s.points.length > 2 || Math.hypot(s.points[0][0] - s.points[1][0], s.points[0][1] - s.points[1][1]) > 0.05)) {
      op({ type: 'drawing.add', drawing: s });
    }
    requestDraw();
  },
  overlay(ctx) {
    if (app.t.stroke) drawDrawing(ctx, app.t.stroke);
  },
};

function drawingAt(w) {
  const reach = Math.max(0.2, 8 / app.cam.z);
  const list = app.doc?.drawings || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i];
    if (d.shape === 'rect' || d.shape === 'ellipse') {
      const [a, b] = d.points;
      if (w.x >= Math.min(a[0], b[0]) - reach && w.x <= Math.max(a[0], b[0]) + reach && w.y >= Math.min(a[1], b[1]) - reach && w.y <= Math.max(a[1], b[1]) + reach) return d;
      continue;
    }
    for (let k = 0; k + 1 < d.points.length; k++) {
      const [ax, ay] = d.points[k];
      const [bx, by] = d.points[k + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((w.x - ax) * dx + (w.y - ay) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(w.x - ax - t * dx, w.y - ay - t * dy) <= reach) return d;
    }
  }
  return null;
}

export { toWorld };
