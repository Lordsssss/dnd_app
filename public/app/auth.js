// Connexion, inscription, récupération, premier mot de passe, réglages du compte.
import { html, useEffect, useRef, useState } from './html.js';
import { api, changeLang, changeSecret, closeModal, login, logout, openModal, recover, signup, store, toast } from './store.js';
import { Modal } from './ui.js';
import { Icon } from './icons.js';
import { LANGS, t } from '/shared/i18n.js';

const LAST_LOGIN = 'lastLogin';
const readLast = () => { try { return localStorage.getItem(LAST_LOGIN) || ''; } catch { return ''; } };
const saveLast = v => { try { localStorage.setItem(LAST_LOGIN, v); } catch { /* stockage indisponible */ } };
const netError = m => (/fetch|network/i.test(m) ? t('Serveur injoignable. Vérifie la connexion.') : m);

export function LangSwitch({ compact = false }) {
  return html`<div class=${`lang-switch ${compact ? 'compact' : ''}`} role="group" aria-label=${t('Langue')}>
    ${LANGS.map(l => html`<button type="button" class=${store.lang === l.id ? 'on' : ''} onClick=${() => changeLang(l.id)} title=${l.name}>${compact ? l.id.toUpperCase() : l.name}</button>`)}
  </div>`;
}

export function Brand({ sub }) {
  return html`<div class="auth-brand"><span class="auth-mark">⚔</span><div><h1>${t('Table D&D')}</h1>${sub ? html`<p>${sub}</p>` : null}</div></div>`;
}

function Field({ label, hint, children }) {
  return html`<label class="auth-field">${label}${hint ? html` <small>${hint}</small>` : null}${children}</label>`;
}

