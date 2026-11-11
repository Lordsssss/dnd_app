// Outils de l'éditeur de murs : tracer, poser une porte, déplacer un sommet, gommer, tester la vue.
import { nearestVertex, nearestWall, wallIssues } from '/shared/map/scene.js';
import { indexFor } from '/shared/map/view.js';
import { visibilityPolygon } from '/shared/map/vision.js';
import { app, notify, op, requestDraw } from '../state.js';
import { doorMid } from './play.js';

const r3 = v => Math.round(v * 1000) / 1000;

// Priorité au sommet voisin, puis au mur voisin, puis à la grille. Maj : aucun calage.
export function snapPoint(w, e) {
  if (e.shiftKey) return [r3(w.x), r3(w.y)];
  const reach = Math.max(0.2, 9 / app.cam.z);
  const walls = app.doc?.walls || [];
  const v = nearestVertex(walls, w.x, w.y, reach);
  if (v) return [v.x, v.y];
  const n = nearestWall(walls, w.x, w.y, reach * 0.7);
  if (n) return [r3(n.x), r3(n.y)];
  if (app.wallSnap) {
    const k = app.wallSnap;
    return [Math.round(w.x * k) / k, Math.round(w.y * k) / k];
  }
  return [r3(w.x), r3(w.y)];
}

function commitDraft() {
  const d = app.t.draft;
  app.t = {};
  if (d && d.points.length >= 2) {
    op({ type: 'wall.add', kind: d.kind, points: d.points, group: d.kind === 'door' ? app.doorGroup || undefined : undefined });
  }
  requestDraw();
}

function draftOverlay(ctx, z) {
  const d = app.t.draft;
  if (!d) return;
  const pts = [...d.points, ...(app.t.cursor ? [app.t.cursor] : [])];
  ctx.save();
  ctx.strokeStyle = d.kind === 'door' ? '#7ee787' : '#ffb454';
  ctx.lineWidth = 3 / z;
  ctx.setLineDash([8 / z, 5 / z]);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();
  ctx.restore();
}

