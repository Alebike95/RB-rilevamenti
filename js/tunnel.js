// Correzione distanze quando il GPS si perde (gallerie).
// Il trip ha gia' contato la linea dritta tra perdita e ripresa del segnale.
// Qui si cerca la lunghezza vera della strada:
//   1) lungo la traccia di riferimento (funziona anche senza rete)
//   2) altrimenti con il percorso stradale OSRM (OpenStreetMap), se c'e' rete
// e si aggiunge la differenza ai trip, solo se il risultato e' credibile.
import { app } from './app.js';
import { db } from './db.js';
import { toast } from './util.js';

const NEAR = 40;          // m: distanza massima dalla traccia di riferimento
// rapporto massimo strada / linea dritta: con la traccia (affidabile) si accettano anche tornanti
// e gallerie elicoidali; con OSRM (puo' sbagliare strada) si resta prudenti
const MAX_RATIO = { traccia: 3.5, OSRM: 1.6 };
const MAX_KMH = 220;      // velocita' media massima credibile nel tratto senza segnale
const rad = Math.PI / 180;

export async function initTunnel() {
  app.corrections = (await db.get('kv', 'corrections')) || [];
  app.gps.addEventListener('gap', (e) => onGap(e.detail).catch((err) => console.warn('galleria', err)));
}

async function onGap({ a, b, d, dt }) {
  if (app.prefs.tunnelFix === false) return;
  let along = null, method = null;
  if (app.refTrack) { along = alongRef(app.refTrack, a, b, d); if (along != null) method = 'traccia'; }
  if (along == null && navigator.onLine !== false) { along = await osrmDistance(a, b); if (along != null) method = 'OSRM'; }
  if (along == null) return;
  const ok = along >= d * 0.98 && along <= d * MAX_RATIO[method] && (along / 1000) / (dt / 3600000) <= MAX_KMH;
  if (!ok) return;
  const delta = along - d;
  if (delta < 1) return; // differenza trascurabile
  const added = app.gps.addCorrection(delta);
  const c = { t: b.ts, tLost: a.ts, latA: a.lat, lonA: a.lon, latB: b.lat, lonB: b.lon, straight: Math.round(d), road: Math.round(along), delta: Math.round(added * 10) / 10, method };
  app.corrections.push(c);
  await db.put('kv', app.corrections, 'corrections');
  toast(`🚇 Segnale perso ${Math.round(dt / 1000)} s: +${Math.round(added)} m (${method})`, 3500);
}

// ---------- 1) lungo la traccia di riferimento ----------
function lines(gj) {
  const out = [];
  for (const f of gj.features || []) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'LineString') out.push(g.coordinates);
    else if (g.type === 'MultiLineString') out.push(...g.coordinates);
    else if (g.type === 'GeometryCollection') for (const x of g.geometries || []) if (x.type === 'LineString') out.push(x.coordinates);
  }
  return out;
}

// proiezioni di un punto su una linea: per ogni tratto vicino, posizione progressiva (m) e distanza
function projections(coords, cum, p, k) {
  const res = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = (coords[i][0] - p.lon) * k, ay = (coords[i][1] - p.lat) * 111320;
    const bx = (coords[i + 1][0] - p.lon) * k, by = (coords[i + 1][1] - p.lat) * 111320;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let f = l2 > 0 ? -(ax * dx + ay * dy) / l2 : 0;
    f = Math.max(0, Math.min(1, f));
    const dist = Math.hypot(ax + f * dx, ay + f * dy);
    if (dist <= NEAR) res.push({ s: cum[i] + f * (cum[i + 1] - cum[i]), dist });
  }
  return res;
}

export function alongRef(gj, a, b, straight) {
  const k = Math.cos(a.lat * rad) * 111320;
  let best = null; // { s, score }
  for (const coords of lines(gj)) {
    if (coords.length < 2) continue;
    const cum = [0];
    for (let i = 1; i < coords.length; i++) {
      cum.push(cum[i - 1] + Math.hypot((coords[i][0] - coords[i - 1][0]) * k, (coords[i][1] - coords[i - 1][1]) * 111320));
    }
    const pa = projections(coords, cum, a, k), pb = projections(coords, cum, b, k);
    // si prende la coppia di proiezioni piu' vicine alla traccia (con i tornanti vicini evita di
    // agganciare il tornante sbagliato); a parita' (traccia che ripassa dallo stesso posto)
    // vince il tratto piu' corto
    for (const x of pa) for (const y of pb) {
      const s = Math.abs(y.s - x.s);
      if (s < straight * 0.98) continue;
      const score = x.dist + y.dist;
      if (!best || score < best.score - 5 || (Math.abs(score - best.score) <= 5 && s < best.s)) best = { s, score };
    }
  }
  return best ? best.s : null;
}

// ---------- 2) percorso stradale OSRM ----------
async function osrmDistance(a, b) {
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lon.toFixed(6)},${a.lat.toFixed(6)};${b.lon.toFixed(6)},${b.lat.toFixed(6)}?overview=false&alternatives=false`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return j.code === 'Ok' && j.routes?.[0] ? j.routes[0].distance : null;
  } catch (e) {
    return null;
  } finally { clearTimeout(timer); }
}
