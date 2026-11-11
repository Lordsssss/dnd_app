// Capacités et traits : la liste de la fiche, une fenêtre par entrée, le collage d'un texte.
// Le texte d'une entrée est celui du joueur, gardé mot pour mot. Le texte officiel de 5etools
// ne remplace le sien que s'il le demande.
import { html, useEffect, useMemo, useState } from './html.js';
import { closeModal, openModal, setOps, setPath, toast } from './store.js';
import { Modal } from './ui.js';
import { Icon } from './icons.js';
import { data5e } from './data.js';
import { toText } from '/shared/render5e.js';
import { newId } from '/shared/patch.js';
import { FEATURE_KINDS, FEATURE_KIND_LABELS, bodyOf, cleanFeature, featureItems, splitFeatures } from '/shared/features.js';
import { t } from '/shared/i18n.js';

const kindLabel = k => t(FEATURE_KIND_LABELS[k] || 'Autre');

export function FeaturesBox({ id, doc, ro }) {
  const [open, setOpen] = useState(() => new Set());
  const items = featureItems(doc);
  const toggle = fid => { const n = new Set(open); if (n.has(fid)) n.delete(fid); else n.add(fid); setOpen(n); };
  const add = () => openModal({ kind: 'feature', id, fid: null });
  let group = null;
  return html`<div class="feat-box">
    <div class="feat-tools">
      ${ro ? null : html`<button type="button" class="btn tiny" onClick=${add}>${Icon.plus()} ${t('Capacité')}</button>
        <button type="button" class="btn tiny" title=${t('Colle le texte de ta fiche : chaque ligne ou paragraphe devient une entrée, mot pour mot')} onClick=${() => openModal({ kind: 'featureImport', id })}>${t('Coller du texte')}</button>`}
      <button type="button" class="btn tiny ghost" title=${t('Chercher une capacité, un don, un sort…')} onClick=${() => openModal({ kind: 'compendium' })}>${t('Compendium')}</button>
      ${items.length > 3 ? html`<button type="button" class="btn tiny ghost" onClick=${() => setOpen(open.size ? new Set() : new Set(items.map(f => f.id)))}>${open.size ? t('Tout replier') : t('Tout déplier')}</button>` : null}
    </div>
    <div class="feat-list">
      ${items.map(f => {
        const head = f.group !== group ? html`<div class="feat-group">${f.group || t('Sans groupe')}</div>` : null;
        group = f.group;
        const body = bodyOf(f);
        const isOpen = open.has(f.id);
        return html`${head}<div class=${`feat ${isOpen ? 'open' : ''}`} key=${f.id}>
          <div class="feat-row">
            <button type="button" class="feat-name" onClick=${() => toggle(f.id)}>${f.name || t('Sans nom')}</button>
            ${f.kind !== 'other' ? html`<span class="feat-kind">${kindLabel(f.kind)}</span>` : null}
            ${ro ? null : html`<button type="button" class="icon-btn faint" title=${t('Modifier')} onClick=${() => openModal({ kind: 'feature', id, fid: f.id })}>${Icon.pencil()}</button>`}
          </div>
          ${isOpen && body ? html`<p class="feat-text">${body}</p>` : null}
        </div>`;
      })}
      ${items.length ? null : html`<p class="muted feat-empty">${ro ? t('Aucune capacité.') : t('Aucune capacité. Ajoute-les une par une, ou colle le texte de ta fiche.')}</p>`}
    </div>
    ${doc.features ? html`<details class="feat-legacy"><summary>${t('Ancien bloc de texte')}</summary><p class="feat-text">${doc.features}</p></details>` : null}
  </div>`;
}

// La recherche d'une entrée de 5etools pour le texte officiel : dons, options de classe,
// capacités de classe et de sous-classe, traits d'espèce, historiques, objets.
const REF_KINDS = 'feat,opt,classFeature,subclassFeature,race,background,item';

function OfficialText({ name, onText }) {
  const [q, setQ] = useState(name || '');
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return undefined; }
    const tm = setTimeout(() => data5e.search(q, REF_KINDS).then(r => setHits(r.slice(0, 10))), 200);
    return () => clearTimeout(tm);
  }, [q]);
  const pick = async h => {
    setBusy(true);
    const kind = h.k === 'opt' ? 'optionalfeature' : h.k;
    const e = await data5e.entry(kind, h.n, h.s, { cls: h.cls, cs: h.cs, lv: h.lv, sub: h.sub, ss: h.ss });
    setBusy(false);
    if (!e?.entries) return toast(t('Texte introuvable dans 5etools'), { kind: 'error' });
    onText(toText(e.entries), { kind: h.k, name: h.n, source: h.s });
    return undefined;
  };
  return html`<div class="official">
    <input class="txt" placeholder=${t('Nom dans 5etools…')} value=${q} onInput=${e => setQ(e.target.value)} />
    ${hits.length ? html`<ul class="pick-list">${hits.map(h => html`<li><button type="button" disabled=${busy} onClick=${() => pick(h)}><b>${h.n}</b> <span class="muted small">${h.s}${h.x ? ` · ${h.x}` : ''}</span></button></li>`)}</ul>` : null}
  </div>`;
}

