/* Meteo Nord Italia — mappa interattiva */
'use strict';

const DARK = matchMedia('(prefers-color-scheme: dark)').matches;
const MOBILE = matchMedia('(max-width: 820px)').matches;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const TEMP_STOPS = [[-25, '#7b2cbf'], [-15, '#5a4fcf'], [-10, '#3f7fe0'], [-5, '#48b5e8'], [0, '#7fd8d0'], [5, '#74c97a'],
  [10, '#b5d94e'], [15, '#f2d93b'], [20, '#f6a73a'], [25, '#ef6c3a'], [30, '#e03a3a'], [35, '#b3204f'], [40, '#7a1150']];
const CLOUD_RGB = DARK ? '236,240,250' : '88,98,120';

const LAYERS = [
  { id: 'temp', name: 'Temperatura', unit: '°C', gv: 'temperature_2m', sk: 't', dec: 1, ticks: [-20, -10, 0, 10, 20, 30, 40], stops: TEMP_STOPS, cap: ['gelo', 'caldo intenso'],
    icon: '<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0z"/>' },
  { id: 'rain', name: 'Precipitazioni', unit: 'mm/h', gv: 'precipitation', sk: 'pr', dec: 1, ticks: [0, 1, 3, 7, 15, 25], cap: ['asciutto', 'nubifragio'],
    stops: [[0, 'rgba(120,190,255,0)'], [0.1, 'rgba(120,190,255,.5)'], [1, 'rgba(74,163,255,.85)'], [3, '#2f6fed'], [7, '#5b3fd6'], [15, '#b03fd0'], [25, '#ff4d8d']],
    icon: '<path d="M7 15a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.6 1.5A3.5 3.5 0 0 1 17.5 15M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>' },
  { id: 'cloud', name: 'Nuvolosità', unit: '%', gv: 'cloud_cover', sk: 'cloud', dec: 0, ticks: [0, 25, 50, 75, 100], cap: ['0% = cielo sereno', '100% = coperto'],
    stops: [[0, `rgba(${CLOUD_RGB},0)`], [10, `rgba(${CLOUD_RGB},.06)`], [50, `rgba(${CLOUD_RGB},.5)`], [100, `rgba(${CLOUD_RGB},.97)`]],
    sub: [['cloud_cover', 'Totale'], ['cloud_cover_low', 'Basse'], ['cloud_cover_mid', 'Medie'], ['cloud_cover_high', 'Alte']],
    icon: '<path d="M7 18a4.5 4.5 0 0 1 .6-9 6 6 0 0 1 11.5 1.7A3.7 3.7 0 0 1 18.3 18z"/>' },
  { id: 'snowf', group: 'snow', gname: 'Neve', sname: 'Nevicata', name: 'Nevicata', unit: 'cm/h', gv: 'snowfall', dec: 1, ticks: [0, 1, 2, 4, 6], cap: ['nessuna', 'bufera di neve'],
    stops: [[0, 'rgba(190,225,255,0)'], [0.1, 'rgba(190,225,255,.55)'], [0.5, '#9fd0ff'], [1, '#6fa8ff'], [2, '#7a6cf0'], [4, '#c05ad8'], [6, '#ff5fa2']],
    icon: '<path d="M12 3v18M4.2 7.5l15.600 9M19.800 7.5l-15.600 9M9.500 4.500 12 7l2.500-2.500M9.500 19.500 12 17l2.500 2.500"/>' },
  { id: 'snowd', group: 'snow', sname: 'Al suolo', name: 'Neve al suolo', unit: 'cm', gv: 'snow_depth', sk: 'snow', dec: 0, ticks: [0, 50, 100, 200, 300], cap: ['assente', '3 metri e oltre'],
    stops: [[0, 'rgba(200,230,255,0)'], [1, 'rgba(200,230,255,.6)'], [10, '#a8d4ff'], [30, '#6aa5f5'], [60, '#5a6fe0'], [120, '#8a4fd0'], [200, '#d04fb0'], [300, '#ff7a90']] },
  { id: 'snowt', group: 'snow', sname: 'Tipo', name: 'Tipo di neve al suolo', unit: '', gv: 'snow_type', dec: 0, nearest: true, ticks: [], cap: ['', ''],
    cats: [[1, 'Fresca polverosa', '#bfe6ff'], [2, 'Umida / bagnata', '#5fb0f0'], [3, 'Dura compatta', '#8f7ae6'], [4, 'Ghiacciata (crosta)', '#e0559a'], [5, 'Fradicia, in fusione', '#f0a040']] },
  { id: 'wind', name: 'Vento', unit: 'km/h', gv: 'wind_speed_10m', sk: 'ws', dec: 0, ticks: [0, 20, 40, 60, 80, 100], arrows: true, cap: ['calma', 'tempesta'],
    stops: [[0, 'rgba(90,150,240,.12)'], [8, '#4fb7e8'], [18, '#56c98a'], [32, '#f2d43b'], [50, '#f39a3a'], [70, '#e84a4a'], [100, '#b5309a']],
    icon: '<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7a2.5 2.5 0 1 1-2.5 2.5"/>' },
  { id: 'gust', name: 'Raffiche', unit: 'km/h', gv: 'wind_gusts_10m', sk: 'wg', dec: 0, ticks: [0, 30, 60, 90, 120], arrows: true, cap: ['calma', 'tempesta'],
    stops: [[0, 'rgba(90,150,240,.12)'], [15, '#4fb7e8'], [30, '#56c98a'], [50, '#f2d43b'], [70, '#f39a3a'], [95, '#e84a4a'], [120, '#b5309a']],
    icon: '<path d="M4 7h9a2.5 2.5 0 1 0-2.5-2.5M2 12h18M4 17h11a2.5 2.5 0 1 1-2.5 2.5"/>' },
  { id: 'hum', name: 'Umidità', unit: '%', gv: 'relative_humidity_2m', sk: 'rh', dec: 0, ticks: [0, 20, 40, 60, 80, 100], cap: ['aria secca', 'aria satura'],
    stops: [[0, '#d9a441'], [30, '#e8cf7a'], [50, '#bfe3b0'], [70, '#62c2c4'], [85, '#3d8fd6'], [100, '#2a4fb8']],
    icon: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>' },
  { id: 'dew', name: 'Punto di rugiada', unit: '°C', gv: 'temperature_2m', sk: 'td', dec: 1, ticks: [-20, -10, 0, 10, 20, 30, 40], stops: TEMP_STOPS, cap: ['aria secca', 'afa'],
    icon: '<path d="M8 4s4 4.3 4 7.3a4 4 0 0 1-8 0C4 8.3 8 4 8 4zM17 12s3 3.2 3 5.5a3 3 0 0 1-6 0c0-2.3 3-5.5 3-5.5z"/>' },
  { id: 'pres', name: 'Pressione', unit: 'hPa', gv: 'pressure_msl', sk: 'p', dec: 0, ticks: [985, 1000, 1015, 1030, 1045], cap: ['bassa', 'alta'],
    stops: [[985, '#6a3fc9'], [1000, '#3f8fe0'], [1013, '#7fd8b0'], [1025, '#f2d93b'], [1045, '#e8663a']],
    icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 12l4-3.5M12 5.5v1.5M5.5 12H7M17 12h1.5"/>' },
];
const SNOW_TYPES = ['Nessuna', 'Fresca polverosa', 'Umida / bagnata', 'Dura compatta', 'Ghiacciata (crosta)', 'Fradicia, in fusione'];
LAYERS.forEach((l) => { if (l.cats) l.stops = [[0, 'rgba(0,0,0,0)'], ...l.cats.map((c) => [c[0], c[2]])]; l.min = l.stops[0][0]; l.max = l.stops[l.stops.length - 1][0]; l.lut = buildLut(l); });

const S = { layer: LAYERS[0], gv: 'temperature_2m', ti: 0, nowTi: 0, grid: null, dem: null, stations: [], sources: [], stUpdated: null,
  wind: true, showSt: true, playing: null, sel: null };

/* ---------- colori ---------- */
function parseColor(c) {
  if (c[0] === '#') return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 1];
  const m = c.match(/[\d.]+/g).map(Number);
  return [m[0], m[1], m[2], m[3] ?? 1];
}
function buildLut(l) {
  const N = 1024, lut = new Uint8ClampedArray(N * 4), st = l.stops.map(([v, c]) => [v, parseColor(c)]);
  for (let i = 0; i < N; i++) {
    const v = l.min + (i / (N - 1)) * (l.max - l.min);
    let k = 0;
    while (k < st.length - 2 && v > st[k + 1][0]) k++;
    const f = clamp((v - st[k][0]) / (st[k + 1][0] - st[k][0]), 0, 1);
    for (let c = 0; c < 4; c++) {
      const x = st[k][1][c] + (st[k + 1][1][c] - st[k][1][c]) * f;
      lut[i * 4 + c] = c === 3 ? x * 255 : x;
    }
  }
  return lut;
}
function colorCss(l, v, solid) {
  const i = clamp(Math.round(((v - l.min) / (l.max - l.min)) * 1023), 0, 1023) * 4, u = l.lut;
  return `rgba(${u[i]},${u[i + 1]},${u[i + 2]},${solid ? Math.max(0.55, u[i + 3] / 255) : u[i + 3] / 255})`;
}

/* ---------- mappa ---------- */
const map = new maplibregl.Map({
  container: 'map',
  style: `https://basemaps.cartocdn.com/gl/${DARK ? 'dark-matter' : 'positron'}-gl-style/style.json`,
  center: [10.4, 45.6], zoom: MOBILE ? 5.6 : 6.6, minZoom: 4.8, maxZoom: 13,
  maxBounds: [[1, 40.5], [20, 50.5]], dragRotate: false, pitchWithRotate: false, attributionControl: false,
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.AttributionControl({ compact: true,
  customAttribution: 'Stazioni: ARPA Lombardia, ARPAV, Arpae, ARPAL, Meteotrentino, Prov. BZ, MeteoSvizzera, GeoSphere, ARSO, METAR · Modello: Open-Meteo' }));

const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const invMercY = (m) => ((2 * Math.atan(Math.exp(m)) - Math.PI / 2) * 180) / Math.PI;
const dewPoint = (t, rh) => { const a = Math.log(clamp(rh, 1, 100) / 100) + (17.625 * t) / (243.04 + t); return (243.04 * a) / (17.625 - a); };

/* ---------- campo colorato: modello + rilievo + correzione con le stazioni ---------- */
const fieldCanvas = document.createElement('canvas');
let F = null; // geometria e buffer del campo
const C = { t: null, rh: null, p: null, n: 0 }; // correzioni dalle stazioni (per pixel)
let f32cache = {}, tbase = {};

function f32(gv, ti) { // fotogramma del modello come Float32Array (NaN = dato mancante)
  const k = gv + ti;
  if (!f32cache[k]) {
    const src = S.grid.vars[gv][ti], a = new Float32Array(src.length);
    for (let i = 0; i < a.length; i++) a[i] = src[i] == null ? NaN : src[i];
    f32cache[k] = a;
  }
  return f32cache[k];
}
function tempBase(ti) { // temperatura riportata al livello del mare + gradiente verticale del momento
  if (!tbase[ti]) {
    const T = f32('temperature_2m', ti), z = S.grid.elev, n = T.length;
    let sz = 0, st = 0, m = 0;
    for (let i = 0; i < n; i++) if (T[i] === T[i]) { sz += z[i]; st += T[i]; m++; }
    sz /= m; st /= m;
    let cov = 0, vr = 0;
    for (let i = 0; i < n; i++) if (T[i] === T[i]) { cov += (z[i] - sz) * (T[i] - st); vr += (z[i] - sz) ** 2; }
    const L = clamp(vr > 1 ? cov / vr : -0.0065, -0.009, -0.0015);
    const T0 = new Float32Array(n);
    for (let i = 0; i < n; i++) T0[i] = T[i] - L * z[i];
    tbase[ti] = { T0, L };
  }
  return tbase[ti];
}
function snowBase(ti) { // altezza neve riportata a quota zero + aumento medio della neve con la quota (cm per metro)
  const k = 's' + ti;
  if (!tbase[k]) {
    const D = f32('snow_depth', ti), z = S.grid.elev, n = D.length;
    let sz = 0, sd = 0, m = 0;
    for (let i = 0; i < n; i++) if (D[i] === D[i] && z[i] > 300) { sz += z[i]; sd += D[i]; m++; }
    sz /= m || 1; sd /= m || 1;
    let cov = 0, vr = 0;
    for (let i = 0; i < n; i++) if (D[i] === D[i] && z[i] > 300) { cov += (z[i] - sz) * (D[i] - sd); vr += (z[i] - sz) ** 2; }
    const g = clamp(vr > 1 ? cov / vr : 0, 0, 0.12), D0 = new Float32Array(n);
    for (let i = 0; i < n; i++) D0[i] = D[i] - g * z[i];
    tbase[k] = { D0, g };
  }
  return tbase[k];
}
function makeIdx(g) { // indici frazionari di una griglia regolare per ogni colonna/riga del canvas
  const gx = new Float32Array(F.W), gy = new Float32Array(F.H);
  for (let x = 0; x < F.W; x++) gx[x] = clamp((F.lon0 + ((x + 0.5) / F.W) * F.span - g.lon0) / g.step, 0, g.nx - 1);
  for (let y = 0; y < F.H; y++) gy[y] = clamp((F.lat[y] - g.lat0) / g.step, 0, g.ny - 1);
  return { gx, gy, nx: g.nx, ny: g.ny };
}
function fill(out, src, idx) { // interpolazione bilineare su tutto il canvas
  const { gx, gy, nx, ny } = idx, W = F.W, H = F.H;
  let o = 0;
  for (let y = 0; y < H; y++) {
    const fy = gy[y], y0 = Math.min(ny - 2, fy | 0), dy = fy - y0, r = y0 * nx;
    for (let x = 0; x < W; x++, o++) {
      const fx = gx[x], x0 = Math.min(nx - 2, fx | 0), dx = fx - x0, i = r + x0;
      out[o] = src[i] * (1 - dx) * (1 - dy) + src[i + 1] * dx * (1 - dy) + src[i + nx] * (1 - dx) * dy + src[i + nx + 1] * dx * dy;
    }
  }
}
function fillNearest(out, src, idx) { // per le categorie (tipo di neve): nessuna interpolazione
  const { gx, gy, nx } = idx, W = F.W, H = F.H;
  let o = 0;
  for (let y = 0; y < H; y++) {
    const r = Math.round(gy[y]) * nx;
    for (let x = 0; x < W; x++, o++) out[o] = src[r + Math.round(gx[x])];
  }
}
function pointBil(src, g, lon, lat) {
  const fx = (lon - g.lon0) / g.step, fy = (lat - g.lat0) / g.step;
  if (fx < 0 || fy < 0 || fx > g.nx - 1 || fy > g.ny - 1) return NaN;
  const x0 = Math.min(g.nx - 2, fx | 0), y0 = Math.min(g.ny - 2, fy | 0), dx = fx - x0, dy = fy - y0, i = y0 * g.nx + x0;
  return src[i] * (1 - dx) * (1 - dy) + src[i + 1] * dx * (1 - dy) + src[i + g.nx] * (1 - dx) * dy + src[i + g.nx + 1] * dx * dy;
}

function setupField() {
  const g = S.grid, lon1 = g.lon0 + (g.nx - 1) * g.step, lat1 = g.lat0 + (g.ny - 1) * g.step;
  const W = MOBILE ? 540 : 860, m0 = mercY(g.lat0), m1 = mercY(lat1), span = lon1 - g.lon0;
  const H = Math.round((W * (m1 - m0)) / ((span * Math.PI) / 180));
  fieldCanvas.width = W; fieldCanvas.height = H;
  const lat = new Float32Array(H);
  for (let y = 0; y < H; y++) lat[y] = invMercY(m1 - ((y + 0.5) / H) * (m1 - m0));
  F = { W, H, lon0: g.lon0, span, m0, m1, lat, val: new Float32Array(W * H), tmp: new Float32Array(W * H), dem: null,
    img: fieldCanvas.getContext('2d').createImageData(W, H) };
  F.idx = makeIdx(g);
  if (S.dem) { F.dem = new Float32Array(W * H); fill(F.dem, S.dem.z, makeIdx(S.dem)); }
  f32cache = {}; tbase = {};
  if (map.getLayer('field')) { map.removeLayer('field'); map.removeSource('field'); }
  const first = map.getStyle().layers.find((l) => /boundary|admin/.test(l.id)) || map.getStyle().layers.find((l) => l.type === 'symbol');
  map.addSource('field', { type: 'canvas', canvas: fieldCanvas, animate: false,
    coordinates: [[g.lon0, lat1], [lon1, lat1], [lon1, g.lat0], [g.lon0, g.lat0]] });
  map.addLayer({ id: 'field', type: 'raster', source: 'field',
    paint: { 'raster-opacity': DARK ? 0.74 : 0.8, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, first && first.id);
}

function corrWeight(ti) { // la correzione delle stazioni vale adesso e sfuma in poche ore
  const h = Math.abs(S.grid.times[ti] - Date.now() / 1000) / 3600;
  return ti === S.nowTi ? 1 : h > 12 ? 0 : Math.exp(-h / 3);
}

function computeField(l, gv, ti) { // riempie F.val con il valore fisico di ogni pixel
  const N = F.W * F.H, val = F.val, w = corrWeight(ti);
  if (l.id === 'temp' || l.id === 'dew') {
    if (F.dem) {
      const { T0, L } = tempBase(ti), dem = F.dem;
      fill(val, T0, F.idx);
      for (let i = 0; i < N; i++) val[i] += L * dem[i];
    } else fill(val, f32('temperature_2m', ti), F.idx);
    if (C.t && w) for (let i = 0; i < N; i++) val[i] += w * C.t[i];
    if (l.id === 'dew') {
      const rh = F.tmp;
      fill(rh, f32('relative_humidity_2m', ti), F.idx);
      for (let i = 0; i < N; i++) val[i] = dewPoint(val[i], rh[i] + (C.rh ? w * C.rh[i] : 0));
    }
    return;
  }
  if (l.group === 'snow' && l.id !== 'snowf' && F.dem) { // la neve al suolo segue il rilievo: di piu' in quota, niente a valle
    const { D0, g } = snowBase(ti), dem = F.dem, depth = l.id === 'snowd' ? val : F.tmp;
    const raw = F.tmp2 || (F.tmp2 = new Float32Array(N));
    fill(depth, D0, F.idx); fill(raw, f32('snow_depth', ti), F.idx);
    // la quota ridistribuisce la neve ma non la crea dove il modello non ne ha affatto
    for (let i = 0; i < N; i++) depth[i] = Math.max(0, depth[i] + g * dem[i]) * clamp(raw[i] / 1.5, 0, 1);
    if (l.id === 'snowt') { fillNearest(val, f32(gv, ti), F.idx); for (let i = 0; i < N; i++) if (depth[i] < 1) val[i] = 0; }
    return;
  }
  if (l.nearest) return fillNearest(val, f32(gv, ti), F.idx);
  fill(val, f32(gv, ti), F.idx);
  if (l.id === 'hum' && C.rh && w) for (let i = 0; i < N; i++) val[i] = clamp(val[i] + w * C.rh[i], 0, 100);
  if (l.id === 'pres' && C.p && w) for (let i = 0; i < N; i++) val[i] += w * C.p[i];
}

function drawField() {
  if (!F) return;
  computeField(S.layer, S.gv, S.ti);
  const l = S.layer, lut = l.lut, px = F.img.data, val = F.val, N = F.W * F.H, k = 1023 / (l.max - l.min);
  for (let i = 0, o = 0; i < N; i++, o += 4) {
    const v = val[i];
    if (v !== v) { px[o + 3] = 0; continue; }
    let q = ((v - l.min) * k + 0.5) | 0;
    q = (q < 0 ? 0 : q > 1023 ? 1023 : q) << 2;
    px[o] = lut[q]; px[o + 1] = lut[q + 1]; px[o + 2] = lut[q + 2]; px[o + 3] = lut[q + 3];
  }
  fieldCanvas.getContext('2d').putImageData(F.img, 0, 0);
  const src = map.getSource('field');
  if (src) { src.play(); src.pause(); map.triggerRepaint(); }
  updateModelLabels();
}

function sampleField(lon, lat) { // valore mostrato sulla mappa in un punto
  if (!F) return null;
  const x = Math.floor(((lon - F.lon0) / F.span) * F.W), y = Math.floor(((F.m1 - mercY(lat)) / (F.m1 - F.m0)) * F.H);
  if (x < 0 || y < 0 || x >= F.W || y >= F.H) return null;
  const v = F.val[y * F.W + x];
  return v === v ? v : null;
}

/* correzione con le stazioni: differenza misura - modello, diffusa attorno a ogni stazione */
function computeCorrections() {
  C.t = C.rh = C.p = null; C.n = 0;
  if (!F || !S.stations.length) return;
  const g = S.grid, ti = S.nowTi, now = Date.now();
  const cg = { lon0: g.lon0, lat0: g.lat0, step: 0.1, nx: Math.round(((g.nx - 1) * g.step) / 0.1) + 1, ny: Math.round(((g.ny - 1) * g.step) / 0.1) + 1 };
  const fresh = S.stations.filter((s) => now - new Date(s.time).getTime() < 75 * 60000);
  const tb = F.dem ? tempBase(ti) : null, T = f32('temperature_2m', ti), RH = f32('relative_humidity_2m', ti), P = f32('pressure_msl', ti);
  const res = { t: [], rh: [], p: [] };
  for (const s of fresh) {
    const wt = s.src === 'sc' || s.src === 'nt' ? 0.35 : 1; // gli amatoriali contano meno delle stazioni ufficiali
    if (s.t != null) {
      const alt = s.alt != null ? s.alt : S.dem ? pointBil(S.dem.z, S.dem, s.lon, s.lat) : 0;
      const m = tb ? pointBil(tb.T0, g, s.lon, s.lat) + tb.L * alt : pointBil(T, g, s.lon, s.lat);
      if (m === m && Math.abs(s.t - m) < 9) res.t.push([s.lon, s.lat, s.t - m, wt]);
    }
    if (s.rh != null) { const m = pointBil(RH, g, s.lon, s.lat); if (m === m && Math.abs(s.rh - m) < 50) res.rh.push([s.lon, s.lat, s.rh - m, wt]); }
    if (s.p != null) { const m = pointBil(P, g, s.lon, s.lat); if (m === m && Math.abs(s.p - m) < 8) res.p.push([s.lon, s.lat, s.p - m, wt]); }
  }
  const idx = makeIdx(cg), sig = 0.2, cut = 0.65, kx = 0.7;
  for (const key of ['t', 'rh', 'p']) {
    const pts = res[key];
    if (pts.length < 20) continue;
    const num = new Float32Array(cg.nx * cg.ny), den = new Float32Array(cg.nx * cg.ny);
    for (const [lon, lat, r, wt] of pts) {
      const i0 = Math.max(0, Math.floor((lon - cut / kx - cg.lon0) / cg.step)), i1 = Math.min(cg.nx - 1, Math.ceil((lon + cut / kx - cg.lon0) / cg.step));
      const j0 = Math.max(0, Math.floor((lat - cut - cg.lat0) / cg.step)), j1 = Math.min(cg.ny - 1, Math.ceil((lat + cut - cg.lat0) / cg.step));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = (cg.lon0 + i * cg.step - lon) * kx, dy = cg.lat0 + j * cg.step - lat, w = wt * Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig));
        num[j * cg.nx + i] += w * r; den[j * cg.nx + i] += w;
      }
    }
    for (let i = 0; i < num.length; i++) num[i] /= den[i] + 0.25;
    C[key] = new Float32Array(F.W * F.H);
    fill(C[key], num, idx);
  }
  C.n = res.t.length;
}

/* ---------- numeri del modello sulla mappa ---------- */
function labelText(l, v) {
  if (l.id === 'temp' || l.id === 'dew') return Math.round(v) + '°';
  if (l.id === 'rain' || l.id === 'snowf') return v < 0.1 ? '' : fmt(v, 1);
  if (l.id === 'snowd') return v < 1 ? '' : String(Math.round(v));
  if (l.cats) return '';
  if (l.id === 'cloud' || l.id === 'hum') return Math.round(v) + '%';
  return String(Math.round(v));
}
function updateModelLabels() {
  const src = map.getSource('mv');
  if (!src || !F) return;
  const g = S.grid, feats = [], l = S.layer;
  for (let j = 1; j < g.ny - 1; j++) for (let i = 1; i < g.nx - 1; i++) {
    const lon = g.lon0 + i * g.step, lat = g.lat0 + j * g.step, v = sampleField(lon, lat);
    if (v == null) continue;
    const label = labelText(l, v);
    if (label) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { label, pri: i % 4 === 2 && j % 4 === 2 ? 0 : i % 2 === 0 && j % 2 === 0 ? 1 : 2 } });
  }
  src.setData({ type: 'FeatureCollection', features: feats });
}

