/* 晴天 · 一根红线 —— a hand-drawn motion piece.
 * Every frame is a pure function of its frame number: window.SCENE.render(frame).
 * World units are pixels of a 1080x1920 sheet at zoom 1; a camera drifts over the paper.
 */
(function () {
'use strict';

// ------------------------------------------------------------------ constants
const W = 1080, H = 1920, FPS = 30, DUR = 31.4;
const NF = Math.round(DUR * FPS);
const BEAT = 0.8755, B0 = 0.50;               // measured: 68.5 BPM, first downbeat 0.50 s
const TEXT = '刮风这天我试着握着你手，但偏偏风大到我看你不见';
const SUB_T0 = 6.98;                            // subtitle start (SRT)

const C = {
  paper: [242, 233, 217], ink: [46, 44, 51], red: [200, 64, 45], blue: [111, 143, 168],
  deep: [38, 60, 84], gold: [227, 174, 74], ochre: [214, 182, 134]
};
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ------------------------------------------------------------------ math
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const inv = (a, b, x) => clamp((x - a) / (b - a));
const smooth = t => t * t * (3 - 2 * t);
const gauss = (t, c, s) => Math.exp(-((t - c) * (t - c)) / (2 * s * s));
function bez(x1, y1, x2, y2) {           // CSS-style cubic-bezier easing
  return function (x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 10; i++) {
      const mt = 1 - t;
      const cx = 3 * x1 * t * mt * mt + 3 * x2 * t * t * mt + t * t * t - x;
      const d = 3 * x1 * mt * mt + 6 * (x2 - x1) * t * mt + 3 * (1 - x2) * t * t;
      if (Math.abs(d) < 1e-6) break;
      t = clamp(t - cx / d);
    }
    const mt = 1 - t;
    return 3 * y1 * t * mt * mt + 3 * y2 * t * t * mt + t * t * t;
  };
}
const ease = {
  outExpo: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: t => (t <= 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inCubic: t => t * t * t,
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t, s = 1.70158) => { const u = t - 1; return 1 + (s + 1) * u * u * u + s * u * u; },
  spring: (t, z = 0.4, w = 13) => {
    if (t <= 0) return 0; if (t >= 1) return 1;
    const wd = w * Math.sqrt(1 - z * z);
    const v = 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
    const f = Math.pow(t, 6);
    return v * (1 - f) + f;
  },
  pen: bez(0.5, 0.05, 0.25, 1),          // a hand's stroke: hesitate, rush, settle
  windPen: bez(0.3, 0.12, 0.5, 1),
  antic: bez(0.55, -0.4, 0.2, 1.2),     // anticipation + overshoot
  snap: bez(0.2, 0.9, 0.1, 1)
};

// value noise
function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7 + 74.7) * 43758.5453; return s - Math.floor(s); }
function noise1(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u); }
function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash2(ix, iy), hash2(ix + 1, iy), ux), lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), ux), uy);
}
const sn1 = x => noise1(x) * 2 - 1;
const sn2 = (x, y) => noise2(x, y) * 2 - 1;
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ paths
function catmull(ctrl, per, closed = false) {
  const out = [], n = ctrl.length;
  const P = i => (closed ? ctrl[(i + n) % n] : ctrl[Math.max(0, Math.min(n - 1, i))]);
  const segs = closed ? n : n - 1;
  for (let s = 0; s < segs; s++) {
    const p0 = P(s - 1), p1 = P(s), p2 = P(s + 1), p3 = P(s + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      ]);
    }
  }
  if (!closed) out.push(ctrl[n - 1].slice());
  return out;
}
function plen(p) { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; }
function resample(p, N) {
  const L = [0];
  for (let i = 1; i < p.length; i++) L.push(L[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  const T = L[L.length - 1] || 1, out = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const d = (T * i) / (N - 1);
    while (j < p.length - 2 && L[j + 1] < d) j++;
    const seg = L[j + 1] - L[j] || 1, f = clamp((d - L[j]) / seg);
    out.push([lerp(p[j][0], p[j + 1][0], f), lerp(p[j][1], p[j + 1][1], f)]);
  }
  return out;
}
const byLen = (p, step) => resample(p, Math.max(2, Math.round(plen(p) / step)));
function rotP(p, c, a) {
  const s = Math.sin(a), co = Math.cos(a), dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * co - dy * s, c[1] + dx * s + dy * co];
}
function circlePts(cx, cy, r, a0, a1, n, wob = 0, seed = 0) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = lerp(a0, a1, i / n), rr = r * (1 + wob * sn1(seed + i * 0.7));
    out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return out;
}