// Le formulaire d'un nouveau mot de passe, tapé deux fois.
export function SecretFields({ needCurrent, onDone, submitLabel, allowPin = false }) {
  const [cur, setCur] = useState('');
  const [secret, setSecret] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pinOk = allowPin && /^\d{4,12}$/.test(secret);
  const long = secret.length >= 10;
  const mismatch = again && again.length >= secret.length && again !== secret;
  const ok = (!needCurrent || cur.length >= 4) && (long || pinOk) && secret === again;
  const submit = async e => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setErr('');
    try { const r = await changeSecret({ current: needCurrent ? cur : undefined, secret }); onDone?.(r); } catch (x) { setErr(netError(x.message)); } finally { setBusy(false); }
  };
  return html`<form class="pin-form" onSubmit=${submit}>
    ${needCurrent ? html`<${Field} label=${t('Mot de passe actuel')}>
      <input class="txt" type="password" autocomplete="current-password" value=${cur} onInput=${e => setCur(e.target.value)} />
    <//>` : null}
    <${Field} label=${t('Nouveau mot de passe')} hint=${allowPin ? t('10 caractères ou plus, ou un PIN de 4 à 12 chiffres') : t('10 caractères ou plus')}>
      <input class="txt" type="password" autocomplete="new-password" value=${secret} onInput=${e => setSecret(e.target.value)} />
    <//>
    <${Field} label=${t('Confirme le nouveau mot de passe')}>
      <input class="txt" type="password" autocomplete="new-password" value=${again} onInput=${e => setAgain(e.target.value)} />
    <//>
    ${mismatch ? html`<p class="auth-err">${t('Les deux mots de passe ne correspondent pas.')}</p>` : null}
    ${err ? html`<p class="auth-err" role="alert">${err}</p>` : null}
    <button type="submit" class="btn primary big auth-go" disabled=${busy || !ok}>${busy ? t('Enregistrement…') : submitLabel}</button>
  </form>`;
}

// Le code de récupération : montré une seule fois, à noter.
export function RecoveryNotice({ code, onClose }) {
  const copy = () => navigator.clipboard?.writeText(code).then(() => toast(t('Code copié')), () => {});
  return html`<div class="recovery">
    <p><b>${t('Ton code de récupération')}</b></p>
    <p class="recovery-code" onClick=${copy} title=${t('Copier')}>${code}</p>
    <p class="muted small">${t('Garde-le en lieu sûr : il remplace le mot de passe si tu l\'oublies. Il ne sera plus affiché.')}</p>
    ${onClose ? html`<button type="button" class="btn primary" onClick=${onClose}>${t('C\'est noté')}</button>` : null}
  </div>`;
}

function LoginForm({ onMode, invite }) {
  const [name, setName] = useState(readLast());
  const [secret, setSecret] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (name) ref.current?.focus(); }, []);
  const submit = async e => {
    e.preventDefault();
    if (!name.trim() || !secret) return;
    setBusy(true);
    setErr('');
    try { await login(name.trim(), secret); saveLast(name.trim()); } catch (x) { setErr(netError(x.message)); setSecret(''); ref.current?.focus(); } finally { setBusy(false); }
  };
  return html`<form onSubmit=${submit} autocomplete="on">
    <${Field} label=${t('Identifiant')}>
      <input class="txt" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"
        autofocus=${!name} value=${name} onInput=${e => setName(e.target.value)} />
    <//>
    <${Field} label=${t('Mot de passe ou PIN')}>
      <input class="txt" ref=${ref} name="password" type="password" autocomplete="current-password" value=${secret} onInput=${e => setSecret(e.target.value)} />
    <//>
    ${err ? html`<p class="auth-err" role="alert">${err}</p>` : null}
    <button type="submit" class="btn primary big auth-go" disabled=${busy || !name.trim() || secret.length < 4}>${busy ? t('Connexion…') : invite ? t('Se connecter et rejoindre') : t('Se connecter')}</button>
    <div class="auth-links">
      ${store.signup === 'open' || invite ? html`<button type="button" class="link" onClick=${() => onMode('signup')}>${t('Créer un compte')}</button>` : null}
      <button type="button" class="link" onClick=${() => onMode('recover')}>${t('Mot de passe oublié')}</button>
    </div>
  </form>`;
}

function SignupForm({ onMode, invite, onRecovery }) {
  const [f, setF] = useState({ name: '', login: '', secret: '', again: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const auto = f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '');
  const ok = f.name.trim() && (f.login || auto).length >= 3 && f.secret.length >= 10 && f.secret === f.again;
  const submit = async e => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setErr('');
    try {
      const r = await signup({ name: f.name.trim(), login: f.login || auto, secret: f.secret, invite });
      saveLast(r.account.login);
      onRecovery(r.recovery, r.joined);
    } catch (x) { setErr(netError(x.message)); } finally { setBusy(false); }
  };
  return html`<form onSubmit=${submit} autocomplete="on">
    <${Field} label=${t('Ton nom')} hint=${t('affiché aux autres joueurs')}><input class="txt" autocomplete="nickname" value=${f.name} onInput=${set('name')} /><//>
    <${Field} label=${t('Identifiant')} hint=${t('pour te connecter')}><input class="txt" autocomplete="username" autocapitalize="none" placeholder=${auto} value=${f.login} onInput=${set('login')} /><//>
    <${Field} label=${t('Mot de passe')} hint=${t('10 caractères ou plus')}><input class="txt" type="password" autocomplete="new-password" value=${f.secret} onInput=${set('secret')} /><//>
    <${Field} label=${t('Confirme le mot de passe')}><input class="txt" type="password" autocomplete="new-password" value=${f.again} onInput=${set('again')} /><//>
    ${f.again && f.again !== f.secret && f.again.length >= f.secret.length ? html`<p class="auth-err">${t('Les deux mots de passe ne correspondent pas.')}</p>` : null}
    ${err ? html`<p class="auth-err" role="alert">${err}</p>` : null}
    <button type="submit" class="btn primary big auth-go" disabled=${busy || !ok}>${busy ? t('Création…') : invite ? t('Créer mon compte et rejoindre') : t('Créer mon compte')}</button>
    <div class="auth-links"><button type="button" class="link" onClick=${() => onMode('login')}>${t('J\'ai déjà un compte')}</button></div>
  </form>`;
}

function RecoverForm({ onMode, onRecovery }) {
  const [f, setF] = useState({ login: readLast(), code: '', secret: '', again: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.value });
  const ok = f.login.trim() && f.code.replace(/[^a-z0-9]/gi, '').length >= 16 && f.secret.length >= 10 && f.secret === f.again;
  const submit = async e => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setErr('');
    try { const r = await recover({ login: f.login.trim(), code: f.code, secret: f.secret }); onRecovery(r.recovery); } catch (x) { setErr(netError(x.message)); } finally { setBusy(false); }
  };
  return html`<form onSubmit=${submit}>
    <p class="auth-lead">${t('Avec le code de récupération reçu à l\'inscription. Sans ce code, demande à l\'admin du serveur un mot de passe temporaire.')}</p>
    <${Field} label=${t('Identifiant')}><input class="txt" autocomplete="username" autocapitalize="none" value=${f.login} onInput=${set('login')} /><//>
    <${Field} label=${t('Code de récupération')}><input class="txt mono" autocapitalize="characters" placeholder="ABCD-EFGH-JKLM-NPQR" value=${f.code} onInput=${set('code')} /><//>
    <${Field} label=${t('Nouveau mot de passe')} hint=${t('10 caractères ou plus')}><input class="txt" type="password" autocomplete="new-password" value=${f.secret} onInput=${set('secret')} /><//>
    <${Field} label=${t('Confirme le mot de passe')}><input class="txt" type="password" autocomplete="new-password" value=${f.again} onInput=${set('again')} /><//>
    ${err ? html`<p class="auth-err" role="alert">${err}</p>` : null}
    <button type="submit" class="btn primary big auth-go" disabled=${busy || !ok}>${busy ? t('Enregistrement…') : t('Changer le mot de passe')}</button>
    <div class="auth-links"><button type="button" class="link" onClick=${() => onMode('login')}>${t('Retour à la connexion')}</button></div>
  </form>`;
}

// La page de connexion. `invite` : le code d'une invitation, rejointe après connexion.
export function AuthPage({ invite = null, inviteInfo = null }) {
  const [mode, setMode] = useState(invite && store.signup !== 'closed' ? 'signup' : 'login');
  const [recovery, setRecovery] = useState(null);
  useEffect(() => { api('/api/config/public').then(c => { store.signup = c.signup; }).catch(() => {}); }, []);
  if (recovery) {
    return html`<div class="join auth"><div class="auth-card">
      <${Brand} sub=${t('Bienvenue')} />
      <${RecoveryNotice} code=${recovery} onClose=${() => { setRecovery(null); location.reload(); }} />
    </div></div>`;
  }
  const sub = mode === 'signup' ? t('Créer un compte') : mode === 'recover' ? t('Mot de passe oublié') : t('Connexion');
  return html`<div class="join auth">
    <div class="auth-card">
      <div class="auth-top"><${Brand} sub=${sub} /><${LangSwitch} compact /></div>
      ${inviteInfo ? html`<div class="invite-box">${Icon.scroll()} <div>${t('Invitation à rejoindre')} <b>${inviteInfo.campaign.name}</b>${inviteInfo.role === 'codm' ? html` <span class="badge">${t('co-MJ')}</span>` : null}</div></div>` : null}
      ${mode === 'login' ? html`<${LoginForm} onMode=${setMode} invite=${invite} />` : null}
      ${mode === 'signup' ? html`<${SignupForm} onMode=${setMode} invite=${invite} onRecovery=${code => setRecovery(code)} />` : null}
      ${mode === 'recover' ? html`<${RecoverForm} onMode=${setMode} onRecovery=${code => setRecovery(code)} />` : null}
      ${mode === 'login' && store.signup !== 'open' && !invite ? html`<p class="auth-help">${t('Pas de compte ? Un MJ t\'envoie un lien d\'invitation à sa campagne.')}</p>` : null}
    </div>
  </div>`;
}

export function FirstSecret() {
  return html`<div class="join auth">
    <div class="auth-card">
      <div class="auth-top"><${Brand} sub=${t('Bienvenue, {name}', { name: store.account.name })} /><${LangSwitch} compact /></div>
      <p class="auth-lead">${t('Choisis ton mot de passe personnel. Il remplace le code temporaire reçu, et toi seul le connais.')}</p>
      <${SecretFields} submitLabel=${t('Enregistrer et entrer')} allowPin=${store.account.secretKind === 'pin'} onDone=${r => { if (r.recovery) openModal({ kind: 'recovery', code: r.recovery }); }} />
      <button type="button" class="btn ghost small auth-out" onClick=${() => logout()}>${t('Se déconnecter')}</button>
    </div>
  </div>`;
}

// Réglages du compte : nom, langue, mot de passe, code de récupération.
export function AccountModal() {
  const a = store.account;
  const [name, setName] = useState(a.name);
  const [tab, setTab] = useState('profile');
  const [recovery, setRecovery] = useState(null);
  const [cur, setCur] = useState('');
  const saveName = () => api('/api/account/profile', { method: 'POST', body: { name } }).then(r => { store.account = r.account; toast(t('Enregistré')); }).catch(e => toast(e.message, { kind: 'error' }));
  const newCode = () => api('/api/account/recovery', { method: 'POST', body: { current: cur } }).then(r => { setRecovery(r.recovery); setCur(''); }).catch(e => toast(e.message, { kind: 'error' }));
  return html`<${Modal} title=${t('Mon compte')}>
    <div class="tabs small">
      ${[['profile', t('Profil')], ['secret', t('Mot de passe')], ['recovery', t('Récupération')]].map(([k, l]) => html`<button type="button" class=${tab === k ? 'on' : ''} onClick=${() => setTab(k)}>${l}</button>`)}
    </div>
    ${tab === 'profile' ? html`<div class="form-stack">
      <label class="auth-field">${t('Nom affiché')}<div class="row"><input class="txt" value=${name} onInput=${e => setName(e.target.value)} /><button type="button" class="btn" disabled=${!name.trim() || name === a.name} onClick=${saveName}>${t('Enregistrer')}</button></div></label>
      <label class="auth-field">${t('Identifiant')}<input class="txt" value=${a.login} readOnly /></label>
      <div class="auth-field">${t('Langue')}<${LangSwitch} /></div>
    </div>` : null}
    ${tab === 'secret' ? html`<p class="muted small">${t('Tes autres appareils devront se reconnecter.')}</p>
      <${SecretFields} needCurrent allowPin=${a.secretKind === 'pin'} submitLabel=${t('Changer le mot de passe')} onDone=${r => { if (r.recovery) setRecovery(r.recovery); else closeModal(); toast(t('Mot de passe changé')); }} />
      ${recovery ? html`<${RecoveryNotice} code=${recovery} />` : null}` : null}
    ${tab === 'recovery' ? html`<div class="form-stack">
      <p class="muted small">${a.hasRecovery ? t('Un code de récupération existe. En créer un nouveau rend l\'ancien inutilisable.') : t('Aucun code de récupération : crée-le maintenant, il sert si tu oublies ton mot de passe.')}</p>
      <label class="auth-field">${t('Mot de passe actuel')}<input class="txt" type="password" value=${cur} onInput=${e => setCur(e.target.value)} /></label>
      <button type="button" class="btn" disabled=${cur.length < 4} onClick=${newCode}>${t('Nouveau code de récupération')}</button>
      ${recovery ? html`<${RecoveryNotice} code=${recovery} />` : null}
    </div>` : null}
  <//>`;
}
