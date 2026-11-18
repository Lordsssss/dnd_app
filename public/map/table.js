// Le panneau « Memes » du MJ : ce que les joueurs peuvent faire depuis leur onglet « Carte ».
// Vue verrouillée, tokens bloqués, memes permis ou coupés, joueur par joueur.
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

export function MemePanel({ onImage }) {
  const tb = app.table;
  const [players, setPlayers] = useState(null);
  useEffect(() => { api(`/api/c/${campaignId}/map/players`).then(setPlayers).catch(e => { setPlayers([]); toast(e.message, 'error'); }); }, []);
  const muted = new Set(tb.muted || []);
  const setMuted = (id, off) => setTable({ muted: off ? [...muted, id] : [...muted].filter(x => x !== id) });
  const n = app.memeOverlay?.count || 0;
  const open = dialog => { app.dialog = dialog; notify(); };
  return html`<${Dialog} title="Joueurs et memes" wide>
    <div class="tb-panel">
      <section>
        <h3>Vue des joueurs</h3>
        <p class="muted small">Chaque joueur ouvre la carte depuis l'onglet « Carte » de sa fiche. Il voit ce que voit la TV et déplace ses tokens.</p>
        <${Switch} on=${tb.lock} label="Verrouiller leur vue sur le cadrage de la TV" hint="Ils ne peuvent plus bouger ni zoomer" onChange=${v => setTable({ lock: v })} />
        <${Switch} on=${tb.blockTokens} label="Bloquer leurs tokens" hint="Ils ne déplacent plus rien, la vue reste libre" onChange=${v => setTable({ blockTokens: v })} />
        <div class="tb-row">
          <button type="button" class="btn small" onClick=${() => request({ t: 'summon' })}>Ramener leur vue sur la TV</button>
          <a class="btn small ghost" href=${`/c/${campaignId}/carte/joueur`} target=${`joueur-${campaignId}`} rel="noopener">Voir comme un joueur ↗</a>
        </div>
      </section>
      <section>
        <h3>Memes</h3>
        <${Switch} on=${tb.memes} label="Les joueurs peuvent poser des memes" onChange=${v => setTable({ memes: v })} />
        <${Switch} on=${tb.memesOnTv} label="Afficher les memes sur la TV" onChange=${v => setTable({ memesOnTv: v })} />
        <${Switch} on=${tb.serious} label="Mode sérieux : cacher tous les memes, pour tout le monde" hint="Rien n'est effacé : ils reviennent quand tu l'éteins" onChange=${v => setTable({ serious: v })} />
        <p class="muted small">${n ? t(n > 1 ? '{n} memes sur cette carte.' : '{n} meme sur cette carte.', { n }) : t('Aucun meme sur cette carte.')} Colle une image sur la carte avec Ctrl+V, ou glisse-la.</p>
        <div class="tb-row">
          <button type="button" class="btn small" disabled=${!app.doc} onClick=${() => { app.dialog = null; notify(); onImage(); }}>🖼 Image</button>
          <button type="button" class="btn small" disabled=${!app.doc} onClick=${() => open({ kind: 'memeMaker', mk: 'text' })}>Aa Texte</button>
          <button type="button" class="btn small" onClick=${() => open({ kind: 'shelf' })}>📚 Mèmothèque</button>
          <button type="button" class="btn small danger ghost" disabled=${!n} onClick=${() => { if (confirm(tx('Effacer tous les memes de cette carte ?'))) request({ t: 'meme', action: 'clear' }); }}>Tout effacer sur cette carte</button>
        </div>
      </section>
      <section>
        <h3>Joueur par joueur</h3>
        ${players === null ? html`<p class="muted">Chargement…</p>` : !players.length ? html`<p class="muted">Aucun joueur dans cette campagne.</p>` : html`<div class="tb-players">
          ${players.map(p => html`<div class="tb-player" key=${p.id}>
            <span class="tb-name">${p.name}${p.chars.length ? html` <small class="muted">${p.chars.map(c => c.name).join(', ')}</small>` : null}</span>
            <${Switch} on=${!muted.has(p.id)} label="Memes" onChange=${v => setMuted(p.id, !v)} />
            <button type="button" class="btn tiny danger ghost" onClick=${() => { if (confirm(tx('Effacer tous les memes de ce joueur, sur toutes les cartes ?'))) request({ t: 'meme', action: 'wipe', account: p.id }); }}>Effacer ses memes</button>
          </div>`)}
        </div>`}
      </section>
    </div>
  <//>`;
}
