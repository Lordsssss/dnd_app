// Atlas : les cartes d'une campagne autres que le monde — une ville, une région, un quartier.
// Une image en fond, et des lieux posés dessus : un point, ou une zone (un quartier, une forêt).
// Pour chaque lieu, ce que le groupe en sait, plus des infos que le MJ révèle une à une, comme
// les interactions d'une carte de mission. Le MJ prépare tout caché, puis révèle une carte, un
// lieu, une info à la fois. Un joueur ne reçoit jamais ce qui est caché, ni les notes du MJ.
import crypto from 'node:crypto';
import { HttpError } from './http.js';

const MAX = { name: 100, kind: 40, num: 6, pub: 8_000, mj: 20_000, fact: 2_000, label: 60 };
const MAX_PLACES = 400;
const MAX_FACTS = 40;
const MAX_SHAPE = 400;
const KEY_RE = /^a\d+$/;

const clean = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').slice(0, max).trim();
const finite = n => Number.isFinite(n);
const round2 = n => Math.round(n * 100) / 100;

// Un polygone : une liste de points [x, y], au moins trois.
function cleanShape(s) {
  if (!Array.isArray(s)) return null;
  const pts = s.slice(0, MAX_SHAPE).map(p => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : null)).filter(p => p && finite(p[0]) && finite(p[1])).map(p => [round2(p[0]), round2(p[1])]);
  return pts.length >= 3 ? pts : null;
}

// Les zones disjointes (deux morceaux d'un même quartier) : une liste de polygones.
function cleanShapes(s) {
  if (!Array.isArray(s) || !s.length) return null;
  const many = Array.isArray(s[0]) && Array.isArray(s[0][0]);
  const list = (many ? s : [s]).slice(0, 12).map(cleanShape).filter(Boolean);
  return list.length ? list : null;
}

// Le point où écrire le nom d'une zone : le centre de gravité de son plus grand morceau.
function centroid(shapes) {
  let best = null;
  for (const pts of shapes) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      const k = x0 * y1 - x1 * y0;
      a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
    }
    if (Math.abs(a) < 1e-9) continue;
    const c = { x: round2(cx / (3 * a)), y: round2(cy / (3 * a)), area: Math.abs(a / 2) };
    if (!best || c.area > best.area) best = c;
  }
  return best || { x: shapes[0][0][0], y: shapes[0][0][1] };
}

function cleanFacts(list, prev = []) {
  if (!Array.isArray(list)) return prev;
  return list.slice(0, MAX_FACTS).map(f => {
    const text = clean(f?.text, MAX.fact);
    if (!text) return null;
    const id = /^[\w-]{1,24}$/.test(String(f?.id || '')) ? String(f.id) : crypto.randomBytes(4).toString('hex');
    return { id, text, known: !!f?.known };
  }).filter(Boolean);
}

export class Atlas {
  constructor(db, { validNote = () => null, assetOk = () => null } = {}) {
    this.db = db;
    // validNote(cid, rel) : le chemin d'une note du coffre de la campagne, ou null.
    this.validNote = validNote;
    // assetOk(cid, ref) : { width, height } d'une image de cette campagne, ou null.
    this.assetOk = assetOk;
  }

