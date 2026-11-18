// Le panneau « Joueurs » du MJ : ce que les joueurs peuvent faire depuis leur onglet « Carte ».
// Vue verrouillée, tokens bloqués, images collées et dessins permis ou coupés, joueur par joueur.
import { t, tx } from '/shared/i18n.js';
import { html, useEffect, useState } from '/app/html.js';
import { api, campaignId } from './net.js';
import { app, notify, request, setTable, toast } from './state.js';
import { Dialog } from './pickers.js';

function Switch({ on, label, hint, onChange }) {
  return html`<label class="tb-switch" title=${hint}>
    <input type="checkbox" checked=${on} onChange=${e => onChange(e.target.checked)} />
    <span>${label}</span>
  </label>`;
}

export function PlayersPanel({ onImage }) {
  const tb = app.table;
  const [players, setPlayers] = useState(null);
  useEffect(() => { api(`/api/c/${campaignId}/map/players`).then(setPlayers).catch(e => { setPlayers([]); toast(e.message, 'error'); }); }, []);
  const muted = new Set(tb.muted || []);
  const setMuted = (id, off) => setTable({ muted: off ? [...muted, id] : [...muted].filter(x => x !== id) });
  const n = app.overlay?.count || 0;
  const mine = app.me ? app.overlay?.countBy(app.me.id) || 0 : 0;
  return html`<${Dialog} title="Joueurs" wide>
    <div class="tb-panel">
      <section>
        <h3>Vue des joueurs</h3>
        <p class="muted small">Chaque joueur ouvre la carte depuis l'onglet « Carte » de sa fiche. Il voit ce que voit la TV et déplace ses tokens.</p>
        <${Switch} on=${tb.lock} label="Verrouiller leur vue sur le cadrage de la TV" hint="Ils ne peuvent plus bouger ni zoomer" onChange=${v => setTable({ lock: v })} />
        <${Switch} on=${tb.blockTokens} label="Bloquer leurs tokens" hint="Ils ne déplacent plus rien, la vue reste libre" onChange=${v => setTable({ blockTokens: v })} />
        <div class="tb-row">
          <button type="button" class="btn small" onClick=${() => request({ t: 'summon' })}>Ramener leur vue sur la TV</button>
        </div>
      </section>
      <section>
        <h3>Images et dessins</h3>
        <p class="muted small">Chacun colle des images avec Ctrl+V ou en les glissant sur la carte, dessine, et n'efface que ce qu'il a posé.</p>
        <${Switch} on=${tb.draw} label="Les joueurs peuvent coller des images et dessiner" onChange=${v => setTable({ draw: v })} />
        <${Switch} on=${tb.onTv} label="Les afficher sur la TV" onChange=${v => setTable({ onTv: v })} />
        <p class="muted small">${n ? t(n > 1 ? '{n} éléments sur cette carte, dont {m} à toi.' : '{n} élément sur cette carte, dont {m} à toi.', { n, m: mine }) : t('Rien sur cette carte.')}</p>
        <div class="tb-row">
          <button type="button" class="btn small" disabled=${!app.doc} onClick=${() => { app.dialog = null; notify(); onImage(); }}>🖼 Coller une image</button>
          <button type="button" class="btn small danger ghost" disabled=${!mine} onClick=${() => { if (confirm(tx('Effacer toutes tes images sur cette carte ?'))) request({ t: 'draw', action: 'clearMine' }); }}>Effacer mes images</button>
        </div>
      </section>
      <section>
        <h3>Joueur par joueur</h3>
        ${players === null ? html`<p class="muted">Chargement…</p>` : !players.length ? html`<p class="muted">Aucun joueur dans cette campagne.</p>` : html`<div class="tb-players">
          ${players.map(p => html`<div class="tb-player" key=${p.id}>
            <span class="tb-name">${p.name}${p.chars.length ? html` <small class="muted">${p.chars.map(c => c.name).join(', ')}</small>` : null}</span>
            <a class="btn tiny ghost" href=${`/c/${campaignId}/carte/joueur?as=${encodeURIComponent(p.id)}`} target=${`joueur-${campaignId}-${p.id}`} rel="noopener" title="Son onglet Carte, tel qu'il le voit, en lecture seule">👁 Sa vue ↗</a>
            <${Switch} on=${!muted.has(p.id)} label="Images et dessins" onChange=${v => setMuted(p.id, !v)} />
            <button type="button" class="btn tiny danger ghost" title="Sur toutes les cartes de la campagne" onClick=${() => { if (confirm(tx('Effacer tout ce que ce joueur a collé et dessiné, sur toutes les cartes ?'))) request({ t: 'draw', action: 'wipe', account: p.id }); }}>Effacer ses images et dessins</button>
          </div>`)}
        </div>`}
      </section>
    </div>
  <//>`;
}