/* ---------- stazioni ---------- */
function fmt(v, dec) { return v == null ? '—' : dec ? v.toFixed(dec).replace('.', ',') : String(Math.round(v)); }

function stationValue(s, l) {
  let v = s[l.sk];
  if (v == null) return null;
  if (l.id === 'rain' && s.prm) v = (v * 60) / s.prm; // intensita' oraria equivalente
  return v;
}

function updateStations() {
  const src = map.getSource('st');
  if (!src) return;
  const l = S.layer, live = S.ti === S.nowTi && S.showSt, feats = [];
  if (live) {
    for (const s of S.stations) {
      const v = stationValue(s, l);
      if (v == null) continue;
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: { id: s.id, label: l.id === 'temp' || l.id === 'dew' ? fmt(v, 1) + '°' : fmt(v, l.id === 'rain' ? 1 : 0) + (l.id === 'cloud' ? '%' : ''),
          color: colorCss(l, v, true), rot: ((s.wd ?? 0) + 180) % 360, hasDir: s.wd != null && (s.ws ?? 1) > 0.5,
          pri: s.src === 'metar' ? 0 : s.src === 'sc' || s.src === 'nt' || s.src === 'wind' ? 2 : 1, sel: S.sel === s.id } });
    }
  }
  src.setData({ type: 'FeatureCollection', features: feats });
  map.setLayoutProperty('st-arrow', 'visibility', l.arrows ? 'visible' : 'none');
}

