/* Meteo Nord Italia - Tramonto e alba "reali".
   Dal punto scelto (o dalla posizione GPS in tempo reale) si percorre il terreno in 1.121 direzioni
   fino a 160 km con il modello del rilievo, tenendo conto di curvatura terrestre e rifrazione:
   si ottiene l'orizzonte vero (montagne, colline, valli) e quindi l'istante in cui il sole
   sparisce davvero dietro un crinale, non quello del tramonto "sul mare". */
(() => {
  'use strict';
  const D2R = Math.PI / 180, RE = 6371000, K_REFR = 0.13;
  const AZ0 = 40, AZ1 = 320, AZ_STEP = 0.25, NB = Math.round((AZ1 - AZ0) / AZ_STEP) + 1;
  const NEAR_D = 200, MAX_D = 160000, EYE = 2;
  const SN = { req: -1, mode: 'set', day: null, pt: null, follow: false, watch: null, gpsAcc: null, hor: null, job: 0,
    status: '', err: '', ev: new Map(), timer: 0, peaks: new Map() };

  /* ---------- posizione del sole (algoritmo NOAA) ---------- */
  function sunPos(ms, lat, lon) {
    const jd = ms / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T), e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(M * D2R) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * D2R) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * D2R) * 0.000289;
    const om = 125.04 - 1934.136 * T, lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * D2R);
    const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * D2R);
    const dec = Math.asin(Math.sin(eps * D2R) * Math.sin(lam * D2R)), y = Math.tan((eps * D2R) / 2) ** 2;
    const eqt = (4 / D2R) * (y * Math.sin(2 * L0 * D2R) - 2 * e * Math.sin(M * D2R) + 4 * e * y * Math.sin(M * D2R) * Math.cos(2 * L0 * D2R)
      - 0.5 * y * y * Math.sin(4 * L0 * D2R) - 1.25 * e * e * Math.sin(2 * M * D2R));
    const ha = ((((ms / 60000) % 1440) + eqt + 4 * lon) / 4 - 180) * D2R, la = lat * D2R;
    const el = Math.asin(Math.max(-1, Math.min(1, Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)))) / D2R;
    const az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) / D2R + 540) % 360;
    return { el, az };
  }
  // altezza apparente (rifrazione astronomica, formula di Saemundsson)
  const appEl = (el) => { const h = Math.max(el, -1); return el + Math.max(0, 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * D2R) / 60); };

  /* ---------- rilievo: tasselli Terrarium (SRTM e altri, AWS Open Data) ---------- */
  const DEMT = new Map();
  const tkey = (z, x, y) => (z * 8192 + x) * 8192 + y;
  const mercX = (lon, z) => ((lon + 180) / 360) * 256 * 2 ** z;
  const mercY = (lat, z) => { const s = Math.sin(lat * D2R); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** z; };
  const zoomFor = (d) => (d < 3500 ? 12 : d < 22000 ? 10 : 8);

  async function loadTile(k) {
    if (DEMT.has(k)) return;
    DEMT.set(k, null);
    const y = k % 8192, x = Math.floor(k / 8192) % 8192, z = Math.floor(k / 8192 / 8192);
    try {
      const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`);
      if (!r.ok) throw new Error('tassello ' + r.status);
      const blob = await r.blob();
      let img;
      try { img = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); } catch (e) {
        img = await new Promise((ok, ko) => { const im = new Image(); im.onload = () => ok(im); im.onerror = ko; im.src = URL.createObjectURL(blob); });
      }
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, 256, 256).data, a = new Float32Array(65536);
      for (let i = 0; i < 65536; i++) a[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
      DEMT.set(k, a);
    } catch (e) { DEMT.set(k, false); }
  }
  let lastK = -1, lastA = null;
  function pix(z, gx, gy) {
    const k = tkey(z, gx >> 8, gy >> 8);
    if (k !== lastK) { lastK = k; lastA = DEMT.get(k) || null; }
    return lastA ? lastA[((gy & 255) << 8) | (gx & 255)] : NaN;
  }
  function elev(lon, lat, z) {
    const x = mercX(lon, z) - 0.5, y = mercY(lat, z) - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const a = pix(z, x0, y0), b = pix(z, x0 + 1, y0), c = pix(z, x0, y0 + 1), d = pix(z, x0 + 1, y0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  function dest(lat, lon, az, d) {
    const p1 = lat * D2R, l1 = lon * D2R, t = az * D2R, dl = d / RE;
    const sp2 = Math.sin(p1) * Math.cos(dl) + Math.cos(p1) * Math.sin(dl) * Math.cos(t), p2 = Math.asin(sp2);
    return [(l1 + Math.atan2(Math.sin(t) * Math.sin(dl) * Math.cos(p1), Math.cos(dl) - Math.sin(p1) * sp2)) / D2R, p2 / D2R];
  }

  // distanze di campionamento: fitte vicino, poi crescono dello 0,55% (circa un pixel del rilievo)
  const DISTS = (() => { const a = []; let d = NEAR_D; while (d < MAX_D) { a.push(d); d += Math.max(25, d * 0.0055); } return Float64Array.from(a); })();
  const SD = DISTS.map((d) => Math.sin(d / RE)), CD = DISTS.map((d) => Math.cos(d / RE));
  const DROP = DISTS.map((d) => (d * d * (1 - K_REFR)) / (2 * RE)), ZD = DISTS.map(zoomFor);

  async function computeHorizon(pt, progress) {
    // 1) tasselli necessari (solo il settore dove il sole puo' trovarsi, da NE a NO passando per sud)
    const need = new Set();
    const add = (lon, lat, z) => {
      const x = mercX(lon, z), y = mercY(lat, z);
      for (const dx of [-1, 1]) for (const dy of [-1, 1]) need.add(tkey(z, Math.floor((x + dx) / 256), Math.floor((y + dy) / 256)));
    };
    for (const z of [12, 10, 8]) add(pt.lon, pt.lat, z);
    for (let az = AZ0 - 1; az <= AZ1 + 1; az += 1) for (let i = 0; i < DISTS.length; i += 3) { const [lo, la] = dest(pt.lat, pt.lon, az, DISTS[i]); add(lo, la, ZD[i]); }
    const list = [...need].filter((k) => !(DEMT.get(k) instanceof Float32Array));
    let done = need.size - list.length;
    if (DEMT.size > 260) DEMT.clear();
    progress(`Scarico il rilievo… ${Math.round((done / need.size) * 100)}%`);
    let next = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (next < list.length) { const k = list[next++]; await loadTile(k); done++; progress(`Scarico il rilievo… ${Math.round((done / need.size) * 100)}%`); }
    }));
    lastK = -1;
    // 2) quota del punto
    let h0 = NaN;
    for (const z of [12, 10, 8]) { h0 = elev(pt.lon, pt.lat, z); if (h0 === h0) break; }
    if (h0 !== h0) throw new Error('Rilievo non disponibile per questo punto: controlla la connessione e riprova.');
    const o = { sp: Math.sin(pt.lat * D2R), cp: Math.cos(pt.lat * D2R), l: pt.lon * D2R, h: h0 + EYE };
    // 3) un raggio per ogni direzione
    const H = { lat: pt.lat, lon: pt.lon, h0, ang: new Float32Array(NB), dist: new Float32Array(NB), hpk: new Float32Array(NB),
      plat: new Float32Array(NB), plon: new Float32Array(NB) };
    for (let b = 0; b < NB; b++) {
      const t = (AZ0 + b * AZ_STEP) * D2R, st = Math.sin(t), ct = Math.cos(t);
      let best = -Infinity, bi = -1, bh = 0, bla = 0, blo = 0;
      for (let i = 0; i < DISTS.length; i++) {
        const sp2 = o.sp * CD[i] + o.cp * SD[i] * ct, p2 = Math.asin(sp2);
        const lon = (o.l + Math.atan2(st * SD[i] * o.cp, CD[i] - o.sp * sp2)) / D2R, lat = p2 / D2R;
        const h = elev(lon, lat, ZD[i]);
        if (h !== h) continue;
        const a = (h - o.h - DROP[i]) / DISTS[i];
        if (a > best) { best = a; bi = i; bh = h; bla = lat; blo = lon; }
      }
      H.ang[b] = bi < 0 ? -0.5 : Math.atan(best) / D2R;
      H.dist[b] = bi < 0 ? 0 : DISTS[bi]; H.hpk[b] = bh; H.plat[b] = bla; H.plon[b] = blo;
      if (b % 70 === 69) { progress(`Calcolo l’orizzonte… ${Math.round((b / NB) * 100)}%`); await new Promise((r) => setTimeout(r)); }
    }
    return H;
  }
  function horAt(H, az) {
    if (az < AZ0 || az > AZ1) return -2; // a queste latitudini il sole li' e' comunque sotto l'orizzonte
    const f = (az - AZ0) / AZ_STEP, i = Math.min(NB - 2, Math.floor(f)), t = f - i;
    return H.ang[i] * (1 - t) + H.ang[i + 1] * t;
  }
  const bin = (az) => Math.max(0, Math.min(NB - 1, Math.round((az - AZ0) / AZ_STEP)));

  /* ---------- eventi della giornata ---------- */
  const LV = { astro: -0.833, civ: -6, blue: -4, gold: 6 };
  function dayEvents(H, day) {
    const key = `${day.y}-${day.m}-${day.d}`;
    if (SN.ev.has(key)) return SN.ev.get(key);
    const t0 = new Date(day.y, day.m, day.d).getTime(), t1 = new Date(day.y, day.m, day.d + 1).getTime();
    const vis = (t) => { const p = sunPos(t, H.lat, H.lon); return appEl(p.el) + 0.267 - horAt(H, p.az); }; // bordo superiore del disco
    const cross = (g, a, b) => { let ga = g(a); for (let k = 0; k < 16; k++) { const m = (a + b) / 2, gm = g(m); if (gm > 0 === ga > 0) { a = m; ga = gm; } else b = m; } return (a + b) / 2; };
    const ev = { t0, t1, rises: [], sets: [], path: [], lv: {}, noonEl: -90 };
    for (const k in LV) ev.lv[k] = { up: null, down: null };
    let pv = null, pe = null;
    for (let t = t0; t <= t1; t += 60000) {
      const p = sunPos(t, H.lat, H.lon), v = appEl(p.el) + 0.267 - horAt(H, p.az);
      if ((t - t0) % 120000 === 0) ev.path.push([t, p.az, appEl(p.el), v > 0]);
      if (pv != null) {
        if (pv > 0 !== v > 0) (v > 0 ? ev.rises : ev.sets).push(cross(vis, t - 60000, t));
        for (const k in LV) if (pe > LV[k] !== p.el > LV[k]) ev.lv[k][p.el > LV[k] ? 'up' : 'down'] = cross((x) => sunPos(x, H.lat, H.lon).el - LV[k], t - 60000, t);
      }
      if (p.el > ev.noonEl) { ev.noonEl = p.el; ev.noon = t; }
      pv = v; pe = p.el;
    }
    ev.first = ev.rises[0] ?? null;
    ev.last = ev.sets.length ? ev.sets[ev.sets.length - 1] : null;
    let direct = 0;
    ev.rises.forEach((r) => { const s = ev.sets.find((x) => x > r); direct += (s ?? t1) - r; });
    ev.direct = direct;
    SN.ev.set(key, ev);
    return ev;
  }

  /* ---------- utilita' ---------- */
  const today = () => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth(), d: n.getDate() }; };
  const sameDay = (a, b) => a.y === b.y && a.m === b.m && a.d === b.d;
  const shiftDay = (a, n) => { const t = new Date(a.y, a.m, a.d + n); return { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() }; };
  const dayLabel = (a) => {
    const t = today();
    if (sameDay(a, t)) return 'Oggi';
    if (sameDay(a, shiftDay(t, 1))) return 'Domani';
    if (sameDay(a, shiftDay(t, -1))) return 'Ieri';
    return new Date(a.y, a.m, a.d).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
  };
  const T = (ms) => (ms == null ? '—' : hm(new Date(ms)));
  const dshort = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad2(m % 60)}`; };
  const deg = (v) => fmt(v, 1) + '°';
  const km = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${fmt(m / 1000, m < 10000 ? 1 : 0)} km`);
  const quota = (m) => Math.round(m).toLocaleString('it-IT') + ' m';
  const active = () => SN.req === panelReq && !$('panel').hidden;

  /* ---------- cime con il nome (OpenStreetMap) ---------- */
  async function peakNear(lat, lon, h) {
    const key = lat.toFixed(3) + ',' + lon.toFixed(3);
    if (SN.peaks.has(key)) return SN.peaks.get(key);
    SN.peaks.set(key, null);
    try {
      const q = `[out:json][timeout:10];node(around:2500,${lat.toFixed(5)},${lon.toFixed(5)})[natural=peak][name];out 40;`;
      let r = null;
      for (const host of ['https://overpass-api.de', 'https://overpass.private.coffee']) {
        const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 9000);
        try {
          r = await fetch(host + '/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ac.signal,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).then((x) => x.json());
        } catch (e) { r = null; } finally { clearTimeout(tm); }
        if (r) break;
      }
      if (!r) throw new Error('nomi delle cime non disponibili');
      let best = null, bs = Infinity;
      for (const n of r.elements || []) {
        const d = Math.hypot((n.lon - lon) * Math.cos(lat * D2R) * 111.2, (n.lat - lat) * 111.2), e = parseFloat(n.tags.ele);
        const s = d + (e === e ? Math.abs(e - h) / 300 : 0.8);
        if (s < bs) { bs = s; best = { name: n.tags['name:it'] || n.tags.name, ele: e === e ? e : null, d }; }
      }
      SN.peaks.set(key, best);
      return best;
    } catch (e) { return null; } // resta null: niente nuovi tentativi per lo stesso crinale
  }

  /* ---------- cielo previsto al tramonto (nubi dal modello) ---------- */
  function skyAt(pt, tEv, az) {
    const g = S.grid;
    if (!g || tEv == null) return null;
    const ts = tEv / 1000;
    if (ts < g.times[0] - 3600 || ts > g.times[g.times.length - 1] + 3 * 3600) return null;
    const ti = g.times.reduce((b, x, i) => (Math.abs(x - ts) < Math.abs(g.times[b] - ts) ? i : b), 0);
    const L = f32('cloud_cover_low', ti), M = f32('cloud_cover_mid', ti), Hh = f32('cloud_cover_high', ti);
    const at = (a, lon, lat) => pointBil(a, g, lon, lat);
    const o = { low: at(L, pt.lon, pt.lat), mid: at(M, pt.lon, pt.lat), high: at(Hh, pt.lon, pt.lat) };
    if (![o.low, o.mid, o.high].every((v) => v === v)) return null;
    const lows = [20000, 50000, 90000].map((d) => { const [lo, la] = dest(pt.lat, pt.lon, az, d); return at(L, lo, la); }).filter((v) => v === v);
    const lowW = lows.length ? Math.max(...lows) : o.low, up = Math.min(100, Math.max(o.mid, o.high));
    let txt, cls;
    if (lowW >= 70 || o.low >= 85) { txt = `Probabilmente <b>coperto</b>: nubi basse verso il sole (${Math.round(lowW)}%)`; cls = 'l2'; }
    else if (up >= 25 && up <= 85 && lowW < 45) { txt = `<b>Buone probabilità di cielo colorato</b>: nubi medie e alte ${Math.round(up)}% e poche nubi basse verso il sole`; cls = 'l0'; }
    else if (up < 25 && lowW < 35) { txt = '<b>Cielo limpido</b>: sole ben visibile, colori più tenui'; cls = 'l0'; }
    else { txt = `<b>Visibile a tratti</b>: nubi basse verso il sole ${Math.round(lowW)}%, medie e alte ${Math.round(up)}%`; cls = 'l1'; }
    return { txt, cls, o, lowW, when: g.times[ti] * 1000 };
  }

  /* ---------- mappa ---------- */
  function ensureLayers() {
    if (map.getSource('sun-pts')) return;
    const empty = { type: 'FeatureCollection', features: [] };
    map.addSource('sun-sky', { type: 'geojson', data: empty });
    map.addSource('sun-ray', { type: 'geojson', data: empty });
    map.addSource('sun-pts', { type: 'geojson', data: empty });
    map.addLayer({ id: 'sun-sky', type: 'circle', source: 'sun-sky', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 1.6, 12, 3], 'circle-color': '#ff9f0a', 'circle-opacity': 0.85 } });
    map.addLayer({ id: 'sun-ray', type: 'line', source: 'sun-ray', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ff9f0a', 'line-width': 3, 'line-dasharray': [1.5, 1.5] } });
    map.addLayer({ id: 'sun-dot', type: 'circle', source: 'sun-pts', paint: { 'circle-radius': ['match', ['get', 'k'], 'obs', 8, 7], 'circle-color': ['match', ['get', 'k'], 'obs', '#007aff', '#ff9f0a'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } });
    map.addLayer({ id: 'sun-label', type: 'symbol', source: 'sun-pts', layout: { 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 12.5, 'text-offset': [0, -1.2], 'text-anchor': 'bottom', 'text-allow-overlap': true },
      paint: { 'text-color': DARK ? '#fff' : '#1d1d1f', 'text-halo-color': DARK ? 'rgba(0,0,0,.85)' : '#fff', 'text-halo-width': 2 } });
  }
  function clearLayers() {
    const empty = { type: 'FeatureCollection', features: [] };
    for (const s of ['sun-sky', 'sun-ray', 'sun-pts']) if (map.getSource && map.getSource(s)) map.getSource(s).setData(empty);
  }
  function drawMap(fit) {
    if (!map.getSource('sun-pts') && !map.isStyleLoaded()) { map.once('load', () => { if (active()) drawMap(fit); }); return; }
    ensureLayers();
    const H = SN.hor, pt = SN.pt;
    const feats = [{ type: 'Feature', geometry: { type: 'Point', coordinates: [pt.lon, pt.lat] }, properties: { k: 'obs', label: '' } }];
    if (!H) { map.getSource('sun-pts').setData({ type: 'FeatureCollection', features: feats }); return; }
    const ev = dayEvents(H, SN.day), w = SN.win, tEv = SN.mode === 'set' ? ev.last : ev.first;
    const sky = [];
    for (let b = bin(w.a0); b <= bin(w.a1); b += 2) if (H.dist[b] > 0) sky.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [H.plon[b], H.plat[b]] } });
    map.getSource('sun-sky').setData({ type: 'FeatureCollection', features: sky });
    let ray = { type: 'FeatureCollection', features: [] };
    if (tEv != null) {
      const b = bin(sunPos(tEv, H.lat, H.lon).az);
      if (H.dist[b] > 0) {
        ray = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[pt.lon, pt.lat], [H.plon[b], H.plat[b]]] } };
        feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [H.plon[b], H.plat[b]] },
          properties: { k: 'peak', label: flatAt(H, tEv) ? `Direzione del sole · ${T(tEv)}` : `${SN.mode === 'set' ? 'Tramonta qui' : 'Spunta qui'} · ${T(tEv)}` } });
      }
    }
    map.getSource('sun-ray').setData(ray);
    map.getSource('sun-pts').setData({ type: 'FeatureCollection', features: feats });
    if (fit) {
      const bnd = new maplibregl.LngLatBounds([pt.lon, pt.lat], [pt.lon, pt.lat]);
      if (ray.geometry) bnd.extend(ray.geometry.coordinates[1]);
      const ph = $('panel').offsetHeight + 14;
      map.fitBounds(bnd, { padding: MOBILE ? { top: 130, bottom: Math.min(ph, innerHeight - 260), left: 50, right: 50 } : { top: 110, bottom: 190, left: 260, right: 450 }, maxZoom: 12.5, duration: 700 });
    }
  }

  /* ---------- finestra del panorama ---------- */
  function computeWindow() {
    const H = SN.hor, ev = dayEvents(H, SN.day), set = SN.mode === 'set';
    const tEv = set ? ev.last ?? ev.lv.astro.down : ev.first ?? ev.lv.astro.up;
    const azc = tEv != null ? sunPos(tEv, H.lat, H.lon).az : set ? 250 : 110;
    let a0 = set ? azc - 48 : azc - 22, a1 = set ? azc + 22 : azc + 48;
    if (a0 < AZ0) { a1 += AZ0 - a0; a0 = AZ0; }
    if (a1 > AZ1) { a0 -= a1 - AZ1; a1 = AZ1; }
    let hmax = -90, hmin = 90;
    for (let b = bin(a0); b <= bin(a1); b++) { hmax = Math.max(hmax, H.ang[b]); hmin = Math.min(hmin, H.ang[b]); }
    const ymin = Math.min(hmin, -1) - 0.8, ymax = Math.max(hmax + 4.5, ymin + 9);
    SN.win = { a0, a1, ymin, ymax, tEv };
  }

  function drawPano() {
    const cv = $('sunCv');
    if (!cv || !SN.hor || !SN.win) return;
    const W = cv.clientWidth, Hc = cv.clientHeight, dpr = devicePixelRatio || 1;
    if (!W) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(Hc * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const H = SN.hor, w = SN.win, ev = dayEvents(H, SN.day);
    const X = (az) => ((az - w.a0) / (w.a1 - w.a0)) * W, Y = (el) => Hc - ((el - w.ymin) / (w.ymax - w.ymin)) * Hc;
    // cielo
    const sk = g.createLinearGradient(0, 0, 0, Hc);
    if (DARK) { sk.addColorStop(0, '#14305a'); sk.addColorStop(0.55, '#3d4f86'); sk.addColorStop(1, '#e8925c'); }
    else { sk.addColorStop(0, '#8dbbeb'); sk.addColorStop(0.6, '#d3e4f6'); sk.addColorStop(1, '#ffcf98'); }
    g.fillStyle = sk; g.fillRect(0, 0, W, Hc);
    // griglia: gradi e punti cardinali
    g.font = '600 10px -apple-system, system-ui, sans-serif';
    g.fillStyle = DARK ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)';
    g.strokeStyle = DARK ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)';
    g.lineWidth = 1;
    const span = w.ymax - w.ymin, stp = span > 24 ? 10 : span > 12 ? 5 : 2;
    for (let e = Math.ceil(w.ymin / stp) * stp; e <= w.ymax; e += stp) {
      if (e === 0) continue;
      g.beginPath(); g.moveTo(0, Y(e)); g.lineTo(W, Y(e)); g.stroke();
      g.fillText(e + '°', 4, Y(e) - 3);
    }
    g.save(); g.setLineDash([4, 4]); g.strokeStyle = DARK ? 'rgba(255,255,255,.45)' : 'rgba(0,0,0,.35)';
    g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(W, Y(0)); g.stroke(); g.restore();
    // rilievo
    const tg = g.createLinearGradient(0, Y(w.ymax - span * 0.35), 0, Hc);
    tg.addColorStop(0, DARK ? '#151b28' : '#3b4757'); tg.addColorStop(1, DARK ? '#06080d' : '#1c232d');
    g.beginPath(); g.moveTo(0, Hc);
    const b0 = bin(w.a0), b1 = bin(w.a1);
    for (let b = b0; b <= b1; b++) g.lineTo(X(AZ0 + b * AZ_STEP), Y(H.ang[b]));
    g.lineTo(W, Hc); g.closePath(); g.fillStyle = tg; g.fill();
    g.beginPath();
    for (let b = b0; b <= b1; b++) g[b === b0 ? 'moveTo' : 'lineTo'](X(AZ0 + b * AZ_STEP), Y(H.ang[b]));
    g.strokeStyle = DARK ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.8)'; g.lineWidth = 1.2; g.stroke();
    // punti cardinali
    g.fillStyle = 'rgba(255,255,255,.85)'; g.textAlign = 'center';
    for (let a = Math.ceil(w.a0 / 15) * 15; a <= w.a1; a += 15) {
      g.fillRect(X(a) - 0.5, Hc - 7, 1, 7);
      g.fillText(a % 45 === 0 ? `${COMPASS[Math.round(a / 22.5) % 16]} ${a}°` : `${a}°`, X(a), Hc - 10);
    }
    // percorso del sole: pieno dove e' visibile, tratteggiato dove e' nascosto dai monti
    const inW = (az) => az >= w.a0 - 2 && az <= w.a1 + 2;
    g.lineWidth = 2.5; g.lineCap = 'round';
    for (let i = 1; i < ev.path.length; i++) {
      const [, az0, e0, v0] = ev.path[i - 1], [, az1, e1, v1] = ev.path[i];
      if (!inW(az0) || !inW(az1) || e1 < w.ymin - 2) continue;
      g.setLineDash(v0 && v1 ? [] : [3, 4]);
      g.strokeStyle = v0 && v1 ? '#ffd60a' : 'rgba(255,214,10,.55)';
      g.beginPath(); g.moveTo(X(az0), Y(e0)); g.lineTo(X(az1), Y(e1)); g.stroke();
    }
    g.setLineDash([]);
    const pe = w.tEv != null ? sunPos(w.tEv, H.lat, H.lon) : null, xe = pe ? X(pe.az) : -999, ye = pe ? Y(appEl(pe.el)) : -999;
    g.fillStyle = '#fff'; g.font = '600 10.5px -apple-system, system-ui, sans-serif';
    for (const [t, az, e] of ev.path) {
      if ((t - ev.t0) % 3600000 !== 0 || !inW(az) || e < w.ymin || e > w.ymax) continue;
      const x = X(az), y = Y(e);
      g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill();
      const lx = x + (SN.mode === 'set' ? -16 : 16);
      if (y < 12 || y > Hc - 26 || (Math.abs(lx - xe) < 34 && Math.abs(y - 5 - (ye - 13)) < 16)) continue;
      g.fillText(new Date(t).getHours() + ':00', lx, y - 5);
    }
    // istante del tramonto/alba dietro i monti
    if (pe) {
      const p = pe, x = xe, y = ye;
      g.strokeStyle = '#ff9f0a'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke();
      g.fillStyle = '#ff9f0a'; g.font = '700 12px -apple-system, system-ui, sans-serif';
      g.textAlign = x > W - 60 ? 'right' : x < 60 ? 'left' : 'center';
      g.fillText(T(w.tEv), x, Math.max(14, y - 13));
    }
    // sole adesso
    if (sameDay(SN.day, today())) {
      const now = Date.now(), p = sunPos(now, H.lat, H.lon), e = appEl(p.el);
      if (inW(p.az) && e > w.ymin - 1 && e < w.ymax + 1) {
        const x = X(p.az), y = Y(e), hidden = e + 0.267 < horAt(H, p.az);
        const glow = g.createRadialGradient(x, y, 2, x, y, 20);
        glow.addColorStop(0, hidden ? 'rgba(255,214,10,.35)' : 'rgba(255,214,10,.9)'); glow.addColorStop(1, 'rgba(255,214,10,0)');
        g.fillStyle = glow; g.beginPath(); g.arc(x, y, 20, 0, 7); g.fill();
        g.fillStyle = hidden ? 'rgba(255,230,120,.5)' : '#ffe066'; g.beginPath(); g.arc(x, y, 6.5, 0, 7); g.fill();
      }
    }
    const ex = (W / (w.a1 - w.a0)) / (Hc / (w.ymax - w.ymin));
    $('sunCap').textContent = `Verso ${COMPASS[Math.round(((w.a0 + w.a1) / 2) / 22.5) % 16]} · altezze ingrandite ×${fmt(1 / ex, 0)} · tratteggio: orizzonte del mare (0°) e sole nascosto`;
  }

  /* ---------- barra delle fasi ---------- */
  function phaseBar(ev) {
    const set = SN.mode === 'set', L = ev.lv, tm = set ? ev.last : ev.first;
    const seq = set ? [L.gold.down, tm, L.astro.down, L.blue.down, L.civ.down] : [L.civ.up, L.blue.up, L.astro.up, tm, L.gold.up];
    const known = seq.filter((x) => x != null);
    if (known.length < 2) return '';
    const a = Math.min(...known) - 25 * 60000, b = Math.max(...known) + 25 * 60000, P = (t) => ((t - a) / (b - a)) * 100;
    const seg = (t0, t1, cls) => (t0 == null || t1 == null || t1 <= t0 ? '' : `<i class="${cls}" style="left:${P(t0)}%;width:${P(t1) - P(t0)}%"></i>`);
    let s;
    if (set) {
      s = seg(a, L.gold.down ?? L.astro.down, 'ph-day') + seg(L.gold.down, L.blue.down, 'ph-gold') + seg(L.blue.down, L.civ.down, 'ph-blue') + seg(L.civ.down, b, 'ph-night');
      if (tm != null && L.astro.down != null && tm < L.astro.down) s += seg(tm, L.astro.down, 'ph-shade');
    } else {
      s = seg(a, L.civ.up, 'ph-night') + seg(L.civ.up, L.blue.up, 'ph-blue') + seg(L.blue.up, L.gold.up, 'ph-gold') + seg(L.gold.up ?? L.astro.up, b, 'ph-day');
      if (tm != null && L.astro.up != null && tm > L.astro.up) s += seg(L.astro.up, tm, 'ph-shade');
    }
    const now = Date.now(), mk = (t, lbl) => (t == null ? '' : `<b style="left:${P(t)}%"><span>${lbl}<br>${T(t)}</span></b>`);
    s += mk(tm, set ? 'dietro i monti' : 'dai monti') + (tm == null || Math.abs((L.astro[set ? 'down' : 'up'] ?? 0) - tm) > 12 * 60000 ? mk(L.astro[set ? 'down' : 'up'], 'sul mare') : '');
    if (now > a && now < b) s += `<em style="left:${P(now)}%"><span>ora</span></em>`;
    return `<div class="sun-bar"><div class="sb-track">${s}</div></div>
      <div class="sb-key"><span><i class="ph-day"></i>sole alto</span><span><i class="ph-gold"></i>ora d’oro</span><span><i class="ph-shade"></i>sole dietro i monti</span><span><i class="ph-blue"></i>ora blu</span><span><i class="ph-night"></i>buio</span></div>`;
  }

  /* ---------- testo principale ---------- */
  // orizzonte "piatto" (pianura, mare): niente montagne davanti al sole in quel momento
  const flatAt = (H, t) => t == null || horAt(H, sunPos(t, H.lat, H.lon).az) < 0.6;
  function hero(H, ev) {
    const set = SN.mode === 'set';
    if (!sameDay(SN.day, today())) {
      const tm = set ? ev.last : ev.first;
      if (tm == null) return { big: 'Niente sole diretto', sub: 'Quel giorno il sole non supera le montagne attorno a questo punto.' };
      const astro = set ? ev.lv.astro.down : ev.lv.astro.up, diff = astro != null ? Math.round((set ? astro - tm : tm - astro) / 60000) : null;
      const verb = flatAt(H, tm) ? (set ? 'tramonta all’orizzonte' : 'sorge all’orizzonte') : set ? 'sparisce dietro le montagne' : 'spunta dalle montagne';
      return { big: T(tm), sub: `${dayLabel(SN.day)} il sole ${verb} alle <b>${T(tm)}</b>${diff >= 2 ? ` · ${dshort(diff * 60000)} ${set ? 'prima del tramonto' : 'dopo l’alba'} sul mare (${T(astro)})` : ''}` };
    }
    const now = Date.now(), p = sunPos(now, H.lat, H.lon), hz = horAt(H, p.az), above = appEl(p.el) + 0.267 - hz;
    if (above > 0) {
      const nx = ev.sets.find((t) => t > now);
      const back = nx != null && nx !== ev.last ? ev.rises.find((t) => t > nx) : null;
      if (back != null) return { big: `tra ${dshort(nx - now)}`, sub: `il sole va dietro una cima alle <b>${T(nx)}</b> e ricompare alle ${T(back)} · tramonto finale alle <b>${T(ev.last)}</b>` };
      if (flatAt(H, nx)) return { big: `tra ${dshort((nx ?? ev.t1) - now)}`, sub: `il sole tramonta all’orizzonte alle <b>${T(nx)}</b> · ora è alto ${deg(appEl(p.el))}` };
      return { big: `tra ${dshort((nx ?? ev.t1) - now)}`, sub: `il sole sparisce dietro le montagne alle <b>${T(nx)}</b> · ora è ${deg(appEl(p.el) - hz)} sopra il crinale` };
    }
    if (p.el > LV.astro) {
      const nxr = ev.rises.find((t) => t > now);
      if (nxr != null && now < ev.noon) return { big: 'Dietro i monti', sub: `il sole è già sorto sul mare ma qui spunta dalle montagne alle <b>${T(nxr)}</b> (tra ${dshort(nxr - now)})` };
      if (nxr != null) return { big: 'Dietro una cima', sub: `ricompare alle <b>${T(nxr)}</b> (tra ${dshort(nxr - now)}) · tramonto finale alle ${T(ev.last)}` };
      if (ev.last == null) return { big: 'Niente sole diretto', sub: 'Oggi il sole non supera le montagne attorno a te.' };
      return { big: 'Già dietro i monti', sub: `dalle <b>${T(ev.last)}</b> · sul mare tramonterebbe alle ${T(ev.lv.astro.down)} · buio alle ${T(ev.lv.civ.down)}` };
    }
    if (p.el > LV.civ) {
      if (now > ev.noon) return { big: 'Crepuscolo', sub: `${p.el > LV.blue ? `ora blu dalle ${T(ev.lv.blue.down)}` : `ora blu fino alle ${T(ev.lv.civ.down)}`} · buio alle <b>${T(ev.lv.civ.down)}</b>` };
      return { big: 'Sta albeggiando', sub: `il sole spunta dalle montagne alle <b>${T(ev.first)}</b> (tra ${dshort((ev.first ?? now) - now)})` };
    }
    const nx = now < ev.noon ? ev : dayEvents(H, shiftDay(SN.day, 1));
    return { big: 'Notte', sub: nx.first != null ? `${nx === ev ? 'stamattina' : 'domani'} il sole spunta dalle montagne alle <b>${T(nx.first)}</b> e ci ritorna dietro alle ${T(nx.last)}` : '' };
  }

  /* ---------- pannello ---------- */
  function shell() {
    $('panelBody').innerHTML = `<h2 class="p-title">Tramonto e alba reali</h2><div class="p-sub" id="sunSub"></div>
      <div class="sun-ctl">
        <div class="seg"><button data-m="set">🌇 Tramonto</button><button data-m="rise">🌅 Alba</button></div>
        <div class="sun-date"><button id="sunPrev" title="Giorno prima">‹</button><span id="sunDay"></span><button id="sunNext" title="Giorno dopo">›</button></div>
      </div>
      <button id="sunGps" class="sun-gps"></button>
      <div id="sunMain"></div>`;
    document.querySelector('.sun-ctl .seg').onclick = (e) => {
      const b = e.target.closest('button');
      if (!b || b.dataset.m === SN.mode) return;
      SN.mode = b.dataset.m; render(true);
    };
    $('sunPrev').onclick = () => { SN.day = shiftDay(SN.day, -1); render(true); };
    $('sunNext').onclick = () => { SN.day = shiftDay(SN.day, 1); render(true); };
    $('sunDay').onclick = () => { SN.day = today(); render(true); };
    $('sunGps').onclick = () => { if (SN.follow) { stopWatch(); SN.want = false; updateSub(); } else startFollow(); };
  }
  function updateSub() {
    const pt = SN.pt, sub = $('sunSub');
    if (!sub) return;
    const where = !pt ? 'Cerco la tua posizione…' : `${esc(pt.name || 'Punto sulla mappa')} · ${pt.lat.toFixed(4)}° N, ${pt.lon.toFixed(4)}° E${SN.hor && SN.hor.lat === pt.lat ? ` · ${quota(SN.hor.h0)}` : ''}`;
    sub.innerHTML = where + `<br>${SN.follow ? `Posizione GPS in tempo reale${SN.gpsAcc ? ` (±${Math.round(SN.gpsAcc)} m)` : ''}` : 'Tocca la mappa per scegliere un altro punto'}`;
    const b = $('sunGps');
    if (b) { b.classList.toggle('on', SN.follow); b.textContent = SN.follow ? '📍 Segue la tua posizione · tocca per fermare' : '📍 Usa la mia posizione in tempo reale'; }
  }
  function render(fit) {
    if (!active()) return;
    updateSub();
    document.querySelectorAll('.sun-ctl .seg button').forEach((b) => b.classList.toggle('on', b.dataset.m === SN.mode));
    $('sunDay').textContent = dayLabel(SN.day);
    const main = $('sunMain');
    if (SN.err) { main.innerHTML = `<div class="trip-err">${esc(SN.err)}</div>`; return; }
    if (!SN.hor || !SN.pt || SN.hor.lat !== SN.pt.lat || SN.hor.lon !== SN.pt.lon) {
      main.innerHTML = `<div class="sun-hero"><div class="sh-big"><span class="spinner sm"></span></div><div class="sh-sub">${esc(SN.status || 'Preparo il calcolo…')}</div></div>`;
      return;
    }
    const H = SN.hor, ev = dayEvents(H, SN.day), set = SN.mode === 'set';
    computeWindow();
    const w = SN.win, tm = w.tEv != null && (set ? ev.last : ev.first) != null ? (set ? ev.last : ev.first) : null;
    const astro = set ? ev.lv.astro.down : ev.lv.astro.up;
    const azEv = tm != null ? sunPos(tm, H.lat, H.lon).az : null, b = azEv != null ? bin(azEv) : null;
    const hz = hero(H, ev);
    const diff = tm != null && astro != null ? Math.round((astro - tm) / 60000) * (set ? 1 : -1) : null;
    const pk = b != null ? SN.peaks.get(H.plat[b].toFixed(3) + ',' + H.plon[b].toFixed(3)) : null;
    const gold = set ? [ev.lv.gold.down, ev.lv.blue.down] : [ev.lv.blue.up, ev.lv.gold.up], blue = set ? [ev.lv.blue.down, ev.lv.civ.down] : [ev.lv.civ.up, ev.lv.blue.up];
    const tile = (k, v, n) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>${n ? `<div class="n">${n}</div>` : ''}</div>`;
    const sky = skyAt(SN.pt, tm ?? astro, azEv ?? (astro != null ? sunPos(astro, H.lat, H.lon).az : 0));
    const lightTxt = ev.direct > 0 ? `${durTxt(ev.direct / 1000)}` : 'nessuna', flat = tm != null && flatAt(H, tm);
    const evTitle = flat ? (set ? 'Tramonta all’orizzonte' : 'Sorge all’orizzonte') : set ? 'Sparisce dietro i monti' : 'Spunta dai monti';
    main.innerHTML = `<div class="sun-hero"><div class="sh-big">${hz.big}</div><div class="sh-sub">${hz.sub}</div></div>
      <div class="sun-pano"><canvas id="sunCv"></canvas><div class="sp-cap" id="sunCap"></div></div>
      ${phaseBar(ev)}
      <div class="sec"><div class="tiles">
        ${tile(evTitle, tm != null ? T(tm) : '—', tm != null ? (flat ? 'nessuna montagna davanti al sole' : 'bordo superiore del sole') : 'il sole non supera le montagne')}
        ${tile(set ? 'Tramonto sul mare' : 'Alba sul mare', T(astro), tm == null ? 'qui il sole resta dietro i monti' : diff != null && diff >= 1 ? `le montagne ${set ? 'lo anticipano' : 'la ritardano'} di <b>${dshort(diff * 60000)}</b>` : 'orizzonte libero')}
        ${b != null ? tile(flat ? 'Direzione' : 'Dietro cosa', `${COMPASS[Math.round(azEv / 22.5) % 16]} <small>${Math.round(azEv)}°</small>`, flat ? `orizzonte libero a ${deg(H.ang[b])}${H.ang[b] < 0 ? ' (sei più in alto della pianura attorno)' : ''}`
          : `${pk ? `${esc(pk.name)}${pk.ele ? ` (${quota(pk.ele)})` : ''} · ` : ''}crinale a ${quota(H.hpk[b])}, ${km(H.dist[b])} da te, alto ${deg(H.ang[b])}`) : ''}
        ${tile('Ora d’oro', `${T(gold[0])}–${T(gold[1])}`, tm != null && gold[0] != null && (set ? tm < gold[0] : tm > gold[1]) ? 'qui il sole è già dietro i monti: luce dorata solo sulle cime' : 'sole basso, luce calda')}
        ${tile('Ora blu', `${T(blue[0])}–${T(blue[1])}`, 'sole tra 4° e 6° sotto l’orizzonte')}
        ${tile(set ? 'Buio' : 'Prima luce', T(set ? ev.lv.civ.down : ev.lv.civ.up), 'fine del crepuscolo civile')}
        ${tile('Sole diretto', lightTxt, ev.first != null ? `${T(ev.first)}–${T(ev.last)}${ev.rises.length > 1 ? ` · ${ev.rises.length - 1} ${ev.rises.length > 2 ? 'pause' : 'pausa'} dietro le cime` : ''}` : '')}
        ${tile('Il tuo punto', quota(H.h0), `orizzonte più alto ${deg(Math.max(...H.ang))}`)}
      </div></div>
      ${sky ? `<div class="sec"><h3>Cielo ${set ? 'al tramonto' : 'all’alba'} · previsione</h3><div class="trip-alerts"><div class="al ${sky.cls}">${sky.txt}</div></div>
        <div class="card clouds" style="margin-top:8px">${[['Basse', sky.o.low], ['Medie', sky.o.mid], ['Alte', sky.o.high]].map(([n, v]) => `<div class="crow"><span>${n}</span><div class="bar"><i style="width:${v}%"></i></div><span>${Math.round(v)}%</span></div>`).join('')}
        <div class="n" style="font-size:12px;color:var(--text2);margin-top:6px">Nuvolosità prevista dal modello alle ${T(sky.when)} sopra di te; le nubi basse sono controllate anche nella direzione del sole fino a 90 km.</div></div></div>` : ''}
      <div class="note"><b>Come è calcolato.</b> Dal punto si percorre il terreno in 1.121 direzioni (ogni 0,25°) fino a 160 km, con il rilievo SRTM a 30 m vicino a te e più grossolano lontano, tenendo conto della curvatura terrestre e della rifrazione dell’aria. Il tramonto è l’istante in cui il bordo superiore del sole scende sotto il crinale reale; quello «sul mare» è il tramonto ufficiale con l’orizzonte libero. Edifici, alberi e rilievi entro 200 m non sono considerati: la precisione tipica è di 1–3 minuti. Sulla mappa: in arancione l’orizzonte che vedi e il punto dove il sole ${set ? 'tramonta' : 'sorge'}.</div>`;
    drawPano();
    drawMap(fit);
    if (b != null && !flat && pk === undefined) peakNear(H.plat[b], H.plon[b], H.hpk[b]).then((r) => { if (r && active()) render(false); });
  }
  function tick() {
    if (!active()) { stopAll(); return; }
    if (!SN.hor || !SN.win) return;
    const ev = dayEvents(SN.hor, SN.day), hz = hero(SN.hor, ev), h = document.querySelector('.sun-hero');
    if (h) h.innerHTML = `<div class="sh-big">${hz.big}</div><div class="sh-sub">${hz.sub}</div>`;
    drawPano();
    const bar = document.querySelector('.sun-bar');
    if (bar) { const tmp = document.createElement('div'); tmp.innerHTML = phaseBar(ev); bar.replaceWith(tmp.firstElementChild); }
  }

  /* ---------- punto e GPS ---------- */
  async function setPoint(pt) {
    SN.pt = pt; SN.err = ''; SN.status = 'Preparo il calcolo…';
    const job = ++SN.job;
    render(false);
    try {
      const H = await computeHorizon(pt, (s) => { if (job === SN.job) { SN.status = s; const el = document.querySelector('.sun-hero .sh-sub'); if (el && active()) el.textContent = s; } });
      if (job !== SN.job) return;
      SN.hor = H; SN.ev = new Map();
      render(true);
    } catch (e) {
      if (job !== SN.job) return;
      SN.err = e.message || 'Calcolo non riuscito'; render(false);
    }
  }
  const distM = (a, b) => Math.hypot((a.lon - b.lon) * Math.cos(a.lat * D2R) * 111200, (a.lat - b.lat) * 111200);
  function stopWatch() {
    if (SN.watch != null) navigator.geolocation.clearWatch(SN.watch);
    SN.watch = null; SN.follow = false;
  }
  function startFollow() {
    if (!navigator.geolocation) { SN.err = ''; SN.follow = false; if (!SN.pt) mapCenter(); updateSub(); return; }
    stopWatch();
    SN.follow = SN.want = true; updateSub();
    SN.watch = navigator.geolocation.watchPosition((p) => {
      if (!active()) return stopWatch();
      const q = { lat: +p.coords.latitude.toFixed(5), lon: +p.coords.longitude.toFixed(5), name: 'La tua posizione' };
      SN.gpsAcc = p.coords.accuracy;
      if (!SN.pt || !SN.pt.gps || distM(SN.pt, q) > 150) { q.gps = true; setPoint(q); } else updateSub();
    }, (err) => {
      stopWatch();
      if (!SN.pt) mapCenter();
      const sub = $('sunSub');
      updateSub();
      if (sub) sub.innerHTML += `<br><span class="old">${err.code === 1 ? 'Permesso di posizione negato' : 'Posizione non trovata'}: uso il centro della mappa, tocca la mappa per cambiarlo.</span>`;
    }, { enableHighAccuracy: true, maximumAge: 20000, timeout: 20000 });
  }
  function mapCenter() { const c = map.getCenter(); setPoint({ lat: +c.lat.toFixed(5), lon: +c.lng.toFixed(5), name: 'Centro della mappa' }); }
  function stopAll() { stopWatch(); clearInterval(SN.timer); SN.timer = 0; clearLayers(); }

  /* ---------- API usata da app.js ---------- */
  window.openSun = (pt) => {
    stopAll();
    SN.req = ++panelReq; S.sel = null; updateStations();
    $('panel').hidden = false;
    SN.day = SN.day || today();
    shell(); $('panelBody').scrollTop = 0;
    SN.timer = setInterval(tick, 10000);
    if (pt) { SN.want = false; setPoint({ lat: pt.lat, lon: pt.lon, name: pt.name }); }
    else if (SN.pt && SN.hor && !SN.want) render(true);
    else { if (SN.pt && SN.hor) render(true); startFollow(); }
  };
  window.sunMapClick = (ll) => {
    if (!active()) return false;
    stopWatch(); SN.want = false;
    setPoint({ lat: +ll.lat.toFixed(5), lon: +ll.lng.toFixed(5), name: 'Punto sulla mappa' });
    return true;
  };
  window.sunStop = () => { stopAll(); };
  addEventListener('resize', () => { if (active()) drawPano(); });
})();
