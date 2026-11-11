// Chargeur de modules pour les tests : les chemins du navigateur (/vendor/…, /shared/…, /app/…)
// pointent vers les fichiers du dépôt, et Preact est le même module partout.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const pkg = (name, sub) => pathToFileURL(path.join(ROOT, 'node_modules', name, sub)).href;

const MAP = {
  '/vendor/preact.mjs': pkg('preact', 'dist/preact.mjs'),
  '/vendor/hooks.mjs': pkg('preact', 'hooks/dist/hooks.mjs'),
  '/vendor/htm.mjs': pkg('htm', 'dist/htm.mjs'),
};

export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true };
  if (specifier.startsWith('/shared/')) return { url: pathToFileURL(path.join(ROOT, specifier)).href, shortCircuit: true };
  if (specifier.startsWith('/app/') || specifier.startsWith('/map/') || specifier.startsWith('/world/')) {
    return { url: pathToFileURL(path.join(ROOT, 'public', specifier)).href, shortCircuit: true };
  }
  return next(specifier, context);
}
