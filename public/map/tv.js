// La fenêtre posée sur la TV : la carte sous son brouillard, et rien d'autre.
// Pas d'ordre d'initiative, pas d'interface, et un nom seulement sous les tokens que le MJ a ouverts.
import { applyUpdate } from '/shared/map/ops.js';
import { connectMap, getToken } from './net.js';
import { loadMap } from './images.js';
import { boundsRect, drawScene, fitCamera, viewFor } from './render.js';
import { MemeOverlay } from './memes.js';

const canvas = document.getElementById('tv');
const ctx = canvas.getContext('2d');
const msg = document.getElementById('tv-msg');
// Les memes, quand le MJ les permet sur la TV : le serveur n'envoie rien sinon.
const memes = new MemeOverlay(document.getElementById('tv-memes'));

let doc = null;
let sceneId = null;
let rev = 0;
let mapImage = null;
let mapPath = null;
let live = {};
let scheduled = false;
let msgTimer = null;
let wasFrozen = false;
// Gelée : les memes collés à un token restent où la TV montre ce token.
let frozenView = null;

function say(text, ms = 0) {
  msg.textContent = text;
  msg.classList.toggle('on', !!text);
  clearTimeout(msgTimer);
  if (ms) msgTimer = setTimeout(() => say(''), ms);
}

function draw() {
  scheduled = false;
  if (!doc) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); memes.render({ doc: null }); return; }
  // Gelée : la dernière image reste à l'écran pendant que le MJ replace ses tokens.
  if (doc.frozen && wasFrozen) { if (frozenView) memes.render(frozenView); return; }
  wasFrozen = !!doc.frozen;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  const cam = fitCamera(doc.tvCamera || boundsRect(doc), w, h);
  const seen = viewFor(doc, rev).seen;
  const view = { doc: doc.frozen ? { ...doc, tokens: doc.tokens.map(t => ({ ...t })) } : doc, cam, seen: new Set(seen) };
  frozenView = doc.frozen ? view : null;
  const z = cam.z * dpr;
  drawScene(ctx, doc, cam, {
    role: 'tv', dpr, rev, mapImage, live,
    fog: { alpha: 1, soft: Math.min(4, z * 0.03) },
    onImage: request,
  });
  memes.render(view);
}

function request() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(draw);
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  conn?.send({ t: 'tvSize', w: window.innerWidth, h: window.innerHeight });
  wasFrozen = false;
  request();
}

async function setMap(path) {
  if (path === mapPath) return;
  mapPath = path;
  mapImage = null;
  request();
  if (!path) return;
  try {
    const m = await loadMap(path);
    if (mapPath === path) { mapImage = m; wasFrozen = false; request(); }
  } catch (e) { say(e.message); }
}

let conn = null;

function start() {
  conn = connectMap('tv', {
    onState(s, reason) {
      if (s === 'denied') { doc = null; request(); say(reason || 'Réservé au MJ de la campagne', 0); }
    },
    on(m) {
      switch (m.t) {
        case 'welcome':
          conn.send({ t: 'tvSize', w: window.innerWidth, h: window.innerHeight });
          if (!m.tvScene) { doc = null; request(); }
          break;
        case 'scene':
          sceneId = m.scene;
          doc = m.doc;
          rev = m.rev + 1;
          live = {};
          wasFrozen = false;
          setMap(doc.image);
          request();
          break;
        case 'update':
          if (m.scene !== sceneId || !doc) return;
          applyUpdate(doc, m);
          rev = m.rev + 1;
          if (m.set.image !== undefined) setMap(doc.image);
          request();
          break;
        case 'live':
          if (m.scene === sceneId) { live = { ...live, ...m.live }; request(); }
          break;
        case 'memes': if (m.scene === sceneId) { memes.setAll(m.memes); request(); } break;
        case 'memeSet': if (m.scene === sceneId) memes.set(m.meme); break;
        case 'memeGone': if (m.scene === sceneId) memes.remove(m.ids); break;
        case 'react': if (m.scene === sceneId) memes.react(m.r); break;
        default: break;
      }
    },
  });
}

// La TV reprend la session du portable (même navigateur). Sans session : un message.
function askLogin() {
  say('Connecte-toi d\'abord sur la page des fiches, dans ce navigateur, puis recharge cette fenêtre.', 0);
}

window.addEventListener('resize', resize);

// Le plein écran demande un clic sur la fenêtre : c'est une règle du navigateur.
window.addEventListener('click', () => {
  if (!document.fullscreenElement && getToken()) document.documentElement.requestFullscreen?.().catch(() => {});
});
window.addEventListener('keydown', e => { if (e.key === 'f') document.documentElement.requestFullscreen?.().catch(() => {}); });

resize();
if (getToken()) start();
else askLogin();
if (getToken()) say('Clique ici pour passer en plein écran, ou F11', 6000);
