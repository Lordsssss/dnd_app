// Pages « Principal » et « Combat ».
import { html } from './html.js';
import {
  ABILITIES, ABILITY_NAMES, ABILITY_SHORT, SKILLS, abilityMod, hitDiceOf, initiative, num, passive,
  profBonus, saveBonus, signed, skillBonus, itemList, RESET_LABELS, CONDITIONS, totalLevel, armorClass, acBonuses,
} from '/shared/rules.js';
import { classSummary } from '/shared/model.js';
import { newId } from '/shared/patch.js';
import { act, openModal, setPath, toast } from './store.js';
import { bind, Box, Num, Pips, ProfDot, RollBtn, Stepper, Txt } from './ui.js';
import { rollD20, rollFormula } from './dice.js';
import { Icon } from './icons.js';
import { FeaturesBox } from './features.js';
import { isDm, store } from './store.js';

// Petit bouton « ⓘ » : ouvre l'entrée 5etools correspondante (espèce, historique).
function RefBtn({ k, name }) {
  return html`<button type="button" class="ref-btn" title="Voir dans le compendium 5etools"
    onClick=${e => { e.preventDefault(); openModal({ kind: 'entry', k, name: String(name).replace(/\s*\(.*\)\s*$/, '').trim() }); }}>ⓘ</button>`;
}

export function Header({ id, doc, ro, full = false }) {
  const b = p => bind(id, doc, p, ro);
  if (!full) {
    return html`<header class="sheet-head compact">
      <div class="name-banner"><span class="nm">${doc.name || 'Sans nom'}</span><small>CHARACTER NAME</small></div>
      <div class="head-sum">
        <span>${classSummary(doc) || '—'}</span>
        <span>${doc.race || ''}</span>
        <span>AC <b>${armorClass(doc)}</b></span>
        <span>HP <b>${num(doc.hp?.current)}/${num(doc.hp?.max)}</b>${num(doc.hp?.temp) ? html` <i>+${num(doc.hp.temp)}</i>` : ''}</span>
      </div>
    </header>`;
  }
  return html`<header class="sheet-head">
    <div class="name-banner big"><${Txt} ...${b(['name'])} cls="nm" placeholder="Nom du personnage" /><small>CHARACTER NAME</small></div>
    <div class="head-grid">
      <label class="hf span2"><span class="hf-line">
        <button type="button" class="linkish" onClick=${() => openModal({ kind: 'classes', id })}>${classSummary(doc) || (ro ? '—' : 'Choisir une classe')}</button>
        ${ro ? null : html`<button type="button" class="btn tiny primary lv-btn" onClick=${() => openModal({ kind: 'levelUp', id })}>${Icon.up()} Level up</button>`}
      </span><small>CLASS & LEVEL</small></label>
      <label class="hf"><span class="hf-line"><${Txt} ...${b(['background'])} />${doc.background ? html`<${RefBtn} k="background" name=${doc.background} />` : null}</span><small>BACKGROUND</small></label>
      <label class="hf"><span class="ro-text">${doc.player || '—'}</span><small>PLAYER NAME</small></label>
      <label class="hf span2"><span class="hf-line"><${Txt} ...${b(['race'])} />${doc.race ? html`<${RefBtn} k="race" name=${doc.race} />` : null}</span><small>SPECIES</small></label>
      <label class="hf"><${Txt} ...${b(['alignment'])} /><small>ALIGNMENT</small></label>
      <label class="hf"><${Txt} ...${b(['xp'])} /><small>EXPERIENCE POINTS</small></label>
    </div>
  </header>`;
}

// ---------------------------------------------------------------- Principal

