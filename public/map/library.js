// Images de la campagne : cartes et tokens envoyés par le MJ, rangés en dossiers.
// Envoyer (bouton ou glisser-déposer) dans le dossier ouvert, renommer, déplacer, supprimer ;
// une carte ouvre « Nouvelle carte », un token s'ajoute à la carte ouverte.
import { t } from '/shared/i18n.js';
import { html, useEffect, useRef, useState } from '/app/html.js';
import { api, campaignId } from './net.js';
import { fileUrl } from './images.js';
import { app, notify, toast } from './state.js';
import { Dialog, uploadImage } from './pickers.js';

const NO_FOLDER = '';
const ALL = '*';

// Les dossiers d'une liste d'images, triés, avec leur nombre d'images.
export function foldersOf(items, extra = []) {
  const n = new Map();
  for (const f of extra) if (f) n.set(f, n.get(f) || 0);
  for (const i of items) n.set(i.folder || NO_FOLDER, (n.get(i.folder || NO_FOLDER) || 0) + 1);
  return [...n.entries()].sort(([a], [b]) => (a === NO_FOLDER) - (b === NO_FOLDER) || a.localeCompare(b, 'fr', { numeric: true }));
}

export const folderLabel = f => (f === NO_FOLDER ? t('Sans dossier') : f);

