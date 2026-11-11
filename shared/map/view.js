// Ce que montre la TV, calculé à partir de l'état de la scène. Le portable et la TV appellent
// la même fonction, et les tests aussi.
import { blockingSegments, sceneBounds } from './scene.js';
import { buildIndex, lineOfSight, visibilityPolygon } from './vision.js';

const indexes = new WeakMap();

// L'index ne change que si la liste des murs change : elle est remplacée à chaque modification.
export function indexFor(doc) {
  const known = indexes.get(doc.walls);
  const b = sceneBounds(doc);
  if (known && known.minX === b.minX && known.maxX === b.maxX && known.minY === b.minY && known.maxY === b.maxY) return known;
  const ix = buildIndex(blockingSegments(doc.walls), b);
  indexes.set(doc.walls, ix);
  return ix;
}

export function givesVision(t) {
  return !!t.vision && !t.hidden;
}

// Les tokens dont la vue compte : le groupe, ou un seul si le MJ a choisi sa vue.
export function sourcesOf(doc) {
  const all = doc.tokens.filter(givesVision);
  if (doc.view?.mode === 'token') {
    const one = all.find(t => t.id === doc.view.tokenId);
    if (one) return [one];
  }
  return all;
}

// Quelques points sur l'emprise d'un token : un grand ennemi se voit dès qu'un bout dépasse.
function samplePoints(t) {
  const size = t.size || 1;
  const r = size * 0.38;
  return [[t.x, t.y], [t.x - r, t.y - r], [t.x + r, t.y - r], [t.x - r, t.y + r], [t.x + r, t.y + r]];
}

export function isSeen(ix, sources, t) {
  if (t.hidden) return false;
  if (sources.some(s => s.id === t.id)) return true;
  return sources.some(s => samplePoints(t).some(p => lineOfSight(ix, s.x, s.y, p[0], p[1])));
}

// Les noms que la TV écrit : seulement les tokens que le MJ a ouverts et que le groupe voit.
// Un token caché ou hors de vue ne donne jamais son nom.
export function namesOnTv(doc, seen) {
  return doc.tokens.filter(t => t.showName && !t.hidden && seen.has(t.id) && String(t.name || '').trim());
}

export function computeView(doc) {
  // Un lieu sans brouillard : tout se voit, sauf ce que le MJ a caché.
  if (doc.fog === false) {
    return { sources: [], visible: [], explored: [], seen: new Set(doc.tokens.filter(t => !t.hidden).map(t => t.id)) };
  }
  const ix = indexFor(doc);
  const sources = sourcesOf(doc);
  const visible = sources.map(s => visibilityPolygon(ix, s.x, s.y));
  const seen = new Set();
  for (const t of doc.tokens) if (isSeen(ix, sources, t)) seen.add(t.id);
  return { sources, visible, seen, explored: exploredFor(doc, sources) };
}

// Les zones déjà vues par les tokens dont la vue compte. Chaque token garde les siennes,
// pour qu'une vue par joueur reste possible quand les joueurs se connecteront.
export function exploredFor(doc, sources) {
  const out = [];
  // `_party` : ce que tout le groupe a déjà vu, par exemple repris d'un autre outil.
  for (const e of doc.explored?._party || []) out.push(e.p);
  for (const s of sources) for (const e of doc.explored?.[s.id] || []) out.push(e.p);
  return out;
}
