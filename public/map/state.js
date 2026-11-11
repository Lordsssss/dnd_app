// État du portable du MJ : la scène reçue du serveur, plus ce qui ne regarde que cet écran.
import { applyUpdate } from '/shared/map/ops.js';
import { tx } from '/shared/i18n.js';
import { campaignId, connectMap, getToken } from './net.js';
import { loadMap } from './images.js';
import { boundsRect, fitCamera } from './render.js';

export const app = {
  conn: 'connecting',
  scenes: [],
  tvScene: null,
  sceneId: null,
  doc: null,
  rev: 0,
  mapImage: null,
  mapPath: null,
  loadingMap: false,
  fileError: null,
  undo: { can: false, redo: false, label: null, redoLabel: null },

  canvas: null,
  size: { w: 800, h: 600 },
  cam: { x: 0, y: 0, z: 20 },
  tvSize: null,

  mode: 'play',            // 'play' ou 'walls'
  tool: 'select',
  selection: new Set(),
  hover: null,             // id du token survolé
  rowHover: null,          // ligne de l'ordre survolée
  dialog: null,
  toasts: [],
  fogMode: 'tint',         // 'tint' voile léger, 'tv' comme la TV, 'off' sans
  showGrid: false,
  showWalls: false,
  // Contour coloré autour de chaque token, sur le portable seulement : PJ, ennemi, allié, PNJ.
  outlines: (() => { try { return localStorage.getItem('mapOutlines') !== '0'; } catch { return true; } })(),
  trackerOpen: true,
  wallSnap: 2,             // Sommets alignés sur 1/2 case ; 4 pour le quart ; 0 sans grille
  doorGroup: '',
  templateShape: 'cone',
  draw: { shape: 'pen', color: '#e40712', width: 0.12 },

  // Ce qu'un outil est en train de faire : transitoire, jamais envoyé au serveur.
  t: {},
  placing: null,
  live: {},
  wallSel: null,
  testOrigin: null,
};

const subs = new Set();
let notifyScheduled = false;
let drawFn = null;
let drawScheduled = false;

export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function notify() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => { notifyScheduled = false; for (const fn of subs) fn(); });
}
export function setDraw(fn) { drawFn = fn; }
export function requestDraw() {
  if (drawScheduled || !drawFn) return;
  drawScheduled = true;
  requestAnimationFrame(() => { drawScheduled = false; drawFn(); });
}
export function refresh() { notify(); requestDraw(); }

let toastSeq = 0;
export function toast(text, kind = 'info', ms = 3500) {
  const t = { id: ++toastSeq, text: tx(text), kind };
  app.toasts = [...app.toasts.slice(-3), t];
  notify();
  setTimeout(() => { app.toasts = app.toasts.filter(x => x.id !== t.id); notify(); }, ms);
}

// --------------------------------------------------------------- Connexion

let conn = null;

function rememberUndo(m) {
  app.undo = { can: !!m.canUndo, redo: !!m.canRedo, label: m.undoLabel || null, redoLabel: m.redoLabel || null };
}

async function useMap(path) {
  if (path === app.mapPath) return;
  app.mapPath = path;
  app.mapImage = null;
  app.loadingMap = !!path;
  refresh();
  if (!path) return;
  try {
    const m = await loadMap(path);
    if (app.mapPath !== path) return;
    app.mapImage = m;
    app.loadingMap = false;
    refresh();
  } catch (e) {
    app.loadingMap = false;
    toast(e.message, 'error', 6000);
    refresh();
  }
}

