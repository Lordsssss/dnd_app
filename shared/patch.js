// Patches JSON partagés client/serveur.
// Un patch est [path, value] (affectation) ou [path] (suppression).
// Les collections sont des objets indexés par id : un diff touche donc un
// seul élément, ce qui rend l'annulation sûre même après un transfert.

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

export function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

export function validPath(path) {
  return Array.isArray(path) && path.length > 0 && path.length <= 8 &&
    path.every(k => (typeof k === 'string' && k.length > 0 && k.length <= 80 && !FORBIDDEN.has(k)) ||
      (Number.isInteger(k) && k >= 0));
}

export function getIn(obj, path) {
  let cur = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

// Applique un patch. Retourne false si le parent n'existe plus (élément
// supprimé entre-temps) : le patch est alors ignoré, jamais recréé à moitié.
export function applyPatch(doc, patch) {
  const [path, value] = patch;
  const del = patch.length < 2;
  let cur = doc;
  for (let i = 0; i < path.length - 1; i++) {
    const next = cur[path[i]];
    if (next == null || typeof next !== 'object') {
      if (del) return false;
      // Créer les objets intermédiaires seulement au premier niveau
      // (ex. hitDiceUsed.d8 pour un nouveau dé), jamais dans une collection.
      if (i === 0 && next == null) { cur[path[i]] = {}; cur = cur[path[i]]; continue; }
      return false;
    }
    cur = next;
  }
  const last = path[path.length - 1];
  if (del) {
    if (Array.isArray(cur)) return false;
    delete cur[last];
  } else {
    cur[last] = clone(value);
  }
  return true;
}

export function applyPatches(doc, patches) {
  for (const p of patches) applyPatch(doc, p);
  return doc;
}

function same(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// Diff récursif sur les objets ; tableaux et primitives sont atomiques.
// Retourne { fwd, inv } : fwd transforme a en b, inv transforme b en a.
export function diff(a, b, path = [], out = { fwd: [], inv: [] }) {
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const k of Object.keys(a)) {
      if (!(k in b)) { out.fwd.push([[...path, k]]); out.inv.push([[...path, k], a[k]]); }
      else diff(a[k], b[k], [...path, k], out);
    }
    for (const k of Object.keys(b)) {
      if (!(k in a)) { out.fwd.push([[...path, k], b[k]]); out.inv.push([[...path, k]]); }
    }
    return out;
  }
  if (!same(a, b)) {
    out.fwd.push(b === undefined ? [path] : [path, b]);
    out.inv.push(a === undefined ? [path] : [path, a]);
  }
  return out;
}

export function pathKey(path) {
  return path.join('\u0001');
}

// true si `p` est égal à `prefix` ou en descend.
export function startsWith(p, prefix) {
  if (p.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (p[i] !== prefix[i]) return false;
  return true;
}

export function newId(prefix = '') {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}${t}${r}`;
}
