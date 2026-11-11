// Console admin : comptes, campagnes vues de l'extérieur, ponts vers un coffre, serveur.
import { html, useEffect, useState } from './html.js';
import { api, openModal, store, toast } from './store.js';
import { Icon } from './icons.js';
import { AppHeader, roleLabel } from './home.js';
import { AuditLog } from './dm.js';
import { t, tn, locale } from '/shared/i18n.js';

const fmtDate = ts => (ts ? new Date(ts).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fmtBytes = n => (n > 1e6 ? `${(n / 1e6).toFixed(1)} Mo` : `${Math.round(n / 1e3)} ko`);
async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, { kind: 'error' }); return null; }
}

function showPin(name, login, pin) {
  openModal({ kind: 'confirm', title: t('Mot de passe temporaire de {name}', { name }), ok: t('Fermer'), text: t('Identifiant : {login} · code temporaire : {pin}. Il ne sera plus affiché ; {name} choisira son mot de passe à la connexion.', { login, pin, name }) });
}

export function AdminPage() {
  const [ov, setOv] = useState(null);
  const [tab, setTab] = useState('accounts');
  const load = () => api('/api/admin/overview').then(setOv).catch(e => toast(e.message, { kind: 'error' }));
  useEffect(() => { load(); }, []);
  if (!store.account?.isAdmin) return html`<div class="app-page"><${AppHeader} /><main class="app-main narrow"><p class="auth-err">${t('Réservé à l\'admin')}</p></main></div>`;
  return html`<div class="app-page">
    <${AppHeader} back=${{ href: '/', label: t('Mes campagnes') }} title=${t('Console admin')} />
    <div class="app-body">
      <nav class="side-tabs">
        ${[['accounts', t('Comptes'), Icon.users], ['campaigns', t('Campagnes'), Icon.list], ['server', t('Serveur'), Icon.gear], ['journal', t('Journal'), Icon.scroll]]
          .map(([k, l, ic]) => html`<button type="button" class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${ic()} <span>${l}</span></button>`)}
      </nav>
      <main class="app-main">
        ${!ov ? html`<p class="muted">${t('Chargement…')}</p>` : html`
          ${tab === 'accounts' ? html`<${Accounts} ov=${ov} load=${load} />` : null}
          ${tab === 'campaigns' ? html`<${Campaigns} ov=${ov} load=${load} />` : null}
          ${tab === 'server' ? html`<${Server} ov=${ov} load=${load} />` : null}
          ${tab === 'journal' ? html`<${AuditLog} url="/api/admin/audit" />` : null}`}
      </main>
    </div>
  </div>`;
}

