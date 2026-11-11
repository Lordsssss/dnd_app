// Point d'entrée : npm start
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, resolveFromApp, CONFIG_FILE } from './config.js';
import { openDb } from './db.js';
import { Engine } from './engine.js';
import { FiveETools } from './data5e.js';
import { createApp } from './app.js';
import { dailyBackup } from './backup.js';
import { ensureAdmin } from './accounts.js';
import { lanAddresses, qrTerminal } from './lan.js';

const cfg = loadConfig();
const dataDir = resolveFromApp(cfg.dataDir);
const backupRoot = resolveFromApp(cfg.backupDir);
const db = openDb(path.join(dataDir, 'fiches.sqlite'), { backupDir: backupRoot });
const engine = new Engine({ db }).load();
const admin = ensureAdmin(db);
const data5e = new FiveETools(resolveFromApp(cfg.fiveEToolsDir), ['XPHB', 'XDMG', 'XMM', 'PHB', 'DMG', 'MM', 'TCE', 'XGE']).load();
// Titres de section des livres et aventures : indexés après le démarrage, sans le ralentir.
data5e.buildHeadingsLater();
const { server, map } = createApp({ engine, db, cfg, data5e });

const lockFile = path.join(dataDir, 'server.json');

// Les fiches modifiées sont écrites chaque seconde.
const flusher = setInterval(() => {
  try { engine.flush(); } catch (e) { console.error('Écriture SQLite impossible :', e.message); }
}, 1000);

function backupNow() {
  try {
    const f = dailyBackup(db, backupRoot, { keep: cfg.backupKeepDays });
    if (f) console.log(`  Sauvegarde du jour : ${f}`);
  } catch (e) { console.error('Sauvegarde impossible :', e.message); }
}
const backupTimer = setInterval(backupNow, 60 * 60 * 1000);

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`\n  Le port ${cfg.port} est déjà utilisé. Change "port" dans ${CONFIG_FILE} ou ferme l'autre instance.\n`);
  else console.error(e);
  process.exit(1);
});

server.listen(cfg.port, cfg.host, () => {
  fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, port: cfg.port, https: !!cfg.https, startedAt: Date.now() }));
  backupNow();
  const proto = cfg.https ? 'https' : 'http';
  const s = data5e.status();
  console.log('');
  console.log('  ⚔  Table D&D : serveur prêt');
  console.log('');
  console.log(`  Sur ce poste : ${proto}://localhost:${cfg.port}`);
  if (cfg.publicUrl) console.log(`  Adresse publique : ${cfg.publicUrl}`);
  const lan = lanAddresses()[0];
  if (lan && !cfg.publicUrl) {
    const url = `${proto}://${lan.ip}:${cfg.port}`;
    console.log(`  Réseau local : ${url}`);
    console.log(qrTerminal(url));
  }
  console.log(`  Données : ${dataDir}`);
  console.log(`  5etools : ${s.error ? s.error : `${s.spells} sorts, ${s.items} objets, ${s.monsters} créatures, ${s.books} livres et aventures`}`);
  if (cfg.libraryDir) console.log(`  Bibliothèque de tokens : ${resolveFromApp(cfg.libraryDir)}`);
  if (db.migrated?.length) console.log(`  Base mise à jour : migration${db.migrated.length > 1 ? 's' : ''} ${db.migrated.join(', ')} (copie d'avant dans ${path.join(backupRoot, 'migrations')})`);
  if (cfg.created) console.log(`  Configuration créée : ${CONFIG_FILE}`);
  if (admin) {
    console.log('');
    console.log(`  Compte admin créé : identifiant ${admin.login}, PIN temporaire ${admin.pin}`);
    console.log('  (affiché une seule fois ; « npm run cli -- reset admin » en donne un nouveau)');
  }
  console.log('');
});

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(flusher);
  clearInterval(backupTimer);
  try { engine.flush(); } catch (e) { console.error(e); }
  try { map.flush(); } catch (e) { console.error(e); }
  try { fs.rmSync(lockFile, { force: true }); } catch { /* ignore */ }
  server.close(() => { db.close(); process.exit(code); });
  setTimeout(() => process.exit(code), 1500).unref();
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
process.on('SIGHUP', () => shutdown());
// Redémarrage sans droits d'administration : on enregistre, puis on sort avec un code d'erreur,
// et systemd (Restart=on-failure) relance le service. « kill -USR2 <pid> ».
process.on('SIGUSR2', () => { console.log('  Redémarrage demandé (SIGUSR2)'); shutdown(75); });
