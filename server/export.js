// Export Obsidian : un fichier Markdown par personnage + un fichier de groupe.
// Markdown sobre, pensé comme contexte pour des agents IA : aucun champ vide.
import fs from 'node:fs';
import path from 'node:path';
import { resolveFromApp } from './config.js';
import { bodyOf, featureItems, featuresText } from '../shared/features.js';
import { drawingToSvg } from '../shared/ink.js';
import {
  ABILITIES, ABILITY_SHORT, ORDINAL, SKILLS, abilityMod,
  formatPurse, hitDiceOf, initiative, isPreparedMode, num, passive, preparedCap,
  preparedCount, profBonus, saveBonus, signed, skillBonus, spellAttack, spellDC, spellList,
  itemList, toBase, totalLevel, DEFAULT_CURRENCY, RESET_LABELS, armorClass,
} from '../shared/rules.js';

export const MARKER = 'generated_by: dnd-sheet';

const NOTE_SECTIONS = [
  ['backstory', 'Backstory'],
  ['allies', 'Allies & Organizations'],
  ['session', 'Session notes'],
  ['free', 'Notes'],
];

// ------------------------------------------------------------ Utilitaires

export function safeFileName(s) {
  return String(s || 'Sans nom').replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Sans nom';
}

function link(name) {
  const clean = String(name || '').replace(/[[\]|#^]/g, '').trim();
  return clean ? `[[${clean}]]` : '';
}

const yamlStr = s => JSON.stringify(String(s ?? ''));
const has = s => s != null && String(s).trim() !== '';
const text = s => String(s ?? '').replace(/\r\n/g, '\n').trim();

function dateStr(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dateTimeStr(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${dateStr(ts)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function primaryDenom(denoms, cfg) {
  return denoms.find(d => d.key === cfg.currencyPrimary) || denoms.find(d => d.key === 'pa') || denoms[denoms.length - 1];
}

function purseTotal(purse, denoms, cfg) {
  const prim = primaryDenom(denoms, cfg);
  const total = toBase(purse, denoms) / prim.value;
  return `${Math.round(total * 100) / 100} ${prim.label}`;
}

export function fileBaseFor(doc, cfg) {
  return safeFileName((cfg.fileNamePattern || '{name}').replace('{name}', doc.name || 'Sans nom').replace('{player}', doc.player || ''));
}

function mainClass(doc) {
  const cls = (doc.classes || []).filter(c => c.name);
  return {
    cls: cls.map(c => c.name).join(' / '),
    sub: cls.map(c => c.subclass).filter(Boolean).join(' / '),
    line: cls.map(c => `${c.name} ${num(c.level, 1)}${c.subclass ? `, ${c.subclass}` : ''}`).join(' / '),
  };
}

// ------------------------------------------------------------ Changements

function spellKeyed(doc) {
  const m = new Map();
  for (const s of Object.values(doc.spells || {})) m.set(String(s.name).toLowerCase(), s);
  return m;
}

function itemTotals(doc) {
  const m = new Map();
  for (const it of Object.values(doc.inventory || {})) {
    const k = String(it.name).toLowerCase();
    const cur = m.get(k) || { name: it.name, qty: 0, attuned: false };
    cur.qty += num(it.qty, 1);
    cur.attuned = cur.attuned || !!it.attuned;
    m.set(k, cur);
  }
  return m;
}

export function changesSince(prev, doc, denoms = DEFAULT_CURRENCY, cfg = {}) {
  if (!prev) return ['Premier export de cette fiche.'];
  const out = [];
  if (prev.name !== doc.name) out.push(`Renamed: ${prev.name} → ${doc.name}`);
  const pc = mainClass(prev).line, cc = mainClass(doc).line;
  if (totalLevel(prev) !== totalLevel(doc)) out.push(`Level ${totalLevel(prev)} → ${totalLevel(doc)}${pc !== cc ? ` (${cc})` : ''}`);
  else if (pc !== cc) out.push(`Class: ${pc} → ${cc}`);
  if (num(prev.hp?.max) !== num(doc.hp?.max)) out.push(`Max HP ${num(prev.hp?.max)} → ${num(doc.hp?.max)}`);
  if (armorClass(prev) !== armorClass(doc)) out.push(`AC ${armorClass(prev)} → ${armorClass(doc)}`);
  const abil = ABILITIES.filter(a => num(prev.abilities?.[a]) !== num(doc.abilities?.[a]))
    .map(a => `${ABILITY_SHORT[a]} ${num(prev.abilities?.[a])} → ${num(doc.abilities?.[a])}`);
  if (abil.length) out.push(`Ability scores: ${abil.join(', ')}`);
  const newSkills = SKILLS.filter(s => num(doc.skills?.[s.key]) > num(prev.skills?.[s.key])).map(s => s.name);
  if (newSkills.length) out.push(`New skill proficiencies: ${newSkills.join(', ')}`);

  const ps = spellKeyed(prev), cs = spellKeyed(doc);
  const added = [...cs.values()].filter(s => !ps.has(String(s.name).toLowerCase()));
  const removed = [...ps.values()].filter(s => !cs.has(String(s.name).toLowerCase()));
  if (added.length) out.push(`New spells: ${added.map(s => link(s.name)).join(', ')}`);
  if (removed.length) out.push(`Removed spells: ${removed.map(s => link(s.name)).join(', ')}`);
  if (isPreparedMode(doc)) {
    const nowPrep = [...cs.values()].filter(s => s.prepared && num(s.level) > 0 && ps.has(String(s.name).toLowerCase()) && !ps.get(String(s.name).toLowerCase()).prepared);
    const unPrep = [...cs.values()].filter(s => !s.prepared && num(s.level) > 0 && ps.get(String(s.name).toLowerCase())?.prepared);
    if (nowPrep.length) out.push(`Now prepared: ${nowPrep.map(s => link(s.name)).join(', ')}`);
    if (unPrep.length) out.push(`No longer prepared: ${unPrep.map(s => link(s.name)).join(', ')}`);
  }

  const pi = itemTotals(prev), ci = itemTotals(doc);
  const newItems = [...ci.entries()].filter(([k]) => !pi.has(k)).map(([, v]) => `${link(v.name)}${v.qty !== 1 ? ` ×${v.qty}` : ''}`);
  const goneItems = [...pi.entries()].filter(([k]) => !ci.has(k)).map(([, v]) => link(v.name));
  const qtyItems = [...ci.entries()].filter(([k, v]) => pi.has(k) && pi.get(k).qty !== v.qty).map(([k, v]) => `${link(v.name)} ${pi.get(k).qty} → ${v.qty}`);
  const attuned = [...ci.entries()].filter(([k, v]) => v.attuned && !pi.get(k)?.attuned).map(([, v]) => link(v.name));
  if (newItems.length) out.push(`New items: ${newItems.join(', ')}`);
  if (goneItems.length) out.push(`Items gone: ${goneItems.join(', ')}`);
  if (qtyItems.length) out.push(`Quantities: ${qtyItems.join(', ')}`);
  if (attuned.length) out.push(`Newly attuned: ${attuned.join(', ')}`);

  if (toBase(prev.currency, denoms) !== toBase(doc.currency, denoms)) {
    out.push(`Currency: ${purseTotal(prev.currency, denoms, cfg)} → ${purseTotal(doc.currency, denoms, cfg)}`);
  }
  const resMax = r => Object.fromEntries(Object.values(r || {}).map(x => [String(x.name).toLowerCase(), x]));
  const pr = resMax(prev.resources), cr = resMax(doc.resources);
  const newRes = Object.values(cr).filter(r => !pr[String(r.name).toLowerCase()]).map(r => r.name);
  const maxRes = Object.values(cr).filter(r => pr[String(r.name).toLowerCase()] && num(pr[String(r.name).toLowerCase()].max) !== num(r.max)).map(r => `${r.name} ${num(pr[String(r.name).toLowerCase()].max)} → ${num(r.max)} uses`);
  if (newRes.length) out.push(`New resources: ${newRes.join(', ')}`);
  if (maxRes.length) out.push(`Resources: ${maxRes.join(', ')}`);

  if (text(featuresText(prev)) !== text(featuresText(doc))) out.push('Features & Traits edited');
  if (text(prev.proficiencies) !== text(doc.proficiencies)) out.push('Proficiencies & languages edited');
  const pers = ['traits', 'ideals', 'bonds', 'flaws'].filter(k => text(prev.personality?.[k]) !== text(doc.personality?.[k]));
  if (pers.length) out.push(`Personality edited: ${pers.join(', ')}`);
  const notes = NOTE_SECTIONS.filter(([k]) => text(prev.notes?.[k]) !== text(doc.notes?.[k])).map(([, l]) => l);
  if (notes.length) out.push(`Notes edited: ${notes.join(', ')}`);
  const strokes = o => Object.keys(o || {}).sort().join(',');
  if (strokes(prev.drawings?.notes) !== strokes(doc.drawings?.notes)) out.push('Notes drawing changed');
  if (text(prev.secret?.text) !== text(doc.secret?.text) || text(prev.secret?.goals) !== text(doc.secret?.goals)
    || strokes(prev.secret?.drawing) !== strokes(doc.secret?.drawing)) out.push('Secret page edited (player-hidden)');
  if (!out.length) out.push('Aucun changement notable depuis le dernier export.');
  return out;
}

// ------------------------------------------------------------ Fiche

export function characterMarkdown(doc, { prev = null, session = null, now = Date.now(), cfg = {}, drawings = {} } = {}) {
  const denoms = cfg.currency || DEFAULT_CURRENCY;
  const L = [];
  const { cls, sub, line } = mainClass(doc);
  const lvl = totalLevel(doc);

  L.push('---');
  L.push(`name: ${yamlStr(doc.name)}`);
  if (has(doc.player)) L.push(`player: ${yamlStr(doc.player)}`);
  if (has(cls)) L.push(`class: ${yamlStr(cls)}`);
  if (has(sub)) L.push(`subclass: ${yamlStr(sub)}`);
  L.push(`level: ${lvl}`);
  if (has(doc.race)) L.push(`race: ${yamlStr(doc.race)}`);
  if (has(doc.background)) L.push(`background: ${yamlStr(doc.background)}`);
  L.push(`ac: ${armorClass(doc)}`);
  L.push(`max_hp: ${num(doc.hp?.max)}`);
  L.push('abilities:');
  for (const a of ABILITIES) L.push(`  ${a}: ${num(doc.abilities?.[a], 10)}`);
  L.push(`export_date: ${dateStr(now)}`);
  if (session != null && session !== '') L.push(`session: ${num(session)}`);
  L.push(MARKER);
  L.push('tags:');
  L.push('  - pj');
  L.push('  - fiche-personnage');
  L.push('---');
  L.push('');
  L.push(`# ${doc.name || 'Sans nom'}`);
  L.push('');
  const intro = [line, doc.race, doc.background, has(doc.alignment) ? doc.alignment : null].filter(has);
  L.push(intro.join(' · ') + (has(doc.player) ? `. Joué par ${doc.player}.` : '.'));
  L.push(`Fiche exportée le ${dateStr(now)}${session != null && session !== '' ? `, après la session ${session}` : ''}. La fiche vivante est dans l'application ; ce fichier est réécrit à chaque export.`);
  L.push('');

  L.push('## Changes since last export');
  if (prev?.exportedAt) L.push(`Depuis l'export du ${dateStr(prev.exportedAt)}${prev.session != null ? `, session ${prev.session}` : ''} :`);
  for (const c of changesSince(prev?.data, doc, denoms, cfg)) L.push(`- ${c}`);
  L.push('');

  // ---- Stats
  L.push('## Stats');
  L.push('| Ability | Score | Mod | Save |');
  L.push('| :-- | --: | --: | --: |');
  for (const a of ABILITIES) {
    L.push(`| ${ABILITY_SHORT[a]} | ${num(doc.abilities?.[a], 10)} | ${signed(abilityMod(doc, a))} | ${signed(saveBonus(doc, a))}${doc.saves?.[a] ? ' proficient' : ''} |`);
  }
  L.push('');
  L.push(`- Proficiency Bonus: ${signed(profBonus(doc))}`);
  if (num(doc.saveBonus)) L.push(`- Bonus to all saving throws: ${signed(doc.saveBonus)}`);
  const skills = SKILLS.filter(s => num(doc.skills?.[s.key]) > 0)
    .map(s => `${s.name} ${signed(skillBonus(doc, s.key))}${num(doc.skills[s.key]) >= 2 ? ' expertise' : ''}`);
  if (skills.length) L.push(`- Skill proficiencies: ${skills.join(', ')}`);
  L.push(`- Passive Perception ${passive(doc, 'perception')} · Passive Insight ${passive(doc, 'insight')} · Passive Investigation ${passive(doc, 'investigation')}`);
  if (doc.inspiration) L.push('- Heroic Inspiration: yes');
  if (has(doc.proficiencies)) {
    L.push('');
    L.push('### Other proficiencies & languages');
    L.push(text(doc.proficiencies));
  }
  const pers = [['traits', 'Personality traits'], ['ideals', 'Ideals'], ['bonds', 'Bonds'], ['flaws', 'Flaws']]
    .filter(([k]) => has(doc.personality?.[k]));
  if (pers.length || has(doc.appearance)) {
    L.push('');
    L.push('### Personality');
    if (has(doc.appearance)) L.push(`- Appearance: ${text(doc.appearance).replace(/\n+/g, ' ')}`);
    for (const [k, label] of pers) L.push(`- ${label}: ${text(doc.personality[k]).replace(/\n+/g, ' ')}`);
  }
  L.push('');

  // ---- Combat
  L.push('## Combat');
  L.push(`- AC ${armorClass(doc)} · Initiative ${signed(initiative(doc))}${has(doc.speed) ? ` · Speed ${doc.speed}` : ''}`);
  L.push(`- HP ${num(doc.hp?.current)}/${num(doc.hp?.max)}${num(doc.hp?.temp) ? `, ${num(doc.hp.temp)} temporary` : ''}`);
  const hd = hitDiceOf(doc);
  if (hd.length) L.push(`- Hit Dice: ${hd.map(d => `${d.max - d.used}/${d.max} ${d.die}`).join(', ')} remaining`);
  if (num(doc.deathSaves?.success) || num(doc.deathSaves?.fail)) L.push(`- Death saves: ${num(doc.deathSaves.success)} successes, ${num(doc.deathSaves.fail)} failures`);
  if ((doc.conditions || []).length) L.push(`- Conditions: ${doc.conditions.join(', ')}`);
  if (num(doc.exhaustion)) L.push(`- Exhaustion level ${num(doc.exhaustion)}`);
  if (doc.concentration?.name) L.push(`- Concentrating on ${link(doc.concentration.name)}`);
  const attacks = itemList(doc.attacks).filter(a => has(a.name));
  if (attacks.length) {
    L.push('');
    L.push('### Attacks');
    for (const a of attacks) {
      const bits = [];
      if (has(a.bonus)) bits.push(`${a.bonus} to hit`);
      if (has(a.damage)) bits.push(`${a.damage}${has(a.type) ? ` ${a.type}` : ''}`);
      if (has(a.notes)) bits.push(text(a.notes).replace(/\n+/g, ' '));
      L.push(`- **${a.name}**${bits.length ? `: ${bits.join(' · ')}` : ''}`);
    }
  }
  L.push('');

  // ---- Features & Resources
  const resources = itemList(doc.resources).filter(r => has(r.name));
  const feats = featureItems(doc);
  if (resources.length || has(doc.features) || feats.length) {
    L.push('## Features & Resources');
    if (resources.length) {
      for (const r of resources) {
        const max = num(r.max);
        const left = Math.max(0, max - num(r.used));
        L.push(`- ${r.name}: ${max ? `${left}/${max} uses left` : 'no fixed uses'}${r.reset && r.reset !== 'none' ? `, recharge : ${RESET_LABELS[r.reset].toLowerCase()}` : ''}${has(r.notes) ? ` · ${text(r.notes)}` : ''}`);
      }
    }
    if (has(doc.features) || feats.length) {
      L.push('');
      L.push('### Features & Traits');
      if (has(doc.features)) L.push(text(doc.features));
      let group = null;
      for (const f of feats) {
        if (f.group !== group) { group = f.group; if (group) L.push('', `**${group}**`); }
        const body = bodyOf(f);
        L.push(`- **${f.name}**${body ? ` : ${body.replace(/\n+/g, ' ')}` : ''}`);
      }
    }
    L.push('');
  }

  // ---- Spells
  const spells = spellList(doc);
  const sc = doc.spellcasting || {};
  const slotLevels = [];
  for (let l = 1; l <= 9; l++) if (num(sc.slots?.[l]?.max)) slotLevels.push(l);
  const hasPact = num(sc.pact?.max) > 0;
  if (spells.length || slotLevels.length || hasPact) {
    L.push('## Spells');
    if (sc.mode !== 'none') {
      L.push(`- Spellcasting ability ${ABILITY_SHORT[sc.ability] || sc.ability} · Spell save DC ${spellDC(doc)} · Spell attack ${signed(spellAttack(doc))}`);
    }
    if (isPreparedMode(doc)) L.push(`- Prepared: ${preparedCount(doc)}/${preparedCap(doc)}`);
    if (slotLevels.length) L.push(`- Spell slots available: ${slotLevels.map(l => `${ORDINAL[l]} ${num(sc.slots[l].max) - num(sc.slots[l].used)}/${num(sc.slots[l].max)}`).join(' · ')}`);
    if (hasPact) L.push(`- Pact Magic slots: ${num(sc.pact.max) - num(sc.pact.used)}/${num(sc.pact.max)} available, level ${num(sc.pact.level)}, recharge on a Short Rest`);
    const tag = s => [s.concentration ? '_concentration_' : '', s.ritual ? '_ritual_' : '', s.always ? '_always prepared_' : ''].filter(Boolean).join(' ');
    const fmt = s => `${link(s.name)}${tag(s) ? ` ${tag(s)}` : ''}`;
    const byLevel = (list) => {
      const out = [];
      for (let l = 1; l <= 9; l++) {
        const at = list.filter(s => num(s.level) === l);
        if (at.length) out.push(`- ${ORDINAL[l]}: ${at.map(fmt).join(', ')}`);
      }
      return out;
    };
    const cantrips = spells.filter(s => num(s.level) === 0);
    const leveled = spells.filter(s => num(s.level) > 0);
    if (cantrips.length) { L.push(''); L.push('### Cantrips'); L.push(cantrips.map(fmt).join(', ')); }
    if (isPreparedMode(doc)) {
      const prep = leveled.filter(s => s.prepared || s.always);
      const book = leveled.filter(s => !s.prepared && !s.always);
      if (prep.length) { L.push(''); L.push('### Prepared'); L.push(...byLevel(prep)); }
      if (book.length) { L.push(''); L.push('### Spellbook, not prepared'); L.push(...byLevel(book)); }
    } else if (leveled.length) {
      L.push(''); L.push('### Known'); L.push(...byLevel(leveled));
    }
    const noted = spells.filter(s => has(s.notes));
    if (noted.length) {
      L.push(''); L.push('### Spell notes');
      for (const s of noted) L.push(`- ${link(s.name)}: ${text(s.notes).replace(/\n+/g, ' ')}`);
    }
    L.push('');
  }

  // ---- Inventory
  const items = itemList(doc.inventory).filter(i => has(i.name));
  if (items.length) {
    L.push('## Inventory');
    const att = items.filter(i => i.attuned);
    if (att.length) L.push(`- Attuned: ${att.map(i => link(i.name)).join(', ')} · ${att.length}/3`);
    L.push('');
    for (const i of items) {
      const bits = [];
      if (num(i.qty, 1) !== 1) bits.push(`×${num(i.qty, 1)}`);
      if (i.charges && num(i.charges.max)) bits.push(`${num(i.charges.max) - num(i.charges.used)}/${num(i.charges.max)} charges`);
      if (i.attuned) bits.push('attuned');
      else if (i.attunement) bits.push('requires attunement');
      if (i.equipped) bits.push('equipped');
      if (i.stored) bits.push('stored, not carried');
      L.push(`- ${link(i.name)}${bits.length ? ` · ${bits.join(' · ')}` : ''}${has(i.notes) ? ` — ${text(i.notes).replace(/\n+/g, ' ')}` : ''}`);
    }
    L.push('');
  }

  // ---- Currency
  if (toBase(doc.currency, denoms) > 0) {
    L.push('## Currency');
    L.push(`- ${formatPurse(doc.currency, denoms)} · total ${purseTotal(doc.currency, denoms, cfg)}`);
    L.push('');
  }

  // ---- Notes
  const notes = NOTE_SECTIONS.filter(([k]) => has(doc.notes?.[k]));
  if (notes.length || drawings.notes) {
    L.push('## Notes');
    for (const [k, label] of notes) {
      L.push(`### ${label}`);
      L.push(text(doc.notes[k]));
      L.push('');
    }
    if (drawings.notes) {
      L.push('### Drawing');
      L.push(`![[${drawings.notes}]]`);
      L.push('');
    }
  }

  // ---- Secret
  const sec = doc.secret || {};
  if (has(sec.text) || has(sec.goals) || drawings.secret) {
    L.push('## Secret');
    L.push('> [!warning] Player-hidden');
    L.push(`> Page secrète : connue seulement de ${doc.player || 'ce joueur'} et du MJ. Ne jamais la révéler aux autres joueurs.`);
    L.push('');
    if (has(sec.text)) { L.push(text(sec.text)); L.push(''); }
    if (has(sec.goals)) { L.push('### Hidden goals'); L.push(text(sec.goals)); L.push(''); }
    if (drawings.secret) { L.push('### Secret drawing'); L.push(`![[${drawings.secret}]]`); L.push(''); }
  }

  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ------------------------------------------------------------ Groupe

export function partyMarkdown(chars, party, { prev = null, session = null, now = Date.now(), cfg = {}, links = {} } = {}) {
  const denoms = cfg.currency || DEFAULT_CURRENCY;
  const L = [];
  L.push('---');
  L.push(`export_date: ${dateStr(now)}`);
  if (session != null && session !== '') L.push(`session: ${num(session)}`);
  L.push(MARKER);
  L.push('tags:');
  L.push('  - groupe');
  L.push('---');
  L.push('');
  L.push('# Groupe');
  L.push('');
  L.push(`Réserve commune, fonds du groupe et mouvements d'objets, exportés le ${dateStr(now)}${session != null && session !== '' ? ` après la session ${session}` : ''}.`);
  L.push('');
  if (chars.length) {
    L.push('## Party');
    L.push('| Character | Player | Class | Level | AC | HP |');
    L.push('| :-- | :-- | :-- | --: | --: | --: |');
    for (const c of chars) {
      const d = c.data;
      const name = links[c.id] ? `[[${links[c.id]}\\|${d.name}]]` : d.name;
      L.push(`| ${name} | ${d.player || ''} | ${mainClass(d).line} | ${totalLevel(d)} | ${armorClass(d)} | ${num(d.hp?.current)}/${num(d.hp?.max)} |`);
    }
    L.push('');
  }
  L.push('## Party fund');
  L.push(toBase(party.fund, denoms) > 0 ? `- ${formatPurse(party.fund, denoms)} · total ${purseTotal(party.fund, denoms, cfg)}` : '- Vide.');
  L.push('');
  const stash = itemList(party.stash).filter(i => has(i.name));
  L.push('## Shared stash');
  if (!stash.length) L.push('- Vide.');
  for (const i of stash) {
    const bits = [];
    if (num(i.qty, 1) !== 1) bits.push(`×${num(i.qty, 1)}`);
    if (i.charges && num(i.charges.max)) bits.push(`${num(i.charges.max) - num(i.charges.used)}/${num(i.charges.max)} charges`);
    L.push(`- ${link(i.name)}${bits.length ? ` · ${bits.join(' · ')}` : ''}${has(i.notes) ? ` — ${text(i.notes).replace(/\n+/g, ' ')}` : ''}`);
  }
  L.push('');
  const log = Object.values(party.log || {}).sort((a, b) => num(a.at) - num(b.at));
  const since = prev?.exportedAt || 0;
  const fresh = log.filter(e => num(e.at) > since);
  const older = log.filter(e => num(e.at) <= since).slice(-50);
  const fmt = e => `- ${dateTimeStr(e.at)} · ${e.who} · ${e.text}`;
  L.push('## Item movements since last export');
  if (fresh.length) L.push(...fresh.map(fmt)); else L.push('- Aucun mouvement.');
  L.push('');
  if (older.length) {
    L.push('## Earlier movements');
    L.push(...older.map(fmt));
    L.push('');
  }
  return L.join('\n').trimEnd() + '\n';
}

// ------------------------------------------------------------ Écriture

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function isOurs(file) {
  try {
    if (file.endsWith('.svg')) return true;
    return fs.readFileSync(file, 'utf8').slice(0, 2000).includes(MARKER);
  } catch { return false; }
}

function stamp(ts) {
  const sec = String(new Date(ts).getSeconds()).padStart(2, '0');
  return `${dateTimeStr(ts).replace(' ', '_').replace(':', 'h')}m${sec}`;
}

export function suggestSession(cfg) {
  if (!cfg.sessionsPath) return null;
  try {
    const dir = resolveFromApp(cfg.sessionsPath);
    const nums = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => /session\s*(\d+)/i.exec(e.name)?.[1]).filter(Boolean).map(Number);
    return nums.length ? Math.max(...nums) : null;
  } catch { return null; }
}

// chars : [{ id, data }] ; party : { data }
export function runExport({ chars, party, db, cfg, session = null, only = null, now = Date.now() }) {
  // Les fiches d'une autre campagne n'entrent jamais dans le coffre : il sert de
  // contexte à sa propre campagne, et un personnage d'ailleurs y créerait de la confusion.
  chars = chars.filter(c => !c.data?.campaign);
  const exportDir = resolveFromApp(cfg.exportPath);
  const attachDir = path.join(exportDir, cfg.attachmentsFolder || 'attachments');
  const backupDir = path.join(resolveFromApp(cfg.backupDir || 'backups'), 'exports', stamp(now));
  const written = [];
  const removed = [];
  const fileMap = db.getSetting('exportFiles', {});
  const targets = only ? chars.filter(c => c.id === only) : chars;
  if (only && !targets.length) throw new Error('Personnage introuvable');

  const links = {};
  for (const c of chars) links[c.id] = fileBaseFor(c.data, cfg);

  for (const c of targets) {
    const base = links[c.id];
    const prev = db.getSnapshot(c.id);
    const drawings = {};
    const svgFiles = [];
    for (const [layer, strokes] of [['notes', c.data.drawings?.notes], ['secret', c.data.secret?.drawing]]) {
      const svg = drawingToSvg(strokes);
      if (!svg) continue;
      const name = `${base} - ${layer === 'notes' ? 'Notes' : 'Secret'}.svg`;
      drawings[layer] = name;
      svgFiles.push([path.join(attachDir, name), svg]);
    }
    const md = characterMarkdown(c.data, { prev, session, now, cfg, drawings });
    const mdFile = path.join(exportDir, `${base}.md`);

    // Renommage du personnage : on retire l'ancien fichier généré (il reste dans la sauvegarde).
    const old = fileMap[c.id];
    if (old) {
      for (const f of [old.md, ...(old.svg || [])]) {
        if (f && !svgFiles.some(([p]) => p === f) && f !== mdFile && fs.existsSync(f) && isOurs(f)) {
          fs.rmSync(f);
          removed.push(f);
        }
      }
    }
    writeAtomic(mdFile, md);
    written.push(mdFile);
    for (const [p, svg] of svgFiles) { writeAtomic(p, svg); written.push(p); }
    fileMap[c.id] = { md: mdFile, svg: svgFiles.map(([p]) => p) };
    db.putSnapshot(c.id, c.data, session);
  }

  if (!only) {
    const prevParty = db.getSnapshot('party');
    const md = partyMarkdown(chars, party.data, { prev: prevParty, session, now, cfg, links });
    const file = path.join(exportDir, `${safeFileName(cfg.partyFileName || 'Groupe')}.md`);
    writeAtomic(file, md);
    written.push(file);
    db.putSnapshot('party', party.data, session);
  }

  // Copie horodatée hors du coffre.
  for (const f of written) {
    const rel = path.relative(exportDir, f);
    const dest = path.join(backupDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(f, dest);
  }
  db.setSetting('exportFiles', fileMap);
  const summary = { at: now, session, files: written, relFiles: written.map(f => path.relative(exportDir, f)), removed, backupDir, exportDir, only };
  db.setSetting('lastExport', summary);
  return summary;
}
