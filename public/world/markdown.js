// Rendu léger d'une note Obsidian pour la fiche d'un lieu : titres, listes, tableaux, encadrés,
// gras et italique, liens. Tout le texte est échappé d'abord : rien de la note ne s'exécute.

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  let t = esc(s);
  t = t.replace(/!\[\[[^\]]+\]\]/g, '');
  t = t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '<span class="wl">$2</span>');
  t = t.replace(/\[\[([^\]]+)\]\]/g, (m, a) => `<span class="wl">${a.replace(/#.*$/, '')}</span>`);
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*\*([^*]+)\*\*\*/g, '<b><i>$1</i></b>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<i>$2</i>');
  return t;
}

function table(rows) {
  const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  return `<table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

export function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  // Propriétés en tête de note : ignorées.
  if (lines[0] === '---') { i = 1; while (i < lines.length && lines[i] !== '---') i++; i++; }
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) { const n = Math.min(6, h[1].length + 2); out.push(`<h${n}>${inline(h[2])}</h${n}>`); i++; continue; }
    if (/^#[\w-]+(\s+#[\w-]+)*\s*$/.test(l.trim())) { i++; continue; }
    if (/^\s*>/.test(l)) {
      const block = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { block.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      const c = /^\[!(\w+)\][+-]?\s*(.*)$/.exec(block[0] || '');
      const inner = renderMarkdown((c ? block.slice(1) : block).join('\n'));
      out.push(c ? `<div class="callout c-${esc(c[1].toLowerCase())}">${c[2] ? `<p class="c-title">${inline(c[2])}</p>` : ''}${inner}</div>` : `<blockquote>${inner}</blockquote>`);
      continue;
    }
    if (/^\s*\|/.test(l) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      out.push(table(rows));
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+(\[[ x]\]\s+)?/, ''));
        i++;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*>|\s*\||\s*([-*]|\d+\.)\s+)/.test(lines[i])) { para.push(lines[i]); i++; }
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    else i++;
  }
  return out.join('\n');
}
