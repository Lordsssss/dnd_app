// Fiches en JSON : copier le modèle (pour soi ou pour une IA), et vérifier un fichier avant import.
import { html } from './html.js';
import { closeModal, openModal, toast } from './store.js';
import { Modal } from './ui.js';
import { Icon } from './icons.js';
import { SHEET_EXAMPLE, checkSheet, sheetExample, sheetPrompt } from '/shared/sheet-template.js';
import { DEFAULT_CURRENCY } from '/shared/rules.js';
import { t } from '/shared/i18n.js';

export function copyText(text, msg) {
  const done = () => toast(msg || t('Copié'));
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(done, () => fallback(text, done));
  fallback(text, done);
  return Promise.resolve();
}

// Sans presse-papiers (page en http sur le réseau local) : une zone de texte sélectionnée.
function fallback(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch { toast(t('Copie impossible : sélectionne le texte à la main'), { kind: 'error' }); }
  ta.remove();
}

const coinKeys = currency => (Array.isArray(currency) && currency.length ? currency : DEFAULT_CURRENCY).map(c => c.key);

// Deux boutons : le modèle seul, ou la consigne complète à coller dans une IA.
export function SheetTemplateButtons({ currency, edition, small }) {
  const cls = `btn${small ? ' small' : ''}`;
  const example = () => JSON.stringify(sheetExample({ coins: coinKeys(currency), edition }), null, 2);
  return html`
    <button type="button" class=${cls} title=${t('Une fiche d\'exemple complète, au format que l\'import accepte')}
      onClick=${() => copyText(example(), t('Modèle JSON copié'))}>${Icon.copy()} ${t('Copier le modèle JSON')}</button>
    <button type="button" class=${cls} title=${t('Les règles de remplissage et le modèle : colle-les dans une IA, puis décris ton personnage')}
      onClick=${() => copyText(sheetPrompt({ coins: coinKeys(currency), edition }), t('Consigne copiée : colle-la dans une IA, puis décris le personnage'))}>${t('Copier la consigne pour une IA')}</button>`;
}

// Lit un fichier JSON, le vérifie, et montre le résultat avant d'importer.
export function importSheetFile(file, { currency, title, okLabel, onImport }) {
  if (!file) return;
  file.text().then(txt => {
    let data;
    try { data = JSON.parse(txt); } catch (e) {
      openModal({ kind: 'sheetCheck', title, name: file.name, report: { errors: [t('JSON illisible : {msg}', { msg: e.message })], warnings: [] } });
      return;
    }
    const report = checkSheet(data, { coins: coinKeys(currency) });
    const name = data?.character?.name || data?.name || file.name;
    openModal({ kind: 'sheetCheck', title, name, report, okLabel, onOk: () => onImport(data) });
  });
}

export function SheetCheckModal({ title, name, report, okLabel, onOk }) {
  const { errors = [], warnings = [] } = report || {};
  const clean = !errors.length && !warnings.length;
  return html`<${Modal} title=${title || t('Importer une fiche')} footer=${html`<button type="button" class="btn" onClick=${closeModal}>${t('Annuler')}</button>
    <span class="grow"></span>
    ${onOk ? html`<button type="button" class="btn primary" disabled=${errors.length > 0} onClick=${() => { closeModal(); onOk(); }}>
      ${errors.length ? t('À corriger d\'abord') : warnings.length ? t('Importer quand même') : okLabel || t('Importer')}</button>` : null}`}>
    <p><b>${name}</b></p>
    ${clean ? html`<p class="good">${t('Fiche vérifiée : rien à signaler.')}</p>` : null}
    ${errors.length ? html`<h4 class="warn">${t('À corriger')}</h4><ul class="check-list err">${errors.map(e => html`<li>${e}</li>`)}</ul>` : null}
    ${warnings.length ? html`<h4>${t('À vérifier')}</h4><ul class="check-list">${warnings.map(w => html`<li>${w}</li>`)}</ul>` : null}
    ${errors.length ? html`<p class="muted small">${t('Corrige le fichier, ou renvoie ces messages à l\'IA qui l\'a écrit.')}</p>` : null}
  <//>`;
}

export const EXAMPLE_NAME = SHEET_EXAMPLE.character.name;