// ------------------------------------------------------------------ canvases
let main, mctx, buf, bctx, ink, ictx, txt, tctx, paper, toothPat, toothCanvas, grainTiles = [];
const PX0 = -1000, PY0 = -700, PW = 2900, PH = 3400;
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function makePaper() {
  paper = mk(PW, PH);
  const g = paper.getContext('2d');
  g.fillStyle = rgba(C.paper, 1); g.fillRect(0, 0, PW, PH);
  // low-frequency mottling
  const lw = Math.ceil(PW / 10), lh = Math.ceil(PH / 10), low = mk(lw, lh), lg = low.getContext('2d');
  const id = lg.createImageData(lw, lh);
  for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
    const v = noise2(x * 0.035, y * 0.035) * 0.55 + noise2(x * 0.12 + 40, y * 0.12) * 0.3 + noise2(x * 0.4, y * 0.4 + 9) * 0.15;
    const k = (y * lw + x) * 4, d = (v - 0.5) * 26;
    id.data[k] = 238 + d; id.data[k + 1] = 228 + d; id.data[k + 2] = 210 + d * 1.1; id.data[k + 3] = 255;
  }
  lg.putImageData(id, 0, 0);
  g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.55; g.imageSmoothingQuality = 'high';
  g.drawImage(low, 0, 0, PW, PH);
  // fine grain (tiled)
  const gt = mk(256, 256), gg = gt.getContext('2d'), gd = gg.createImageData(256, 256), r = rng(11);
  for (let i = 0; i < 256 * 256; i++) { const v = 200 + r() * 55; gd.data[i * 4] = v; gd.data[i * 4 + 1] = v; gd.data[i * 4 + 2] = v * 0.98; gd.data[i * 4 + 3] = 255; }
  gg.putImageData(gd, 0, 0);
  g.globalAlpha = 0.22; g.fillStyle = g.createPattern(gt, 'repeat'); g.fillRect(0, 0, PW, PH);
  // fibres
  g.globalCompositeOperation = 'source-over';
  const fr = rng(5);
  for (let i = 0; i < 4200; i++) {
    const x = fr() * PW, y = fr() * PH, a = fr() * Math.PI * 2, l = 6 + fr() * 30, bend = (fr() - 0.5) * 14;
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l / 2 - Math.sin(a) * bend, y + Math.sin(a) * l / 2 + Math.cos(a) * bend, x + Math.cos(a) * l, y + Math.sin(a) * l);
    const dark = fr() < 0.6;
    g.strokeStyle = dark ? 'rgba(120,98,70,0.07)' : 'rgba(255,252,244,0.16)';
    g.lineWidth = 0.6 + fr() * 0.8; g.stroke();
  }
  // a few soft stains so the sheet feels handled
  for (let i = 0; i < 26; i++) {
    const x = fr() * PW, y = fr() * PH, rr = 60 + fr() * 260;
    const grd = g.createRadialGradient(x, y, 0, x, y, rr);
    grd.addColorStop(0, 'rgba(190,160,120,0.035)'); grd.addColorStop(0.8, 'rgba(190,160,120,0.02)'); grd.addColorStop(1, 'rgba(190,160,120,0)');
    g.fillStyle = grd; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
}
function makeTooth() {
  const S = 512; toothCanvas = mk(S, S);
  const g = toothCanvas.getContext('2d'), d = g.createImageData(S, S), r = rng(77);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // periodic low-frequency modulation so the tile wraps cleanly
    const m = 0.5 + 0.25 * Math.sin((x / S) * Math.PI * 6 + Math.sin((y / S) * Math.PI * 4) * 2) + 0.25 * Math.sin((y / S) * Math.PI * 10 + (x / S) * Math.PI * 2);
    const v = r();
    let a = Math.max(0, v - 0.55) * 2.4 * (0.55 + 0.6 * m);
    if (r() < 0.012) a = 0.9;
    const k = (y * S + x) * 4;
    d.data[k] = 0; d.data[k + 1] = 0; d.data[k + 2] = 0; d.data[k + 3] = Math.min(255, a * 255);
  }
  g.putImageData(d, 0, 0);
}
function makeGrain() {
  for (let s = 0; s < 4; s++) {
    const c = mk(512, 512), g = c.getContext('2d'), d = g.createImageData(512, 512), r = rng(100 + s);
    for (let i = 0; i < 512 * 512; i++) {
      const v = 128 + (r() + r() + r() - 1.5) * 70;
      d.data[i * 4] = v; d.data[i * 4 + 1] = v; d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    grainTiles.push(c);
  }
}

// ------------------------------------------------------------------ wind
function wind(t) {
  let w = 0.55;
  w += 0.55 * gauss(t, 7.02, 0.18);                      // the gust that writes the line
  w += 0.95 * gauss(t, 9.25, 0.33);                      // first real gust
  w += 0.75 * smooth(inv(14.5, 17.2, t)) * (1 - smooth(inv(23.5, 27, t)));
  w *= 1 - 0.72 * gauss(t, 17.68, 0.22);                 // held breath
  w += 2.7 * smooth(inv(17.98, 18.2, t)) * (1 - smooth(inv(23.6, 26.5, t)));
  w += 1.5 * gauss(t, 19.68, 0.3) + 0.8 * gauss(t, 21.51, 0.3) + 1.0 * gauss(t, 23.26, 0.22);
  w -= 0.32 * smooth(inv(25.5, 29, t));
  return Math.max(0.15, w);
}
const WSTEP = 1 / 240; let WC = [];
function buildWind() { WC = [0]; for (let i = 1; i <= Math.ceil((DUR + 2) / WSTEP) + 2; i++) WC.push(WC[i - 1] + wind((i - 0.5) * WSTEP) * WSTEP); }
function windInt(t) { const f = Math.max(0, t) / WSTEP, i = Math.floor(f); return lerp(WC[i] || 0, WC[i + 1] || WC[i] || 0, f - i); }
const stormAmt = t => smooth(inv(17.98, 18.15, t)) * (1 - smooth(inv(23.8, 25.6, t)));

// ------------------------------------------------------------------ static paths
const GROUND_Y = 1520;
let WPATH, GROUND, BREEZES = [], STREAKS = [], LEAVES = [], GRASS = [];
function buildStatic() {
  WPATH = byLen(catmull([
    [-1150, 900], [-950, 820], [-760, 700], [-620, 640], [-530, 720], [-590, 810], [-690, 750], [-640, 645], [-480, 600], [-300, 640], [-120, 650], [80, 625], [235, 668], [305, 790], [250, 884], [165, 838],
    [192, 742], [322, 694], [472, 730], [592, 832], [632, 962], [576, 1038], [514, 992], [546, 904], [652, 930], [722, 1062],
    [732, 1200], [714, 1300], [706, 1330]
  ], 14), 4.5);
  GROUND = byLen(catmull([[-700, 1524], [-300, 1517], [100, 1522], [450, 1518], [800, 1523], [1150, 1517], [1500, 1521], [1900, 1518]], 30), 5);
  const r = rng(3);
  for (let i = 0; i < 16; i++) {
    const x = -300 + r() * 1900, h = 14 + r() * 22, lean = (r() - 0.3) * 10;
    GRASS.push({ x, h, lean, t0: 1.0 + (x + 300) / 1900 * 0.9 + r() * 0.2, seed: r() * 100 });
  }
  // calm-time breezes: a long pencil stroke ending in a curl, accelerating towards the storm
  const bt = [-0.9, 0.25, 1.3, 2.35, 7.42, 8.38, 9.12, 9.3, 10.13, 11.05, 12.05, 13.63, 14.55, 15.3, 15.85, 16.26, 16.7, 17.08, 17.3];
  bt.forEach((t0, i) => {
    const rr = rng(40 + i);
    BREEZES.push({ t0, y: 720 + rr() * 560, len: 700 + rr() * 500, seed: rr() * 100, dir: rr() < 0.5 ? 1 : -1, amp: 25 + rr() * 35, xo: rr() });
  });
  // storm streaks, spawn density follows the wind curve
  const sr = rng(9), T0 = 17.98, T1 = 25.4, cdf = [];
  let acc = 0;
  for (let t = T0; t <= T1; t += 0.01) { acc += Math.pow(wind(t), 1.6) * stormAmtSoft(t); cdf.push([t, acc]); }
  for (let i = 0; i < 360; i++) {
    const target = (i + sr() * 0.8) / 360 * acc;
    let k = 0; while (k < cdf.length - 1 && cdf[k][1] < target) k++;
    STREAKS.push({ t0: cdf[k][0], u: sr(), v: sr(), len: 160 + sr() * 360, path: 900 + sr() * 600, spd: 2300 + sr() * 1700,
      w: 1.2 + sr() * 3.2, blue: sr() < 0.42, brush: sr() < 0.12, seed: sr() * 100, wav: 10 + sr() * 40, ph: sr() * 6 });
  }
  // leaves
  const lr = rng(21);
  const leafTimes = [-1.6, -0.7, 2.4, 4.6, 7.3, 8.9, 9.2, 10.6, 12.4, 14.7, 15.6, 16.5, 17.1];
  leafTimes.forEach(t0 => LEAVES.push({ t0, x0: -250 - lr() * 200, y0: 760 + lr() * 620, s: 18 + lr() * 14, spin: 2 + lr() * 5, ph: lr() * 6, fg: false, k: 1, seed: lr() * 100 }));
  for (let i = 0; i < 26; i++) LEAVES.push({ t0: 17.95 + i * 0.24 + lr() * 0.2, x0: -380 - lr() * 300, y0: 520 + lr() * 1100, s: 16 + lr() * 16, spin: 5 + lr() * 8, ph: lr() * 6, fg: lr() < 0.3, k: 1, seed: lr() * 100 });
  [24.4, 25.3].forEach(t0 => LEAVES.push({ t0, x0: 100 + lr() * 120, y0: 700 + lr() * 500, s: 20 + lr() * 10, spin: 1.2 + lr() * 2, ph: lr() * 6, fg: false, k: 1, seed: lr() * 100 }));
  LEAVES.push({ t0: 8.6, x0: -600, y0: 1150, s: 34, spin: 3, ph: 1, fg: true, k: 1, seed: 7 });
  LEAVES.push({ t0: 15.2, x0: -650, y0: 900, s: 30, spin: 4, ph: 2, fg: true, k: 1, seed: 8 });
  LEAVES.push({ t0: 1.0, x0: -700, y0: 1000, s: 30, spin: 3, ph: 4, fg: true, k: 1, seed: 6 });
  LEAVES.push({ t0: 10.4, x0: -700, y0: 1250, s: 28, spin: 5, ph: 3, fg: true, k: 1, seed: 5 });
}
function stormAmtSoft(t) { return 0.15 + stormAmt(t); }

// ------------------------------------------------------------------ camera
function wProg(t) { return ease.windPen(inv(-1.7, 3.95, t)); }
function idxPt(p, f) { const x = f * (p.length - 1), i = Math.min(p.length - 2, Math.floor(x)), u = x - i; return [lerp(p[i][0], p[i + 1][0], u), lerp(p[i][1], p[i + 1][1], u)]; }
function mixCam(a, b, e) { return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), z: lerp(a.z, b.z, e), r: lerp(a.r, b.r, e) }; }
function followCam(t) {
  const tip = idxPt(WPATH, wProg(t - 0.32));
  const z = lerp(1.62, 1.2, ease.outCubic(inv(0, 3.4, t)));
  const k = lerp(0.97, 0.58, ease.inOutSine(inv(0, 3.2, t)));
  return { x: k * tip[0] + (1 - k) * 380, y: lerp(tip[1], 0.42 * tip[1] + 0.58 * 1180, inv(0, 3.2, t)), z, r: 0.03 * (1 - inv(0, 3.5, t)) };
}
function camAt(t) {
  let c = followCam(Math.min(t, 4.0));
  if (t > 3.6) c = mixCam(c, { x: 690 + 8 * (t - 3.6), y: 1215, z: 1.3 + 0.015 * (t - 3.6), r: -0.01 }, ease.inOutCubic(inv(3.6, 4.9, t)));
  if (t > 6.38) c = mixCam(c, { x: c.x - 8, y: c.y - 14, z: c.z + 0.075, r: c.r - 0.006 }, ease.inCubic(inv(6.38, 6.7, t)));
  if (t > 6.7) c = mixCam(c, { x: 548, y: 1052, z: 1.1, r: 0 }, ease.spring(inv(6.7, 8.0, t), 0.5, 9));
  if (t > 7.7) c = mixCam(c, { x: 505, y: 1028, z: 1.22, r: 0.012 }, ease.inOutSine(inv(7.7, 11.4, t)));
  if (t > 11.5) c = mixCam(c, { x: 548, y: 1186, z: 1.74, r: -0.008 }, bez(0.6, 0, 0.12, 1)(inv(11.5, 13.5, t)));
  if (t > 13.5) c = mixCam(c, { x: 552, y: 1192, z: 1.82, r: -0.012 }, ease.inOutSine(inv(13.5, 14.6, t)));
  if (t > 14.5) c = mixCam(c, { x: 586, y: 1070, z: 1.16, r: -0.024 }, ease.antic(inv(14.5, 15.75, t)));
  if (t > 15.75) c = mixCam(c, { x: 606, y: 1066, z: 1.22, r: -0.032 }, ease.inOutSine(inv(15.75, 17.3, t)));
  if (t > 17.3) c = mixCam(c, { x: 612, y: 1062, z: 1.27, r: -0.036 }, ease.inOutSine(inv(17.3, 17.98, t)));
  if (t > 17.98) c = mixCam(c, { x: 668, y: 1040, z: 1.02, r: 0.014 }, ease.outExpo(inv(17.98, 18.75, t)));
  if (t > 18.75) c = mixCam(c, { x: 752, y: 1030, z: 0.97, r: 0.02 }, ease.inOutSine(inv(18.75, 23.4, t)));
  if (t > 23.4) c = mixCam(c, { x: 726, y: 1015, z: 0.96, r: 0.01 }, ease.inOutSine(inv(23.4, 25.0, t)));
  if (t > 25.0) c = mixCam(c, { x: 602, y: 905, z: 0.905, r: 0 }, ease.inOutCubic(inv(25.0, 28.7, t)));
  if (t > 28.5) c = mixCam(c, { x: 600, y: 900, z: 0.92, r: 0 }, ease.outCubic(inv(28.5, 31.0, t)));
  // breathing drift (fades out into the final hold)
  const live = 1 - 0.8 * smooth(inv(29.8, 31.0, t));
  c.x += sn1(t * 0.23 + 3) * 7 * live; c.y += sn1(t * 0.19 + 11) * 6 * live; c.r += sn1(t * 0.17 + 5) * 0.003 * live;
  const sh = stormAmt(t) * (0.55 + 0.45 * wind(t) / 4) + 1.2 * gauss(t, 18.02, 0.08) + 0.8 * gauss(t, 19.7, 0.1) + 0.6 * gauss(t, 23.28, 0.1);
  c.x += sn1(t * 9.3) * sh * 9; c.y += sn1(t * 8.1 + 40) * sh * 7; c.r += sn1(t * 7.7 + 9) * sh * 0.006;
  return c;
}
function camMatrix(c, par = 1) {
  const z = 1 + (c.z - 1) * par, cx = 548 + (c.x - 548) * par, cy = 1000 + (c.y - 1000) * par, r = c.r * par;
  const a = z * Math.cos(r), b = z * Math.sin(r), cc = -z * Math.sin(r), d = z * Math.cos(r);
  return [a, b, cc, d, W / 2 - (a * cx + cc * cy), H / 2 - (b * cx + d * cy)];
}
function toScreen(M, p) { return [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]]; }
function toWorld(c, sx, sy) { // inverse for r≈0 use (used for authoring the final composition)
  return [c.x + (sx - W / 2) / c.z, c.y + (sy - H / 2) / c.z];
}

