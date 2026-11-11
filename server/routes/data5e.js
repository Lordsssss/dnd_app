// Données 5etools : lecture seule, pour tout compte connecté.
import { HttpError } from '../http.js';

export function register5e({ router, data5e, guard }) {
  const r = (path, fn) => router.get(path, ctx => {
    const a = ctx.auth();
    if (!a) throw new HttpError(401, 'Non connecté');
    return fn(ctx.query, ctx);
  });
  const found = (v, msg) => { if (!v) throw new HttpError(404, msg); return v; };

  r('/api/5e/status', () => data5e.status());
  r('/api/5e/spells', () => data5e.spellIndex());
  r('/api/5e/items', () => data5e.itemIndex());
  r('/api/5e/spell', q => found(data5e.spell(q('name'), q('source')), 'Sort absent des données 5etools'));
  r('/api/5e/item', q => found(data5e.item(q('name'), q('source')), 'Objet absent des données 5etools'));
  r('/api/5e/condition', q => found(data5e.condition(q('name')), 'Condition absente des données 5etools'));
  r('/api/5e/feats', () => data5e.featIndex());
  r('/api/5e/feat', q => found(data5e.feat(q('name'), q('source')), 'Don absent des données 5etools'));
  r('/api/5e/options', q => data5e.optFeatures(q('types')));
  r('/api/5e/class', q => found(data5e.klass(q('name'), q('source')), 'Classe absente des données 5etools'));
  r('/api/5e/classes', () => data5e.classList ? data5e.classList() : []);
  r('/api/5e/subclass', q => found(data5e.subclass(q('class'), q('classSource'), q('short'), q('source')), 'Sous-classe absente des données 5etools'));
  r('/api/5e/search', q => data5e.search(q('q'), q('kind')));
  r('/api/5e/filter', q => data5e.filter(q('cat'), q('f')));
  r('/api/5e/levelup', q => found(data5e.levelInfo(q('class'), q('source'), q('subclass'), q('from'), q('to')), 'Classe absente des données 5etools'));
  r('/api/5e/mastery', () => data5e.masteryWeapons());
  r('/api/5e/books', () => data5e.bookList());
  r('/api/5e/book', q => {
    const kind = q('kind') === 'adventure' ? 'adventure' : 'book';
    const ch = data5e.findChapter(kind, q('id'), q('ch'), q('section'));
    const b = found(data5e.bookChapter(kind, q('id'), ch), 'Livre absent des données 5etools');
    return { ...b, section: q('section') || null };
  });
  r('/api/5e/entry', q => found(data5e.entry(q('kind'), q('name'), q('source'), { cls: q('cls'), cs: q('cs'), lv: q('lv'), sub: q('sub'), ss: q('ss') }), 'Entrée absente des données 5etools'));
  r('/api/5e/spelltables', q => found(data5e.spellTables ? data5e.spellTables(q('class'), q('source')) : null, 'Classe absente des données 5etools'));
  return guard;
}
