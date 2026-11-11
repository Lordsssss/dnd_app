// Actions de jeu : fonctions pures qui modifient un brouillon de fiche.
// Le serveur les exécute, calcule le diff, puis diffuse les patchs.
import { isPlainObject, newId } from './patch.js';
import { tl } from './i18n.js';
import { applyAutoSlots, normalizeCharacter } from './model.js';
import { applyLevelUp, LevelUpError } from './levelup.js';
import {
  abilityMod, classKey, defaultResources, fromBase, hitDiceOf, num, payFromPurse,
  splitEvenly, toBase, totalLevel, classLevel, formatPurse, DEFAULT_CURRENCY,
} from './rules.js';

export class ActionError extends Error {}
const fail = msg => { throw new ActionError(msg); };

// Langue des messages : le moteur la règle le temps d'une action (les actions sont synchrones).
let LANG = 'fr';
export function inLang(lang, fn) {
  const prev = LANG;
  LANG = lang || 'fr';
  try { return fn(); } finally { LANG = prev; }
}
const T = (fr, vars) => tl(LANG, fr, vars);

const int = (v, min = -Infinity, max = Infinity) => Math.min(max, Math.max(min, Math.trunc(num(v))));

function wakeUp(doc) {
  doc.deathSaves = { success: 0, fail: 0 };
  if (doc.autoUnconscious) {
    doc.conditions = (doc.conditions || []).filter(c => c !== 'Unconscious');
    doc.autoUnconscious = false;
  }
}

function knockOut(doc) {
  if (!(doc.conditions || []).includes('Unconscious')) {
    doc.conditions = [...(doc.conditions || []), 'Unconscious'];
    doc.autoUnconscious = true;
  }
}

function findResource(doc, name) {
  return Object.values(doc.resources || {}).find(r => classKey(r.name) === classKey(name));
}

function resetResources(doc, kind) {
  for (const r of Object.values(doc.resources || {})) {
    const reset = r.reset || 'long';
    if (kind === 'short') {
      if (reset === 'short') r.used = 0;
      else if (reset === 'short1') r.used = Math.max(0, num(r.used) - 1);
    } else if (reset !== 'none') r.used = 0;
  }
}

export function sanitizeItem(it = {}) {
  const out = {
    name: String(it.name || 'Objet').slice(0, 200),
    qty: int(it.qty ?? 1, 0, 1e6),
    weight: Math.max(0, Math.round((Number(it.weight) || 0) * 100) / 100),
    notes: String(it.notes || '').slice(0, 5000),
  };
  if (it.source) out.source = String(it.source).slice(0, 20);
  if (it.rarity) out.rarity = String(it.rarity).slice(0, 40);
  if (it.attunement) out.attunement = true;
  if (it.consumable) out.consumable = true;
  if (isPlainObject(it.charges) && num(it.charges.max) > 0) {
    out.charges = { max: int(it.charges.max, 0, 999), used: int(it.charges.used, 0, 999) };
  }
  if (it.order != null) out.order = num(it.order);
  return out;
}

function nextOrder(coll) {
  return Object.values(coll || {}).reduce((m, it) => Math.max(m, num(it.order)), -1) + 1;
}

// ---------------------------------------------------------------- Fiche

