// Rendu des « entries » 5etools en HTML sûr (tout le texte est échappé) ou en texte brut.
// Les balises {@tag ...} sont résolues ici : chaque renvoi devient un lien interne
// (ouvert dans l'application, jamais sur le site), chaque formule de dés se lance d'un toucher.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const ATK = {
  mw: 'Melee Weapon Attack:', rw: 'Ranged Weapon Attack:', ms: 'Melee Spell Attack:', rs: 'Ranged Spell Attack:',
  'mw,rw': 'Melee or Ranged Weapon Attack:', 'ms,rs': 'Melee or Ranged Spell Attack:', m: 'Melee Attack:', r: 'Ranged Attack:',
};
const ATKR = { m: 'Melee Attack Roll:', r: 'Ranged Attack Roll:', 'm,r': 'Melee or Ranged Attack Roll:' };
const ABIL = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const FIRST_PART = new Set(['5etools', 'quickref', 'link', 'loader', 'footnote', 'area', 'homebrew', 'filter']);

// Balise 5etools → type d'entrée de l'application (voir FiveETools.entry côté serveur).
const LINK_KINDS = {
  spell: 'spell', item: 'item', creature: 'monster', condition: 'condition', status: 'status', disease: 'disease',
  feat: 'feat', optfeature: 'opt', race: 'race', background: 'background', class: 'class', variantrule: 'variantrule',
  action: 'action', sense: 'sense', skill: 'skill', language: 'language', deity: 'deity', reward: 'reward', trap: 'trap',
  hazard: 'hazard', object: 'object', vehicle: 'vehicle', psionic: 'psionic', cult: 'cult', boon: 'boon', table: 'table',
  deck: 'deck', recipe: 'recipe', facility: 'facility', charoption: 'charoption', itemMastery: 'itemMastery',
  legroup: 'legendaryGroup',
};

// Une formule lançable : « 2d6 + 3 », « d20 », « 1d8 » ; sinon rien.
function rollable(expr) {
  const s = String(expr || '').split(/[;|]/)[0].replace(/\s+/g, '').replace(/×/g, '*');
  return /^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/i.test(s) ? s : '';
}

function diceSpan(disp, roll, html) {
  if (!html) return disp;
  const r = rollable(roll);
  return r ? `<span class="dice roll" data-roll="${esc(r)}" title="Lancer ${esc(r)}">${esc(disp)}</span>` : `<span class="dice">${esc(disp)}</span>`;
}

function refLink(kind, name, source, disp, html, extra) {
  if (!html) return disp;
  return `<a class="ref" data-k="${esc(kind)}" data-n="${esc(name)}" data-s="${esc(source || '')}"${extra ? ` data-x="${esc(JSON.stringify(extra))}"` : ''}>${renderString(disp, true)}</a>`;
}

// Découpe une chaîne en morceaux texte / balise en respectant l'imbrication.
function tokenize(str) {
  const out = [];
  let i = 0, buf = '';
  while (i < str.length) {
    if (str[i] === '{' && str[i + 1] === '@') {
      let depth = 0, j = i;
      for (; j < str.length; j++) {
        if (str[j] === '{') depth++;
        else if (str[j] === '}' && --depth === 0) break;
      }
      if (j >= str.length) { buf += str.slice(i); break; }
      if (buf) { out.push({ text: buf }); buf = ''; }
      const inner = str.slice(i + 2, j);
      const sp = inner.search(/\s/);
      out.push({ tag: sp < 0 ? inner : inner.slice(0, sp), body: sp < 0 ? '' : inner.slice(sp + 1) });
      i = j + 1;
    } else buf += str[i++];
  }
  if (buf) out.push({ text: buf });
  return out;
}

