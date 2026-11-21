// Simboli SVG dell'app. Ogni icona e' descritta da una stringa "tipo:valore[:extra]".
// Esempi: "limit:50", "velox:alto", "fuel:dx", "warn:dosso", "box:rotonda",
//         "badge:CO:#c62828", "emoji:⛽", "text:Q8".
// Cosi' le liste si possono modificare liberamente scegliendo un'icona esistente
// oppure scrivendo un'emoji / un testo breve.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function wrap(inner, size, vb = 40) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${vb} ${vb}">${inner}</svg>`;
}

// ---- Cartello limite di velocita' (tondo bordo rosso) ----
function limit(v) {
  const n = String(v);
  const fs = n.length >= 3 ? 13 : 16;
  return `<circle cx="20" cy="20" r="18" fill="#fff" stroke="#d32f2f" stroke-width="5"/>
  <text x="20" y="21" text-anchor="middle" dominant-baseline="central" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${fs}" fill="#111">${esc(n)}</text>`;
}

// ---- Autovelox ----
function velox(kind) {
  const cam = (x, y, col) => `<rect x="${x}" y="${y}" width="16" height="11" rx="2" fill="${col}"/>
    <circle cx="${x + 11}" cy="${y + 5.5}" r="3.2" fill="#fff"/><circle cx="${x + 11}" cy="${y + 5.5}" r="1.6" fill="${col}"/>
    <rect x="${x + 2}" y="${y - 2}" width="5" height="3" fill="${col}"/>`;
  if (kind === 'alto') {
    return `<rect x="0" y="0" width="40" height="40" rx="6" fill="#1565c0"/>
      <rect x="18.5" y="15" width="3" height="22" fill="#fff"/>${cam(12, 5, '#fff')}<rect x="14" y="36" width="12" height="2" fill="#fff"/>`;
  }
  if (kind === 'basso') {
    return `<rect x="0" y="0" width="40" height="40" rx="6" fill="#1565c0"/>
      <rect x="12" y="16" width="16" height="18" rx="2" fill="#fff"/><circle cx="20" cy="22" r="3.5" fill="#1565c0"/>
      <rect x="18.5" y="34" width="3" height="4" fill="#fff"/>`;
  }
  if (kind === 'finto') {
    return `<rect x="1" y="1" width="38" height="38" rx="6" fill="#90a4ae" stroke="#37474f" stroke-width="2" stroke-dasharray="4 3"/>
      ${cam(12, 9, '#fff')}<text x="20" y="32" text-anchor="middle" font-family="Arial" font-weight="700" font-size="11" fill="#263238">FINTO</text>`;
  }
  return `<rect x="0" y="0" width="40" height="40" rx="6" fill="#1565c0"/>${cam(12, 14, '#fff')}`;
}

// ---- Distributore ----
function fuel(kind) {
  const pump = `<rect x="9" y="8" width="15" height="25" rx="2" fill="#fff"/><rect x="12" y="11" width="9" height="7" fill="#2e7d32"/>
    <path d="M24 14 h4 v13 a2 2 0 0 0 4 0 v-12 l-3 -4" fill="none" stroke="#fff" stroke-width="2"/><rect x="7" y="33" width="19" height="3" fill="#fff"/>`;
  const bg = `<rect x="0" y="0" width="40" height="40" rx="6" fill="#2e7d32"/>`;
  if (kind === 'dx') return bg + `<g transform="translate(-4 0)">${pump}</g><path d="M30 6 l7 6 l-7 6 z" fill="#ffeb3b"/>`;
  if (kind === 'sx') return bg + `<g transform="translate(4 0)">${pump}</g><path d="M10 6 l-7 6 l7 6 z" fill="#ffeb3b"/>`;
  return bg + pump;
}

