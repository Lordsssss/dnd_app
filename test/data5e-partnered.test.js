// Livres partenaires de 5etools : téléchargés depuis le dépôt homebrew (fichiers marqués `p` dans
// son index), rangés dans partnered/, indexés sous leur propre code de source, après les livres
// officiels. Données inventées : « Frost Codex » d'un éditeur fictif.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FiveETools } from '../server/data5e.js';
import { fetch5eTools, readDownloadInfo, BREW, MIRROR } from '../server/fetch5e.js';
import { start, login, api } from './helpers.js';

const spell = (name, source, level, extra = {}) => ({
  name, source, level, school: 'V', time: [{ number: 1, unit: 'bonus' }],
  range: { type: 'point', distance: { type: 'touch' } }, components: { v: true, s: true },
  duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 } }],
  entries: [`Invented test text for ${name}.`], ...extra,
});
const META = { sources: [{ json: 'FrostCodex', abbreviation: 'FCX', full: 'Frost Codex', partnered: true }] };

function writeJson(file, j) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(j));
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-5e-partner-'));
writeJson(path.join(dir, 'spells', 'spells-xphb.json'), { spell: [spell('Shield', 'XPHB', 1, { classes: { fromClassList: [{ name: 'Wizard', source: 'XPHB' }] } })] });
writeJson(path.join(dir, 'class', 'class-wizard.json'), { class: [{ name: 'Wizard', source: 'XPHB', hd: { faces: 6 }, classFeatures: [] }] });
writeJson(path.join(dir, 'items-base.json'), { baseitem: [{ name: 'Spear', source: 'XPHB', type: 'M', mastery: ['Sap|XPHB'] }] });
writeJson(path.join(dir, 'book', 'book-xphb.json'), { data: [] });
writeJson(path.join(dir, 'books.json'), { book: [{ name: 'Player Handbook', id: 'XPHB', source: 'XPHB', contents: [] }] });
writeJson(path.join(dir, 'partnered', 'collection', 'Invented Press; Frost Codex.json'), {
  _meta: META,
  spell: [
    spell('Ember Sigil', 'FrostCodex', 2, { classes: { fromClassList: [{ name: 'Wizard', source: 'XPHB' }] } }),
    spell('Shield', 'FrostCodex', 1),
  ],
  feat: [{ name: 'Rimeborn', source: 'FrostCodex', category: 'G', entries: ['Invented feat text.'] }],
  item: [{ name: 'Frost Lantern', source: 'FrostCodex', rarity: 'uncommon', entries: ['Invented item text.'] }],
  baseitem: [{ name: 'Ice Pick Axe', source: 'FrostCodex', type: 'M', mastery: ['Topple|XPHB'] }],
  class: [{ name: 'Frostwarden', source: 'FrostCodex', hd: { faces: 10 }, classFeatures: [] }],
  subclass: [{ name: 'Rune Scribe', shortName: 'Rune Scribe', source: 'FrostCodex', className: 'Wizard', classSource: 'XPHB', subclassFeatures: [] }],
  book: [{ name: 'Frost Codex', id: 'FrostCodex', source: 'FrostCodex', contents: [] }],
  bookData: [{ id: 'FrostCodex', data: [] }],
});
// Un fichier rangé sous adventure/ dans partnered/ est lu au démarrage, contrairement à data/adventure/.
writeJson(path.join(dir, 'partnered', 'adventure', 'Invented Press; Frost Codex Tales.json'), {
  _meta: { sources: [{ json: 'FrostTales', abbreviation: 'FTL', full: 'Frost Codex Tales', partnered: true }] },
  monster: [{ name: 'Glacier Wisp', source: 'FrostTales', cr: '2', type: 'elemental' }],
});
// Un nom d'éditeur qui ressemble à un fichier d'outillage de 5etools n'est pas écarté.
writeJson(path.join(dir, 'partnered', 'collection', 'loot press; Coin Hoard.json'), {
  _meta: { sources: [{ json: 'CoinHoard', abbreviation: 'CH', full: 'Coin Hoard', partnered: true }] },
  item: [{ name: 'Hoard Coin', source: 'CoinHoard', entries: ['Invented.'] }],
});
const d5 = new FiveETools(dir, ['XPHB']).load();
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('partenaires : un sort indexé sous son code, sa liste de classes lue', () => {
  const s = d5.spell('Ember Sigil', 'FrostCodex');
  assert.equal(s.source, 'FrostCodex');
  assert.equal(s.level, 2);
  assert.deepEqual(s.classes, ['Wizard']);
  assert.equal(s.time, '1 bonus action');
  // L'abréviation affichée par 5e.tools désigne la même source.
  assert.equal(d5.spell('Ember Sigil', 'FCX').source, 'FrostCodex');
  assert.equal(d5.spell('Ember Sigil', 'fcx').source, 'FrostCodex');
  const idx = d5.spellIndex().find(x => x.name === 'Ember Sigil');
  assert.deepEqual(idx.classes, ['Wizard']);
  assert.ok(d5.search('ember').some(h => h.k === 'spell' && h.s === 'FrostCodex'));
  assert.ok(d5.filter('spells', 'class=wizard|level=2').some(h => h.n === 'Ember Sigil'));
  assert.equal(d5.entry('spell', 'Ember Sigil', 'FCX').source, 'FrostCodex');
});

