// Campagnes : réglages, membres, invitations, jetons d'API. Les droits d'un compte sur une
// campagne viennent d'ici et de nulle part ailleurs : `dm` (créateur, transférable), `codm`
// (nommé par le MJ) et `player`. Le drapeau admin d'un compte ne donne aucune vue sur une campagne.
import crypto from 'node:crypto';
import { DEFAULT_CURRENCY } from '../shared/rules.js';
import { HttpError } from './http.js';

export const ROLES = ['dm', 'codm', 'player'];
export const isDmRole = r => r === 'dm' || r === 'codm';

export const DEFAULT_SETTINGS = {
  currency: DEFAULT_CURRENCY,
  coinWeight: true,
  edition: '2024',
  rules: { longRestHitDice: 'all' },
  preferredSources: ['XPHB', 'XDMG', 'XMM', 'PHB', 'DMG', 'MM', 'TCE', 'XGE'],
  secretDeathSaves: true,
  sessionNumber: null,
  // Image choisie pour chaque créature et chaque PJ sur la carte.
  library: { monsters: {}, characters: {} },
  tvScene: null,
};

const MAX = { name: 80, description: 2000 };

export function newCampaignId() {
  return `c${crypto.randomBytes(5).toString('hex')}`;
}

function cleanCurrency(list) {
  if (!Array.isArray(list) || !list.length || list.length > 8) throw new HttpError(400, 'Monnaie invalide');
  const seen = new Set();
  const out = list.map(d => {
    const key = String(d.key || d.label || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6);
    const label = String(d.label || key).trim().slice(0, 8);
    const value = Math.round(Number(d.value));
    if (!key || seen.has(key) || !(value >= 1) || value > 1e9) throw new HttpError(400, 'Monnaie invalide');
    seen.add(key);
    return { key, label, name: String(d.name || '').trim().slice(0, 30), value };
  });
  if (!out.some(d => d.value === 1)) throw new HttpError(400, 'Une pièce doit valoir 1 : c\'est l\'unité de base');
  return out.sort((a, b) => a.value - b.value);
}

export class Campaigns {
  constructor(db) {
    this.db = db;
  }

  list() { return this.db.listCampaigns(); }

  get(cid) {
    const c = this.db.getCampaign(String(cid || ''));
    return c && !c.archived ? c : null;
  }

  must(cid) {
    const c = this.get(cid);
    if (!c) throw new HttpError(404, 'Campagne introuvable');
    return c;
  }

  settings(cid) {
    const c = this.db.getCampaign(cid);
    const s = c?.settings || {};
    return {
      ...DEFAULT_SETTINGS,
      ...s,
      rules: { ...DEFAULT_SETTINGS.rules, ...(s.rules || {}) },
      library: { monsters: {}, characters: {}, ...(s.library || {}) },
    };
  }

  // Ce que les navigateurs des membres reçoivent : jamais le pont vers le coffre ni les jetons.
  publicInfo(cid) {
    const c = this.db.getCampaign(cid);
    if (!c) return null;
    const s = this.settings(cid);
    return {
      id: c.id, name: c.name, description: c.description,
      settings: { currency: s.currency, coinWeight: s.coinWeight, edition: s.edition, rules: s.rules, secretDeathSaves: s.secretDeathSaves, preferredSources: s.preferredSources },
      bridge: !!c.bridge,
    };
  }

  create({ name, description = '', ownerId, settings = {} }) {
    const n = String(name || '').trim().slice(0, MAX.name);
    if (!n) throw new HttpError(400, 'Nom obligatoire');
    const id = newCampaignId();
    this.db.putCampaign({ id, name: n, description: String(description || '').slice(0, MAX.description), settings, createdBy: ownerId, createdAt: Date.now() });
    if (ownerId) this.db.setMember(id, ownerId, 'dm');
    return this.db.getCampaign(id);
  }

