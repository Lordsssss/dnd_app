// L'onglet « Carte » des joueurs : ce qu'ils reçoivent, les tokens qu'ils déplacent, la vue
// verrouillée par le MJ, et le calque de memes avec les droits que le MJ donne ou retire.
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
    await c.next(m => m.t === 'memes');
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
    assert.equal(p.table.canMeme, true);
    assert.equal(p.table.table.muted, undefined, 'la liste des joueurs privés de memes reste au MJ');

    // Le MJ révèle un token : le joueur le reçoit filtré, sans PV.
    await x.dm.request({ t: 'op', scene: x.scene, op: { type: 'token.update', id: 'cache', patch: { hidden: false } } });
    const u = await p.next(m => m.t === 'update' && m.set?.tokens?.some(t => t.id === 'cache'));
    assert.ok(!/"hp"|NOTE-MJ/.test(JSON.stringify(u)));

    // Un joueur ne fait rien d'autre que déplacer ses tokens, poser des memes et réagir.
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

test('memes : posés, vus par la table, effacés par leur auteur ou le MJ, coupés par le MJ', async () => {
  const x = await setup();
  try {
    const tv = x.open(x.s.port, '/ws/map', { t: 'hello', token: x.mj.body.token, campaign: 'c1', role: 'tv' });
    await tv.next(m => m.t === 'memes');
    const ren = await x.player('ren', x.ren.body.token);
    const brakka = await x.player('brakka', x.brakka.body.token);
    const rcall = api(x.s.base, x.ren.body.token);

    // Une image envoyée par un joueur : rangée dans « Memes », jamais un SVG.
    const img = await rcall('/api/c/c1/assets?kind=meme&name=chat.png', { method: 'POST', raw: PNG });
    assert.equal(img.status, 200);
    assert.match(img.body.ref, /^asset:/);
    assert.equal((await rcall('/api/c/c1/assets?kind=meme&name=x.svg', { method: 'POST', raw: SVG })).status, 415);
    assert.equal((await rcall('/api/c/c1/assets?kind=meme&name=big.png', { method: 'POST', raw: Buffer.concat([PNG, Buffer.alloc(5_000_100)]) })).status, 413);
    assert.equal((await rcall('/api/c/c1/assets?kind=token&name=x.png', { method: 'POST', raw: PNG })).status, 403, 'un joueur n’envoie pas de token');

    const add = await ren.request({ t: 'meme', action: 'add', meme: { kind: 'image', image: img.body.ref, top: 'QUAND LE MJ', bottom: 'DIT ROULEZ L’INITIATIVE', x: 3, y: 3, size: 4, ttl: null, name: 'chat.png' } });
    assert.equal(add.ok, true);
    const onTv = await tv.next(m => m.t === 'memeSet');
    assert.equal(onTv.meme.top, 'QUAND LE MJ');
    assert.equal((await brakka.next(m => m.t === 'memeSet')).meme.by, 'u-ren');
    assert.equal((await ren.request({ t: 'meme', action: 'add', meme: { kind: 'image', image: 'asset:inconnu', x: 1, y: 1 } })).ok, false);
    assert.equal((await ren.request({ t: 'meme', action: 'add', meme: { kind: 'text', text: '   ', x: 1, y: 1 } })).ok, false);

    // Un texte collé à un token caché : refusé, le joueur ne doit pas pouvoir le deviner.
    assert.match((await ren.request({ t: 'meme', action: 'add', meme: { kind: 'text', text: 'ici', x: 1, y: 1, attach: 'cache' } })).error, /introuvable/);
    const txt = await brakka.request({ t: 'meme', action: 'add', meme: { kind: 'text', text: 'THIS IS FINE', x: 5, y: 5, attach: 'gob', ttl: 10 } });
    assert.equal(txt.ok, true);
    const set = await ren.next(m => m.t === 'memeSet' && m.meme.text === 'THIS IS FINE');
    assert.equal(set.meme.attach, 'gob');
    assert.ok(set.meme.expires > Date.now());

    // Chacun ne touche qu'à ses memes ; le MJ, à tous.
    assert.match((await ren.request({ t: 'meme', action: 'remove', ids: [txt.memeId] })).error, /pas à toi/);
    assert.equal((await ren.request({ t: 'meme', action: 'update', memeId: add.memeId, patch: { x: 6, rot: 15, top: 'QUAND' } })).ok, true);
    assert.equal((await brakka.next(m => m.t === 'memeSet' && m.meme.id === add.memeId)).meme.rot, 15);
    assert.equal((await x.dm.request({ t: 'meme', action: 'remove', ids: [txt.memeId] })).ok, true);
    assert.deepEqual((await ren.next(m => m.t === 'memeGone')).ids, [txt.memeId]);

    // Réactions : seulement celles de la liste, envoyées à tous, jamais gardées.
    assert.equal((await ren.request({ t: 'react', emoji: '💀', x: 2, y: 2 })).ok, true);
    assert.equal((await brakka.next(m => m.t === 'react')).r.by, 'Ren');
    assert.equal((await tv.next(m => m.t === 'react')).r.emoji, '💀');
    assert.equal((await ren.request({ t: 'react', emoji: '<img>', x: 2, y: 2 })).ok, false);

    // La mèmothèque garde le meme posé, et se cherche par sa légende.
    const shelf = (await rcall('/api/c/c1/map/memes/shelf?q=initiative')).body;
    assert.equal(shelf.length, 1);
    assert.equal(shelf[0].image, img.body.ref);

    // La TV sans memes : elle reçoit une liste vide, puis plus rien.
    await x.dm.request({ t: 'table', patch: { memesOnTv: false } });
    assert.deepEqual((await tv.next(m => m.t === 'memes')).memes, []);
    await ren.request({ t: 'react', emoji: '🔥', x: 2, y: 2 });
    await brakka.next(m => m.t === 'react');
    assert.ok(!tv.msgs.some(m => m.t === 'react'), 'la TV ne reçoit plus les réactions');

    // Mode sérieux : rien pour les joueurs, et ils ne posent plus rien ; le MJ garde la liste.
    for (const c of [ren, brakka, x.dm]) c.msgs.length = 0;
    await x.dm.request({ t: 'table', patch: { serious: true } });
    assert.deepEqual((await ren.next(m => m.t === 'memes')).memes, []);
    const dmList = await x.dm.next(m => m.t === 'memes');
    assert.equal(dmList.memes.length, 1);
    assert.equal((await ren.next(m => m.t === 'table' && m.table.serious)).canMeme, false);
    assert.match((await ren.request({ t: 'meme', action: 'add', meme: { kind: 'text', text: 'lol', x: 1, y: 1 } })).error, /coupé/);
    ren.msgs.length = 0;
    await x.dm.request({ t: 'table', patch: { serious: false } });
    assert.equal((await ren.next(m => m.t === 'memes' && m.memes.length)).memes.length, 1);

    // Un joueur privé de memes : refusé partout, et le MJ efface tout ce qu'il a posé.
    await x.dm.request({ t: 'table', patch: { muted: ['u-ren', 'u-inconnu'] } });
    assert.deepEqual(x.s.app.campaigns.settings('c1').table.muted, ['u-ren'], 'seulement des membres');
    assert.equal((await ren.next(m => m.t === 'table' && !m.canMeme)).canMeme, false);
    assert.equal((await brakka.next(m => m.t === 'table' && !m.table.serious)).canMeme, true);
    assert.match((await ren.request({ t: 'meme', action: 'add', meme: { kind: 'text', text: 'lol', x: 1, y: 1 } })).error, /coupé/);
    assert.match((await ren.request({ t: 'meme', action: 'update', memeId: add.memeId, patch: { x: 2 } })).error, /coupé/);
    assert.match((await ren.request({ t: 'react', emoji: '💀', x: 2, y: 2 })).error, /coupé/);
    assert.equal((await rcall('/api/c/c1/assets?kind=meme&name=chat.png', { method: 'POST', raw: PNG })).status, 403);
    assert.equal((await x.dm.request({ t: 'meme', action: 'wipe', account: 'u-ren' })).ok, true);
    assert.deepEqual((await brakka.next(m => m.t === 'memeGone')).ids, [add.memeId]);
    assert.equal((await brakka.request({ t: 'meme', action: 'clear' })).ok, false, 'tout effacer reste au MJ');

    // Tout couper pour les joueurs.
    await x.dm.request({ t: 'table', patch: { memes: false, muted: [] } });
    assert.equal((await brakka.next(m => m.t === 'table' && !m.canMeme)).canMeme, false);
    assert.equal((await x.dm.request({ t: 'meme', action: 'add', meme: { kind: 'text', text: 'Le MJ a toujours le droit', x: 1, y: 1 } })).ok, true);
    ren.close();
    brakka.close();
    tv.close();
  } finally { await x.stop(); }
});

