// La carte d'infos au survol d'un token : sur le portable seulement, jamais sur la TV.
// Une créature de 5etools montre son bloc ; une créature du bestiaire de la campagne, le bloc
// écrit par le MJ. Les PV suivis, les conditions et les notes du token s'affichent au-dessus.
import { html, useEffect, useRef, useState } from '/app/html.js';
import { renderMonster } from '/shared/render5e.js';
import { renderNote } from '/shared/map/markdown.js';
import { bestiaryLink } from '/shared/map/monster.js';
import { data5e } from '/app/data.js';
import { refClick } from '/app/compendium.js';
import { app } from './state.js';
import { api, campaignId } from './net.js';

function useCardData(ref) {
  const [state, setState] = useState({ loading: true });
  const key = ref ? JSON.stringify(ref) : '';
  useEffect(() => {
    let live = true;
    if (!ref) { setState({ none: true }); return undefined; }
    setState({ loading: true });
    const load = ref.t === 'monster'
      ? data5e.entry('monster', ref.name, ref.source).then(e => (e?.monster ? { monster: e.monster, link: bestiaryLink(e.monster.name, e.monster.source) } : { error: 'Créature absente des données 5etools' }))
      : ref.t === 'beast'
        ? api(`/api/c/${campaignId}/bestiary/${encodeURIComponent(ref.id)}`).then(b => ({ beast: b, link: b.origin?.link || (b.ref?.source ? bestiaryLink(b.ref.name, b.ref.source) : null) }))
        : Promise.resolve({ error: 'Lien vers une ancienne note : choisis une créature du bestiaire dans Détails' });
    load.then(v => { if (live) setState(v); }).catch(e => { if (live) setState({ error: e.message }); });
    return () => { live = false; };
  }, [key]);
  return state;
}

function TokenState({ token }) {
  if (!token.hp && !token.conditions?.length && !token.notes) return null;
  return html`<div class="card-state">
    ${token.hp ? html`<span class="badge">PV ${token.hp.current} / ${token.hp.max}</span>` : null}
    ${(token.conditions || []).map(c => html`<span class="badge warn">${c}</span>`)}
    ${token.notes ? html`<p class="card-notes">${token.notes}</p>` : null}
  </div>`;
}

function CardBody({ token }) {
  const d = useCardData(token.ref);
  const noRolls = e => {
    if (e.target.closest('.dice.roll')) { e.preventDefault(); return; }
    if (e.target.closest('a[target="_blank"]')) return;
    refClick(e);
  };
  return html`<div class="info-card-in">
    <header>
      <b>${token.name}</b>
      ${d.link ? html`<a class="ext" href=${d.link} target="_blank" rel="noopener">5etools ↗</a>` : null}
    </header>
    <${TokenState} token=${token} />
    ${d.loading ? html`<p class="muted small">Chargement…</p>` : null}
    ${d.none ? html`<p class="muted small">Aucune fiche liée à ce token.</p>` : null}
    ${d.error ? html`<p class="warn small">${d.error}</p>` : null}
    ${d.monster ? html`<div class="entries" onClick=${noRolls} dangerouslySetInnerHTML=${{ __html: renderMonster(d.monster) }}></div>` : null}
    ${d.beast ? html`<div class="note-block" onClick=${noRolls} dangerouslySetInnerHTML=${{ __html: renderNote(String(d.beast.body || '').split('\n')) }}></div>
      ${d.beast.notes ? html`<p class="card-notes">${d.beast.notes}</p>` : null}
      ${d.beast.origin?.file ? html`<p class="muted small note-src">Coffre : ${d.beast.origin.file.split('/').pop().replace(/\.md$/, '')}</p>` : null}` : null}
  </div>`;
}

export function InfoCard() {
  const [shownId, setShownId] = useState(null);
  const inside = useRef(false);
  const timer = useRef(null);
  const hover = app.tool === 'select' && !app.t.drag?.moved ? app.hover : null;
  const candidate = hover ? app.doc?.tokens.find(t => t.id === hover) : null;
  // Un PJ ou un figurant sans fiche n'a rien à montrer : pas de carte vide au survol.
  const wanted = candidate && (candidate.ref || candidate.hp || candidate.notes || candidate.conditions?.length) && (candidate.kind !== 'pc' || candidate.notes || candidate.conditions?.length) ? candidate.id : null;

  useEffect(() => {
    clearTimeout(timer.current);
    if (wanted) timer.current = setTimeout(() => setShownId(wanted), 180);
    else timer.current = setTimeout(() => { if (!inside.current) setShownId(null); }, 320);
    return () => clearTimeout(timer.current);
  }, [wanted]);

  const token = shownId ? app.doc?.tokens.find(t => t.id === shownId) : null;
  if (!token) return null;

  const sx = (token.x - app.cam.x) * app.cam.z;
  const sy = (token.y - app.cam.y) * app.cam.z;
  const r = ((token.size || 1) / 2) * app.cam.z;
  const onRight = sx < app.size.w / 2;
  const style = {
    top: `${Math.max(8, Math.min(sy - 80, app.size.h - 420))}px`,
    ...(onRight ? { left: `${sx + r + 14}px` } : { right: `${app.size.w - sx + r + 14}px` }),
  };
  return html`<div class="info-card" style=${style}
    onMouseEnter=${() => { inside.current = true; clearTimeout(timer.current); }}
    onMouseLeave=${() => { inside.current = false; setShownId(null); }}>
    <${CardBody} key=${token.id} token=${token} />
  </div>`;
}
