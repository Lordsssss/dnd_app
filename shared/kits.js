// Lots préparés par le MJ : des objets à donner et des objets à retirer d'une fiche, en un clic.
//
// Un lot donne des objets et de l'argent, et peut d'abord retirer ce que la fiche porte. Chaque
// objet retiré a un sort : il reste (« stay »), il est rangé pour être rendu plus tard (« keep »),
// ou il est perdu (« lose »). Ce qui est rangé part dans un nouveau lot, à rendre d'un clic.
import { isPlainObject } from './patch.js';
import { attunedCount, MAX_ATTUNED, num } from './rules.js';

export const FATES = ['stay', 'keep', 'lose'];

const str = (v, max) => String(v ?? '').slice(0, max);
const int = (v, min, max) => Math.min(max, Math.max(min, Math.trunc(num(v))));
const fate = (v, d = 'stay') => (FATES.includes(v) ? v : d);

// Nom comparé sans accents, casse ni espaces doublés : « Potion of  healing » = « Potion of Healing ».
export function sameName(a, b) {
  const k = s => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  return k(a) === k(b);
}

// Un objet tel qu'il est gardé dans un lot : tout ce que la fiche connaît, sauf l'ordre.
export function kitItem(it = {}) {
  const out = {
    name: str(it.name || 'Objet', 200),
    qty: int(it.qty ?? 1, 0, 1e6),
    notes: str(it.notes, 5000),
  };
  const w = Math.max(0, Math.round((Number(it.weight) || 0) * 100) / 100);
  if (w) out.weight = w;
  if (it.source) out.source = str(it.source, 20);
  if (it.rarity) out.rarity = str(it.rarity, 40);
  for (const k of ['attunement', 'consumable', 'equipped', 'stored']) if (it[k]) out[k] = true;
  if (it.attuned && it.attunement) out.attuned = true;
  if (isPlainObject(it.charges) && num(it.charges.max) > 0) {
    out.charges = { max: int(it.charges.max, 0, 999), used: int(it.charges.used, 0, 999) };
  }
  return out;
}

function purse(p) {
  const out = {};
  if (!isPlainObject(p)) return out;
  for (const [k, v] of Object.entries(p)) {
    const n = int(v, 0, 1e9);
    if (n && /^[a-z]{1,4}$/i.test(k)) out[k] = n;
  }
  return out;
}

// Ce que le MJ peut écrire. L'historique et l'annulation sont tenus par le serveur.
export function normalizeKit(raw = {}) {
  const r = isPlainObject(raw) ? raw : {};
  const give = isPlainObject(r.give) ? r.give : {};
  const take = isPlainObject(r.take) ? r.take : {};
  return {
    name: str(r.name, 120).trim() || 'Lot',
    folder: str(r.folder, 60).trim(),
    note: str(r.note, 2000),
    target: str(r.target, 40),
    order: num(r.order),
    give: {
      items: (Array.isArray(give.items) ? give.items : []).slice(0, 200).filter(isPlainObject).map(kitItem),
      currency: purse(give.currency),
    },
    take: {
      rest: fate(take.rest),
      money: fate(take.money),
      items: (Array.isArray(take.items) ? take.items : []).slice(0, 500).filter(isPlainObject)
        .map(x => ({ id: str(x.id, 40), name: str(x.name, 200), fate: fate(x.fate) })),
    },
    keepName: str(r.keepName, 120).trim(),
  };
}

export function kitTakes(kit) {
  const t = kit.take || {};
  return t.rest !== 'stay' || t.money !== 'stay' || (t.items || []).some(x => x.fate !== 'stay');
}

function nextOrder(inv) {
  return Object.values(inv || {}).reduce((m, it) => Math.max(m, num(it.order)), -1) + 1;
}

// Applique le lot à une fiche (modifiée sur place). Retourne ce qui s'est passé, et ce qui a été
// rangé pour plus tard : { removed, given, kept: { items, currency }, warnings }.
export function applyKitToDoc(doc, kit, { newId }) {
  const inv = doc.inventory || (doc.inventory = {});
  doc.currency = isPlainObject(doc.currency) ? doc.currency : {};
  const take = kit.take || { rest: 'stay', money: 'stay', items: [] };
  const report = { removed: [], given: [], kept: { items: [], currency: {} }, warnings: [] };

  // 1. Retirer. Une ligne du lot vise l'objet par son id, sinon par son nom.
  const fateOf = new Map();
  const unmatched = [];
  for (const ref of take.items || []) {
    if (ref.id && inv[ref.id] && !fateOf.has(ref.id)) fateOf.set(ref.id, ref.fate);
    else unmatched.push(ref);
  }
  for (const ref of unmatched) {
    const hit = Object.keys(inv).find(id => !fateOf.has(id) && sameName(inv[id].name, ref.name));
    if (hit) fateOf.set(hit, ref.fate);
    else if (ref.fate !== 'stay') report.warnings.push({ kind: 'missing', name: ref.name });
  }
  const ids = Object.keys(inv).sort((a, b) => num(inv[a].order) - num(inv[b].order));
  for (const id of ids) {
    const f = fateOf.get(id) ?? take.rest;
    if (f === 'stay') continue;
    const it = inv[id];
    delete inv[id];
    report.removed.push({ name: it.name, qty: num(it.qty, 1), fate: f });
    if (f === 'keep') report.kept.items.push({ ...kitItem(it), order: num(it.order) });
  }
  report.kept.items.sort((a, b) => a.order - b.order).forEach(it => delete it.order);
  if (take.money !== 'stay') {
    const coins = purse(doc.currency);
    if (Object.keys(coins).length) {
      for (const k of Object.keys(doc.currency)) doc.currency[k] = 0;
      report.removed.push({ money: coins, fate: take.money });
      if (take.money === 'keep') report.kept.currency = coins;
    }
  }

  // 2. Donner. Un objet simple s'empile sur le même objet déjà porté.
  for (const src of kit.give?.items || []) {
    const it = kitItem(src);
    if (it.attuned && attunedCount(doc) >= MAX_ATTUNED) {
      delete it.attuned;
      report.warnings.push({ kind: 'attune', name: it.name });
    }
    const stackable = !it.charges && !it.attuned;
    const same = stackable && Object.values(inv).find(x =>
      x.name === it.name && !x.charges && !x.attuned && (x.notes || '') === (it.notes || ''));
    if (same) same.qty = num(same.qty, 1) + it.qty;
    else inv[newId('i')] = { ...it, order: nextOrder(inv) };
    report.given.push({ name: it.name, qty: it.qty });
  }
  const coins = purse(kit.give?.currency);
  for (const [k, v] of Object.entries(coins)) doc.currency[k] = num(doc.currency[k]) + v;
  if (Object.keys(coins).length) report.given.push({ money: coins });
  return report;
}
