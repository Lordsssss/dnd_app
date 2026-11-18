// Réglages de la table côté joueurs, propres à une campagne : la vue verrouillée sur la TV,
// les tokens des joueurs bloqués, et le droit de poser des memes. Rangés dans les réglages
// internes de la campagne, sous `table`.
import { isDmRole } from '../campaigns.js';

export const TABLE_DEFAULT = {
  lock: false,        // Chaque onglet de joueur suit le cadrage de la TV, sans pouvoir bouger la vue.
  blockTokens: false, // Les joueurs ne déplacent plus leurs tokens.
  memes: true,        // Les joueurs peuvent poser des memes.
  muted: [],          // Comptes privés de memes.
  memesOnTv: true,    // La TV affiche les memes.
  serious: false,     // Mode sérieux : aucun meme affiché, pour personne, sans rien effacer.
};

export function tableOf(campaigns, cid) {
  const t = campaigns.settings(cid).table || {};
  return { ...TABLE_DEFAULT, ...t, muted: Array.isArray(t.muted) ? t.muted : [] };
}

// Un changement envoyé par le MJ : seulement des interrupteurs, et des comptes de la campagne.
export function patchTable(campaigns, cid, patch = {}) {
  const cur = tableOf(campaigns, cid);
  const next = { ...cur };
  for (const k of ['lock', 'blockTokens', 'memes', 'memesOnTv', 'serious']) if (k in patch) next[k] = !!patch[k];
  if (Array.isArray(patch.muted)) {
    const members = new Set(campaigns.members(cid).map(m => m.accountId));
    next.muted = [...new Set(patch.muted.map(String))].filter(id => members.has(id)).slice(0, 100);
  }
  campaigns.setInternal(cid, 'table', next);
  return next;
}

// Le MJ et les co-MJ ont toujours le droit ; un joueur, si le MJ ne l'a pas coupé.
export function canMeme(table, accountId, role) {
  if (isDmRole(role)) return true;
  return !!table.memes && !table.serious && !table.muted.includes(accountId);
}

// Fenêtre glissante par compte : `max` actions par `ms`. Rend false quand la limite est atteinte.
export function rateLimiter(max, ms) {
  const hits = new Map();
  return key => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter(t => now - t < ms);
    if (list.length >= max) { hits.set(key, list); return false; }
    list.push(now);
    hits.set(key, list);
    return true;
  };
}
