// Stockage SQLite (module natif node:sqlite, aucune compilation). Le schéma vient des migrations
// numérotées de migrations.js ; une sauvegarde est prise avant d'en appliquer une nouvelle.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pendingMigrations, runMigrations } from './migrations.js';

export function openDb(file, { backupDir = null } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existed = fs.existsSync(file) && fs.statSync(file).size > 0;
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;');
  const pending = pendingMigrations(db);
  let applied = [];
  if (pending.length) {
    if (existed && backupDir) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const out = path.join(backupDir, 'migrations', `avant-migration-${pending[0].id}-${stamp}.sqlite`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      db.prepare('VACUUM INTO ?').run(out);
    }
    applied = runMigrations(db, pending);
  }
  const out = new Db(db, file);
  out.migrated = applied;
  return out;
}

const json = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };

const accountRow = r => (r ? {
  id: r.id, login: r.login, name: r.name, pinHash: r.pin_hash, mustChange: !!r.must_change,
  isAdmin: !!r.is_admin, canCreate: !!r.can_create, lang: r.lang || null, secretKind: r.secret_kind || 'pin', recoveryHash: r.recovery_hash || null,
  createdAt: r.created_at, lastLogin: r.last_login,
} : null);

const campaignRow = r => (r ? {
  id: r.id, name: r.name, description: r.description || '', settings: json(r.settings, {}), bridge: json(r.bridge, null),
  createdBy: r.created_by || null, createdAt: r.created_at, archived: !!r.archived,
} : null);

const assetRow = r => (r ? {
  id: r.id, campaign: r.campaign_id || null, kind: r.kind, name: r.name, mime: r.mime, size: r.size, sha256: r.sha256,
  file: r.file, width: r.width, height: r.height, createdBy: r.created_by, createdAt: r.created_at, folder: r.folder || '',
} : null);

