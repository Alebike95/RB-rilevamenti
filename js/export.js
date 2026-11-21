// Esportazioni: Excel, KMZ completo, ZIP foto, GPX traccia
/* global XLSX, JSZip */
import { fmtTime, fmtDate, fmtStamp, pointLabel, pointType, pointIcon, esc } from './util.js';
import { iconPngBlob } from './icons.js';
import { MODES } from './catalog.js';

const xmlEsc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const r6 = (v) => (v == null ? '' : Math.round(v * 1e6) / 1e6);
const km = (m) => (m == null || m === '' ? '' : Math.round(m) / 1000);

const audioExt = (mime) => (/mp4|aac/.test(mime || '') ? 'm4a' : /ogg/.test(mime || '') ? 'ogg' : 'webm');
export function voiceName(v, points) {
  const p = v.pointId && points.find((x) => x.id === v.pointId);
  return `${fmtStamp(v.t)}${p ? '_P' + p.n : ''}_voce.${audioExt(v.mime)}`;
}

export function photoName(ph, points) {
  const p = ph.pointId && points.find((x) => x.id === ph.pointId);
  return `${fmtStamp(ph.t)}${p ? '_P' + p.n : ''}.jpg`;
}

function baseName(session) {
  const n = (session.name || 'rilievo').replace(/[^\w\-]+/g, '_');
  return `${n}_${fmtStamp(Date.now())}`;
}

// Traccia da esportare: quella registrata con REC; se REC non e' mai stato acceso,
// il percorso della registrazione in sottofondo (senza i punti poco precisi), cosi' la traccia c'e' sempre
function exportTrack(state) {
  const rec = state.track.filter((t) => t.rec !== false);
  if (rec.length >= 2) return rec;
  return state.track.filter((t) => t.acc == null || t.acc <= 15).map((t) => ({ ...t, seg: 1 }));
}

// ---------------- EXCEL ----------------
// coordinate: gradi decimali (5 cifre) e gradi + primi con 3 decimali (es. N 46 15.324)
const dec5 = (v) => (v == null ? '' : Math.round(v * 1e5) / 1e5);
const decTxt = (v) => v.toFixed(5).replace('.', ',');
function gpm(v, isLat) {
  if (v == null) return '';
  const h = isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
  const a = Math.abs(v);
  let d = Math.floor(a), m = Math.round((a - d) * 60 * 1000) / 1000;
  if (m >= 60) { d += 1; m -= 60; }
  return `${h} ${d} ${m.toFixed(3).padStart(6, '0')}`;
}
function coordCols(lat, lon) {
  const ok = lat != null && lon != null;
  return {
    'Lat': dec5(lat),
    'Lon': dec5(lon),
    'Lat Lon (gradi decimali)': ok ? `${decTxt(lat)} ${decTxt(lon)}` : '',
    'Lat GPM': gpm(lat, true),
    'Lon GPM': gpm(lon, false),
    'Lat Lon (GPM)': ok ? `${gpm(lat, true)}, ${gpm(lon, false)}` : ''
  };
}

// formato numerico 5 decimali sulle colonne Lat/Lon
function fmtCoordCells(ws) {
  if (!ws['!ref']) return;
  const r = XLSX.utils.decode_range(ws['!ref']);
  for (let c = r.s.c; c <= r.e.c; c++) {
    const h = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (!h || (h.v !== 'Lat' && h.v !== 'Lon')) continue;
    for (let row = 1; row <= r.e.r; row++) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c })];
      if (cell && cell.t === 'n') cell.z = '0.00000';
    }
  }
}

function autoCols(rows) {
  if (!rows.length) return [];
  return Object.keys(rows[0]).map((k) => ({ wch: Math.min(40, Math.max(k.length + 3, ...rows.slice(0, 500).map((r) => String(r[k] ?? '').length + 1))) }));
}

const gmaps = (lat, lon) => (lat == null || lon == null ? '' : `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`);

// colonna "Google Maps": testo "Apri" con collegamento alla posizione
function linkCells(ws) {
  if (!ws['!ref']) return;
  const r = XLSX.utils.decode_range(ws['!ref']);
  for (let c = r.s.c; c <= r.e.c; c++) {
    if (ws[XLSX.utils.encode_cell({ r: 0, c })]?.v !== 'Google Maps') continue;
    for (let row = 1; row <= r.e.r; row++) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c })];
      if (cell && typeof cell.v === 'string' && cell.v.startsWith('http')) { cell.l = { Target: cell.v, Tooltip: 'Apri in Google Maps' }; cell.v = 'Apri'; }
    }
  }
}

