import { chromium } from 'playwright';
import path from 'path';
const dir = process.cwd();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/ERR_CONNECTION|ERR_NAME|fonts/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.goto('file://' + path.join(dir, 'index.html'));
await page.waitForTimeout(1800);
const before = await page.evaluate(() => document.getElementById('readout').textContent);
const set = async (labelText, value) => page.evaluate(([t, v]) => {
  const g = [...document.querySelectorAll('.control-group')]
    .find(e => e.querySelector('label') && e.querySelector('label').textContent.trim() === t);
  if (!g) throw new Error('no control called ' + t);
  const i = g.querySelector('input');
  i.value = v; i.dispatchEvent(new Event('input'));
}, [labelText, value]);
await set('Hold a ball (mm)', 26);
await page.waitForTimeout(2500);
const after = await page.evaluate(() => document.getElementById('readout').textContent);
console.log(after !== before ? 'ball: hand closed on it' : 'ball: NO CHANGE');
const box = await page.locator('canvas').boundingBox();
await page.screenshot({ path: '/tmp/vball.png', clip: box });
console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no errors');
await browser.close();
