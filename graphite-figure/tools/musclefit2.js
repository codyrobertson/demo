/* Do the three new groups (adductors, brachialis, tibialisAnterior) actually
   close the gaps tools/musclefit.js named? Companion to that file, not a
   replacement for it — this one only adds the new groups to its existing
   sites and re-runs the same DIRECT check (see musclefit.js's own header for
   why the direct check and the fitFat() integration check answer different
   questions; tools/girthcheck.js is where the integration check runs at
   scale). Usage: node tools/musclefit2.js [n] [seed0]

   WHY A SEPARATE FILE RATHER THAN EDITING musclefit.js: ownership. This
   task owns src/45-muscle.js only; musclefit.js is a pre-existing tool this
   task did not write and should not rewrite meanings out from under. Same
   SITES shape, same ALLOWANCE_MM, same circFromArea() — the only change is
   which groups each site sums.

   WHAT TO EXPECT, AND WHY IT DOES NOT MATCH tools/girthcheck.js's OWN
   thigh/biceps/calf numbers. This is the DIRECT check: sum each group's own
   PEAK area regardless of WHERE along the bone that peak sits, turn the
   total into an equivalent-circle circumference, compare to the ANSUR
   girth. tools/girthcheck.js instead measures a ring at the one specific
   HEIGHT ANSUR's own protocol used (src/50-field.js's SITES: thigh at 10%
   down the femur, biceps at 45% down the humerus, calf at 25% down the
   tibia). adductors' own peak sits close to that 10% thigh mark (pelvis-
   anchored, closer to the groin than the knee), so it moves BOTH numbers.
   brachialis' own peak sits at ~55-60% down the humerus and tibialisAnterior's
   at ~70-80% down the tibia — well past their sites' own ANSUR height — so
   they move THIS file's position-agnostic sum but leave
   tools/girthcheck.js's own single-height reading exactly unchanged (checked
   directly: 27.2683mm and 17.4256mm biceps/calf soft-tissue, to four decimal
   places, with or without them). Neither number is wrong; they are
   answering "how much of this limb's real cross-section is now accounted
   for" versus "does the tape-measure height specifically move" — a group
   can visibly fill the limb without ever being the biggest thing at the one
   height a 1980s survey happened to wrap a tape around. */
'use strict';
const G = require('./load.js')();

const N = parseInt(process.argv[2] || '260');
const SEED0 = parseInt(process.argv[3] || '20001'); // matches musclefit.js's own default range

const SITES = [
  { name: 'mid-biceps', groups: ['bicepsBrachii', 'tricepsBrachii', 'brachialis'], girth: 'biceps', pose: { elbow: Math.PI / 2 } },
  { name: 'mid-thigh', groups: ['quadriceps', 'hamstrings', 'adductors'], girth: 'thigh', pose: {} },
  { name: 'max-calf', groups: ['tricepsSurae', 'tibialisAnterior'], girth: 'calf', pose: {} },
];
const BEFORE = { 'mid-biceps': ['bicepsBrachii', 'tricepsBrachii'], 'mid-thigh': ['quadriceps', 'hamstrings'], 'max-calf': ['tricepsSurae'] };

function siteArea(rig, groupNames) {
  let area = 0;
  for (const name of groupNames) {
    const g = G.muscle.availableGroups()[name];
    if (!g) continue; // tolerate a group this file names that a given checkout does not have (e.g. peroneals, reverted — see src/45-muscle.js's own comment)
    for (const side of ['L', 'R']) {
      const st = G.muscle._internal.stationsFor(rig, side, g);
      if (!st) continue;
      area += 0.5 * Math.max(...st.stations.map((s) => s.a * s.b * Math.PI));
    }
  }
  return area;
}
function circFromArea(areaMm2, allowanceMm) { return 2 * Math.PI * (Math.sqrt(areaMm2 / Math.PI) + allowanceMm); }
function stat(vals) {
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { mean, worst: Math.max(...vals.map(Math.abs)) };
}
const ALLOWANCE_MM = 12; // same fixed, not-fit constant musclefit.js uses — see that file's own header for why

