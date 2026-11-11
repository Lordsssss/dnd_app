// Adresse réseau local + QR code (terminal et SVG).
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const qrcode = require('qrcode-generator');

const VIRTUAL = /(vEthernet|VirtualBox|VMware|Hyper-V|WSL|docker|Loopback|Tailscale|ZeroTier|vboxnet|utun|bridge)/i;

function isPrivate(ip) {
  return /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

export function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      out.push({ name, ip: a.address, score: (isPrivate(a.address) ? 2 : 0) + (VIRTUAL.test(name) ? -3 : 0) + (/^192\.168\./.test(a.address) ? 1 : 0) + (/wi-?fi|wlan|wireless/i.test(name) ? 1 : 0) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

function make(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr;
}

// Demi-blocs Unicode : deux rangées de modules par ligne de terminal.
export function qrTerminal(text) {
  const qr = make(text);
  const n = qr.getModuleCount();
  const dark = (r, c) => r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c);
  const lines = [];
  for (let r = -2; r < n + 2; r += 2) {
    let line = '  ';
    for (let c = -2; c < n + 2; c++) {
      const top = dark(r, c), bottom = dark(r + 1, c);
      // Terminal sombre : on dessine les modules clairs.
      line += !top && !bottom ? '█' : !top && bottom ? '▀' : top && !bottom ? '▄' : ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

export function qrSvg(text) {
  const qr = make(text);
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
