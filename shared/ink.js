// Traits vectoriels du crayon. Un trait : { c: 'k'|'r'|'b', w: largeur, p: [x, y, pression, ...], t, by }
// Les coordonnées sont celles de la page fixe (850 × 1100), identiques sur tous les écrans.

export const PAGE_W = 850;
export const PAGE_H = 1100;

export const INK = {
  light: { k: '#2a211b', r: '#a52a1f', b: '#1d4f91' },
  dark: { k: '#efe6d6', r: '#ff8a7a', b: '#8fb8ff' },
};

export function widthAt(base, pressure) {
  return base * (0.3 + 1.0 * Math.max(0, Math.min(1, pressure)));
}

function pts(stroke) {
  const p = stroke.p || [];
  const out = [];
  for (let i = 0; i + 1 < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2] ?? 0.5]);
  return out;
}

// Contour polygonal d'un trait à largeur variable.
export function outline(stroke) {
  const P = pts(stroke);
  const base = stroke.w || 3;
  if (P.length === 0) return { poly: [], caps: [] };
  if (P.length === 1) return { poly: [], caps: [[P[0][0], P[0][1], widthAt(base, P[0][2]) / 2]] };
  const left = [], right = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    const r = widthAt(base, P[i][2]) / 2;
    left.push([P[i][0] - ty * r, P[i][1] + tx * r]);
    right.push([P[i][0] + ty * r, P[i][1] - tx * r]);
  }
  const first = P[0], last = P[P.length - 1];
  return {
    poly: [...left, ...right.reverse()],
    caps: [[first[0], first[1], widthAt(base, first[2]) / 2], [last[0], last[1], widthAt(base, last[2]) / 2]],
  };
}

const r1 = n => Math.round(n * 10) / 10;

export function strokeToSvg(stroke, palette = INK.light) {
  const color = palette[stroke.c] || palette.k;
  const { poly, caps } = outline(stroke);
  let out = '';
  if (poly.length) out += `<path d="M${poly.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z" fill="${color}"/>`;
  for (const [x, y, r] of caps) out += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" fill="${color}"/>`;
  return out;
}

export function strokesBounds(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const p = s.p || [];
    for (let i = 0; i + 1 < p.length; i += 3) {
      x0 = Math.min(x0, p[i]); y0 = Math.min(y0, p[i + 1]);
      x1 = Math.max(x1, p[i]); y1 = Math.max(y1, p[i + 1]);
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

// SVG autonome, recadré sur le dessin (avec une marge).
export function drawingToSvg(strokesObj, { background = '#fbf6ea', crop = true } = {}) {
  const strokes = Object.values(strokesObj || {}).sort((a, b) => (a.t || 0) - (b.t || 0));
  if (!strokes.length) return null;
  const b = crop ? strokesBounds(strokes) : null;
  const pad = 20;
  const x = b ? Math.max(0, b.x0 - pad) : 0;
  const y = b ? Math.max(0, b.y0 - pad) : 0;
  const w = b ? Math.min(PAGE_W, b.x1 + pad) - x : PAGE_W;
  const h = b ? Math.min(PAGE_H, b.y1 + pad) - y : PAGE_H;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r1(x)} ${r1(y)} ${r1(w)} ${r1(h)}" width="${Math.round(w)}" height="${Math.round(h)}">` +
    (background ? `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" fill="${background}"/>` : '') +
    strokes.map(s => strokeToSvg(s)).join('') + '</svg>\n';
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function strokeHit(stroke, x, y, radius) {
  const p = stroke.p || [];
  if (p.length < 3) return false;
  if (p.length < 6) return Math.hypot(p[0] - x, p[1] - y) <= radius + (stroke.w || 3);
  for (let i = 0; i + 4 < p.length; i += 3) {
    if (segDist(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= radius + (stroke.w || 3) / 2) return true;
  }
  return false;
}
