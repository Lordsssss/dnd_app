// Lecture seule des blocs de stats écrits dans les notes du coffre. Un ennemi homebrew pointe
// vers sa note : la carte d'infos du MJ affiche ce qui y est écrit, à jour à chaque survol.
// Forme reconnue, dans Donjon 4 et Donjon 5 :
//   > [!danger] 💀 La Lie — homebrew · Aberration de taille G · rencontre **Difficile**
//   > **Initiative +2 · score 12** · **CA 15** · **PV 95** · …
import fs from 'node:fs';
import path from 'node:path';

const CALLOUT = /^>\s*\[!danger\][-+]?\s*(.*)$/;
const LINK = /\[([^\]]+)\]\((https?:[^)\s]+)\)/;
const LINK_ALL = /\[([^\]]+)\]\((https?:[^)\s]+)\)/g;
const WIKI = /\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g;
const LEAD_SYMBOLS = /^[^\p{L}\p{N}[]+/u;

function plain(s) {
  return s.replace(LINK_ALL, '$1').replace(WIKI, '$1').replace(/\*\*|__|\*|`/g, '').trim();
}

// Nom de la créature : ce qui précède le premier « — », sans lien ni symbole.
export function nameFromTitle(title) {
  const first = title.split(/\s+[—–-]\s+/)[0];
  return plain(first).replace(LEAD_SYMBOLS, '').trim();
}

// « Aberration de taille G » : l'emprise en cases, si la note la donne.
const SIZE_WORDS = { tp: 1, p: 1, m: 1, g: 2, tg: 3, gig: 4 };
function sizeFrom(text) {
  const m = /\btaille\s+(TP|P|M|G|TG|Gig)\b/i.exec(plain(text));
  return m ? SIZE_WORDS[m[1].toLowerCase()] : null;
}

export function parseStatBlocks(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = CALLOUT.exec(lines[i]);
    if (!m) continue;
    const body = [];
    let j = i + 1;
    while (j < lines.length && /^>/.test(lines[j])) {
      body.push(lines[j].replace(/^>\s?/, ''));
      j++;
    }
    const joined = body.join('\n');
    // Un bloc de stats commence par sa CA et ses PV ; les autres encadrés rouges sont des consignes,
    // même quand ils citent une CA plus bas.
    const top = body.slice(0, 3).join(' ');
    if (!/\bCA\b[\s*:]*\d/.test(top) || !/\bPV\b/.test(top)) continue;
    const title = m[1].trim();
    const link = LINK.exec(title);
    const count = /×\s*(\d+)/.exec(title);
    const init = /Initiative[\s*:]*([+\-−–]?\s*\d+)/i.exec(joined);
    out.push({
      title: plain(title),
      name: nameFromTitle(title),
      link: link && /5e\.tools\/bestiary/.test(link[2]) ? link[2] : null,
      count: count ? Number(count[1]) : 1,
      init: init ? Number(init[1].replace(/[−–]/g, '-').replace(/\s/g, '')) : null,
      size: sizeFrom(`${title} ${top}`),
      body,
      line: i + 1,
    });
    i = j - 1;
  }
  return out;
}

// Une section sous un titre, pour un bloc écrit autrement qu'en encadré.
export function sectionUnder(text, heading) {
  const lines = text.split(/\r?\n/);
  const want = plain(heading).toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (!m || plain(m[2]).toLowerCase() !== want) continue;
    const level = m[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const n = /^(#{1,6})\s/.exec(lines[j]);
      if (n && n[1].length <= level) break;
      body.push(lines[j]);
    }
    return { title: plain(m[2]), name: plain(m[2]), link: null, count: 1, init: null, size: null, body };
  }
  return null;
}

export class VaultNotes {
  constructor(vaultDir, dirs) {
    this.vaultDir = vaultDir;
    this.dirs = dirs;
    this.cache = new Map();
  }

  files() {
    const out = [];
    const walk = dir => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.md$/i.test(e.name)) out.push(path.relative(this.vaultDir, full).split(path.sep).join('/'));
      }
    };
    for (const d of this.dirs) walk(path.join(this.vaultDir, d));
    return out.sort((a, b) => a.localeCompare(b, 'fr'));
  }

  resolve(rel) {
    const full = path.resolve(this.vaultDir, String(rel || ''));
    const roots = this.dirs.map(d => path.join(this.vaultDir, d) + path.sep);
    if (!roots.some(r => full.startsWith(r)) || !/\.md$/i.test(full)) return null;
    return full;
  }

  read(rel) {
    const full = this.resolve(rel);
    if (!full) return null;
    let st;
    try { st = fs.statSync(full); } catch { return null; }
    const known = this.cache.get(full);
    if (known && known.mtime === st.mtimeMs) return known;
    const text = fs.readFileSync(full, 'utf8');
    const entry = { mtime: st.mtimeMs, text, blocks: parseStatBlocks(text) };
    this.cache.set(full, entry);
    return entry;
  }

  // Tous les blocs, regroupés par note : sans les textes, c'est une liste à parcourir.
  list() {
    const out = [];
    for (const file of this.files()) {
      const blocks = this.read(file)?.blocks || [];
      for (const { title, name, link, count, init, size } of blocks) {
        out.push({ file, note: path.basename(file, '.md'), title, name, link, count, init, size });
      }
    }
    return out;
  }

  block(file, title) {
    const entry = this.read(file);
    if (!entry) return null;
    const want = plain(String(title || '')).toLowerCase();
    return entry.blocks.find(b => b.title.toLowerCase() === want)
      || entry.blocks.find(b => b.name.toLowerCase() === want)
      || (want ? sectionUnder(entry.text, want) : null);
  }
}
