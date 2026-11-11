// Ordre d'initiative. Rien sur les PV ou les dégâts : seulement les tours.
// Une ligne est soit un PJ, soit un groupe de créatures : un seul jet, un seul tour.
// Un combat se lance depuis une sélection : les créatures identiques forment un groupe.
// Un groupe dont tous les tokens sont vaincus reste affiché et son tour est sauté.

export function newFight() {
  return { started: false, round: 0, current: null, rows: [] };
}

// Identifiant court, unique dans ce combat.
function rowId(rows) {
  let n = rows.length + 1;
  while (rows.some(r => r.id === `r${n}`)) n++;
  return `r${n}`;
}
const d20 = rng => 1 + Math.floor(rng() * 20);

function modOf(tokens) {
  const mods = tokens.map(t => (Number.isFinite(t.init) ? t.init : 0));
  return mods.length ? Math.max(...mods) : 0;
}

// Plus haut total d'abord, puis plus haut modificateur. Tri stable : un ordre réglé à la main
// entre deux égalités reste en place. Sans nombre : en bas, en attendant que le MJ le saisisse.
export function sortRows(rows) {
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ta = a.r.total == null ? -Infinity : a.r.total;
      const tb = b.r.total == null ? -Infinity : b.r.total;
      return tb - ta || (b.r.mod || 0) - (a.r.mod || 0) || a.i - b.i;
    })
    .map(x => x.r);
}

export function isOut(row, tokens) {
  if (row.kind === 'pc' || !row.tokenIds.length) return false;
  const byId = new Map(tokens.map(t => [t.id, t]));
  return row.tokenIds.every(id => { const t = byId.get(id); return !t || t.defeated; });
}

function withoutTokens(fight, ids) {
  const set = new Set(ids);
  const rows = [];
  let current = fight.current;
  fight.rows.forEach((r, i) => {
    if (!r.tokenIds.some(id => set.has(id))) { rows.push(r); return; }
    const left = r.tokenIds.filter(id => !set.has(id));
    if (left.length) { rows.push({ ...r, tokenIds: left }); return; }
    if (current === r.id) {
      // La ligne en cours disparaît : le tour passe à la suivante.
      const after = fight.rows.slice(i + 1).find(x => x.tokenIds.some(id => !set.has(id)));
      current = after ? after.id : null;
    }
  });
  return { ...fight, rows, current };
}

export function addPcRows(fight, tokens) {
  const known = new Set(fight.rows.flatMap(r => r.tokenIds));
  const rows = [...fight.rows];
  for (const t of tokens) {
    if (t.kind !== 'pc' || t.hidden || known.has(t.id)) continue;
    rows.push({ id: rowId(rows), kind: 'pc', name: t.name, tokenIds: [t.id], mod: 0, roll: null, total: null });
  }
  return { ...fight, rows: sortRows(rows) };
}

// Un groupe : un jet de d20 plus le plus haut modificateur du groupe.
export function addGroup(fight, { name, tokens }, rng = Math.random) {
  if (!tokens.length) return fight;
  const base = withoutTokens(fight, tokens.map(t => t.id));
  const mod = modOf(tokens);
  const roll = d20(rng);
  const row = {
    id: rowId(base.rows), kind: tokens.every(t => t.kind === 'pc') ? 'pc' : 'group',
    name: name || groupName(tokens), tokenIds: tokens.map(t => t.id), mod, roll, total: roll + mod,
  };
  return settle({ ...base, rows: sortRows([...base.rows, row]) });
}

// Sans groupe : une ligne et un jet par token.
export function addEach(fight, tokens, rng = Math.random) {
  return tokens.reduce((f, t) => addGroup(f, { name: t.name, tokens: [t] }, rng), fight);
}

