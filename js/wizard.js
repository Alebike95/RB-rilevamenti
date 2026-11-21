// Finestre di classificazione di un punto.
// La posizione e l'ora sono gia' fissate al momento del clic: qui si sceglie solo cosa e'.
import { MODES, FLOWS, LIST_TITLES, FREE_TEXT_LISTS } from './catalog.js';
import { iconSVG } from './icons.js';
import { $, esc, fmtTime, fmtKm } from './util.js';

const sheet = () => $('#sheet');
const modal = () => $('#modal');

export function closeModal() { modal().classList.add('hidden'); sheet().innerHTML = ''; }
export function openModal(html) { sheet().innerHTML = html; modal().classList.remove('hidden'); }

function sportListOf(mode) { return MODES[mode]?.sportList || null; }

// Ricava la sequenza di finestre in base alle risposte date finora
function steps(a, mode, catalog) {
  const s = ['isBox'];
  if (a.isBox == null) return s;
  const sport = a.isBox && sportListOf(mode);
  if (sport) { s.push('group'); if (!a.group) return s; }
  s.push('cat');
  if (!a.category) return s;
  const cat = findCat(a, mode, catalog) || a.category;
  for (const l of FLOWS[cat.flow || '']?.steps || []) s.push('flow:' + l);
  s.push('km', 'notes');
  return s;
}

function catListId(a, mode) {
  if (!a.isBox) return 'non_box';
  if (a.group === 'sport') return sportListOf(mode);
  return 'box_classico';
}

function findCat(a, mode, catalog) {
  const l = catalog.lists[catListId(a, mode)] || [];
  return l.find((x) => x.id === a.category?.id);
}

/**
 * Apre le finestre per classificare un punto.
 * ctx: { catalog, mode, queue (n. punti in coda), onPhoto(point) }
 * Restituisce: { action: 'save', point } | { action: 'later' } | { action: 'delete' }
 */
