// Onglet « Lots » du panneau du MJ : ce que les personnages reçoivent ou perdent, préparé avant la
// séance et appliqué à la table d'un clic. La fiche du joueur change en direct.
import { html, useEffect, useMemo, useState } from './html.js';
import { api, closeModal, openModal, toast } from './store.js';
import { Modal } from './ui.js';
import { Icon } from './icons.js';
import { data5e, fold } from './data.js';
import { t, tn, locale } from '/shared/i18n.js';
import { DEFAULT_CURRENCY, denomsAsc, formatPurse, itemList, num } from '/shared/rules.js';
import { kitTakes, sameName } from '/shared/kits.js';

const FATE_LABEL = () => ({ stay: t('Reste'), keep: t('Rangé, rendu plus tard'), lose: t('Perdu') });
const fmtDate = ts => (ts ? new Date(ts).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '');

async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, { kind: 'error' }); return null; }
}

function useKits(cid) {
  const [state, setState] = useState({ loading: true, list: [] });
  const reload = () => api(`/api/c/${cid}/kits`).then(list => setState({ loading: false, list })).catch(e => { toast(e.message, { kind: 'error' }); setState({ loading: false, list: [] }); });
  useEffect(() => { reload(); }, [cid]);
  return [state, reload];
}

const qtyName = it => (num(it.qty, 1) === 1 ? it.name : `${num(it.qty, 1)}× ${it.name}`);

// Une phrase par moitié du lot : ce qu'il retire, ce qu'il donne.
function takeSummary(kit, denoms) {
  const tk = kit.take || {};
  if (!kitTakes(kit)) return null;
  const parts = [];
  if (tk.rest === 'keep') parts.push(t('tout l\'inventaire, rangé'));
  else if (tk.rest === 'lose') parts.push(t('tout l\'inventaire, perdu'));
  const by = f => (tk.items || []).filter(x => x.fate === f && x.fate !== tk.rest).map(x => x.name);
  const stay = by('stay'), keep = by('keep'), lose = by('lose');
  if (keep.length) parts.push(`${t('rangés')} : ${keep.join(', ')}`);
  if (lose.length) parts.push(`${t('perdus')} : ${lose.join(', ')}`);
  if (stay.length) parts.push(`${t('restent')} : ${stay.join(', ')}`);
  if (tk.money === 'keep') parts.push(t('l\'argent, rangé'));
  if (tk.money === 'lose') parts.push(t('l\'argent, perdu'));
  return parts.join(' · ');
}

function giveSummary(kit, denoms) {
  const items = (kit.give?.items || []).map(qtyName);
  const cur = kit.give?.currency || {};
  if (Object.keys(cur).length) items.push(formatPurse(cur, denoms));
  return items.length ? items.join(', ') : null;
}

