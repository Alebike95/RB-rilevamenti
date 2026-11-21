// Telemetria: rivedere il percorso fatto (stile RaceChrono).
// Usa la registrazione in sottofondo (app.track). Viene caricato solo quando si apre.
//  - mappa: percorso colorato per velocita', tratti senza segnale tratteggiati, cursore
//  - grafico generale della giornata + grafico di dettaglio (finestra zoomabile)
//  - info nel punto: ora, velocita', Trip A/B, quota, direzione, precisione
//  - riproduzione x1..x60, passi di 1 s / 10 s, tasti freccia
//  - misura A→B: tempo, distanza, media
//  - "＋ Punto qui": crea un punto a posteriori con ora/posizione/trip di quel momento
//  - CSV della giornata
/* global L */
import { app, appMap, setFollow, capturePast } from './app.js';
import { haversine } from './gps.js';
import { $, fmtTime, fmtDate, toast, download } from './util.js';

const WIN_MIN = 10; // finestra minima del dettaglio (s); la massima e' la giornata intera
const RATES = [1, 4, 10, 30, 60];
// colori ben diversi dall'azzurro della traccia di riferimento
const SPEED_COL = [[30, '#b36bff'], [50, '#4caf50'], [70, '#ffee58'], [90, '#ff9800'], [130, '#f44336'], [Infinity, '#ffffff']];
const colorFor = (v) => SPEED_COL.find((c) => (v ?? 0) < c[0])[1];
const GAP_S = 15, GAP_M = 50; // tratto senza segnale

let st = null;   // stato
let ui = null;   // elementi

export function toggleTelemetry() { if (app.teleOpen) closeTele(); else openTele(); }

// ======================= APERTURA / CHIUSURA =======================
function openTele() {
  const all = app.track;
  if (!all.length) { toast('Nessun dato registrato ancora: la telemetria si riempie mentre ti muovi.', 3500); return; }
  const days = [];
  for (const p of all) { const k = fmtDate(p.t); if (days[days.length - 1] !== k) { if (!days.includes(k)) days.push(k); } }
  buildUI(days);
  st = { days, day: null, s: [], cd: [], cur: 0, win: 600, winStart: 0, playing: false, rate: 4, A: null, B: null, follow: app.prefs.teleFollow !== false, layer: L.layerGroup().addTo(appMap()) };
  app.teleOpen = true;
  document.body.classList.add('tele-open');
  setFollow(false);
  app.onSelectTime = (t) => jumpTo(t);
  app.teleKey = onKey;
  appMap().on('click', onMapClick);
  appMap().on('dragstart', onMapDrag);
  loadDay(days[days.length - 1]);
  new ResizeObserver(() => { setTeleH(); draw(); }).observe(ui.root);
}

function closeTele() {
  st.playing = false;
  st.layer.remove();
  appMap().off('click', onMapClick);
  appMap().off('dragstart', onMapDrag);
  ui.root.remove();
  ui = null; st = null;
  app.teleOpen = false; app.onSelectTime = null; app.teleKey = null;
  document.body.classList.remove('tele-open');
}

function setTeleH() { if (ui) document.documentElement.style.setProperty('--teleh', ui.root.offsetHeight + 'px'); }

