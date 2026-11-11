// Fenêtres de préparation : nouvelle carte, grille, ajout de tokens.
import { t } from '/shared/i18n.js';
import { html, useEffect, useRef, useState } from '/app/html.js';
import { initiativeMod, footprintOf } from '/shared/map/monster.js';
import { data5e } from '/app/data.js';
import { api, campaignId, mapApi } from './net.js';
import { CONDITIONS } from '/shared/rules.js';
import { fileUrl } from './images.js';
import { sortFolders } from '/shared/map/scene.js';
import { app, notify, op, openScene, sendToTv, toast } from './state.js';

const close = () => { app.dialog = null; notify(); };
const stop = e => e.stopPropagation();

export function Dialog({ title, wide, children }) {
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return html`<div class="m-back" onMouseDown=${e => { if (e.target === e.currentTarget) close(); }}>
    <div class=${`m-dialog ${wide ? 'wide' : ''}`} onKeyDown=${stop}>
      <header><h2>${title}</h2><button type="button" class="icon" aria-label="Fermer" onClick=${close}>×</button></header>
      <div class="m-body">${children}</div>
    </div>
  </div>`;
}

// --------------------------------------------------------------- Aperçu de la grille

// Aperçu de l'image avec sa grille. Glisser sur une case de l'image en mesure la taille :
// colonnes, rangées et décalage en sont déduits (`onMeasure`).
function GridPreview({ image, cols, rows, offset = [0, 0], onMeasure }) {
  const ref = useRef(null);
  const [img, setImg] = useState(null);
  const [drag, setDrag] = useState(null);
  const scale = useRef(1);
  useEffect(() => {
    setImg(null);
    if (!image) return undefined;
    let live = true;
    const i = new Image();
    i.onload = () => { if (live) setImg(i); };
    i.src = fileUrl(image);
    return () => { live = false; };
  }, [image]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!img) { ctx.clearRect(0, 0, c.width, c.height); return; }
    const k = Math.min(620 / img.naturalWidth, 420 / img.naturalHeight);
    scale.current = k;
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (cols > 0 && rows > 0) {
      const cw = c.width / cols;
      const ch = c.height / rows;
      const ox = ((offset[0] || 0) % 1) * cw;
      const oy = ((offset[1] || 0) % 1) * ch;
      ctx.strokeStyle = 'rgba(255,255,255,.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = ox; x <= c.width; x += cw) { ctx.moveTo(x, 0); ctx.lineTo(x, c.height); }
      for (let y = oy; y <= c.height; y += ch) { ctx.moveTo(0, y); ctx.lineTo(c.width, y); }
      ctx.stroke();
    }
    if (drag) {
      ctx.strokeStyle = '#ffd24a';
      ctx.lineWidth = 2;
      const s = Math.max(Math.abs(drag.x2 - drag.x1), Math.abs(drag.y2 - drag.y1));
      ctx.strokeRect(Math.min(drag.x1, drag.x2), Math.min(drag.y1, drag.y2), s, s);
    }
  }, [img, cols, rows, offset?.[0], offset?.[1], drag]);
  const pos = e => { const r = ref.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = e => { if (!onMeasure || !img) return; const p = pos(e); ref.current.setPointerCapture(e.pointerId); setDrag({ x1: p.x, y1: p.y, x2: p.x, y2: p.y }); };
  const move = e => { if (drag) { const p = pos(e); setDrag({ ...drag, x2: p.x, y2: p.y }); } };
  const up = () => {
    if (!drag) return;
    const k = scale.current;
    const side = Math.max(Math.abs(drag.x2 - drag.x1), Math.abs(drag.y2 - drag.y1)) / k;
    setDrag(null);
    if (side < 4) return;
    const x0 = Math.min(drag.x1, drag.x2) / k;
    const y0 = Math.min(drag.y1, drag.y2) / k;
    const c = Math.max(1, Math.round(img.naturalWidth / side));
    const r = Math.max(1, Math.round(img.naturalHeight / side));
    const cell = img.naturalWidth / c;
    onMeasure({ cols: c, rows: r, offset: [Math.round(((x0 % cell) / cell) * 100) / 100, Math.round(((y0 % (img.naturalHeight / r)) / (img.naturalHeight / r)) * 100) / 100] });
  };
  const size = img ? [img.naturalWidth, img.naturalHeight] : null;
  return html`<div class="grid-prev">
    <canvas ref=${ref} class=${onMeasure ? 'measure' : ''} onPointerDown=${down} onPointerMove=${move} onPointerUp=${up}></canvas>
    ${size ? html`<p class="muted small">${size[0]} × ${size[1]} pixels${cols > 0 ? ` · ${(size[0] / cols).toFixed(1)} pixels par case` : ''}${cols > 0 && rows > 0 && Math.abs(size[0] / cols - size[1] / rows) > 1 ? ' · attention : cases pas carrées' : ''}</p>` : null}
    ${onMeasure && size ? html`<p class="muted small">Glisse sur une case de l'image pour mesurer la grille : colonnes, rangées et décalage se remplissent seuls.</p>` : null}
  </div>`;
}

// Envoi d'une image dans la campagne (carte ou token) ; rend sa référence.
export async function uploadImage(file, kind, folder = '') {
  const r = await api(`/api/c/${campaignId}/assets?kind=${kind}&name=${encodeURIComponent(file.name)}&folder=${encodeURIComponent(folder || '')}`, { method: 'POST', raw: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  return r;
}

// Choix du dossier d'images : « Tous » pour chercher partout, un dossier pour y ranger un envoi.
function ImageFolderSelect({ items, value, onChange }) {
  const folders = [...new Set(items.map(i => i.folder || ''))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
  if (!folders.length) return null;
  return html`<select class="sel" aria-label="Dossier" value=${value} onChange=${e => onChange(e.target.value)}>
    <option value="*">Tous les dossiers</option>
    ${folders.map(f => html`<option value=${f}>${f}</option>`)}
    <option value="">Sans dossier</option>
  </select>`;
}

function UploadButton({ kind, label, onDone, folder = '' }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const go = async e => {
    const files = [...e.target.files];
    e.target.value = '';
    setBusy(true);
    let last = null;
    for (const f of files) {
      try { last = await uploadImage(f, kind, folder); } catch (x) { toast(`${f.name} : ${x.message}`, 'error'); }
    }
    setBusy(false);
    if (last) onDone?.(last);
  };
  return html`<span>
    <button type="button" class="btn small" disabled=${busy} onClick=${() => ref.current?.click()}>${busy ? 'Envoi…' : label}</button>
    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden ref=${ref} onChange=${go} />
  </span>`;
}

// --------------------------------------------------------------- Dossiers

function FolderField({ value, onInput }) {
  const names = sortFolders(new Set(['Général', ...app.scenes.map(s => s.folder)]));
  return html`<label>Dossier
    <input class="txt" list="folder-names" placeholder="Général, Session 8…" value=${value} onInput=${e => onInput(e.target.value)} />
    <datalist id="folder-names">${names.map(n => html`<option value=${n} />`)}</datalist>
  </label>`;
}

export function SceneBrowser() {
  const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, 'fr');
  const folders = sortFolders(new Set(app.scenes.map(s => s.folder)));
  const current = app.scenes.find(s => s.id === app.sceneId)?.folder;
  const open = id => { openScene(id); close(); };
  return html`<${Dialog} title="Cartes" wide>
    <div class="sb-top-row">
      <button type="button" class="btn small primary" onClick=${() => { app.dialog = { kind: 'scene' }; notify(); }}>Nouvelle carte</button>
    </div>
    ${folders.map(f => html`<details class="sb-folder" key=${f} open=${f === current || /^g[ée]n[ée]ral$/i.test(f) || folders.length <= 3}>
      <summary><b>${f}</b> <span class="muted small">${app.scenes.filter(s => s.folder === f).length}</span></summary>
      <div class="sb-grid">
        ${app.scenes.filter(s => s.folder === f).sort(byOrder).map(s => html`<div key=${s.id} class=${`sb-card ${s.id === app.sceneId ? 'on' : ''}`}>
          <button type="button" class="sb-open" title="Ouvrir sur le portable" onClick=${() => open(s.id)}>
            ${s.image ? html`<img loading="lazy" src=${fileUrl(s.image)} alt="" />` : null}
            <b>${s.name}</b>
          </button>
          <div class="sb-meta">
            <span class="muted small">${s.fog === false ? 'Sans brouillard' : 'Brouillard'}${s.id === app.tvScene ? ' · sur la TV' : ''}</span>
            <button type="button" class="btn tiny" disabled=${s.id === app.tvScene} title="Mettre cette carte sur la TV" onClick=${() => sendToTv(s.id)}>TV</button>
          </div>
        </div>`)}
      </div>
    </details>`)}
    ${folders.length ? null : html`<p class="muted">Aucune carte pour l'instant.</p>`}
  <//>`;
}