export const lineTool = {
  id: 'wall-line',
  cursor: () => 'crosshair',
  down(w, e) {
    const p = snapPoint(w, e);
    const d = app.t.draft;
    if (!d) { app.t = { draft: { kind: 'wall', points: [p] }, cursor: p }; requestDraw(); return; }
    const first = d.points[0];
    const last = d.points[d.points.length - 1];
    if (p[0] === last[0] && p[1] === last[1]) { commitDraft(); return; } // Double-clic : terminé.
    d.points.push(p);
    if (d.points.length > 2 && p[0] === first[0] && p[1] === first[1]) { commitDraft(); return; } // Boucle fermée.
    requestDraw();
  },
  move(w, e) {
    if (app.t.draft) { app.t.cursor = snapPoint(w, e); requestDraw(); }
    else { app.t.hint = snapPoint(w, e); requestDraw(); }
  },
  up() {},
  key(e) {
    const d = app.t.draft;
    if (!d) return false;
    if (e.key === 'Enter') { commitDraft(); return true; }
    if (e.key === 'Escape') { app.t = {}; requestDraw(); return true; }
    if (e.key === 'Backspace') {
      d.points.pop();
      if (!d.points.length) app.t = {};
      requestDraw();
      return true;
    }
    return false;
  },
  overlay(ctx, z) {
    draftOverlay(ctx, z);
    const h = app.t.hint;
    if (h && !app.t.draft) {
      ctx.save();
      ctx.fillStyle = '#ffb454';
      ctx.beginPath();
      ctx.arc(h[0], h[1], 4 / z, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  },
};

export const doorTool = {
  id: 'wall-door',
  cursor: () => 'crosshair',
  down(w, e) {
    const p = snapPoint(w, e);
    const d = app.t.draft;
    if (!d) { app.t = { draft: { kind: 'door', points: [p] }, cursor: p }; requestDraw(); return; }
    d.points.push(p);
    commitDraft();
  },
  move(w, e) { if (app.t.draft) { app.t.cursor = snapPoint(w, e); requestDraw(); } },
  up() {},
  key(e) {
    if (e.key === 'Escape' && app.t.draft) { app.t = {}; requestDraw(); return true; }
    return false;
  },
  overlay: draftOverlay,
};

export const editTool = {
  id: 'wall-edit',
  cursor: () => (app.t.vertex ? 'grabbing' : app.t.hoverV ? 'grab' : 'default'),
  dbl(w) {
    const reach = Math.max(0.2, 9 / app.cam.z);
    const n = nearestWall(app.doc?.walls || [], w.x, w.y, reach);
    if (n) op({ type: 'wall.insertVertex', id: n.wall, seg: n.seg, at: [r3(n.x), r3(n.y)] });
  },
  down(w) {
    const reach = Math.max(0.2, 9 / app.cam.z);
    const walls = app.doc?.walls || [];
    const v = nearestVertex(walls, w.x, w.y, reach);
    if (v) { app.t = { vertex: { from: [v.x, v.y], to: [v.x, v.y] } }; requestDraw(); return; }
    const n = nearestWall(walls, w.x, w.y, reach);
    app.wallSel = n ? n.wall : null;
    notify();
    requestDraw();
  },
  move(w, e) {
    const reach = Math.max(0.2, 9 / app.cam.z);
    if (app.t.vertex) {
      // Le sommet en cours de déplacement ne doit pas se caler sur lui-même.
      const p = e.shiftKey ? [r3(w.x), r3(w.y)] : snapExcept(w, app.t.vertex.from);
      app.t.vertex.to = p;
      requestDraw();
      return;
    }
    const v = nearestVertex(app.doc?.walls || [], w.x, w.y, reach);
    const had = !!app.t.hoverV;
    app.t.hoverV = v ? [v.x, v.y] : null;
    if (had !== !!v || v) requestDraw();
  },
  up() {
    const v = app.t.vertex;
    app.t = {};
    if (v && (v.from[0] !== v.to[0] || v.from[1] !== v.to[1])) op({ type: 'wall.moveVertex', from: v.from, to: v.to });
    requestDraw();
  },
  key(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && app.wallSel) {
      op({ type: 'wall.remove', ids: [app.wallSel] });
      app.wallSel = null;
      notify();
      return true;
    }
    if (e.key === 'Escape' && app.wallSel) { app.wallSel = null; notify(); requestDraw(); return true; }
    return false;
  },
  overlay(ctx, z) {
    const v = app.t.vertex;
    const walls = app.doc?.walls || [];
    if (app.wallSel) {
      const sel = walls.find(x => x.id === app.wallSel);
      if (sel) {
        ctx.save();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4 / z;
        ctx.beginPath();
        sel.points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.stroke();
        ctx.restore();
      }
    }
    if (v) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.setLineDash([6 / z, 4 / z]);
      ctx.lineWidth = 2 / z;
      for (const w of walls) {
        w.points.forEach((p, i) => {
          if (p[0] !== v.from[0] || p[1] !== v.from[1]) return;
          for (const q of [w.points[i - 1], w.points[i + 1]]) {
            if (!q) continue;
            ctx.beginPath();
            ctx.moveTo(q[0], q[1]);
            ctx.lineTo(v.to[0], v.to[1]);
            ctx.stroke();
          }
        });
      }
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(v.to[0], v.to[1], 6 / z, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (app.t.hoverV) {
      ctx.save();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.arc(app.t.hoverV[0], app.t.hoverV[1], 7 / z, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  },
};

function snapExcept(w, from) {
  const reach = Math.max(0.2, 9 / app.cam.z);
  let best = null;
  for (const wall of app.doc?.walls || []) {
    for (const p of wall.points) {
      if (p[0] === from[0] && p[1] === from[1]) continue;
      const d = Math.hypot(p[0] - w.x, p[1] - w.y);
      if (d <= reach && (!best || d < best.d)) best = { p, d };
    }
  }
  if (best) return [best.p[0], best.p[1]];
  if (app.wallSnap) {
    const k = app.wallSnap;
    return [Math.round(w.x * k) / k, Math.round(w.y * k) / k];
  }
  return [r3(w.x), r3(w.y)];
}

export const eraseTool = {
  id: 'wall-erase',
  cursor: () => 'not-allowed',
  down(w, e) { app.t = { erase: { a: w, b: w, sx: e.offsetX, sy: e.offsetY, moved: false } }; requestDraw(); },
  move(w, e) {
    const s = app.t.erase;
    if (!s) {
      const reach = Math.max(0.2, 9 / app.cam.z);
      app.t.hit = nearestWall(app.doc?.walls || [], w.x, w.y, reach);
      requestDraw();
      return;
    }
    if (Math.hypot(e.offsetX - s.sx, e.offsetY - s.sy) > 4) s.moved = true;
    s.b = w;
    requestDraw();
  },
  up(w) {
    const s = app.t.erase;
    app.t = {};
    if (!s) return;
    const walls = app.doc?.walls || [];
    if (s.moved) {
      // Glisser : tous les segments entièrement dans le rectangle.
      const x0 = Math.min(s.a.x, s.b.x);
      const x1 = Math.max(s.a.x, s.b.x);
      const y0 = Math.min(s.a.y, s.b.y);
      const y1 = Math.max(s.a.y, s.b.y);
      const inside = p => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
      const items = [];
      for (const wall of walls) {
        for (let i = 0; i + 1 < wall.points.length; i++) {
          if (inside(wall.points[i]) && inside(wall.points[i + 1])) items.push({ wall: wall.id, seg: i });
        }
      }
      if (items.length) op({ type: 'wall.erase', items });
    } else {
      const reach = Math.max(0.2, 9 / app.cam.z);
      const n = nearestWall(walls, w.x, w.y, reach);
      if (n) op({ type: 'wall.erase', items: [{ wall: n.wall, seg: n.seg }] });
    }
    requestDraw();
  },
  overlay(ctx, z) {
    const s = app.t.erase;
    if (s?.moved) {
      ctx.save();
      ctx.strokeStyle = '#ff5a4f';
      ctx.fillStyle = 'rgba(255,90,79,.16)';
      ctx.lineWidth = 1.5 / z;
      ctx.beginPath();
      ctx.rect(s.a.x, s.a.y, s.b.x - s.a.x, s.b.y - s.a.y);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else if (app.t.hit) {
      const wall = app.doc?.walls.find(x => x.id === app.t.hit.wall);
      const a = wall?.points[app.t.hit.seg];
      const b = wall?.points[app.t.hit.seg + 1];
      if (a && b) {
        ctx.save();
        ctx.strokeStyle = '#ff5a4f';
        ctx.lineWidth = 5 / z;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        ctx.restore();
      }
    }
  },
};

// Un point de vue d'essai, sur cet écran seulement : rien n'est révélé sur la TV.
export const testTool = {
  id: 'wall-test',
  cursor: () => 'crosshair',
  down(w) { app.t = { dragging: true }; setOrigin(w); },
  move(w) { if (app.t.dragging) setOrigin(w); },
  up() { app.t = {}; },
  key(e) {
    if (e.key === 'Escape') { app.testOrigin = null; requestDraw(); return true; }
    return false;
  },
};

function setOrigin(w) {
  app.testOrigin = { x: w.x, y: w.y };
  requestDraw();
}

export function drawTestView(ctx, z) {
  const o = app.testOrigin;
  if (!o || !app.doc) return;
  const flat = visibilityPolygon(indexFor(app.doc), o.x, o.y);
  const p = new Path2D();
  p.rect(-1000, -1000, 4000, 4000);
  if (flat.length >= 6) {
    p.moveTo(flat[0], flat[1]);
    for (let i = 2; i < flat.length; i += 2) p.lineTo(flat[i], flat[i + 1]);
    p.closePath();
  }
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.72)';
  ctx.fill(p, 'evenodd');
  ctx.fillStyle = '#ffe066';
  ctx.beginPath();
  ctx.arc(o.x, o.y, 6 / z, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Murs, portes et extrémités libres, tels que le MJ les édite.
const DOOR_COLORS = { rouge: '#ff5a4f', bleu: '#5aa9ff', jaune: '#ffd24a', vert: '#7ee787', violet: '#c58cff', orange: '#ff9d42', blanc: '#ffffff', noir: '#9aa4ad' };

export function doorColor(group) {
  if (!group) return '#7ee787';
  const g = group.toLowerCase();
  for (const [k, v] of Object.entries(DOOR_COLORS)) if (g.includes(k)) return v;
  let h = 0;
  for (const c of g) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 80% 62%)`;
}

export function drawWalls(ctx, doc, z, { vertices = true } = {}) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const w of doc.walls) {
    ctx.beginPath();
    w.points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    if (w.kind === 'door') {
      ctx.strokeStyle = doorColor(w.group);
      ctx.lineWidth = 4 / z;
      ctx.setLineDash(w.open ? [3 / z, 6 / z] : []);
    } else {
      ctx.strokeStyle = '#ffb454';
      ctx.lineWidth = 2.5 / z;
      ctx.setLineDash([]);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (vertices && z > 7) {
    ctx.fillStyle = '#ffb454';
    for (const w of doc.walls) {
      for (const p of w.points) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2.2 / z, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

export function drawIssues(ctx, doc, z) {
  const { dangling } = wallIssues(doc);
  ctx.save();
  ctx.strokeStyle = '#ff3b30';
  ctx.lineWidth = 2 / z;
  for (const d of dangling) {
    ctx.beginPath();
    ctx.arc(d.x, d.y, 7 / z, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  return dangling.length;
}

// Le rond d'une porte, qu'on clique en jeu pour l'ouvrir ou la fermer.
export function drawDoorHandles(ctx, doc, z) {
  ctx.save();
  for (const d of doc.walls) {
    if (d.kind !== 'door') continue;
    const m = doorMid(d);
    const r = 7 / z;
    ctx.beginPath();
    ctx.arc(m[0], m[1], r, 0, Math.PI * 2);
    ctx.lineWidth = 2.5 / z;
    ctx.strokeStyle = doorColor(d.group);
    ctx.fillStyle = d.open ? 'rgba(10,12,16,.8)' : doorColor(d.group);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
