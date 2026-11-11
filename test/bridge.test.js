import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start, login, api } from './helpers.js';
import { normalizeBridge } from '../server/bridge.js';

function fakeVault() {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-vault-'));
  fs.mkdirSync(path.join(v, 'Aventures'), { recursive: true });
  fs.mkdirSync(path.join(v, 'Sessions', 'Session 4'), { recursive: true });
  fs.mkdirSync(path.join(v, 'Lieux'), { recursive: true });
  fs.writeFileSync(path.join(v, 'Aventures', 'Crypte.md'), [
    '# La crypte', '',
    '> [!danger] 💀 Goule ancienne — homebrew · Mort-vivant de taille M',
    '> **Initiative +3** · **CA 14** · **PV 40**',
    '> **Griffes :** `2d6+2`', '',
    '> [!danger] Consigne', '> Ne pas tuer le groupe.', '',
  ].join('\n'));
  fs.writeFileSync(path.join(v, 'Lieux', 'Village.md'), '# Village\n');
  fs.writeFileSync(path.join(v, 'notes-perso.md'), 'hors du pont');
  return v;
}

test('pont vers un coffre : export des fiches, import des blocs de stats, une seule campagne par coffre', async () => {
  const s = await start();
  try {
    const vault = fakeVault();
    const bridge = normalizeBridge({ vaultDir: vault, exportPath: 'Personnages', sessionsPath: 'Sessions', notesDirs: 'Aventures', worldNotesRoot: 'Lieux' });
    const mj = await login(s.base, 'mj', '9999');
    const call = api(s.base, mj.body.token);

    // Sans pont : rien.
    assert.equal((await call('/api/c/c1/export', { method: 'POST', body: {} })).status, 400);
    assert.equal((await call('/api/c/c1/bestiary/sync', { method: 'POST' })).status, 400);

    // L'admin relie la campagne Alpha ; la même adresse est refusée pour Beta.
    assert.equal((await call('/api/admin/campaigns/c1/bridge', { method: 'POST', body: { bridge } })).status, 200);
    const clash = await call('/api/admin/campaigns/c2/bridge', { method: 'POST', body: { bridge } });
    assert.equal(clash.status, 400);
    assert.match(clash.body.error, /déjà relié/);
    const ren = await login(s.base, 'ren', '1111');
    assert.equal((await api(s.base, ren.body.token)('/api/admin/campaigns/c1/bridge', { method: 'POST', body: { bridge } })).status, 403);

    const ov = await call('/api/c/c1/overview');
    assert.equal(ov.body.bridge.suggestedSession, 4, 'la dernière session jouée, d’après le dossier des sessions');

    const r = await call('/api/c/c1/export', { method: 'POST', body: { session: 5 } });
    assert.equal(r.status, 200);
    const files = fs.readdirSync(path.join(vault, 'Personnages'));
    assert.ok(files.includes('Ren - Fiche.md') && files.includes('Brakka - Fiche.md'));
    assert.ok(!files.some(f => f.startsWith('Ren-Beta')), 'rien de la campagne Beta');
    assert.match(fs.readFileSync(path.join(vault, 'Personnages', 'Ren - Fiche.md'), 'utf8'), /generated_by: dnd-sheet/);

    const sync = await call('/api/c/c1/bestiary/sync', { method: 'POST' });
    assert.deepEqual(sync.body, { added: 1, updated: 0 }, 'la consigne n’est pas un bloc de stats');
    const beasts = (await call('/api/c/c1/bestiary')).body;
    assert.equal(beasts[0].name, 'Goule ancienne');
    assert.equal(beasts[0].ac, 14);
    assert.equal(beasts[0].hp, 40);
    assert.equal(beasts[0].init, 3);
    assert.deepEqual((await call('/api/c/c1/bestiary/sync', { method: 'POST' })).body, { added: 0, updated: 1 }, 'une deuxième synchro met à jour');

    // Notes du monde : seulement sous la racine choisie.
    const bea = await login(s.base, 'bea', '3333');
    assert.deepEqual((await api(s.base, bea.body.token)('/api/c/c2/monde/notes')).body, [], 'Beta n’a pas de pont');
    assert.deepEqual((await call('/api/c/c1/monde/notes')).body, ['Lieux/Village.md']);
    assert.equal((await call(`/api/c/c1/monde/note?file=${encodeURIComponent('notes-perso.md')}`)).status, 400);
  } finally { await s.stop(); }
});
