// Impostazioni, editor liste, esportazioni, trip
import { app, savePrefs, saveSession, getState, loadRefTrack, clearRefTrack, resetSession, restoreBackup, showTrips, recomputeTransits } from './app.js';
import { saveCatalog, resetCatalog, LIST_TITLES, FLOWS, slug } from './catalog.js';
import { iconSVG, ICON_GALLERY, fileToIconDataUrl } from './icons.js';
import { openModal, closeModal } from './wizard.js';
import { buildXLSX, buildKMZ, buildGeotoolKMZ, buildPhotosZip, buildGPX, buildBackup, readBackup } from './export.js';
import { storageInfo } from './db.js';
import { $, esc, toast, download, fmtKm } from './util.js';

const CAT_LISTS = ['box_classico', 'non_box', 'sport_rally', 'sport_reg']; // liste che possono avere finestre successive

// ======================= TRIP =======================
export function openTripDialog(which = 'A') {
  const cur = which === 'B' ? app.gps.odoB : app.gps.odo;
  openModal(`
    <div class="sheet-head"><h3>Trip ${which}</h3><div class="spacer"></div><button id="x">✕</button></div>
    <div class="sheet-body">
      <p class="wz-info">Valore attuale: <b>${fmtKm(cur)} km</b></p>
      <div class="row"><button id="tz" class="btn-warn" style="padding:16px 22px;font-size:18px">Azzera trip ${which}</button></div>
      <div class="row"><input id="tv" class="big-input" type="text" inputmode="decimal" placeholder="km"><button id="ts">Imposta</button></div>
      <p class="muted small">Ogni punto salva Trip A e Trip B del momento del clic. Es.: A per il settore, B per parziali.</p>
      ${tripOptionsHtml()}
    </div>`);
  bindTripOptions();
  $('#x').onclick = closeModal;
  $('#tz').onclick = () => { app.gps.setOdo(0, which); closeModal(); toast(`Trip ${which} azzerato`); };
  $('#ts').onclick = () => {
    const v = parseFloat($('#tv').value.replace(',', '.'));
    if (isNaN(v)) return;
    app.gps.setOdo(v * 1000, which); closeModal(); toast(`Trip ${which} impostato a ` + v.toFixed(2));
  };
}

// opzioni comuni ai due trip (anche in Impostazioni → GPS)
function tripOptionsHtml() {
  return `<div class="sec"><h4>Opzioni trip (valgono per A e B)</h4>
    <div class="row">Taratura <input id="tcal" type="text" inputmode="decimal" value="${Number(app.prefs.tripCal) || 0}" style="width:80px"> metri al km
      <button id="tcalOk">Applica</button></div>
    <p class="muted small">Positivo = il trip conta di più (es. 5 se il GPS segna 995 m su 1000). Vale da ora in avanti, non ricalcola i km già fatti. 0 = nessuna correzione.</p>
    <div class="row"><label><input type="checkbox" id="tdec" ${app.prefs.tripDec === 3 ? 'checked' : ''}> Mostra 3 decimali (metri)</label></div></div>`;
}
function bindTripOptions() {
  $('#tcalOk').onclick = () => {
    const v = parseFloat($('#tcal').value.replace(',', '.'));
    if (isNaN(v) || Math.abs(v) > 100) { toast('Valore non valido (da -100 a 100)'); return; }
    app.prefs.tripCal = v; app.gps.cal = v; savePrefs();
    toast(v ? `Taratura: ${v > 0 ? '+' : ''}${v} m/km` : 'Taratura disattivata');
  };
  $('#tdec').onchange = () => { app.prefs.tripDec = $('#tdec').checked ? 3 : 2; savePrefs(); showTrips(); };
}

