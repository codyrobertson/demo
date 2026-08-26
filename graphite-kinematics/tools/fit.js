// Fit thumb opposition poses by minimising fingertip separation.
global.window = {};
const path = require('path');
['00-math','10-anatomy','20-rig','30-pose'].forEach(f => require(path.join(__dirname,'..','src',f+'.js')));
const G = window.GK, M = G.math, DEG = M.DEG;
const A = G.anatomy.buildAnatomy(12345);

// target[i] = which digit the thumb should meet
const JOBS = [
  { key: 'pinch',  target: 1 },
  { key: 'ok',     target: 1 },
  { key: 'tripod', target: 2 },
  { key: 'grip',   target: 2 }
];

function cost(spec, target, base) {
  const p = G.pose.clampPose(A, G.pose.mk(A, spec));
  const rig = G.rig.solve(A, p);
  const t = rig.digits[0].tip, f = rig.digits[target].tip;
  const d = M.vdist(t, f);
  // the pads should meet, not the bones: aim for a pad-to-pad contact gap
  const gap = Math.abs(d - (A.bones[0].breadth + A.bones[target].breadth) * 0.86);
  // and they must meet PAD TO PAD: each pad normal pointing at the other tip
  const tSeg = rig.digits[0].segs[rig.digits[0].segs.length - 1];
  const fSeg = rig.digits[target].segs[rig.digits[target].segs.length - 1];
  const dir = M.vnorm(M.vsub(f, t));
  const faceT = M.vdot(tSeg.frame[2], dir);          // thumb pad faces the finger
  const faceF = M.vdot(fSeg.frame[2], M.vmul(dir, -1));
  // stay recognisably the gesture that was asked for
  let reg = 0;
  for (let i = 0; i < 5; i++) reg += Math.pow(spec.thumb[i] - base.thumb[i], 2);
  for (let i = 0; i < 4; i++) reg += Math.pow(spec.f[target-1][i] - base.f[target-1][i], 2) * 0.6;
  return gap * 1.0 + (1 - faceT) * 9 + (1 - faceF) * 5 + reg * 4.5;
}

for (const job of JOBS) {
  const base = JSON.parse(JSON.stringify(G.pose.PRESETS[job.key].spec));
  let best = JSON.parse(JSON.stringify(base)), bestC = cost(best, job.target, base);
  const rng = new M.Rng(99);
  let step = 0.30;
  for (let iter = 0; iter < 5000; iter++) {
    if (iter % 900 === 899) step *= 0.62;
    const cand = JSON.parse(JSON.stringify(best));
    // perturb the thumb chain, and lightly the target finger
    for (let i = 0; i < 5; i++) cand.thumb[i] = M.clamp(cand.thumb[i] + rng.sym(step), -1, 1);
    if (rng.chance(0.4)) {
      const f = cand.f[job.target - 1];
      for (let i = 0; i < 3; i++) f[i] = M.clamp(f[i] + rng.sym(step * 0.5), -1, 1);
    }
    const c = cost(cand, job.target, base);
    if (c < bestC) { bestC = c; best = cand; }
  }
  const fin = G.pose.clampPose(A, G.pose.mk(A, best));
  const rig = G.rig.solve(A, fin);
  const tS = rig.digits[0].segs[rig.digits[0].segs.length-1];
  const fS = rig.digits[job.target].segs[rig.digits[job.target].segs.length-1];
  const dir = M.vnorm(M.vsub(rig.digits[job.target].tip, rig.digits[0].tip));
  console.log('--- ' + job.key + '  cost ' + bestC.toFixed(2) + '  tipDist ' +
    M.vdist(rig.digits[0].tip, rig.digits[job.target].tip).toFixed(1) + 'mm  padFacing ' +
    M.vdot(tS.frame[2], dir).toFixed(2) + '/' + M.vdot(fS.frame[2], M.vmul(dir,-1)).toFixed(2));
  console.log('    thumb: [' + best.thumb.map(v => v.toFixed(2)).join(', ') + ']');
  console.log('    f' + job.target + ':    [' + best.f[job.target-1].map(v => v.toFixed(2)).join(', ') + ']');
}