// ======================= INTERFACCIA =======================
function buildUI(days) {
  const root = document.createElement('div');
  root.className = 'tele';
  root.innerHTML = `
    <div class="tele-head">
      <b>📈 Telemetria</b>
      <select id="tlDay">${days.map((d) => `<option>${d}</option>`).join('')}</select>
      <span class="tele-legend">${SPEED_COL.map((c, i) => `<span><i style="background:${c[1]}"></i>${i ? SPEED_COL[i - 1][0] : 0}${c[0] === Infinity ? '+' : ''}</span>`).join('')} km/h</span>
      <div class="spacer"></div>
      <button id="tlFol" class="ab on" title="Tieni il cursore al centro della mappa">◎ Segui</button>
      <button id="tlCsv" title="Scarica i dati della giornata">CSV</button>
      <button id="tlX">✕</button>
    </div>
    <div class="tele-info">
      <div class="big"><small>Ora</small><b id="tiT">--:--:--</b></div>
      <div class="big"><small>km/h</small><b id="tiV">–</b></div>
      <div><small>Trip A</small><b id="tiA">–</b></div>
      <div><small>Trip B</small><b id="tiB">–</b></div>
      <div><small>Quota · Dir.</small><b id="tiQ">–</b></div>
      <div><small>Progressiva giorno</small><b id="tiD">–</b></div>
    </div>
    <canvas id="tlOv" height="34"></canvas>
    <canvas id="tlDet" height="120"></canvas>
    <div class="tele-ctrl">
      <button id="tlB10" title="-10 s (Maiusc+←)">⏪</button>
      <button id="tlB1" title="-1 s (←)">◀</button>
      <button id="tlPlay" class="play" title="Riproduci (Spazio)">▶</button>
      <button id="tlF1" title="+1 s (→)">▶︎|</button>
      <button id="tlF10" title="+10 s (Maiusc+→)">⏩</button>
      <select id="tlRate" title="Velocità riproduzione">${RATES.map((r) => `<option value="${r}" ${r === 4 ? 'selected' : ''}>×${r}</option>`).join('')}</select>
      <button id="tlZo" title="Allarga finestra">－</button><span id="tlWin" class="small muted"></span><button id="tlZi" title="Stringi finestra">＋</button>
      <button id="tlA" class="ab" title="Segna inizio misura">A</button><button id="tlBm" class="ab" title="Segna fine misura">B</button>
      <span id="tlMeas" class="tele-meas"></span>
      <div class="spacer"></div>
      <button id="tlAdd" class="btn-main" title="Crea un punto a quest'ora">＋ Punto qui</button>
    </div>`;
  $('#mapWrap').appendChild(root);
  ui = { root, ov: root.querySelector('#tlOv'), det: root.querySelector('#tlDet') };
  const q = (id) => root.querySelector(id);
  q('#tlX').onclick = closeTele;
  q('#tlFol').onclick = () => { st.follow = !st.follow; app.prefs.teleFollow = st.follow; localStorage.setItem('rb.prefs', JSON.stringify(app.prefs)); render(); };
  q('#tlDay').onchange = (e) => loadDay(e.target.value);
  q('#tlCsv').onclick = exportCsv;
  q('#tlB10').onclick = () => step(-10); q('#tlB1').onclick = () => step(-1);
  q('#tlF1').onclick = () => step(1); q('#tlF10').onclick = () => step(10);
  q('#tlPlay').onclick = togglePlay;
  q('#tlRate').onchange = (e) => { st.rate = +e.target.value; };
  q('#tlZo').onclick = () => zoom(1); q('#tlZi').onclick = () => zoom(-1);
  q('#tlA').onclick = () => { st.A = st.A === st.cur ? null : st.cur; draw(); };
  q('#tlBm').onclick = () => { st.B = st.B === st.cur ? null : st.cur; draw(); };
  q('#tlAdd').onclick = addPointHere;
  bindOverview(); bindDetail();
  setTeleH();
}

// ======================= DATI DELLA GIORNATA =======================
function loadDay(key) {
  st.day = key;
  ui.root.querySelector('#tlDay').value = key;
  st.s = app.track.filter((p) => fmtDate(p.t) === key).sort((a, b) => a.t - b.t);
  const s = st.s;
  st.cd = new Float64Array(s.length);
  st.gap = new Uint8Array(s.length); // 1 = tratto prima di questo punto senza segnale
  for (let i = 1; i < s.length; i++) {
    const d = haversine(s[i - 1], s[i]);
    st.cd[i] = st.cd[i - 1] + d;
    if ((s[i].t - s[i - 1].t) / 1000 > GAP_S && d > GAP_M) st.gap[i] = 1;
  }
  st.vmax = Math.max(60, ...s.map((p) => p.spd || 0));
  st.A = st.B = null;
  drawMapTrack();
  // si parte dal primo movimento (non dai minuti da fermo prima di partire)
  st.cur = (s.find((p) => (p.spd || 0) > 5) || s[0]).t;
  st.win = Math.min(600, winMax());
  const b = st.layer.getLayers().length ? L.featureGroup(st.layer.getLayers()).getBounds() : null;
  if (b && b.isValid()) appMap().fitBounds(b, { paddingTopLeft: [20, 20], paddingBottomRight: [20, ui.root.offsetHeight + 20] });
  render();
}

