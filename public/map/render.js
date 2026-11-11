// Dessin d'une scène, le même pour le portable et la TV. Seules les options changent.
// Une caméra : x, y, le coin haut-gauche en cases, et z, les pixels par case.
import { sceneBounds } from '/shared/map/scene.js';
import { computeView, namesOnTv, sourcesOf } from '/shared/map/view.js';
import { tokenImage, tokenLoading } from './images.js';

const EXPLORED_CLEAR = 0.42; // Une zone déjà vue laisse passer 42 % de la carte.

// --------------------------------------------------------------- Vue calculée

function polyPath(flat, path = new Path2D()) {
  if (flat.length < 6) return path;
  path.moveTo(flat[0], flat[1]);
  for (let i = 2; i < flat.length; i += 2) path.lineTo(flat[i], flat[i + 1]);
  path.closePath();
  return path;
}

// Le calcul ne se refait qu'après un changement de la scène.
export function viewFor(doc, rev) {
  if (doc.__view && doc.__viewRev === rev) return doc.__view;
  const view = computeView(doc);
  const explored = new Path2D();
  for (const flat of view.explored) polyPath(flat, explored);
  const visible = new Path2D();
  for (const flat of view.visible) polyPath(flat, visible);
  view.paths = { explored, visible };
  Object.defineProperty(doc, '__view', { value: view, writable: true, enumerable: false, configurable: true });
  Object.defineProperty(doc, '__viewRev', { value: rev, writable: true, enumerable: false, configurable: true });
  return view;
}

// --------------------------------------------------------------- Caméra

export function fitCamera(rect, w, h, margin = 0) {
  const z = Math.min((w - margin * 2) / rect.w, (h - margin * 2) / rect.h);
  return { x: rect.x + rect.w / 2 - w / (2 * z), y: rect.y + rect.h / 2 - h / (2 * z), z };
}

export function boundsRect(doc) {
  const b = sceneBounds(doc);
  return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
}

// --------------------------------------------------------------- Éléments

function drawGrid(ctx, doc, z) {
  const b = sceneBounds(doc);
  ctx.save();
  ctx.lineWidth = 1 / z;
  ctx.strokeStyle = 'rgba(255,255,255,.22)';
  ctx.beginPath();
  for (let x = Math.ceil(b.minX - 1e-6); x <= b.maxX + 1e-6; x++) { ctx.moveTo(x, b.minY); ctx.lineTo(x, b.maxY); }
  for (let y = Math.ceil(b.minY - 1e-6); y <= b.maxY + 1e-6; y++) { ctx.moveTo(b.minX, y); ctx.lineTo(b.maxX, y); }
  ctx.stroke();
  ctx.restore();
}

export function drawDrawing(ctx, d) {
  const [a, b] = d.points;
  ctx.save();
  ctx.strokeStyle = d.color;
  ctx.lineWidth = d.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (d.shape === 'rect') ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  else if (d.shape === 'ellipse') ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
  else {
    ctx.moveTo(a[0], a[1]);
    for (let i = 1; i < d.points.length; i++) ctx.lineTo(d.points[i][0], d.points[i][1]);
  }
  ctx.stroke();
  ctx.restore();
}

export function templatePath(t, feetPerCell) {
  const len = t.feet / feetPerCell;
  const p = new Path2D();
  const { x, y } = t;
  const a = t.angle || 0;
  if (t.shape === 'circle') {
    p.arc(x, y, len, 0, Math.PI * 2);
  } else if (t.shape === 'square') {
    p.rect(x - len / 2, y - len / 2, len, len);
  } else if (t.shape === 'line') {
    const half = (t.width || 5) / feetPerCell / 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    p.moveTo(x - s * half, y + c * half);
    p.lineTo(x + c * len - s * half, y + s * len + c * half);
    p.lineTo(x + c * len + s * half, y + s * len - c * half);
    p.lineTo(x + s * half, y - c * half);
    p.closePath();
  } else {
    // Cône : sa largeur à une distance donnée égale cette distance.
    const half = Math.atan(0.5);
    const edge = len / Math.cos(half);
    p.moveTo(x, y);
    p.lineTo(x + Math.cos(a - half) * edge, y + Math.sin(a - half) * edge);
    p.lineTo(x + Math.cos(a + half) * edge, y + Math.sin(a + half) * edge);
    p.closePath();
  }
  return p;
}