// --------------------------------------------------------------- Nouvelle carte

export function NewSceneDialog() {
  const [images, setImages] = useState([]);
  const [filter, setFilter] = useState('');
  const [imgFolder, setImgFolder] = useState('*');
  const [f, setF] = useState({ name: '', folder: app.doc?.folder || 'Général', fog: true, image: '', cols: 40, rows: 30, feetPerCell: 5, offset: [0, 0] });
  const loadImages = () => api(mapApi('/images')).then(setImages).catch(e => toast(e.message, 'error'));
  const set = patch => setF({ ...f, ...patch });
  const guessOf = im => (im.width ? { cols: Math.max(1, Math.round(im.width / 100)), rows: Math.max(1, Math.round(im.height / 100)) } : {});
  // Ouverte depuis les images de la campagne : l'image est déjà choisie.
  useEffect(() => {
    loadImages();
    const im = app.dialog?.image;
    if (im) setF(cur => ({ ...cur, ...guessOf(im), image: im.path, name: im.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ') }));
  }, []);
  const pick = async im => {
    const name = f.name || im.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
    // Une carte de Dungeondraft ou d'Inkarnate fait souvent 70 à 200 pixels par case : 100 est une bonne première idée.
    setF({ ...f, ...guessOf(im), image: im.path, name });
  };
  const create = async () => {
    try {
      const size = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve([i.naturalWidth, i.naturalHeight]);
        i.onerror = () => reject(new Error('Image illisible'));
        i.src = fileUrl(f.image);
      });
      const r = await api(mapApi('/scenes'), { method: 'POST', body: { ...f, imageSize: size } });
      close();
      openScene(r.id);
    } catch (e) { toast(e.message, 'error'); }
  };
  const shown = images.filter(i => i.name.toLowerCase().includes(filter.toLowerCase()) && (imgFolder === '*' || (i.folder || '') === imgFolder));
  return html`<${Dialog} title="Nouvelle carte" wide>
    <div class="ns-grid">
      <div class="ns-images">
        <div class="ns-head"><input class="txt" placeholder="Chercher une image de carte…" value=${filter} onInput=${e => setFilter(e.target.value)} />
          <${ImageFolderSelect} items=${images} value=${imgFolder} onChange=${setImgFolder} />
          <${UploadButton} kind="map" label="Envoyer une carte" folder=${imgFolder === '*' ? '' : imgFolder} onDone=${a => { loadImages(); pick({ path: a.ref, name: a.name, width: a.width, height: a.height }); }} />
          <button type="button" class="btn small ghost" title="Ranger les images en dossiers" onClick=${() => { app.dialog = { kind: 'library', tab: 'map' }; notify(); }}>Dossiers…</button></div>
        <div class="ns-list">
          ${shown.map(im => html`<button type="button" key=${im.path} class=${`ns-item ${f.image === im.path ? 'on' : ''}`} onClick=${() => pick(im)}>
            <img loading="lazy" src=${fileUrl(im.path)} alt="" /><span>${im.name}</span><small>${(im.bytes / 1048576).toFixed(1)} Mo</small>
          </button>`)}
          ${shown.length ? null : html`<p class="muted small">Aucune image de carte dans cette campagne : envoie la première.</p>`}
        </div>
      </div>
      <div class="ns-form">
        <label>Nom <input class="txt" value=${f.name} onInput=${e => set({ name: e.target.value })} /></label>
        <${FolderField} value=${f.folder} onInput=${folder => set({ folder })} />
        <label class="check"><input type="checkbox" checked=${f.fog} onChange=${e => set({ fog: e.target.checked })} /> Brouillard de guerre</label>
        <div class="ns-row">
          <label>Colonnes <input class="num" type="number" min="1" value=${f.cols} onInput=${e => set({ cols: Number(e.target.value) })} /></label>
          <label>Rangées <input class="num" type="number" min="1" value=${f.rows} onInput=${e => set({ rows: Number(e.target.value) })} /></label>
          <label>ft par case <input class="num" type="number" min="1" value=${f.feetPerCell} onInput=${e => set({ feetPerCell: Number(e.target.value) })} /></label>
        </div>
        <${GridPreview} image=${f.image} cols=${f.cols} rows=${f.rows} offset=${f.offset} onMeasure=${m => set(m)} />
        <p class="muted small">Les murs viennent ensuite : tracés à la main en mode Murs, ou proposés par Auto-murs.</p>
        <button type="button" class="btn primary" disabled=${!f.image || !f.name.trim() || !(f.cols > 0) || !(f.rows > 0)} onClick=${create}>Créer la carte</button>
      </div>
    </div>
  <//>`;
}

export function GridDialog() {
  const g = app.doc.grid;
  const [f, setF] = useState({ cols: g.cols, rows: g.rows, feetPerCell: g.feetPerCell, ox: g.offset?.[0] || 0, oy: g.offset?.[1] || 0, show: !!g.show, name: app.doc.name, folder: app.doc.folder, fog: app.doc.fog !== false });
  const set = patch => setF({ ...f, ...patch });
  const save = () => {
    op({ type: 'scene.set', name: f.name, folder: f.folder, fog: f.fog, grid: { cols: f.cols, rows: f.rows, feetPerCell: f.feetPerCell, offset: [f.ox, f.oy], show: f.show } });
    close();
  };
  return html`<${Dialog} title="Réglages de la carte">
    <div class="ns-form">
      <label>Nom <input class="txt" value=${f.name} onInput=${e => set({ name: e.target.value })} /></label>
      <${FolderField} value=${f.folder} onInput=${folder => set({ folder })} />
      <label class="check"><input type="checkbox" checked=${f.fog} onChange=${e => set({ fog: e.target.checked })} /> Brouillard de guerre. Sans lui, la TV montre toute la carte et les murs ne servent plus.</label>
      <div class="ns-row">
        <label>Colonnes <input class="num" type="number" min="1" value=${f.cols} onInput=${e => set({ cols: Number(e.target.value) })} /></label>
        <label>Rangées <input class="num" type="number" min="1" value=${f.rows} onInput=${e => set({ rows: Number(e.target.value) })} /></label>
        <label>ft par case <input class="num" type="number" min="1" value=${f.feetPerCell} onInput=${e => set({ feetPerCell: Number(e.target.value) })} /></label>
      </div>
      <div class="ns-row">
        <label>Décalage x, en cases <input class="num" type="number" step="0.05" value=${f.ox} onInput=${e => set({ ox: Number(e.target.value) })} /></label>
        <label>Décalage y, en cases <input class="num" type="number" step="0.05" value=${f.oy} onInput=${e => set({ oy: Number(e.target.value) })} /></label>
      </div>
      <label class="check"><input type="checkbox" checked=${f.show} onChange=${e => set({ show: e.target.checked })} /> Afficher la grille sur la TV</label>
      <${GridPreview} image=${app.doc.image} cols=${f.cols} rows=${f.rows} offset=${[f.ox, f.oy]} onMeasure=${m => set({ cols: m.cols, rows: m.rows, ox: m.offset[0], oy: m.offset[1] })} />
      <button type="button" class="btn primary" onClick=${save}>Enregistrer</button>
    </div>
  <//>`;
}

// --------------------------------------------------------------- Choix d'une image

function ImagePicker({ value, name, onPick }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    let live = true;
    const url = q.trim() ? mapApi(`/tokens?q=${encodeURIComponent(q)}&limit=40`) : mapApi(`/tokens/suggest?name=${encodeURIComponent(name || '')}`);
    api(url).then(r => { if (live) setItems(r); }).catch(() => {});
    return () => { live = false; };
  }, [q, name, bump]);
  return html`<div class="ip">
    <div class="ns-head"><input class="txt" placeholder="Chercher un token : orc, tree, skeleton…" value=${q} onInput=${e => setQ(e.target.value)} />
      <${UploadButton} kind="token" label="Envoyer un token" onDone=${a => { setBump(bump + 1); onPick({ path: a.ref, name: a.name, size: 1 }); }} /></div>
    ${!q.trim() ? html`<p class="muted small">${items.length ? t('Propositions pour {name}', { name }) : t('Aucun nom proche de {name} : cherche une autre image.', { name: name || t('ce token') })}</p>` : null}
    <div class="ip-list">
      ${items.map(t => html`<button type="button" key=${t.path} class=${`ip-item ${value === t.path ? 'on' : ''}`} title=${`${t.name} · ${t.folder}`} onClick=${() => onPick(t)}>
        <img loading="lazy" src=${fileUrl(t.path)} alt=${t.name} />
        <span>${t.name}</span>
      </button>`)}
    </div>
  </div>`;
}

