// Moteur des fiches : état en mémoire, permissions, actions, historique d'annulation.
// Indépendant du transport (WebSocket) pour pouvoir être testé seul.
//
// Chaque document (fiche ou réserve) appartient à une campagne. Un client est :
//   { id, role: 'dm' | 'player', campaign, charId, accountId }
// `dm` couvre le MJ et les co-MJ de la campagne : il lit tout, secrets compris, et modifie
// toutes les fiches et la réserve. Un joueur modifie sa fiche et voit les autres en lecture seule.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { applyPatch, clone, diff, getIn, newId, pathKey, validPath } from '../shared/patch.js';
import { CHAR_ACTIONS, PARTY_ACTIONS, ActionError, inLang } from '../shared/actions.js';
import { EDITABLE_KEYS, blankParty, normalizeCharacter, normalizeParty } from '../shared/model.js';
import { attunedCount, infusionLimits, MAX_ATTUNED, DEFAULT_CURRENCY } from '../shared/rules.js';
import { tl } from '../shared/i18n.js';

export function partyIdFor(campaign) {
  return `party:${campaign}`;
}

const MAX_UNDO = 150;
const MERGE_MS = 2500;
const MAX_VALUE_BYTES = 400_000;
const STASH_FIELDS = new Set(['name', 'qty', 'weight', 'notes', 'charges']);

const SECTION_LABELS = {
  hp: 'PV', abilities: 'Caractéristiques', skills: 'Compétences', saves: 'Sauvegardes',
  spells: 'Sorts', spellcasting: 'Emplacements', inventory: 'Inventaire', currency: 'Bourse',
  attacks: 'Attaques', resources: 'Ressources', notes: 'Notes', secret: 'Secret',
  conditions: 'Conditions', deathSaves: 'Jets de mort', drawings: 'Dessin', featureList: 'Capacités',
};

function labelFor(ops, lang = 'fr') {
  const p = ops[0][0];
  if (p[0] === 'drawings' || (p[0] === 'secret' && p[1] === 'drawing')) {
    return tl(lang, ops.every(o => o.length < 2) ? 'Gomme' : 'Trait');
  }
  const sec = tl(lang, SECTION_LABELS[p[0]] || p[0]);
  if (ops.length === 1 && ops[0].length < 2) return tl(lang, 'Suppression ({section})', { section: sec });
  return tl(lang, 'Modification ({section})', { section: sec });
}