export function drawTemplate(ctx, t, doc, z) {
  const p = templatePath(t, doc.grid.feetPerCell);
  ctx.save();
  ctx.fillStyle = t.color;
  ctx.globalAlpha = 0.28;
  ctx.fill(p);
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = t.color;
  ctx.lineWidth = 2 / z;
  ctx.stroke(p);
  ctx.restore();
}

export function tokenBox(t, img) {
  const foot = t.size || 1;
  const scale = t.scale || 1;
  if (img?.cellsW) return { w: img.cellsW * scale, h: img.cellsH * scale };
  if (img?.aspect) {
    const side = foot * scale;
    return img.aspect >= 1 ? { w: side, h: side / img.aspect } : { w: side * img.aspect, h: side };
  }
  return { w: foot * scale, h: foot * scale };
}

export function drawToken(ctx, t, onReady, { alpha = 1, z = 40 } = {}) {
  const img = tokenImage(t.image, onReady);
  // Pendant le chargement, rien : des initiales sur la TV donneraient des noms aux joueurs.
  if (!img && t.image && tokenLoading(t.image)) return;
  const box = tokenBox(t, img);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (t.defeated) ctx.filter = 'grayscale(1) brightness(.55)';
  if (img) {
    ctx.imageSmoothingQuality = 'high';
    if (t.rotation) {
      ctx.translate(t.x, t.y);
      ctx.rotate((t.rotation * Math.PI) / 180);
      ctx.drawImage(img.bitmap, -box.w / 2, -box.h / 2, box.w, box.h);
    } else ctx.drawImage(img.bitmap, t.x - box.w / 2, t.y - box.h / 2, box.w, box.h);
  } else {
    const r = (t.size || 1) * 0.44;
    ctx.beginPath();
    ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
    ctx.fillStyle = t.kind === 'pc' ? '#2f6db5' : t.kind === 'ally' ? '#2f8f5b' : t.kind === 'npc' ? '#8a7a4a' : '#a83232';
    ctx.fill();
    ctx.lineWidth = 2 / z;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${r}px Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((t.name || '?').slice(0, 2), t.x, t.y);
  }
  ctx.restore();
  if (t.defeated) {
    const r = (t.size || 1) * 0.34;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(190,30,30,.9)';
    ctx.lineWidth = Math.max(2.5 / z, 0.06);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(t.x - r, t.y - r); ctx.lineTo(t.x + r, t.y + r);
    ctx.moveTo(t.x + r, t.y - r); ctx.lineTo(t.x - r, t.y + r);
    ctx.stroke();
    ctx.restore();
  }
}

export function drawRuler(ctx, r, z) {
  if (!r) return;
  ctx.save();
  ctx.strokeStyle = '#ffe066';
  ctx.fillStyle = '#ffe066';
  ctx.lineWidth = 3 / z;
  ctx.setLineDash([9 / z, 6 / z]);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(r.a[0], r.a[1]);
  ctx.lineTo(r.b[0], r.b[1]);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of [r.a, r.b]) { ctx.beginPath(); ctx.arc(p[0], p[1], 5 / z, 0, Math.PI * 2); ctx.fill(); }
  if (r.label) label(ctx, r.label, r.b[0], r.b[1] - 16 / z, z, 20);
  ctx.restore();
}