const seeds = Array.from({ length: N }, (_, i) => SEED0 + i * 7);
console.log(N + ' sampled bodies (seeds ' + seeds[0] + '..' + seeds[seeds.length - 1] + '), direct area check, before/after the three new groups\n');
console.log('  ' + 'site'.padEnd(12) + 'before bias'.padStart(13) + 'after bias'.padStart(12) + '  narrowed by');
for (const s of SITES) {
  const before = [], after = [];
  for (const seed of seeds) {
    const fig = G.figure.buildFigure(seed);
    const rig = G.skel.solve(fig, s.pose);
    before.push(circFromArea(siteArea(rig, BEFORE[s.name]), ALLOWANCE_MM) - fig.girth[s.girth]);
    after.push(circFromArea(siteArea(rig, s.groups), ALLOWANCE_MM) - fig.girth[s.girth]);
  }
  const b = stat(before), a = stat(after);
  const pct = 100 * (1 - Math.abs(a.mean) / Math.abs(b.mean));
  console.log('  ' + s.name.padEnd(12) + (b.mean >= 0 ? '+' : '') + b.mean.toFixed(0).padStart(9) + 'mm' +
    (a.mean >= 0 ? '+' : '') + a.mean.toFixed(0).padStart(8) + 'mm' + (pct.toFixed(0) + '%').padStart(11));
}

// ---------------------------------------------------------------------------
//  SYMMETRY — the file's own history checks this numerically, not by eye:
//  station centre y (world LEFT, +X superior/+Y left/+Z anterior) must be
//  all >=0 for the .L side and all <=0 for .R, at the pose a render actually
//  uses. See src/45-muscle.js's own SIDE MIRRORING section for the bug this
//  catches (gluteal.L doubly-mirrored back onto the right side of the body).
// ---------------------------------------------------------------------------
console.log('\nper-side symmetry (station centre y, render stance, ' + Math.min(N, 30) + ' bodies):');
const RENDER_STANCE = { hipAbd: 0.05, ghAbd: 0.09, elbow: 0.22 };
const NEW_GROUPS = ['adductors', 'brachialis', 'tibialisAnterior'];
let crossings = 0, checked = 0;
for (let i = 0; i < Math.min(N, 30); i++) {
  const fig = G.figure.buildFigure(seeds[i]);
  const rig = G.skel.solve(fig, RENDER_STANCE);
  for (const name of NEW_GROUPS) {
    const g = G.muscle.availableGroups()[name];
    for (const side of ['L', 'R']) {
      const st = G.muscle._internal.stationsFor(rig, side, g);
      if (!st) continue;
      checked++;
      const ys = st.stations.map((s2) => s2.center[1]);
      const bad = side === 'L' ? Math.min(...ys) < -0.01 : Math.max(...ys) > 0.01;
      if (bad) { crossings++; console.log('  seed ' + seeds[i] + ' ' + name + ' ' + side + ' crosses the midline'); }
    }
  }
}
console.log('  ' + checked + ' (group x side x body) checks, ' + crossings + ' crossed the midline at the render stance.');
console.log(crossings ? '  FAIL' : '  ok — every new group stays on its own side, mirrored correctly, at the pose a render uses.');

console.log('\nperoneals: attempted, reverted. Its own anchors and volume were clean (see the commented-out\n' +
  'table entry in src/45-muscle.js, right after tibialisAnterior); rendering it alongside tibialisAnterior\n' +
  'turned the shin\'s front contour into a multi-step staircase (src/50-field.js\'s radiusAlong() finding a\n' +
  'non-monotone ray between two comparably-sized, closely-spaced limb bellies — that file\'s own header\n' +
  'documents the same failure mode for a detached shoulder belly). Not testable here for that reason: this\n' +
  'file checks AREA, which stayed sane for peroneals right up until the render did not.');
