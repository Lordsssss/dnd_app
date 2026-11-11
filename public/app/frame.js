// Page à ratio fixe (850 × 1100) mise à l'échelle de l'écran, comme une feuille PDF.
import { html, useState, useLayoutEffect, useRef } from './html.js';
import { PAGE_W, PAGE_H } from '/shared/ink.js';
import { store } from './store.js';

export function useScale(fit) {
  const ref = useRef(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const w = el.clientWidth;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const h = window.innerHeight - Math.max(0, top) - 8;
      let s = w / PAGE_W;
      if (fit === 'page') s = Math.min(s, h / PAGE_H);
      setScale(Math.max(0.3, Math.min(s, 1.35)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener('resize', compute);
    return () => { ro.disconnect(); window.removeEventListener('resize', compute); };
  }, [fit]);
  return [ref, scale];
}

export function PageFrame({ children, cls = '', overlay }) {
  const [ref, scale] = useScale(store.ui.fit);
  return html`<div class="frame" ref=${ref}>
    <div class="frame-inner" style=${{ width: `${PAGE_W * scale}px`, height: `${PAGE_H * scale}px` }}>
      <div class=${`page ${cls}`} style=${{ transform: `scale(${scale})` }}>
        ${children}
        ${overlay ? overlay(scale) : null}
      </div>
    </div>
  </div>`;
}
