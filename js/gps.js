// Gestione posizione: GPS interno, RaceBox (Bluetooth LE) e ricevitori NMEA
// via porta seriale Bluetooth (es. Garmin GLO). Fornisce anche il contachilometri (trip).

const UART_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';

export function haversine(a, b) {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ---------- RaceBox ----------
const u16 = (d, o) => d[o] | (d[o + 1] << 8);
const i16 = (d, o) => { const v = u16(d, o); return v > 32767 ? v - 65536 : v; };
const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const i32 = (d, o) => d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24);

function rbChecksumOk(m) {
  let a = 0, b = 0;
  for (let i = 2; i < m.length - 2; i++) { a = (a + m[i]) & 0xff; b = (b + a) & 0xff; }
  return a === m[m.length - 2] && b === m[m.length - 1];
}

function rbParse(d) {
  if (d[2] !== 0xff || d[3] !== 0x01) return null;
  const p = 6;
  const fixType = d[p + 20];
  const raw = d[p + 67];
  // ora GPS del pacchetto (UTC): permette orari giusti anche se i dati arrivano in ritardo (schermo spento)
  const valid = d[p + 11];
  let time = null;
  if ((valid & 0x03) === 0x03) {
    time = Date.UTC(u16(d, p + 4), d[p + 6] - 1, d[p + 7], d[p + 8], d[p + 9], d[p + 10]) + i32(d, p + 16) / 1e6;
  }
  return {
    time,
    fixOk: fixType >= 2,
    sats: d[p + 23],
    lon: i32(d, p + 24) * 1e-7,
    lat: i32(d, p + 28) * 1e-7,
    alt: i32(d, p + 36) / 1000,
    acc: u32(d, p + 40) / 1000,
    speed: (i32(d, p + 48) / 1000) * 3.6,
    heading: i32(d, p + 52) / 1e5,
    battery: raw & 0x7f,
    gx: i16(d, p + 68) / 1000
  };
}

// ---------- NMEA ----------
function nmeaCoord(v, h) {
  if (!v) return null;
  const dot = v.indexOf('.');
  const deg = parseFloat(v.slice(0, dot - 2));
  const min = parseFloat(v.slice(dot - 2));
  let x = deg + min / 60;
  if (h === 'S' || h === 'W') x = -x;
  return x;
}

function nmeaOk(line) {
  const star = line.indexOf('*');
  if (line[0] !== '$' || star < 0) return false;
  let cs = 0;
  for (let i = 1; i < star; i++) cs ^= line.charCodeAt(i);
  return cs === parseInt(line.slice(star + 1, star + 3), 16);
}

