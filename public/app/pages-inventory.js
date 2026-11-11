// Page « Inventaire » : objets, bourse, réserve du groupe.
import { t } from '/shared/i18n.js';
import { isScroll } from './scrolls.js';
import { html } from './html.js';
import {
  MAX_ATTUNED, attunedCount, denomsAsc, formatPurse, itemList, num, toBase,
} from '/shared/rules.js';
import { newId } from '/shared/patch.js';
import { act, canPartyAct, myCharId, openModal, setPath, store, toast } from './store.js';
import { bind, Box, Num, Pips, Txt } from './ui.js';
import { Header } from './pages-main.js';
import { Icon } from './icons.js';

function totalLabel(purse, denoms) {
  const asc = denomsAsc(denoms);
  const prim = denoms.find(d => d.key === 'pa') || asc[asc.length - 1];
  const t = toBase(purse, denoms) / prim.value;
  return `${Math.round(t * 100) / 100} ${prim.label}`;
}

function Purse({ id, doc, ro }) {
  const denoms = denomsAsc(store.config.currency).reverse();
  return html`<${Box} label="CURRENCY" cls="coin-box">
    <div class="coins">
      ${denoms.map(d => html`<label class="coin" key=${d.key}>
        <span class="coin-l">${d.label}</span>
        <${Num} ...${bind(id, doc, ['currency', d.key], ro)} min=${0} max=${9999999} placeholder="0" />
      </label>`)}
    </div>
    <div class="coin-foot">
      <span class="muted">Total ≈ ${totalLabel(doc.currency, store.config.currency)}</span>
      ${ro ? null : html`<span class="row-btns">
        <button type="button" class="btn tiny" onClick=${() => openModal({ kind: 'money', id, mode: 'pay' })}>Payer</button>
        <button type="button" class="btn tiny" onClick=${() => openModal({ kind: 'money', id, mode: 'receive' })}>Recevoir</button>
        <button type="button" class="btn tiny" title="Regroupe les pièces dans les plus grosses dénominations" onClick=${() => act('consolidate').then(r => r.ok && toast('Pièces regroupées'))}>Regrouper</button>
      </span>`}
    </div>
  <//>`;
}

function Fund({ id, ro }) {
  const denoms = store.config.currency;
  const fund = store.party.data.fund || {};
  const canAct = canPartyAct();
  return html`<${Box} label="PARTY FUND" cls="coin-box fund">
    <div class="fund-val">${toBase(fund, denoms) ? formatPurse(fund, denoms) : html`<span class="muted">Vide</span>`}</div>
    <div class="coin-foot">
      <span class="muted">Total ≈ ${totalLabel(fund, denoms)}</span>
      ${canAct ? html`<span class="row-btns">
        <button type="button" class="btn tiny" onClick=${() => openModal({ kind: 'fund', mode: 'deposit' })}>Déposer</button>
        <button type="button" class="btn tiny" onClick=${() => openModal({ kind: 'fund', mode: 'withdraw' })}>Retirer</button>
        <button type="button" class="btn tiny" onClick=${() => openModal({ kind: 'confirm', title: 'Partager le fonds commun', text: t('Répartir {amount} à parts égales entre tous les personnages ? Le reste non divisible reste dans le fonds.', { amount: formatPurse(fund, denoms) }), ok: 'Partager', onOk: () => act('split').then(r => r.ok && toast(r.result?.toast)) })}>Partager</button>
      </span>` : null}
    </div>
  <//>`;
}