function setupStations() {
  const c = document.createElement('canvas'); c.width = c.height = 48;
  const x = c.getContext('2d');
  x.translate(24, 24); x.beginPath(); x.moveTo(0, -19); x.lineTo(8, -6); x.lineTo(2.6, -8); x.lineTo(2.6, 17); x.lineTo(-2.6, 17); x.lineTo(-2.6, -8); x.lineTo(-8, -6); x.closePath(); x.fill();
  map.addImage('arrow', x.getImageData(0, 0, 48, 48), { sdf: true, pixelRatio: 2 });
  const sym = map.getStyle().layers.filter((l) => l.type === 'symbol' && l.layout && l.layout['text-font']);
  const fonts = sym.map((l) => l.layout['text-font']).filter(Array.isArray);
  const font = FONT = fonts.find((f) => /Medium|Bold|Semi/i.test(f[0])) || fonts[0] || ['Open Sans Regular'];
  const ink = DARK ? '#fff' : '#1d1d1f', halo = DARK ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.92)';
  map.addSource('mv', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'mv-label', type: 'symbol', source: 'mv', layout: {
    'text-field': ['get', 'label'], 'text-font': font, 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10.5, 9, 13.5],
    'text-padding': ['interpolate', ['linear'], ['zoom'], 5, 14, 9, 26], 'symbol-sort-key': ['get', 'pri'] },
    paint: { 'text-color': ink, 'text-opacity': 0.82, 'text-halo-color': halo, 'text-halo-width': 1.4 } });
  map.addSource('st', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'st-dot', type: 'circle', source: 'st', paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, ['case', ['get', 'sel'], 6, 2.4], 8, ['case', ['get', 'sel'], 9, 4.5], 11, ['case', ['get', 'sel'], 11, 7]],
    'circle-color': ['get', 'color'], 'circle-stroke-color': DARK ? 'rgba(0,0,0,.6)' : '#fff',
    'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 9, 1.5] } });
  map.addLayer({ id: 'st-arrow', type: 'symbol', source: 'st', filter: ['get', 'hasDir'], layout: {
    'icon-image': 'arrow', 'icon-rotate': ['get', 'rot'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 0.9],
    'icon-allow-overlap': false, 'icon-padding': 1, 'icon-rotation-alignment': 'map', visibility: 'none' },
    paint: { 'icon-color': ink, 'icon-halo-color': halo, 'icon-halo-width': 1.5 } });
  map.addLayer({ id: 'st-label', type: 'symbol', source: 'st', layout: {
    'text-field': ['get', 'label'], 'text-font': font, 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10.5, 9, 13],
    'text-offset': [0, -0.95], 'text-anchor': 'bottom', 'text-padding': 3, 'symbol-sort-key': ['get', 'pri'] },
    paint: { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 1.6 } });
  for (const id of ['st-dot', 'st-label']) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }
}

/* ---------- vento animato ---------- */
const wind = { cv: $('wind'), ctx: $('wind').getContext('2d'), P: null, n: 0, U: null, V: null, view: null, paused: false };

function windVectors() {
  const ws = S.grid.vars.wind_speed_10m[S.ti], wd = S.grid.vars.wind_direction_10m[S.ti], n = ws.length;
  wind.U = new Float32Array(n); wind.V = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = ((wd[i] ?? 0) * Math.PI) / 180, s = ws[i] ?? 0;
    wind.U[i] = -s * Math.sin(r); wind.V[i] = -s * Math.cos(r);
  }
}
function windView() {
  const dpr = Math.min(2, devicePixelRatio || 1), w = innerWidth, h = innerHeight;
  if (wind.cv.width !== Math.round(w * dpr) || wind.cv.height !== Math.round(h * dpr)) { wind.cv.width = Math.round(w * dpr); wind.cv.height = Math.round(h * dpr); }
  wind.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  wind.ctx.clearRect(0, 0, w, h);
  const tl = map.unproject([0, 0]), br = map.unproject([w, h]);
  wind.view = { w, h, lonL: tl.lng, lonR: br.lng, mT: mercY(tl.lat), mB: mercY(br.lat), k: 0.022 * clamp(Math.pow(2, (map.getZoom() - 7) * 0.5), 0.6, 2.2) };
  wind.n = Math.min(MOBILE ? 900 : 2600, Math.round((w * h) / 620));
  wind.P = new Float32Array(wind.n * 3);
  for (let i = 0; i < wind.n; i++) spawn(i, true);
}
function spawn(i, any) {
  wind.P[i * 3] = Math.random() * wind.view.w; wind.P[i * 3 + 1] = Math.random() * wind.view.h;
  wind.P[i * 3 + 2] = any ? Math.random() * 90 : 60 + Math.random() * 60;
}
function windTick() {
  requestAnimationFrame(windTick);
  if (!S.wind || wind.paused || !wind.view || !wind.U) return;
  const { ctx, P, view: v } = wind, g = S.grid, nx = g.nx;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,0.09)';
  ctx.fillRect(0, 0, v.w, v.h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineWidth = 1.25; ctx.lineCap = 'round';
  ctx.strokeStyle = DARK ? 'rgba(255,255,255,.62)' : 'rgba(255,255,255,.9)';
  ctx.shadowColor = DARK ? 'transparent' : 'rgba(20,40,80,.35)'; ctx.shadowBlur = DARK ? 0 : 1.5;
  ctx.beginPath();
  for (let i = 0; i < wind.n; i++) {
    const o = i * 3, x = P[o], y = P[o + 1];
    const lon = v.lonL + (x / v.w) * (v.lonR - v.lonL), lat = invMercY(v.mT + (y / v.h) * (v.mB - v.mT));
    const fx = (lon - g.lon0) / g.step, fy = (lat - g.lat0) / g.step;
    if (--P[o + 2] < 0 || fx < 0 || fy < 0 || fx >= nx - 1 || fy >= g.ny - 1) { spawn(i); continue; }
    const x0 = fx | 0, y0 = fy | 0, dx = fx - x0, dy = fy - y0, j = y0 * nx + x0;
    const u = wind.U[j] * (1 - dx) * (1 - dy) + wind.U[j + 1] * dx * (1 - dy) + wind.U[j + nx] * (1 - dx) * dy + wind.U[j + nx + 1] * dx * dy;
    const w = wind.V[j] * (1 - dx) * (1 - dy) + wind.V[j + 1] * dx * (1 - dy) + wind.V[j + nx] * (1 - dx) * dy + wind.V[j + nx + 1] * dx * dy;
    if (u * u + w * w < 1.5) { if (Math.random() < 0.03) spawn(i); continue; }
    const nxp = x + u * v.k + Math.sign(u) * 0.05, nyp = y - (w * v.k + Math.sign(w) * 0.05);
    ctx.moveTo(x, y); ctx.lineTo(nxp, nyp);
    P[o] = nxp; P[o + 1] = nyp;
  }
  ctx.stroke();
}
map.on('movestart', () => { wind.paused = true; wind.ctx.clearRect(0, 0, innerWidth, innerHeight); });
map.on('moveend', () => { if (S.grid) { windView(); wind.paused = false; } });
map.on('resize', () => { if (S.grid) windView(); });