export function Kits({ cid, o }) {
  const [st, reload] = useKits(cid);
  const [edit, setEdit] = useState(null);
  const denoms = o.campaign.settings?.currency || DEFAULT_CURRENCY;
  const chars = o.chars;
  const charName = id => chars.find(c => c.id === id)?.name || t('fiche supprimée');
  const folders = useMemo(() => [...new Set(st.list.map(k => k.folder).filter(Boolean))], [st.list]);
  if (edit) return html`<${KitEditor} cid=${cid} kit=${edit} chars=${chars} denoms=${denoms} folders=${folders} onClose=${() => { setEdit(null); reload(); }} />`;

  const groups = [];
  for (const k of st.list) {
    const g = groups.find(x => x[0] === (k.folder || ''));
    if (g) g[1].push(k); else groups.push([k.folder || '', [k]]);
  }
  // Le dossier le plus récent en haut : « Session 10 » avant « Session 9 ».
  groups.sort((a, b) => (!a[0]) - (!b[0]) || b[0].localeCompare(a[0], 'fr', { numeric: true }));

  const apply = (k, charId) => {
    const who = charName(charId);
    const take = takeSummary(k, denoms);
    const give = giveSummary(k, denoms);
    const again = (k.history || []).find(h => h.charId === charId);
    openModal({
      kind: 'confirm', title: t('« {kit} » → {name}', { kit: k.name, name: who }), ok: again ? t('Appliquer encore') : t('Appliquer'), danger: !!again,
      text: [again ? t('Déjà appliqué à {name}, {date}.', { name: who, date: fmtDate(again.at) }) : '',
        take ? `${t('Retire')} : ${take}.` : '', give ? `${t('Donne')} : ${give}.` : '', t('La fiche change en direct.')].filter(Boolean).join(' '),
      onOk: () => run(() => api(`/api/c/${cid}/kits/${k.id}/apply`, { method: 'POST', body: { charId } })).then(r => {
        reload();
        if (r) openModal({ kind: 'kitReport', report: r, kit: k.name, denoms });
      }),
    });
  };
  const undo = k => openModal({
    kind: 'confirm', danger: true, title: t('Annuler « {kit} » ?', { kit: k.name }), ok: t('Annuler le lot'),
    text: t('L\'inventaire et la bourse de {name} reviennent à leur état d\'avant le lot, appliqué le {date} : ce qui a changé sur sa fiche depuis, objets et argent, est perdu.', { name: k.undo.name, date: fmtDate(k.undo.at) })
      + (k.undo.createdKit ? ` ${t('Le lot « {kit} » est supprimé.', { kit: k.undo.createdKit.name })}` : ''),
    onOk: () => run(() => api(`/api/c/${cid}/kits/${k.id}/undo`, { method: 'POST' }), t('Lot annulé')).then(reload),
  });
  const copyKit = k => run(() => api(`/api/c/${cid}/kits`, {
    method: 'POST', body: { ...k, id: undefined, name: `${k.name} ${t('(copie)')}` },
  }), t('Lot dupliqué')).then(reload);

  return html`
    <section class="card">
      <header class="card-head"><h2>${t('Lots préparés')}</h2>
        <button type="button" class="btn small primary" onClick=${() => setEdit({ name: '', folder: folders[0] || '', target: '', note: '', give: { items: [], currency: {} }, take: { rest: 'stay', money: 'stay', items: [] }, keepName: '' })}>${Icon.plus()} ${t('Nouveau lot')}</button>
      </header>
      <p class="muted small">${t('Prépare avant la séance ce que les personnages reçoivent ou perdent. À la table, un clic applique le lot : la fiche du joueur change en direct. Ce qu\'un lot range est mis de côté dans un nouveau lot, à rendre d\'un clic.')}</p>
    </section>
    ${st.loading ? html`<p class="muted">${t('Chargement…')}</p>` : !st.list.length ? html`<section class="card"><p class="muted">${t('Aucun lot pour l\'instant.')}</p></section>` : null}
    ${groups.map(([folder, kits]) => html`<section class="card kit-group" key=${folder}>
      <header class="card-head"><h2>${folder || t('Sans dossier')}</h2><span class="muted">${tn(kits.length, '{n} lot', '{n} lots')}</span></header>
      <div class="kit-list">${kits.map(k => {
        const take = takeSummary(k, denoms);
        const give = giveSummary(k, denoms);
        const last = k.history?.[0];
        return html`<div class="kit" key=${k.id}>
          <div class="kit-main">
            <div class="kit-title"><b>${k.name}</b>
              ${k.target ? html`<span class="chip">→ ${charName(k.target)}</span>` : html`<span class="chip muted">${t('au choix')}</span>`}</div>
            ${k.note ? html`<p class="muted small kit-note">${k.note}</p>` : null}
            ${take ? html`<p class="kit-line"><span class="kit-tag take">${t('Retire')}</span> ${take}</p>` : null}
            ${give ? html`<p class="kit-line"><span class="kit-tag give">${t('Donne')}</span> ${give}</p>` : null}
            ${!take && !give ? html`<p class="muted small">${t('Lot vide.')}</p>` : null}
            ${last ? html`<p class="muted small">${t('Appliqué à {name}, {date}', { name: last.name, date: fmtDate(last.at) })}${k.history.length > 1 ? ` · ${tn(k.history.length, '{n} fois', '{n} fois')}` : ''}</p>` : null}
          </div>
          <div class="kit-act">
            ${k.target ? html`<button type="button" class=${`btn ${last ? '' : 'primary'}`} disabled=${!chars.some(c => c.id === k.target)} onClick=${() => apply(k, k.target)}>${Icon.gift()} ${t('Appliquer à {name}', { name: charName(k.target) })}</button>`
              : html`<div class="kit-who">${chars.map(c => html`<button type="button" class="btn small" key=${c.id} onClick=${() => apply(k, c.id)}>→ ${c.name}</button>`)}</div>`}
            <div class="row">
              ${k.undo ? html`<button type="button" class="btn tiny ghost" title=${t('Remettre la fiche comme avant ce lot')} onClick=${() => undo(k)}>${Icon.undo()} ${t('Annuler le lot')}</button>` : null}
              <button type="button" class="btn tiny" title=${t('Modifier')} onClick=${() => setEdit(k)}>${Icon.pencil()}</button>
              <button type="button" class="btn tiny" title=${t('Dupliquer')} onClick=${() => copyKit(k)}>${Icon.copy()}</button>
            </div>
          </div>
        </div>`;
      })}</div>
    </section>`)}`;
}

