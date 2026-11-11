// Catalogue des images de tokens : la bibliothèque globale (un dossier, Forgotten Adventures par
// exemple) et les tokens envoyés dans une campagne. Le nom de fichier porte l'information :
//   Gorgon_A1_Large_Scale125_Monstrosity_01.png → « Gorgon », taille Large.
// Les références rendues sont `lib:<chemin>` ou `asset:<id>`.
import fs from 'node:fs';
import path from 'node:path';

const SIZES = { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
const VARIANT = /_(?:[A-Z]\d+)(?:_|$)/;

export function fold(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const words = s => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

export function parseTokenName(file) {
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  // « Owlbear_Large » : le mot de taille n'appartient pas au nom.
  const name = base.split(VARIANT)[0].split(/[_\s]+/).filter(w => !(w.toLowerCase() in SIZES)).join(' ').trim() || base.replace(/_/g, ' ');
  const parts = base.split('_').map(p => p.toLowerCase());
  const sizeWord = parts.find(p => p in SIZES);
  return { name, size: sizeWord ? SIZES[sizeWord] : 1 };
}

function item(ref, fileName, folder) {
  const { name, size } = parseTokenName(fileName);
  return { path: ref, name, size, folder, w: new Set(words(name)), all: new Set(words(`${name} ${folder} ${fileName}`)) };
}

// Les tokens envoyés dans une campagne, au même format que ceux de la bibliothèque.
export function assetItems(assets, folder = 'Campagne') {
  return assets.map(a => item(`asset:${a.id}`, a.name, a.folder ? `${folder} / ${a.folder}` : folder));
}

// Le dossier est lu une fois, puis à la demande : quelques milliers de fichiers, c'est instantané.
export class TokenCatalog {
  constructor(libraryDir) {
    this.dir = libraryDir || null;
    this.items = null;
  }

  load() {
    const out = [];
    const walk = dir => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.(png|webp|jpe?g)$/i.test(e.name)) {
          const rel = path.relative(this.dir, full).split(path.sep).join('/');
          const folder = path.relative(this.dir, dir).split(path.sep).join(' / ');
          out.push(item(`lib:${rel}`, e.name, folder));
        }
      }
    };
    if (this.dir) walk(this.dir);
    out.sort((a, b) => a.path.localeCompare(b.path));
    this.items = out;
    return this;
  }

  get list() { return this.items || this.load().items; }

  // Texte libre : tous les mots doivent se trouver dans le nom, le dossier ou le fichier.
  search(q, limit = 60, extra = []) {
    const all = [...extra, ...this.list];
    const want = words(q);
    if (!want.length) return all.slice(0, limit).map(pub);
    return all
      .filter(t => want.every(w => [...t.all].some(a => a.includes(w))))
      .sort((a, b) => score(b, want) - score(a, want) || a.path.localeCompare(b.path))
      .slice(0, limit)
      .map(pub);
  }

  // Propositions pour une créature : le nom exact d'abord, puis les noms qui contiennent ses mots,
  // puis ceux qui en partagent une partie. Awakened Tree n'a pas de token, mais Tree en a peut-être.
  suggest(monsterName, limit = 24, extra = []) {
    const want = words(monsterName);
    if (!want.length) return [];
    const joined = want.join(' ');
    const scored = [];
    for (const t of [...extra, ...this.list]) {
      const name = words(t.name).join(' ');
      let s = 0;
      if (name === joined) s = 100;
      else if (want.every(w => t.w.has(w))) s = 70 - t.w.size;
      else if ([...t.w].length && [...t.w].every(w => want.includes(w))) s = 50;
      else {
        const shared = want.filter(w => w.length > 2 && t.w.has(w)).length;
        if (shared) s = 20 + shared * 5 - t.w.size;
      }
      if (s > 0) scored.push({ t, s });
    }
    return scored.sort((a, b) => b.s - a.s || a.t.path.localeCompare(b.t.path)).slice(0, limit).map(x => ({ ...pub(x.t), score: x.s }));
  }
}

function score(t, want) {
  let s = 0;
  for (const w of want) {
    if (t.w.has(w)) s += 3;
    else if ([...t.w].some(a => a.startsWith(w))) s += 2;
    else s += 1;
  }
  return s - t.w.size * 0.01;
}

function pub(t) {
  return { path: t.path, name: t.name, size: t.size, folder: t.folder };
}
