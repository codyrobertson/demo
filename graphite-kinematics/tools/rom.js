/* The range-of-motion tour, frame by frame.
   Eighteen presets are eighteen points in a 25-dimensional space, and none of
   them sits at a joint limit. The tour does - it walks every degree of freedom
   out to both stops and back - so it is where the flesh model gets asked
   questions the presets never ask.
   Usage: node tools/rom.js [frames]                                        */
global.window = {};
const path = require('path');
['00-math','10-anatomy','20-rig','30-pose'].forEach(f => require(path.join(__dirname,'..','src',f+'.js')));
const G = window.GK, M = G.math, RG = G.rig, PO = G.pose, AN = G.anatomy;
const A = AN.buildAnatomy(parseInt(process.env.SEED || '12345'));
const N = parseInt(process.argv[2] || '240');

/** how far the thumb's metacarpal stands clear of the palm's own flesh */
function mc1Clear(rig) {
  const mc = rig.digits[0].segs[0];
  let worst = -1e9;
  for (const sv of [0.25, 0.5, 0.75]) {
    const P = M.vmad(mc.A, mc.t, mc.len * sv);
    const r = AN.segmentProfile(A, 0, 0, sv)[1];
    let best = 1e9;
    for (let iu = 0; iu <= 20; iu++) for (let iv = 0; iv <= 20; iv++) {
      const u = M.lerp(-0.1, 1.1, iu / 20);
      const v = M.lerp(rig.palm.vLo(u), rig.palm.vHi(u), iv / 20);
      const sp = RG.palmSpine(rig, u, v);
      const off = M.vdot(M.vsub(P, sp.P), sp.n);
      const lat = M.vlen(M.vsub(M.vsub(P, sp.P), M.vmul(sp.n, off)));
      if (lat > 16) continue;
      best = Math.min(best, off - RG.palmThickPalmar(A, u, v) - r);
    }
    worst = Math.max(worst, best === 1e9 ? 99 : best);
  }
  return worst;
}

/** the deepest two segments press into each other, as a fraction of their width */
function squash(rig) {
  const segs = [];
  for (let d = 0; d < 5; d++) for (const sg of rig.digits[d].segs) {
    if (!sg.rendered) continue;
    const r = (AN.segmentProfile(A, d, sg.seg, 0.15)[0] +
               AN.segmentProfile(A, d, sg.seg, 0.85)[0]) * 0.5;
    segs.push({ d, seg: sg.seg, A: sg.A, B: sg.B, r });
  }
  let worst = 0, name = '';
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const a = segs[i], b = segs[j];
    if (a.d === b.d && Math.abs(a.seg - b.seg) <= 1) continue;
    if (a.d === 0 && b.d === 0) continue;
    const s = 1 - M.closestSeg(a.A, a.B, b.A, b.B).d / (a.r + b.r);
    if (s > worst) { worst = s; name = AN.DIGIT_NAMES[a.d] + '/' + a.seg + ' x ' + AN.DIGIT_NAMES[b.d] + '/' + b.seg; }
  }
  return { worst, name };
}

const off = [], press = [];
for (let i = 0; i < N; i++) {
  const t = i / N;
  const pose = PO.romTour(A, t);
  const rig = RG.solve(A, PO.resolveContacts(A, pose));
  const where = 't=' + t.toFixed(3) + '  ' + (pose.active ? pose.active.path : '?');
  const c = mc1Clear(rig);
  if (c > 7) off.push('  ' + where.padEnd(34) + 'MC1 ' + (c > 90 ? 'clean off the hand' : c.toFixed(1) + 'mm clear'));
  const s = squash(rig);
  if (s.worst > 0.32) press.push('  ' + where.padEnd(34) + (s.worst * 100).toFixed(0) + '%  ' + s.name);
}
console.log('\n— the tour, ' + N + ' frames —');
console.log('thumb off the hand: ' + off.length);
off.forEach(l => console.log(l));
console.log('interpenetration:   ' + press.length);
press.forEach(l => console.log(l));
console.log('');
process.exit(off.length + press.length ? 1 : 0);