function tagText(tag, body, html) {
  const parts = body.split('|');
  const inner = s => renderString(s, html);
  switch (tag) {
    case 'b': case 'bold': return html ? `<b>${inner(body)}</b>` : inner(body);
    case 'i': case 'italic': return html ? `<i>${inner(body)}</i>` : inner(body);
    case 'u': case 'underline': return html ? `<u>${inner(body)}</u>` : inner(body);
    case 's': case 'strike': return html ? `<s>${inner(body)}</s>` : inner(body);
    case 'note': return html ? `<i class="note">${inner(body)}</i>` : inner(body);
    case 'code': return html ? `<code>${esc(body)}</code>` : body;
    case 'hit': case 'd20': {
      const n = Number(parts[0]);
      const disp = parts[1] || (n >= 0 ? `+${n}` : `${n}`);
      return Number.isFinite(n) ? diceSpan(disp, `1d20${n >= 0 ? '+' : ''}${n}`, html) : esc(disp);
    }
    case 'dc': return esc(`DC ${parts[1] || parts[0]}`);
    case 'chance': return esc(parts[1] || `${parts[0]}%`);
    case 'recharge': return esc(`(Recharge ${parts[0] ? `${parts[0]}–6` : '6'})`);
    case 'dice': case 'damage': case 'autodice':
      return diceSpan(parts[1] || parts[0], parts[0], html);
    case 'scaledamage': case 'scaledice':
      return diceSpan(parts[2] || parts[0], parts[2] || parts[0], html);
    case 'atk': return esc(ATK[parts[0]] || 'Attack:');
    case 'atkr': return esc(ATKR[parts[0]] || 'Attack Roll:');
    case 'actSave': return esc(`${ABIL[parts[0]] || parts[0]} Saving Throw:`);
    case 'actSaveFail': return esc(parts[0] ? `Failure by ${parts[0]} or More:` : 'Failure:');
    case 'actSaveSuccess': return esc('Success:');
    case 'actSaveSuccessOrFail': return esc('Failure or Success:');
    case 'actTrigger': return esc('Trigger:');
    case 'actResponse': return esc('Response:');
    case 'h': return esc('Hit: ');
    case 'm': return esc('Miss: ');
    case 'hom': return esc('Hit or Miss: ');
    case 'deity': // {@deity Nom|Panthéon|Source|Texte}
      return refLink('deity', parts[0], parts[2] || '', parts[3] || parts[0], html);
    case 'classFeature': { // {@classFeature Nom|Classe|SourceClasse|Niveau|Source|Texte}
      const [n, cls, cs, lv, src, disp] = parts;
      return refLink('classFeature', n, src || cs || 'PHB', disp || n, html, { cls, cs: cs || 'PHB', lv });
    }
    case 'subclassFeature': { // {@subclassFeature Nom|Classe|SourceClasse|SousClasse|SourceSous|Niveau|Source|Texte}
      const [n, cls, cs, sub, ss, lv, src, disp] = parts;
      return refLink('subclassFeature', n, src || ss || 'PHB', disp || n, html, { cls, cs: cs || 'PHB', sub, ss: ss || 'PHB', lv });
    }
    case 'filter': // {@filter Texte|catégorie|clé=valeur|…}
      return html ? `<a class="ref" data-filter="${esc(parts.slice(1).join('|'))}">${renderString(parts[0], true)}</a>` : renderString(parts[0], false);
    case 'book': case 'adventure': // {@book Texte|SOURCE|chapitre|section}
      return html ? `<a class="ref" data-book="${esc([tag, parts[1] || '', parts[2] ?? '', parts[3] || ''].join('|'))}">${renderString(parts[0], true)}</a>` : renderString(parts[0], false);
    default: {
      if (LINK_KINDS[tag]) {
        const name = parts[0];
        return refLink(LINK_KINDS[tag], name, parts[1] || '', parts[2] || name, html);
      }
      const disp = FIRST_PART.has(tag) ? parts[0] : (parts[2] || parts[0]);
      return html ? `<span class="tag-${esc(tag)}">${renderString(disp, true)}</span>` : renderString(disp, false);
    }
  }
}

export function renderString(str, html = true) {
  return tokenize(String(str ?? '')).map(t => t.text != null ? (html ? esc(t.text) : t.text) : tagText(t.tag, t.body, html)).join('');
}

function cell(c, html, opts) {
  if (c && typeof c === 'object' && c.type === 'cell') {
    if (c.roll) {
      const r = c.roll;
      return esc(r.exact != null ? String(r.exact) : `${r.min}–${r.max}`);
    }
    return renderEntries(c.entry ?? c.entries ?? '', html, 0, opts);
  }
  return typeof c === 'object' ? renderEntries(c, html, 0, opts) : renderString(c, html);
}

