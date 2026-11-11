// Composants de base : champs liés à la fiche, pastilles, modales.
import { html, useState, useEffect, useRef } from './html.js';
import { getIn } from '/shared/patch.js';
import { num, signed } from '/shared/rules.js';
import { setPath, closeModal } from './store.js';
import { rollD20 } from './dice.js';
import { Icon } from './icons.js';

// Liaison d'un champ à un chemin de la fiche.
export function bind(docId, doc, path, ro) {
  return { value: getIn(doc, path), ro, onCommit: v => setPath(docId, path, v) };
}

function useDraft(value, onCommit, delay) {
  const [focus, setFocus] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const timer = useRef(null);
  const last = useRef(value);
  useEffect(() => { if (!focus) { setDraft(value ?? ''); last.current = value; } }, [value, focus]);
  const commit = v => {
    clearTimeout(timer.current);
    if (String(v) !== String(last.current ?? '')) { last.current = v; onCommit(v); }
  };
  return {
    focus, draft,
    onFocus: () => setFocus(true),
    onBlur: e => { commit(e.target.value); setFocus(false); },
    onInput: e => {
      const v = e.target.value;
      setDraft(v);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => commit(v), delay);
    },
    commit,
  };
}

export function Txt({ value, onCommit, ro, placeholder = '', cls = '', multiline = false, maxLength = 20000, title }) {
  const d = useDraft(value ?? '', onCommit, 600);
  if (multiline) {
    return html`<textarea class=${`txt ${cls}`} value=${d.focus ? d.draft : value ?? ''} readOnly=${ro} placeholder=${ro ? '' : placeholder}
      maxLength=${maxLength} title=${title} onFocus=${d.onFocus} onBlur=${d.onBlur} onInput=${d.onInput}></textarea>`;
  }
  return html`<input class=${`txt ${cls}`} type="text" value=${d.focus ? d.draft : value ?? ''} readOnly=${ro} placeholder=${ro ? '' : placeholder}
    maxLength=${Math.min(maxLength, 300)} title=${title} onFocus=${d.onFocus} onBlur=${d.onBlur} onInput=${d.onInput}
    onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />`;
}

export function Num({ value, onCommit, ro, min = -999, max = 9999, cls = '', placeholder = '', title, allowEmpty = false, decimal = false }) {
  const parse = v => {
    if (allowEmpty && String(v).trim() === '') return null;
    const s = String(v).replace(',', '.');
    const n = decimal ? Math.round(parseFloat(s) * 100) / 100 : parseInt(s, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : (decimal ? Number(value) || 0 : num(value));
  };
  const d = useDraft(value == null ? '' : String(value), v => onCommit(parse(v)), 900);
  return html`<input class=${`num ${cls}`} type="text" inputMode=${decimal ? 'decimal' : 'numeric'} value=${d.focus ? d.draft : value ?? ''}
    readOnly=${ro} placeholder=${placeholder} title=${title}
    onFocus=${e => { d.onFocus(); if (!ro) setTimeout(() => e.target.select(), 0); }} onBlur=${d.onBlur} onInput=${d.onInput}
    onKeyDown=${e => { if (e.key === 'Enter') e.target.blur(); }} />`;
}

// Pastilles : pleines = disponibles. Toucher une pleine la dépense, une vide la rend.
export function Pips({ max, used, onChange, ro, cls = '', title }) {
  max = Math.max(0, num(max));
  used = Math.min(max, Math.max(0, num(used)));
  const avail = max - used;
  const pips = [];
  for (let i = 0; i < max; i++) {
    const full = i < avail;
    pips.push(html`<button type="button" class=${`pip ${full ? 'full' : ''}`} disabled=${ro}
      aria-label=${full ? 'Dépenser' : 'Récupérer'} onClick=${() => onChange(full ? used + 1 : used - 1)}></button>`);
  }
  return html`<span class=${`pips ${cls}`} title=${title}>${pips}</span>`;
}

export function ProfDot({ value, onChange, ro, levels = 1, title }) {
  const v = num(value);
  return html`<button type="button" class=${`prof prof-${v}`} disabled=${ro} title=${title || (v === 2 ? 'Expertise' : v ? 'Maîtrise' : 'Pas de maîtrise')}
    onClick=${() => onChange(levels === 1 ? (v ? 0 : 1) : (v + 1) % (levels + 1))}></button>`;
}

export function RollBtn({ label, mod, cls = '' }) {
  return html`<button type="button" class=${`roll ${cls}`} title=${`Lancer ${label} (${signed(mod)})`}
    onClick=${e => { e.stopPropagation(); rollD20(label, num(mod)); }}>${Icon.d20()}</button>`;
}

export function Box({ label, cls = '', children, top = false, style }) {
  return html`<section class=${`box ${cls}`} style=${style}>
    ${top && label ? html`<h3 class="cap top">${label}</h3>` : null}
    ${children}
    ${!top && label ? html`<h3 class="cap">${label}</h3>` : null}
  </section>`;
}

export function Modal({ title, children, wide = false, onClose = closeModal, footer, cls = '' }) {
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return html`<div class="modal-back" onClick=${e => { if (e.target === e.currentTarget) onClose(); }}>
    <div class=${`modal ${wide ? 'wide' : ''} ${cls}`} role="dialog" aria-label=${title}>
      <header><h2>${title}</h2><button type="button" class="icon-btn" onClick=${onClose} aria-label="Fermer">${Icon.close()}</button></header>
      <div class="modal-body">${children}</div>
      ${footer ? html`<footer>${footer}</footer>` : null}
    </div>
  </div>`;
}

// Remplace autoFocus (ignoré après le chargement de la page).
export function focusOnce(el) {
  if (el && !el.dataset.focused) { el.dataset.focused = '1'; setTimeout(() => el.focus(), 30); }
}

export function Stepper({ value, onChange, ro, min = 0, max = 99 }) {
  const v = num(value);
  return html`<span class="stepper">
    <button type="button" disabled=${ro || v <= min} onClick=${() => onChange(Math.max(min, v - 1))} aria-label="Moins">${Icon.minus()}</button>
    <b>${v}</b>
    <button type="button" disabled=${ro || v >= max} onClick=${() => onChange(Math.min(max, v + 1))} aria-label="Plus">${Icon.plus()}</button>
  </span>`;
}

export function confirmModal(openModal, { title, text, ok = 'Confirmer', danger = false, onOk }) {
  openModal({ kind: 'confirm', title, text, ok, danger, onOk });
}
