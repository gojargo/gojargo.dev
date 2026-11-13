// Renders the social card (og:image) to public/og.png, 1200×630, with the same
// waves as the site. Run after changing the home page title or tagline:
//   node video/og.mjs
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const server = await createServer({ configFile: false, root: join(here, 'stage'), logLevel: 'warn', server: { port: 5198 } });
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(new URL('og.html', server.resolvedUrls.local[0]).href);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 });
  const out = resolve(here, '../public/og.png');
  await page.screenshot({ path: out, type: 'png' });
  console.log(`og: ${out}`);
} finally {
  await browser.close();
  await server.close();
}
