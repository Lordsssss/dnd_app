// État d'une scène et toutes les opérations possibles. Le serveur en est le seul auteur ;
// les clients reçoivent ce qui a changé. Pour ajouter une opération : une entrée dans OPS.
import { cutWallsUnder, eraseSegments, normalizeScene, SceneError, weldWalls } from './scene.js';
import { indexFor, givesVision } from './view.js';
import { visibilityPolygon } from './vision.js';
import * as tracker from './tracker.js';

export const SCENE_ROOTS = ['name', 'folder', 'order', 'fog', 'image', 'imageSize', 'grid', 'walls'];
export const STATE_ROOTS = ['tokens', 'explored', 'view', 'tvCamera', 'frozen', 'drawings', 'templates', 'fight'];

export function newState() {
  return { tokens: [], explored: {}, view: { mode: 'party' }, tvCamera: null, frozen: false, drawings: [], templates: [], fight: null };
}

const TOKEN_FIELDS = ['name', 'image', 'kind', 'size', 'scale', 'rotation', 'vision', 'hidden', 'defeated', 'init', 'ref', 'notes', 'conditions', 'hp', 'color'];
const cleanConditions = v => (Array.isArray(v) ? [...new Set(v.map(c => String(c).trim().slice(0, 40)).filter(Boolean))].slice(0, 20) : []);
// PV d'un token : suivis par le MJ, jamais montrés sur la TV.
const cleanHp = v => (v && typeof v === 'object' && isNum(Number(v.max)) && Number(v.max) > 0
  ? { current: Math.max(0, Math.min(99999, Math.round(Number(v.current ?? v.max)))), max: Math.min(99999, Math.round(Number(v.max))) }
  : null);
const COLORS = new Set(['', 'red', 'blue', 'green', 'yellow', 'purple', 'orange', 'white']);
const KINDS = new Set(['pc', 'enemy', 'ally', 'npc']);
const r3 = v => Math.round(Number(v) * 1000) / 1000;
const isNum = v => typeof v === 'number' && Number.isFinite(v);

function fail(msg) { throw new SceneError(msg); }

function checkPoint(p, what = 'point') {
  if (!Array.isArray(p) || !isNum(p[0]) || !isNum(p[1])) fail(`${what} invalide`);
  return [r3(p[0]), r3(p[1])];
}

function cleanToken(raw, rid) {
  const kind = KINDS.has(raw.kind) ? raw.kind : 'enemy';
  if (!isNum(raw.x) || !isNum(raw.y)) fail('Position du token invalide');
  return {
    id: raw.id || rid('t'),
    kind,
    name: String(raw.name || 'Token'),
    image: raw.image ? String(raw.image) : '',
    x: r3(raw.x),
    y: r3(raw.y),
    size: Math.max(1, Math.min(8, Math.round(Number(raw.size) || 1))),
    scale: Number(raw.scale) > 0 ? Number(raw.scale) : 1,
    rotation: isNum(raw.rotation) ? ((raw.rotation % 360) + 360) % 360 : 0,
    vision: raw.vision === undefined ? kind === 'pc' : !!raw.vision,
    hidden: !!raw.hidden,
    defeated: !!raw.defeated,
    init: isNum(raw.init) ? raw.init : null,
    ref: raw.ref && typeof raw.ref === 'object' ? raw.ref : null,
    notes: String(raw.notes || '').slice(0, 4000),
    conditions: cleanConditions(raw.conditions),
    hp: cleanHp(raw.hp),
    color: COLORS.has(raw.color) ? raw.color : '',
  };
}

