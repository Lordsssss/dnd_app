// Le calque de memes : le même sur l'onglet des joueurs, le portable du MJ et la TV. Des
// éléments HTML posés au-dessus du canvas, pour qu'un GIF animé joue. Un meme est en cases,
// comme les tokens ; collé à un token, sa position est un écart depuis le centre du token.
import { html, useEffect, useRef, useState } from '/app/html.js';
import { t, tx } from '/shared/i18n.js';
import { api, campaignId, mapApi } from './net.js';
import { fileUrl } from './images.js';

export const REACTIONS = ['💀', '😂', '🔥', '❗', '👀', '🎲', '❤️', '😱', '👏', '🤡'];
export const TTLS = [['', 'Reste'], ['10', '10 s'], ['60', '1 min']];
const MEME_MAX = 5_000_000;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const REACT_MS = 3000;

// --------------------------------------------------------------- Envoi d'une image

export async function uploadMeme(file) {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error(tx('Format refusé : PNG, JPEG, WebP ou GIF'));
  if (file.size > MEME_MAX) throw new Error(tx('Image trop lourde pour un meme (5 Mo au plus)'));
  return api(`/api/c/${campaignId}/assets?kind=meme&name=${encodeURIComponent(file.name || 'meme')}`, { method: 'POST', raw: file });
}

export const fetchMeme = url => api(mapApi('/memes/fetch'), { method: 'POST', body: { url: String(url).trim() } });
export const looksLikeUrl = s => /^https?:\/\/\S+$/i.test(String(s || '').trim());

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

// Taille de départ, d'après ce que l'écran montre : un meme lisible sans couvrir la carte.
export function defaultSize(kind, cam, size) {
  const wCells = size.w / cam.z;
  const hCells = size.h / cam.z;
  return kind === 'text'
    ? Math.max(0.4, Math.min(8, Math.round(hCells * 0.06 * 100) / 100))
    : Math.max(1, Math.min(30, Math.round(wCells * 0.28 * 100) / 100));
}

// --------------------------------------------------------------- Le calque

const sig = (m, editable, selected) => [m.kind, m.image, m.top, m.bottom, m.text, editable ? 1 : 0, selected ? 1 : 0].join('\u0001');

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// options :
//   interactive   les memes modifiables répondent à la souris et au doigt
//   canEdit(m)    ce compte peut-il déplacer et effacer ce meme
//   onUpdate(id, patch), onRemove(id), onEdit(m), onPin(m), onSelect(id)
export class MemeOverlay {
  constructor(host, o = {}) {
    this.host = host;
    this.o = o;
    this.memes = new Map();
    this.els = new Map();
    this.reacts = new Map();
    this.sel = null;
    this.drag = null;
    this.last = null;
    host.classList.add('meme-layer');
  }

  get count() { return this.memes.size; }
  get(id) { return this.memes.get(id) || null; }

  setAll(list) {
    this.memes = new Map((list || []).map(m => [m.id, m]));
    if (this.sel && !this.memes.has(this.sel)) this.select(null);
    this.redraw();
  }

  set(m) {
    this.memes.set(m.id, m);
    this.redraw();
  }