export const CHAR_ACTIONS = {
  damage(doc, { amount, crit }) {
    amount = int(amount, 0, 9999);
    if (!amount) fail('Montant invalide');
    const hp = doc.hp;
    let rest = amount;
    const absorbed = Math.min(num(hp.temp), rest);
    hp.temp = num(hp.temp) - absorbed;
    rest -= absorbed;
    const msgs = [];
    if (absorbed) msgs.push(T('{n} absorbés par les PV temporaires', { n: absorbed }));
    const before = num(hp.current);
    if (rest > 0) {
      if (before <= 0) {
        if (rest >= num(hp.max)) msgs.push(T('Dégâts massifs : mort instantanée'));
        doc.deathSaves.fail = Math.min(3, num(doc.deathSaves.fail) + (crit ? 2 : 1));
        msgs.push(T('Échec de jet de mort automatique ({n}/3)', { n: doc.deathSaves.fail }));
      } else {
        hp.current = Math.max(0, before - rest);
        if (hp.current === 0) {
          if (rest - before >= num(hp.max)) msgs.push(T('Dégâts massifs : mort instantanée'));
          else msgs.push(T('À 0 PV : Unconscious, jets de mort'));
          knockOut(doc);
        }
      }
    }
    if (doc.concentration) {
      if (num(hp.current) <= 0) {
        msgs.push(T('Concentration sur {name} perdue', { name: doc.concentration.name }));
        doc.concentration = null;
      } else {
        const dc = Math.min(30, Math.max(10, Math.floor(amount / 2)));
        msgs.push(T('Concentration ({name}) : jet de sauvegarde CON DD {dc}', { name: doc.concentration.name, dc }));
      }
    }
    return { label: T('Dégâts : {n}', { n: amount }), toast: msgs.join(' · '), concentrationDC: doc.concentration ? Math.min(30, Math.max(10, Math.floor(amount / 2))) : null };
  },

  heal(doc, { amount }) {
    amount = int(amount, 0, 9999);
    if (!amount) fail('Montant invalide');
    const hp = doc.hp;
    const before = num(hp.current);
    hp.current = Math.min(num(hp.max), before + amount);
    if (before <= 0 && hp.current > 0) wakeUp(doc);
    return { label: T('Soins : {n}', { n: amount }), toast: before <= 0 ? T('Debout ! Jets de mort réinitialisés') : '' };
  },

  tempHp(doc, { amount }) {
    amount = int(amount, 0, 9999);
    // Les PV temporaires ne se cumulent pas : on garde le plus élevé.
    const prev = num(doc.hp.temp);
    doc.hp.temp = Math.max(prev, amount);
    return { label: T('PV temporaires : {n}', { n: amount }), toast: prev > amount ? T('Déjà {n} PV temporaires : on garde le plus élevé', { n: prev }) : '' };
  },

  deathSave(doc, { roll }) {
    roll = int(roll, 1, 20);
    const ds = doc.deathSaves;
    let toast;
    if (roll === 20) {
      doc.hp.current = Math.max(1, num(doc.hp.current));
      wakeUp(doc);
      toast = T('20 naturel : 1 PV, debout !');
    } else if (roll === 1) {
      ds.fail = Math.min(3, num(ds.fail) + 2);
      toast = T('1 naturel : deux échecs');
    } else if (roll >= 10) {
      ds.success = Math.min(3, num(ds.success) + 1);
      toast = T('Succès ({n}/3)', { n: ds.success });
    } else {
      ds.fail = Math.min(3, num(ds.fail) + 1);
      toast = T('Échec ({n}/3)', { n: ds.fail });
    }
    if (ds.success >= 3) toast += ` · ${T('stabilisé')}`;
    if (ds.fail >= 3) toast += ` · ${T('mort')}`;
    return { label: T('Jet de mort : {n}', { n: roll }), toast };
  },

  castSpell(doc, { spellId, slotLevel, pact, ritual }, ctx) {
    const s = doc.spells?.[spellId];
    if (!s) fail('Sort introuvable');
    const lvl = num(s.level);
    const sc = doc.spellcasting;
    let slotText = '';
    let castLevel = lvl;
    if (ritual) {
      if (!s.ritual) fail("Ce sort n'est pas un rituel");
      slotText = ' en rituel';
    } else if (lvl > 0) {
      if (pact) {
        const p = sc.pact;
        if (!p || num(p.used) >= num(p.max)) fail("Plus d'emplacement de Pact Magic");
        if (num(p.level) < lvl) fail('Emplacement de pacte trop faible');
        p.used = num(p.used) + 1;
        castLevel = num(p.level);
        slotText = ` (${T('Pact Magic, niveau {n}', { n: castLevel })})`;
      } else {
        const L = int(slotLevel || lvl, 1, 9);
        if (L < lvl) fail('Emplacement trop faible');
        const slot = sc.slots[L];
        if (!slot || num(slot.used) >= num(slot.max)) fail(T('Plus d\'emplacement de niveau {n}', { n: L }));
        slot.used = num(slot.used) + 1;
        castLevel = L;
        slotText = ` (${T('niveau {n}', { n: L })})`;
      }
    }
    let toast = `${T('{name} lancé', { name: s.name })}${slotText}`;
    if (s.concentration) {
      const prev = doc.concentration;
      if (prev && prev.spellId !== spellId) toast += ` · ${T('concentration sur {name} terminée', { name: prev.name })}`;
      doc.concentration = { name: s.name, spellId, level: castLevel, since: ctx?.now || Date.now() };
    }
    return { label: T('Lance {name}', { name: s.name }), toast };
  },

  endConcentration(doc) {
    const prev = doc.concentration;
    doc.concentration = null;
    return { label: T('Fin de concentration'), toast: prev ? T('Concentration sur {name} terminée', { name: prev.name }) : '' };
  },

  shortRest(doc, { hitDice = [], arcane = [] } = {}) {
    if (!Array.isArray(hitDice) || !Array.isArray(arcane)) fail('Repos invalide');
    const con = abilityMod(doc, 'con');
    const dice = hitDiceOf(doc);
    const before = num(doc.hp.current);
    let healed = 0;
    const rolls = [];
    for (const h of hitDice.slice(0, 40)) {
      const d = dice.find(x => x.die === h.die);
      if (!d) fail(T('Dé de vie inconnu : {die}', { die: h.die }));
      if (d.used >= d.max) fail(T('Plus de dé de vie {die}', { die: d.die }));
      const roll = int(h.roll, 1, d.size);
      const gain = Math.max(0, roll + con);
      d.used++;
      doc.hitDiceUsed[d.die] = d.used;
      healed += gain;
      rolls.push(`${d.die}: ${roll}${con ? (con > 0 ? `+${con}` : con) : ''}`);
    }
    doc.hp.current = Math.min(num(doc.hp.max), before + healed);
    if (before <= 0 && doc.hp.current > 0) wakeUp(doc);

    const msgs = [];
    if (hitDice.length) msgs.push(`+${doc.hp.current - before} PV (${rolls.join(', ')})`);
    if (arcane.length) {
      const res = findResource(doc, 'Arcane Recovery');
      if (!res) fail('Pas de ressource « Arcane Recovery » sur la fiche');
      if (num(res.used) >= num(res.max)) fail('Arcane Recovery déjà utilisé');
      const levels = arcane.map(l => int(l, 1, 9));
      const total = levels.reduce((a, b) => a + b, 0);
      const cap = Math.ceil(Math.max(1, classLevel(doc, 'wizard') || totalLevel(doc)) / 2);
      if (levels.some(l => l > 5)) fail('Arcane Recovery : niveau 5 maximum');
      if (total > cap) fail(T('Arcane Recovery : {n} niveaux d\'emplacement maximum', { n: cap }));
      for (const L of levels) {
        const slot = doc.spellcasting.slots[L];
        if (!slot || num(slot.used) <= 0) fail(T('Aucun emplacement de niveau {n} à récupérer', { n: L }));
        slot.used = num(slot.used) - 1;
      }
      res.used = num(res.used) + 1;
      msgs.push(`Arcane Recovery : ${levels.map(l => T('niv. {n}', { n: l })).join(', ')}`);
    }
    resetResources(doc, 'short');
    if (doc.spellcasting.pact && num(doc.spellcasting.pact.max) > 0) {
      doc.spellcasting.pact.used = 0;
      msgs.push(T('Pact Magic rechargé'));
    }
    return { label: 'Short Rest', toast: [T('Short Rest terminé'), ...msgs].join(' · '), rest: 'short' };
  },

  longRest(doc, _args, ctx) {
    const mode = ctx?.rules?.longRestHitDice === 'all' ? 'all' : 'half';
    doc.hp.current = num(doc.hp.max);
    doc.hp.temp = 0;
    const sc = doc.spellcasting;
    for (let l = 1; l <= 9; l++) if (sc.slots[l]) sc.slots[l].used = 0;
    if (sc.pact) sc.pact.used = 0;
    const dice = hitDiceOf(doc);
    const totalHD = dice.reduce((s, d) => s + d.max, 0);
    let regain = mode === 'all' ? totalHD : Math.max(1, Math.floor(totalHD / 2));
    let regained = 0;
    for (const d of dice) {
      const back = Math.min(d.used, regain);
      d.used -= back;
      regain -= back;
      regained += back;
      doc.hitDiceUsed[d.die] = d.used;
    }
    const exh = num(doc.exhaustion);
    doc.exhaustion = Math.max(0, exh - 1);
    resetResources(doc, 'long');
    wakeUp(doc);
    const msgs = ['PV au maximum', 'emplacements rechargés'];
    if (regained) msgs.push(T(regained > 1 ? '{n} dés de vie récupérés' : '{n} dé de vie récupéré', { n: regained }));
    if (exh > 0) msgs.push(`Exhaustion ${exh} → ${doc.exhaustion}`);
    return { label: 'Long Rest', toast: [T('Long Rest terminé'), ...msgs].join(' · '), rest: 'long' };
  },

  levelUp(doc, args = {}) {
    const ch = { ...args };
    if (ch.newClass) ch.newClass = classKey(ch.newClass);
    try {
      return applyLevelUp(doc, ch);
    } catch (e) {
      if (e instanceof LevelUpError) fail(e.message);
      throw e;
    }
  },

  autoSlots(doc) {
    doc.spellcasting.slotsAuto = true;
    applyAutoSlots(doc);
    return { label: 'Emplacements recalculés' };
  },

  useItem(doc, { itemId }) {
    const it = doc.inventory?.[itemId];
    if (!it) fail('Objet introuvable');
    if (it.charges && num(it.charges.max) > 0) {
      if (num(it.charges.used) >= num(it.charges.max)) fail(T('{name} : plus de charges', { name: it.name }));
      it.charges.used = num(it.charges.used) + 1;
      return { label: T('Utilise {name}', { name: it.name }), toast: T('{name} : {left}/{max} charges', { name: it.name, left: it.charges.max - it.charges.used, max: it.charges.max }) };
    }
    if (num(it.qty, 1) <= 0) fail(T('Plus de {name}', { name: it.name }));
    it.qty = num(it.qty, 1) - 1;
    return { label: T('Utilise {name}', { name: it.name }), toast: T('{name} : reste {n}', { name: it.name, n: it.qty }) };
  },

  pay(doc, { amount, denom }, ctx) {
    const denoms = ctx?.denoms || DEFAULT_CURRENCY;
    const d = denoms.find(x => x.key === denom) || fail('Monnaie inconnue');
    const base = int(amount, 0, 1e9) * d.value;
    if (!base) fail('Montant invalide');
    const p = payFromPurse(doc.currency, base, denoms, denom);
    if (!p) fail("Pas assez d'argent");
    doc.currency = p;
    return { label: T('Paie {n} {coin}', { n: amount, coin: d.label }) };
  },

  receive(doc, { amount, denom }, ctx) {
    const denoms = ctx?.denoms || DEFAULT_CURRENCY;
    const d = denoms.find(x => x.key === denom) || fail('Monnaie inconnue');
    const n = int(amount, 0, 1e9);
    if (!n) fail('Montant invalide');
    doc.currency[d.key] = num(doc.currency[d.key]) + n;
    return { label: T('Reçoit {n} {coin}', { n, coin: d.label }) };
  },

  consolidate(doc, _args, ctx) {
    const denoms = ctx?.denoms || DEFAULT_CURRENCY;
    doc.currency = fromBase(toBase(doc.currency, denoms), denoms);
    return { label: 'Pièces regroupées' };
  },

  importSheet(doc, { data }) {
    if (!isPlainObject(data)) fail('JSON invalide');
    const next = normalizeCharacter(data.character || data);
    // Le nom du joueur est réglé par la campagne, pas par le fichier importé.
    const player = doc.player || next.player;
    delete next.campaign;
    delete next.musicRemote;
    for (const k of Object.keys(doc)) delete doc[k];
    Object.assign(doc, next, { player });
    return { label: 'Import JSON', toast: 'Fiche importée' };
  },
};