export function classify(point, ctx) {
  const { catalog } = ctx;
  const mode = point.mode || ctx.mode;
  const a = {
    isBox: point.status === 'pending' ? null : point.isBox,
    group: point.group || null,
    category: point.category || null,
    details: Object.fromEntries((point.details || []).map((d) => [d.listId, d])),
    kmRil: point.kmRil ?? '',
    notes: point.notes || ''
  };
  let idx = 0;

  return new Promise((resolve) => {
    const finish = (r) => { document.removeEventListener('keydown', onKey, true); closeModal(); resolve(r); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish({ action: 'later' }); }
    };
    document.addEventListener('keydown', onKey, true);

    const build = () => {
      const st = steps(a, mode, catalog);
      const cat = a.category && (findCat(a, mode, catalog) || a.category);
      const flowLists = FLOWS[cat?.flow || '']?.steps || [];
      const details = flowLists.map((l) => a.details[l]).filter(Boolean);
      return {
        ...point,
        mode,
        status: 'done',
        isBox: !!a.isBox,
        group: a.isBox ? (a.group || 'classico') : null,
        category: cat ? { id: cat.id, label: cat.label, icon: cat.icon, flow: cat.flow || '' } : null,
        details: details.map((d) => ({ listId: d.listId, id: d.id, label: d.label, icon: d.icon })),
        kmRil: a.kmRil === '' || a.kmRil == null ? null : Number(String(a.kmRil).replace(',', '.')),
        notes: a.notes.trim(),
        _complete: st.includes('km')
      };
    };

    const render = () => {
      const st = steps(a, mode, catalog);
      if (idx >= st.length) idx = st.length - 1;
      const step = st[idx];
      const pathTxt = [a.isBox == null ? '' : a.isBox ? 'Box roadbook' : 'Non box', a.group === 'sport' ? 'Attività sportiva' : a.group === 'classico' && sportListOf(mode) ? 'Box classico' : '', a.category?.label,
        ...Object.values(a.details).filter((d) => st.includes('flow:' + d.listId)).map((d) => d.label)].filter(Boolean).join(' › ');

      let title = '', body = '';
      const optBtn = (val, label, icon, on, big) => `<button class="opt${on ? ' on' : ''}" data-v="${esc(val)}">${icon ? iconSVG(icon, big ? 64 : 48) : ''}<span>${esc(label)}</span></button>`;

      if (step === 'isBox') {
        title = 'È un box roadbook?';
        body = `<div class="grid big">${optBtn('1', 'Sì – box roadbook', 'box:incrocio', a.isBox === true, 1)}${optBtn('0', 'No – informazione', 'box:riferimento', a.isBox === false, 1)}</div>`;
      } else if (step === 'group') {
        title = 'Che tipo di box?';
        const first = catalog.lists[sportListOf(mode)]?.[0]?.icon;
        body = `<div class="grid big">${optBtn('sport', 'Attività sportiva', first || 'badge:CO', a.group === 'sport', 1)}${optBtn('classico', 'Box classico', 'box:rotonda', a.group === 'classico', 1)}</div>`;
      } else if (step === 'cat') {
        const lid = catListId(a, mode);
        title = LIST_TITLES[lid] || 'Categoria';
        body = `<div class="grid">${(catalog.lists[lid] || []).map((it) => optBtn(it.id, it.label, it.icon, a.category?.id === it.id)).join('')}</div>`;
      } else if (step.startsWith('flow:')) {
        const lid = step.slice(5);
        title = LIST_TITLES[lid] || lid;
        const cur = a.details[lid];
        body = `<div class="grid">${(catalog.lists[lid] || []).map((it) => optBtn(it.id, it.label, it.icon, cur?.id === it.id)).join('')}</div>`;
        if (FREE_TEXT_LISTS.includes(lid)) {
          const custom = cur && !(catalog.lists[lid] || []).some((x) => x.id === cur.id) ? cur.label : '';
          body += `<div class="row"><input type="text" id="freeTxt" placeholder="Altro (scrivi)…" value="${esc(custom)}"><button id="freeOk">OK</button></div>`;
        }
      } else if (step === 'km') {
        title = 'Distanza rilevata';
        body = `<p class="wz-info">Trip al momento del clic: A <b>${point.odo != null ? fmtKm(point.odo) + ' km' : '—'}</b> · B <b>${point.odoB != null ? fmtKm(point.odoB) + ' km' : '—'}</b></p>
          <div class="row"><input id="kmIn" class="big-input" type="text" inputmode="decimal" placeholder="km" value="${esc(a.kmRil)}">
          <span>km</span>${point.odo != null ? `<button id="useTrip">Usa A (${fmtKm(point.odo)})</button>` : ''}${point.odoB != null ? `<button id="useTripB">Usa B (${fmtKm(point.odoB)})</button>` : ''}<button id="kmClear">Vuoto</button></div>
          <p class="muted small">Facoltativo: lascia vuoto se non serve.</p>`;
      } else if (step === 'notes') {
        title = 'Note';
        body = `<textarea id="notesIn" placeholder="Note aggiuntive (facoltative)">${esc(a.notes)}</textarea>
          <div class="chips">${['Inizio', 'Fine', 'A destra', 'A sinistra', 'Dritto', 'Attenzione', 'Verificare'].map((c) => `<button class="chip-q">${c}</button>`).join('')}</div>
`;
      }

      const canSave = steps(a, mode, catalog).includes('km');
      openModal(`
        <div class="sheet-head">
          <h3>Punto ${point.n}</h3>
          <div class="wz-info">🕑 <b>${fmtTime(point.t)}</b> · 📍 ${point.lat != null ? 'posizione bloccata' : '<span style="color:var(--red)">senza GPS</span>'}${point.acc != null ? ' (±' + Math.round(point.acc) + ' m)' : ''}${ctx.queue ? ` · <b style="color:var(--acc)">+${ctx.queue} in coda</b>` : ''}</div>
          <div class="spacer"></div>
          <button id="wzCam" class="wz-cam" title="Foto collegata a questo punto">📷 <span id="wzCamN">${point.photoCount || ''}</span></button>
          <button id="wzMic" class="wz-mic" title="Nota vocale del punto (tocca per iniziare e per finire)">🎙 <span id="wzMicN">${point.voiceCount || ''}</span></button>
          <button id="wzDel" title="Elimina punto">🗑</button>
        </div>
        <div class="sheet-body">
          <div class="wz-path">${esc(pathTxt)}</div>
          <p class="wz-title">${esc(title)}</p>
          ${body}
        </div>
        <div class="sheet-foot">
          <button id="wzBack" ${idx === 0 ? 'disabled' : ''}>← Indietro</button>
          <button id="wzLater">Dopo</button>
          <div class="spacer"></div>
          ${step === 'km' ? '<button id="wzNext">Avanti →</button>' : ''}
          <button id="wzSave" class="btn-main" ${canSave ? '' : 'disabled'}>✔ Salva</button>
        </div>`);

      const next = () => { idx++; render(); };
      sheet().querySelectorAll('.opt').forEach((b) => b.onclick = () => {
        const v = b.dataset.v;
        if (step === 'isBox') {
          const nv = v === '1';
          if (a.isBox !== nv) { a.group = null; a.category = null; a.details = {}; }
          a.isBox = nv;
        } else if (step === 'group') {
          if (a.group !== v) { a.category = null; a.details = {}; }
          a.group = v;
        } else if (step === 'cat') {
          const it = catalog.lists[catListId(a, mode)].find((x) => x.id === v);
          if (a.category?.id !== it.id) a.details = {};
          a.category = it;
        } else if (step.startsWith('flow:')) {
          const lid = step.slice(5);
          const it = catalog.lists[lid].find((x) => x.id === v);
          a.details[lid] = { listId: lid, ...it };
        }
        next();
      });
      const free = $('#freeOk');
      if (free) {
        const go = () => {
          const t = $('#freeTxt').value.trim();
          if (!t) return;
          const lid = step.slice(5);
          a.details[lid] = { listId: lid, id: 'custom', label: t, icon: 'text:' + t.slice(0, 3).toUpperCase() };
          next();
        };
        free.onclick = go;
        $('#freeTxt').onkeydown = (e) => { if (e.key === 'Enter') go(); };
      }
      const kmIn = $('#kmIn');
      if (kmIn) {
        kmIn.oninput = () => { a.kmRil = kmIn.value; };
        kmIn.onkeydown = (e) => { if (e.key === 'Enter') next(); };
        $('#useTrip') && ($('#useTrip').onclick = () => { a.kmRil = fmtKm(point.odo); kmIn.value = a.kmRil; });
        $('#useTripB') && ($('#useTripB').onclick = () => { a.kmRil = fmtKm(point.odoB); kmIn.value = a.kmRil; });
        $('#kmClear').onclick = () => { a.kmRil = ''; kmIn.value = ''; };
        $('#wzNext').onclick = next;
      }
      const notesIn = $('#notesIn');
      if (notesIn) {
        notesIn.oninput = () => { a.notes = notesIn.value; };
        sheet().querySelectorAll('.chip-q').forEach((c) => c.onclick = () => {
          a.notes = (a.notes ? a.notes.trimEnd() + ' ' : '') + c.textContent; notesIn.value = a.notes;
        });
      }
      $('#wzCam').onclick = async () => {
        const n = await ctx.onPhoto?.(point);
        if (n != null) { point.photoCount = n; const el = $('#wzCamN'); if (el) el.textContent = n || ''; }
      };
      $('#wzMic').onclick = async () => {
        const n = await ctx.onVoice?.(point);
        if (n != null) { point.voiceCount = n; const el = $('#wzMicN'); if (el) el.textContent = n || ''; }
      };
      if (document.getElementById('voiceBar')) $('#wzMic').classList.add('rec');
      $('#wzBack').onclick = () => { if (idx > 0) { idx--; render(); } };
      $('#wzLater').onclick = () => finish(point.status === 'pending' ? { action: 'later' } : { action: 'cancel' });
      $('#wzSave').onclick = () => { const p = build(); if (p._complete) { delete p._complete; finish({ action: 'save', point: p }); } };
      $('#wzDel').onclick = () => { if (confirm(`Eliminare il punto ${point.n}?`)) finish({ action: 'delete' }); };
    };

    // in modifica di un punto gia' classificato si parte dalla finestra della distanza
    if (point.status !== 'pending') {
      const st = steps(a, mode, catalog);
      const k = st.indexOf('km');
      idx = k >= 0 ? k : 0;
    }
    render();
  });
}
