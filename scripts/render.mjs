// Frame-accurate renderer: serves the repo, drives local Chrome with puppeteer-core,
// seeks the scene frame by frame and streams PNGs into FFmpeg.
//
//   node scripts/render.mjs                      full film → op55-hd.mp4
//   node scripts/render.mjs --strip 18.0         10 frames (every 2nd) from 18.0 s → out/strips/
//   node scripts/render.mjs --overview           one frame every 0.5 s → out/strips/overview-*.png
//   node scripts/render.mjs --frames 0,210,540   single PNGs → out/frames/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };

const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(p => fs.existsSync(p));
if (!CHROME) throw new Error('Chrome not found; set CHROME_PATH');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf' };
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    }).listen(0, '127.0.0.1', () => res(srv));
  });
}

function run(cmd, a, stdinFeeder) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, a, { stdio: [stdinFeeder ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
    p.on('error', rej); p.on('close', c => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))));
    if (stdinFeeder) stdinFeeder(p.stdin);
  });
}

const srv = await serve();
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--force-device-scale-factor=1', '--hide-scrollbars', '--font-render-hinting=none', '--disable-lcd-text']
});
const page = await browser.newPage();
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => { console.error('[page error]', e); process.exitCode = 1; });
await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${srv.address().port}/src/index.html`, { waitUntil: 'load' });
const info = await page.evaluate(() => window.SCENE.init());
if (!info.ok) throw new Error('font failed to load');
const NF = info.frames;

async function grab(f) {
  const url = await page.evaluate(n => { window.SCENE.render(n); return document.getElementById('c').toDataURL('image/png'); }, f);
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}
async function writeFrames(list, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const [k, f] of list.entries()) {
    const file = path.join(dir, `f${String(k).padStart(4, '0')}.png`);
    fs.writeFileSync(file, await grab(f)); files.push(file);
  }
  return files;
}
async function tile(list, name, cols, w = 216) {
  const dir = path.join(OUT, 'tmp-' + name);
  fs.rmSync(dir, { recursive: true, force: true });
  await writeFrames(list, dir);
  const rows = Math.ceil(list.length / cols);
  fs.mkdirSync(path.join(OUT, 'strips'), { recursive: true });
  const dst = path.join(OUT, 'strips', name + '.png');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', path.join(dir, 'f%04d.png'),
    '-vf', `scale=${w}:-1,tile=${cols}x${rows}:padding=4:color=white`, '-frames:v', '1', dst]).catch(async () => {
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', path.join(dir, 'f%04d.png'), '-vf', `scale=${w}:-1,tile=${cols}x${rows}:padding=4:color=white`, '-frames:v', '1', dst]);
  });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('wrote', dst, list.map(f => (f / 30).toFixed(2)).join(' '));
}

try {
  if (opt('--strip')) {
    const ts = String(opt('--strip')).split(',').map(Number);
    const every = Number(opt('--every') || 2), count = Number(opt('--count') || 10);
    for (const t0 of ts) {
      const f0 = Math.round(t0 * 30), list = [];
      for (let k = 0; k < count; k++) list.push(Math.min(NF - 1, f0 + k * every));
      await tile(list, `strip-${t0.toFixed(2)}`, 5, 216);
    }
  } else if (opt('--overview')) {
    const list = []; for (let t = 0; t < NF / 30; t += 0.5) list.push(Math.round(t * 30)); list.push(NF - 1);
    for (let i = 0; i < list.length; i += 32) await tile(list.slice(i, i + 32), `overview-${i / 32}`, 8, 160);
  } else if (opt('--frames')) {
    const list = String(opt('--frames')).split(',').map(Number);
    const dir = path.join(OUT, 'frames');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of list) { fs.writeFileSync(path.join(dir, `frame-${String(f).padStart(4, '0')}.png`), await grab(f)); }
    console.log('wrote', list.length, 'frames to', dir);
  } else {
    const dst = path.join(ROOT, 'op55-hd.mp4');
    const t0 = Date.now();
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-',
      '-i', path.join(ROOT, 'original.mp3'), '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-r', '30', '-profile:v', 'high',
      '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', dst], async stdin => {
      for (let f = 0; f < NF; f++) {
        const png = await grab(f);
        if (!stdin.write(png)) await new Promise(r => stdin.once('drain', r));
        if (f % 30 === 0) process.stdout.write(`\rframe ${f}/${NF}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
      stdin.end();
    });
    console.log(`\ndone → ${dst} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
} finally {
  await browser.close();
  srv.close();
}
