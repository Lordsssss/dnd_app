// Parchemins de sort dans l'inventaire : apprendre le sort qu'ils portent.
// Règle 2024 (Dungeon Master's Guide) : un Wizard copie un sort de parchemin dans son grimoire
// avec un test d'Intelligence (Arcana) DD 10 + niveau du sort ; réussi ou raté, le parchemin
// est détruit. Le Player's Handbook ajoute 2 heures et 50 gp par niveau du sort.
// Pour une autre classe, le MJ décide : la fenêtre le dit et laisse ajouter le sort quand même.
import { html, useEffect, useMemo, useState } from './html.js';
import { charDoc, closeModal, setOps, toast } from './store.js';
import { Modal } from './ui.js';
import { Icon } from './icons.js';
import { data5e, fold } from './data.js';
import { rollD20 } from './dice.js';
import { classLevel, num, signed, skillBonus } from '/shared/rules.js';
import { newId } from '/shared/patch.js';
import { t } from '/shared/i18n.js';

export const isScroll = it => /\b(scroll|parchemin)\b/i.test(String(it?.name || ''));

// « Spell Scroll (Fireball) », « Scroll of Fireball », « Parchemin de Fireball » → « Fireball ».
// Un parchemin générique, « Spell Scroll (Level 3) », ne dit pas son sort : null.
export function scrollSpellName(name) {
  const s = String(name || '').trim();
  const generic = /^(?:level|niveau)\s*\d|^\d+(?:st|nd|rd|th)?[\s-]*level|^cantrip|^tour de magie/i;
  const pick = v => (v && !generic.test(v.trim()) ? v.trim() : null);
  let m = /\(([^)]+)\)\s*$/.exec(s);
  if (m) return pick(m[1]);
  m = /(?:scroll of|scroll:|parchemin(?: de sort)? (?:de|d'|du|:)\s*)\s*(.+)$/i.exec(s);
  if (m) return pick(m[1]);
  return null;
}

export function LearnScrollModal({ id, itemId }) {
  const doc = charDoc(id);
  const item = doc?.inventory?.[itemId];
  const [q, setQ] = useState(() => scrollSpellName(item?.name) || '');
  const [chosen, setChosen] = useState(null);
  const [index, setIndex] = useState([]);
  const [roll, setRoll] = useState(null);
  useEffect(() => { data5e.spells().then(setIndex); }, []);
  // Le sort du parchemin, trouvé par son nom ; sinon on le cherche dans la liste.
  useEffect(() => {
    if (chosen || !index.length) return;
    const want = fold(scrollSpellName(item?.name) || '');
    const hit = want && index.find(s => fold(s.name) === want);
    if (hit) setChosen(hit);
  }, [index.length]);
  const hits = useMemo(() => {
    const f = fold(q.trim());
    if (f.length < 2 || chosen) return [];
    const seen = new Set();
    return index.filter(s => fold(s.name).includes(f) && !seen.has(fold(s.name)) && seen.add(fold(s.name))).slice(0, 12);
  }, [q, index, chosen]);
  if (!doc || !item) return html`<${Modal} title=${t('Parchemin')}><p>${t('Objet introuvable.')}</p><//>`;

  const wizard = classLevel(doc, 'wizard') > 0;
  const known = chosen && Object.values(doc.spells || {}).some(s => fold(s.name) === fold(chosen.name));
  const dc = chosen ? 10 + num(chosen.level) : null;
  const arcana = skillBonus(doc, 'arcana');

  // Le parchemin : une unité de moins, ou la ligne retirée.
  const consumeOps = () => (num(item.qty, 1) > 1 ? [[['inventory', itemId, 'qty'], num(item.qty, 1) - 1]] : [[['inventory', itemId]]]);
  const learn = async consume => {
    const det = await data5e.spell(chosen.name, chosen.source);
    const sp = {
      name: chosen.name, source: chosen.source, level: chosen.level, school: chosen.school, ritual: chosen.ritual, concentration: chosen.concentration,
      time: det?.time || '', range: det?.range || '', components: det?.components || '', duration: det?.duration || '',
      prepared: false, notes: t('Appris d\'un parchemin'),
    };
    await setOps(id, [[['spells', newId('s')], sp], ...(consume ? consumeOps() : [])]);
    toast(t('{name} ajouté à la fiche', { name: chosen.name }));
    closeModal();
  };
  const fail = async () => {
    await setOps(id, consumeOps());
    toast(t('Copie ratée : le parchemin est détruit'));
    closeModal();
  };
  const doRoll = () => { const r = rollD20(t('Arcana : copier {name}', { name: chosen.name }), arcana); if (r) setRoll(r.total); };

  return html`<${Modal} title=${t('Apprendre un sort de parchemin')} wide>
    <p class="muted small">${item.name}</p>
    ${chosen ? html`<div class="scroll-spell">
        <b>${chosen.name}</b> <span class="muted">${chosen.level ? t('niveau {n}', { n: chosen.level }) : 'cantrip'}${chosen.school ? ` · ${chosen.school}` : ''} · ${chosen.source}</span>
        ${scrollSpellName(item.name) ? null : html`<button type="button" class="btn tiny ghost" onClick=${() => { setChosen(null); setRoll(null); }}>${t('Changer')}</button>`}
      </div>`
      : html`<label class="auth-field">${t('Quel sort porte ce parchemin ?')}
        <input class="txt" value=${q} onInput=${e => setQ(e.target.value)} placeholder="Fireball" /></label>
        ${hits.length ? html`<ul class="pick-list">${hits.map(s => html`<li><button type="button" onClick=${() => setChosen(s)}><b>${s.name}</b> <span class="muted small">${s.level ? t('niveau {n}', { n: s.level }) : 'cantrip'} · ${s.source}</span></button></li>`)}</ul>` : null}`}
    ${chosen && known ? html`<p class="alert">${Icon.info()} ${t('Ce sort est déjà sur la fiche.')}</p>` : null}
    ${chosen && !known ? html`
      ${wizard ? html`<div class="scroll-rule">
        <p>${t('Copier ce sort dans le grimoire demande un test d\'Intelligence (Arcana) DD {dc}. Réussi ou raté, le parchemin est détruit. La copie prend 2 heures et coûte 50 gp par niveau du sort.', { dc })}</p>
        <div class="row-btns">
          <button type="button" class="btn" onClick=${doRoll}>${Icon.d20()} ${t('Lancer Arcana')} (${signed(arcana)})</button>
          ${roll != null ? html`<b class=${roll >= dc ? 'good' : 'warn'}>${roll} ${roll >= dc ? t('· réussi') : t('· raté')}</b>` : null}
        </div>
        <div class="row-btns">
          <button type="button" class="btn primary" onClick=${() => learn(true)}>${t('Réussi : copier le sort')}</button>
          <button type="button" class="btn danger ghost" onClick=${fail}>${t('Raté : détruire le parchemin')}</button>
        </div>
      </div>` : html`<div class="scroll-rule">
        <p class="muted">${t('Seul un Wizard copie un sort de parchemin dans un grimoire. Si le MJ l\'accepte autrement, ajoute-le ici.')}</p>
        <div class="row-btns">
          <button type="button" class="btn primary" onClick=${() => learn(true)}>${t('Ajouter le sort et retirer le parchemin')}</button>
          <button type="button" class="btn ghost" onClick=${() => learn(false)}>${t('Ajouter le sort, garder le parchemin')}</button>
        </div>
      </div>`}` : null}
  <//>`;
}