export const newTokenId = () => `t${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 3).toString(36)}`;

function startPlacing(base, count, title) {
  const tokens = [];
  for (let i = 0; i < count; i++) {
    tokens.push({ ...base, id: newTokenId(), name: count > 1 ? `${base.name} ${i + 1}` : base.name });
  }
  app.placing = { tokens, title };
  app.tool = 'place';
  app.mode = 'play';
  close();
}

// Le panneau commun : image, nombre, initiative, taille, caché ou non.
function TokenSetup({ entry, library }) {
  const [image, setImage] = useState('');
  const [size, setSize] = useState(entry.size || 1);
  const [count, setCount] = useState(entry.count || 1);
  const [init, setInit] = useState(entry.init ?? 0);
  const [hidden, setHidden] = useState(false);
  const [kind, setKind] = useState(entry.kind || 'enemy');
  const [name, setName] = useState(entry.name);
  const key = entry.libKey;

  useEffect(() => {
    setName(entry.name);
    setCount(entry.count || 1);
    setInit(entry.init ?? 0);
    setSize(entry.size || 1);
    setKind(entry.kind || 'enemy');
    const known = library?.monsters?.[key];
    setImage(known?.image || '');
    if (known?.size) setSize(known.size);
    if (!known) {
      // Sans choix mémorisé : l'image au nom exact, s'il y en a une, est déjà sélectionnée.
      if (entry.image) { setImage(entry.image); return; }
      api(mapApi(`/tokens/suggest?name=${encodeURIComponent(entry.name)}`)).then(r => {
        if (r[0]?.score === 100) {
          setImage(r[0].path);
          if (!entry.size && r[0].size) setSize(r[0].size);
        }
      }).catch(() => {});
    }
  }, [key, entry.image, entry.name]);

  const place = () => {
    if (key && image) {
      library.monsters = { ...(library.monsters || {}), [key]: { image, size } };
      api(mapApi('/library'), { method: 'POST', body: { group: 'monsters', key, value: { image, size } } }).catch(() => {});
    }
    startPlacing({ name: name.trim() || entry.name, image, size: Number(size) || 1, init: Number(init) || 0, kind, hidden, ref: entry.ref || null, hp: entry.hp ? { current: entry.hp, max: entry.hp } : null }, Math.max(1, Number(count) || 1), `${name} : clic pour poser`);
  };

  return html`<div class="ts">
    <div class="ts-row">
      <label class="grow">Nom <input class="txt" value=${name} onInput=${e => setName(e.target.value)} /></label>
      <label>Nombre <input class="num" type="number" min="1" max="40" value=${count} onInput=${e => setCount(e.target.value)} /></label>
      <label>Initiative <input class="num" type="number" value=${init} onInput=${e => setInit(e.target.value)} /></label>
      <label>Taille en cases <input class="num" type="number" min="1" max="8" value=${size} onInput=${e => setSize(e.target.value)} /></label>
    </div>
    <${ImagePicker} value=${image} name=${entry.name} onPick=${t => { setImage(t.path); if (!entry.size && t.size) setSize(t.size); }} />
    <div class="ts-foot">
      <label>Camp <select class="sel" value=${kind} onChange=${e => setKind(e.target.value)}><option value="enemy">Ennemi</option><option value="npc">PNJ</option><option value="ally">Allié</option></select></label>
      <label class="check"><input type="checkbox" checked=${hidden} onChange=${e => setHidden(e.target.checked)} /> Cachés : invisibles sur la TV jusqu'à ce que tu les révèles</label>
      <button type="button" class="btn primary" onClick=${place}>Placer sur la carte</button>
    </div>
  </div>`;
}

