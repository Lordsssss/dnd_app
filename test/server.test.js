import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, login, api, ws, PNG } from './helpers.js';

test('connexion, synchro en direct par campagne, secret jamais transmis aux autres', async () => {
  const s = await start();
  try {
    assert.equal((await login(s.base, 'ren', '0000')).status, 403);
    const ren = await login(s.base, 'ren', '1111');
    const slo = await login(s.base, 'brakka', '2222');
    const mj = await login(s.base, 'mj', '9999');
    assert.equal(ren.status, 200);
    assert.match(ren.cookie, /dndt=.*HttpOnly/);
    assert.deepEqual(ren.body.campaigns.map(c => c.id).sort(), ['c1', 'c2']);

    const ca = ws(s.port, '/ws', { t: 'hello', token: ren.body.token, campaign: 'c1' });
    const cb = ws(s.port, '/ws', { t: 'hello', token: slo.body.token, campaign: 'c1' });
    const cd = ws(s.port, '/ws', { t: 'hello', token: mj.body.token, campaign: 'c1' });
    const [wa, wb, wd] = await Promise.all([ca.next(m => m.t === 'welcome'), cb.next(m => m.t === 'welcome'), cd.next(m => m.t === 'welcome')]);
    assert.equal(wa.me.charId, s.a);
    assert.equal(wa.state.chars[s.a].data.secret.text, 'SECRET-REN');
    assert.equal(wb.state.chars[s.a].data.secret, undefined);
    assert.ok(!JSON.stringify(wb).includes('SECRET-REN'));
    assert.equal(wd.me.role, 'dm');
    assert.equal(wd.state.chars[s.a].data.secret.text, 'SECRET-REN');
    assert.ok(!Object.keys(wd.state.chars).includes(s.x), 'rien de la campagne Beta');

    ca.send({ t: 'set', doc: s.a, ops: [[['hp', 'current'], 3]], id: 1 });
    const pb = await cb.next(m => m.t === 'patch' && m.doc === s.a);
    assert.deepEqual(pb.p, [[['hp', 'current'], 3]]);
    // Le MJ modifie une fiche de sa campagne.
    const ack = await cd.request({ t: 'set', doc: s.b, ops: [[['hp', 'current'], 4]] });
    assert.equal(ack.ok, true);
    assert.equal(s.engine.docs.get(s.b).data.hp.current, 4);
    for (const c of [ca, cb, cd]) c.close();
  } finally { await s.stop(); }
});

test('isolation : un onglet d’une campagne ne reçoit rien de l’autre, un non-membre est refusé', async () => {
  const s = await start();
  try {
    const ren = await login(s.base, 'ren', '1111');
    const bea = await login(s.base, 'bea', '3333');
    const r1 = ws(s.port, '/ws', { t: 'hello', token: ren.body.token, campaign: 'c2' });
    const w1 = await r1.next(m => m.t === 'welcome');
    assert.deepEqual(Object.keys(w1.state.chars), [s.x]);
    assert.equal(w1.me.charId, s.x);
    const intrus = ws(s.port, '/ws', { t: 'hello', token: bea.body.token, campaign: 'c1' });
    const d = await intrus.next(m => m.t === 'denied');
    assert.match(d.reason, /pas partie/);
    // Un patch d’Alpha ne part pas vers l’onglet Beta.
    s.engine.handleSet({ id: 'k', role: 'dm', campaign: 'c1' }, { doc: s.a, ops: [[['hp', 'current'], 2]] });
    await assert.rejects(r1.next(m => m.t === 'patch', 300));
    const call = api(s.base, bea.body.token);
    assert.equal((await call('/api/c/c1/overview')).status, 403);
    assert.equal((await call(`/api/c/c1/characters/${s.a}`)).status, 403);
    assert.equal((await call('/api/c/c1/map/scenes')).status, 403);
    assert.equal((await call('/api/c/c1/monde')).status, 403);
    r1.close(); intrus.close();
  } finally { await s.stop(); }
});

test('jets de mort secrets de bout en bout', async () => {
  const s = await start();
  try {
    const ren = await login(s.base, 'ren', '1111');
    const slo = await login(s.base, 'brakka', '2222');
    const mj = await login(s.base, 'mj', '9999');
    s.engine.runCharAction(s.engine.docs.get(s.a), 'damage', { amount: 999 });
    const ca = ws(s.port, '/ws', { t: 'hello', token: ren.body.token, campaign: 'c1' });
    const cb = ws(s.port, '/ws', { t: 'hello', token: slo.body.token, campaign: 'c1' });
    const cd = ws(s.port, '/ws', { t: 'hello', token: mj.body.token, campaign: 'c1' });
    const [wa] = await Promise.all([ca.next(m => m.t === 'welcome'), cb.next(m => m.t === 'welcome'), cd.next(m => m.t === 'welcome')]);
    assert.equal(wa.state.chars[s.a].data.deathSaves, undefined);
    const ack = await ca.request({ t: 'act', doc: s.a, name: 'deathSave', args: { roll: 20 } });
    assert.equal(ack.ok, true);
    assert.match(ack.result.toast, /envoyé au MJ/);
    const dmRoll = await cd.next(m => m.t === 'roll');
    assert.equal(dmRoll.roll.private, true);
    assert.equal(dmRoll.roll.total, 12);
    await assert.rejects(cb.next(m => m.t === 'roll', 300), /timeout/);
    const dmPatch = await cd.next(m => m.t === 'patch' && m.p.some(([p]) => p[0] === 'deathSaves'));
    assert.ok(dmPatch);
    await assert.rejects(ca.next(m => m.t === 'patch' && m.p.some(([p]) => p[0] === 'deathSaves'), 300), /timeout/);
    for (const c of [ca, cb, cd]) c.close();
  } finally { await s.stop(); }
});

