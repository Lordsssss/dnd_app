// Format d'une scène de carte : un fichier texte que le MJ, l'éditeur de l'app et Claude
// peuvent tous écrire. Toutes les coordonnées sont en cases de la grille, jamais en pixels.
//
//   {
//     "format": 1,
//     "name": "Les Fontaineries",
//     "folder": "Sessions 5-6",
//     "image": "images/Dungeon_ The Fountainworks (1).jpg",
//     "grid": { "cols": 75, "rows": 75, "feetPerCell": 5 },
//     "walls": [
//       { "id": "w1", "kind": "wall", "points": [[12, 3], [20, 3], [20, 8]] },
//       { "id": "d1", "kind": "door", "open": false, "group": "levier-bleu", "points": [[31, 7], [33, 7]] }
//     ]
//   }
//
// Seuls les murs et les portes fermées bloquent la vue. Un mur peut être une ligne brisée ;
// une porte de même. Les portes d'un même `group` s'ouvrent et se ferment ensemble.
// `"fog": false` : un lieu sans brouillard, tout est visible sur la TV. `folder` range la carte
// dans un dossier, `order` la place dans ce dossier.

export const FORMAT = 1;
export const WELD = 0.02; // Deux sommets plus proches que ça, en cases, sont le même point.

export class SceneError extends Error {}

const r3 = v => Math.round(v * 1000) / 1000;
const finite = v => typeof v === 'number' && Number.isFinite(v);

function normalizeWall(w, where) {
  if (!w || typeof w !== 'object') throw new SceneError(`${where} : entrée illisible`);
  const kind = w.kind === undefined ? 'wall' : w.kind;
  if (kind !== 'wall' && kind !== 'door') throw new SceneError(`${where} : kind doit être "wall" ou "door", pas ${JSON.stringify(kind)}`);
  if (!Array.isArray(w.points) || w.points.length < 2) throw new SceneError(`${where} : points doit contenir au moins deux points`);
  const points = w.points.map((p, i) => {
    if (!Array.isArray(p) || !finite(p[0]) || !finite(p[1])) throw new SceneError(`${where}, point ${i} : [x, y] attendu`);
    return [r3(p[0]), r3(p[1])];
  });
  const out = { id: w.id ? String(w.id) : '', kind, points };
  if (kind === 'door') {
    out.open = !!w.open;
    if (w.group) out.group = String(w.group);
  }
  return out;
}

// Valide et complète un objet scène. Lève SceneError avec un message qui dit où est le problème.
export function normalizeScene(raw, fallbackName = 'Sans nom') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SceneError('La scène doit être un objet JSON');
  const g = raw.grid || {};
  const cols = Number(g.cols);
  const rows = Number(g.rows);
  if (!(cols > 0) || !(rows > 0)) throw new SceneError('grid.cols et grid.rows sont obligatoires et positifs');
  const offset = Array.isArray(g.offset) && finite(g.offset[0]) && finite(g.offset[1]) ? [g.offset[0], g.offset[1]] : [0, 0];
  if (raw.walls !== undefined && !Array.isArray(raw.walls)) throw new SceneError('walls doit être une liste');
  const walls = (raw.walls || []).map((w, i) => normalizeWall(w, `walls[${i}]`));
  assignIds(walls);
  const scene = {
    format: FORMAT,
    name: String(raw.name || fallbackName),
    image: String(raw.image || ''),
    folder: String(raw.folder || 'Sans dossier'),
    fog: raw.fog !== false,
    grid: { cols, rows, feetPerCell: Number(g.feetPerCell) > 0 ? Number(g.feetPerCell) : 5, offset, show: !!g.show },
    walls: weldWalls(walls),
  };
  if (Array.isArray(raw.imageSize) && finite(raw.imageSize[0]) && finite(raw.imageSize[1])) scene.imageSize = [raw.imageSize[0], raw.imageSize[1]];
  if (finite(raw.order)) scene.order = raw.order;
  return scene;
}

function assignIds(walls) {
  const used = new Set();
  for (const w of walls) {
    if (w.id && !used.has(w.id)) used.add(w.id);
    else w.id = '';
  }
  let n = 1;
  for (const w of walls) {
    if (w.id) continue;
    const prefix = w.kind === 'door' ? 'd' : 'w';
    while (used.has(`${prefix}${n}`)) n++;
    w.id = `${prefix}${n}`;
    used.add(w.id);
  }
}