/* ---------- UI: livelli, legenda, timeline ---------- */
function buildLayers() {
  const nav = $('layers');
  nav.innerHTML = LAYERS.map((l) => {
    if (l.group) {
      const grp = LAYERS.filter((x) => x.group === l.group);
      return grp[0] !== l ? '' : `<button data-g="${l.group}"><svg viewBox="0 0 24 24" class="ico">${l.icon}</svg>${l.gname}</button>` +
        `<div class="sub" data-subg="${l.group}" hidden>${grp.map((x) => `<button data-l="${x.id}">${x.sname}</button>`).join('')}</div>`;
    }
    return `<button data-l="${l.id}"><svg viewBox="0 0 24 24" class="ico">${l.icon}</svg>${l.name}</button>` +
      (l.sub ? `<div class="sub" data-sub="${l.id}" hidden>${l.sub.map(([gv, n]) => `<button data-gv="${gv}">${n}</button>`).join('')}</div>` : '');
  }).join('');
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.g) setLayer(LAYERS.find((l) => l.group === b.dataset.g));
    else if (b.dataset.l) setLayer(LAYERS.find((l) => l.id === b.dataset.l));
    else if (b.dataset.gv) { S.gv = b.dataset.gv; refreshLayerUi(); drawLegend(); drawField(); }
  });
}
function setLayer(l) {
  S.layer = l; S.gv = l.gv;
  refreshLayerUi(); drawLegend(); drawField(); updateStations();
}
function refreshLayerUi() {
  document.querySelectorAll('#layers > button').forEach((b) => b.classList.toggle('on', b.dataset.l === S.layer.id || (!!b.dataset.g && b.dataset.g === S.layer.group)));
  document.querySelectorAll('#layers .sub').forEach((d) => { d.hidden = d.dataset.sub ? d.dataset.sub !== S.layer.id : d.dataset.subg !== S.layer.group; });
  document.querySelectorAll('#layers .sub button').forEach((b) => b.classList.toggle('on', b.dataset.gv ? b.dataset.gv === S.gv : b.dataset.l === S.layer.id));
  const on = document.querySelector('#layers > button.on');
  if (on && MOBILE) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function drawLegend() {
  const l = S.layer, cv = $('legendBar'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  for (let x = 0; x < cv.width; x++) {
    const i = Math.round((x / (cv.width - 1)) * 1023) * 4;
    ctx.fillStyle = `rgba(${l.lut[i]},${l.lut[i + 1]},${l.lut[i + 2]},${l.lut[i + 3] / 255})`;
    ctx.fillRect(x, 0, 1, cv.height);
  }
  const sub = l.sub && l.sub.find((s) => s[0] === S.gv);
  $('legendName').textContent = `${l.name}${sub && sub[1] !== 'Totale' ? ' ' + sub[1].toLowerCase() : ''}${l.unit ? ` (${l.unit})` : ''}`;
  const cats = !!l.cats;
  document.querySelector('.legend-bar').hidden = $('legendTicks').hidden = $('legendCap').hidden = cats;
  $('legendCats').hidden = !cats;
  if (cats) $('legendCats').innerHTML = l.cats.map((c) => `<span><i style="background:${c[2]}"></i>${c[1]}</span>`).join('') + '<em>Stima da temperatura, nevicate e pioggia dei giorni precedenti</em>';
  $('legendTicks').innerHTML = l.ticks.map((t) => `<span style="left:${((t - l.min) / (l.max - l.min)) * 100}%">${t}</span>`).join('');
  $('legendCap').innerHTML = `<span>${l.cap[0]}</span><span>${l.cap[1]}</span>`;
}

const DAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const uncTxt = (u) => (u == null ? 'n/d' : u < 5 ? '<5%' : `${Math.round(u)}%`);
const uncCls = (u) => (u == null ? '' : u < 20 ? 'u-lo' : u < 50 ? 'u-mid' : 'u-hi');
function tlText(ts) {
  const d = new Date(ts * 1000), now = new Date(), dd = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 864e5);
  const day = dd === 0 ? 'Oggi' : dd === 1 ? 'Domani' : dd === -1 ? 'Ieri' : d.toLocaleDateString('it-IT', { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase()) + ' ' + d.getDate();
  return `${day}, ${String(d.getHours()).padStart(2, '0')}:00`;
}
function setTime(ti) {
  S.ti = clamp(ti, 0, S.grid.times.length - 1);
  const sl = $('slider');
  sl.value = S.ti; sl.style.setProperty('--fill', `${(S.ti / (S.grid.times.length - 1)) * 100}%`);
  $('tlLabel').textContent = tlText(S.grid.times[S.ti]);
  const live = S.ti === S.nowTi, m = $('tlMode'), u = S.grid.unc ? S.grid.unc[S.ti] : null;
  m.className = 'badge ' + (live ? 'live' : S.ti > S.nowTi ? uncCls(u) : '');
  m.textContent = live ? (C.n ? `Misure di ${C.n} stazioni` : 'Stazioni in tempo reale') : S.ti < S.nowTi ? 'Analisi modello' : `${MOBILE ? 'Incertezza' : 'Previsione · incertezza'} ${uncTxt(u)}`;
  $('nowBtn').style.visibility = live ? 'hidden' : 'visible';
  windVectors(); drawField(); updateStations();
}
function layoutTimeline() {
  const t = S.grid.times, now = Date.now() / 1000;
  $('slider').max = t.length - 1;
  S.nowTi = t.reduce((b, x, i) => (Math.abs(x - now) < Math.abs(t[b] - now) ? i : b), 0);
  let html = '', last = -1, lastPos = -99;
  const gap = MOBILE ? 15 : 7;
  t.forEach((ts, i) => {
    const d = new Date(ts * 1000), pos = (i / (t.length - 1)) * 100;
    if (d.getDate() !== last && i > 0 && pos < 100 - gap && pos - lastPos >= gap) { html += `<span style="left:${pos}%">${DAYS[d.getDay()]} ${d.getDate()}</span>`; lastPos = pos; }
    last = d.getDate();
  });
  $('tlDays').innerHTML = html;
}
function initTimeline() {
  $('slider').addEventListener('input', () => { stop(); setTime(+$('slider').value); });
  $('nowBtn').onclick = () => { stop(); setTime(S.nowTi); };
  $('play').onclick = () => (S.playing ? stop() : play());
}
function play() {
  if (!S.grid) return;
  if (S.ti >= S.grid.times.length - 1) setTime(S.nowTi);
  $('playIco').innerHTML = '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>';
  S.playing = setInterval(() => (S.ti >= S.grid.times.length - 1 ? stop() : setTime(S.ti + 1)), MOBILE ? 520 : 420);
}
function stop() {
  clearInterval(S.playing); S.playing = null;
  $('playIco').innerHTML = '<path d="M8 5v14l11-7z"/>';
}
function showUpdated() {
  const st = S.stUpdated ? hhmm(new Date(S.stUpdated)) : '—', md = S.grid ? hhmm(new Date(S.grid.updated)) : '—';
  $('upd').textContent = `Stazioni agg. ${st} · modello agg. ${md}`;
  const el = $('updInfo');
  if (el) el.textContent = `Stazioni aggiornate alle ${st}, modello alle ${md}.`;
}

/* ---------- scheda dettaglio ---------- */
const WMO = { 0: ['☀️', 'Sereno'], 1: ['🌤️', 'Quasi sereno'], 2: ['⛅', 'Parzialmente nuvoloso'], 3: ['☁️', 'Coperto'], 45: ['🌫️', 'Nebbia'], 48: ['🌫️', 'Nebbia con brina'],
  51: ['🌦️', 'Pioviggine debole'], 53: ['🌦️', 'Pioviggine'], 55: ['🌧️', 'Pioviggine intensa'], 56: ['🌧️', 'Pioviggine gelata'], 57: ['🌧️', 'Pioviggine gelata'],
  61: ['🌧️', 'Pioggia debole'], 63: ['🌧️', 'Pioggia'], 65: ['🌧️', 'Pioggia forte'], 66: ['🌧️', 'Pioggia gelata'], 67: ['🌧️', 'Pioggia gelata forte'],
  71: ['🌨️', 'Neve debole'], 73: ['🌨️', 'Neve'], 75: ['❄️', 'Neve forte'], 77: ['🌨️', 'Nevischio'], 80: ['🌦️', 'Rovesci deboli'], 81: ['🌧️', 'Rovesci'], 82: ['⛈️', 'Rovesci violenti'],
  85: ['🌨️', 'Rovesci di neve'], 86: ['❄️', 'Rovesci di neve forti'], 95: ['⛈️', 'Temporale'], 96: ['⛈️', 'Temporale con grandine'], 99: ['⛈️', 'Temporale con grandine'] };
const wmo = (c, day = 1) => { const w = WMO[c] || ['·', '']; return [!day && c <= 1 ? '🌙' : !day && c === 2 ? '☁️' : w[0], w[1]]; };
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const compass = (d) => (d == null ? '' : COMPASS[Math.round(d / 22.5) % 16]);
const SRC_NAME = () => Object.fromEntries(S.sources.map((s) => [s.id, s.name]));

function ago(isoT) {
  const m = Math.round((Date.now() - new Date(isoT).getTime()) / 60000);
  const txt = m < 1 ? 'adesso' : m < 60 ? `${m} min fa` : `${Math.floor(m / 60)} h ${m % 60} min fa`;
  return m > 90 ? `<span class="old">${txt}</span>` : txt;
}

/* incertezza dal ventaglio di 51 scenari ECMWF: quota di scenari che si discostano da quello centrale */
function ensembleUncertainty(e) {
  const h = e.hourly, tk = Object.keys(h).filter((k) => k.startsWith('temperature_2m')).sort(), pk = Object.keys(h).filter((k) => k.startsWith('precipitation')).sort();
  const M = Math.min(tk.length, pk.length), hour = {}, days = {};
  const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  h.time.forEach((t, i) => {
    const T = [], W = [];
    for (let m = 0; m < M; m++) {
      const tv = h[tk[m]][i], pv = h[pk[m]][i] || 0;
      if (tv == null) continue;
      T.push(tv); W.push(pv >= 0.1);
      const d = (days[t.slice(0, 10)] ||= []), o = (d[m] ||= { hi: -99, lo: 99, p: 0, n: 0 });
      o.hi = Math.max(o.hi, tv); o.lo = Math.min(o.lo, tv); o.p += pv; o.n++;
    }
    if (T.length < 10) return;
    const med = median(T), major = W.filter(Boolean).length * 2 >= W.length;
    hour[t] = (100 * T.filter((tv, k) => Math.abs(tv - med) > 2 || W[k] !== major).length) / T.length;
  });
  const day = {};
  for (const [d, arr] of Object.entries(days)) {
    const ms = arr.filter((o) => o && o.n >= 12);
    if (ms.length < 10) continue;
    const mh = median(ms.map((o) => o.hi)), ml = median(ms.map((o) => o.lo)), major = ms.filter((o) => o.p >= 1).length * 2 >= ms.length;
    day[d] = (100 * ms.filter((o) => Math.abs(o.hi - mh) > 2 || Math.abs(o.lo - ml) > 2 || (o.p >= 1) !== major).length) / ms.length;
  }
  return { hour, day };
}

/* tipo di neve al suolo stimato dalla storia recente (stessa regola del server).
   h: serie orarie Open-Meteo (snow_depth in metri, snowfall in cm), k: indice dell'ora */
function snowType(h, k) {
  const T = h.temperature_2m, P = h.precipitation, SF = h.snowfall, SD = h.snow_depth;
  if (!T || !SD || T[k] == null || SD[k] == null) return null;
  if (SD[k] < 0.01) return 0;
  const a24 = Math.max(0, k - 23), a48 = Math.max(0, k - 47);
  let new24 = 0, rain24 = 0, rain48 = 0, thaw24 = 0, thaw48 = 0;
  for (let i = a48; i <= k; i++) {
    const r = Math.max(0, (P[i] || 0) - (SF[i] || 0) / 0.7), warm = T[i] != null && T[i] > 0.5;
    rain48 += r; if (warm) thaw48++;
    if (i >= a24) { rain24 += r; new24 += SF[i] || 0; if (warm) thaw24++; }
  }
  const t = T[k];
  if (t > 1 && (thaw24 >= 6 || rain24 >= 2)) return 5;
  if (new24 >= 3) return t <= -1 ? 1 : 2;
  if (t <= -1 && (thaw48 >= 3 || rain48 >= 1)) return 4;
  return t > 0 ? 2 : 3;
}

let panelReq = 0;
async function openPanel({ station, lat, lon, name }) {
  if (window.sunStop) sunStop();
  const req = ++panelReq;
  S.sel = station ? station.id : null;
  updateStations();
  const s = station;
  lat = s ? s.lat : lat; lon = s ? s.lon : lon;
  const head = s
    ? `<h2 class="p-title">${esc(s.name)}</h2><div class="p-sub">${esc(SRC_NAME()[s.src] || '')}${s.alt != null ? ` · ${Math.round(s.alt)} m` : ''}<br>Misurato ${ago(s.time)}</div>`
    : `<h2 class="p-title">${esc(name || 'Punto sulla mappa')}</h2><div class="p-sub">${lat.toFixed(3)}° N, ${lon.toFixed(3)}° E · dati da modello</div>`;
  $('panelBody').innerHTML = head + '<div class="skel">Carico la previsione…</div>';
  $('panel').hidden = false;
  $('panelBody').scrollTop = 0;
  const pos = `latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`;
  const getJ = (u) => fetch(u).then((r) => r.json()).then((j) => (j.error ? null : j)).catch(() => null);
  const [fc, ens] = await Promise.all([
    getJ(`https://api.open-meteo.com/v1/forecast?${pos}` +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day,dew_point_2m' +
      '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,uv_index,is_day,snow_depth,snowfall,freezing_level_height' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset,uv_index_max,snowfall_sum' +
      '&timezone=auto&past_days=2&forecast_days=7&wind_speed_unit=kmh'),
    getJ(`https://ensemble-api.open-meteo.com/v1/ensemble?${pos}&hourly=temperature_2m,precipitation&models=ecmwf_ifs025&forecast_days=7&timezone=auto`),
  ]);
  if (req !== panelReq) return;
  let unc = null;
  try { unc = ens ? ensembleUncertainty(ens) : null; } catch (e) { unc = null; }
  $('panelBody').innerHTML = head + renderPanel(s, fc, unc);
  const sb = document.querySelector('.sun-open');
  if (sb) sb.onclick = () => window.openSun({ lat, lon, name: s ? s.name : name || 'Punto sulla mappa' });
}

function renderPanel(s, fc, unc) {
  const c = fc ? fc.current : {}, h = fc ? fc.hourly : null;
  let hi = 0;
  if (h) { const now = Date.now(); hi = Math.max(0, h.time.findIndex((t) => new Date(t).getTime() > now) - 1); }
  const hv = (k) => (h && h[k] ? h[k][hi] : null);
  const pick = (k, mk) => (s && s[k] != null ? [s[k], true] : [mk, false]);
  const tile = (k, [v, obs], dec, unit, note) => (v == null ? '' :
    `<div class="tile"><div class="k">${k}<i class="${obs ? 'obs' : ''}">${obs ? '● misurato' : 'modello'}</i></div><div class="v">${fmt(v, dec)} <small>${unit}</small></div>${note ? `<div class="n">${note}</div>` : ''}</div>`);
  const [ic, desc] = wmo(c.weather_code, c.is_day);
  const [t, tObs] = pick('t', c.temperature_2m);
  let out = `<div class="hero"><div class="big">${t == null ? '—' : Math.round(t)}°</div><div><div class="emo">${fc ? ic : ''}</div></div>
    <div class="desc">${fc ? desc : ''}<small>${t != null ? `${fmt(t, 1)} °C ${tObs ? 'misurati' : 'da modello'}` : ''}${c.apparent_temperature != null ? `<br>Percepita ${Math.round(c.apparent_temperature)}°` : ''}</small></div></div>`;

  const wd = pick('wd', c.wind_direction_10m), pr = s && s.pr != null;
  out += '<div class="sec"><h3>Condizioni attuali</h3><div class="tiles">' +
    tile('Vento', pick('ws', c.wind_speed_10m), 0, 'km/h', wd[0] != null ? `da ${compass(wd[0])} · ${Math.round(wd[0])}°` : '') +
    tile('Raffica', pick('wg', c.wind_gusts_10m), 0, 'km/h') +
    tile('Umidità', pick('rh', c.relative_humidity_2m), 0, '%') +
    tile('Punto di rugiada', pick('td', c.dew_point_2m), 1, '°C') +
    tile('Pressione', pick('p', c.pressure_msl), 0, 'hPa', s && s.pst != null && s.p == null ? `in quota: ${Math.round(s.pst)} hPa` : 'livello del mare') +
    tile('Precipitazioni', pr ? [s.pr, true] : [c.precipitation, false], 1, 'mm', pr ? (s.prm ? `ultimi ${s.prm} min` : 'ultimo intervallo') : 'ultima ora') +
    tile('Visibilità', s && s.vis != null ? [s.vis, true] : [hv('visibility') != null ? hv('visibility') / 1000 : null, false], 0, 'km', s && s.vis >= 10 ? '10 km o più' : '') +
    tile('Indice UV', [hv('uv_index'), false], 1, '') +
    (s && s.rad != null ? tile('Radiazione solare', [s.rad, true], 0, 'W/m²') : '') +
    (s && s.sun != null ? tile('Soleggiamento', [s.sun, true], 0, 'min', 'ultimi 10 min') : '') +
    tile('Zero termico', [hv('freezing_level_height'), false], 0, 'm') + '</div></div>';

  const cl = s && s.cloud != null ? [s.cloud, true] : [c.cloud_cover, false];
  if (cl[0] != null) {
    const row = (n, v) => (v == null ? '' : `<div class="crow"><span>${n}</span><div class="bar"><i style="width:${v}%"></i></div><span>${Math.round(v)}%</span></div>`);
    out += `<div class="sec"><h3>Nuvolosità · 0% sereno, 100% coperto</h3><div class="card clouds">${cl[1] ? row('Osservata', cl[0]) : ''}${row('Totale', c.cloud_cover)}${row('Basse', hv('cloud_cover_low'))}${row('Medie', hv('cloud_cover_mid'))}${row('Alte', hv('cloud_cover_high'))}
      <div class="n" style="font-size:12px;color:var(--text2);margin-top:6px">${cl[1] ? `«Osservata» è la copertura rilevata in aeroporto${s.cbase != null ? ` (base nubi ${s.cbase} m)` : ''}; le altre righe sono stime del modello.` : 'Stima da modello: le stazioni automatiche non misurano le nubi.'}</div></div></div>`;
  }
  if (h) {
    const uh = unc ? unc.hour : {}, ud = unc ? unc.day : {};
    const chip = (u) => `<span class="unc ${uncCls(u)}">${uncTxt(u)}</span>`;
    let hh = '';
    for (let i = hi; i < Math.min(h.time.length, hi + 25); i++) {
      const [e] = wmo(h.weather_code[i], h.is_day[i]), pp = h.precipitation_probability[i];
      hh += `<div class="hour"><div class="h">${i === hi ? 'Ora' : h.time[i].slice(11, 13)}</div><div class="e">${e}</div><div class="pp">${pp >= 20 ? '💧' + pp + '%' : ''}</div><div class="t">${Math.round(h.temperature_2m[i])}°</div><div class="c">☁ ${h.cloud_cover[i]}%</div>${chip(uh[h.time[i]])}</div>`;
    }
    out += `<div class="sec"><h3>Prossime 24 ore</h3><div class="card"><div class="hours">${hh}</div><div class="unc-key">Ultima riga: incertezza della previsione</div></div></div>`;
    const d = fc.daily, d0 = Math.max(0, d.time.indexOf(h.time[hi].slice(0, 10)));
    const lo = Math.min(...d.temperature_2m_min.slice(d0)), hiT = Math.max(...d.temperature_2m_max.slice(d0)), span = Math.max(1, hiT - lo);
    // neve: al suolo, tipo stimato e nevicate previste
    const sumSnow = (n) => { let x = 0; for (let i = hi; i < Math.min(h.time.length, hi + n); i++) x += h.snowfall[i] || 0; return x; };
    const s24 = sumSnow(24), s72 = sumSnow(72), s7 = sumSnow(999), depth = s && s.snow != null ? [s.snow, true] : [hv('snow_depth') != null ? hv('snow_depth') * 100 : null, false];
    const st = snowType(h, hi), maxUnc = (n) => { const v = d.time.slice(d0, d0 + n).map((x) => ud[x]).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
    if ((depth[0] || 0) >= 0.5 || s7 >= 0.1) {
      out += '<div class="sec"><h3>Neve</h3><div class="tiles">' + tile('Al suolo', depth, 0, 'cm') +
        `<div class="tile"><div class="k">Tipo di neve<i>stima</i></div><div class="v" style="font-size:16px;line-height:1.25">${st ? SNOW_TYPES[st] : (depth[0] || 0) >= 0.5 ? 'non stimabile' : 'nessuna neve'}</div></div>` +
        tile('Nevicata 24 ore', [s24, false], 1, 'cm', `incertezza ${chip(maxUnc(2))}`) + tile('Nevicata 3 giorni', [s72, false], 1, 'cm', `incertezza ${chip(maxUnc(4))}`) +
        tile('Nevicata 7 giorni', [s7, false], 1, 'cm', `incertezza ${chip(maxUnc(7))}`) + '</div>' +
        '<div class="unc-key">Il tipo di neve (fresca, umida, dura, ghiacciata, fradicia) è stimato da temperature, nevicate e pioggia degli ultimi due giorni: non è una misura.</div></div>';
    } else out += `<div class="sec"><h3>Neve</h3><div class="card" style="font-size:13px">Nessuna neve al suolo né prevista nei prossimi 7 giorni · incertezza ${chip(maxUnc(7))}</div></div>`;
    let dd = '<div class="day dhead"><span></span><span></span><span>pioggia</span><span>min</span><span></span><span>max</span><span>incert.</span></div>';
    d.time.forEach((day, i) => {
      if (i < d0) return;
      const a = d.temperature_2m_min[i], b = d.temperature_2m_max[i], sn = d.snowfall_sum ? d.snowfall_sum[i] : 0;
      const pp = sn >= 0.5 ? `❄${Math.round(sn)}cm` : d.precipitation_probability_max[i] != null ? d.precipitation_probability_max[i] + '%' : null;
      dd += `<div class="day"><span class="d">${i === d0 ? 'Oggi' : DAYS[new Date(day + 'T12:00').getDay()].replace(/^./, (x) => x.toUpperCase())}</span><span class="e">${wmo(d.weather_code[i])[0]}</span><span class="pp">${pp != null ? pp : ''}</span><span class="lo">${Math.round(a)}°</span>
        <div class="range"><i style="left:${((a - lo) / span) * 100}%;right:${((hiT - b) / span) * 100}%;background:linear-gradient(90deg,${colorCss(LAYERS[0], a, true)},${colorCss(LAYERS[0], b, true)})"></i></div><span class="hi">${Math.round(b)}°</span>${chip(ud[day])}</div>`;
    });
    out += `<div class="sec"><h3>Prossimi 7 giorni</h3><div class="card">${dd}</div></div>`;
    out += `<div class="sec"><div class="tiles"><div class="tile"><div class="k">Alba</div><div class="v">${d.sunrise[d0].slice(11, 16)}</div></div><div class="tile"><div class="k">Tramonto</div><div class="v">${d.sunset[d0].slice(11, 16)}</div></div></div>
      <button class="sun-open">🌄 Tramonto reale, con le montagne</button></div>`;
  } else out += '<div class="skel">Previsione non disponibile in questo momento.</div>';
  if (s && s.raw) out += `<div class="sec"><h3>Bollettino METAR</h3><div class="card raw">${esc(s.raw)}</div></div>`;
  out += `<div class="note"><b>Incertezza:</b> percentuale dei 51 scenari alternativi del modello europeo ECMWF che si discostano da quello centrale (temperatura diversa di oltre 2 °C, oppure pioggia sì/no diversa). Più è alta, meno la previsione è affidabile${unc ? '' : ' — al momento non disponibile'}.<br><br>
    I valori con il pallino verde sono misurati dalla stazione; gli altri e le previsioni provengono dal modello ad alta risoluzione scelto da Open-Meteo per il punto.</div>`;
  return out;
}

function closePanel() { $('panel').hidden = true; S.sel = null; panelReq++; updateStations(); if (window.sunStop) sunStop(); }
$('panelClose').onclick = closePanel;
$('panelGrab').onclick = () => { $('panel').classList.toggle('mini'); if (TRIP.result && !$('panel').hidden) setTimeout(fitTrip, 300); };

function probe(lngLat) {
  const v = sampleField(lngLat.lng, lngLat.lat);
  $('probe').textContent = v == null ? '' : S.layer.cats ? (v < 0.5 ? 'niente neve' : SNOW_TYPES[Math.round(v)]) : `${fmt(v, S.layer.dec)} ${S.layer.unit}`;
}
map.on('click', (e) => {
  if (window.sunMapClick && window.sunMapClick(e.lngLat)) return; // pannello tramonto aperto: sposta il punto
  const p = e.point, r = MOBILE ? 12 : 7, hits = map.getLayer('st-dot') ? map.queryRenderedFeatures([[p.x - r, p.y - r], [p.x + r, p.y + r]], { layers: ['st-dot', 'st-label'] }) : [];
  probe(e.lngLat);
  if (hits.length) {
    const s = S.stations.find((x) => x.id === hits[0].properties.id);
    if (s) return openPanel({ station: s });
  }
  openPanel({ lat: e.lngLat.lat, lon: e.lngLat.lng });
});
map.on('mousemove', (e) => probe(e.lngLat));

/* ---------- ricerca e posizione ---------- */
let qTimer = 0;
$('q').addEventListener('input', () => {
  clearTimeout(qTimer);
  const q = $('q').value.trim();
  if (q.length < 2) { $('results').hidden = true; return; }
  qTimer = setTimeout(async () => {
    try {
      const r = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=it`)).json();
      const list = (r.results || []).filter((x) => x.longitude > 1 && x.longitude < 20 && x.latitude > 40.5 && x.latitude < 50.5);
      $('results').innerHTML = list.length ? list.map((x, i) => `<button data-i="${i}">${esc(x.name)}<small>${esc([x.admin2, x.admin1, x.country].filter(Boolean).join(', '))}</small></button>`).join('')
        : '<button disabled>Nessun risultato nell’area</button>';
      $('results').hidden = false;
      $('results').onclick = (ev) => {
        const b = ev.target.closest('button[data-i]');
        if (!b) return;
        const x = list[+b.dataset.i];
        $('results').hidden = true; $('q').value = x.name; $('q').blur();
        goTo(x.latitude, x.longitude, x.name);
      };
    } catch (e) { /* rete assente: ignora */ }
  }, 250);
});
$('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = $('results').querySelector('button[data-i]'); if (b) b.click(); } });
document.addEventListener('click', (e) => { if (!e.target.closest('.search')) $('results').hidden = true; if (!e.target.closest('.right-tools')) $('sources').hidden = true; });
function goTo(lat, lon, name) {
  map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 9.5), speed: 1.4, padding: MOBILE ? { bottom: innerHeight * 0.45 } : { right: 380 } });
  openPanel({ lat, lon, name });
}
$('locate').onclick = () => navigator.geolocation && navigator.geolocation.getCurrentPosition(
  (p) => goTo(p.coords.latitude, p.coords.longitude, 'La mia posizione'), () => {}, { timeout: 8000 });

$('windToggle').onclick = () => {
  S.wind = !S.wind; $('windToggle').classList.toggle('on', S.wind);
  if (!S.wind) wind.ctx.clearRect(0, 0, innerWidth, innerHeight);
};
$('stToggle').onclick = (e) => { e.stopPropagation(); $('sources').hidden = !$('sources').hidden; };
function renderSources() {
  $('stCount').textContent = `${S.stations.length.toLocaleString('it-IT')} stazioni`;
  $('sources').innerHTML = '<h4>Reti di misura</h4>' + S.sources.map((s) =>
    `<div class="row"><span class="dot ${s.ok === false ? 'bad' : ''}"></span>${esc(s.name)}<b>${s.count}</b></div>`).join('') +
    `<label><input type="checkbox" id="stShow" ${S.showSt ? 'checked' : ''}> Mostra le stazioni sulla mappa</label>` +
    '<p id="updInfo"></p><p>I numeri con il pallino sono misure delle stazioni (solo su «Adesso»); i numeri senza pallino e lo sfondo colorato sono il modello, corretto attorno alle stazioni con le misure dell’ultima ora.</p><p>Le stazioni amatoriali (Sensor.Community e Netatmo) sono confrontate con le stazioni ufficiali vicine (alla stessa quota): quelle troppo diverse vengono scartate e le altre pesano un terzo nella correzione. Di Netatmo si usano solo temperatura, umidità e pressione, al massimo una stazione ogni 2 km circa. Se due reti misurano nello stesso punto si tiene la stazione ufficiale.</p>';
  $('stShow').onchange = (e) => { S.showSt = e.target.checked; $('stToggle').classList.toggle('on', S.showSt); updateStations(); };
  showUpdated();
}

/* ---------- pianificatore di viaggio ---------- */
let FONT = ['Open Sans Regular'];
const MODES = [
  { id: 'foot', name: 'A piedi', ico: '🚶', prof: 'foot' },
  { id: 'bike', name: 'Bici', ico: '🚲', prof: 'bike' },
  { id: 'moto', name: 'Moto', ico: '🏍️', prof: 'car' },
  { id: 'car', name: 'Auto', ico: '🚗', prof: 'car' },
  { id: 'transit', name: 'Mezzi', ico: '🚆' },
];
const LEG_MODE = { WALK: '🚶 A piedi', BUS: '🚌 Bus', COACH: '🚌 Pullman', TRAM: '🚊 Tram', SUBWAY: '🚇 Metro', METRO: '🚇 Metro', FERRY: '⛴️ Traghetto', FUNICULAR: '🚠 Funicolare', AERIAL_LIFT: '🚠 Funivia' };
const TRIP = { from: null, to: null, fromTxt: '', toTxt: '', date: '', time: '', mode: 'car', result: null, error: '', busy: false };
const pad2 = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const durTxt = (s) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad2(m % 60)} min`; };
const haversine = (a, b) => { const r = Math.PI / 180, x = (b[0] - a[0]) * r * Math.cos(((a[1] + b[1]) / 2) * r), y = (b[1] - a[1]) * r; return Math.sqrt(x * x + y * y) * 6371000; };

async function geocode(q) {
  const r = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=it`)).json();
  return (r.results || []).map((x) => ({ lat: x.latitude, lon: x.longitude, name: x.name, sub: [x.admin2, x.admin1, x.country].filter(Boolean).join(', ') }));
}
function decodePolyline(str, precision) {
  const f = Math.pow(10, precision), out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let res = 0, shift = 0, b;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32);
      const d = res & 1 ? ~(res >> 1) : res >> 1;
      if (which === 0) lat += d; else lon += d;
    }
    out.push([lon / f, lat / f]);
  }
  return out;
}

/* Traffico tipico: non e' traffico in tempo reale ma una stima per fascia oraria, giorno e tipo di strada.
   Ogni tratto viene rallentato in base all'ora in cui ci si arriva davvero, quindi i ritardi si sommano
   e spostano in avanti anche gli orari di passaggio usati per il meteo. */
const METRO = [[9.19, 45.47, 20, 'Milano'], [7.68, 45.07, 13, 'Torino'], [8.93, 44.41, 11, 'Genova'], [11.34, 44.49, 11, 'Bologna'], [10.99, 45.44, 8, 'Verona'],
  [11.88, 45.41, 8, 'Padova'], [12.24, 45.49, 9, 'Mestre'], [10.22, 45.54, 7, 'Brescia'], [9.67, 45.69, 7, 'Bergamo'], [11.25, 43.78, 10, 'Firenze'],
  [13.77, 45.65, 5, 'Trieste'], [11.12, 46.07, 5, 'Trento'], [11.35, 46.50, 5, 'Bolzano'], [10.33, 44.80, 5, 'Parma'], [10.93, 44.65, 6, 'Modena'],
  [9.08, 45.81, 5, 'Como'], [8.83, 45.82, 5, 'Varese'], [8.95, 46.01, 5, 'Lugano'], [11.40, 47.27, 6, 'Innsbruck'], [8.54, 47.37, 10, 'Zurigo'], [13.23, 46.07, 5, 'Udine'], [7.27, 43.70, 8, 'Nizza']];
function metroAt(lon, lat) {
  for (const m of METRO) { const dx = (lon - m[0]) * 78, dy = (lat - m[1]) * 111; if (dx * dx + dy * dy < m[2] * m[2]) return m[3]; }
  return null;
}
const bump = (h, c, w) => Math.exp(-((h - c) * (h - c)) / (2 * w * w));
function trafficPeak(date, motorway) { // 0 = strada libera, 1 = ora di punta piena
  const h = date.getHours() + date.getMinutes() / 60, wd = date.getDay();
  if (wd === 0) return Math.max(0.12 * bump(h, 11.5, 2), (motorway ? 0.6 : 0.3) * bump(h, 18.5, 1.8)); // domenica: rientri serali
  if (wd === 6) return Math.max(0.35 * bump(h, 11, 2), 0.35 * bump(h, 17.5, 2));
  const eve = wd === 5 ? 1.1 : 1; // venerdi' sera piu' carico
  return Math.min(1, Math.max(bump(h, 8.1, 0.9), eve * bump(h, 17.8, 1.1), 0.28 * bump(h, 13, 2.5)));
}
function trafficFactor(date, kmh, metro, moto) {
  const motorway = kmh >= 95, urban = kmh < 55;
  const k = metro ? (urban ? 0.9 : motorway ? 0.7 : 0.6) : urban ? 0.35 : motorway ? 0.12 : 0.15;
  return 1 + trafficPeak(date, motorway) * k * (moto ? 0.5 : 1);
}

/* Traffico reale e previsto di TomTom (serve una chiave in config.js). I ritardi dei tratti congestionati
   vengono messi nel punto del percorso in cui si trovano, cosi' spostano gli orari di passaggio successivi. */
async function planTomTom(key, mode, from, to, dep) {
  const future = dep.getTime() > Date.now() + 120000;
  const u = `https://api.tomtom.com/routing/1/calculateRoute/${from.lat},${from.lon}:${to.lat},${to.lon}/json?key=${encodeURIComponent(key)}` +
    `&traffic=true&travelMode=${mode.id === 'moto' ? 'motorcycle' : 'car'}&routeType=fastest&computeTravelTimeFor=all&sectionType=traffic${future ? `&departAt=${encodeURIComponent(dep.toISOString())}` : ''}`;
  const res = await fetch(u);
  if (!res.ok) throw new Error('TomTom ' + res.status);
  const r = (await res.json()).routes[0], sum = r.summary, g = r.legs.flatMap((l) => l.points).map((p) => [p.longitude, p.latitude]);
  const extra = new Float64Array(g.length), hot = [];
  let secDelay = 0;
  for (const s of r.sections || []) {
    const d = s.delayInSeconds || 0, a = s.startPointIndex, b = Math.max(s.endPointIndex, a + 1);
    if (d <= 0 || b >= g.length) continue;
    for (let i = a + 1; i <= b; i++) extra[i] += d / (b - a);
    secDelay += d;
    if (d >= 120) hot.push([d, nearPlace(g[a][0], g[a][1]) || `km ${Math.round((a / g.length) * sum.lengthInMeters / 1000)}`]);
  }
  const cum = [0];
  for (let i = 1; i < g.length; i++) cum.push(cum[i - 1] + haversine(g[i - 1], g[i]));
  const tot = cum[cum.length - 1] || 1, base = Math.max(60, sum.travelTimeInSeconds - secDelay);
  let add = 0;
  const pts = g.map((p, i) => { add += extra[i]; return [p[0], p[1], (base * cum[i]) / tot + add]; });
  const free = sum.noTrafficTravelTimeInSeconds || sum.travelTimeInSeconds - (sum.trafficDelayInSeconds || 0);
  return { pts, dist: sum.lengthInMeters, dur: sum.travelTimeInSeconds, legs: null, free, delay: Math.max(0, sum.travelTimeInSeconds - free), live: true,
    hot: hot.sort((x, y) => y[0] - x[0]).slice(0, 3).map((x) => `${x[1]} (+${Math.round(x[0] / 60)} min)`) };
}

async function planRoad(mode, from, to, dep) { // percorso stradale: [lon, lat, secondi dalla partenza]
  const key = ((window.METEO_CONFIG || {}).tomtomKey || '').trim();
  if (key && mode.prof === 'car') {
    try { return await planTomTom(key, mode, from, to, dep); } catch (e) { console.warn('Traffico TomTom non disponibile, uso la stima', e); }
  }
  const u =`https://routing.openstreetmap.de/routed-${mode.prof}/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&annotations=duration,distance`;
  const d = await (await fetch(u)).json();
  if (d.code !== 'Ok' || !d.routes.length) throw new Error('Nessun percorso trovato tra le due località.');
  const r = d.routes[0], c = r.geometry.coordinates, dur = r.legs.flatMap((l) => l.annotation.duration), dst = r.legs.flatMap((l) => l.annotation.distance);
  const traffic = mode.prof === 'car', where = {};
  let t = 0, free = 0, metro = null;
  const pts = c.map((p, i) => {
    if (i > 0) {
      const base = dur[i - 1] ?? r.duration / (c.length - 1);
      let f = 1;
      if (traffic && base > 0) {
        if (i % 15 === 1) metro = metroAt(p[0], p[1]);
        f = trafficFactor(new Date(dep.getTime() + t * 1000), ((dst[i - 1] || 0) / base) * 3.6, metro, mode.id === 'moto');
        if (metro && f > 1) where[metro] = (where[metro] || 0) + base * (f - 1);
      }
      free += base; t += base * f;
    }
    return [p[0], p[1], t];
  });
  const hot = Object.entries(where).filter((x) => x[1] >= 120).sort((a, b) => b[1] - a[1]).slice(0, 3).map((x) => `${x[0]} (+${Math.round(x[1] / 60)} min)`);
  return { pts, dist: r.distance, dur: t || r.duration, legs: null, free, delay: traffic ? t - free : null, hot };
}
async function planTransit(from, to, dep) { // mezzi pubblici: orari reali da Transitous
  const u = `https://api.transitous.org/api/v1/plan?fromPlace=${from.lat},${from.lon}&toPlace=${to.lat},${to.lon}&time=${dep.toISOString()}&numItineraries=5`;
  const d = await (await fetch(u)).json();
  const its = (d.itineraries || []).filter((it) => it.legs && it.legs.length).sort((a, b) => new Date(a.endTime) - new Date(b.endTime));
  if (!its.length) throw new Error('Nessun collegamento con i mezzi pubblici trovato per quella data e ora.');
  // il viaggio comincia quando parte il primo collegamento utile: l'attesa non fa parte della durata
  const it = its[0], startAt = new Date(it.legs[0].startTime), t0 = startAt.getTime(), pts = [[from.lon, from.lat, 0]], legs = [];
  let dist = 0;
  for (const l of it.legs) {
    const a = (new Date(l.startTime).getTime() - t0) / 1000, b = (new Date(l.endTime).getTime() - t0) / 1000;
    let g = l.legGeometry && l.legGeometry.points ? decodePolyline(l.legGeometry.points, l.legGeometry.precision || 7) : [];
    if (g.length < 2) g = [[l.from.lon, l.from.lat], [l.to.lon, l.to.lat]];
    const cum = [0];
    for (let i = 1; i < g.length; i++) cum.push(cum[i - 1] + haversine(g[i - 1], g[i]));
    const tot = cum[cum.length - 1] || 1;
    g.forEach((p, i) => pts.push([p[0], p[1], a + ((b - a) * cum[i]) / tot]));
    dist += tot;
    legs.push({ mode: LEG_MODE[l.mode] || '🚆 Treno', line: l.routeShortName || '', from: l.from.name, to: l.to.name, a: new Date(l.startTime), b: new Date(l.endTime), walk: l.mode === 'WALK' });
  }
  return { pts, dist, dur: pts[pts.length - 1][2], legs, startAt, wait: (t0 - dep.getTime()) / 1000 };
}

function sampleTrip(path, dep) { // punti equidistanti nel tempo lungo il percorso
  const p = path.pts, cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + haversine(p[i - 1], p[i]));
  const total = path.dur, n = clamp(Math.round(path.dist / 18000) + 2, 4, 14), out = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const tt = (total * k) / (n - 1);
    while (j < p.length - 2 && p[j + 1][2] < tt) j++;
    const a = p[j], b = p[Math.min(j + 1, p.length - 1)], f = b[2] > a[2] ? clamp((tt - a[2]) / (b[2] - a[2]), 0, 1) : 0;
    out.push({ lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f, t: new Date(dep.getTime() + tt * 1000),
      km: (cum[j] + (cum[Math.min(j + 1, p.length - 1)] - cum[j]) * f) / 1000 });
  }
  return out;
}

function nearPlace(lon, lat) {
  let best = null, bd = 0.11 * 0.11;
  for (const s of S.stations) { const dx = (s.lon - lon) * 0.7, dy = s.lat - lat, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = s; } }
  return best ? best.name.replace(/\s*\(.*?\)\s*/g, ' ').trim() : null;
}

async function tripWeather(samples) { // previsione di ogni punto all'ora in cui ci si passa
  const isoH = (ms) => new Date(Math.round(ms / 3600000) * 3600000).toISOString().slice(0, 16);
  const first = samples[0].t.getTime(), last = samples[samples.length - 1].t.getTime();
  const pos = `latitude=${samples.map((s) => s.lat.toFixed(4)).join(',')}&longitude=${samples.map((s) => s.lon.toFixed(4)).join(',')}`;
  const getJ = (u) => fetch(u).then((r) => r.json()).then((j) => (j.error ? null : Array.isArray(j) ? j : [j])).catch(() => null);
  const [fc, ens] = await Promise.all([
    getJ(`https://api.open-meteo.com/v1/forecast?${pos}&hourly=temperature_2m,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,snowfall,snow_depth,visibility,is_day,cloud_cover` +
      `&start_hour=${isoH(first - 48 * 3600000)}&end_hour=${isoH(last + 3600000)}&wind_speed_unit=kmh`),
    getJ(`https://ensemble-api.open-meteo.com/v1/ensemble?${pos}&hourly=temperature_2m,precipitation&models=ecmwf_ifs025&start_hour=${isoH(first - 3600000)}&end_hour=${isoH(last + 3600000)}`),
  ]);
  if (!fc) throw new Error('Previsione non disponibile per questo viaggio (date troppo lontane o servizio non raggiungibile).');
  samples.forEach((s, i) => {
    const h = fc[i].hourly, key = isoH(s.t.getTime()), k = h.time.indexOf(key), g = (v) => (k >= 0 && h[v] ? h[v][k] : null);
    let unc = null;
    try { unc = ens && ens[i] ? ensembleUncertainty(ens[i]).hour[key] ?? null : null; } catch (e) { unc = null; }
    s.w = { t: g('temperature_2m'), pr: g('precipitation'), pp: g('precipitation_probability'), code: g('weather_code'), ws: g('wind_speed_10m'), wg: g('wind_gusts_10m'),
      wd: g('wind_direction_10m'), sf: g('snowfall'), sd: g('snow_depth'), vis: g('visibility'), day: g('is_day'), cloud: g('cloud_cover'), st: k >= 0 ? snowType(h, k) : null, unc };
  });
}

function tripAlerts(w, mode) { // criticita' in base al mezzo: [livello 0-2, [etichette]]
  if (!w || w.t == null) return [0, []];
  const exposed = mode === 'foot' || mode === 'bike' || mode === 'moto', twoWheels = mode === 'bike' || mode === 'moto', road = mode !== 'transit' && mode !== 'foot';
  const a = [];
  if (w.code >= 95) a.push([2, 'temporale']);
  if (w.sf >= 0.2) a.push([twoWheels || (road && w.sf >= 1) ? 2 : 1, w.sf >= 1 ? 'nevicata intensa' : 'neve']);
  else if (w.pr >= 4) a.push([exposed ? 2 : 1, 'pioggia forte']);
  else if (w.pr >= 0.5) a.push([exposed ? 1 : 0, 'pioggia']);
  if (road && w.t <= 1 && (w.pr > 0 || (w.sd || 0) >= 0.01 || w.st === 4)) a.push([twoWheels ? 2 : 1, 'possibile ghiaccio']);
  else if (road && (w.sd || 0) >= 0.03) a.push([1, 'neve al suolo']);
  if (w.wg >= 75) a.push([2, 'raffiche molto forti']);
  else if (w.wg >= (exposed ? 45 : 60)) a.push([1, 'raffiche forti']);
  if (w.vis != null && w.vis < 1000) a.push([w.vis < 200 && road ? 2 : 1, w.vis < 200 ? 'nebbia fitta' : 'nebbia']);
  return [a.reduce((m, x) => Math.max(m, x[0]), 0), a.filter((x) => x[0] > 0).map((x) => x[1])];
}
const LEVEL_COLOR = ['#34c759', '#ff9500', '#ff3b30'];

async function calcTrip() {
  if (TRIP.busy) return;
  TRIP.fromTxt = $('tFrom').value.trim(); TRIP.toTxt = $('tTo').value.trim(); TRIP.date = $('tDate').value; TRIP.time = $('tTime').value;
  TRIP.error = ''; TRIP.result = null;
  const fail = (m) => { TRIP.error = m; TRIP.busy = false; renderTrip(); };
  if (!TRIP.fromTxt || !TRIP.toTxt || !TRIP.date || !TRIP.time) return fail('Inserisci partenza, arrivo, data e ora.');
  let dep = new Date(`${TRIP.date}T${TRIP.time}`);
  if (isNaN(dep)) return fail('Data o ora non valide.');
  if (dep.getTime() > Date.now() + 13 * 864e5) return fail('Le previsioni arrivano a 13 giorni: scegli una data più vicina.');
  if (dep.getTime() < Date.now() - 6 * 3600000) return fail('La partenza è nel passato.');
  TRIP.busy = true; renderTrip();
  try {
    for (const k of ['from', 'to']) {
      if (!TRIP[k]) { const r = await geocode(TRIP[k + 'Txt']); if (!r.length) throw new Error(`Non trovo «${TRIP[k + 'Txt']}».`); TRIP[k] = r[0]; }
    }
    const mode = MODES.find((m) => m.id === TRIP.mode);
    const path = mode.id === 'transit' ? await planTransit(TRIP.from, TRIP.to, dep) : await planRoad(mode, TRIP.from, TRIP.to, dep);
    const asked = dep;
    if (path.startAt) dep = path.startAt;
    const samples = sampleTrip(path, dep);
    await tripWeather(samples);
    samples.forEach((s, i) => {
      s.place = i === 0 ? TRIP.from.name : i === samples.length - 1 ? TRIP.to.name : nearPlace(s.lon, s.lat);
      [s.level, s.alerts] = tripAlerts(s.w, mode.id);
    });
    TRIP.result = { mode, path, samples, dep, asked, arr: new Date(dep.getTime() + path.dur * 1000) };
    TRIP.busy = false;
    drawTrip(); renderTrip();
  } catch (e) { console.error(e); fail(e.message && !/fetch|JSON|undefined|null/i.test(e.message) ? e.message : 'Calcolo del percorso non riuscito: servizio non raggiungibile, riprova tra poco.'); }
}

function drawTrip() {
  const r = TRIP.result, empty = { type: 'FeatureCollection', features: [] };
  if (!map.getSource('trip')) {
    map.addSource('trip', { type: 'geojson', data: empty });
    map.addSource('trip-pts', { type: 'geojson', data: empty });
    map.addLayer({ id: 'trip-case', type: 'line', source: 'trip', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 7, 'line-opacity': 0.9 } });
    map.addLayer({ id: 'trip-line', type: 'line', source: 'trip', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#007aff', 'line-width': 4 } });
    map.addLayer({ id: 'trip-dot', type: 'circle', source: 'trip-pts', paint: { 'circle-radius': 8, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } });
    map.addLayer({ id: 'trip-label', type: 'symbol', source: 'trip-pts', layout: { 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 12.5, 'text-offset': [0, -1.15], 'text-anchor': 'bottom', 'text-allow-overlap': false, 'text-padding': 2 },
      paint: { 'text-color': DARK ? '#fff' : '#1d1d1f', 'text-halo-color': DARK ? 'rgba(0,0,0,.85)' : '#fff', 'text-halo-width': 2 } });
  }
  if (!r) { map.getSource('trip').setData(empty); map.getSource('trip-pts').setData(empty); return; }
  const step = Math.max(1, Math.floor(r.path.pts.length / 1500)), line = r.path.pts.filter((_, i) => i % step === 0 || i === r.path.pts.length - 1).map((p) => [p[0], p[1]]);
  map.getSource('trip').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: line } });
  map.getSource('trip-pts').setData({ type: 'FeatureCollection', features: r.samples.map((s) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    properties: { color: LEVEL_COLOR[s.level], label: `${hm(s.t)} · ${s.w.t == null ? '—' : Math.round(s.w.t) + '°'}` } })) });
  fitTrip();
}
function fitTrip() {
  const r = TRIP.result;
  if (!r) return;
  const b = new maplibregl.LngLatBounds();
  r.path.pts.forEach((p, i) => { if (i % 20 === 0 || i === r.path.pts.length - 1) b.extend([p[0], p[1]]); });
  const ph = $('panel').hidden ? 120 : $('panel').offsetHeight + 14;
  map.fitBounds(b, { padding: MOBILE ? { top: 124, bottom: Math.min(ph, innerHeight - 230), left: 44, right: 44 } : { top: 90, bottom: 170, left: 250, right: 440 }, maxZoom: 11, duration: 700 });
}