function ItemRow({ docId, item, ro, stash = false }) {
  const path = stash ? ['stash', item.id] : ['inventory', item.id];
  const b = p => ({ value: item[p], ro, onCommit: v => setPath(docId, [...path, p], v) });
  const charges = item.charges && num(item.charges.max) > 0 ? item.charges : null;
  const me = myCharId();
  return html`<div class=${`it-row ${stash ? 'stash' : ''} ${item.attuned ? 'attuned' : ''}`}>
    <span class="it-qty"><${Num} ...${b('qty')} min=${0} max=${999999} /></span>
    <span class="it-name">
      <button type="button" class="linkish" onClick=${() => openModal({ kind: 'item', docId, itemId: item.id, stash })}>${item.name || 'Sans nom'}</button>
      ${item.attunement && !stash ? html`<button type="button" class=${`att ${item.attuned ? 'on' : ''}`} disabled=${ro} title=${item.attuned ? 'Harmonisé' : 'Harmonisation requise'}
        onClick=${() => setPath(docId, [...path, 'attuned'], !item.attuned)}>◆</button>` : null}
    </span>
    <span class="it-notes"><${Txt} ...${b('notes')} placeholder="Notes" /></span>
    <span class="it-ch">${charges ? html`<${Pips} max=${charges.max} used=${charges.used} ro=${ro} onChange=${u => setPath(docId, [...path, 'charges', 'used'], Math.max(0, Math.min(num(charges.max), u)))} />` : null}</span>
    <span class="it-act">
      ${!stash && !ro ? html`
        ${isScroll(item) ? html`<button type="button" class="btn tiny primary" title="Apprendre le sort de ce parchemin" onClick=${() => openModal({ kind: 'learnScroll', id: docId, itemId: item.id })}>${Icon.book()} Apprendre</button>` : null}
        ${item.consumable || charges ? html`<button type="button" class="btn tiny" onClick=${() => act('useItem', { itemId: item.id }).then(r => r.ok && toast(r.result?.toast))}>Utiliser</button>` : null}
        <button type="button" class="icon-btn" title="Donner" onClick=${() => openModal({ kind: 'give', from: me, itemId: item.id })}>${Icon.gift()}</button>` : null}
      ${stash && canPartyAct() ? html`
        <button type="button" class="btn tiny" onClick=${() => openModal({ kind: 'give', from: 'stash', itemId: item.id })}>Prendre / donner</button>` : null}
    </span>
  </div>`;
}

export function PageInventory({ id, doc, ro }) {
  const items = itemList(doc.inventory);
  const stash = itemList(store.party.data.stash);
  const att = attunedCount(doc);
  const canStash = canPartyAct();
  const log = Object.values(store.party.data.log || {}).sort((a, b) => num(b.at) - num(a.at));
  const addItem = () => setPath(id, ['inventory', newId('i')], { name: 'Nouvel objet', qty: 1, notes: '', order: items.length ? Math.max(...items.map(i => num(i.order))) + 1 : 0 });
  return html`<div class="p-inv">
    <div class="g-head"><${Header} id=${id} doc=${doc} ro=${ro} /></div>
    <div class="g-coins"><${Purse} id=${id} doc=${doc} ro=${ro} /></div>
    <div class="g-fund"><${Fund} id=${id} ro=${ro} /></div>
    <div class="g-items">
      <${Box} label="EQUIPMENT" cls="items-box" top>
        <div class="it-head"><span>QTÉ</span><span>NOM</span><span>NOTES</span><span>CHARGES</span><span></span></div>
        <div class="it-list">
          ${items.map(it => html`<${ItemRow} key=${it.id} docId=${id} item=${it} ro=${ro} />`)}
          ${items.length ? null : html`<p class="muted pad">Inventaire vide.</p>`}
        </div>
        ${ro ? null : html`<div class="box-foot">
          <button type="button" class="btn small" onClick=${addItem}>${Icon.plus()} Objet</button>
          <button type="button" class="btn small" onClick=${() => openModal({ kind: 'itemSearch', target: id })}>${Icon.search()} Chercher (5etools)</button>
          <span class=${`att-count ${att >= MAX_ATTUNED ? 'full' : ''}`} title="Objets harmonisés">◆ ${att}/${MAX_ATTUNED} harmonisés</span>
        </div>`}
      <//>
    </div>
    <div class="g-stash">
      <${Box} label="SHARED STASH" cls="items-box stash-box" top>
        <div class="it-list">
          ${stash.map(it => html`<${ItemRow} key=${it.id} docId=${store.party.id || 'party'} item=${it} ro=${!canStash} stash />`)}
          ${stash.length ? null : html`<p class="muted pad">La réserve du groupe est vide.</p>`}
        </div>
        <div class="box-foot">
          ${canStash ? html`<button type="button" class="btn small" onClick=${() => act('stashAdd', { item: { name: 'Nouvel objet', qty: 1 } })}>${Icon.plus()} Objet</button>
            <button type="button" class="btn small" onClick=${() => openModal({ kind: 'itemSearch', target: 'stash' })}>${Icon.search()} Chercher</button>` : null}
          <button type="button" class="btn small ghost" onClick=${() => openModal({ kind: 'moveLog' })}>${Icon.scroll()} Journal</button>
          <span class="last-move muted">${log[0] ? log[0].text : ''}</span>
        </div>
      <//>
    </div>
  </div>`;
}
