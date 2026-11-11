// Compendium : toutes les données 5etools du portable, sans passer par le site.
// Recherche globale, fiches (sorts, objets, créatures, classes, règles…), listes filtrées,
// lecteur de livres et d'aventures. Chaque lien d'un texte s'ouvre ici ; chaque dé se lance.
import { html, useEffect, useRef, useState } from './html.js';
import { renderEntries, renderMonster } from '/shared/render5e.js';
import { closeModal, openModal, store } from './store.js';
import { Modal, focusOnce } from './ui.js';
import { data5e } from './data.js';
import { rollD20, rollFormula } from './dice.js';

export const KIND_LABELS = {
  spell: 'Sort', item: 'Objet', monster: 'Créature', feat: 'Don', opt: 'Option de classe', race: 'Espèce',
  background: 'Historique', class: 'Classe', subclass: 'Sous-classe', classFeature: 'Capacité de classe',
  subclassFeature: 'Capacité de sous-classe', condition: 'Condition', disease: 'Maladie', status: 'État',
  action: 'Action', variantrule: 'Règle', language: 'Langue', sense: 'Sens', skill: 'Compétence', deity: 'Divinité',
  reward: 'Récompense', trap: 'Piège', hazard: 'Danger', object: 'Objet de décor', vehicle: 'Véhicule',
  psionic: 'Psionique', cult: 'Culte', boon: 'Faveur', table: 'Table', deck: 'Jeu de cartes', recipe: 'Recette',
  facility: 'Bastion', charoption: 'Option de création', itemMastery: 'Weapon Mastery', legendaryGroup: 'Antre',
  book: 'Livre', adventure: 'Aventure', bookSection: 'Section de livre',
};

const MAIN_FILTERS = [
  ['', 'Tout'], ['spell', 'Sorts'], ['monster', 'Créatures'], ['item', 'Objets'], ['feat', 'Dons'],
  ['classFeature,subclassFeature,class,opt', 'Classes'], ['variantrule,action,condition,status,sense,skill', 'Règles'],
  ['race,background', 'Origines'], ['book,adventure,bookSection', 'Livres'],
];
const OTHER_FILTERS = [
  ['deity', 'Divinités'], ['language', 'Langues'], ['trap,hazard', 'Pièges et dangers'], ['table', 'Tables'],
  ['reward,boon,cult', 'Récompenses, faveurs, cultes'], ['vehicle,object', 'Véhicules et objets de décor'],
  ['facility', 'Bastions'], ['disease', 'Maladies'], ['deck', 'Jeux de cartes'], ['psionic', 'Psioniques'],
  ['recipe', 'Recettes'], ['itemMastery', 'Weapon Mastery'], ['charoption', 'Options de création'],
];

// Ouvre un résultat de recherche ou un lien, quel que soit son type.
export function openResult(r, back) {
  if (r.k === 'book' || r.k === 'adventure') return openModal({ kind: 'book', bk: r.k, id: r.id, back });
  if (r.k === 'bookSection') return openModal({ kind: 'book', bk: r.bk, id: r.id, ch: r.ch, section: r.n, back });
  const extra = r.cls ? { cls: r.cls, cs: r.cs, lv: r.lv, sub: r.sub, ss: r.ss } : r.extra;
  return openModal({ kind: 'entry', k: r.k, name: r.n, source: r.s, extra, back });
}

function rollLabel(el) {
  const named = el.closest('p, li, td')?.querySelector('.entry-name, b');
  const modal = el.closest('.modal')?.querySelector('header h2')?.textContent || '';
  const what = named && named !== el ? named.textContent.replace(/\.$/, '') : '';
  return [modal, what].filter(Boolean).join(' · ') || 'Jet';
}

// Clic dans un texte 5etools : lien interne, liste filtrée, livre, ou dé à lancer.
export function refClick(e, back) {
  const dice = e.target.closest('.dice.roll');
  if (dice) {
    e.preventDefault();
    if (!store.token) return;
    const expr = dice.dataset.roll;
    const d20 = /^1d20([+-]\d+)?$/.exec(expr);
    const label = rollLabel(dice);
    if (d20) rollD20(label, Number(d20[1] || 0));
    else rollFormula(`${label} (${expr})`, expr);
    return;
  }
  const a = e.target.closest('a.ref');
  if (!a) return;
  e.preventDefault();
  if (a.dataset.k) {
    let extra;
    try { extra = a.dataset.x ? JSON.parse(a.dataset.x) : undefined; } catch { extra = undefined; }
    openModal({ kind: 'entry', k: a.dataset.k, name: a.dataset.n, source: a.dataset.s, extra, back });
  } else if (a.dataset.filter) {
    openModal({ kind: 'filterList', filter: a.dataset.filter, title: a.textContent, back });
  } else if (a.dataset.book) {
    const [bk, id, ch, section] = a.dataset.book.split('|');
    openModal({ kind: 'book', bk, id, ch, section, back });
  }
  // Ancien format des liens, encore présent dans des fiches enregistrées.
  else if (a.dataset.spell) openModal({ kind: 'entry', k: 'spell', name: a.dataset.spell, source: a.dataset.source, back });
  else if (a.dataset.condition) openModal({ kind: 'entry', k: 'condition', name: a.dataset.condition, back });
  else if (a.dataset.item) openModal({ kind: 'entry', k: 'item', name: a.dataset.item, source: a.dataset.source, back });
}

