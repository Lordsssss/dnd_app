// L'onglet « Carte » des joueurs : ce qu'ils reçoivent, les tokens qu'ils déplacent, la vue
// verrouillée par le MJ, et le calque des images collées et des dessins, avec les droits que le
// MJ donne ou retire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, login, api, ws, PNG } from './helpers.js';
import { isPrivateAddress } from '../server/map/fetchimg.js';

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

// Une carte de 20 × 10 cases sur la TV, un mur vertical en x = 10, un PJ par joueur, un ennemi
// caché, et une fiche liée par son nom.
async function setup() {
  const s = await start();
  const mj = await login(s.base, 'mj', '9999');
  const ren = await login(s.base, 'ren', '1111');
  const brakka = await login(s.base, 'brakka', '2222');
  const call = api(s.base, mj.body.token);
  const up = await call('/api/c/c1/assets?kind=map&name=crypte.png', { method: 'POST', raw: PNG });
  const scene = (await call('/api/c/c1/map/scenes', { method: 'POST', body: { name: 'Crypte', image: up.body.ref, cols: 20, rows: 10 } })).body.id;
  const socks = [];
  const open = (...a) => { const c = ws(...a); socks.push(c); return c; };
  const dm = open(s.port, '/ws/map', { t: 'hello', token: mj.body.token, campaign: 'c1', role: 'dm' });
  await dm.next(m => m.t === 'welcome');
  await dm.request({ t: 'open', scene });
  await dm.request({ t: 'tvScene', scene });
  await dm.request({ t: 'op', scene, op: { type: 'wall.add', points: [[10, 0], [10, 10]] } });
  await dm.request({ t: 'op', scene, op: { type: 'token.add', tokens: [
    { id: 'pr', kind: 'pc', name: 'Ren', x: 2.5, y: 2.5, hp: { current: 9, max: 14 }, notes: 'NOTE-MJ' },
    { id: 'pb', kind: 'pc', name: 'Brakka', x: 3.5, y: 2.5, ref: { t: 'char', id: s.b } },
    { id: 'loup', kind: 'ally', name: 'Loup', x: 4.5, y: 2.5, vision: true },
    { id: 'gob', kind: 'enemy', name: 'Gobelin', x: 5.5, y: 2.5, hp: { current: 7, max: 7 } },
    { id: 'cache', kind: 'enemy', name: 'Assassin', x: 6.5, y: 2.5, hidden: true },
  ] } });
  await dm.request({ t: 'op', scene, op: { type: 'fight.create' } }).catch(() => {});
  const player = async (who, token) => {
    const c = open(s.port, '/ws/map', { t: 'hello', token, campaign: 'c1', role: 'player' });
    const welcome = await c.next(m => m.t === 'welcome');
    const table = await c.next(m => m.t === 'table');
    const sc = await c.next(m => m.t === 'scene');
    await c.next(m => m.t === 'overlay');
    return Object.assign(c, { welcome, table, scene: sc, who });
  };
  // Toutes les connexions fermées, même après un échec : sinon le serveur ne s'arrête pas.
  const stop = async () => { for (const c of socks) c.close(); await s.stop(); };
  return { s, mj, ren, brakka, call, scene, dm, player, open, stop };
}

test('un joueur voit la carte de la TV, sans tokens cachés, PV, notes, initiative ni liste des cartes', async () => {
  const x = await setup();
  try {
    const p = await x.player('ren', x.ren.body.token);
    assert.deepEqual(p.welcome.scenes, [], 'pas de liste des cartes');
    assert.equal(p.scene.scene, x.scene);
    const ids = p.scene.doc.tokens.map(t => t.id);
    assert.ok(!ids.includes('cache'), 'pas de token caché');
    assert.equal(p.scene.doc.fight, null);
    const raw = JSON.stringify(p.scene);
    assert.ok(!/NOTE-MJ|Assassin|"hp"|"current"|canUndo|undoLabel/.test(raw));
    assert.equal(p.scene.doc.tokens.find(t => t.id === 'pr').own, true, 'son PJ, trouvé par le nom de sa fiche');
    assert.equal(p.scene.doc.tokens.find(t => t.id === 'pb').own, undefined);
    assert.equal(p.table.canDraw, true);
    assert.equal(p.table.table.muted, undefined, 'la liste des joueurs privés de dessin reste au MJ');

    // Le MJ révèle un token : le joueur le reçoit filtré, sans PV.
    await x.dm.request({ t: 'op', scene: x.scene, op: { type: 'token.update', id: 'cache', patch: { hidden: false } } });
    const u = await p.next(m => m.t === 'update' && m.set?.tokens?.some(t => t.id === 'cache'));
    assert.ok(!/"hp"|NOTE-MJ/.test(JSON.stringify(u)));

    // Un joueur ne fait rien d'autre que déplacer ses tokens, coller des images et dessiner.
    for (const m of [{ t: 'open', scene: x.scene }, { t: 'tvScene', scene: x.scene }, { t: 'undo', scene: x.scene }, { t: 'table', patch: { lock: true } }, { t: 'summon' }]) {
      assert.equal((await p.request(m)).ok, false, m.t);
    }
    assert.equal((await p.request({ t: 'op', scene: x.scene, op: { type: 'token.remove', ids: ['gob'] } })).ok, false);
    assert.equal((await p.request({ t: 'op', scene: x.scene, op: { type: 'token.update', id: 'pr', patch: { hidden: true } } })).ok, false);
    p.close();
  } finally { await x.stop(); }
});