// Une caractéristique et tout ce qui en dépend, comme sur la fiche 2024 : modificateur, valeur,
// jet de sauvegarde, puis ses compétences. Tout ce qui touche à la Sagesse est sous WISDOM.
function AbilityCard({ id, doc, ro, ab }) {
  const mod = abilityMod(doc, ab);
  const skills = SKILLS.filter(sk => sk.ability === ab);
  return html`<section class="abil-card">
    <header>
      <span class="abil-name">${ABILITY_NAMES[ab].toUpperCase()}</span>
      <button type="button" class="abil-mod" title="Test de caractéristique" onClick=${() => rollD20(`${ABILITY_NAMES[ab]} check`, mod)}>${signed(mod)}</button>
      <span class="abil-score"><${Num} ...${bind(id, doc, ['abilities', ab], ro)} min=${1} max=${30} /></span>
    </header>
    <div class="row save">
      <${ProfDot} value=${doc.saves?.[ab] ? 1 : 0} ro=${ro} onChange=${v => setPath(id, ['saves', ab], !!v)} />
      <span class="bonus">${signed(saveBonus(doc, ab))}</span>
      <span class="lbl" title="Saving Throw" onClick=${() => rollD20(`${ABILITY_NAMES[ab]} save`, saveBonus(doc, ab))}>Save</span>
      <${RollBtn} label=${`${ABILITY_NAMES[ab]} save`} mod=${saveBonus(doc, ab)} />
    </div>
    ${skills.map(sk => html`<div class="row" key=${sk.key}>
      <${ProfDot} value=${doc.skills?.[sk.key]} ro=${ro} levels=${2} onChange=${v => setPath(id, ['skills', sk.key], v)} />
      <span class="bonus">${signed(skillBonus(doc, sk.key))}</span>
      <span class="lbl" onClick=${() => rollD20(sk.name, skillBonus(doc, sk.key))}>${sk.name}</span>
      <${RollBtn} label=${sk.name} mod=${skillBonus(doc, sk.key)} />
    </div>`)}
  </section>`;
}

export function PageMain({ id, doc, ro }) {
  const b = p => bind(id, doc, p, ro);
  const pb = profBonus(doc);
  return html`<div class="p-main">
    <div class="g-head"><${Header} id=${id} doc=${doc} ro=${ro} full /></div>
    <div class="g-stats">
      <div class="stats-col">
        ${['str', 'dex', 'con'].map(ab => html`<${AbilityCard} key=${ab} id=${id} doc=${doc} ro=${ro} ab=${ab} />`)}
        <div class="pill"><button type="button" class=${`insp ${doc.inspiration ? 'on' : ''}`} disabled=${ro}
          onClick=${() => setPath(id, ['inspiration'], !doc.inspiration)}>${doc.inspiration ? '★' : ''}</button><span>HEROIC INSPIRATION</span></div>
        <div class="pill"><b class="pill-val">${signed(pb)}</b><span>PROFICIENCY BONUS</span></div>
        <div class="pill"><b class="pill-val">${passive(doc, 'perception')}</b><span>PASSIVE PERCEPTION</span></div>
      </div>
      <div class="stats-col">
        ${['int', 'wis', 'cha'].map(ab => html`<${AbilityCard} key=${ab} id=${id} doc=${doc} ro=${ro} ab=${ab} />`)}
      </div>
    </div>
    <div class="g-prof">
      <${Box} label="OTHER PROFICIENCIES & LANGUAGES" cls="text-box"><${Txt} ...${b(['proficiencies'])} multiline placeholder="Armures, armes, outils, langues…" /><//>
    </div>
    <div class="g-mid">
      <${Box} label="PERSONALITY TRAITS" cls="text-box" style=${{ flex: 1.4 }}><${Txt} ...${b(['personality', 'traits'])} multiline /><//>
      <${Box} label="IDEALS" cls="text-box"><${Txt} ...${b(['personality', 'ideals'])} multiline /><//>
      <${Box} label="BONDS" cls="text-box"><${Txt} ...${b(['personality', 'bonds'])} multiline /><//>
      <${Box} label="FLAWS" cls="text-box"><${Txt} ...${b(['personality', 'flaws'])} multiline /><//>
      <${Box} label="APPEARANCE" cls="text-box" style=${{ flex: 1.2 }}><${Txt} ...${b(['appearance'])} multiline /><//>
    </div>
    <div class="g-right">
      <${Box} label="FEATURES & TRAITS" cls="text-box tall feat-outer">
        <${FeaturesBox} id=${id} doc=${doc} ro=${ro} />
      <//>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- Combat

function HpBox({ id, doc, ro }) {
  const hp = doc.hp || {};
  const b = p => bind(id, doc, p, ro);
  const pct = Math.max(0, Math.min(1, num(hp.current) / Math.max(1, num(hp.max))));
  const apply = kind => {
    const input = document.getElementById(`hp-amt-${id}`);
    const n = parseInt(input?.value, 10);
    if (!n || n < 0) { input?.focus(); return; }
    act(kind, { amount: n }).then(r => {
      if (r.ok && r.result?.toast) store_toast(r.result.toast, kind === 'damage');
      if (r.ok && input) input.value = '';
    });
  };
  return html`<${Box} label="HIT POINTS" cls="hp-box">
    <div class="hp-top">
      <label class="mini">HP MAX <${Num} ...${b(['hp', 'max'])} min=${1} max=${999} /></label>
      <label class="mini">TEMP HP <${Num} ...${b(['hp', 'temp'])} min=${0} max=${999} /></label>
    </div>
    <div class=${`hp-cur ${num(hp.current) <= 0 ? 'down' : pct < 0.35 ? 'low' : ''}`}>
      <${Num} ...${b(['hp', 'current'])} min=${0} max=${999} />
      <span class="of">/ ${num(hp.max)}</span>
      ${num(hp.temp) ? html`<span class="temp-badge">+${num(hp.temp)} temp</span>` : null}
    </div>
    <div class="hp-bar"><i style=${{ width: `${pct * 100}%` }}></i></div>
    ${ro ? null : html`<div class="hp-act">
      <input id=${`hp-amt-${id}`} class="num hp-amt" type="text" inputMode="numeric" placeholder="0"
        onKeyDown=${e => { if (e.key === 'Enter') apply('damage'); }} />
      <button type="button" class="btn danger" onClick=${() => apply('damage')}>Dégâts</button>
      <button type="button" class="btn good" onClick=${() => apply('heal')}>Soins</button>
      <button type="button" class="btn" onClick=${() => apply('tempHp')}>PV temp.</button>
    </div>`}
  <//>`;
}

