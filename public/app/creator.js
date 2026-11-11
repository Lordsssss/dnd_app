// Créer une fiche : un joueur crée la sienne, le MJ en crée pour un joueur ou pour lui-même.
// La classe, la sous-classe et l'espèce sont proposées depuis 5etools ; tout reste modifiable.
// Pour un niveau au-delà de 1, la fiche part du niveau choisi : le bouton de montée de niveau
// complète ensuite les choix (dons, sorts, options) un niveau à la fois.
import { html, useEffect, useState } from './html.js';
import { api, store, toast } from './store.js';
import { Modal } from './ui.js';
import { data5e } from './data.js';
import { t } from '/shared/i18n.js';

export function CharacterCreator({ cid, members = [], dm = false, onClose, onDone }) {
  const [f, setF] = useState({ name: '', className: '', classSource: '', subclass: '', level: 1, race: '', background: '', owner: '' });
  const [classes, setClasses] = useState([]);
  const [subs, setSubs] = useState([]);
  const [races, setRaces] = useState([]);
  const [backgrounds, setBackgrounds] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  useEffect(() => { data5e.classes().then(setClasses); }, []);
  useEffect(() => {
    if (!f.className) { setSubs([]); return; }
    const c = classes.find(x => x.name === f.className);
    data5e.klass(f.className, c?.source).then(k => setSubs(k?.subclasses || []));
  }, [f.className, classes]);
  // Espèces et historiques : recherche dans 5etools pendant la saisie.
  useEffect(() => {
    if (f.race.trim().length < 2) { setRaces([]); return undefined; }
    const tm = setTimeout(() => data5e.search(f.race, 'race').then(r => setRaces([...new Set(r.map(x => x.n))].slice(0, 15))), 200);
    return () => clearTimeout(tm);
  }, [f.race]);
  useEffect(() => {
    if (f.background.trim().length < 2) { setBackgrounds([]); return undefined; }
    const tm = setTimeout(() => data5e.search(f.background, 'background').then(r => setBackgrounds([...new Set(r.map(x => x.n))].slice(0, 15))), 200);
    return () => clearTimeout(tm);
  }, [f.background]);

  const go = async () => {
    setBusy(true);
    try {
      const body = { name: f.name.trim(), className: f.className, subclass: f.subclass, level: Number(f.level) || 1, race: f.race.trim(), background: f.background.trim() };
      if (dm) body.owner = f.owner || null;
      const r = await api(`/api/c/${cid}/characters`, { method: 'POST', body });
      toast(t('Fiche créée'));
      onDone?.(r.id);
    } catch (e) { toast(e.message, { kind: 'error' }); } finally { setBusy(false); }
  };
  return html`<${Modal} title=${t('Nouvelle fiche')} onClose=${onClose} footer=${html`<span class="grow"></span>
      <button type="button" class="btn ghost" onClick=${onClose}>${t('Annuler')}</button>
      <button type="button" class="btn primary" disabled=${busy || !f.name.trim()} onClick=${go}>${t('Créer la fiche')}</button>`}>
    <div class="form-grid2">
      <label class="auth-field span2">${t('Nom du personnage')}<input class="txt" value=${f.name} onInput=${e => set('name', e.target.value)} /></label>
      <label class="auth-field">${t('Classe')}<select class="sel" value=${f.className} onChange=${e => setF({ ...f, className: e.target.value, subclass: '' })}>
        <option value="">${t('Choisir…')}</option>
        ${classes.map(c => html`<option value=${c.name}>${c.name}${c.source !== 'XPHB' ? ` (${c.source})` : ''}</option>`)}
      </select></label>
      <label class="auth-field">${t('Niveau')}<select class="sel" value=${f.level} onChange=${e => set('level', e.target.value)}>${Array.from({ length: 20 }, (_, i) => html`<option value=${i + 1}>${i + 1}</option>`)}</select></label>
      <label class="auth-field span2">${t('Sous-classe')} <small>${t('facultatif')}</small><input class="txt" list="subclass-list" value=${f.subclass} onInput=${e => set('subclass', e.target.value)} />
        <datalist id="subclass-list">${subs.map(s => html`<option value=${s.name}>${s.source}</option>`)}</datalist></label>
      <label class="auth-field">${t('Espèce')}<input class="txt" list="race-list" value=${f.race} onInput=${e => set('race', e.target.value)} />
        <datalist id="race-list">${races.map(r => html`<option value=${r} />`)}</datalist></label>
      <label class="auth-field">${t('Historique')}<input class="txt" list="bg-list" value=${f.background} onInput=${e => set('background', e.target.value)} />
        <datalist id="bg-list">${backgrounds.map(r => html`<option value=${r} />`)}</datalist></label>
      ${dm ? html`<label class="auth-field span2">${t('Jouée par')}<select class="sel" value=${f.owner} onChange=${e => set('owner', e.target.value)}>
        <option value="">${t('Personne (PNJ du MJ)')}</option>
        ${members.map(m => html`<option value=${m.accountId}>${m.name}</option>`)}
      </select></label>` : null}
    </div>
    <p class="muted small">${t('Les jets de sauvegarde, les emplacements de sorts et les ressources de la classe sont remplis tout de suite. Le reste se complète sur la fiche, et chaque valeur calculée peut être corrigée à la main.')}</p>
  <//>`;
}

// Écran d'un joueur qui n'a pas encore de fiche dans la campagne.
export function NoSheetYet({ cid }) {
  const [open, setOpen] = useState(false);
  const name = store.config.campaign?.name || '';
  return html`<div class="empty-state">
    <p class="big">${t('Bienvenue dans {name}', { name })}</p>
    <p class="muted">${t('Tu n\'as pas encore de personnage ici. Crée ta fiche : elle sera visible du MJ et, en lecture seule, des autres joueurs.')}</p>
    <button type="button" class="btn primary big" onClick=${() => setOpen(true)}>${t('Créer mon personnage')}</button>
    ${open ? html`<${CharacterCreator} cid=${cid} onClose=${() => setOpen(false)} onDone=${() => setOpen(false)} />` : null}
  </div>`;
}