export function Rendered({ entries, back, cls = '', headings = false }) {
  return html`<div class=${`entries ${cls}`} onClick=${e => refClick(e, back)} dangerouslySetInnerHTML=${{ __html: renderEntries(entries || [], true, 0, { headings }) }}></div>`;
}

function Statblock({ monster, back }) {
  return html`<div class="entries" onClick=${e => refClick(e, back)} dangerouslySetInnerHTML=${{ __html: renderMonster(monster) }}></div>`;
}

function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, value: null });
  useEffect(() => {
    let alive = true;
    setState({ loading: true, value: null });
    fn().then(v => alive && setState({ loading: false, value: v }));
    return () => { alive = false; };
  }, deps);
  return state;
}

// Un aperçu repliable d'une entrée, chargé à l'ouverture (level up, page Règles).
export function Peek({ kind, name, source, extra, label = 'Description', open = false }) {
  const [isOpen, setOpen] = useState(open);
  const [state, setState] = useState({ loading: false, value: null });
  useEffect(() => {
    if (!isOpen || !name) return undefined;
    let alive = true;
    setState({ loading: true, value: null });
    data5e.entry(kind, name, source, extra).then(v => alive && setState({ loading: false, value: v }));
    return () => { alive = false; };
  }, [isOpen, kind, name, source, JSON.stringify(extra || {})]);
  if (!name) return null;
  const v = state.value;
  return html`<details class="peek" open=${isOpen} onToggle=${e => setOpen(e.target.open)}>
    <summary>${label}</summary>
    ${state.loading ? html`<p class="muted small">Chargement…</p>`
      : v ? html`${v.meta?.filter(Boolean).length ? html`<p class="muted small">${v.meta.filter(Boolean).join(' · ')}</p>` : null}
          ${v.monster ? html`<${Statblock} monster=${v.monster} />` : html`<${Rendered} entries=${v.entries} />`}`
      : isOpen ? html`<p class="muted small">Absent des données 5etools.</p>` : null}
  </details>`;
}

// Fiche d'une classe : tableau de progression, capacités par niveau, sous-classes.
function ClassView({ c, back }) {
  return html`<div>
    ${(c.table || []).filter(t => t.rows?.length).map(t => html`<div class="t5e-wrap"><table class="t5e class-table">
      ${t.title ? html`<caption>${t.title}</caption>` : null}
      <thead><tr><th>Niv.</th>${t.colLabels.map(l => html`<th dangerouslySetInnerHTML=${{ __html: renderEntries([l]).replace(/^<p>|<\/p>$/g, '') }}></th>`)}</tr></thead>
      <tbody>${t.rows.map((r, i) => html`<tr><td>${i + 1}</td>${r.map(cell => html`<td dangerouslySetInnerHTML=${{ __html: renderEntries([typeof cell === 'object' ? (cell.value ?? cell.roll?.exact ?? JSON.stringify(cell)) : String(cell)]).replace(/^<p>|<\/p>$/g, '') }}></td>`)}</tr>`)}</tbody>
    </table></div>`)}
    <h4>Capacités</h4>
    ${c.features.map(f => html`<details class="peek" key=${f.name + f.level}>
      <summary><b>Niveau ${f.level} · ${f.name}</b> <span class="muted small">${f.source}</span></summary>
      <${Rendered} entries=${f.entries} back=${back} />
    </details>`)}
    <h4>${c.subclassTitle || 'Sous-classes'}</h4>
    <div class="results">${c.subclasses.map(s => html`<div class="res" key=${s.name + s.source}>
      <button type="button" class="linkish" onClick=${() => openModal({ kind: 'entry', k: 'subclass', name: s.name, source: s.source, extra: { cls: c.name, cs: s.classSource, sub: s.shortName }, back })}>${s.name}</button>
      <span class="muted small">${s.source}</span></div>`)}</div>
  </div>`;
}

