/* Does the surface actually come out the size the survey says?
   Usage: node tools/girthcheck.js [n] [seed0]

   Every circumference in the model is SOLVED against a measured one, so on
   any given figure they agree by construction and there is nothing to check.
   That is exactly why this exists: a solve that quietly fails to converge
   also produces a number, and the only way to notice is to run enough bodies
   that the failures show up as a rate.

   It found its first bug immediately. The trunk's soft-tissue profile is a
   table of anchors at measured landmark heights, written in the order those
   landmarks sit on a MEAN body. On an individual body the iliac crest and
   the omphalion can swap — they are two millimetres apart on average — and
   an unsorted table then walks straight past the waist anchor, so solving it
   does nothing and the bisection runs to its ceiling. Two seeds in four.

   The second thing it reports is not a failure but the point of the whole
   exercise: how THICK the soft layer had to be. Fat over a thigh is about
   ten millimetres on a lean adult. Everything far above that is the muscle
   the model does not have yet, stated in millimetres. */
'use strict';
const G = require('./load.js')();

const N = parseInt(process.argv[2] || '200');
const SEED0 = parseInt(process.argv[3] || '1');
const acc = {}, fails = [];
let bodies = 0;

for (let i = 0; i < N; i++) {
  const seed = SEED0 + i;
  const fig = G.figure.buildFigure(seed);
  const rig = G.skel.solve(fig, {});
  const fit = G.field.fitFat(rig);
  bodies++;
  for (const r of fit.report) {
    const key = r.region + ' @ ' + r.girth;
    const a = acc[key] || (acc[key] = { n: 0, t: 0, tmin: 1e9, tmax: -1e9, err: 0, worst: 0, bad: 0 });
    const e = (r.got - r.want) / r.want;
    a.n++; a.t += r.t; a.err += Math.abs(e);
    a.tmin = Math.min(a.tmin, r.t); a.tmax = Math.max(a.tmax, r.t);
    if (Math.abs(e) > Math.abs(a.worst)) a.worst = e;
    // 0.5% is far looser than a bisection that converged; anything outside
    // it did not converge, and is a bug rather than a tolerance
    if (Math.abs(e) > 0.005 || r.capped) { a.bad++; fails.push({ seed, key, e, t: r.t }); }
  }
}

console.log(bodies + ' sampled bodies, soft tissue solved against every measured girth');
console.log('  ' + (G.muscle ? 'muscle layer loaded' : 'MUSCLE LAYER ABSENT — the soft column is standing in for it') + '\n');
console.log('  site'.padEnd(26) + 'soft mm'.padStart(9) + 'min'.padStart(8) + 'max'.padStart(8) +
  'girth err'.padStart(11) + 'failed'.padStart(8));
const keys = Object.keys(acc).sort((a, b) => acc[b].t / acc[b].n - acc[a].t / acc[a].n);
for (const k of keys) {
  const a = acc[k];
  console.log('  ' + k.padEnd(24) + (a.t / a.n).toFixed(1).padStart(9) + a.tmin.toFixed(1).padStart(8) +
    a.tmax.toFixed(1).padStart(8) + (100 * a.err / a.n).toFixed(3).padStart(10) + '%' +
    (a.bad ? String(a.bad).padStart(8) : '       -'));
}
if (fails.length) {
  console.log('\n  ' + fails.length + ' failures. First few:');
  for (const f of fails.slice(0, 8)) {
    console.log('    seed ' + f.seed + '  ' + f.key + '  off by ' + (100 * f.e).toFixed(1) + '%  at ' + f.t.toFixed(1) + 'mm');
  }
  process.exit(1);
}
console.log('\nok');