// ---------------------------------------------------------------- Groupe
// ctx : { party, char(id), charIds, actorName, now, denoms }

function logMove(ctx, text) {
  const log = ctx.party.log;
  log[newId('l')] = { at: ctx.now, who: ctx.actorName, text };
  const ids = Object.keys(log);
  if (ids.length > 500) {
    ids.sort((a, b) => num(log[a].at) - num(log[b].at));
    for (const id of ids.slice(0, ids.length - 500)) delete log[id];
  }
}

function holderName(ctx, who) {
  return who === 'stash' ? 'la réserve du groupe' : ctx.char(who)?.name || '?';
}

function coll(ctx, who) {
  if (who === 'stash') return ctx.party.stash;
  const c = ctx.char(who);
  if (!c) fail('Destinataire introuvable');
  return c.inventory;
}

function purseIn(purse, denoms) {
  const out = {};
  for (const d of denoms) {
    const v = int(purse?.[d.key], 0, 1e9);
    if (v) out[d.key] = v;
  }
  return out;
}

export const PARTY_ACTIONS = {
  transfer(ctx, { from, to, itemId, qty }) {
    if (from === to) fail('Source et destination identiques');
    const src = coll(ctx, from);
    const dst = coll(ctx, to);
    const item = src[itemId];
    if (!item) fail('Objet introuvable');
    const have = num(item.qty, 1);
    const q = int(qty ?? have, 1, Math.max(1, have));
    const moving = sanitizeItem({ ...item, qty: q });
    delete moving.order;
    if (q >= have) delete src[itemId];
    else item.qty = have - q;
    const stackable = !moving.charges && !item.attuned;
    const same = stackable && Object.values(dst).find(it =>
      it.name === moving.name && !it.charges && !it.attuned && (it.notes || '') === (moving.notes || ''));
    if (same) same.qty = num(same.qty, 1) + q;
    else dst[newId('i')] = { ...moving, order: nextOrder(dst) };
    const text = `${holderName(ctx, from)} → ${holderName(ctx, to)} : ${q}× ${moving.name}`;
    logMove(ctx, text);
    return { label: 'Transfert', toast: text };
  },

  stashAdd(ctx, { item }) {
    const it = sanitizeItem(item);
    it.order = nextOrder(ctx.party.stash);
    ctx.party.stash[newId('i')] = it;
    logMove(ctx, `Ajout à la réserve : ${it.qty}× ${it.name}`);
    return { label: 'Ajout réserve' };
  },

  stashRemove(ctx, { itemId }) {
    const it = ctx.party.stash[itemId];
    if (!it) fail('Objet introuvable');
    delete ctx.party.stash[itemId];
    logMove(ctx, `Retiré de la réserve : ${num(it.qty, 1)}× ${it.name}`);
    return { label: 'Retrait réserve' };
  },

  deposit(ctx, { charId, purse }) {
    const denoms = ctx.denoms;
    const c = ctx.char(charId) || fail('Personnage introuvable');
    const p = purseIn(purse, denoms);
    if (!Object.keys(p).length) fail('Montant invalide');
    for (const [k, v] of Object.entries(p)) {
      if (num(c.currency[k]) < v) fail(T('Pas assez de {coin}', { coin: denoms.find(d => d.key === k).label }));
    }
    for (const [k, v] of Object.entries(p)) {
      c.currency[k] = num(c.currency[k]) - v;
      ctx.party.fund[k] = num(ctx.party.fund[k]) + v;
    }
    logMove(ctx, `${c.name} verse ${formatPurse(p, denoms)} au fonds commun`);
    return { label: 'Dépôt' };
  },

  withdraw(ctx, { charId, purse }) {
    const denoms = ctx.denoms;
    const c = ctx.char(charId) || fail('Personnage introuvable');
    const p = purseIn(purse, denoms);
    if (!Object.keys(p).length) fail('Montant invalide');
    for (const [k, v] of Object.entries(p)) {
      if (num(ctx.party.fund[k]) < v) fail('Fonds commun insuffisant');
    }
    for (const [k, v] of Object.entries(p)) {
      ctx.party.fund[k] = num(ctx.party.fund[k]) - v;
      c.currency[k] = num(c.currency[k]) + v;
    }
    logMove(ctx, `${c.name} prend ${formatPurse(p, denoms)} dans le fonds commun`);
    return { label: 'Retrait' };
  },

  split(ctx) {
    const denoms = ctx.denoms;
    const ids = ctx.charIds;
    if (!ids.length) fail('Aucun personnage');
    const { share, shareBase, remainder } = splitEvenly(ctx.party.fund, ids.length, denoms);
    if (!shareBase) fail('Fonds commun trop faible pour être partagé');
    for (const id of ids) {
      const c = ctx.char(id);
      for (const [k, v] of Object.entries(share)) if (v) c.currency[k] = num(c.currency[k]) + v;
    }
    ctx.party.fund = remainder;
    const text = `Partage du fonds commun : ${formatPurse(share, denoms)} chacun (${ids.length} personnages)`;
    logMove(ctx, text);
    return { label: 'Partage', toast: text };
  },
};