function store_toast(text, warn) { toast(text, warn ? { kind: 'warn' } : {}); }

// Jets de mort. Quand la campagne les veut secrets, le serveur lance le dé et seul le MJ voit
// le décompte ; le joueur garde le bouton, et l'issue se lit sur ses PV (un 20 le relève).
function DeathSaves({ id, doc, ro }) {
  const secret = store.config.secretDeathSaves && !isDm();
  const roll = () => act('deathSave', {}).then(x => x.ok && x.result?.toast && store_toast(x.result.toast));
  if (secret) {
    return html`<${Box} label="DEATH SAVES" cls="death-box secret">
      <p class="ds-secret">${Icon.lock()} Le MJ tient le décompte.</p>
      ${ro ? null : html`<button type="button" class="btn small" onClick=${roll}>${Icon.d20()} Jet de mort</button>`}
    <//>`;
  }
  const ds = doc.deathSaves || {};
  const set = (k, v) => setPath(id, ['deathSaves', k], v);
  const marks = (k, n) => [0, 1, 2].map(i => html`<button type="button" class=${`ds ${k} ${i < n ? 'on' : ''}`} disabled=${ro}
    onClick=${() => set(k, i < n ? i : i + 1)} aria-label=${k}></button>`);
  return html`<${Box} label="DEATH SAVES" cls="death-box">
    <div class="ds-row"><span>SUCCESSES</span>${marks('success', num(ds.success))}</div>
    <div class="ds-row"><span>FAILURES</span>${marks('fail', num(ds.fail))}</div>
    ${ro ? null : html`<button type="button" class="btn small" title=${store.config.secretDeathSaves ? 'Lancé par le serveur ; le joueur ne voit pas le résultat' : ''} onClick=${roll}>${Icon.d20()} Jet de mort</button>`}
  <//>`;
}

function HitDice({ id, doc, ro }) {
  const dice = hitDiceOf(doc);
  return html`<${Box} label="HIT DICE" cls="hd-box">
    ${dice.map(d => html`<div class="hd-row" key=${d.die}>
      <b>${d.die}</b>
      <${Pips} max=${d.max} used=${d.used} ro=${ro} onChange=${u => setPath(id, ['hitDiceUsed', d.die], Math.max(0, Math.min(d.max, u)))} />
      <span class="muted">${d.max - d.used}/${d.max}</span>
    </div>`)}
    ${dice.length ? null : html`<p class="muted">Ajoute une classe.</p>`}
  <//>`;
}

function Conditions({ id, doc, ro }) {
  const list = doc.conditions || [];
  const avail = CONDITIONS.map(c => c.name).filter(n => !list.includes(n));
  return html`<${Box} label="CONDITIONS" cls="cond-box">
    <div class="chips">
      ${list.map(c => html`<span class="chip cond" key=${c}>
        <button type="button" class="chip-main" onClick=${() => openModal({ kind: 'condition', name: c, id })}>${c}</button>
        ${ro ? null : html`<button type="button" class="chip-x" aria-label=${`Retirer ${c}`} onClick=${() => setPath(id, ['conditions'], list.filter(x => x !== c))}>×</button>`}
      </span>`)}
      ${list.length ? null : html`<span class="muted">Aucune condition.</span>`}
    </div>
    ${ro ? null : html`<select class="sel" value="" onChange=${e => { if (e.target.value) setPath(id, ['conditions'], [...list, e.target.value]); e.target.value = ''; }}>
      <option value="">+ Ajouter une condition…</option>
      ${avail.map(n => html`<option value=${n}>${n}</option>`)}
    </select>`}
  <//>`;
}