export function FeatureModal({ id, fid, doc }) {
  const cur = fid ? doc.featureList?.[fid] : null;
  const items = featureItems(doc);
  const groups = useMemo(() => [...new Set(items.map(f => f.group).filter(Boolean))], [items.length]);
  const [f, setF] = useState(() => ({ name: cur?.name || '', group: cur?.group || items.at(-1)?.group || '', kind: cur?.kind || 'other', text: cur?.text || '', ref: cur?.ref || null }));
  const [official, setOfficial] = useState(false);
  const set = patch => setF(x => ({ ...x, ...patch }));
  const save = () => {
    const order = cur ? cur.order : items.reduce((m, x) => Math.max(m, Number(x.order) || 0), -1) + 1;
    setPath(id, ['featureList', fid || newId('f')], cleanFeature({ ...f, order }, order));
    closeModal();
  };
  const remove = () => openModal({ kind: 'confirm', danger: true, title: t('Retirer {name} ?', { name: cur.name }), ok: t('Retirer'), text: t('L\'entrée disparaît de la fiche (annulable avec ↶).'), onOk: () => setPath(id, ['featureList', fid], undefined) });
  // Monter ou descendre : on échange l'ordre avec la voisine.
  const move = dir => {
    const i = items.findIndex(x => x.id === fid);
    const other = items[i + dir];
    if (!other) return;
    setOps(id, [[['featureList', fid, 'order'], other.order], [['featureList', other.id, 'order'], cur.order]]);
  };
  const useOfficial = (txt, ref) => {
    const apply = () => { set({ text: txt, ref, name: f.name || ref.name }); setOfficial(false); };
    if (f.text.trim() && f.text.trim() !== txt.trim()) {
      if (confirm(t('Remplacer ton texte par le texte officiel ?'))) apply();
    } else apply();
  };
  return html`<${Modal} title=${cur ? cur.name || t('Capacité') : t('Nouvelle capacité')} wide footer=${html`
    ${cur ? html`<button type="button" class="btn danger ghost" onClick=${remove}>${Icon.trash()} ${t('Retirer')}</button>
      <button type="button" class="btn ghost" title=${t('Monter')} onClick=${() => move(-1)}>↑</button>
      <button type="button" class="btn ghost" title=${t('Descendre')} onClick=${() => move(1)}>↓</button>` : null}
    <span class="grow"></span>
    <button type="button" class="btn" onClick=${closeModal}>${t('Annuler')}</button>
    <button type="button" class="btn primary" disabled=${!f.name.trim() && !f.text.trim()} onClick=${save}>${t('Enregistrer')}</button>`}>
    <div class="form-grid">
      <label>${t('Nom')} <input class="txt" value=${f.name} onInput=${e => set({ name: e.target.value })} placeholder="Second Wind" /></label>
      <label>${t('Groupe')} <input class="txt" list="feat-groups" value=${f.group} onInput=${e => set({ group: e.target.value })} placeholder=${t('Fighter, Dons, Espèce…')} />
        <datalist id="feat-groups">${groups.map(g => html`<option value=${g} />`)}</datalist></label>
      <label>${t('Origine')} <select class="sel" value=${f.kind} onChange=${e => set({ kind: e.target.value })}>
        ${FEATURE_KINDS.map(k => html`<option value=${k}>${kindLabel(k)}</option>`)}</select></label>
      <label class="span2">${t('Texte')} <small class="muted">${t('Tel que tu l\'écris : l\'application n\'y touche pas.')}</small>
        <textarea class="txt feat-edit" value=${f.text} onInput=${e => set({ text: e.target.value })}></textarea></label>
    </div>
    <div class="row-btns">
      <button type="button" class="btn small ghost" onClick=${() => setOfficial(!official)}>${Icon.book()} ${t('Texte officiel de 5etools')}</button>
      ${f.ref ? html`<span class="muted small">${t('Lié à')} ${f.ref.name} (${f.ref.source})</span>` : null}
    </div>
    ${official ? html`<${OfficialText} name=${f.name} onText=${useOfficial} />` : null}
  <//>`;
}

// Coller un texte (fiche PDF, D&D Beyond, notes) : découpé en entrées sans changer un mot.
export function FeatureImportModal({ id, doc }) {
  const [txt, setTxt] = useState('');
  const preview = useMemo(() => splitFeatures(txt), [txt]);
  const go = () => {
    let order = featureItems(doc).reduce((m, x) => Math.max(m, Number(x.order) || 0), -1) + 1;
    const ops = preview.map(f => [['featureList', newId('f')], cleanFeature({ ...f, order }, order++)]);
    if (ops.length) setOps(id, ops);
    toast(t('{n} entrée(s) ajoutée(s)', { n: ops.length }));
    closeModal();
  };
  return html`<${Modal} title=${t('Coller les capacités de ta fiche')} wide footer=${html`<span class="grow"></span>
    <button type="button" class="btn" onClick=${closeModal}>${t('Annuler')}</button>
    <button type="button" class="btn primary" disabled=${!preview.length} onClick=${go}>${t('Ajouter {n} entrée(s)', { n: preview.length })}</button>`}>
    <p class="muted small">${t('Une ligne qui commence par un tiret, ou un paragraphe, devient une entrée. Une ligne en majuscules ou finie par deux-points devient un groupe. Le texte est gardé tel quel.')}</p>
    <textarea class="txt feat-paste" value=${txt} onInput=${e => setTxt(e.target.value)} placeholder=${'FIGHTER\n- Second Wind : …\n- Action Surge : …'}></textarea>
    ${preview.length ? html`<ol class="feat-preview">${preview.map(f => html`<li>${f.group ? html`<small class="muted">${f.group} · </small>` : null}<b>${f.name}</b></li>`)}</ol>` : null}
  <//>`;
}
