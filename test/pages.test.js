// Rendu réel de chaque page de fiche, pour chaque classe et chaque point de vue (joueur, MJ,
// lecture seule) : une page qui plante à l'affichage fait échouer ce test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./browser-loader.mjs', import.meta.url);
globalThis.location = { pathname: '/c/test', protocol: 'http:', host: 'localhost' };

const { renderToString } = await import('preact-render-to-string');
const { html } = await import('/app/html.js');
const { store } = await import('/app/store.js');
const { blankCharacter, normalizeCharacter } = await import('/shared/model.js');
const { CHAR_ACTIONS } = await import('/shared/actions.js');
const { PageMain, PageCombat } = await import('/app/pages-main.js');
const { PageSpells } = await import('/app/pages-spells.js');
const { PageInventory } = await import('/app/pages-inventory.js');
const { PageNotes, PageSecret } = await import('/app/pages-notes.js');
const { PageRules } = await import('/app/pages-rules.js');
const { PageInfusions } = await import('/app/pages-infusions.js');
const { ModalHost } = await import('/app/dialogs.js');
const { DataChoices } = await import('/app/levelup-dialog.js');

const PAGES = { PageMain, PageCombat, PageSpells, PageInventory, PageNotes, PageSecret, PageRules, PageInfusions };
const CLASSES = ['Artificer', 'Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk', 'Paladin', 'Ranger', 'Rogue', 'Sorcerer', 'Warlock', 'Wizard', ''];

// Une fiche bien remplie : capacités, sorts, objets, conditions, ressources, attaques.
function sheet(className) {
  const d = blankCharacter({ name: `Test ${className || 'sans classe'}`, className, level: 6, race: 'Human' });
  d.features = 'CLASSE\n- Capacité A : texte.\n- Capacité B : texte.';
  d.spells.s1 = { name: 'Shield', level: 1, prepared: true, source: 'XPHB' };
  d.spells.s2 = { name: 'Light', level: 0 };
  d.spells.s3 = { name: 'Hex', level: 1, always: true, origin: 'subclass' };
  d.inventory.i1 = { name: 'Spell Scroll (Fireball)', qty: 1, weight: 0 };
  d.inventory.i2 = { name: 'Rope', qty: 2, weight: 5, attunement: true, attuned: true, charges: { max: 3, used: 1 } };
  d.attacks.a1 = { name: 'Dague', bonus: '+5', damage: '1d4+3', type: 'perforant' };
  d.conditions = ['Prone', 'Poisoned'];
  d.concentration = { name: 'Hex', spellId: 's3', level: 1 };
  d.exhaustion = 1;
  d.deathSaves = { success: 1, fail: 2 };
  d.infusions = className === 'Artificer' ? { x: { name: 'Enhanced Defense', item: 'Rope', active: true } } : {};
  return normalizeCharacter(d);
}

function setup(doc, role, own) {
  store.chars = { me: { v: 1, data: doc, owner: own ? 'u' : 'other' } };
  store.party = { id: 'party:test', v: 1, data: { stash: { s: { name: 'Potion of Healing', qty: 2 } }, fund: { po: 3 }, log: {} } };
  store.me = { role, charId: own ? 'me' : null, campaign: 'test', mine: own ? ['me'] : [] };
  store.view = { charId: 'me', page: 'main' };
  store.config = { ...store.config, currency: undefined, secretDeathSaves: true, edition: '2024', campaign: { name: 'Test', settings: {} } };
  store.config.currency = [{ key: 'pc', label: 'pc', value: 1 }, { key: 'pa', label: 'pa', value: 10 }, { key: 'po', label: 'po', value: 100 }];
}

test('chaque page s’affiche, pour chaque classe, en joueur, en MJ et en lecture seule', () => {
  for (const cls of CLASSES) {
    const doc = sheet(cls);
    for (const [role, own, ro] of [['player', true, false], ['dm', false, false], ['player', false, true]]) {
      setup(doc, role, own);
      for (const [name, Page] of Object.entries(PAGES)) {
        let out;
        assert.doesNotThrow(() => { out = renderToString(html`<${Page} id="me" doc=${doc} ro=${ro} />`); }, `${name} · ${cls || 'sans classe'} · ${role}${ro ? ' lecture seule' : ''}`);
        assert.ok(out.length > 50, `${name} · ${cls} rend quelque chose`);
      }
    }
  }
});