function drawMapTrack() {
  st.layer.clearLayers();
  const s = st.s;
  if (!s.length) return;
  // livello proprio sopra la traccia di riferimento
  const map = appMap();
  if (!map.getPane('telePane')) { map.createPane('telePane'); map.getPane('telePane').style.zIndex = 450; }
  const renderer = L.canvas({ padding: 0.5, pane: 'telePane' });
  // tratti dello stesso colore uniti in una sola linea (poche linee anche con decine di migliaia di punti)
  let cur = [[s[0].lat, s[0].lon]], col = colorFor(s[0].spd);
  const flush = () => { if (cur.length > 1) L.polyline(cur, { color: col, weight: 6, opacity: 1, renderer, interactive: false }).addTo(st.layer); };
  for (let i = 1; i < s.length; i++) {
    const ll = [s[i].lat, s[i].lon];
    if (st.gap[i]) {
      flush();
      L.polyline([[s[i - 1].lat, s[i - 1].lon], ll], { color: '#bbb', weight: 3, dashArray: '6 6', renderer, interactive: false }).addTo(st.layer);
      cur = [ll]; col = colorFor(s[i].spd); continue;
    }
    const c = colorFor(((s[i].spd || 0) + (s[i - 1].spd || 0)) / 2);
    if (c !== col) { cur.push(ll); flush(); cur = [ll]; col = c; } else cur.push(ll);
  }
  flush();
  st.marker = L.marker([s[0].lat, s[0].lon], { icon: curIcon(0), zIndexOffset: 2000, interactive: false }).addTo(st.layer);
  st.markA = st.markB = null;
}

function curIcon(hd) {
  return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
    html: `<svg class="tele-cur" viewBox="0 0 30 30" style="transform:rotate(${hd || 0}deg)"><circle cx="15" cy="15" r="10" fill="#ffb300" stroke="#000" stroke-width="2.5"/><path d="M15 1 L21 11 H9 Z" fill="#000"/></svg>` });
}

// valori interpolati all'istante t
function sampleAt(t) {
  const s = st.s;
  if (!s.length) return null;
  if (t <= s[0].t) return { ...s[0], i: 0, cd: 0 };
  if (t >= s[s.length - 1].t) return { ...s[s.length - 1], i: s.length - 1, cd: st.cd[s.length - 1] };
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m].t <= t) lo = m; else hi = m; }
  const a = s[lo], b = s[hi];
  const f = (t - a.t) / (b.t - a.t || 1);
  const L2 = (x, y) => (x == null || y == null ? (x ?? y) : x + (y - x) * f);
  const gap = st.gap[hi];
  return {
    t, i: lo, gap,
    lat: L2(a.lat, b.lat), lon: L2(a.lon, b.lon),
    spd: gap ? null : L2(a.spd, b.spd), alt: L2(a.alt, b.alt),
    odo: L2(a.odo, b.odo), odoB: L2(a.odoB, b.odoB), hd: a.hd ?? b.hd,
    acc: a.acc, cd: st.cd[lo] + (st.cd[hi] - st.cd[lo]) * f
  };
}

