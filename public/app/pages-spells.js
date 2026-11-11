// Page « Sorts ».
import { t, tn } from '/shared/i18n.js';
import { html, useEffect, useState } from './html.js';
import {
  ABILITY_SHORT, ORDINAL, castableNow, isPreparedMode, num, preparedCount, signed, cantripCount, knownCount,
  spellAttack, spellDC, spellList, spellReady, abilityMod, spellLimits, classKey,
} from '/shared/rules.js';
import { act, openModal, setOps, setPath, setUi, store, toast } from './store.js';
import { data5e, spellRefresh } from './data.js';

// Les tableaux de classe (sorts préparés, cantrips) des classes de la fiche, chargés une fois.
function useClassData(doc) {
  const [data, setData] = useState({});
  const names = (doc.classes || []).map(c => c.name).filter(Boolean).join('|');
  useEffect(() => {
    let live = true;
    const legacy = (doc.edition || store.config.edition) === '2014';
    Promise.all((doc.classes || []).filter(c => c.name).map(async c => {
      const k = (legacy && await data5e.klass(c.name, 'PHB')) || await data5e.klass(c.name);
      return [classKey(c.name), k];
    })).then(list => { if (live) setData(Object.fromEntries(list.filter(([, v]) => v))); });
    return () => { live = false; };
  }, [names, doc.edition]);
  return data;
}

// Remet tous les sorts de la fiche d'accord avec 5etools ; les sorts maison et inconnus restent tels quels.
async function refreshAll(id, doc) {
  const ops = [];
  const missing = [];
  for (const s of spellList(doc)) {
    if (s.custom) continue;
    const ch = await spellRefresh(s);
    if (!ch) { missing.push(s.name); continue; }
    for (const [k, v] of Object.entries(ch)) ops.push([['spells', s.id, k], v]);
  }
  if (ops.length) setOps(id, ops);
  const n = new Set(ops.map(o => o[0][1])).size;
  toast(`${tn(n, '{n} sort mis à jour', '{n} sorts mis à jour')}${missing.length ? ` · ${t('introuvables dans 5etools : {list}', { list: missing.join(', ') })}` : ''}`, { kind: missing.length ? 'warn' : undefined });
}
import { Box, Num, Pips } from './ui.js';
import { undo } from './store.js';

// Retirer un sort : tout de suite, avec « Annuler » dans la notification.
function removeSpell(id, s) {
  setPath(id, ['spells', s.id], undefined).then(() => toast(t('{name} retiré', { name: s.name }), { action: { label: t('Annuler'), run: () => undo({ doc: id }) } }));
}
import { Header } from './pages-main.js';
import { rollD20 } from './dice.js';
import { Icon } from './icons.js';

const FILTERS = [
  ['all', 'Tous'], ['prepared', 'Préparés'], ['castable', 'Lançables'], ['cantrips', 'Cantrips'], ['rituals', 'Rituels'],
];

function SlotsBox({ id, doc, ro, edit }) {
  const sc = doc.spellcasting || {};
  const levels = [];
  for (let l = 1; l <= 9; l++) if (edit || num(sc.slots?.[l]?.max) > 0) levels.push(l);
  const pact = sc.pact || {};
  const showPact = edit || num(pact.max) > 0;
  const setMax = (l, v) => setOps(id, [[['spellcasting', 'slotsAuto'], false], [['spellcasting', 'slots', String(l), 'max'], v], [['spellcasting', 'slots', String(l), 'used'], Math.min(num(sc.slots?.[l]?.used), v)]]);
  return html`<div class="slots">
    ${levels.map(l => {
      const s = sc.slots?.[l] || {};
      return html`<div class="slot" key=${l}>
        <div class="slot-lvl">${ORDINAL[l]}</div>
        ${edit
          ? html`<label class="mini">max <${Num} value=${num(s.max)} min=${0} max=${9} onCommit=${v => setMax(l, v)} /></label>`
          : html`<${Pips} max=${s.max} used=${s.used} ro=${ro} onChange=${u => setPath(id, ['spellcasting', 'slots', String(l), 'used'], Math.max(0, Math.min(num(s.max), u)))} />
                 <div class="slot-n">${num(s.max) - num(s.used)}/${num(s.max)}</div>`}
      </div>`;
    })}
    ${showPact ? html`<div class="slot pact">
      <div class="slot-lvl">PACT MAGIC</div>
      ${edit
        ? html`<label class="mini">nb <${Num} value=${num(pact.max)} min=${0} max=${4} onCommit=${v => setOps(id, [[['spellcasting', 'slotsAuto'], false], [['spellcasting', 'pact', 'max'], v]])} /></label>
               <label class="mini">niv. <${Num} value=${num(pact.level)} min=${0} max=${5} onCommit=${v => setOps(id, [[['spellcasting', 'slotsAuto'], false], [['spellcasting', 'pact', 'level'], v]])} /></label>`
        : html`<${Pips} max=${pact.max} used=${pact.used} ro=${ro} cls="pact-pips" onChange=${u => setPath(id, ['spellcasting', 'pact', 'used'], Math.max(0, Math.min(num(pact.max), u)))} />
               <div class="slot-n">niveau ${num(pact.level)} · repos court</div>`}
    </div>` : null}
    ${!levels.length && !showPact ? html`<p class="muted">Aucun emplacement de sort.${ro ? '' : html` <span>Touche « Modifier » pour en ajouter.</span>`}</p>` : null}
  </div>`;
}

