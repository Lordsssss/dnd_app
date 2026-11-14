// Journal des PV : chaque changement des PV d'un token de la carte, gardé en base pour les
// statistiques de fin de campagne. Le MJ ne le voit pas dans la carte ; il se lit par l'API.
// Ce qui a changé se déduit des PV avant et après l'opération, quelle qu'elle soit.

const KINDS = {
  'token.hp': op => (Number(op.delta) < 0 ? 'damage' : 'heal'),
  'token.hpSet': () => 'set',
  'token.update': () => 'edit',
};

export const logsHp = type => type in KINDS;

export function hpSnapshot(doc) {
  return new Map(doc.tokens.map(t => [t.id, t.hp ? t.hp.current : null]));
}

export function createDamageLog(raw) {
  const insert = raw.prepare(`INSERT INTO damage_log (campaign_id, scene, scene_name, fight, round, turn, token, target, target_kind,
    kind, amount, hp_before, hp_after, hp_max, account, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const lastOf = raw.prepare('SELECT id FROM damage_log WHERE campaign_id = ? AND scene = ? AND token = ? AND undone = ? ORDER BY id DESC LIMIT 1');
  const mark = raw.prepare('UPDATE damage_log SET undone = ? WHERE id = ?');
  const list = raw.prepare('SELECT * FROM damage_log WHERE campaign_id = ? ORDER BY id');

  const changed = (before, doc) => doc.tokens.filter(t => before.has(t.id) && before.get(t.id) !== (t.hp ? t.hp.current : null));

  return {
    // Après une opération : une ligne par token dont les PV ont bougé.
    record({ campaign, scene, sceneName, account, doc, before, op }) {
      const kind = KINDS[op.type]?.(op);
      if (!kind) return;
      const f = doc.fight;
      const turn = f?.started ? f.rows.find(r => r.id === f.current)?.name || null : null;
      for (const t of changed(before, doc)) {
        const b = before.get(t.id);
        const a = t.hp ? t.hp.current : null;
        // Un coup : le nombre tapé, dépassement compris. Sinon : ce que les PV ont perdu.
        const amount = kind === 'damage' ? Math.abs(Math.round(Number(op.delta))) : b != null && a != null ? b - a : null;
        insert.run(campaign, scene, sceneName || null, f?.id || null, f?.started ? f.round : null, turn, t.id, t.name, t.kind || null,
          kind, amount, b, a, t.hp ? t.hp.max : null, account || null, Date.now());
      }
    },
    // Annuler ou rétablir : la dernière ligne de chaque token touché est marquée, jamais effacée.
    undo({ campaign, scene, doc, before, redo = false }) {
      for (const t of changed(before, doc)) {
        const row = lastOf.get(campaign, scene, t.id, redo ? 1 : 0);
        if (row) mark.run(redo ? 0 : 1, row.id);
      }
    },
    list(campaign) {
      const entries = list.all(campaign).map(r => ({
        id: r.id, at: r.at, scene: r.scene, sceneName: r.scene_name, fight: r.fight, round: r.round, turn: r.turn,
        token: r.token, target: r.target, targetKind: r.target_kind, kind: r.kind, amount: r.amount,
        hpBefore: r.hp_before, hpAfter: r.hp_after, hpMax: r.hp_max, undone: !!r.undone, account: r.account,
      }));
      const hits = entries.filter(e => e.kind === 'damage' && !e.undone);
      const sum = arr => arr.reduce((n, e) => n + (e.amount || 0), 0);
      const byTurn = {};
      for (const e of hits) if (e.turn) byTurn[e.turn] = (byTurn[e.turn] || 0) + (e.amount || 0);
      return {
        totals: {
          hits: hits.length,
          damage: sum(hits),
          damageToEnemies: sum(hits.filter(e => e.targetKind === 'enemy')),
          // Le tour pendant lequel le coup a été noté : le plus souvent celui de l'attaquant.
          byTurn,
        },
        entries,
      };
    },
  };
}
