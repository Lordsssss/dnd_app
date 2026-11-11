// Images de la carte et des tokens : décodées une fois, réduites si elles sont énormes.
// La plus grande du coffre fait 8192 × 6144 ; à 4096 de côté, le zoom reste fluide et la mémoire
// suffit. Les tokens de Forgotten Adventures sont dessinés à 400 pixels par case.

const MAX_MAP_SIDE = 4096;
const FA_PX_PER_CELL = 400;
const TOKEN_KEEP = 0.4;

const maps = new Map();
const tokens = new Map();

// Une image par sa référence : `asset:<id>` (campagne) ou `lib:<chemin>` (bibliothèque globale).
export const fileUrl = ref => `/api/file?ref=${encodeURIComponent(ref)}`;

async function decode(path) {
  const res = await fetch(fileUrl(path), { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Image introuvable : ${path}`);
  return createImageBitmap(await res.blob());
}

export function loadMap(path) {
  if (!maps.has(path)) {
    maps.set(path, (async () => {
      const full = await decode(path);
      const natural = [full.width, full.height];
      const side = Math.max(full.width, full.height);
      if (side <= MAX_MAP_SIDE) return { bitmap: full, natural };
      const k = MAX_MAP_SIDE / side;
      const small = await createImageBitmap(full, { resizeWidth: Math.round(full.width * k), resizeHeight: Math.round(full.height * k), resizeQuality: 'high' });
      full.close();
      return { bitmap: small, natural };
    })().catch(e => { maps.delete(path); throw e; }));
  }
  return maps.get(path);
}

export const tokenLoading = path => tokens.get(path)?.state === 'loading';

// Renvoie l'image si elle est prête, sinon lance son chargement et appelle `ready` à la fin.
export function tokenImage(path, ready) {
  if (!path) return null;
  const known = tokens.get(path);
  if (known) return known.state === 'ready' ? known : null;
  const entry = { state: 'loading' };
  tokens.set(path, entry);
  decode(path).then(async full => {
    // Forgotten Adventures dessine ses tokens à 400 pixels par case, débordements compris.
    const isFa = /(^|[:/])FA_Tokens\//.test(path);
    entry.cellsW = isFa ? full.width / FA_PX_PER_CELL : null;
    entry.cellsH = isFa ? full.height / FA_PX_PER_CELL : null;
    entry.aspect = full.width / full.height;
    const k = Math.min(1, Math.max(96 / Math.max(full.width, full.height), TOKEN_KEEP));
    if (k < 1) {
      entry.bitmap = await createImageBitmap(full, { resizeWidth: Math.round(full.width * k), resizeHeight: Math.round(full.height * k), resizeQuality: 'high' });
      full.close();
    } else entry.bitmap = full;
    entry.state = 'ready';
    ready?.();
  }).catch(() => { entry.state = 'error'; });
  return null;
}