// ======================= ESPORTA =======================
export function openExport() {
  const s = getState();
  const mb = s.photos.reduce((a, f) => a + (f.size || 0), 0) / 1048576;
  openModal(`
    <div class="sheet-head"><h3>Esporta</h3><div class="wz-info">${s.points.length} punti · ${s.photos.length} foto (${mb.toFixed(1)} MB) · traccia REC ${s.track.filter((t) => t.rec !== false).length} punti (telemetria ${s.track.length}) · ${(s.transits || []).length} passaggi · ${(s.events || []).length} segnalazioni · ${(s.voices || []).length} note vocali</div><div class="spacer"></div><button id="x">✕</button></div>
    <div class="sheet-body">
      <div class="grid big">
        <button class="opt" data-e="kmz">🌍<span>KMZ completo</span><small class="muted">traccia, punti, foto, audio</small></button>
        <button class="opt" data-e="geotool">🧭<span>KMZ per GeoTool</span><small class="muted">traccia e box, senza foto</small></button>
        <button class="opt" data-e="kmzlite">🗺<span>KMZ senza foto e audio</span><small class="muted">leggero</small></button>
        <button class="opt" data-e="xlsx">📊<span>Excel tabella</span></button>
        <button class="opt" data-e="zip">🖼<span>Foto e audio (ZIP)</span><small class="muted">foto compresse + note vocali</small></button>
        <button class="opt" data-e="gpx">〰<span>GPX traccia</span></button>
        <button class="opt" data-e="backup">💾<span>Backup sessione</span><small class="muted">per altro dispositivo</small></button>
      </div>
      <div class="sec"><h4>Ripristina backup</h4>
        <input type="file" id="bk" accept=".rbz,.zip"> <span class="muted small">sostituisce la sessione attuale</span></div>
      <div class="sec"><h4>Nuova sessione</h4>
        <button id="rst" class="btn-warn">⟲ Reset sessione</button> <span class="muted small">cancella punti, foto e traccia da questo dispositivo</span></div>
    </div>`);
  $('#x').onclick = closeModal;
  document.querySelectorAll('[data-e]').forEach((b) => b.onclick = async () => {
    const kind = b.dataset.e;
    b.disabled = true; const old = b.innerHTML; b.innerHTML = '⏳<span>Preparo…</span>';
    try {
      const st = getState();
      let r;
      if (kind === 'kmz') r = await buildKMZ(st, { photos: true });
      else if (kind === 'kmzlite') r = await buildKMZ(st, { photos: false });
      else if (kind === 'geotool') { r = await buildGeotoolKMZ(st); toast(`🧭 ${r.counts.box} box (di cui ${r.counts.co} CO) · ${r.counts.rapp} km dal trip · ${r.counts.altri} altri punti`, 3500); }
      else if (kind === 'xlsx') r = await buildXLSX(st);
      else if (kind === 'zip') { if (!st.photos.length && !(st.voices || []).length) { toast('Nessuna foto o nota vocale'); return; } r = await buildPhotosZip(st); }
      else if (kind === 'gpx') r = buildGPX(st);
      else if (kind === 'backup') r = await buildBackup(st);
      await shareOrDownload(r);
    } catch (e) { console.error(e); toast('Errore: ' + e.message, 4000); }
    finally { b.disabled = false; b.innerHTML = old; }
  });
  $('#bk').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = await readBackup(f);
      if (!confirm(`Ripristinare "${j.session.name}" con ${j.points.length} punti e ${j.photos.length} foto?\nLa sessione attuale verrà sostituita.`)) return;
      await restoreBackup(j);
    } catch (err) { toast('Backup non valido: ' + err.message, 4000); }
  };
  $('#rst').onclick = () => openReset();
}

// Su Android "condividi" permette di mandare il file su Drive/WhatsApp ecc.; altrimenti scarica
async function shareOrDownload({ blob, name }) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (/Android/i.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] })) {
    if (confirm(`${name}\n\nOK = Condividi (Drive, mail…)\nAnnulla = Salva in Download`)) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
  }
  download(blob, name);
  toast('⇩ ' + name, 2500);
}

function openReset() {
  const s = getState();
  openModal(`
    <div class="sheet-head"><h3>Reset sessione</h3><div class="spacer"></div><button id="x">✕</button></div>
    <div class="sheet-body">
      <p>Verranno cancellati <b>${s.points.length} punti</b>, <b>${s.photos.length} foto</b> e <b>${s.track.length} punti traccia</b>.</p>
      <p>Consiglio: scarica prima il backup.</p>
      <div class="row"><button id="bk">💾 Scarica backup</button></div>
      <div class="row">Scrivi <b>RESET</b> per confermare: <input id="cf" type="text" autocomplete="off" style="width:120px"></div>
    </div>
    <div class="sheet-foot"><button id="no">Annulla</button><div class="spacer"></div><button id="yes" class="btn-warn" disabled>Cancella tutto</button></div>`);
  $('#x').onclick = $('#no').onclick = closeModal;
  $('#bk').onclick = async () => shareOrDownload(await buildBackup(getState()));
  $('#cf').oninput = () => { $('#yes').disabled = $('#cf').value.trim().toUpperCase() !== 'RESET'; };
  $('#yes').onclick = () => resetSession();
}

