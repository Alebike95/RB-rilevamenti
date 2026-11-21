/* global L, toGeoJSON, JSZip */
import { db, askPersistentStorage } from './db.js';
import { Gps, haversine } from './gps.js';
import { loadCatalog, MODES } from './catalog.js';
import { iconSVG } from './icons.js';
import { classify, openModal, closeModal } from './wizard.js';
import { TransitDetector, kmlPoints, beep } from './transit.js';
import { initEvents, openSignal, renderEvents } from './events.js';
import { initTunnel } from './tunnel.js';
import { initVoice, toggleVoice, renderVoices } from './voice.js';
import { openSettings, openExport, openTripDialog } from './settings.js';
import { $, $$, uid, fmtTime, fmtKm, esc, pointIcon, pointLabel, pointType, toast, vibrate, compressImage } from './util.js';

// ======================= STATO =======================
export const app = {
  session: null,          // { name, mode, created, rec }
  points: [],
  photos: [],             // metadati + blob in IndexedDB
  track: [],
  catalog: loadCatalog(),
  prefs: JSON.parse(localStorage.getItem('rb.prefs') || '{"captureKey":"any","follow":true}'),
  gps: new Gps(),
  queue: [],              // id dei punti in attesa di classificazione
  selId: null,
  curTab: 'pt',
  events: [],             // segnalazioni
  refPoints: [],          // punti della traccia di riferimento
  transits: [],           // passaggi automatici
  voices: [],             // note vocali
  detector: new TransitDetector([], 30),
  wizardOpen: false
};
window.__rb = app; // utile per debug

export function savePrefs() { localStorage.setItem('rb.prefs', JSON.stringify(app.prefs)); }
export async function saveSession() { await db.put('kv', app.session, 'session'); }

// ======================= MAPPA =======================
const map = L.map('map', { zoomControl: false, zoomSnap: 0.5, maxZoom: 22, tap: true }).setView([42.5, 12.5], 6);
L.control.zoom({ position: 'topleft' }).addTo(map);
L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

// Stesse mappe del GeoTool
const t = (url, attr, nz = 19, extra = {}) => L.tileLayer(url, { attribution: attr, maxNativeZoom: nz, maxZoom: 22, ...extra });
const baseLayers = {
  'OpenStreetMap': t('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', '&copy; OpenStreetMap'),
  'OpenTopoMap': t('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', '&copy; OpenTopoMap (CC-BY-SA)', 17),
  'ESRI Ortofoto': t('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 'Tiles &copy; Esri'),
  'ESRI Ibrido': L.layerGroup([
    t('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 'Tiles &copy; Esri'),
    t('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', 'Labels &copy; Esri')
  ]),
  'Google Map': t('https://mt1.google.com/vt/lyrs=r&x={x}&y={y}&z={z}', '&copy; Google', 21),
  'Google Satellite': t('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', '&copy; Google', 21),
  'Google Hybrid': t('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', '&copy; Google', 21)
};
const savedBase = localStorage.getItem('rb.base');
(baseLayers[savedBase] || baseLayers['Google Hybrid']).addTo(map);
map.on('baselayerchange', (e) => localStorage.setItem('rb.base', e.name));

const refLayer = L.featureGroup().addTo(map);
const trackLine = L.polyline([[]], { color: '#ffb300', weight: 4, opacity: 0.9 }).addTo(map);
const pointsLayer = L.featureGroup().addTo(map);
const photosLayer = L.featureGroup().addTo(map);
L.control.layers(baseLayers, { 'Traccia di riferimento': refLayer, 'Traccia rilevata': trackLine, 'Punti': pointsLayer, 'Foto': photosLayer }, { position: 'topright' }).addTo(map);

const meIcon = () => L.divIcon({
  className: '', iconSize: [26, 26], iconAnchor: [13, 13],
  html: `<svg class="me-ic" viewBox="0 0 26 26" style="transform:rotate(${app.gps.fix?.heading || 0}deg)"><circle cx="13" cy="13" r="9" fill="#1e88e5" stroke="#fff" stroke-width="3"/><path d="M13 0 L18 9 H8 Z" fill="#fff"/></svg>`
});
const meMarker = L.marker([0, 0], { icon: meIcon(), interactive: false, zIndexOffset: 1000 });
const accCircle = L.circle([0, 0], { radius: 1, color: '#1e88e5', weight: 1, fillOpacity: 0.08, interactive: false });

// Il "segui" si spegne quando si trascina la mappa
map.on('dragstart', () => setFollow(false));
export const appMap = () => map;
export function setFollow(on) {
  app.prefs.follow = on; savePrefs();
  $('#followBtn').classList.toggle('on', on);
  if (on && app.gps.fix) map.setView([app.gps.fix.lat, app.gps.fix.lon], Math.max(map.getZoom(), 16));
}
$('#followBtn').onclick = () => setFollow(!app.prefs.follow);

// Pressione lunga (o tasto destro) sulla mappa: punto manuale in quel posto
map.on('contextmenu', (e) => {
  const div = document.createElement('div');
  div.innerHTML = `<div style="text-align:center"><b>Aggiungere un punto qui?</b><br><small>ora attuale, posizione dalla mappa</small><br><button style="margin-top:6px">＋ Punto</button></div>`;
  const pop = L.popup().setLatLng(e.latlng).setContent(div).openOn(map);
  div.querySelector('button').onclick = () => {
    map.closePopup(pop);
    capture({ lat: e.latlng.lat, lon: e.latlng.lng, manual: true });
  };
});

// ======================= MARKER PUNTI E FOTO =======================
const markers = new Map();
function ptIcon(p) {
  const sel = p.id === app.selId ? ' sel' : '';
  return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: `<div class="pt-ic${sel}">${iconSVG(pointIcon(p), 30)}<b>${p.n}</b></div>` });
}
function drawPoint(p) {
  let m = markers.get(p.id);
  if (p.lat == null) { if (m) { pointsLayer.removeLayer(m); markers.delete(p.id); } return; }
  if (!m) {
    m = L.marker([p.lat, p.lon], { icon: ptIcon(p) });
    m.on('click', () => select(p.id, 'map'));
    m.addTo(pointsLayer);
    markers.set(p.id, m);
  } else {
    m.setLatLng([p.lat, p.lon]);
    m.setIcon(ptIcon(p));
  }
  m.bindTooltip(`${p.n} · ${fmtTime(p.t)}<br>${esc(pointLabel(p))}`, { direction: 'top', offset: [0, -14] });
}

