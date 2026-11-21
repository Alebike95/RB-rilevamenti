// Catalogo delle scelte (liste modificabili dall'utente).
// Ogni voce: { id, label, icon, flow? }
// flow = nome di una sequenza di finestre successive (vedi FLOWS).

export const MODES = {
  rally: { label: 'Rally', sportList: 'sport_rally' },
  reg: { label: 'Regolarità', sportList: 'sport_reg' },
  evento: { label: 'Evento', sportList: null } // nessuna attivita' sportiva
};

// Sequenze di finestre dopo la scelta della categoria
export const FLOWS = {
  '': { label: '— nessuna —', steps: [] },
  velox: { label: 'Autovelox (tipo → limite)', steps: ['velox_tipo', 'limiti'] },
  fuel: { label: 'Distributore (lato → marca)', steps: ['fuel_lato', 'fuel_marca'] },
  warn: { label: 'Attenzione (tipo)', steps: ['warn_tipo'] },
  limit: { label: 'Limite di velocità', steps: ['limiti'] }
};

export const LIST_TITLES = {
  sport_rally: 'Attività sportive – Rally',
  sport_reg: 'Attività sportive – Regolarità',
  box_classico: 'Box classico',
  non_box: 'Non box roadbook',
  velox_tipo: 'Autovelox – tipo',
  limiti: 'Limiti di velocità',
  fuel_lato: 'Distributore – lato',
  fuel_marca: 'Distributore – marca',
  warn_tipo: 'Punti da attenzionare',
  segnalazioni: 'Segnalazioni'
};

// Liste che permettono di scrivere una voce libera (es. marca non in elenco)
export const FREE_TEXT_LISTS = ['fuel_marca'];

const R = '#c62828', G = '#2e7d32', B = '#1565c0', K = '#212121', O = '#ef6c00', P = '#6a1b9a';