test('onglet joueur : refusé hors de la campagne, et la page est servie', async () => {
  const s = await start();
  try {
    const bea = await login(s.base, 'bea', '3333');
    const c = ws(s.port, '/ws/map', { t: 'hello', token: bea.body.token, campaign: 'c1', role: 'player' });
    assert.match((await c.next(m => m.t === 'denied')).reason, /campagne/);
    c.close();
    const ren = await login(s.base, 'ren', '1111');
    const d = ws(s.port, '/ws/map', { t: 'hello', token: ren.body.token, campaign: 'c1', role: 'tv' });
    assert.match((await d.next(m => m.t === 'denied')).reason, /MJ/, 'un joueur n’ouvre pas la TV');
    d.close();
    assert.equal((await fetch(`${s.base}/c/c1/carte/joueur`)).status, 200);
  } finally { await s.stop(); }
});

test('un joueur déplace ses tokens, jamais ceux des autres, ni à travers un mur, ni quand le MJ bloque ou gèle', async () => {
  const x = await setup();
  try {
    const ren = await x.player('ren', x.ren.body.token);
    const brakka = await x.player('brakka', x.brakka.body.token);
    const move = (p, id, nx, ny) => p.request({ t: 'op', scene: x.scene, op: { type: 'token.move', moves: [{ id, x: nx, y: ny }] } });

    assert.equal((await move(ren, 'pr', 2.5, 5.5)).ok, true);
    const seen = await brakka.next(m => m.t === 'update' && m.set?.tokens);
    assert.equal(seen.set.tokens.find(t => t.id === 'pr').y, 5.5, 'les autres onglets suivent');
    assert.equal(seen.set.tokens.find(t => t.id === 'pb').own, true, 'chaque onglet garde ses propres tokens');

    assert.match((await move(ren, 'pb', 1.5, 1.5)).error, /pas à toi/);
    assert.match((await move(ren, 'gob', 1.5, 1.5)).error, /pas à toi/);
    assert.match((await move(ren, 'pr', 12.5, 5.5)).error, /mur/);
    assert.match((await move(ren, 'pr', 40, 5)).error, /Hors/);
    assert.equal((await move(brakka, 'pb', 3.5, 6.5)).ok, true, 'fiche liée au token');

    // Le MJ donne le loup à Ren.
    assert.match((await move(ren, 'loup', 4.5, 6.5)).error, /pas à toi/);
    await x.dm.request({ t: 'op', scene: x.scene, op: { type: 'token.update', id: 'loup', patch: { control: ['u-ren'] } } });
    await ren.next(m => m.t === 'update' && m.set?.tokens?.find(t => t.id === 'loup')?.own);
    assert.equal((await move(ren, 'loup', 4.5, 6.5)).ok, true);

    await x.dm.request({ t: 'table', patch: { blockTokens: true } });
    assert.equal((await ren.next(m => m.t === 'table' && m.table.blockTokens)).table.blockTokens, true);
    assert.match((await move(ren, 'pr', 2.5, 6.5)).error, /bloqué/);
    await x.dm.request({ t: 'table', patch: { blockTokens: false } });
    await x.dm.request({ t: 'op', scene: x.scene, op: { type: 'frozen.set', value: true } });
    assert.match((await move(ren, 'pr', 2.5, 6.5)).error, /gelée/);
    await x.dm.request({ t: 'op', scene: x.scene, op: { type: 'frozen.set', value: false } });
    assert.equal((await move(ren, 'pr', 2.5, 6.5)).ok, true);

    // Le MJ annule le déplacement d'un joueur.
    await x.dm.request({ t: 'undo', scene: x.scene });
    assert.equal(x.s.app.map.storeOf('c1').open(x.scene).doc.tokens.find(t => t.id === 'pr').y, 5.5);
    ren.close();
    brakka.close();
  } finally { await x.stop(); }
});