export function EntryModal({ k, name, source, extra, back }) {
  const st = useAsync(() => data5e.entry(k, name, source, extra), [k, name, source, JSON.stringify(extra || {})]);
  const v = st.value;
  const self = { kind: 'entry', k, name, source, extra, back };
  return html`<${Modal} title=${v?.name || name} wide onClose=${back ? () => openModal(back) : closeModal}>
    ${st.loading ? html`<p class="muted">Chargement…</p>` : v ? html`
      <p class="spell-sub">${KIND_LABELS[v.kind] || ''}${v.meta?.filter(Boolean).length ? ` · ${v.meta.filter(Boolean).join(' · ')}` : ''} <span class="muted">· ${v.source}</span></p>
      ${v.monster ? html`<${Statblock} monster=${v.monster} back=${self} />` : null}
      ${v.klass ? html`<${ClassView} c=${v.klass} back=${self} />` : null}
      ${v.entries?.length ? html`<${Rendered} entries=${v.entries} back=${self} />` : null}
      ${v.lair?.length ? html`<details class="peek"><summary>Antre et effets régionaux</summary><${Rendered} entries=${v.lair} back=${self} /></details>` : null}
      ${v.fluff?.length ? html`<details class="peek"><summary>Description et lore</summary><${Rendered} entries=${v.fluff} back=${self} /></details>` : null}
      ${back ? html`<p><button type="button" class="btn tiny ghost" onClick=${() => openModal(back)}>← Retour</button></p>` : null}`
      : html`<p class="muted">« ${name} » est absent des données 5etools locales.</p>`}
  <//>`;
}

export function FilterListModal({ filter, title, back }) {
  const [cat, ...rest] = String(filter || '').split('|');
  const st = useAsync(() => data5e.filter(cat, rest.join('|')), [filter]);
  const [q, setQ] = useState('');
  const list = (st.value || []).filter(r => !q || r.n.toLowerCase().includes(q.toLowerCase()));
  const self = { kind: 'filterList', filter, title, back };
  return html`<${Modal} title=${title || 'Liste'} wide onClose=${back ? () => openModal(back) : closeModal}>
    <input class="txt search" type="search" placeholder="Filtrer la liste…" value=${q} onInput=${e => setQ(e.target.value)} />
    ${st.loading ? html`<p class="muted">Chargement…</p>` : html`<p class="muted small">${list.length} résultat${list.length > 1 ? 's' : ''}</p>`}
    <div class="results">${list.map(r => html`<div class="res" key=${r.k + r.n + r.s}>
      <button type="button" class="linkish" onClick=${() => openResult(r, self)}>${r.n}</button>
      <span class="muted small">${r.x ? `${r.x} · ` : ''}${r.s}</span></div>`)}</div>
  <//>`;
}

// ---------------------------------------------------------------- Livres et aventures

function BookIndex({ back }) {
  const st = useAsync(() => data5e.books(), []);
  const [q, setQ] = useState('');
  const groups = {};
  for (const b of st.value || []) {
    if (q && !b.name.toLowerCase().includes(q.toLowerCase()) && !b.id.toLowerCase().includes(q.toLowerCase())) continue;
    const g = b.kind === 'adventure' ? 'Aventures' : b.group === 'core' ? 'Livres de base' : 'Suppléments';
    (groups[g] = groups[g] || []).push(b);
  }
  return html`<div>
    <input class="txt search" type="search" placeholder="Chercher un livre ou une aventure…" value=${q} onInput=${e => setQ(e.target.value)} ref=${focusOnce} />
    ${st.loading ? html`<p class="muted">Chargement…</p>` : null}
    ${Object.entries(groups).map(([g, list]) => html`<h4>${g}</h4><div class="book-grid">${list.map(b => html`
      <button type="button" class="book-card" key=${b.kind + b.id} onClick=${() => openModal({ kind: 'book', bk: b.kind, id: b.id, back })}>
        <b>${b.name}</b><small>${b.id}${b.published ? ` · ${b.published.slice(0, 4)}` : ''}</small></button>`)}</div>`)}
  </div>`;
}

