// Jets de dés : lancés sur la tablette (réponse instantanée), puis envoyés au journal partagé.
import { rollExpression, signed } from '/shared/rules.js';
import { store, notify, sendRoll } from './store.js';

function rng() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

function show(roll) {
  store.lastRoll = { ...roll, shownAt: Date.now() };
  notify();
  clearTimeout(show.t);
  show.t = setTimeout(() => { store.lastRoll = null; notify(); }, 4500);
}

// Jet de d20 avec modificateur ; avantage/désavantage selon le mode choisi (usage unique).
export function rollD20(label, mod = 0, { mode = store.ui.rollMode, crit = 20 } = {}) {
  const a = 1 + Math.floor(rng() * 20);
  const b = 1 + Math.floor(rng() * 20);
  const nat = mode === 'adv' ? Math.max(a, b) : mode === 'dis' ? Math.min(a, b) : a;
  const total = nat + mod;
  const dice = mode ? `d20 (${a}, ${b})` : `d20 (${a})`;
  const roll = {
    label, expr: `1d20${mod ? signed(mod) : ''}`, total, nat, mode,
    detail: `${dice}${mod ? ` ${mod >= 0 ? '+' : '−'} ${Math.abs(mod)}` : ''}${nat === 20 ? ' · 20 naturel' : nat === 1 ? ' · 1 naturel' : nat >= crit ? ' · critique' : ''}`,
  };
  store.ui.rollMode = null;
  show(roll);
  sendRoll(roll);
  return roll;
}

export function rollFormula(label, expr, { send = true } = {}) {
  const r = rollExpression(expr, rng);
  if (!r) return null;
  const detail = r.parts.map((p, i) => {
    const s = p.sign < 0 ? '− ' : i ? '+ ' : '';
    return p.kind === 'dice' ? `${s}d${p.sides} (${p.dice.join(', ')})` : `${s}${p.value}`;
  }).join(' ');
  const roll = { label, expr: r.expr, total: r.total, detail, mode: null, nat: r.parts.length === 1 && r.parts[0].kind === 'dice' && r.parts[0].dice.length === 1 ? r.parts[0].dice[0] : null };
  if (send) { show(roll); sendRoll(roll); }
  return roll;
}

export function rollDie(sides) {
  return 1 + Math.floor(rng() * sides);
}

export { show as showRoll };