test('les fenêtres courantes s’affichent', () => {
  const doc = sheet('Wizard');
  setup(doc, 'player', true);
  const kinds = [
    { kind: 'spell', id: 'me', spellId: 's1' }, { kind: 'spell', id: 'me', spellId: 's1', edit: true }, { kind: 'settings', id: 'me' },
    { kind: 'feature', id: 'me', fid: Object.keys(doc.featureList)[0] }, { kind: 'feature', id: 'me', fid: null }, { kind: 'featureImport', id: 'me' },
    { kind: 'shortRest', id: 'me' }, { kind: 'longRest', id: 'me' }, { kind: 'condition', id: 'me', name: 'Prone' },
    { kind: 'item', id: 'me', itemId: 'i2' }, { kind: 'money', id: 'me', mode: 'pay' }, { kind: 'fund', mode: 'deposit' },
    { kind: 'give', from: 'me', itemId: 'i2' }, { kind: 'cast', id: 'me', spellId: 's1' }, { kind: 'learnScroll', id: 'me', itemId: 'i1' },
    { kind: 'confirm', title: 'T', text: 'x' },
    { kind: 'sheetCheck', name: 'Mira', report: { errors: ['abilities.str'], warnings: ['speed'] }, onOk: () => {} },
    { kind: 'sheetCheck', name: 'Mira', report: { errors: [], warnings: [] }, onOk: () => {} },
  ];
  for (const m of kinds) {
    store.ui.modal = m;
    assert.doesNotThrow(() => renderToString(html`<${ModalHost} />`), m.kind);
  }
  store.ui.modal = null;
});

test('une fiche passée de niveau 1 à 6 par le bouton reste affichable', () => {
  for (const cls of CLASSES.filter(Boolean)) {
    const d = blankCharacter({ name: 'Monte', className: cls, level: 1 });
    for (let l = 1; l < 6; l++) CHAR_ACTIONS.levelUp(d, { hpGain: 5 });
    setup(d, 'player', true);
    for (const [name, Page] of Object.entries(PAGES)) assert.doesNotThrow(() => renderToString(html`<${Page} id="me" doc=${d} ro=${false} />`), `${name} · ${cls}`);
  }
});

test('fenêtre Level up : chaque classe à un niveau qui demande un choix', () => {
  for (const [cls, lvl, sub] of [['Barbarian', 2], ['Wizard', 1], ['Cleric', 6], ['Druid', 6], ['Bard', 9], ['Bard', 2, ''], ['Artificer', 18, 'Artillerist'], ['Fighter', 18, 'Champion'], ['Ranger', 6, 'Hunter']]) {
    const d = normalizeCharacter(blankCharacter({ name: 'Monte', className: cls, level: lvl }));
    if (sub) d.classes[0].subclass = sub;
    setup(d, 'player', true);
    store.ui.modal = { kind: 'levelUp', id: 'me' };
    let out;
    assert.doesNotThrow(() => { out = renderToString(html`<${ModalHost} />`); }, `${cls} ${lvl}`);
    assert.match(out, /Level up/);
  }
  store.ui.modal = null;
});

test('choix 5etools du Level up : sorts au choix filtrés, sort donné avec son usage', () => {
  const d = normalizeCharacter(blankCharacter({ name: 'Ren', className: 'Wizard', level: 2 }));
  d.spells.x = { name: 'Minor Illusion', level: 0 };
  setup(d, 'player', true);
  const info = {
    class: 'Wizard', source: 'XPHB', optional: [], sets: [], mastery: 0, masteryTotal: 0, multiclassSkills: null,
    feats: [{ name: 'Fighting Style', categories: ['Fighting Style', 'Fighting Style (Paladin)'], count: 1 }],
    additional: [{
      owner: 'subclass', set: null, info: [],
      spells: [{ name: 'Summon Fey', source: 'XPHB', level: 3, mode: 'prepared', note: '1 fois par Long Rest, sans emplacement' }],
      picks: [{ mode: 'known', count: 2, levels: [0, 1, 2], classes: ['Wizard'], schools: ['Illusion'], from: null, note: '' }],
    }],
  };
  const index = [
    { name: 'Silent Image', source: 'XPHB', level: 1, school: 'Illusion', classes: ['Wizard'] },
    { name: 'Minor Illusion', source: 'XPHB', level: 0, school: 'Illusion', classes: ['Wizard'] },
    { name: 'Fireball', source: 'XPHB', level: 3, school: 'Evocation', classes: ['Wizard'] },
    { name: 'Major Image', source: 'XPHB', level: 3, school: 'Illusion', classes: ['Wizard'] },
  ];
  const feats = [{ name: 'Blessed Warrior', source: 'XPHB', category: 'Fighting Style (Paladin)' }, { name: 'Archery', source: 'XPHB', category: 'Fighting Style' }, { name: 'Alert', source: 'XPHB', category: 'Origin' }];
  const st = { opt: {}, repl: {}, feat: {}, set: '', mastery: [], skills: [], picks: {} };
  const out = renderToString(html`<${DataChoices} info=${info} doc=${d} level=${3} subclassName="Illusionist" feats=${feats} st=${st} setSt=${() => {}} index=${index} />`);
  assert.match(out, /Silent Image/);
  assert.doesNotMatch(out, /Fireball|Major Image/, 'hors filtre : mauvaise école ou niveau trop haut');
  assert.doesNotMatch(out, /value="Minor Illusion/, 'déjà sur la fiche');
  assert.match(out, /Summon Fey · (niveau|level) 3 · 1 fois par Long Rest/);
  assert.match(out, /Blessed Warrior/);
  assert.doesNotMatch(out, /Alert/);
});