export function ImageLibraryDialog() {
  const [kind, setKind] = useState(app.dialog?.tab === 'map' ? 'map' : 'token');
  const [items, setItems] = useState(null);
  const [folder, setFolder] = useState(ALL);
  const [made, setMade] = useState([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [q, setQ] = useState('');
  const fileRef = useRef(null);

  const load = () => api(`/api/c/${campaignId}/assets?kind=${kind}`).then(setItems).catch(e => { setItems([]); toast(e.message, 'error'); });
  useEffect(() => { setItems(null); setFolder(ALL); setMade([]); load(); }, [kind]);

  const target = folder === ALL ? NO_FOLDER : folder;
  const send = async files => {
    const list = [...files].filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif)$/i.test(f.name));
    if (!list.length) return;
    setBusy(true);
    let ok = 0;
    for (const f of list) {
      try { await uploadImage(f, kind, target); ok++; } catch (x) { toast(`${f.name} : ${x.message}`, 'error'); }
    }
    setBusy(false);
    if (ok) toast(t('{n} image(s) envoyée(s) dans {folder}', { n: ok, folder: folderLabel(target) }));
    load();
  };
  const patch = (a, body) => api(`/api/c/${campaignId}/assets/${a.id}`, { method: 'PATCH', body }).then(load).catch(e => toast(e.message, 'error'));
  const rename = a => { const n = prompt(t('Nom de l\'image'), a.name); if (n && n.trim()) patch(a, { name: n.trim() }); };
  const remove = a => {
    if (!confirm(t('Supprimer {name} ? Une carte ou un token qui l\'utilise n\'aura plus d\'image.', { name: a.name }))) return;
    api(`/api/c/${campaignId}/assets/${a.id}`, { method: 'DELETE' }).then(load).catch(e => toast(e.message, 'error'));
  };
  const newFolder = () => {
    const n = String(prompt(t('Nom du nouveau dossier : Donjon 2, Gobelins, Ville…')) || '').replace(/[\\/]+/g, '-').trim();
    if (!n) return;
    setMade([...made, n]);
    setFolder(n);
  };
  const renameFolder = () => {
    const n = String(prompt(t('Nouveau nom du dossier'), folder) || '').replace(/[\\/]+/g, '-').trim();
    if (!n || n === folder) return;
    Promise.all((items || []).filter(i => i.folder === folder).map(i => api(`/api/c/${campaignId}/assets/${i.id}`, { method: 'PATCH', body: { folder: n } })))
      .then(() => { setMade(made.map(m => (m === folder ? n : m))); setFolder(n); load(); })
      .catch(e => toast(e.message, 'error'));
  };
  const use = a => {
    if (kind === 'map') app.dialog = { kind: 'scene', image: { path: a.ref, name: a.name, width: a.width, height: a.height } };
    else if (app.doc) app.dialog = { kind: 'add', image: { path: a.ref, name: a.name } };
    else return toast(t('Ouvre d\'abord une carte pour y poser ce token'));
    notify();
    return undefined;
  };

  const folders = foldersOf(items || [], made);
  const names = folders.map(([f]) => f).filter(f => f !== NO_FOLDER);
  const shown = (items || []).filter(i => (folder === ALL || (i.folder || NO_FOLDER) === folder) && i.name.toLowerCase().includes(q.trim().toLowerCase()));

  return html`<${Dialog} title=${t('Images de la campagne')} wide>
    <div class="tabs">
      <button type="button" class=${kind === 'token' ? 'on' : ''} onClick=${() => setKind('token')}>${t('Tokens')}</button>
      <button type="button" class=${kind === 'map' ? 'on' : ''} onClick=${() => setKind('map')}>${t('Cartes')}</button>
    </div>
    <div class="lib-grid">
      <nav class="lib-folders" aria-label=${t('Dossiers')}>
        <button type="button" class=${folder === ALL ? 'on' : ''} onClick=${() => setFolder(ALL)}>${t('Tout')} <small>${items?.length ?? ''}</small></button>
        ${folders.map(([f, n]) => html`<button type="button" key=${f || '-'} class=${folder === f ? 'on' : ''} onClick=${() => setFolder(f)}>${folderLabel(f)} <small>${n}</small></button>`)}
        <button type="button" class="lib-new" onClick=${newFolder}>+ ${t('Nouveau dossier')}</button>
      </nav>
      <div class=${`lib-main ${over ? 'over' : ''}`}
        onDragOver=${e => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
        onDrop=${e => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}>
        <div class="ns-head">
          <input class="txt" placeholder=${t('Filtrer par nom…')} value=${q} onInput=${e => setQ(e.target.value)} />
          <button type="button" class="btn small primary" disabled=${busy} onClick=${() => fileRef.current?.click()}>
            ${busy ? t('Envoi…') : target ? t('Envoyer dans {folder}', { folder: target }) : t('Envoyer des images')}</button>
          ${folder !== ALL && folder !== NO_FOLDER ? html`<button type="button" class="btn small ghost" onClick=${renameFolder}>${t('Renommer le dossier')}</button>` : null}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden ref=${fileRef} onChange=${e => { send(e.target.files); e.target.value = ''; }} />
        </div>
        <p class="muted small">${kind === 'token'
          ? t('Glisse des images ici. Le nom du fichier sert à retrouver le token : « Goblin_Large.png » donne Goblin, 2 cases. Clic sur une image : la poser sur la carte ouverte.')
          : t('Glisse des images ici. Clic sur une image : créer une carte avec, grille et brouillard compris.')}</p>
        ${items === null ? html`<p class="muted">${t('Chargement…')}</p>` : null}
        ${items && !shown.length ? html`<p class="muted">${folder === ALL && !q ? t('Aucune image pour l\'instant : envoie la première.') : t('Rien dans ce dossier.')}</p>` : null}
        <div class=${kind === 'token' ? 'lib-list tokens' : 'lib-list maps'}>
          ${shown.map(a => html`<div class="lib-item" key=${a.id}>
            <button type="button" class="lib-use" title=${kind === 'map' ? t('Créer une carte avec cette image') : t('Poser sur la carte')} onClick=${() => use(a)}>
              <img loading="lazy" src=${fileUrl(a.ref)} alt="" />
            </button>
            <span class="lib-name" title=${a.name}>${a.name}</span>
            <div class="lib-acts">
              <select class="sel tiny" aria-label=${t('Dossier')} value=${a.folder || NO_FOLDER} onChange=${e => patch(a, { folder: e.target.value })}>
                <option value="">${t('Sans dossier')}</option>
                ${names.map(f => html`<option value=${f}>${f}</option>`)}
              </select>
              <button type="button" class="btn tiny ghost" title=${t('Renommer')} onClick=${() => rename(a)}>✎</button>
              <button type="button" class="btn tiny danger ghost" title=${t('Supprimer')} onClick=${() => remove(a)}>×</button>
            </div>
          </div>`)}
        </div>
      </div>
    </div>
  <//>`;
}