export function label(ctx, text, x, y, z, px = 13) {
  ctx.save();
  ctx.font = `bold ${px / z}px Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width;
  const h = (px * 1.45) / z;
  ctx.fillStyle = 'rgba(8,10,14,.85)';
  ctx.fillRect(x - w / 2 - 5 / z, y - h / 2, w + 10 / z, h);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x, y);
  ctx.restore();
}

// --------------------------------------------------------------- Brouillard

const fogCanvases = new WeakMap();

function fogLayer(ctx) {
  let fog = fogCanvases.get(ctx);
  if (!fog) { fog = document.createElement('canvas'); fogCanvases.set(ctx, fog); }
  if (fog.width !== ctx.canvas.width || fog.height !== ctx.canvas.height) {
    fog.width = ctx.canvas.width;
    fog.height = ctx.canvas.height;
  }
  return fog;
}

function drawFog(ctx, view, transform, { alpha = 1, soft = 0 }) {
  const fog = fogLayer(ctx);
  const f = fog.getContext('2d');
  f.setTransform(1, 0, 0, 1, 0, 0);
  f.globalCompositeOperation = 'source-over';
  f.filter = 'none';
  f.clearRect(0, 0, fog.width, fog.height);
  f.fillStyle = '#000';
  f.fillRect(0, 0, fog.width, fog.height);
  f.globalCompositeOperation = 'destination-out';
  f.setTransform(...transform);
  if (soft) f.filter = `blur(${soft}px)`;
  f.fillStyle = `rgba(0,0,0,${EXPLORED_CLEAR})`;
  f.fill(view.paths.explored);
  f.fillStyle = 'rgba(0,0,0,1)';
  f.fill(view.paths.visible);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(fog, 0, 0);
  ctx.restore();
}

// --------------------------------------------------------------- Scène complète

// options :
//   role        'tv' ou 'dm'
//   mapImage    l'image décodée, ou null pendant le chargement
//   rev         numéro de version, pour ne recalculer la vue qu'au besoin
//   dpr         pixels physiques par pixel CSS
//   fog         { alpha } : 1 pour la TV, moins pour le voile du MJ ; null pour aucun
//   showGrid, live, onImage
//   tokenStyle(t, seen) : transparence d'un token côté MJ
//   dragging    Map id -> {x, y} : positions provisoires côté MJ
//   afterFog(ctx, z) : ce que le MJ dessine par-dessus
export function drawScene(ctx, doc, cam, o) {
  const { dpr = 1 } = o;
  const z = cam.z * dpr;
  const transform = [z, 0, 0, z, -cam.x * z, -cam.y * z];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!o.mapImage) return;
  ctx.setTransform(...transform);
  const view = viewFor(doc, o.rev);

  const b = sceneBounds(doc);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(o.mapImage.bitmap, b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
  if (o.showGrid || doc.grid.show) drawGrid(ctx, doc, z);

  for (const t of doc.templates) drawTemplate(ctx, t, doc, z);
  for (const d of doc.drawings) drawDrawing(ctx, d);

  const isTv = o.role === 'tv';
  const onTop = [];
  for (const raw of doc.tokens) {
    const seen = view.seen.has(raw.id);
    if (isTv && !seen) continue;
    const pos = o.dragging?.get(raw.id);
    const t = pos ? { ...raw, x: pos.x, y: pos.y } : raw;
    // Les PJ passent au-dessus du brouillard : leur image n'est jamais coupée par un mur.
    if (t.kind === 'pc' && seen) { onTop.push({ t, seen }); continue; }
    drawToken(ctx, t, o.onImage, { alpha: o.tokenStyle ? o.tokenStyle(raw, seen) : 1, z });
  }

  if (o.fog && doc.fog !== false) drawFog(ctx, view, transform, o.fog);
  ctx.setTransform(...transform);
  for (const { t, seen } of onTop) drawToken(ctx, t, o.onImage, { alpha: o.tokenStyle ? o.tokenStyle(t, seen) : 1, z });
  if (isTv) {
    // Le nom sous le token, en pixels CSS comme sur le portable, un peu plus grand pour la distance.
    for (const t of namesOnTv(doc, view.seen)) {
      const box = tokenBox(t, tokenImage(t.image));
      label(ctx, t.name, t.x, t.y + Math.max((t.size || 1) / 2, box.h / 2.6) + 16 / cam.z, cam.z, 16);
    }
  }

  drawRuler(ctx, o.live?.ruler, z);
  o.afterFog?.(ctx, cam.z, view);
}

export { sourcesOf };
