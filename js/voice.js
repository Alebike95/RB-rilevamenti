// Note vocali: l'audio viene sempre salvato (funziona senza rete).
// Tocca 🎙 per iniziare e di nuovo (o STOP sulla barra) per finire. Ora e posizione = inizio.
// La trascrizione in testo e' prevista dopo, sul PC.
/* global L */
import { app, appMap, posAt, setFollow } from './app.js';
import { db } from './db.js';
import { iconSVG } from './icons.js';
import { $, uid, esc, fmtTime, fmtKm, toast, vibrate } from './util.js';

const MAX_MS = 5 * 60 * 1000; // stop automatico dopo 5 minuti
let rec = null;               // registrazione in corso
const markers = new Map();
let player = null;

export async function initVoice() {
  app.voices = ((await db.all('voices')) || []).sort((a, b) => a.t - b.t);
  app._vLayer = L.featureGroup().addTo(appMap());
  app.voices.forEach(drawVoice);
  renderVoices();
  $('#voiceBtn').onclick = () => toggleVoice(null);
  $('#vTable tbody').addEventListener('click', onTableClick);
}

export const isRecording = () => !!rec;

// pointId: nota collegata a un punto (dalla finestra del punto). Restituisce quando la nota e' salvata.
export async function toggleVoice(pointId = null) {
  if (rec) return stopVoice();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('Registrazione audio non disponibile su questo browser'); return; }
  const meta = { id: uid(), pointId, notes: '', ...posAt(Date.now()) };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) { toast('Microfono non disponibile: ' + e.message, 4000); return; }
  const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
  const chunks = [];
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve) => {
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const dur = Date.now() - rec.start;
      clearInterval(rec.timer); clearTimeout(rec.auto);
      rec = null; showBar();
      const blob = new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' });
      if (dur < 700 || !blob.size) { toast('Nota troppo corta, non salvata'); resolve(null); return; }
      const v = { ...meta, dur, mime: blob.type, blob, size: blob.size };
      app.voices.push(v); app.voices.sort((a, b) => a.t - b.t);
      await db.put('voices', v);
      drawVoice(v); renderVoices();
      document.dispatchEvent(new CustomEvent('rb-voice', { detail: v }));
      toast(`🎙 Nota vocale salvata (${Math.round(dur / 1000)} s)`, 1600);
      resolve(v);
    };
  });
  mr.start(1000);
  rec = { mr, start: Date.now(), pointId, done };
  rec.timer = setInterval(showBar, 500);
  rec.auto = setTimeout(() => { if (rec?.mr === mr) { toast('Nota vocale fermata dopo 5 minuti'); stopVoice(); } }, MAX_MS);
  vibrate(60);
  showBar();
  return done;
}

export function stopVoice() {
  if (!rec) return;
  const d = rec.done;
  try { rec.mr.stop(); } catch (e) { /* gia' fermo */ }
  vibrate([40, 40, 40]);
  return d;
}

// barra rossa in alto, visibile anche sopra le finestre
function showBar() {
  let bar = $('#voiceBar');
  if (!rec) { document.documentElement.style.setProperty('--vbh', '0px'); bar?.remove(); $('#voiceBtn')?.classList.remove('rec'); document.querySelectorAll('.wz-mic').forEach((b) => b.classList.remove('rec')); return; }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'voiceBar';
    bar.innerHTML = `<span class="rdot"></span><b id="vbT">00:00</b><span id="vbL"></span><button id="vbStop" class="btn-warn">■ STOP</button>`;
    document.body.appendChild(bar);
    bar.querySelector('#vbStop').onclick = () => stopVoice();
  }
  const s = Math.floor((Date.now() - rec.start) / 1000);
  bar.querySelector('#vbT').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const p = rec.pointId && app.points.find((x) => x.id === rec.pointId);
  bar.querySelector('#vbL').textContent = p ? `nota del punto ${p.n}` : 'nota vocale';
  $('#voiceBtn')?.classList.add('rec');
  document.documentElement.style.setProperty('--vbh', bar.offsetHeight + 8 + 'px');
  document.querySelectorAll('.wz-mic').forEach((b) => b.classList.add('rec'));
}

