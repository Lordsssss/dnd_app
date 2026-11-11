// Fenêtres : sorts, lancement, repos, montée de niveau, objets, dons, monnaie, réglages.
import { t } from '/shared/i18n.js';
import { html, useEffect, useMemo, useState } from './html.js';
import { renderEntries } from '/shared/render5e.js';
import { clone, newId } from '/shared/patch.js';
import { applyAutoSlots } from '/shared/model.js';
import {
  ABILITY_SHORT, CONDITIONS, EXHAUSTION_TEXT, HIT_DIE, ORDINAL, SPELLCASTING_DEFAULTS, abilityMod,
  availableSlotLevels, classKey, classLevel, defaultResources, denomsAsc, featuresAt,
  hitDiceOf, isAsiLevel, isPreparedMode, itemList, num, preparedCap, profBonus, signed, spellReady,
  totalLevel,
} from '/shared/rules.js';
import {
  act, actorId, api, canEdit, canPartyAct, charDoc, charIds, closeModal, currentCampaign, myCharId, openModal, setOps, setPath, store, toast, undo,
} from './store.js';
import { CharacterCreator } from './creator.js';
import { FeatureImportModal, FeatureModal } from './features.js';
import { LearnScrollModal } from './scrolls.js';
import { SheetCheckModal, SheetTemplateButtons, importSheetFile } from './sheet-json.js';
import { Modal, Num, Txt, focusOnce } from './ui.js';
import { data5e, fold, spellRefresh } from './data.js';
import { rollDie, showRoll } from './dice.js';
import { Icon } from './icons.js';
import { LevelUp } from './levelup-dialog.js';
import { BookModal, CompendiumModal, EntryModal, FilterListModal, refClick } from './compendium.js';

function useData(fn, deps) {
  const [state, setState] = useState({ loading: true, value: null });
  useEffect(() => {
    let alive = true;
    setState({ loading: true, value: null });
    fn().then(v => alive && setState({ loading: false, value: v }));
    return () => { alive = false; };
  }, deps);
  return state;
}

function undoToast(r) {
  if (!r.ok) return;
  const id = r.result?.undoId;
  toast(r.result?.toast || 'Fait', id ? { action: { label: 'Annuler', run: () => undo({ entryId: id }) } } : {});
}

function levelSchool(s) {
  const lvl = num(s.level);
  const base = lvl === 0 ? `${s.school || ''} cantrip` : `${ORDINAL[lvl]}-level ${s.school || ''}`;
  return `${base.trim()}${s.ritual ? ' (ritual)' : ''}`;
}

// Liens internes des descriptions 5etools : tout s'ouvre dans l'application (voir compendium.js).
function onRefClick(e) { refClick(e); }

function Entries({ entries }) {
  return html`<div class="entries" onClick=${onRefClick} dangerouslySetInnerHTML=${{ __html: renderEntries(entries) }}></div>`;
}

// ---------------------------------------------------------------- Sorts