test('vue verrouillée et rappel : les joueurs reçoivent l’ordre, la TV aussi suit les réglages', async () => {
  const x = await setup();
  try {
    const ren = await x.player('ren', x.ren.body.token);
    assert.equal(ren.table.table.lock, false);
    await x.dm.request({ t: 'table', patch: { lock: true } });
    assert.equal((await ren.next(m => m.t === 'table')).table.lock, true);
    await x.dm.request({ t: 'summon' });
    await ren.next(m => m.t === 'summon');
    // Le cadrage de la TV arrive aux joueurs : c'est ce que la vue verrouillée suit.
    await x.dm.request({ t: 'op', scene: x.scene, op: { type: 'tv.camera', camera: { x: 1, y: 1, w: 8, h: 4 } } });
    assert.deepEqual((await ren.next(m => m.t === 'update' && m.set?.tvCamera)).set.tvCamera, { x: 1, y: 1, w: 8, h: 4 });
    ren.close();
  } finally { await x.stop(); }
});

test('images et dessins : chacun colle, dessine et n’efface que ce qu’il a posé ; le MJ coupe les droits', async () => {
  const x = await setup();
  try {
    const tv = x.open(x.s.port, '/ws/map', { t: 'hello', token: x.mj.body.token, campaign: 'c1', role: 'tv' });
    await tv.next(m => m.t === 'overlay');
    const ren = await x.player('ren', x.ren.body.token);
    const brakka = await x.player('brakka', x.brakka.body.token);
    const rcall = api(x.s.base, x.ren.body.token);
    const add = (p, item) => p.request({ t: 'draw', action: 'add', item });

    // Une image envoyée par un joueur : rangée dans « Images collées », jamais un SVG.
    const img = await rcall('/api/c/c1/assets?kind=paste&name=chat.png', { method: 'POST', raw: PNG });
    assert.equal(img.status, 200);
    assert.match(img.body.ref, /^asset:/);
    assert.equal(x.s.db.getAsset(img.body.ref.slice(6)).folder, 'Images collées');
    assert.equal((await rcall('/api/c/c1/assets?kind=paste&name=x.svg', { method: 'POST', raw: SVG })).status, 415);
    assert.equal((await rcall('/api/c/c1/assets?kind=paste&name=big.png', { method: 'POST', raw: Buffer.concat([PNG, Buffer.alloc(5_000_100)]) })).status, 413);
    assert.equal((await rcall('/api/c/c1/assets?kind=token&name=x.png', { method: 'POST', raw: PNG })).status, 403, 'un joueur n’envoie pas de token');

    const pic = await add(ren, { kind: 'image', image: img.body.ref, x: 3, y: 3, size: 4, top: 'LÉGENDE', attach: 'gob' });
    assert.equal(pic.ok, true);
    const onTv = (await tv.next(m => m.t === 'itemSet')).item;
    assert.deepEqual(Object.keys(onTv).sort(), ['at', 'by', 'byName', 'id', 'image', 'kind', 'size', 'x', 'y'], 'une image, sans légende ni token');
    assert.equal((await brakka.next(m => m.t === 'itemSet')).item.by, 'u-ren');
    assert.equal((await add(ren, { kind: 'image', image: 'asset:inconnu', x: 1, y: 1 })).ok, false);
    assert.equal((await add(ren, { kind: 'text', text: 'lol', x: 1, y: 1 })).ok, false, 'pas de texte : seulement des images et des traits');

    // Un trait : ses points, sa couleur et son épaisseur ; le reste est ramené aux choix permis.
    const line = await add(brakka, { kind: 'stroke', points: [[1, 1], [1, 1], [2, 2.004], [3, 2]], color: '#e40712', width: 0.12 });
    assert.equal(line.ok, true);
    const drawn = (await ren.next(m => m.t === 'itemSet' && m.item.kind === 'stroke')).item;
    assert.deepEqual(drawn.points, [[1, 1], [2, 2], [3, 2]]);
    const odd = await add(brakka, { kind: 'stroke', points: [[4, 4]], color: 'javascript:alert(1)', width: 99 });
    const oddItem = (await ren.next(m => m.t === 'itemSet' && m.item.id === odd.itemId)).item;
    assert.equal(oddItem.color, '#e40712');
    assert.equal(oddItem.width, 0.12);
    assert.equal(oddItem.points.length, 2, 'un clic laisse un point visible');
    assert.equal((await add(brakka, { kind: 'stroke', points: 'cassé' })).ok, false);

    // Chacun ne touche qu'à ce qu'il a posé, le MJ compris.
    assert.match((await ren.request({ t: 'draw', action: 'remove', ids: [line.itemId] })).error, /pas à toi/);
    assert.match((await x.dm.request({ t: 'draw', action: 'remove', ids: [line.itemId] })).error, /pas à toi/);
    assert.match((await brakka.request({ t: 'draw', action: 'update', itemId: line.itemId, patch: { x: 2 } })).error, /trait/);
    assert.equal((await ren.request({ t: 'draw', action: 'update', itemId: pic.itemId, patch: { x: 6, size: 5 } })).ok, true);
    assert.equal((await brakka.next(m => m.t === 'itemSet' && m.item.id === pic.itemId)).item.x, 6);
    assert.equal((await brakka.request({ t: 'draw', action: 'remove', ids: [line.itemId] })).ok, true);
    assert.deepEqual((await ren.next(m => m.t === 'itemGone')).ids, [line.itemId]);

    // Tout effacer : seulement ce que ce joueur a posé sur cette carte.
    await add(brakka, { kind: 'stroke', points: [[5, 5], [6, 6]] });
    await ren.next(m => m.t === 'itemSet' && m.item.by === 'u-brakka');
    assert.equal((await brakka.request({ t: 'draw', action: 'clearMine' })).ok, true);
    const gone = await ren.next(m => m.t === 'itemGone');
    assert.equal(gone.ids.length, 2, 'les deux traits de Brakka');
    const left = x.s.db.db.prepare('SELECT id FROM map_overlay').all().map(r => r.id);
    assert.deepEqual(left, [pic.itemId], 'l’image de Ren reste');
    ren.msgs.length = 0;

    // La TV sans images ni dessins : elle reçoit une liste vide, puis plus rien.
    await x.dm.request({ t: 'table', patch: { onTv: false } });
    assert.deepEqual((await tv.next(m => m.t === 'overlay')).items, []);
    tv.msgs.length = 0;
    await add(brakka, { kind: 'stroke', points: [[7, 7], [8, 8]] });
    await ren.next(m => m.t === 'itemSet');
    assert.ok(!tv.msgs.some(m => m.t === 'itemSet'), 'la TV ne reçoit plus rien');

    // Un joueur privé d'images et de dessins : refusé partout ; le MJ efface ce qu'il a posé.
    await x.dm.request({ t: 'table', patch: { muted: ['u-ren', 'u-inconnu'] } });
    assert.deepEqual(x.s.app.campaigns.settings('c1').table.muted, ['u-ren'], 'seulement des membres');
    assert.equal((await ren.next(m => m.t === 'table' && !m.canDraw)).canDraw, false);
    assert.equal((await brakka.next(m => m.t === 'table' && m.canDraw)).canDraw, true);
    assert.match((await add(ren, { kind: 'stroke', points: [[1, 1], [2, 2]] })).error, /coupé/);
    assert.match((await ren.request({ t: 'draw', action: 'update', itemId: pic.itemId, patch: { x: 2 } })).error, /coupé/);
    assert.match((await ren.request({ t: 'draw', action: 'clearMine' })).error, /coupé/);
    assert.equal((await rcall('/api/c/c1/assets?kind=paste&name=chat.png', { method: 'POST', raw: PNG })).status, 403);
    assert.equal((await brakka.request({ t: 'draw', action: 'wipe', account: 'u-ren' })).ok, false, 'effacer un joueur reste au MJ');
    assert.equal((await x.dm.request({ t: 'draw', action: 'wipe', account: 'u-ren' })).ok, true);
    assert.deepEqual((await brakka.next(m => m.t === 'itemGone' && m.ids.includes(pic.itemId))).ids, [pic.itemId]);

    // Tout couper pour les joueurs ; le MJ garde le droit de coller.
    await x.dm.request({ t: 'table', patch: { draw: false, muted: [] } });
    assert.equal((await brakka.next(m => m.t === 'table' && !m.canDraw)).canDraw, false);
    assert.equal((await add(x.dm, { kind: 'image', image: img.body.ref, x: 1, y: 1 })).ok, true);
  } finally { await x.stop(); }
});

