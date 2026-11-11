import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTokenName, TokenCatalog } from '../server/map/tokens.js';
import { nameFromTitle, parseStatBlocks } from '../server/map/notes.js';
import { renderNote } from '../shared/map/markdown.js';
import { start, login, api, ws, PNG } from './helpers.js';

async function startMap() {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-lib-'));
  fs.mkdirSync(path.join(lib, 'FA_Tokens/Creatures/Beast'), { recursive: true });
  fs.writeFileSync(path.join(lib, 'FA_Tokens/Creatures/Beast/Stirge_A1_Tiny_Beast_01.png'), PNG);
  fs.writeFileSync(path.join(lib, 'notes.md'), 'non');
  const s = await start({ library: lib });
  const mj = await login(s.base, 'mj', '9999');
  return { ...s, lib, token: mj.body.token, call: api(s.base, mj.body.token) };
}

test('la carte est réservée au MJ de la campagne : ni joueurs, ni MJ d’une autre campagne', async () => {
  const s = await startMap();
  try {
    assert.equal((await api(s.base, null)('/api/c/c1/map/images')).status, 401);
    const ren = await login(s.base, 'ren', '1111');
    assert.equal((await api(s.base, ren.body.token)('/api/c/c1/map/images')).status, 403);
    const bea = await login(s.base, 'bea', '3333');
    assert.equal((await api(s.base, bea.body.token)('/api/c/c1/map/scenes')).status, 403);
    for (const [token, campaign] of [[ren.body.token, 'c1'], [bea.body.token, 'c1'], [s.token, 'c2']]) {
      const c = ws(s.port, '/ws/map', { t: 'hello', token, campaign });
      assert.match((await c.next(m => m.t === 'denied')).reason, /MJ/);
      c.close();
    }
    assert.equal((await fetch(`${s.base}/c/c1/carte`)).status, 200);
    assert.equal((await fetch(`${s.base}/c/c1/carte/tv`)).status, 200);
    assert.equal((await fetch(`${s.base}/c/c1/monde`)).status, 200);
  } finally { await s.stop(); }
});

test('bibliothèque globale : seulement des images, jamais hors du dossier', async () => {
  const s = await startMap();
  try {
    const get = ref => s.call(`/api/file?ref=${encodeURIComponent(ref)}`).then(r => r.status);
    assert.equal(await get('lib:FA_Tokens/Creatures/Beast/Stirge_A1_Tiny_Beast_01.png'), 200);
    assert.equal(await get('lib:notes.md'), 404);
    assert.equal(await get('lib:../f.sqlite'), 404);
    assert.equal(await get('lib:../../etc/passwd'), 404);
    const found = await s.call('/api/c/c1/map/tokens?q=stirge');
    assert.equal(found.body[0].path, 'lib:FA_Tokens/Creatures/Beast/Stirge_A1_Tiny_Beast_01.png');
    const up = await s.call('/api/c/c1/assets?kind=token&name=Gobelin_A1_Small_Humanoid_01.png', { method: 'POST', raw: PNG });
    const mine = await s.call('/api/c/c1/map/tokens?q=gobelin');
    assert.equal(mine.body[0].path, up.body.ref);
    const bea = await login(s.base, 'bea', '3333');
    assert.equal((await api(s.base, bea.body.token)('/api/c/c2/map/tokens?q=gobelin')).body.length, 0, 'un token envoyé reste dans sa campagne');
  } finally { await s.stop(); }
});

test('images de la campagne rangées en dossiers : envoi, déplacement, recherche', async () => {
  const s = await startMap();
  try {
    const PNG2 = Buffer.concat([PNG, Buffer.from([1])]);
    const tok = await s.call('/api/c/c1/assets?kind=token&name=Orc_Large.png&folder=Donjon%202', { method: 'POST', raw: PNG });
    assert.equal(tok.body.folder, 'Donjon 2');
    const map = await s.call('/api/c/c1/assets?kind=map&name=crypte.png&folder=Session/8', { method: 'POST', raw: PNG2 });
    assert.equal(map.body.folder, 'Session-8', 'pas de sous-dossier : la barre devient un tiret');
    assert.equal((await s.call('/api/c/c1/map/images')).body[0].folder, 'Session-8');
    // Rangée dans les résultats de recherche des tokens sous « Campagne / dossier ».
    assert.equal((await s.call('/api/c/c1/map/tokens?q=orc')).body[0].folder, 'Campagne / Donjon 2');
    await s.call(`/api/c/c1/assets/${tok.body.id}`, { method: 'PATCH', body: { folder: 'Gobelins' } });
    assert.equal((await s.call('/api/c/c1/assets?kind=token')).body.find(a => a.id === tok.body.id).folder, 'Gobelins');
    // Le même fichier renvoyé dans un autre dossier : déplacé, pas copié.
    const again = await s.call('/api/c/c1/assets?kind=token&name=Orc_Large.png&folder=Boss', { method: 'POST', raw: PNG });
    assert.equal(again.body.id, tok.body.id);
    assert.equal(again.body.folder, 'Boss');
    assert.equal((await s.call('/api/c/c1/assets?kind=token')).body.length, 1);
  } finally { await s.stop(); }
});

