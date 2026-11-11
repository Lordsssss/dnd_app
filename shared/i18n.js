// Langue de l'interface. Le texte source est le français : chaque chaîne affichée passe par
// t('Texte français', { variables }), et le dictionnaire anglais la traduit. Une chaîne absente
// du dictionnaire reste en français plutôt que de casser l'affichage. Les termes de D&D
// (Prone, Multiattack…) restent en anglais dans les deux langues.
import EN from './i18n/en.js';

export const LANGS = [
  { id: 'fr', name: 'Français' },
  { id: 'en', name: 'English' },
];
const DICTS = { en: EN };
let current = 'fr';

export const normLang = l => (LANGS.some(x => x.id === l) ? l : 'fr');
export function setLang(l) { current = normLang(l); return current; }
export function getLang() { return current; }

function fill(s, vars) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s;
}

// Traduction dans la langue courante (navigateur).
export function t(fr, vars) {
  return tl(current, fr, vars);
}

// Traduction dans une langue donnée (serveur : la langue de la personne qui fait la requête).
export function tl(lang, fr, vars) {
  const s = (lang && lang !== 'fr' && DICTS[lang]?.[fr]) || fr;
  return fill(String(s), vars);
}

// Traduction d'un texte déjà affiché tel quel (nœuds de texte des gabarits, messages) : on
// cherche le texte exact, espaces de bord gardés. Rien trouvé : le texte reste en français.
const norm = s => s.replace(/\s+/g, ' ').trim();
export function tx(str, lang = current) {
  if (lang === 'fr' || typeof str !== 'string') return str;
  const dict = DICTS[lang];
  if (!dict) return str;
  const key = norm(str);
  if (!key) return str;
  const hit = dict[key];
  if (hit == null) return str;
  const lead = /^\s*/.exec(str)[0] ? ' ' : '';
  const trail = /\s*$/.exec(str)[0] ? ' ' : '';
  return lead + hit + trail;
}

// Accord simple : tn(n, '{n} sort', '{n} sorts').
export function tn(n, one, many, vars = {}) {
  return t(Math.abs(n) >= 2 ? many : one, { n, ...vars });
}

export const locale = () => (current === 'en' ? 'en-CA' : 'fr-CA');