test('partenaires : rangés après les livres officiels', () => {
  assert.equal(d5.spell('Shield').source, 'XPHB');
  assert.equal(d5.spell('Shield', 'FrostCodex').source, 'FrostCodex');
  const shields = d5.spellIndex().filter(x => x.name === 'Shield').map(x => x.source);
  assert.deepEqual(shields, ['XPHB', 'FrostCodex']);
  assert.equal(d5.filter('spells', 'level=1').find(h => h.n === 'Shield').s, 'XPHB');
  assert.ok(d5.rank('FrostCodex') > d5.rank('TCE'));
});

test('partenaires : dons, objets, sous-classes et créatures suivent', () => {
  assert.equal(d5.feat('Rimeborn', 'FrostCodex').category, 'General');
  assert.equal(d5.item('Frost Lantern', 'FCX').rarity, 'uncommon');
  assert.ok(d5.klass('Wizard', 'XPHB').subclasses.some(s => s.name === 'Rune Scribe' && s.source === 'FrostCodex'));
  assert.equal(d5.entry('monster', 'Glacier Wisp', 'FrostTales').source, 'FrostTales');
  assert.equal(d5.item('Hoard Coin', 'CoinHoard').source, 'CoinHoard');
  // Les listes courtes de création et de montée de niveau restent officielles.
  assert.deepEqual(d5.classList().map(c => c.name), ['Wizard']);
  assert.equal(d5.klass('Frostwarden', 'FrostCodex').hd, 10);
  assert.deepEqual(d5.masteryWeapons().map(w => w.name), ['Spear']);
  assert.equal(d5.item('Ice Pick Axe', 'FCX').source, 'FrostCodex');
  // Le livre d'un fichier partenaire n'entre pas dans la bibliothèque des livres officiels.
  assert.deepEqual(d5.bookList().map(b => b.id), ['XPHB']);
  assert.deepEqual(d5.status().partnered, ['CoinHoard', 'FrostCodex', 'FrostTales']);
});

test('partenaires : GET /api/5e/spell trouve le sort par son code', async () => {
  const s = await start({ data5e: d5 });
  try {
    const ren = await login(s.base, 'ren', '1111');
    const call = api(s.base, ren.body.token);
    const r = await call('/api/5e/spell?name=Ember%20Sigil&source=FrostCodex');
    assert.equal(r.status, 200);
    assert.equal(r.body.source, 'FrostCodex');
    assert.deepEqual(r.body.classes, ['Wizard']);
    assert.equal((await call('/api/5e/spell?name=Ember%20Sigil&source=FCX')).body.source, 'FrostCodex');
    assert.equal((await api(s.base)('/api/5e/spell?name=Ember%20Sigil&source=FrostCodex')).status, 401);
  } finally { await s.stop(); }
});

