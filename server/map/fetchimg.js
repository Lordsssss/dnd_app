// Une image tirée d'une adresse collée sur la carte par un joueur. Le serveur va la chercher
// lui-même : seulement en http(s) sur les ports usuels, jamais vers une adresse privée ou locale
// (vérifié à chaque connexion, redirections comprises), avec une taille et un délai bornés.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { HttpError } from '../http.js';

const blocked = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) {
  blocked.addSubnet(a, p, 'ipv4');
}
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]]) {
  blocked.addSubnet(a, p, 'ipv6');
}

export function isPrivateAddress(address) {
  const fam = net.isIP(address);
  if (!fam) return true;
  if (fam === 6) {
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (m) return blocked.check(m[1], 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return blocked.check(address, 'ipv4');
}

// Résolution DNS qui refuse les adresses privées : appelée par la connexion elle-même, donc
// une adresse qui change entre deux résolutions ne passe pas.
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    if (err) return cb(err);
    const ok = list.filter(a => !isPrivateAddress(a.address));
    if (!ok.length) return cb(Object.assign(new Error('Adresse privée refusée'), { code: 'EPRIVATE' }));
    if (options?.all) return cb(null, ok);
    return cb(null, ok[0].address, ok[0].family);
  });
}

function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new HttpError(400, 'Adresse d\'image invalide'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HttpError(400, 'Adresse d\'image invalide');
  if (u.username || u.password) throw new HttpError(400, 'Adresse d\'image invalide');
  if (u.port && !['80', '443'].includes(u.port)) throw new HttpError(400, 'Adresse d\'image invalide');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateAddress(host)) throw new HttpError(400, 'Adresse privée refusée');
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new HttpError(400, 'Adresse privée refusée');
  return u;
}

function getOnce(u, maxBytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(u, {
      lookup: safeLookup,
      timeout: timeoutMs,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; dnd-table)', Accept: 'image/*' },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve({ redirect: new URL(res.headers.location, u).toString() });
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new HttpError(400, 'Image introuvable à cette adresse')); return; }
      if (Number(res.headers['content-length']) > maxBytes) { res.destroy(); reject(new HttpError(413, 'Image trop lourde (5 Mo au plus)')); return; }
      const parts = [];
      let size = 0;
      res.on('data', c => {
        size += c.length;
        if (size > maxBytes) { res.destroy(); reject(new HttpError(413, 'Image trop lourde (5 Mo au plus)')); return; }
        parts.push(c);
      });
      res.on('end', () => resolve({ buffer: Buffer.concat(parts) }));
      res.on('error', () => reject(new HttpError(400, 'Image introuvable à cette adresse')));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', e => reject(e instanceof HttpError ? e : new HttpError(400, e.code === 'EPRIVATE' ? 'Adresse privée refusée' : 'Image introuvable à cette adresse')));
  });
}

export async function fetchImage(raw, { maxBytes = 5_000_000, timeoutMs = 10_000 } = {}) {
  let url = raw;
  for (let i = 0; i < 4; i++) {
    const r = await getOnce(checkUrl(url), maxBytes, timeoutMs);
    if (r.buffer) return r.buffer;
    url = r.redirect;
  }
  throw new HttpError(400, 'Image introuvable à cette adresse');
}
