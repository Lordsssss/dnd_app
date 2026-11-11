// Accueil : les campagnes du compte, en créer une, en rejoindre une ; l'en-tête des pages du compte.
import { html, useEffect, useState } from './html.js';
import { api, closeModal, linkClick, logout, navigate, openModal, refreshMe, store, toast } from './store.js';
import { Modal } from './ui.js';
import { Icon } from './icons.js';
import { AccountModal, LangSwitch, RecoveryNotice } from './auth.js';
import { t, tn } from '/shared/i18n.js';

const initials = name => String(name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
export const roleLabel = r => (r === 'dm' ? t('MJ') : r === 'codm' ? t('Co-MJ') : t('Joueur'));

export function AccountButton() {
  const [open, setOpen] = useState(false);
  const a = store.account;
  if (!a) return null;
  return html`<span class="acct-wrap">
    <button type="button" class="acct-btn" title=${t('Mon compte')} onClick=${() => setOpen(true)}>
      <span class="acct-avatar">${initials(a.name)}</span><span class="acct-name">${a.name}</span>
    </button>
    ${open ? html`<div class="menu-back" onClick=${() => setOpen(false)}>
      <div class="menu acct-menu" onClick=${e => e.stopPropagation()}>
        <div class="acct-head"><span class="acct-avatar big">${initials(a.name)}</span><div><b>${a.name}</b><small>${a.login}${a.isAdmin ? ` · ${t('admin')}` : ''}</small></div></div>
        <a class="menu-link" href="/" onClick=${e => { setOpen(false); linkClick(e); }}>${Icon.list()} ${t('Mes campagnes')}</a>
        ${a.isAdmin ? html`<a class="menu-link" href="/admin" onClick=${e => { setOpen(false); linkClick(e); }}>${Icon.key()} ${t('Console admin')}</a>` : null}
        <button type="button" onClick=${() => { setOpen(false); openModal({ kind: 'account' }); }}>${Icon.user()} ${t('Mon compte')}</button>
        <div class="menu-row">${t('Langue')} <${LangSwitch} compact /></div>
        <button type="button" onClick=${() => { setOpen(false); logout(); }}>${Icon.logout()} ${t('Se déconnecter')}</button>
      </div>
    </div>` : null}
  </span>`;
}

// En-tête des pages hors fiche : accueil, panneau du MJ, console admin.
export function AppHeader({ title, back = null, children }) {
  return html`<header class="app-header">
    <a class="app-brand" href="/" onClick=${linkClick}><span class="auth-mark">⚔</span><span>${t('Table D&D')}</span></a>
    ${back ? html`<a class="app-back" href=${back.href} onClick=${linkClick}>← ${back.label}</a>` : null}
    ${title ? html`<h1 class="app-title">${title}</h1>` : null}
    <span class="grow"></span>
    ${children}
    <${AccountButton} />
  </header>`;
}

function CampaignCard({ c }) {
  const dm = c.role === 'dm' || c.role === 'codm';
  return html`<article class="camp-card">
    <a class="camp-main" href=${`/c/${c.id}`} onClick=${linkClick}>
      <div class="camp-top"><h3>${c.name}</h3><span class=${`role-chip ${c.role}`}>${roleLabel(c.role)}</span></div>
      ${c.description ? html`<p class="camp-desc">${c.description}</p>` : null}
      <p class="camp-meta">${tn(c.members, '{n} membre', '{n} membres')} · ${tn(c.chars, '{n} fiche', '{n} fiches')}${c.bridge ? html` · <span title=${t('Reliée à un coffre Obsidian')}>${t('coffre')}</span>` : null}</p>
      ${c.mine.length ? html`<ul class="camp-mine">${c.mine.map(x => html`<li><b>${x.name}</b> <span class="muted">${x.cls || t('sans classe')}</span></li>`)}</ul>`
        : !dm ? html`<p class="camp-mine muted">${t('Pas encore de fiche : crée-la en ouvrant la campagne.')}</p>` : null}
    </a>
    ${dm ? html`<div class="camp-tools">
      <a class="btn small" href=${`/c/${c.id}/carte`} target=${`carte-${c.id}`} rel="noopener">${Icon.map()} ${t('Carte')}</a>
      <a class="btn small" href=${`/c/${c.id}/monde`} target=${`monde-${c.id}`} rel="noopener">${t('Monde')}</a>
      <a class="btn small" href=${`/c/${c.id}/mj`} onClick=${linkClick}>${Icon.scroll()} ${t('Panneau MJ')}</a>
    </div>` : html`<div class="camp-tools"><a class="btn small" href=${`/c/${c.id}/monde`} target=${`monde-${c.id}`} rel="noopener">${t('Carte du monde')}</a></div>`}
  </article>`;
}

export function HomePage() {
  useEffect(() => { refreshMe(); }, []);
  const list = store.campaigns || [];
  const running = list.filter(c => c.role === 'dm' || c.role === 'codm');
  const playing = list.filter(c => c.role === 'player');
  return html`<div class="app-page">
    <${AppHeader} />
    <main class="app-main">
      <div class="page-head">
        <div><h1>${t('Mes campagnes')}</h1><p class="muted">${t('Bonjour {name}.', { name: store.account.name })}</p></div>
        <div class="row">
          <button type="button" class="btn" onClick=${() => openModal({ kind: 'join' })}>${t('Rejoindre avec un lien')}</button>
          ${store.account.canCreate ? html`<button type="button" class="btn primary" onClick=${() => openModal({ kind: 'newCampaign' })}>${Icon.plus()} ${t('Créer une campagne')}</button>` : null}
        </div>
      </div>
      ${!list.length ? html`<div class="empty-state">
        <p class="big">${t('Aucune campagne pour l\'instant.')}</p>
        <p class="muted">${store.account.canCreate ? t('Crée la tienne pour mener une partie, ou ouvre le lien d\'invitation que ton MJ t\'a envoyé.') : t('Ouvre le lien d\'invitation que ton MJ t\'a envoyé. Pour mener ta propre campagne, demande à l\'admin le droit d\'en créer.')}</p>
      </div>` : null}
      ${running.length ? html`<section><h2 class="sec-title">${t('Je mène')}</h2><div class="camp-grid">${running.map(c => html`<${CampaignCard} key=${c.id} c=${c} />`)}</div></section>` : null}
      ${playing.length ? html`<section><h2 class="sec-title">${t('Je joue')}</h2><div class="camp-grid">${playing.map(c => html`<${CampaignCard} key=${c.id} c=${c} />`)}</div></section>` : null}
    </main>
  </div>`;
}

export function NewCampaignModal() {
  const [f, setF] = useState({ name: '', description: '', edition: '2024', currency: 'phb' });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const settings = { edition: f.edition };
      if (f.currency === 'house') settings.currency = [{ key: 'pc', label: 'pc', name: 'cuivre', value: 1 }, { key: 'pa', label: 'pa', name: 'argent', value: 100 }, { key: 'po', label: 'po', name: 'or', value: 10000 }];
      if (f.currency === 'en') settings.currency = [{ key: 'cp', label: 'cp', name: 'copper', value: 1 }, { key: 'sp', label: 'sp', name: 'silver', value: 10 }, { key: 'gp', label: 'gp', name: 'gold', value: 100 }, { key: 'pp', label: 'pp', name: 'platinum', value: 1000 }];
      const r = await api('/api/campaigns', { method: 'POST', body: { name: f.name, description: f.description, settings } });
      closeModal();
      await refreshMe();
      navigate(`/c/${r.id}/mj`);
      toast(t('Campagne créée : invite tes joueurs depuis le panneau MJ'));
    } catch (e) { toast(e.message, { kind: 'error' }); } finally { setBusy(false); }
  };
  const set = k => e => setF({ ...f, [k]: e.target.value });
  return html`<${Modal} title=${t('Créer une campagne')} footer=${html`<span class="grow"></span><button type="button" class="btn primary" disabled=${busy || !f.name.trim()} onClick=${go}>${t('Créer')}</button>`}>
    <div class="form-stack">
      <label class="auth-field">${t('Nom')}<input class="txt" value=${f.name} onInput=${set('name')} placeholder=${t('La campagne de…')} /></label>
      <label class="auth-field">${t('Description')} <small>${t('facultatif')}</small><textarea class="txt" value=${f.description} onInput=${set('description')}></textarea></label>
      <label class="auth-field">${t('Édition')}<select class="sel" value=${f.edition} onChange=${set('edition')}>
        <option value="2024">${t('5e 2024')}</option><option value="2014">${t('5e 2014')}</option></select></label>
      <label class="auth-field">${t('Monnaie')}<select class="sel" value=${f.currency} onChange=${set('currency')}>
        <option value="phb">${t('Player\'s Handbook, en français : 1 po = 10 pa = 100 pc')}</option>
        <option value="en">${t('Player\'s Handbook, en anglais : 1 gp = 10 sp = 100 cp')}</option>
        <option value="house">${t('Taux maison : 1 po = 100 pa')}</option>
      </select></label>
      <p class="muted small">${t('Tout se change ensuite dans le panneau MJ.')}</p>
    </div>
  <//>`;
}

