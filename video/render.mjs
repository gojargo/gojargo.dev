// Renders the demo video from video/out/{timeline.json,mix.wav} (made by
// synth.mjs): opens the stage in headless Chrome, seeks it frame by frame,
// and pipes the screenshots into ffmpeg with the soundtrack.
//
//   node video/render.mjs [--preview]   (--preview: 3 stills, no video)
//
// Output: public/demo/jargo-demo.mp4 and public/demo/poster.jpg.
// Needs ffmpeg (libx264) and Chrome ($CHROME, default /usr/bin/google-chrome).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const OUT = join(here, 'out');
const DEST = join(root, 'public/demo');
const preview = process.argv.includes('--preview');

if (!existsSync(join(OUT, 'timeline.json'))) {
  console.error('render: run `node video/synth.mjs` first');
  process.exit(1);
}
const { fps, duration } = JSON.parse(readFileSync(join(OUT, 'timeline.json'), 'utf8'));

const server = await createServer({
  configFile: false,
  root: join(here, 'stage'),
  publicDir: OUT,
  logLevel: 'warn',
  server: { port: 5199, strictPort: false },
});
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars'],
});

try {
  // 1280×720 CSS at 1.5× → 1920×1080.
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  page.on('pageerror', (e) => console.error('stage:', e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 });

  const shot = async (t, opts = {}) => {
    await page.evaluate((t) => window.__seek(t), t);
    return page.screenshot({ type: 'jpeg', quality: 92, ...opts });
  };

  mkdirSync(DEST, { recursive: true });
  if (preview) {
    for (const t of [duration * 0.2, duration * 0.5, duration - 0.5]) {
      const p = join(OUT, `preview-${t.toFixed(1)}.jpg`);
      writeFileSync(p, await shot(t));
      console.log(`render: ${p}`);
    }
  } else {
    // Poster: mid-conversation, after the interruption.
    writeFileSync(join(DEST, 'poster.jpg'), await shot(duration * 0.55, { quality: 85 }));

    const mp4 = join(DEST, 'jargo-demo.mp4');
    const ff = spawn('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-i', join(OUT, 'mix.wav'),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-tune', 'animation',
      '-c:a', 'aac', '-b:a', '128k',
      '-shortest', '-movflags', '+faststart',
      mp4,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((ok, fail) => ff.on('close', (c) => (c === 0 ? ok() : fail(new Error(`ffmpeg exited ${c}`)))));

    const frames = Math.ceil(duration * fps);
    const started = Date.now();
    for (let f = 0; f < frames; f++) {
      const jpg = await shot(f / fps);
      if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % fps === 0) process.stdout.write(`\rrender: ${f}/${frames} frames (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    }
    ff.stdin.end();
    await done;
    console.log(`\nrender: ${mp4}`);
  }
} finally {
  await browser.close();
  await server.close();
}
