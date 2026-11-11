// Ce que la carte tire d'une créature 5etools. Le calibrage et l'XP n'ont rien à faire ici.

const FOOTPRINT = { T: 1, S: 1, M: 1, L: 2, H: 3, G: 4 };

function crNumber(cr) {
  const v = cr && typeof cr === 'object' ? cr.cr : cr;
  if (v == null) return 0;
  if (String(v).includes('/')) {
    const [a, b] = String(v).split('/').map(Number);
    return a / b;
  }
  return Number(v) || 0;
}

export function proficiencyBonus(cr) {
  return 2 + Math.floor(Math.max(0, Math.ceil(crNumber(cr)) - 1) / 4);
}

const modOf = score => Math.floor((Number(score) - 10) / 2);

// Le bloc 2024 donne l'initiative ; sinon, c'est le modificateur de DEX.
export function initiativeMod(m) {
  const dex = Number.isFinite(Number(m?.dex)) ? modOf(m.dex) : 0;
  const init = m?.initiative;
  if (typeof init === 'number') return init;
  if (init && typeof init === 'object') {
    if (typeof init.initiative === 'number') return init.initiative;
    return dex + (Number(init.proficiency) || 0) * proficiencyBonus(m.cr);
  }
  return dex;
}

export function footprintOf(m) {
  const s = Array.isArray(m?.size) ? m.size[0] : m?.size;
  return FOOTPRINT[s] || 1;
}

export function bestiaryLink(name, source) {
  const key = `${String(name).toLowerCase()}_${String(source || '').toLowerCase()}`;
  return `https://5e.tools/bestiary.html#${encodeURIComponent(key).replace(/%5F/g, '_')}`;
}
