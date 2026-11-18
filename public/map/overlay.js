// Le calque de la table : les images collées et les traits dessinés, le même sur l'onglet des
// joueurs, le portable du MJ et la TV. Les images sont des éléments HTML posés au-dessus du canvas
// (un GIF y reste animé), les traits un SVG. Tout est en cases, comme les tokens.
import { tx } from '/shared/i18n.js';
import { api, campaignId, mapApi } from './net.js';
import { fileUrl } from './images.js';

export const PEN_COLORS = ['#e40712', '#ffd24a', '#5aa9ff', '#7ee787', '#c58bff', '#ff9f43', '#ffffff', '#000000'];
export const PEN_WIDTHS = [0.06, 0.12, 0.25];
const PASTE_MAX = 5_000_000;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const SVG_NS = 'http://www.w3.org/2000/svg';

// --------------------------------------------------------------- Envoi d'une image

export async function uploadPaste(file) {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error(tx('Format refusé : PNG, JPEG, WebP ou GIF'));
  if (file.size > PASTE_MAX) throw new Error(tx('Image trop lourde (5 Mo au plus)'));
  return api(`/api/c/${campaignId}/assets?kind=paste&name=${encodeURIComponent(file.name || 'image')}`, { method: 'POST', raw: file });
}

export const fetchPaste = url => api(mapApi('/overlay/fetch'), { method: 'POST', body: { url: String(url).trim() } });
const looksLikeUrl = s => /^https?:\/\/\S+$/i.test(String(s || '').trim());

// Ce que le presse-papier ou un glisser-déposer apporte : un fichier image, ou une adresse.
export function pickTransfer(dt) {
  if (!dt) return null;
  for (const f of dt.files || []) if (f.type.startsWith('image/')) return { file: f };
  for (const it of dt.items || []) {
    if (it.kind === 'file' && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) return { file: f }; }
  }
  const uri = (dt.getData('text/uri-list') || '').split('\n').find(l => l && !l.startsWith('#'));
  const text = uri || dt.getData('text/plain');
  if (looksLikeUrl(text)) return { url: text.trim() };
  // Une image glissée depuis une autre page : son adresse est dans le HTML.
  const m = /<img[^>]+src="(https?:[^"]+)"/i.exec(dt.getData('text/html') || '');
  return m ? { url: m[1].replace(/&amp;/g, '&') } : null;
}

// Largeur de départ d'une image, d'après ce que l'écran montre : lisible sans couvrir la carte.
export function defaultImageSize(cam, size) {
  return Math.max(1, Math.min(30, Math.round((size.w / cam.z) * 0.28 * 100) / 100));
}

// --------------------------------------------------------------- Géométrie

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l = dx * dx + dy * dy;
  const k = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

export function strokeHit(it, x, y, reach) {
  const r = Math.max(it.width / 2, reach);
  const p = it.points;
  for (let i = 1; i < p.length; i++) if (segDist(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) <= r) return true;
  return false;
}

const pathOf = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('');

