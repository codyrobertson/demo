// Drive the viewer in headless Chromium and screenshot it.
import { chromium } from 'playwright';
import path from 'path';
const dir = process.cwd();
const target = process.argv[2] || 'index.html';
const out = process.argv[3] || '/tmp/gk_viewer.png';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto('file://' + path.join(dir, target));
await page.waitForTimeout(1200);
// let the idle refine pass land
await page.waitForFunction(() => {
  const b = document.getElementById('badge');
  return b && /plate/.test(b.textContent);
}, { timeout: 25000 }).catch(() => errors.push('never reached full-quality render'));
await page.waitForTimeout(400);
const badge = await page.textContent('#badge').catch(() => '');
const readout = await page.textContent('#readout').catch(() => '');
await page.screenshot({ path: out, fullPage: false });
console.log('badge:', JSON.stringify(badge));
console.log('readout:\n' + readout);
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