// Ce qui fait deux créatures « identiques » : la même fiche, sinon le même nom sans numéro.
const baseName = name => String(name || '').replace(/\s*#?\d+$/, '').trim();

export function groupKey(t) {
  if (t.ref?.t === 'monster') return `m|${t.ref.name}|${t.ref.source || ''}`;
  if (t.ref?.t === 'note') return `n|${t.ref.file}|${t.ref.title}`;
  return `name|${baseName(t.name).toLowerCase()}`;
}

function rowName(tokens) {
  if (tokens.length === 1) return tokens[0].name;
  const base = baseName(tokens[0].name);
  return base && tokens.every(t => baseName(t.name) === base) ? `${base} ×${tokens.length}` : groupName(tokens);
}

// Ajoute des tokens au combat : un PJ par ligne, sans nombre ; les créatures identiques ensemble.
export function addTokens(fight, tokens, rng = Math.random) {
  const known = new Set(fight.rows.flatMap(r => r.tokenIds));
  const fresh = tokens.filter(t => !known.has(t.id));
  const rows = [...fight.rows];
  for (const t of fresh.filter(x => x.kind === 'pc')) {
    rows.push({ id: rowId(rows), kind: 'pc', name: t.name, tokenIds: [t.id], mod: 0, roll: null, total: null });
  }
  let f = settle({ ...fight, rows: sortRows(rows) });
  const groups = new Map();
  for (const t of fresh) {
    if (t.kind === 'pc') continue;
    const k = groupKey(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  for (const list of groups.values()) f = addGroup(f, { name: rowName(list), tokens: list }, rng);
  return f;
}

// Un groupe redevient une ligne et un jet par token.
export function split(fight, rId, tokens, rng = Math.random) {
  const row = fight.rows.find(r => r.id === rId);
  if (!row || row.kind === 'pc' || row.tokenIds.length < 2) return fight;
  const byId = new Map(tokens.map(t => [t.id, t]));
  const list = row.tokenIds.map(id => byId.get(id)).filter(Boolean);
  const wasCurrent = fight.current === rId;
  let f = addEach({ ...fight, rows: fight.rows.filter(r => r.id !== rId), current: wasCurrent ? null : fight.current }, list, rng);
  if (wasCurrent) f = { ...f, current: f.rows.find(r => r.tokenIds.some(id => row.tokenIds.includes(id)))?.id || null };
  return f;
}

// Tant que personne n'a joué, le tour revient au premier de l'ordre : saisir l'initiative
// des PJ après avoir lancé le combat remet le bon tour en tête.
function settle(f) {
  if (!f.started || !f.fresh) return f;
  return { ...f, current: f.rows[0]?.id || null };
}

export function groupName(tokens) {
  const counts = new Map();
  for (const t of tokens) counts.set(t.name, (counts.get(t.name) || 0) + 1);
  return [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ');
}

export function addToRow(fight, rId, tokens) {
  const base = withoutTokens(fight, tokens.map(t => t.id));
  const rows = base.rows.map(r => {
    if (r.id !== rId) return r;
    return { ...r, tokenIds: [...r.tokenIds, ...tokens.map(t => t.id)] };
  });
  return { ...base, rows };
}

export function removeTokens(fight, ids) {
  return withoutTokens(fight, ids);
}

export function setRow(fight, rId, patch) {
  let rows = fight.rows.map(r => {
    if (r.id !== rId) return r;
    const next = { ...r };
    if (typeof patch.name === 'string') next.name = patch.name;
    if ('total' in patch) next.total = patch.total === null || patch.total === '' ? null : Number(patch.total);
    return next;
  });
  if ('total' in patch) rows = sortRows(rows);
  return settle({ ...fight, rows });
}

export function reroll(fight, rId, tokens, rng = Math.random) {
  const row = fight.rows.find(r => r.id === rId);
  if (!row || row.kind === 'pc') return fight;
  const byId = new Map(tokens.map(t => [t.id, t]));
  const mod = modOf(row.tokenIds.map(id => byId.get(id)).filter(Boolean));
  const roll = d20(rng);
  const rows = fight.rows.map(r => (r.id === rId ? { ...r, mod, roll, total: roll + mod } : r));
  return settle({ ...fight, rows: sortRows(rows) });
}

export function removeRow(fight, rId) {
  const i = fight.rows.findIndex(r => r.id === rId);
  if (i < 0) return fight;
  const rows = fight.rows.filter(r => r.id !== rId);
  let { current } = fight;
  if (current === rId) current = rows[i]?.id || rows[0]?.id || null;
  return { ...fight, rows, current };
}

export function moveRow(fight, rId, dir) {
  const i = fight.rows.findIndex(r => r.id === rId);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= fight.rows.length) return fight;
  const rows = [...fight.rows];
  [rows[i], rows[j]] = [rows[j], rows[i]];
  return settle({ ...fight, rows });
}

export function start(fight, tokens) {
  const first = fight.rows.find(r => !isOut(r, tokens));
  return { ...fight, started: true, fresh: true, round: 1, current: first ? first.id : null };
}

// Tour suivant : saute les groupes vaincus ; au retour en haut de l'ordre, nouveau round.
export function next(fight, tokens) {
  return step(fight, tokens, 1);
}

export function previous(fight, tokens) {
  return step(fight, tokens, -1);
}

function step(fight, tokens, dir) {
  const { rows } = fight;
  if (!fight.started) return start(fight, tokens);
  if (!rows.length) return fight;
  let i = rows.findIndex(r => r.id === fight.current);
  if (i < 0) i = dir > 0 ? -1 : 0;
  let { round } = fight;
  for (let n = 0; n < rows.length; n++) {
    i += dir;
    if (i >= rows.length) { i = 0; round++; }
    if (i < 0) {
      if (round <= 1) return fight;
      i = rows.length - 1;
      round--;
    }
    if (!isOut(rows[i], tokens)) return { ...fight, current: rows[i].id, round, fresh: false };
  }
  return fight;
}
