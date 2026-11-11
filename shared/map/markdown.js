// Petit rendu du Markdown des notes pour la carte d'infos du MJ : gras, italique, code,
// liens, séparateurs, tableaux. Le texte est échappé avant toute balise.

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  const out = esc(s);
  return out
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`)
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>');
}

export function renderNote(lines) {
  const html = [];
  let table = null;
  const closeTable = () => { if (table) { html.push(`<table class="note-table">${table.join('')}</table>`); table = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\|/.test(line.trim())) {
      if (/^\|[\s:|-]+\|?$/.test(line.trim())) continue;
      const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => `<td>${inline(c.replace(/\\\|/g, '|').trim())}</td>`);
      (table || (table = [])).push(`<tr>${cells.join('')}</tr>`);
      continue;
    }
    closeTable();
    if (!line.trim()) continue;
    if (/^-{3,}$/.test(line.trim())) { html.push('<hr>'); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { html.push(`<h4>${inline(h[2])}</h4>`); continue; }
    if (/^[-*]\s+/.test(line)) { html.push(`<p class="note-li">${inline(line.replace(/^[-*]\s+/, '• '))}</p>`); continue; }
    html.push(`<p>${inline(line)}</p>`);
  }
  closeTable();
  return html.join('');
}