// ---------- ascolto ----------
export function play(v) {
  if (player) { player.pause(); URL.revokeObjectURL(player.src); }
  player = new Audio(URL.createObjectURL(v.blob));
  player.play().catch((e) => toast('Audio non riproducibile: ' + e.message));
  return player;
}

// ---------- mappa ----------
function drawVoice(v) {
  if (v.lat == null || markers.has(v.id)) return;
  const m = L.marker([v.lat, v.lon], { icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: iconSVG('box:voce', 26) }) });
  m.on('click', () => {
    const p = v.pointId && app.points.find((x) => x.id === v.pointId);
    const div = document.createElement('div');
    const url = URL.createObjectURL(v.blob);
    div.innerHTML = `<div class="small"><b>🎙 ${fmtTime(v.t)}</b> · ${Math.round(v.dur / 1000)} s${p ? ' · punto ' + p.n : ''}</div>
      <audio controls src="${url}" style="width:230px;margin-top:4px"></audio>
      <div><button class="small" style="margin-top:4px">🗑 Elimina</button></div>`;
    div.querySelector('button').onclick = () => { if (confirm('Eliminare la nota vocale?')) { appMap().closePopup(); deleteVoice(v.id); } };
    m.bindPopup(div, { maxWidth: 260 }).openPopup();
    m.once('popupclose', () => { div.querySelector('audio')?.pause(); URL.revokeObjectURL(url); m.unbindPopup(); });
  });
  m.addTo(app._vLayer);
  markers.set(v.id, m);
}

export async function deleteVoice(id) {
  app.voices = app.voices.filter((x) => x.id !== id);
  await db.del('voices', id);
  const m = markers.get(id); if (m) { app._vLayer.removeLayer(m); markers.delete(id); }
  renderVoices();
  document.dispatchEvent(new CustomEvent('rb-voice'));
}

// ---------- tabella ----------
export function renderVoices() {
  const tb = $('#vTable tbody');
  if (!tb) return;
  tb.innerHTML = app.voices.map((v, i) => {
    const p = v.pointId && app.points.find((x) => x.id === v.pointId);
    return `<tr data-vid="${v.id}">
      <td class="num">${i + 1}</td><td class="num">${fmtTime(v.t)}</td><td class="num">${Math.round(v.dur / 1000)} s</td>
      <td>${p ? 'punto ' + p.n : ''}</td><td class="num">${v.odo != null ? fmtKm(v.odo) : ''}</td>
      <td class="note" title="${esc(v.notes)}">${esc(v.notes)}</td>
      <td class="act"><button data-play="${v.id}">▶</button><button data-vdel="${v.id}">🗑</button></td></tr>`;
  }).join('');
  if (app.curTab === 'vo') $('#countTxt').textContent = `${app.voices.length} note · ${Math.round(app.voices.reduce((a, v) => a + v.dur, 0) / 1000)} s`;
}

function onTableClick(e) {
  const pl = e.target.closest('[data-play]'), del = e.target.closest('[data-vdel]');
  const v = app.voices.find((x) => x.id === (pl?.dataset.play || del?.dataset.vdel || e.target.closest('tr[data-vid]')?.dataset.vid));
  if (!v) return;
  if (pl) { e.stopPropagation(); play(v); return; }
  if (del) { e.stopPropagation(); if (confirm('Eliminare la nota vocale?')) deleteVoice(v.id); return; }
  if (v.lat != null) { setFollow(false); appMap().setView([v.lat, v.lon], Math.max(appMap().getZoom(), 17)); }
  if (app.teleOpen && app.onSelectTime) app.onSelectTime(v.t);
}