// ======================= IMPOSTAZIONI =======================
let curTab = 'sessione', curList = 'box_classico';

export function openSettings(tab) {
  if (tab) curTab = tab;
  const tabs = { sessione: 'Sessione', gps: 'GPS / Bluetooth', liste: 'Liste', tasti: 'Tasto e foto', mappa: 'Traccia rif.' };
  openModal(`
    <div class="sheet-head"><h3>Impostazioni</h3><div class="tabs">${Object.entries(tabs).map(([k, v]) => `<button data-t="${k}" class="${k === curTab ? 'on' : ''}">${v}</button>`).join('')}</div><div class="spacer"></div><button id="x">✕</button></div>
    <div class="sheet-body" id="sb"></div>`);
  $('#x').onclick = () => { app.learnKey = null; closeModal(); };
  document.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => openSettings(b.dataset.t));
  ({ sessione: tabSession, gps: tabGps, liste: tabLists, tasti: tabKeys, mappa: tabMap })[curTab]($('#sb'));
}

async function tabSession(el) {
  const si = await storageInfo();
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
  el.innerHTML = `
    <div class="sec"><h4>Nome sessione</h4><div class="row"><input id="sn" type="text" value="${esc(app.session.name)}" style="flex:1"><button id="ss">Salva</button></div>
      <p class="muted small">Usato nel nome dei file esportati.</p></div>
    <div class="sec"><h4>Modalità</h4><p class="muted small">Rally / Regolarità / Evento si cambiano anche dalla barra in alto. Ogni punto ricorda la modalità con cui è stato preso.</p></div>
    <div class="sec"><h4>Archivio sul dispositivo</h4>
      <p class="st">${si ? `Usati ${si.usedMB.toFixed(1)} MB su ${(si.quotaMB / 1024).toFixed(1)} GB disponibili` : 'Informazione non disponibile'}<br>
      Archivio protetto dalla pulizia automatica: <b>${persisted ? 'sì' : 'no'}</b>${persisted ? '' : ' (installa l\'app sulla schermata Home per proteggerlo)'}</p>
      <p class="muted small">Tutto resta salvato anche chiudendo l'app, finché non fai Reset.</p></div>
    <div class="sec"><h4>Info</h4><p class="st">RB Rilevamenti · versione ${window.RB_VERSION || ''}</p></div>`;
  $('#ss').onclick = async () => { app.session.name = $('#sn').value.trim() || 'Rilievo'; await saveSession(); toast('Salvato'); };
}

