// Panneau du MJ d'une campagne : membres et invitations, fiches, images, bestiaire, réglages,
// coffre Obsidian (si l'admin a relié la campagne), jetons d'API, journal.
import { html, useEffect, useMemo, useRef, useState } from './html.js';
import { api, closeModal, fileUrl, linkClick, navigate, openModal, refreshMe, store, toast, uploadAsset } from './store.js';
import { Modal } from './ui.js';
import { Icon } from './icons.js';
import { AppHeader, roleLabel } from './home.js';
import { CharacterCreator } from './creator.js';
import { SheetTemplateButtons, importSheetFile } from './sheet-json.js';
import { renderNote } from '/shared/map/markdown.js';
import { BEAST_TEMPLATE } from '/shared/bestiary.js';
import { t, tn, locale } from '/shared/i18n.js';

const fmtDate = ts => (ts ? new Date(ts).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const fmtBytes = n => (n > 1e6 ? `${(n / 1e6).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1e3))} ko`);
const copy = (text, msg = t('Copié')) => navigator.clipboard?.writeText(text).then(() => toast(msg), () => toast(text));

function useLoad(fn, deps) {
  const [state, setState] = useState({ loading: true, value: null, error: null });
  const reload = () => fn().then(value => setState({ loading: false, value, error: null })).catch(error => setState({ loading: false, value: null, error }));
  useEffect(() => { reload(); }, deps);
  return [state, reload];
}

async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, { kind: 'error' }); return null; }
}

const TABS = [
  ['members', () => t('Membres'), Icon.users],
  ['sheets', () => t('Fiches'), Icon.list],
  ['images', () => t('Images'), Icon.image],
  ['bestiary', () => t('Bestiaire'), Icon.book],
  ['settings', () => t('Réglages'), Icon.gear],
  ['vault', () => t('Coffre'), Icon.vault],
  ['api', () => t('API'), Icon.key],
  ['journal', () => t('Journal'), Icon.scroll],
];

