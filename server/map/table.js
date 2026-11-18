// Réglages de la table côté joueurs, propres à une campagne : la vue verrouillée sur la TV,
// les tokens des joueurs bloqués, et le droit de coller des images et de dessiner. Rangés dans
// les réglages internes de la campagne, sous `table`.
import { isDmRole } from '../campaigns.js';

export const TABLE_DEFAULT = {
  lock: false,        // Chaque onglet de joueur suit le cadrage de la TV, sans pouvoir bouger la vue.
  blockTokens: false, // Les joueurs ne déplacent plus leurs tokens.
  draw: true,         // Les joueurs peuvent coller des images et dessiner.
  muted: [],          // Comptes privés d'images et de dessins.
  onTv: true,         // La TV affiche les images et les traits.
};

export function tableOf(campaigns, cid) {
  const t = campaigns.settings(cid).table || {};
  return {
    lock: !!t.lock,
    blockTokens: !!t.blockTokens,
    draw: t.draw ?? TABLE_DEFAULT.draw,
    muted: Array.isArray(t.muted) ? t.muted : [],
    onTv: t.onTv ?? TABLE_DEFAULT.onTv,
  };
}

// Un changement envoyé par le MJ : seulement des interrupteurs, et des comptes de la campagne.
export function patchTable(campaigns, cid, patch = {}) {
  const next = tableOf(campaigns, cid);
  for (const k of ['lock', 'blockTokens', 'draw', 'onTv']) if (k in patch) next[k] = !!patch[k];
  if (Array.isArray(patch.muted)) {
    const members = new Set(campaigns.members(cid).map(m => m.accountId));
    next.muted = [...new Set(patch.muted.map(String))].filter(id => members.has(id)).slice(0, 100);
  }
  campaigns.setInternal(cid, 'table', next);
  return next;
}

// Le MJ et les co-MJ ont toujours le droit ; un joueur, si le MJ ne l'a pas coupé.
export function canDraw(table, accountId, role) {
  if (isDmRole(role)) return true;
  return !!table.draw && !table.muted.includes(accountId);
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