// Ce qu'un joueur ne voit pas d'un jet de mort secret : le décompte, sous toutes ses formes.
const DEATH_WORDS = /jet de mort|jets de mort|stabilisé|· mort|mort instantanée|succès \(|échec \(|deux échecs|death save/i;

export class Engine extends EventEmitter {
  // settingsOf(campaignId) → réglages de la campagne (monnaie, règles, jets de mort secrets…).
  constructor({ db, settingsOf = () => ({}), now = () => Date.now(), random = n => crypto.randomInt(1, n + 1) }) {
    super();
    this.db = db;
    this.settingsOf = settingsOf;
    this.now = now;
    this.random = random;
    this.docs = new Map();
    this.stacks = new Map();
    this.dirty = new Set();
  }

  load() {
    for (const r of this.db.allDocs()) {
      if (!r.campaign) continue;
      const data = r.kind === 'party' ? normalizeParty(r.data) : normalizeCharacter(r.data);
      this.docs.set(r.id, { id: r.id, kind: r.kind, data, v: r.version, campaign: r.campaign, owner: r.owner || null });
      // Une ancienne fiche convertie au chargement (capacités en liste) : on l'enregistre tout de suite.
      if (r.kind === 'char' && r.data.features && !data.features) this.dirty.add(r.id);
    }
    return this;
  }

  denomsFor(campaign) {
    return this.settingsOf(campaign)?.currency || DEFAULT_CURRENCY;
  }

  secretDeathSaves(campaign) {
    return this.settingsOf(campaign)?.secretDeathSaves !== false;
  }

  // Toutes les fiches, toutes campagnes confondues (CLI, admin).
  chars() {
    return [...this.docs.values()].filter(d => d.kind === 'char')
      .sort((a, b) => (Number(a.data.meta?.createdAt) || 0) - (Number(b.data.meta?.createdAt) || 0)
        || String(a.data.name).localeCompare(String(b.data.name)) || a.id.localeCompare(b.id));
  }

  charsIn(campaign) {
    return this.chars().filter(c => c.campaign === campaign);
  }

  charsOwnedBy(accountId, campaign = null) {
    return this.chars().filter(c => c.owner === accountId && (campaign == null || c.campaign === campaign));
  }

  campaignOf(docId) {
    return this.docs.get(docId)?.campaign || null;
  }

  ownerOf(docId) {
    return this.docs.get(docId)?.owner || null;
  }

  party(campaign) {
    const id = partyIdFor(campaign);
    if (!this.docs.has(id)) {
      this.docs.set(id, { id, kind: 'party', data: blankParty(), v: 0, campaign, owner: null });
      this.dirty.add(id);
    }
    return this.docs.get(id);
  }

  findChar(nameOrId, campaign = null) {
    const q = String(nameOrId).toLowerCase();
    return this.chars().find(c => (campaign == null || c.campaign === campaign) && (c.id === nameOrId || String(c.data.name).toLowerCase() === q)) || null;
  }

  // ------------------------------------------------------------ Visibilité

  inCampaign(client, docId) {
    const e = this.docs.get(docId);
    return !!e && !!client.campaign && e.campaign === client.campaign;
  }

  canSeeSecret(client, docId) {
    return this.inCampaign(client, docId) && (client.role === 'dm' || client.charId === docId);
  }

  canSeeDeathSaves(client, docId) {
    if (!this.inCampaign(client, docId)) return false;
    if (client.role === 'dm') return true;
    return !this.secretDeathSaves(this.campaignOf(docId));
  }

  canEditDoc(client, docId) {
    const e = this.docs.get(docId);
    if (!e || !this.inCampaign(client, docId)) return false;
    if (client.role === 'dm') return true;
    if (e.kind === 'party') return client.role === 'player' && !!client.charId;
    return client.role === 'player' && client.charId === docId;
  }

  viewOf(client, entry) {
    if (entry.kind !== 'char') return entry.data;
    const hideSecret = !this.canSeeSecret(client, entry.id);
    const hideDeath = !this.canSeeDeathSaves(client, entry.id);
    if (!hideSecret && !hideDeath) return entry.data;
    const out = { ...entry.data };
    if (hideSecret) delete out.secret;
    if (hideDeath) delete out.deathSaves;
    return out;
  }

  stateFor(client) {
    const chars = {};
    if (!client.campaign) return { chars, party: { id: null, v: 0, data: blankParty() } };
    for (const c of this.charsIn(client.campaign)) chars[c.id] = { v: c.v, data: this.viewOf(client, c), owner: c.owner };
    const p = this.party(client.campaign);
    return { chars, party: { id: p.id, v: p.v, data: p.data } };
  }

  visibleTo(client, docId) {
    return this.inCampaign(client, docId);
  }

  filterPatches(client, docId, patches) {
    const e = this.docs.get(docId);
    if (!e || e.kind === 'party') return patches;
    const hideSecret = !this.canSeeSecret(client, docId);
    const hideDeath = !this.canSeeDeathSaves(client, docId);
    if (!hideSecret && !hideDeath) return patches;
    return patches.filter(([path]) => !(hideSecret && path[0] === 'secret') && !(hideDeath && path[0] === 'deathSaves'));
  }

  // Le message d'une action, tel que ce client a le droit de le lire.
  toastFor(client, docId, toast) {
    if (!toast || this.canSeeDeathSaves(client, docId)) return toast;
    return String(toast).split(' · ').filter(part => !DEATH_WORDS.test(part)).join(' · ');
  }

  // ------------------------------------------------------------ Historique

  stackKey(docId, path) {
    if (path[0] === 'drawings') return `${docId}|draw:${path[1]}`;
    if (path[0] === 'secret' && path[1] === 'drawing') return `${docId}|draw:secret`;
    return `${docId}|sheet`;
  }

  stack(key) {
    let s = this.stacks.get(key);
    if (!s) { s = { undo: [], redo: [] }; this.stacks.set(key, s); }
    return s;
  }

  stackInfo(docId) {
    const out = {};
    for (const [key, s] of this.stacks) {
      const [id, name] = key.split('|');
      if (id !== docId) continue;
      const top = s.undo[s.undo.length - 1];
      const next = s.redo[s.redo.length - 1];
      out[name] = { undo: s.undo.length, redo: s.redo.length, label: top?.label || '', redoLabel: next?.label || '', topId: top?.id || null };
    }
    return out;
  }

  // Les piles de toutes les fiches qu'un client peut modifier.
  stacksFor(client) {
    const out = {};
    for (const c of this.charsIn(client.campaign)) if (this.canEditDoc(client, c.id)) out[c.id] = this.stackInfo(c.id);
    return out;
  }

  pushUndo(key, entry) {
    const s = this.stack(key);
    const top = s.undo[s.undo.length - 1];
    if (entry.mergeKey && top && top.mergeKey === entry.mergeKey && entry.at - top.at < MERGE_MS) {
      top.fwd = entry.fwd;
      top.at = entry.at;
    } else {
      s.undo.push(entry);
      if (s.undo.length > MAX_UNDO) s.undo.shift();
    }
    s.redo = [];
  }

  // ------------------------------------------------------------ Commit

  commit(entry, patches, { origin = null, opId = null, kind = 'action', undo = null } = {}) {
    entry.v += 1;
    if (entry.kind === 'char') {
      entry.data.meta = entry.data.meta || {};
      entry.data.meta.updatedAt = this.now();
    }
    this.dirty.add(entry.id);
    if (undo && patches.fwd.length) this.pushUndo(undo.key, { id: newId('u'), label: undo.label, at: this.now(), fwd: patches.fwd, inv: patches.inv, mergeKey: undo.mergeKey });
    this.emit('patch', { doc: entry.id, v: entry.v, patches: patches.fwd, origin, opId, kind, campaign: entry.campaign });
    if (undo) this.emit('stacks', { doc: entry.id, stacks: this.stackInfo(entry.id), campaign: entry.campaign });
  }

  // Les limites dures : harmonisation et infusions. Les sorts préparés ne bloquent jamais :
  // la fiche affiche un avertissement, et le joueur garde la main (sorts gratuits, dons, objets).
  checkInvariants(before, after, lang = 'fr') {
    const a = attunedCount(after);
    if (a > MAX_ATTUNED && a > attunedCount(before)) throw new ActionError(tl(lang, 'Maximum {n} objets harmonisés', { n: MAX_ATTUNED }));
    const lim = infusionLimits(after);
    const activeInf = d => Object.values(d.infusions || {}).filter(i => i.active).length;
    if (lim && activeInf(after) > lim.active && activeInf(after) > activeInf(before)) throw new ActionError(tl(lang, 'Maximum {n} objets infusés à ce niveau', { n: lim.active }));
  }

  // ------------------------------------------------------------ Écritures directes

  handleSet(client, { doc: docId, ops, id: opId }) {
    const entry = this.docs.get(docId);
    if (!entry || !this.inCampaign(client, docId)) throw new ActionError('Fiche introuvable');
    if (!this.canEditDoc(client, docId)) throw new ActionError(entry.kind === 'char' ? "Ce n'est pas ta fiche" : 'Lecture seule');
    if (!Array.isArray(ops) || !ops.length || ops.length > 200) throw new ActionError('Requête invalide');
    for (const op of ops) {
      if (!Array.isArray(op) || !validPath(op[0])) throw new ActionError('Chemin invalide');
      if (op.length > 1 && JSON.stringify(op[1] ?? null).length > MAX_VALUE_BYTES) throw new ActionError('Valeur trop grande');
    }
    if (entry.kind === 'char') {
      const allowed = client.role === 'dm' ? k => EDITABLE_KEYS.has(k) || k === 'player' : k => EDITABLE_KEYS.has(k);
      if (!ops.every(([p]) => allowed(p[0]))) throw new ActionError('Champ non modifiable');
      if (!this.canSeeDeathSaves(client, docId) && ops.some(([p]) => p[0] === 'deathSaves')) throw new ActionError('Jets de mort secrets : le MJ les tient');
    } else {
      // Réserve du groupe : un joueur ne touche que les champs d'objets existants.
      const ok = ops.every(([p]) => p[0] === 'stash' && p.length >= 3 && entry.data.stash[p[1]] && STASH_FIELDS.has(p[2]));
      if (!ok && client.role !== 'dm') throw new ActionError('Champ non modifiable');
      if (!ok && !ops.every(([p]) => p[0] === 'stash' || p[0] === 'fund')) throw new ActionError('Champ non modifiable');
    }

    const before = entry.kind === 'char' ? clone(entry.data) : null;
    const fwd = [], inv = [];
    let changed = false;
    for (const op of ops) {
      const old = getIn(entry.data, op[0]);
      if (applyPatch(entry.data, op)) {
        fwd.push(op.length > 1 ? [op[0], op[1]] : [op[0]]);
        inv.unshift(old === undefined ? [op[0]] : [op[0], clone(old)]);
        if (JSON.stringify(old) !== JSON.stringify(op[1])) changed = true;
      }
    }
    if (before) {
      try { this.checkInvariants(before, entry.data, client.lang); } catch (e) {
        for (const p of inv) applyPatch(entry.data, p);
        throw e;
      }
    }
    const key = this.stackKey(docId, ops[0][0]);
    const undo = entry.kind === 'char' && changed
      ? { key, label: labelFor(ops, client.lang), mergeKey: ops.length === 1 ? pathKey(ops[0][0]) : null }
      : null;
    this.commit(entry, { fwd, inv }, { origin: client.id, opId, kind: 'set', undo });
    // Le journal reste en français : c'est celui du MJ et de l'admin.
    return { label: labelFor(ops), changed, mergeKey: pathKey(ops[0][0].slice(0, 2)) };
  }

  // ------------------------------------------------------------ Actions

  handleAction(client, { doc: docId, name, args = {}, id: opId, lang = 'fr' }) {
    if (Object.hasOwn(PARTY_ACTIONS, name)) return this.partyAction(client, name, args, opId, lang);
    if (!Object.hasOwn(CHAR_ACTIONS, name)) throw new ActionError('Action inconnue');
    const entry = this.docs.get(docId);
    if (!entry || entry.kind !== 'char' || !this.inCampaign(client, docId)) throw new ActionError('Fiche introuvable');
    if (!this.canEditDoc(client, docId)) throw new ActionError("Ce n'est pas ta fiche");
    let a = args || {};
    let death = null;
    if (name === 'deathSave') {
      // Le serveur lance le d20 : quand les jets de mort sont secrets, le résultat ne passe
      // jamais par le navigateur d'un joueur.
      const secret = this.secretDeathSaves(entry.campaign);
      const nat = secret || !Number.isInteger(Number(a.roll)) || !a.roll ? this.random(20) : Number(a.roll);
      a = { roll: nat };
      death = { nat, secret };
    }
    const result = this.runCharAction(entry, name, a, { origin: client.id, opId, lang });
    if (death) {
      this.handleRoll(client, {
        label: tl(lang, 'Jet de mort'), expr: '1d20', total: death.nat, nat: death.nat, detail: result.toast || '',
      }, { private: death.secret, charId: docId });
    }
    const shown = this.toastFor(client, docId, result.toast);
    return { ...result, toast: death?.secret && !this.canSeeDeathSaves(client, docId) ? tl(lang, 'Jet de mort envoyé au MJ') : shown };
  }

  runCharAction(entry, name, args, { origin = null, opId = null, lang = 'fr' } = {}) {
    const draft = clone(entry.data);
    const s = this.settingsOf(entry.campaign) || {};
    const result = inLang(lang, () => CHAR_ACTIONS[name](draft, args || {}, { now: this.now(), denoms: this.denomsFor(entry.campaign), rules: s.rules || {}, edition: s.edition || '2024', lang })) || {};
    this.checkInvariants(entry.data, draft, lang);
    const patches = diff(entry.data, draft);
    entry.data = draft;
    this.commit(entry, patches, { origin, opId, kind: 'action', undo: { key: `${entry.id}|sheet`, label: result.label || name } });
    return { ...result, undoId: this.stack(`${entry.id}|sheet`).undo.at(-1)?.id };
  }

  partyAction(client, name, args, opId, lang = 'fr') {
    const campaign = client.campaign;
    if (!campaign) throw new ActionError('Aucune campagne');
    const isDm = client.role === 'dm';
    const own = client.charId;
    if (!isDm && !own) throw new ActionError('Lecture seule');
    if (!isDm) {
      if (name === 'transfer' && args.from !== 'stash' && args.from !== own) throw new ActionError("Ce n'est pas ton objet");
      if ((name === 'deposit' || name === 'withdraw') && args.charId !== own) throw new ActionError("Ce n'est pas ta bourse");
    }
    const party = this.party(campaign);
    const drafts = new Map([[party.id, clone(party.data)]]);
    const ctx = {
      party: drafts.get(party.id),
      char: id => {
        const e = this.docs.get(id);
        if (!e || e.kind !== 'char' || e.campaign !== campaign) return null;
        if (!drafts.has(id)) drafts.set(id, clone(e.data));
        return drafts.get(id);
      },
      charIds: this.charsIn(campaign).map(c => c.id),
      actorName: isDm ? tl(lang, 'MJ') : this.docs.get(own)?.data.name || '?',
      now: this.now(),
      denoms: this.denomsFor(campaign),
      lang,
    };
    const result = inLang(lang, () => PARTY_ACTIONS[name](ctx, args || {})) || {};
    for (const [id, draft] of drafts) {
      const e = this.docs.get(id);
      if (e.kind === 'char') this.checkInvariants(e.data, draft, lang);
    }
    for (const [id, draft] of drafts) {
      const e = this.docs.get(id);
      const patches = diff(e.data, draft);
      if (!patches.fwd.length) continue;
      e.data = draft;
      this.commit(e, patches, { origin: client.id, opId, kind: 'action' });
    }
    return result;
  }

  // ------------------------------------------------------------ Annuler / rétablir

  handleUndo(client, { doc: docId, stack = 'sheet', redo = false, entryId = null, lang = 'fr' }) {
    const entry = this.docs.get(docId);
    if (!entry || entry.kind !== 'char' || !this.canEditDoc(client, docId)) throw new ActionError('Lecture seule');
    const s = this.stack(`${docId}|${stack}`);
    const from = redo ? s.redo : s.undo;
    let idx = from.length - 1;
    if (entryId) idx = from.findIndex(e => e.id === entryId);
    if (idx < 0) throw new ActionError(redo ? 'Rien à rétablir' : 'Rien à annuler');
    const [u] = from.splice(idx, 1);
    const applied = [];
    for (const p of redo ? u.fwd : u.inv) if (applyPatch(entry.data, p)) applied.push(p);
    (redo ? s.undo : s.redo).push(u);
    u.mergeKey = null;
    this.commit(entry, { fwd: applied, inv: [] }, { origin: client.id, kind: 'action' });
    this.emit('stacks', { doc: docId, stacks: this.stackInfo(docId), campaign: entry.campaign });
    return { toast: tl(lang, redo ? 'Rétabli : {label}' : 'Annulé : {label}', { label: u.label }) };
  }

  // ------------------------------------------------------------ Gestion (MJ, API)

  createCharacter(data, { campaign, owner = null } = {}) {
    if (!campaign) throw new ActionError('Campagne obligatoire');
    const id = newId('c');
    const doc = normalizeCharacter(data);
    delete doc.campaign;
    delete doc.musicRemote;
    doc.meta = { ...(doc.meta || {}), createdAt: this.now() };
    this.party(campaign);
    const entry = { id, kind: 'char', data: doc, v: 1, campaign, owner };
    this.docs.set(id, entry);
    this.dirty.add(id);
    this.flush();
    this.emit('doc', { doc: id, campaign });
    return id;
  }

  setOwner(id, owner) {
    const e = this.docs.get(id);
    if (!e || e.kind !== 'char') throw new ActionError('Fiche introuvable');
    e.owner = owner || null;
    this.dirty.add(id);
    this.flush();
    this.emit('doc', { doc: id, campaign: e.campaign });
  }

  deleteCharacter(id) {
    const e = this.docs.get(id);
    if (!e || e.kind !== 'char') throw new ActionError('Fiche introuvable');
    this.docs.delete(id);
    this.dirty.delete(id);
    for (const key of [...this.stacks.keys()]) if (key.startsWith(`${id}|`)) this.stacks.delete(key);
    this.db.deleteDoc(id);
    this.emit('docDeleted', { doc: id, campaign: e.campaign });
  }

  // Une campagne supprimée : ses documents quittent la mémoire (la base est vidée à part).
  dropCampaign(campaign) {
    for (const [id, e] of [...this.docs]) {
      if (e.campaign !== campaign) continue;
      this.docs.delete(id);
      this.dirty.delete(id);
      for (const key of [...this.stacks.keys()]) if (key.startsWith(`${id}|`)) this.stacks.delete(key);
    }
  }

  replaceCharacter(id, data) {
    const e = this.docs.get(id);
    if (!e || e.kind !== 'char') throw new ActionError('Fiche introuvable');
    return this.runCharAction(e, 'importSheet', { data });
  }

  // Ajout direct à la réserve (MJ ou API), noté dans le journal du groupe.
  adminStashAdd(items, actorName, campaign) {
    if (!Array.isArray(items) || !items.length) throw new ActionError('Aucun objet');
    const party = this.party(campaign);
    const draft = clone(party.data);
    const ctx = { party: draft, char: () => null, charIds: [], actorName, now: this.now(), denoms: this.denomsFor(campaign) };
    for (const item of items.slice(0, 500)) PARTY_ACTIONS.stashAdd(ctx, { item });
    const patches = diff(party.data, draft);
    party.data = draft;
    this.commit(party, patches, { kind: 'action' });
    return items.length;
  }

  handleRoll(client, roll, { private: priv = false, charId = null } = {}) {
    if (!client.campaign) throw new ActionError('Aucune campagne');
    const who = charId || client.charId;
    const clean = {
      id: newId('r'),
      at: this.now(),
      who: (charId ? this.docs.get(charId)?.data.name : null) || (client.role === 'dm' && !client.charId ? 'MJ' : this.docs.get(who)?.data.name || '?'),
      charId: who || null,
      campaign: client.campaign,
      label: String(roll?.label || 'Jet').slice(0, 80),
      expr: String(roll?.expr || '').slice(0, 60),
      total: Math.trunc(Number(roll?.total) || 0),
      detail: String(roll?.detail || '').slice(0, 160),
      mode: ['adv', 'dis'].includes(roll?.mode) ? roll.mode : null,
      nat: Number.isInteger(roll?.nat) ? roll.nat : null,
    };
    if (priv) clean.private = true;
    this.db.addRoll(clean);
    this.emit('roll', clean);
    return clean;
  }

  flush() {
    const list = [];
    for (const id of this.dirty) {
      const e = this.docs.get(id);
      if (e) list.push({ id: e.id, kind: e.kind, data: e.data, version: e.v, campaign: e.campaign, owner: e.owner });
    }
    this.dirty.clear();
    this.db.putDocs(list);
    return list.length;
  }
}