test('campagnes : création, invitation, inscription par lien, rôles', async () => {
  const s = await start({ signup: 'invite' });
  try {
    const slo = await login(s.base, 'brakka', '2222');
    const call = api(s.base, slo.body.token);
    // Sans le droit donné par l'admin, pas de campagne.
    assert.equal(slo.body.account.canCreate, false);
    const refused = await call('/api/campaigns', { method: 'POST', body: { name: 'Gamma' } });
    assert.equal(refused.status, 403);
    const mj = await login(s.base, 'mj', '9999');
    const admin = api(s.base, mj.body.token);
    assert.equal((await admin('/api/admin/accounts/u-brakka', { method: 'POST', body: { canCreate: true } })).body.account.canCreate, true);
    assert.equal((await api(s.base, slo.body.token)('/api/admin/accounts/u-brakka', { method: 'POST', body: { canCreate: true } })).status, 403);
    const c = await call('/api/campaigns', { method: 'POST', body: { name: 'Gamma' } });
    assert.equal(c.status, 200);
    const cid = c.body.id;
    const ov = await call(`/api/c/${cid}/overview`);
    assert.equal(ov.body.role, 'dm');
    // Inscription libre refusée en mode invitation.
    const pub = api(s.base, null);
    assert.equal((await pub('/api/signup', { method: 'POST', body: { name: 'Zoé', login: 'zoe', secret: 'motdepasse-long' } })).status, 403);
    const inv = await call(`/api/c/${cid}/invites`, { method: 'POST', body: { role: 'player', uses: 1 } });
    assert.match(inv.body.url, /\/invite\//);
    assert.equal((await pub(`/api/invite/${inv.body.code}`)).body.campaign.name, 'Gamma');
    assert.equal((await pub('/api/signup', { method: 'POST', body: { name: 'Zoé', login: 'zoe', secret: 'court', invite: inv.body.code } })).status, 400);
    const su = await pub('/api/signup', { method: 'POST', body: { name: 'Zoé', login: 'zoe', secret: 'motdepasse-long', invite: inv.body.code } });
    assert.equal(su.status, 200);
    assert.match(su.body.recovery, /^[A-Z0-9]{4}-/);
    assert.deepEqual(su.body.campaigns.map(x => x.role), ['player']);
    // L’invitation à usage unique ne sert plus.
    assert.equal((await pub(`/api/invite/${inv.body.code}`)).status, 404);
    // La joueuse crée sa propre fiche.
    const zoe = api(s.base, su.body.token);
    const f = await zoe(`/api/c/${cid}/characters`, { method: 'POST', body: { name: 'Lyra', className: 'Cleric', level: 3 } });
    assert.equal(f.status, 200);
    assert.equal(s.engine.docs.get(f.body.id).owner, su.body.account.id);
    assert.equal((await zoe(`/api/c/${cid}/overview`)).status, 403, 'pas de panneau MJ pour une joueuse');
    // Le MJ ne peut pas partir sans laisser un MJ.
    assert.equal((await call(`/api/c/${cid}/leave`, { method: 'POST' })).status, 400);
    // Récupération du compte avec le code.
    const rec = await pub('/api/recover', { method: 'POST', body: { login: 'zoe', code: su.body.recovery.toLowerCase(), secret: 'nouveau-secret-123' } });
    assert.equal(rec.status, 200);
    assert.equal((await login(s.base, 'zoe', 'nouveau-secret-123')).status, 200);
  } finally { await s.stop(); }
});

test('admin : comptes et campagnes de l’extérieur, sans voir le contenu', async () => {
  const s = await start();
  try {
    const mj = await login(s.base, 'mj', '9999');
    const call = api(s.base, mj.body.token);
    const ov = await call('/api/admin/overview');
    assert.equal(ov.status, 200);
    assert.ok(ov.body.campaigns.some(c => c.name === 'Beta'));
    // Admin, mais pas membre de Beta : pas de vue sur ses fiches ni sur son panneau.
    assert.equal((await call('/api/c/c2/overview')).status, 403);
    assert.equal((await call(`/api/c/c2/characters/${s.x}`)).status, 403);
    const ren = await login(s.base, 'ren', '1111');
    assert.equal((await api(s.base, ren.body.token)('/api/admin/overview')).status, 403);
    const reset = await call('/api/admin/accounts/u-ren/reset', { method: 'POST' });
    assert.match(reset.body.pin, /^\d{6}$/);
  } finally { await s.stop(); }
});

test('jetons d’API : MJ de leur campagne, rien d’autre', async () => {
  const s = await start();
  try {
    const mj = await login(s.base, 'mj', '9999');
    const t = await api(s.base, mj.body.token)('/api/c/c1/tokens', { method: 'POST', body: { label: 'Claude' } });
    assert.match(t.body.token, /^dt_/);
    const bot = api(s.base, t.body.token);
    assert.equal((await bot('/api/c/c1/characters')).status, 200);
    assert.equal((await bot(`/api/c/c1/characters/${s.a}`)).body.character.secret.text, 'SECRET-REN');
    assert.equal((await bot('/api/c/c2/characters')).status, 403);
    assert.equal((await bot('/api/admin/overview')).status, 401);
    assert.equal((await bot('/api/c/c1/tokens', { method: 'POST', body: { label: 'x' } })).status, 403);
    const sc = await bot('/api/c/c1/map/scenes', { method: 'POST', body: { name: 'Crypte', cols: 10, rows: 8 } });
    assert.equal(sc.status, 200);
    const put = await bot(`/api/c/c1/map/scenes/${sc.body.id}`, { method: 'PUT', body: { name: 'Crypte', grid: { cols: 10, rows: 8 }, walls: [{ points: [[0, 0], [5, 0]] }] } });
    assert.equal(put.status, 200);
    assert.equal((await bot(`/api/c/c1/map/scenes/${sc.body.id}`)).body.scene.walls.length, 1);
  } finally { await s.stop(); }
});

test('images : envoi par le MJ, lecture par les membres seulement, type vérifié', async () => {
  const s = await start();
  try {
    const mj = await login(s.base, 'mj', '9999');
    const call = api(s.base, mj.body.token);
    assert.equal((await call('/api/c/c1/assets?kind=map&name=x.png', { method: 'POST', raw: Buffer.from('pas une image'), headers: { 'Content-Type': 'image/png' } })).status, 415);
    const up = await call('/api/c/c1/assets?kind=map&name=crypte.png', { method: 'POST', raw: PNG, headers: { 'Content-Type': 'image/png' } });
    assert.equal(up.status, 200);
    assert.equal(up.body.width, 64);
    const ren = await login(s.base, 'ren', '1111');
    const bea = await login(s.base, 'bea', '3333');
    const viaCookie = await fetch(`${s.base}/api/file?ref=${encodeURIComponent(up.body.ref)}`, { headers: { Cookie: ren.cookie.split(';')[0] } });
    assert.equal(viaCookie.status, 200);
    assert.equal((await api(s.base, bea.body.token)(`/api/file?ref=${encodeURIComponent(up.body.ref)}`)).status, 403);
    // Le cookie ne vaut pas pour une écriture.
    const post = await fetch(`${s.base}/api/c/c1/invites`, { method: 'POST', headers: { Cookie: mj.cookie.split(';')[0] }, body: '{}' });
    assert.equal(post.status, 401);
    assert.equal((await api(s.base, ren.body.token)('/api/c/c1/assets?kind=map&name=x.png', { method: 'POST', raw: PNG })).status, 403);
  } finally { await s.stop(); }
});

test('fiches écrites hors de l’application : modèle, vérification, import refusé si cassé, guide', async () => {
  const s = await start();
  try {
    const mj = await login(s.base, 'mj', '9999');
    const call = api(s.base, mj.body.token);
    const tpl = await call('/api/c/c1/sheet/template');
    assert.equal(tpl.status, 200);
    assert.match(tpl.body.prompt, /word for word/);
    const ok = await call('/api/c/c1/sheet/check', { method: 'POST', body: tpl.body.example });
    assert.deepEqual(ok.body.errors, []);
    const bad = { character: { name: 'Cassé', classes: [{ name: 'Fighter', level: 40 }] } };
    assert.equal((await call('/api/c/c1/sheet/check', { method: 'POST', body: bad })).body.errors.length, 1);
    assert.equal((await call('/api/c/c1/characters', { method: 'POST', body: { data: bad, owner: null } })).status, 400);
    assert.equal((await call(`/api/c/c1/characters/${s.a}`, { method: 'PUT', body: bad })).status, 400);
    const made = await call('/api/c/c1/characters', { method: 'POST', body: { data: tpl.body.example, owner: null } });
    assert.equal(made.status, 200);
    assert.equal(s.engine.docs.get(made.body.id).data.name, 'Mira Thornwood');
    // Un joueur d'une autre campagne n'y a pas accès ; le guide se lit sans compte.
    const bea = await login(s.base, 'bea', '3333');
    assert.equal((await api(s.base, bea.body.token)('/api/c/c1/sheet/template')).status, 403);
    const guide = await fetch(`${s.base}/api/guide.md`);
    assert.equal(guide.status, 200);
    assert.match(await guide.text(), /# Setting up a campaign/);
  } finally { await s.stop(); }
});
