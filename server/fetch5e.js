// Téléchargement des données 5etools depuis le miroir GitHub public.
// Gratuit, sans clé d'API : ce sont les fichiers JSON du site, rien d'autre.
// On prend tout le dossier `data/` (sorts, objets, bestiaire, classes, règles, livres,
// aventures…), environ 125 Mo. Il est gardé dans le dépôt (.dnd-sheet/5etools/) :
// un autre PC n'a qu'à faire `git pull`.
import fs from 'node:fs';
import path from 'node:path';

export const MIRROR_REPO = '5etools-mirror-3/5etools-src';
export const MIRROR = `https://raw.githubusercontent.com/${MIRROR_REPO}/main/data`;
const TREE = `https://api.github.com/repos/${MIRROR_REPO}/git/trees/main?recursive=1`;
const COMMITS = `https://api.github.com/repos/${MIRROR_REPO}/commits/main`;

async function getText(url, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'dnd-sheet' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
      return await res.text();
    } catch (e) {
      last = e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw last;
}

async function getJson(url) {
  return JSON.parse(await getText(url));
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
async function remoteFiles() {
  const tree = await getJson(TREE);
  if (tree.truncated) throw new Error('Liste du miroir tronquée par GitHub');
  return tree.tree
    .filter(x => x.type === 'blob' && x.path.startsWith('data/') && x.path.endsWith('.json'))
    .map(x => ({ rel: x.path.slice(5), sha: x.sha, size: x.size }));
}

// Retourne { files, downloaded, removed, bytes, commit, at }. onProgress({ done, total, file }).
// Seuls les fichiers modifiés depuis le dernier téléchargement sont repris.
export async function fetch5eTools(dir, { onProgress = () => {} } = {}) {
  const files = await remoteFiles();
  const prev = readDownloadInfo(dir)?.sha || {};
  const todo = files.filter(f => prev[f.rel] !== f.sha || !fs.existsSync(path.join(dir, f.rel)));
  let done = 0, bytes = 0;
  const sha = { ...prev };
  await pool(todo, 8, async f => {
    const text = await getText(`${MIRROR}/${f.rel}`);
    JSON.parse(text); // refuse un fichier illisible avant de l'écrire
    writeAtomic(path.join(dir, f.rel), text);
    sha[f.rel] = f.sha;
    bytes += Buffer.byteLength(text);
    onProgress({ done: ++done, total: todo.length, file: f.rel });
  });
  // Fichiers retirés du miroir : on les retire aussi.
  const keep = new Set(files.map(f => f.rel));
  const removed = listLocal(dir).filter(rel => !keep.has(rel));
  for (const rel of removed) { fs.rmSync(path.join(dir, rel), { force: true }); delete sha[rel]; }
  for (const rel of Object.keys(sha)) if (!keep.has(rel)) delete sha[rel];
  let commit = null;
  try {
    const c = await getJson(COMMITS);
    commit = { sha: c.sha, date: c.commit?.committer?.date || null };
  } catch { /* info facultative : l'API GitHub limite les appels anonymes */ }
  const total = files.reduce((s, f) => s + f.size, 0);
  const meta = { at: new Date().toISOString(), mirror: MIRROR, commit, files: files.length, totalBytes: total, sha };
  writeAtomic(path.join(dir, '_download.json'), JSON.stringify(meta, null, 1));
  return { at: meta.at, commit, files: files.length, downloaded: todo.length, removed: removed.length, bytes, totalBytes: total };
}

export function readDownloadInfo(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, '_download.json'), 'utf8')); } catch { return null; }
}
