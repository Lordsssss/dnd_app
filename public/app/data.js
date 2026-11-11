// Accès aux données 5etools servies par le serveur (mises en cache dans la page).
import { store } from './store.js';

const cache = new Map();

// Ce qu'il faut changer sur un sort de la fiche pour le remettre d'accord avec 5etools :
// nom et source canoniques, niveau, école, temps, portée, composantes, durée. Null si absent.
const SPELL_FIELDS = ['name', 'source', 'level', 'school', 'ritual', 'concentration', 'time', 'range', 'components', 'duration'];
export async function spellRefresh(s) {
  const det = await data5e.spell(s.name, s.source);
  if (!det) return null;
  const changes = {};
  for (const k of SPELL_FIELDS) if (det[k] !== undefined && det[k] !== s[k]) changes[k] = det[k];
  return changes;
}

async function getJson(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url, { headers: store.token ? { Authorization: `Bearer ${store.token}` } : {} }).then(async r => (r.ok ? r.json() : null)).catch(() => null);
  cache.set(url, p);
  const v = await p;
  if (v == null) cache.delete(url);
  return v;
}

const qs = obj => Object.entries(obj).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

export const data5e = {
  status: () => getJson('/api/5e/status'),
  spells: async () => (await getJson('/api/5e/spells')) || [],
  items: async () => (await getJson('/api/5e/items')) || [],
  feats: async () => (await getJson('/api/5e/feats')) || [],
  spell: (name, source) => getJson(`/api/5e/spell?name=${encodeURIComponent(name)}&source=${encodeURIComponent(source || '')}`),
  item: (name, source) => getJson(`/api/5e/item?name=${encodeURIComponent(name)}&source=${encodeURIComponent(source || '')}`),
  condition: name => getJson(`/api/5e/condition?name=${encodeURIComponent(name)}`),
  feat: (name, source) => getJson(`/api/5e/feat?${qs({ name, source })}`),
  // Options de classe par type : EI (invocations), MM (métamagie), FS:F (styles de combat)…
  options: async types => (await getJson(`/api/5e/options?${qs({ types })}`)) || [],
  klass: (name, source) => getJson(`/api/5e/class?${qs({ name, source })}`),
  classes: async () => (await getJson('/api/5e/classes')) || [],
  subclass: (cls, classSource, short, source) => getJson(`/api/5e/subclass?${qs({ class: cls, classSource, short, source })}`),
  search: async (q, kind) => (await getJson(`/api/5e/search?${qs({ q, kind })}`)) || [],
  levelup: (cls, subclass, from, to) => getJson(`/api/5e/levelup?${qs({ class: cls, subclass, from, to })}`),
  mastery: async () => (await getJson('/api/5e/mastery')) || [],
  filter: async (cat, f) => (await getJson(`/api/5e/filter?${qs({ cat, f })}`)) || [],
  books: async () => (await getJson('/api/5e/books')) || [],
  book: (kind, id, ch, section) => getJson(`/api/5e/book?${qs({ kind, id, ch, section })}`),
  entry: (kind, name, source, extra = {}) => getJson(`/api/5e/entry?${qs({ kind, name, source, ...extra })}`),
};

export function fold(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
