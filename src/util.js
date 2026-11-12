export const PAL = { Green: '#22C55E', Blue: '#3D7BFF', Yellow: '#FFD60A', Orange: '#FF7A1A', Red: '#FF3B30' };
export const COLORS = Object.keys(PAL);
export const RADII = [['1 block', 100], ['0.1 mi', 160], ['0.25 mi', 400]];
export const DURS = [['2 min', 2], ['10 min', 10], ['30 min', 30], ['1 hr', 60]];
export const FEE = 0.05;
// Downtown Wilmington, NC (Front St & Market St)
export const HOME_CENTER = { lat: 34.23573, lng: -77.94782 };

export const MARK = '<ellipse cx="54" cy="26" rx="46" ry="15"/><path d="M78 14 L90 2 L101 2 L99 24 Z"/><path d="M78 38 L90 50 L101 50 L99 28 Z"/><rect x="42" y="38" width="20" height="10" rx="3"/>';
export const mark = (w, fill, label) => '<svg width="' + w + '" height="' + Math.round(w * 0.52) + '" viewBox="4 0 100 52" ' + (label ? 'role="img" aria-label="' + label + '"' : 'aria-hidden="true"') + '><g fill="' + fill + '">' + MARK + '</g></svg>';

const svg = (w, body) => '<svg width="' + w + '" height="' + w + '" viewBox="0 0 24 24" aria-hidden="true">' + body + '</svg>';
export const I = {
  arrow: svg(20, '<path d="M5 12 H19 M13 6 L19 12 L13 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  plus: svg(20, '<path d="M12 5 V19 M5 12 H19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
  back: svg(18, '<path d="M15 5 L8 12 L15 19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  close: svg(16, '<path d="M6 6 L18 18 M18 6 L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
  check: svg(22, '<path d="M5 12.5 L10 17.5 L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  smallcheck: svg(16, '<path d="M5 12.5 L10 17.5 L19 7" fill="none" stroke="#111111" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  map: svg(22, '<path d="M3 6 L9 4 L15 6 L21 4 V18 L15 20 L9 18 L3 20 Z M9 4 V18 M15 6 V20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'),
  user: svg(22, '<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 20 C4 15.5 8 14 12 14 C16 14 20 15.5 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  pin: svg(18, '<path d="M12 21 C12 21 5 13.5 5 9 A7 7 0 0 1 19 9 C19 13.5 12 21 12 21 Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="12" cy="9" r="2.4" fill="currentColor"/>'),
  bell: svg(18, '<path d="M6 16 V11 A6 6 0 0 1 18 11 V16 L19.5 17.5 H4.5 Z M10 20.5 H14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  locate: svg(20, '<circle cx="12" cy="12" r="6" fill="none" stroke="#3D7BFF" stroke-width="2.4"/><circle cx="12" cy="12" r="2.2" fill="#3D7BFF"/><path d="M12 1.5 V5 M12 19 V22.5 M1.5 12 H5 M19 12 H22.5" stroke="#111111" stroke-width="2" stroke-linecap="round"/>')
};

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const r2 = n => Math.round(n * 100) / 100;
export const money = n => (n < 0 ? '−' : '') + '$' + Math.abs(r2(n)).toFixed(2);
export const cash = n => { n = r2(n); return Number.isInteger(n) ? '$' + n : '$' + n.toFixed(2); };
export const now = () => Date.now();
export function clock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0');
}
export function ago(t) {
  const s = Math.max(0, Math.round((now() - t) / 1000));
  if (s < 5) return 'just now'; if (s < 60) return s + 's ago';
  const m = Math.round(s / 60); if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60); return h < 24 ? h + ' hr ago' : Math.round(h / 24) + 'd ago';
}
export function distM(a, b) {
  const R = 6371000, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function miles(m) { const ft = m * 3.281; return ft < 1000 ? Math.max(10, Math.round(ft / 10) * 10) + ' ft' : (m / 1609.34).toFixed(1) + ' mi'; }
export const digits = s => String(s || '').replace(/\D/g, '').slice(0, 10);
export function fmtPhone(s) { const d = digits(s); if (d.length < 4) return d; if (d.length < 7) return '(' + d.slice(0, 3) + ') ' + d.slice(3); return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6); }
export const cleanHandle = s => String(s || '').trim().replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 20);
export function hash(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); }
export function store(k, v) {
  try {
    if (v === undefined) return JSON.parse(localStorage.getItem('blimp:' + k));
    localStorage.setItem('blimp:' + k, JSON.stringify(v));
  } catch (e) { return null; }
}
export function circlePolygon(lat, lng, radiusM, steps = 64) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const dLat = (radiusM * Math.cos(a)) / 111320;
    const dLng = (radiusM * Math.sin(a)) / (111320 * Math.cos(lat * Math.PI / 180));
    pts.push([lng + dLng, lat + dLat]);
  }
  return pts;
}
export function buzz() { try { navigator.vibrate && navigator.vibrate(25); } catch (e) { } }