// ======================= DISEGNO =======================
function render() {
  if (!st) return;
  const s = st.s, t0 = s[0].t, t1 = s[s.length - 1].t;
  st.cur = Math.max(t0, Math.min(t1, st.cur));
  st.win = Math.max(WIN_MIN, Math.min(st.win, winMax()));
  // il cursore sta fermo al centro: e' il grafico che scorre
  st.winStart = st.cur - st.win * 500;
  const p = sampleAt(st.cur);
  const q = (id) => ui.root.querySelector(id);
  q('#tiT').textContent = fmtTime(st.cur);
  q('#tiV').textContent = p.spd != null ? Math.round(p.spd) : (p.gap ? 'no GPS' : '–');
  q('#tiA').textContent = p.odo != null ? (p.odo / 1000).toFixed(3) : '–';
  q('#tiB').textContent = p.odoB != null ? (p.odoB / 1000).toFixed(3) : '–';
  q('#tiQ').textContent = `${p.alt != null ? Math.round(p.alt) + ' m' : '–'} · ${p.hd != null ? Math.round(p.hd) + '°' : '–'}`;
  q('#tiD').textContent = (p.cd / 1000).toFixed(3);
  q('#tlWin').textContent = st.win >= 5400 ? (st.win / 3600).toFixed(1) + ' h' : st.win >= 90 ? Math.round(st.win / 60) + ' min' : Math.round(st.win) + ' s';
  q('#tlPlay').textContent = st.playing ? '⏸' : '▶';
  q('#tlA').classList.toggle('on', st.A != null); q('#tlBm').classList.toggle('on', st.B != null);
  // misura A→B
  if (st.A != null && st.B != null) {
    const a = sampleAt(Math.min(st.A, st.B)), b = sampleAt(Math.max(st.A, st.B));
    const dt = (b.t - a.t) / 1000, dd = b.cd - a.cd;
    q('#tlMeas').textContent = `A→B ${hms(dt)} · ${(dd / 1000).toFixed(3)} km · media ${dt > 0 ? (dd / dt * 3.6).toFixed(1) : '–'} km/h`;
  } else q('#tlMeas').textContent = st.A != null ? `A ${fmtTime(st.A)} – segna B` : st.B != null ? `B ${fmtTime(st.B)} – segna A` : '';
  // mappa
  st.marker.setLatLng([p.lat, p.lon]); st.marker.setIcon(curIcon(p.hd));
  const map = appMap();
  // "Segui": mappa sempre centrata sul cursore; altrimenti si sposta solo se il cursore esce dallo schermo
  // centro della parte di mappa VISIBILE (sopra il pannello della telemetria, che copre il fondo)
  const size = map.getSize(), visH = Math.max(80, size.y - ui.root.offsetHeight);
  const pt = map.latLngToContainerPoint([p.lat, p.lon]);
  const out = pt.x < size.x * 0.1 || pt.x > size.x * 0.9 || pt.y < visH * 0.1 || pt.y > visH * 0.9;
  if (st.follow || out) map.panBy([pt.x - size.x / 2, pt.y - visH / 2], { animate: false });
  q('#tlFol').classList.toggle('on', st.follow);
  for (const k of ['A', 'B']) {
    const key = 'mark' + k;
    if (st[k] == null) { if (st[key]) { st[key].remove(); st[key] = null; } continue; }
    const m = sampleAt(st[k]);
    if (!st[key]) st[key] = L.circleMarker([m.lat, m.lon], { radius: 7, color: '#1e88e5', weight: 3, fillColor: '#fff', fillOpacity: 1, interactive: false }).bindTooltip(k, { permanent: true, direction: 'top' }).addTo(st.layer);
    else st[key].setLatLng([m.lat, m.lon]);
  }
  draw();
}

function prepCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

// eventi del giorno da mostrare sui grafici
function marks(t0, t1) {
  const inR = (t) => t >= t0 && t <= t1;
  return {
    pts: app.points.filter((p) => inR(p.t)),
    trs: (app.transits || []).filter((t) => inR(t.t)),
    evs: (app.events || []).filter((e) => (e.tEnd || e.tStart) >= t0 && e.tStart <= t1),
    vos: (app.voices || []).filter((v) => inR(v.t))
  };
}

function draw() {
  if (!st || !ui) return;
  drawOverview(); drawDetail();
}

function drawOverview() {
  const s = st.s, t0 = s[0].t, t1 = s[s.length - 1].t;
  const { g, w, h } = prepCanvas(ui.ov);
  const X = (t) => ((t - t0) / (t1 - t0 || 1)) * w;
  const Y = (v) => h - 2 - (Math.min(v || 0, st.vmax) / st.vmax) * (h - 4);
  // velocita': massimo per pixel (veloce anche con molti punti)
  const col = new Float32Array(Math.ceil(w) + 1).fill(-1);
  for (let i = 0; i < s.length; i++) { const x = X(s[i].t) | 0; if ((s[i].spd || 0) > col[x]) col[x] = s[i].spd || 0; }
  g.fillStyle = '#ffb30055';
  g.strokeStyle = '#ffb300'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, h);
  for (let x = 0; x < col.length; x++) if (col[x] >= 0) g.lineTo(x, Y(col[x]));
  g.lineTo(w, h); g.closePath(); g.fill();
  const m = marks(t0, t1);
  g.fillStyle = '#f9a82566';
  for (const e of m.evs) if (e.dur) g.fillRect(X(e.tStart), 0, Math.max(2, X(e.tEnd || Date.now()) - X(e.tStart)), h);
  for (const p of m.pts) { g.fillStyle = p.status === 'pending' ? '#9e9e9e' : '#e53935'; g.fillRect(X(p.t) - 1, 0, 2, 7); }
  for (const t of m.trs) { g.fillStyle = '#43a047'; g.fillRect(X(t.t) - 1, h - 7, 2, 7); }
  for (const v of m.vos) { g.fillStyle = '#ce93d8'; g.fillRect(X(v.t) - 1, 0, 2, h); }
  // finestra del dettaglio
  g.strokeStyle = '#fff'; g.lineWidth = 1.5;
  g.strokeRect(X(st.winStart), 1, Math.max(3, X(st.winStart + st.win * 1000) - X(st.winStart)), h - 2);
  g.fillStyle = '#fff'; g.fillRect(X(st.cur) - 1, 0, 2, h);
}