export function DmPage({ cid, tab }) {
  const [ov, reload] = useLoad(() => api(`/api/c/${cid}/overview`), [cid]);
  if (ov.error) {
    return html`<div class="app-page"><${AppHeader} back=${{ href: '/', label: t('Mes campagnes') }} />
      <main class="app-main narrow"><div class="card pad"><p class="auth-err">${ov.error.message}</p><a class="btn" href="/" onClick=${linkClick}>${t('Mes campagnes')}</a></div></main></div>`;
  }
  const o = ov.value;
  const tabs = TABS.filter(([k]) => k !== 'vault' || o?.bridge);
  return html`<div class="app-page">
    <${AppHeader} back=${{ href: `/c/${cid}`, label: t('Fiches') }} title=${o?.campaign.name || '…'}>
      <a class="btn small ghost" href=${`/c/${cid}/carte`} target=${`carte-${cid}`} rel="noopener">${Icon.map()} ${t('Carte')}</a>
      <a class="btn small ghost" href=${`/c/${cid}/monde`} target=${`monde-${cid}`} rel="noopener">${Icon.globe()} ${t('Monde')}</a>
    <//>
    <div class="app-body">
      <nav class="side-tabs">
        ${tabs.map(([k, label, icon]) => html`<a key=${k} class=${tab === k ? 'on' : ''} href=${`/c/${cid}/mj/${k}`} onClick=${linkClick}>${icon()} <span>${label()}</span></a>`)}
      </nav>
      <main class="app-main">
        ${!o ? html`<p class="muted">${t('Chargement…')}</p>` : html`
          ${tab === 'members' ? html`<${Members} cid=${cid} o=${o} reload=${reload} />` : null}
          ${tab === 'sheets' ? html`<${Sheets} cid=${cid} o=${o} reload=${reload} />` : null}
          ${tab === 'images' ? html`<${Images} cid=${cid} o=${o} />` : null}
          ${tab === 'bestiary' ? html`<${Bestiary} cid=${cid} o=${o} />` : null}
          ${tab === 'settings' ? html`<${Settings} cid=${cid} o=${o} reload=${reload} />` : null}
          ${tab === 'vault' && o.bridge ? html`<${Vault} cid=${cid} o=${o} reload=${reload} />` : null}
          ${tab === 'api' ? html`<${ApiTokens} cid=${cid} o=${o} reload=${reload} />` : null}
          ${tab === 'journal' ? html`<${AuditLog} url=${`/api/c/${cid}/audit`} />` : null}`}
      </main>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- Membres et invitations

function Members({ cid, o, reload }) {
  const owner = o.role === 'dm';
  const [inv, setInv] = useState({ role: 'player', uses: '', days: 14 });
  const setRole = (m, role) => run(() => api(`/api/c/${cid}/members/${m.accountId}`, { method: 'POST', body: { role } }), t('Rôle changé')).then(reload);
  const remove = m => openModal({
    kind: 'confirm', danger: true, title: t('Retirer {name} ?', { name: m.name }), ok: t('Retirer'),
    text: t('Ses fiches restent dans la campagne, sans joueur : tu pourras les redonner ou les supprimer.'),
    onOk: () => run(() => api(`/api/c/${cid}/members/${m.accountId}`, { method: 'DELETE' }), t('Membre retiré')).then(reload),
  });
  const create = () => run(() => api(`/api/c/${cid}/invites`, { method: 'POST', body: { role: inv.role, uses: inv.uses || null, days: Number(inv.days) || null } })).then(r => { if (r) { copy(r.url, t('Lien copié : envoie-le à tes joueurs')); reload(); } });
  const drop = i => run(() => api(`/api/c/${cid}/invites/${i.code}`, { method: 'DELETE' })).then(reload);
  const live = o.invites.filter(i => !i.expired);
  return html`
    <section class="card">
      <header class="card-head"><h2>${t('Membres')}</h2><span class="muted">${tn(o.members.length, '{n} membre', '{n} membres')}</span></header>
      <table class="tbl">
        <thead><tr><th>${t('Nom')}</th><th>${t('Rôle')}</th><th>${t('Fiches')}</th><th>${t('En ligne')}</th><th></th></tr></thead>
        <tbody>${o.members.map(m => html`<tr key=${m.accountId}>
          <td><b>${m.name}</b><br /><small class="muted">${m.login}</small></td>
          <td>${owner || m.role === 'player' ? html`<select class="sel" value=${m.role} onChange=${e => setRole(m, e.target.value)} disabled=${!owner && m.role !== 'player'}>
              <option value="player">${t('Joueur')}</option>
              ${owner ? html`<option value="codm">${t('Co-MJ')}</option><option value="dm">${t('MJ titulaire')}</option>` : null}
            </select>` : html`<span class=${`role-chip ${m.role}`}>${roleLabel(m.role)}</span>`}</td>
          <td>${m.chars.join(', ') || html`<span class="muted">—</span>`}</td>
          <td>${m.online ? html`<span class="dot-on"></span> ${m.online}` : html`<span class="muted">—</span>`}</td>
          <td class="right">${m.role !== 'dm' && (owner || m.role === 'player') ? html`<button type="button" class="btn tiny danger ghost" onClick=${() => remove(m)}>${t('Retirer')}</button>` : null}</td>
        </tr>`)}</tbody>
      </table>
      ${owner ? html`<p class="muted small">${t('Donner le rôle de MJ titulaire fait de toi un co-MJ. Un co-MJ voit et modifie tout, sauf les rôles et la suppression de la campagne.')}</p>` : null}
    </section>
    <section class="card">
      <header class="card-head"><h2>${t('Inviter')}</h2></header>
      <p class="muted">${t('Un lien d\'invitation fait entrer dans la campagne : la personne crée son compte ou se connecte, puis arrive ici.')}</p>
      <div class="row wrap">
        <label class="field-inline">${t('Rôle')}<select class="sel" value=${inv.role} onChange=${e => setInv({ ...inv, role: e.target.value })}>
          <option value="player">${t('Joueur')}</option>${owner ? html`<option value="codm">${t('Co-MJ')}</option>` : null}</select></label>
        <label class="field-inline">${t('Utilisations')}<input class="txt small-num" inputMode="numeric" placeholder=${t('illimité')} value=${inv.uses} onInput=${e => setInv({ ...inv, uses: e.target.value.replace(/\D/g, '') })} /></label>
        <label class="field-inline">${t('Valable (jours)')}<input class="txt small-num" inputMode="numeric" value=${inv.days} onInput=${e => setInv({ ...inv, days: e.target.value.replace(/\D/g, '') })} /></label>
        <button type="button" class="btn primary" onClick=${create}>${Icon.link()} ${t('Créer un lien')}</button>
      </div>
      ${live.length ? html`<ul class="invite-list">${live.map(i => html`<li key=${i.code}>
        <span class=${`role-chip ${i.role}`}>${roleLabel(i.role)}</span>
        <code class="grow ellipsis">${i.url}</code>
        <span class="muted small">${i.usesLeft == null ? t('illimité') : tn(i.usesLeft, '{n} utilisation', '{n} utilisations')} · ${i.expiresAt ? t('jusqu\'au {date}', { date: new Date(i.expiresAt).toLocaleDateString(locale()) }) : t('sans fin')}</span>
        <button type="button" class="btn tiny" onClick=${() => copy(i.url, t('Lien copié'))}>${Icon.copy()} ${t('Copier')}</button>
        <button type="button" class="btn tiny" onClick=${() => openModal({ kind: 'qr', url: i.url })}>QR</button>
        <button type="button" class="btn tiny danger ghost" onClick=${() => drop(i)}>${Icon.trash()}</button>
      </li>`)}</ul>` : null}
    </section>`;
}

export function QrModal({ url }) {
  const path = new URL(url).pathname;
  return html`<${Modal} title=${t('Rejoindre la campagne')}>
    <div class="qr-box"><img src=${`/api/qr.svg?path=${encodeURIComponent(path)}`} alt="QR" width="240" height="240" /></div>
    <p class="center"><code>${url}</code></p>
  <//>`;
}

// ---------------------------------------------------------------- Fiches

