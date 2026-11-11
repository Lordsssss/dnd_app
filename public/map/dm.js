// Le portable du MJ : la carte sans brouillard, les outils, l'ordre d'initiative.
import { tx } from '/shared/i18n.js';
import { html, render, useEffect, useRef, useState } from '/app/html.js';
import { store, subscribe as subscribeStore } from '/app/store.js';
import { ModalHost } from '/app/dialogs.js';
import { sortFolders, wallIssues } from '/shared/map/scene.js';
import { campaignId, getToken, goLogin } from './net.js';
import {
  app, fitToMap, notify, op, openScene, redo, refresh, requestDraw, selectedTokens, sendLive, sendToTv,
  setDraw, start, subscribe, toast, toWorld, undo, viewRect,
} from './state.js';
import { drawScene, fitCamera, boundsRect, label, tokenBox } from './render.js';
import { tokenImage } from './images.js';
import { selectTool, placeTool, rulerTool, templateTool, drawTool, rotateTokens } from './tools/play.js';
import { doorColor, doorTool, drawDoorHandles, drawIssues, drawTestView, drawWalls, editTool, eraseTool, lineTool, testTool } from './tools/walls.js';
import { Tracker } from './tracker.js';
import { InfoCard } from './card.js';
import { AddTokenDialog, AutoWallsDialog, ChangeImageDialog, GridDialog, NewSceneDialog, SceneBrowser, SceneFileDialog, TokenEditor } from './pickers.js';
import { ImageLibraryDialog } from './library.js';

const TOOLS = {
  select: selectTool, place: placeTool, ruler: rulerTool, template: templateTool, draw: drawTool,
  'wall-line': lineTool, 'wall-door': doorTool, 'wall-edit': editTool, 'wall-erase': eraseTool, 'wall-test': testTool,
};
const tool = () => TOOLS[app.tool] || selectTool;

function setTool(id) {
  if (id !== 'ruler') sendLive({ ruler: null });
  app.tool = id;
  app.t = {};
  refresh();
}

function setMode(mode) {
  app.mode = mode;
  app.selection = new Set();
  setTool(mode === 'walls' ? 'wall-line' : 'select');
}

// --------------------------------------------------------------- Dessin