export function BookModal({ bk, id, ch, section, back }) {
  const [chapter, setChapter] = useState(ch ?? '');
  const st = useAsync(() => (id ? data5e.book(bk, id, chapter, chapter === '' ? section : '') : Promise.resolve(null)), [bk, id, chapter]);
  const body = useRef(null);
  const v = st.value;
  const self = { kind: 'book', bk, id, ch: v?.chapter ?? chapter, back };
  // Fait défiler jusqu'à la section demandée par le lien.
  useEffect(() => {
    if (!v || !section || !body.current) return;
    const el = [...body.current.querySelectorAll('[data-sec]')].find(h => h.dataset.sec.toLowerCase() === String(section).toLowerCase());
    if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 50);
  }, [v?.chapter, v?.id]);
  if (!id) {
    return html`<${Modal} title="Livres et aventures" wide onClose=${back ? () => openModal(back) : closeModal}><${BookIndex} back=${{ kind: 'book' }} /><//>`;
  }
  const go = i => { setChapter(i); body.current?.closest('.modal-body')?.scrollTo(0, 0); };
  return html`<${Modal} title=${v?.name || id} wide cls="book" onClose=${back ? () => openModal(back) : closeModal}>
    ${st.loading ? html`<p class="muted">Chargement…</p>` : v ? html`
      <div class="book-nav">
        <button type="button" class="btn small" disabled=${v.chapter <= 0} onClick=${() => go(v.chapter - 1)}>←</button>
        <select class="sel" value=${String(v.chapter)} onChange=${e => go(Number(e.target.value))}>
          ${v.chapters.map((c, i) => html`<option value=${String(i)}>${c || `Chapitre ${i + 1}`}</option>`)}
        </select>
        <button type="button" class="btn small" disabled=${v.chapter >= v.chapters.length - 1} onClick=${() => go(v.chapter + 1)}>→</button>
        <button type="button" class="btn small ghost" onClick=${() => openModal({ kind: 'book' })}>Tous les livres</button>
      </div>
      <div ref=${body}>
        <h3 class="book-title">${v.title}</h3>
        <${Rendered} entries=${v.entries} back=${self} headings cls="book-text" />
      </div>` : html`<p class="muted">Livre absent des données 5etools locales.</p>`}
  <//>`;
}

// ---------------------------------------------------------------- Recherche globale

export function CompendiumModal({ q: q0 = '', filter = '' }) {
  const [q, setQ] = useState(q0);
  const [kind, setKind] = useState(filter);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState(null);
  useEffect(() => { data5e.status().then(setStatus); }, []);
  useEffect(() => {
    const t = setTimeout(() => data5e.search(q.trim(), kind).then(setResults), 180);
    return () => clearTimeout(t);
  }, [q, kind]);
  const back = { kind: 'compendium', q, filter: kind };
  const other = OTHER_FILTERS.some(([k]) => k === kind) ? kind : '';
  return html`<${Modal} title="Compendium 5etools" wide>
    <input class="txt search" type="search" placeholder="Rechercher (2 lettres min.) : Wild Shape, Fireball, Owlbear, Grappled, Plasmoid…" value=${q} onInput=${e => setQ(e.target.value)} ref=${focusOnce} />
    <div class="chips lvl-chips">
      ${MAIN_FILTERS.map(([k, l]) => html`<button type="button" class=${`chip-btn ${kind === k ? 'on' : ''}`} onClick=${() => setKind(k)}>${l}</button>`)}
      <select class=${`sel tiny ${other ? 'on' : ''}`} value=${other} onChange=${e => setKind(e.target.value)}>
        <option value="">Autres…</option>
        ${OTHER_FILTERS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
      </select>
    </div>
    <div class="row-btns">
      <button type="button" class="btn tiny" onClick=${() => openModal({ kind: 'book', back })}>📖 Livres et aventures</button>
      <button type="button" class="btn tiny" onClick=${() => openModal({ kind: 'filterList', filter: 'bestiary|', title: 'Toutes les créatures', back })}>Bestiaire complet</button>
    </div>
    ${status && status.error ? html`<p class="alert warn">Pas de données 5etools sur le portable. Panneau MJ → Données 5etools → Télécharger.</p>` : null}
    <div class="results">
      ${results.map(r => html`<div class="res" key=${`${r.k}|${r.n}|${r.s}|${r.x}|${r.ch ?? ''}`}>
        <button type="button" class="linkish" onClick=${() => openResult(r, back)}>${r.n}</button>
        <span class="muted small">${KIND_LABELS[r.k] || r.k}${r.x ? ` · ${r.x}` : ''} · ${r.s}</span>
      </div>`)}
      ${q.trim().length >= 2 && !results.length ? html`<p class="muted">Aucun résultat.</p>` : null}
    </div>
    ${status && !status.error ? html`<p class="muted small">${status.spells} sorts · ${status.monsters} créatures · ${status.items} objets · ${status.feats} dons · ${status.rules} règles · ${status.deities} divinités · ${status.books} livres et aventures${status.download?.at ? ` · données du ${new Date(status.download.at).toLocaleDateString('fr-CA')}` : ''}</p>` : null}
  <//>`;
}