// opts.headings : les entrées nommées deviennent des titres (lecteur de livres).
export function renderEntries(e, html = true, depth = 0, opts = {}) {
  if (e == null) return '';
  if (typeof e === 'string') return html ? `<p>${renderString(e)}</p>` : `${renderString(e, false)}\n`;
  if (Array.isArray(e)) return e.map(x => renderEntries(x, html, depth, opts)).join('');
  if (typeof e !== 'object') return html ? `<p>${esc(e)}</p>` : `${e}\n`;
  const kids = x => renderEntries(x, html, depth + 1, opts);
  const name = e.name ? (html ? `<b class="entry-name">${renderString(e.name)}.</b> ` : `${renderString(e.name, false)}. `) : '';
  switch (e.type) {
    case 'entries': case 'section': case 'inset': case 'insetReadaloud': case 'variant': case 'variantInner': case 'variantSub': case 'quote': {
      const body = kids(e.entries || []);
      if (!html) return name + body;
      const cls = e.type === 'inset' || e.type === 'insetReadaloud' || e.type === 'variant' ? 'inset' : e.type === 'quote' ? 'quote' : 'entries';
      if (opts.headings && e.name && cls === 'entries') {
        const h = Math.min(6, 3 + depth);
        return `<div class="entries"><h${h} class="sec-title" data-sec="${esc(e.name)}">${renderString(e.name)}</h${h}>${body}</div>`;
      }
      // Le nom s'insère au début du premier paragraphe, comme dans le livre.
      const merged = name && body.startsWith('<p>') ? `<p>${name}${body.slice(3)}` : name + body;
      return `<div class="${cls}">${merged}${e.by ? `<p class="by">— ${renderString(e.by)}</p>` : ''}</div>`;
    }
    case 'list': case 'options': {
      const items = (e.items || e.entries || []).map(it => {
        if (it && typeof it === 'object' && (it.type === 'item' || it.type === 'itemSub' || it.type === 'itemSpell')) {
          const n = it.name ? (html ? `<b>${renderString(it.name)}</b> ` : `${renderString(it.name, false)} `) : '';
          const body = it.entry != null ? renderString(it.entry, html) : (it.entries || []).map(x => typeof x === 'string' ? renderString(x, html) : kids(x)).join(' ');
          return html ? `<li>${n}${body}</li>` : `- ${n}${body}\n`;
        }
        return html ? `<li>${typeof it === 'string' ? renderString(it) : kids(it)}</li>` : `- ${typeof it === 'string' ? renderString(it, false) : kids(it)}\n`;
      }).join('');
      return html ? `<ul>${items}</ul>` : items;
    }
    case 'item': case 'itemSub': case 'itemSpell': {
      const body = e.entry != null ? renderString(e.entry, html) : kids(e.entries || []);
      return html ? `<p>${name}${body.replace(/^<p>|<\/p>$/g, '')}</p>` : `${name}${body}\n`;
    }
    case 'table': {
      const labels = e.colLabels || [];
      const rows = e.rows || [];
      if (!html) {
        const lines = [];
        if (e.caption) lines.push(renderString(e.caption, false));
        if (labels.length) lines.push(labels.map(l => renderString(l, false)).join(' | '));
        for (const r of rows) lines.push((Array.isArray(r) ? r : r.row || []).map(c => cell(c, false, opts).trim()).join(' | '));
        return lines.join('\n') + '\n';
      }
      const head = labels.length ? `<thead><tr>${labels.map(l => `<th>${renderString(l)}</th>`).join('')}</tr></thead>` : '';
      const body = rows.map(r => `<tr>${(Array.isArray(r) ? r : r.row || []).map(c => `<td>${cell(c, true, opts).replace(/^<p>|<\/p>$/g, '')}</td>`).join('')}</tr>`).join('');
      const caption = e.caption || e.name;
      return `<div class="t5e-wrap"><table class="t5e">${caption ? `<caption>${renderString(caption)}</caption>` : ''}${head}<tbody>${body}</tbody></table></div>`;
    }
    case 'tableGroup': return kids(e.tables || []);
    case 'inline': case 'inlineBlock': {
      const s = (e.entries || []).map(x => typeof x === 'string' ? renderString(x, html) : kids(x)).join('');
      return html ? `<p>${s}</p>` : `${s}\n`;
    }
    case 'link': return html ? esc(e.text || '') : (e.text || '');
    case 'abilityDc': {
      const ab = (e.attributes || []).map(a => ABIL[a] || a).join(' or ');
      const t = `${e.name} save DC = 8 + your proficiency bonus + your ${ab} modifier`;
      return html ? `<p class="center"><b>${esc(t)}</b></p>` : `${t}\n`;
    }
    case 'abilityAttackMod': {
      const ab = (e.attributes || []).map(a => ABIL[a] || a).join(' or ');
      const t = `${e.name} attack modifier = your proficiency bonus + your ${ab} modifier`;
      return html ? `<p class="center"><b>${esc(t)}</b></p>` : `${t}\n`;
    }
    case 'abilityGeneric': {
      const t = renderString(e.text || '', html);
      return html ? `<p class="center"><b>${e.name ? `${renderString(e.name)} = ` : ''}${t}</b></p>` : `${t}\n`;
    }
    case 'statblock': case 'statblockInline': {
      // Bloc de créature (ou autre) cité dans un texte : un lien qui l'ouvre.
      const kind = LINK_KINDS[e.tag || e.prop || 'creature'] || 'monster';
      const n = e.name || e.data?.name || '';
      return html ? `<p class="statblock-ref">${refLink(kind, n, e.source || e.data?.source || '', `▸ ${n}`, true)}</p>` : `${n}\n`;
    }
    case 'spellcasting': return html ? renderSpellcasting([e]) : '';
    case 'hr': return html ? '<hr>' : '\n';
    case 'image': case 'gallery': case 'refClassFeature': case 'refSubclassFeature': case 'refOptionalfeature': case 'flowchart':
      return '';
    default: {
      // Actions et traits de créature ({ name, entries }) : le nom ouvre le premier paragraphe.
      const body = e.entries ? kids(e.entries) : e.entry ? renderEntries(e.entry, html, depth + 1, opts) : '';
      if (!body) return '';
      return html && name && body.startsWith('<p>') ? `<p>${name}${body.slice(3)}` : name + body;
    }
  }
}