// Rejoindre avec un lien ou un code d'invitation collé.
export function JoinModal() {
  const [v, setV] = useState('');
  const code = (/invite\/([\w-]+)/.exec(v)?.[1]) || v.trim();
  return html`<${Modal} title=${t('Rejoindre une campagne')} footer=${html`<span class="grow"></span><button type="button" class="btn primary" disabled=${!code} onClick=${() => { closeModal(); navigate(`/invite/${code}`); }}>${t('Continuer')}</button>`}>
    <label class="auth-field">${t('Lien ou code d\'invitation')}<input class="txt" value=${v} onInput=${e => setV(e.target.value)} placeholder="https://…/invite/…" /></label>
  <//>`;
}

// Invitation ouverte par une personne déjà connectée.
export function InviteAccept({ code }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api(`/api/invite/${code}`).then(setInfo).catch(e => setErr(e.message)); }, [code]);
  const accept = () => api(`/api/invite/${code}/accept`, { method: 'POST' }).then(async r => { await refreshMe(); navigate(`/c/${r.campaign}`, { replace: true }); }).catch(e => setErr(e.message));
  return html`<div class="app-page">
    <${AppHeader} />
    <main class="app-main narrow">
      <div class="card pad">
        ${err ? html`<p class="auth-err">${err}</p><a class="btn" href="/" onClick=${linkClick}>${t('Mes campagnes')}</a>`
          : !info ? html`<p class="muted">${t('Chargement…')}</p>`
          : html`<h2>${info.campaign.name}</h2>
            ${info.campaign.description ? html`<p class="muted">${info.campaign.description}</p>` : null}
            <p>${info.role === 'codm' ? t('Tu es invité comme co-MJ.') : t('Tu es invité comme joueur.')}</p>
            <div class="row"><button type="button" class="btn primary" onClick=${accept}>${t('Rejoindre la campagne')}</button><a class="btn ghost" href="/" onClick=${linkClick}>${t('Plus tard')}</a></div>`}
      </div>
    </main>
  </div>`;
}

export function HomeModals() {
  const m = store.ui.modal;
  if (!m) return null;
  if (m.kind === 'newCampaign') return html`<${NewCampaignModal} />`;
  if (m.kind === 'join') return html`<${JoinModal} />`;
  if (m.kind === 'account') return html`<${AccountModal} />`;
  if (m.kind === 'recovery') return html`<${Modal} title=${t('Compte prêt')}><${RecoveryNotice} code=${m.code} onClose=${closeModal} /><//>`;
  return null;
}