// ---------------------------------------------------------------- Rapport après application

export function KitReport({ report: r, kit, denoms }) {
  const kept = r.removed.filter(x => x.fate === 'keep');
  const lost = r.removed.filter(x => x.fate === 'lose');
  const line = x => (x.money ? formatPurse(x.money, denoms) : qtyName(x));
  return html`<${Modal} title=${t('« {kit} » → {name}', { kit, name: r.name })}>
    ${kept.length ? html`<p><b>${t('Rangé')}</b> ${r.created ? html`<span class="muted">→ ${t('lot « {kit} »', { kit: r.created.name })}</span>` : null}</p><p class="kit-rep">${kept.map(line).join(', ')}</p>` : null}
    ${lost.length ? html`<p><b>${t('Perdu')}</b></p><p class="kit-rep">${lost.map(line).join(', ')}</p>` : null}
    ${r.given.length ? html`<p><b>${t('Reçu')}</b></p><p class="kit-rep">${r.given.map(line).join(', ')}</p>` : null}
    ${!r.removed.length && !r.given.length ? html`<p class="muted">${t('Rien n\'a changé.')}</p>` : null}
    ${r.warnings.map(w => html`<p class="alert small">${Icon.info()} ${w.kind === 'missing'
      ? t('Introuvable sur la fiche : {name}', { name: w.name })
      : t('{name} arrive sans harmonisation : déjà 3 objets harmonisés.', { name: w.name })}</p>`)}
  <//>`;
}

// ---------------------------------------------------------------- Éditeur