function Attacks({ id, doc, ro }) {
  const list = itemList(doc.attacks);
  const add = () => setPath(id, ['attacks', newId('a')], { name: '', bonus: '', damage: '', type: '', notes: '', order: list.length ? Math.max(...list.map(a => num(a.order))) + 1 : 0 });
  return html`<${Box} label="ATTACKS & SPELLCASTING" cls="atk-box" top>
    <div class="atk-head"><span>NAME</span><span>ATK BONUS</span><span>DAMAGE / TYPE</span><span></span></div>
    <div class="atk-list">
      ${list.map(a => {
        const b = p => bind(id, doc, ['attacks', a.id, p], ro);
        const bonus = parseInt(String(a.bonus).replace(/\s/g, ''), 10);
        return html`<div class="atk-row" key=${a.id}>
          <${Txt} ...${b('name')} placeholder="Arme / sort" />
          <span class="atk-cell">
            <${Txt} ...${b('bonus')} cls="center" placeholder="+0" />
            ${Number.isFinite(bonus) ? html`<${RollBtn} label=${`${a.name || 'Attaque'} (attaque)`} mod=${bonus} />` : null}
          </span>
          <span class="atk-cell">
            <${Txt} ...${b('damage')} cls="center" placeholder="1d8+3" />
            ${a.damage ? html`<button type="button" class="roll dmg" title="Lancer les dégâts" onClick=${() => rollFormula(`${a.name || 'Attaque'} (dégâts)`, a.damage) || store_toast('Formule de dégâts illisible', true)}>${Icon.d20()}</button>` : null}
          </span>
          ${ro ? html`<span></span>` : html`<button type="button" class="icon-btn faint" aria-label="Supprimer" onClick=${() => setPath(id, ['attacks', a.id], undefined)}>${Icon.trash()}</button>`}
          <div class="atk-notes"><${Txt} ...${b('type')} placeholder="Type de dégâts, propriétés, portée…" /></div>
        </div>`;
      })}
      ${list.length ? null : html`<p class="muted">Aucune attaque.</p>`}
    </div>
    ${ro ? null : html`<button type="button" class="btn small add" onClick=${add}>${Icon.plus()} Attaque</button>`}
  <//>`;
}

