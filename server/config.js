// Configuration du serveur : config.json (créé au premier lancement) et variables d'environnement.
// Rien ici ne concerne une campagne : les campagnes et leurs réglages vivent dans la base.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_FILE = process.env.DND_TABLE_CONFIG || process.env.DND_SHEET_CONFIG || path.join(APP_DIR, 'config.json');

export const DEFAULTS = {
  port: 3000,
  host: '0.0.0.0',
  // Adresse publique, derrière un proxy HTTPS : sert aux liens d'invitation et au QR code.
  publicUrl: null,
  // Données : la base SQLite et les fichiers envoyés (images, mondes). Hors du dépôt.
  dataDir: 'data',
  backupDir: 'backups',
  backupKeepDays: 30,
  // Données 5etools, téléchargées par `npm run 5etools`.
  fiveEToolsDir: '5etools',
  // Bibliothèque globale de tokens (dossier en lecture seule), ou null.
  libraryDir: null,
  // Inscription : « invite » (lien d'une campagne), « open » (tout le monde) ou « closed ».
  // Modifiable depuis la console admin ; cette valeur sert au premier démarrage.
  signup: 'invite',
  maxUploadBytes: 25_000_000,
  campaignQuotaBytes: 1_000_000_000,
  python: 'python3',
  https: null,
  // Derrière Caddy ou nginx : lire l'adresse du client dans X-Forwarded-For.
  trustProxy: true,
};

export function loadConfig({ create = true } = {}) {
  let user = {};
  let created = false;
  if (fs.existsSync(CONFIG_FILE)) {
    user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } else if (create) {
    user = { port: DEFAULTS.port };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(user, null, 2) + '\n');
    created = true;
  }
  const cfg = { ...DEFAULTS, ...user };
  const env = process.env;
  if (env.PORT) cfg.port = Number(env.PORT);
  if (env.DND_DATA_DIR) cfg.dataDir = env.DND_DATA_DIR;
  if (env.DND_BACKUP_DIR) cfg.backupDir = env.DND_BACKUP_DIR;
  if (env.DND_5ETOOLS_DIR) cfg.fiveEToolsDir = env.DND_5ETOOLS_DIR;
  if (env.DND_LIBRARY_DIR) cfg.libraryDir = env.DND_LIBRARY_DIR;
  if (env.DND_PUBLIC_URL) cfg.publicUrl = env.DND_PUBLIC_URL;
  cfg.created = created;
  return cfg;
}

export function resolveFromApp(p) {
  return path.isAbsolute(p) ? p : path.resolve(APP_DIR, p);
}