export function fitToMap() {
  if (!app.doc) return;
  app.cam = fitCamera(boundsRect(app.doc), app.size.w, app.size.h, 16);
  requestDraw();
}

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
    case 'scenes': {
      app.scenes = m.scenes;
      app.tvScene = m.tvScene;
      if (m.t === 'welcome') {
        app.campaign = m.campaign || null;
        if (app.campaign) document.title = `Carte · ${app.campaign.name}`;
        const last = (() => { try { return localStorage.getItem(`mapScene:${campaignId}`); } catch { return null; } })();
        const pick = [app.sceneId, last, m.tvScene, m.scenes[0]?.id].find(id => id && m.scenes.some(s => s.id === id));
        if (pick) openScene(pick);
      } else if (app.sceneId && !m.scenes.some(s => s.id === app.sceneId)) {
        app.sceneId = null;
        app.doc = null;
      }
      refresh();
      break;
    }
    case 'scene': {
      const changed = m.scene !== app.sceneId || !app.doc;
      app.sceneId = m.scene;
      app.doc = m.doc;
      app.rev = m.rev + 1;
      app.fileError = m.fileError;
      rememberUndo(m);
      if (changed) {
        app.selection = new Set();
        app.t = {};
        app.placing = null;
        app.wallSel = null;
        app.testOrigin = null;
        fitToMap();
      }
      useMap(app.doc.image);
      refresh();
      break;
    }
    case 'update': {
      if (m.scene !== app.sceneId || !app.doc) return;
      applyUpdate(app.doc, m);
      app.rev = m.rev + 1;
      rememberUndo(m);
      app.fileError = null;
      if (m.set.image !== undefined) useMap(app.doc.image);
      for (const id of [...app.selection]) if (!app.doc.tokens.some(t => t.id === id)) app.selection.delete(id);
      refresh();
      break;
    }
    case 'sceneError':
      if (m.scene === app.sceneId) {
        app.fileError = m.error;
        toast(`Fichier de la carte illisible : ${m.error}`, 'error', 8000);
        refresh();
      }
      break;
    case 'tvSize':
      app.tvSize = { w: m.w, h: m.h };
      requestDraw();
      break;
    default: break;
  }
}

export function start() {
  if (conn) conn.stop();
  conn = connectMap('dm', {
    on: onMessage,
    onState(s, reason) {
      app.conn = s;
      if (reason) app.deniedReason = reason;
      refresh();
    },
  });
}

export function hasLogin() { return !!getToken(); }

export function openScene(id) {
  try { localStorage.setItem(`mapScene:${campaignId}`, id); } catch { /* stockage indisponible */ }
  conn?.request({ t: 'open', scene: id }).then(r => { if (!r.ok) toast(r.error || 'Carte illisible', 'error', 7000); });
}

export async function op(o) {
  if (!app.sceneId) return { ok: false };
  const r = await conn.request({ t: 'op', scene: app.sceneId, op: o });
  if (!r.ok) toast(r.error || 'Action refusée', 'error');
  return r;
}

export function undo() { if (app.sceneId) conn.request({ t: 'undo', scene: app.sceneId }); }
export function redo() { if (app.sceneId) conn.request({ t: 'redo', scene: app.sceneId }); }
export function sendToTv(id = app.sceneId) { if (id) conn.request({ t: 'tvScene', scene: id }); }
export function sendLive(live) {
  app.live = { ...app.live, ...live };
  conn?.send({ t: 'live', live });
  requestDraw();
}

// --------------------------------------------------------------- Coordonnées

export const toWorld = (sx, sy) => ({ x: app.cam.x + sx / app.cam.z, y: app.cam.y + sy / app.cam.z });

// Le rectangle affiché sur le portable, en cases.
export function viewRect() {
  const { w, h } = app.size;
  const { x, y, z } = app.cam;
  return { x, y, w: w / z, h: h / z };
}

// Un token impair se pose au centre d'une case, un token pair sur une intersection.
export function snapToken(x, y, size = 1) {
  if (size % 2 === 0) return { x: Math.round(x), y: Math.round(y) };
  return { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 };
}

export function tokenAt(x, y) {
  const list = app.doc?.tokens || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i];
    const r = (t.size || 1) / 2;
    if (Math.abs(x - t.x) <= r && Math.abs(y - t.y) <= r) return t;
  }
  return null;
}

export const selectedTokens = () => (app.doc?.tokens || []).filter(t => app.selection.has(t.id));