function drawDetail() {
  const s = st.s, t0 = st.winStart, t1 = st.winStart + st.win * 1000;
  const { g, w, h } = prepCanvas(ui.det);
  const padT = 16, padB = 14;
  const X = (t) => ((t - t0) / (t1 - t0)) * w;
  // scala velocita' sulla finestra
  let vm = 20;
  for (const p of s) if (p.t >= t0 && p.t <= t1 && (p.spd || 0) > vm) vm = p.spd;
  vm = Math.ceil(vm / 20) * 20;
  const Y = (v) => h - padB - ((v || 0) / vm) * (h - padT - padB);
  // griglia
  g.font = '10px system-ui, sans-serif'; g.fillStyle = '#777'; g.strokeStyle = '#333'; g.lineWidth = 1;
  for (let v = 0; v <= vm; v += vm > 100 ? 40 : 20) { g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(w, Y(v)); g.stroke(); g.fillText(String(v), 2, Y(v) - 2); }
  // tacche orarie
  const span = (t1 - t0) / 1000;
  const stepS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200].find((x) => span / x <= 7) || 7200;
  for (let tt = Math.ceil(t0 / 1000 / stepS) * stepS * 1000; tt <= t1; tt += stepS * 1000) {
    const x = X(tt); g.strokeStyle = '#2a2a2a'; g.beginPath(); g.moveTo(x, padT); g.lineTo(x, h - padB); g.stroke();
    g.fillStyle = '#888'; g.fillText(fmtTime(tt).slice(0, stepS < 60 ? 8 : 5), x + 2, h - 3);
  }
  const m = marks(t0, t1);
  // segnalazioni con durata
  for (const e of m.evs) {
    const x0 = X(e.tStart), x1 = e.dur ? X(e.tEnd || Date.now()) : x0 + 2;
    g.fillStyle = '#f9a82540'; g.fillRect(x0, padT, Math.max(2, x1 - x0), h - padT - padB);
    g.fillStyle = '#f9a825'; g.fillText(e.label, x0 + 2, padT + 10);
  }
  // misura A-B
  if (st.A != null && st.B != null) { g.fillStyle = '#1e88e533'; g.fillRect(X(Math.min(st.A, st.B)), padT, Math.abs(X(st.B) - X(st.A)), h - padT - padB); }
  for (const k of ['A', 'B']) if (st[k] != null) { const x = X(st[k]); g.fillStyle = '#1e88e5'; g.fillRect(x - 1, padT, 2, h - padT - padB); g.fillText(k, x + 3, padT + 22); }
  // velocita' (linea colorata, interrotta dove manca il segnale)
  g.lineWidth = 2;
  let prev = null;
  for (let i = 0; i < s.length; i++) {
    const p = s[i];
    if (p.t < t0 - 60000) continue;
    if (p.t > t1 + 60000) break;
    if (prev && !st.gap[i]) {
      g.strokeStyle = colorFor(p.spd);
      g.beginPath(); g.moveTo(X(prev.t), Y(prev.spd)); g.lineTo(X(p.t), Y(p.spd)); g.stroke();
    } else if (prev && st.gap[i]) {
      g.fillStyle = '#ffffff14'; g.fillRect(X(prev.t), padT, X(p.t) - X(prev.t), h - padT - padB);
      g.fillStyle = '#aaa'; g.fillText('senza GPS', X(prev.t) + 3, h - padB - 4);
    }
    prev = p;
  }
  // punti e passaggi
  for (const p of m.pts) {
    const x = X(p.t); g.fillStyle = p.status === 'pending' ? '#9e9e9e' : '#e53935';
    g.fillRect(x - 1, 0, 2, h - padB); g.fillText(String(p.n), x + 3, 10);
  }
  for (const t of m.trs) {
    const x = X(t.t); g.fillStyle = '#43a047'; g.fillRect(x - 1, padT, 2, h - padT - padB);
    g.save(); g.translate(x + 3, h - padB - 4); g.rotate(-Math.PI / 2); g.fillText(t.name.slice(0, 18), 0, 0); g.restore();
  }
  // note vocali (banda viola lunga quanto la nota)
  for (const v of m.vos) { const x0 = X(v.t); g.fillStyle = '#ce93d855'; g.fillRect(x0, padT, Math.max(2, X(v.t + v.dur) - x0), h - padT - padB); g.fillStyle = '#ce93d8'; g.fillText('🎙', x0 + 2, padT + 22); }
  // cursore
  const cx = X(st.cur), cp = sampleAt(st.cur);
  g.fillStyle = '#fff'; g.fillRect(cx - 1, 0, 2, h);
  if (cp.spd != null) { g.beginPath(); g.arc(cx, Y(cp.spd), 4, 0, 7); g.fill(); }
}