// ---- Pericoli (triangolo) ----
function warn(kind) {
  const tri = `<path d="M20 3 L38 36 H2 Z" fill="#fff" stroke="#d32f2f" stroke-width="4" stroke-linejoin="round"/>`;
  const g = {
    dosso: `<path d="M9 31 Q20 15 31 31 Z" fill="#111"/>`,
    compressione: `<path d="M9 22 Q20 36 31 22" fill="none" stroke="#111" stroke-width="3"/>`,
    bump: `<path d="M8 31 H14 Q20 17 26 31 H32" fill="none" stroke="#111" stroke-width="3"/><path d="M19 14 l2 -4 l2 4" fill="none" stroke="#111" stroke-width="1.6"/>`,
    strettoia: `<path d="M15 33 V25 L18 19 V14 M25 33 V25 L22 19 V14" fill="none" stroke="#111" stroke-width="2.6"/>`,
    dissestata: `<path d="M8 31 L12 27 L15 31 L19 25 L22 31 L26 26 L29 31 L32 28" fill="none" stroke="#111" stroke-width="2.4"/><circle cx="15" cy="22" r="1.6" fill="#111"/><circle cx="25" cy="21" r="1.6" fill="#111"/>`,
    curva: `<path d="M16 33 V24 Q16 16 24 16 H25" fill="none" stroke="#111" stroke-width="3"/><path d="M24 12 l5 4 l-5 4 z" fill="#111"/>`,
    generico: `<rect x="18.5" y="14" width="3" height="11" fill="#111"/><circle cx="20" cy="29.5" r="2" fill="#111"/>`
  };
  return tri + (g[kind] || g.generico);
}

// ---- Segnalazioni (fondo giallo) ----
function ev(kind) {
  const bg = `<rect x="0" y="0" width="40" height="40" rx="8" fill="#f9a825"/>`;
  const car = (x, y, c) => `<rect x="${x}" y="${y + 4}" width="16" height="7" rx="2" fill="${c}"/><path d="M${x + 3} ${y + 4} l2 -4 h6 l2 4 z" fill="${c}"/><circle cx="${x + 4}" cy="${y + 11}" r="2" fill="#111"/><circle cx="${x + 12}" cy="${y + 11}" r="2" fill="#111"/>`;
  switch (kind) {
    case 'traffico': return bg + car(3, 6, '#263238') + car(21, 6, '#263238') + car(12, 21, '#263238');
    case 'polizia': return bg + `<rect x="18.5" y="22" width="3" height="16" fill="#263238"/><circle cx="20" cy="15" r="11" fill="#fff" stroke="#263238" stroke-width="1.5"/><circle cx="20" cy="15" r="7.5" fill="#d32f2f"/>`;
    case 'sosta': return bg + `<circle cx="20" cy="20" r="14" fill="none" stroke="#263238" stroke-width="3"/><rect x="14" y="13" width="4" height="14" fill="#263238"/><rect x="22" y="13" width="4" height="14" fill="#263238"/>`;
    case 'lavori': return bg + `<rect x="13" y="3" width="14" height="34" rx="4" fill="#263238"/><circle cx="20" cy="10" r="4" fill="#e53935"/><circle cx="20" cy="20" r="4" fill="#ffb300"/><circle cx="20" cy="30" r="4" fill="#43a047"/>`;
    case 'incidente': return bg + car(2, 18, '#263238') + `<g transform="rotate(25 30 20)">${car(20, 12, '#5d4037')}</g><path d="M20 6 l2 5 l5 -2 l-3 5 l5 2 l-6 1 z" fill="#d32f2f"/>`;
    case 'deviazione': return bg + `<path d="M12 36 V24 Q12 16 20 16 H24" fill="none" stroke="#263238" stroke-width="4"/><path d="M23 9 L32 16 L23 23 Z" fill="#263238"/><path d="M12 22 V6" stroke="#263238" stroke-width="3" stroke-dasharray="3 3"/>`;
    case 'meteo': return bg + `<path d="M11 22 a6 6 0 0 1 2 -11 a8 8 0 0 1 15 2 a5 5 0 0 1 1 9 z" fill="#fff" stroke="#263238" stroke-width="1.5"/><path d="M14 27 l-2 6 M21 27 l-2 6 M28 27 l-2 6" stroke="#1565c0" stroke-width="2.5" stroke-linecap="round"/>`;
    case 'nota': return bg + `<rect x="10" y="5" width="20" height="30" rx="2" fill="#fff" stroke="#263238" stroke-width="1.5"/><path d="M14 13 H26 M14 19 H26 M14 25 H22" stroke="#263238" stroke-width="2"/>`;
    default: return bg + `<text x="20" y="21" text-anchor="middle" dominant-baseline="central" font-family="Arial" font-weight="700" font-size="20" fill="#263238">!</text>`;
  }
}

