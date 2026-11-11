// Application : routes (accueil, campagne, panneau MJ, console admin, invitation), barre du haut
// des fiches, pages, journal des jets.
import { html, render, useEffect, useErrorBoundary, useRef, useState } from './html.js';
import {
  store, subscribe, resume, logout, setView, setUi, setTheme, setFit, openModal,
  canEdit, charDoc, charIds, myCharId, mineIds, playChar, isDm, undo, dismissToast, linkClick, api,
} from './store.js';
import { PageFrame } from './frame.js';
import { PageMain, PageCombat } from './pages-main.js';
import { PageSpells } from './pages-spells.js';
import { PageInventory } from './pages-inventory.js';
import { PageNotes, PageSecret } from './pages-notes.js';
import { PageRules } from './pages-rules.js';
import { PageInfusions } from './pages-infusions.js';
import { DrawLayer, clearDrawing } from './drawing.js';
import { ModalHost } from './dialogs.js';
import { DmPage, DmModals } from './dm.js';
import { AdminPage } from './admin.js';
import { AuthPage, FirstSecret } from './auth.js';
import { AccountButton, HomeModals, HomePage, InviteAccept } from './home.js';
import { NoSheetYet } from './creator.js';
import { rollFormula } from './dice.js';
import { Icon } from './icons.js';
import { classLevel, num } from '/shared/rules.js';
import { t, locale } from '/shared/i18n.js';

const PAGES = [
  ['main', () => t('Principal'), PageMain],
  ['combat', () => t('Combat'), PageCombat],
  ['spells', () => t('Sorts'), PageSpells],
  ['rules', () => t('Règles'), PageRules],
  ['infusions', () => t('Infusions'), PageInfusions],
  ['inventory', () => t('Inventaire'), PageInventory],
  ['notes', () => t('Notes'), PageNotes],
  ['secret', () => t('Secret'), PageSecret],
];

// Pages visibles pour cette fiche : Secret pour son joueur et le MJ, Infusions pour un Artificer.
function pageAllowed(k, charId) {
  if (k === 'secret') return isDm() || charId === myCharId();
  if (k === 'infusions') return classLevel(charDoc(charId) || {}, 'artificer') > 0;
  return true;
}

// Abonnement au store pris pendant le rendu, pas dans un effet : un effet attend l'image
// suivante, et un onglet en arrière-plan peut la faire attendre longtemps, assez pour rater
// les premières notifications (compte chargé, connexion établie).
function useStore() {
  const [, force] = useState(0);
  const sub = useRef(null);
  if (!sub.current) sub.current = subscribe(() => force(x => x + 1));
  useEffect(() => () => { sub.current?.(); sub.current = null; }, []);
}

// ---------------------------------------------------------------- Barre du haut des fiches

function Menu({ onClose }) {
  const theme = store.ui.theme;
  const cid = store.route.cid;
  return html`<div class="menu-back" onClick=${onClose}>
    <div class="menu" onClick=${e => e.stopPropagation()}>
      ${isDm() ? html`<a class="menu-link" href=${`/c/${cid}/mj`} onClick=${e => { onClose(); linkClick(e); }}>${Icon.scroll()} ${t('Panneau MJ')}</a>
        <a class="menu-link" href=${`/c/${cid}/mj/journal`} onClick=${e => { onClose(); linkClick(e); }}>${Icon.list()} ${t('Journal des actions')}</a>` : null}
      <a class="menu-link" href=${`/c/${cid}/monde`} target=${`monde-${cid}`} rel="noopener" onClick=${onClose}>${Icon.globe()} ${t('Carte du monde')}</a>
      <button type="button" onClick=${() => { onClose(); openModal({ kind: 'compendium' }); }}>${Icon.book()} ${t('Compendium 5etools')}</button>
      ${store.view.charId ? html`<button type="button" onClick=${() => { onClose(); openModal({ kind: 'settings', id: store.view.charId }); }}>${Icon.gear()} ${t('Réglages de la fiche / JSON')}</button>` : null}
      ${!isDm() ? html`<button type="button" onClick=${() => { onClose(); openModal({ kind: 'newChar' }); }}>${Icon.plus()} ${t('Nouveau personnage')}</button>` : null}
      <button type="button" onClick=${() => setTheme(theme === 'light' ? null : 'light')}>${Icon.moon()} ${t('Thème')} : ${theme === 'light' ? t('clair') : t('sombre')}</button>
      <button type="button" onClick=${() => setFit(store.ui.fit === 'page' ? 'width' : 'page')}>${Icon.fit()} ${t('Ajuster')} : ${store.ui.fit === 'page' ? t('page entière') : t('largeur')}</button>
    </div>
  </div>`;
}

