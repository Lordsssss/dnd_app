// Migrations numérotées de la base. Chacune tourne une seule fois, dans l'ordre, et la base est
// sauvegardée avant la première qui manque (voir openDb). Ne jamais modifier une migration déjà
// livrée : en ajouter une nouvelle.

const cols = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
const addCol = (db, table, def) => {
  const name = def.split(/\s+/)[0];
  if (!cols(db, table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
};
const hasTable = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);

// Taux d'une campagne qui gardait l'ancien défaut de l'application : 1 po = 100 pa.
const HOUSE_RATE = [
  { key: 'pc', label: 'pc', name: 'cuivre', value: 1 },
  { key: 'pa', label: 'pa', name: 'argent', value: 100 },
  { key: 'po', label: 'po', name: 'or', value: 10000 },
];
const PHB_EN = [
  { key: 'cp', label: 'cp', name: 'copper', value: 1 },
  { key: 'sp', label: 'sp', name: 'silver', value: 10 },
  { key: 'gp', label: 'gp', name: 'gold', value: 100 },
  { key: 'pp', label: 'pp', name: 'platinum', value: 1000 },
];

// Id de la campagne implicite d'une base mono-campagne. Le nom et les réglages des autres
// campagnes d'une telle base ne sont pas connus : elles prennent leur id pour nom.
export const LEGACY_MAIN = 'main';

export const MIGRATIONS = [
  {
    id: 1,
    name: 'Schéma de départ, celui de la version mono-campagne',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS docs (
          id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 0, updated_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT '', char_id TEXT, created_at INTEGER, last_seen INTEGER
        );
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS export_snapshots (
          id TEXT PRIMARY KEY, data TEXT NOT NULL, exported_at INTEGER, session INTEGER
        );
        CREATE TABLE IF NOT EXISTS rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, data TEXT);
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL,
          pin_hash TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 1, chars TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER, last_login INTEGER
        );
        CREATE TABLE IF NOT EXISTS audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, action TEXT NOT NULL,
          account TEXT, seat TEXT, detail TEXT, ip TEXT, count INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS audit_at ON audit (at);
      `);
      // Sessions d'avant les comptes : elles ne valent plus rien.
      if (!cols(db, 'sessions').includes('account_id')) {
        db.exec('ALTER TABLE sessions ADD COLUMN account_id TEXT');
        db.exec('DELETE FROM sessions');
      }
      addCol(db, 'accounts', 'dm_of TEXT');
    },
  },
  {
    id: 2,
    name: 'Campagnes, membres, invitations, fichiers, scènes, bestiaire, monde, jetons d\'API',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS campaigns (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
          settings TEXT NOT NULL DEFAULT '{}', bridge TEXT, created_by TEXT, created_at INTEGER,
          archived INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS memberships (
          campaign_id TEXT NOT NULL, account_id TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER,
          PRIMARY KEY (campaign_id, account_id)
        );
        CREATE INDEX IF NOT EXISTS memberships_account ON memberships (account_id);
        CREATE TABLE IF NOT EXISTS invitations (
          code TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, role TEXT NOT NULL, uses_left INTEGER,
          expires_at INTEGER, created_by TEXT, created_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS api_tokens (
          id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, label TEXT NOT NULL, hash TEXT NOT NULL UNIQUE,
          created_by TEXT, created_at INTEGER, last_used INTEGER
        );
        CREATE TABLE IF NOT EXISTS assets (
          id TEXT PRIMARY KEY, campaign_id TEXT, kind TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
          size INTEGER NOT NULL, sha256 TEXT NOT NULL, file TEXT NOT NULL, width INTEGER, height INTEGER,
          created_by TEXT, created_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS assets_campaign ON assets (campaign_id, kind);
        CREATE TABLE IF NOT EXISTS scenes (
          campaign_id TEXT NOT NULL, id TEXT NOT NULL, scene TEXT NOT NULL, state TEXT NOT NULL DEFAULT '{}',
          updated_at INTEGER, PRIMARY KEY (campaign_id, id)
        );
        CREATE TABLE IF NOT EXISTS bestiary (
          id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS bestiary_campaign ON bestiary (campaign_id);
        CREATE TABLE IF NOT EXISTS worlds (
          campaign_id TEXT PRIMARY KEY, overlay TEXT NOT NULL DEFAULT '{}', map_file TEXT, image TEXT,
          updated_at INTEGER
        );
      `);
      addCol(db, 'docs', 'campaign TEXT');
      addCol(db, 'docs', 'owner TEXT');
      addCol(db, 'accounts', 'is_admin INTEGER NOT NULL DEFAULT 0');
      addCol(db, 'accounts', 'lang TEXT');
      addCol(db, 'accounts', "secret_kind TEXT NOT NULL DEFAULT 'pin'");
      addCol(db, 'accounts', 'recovery_hash TEXT');
      addCol(db, 'rolls', 'campaign TEXT');
      addCol(db, 'rolls', 'private INTEGER NOT NULL DEFAULT 0');
      addCol(db, 'audit', 'campaign TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS docs_campaign ON docs (campaign)');
      db.exec('CREATE INDEX IF NOT EXISTS rolls_campaign ON rolls (campaign, id)');
      db.exec('CREATE INDEX IF NOT EXISTS audit_campaign ON audit (campaign, id)');
    },
  },
  {
    id: 3,
    name: 'Conversion d\'une base mono-campagne : chaque campagne devient une ligne, chaque droit un membre',
    up(db) {
      const docs = db.prepare('SELECT id, kind, data FROM docs WHERE campaign IS NULL').all();
      if (!docs.length) return;
      const now = Date.now();
      const legacyId = c => (c ? String(c) : LEGACY_MAIN);
      const getSetting = k => { const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k); return r ? JSON.parse(r.value) : null; };

      // Les campagnes : celle d'origine, puis celles nommées par les fiches.
      const ids = new Set([LEGACY_MAIN]);
      for (const d of docs) {
        if (d.kind === 'char') ids.add(legacyId(JSON.parse(d.data).campaign));
        else if (d.id.startsWith('party:')) ids.add(d.id.slice(6));
      }
      // La campagne d'origine garde le taux de l'ancienne version, 1 po = 100 pa.
      const KNOWN = {
        [LEGACY_MAIN]: { name: 'Campagne principale', settings: { currency: HOUSE_RATE, rules: { longRestHitDice: 'half' }, edition: '2024', secretDeathSaves: true } },
      };
      const insertCampaign = db.prepare('INSERT OR IGNORE INTO campaigns (id, name, description, settings, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const id of ids) {
        const k = KNOWN[id] || { name: id, settings: { currency: PHB_EN, edition: '2024', secretDeathSaves: true } };
        const settings = { ...k.settings };
        if (id === LEGACY_MAIN) {
          const s = getSetting('sessionNumber');
          if (s != null) settings.sessionNumber = s;
        }
        insertCampaign.run(id, k.name, '', JSON.stringify(settings), now);
      }

      // Fiches et réserves : la campagne passe dans sa colonne, la réserve d'origine change d'id.
      const accounts = hasTable(db, 'accounts') ? db.prepare('SELECT * FROM accounts').all() : [];
      const ownerOf = new Map();
      for (const a of accounts) for (const c of JSON.parse(a.chars || '[]')) ownerOf.set(c, a.id);
      const setDoc = db.prepare('UPDATE docs SET campaign = ?, owner = ?, data = ? WHERE id = ?');
      const campaignOfChar = new Map();
      for (const d of docs) {
        const data = JSON.parse(d.data);
        if (d.kind === 'char') {
          const cid = legacyId(data.campaign);
          delete data.campaign;
          delete data.musicRemote;
          campaignOfChar.set(d.id, cid);
          setDoc.run(cid, ownerOf.get(d.id) || null, JSON.stringify(data), d.id);
        } else if (d.kind === 'party') {
          const cid = d.id === 'party' ? LEGACY_MAIN : d.id.replace(/^party:/, '');
          const newId = `party:${cid}`;
          if (newId !== d.id) {
            db.prepare('DELETE FROM docs WHERE id = ?').run(newId);
            db.prepare('UPDATE docs SET id = ? WHERE id = ?').run(newId, d.id);
          }
          db.prepare('UPDATE docs SET campaign = ? WHERE id = ?').run(cid, newId);
        }
      }

      // Membres : le MJ global devient admin et MJ de la campagne d'origine ; « MJ de » devient
      // un membre MJ ; chaque fiche fait de son titulaire un joueur de sa campagne.
      const role = new Map(); // `${cid}|${acc}` -> role
      const put = (cid, acc, r) => {
        const k = `${cid}|${acc}`;
        if (role.get(k) === 'dm') return;
        role.set(k, r);
      };
      for (const a of accounts) {
        if (a.role === 'dm') {
          db.prepare('UPDATE accounts SET is_admin = 1 WHERE id = ?').run(a.id);
          put(LEGACY_MAIN, a.id, 'dm');
        }
        if (a.dm_of) put(legacyId(a.dm_of), a.id, 'dm');
        for (const c of JSON.parse(a.chars || '[]')) if (campaignOfChar.has(c)) put(campaignOfChar.get(c), a.id, 'player');
      }
      // Une campagne sans MJ sur l'application : l'admin en devient le MJ, transférable.
      const admin = accounts.find(a => a.role === 'dm');
      for (const id of ids) {
        const hasDm = [...role].some(([k, r]) => k.startsWith(`${id}|`) && r === 'dm');
        if (!hasDm && admin) role.set(`${id}|${admin.id}`, 'dm');
      }
      const insertMember = db.prepare('INSERT OR REPLACE INTO memberships (campaign_id, account_id, role, joined_at) VALUES (?, ?, ?, ?)');
      for (const [k, r] of role) {
        const [cid, acc] = k.split('|');
        insertMember.run(cid, acc, r, now);
      }
      db.prepare("UPDATE accounts SET role = 'player'").run();

      // Jets : leur campagne passe en colonne.
      for (const r of db.prepare('SELECT id, data FROM rolls WHERE campaign IS NULL').all()) {
        const data = JSON.parse(r.data || '{}');
        const cid = legacyId(data.campaign);
        data.campaign = cid;
        db.prepare('UPDATE rolls SET campaign = ?, data = ? WHERE id = ?').run(cid, JSON.stringify(data), r.id);
      }
      // Le journal d'avant reste visible de l'admin seulement : on ne sait pas toujours de quelle campagne il parle.
      db.prepare("DELETE FROM sessions").run();
      db.prepare("DELETE FROM settings WHERE key IN ('sessionNumber')").run();
    },
  },
  {
    id: 4,
    name: 'Droit de créer une campagne par compte ; dossiers des images envoyées',
    up(db) {
      addCol(db, 'accounts', 'can_create INTEGER NOT NULL DEFAULT 0');
      // Ceux qui mènent déjà une campagne gardent le droit d'en créer.
      db.exec("UPDATE accounts SET can_create = 1 WHERE is_admin = 1 OR id IN (SELECT account_id FROM memberships WHERE role = 'dm')");
      addCol(db, 'assets', "folder TEXT NOT NULL DEFAULT ''");
    },
  },
];

export function pendingMigrations(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER)');
  const done = new Set(db.prepare('SELECT id FROM schema_migrations').all().map(r => r.id));
  return MIGRATIONS.filter(m => !done.has(m.id));
}

export function runMigrations(db, list = pendingMigrations(db)) {
  for (const m of list) {
    db.exec('BEGIN');
    try {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(m.id, m.name, Date.now());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.id} (${m.name}) impossible : ${e.message}`);
    }
  }
  return list.map(m => m.id);
}