// ------------------------------------------------------------ Téléchargement

test('fetch5eTools : prend les fichiers partenaires du dépôt homebrew, et seulement eux', async t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-5e-fetch-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  const codex = 'collection/Invented Press; Frost Codex.json';
  const remote = {
    meta: {
      'Invented Press; Frost Codex.json': { n: ['Frost Codex'], a: ['FCX'], p: 1 },
      'Someone; Not Partnered.json': { n: ['Not Partnered'], a: ['NP'] },
      'Evil; Escape.json': { p: 1 },
    },
    stamps: {
      [codex]: { a: 1, m: 100 },
      'spell/Someone; Not Partnered.json': { a: 1, m: 100 },
      '../Evil; Escape.json': { a: 1, m: 100 },
    },
    files: { [codex]: JSON.stringify({ _meta: META, spell: [spell('Ember Sigil', 'FrostCodex', 2)] }) },
    indexDown: false,
  };
  const seen = [];
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async url => {
    url = String(url);
    seen.push(url);
    const ok = body => ({ ok: true, status: 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    const missing = { ok: false, status: 404, text: async () => '' };
    if (url.includes('/git/trees/')) return ok({ truncated: false, tree: [{ type: 'blob', path: 'data/spells/spells-xphb.json', sha: 'abc', size: 20 }] });
    if (url.includes('/commits/')) return ok({ sha: 'c0ffee', commit: { committer: { date: '2026-01-01T00:00:00Z' } } });
    if (url === `${MIRROR}/spells/spells-xphb.json`) return ok({ spell: [spell('Shield', 'XPHB', 1)] });
    if (url.startsWith(`${BREW}/_generated/`)) {
      if (remote.indexDown) return missing;
      return ok(url.endsWith('index-meta.json') ? remote.meta : remote.stamps);
    }
    if (url.startsWith(`${BREW}/`)) {
      const p = url.slice(BREW.length + 1).split('/').map(decodeURIComponent).join('/');
      return remote.files[p] ? ok(remote.files[p]) : missing;
    }
    return missing;
  };

  const r1 = await fetch5eTools(out, { wait: 1 });
  assert.equal(r1.downloaded, 2);
  assert.equal(r1.partnered, 1);
  const local = path.join(out, 'partnered', codex);
  assert.ok(fs.existsSync(local));
  assert.ok(seen.includes(`${BREW}/collection/Invented%20Press%3B%20Frost%20Codex.json`));
  assert.ok(!seen.some(u => u.includes('Not%20Partnered') || u.includes('Escape')));
  assert.ok(!fs.existsSync(path.join(out, 'Evil; Escape.json')));
  assert.equal(new FiveETools(out).load().spell('Ember Sigil', 'FCX').source, 'FrostCodex');

  // Rien de neuf : rien à reprendre.
  const r2 = await fetch5eTools(out, { wait: 1 });
  assert.equal(r2.downloaded, 0);
  assert.equal(r2.unchanged, 2);

  // Modifié dans le dépôt : repris.
  remote.stamps[codex] = { a: 1, m: 200 };
  assert.equal((await fetch5eTools(out, { wait: 1 })).downloaded, 1);

  // Index injoignable : les fichiers partenaires déjà là restent.
  remote.indexDown = true;
  const r4 = await fetch5eTools(out, { wait: 1 });
  assert.match(r4.partneredError, /404/);
  assert.equal(r4.removed, 0);
  assert.ok(fs.existsSync(local));
  assert.equal(readDownloadInfo(out).sha[`partnered/${codex}`], 'm200');

  // Plus marqué partenaire : retiré.
  remote.indexDown = false;
  delete remote.meta['Invented Press; Frost Codex.json'];
  const r5 = await fetch5eTools(out, { wait: 1 });
  assert.equal(r5.removed, 1);
  assert.equal(r5.partnered, 0);
  assert.ok(!fs.existsSync(local));
  assert.ok(fs.existsSync(path.join(out, 'spells', 'spells-xphb.json')));
});