  list(cid) {
    return this.db.atlasOf(cid).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name), 'fr'));
  }

  // La liste du panneau latéral. Un joueur ne voit que les cartes montrées.
  summaries(cid, dm) {
    return this.list(cid).filter(m => dm || m.known).map(m => ({
      id: m.id, name: m.name, v: m.updatedAt, ...(dm ? { known: !!m.known, places: (m.places || []).length } : {}),
    }));
  }

  must(cid, id) {
    const m = this.db.getAtlas(cid, String(id || ''));
    if (!m) throw new HttpError(404, 'Carte introuvable');
    return m;
  }

  save(cid, m) {
    const { id, updatedAt, ...data } = m;
    return this.db.putAtlas(cid, id, data);
  }

  create(cid, { name, image, known = false }) {
    const img = this.assetOk(cid, String(image || ''));
    if (!img) throw new HttpError(400, 'Image introuvable');
    const id = `m${crypto.randomBytes(5).toString('hex')}`;
    const order = this.list(cid).reduce((n, m) => Math.max(n, (m.order ?? 0) + 1), 0);
    const m = {
      id, name: clean(name, MAX.name) || 'Nouvelle carte', image: String(image), width: img.width || 2000, height: img.height || 1500,
      known: !!known, order, places: [], party: null, nextId: 1,
    };
    this.save(cid, m);
    return { id };
  }

  update(cid, id, patch) {
    const m = this.must(cid, id);
    if (typeof patch.name === 'string') m.name = clean(patch.name, MAX.name) || m.name;
    if ('known' in patch) m.known = !!patch.known;
    if (finite(patch.order)) m.order = patch.order;
    if (patch.image) {
      const img = this.assetOk(cid, String(patch.image));
      if (!img) throw new HttpError(400, 'Image introuvable');
      // Une nouvelle image aux mêmes proportions : les lieux suivent l'échelle.
      const w = img.width || m.width, h = img.height || m.height;
      const kx = w / m.width, ky = h / m.height;
      if (patch.rescale !== false && (kx !== 1 || ky !== 1)) {
        for (const p of m.places || []) {
          p.x = round2(p.x * kx); p.y = round2(p.y * ky);
          if (p.shape) p.shape = p.shape.map(poly => poly.map(([x, y]) => [round2(x * kx), round2(y * ky)]));
        }
        if (m.party) { m.party.x = round2(m.party.x * kx); m.party.y = round2(m.party.y * ky); }
      }
      Object.assign(m, { image: String(patch.image), width: w, height: h });
    }
    this.save(cid, m);
    return { ok: true };
  }

  remove(cid, id) {
    this.must(cid, id);
    this.db.deleteAtlas(cid, id);
    return { ok: true };
  }

  // Ce que voit un rôle. La forme suit celle du monde en mode image, pour que la page de la
  // carte serve aux deux : les lieux sont dans « added », chacun avec sa clé « a<id> ».
  view(cid, id, role) {
    const m = this.must(cid, id);
    const dm = role === 'dm';
    if (!dm && !m.known) throw new HttpError(404, 'Carte introuvable');
    const added = (m.places || []).filter(p => dm || p.known).map(p => {
      const out = { ...p, key: `a${p.id}`, i: p.id, facts: p.facts || [] };
      if (!dm) {
        delete out.mj; delete out.note;
        out.facts = out.facts.filter(f => f.known).map(f => ({ id: f.id, text: f.text }));
      }
      return out;
    });
    const party = m.party && (dm || m.party.known) ? m.party : null;
    return {
      role: dm ? 'dm' : 'player', mode: 'image', atlas: m.id, name: m.name, image: m.image, width: m.width, height: m.height,
      known: dm ? !!m.known : true, v: m.updatedAt,
      burgs: [], provinces: [], markers: [], lakes: [], states: [], cultures: [], religions: [], added, party,
    };
  }

  place(m, key) {
    if (!KEY_RE.test(String(key))) throw new HttpError(400, 'Lieu introuvable');
    const p = (m.places || []).find(x => `a${x.id}` === key);
    if (!p) throw new HttpError(404, 'Lieu introuvable');
    return p;
  }

  applyPatch(cid, p, patch) {
    for (const k of ['name', 'kind', 'num', 'pub', 'mj']) {
      if (typeof patch[k] !== 'string') continue;
      const v = clean(patch[k], MAX[k]);
      if (k === 'name') { if (v) p.name = v; } else if (v) p[k] = v; else delete p[k];
    }
    if ('note' in patch) {
      const rel = String(patch.note || '').trim();
      if (!rel) delete p.note;
      else {
        const ok = this.validNote(cid, rel);
        if (!ok) throw new HttpError(400, 'Note introuvable dans le coffre');
        p.note = ok;
      }
    }
    if ('image' in patch) {
      if (!patch.image) delete p.image;
      else if (this.assetOk(cid, String(patch.image))) p.image = String(patch.image);
      else throw new HttpError(400, 'Image introuvable');
    }
    if ('known' in patch) p.known = !!patch.known;
    if ('label' in patch) p.label = patch.label !== false;
    if ('facts' in patch) p.facts = cleanFacts(patch.facts, p.facts || []);
    if ('shape' in patch) {
      const s = patch.shape ? cleanShapes(patch.shape) : null;
      if (s) { p.shape = s; const c = centroid(s); if (!finite(patch.x)) { p.x = c.x; p.y = c.y; } } else delete p.shape;
    }
    if (finite(patch.x) && finite(patch.y)) { p.x = round2(patch.x); p.y = round2(patch.y); }
  }

  patchPlace(cid, id, key, patch) {
    const m = this.must(cid, id);
    this.applyPatch(cid, this.place(m, key), patch || {});
    this.save(cid, m);
    return { ok: true };
  }

  // Un ou plusieurs lieux. Un lieu a une position (x, y) ou une zone (shape), ou les deux :
  // la zone se clique, le point dit où écrire son nom.
  addPlaces(cid, id, list) {
    const m = this.must(cid, id);
    m.places = m.places || [];
    if (m.places.length + list.length > MAX_PLACES) throw new HttpError(400, 'Trop de lieux sur cette carte');
    const out = [];
    for (const raw of list) {
      const shape = raw?.shape ? cleanShapes(raw.shape) : null;
      if (!shape && !(finite(raw?.x) && finite(raw?.y))) throw new HttpError(400, 'Position invalide');
      const p = { id: m.nextId++, name: 'Nouveau lieu', known: false, facts: [] };
      const c = shape ? centroid(shape) : null;
      this.applyPatch(cid, p, { ...raw, shape: shape || undefined, x: finite(raw.x) ? raw.x : c.x, y: finite(raw.y) ? raw.y : c.y });
      if (!finite(p.x)) { p.x = c.x; p.y = c.y; }
      m.places.push(p);
      out.push({ id: p.id, key: `a${p.id}` });
    }
    this.save(cid, m);
    return out;
  }

  removePlace(cid, id, key) {
    const m = this.must(cid, id);
    this.place(m, key);
    m.places = m.places.filter(x => `a${x.id}` !== key);
    this.save(cid, m);
    return { ok: true };
  }

  setParty(cid, id, p) {
    const m = this.must(cid, id);
    if (p === null) m.party = null;
    else {
      if (!finite(p.x) || !finite(p.y)) throw new HttpError(400, 'Position invalide');
      m.party = { x: round2(p.x), y: round2(p.y), known: p.known !== false, label: clean(p.label || 'Le groupe', MAX.label) || 'Le groupe' };
    }
    this.save(cid, m);
    return { ok: true };
  }
}