// --------------------------------------------------------------- Onglets

function BestiaryTab({ library, onEntry, selected }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  useEffect(() => {
    let live = true;
    if (q.trim().length < 2) { setHits([]); return undefined; }
    data5e.search(q, 'monster').then(r => { if (live) setHits(r); });
    return () => { live = false; };
  }, [q]);
  const pick = async h => {
    const e = await data5e.entry('monster', h.n, h.s);
    if (!e?.monster) return toast('Créature absente des données 5etools', 'error');
    onEntry({
      name: e.monster.name, libKey: `${e.monster.name}|${e.monster.source}`, init: initiativeMod(e.monster), size: footprintOf(e.monster),
      count: 1, ref: { t: 'monster', name: e.monster.name, source: e.monster.source },
    });
    return undefined;
  };
  return html`<div class="pick-col">
    <input class="txt" autofocus placeholder="Chercher une créature : Otyugh, Stirge…" value=${q} onInput=${e => setQ(e.target.value)} />
    <div class="pick-list">
      ${hits.map(h => html`<button type="button" key=${`${h.n}|${h.s}`} class=${selected?.libKey === `${h.n}|${h.s}` ? 'on' : ''} onClick=${() => pick(h)}>
        <b>${h.n}</b> <span class="muted small">${h.s}${h.x ? ` · ${h.x}` : ''}</span></button>`)}
      ${q.trim().length >= 2 && !hits.length ? html`<p class="muted small">Rien dans 5etools. Un homebrew ? Voir l'onglet Bestiaire de la campagne.</p>` : null}
    </div>
  </div>`;
}

// Les créatures préparées par le MJ dans le panneau de la campagne (Bestiaire).
function CampaignTab({ onEntry, selected }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => { api(`/api/c/${campaignId}/bestiary`).then(setList).catch(e => { setList([]); toast(e.message, 'error'); }); }, []);
  const pick = b => onEntry({
    name: b.name, libKey: `beast|${b.id}`, init: b.init ?? 0, size: b.size || 1, count: 1, hp: b.hp || null, image: b.image || '',
    ref: { t: 'beast', id: b.id },
  });
  const shown = (list || []).filter(b => b.name.toLowerCase().includes(q.toLowerCase()));
  return html`<div class="pick-col">
    <input class="txt" autofocus placeholder="Filtrer le bestiaire de la campagne…" value=${q} onInput=${e => setQ(e.target.value)} />
    <div class="pick-list">
      ${shown.map(b => html`<button type="button" key=${b.id} class=${selected?.libKey === `beast|${b.id}` ? 'on' : ''} onClick=${() => pick(b)}>
        <b>${b.name}</b> <span class="muted small">${[b.ac != null ? `CA ${b.ac}` : '', b.hp != null ? `PV ${b.hp}` : '', b.init != null ? `init. ${b.init >= 0 ? '+' : ''}${b.init}` : ''].filter(Boolean).join(' · ')}</span></button>`)}
      ${list && !list.length ? html`<p class="muted small">Le bestiaire de la campagne est vide. Ajoute des créatures dans le panneau MJ, onglet Bestiaire : copie de 5etools, création ou import du coffre.</p>` : null}
    </div>
    <a class="btn small ghost" href=${`/c/${campaignId}/mj/bestiary`} target=${`mj-${campaignId}`} rel="noopener">Ouvrir le bestiaire</a>
  </div>`;
}

function PartyTab({ library }) {
  const [party, setParty] = useState([]);
  const [images, setImages] = useState({ ...(library?.characters || {}) });
  const [editing, setEditing] = useState(null);
  const [on, setOn] = useState({});
  useEffect(() => {
    api(mapApi('/party')).then(p => { setParty(p); setOn(Object.fromEntries(p.map(c => [c.name, true]))); }).catch(e => toast(e.message, 'error'));
  }, []);
  const present = new Set((app.doc?.tokens || []).filter(t => t.kind === 'pc').map(t => t.name));
  const place = () => {
    const tokens = party.filter(c => on[c.name] && !present.has(c.name)).map(c => ({
      id: newTokenId(), name: c.name, kind: 'pc', vision: true, image: images[c.name] || '', size: 1, init: 0,
    }));
    if (!tokens.length) return toast('Tous les PJ cochés sont déjà sur cette carte');
    app.placing = { tokens, title: 'Groupe : clic pour poser' };
    app.tool = 'place';
    app.mode = 'play';
    close();
    return undefined;
  };
  const setImage = (name, path) => {
    setImages({ ...images, [name]: path });
    library.characters = { ...(library.characters || {}), [name]: path };
    api(mapApi('/library'), { method: 'POST', body: { group: 'characters', key: name, value: path } }).catch(() => {});
    setEditing(null);
  };
  return html`<div class="party-tab">
    <div class="party-list">
      ${party.map(c => html`<div class="party-row" key=${c.name}>
        <label class="check"><input type="checkbox" checked=${!!on[c.name]} disabled=${present.has(c.name)} onChange=${e => setOn({ ...on, [c.name]: e.target.checked })} /></label>
        <button type="button" class="party-img" title="Choisir l'image" onClick=${() => setEditing(c.name)}>
          ${images[c.name] ? html`<img src=${fileUrl(images[c.name])} alt="" />` : html`<span>?</span>`}
        </button>
        <b>${c.name}</b>
        ${present.has(c.name) ? html`<span class="muted small">déjà sur la carte</span>` : null}
      </div>`)}
    </div>
    ${editing ? html`<${ImagePicker} value=${images[editing]} name=${editing} onPick=${t => setImage(editing, t.path)} />` : null}
    <button type="button" class="btn primary" onClick=${place}>Placer le groupe</button>
    <p class="muted small">Les personnages de cette campagne. La carte ne lit que leur nom.</p>
  </div>`;
}

// Un token envoyé dans la campagne, prêt à poser : son nom vient du fichier.
const SIZE_CELLS = { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
const tokenEntry = im => {
  const base = im.name.replace(/\.[^.]+$/, '');
  const words = base.split(/_[A-Z]\d+(?:_|$)/)[0].split(/[_\s-]+/).filter(Boolean);
  const sizeWord = base.split(/[_\s-]+/).map(w => w.toLowerCase()).find(w => w in SIZE_CELLS);
  const name = words.filter(w => !(w.toLowerCase() in SIZE_CELLS)).join(' ') || 'Token';
  return { name, libKey: '', init: 0, size: sizeWord ? SIZE_CELLS[sizeWord] : 0, count: 1, ref: null, image: im.path };
};

// Les tokens envoyés dans la campagne, par dossier.
function MineTab({ onEntry, selected }) {
  const [items, setItems] = useState(null);
  const [folder, setFolder] = useState('*');
  const [bump, setBump] = useState(0);
  useEffect(() => { api(`/api/c/${campaignId}/assets?kind=token`).then(setItems).catch(e => { setItems([]); toast(e.message, 'error'); }); }, [bump]);
  const shown = (items || []).filter(i => folder === '*' || (i.folder || '') === folder);
  return html`<div class="pick-col">
    <div class="ns-head">
      <${ImageFolderSelect} items=${items || []} value=${folder} onChange=${setFolder} />
      <${UploadButton} kind="token" label="Envoyer des tokens" folder=${folder === '*' ? '' : folder} onDone=${a => { setBump(bump + 1); onEntry(tokenEntry({ path: a.ref, name: a.name })); }} />
      <button type="button" class="btn small ghost" onClick=${() => { app.dialog = { kind: 'library', tab: 'token' }; notify(); }}>Dossiers…</button>
    </div>
    <div class="ip-list">
      ${shown.map(a => html`<button type="button" key=${a.id} class=${`ip-item ${selected?.image === a.ref ? 'on' : ''}`} title=${a.folder ? `${a.name} · ${a.folder}` : a.name} onClick=${() => onEntry(tokenEntry({ path: a.ref, name: a.name }))}>
        <img loading="lazy" src=${fileUrl(a.ref)} alt="" /><span>${a.name.replace(/\.[^.]+$/, '')}</span>
      </button>`)}
    </div>
    ${items && !items.length ? html`<p class="muted small">Aucun token envoyé dans cette campagne. Envoie tes images : elles se rangent dans le dossier choisi.</p>` : null}
  </div>`;
}

export function AddTokenDialog() {
  const [tab, setTab] = useState('campaign');
  const [entry, setEntry] = useState(null);
  const [library, setLibrary] = useState(null);
  useEffect(() => { api(mapApi('/library')).then(setLibrary).catch(() => setLibrary({ monsters: {}, characters: {} })); }, []);
  const tabs = [['campaign', 'Bestiaire de la campagne'], ['bestiary', '5etools'], ['party', 'Groupe'], ['mine', 'Mes tokens'], ['free', 'Image seule']];
  const change = t => { setTab(t); setEntry(t === 'free' ? { name: 'Token', libKey: '', init: 0, size: 0, count: 1, ref: null } : null); };
  // Ouverte depuis les images de la campagne : le token choisi est prêt à poser.
  useEffect(() => {
    const im = app.dialog?.image;
    if (!im) return;
    setTab('mine');
    setEntry(tokenEntry(im));
  }, []);
  return html`<${Dialog} title="Ajouter à la carte" wide>
    <div class="tabs">${tabs.map(([k, l]) => html`<button type="button" class=${tab === k ? 'on' : ''} onClick=${() => change(k)}>${l}</button>`)}</div>
    ${!library ? html`<p class="muted">Chargement…</p>` : tab === 'party' ? html`<${PartyTab} library=${library} />` : html`<div class="add-grid">
      ${tab === 'bestiary' ? html`<${BestiaryTab} library=${library} onEntry=${setEntry} selected=${entry} />` : null}
      ${tab === 'campaign' ? html`<${CampaignTab} onEntry=${setEntry} selected=${entry} />` : null}
      ${tab === 'free' ? html`<div class="pick-col"><p class="muted small">Un token sans fiche : PNJ, objet, marqueur. Le nom sert à proposer des images.</p></div>` : null}
      ${tab === 'mine' ? html`<${MineTab} onEntry=${setEntry} selected=${entry} />` : null}
      <div class="add-setup">
        ${entry ? html`<${TokenSetup} entry=${entry} library=${library} />` : html`<p class="muted">Choisis une créature à gauche.</p>`}
      </div>
    </div>`}
  <//>`;
}