// ---- Box classici ----
function box(kind) {
  const bg = (c) => `<rect x="0" y="0" width="40" height="40" rx="6" fill="${c}"/>`;
  switch (kind) {
    case 'incrocio':
      return bg('#37474f') + `<path d="M20 36 V4 M6 20 H34" stroke="#fff" stroke-width="5"/><path d="M20 30 V12" stroke="#ffca28" stroke-width="2.5"/><path d="M15 15 L20 9 L25 15" fill="none" stroke="#ffca28" stroke-width="2.5"/>`;
    case 'rotonda':
      return bg('#37474f') + `<circle cx="20" cy="20" r="9" fill="none" stroke="#fff" stroke-width="4"/><path d="M20 38 V29 M20 11 V2 M2 20 H11 M29 20 H38" stroke="#fff" stroke-width="4"/>`;
    case 'ponte':
      return bg('#5d4037') + `<path d="M3 18 H37" stroke="#fff" stroke-width="3"/><path d="M6 32 V22 Q20 10 34 22 V32" fill="none" stroke="#fff" stroke-width="3"/><path d="M3 34 Q8 31 13 34 T23 34 T33 34 T40 34" fill="none" stroke="#81d4fa" stroke-width="2"/>`;
    case 'galleria':
      return bg('#424242') + `<path d="M5 36 V20 A15 15 0 0 1 35 20 V36 Z" fill="#111" stroke="#fff" stroke-width="3"/><path d="M20 36 V28" stroke="#ffca28" stroke-width="2" stroke-dasharray="3 2"/>`;
    case 'localita':
      return `<rect x="1" y="7" width="38" height="26" rx="2" fill="#fff" stroke="#111" stroke-width="2"/><rect x="4" y="10" width="32" height="20" fill="none" stroke="#111" stroke-width="1.5"/><text x="20" y="21" text-anchor="middle" dominant-baseline="central" font-family="Arial" font-weight="700" font-size="9" fill="#111">PAESE</text>`;
    case 'fine-localita':
      return `<rect x="1" y="7" width="38" height="26" rx="2" fill="#fff" stroke="#111" stroke-width="2"/><text x="20" y="21" text-anchor="middle" dominant-baseline="central" font-family="Arial" font-weight="700" font-size="9" fill="#111">PAESE</text><path d="M4 30 L36 10" stroke="#d32f2f" stroke-width="3"/>`;
    case 'voce':
      return `<circle cx="20" cy="20" r="18" fill="#6a1b9a" stroke="#fff" stroke-width="2"/><rect x="16" y="9" width="8" height="15" rx="4" fill="#fff"/><path d="M12 20 a8 8 0 0 0 16 0 M20 28 V32 M15 32 H25" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`;
    case 'pl':
      // passaggio a livello: croce di Sant'Andrea
      return `<g transform="rotate(35 20 20)"><rect x="3" y="16" width="34" height="8" fill="#fff" stroke="#d32f2f" stroke-width="2"/><rect x="9" y="16" width="5" height="8" fill="#d32f2f"/><rect x="26" y="16" width="5" height="8" fill="#d32f2f"/></g><g transform="rotate(-35 20 20)"><rect x="3" y="16" width="34" height="8" fill="#fff" stroke="#d32f2f" stroke-width="2"/><rect x="9" y="16" width="5" height="8" fill="#d32f2f"/><rect x="26" y="16" width="5" height="8" fill="#d32f2f"/></g>`;
    case 'sterrato':
      return bg('#8d6e63') + `<path d="M14 38 L18 2 M26 38 L22 2" stroke="#d7ccc8" stroke-width="2" stroke-dasharray="4 3"/><circle cx="12" cy="12" r="2" fill="#4e342e"/><circle cx="29" cy="9" r="1.6" fill="#4e342e"/><circle cx="20" cy="22" r="2.2" fill="#4e342e"/><circle cx="10" cy="30" r="1.8" fill="#4e342e"/><circle cx="30" cy="27" r="2.4" fill="#4e342e"/><circle cx="24" cy="34" r="1.4" fill="#4e342e"/>`;
    case 'pave':
      return bg('#616161') + [0, 1, 2, 3].map((r) => [0, 1, 2].map((k) => `<rect x="${(r % 2 ? 1 : 6) + k * 12}" y="${3 + r * 9}" width="10" height="7" rx="1.5" fill="#bdbdbd" stroke="#424242" stroke-width="1"/>`).join('')).join('');
    case 'cippo':
      return `<path d="M9 38 V12 A11 11 0 0 1 31 12 V38 Z" fill="#fff" stroke="#111" stroke-width="2"/><path d="M9.6 14 V12 A10.4 10.4 0 0 1 30.4 12 V14 Z" fill="#d32f2f"/><path d="M10 12 A10 10 0 0 1 30 12 Z" fill="#d32f2f"/><text x="20" y="25" text-anchor="middle" dominant-baseline="central" font-family="Arial" font-weight="700" font-size="9" fill="#111">km</text><text x="20" y="33" text-anchor="middle" dominant-baseline="central" font-family="Arial" font-weight="700" font-size="8" fill="#111">12</text>`;
    case 'riferimento':
      return `<circle cx="20" cy="20" r="17" fill="#6a1b9a"/><circle cx="20" cy="20" r="10" fill="none" stroke="#fff" stroke-width="2.5"/><circle cx="20" cy="20" r="3" fill="#fff"/><path d="M20 1 V8 M20 32 V39 M1 20 H8 M32 20 H39" stroke="#6a1b9a" stroke-width="3"/>`;
    case 'stop':
      return `<path d="M12 2 H28 L38 12 V28 L28 38 H12 L2 28 V12 Z" fill="#d32f2f" stroke="#fff" stroke-width="2"/><text x="20" y="21" text-anchor="middle" dominant-baseline="central" font-family="Arial" font-weight="700" font-size="11" fill="#fff">STOP</text>`;
    case 'precedenza':
      return `<path d="M3 5 H37 L20 36 Z" fill="#fff" stroke="#d32f2f" stroke-width="4" stroke-linejoin="round"/>`;
    case 'pending':
      return `<circle cx="20" cy="20" r="17" fill="#9e9e9e" stroke="#fff" stroke-width="2"/><text x="20" y="21" text-anchor="middle" dominant-baseline="central" font-family="Arial" font-weight="700" font-size="20" fill="#fff">?</text>`;
    case 'foto':
      return `<rect x="2" y="9" width="36" height="25" rx="4" fill="#00838f"/><rect x="13" y="5" width="14" height="6" rx="2" fill="#00838f"/><circle cx="20" cy="21" r="8" fill="#fff"/><circle cx="20" cy="21" r="5" fill="#00838f"/>`;
    default:
      return bg('#546e7a') + `<circle cx="20" cy="20" r="6" fill="#fff"/>`;
  }
}