// Une entrée par ligne dans `walls` : le fichier reste lisible, et ses diffs aussi.
export function serializeScene(s) {
  const head = { format: s.format ?? FORMAT, name: s.name, folder: s.folder || 'Sans dossier' };
  if (finite(s.order)) head.order = s.order;
  if (s.fog === false) head.fog = false;
  head.image = s.image;
  if (s.imageSize) head.imageSize = s.imageSize;
  const grid = { cols: s.grid.cols, rows: s.grid.rows, feetPerCell: s.grid.feetPerCell };
  if (s.grid.offset && (s.grid.offset[0] || s.grid.offset[1])) grid.offset = s.grid.offset;
  if (s.grid.show) grid.show = true;
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  lines.push(`  "grid": ${JSON.stringify(grid)},`);
  lines.push(s.walls.length ? '  "walls": [' : '  "walls": []');
  if (s.walls.length) {
    s.walls.forEach((w, i) => lines.push(`    ${JSON.stringify(w)}${i < s.walls.length - 1 ? ',' : ''}`));
    lines.push('  ]');
  }
  return `{\n${lines.join('\n')}\n}\n`;
}

// Le rectangle couvert par l'image, en cases.
export function sceneBounds(s) {
  const [ox, oy] = s.grid.offset || [0, 0];
  return { minX: -ox, minY: -oy, maxX: s.grid.cols - ox, maxY: s.grid.rows - oy };
}

// Les segments qui bloquent la vue : les murs, et les portes fermées.
export function blockingSegments(walls) {
  const out = [];
  for (const w of walls) {
    if (w.kind === 'door' && w.open) continue;
    for (let i = 0; i + 1 < w.points.length; i++) {
      const a = w.points[i];
      const b = w.points[i + 1];
      if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return out;
}

function closestOnSegment(px, py, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2)) : 0;
  const x = a[0] + t * dx;
  const y = a[1] + t * dy;
  return { x, y, t, d: Math.hypot(px - x, py - y) };
}