test('routes de la table : une autre campagne a un 403, et une adresse privée n’est jamais chargée', async () => {
  const x = await setup();
  try {
    const bea = api(x.s.base, (await login(x.s.base, 'bea', '3333')).body.token);
    const rcall = api(x.s.base, x.ren.body.token);
    assert.equal((await bea('/api/c/c1/map/players')).status, 403);
    assert.equal((await bea('/api/c/c1/map/overlay/fetch', { method: 'POST', body: { url: 'https://example.com/a.png' } })).status, 403);
    assert.equal((await bea('/api/c/c1/assets?kind=paste', { method: 'POST', raw: PNG })).status, 403);
    assert.equal((await rcall('/api/c/c1/map/players')).status, 403, 'la liste des joueurs reste au MJ');

    const players = (await x.call('/api/c/c1/map/players')).body;
    assert.deepEqual(players.map(p => p.name).sort(), ['Brakka', 'Ren']);
    assert.equal(players.find(p => p.name === 'Ren').chars[0].name, 'Ren');

    for (const url of [`http://127.0.0.1:${x.s.port}/icons/icon.svg`, 'http://localhost/a.png', 'http://[::1]/a.png', 'http://10.0.0.1/a.png', 'file:///etc/passwd', 'http://169.254.169.254/latest/meta-data', 'https://example.com:8443/a.png']) {
      const r = await rcall('/api/c/c1/map/overlay/fetch', { method: 'POST', body: { url } });
      assert.equal(r.status, 400, url);
    }
    assert.ok(isPrivateAddress('192.168.1.10'));
    assert.ok(isPrivateAddress('::ffff:127.0.0.1'));
    assert.ok(isPrivateAddress('fd00::1'));
    assert.ok(!isPrivateAddress('93.184.216.34'));
  } finally { await x.stop(); }
});