export const DEFAULT_CATALOG = {
  version: 5,
  lists: {
    sport_rally: [
      { id: 'co', label: 'CO', icon: 'img:loghi/sport/co.png' },
      { id: 'start', label: 'Start', icon: 'img:loghi/sport/start.png' },
      { id: 'int', label: 'Int', icon: 'img:loghi/sport/int.png' },
      { id: 'intplus', label: 'Int+', icon: 'img:loghi/sport/intplus.png' },
      { id: 'rbs', label: 'RBS', icon: `badge:RBS:${P}` },
      { id: 'fine', label: 'Fine', icon: 'img:loghi/sport/fine.png' },
      { id: 'stop', label: 'Stop', icon: 'img:loghi/sport/stop.png' },
      { id: 'ct', label: 'CT', icon: 'img:loghi/sport/ct.png' },
      { id: 'refuel', label: 'Refueling', icon: 'img:loghi/sport/refuel.png' },
      { id: 'parco', label: 'Parco Assistenza', icon: 'img:loghi/sport/parco.png' },
      { id: 'media', label: 'Media Zone', icon: 'img:loghi/sport/media.png' },
      { id: 'tyre', label: 'Tyre Marking', icon: 'img:loghi/sport/tyre.png' },
      { id: 'vc-in', label: 'Inizio Virtual Chicane', icon: 'img:loghi/sport/vc-in.png' },
      { id: 'vc-fine', label: 'Fine Virtual Chicane', icon: 'img:loghi/sport/vc-fine.png' },
      { id: 'sz-in', label: 'Inizio Slow Zone', icon: 'img:loghi/sport/sz-in.png' },
      { id: 'sz-fine', label: 'Fine Slow Zone', icon: 'img:loghi/sport/sz-fine.png' }
    ],
    sport_reg: [
      { id: 'co', label: 'CO', icon: 'img:loghi/reg/co.png' },
      { id: 'ipc', label: 'IPC', icon: 'img:loghi/reg/ipc.png' },
      { id: 'pc', label: 'PC', icon: 'img:loghi/reg/ipc.png' },
      { id: 'fpc', label: 'FPC', icon: 'img:loghi/reg/ipc.png' },
      { id: 'preipm', label: 'PreIPM', icon: 'img:loghi/reg/preipm.png' },
      { id: 'ipm', label: 'IPM', icon: 'img:loghi/reg/ipm.png' },
      { id: 'fpm', label: 'FPM', icon: 'img:loghi/reg/fpm.png' },
      { id: 'ct', label: 'CT', icon: 'img:loghi/reg/ct.png' },
      { id: 'rs', label: 'Rilevamento Segreto', icon: `badge:RS:${K}` }
    ],
    box_classico: [
      { id: 'incrocio', label: 'Incrocio', icon: 'box:incrocio' },
      { id: 'rotonda', label: 'Rotonda', icon: 'box:rotonda' },
      { id: 'stop', label: 'Stop', icon: 'box:stop' },
      { id: 'precedenza', label: 'Dare la precedenza', icon: 'box:precedenza' },
      { id: 'ponte', label: 'Ponte', icon: 'box:ponte' },
      { id: 'galleria', label: 'Galleria', icon: 'box:galleria' },
      { id: 'pl', label: 'Passaggio a livello', icon: 'box:pl' },
      { id: 'localita', label: 'Cartello località', icon: 'box:localita' },
      { id: 'cippo', label: 'Cippo chilometrico', icon: 'box:cippo' },
      { id: 'velox', label: 'Autovelox', icon: 'velox:', flow: 'velox' },
      { id: 'distrib', label: 'Distributore', icon: 'fuel:', flow: 'fuel' },
      { id: 'attenz', label: 'Punto da attenzionare', icon: 'warn:generico', flow: 'warn' },
      { id: 'limite', label: 'Limite di velocità', icon: 'limit:50', flow: 'limit' }
    ],
    non_box: [
      { id: 'rif', label: 'Riferimento', icon: 'box:riferimento' },
      { id: 'cippo', label: 'Cippo chilometrico', icon: 'box:cippo' },
      { id: 'galleria', label: 'Galleria', icon: 'box:galleria' },
      { id: 'sterrato', label: 'Sterrato', icon: 'box:sterrato' },
      { id: 'pave', label: 'Pavè', icon: 'box:pave' },
      { id: 'velox', label: 'Autovelox', icon: 'velox:', flow: 'velox' },
      { id: 'distrib', label: 'Distributore', icon: 'fuel:', flow: 'fuel' },
      { id: 'attenz', label: 'Punto da attenzionare', icon: 'warn:generico', flow: 'warn' },
      { id: 'limite', label: 'Limite di velocità', icon: 'limit:50', flow: 'limit' }
    ],
    velox_tipo: [
      { id: 'finto', label: 'Finto', icon: 'velox:finto' },
      { id: 'alto', label: 'Alto', icon: 'velox:alto' },
      { id: 'basso', label: 'Basso', icon: 'velox:basso' }
    ],
    limiti: [30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130].map((v) => ({ id: 'l' + v, label: String(v), icon: 'limit:' + v })),
    fuel_lato: [
      { id: 'sx', label: 'Sinistra', icon: 'fuel:sx' },
      { id: 'dx', label: 'Destra', icon: 'fuel:dx' }
    ],
    fuel_marca: [
      { id: 'eni', label: 'Eni', icon: 'img:loghi/carburanti/eni.png' },
      { id: 'q8', label: 'Q8', icon: 'img:loghi/carburanti/q8.png' },
      { id: 'ip', label: 'IP', icon: 'img:loghi/carburanti/ip.png' },
      { id: 'esso', label: 'Esso', icon: 'img:loghi/carburanti/esso.png' },
      { id: 'tamoil', label: 'Tamoil', icon: 'img:loghi/carburanti/tamoil.png' },
      { id: 'shell', label: 'Shell', icon: 'img:loghi/carburanti/shell.png' },
      { id: 'beyfin', label: 'Beyfin', icon: 'img:loghi/carburanti/beyfin.png' },
      { id: 'bianca', label: 'Pompa bianca', icon: 'img:loghi/carburanti/bianca.png' },
      // senza logo: sigla colorata (si puo' cambiare da Impostazioni → Liste)
      ...[['total', 'TotalEnergies', 'TOT', '#d84315'], ['repsol', 'Repsol', 'REP', '#ef6c00'], ['api', 'Api', 'API', '#283593'],
        ['agip', 'Agip', 'AGIP', '#212121'], ['costantin', 'Costantin', 'COS', '#00695c']]
        .map(([id, label, t, c]) => ({ id, label, icon: `badge:${t}:${c}` }))
    ],
    // segnalazioni: dur = true -> resta aperta fino a FINE
    segnalazioni: [
      { id: 'traffico', label: 'Traffico', icon: 'ev:traffico', dur: true },
      { id: 'polizia', label: 'Posto di blocco', icon: 'ev:polizia', dur: true },
      { id: 'sosta', label: 'Sosta', icon: 'ev:sosta', dur: true },
      { id: 'lavori', label: 'Semaforo / Lavori', icon: 'ev:lavori', dur: true },
      { id: 'incidente', label: 'Incidente', icon: 'ev:incidente', dur: true },
      { id: 'deviazione', label: 'Deviazione', icon: 'ev:deviazione', dur: true },
      { id: 'meteo', label: 'Meteo', icon: 'ev:meteo', dur: false },
      { id: 'nota', label: 'Nota', icon: 'ev:nota', dur: false }
    ],
    warn_tipo: [
      { id: 'dosso', label: 'Dosso', icon: 'warn:dosso' },
      { id: 'compressione', label: 'Compressione', icon: 'warn:compressione' },
      { id: 'bump', label: 'Bump', icon: 'warn:bump' },
      { id: 'strettoia', label: 'Strettoia', icon: 'warn:strettoia' },
      { id: 'dissestata', label: 'Strada dissestata', icon: 'warn:dissestata' },
      { id: 'curva', label: 'Curva pericolosa', icon: 'warn:curva' }
    ]
  }
};

