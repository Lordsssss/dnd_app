// Les mondes des campagnes : un fichier .map d'Azgaar ou une simple image, plus la couche de
// lore (noms corrigés, notes du MJ, texte pour les joueurs, lieux ajoutés, groupe) en base.
// Le .map vit sous data/files/worlds/<campagne>/current.map ; les versions remplacées ou
// réécrites sont gardées à côté, les dix dernières.
import fs from 'node:fs';
import path from 'node:path';
import { createWorld, WorldError } from './world.js';

const KEEP = 10;

export class Worlds {
  constructor(db, root, { bridgeOf = () => null } = {}) {
    this.db = db;
    this.root = path.join(root, 'worlds');
    this.bridgeOf = bridgeOf;
    this.cache = new Map();
    fs.mkdirSync(this.root, { recursive: true });
  }

  dir(cid) { return path.join(this.root, cid.replace(/[^\w-]/g, '')); }
  mapPath(cid) { return path.join(this.dir(cid), 'current.map'); }

  row(cid) {
    return this.db.getWorld(cid) || { campaign: cid, overlay: {}, mapFile: null, image: null };
  }

  of(cid) {
    let w = this.cache.get(cid);
    if (w) return w;
    w = createWorld({
      mapFile: () => (this.row(cid).mapFile ? this.mapPath(cid) : null),
      image: () => {
        const ref = this.row(cid).image;
        if (!ref) return null;
        const a = ref.startsWith('asset:') ? this.db.getAsset(ref.slice(6)) : null;
        return { ref, width: a?.width || null, height: a?.height || null };
      },
      loadOverlay: () => this.row(cid).overlay,
      saveOverlay: o => this.db.putWorld(cid, { ...this.row(cid), overlay: o }),
      notes: this.bridgeOf(cid)?.worldNotes || null,
      beforeWrite: file => this.keepVersion(cid, file),
    });
    this.cache.set(cid, w);
    return w;
  }

  // Le pont d'une campagne a changé : on reconstruit son monde.
  forget(cid) { this.cache.delete(cid); }

  keepVersion(cid, file) {
    if (!fs.existsSync(file)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, path.join(this.dir(cid), `${stamp}.map`));
    const old = fs.readdirSync(this.dir(cid)).filter(n => /^\d{4}-.*\.map$/.test(n)).sort();
    for (const n of old.slice(0, Math.max(0, old.length - KEEP))) fs.rmSync(path.join(this.dir(cid), n), { force: true });
  }

  // Un nouveau .map remplace l'ancien ; la couche de lore reste, liée aux identifiants d'Azgaar.
  setMap(cid, text) {
    if (!/^[\d.]+\|/.test(text.slice(0, 40)) && !text.includes('<svg')) throw new WorldError(400, 'Ce fichier ne ressemble pas à un .map d\'Azgaar');
    fs.mkdirSync(this.dir(cid), { recursive: true });
    const file = this.mapPath(cid);
    this.keepVersion(cid, file);
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
    this.db.putWorld(cid, { ...this.row(cid), mapFile: 'current.map', image: null });
    this.of(cid).reset();
    // Lecture d'essai : un fichier illisible est refusé tout de suite.
    try { this.of(cid).load(); } catch (e) {
      this.db.putWorld(cid, { ...this.row(cid), mapFile: null });
      throw new WorldError(400, 'Fichier .map illisible : {detail}', { detail: e.message });
    }
  }

  setImage(cid, ref) {
    this.db.putWorld(cid, { ...this.row(cid), image: ref, mapFile: null });
    this.of(cid).reset();
  }

  clear(cid) {
    this.db.putWorld(cid, { ...this.row(cid), image: null, mapFile: null });
    this.of(cid).reset();
  }

  mapText(cid) {
    const f = this.mapPath(cid);
    return this.row(cid).mapFile && fs.existsSync(f) ? fs.readFileSync(f) : null;
  }

  remove(cid) {
    this.cache.delete(cid);
    fs.rmSync(this.dir(cid), { recursive: true, force: true });
  }
}