test('le groupe de la carte : les fiches de la campagne, rien d’une autre', async () => {
  const s = await startMap();
  try {
    const party = (await s.call('/api/c/c1/map/party')).body;
    assert.deepEqual(party.map(p => p.name).sort(), ['Brakka', 'Ren']);
  } finally { await s.stop(); }
});

test('une carte se crée, s’ouvre, se synchronise entre le portable et la TV, et reste en base', async () => {
  const s = await startMap();
  try {
    const up = await s.call('/api/c/c1/assets?kind=map&name=fontaineries.png', { method: 'POST', raw: PNG });
    const created = (await s.call('/api/c/c1/map/scenes', { method: 'POST', body: { name: 'Les Fontaineries', image: up.body.ref, cols: 20, rows: 10 } })).body;
    assert.equal(created.id, 'les-fontaineries');
    assert.equal((await s.call('/api/c/c1/map/scenes', { method: 'POST', body: { name: 'X', image: 'asset:inconnu', cols: 2, rows: 2 } })).status, 400);

    const dm = ws(s.port, '/ws/map', { t: 'hello', token: s.token, campaign: 'c1', role: 'dm' });
    const tv = ws(s.port, '/ws/map', { t: 'hello', token: s.token, campaign: 'c1', role: 'tv' });
    await dm.next(m => m.t === 'welcome');
    await tv.next(m => m.t === 'welcome');
    dm.send({ t: 'open', scene: created.id });
    await dm.next(m => m.t === 'scene');
    dm.send({ t: 'tvScene', scene: created.id });
    assert.equal((await tv.next(m => m.t === 'scene')).scene, created.id);

    dm.send({ t: 'op', id: 1, scene: created.id, op: { type: 'wall.add', points: [[10, 0], [10, 10]] } });
    const w = await tv.next(m => m.t === 'update');
    assert.equal(w.set.walls.length, 1);
    dm.send({ t: 'op', id: 2, scene: created.id, op: { type: 'token.add', tokens: [{ id: 'p', kind: 'pc', name: 'Ren', x: 5, y: 5, hp: { current: 9, max: 14 }, conditions: ['Prone'] }] } });
    const t = await tv.next(m => m.t === 'update');
    assert.equal(t.add.p.length, 1, 'la TV reçoit le contour révélé');

    // La TV ne reçoit jamais les PV exacts ni les notes, ni un token caché ; le MJ les reçoit.
    dm.send({ t: 'op', id: 4, scene: created.id, op: { type: 'token.add', tokens: [
      { id: 'g', kind: 'enemy', name: 'Gobelin', x: 6, y: 5, hp: { current: 3, max: 7 }, notes: 'Piège au nord', showHp: true },
      { id: 'h', kind: 'enemy', name: 'Assassin', x: 7, y: 5, hidden: true },
    ] } });
    const toDm = await dm.next(m => m.t === 'update' && m.set?.tokens?.some(x => x.id === 'g'));
    assert.equal(toDm.set.tokens.find(x => x.id === 'g').hp.current, 3);
    const toTv = await tv.next(m => m.t === 'update' && m.set?.tokens?.some(x => x.id === 'g'));
    assert.deepEqual(toTv.set.tokens.map(x => x.id), ['p', 'g']);
    assert.equal(toTv.set.tokens.find(x => x.id === 'g').hpBar, 0.45);
    assert.ok(!/"hp"|"current"|"max"|Piège|Assassin/.test(JSON.stringify(toTv)));
    dm.send({ t: 'op', id: 5, scene: created.id, op: { type: 'token.hp', ids: ['g'], delta: -2 } });
    const hit = await tv.next(m => m.t === 'update' && m.set?.tokens);
    assert.equal(hit.set.tokens.find(x => x.id === 'g').hpBar, 0.15);
    dm.send({ t: 'tvScene', scene: created.id });
    const reopened = await tv.next(m => m.t === 'scene');
    assert.ok(!/"hp"|"current"|Piège|Assassin/.test(JSON.stringify(reopened)), 'la scène complète passe par le même filtre');

    dm.send({ t: 'op', id: 3, scene: created.id, op: { type: 'bidon' } });
    const nack = await dm.next(m => m.t === 'ack' && m.id === 3);
    assert.equal(nack.ok, false);

    dm.send({ t: 'live', live: { ruler: { a: [1, 1], b: [2, 2] } } });
    assert.deepEqual((await tv.next(m => m.t === 'live')).live.ruler.a, [1, 1]);

    s.app.map.flush();
    const row = s.db.getScene('c1', created.id);
    assert.equal(row.scene.walls.length, 1);
    assert.equal(row.state.tokens[0].name, 'Ren');
    assert.deepEqual(row.state.tokens[0].conditions, ['Prone']);
    assert.equal(row.state.tokens[0].hp.max, 14);
    assert.equal(row.state.tokens.find(x => x.id === 'g').hp.current, 1, 'la base garde les PV exacts');

    // L’API remplace les murs : la carte ouverte suit, sans perdre les tokens.
    const put = await s.call(`/api/c/c1/map/scenes/${created.id}`, { method: 'PUT', body: { name: 'Les Fontaineries', image: up.body.ref, grid: { cols: 20, rows: 10 }, walls: [{ points: [[1, 1], [2, 2]] }, { kind: 'door', points: [[3, 3], [4, 4]] }] } });
    assert.equal(put.status, 200);
    const ext = await tv.next(m => m.t === 'update' && m.set?.walls?.length === 2);
    assert.equal(ext.set.walls[1].kind, 'door');
    assert.equal(s.app.map.storeOf('c1').open(created.id).doc.tokens.length, 3);
    assert.equal((await s.call(`/api/c/c1/map/scenes/${created.id}`, { method: 'PUT', body: { walls: 'cassé' } })).status, 400);
    dm.close();
    tv.close();
  } finally { await s.stop(); }
});

