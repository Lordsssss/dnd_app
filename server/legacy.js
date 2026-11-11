// Import des fichiers de l'ancienne version, quand l'application vivait dans un coffre Obsidian :
//   maps/<id>.json et <id>.state.json   → scènes de la campagne
//   maps/_library.json                    → images choisies par créature et par personnage
//   maps/_session.json                    → scène de la TV
//   maps/_monde.json + images/monde/*.map → monde de la campagne
// Les images citées sont copiées dans les fichiers de la campagne ; celles d'un dossier de
// bibliothèque (FA_Tokens) deviennent des références `lib:`. Les ennemis liés à un bloc de stats
// d'une note deviennent des entrées du bestiaire.
// La base elle-même est convertie par les migrations (migrations.js), à l'ouverture.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeScene } from '../shared/map/scene.js';
import { normalizeBeast } from '../shared/bestiary.js';
import { VaultNotes } from './map/notes.js';

const readJson = (file, d) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return d; } };

export function importLegacyFiles({ db, assets, campaigns, worlds, campaign, mapsDir, vaultDir, libraryDir = null, libraryFolders = ['FA_Tokens'], notesDirs = [], log = () => {} }) {
  const summary = { scenes: 0, images: 0, library: 0, beasts: 0, world: false, missing: [] };
  const imported = new Map(); // chemin du coffre → ref
  const notes = notesDirs.length ? new VaultNotes(vaultDir, notesDirs) : null;
  const beastIds = new Map(); // `${file}|${title}` → id

  function imageRef(rel, kind) {
    if (!rel) return '';
    const clean = String(rel);
    if (clean.startsWith('asset:') || clean.startsWith('lib:')) return clean;
    if (imported.has(clean)) return imported.get(clean);
    const top = clean.split('/')[0];
    if (libraryDir && libraryFolders.includes(top) && fs.existsSync(path.join(libraryDir, clean))) {
      const ref = `lib:${clean}`;
      imported.set(clean, ref);
      return ref;
    }
    const full = path.resolve(vaultDir, clean);
    if (!full.startsWith(path.resolve(vaultDir) + path.sep) || !fs.existsSync(full)) {
      summary.missing.push(clean);
      imported.set(clean, '');
      return '';
    }
    const a = assets.save({ campaign, kind, name: path.basename(clean), buffer: fs.readFileSync(full) });
    summary.images++;
    const ref = `asset:${a.id}`;
    imported.set(clean, ref);
    return ref;
  }

  function beastRef(ref) {
    if (!ref || ref.t !== 'note' || !notes) return ref?.t === 'note' ? null : ref;
    const key = `${ref.file}|${ref.title || ''}`;
    if (beastIds.has(key)) return { t: 'beast', id: beastIds.get(key) };
    const b = notes.block(ref.file, ref.title);
    if (!b) { summary.missing.push(`${ref.file} › ${ref.title}`); return null; }
    const id = `b${crypto.randomBytes(6).toString('hex')}`;
    db.putBeast(campaign, id, normalizeBeast({
      name: b.name, kind: 'markdown', body: [`**${b.title}**`, ...b.body].join('\n'), size: b.size || 1, init: b.init,
      origin: { file: ref.file, title: b.title, link: b.link || ref.link || '' },
    }));
    beastIds.set(key, id);
    summary.beasts++;
    return { t: 'beast', id };
  }

  // Scènes.
  const names = fs.existsSync(mapsDir) ? fs.readdirSync(mapsDir) : [];
  for (const n of names.filter(x => x.endsWith('.json') && !x.endsWith('.state.json') && !x.startsWith('_')).sort()) {
    const id = n.slice(0, -5);
    const raw = readJson(path.join(mapsDir, n), null);
    if (!raw) { summary.missing.push(n); continue; }
    raw.image = imageRef(raw.image, 'map');
    let scene;
    try { scene = normalizeScene(raw, id); } catch (e) { summary.missing.push(`${n} : ${e.message}`); continue; }
    const state = readJson(path.join(mapsDir, `${id}.state.json`), {});
    state.tokens = (state.tokens || []).map(t => ({ ...t, image: imageRef(t.image, 'token'), ref: beastRef(t.ref) }));
    db.putScene(campaign, id, scene, state);
    summary.scenes++;
    log(`  carte ${id}`);
  }

  // Bibliothèque d'images par créature et par personnage.
  const lib = readJson(path.join(mapsDir, '_library.json'), null);
  if (lib) {
    const out = { monsters: {}, characters: {} };
    for (const [k, v] of Object.entries(lib.monsters || {})) {
      const val = typeof v === 'string' ? imageRef(v, 'token') : v && { ...v, image: imageRef(v.image, 'token') };
      if (val && (typeof val === 'string' ? val : val.image)) { out.monsters[k] = val; summary.library++; }
    }
    for (const [k, v] of Object.entries(lib.characters || {})) {
      const val = imageRef(v, 'token');
      if (val) { out.characters[k] = val; summary.library++; }
    }
    campaigns.setInternal(campaign, 'library', out);
  }
  const session = readJson(path.join(mapsDir, '_session.json'), null);
  if (session?.tvScene) campaigns.setInternal(campaign, 'tvScene', session.tvScene);

  // Monde : le .map le plus récent et sa couche de lore.
  const mondeDir = path.join(vaultDir, 'images', 'monde');
  const maps = fs.existsSync(mondeDir) ? fs.readdirSync(mondeDir).filter(x => x.toLowerCase().endsWith('.map')).map(x => path.join(mondeDir, x)) : [];
  const newest = maps.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (newest) {
    worlds.setMap(campaign, fs.readFileSync(newest, 'utf8'));
    const overlay = readJson(path.join(mapsDir, '_monde.json'), null);
    if (overlay) db.putWorld(campaign, { ...worlds.row(campaign), overlay });
    worlds.forget(campaign);
    summary.world = true;
  }
  return summary;
}
