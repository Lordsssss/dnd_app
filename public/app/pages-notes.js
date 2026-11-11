// Pages « Notes » et « Secret » (texte + calque de dessin).
import { html } from './html.js';
import { bind, Box, Txt } from './ui.js';
import { Header } from './pages-main.js';
import { Icon } from './icons.js';

export function PageNotes({ id, doc, ro }) {
  const b = p => bind(id, doc, p, ro);
  return html`<div class="p-notes">
    <div class="g-head"><${Header} id=${id} doc=${doc} ro=${ro} /></div>
    <div class="g-back"><${Box} label="BACKSTORY" cls="text-box tall"><${Txt} ...${b(['notes', 'backstory'])} multiline placeholder="Histoire du personnage…" /><//></div>
    <div class="g-allies"><${Box} label="ALLIES & ORGANIZATIONS" cls="text-box"><${Txt} ...${b(['notes', 'allies'])} multiline /><//></div>
    <div class="g-session"><${Box} label="NOTES DE SESSION" cls="text-box"><${Txt} ...${b(['notes', 'session'])} multiline placeholder="Indices, noms, dettes, promesses…" /><//></div>
    <div class="g-free"><${Box} label="NOTES & CROQUIS" cls="text-box sketch"><${Txt} ...${b(['notes', 'free'])} multiline placeholder="Notes libres. Le crayon dessine sur toute la page." /><//></div>
  </div>`;
}

export function PageSecret({ id, doc, ro }) {
  const b = p => bind(id, doc, p, ro);
  return html`<div class="p-secret">
    <div class="g-head"><${Header} id=${id} doc=${doc} ro=${ro} /></div>
    <div class="secret-banner">${Icon.lock()} <span>Page secrète : visible seulement par ${doc.player || 'ce joueur'} et le MJ.</span></div>
    <div class="g-sec"><${Box} label="SECRETS" cls="text-box tall"><${Txt} ...${b(['secret', 'text'])} multiline placeholder="Ce que les autres ne savent pas…" /><//></div>
    <div class="g-goals"><${Box} label="OBJECTIFS CACHÉS" cls="text-box"><${Txt} ...${b(['secret', 'goals'])} multiline /><//></div>
  </div>`;
}
