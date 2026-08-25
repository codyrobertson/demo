/* Where the milliseconds in a draw actually go.
   Usage: node tools/profile.js [srcDir] [runs]

   srcDir defaults to the src/ next to this tool, so the common case is just
   `node tools/profile.js`. Pass a different srcDir (e.g. a sibling checkout
   at an earlier commit) to profile that tree instead - with the same tool,
   the same poses, the same instrumentation - which is what lets a before and
   an after sit in one table instead of two.

   This does not sprinkle timers through the renderer. Every stage it reports
   is a function or a method that the renderer already calls by going through
   an object it holds a reference to - Renderer.prototype.draw, GK.features.*,
   DepthField.prototype.hidden and so on - so wrapping that property from
   outside, after the modules have loaded, intercepts the *same* call the
   renderer makes internally, without changing one character of src/. A
   handful of the renderer's own internals are plain local functions instead
   (rasterise(), projectCurve(), the contour emitter) and there is no way to
   reach those from outside without editing the file that defines them, which
   is exactly what this tool must not do. Their cost is not invisible, only
   indirect: it falls out as the residual once every stage that CAN be timed
   directly is subtracted from the total that contains it. Each such line
   below says so.

   The one place this tool declines to wrap precisely is DepthField.hidden
   and the digit/palm surface samplers: they run tens to hundreds of
   thousands of times in a single plate, and a timing wrapper's own overhead
   (two clock reads and a closure call) would then outweigh what it is
   trying to measure and the number reported would be mostly the ruler, not
   the thing being measured. Those are counted instead - a call count costs
   one integer increment, not two clock reads - and their time is folded into
   the coarser stage that contains them, which is honestly labelled below as
   "incl. N df.hidden() taps" rather than pretended away.

   Noise: this container has been observed to vary a single render's time by
   up to 30% run to run, so a single number here would be a coin flip
   dressed up as a measurement. Every configuration below is run several
   times and reported as a distribution (min / median / p90), and the
   before/after comparison in the delivered writeup only trusts a change
   that moves the median by more than that spread.                          */
'use strict';
global.window = {};
const path = require('path');
const fs = require('fs');

const srcDir = process.argv[2] && !/^\d+$/.test(process.argv[2])
  ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'src');
const RUNS = parseInt(process.argv[3] || (/^\d+$/.test(process.argv[2] || '') ? process.argv[2] : '7'), 10);

['00-math', '10-anatomy', '20-rig', '30-pose', '40-pencil', '50-features', '55-dorsal', '60-render']
  .forEach(f => require(path.join(srcDir, f + '.js')));
const G = window.GK, M = G.math, AN = G.anatomy, RG = G.rig, PO = G.pose, DEG = M.DEG;

// ---------------------------------------------------------------- stopwatch
// Every bucket accumulates milliseconds and a call count, and is reset
// between configurations so one preset's report cannot bleed into the next.
const buckets = {};
function bucket(name) { return buckets[name] || (buckets[name] = { ms: 0, calls: 0 }); }
function resetBuckets() { for (const k in buckets) { buckets[k].ms = 0; buckets[k].calls = 0; } }

/** Wrap obj[name] to time it inclusively (its own work plus whatever it calls
    that this tool did NOT also wrap). Safe to use on anything called at most
    a few hundred times per plate - see the file header for why the very hot
    per-point calls are counted instead, below. */
function timeMethod(obj, name, label) {
  const orig = obj[name];
  const b = bucket(label);
  obj[name] = function (...args) {
    const t0 = process.hrtime.bigint();
    const r = orig.apply(this, args);
    b.ms += Number(process.hrtime.bigint() - t0) / 1e6;
    b.calls++;
    return r;
  };
  return orig;
}

/** Wrap obj[name] to just count calls - for the functions that run too often
    for a per-call clock read to stay honest. */
function countMethod(obj, name, label) {
  const orig = obj[name];
  const b = bucket(label);
  obj[name] = function (...args) {
    b.calls++;
    return orig.apply(this, args);
  };
  return orig;
}

// ---- Renderer stage boundaries. Each is invoked as this.foo(...) inside
// Renderer's own methods, so a prototype override is live for those calls
// too - it is not a re-implementation, it is the same call, timed.
const Renderer = G.render.Renderer;
timeMethod(Renderer.prototype, 'anatomyFor', 'anatomy');
timeMethod(Renderer.prototype, 'settle', 'contacts (resolveContacts)');
timeMethod(Renderer.prototype, 'build', 'build (rig solve + auto-frame + depth field + curve gen)');
timeMethod(Renderer.prototype, '_build2', 'build2 (depth field + curve gen only)');
timeMethod(Renderer.prototype, '_contours', 'contours (silhouette trace + emit + stroke)');
timeMethod(Renderer.prototype, 'draw', 'draw total');
timeMethod(Renderer.prototype, 'resolve', 'resolve (tone map)');

