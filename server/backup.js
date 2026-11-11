// Sauvegarde quotidienne de la base SQLite.
import fs from 'node:fs';
import path from 'node:path';

function day(ts = Date.now()) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function dailyBackup(db, backupRoot, { keep = 30, force = false } = {}) {
  const dir = path.join(backupRoot, 'db');
  const file = path.join(dir, `fiches-${day()}.sqlite`);
  if (!force && fs.existsSync(file)) return null;
  db.backupTo(file);
  const all = fs.readdirSync(dir).filter(f => /^fiches-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(dir, old));
  return file;
}

export function lastBackup(backupRoot) {
  const dir = path.join(backupRoot, 'db');
  try {
    const all = fs.readdirSync(dir).filter(f => f.endsWith('.sqlite')).sort();
    return all.length ? path.join(dir, all[all.length - 1]) : null;
  } catch { return null; }
}
