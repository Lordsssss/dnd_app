import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyNames, buildBaseSvg, extractWorld, parseMap, removeGroup } from '../server/world.js';
import { openDb } from '../server/db.js';
import { Worlds } from '../server/worlds.js';
import { createBridge, normalizeBridge } from '../server/bridge.js';

// Un .map minuscule, organisé comme ceux d'Azgaar 1.15x : lignes séparées par \r\n, SVG sur
// plusieurs lignes, puis les tableaux de données et les tableaux par cellule.
function tinyMap() {
  const svg = [
    '<svg id="map" width="100" height="50" version="1.1">',
    '<defs><g id="deftemp"><g id="textPaths"><path id="textPath_stateLabel1" d="M0,0L50,0"/></g></g></defs>',
    '<g id="viewbox" style="cursor: default;"><g id="regions"><g id="statesBody"><path id="state1" d="M0,0"/></g></g>',
    '<g id="lakes"><path d="M10,10 L20,10 L20,20 L10,20" id="feature_3"/></g>',
    '<g id="burgIcons"><g id="town"><use id="burg1"/></g></g><g id="markers" style="display: none;"/>',
    '<g id="labels"><g id="labels-state"><text id="stateLabel1" data-id="1"><textPath href="#textPath_stateLabel1" font-size="100%">Kingdom of Ys</textPath></text></g></g>',
    '</g></svg>',
  ].join('\n');
  const features = [0, { i: 1, type: 'ocean' }, { i: 2, type: 'island', name: 'Grande' }, { i: 3, type: 'lake', name: 'Mirror', cells: 2 }];
  const cultures = [{ name: 'Wildlands', i: 0, base: 1, shield: 'round' }, { name: 'Anor', i: 1, base: 2, shield: 'heater' }];
  const states = [{ i: 0, name: 'Neutrals', neighbors: [] }, { i: 1, name: 'Ys', fullName: 'Kingdom of Ys', formName: 'Kingdom', capital: 1, color: '#123456', neighbors: [] }];
  const burgs = [0,
    { cell: 0, x: 10, y: 10, i: 1, state: 1, culture: 1, name: 'Valombre', population: 5.5, capital: 1, group: 'capital', walls: 1, port: 1 },
    { cell: 2, x: 40, y: 30, i: 2, state: 1, culture: 1, name: 'Hamlet', population: 0.2, capital: 0, group: 'hamlet' },
  ];
  const religions = [{ name: 'No religion', i: 0, origins: null, tags: [] }, { name: 'Sun', i: 1, type: 'Folk', deity: 'Sol' }];
  const provinces = [0, { i: 1, state: 1, center: 0, burg: 1, name: 'North', formName: 'County', fullName: 'North County' }, { i: 2, state: 1, center: 2, burg: 2, name: 'South', formName: 'County', fullName: 'South County' }];
  const markers = [{ icon: 'glyph-1f30b', type: 'volcanoes', x: 30, y: 5, cell: 1, i: 0, name: 'Mount Doom', note: 'Hot.' }, { icon: 'glyph-1f6a9', type: 'party', x: 1, y: 1, cell: 0, i: 1, name: 'The Party' }];
  const cellState = '1,1,1,0';
  const cellProv = '1,1,2,0';
  const cellRel = '1,1,1,0';
  return [
    '1.156.0|Azgaar|2026-11-8|42|100|50|1',
    JSON.stringify({ seed: '42', lore: { name: 'Testland', calendar: { year: 1578, era: '4th epoch' } }, units: { distance: { unit: 'mi', scale: 2 }, population: { scale: 1000, urbanization: { rate: 1 } } } }),
    '',
    '[]',
    '',
    svg,
    '{"spacing":1}',
    '0,0,0,0',
    JSON.stringify(features),
    JSON.stringify(cultures),
    JSON.stringify(states),
    JSON.stringify(burgs),
    '1,2,0,0',
    cellState,
    cellRel,
    cellProv,
    JSON.stringify(religions),
    JSON.stringify(provinces),
    JSON.stringify(markers),
  ].join('\r\n');
}

test('lecture d\'un .map : bourgs, provinces par cellule, lacs, marqueurs', () => {
  const p = parseMap(tinyMap());
  assert.equal(p.nl, '\r\n');
  const w = extractWorld(p);
  assert.equal(w.name, 'Testland');
  assert.equal(w.width, 100);
  const cap = w.burgs.find(b => b.i === 1);
  assert.equal(cap.province, 1);
  assert.equal(cap.religion, 1);
  assert.equal(cap.population, 5500);
  assert.ok(cap.port && cap.walls && cap.capital);
  assert.equal(w.burgs.find(b => b.i === 2).province, 2);
  assert.equal(w.markers[0].icon, '🌋');
  const lake = w.lakes.find(l => l.i === 3);
  assert.equal(Math.round(lake.x), 15);
  assert.equal(Math.round(lake.y), 15);
});