// Une fiche de ce compte, mais pas celle que l'onglet joue : la prendre.
const ownOther = id => mineIds().includes(id) && id !== myCharId() && !isDm();

function TopBar({ children }) {
  const [menu, setMenu] = useState(false);
  const { charId, page } = store.view;
  const mine = canEdit(charId);
  const cid = store.route.cid;
  const pages = PAGES.filter(([k]) => pageAllowed(k, charId));
  const st = store.stacks[charId]?.sheet;
  const mode = store.ui.rollMode;
  return html`<nav class="topbar">
    <div class="tb-row">
      <a class="tb-home" href="/" onClick=${linkClick} title=${t('Mes campagnes')}>${Icon.home()}</a>
      <span class="tb-camp" title=${store.config.campaign?.name}>${store.config.campaign?.name}</span>
      <div class="chars">
        ${charIds().map(id => {
          const d = charDoc(id);
          return html`<button type="button" key=${id} class=${`char-tab ${id === charId ? 'on' : ''} ${id === myCharId() ? 'me' : ''}`}
            onClick=${() => (ownOther(id) ? playChar(id) : setView({ charId: id }))} title=${ownOther(id) ? t('Ta fiche : clic pour la jouer') : undefined}>
            ${d.name || t('Sans nom')}${id === myCharId() ? html`<i>${t('moi')}</i>` : ''}
            <span class=${`hp-dot ${num(d.hp?.current) <= 0 ? 'down' : num(d.hp?.current) / Math.max(1, num(d.hp?.max)) < 0.35 ? 'low' : ''}`}></span>
          </button>`;
        })}
      </div>
      <div class="tools">
        ${isDm() ? html`<a class="map-btn" href=${`/c/${cid}/carte`} target=${`carte-${cid}`} rel="noopener" title=${t('Ouvre la carte et l\'initiative dans un nouvel onglet')}>${Icon.map()}<span>${t('Carte')}</span></a>` : null}
        <span class=${`conn ${store.conn}`} title=${store.conn === 'online' ? t('Connecté') : store.conn === 'connecting' ? t('Connexion…') : t('Hors ligne')}></span>
        <div class="seg" role="group" aria-label=${t('Mode de jet')}>
          <button type="button" class=${mode === 'adv' ? 'on' : ''} onClick=${() => setUi({ rollMode: mode === 'adv' ? null : 'adv' })} title=${t('Avantage au prochain jet')}>ADV</button>
          <button type="button" class=${mode === 'dis' ? 'on' : ''} onClick=${() => setUi({ rollMode: mode === 'dis' ? null : 'dis' })} title=${t('Désavantage au prochain jet')}>DIS</button>
        </div>
        ${mine ? html`
          <button type="button" class="icon-btn" disabled=${!st?.undo} title=${st?.label ? t('Annuler : {label}', { label: t(st.label) }) : t('Annuler')} onClick=${() => undo()}>${Icon.undo()}</button>
          <button type="button" class="icon-btn" disabled=${!st?.redo} title=${st?.redoLabel ? t('Rétablir : {label}', { label: t(st.redoLabel) }) : t('Rétablir')} onClick=${() => undo({ redo: true })}>${Icon.redo()}</button>` : null}
        <button type="button" class=${`icon-btn ${store.ui.logOpen ? 'on' : ''}`} title=${t('Journal des jets')} onClick=${() => setUi({ logOpen: !store.ui.logOpen })}>${Icon.d20()}</button>
        <button type="button" class="icon-btn" title=${t('Menu')} onClick=${() => setMenu(true)}>${Icon.menu()}</button>
        <${AccountButton} />
      </div>
    </div>
    <div class="tb-row pages">
      ${pages.map(([k, label]) => html`<button type="button" key=${k} class=${`page-tab ${k === page ? 'on' : ''} ${k === 'secret' ? 'secret' : ''}`} onClick=${() => setView({ page: k })}>${k === 'secret' ? html`${Icon.lock()} ` : ''}${label()}</button>`)}
    </div>
    ${children}
    ${menu ? html`<${Menu} onClose=${() => setMenu(false)} />` : null}
  </nav>`;
}