// ---- rig-level stages, called from 60-render.js through the RG reference
// it holds on GK.rig - again a live object, so this is the actual call.
timeMethod(RG, 'solve', 'rig.solve (forward kinematics)');
timeMethod(RG, 'digitSilhouette', 'digitSilhouette (traced border, per digit)');

// ---- feature-curve generators, each called once per build2 through the F
// and D references 60-render.js holds on GK.features / GK.dorsal.
const F = G.features, D = G.dorsal;
for (const name of ['digitFolds', 'webs', 'nails', 'digitShading', 'fingerprints',
  'palmCreases', 'palmRidges', 'heldBall']) {
  if (F[name]) timeMethod(F, name, 'curves: ' + name);
}
for (const name of ['tendons', 'veins', 'knuckleField', 'hair', 'skinLattice', 'skeleton']) {
  if (D[name]) timeMethod(D, name, 'curves: ' + name);
}

// ---- the mark itself: every Graphite.stroke() call, feature curve, ghost,
// search line and contour alike, wherever in draw() it is laid down.
const Graphite = G.pencil.Graphite;
timeMethod(Graphite.prototype, 'stroke', 'pencil: stroke() rasterisation');

// ---- the two functions the task names by name for the projection/occlusion
// pass. Neither is reachable from outside: projectCurve is a local function
// in 60-render.js, called directly by name from inside draw()'s curve loop,
// and DepthField.hidden is hot enough (tens of thousands of taps per plate)
// that timing each call would measure the wrapper more than the work. So
// hidden() is call-counted rather than timed, and projectCurve's own cost is
// reported as a residual: draw total, minus build (which is timed directly),
// minus contours (timed directly), minus every stroke() call (timed
// directly) that landed outside contours. What is left over is the feature
// curve loop's own work - projecting each curve's points into screen space,
// the horizon fade, and the occlusion taps - and nothing else runs there.
const DepthField = G.render.DepthField;
countMethod(DepthField.prototype, 'hidden', 'df.hidden() taps');

// =========================================================================
//  RUN CONFIGURATIONS
// =========================================================================
const SEED = 12345;
const A = AN.buildAnatomy(SEED);
const POSES = ['rest', 'fist', 'spread', 'grip', 'pinch'];
const SIZES = [900, 450];
const AZ = 20 * DEG, EL = 10 * DEG;

function renderOnce(presetKey, size) {
  const r = new G.render.Renderer(size, size);
  const pose = PO.preset(A, presetKey);
  resetBuckets();
  const t0 = process.hrtime.bigint();
  const built = r.draw({
    seed: SEED, pose,
    view: { az: AZ, el: EL, roll: 0, zoom: 1 },
    style: { grade: 3, tone: 1, wobble: 1, ghost: 0.20, search: 0.55 },
    detail: { print: 1, ridge: 0.5, lattice: 0.55, hair: 1, vein: 1 },
    quality: 1
  });
  r.resolve({ style: {} });
  const totalMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const snap = {};
  for (const k in buckets) snap[k] = { ms: buckets[k].ms, calls: buckets[k].calls };
  return { totalMs, drawMs: built.ms, curves: built.curves.length, buckets: snap };
}

function stats(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  return { min: s[0], median: at(0.5), p90: at(0.9), max: s[s.length - 1] };
}

function fmt(n) { return n.toFixed(1).padStart(7); }

console.log('graphite-kinematics :: draw-phase profile');
console.log('src: ' + srcDir);
console.log('runs per configuration: ' + RUNS + ' (reporting min / median / p90, not a single sample - see file header)');
console.log('');

const results = [];
for (const size of SIZES) {
  for (const preset of POSES) {
    const totals = [], drawTotals = [];
    let lastBuckets = null, curves = 0;
    for (let i = 0; i < RUNS; i++) {
      const r = renderOnce(preset, size);
      totals.push(r.totalMs); drawTotals.push(r.drawMs);
      lastBuckets = r.buckets; curves = r.curves;
    }
    const st = stats(drawTotals);
    console.log('== ' + preset.padEnd(10) + size + 'px  curves ' + String(curves).padStart(5) +
      '  draw ms  min ' + fmt(st.min) + '  median ' + fmt(st.median) + '  p90 ' + fmt(st.p90));
    results.push({ preset, size, curves, drawStats: st, buckets: lastBuckets });
  }
}