const photoMarkers = new Map();
function drawPhoto(f) {
  if (f.lat == null || photoMarkers.has(f.id)) return;
  const m = L.marker([f.lat, f.lon], { icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: iconSVG('box:foto', 26) }) });
  m.on('click', () => {
    const url = URL.createObjectURL(f.thumb || f.blob);
    const div = document.createElement('div');
    div.innerHTML = `<img src="${url}"><div class="small muted">${fmtTime(f.t)}${f.pointId ? ' · punto ' + (app.points.find((x) => x.id === f.pointId)?.n ?? '') : ''}</div>
      <button class="small" style="margin-top:4px">🗑 Elimina foto</button>`;
    div.querySelector('img').onclick = () => openViewer(f);
    div.querySelector('button').onclick = () => { if (confirm('Eliminare la foto?')) { map.closePopup(); deletePhoto(f.id); } };
    m.bindPopup(div, { maxWidth: 260 }).openPopup();
    m.once('popupclose', () => { URL.revokeObjectURL(url); m.unbindPopup(); });
  });
  m.addTo(photosLayer);
  photoMarkers.set(f.id, m);
}

function openViewer(f) {
  const v = $('#viewer'), img = $('#viewerImg');
  const url = URL.createObjectURL(f.blob);
  img.src = url;
  $('#viewerCap').textContent = `${fmtTime(f.t)} · tocca per chiudere`;
  v.classList.remove('hidden');
  v.onclick = () => { v.classList.add('hidden'); img.src = ''; URL.revokeObjectURL(url); };
}

// ======================= TABELLA =======================
const tbody = $('#ptTable tbody');
export function renderTable() {
  const onlyPending = $('#filterPending').checked;
  const pc = new Map();
  for (const f of app.photos) if (f.pointId) pc.set(f.pointId, (pc.get(f.pointId) || 0) + 1);
  const vc = new Map();
  for (const v of app.voices) if (v.pointId) vc.set(v.pointId, (vc.get(v.pointId) || 0) + 1);
  const rows = app.points.filter((p) => !onlyPending || p.status === 'pending').map((p) => `
    <tr data-id="${p.id}" class="${p.id === app.selId ? 'sel' : ''} ${p.status === 'pending' ? 'pending' : ''}">
      <td class="num">${p.n}</td>
      <td class="num">${fmtTime(p.t)}</td>
      <td class="ic">${iconSVG(pointIcon(p), 24)}</td>
      <td>${esc(pointType(p))}</td>
      <td>${esc(pointLabel(p))}</td>
      <td class="num">${p.odo != null ? fmtKm(p.odo) : ''}</td>
      <td class="num">${p.odoB != null ? fmtKm(p.odoB) : ''}</td>
      <td class="num">${p.kmRil ?? ''}</td>
      <td class="note" title="${esc(p.notes)}">${esc(p.notes)}</td>
      <td class="num">${pc.get(p.id) || ''}${vc.get(p.id) ? ' 🎙' + vc.get(p.id) : ''}</td>
      <td class="act"><button data-edit="${p.id}">✎</button></td>
    </tr>`).join('');
  tbody.innerHTML = rows;
  const pend = app.points.filter((p) => p.status === 'pending').length;
  if (app.curTab === 'pt') $('#countTxt').textContent = `${app.points.length} · foto ${app.photos.length}${pend ? ` · ${pend} da classificare` : ''}`;
}
tbody.addEventListener('click', (e) => {
  const ed = e.target.closest('[data-edit]');
  if (ed) { e.stopPropagation(); editPoint(ed.dataset.edit); return; }
  const tr = e.target.closest('tr[data-id]');
  if (tr) select(tr.dataset.id, 'table');
});
tbody.addEventListener('dblclick', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) editPoint(tr.dataset.id); });
$('#filterPending').onchange = renderTable;

function showPanel(on) {
  $('#panel').classList.toggle('hidden', !on);
  localStorage.setItem('rb.panel', on ? '1' : '0');
  setTimeout(() => map.invalidateSize(), 50);
}
$('#tableBtn').onclick = () => showPanel($('#panel').classList.contains('hidden'));
$('#panelClose').onclick = () => showPanel(false);
$('#panelGrip').onclick = () => { $('#panel').classList.toggle('tall'); setTimeout(() => map.invalidateSize(), 50); };

