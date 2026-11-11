// Page « Règles » : tout le texte officiel utile à ce personnage, tiré des données 5etools
// du portable. Capacités de classe et de sous-classe jusqu'à son niveau, espèce, historique,
// dons et options cités dans ses capacités, objets magiques, formes de Wild Shape.
import { featuresText } from '/shared/features.js';
import { html, useEffect, useState } from './html.js';
import { num } from '/shared/rules.js';
import { openModal } from './store.js';
import { Header } from './pages-main.js';
import { data5e, fold } from './data.js';
import { Rendered } from './compendium.js';

const SKIP_FEATURES = /^(Ability Score Improvement|Epic Boon|Subclass Feature|.* Subclass Feature)$/i;
const OPTION_TYPES = 'EI,MM,FS:F,FS:P,FS:R,FS:B,AI,AS,ED,PB,RN,MV:B';

function useAsync(fn, deps) {
  const [v, setV] = useState(undefined);
  useEffect(() => {
    let alive = true;
    setV(undefined);
    fn().then(x => alive && setV(x ?? null));
    return () => { alive = false; };
  }, deps);
  return v;
}

function findSubclass(cls, name) {
  if (!cls || !name) return null;
  const n = fold(name);
  return cls.subclasses.find(s => fold(s.name) === n)
    || cls.subclasses.find(s => n.includes(fold(s.shortName)) || fold(s.name).includes(n))
    || null;
}

function Feature({ f, open = false }) {
  return html`<details class="peek" open=${open}>
    <summary><b>${f.level ? `Niveau ${f.level} · ` : ''}${f.name}</b> <span class="muted small">${f.source || ''}</span></summary>
    <${Rendered} entries=${f.entries} />
  </details>`;
}

function ClassBlock({ c }) {
  const level = num(c.level, 1);
  const cls = useAsync(() => data5e.klass(c.name), [c.name]);
  const match = cls ? findSubclass(cls, c.subclass) : null;
  const sub = useAsync(() => (match ? data5e.subclass(cls.name, match.classSource, match.shortName, match.source) : Promise.resolve(null)), [cls?.name, match?.shortName, match?.source]);
  if (cls === undefined) return html`<p class="muted">Chargement de ${c.name}…</p>`;
  if (!cls) return html`<p class="muted">${c.name} : classe absente des données 5etools.</p>`;
  const own = cls.features.filter(f => f.level <= level && !SKIP_FEATURES.test(f.name));
  const subs = (sub?.features || []).filter(f => f.level <= level);
  return html`<section class="rules-sec">
    <h3>${cls.name} ${level} <span class="muted small">${cls.source}</span>
      <button type="button" class="btn tiny ghost" onClick=${() => openModal({ kind: 'entry', k: 'class', name: cls.name, source: cls.source })}>Classe complète</button></h3>
    ${own.map(f => html`<${Feature} key=${f.name + f.level} f=${f} />`)}
    ${c.subclass ? html`<h4>${c.subclass}${sub ? html` <span class="muted small">${sub.source}</span>` : null}</h4>
      ${subs.map(f => html`<${Feature} key=${f.name + f.level} f=${f} />`)}
      ${sub === null && match === null ? html`<p class="muted small">Sous-classe introuvable dans les données 5etools.</p>` : null}` : null}
  </section>`;
}

// « Gnome (Rock Gnome) » → Gnome ; « Human (Variant) » → Variant Human.
async function speciesEntry(race) {
  const full = String(race || '').trim();
  if (!full) return null;
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(full);
  const tries = m ? [full, `${m[2]} ${m[1]}`, m[1]] : [full];
  for (const t of tries) {
    const v = await data5e.entry('race', t);
    if (v) return v;
  }
  return null;
}

function EntryBlock({ title, value }) {
  if (value === undefined) return html`<p class="muted">Chargement…</p>`;
  if (!value) return null;
  return html`<details class="peek">
    <summary><b>${title} · ${value.name}</b> <span class="muted small">${value.source}</span></summary>
    ${value.meta?.filter(Boolean).length ? html`<p class="muted small">${value.meta.filter(Boolean).join(' · ')}</p>` : null}
    <${Rendered} entries=${value.entries} />
  </details>`;
}