function addSheet(wb, name, rows) {
  // celle vuote = nessuna cella (Excel non gradisce le stringhe vuote nelle tabelle)
  rows = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === '' ? null : v])));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = autoCols(rows);
  fmtCoordCells(ws);
  linkCells(ws);
  XLSX.utils.book_append_sheet(wb, ws, name);
  return { name, ws, rows: rows.length };
}

const xe = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// Trasforma ogni foglio in "Tabella" di Excel (stile a bande + filtri in cima).
// SheetJS non lo fa da solo: si aggiungono a mano i file della tabella dentro l'xlsx.
async function addExcelTables(buf, sheets) {
  const zip = await JSZip.loadAsync(buf);
  let ct = await zip.file('[Content_Types].xml').async('string');
  let n = 0;
  for (let i = 0; i < sheets.length; i++) {
    const { name, ws, rows } = sheets[i];
    if (!rows || !ws['!ref']) continue;
    const sheetPath = `xl/worksheets/sheet${i + 1}.xml`;
    const sf = zip.file(sheetPath);
    if (!sf) continue;
    n++;
    const ref = ws['!ref'];
    const range = XLSX.utils.decode_range(ref);
    const cols = [];
    for (let c = range.s.c; c <= range.e.c; c++) cols.push(String(ws[XLSX.utils.encode_cell({ r: 0, c })]?.v ?? `Col${c + 1}`));
    const tname = 'Tab_' + name.replace(/[^A-Za-z0-9_]/g, '_');
    zip.file(`xl/tables/table${n}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${n}" name="${tname}" displayName="${tname}" ref="${ref}" totalsRowShown="0">` +
      `<autoFilter ref="${ref}"/><tableColumns count="${cols.length}">${cols.map((c, k) => `<tableColumn id="${k + 1}" name="${xe(c)}"/>`).join('')}</tableColumns>` +
      `<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`);
    ct = ct.replace('</Types>', `<Override PartName="/xl/tables/table${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>`);
    const relPath = `xl/worksheets/_rels/sheet${i + 1}.xml.rels`;
    const rel = `<Relationship Id="rIdTab${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table${n}.xml"/>`;
    const rf = zip.file(relPath);
    if (rf) zip.file(relPath, (await rf.async('string')).replace('</Relationships>', rel + '</Relationships>'));
    else zip.file(relPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel}</Relationships>`);
    let sx = await sf.async('string');
    if (!/xmlns:r=/.test(sx)) sx = sx.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    sx = sx.replace(/<autoFilter[^>]*\/>/, '');
    const part = `<tableParts count="1"><tablePart r:id="rIdTab${n}"/></tableParts>`;
    sx = sx.includes('<extLst') ? sx.replace('<extLst', part + '<extLst') : sx.replace('</worksheet>', part + '</worksheet>');
    zip.file(sheetPath, sx);
  }
  zip.file('[Content_Types].xml', ct);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
}

export async function buildXLSX(state) {
  const { session, points, photos } = state;
  const track = exportTrack(state); // solo la traccia REC (la telemetria completa va nel backup)
  const rows = points.map((p) => ({
    'N': p.n,
    'Data': fmtDate(p.t),
    'Ora': fmtTime(p.t),
    'Modalità': MODES[p.mode]?.label || p.mode,
    'Tipo': pointType(p),
    'Box roadbook': p.status === 'pending' ? '' : p.isBox ? 'Sì' : 'No',
    'Attività sportiva': p.group === 'sport' ? 'Sì' : '',
    'Categoria': p.category?.label || '',
    'Dettaglio 1': p.details?.[0]?.label || '',
    'Dettaglio 2': p.details?.[1]?.label || '',
    'Descrizione': pointLabel(p),
    'Trip A (km)': km(p.odo),
    'Trip B (km)': km(p.odoB),
    'Km rilevato': p.kmRil ?? '',
    'Note': p.notes || '',
    ...coordCols(p.lat, p.lon),
    'Google Maps': gmaps(p.lat, p.lon),
    'Precisione (m)': p.acc != null ? Math.round(p.acc * 10) / 10 : '',
    'Velocità (km/h)': p.speed != null ? Math.round(p.speed) : '',
    'Direzione (°)': p.heading != null ? Math.round(p.heading) : '',
    'Sorgente GPS': p.manual ? 'manuale (mappa)' : p.src || '',
    'Foto': photos.filter((f) => f.pointId === p.id).map((f) => photoName(f, points)).join(', '),
    'Note vocali': (state.voices || []).filter((v) => v.pointId === p.id).map((v) => voiceName(v, points)).join(', ')
  }));
  const wb = XLSX.utils.book_new();
  const sheets = [];
  sheets.push(addSheet(wb, 'Punti', rows.length ? rows : [{ N: '' }]));
  if (!rows.length) sheets[0].rows = 0;

  const fr = photos.map((f) => ({
    'File': photoName(f, points), 'Data': fmtDate(f.t), 'Ora': fmtTime(f.t),
    'Punto N': points.find((x) => x.id === f.pointId)?.n ?? '',
    'Trip A (km)': km(f.odo), 'Trip B (km)': km(f.odoB), ...coordCols(f.lat, f.lon), 'Google Maps': gmaps(f.lat, f.lon), 'Note': f.notes || ''
  }));
  if (fr.length) sheets.push(addSheet(wb, 'Foto', fr));

  // passaggi automatici sui punti di riferimento
  const tl = [...(state.transits || [])].sort((a, b) => a.t - b.t);
  const sec = (ms) => Math.round(ms / 1000) * 1000;
  const hms = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const evs = [...(state.events || [])].sort((a, b) => a.tStart - b.tStart);
  // segnalazioni avvenute tra il passaggio precedente e questo + tempo perso (sovrapposizione delle durate)
  const inLeg = (t0, t1) => {
    let lost = 0; const names = [];
    for (const e of evs) {
      const end = e.dur ? (e.tEnd || Date.now()) : e.tStart;
      if (end < t0 || e.tStart > t1) continue;
      if (e.dur) { const o = Math.min(end, t1) - Math.max(e.tStart, t0); lost += Math.max(0, o); names.push(`${e.label} ${hms(Math.max(0, o))}${e.tEnd ? '' : ' (aperta)'}`); }
      else names.push(e.label + (e.notes ? ` (${e.notes})` : ''));
    }
    return { lost, names };
  };
  const pr = tl.map((t, i) => {
    const leg = i ? inLeg(tl[i - 1].t, t.t) : { lost: 0, names: [] };
    return {
    'N': t.n, 'Data': fmtDate(t.t), 'Ora passaggio': fmtTime(sec(t.t)), 'Punto': t.name, 'Cartella': t.folder || '',
    'Tempo dal precedente': i ? hms(sec(t.t) - sec(tl[i - 1].t)) : '',
    'Segnalazioni nel tratto': leg.names.join('; '),
    'Tempo perso': leg.lost ? hms(leg.lost) : '',
    'Tempo netto': i && leg.lost ? hms(sec(t.t) - sec(tl[i - 1].t) - leg.lost) : '',
    'Distanza dal punto (m)': t.dist, 'Velocità (km/h)': t.speed != null ? Math.round(t.speed) : '',
    'Trip A (km)': km(t.odo), 'Trip B (km)': km(t.odoB),
    ...coordCols(t.lat, t.lon), 'Google Maps': gmaps(t.lat, t.lon), 'Sorgente GPS': t.src || ''
  }; });
  if (pr.length) sheets.push(addSheet(wb, 'Passaggi', pr));

  const er = evs.map((e) => ({
    'N': e.n, 'Data': fmtDate(e.tStart), 'Tipo': e.label, 'Con durata': e.dur ? 'Sì' : 'No',
    'Inizio': fmtTime(e.tStart), 'Fine': e.tEnd ? fmtTime(e.tEnd) : e.dur ? 'non chiusa' : '',
    'Durata': e.tEnd ? hms(e.tEnd - e.tStart) : '',
    'Trip A inizio (km)': km(e.odo), 'Trip A fine (km)': km(e.odoEnd), 'Km percorsi': e.odoEnd != null && e.odo != null ? km(e.odoEnd - e.odo) : '',
    'Trip B inizio (km)': km(e.odoB), 'Note': e.notes || '',
    ...coordCols(e.lat, e.lon), 'Google Maps': gmaps(e.lat, e.lon)
  }));
  if (er.length) sheets.push(addSheet(wb, 'Segnalazioni', er));

  const vr = (state.voices || []).map((v, i) => ({
    'N': i + 1, 'Data': fmtDate(v.t), 'Ora': fmtTime(v.t), 'Durata (s)': Math.round(v.dur / 1000),
    'File': voiceName(v, points), 'Punto N': points.find((x) => x.id === v.pointId)?.n ?? '',
    'Trip A (km)': km(v.odo), 'Trip B (km)': km(v.odoB), 'Trascrizione': v.notes || '',
    ...coordCols(v.lat, v.lon), 'Google Maps': gmaps(v.lat, v.lon)
  }));
  if (vr.length) sheets.push(addSheet(wb, 'Note vocali', vr));

  const cr = (state.corrections || []).map((c, i) => ({
    'N': i + 1, 'Data': fmtDate(c.t), 'Segnale perso': fmtTime(c.tLost), 'Segnale ripreso': fmtTime(c.t),
    'Linea dritta (m)': c.straight, 'Strada (m)': c.road, 'Aggiunti al trip (m)': c.delta, 'Metodo': c.method,
    ...coordCols(c.latA, c.lonA), 'Google Maps': gmaps(c.latA, c.lonA)
  }));
  if (cr.length) sheets.push(addSheet(wb, 'Gallerie', cr));

  const tr = track.map((t) => ({ 'Tratto': t.seg || 1, 'Ora': fmtTime(t.t), ...coordCols(t.lat, t.lon), 'Alt': t.alt != null ? Math.round(t.alt) : '', 'Vel (km/h)': t.spd != null ? Math.round(t.spd) : '', 'Trip A (km)': km(t.odo) }));
  if (tr.length) sheets.push(addSheet(wb, 'Traccia', tr));

  const info = [
    { Campo: 'Sessione', Valore: session.name || '' },
    { Campo: 'Creata', Valore: `${fmtDate(session.created)} ${fmtTime(session.created)}` },
    { Campo: 'Esportata', Valore: `${fmtDate(Date.now())} ${fmtTime(Date.now())}` },
    { Campo: 'Punti', Valore: points.length },
    { Campo: 'Foto', Valore: photos.length },
    { Campo: 'Punti traccia', Valore: track.length }
  ];
  const infoS = addSheet(wb, 'Info', info); infoS.rows = 0; sheets.push(infoS); // Info senza tabella
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = await addExcelTables(out, sheets);
  return { blob, name: baseName(session) + '.xlsx' };
}

// traccia divisa in tratti (ogni pausa/ripresa = nuovo tratto)
function splitSegments(track) {
  const m = new Map();
  for (const t of track) { const k = t.seg || 1; if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  return [...m.keys()].sort((a, b) => a - b).map((seg) => ({ seg, pts: m.get(seg) }));
}

// ---------------- KMZ ----------------
export async function buildKMZ(state, opts = { photos: true }) {
  const { session, points, photos } = state;
  const track = exportTrack(state);
  const zip = new JSZip();
  const styles = new Map();
  for (const p of points) {
    const spec = pointIcon(p);
    if (!styles.has(spec)) styles.set(spec, 's' + styles.size);
  }
  if (photos.length) styles.set('box:foto', styles.get('box:foto') || 's' + styles.size);
  const events = (state.events || []).filter((e) => e.lat != null);
  const voices = opts.photos ? (state.voices || []) : [];
  if (voices.length) styles.set('box:voce', styles.get('box:voce') || 's' + styles.size);
  // audio: lettore + collegamento al file (Google Earth Pro apre il file se il lettore non parte)
  const audioHtml = (v) => { const n = voiceName(v, points); return `<p>🎙 ${fmtTime(v.t)} (${Math.round(v.dur / 1000)} s)<br/><audio controls src="files/audio/${n}"></audio><br/><a href="files/audio/${n}">Apri audio</a></p>`; };
  for (const v of voices) zip.file(`files/audio/${voiceName(v, points)}`, v.blob);
  for (const e of events) if (!styles.has(e.icon)) styles.set(e.icon, 's' + styles.size);
  for (const [spec, id] of styles) {
    try { zip.file(`files/icons/${id}.png`, await iconPngBlob(spec, 64)); }
    catch (e) { zip.file(`files/icons/${id}.png`, await iconPngBlob('box:default', 64)); }
  }

  const styleXml = [...styles].map(([, id]) =>
    `<Style id="${id}"><IconStyle><scale>1.1</scale><Icon><href>files/icons/${id}.png</href></Icon><hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></IconStyle><LabelStyle><scale>0.8</scale></LabelStyle></Style>`
  ).join('\n');

  const phByPoint = new Map();
  for (const f of photos) if (f.pointId) { const a = phByPoint.get(f.pointId) || []; a.push(f); phByPoint.set(f.pointId, a); }

  const pm = points.filter((p) => p.lat != null).map((p) => {
    const imgs = opts.photos ? (phByPoint.get(p.id) || []).map((f) => `<img src="files/photos/${photoName(f, points)}" width="400"/>`).join('<br/>')
      + voices.filter((v) => v.pointId === p.id).map((v) => audioHtml(v)).join('') : '';
    const rows = [
      ['Ora', `${fmtDate(p.t)} ${fmtTime(p.t)}`], ['Tipo', pointType(p)], ['Descrizione', pointLabel(p)],
      ['Trip A al clic', p.odo != null ? (p.odo / 1000).toFixed(2) + ' km' : ''], ['Trip B al clic', p.odoB != null ? (p.odoB / 1000).toFixed(2) + ' km' : ''], ['Km rilevato', p.kmRil ?? ''],
      ['Note', p.notes || ''], ['Precisione', p.acc != null ? p.acc.toFixed(1) + ' m' : ''], ['Sorgente', p.manual ? 'mappa' : p.src || '']
    ].map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('');
    const ext = [['N', p.n], ['ora', fmtTime(p.t)], ['box', p.isBox ? 'si' : 'no'], ['categoria', p.category?.label || ''],
      ['dettagli', (p.details || []).map((d) => d.label).join(' | ')], ['trip_a_km', p.odo != null ? (p.odo / 1000).toFixed(3) : ''], ['trip_b_km', p.odoB != null ? (p.odoB / 1000).toFixed(3) : ''],
      ['km_rilevato', p.kmRil ?? ''], ['note', p.notes || '']]
      .map(([k, v]) => `<Data name="${k}"><value>${xmlEsc(v)}</value></Data>`).join('');
    return `<Placemark><name>${xmlEsc(p.n + ' ' + pointLabel(p))}</name><TimeStamp><when>${new Date(p.t).toISOString()}</when></TimeStamp>
<description><![CDATA[<table>${rows}</table>${imgs}]]></description><styleUrl>#${styles.get(pointIcon(p))}</styleUrl>
<ExtendedData>${ext}</ExtendedData><Point><coordinates>${p.lon},${p.lat},0</coordinates></Point></Placemark>`;
  }).join('\n');

  let phXml = '';
  if (opts.photos) {
    for (const f of photos) {
      if (f.lat == null) { zip.file(`files/photos/${photoName(f, points)}`, f.blob); continue; }
      const name = photoName(f, points);
      zip.file(`files/photos/${name}`, f.blob);
      phXml += `<Placemark><name>${xmlEsc('Foto ' + fmtTime(f.t))}</name><TimeStamp><when>${new Date(f.t).toISOString()}</when></TimeStamp>
<description><![CDATA[<img src="files/photos/${name}" width="480"/><br/>${esc(f.notes || '')}]]></description><styleUrl>#${styles.get('box:foto')}</styleUrl>
<Point><coordinates>${f.lon},${f.lat},0</coordinates></Point></Placemark>\n`;
    }
  }

  const trackXml = splitSegments(track).filter((s) => s.pts.length > 1).map((s) =>
    `<Placemark><name>Tratto ${s.seg} (${fmtTime(s.pts[0].t)}–${fmtTime(s.pts[s.pts.length - 1].t)})</name><Style><LineStyle><color>ff00a5ff</color><width>4</width></LineStyle></Style><LineString><tessellate>1</tessellate><coordinates>${s.pts.map((t) => `${r6(t.lon)},${r6(t.lat)},0`).join(' ')}</coordinates></LineString></Placemark>`
  ).join('\n');

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEsc(session.name || 'Rilievo')}</name>
${styleXml}
<Folder><name>Traccia</name>${trackXml}</Folder>
<Folder><name>Punti</name>${pm}</Folder>
${phXml ? `<Folder><name>Foto</name>${phXml}</Folder>` : ''}
${voices.filter((v) => v.lat != null).length ? `<Folder><name>Note vocali</name>${voices.filter((v) => v.lat != null).map((v) => `<Placemark><name>${xmlEsc('Nota vocale ' + fmtTime(v.t))}</name><TimeStamp><when>${new Date(v.t).toISOString()}</when></TimeStamp>
<description><![CDATA[${audioHtml(v)}]]></description><styleUrl>#${styles.get('box:voce')}</styleUrl><Point><coordinates>${v.lon},${v.lat},0</coordinates></Point></Placemark>`).join('\n')}</Folder>` : ''}
${events.length ? `<Folder><name>Segnalazioni</name>${events.map((e) => `<Placemark><name>${xmlEsc(e.label + ' ' + fmtTime(e.tStart))}</name><TimeStamp><when>${new Date(e.tStart).toISOString()}</when></TimeStamp>
<description><![CDATA[${esc(e.label)}<br>${fmtTime(e.tStart)}${e.tEnd ? ' – ' + fmtTime(e.tEnd) : ''}<br>${esc(e.notes || '')}]]></description><styleUrl>#${styles.get(e.icon)}</styleUrl><Point><coordinates>${e.lon},${e.lat},0</coordinates></Point></Placemark>`).join('\n')}</Folder>` : ''}
</Document></kml>`;
  zip.file('doc.kml', kml);
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.google-earth.kmz', compression: 'DEFLATE' });
  return { blob, name: baseName(session) + '.kmz' };
}

// ---------------- KMZ PER GEOTOOL ----------------
// Contratto: geotool/docs/FORMATO-KMZ-RILIEVO.md (versione 1). Solo doc.kml: una traccia pulita,
// box con nome = solo numero, CO a parte, altri punti; dati in ExtendedData. Niente foto/audio/segnalazioni.
const GT_FIELDS = ['uid_rilievo', 'n_punto', 'ora', 'gruppo', 'categoria_id', 'categoria', 'dettagli', 'km_rilevato',
  'km_origine', 'trip_a_km', 'trip_b_km', 'note', 'precisione_m', 'sorgente', 'foto'];
const c7 = (v) => Number(v).toFixed(7);

// "Km rilevato" e' stato scritto a volte in km (0.125) a volte in metri (665): si sceglie la lettura
// (km oppure metri/1000) piu' vicina al Trip A o B del momento del clic. Risultato sempre in km.
export function kmRilevatoKm(p) {
  const v = Number(p.kmRil);
  if (p.kmRil == null || p.kmRil === '' || isNaN(v)) return '';
  const refs = [p.odo, p.odoB].filter((x) => x != null && !isNaN(x)).map((x) => x / 1000);
  let km;
  if (!refs.length) km = v >= 300 ? v / 1000 : v;
  else {
    const err = (c) => Math.min(...refs.map((r) => Math.abs(c - r)));
    km = err(v) <= err(v / 1000) ? v : v / 1000;
  }
  return km.toFixed(3);
}

// km dei box (CO compresi) senza km rilevato scritto: si usa il Trip A "rapportato" al rilevato.
// Tra due box con rilevato scritto il trip viene riscalato in modo lineare (media l'errore che si accumula
// sui settori lunghi); prima del primo/dopo l'ultimo si usa il rapporto medio del tratto (o 1).
// Il trip si spezza dove viene azzerato (valore che torna indietro): ogni pezzo fa conto a se'.
// Fanno da riferimento solo i km scritti coerenti col Trip A (scarto <= 100 m + 3%).
// Restituisce Map id -> { km, origine } con origine 'rilevato' | 'trip_rapportato' | 'trip'.
export function kmBoxes(list) {
  const out = new Map();
  const segs = [];
  let cur = [];
  for (const p of list) {
    const tA = p.odo != null ? p.odo / 1000 : null;
    const w = kmRilevatoKm(p);
    if (w !== '') out.set(p.id, { km: w, origine: 'rilevato' });
    if (tA == null) continue;
    if (cur.length && tA < cur[cur.length - 1].tA - 0.01) { segs.push(cur); cur = []; } // trip azzerato
    // un km scritto fa da riferimento solo se e' coerente col Trip A (stesso punto di partenza):
    // es. nei PC di regolarita' si scrive il parziale del Trip B, che col Trip A non c'entra
    const r = w === '' ? null : Number(w);
    const coerente = r != null && Math.abs(r - tA) <= 0.1 + 0.03 * tA;
    cur.push({ p, tA, r: coerente ? r : null, scritto: r != null });
  }
  if (cur.length) segs.push(cur);
  const ok = (f) => f > 0.95 && f < 1.05; // rapporto credibile tra rilevato e trip
  for (const seg of segs) {
    const anc = seg.filter((x) => x.r != null);
    let fAvg = 1;
    if (anc.length >= 2) { const a = anc[0], b = anc[anc.length - 1]; const f = (b.r - a.r) / (b.tA - a.tA); if (b.tA > a.tA && ok(f)) fAvg = f; }
    for (const x of seg) {
      if (x.r != null || x.scritto) continue; // i km scritti restano come sono
      const a = [...anc].reverse().find((y) => y.tA <= x.tA), b = anc.find((y) => y.tA >= x.tA);
      let km = x.tA, origine = 'trip';
      if (a && b && b.tA > a.tA && ok((b.r - a.r) / (b.tA - a.tA))) { km = a.r + (x.tA - a.tA) * (b.r - a.r) / (b.tA - a.tA); origine = 'trip_rapportato'; }
      else if (a) { km = a.r + (x.tA - a.tA) * fAvg; origine = 'trip_rapportato'; }
      else if (b) { km = b.r - (b.tA - x.tA) * fAvg; origine = 'trip_rapportato'; }
      if (km < 0) { km = x.tA; origine = 'trip'; }
      out.set(x.p.id, { km: km.toFixed(3), origine });
    }
  }
  return out;
}

// toglie le parti da fermo all'inizio e alla fine (GPS che "balla" sul posto): si scartano i punti finche'
// la distanza dal primo/ultimo punto non supera 15 m. In mezzo non si tocca niente.
function trimStill(t, m = 15) {
  if (t.length < 3) return t;
  const d = (a, b) => { const k = Math.cos(a.lat * Math.PI / 180) * 111320; return Math.hypot((b.lon - a.lon) * k, (b.lat - a.lat) * 111320); };
  let i = 0; while (i < t.length && d(t[0], t[i]) <= m) i++;
  let e = t.length - 1; while (e >= 0 && d(t[t.length - 1], t[e]) <= m) e--;
  return i <= e ? t.slice(i, e + 1) : t;
}

export function buildGeotoolKMZ(state) {
  const { session, photos } = state;
  const pts = state.points.filter((p) => p.lat != null && p.lon != null && p.src !== 'passaggio').sort((a, b) => a.t - b.t);
  const done = (p) => p.status !== 'pending';
  // i CO sono box come gli altri: CO di inizio settore = box 1, CO di fine = numero piu' alto
  // (si riconoscono da categoria_id = co)
  const boxes = pts.filter((p) => done(p) && p.isBox);
  const cos = boxes.filter((p) => p.category?.id === 'co');
  const others = pts.filter((p) => !done(p) || !p.isBox);
  const kmB = kmBoxes(boxes);
  const nFoto = new Map();
  for (const f of photos) if (f.pointId) nFoto.set(f.pointId, (nFoto.get(f.pointId) || 0) + 1);

  const ext = (p) => {
    const v = {
      uid_rilievo: p.id, n_punto: p.n, ora: new Date(p.t).toISOString(),
      gruppo: p.isBox && done(p) ? (p.group || 'classico') : '',
      categoria_id: p.category?.id || '', categoria: p.category?.label || '',
      dettagli: (p.details || []).map((d) => d.label).join(' | '),
      km_rilevato: kmB.get(p.id)?.km ?? kmRilevatoKm(p),
      km_origine: kmB.get(p.id)?.origine ?? (kmRilevatoKm(p) !== '' ? 'rilevato' : ''),
      trip_a_km: p.odo != null ? (p.odo / 1000).toFixed(3) : '',
      trip_b_km: p.odoB != null ? (p.odoB / 1000).toFixed(3) : '',
      note: p.notes || '',
      precisione_m: p.acc != null ? Number(p.acc).toFixed(1) : '',
      sorgente: p.manual || p.src === 'mappa' ? 'mappa' : p.src === 'racebox' ? 'racebox' : 'gps',
      foto: nFoto.get(p.id) || 0
    };
    return `<ExtendedData>${GT_FIELDS.map((k) => `<Data name="${k}"><value>${xmlEsc(v[k])}</value></Data>`).join('')}</ExtendedData>`;
  };
  const desc = (p) => {
    if (!done(p)) return 'Da classificare' + (p.notes ? ' – ' + p.notes : '');
    const d = [p.category?.label, ...(p.details || []).map((x) => x.label)].filter(Boolean).join(' · ');
    return d + (p.notes ? ' – ' + p.notes : '');
  };
  const pm = (name, p) => `<Placemark><name>${xmlEsc(name)}</name><description>${xmlEsc(desc(p))}</description>${ext(p)}<Point><coordinates>${c7(p.lon)},${c7(p.lat)},0</coordinates></Point></Placemark>`;

  // una sola traccia, tratti uniti in ordine di tempo, ripulita all'inizio e alla fine
  const tr = trimStill([...exportTrack(state)].sort((a, b) => a.t - b.t));
  const trackXml = tr.length > 1
    ? `<Folder><name>Traccia rilievo</name><Placemark><name>Traccia rilievo</name>
<ExtendedData><Data name="ruolo"><value>traccia_rilievo</value></Data><Data name="inizio"><value>${new Date(tr[0].t).toISOString()}</value></Data><Data name="fine"><value>${new Date(tr[tr.length - 1].t).toISOString()}</value></Data></ExtendedData>
<Style><LineStyle><color>ff00a5ff</color><width>4</width></LineStyle></Style>
<LineString><tessellate>1</tessellate><coordinates>${tr.map((t) => `${c7(t.lon)},${c7(t.lat)},0`).join(' ')}</coordinates></LineString></Placemark></Folder>`
    : '';

  const first = pts[0]?.t ?? tr[0]?.t ?? session.created ?? Date.now();
  const dd = new Date(first);
  const data = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
  const head = [['formato', 'rb-rilievo-geotool'], ['versione', '2'], ['sessione', session.name || ''], ['data', data],
    ['modo', session.mode || ''], ['app', `RB-rilevamenti ${window.RB_VERSION || ''}`.trim()]]
    .map(([k, v]) => `<Data name="${k}"><value>${xmlEsc(v)}</value></Data>`).join('');
  const folder = (name, items) => (items.length ? `<Folder><name>${name}</name>\n${items.join('\n')}\n</Folder>` : '');

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEsc(session.name || 'Rilievo')}</name>
<ExtendedData>${head}</ExtendedData>
${trackXml}
${folder('Box', boxes.map((p, i) => pm(String(i + 1), p)))}
${folder('Altri punti', others.map((p) => pm(done(p) ? `i${p.n} ${desc(p).split(' – ')[0]}` : `?${p.n} Da classificare`, p)))}
</Document></kml>`;
  const zip = new JSZip();
  zip.file('doc.kml', kml);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.google-earth.kmz', compression: 'DEFLATE' })
    .then((blob) => ({ blob, name: baseName(session) + '_geotool.kmz', counts: { box: boxes.length, co: cos.length, rapp: boxes.filter((p) => kmB.get(p.id)?.origine !== 'rilevato').length, altri: others.length, traccia: tr.length } }));
}

// ---------------- ZIP FOTO ----------------
export async function buildPhotosZip(state) {
  const zip = new JSZip();
  for (const f of state.photos) zip.file('foto/' + photoName(f, state.points), f.blob);
  for (const v of state.voices || []) zip.file('audio/' + voiceName(v, state.points), v.blob);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  return { blob, name: baseName(state.session) + '_foto_audio.zip' };
}

// ---------------- GPX ----------------
export function buildGPX(state) {
  const { session, points } = state;
  const track = exportTrack(state);
  const wpt = points.filter((p) => p.lat != null).map((p) => `<wpt lat="${p.lat}" lon="${p.lon}"><time>${new Date(p.t).toISOString()}</time><name>${xmlEsc(p.n + ' ' + pointLabel(p))}</name><desc>${xmlEsc(p.notes || '')}</desc></wpt>`).join('\n');
  const trkpt = (t) => `<trkpt lat="${r6(t.lat)}" lon="${r6(t.lon)}">${t.alt != null ? `<ele>${t.alt.toFixed(1)}</ele>` : ''}<time>${new Date(t.t).toISOString()}</time></trkpt>`;
  const trk = splitSegments(track).map((s) => `<trkseg>\n${s.pts.map(trkpt).join('\n')}\n</trkseg>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RB Rilevamenti" xmlns="http://www.topografix.com/GPX/1/1">
${wpt}
<trk><name>${xmlEsc(session.name || 'Traccia')}</name>
${trk}
</trk></gpx>`;
  return { blob: new Blob([gpx], { type: 'application/gpx+xml' }), name: baseName(session) + '.gpx' };
}

// ---------------- BACKUP COMPLETO (per spostare la sessione su un altro dispositivo) ----------------
export async function buildBackup(state) {
  const zip = new JSZip();
  const photosMeta = state.photos.map(({ blob, thumb, ...m }) => m);
  const voicesMeta = (state.voices || []).map(({ blob, ...m }) => m);
  zip.file('session.json', JSON.stringify({ app: 'rb-rilevamenti', v: 1, session: state.session, points: state.points, photos: photosMeta, track: state.track, odo: state.odo, odoB: state.odoB, transits: state.transits || [], events: state.events || [], corrections: state.corrections || [], refPoints: state.refPoints || [], refTrack: state.refTrack || null, voices: voicesMeta }));
  for (const v of state.voices || []) zip.file(`audio/${v.id}`, v.blob);
  for (const f of state.photos) {
    zip.file(`photos/${f.id}.jpg`, f.blob);
    if (f.thumb) zip.file(`thumbs/${f.id}.jpg`, f.thumb);
  }
  // tipo generico: evita che il telefono aggiunga ".zip" al nome
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', mimeType: 'application/octet-stream' });
  return { blob, name: baseName(state.session) + '_backup.rbz' };
}

export async function readBackup(file) {
  const zip = await JSZip.loadAsync(file);
  const j = JSON.parse(await zip.file('session.json').async('string'));
  if (j.app !== 'rb-rilevamenti') throw new Error('File non valido');
  for (const f of j.photos) {
    f.blob = await zip.file(`photos/${f.id}.jpg`).async('blob');
    const t = zip.file(`thumbs/${f.id}.jpg`);
    f.thumb = t ? await t.async('blob') : f.blob;
  }
  for (const v of j.voices || []) { const z = zip.file(`audio/${v.id}`); v.blob = z ? new Blob([await z.async('arraybuffer')], { type: v.mime || 'audio/webm' }) : new Blob(); }
  return j;
}