// Selezione collegata mappa <-> tabella
function select(id, from) {
  // telemetria aperta: il cursore va all'ora del punto
  const sp = app.points.find((x) => x.id === id);
  if (sp && app.teleOpen && app.onSelectTime) app.onSelectTime(sp.t);
  const prev = app.selId;
  app.selId = id;
  for (const pid of [prev, id]) { const p = app.points.find((x) => x.id === pid); if (p) drawPoint(p); }
  $$('#ptTable tr.sel').forEach((r) => r.classList.remove('sel'));
  const tr = tbody.querySelector(`tr[data-id="${id}"]`);
  if (tr) tr.classList.add('sel');
  const p = app.points.find((x) => x.id === id);
  if (!p) return;
  if (from === 'map') {
    if ($('#panel').classList.contains('hidden')) showPanel(true);
    setTimeout(() => tbody.querySelector(`tr[data-id="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
  } else if (p.lat != null) {
    setFollow(false);
    map.setView([p.lat, p.lon], Math.max(map.getZoom(), 17));
    markers.get(id)?.openTooltip();
  }
}

// ======================= RILIEVO PUNTI =======================
const nextN = () => app.points.reduce((m, p) => Math.max(m, p.n), 0) + 1;

// Il momento del clic fissa ora, posizione e trip. Le finestre arrivano dopo.
export async function capture(manual) {
  const now = Date.now();
  const f = app.gps.fix;
  let pos;
  if (manual) pos = { lat: manual.lat, lon: manual.lon, acc: null, speed: null, heading: null, src: 'mappa', manual: true };
  else if (f) pos = { lat: f.lat, lon: f.lon, acc: f.acc, speed: f.speed, heading: f.heading, src: f.src, age: now - (f.rx || f.ts) };
  else pos = { lat: null, lon: null, src: 'nessuno' };
  const p = {
    id: uid(), n: nextN(), t: now, ...pos,
    odo: manual ? null : Math.round(app.gps.odo),
    odoB: manual ? null : Math.round(app.gps.odoB),
    mode: app.session.mode, status: 'pending', isBox: null, group: null, category: null, details: [], kmRil: null, notes: ''
  };
  app.points.push(p);
  await db.put('points', p);
  drawPoint(p); renderTable();
  vibrate(80);
  const b = $('#captureBtn'); b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 150);
  if (!manual && !f) toast('⚠ Nessuna posizione GPS: punto salvato senza coordinate');
  else if (pos.age > 10000) toast(`⚠ Posizione vecchia di ${Math.round(pos.age / 1000)} s`);
  app.queue.push(p.id);
  updateQueueBadge();
  if (!app.wizardOpen) runQueue();
}

// punto aggiunto a posteriori (dalla telemetria): ora, posizione e trip di quel momento
export async function capturePast(pos) {
  const p = {
    id: uid(), n: nextN(), t: Math.round(pos.t), lat: pos.lat, lon: pos.lon, acc: pos.acc ?? null,
    speed: pos.speed ?? null, heading: pos.heading ?? null, src: 'telemetria',
    odo: pos.odo != null ? Math.round(pos.odo) : null, odoB: pos.odoB != null ? Math.round(pos.odoB) : null,
    mode: app.session.mode, status: 'pending', isBox: null, group: null, category: null, details: [], kmRil: null, notes: ''
  };
  app.points.push(p);
  app.points.sort((a, b) => a.t - b.t);
  await db.put('points', p);
  drawPoint(p); renderTable();
  app.queue.push(p.id);
  updateQueueBadge();
  if (!app.wizardOpen) runQueue();
  return p;
}

function updateQueueBadge() {
  const n = app.queue.length - (app.wizardOpen ? 1 : 0);
  $('#queueBadge').textContent = n > 0 ? '+' + n : '';
}

async function runQueue() {
  if (app.wizardOpen) return;
  while (app.queue.length) {
    const id = app.queue[0];
    const p = app.points.find((x) => x.id === id);
    if (!p) { app.queue.shift(); continue; }
    await openClassify(p);
    app.queue.shift();
    updateQueueBadge();
  }
}

async function openClassify(p) {
  app.wizardOpen = true;
  updateQueueBadge();
  p.photoCount = app.photos.filter((f) => f.pointId === p.id).length;
  p.voiceCount = app.voices.filter((v) => v.pointId === p.id).length;
  const r = await classify(p, {
    catalog: app.catalog,
    mode: app.session.mode,
    get queue() { return app.queue.length - 1; },
    onPhoto: async (pt) => { await takePhoto(pt.id); return app.photos.filter((f) => f.pointId === pt.id).length; },
    onVoice: async (pt) => { await toggleVoice(pt.id); return app.voices.filter((v) => v.pointId === pt.id).length; }
  });
  delete p.photoCount; delete p.voiceCount;
  app.wizardOpen = false;
  if (r.action === 'save') {
    Object.assign(p, r.point);
    delete p.photoCount; delete p.voiceCount;
    await db.put('points', p);
    drawPoint(p); renderTable();
    toast(`✔ Punto ${p.n}: ${pointLabel(p)}`, 1500);
  } else if (r.action === 'delete') {
    await deletePoint(p.id);
  }
  // 'later' = resta "da classificare"
}

async function editPoint(id) {
  const p = app.points.find((x) => x.id === id);
  if (!p || app.wizardOpen) return;
  await openClassify(p);
  runQueue();
}

async function deletePoint(id) {
  app.points = app.points.filter((x) => x.id !== id);
  await db.del('points', id);
  const m = markers.get(id); if (m) { pointsLayer.removeLayer(m); markers.delete(id); }
  // le foto collegate restano, ma scollegate dal punto
  for (const f of app.photos.filter((x) => x.pointId === id)) { f.pointId = null; await db.put('photos', f); }
  renderTable();
}

async function deletePhoto(id) {
  app.photos = app.photos.filter((x) => x.id !== id);
  await db.del('photos', id);
  const m = photoMarkers.get(id); if (m) { photosLayer.removeLayer(m); photoMarkers.delete(id); }
  renderTable();
}

$('#captureBtn').onclick = () => capture();

// ======================= FOTO =======================
const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

// Ora e posizione della foto = momento in cui si preme il pulsante
// Ora e posizione della foto = momento dello SCATTO (non dell'apertura della fotocamera)
export function takePhoto(pointId = null) {
  const meta = { id: uid(), pointId, notes: '' };
  const useNative = isMobile || app.prefs.camera === 'file';
  return useNative ? photoFromInput(meta) : photoFromCamera(meta);
}

function photoFromInput(meta) {
  return new Promise((resolve) => {
    const inp = $('#photoInput');
    inp.value = '';
    inp.onchange = async () => {
      const file = inp.files[0];
      if (file) {
        // fotocamera del telefono: l'ora dello scatto e' quella del file; la posizione si ricava
        // dalla registrazione in sottofondo a quell'ora (l'app era in secondo piano mentre scattavi)
        const now = Date.now();
        const t = file.lastModified && file.lastModified <= now + 60000 && now - file.lastModified < 30 * 60000 ? file.lastModified : now;
        Object.assign(meta, posAt(t));
        await storePhoto(meta, file);
      }
      resolve();
    };
    // se l'utente annulla non arriva nessun evento: si risolve al ritorno del focus
    window.addEventListener('focus', () => setTimeout(() => { if (!inp.files.length) resolve(); }, 1500), { once: true });
    inp.click();
  });
}

// Fotocamera dentro l'app (Surface / PC: il selettore file non apre la camera)
function photoFromCamera(meta) {
  return new Promise(async (resolve) => {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 3840 }, height: { ideal: 2160 } } });
    } catch (e) {
      toast('Fotocamera non disponibile, scegli un file');
      await photoFromInput(meta); resolve(); return;
    }
    const track = stream.getVideoTracks()[0];
    // zoom vero della fotocamera se il dispositivo lo permette, altrimenti zoom digitale (ritaglio)
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    const hw = caps.zoom && caps.zoom.max > caps.zoom.min ? caps.zoom : null;
    const zMin = hw ? hw.min : 1, zMax = hw ? hw.max : 5, zStep = hw ? (hw.step || 0.1) : 0.1;
    let zoom = hw ? (track.getSettings().zoom || zMin) : 1;
    const holder = document.createElement('div');
    holder.className = 'modal'; holder.style.zIndex = 2500;
    holder.innerHTML = `<div class="sheet cam"><div class="sheet-head"><h3>Foto</h3><span class="muted small">ora e posizione al momento dello scatto</span></div>
      <div class="sheet-body"><div class="cam-wrap"><video autoplay playsinline muted></video></div>
        <div class="zoom-row"><button id="zOut">−</button><input id="zSl" type="range" min="${zMin}" max="${zMax}" step="${zStep}" value="${zoom}"><button id="zIn">＋</button><b id="zTx">${zoom.toFixed(1)}×</b></div></div>
      <div class="sheet-foot"><button id="camCancel">Annulla</button><button id="camFile">📁 Da file</button><div class="spacer"></div><button id="camShot" class="btn-main">📷 Scatta</button></div></div>`;
    document.body.appendChild(holder);
    const video = holder.querySelector('video'), wrapEl = holder.querySelector('.cam-wrap'), sl = holder.querySelector('#zSl');
    video.srcObject = stream;
    const setZoom = (z) => {
      zoom = Math.max(zMin, Math.min(zMax, z));
      sl.value = zoom; holder.querySelector('#zTx').textContent = zoom.toFixed(1) + '×';
      if (hw) track.applyConstraints({ advanced: [{ zoom }] }).catch(() => {});
      else video.style.transform = `scale(${zoom})`;
    };
    sl.oninput = () => setZoom(+sl.value);
    holder.querySelector('#zIn').onclick = () => setZoom(zoom + 0.5);
    holder.querySelector('#zOut').onclick = () => setZoom(zoom - 0.5);
    // pizzico con due dita (eventi "pointer": funzionano anche sui touch di Windows)
    const pts = new Map(); let d0 = 0, z0 = 1;
    const dist2 = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    wrapEl.addEventListener('pointerdown', (e) => { wrapEl.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { d0 = dist2(); z0 = zoom; } });
    wrapEl.addEventListener('pointermove', (e) => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2 && d0 > 0) setZoom(z0 * dist2() / d0); });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) d0 = 0; };
    wrapEl.addEventListener('pointerup', up); wrapEl.addEventListener('pointercancel', up);
    wrapEl.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.1 : 0.9)); }, { passive: false });
    const end = () => { stream.getTracks().forEach((t) => t.stop()); holder.remove(); resolve(); };
    holder.querySelector('#camCancel').onclick = end;
    holder.querySelector('#camFile').onclick = async () => { stream.getTracks().forEach((t) => t.stop()); holder.remove(); await photoFromInput(meta); resolve(); };
    holder.querySelector('#camShot').onclick = async () => {
      Object.assign(meta, posAt(Date.now())); // fissati adesso, al click su Scatta
      const vw = video.videoWidth, vh = video.videoHeight;
      // zoom digitale: si salva solo la parte centrale inquadrata
      const k = hw ? 1 : zoom;
      const cw = Math.round(vw / k), ch = Math.round(vh / k);
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, cw, ch);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
      await storePhoto(meta, blob);
      end();
    };
  });
}

// posizione e trip a un certo istante: GPS attuale se recente, altrimenti dalla registrazione in sottofondo
export function posAt(t) {
  const f = gps.fix;
  if (f && Math.abs((f.rx || f.ts) - t) < 3000) {
    return { t, lat: f.lat, lon: f.lon, acc: f.acc ?? null, odo: Math.round(gps.odo), odoB: Math.round(gps.odoB) };
  }
  const tr = app.track;
  if (tr.length) {
    let lo = 0, hi = tr.length - 1;
    if (t <= tr[0].t) hi = 0; else if (t >= tr[hi].t) lo = hi;
    else { while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tr[m].t <= t) lo = m; else hi = m; } }
    const a = tr[lo], b = tr[hi];
    if (Math.min(Math.abs(a.t - t), Math.abs(b.t - t)) < 60000) {
      const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
      const I = (x, y) => (x == null || y == null ? (x ?? y) : x + (y - x) * k);
      return { t, lat: I(a.lat, b.lat), lon: I(a.lon, b.lon), acc: a.acc ?? null, odo: I(a.odo, b.odo), odoB: I(a.odoB, b.odoB) };
    }
  }
  if (!f) toast('⚠ Foto senza posizione GPS');
  return { t, lat: f?.lat ?? null, lon: f?.lon ?? null, acc: f?.acc ?? null, odo: Math.round(gps.odo), odoB: Math.round(gps.odoB) };
}

async function storePhoto(meta, file) {
  try {
    const q = app.prefs.photoQuality || { side: 1920, q: 0.75 };
    const { blob, thumb, w, h } = await compressImage(file, q.side, q.q);
    if (meta.odo != null) meta.odo = Math.round(meta.odo);
    if (meta.odoB != null) meta.odoB = Math.round(meta.odoB);
    const ph = { ...meta, blob, thumb, w, h, size: blob.size };
    app.photos.push(ph);
    await db.put('photos', ph);
    drawPhoto(ph); renderTable();
    toast(`📷 Foto salvata (${Math.round(blob.size / 1024)} kB)`, 1400);
  } catch (e) {
    console.error(e); toast('Errore foto: ' + e.message);
  }
}
$('#photoBtn').onclick = () => takePhoto();
document.addEventListener('rb-voice', () => renderTable());
// telemetria: codice caricato solo quando serve (non pesa sull'app durante il rilievo)
$('#teleBtn').onclick = async () => { const m = await import('./telemetry.js'); m.toggleTelemetry(); };

// ======================= GPS, TRIP, TRACCIA =======================
const gps = app.gps;
let lastTrackPt = null;
let trackBuf = [];

let prevFix = null;
gps.addEventListener('fix', (e) => {
  const f = e.detail;
  // passaggi automatici sui punti di riferimento
  if (app.prefs.autoTransit !== false && app.refPoints.length) {
    app.detector.radius = app.prefs.transitRadius || 30;
    const done = app.detector.update(prevFix, f, { odo: gps.odo, odoB: gps.odoB });
    for (const r of done) addTransit(r);
  }
  prevFix = f;
  const ll = [f.lat, f.lon];
  if (!map.hasLayer(meMarker)) { meMarker.addTo(map); accCircle.addTo(map); map.setView(ll, 17); }
  meMarker.setLatLng(ll); meMarker.setIcon(meIcon());
  accCircle.setLatLng(ll); accCircle.setRadius(f.acc || 1);
  if (app.prefs.follow) map.panTo(ll, { animate: false });
  $('#spdVal').textContent = f.speed != null ? Math.round(f.speed) : '–';
  updateChip();
  // registrazione SEMPRE attiva in sottofondo (per la telemetria): un punto ogni ~5 m (o 10 s se fermo).
  // REC decide solo se il punto fa parte della traccia mostrata in mappa ed esportata.
  if (app.session && (f.acc == null || f.acc <= 30)) {
    const d = lastTrackPt ? haversine(lastTrackPt, f) : Infinity;
    if (d >= 5 || (d >= 1 && f.ts - lastTrackPt.t > 10000)) {
      const rec = !!app.session.rec;
      const tp = { rec, seg: rec ? (app.session.seg || 1) : 0, t: f.ts, hd: f.heading != null ? Math.round(f.heading) : null, odoB: Math.round(gps.odoB), lat: +f.lat.toFixed(7), lon: +f.lon.toFixed(7), alt: f.alt ?? null, spd: f.speed != null ? Math.round(f.speed * 10) / 10 : null, acc: f.acc ?? null, odo: Math.round(gps.odo) };
      lastTrackPt = tp;
      app.track.push(tp);
      trackBuf.push(tp);
      if (rec) { const segs = trackLine.getLatLngs(); trackLine.addLatLng(ll, segs[segs.length - 1]); }
    }
  }
});
export function showTrips() {
  const dec = app.prefs.tripDec === 3 ? 3 : 2;
  $('#tripVal').textContent = (gps.odo / 1000).toFixed(dec);
  $('#tripValB').textContent = (gps.odoB / 1000).toFixed(dec);
}
gps.addEventListener('odo', showTrips);
gps.addEventListener('status', (e) => { if (e.detail.msg) $('#gpsChip').title = e.detail.msg; updateChip(); });

const SRC_LABEL = { internal: 'GPS', racebox: 'RaceBox', nmea: 'GLO', sim: 'SIM' };
function updateChip() {
  const f = gps.fix, chip = $('#gpsChip');
  const age = f ? Date.now() - (f.rx || f.ts) : Infinity;
  chip.classList.remove('ok', 'warn');
  if (!f || age > 5000) { $('#gpsTxt').textContent = f ? `${SRC_LABEL[f.src]} perso` : 'GPS…'; return; }
  chip.classList.add(f.acc != null && f.acc > 15 ? 'warn' : 'ok');
  $('#gpsTxt').textContent = `${SRC_LABEL[f.src]} ±${f.acc != null ? f.acc.toFixed(1) : '?'}m ${f.hz}Hz`;
  if (f.src === 'racebox' && gps.rbInfo) chip.title = `RaceBox ${gps.rbInfo.sats} sat · batteria ${gps.rbInfo.battery}%`;
}
setInterval(updateChip, 1000);

// orologio (ore:minuti:secondi), aggiornato al cambio di secondo
let lastSec = -1;
setInterval(() => {
  const now = Date.now(), s = Math.floor(now / 1000);
  if (s === lastSec) return;
  lastSec = s;
  const t = fmtTime(now);
  $('#clock').textContent = t; $('#chipClock').textContent = t;
}, 100);

// salvataggi periodici (traccia e trip)
setInterval(async () => {
  if (trackBuf.length) { const b = trackBuf; trackBuf = []; await db.addMany('track', b); }
  await db.put('kv', gps.odo, 'odo');
  await db.put('kv', gps.odoB, 'odoB');
}, 4000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && trackBuf.length) { const b = trackBuf; trackBuf = []; db.addMany('track', b); }
});
window.addEventListener('pagehide', () => { if (trackBuf.length) db.addMany('track', trackBuf); db.put('kv', gps.odo, 'odo'); db.put('kv', gps.odoB, 'odoB'); });

// REC = sta registrando. PAUSA = non registra. Ogni ripresa dopo una pausa crea un nuovo tratto.
function showRec() {
  const b = $('#recBtn'), on = !!app.session.rec;
  b.classList.toggle('on', on);
  b.innerHTML = on ? '<span class="rdot"></span>REC' : '⏸ PAUSA';
  b.title = on ? `Sta registrando il tratto ${app.session.seg || 1}. Tocca per mettere in pausa.` : 'Traccia in pausa: tocca per registrare un nuovo tratto.';
}
$('#recBtn').onclick = async () => {
  app.session.rec = !app.session.rec;
  if (app.session.rec) {
    // nuovo tratto solo se il precedente ha gia' dei punti
    if (app.track.some((x) => x.rec !== false && (x.seg || 1) === (app.session.seg || 1))) {
      app.session.seg = (app.session.seg || 1) + 1;
      const segs = trackLine.getLatLngs(); segs.push([]); trackLine.setLatLngs(segs);
    }
    lastTrackPt = null;
    toast(`● Registrazione traccia: tratto ${app.session.seg || 1}`);
  } else {
    toast('⏸ Traccia in pausa');
  }
  showRec();
  await saveSession();
};
$('#tripBox').onclick = () => openTripDialog('A');
$('#tripBoxB').onclick = () => openTripDialog('B');
$('#gpsChip').onclick = () => openSettings('gps');

// ======================= MODALITÀ =======================
function setMode(m) {
  app.session.mode = m;
  $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  saveSession();
}
$$('#modeSeg button').forEach((b) => b.onclick = () => { setMode(b.dataset.mode); toast('Modalità ' + MODES[b.dataset.mode].label, 1200); });

// ======================= TASTI (telecomandi Bluetooth) =======================
const IGNORED = ['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'F5', 'F12', 'Escape', 'ContextMenu'];
window.addEventListener('keydown', (e) => {
  if (app.learnKey) { e.preventDefault(); app.learnKey(e.key); return; }
  if (app.teleOpen && app.teleKey && app.teleKey(e)) return; // tasti della telemetria
  const tag = (document.activeElement?.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (e.repeat || IGNORED.includes(e.key) || e.ctrlKey || e.altKey || e.metaKey) return;
  if (app.prefs.eventKey && e.key === app.prefs.eventKey) { e.preventDefault(); openSignal(); return; }
  const k = app.prefs.captureKey || 'any';
  if (k === 'any' ? true : e.key === k) {
    e.preventDefault();
    capture();
  }
});

// ======================= SCHERMO SEMPRE ACCESO =======================
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { /* */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
document.addEventListener('pointerdown', keepAwake, { once: true });

// ======================= MENU =======================
$('#settingsBtn').onclick = () => openSettings();
$('#exportBtn').onclick = () => openExport();
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !app.wizardOpen) closeModal(); });

// ======================= TRACCIA DI RIFERIMENTO =======================
export async function loadRefTrack(file) {
  let text;
  if (/\.kmz$/i.test(file.name)) {
    const z = await JSZip.loadAsync(file);
    const kml = Object.keys(z.files).find((n) => /\.kml$/i.test(n));
    text = await z.file(kml).async('string');
  } else text = await file.text();
  const dom = new DOMParser().parseFromString(text, 'text/xml');
  const isGpx = /\.gpx$/i.test(file.name);
  const gj = isGpx ? toGeoJSON.gpx(dom) : toGeoJSON.kml(dom);
  // punti per i passaggi automatici (con nome della cartella)
  const pts = isGpx ? pointsFromGeoJSON(gj) : kmlPoints(dom);
  await db.put('kv', gj, 'refTrack');
  app.refTrack = gj;
  await setRefPoints(pts);
  drawRef(gj);
  if (refLayer.getLayers().length) map.fitBounds(refLayer.getBounds(), { padding: [30, 30] });
  setFollow(false);
}
export async function clearRefTrack() { await db.del('kv', 'refTrack'); app.refTrack = null; await setRefPoints([]); refLayer.clearLayers(); }
function drawRef(gj) {
  refLayer.clearLayers();
  L.geoJSON(gj, {
    style: { color: '#00e5ff', weight: 5, opacity: 0.6, dashArray: '8 6' },
    filter: (f) => f.geometry?.type !== 'Point' // i punti li disegna drawRefPoints
  }).addTo(refLayer);
  drawRefPoints();
}

// ======================= PASSAGGI AUTOMATICI =======================
const refPtLayer = L.featureGroup().addTo(refLayer);
const refMarkers = new Map();
function pointsFromGeoJSON(gj) {
  return (gj.features || []).filter((f) => f.geometry?.type === 'Point').map((f, i) => ({
    id: 'r' + i, name: f.properties?.name || `Punto ${i + 1}`, folder: '', lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0]
  }));
}
async function setRefPoints(pts) {
  app.refPoints = pts;
  app.detector.setPoints(pts);
  await db.put('kv', pts, 'refPoints');
}
function drawRefPoints() {
  refPtLayer.clearLayers(); refMarkers.clear();
  if (!refLayer.hasLayer(refPtLayer)) refPtLayer.addTo(refLayer);
  const passed = new Set(app.transits.map((t) => t.refId));
  for (const p of app.refPoints) {
    const ok = passed.has(p.id);
    const m = L.circleMarker([p.lat, p.lon], { radius: 7, color: ok ? '#43a047' : '#00e5ff', weight: 3, fillOpacity: ok ? 0.7 : 0.25 })
      .bindTooltip(`${esc(p.name)}${p.folder ? '<br><small>' + esc(p.folder) + '</small>' : ''}`);
    m.addTo(refPtLayer); refMarkers.set(p.id, m);
  }
}
const fmtSec = (ms) => fmtTime(Math.round(ms / 1000) * 1000);
// Passaggi calcolati A POSTERIORI dalla registrazione in sottofondo
// (es. traccia di riferimento caricata dopo il giro). Non duplica quelli gia' presi.
export async function recomputeTransits() {
  if (!app.refPoints.length) { toast('Carica prima una traccia di riferimento con dei punti'); return 0; }
  const det = new TransitDetector(app.refPoints, app.prefs.transitRadius || 30);
  const tr = [...app.track].sort((a, b) => a.t - b.t);
  let prev = null, added = 0;
  for (const x of tr) {
    const cur = { lat: x.lat, lon: x.lon, ts: x.t, speed: x.spd, src: 'registrazione' };
    for (const r of det.update(prev, cur, { odo: x.odo, odoB: x.odoB })) {
      const dup = app.transits.some((t) => t.refId === r.point.id && Math.abs(t.t - r.t) < 60000);
      if (!dup) { await addTransit(r, true); added++; }
    }
    prev = cur;
  }
  // chiude un eventuale passaggio ancora aperto alla fine della registrazione
  if (prev) for (const r of det.update(prev, { ...prev, ts: prev.ts + 60000, lat: prev.lat + 1 }, {})) {
    if (!app.transits.some((t) => t.refId === r.point.id && Math.abs(t.t - r.t) < 60000)) { await addTransit(r, true); added++; }
  }
  renderTransits(); drawRefPoints();
  return added;
}

async function addTransit(r, quiet) {
  const p = r.point;
  const tr = {
    id: uid(), n: app.transits.reduce((m, x) => Math.max(m, x.n), 0) + 1,
    refId: p.id, name: p.name, folder: p.folder, lat: p.lat, lon: p.lon,
    t: Math.round(r.t), dist: Math.round(r.d * 10) / 10, speed: r.speed,
    odo: r.odo != null ? Math.round(r.odo) : null, odoB: r.odoB != null ? Math.round(r.odoB) : null, src: r.src, mergedId: null
  };
  app.transits.push(tr);
  await db.put('kv', app.transits, 'transits');
  refMarkers.get(p.id)?.setStyle({ color: '#43a047', fillOpacity: 0.7 });
  if (quiet) return;
  beep(); vibrate([60, 60, 60]);
  toast(`⏱ ${p.name} · ${fmtSec(tr.t)}`, 2500);
  renderTransits();
}
const hms = (ms) => { const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
export function renderTransits() {
  const tb = $('#trTable tbody');
  const list = [...app.transits].sort((a, b) => a.t - b.t);
  tb.innerHTML = list.map((t, i) => `
    <tr data-tid="${t.id}" class="${t.mergedId ? 'merged' : ''}">
      <td class="num">${t.n}</td><td class="num">${fmtSec(t.t)}</td><td>${esc(t.name)}</td><td class="muted">${esc(t.folder)}</td>
      <td class="num">${t.dist} m</td><td class="num">${t.odo != null ? fmtKm(t.odo) : ''}</td><td class="num">${t.odoB != null ? fmtKm(t.odoB) : ''}</td>
      <td class="num">${i ? hms(t.t - list[i - 1].t) : ''}</td>
      <td class="act">${t.mergedId ? '<span class="muted small">unito</span>' : `<button data-merge="${t.id}" title="Unisci ai punti">＋</button>`}<button data-tdel="${t.id}">🗑</button></td>
    </tr>`).join('');
  if (app.curTab === 'tr') $('#countTxt').textContent = `${app.transits.length} · punti rif. ${app.refPoints.length}`;
}
$('#trTable tbody').addEventListener('click', async (e) => {
  const m = e.target.closest('[data-merge]'), d = e.target.closest('[data-tdel]');
  if (m) { e.stopPropagation(); await mergeTransit(m.dataset.merge); renderTable(); renderTransits(); return; }
  if (d) {
    e.stopPropagation();
    if (!confirm('Eliminare il passaggio?')) return;
    app.transits = app.transits.filter((x) => x.id !== d.dataset.tdel);
    await db.put('kv', app.transits, 'transits'); renderTransits(); drawRefPoints(); return;
  }
  const tr = e.target.closest('tr[data-tid]');
  if (tr) {
    const t = app.transits.find((x) => x.id === tr.dataset.tid);
    if (t) { setFollow(false); map.setView([t.lat, t.lon], Math.max(map.getZoom(), 17)); refMarkers.get(t.refId)?.openTooltip(); }
  }
});
// passaggio -> riga nella tabella dei punti (come rilievo "Info" con il nome del punto)
async function mergeTransit(id) {
  const t = app.transits.find((x) => x.id === id);
  if (!t || t.mergedId) return;
  const p = {
    id: uid(), n: nextN(), t: t.t, lat: t.lat, lon: t.lon, acc: null, speed: t.speed, heading: null, src: 'passaggio',
    odo: t.odo, odoB: t.odoB, mode: app.session.mode, status: 'done', isBox: false, group: null,
    category: { id: 'passaggio', label: t.name, icon: 'box:riferimento', flow: '' }, details: [], kmRil: null,
    notes: 'Passaggio automatico' + (t.folder ? ' · ' + t.folder : '')
  };
  app.points.push(p); app.points.sort((a, b) => a.t - b.t);
  await db.put('points', p);
  t.mergedId = p.id;
  await db.put('kv', app.transits, 'transits');
  drawPoint(p);
}
$('#mergeAll').onclick = async () => {
  const todo = app.transits.filter((t) => !t.mergedId);
  if (!todo.length || !confirm(`Unire ${todo.length} passaggi alla tabella dei punti?`)) return;
  for (const t of todo) await mergeTransit(t.id);
  renderTable(); renderTransits(); toast(`${todo.length} passaggi uniti`);
};
$$('#tabSeg button').forEach((b) => b.onclick = () => {
  app.curTab = b.dataset.tab;
  $$('#tabSeg button').forEach((x) => x.classList.toggle('on', x === b));
  $('#tableWrap').classList.toggle('hidden', app.curTab !== 'pt');
  $('#trWrap').classList.toggle('hidden', app.curTab !== 'tr');
  $('#evWrap').classList.toggle('hidden', app.curTab !== 'ev');
  $('#vWrap').classList.toggle('hidden', app.curTab !== 'vo');
  $('#filterBox').classList.toggle('hidden', app.curTab !== 'pt');
  $('#mergeAll').classList.toggle('hidden', app.curTab !== 'tr');
  if (app.curTab === 'pt') renderTable(); else if (app.curTab === 'tr') renderTransits(); else if (app.curTab === 'vo') renderVoices(); else renderEvents();
});

// ======================= RESET / RIPRISTINO =======================
export async function resetSession() {
  await db.clearAll();
  location.reload();
}

export async function restoreBackup(j) {
  await db.clearAll();
  await db.put('kv', j.session, 'session');
  await db.put('kv', j.odo || 0, 'odo');
  await db.put('kv', j.odoB || 0, 'odoB');
  for (const p of j.points) await db.put('points', p);
  for (const f of j.photos) await db.put('photos', f);
  for (let i = 0; i < j.track.length; i += 2000) await db.addMany('track', j.track.slice(i, i + 2000));
  if (j.transits) await db.put('kv', j.transits, 'transits');
  if (j.events) await db.put('kv', j.events, 'events');
  if (j.corrections) await db.put('kv', j.corrections, 'corrections');
  for (const v of j.voices || []) await db.put('voices', v);
  if (j.refPoints) await db.put('kv', j.refPoints, 'refPoints');
  if (j.refTrack) await db.put('kv', j.refTrack, 'refTrack');
  location.reload();
}

export function getState() {
  return { session: app.session, points: app.points, photos: app.photos, track: app.track, odo: gps.odo, odoB: gps.odoB, transits: app.transits, refPoints: app.refPoints, refTrack: app.refTrack, events: app.events, corrections: app.corrections || [], voices: app.voices };
}

// altezza barra in alto (su telefono va su due righe)
function fitTop() { document.documentElement.style.setProperty('--top', $('#top').offsetHeight + 'px'); map.invalidateSize(); }
window.addEventListener('resize', fitTop);
fitTop();

// ======================= AVVIO =======================
async function init() {
  app.session = (await db.get('kv', 'session')) || { name: 'Rilievo', mode: 'rally', created: Date.now(), rec: false, seg: 1 };
  await saveSession();
  app.points = ((await db.all('points')) || []).sort((a, b) => a.t - b.t);
  app.photos = ((await db.all('photos')) || []).sort((a, b) => a.t - b.t);
  app.track = ((await db.all('track')) || []).sort((a, b) => a.t - b.t);
  gps.odo = (await db.get('kv', 'odo')) || 0;
  gps.odoB = (await db.get('kv', 'odoB')) || 0;
  gps.cal = Number(app.prefs.tripCal) || 0;
  showTrips();
  // all'apertura la traccia parte sempre in pausa: si avvia a mano con REC
  app.session.rec = false;
  app.session.seg = app.session.seg || Math.max(1, ...app.track.filter((x) => x.rec !== false).map((x) => x.seg || 1));
  lastTrackPt = app.track[app.track.length - 1] || null;
  const segMap = new Map();
  for (const x of app.track) { if (x.rec === false) continue; const k = x.seg || 1; if (!segMap.has(k)) segMap.set(k, []); segMap.get(k).push([x.lat, x.lon]); }
  const segs = [...segMap.keys()].sort((a, b) => a - b).map((k) => segMap.get(k));
  if (!segMap.has(app.session.seg)) segs.push([]);
  trackLine.setLatLngs(segs.length ? segs : [[]]);
  app.points.forEach(drawPoint);
  app.photos.forEach(drawPhoto);
  app.transits = (await db.get('kv', 'transits')) || [];
  const ref = await db.get('kv', 'refTrack');
  app.refTrack = ref || null;
  app.refPoints = (await db.get('kv', 'refPoints')) || (ref ? pointsFromGeoJSON(ref) : []);
  app.detector.setPoints(app.refPoints);
  if (ref) drawRef(ref);
  renderTransits();
  await initEvents();
  await initTunnel();
  await initVoice();
  setMode(app.session.mode);
  showRec();
  $('#followBtn').classList.toggle('on', !!app.prefs.follow);
  renderTable();
  const all = [...app.points.filter((p) => p.lat != null).map((p) => [p.lat, p.lon]), ...app.track.filter((x) => x.rec !== false).map((x) => [x.lat, x.lon])];
  if (all.length) map.fitBounds(all, { padding: [30, 30], maxZoom: 17 });
  if (localStorage.getItem('rb.panel') === '1' || (localStorage.getItem('rb.panel') == null && innerWidth >= 900)) showPanel(true);
  gps.startInternal();
  askPersistentStorage();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
}
init();
