// Liste les textes affichés qui n'ont pas encore de traduction anglaise dans shared/i18n/en.js.
//   node tools/i18n-extract.mjs            → les textes manquants, un par ligne (JSON)
//   node tools/i18n-extract.mjs --dynamic  → les messages à variables à convertir en t('… {x}', { x })
// Lit les gabarits html`…` (nœuds de texte, title, placeholder…), les appels t(), tn(), tl(),
// toast(), confirm() et les messages d'erreur du serveur.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['public/app', 'public/map', 'public/map/tools', 'public/world', 'shared', 'shared/map', 'server', 'server/routes', 'server/map'];
const ATTRS = /\b(title|placeholder|aria-label|alt|label|text|ok|submitLabel|sub)="([^"\u0000]*)"/g;
const CALL_CTX = /(?:\b(?:t|tn|tl|tx|toast|confirm|prompt|alert|say|Error|HttpError|WorldError|ActionError|SceneError|MapHttpError|fail|store_toast|showPin)\s*\(\s*(?:[\w.]+\s*,\s*)?(?:\d+\s*,\s*)?|\b(?:title|text|ok|label|toast|error|placeholder|hint|reason|action)\s*:\s*)$/;

function scan(src) {
  const out = { statics: [], strings: [], dynamics: [] };
  let i = 0;
  const n = src.length;
  // Pile des contextes : { kind: 'code', depth } ou { kind: 'tpl', html, parts, cur }
  const stack = [{ kind: 'code', depth: 0 }];
  let lastCode = '';
  const top = () => stack[stack.length - 1];
  const prevSignificant = () => lastCode.replace(/\s+$/, '').slice(-1);
  while (i < n) {
    const c = src[i];
    const ctx = top();
    if (ctx.kind === 'tpl') {
      if (c === '\\') { ctx.cur += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') {
        ctx.parts.push(ctx.cur);
        stack.pop();
        const full = ctx.parts.join('\u0000');
        if (ctx.html) out.statics.push(full);
        else if (ctx.parts.length > 1) out.dynamics.push({ text: ctx.parts.join('{…}'), before: ctx.before });
        else out.strings.push({ text: full, before: ctx.before });
        i++;
        continue;
      }
      if (c === '$' && src[i + 1] === '{') {
        ctx.parts.push(ctx.cur);
        ctx.cur = '';
        stack.push({ kind: 'code', depth: 0, inTpl: true });
        lastCode = '';
        i += 2;
        continue;
      }
      ctx.cur += c;
      i++;
      continue;
    }
    // code
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '/' && (/[(,=:[!&|?{};+\-*%<>~^]/.test(prevSignificant()) || /\breturn\s*$/.test(lastCode) || !prevSignificant())) {
      // Expression régulière : jusqu'au / non échappé hors classe.
      let j = i + 1;
      let cls = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') cls = true;
        else if (d === ']') cls = false;
        else if (d === '/' && !cls) break;
        else if (d === '\n') break;
        j++;
      }
      i = j + 1;
      lastCode += 'R';
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let s = '';
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') { s += src[j + 1] === 'n' ? '\n' : src[j + 1]; j += 2; continue; }
        if (src[j] === '\n') break;
        s += src[j];
        j++;
      }
      out.strings.push({ text: s, before: lastCode.slice(-60), inHtml: stack.some(x => x.kind === 'tpl' && x.html) });
      lastCode += 'S';
      i = j + 1;
      continue;
    }
    if (c === '`') {
      const isHtml = /\bhtml\s*$/.test(lastCode);
      stack.push({ kind: 'tpl', html: isHtml, parts: [], cur: '', before: lastCode.slice(-60) });
      i++;
      continue;
    }
    if (c === '{') ctx.depth++;
    if (c === '}') {
      if (ctx.depth === 0 && ctx.inTpl) { stack.pop(); i++; continue; }
      ctx.depth--;
    }
    lastCode += c;
    if (lastCode.length > 400) lastCode = lastCode.slice(-200);
    i++;
  }
  return out;
}

const norm = s => s.replace(/\s+/g, ' ').trim();
const hasWords = s => /[A-Za-zÀ-ÿ]{2,}/.test(s);
// Ce qui n'est pas du texte à traduire : classes CSS, chemins, code, termes D&D en anglais seuls.
const SKIP = s => /^[\w-]+(\s[\w-]+)*$/.test(s) && !/[À-ÿ]/.test(s) && (s.includes('-') || /^[a-z]/.test(s)) && !/\s/.test(s)
  || /^(https?:|\/|\.|#|[\w-]+\.(js|css|png|json|map|md)$)/.test(s)
  || /[{};=]|=>|\bconst\b|\bfunction\b/.test(s);

export function extract() {
  const found = new Map();
  const dyn = new Map();
  const add = (s, file) => {
    const k = norm(s);
    if (!k || !hasWords(k) || SKIP(k)) return;
    if (!found.has(k)) found.set(k, file);
  };
  for (const d of DIRS) {
    const dir = path.join(ROOT, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
      if (d === 'shared' && f === 'i18n.js') continue;
      const rel = path.join(d, f);
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const r = scan(src);
      for (const full of r.statics) {
        for (const m of full.matchAll(ATTRS)) add(m[2], rel);
        const text = full.replace(/<[^>]*>/g, '\u0001');
        for (const seg of text.split(/[\u0000\u0001]/)) add(seg, rel);
      }
      for (const s of r.strings) {
        if (CALL_CTX.test(s.before)) add(s.text, rel);
        // Une chaîne dans une expression d'un gabarit : du texte affiché, sauf les listes de classes CSS.
        else if (s.inHtml && /[A-Za-zÀ-ÿ]/.test(s.text) && !/^[a-z0-9 _:.\/-]+$/.test(s.text.trim()) && /\s|[À-ÿ]/.test(s.text.trim())) add(s.text, rel);
      }
      for (const s of r.dynamics) if (CALL_CTX.test(s.before) && hasWords(s.text)) dyn.set(norm(s.text), rel);
    }
  }
  return { found, dyn };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const { default: EN } = await import(path.join(ROOT, 'shared/i18n/en.js'));
  const { found, dyn } = extract();
  if (process.argv.includes('--dynamic')) {
    for (const [k, f] of dyn) console.log(`${f}\t${k}`);
  } else {
    const missing = [...found].filter(([k]) => !(k in EN));
    if (process.argv.includes('--count')) console.log(`${missing.length} manquants sur ${found.size}`);
    else for (const [k, f] of missing) console.log(JSON.stringify([f, k]));
  }
}
