import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db.js';
import { Engine } from '../server/engine.js';
import { Campaigns } from '../server/campaigns.js';
import { hashPin, checkPin } from '../server/accounts.js';

// Une base de l'ancienne version : une campagne implicite (''), deux autres nommées par les
// fiches, un MJ global, un MJ « de » une autre campagne, des joueurs avec leurs fiches.
function legacyDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE docs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, updated_at INTEGER);
    CREATE TABLE sessions (token TEXT PRIMARY KEY, role TEXT NOT NULL, char_id TEXT, created_at INTEGER, last_seen INTEGER, account_id TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, data TEXT);
    CREATE TABLE accounts (id TEXT PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL, pin_hash TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 1, chars TEXT NOT NULL DEFAULT '[]', created_at INTEGER, last_login INTEGER, dm_of TEXT);
  `);
  const doc = (id, kind, data) => db.prepare('INSERT INTO docs (id, kind, data, version) VALUES (?, ?, ?, 3)').run(id, kind, JSON.stringify(data));
  doc('party', 'party', { stash: { s1: { name: 'Rope', qty: 1 } }, fund: { po: 2 }, log: {} });
  doc('party:side', 'party', { stash: {}, fund: {}, log: {} });
  doc('c-grom', 'char', { name: 'Grom', features: 'FIGHTER\n- Second Wind : 1d10.\n- Action Surge : une action.', musicRemote: true });
  doc('c-vex', 'char', { name: 'Vex', campaign: 'side' });
  doc('c-odo', 'char', { name: 'Odo', campaign: 'oneshot' });
  doc('c-lira', 'char', { name: 'Lira', campaign: 'side' });
  const acc = (id, login, role, chars, dmOf = null) => db.prepare('INSERT INTO accounts (id, login, name, role, pin_hash, must_change, chars, dm_of) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
    .run(id, login, login, role, hashPin('1234'), JSON.stringify(chars), dmOf);
  acc('a-mj', 'mj', 'dm', ['c-vex', 'c-odo']);
  acc('a-lea', 'lea', 'player', ['c-grom']);
  acc('a-paul', 'paul', 'player', [], 'side');
  acc('a-max', 'max', 'player', ['c-lira']);
  db.prepare("INSERT INTO settings (key, value) VALUES ('sessionNumber', '9')").run();
  db.prepare('INSERT INTO rolls (at, data) VALUES (1, ?)').run(JSON.stringify({ who: 'Grom', campaign: '', total: 12 }));
  db.prepare('INSERT INTO rolls (at, data) VALUES (2, ?)').run(JSON.stringify({ who: 'Lira', campaign: 'side', total: 7 }));
  db.prepare("INSERT INTO sessions (token, role, account_id) VALUES ('old', 'dm', 'a-mj')").run();
  db.close();
}

test('une base mono-campagne devient trois campagnes, sans rien perdre', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-mig-'));
  const file = path.join(dir, 'f.sqlite');
  legacyDb(file);
  const db = openDb(file, { backupDir: path.join(dir, 'bk') });
  assert.deepEqual(db.migrated, [1, 2, 3, 4]);
  assert.ok(fs.readdirSync(path.join(dir, 'bk', 'migrations')).length, 'copie de la base avant migration');
  const campaigns = new Campaigns(db);
  assert.deepEqual(campaigns.list().map(c => c.id).sort(), ['main', 'oneshot', 'side']);
  assert.equal(campaigns.get('main').name, 'Campagne principale');
  assert.equal(campaigns.settings('main').currency[2].value, 10000, 'le taux maison de la campagne d’origine est gardé');
  assert.equal(campaigns.settings('side').currency[2].key, 'gp');
  assert.equal(campaigns.settings('main').sessionNumber, 9);

  // Les rôles : MJ global → admin et MJ de la campagne d’origine ; « MJ de » → MJ ; fiches → joueurs.
  const role = (acc, cid) => db.roleOf(cid, acc);
  assert.equal(db.getAccount('a-mj').isAdmin, true);
  assert.equal(role('a-mj', 'main'), 'dm');
  assert.equal(role('a-mj', 'side'), 'player');
  assert.equal(role('a-mj', 'oneshot'), 'dm', 'campagne sans MJ sur l’application : l’admin en devient le MJ');
  assert.equal(role('a-paul', 'side'), 'dm');
  assert.equal(role('a-lea', 'main'), 'player');
  assert.equal(role('a-max', 'side'), 'player');
  assert.equal(role('a-lea', 'side'), null);
  assert.equal(db.getAccount('a-paul').isAdmin, false);
  // Migration 4 : ceux qui mènent une campagne, et l'admin, peuvent en créer ; les joueurs non.
  assert.equal(db.getAccount('a-mj').canCreate, true);
  assert.equal(db.getAccount('a-paul').canCreate, true);
  assert.equal(db.getAccount('a-max').canCreate, false);

  // Les fiches, la réserve, les jets : chacun dans sa campagne.
  const engine = new Engine({ db, settingsOf: cid => campaigns.settings(cid) }).load();
  assert.equal(engine.docs.get('c-grom').campaign, 'main');
  assert.equal(engine.docs.get('c-grom').owner, 'a-lea');
  assert.equal(engine.docs.get('c-vex').owner, 'a-mj');
  assert.equal(engine.docs.get('c-grom').data.musicRemote, undefined);
  assert.equal(engine.docs.get('party:main').data.fund.po, 2);
  assert.ok(!engine.docs.has('party'));
  assert.equal(Object.keys(engine.docs.get('c-grom').data.featureList).length, 2, 'les capacités deviennent une liste');
  assert.deepEqual(db.recentRolls('side').map(r => r.who), ['Lira']);
  assert.equal(db.getSession('old'), null, 'les anciennes sessions ne valent plus rien');
  assert.ok(checkPin('1234', db.getAccount('a-max').pinHash), 'les PIN restent valables');

  // Rouvrir : aucune migration de plus.
  engine.flush();
  db.close();
  const again = openDb(file);
  assert.deepEqual(again.migrated, []);
  again.close();
});
