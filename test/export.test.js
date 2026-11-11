import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { Engine } from '../server/engine.js';
import { runExport, characterMarkdown } from '../server/export.js';
import { blankCharacter } from '../shared/model.js';
import { FiveETools } from '../server/data5e.js';

const FIX = fileURLToPath(new URL('./fixtures/5etools', import.meta.url));

test('export Obsidian : fichiers stables, frontmatter, changements, secret, dessins, sauvegarde', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-exp-'));
  const db = openDb(path.join(dir, 'f.sqlite'));
  const engine = new Engine({ db }).load();
  const ren = blankCharacter({ name: 'Ilya Voss', player: 'Noé', className: 'Wizard', subclass: 'School of Illusion', level: 4, race: 'Human' });
  ren.secret = { text: 'Vient de la Terre.', goals: '', drawing: {} };
  ren.spells.a = { name: 'Shield', level: 1, prepared: true };
  ren.drawings.notes.s1 = { c: 'r', w: 2, p: [10, 10, 0.5, 60, 40, 0.8, 90, 20, 0.5], t: 1 };
  const id = engine.createCharacter(ren, { campaign: 'c1' });
  const cfg = { exportPath: path.join(dir, 'vault', 'Characters'), backupDir: path.join(dir, 'backups'), fileNamePattern: '{name} - Fiche', partyFileName: 'Groupe', currency: undefined };
  const chars = () => engine.chars().map(c => ({ id: c.id, data: c.data }));

  const r1 = runExport({ chars: chars(), party: { data: engine.party('c1').data }, db, cfg, session: 6, now: Date.UTC(2026, 9, 1, 12) });
  const md1 = fs.readFileSync(path.join(cfg.exportPath, 'Ilya Voss - Fiche.md'), 'utf8');
  assert.match(md1, /^---\nname: "Ilya Voss"\nplayer: "Noé"\nclass: "Wizard"\nsubclass: "School of Illusion"\nlevel: 4\n/);
  assert.match(md1, /max_hp: \d+/);
  assert.match(md1, /abilities:\n  str: 10/);
  assert.match(md1, /session: 6/);
  assert.match(md1, /Premier export/);
  assert.match(md1, /\[\[Shield\]\]/);
  assert.match(md1, /## Secret\n> \[!warning\] Player-hidden/);
  assert.match(md1, /!\[\[Ilya Voss - Fiche - Notes\.svg\]\]/);
  assert.ok(fs.existsSync(path.join(cfg.exportPath, 'attachments', 'Ilya Voss - Fiche - Notes.svg')));
  assert.ok(fs.existsSync(path.join(cfg.exportPath, 'Groupe.md')));
  assert.ok(fs.existsSync(path.join(r1.backupDir, 'Ilya Voss - Fiche.md')), 'copie hors du coffre');
  assert.doesNotMatch(md1, /undefined|NaN|null/);
  assert.doesNotMatch(md1, /## Currency/, 'pas de section vide');

  // Deuxième export : seulement les changements.
  const doc = engine.docs.get(id).data;
  doc.classes[0].level = 5;
  doc.hp.max = 26;
  doc.spells.b = { name: 'Fireball', level: 3 };
  doc.inventory.i = { name: 'Potion of Healing', qty: 2 };
  doc.notes.backstory = 'Isekai.';
  runExport({ chars: chars(), party: { data: engine.party('c1').data }, db, cfg, session: 7, now: Date.UTC(2026, 9, 8, 12) });
  const md2 = fs.readFileSync(path.join(cfg.exportPath, 'Ilya Voss - Fiche.md'), 'utf8');
  const changes = md2.split('## Changes since last export')[1].split('\n## ')[0];
  assert.match(changes, /Level 4 → 5/);
  assert.match(changes, /Max HP \d+ → 26/);
  assert.match(changes, /New spells: \[\[Fireball\]\]/);
  assert.match(changes, /New items: \[\[Potion of Healing\]\] ×2/);
  assert.match(changes, /Notes edited: Backstory/);
  assert.doesNotMatch(changes, /Shield/);

  // Renommage : l'ancien fichier généré disparaît, le nouveau prend sa place.
  doc.name = 'Ren';
  const r3 = runExport({ chars: chars(), party: { data: engine.party('c1').data }, db, cfg, session: 7 });
  assert.ok(fs.existsSync(path.join(cfg.exportPath, 'Ren - Fiche.md')));
  assert.ok(!fs.existsSync(path.join(cfg.exportPath, 'Ilya Voss - Fiche.md')));
  assert.ok(r3.removed.length >= 1);
  db.close();
});

test('un fichier sans marqueur n’est jamais supprimé', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-exp2-'));
  const db = openDb(path.join(dir, 'f.sqlite'));
  const engine = new Engine({ db }).load();
  const id = engine.createCharacter(blankCharacter({ name: 'A' }), { campaign: 'c1' });
  const cfg = { exportPath: path.join(dir, 'v'), backupDir: path.join(dir, 'b'), fileNamePattern: '{name}' };
  runExport({ chars: engine.chars().map(c => ({ id: c.id, data: c.data })), party: { data: engine.party('c1').data }, db, cfg });
  fs.writeFileSync(path.join(cfg.exportPath, 'A.md'), '# Note écrite à la main\n');
  engine.docs.get(id).data.name = 'B';
  runExport({ chars: engine.chars().map(c => ({ id: c.id, data: c.data })), party: { data: engine.party('c1').data }, db, cfg });
  assert.ok(fs.existsSync(path.join(cfg.exportPath, 'A.md')));
  db.close();
});

test('markdown sans champs vides pour une fiche vierge', () => {
  const md = characterMarkdown(blankCharacter({ name: 'Vide' }));
  assert.doesNotMatch(md, /## Inventory|## Currency|## Notes|## Secret|## Spells|undefined/);
});

test('chargement 5etools : sorts, objets, conditions, listes de classes', () => {
  const d = new FiveETools(FIX, ['XPHB', 'PHB']).load();
  const st = d.status();
  assert.equal(st.error, null);
  assert.equal(st.spells, 7);
  assert.equal(d.spell('Shield').source, 'XPHB', 'source préférée');
  assert.equal(d.spell('Shield', 'PHB').entries[0], 'Older fixture text.');
  const fb = d.spell('Fireball');
  assert.equal(fb.range, '150 ft');
  assert.equal(fb.components, 'V, S, M (a ball of bat guano and sulfur)');
  const dm = d.spell('Detect Magic');
  assert.equal(dm.duration, 'Concentration, up to 10 minutes');
  assert.ok(dm.ritual && dm.concentration);
  assert.deepEqual(d.spellIndex().find(s => s.name === 'Hex').classes, ['Warlock']);
  assert.ok(d.spellIndex().find(s => s.name === 'Shield' && s.source === 'PHB').classes.includes('Wizard'), 'ancien format fromClassList');
  assert.equal(d.item('Wand of Magic Missiles').charges, 7);
  assert.equal(d.itemIndex().find(i => i.name === 'Cloak of Protection').attunement, true);
  assert.equal(d.condition('Poisoned').source, 'XPHB');
  assert.match(new FiveETools(path.join(FIX, 'nope')).load().status().error, /introuvable/);
});
