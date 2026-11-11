// Journal des actions : connexions, modifications de fiches, jets, panneau MJ, carte.
// Une suite d'actions identiques (le même joueur qui tape dans le même champ) tient sur une
// ligne avec un compteur, tant qu'aucune autre action ne s'intercale et que moins de deux
// minutes séparent deux actions.
const MERGE_MS = 2 * 60_000;

export const AUDIT_KINDS = {
  auth: 'Connexions',
  sheet: 'Fiches',
  party: 'Réserve',
  roll: 'Jets',
  dm: 'MJ',
  map: 'Carte',
  world: 'Monde',
  admin: 'Admin',
};

export function createAudit(db, { now = () => Date.now() } = {}) {
  let last = null; // { id, key, at, count }
  return {
    // `campaign` : la campagne concernée, ou null pour un événement du serveur (admin, connexion).
    log({ kind, action, account = null, seat = null, detail = '', ip = null, mergeKey = null, campaign = null }) {
      const at = now();
      const key = mergeKey ? `${campaign}|${kind}|${account}|${seat}|${mergeKey}` : null;
      if (key && last && last.key === key && at - last.at < MERGE_MS) {
        last.count += 1;
        last.at = at;
        db.bumpAudit(last.id, at, last.count, String(detail || '').slice(0, 300));
        return;
      }
      const id = db.addAudit({ at, kind, action: String(action).slice(0, 160), account, seat, detail: String(detail || '').slice(0, 300), ip, campaign });
      last = { id, key, at, count: 1 };
    },
    list(opts) { return db.listAudit(opts); },
  };
}