function tabGps(el) {
  const st = app.gps.status;
  const lab = { on: '🟢 attivo', wait: '🟡 in attesa', err: '🔴 errore', off: '⚪ spento' };
  el.innerHTML = `
    <div class="sec"><h4>GPS interno</h4><p class="st">${lab[st.internal]}</p></div>
    <div class="sec"><h4>RaceBox (Bluetooth LE)</h4>
      <div class="row"><button id="rbC">🔗 Collega RaceBox</button><button id="rbD">Scollega</button><span class="st">${lab[st.racebox]}${app.gps.rbInfo ? ` · ${esc(app.gps.rbInfo.name)} · 🔋${app.gps.rbInfo.battery}% · ${app.gps.rbInfo.sats} sat` : ''}</span></div>
      <p class="muted small">Funziona con Chrome/Edge su Android e Windows. Quando il RaceBox dà la posizione, il GPS interno viene ignorato.</p></div>
    <div class="sec"><h4>Garmin GLO / ricevitori NMEA (Bluetooth seriale)</h4>
      <div class="row"><button id="glC">🔗 Collega ricevitore</button><button id="glD">Scollega</button><span class="st">${lab[st.nmea]}</span></div>
      <p class="muted small">Il GLO usa il Bluetooth "classico": prima abbinalo dalle impostazioni Bluetooth del dispositivo, poi premi Collega e scegli la porta.
      Su Windows (Surface) funziona con Chrome/Edge. Su Android serve una versione recente di Chrome con porta seriale: se non c'è, appare un messaggio.</p></div>
    ${tripOptionsHtml()}
    <div class="sec"><h4>Correzione gallerie</h4>
      <div class="row"><label><input type="checkbox" id="tfix" ${app.prefs.tunnelFix !== false ? 'checked' : ''}> Quando il GPS si perde e si riprende, misura la strada vera invece della linea dritta</label></div>
      <p class="muted small">Usa la traccia di riferimento (anche senza rete); se manca, il percorso stradale OpenStreetMap (serve rete). Corregge solo se il risultato è credibile. Correzioni fatte: <b>${(app.corrections || []).length}</b> (foglio "Gallerie" in Excel).</p></div>
    <div class="sec"><h4>Simulatore</h4>
      <div class="row"><button id="sim">${st.sim === 'on' ? '⏹ Ferma simulatore' : '▶ Avvia simulatore'}</button></div>
      <p class="muted small">Muove una posizione finta: serve per provare l'app senza guidare.</p></div>`;
  const wrap = (fn) => async () => { try { await fn(); } catch (e) { if (e.name !== 'NotFoundError') toast(e.message, 4500); } setTimeout(() => tabGps(el), 300); };
  $('#rbC').onclick = wrap(() => app.gps.connectRacebox());
  $('#rbD').onclick = wrap(() => app.gps.disconnectRacebox());
  $('#glC').onclick = wrap(() => app.gps.connectSerial());
  $('#glD').onclick = wrap(() => app.gps.disconnectSerial());
  bindTripOptions();
  $('#tfix').onchange = () => { app.prefs.tunnelFix = $('#tfix').checked; savePrefs(); };
  $('#sim').onclick = wrap(() => app.gps.toggleSim(app.gps.status.sim !== 'on', app.gps.fix));
}

