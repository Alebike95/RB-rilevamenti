export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const p2 = (n) => String(n).padStart(2, '0');
export const fmtTime = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
export const fmtDate = (ms) => { const d = new Date(ms); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`; };
export const fmtStamp = (ms) => { const d = new Date(ms); return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`; };
export const fmtKm = (m) => (m == null || isNaN(m) ? '' : (m / 1000).toFixed(2));

// gradi decimali -> gradi e minuti decimali (es. N 43° 46.1234')
export function toDMM(v, isLat) {
  if (v == null) return '';
  const h = isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
  const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
  return `${h} ${d}° ${m.toFixed(4)}'`;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function pointIcon(p) {
  if (p.status === 'pending') return 'box:pending';
  // distributore: in mappa il logo della marca; altri: il primo dettaglio (tipo autovelox, tipo pericolo…)
  const ds = (p.details || []).filter((x) => x.icon);
  const d = p.category?.flow === 'fuel' ? ds[ds.length - 1] : ds[0];
  return d?.icon || p.category?.icon || 'box:default';
}

export function pointType(p) {
  if (p.status === 'pending') return 'Da classificare';
  if (!p.isBox) return 'Info';
  return p.group === 'sport' ? 'Box – sportiva' : 'Box';
}

export function pointLabel(p) {
  if (p.status === 'pending') return 'Da classificare';
  const parts = [p.category?.label, ...(p.details || []).map((d) => d.label)].filter(Boolean);
  return parts.join(' · ');
}

export function toast(msg, ms = 2200) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function vibrate(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* */ } }

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// Ridimensiona e comprime una foto (JPEG). Restituisce { blob, thumb, w, h }
export async function compressImage(file, maxSide = 1920, quality = 0.75) {
  const bmp = await loadBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
  const ts = Math.min(1, 240 / Math.max(w, h));
  const t = document.createElement('canvas'); t.width = Math.round(w * ts); t.height = Math.round(h * ts);
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  const thumb = await new Promise((r) => t.toBlob(r, 'image/jpeg', 0.7));
  bmp.close && bmp.close();
  return { blob, thumb, w, h };
}

async function loadBitmap(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fallback */ }
  }
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}
