// Capacités et traits d'une fiche : une liste d'entrées au lieu d'un seul bloc de texte.
//   featureList: { <id>: { name, group, kind, text, ref, order } }
// `text` est ce que le joueur a tapé ou collé, gardé tel quel : l'application ne le réécrit
// jamais. Le texte officiel de 5etools ne vient que sur demande (bouton « Texte officiel »).
import { newId } from './patch.js';

export const FEATURE_KINDS = ['class', 'subclass', 'species', 'background', 'feat', 'item', 'other'];
export const FEATURE_KIND_LABELS = {
  class: 'Classe', subclass: 'Sous-classe', species: 'Espèce', background: 'Historique', feat: 'Don', item: 'Objet', other: 'Autre',
};

const str = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').slice(0, max);

export function cleanFeature(f = {}, order = 0) {
  const out = {
    name: str(f.name, 200).trim(),
    group: str(f.group, 120).trim(),
    kind: FEATURE_KINDS.includes(f.kind) ? f.kind : 'other',
    text: str(f.text, 20_000),
    order: Number.isFinite(Number(f.order)) ? Number(f.order) : order,
  };
  if (f.ref && typeof f.ref === 'object' && f.ref.name) out.ref = { kind: str(f.ref.kind, 30), name: str(f.ref.name, 200), source: str(f.ref.source, 20) };
  return out;
}

// Un titre de section : « FIGHTER · CHAMPION », « DONS », « ## Traits », « Skilled: ».
function isHeader(line) {
  const t = line.trim();
  if (!t || t.length > 80) return false;
  if (/^#{1,6}\s/.test(t)) return true;
  if (/^[^a-zà-ÿ]*[A-ZÀ-Ý][^a-zà-ÿ]*$/.test(t) && /[A-ZÀ-Ý]{3}/.test(t)) return true;
  return /^[^.:;]{2,60}:$/.test(t);
}
const headerText = line => line.trim().replace(/^#{1,6}\s+/, '').replace(/:$/, '').trim();

// Le nom d'une entrée, lu au début de sa ligne : « Second Wind : … », « Shapechanger. As an action… ».
export function nameOf(line) {
  const t = line.trim().replace(/^[-*•]\s*/, '');
  const m = /^([^:.;]{2,70}?)\s*(?::|\.\s|\s[-–—]\s)/.exec(t);
  if (m) return m[1].trim();
  return t.length <= 70 ? t : `${t.slice(0, 60).trim()}…`;
}

// Découpe un ancien bloc de texte en entrées, sans changer un mot : chaque puce devient une
// entrée, chaque paragraphe aussi ; un titre de section devient le groupe des entrées qui suivent.
export function splitFeatures(text) {
  const out = [];
  const bullet = l => /^\s*[-*•]/.test(l);
  let group = '';
  let pending = null;
  const blocks = String(text || '').replace(/\r\n/g, '\n').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim());
    if (!lines.length) continue;
    // Un titre seul sur sa ligne : il nomme le paragraphe suivant, ou groupe la liste qui suit.
    if (lines.length === 1 && isHeader(lines[0])) { pending = headerText(lines[0]); continue; }
    let rest = lines;
    const titled = isHeader(lines[0]) || (lines.length > 1 && !bullet(lines[0]) && lines[0].trim().length <= 80 && lines.slice(1).every(bullet));
    let name = null;
    if (titled && lines.length > 1) {
      rest = lines.slice(1);
      // « Skilled: » suivi d'un paragraphe : c'est le nom de l'entrée, pas un groupe.
      if (/:\s*$/.test(lines[0]) && !rest.every(bullet)) name = headerText(lines[0]);
      else group = headerText(lines[0]);
      pending = null;
    }
    if (pending) {
      if (rest.every(bullet)) group = pending;
      else if (!name) name = pending;
      pending = null;
    }
    if (rest.every(bullet)) {
      for (const l of rest) out.push({ name: nameOf(l), group, text: l.trim().replace(/^[-*•]\s*/, '') });
      continue;
    }
    const first = rest[0].trim();
    // « Level 6: Dark One's Own Luck » puis le texte : la première ligne courte est le nom.
    if (!name) name = rest.length > 1 && first.length <= 80 && !/[.!?]$/.test(first) ? first.replace(/:$/, '') : nameOf(first);
    out.push({ name, group, text: rest.join('\n').trim() });
  }
  return out.map((f, n) => cleanFeature({ ...f, kind: 'other' }, n));
}

// Ce qui suit le nom dans le texte, pour ne pas l'afficher deux fois : purement visuel.
export function bodyOf(f) {
  const t = String(f.text || '');
  const n = String(f.name || '');
  if (!n || !t.startsWith(n)) return t;
  return t.slice(n.length).replace(/^\s*(?::|\.|[-–—])\s*/, '');
}

export function featureItems(doc) {
  return Object.entries(doc.featureList || {})
    .map(([id, f]) => ({ id, ...f }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// Tout le texte des capacités, pour chercher un nom de don, d'invocation ou d'option.
export function featuresText(doc) {
  const items = featureItems(doc).map(f => `${f.name}\n${f.text}`);
  return [String(doc.features || ''), ...items].join('\n');
}

// Ajoute des entrées à la fin de la liste (montée de niveau, import de texte).
export function addFeatures(doc, list) {
  doc.featureList = doc.featureList || {};
  let order = featureItems(doc).reduce((m, f) => Math.max(m, Number(f.order) || 0), -1) + 1;
  const ids = [];
  for (const f of list) {
    const id = newId('f');
    doc.featureList[id] = cleanFeature(f, order++);
    ids.push(id);
  }
  return ids;
}