  remove(ids) {
    for (const id of ids) this.memes.delete(id);
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

  // Où se trouve un meme, en cases : collé à un token, il le suit ; un token que la table ne
  // voit pas cache aussi ses memes.
  where(m, v = this.last) {
    if (!v?.doc) return null;
    const cur = this.drag?.id === m.id ? { ...m, ...this.drag.cur } : m;
    if (!cur.attach) return { x: cur.x, y: cur.y, m: cur };
    const t = v.doc.tokens.find(x => x.id === cur.attach);
    if (!t || (v.seen && !v.seen.has(t.id))) return null;
    const p = v.positions?.get(t.id) || t;
    return { x: p.x + cur.x, y: p.y + cur.y, m: cur };
  }

  // v : { doc, cam, seen, hidden, positions }
  render(v) {
    this.last = v;
    const keep = new Set();
    const now = Date.now();
    if (!v.hidden && v.doc) {
      for (const m of this.memes.values()) {
        if (m.expires && m.expires <= now) continue;
        const at = this.where(m, v);
        if (!at) continue;
        keep.add(m.id);
        const editable = !!this.o.interactive && !!this.o.canEdit?.(m);
        const selected = editable && this.sel === m.id;
        const s = sig(m, editable, selected);
        let e = this.els.get(m.id);
        if (!e || e.dataset.sig !== s) {
          e?.remove();
          e = this.build(m, editable, selected);
          e.dataset.sig = s;
          this.els.set(m.id, e);
          this.host.append(e);
        }
        this.place(e, at, v.cam);
      }
    }
    for (const [id, e] of this.els) if (!keep.has(id)) { e.remove(); this.els.delete(id); }
    for (const r of this.reacts.values()) {
      const at = this.reactAt(r, v);
      r.el.style.display = at && !v.hidden ? '' : 'none';
      if (at) { r.el.style.left = `${(at.x - v.cam.x) * v.cam.z}px`; r.el.style.top = `${(at.y - v.cam.y) * v.cam.z}px`; }
    }
  }

  place(e, at, cam) {
    const m = at.m;
    const w = m.size * cam.z;
    e.style.left = `${(at.x - cam.x) * cam.z}px`;
    e.style.top = `${(at.y - cam.y) * cam.z}px`;
    e.style.transform = `translate(-50%, -50%) rotate(${m.rot || 0}deg)`;
    if (m.kind === 'text') e.style.fontSize = `${Math.max(6, w)}px`;
    else { e.style.width = `${Math.max(12, w)}px`; e.style.setProperty('--w', `${Math.max(12, w)}px`); }
  }

  build(m, editable, selected) {
    const e = el('div', `meme ${m.kind === 'text' ? 'txt' : 'img'} ${editable ? 'rw' : 'ro'} ${selected ? 'on' : ''}`);
    if (m.kind === 'text') e.append(el('span', 'meme-t', m.text));
    else {
      const img = el('img');
      img.alt = '';
      img.draggable = false;
      img.src = fileUrl(m.image);
      img.onerror = () => e.classList.add('broken');
      e.append(img);
      if (m.top) e.append(el('span', 'cap top', m.top));
      if (m.bottom) e.append(el('span', 'cap bottom', m.bottom));
    }
    if (!editable) return e;
    if (selected) {
      const del = el('button', 'mh mh-del', '✕');
      del.type = 'button';
      del.title = tx('Effacer ce meme');
      const pin = el('button', `mh mh-pin ${m.attach ? 'on' : ''}`, '📌');
      pin.type = 'button';
      pin.title = m.attach ? tx('Décoller du token') : tx('Coller à un token : il le suivra');
      e.append(del, pin, el('span', 'mh mh-rot'), el('span', 'mh mh-size'));
      del.addEventListener('pointerdown', ev => ev.stopPropagation());
      pin.addEventListener('pointerdown', ev => ev.stopPropagation());
      del.addEventListener('click', ev => { ev.stopPropagation(); this.o.onRemove?.(m.id); });
      pin.addEventListener('click', ev => { ev.stopPropagation(); this.o.onPin?.(this.memes.get(m.id)); });
    }
    e.addEventListener('pointerdown', ev => this.down(ev, m.id, e));
    e.addEventListener('dblclick', ev => { ev.stopPropagation(); const cur = this.memes.get(m.id); if (cur) this.o.onEdit?.(cur); });
    e.addEventListener('contextmenu', ev => ev.preventDefault());
    return e;
  }

  down(ev, id, e) {
    const m = this.memes.get(id);
    if (!m || !this.last) return;
    ev.stopPropagation();
    ev.preventDefault();
    const kind = ev.target.classList.contains('mh-rot') ? 'rot' : ev.target.classList.contains('mh-size') ? 'size' : 'move';
    const r = e.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    this.drag = {
      id, kind, sx: ev.clientX, sy: ev.clientY, cx, cy, moved: false,
      dist: Math.max(8, Math.hypot(ev.clientX - cx, ev.clientY - cy)),
      base: { x: m.x, y: m.y, size: m.size, rot: m.rot || 0 }, cur: {},
    };
    if (this.sel !== id) this.select(id);
    const move = mv => this.move(mv);
    const up = uv => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.up(uv);
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
    if (d.kind === 'move') d.cur = { x: d.base.x + (ev.clientX - d.sx) / z, y: d.base.y + (ev.clientY - d.sy) / z };
    else if (d.kind === 'size') d.cur = { size: Math.max(0.3, Math.min(60, d.base.size * (Math.hypot(ev.clientX - d.cx, ev.clientY - d.cy) / d.dist))) };
    else {
      let deg = (Math.atan2(ev.clientY - d.cy, ev.clientX - d.cx) * 180) / Math.PI + 90;
      if (!ev.altKey) deg = Math.round(deg / 5) * 5;
      d.cur = { rot: ((deg % 360) + 360) % 360 };
    }
    this.redraw();
  }

  up() {
    const d = this.drag;
    if (!d) return;
    const m = this.memes.get(d.id);
    if (d.moved && m) {
      const patch = {};
      for (const [k, val] of Object.entries(d.cur)) patch[k] = Math.round(val * 1000) / 1000;
      // Aperçu gardé jusqu'à la réponse : pas de saut à l'écran.
      this.memes.set(d.id, { ...m, ...patch });
      this.o.onUpdate?.(d.id, patch);
    }
    this.drag = null;
    this.redraw();
  }

  // --------------------------------------------------------------- Réactions

  reactAt(r, v) {
    if (!v?.doc) return null;
    if (!r.token) return { x: r.x, y: r.y };
    const t = v.doc.tokens.find(x => x.id === r.token);
    if (!t || (v.seen && !v.seen.has(t.id))) return null;
    const p = v.positions?.get(t.id) || t;
    return { x: p.x, y: p.y - (t.size || 1) * 0.35 };
  }

  react(r) {
    const e = el('div', `react ${r.emoji === 'ping' ? 'ping' : ''}`);
    if (r.emoji === 'ping') {
      e.append(el('span', 'ping-ring'), el('span', 'ping-ring late'), el('span', 'ping-name', r.by || ''));
    } else {
      // Un peu de hasard : deux réactions au même endroit ne se cachent pas.
      const inner = el('span', 'react-i', r.emoji);
      inner.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 30)}px`);
      e.append(inner);
    }
    this.host.append(e);
    const entry = { ...r, el: e };
    this.reacts.set(r.id, entry);
    setTimeout(() => { e.remove(); this.reacts.delete(r.id); }, REACT_MS);
    this.redraw();
  }
}

// --------------------------------------------------------------- Fenêtres

export function MemeDialog({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, []);
  return html`<div class="m-back meme-back" onMouseDown=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <div class=${`m-dialog ${wide ? 'wide' : ''}`} onKeyDown=${e => e.stopPropagation()} onPaste=${e => e.stopPropagation()}>
      <header><h2>${title}</h2><button type="button" class="icon" aria-label="Fermer" onClick=${onClose}>×</button></header>
      <div class="m-body">${children}</div>
    </div>
  </div>`;
}

export function MemePreview({ kind, image, top, bottom, text, width = 300 }) {
  if (kind === 'text') return html`<div class="meme-prev-wrap"><div class="meme txt prev" style=${{ fontSize: '42px' }}><span class="meme-t">${text || '…'}</span></div></div>`;
  return html`<div class="meme-prev-wrap"><div class="meme img prev" style=${{ width: `${width}px`, '--w': `${width}px` }}>
    <img src=${fileUrl(image)} alt="" draggable=${false} />
    ${top ? html`<span class="cap top">${top}</span>` : null}
    ${bottom ? html`<span class="cap bottom">${bottom}</span>` : null}
  </div></div>`;
}

// Avant de poser : les deux légendes d'un vrai meme, ou le texte seul, et combien de temps il reste.
// `edit` : un meme déjà posé dont on change le texte.
export function MemeMaker({ kind = 'image', image = null, initial = {}, edit = null, onClose, onDone }) {
  const [f, setF] = useState({ top: initial.top || '', bottom: initial.bottom || '', text: initial.text || '', ttl: '' });
  const first = useRef(null);
  useEffect(() => { first.current?.focus(); }, []);
  const set = patch => setF({ ...f, ...patch });
  const ok = kind === 'text' ? f.text.trim() : true;
  const done = () => { if (ok) onDone({ top: f.top.trim(), bottom: f.bottom.trim(), text: f.text.trim(), ttl: f.ttl ? Number(f.ttl) : null }); };
  const key = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(); } };
  return html`<${MemeDialog} title=${edit ? 'Modifier le meme' : kind === 'text' ? 'Texte' : 'Meme'} onClose=${onClose}>
    <div class="meme-maker">
      <${MemePreview} kind=${kind} image=${image?.ref} top=${f.top} bottom=${f.bottom} text=${f.text} />
      ${kind === 'text'
        ? html`<label>Texte <textarea ref=${first} class="txt" rows="2" maxLength="200" value=${f.text} onInput=${e => set({ text: e.target.value })} onKeyDown=${key} placeholder="THIS IS FINE"></textarea></label>`
        : html`<label>En haut <input ref=${first} class="txt" maxLength="120" value=${f.top} onInput=${e => set({ top: e.target.value })} onKeyDown=${key} placeholder="QUAND LE MJ DIT" /></label>
          <label>En bas <input class="txt" maxLength="120" value=${f.bottom} onInput=${e => set({ bottom: e.target.value })} onKeyDown=${key} placeholder="ROULEZ L'INITIATIVE" /></label>`}
      ${edit ? null : html`<div class="meme-ttl"><span class="lbl">Durée</span>
        ${TTLS.map(([v, l]) => html`<button type="button" class=${`chip ${f.ttl === v ? 'on' : ''}`} onClick=${() => set({ ttl: v })}>${l}</button>`)}
      </div>`}
      <div class="ts-foot"><span class="grow"></span>
        <button type="button" class="btn" onClick=${onClose}>Annuler</button>
        <button type="button" class="btn primary" disabled=${!ok} onClick=${done}>${edit ? 'Enregistrer' : 'Poser'}</button>
      </div>
    </div>
  <//>`;
}

// La mèmothèque : chaque meme déjà posé dans la campagne, les plus utilisés d'abord.
export function ShelfDialog({ onClose, onPick, canDelete = false, toast = () => {} }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState(null);
  const load = (s = q) => api(mapApi(`/memes/shelf?q=${encodeURIComponent(s)}`)).then(setItems).catch(e => { setItems([]); toast(e.message, 'error'); });
  useEffect(() => { const t = setTimeout(() => load(q), 180); return () => clearTimeout(t); }, [q]);
  const remove = async (e, key) => {
    e.stopPropagation();
    try { await api(mapApi(`/memes/shelf/${encodeURIComponent(key)}`), { method: 'DELETE' }); load(); } catch (x) { toast(x.message, 'error'); }
  };
  return html`<${MemeDialog} title="Mèmothèque" onClose=${onClose} wide>
    <input class="txt meme-search" type="search" placeholder="Chercher une légende…" value=${q} onInput=${e => setQ(e.target.value)} />
    ${items === null ? html`<p class="muted">Chargement…</p>` : !items.length ? html`<p class="muted">${q ? 'Rien ne correspond.' : 'Aucun meme posé pour l\'instant. Colle une image sur la carte avec Ctrl+V.'}</p>` : html`<div class="shelf-grid">
      ${items.map(m => html`<button type="button" class="shelf-item" key=${m.key} title=${m.uses > 1 ? t('Posé {n} fois', { n: m.uses }) : undefined} onClick=${() => onPick(m)}>
        ${m.kind === 'text' ? html`<span class="shelf-text">${m.text}</span>` : html`<${MemePreview} kind="image" image=${m.image} top=${m.top} bottom=${m.bottom} width=${150} />`}
        ${m.uses > 1 ? html`<span class="shelf-uses">× ${m.uses}</span>` : null}
        ${canDelete ? html`<span class="shelf-del" role="button" title="Retirer de la mèmothèque" onClick=${e => remove(e, m.key)}>✕</span>` : null}
      </button>`)}
    </div>`}
  <//>`;
}