function filterSpells(doc, list, f, level) {
  return list.filter(s => {
    if (level != null && num(s.level) !== level) return false;
    switch (f) {
      case 'prepared': return num(s.level) === 0 || spellReady(doc, s);
      case 'castable': return castableNow(doc, s);
      case 'cantrips': return num(s.level) === 0;
      case 'rituals': return !!s.ritual;
      default: return true;
    }
  });
}

export function PageSpells({ id, doc, ro }) {
  const [edit, setEdit] = useState(false);
  const f = store.ui.spellFilter || 'all';
  const level = store.ui.spellLevel ?? null;
  const sc = doc.spellcasting || {};
  const prepMode = isPreparedMode(doc);
  const all = spellList(doc);
  const list = filterSpells(doc, all, f, level);
  const lim = spellLimits(doc, useClassData(doc));
  const cap = lim.prepared;
  const count = preparedCount(doc);
  const nCantrips = cantripCount(doc);
  const nKnown = knownCount(doc);
  const conc = doc.concentration;
  const ab = sc.ability || 'int';

  // La limite avertit sans bloquer : un sort de sous-classe ou de don peut la dépasser.
  const togglePrep = s => {
    if (!s.prepared && count >= cap) toast(t('Au-delà de la limite de {n} sorts préparés. Un sort gratuit (sous-classe, don) se marque dans sa fenêtre et ne compte pas.', { n: cap }), { kind: 'warn', ms: 6000 });
    setPath(id, ['spells', s.id, 'prepared'], !s.prepared);
  };
  const capTitle = lim.preparedFrom === 'table' ? 'Selon le tableau de la classe' : lim.preparedFrom === 'override' ? 'Limite réglée à la main (Réglages de la fiche)' : `Mod. ${ABILITY_SHORT[ab]} (${signed(abilityMod(doc, ab))}) + niveau`;

  const groups = [];
  for (const s of list) {
    const l = num(s.level);
    if (!groups.length || groups[groups.length - 1].level !== l) groups.push({ level: l, spells: [] });
    groups[groups.length - 1].spells.push(s);
  }

  return html`<div class="p-spells">
    <div class="g-head"><${Header} id=${id} doc=${doc} ro=${ro} /></div>
    <div class="sp-stats">
      <div class="stat-box"><b>${ABILITY_SHORT[ab]}</b><small>SPELLCASTING ABILITY</small></div>
      <div class="stat-box"><b>${spellDC(doc)}</b><small>SPELL SAVE DC</small></div>
      <button type="button" class="stat-box" onClick=${() => rollD20('Spell attack', spellAttack(doc))}><b>${signed(spellAttack(doc))}</b><small>SPELL ATTACK BONUS</small></button>
      ${prepMode
        ? html`<div class=${`stat-box ${count > cap ? 'over' : ''}`} title=${`${capTitle}. Les sorts gratuits ne comptent pas.`}><b>${count}/${cap}</b><small>PREPARED</small></div>`
        : html`<div class=${`stat-box ${lim.known != null && nKnown > lim.known ? 'over' : ''}`} title="Sans les sorts gratuits (sous-classe, dons, objets)"><b>${nKnown}${lim.known != null ? `/${lim.known}` : ''}</b><small>${sc.mode === 'known' ? 'SPELLS KNOWN' : 'SPELLS'}</small></div>`}
      ${lim.cantrips != null ? html`<div class=${`stat-box ${nCantrips > lim.cantrips ? 'over' : ''}`} title="Cantrips connus, sans les cantrips gratuits"><b>${nCantrips}/${lim.cantrips}</b><small>CANTRIPS</small></div>` : null}
      <div class=${`stat-box conc ${conc ? 'on' : ''}`}>
        ${conc ? html`<b class="conc-name">${conc.name}</b>
          ${ro ? null : html`<button type="button" class="btn tiny" onClick=${() => act('endConcentration').then(r => r.ok && toast(r.result?.toast))}>Terminer</button>`}`
          : html`<b class="muted">—</b>`}
        <small>CONCENTRATION</small>
      </div>
    </div>
    <${Box} label="SPELL SLOTS" cls="slots-box">
      ${ro ? null : html`<div class="corner-btns">
        ${edit ? html`<button type="button" class="btn tiny" onClick=${() => act('autoSlots').then(r => r.ok && toast('Emplacements recalculés selon la classe'))}>Auto</button>` : null}
        <button type="button" class="btn tiny" onClick=${() => setEdit(!edit)}>${edit ? 'OK' : 'Modifier'}</button>
      </div>`}
      <${SlotsBox} id=${id} doc=${doc} ro=${ro} edit=${edit} />
    <//>
    <div class="sp-filters">
      ${FILTERS.map(([k, l]) => html`<button type="button" class=${`chip-btn ${f === k ? 'on' : ''}`} onClick=${() => setUi({ spellFilter: k })}>${l}</button>`)}
      <span class="sep"></span>
      ${[null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => html`<button type="button" class=${`chip-btn lvl ${level === l ? 'on' : ''}`} onClick=${() => setUi({ spellLevel: l })}>${l == null ? 'Niv.' : l === 0 ? 'C' : l}</button>`)}
    </div>
    <div class="sp-list box">
      ${ro ? null : html`<div class="sp-tools">
        <button type="button" class="btn small primary" onClick=${() => openModal({ kind: 'spellSearch', id })}>${Icon.plus()} Ajouter un sort</button>
        <span class="muted small">${t('Corbeille sur une ligne : retirer le sort (annulable).')}</span>
        <span class="grow"></span>
        <button type="button" class="btn small ghost" title="Reprend les détails de chaque sort dans 5etools" onClick=${() => refreshAll(id, doc)}>Mettre à jour depuis 5etools</button>
      </div>`}
      ${groups.map(g => html`<div class="sp-group" key=${g.level}>
        <div class="sp-group-head">${g.level === 0 ? 'Cantrips' : `${ORDINAL[g.level]} level`}
          ${g.level > 0 && num(sc.slots?.[g.level]?.max) ? html`<span class="muted"> · ${num(sc.slots[g.level].max) - num(sc.slots[g.level].used)}/${num(sc.slots[g.level].max)} emplacements</span>` : null}
        </div>
        ${g.spells.map(s => {
          const ready = spellReady(doc, s);
          const canCast = castableNow(doc, s);
          return html`<div class=${`sp-row ${ready ? '' : 'unready'} ${conc?.spellId === s.id ? 'concentrating' : ''}`} key=${s.id}>
            ${prepMode && num(s.level) > 0
              ? html`<button type="button" class=${`prep ${s.prepared || s.always ? 'on' : ''} ${s.always ? 'always' : ''}`} disabled=${ro || s.always}
                  title=${s.always ? 'Toujours préparé' : s.prepared ? 'Préparé' : 'Non préparé'} onClick=${() => togglePrep(s)}></button>`
              : html`<span class="prep-sp"></span>`}
            <button type="button" class="sp-name" onClick=${() => openModal({ kind: 'spell', id, spellId: s.id })}>${s.name}</button>
            <span class="tags">
              ${s.always ? html`<i class="tag free" title="Gratuit : ne compte pas dans la limite">G</i>` : null}
              ${s.concentration ? html`<i class="tag c" title="Concentration">C</i>` : null}
              ${s.ritual ? html`<i class="tag r" title="Rituel">R</i>` : null}
            </span>
            <span class="sp-meta">${[s.time, s.range].filter(Boolean).join(' · ')}</span>
            ${ro ? null : html`<button type="button" class="icon-btn faint sp-edit" title="Modifier ce sort" onClick=${() => openModal({ kind: 'spell', id, spellId: s.id, edit: true })}>${Icon.pencil()}</button>
              <button type="button" class="icon-btn faint" title="Retirer ce sort" onClick=${() => removeSpell(id, s)}>${Icon.trash()}</button>
              <button type="button" class=${`btn tiny cast ${canCast ? '' : 'dim'}`} onClick=${() => openModal({ kind: 'cast', id, spellId: s.id })}>Lancer</button>`}
          </div>`;
        })}
      </div>`)}
      ${list.length ? null : html`<p class="muted pad">${all.length ? 'Aucun sort ne correspond au filtre.' : ro ? 'Aucun sort.' : 'Aucun sort. Touche « + Sort » pour chercher dans les données 5etools ou en créer un.'}</p>`}
    </div>
  </div>`;
}
