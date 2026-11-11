// L'ordre d'initiative, sur le portable seulement. Pas de PV : seulement les tours.
// Un combat se lance depuis la sélection : cadre sur la carte, puis « Lancer le combat ».
import { html, useEffect, useState } from '/app/html.js';
import { isOut, groupName } from '/shared/map/tracker.js';
import { app, notify, op, requestDraw, selectedTokens } from './state.js';

function TotalField({ row }) {
  const [v, setV] = useState(row.total ?? '');
  useEffect(() => { setV(row.total ?? ''); }, [row.total]);
  const commit = () => {
    const next = v === '' ? null : Number(v);
    if (next === (row.total ?? null) || Number.isNaN(next)) return;
    op({ type: 'fight.row', rowId: row.id, patch: { total: next } });
  };
  return html`<input class=${`trk-total ${row.total == null ? 'empty' : ''}`} inputMode="numeric" aria-label=${`Initiative de ${row.name}`}
    placeholder=${row.kind === 'pc' ? '?' : ''}
    value=${v} onInput=${e => setV(e.target.value)} onBlur=${commit}
    onKeyDown=${e => { if (e.key === 'Enter') { commit(); e.target.blur(); } e.stopPropagation(); }} />`;
}

function Row({ row, fight, tokens, sel }) {
  const out = isOut(row, tokens);
  const active = fight.started && fight.current === row.id;
  const live = row.tokenIds.filter(id => { const t = tokens.find(x => x.id === id); return t && !t.defeated; }).length;
  const selectTokens = () => { app.selection = new Set(row.tokenIds); notify(); requestDraw(); };
  const rename = () => {
    const name = prompt('Nom de la ligne', row.name);
    if (name?.trim()) op({ type: 'fight.row', rowId: row.id, patch: { name: name.trim() } });
  };
  const outside = sel.filter(t => !row.tokenIds.includes(t.id));
  return html`<li class=${`trk-row ${active ? 'on' : ''} ${out ? 'out' : ''} ${row.kind === 'pc' && row.total == null ? 'todo' : ''}`}
    onMouseEnter=${() => { app.rowHover = row.id; requestDraw(); }}
    onMouseLeave=${() => { app.rowHover = null; requestDraw(); }}>
    <${TotalField} row=${row} />
    <button type="button" class="trk-name" title="Sélectionner ses tokens · double-clic : renommer" onClick=${selectTokens} onDblClick=${rename}>
      <b>${row.name}</b>
      <small>${row.kind === 'pc' ? (row.total == null ? 'initiative à saisir' : 'PJ') : out ? 'vaincu, tour sauté' : `${row.roll ?? '—'} ${row.mod >= 0 ? '+' : '−'} ${Math.abs(row.mod)} · ${live}/${row.tokenIds.length} en jeu`}</small>
    </button>
    <span class="trk-tools">
      ${outside.length && row.kind !== 'pc' ? html`<button type="button" class="icon" title=${`Mettre la sélection dans ce groupe (${outside.length})`} onClick=${() => op({ type: 'fight.addToRow', rowId: row.id, tokenIds: outside.map(t => t.id) })}>+</button>` : null}
      ${row.kind !== 'pc' && row.tokenIds.length > 1 ? html`<button type="button" class="icon" title="Séparer : une ligne et un jet par token" onClick=${() => op({ type: 'fight.split', rowId: row.id })}>⇉</button>` : null}
      <button type="button" class="icon" title="Monter" onClick=${() => op({ type: 'fight.moveRow', rowId: row.id, dir: -1 })}>↑</button>
      <button type="button" class="icon" title="Descendre" onClick=${() => op({ type: 'fight.moveRow', rowId: row.id, dir: 1 })}>↓</button>
      ${row.kind === 'pc' ? null : html`<button type="button" class="icon" title="Relancer" onClick=${() => op({ type: 'fight.reroll', rowId: row.id })}>⟳</button>`}
      <button type="button" class="icon" title="Retirer de l'ordre" onClick=${() => op({ type: 'fight.removeRow', rowId: row.id })}>×</button>
    </span>
  </li>`;
}