function Accounts({ ov, load }) {
  const [na, setNa] = useState({ name: '', login: '', canCreate: false });
  const create = () => run(() => api('/api/admin/accounts', { method: 'POST', body: na })).then(r => { if (r) { setNa({ name: '', login: '', canCreate: false }); load(); showPin(r.account.name, r.account.login, r.pin); } });
  const reset = a => openModal({ kind: 'confirm', title: t('Réinitialiser le mot de passe de {name} ?', { name: a.name }), ok: t('Réinitialiser'), text: t('Ses appareils sont déconnectés ; un code temporaire te sera montré une fois.'), onOk: () => run(() => api(`/api/admin/accounts/${a.id}/reset`, { method: 'POST' })).then(r => { if (r) showPin(a.name, r.login, r.pin); }) });
  const toggleAdmin = a => run(() => api(`/api/admin/accounts/${a.id}`, { method: 'POST', body: { isAdmin: !a.isAdmin } })).then(load);
  const toggleCreate = a => run(() => api(`/api/admin/accounts/${a.id}`, { method: 'POST', body: { canCreate: !a.canCreate } }),
    a.canCreate ? t('{name} ne peut plus créer de campagne', { name: a.name }) : t('{name} peut créer des campagnes', { name: a.name })).then(load);
  const remove = a => openModal({ kind: 'confirm', danger: true, title: t('Supprimer le compte de {name} ?', { name: a.name }), ok: t('Supprimer'), text: t('Ses fiches restent dans leurs campagnes, sans joueur.'), onOk: () => run(() => api(`/api/admin/accounts/${a.id}`, { method: 'DELETE' }), t('Compte supprimé')).then(load) });
  const rename = a => { const n = prompt(t('Nom affiché'), a.name); if (n && n.trim()) run(() => api(`/api/admin/accounts/${a.id}`, { method: 'POST', body: { name: n.trim() } })).then(load); };
  return html`
    <section class="card">
      <header class="card-head"><h2>${t('Comptes')}</h2><span class="muted">${tn(ov.accounts.length, '{n} compte', '{n} comptes')}</span></header>
      <table class="tbl">
        <thead><tr><th>${t('Nom')}</th><th>${t('Campagnes')}</th><th>${t('Dernière connexion')}</th><th></th></tr></thead>
        <tbody>${ov.accounts.map(a => html`<tr key=${a.id}>
          <td><b>${a.name}</b>${a.isAdmin ? html` <span class="badge">${t('admin')}</span>` : a.canCreate ? html` <span class="badge" title=${t('Peut créer des campagnes')}>${t('créateur')}</span>` : null}<br /><small class="muted">${a.login} · ${a.mustChange ? t('code temporaire') : a.secretKind === 'pin' ? 'PIN' : t('mot de passe')}</small></td>
          <td>${a.campaigns.length ? a.campaigns.map(c => html`<span class="chip">${c.name} <small>${roleLabel(c.role)}</small></span>`) : html`<span class="muted">—</span>`}</td>
          <td class="small">${fmtDate(a.lastLogin)}</td>
          <td class="right nowrap">
            <button type="button" class="btn tiny" onClick=${() => rename(a)}>${t('Renommer')}</button>
            <button type="button" class="btn tiny" onClick=${() => reset(a)}>${Icon.key()} ${t('Réinitialiser')}</button>
            ${a.isAdmin ? null : html`<button type="button" class="btn tiny" title=${t('Le droit de créer et de mener ses propres campagnes')} onClick=${() => toggleCreate(a)}>${a.canCreate ? t('Retirer la création') : t('Autoriser à créer')}</button>`}
            ${a.id !== store.account.id ? html`<button type="button" class="btn tiny" onClick=${() => toggleAdmin(a)}>${a.isAdmin ? t('Retirer admin') : t('Rendre admin')}</button>
              <button type="button" class="btn tiny danger ghost" onClick=${() => remove(a)}>${Icon.trash()}</button>` : null}
          </td>
        </tr>`)}</tbody>
      </table>
    </section>
    <section class="card">
      <header class="card-head"><h2>${t('Créer un compte')}</h2></header>
      <p class="muted small">${t('D\'habitude, les joueurs s\'inscrivent par le lien d\'invitation de leur MJ. Ici, un compte avec un code temporaire, pour quelqu\'un qui n\'a pas de lien.')}</p>
      <div class="row wrap">
        <input class="txt" placeholder=${t('Nom')} value=${na.name} onInput=${e => setNa({ ...na, name: e.target.value })} />
        <input class="txt" placeholder=${t('Identifiant (facultatif)')} value=${na.login} onInput=${e => setNa({ ...na, login: e.target.value })} />
        <label class="check"><input type="checkbox" checked=${na.canCreate} onChange=${e => setNa({ ...na, canCreate: e.target.checked })} /> ${t('Peut créer des campagnes')}</label>
        <button type="button" class="btn primary" disabled=${!na.name.trim()} onClick=${create}>${t('Créer')}</button>
      </div>
    </section>`;
}