// ======================= INTERAZIONI =======================
function bindOverview() {
  const c = ui.ov;
  const go = (e) => {
    const r = c.getBoundingClientRect(), s = st.s;
    const t = s[0].t + ((e.clientX - r.left) / r.width) * (s[s.length - 1].t - s[0].t);
    st.playing = false; st.cur = t; scheduleRender();
  };
  c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); go(e); c.onpointermove = go; });
  c.addEventListener('pointerup', () => { c.onpointermove = null; });
}

// Dettaglio: cursore fisso al centro.
//  1 dito / mouse: trascina per scorrere il tempo (con inerzia), tocco = va a quell'ora
//  2 dita: pizzico = cambia la scala (e intanto si puo' scorrere)
//  rotella: scala; Maiusc+rotella o rotella orizzontale: scorre
function bindDetail() {
  const c = ui.det;
  const ptr = new Map();
  let g0 = null, moved = false, vel = 0, lastX = 0, lastT = 0;
  const msPerPx = () => (st.win * 1000) / c.clientWidth;
  const begin = () => {
    const v = [...ptr.values()];
    if (v.length === 1) g0 = { mode: 1, x: v[0].x, cur: st.cur };
    else if (v.length >= 2) g0 = { mode: 2, d: Math.abs(v[0].x - v[1].x) || 1, mid: (v[0].x + v[1].x) / 2, win: st.win, cur: st.cur };
  };
  c.addEventListener('pointerdown', (e) => {
    c.setPointerCapture(e.pointerId);
    ptr.set(e.pointerId, { x: e.clientX });
    st.playing = false; st.fling = false; moved = false; vel = 0; lastX = e.clientX; lastT = performance.now();
    begin();
  });
  c.addEventListener('pointermove', (e) => {
    if (!ptr.has(e.pointerId) || !g0) return;
    ptr.set(e.pointerId, { x: e.clientX });
    const v = [...ptr.values()];
    if (g0.mode === 1 && v.length === 1) {
      const dx = v[0].x - g0.x;
      if (Math.abs(dx) > 4) moved = true;
      if (!moved) return;
      st.cur = g0.cur - dx * msPerPx();
      const now = performance.now(), dt = now - lastT;
      if (dt > 0) vel = 0.8 * vel + 0.2 * ((e.clientX - lastX) / dt); // px/ms
      lastX = e.clientX; lastT = now;
    } else if (g0.mode === 2 && v.length >= 2) {
      moved = true;
      const d = Math.abs(v[0].x - v[1].x) || 1, mid = (v[0].x + v[1].x) / 2;
      st.win = Math.max(WIN_MIN, Math.min(winMax(), g0.win * (g0.d / d)));
      st.cur = g0.cur - (mid - g0.mid) * msPerPx();
    }
    clampCur(); scheduleRender();
  });
  const end = (e) => {
    const wasTap = !moved && g0?.mode === 1 && ptr.size === 1;
    ptr.delete(e.pointerId);
    if (wasTap) {
      const r = c.getBoundingClientRect();
      st.cur += (e.clientX - r.left - r.width / 2) * msPerPx();
      clampCur(); scheduleRender();
    } else if (g0?.mode === 1 && ptr.size === 0 && Math.abs(vel) > 0.3 && performance.now() - lastT < 80) {
      fling(vel);
    }
    if (ptr.size) begin(); else g0 = null;
  };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { st.cur += (e.deltaX || e.deltaY) * msPerPx(); clampCur(); }
    else st.win = Math.max(WIN_MIN, Math.min(winMax(), st.win * (e.deltaY > 0 ? 1.15 : 1 / 1.15)));
    scheduleRender();
  }, { passive: false });
}