function ring(ctx, t, color, z, { dashed = false, width = 3 } = {}) {
  const pos = app.t.drag?.positions?.get(t.id) || app.t.settling?.get(t.id) || t;
  const r = ((t.size || 1) / 2) * 1.02;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width / z;
  if (dashed) ctx.setLineDash([6 / z, 5 / z]);
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// PV et conditions d'un token, sur le portable seulement : une barre sous le token, un point
// par condition au-dessus.
function hpBadge(ctx, t, z) {
  const pos = app.t.drag?.positions?.get(t.id) || app.t.settling?.get(t.id) || t;
  const r = (t.size || 1) / 2;
  ctx.save();
  if (t.hp?.max > 0) {
    const w = Math.max(0.8, r * 1.6);
    const h = 5 / z;
    const x = pos.x - w / 2;
    const y = pos.y + r * 0.92;
    const k = Math.max(0, Math.min(1, t.hp.current / t.hp.max));
    ctx.fillStyle = 'rgba(0,0,0,.7)';
    ctx.fillRect(x - 1 / z, y - 1 / z, w + 2 / z, h + 2 / z);
    ctx.fillStyle = k > 0.5 ? '#45c06b' : k > 0.25 ? '#f2a33a' : '#ff5a4f';
    ctx.fillRect(x, y, w * k, h);
  }
  const n = t.conditions?.length || 0;
  for (let i = 0; i < Math.min(n, 6); i++) {
    ctx.beginPath();
    ctx.arc(pos.x - r * 0.7 + i * (7 / z), pos.y - r * 0.92, 3 / z, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd24a';
    ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.lineWidth = 1.5 / z;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// Contour par sorte de token, pour les repérer sur une carte chargée (une forêt, par exemple).
const OUTLINE = { pc: '#4fc3ff', ally: '#5ee38a', npc: '#ffd24a', enemy: '#ff4d4d' };
const COLOR_OF = { red: '#ff4d4d', blue: '#4fc3ff', green: '#5ee38a', yellow: '#ffd24a', purple: '#c58bff', orange: '#ff9f43', white: '#ffffff' };

function outline(ctx, t, z) {
  const pos = app.t.drag?.positions?.get(t.id) || app.t.settling?.get(t.id) || t;
  const r = ((t.size || 1) / 2) * 0.98;
  const color = t.defeated ? '#9a9a9a' : COLOR_OF[t.color] || OUTLINE[t.kind] || OUTLINE.enemy;
  ctx.save();
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,.75)';
  ctx.lineWidth = 5.5 / z;
  ctx.stroke();
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5 / z;
  ctx.stroke();
  ctx.restore();
}

function drawOverlays(ctx, z) {
  const { doc } = app;
  const inWalls = app.mode === 'walls';
  if (inWalls || app.showWalls) drawWalls(ctx, doc, z, { vertices: inWalls });
  if (inWalls) { drawIssues(ctx, doc, z); drawTestView(ctx, z); } else drawDoorHandles(ctx, doc, z);

  if (!inWalls) {
    const fight = doc.fight;
    const current = fight?.started ? fight.rows.find(r => r.id === fight.current) : null;
    const hovered = app.rowHover ? fight?.rows.find(r => r.id === app.rowHover) : null;
    if (app.outlines) for (const t of doc.tokens) if (!t.hidden) outline(ctx, t, z);
    for (const t of doc.tokens) {
      if (t.hidden) ring(ctx, t, '#ff5a4f', z, { dashed: true, width: 2 });
      if (current?.tokenIds.includes(t.id) && !t.defeated) ring(ctx, t, '#ffd24a', z, { width: 4 });
      if (hovered?.tokenIds.includes(t.id)) ring(ctx, t, '#ffffff', z, { width: 3 });
      if (app.selection.has(t.id)) ring(ctx, t, '#6fb1ff', z);
      if (t.hp || t.conditions?.length) hpBadge(ctx, t, z);
      if (app.selection.has(t.id) || app.hover === t.id) {
        const box = tokenBox(t, tokenImage(t.image));
        const pos = app.t.drag?.positions?.get(t.id) || t;
        label(ctx, t.name, pos.x, pos.y + Math.max((t.size || 1) / 2, box.h / 2.6) + 14 / z, z);
      }
    }
  }

  // Ce que la TV cadre, quand elle affiche cette carte.
  if (app.tvScene === app.sceneId) {
    const rect = doc.tvCamera || boundsRect(doc);
    const size = app.tvSize || { w: 16, h: 9 };
    const cam = fitCamera(rect, size.w, size.h);
    ctx.save();
    ctx.strokeStyle = 'rgba(126,231,135,.8)';
    ctx.lineWidth = 2 / z;
    ctx.setLineDash([12 / z, 8 / z]);
    ctx.strokeRect(cam.x, cam.y, size.w / cam.z, size.h / cam.z);
    ctx.restore();
  }

  tool().overlay?.(ctx, z);
}

function fogOption() {
  if (app.fogMode === 'off') return null;
  if (app.fogMode === 'tv') return { alpha: 1 };
  return app.mode === 'walls' ? null : { alpha: 0.5 };
}

function drawAll() {
  const c = app.canvas;
  if (!c) return;
  const ctx = c.getContext('2d');
  if (!app.doc) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, c.width, c.height);
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  drawScene(ctx, app.doc, app.cam, {
    role: 'dm', dpr, rev: app.rev, mapImage: app.mapImage,
    showGrid: app.showGrid, live: app.live, fog: fogOption(), onImage: requestDraw,
    dragging: app.t.drag?.moved ? app.t.drag.positions : app.t.settling || null,
    tokenStyle: (t, seen) => (t.hidden ? 0.55 : seen ? 1 : 0.7),
    afterFog: drawOverlays,
  });
}

// --------------------------------------------------------------- Le canvas et la souris

function MapCanvas() {
  const ref = useRef(null);
  const wrap = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    app.canvas = canvas;
    setDraw(drawAll);

    const fit = () => {
      const r = wrap.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const first = app.size.w === 800 && app.size.h === 600;
      app.size = { w: r.width, h: r.height };
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      if (first) fitToMap();
      requestDraw();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(wrap.current);
    fit();

    let pan = null;
    const world = e => toWorld(e.offsetX, e.offsetY);
    const down = e => {
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 1 || e.button === 2 || app.t.space) {
        pan = { x: e.clientX, y: e.clientY, cam: { ...app.cam } };
        canvas.style.cursor = 'grabbing';
        return;
      }
      if (e.button === 0) tool().down(world(e), e);
    };
    const move = e => {
      if (pan) {
        app.cam = { ...pan.cam, x: pan.cam.x - (e.clientX - pan.x) / app.cam.z, y: pan.cam.y - (e.clientY - pan.y) / app.cam.z };
        notify();
        requestDraw();
        return;
      }
      tool().move?.(world(e), e);
      canvas.style.cursor = tool().cursor?.() || 'default';
    };
    const up = e => {
      if (pan) { pan = null; canvas.style.cursor = tool().cursor?.() || 'default'; return; }
      if (e.button === 0) tool().up?.(world(e), e);
    };
    const leave = () => {
      if (app.hover) { app.hover = null; notify(); requestDraw(); }
    };
    const dbl = e => tool().dbl?.(world(e), e);
    const wheel = e => {
      e.preventDefault();
      const w = toWorld(e.offsetX, e.offsetY);
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0014));
      const z = Math.max(1.5, Math.min(260, app.cam.z * factor));
      app.cam = { z, x: w.x - e.offsetX / z, y: w.y - e.offsetY / z };
      notify();
      requestDraw();
    };
    const menu = e => e.preventDefault();
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('dblclick', dbl);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('contextmenu', menu);
    return () => {
      ro.disconnect();
      setDraw(null);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('dblclick', dbl);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', menu);
    };
  }, []);

  return html`<div class="mc-wrap" ref=${wrap}>
    <canvas class="mc" ref=${ref}></canvas>
    ${app.loadingMap ? html`<div class="mc-msg">Chargement de la carte…</div>` : null}
    ${!app.doc && app.conn === 'online' ? html`<div class="mc-msg big">
      ${app.scenes.length ? 'Choisis une carte en haut.' : html`Aucune carte. <button type="button" class="btn primary" onClick=${() => { app.dialog = { kind: 'scene' }; notify(); }}>Créer la première</button>`}
    </div>` : null}
    ${app.placing ? html`<div class="mc-banner">Clique sur la carte pour poser ${app.placing.tokens.length > 1 ? `les ${app.placing.tokens.length} tokens` : 'le token'}. Échap pour annuler.</div>` : null}
    <${InfoCard} />
    <${SelectionBar} />
  </div>`;
}