function Campaigns({ ov, load }) {
  const [edit, setEdit] = useState(null);
  const setOwner = (c, accountId) => run(() => api(`/api/admin/campaigns/${c.id}/owner`, { method: 'POST', body: { accountId } }), t('MJ changé')).then(load);
  const remove = c => {
    const name = prompt(t('Écris le nom exact de la campagne pour la supprimer :'));
    if (name != null) run(() => api(`/api/admin/campaigns/${c.id}`, { method: 'DELETE', body: { confirm: name } }), t('Campagne supprimée')).then(load);
  };
  return html`<section class="card">
    <header class="card-head"><h2>${t('Campagnes')}</h2><span class="muted">${tn(ov.campaigns.length, '{n} campagne', '{n} campagnes')}</span></header>
    <p class="muted small">${t('Vue de l\'extérieur : membres, taille, pont vers un coffre. Le contenu d\'une campagne reste réservé à ses membres.')}</p>
    ${ov.campaigns.map(c => {
      const dm = c.members.find(m => m.role === 'dm');
      return html`<article class="admin-camp" key=${c.id}>
        <div class="admin-camp-head">
          <h3>${c.name}</h3><code class="muted small">${c.id}</code>
          <span class="grow"></span>
          <span class="muted small">${tn(c.chars, '{n} fiche', '{n} fiches')} · ${tn(c.scenes, '{n} carte', '{n} cartes')} · ${fmtBytes(c.bytes)}</span>
        </div>
        <p class="small">${c.members.map(m => html`<span class="chip">${m.name} <small>${roleLabel(m.role)}</small></span>`)}</p>
        <div class="row wrap">
          <label class="field-inline">${t('MJ titulaire')}<select class="sel" value=${dm?.accountId || ''} onChange=${e => e.target.value && setOwner(c, e.target.value)}>
            <option value="">—</option>${ov.accounts.map(a => html`<option value=${a.id}>${a.name}</option>`)}</select></label>
          <button type="button" class="btn small" onClick=${() => setEdit(edit === c.id ? null : c.id)}>${Icon.vault()} ${c.bridge ? t('Pont vers un coffre : réglé') : t('Relier à un coffre')}</button>
          <span class="grow"></span>
          <button type="button" class="btn small danger ghost" onClick=${() => remove(c)}>${Icon.trash()} ${t('Supprimer')}</button>
        </div>
        ${edit === c.id ? html`<${BridgeForm} c=${c} onDone=${() => { setEdit(null); load(); }} />` : null}
      </article>`;
    })}
  </section>`;
}

function BridgeForm({ c, onDone }) {
  const b = c.bridge || {};
  const [f, setF] = useState({
    vaultDir: b.vaultDir || '', exportPath: b.exportPath || 'Personnages', sessionsPath: b.sessionsPath || '',
    notesDirs: (b.notesDirs || []).join('\n'), worldNotesRoot: b.worldNotesRoot || '',
    fileNamePattern: b.fileNamePattern || '{name} - Fiche', partyFileName: b.partyFileName || 'Groupe - Fiche commune',
  });
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const save = clear => run(() => api(`/api/admin/campaigns/${c.id}/bridge`, { method: 'POST', body: { bridge: clear ? null : f } }), clear ? t('Pont retiré') : t('Pont enregistré')).then(r => { if (r) onDone(); });
  return html`<div class="bridge-form">
    <p class="muted small">${t('Un coffre Obsidian ne se relie qu\'à une seule campagne : c\'est ce qui empêche le contenu d\'une campagne d\'apparaître dans le coffre d\'une autre. Les dossiers sont relatifs au coffre.')}</p>
    <div class="form-grid2">
      <label class="auth-field span2">${t('Dossier du coffre sur le serveur')}<input class="txt mono" value=${f.vaultDir} onInput=${set('vaultDir')} placeholder="/home/…/Obsidian Vault" /></label>
      <label class="auth-field">${t('Export des fiches')}<input class="txt mono" value=${f.exportPath} onInput=${set('exportPath')} /></label>
      <label class="auth-field">${t('Dossier des sessions')} <small>${t('pour proposer le numéro')}</small><input class="txt mono" value=${f.sessionsPath} onInput=${set('sessionsPath')} /></label>
      <label class="auth-field">${t('Notes des blocs de stats')} <small>${t('un dossier par ligne')}</small><textarea class="txt mono" value=${f.notesDirs} onInput=${set('notesDirs')}></textarea></label>
      <label class="auth-field">${t('Racine des notes de la carte du monde')}<input class="txt mono" value=${f.worldNotesRoot} onInput=${set('worldNotesRoot')} /></label>
      <label class="auth-field">${t('Nom des fichiers de fiche')}<input class="txt mono" value=${f.fileNamePattern} onInput=${set('fileNamePattern')} /></label>
      <label class="auth-field">${t('Nom de la fiche de groupe')}<input class="txt mono" value=${f.partyFileName} onInput=${set('partyFileName')} /></label>
    </div>
    <div class="row">
      ${c.bridge ? html`<button type="button" class="btn danger ghost" onClick=${() => save(true)}>${t('Retirer le pont')}</button>` : null}
      <span class="grow"></span>
      <button type="button" class="btn primary" disabled=${!f.vaultDir.trim()} onClick=${() => save(false)}>${t('Enregistrer')}</button>
    </div>
  </div>`;
}