function tabKeys(el) {
  const k = app.prefs.captureKey || 'any';
  const q = app.prefs.photoQuality || { side: 1920, q: 0.75 };
  el.innerHTML = `
    <div class="sec"><h4>Tasto per rilevare un punto</h4>
      <p class="st">Attuale: <b>${k === 'any' ? 'qualsiasi tasto' : esc(k === ' ' ? 'Spazio' : k)}</b></p>
      <div class="row"><button id="lk">🎯 Impara tasto (premi il telecomando)</button><button id="ak">Qualsiasi tasto</button></div>
      <p class="muted small">Va bene un telecomando/pulsantiera Bluetooth che si presenta come tastiera. Su Android i tasti volume non arrivano all'app: usa telecomandi che mandano Invio, Spazio, frecce o lettere.
      Se premi il tasto mentre è aperta una finestra, il nuovo punto va in coda e lo classifichi dopo.</p></div>
    <div class="sec"><h4>Tasto per le segnalazioni (facoltativo)</h4>
      <p class="st">Attuale: <b>${app.prefs.eventKey ? esc(app.prefs.eventKey === ' ' ? 'Spazio' : app.prefs.eventKey) : 'nessuno (solo dallo schermo)'}</b></p>
      <div class="row"><button id="lk2">🎯 Impara tasto segnalazioni</button><button id="nk2">Nessuno</button></div>
      <p class="muted small">Se lo imposti, quel tasto apre le segnalazioni invece di rilevare un punto.</p></div>
    <div class="sec"><h4>Foto</h4>
      <div class="row">Lato massimo <select id="qs">${[1280, 1600, 1920, 2560].map((v) => `<option ${v === q.side ? 'selected' : ''}>${v}</option>`).join('')}</select> px
      · qualità <select id="qq">${[0.6, 0.7, 0.75, 0.85].map((v) => `<option ${v === q.q ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="row"><label><input type="checkbox" id="cf" ${app.prefs.camera === 'file' ? 'checked' : ''}> Su PC/tablet usa il selettore file invece della fotocamera interna</label></div>
      <p class="muted small">Con 1920 px e qualità 0.75 una foto pesa circa 300–500 kB.</p></div>`;
  $('#lk').onclick = () => {
    $('#lk').textContent = '… premi ora il tasto';
    app.learnKey = (key) => { app.prefs.captureKey = key; app.learnKey = null; savePrefs(); toast('Tasto impostato: ' + (key === ' ' ? 'Spazio' : key)); tabKeys(el); };
  };
  $('#lk2').onclick = () => {
    $('#lk2').textContent = '… premi ora il tasto';
    app.learnKey = (key) => { app.prefs.eventKey = key; app.learnKey = null; savePrefs(); toast('Tasto segnalazioni: ' + (key === ' ' ? 'Spazio' : key)); tabKeys(el); };
  };
  $('#nk2').onclick = () => { app.prefs.eventKey = ''; savePrefs(); tabKeys(el); };
  $('#ak').onclick = () => { app.prefs.captureKey = 'any'; savePrefs(); tabKeys(el); };
  $('#qs').onchange = $('#qq').onchange = () => { app.prefs.photoQuality = { side: +$('#qs').value, q: +$('#qq').value }; savePrefs(); };
  $('#cf').onchange = () => { app.prefs.camera = $('#cf').checked ? 'file' : ''; savePrefs(); };
}

function tabMap(el) {
  el.innerHTML = `
    <div class="sec"><h4>Traccia di riferimento</h4>
      <p class="muted small">Carica il percorso della gara (GPX, KML o KMZ, anche quello del GeoTool) per vederlo in mappa mentre rilevi.</p>
      <div class="row"><input type="file" id="rf" accept=".gpx,.kml,.kmz"><button id="rc">Rimuovi</button></div></div>
    <div class="sec"><h4>Passaggi automatici</h4>
      <p class="st">Punti nel file di riferimento: <b>${app.refPoints.length}</b> · passaggi registrati: <b>${app.transits.length}</b></p>
      <div class="row"><button id="atRe">⟲ Calcola passaggi dalla registrazione</button><span class="muted small">per giri fatti prima di caricare la traccia (non crea doppioni)</span></div>
      <div class="row"><label><input type="checkbox" id="atOn" ${app.prefs.autoTransit !== false ? 'checked' : ''}> Registra da solo l'orario quando passo su un punto</label></div>
      <div class="row">Raggio <input id="atR" type="number" min="5" max="300" step="5" value="${app.prefs.transitRadius || 30}" style="width:80px"> m</div>
      <p class="muted small">Il passaggio vale nel momento in cui sei più vicino al punto (dentro il raggio). Puoi passare più volte sullo stesso punto. L'app deve restare aperta con lo schermo acceso.</p></div>
    <div class="sec"><h4>Mappe</h4><p class="muted small">Le mappe si scelgono dal pulsante livelli in alto a destra (stesse del GeoTool). Le zone già viste restano in memoria per l'uso senza rete.</p></div>`;
  $('#rf').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      await loadRefTrack(f); closeModal(); toast('Traccia caricata');
      if (app.refPoints.length && app.track.length && confirm(`Traccia caricata con ${app.refPoints.length} punti.\nCalcolo i passaggi anche sulla registrazione già fatta?`)) {
        const n = await recomputeTransits(); toast(n ? `⏱ ${n} passaggi trovati nella registrazione` : 'Nessun nuovo passaggio nella registrazione', 3000);
      }
    } catch (err) { toast('File non letto: ' + err.message, 4000); }
  };
  $('#atRe').onclick = async () => { const n = await recomputeTransits(); toast(n ? `⏱ ${n} passaggi trovati nella registrazione` : 'Nessun nuovo passaggio', 3000); tabMap(el); };
  $('#rc').onclick = async () => { await clearRefTrack(); toast('Traccia rimossa'); };
  $('#atOn').onchange = () => { app.prefs.autoTransit = $('#atOn').checked; savePrefs(); };
  $('#atR').onchange = () => { const v = +$('#atR').value; if (v >= 5) { app.prefs.transitRadius = v; savePrefs(); } };
}