function Sheets({ cid, o, reload }) {
  const [creating, setCreating] = useState(false);
  const fileRef = useRef(null);
  const setOwner = (c, owner) => run(() => api(`/api/c/${cid}/characters/${c.id}/owner`, { method: 'POST', body: { owner } }), owner ? t('Fiche attribuée') : t('Fiche retirée du joueur')).then(reload);
  const remove = c => openModal({
    kind: 'confirm', danger: true, title: t('Supprimer {name} ?', { name: c.name }), ok: t('Supprimer définitivement'),
    text: t('La fiche disparaît de la campagne. Exporte-la en JSON avant si tu veux la garder ; les sauvegardes quotidiennes la contiennent encore.'),
    onOk: () => run(() => api(`/api/c/${cid}/characters/${c.id}`, { method: 'DELETE' }), t('Fiche supprimée')).then(reload),
  });
  const download = async c => {
    const res = await fetch(`/api/c/${cid}/characters/${c.id}/json`, { headers: { Authorization: `Bearer ${store.token}` } });
    if (!res.ok) return toast(t('Export impossible'), { kind: 'error' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = `${c.name.replace(/[^\w\- ]+/g, '') || 'personnage'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return undefined;
  };
  // Vérifiée avant import ; elle arrive sans joueur, à attribuer ensuite dans la liste.
  const importJson = e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    importSheetFile(f, {
      currency: o.campaign.settings?.currency, title: t('Importer une fiche'), okLabel: t('Importer'),
      onImport: data => run(() => api(`/api/c/${cid}/characters`, { method: 'POST', body: { data, owner: null } }), t('Fiche importée')).then(reload),
    });
  };
  const players = o.members;
  return html`<section class="card">
    <header class="card-head"><h2>${t('Fiches de la campagne')}</h2>
      <div class="row">
        <${SheetTemplateButtons} small currency=${o.campaign.settings?.currency} edition=${o.campaign.settings?.edition} />
        <button type="button" class="btn small" onClick=${() => fileRef.current?.click()}>${Icon.upload()} ${t('Importer un JSON')}</button>
        <button type="button" class="btn small primary" onClick=${() => setCreating(true)}>${Icon.plus()} ${t('Nouvelle fiche')}</button>
        <input type="file" accept="application/json,.json" ref=${fileRef} hidden onChange=${importJson} />
      </div>
    </header>
    ${o.chars.length ? html`<table class="tbl">
      <thead><tr><th>${t('Personnage')}</th><th>${t('Classe')}</th><th>${t('Joué par')}</th><th></th></tr></thead>
      <tbody>${o.chars.map(c => html`<tr key=${c.id}>
        <td><a href=${`/c/${cid}`} onClick=${e => { store.view.charId = c.id; linkClick(e); }}><b>${c.name}</b></a></td>
        <td>${c.cls || html`<span class="muted">—</span>`}${c.level ? html` <span class="muted">· ${t('niv.')} ${c.level}</span>` : null}</td>
        <td><select class="sel" value=${c.owner?.id || ''} onChange=${e => setOwner(c, e.target.value || null)}>
          <option value="">${t('Personne (PNJ du MJ)')}</option>
          ${players.map(p => html`<option value=${p.accountId}>${p.name}</option>`)}
        </select></td>
        <td class="right nowrap">
          <button type="button" class="btn tiny" title=${t('Exporter en JSON')} onClick=${() => download(c)}>${Icon.download()}</button>
          <button type="button" class="btn tiny danger ghost" onClick=${() => remove(c)}>${Icon.trash()}</button>
        </td>
      </tr>`)}</tbody>
    </table>` : html`<p class="muted">${t('Aucune fiche. Tes joueurs créent la leur en ouvrant la campagne ; tu peux aussi en créer ici.')}</p>`}
    ${creating ? html`<${CharacterCreator} cid=${cid} members=${players} dm onClose=${() => setCreating(false)} onDone=${() => { setCreating(false); reload(); }} />` : null}
  </section>`;
}

// ---------------------------------------------------------------- Images

const KINDS = () => [['map', t('Cartes')], ['token', t('Tokens')], ['portrait', t('Portraits')], ['image', t('Autres')]];

function Images({ cid, o }) {
  const [kind, setKind] = useState('map');
  const [list, reload] = useLoad(() => api(`/api/c/${cid}/assets?kind=${kind}`), [cid, kind]);
  const [busy, setBusy] = useState(0);
  // Dossier ouvert : « * » montre tout ; un envoi va dans le dossier ouvert.
  const [folder, setFolder] = useState('*');
  const [made, setMade] = useState([]);
  useEffect(() => { setFolder('*'); setMade([]); }, [kind]);
  const fileRef = useRef(null);
  const target = folder === '*' ? '' : folder;
  const upload = async files => {
    setBusy(files.length);
    for (const f of files) {
      try { await uploadAsset(cid, f, kind, target); } catch (e) { toast(`${f.name} : ${e.message}`, { kind: 'error' }); }
      setBusy(n => n - 1);
    }
    reload();
  };
  const move = (a, f) => run(() => api(`/api/c/${cid}/assets/${a.id}`, { method: 'PATCH', body: { folder: f } })).then(reload);
  const newFolder = () => {
    const n = String(prompt(t('Nom du nouveau dossier : Donjon 2, Gobelins, Ville…')) || '').replace(/[\\/]+/g, '-').trim();
    if (n) { setMade([...made, n]); setFolder(n); }
  };
  const folders = [...new Set([...made, ...(list.value || []).map(a => a.folder).filter(Boolean)])].sort((a, b) => a.localeCompare(b, locale(), { numeric: true }));
  const shown = (list.value || []).filter(a => folder === '*' || (a.folder || '') === folder);
  const rename = a => { const n = prompt(t('Nouveau nom'), a.name); if (n && n.trim()) run(() => api(`/api/c/${cid}/assets/${a.id}`, { method: 'PATCH', body: { name: n.trim() } })).then(reload); };
  const remove = a => openModal({ kind: 'confirm', danger: true, title: t('Supprimer {name} ?', { name: a.name }), ok: t('Supprimer'), text: t('Une carte ou un token qui utilise cette image n\'aura plus d\'image.'), onOk: () => run(() => api(`/api/c/${cid}/assets/${a.id}`, { method: 'DELETE' })).then(reload) });
  return html`<section class="card"
    onDragOver=${e => e.preventDefault()} onDrop=${e => { e.preventDefault(); upload([...e.dataTransfer.files]); }}>
    <header class="card-head"><h2>${t('Images de la campagne')}</h2>
      <span class="muted small">${fmtBytes(o.storage.bytes)} / ${fmtBytes(o.storage.quota)}</span>
    </header>
    <div class="row wrap">
      <div class="tabs small">${KINDS().map(([k, l]) => html`<button type="button" class=${kind === k ? 'on' : ''} onClick=${() => setKind(k)}>${l}</button>`)}</div>
      <span class="grow"></span>
      <select class="sel" aria-label=${t('Dossier')} value=${folder} onChange=${e => setFolder(e.target.value)}>
        <option value="*">${t('Tous les dossiers')}</option>
        ${folders.map(f => html`<option value=${f}>${f}</option>`)}
        <option value="">${t('Sans dossier')}</option>
      </select>
      <button type="button" class="btn small" onClick=${newFolder}>${Icon.plus()} ${t('Dossier')}</button>
      <button type="button" class="btn primary small" disabled=${busy > 0} onClick=${() => fileRef.current?.click()}>${Icon.upload()} ${busy ? t('Envoi… {n}', { n: busy }) : folder === '*' || folder === '' ? t('Envoyer des images') : t('Envoyer dans {folder}', { folder })}</button>
      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden ref=${fileRef} onChange=${e => { upload([...e.target.files]); e.target.value = ''; }} />
    </div>
    <p class="muted small">${kind === 'token' ? t('Le nom du fichier sert à retrouver le token : « Gobelin_Small.png » sera proposé pour un Gobelin, en petite taille.') : t('Glisse des fichiers ici, ou utilise le bouton. PNG, JPEG, WebP ou GIF, 25 Mo au plus.')}</p>
    ${list.loading ? html`<p class="muted">${t('Chargement…')}</p>` : shown.length ? html`<div class="asset-grid">${shown.map(a => html`<figure key=${a.id} class="asset">
      <img src=${fileUrl(a.ref)} alt="" loading="lazy" />
      <figcaption><b title=${a.name}>${a.name}</b><small class="muted">${a.width ? `${a.width} × ${a.height} px · ` : ''}${fmtBytes(a.size)}</small></figcaption>
      <div class="asset-tools">
        <select class="sel tiny" aria-label=${t('Dossier')} value=${a.folder || ''} onChange=${e => move(a, e.target.value)}>
          <option value="">${t('Sans dossier')}</option>
          ${folders.map(f => html`<option value=${f}>${f}</option>`)}
        </select>
        <button type="button" class="btn tiny" onClick=${() => rename(a)}>${t('Renommer')}</button>
        <button type="button" class="btn tiny" title=${t('Copier la référence')} onClick=${() => copy(a.ref)}>${Icon.copy()}</button>
        <button type="button" class="btn tiny danger ghost" onClick=${() => remove(a)}>${Icon.trash()}</button>
      </div>
    </figure>`)}</div>` : html`<p class="muted">${list.value?.length ? t('Rien dans ce dossier.') : t('Aucune image de ce type.')}</p>`}
  </section>`;
}

// ---------------------------------------------------------------- Bestiaire

function Bestiary({ cid, o }) {
  const [list, reload] = useLoad(() => api(`/api/c/${cid}/bestiary`), [cid]);
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return undefined; }
    const tm = setTimeout(() => api(`/api/5e/search?kind=monster&q=${encodeURIComponent(q)}`).then(r => setFound((r || []).slice(0, 12).map(m => ({ name: m.n, source: m.s, extra: m.x })))).catch(() => {}), 250);
    return () => clearTimeout(tm);
  }, [q]);
  const from5e = m => run(() => api(`/api/c/${cid}/bestiary/from5e`, { method: 'POST', body: { name: m.name, source: m.source } }), t('Copiée dans le bestiaire')).then(r => { if (r) { setQ(''); reload(); setEdit(r); } });
  const sync = () => run(() => api(`/api/c/${cid}/bestiary/sync`, { method: 'POST' })).then(r => { if (r) { toast(t('{a} ajoutée(s), {u} mise(s) à jour', { a: r.added, u: r.updated })); reload(); } });
  const blank = () => setEdit({ name: '', kind: 'markdown', body: BEAST_TEMPLATE, size: 1 });
  if (edit) return html`<${BeastEditor} cid=${cid} beast=${edit} onClose=${() => { setEdit(null); reload(); }} />`;
  return html`<section class="card">
    <header class="card-head"><h2>${t('Bestiaire')}</h2>
      <div class="row">
        ${o.bridge?.notes ? html`<button type="button" class="btn small" onClick=${sync}>${Icon.vault()} ${t('Synchroniser depuis le coffre')}</button>` : null}
        <button type="button" class="btn small primary" onClick=${blank}>${Icon.plus()} ${t('Nouvelle créature')}</button>
      </div>
    </header>
    <p class="muted small">${t('Les créatures et PNJ de ta campagne. La carte les propose quand tu ajoutes un token, et affiche leur bloc au survol, sur ton écran seulement.')}</p>
    <div class="search-5e">
      <input class="txt" placeholder=${t('Copier une créature de 5etools : tape son nom…')} value=${q} onInput=${e => setQ(e.target.value)} />
      ${found.length ? html`<ul class="pick-list">${found.map(m => html`<li><button type="button" onClick=${() => from5e(m)}><b>${m.name}</b> <span class="muted">${m.source}${m.extra ? ` · ${m.extra}` : ''}</span></button></li>`)}</ul>` : null}
    </div>
    ${list.value?.length ? html`<table class="tbl">
      <thead><tr><th>${t('Nom')}</th><th>CA</th><th>PV</th><th>Init.</th><th>${t('Origine')}</th><th></th></tr></thead>
      <tbody>${list.value.map(b => html`<tr key=${b.id}>
        <td><button type="button" class="link" onClick=${() => setEdit(b)}><b>${b.name}</b></button></td>
        <td>${b.ac ?? '—'}</td><td>${b.hp ?? '—'}</td><td>${b.init != null ? (b.init >= 0 ? `+${b.init}` : b.init) : '—'}</td>
        <td class="muted small">${b.origin?.file ? b.origin.file.split('/').pop().replace(/\.md$/, '') : b.ref?.source ? `5etools · ${b.ref.source}` : t('maison')}</td>
        <td class="right"><button type="button" class="btn tiny" onClick=${() => setEdit(b)}>${Icon.pencil()}</button></td>
      </tr>`)}</tbody>
    </table>` : list.loading ? null : html`<p class="muted">${t('Aucune créature pour l\'instant.')}</p>`}
  </section>`;
}

function BeastEditor({ cid, beast, onClose }) {
  const [b, setB] = useState({ ...beast });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setB(x => ({ ...x, [k]: v }));
  const numOrNull = v => (v === '' ? null : Number(v));
  const save = async () => {
    setBusy(true);
    const body = { name: b.name, kind: 'markdown', body: b.body, size: b.size, init: b.init, ac: b.ac, hp: b.hp, image: b.image, notes: b.notes, tags: b.tags, origin: b.origin, ref: b.ref };
    const r = await run(() => (b.id ? api(`/api/c/${cid}/bestiary/${b.id}`, { method: 'PUT', body }) : api(`/api/c/${cid}/bestiary`, { method: 'POST', body })), t('Enregistré'));
    setBusy(false);
    if (r) onClose();
  };
  const remove = () => openModal({ kind: 'confirm', danger: true, title: t('Supprimer {name} ?', { name: b.name }), ok: t('Supprimer'), text: t('Les tokens liés à cette créature n\'afficheront plus son bloc.'), onOk: () => run(() => api(`/api/c/${cid}/bestiary/${b.id}`, { method: 'DELETE' })).then(onClose) });
  const preview = useMemo(() => renderNote(String(b.body || '').split('\n')), [b.body]);
  return html`<section class="card">
    <header class="card-head"><h2>${b.id ? b.name || t('Créature') : t('Nouvelle créature')}</h2>
      <div class="row">
        ${b.id ? html`<button type="button" class="btn small danger ghost" onClick=${remove}>${Icon.trash()} ${t('Supprimer')}</button>` : null}
        <button type="button" class="btn small" onClick=${onClose}>${t('Annuler')}</button>
        <button type="button" class="btn small primary" disabled=${busy || !b.name.trim()} onClick=${save}>${t('Enregistrer')}</button>
      </div>
    </header>
    ${b.origin?.file ? html`<p class="alert small">${Icon.vault()} ${t('Importée du coffre ({file}) : une nouvelle synchronisation remplacera le bloc.', { file: b.origin.file.split('/').pop() })}</p>` : null}
    <div class="beast-grid">
      <label class="auth-field">${t('Nom')}<input class="txt" value=${b.name} onInput=${e => set('name', e.target.value)} /></label>
      <label class="auth-field">CA<input class="txt" inputMode="numeric" value=${b.ac ?? ''} onInput=${e => set('ac', numOrNull(e.target.value))} /></label>
      <label class="auth-field">PV<input class="txt" inputMode="numeric" value=${b.hp ?? ''} onInput=${e => set('hp', numOrNull(e.target.value))} /></label>
      <label class="auth-field">${t('Initiative')}<input class="txt" inputMode="numeric" value=${b.init ?? ''} onInput=${e => set('init', numOrNull(e.target.value))} /></label>
      <label class="auth-field">${t('Taille en cases')}<select class="sel" value=${b.size || 1} onChange=${e => set('size', Number(e.target.value))}>${[1, 2, 3, 4].map(n => html`<option value=${n}>${n} × ${n}</option>`)}</select></label>
    </div>
    <div class="beast-split">
      <label class="auth-field">${t('Bloc de statistiques')} <small>${t('Markdown : **gras**, *italique*, ### titres, tableaux')}</small>
        <textarea class="txt mono beast-body" value=${b.body} onInput=${e => set('body', e.target.value)}></textarea></label>
      <div class="beast-preview"><div class="info-card-in note-block" dangerouslySetInnerHTML=${{ __html: preview }}></div></div>
    </div>
    <label class="auth-field">${t('Notes du MJ')} <small>${t('tactique, butin, rappel')}</small><textarea class="txt" value=${b.notes || ''} onInput=${e => set('notes', e.target.value)}></textarea></label>
  </section>`;
}

// ---------------------------------------------------------------- Réglages

function Settings({ cid, o, reload }) {
  const c = o.campaign;
  const s = c.settings;
  const [f, setF] = useState({ name: c.name, description: c.description, edition: s.edition, coinWeight: s.coinWeight !== false, longRest: s.rules?.longRestHitDice || 'all', secretDeathSaves: !!s.secretDeathSaves, sessionNumber: s.sessionNumber ?? '' });
  const [cur, setCur] = useState(s.currency.map(d => ({ ...d })));
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const save = () => run(() => api(`/api/c/${cid}`, {
    method: 'PATCH',
    body: { name: f.name, description: f.description, settings: { edition: f.edition, coinWeight: f.coinWeight, rules: { longRestHitDice: f.longRest }, secretDeathSaves: f.secretDeathSaves, sessionNumber: f.sessionNumber, currency: cur } },
  }), t('Réglages enregistrés')).then(() => { reload(); refreshMe(); });
  const del = () => {
    const name = prompt(t('Écris le nom exact de la campagne pour la supprimer, avec toutes ses fiches, cartes et images :'));
    if (name == null) return;
    run(() => api(`/api/c/${cid}`, { method: 'DELETE', body: { confirm: name } }), t('Campagne supprimée')).then(r => { if (r) { refreshMe(); navigate('/'); } });
  };
  const leave = () => openModal({ kind: 'confirm', danger: true, title: t('Quitter la campagne ?'), ok: t('Quitter'), text: t('Tu perds l\'accès au panneau et aux fiches. Le MJ peut te réinviter.'), onOk: () => run(() => api(`/api/c/${cid}/leave`, { method: 'POST' })).then(r => { if (r) { refreshMe(); navigate('/'); } }) });
  return html`
    <section class="card">
      <header class="card-head"><h2>${t('Campagne')}</h2><button type="button" class="btn small primary" onClick=${save}>${t('Enregistrer')}</button></header>
      <div class="form-grid2">
        <label class="auth-field">${t('Nom')}<input class="txt" value=${f.name} onInput=${e => set('name', e.target.value)} /></label>
        <label class="auth-field">${t('Édition')}<select class="sel" value=${f.edition} onChange=${e => set('edition', e.target.value)}><option value="2024">5e 2024</option><option value="2014">5e 2014</option></select></label>
        <label class="auth-field span2">${t('Description')}<textarea class="txt" value=${f.description} onInput=${e => set('description', e.target.value)}></textarea></label>
        <label class="auth-field">${t('Repos long : dés de vie récupérés')}<select class="sel" value=${f.longRest} onChange=${e => set('longRest', e.target.value)}>
          <option value="all">${t('Tous (règle 2024)')}</option><option value="half">${t('La moitié (règle 2014)')}</option></select></label>
        <label class="auth-field">${t('Numéro de la prochaine session')}<input class="txt" inputMode="numeric" value=${f.sessionNumber} onInput=${e => set('sessionNumber', e.target.value.replace(/\D/g, ''))} /></label>
        <label class="check span2"><input type="checkbox" checked=${f.secretDeathSaves} onChange=${e => set('secretDeathSaves', e.target.checked)} /> <span><b>${t('Jets de mort secrets')}</b><br /><small class="muted">${t('Le serveur lance le dé ; seul le MJ voit le résultat et le décompte des succès et des échecs.')}</small></span></label>
        <label class="check span2"><input type="checkbox" checked=${f.coinWeight} onChange=${e => set('coinWeight', e.target.checked)} /> ${t('Les pièces comptent dans le poids porté (50 pièces = 1 lb)')}</label>
      </div>
    </section>
    <section class="card">
      <header class="card-head"><h2>${t('Monnaie')}</h2></header>
      <p class="muted small">${t('La valeur de chaque pièce en unités de base : la plus petite vaut 1. Rendre la monnaie et partager le fonds suivent ces taux.')}</p>
      <table class="tbl compact">
        <thead><tr><th>${t('Abréviation')}</th><th>${t('Nom')}</th><th>${t('Valeur')}</th><th></th></tr></thead>
        <tbody>${cur.map((d, i) => html`<tr key=${i}>
          <td><input class="txt small-num" value=${d.label} onInput=${e => setCur(cur.map((x, j) => (j === i ? { ...x, label: e.target.value, key: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '') } : x)))} /></td>
          <td><input class="txt" value=${d.name} onInput=${e => setCur(cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></td>
          <td><input class="txt small-num" inputMode="numeric" value=${d.value} onInput=${e => setCur(cur.map((x, j) => (j === i ? { ...x, value: Number(e.target.value.replace(/\D/g, '')) || 0 } : x)))} /></td>
          <td class="right"><button type="button" class="btn tiny danger ghost" disabled=${cur.length <= 1} onClick=${() => setCur(cur.filter((_, j) => j !== i))}>${Icon.trash()}</button></td>
        </tr>`)}</tbody>
      </table>
      <button type="button" class="btn small" disabled=${cur.length >= 8} onClick=${() => setCur([...cur, { key: '', label: '', name: '', value: 1 }])}>${Icon.plus()} ${t('Pièce')}</button>
    </section>
    <section class="card danger-zone">
      <header class="card-head"><h2>${t('Zone sensible')}</h2></header>
      ${o.role === 'dm' ? html`<p class="muted small">${t('Supprimer la campagne efface ses fiches, cartes, images et son monde. Les sauvegardes quotidiennes du serveur les gardent 30 jours.')}</p>
        <button type="button" class="btn danger" onClick=${del}>${Icon.trash()} ${t('Supprimer la campagne')}</button>`
        : html`<button type="button" class="btn danger ghost" onClick=${leave}>${t('Quitter la campagne')}</button>`}
    </section>`;
}

// ---------------------------------------------------------------- Coffre Obsidian

function Vault({ cid, o, reload }) {
  const [session, setSession] = useState(o.campaign.settings.sessionNumber ?? o.bridge.suggestedSession ?? '');
  const [result, setResult] = useState(null);
  const exportAll = charId => run(() => api(`/api/c/${cid}/export`, { method: 'POST', body: { charId, session: session === '' ? null : Number(session) } })).then(r => { if (r) { setResult(r); toast(tn(r.files.length, '{n} fichier écrit', '{n} fichiers écrits')); reload(); } });
  return html`<section class="card">
    <header class="card-head"><h2>${t('Coffre Obsidian')}</h2></header>
    <p class="muted">${t('Cette campagne est reliée à un coffre par l\'admin du serveur. L\'export écrit les fiches et la fiche de groupe en Markdown dans :')}</p>
    <p><code>${o.bridge.exportDir}</code></p>
    <div class="row wrap">
      <label class="field-inline">${t('Session')}<input class="txt small-num" inputMode="numeric" value=${session} onInput=${e => setSession(e.target.value.replace(/\D/g, ''))} placeholder=${o.bridge.suggestedSession ?? ''} /></label>
      <button type="button" class="btn primary" onClick=${() => exportAll(null)}>${Icon.download()} ${t('Exporter tout')}</button>
    </div>
    <div class="chip-row">${o.chars.map(c => html`<button type="button" class="btn tiny" onClick=${() => exportAll(c.id)}>${c.name}</button>`)}</div>
    ${o.bridge.lastExport ? html`<p class="muted small">${t('Dernier export : {date}, {n} fichier(s)', { date: fmtDate(o.bridge.lastExport.at), n: o.bridge.lastExport.files })}</p>` : null}
    ${result ? html`<ul class="files">${result.files.map(f => html`<li><code>${f.split('/').slice(-2).join('/')}</code></li>`)}</ul>` : null}
    ${o.bridge.notes ? html`<p class="muted small">${t('Le bestiaire peut importer les blocs de stats écrits dans les notes : onglet Bestiaire, « Synchroniser depuis le coffre ».')}</p>` : null}
  </section>`;
}

// ---------------------------------------------------------------- Jetons d'API

function ApiTokens({ cid, o, reload }) {
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState(null);
  const owner = o.role === 'dm';
  const create = () => run(() => api(`/api/c/${cid}/tokens`, { method: 'POST', body: { label } })).then(r => { if (r) { setFresh(r.token); setLabel(''); reload(); } });
  const drop = tk => run(() => api(`/api/c/${cid}/tokens/${tk.id}`, { method: 'DELETE' }), t('Jeton retiré')).then(reload);
  const base = location.origin;
  return html`<section class="card">
    <header class="card-head"><h2>${t('Jetons d\'API')}</h2></header>
    <p class="muted">${t('Un jeton donne à un outil ou à un assistant IA les droits du MJ sur cette campagne, et sur aucune autre. Il ne peut ni créer d\'autre jeton ni toucher aux comptes.')}</p>
    ${owner ? html`<div class="row"><input class="txt" placeholder=${t('À quoi sert-il ? (ex. : Claude)')} value=${label} onInput=${e => setLabel(e.target.value)} /><button type="button" class="btn primary" disabled=${!label.trim()} onClick=${create}>${t('Créer')}</button></div>` : html`<p class="muted small">${t('Seul le MJ titulaire crée et retire les jetons.')}</p>`}
    ${fresh ? html`<div class="alert"><p><b>${t('Copie ce jeton maintenant : il ne sera plus affiché.')}</b></p><p class="recovery-code small" onClick=${() => copy(fresh)}>${fresh}</p></div>` : null}
    ${o.tokens.length ? html`<table class="tbl"><thead><tr><th>${t('Nom')}</th><th>${t('Créé')}</th><th>${t('Dernier usage')}</th><th></th></tr></thead>
      <tbody>${o.tokens.map(tk => html`<tr key=${tk.id}><td>${tk.label}</td><td>${fmtDate(tk.createdAt)}</td><td>${fmtDate(tk.lastUsed)}</td>
        <td class="right">${owner ? html`<button type="button" class="btn tiny danger ghost" onClick=${() => drop(tk)}>${t('Retirer')}</button>` : null}</td></tr>`)}</tbody></table>` : null}
    <details class="api-doc"><summary>${t('Exemples d\'appels')}</summary>
      <pre>${[
        `# ${t('Fiches de la campagne')}`,
        `curl -H "Authorization: Bearer $TOKEN" ${base}/api/c/${cid}/characters`,
        `# ${t('Envoyer une carte, puis créer la scène')}`,
        `curl -H "Authorization: Bearer $TOKEN" --data-binary @carte.webp "${base}/api/c/${cid}/assets?kind=map&name=carte.webp"`,
        `curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"Crypte","image":"asset:…","cols":30,"rows":20}' ${base}/api/c/${cid}/map/scenes`,
        `# ${t('Remplacer les murs d\'une scène')}`,
        `curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @scene.json ${base}/api/c/${cid}/map/scenes/crypte`,
        `# ${t('Ajouter une créature au bestiaire')}`,
        `curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"Goule","body":"**CA 12** · **PV 22**"}' ${base}/api/c/${cid}/bestiary`,
      ].join('\n')}</pre>
    </details>
  </section>`;
}

// ---------------------------------------------------------------- Journal

const KIND_ICONS = { auth: '🔑', sheet: '📝', party: '🎒', roll: '🎲', dm: '⚙', map: '🗺', world: '🌍', admin: '🛡' };

function dayLabel(ts) {
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString()) return t('Aujourd\'hui');
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return t('Hier');
  return d.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

export function AuditLog({ url }) {
  const [entries, setEntries] = useState([]);
  const [kinds, setKinds] = useState({});
  const [on, setOn] = useState(new Set());
  const [q, setQ] = useState('');
  const [more, setMore] = useState(false);
  const [live, setLive] = useState(true);
  const seq = useRef(0);
  const query = before => {
    const params = new URLSearchParams();
    if (on.size) params.set('kinds', [...on].join(','));
    if (q.trim()) params.set('q', q.trim());
    if (before) params.set('before', before);
    params.set('limit', '150');
    return api(`${url}?${params}`);
  };
  const load = () => {
    const n = ++seq.current;
    query().then(r => { if (n !== seq.current) return; setEntries(r.entries); setKinds(r.kinds); setMore(r.entries.length >= 150); }).catch(e => toast(e.message, { kind: 'error' }));
  };
  const older = () => query(entries.at(-1)?.id).then(r => { setEntries([...entries, ...r.entries]); setMore(r.entries.length >= 150); });
  useEffect(() => { const tm = setTimeout(load, q ? 250 : 0); return () => clearTimeout(tm); }, [on, q, url]);
  useEffect(() => { if (!live) return undefined; const tm = setInterval(load, 5000); return () => clearInterval(tm); }, [live, on, q, url]);
  const toggle = k => { const next = new Set(on); if (next.has(k)) next.delete(k); else next.add(k); setOn(next); };
  let lastDay = '';
  return html`<section class="card audit">
    <header class="card-head"><h2>${t('Journal des actions')}</h2><label class="check small"><input type="checkbox" checked=${live} onChange=${e => setLive(e.target.checked)} /> ${t('En direct')}</label></header>
    <div class="audit-bar">
      <div class="audit-kinds">
        <button type="button" class=${`chip-btn ${on.size === 0 ? 'on' : ''}`} onClick=${() => setOn(new Set())}>${t('Tout')}</button>
        ${Object.entries(kinds).map(([k, label]) => html`<button type="button" class=${`chip-btn ${on.has(k) ? 'on' : ''}`} onClick=${() => toggle(k)}>${KIND_ICONS[k] || ''} ${t(label)}</button>`)}
      </div>
      <input class="txt audit-q" placeholder=${t('Chercher un nom, une action…')} value=${q} onInput=${e => setQ(e.target.value)} />
    </div>
    <ol class="audit-list">
      ${entries.map(e => {
        const day = dayLabel(e.at);
        const head = day !== lastDay ? html`<li class="audit-day">${day}</li>` : null;
        lastDay = day;
        return html`${head}<li key=${e.id} class=${`audit-row k-${e.kind}`}>
          <time title=${new Date(e.at).toLocaleString(locale())}>${new Date(e.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}</time>
          <span class="audit-k" title=${t(kinds[e.kind] || e.kind)}>${KIND_ICONS[e.kind] || '•'}</span>
          <span class="audit-who">${e.account || html`<i class="muted">${t('inconnu')}</i>`}${e.seat && e.seat !== e.account ? html`<small>${e.seat}</small>` : null}</span>
          <span class="audit-what"><b>${t(e.action)}</b>${e.count > 1 ? html` <span class="badge">×${e.count}</span>` : null}${e.detail ? html`<small>${e.detail}</small>` : null}</span>
          ${e.ip ? html`<span class="audit-ip muted small" title=${t('Adresse IP')}>${e.ip}</span>` : html`<span></span>`}
        </li>`;
      })}
      ${entries.length ? null : html`<li class="muted audit-empty">${t('Rien pour l\'instant.')}</li>`}
    </ol>
    ${more ? html`<div class="row-btns"><button type="button" class="btn small" onClick=${older}>${t('Plus ancien')}</button></div>` : null}
  </section>`;
}

export function DmModals() {
  const m = store.ui.modal;
  if (m?.kind === 'qr') return html`<${QrModal} url=${m.url} />`;
  return null;
}