function Server({ ov, load }) {
  const s = ov.server;
  const [busy, setBusy] = useState('');
  const act = (k, fn, msg) => { setBusy(k); run(fn, msg).finally(() => { setBusy(''); load(); }); };
  const d = s.data5e;
  return html`
    <section class="card">
      <header class="card-head"><h2>${t('Inscriptions')}</h2></header>
      <div class="radio-col">
        ${[['invite', t('Sur invitation'), t('Un compte se crée seulement par le lien d\'invitation d\'une campagne.')], ['open', t('Ouvertes'), t('Toute personne qui a l\'adresse peut créer un compte.')], ['closed', t('Fermées'), t('Seul l\'admin crée des comptes.')]].map(([k, l, help]) => html`<label class="check">
          <input type="radio" name="signup" checked=${ov.signup === k} onChange=${() => act('signup', () => api('/api/admin/settings', { method: 'POST', body: { signup: k } }), t('Enregistré'))} />
          <span><b>${l}</b><br /><small class="muted">${help}</small></span></label>`)}
      </div>
    </section>
    <section class="card">
      <header class="card-head"><h2>${t('Données 5etools')}</h2></header>
      <p>${d.error ? html`<span class="warn">${d.error}</span>` : t('{s} sorts, {i} objets, {m} créatures, {b} livres et aventures', { s: d.spells, i: d.items, m: d.monsters, b: d.books })}</p>
      <div class="row">
        <button type="button" class="btn" disabled=${!!busy || s.fetching5e} onClick=${() => act('5e', () => api('/api/admin/fetch5e', { method: 'POST' }), t('Données à jour'))}>${busy === '5e' ? t('Téléchargement…') : t('Mettre à jour')}</button>
        <button type="button" class="btn ghost" disabled=${!!busy} onClick=${() => act('r5e', () => api('/api/admin/reload5e', { method: 'POST' }), t('Rechargé'))}>${t('Recharger')}</button>
      </div>
    </section>
    <section class="card">
      <header class="card-head"><h2>${t('Bibliothèque de tokens')}</h2></header>
      <p>${s.library ? html`<code>${s.library}</code> · ${tn(s.libraryCount, '{n} image', '{n} images')}` : html`<span class="muted">${t('Aucune : réglez libraryDir dans la configuration du serveur.')}</span>`}</p>
      <button type="button" class="btn small" disabled=${!s.library} onClick=${() => act('lib', () => api('/api/admin/library/reload', { method: 'POST' }), t('Bibliothèque relue'))}>${t('Relire le dossier')}</button>
    </section>
    <section class="card">
      <header class="card-head"><h2>${t('Sauvegardes')}</h2></header>
      <p class="muted small">${t('La base est copiée chaque jour dans {dir}. Les images et les mondes sont dans {data}/files : la sauvegarde hors du serveur doit copier les deux.', { dir: s.backupDir, data: s.dataDir })}</p>
      <p>${t('Dernière')} : <code>${s.lastBackup || '—'}</code></p>
      <button type="button" class="btn small" disabled=${!!busy} onClick=${() => act('bk', () => api('/api/admin/backup', { method: 'POST' }), t('Sauvegarde faite'))}>${t('Sauvegarder maintenant')}</button>
    </section>
    <section class="card">
      <header class="card-head"><h2>${t('Serveur')}</h2></header>
      <p class="small">${t('Adresse publique')} : <code>${s.publicUrl || '—'}</code> · Node ${s.node} · ${t('en marche depuis {h} h', { h: Math.round(s.uptime / 360) / 10 })}</p>
    </section>`;
}