function PencilBar({ id, doc, layer }) {
  const p = store.ui.pencil;
  const set = patch => setUi({ pencil: { ...p, ...patch } });
  const stackName = layer === 'secret' ? 'draw:secret' : 'draw:notes';
  const stack = store.stacks[id]?.[stackName];
  return html`<div class="pencil-bar">
    <button type="button" class=${`btn small ${p.on ? 'on' : ''}`} onClick=${() => set({ on: !p.on })}>${Icon.pencil()} ${p.on ? t('Crayon actif') : t('Crayon')}</button>
    ${p.on ? html`
      ${['k', 'r', 'b'].map(c => html`<button type="button" class=${`ink ink-${c} ${p.tool === 'pen' && p.color === c ? 'on' : ''}`} aria-label=${{ k: t('Encre'), r: t('Rouge'), b: t('Bleu') }[c]} onClick=${() => set({ color: c, tool: 'pen' })}></button>`)}
      <button type="button" class=${`icon-btn ${p.tool === 'eraser' ? 'on' : ''}`} title=${t('Gomme')} onClick=${() => set({ tool: p.tool === 'eraser' ? 'pen' : 'eraser' })}>${Icon.eraser()}</button>
      <button type="button" class="icon-btn" disabled=${!stack?.undo} title=${t('Annuler le trait')} onClick=${() => undo({ stack: stackName })}>${Icon.undo()}</button>
      <button type="button" class="icon-btn" disabled=${!stack?.redo} title=${t('Rétablir le trait')} onClick=${() => undo({ stack: stackName, redo: true })}>${Icon.redo()}</button>
      <button type="button" class="btn tiny ghost" onClick=${() => openModal({ kind: 'confirm', title: t('Tout effacer ?'), text: t('Efface tous les traits de cette page (annulable avec ↶).'), ok: t('Effacer'), danger: true, onOk: () => clearDrawing(id, doc, layer) })}>${t('Tout effacer')}</button>
      <span class="muted small hint">${t('Stylet : le doigt fait défiler.')}</span>` : html`<span class="muted small hint">${t('Active le crayon pour dessiner sur la page.')}</span>`}
  </div>`;
}

// ---------------------------------------------------------------- Jets

function RollCard() {
  const r = store.lastRoll;
  if (!r) return null;
  const crit = r.nat === 20 ? 'crit' : r.nat === 1 ? 'fumble' : '';
  return html`<div class=${`roll-card ${crit}`} key=${r.shownAt} onClick=${() => { store.lastRoll = null; setUi({}); }}>
    <div class="rc-label">${r.label}${r.mode ? html` <span class="badge">${r.mode === 'adv' ? t('avantage') : t('désavantage')}</span>` : null}</div>
    <div class="rc-total">${r.total}</div>
    <div class="rc-detail">${r.detail}</div>
  </div>`;
}

