import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
await page.goto('http://localhost:5330/?hold&seed=4&play=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true);
for (const [d, p] of [[34, 0.9], [60, 0.9], [78, 1.25], [78, 0.5]]) {
  const t = await page.evaluate(([d, p]) => { __cam(0, 0, d, 0.3, p); const t0 = performance.now(); __pump(3); const gl = __view.renderer.gl; gl.getContext().finish(); return performance.now() - t0; }, [d, p]);
  console.log('dist', d, 'pitch', p, 'ms for 3 frames', t.toFixed(0));
}
await browser.close();