function Resources({ id, doc, ro }) {
  const list = itemList(doc.resources);
  const add = () => setPath(id, ['resources', newId('r')], { name: '', max: 1, used: 0, reset: 'long', order: list.length ? Math.max(...list.map(r => num(r.order))) + 1 : 0 });
  return html`<${Box} label="CLASS RESOURCES" cls="res-box" top>
    <div class="res-list">
      ${list.map(r => {
        const b = p => bind(id, doc, ['resources', r.id, p], ro);
        const max = num(r.max);
        return html`<div class="res-row" key=${r.id}>
          <div class="res-name"><${Txt} ...${b('name')} placeholder="Action Surge, Second Wind…" /></div>
          <div class="res-use">
            ${max <= 12
              ? html`<${Pips} max=${max} used=${r.used} ro=${ro} onChange=${u => setPath(id, ['resources', r.id, 'used'], Math.max(0, Math.min(max, u)))} />`
              : html`<${Stepper} value=${max - num(r.used)} min=${0} max=${max} ro=${ro} onChange=${v => setPath(id, ['resources', r.id, 'used'], max - v)} />`}
          </div>
          <div class="res-meta">
            <label>max <${Num} ...${b('max')} min=${0} max=${99} cls="tiny" /></label>
            <select class="sel tiny" disabled=${ro} value=${r.reset || 'long'} onChange=${e => setPath(id, ['resources', r.id, 'reset'], e.target.value)}>
              ${Object.entries(RESET_LABELS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}
            </select>
            ${ro ? null : html`<button type="button" class="icon-btn faint" aria-label="Supprimer" onClick=${() => setPath(id, ['resources', r.id], undefined)}>${Icon.trash()}</button>`}
          </div>
        </div>`;
      })}
      ${list.length ? null : html`<p class="muted">Aucune ressource. Ajoute Action Surge, Second Wind, invocations à usages…</p>`}
    </div>
    ${ro ? null : html`<button type="button" class="btn small add" onClick=${add}>${Icon.plus()} Ressource</button>`}
  <//>`;
}

export function PageCombat({ id, doc, ro }) {
  const b = p => bind(id, doc, p, ro);
  const conc = doc.concentration;
  return html`<div class="p-combat">
    <div class="g-head"><${Header} id=${id} doc=${doc} ro=${ro} /></div>
    <div class="g-left">
      <div class="trio">
        <div class="shield">
          ${acBonuses(doc).length
            ? html`<b class="ac-total" title=${`Base ${num(doc.ac)} ${acBonuses(doc).map(x => `+ ${x.value} ${x.name}`).join(' ')}`}>${armorClass(doc)}</b>`
            : html`<${Num} ...${b(['ac'])} min=${0} max=${40} />`}
          <small>ARMOR CLASS</small>
          ${acBonuses(doc).length ? html`<label class="ac-base">base <${Num} ...${b(['ac'])} min=${0} max=${40} /> ${acBonuses(doc).map(x => `+${x.value}`).join(' ')}</label>` : null}
        </div>
        <div class="trio-box">
          <button type="button" class="big-val" onClick=${() => rollD20('Initiative', initiative(doc))}>${signed(initiative(doc))}</button>
          <small>INITIATIVE</small>
        </div>
        <div class="trio-box"><${Txt} ...${b(['speed'])} cls="center big-txt" /><small>SPEED</small></div>
      </div>
      <${HpBox} id=${id} doc=${doc} ro=${ro} />
      <div class="pair">
        <${HitDice} id=${id} doc=${doc} ro=${ro} />
        <${DeathSaves} id=${id} doc=${doc} ro=${ro} />
      </div>
      <div class="pair">
        <${Box} label="CONCENTRATION" cls="conc-box">
          ${conc ? html`<div class="conc-on">
            <b>${conc.name}</b>
            <div class="row-btns">
              <button type="button" class="btn small" onClick=${() => rollD20('Concentration (CON save)', saveBonus(doc, 'con'))}>${Icon.d20()} Jet</button>
              ${ro ? null : html`<button type="button" class="btn small" onClick=${() => act('endConcentration').then(r => r.ok && store_toast(r.result?.toast))}>Terminer</button>`}
            </div>
          </div>` : html`<span class="muted">Aucune concentration.</span>`}
        <//>
        <${Box} label="EXHAUSTION" cls="exh-box">
          <${Stepper} value=${doc.exhaustion} min=${0} max=${6} ro=${ro} onChange=${v => setPath(id, ['exhaustion'], v)} />
          ${num(doc.exhaustion) ? html`<small class="warn">−${2 * num(doc.exhaustion)} aux d20 · −${5 * num(doc.exhaustion)} ft</small>` : null}
        <//>
      </div>
      <${Conditions} id=${id} doc=${doc} ro=${ro} />
      <${Box} label="SAVING THROWS" cls="qs-box">
        <div class="qs-grid">${ABILITIES.map(ab => html`<button type="button" key=${ab} class=${`qs ${doc.saves?.[ab] ? 'is-prof' : ''}`}
          onClick=${() => rollD20(`${ABILITY_NAMES[ab]} save`, saveBonus(doc, ab))}><span>${ABILITY_SHORT[ab]}</span><b>${signed(saveBonus(doc, ab))}</b></button>`)}</div>
      <//>
    </div>
    <div class="g-right">
      <${Attacks} id=${id} doc=${doc} ro=${ro} />
      <${Resources} id=${id} doc=${doc} ro=${ro} />
      <${Box} label="REST" cls="rest-box">
        ${ro ? html`<p class="muted">Lecture seule.</p>` : html`<div class="rest-btns">
          <button type="button" class="btn big" onClick=${() => openModal({ kind: 'shortRest', id })}>Short Rest</button>
          <button type="button" class="btn big" onClick=${() => openModal({ kind: 'longRest', id })}>Long Rest</button>
          <button type="button" class="btn big alt" onClick=${() => openModal({ kind: 'levelUp', id })}>Level up ${totalLevel(doc)} → ${totalLevel(doc) + 1}</button>
        </div>`}
      <//>
    </div>
  </div>`;
}