// --------------------------------------------------------------- Barre de sélection

function SelectionBar() {
  if (app.mode !== 'play' || !app.selection.size || app.t.drag?.moved) return null;
  const tokens = selectedTokens();
  if (!tokens.length) return null;
  const ids = tokens.map(t => t.id);
  const one = tokens.length === 1 ? tokens[0] : null;
  const all = k => tokens.every(t => t[k]);
  const update = patch => op({ type: 'token.update', ids, patch });
  const tracked = tokens.filter(t => t.hp);
  const hpChange = (input, sign) => {
    const n = Math.round(Number(input?.value));
    if (!(n > 0)) { input?.focus(); return; }
    op({ type: 'token.hp', ids: tracked.map(t => t.id), delta: sign * n });
    input.value = '';
  };
  const rename = () => {
    const name = prompt(tx('Nom du token'), one.name);
    if (name?.trim()) update({ name: name.trim() });
  };
  const scale = k => {
    for (const t of tokens) op({ type: 'token.update', id: t.id, patch: { scale: Math.max(0.2, Math.round((t.scale || 1) * k * 100) / 100) } });
  };
  return html`<div class="sel-bar" onPointerDown=${e => e.stopPropagation()}>
    <span class="sel-name">${one ? one.name : `${tokens.length} tokens`}</span>
    <button type="button" class=${`chip ${all('hidden') ? 'on warn' : ''}`} title="Invisible sur la TV même en ligne de vue. Raccourci : H" onClick=${() => update({ hidden: !all('hidden') })}>${all('hidden') ? 'Caché' : 'Cacher'}</button>
    <button type="button" class=${`chip ${all('defeated') ? 'on' : ''}`} title="Reste sur la carte, grisé. Raccourci : D" onClick=${() => update({ defeated: !all('defeated') })}>${all('defeated') ? 'Vaincu' : 'Vaincre'}</button>
    <button type="button" class=${`chip ${all('vision') ? 'on' : ''}`} title="Ce token éclaire le brouillard" onClick=${() => update({ vision: !all('vision') })}>Donne la vue</button>
    <button type="button" class=${`chip ${all('showName') ? 'on' : ''}`} title="Nom visible sur la TV, sous le token, quand le groupe le voit" onClick=${() => update({ showName: !all('showName') })}>Nom sur la TV</button>
    <button type="button" class=${`chip ${all('showHp') ? 'on' : ''}`} title="Barre de vie sur la TV, sans chiffres, quand le groupe le voit" onClick=${() => update({ showHp: !all('showHp') })}>PV sur la TV</button>
    ${tracked.length ? html`<span class="chip-group hp-quick" title="Dégâts ou soins rapides : Entrée pour des dégâts">
      ${one?.hp ? html`<span class="chip-val">PV ${one.hp.current} / ${one.hp.max}</span>` : null}
      <input class="num tiny" type="number" min="0" inputMode="numeric" aria-label="PV à retirer ou à rendre" placeholder="PV"
        onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); hpChange(e.currentTarget, -1); } }} />
      <button type="button" class="chip danger" onClick=${e => hpChange(e.currentTarget.parentElement.querySelector('input'), -1)}>Dégâts</button>
      <button type="button" class="chip" onClick=${e => hpChange(e.currentTarget.parentElement.querySelector('input'), 1)}>Soin</button>
    </span>` : null}
    ${one?.vision ? html`<button type="button" class=${`chip ${app.doc.view?.tokenId === one.id ? 'on' : ''}`} title="La TV ne montre que ce que voit ce token" onClick=${() => op(app.doc.view?.tokenId === one.id ? { type: 'view.set', mode: 'party' } : { type: 'view.set', mode: 'token', tokenId: one.id })}>Sa vue sur la TV</button>` : null}
    <span class="sep"></span>
    ${one ? html`<button type="button" class="chip" onClick=${rename}>Renommer</button>
      <button type="button" class="chip" title="PV, conditions, notes, bloc de stats · double-clic sur le token" onClick=${() => { app.dialog = { kind: 'token', id: one.id }; notify(); }}>Détails</button>` : null}
    <button type="button" class="chip" onClick=${() => { app.dialog = { kind: 'image', ids }; notify(); }}>Image</button>
    <span class="chip-group" title="Tourner · raccourcis Q et E">
      <button type="button" class="chip" aria-label="Tourner à gauche" onClick=${() => rotateTokens(tokens, -15)}>⟲</button>
      <button type="button" class="chip" aria-label="Tourner à droite" onClick=${() => rotateTokens(tokens, 15)}>⟳</button>
    </span>
    <span class="chip-group" title="Taille en cases">
      <button type="button" class="chip" onClick=${() => { for (const t of tokens) op({ type: 'token.update', id: t.id, patch: { size: Math.max(1, (t.size || 1) - 1) } }); }}>−</button>
      <span class="chip-val">${one ? one.size : '…'} case${one && one.size > 1 ? 's' : ''}</span>
      <button type="button" class="chip" onClick=${() => { for (const t of tokens) op({ type: 'token.update', id: t.id, patch: { size: Math.min(8, (t.size || 1) + 1) } }); }}>+</button>
    </span>
    <span class="chip-group" title="Taille de l'image">
      <button type="button" class="chip" onClick=${() => scale(1 / 1.15)}>−</button>
      <span class="chip-val">image</span>
      <button type="button" class="chip" onClick=${() => scale(1.15)}>+</button>
    </span>
    <span class="sep"></span>
    <button type="button" class="chip danger" title="Raccourci : Suppr" onClick=${() => op({ type: 'token.remove', ids })}>Retirer</button>
  </div>`;
}