export function toText(entries) {
  return renderEntries(entries, false).replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------- Bloc de statistiques

export const SIZES = { T: 'Tiny', S: 'Small', M: 'Medium', L: 'Large', H: 'Huge', G: 'Gargantuan', V: 'Varies' };
const ALIGN = { L: 'lawful', N: 'neutral', C: 'chaotic', G: 'good', E: 'evil', U: 'unaligned', A: 'any alignment' };

function sign(n) { return n >= 0 ? `+${n}` : `${n}`; }
function modOf(score) { return Math.floor(((Number(score) || 10) - 10) / 2); }

export function alignText(a) {
  if (!a) return '';
  if (!Array.isArray(a)) return String(a);
  if (a.some(x => typeof x === 'object')) return a.map(x => (typeof x === 'object' ? (x.special || alignText(x.alignment)) + (x.chance ? ` (${x.chance}%)` : '') : ALIGN[x] || x)).join(' or ');
  if (a.length === 1) return ALIGN[a[0]] || a[0];
  if (a.join('') === 'NXCNYLNYCNXGNXE' || a.length >= 5) return 'any alignment';
  return a.map(x => ALIGN[x] || x).join(' ');
}

export function typeText(t) {
  if (!t) return '';
  if (typeof t === 'string') return t;
  const base = typeof t.type === 'string' ? t.type : (t.type?.choose || []).join(' or ');
  const tags = (t.tags || []).map(x => (typeof x === 'string' ? x : x.tag)).filter(Boolean);
  return `${t.swarmSize ? `swarm of ${SIZES[t.swarmSize] || t.swarmSize} ` : ''}${base}${tags.length ? ` (${tags.join(', ')})` : ''}`;
}

export function acText(ac) {
  return [].concat(ac || []).map(x => {
    if (typeof x === 'number') return String(x);
    if (x.special) return x.special;
    return `${x.ac}${x.from ? ` (${x.from.map(f => renderString(f, false)).join(', ')})` : ''}${x.condition ? ` ${renderString(x.condition, false)}` : ''}`;
  }).join(', ');
}

export function speedText(sp) {
  if (sp == null) return '';
  if (typeof sp === 'number') return `${sp} ft.`;
  const one = v => (typeof v === 'number' ? `${v} ft.` : v === true ? 'equal to walking speed' : `${v.number} ft.${v.condition ? ` ${renderString(v.condition, false)}` : ''}`);
  const parts = [];
  if (sp.walk != null) parts.push(one(sp.walk));
  for (const k of ['burrow', 'climb', 'fly', 'swim']) if (sp[k] != null) parts.push(`${k} ${one(sp[k])}${k === 'fly' && sp.canHover ? ' (hover)' : ''}`);
  return parts.join(', ');
}

export function dmgList(list, key) {
  return [].concat(list || []).map(x => {
    if (typeof x === 'string') return x;
    if (x.special) return x.special;
    const inner = x[key] ? dmgList(x[key], key) : '';
    return `${x.preNote ? `${x.preNote} ` : ''}${inner}${x.note ? ` ${x.note}` : ''}`;
  }).join('; ');
}

export function condList(list) {
  return [].concat(list || []).map(x => (typeof x === 'string' ? x : x.conditionImmune ? condList(x.conditionImmune) + (x.note ? ` ${x.note}` : '') : x.special || '')).join(', ');
}

function spellRefs(list) {
  return [].concat(list || []).map(s => renderString(typeof s === 'string' ? s : s.entry || '')).join(', ');
}

function renderSpellcasting(list) {
  return (list || []).map(sc => {
    const lines = [];
    if (sc.will) lines.push(`<li><b>At will:</b> ${spellRefs(sc.will)}</li>`);
    for (const [n, spells] of Object.entries(sc.daily || {})) lines.push(`<li><b>${esc(n.replace('e', ''))}/day${n.endsWith('e') ? ' each' : ''}:</b> ${spellRefs(spells)}</li>`);
    for (const [lvl, d] of Object.entries(sc.spells || {})) {
      const head = lvl === '0' ? 'Cantrips (at will)' : `Level ${lvl}${d.slots != null ? ` (${d.slots} slot${d.slots > 1 ? 's' : ''})` : ''}`;
      lines.push(`<li><b>${esc(head)}:</b> ${spellRefs(d.spells)}</li>`);
    }
    for (const [period, groups] of Object.entries({ rest: sc.rest, weekly: sc.weekly, monthly: sc.monthly, yearly: sc.yearly })) {
      for (const [n, spells] of Object.entries(groups || {})) lines.push(`<li><b>${esc(n.replace('e', ''))}/${esc(period)}:</b> ${spellRefs(spells)}</li>`);
    }
    return `<div class="entries"><p><b class="entry-name">${renderString(sc.name || 'Spellcasting')}.</b> ${(sc.headerEntries || []).map(x => renderString(x)).join(' ')}</p>${lines.length ? `<ul class="sc-list">${lines.join('')}</ul>` : ''}${(sc.footerEntries || []).map(x => `<p>${renderString(x)}</p>`).join('')}</div>`;
  }).join('');
}

// Bloc de statistiques complet d'une créature, en HTML.
export function renderMonster(m) {
  if (!m) return '';
  const abil = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const save = m.save || {};
  const row = (k, v) => (v ? `<p class="sb-line"><b>${esc(k)}</b> ${v}</p>` : '');
  const sec = (title, list, intro) => (list?.length || intro ? `<h4 class="sb-sec">${esc(title)}</h4>${intro ? `<p>${intro}</p>` : ''}${renderEntries(list || [])}` : '');
  const cr = typeof m.cr === 'object' ? `${m.cr.cr}${m.cr.lair ? ` (${m.cr.lair} in lair)` : ''}` : m.cr;
  const pb = (() => {
    const v = typeof m.cr === 'object' ? m.cr.cr : m.cr;
    const n = String(v).includes('/') ? 0 : Number(v);
    return Number.isFinite(n) ? 2 + Math.floor(Math.max(0, n - 1) / 4) : null;
  })();
  const spellBy = where => (m.spellcasting || []).filter(s => (s.displayAs || 'trait') === where);
  const hp = m.hp?.special ? esc(m.hp.special) : m.hp ? `${esc(m.hp.average)} (${diceSpan(m.hp.formula, m.hp.formula, true)})` : '';
  const init = m.initiative ? (typeof m.initiative === 'number' ? m.initiative : modOf(m.dex) + (m.initiative.proficiency ? (pb || 0) * m.initiative.proficiency : 0)) : null;
  return `<div class="statblock">
    <p class="sb-sub">${esc([...(m.size || []).map(s => SIZES[s] || s)].join(' or '))} ${esc(typeText(m.type))}${m.alignment ? `, ${esc(alignText(m.alignment))}` : ''}</p>
    <div class="sb-top">
      ${row('Armor Class', esc(acText(m.ac)))}
      ${row('Hit Points', hp)}
      ${row('Speed', esc(speedText(m.speed)))}
      ${init != null ? row('Initiative', diceSpan(sign(init), `1d20${sign(init)}`, true)) : ''}
    </div>
    <table class="sb-abil"><thead><tr>${abil.map(a => `<th>${a.toUpperCase()}</th>`).join('')}</tr></thead>
      <tbody><tr>${abil.map(a => `<td>${esc(m[a] ?? '—')} ${m[a] != null ? diceSpan(`(${sign(modOf(m[a]))})`, `1d20${sign(modOf(m[a]))}`, true) : ''}${save[a] ? `<br><small>save ${diceSpan(save[a], `1d20${save[a]}`, true)}</small>` : ''}</td>`).join('')}</tr></tbody></table>
    <div class="sb-top">
      ${row('Skills', Object.entries(m.skill || {}).filter(([k]) => k !== 'other').map(([k, v]) => `${esc(k.replace(/^\w/, c => c.toUpperCase()))} ${diceSpan(v, `1d20${v}`, true)}`).join(', '))}
      ${row('Vulnerabilities', esc(dmgList(m.vulnerable, 'vulnerable')))}
      ${row('Resistances', esc(dmgList(m.resist, 'resist')))}
      ${row('Immunities', esc([dmgList(m.immune, 'immune'), condList(m.conditionImmune)].filter(Boolean).join('; ')))}
      ${row('Senses', esc([...(m.senses || []).map(s => renderString(s, false)), m.passive != null ? `Passive Perception ${m.passive}` : ''].filter(Boolean).join(', ')))}
      ${row('Languages', esc((m.languages || []).map(s => renderString(s, false)).join(', ') || '—'))}
      ${row('CR', `${esc(cr ?? '—')}${pb ? ` (PB +${pb})` : ''}`)}
    </div>
    ${m.trait?.length || spellBy('trait').length ? `<h4 class="sb-sec">Traits</h4>${renderEntries(m.trait || [])}${renderSpellcasting(spellBy('trait'))}` : ''}
    ${m.action?.length || spellBy('action').length ? `<h4 class="sb-sec">Actions</h4>${renderEntries(m.action || [])}${renderSpellcasting(spellBy('action'))}` : ''}
    ${m.bonus?.length || spellBy('bonus').length ? `<h4 class="sb-sec">Bonus Actions</h4>${renderEntries(m.bonus || [])}${renderSpellcasting(spellBy('bonus'))}` : ''}
    ${m.reaction?.length || spellBy('reaction').length ? `<h4 class="sb-sec">Reactions</h4>${renderEntries(m.reaction || [])}${renderSpellcasting(spellBy('reaction'))}` : ''}
    ${sec('Legendary Actions', m.legendary, m.legendaryHeader ? m.legendaryHeader.map(x => renderString(x)).join(' ') : m.legendary?.length ? `The creature can take ${m.legendaryActions || 3} legendary actions.` : '')}
    ${sec('Mythic Actions', m.mythic, m.mythicHeader ? m.mythicHeader.map(x => renderString(x)).join(' ') : '')}
  </div>`;
}