// Change l'image d'un token déjà posé.
export function ChangeImageDialog() {
  const ids = app.dialog.ids;
  const first = app.doc?.tokens.find(t => t.id === ids[0]);
  if (!first) return null;
  return html`<${Dialog} title=${`Image de ${first.name}`} wide>
    <${ImagePicker} value=${first.image} name=${first.name.replace(/\s\d+$/, '')} onPick=${t => { op({ type: 'token.update', ids, patch: { image: t.path } }); close(); }} />
  <//>`;
}

// --------------------------------------------------------------- Détails d'un token

// Tout ce que le MJ règle sur un token : nom, camp, taille, PV suivis, conditions, notes, fiche liée.
export function TokenEditor() {
  const t = app.doc?.tokens.find(x => x.id === app.dialog.id);
  const [f, setF] = useState(() => ({
    name: t?.name || '', kind: t?.kind || 'enemy', size: t?.size || 1, hpMax: t?.hp?.max ?? '', hpCur: t?.hp?.current ?? '',
    conditions: t?.conditions || [], notes: t?.notes || '', vision: !!t?.vision, hidden: !!t?.hidden, color: t?.color || '',
  }));
  const [beasts, setBeasts] = useState([]);
  const [ref, setRef] = useState(t?.ref || null);
  useEffect(() => { api(`/api/c/${campaignId}/bestiary`).then(setBeasts).catch(() => {}); }, []);
  if (!t) return null;
  const set = patch => setF({ ...f, ...patch });
  const toggleCond = c => set({ conditions: f.conditions.includes(c) ? f.conditions.filter(x => x !== c) : [...f.conditions, c] });
  const save = () => {
    const hpMax = Number(f.hpMax);
    op({
      type: 'token.update', id: t.id,
      patch: {
        name: f.name.trim() || t.name, kind: f.kind, size: Number(f.size) || 1, vision: f.vision, hidden: f.hidden, color: f.color,
        conditions: f.conditions, notes: f.notes, ref,
        hp: hpMax > 0 ? { max: hpMax, current: f.hpCur === '' ? hpMax : Number(f.hpCur) } : null,
      },
    });
    close();
  };
  const refValue = ref?.t === 'beast' ? `beast:${ref.id}` : ref?.t === 'monster' ? 'monster' : '';
  return html`<${Dialog} title=${`Token : ${t.name}`} wide>
    <div class="te-grid">
      <label>Nom <input class="txt" value=${f.name} onInput=${e => set({ name: e.target.value })} /></label>
      <label>Camp <select class="sel" value=${f.kind} onChange=${e => set({ kind: e.target.value })}>
        <option value="pc">PJ</option><option value="enemy">Ennemi</option><option value="ally">Allié</option><option value="npc">PNJ</option></select></label>
      <label>Taille en cases <input class="num" type="number" min="1" max="8" value=${f.size} onInput=${e => set({ size: e.target.value })} /></label>
      <label>PV <span class="te-hp"><input class="num" type="number" min="0" placeholder="actuels" value=${f.hpCur} onInput=${e => set({ hpCur: e.target.value })} /> / <input class="num" type="number" min="0" placeholder="max" value=${f.hpMax} onInput=${e => set({ hpMax: e.target.value })} /></span></label>
      <label>Contour <select class="sel" value=${f.color} onChange=${e => set({ color: e.target.value })}>
        <option value="">Selon le camp</option>${['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'white'].map(c => html`<option value=${c}>${c}</option>`)}</select></label>
      <label>Bloc de stats <select class="sel" value=${refValue} onChange=${e => {
        const v = e.target.value;
        if (!v) setRef(null);
        else if (v.startsWith('beast:')) setRef({ t: 'beast', id: v.slice(6) });
      }}>
        <option value="">Aucun</option>
        ${ref?.t === 'monster' ? html`<option value="monster">5etools : ${ref.name}</option>` : null}
        ${beasts.map(b => html`<option value=${`beast:${b.id}`}>${b.name}</option>`)}
      </select></label>
    </div>
    <div class="te-checks">
      <label class="check"><input type="checkbox" checked=${f.vision} onChange=${e => set({ vision: e.target.checked })} /> Donne la vue (éclaire le brouillard)</label>
      <label class="check"><input type="checkbox" checked=${f.hidden} onChange=${e => set({ hidden: e.target.checked })} /> Caché sur la TV</label>
    </div>
    <div class="te-conds">
      <span class="lbl">Conditions</span>
      ${[...CONDITIONS.map(c => c.name), 'Concentrating', 'Bloodied'].map(c => html`<button type="button" class=${`chip ${f.conditions.includes(c) ? 'on' : ''}`} onClick=${() => toggleCond(c)}>${c}</button>`)}
    </div>
    <label class="te-notes">Notes du MJ <textarea class="txt" value=${f.notes} onInput=${e => set({ notes: e.target.value })} placeholder="Tactique, butin, ce qu'il sait…"></textarea></label>
    <p class="muted small">Les PV, les conditions et les notes restent sur ton écran : la TV ne montre que le token.</p>
    <div class="ts-foot"><span class="grow"></span><button type="button" class="btn" onClick=${close}>Annuler</button><button type="button" class="btn primary" onClick=${save}>Enregistrer</button></div>
  <//>`;
}

