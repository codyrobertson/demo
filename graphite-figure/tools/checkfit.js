/* Does the solved skeleton agree with the body it was sampled from?
   Usage: node tools/checkfit.js [n]

   ANSUR measures more landmarks than the chain consumes, and the surplus is
   free ground truth. A femur is BUILT from trochanterion minus epicondyle, so
   checking knee height proves nothing — it is true by construction. But
   nothing in the chain ever reads wrist height, acromial height or span:
   those come out the far end of a chain of joint centres, bone lengths and
   rest orientations, and ANSUR measured them directly on the same person.
   Where they disagree, something between the two is wrong.

   This is the seed of the proportion critic. Right now it is a report rather
   than a filter — the residuals it finds are systematic, not per-sample, so
   rejecting samples would hide a modelling error instead of fixing it. */
'use strict';
const G = require('./load.js')();

const N = parseInt(process.argv[2] || '400');

// Each check: what the chain says, what the survey measured, and whether the
// chain ever read that measurement. A check whose measurement the chain
// consumes is marked so, and is a consistency check rather than a test.
const CHECKS = [
  {
    name: 'vertex height', indep: true,
    chain: (fig, rig) => fig.rootHeight + rig.bones.skull.B[0],
    meas: (fig) => fig.m.stature,
  },
  {
    name: 'wrist height', indep: true,
    chain: (fig, rig) => fig.rootHeight + rig.bones['forearm.L'].B[0],
    meas: (fig) => fig.m.wristheight,
  },
  {
    name: 'acromion height', indep: true,
    chain: (fig, rig) => fig.rootHeight + rig.bones['clavicle.L'].B[0],
    meas: (fig) => fig.m.acromialheight,
  },
  {
    // Span is measured with the arms out, so it has to be SOLVED with the
    // arms out. Measured at rest it compares a hanging arm's lateral reach
    // against a horizontal one's and reports a 930mm error that is entirely
    // the check's own fault — the first version of this file did exactly
    // that, and the number was so large it could only have been the test.
    name: 'span (arms abducted 90)', indep: true, tpose: true,
    chain: (fig, rig, tRig) => {
      const L = tRig.bones['forearm.L'].B, R = tRig.bones['forearm.R'].B;
      return Math.abs(L[1] - R[1]) + 2 * fig.m.handlength;
    },
    meas: (fig) => fig.m.span,
  },
  {
    name: 'knee height  [built from]', indep: false,
    chain: (fig, rig) => fig.rootHeight + rig.bones['femur.L'].B[0],
    meas: (fig) => fig.m.lateralfemoralepicondyleheight,
  },
  {
    name: 'ankle height [built from]', indep: false,
    chain: (fig, rig) => fig.rootHeight + rig.bones['tibia.L'].B[0],
    meas: (fig) => fig.m.lateralmalleolusheight,
  },
];

const res = CHECKS.map(() => []);
for (let i = 0; i < N; i++) {
  const fig = G.figure.buildFigure(1000 + i * 7919);
  const rig = G.skel.solve(fig, {});
  const tRig = G.skel.solve(fig, { ghAbd: Math.PI / 2 });
  CHECKS.forEach((c, k) => res[k].push(c.chain(fig, rig, tRig) - c.meas(fig)));
}

const stat = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  const mean = a.reduce((p, q) => p + q, 0) / a.length;
  const sd = Math.sqrt(a.reduce((p, q) => p + (q - mean) ** 2, 0) / (a.length - 1));
  return { mean, sd, p50: s[Math.floor(a.length * 0.5)], worst: Math.max(...a.map(Math.abs)) };
};

console.log(N + ' sampled bodies, solved at rest');
console.log('  chain minus survey, millimetres.  A bias is a modelling error;');
console.log('  a spread is the chain and the survey disagreeing per person.\n');
console.log('  ' + 'landmark'.padEnd(32) + 'bias'.padStart(9) + 'sd'.padStart(9) + 'worst'.padStart(9));
CHECKS.forEach((c, k) => {
  const s = stat(res[k]);
  console.log('  ' + c.name.padEnd(32) +
    (s.mean >= 0 ? '+' : '') + s.mean.toFixed(1).padStart(8) +
    s.sd.toFixed(1).padStart(9) + s.worst.toFixed(1).padStart(9) +
    (c.indep ? '' : '   (not independent)'));
});

const indep = CHECKS.map((c, k) => ({ c, s: stat(res[k]) })).filter(x => x.c.indep);
const worstBias = indep.reduce((a, b) => (Math.abs(b.s.mean) > Math.abs(a.s.mean) ? b : a));
console.log('\n  worst independent bias: ' + worstBias.c.name + '  ' +
  worstBias.s.mean.toFixed(1) + 'mm');
console.log(Math.abs(worstBias.s.mean) < 10 ? '\nok' : '\n  ^ a systematic offset this large is a modelling error, not noise.');