// Ce que le joueur a écrit passe avant 5etools : nom, temps, portée, durée et description.
function SpellBody({ data, local }) {
  const [official, setOfficial] = useState(false);
  const own = k => (local && local[k] != null && local[k] !== '' ? local[k] : undefined);
  const s = { ...(data || {}), ...Object.fromEntries(['level', 'school', 'time', 'range', 'components', 'duration', 'concentration', 'ritual'].map(k => [k, own(k) ?? data?.[k]]).filter(([, v]) => v !== undefined)) };
  const ownText = local?.text && String(local.text).trim();
  if (ownText && !official) {
    const props = [['Casting Time', s.time], ['Range', s.range], ['Components', s.components], ['Duration', s.duration]].filter(([, v]) => v);
    return html`<div class="spell-detail">
      <p class="spell-sub">${levelSchool(s)}${s.concentration ? ' · concentration' : ''} · <span class="muted">texte du joueur</span></p>
      ${props.length ? html`<dl class="props">${props.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>` : null}
      <div class="entries"><p style="white-space:pre-wrap">${ownText}</p></div>
      ${data ? html`<button type="button" class="btn tiny ghost" onClick=${() => setOfficial(true)}>Voir le texte officiel</button>` : null}
    </div>`;
  }
  return html`<${SpellBodyOfficial} data=${data} local=${local} s=${s} back=${ownText ? () => setOfficial(false) : null} />`;
}

function SpellBodyOfficial({ data, local, s, back }) {
  const props = [
    ['Casting Time', s.time], ['Range', s.range], ['Components', s.components], ['Duration', s.duration],
  ].filter(([, v]) => v);
  return html`<div class="spell-detail">
    <p class="spell-sub">${levelSchool(s)}${s.concentration ? ' · concentration' : ''}${data?.source ? html` · <span class="muted">${data.source}${data.page ? ` p.${data.page}` : ''}</span>` : null}</p>
    ${props.length ? html`<dl class="props">${props.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>` : null}
    ${data ? html`<${Entries} entries=${data.entries} />` : local?.text ? html`<div class="entries"><p style="white-space:pre-wrap">${local.text}</p></div>` : null}
    ${data?.higher?.length ? html`<div class="higher"><${Entries} entries=${data.higher} /></div>` : null}
    ${data?.classes?.length ? html`<p class="muted small">Classes : ${data.classes.join(', ')}</p>` : null}
    ${back ? html`<button type="button" class="btn tiny ghost" onClick=${back}>Revenir au texte du joueur</button>` : null}
  </div>`;
}

function SpellModal({ id, spellId, edit = false }) {
  const doc = charDoc(id);
  const s = doc?.spells?.[spellId];
  const ro = !canEdit(id);
  const [editing, setEditing] = useState(edit);
  const d = useData(() => (s && !s.custom ? data5e.spell(s.name, s.source) : Promise.resolve(null)), [s?.name, s?.source]);
  if (!s) return html`<${Modal} title="Sort"><p>Sort supprimé.</p><//>`;
  // Remet le sort d'accord avec 5etools : nom exact, source, niveau, temps, portée…
  const refresh = async () => {
    const ch = await spellRefresh(s);
    if (!ch) { toast(t('{name} : introuvable dans 5etools. Corrige le nom ou passe-le en sort maison.', { name: s.name }), { kind: 'warn' }); return; }
    const keys = Object.keys(ch);
    if (!keys.length) { toast(t('{name} est déjà à jour', { name: s.name })); return; }
    setOps(id, keys.map(k => [['spells', spellId, k], ch[k]]));
    toast(t('{name} mis à jour depuis 5etools', { name: ch.name || s.name }));
  };
  const b = p => ({ value: s[p], ro, onCommit: v => setPath(id, ['spells', spellId, p], v) });
  const prepMode = isPreparedMode(doc);
  const remove = () => openModal({
    kind: 'confirm', title: t('Retirer {name} ?', { name: s.name }), text: 'Le sort sera retiré de la fiche (annulable).', ok: 'Retirer', danger: true,
    onOk: () => setPath(id, ['spells', spellId], undefined),
  });
  return html`<${Modal} title=${s.name} wide footer=${ro ? null : html`
      <button type="button" class="btn danger ghost" onClick=${remove}>${Icon.trash()} Retirer</button>
      <button type="button" class=${`btn ghost ${editing ? 'on' : ''}`} onClick=${() => setEditing(!editing)}>${Icon.pencil()} ${editing ? 'Terminer' : 'Modifier'}</button>
      ${s.custom ? null : html`<button type="button" class="btn ghost" title="Reprend nom, niveau, temps, portée, composantes et durée dans 5etools" onClick=${refresh}>Mettre à jour</button>`}
      <span class="grow"></span>
      <button type="button" class="btn primary" onClick=${() => openModal({ kind: 'cast', id, spellId })}>Lancer</button>`}>
    ${d.loading ? html`<p class="muted">Chargement…</p>` : html`<${SpellBody} data=${d.value} local=${s} />`}
    ${!d.loading && !d.value && !s.custom ? html`<p class="muted small">Description absente des données 5etools locales.</p>` : null}
    ${(s.custom || editing) && !ro ? html`<div class="custom-spell form-grid">
      <label>Nom <${Txt} ...${b('name')} /></label>
      <label>Source <${Txt} ...${b('source')} placeholder="XPHB, XGE, TCE…" /></label>
      <label class="check"><input type="checkbox" checked=${!!s.custom} onChange=${e => setPath(id, ['spells', spellId, 'custom'], e.target.checked)} /> Sort maison, sans 5etools</label>
      <label>Niveau <${Num} ...${b('level')} min=${0} max=${9} /></label>
      <label>École <${Txt} ...${b('school')} /></label>
      <label>Temps d'incantation <${Txt} ...${b('time')} /></label>
      <label>Portée <${Txt} ...${b('range')} /></label>
      <label>Composantes <${Txt} ...${b('components')} /></label>
      <label>Durée <${Txt} ...${b('duration')} /></label>
      <label class="check"><input type="checkbox" checked=${!!s.concentration} onChange=${e => setPath(id, ['spells', spellId, 'concentration'], e.target.checked)} /> Concentration</label>
      <label class="check"><input type="checkbox" checked=${!!s.ritual} onChange=${e => setPath(id, ['spells', spellId, 'ritual'], e.target.checked)} /> Rituel</label>
      <label class="span2">Description <small class="muted">ton texte remplace celui de 5etools à l'affichage ; vide, c'est le texte officiel</small> <${Txt} ...${b('text')} multiline /></label>
    </div>` : null}
    <div class="spell-own form-grid">
      ${num(s.level) > 0 ? html`
        ${prepMode ? html`<label class="check"><input type="checkbox" disabled=${ro || s.always} checked=${!!s.prepared}
          onChange=${e => setPath(id, ['spells', spellId, 'prepared'], e.target.checked)} /> Préparé</label>` : null}
        <label class="check"><input type="checkbox" disabled=${ro} checked=${!!s.always}
          onChange=${e => setPath(id, ['spells', spellId, 'always'], e.target.checked)} /> Gratuit : toujours prêt, ne compte pas dans la limite</label>` : html`
        <label class="check"><input type="checkbox" disabled=${ro} checked=${!!s.always}
          onChange=${e => setPath(id, ['spells', spellId, 'always'], e.target.checked)} /> Gratuit : ne compte pas dans les cantrips connus</label>`}
      <label>Obtenu par <select class="sel" disabled=${ro} value=${s.origin || ''} onChange=${e => setPath(id, ['spells', spellId, 'origin'], e.target.value || undefined)}>
        <option value="">La classe</option><option value="subclass">La sous-classe</option><option value="feat">Un don</option>
        <option value="species">L'espèce</option><option value="item">Un objet</option><option value="other">Autre</option></select></label>
      <label class="span2">Notes du joueur <${Txt} ...${b('notes')} multiline placeholder="Variante maison, composante, rappel…" /></label>
    </div>
  <//>`;
}

function SpellRefModal({ name, source, back }) {
  const d = useData(() => data5e.spell(name, source), [name, source]);
  return html`<${Modal} title=${d.value?.name || name} wide onClose=${back ? () => openModal(back) : closeModal}>
    ${d.loading ? html`<p class="muted">Chargement…</p>` : d.value ? html`<${SpellBody} data=${d.value} />` : html`<p class="muted">Sort absent des données 5etools locales.</p>`}
  <//>`;
}

function SpellSearch({ id }) {
  const doc = charDoc(id);
  const mainClass = (doc.classes || [])[0]?.name || '';
  const [q, setQ] = useState('');
  const [lvl, setLvl] = useState(null);
  const [cls, setCls] = useState(mainClass);
  const idx = useData(() => data5e.spells(), []);
  const have = new Set(Object.values(doc.spells || {}).map(s => fold(s.name)));
  const results = useMemo(() => {
    const list = idx.value || [];
    const fq = fold(q.trim());
    const seen = new Set();
    return list.filter(s => {
      if (lvl != null && s.level !== lvl) return false;
      if (cls && s.classes?.length && !s.classes.some(c => fold(c) === fold(cls))) return false;
      if (fq && !fold(s.name).includes(fq)) return false;
      const k = fold(s.name);
      if (seen.has(k)) return false; // une seule version par nom (source préférée en premier)
      seen.add(k);
      return true;
    }).slice(0, 80);
  }, [idx.value, q, lvl, cls]);

  const add = async s => {
    const det = await data5e.spell(s.name, s.source);
    const sp = {
      name: s.name, source: s.source, level: s.level, school: s.school, ritual: s.ritual, concentration: s.concentration,
      time: det?.time || '', range: det?.range || '', components: det?.components || '', duration: det?.duration || '',
      prepared: false, notes: '',
    };
    await setPath(id, ['spells', newId('s')], sp);
    toast(t('{name} ajouté', { name: s.name }));
  };
  const custom = () => {
    const sid = newId('s');
    setPath(id, ['spells', sid], { name: q.trim() || 'Nouveau sort', custom: true, level: lvl ?? 1, school: '', prepared: false, notes: '', text: '' });
    openModal({ kind: 'spell', id, spellId: sid });
  };
  const classes = [...new Set((idx.value || []).flatMap(s => s.classes || []))].sort();
  // Classe maison (Pugilist…) absente des listes 5etools : on cherche dans toutes les classes.
  useEffect(() => { if (cls && classes.length && !classes.some(c => fold(c) === fold(cls))) setCls(''); }, [classes.length]);

  return html`<${Modal} title="Ajouter un sort" wide>
    <div class="search-bar">
      <input class="txt search" type="search" placeholder="Rechercher un sort…" value=${q} onInput=${e => setQ(e.target.value)} ref=${focusOnce} />
      <select class="sel" value=${cls} onChange=${e => setCls(e.target.value)}>
        <option value="">Toutes les classes</option>
        ${classes.map(c => html`<option value=${c}>${c}</option>`)}
      </select>
    </div>
    <div class="chips lvl-chips">
      ${[null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => html`<button type="button" class=${`chip-btn ${lvl === l ? 'on' : ''}`} onClick=${() => setLvl(l)}>${l == null ? 'Tous' : l === 0 ? 'Cantrip' : l}</button>`)}
    </div>
    ${idx.loading ? html`<p class="muted">Chargement des sorts…</p>`
      : !(idx.value || []).length ? html`<p class="muted">Aucune donnée 5etools trouvée sur le portable. Tu peux créer un sort personnalisé.</p>` : null}
    <div class="results">
      ${results.map(s => html`<div class="res" key=${s.name + s.source}>
        <button type="button" class="linkish" onClick=${() => openModal({ kind: 'spellRef', name: s.name, source: s.source, back: { kind: 'spellSearch', id } })}>${s.name}</button>
        <span class="muted small">${s.level === 0 ? 'Cantrip' : `Niv. ${s.level}`} · ${s.school}${s.concentration ? ' · C' : ''}${s.ritual ? ' · R' : ''} · ${s.source}</span>
        ${have.has(fold(s.name)) ? html`<span class="badge">sur la fiche</span>` : html`<button type="button" class="btn tiny" onClick=${() => add(s)}>${Icon.plus()} Ajouter</button>`}
      </div>`)}
    </div>
    <div class="modal-actions"><button type="button" class="btn" onClick=${custom}>${Icon.plus()} Sort personnalisé${q.trim() ? ` « ${q.trim()} »` : ''}</button></div>
  <//>`;
}

function CastModal({ id, spellId }) {
  const doc = charDoc(id);
  const s = doc?.spells?.[spellId];
  if (!s) return null;
  const lvl = num(s.level);
  const opts = lvl === 0 ? [] : availableSlotLevels(doc, lvl);
  const conc = doc.concentration;
  const breaks = s.concentration && conc && conc.spellId !== spellId;
  const ready = spellReady(doc, s);
  const cast = args => act('castSpell', { spellId, ...args }).then(r => { if (r.ok) { closeModal(); undoToast(r); } });
  return html`<${Modal} title=${`Lancer ${s.name}`}>
    ${breaks ? html`<div class="alert warn">${Icon.info()} Tu te concentres déjà sur <b>${conc.name}</b>. Lancer ${s.name} y mettra fin.</div>` : null}
    ${!ready ? html`<div class="alert">${Icon.info()} Ce sort n'est pas préparé.${s.ritual ? ' Il peut être lancé en rituel.' : ''}</div>` : null}
    ${lvl === 0 ? html`<button type="button" class="btn primary block" onClick=${() => cast({})}>Lancer le cantrip</button>` : null}
    ${lvl > 0 ? html`<div class="slot-choices">
      ${opts.map(o => html`<button type="button" class=${`btn block ${o.pact ? 'pact' : ''}`} onClick=${() => cast(o.pact ? { pact: true } : { slotLevel: o.level })}>
        ${o.pact ? `Pact Magic · niveau ${o.level}` : `Emplacement de niveau ${o.level}`}${o.level > lvl ? ' (niveau supérieur)' : ''}
        <span class="muted"> · ${o.left} restant${o.left > 1 ? 's' : ''}</span>
      </button>`)}
      ${opts.length ? null : html`<p class="muted">Aucun emplacement de niveau ${lvl} ou plus disponible.</p>`}
    </div>` : null}
    ${s.ritual ? html`<button type="button" class="btn block ghost" onClick=${() => cast({ ritual: true })}>En rituel : +10 minutes, sans emplacement</button>` : null}
  <//>`;
}

// ---------------------------------------------------------------- Repos

function ShortRest({ id }) {
  const doc = charDoc(id);
  const [rolls, setRolls] = useState([]);
  const [arcane, setArcane] = useState([]);
  const con = abilityMod(doc, 'con');
  const dice = hitDiceOf(doc).map(d => ({ ...d, left: d.max - d.used - rolls.filter(r => r.die === d.die).length }));
  const healed = rolls.reduce((s, r) => s + Math.max(0, r.roll + con), 0);
  const hp = doc.hp;
  const after = Math.min(num(hp.max), num(hp.current) + healed);
  const ar = Object.values(doc.resources || {}).find(r => classKey(r.name) === 'arcane recovery');
  const wiz = classLevel(doc, 'wizard');
  const arCap = Math.ceil(Math.max(1, wiz) / 2);
  const arUsed = arcane.reduce((a, b) => a + b, 0);
  const canArcane = ar && num(ar.used) < num(ar.max) && wiz > 0;
  const spent = [];
  for (let l = 1; l <= 5; l++) {
    const s = doc.spellcasting.slots[l];
    const n = num(s?.used) - arcane.filter(x => x === l).length;
    if (n > 0) spent.push(l);
  }
  const recharge = itemList(doc.resources).filter(r => (r.reset === 'short' || r.reset === 'short1') && num(r.used) > 0).map(r => r.name);
  if (num(doc.spellcasting.pact?.max) && num(doc.spellcasting.pact.used)) recharge.push('Pact Magic');

  const roll = d => {
    const v = rollDie(d.size);
    setRolls([...rolls, { die: d.die, roll: v }]);
    showRoll({ label: `Hit Die ${d.die}`, total: Math.max(0, v + con), detail: `${d.die} (${v})${con ? ` ${con >= 0 ? '+' : '−'} ${Math.abs(con)} CON` : ''}` });
  };
  const finish = () => act('shortRest', { hitDice: rolls, arcane }).then(r => { if (r.ok) { closeModal(); undoToast(r); } });

  return html`<${Modal} title="Short Rest" footer=${html`<button type="button" class="btn" onClick=${closeModal}>Annuler</button><span class="grow"></span><button type="button" class="btn primary" onClick=${finish}>Terminer le repos court</button>`}>
    <h4>Hit Dice <span class="muted small">· dé + CON ${signed(con)}</span></h4>
    <div class="hd-roll">
      ${dice.map(d => html`<button type="button" class="btn" disabled=${d.left <= 0} onClick=${() => roll(d)}>${Icon.d20()} Lancer un ${d.die} <span class="muted">(${d.left} restant${d.left > 1 ? 's' : ''})</span></button>`)}
    </div>
    ${rolls.length ? html`<ul class="roll-list">${rolls.map((r, i) => html`<li key=${i}>${r.die} : ${r.roll}${con ? ` ${con >= 0 ? '+' : '−'} ${Math.abs(con)}` : ''} = <b>${Math.max(0, r.roll + con)} PV</b>
      <button type="button" class="icon-btn faint" onClick=${() => setRolls(rolls.filter((_, j) => j !== i))} aria-label="Retirer">${Icon.close()}</button></li>`)}</ul>` : null}
    <p class="hp-preview">HP ${num(hp.current)} → <b>${after}</b> / ${num(hp.max)}</p>
    ${canArcane ? html`<h4>Arcane Recovery <span class="muted small">· jusqu'à ${arCap} niveaux d'emplacement, niveau 5 max</span></h4>
      <div class="chips">
        ${spent.map(l => html`<button type="button" class="chip-btn" disabled=${arUsed + l > arCap} onClick=${() => setArcane([...arcane, l])}>+ niv. ${l}</button>`)}
        ${spent.length ? null : html`<span class="muted">Aucun emplacement dépensé.</span>`}
      </div>
      ${arcane.length ? html`<p>Récupère : ${arcane.map((l, i) => html`<button type="button" class="chip-btn on" onClick=${() => setArcane(arcane.filter((_, j) => j !== i))}>niv. ${l} ×</button>`)} <span class="muted">(${arUsed}/${arCap})</span></p>` : null}` : null}
    <p class="muted">${recharge.length ? `Se recharge : ${recharge.join(', ')}.` : 'Aucune ressource de repos court à recharger.'}</p>
  <//>`;
}

function LongRest({ id }) {
  const doc = charDoc(id);
  const half = store.config.rules?.longRestHitDice !== 'all';
  const total = hitDiceOf(doc).reduce((s, d) => s + d.max, 0);
  const finish = () => act('longRest').then(r => { if (r.ok) { closeModal(); undoToast(r); } });
  return html`<${Modal} title="Long Rest" footer=${html`<button type="button" class="btn" onClick=${closeModal}>Annuler</button><span class="grow"></span><button type="button" class="btn primary" onClick=${finish}>Terminer le repos long</button>`}>
    <ul class="effects">
      <li>HP au maximum (${num(doc.hp.max)}), HP temporaires à 0</li>
      <li>Tous les emplacements de sorts${num(doc.spellcasting.pact?.max) ? ' et de Pact Magic' : ''} rechargés</li>
      <li>${half ? `Récupère ${Math.max(1, Math.floor(total / 2))} Hit Dice (la moitié)` : 'Récupère tous les Hit Dice'}</li>
      <li>Ressources de repos court et long rechargées</li>
      ${num(doc.exhaustion) ? html`<li>Exhaustion ${num(doc.exhaustion)} → ${num(doc.exhaustion) - 1}</li>` : null}
      <li>Jets de mort remis à zéro</li>
    </ul>
    <p class="muted small">Annulable juste après, depuis la notification.</p>
  <//>`;
}

// ---------------------------------------------------------------- Classes

function ClassesModal({ id }) {
  const doc = charDoc(id);
  const ro = !canEdit(id);
  const [rows, setRows] = useState(() => clone(doc.classes || []));
  const upd = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = async () => {
    const clean = rows.filter(r => r.name.trim()).map(r => ({ ...r, name: r.name.trim(), level: Math.max(1, num(r.level, 1)), hitDie: num(r.hitDie) || HIT_DIE[classKey(r.name)] || 8 }));
    const ops = [[['classes'], clean.length ? clean : [{ name: '', subclass: '', level: 1 }]]];
    const k = classKey(clean[0]?.name);
    if (k && SPELLCASTING_DEFAULTS[k] && doc.spellcasting.mode === 'none' && k !== 'fighter' && k !== 'rogue') {
      ops.push([['spellcasting', 'ability'], SPELLCASTING_DEFAULTS[k].ability], [['spellcasting', 'mode'], SPELLCASTING_DEFAULTS[k].mode]);
    }
    await setOps(id, ops);
    if (doc.spellcasting.slotsAuto !== false) await act('autoSlots', {}, id);
    closeModal();
  };
  return html`<${Modal} title="Classes" footer=${ro ? null : html`
      <button type="button" class="btn" onClick=${() => setRows([...rows, { name: '', subclass: '', level: 1 }])}>${Icon.plus()} Multiclasse</button>
      <span class="grow"></span><button type="button" class="btn primary" onClick=${save}>Enregistrer</button>`}>
    <datalist id="class-list">${Object.keys(HIT_DIE).map(k => html`<option value=${k[0].toUpperCase() + k.slice(1)} />`)}</datalist>
    ${rows.map((r, i) => html`<div class="class-row" key=${i}>
      <label>Classe <input class="txt" list="class-list" readOnly=${ro} value=${r.name} onInput=${e => upd(i, 'name', e.target.value)} /></label>
      <label>Sous-classe <input class="txt" readOnly=${ro} value=${r.subclass || ''} onInput=${e => upd(i, 'subclass', e.target.value)} /></label>
      <label>Niveau <input class="num" inputMode="numeric" readOnly=${ro} value=${r.level} onInput=${e => upd(i, 'level', e.target.value)} /></label>
      <label>Dé de vie <select class="sel" disabled=${ro} value=${num(r.hitDie) || HIT_DIE[classKey(r.name)] || 8} onChange=${e => upd(i, 'hitDie', Number(e.target.value))}>
        ${[6, 8, 10, 12].map(d => html`<option value=${d}>d${d}</option>`)}</select></label>
      ${!ro && rows.length > 1 ? html`<button type="button" class="icon-btn faint" onClick=${() => setRows(rows.filter((_, j) => j !== i))} aria-label="Retirer">${Icon.trash()}</button>` : null}
    </div>`)}
    ${ro ? null : html`<p class="muted small">Pour monter de niveau avec PV et emplacements calculés, utilise plutôt « Level up » sur la page Combat.</p>`}
  <//>`;
}

// ---------------------------------------------------------------- Conditions

function ConditionModal({ name, id }) {
  const d = useData(() => data5e.condition(name), [name]);
  const local = CONDITIONS.find(c => c.name.toLowerCase() === String(name).toLowerCase());
  const doc = id ? charDoc(id) : null;
  const ro = !id || !canEdit(id);
  const has = doc?.conditions?.includes(name);
  return html`<${Modal} title=${name} footer=${!ro && has ? html`<span class="grow"></span><button type="button" class="btn" onClick=${() => { setPath(id, ['conditions'], doc.conditions.filter(c => c !== name)); closeModal(); }}>Retirer la condition</button>` : null}>
    ${d.loading ? html`<p class="muted">Chargement…</p>` : d.value ? html`<${Entries} entries=${d.value.entries} /><p class="muted small">${d.value.source}</p>`
      : local ? html`<div class="entries"><p>${local.text}</p></div>` : html`<p class="muted">Pas de texte pour cette condition.</p>`}
    ${String(name).toLowerCase() === 'unconscious' || String(name).toLowerCase() === 'exhaustion' ? html`<p class="muted small">${name === 'Exhaustion' ? EXHAUSTION_TEXT : ''}</p>` : null}
  <//>`;
}

// ---------------------------------------------------------------- Objets

function ItemModal({ docId, itemId, stash }) {
  const doc = stash ? store.party.data : charDoc(docId);
  const coll = stash ? doc?.stash : doc?.inventory;
  const it = coll?.[itemId];
  const ro = stash ? !canPartyAct() : !canEdit(docId);
  const d = useData(() => (it ? data5e.item(it.name, it.source) : Promise.resolve(null)), [it?.name, it?.source]);
  if (!it) return html`<${Modal} title="Objet"><p>Objet déplacé ou supprimé.</p><//>`;
  const base = stash ? ['stash', itemId] : ['inventory', itemId];
  const b = p => ({ value: it[p], ro, onCommit: v => setPath(docId, [...base, p], v) });
  const remove = () => openModal({
    kind: 'confirm', title: `Supprimer ${it.name} ?`, text: stash ? 'Retiré de la réserve (noté dans le journal).' : 'Supprimé de ton inventaire (annulable).', ok: 'Supprimer', danger: true,
    onOk: () => (stash ? act('stashRemove', { itemId }) : setPath(docId, base, undefined)),
  });
  const dv = d.value;
  return html`<${Modal} title=${it.name || 'Objet'} wide footer=${ro ? null : html`<button type="button" class="btn danger ghost" onClick=${remove}>${Icon.trash()} Supprimer</button><span class="grow"></span>
      <button type="button" class="btn" onClick=${() => openModal({ kind: 'give', from: stash ? 'stash' : docId, itemId })}>${Icon.gift()} ${stash ? 'Prendre / donner' : 'Donner'}</button>`}>
    ${dv ? html`<p class="spell-sub">${[dv.type, dv.rarity, dv.attunement].filter(Boolean).join(' · ')}<span class="muted">· ${dv.source}</span></p>
      ${dv.dmg ? html`<p><b>Dégâts :</b> ${dv.dmg}</p>` : null}${dv.ac ? html`<p><b>AC :</b> ${dv.ac}</p>` : null}
      <${Entries} entries=${dv.entries} />` : d.loading ? html`<p class="muted">Chargement…</p>` : null}
    <div class="form-grid">
      <label>Nom <${Txt} ...${b('name')} /></label>
      <label>Quantité <${Num} ...${b('qty')} min=${0} max=${999999} /></label>
      <label>Charges max <${Num} value=${num(it.charges?.max)} ro=${ro} min=${0} max=${99}
        onCommit=${v => setPath(docId, [...base, 'charges'], v > 0 ? { max: v, used: Math.min(num(it.charges?.used), v) } : undefined)} /></label>
      ${stash ? null : html`
        <label class="check"><input type="checkbox" disabled=${ro} checked=${!!it.attunement} onChange=${e => setPath(docId, [...base, 'attunement'], e.target.checked)} /> Harmonisation requise</label>
        <label class="check"><input type="checkbox" disabled=${ro || !it.attunement} checked=${!!it.attuned} onChange=${e => setPath(docId, [...base, 'attuned'], e.target.checked)} /> Harmonisé (max 3)</label>
        <label class="check"><input type="checkbox" disabled=${ro} checked=${!!it.consumable} onChange=${e => setPath(docId, [...base, 'consumable'], e.target.checked)} /> Consommable (bouton Utiliser)</label>
        <label class="check"><input type="checkbox" disabled=${ro} checked=${!!it.equipped} onChange=${e => setPath(docId, [...base, 'equipped'], e.target.checked)} /> Équipé</label>
        <label class="check"><input type="checkbox" disabled=${ro} checked=${!!it.stored} onChange=${e => setPath(docId, [...base, 'stored'], e.target.checked)} /> Rangé ailleurs, poids non compté</label>`}
      <label class="span2">Notes <${Txt} ...${b('notes')} multiline /></label>
    </div>
  <//>`;
}

function ItemRefModal({ name, source, back }) {
  const d = useData(() => data5e.item(name, source), [name, source]);
  const dv = d.value;
  return html`<${Modal} title=${dv?.name || name} wide onClose=${back ? () => openModal(back) : closeModal}>
    ${d.loading ? html`<p class="muted">Chargement…</p>` : dv ? html`<p class="spell-sub">${[dv.type, dv.rarity, dv.attunement].filter(Boolean).join(' · ')} <span class="muted">· ${dv.source}</span></p><${Entries} entries=${dv.entries} />`
      : html`<p class="muted">Objet absent des données 5etools locales.</p>`}
  <//>`;
}

function ItemSearch({ target }) {
  const [q, setQ] = useState('');
  const idx = useData(() => data5e.items(), []);
  const results = useMemo(() => {
    const fq = fold(q.trim());
    if (fq.length < 2) return [];
    const seen = new Set();
    return (idx.value || []).filter(it => {
      const k = fold(it.name);
      if (!k.includes(fq) || seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 60);
  }, [idx.value, q]);
  const add = it => {
    const item = { name: it.name, source: it.source, qty: 1, notes: '' };
    if (it.attunement) item.attunement = true;
    if (it.rarity) item.rarity = it.rarity;
    if (it.charges) item.charges = { max: it.charges, used: 0 };
    if (/potion|scroll|ammunition|^P$/i.test(it.type) || /potion|scroll/i.test(it.name)) item.consumable = true;
    if (target === 'stash') act('stashAdd', { item }).then(r => r.ok && toast(t('{name} ajouté à la réserve', { name: it.name })));
    else {
      const inv = charDoc(target)?.inventory || {};
      item.order = Object.values(inv).reduce((m, x) => Math.max(m, num(x.order)), -1) + 1;
      setPath(target, ['inventory', newId('i')], item).then(() => toast(t('{name} ajouté', { name: it.name })));
    }
  };
  return html`<${Modal} title=${target === 'stash' ? 'Ajouter à la réserve' : 'Ajouter un objet'} wide>
    <input class="txt search" type="search" placeholder="Rechercher un objet (2 lettres min.)…" value=${q} onInput=${e => setQ(e.target.value)} ref=${focusOnce} />
    ${idx.loading ? html`<p class="muted">Chargement…</p>` : !(idx.value || []).length ? html`<p class="muted">Aucune donnée 5etools d'objets sur le portable.</p>` : null}
    <div class="results">
      ${results.map(it => html`<div class="res" key=${it.name + it.source}>
        <button type="button" class="linkish" onClick=${() => openModal({ kind: 'itemRef', name: it.name, source: it.source, back: { kind: 'itemSearch', target } })}>${it.name}</button>
        <span class="muted small">${[it.rarity, it.attunement ? 'harmonisation' : '', it.source].filter(Boolean).join(' · ')}</span>
        <button type="button" class="btn tiny" onClick=${() => add(it)}>${Icon.plus()} Ajouter</button>
      </div>`)}
    </div>
  <//>`;
}

function GiveModal({ from, itemId }) {
  const src = from === 'stash' ? store.party.data.stash : charDoc(from)?.inventory;
  const it = src?.[itemId];
  const [qty, setQty] = useState(1);
  if (!it) return html`<${Modal} title="Donner"><p>Objet introuvable.</p><//>`;
  const max = Math.max(1, num(it.qty, 1));
  const me = myCharId();
  const targets = [...charIds().filter(id => id !== from).map(id => ({ id, name: id === me ? `${charDoc(id).name} (moi)` : charDoc(id).name }))];
  if (from !== 'stash') targets.push({ id: 'stash', name: 'Réserve du groupe' });
  const give = to => act('transfer', { from, to, itemId, qty }).then(r => { if (r.ok) { closeModal(); toast(r.result?.toast); } });
  return html`<${Modal} title=${`${from === 'stash' ? 'Prendre / donner' : 'Donner'} : ${it.name}`}>
    ${max > 1 ? html`<div class="qty-pick">Quantité
      <button type="button" class="btn tiny" onClick=${() => setQty(Math.max(1, qty - 1))}>${Icon.minus()}</button>
      <b>${qty}</b> / ${max}
      <button type="button" class="btn tiny" onClick=${() => setQty(Math.min(max, qty + 1))}>${Icon.plus()}</button>
      <button type="button" class="btn tiny ghost" onClick=${() => setQty(max)}>Tout</button></div>` : null}
    ${it.attuned ? html`<p class="alert">${Icon.info()} L'harmonisation se perd en donnant l'objet.</p>` : null}
    <div class="give-list">${targets.map(t => html`<button type="button" class="btn block" onClick=${() => give(t.id)}>→ ${t.name}</button>`)}</div>
    <p class="muted small">Chaque mouvement est noté dans le journal du groupe.</p>
  <//>`;
}

function MoneyModal({ id, mode }) {
  const denoms = denomsAsc(store.config.currency).reverse();
  const [amount, setAmount] = useState('');
  const [denom, setDenom] = useState(denoms.find(d => d.key === 'pa')?.key || denoms[0].key);
  const go = () => act(mode, { amount: parseInt(amount, 10), denom }, id).then(r => { if (r.ok) { closeModal(); toast(mode === 'pay' ? 'Payé, monnaie rendue' : 'Ajouté à la bourse'); } });
  return html`<${Modal} title=${mode === 'pay' ? 'Payer' : 'Recevoir'} footer=${html`<span class="grow"></span><button type="button" class="btn primary" onClick=${go}>${mode === 'pay' ? 'Payer' : 'Ajouter'}</button>`}>
    <div class="money-row">
      <input class="num big" inputMode="numeric" value=${amount} onInput=${e => setAmount(e.target.value)} ref=${focusOnce} onKeyDown=${e => e.key === 'Enter' && go()} />
      <select class="sel" value=${denom} onChange=${e => setDenom(e.target.value)}>${denoms.map(d => html`<option value=${d.key}>${d.label}</option>`)}</select>
    </div>
    ${mode === 'pay' ? html`<p class="muted small">Paie d'abord avec cette pièce, puis les plus grosses ; la monnaie est rendue automatiquement.</p>` : null}
  <//>`;
}

function FundModal({ mode }) {
  const denoms = denomsAsc(store.config.currency).reverse();
  const [p, setP] = useState({});
  const me = actorId();
  const purse = mode === 'deposit' ? charDoc(me)?.currency || {} : store.party.data.fund || {};
  const go = () => act(mode, { charId: me, purse: p }).then(r => { if (r.ok) { closeModal(); toast(mode === 'deposit' ? 'Versé au fonds commun' : 'Retiré du fonds commun'); } });
  return html`<${Modal} title=${mode === 'deposit' ? 'Verser au fonds commun' : 'Prendre dans le fonds commun'} footer=${html`<span class="grow"></span><button type="button" class="btn primary" onClick=${go}>Valider</button>`}>
    ${denoms.map(d => html`<label class="money-row" key=${d.key}><span class="coin-l">${d.label}</span>
      <input class="num" inputMode="numeric" value=${p[d.key] || ''} placeholder="0" onInput=${e => setP({ ...p, [d.key]: parseInt(e.target.value, 10) || 0 })} />
      <span class="muted small">dispo : ${num(purse[d.key])}</span></label>`)}
  <//>`;
}

function MoveLog() {
  const log = Object.values(store.party.data.log || {}).sort((a, b) => num(b.at) - num(a.at));
  return html`<${Modal} title="Journal des mouvements" wide>
    ${log.length ? html`<ul class="move-log">${log.map(e => html`<li><span class="muted">${new Date(e.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span> · <b>${e.who}</b> · ${e.text}</li>`)}</ul>` : html`<p class="muted">Aucun mouvement pour l'instant.</p>`}
  <//>`;
}

// ---------------------------------------------------------------- Réglages de fiche

function SettingsModal({ id }) {
  const doc = charDoc(id);
  const ro = !canEdit(id);
  const sc = doc.spellcasting;
  const b = p => ({ value: p.reduce((o, k) => o?.[k], doc), ro, onCommit: v => setPath(id, p, v) });
  const exportJson = async () => {
    const res = await fetch(`/api/c/${currentCampaign()}/characters/${id}/json`, { headers: { Authorization: `Bearer ${store.token}` } });
    if (!res.ok) return toast('Export impossible', { kind: 'error' });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(doc.name || 'personnage').replace(/[^\w\- ]+/g, '')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  // Le fichier est vérifié d'abord ; il remplace toute la fiche, annulable avec ↶.
  const importJson = e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    importSheetFile(f, {
      currency: store.config.currency, title: t('Remplacer ta fiche ?'), okLabel: t('Remplacer la fiche'),
      onImport: data => api(`/api/c/${currentCampaign()}/characters/${id}`, { method: 'PUT', body: data }).then(() => toast(t('Fiche importée · ↶ pour annuler'))).catch(err => toast(err.message, { kind: 'error' })),
    });
  };
  return html`<${Modal} title="Réglages de la fiche" wide>
    <h4>Spellcasting</h4>
    <div class="form-grid">
      <label>Caractéristique <select class="sel" disabled=${ro} value=${sc.ability} onChange=${e => setPath(id, ['spellcasting', 'ability'], e.target.value)}>
        ${['int', 'wis', 'cha'].map(a => html`<option value=${a}>${ABILITY_SHORT[a]}</option>`)}</select></label>
      <label>Mode <select class="sel" disabled=${ro} value=${sc.mode} onChange=${e => setPath(id, ['spellcasting', 'mode'], e.target.value)}>
        <option value="prepared">Préparés (grimoire, Wizard)</option><option value="known">Connus (Warlock)</option><option value="none">Pas de sorts</option></select></label>
      <label>Bonus au DD <${Num} ...${b(['spellcasting', 'dcBonus'])} min=${-10} max=${10} /></label>
      <label>Bonus d'attaque de sort <${Num} ...${b(['spellcasting', 'attackBonus'])} min=${-10} max=${10} /></label>
      <label>Limite de sorts préparés <${Num} ...${b(['spellcasting', 'prepCapOverride'])} allowEmpty min=${0} max=${50} placeholder=${`auto : ${preparedCap({ ...doc, spellcasting: { ...sc, prepCapOverride: null } })}`} /></label>
      <label class="check"><input type="checkbox" disabled=${ro} checked=${sc.slotsAuto !== false} onChange=${e => e.target.checked ? act('autoSlots', {}, id) : setPath(id, ['spellcasting', 'slotsAuto'], false)} /> Emplacements calculés selon la classe</label>
    </div>
    <h4>Bonus</h4>
    <div class="form-grid">
      <label>Proficiency Bonus forcé <${Num} ...${b(['profOverride'])} allowEmpty min=${0} max=${10} placeholder=${`auto : ${signed(2 + Math.floor((totalLevel(doc) - 1) / 4))}`} /></label>
      <label>Bonus à tous les jets de sauvegarde <${Num} ...${b(['saveBonus'])} min=${-10} max=${10} /></label>
      <label>Bonus d'initiative <${Num} ...${b(['initiativeBonus'])} min=${-10} max=${20} /></label>
    </div>
    <h4>Fichier JSON</h4>
    <div class="row-btns">
      <button type="button" class="btn" onClick=${exportJson}>Exporter la fiche en JSON</button>
      ${ro ? null : html`<label class="btn">Importer un JSON… <input type="file" accept="application/json,.json" hidden onChange=${importJson} /></label>`}
    </div>
    ${ro ? null : html`<p class="muted small">Pour écrire une fiche à la main ou avec une IA : copie le modèle, ou la consigne complète à coller dans l'IA avant de décrire le personnage. L'import vérifie le fichier avant de remplacer quoi que ce soit.</p>
    <div class="row-btns"><${SheetTemplateButtons} currency=${store.config.currency} edition=${doc.edition} /></div>`}
  <//>`;
}

function ConfirmModal({ title, text, ok = 'Confirmer', danger, onOk }) {
  return html`<${Modal} title=${title} footer=${html`<button type="button" class="btn" onClick=${closeModal}>Annuler</button><span class="grow"></span>
    <button type="button" class=${`btn ${danger ? 'danger' : 'primary'}`} onClick=${() => { closeModal(); onOk?.(); }}>${ok}</button>`}>
    <p>${text}</p>
  <//>`;
}

export function ModalHost() {
  const m = store.ui.modal;
  if (!m) return null;
  switch (m.kind) {
    case 'confirm': return html`<${ConfirmModal} ...${m} />`;
    case 'sheetCheck': return html`<${SheetCheckModal} ...${m} />`;
    case 'spell': return html`<${SpellModal} ...${m} />`;
    case 'spellRef': return html`<${SpellRefModal} ...${m} />`;
    case 'spellSearch': return html`<${SpellSearch} ...${m} />`;
    case 'cast': return html`<${CastModal} ...${m} />`;
    case 'shortRest': return html`<${ShortRest} ...${m} />`;
    case 'longRest': return html`<${LongRest} ...${m} />`;
    case 'levelUp': return html`<${LevelUp} ...${m} />`;
    case 'classes': return html`<${ClassesModal} ...${m} />`;
    case 'condition': return html`<${ConditionModal} ...${m} />`;
    case 'item': return html`<${ItemModal} ...${m} />`;
    case 'itemRef': return html`<${ItemRefModal} ...${m} />`;
    case 'itemSearch': return html`<${ItemSearch} ...${m} />`;
    case 'give': return html`<${GiveModal} ...${m} />`;
    case 'money': return html`<${MoneyModal} ...${m} />`;
    case 'fund': return html`<${FundModal} ...${m} />`;
    case 'moveLog': return html`<${MoveLog} />`;
    case 'settings': return html`<${SettingsModal} ...${m} />`;
    case 'feature': return charDoc(m.id) ? html`<${FeatureModal} key=${m.fid || 'new'} ...${m} doc=${charDoc(m.id)} />` : null;
    case 'featureImport': return charDoc(m.id) ? html`<${FeatureImportModal} ...${m} doc=${charDoc(m.id)} />` : null;
    case 'learnScroll': return html`<${LearnScrollModal} key=${m.itemId} ...${m} />`;
    case 'newChar': return html`<${CharacterCreator} cid=${currentCampaign()} onClose=${closeModal} onDone=${closeModal} />`;
    case 'compendium': return html`<${CompendiumModal} ...${m} />`;
    case 'entry': return html`<${EntryModal} ...${m} />`;
    case 'filterList': return html`<${FilterListModal} ...${m} />`;
    case 'book': return html`<${BookModal} ...${m} />`;
    default: return null;
  }
}