test('routes de la table : une autre campagne a un 403, et une adresse privée n’est jamais chargée', async () => {
  const x = await setup();
  try {
    const bea = api(x.s.base, (await login(x.s.base, 'bea', '3333')).body.token);
    const rcall = api(x.s.base, x.ren.body.token);
    assert.equal((await bea('/api/c/c1/map/players')).status, 403);
    assert.equal((await bea('/api/c/c1/map/memes/shelf')).status, 403);
    assert.equal((await bea('/api/c/c1/map/memes/shelf/abc', { method: 'DELETE' })).status, 403);
    assert.equal((await bea('/api/c/c1/map/memes/fetch', { method: 'POST', body: { url: 'https://example.com/a.png' } })).status, 403);
    assert.equal((await bea('/api/c/c1/assets?kind=meme', { method: 'POST', raw: PNG })).status, 403);
    assert.equal((await rcall('/api/c/c1/map/players')).status, 403, 'la liste des joueurs reste au MJ');
    assert.equal((await rcall('/api/c/c1/map/memes/shelf/abc', { method: 'DELETE' })).status, 403);

    const players = (await x.call('/api/c/c1/map/players')).body;
    assert.deepEqual(players.map(p => p.name).sort(), ['Brakka', 'Ren']);
    assert.equal(players.find(p => p.name === 'Ren').chars[0].name, 'Ren');

    for (const url of [`http://127.0.0.1:${x.s.port}/icons/icon.svg`, 'http://localhost/a.png', 'http://[::1]/a.png', 'http://10.0.0.1/a.png', 'file:///etc/passwd', 'http://169.254.169.254/latest/meta-data', 'https://example.com:8443/a.png']) {
      const r = await rcall('/api/c/c1/map/memes/fetch', { method: 'POST', body: { url } });
      assert.equal(r.status, 400, url);
    }
    assert.ok(isPrivateAddress('192.168.1.10'));
    assert.ok(isPrivateAddress('::ffff:127.0.0.1'));
    assert.ok(isPrivateAddress('fd00::1'));
    assert.ok(!isPrivateAddress('93.184.216.34'));
  } finally { await x.stop(); }
});
