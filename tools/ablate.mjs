import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(300000);
await page.goto(`http://localhost:5330/?demo=12&play=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
const measure = async (label, setup) => {
  const r = await page.evaluate(async ([setup]) => {
    const V = window.__view, R = V.renderer;
    R.adaptive = false; R.setQuality('medium');
    window.__cam(0, 0, 34, 0.7, 0.9);
    eval(setup);
    await new Promise((res) => setTimeout(res, 600));
    // cpu timing of one app frame
    let n = 0; const t0 = performance.now(); const dts = []; let last = t0;
    await new Promise((res) => { const f = (t) => { n++; dts.push(t - last); last = t; if (t - t0 < 3000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    dts.sort((a, b) => a - b);
    return +(n / 3).toFixed(1) + ' fps p50 ' + dts[Math.floor(dts.length / 2)].toFixed(1);
  }, [setup]);
  console.log(label.padEnd(28), r);
};
await measure('baseline medium', '');
await measure('no AO', 'R.ao.enabled=false');
await measure('no AO, no tilt', 'R.ao.enabled=false; R.composer.passes.forEach(p=>{if(p.constructor.name==="EffectPass" && p.effects && p.effects.some(e=>e.name==="TiltShiftEffect")) p.enabled=false;})');
await measure('no shadows', 'V.tod.sun.castShadow=false');
await measure('shadow 2048', 'V.tod.sun.shadow.mapSize.set(2048,2048); V.tod.sun.shadow.map?.dispose(); V.tod.sun.shadow.map=null');
await measure('no AO no shadows', 'R.ao.enabled=false; V.tod.sun.castShadow=false');
await measure('pixel ratio 1', 'R.gl.setPixelRatio(1)');
await measure('hide buildings', 'V.buildings.group.visible=false');
await measure('hide fleet+props', 'V.fleet.group.visible=false; V.props.group.visible=false');
await measure('hide everything but land', 'V.buildings.group.visible=false; V.fleet.group.visible=false; V.props.group.visible=false; V.roads.mesh.visible=false; V.tgfx.group.visible=false');
await browser.close();
