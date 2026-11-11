// Bestiaire d'une campagne : les créatures et PNJ que le MJ prépare, copiés de 5etools et
// retouchés, écrits à la main, ou importés du coffre. Une entrée :
//   { name, kind: 'markdown' | '5e', body, ref: { name, source }, image, size, init, ac, hp, notes, tags, origin }
// `body` est un bloc Markdown (gras, italique, tableaux, titres), rendu sur la carte d'infos.
// Jamais de valeur d'XP : la difficulté d'une rencontre est l'affaire du MJ.
import { renderString, SIZES, acText, alignText, condList, dmgList, speedText, typeText } from './render5e.js';

const str = (v, max) => String(v ?? '').slice(0, max);
const int = (v, min, max) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.max(min, Math.min(max, Math.round(Number(v)))) : null);

export function normalizeBeast(raw = {}) {
  const kind = raw.kind === '5e' ? '5e' : 'markdown';
  const out = {
    name: str(raw.name, 120).trim() || 'Créature',
    kind,
    body: str(raw.body, 60_000),
    image: str(raw.image, 300),
    size: int(raw.size, 1, 8) || 1,
    init: int(raw.init, -10, 30),
    ac: int(raw.ac, 0, 50),
    hp: int(raw.hp, 0, 99999),
    notes: str(raw.notes, 10_000),
    tags: Array.isArray(raw.tags) ? raw.tags.map(t => str(t, 30).trim()).filter(Boolean).slice(0, 12) : [],
  };
  // Chiffres lus dans le bloc quand ils ne sont pas donnés : « **CA 15** · **PV 95** ».
  const plainBody = out.body.replace(/\*|_|`/g, '');
  if (out.ac == null) { const m = /\b(?:CA|AC|Armor Class)\s*:?\s*(\d+)/i.exec(plainBody); if (m) out.ac = Number(m[1]); }
  if (out.hp == null) { const m = /\b(?:PV|HP|Hit Points)\s*:?\s*(\d+)/i.exec(plainBody); if (m) out.hp = Number(m[1]); }
  if (kind === '5e') out.ref = { name: str(raw.ref?.name || raw.name, 120), source: str(raw.ref?.source, 20) };
  if (raw.origin && typeof raw.origin === 'object') out.origin = { file: str(raw.origin.file, 300), title: str(raw.origin.title, 300), link: str(raw.origin.link, 300) };
  return out;
}

const plain = s => renderString(String(s ?? ''), false).replace(/\s+/g, ' ').trim();
const sign = n => (n >= 0 ? `+${n}` : `${n}`);
const modOf = score => Math.floor(((Number(score) || 10) - 10) / 2);

function entriesToLines(list) {
  const out = [];
  for (const e of list || []) {
    if (typeof e === 'string') { out.push(plain(e)); continue; }
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'list') { for (const it of e.items || []) out.push(`- ${typeof it === 'string' ? plain(it) : `${it.name ? `**${plain(it.name)}.** ` : ''}${entriesToLines(it.entries || (it.entry ? [it.entry] : [])).join(' ')}`}`); continue; }
    const body = entriesToLines(e.entries || (e.entry ? [e.entry] : []));
    if (e.name) out.push(`***${plain(e.name)}.*** ${body.shift() || ''}`.trim());
    out.push(...body);
  }
  return out;
}

function spellcastingLines(list) {
  const out = [];
  for (const sc of list || []) {
    out.push(`***${plain(sc.name || 'Spellcasting')}.*** ${(sc.headerEntries || []).map(plain).join(' ')}`.trim());
    const refs = l => [].concat(l || []).map(x => plain(typeof x === 'string' ? x : x.entry || '')).join(', ');
    if (sc.will) out.push(`- **At will :** ${refs(sc.will)}`);
    for (const [n, sp] of Object.entries(sc.daily || {})) out.push(`- **${n.replace('e', '')}/day${n.endsWith('e') ? ' each' : ''} :** ${refs(sp)}`);
    for (const [lvl, d] of Object.entries(sc.spells || {})) out.push(`- **${lvl === '0' ? 'Cantrips' : `Level ${lvl}${d.slots != null ? `, ${d.slots} slots` : ''}`} :** ${refs(d.spells)}`);
    for (const f of sc.footerEntries || []) out.push(plain(f));
  }
  return out;
}

// Une créature de 5etools en bloc Markdown modifiable, avec ses chiffres principaux.
export function monsterToBeast(m) {
  const abil = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const save = m.save || {};
  const cr = typeof m.cr === 'object' ? m.cr.cr : m.cr;
  const crNum = String(cr).includes('/') ? 0 : Number(cr);
  const pb = Number.isFinite(crNum) ? 2 + Math.floor(Math.max(0, crNum - 1) / 4) : 2;
  const init = typeof m.initiative === 'number' ? m.initiative
    : m.initiative && typeof m.initiative === 'object' ? modOf(m.dex) + (Number(m.initiative.proficiency) || 0) * pb : modOf(m.dex);
  const hpText = m.hp?.special ? m.hp.special : m.hp ? `${m.hp.average} (${m.hp.formula})` : '';
  const lines = [];
  lines.push(`*${(m.size || []).map(s => SIZES[s] || s).join(' or ')} ${typeText(m.type)}${m.alignment ? `, ${alignText(m.alignment)}` : ''}*`);
  lines.push(`**CA ${acText(m.ac)}** · **PV ${hpText}** · **Vitesse ${speedText(m.speed)}** · **Initiative ${sign(init)}**`);
  lines.push('');
  lines.push(`| ${abil.map(a => a.toUpperCase()).join(' | ')} |`);
  lines.push(`|${abil.map(() => '---').join('|')}|`);
  lines.push(`| ${abil.map(a => `${m[a] ?? '—'} (${sign(modOf(m[a]))})${save[a] ? ` · save ${save[a]}` : ''}`).join(' | ')} |`);
  lines.push('');
  const row = (k, v) => { if (v) lines.push(`**${k}** ${v}`); };
  row('Skills', Object.entries(m.skill || {}).filter(([k]) => k !== 'other').map(([k, v]) => `${k.replace(/^\w/, c => c.toUpperCase())} ${v}`).join(', '));
  row('Vulnerabilities', dmgList(m.vulnerable, 'vulnerable'));
  row('Resistances', dmgList(m.resist, 'resist'));
  row('Immunities', [dmgList(m.immune, 'immune'), condList(m.conditionImmune)].filter(Boolean).join('; '));
  row('Senses', [...(m.senses || []).map(plain), m.passive != null ? `Passive Perception ${m.passive}` : ''].filter(Boolean).join(', '));
  row('Languages', (m.languages || []).map(plain).join(', ') || '—');
  row('CR', `${cr ?? '—'} · PB +${pb}`);
  const spellBy = where => (m.spellcasting || []).filter(s => (s.displayAs || 'trait') === where);
  const section = (title, list, where) => {
    const body = [...entriesToLines(list), ...spellcastingLines(spellBy(where))];
    if (!body.length) return;
    lines.push('', `### ${title}`, ...body);
  };
  section('Traits', m.trait, 'trait');
  section('Actions', m.action, 'action');
  section('Bonus Actions', m.bonus, 'bonus');
  section('Reactions', m.reaction, 'reaction');
  if (m.legendary?.length) lines.push('', '### Legendary Actions', ...(m.legendaryHeader || []).map(plain), ...entriesToLines(m.legendary));
  const FOOT = { T: 1, S: 1, M: 1, L: 2, H: 3, G: 4 };
  return normalizeBeast({
    name: m.name, kind: 'markdown', body: lines.join('\n'),
    size: FOOT[(m.size || [])[0]] || 1, init, ac: Number([].concat(m.ac || [])[0]?.ac ?? [].concat(m.ac || [])[0]) || null,
    hp: m.hp?.average ?? null, ref: { name: m.name, source: m.source },
  });
}

// Un modèle vide, à remplir dans l'éditeur.
export const BEAST_TEMPLATE = `*Medium humanoid, neutral*
**CA 13** · **PV 22 (4d8+4)** · **Vitesse 30 ft.** · **Initiative +2**

| STR | DEX | CON | INT | WIS | CHA |
|---|---|---|---|---|---|
| 10 (+0) | 14 (+2) | 12 (+1) | 10 (+0) | 10 (+0) | 10 (+0) |

**Senses** Passive Perception 10
**Languages** Common

### Actions
***Shortsword.*** *Attaque au corps à corps :* +4 pour toucher, allonge 5 ft. *Touché :* 5 (1d6+2) dégâts perforants.`;
