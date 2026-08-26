/* Do left and right still mirror once the contact solver has had the pose?
   Usage: node tools/gripmirror.js

   tools/mirror.js answers the same question about solve(), against a pose
   spec nothing has touched. This one answers it about the path that MUTATES
   the pose, and they are not the same question: the contact solver measures
   its correction in world space and writes it into a pose field, and three of
   those fields — cmcRad, cmcOpp, mcpAbd — are the ones solve() negates on a
   left hand. Write a world-space step straight in and it comes back out
   reversed, so the correction is applied opposite to the direction it was
   measured and the contact it was solving gets deeper.

   That is invisible to every other check here. thumb.js and validate.js only
   ever build right hands; mirror.js deliberately stops short of this path.
   Before the fix this reported 26 of 35 cases wrong and a worst deviation of
   39mm — a left clenchMax whose grip simply did not close. */
'use strict';
global.window = {};
const path = require('path');
['00-math', '10-anatomy', '20-rig', '30-pose']
  .forEach(f => require(path.join(__dirname, '..', 'src', f + '.js')));
const G = window.GK;

const SEEDS = [12345, 7, 2024, 99, 31415, 4407, 555];
// the contact-heavy presets, which is where a reversed correction shows:
// a light touch barely moves the pose and hides it
const PRESETS = ['fist', 'clenchMax', 'ok', 'pinch', 'grip', 'cup', 'tripod', 'hook'];
const TOL = 0.5;   // mm

const clone = (o) => JSON.parse(JSON.stringify(o));
let worst = 0, worstAt = '', n = 0, fail = 0;

for (const seed of SEEDS) {
  for (const preset of PRESETS) {
    const side = {};
    for (const ch of ['right', 'left']) {
      const A = G.anatomy.buildAnatomy(seed, { chirality: ch });
      const settled = G.pose.resolveContacts(A, clone(G.pose.preset(A, preset)), { iters: 60 });
      side[ch] = G.rig.solve(A, settled).digits.map(d => d.segs.map(s => s.B.slice()));
    }
    let d = 0, at = '';
    side.right.forEach((dg, i) => dg.forEach((B, j) => {
      const L = side.left[i][j];
      // the mirror is the ulnar component negated and nothing else
      const e = Math.max(Math.abs(B[0] - L[0]), Math.abs(B[1] + L[1]), Math.abs(B[2] - L[2]));
      if (e > d) { d = e; at = 'digit' + i + ' seg' + j; }
    }));
    n++;
    if (d > TOL) { fail++; console.log('  FAIL ' + seed + ' ' + preset + '  ' + d.toFixed(2) + 'mm  ' + at); }
    if (d > worst) { worst = d; worstAt = seed + ' ' + preset + ' ' + at; }
  }
}
console.log(n + ' contact-resolved cases, ' + (n - fail) + ' pass, ' + fail + ' fail  (tolerance ' + TOL + 'mm)');
console.log('worst deviation after contacts: ' + worst.toFixed(4) + 'mm' + (worstAt ? '  (' + worstAt + ')' : ''));
console.log(fail ? '\nFAILED' : '\nok');
process.exit(fail ? 1 : 0);
