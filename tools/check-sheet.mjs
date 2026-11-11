// Vérifie des fiches JSON avant de les importer dans l'application, sans serveur.
//   node tools/check-sheet.mjs fiche.json [autre.json…] [--coins=gp,sp,cp]
//   node tools/check-sheet.mjs --template [--coins=po,pa,pc] [--edition=2014]   le modèle
//   node tools/check-sheet.mjs --prompt  [--coins=…]                             la consigne pour une IA
// Code de sortie 1 si une fiche a une erreur bloquante.
import fs from 'node:fs';
import { checkSheet, sheetExample, sheetPrompt } from '../shared/sheet-template.js';
import { normalizeCharacter } from '../shared/model.js';

const args = process.argv.slice(2);
const opt = k => args.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
const coins = opt('coins') ? opt('coins').split(',').map(s => s.trim()).filter(Boolean) : null;
const edition = opt('edition') || '2024';

if (args.includes('--template')) { console.log(JSON.stringify(sheetExample({ coins, edition }), null, 2)); process.exit(0); }
if (args.includes('--prompt')) { console.log(sheetPrompt({ coins, edition })); process.exit(0); }

const files = args.filter(a => !a.startsWith('--'));
if (!files.length) { console.error('Usage : node tools/check-sheet.mjs fiche.json [--coins=gp,sp,cp]'); process.exit(2); }

let bad = 0;
for (const f of files) {
  let data;
  try { data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.log(`✗ ${f}\n  JSON illisible : ${e.message}`); bad++; continue; }
  const { errors, warnings } = checkSheet(data, { coins });
  const d = normalizeCharacter(data.character || data);
  const summary = `${d.name || '?'} · ${(d.classes || []).map(c => `${c.name} ${c.level}`).join(' / ')} · ${Object.keys(d.spells).length} sorts, ${Object.keys(d.featureList).length} capacités, ${Object.keys(d.inventory).length} objets`;
  console.log(`${errors.length ? '✗' : '✓'} ${f}\n  ${summary}`);
  for (const e of errors) console.log(`  ERREUR  ${e}`);
  for (const w of warnings) console.log(`  à voir  ${w}`);
  if (errors.length) bad++;
}
process.exitCode = bad ? 1 : 0;
