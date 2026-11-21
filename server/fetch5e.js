// Téléchargement des données 5etools depuis le miroir GitHub public.
// Gratuit, sans clé d'API : ce sont les fichiers JSON du site, rien d'autre.
// On prend tout le dossier `data/` (sorts, objets, bestiaire, classes, règles, livres,
// aventures…), environ 125 Mo, plus les livres « partenaires » (voir plus bas), environ 50 Mo.
import fs from 'node:fs';
import path from 'node:path';

export const MIRROR_REPO = '5etools-mirror-3/5etools-src';
export const MIRROR = `https://raw.githubusercontent.com/${MIRROR_REPO}/main/data`;
const TREE = `https://api.github.com/repos/${MIRROR_REPO}/git/trees/main?recursive=1`;
const COMMITS = `https://api.github.com/repos/${MIRROR_REPO}/commits/main`;

// Livres partenaires : des éditeurs tiers (Kobold Press, Ghostfire Gaming…) que 5e.tools affiche
// comme ses propres livres. Ils ne sont pas dans data/ : le site les tire du dépôt homebrew, dont
// l'index marque ces fichiers `p`. On les range dans partnered/, chemin du dépôt conservé.
export const BREW_REPO = 'TheGiddyLimit/homebrew';
export const BREW = `https://raw.githubusercontent.com/${BREW_REPO}/master`;
export const PARTNERED_DIR = 'partnered';

async function getText(url, { attempts = 4, wait = 1000 } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'dnd-sheet' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
      return await res.text();
    } catch (e) {
      last = e;
      await new Promise(r => setTimeout(r, wait * (i + 1)));
    }
  }
  throw last;
}

async function getJson(url, opts) {
  return JSON.parse(await getText(url, opts));
}

// Écrit à côté puis renomme : un téléchargement coupé ne laisse pas de JSON tronqué.
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

async function pool(items, size, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

function listLocal(dir, base = dir, out = []) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listLocal(p, base, out);
    else if (e.name.endsWith('.json') && !e.name.startsWith('_')) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

// Liste de tous les fichiers JSON de data/ sur le miroir, avec leur empreinte git.
async function remoteFiles(opts) {
  const tree = await getJson(TREE, opts);
  if (tree.truncated) throw new Error('Liste du miroir tronquée par GitHub');
  return tree.tree
    .filter(x => x.type === 'blob' && x.path.startsWith('data/') && x.path.endsWith('.json'))
    .map(x => ({ rel: x.path.slice(5), sha: x.sha, size: x.size, url: `${MIRROR}/${x.path.slice(5)}` }));
}

// Fichiers partenaires du dépôt homebrew. L'empreinte est la date de modification que donne
// l'index : pas d'appel à l'API GitHub, limitée pour un client anonyme.
async function partneredFiles(opts) {
  const [meta, stamps] = await Promise.all([
    getJson(`${BREW}/_generated/index-meta.json`, opts),
    getJson(`${BREW}/_generated/index-timestamps.json`, opts),
  ]);
  const byName = new Map(Object.keys(stamps || {}).map(p => [p.split('/').pop(), p]));
  const out = [];
  for (const [name, m] of Object.entries(meta || {})) {
    if (!m?.p) continue;
    const p = byName.get(name);
    // « dossier/fichier.json », rien d'autre : un index farfelu n'écrit pas hors du dossier.
    if (!p || !/^[\w-]+\/[^/\\]+\.json$/.test(p) || p.split('/')[1].startsWith('.')) continue;
    const t = stamps[p] || {};
    out.push({
      rel: `${PARTNERED_DIR}/${p}`, sha: `m${t.m ?? t.a ?? 0}`, size: null,
      url: `${BREW}/${p.split('/').map(encodeURIComponent).join('/')}`,
    });
  }
  return out;
}

const sizeOf = file => { try { return fs.statSync(file).size; } catch { return 0; } };

// Retourne { files, downloaded, unchanged, removed, partnered, bytes, commit, at }.
// onProgress({ done, total, file }). Seuls les fichiers modifiés depuis le dernier
// téléchargement sont repris. Si l'index des partenaires est injoignable, les fichiers
// partenaires déjà là restent tels quels. `wait` : délai entre deux essais, en ms.
export async function fetch5eTools(dir, { onProgress = () => {}, wait = 1000 } = {}) {
  const opts = { wait };
  const mirror = await remoteFiles(opts);
  let partnered = null, partneredError = null;
  try { partnered = await partneredFiles(opts); } catch (e) { partneredError = e.message; }
  const files = [...mirror, ...(partnered || [])];
  const prev = readDownloadInfo(dir)?.sha || {};
  const todo = files.filter(f => prev[f.rel] !== f.sha || !fs.existsSync(path.join(dir, f.rel)));
  let done = 0, bytes = 0;
  const sha = { ...prev };
  await pool(todo, 8, async f => {
    const text = await getText(f.url, opts);
    JSON.parse(text); // refuse un fichier illisible avant de l'écrire
    writeAtomic(path.join(dir, f.rel), text);
    sha[f.rel] = f.sha;
    bytes += Buffer.byteLength(text);
    onProgress({ done: ++done, total: todo.length, file: f.rel });
  });
  // Fichiers retirés du miroir ou des partenaires : on les retire aussi.
  const keep = new Set(files.map(f => f.rel));
  const kept = rel => keep.has(rel) || (!partnered && rel.startsWith(`${PARTNERED_DIR}/`));
  const removed = listLocal(dir).filter(rel => !kept(rel));
  for (const rel of removed) { fs.rmSync(path.join(dir, rel), { force: true }); delete sha[rel]; }
  for (const rel of Object.keys(sha)) if (!kept(rel)) delete sha[rel];
  let commit = null;
  try {
    const c = await getJson(COMMITS, opts);
    commit = { sha: c.sha, date: c.commit?.committer?.date || null };
  } catch { /* info facultative : l'API GitHub limite les appels anonymes */ }
  const total = files.reduce((s, f) => s + (f.size ?? sizeOf(path.join(dir, f.rel))), 0);
  const nPartnered = Object.keys(sha).filter(rel => rel.startsWith(`${PARTNERED_DIR}/`)).length;
  const meta = {
    at: new Date().toISOString(), mirror: MIRROR, commit, files: files.length, totalBytes: total,
    partnered: { repo: BREW, files: nPartnered, error: partneredError }, sha,
  };
  writeAtomic(path.join(dir, '_download.json'), JSON.stringify(meta, null, 1));
  return {
    at: meta.at, commit, files: files.length, downloaded: todo.length, unchanged: files.length - todo.length,
    removed: removed.length, partnered: nPartnered, partneredError, bytes, totalBytes: total,
  };
}

export function readDownloadInfo(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, '_download.json'), 'utf8')); } catch { return null; }
}