// inerzia dopo una "spinta" col dito
function fling(v0) {
  st.fling = true;
  let v = v0, last = performance.now();
  const loop = (now) => {
    if (!st || !st.fling) return;
    const dt = now - last; last = now;
    st.cur -= v * dt * (st.win * 1000) / ui.det.clientWidth;
    v *= Math.pow(0.995, dt);
    clampCur(); render();
    if (Math.abs(v) > 0.02) requestAnimationFrame(loop); else st.fling = false;
  };
  requestAnimationFrame(loop);
}

function winMax() { const s = st.s; return Math.max(60, ((s[s.length - 1].t - s[0].t) / 1000) * 1.1); }
function clampCur() { const s = st.s; st.cur = Math.max(s[0].t, Math.min(s[s.length - 1].t, st.cur)); }

let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; render(); });
}

function zoom(dir) {
  st.win = Math.max(WIN_MIN, Math.min(winMax(), st.win * (dir > 0 ? 2 : 0.5)));
  scheduleRender();
}

function step(sec) { st.playing = false; st.cur += sec * 1000; render(); }

function togglePlay() {
  st.playing = !st.playing;
  if (st.playing) {
    if (st.cur >= st.s[st.s.length - 1].t) st.cur = st.s[0].t;
    let last = performance.now();
    const loop = (now) => {
      if (!st || !st.playing) return;
      st.cur += (now - last) * st.rate; last = now;
      if (st.cur >= st.s[st.s.length - 1].t) st.playing = false;
      render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  render();
}

function jumpTo(t) {
  const k = fmtDate(t);
  if (st.day !== k && st.days.includes(k)) loadDay(k);
  if (st.day !== k) return;
  st.playing = false; st.cur = t; render();
}

function onMapClick(e) {
  // tocco vicino al percorso: il cursore va li'
  const map = appMap(), s = st.s;
  const pt = map.latLngToContainerPoint(e.latlng);
  let best = -1, bd = 30 * 30;
  const stepI = Math.max(1, Math.floor(s.length / 20000));
  for (let i = 0; i < s.length; i += stepI) {
    const q = map.latLngToContainerPoint([s[i].lat, s[i].lon]);
    const d = (q.x - pt.x) ** 2 + (q.y - pt.y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  if (best >= 0) { st.playing = false; st.cur = s[best].t; render(); }
}

// trascinare la mappa a mano spegne "Segui" (come durante il rilievo)
function onMapDrag() { if (st && st.follow) { st.follow = false; render(); } }

function onKey(e) {
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); step((k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)); return true; }
  if (k === ' ') { e.preventDefault(); togglePlay(); return true; }
  if (k === 'Escape') { closeTele(); return true; }
  return true; // con la telemetria aperta gli altri tasti non creano punti
}

async function addPointHere() {
  const p = sampleAt(st.cur);
  if (p.gap) { toast('Qui il GPS era assente: posizione stimata tra due letture'); }
  st.playing = false;
  await capturePast({ t: st.cur, lat: p.lat, lon: p.lon, acc: p.acc, speed: p.spd, heading: p.hd, odo: p.odo, odoB: p.odoB });
  toast(`＋ Punto alle ${fmtTime(st.cur)}`);
  draw();
}

function exportCsv() {
  const s = st.s;
  const rows = ['ora;lat;lon;velocita_kmh;direzione;quota_m;precisione_m;trip_a_km;trip_b_km;progressiva_km;traccia_rec'];
  for (let i = 0; i < s.length; i++) {
    const p = s[i];
    rows.push([fmtTime(p.t), p.lat.toFixed(6), p.lon.toFixed(6), p.spd ?? '', p.hd ?? '', p.alt != null ? Math.round(p.alt) : '', p.acc ?? '',
      p.odo != null ? (p.odo / 1000).toFixed(3) : '', p.odoB != null ? (p.odoB / 1000).toFixed(3) : '', (st.cd[i] / 1000).toFixed(3), p.rec === false ? 'no' : 'si'].join(';').replace(/\./g, ','));
  }
  download(new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv' }), `telemetria_${st.day.replace(/\//g, '-')}.csv`);
}

const hms = (sec) => { const s = Math.round(sec); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