// Soude les sommets voisins, et pose l'extrémité d'un mur sur le mur qu'elle touche presque,
// avec un sommet commun. Sans ça, un jour de quelques millièmes de case laisserait passer
// un rayon de vue jusque dans la pièce d'à côté.
export function weldWalls(walls, tol = WELD) {
  const buckets = new Map();
  const size = tol * 2;
  const canon = (x, y) => {
    const cx = Math.floor(x / size);
    const cy = Math.floor(y / size);
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cy - 1; j <= cy + 1; j++) {
        for (const p of buckets.get(`${i},${j}`) || []) if (Math.hypot(p[0] - x, p[1] - y) <= tol) return p;
      }
    }
    const p = [x, y];
    const k = `${cx},${cy}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p);
    return p;
  };
  const out = [];
  for (const w of walls) {
    const pts = [];
    for (const p of w.points) {
      const c = canon(p[0], p[1]);
      const last = pts[pts.length - 1];
      if (!last || last[0] !== c[0] || last[1] !== c[1]) pts.push([c[0], c[1]]);
    }
    if (pts.length >= 2) out.push({ ...w, points: pts });
  }
  // Extrémité posée sur un segment : on ajoute le sommet dans ce segment.
  for (const w of out) {
    for (const end of [w.points[0], w.points[w.points.length - 1]]) {
      for (const o of out) {
        for (let i = 0; i + 1 < o.points.length; i++) {
          const a = o.points[i];
          const b = o.points[i + 1];
          if ((a[0] === end[0] && a[1] === end[1]) || (b[0] === end[0] && b[1] === end[1])) continue;
          const hit = closestOnSegment(end[0], end[1], a, b);
          if (hit.d <= tol && hit.t > 0 && hit.t < 1) {
            o.points.splice(i + 1, 0, [end[0], end[1]]);
            i++;
          }
        }
      }
    }
  }
  return out;
}

const keyOf = p => `${p[0]},${p[1]}`;

// Ce qui mérite un coup d'œil : les extrémités libres, souvent un mur pas fermé par où la vue
// passe, et les points hors de l'image.
export function wallIssues(scene) {
  const count = new Map();
  for (const w of scene.walls) {
    for (const p of w.points) count.set(keyOf(p), (count.get(keyOf(p)) || 0) + 1);
  }
  const { minX, minY, maxX, maxY } = sceneBounds(scene);
  // Le bord de l'image arrête la vue : un mur qui s'y termine n'a rien de libre.
  const onEdge = p => Math.abs(p[0] - minX) < WELD || Math.abs(p[0] - maxX) < WELD || Math.abs(p[1] - minY) < WELD || Math.abs(p[1] - maxY) < WELD;
  const dangling = [];
  for (const w of scene.walls) {
    const a = w.points[0];
    const b = w.points[w.points.length - 1];
    if (keyOf(a) === keyOf(b)) continue;
    for (const p of [a, b]) if (count.get(keyOf(p)) === 1 && !onEdge(p)) dangling.push({ wall: w.id, x: p[0], y: p[1] });
  }
  const outside = [];
  for (const w of scene.walls) {
    for (const p of w.points) {
      if (p[0] < minX - 0.5 || p[1] < minY - 0.5 || p[0] > maxX + 0.5 || p[1] > maxY + 0.5) outside.push({ wall: w.id, x: p[0], y: p[1] });
    }
  }
  return { dangling, outside };
}

// Le mur, le segment et le sommet les plus proches d'un point.
export function nearestWall(walls, x, y, maxDist = Infinity) {
  let best = null;
  for (const w of walls) {
    for (let i = 0; i + 1 < w.points.length; i++) {
      const hit = closestOnSegment(x, y, w.points[i], w.points[i + 1]);
      if (hit.d <= maxDist && (!best || hit.d < best.d)) best = { wall: w.id, seg: i, x: hit.x, y: hit.y, d: hit.d };
    }
  }
  return best;
}

export function nearestVertex(walls, x, y, maxDist = Infinity) {
  let best = null;
  for (const w of walls) {
    for (const p of w.points) {
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d <= maxDist && (!best || d < best.d)) best = { x: p[0], y: p[1], d };
    }
  }
  return best;
}

// Retire des segments ; la ligne brisée est coupée en deux si le segment est au milieu.
export function eraseSegments(walls, items) {
  const byWall = new Map();
  for (const it of items) {
    if (!byWall.has(it.wall)) byWall.set(it.wall, new Set());
    byWall.get(it.wall).add(it.seg);
  }
  const out = [];
  const used = new Set(walls.map(w => w.id));
  for (const w of walls) {
    const cut = byWall.get(w.id);
    if (!cut) { out.push(w); continue; }
    let run = [w.points[0]];
    const runs = [];
    for (let i = 0; i + 1 < w.points.length; i++) {
      if (cut.has(i)) {
        if (run.length >= 2) runs.push(run);
        run = [w.points[i + 1]];
      } else run.push(w.points[i + 1]);
    }
    if (run.length >= 2) runs.push(run);
    runs.forEach((points, i) => {
      let id = w.id;
      if (i > 0) {
        let n = 2;
        while (used.has(`${w.id}.${n}`)) n++;
        id = `${w.id}.${n}`;
        used.add(id);
      }
      out.push({ ...w, id, points });
    });
  }
  return out;
}

// Une porte posée sur un mur existant ouvre ce mur : la partie recouverte est retirée.
export function cutWallsUnder(walls, a, b, tol = 0.05) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (!len) return walls;
  const ux = dx / len;
  const uy = dy / len;
  const along = p => (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
  const off = p => Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux);
  const at = t => [r3(a[0] + ux * t), r3(a[1] + uy * t)];
  const out = [];
  const used = new Set(walls.map(w => w.id));
  for (const w of walls) {
    if (w.kind !== 'wall') { out.push(w); continue; }
    const runs = [];
    let run = [w.points[0]];
    let changed = false;
    for (let i = 0; i + 1 < w.points.length; i++) {
      const p = w.points[i];
      const q = w.points[i + 1];
      const lo = Math.min(along(p), along(q));
      const hi = Math.max(along(p), along(q));
      if (off(p) > tol || off(q) > tol || hi <= tol || lo >= len - tol) { run.push(q); continue; }
      // Segment colinéaire qui chevauche la porte : on garde ce qui dépasse de chaque côté.
      changed = true;
      const forward = along(q) >= along(p);
      const first = forward ? 0 : len;
      const second = forward ? len : 0;
      const keepsStart = forward ? along(p) < -tol : along(p) > len + tol;
      const keepsEnd = forward ? along(q) > len + tol : along(q) < -tol;
      if (keepsStart) run.push(at(first));
      if (run.length >= 2) runs.push(run);
      run = keepsEnd ? [at(second), q] : [q];
    }
    if (!changed) { out.push(w); continue; }
    if (run.length >= 2) runs.push(run);
    runs.forEach((points, i) => {
      let id = w.id;
      if (i > 0) {
        let n = 2;
        while (used.has(`${w.id}.${n}`)) n++;
        id = `${w.id}.${n}`;
        used.add(id);
      }
      out.push({ ...w, id, points });
    });
  }
  return out;
}

// Général d'abord, puis les sessions dans l'ordre, puis le reste par nom.
export function folderRank(name) {
  if (/^g[ée]n[ée]ral$/i.test(name)) return -1;
  const m = /^sessions?\s+(\d+)/i.exec(name);
  return m ? Number(m[1]) : 1000;
}

export function sortFolders(names) {
  return [...names].sort((a, b) => folderRank(a) - folderRank(b) || a.localeCompare(b, 'fr'));
}

export function slugify(name) {
  return String(name || 'carte').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'carte';
}