export class Gps extends EventTarget {
  constructor() {
    super();
    this.fix = null;            // ultima posizione valida
    this.source = 'internal';   // internal | racebox | nmea | sim
    this.status = { internal: 'off', racebox: 'off', nmea: 'off', sim: 'off' };
    this.extLastTs = 0;
    this.odo = 0;               // trip A, metri
    this.odoB = 0;              // trip B, metri
    this.cal = 0;               // taratura: metri da aggiungere (+) o togliere (-) ogni km
    this._odoLast = null;
    this._hz = [];
    this._gga = {};
    this._watchId = null;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  setStatus(src, st, msg) {
    this.status[src] = st;
    this.emit('status', { src, st, msg });
  }

  // ---- posizione ricevuta da qualunque sorgente ----
  _push(src, f) {
    const now = Date.now();
    // ts = ora del dato (ora GPS se disponibile e sensata), rx = ora di arrivo sul dispositivo
    const ts = f.time != null && Math.abs(f.time - now) < 86400000 ? Math.round(f.time) : now;
    if (src !== 'internal') this.extLastTs = now;
    // se un ricevitore esterno e' attivo (dati < 3 s), il GPS interno viene ignorato
    if (src === 'internal' && now - this.extLastTs < 3000) return;
    this._hz.push(now);
    while (this._hz.length && now - this._hz[0] > 1000) this._hz.shift();
    const fix = { ...f, src, ts, rx: now, hz: this._hz.length };
    this.source = src;
    this.fix = fix;
    this._odometer(fix);
    this.emit('fix', fix);
  }

  _odometer(f) {
    if (f.acc != null && f.acc > 30) return;
    if (!this._odoLast) { this._odoLast = f; return; }
    const d = haversine(this._odoLast, f);
    const moving = f.speed != null ? f.speed > 2 && d > 0.3 : d > Math.max(3, (f.acc || 5) * 0.8);
    if (!moving) return;
    const dt = f.ts - this._odoLast.ts;
    if (d > 500 && dt < 5000) { this._odoLast = f; return; } // salto anomalo
    const dc = d * (1 + this.cal / 1000);
    this.odo += dc;
    this.odoB += dc;
    const from = this._odoLast;
    this._odoLast = f;
    this.emit('odo', this.odo);
    // segnale perso e ripreso (galleria): l'app prova a sostituire la linea dritta con la strada vera
    if (dt > 4000 && d > 50) this.emit('gap', { a: from, b: f, d, dt });
  }

  // correzione aggiunta dopo (es. galleria): vale per entrambi i trip
  addCorrection(meters) {
    const m = meters * (1 + this.cal / 1000);
    this.odo += m; this.odoB += m;
    this.emit('odo', this.odo);
    return m;
  }

  setOdo(meters, which = 'A') {
    if (which === 'B') this.odoB = Math.max(0, meters); else this.odo = Math.max(0, meters);
    this._odoLast = this.fix; this.emit('odo', this.odo);
  }

  // ---- GPS interno ----
  startInternal() {
    if (!navigator.geolocation) { this.setStatus('internal', 'err', 'GPS non disponibile'); return; }
    if (this._watchId != null) return;
    this.setStatus('internal', 'wait', 'Ricerca satelliti…');
    this._watchId = navigator.geolocation.watchPosition(
      (p) => {
        const c = p.coords;
        this.setStatus('internal', 'on');
        this._push('internal', {
          time: p.timestamp, lat: c.latitude, lon: c.longitude, alt: c.altitude, acc: c.accuracy,
          speed: c.speed != null ? c.speed * 3.6 : null, heading: c.heading
        });
      },
      (e) => this.setStatus('internal', 'err', e.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  }

  // ---- RaceBox (Web Bluetooth) ----
  async connectRacebox() {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth non disponibile su questo browser (usa Chrome/Edge).');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'RaceBox' }],
      optionalServices: [UART_SERVICE]
    });
    this._rbDevice = device;
    device.addEventListener('gattserverdisconnected', () => {
      this.setStatus('racebox', 'err', 'RaceBox disconnesso');
      // tentativo di riconnessione automatica
      setTimeout(() => this._rbConnectGatt().catch(() => {}), 2000);
    });
    await this._rbConnectGatt();
  }

  async _rbConnectGatt() {
    const device = this._rbDevice;
    if (!device) return;
    this.setStatus('racebox', 'wait', 'Connessione a ' + (device.name || 'RaceBox') + '…');
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(UART_SERVICE);
    const tx = await service.getCharacteristic(UART_TX);
    let buf = new Uint8Array(0);
    tx.addEventListener('characteristicvaluechanged', (e) => {
      const chunk = new Uint8Array(e.target.value.buffer);
      const n = new Uint8Array(buf.length + chunk.length); n.set(buf); n.set(chunk, buf.length); buf = n;
      while (buf.length >= 6) {
        if (buf[0] !== 0xb5 || buf[1] !== 0x62) { buf = buf.slice(1); continue; }
        const len = 6 + u16(buf, 4) + 2;
        if (buf.length < len) break;
        const msg = buf.slice(0, len); buf = buf.slice(len);
        if (!rbChecksumOk(msg)) continue;
        const r = rbParse(msg);
        if (!r) continue;
        this.status.racebox = r.fixOk ? 'on' : 'wait';
        this.rbInfo = { battery: r.battery, sats: r.sats, name: device.name };
        if (r.fixOk) this._push('racebox', r);
        else this.emit('status', { src: 'racebox', st: 'wait', msg: `RaceBox senza fix (${r.sats} sat)` });
      }
    });
    await tx.startNotifications();
    this.setStatus('racebox', 'wait', 'RaceBox connesso, attesa fix…');
  }

  disconnectRacebox() {
    const d = this._rbDevice; this._rbDevice = null;
    if (d && d.gatt.connected) d.gatt.disconnect();
    this.setStatus('racebox', 'off');
  }

  // ---- NMEA via porta seriale (Garmin GLO e simili) ----
  async connectSerial() {
    if (!navigator.serial) throw new Error('Porta seriale non disponibile su questo browser. Su Windows usa Chrome/Edge; su Android serve Chrome recente.');
    let port;
    try {
      port = await navigator.serial.requestPort({ allowedBluetoothServiceClassIds: [SPP_UUID] });
    } catch (e) {
      if (e.name === 'TypeError') port = await navigator.serial.requestPort(); // browser senza filtro BT
      else throw e;
    }
    await port.open({ baudRate: 115200 });
    this._serialPort = port;
    this.setStatus('nmea', 'wait', 'Ricevitore collegato, attesa dati…');
    this._readSerial(port);
  }

  async _readSerial(port) {
    const decoder = new TextDecoderStream();
    port.readable.pipeTo(decoder.writable).catch(() => {});
    const reader = decoder.readable.getReader();
    this._serialReader = reader;
    let acc = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += value;
        let i;
        while ((i = acc.indexOf('\n')) >= 0) {
          const line = acc.slice(0, i).trim(); acc = acc.slice(i + 1);
          if (line) this._nmeaLine(line);
        }
        if (acc.length > 4096) acc = '';
      }
    } catch (e) {
      this.setStatus('nmea', 'err', 'Ricevitore scollegato: ' + e.message);
    }
  }

  _nmeaLine(line) {
    if (!nmeaOk(line)) return;
    const f = line.slice(0, line.indexOf('*')).split(',');
    const t = f[0].slice(3);
    if (t === 'GGA') {
      this._gga = { q: +f[6], sats: +f[7], hdop: parseFloat(f[8]), alt: parseFloat(f[9]) };
    } else if (t === 'RMC') {
      if (f[2] !== 'A') { this.emit('status', { src: 'nmea', st: 'wait', msg: 'Ricevitore senza fix' }); return; }
      const lat = nmeaCoord(f[3], f[4]), lon = nmeaCoord(f[5], f[6]);
      if (lat == null || lon == null) return;
      const g = this._gga;
      this.status.nmea = 'on';
      let time = null;
      if (f[1] && f[9] && f[9].length === 6) {
        const hh = +f[1].slice(0, 2), mm = +f[1].slice(2, 4), ss = parseFloat(f[1].slice(4));
        time = Date.UTC(2000 + +f[9].slice(4, 6), +f[9].slice(2, 4) - 1, +f[9].slice(0, 2), hh, mm, 0) + ss * 1000;
      }
      this._push('nmea', {
        time, lat, lon, alt: isNaN(g.alt) ? null : g.alt,
        acc: g.hdop ? Math.round(g.hdop * 3 * 10) / 10 : null,
        speed: f[7] ? parseFloat(f[7]) * 1.852 : null,
        heading: f[8] ? parseFloat(f[8]) : null,
        sats: g.sats
      });
    }
  }

  async disconnectSerial() {
    try { await this._serialReader?.cancel(); } catch (e) { /* */ }
    try { await this._serialPort?.close(); } catch (e) { /* */ }
    this._serialPort = null;
    this.setStatus('nmea', 'off');
  }

  // ---- Simulatore (per provare in ufficio) ----
  toggleSim(on, start) {
    clearInterval(this._simT);
    if (!on) { this.setStatus('sim', 'off'); return; }
    let lat = start?.lat ?? 43.8, lon = start?.lon ?? 11.25, hd = 45, t = 0;
    this.setStatus('sim', 'on');
    this._simT = setInterval(() => {
      t++;
      hd += Math.sin(t / 15) * 4;
      const v = 40 + 25 * Math.sin(t / 20); // km/h
      const d = v / 3.6 / 5; // passo a 5 Hz
      lat += (d * Math.cos(hd * Math.PI / 180)) / 111320;
      lon += (d * Math.sin(hd * Math.PI / 180)) / (111320 * Math.cos(lat * Math.PI / 180));
      this._push('sim', { lat, lon, alt: 100, acc: 2, speed: v, heading: (hd + 360) % 360 });
    }, 200);
  }
}