// --------------------------------------------------------------- Barres

function ToolButton({ id, label: text, keyHint, icon }) {
  return html`<button type="button" class=${`tool ${app.tool === id ? 'on' : ''}`} title=${keyHint ? `${text} · raccourci ${keyHint}` : text} onClick=${() => setTool(id)}>
    <span class="tool-i">${icon}</span><span>${text}</span>
  </button>`;
}

function WallPanel() {
  const { doc } = app;
  const sel = app.wallSel ? doc?.walls.find(w => w.id === app.wallSel) : null;
  const issues = doc ? wallIssues(doc) : { dangling: [] };
  const groups = [...new Set((doc?.walls || []).filter(w => w.group).map(w => w.group))];
  return html`<div class="tool-panel">
    <p class="small"><b>${doc?.walls.filter(w => w.kind === 'wall').length || 0}</b> murs · <b>${doc?.walls.filter(w => w.kind === 'door').length || 0}</b> portes</p>
    ${issues.dangling.length ? html`<p class="small warn" title="Entourées en rouge sur la carte. Un mur isolé peut être voulu ; un mur qui ne rejoint pas le suivant laisse passer la vue.">${issues.dangling.length} extrémité${issues.dangling.length > 1 ? 's' : ''} libre${issues.dangling.length > 1 ? 's' : ''}</p>` : null}
    <label class="small">Calage
      <select class="sel" value=${app.wallSnap} onChange=${e => { app.wallSnap = Number(e.target.value); notify(); }}>
        <option value="1">Case entière</option><option value="2">Demi-case</option><option value="4">Quart de case</option><option value="0">Aucun</option>
      </select>
    </label>
    <p class="muted tiny-note">Maj : sans calage.</p>
    ${app.tool === 'wall-door' ? html`<label class="small">Levier, groupe de portes
      <input class="txt" list="door-groups" placeholder="levier-bleu" value=${app.doorGroup} onInput=${e => { app.doorGroup = e.target.value; notify(); }} onKeyDown=${e => e.stopPropagation()} />
      <datalist id="door-groups">${groups.map(g => html`<option value=${g} />`)}</datalist>
    </label>` : null}
    ${app.tool === 'wall-line' ? html`<p class="muted tiny-note">Clic pour chaque point. Double-clic ou Entrée pour finir, Retour arrière pour enlever un point.</p>` : null}
    ${app.tool === 'wall-edit' ? html`<p class="muted tiny-note">Glisse un sommet. Double-clic sur un mur : nouveau sommet. Clic : sélection.</p>` : null}
    ${app.tool === 'wall-erase' ? html`<p class="muted tiny-note">Clic : un segment. Glisser : tout ce qui est dans le rectangle.</p>` : null}
    ${app.tool === 'wall-test' ? html`<p class="muted tiny-note">Clique ou glisse pour voir ce qu'on voit de là. Rien ne s'affiche sur la TV.</p>` : null}
    ${sel ? html`<div class="wall-sel">
      <p class="small"><b>${sel.kind === 'door' ? 'Porte' : 'Mur'}</b> ${sel.id}</p>
      <button type="button" class="btn tiny" onClick=${() => op({ type: 'wall.update', id: sel.id, kind: sel.kind === 'door' ? 'wall' : 'door' })}>${sel.kind === 'door' ? 'En faire un mur' : 'En faire une porte'}</button>
      ${sel.kind === 'door' ? html`<label class="small">Groupe
        <input class="txt" value=${sel.group || ''} onChange=${e => op({ type: 'wall.update', id: sel.id, group: e.target.value.trim() })} onKeyDown=${e => e.stopPropagation()} />
      </label>
      <button type="button" class="btn tiny" onClick=${() => op({ type: 'door.toggle', id: sel.id })}>${sel.open ? 'Fermer' : 'Ouvrir'}</button>` : null}
      <button type="button" class="btn tiny danger ghost" onClick=${() => { op({ type: 'wall.remove', ids: [sel.id] }); app.wallSel = null; notify(); }}>Supprimer</button>
    </div>` : null}
    <button type="button" class="btn tiny primary" title="Propose les murs en lisant l'image" onClick=${() => { app.dialog = { kind: 'autowalls' }; notify(); }}>Auto-murs</button>
    <button type="button" class="btn tiny" onClick=${() => { app.dialog = { kind: 'grid' }; notify(); }}>Réglages de la grille</button>
    <button type="button" class="btn tiny ghost" onClick=${() => { app.dialog = { kind: 'scenefile' }; notify(); }}>Fichier de la scène (JSON)</button>
  </div>`;
}

