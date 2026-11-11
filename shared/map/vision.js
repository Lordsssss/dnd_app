// Calcul de la vue : ce qu'un point voit, avec les murs pour seul obstacle. Pas de portée,
// pas de lumière. Tout est en cases de grille. Aucun accès au DOM : testé sous Node.
//
// Méthode : un rayon vers chaque extrémité de mur, et deux de plus juste à côté pour voir
// passer l'angle. Une grille répartit les segments, pour qu'un rayon ne teste que ceux qu'il
// croise : un donjon de deux mille segments reste calculé en quelques millisecondes.

const EPS_ANGLE = 1e-4;
const EPS_T = 1e-9;
const EPS_U = 1e-9;

export function buildIndex(segments, bounds) {
  const { minX, minY, maxX, maxY } = bounds;
  const all = [
    ...segments,
    [minX, minY, maxX, minY], [maxX, minY, maxX, maxY], [maxX, maxY, minX, maxY], [minX, maxY, minX, minY],
  ];
  const cell = Math.max(1, Math.max(maxX - minX, maxY - minY) / 128);
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell));
  const rows = Math.max(1, Math.ceil((maxY - minY) / cell));
  const cells = new Array(cols * rows);
  const clampX = v => Math.max(0, Math.min(cols - 1, Math.floor((v - minX) / cell)));
  const clampY = v => Math.max(0, Math.min(rows - 1, Math.floor((v - minY) / cell)));
  all.forEach((s, id) => {
    const x0 = clampX(Math.min(s[0], s[2]));
    const x1 = clampX(Math.max(s[0], s[2]));
    const y0 = clampY(Math.min(s[1], s[3]));
    const y1 = clampY(Math.max(s[1], s[3]));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        if (x1 > x0 && y1 > y0 && !crossesCell(s, minX + cx * cell, minY + cy * cell, cell)) continue;
        const k = cy * cols + cx;
        (cells[k] || (cells[k] = [])).push(id);
      }
    }
  });
  const seen = new Set();
  const points = [];
  for (const s of all) {
    for (const [x, y] of [[s[0], s[1]], [s[2], s[3]]]) {
      const k = `${x},${y}`;
      if (!seen.has(k)) { seen.add(k); points.push([x, y]); }
    }
  }
  return { segs: all, cells, cols, rows, cell, minX, minY, maxX, maxY, points, stamp: new Uint32Array(all.length), run: 0 };
}

function crossesCell(s, x, y, size) {
  // Le segment coupe-t-il le carré ? Test des axes séparateurs, avec une marge.
  const m = 1e-6;
  const dx = s[2] - s[0];
  const dy = s[3] - s[1];
  const corners = [[x - m, y - m], [x + size + m, y - m], [x + size + m, y + size + m], [x - m, y + size + m]];
  let pos = 0;
  let neg = 0;
  for (const [cx, cy] of corners) {
    const c = dx * (cy - s[1]) - dy * (cx - s[0]);
    if (c >= 0) pos++;
    if (c <= 0) neg++;
  }
  return pos > 0 && neg > 0;
}

// Distance au premier obstacle le long d'une direction unitaire, avec le segment touché.
function cast(ix, ox, oy, dx, dy, limit = Infinity) {
  const { segs, cells, cols, rows, cell, minX, minY, stamp } = ix;
  ix.run = (ix.run + 1) >>> 0;
  const run = ix.run;
  let best = limit;
  let bestSeg = -1;
  let cx = Math.max(0, Math.min(cols - 1, Math.floor((ox - minX) / cell)));
  let cy = Math.max(0, Math.min(rows - 1, Math.floor((oy - minY) / cell)));
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? cell / Math.abs(dx) : Infinity;
  const tDeltaY = dy !== 0 ? cell / Math.abs(dy) : Infinity;
  let tMaxX = dx !== 0 ? (minX + (cx + (dx > 0 ? 1 : 0)) * cell - ox) / dx : Infinity;
  let tMaxY = dy !== 0 ? (minY + (cy + (dy > 0 ? 1 : 0)) * cell - oy) / dy : Infinity;
  for (;;) {
    const list = cells[cy * cols + cx];
    if (list) {
      for (const id of list) {
        if (stamp[id] === run) continue;
        stamp[id] = run;
        const s = segs[id];
        const ex = s[2] - s[0];
        const ey = s[3] - s[1];
        const denom = dx * ey - dy * ex;
        if (denom === 0) continue;
        const ax = s[0] - ox;
        const ay = s[1] - oy;
        const t = (ax * ey - ay * ex) / denom;
        if (t <= EPS_T || t >= best) continue;
        const u = (ax * dy - ay * dx) / denom;
        if (u < -EPS_U || u > 1 + EPS_U) continue;
        best = t;
        bestSeg = id;
      }
    }
    const exit = Math.min(tMaxX, tMaxY);
    if (best <= exit) break;
    if (tMaxX < tMaxY) { cx += stepX; tMaxX += tDeltaX; if (cx < 0 || cx >= cols) break; }
    else { cy += stepY; tMaxY += tDeltaY; if (cy < 0 || cy >= rows) break; }
  }
  return { t: best, seg: bestSeg };
}

// Le contour de ce que voit un point, en liste plate [x0, y0, x1, y1, …], toujours dans le même
// sens : plusieurs contours remplis ensemble font bien leur réunion.
export function visibilityPolygon(ix, ox0, oy0) {
  const ox = Math.max(ix.minX + 1e-6, Math.min(ix.maxX - 1e-6, ox0));
  const oy = Math.max(ix.minY + 1e-6, Math.min(ix.maxY - 1e-6, oy0));
  const angles = [];
  for (const p of ix.points) {
    const a = Math.atan2(p[1] - oy, p[0] - ox);
    angles.push(a - EPS_ANGLE, a, a + EPS_ANGLE);
  }
  angles.sort((a, b) => a - b);
  const hits = [];
  let prev = null;
  for (const a of angles) {
    if (a === prev) continue;
    prev = a;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const r = cast(ix, ox, oy, dx, dy);
    if (r.seg < 0) continue;
    hits.push({ x: ox + dx * r.t, y: oy + dy * r.t, seg: r.seg });
  }
  return simplify(hits);
}

// Garde les points utiles : sur un même mur, le premier et le dernier suffisent.
function simplify(hits) {
  const n = hits.length;
  if (n < 3) return [];
  const flat = [];
  for (let i = 0; i < n; i++) {
    const prev = hits[(i + n - 1) % n];
    const cur = hits[i];
    const next = hits[(i + 1) % n];
    if (prev.seg === cur.seg && next.seg === cur.seg) continue;
    flat.push(Math.round(cur.x * 1000) / 1000, Math.round(cur.y * 1000) / 1000);
  }
  return flat;
}

// Rien entre deux points ?
export function lineOfSight(ix, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return true;
  const margin = 1e-6;
  const r = cast(ix, ax, ay, dx / d, dy / d, d - margin);
  return r.seg < 0;
}

export function pointInPolygon(flat, x, y) {
  let inside = false;
  const n = flat.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = flat[i * 2];
    const yi = flat[i * 2 + 1];
    const xj = flat[j * 2];
    const yj = flat[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