// Chaque opération : les parties de l'état qu'elle touche, annulable ou non, et si elle peut
// révéler du brouillard. `run` modifie doc, en remplaçant les listes plutôt qu'en les mutant.
const OPS = {
  // ---------------------------------------------------- Murs et portes
  'wall.add': {
    roots: ['walls'], label: 'Mur',
    run(doc, op, x) {
      const kind = op.kind === 'door' ? 'door' : 'wall';
      const points = (op.points || []).map(p => checkPoint(p));
      if (points.length < 2) fail('Un mur a besoin de deux points');
      const w = { id: x.rid(kind === 'door' ? 'd' : 'w'), kind, points };
      if (kind === 'door') {
        w.open = false;
        if (op.group) w.group = String(op.group);
      }
      let walls = doc.walls;
      if (kind === 'door') {
        for (let i = 0; i + 1 < points.length; i++) walls = cutWallsUnder(walls, points[i], points[i + 1]);
      }
      doc.walls = weldWalls([...walls, w]);
    },
  },
  'wall.update': {
    roots: ['walls'], label: 'Mur',
    run(doc, op) {
      doc.walls = doc.walls.map(w => {
        if (w.id !== op.id) return w;
        const next = { ...w };
        if (op.kind === 'wall') { next.kind = 'wall'; delete next.open; delete next.group; }
        if (op.kind === 'door') { next.kind = 'door'; next.open = !!next.open; }
        if ('group' in op && next.kind === 'door') {
          if (op.group) next.group = String(op.group);
          else delete next.group;
        }
        return next;
      });
    },
  },
  'wall.remove': {
    roots: ['walls'], label: 'Suppression de mur',
    run(doc, op) {
      const ids = new Set(op.ids || []);
      doc.walls = doc.walls.filter(w => !ids.has(w.id));
    },
  },
  'wall.erase': {
    roots: ['walls'], label: 'Gomme',
    run(doc, op) { doc.walls = eraseSegments(doc.walls, op.items || []); },
  },
  // Déplace un sommet partout où il est partagé : les murs qui se touchent restent joints.
  'wall.moveVertex': {
    roots: ['walls'], label: 'Déplacement de sommet',
    run(doc, op) {
      const from = checkPoint(op.from);
      const to = checkPoint(op.to);
      const walls = doc.walls.map(w => {
        if (!w.points.some(p => p[0] === from[0] && p[1] === from[1])) return w;
        return { ...w, points: w.points.map(p => (p[0] === from[0] && p[1] === from[1] ? [...to] : p)) };
      });
      doc.walls = weldWalls(walls);
    },
  },
  'wall.insertVertex': {
    roots: ['walls'], label: 'Nouveau sommet',
    run(doc, op) {
      const at = checkPoint(op.at);
      doc.walls = doc.walls.map(w => {
        if (w.id !== op.id) return w;
        const points = [...w.points];
        points.splice(Number(op.seg) + 1, 0, at);
        return { ...w, points };
      });
    },
  },
  'door.toggle': {
    roots: ['walls'], label: 'Porte', reveal: true,
    run(doc, op) {
      const door = doc.walls.find(w => w.id === op.id && w.kind === 'door');
      if (!door) fail('Porte introuvable');
      const open = op.open === undefined ? !door.open : !!op.open;
      doc.walls = doc.walls.map(w => {
        const same = w.id === door.id || (door.group && w.kind === 'door' && w.group === door.group);
        return same ? { ...w, open } : w;
      });
    },
  },
  'walls.replace': {
    roots: ['walls'], label: 'Murs',
    run(doc, op) {
      doc.walls = normalizeScene({ grid: doc.grid, walls: op.walls || [] }).walls;
    },
  },

  // ---------------------------------------------------- Scène
  'scene.set': {
    roots: ['name', 'folder', 'fog', 'image', 'imageSize', 'grid'], label: 'Réglages de la carte', reveal: true,
    run(doc, op) {
      if (typeof op.name === 'string' && op.name.trim()) doc.name = op.name.trim();
      if (typeof op.folder === 'string' && op.folder.trim()) doc.folder = op.folder.trim();
      if (typeof op.fog === 'boolean') doc.fog = op.fog;
      if (typeof op.image === 'string') doc.image = op.image;
      if (Array.isArray(op.imageSize)) doc.imageSize = op.imageSize;
      if (op.grid) {
        const cols = Number(op.grid.cols ?? doc.grid.cols);
        const rows = Number(op.grid.rows ?? doc.grid.rows);
        if (!(cols > 0) || !(rows > 0)) fail('La grille doit avoir au moins une case');
        doc.grid = {
          ...doc.grid, cols, rows,
          feetPerCell: Number(op.grid.feetPerCell ?? doc.grid.feetPerCell) || 5,
          offset: Array.isArray(op.grid.offset) ? op.grid.offset.map(Number) : doc.grid.offset,
          show: op.grid.show === undefined ? doc.grid.show : !!op.grid.show,
        };
      }
    },
  },

  // ---------------------------------------------------- Tokens
  'token.add': {
    roots: ['tokens'], label: 'Ajout de token', reveal: true,
    run(doc, op, x) {
      doc.tokens = [...doc.tokens, ...(op.tokens || []).map(t => cleanToken(t, x.rid))];
    },
  },
  'token.move': {
    roots: ['tokens'], label: 'Déplacement', reveal: true,
    run(doc, op) {
      const to = new Map((op.moves || []).map(m => [m.id, m]));
      doc.tokens = doc.tokens.map(t => {
        const m = to.get(t.id);
        if (!m) return t;
        if (!isNum(m.x) || !isNum(m.y)) fail('Position du token invalide');
        return { ...t, x: r3(m.x), y: r3(m.y) };
      });
    },
  },
  'token.update': {
    roots: ['tokens'], label: 'Token', reveal: true,
    run(doc, op) {
      const ids = new Set(op.ids || [op.id]);
      const patch = {};
      for (const k of TOKEN_FIELDS) if (op.patch && k in op.patch) patch[k] = op.patch[k];
      if (patch.kind && !KINDS.has(patch.kind)) fail('Type de token inconnu');
      if ('size' in patch) patch.size = Math.max(1, Math.min(8, Math.round(Number(patch.size) || 1)));
      if ('scale' in patch) patch.scale = Number(patch.scale) > 0 ? Number(patch.scale) : 1;
      if ('rotation' in patch) patch.rotation = isNum(patch.rotation) ? ((patch.rotation % 360) + 360) % 360 : 0;
      if ('init' in patch && !isNum(patch.init)) patch.init = null;
      if ('notes' in patch) patch.notes = String(patch.notes || '').slice(0, 4000);
      if ('conditions' in patch) patch.conditions = cleanConditions(patch.conditions);
      if ('hp' in patch) patch.hp = cleanHp(patch.hp);
      if ('color' in patch) patch.color = COLORS.has(patch.color) ? patch.color : '';
      if ('ref' in patch && !(patch.ref && typeof patch.ref === 'object')) patch.ref = null;
      doc.tokens = doc.tokens.map(t => (ids.has(t.id) ? { ...t, ...patch } : t));
    },
  },
  'token.remove': {
    roots: ['tokens', 'fight', 'view'], label: 'Suppression de token',
    run(doc, op) {
      const ids = new Set(op.ids || []);
      doc.tokens = doc.tokens.filter(t => !ids.has(t.id));
      if (doc.fight) doc.fight = tracker.removeTokens(doc.fight, [...ids]);
      if (doc.view?.mode === 'token' && ids.has(doc.view.tokenId)) doc.view = { mode: 'party' };
    },
  },

  // ---------------------------------------------------- TV et brouillard
  'view.set': {
    roots: ['view'], undoable: false, reveal: true,
    run(doc, op) { doc.view = op.mode === 'token' && op.tokenId ? { mode: 'token', tokenId: op.tokenId } : { mode: 'party' }; },
  },
  'tv.camera': {
    roots: ['tvCamera'], undoable: false,
    run(doc, op) {
      const c = op.camera;
      if (c === null) { doc.tvCamera = null; return; }
      if (![c?.x, c?.y, c?.w, c?.h].every(isNum) || c.w <= 0 || c.h <= 0) fail('Cadrage invalide');
      doc.tvCamera = { x: r3(c.x), y: r3(c.y), w: r3(c.w), h: r3(c.h) };
    },
  },
  'frozen.set': {
    roots: ['frozen'], undoable: false, reveal: true,
    run(doc, op) { doc.frozen = !!op.value; },
  },
  'fog.reset': {
    roots: ['explored'], label: 'Brouillard remis à zéro', reveal: true,
    run(doc) { doc.explored = {}; },
  },

  // ---------------------------------------------------- Dessins et gabarits
  'drawing.add': {
    roots: ['drawings'], label: 'Dessin',
    run(doc, op, x) {
      const d = op.drawing || {};
      const points = (d.points || []).map(p => checkPoint(p));
      if (points.length < 2) fail('Dessin vide');
      const shape = ['pen', 'line', 'rect', 'ellipse'].includes(d.shape) ? d.shape : 'pen';
      doc.drawings = [...doc.drawings, { id: x.rid('s'), shape, points, color: String(d.color || '#e40712'), width: Number(d.width) > 0 ? Number(d.width) : 0.12 }];
    },
  },
  'drawing.remove': {
    roots: ['drawings'], label: 'Effacement',
    run(doc, op) { const ids = new Set(op.ids || []); doc.drawings = doc.drawings.filter(d => !ids.has(d.id)); },
  },
  'drawing.clear': {
    roots: ['drawings'], label: 'Dessins effacés',
    run(doc) { doc.drawings = []; },
  },
  'template.add': {
    roots: ['templates'], label: 'Gabarit',
    run(doc, op, x) {
      const t = op.template || {};
      if (!['cone', 'circle', 'line', 'square'].includes(t.shape)) fail('Gabarit inconnu');
      if (!isNum(t.x) || !isNum(t.y) || !isNum(t.feet) || t.feet <= 0) fail('Gabarit invalide');
      doc.templates = [...doc.templates, {
        id: x.rid('g'), shape: t.shape, x: r3(t.x), y: r3(t.y), feet: t.feet,
        angle: isNum(t.angle) ? t.angle : 0, width: isNum(t.width) ? t.width : 5, color: String(t.color || '#ff8a3d'),
      }];
    },
  },
  'template.remove': {
    roots: ['templates'], label: 'Gabarit retiré',
    run(doc, op) { const ids = new Set(op.ids || []); doc.templates = doc.templates.filter(t => !ids.has(t.id)); },
  },
  'template.clear': {
    roots: ['templates'], label: 'Gabarits retirés',
    run(doc) { doc.templates = []; },
  },

  // ---------------------------------------------------- Initiative
  'fight.new': {
    roots: ['fight'], label: 'Nouveau combat',
    run(doc) { doc.fight = tracker.addPcRows(tracker.newFight(), doc.tokens); },
  },
  'fight.end': {
    roots: ['fight'], label: 'Fin du combat',
    run(doc) { doc.fight = null; },
  },
  // Un combat lancé depuis la sélection : PJ sans nombre, créatures identiques groupées, round 1.
  'fight.create': {
    roots: ['fight'], label: 'Combat lancé',
    run(doc, op, x) {
      const f = tracker.addTokens(tracker.newFight(), pick(doc, op.tokenIds), x.rng);
      doc.fight = op.start === false ? f : tracker.start(f, doc.tokens);
    },
  },
  'fight.addTokens': {
    roots: ['fight'], label: 'Ajout au combat',
    run(doc, op, x) { doc.fight = tracker.addTokens(ensureFight(doc), pick(doc, op.tokenIds), x.rng); },
  },
  'fight.split': {
    roots: ['fight'], label: 'Groupe séparé',
    run(doc, op, x) { doc.fight = tracker.split(ensureFight(doc), op.rowId, doc.tokens, x.rng); },
  },
  'fight.addGroup': {
    roots: ['fight'], label: 'Groupe',
    run(doc, op, x) { doc.fight = tracker.addGroup(ensureFight(doc), { name: op.name, tokens: pick(doc, op.tokenIds) }, x.rng); },
  },
  'fight.addEach': {
    roots: ['fight'], label: 'Ajout au combat',
    run(doc, op, x) { doc.fight = tracker.addEach(ensureFight(doc), pick(doc, op.tokenIds), x.rng); },
  },
  'fight.addToRow': {
    roots: ['fight'], label: 'Ajout au groupe',
    run(doc, op, x) { doc.fight = tracker.addToRow(ensureFight(doc), op.rowId, pick(doc, op.tokenIds)); },
  },
  'fight.removeTokens': {
    roots: ['fight'], label: 'Retrait du combat',
    run(doc, op, x) { doc.fight = tracker.removeTokens(ensureFight(doc), op.tokenIds || []); },
  },
  'fight.row': {
    roots: ['fight'], label: 'Initiative',
    run(doc, op, x) { doc.fight = tracker.setRow(ensureFight(doc), op.rowId, op.patch || {}); },
  },
  'fight.reroll': {
    roots: ['fight'], label: 'Nouveau jet',
    run(doc, op, x) { doc.fight = tracker.reroll(ensureFight(doc), op.rowId, doc.tokens, x.rng); },
  },
  'fight.removeRow': {
    roots: ['fight'], label: 'Ligne retirée',
    run(doc, op, x) { doc.fight = tracker.removeRow(ensureFight(doc), op.rowId); },
  },
  'fight.moveRow': {
    roots: ['fight'], label: 'Ordre',
    run(doc, op, x) { doc.fight = tracker.moveRow(ensureFight(doc), op.rowId, op.dir); },
  },
  'fight.start': {
    roots: ['fight'], label: 'Début du combat',
    run(doc, op, x) { doc.fight = tracker.start(ensureFight(doc), doc.tokens); },
  },
  'fight.next': {
    roots: ['fight'], label: 'Tour suivant',
    run(doc, op, x) { doc.fight = tracker.next(ensureFight(doc), doc.tokens); },
  },
  'fight.prev': {
    roots: ['fight'], label: 'Tour précédent',
    run(doc, op, x) { doc.fight = tracker.previous(ensureFight(doc), doc.tokens); },
  },
};