  update(cid, patch) {
    const c = this.must(cid);
    const next = { ...c };
    if (typeof patch.name === 'string') {
      const n = patch.name.trim().slice(0, MAX.name);
      if (!n) throw new HttpError(400, 'Nom obligatoire');
      next.name = n;
    }
    if (typeof patch.description === 'string') next.description = patch.description.slice(0, MAX.description);
    if (patch.settings && typeof patch.settings === 'object') {
      const s = { ...c.settings };
      const p = patch.settings;
      if ('currency' in p) s.currency = cleanCurrency(p.currency);
      if ('coinWeight' in p) s.coinWeight = !!p.coinWeight;
      if ('edition' in p) s.edition = p.edition === '2014' ? '2014' : '2024';
      if ('secretDeathSaves' in p) s.secretDeathSaves = !!p.secretDeathSaves;
      if ('sessionNumber' in p) s.sessionNumber = p.sessionNumber === '' || p.sessionNumber == null ? null : Math.max(0, Math.trunc(Number(p.sessionNumber) || 0));
      if (p.rules && typeof p.rules === 'object') {
        s.rules = { ...(s.rules || {}) };
        if ('longRestHitDice' in p.rules) s.rules.longRestHitDice = p.rules.longRestHitDice === 'half' ? 'half' : 'all';
      }
      if (Array.isArray(p.preferredSources)) s.preferredSources = p.preferredSources.map(x => String(x).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)).filter(Boolean).slice(0, 30);
      next.settings = s;
    }
    this.db.putCampaign(next);
    return this.db.getCampaign(cid);
  }

  // Réglage interne (bibliothèque d'images, scène de la TV) : pas de validation de forme.
  setInternal(cid, key, value) {
    const c = this.db.getCampaign(cid);
    if (!c) return;
    this.db.putCampaign({ ...c, settings: { ...c.settings, [key]: value } });
  }

  setBridge(cid, bridge) {
    const c = this.must(cid);
    this.db.putCampaign({ ...c, bridge: bridge || null });
  }

  // ---------------------------------------------------------------- Membres
  role(accountId, cid) {
    if (!accountId || !cid || !this.get(cid)) return null;
    return this.db.roleOf(cid, accountId);
  }

  members(cid) { return this.db.membersOf(cid); }

  campaignsOf(accountId) {
    return this.db.membershipsOf(accountId)
      .map(m => ({ ...m, campaign: this.get(m.campaign) }))
      .filter(m => m.campaign);
  }

  setRole(cid, accountId, role) {
    if (!ROLES.includes(role)) throw new HttpError(400, 'Rôle inconnu');
    const before = this.db.roleOf(cid, accountId);
    if (before === 'dm' && role !== 'dm') this.mustKeepDm(cid, accountId);
    // Un seul MJ titulaire : le donner à quelqu'un fait de l'ancien un co-MJ.
    if (role === 'dm') for (const m of this.members(cid)) if (m.role === 'dm' && m.accountId !== accountId) this.db.setMember(cid, m.accountId, 'codm');
    this.db.setMember(cid, accountId, role);
  }

  removeMember(cid, accountId) {
    if (this.db.roleOf(cid, accountId) === 'dm') this.mustKeepDm(cid, accountId);
    this.db.removeMember(cid, accountId);
  }

  mustKeepDm(cid, leaving) {
    const others = this.members(cid).filter(m => m.role === 'dm' && m.accountId !== leaving);
    if (!others.length) throw new HttpError(400, 'La campagne doit garder un MJ : donne d\'abord ce rôle à quelqu\'un d\'autre');
  }

  // ---------------------------------------------------------------- Invitations
  createInvite(cid, { role = 'player', uses = null, days = 14, by = null } = {}) {
    this.must(cid);
    if (!ROLES.includes(role) || role === 'dm') throw new HttpError(400, 'Rôle inconnu');
    const code = crypto.randomBytes(9).toString('base64url');
    const usesLeft = uses == null || uses === '' ? null : Math.max(1, Math.min(100, Math.trunc(Number(uses)) || 1));
    const expiresAt = days ? Date.now() + Math.min(365, Math.max(1, Number(days))) * 86_400_000 : null;
    this.db.addInvite({ code, campaign: cid, role, usesLeft, expiresAt, createdBy: by });
    return this.db.getInvite(code);
  }

  invite(code) {
    const i = this.db.getInvite(String(code || ''));
    if (!i) return null;
    if (i.expires_at && i.expires_at < Date.now()) return null;
    if (i.uses_left != null && i.uses_left <= 0) return null;
    if (!this.get(i.campaign_id)) return null;
    return i;
  }

  // Accepter : membre avec le rôle de l'invitation, sans jamais rétrograder un rôle existant.
  acceptInvite(code, accountId) {
    const i = this.invite(code);
    if (!i) throw new HttpError(404, 'Invitation expirée ou inconnue');
    const current = this.db.roleOf(i.campaign_id, accountId);
    if (!current) {
      this.db.setMember(i.campaign_id, accountId, i.role);
      this.db.useInvite(i.code);
    } else if (current === 'player' && i.role === 'codm') {
      this.db.setMember(i.campaign_id, accountId, 'codm');
      this.db.useInvite(i.code);
    }
    return { campaign: i.campaign_id, role: this.db.roleOf(i.campaign_id, accountId) };
  }

  // ---------------------------------------------------------------- Jetons d'API
  createToken(cid, label, by) {
    this.must(cid);
    const raw = `dt_${crypto.randomBytes(24).toString('base64url')}`;
    const id = `t${crypto.randomBytes(5).toString('hex')}`;
    this.db.addToken({ id, campaign: cid, label: String(label || 'Jeton').trim().slice(0, 60) || 'Jeton', hash: hashToken(raw), createdBy: by });
    return { id, token: raw };
  }

  tokenAuth(raw) {
    if (!String(raw || '').startsWith('dt_')) return null;
    const t = this.db.tokenByHash(hashToken(raw));
    if (!t || !this.get(t.campaign_id)) return null;
    this.db.touchToken(t.id);
    return t;
  }
}

export function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}