// --------------------------------------------------------------- Le calque

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// options :
//   interactive   les images modifiables répondent à la souris et au doigt
//   canEdit(it)   ce compte peut-il déplacer et effacer cet élément
//   mode()        'move' (choisir, déplacer), 'erase' (un clic efface) ou 'pen' (rien ne capte)
//   onUpdate(id, patch), onRemove(id), onSelect(id)
export class OverlayLayer {
  constructor(host, o = {}) {
    this.host = host;
    this.o = o;
    this.items = new Map();
    this.els = new Map();
    this.paths = new Map();
    this.sel = null;
    this.drag = null;
    this.last = null;
    host.classList.add('ov-host');
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'ov-strokes');
    this.g = document.createElementNS(SVG_NS, 'g');
    this.draftPath = document.createElementNS(SVG_NS, 'path');
    this.draftPath.setAttribute('class', 'ov-draft');
    this.svg.append(this.g, this.draftPath);
    host.append(this.svg);
  }

  get count() { return this.items.size; }
  get(id) { return this.items.get(id) || null; }
  countBy(accountId) { let n = 0; for (const it of this.items.values()) if (it.by === accountId) n++; return n; }

  setAll(list) {
    this.items = new Map((list || []).map(it => [it.id, it]));
    if (this.sel && !this.items.has(this.sel)) this.select(null);
    this.redraw();
  }
  set(it) { this.items.set(it.id, it); this.redraw(); }
  remove(ids) {
    for (const id of ids) this.items.delete(id);
    if (ids.includes(this.sel)) this.select(null);
    this.redraw();
  }
  select(id) {
    if (this.sel === id) return;
    this.sel = id;
    this.o.onSelect?.(id);
    this.redraw();
  }
  redraw() { if (this.last) this.render(this.last); }

  // Le trait de l'élément le plus haut sous ce point, parmi ceux que `pred` accepte.
  strokeAt(x, y, z, pred = () => true) {
    const list = [...this.items.values()].filter(it => it.kind === 'stroke' && pred(it));
    for (let i = list.length - 1; i >= 0; i--) if (strokeHit(list[i], x, y, 6 / z)) return list[i];
    return null;
  }

  // v : { doc, cam, hidden, draft: { points, color, width } }
  render(v) {
    this.last = v;
    const cam = v.cam;
    this.host.dataset.mode = this.o.mode?.() || 'view';
    const show = !v.hidden && !!v.doc;
    this.svg.style.display = show ? '' : 'none';
    if (cam) this.g.setAttribute('transform', `matrix(${cam.z} 0 0 ${cam.z} ${-cam.x * cam.z} ${-cam.y * cam.z})`);
    const keep = new Set();
    if (show) {
      for (const it of this.items.values()) {
        keep.add(it.id);
        if (it.kind === 'stroke') this.stroke(it);
        else this.image(it, cam);
      }
    }
    for (const [id, e] of this.els) if (!keep.has(id)) { e.remove(); this.els.delete(id); }
    for (const [id, p] of this.paths) if (!keep.has(id)) { p.remove(); this.paths.delete(id); }
    const d = v.draft;
    if (show && d?.points?.length && cam) {
      this.draftPath.setAttribute('d', pathOf(d.points.map(p => [(p[0] - cam.x) * cam.z, (p[1] - cam.y) * cam.z])));
      this.draftPath.setAttribute('stroke', d.color);
      this.draftPath.setAttribute('stroke-width', String(d.width * cam.z));
      this.draftPath.style.display = '';
    } else this.draftPath.style.display = 'none';
  }

  stroke(it) {
    let p = this.paths.get(it.id);
    if (!p) {
      p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('class', 'ov-stroke');
      this.paths.set(it.id, p);
      this.g.append(p);
    }
    const sig = `${it.points.length}|${it.color}|${it.width}`;
    if (p.dataset.sig !== sig) {
      p.dataset.sig = sig;
      p.setAttribute('d', pathOf(it.points));
      p.setAttribute('stroke', it.color);
      p.setAttribute('stroke-width', String(it.width));
    }
  }

  image(it, cam) {
    const editable = !!this.o.interactive && !!this.o.canEdit?.(it);
    const selected = editable && this.sel === it.id;
    const sig = `${it.image}|${editable ? 1 : 0}|${selected ? 1 : 0}`;
    let e = this.els.get(it.id);
    if (!e || e.dataset.sig !== sig) {
      e?.remove();
      e = this.buildImage(it, editable, selected);
      e.dataset.sig = sig;
      this.els.set(it.id, e);
      this.host.append(e);
    }
    const cur = this.drag?.id === it.id ? { ...it, ...this.drag.cur } : it;
    const w = Math.max(12, cur.size * cam.z);
    e.style.left = `${(cur.x - cam.x) * cam.z}px`;
    e.style.top = `${(cur.y - cam.y) * cam.z}px`;
    e.style.width = `${w}px`;
  }

  buildImage(it, editable, selected) {
    const e = el('div', `ov-img ${editable ? 'rw' : 'ro'} ${selected ? 'on' : ''}`);
    const img = el('img');
    img.alt = '';
    img.draggable = false;
    img.src = fileUrl(it.image);
    img.onerror = () => e.classList.add('broken');
    e.append(img);
    if (!editable) return e;
    if (selected) {
      const del = el('button', 'ov-h ov-del', '✕');
      del.type = 'button';
      del.title = tx('Effacer cette image');
      del.addEventListener('pointerdown', ev => ev.stopPropagation());
      del.addEventListener('click', ev => { ev.stopPropagation(); this.o.onRemove?.(it.id); });
      e.append(del, el('span', 'ov-h ov-size'));
    }
    e.addEventListener('pointerdown', ev => this.down(ev, it.id, e));
    e.addEventListener('contextmenu', ev => ev.preventDefault());
    return e;
  }

  down(ev, id, e) {
    const it = this.items.get(id);
    if (!it || !this.last) return;
    ev.stopPropagation();
    ev.preventDefault();
    if (this.o.mode?.() === 'erase') { this.o.onRemove?.(id); return; }
    const kind = ev.target.classList.contains('ov-size') ? 'size' : 'move';
    const r = e.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    this.drag = {
      id, kind, sx: ev.clientX, sy: ev.clientY, cx, cy, moved: false,
      dist: Math.max(8, Math.hypot(ev.clientX - cx, ev.clientY - cy)), base: { x: it.x, y: it.y, size: it.size }, cur: {},
    };
    if (this.sel !== id) this.select(id);
    const move = mv => this.move(mv);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.up();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  move(ev) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < 3) return;
    d.moved = true;
    const z = this.last.cam.z;
    d.cur = d.kind === 'move'
      ? { x: d.base.x + (ev.clientX - d.sx) / z, y: d.base.y + (ev.clientY - d.sy) / z }
      : { size: Math.max(0.3, Math.min(60, d.base.size * (Math.hypot(ev.clientX - d.cx, ev.clientY - d.cy) / d.dist))) };
    this.redraw();
  }

  up() {
    const d = this.drag;
    if (!d) return;
    const it = this.items.get(d.id);
    if (d.moved && it) {
      const patch = {};
      for (const [k, val] of Object.entries(d.cur)) patch[k] = Math.round(val * 1000) / 1000;
      // Aperçu gardé jusqu'à la réponse : pas de saut à l'écran.
      this.items.set(d.id, { ...it, ...patch });
      this.o.onUpdate?.(d.id, patch);
    }
    this.drag = null;
    this.redraw();
  }
}