// Sélection rapide : les PJ et les ennemis visibles de la carte, sans les PNJ ni les vaincus.
function selectFighters() {
  const ids = (app.doc?.tokens || []).filter(t => (t.kind === 'pc' || !t.kind || t.kind === 'enemy') && !t.defeated && !t.hidden).map(t => t.id);
  app.selection = new Set(ids);
  app.tool = 'select';
  notify();
  requestDraw();
}

function SelectionSummary({ sel }) {
  const pcs = sel.filter(t => t.kind === 'pc');
  const others = sel.filter(t => t.kind !== 'pc');
  return html`<div class="trk-sel">
    <p class="small"><b>${sel.length}</b> sélectionné${sel.length > 1 ? 's' : ''}</p>
    ${pcs.length ? html`<p class="small muted">PJ : ${pcs.map(t => t.name).join(', ')}</p>` : null}
    ${others.length ? html`<p class="small muted">Créatures : ${groupName(others)}</p>` : null}
  </div>`;
}

// Une fois les tokens dans l'ordre, la sélection n'a plus de raison d'être.
function launch(type, ids) {
  op({ type, tokenIds: ids }).then(r => {
    if (!r.ok) return;
    app.selection = new Set();
    notify();
    requestDraw();
  });
}

export function Tracker() {
  const doc = app.doc;
  if (!doc) return null;
  const f = doc.fight;
  const sel = selectedTokens();
  const inFight = new Set((f?.rows || []).flatMap(r => r.tokenIds));
  const newcomers = sel.filter(t => !inFight.has(t.id));
  const todo = (f?.rows || []).filter(r => r.kind === 'pc' && r.total == null).length;

  return html`<aside class="tracker">
    <header class="trk-head">
      <h2>Initiative${f?.started ? html` <span class="trk-round">Round ${f.round}</span>` : null}</h2>
      ${f ? html`<button type="button" class="btn tiny ghost" onClick=${() => { if (confirm('Terminer le combat ?')) op({ type: 'fight.end' }); }}>Fin du combat</button>` : null}
    </header>
    ${!f ? html`<div class="trk-empty">
      <ol class="trk-steps">
        <li><b>Sélectionne</b> ce qui se bat : outil Tokens (V), glisse un cadre sur la carte. Maj+clic ajoute ou retire un token.</li>
        <li><b>Lance le combat.</b> Les créatures identiques partagent un jet. Tu saisis l'initiative annoncée par chaque PJ.</li>
      </ol>
      <button type="button" class="btn small ghost" onClick=${selectFighters} title="Sélectionne les PJ et les ennemis visibles de la carte, sans PNJ ni vaincus">Tous les PJ et ennemis</button>
      ${sel.length ? html`<${SelectionSummary} sel=${sel} />` : null}
      <button type="button" class="btn primary trk-go" disabled=${!sel.length} onClick=${() => launch('fight.create', sel.map(t => t.id))}>
        ${sel.length ? `Lancer le combat (${sel.length})` : 'Lancer le combat'}
      </button>
    </div>` : html`
      <div class="trk-actions">
        ${f.started ? html`
          <button type="button" class="btn" title="Tour précédent" onClick=${() => op({ type: 'fight.prev' })}>←</button>
          <button type="button" class="btn primary grow" title="Raccourci : N" onClick=${() => op({ type: 'fight.next' })}>Tour suivant</button>` : html`
          <button type="button" class="btn primary grow" disabled=${!f.rows.length} onClick=${() => op({ type: 'fight.start' })}>Commencer</button>`}
      </div>
      ${todo ? html`<p class="trk-hint small">${todo} PJ sans initiative : tape le nombre annoncé dans sa case, l'ordre se replace.</p>` : null}
      <ol class="trk-rows">
        ${f.rows.map(r => html`<${Row} key=${r.id} row=${r} fight=${f} tokens=${doc.tokens} sel=${sel} />`)}
        ${f.rows.length ? null : html`<li class="muted small trk-none">Sélectionne des tokens sur la carte pour les ajouter.</li>`}
      </ol>
      ${newcomers.length ? html`<div class="trk-add">
        <${SelectionSummary} sel=${newcomers} />
        <button type="button" class="btn small primary" onClick=${() => launch('fight.addTokens', newcomers.map(t => t.id))}>Ajouter au combat (${newcomers.length})</button>
      </div>` : null}`}
  </aside>`;
}