// ------------------------------------------------------------------ hand-drawn line
let WSCALE = 1;
function drawLine(g, pts, o) {
  const n = pts.length; if (n < 2) return;
  const a = clamp(o.tail || 0) * (n - 1), b = clamp(o.head == null ? 1 : o.head) * (n - 1);
  if (b - a < 0.6) return;
  const i0 = Math.floor(a), i1 = Math.min(n - 1, Math.ceil(b));
  const seed = o.seed || 0, amp = o.amp == null ? 1.6 : o.amp, bf = o.bf || 0, w = (o.w || 3) * WSCALE;
  const ts = o.taper == null ? 12 : o.taper, drawing = o.head != null && o.head < 1;
  const X = [], Y = [], Wd = [];
  for (let i = i0; i <= i1; i++) {
    let x, y, gi = i;
    if (i === i0 && a > i0) { const f = a - i0; x = lerp(pts[i0][0], pts[i0 + 1][0], f); y = lerp(pts[i0][1], pts[i0 + 1][1], f); gi = a; }
    else if (i === i1 && b < i1) { const f = b - (i1 - 1); x = lerp(pts[i1 - 1][0], pts[i1][0], f); y = lerp(pts[i1 - 1][1], pts[i1][1], f); gi = b; }
    else { x = pts[i][0]; y = pts[i][1]; }
    x += sn2(seed + gi * 0.045, bf * 1.37) * amp + sn2(seed + 7 + gi * 0.33, bf * 2.11) * amp * 0.28;
    y += sn2(seed + 50 + gi * 0.045, bf * 1.37 + 9) * amp + sn2(seed + 57 + gi * 0.33, bf * 2.11 + 5) * amp * 0.28;
    X.push(x); Y.push(y);
    let tw = Math.min(1, (gi + 1) / ts, (n - gi) / ts);
    if (drawing) tw *= Math.min(1, 0.45 + (b - gi) / 10);
    if (o.tail) tw *= Math.min(1, 0.3 + (gi - a) / 14);
    const pr = (o.press == null ? 0.42 : o.press);
    Wd.push(w * Math.max(0.12, Math.pow(Math.max(0, tw), 0.6)) * (1 - pr / 2 + pr * noise1(seed * 3.7 + gi * 0.021 + bf * 0.05)));
  }
  const m = X.length; if (m < 2) return;
  g.beginPath();
  const Lx = [], Ly = [], Rx = [], Ry = [];
  for (let i = 0; i < m; i++) {
    const p = Math.max(0, i - 1), q = Math.min(m - 1, i + 1);
    let dx = X[q] - X[p], dy = Y[q] - Y[p]; const d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d, ny = dx / d, hw = Wd[i] / 2;
    Lx.push(X[i] + nx * hw); Ly.push(Y[i] + ny * hw); Rx.push(X[i] - nx * hw); Ry.push(Y[i] - ny * hw);
  }
  g.moveTo(Lx[0], Ly[0]);
  for (let i = 1; i < m; i++) g.lineTo(Lx[i], Ly[i]);
  for (let i = m - 1; i >= 0; i--) g.lineTo(Rx[i], Ry[i]);
  g.closePath();
  g.fillStyle = o.color || rgba(C.ink, o.alpha == null ? 0.92 : o.alpha);
  g.fill();
  if (o.passes === 2) {   // a second, lighter pencil pass — the sketchy double line
    drawLine(g, pts, Object.assign({}, o, { passes: 1, seed: seed + 33, w: (o.w || 3) * 0.45, amp: amp * 1.5,
      color: o.color2 || rgba(C.ink, 0.32) }));
  }
}
function pencil(g, pts, bf, seed, extra) {
  drawLine(g, pts, Object.assign({ w: 4.0, amp: 1.5, bf, seed, passes: 2, color: rgba(C.ink, 0.95), press: 0.5 }, extra || {}));
}
function crayon(g, pts, bf, seed, extra) {
  drawLine(g, pts, Object.assign({ w: 8.5, amp: 1.9, bf, seed, color: rgba(C.red, 0.95), press: 0.35, taper: 16 }, extra || {}));
}
function dot(g, x, y, r, col, bf, seed) {
  g.beginPath();
  for (let i = 0; i <= 10; i++) { const a = i / 10 * Math.PI * 2, rr = r * (1 + 0.18 * sn2(seed + i, bf)); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.fillStyle = col; g.fill();
}

// ------------------------------------------------------------------ washes (watercolour)
function washBlob(g, cx, cy, R, sx, sy, col, alpha, seed, t) {
  if (R < 2 || alpha <= 0.002) return;
  for (let k = 0; k < 5; k++) {
    g.beginPath();
    const n = 90;
    for (let j = 0; j <= n; j++) {
      const an = j / n * Math.PI * 2;
      const ca = Math.cos(an), sa = Math.sin(an);
      const rr = R * (0.8 + 0.2 * noise2(seed + k * 3.1 + ca * 1.4, sa * 1.4 + t * 0.06) + 0.06 * sn2(seed * 2 + ca * 5 + k, sa * 5)) * (1 - k * 0.07);
      g.lineTo(cx + ca * rr * sx, cy + sa * rr * sy);
    }
    g.closePath();
    g.fillStyle = rgba(col, alpha * 0.26);
    g.fill();
    if (k === 0) { g.strokeStyle = rgba(col, alpha * 0.32); g.lineWidth = 3.5; g.stroke(); } // pigment pools at the wet edge
  }
}
function drawWashes(g, t, cam) {
  // sky (parallax layer set by caller)
  washBlob(g, 900, 560, 560 * ease.outExpo(inv(-0.6, 2.6, t)), 1.35, 0.7, C.blue, 0.13 * (1 - 0.35 * smooth(inv(27, 30, t))), 4, t);
  washBlob(g, 160, 1600, 760 * ease.outExpo(inv(1.6, 3.6, t)), 1.7, 0.22, C.ochre, 0.42, 9, t);
  // the storm creeps in, then bursts at 18.0
  const recede = 1 - 0.62 * smooth(inv(24.0, 27.5, t));
  const s1 = 0.38 * ease.outCubic(inv(15.9, 17.9, t)) + 1.2 * ease.outExpo(inv(17.98, 19.1, t));
  washBlob(g, 1330, 960, 620 * s1, 1.05, 1.25, C.blue, 0.34 * recede, 17, t);
  washBlob(g, 120, 640, 520 * ease.outExpo(inv(19.6, 20.7, t)), 1.3, 0.9, C.blue, 0.26 * recede, 23, t);
  washBlob(g, 1000, 1250, 600 * ease.outExpo(inv(21.45, 22.8, t)), 1.5, 0.9, C.deep, 0.11 * recede, 31, t);
  // the sun the string draws
  const sunE = ease.outExpo(inv(28.62, 30.0, t));
  washBlob(g, SUN[0], SUN[1], 150 * sunE, 1, 1, C.gold, 0.62, 41, t);
  washBlob(g, SUN[0], SUN[1], 420 * ease.outCubic(inv(28.9, 31.0, t)), 1.1, 1, C.gold, 0.16, 47, t);
}

// ------------------------------------------------------------------ characters
const BOY = { x: 330, feet: [330, GROUND_Y] };
const FINAL_CAM = { x: 600, y: 900, z: 0.92, r: 0 };
const SUN = toWorld(FINAL_CAM, 800, 772);   // where the string ends up looping
const SUN_R = 132;
const HAND_FINAL = [438, 1150];

function boyHand(t) {
  let h = [418 + 3 * Math.sin(t * 1.3), 1330 + 2 * Math.sin(t * 1.7)];
  if (t > 11.0) h = [lerp(h[0], 404, ease.outCubic(inv(11.0, 11.35, t))), lerp(h[1], 1344, ease.outCubic(inv(11.0, 11.35, t)))];
  if (t > 11.35) { const e = ease.outBack(inv(11.35, 12.7, t), 1.4); h = [lerp(404, 545, e), lerp(1344, 1268, e)]; }
  if (t > 12.7) h = [545 + 2 * Math.sin(t * 2.1), 1268 + 2 * Math.sin(t * 1.6)];
  if (t > 17.98) {
    const e = ease.outExpo(inv(17.98, 18.6, t));
    h = [lerp(h[0], 588, e) + sn1(t * 6) * 6 * stormAmt(t), lerp(h[1], 1246, e) + sn1(t * 7 + 3) * 5 * stormAmt(t)];
  }
  if (t > 23.3) { const e = ease.outCubic(inv(23.3, 24.4, t)); h = [lerp(h[0], 560, e), lerp(h[1], 1238, e)]; }
  if (t > 25.0) { const e = ease.inOutCubic(inv(25.0, 27.9, t)); h = [lerp(h[0], HAND_FINAL[0], e), lerp(h[1], HAND_FINAL[1], e)]; }
  if (t > 27.9) { const e = ease.outBack(inv(28.4, 29.1, t), 2.2); h = [HAND_FINAL[0] + 6 * e * (1 - inv(29.1, 30.2, t)), HAND_FINAL[1] - 8 * e + 2 * Math.sin(t * 1.4) * (1 - inv(30.2, 31, t))]; }
  return h;
}
function girlHand(t) {
  let h = [706 + 2 * Math.sin(t * 1.5 + 1), 1330 + 2 * Math.sin(t * 1.2)];
  if (t > 11.3) { const e = bez(0.45, 0, 0.2, 1)(inv(11.3, 12.76, t)); const b = boyHand(t); h = [lerp(h[0], b[0] + 11, e), lerp(h[1], b[1] + 2, e)]; }
  return h;
}
function boyLean(t) {
  return -0.17 * stormAmt(t) + sn1(t * 5) * 0.025 * stormAmt(t) - 0.04 * gauss(t, 9.3, 0.3)
    + 0.03 * ease.outBack(inv(11.35, 12.7, t)) * (1 - inv(17.9, 18.3, t)) - 0.035 * smooth(inv(25.5, 28, t));
}

function boyStrokes(t, t2, bf) {
  const out = [];
  const lean = boyLean(t2), piv = BOY.feet;
  const R = p => rotP(p, piv, lean);
  const head = R([330, 1040]);
  // stroke-order reveal during the intro
  const P = (a, b) => ease.pen(inv(a, b, t));
  // head
  out.push({ pts: byLen(circlePts(head[0], head[1], 64, -2.2, -2.2 + Math.PI * 2.12, 40, 0.03, 3), 4), kind: 'pencil', seed: 1, head: P(B0 + BEAT, B0 + BEAT + 0.47) });
  // hair tuft
  const hair = []; for (let i = 0; i <= 9; i++) { const a = lerp(-2.75, -0.55, i / 9), rr = i % 2 ? 66 : 84 + 6 * Math.sin(t2 * 3 + i); hair.push([head[0] + Math.cos(a) * rr, head[1] + Math.sin(a) * rr]); }
  out.push({ pts: byLen(catmull(hair, 6), 4), kind: 'pencil', seed: 2, head: P(1.85, 2.08), w: 2.6 });
  // eye — looks at her, then up at the sun
  const look = smooth(inv(25.6, 28.2, t2)), eye = [head[0] + lerp(28, 22, look), head[1] + lerp(-2, -22, look)];
  out.push({ dot: eye, r: 5.2, head: P(3.9, 4.0) });
  // coat
  const flap = stormAmt(t2) * 14 * (0.6 + 0.4 * Math.sin(t2 * 17)) + 4 * gauss(t2, 9.3, 0.3);
  const coat = [[312, 1108], [282, 1148], [271, 1262], [261 + flap * 0.3, 1396], [330 + flap * 0.6, 1402], [404 + flap, 1394], [392, 1262], [381, 1148], [349, 1108]].map(R);
  out.push({ pts: byLen(catmull(coat, 10), 4), kind: 'pencil', seed: 3, head: P(2.25, 2.85), w: 3.4 });
  out.push({ pts: byLen(catmull([[331, 1150], [333, 1270], [334, 1392]].map(R), 8), 4), kind: 'pencil', seed: 4, head: P(2.7, 2.95), w: 2.2 });
  // legs
  out.push({ pts: byLen(catmull([[300, 1400], [298, 1462], [297, 1516], [280, 1522]].map(R), 8), 4), kind: 'pencil', seed: 5, head: P(2.85, 3.0) });
  out.push({ pts: byLen(catmull([[360, 1400], [362, 1462], [364, 1516], [382, 1522]].map(R), 8), 4), kind: 'pencil', seed: 6, head: P(2.95, 3.13) });
  // back arm (swings for balance in the storm)
  const sw = stormAmt(t2);
  const bh = R([lerp(262, 228, sw) + 4 * Math.sin(t2 * 1.4), lerp(1330, 1250, sw)]);
  const bs = R([281, 1166]);
  out.push({ pts: byLen(catmull([bs, [lerp(bs[0], bh[0], 0.5) - 10, lerp(bs[1], bh[1], 0.5)], bh], 10), 4), kind: 'pencil', seed: 7, head: P(3.05, 3.25) });
  out.push({ pts: byLen(circlePts(bh[0], bh[1] + 4, 12, -1.2, 5.3, 14, 0.06, 7), 3), kind: 'pencil', seed: 8, head: P(3.2, 3.3), w: 2.6 });
  // reaching arm (rubber hose), hand is in world space
  const hnd = boyHand(t2), sh = R([382, 1166]);
  const mid = [lerp(sh[0], hnd[0], 0.5), lerp(sh[1], hnd[1], 0.5)];
  const dx = hnd[0] - sh[0], dy = hnd[1] - sh[1], dl = Math.hypot(dx, dy) || 1;
  const sag = 22 - Math.min(18, Math.max(0, dl - 150) * 0.12);
  const elbow = [mid[0] - dy / dl * -sag, mid[1] + dx / dl * sag];
  out.push({ pts: byLen(catmull([sh, elbow, hnd], 12), 4), kind: 'pencil', seed: 9, head: P(3.13, 3.38) });
  const sq = 1 + 0.25 * gauss(t2, 12.8, 0.1);
  out.push({ pts: byLen(circlePts(hnd[0] + dx / dl * 8, hnd[1] + dy / dl * 8, 13 * sq, Math.atan2(dy, dx) + 2.4, Math.atan2(dy, dx) + 2.4 + 5.9, 14, 0.07, 9), 3), kind: 'pencil', seed: 10, head: P(3.3, 3.42), w: 2.6 });
  // scarf: blue wash band + pencil edge, streams with the wind
  const wv = wind(t2), str = clamp(0.35 + wv * 0.3, 0.35, 1.5);
  const neck = R([348, 1112]);
  const tail = [R([306, 1104]), R([330, 1120]), neck];
  for (let k = 1; k <= 6; k++) {
    const ph = t2 * (3 + wv * 3.5) - k * 0.9;
    tail.push([neck[0] + k * 26 * str + (1 - str) * k * 4, neck[1] + k * (14 - 9 * clamp(wv / 2)) + Math.sin(ph) * (4 + k * 2.4) * Math.min(1.6, wv)]);
  }
  const scarf = byLen(catmull(tail, 8), 4);
  out.push({ pts: scarf, kind: 'scarf', seed: 11, head: P(3.35, 3.85) });
  return out;
}

// her: one continuous crayon line — hand, arm, dress, legs, head, hair
const GN = 680;
function girlFigure(t) {
  const sway = 0.012 * Math.sin(t * 1.1) + 0.02 * gauss(t, 9.3, 0.3) + 0.03 * smooth(inv(14.5, 17.5, t)) * Math.sin(t * 4);
  const piv = [770, GROUND_Y];
  const R = p => rotP(p, piv, sway);
  const hnd = girlHand(t), S = R([738, 1172]);
  const dx = S[0] - hnd[0], dy = S[1] - hnd[1], dl = Math.hypot(dx, dy) || 1, ang = Math.atan2(dy, dx);
  const loop = [];
  for (let i = 0; i <= 7; i++) { const a = ang + Math.PI + 0.6 + i / 7 * 5.2; loop.push([hnd[0] + Math.cos(a) * 13, hnd[1] + Math.sin(a) * 13]); }
  const wrist = [hnd[0] + dx / dl * 16, hnd[1] + dy / dl * 16];
  const mid = [lerp(hnd[0], S[0], 0.5), lerp(hnd[1], S[1], 0.5)];
  const sag = 20 - Math.min(16, Math.max(0, dl - 150) * 0.12);
  const elbow = [mid[0] + dy / dl * sag * (dx > 0 ? 1 : -1), mid[1] + Math.abs(dx / dl) * sag];
  const p1 = catmull([...loop, wrist, elbow, S], 7);
  const ww = wind(t), hem = 6 * Math.sin(t * 2.3) * Math.min(2, ww) + 10 * smooth(inv(14.5, 17.6, t));
  const body = [S, [722, 1232], [705, 1322], [692 + hem * 0.3, 1402], [742, 1405], [744, 1460], [742, 1515], [727, 1521], [750, 1519], [754, 1460], [756, 1405],
    [792, 1405], [796, 1460], [798, 1515], [815, 1521], [803, 1514], [803, 1405], [852 + hem, 1400 - hem * 0.4], [836 + hem * 0.4, 1300], [812, 1212], [800, 1170], [770, 1146]].map((p, i) => (i ? R(p) : p));
  const p2 = catmull(body, 7);
  const hc = R([770, 1075]);
  const p3 = circlePts(hc[0], hc[1], 56, Math.PI / 2, -0.6 - Math.PI * 2, 28, 0.035, 5);
  const hair = [];
  const fray = smooth(inv(14.6, 17.9, t));
  for (let k = 0; k <= 7; k++) {
    const ph = t * (2.4 + ww * 2.2) - k * 0.95;
    const lift = k * k * 1.6 * fray;
    hair.push([hc[0] + 46 + k * (34 + 12 * clamp(ww / 2)), hc[1] - 32 + k * (10 - 4 * clamp(ww / 1.5)) - lift + Math.sin(ph) * (3 + k * 3.2) * Math.min(1.8, ww)]);
  }
  const p4 = catmull(hair, 7);
  const all = p1.concat(p2.slice(1), p3.slice(1), p4.slice(1));
  return resample(all, GN);
}
// the string she becomes: integrate a heading that the wind keeps bending
function stringStorm(t, start, L, N) {
  const pts = []; let x = start[0], y = start[1]; const ds = L / (N - 1);
  const wN = clamp(wind(t) / 3.6);
  for (let i = 0; i < N; i++) {
    pts.push([x, y]);
    const s = i * ds, env = clamp(s / 240);
    const th = -0.3 - 0.32 * clamp(s / 1600) + env * (0.66 * Math.sin(s / 150 - t * 8.2) + 0.24 * Math.sin(s / 52 - t * 13.0 + 1.3)) * (0.45 + 0.55 * wN);
    x += Math.cos(th) * ds; y += Math.sin(th) * ds;
  }
  return pts;
}
const N1 = Math.round(GN * 0.52);
function stringFinal(t, start, closed) {
  const pre = resample(catmull([start, [start[0] + 110, start[1] - 40], [start[0] + 280, start[1] - 50], [SUN[0] + SUN_R * 0.9, SUN[1] + 300], [SUN[0] + SUN_R + 6, SUN[1] + 120], [SUN[0] + SUN_R, SUN[1]]], 14), N1);
  let rest;
  if (closed) {
    const lp = [];
    const turns = 1.16;
    for (let i = 0; i <= 80; i++) {
      const q = i / 80, a = -q * Math.PI * 2 * turns;
      const r = SUN_R * (1 + 0.035 * Math.sin(a * 3 + 1) - 0.07 * q);
      lp.push([SUN[0] + Math.cos(a) * r, SUN[1] + Math.sin(a) * r]);
    }
    const e = lp[lp.length - 1], aE = -Math.PI * 2 * turns;
    lp.push([e[0] + Math.sin(aE) * -40 + 18, e[1] - Math.cos(aE) * 40 - 30]);
    rest = resample(lp, GN - N1 + 1);
  } else {
    const o = [];
    for (let i = 0; i <= 60; i++) {
      const q = i / 60;
      const base = [SUN[0] + SUN_R + q * 380, SUN[1] - q * 640];
      const amp = 22 * q * (1 + 0.5 * wind(t));
      o.push([base[0] + Math.sin(q * 9 - t * 3.2) * amp, base[1] + Math.cos(q * 7 - t * 2.6) * amp * 0.4]);
    }
    rest = resample(o, GN - N1 + 1);
  }
  return pre.concat(rest.slice(1));
}

const UNRAVEL = [[18.3, 0], [19.45, 0.12], [19.98, 0.37], [21.5, 0.6], [22.62, 0.86], [23.26, 1]];
function unravelFrac(t) {
  if (t <= UNRAVEL[0][0]) return 0;
  for (let k = 1; k < UNRAVEL.length; k++) {
    const [ta, qa] = UNRAVEL[k - 1], [tb, qb] = UNRAVEL[k];
    if (t <= tb) return lerp(qa, qb, bez(0.4, 0, 0.35, 1)(inv(ta, tb, t)));
  }
  return 1;
}
function girlLine(t, t2) {
  let G = girlFigure(t2);
  if (t2 < 18.3) return G;
  const L = plen(G);
  // thread geometry, built from the origin with the same spacing as her line
  const SS = stringStorm(t2, [0, 0], L, GN);
  const out = new Array(GN);
  const fIdx = (GN - 1) * (1 - unravelFrac(t2));
  const fi = Math.min(GN - 2, Math.floor(fIdx)), ff = fIdx - fi;
  const front = [lerp(G[fi][0], G[fi + 1][0], ff), lerp(G[fi][1], G[fi + 1][1], ff)];
  const sa = stormAmt(t2);
  for (let i = 0; i < GN; i++) {
    if (i <= fIdx) {
      const p = G[i], shiv = sa * (GROUND_Y - p[1]) / 400;
      out[i] = [p[0] + sn2(i * 0.05, t2 * 6) * 6 * shiv + 10 * shiv, p[1] + sn2(i * 0.05 + 30, t2 * 6) * 4 * shiv];
    } else {
      const j = i - fIdx, ji = Math.min(GN - 2, Math.floor(j)), jf = j - ji;
      out[i] = [front[0] + lerp(SS[ji][0], SS[ji + 1][0], jf), front[1] + lerp(SS[ji][1], SS[ji + 1][1], jf)];
    }
  }
  const start = boyHand(t2);
  if (t2 < 25.0) return out;
  const OPEN = stringFinal(t2, start, false);
  const e1 = ease.inOutCubic(inv(25.0, 28.4, t2));
  const CL = t2 > 28.3 ? stringFinal(t2, start, true) : null;
  for (let i = 0; i < GN; i++) {
    let p = [lerp(out[i][0], OPEN[i][0], e1), lerp(out[i][1], OPEN[i][1], e1)];
    if (CL) {
      const q = i < N1 ? 0 : (i - N1) / (GN - N1);
      const ts = 28.5 + q * 0.62;
      const e2 = i < N1 ? ease.outCubic(inv(28.5, 29.2, t2)) : ease.outBack(inv(ts, ts + 0.5, t2), 1.3);
      p = [lerp(p[0], CL[i][0], e2), lerp(p[1], CL[i][1], e2)];
    }
    out[i] = p;
  }
  return out;
}

// ------------------------------------------------------------------ text (the subtitle is an actor)
const N_T = TEXT.length;
function layout(lines) {
  const st = new Array(N_T);
  for (const ln of lines) {
    let x = ln.x;
    for (let i = ln.a; i < ln.b; i++) {
      const s = ln.s, ch = TEXT[i], adv = ch === '，' ? 0.6 : 0.98;
      const col = (ln.cols && ln.cols[i]) || C.ink;
      st[i] = { x: x + (ch === '，' ? s * 0.3 : s * 0.49), y: ln.y, s, col, hollow: (ln.hollow && ln.hollow[i]) || 0, em: ln.em ? 1 : 0 };
      x += s * adv;
    }
  }
  return st;
}
const LAYOUTS = [
  { t: SUB_T0, L: layout([
    { a: 0, b: 4, s: 196, x: 70, y: 400, em: 1, cols: { 1: C.red } },
    { a: 4, b: 12, s: 80, x: 80, y: 572 },
    { a: 12, b: 23, s: 80, x: 80, y: 670 }]) },
  { t: 10.86, dur: 0.95, stag: 0.04, L: layout([
    { a: 0, b: 7, s: 70, x: 80, y: 236 },
    { a: 7, b: 12, s: 176, x: 62, y: 420, em: 1, cols: { 9: C.red } },
    { a: 12, b: 23, s: 64, x: 80, y: 574 }]) },
  { t: 14.36, dur: 0.85, stag: 0.035, order: [7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22], L: layout([
    { a: 0, b: 12, s: 60, x: 80, y: 228 },
    { a: 12, b: 15, s: 232, x: 58, y: 440, em: 1 },
    { a: 15, b: 23, s: 76, x: 80, y: 622, cols: { 20: C.red } }]) },
  { t: 17.9, dur: 0.5, stag: 0.02, snap: 1, order: [12, 13, 14, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16, 17, 18, 19, 20, 21, 22], L: layout([
    { a: 0, b: 15, s: 50, x: 80, y: 214 },
    { a: 15, b: 18, s: 296, x: 52, y: 452, em: 1, cols: { 15: C.deep, 16: C.deep, 17: C.deep } },
    { a: 18, b: 23, s: 84, x: 80, y: 650, cols: { 20: C.red } }]) },
  { t: 24.9, dur: 0.95, stag: 0.045, order: [17, 16, 15, 12, 13, 14, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 18, 19, 20, 21, 22], L: layout([
    { a: 0, b: 12, s: 58, x: 80, y: 236 },
    { a: 12, b: 18, s: 58, x: 80, y: 316 },
    { a: 18, b: 23, s: 168, x: 66, y: 492, em: 1, cols: { 20: C.red }, hollow: { 20: 1 } }]) }
];
function textState(t, i) {
  let k = 0;
  while (k + 1 < LAYOUTS.length && t >= LAYOUTS[k + 1].t) k++;
  let A = LAYOUTS[k].L[i], st;
  if (k + 1 < LAYOUTS.length || k > 0) {
    const cur = LAYOUTS[k];
    if (k > 0) {
      const prev = LAYOUTS[k - 1].L[i], B = cur.L[i];
      const rank = cur.order ? cur.order.indexOf(i) : i;
      const p = inv(cur.t + rank * cur.stag, cur.t + rank * cur.stag + cur.dur, t);
      // shrinking glyphs scale down in place first, then travel; growing glyphs travel, then swell
      const shrink = B.s < prev.s * 0.8, grow = B.s > prev.s * 1.25;
      const pp = shrink ? inv(0.22, 1, p) : p, ps = grow ? inv(0.3, 1, p) : shrink ? inv(0, 0.45, p) : p;
      const e = cur.snap ? ease.spring(pp, 0.5, 15) : ease.spring(pp, 0.66, 11);
      const ec = smooth(p);
      st = { x: lerp(prev.x, B.x, e), y: lerp(prev.y, B.y, e) - Math.sin(Math.PI * clamp(pp * 1.3)) * 26 * (cur.snap ? 0.5 : 1),
        s: lerp(prev.s, B.s, grow ? ease.outBack(ps, 1.2) : ease.outCubic(ps)), col: mixc(prev.col, B.col, ec), hollow: B.hollow ? smooth(inv(26.2, 26.9, t)) : 0, em: B.em, p };
      return st;
    }
  }
  return Object.assign({ p: 1 }, A);
}
function drawText(g, t, frame) {
  if (t < SUB_T0) return;
  const bf3 = Math.floor(frame / 3);
  const storm = stormAmt(t);
  const beatPh = ((t - B0) / BEAT) % 1, pulse = Math.exp(-beatPh * 7) * (t > 7.4 ? 1 : 0);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  for (let i = 0; i < N_T; i++) {
    const st = textState(t, i);
    // landing: the gust blows each glyph onto the page, 6.5 ms apart (all down by 7.16 s)
    const ta = SUB_T0 + i * 0.0065;
    if (t < ta) continue;
    const la = inv(ta, ta + 0.036, t), lb = ease.outBack(inv(ta, ta + 0.32, t), 2.2);
    let x = st.x - (1 - lb) * 70, y = st.y + (1 - lb) * 10, s = st.s * lerp(0.55, 1, lb), rot = (1 - lb) * -0.35;
    // line boil on threes + the wind
    const amp = 1.1 + 4.2 * storm, ra = 0.012 + 0.035 * storm;
    x += sn2(i * 7.1, bf3 * 1.9) * amp; y += sn2(i * 3.7 + 20, bf3 * 1.9) * amp; rot += sn2(i * 5.3 + 40, bf3 * 1.9) * ra;
    const gust = 0.6 * gauss(t, 9.3, 0.25) + 0.4 * gauss(t, 19.68, 0.25);
    x += (storm * (6 + 10 * Math.sin(t * 7 + i * 0.6)) + gust * 18) * (st.em ? 1.4 : 0.7);
    let skew = -0.17 * storm - 0.12 * gust;
    if (i === 1) { const k = ease.outBack(inv(9.1, 9.5, t)) * (1 - ease.spring(inv(9.55, 10.6, t), 0.3, 12)); x += 120 * k; y -= 50 * k; rot += 0.5 * k; }
    if (st.em) s *= 1 + 0.028 * pulse;
    const col = st.col, hol = st.hollow || 0;
    g.save();
    g.translate(x, y); g.rotate(rot); g.transform(1, 0, skew, 1, 0, 0);
    g.font = `${s.toFixed(2)}px WK`;
    g.globalAlpha = la;
    g.strokeStyle = rgba(C.paper, 0.5 - 0.3 * storm); g.lineWidth = s * 0.07; g.strokeText(TEXT[i], 0, 0);
    if (hol < 1) { g.fillStyle = rgba(col, 1 - hol); g.fillText(TEXT[i], 0, 0); }
    if (hol > 0) { g.strokeStyle = rgba(C.red, hol); g.lineWidth = Math.max(2.5, s * 0.03); g.strokeText(TEXT[i], 0, 0); }
    g.restore();
  }
}
// the pencil gust that writes the subtitle onto the sky
function drawTextGust(g, t, bf) {
  if (t < 6.8 || t > 7.6) return;
  const lines = [[392, 0.0, 9], [560, 0.03, 4], [664, 0.06, 4], [470, 0.02, 3]];
  lines.forEach(([y, d, w], j) => {
    const pts = [];
    for (let i = 0; i <= 40; i++) { const q = i / 40; pts.push([-120 + q * 1340, y + Math.sin(q * 6 + j) * 22 - q * 30]); }
    const hd = ease.outExpo(inv(6.86 + d, 7.16 + d, t)), tl = ease.inCubic(inv(7.02 + d, 7.5 + d, t));
    drawLine(g, byLen(pts, 6), { head: hd, tail: tl, w, amp: 2, bf, seed: 300 + j * 9, color: j === 0 ? rgba(C.red, 0.55) : rgba(C.ink, 0.45), taper: 20 });
  });
}

// ------------------------------------------------------------------ extras
function drawGround(g, t, bf) {
  const hd = ease.pen(inv(B0, B0 + 0.92, t));
  pencil(g, GROUND, bf, 500, { head: hd, w: 3.0, taper: 30 });
  for (const gr of GRASS) {
    const e = ease.outBack(inv(gr.t0, gr.t0 + 0.25, t));
    if (e <= 0) continue;
    const wv = wind(t), bend = gr.lean + wv * 7 + Math.sin(t * 3 + gr.seed) * 3 * wv;
    const base = [gr.x, GROUND_Y + 2];
    const tip = [gr.x + bend, GROUND_Y - gr.h * e];
    pencil(g, byLen(catmull([base, [gr.x + bend * 0.3, GROUND_Y - gr.h * 0.5 * e], tip], 6), 3), bf, gr.seed, { w: 2.2, passes: 1, taper: 4 });
  }
}
function breezePath(b, cam0) {
  const pts = [], x0 = cam0.x - 620 / cam0.z;
  const n = 7;
  for (let k = 0; k <= n; k++) pts.push([x0 + (k / n) * b.len, b.y + Math.sin(k * 1.1 + b.seed) * b.amp - k * 6]);
  const end = pts[pts.length - 1];
  const sp = [];
  for (let i = 1; i <= 16; i++) { const q = i / 16, a = -Math.PI / 2 * b.dir + q * Math.PI * 1.7 * b.dir, r = 42 * (1 - q * 0.65); sp.push([end[0] + 30 + Math.cos(a) * r, end[1] + b.dir * 42 + Math.sin(a) * r]); }
  return byLen(catmull(pts.concat(sp), 8), 5);
}
const breezeCache = new Map();
function drawBreezes(g, t, bf) {
  BREEZES.forEach((b, i) => {
    if (t < b.t0 || t > b.t0 + 1.6) return;
    if (!breezeCache.has(i)) breezeCache.set(i, breezePath(b, camAt(b.t0)));
    const pts = breezeCache.get(i);
    const hd = ease.windPen(inv(b.t0, b.t0 + 0.75, t)), tl = ease.inOutCubic(inv(b.t0 + 0.35, b.t0 + 1.35, t));
    pencil(g, pts, bf, 600 + i * 13, { head: hd, tail: tl, w: b.t0 < 4 ? 3.2 : 2.6, passes: 1, color: rgba(C.ink, b.t0 < 4 ? 0.7 : 0.55), taper: 18 });
  });
}
function drawStreaks(g, t, bf) {
  for (let i = 0; i < STREAKS.length; i++) {
    const s = STREAKS[i];
    if (t < s.t0) continue;
    const life = (s.path + s.len) / s.spd;
    if (t > s.t0 + life) continue;
    if (!s.pts) {
      const cam0 = camAt(s.t0);
      const x0 = cam0.x + (-820 + s.u * 700) / cam0.z, y0 = cam0.y + (-900 + s.v * 1900) / cam0.z;
      const pts = [];
      for (let k = 0; k <= 24; k++) { const q = k / 24; pts.push([x0 + q * s.path, y0 + Math.sin(q * 4 + s.ph) * s.wav - q * s.path * 0.12]); }
      s.pts = byLen(pts, 6);
    }
    const hd = ((t - s.t0) * s.spd) / s.path, tl = ((t - s.t0) * s.spd - s.len) / s.path;
    const col = s.brush ? rgba(C.blue, 0.22) : s.blue ? rgba(C.blue, 0.75) : rgba(C.ink, 0.5);
    drawLine(g, s.pts, { head: clamp(hd), tail: clamp(tl), w: s.brush ? 16 : s.w, amp: 2.5, bf, seed: s.seed, color: col, taper: 14, press: 0.7 });
  }
}
function leafPos(l, t) {
  const dt = t - l.t0, wi = windInt(t) - windInt(l.t0);
  return [l.x0 + 520 * wi + 30 * Math.sin(2.1 * t + l.ph), l.y0 + 50 * Math.sin(1.3 * dt + l.ph) + 26 * dt - 60 * wi * 0.4];
}
function drawLeaf(g, l, t, bf) {
  const p = leafPos(l, t);
  const ang = l.ph + l.spin * (t - l.t0) + 0.5 * Math.sin(t * 2 + l.seed);
  const flip = Math.cos(l.ph + (t - l.t0) * l.spin * 0.7);
  const s = l.s;
  const pts = [];
  for (let i = 0; i <= 16; i++) { const q = i / 16, a = q * Math.PI * 2; pts.push([Math.cos(a) * s, Math.sin(a) * s * 0.42 * flip * (Math.cos(a) > 0 ? 1 : 0.8)]); }
  const tr = pts.map(([x, y]) => [p[0] + x * Math.cos(ang) - y * Math.sin(ang), p[1] + x * Math.sin(ang) + y * Math.cos(ang)]);
  g.beginPath(); tr.forEach(q => g.lineTo(q[0], q[1])); g.closePath();
  g.fillStyle = rgba(C.ochre, 0.75); g.fill();
  pencil(g, byLen(tr, 3), bf, l.seed, { w: 2.0, passes: 1, amp: 0.8, taper: 3 });
  const vein = [[-s * 1.25, 0], [s, 0]].map(([x, y]) => [p[0] + x * Math.cos(ang), p[1] + x * Math.sin(ang)]);
  pencil(g, byLen(vein, 3), bf, l.seed + 3, { w: 1.6, passes: 1, amp: 0.6, taper: 3 });
}
function drawContact(g, t, bf) {
  if (t < 12.66 || t > 13.5) return;
  const h = boyHand(t);
  for (let k = 0; k < 6; k++) {
    const a = -Math.PI / 2 + (k - 2.5) * 0.5;
    const r0 = 30, r1 = 30 + 34 * ease.outExpo(inv(12.72, 12.95, t));
    const pts = [[h[0] + 5 + Math.cos(a) * r0, h[1] + Math.sin(a) * r0], [h[0] + 5 + Math.cos(a) * r1, h[1] + Math.sin(a) * r1]];
    const tl = ease.inCubic(inv(13.0, 13.4, t));
    drawLine(g, byLen(pts, 3), { tail: tl, w: 3, amp: 0.8, bf, seed: 900 + k, color: k % 2 ? rgba(C.red, 0.9) : rgba(C.ink, 0.85), taper: 3 });
  }
}

// ------------------------------------------------------------------ frame
function drawScene(g, t, frame) {
  const cam = camAt(t), M = camMatrix(cam);
  const t2 = Math.floor(frame / 2) * 2 / FPS, bf = Math.floor(frame / 2);
  WSCALE = 1 / Math.pow(cam.z, 0.45);
  // paper
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  g.fillStyle = rgba(C.paper, 1); g.fillRect(0, 0, W, H);
  g.setTransform(...M); g.drawImage(paper, PX0, PY0);
  // watercolour (sky wash sits slightly behind: parallax)
  g.globalCompositeOperation = 'multiply';
  g.setTransform(...camMatrix(cam, 0.9));
  drawWashes(g, t, cam);
  g.globalCompositeOperation = 'source-over';
  // ink layer
  ictx.setTransform(1, 0, 0, 1, 0, 0); ictx.globalCompositeOperation = 'source-over'; ictx.globalAlpha = 1; ictx.clearRect(0, 0, W, H);
  ictx.setTransform(...M);
  drawGround(ictx, t, bf);
  drawBreezes(ictx, t, bf);
  // boy
  for (const s of boyStrokes(t, t2, bf)) {
    if (s.head != null && s.head <= 0) continue;
    if (s.dot) { if (s.head > 0.5) dot(ictx, s.dot[0], s.dot[1], s.r, rgba(C.ink, 0.95), bf, 3); continue; }
    if (s.kind === 'scarf') {
      drawLine(ictx, s.pts, { head: s.head, w: 20, amp: 2, bf, seed: s.seed, color: rgba(C.blue, 0.78), taper: 8, press: 0.5 });
      pencil(ictx, s.pts, bf, s.seed + 1, { head: s.head, w: 2.2, passes: 1 });
      continue;
    }
    pencil(ictx, s.pts, bf, s.seed, { head: s.head, w: (s.w || 3.2) * 1.25 });
  }
  // the red line: wind → her → string → sun
  const wh = wProg(t), wt = ease.inOutCubic(inv(4.35, 7.35, t));
  if (wt < 1) crayon(ictx, WPATH, bf, 1000, { head: wh, tail: wt, taper: 30 });
  if (t >= 3.95) {
    const G = girlLine(t, t2);
    const gh = t < 6.6 ? ease.pen(inv(3.95, 6.55, t)) : 1;
    crayon(ictx, G, bf, 2000, { head: gh < 1 ? gh : null, taper: t > 24 ? 40 : 10, w: 8.5 + 2.5 * smooth(inv(18.3, 20, t)) - 1.0 * smooth(inv(27, 29, t)) });
    // her eye
    const ep = ease.outBack(inv(6.35, 6.6, t), 3);
    if (ep > 0) {
      const fly = ease.inCubic(inv(19.2, 19.9, t2));
      const e0 = rotP([744, 1072], [770, GROUND_Y], 0);
      if (fly < 1) dot(ictx, e0[0] + fly * 520, e0[1] - fly * 160, 5.5 * ep * (1 - fly * 0.6), rgba(C.red, 0.95), bf, 9);
    }
  }
  drawContact(ictx, t, bf);
  drawStreaks(ictx, t, bf);
  for (const l of LEAVES) if (!l.fg && t > l.t0 && t < l.t0 + 6) drawLeaf(ictx, l, t, bf);
  // paper tooth bites the crayon and graphite
  ictx.setTransform(1, 0, 0, 1, 0, 0);
  toothPat.setTransform(new DOMMatrix(M));
  ictx.globalCompositeOperation = 'destination-out'; ictx.globalAlpha = 0.9;
  ictx.fillStyle = toothPat; ictx.fillRect(0, 0, W, H);
  ictx.globalCompositeOperation = 'source-over'; ictx.globalAlpha = 1;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'multiply'; g.drawImage(ink, 0, 0);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 0.35; g.drawImage(ink, 0, 0); g.globalAlpha = 1;
  // foreground leaves, out of focus, faster parallax
  const fgM = camMatrix(cam, 1.45);
  for (const l of LEAVES) if (l.fg && t > l.t0 && t < l.t0 + 3.5) {
    g.save(); g.setTransform(fgM[0] * 1.8, fgM[1] * 1.8, fgM[2] * 1.8, fgM[3] * 1.8, fgM[4] - 400, fgM[5] - 700);
    g.filter = 'blur(5px)'; g.globalAlpha = 0.85; drawLeaf(g, l, t, bf); g.restore();
  }
  // light: warm morning → grey → cold storm → gold
  g.setTransform(1, 0, 0, 1, 0, 0);
  const cool = 0.18 * smooth(inv(14.5, 17.6, t)) + 0.5 * stormAmt(t) - 0.15 * smooth(inv(25, 28, t));
  if (cool > 0.005) { g.globalCompositeOperation = 'multiply'; g.fillStyle = `rgba(184,202,220,${clamp(cool) * 0.36})`; g.fillRect(0, 0, W, H); }
  const warm = 0.12 * (1 - inv(5, 9, t)) + 0.32 * smooth(inv(28.6, 30.4, t));
  if (warm > 0.005) { g.globalCompositeOperation = 'soft-light'; g.fillStyle = `rgba(255,196,110,${warm})`; g.fillRect(0, 0, W, H); }
  g.globalCompositeOperation = 'multiply';
  const vg = g.createRadialGradient(W / 2, H * 0.48, H * 0.32, W / 2, H * 0.5, H * 0.78);
  const vd = 0.16 + 0.16 * stormAmt(t);
  vg.addColorStop(0, 'rgba(255,255,255,0)'); vg.addColorStop(1, `rgba(150,130,110,${vd})`);
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
}
function samplesAt(t) {
  if (t > 17.9 && t < 24.6) return 5;
  if ((t > 6.6 && t < 7.6) || (t > 14.45 && t < 15.6) || t < 1.2) return 3;
  return 2;
}
function render(frame) {
  const t = frame / FPS;
  const n = samplesAt(t);
  mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.globalCompositeOperation = 'source-over'; mctx.globalAlpha = 1;
  if (n === 1) drawScene(mctx, t, frame);
  else {
    for (let k = 0; k < n; k++) {
      const tk = t + ((k + 0.5) / n - 0.5) * (0.5 / FPS);   // 180° shutter
      drawScene(bctx, tk, frame);
      mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.globalCompositeOperation = 'source-over';
      mctx.globalAlpha = 1 / (k + 1); mctx.drawImage(buf, 0, 0);
    }
    mctx.globalAlpha = 1;
  }
  // text: drawn once per frame (no sub-frame ghosting), bitten by the same paper tooth
  {
    const M = camMatrix(camAt(t)), bf = Math.floor(frame / 2);
    tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, W, H);
    drawTextGust(tctx, t, bf);
    drawText(tctx, t, frame);
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    toothPat.setTransform(new DOMMatrix(M));
    tctx.globalCompositeOperation = 'destination-out'; tctx.globalAlpha = 0.35;
    tctx.fillStyle = toothPat; tctx.fillRect(0, 0, W, H);
    tctx.globalCompositeOperation = 'source-over'; tctx.globalAlpha = 1;
    mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.drawImage(txt, 0, 0);
  }
  // film grain, new every 2 frames
  const gi = Math.floor(frame / 2);
  const tile = grainTiles[gi % grainTiles.length];
  const ox = Math.floor(hash(gi) * 512), oy = Math.floor(hash(gi + 99) * 512);
  mctx.globalCompositeOperation = 'overlay'; mctx.globalAlpha = 0.13;
  const pat = mctx.createPattern(tile, 'repeat'); pat.setTransform(new DOMMatrix([1, 0, 0, 1, ox, oy]));
  mctx.fillStyle = pat; mctx.fillRect(0, 0, W, H);
  mctx.globalCompositeOperation = 'source-over'; mctx.globalAlpha = 1;
}

async function init() {
  main = document.getElementById('c'); mctx = main.getContext('2d');
  buf = mk(W, H); bctx = buf.getContext('2d');
  ink = mk(W, H); ictx = ink.getContext('2d');
  txt = mk(W, H); tctx = txt.getContext('2d');
  await document.fonts.load('100px WK', TEXT);
  makePaper(); makeTooth(); makeGrain(); buildWind(); buildStatic();
  toothPat = ictx.createPattern(toothCanvas, 'repeat');
  return { frames: NF, fps: FPS, ok: document.fonts.check('100px WK', TEXT) };
}
window.SCENE = { init, render, NF, FPS, DUR };
})();