test('SVG de fond : sans icônes de bourgs, à la taille de la carte, étiquette renommée et réduite', () => {
  const p = parseMap(tinyMap());
  assert.equal(removeGroup('<a><g id="x"><g/><g><b/></g></g><c/></a>', 'x'), '<a><c/></a>');
  const svg = buildBaseSvg(p, { 1: 'Grand-Royaume d\'Ys-la-Belle' });
  assert.ok(!svg.includes('burgIcons') && !svg.includes('id="markers"'));
  assert.match(svg, /viewBox="0 0 100 50"/);
  // Plus long que l'ancien nom d'une ligne : deux lignes, police intacte.
  assert.match(svg, /font-size="100%"><tspan x="0" dy="-0.5em">Grand-Royaume <\/tspan><tspan x="0" dy="1em">d'Ys-la-Belle<\/tspan>/);
  // Un seul mot trop long : la police diminue, une fois.
  const svg2 = buildBaseSvg(p, { 1: 'Ysbourgdelamerdunord' });
  const size = Number(/font-size="([\d.]+)%">Ysbourg/.exec(svg2)[1]);
  assert.ok(size < 100, 'un nom plus long sur une ligne réduit la police');
});

test('réécriture : sans changement, le fichier ressort identique ; sinon seuls les noms changent', () => {
  const text = tinyMap();
  const p = parseMap(text);
  assert.equal(applyNames(p, {}).text, text);
  const r = applyNames(p, { b1: { name: 'Berleigh' }, s1: { name: 'Ys', full: 'Royaume d\'Ys' }, p2: { full: 'Comté du Sud' }, l3: { name: 'Lac du Cratère' }, r1: { name: 'Foi de la Lune', deity: 'Séléné', form: 'Monotheism' } }, { x: 40, y: 30, cell: 2 });
  assert.deepEqual(r.touched.sort(), ['burgs', 'features', 'labels', 'markers', 'provinces', 'religions', 'states']);
  const rel = extractWorld(parseMap(r.text)).religions.find(x => x.i === 1);
  assert.deepEqual([rel.name, rel.deity, rel.form], ['Foi de la Lune', 'Séléné', 'Monotheism']);
  const w = extractWorld(parseMap(r.text));
  assert.equal(w.burgs.find(b => b.i === 1).name, 'Berleigh');
  assert.equal(w.states.find(s => s.i === 1).full, 'Royaume d\'Ys');
  assert.equal(w.provinces.find(x => x.i === 2).full, 'Comté du Sud');
  assert.equal(w.lakes.find(l => l.i === 3).name, 'Lac du Cratère');
  const party = JSON.parse(parseMap(r.text).lines.at(-1)).find(m => m.type === 'party');
  assert.deepEqual([party.x, party.y, party.cell], [40, 30, 2]);
});

test('vue des joueurs : seulement ce qui est connu, sans notes du MJ ; notes du coffre par le pont seulement', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-world-'));
  fs.mkdirSync(path.join(vault, 'Campagne/03 - Lieux'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'Campagne/03 - Lieux/Valombre.md'), '# Valombre\n\n> [!warning] Secret\n> Rien.');
  fs.writeFileSync(path.join(vault, 'secret.md'), 'non');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-worlds-'));
  const db = openDb(path.join(data, 'f.sqlite'));
  const bridge = createBridge(normalizeBridge({ vaultDir: vault, worldNotesRoot: 'Campagne' }), { db, backupDir: data });
  const worlds = new Worlds(db, data, { bridgeOf: cid => (cid === 'c1' ? bridge : null) });
  worlds.setMap('c1', tinyMap());
  const world = worlds.of('c1');

  world.patchEntity('b1', { name: 'Capitale', known: true, pub: 'Grande ville.', mj: 'Secret du MJ', note: 'Campagne/03 - Lieux/Valombre.md' });
  world.patchEntity('p2', { mj: 'Rien à dire' });
  assert.throws(() => world.patchEntity('b1', { note: 'secret.md' }), /introuvable/);
  assert.throws(() => world.patchEntity('b1', { note: '../../etc/passwd.md' }), /introuvable/);
  assert.throws(() => world.patchEntity('zz', {}), /inconnu/);
  const added = world.addPlace({ name: 'Ruine', x: 5, y: 5 });
  world.setParty({ x: 2, y: 3 });

  const dm = world.view('dm');
  assert.equal(dm.burgs.length, 2);
  assert.equal(dm.burgs.find(b => b.i === 1).mj, 'Secret du MJ');
  assert.equal(dm.added[0].key, added.key);

  const pl = world.view('player');
  assert.deepEqual(pl.burgs.map(b => b.name), ['Capitale']);
  assert.equal(pl.burgs[0].pub, 'Grande ville.');
  assert.equal(pl.provinces.length, 0);
  assert.equal(pl.added.length, 0, 'un lieu ajouté reste caché tant qu\'il n\'est pas connu');
  assert.ok(!JSON.stringify(pl).includes('Secret du MJ') && !JSON.stringify(pl).includes('Valombre.md'));
  assert.deepEqual(pl.party, { x: 2, y: 3, known: true, label: 'Le groupe' });
  assert.equal(world.note('Campagne/03 - Lieux/Valombre.md').text.slice(0, 10), '# Valombre');

  const r = world.writeMap();
  assert.ok(r.touched.includes('burgs') && r.touched.includes('markers'));
  assert.ok(fs.readFileSync(worlds.mapPath('c1'), 'utf8').includes('"name":"Capitale"'));
  assert.ok(fs.readdirSync(worlds.dir('c1')).some(n => /^\d{4}-.*\.map$/.test(n)), 'la version d\'avant est gardée');

  // Une campagne sans pont ne lit aucune note, et ne voit pas le monde d'une autre.
  const other = worlds.of('c2');
  assert.equal(other.view('dm').missing, true);
  assert.deepEqual(other.notes(), []);
  worlds.setImage('c2', 'asset:x');
  assert.equal(other.view('player').mode, 'image');
  assert.throws(() => other.patchEntity('a1', { note: 'Campagne/03 - Lieux/Valombre.md' }), /Lieu introuvable|coffre/);
  db.close();
});
