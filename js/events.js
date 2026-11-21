// Segnalazioni: note sul percorso che non sono punti roadbook (traffico, sosta, polizia, meteo…).
// Quelle "con durata" restano aperte finche' non si preme FINE: una barra in mappa lo ricorda
// e ogni 10 minuti l'app avvisa con bip + vibrazione.
/* global L */
import { app, appMap, setFollow } from './app.js';
import { db } from './db.js';
import { iconSVG } from './icons.js';
import { openModal, closeModal } from './wizard.js';
import { beep } from './transit.js';
import { $, uid, esc, fmtTime, fmtKm, toast, vibrate } from './util.js';

const REMIND_MIN = 10;
const evLayer = () => app._evLayer;
const markers = new Map();

export const hms = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const ms2 = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const m = Math.floor(s / 60); return m >= 60 ? hms(ms) : `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const save = () => db.put('kv', app.events, 'events');
const openEvents = () => app.events.filter((e) => e.dur && !e.tEnd);

export async function initEvents() {
  app.events = (await db.get('kv', 'events')) || [];
  app._evLayer = L.featureGroup().addTo(appMap());
  app.events.forEach(drawEvent);
  renderBanner();
  renderEvents();
  $('#signalBtn').onclick = () => openSignal();
  $('#evTable tbody').addEventListener('click', onTableClick);
  // aggiorna i cronometri della barra e ricorda le segnalazioni aperte
  setInterval(() => {
    renderBanner(true);
    for (const e of openEvents()) {
      const min = Math.floor((Date.now() - e.tStart) / 60000);
      const step = Math.floor(min / REMIND_MIN);
      if (step >= 1 && step > (e._reminded || 0)) {
        e._reminded = step;
        beep(880, 220); setTimeout(() => beep(880, 220), 300); vibrate([200, 100, 200]);
        toast(`⏱ ${e.label} ancora aperta da ${min} min: ricordati FINE`, 4000);
      }
    }
  }, 1000);
}

// ---------- nuova segnalazione ----------
export function openSignal() {
  if (app.wizardOpen) return;
  const f = app.gps.fix, now = Date.now();
  const pos = { tStart: now, lat: f?.lat ?? null, lon: f?.lon ?? null, odo: Math.round(app.gps.odo), odoB: Math.round(app.gps.odoB) };
  const list = app.catalog.lists.segnalazioni || [];
  openModal(`
    <div class="sheet-head"><h3>Segnalazione</h3><div class="wz-info">🕑 <b>${fmtTime(now)}</b> · ${f ? '📍 posizione fissata' : '<span style="color:var(--red)">senza GPS</span>'}</div><div class="spacer"></div><button id="x">✕</button></div>
    <div class="sheet-body">
      <div class="grid">${list.map((it) => `<button class="opt" data-id="${esc(it.id)}">${iconSVG(it.icon, 48)}<span>${esc(it.label)}</span>${it.dur ? '<small class="muted">con durata</small>' : ''}</button>`).join('')}</div>
      <p class="muted small">Le segnalazioni con durata partono subito: chiudile con FINE dalla barra in alto.</p>
    </div>`);
  $('#x').onclick = closeModal;
  document.querySelectorAll('#sheet .opt').forEach((b) => b.onclick = async () => {
    const it = list.find((x) => x.id === b.dataset.id);
    const ev = { id: uid(), n: app.events.reduce((m, x) => Math.max(m, x.n), 0) + 1, typeId: it.id, label: it.label, icon: it.icon, dur: !!it.dur, ...pos, tEnd: null, notes: '' };
    if (ev.dur) {
      closeModal();
      await addEvent(ev);
      toast(`⏱ ${ev.label} iniziata – premi FINE quando finisce`, 2500);
    } else {
      editNotes(ev, true);
    }
  });
}

async function addEvent(ev) {
  app.events.push(ev);
  await save();
  drawEvent(ev); renderBanner(); renderEvents();
  vibrate(60);
}

export async function endEvent(id) {
  const e = app.events.find((x) => x.id === id);
  if (!e || e.tEnd) return;
  const f = app.gps.fix;
  Object.assign(e, { tEnd: Date.now(), latEnd: f?.lat ?? null, lonEnd: f?.lon ?? null, odoEnd: Math.round(app.gps.odo), odoBEnd: Math.round(app.gps.odoB) });
  delete e._reminded;
  await save();
  drawEvent(e); renderBanner(); renderEvents();
  vibrate(60);
  toast(`✔ ${e.label}: ${hms(e.tEnd - e.tStart)}`, 2000);
}

// note (anche per le segnalazioni istantanee appena create)
function editNotes(ev, isNew) {
  const chips = ev.typeId === 'meteo' ? ['Pioggia', 'Pioggia forte', 'Nebbia', 'Neve', 'Ghiaccio', 'Vento forte', 'Sole basso', 'Grandine']
    : ['Lento', 'Fermo', 'Coda', 'Controllo documenti', 'Rallentamento', 'Senso unico alternato'];
  openModal(`
    <div class="sheet-head"><h3>${iconSVG(ev.icon, 28)} ${esc(ev.label)}</h3><div class="wz-info">${fmtTime(ev.tStart)}${ev.tEnd ? ' – ' + fmtTime(ev.tEnd) + ' (' + hms(ev.tEnd - ev.tStart) + ')' : ev.dur ? ' · in corso' : ''}</div><div class="spacer"></div><button id="x">✕</button></div>
    <div class="sheet-body">
      <textarea id="evN" placeholder="Note (facoltative)">${esc(ev.notes)}</textarea>
      <div class="chips">${chips.map((c) => `<button class="chip-q">${c}</button>`).join('')}</div>
    </div>
    <div class="sheet-foot">${isNew ? '' : '<button id="evDel">🗑 Elimina</button>'}<div class="spacer"></div><button id="evOk" class="btn-main">✔ Salva</button></div>`);
  const ta = $('#evN');
  document.querySelectorAll('#sheet .chip-q').forEach((c) => c.onclick = () => { ta.value = (ta.value ? ta.value.trimEnd() + ', ' : '') + c.textContent; });
  $('#x').onclick = closeModal;
  $('#evOk').onclick = async () => {
    ev.notes = ta.value.trim();
    closeModal();
    if (isNew) { await addEvent(ev); toast(`✔ ${ev.label}`, 1500); }
    else { await save(); drawEvent(ev); renderEvents(); }
  };
  if (!isNew) $('#evDel').onclick = async () => {
    if (!confirm('Eliminare la segnalazione?')) return;
    app.events = app.events.filter((x) => x.id !== ev.id);
    await save();
    const m = markers.get(ev.id); if (m) { evLayer().removeLayer(m); markers.delete(ev.id); }
    closeModal(); renderBanner(); renderEvents();
  };
}

// ---------- barra "in corso" ----------
function renderBanner(tickOnly) {
  const box = $('#evBanner');
  const open = openEvents();
  $('#signalBadge').textContent = open.length ? open.length : '';
  const setH = () => document.documentElement.style.setProperty('--evh', (open.length ? box.offsetHeight + 8 : 0) + 'px');
  if (!open.length) { box.classList.add('hidden'); box.innerHTML = ''; setH(); return; }
  box.classList.remove('hidden');
  if (tickOnly && box.children.length === open.length) {
    open.forEach((e) => { const t = box.querySelector(`[data-t="${e.id}"]`); if (t) t.textContent = ms2(Date.now() - e.tStart); });
    return;
  }
  box.innerHTML = open.map((e) => `
    <div class="evb">${iconSVG(e.icon, 26)}<span class="evl" data-note="${e.id}">${esc(e.label)}</span><b data-t="${e.id}">${ms2(Date.now() - e.tStart)}</b>
    <button data-end="${e.id}" class="btn-warn">FINE</button></div>`).join('');
  box.querySelectorAll('[data-end]').forEach((b) => b.onclick = () => endEvent(b.dataset.end));
  box.querySelectorAll('[data-note]').forEach((b) => b.onclick = () => { const e = app.events.find((x) => x.id === b.dataset.note); if (e) editNotes(e, false); });
  setH();
}

// ---------- mappa ----------
function drawEvent(e) {
  let m = markers.get(e.id);
  if (e.lat == null) return;
  const tip = `${esc(e.label)} · ${fmtTime(e.tStart)}${e.tEnd ? ' – ' + fmtTime(e.tEnd) + ' (' + hms(e.tEnd - e.tStart) + ')' : e.dur ? ' · in corso' : ''}${e.notes ? '<br>' + esc(e.notes) : ''}`;
  const icon = L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14], html: `<div class="ev-ic">${iconSVG(e.icon, 28)}</div>` });
  if (!m) {
    m = L.marker([e.lat, e.lon], { icon }).addTo(evLayer());
    m.on('click', () => { const ev = app.events.find((x) => x.id === e.id); if (ev) editNotes(ev, false); });
    markers.set(e.id, m);
  } else m.setIcon(icon);
  m.bindTooltip(tip, { direction: 'top', offset: [0, -12] });
}

// ---------- tabella ----------
export function renderEvents() {
  const tb = $('#evTable tbody');
  if (!tb) return;
  const list = [...app.events].sort((a, b) => a.tStart - b.tStart);
  tb.innerHTML = list.map((e) => `
    <tr data-eid="${e.id}" class="${e.dur && !e.tEnd ? 'pending' : ''}">
      <td class="num">${e.n}</td><td class="ic">${iconSVG(e.icon, 22)}</td><td>${esc(e.label)}</td>
      <td class="num">${fmtTime(e.tStart)}</td><td class="num">${e.tEnd ? fmtTime(e.tEnd) : e.dur ? 'in corso' : ''}</td>
      <td class="num">${e.tEnd ? hms(e.tEnd - e.tStart) : ''}</td>
      <td class="num">${fmtKm(e.odo)}</td><td class="num">${e.odoEnd != null ? fmtKm(e.odoEnd - e.odo) : ''}</td>
      <td class="note" title="${esc(e.notes)}">${esc(e.notes)}</td>
      <td class="act">${e.dur && !e.tEnd ? `<button data-end="${e.id}" class="btn-warn">FINE</button>` : ''}<button data-ed="${e.id}">✎</button></td>
    </tr>`).join('');
  if (app.curTab === 'ev') $('#countTxt').textContent = `${app.events.length}${openEvents().length ? ` · ${openEvents().length} in corso` : ''}`;
}

function onTableClick(ev) {
  const end = ev.target.closest('[data-end]'), ed = ev.target.closest('[data-ed]');
  if (end) { ev.stopPropagation(); endEvent(end.dataset.end); return; }
  const e = app.events.find((x) => x.id === (ed?.dataset.ed || ev.target.closest('tr[data-eid]')?.dataset.eid));
  if (!e) return;
  if (ed) { ev.stopPropagation(); editNotes(e, false); return; }
  if (e.lat != null) { setFollow(false); appMap().setView([e.lat, e.lon], Math.max(appMap().getZoom(), 17)); markers.get(e.id)?.openTooltip(); }
}

