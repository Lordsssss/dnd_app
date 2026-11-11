// Ligne de commande : npm run cli -- <commande>
// Les commandes de comptes marchent pendant que le serveur tourne (la base est partagée).
// `import-legacy` demande un serveur arrêté : il écrit des scènes et des images.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, resolveFromApp, CONFIG_FILE } from './config.js';
import { openDb } from './db.js';
import { Engine } from './engine.js';
import { hashPin, tempPin, loginKey } from './accounts.js';
import { dailyBackup } from './backup.js';
import { fetch5eTools } from './fetch5e.js';
import { Campaigns } from './campaigns.js';
import { AssetStore } from './assets.js';
import { Worlds } from './worlds.js';
import { importLegacyFiles } from './legacy.js';
import { normalizeBridge } from './bridge.js';

const HELP = `
Commandes :
  list                          Comptes, rôle admin, campagnes et rôle dans chacune
  campaigns                     Campagnes, membres, nombre de fiches et de cartes
  reset identifiant             Donne un PIN temporaire à un compte, à changer à la connexion
  admin identifiant [on|off]    Donne ou retire l'accès admin
  backup                        Sauvegarde immédiate de la base
  fetch-5etools                 Télécharge ou met à jour les données 5etools (gratuit, sans clé)
  bridge id --vault dossier [--export dossier] [--sessions dossier] [--notes "dossier,dossier"] [--world-notes dossier]
                                Relie une campagne à un coffre Obsidian (dossiers relatifs au coffre).
  bridge id --off               Retire le pont d'une campagne
  import-legacy --campaign id --maps dossier --vault dossier [--library dossier] [--notes "Campagne/Aventures"]
                                Importe les cartes, la bibliothèque et le monde de l'ancienne version.
                                Serveur arrêté.
`;

function parseArgs(argv) {
  const pos = [], opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else pos.push(argv[i]);
  }
  return { pos, opts };
}

