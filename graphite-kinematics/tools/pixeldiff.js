/* Proves an optimisation pass did not change what gets drawn.
   Usage: node tools/pixeldiff.js <beforeSrcDir> <afterSrcDir>

   Renders a battery of poses, angles and sizes from BOTH source trees -
   spawning tools/rawdump.js as a fresh process each time, so neither render
   can accidentally share warm state with the other - and diffs the raw RGBA
   buffers byte for byte. There is no tolerance band hiding in here: every
   channel of every pixel is compared, and "0 pixels differ" is the only
   result that counts as proof. Anything else is reported as a fraction of
   pixels touched and the largest and mean channel delta among them, so a
   real difference cannot be waved off as noise, and a description of it goes
   in the writeup rather than in this tool's judgement of whether it's ok.  */
'use strict';
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

// No default for beforeDir: a stale guess that happens to resolve to some
// other src/ on disk is worse than refusing to run, since it would "prove"
// a change safe against the wrong original. afterDir defaults to the src/
// this tool ships beside, since that is unambiguous.
if (!process.argv[2]) {
  console.error('usage: node tools/pixeldiff.js <beforeSrcDir> [afterSrcDir]');
  console.error('  beforeSrcDir   a src/ checked out at the commit to compare against');
  console.error('  afterSrcDir    defaults to the src/ next to this tool');
  process.exit(2);
}
const beforeDir = path.resolve(process.argv[2]);
const afterDir = path.resolve(process.argv[3] || path.join(__dirname, '..', 'src'));
const rawdump = path.join(__dirname, 'rawdump.js');

// Every preset the pose module ships, not a hand-picked few: an optimisation
// that only breaks a pose nobody tested for is still a broken optimisation.
global.window = {};
['00-math', '10-anatomy', '20-rig', '30-pose'].forEach(f => require(path.join(afterDir, f + '.js')));
const PRESETS = Object.keys(window.GK.pose.PRESETS);

const SEEDS = [12345, 777];
const VIEWS = [[0, 0], [90, 0], [180, 20], [270, -15], [45, 35]];
const SIZES = [900, 300];

function render(srcDir, preset, seed, az, el, size, outPath) {
  execFileSync(process.execPath, [rawdump, srcDir, preset, String(seed), String(az), String(el), outPath, String(size)]);
  const buf = fs.readFileSync(outPath);
  const w = buf.readUInt32LE(0), h = buf.readUInt32LE(4);
  return { w, h, px: buf.subarray(8) };
}

const tmpA = '/tmp/gk-pixeldiff-a.bin', tmpB = '/tmp/gk-pixeldiff-b.bin';
let configs = 0, totalPixels = 0, totalDiffPixels = 0, worstMaxDelta = 0, worstConfig = null;
let anyMismatch = false;

console.log('pixeldiff: ' + beforeDir + '  vs  ' + afterDir);
console.log('');

// A representative slice, not the full cross-product of every preset x every
// seed x every view x every size - that is thousands of renders and this
// tool is meant to run in a few minutes, not overnight. Every preset is
// covered at least once; seeds, views and the small size fill in around them.
const jobs = [];
for (const preset of PRESETS) jobs.push({ preset, seed: SEEDS[0], view: VIEWS[0], size: 900 });
for (let i = 0; i < PRESETS.length; i++) {
  jobs.push({ preset: PRESETS[i], seed: SEEDS[1], view: VIEWS[(i + 1) % VIEWS.length], size: SIZES[i % SIZES.length] });
}

for (const job of jobs) {
  const { preset, seed, view, size } = job;
  const [az, el] = view;
  const a = render(beforeDir, preset, seed, az, el, size, tmpA);
  const b = render(afterDir, preset, seed, az, el, size, tmpB);
  configs++;
  if (a.w !== b.w || a.h !== b.h || a.px.length !== b.px.length) {
    anyMismatch = true;
    console.log('  SIZE MISMATCH ' + preset + ' seed ' + seed + ' az ' + az + ' el ' + el + ' ' + size + 'px');
    continue;
  }
  const n = a.px.length;
  totalPixels += n / 4;
  let diffPixels = 0, maxDelta = 0, sumDelta = 0, diffChannels = 0;
  for (let i = 0; i < n; i += 4) {
    let pixelDiffers = false;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a.px[i + c] - b.px[i + c]);
      if (d > 0) { pixelDiffers = true; diffChannels++; sumDelta += d; if (d > maxDelta) maxDelta = d; }
    }
    if (pixelDiffers) diffPixels++;
  }
  totalDiffPixels += diffPixels;
  if (maxDelta > worstMaxDelta) { worstMaxDelta = maxDelta; worstConfig = job; }
  const frac = diffPixels / (n / 4);
  const label = preset.padEnd(11) + 'seed ' + String(seed).padEnd(6) + 'az ' + String(az).padStart(4) +
    ' el ' + String(el).padStart(4) + '  ' + String(size).padStart(4) + 'px';
  if (diffPixels === 0) {
    console.log('  identical   ' + label);
  } else {
    anyMismatch = true;
    console.log('  DIFFERS     ' + label + '   ' + diffPixels + '/' + (n / 4) + ' px (' +
      (frac * 100).toFixed(4) + '%)   max channel delta ' + maxDelta +
      '   mean over differing channels ' + (sumDelta / Math.max(1, diffChannels)).toFixed(2));
  }
}

console.log('');
console.log(configs + ' configurations, ' + totalPixels + ' pixels total, ' + totalDiffPixels + ' pixels differed anywhere.');
if (!anyMismatch) {
  console.log('Every pixel of every configuration is byte-identical between the two trees.');
} else {
  console.log('Worst single-channel delta: ' + worstMaxDelta + ' (0-255 scale), in ' +
    (worstConfig ? worstConfig.preset + ' seed ' + worstConfig.seed : '?') + '.');
  console.log('This is NOT a pass - see the task rule that an optimisation must not change the drawing.');
}
process.exitCode = anyMismatch ? 1 : 0;