// --------------------------------------------------------------- Auto-murs

// Le serveur lit l'image et propose les murs là où le sol rencontre le vide. Le résultat
// remplace les murs de la carte en une seule étape, annulable avec Ctrl+Z.
export function AutoWallsDialog() {
  const [f, setF] = useState({ mode: 'pixels', tiles: '', floor: '', threshold: '' });
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const set = patch => setF({ ...f, ...patch });
  const run = async () => {
    setBusy(true);
    setRes(null);
    try {
      const body = { floor: f.floor.trim() || null, threshold: f.threshold || null, tiles: f.mode === 'tiles' && f.tiles.trim() ? f.tiles.trim() : null };
      setRes(await api(mapApi(`/scenes/${app.sceneId}/autowalls`), { method: 'POST', body }));
    } catch (e) { toast(e.message, 'error', 8000); } finally { setBusy(false); }
  };
  const apply = () => { op({ type: 'walls.replace', walls: res.walls }); toast(t('{n} murs posés · Ctrl+Z pour revenir', { n: res.walls.length })); close(); };
  const existing = app.doc?.walls.length || 0;
  return html`<${Dialog} title="Auto-murs">
    <div class="ns-form">
      <p class="muted small">Le traceur repère où le sol rencontre le vide (le noir autour d'un donjon) et y pose des murs. Il ne devine pas les murs intérieurs, les arbres ni les cuves : ceux-là se tracent à la main.</p>
      <div class="shape-row">
        <button type="button" class=${`chip ${f.mode === 'pixels' ? 'on' : ''}`} onClick=${() => set({ mode: 'pixels' })}>Contour au pixel (grottes, forêts)</button>
        <button type="button" class=${`chip ${f.mode === 'tiles' ? 'on' : ''}`} onClick=${() => set({ mode: 'tiles' })}>Tuiles régulières (Inkarnate, donjons en dalles)</button>
      </div>
      ${f.mode === 'tiles' ? html`<label>Nombre de tuiles en largeur <input class="txt" placeholder="40, ou 40x30" value=${f.tiles} onInput=${e => set({ tiles: e.target.value })} /></label>` : null}
      <details><summary class="small">Réglages fins</summary>
        <label>Seuil de luminosité du vide <input class="num" type="number" min="1" max="250" placeholder="auto" value=${f.threshold} onInput=${e => set({ threshold: e.target.value })} /></label>
        <label>Tuiles à compter comme du sol <input class="txt" placeholder="24-30,32-34 5,3" value=${f.floor} onInput=${e => set({ floor: e.target.value })} /></label>
      </details>
      <button type="button" class="btn primary" disabled=${busy} onClick=${run}>${busy ? 'Analyse de l\'image…' : 'Analyser la carte'}</button>
      ${res ? html`<div class="alert"><p><b>${res.walls.length}</b> murs proposés${existing ? `, à la place des ${existing} actuels` : ''}.</p>
        ${res.log ? html`<p class="muted small">${res.log}</p>` : null}
        <button type="button" class="btn primary" disabled=${!res.walls.length} onClick=${apply}>Poser ces murs</button></div>` : null}
    </div>
  <//>`;
}