test('migration 8 : les images déjà posées restent, le texte, les légendes et la mèmothèque partent', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { MIGRATIONS, runMigrations } = await import('../server/migrations.js');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at INTEGER)');
  runMigrations(db, MIGRATIONS.filter(m => m.id <= 7));
  const put = db.prepare('INSERT INTO map_memes (campaign_id, scene, id, data, account, expires, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  put.run('c1', 's', 'm1', JSON.stringify({ id: 'm1', kind: 'image', image: 'asset:f1', x: 2, y: 3, size: 4, top: 'HAUT', attach: null, by: 'u-ren', byName: 'Ren', at: 1 }), 'u-ren', null, 1);
  put.run('c1', 's', 'm2', JSON.stringify({ id: 'm2', kind: 'text', text: 'lol', x: 1, y: 1, by: 'u-ren', at: 2 }), 'u-ren', null, 2);
  put.run('c1', 's', 'm3', JSON.stringify({ id: 'm3', kind: 'image', image: 'asset:f2', x: 1, y: 1, size: 2, attach: 't1', by: 'u-ren', at: 3 }), 'u-ren', null, 3);
  db.prepare("INSERT INTO assets (id, campaign_id, kind, name, mime, size, sha256, file, folder) VALUES ('f1', 'c1', 'meme', 'chat.png', 'image/png', 1, 'x', 'x', 'Memes')").run();
  db.prepare("INSERT INTO campaigns (id, name, settings) VALUES ('c1', 'Alpha', ?)").run(JSON.stringify({ edition: '2024', table: { lock: true, memes: false, memesOnTv: false, serious: true, muted: ['u-ren'] } }));
  runMigrations(db, MIGRATIONS.filter(m => m.id === 8));
  const rows = db.prepare('SELECT id, data FROM map_overlay').all();
  assert.deepEqual(rows.map(r => r.id), ['m1']);
  assert.deepEqual(JSON.parse(rows[0].data), { id: 'm1', kind: 'image', image: 'asset:f1', x: 2, y: 3, size: 4, by: 'u-ren', byName: 'Ren', at: 1 });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  assert.ok(!tables.includes('map_memes') && !tables.includes('meme_shelf'));
  assert.deepEqual({ ...db.prepare("SELECT kind, folder FROM assets WHERE id = 'f1'").get() }, { kind: 'paste', folder: 'Images collées' });
  const settings = JSON.parse(db.prepare("SELECT settings FROM campaigns WHERE id = 'c1'").get().settings);
  assert.deepEqual(settings, { edition: '2024', table: { lock: true, blockTokens: false, draw: false, muted: ['u-ren'], onTv: false } });
  db.close();
});