function ItemPicker({ onPick }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(null);
  useEffect(() => { if (q.trim().length >= 2 && !idx) data5e.items().then(setIdx).catch(() => setIdx([])); }, [q]);
  const found = useMemo(() => {
    const fq = fold(q.trim());
    if (fq.length < 2 || !idx) return [];
    const seen = new Set();
    return idx.filter(it => { const k = fold(it.name); if (!k.includes(fq) || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
  }, [idx, q]);
  const pick = it => {
    const item = { name: it.name, source: it.source, qty: 1, notes: '' };
    if (it.weight) item.weight = it.weight;
    if (it.rarity) item.rarity = it.rarity;
    if (it.attunement) item.attunement = true;
    if (it.charges) item.charges = { max: it.charges, used: 0 };
    if (/potion|scroll|ammunition|^P$/i.test(it.type) || /potion|scroll/i.test(it.name)) item.consumable = true;
    onPick(item);
    setQ('');
  };
  return html`<div class="search-5e">
    <input class="txt" placeholder=${t('Ajouter un objet de 5etools : tape son nom…')} value=${q} onInput=${e => setQ(e.target.value)} />
    ${found.length ? html`<ul class="pick-list">${found.map(it => html`<li key=${it.name + it.source}><button type="button" onClick=${() => pick(it)}><b>${it.name}</b> <span class="muted">${[it.rarity, it.attunement ? t('harmonisation') : '', it.source].filter(Boolean).join(' · ')}</span></button></li>`)}</ul>` : null}
  </div>`;
}

function GiveRows({ items, setItems }) {
  const upd = (i, patch) => setItems(items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const flag = (i, k, label) => html`<label class="kit-flag" title=${label}><input type="checkbox" checked=${!!items[i][k]} onChange=${e => upd(i, { [k]: e.target.checked || undefined, ...(k === 'attunement' && !e.target.checked ? { attuned: undefined } : {}) })} /> ${label}</label>`;
  if (!items.length) return html`<p class="muted small">${t('Aucun objet à donner.')}</p>`;
  return html`<div class="kit-rows">${items.map((it, i) => html`<div class="kit-row" key=${i}>
    <input class="txt kit-qty" inputMode="numeric" aria-label=${t('Quantité')} value=${it.qty ?? 1} onInput=${e => upd(i, { qty: Math.max(0, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0) })} />
    <input class="txt kit-name" aria-label=${t('Nom')} placeholder=${t('Nom de l\'objet')} value=${it.name} onInput=${e => upd(i, { name: e.target.value })} />
    <input class="txt kit-notes" aria-label=${t('Notes')} placeholder=${t('Notes, visibles sur la fiche')} value=${it.notes || ''} onInput=${e => upd(i, { notes: e.target.value })} />
    <span class="kit-flags">
      ${flag(i, 'equipped', t('Équipé'))}
      ${flag(i, 'consumable', t('Consommable'))}
      ${flag(i, 'attunement', t('Harmonisation'))}
      ${it.attunement ? flag(i, 'attuned', t('Harmonisé')) : null}
    </span>
    <button type="button" class="btn tiny danger ghost" title=${t('Retirer du lot')} onClick=${() => setItems(items.filter((_, j) => j !== i))}>${Icon.trash()}</button>
  </div>`)}</div>`;
}

function TakeRows({ cid, target, take, setTake }) {
  const [inv, setInv] = useState(null);
  useEffect(() => {
    setInv(null);
    if (!target) return;
    api(`/api/c/${cid}/characters/${target}`).then(r => setInv(itemList(r.character?.inventory))).catch(() => setInv([]));
  }, [cid, target]);
  const labels = FATE_LABEL();
  // Comme le serveur : une ligne vise son objet par id, sinon le premier objet libre du même nom.
  const { byItem, missing } = useMemo(() => {
    const m = new Map();
    const loose = [];
    const list = inv || [];
    for (const ref of take.items) {
      if (ref.id && list.some(i => i.id === ref.id) && !m.has(ref.id)) m.set(ref.id, ref);
      else loose.push(ref);
    }
    const miss = [];
    for (const ref of loose) {
      const hit = list.find(i => !m.has(i.id) && sameName(i.name, ref.name));
      if (hit) m.set(hit.id, ref); else miss.push(ref);
    }
    return { byItem: m, missing: inv ? miss : [] };
  }, [inv, take.items]);
  const entryFor = it => byItem.get(it.id);
  const setFate = (it, fate) => {
    const rest = take.items.filter(x => x !== entryFor(it));
    setTake({ ...take, items: [...rest, { id: it.id, name: it.name, fate }] });
  };
  const all = fate => setTake({ ...take, rest: fate, items: [] });
  const sel = (value, onChange) => html`<select class="sel" value=${value} onChange=${e => onChange(e.target.value)}>
    ${['stay', 'keep', 'lose'].map(f => html`<option value=${f}>${labels[f]}</option>`)}</select>`;
  return html`
    <div class="row wrap">
      <label class="field-inline">${t('Le reste de l\'inventaire')} ${sel(take.rest, v => setTake({ ...take, rest: v }))}</label>
      <label class="field-inline">${t('L\'argent')} ${sel(take.money, v => setTake({ ...take, money: v }))}</label>
    </div>
    <p class="muted small">${t('« Le reste » vaut pour tout objet sans choix ci-dessous, y compris ceux que le joueur ajoutera d\'ici la séance.')}</p>
    ${!target ? html`<p class="muted small">${t('Choisis une fiche en haut pour régler objet par objet.')}</p>`
      : !inv ? html`<p class="muted">${t('Chargement…')}</p>` : html`
      <div class="row wrap">
        <span class="muted small">${t('Tout mettre à :')}</span>
        <button type="button" class="btn tiny" onClick=${() => all('stay')}>${labels.stay}</button>
        <button type="button" class="btn tiny" onClick=${() => all('keep')}>${labels.keep}</button>
        <button type="button" class="btn tiny" onClick=${() => all('lose')}>${labels.lose}</button>
      </div>
      <div class="kit-rows">${inv.map(it => {
        const e = entryFor(it);
        const f = e ? e.fate : take.rest;
        return html`<div class=${`kit-row take ${f}`} key=${it.id}>
          <span class="kit-qty muted">${num(it.qty, 1)}</span>
          <span class="kit-name">${it.name}${it.attuned ? html` <span class="muted" title=${t('Harmonisé')}>◆</span>` : null}${e ? null : html` <span class="muted small">· ${t('par défaut')}</span>`}</span>
          ${sel(f, v => setFate(it, v))}
        </div>`;
      })}
      ${inv.length ? null : html`<p class="muted small">${t('Inventaire vide.')}</p>`}</div>
      ${missing.length ? html`<p class="muted small">${t('Plus sur la fiche, cherchés par leur nom à l\'application :')}</p>
        <div class="kit-rows">${missing.map(x => html`<div class="kit-row take ${x.fate}" key=${x.id + x.name}>
          <span class="kit-qty"></span><span class="kit-name">${x.name}</span><span class="muted small">${labels[x.fate]}</span>
          <button type="button" class="btn tiny danger ghost" onClick=${() => setTake({ ...take, items: take.items.filter(y => y !== x) })}>${Icon.trash()}</button>
        </div>`)}</div>` : null}`}`;
}

function KitEditor({ cid, kit, chars, denoms, folders, onClose }) {
  const [k, setK] = useState(() => ({
    ...kit, give: { items: [...(kit.give?.items || [])], currency: { ...(kit.give?.currency || {}) } },
    take: { rest: 'stay', money: 'stay', ...(kit.take || {}), items: [...(kit.take?.items || [])] },
  }));
  const [busy, setBusy] = useState(false);
  const set = patch => setK(x => ({ ...x, ...patch }));
  const setItems = items => setK(x => ({ ...x, give: { ...x.give, items } }));
  const setTake = take => setK(x => ({ ...x, take }));
  const setCoin = (key, v) => setK(x => ({ ...x, give: { ...x.give, currency: { ...x.give.currency, [key]: Math.max(0, parseInt(String(v).replace(/\D/g, ''), 10) || 0) } } }));
  const save = async () => {
    setBusy(true);
    const body = { name: k.name, folder: k.folder, target: k.target, note: k.note, give: { ...k.give, items: k.give.items.filter(i => String(i.name || '').trim()) }, take: k.take, keepName: k.keepName, order: k.order };
    const r = await run(() => (k.id ? api(`/api/c/${cid}/kits/${k.id}`, { method: 'PUT', body }) : api(`/api/c/${cid}/kits`, { method: 'POST', body })), t('Lot enregistré'));
    setBusy(false);
    if (r) onClose();
  };
  const remove = () => openModal({
    kind: 'confirm', danger: true, title: t('Supprimer « {kit} » ?', { kit: k.name }), ok: t('Supprimer'),
    text: t('Le lot disparaît. Les fiches gardent ce qu\'il a déjà donné ou retiré.'),
    onOk: () => run(() => api(`/api/c/${cid}/kits/${k.id}`, { method: 'DELETE' }), t('Lot supprimé')).then(onClose),
  });
  const changeTarget = target => {
    // Les choix objet par objet visent une fiche : ils ne suivent pas un changement de fiche.
    if (k.take.items.length && target !== k.target) setTake({ ...k.take, items: [] });
    set({ target });
  };
  return html`<section class="card kit-editor">
    <header class="card-head"><h2>${k.id ? k.name || t('Lot') : t('Nouveau lot')}</h2>
      <div class="row">
        ${k.id ? html`<button type="button" class="btn small danger ghost" onClick=${remove}>${Icon.trash()} ${t('Supprimer')}</button>` : null}
        <button type="button" class="btn small" onClick=${onClose}>${t('Annuler')}</button>
        <button type="button" class="btn small primary" disabled=${busy || !k.name.trim()} onClick=${save}>${t('Enregistrer')}</button>
      </div>
    </header>
    <div class="form-grid2">
      <label class="auth-field">${t('Nom')}<input class="txt" value=${k.name} placeholder=${t('Butin du donjon')} onInput=${e => set({ name: e.target.value })} /></label>
      <label class="auth-field">${t('Dossier')}<input class="txt" list="kit-folders" value=${k.folder} placeholder=${t('Session 5')} onInput=${e => set({ folder: e.target.value })} />
        <datalist id="kit-folders">${folders.map(f => html`<option value=${f} />`)}</datalist></label>
      <label class="auth-field">${t('Fiche')}<select class="sel" value=${k.target} onChange=${e => changeTarget(e.target.value)}>
        <option value="">${t('Au choix, à la table')}</option>
        ${chars.map(c => html`<option value=${c.id}>${c.name}</option>`)}
      </select></label>
      <label class="auth-field">${t('Note pour toi')}<input class="txt" value=${k.note} placeholder=${t('Quand l\'appliquer, ce que ça raconte')} onInput=${e => set({ note: e.target.value })} /></label>
    </div>

    <h3 class="kit-h">${t('Ce que le lot retire')}</h3>
    <${TakeRows} cid=${cid} target=${k.target} take=${k.take} setTake=${setTake} />
    ${kitTakes(k) ? html`<label class="auth-field">${t('Ce qui est rangé part dans le lot')}<input class="txt" value=${k.keepName} placeholder=${`${k.name || t('Lot')} · ${t('à rendre')}`} onInput=${e => set({ keepName: e.target.value })} /></label>` : null}

    <h3 class="kit-h">${t('Ce que le lot donne')}</h3>
    <${GiveRows} items=${k.give.items} setItems=${setItems} />
    <div class="row wrap">
      <button type="button" class="btn small" onClick=${() => setItems([...k.give.items, { name: '', qty: 1, notes: '' }])}>${Icon.plus()} ${t('Objet maison')}</button>
    </div>
    <${ItemPicker} onPick=${it => setItems([...k.give.items, it])} />
    <div class="row wrap kit-coins">
      <span class="muted small">${t('Argent')}</span>
      ${denomsAsc(denoms).reverse().map(d => html`<label class="field-inline" key=${d.key}>${d.label}
        <input class="txt small-num" inputMode="numeric" value=${k.give.currency[d.key] || ''} placeholder="0" onInput=${e => setCoin(d.key, e.target.value)} /></label>`)}
    </div>
  </section>`;
}
