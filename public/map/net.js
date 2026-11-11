// Connexion du portable du MJ et de la TV au serveur de la carte. La carte se sert de la
// session ouverte sur la page des fiches (même origine, même stockage) ; la campagne est dans
// l'adresse : /c/<id>/carte et /c/<id>/carte/tv.
import { getLang } from '/shared/i18n.js';

export const campaignId = (/^\/c\/([\w-]+)\//.exec(location.pathname) || [])[1] || '';
export const mapApi = path => `/api/c/${campaignId}/map${path}`;

export function getToken() {
  try { return JSON.parse(localStorage.getItem('token')); } catch { return null; }
}

// Pas de session sur ce navigateur : on passe par la page de connexion de l'application.
export function goLogin() {
  location.href = `/?next=${encodeURIComponent(location.pathname)}`;
}

export async function api(path, { method = 'GET', body, raw, headers = {} } = {}) {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: {
      'X-Lang': getLang(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
  return data;
}

// Canal temps réel, avec reconnexion. `on` reçoit chaque message ; `onState` l'état de la connexion.
export function connectMap(role, { on, onState }) {
  let ws = null;
  let retry = 0;
  let seq = 0;
  let stopped = false;
  const waiting = new Map();

  function open() {
    if (stopped) return;
    onState?.('connecting');
    const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/map`);
    ws = sock;
    sock.onopen = () => { retry = 0; sock.send(JSON.stringify({ t: 'hello', token: getToken(), campaign: campaignId, role })); };
    sock.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.t === 'ack') {
        const w = waiting.get(m.id);
        waiting.delete(m.id);
        w?.(m);
        return;
      }
      if (m.t === 'welcome') onState?.('online');
      if (m.t === 'denied') { stopped = true; onState?.('denied', m.reason); }
      on(m);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      for (const w of waiting.values()) w({ ok: false, error: 'Connexion perdue' });
      waiting.clear();
      if (stopped) return;
      onState?.('offline');
      setTimeout(open, Math.min(8000, 500 * 2 ** retry++));
    };
  }

  open();

  return {
    send(msg) {
      if (ws?.readyState === 1) { ws.send(JSON.stringify(msg)); return true; }
      return false;
    },
    request(msg) {
      return new Promise(resolve => {
        msg.id = ++seq;
        if (ws?.readyState !== 1) { resolve({ ok: false, error: 'Hors ligne' }); return; }
        waiting.set(msg.id, resolve);
        ws.send(JSON.stringify(msg));
      });
    },
    stop() { stopped = true; try { ws?.close(); } catch { /* déjà fermé */ } },
  };
}