function badge(text, color = '#c62828') {
  const t = String(text);
  const fs = t.length <= 2 ? 17 : t.length <= 3 ? 14 : t.length <= 4 ? 11 : 9;
  return `<rect x="1" y="1" width="38" height="38" rx="8" fill="${esc(color)}" stroke="#fff" stroke-width="2"/>
  <text x="20" y="21" text-anchor="middle" dominant-baseline="central" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="${fs}" fill="#fff">${esc(t)}</text>`;
}

function textIcon(t) {
  return badge(t, '#455a64');
}

function emoji(e) {
  return `<text x="20" y="22" text-anchor="middle" dominant-baseline="central" font-size="28">${esc(e)}</text>`;
}

// Restituisce l'SVG (stringa) per una specifica icona
export function iconSVG(spec, size = 40) {
  if (!spec) return wrap(box('default'), size);
  // immagine (logo): percorso nella cartella loghi/ oppure immagine caricata dall'utente (data:)
  if (String(spec).startsWith('img:')) {
    return wrap(`<image href="${esc(spec.slice(4))}" x="0" y="0" width="40" height="40" preserveAspectRatio="xMidYMid meet"/>`, size);
  }
  const [kind, a, b] = String(spec).split(':');
  switch (kind) {
    case 'limit': return wrap(limit(a), size);
    case 'velox': return wrap(velox(a), size);
    case 'fuel': return wrap(fuel(a), size);
    case 'warn': return wrap(warn(a), size);
    case 'box': return wrap(box(a), size);
    case 'ev': return wrap(ev(a), size);
    case 'badge': return wrap(badge(a, b || '#c62828'), size);
    case 'text': return wrap(textIcon(a), size);
    case 'emoji': return wrap(emoji(a), size);
    default: return wrap(emoji(spec), size); // stringa libera = emoji/testo
  }
}