function tripResultHtml() {
  const r = TRIP.result;
  if (!r) return '';
  const day = r.dep.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }), uncs = r.samples.map((s) => s.w.unc).filter((x) => x != null);
  const maxU = uncs.length ? Math.max(...uncs) : null, chip = (u) => `<span class="unc ${uncCls(u)}">${uncTxt(u)}</span>`;
  let out = `<div class="trip-sum"><div class="ts-main">${r.mode.ico} ${durTxt(r.path.dur)} · ${fmt(r.path.dist / 1000, 0)} km</div>
    <div class="ts-sub">${esc(day)} · partenza ${hm(r.dep)} → arrivo ${hm(r.arr)}${r.arr.getDate() !== r.dep.getDate() ? ' (giorno dopo)' : ''}</div>
    ${r.path.wait > 600 ? `<div class="ts-sub"><b>Primo collegamento utile alle ${hm(r.dep)}</b>: ${durTxt(r.path.wait)} dopo l’orario scelto (${hm(r.asked)}). L’attesa non è contata nella durata.</div>` : ''}
    ${r.path.delay != null ? `<div class="ts-sub">🚦 <b>${r.path.live ? 'Traffico TomTom' : 'Traffico stimato'}: ${r.path.delay >= 90 ? `+${durTxt(r.path.delay)}` : 'scorrevole'}</b> (senza traffico ${durTxt(r.path.free)})${r.path.hot.length ? ` · rallentamenti attesi: ${esc(r.path.hot.join(', '))}` : ''}</div>` : ''}
    <div class="ts-sub">Incertezza massima della previsione lungo il viaggio: ${chip(maxU)}</div></div>`;
  const seen = new Map();
  r.samples.forEach((s) => s.alerts.forEach((a) => { if (!seen.has(a)) seen.set(a, s); }));
  out += '<div class="trip-alerts">' + (seen.size ? [...seen].map(([a, s]) => `<div class="al l${s.level}">⚠️ <b>${a[0].toUpperCase() + a.slice(1)}</b> verso le ${hm(s.t)}${s.place ? ` (${esc(s.place)})` : `, km ${Math.round(s.km)}`}</div>`).join('')
    : '<div class="al l0">✅ Nessuna criticità prevista lungo il percorso</div>') + '</div>';
  if (r.path.legs) {
    out += '<div class="sec"><h3>Collegamento</h3><div class="card legs">' + r.path.legs.filter((l) => !l.walk || (l.b - l.a) > 4 * 60000).map((l) =>
      `<div><b>${hm(l.a)}–${hm(l.b)}</b> ${l.mode}${l.line ? ' ' + esc(l.line) : ''}<small>${esc(l.from)} → ${esc(l.to)}</small></div>`).join('') + '</div></div>';
  }
  out += '<div class="sec"><h3>Meteo lungo il percorso</h3><div class="card trip-rows">' + r.samples.map((s, i) => {
    const w = s.w;
    if (w.t == null) return `<div class="tr" data-i="${i}"><div class="tt">${hm(s.t)}</div><div class="tb">Previsione non disponibile</div></div>`;
    const snowOn = (w.sd || 0) >= 0.01, bits = [
      w.sf >= 0.1 ? `❄️ ${fmt(w.sf, 1)} cm/h` : `💧 ${fmt(w.pr, 1)} mm${w.pp != null ? ` (${w.pp}%)` : ''}`,
      `💨 ${Math.round(w.ws)}${w.wg != null ? '/' + Math.round(w.wg) : ''} km/h ${compass(w.wd)}`,
      w.vis != null && w.vis < 5000 ? `👁 ${w.vis < 1000 ? Math.round(w.vis) + ' m' : fmt(w.vis / 1000, 1) + ' km'}` : `☁ ${w.cloud ?? '—'}%`,
      snowOn ? `⛄ ${Math.round(w.sd * 100)} cm${w.st ? ' · ' + SNOW_TYPES[w.st].toLowerCase() : ''}` : '',
    ].filter(Boolean);
    return `<div class="tr l${s.level}" data-i="${i}"><div class="tt">${hm(s.t)}<small>km ${Math.round(s.km)}</small></div>
      <div class="tb"><div class="tp">${wmo(w.code, w.day)[0]} <b>${Math.round(w.t)}°</b> ${esc(s.place || '')}${chip(w.unc)}</div>
      <div class="td">${bits.join(' · ')}</div>${s.alerts.length ? `<div class="ta">⚠️ ${s.alerts.join(', ')}</div>` : ''}</div></div>`;
  }).join('') + '</div></div>';
  out += `<div class="note">Tocca una riga per vederla sulla mappa. Tempi di percorrenza ${r.path.legs ? 'dagli orari dei mezzi pubblici (Transitous)' : r.path.live ? 'di TomTom, con traffico in tempo reale e traffico tipico previsto per l’ora di partenza' : `calcolati su OpenStreetMap${r.path.delay != null ? `, allungati con una stima del traffico tipico per ora, giorno e tipo di strada${r.mode.id === 'moto' ? ' (per la moto metà del ritardo dell’auto)' : ''}. Non è traffico in tempo reale: incidenti, cantieri ed esodi non sono previsti` : ''}`}. Soste e code spostano gli orari di passaggio e quindi il meteo che troverai.
    La percentuale accanto a ogni punto è l’incertezza della previsione per quell’ora.</div><button id="tClear" class="ghost">Cancella viaggio</button>`;
  return out;
}