// ---------- Editor liste ----------
function tabLists(el) {
  const lists = app.catalog.lists;
  const items = lists[curList] || [];
  const canFlow = CAT_LISTS.includes(curList);
  el.innerHTML = `
    <div class="row"><select id="ls">${Object.keys(LIST_TITLES).map((k) => `<option value="${k}" ${k === curList ? 'selected' : ''}>${esc(LIST_TITLES[k])}</option>`).join('')}</select>
      <div class="spacer"></div><button id="lr">Ripristina liste originali</button></div>
    <div id="items">${items.map((it, i) => `
      <div class="li" data-i="${i}">
        <button class="ic-btn" data-ic="${i}" title="Cambia simbolo">${iconSVG(it.icon, 36)}</button>
        <input type="text" value="${esc(it.label)}" data-lb="${i}">
        ${curList === 'segnalazioni' ? `<label class="small"><input type="checkbox" data-du="${i}" ${it.dur ? 'checked' : ''}> durata</label>` : ''}
        ${canFlow ? `<select data-fl="${i}">${Object.entries(FLOWS).map(([k, f]) => `<option value="${k}" ${(it.flow || '') === k ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select>` : ''}
        <button data-up="${i}">▲</button><button data-dn="${i}">▼</button><button data-rm="${i}">🗑</button>
      </div>`).join('')}</div>
    <div class="row"><input type="text" id="nl" placeholder="Nuova voce…" style="flex:1"><button id="na">＋ Aggiungi</button></div>
    <div id="gal"></div>
    <p class="muted small">Le modifiche valgono per i prossimi punti. I punti già presi mantengono la loro descrizione.</p>`;
  const save = () => { saveCatalog(app.catalog); };
  $('#ls').onchange = () => { curList = $('#ls').value; tabLists(el); };
  $('#lr').onclick = () => { if (confirm('Ripristinare tutte le liste originali?')) { app.catalog = resetCatalog(); tabLists(el); } };
  el.querySelectorAll('[data-lb]').forEach((inp) => inp.onchange = () => { items[+inp.dataset.lb].label = inp.value.trim() || items[+inp.dataset.lb].label; save(); });
  el.querySelectorAll('[data-du]').forEach((c) => c.onchange = () => { items[+c.dataset.du].dur = c.checked; save(); });
  el.querySelectorAll('[data-fl]').forEach((s) => s.onchange = () => { items[+s.dataset.fl].flow = s.value; save(); });
  el.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => { const i = +b.dataset.up; if (i > 0) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; save(); tabLists(el); } });
  el.querySelectorAll('[data-dn]').forEach((b) => b.onclick = () => { const i = +b.dataset.dn; if (i < items.length - 1) { [items[i + 1], items[i]] = [items[i], items[i + 1]]; save(); tabLists(el); } });
  el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { const i = +b.dataset.rm; if (confirm(`Togliere "${items[i].label}"?`)) { items.splice(i, 1); save(); tabLists(el); } });
  el.querySelectorAll('[data-ic]').forEach((b) => b.onclick = () => iconPicker(+b.dataset.ic));
  $('#na').onclick = () => {
    const label = $('#nl').value.trim(); if (!label) return;
    let id = slug(label); while (items.some((x) => x.id === id)) id += '_';
    items.push({ id, label, icon: 'text:' + label.slice(0, 3).toUpperCase(), flow: '' });
    lists[curList] = items; save(); tabLists(el);
  };

  function iconPicker(i) {
    const g = $('#gal');
    g.innerHTML = `<div class="sec"><h4>Simbolo per "${esc(items[i].label)}"</h4>
      <div class="gallery">${ICON_GALLERY.map((s) => `<button data-s="${esc(s)}">${iconSVG(s, 40)}</button>`).join('')}</div>
      <div class="row">Testo/sigla <input id="ct" type="text" maxlength="5" style="width:90px"> colore <input id="cc" type="color" value="#c62828"><button id="cb">Usa sigla</button>
      · Emoji <input id="ce" type="text" style="width:70px"><button id="cm">Usa emoji</button></div>
      <div class="row">Logo da immagine (PNG, SVG, JPG) <input id="ci" type="file" accept="image/*,.svg"></div></div>`;
    g.scrollIntoView({ behavior: 'smooth' });
    const set = (spec) => { items[i].icon = spec; save(); tabLists(el); };
    g.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => set(b.dataset.s));
    $('#cb').onclick = () => { const t = $('#ct').value.trim().toUpperCase(); if (t) set(`badge:${t}:${$('#cc').value}`); };
    $('#cm').onclick = () => { const t = $('#ce').value.trim(); if (t) set(`emoji:${t}`); };
    $('#ci').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { set('img:' + await fileToIconDataUrl(f, 128)); } catch (err) { toast('Immagine non letta: ' + err.message, 4000); }
    };
  }
}