// Icone pronte da scegliere nell'editor delle liste
export const ICON_GALLERY = [
  'box:incrocio', 'box:rotonda', 'box:ponte', 'box:galleria', 'box:localita', 'box:fine-localita',
  'box:riferimento', 'box:cippo', 'box:pl', 'box:sterrato', 'box:pave', 'box:stop', 'box:precedenza', 'box:default',
  'velox:alto', 'velox:basso', 'velox:finto', 'velox:',
  'fuel:', 'fuel:dx', 'fuel:sx',
  'ev:traffico', 'ev:polizia', 'ev:sosta', 'ev:lavori', 'ev:incidente', 'ev:deviazione', 'ev:meteo', 'ev:nota', 'ev:',
  'warn:dosso', 'warn:compressione', 'warn:bump', 'warn:strettoia', 'warn:dissestata', 'warn:curva', 'warn:generico',
  'limit:30', 'limit:40', 'limit:50', 'limit:60', 'limit:70', 'limit:80', 'limit:90', 'limit:100', 'limit:110', 'limit:120', 'limit:130',
  'badge:CO:#c62828', 'badge:START:#2e7d32', 'badge:STOP:#c62828', 'badge:FINE:#212121',
  'img:loghi/sport/co.png', 'img:loghi/sport/start.png', 'img:loghi/sport/fine.png', 'img:loghi/sport/stop.png', 'img:loghi/sport/int.png', 'img:loghi/sport/intplus.png', 'img:loghi/sport/ct.png', 'img:loghi/sport/parco.png', 'img:loghi/sport/media.png', 'img:loghi/sport/refuel.png', 'img:loghi/sport/vc-in.png', 'img:loghi/sport/vc-fine.png', 'img:loghi/sport/sz-in.png', 'img:loghi/sport/sz-fine.png', 'img:loghi/sport/tyre.png', 'img:loghi/reg/co.png', 'img:loghi/reg/ipm.png', 'img:loghi/reg/fpm.png', 'img:loghi/reg/ct.png', 'img:loghi/reg/preipm.png', 'img:loghi/reg/ipc.png', 'img:loghi/carburanti/eni.png', 'img:loghi/carburanti/q8.png', 'img:loghi/carburanti/ip.png', 'img:loghi/carburanti/esso.png', 'img:loghi/carburanti/tamoil.png', 'img:loghi/carburanti/shell.png', 'img:loghi/carburanti/beyfin.png', 'img:loghi/carburanti/bianca.png'
];

// Icona -> PNG (per KMZ)
export function iconPngBlob(spec, size = 64) {
  if (String(spec).startsWith('img:')) return imageToPng(spec.slice(4), size);
  return svgToPngBlob(iconSVG(spec, size), size);
}

function imageToPng(src, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const k = Math.min(size / img.naturalWidth, size / img.naturalHeight) || 1;
      const w = img.naturalWidth * k, h = img.naturalHeight * k;
      c.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png');
    };
    img.onerror = () => reject(new Error('Logo non trovato: ' + src));
    img.src = src;
  });
}

// Immagine caricata dall'utente -> PNG quadrato 128 px (data URL) da salvare nelle liste
export function fileToIconDataUrl(file, size = 128) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    imageToPng(url, size).then((b) => {
      URL.revokeObjectURL(url);
      const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(b);
    }, reject);
  });
}

// SVG -> PNG
export function svgToPngBlob(svg, size = 64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      c.getContext('2d').drawImage(img, 0, 0, size, size);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png');
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
