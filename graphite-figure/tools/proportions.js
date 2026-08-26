/* Does the DRAWN figure keep human proportions?
   Usage: node tools/proportions.js [n] [seed0]

   girthcheck.js proves the circumferences and checkfit.js proves the
   skeleton — and a figure can pass both while drawing a head 17% wider
   than its own measured breadth, because what reaches the page is the
   MEASURED CORE plus everything layered on it: solved soft tissue, feature
   forms, ears. Nothing was auditing that sum. This does: it measures the
   drawn surface exactly as the renderer samples it — the same rings — and
   holds it against the body's own ANSUR numbers and against the classical
   canon bands every figure-drawing course teaches.

   The bands are RANGES, deliberately: real people sit inside them, not on
   one value, and the sampled bodies must too. A check against a single
   ratio would fail half of humanity. Sources for the canon bands are the
   standard figure-drawing ones (7-8 heads to a standing figure, head
   height-to-width about 1.3-1.45, shoulders 2.3-3.0 head-widths); they are
   conventions rather than measurements and are marked EST. The ANSUR-ratio
   checks are not conventions — a drawn head more than a few percent outside
   its own measured envelope is a modelling error, full stop. */
'use strict';
const G = require('./load.js')();
const M = G.math;

const N = parseInt(process.argv[2] || '12');
const SEED0 = parseInt(process.argv[3] || '1');

// [name, lo, hi, source]
const CHECKS = [
  ['head drawn H / measured H', 0.97, 1.06, 'ANSUR: tragion-to-vertex + menton-to-sellion'],
  ['head drawn W / measured W', 1.00, 1.20, 'ANSUR headbreadth; drawn includes ears + scalp'],
  ['head crown W / measured W', 0.98, 1.10, 'ANSUR headbreadth; crown band, no ears'],
  ['head drawn H/W', 1.22, 1.50, 'EST canon'],
  /* agg: judged on the population MEAN, not per body. The planar-head
     rebuild proved why with one seed: that body's own MEASURED ratio is
     6.16 heads — a genuinely large-headed person — so demanding 6.9 of the
     drawing while also demanding it match its own measurements is a
     contradiction. Per-body correctness is the drawn-vs-measured row; the
     canon is a fact about populations, so it gets the mean. */
  ['stature / drawn head H', 6.9, 8.2, 'EST canon, 7-8 heads', 'agg'],
  ['chin-to-notch mm', 48, 115, 'drawn chin vs measured suprasternale'],
  ['shoulders / bideltoid', 0.96, 1.12, 'ANSUR bideltoidbreadth'],
  ['shoulders / drawn head W', 2.20, 3.10, 'EST canon'],
  ['vertex overshoot mm', -14, 14, 'drawn crown vs measured stature'],
];

function bbox(p) {
  let x0 = 1e9, x1 = -1e9, y1 = 0;
  const rows = [];
  for (let i = 0; i <= p.ns; i++) {
    const row = p.ring(p.s0 + (p.s1 - p.s0) * (i / p.ns), p.na);
    rows.push(row);
    if (!row) continue;
    for (const q of row) {
      if (q[0] < x0) x0 = q[0];
      if (q[0] > x1) x1 = q[0];
      const ay = Math.abs(q[1]);
      if (ay > y1) y1 = ay;
    }
  }
  return { x0, x1, y1, rows };
}

const acc = CHECKS.map(() => ({ lo: 1e9, hi: -1e9, sum: 0, bad: 0 }));
const fails = [];
for (let i = 0; i < N; i++) {
  const seed = SEED0 + i;
  const fig = G.figure.buildFigure(seed);
  const rig = G.skel.solve(fig, { hipAbd: 0.05, ghAbd: 0.09, elbow: 0.22 });
  G.field.fitFat(rig);
  const P = {};
  for (const p of G.field.parts(rig)) P[p.name] = p;
  const m = fig.m, R = fig.rootHeight;

  const H = bbox(P.head), T = bbox(P.trunk);
  const headH = H.x1 - H.x0, headW = H.y1 * 2;
  // the crown band sits above the ears, so its width is the skull's own
  const measH = m.tragiontopofhead + m.mentonsellionlength;
  const browX = H.x1 - 0.42 * headH;
  let crownW = 0;
  for (const row of H.rows) {
    if (!row) continue;
    for (const q of row) if (q[0] > browX && Math.abs(q[1]) > crownW) crownW = Math.abs(q[1]);
  }
  crownW *= 2;

  const vals = [
    headH / measH,
    headW / m.headbreadth,
    crownW / m.headbreadth,
    headH / headW,
    fig.stature / headH,
    (H.x0 + R) - m.suprasternaleheight,
    T.y1 / (m.bideltoidbreadth / 2),
    T.y1 * 2 / headW,
    (H.x1 + R) - fig.stature,
  ];
  vals.forEach((v, k) => {
    const a = acc[k];
    a.sum += v; a.lo = Math.min(a.lo, v); a.hi = Math.max(a.hi, v);
    if (CHECKS[k][4] === 'agg') return;   // judged on the mean, below
    if (v < CHECKS[k][1] || v > CHECKS[k][2]) { a.bad++; fails.push({ seed, k, v }); }
  });
}

console.log(N + ' sampled bodies, the DRAWN surface against its own measurements and the canon\n');
console.log('  check'.padEnd(30) + 'mean'.padStart(8) + 'min'.padStart(8) + 'max'.padStart(8) +
  '  band'.padEnd(16) + 'failed');
CHECKS.forEach((c, k) => {
  const a = acc[k];
  if (c[4] === 'agg') {
    const mean = a.sum / N;
    if (mean < c[1] || mean > c[2]) { a.bad = 'MEAN'; fails.push({ seed: 'mean', k, v: mean }); }
  }
  console.log('  ' + c[0].padEnd(28) + (a.sum / N).toFixed(2).padStart(8) +
    a.lo.toFixed(2).padStart(8) + a.hi.toFixed(2).padStart(8) +
    ('  [' + c[1] + ', ' + c[2] + ']').padEnd(16) + (a.bad ? String(a.bad).padStart(4) : '   -') + (c[4] === 'agg' ? '  (mean)' : ''));
});
if (fails.length) {
  console.log('\n  ' + fails.length + ' failures. First few:');
  for (const f of fails.slice(0, 8)) {
    console.log('    seed ' + f.seed + '  ' + CHECKS[f.k][0] + ' = ' + f.v.toFixed(3));
  }
  process.exit(1);
}
console.log('\nok');
