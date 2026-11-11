// Pont vers un coffre Obsidian, réglé par l'admin pour une campagne précise et aucune autre.
//   app → coffre : fiches et fiche de groupe en Markdown (export.js)
//   coffre → app : blocs de stats des notes, importés dans le bestiaire de la campagne
//   lecture seule : les notes liées aux lieux de la carte du monde, côté MJ
// Une campagne sans pont n'écrit ni ne lit rien hors de la base : c'est ce qui empêche une
// campagne d'apparaître dans le coffre d'une autre.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './http.js';
import { runExport, suggestSession } from './export.js';
import { VaultNotes, parseStatBlocks } from './map/notes.js';

const clean = (v, max = 300) => String(v ?? '').trim().slice(0, max);

// Valide un réglage de pont envoyé par l'admin. Les dossiers sont relatifs au coffre.
export function normalizeBridge(raw) {
  if (!raw || !clean(raw.vaultDir)) return null;
  const vaultDir = path.resolve(clean(raw.vaultDir, 1000));
  if (!fs.existsSync(vaultDir) || !fs.statSync(vaultDir).isDirectory()) throw new HttpError(400, 'Dossier du coffre introuvable sur le serveur : {dir}', { dir: vaultDir });
  const rel = (v, d) => {
    const r = clean(v ?? d, 300).replace(/^\/+/, '');
    if (r.split(/[\\/]/).includes('..')) throw new HttpError(400, 'Chemin invalide : {dir}', { dir: r });
    return r;
  };
  const list = (v, d) => (Array.isArray(v) ? v : String(v ?? d).split(/\n|,/)).map(x => rel(x, '')).filter(Boolean).slice(0, 10);
  return {
    vaultDir,
    exportPath: rel(raw.exportPath, 'Personnages'),
    sessionsPath: rel(raw.sessionsPath, ''),
    notesDirs: list(raw.notesDirs, ''),
    worldNotesRoot: rel(raw.worldNotesRoot, ''),
    fileNamePattern: clean(raw.fileNamePattern || '{name} - Fiche', 80),
    partyFileName: clean(raw.partyFileName || 'Groupe - Fiche commune', 80),
  };
}

export function createBridge(bridge, { db, backupDir }) {
  if (!bridge?.vaultDir) return null;
  const vaultDir = bridge.vaultDir;
  const abs = rel => path.resolve(vaultDir, rel || '.');
  const statNotes = bridge.notesDirs?.length ? new VaultNotes(vaultDir, bridge.notesDirs) : null;
  const notesRoot = bridge.worldNotesRoot ? abs(bridge.worldNotesRoot) : null;

  function cfgFor(settings) {
    return {
      exportPath: abs(bridge.exportPath),
      attachmentsFolder: 'attachments',
      fileNamePattern: bridge.fileNamePattern,
      partyFileName: bridge.partyFileName,
      backupDir,
      currency: settings.currency,
      coinWeight: settings.coinWeight,
      sessionsPath: bridge.sessionsPath ? abs(bridge.sessionsPath) : null,
    };
  }

  // Notes de la carte du monde : tout fichier .md sous la racine choisie.
  const worldNotes = notesRoot ? {
    list() {
      const out = [];
      const walk = d => {
        let entries = [];
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (e.name.startsWith('.')) continue;
          const full = path.join(d, e.name);
          if (e.isDirectory()) walk(full);
          else if (e.name.endsWith('.md')) out.push(path.relative(vaultDir, full).split(path.sep).join('/'));
        }
      };
      walk(notesRoot);
      return out.sort((a, b) => a.localeCompare(b, 'fr'));
    },
    valid(rel) {
      const full = path.resolve(vaultDir, String(rel || ''));
      if (!full.startsWith(notesRoot + path.sep) || !full.endsWith('.md') || !fs.existsSync(full)) return null;
      return path.relative(vaultDir, full).split(path.sep).join('/');
    },
    read(rel) { return fs.readFileSync(path.resolve(vaultDir, rel), 'utf8'); },
  } : null;

  return {
    config: bridge,
    exportDir: abs(bridge.exportPath),
    suggestSession: () => (bridge.sessionsPath ? suggestSession({ sessionsPath: abs(bridge.sessionsPath) }) : null),
    export({ chars, party, settings, session, only = null }) {
      return runExport({ chars, party, db, cfg: cfgFor(settings), session, only });
    },
    worldNotes,
    // Les blocs de stats des notes, pour l'import dans le bestiaire.
    statBlocks() {
      if (!statNotes) return [];
      const out = [];
      for (const file of statNotes.files()) {
        const entry = statNotes.read(file);
        for (const b of entry?.blocks || []) out.push({ file, ...b });
      }
      return out;
    },
    parseStatBlocks,
  };
}
