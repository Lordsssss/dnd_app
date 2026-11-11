// Comptes : un identifiant, un secret haché (mot de passe, ou PIN pour les comptes d'avant),
// un drapeau admin et une langue. Les droits sur une campagne viennent de ses membres
// (voir campaigns.js), jamais du compte.
import crypto from 'node:crypto';

export const PIN_RE = /^\d{4,12}$/;
export const PASSWORD_MIN = 10;

export function hashPin(secret) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(secret), salt, 32);
  return `s1$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function checkPin(secret, stored) {
  const [v, saltHex, hashHex] = String(stored || '').split('$');
  if (v !== 's1' || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, 'hex');
  const got = crypto.scryptSync(String(secret ?? ''), Buffer.from(saltHex, 'hex'), want.length);
  return crypto.timingSafeEqual(want, got);
}

// Un nouveau secret : un mot de passe d'au moins 10 caractères. Un compte qui avait un PIN
// peut garder un PIN de 4 à 12 chiffres.
export function secretProblem(secret, { allowPin = false } = {}) {
  const s = String(secret || '');
  if (allowPin && PIN_RE.test(s)) return null;
  if (s.length < PASSWORD_MIN) return allowPin ? 'Mot de passe de 10 caractères ou plus, ou PIN de 4 à 12 chiffres' : 'Mot de passe de 10 caractères ou plus';
  if (s.length > 200) return 'Mot de passe trop long';
  return null;
}

export const secretKindOf = s => (PIN_RE.test(String(s || '')) ? 'pin' : 'password');

// PIN temporaire : 6 chiffres, à changer à la première connexion.
export function tempPin() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

// Code de récupération, montré une fois à l'inscription : 4 groupes de 4 caractères lisibles.
const RC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function recoveryCode() {
  let out = '';
  for (let i = 0; i < 16; i++) out += RC[crypto.randomInt(0, RC.length)];
  return out.match(/.{4}/g).join('-');
}
export const normalizeRecovery = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// « Zoé », « Élodie » → « zoe », « elodie » : ce que la personne tape pour se connecter.
export function loginKey(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 32);
}

export function newAccountId() {
  return `a${crypto.randomBytes(6).toString('hex')}`;
}

export function publicAccount(a) {
  return {
    id: a.id, login: a.login, name: a.name, isAdmin: !!a.isAdmin, canCreate: !!(a.isAdmin || a.canCreate), lang: a.lang || null,
    mustChange: !!a.mustChange, secretKind: a.secretKind || 'pin', hasRecovery: !!a.recoveryHash,
  };
}

export function uniqueLogin(db, base) {
  let login = base || 'joueur';
  for (let n = 2; db.getAccountByLogin(login); n++) login = `${base}${n}`;
  return login;
}

// Premier démarrage, base vide : un compte admin, PIN temporaire affiché une seule fois.
export function ensureAdmin(db) {
  if (db.countAccounts() > 0) return null;
  const pin = tempPin();
  const acc = { id: newAccountId(), login: 'admin', name: 'Admin', pinHash: hashPin(pin), mustChange: true, isAdmin: true, canCreate: true, secretKind: 'pin' };
  db.putAccount(acc);
  return { ...publicAccount(acc), pin };
}
