// Calque de dessin à main levée (stylet, doigt, souris), stocké en vecteurs.
import { html, useEffect, useRef } from './html.js';
import { INK, PAGE_W, PAGE_H, outline, strokeHit } from '/shared/ink.js';
import { getIn, newId } from '/shared/patch.js';
import { myCharId, setOps, setPath, store } from './store.js';

const ERASE_R = 9;
let penSeen = false;

function palette() {
  const t = document.documentElement.getAttribute('data-theme');
  const dark = t !== 'light';
  return dark ? INK.dark : INK.light;
}

function drawStroke(ctx, s, pal) {
  ctx.fillStyle = pal[s.c] || pal.k;
  const { poly, caps } = outline(s);
  if (poly.length) {
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
    ctx.fill();
  }
  for (const [x, y, r] of caps) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
}

function prep(canvas, scale) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const k = scale * dpr;
  const w = Math.round(PAGE_W * k), h = Math.round(PAGE_H * k);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  return ctx;
}

export function DrawLayer({ docId, doc, layer, scale, editable }) {
  const path = layer === 'secret' ? ['secret', 'drawing'] : ['drawings', 'notes'];
  const strokes = getIn(doc, path) || {};
  const baseRef = useRef(null);
  const liveRef = useRef(null);
  const st = useRef({ cur: null, erasing: null, lastTouch: null });
  const active = editable && store.ui.pencil.on;
  const sig = Object.keys(strokes).join(',');

  const redraw = () => {
    const c = baseRef.current;
    if (!c) return;
    const ctx = prep(c, scale);
    ctx.clearRect(0, 0, PAGE_W, PAGE_H);
    const pal = palette();
    const hidden = st.current.erasing;
    const list = Object.entries(strokes).filter(([id]) => !hidden?.has(id)).map(([, s]) => s).sort((a, b) => (a.t || 0) - (b.t || 0));
    for (const s of list) drawStroke(ctx, s, pal);
  };

  useEffect(redraw, [sig, scale, store.ui.theme]);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', redraw);
    return () => mq.removeEventListener?.('change', redraw);
  });

  const toPage = e => {
    const r = liveRef.current.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * PAGE_W, ((e.clientY - r.top) / r.height) * PAGE_H];
  };
  const pressure = e => (e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.5) : 0.5);

  const drawLive = () => {
    const c = liveRef.current;
    const ctx = prep(c, scale);
    ctx.clearRect(0, 0, PAGE_W, PAGE_H);
    if (st.current.cur) drawStroke(ctx, st.current.cur, palette());
  };

  const eraseAt = (x, y) => {
    for (const [id, s] of Object.entries(strokes)) {
      if (!st.current.erasing.has(id) && strokeHit(s, x, y, ERASE_R)) {
        st.current.erasing.add(id);
        redraw();
      }
    }
  };

  const onDown = e => {
    if (!active) return;
    if (e.pointerType === 'pen') penSeen = true;
    if (e.pointerType === 'touch' && penSeen) { st.current.lastTouch = e.clientY; return; }
    e.preventDefault();
    try { liveRef.current.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    const [x, y] = toPage(e);
    const tool = store.ui.pencil.tool;
    if (tool === 'eraser' || e.buttons === 32) {
      st.current.erasing = new Set();
      eraseAt(x, y);
      return;
    }
    st.current.cur = { c: store.ui.pencil.color, w: e.pointerType === 'pen' ? 2.6 : 2.2, p: [x, y, pressure(e)] };
    drawLive();
  };

  const onMove = e => {
    if (!active) return;
    if (e.pointerType === 'touch' && penSeen) {
      // Le stylet dessine, le doigt fait défiler la page.
      if (st.current.lastTouch != null) { window.scrollBy(0, st.current.lastTouch - e.clientY); st.current.lastTouch = e.clientY; }
      return;
    }
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (st.current.erasing) {
      for (const ev of events) { const [x, y] = toPage(ev); eraseAt(x, y); }
      return;
    }
    const cur = st.current.cur;
    if (!cur) return;
    for (const ev of events.length ? events : [e]) {
      const [x, y] = toPage(ev);
      const n = cur.p.length;
      if (Math.hypot(x - cur.p[n - 3], y - cur.p[n - 2]) < 0.8) continue;
      cur.p.push(x, y, pressure(ev));
    }
    drawLive();
  };

  const onUp = e => {
    if (e.pointerType === 'touch' && penSeen) { st.current.lastTouch = null; return; }
    if (st.current.erasing) {
      const ids = [...st.current.erasing];
      st.current.erasing = null;
      if (ids.length) setOps(docId, ids.map(id => [[...path, id]]));
      else redraw();
      return;
    }
    const cur = st.current.cur;
    st.current.cur = null;
    drawLive();
    if (!cur) return;
    const stroke = { ...cur, p: cur.p.map(v => Math.round(v * 10) / 10), t: Date.now(), by: myCharId() };
    setPath(docId, [...path, newId('s')], stroke);
  };

  return html`<div class=${`draw-layer ${active ? 'active' : ''} ${store.ui.pencil.tool === 'eraser' ? 'erasing' : ''}`}>
    <canvas ref=${baseRef} class="draw-base"></canvas>
    <canvas ref=${liveRef} class="draw-live" onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp}></canvas>
  </div>`;
}

export function clearDrawing(docId, doc, layer) {
  const path = layer === 'secret' ? ['secret', 'drawing'] : ['drawings', 'notes'];
  const ids = Object.keys(getIn(doc, path) || {});
  if (ids.length) setOps(docId, ids.map(id => [[...path, id]]));
}
