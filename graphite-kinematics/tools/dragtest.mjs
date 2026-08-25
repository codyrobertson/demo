import { chromium } from 'playwright';
import path from 'path';
const dir = process.cwd();
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION|ERR_NAME|fonts/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto('file://' + path.join(dir, 'index.html'));
await page.waitForTimeout(1800);

await page.click('#preset-chips .chip:has-text("Flat")').catch(()=>{});
await page.waitForTimeout(900);
// turn on the drag mode
await page.click('label.check:has-text("Drag the fingertips") input');
await page.waitForTimeout(900);

const before = await page.evaluate(() => document.getElementById('readout').textContent);
const box = await page.locator('canvas').boundingBox();
const hs = await page.evaluate(() => window.GK.app.handles().map(h => ({ d: h.d, name: h.name, x: h.x, y: h.y })));
console.log('handles: ' + hs.map(h => h.name + '(' + h.x.toFixed(0) + ',' + h.y.toFixed(0) + ')').join(' '));
const scale = box.width / 1000;
for (const h0 of hs) {
  // re-read: the plate re-fits its framing after every change, so a position
  // measured before the previous drag is already wrong
  const h = (await page.evaluate((d) => {
    const g = window.GK.app.handles().find(x => x.d === d);
    return { d: g.d, name: g.name, x: g.x, y: g.y };
  }, h0.d));
  const sx = box.x + h.x * scale, sy = box.y + h.y * scale;
  const t0 = await page.evaluate(() => document.getElementById('readout').textContent);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(sx + i * 5, sy + i * 8); await page.waitForTimeout(55); }
  await page.mouse.up();
  await page.waitForTimeout(650);
  const t1 = await page.evaluate(() => document.getElementById('readout').textContent);
  console.log((t1 !== t0 ? 'moved  ' : 'NO-OP  ') + h.name);
}
const final = await page.evaluate(() => document.getElementById('readout').textContent);
console.log('--- before ---\n' + before + '\n--- after ---\n' + final);
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no errors');
await page.screenshot({ path: '/tmp/drag.png', clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
await browser.close();