function renderTrip() {
  const today = new Date(), d0 = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`, mx = new Date(Date.now() + 13 * 864e5);
  if (!TRIP.date) { const n = new Date(Date.now() + 3600000); TRIP.date = d0; TRIP.time = `${pad2(n.getHours())}:00`; if (n.getDate() !== today.getDate()) TRIP.date = `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`; }
  $('panelBody').innerHTML = `<h2 class="p-title">Pianifica un viaggio</h2><div class="p-sub">Il meteo previsto lungo il tragitto, all’ora in cui ci passerai.</div>
    <div class="trip-form">
      <div class="tf"><label for="tFrom">Partenza</label><input id="tFrom" type="text" placeholder="es. Milano" autocomplete="off" value="${esc(TRIP.fromTxt)}"><div class="tsug" hidden></div></div>
      <div class="tf"><label for="tTo">Arrivo</label><input id="tTo" type="text" placeholder="es. Imperia" autocomplete="off" value="${esc(TRIP.toTxt)}"><div class="tsug" hidden></div></div>
      <div class="trow"><div class="tf"><label for="tDate">Data</label><input id="tDate" type="date" min="${d0}" max="${mx.getFullYear()}-${pad2(mx.getMonth() + 1)}-${pad2(mx.getDate())}" value="${TRIP.date}"></div>
        <div class="tf"><label for="tTime">Ora di partenza</label><input id="tTime" type="time" value="${TRIP.time}"></div></div>
      <div class="modes">${MODES.map((m) => `<button data-m="${m.id}" class="${m.id === TRIP.mode ? 'on' : ''}"><span>${m.ico}</span>${m.name}</button>`).join('')}</div>
      <button id="tGo" class="primary" ${TRIP.busy ? 'disabled' : ''}>${TRIP.busy ? 'Calcolo percorso e meteo…' : 'Calcola viaggio'}</button>
      ${TRIP.error ? `<div class="trip-err">${esc(TRIP.error)}</div>` : ''}
    </div><div id="tOut">${tripResultHtml()}</div>`;
  for (const k of ['from', 'to']) {
    const inp = $(k === 'from' ? 'tFrom' : 'tTo'), box = inp.nextElementSibling;
    let tm = 0;
    inp.addEventListener('input', () => {
      TRIP[k] = null; TRIP[k + 'Txt'] = inp.value; clearTimeout(tm);
      if (inp.value.trim().length < 2) { box.hidden = true; return; }
      tm = setTimeout(async () => {
        try {
          const list = await geocode(inp.value.trim());
          if (document.activeElement !== inp || !list.length) { box.hidden = true; return; }
          box.innerHTML = list.map((x, i) => `<button data-i="${i}">${esc(x.name)}<small>${esc(x.sub)}</small></button>`).join('');
          box.hidden = false;
          box.onpointerdown = (ev) => { const b = ev.target.closest('button'); if (!b) return; ev.preventDefault(); const x = list[+b.dataset.i]; TRIP[k] = x; TRIP[k + 'Txt'] = inp.value = x.name; box.hidden = true; };
        } catch (e) { box.hidden = true; }
      }, 250);
    });
    inp.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
  }
  document.querySelector('.modes').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; TRIP.mode = b.dataset.m; document.querySelectorAll('.modes button').forEach((x) => x.classList.toggle('on', x === b)); };
  $('tGo').onclick = calcTrip;
  $('tDate').onchange = () => { TRIP.date = $('tDate').value; }; $('tTime').onchange = () => { TRIP.time = $('tTime').value; };
  const clr = $('tClear');
  if (clr) clr.onclick = () => { TRIP.result = null; drawTrip(); renderTrip(); };
  const rows = document.querySelector('.trip-rows');
  if (rows) rows.onclick = (e) => {
    const el = e.target.closest('.tr'), r = TRIP.result;
    if (!el || !r) return;
    const s = r.samples[+el.dataset.i], ts = s.t.getTime() / 1000, t = S.grid ? S.grid.times : [];
    map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 8.5), padding: MOBILE ? { bottom: innerHeight * 0.5 } : { right: 400 } });
    if (t.length && ts >= t[0] - 1800 && ts <= t[t.length - 1] + 5400) { stop(); setTime(t.reduce((b, x, i) => (Math.abs(x - ts) < Math.abs(t[b] - ts) ? i : b), 0)); }
  };
}
function openTrip() {
  if (window.sunStop) sunStop();
  panelReq++; S.sel = null; updateStations();
  $('panel').hidden = false; renderTrip(); $('panelBody').scrollTop = 0;
}
$('tripBtn').onclick = openTrip;
$('sunBtn').onclick = () => window.openSun();

/* ---------- caricamento ---------- */
const getData = (name) => fetch(`data/${name}.json?t=${Math.floor(Date.now() / 60000)}`).then((r) => { if (!r.ok) throw new Error(name + ' ' + r.status); return r.json(); });

async function loadStations() {
  const r = await getData('stations');
  S.stations = r.stations; S.sources = r.sources; S.stUpdated = r.updated;
  renderSources();
  if (S.grid) { computeCorrections(); setTime(S.ti); } else updateStations();
  if (S.sel) { const s = S.stations.find((x) => x.id === S.sel); if (s && !$('panel').hidden) openPanel({ station: s }); }
}
async function loadGrid() {
  const g = await getData('grid');
  if (g.error) throw new Error(g.error);
  const first = !S.grid;
  S.grid = g;
  setupField(); layoutTimeline(); computeCorrections();
  if (first) { windView(); windTick(); }
  setTime(first ? S.nowTi : Math.min(S.ti, g.times.length - 1));
  showUpdated();
}

buildLayers(); refreshLayerUi(); drawLegend(); initTimeline();
map.on('load', async () => {
  setupStations();
  const fail = (what) => (e) => { $('loadingText').textContent = `${what} non disponibile: riprovo tra poco`; console.error(e); return 'fail'; };
  try { const d = await fetch('data/dem.json').then((r) => r.json()); d.z = Float32Array.from(d.z); S.dem = d; } catch (e) { console.warn('rilievo non disponibile', e); }
  const res = await Promise.all([loadGrid().catch(fail('Modello')), loadStations().catch(fail('Stazioni'))]);
  if (!res.includes('fail')) $('loading').classList.add('done');
  setInterval(() => loadStations().catch(() => {}), 5 * 60 * 1000);
  setInterval(() => loadGrid().then(() => $('loading').classList.add('done')).catch(() => {}), 20 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.stUpdated && Date.now() - new Date(S.stUpdated).getTime() > 12 * 60000) loadStations().catch(() => {}); });
});
