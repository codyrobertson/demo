// Does the hand actually hold what it closes on — across the population?
//
// One seed is not evidence. This project has learned that twice now: the
// thumb's bands were set from a single hand and failed most of the rest, and
// a grasp fix validated on seed 12345 alone left the ring finger 27mm off a
// ball on seed 777. So this closes on three sizes from two starting poses
// over ten seeds and reports the distribution, not a number.
//
// Two things are measured per digit. The GAP is how far the pad's own surface
// is from the sphere — negative means pressed in, which is what holding
// something looks like; a large positive number is a finger waving beside a
// ball it is supposed to be gripping. The PENETRATION is how deep any part of
// the digit is inside the sphere, which is the price paid for closing the gap
// and has to be watched at the same time or one is just traded for the other.
//
// It also checks that `held[]` tells the truth. A solver that reports a digit
// as arrived while the digit is measurably elsewhere is worse than one that
// reports nothing, because everything downstream believes it.
global.window = {};
const path = require('path');
['00-math', '10-anatomy', '20-rig', '30-pose']
  .forEach(f => require(path.join(__dirname, '..', 'src', f + '.js')));
const G = window.GK, M = G.math, RG = G.rig, AN = G.anatomy, PO = G.pose;

const SEEDS = [12345, 777, 4242, 99, 1, 2023, 31337, 90210, 55, 7];
const RADII = [16, 26, 38];
const STARTS = ['flat', 'rest'];

const rows = [];
let lies = 0, trials = 0;
for (const seed of SEEDS) {
  const A = AN.buildAnatomy(seed);
  for (const start of STARTS) {
    for (const r of RADII) {
      const pose = PO.holdBall(A, PO.preset(A, start), r);
      const rig = RG.solve(A, pose);
      const b = pose.ball;
      for (let d = 0; d < 5; d++) {
        const dg = rig.digits[d];
        const pad = AN.segmentProfile(A, d, dg.segs.length - 1, 0.9)[1];
        const gap = M.vdist(dg.tip, b.C) - b.r - pad;
        trials++;
        if (pose.held[d] && gap > 2.0) lies++;
        let pen = 0;
        for (const sg of dg.segs) {
          if (!sg.rendered) continue;
          for (let i = 0; i <= 6; i++) {
            const sv = M.lerp(sg.sMin, sg.sMax, i / 6);
            for (let k = 0; k < 12; k++) {
              const P = RG.digitSurface(rig, d, sg.seg, sv, (k / 12) * Math.PI * 2).P;
              pen = Math.max(pen, b.r - M.vdist(P, b.C));
            }
          }
        }
        rows.push({ seed, start, r, name: dg.name, gap, pen });
      }
    }
  }
}

const q = (v, f) => v[Math.min(v.length - 1, Math.floor(v.length * f))];
console.log(`${SEEDS.length} seeds x ${STARTS.length} starting poses x ${RADII.length} radii = ${trials / 5} grips\n`);
console.log('pad-to-ball gap, mm (negative = pressed into the surface)');
console.log('digit     median      p90      max    over 5mm');
for (const n of ['thumb', 'index', 'middle', 'ring', 'little']) {
  const v = rows.filter(x => x.name === n).map(x => x.gap).sort((a, b) => a - b);
  console.log(n.padEnd(9), q(v, 0.5).toFixed(1).padStart(6), q(v, 0.9).toFixed(1).padStart(8),
    v[v.length - 1].toFixed(1).padStart(8), (String(v.filter(x => x > 5).length) + '/' + v.length).padStart(11));
}
const pens = rows.map(x => x.pen).sort((a, b) => a - b);
console.log(`\npenetration into the ball, mm:  median ${q(pens, 0.5).toFixed(1)}  p90 ${q(pens, 0.9).toFixed(1)}  max ${pens[pens.length - 1].toFixed(1)}`);
rows.sort((a, b) => b.gap - a.gap);
console.log('\nworst 8 gaps:');
for (const x of rows.slice(0, 8)) {
  console.log(`  ${x.gap.toFixed(1).padStart(5)}mm  seed ${String(x.seed).padEnd(6)} ${x.start.padEnd(5)} r=${x.r}  ${x.name}`);
}
console.log(`\nheld[] claimed a digit had arrived while its pad was over 2mm away: ${lies} of ${trials}`);
// A gap over 20mm is a digit that is not holding the ball at all; held[]
// lying at all is a correctness failure rather than a quality one.
const worst = rows[0].gap;
const bad = lies > 0 || worst > 20;
console.log(bad ? 'FAIL' : 'ok');
process.exit(bad ? 1 : 0);