// Dons et options de classe dont le nom apparaît dans les capacités du personnage.
function Mentioned({ doc }) {
  const feats = useAsync(() => data5e.feats(), []);
  const opts = useAsync(() => data5e.options(OPTION_TYPES), []);
  const text = `${featuresText(doc)}\n${doc.proficiencies || ''}`;
  if (feats === undefined || opts === undefined) return null;
  const hit = name => new RegExp(`(^|[^\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`).test(text);
  const seen = new Set();
  const found = [];
  for (const f of feats || []) {
    if (f.name.length < 4 || seen.has(fold(f.name)) || !hit(f.name)) continue;
    seen.add(fold(f.name));
    found.push({ k: 'feat', name: f.name, source: f.source, label: f.category ? `Don ${f.category}` : 'Don' });
  }
  for (const o of opts || []) {
    if (o.name.length < 4 || seen.has(fold(o.name)) || !hit(o.name)) continue;
    seen.add(fold(o.name));
    found.push({ k: 'opt', name: o.name, source: o.source, label: o.type, entries: o.entries });
  }
  if (!found.length) return null;
  return html`<section class="rules-sec">
    <h3>Dons et options</h3>
    ${found.map(f => html`<${MentionedOne} key=${f.k + f.name} f=${f} />`)}
  </section>`;
}

function MentionedOne({ f }) {
  const v = useAsync(() => (f.entries ? Promise.resolve({ name: f.name, source: f.source, entries: f.entries }) : data5e.entry(f.k, f.name, f.source)), [f.name, f.source]);
  return html`<${EntryBlock} title=${f.label} value=${v} />`;
}

function MagicItems({ doc }) {
  const items = Object.values(doc.inventory || {}).filter(it => it.source && (it.rarity || it.attunement || /^\+\d/.test(it.name || '')));
  if (!items.length) return null;
  return html`<section class="rules-sec">
    <h3>Objets magiques</h3>
    ${items.map(it => html`<${ItemOne} key=${it.name + it.source} it=${it} />`)}
  </section>`;
}

function ItemOne({ it }) {
  const v = useAsync(() => data5e.entry('item', it.name, it.source), [it.name, it.source]);
  return html`<${EntryBlock} title=${it.attuned ? 'Harmonisé' : 'Objet'} value=${v} />`;
}

// Formes de Wild Shape possibles à ce niveau de druide (PHB 2024, Circle of the Moon compris).
function WildShape({ doc }) {
  const druid = (doc.classes || []).find(c => fold(c.name) === 'druid');
  if (!druid || num(druid.level) < 2) return null;
  const lvl = num(druid.level);
  const moon = /moon/i.test(druid.subclass || '');
  const cr = moon ? String(Math.max(1, Math.floor(lvl / 3))) : lvl >= 8 ? '1' : lvl >= 4 ? '1/2' : '1/4';
  const fly = lvl >= 8;
  const filter = `bestiary|challenge rating=[&0;&${cr}]|type=beast${fly ? '' : '|speed type=!fly'}|miscellaneous=!swarm`;
  const known = lvl >= 8 ? 8 : lvl >= 4 ? 6 : 4;
  return html`<section class="rules-sec">
    <h3>Wild Shape</h3>
    <p>Druide ${lvl}${moon ? ', Circle of the Moon' : ''} : ${known} formes connues, bêtes de FP ${cr} au maximum${fly ? '' : ', sans vitesse de vol'}.</p>
    <button type="button" class="btn small" onClick=${() => openModal({ kind: 'filterList', filter, title: `Formes de Wild Shape · FP ${cr} max` })}>Voir les bêtes possibles et leurs statistiques</button>
  </section>`;
}

export function PageRules({ id, doc, ro }) {
  const status = useAsync(() => data5e.status(), []);
  const species = useAsync(() => speciesEntry(doc.race), [doc.race]);
  const background = useAsync(() => (doc.background ? data5e.entry('background', String(doc.background).trim()) : Promise.resolve(null)), [doc.background]);
  const classes = (doc.classes || []).filter(c => c.name);
  return html`<div class="p-rules">
    <div class="g-head"><${Header} id=${id} doc=${doc} ro=${ro} /></div>
    <div class="rules-body">
      ${status?.error ? html`<p class="alert warn">Pas de données 5etools sur le portable. Panneau MJ → Données 5etools.</p>` : null}
      <div class="row-btns">
        <button type="button" class="btn small" onClick=${() => openModal({ kind: 'compendium' })}>Compendium</button>
        <button type="button" class="btn small" onClick=${() => openModal({ kind: 'book' })}>📖 Livres</button>
        <button type="button" class="btn small" onClick=${() => openModal({ kind: 'compendium', filter: 'variantrule,action,condition,status,sense,skill' })}>Règles du jeu</button>
      </div>
      ${classes.map(c => html`<${ClassBlock} key=${c.name} c=${c} />`)}
      <section class="rules-sec">
        <h3>Origines</h3>
        <${EntryBlock} title="Espèce" value=${species} />
        <${EntryBlock} title="Historique" value=${background} />
        ${species === null && doc.race ? html`<p class="muted small">Espèce « ${doc.race} » absente des données 5etools.</p>` : null}
      </section>
      <${Mentioned} doc=${doc} />
      <${MagicItems} doc=${doc} />
      <${WildShape} doc=${doc} />
    </div>
  </div>`;
}