function RollLog() {
  const [expr, setExpr] = useState('');
  if (!store.ui.logOpen) return null;
  const rolls = [...store.rolls].reverse();
  const go = e => { e?.preventDefault(); if (rollFormula(expr || 'd20', expr || '1d20')) setExpr(''); };
  return html`<aside class="roll-log">
    <header><h2>${t('Jets de la table')}</h2><button type="button" class="icon-btn" onClick=${() => setUi({ logOpen: false })}>${Icon.close()}</button></header>
    <form class="free-roll" onSubmit=${go}>
      <input class="txt" placeholder="2d6+3" value=${expr} onInput=${e => setExpr(e.target.value)} />
      <button type="submit" class="btn small">${t('Lancer')}</button>
    </form>
    <div class="dice-row">${[4, 6, 8, 10, 12, 20, 100].map(d => html`<button type="button" class="btn tiny" onClick=${() => rollFormula(`d${d}`, `1d${d}`)}>d${d}</button>`)}</div>
    <ol class="rolls">
      ${rolls.map(r => html`<li key=${r.id} class=${`${r.nat === 20 ? 'crit' : r.nat === 1 ? 'fumble' : ''} ${r.private ? 'private' : ''}`}>
        <div class="r-top"><b>${r.who}</b>${r.private ? html` <span class="badge" title=${t('Visible du MJ seulement')}>${Icon.lock()} ${t('MJ')}</span>` : null} <span class="muted">${new Date(r.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}</span></div>
        <div class="r-mid"><span>${r.label}${r.mode ? ` (${r.mode === 'adv' ? t('avantage') : t('désavantage')})` : ''}</span><strong>${r.total}</strong></div>
        <div class="r-det muted">${r.detail}</div>
      </li>`)}
      ${rolls.length ? null : html`<li class="muted">${t('Aucun jet pour l\'instant.')}</li>`}
    </ol>
  </aside>`;
}

function Toasts() {
  return html`<div class="toasts">${store.toasts.map(tt => html`<div key=${tt.id} class=${`toast ${tt.kind}`}>
    <span>${tt.text}</span>
    ${tt.action ? html`<button type="button" class="btn tiny" onClick=${() => { dismissToast(tt.id); tt.action.run(); }}>${tt.action.label}</button>` : null}
    <button type="button" class="icon-btn faint" onClick=${() => dismissToast(tt.id)} aria-label=${t('Fermer')}>${Icon.close()}</button>
  </div>`)}</div>`;
}

// ---------------------------------------------------------------- Garde-fou

// Une page ou une fenêtre qui plante n'emporte pas toute l'application : on affiche l'erreur à
// sa place, et changer de fiche ou de page réessaie.
function Guard({ children, resetKey, inline = false }) {
  const [error, reset] = useErrorBoundary(e => console.error(e));
  useEffect(() => { if (error) reset(); }, [resetKey]);
  if (!error) return children;
  return html`<div class=${inline ? 'guard-inline' : 'empty-state'}>
    <p class="big">${t('Cette partie n\'a pas pu s\'afficher.')}</p>
    <p class="muted small">${String(error?.message || error)}</p>
    <button type="button" class="btn" onClick=${reset}>${t('Réessayer')}</button>
  </div>`;
}

// ---------------------------------------------------------------- Coquille d'une campagne

function Shell() {
  const { charId } = store.view;
  let { page } = store.view;
  const doc = charDoc(charId);
  if (!pageAllowed(page, charId)) page = 'main';
  const ro = !canEdit(charId);
  const entry = PAGES.find(([k]) => k === page) || PAGES[0];
  const Page = entry[2];
  const layer = page === 'notes' ? 'notes' : page === 'secret' ? 'secret' : null;
  const theme = store.ui.theme;
  const cid = store.route.cid;

  useEffect(() => {
    const k = e => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      const tg = e.target;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return;
      if (!canEdit(store.view.charId)) return;
      e.preventDefault();
      undo({ redo: e.shiftKey });
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => { document.title = `${store.config.campaign?.name || ''} · ${t('Table D&D')}`; }, [store.config.campaign?.name]);

  const owner = doc ? store.chars[charId]?.owner : null;
  return html`<div class=${`shell ${store.ui.logOpen ? 'log-open' : ''}`} data-theme-key=${theme}>
    <${TopBar}>
      ${store.conn !== 'online' ? html`<div class="banner offline">${t('Hors ligne : reconnexion en cours… Les modifications seront envoyées au retour du réseau.')}</div>` : null}
      ${doc && layer && !ro ? html`<${PencilBar} id=${charId} doc=${doc} layer=${layer} />` : null}
    <//>
    ${doc && !myCharId() && !isDm() && !mineIds().length ? html`<div class="banner cta">${t('Tu n\'as pas encore de personnage dans cette campagne.')} <button type="button" class="btn tiny primary" onClick=${() => openModal({ kind: 'newChar' })}>${t('Créer mon personnage')}</button></div>` : null}
    ${doc && ro ? html`<div class="banner ro">${Icon.eye()} ${t('Lecture seule : fiche de {name}', { name: doc.name || '—' })}${doc.player ? ` (${doc.player})` : ''}
      ${ownOther(charId) ? html`<button type="button" class="btn tiny primary" onClick=${() => playChar(charId)}>${t('Jouer cette fiche')}</button>` : null}</div>` : null}
    ${doc && !ro && isDm() && owner ? html`<div class="banner dm-edit">${Icon.pencil()} ${t('Tu modifies la fiche de {name} en tant que MJ.', { name: doc.player || doc.name })}</div>` : null}
    <main>
      ${doc ? html`<${PageFrame} cls=${`pg-${page}`} overlay=${layer ? scale => html`<${DrawLayer} docId=${charId} doc=${doc} layer=${layer} scale=${scale} editable=${!ro} />` : null}>
        <${Guard} resetKey=${`${charId}|${page}`}><${Page} id=${charId} doc=${doc} ro=${ro} /><//>
      <//>` : isDm() ? html`<div class="empty-state"><p class="big">${t('Aucune fiche dans cette campagne.')}</p>
          <p class="muted">${t('Invite tes joueurs : ils créeront leur fiche en arrivant. Tu peux aussi en créer depuis le panneau.')}</p>
          <a class="btn primary" href=${`/c/${cid}/mj`} onClick=${linkClick}>${t('Panneau MJ')}</a></div>`
        : html`<${NoSheetYet} cid=${cid} />`}

    </main>
    <${RollCard} />
    <${RollLog} />
    <${Toasts} />
    <${Guard} resetKey=${store.ui.modal} inline><${ModalHost} /><//>
    <${HomeModals} />
  </div>`;
}

function Waiting({ text }) {
  return html`<div class="join"><div class="join-card"><p>${text}</p>
    <div class="row center"><a class="btn small ghost" href="/" onClick=${linkClick}>${t('Mes campagnes')}</a><button type="button" class="btn small ghost" onClick=${() => logout()}>${t('Se déconnecter')}</button></div>
  </div></div>`;
}

function InviteGate({ code }) {
  const [info, setInfo] = useState(undefined);
  useEffect(() => { api(`/api/invite/${code}`).then(setInfo).catch(() => setInfo(null)); }, [code]);
  if (info === undefined) return html`<${Waiting} text=${t('Chargement…')} />`;
  if (info === null) return html`<div class="join auth"><div class="auth-card"><p class="auth-err">${t('Invitation expirée ou inconnue')}</p><${AuthPage} /></div></div>`;
  return html`<${AuthPage} invite=${code} inviteInfo=${info} />`;
}

function App() {
  useStore();
  const r = store.route;
  if (!store.token) return html`${r.name === 'invite' ? html`<${InviteGate} code=${r.code} />` : html`<${AuthPage} />`}<${Toasts} />`;
  if (!store.account) return html`<${Waiting} text=${store.conn === 'offline' ? t('Serveur injoignable, nouvelle tentative…') : t('Connexion…')} /><${Toasts} />`;
  if (store.account.mustChange) return html`<${FirstSecret} /><${Toasts} />`;
  if (r.name === 'invite') return html`<${InviteAccept} code=${r.code} /><${Toasts} />`;
  if (r.name === 'admin') return html`<${AdminPage} /><${HomeModals} /><${ModalHost} /><${Toasts} />`;
  if (r.name === 'dm') return html`<${DmPage} cid=${r.cid} tab=${r.tab} /><${HomeModals} /><${DmModals} /><${ModalHost} /><${Toasts} />`;
  if (r.name === 'campaign') {
    if (store.denied) return html`<${Waiting} text=${store.denied} /><${Toasts} />`;
    if (!store.ready) return html`<${Waiting} text=${store.conn === 'connecting' ? t('Connexion à la table…') : t('Hors ligne, nouvelle tentative…')} /><${Toasts} />`;
    return html`<${Shell} />`;
  }
  return html`<${HomePage} /><${HomeModals} /><${Toasts} />`;
}

document.documentElement.lang = store.lang;
render(html`<${App} />`, document.getElementById('app'));
resume();

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
