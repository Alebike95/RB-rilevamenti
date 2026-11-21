// Passaggi automatici sui punti della traccia di riferimento.
// Orario di passaggio = momento di minima distanza dal punto, calcolato sul tratto
// tra due letture GPS consecutive (cosi' e' preciso anche col GPS a 1 Hz).

const R_EARTH = 6371008.8;
const rad = Math.PI / 180;

// distanza minima tra il punto P e il segmento A->B (metri) + frazione lungo il segmento (0..1)
function closestOnSegment(p, a, b) {
  const k = Math.cos(p.lat * rad) * R_EARTH * rad;
  const ax = (a.lon - p.lon) * k, ay = (a.lat - p.lat) * R_EARTH * rad;
  const bx = (b.lon - p.lon) * k, by = (b.lat - p.lat) * R_EARTH * rad;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let f = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
  f = Math.max(0, Math.min(1, f));
  const x = ax + f * dx, y = ay + f * dy;
  return { d: Math.hypot(x, y), f };
}

function dist(p, a) {
  const k = Math.cos(p.lat * rad);
  return Math.hypot((a.lon - p.lon) * k, a.lat - p.lat) * R_EARTH * rad;
}

export class TransitDetector {
  constructor(points = [], radius = 30) {
    this.setPoints(points);
    this.radius = radius;
  }

  setPoints(points) {
    this.points = points;
    this.state = new Map(); // id -> { best }
  }

  /**
   * prev, cur: letture GPS { lat, lon, ts, speed }
   * ctx: { odo, odoB } valori trip al momento attuale
   * Restituisce l'elenco dei passaggi conclusi in questo aggiornamento.
   */
  update(prev, cur, ctx = {}) {
    const out = [];
    if (!cur) return out;
    const R = this.radius;
    const gap = prev ? cur.ts - prev.ts : Infinity;
    const usePrev = prev && gap < 30000;
    for (const p of this.points) {
      const dCur = dist(p, cur);
      const st = this.state.get(p.id);
      if (dCur > R + 400 && !st) continue; // lontano: niente calcoli
      let c;
      if (usePrev) c = closestOnSegment(p, prev, cur);
      else c = { d: dCur, f: 1 };
      if (c.d <= R) {
        const t = usePrev ? prev.ts + c.f * gap : cur.ts;
        const spd = usePrev && prev.speed != null && cur.speed != null ? prev.speed + c.f * (cur.speed - prev.speed) : cur.speed;
        // il trip cresce durante il tratto: si toglie la parte dopo il punto di minima distanza
        const segLen = usePrev ? dist(prev, cur) : 0;
        const back = segLen * (1 - c.f);
        const cand = { d: c.d, t, speed: spd, odo: ctx.odo != null ? ctx.odo - back : null, odoB: ctx.odoB != null ? ctx.odoB - back : null, src: cur.src };
        if (!st) this.state.set(p.id, { best: cand });
        else if (cand.d < st.best.d) st.best = cand;
      }
      // uscito dal cerchio (con 10 m di margine) o GPS perso a lungo: passaggio concluso
      const st2 = this.state.get(p.id);
      if (st2 && (dCur > R + 10 || !usePrev && prev)) {
        this.state.delete(p.id);
        out.push({ point: p, ...st2.best });
      }
    }
    return out;
  }
}

// Estrae i punti (Placemark con Point) da un KML, con il nome della cartella che li contiene
export function kmlPoints(dom) {
  const out = [];
  const pms = dom.getElementsByTagName('Placemark');
  let i = 0;
  for (const pm of pms) {
    const pt = pm.getElementsByTagName('Point')[0];
    if (!pt) continue;
    const co = pt.getElementsByTagName('coordinates')[0]?.textContent.trim();
    if (!co) continue;
    const [lon, lat] = co.split(/[\s,]+/).map(Number);
    if (isNaN(lat) || isNaN(lon)) continue;
    const name = directChild(pm, 'name')?.textContent.trim() || `Punto ${i + 1}`;
    let folder = '';
    for (let e = pm.parentElement; e; e = e.parentElement) {
      if (e.tagName === 'Folder') { folder = directChild(e, 'name')?.textContent.trim() || ''; break; }
    }
    out.push({ id: 'r' + i++, name, folder, lat, lon });
  }
  return out;
}

function directChild(el, tag) {
  for (const c of el.children) if (c.tagName === tag) return c;
  return null;
}

export function gmapsUrl(lat, lon) {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

// breve bip (senza file audio)
let actx = null;
export function beep(freq = 1200, ms = 140) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(0.25, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + ms / 1000);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + ms / 1000);
  } catch (e) { /* audio non disponibile */ }
}
