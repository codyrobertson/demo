// Exercise the viewer's controls and catch runtime errors.
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
await page.waitForTimeout(1500);

const step = async (label, fn, settle = 900) => {
  const before = errors.length;
  await fn();
  await page.waitForTimeout(settle);
  console.log((errors.length > before ? 'FAIL ' : 'ok   ') + label);
};

await step('preset: Fist', () => page.click('#preset-chips .chip:has-text("Fist")'));
await step('preset: Writing grip', () => page.click('#preset-chips .chip:has-text("Writing grip")'));
await step('sample the manifold', () => page.click('button:has-text("Sample the manifold")'));
await step('next seed', () => page.click('button:has-text("Next →")'));
await step('random hand', () => page.click('button:has-text("Random hand")'));
await step('orbit by drag', async () => {
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();
});
await step('wheel zoom', async () => {
  const box = await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.wheel(0, -300);
});
await step('open DOF panel + move a joint', async () => {
  await page.click('#dof-details summary');
  const s = page.locator('#dof-sliders input[type=range]').nth(9);
  await s.evaluate(el => { el.value = '0.8'; el.dispatchEvent(new Event('input', { bubbles: true })); });
});
await step('articulation: curl', () => page.locator('#artic-sliders input[type=range]').first()
  .evaluate(el => { el.value = '0.6'; el.dispatchEvent(new Event('input', { bubbles: true })); }));
await step('toggle bones layer', () => page.click('#layer-checks label:has-text("Bones") input'));
await step('toggle joint labels', () => page.click('#layer-checks label:has-text("Joint labels") input'));
await step('motion: range-of-motion tour', async () => {
  await page.selectOption('#motion', 'rom');
}, 2200);
await step('motion: cycle', async () => { await page.selectOption('#motion', 'cycle'); }, 2200);
await step('motion: still', async () => { await page.selectOption('#motion', 'still'); }, 1400);
await step('pencil grade to 6B', () => page.locator('#pencil-sliders input[type=range]').first()
  .evaluate(el => { el.value = '6'; el.dispatchEvent(new Event('input', { bubbles: true })); }));
await step('paper colour', () => page.locator('#paper')
  .evaluate(el => { el.value = '#efe7d6'; el.dispatchEvent(new Event('change', { bubbles: true })); }));
await step('reset', () => page.click('button:has-text("Reset")'), 1600);

await page.waitForFunction(() => /plate/.test(document.getElementById('badge').textContent), { timeout: 20000 })
  .catch(() => errors.push('did not settle to full quality'));
await page.screenshot({ path: '/tmp/gk_viewer_driven.png' });
console.log('\nbadge:', JSON.stringify(await page.textContent('#badge')));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