const KEY = 'rb.catalog';

export function loadCatalog() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const c = JSON.parse(raw);
      // aggiunge eventuali liste nuove introdotte da aggiornamenti dell'app
      for (const k of Object.keys(DEFAULT_CATALOG.lists)) if (!c.lists[k]) c.lists[k] = structuredClone(DEFAULT_CATALOG.lists[k]);
      // v2: loghi veri per attivita' sportive e distributori + voci nuove
      if ((c.version || 1) < 2) {
        for (const k of ['sport_rally', 'sport_reg', 'fuel_marca']) {
          for (const d of DEFAULT_CATALOG.lists[k]) {
            const it = c.lists[k].find((x) => x.id === d.id);
            if (it) it.icon = d.icon; else c.lists[k].push(structuredClone(d));
          }
        }
        c.version = 2;
        saveCatalog(c);
      }
      // v3: Rilevamento Segreto in regolarita'
      if (c.version < 3) {
        const d = DEFAULT_CATALOG.lists.sport_reg.find((x) => x.id === 'rs');
        if (!c.lists.sport_reg.some((x) => x.id === 'rs')) c.lists.sport_reg.push(structuredClone(d));
        c.version = 3;
        saveCatalog(c);
      }
      // v4: cippo chilometrico in box classico e non box (dopo "Cartello località" / "Riferimento")
      if (c.version < 4) {
        for (const [k, after] of [['box_classico', 'localita'], ['non_box', 'rif']]) {
          const l = c.lists[k];
          if (l.some((x) => x.id === 'cippo')) continue;
          const i = l.findIndex((x) => x.id === after);
          l.splice(i >= 0 ? i + 1 : l.length, 0, { id: 'cippo', label: 'Cippo chilometrico', icon: 'box:cippo' });
        }
        c.version = 4;
        saveCatalog(c);
      }
      // v5: stop, precedenza, passaggio a livello (box classico); galleria, sterrato, pave' (non box)
      if (c.version < 5) {
        const add = (k, item, after) => {
          const l = c.lists[k];
          if (l.some((x) => x.id === item.id)) return;
          const i = l.findIndex((x) => x.id === after);
          l.splice(i >= 0 ? i + 1 : l.length, 0, item);
        };
        add('box_classico', { id: 'precedenza', label: 'Dare la precedenza', icon: 'box:precedenza' }, 'rotonda');
        add('box_classico', { id: 'stop', label: 'Stop', icon: 'box:stop' }, 'rotonda');
        add('box_classico', { id: 'pl', label: 'Passaggio a livello', icon: 'box:pl' }, 'galleria');
        add('non_box', { id: 'pave', label: 'Pavè', icon: 'box:pave' }, 'cippo');
        add('non_box', { id: 'sterrato', label: 'Sterrato', icon: 'box:sterrato' }, 'cippo');
        add('non_box', { id: 'galleria', label: 'Galleria', icon: 'box:galleria' }, 'cippo');
        c.version = 5;
        saveCatalog(c);
      }
      return c;
    }
  } catch (e) { console.warn('catalogo corrotto, uso default', e); }
  return structuredClone(DEFAULT_CATALOG);
}

export function saveCatalog(c) {
  localStorage.setItem(KEY, JSON.stringify(c));
}

export function resetCatalog() {
  localStorage.removeItem(KEY);
  return structuredClone(DEFAULT_CATALOG);
}

export function slug(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'voce';
}