function serverRunning(cfg) {
  const lock = path.join(resolveFromApp(cfg.dataDir), 'server.json');
  try {
    const info = JSON.parse(fs.readFileSync(lock, 'utf8'));
    process.kill(info.pid, 0);
    return info;
  } catch { return null; }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opts } = parseArgs(rest);
  const cfg = loadConfig({ create: false });
  if (!cmd || cmd === 'help' || cmd === '--help') { console.log(HELP); return; }
  if (!fs.existsSync(CONFIG_FILE)) console.warn(`Note : ${CONFIG_FILE} n'existe pas encore. Lance « npm start » une première fois pour le créer.`);
  const dataDir = resolveFromApp(cfg.dataDir);
  const backupDir = resolveFromApp(cfg.backupDir);

  if (cmd === 'fetch-5etools') {
    const dir = resolveFromApp(cfg.fiveEToolsDir);
    console.log(`Téléchargement des données 5etools vers ${dir}…`);
    const r = await fetch5eTools(dir);
    console.log(`Terminé : ${r.downloaded} fichier(s) téléchargé(s), ${r.unchanged ?? 0} inchangé(s).`);
    return;
  }

  const db = openDb(path.join(dataDir, 'fiches.sqlite'), { backupDir });
  const campaigns = new Campaigns(db);
  try {
    if (cmd === 'list') {
      for (const a of db.listAccounts()) {
        const roles = campaigns.campaignsOf(a.id).map(m => `${m.campaign.name} (${m.role})`).join(', ') || '—';
        const state = a.mustChange ? 'mot de passe temporaire' : a.secretKind === 'pin' ? 'PIN' : 'mot de passe';
        console.log(`${a.login.padEnd(14)} ${a.name.padEnd(20)} ${a.isAdmin ? 'admin ' : '      '} ${state.padEnd(24)} ${roles}`);
      }
      return;
    }
    if (cmd === 'campaigns') {
      const engine = new Engine({ db }).load();
      for (const c of campaigns.list()) {
        const members = db.membersOf(c.id).map(m => `${m.name} (${m.role})`).join(', ');
        console.log(`${c.id.padEnd(14)} ${c.name.padEnd(28)} ${String(engine.charsIn(c.id).length).padStart(2)} fiche(s) · ${db.scenesOf(c.id).length} carte(s)${c.bridge ? ' · pont vers un coffre' : ''}\n${' '.repeat(15)}${members}`);
      }
      return;
    }
    if (cmd === 'reset' || cmd === 'reset-pin') {
      const a = db.getAccountByLogin(loginKey(pos[0]));
      if (!a) throw new Error(`Compte introuvable : ${pos[0]}`);
      const pin = tempPin();
      db.putAccount({ ...a, pinHash: hashPin(pin), mustChange: true, secretKind: 'pin' });
      db.deleteAccountSessions(a.id);
      console.log(`${a.name} (${a.login}) : PIN temporaire ${pin}, à changer à la prochaine connexion.`);
      return;
    }
    if (cmd === 'admin') {
      const a = db.getAccountByLogin(loginKey(pos[0]));
      if (!a) throw new Error(`Compte introuvable : ${pos[0]}`);
      const on = pos[1] !== 'off';
      db.putAccount({ ...a, isAdmin: on });
      console.log(`${a.name} : accès admin ${on ? 'donné' : 'retiré'}.`);
      return;
    }
    if (cmd === 'backup') {
      const f = dailyBackup(db, backupDir, { keep: cfg.backupKeepDays, force: true });
      console.log(`Sauvegarde : ${f}`);
      return;
    }
    if (cmd === 'bridge') {
      const c = campaigns.get(pos[0]);
      if (!c) throw new Error(`Campagne inconnue : ${pos[0]}. « npm run cli -- campaigns » les liste.`);
      if (opts.off) { campaigns.setBridge(c.id, null); console.log(`${c.name} : pont retiré.`); return; }
      const bridge = normalizeBridge({ vaultDir: opts.vault, exportPath: opts.export, sessionsPath: opts.sessions, notesDirs: opts.notes, worldNotesRoot: opts['world-notes'] });
      if (!bridge) throw new Error('--vault est obligatoire');
      const clash = campaigns.list().find(x => x.id !== c.id && x.bridge && path.resolve(x.bridge.vaultDir) === bridge.vaultDir);
      if (clash) throw new Error(`Ce coffre est déjà relié à « ${clash.name} »`);
      campaigns.setBridge(c.id, bridge);
      console.log(`${c.name} relié à ${bridge.vaultDir}\n${JSON.stringify(bridge, null, 2)}\nRedémarre le serveur s'il tourne.`);
      return;
    }
    if (cmd === 'import-legacy') {
      if (serverRunning(cfg)) throw new Error('Arrête le serveur avant d\'importer : il garde les cartes en mémoire.');
      const campaign = String(opts.campaign || '');
      if (!campaigns.get(campaign)) throw new Error(`Campagne inconnue : ${campaign}. « npm run cli -- campaigns » les liste.`);
      if (!opts.maps || !opts.vault) throw new Error('--maps et --vault sont obligatoires');
      const filesDir = path.join(dataDir, 'files');
      const assets = new AssetStore(db, filesDir, { maxBytes: 200_000_000, quotaBytes: Infinity });
      const worlds = new Worlds(db, filesDir);
      const libraryDir = opts.library ? path.resolve(String(opts.library)) : cfg.libraryDir ? resolveFromApp(cfg.libraryDir) : null;
      const notesDirs = opts.notes ? String(opts.notes).split(',').map(s => s.trim()).filter(Boolean) : [];
      console.log(`Import vers « ${campaigns.get(campaign).name} »…`);
      const r = importLegacyFiles({
        db, assets, campaigns, worlds, campaign, mapsDir: path.resolve(String(opts.maps)), vaultDir: path.resolve(String(opts.vault)),
        libraryDir, notesDirs, log: m => console.log(m),
      });
      console.log(`Terminé : ${r.scenes} carte(s), ${r.images} image(s) copiée(s), ${r.library} entrée(s) de bibliothèque, ${r.beasts} créature(s) au bestiaire, monde ${r.world ? 'importé' : 'absent'}.`);
      if (r.missing.length) console.log(`Introuvable (${r.missing.length}) :\n  ${[...new Set(r.missing)].join('\n  ')}`);
      return;
    }
    console.log(HELP);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