function ensureFight(doc) {
  return doc.fight || tracker.addPcRows(tracker.newFight(), doc.tokens);
}

function pick(doc, ids) {
  const set = new Set(ids || []);
  return doc.tokens.filter(t => set.has(t.id));
}

function hashWalls(walls) {
  // Clé courte de ce qui bloque la vue : deux positions identiques avec les mêmes portes
  // voient la même chose, inutile de le stocker deux fois.
  let h = 2166136261;
  for (const w of walls) {
    if (w.kind === 'door' && w.open) continue;
    for (const p of w.points) {
      for (const v of p) {
        h ^= Math.round(v * 1000) | 0;
        h = Math.imul(h, 16777619);
      }
    }
    h ^= 0x5bd1;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const clone = v => (v === undefined ? undefined : structuredClone(v));

export class MapDoc {
  constructor(scene, state = {}, { rng = Math.random, maxUndo = 100 } = {}) {
    this.doc = { ...scene, ...newState(), ...state };
    this.rng = rng;
    this.maxUndo = maxUndo;
    this.undoStack = [];
    this.redoStack = [];
    this.rev = 0;
    this.rid = prefix => {
      const used = id => this.doc.walls.some(w => w.id === id) || this.doc.tokens.some(t => t.id === id);
      let id;
      do { id = `${prefix}${Math.floor(this.rng() * 36 ** 6).toString(36)}`; } while (used(id));
      return id;
    };
    // Rattrape les tokens pas encore pris en compte, par exemple un fichier écrit à la main.
    this.reveal();
  }

  exploredLengths() {
    const out = {};
    for (const [k, v] of Object.entries(this.doc.explored)) out[k] = v.length;
    return out;
  }

  // Ajoute à la mémoire de chaque token ce qu'il voit, sauf si cette position est déjà connue.
  reveal() {
    const { doc } = this;
    if (doc.frozen || doc.fog === false) return {};
    const key = hashWalls(doc.walls);
    const ix = indexFor(doc);
    const added = {};
    for (const t of doc.tokens) {
      if (!givesVision(t)) continue;
      const k = `${t.x},${t.y}|${key}`;
      const list = doc.explored[t.id] || [];
      if (list.some(e => e.k === k)) continue;
      const p = visibilityPolygon(ix, t.x, t.y);
      if (p.length < 6) continue;
      const entry = { k, p };
      doc.explored = { ...doc.explored, [t.id]: [...list, entry] };
      (added[t.id] || (added[t.id] = [])).push(entry);
    }
    return added;
  }

  // Applique une opération et renvoie ce que les clients doivent savoir.
  apply(op) {
    const def = OPS[op?.type];
    if (!def) fail(`Opération inconnue : ${op?.type}`);
    const undoable = def.undoable !== false;
    const before = {};
    for (const r of def.roots) before[r] = clone(this.doc[r]);
    const lens = this.exploredLengths();
    def.run(this.doc, op, { rid: this.rid, rng: this.rng });
    const add = def.reveal ? this.reveal() : {};
    if (undoable) {
      this.undoStack.push({ label: def.label || op.type, before, lens });
      if (this.undoStack.length > this.maxUndo) this.undoStack.shift();
      this.redoStack = [];
    }
    return this.emit(def.roots, add);
  }

  emit(roots, add = {}, trim = {}) {
    this.rev++;
    const set = {};
    for (const r of roots) set[r] = this.doc[r] === undefined ? null : this.doc[r];
    return { rev: this.rev, set, add, trim, roots, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, undoLabel: this.undoStack.at(-1)?.label || null, redoLabel: this.redoStack.at(-1)?.label || null };
  }

  undo() { return this.swap(this.undoStack, this.redoStack); }
  redo() { return this.swap(this.redoStack, this.undoStack); }

  swap(from, to) {
    const entry = from.pop();
    if (!entry) return null;
    const roots = Object.keys(entry.before);
    const after = {};
    for (const r of roots) { after[r] = clone(this.doc[r]); this.doc[r] = entry.before[r]; }
    const fullExplored = roots.includes('explored');
    const trim = {};
    const add = {};
    const removed = {};
    const lens = this.exploredLengths();
    if (!fullExplored) {
      // Annuler un déplacement oublie aussi ce qu'il avait révélé ; rétablir le lui rend.
      for (const [id, list] of Object.entries(this.doc.explored)) {
        const keep = entry.lens[id] ?? 0;
        if (list.length > keep) {
          removed[id] = list.slice(keep);
          trim[id] = keep;
        }
      }
      if (Object.keys(trim).length) {
        const next = { ...this.doc.explored };
        for (const [id, keep] of Object.entries(trim)) next[id] = next[id].slice(0, keep);
        this.doc.explored = next;
      }
      if (entry.readd) {
        const next = { ...this.doc.explored };
        for (const [id, list] of Object.entries(entry.readd)) {
          next[id] = [...(next[id] || []), ...list];
          add[id] = list;
        }
        this.doc.explored = next;
      }
    }
    to.push({ label: entry.label, before: after, lens, readd: removed });
    return this.emit(roots, add, trim);
  }

  sceneData() {
    const out = {};
    for (const r of SCENE_ROOTS) if (this.doc[r] !== undefined) out[r] = this.doc[r];
    out.format = this.doc.format;
    return out;
  }

  stateData() {
    const out = {};
    for (const r of STATE_ROOTS) out[r] = this.doc[r];
    return out;
  }

  // Le fichier de la scène a changé sur le disque : l'annulation ne peut plus restaurer ses murs.
  replaceScene(scene) {
    for (const r of SCENE_ROOTS) {
      if (scene[r] !== undefined) this.doc[r] = scene[r];
      else delete this.doc[r];
    }
    this.undoStack = this.undoStack.filter(e => !SCENE_ROOTS.some(r => r in e.before));
    this.redoStack = this.redoStack.filter(e => !SCENE_ROOTS.some(r => r in e.before));
    return this.emit(SCENE_ROOTS.filter(r => scene[r] !== undefined));
  }
}

export function applyUpdate(doc, u) {
  Object.assign(doc, u.set);
  for (const [id, keep] of Object.entries(u.trim || {})) {
    doc.explored = { ...doc.explored, [id]: (doc.explored[id] || []).slice(0, keep) };
  }
  for (const [id, list] of Object.entries(u.add || {})) {
    doc.explored = { ...doc.explored, [id]: [...(doc.explored[id] || []), ...list] };
  }
  return doc;
}

// Nom lisible d'une opération, pour le journal des actions.
export function opLabel(type) {
  return OPS[type]?.label || type;
}