export class Db {
  constructor(db, file) {
    this.db = db;
    this.file = file;
    const p = sql => db.prepare(sql);
    this.q = {
      allDocs: p('SELECT id, kind, data, version, campaign, owner FROM docs'),
      putDoc: p(`INSERT INTO docs (id, kind, data, version, updated_at, campaign, owner) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, version = excluded.version, updated_at = excluded.updated_at,
        campaign = excluded.campaign, owner = excluded.owner`),
      delDoc: p('DELETE FROM docs WHERE id = ?'),

      getSession: p('SELECT token, account_id, created_at, last_seen FROM sessions WHERE token = ?'),
      addSession: p("INSERT INTO sessions (token, role, account_id, created_at, last_seen) VALUES (?, '', ?, ?, ?)"),
      touchSession: p('UPDATE sessions SET last_seen = ? WHERE token = ?'),
      delSession: p('DELETE FROM sessions WHERE token = ?'),
      delSessionsOfAccount: p('DELETE FROM sessions WHERE account_id = ? AND token != ?'),
      pruneSessions: p('DELETE FROM sessions WHERE last_seen < ?'),

      listAccounts: p('SELECT * FROM accounts ORDER BY name COLLATE NOCASE'),
      getAccount: p('SELECT * FROM accounts WHERE id = ?'),
      getAccountByLogin: p('SELECT * FROM accounts WHERE login = ?'),
      putAccount: p(`INSERT INTO accounts (id, login, name, role, pin_hash, must_change, chars, created_at, last_login, is_admin, lang, secret_kind, recovery_hash, can_create)
        VALUES (?, ?, ?, 'player', ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET login = excluded.login, name = excluded.name, pin_hash = excluded.pin_hash,
        must_change = excluded.must_change, last_login = excluded.last_login, is_admin = excluded.is_admin, can_create = excluded.can_create,
        lang = excluded.lang, secret_kind = excluded.secret_kind, recovery_hash = excluded.recovery_hash`),
      delAccount: p('DELETE FROM accounts WHERE id = ?'),
      delAccountSessions: p('DELETE FROM sessions WHERE account_id = ?'),
      delAccountMemberships: p('DELETE FROM memberships WHERE account_id = ?'),
      countAccounts: p('SELECT COUNT(*) n FROM accounts'),

      listCampaigns: p('SELECT * FROM campaigns ORDER BY name COLLATE NOCASE'),
      getCampaign: p('SELECT * FROM campaigns WHERE id = ?'),
      putCampaign: p(`INSERT INTO campaigns (id, name, description, settings, bridge, created_by, created_at, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, settings = excluded.settings,
        bridge = excluded.bridge, archived = excluded.archived`),
      delCampaign: p('DELETE FROM campaigns WHERE id = ?'),

      membersOf: p('SELECT m.account_id, m.role, m.joined_at, a.name, a.login FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.campaign_id = ? ORDER BY a.name COLLATE NOCASE'),
      membershipsOf: p('SELECT campaign_id, role FROM memberships WHERE account_id = ?'),
      roleOf: p('SELECT role FROM memberships WHERE campaign_id = ? AND account_id = ?'),
      putMember: p('INSERT INTO memberships (campaign_id, account_id, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT(campaign_id, account_id) DO UPDATE SET role = excluded.role'),
      delMember: p('DELETE FROM memberships WHERE campaign_id = ? AND account_id = ?'),

      getInvite: p('SELECT * FROM invitations WHERE code = ?'),
      invitesOf: p('SELECT * FROM invitations WHERE campaign_id = ? ORDER BY created_at DESC'),
      putInvite: p('INSERT INTO invitations (code, campaign_id, role, uses_left, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      useInvite: p('UPDATE invitations SET uses_left = uses_left - 1 WHERE code = ? AND uses_left IS NOT NULL'),
      delInvite: p('DELETE FROM invitations WHERE code = ?'),

      getTokenByHash: p('SELECT * FROM api_tokens WHERE hash = ?'),
      tokensOf: p('SELECT id, campaign_id, label, created_by, created_at, last_used FROM api_tokens WHERE campaign_id = ? ORDER BY created_at DESC'),
      putToken: p('INSERT INTO api_tokens (id, campaign_id, label, hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
      touchToken: p('UPDATE api_tokens SET last_used = ? WHERE id = ?'),
      delToken: p('DELETE FROM api_tokens WHERE id = ? AND campaign_id = ?'),

      getAsset: p('SELECT * FROM assets WHERE id = ?'),
      assetsOf: p('SELECT * FROM assets WHERE campaign_id IS ? AND (? IS NULL OR kind = ?) ORDER BY created_at DESC'),
      assetBySha: p('SELECT * FROM assets WHERE campaign_id IS ? AND sha256 = ? AND kind = ?'),
      putAsset: p(`INSERT INTO assets (id, campaign_id, kind, name, mime, size, sha256, file, width, height, created_by, created_at, folder)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, folder = excluded.folder`),
      delAsset: p('DELETE FROM assets WHERE id = ?'),
      shaUses: p('SELECT COUNT(*) n FROM assets WHERE sha256 = ?'),
      campaignBytes: p('SELECT COALESCE(SUM(size), 0) n FROM assets WHERE campaign_id = ?'),

      scenesOf: p('SELECT id, scene, updated_at FROM scenes WHERE campaign_id = ?'),
      getScene: p('SELECT id, scene, state FROM scenes WHERE campaign_id = ? AND id = ?'),
      putScene: p(`INSERT INTO scenes (campaign_id, id, scene, state, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(campaign_id, id) DO UPDATE SET scene = excluded.scene, state = excluded.state, updated_at = excluded.updated_at`),
      putSceneOnly: p('UPDATE scenes SET scene = ?, updated_at = ? WHERE campaign_id = ? AND id = ?'),
      putStateOnly: p('UPDATE scenes SET state = ?, updated_at = ? WHERE campaign_id = ? AND id = ?'),
      delScene: p('DELETE FROM scenes WHERE campaign_id = ? AND id = ?'),

      beastsOf: p('SELECT id, data, updated_at FROM bestiary WHERE campaign_id = ?'),
      getBeast: p('SELECT id, campaign_id, data FROM bestiary WHERE id = ?'),
      putBeast: p(`INSERT INTO bestiary (id, campaign_id, data, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`),
      delBeast: p('DELETE FROM bestiary WHERE id = ? AND campaign_id = ?'),

      getWorld: p('SELECT * FROM worlds WHERE campaign_id = ?'),
      putWorld: p(`INSERT INTO worlds (campaign_id, overlay, map_file, image, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(campaign_id) DO UPDATE SET overlay = excluded.overlay, map_file = excluded.map_file, image = excluded.image, updated_at = excluded.updated_at`),

      addAudit: p('INSERT INTO audit (at, kind, action, account, seat, detail, ip, campaign) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
      bumpAudit: p('UPDATE audit SET at = ?, count = ?, detail = ? WHERE id = ?'),
      pruneAudit: p('DELETE FROM audit WHERE id <= (SELECT id FROM audit ORDER BY id DESC LIMIT 1 OFFSET ?)'),

      getSetting: p('SELECT value FROM settings WHERE key = ?'),
      setSetting: p('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
      getSnap: p('SELECT data, exported_at, session FROM export_snapshots WHERE id = ?'),
      putSnap: p(`INSERT INTO export_snapshots (id, data, exported_at, session) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, exported_at = excluded.exported_at, session = excluded.session`),
      addRoll: p('INSERT INTO rolls (at, data, campaign, private) VALUES (?, ?, ?, ?)'),
      recentRolls: p('SELECT data, private FROM rolls WHERE campaign = ? ORDER BY id DESC LIMIT ?'),
      pruneRolls: p('DELETE FROM rolls WHERE campaign = ? AND id <= (SELECT id FROM rolls WHERE campaign = ? ORDER BY id DESC LIMIT 1 OFFSET ?)'),
    };
  }

  tx(fn) {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // ---------------------------------------------------------------- Fiches et réserves
  allDocs() {
    return this.q.allDocs.all().map(r => ({ id: r.id, kind: r.kind, data: JSON.parse(r.data), version: r.version, campaign: r.campaign || null, owner: r.owner || null }));
  }

  putDocs(list) {
    if (!list.length) return;
    this.tx(() => {
      const now = Date.now();
      for (const d of list) this.q.putDoc.run(d.id, d.kind, JSON.stringify(d.data), d.version, now, d.campaign ?? null, d.owner ?? null);
    });
  }

  deleteDoc(id) { this.q.delDoc.run(id); }

  // ---------------------------------------------------------------- Comptes
  listAccounts() { return this.q.listAccounts.all().map(accountRow); }
  countAccounts() { return this.q.countAccounts.get().n; }
  getAccount(id) { return accountRow(this.q.getAccount.get(id)); }
  getAccountByLogin(login) { return accountRow(this.q.getAccountByLogin.get(String(login || '').toLowerCase())); }
  putAccount(a) {
    this.q.putAccount.run(a.id, String(a.login).toLowerCase(), a.name, a.pinHash, a.mustChange ? 1 : 0,
      a.createdAt ?? Date.now(), a.lastLogin ?? null, a.isAdmin ? 1 : 0, a.lang || null, a.secretKind || 'pin', a.recoveryHash || null, a.canCreate ? 1 : 0);
  }
  deleteAccount(id) {
    this.tx(() => {
      this.q.delAccountSessions.run(id);
      this.q.delAccountMemberships.run(id);
      this.db.prepare('UPDATE docs SET owner = NULL WHERE owner = ?').run(id);
      this.q.delAccount.run(id);
    });
  }

  // ---------------------------------------------------------------- Sessions
  getSession(token) { return this.q.getSession.get(token) || null; }
  addSession(token, accountId) { const n = Date.now(); this.q.addSession.run(token, accountId, n, n); }
  touchSession(token) { this.q.touchSession.run(Date.now(), token); }
  deleteSession(token) { this.q.delSession.run(token); }
  deleteAccountSessions(accountId, exceptToken = '') { this.q.delSessionsOfAccount.run(accountId, exceptToken); }
  pruneSessions(olderThan) { this.q.pruneSessions.run(olderThan); }

  // ---------------------------------------------------------------- Campagnes
  listCampaigns() { return this.q.listCampaigns.all().map(campaignRow); }
  getCampaign(id) { return campaignRow(this.q.getCampaign.get(id)); }
  putCampaign(c) {
    this.q.putCampaign.run(c.id, c.name, c.description || '', JSON.stringify(c.settings || {}), c.bridge ? JSON.stringify(c.bridge) : null,
      c.createdBy || null, c.createdAt ?? Date.now(), c.archived ? 1 : 0);
  }
  deleteCampaign(id) {
    this.tx(() => {
      for (const t of ['memberships', 'invitations', 'api_tokens', 'scenes', 'bestiary', 'worlds']) this.db.prepare(`DELETE FROM ${t} WHERE campaign_id = ?`).run(id);
      this.db.prepare('DELETE FROM docs WHERE campaign = ?').run(id);
      this.db.prepare('DELETE FROM rolls WHERE campaign = ?').run(id);
      this.q.delCampaign.run(id);
    });
  }

  membersOf(cid) {
    return this.q.membersOf.all(cid).map(r => ({ accountId: r.account_id, role: r.role, joinedAt: r.joined_at, name: r.name, login: r.login }));
  }
  membershipsOf(accountId) { return this.q.membershipsOf.all(accountId).map(r => ({ campaign: r.campaign_id, role: r.role })); }
  roleOf(cid, accountId) { return this.q.roleOf.get(cid, accountId)?.role || null; }
  setMember(cid, accountId, role) { this.q.putMember.run(cid, accountId, role, Date.now()); }
  removeMember(cid, accountId) { this.q.delMember.run(cid, accountId); }

  getInvite(code) { return this.q.getInvite.get(code) || null; }
  invitesOf(cid) { return this.q.invitesOf.all(cid); }
  addInvite(i) { this.q.putInvite.run(i.code, i.campaign, i.role, i.usesLeft ?? null, i.expiresAt ?? null, i.createdBy || null, Date.now()); }
  useInvite(code) { this.q.useInvite.run(code); }
  deleteInvite(code) { this.q.delInvite.run(code); }

  tokenByHash(hash) { return this.q.getTokenByHash.get(hash) || null; }
  tokensOf(cid) { return this.q.tokensOf.all(cid); }
  addToken(t) { this.q.putToken.run(t.id, t.campaign, t.label, t.hash, t.createdBy || null, Date.now()); }
  touchToken(id) { this.q.touchToken.run(Date.now(), id); }
  deleteToken(cid, id) { this.q.delToken.run(id, cid); }

  // ---------------------------------------------------------------- Fichiers
  getAsset(id) { return assetRow(this.q.getAsset.get(id)); }
  assetsOf(cid, kind = null) { return this.q.assetsOf.all(cid ?? null, kind, kind).map(assetRow); }
  assetBySha(cid, sha, kind) { return assetRow(this.q.assetBySha.get(cid ?? null, sha, kind)); }
  putAsset(a) {
    this.q.putAsset.run(a.id, a.campaign ?? null, a.kind, a.name, a.mime, a.size, a.sha256, a.file, a.width ?? null, a.height ?? null, a.createdBy ?? null, a.createdAt ?? Date.now(), String(a.folder || '').slice(0, 80));
  }
  deleteAsset(id) { this.q.delAsset.run(id); }
  shaUses(sha) { return this.q.shaUses.get(sha).n; }
  campaignBytes(cid) { return this.q.campaignBytes.get(cid).n; }

  // ---------------------------------------------------------------- Scènes
  scenesOf(cid) { return this.q.scenesOf.all(cid).map(r => ({ id: r.id, scene: json(r.scene, {}), updatedAt: r.updated_at })); }
  getScene(cid, id) { const r = this.q.getScene.get(cid, id); return r ? { id: r.id, scene: json(r.scene, {}), state: json(r.state, {}) } : null; }
  putScene(cid, id, scene, state) { this.q.putScene.run(cid, id, JSON.stringify(scene), JSON.stringify(state || {}), Date.now()); }
  putSceneOnly(cid, id, scene) { this.q.putSceneOnly.run(JSON.stringify(scene), Date.now(), cid, id); }
  putStateOnly(cid, id, state) { this.q.putStateOnly.run(JSON.stringify(state), Date.now(), cid, id); }
  deleteScene(cid, id) { this.q.delScene.run(cid, id); }

  // ---------------------------------------------------------------- Bestiaire
  beastsOf(cid) { return this.q.beastsOf.all(cid).map(r => ({ id: r.id, ...json(r.data, {}), updatedAt: r.updated_at })); }
  getBeast(id) { const r = this.q.getBeast.get(id); return r ? { id: r.id, campaign: r.campaign_id, ...json(r.data, {}) } : null; }
  putBeast(cid, id, data) { this.q.putBeast.run(id, cid, JSON.stringify(data), Date.now()); }
  deleteBeast(cid, id) { this.q.delBeast.run(id, cid); }

  // ---------------------------------------------------------------- Monde
  getWorld(cid) {
    const r = this.q.getWorld.get(cid);
    return r ? { campaign: cid, overlay: json(r.overlay, {}), mapFile: r.map_file || null, image: r.image || null, updatedAt: r.updated_at } : null;
  }
  putWorld(cid, w) { this.q.putWorld.run(cid, JSON.stringify(w.overlay || {}), w.mapFile || null, w.image || null, Date.now()); }

  // ---------------------------------------------------------------- Journal
  addAudit(e) {
    const r = this.q.addAudit.run(e.at, e.kind, e.action, e.account ?? null, e.seat ?? null, e.detail ?? '', e.ip ?? null, e.campaign ?? null);
    if (Number(r.lastInsertRowid) % 200 === 0) this.q.pruneAudit.run(50_000);
    return Number(r.lastInsertRowid);
  }
  bumpAudit(id, at, count, detail) { this.q.bumpAudit.run(at, count, detail, id); }
  // `campaign` : une campagne, ou `undefined` pour tout le journal (admin).
  listAudit({ campaign, kinds = null, before = null, limit = 200, q = '' } = {}) {
    const where = [];
    const args = [];
    if (campaign !== undefined) { where.push('campaign IS ?'); args.push(campaign); }
    if (kinds?.length) { where.push(`kind IN (${kinds.map(() => '?').join(',')})`); args.push(...kinds); }
    if (before) { where.push('id < ?'); args.push(Number(before)); }
    if (q) {
      where.push('(action LIKE ? OR account LIKE ? OR seat LIKE ? OR detail LIKE ?)');
      const like = `%${q}%`;
      args.push(like, like, like, like);
    }
    const sql = `SELECT * FROM audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`;
    return this.db.prepare(sql).all(...args, Math.min(500, Math.max(1, Number(limit) || 200)));
  }

  // ---------------------------------------------------------------- Divers
  getSetting(key, fallback = null) {
    const r = this.q.getSetting.get(key);
    return r ? JSON.parse(r.value) : fallback;
  }
  setSetting(key, value) { this.q.setSetting.run(key, JSON.stringify(value)); }

  getSnapshot(id) {
    const r = this.q.getSnap.get(id);
    return r ? { data: JSON.parse(r.data), exportedAt: r.exported_at, session: r.session } : null;
  }
  putSnapshot(id, data, session) { this.q.putSnap.run(id, JSON.stringify(data), Date.now(), session ?? null); }

  addRoll(roll) {
    this.q.addRoll.run(roll.at, JSON.stringify(roll), roll.campaign, roll.private ? 1 : 0);
    this.q.pruneRolls.run(roll.campaign, roll.campaign, 1000);
  }
  // Les jets privés (jets de mort secrets) ne vont qu'au MJ.
  recentRolls(cid, n = 100, { withPrivate = false } = {}) {
    return this.q.recentRolls.all(cid, n * 2).filter(r => withPrivate || !r.private).slice(0, n).map(r => JSON.parse(r.data)).reverse();
  }

  backupTo(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.rmSync(file);
    this.db.prepare('VACUUM INTO ?').run(file);
  }

  close() { this.db.close(); }
}
