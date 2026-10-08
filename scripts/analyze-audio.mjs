// Measures the beat grid and energy of original.mp3 (used to place every accent in src/scene.js).
// Requires ffmpeg on PATH.   node scripts/analyze-audio.mjs
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SR = 22050, HOP = 220, WIN = 1024;
const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(ROOT, 'original.mp3'), '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
const N = Math.floor((x.length - WIN) / HOP), fps = SR / HOP;

// onset strength = rise of broadband + high-passed energy
const E = [], Hf = [];
for (let i = 0; i < N; i++) {
  let s = 0, h = 0;
  for (let j = 0; j < WIN; j++) { const v = x[i * HOP + j], d = v - (j ? x[i * HOP + j - 1] : 0); s += v * v; h += d * d; }
  E.push(10 * Math.log10(s / WIN + 1e-9)); Hf.push(10 * Math.log10(h / WIN + 1e-9));
}
const O = E.map((_, i) => Math.max(0, Hf[i] - (Hf[i - 1] ?? Hf[0])) + 0.5 * Math.max(0, E[i] - (E[i - 1] ?? E[0])));

// beat period + phase that collect the most onset energy
let best = null;
for (let P = 0.6; P <= 1.2; P += 0.0005) for (let ph = 0; ph < P; ph += 0.005) {
  let s = 0; for (let t = ph; t < N / fps; t += P) { const i = Math.round(t * fps); s += (O[i - 1] || 0) + (O[i] || 0) + (O[i + 1] || 0); }
  if (!best || s > best.s) best = { P, ph, s };
}
console.log(`beat period ${best.P.toFixed(4)} s (${(60 / best.P).toFixed(1)} BPM), first beat ${best.ph.toFixed(2)} s`);
const bars = []; for (let t = best.ph; t < N / fps; t += best.P * 4) bars.push(t.toFixed(2));
console.log('bar lines:', bars.join(' '));

// strongest onsets
const peaks = [];
for (let i = 5; i < N - 5; i++) if (O[i] > 4.5 && O[i] === Math.max(...O.slice(i - 5, i + 6))) peaks.push(`${(i / fps).toFixed(2)}s(${O[i].toFixed(1)})`);
console.log('strong onsets:', peaks.join(' '));

// centre-vs-side energy (vocal presence proxy) per second
const st = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(ROOT, 'original.mp3'), '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
const y = new Float32Array(st.buffer, st.byteOffset, st.length / 4);
const line = [];
for (let s = 0; s < Math.floor(y.length / 2 / SR); s++) {
  let m = 0, d = 0;
  for (let k = s * SR; k < (s + 1) * SR; k++) { const l = y[2 * k], r = y[2 * k + 1]; m += ((l + r) / 2) ** 2; d += ((l - r) / 2) ** 2; }
  line.push(`${s}s:${(10 * Math.log10(m / d)).toFixed(0)}dB`);
}
console.log('mid/side ratio:', line.join(' '));