// ------------------------------------------------------------- last-run breakdown
console.log('\nStage breakdown for the LAST run of each configuration (ms, inclusive of');
console.log('whatever that stage calls that this tool did not separately wrap):\n');
for (const res of results) {
  console.log('-- ' + res.preset + ' @ ' + res.size + 'px --');
  const b = res.buckets;
  const get = (k) => (b[k] ? b[k].ms : 0);
  const drawTotal = get('draw total');
  const buildTotal = get('build (rig solve + auto-frame + depth field + curve gen)');
  const build2 = get('build2 (depth field + curve gen only)');
  const contours = get('contours (silhouette trace + emit + stroke)');
  const strokeAll = get('pencil: stroke() rasterisation');
  const rigSolve = get('rig.solve (forward kinematics)');
  const contacts = get('contacts (resolveContacts)');
  const silhouette = get('digitSilhouette (traced border, per digit)');
  const featureNames = Object.keys(b).filter(k => k.startsWith('curves: '));
  let featureSum = 0; for (const k of featureNames) featureSum += b[k].ms;
  const depthFieldResidual = Math.max(0, build2 - featureSum);
  const autoFrame = Math.max(0, buildTotal - rigSolve - build2);
  const curveLoopResidual = Math.max(0, drawTotal - buildTotal - contours);
  const hiddenTaps = b['df.hidden() taps'] ? b['df.hidden() taps'].calls : 0;

  const line = (label, ms, extra) => console.log('  ' + label.padEnd(46) + fmt(ms) + 'ms' + (extra ? '   ' + extra : ''));
  line('rig solve', rigSolve);
  line('contact settle (part of rig solve above)', contacts, '(' + b['contacts (resolveContacts)'].calls + ' call, memoised across the draft+plate pair)');
  line('auto-frame (residual: build - solve - build2)', autoFrame);
  line('depth field rasterise (residual: build2 - curves)', depthFieldResidual);
  line('  digitSilhouette (of the above, elsewhere)', silhouette, '(' + (b['digitSilhouette (traced border, per digit)'] ? b['digitSilhouette (traced border, per digit)'].calls : 0) + ' calls, run inside contours, not build2)');
  for (const k of featureNames) line('  ' + k.slice(8), b[k].ms, '(' + b[k].calls + ' call)');
  line('build2 total (depth field + all curve gen above)', build2);
  line('build total (solve + frame + build2)', buildTotal);
  line('feature-curve loop: project + occlude + stroke', curveLoopResidual,
    'incl. ' + hiddenTaps + ' df.hidden() taps total this run');
  line('contours: silhouette trace + occlude + stroke', contours,
    '(includes the digitSilhouette line above)');
  line('  of which: stroke() rasterisation, ALL layers', strokeAll,
    '(' + b['pencil: stroke() rasterisation'].calls + ' calls, spans both rows above)');
  line('DRAW TOTAL', drawTotal);
  console.log('');
}

console.log('Read this as a call tree, not a flat sum: "feature-curve loop" and');
console.log('"contours" both draw through stroke(), so the stroke() line is already');
console.log('counted once inside each of them - it is broken out again because the');
console.log('task asks for it by name, not because it is a third bucket to add in.');

// =========================================================================
//  COLD, ONE-SHOT NUMBERS - what a fresh `node tools/shot.js` actually reports
// =========================================================================
// Everything above runs many draws in one warm process, which is the right
// way to find out which stage costs what, but it is not the number the task
// opened with: "roughly 500-650ms" was read off single invocations of
// tools/shot.js, one process per plate, same as the viewer's first frame
// after a reload. V8 has not yet decided any of this is worth optimising on
// a first call, so a warm in-process median understates it. This section
// spawns the real entry point, once per sample, exactly as a user running it
// from a shell would, and reads back the "draw ...ms" it already prints -
// no separate stopwatch, so there is nothing here that could disagree with
// what the tool itself claims to have taken.
const { execFileSync } = require('child_process');
const root = path.dirname(srcDir);
const shotPath = path.join(root, 'tools', 'shot.js');
if (fs.existsSync(shotPath)) {
  console.log('Cold, one-shot numbers (fresh process per sample, via ' + path.relative(process.cwd(), shotPath) + '):\n');
  const COLD_RUNS = Math.max(3, Math.min(RUNS, 5));
  for (const preset of ['rest', 'fist']) {
    const ms = [];
    for (let i = 0; i < COLD_RUNS; i++) {
      const out = execFileSync(process.execPath, [shotPath, preset, String(SEED), '20', '10', '/tmp/gk-profile-cold.png', '900'],
        { encoding: 'utf8' });
      const m = /draw (\d+)ms/.exec(out);
      if (m) ms.push(parseInt(m[1], 10));
    }
    if (ms.length) {
      const st = stats(ms);
      console.log('  ' + preset.padEnd(10) + '900px  draw ms  min ' + fmt(st.min) +
        '  median ' + fmt(st.median) + '  p90 ' + fmt(st.p90) + '  (' + ms.length + ' fresh processes)');
    }
  }
} else {
  console.log('(no tools/shot.js next to ' + srcDir + ' - skipping the cold, one-shot section)');
}