function PlayPanel() {
  const { tool: t, doc } = app;
  if (t === 'template') {
    const shapes = [['cone', 'Cône'], ['circle', 'Cercle'], ['line', 'Ligne'], ['square', 'Carré']];
    return html`<div class="tool-panel">
      <div class="shape-row">${shapes.map(([k, l]) => html`<button type="button" class=${`chip ${app.templateShape === k ? 'on' : ''}`} onClick=${() => { app.templateShape = k; notify(); }}>${l}</button>`)}</div>
      <p class="muted tiny-note">Glisse depuis l'origine : la taille se cale par pas de ${doc?.grid.feetPerCell || 5} ft. Clic sur un gabarit : retiré.</p>
      ${doc?.templates.length ? html`<button type="button" class="btn tiny" onClick=${() => op({ type: 'template.clear' })}>Tout retirer</button>` : null}
    </div>`;
  }
  if (t === 'draw') {
    const shapes = [['pen', 'Trait'], ['line', 'Ligne'], ['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['erase', 'Effacer']];
    const colors = ['#e40712', '#ffd24a', '#5aa9ff', '#7ee787', '#ffffff', '#000000'];
    return html`<div class="tool-panel">
      <div class="shape-row">${shapes.map(([k, l]) => html`<button type="button" class=${`chip ${app.draw.shape === k ? 'on' : ''}`} onClick=${() => { app.draw = { ...app.draw, shape: k }; notify(); }}>${l}</button>`)}</div>
      <div class="shape-row">${colors.map(c => html`<button type="button" class=${`swatch ${app.draw.color === c ? 'on' : ''}`} aria-label=${c} style=${{ background: c }} onClick=${() => { app.draw = { ...app.draw, color: c }; notify(); }}></button>`)}</div>
      ${doc?.drawings.length ? html`<button type="button" class="btn tiny" onClick=${() => op({ type: 'drawing.clear' })}>Tout effacer</button>` : null}
    </div>`;
  }
  if (t === 'ruler') return html`<div class="tool-panel"><p class="muted tiny-note">Glisse d'une case à l'autre. Une diagonale compte une case. Alt : sans calage. Échap : retire le trait de la TV.</p></div>`;
  return null;
}

function ToolColumn() {
  if (app.mode === 'walls') {
    return html`<div class="tools-col">
      <${ToolButton} id="wall-line" label="Tracer" keyHint="W" icon="╱" />
      <${ToolButton} id="wall-door" label="Porte" keyHint="D" icon="▯" />
      <${ToolButton} id="wall-edit" label="Sommets" keyHint="E" icon="◦" />
      <${ToolButton} id="wall-erase" label="Gomme" keyHint="X" icon="⌫" />
      <${ToolButton} id="wall-test" label="Tester" keyHint="L" icon="◉" />
      <${WallPanel} />
    </div>`;
  }
  return html`<div class="tools-col">
    <${ToolButton} id="select" label="Tokens" keyHint="V" icon="➤" />
    <${ToolButton} id="ruler" label="Règle" keyHint="R" icon="📏" />
    <${ToolButton} id="template" label="Gabarit" keyHint="G" icon="◭" />
    <${ToolButton} id="draw" label="Dessin" keyHint="P" icon="✎" />
    <button type="button" class="tool add" title="Ajouter un ennemi, le groupe ou un token · raccourci A" disabled=${!app.doc} onClick=${() => { app.dialog = { kind: 'add' }; notify(); }}><span class="tool-i">+</span><span>Ajouter</span></button>
    <${PlayPanel} />
    <button type="button" class="tool settings" disabled=${!app.doc} onClick=${() => { app.dialog = { kind: 'grid' }; notify(); }}><span class="tool-i">⚙</span><span>Réglages</span></button>
  </div>`;
}

function openTv() {
  const url = `/c/${campaignId}/carte/tv`;
  const features = 'popup,width=1280,height=720';
  // Chrome sait ouvrir la fenêtre directement sur l'autre écran, si on le lui permet.
  const place = async () => {
    try {
      const d = await window.getScreenDetails();
      const other = d.screens.find(s => s !== d.currentScreen);
      if (other) return `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
    } catch { /* permission refusée ou navigateur sans cette fonction */ }
    return features;
  };
  if (window.getScreenDetails) place().then(f => window.open(url, `dnd-tv-${campaignId}`, f));
  else window.open(url, `dnd-tv-${campaignId}`, features);
}

const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name, 'fr');

function TopBar() {
  const { doc, undo: u } = app;
  const onTv = app.tvScene && app.tvScene === app.sceneId;
  const tvSceneName = app.scenes.find(s => s.id === app.tvScene)?.name;
  const pcs = (doc?.tokens || []).filter(t => t.vision);
  return html`<header class="map-top">
    <div class="group">
      <a class="home" href=${`/c/${campaignId}`} title="Retour aux fiches">⚔</a>
      ${app.campaign ? html`<span class="camp-name" title=${app.campaign.name}>${app.campaign.name}</span>` : null}
      <select class="sel scene-sel" aria-label="Carte" value=${app.sceneId || ''} onChange=${e => openScene(e.target.value)}>
        ${app.sceneId ? null : html`<option value="">Carte…</option>`}
        ${sortFolders(new Set(app.scenes.map(s => s.folder))).map(f => html`<optgroup label=${f}>
          ${app.scenes.filter(s => s.folder === f).sort(byOrder).map(s => html`<option value=${s.id}>${s.name}${s.id === app.tvScene ? ' · sur la TV' : ''}</option>`)}
        </optgroup>`)}
      </select>
      <button type="button" class="btn tiny" title="Tous les dossiers · raccourci C" onClick=${() => { app.dialog = { kind: 'browser' }; notify(); }}>Cartes</button>
      <button type="button" class="btn tiny" title="Envoyer et ranger tes cartes et tes tokens · raccourci I" onClick=${() => { app.dialog = { kind: 'library' }; notify(); }}>Images</button>
    </div>
    <div class="seg-mode" role="group" aria-label="Mode">
      <button type="button" class=${app.mode === 'play' ? 'on' : ''} onClick=${() => setMode('play')}>Jeu</button>
      <button type="button" class=${app.mode === 'walls' ? 'on' : ''} disabled=${!doc} onClick=${() => setMode('walls')}>Murs</button>
    </div>
    <div class="group">
      <button type="button" class="icon-b" disabled=${!u.can} title=${u.label ? `Annuler : ${u.label} · Ctrl+Z` : 'Annuler'} onClick=${undo}>↶</button>
      <button type="button" class="icon-b" disabled=${!u.redo} title=${u.redoLabel ? `Rétablir : ${u.redoLabel} · Ctrl+Y` : 'Rétablir'} onClick=${redo}>↷</button>
      <button type="button" class="icon-b" disabled=${!doc} title="Voir toute la carte sur le portable · raccourci F" onClick=${fitToMap}>⤢</button>
    </div>
    <div class="group">
      <span class="lbl">Voile</span>
      <select class="sel" aria-label="Affichage du brouillard sur le portable" value=${app.fogMode} onChange=${e => { app.fogMode = e.target.value; refresh(); }}>
        <option value="tint">Léger</option><option value="tv">Comme la TV</option><option value="off">Aucun</option>
      </select>
      <label class="check small"><input type="checkbox" checked=${app.showGrid} onChange=${e => { app.showGrid = e.target.checked; refresh(); }} /> Grille</label>
      <label class="check small"><input type="checkbox" checked=${app.showWalls} onChange=${e => { app.showWalls = e.target.checked; refresh(); }} /> Murs</label>
      <label class="check small" title="Contour coloré autour des tokens, sur le portable seulement : bleu PJ, rouge ennemi, vert allié, jaune PNJ"><input type="checkbox" checked=${app.outlines} onChange=${e => { app.outlines = e.target.checked; try { localStorage.setItem('mapOutlines', e.target.checked ? '1' : '0'); } catch { /* stockage indisponible */ } refresh(); }} /> Contours</label>
    </div>
    <div class="grow"></div>
    <div class="group tv-group">
      <span class="lbl">TV</span>
      <button type="button" class="btn tiny" onClick=${openTv}>Ouvrir la fenêtre</button>
      <button type="button" class=${`btn tiny ${onTv ? 'on' : ''}`} disabled=${!doc} title=${onTv ? 'Cette carte est sur la TV' : tvSceneName ? `La TV montre ${tvSceneName}` : 'La TV n\'affiche rien'} onClick=${() => sendToTv()}>${onTv ? 'Carte sur la TV' : 'Envoyer la carte'}</button>
      <button type="button" class="btn tiny" disabled=${!doc} title="Raccourci : T" onClick=${() => op({ type: 'tv.camera', camera: viewRect() })}>Envoyer ce cadrage</button>
      <button type="button" class="btn tiny" disabled=${!doc} onClick=${() => op({ type: 'tv.camera', camera: null })}>Tout le plan</button>
      <select class="sel" aria-label="Vue sur la TV" disabled=${!doc} value=${doc?.view?.mode === 'token' ? doc.view.tokenId : ''} onChange=${e => op(e.target.value ? { type: 'view.set', mode: 'token', tokenId: e.target.value } : { type: 'view.set', mode: 'party' })}>
        <option value="">Vue du groupe</option>
        ${pcs.map(t => html`<option value=${t.id}>Vue de ${t.name}</option>`)}
      </select>
      ${doc?.fog === false ? html`<span class="lbl" title="Se change dans Réglages de la carte">Sans brouillard</span>` : null}
      <button type="button" class=${`btn tiny ${doc?.frozen ? 'on warn' : ''}`} disabled=${!doc} title="Replace tes tokens sans rien révéler : la TV garde son image" onClick=${() => op({ type: 'frozen.set', value: !doc.frozen })}>${doc?.frozen ? 'TV gelée' : 'Geler'}</button>
      <button type="button" class="btn tiny ghost" disabled=${!doc} title="Oublie tout ce qui a été vu sur cette carte" onClick=${() => { if (confirm(tx('Oublier tout ce qui a été vu sur cette carte ? Ctrl+Z pour revenir en arrière.'))) op({ type: 'fog.reset' }); }}>Brouillard à zéro</button>
    </div>
    <span class=${`conn-dot ${app.conn}`} title=${app.conn === 'online' ? 'Connecté' : 'Hors ligne'}></span>
  </header>`;
}

function Toasts() {
  return html`<div class="map-toasts">${app.toasts.map(t => html`<div key=${t.id} class=${`m-toast ${t.kind}`}>${t.text}</div>`)}</div>`;
}

function Dialogs() {
  const d = app.dialog;
  if (!d) return null;
  if (d.kind === 'browser') return html`<${SceneBrowser} />`;
  if (d.kind === 'scene') return html`<${NewSceneDialog} />`;
  if (d.kind === 'grid') return html`<${GridDialog} />`;
  if (d.kind === 'add') return html`<${AddTokenDialog} />`;
  if (d.kind === 'image') return html`<${ChangeImageDialog} />`;
  if (d.kind === 'token') return html`<${TokenEditor} key=${d.id} />`;
  if (d.kind === 'autowalls') return html`<${AutoWallsDialog} />`;
  if (d.kind === 'scenefile') return html`<${SceneFileDialog} />`;
  if (d.kind === 'library') return html`<${ImageLibraryDialog} key=${d.tab || ''} />`;
  return null;
}

// --------------------------------------------------------------- Clavier

function onKey(e) {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (app.dialog || store.ui.modal) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space') { app.t.space = true; e.preventDefault(); return; }
  if (tool().key?.(e)) { e.preventDefault(); return; }
  // Cartes et images s'ouvrent aussi sans carte ouverte : c'est par là qu'on commence.
  if (k === 'c') { app.dialog = { kind: 'browser' }; notify(); return; }
  if (k === 'i') { app.dialog = { kind: 'library' }; notify(); return; }
  if (!app.doc) return;
  if (k === 't') { op({ type: 'tv.camera', camera: viewRect() }); toast('Cadrage envoyé à la TV', 'info', 1500); return; }
  if (k === 'f') { fitToMap(); return; }
  if (app.mode === 'walls') {
    const map = { w: 'wall-line', d: 'wall-door', e: 'wall-edit', x: 'wall-erase', l: 'wall-test' };
    if (map[k]) setTool(map[k]);
    return;
  }
  const map = { v: 'select', r: 'ruler', g: 'template', p: 'draw' };
  if (map[k]) { setTool(map[k]); return; }
  if (k === 'a') { app.dialog = { kind: 'add' }; notify(); return; }
  if (k === 'n' && app.doc.fight) op({ type: 'fight.next' });
}

function onKeyUp(e) {
  if (e.code === 'Space') app.t.space = false;
}

// --------------------------------------------------------------- Connexion et coquille

function App() {
  const [, force] = useState(0);
  useEffect(() => {
    const a = subscribe(() => force(x => x + 1));
    const b = subscribeStore(() => force(x => x + 1));
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    if (getToken()) start();
    return () => { a(); b(); window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
  }, []);
  if (!getToken()) {
    return html`<div class="join"><div class="join-card"><h1>Carte du MJ</h1><p class="muted">Connecte-toi d'abord à l'application.</p>
      <button type="button" class="btn primary" onClick=${goLogin}>Se connecter</button></div></div>`;
  }
  if (app.conn === 'denied') {
    return html`<div class="join"><div class="join-card"><h1>Carte du MJ</h1><p>${app.deniedReason || 'Réservé au MJ de la campagne'}</p>
      <a class="btn" href=${`/c/${campaignId}`}>Retour aux fiches</a> <a class="btn ghost" href="/">Mes campagnes</a></div></div>`;
  }
  return html`<div class="map-app">
    <${TopBar} />
    <div class="map-main">
      <${ToolColumn} />
      <${MapCanvas} />
      <${Tracker} />
    </div>
    <${Dialogs} />
    <${ModalHost} />
    <${Toasts} />
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