// --------------------------------------------------------------- Exporter / importer une scène

export function SceneFileDialog() {
  const [text, setText] = useState('');
  const download = async () => {
    const r = await api(mapApi(`/scenes/${app.sceneId}`));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(r.scene, null, 2)], { type: 'application/json' }));
    a.download = `${app.sceneId}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const replace = async () => {
    try {
      const raw = JSON.parse(text);
      await api(mapApi(`/scenes/${app.sceneId}`), { method: 'PUT', body: raw.scene || raw });
      toast('Scène remplacée : murs, grille et image');
      close();
    } catch (e) { toast(e.message, 'error', 7000); }
  };
  return html`<${Dialog} title="Fichier de la scène" wide>
    <div class="ns-form">
      <p class="muted small">La scène en JSON : image, grille, murs et portes, coordonnées en cases. Les tokens et le brouillard n'y sont pas et ne changent pas.</p>
      <button type="button" class="btn small" onClick=${download}>Télécharger le JSON</button>
      <label>Remplacer par ce JSON <textarea class="txt mono" rows="10" value=${text} onInput=${e => setText(e.target.value)} placeholder='{"grid": {"cols": 30, "rows": 20}, "walls": [...]}'></textarea></label>
      <button type="button" class="btn primary" disabled=${!text.trim()} onClick=${replace}>Remplacer la scène</button>
    </div>
  <//>`;
}