test('catalogue de tokens : le nom se lit dans le fichier, une créature retrouve son image', () => {
  assert.deepEqual(parseTokenName('Gorgon_A1_Large_Scale125_Monstrosity_01.png'), { name: 'Gorgon', size: 2 });
  assert.deepEqual(parseTokenName('Adult_Silver_Dragon_A1_Huge_Scale233_Dragon_01.png'), { name: 'Adult Silver Dragon', size: 3 });
  assert.deepEqual(parseTokenName('Owlbear_Large.png'), { name: 'Owlbear', size: 2 }, 'fichier envoyé à la main : la taille sort du nom');
  assert.deepEqual(parseTokenName('Goblin Boss.png'), { name: 'Goblin Boss', size: 1 });
  assert.deepEqual(parseTokenName('Guard_Arbalest_A2_Crossbow_01.png'), { name: 'Guard Arbalest', size: 1 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-tok-'));
  fs.mkdirSync(path.join(dir, 'FA_Tokens/Beast'), { recursive: true });
  for (const f of ['Hyena_A1_Medium_Beast_01.png', 'Dire_Hyena_A1_Large_Beast_01.png', 'Rat_A1_Tiny_Beast_01.png']) fs.writeFileSync(path.join(dir, 'FA_Tokens/Beast', f), '');
  const cat = new TokenCatalog(dir);
  assert.equal(cat.suggest('Hyena')[0].name, 'Hyena');
  assert.equal(cat.suggest('Giant Hyena')[0].name, 'Hyena');
  assert.deepEqual(cat.suggest('Otyugh'), []);
  assert.equal(cat.search('dire hy')[0].name, 'Dire Hyena');
});

test('notes : seuls les vrais blocs de stats sont repris, avec nom, nombre, initiative et lien', () => {
  const blocks = parseStatBlocks([
    '> [!danger] Garde-fous — à lire', '> Ne pas tuer Ren.', '',
    '> [!danger] [Twig Blight](https://5e.tools/bestiary.html#twig%20blight_xmm) — CR 1/8 · ×10',
    '> **CA 14** · **PV 7** (`2d6`) · **Vitesse 20 ft** · **Initiative +2**', '',
    '> [!danger] 💀 La Lie — homebrew · Aberration', '> **Initiative −2 · score 8** · **CA 15** · **PV 95**',
    '> ---', '> **Slam :** `2d6+4`', 'fin',
    '> [!danger] Ilva Renne, cheffe — CR 2 · base [Bandit Captain](https://5e.tools/bestiary.html#bandit%20captain_xmm)', '> **CA 15** · **PV 52**', '',
    '> [!danger] Rééquilibrage', '> Trois lignes de consigne.', '> Encore une.', '> Toujours rien.', '> Baisse sa CA 12 et ses PV à 20.', '',
    '> [!danger] 💀 Le Roc — homebrew · Aberration de taille TG', '> **CA 19** · **PV 200**',
  ].join('\n'));
  assert.deepEqual(blocks.map(b => b.name), ['Twig Blight', 'La Lie', 'Ilva Renne, cheffe', 'Le Roc'], 'une consigne qui cite une CA plus bas n\'est pas un bloc');
  assert.equal(blocks[3].size, 3, 'la taille écrite dans la note donne l\'emprise');
  assert.equal(blocks[0].count, 10);
  assert.equal(blocks[0].init, 2);
  assert.equal(blocks[0].link, 'https://5e.tools/bestiary.html#twig%20blight_xmm');
  assert.equal(blocks[1].init, -2);
  assert.equal(blocks[1].link, null);
  assert.equal(blocks[2].init, null);
  assert.match(blocks[2].link, /bandit%20captain/);
  assert.equal(nameFromTitle('⚔️ **Rencontre** — Facile'), 'Rencontre');
  const html = renderNote(blocks[1].body);
  assert.match(html, /<b>Slam :<\/b> <code>2d6\+4<\/code>/);
  assert.match(html, /<hr>/);
  assert.ok(!renderNote(['<script>alert(1)</script>']).includes('<script>'), 'le texte est échappé');
});

