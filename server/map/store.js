// Scènes d'une campagne, dans la base : la scène (image, grille, murs, portes) et son état
// (tokens, brouillard, dessins, combat). Écrites peu après chaque modification.
import crypto from 'node:crypto';
import { normalizeScene, SceneError, slugify } from '../../shared/map/scene.js';
import { MapDoc, newState, SCENE_ROOTS, STATE_ROOTS } from '../../shared/map/ops.js';

const SAVE_DELAY = 400;
const SCENE = new Set(SCENE_ROOTS);
const STATE = new Set(STATE_ROOTS);
const ID_RE = /^[\w.-]{1,80}$/;

export class SceneStore {
  constructor(db, campaign, { onListChange = () => {} } = {}) {
    this.db = db;
    this.campaign = campaign;
    this.docs = new Map(); // id -> { doc: MapDoc, dirtyScene, dirtyState, timer }
    this.onListChange = onListChange;
  }

  list() {
    return this.db.scenesOf(this.campaign).map(r => {
      const open = this.docs.get(r.id);
      const d = open ? open.doc.doc : r.scene;
      return { id: r.id, name: d.name || r.id, folder: d.folder || 'Sans dossier', order: d.order, fog: d.fog !== false, image: d.image || '' };
    }).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  has(id) {
    return this.docs.has(id) || !!this.db.getScene(this.campaign, id);
  }

  open(id) {
    if (this.docs.has(id)) return this.docs.get(id).doc;
    if (!ID_RE.test(String(id || ''))) throw new SceneError('Identifiant de carte invalide');
    const row = this.db.getScene(this.campaign, id);
    if (!row) throw new SceneError(`Carte introuvable : ${id}`);
    const scene = normalizeScene(row.scene, id);
    const doc = new MapDoc(scene, row.state || {});
    this.docs.set(id, { doc, dirtyScene: false, dirtyState: false, timer: null });
    return doc;
  }

  uniqueId(name) {
    const base = slugify(name) || `carte-${crypto.randomBytes(2).toString('hex')}`;
    let id = base;
    for (let n = 2; this.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  create({ name, folder, fog, image, imageSize, cols, rows, feetPerCell, offset, walls = [] }) {
    const id = this.uniqueId(name);
    const scene = normalizeScene({ name, folder, fog, image, imageSize, grid: { cols, rows, feetPerCell: feetPerCell || 5, offset }, walls }, name);
    const doc = new MapDoc(scene, newState());
    this.db.putScene(this.campaign, id, doc.sceneData(), doc.stateData());
    this.docs.set(id, { doc, dirtyScene: false, dirtyState: false, timer: null });
    this.onListChange();
    return id;
  }

  // Import complet (API, ancienne version) : scène et, si fourni, état.
  importScene(id, sceneRaw, state = null) {
    const sid = id && ID_RE.test(id) && !this.has(id) ? id : this.uniqueId(sceneRaw?.name || 'carte');
    const scene = normalizeScene(sceneRaw, sceneRaw?.name || sid);
    const doc = new MapDoc(scene, state || newState());
    this.db.putScene(this.campaign, sid, doc.sceneData(), doc.stateData());
    this.docs.delete(sid);
    this.onListChange();
    return sid;
  }

  // Remplace la scène (image, grille, murs) en gardant l'état : rend la mise à jour à diffuser.
  replaceScene(id, raw) {
    const doc = this.open(id);
    const scene = normalizeScene(raw, doc.doc.name);
    const update = doc.replaceScene(scene);
    this.markDirty(id, SCENE_ROOTS);
    this.onListChange();
    return update;
  }

  remove(id) {
    const e = this.docs.get(id);
    if (e) clearTimeout(e.timer);
    this.docs.delete(id);
    this.db.deleteScene(this.campaign, id);
    this.onListChange();
  }

  markDirty(id, roots) {
    const e = this.docs.get(id);
    if (!e) return;
    if (roots.some(r => SCENE.has(r))) e.dirtyScene = true;
    if (roots.some(r => STATE.has(r))) e.dirtyState = true;
    clearTimeout(e.timer);
    e.timer = setTimeout(() => this.save(id), SAVE_DELAY);
    e.timer.unref?.();
  }

  save(id) {
    const e = this.docs.get(id);
    if (!e) return;
    clearTimeout(e.timer);
    e.timer = null;
    if (e.dirtyScene) this.db.putSceneOnly(this.campaign, id, e.doc.sceneData());
    if (e.dirtyState) this.db.putStateOnly(this.campaign, id, e.doc.stateData());
    e.dirtyScene = false;
    e.dirtyState = false;
  }

  flush() {
    for (const id of this.docs.keys()) this.save(id);
  }

  close() {
    this.flush();
    for (const e of this.docs.values()) clearTimeout(e.timer);
  }
}
