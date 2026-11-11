// Page « Infusions » (Artificer) : infusions connues, objets infusés, limites selon le niveau.
// Enhanced Defense et Repulsion Shield s'ajoutent tout seuls à la CA quand ils sont actifs.
import { t } from '/shared/i18n.js';
import { html, useEffect, useState } from './html.js';
import { newId } from '/shared/patch.js';
import { acBonuses, armorClass, classLevel, infusionApplies, infusionLimits, itemList, num } from '/shared/rules.js';
import { setPath, toast } from './store.js';
import { Box } from './ui.js';
import { Header } from './pages-main.js';
import { data5e, fold } from './data.js';
import { Rendered } from './compendium.js';

const REPEATABLE = 'replicate magic item';

export function PageInfusions({ id, doc, ro }) {
  const [options, setOptions] = useState([]);
  useEffect(() => { data5e.options('AI').then(setOptions); }, []);
  const lim = infusionLimits(doc);
  const level = classLevel(doc, 'artificer');
  const list = itemList(doc.infusions);
  const active = list.filter(i => i.active).length;
  const items = itemList(doc.inventory);
  const bonuses = acBonuses(doc);
  const textOf = name => options.find(o => fold(o.name) === fold(name));
  const avail = options.filter(o => num(o.minLevel) <= level && (fold(o.name) === REPEATABLE || !list.some(i => fold(i.name) === fold(o.name))));

  const add = name => {
    if (!name) return;
    if (lim && list.length >= lim.known) toast(t('Attention : {n} infusions connues au maximum à ce niveau', { n: lim.known }), { kind: 'warn' });
    setPath(id, ['infusions', newId('f')], { name, active: false });
  };
  const toggle = inf => {
    if (!inf.active && lim && active >= lim.active) return toast(t('Maximum {n} objets infusés à ce niveau : désactive-en un d\'abord', { n: lim.active }), { kind: 'warn' });
    return setPath(id, ['infusions', inf.id, 'active'], !inf.active);
  };

  return html`<div class="p-infusions">
    <div class="g-head"><${Header} id=${id} doc=${doc} ro=${ro} /></div>
    <div class="sp-stats inf-stats">
      <div class=${`stat-box ${lim && list.length > lim.known ? 'over' : ''}`}><b>${list.length}/${lim ? lim.known : 0}</b><small>INFUSIONS KNOWN</small></div>
      <div class=${`stat-box ${lim && active > lim.active ? 'over' : ''}`}><b>${active}/${lim ? lim.active : 0}</b><small>INFUSED ITEMS</small></div>
      <div class="stat-box"><b>${armorClass(doc)}</b><small>ARMOR CLASS${bonuses.length ? ` · BASE ${num(doc.ac)} ${bonuses.map(b => `+${b.value}`).join(' ')}` : ''}</small></div>
    </div>
    <${Box} label="INFUSIONS" cls="inf-box">
      ${!lim ? html`<p class="muted">Les infusions arrivent au niveau 2 d'Artificer.</p>` : null}
      ${list.map(inf => {
        const o = textOf(inf.name);
        // Seules les infusions de CA dépendent de l'équipement ; un Bag of Holding n'a pas à être « équipé ».
        const off = inf.active && /^(enhanced defense|repulsion shield)$/i.test(inf.name) && !infusionApplies(doc, inf);
        return html`<div class=${`inf-row ${inf.active ? 'on' : ''}`} key=${inf.id}>
          <div class="inf-top">
            <label class="check"><input type="checkbox" disabled=${ro} checked=${!!inf.active} onChange=${() => toggle(inf)} /> Active</label>
            <b class="inf-name">${inf.name}</b>
            <select class="sel" disabled=${ro} value=${inf.itemId || ''} onChange=${e => setPath(id, ['infusions', inf.id, 'itemId'], e.target.value || undefined)}>
              <option value="">Objet infusé…</option>
              ${items.map(it => html`<option value=${it.id}>${it.name}</option>`)}
            </select>
            ${ro ? null : html`<button type="button" class="btn tiny danger ghost" onClick=${() => setPath(id, ['infusions', inf.id], undefined)}>Oublier</button>`}
          </div>
          ${off ? html`<p class="warn small">Objet pas équipé : l'infusion ne compte pas pour l'instant.</p>` : null}
          ${o ? html`<details class="peek"><summary>Description${o.prereq ? html` <span class="muted small">· ${o.prereq}</span>` : null}</summary><${Rendered} entries=${o.entries} /></details>` : null}
        </div>`;
      })}
      ${lim && !list.length ? html`<p class="muted">Aucune infusion notée.</p>` : null}
      ${ro || !lim ? null : html`<select class="sel inf-add" value="" onChange=${e => { add(e.target.value); e.target.value = ''; }}>
        <option value="">+ Ajouter une infusion connue…</option>
        ${avail.map(o => html`<option value=${o.name}>${o.name}${o.prereq ? ` · ${o.prereq}` : ''}</option>`)}
      </select>`}
    <//>
    <p class="muted small pad">Enhanced Defense et Repulsion Shield s'ajoutent à la CA tant qu'ils sont actifs et que leur objet est équipé. Les autres effets, comme le +1 d'Enhanced Arcane Focus, restent à régler dans Réglages de la fiche, parce qu'ils dépendent de ce que tu tiens en main.</p>
  </div>`;
}
