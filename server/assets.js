// Fichiers envoyés par les membres : cartes, tokens, portraits, images du monde. Rangés par
// empreinte SHA-256 sous data/files/assets/, décrits par une ligne de la table `assets`.
// Une image n'est servie qu'aux membres de sa campagne ; la bibliothèque globale (libraryDir)
// est un dossier en lecture seule, ouvert à tout compte connecté.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError } from './http.js';

export const ASSET_KINDS = ['map', 'token', 'portrait', 'world', 'image'];

// Un dossier d'images : un nom simple, sans barre oblique (« Donjon 2 », « Gobelins »). Vide : sans dossier.
export const cleanFolder = f => String(f || '').replace(/[\\/]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const EXT_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

// Le type réel d'après les premiers octets, jamais d'après le nom ou l'en-tête envoyés.
export function sniffImage(buf) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('ascii', 0, 6))) return 'gif';
  return null;
}

// Largeur et hauteur en pixels, pour proposer une grille sans charger l'image.
export function imageSize(buf, type) {
  try {
    if (type === 'png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (type === 'gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (type === 'webp') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
      }
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (type === 'jpg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
    }
  } catch { /* image tronquée : pas de dimensions */ }
  return { width: null, height: null };
}

export class AssetStore {
  constructor(db, root, { maxBytes = 25_000_000, quotaBytes = 1_000_000_000 } = {}) {
    this.db = db;
    this.root = path.join(root, 'assets');
    this.maxBytes = maxBytes;
    this.quotaBytes = quotaBytes;
    fs.mkdirSync(this.root, { recursive: true });
  }

  fileOf(asset) {
    return path.join(this.root, asset.file);
  }

  save({ campaign, kind = 'image', name = 'image', buffer, by = null, folder = '' }) {
    if (!ASSET_KINDS.includes(kind)) throw new HttpError(400, 'Type de fichier inconnu');
    if (!buffer?.length) throw new HttpError(400, 'Fichier vide');
    if (buffer.length > this.maxBytes) throw new HttpError(413, 'Image trop lourde (25 Mo au plus)');
    const type = sniffImage(buffer);
    if (!type) throw new HttpError(415, 'Format refusé : PNG, JPEG, WebP ou GIF');
    if (campaign && this.db.campaignBytes(campaign) + buffer.length > this.quotaBytes) throw new HttpError(413, 'Espace de la campagne plein : supprime des images inutilisées');
    const sha = crypto.createHash('sha256').update(buffer).digest('hex');
    const existing = this.db.assetBySha(campaign, sha, kind);
    // La même image renvoyée dans un autre dossier : elle y est rangée, sans doublon.
    if (existing) {
      if (cleanFolder(folder) && cleanFolder(folder) !== existing.folder) this.db.putAsset({ ...existing, folder: cleanFolder(folder) });
      return this.db.getAsset(existing.id);
    }
    const file = `${sha.slice(0, 2)}/${sha}.${type}`;
    const full = path.join(this.root, file);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const tmp = `${full}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, full);
    }
    const { width, height } = imageSize(buffer, type);
    const clean = String(name || 'image').replace(/[\\/]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'image';
    const asset = {
      id: `f${crypto.randomBytes(6).toString('hex')}`, campaign: campaign || null, kind, name: clean, mime: IMAGE_MIME[type],
      size: buffer.length, sha256: sha, file, width, height, createdBy: by, createdAt: Date.now(), folder: cleanFolder(folder),
    };
    this.db.putAsset(asset);
    return this.db.getAsset(asset.id);
  }

  remove(id) {
    const a = this.db.getAsset(id);
    if (!a) return false;
    this.db.deleteAsset(id);
    if (this.db.shaUses(a.sha256) === 0) fs.rmSync(this.fileOf(a), { force: true });
    return true;
  }

  serve(req, res, asset) {
    const full = this.fileOf(asset);
    let st;
    try { st = fs.statSync(full); } catch { throw new HttpError(404, 'Image introuvable'); }
    const etag = `"${asset.sha256.slice(0, 16)}"`;
    const headers = { 'Content-Type': asset.mime, 'Cache-Control': 'private, max-age=86400', ETag: etag };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(full).pipe(res);
  }
}

// Bibliothèque globale : un dossier d'images (Forgotten Adventures, par exemple) monté par l'admin.
export class Library {
  constructor(dir) {
    this.dir = dir ? path.resolve(dir) : null;
  }

  resolve(rel) {
    if (!this.dir) return null;
    const clean = String(rel || '');
    if (clean.split(/[\\/]/).some(p => p.startsWith('.'))) return null;
    const full = path.resolve(this.dir, clean);
    if (!full.startsWith(this.dir + path.sep)) return null;
    return EXT_MIME[path.extname(full).toLowerCase()] ? full : null;
  }

  serve(req, res, rel) {
    const full = this.resolve(rel);
    if (!full) throw new HttpError(404, 'Image introuvable');
    let st;
    try { st = fs.statSync(full); } catch { throw new HttpError(404, 'Image introuvable'); }
    const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
    const headers = { 'Content-Type': EXT_MIME[path.extname(full).toLowerCase()], 'Cache-Control': 'private, max-age=86400', ETag: etag };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(full).pipe(res);
  }
}
