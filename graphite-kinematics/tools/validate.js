/* Anatomical plausibility checks. Measures what a hand cannot do, so the
   failures stop being a matter of opinion.
   Usage: node tools/validate.js [seed]                                     */
global.window = {};
const path = require('path');
['00-math','10-anatomy','20-rig','30-pose'].forEach(f => require(path.join(__dirname,'..','src',f+'.js')));
const G = window.GK, M = G.math, AN = G.anatomy, RG = G.rig, PO = G.pose;
const seed = parseInt(process.argv[2] || '12345');
const A = AN.buildAnatomy(seed);
const RESOLVE = process.env.RAW !== '1';

/** closest approach between two 3-D segments */
function segSeg(p1, q1, p2, q2) {
  const d1 = M.vsub(q1, p1), d2 = M.vsub(q2, p2), r = M.vsub(p1, p2);
  const a = M.vdot(d1, d1), e = M.vdot(d2, d2), f = M.vdot(d2, r);
  let s, t;
  const c = M.vdot(d1, r), b = M.vdot(d1, d2);
  const den = a * e - b * b;
  if (den > 1e-9) s = M.clamp((b * f - c * e) / den, 0, 1); else s = 0;
  t = (b * s + f) / (e || 1);
  if (t < 0) { t = 0; s = M.clamp(-c / (a || 1), 0, 1); }
  else if (t > 1) { t = 1; s = M.clamp((b - c) / (a || 1), 0, 1); }
  return { s, t, d: M.vdist(M.vadd(p1, M.vmul(d1, s)), M.vadd(p2, M.vmul(d2, t))) };
}

/** how far inside the palm's palmar surface a point sits (mm; 0 = outside) */
function intoPalm(rig, P) {
  let best = 0;
  for (let iu = 0; iu <= 24; iu++) {
    const u = M.lerp(-0.05, 1.02, iu / 24);
    for (let iv = 0; iv <= 24; iv++) {
      const v = M.lerp(rig.palm.vLo(u) + 0.03, rig.palm.vHi(u) - 0.03, iv / 24);
      const sp = RG.palmSpine(rig, u, v);
      const off = M.vdot(M.vsub(P, sp.P), sp.n);          // +ve = palmar side
      const lat = M.vlen(M.vsub(M.vsub(P, sp.P), M.vmul(sp.n, off)));
      if (lat > 7) continue;                               // not over this patch
      const th = RG.palmThickPalmar(A, u, v);
      if (off > 0 && off < th) best = Math.max(best, th - off);
    }
  }
  return best;
}

function check(key, pose0) {
  const pose = RESOLVE ? PO.resolveContacts(A, pose0) : pose0;
  const rig = RG.solve(A, pose);
  const segs = [];
  for (let d = 0; d < 5; d++) {
    for (const sg of rig.digits[d].segs) {
      if (!sg.rendered) continue;
      const r0 = AN.segmentProfile(A, d, sg.seg, 0.15)[0];
      const r1 = AN.segmentProfile(A, d, sg.seg, 0.85)[0];
      segs.push({ d, seg: sg.seg, A: sg.A, B: sg.B, r: (r0 + r1) * 0.5 });
    }
  }
  const issues = [];
  // 1. bone-on-bone interpenetration
  let worst = 0, worstName = '';
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      if (a.d === b.d && Math.abs(a.seg - b.seg) <= 1) continue;   // chained
      if (a.d === 0 && b.d === 0) continue;
      const cc = segSeg(a.A, a.B, b.A, b.B);
      // Report as soft-tissue compression: two digits pressed together really
      // do flatten, but past about a third of their combined width the bones
      // themselves would have to pass through each other.
      const squash = 1 - cc.d / (a.r + b.r);
      if (squash > worst) {
        worst = squash;
        worstName = AN.DIGIT_NAMES[a.d] + '/' + a.seg + ' × ' + AN.DIGIT_NAMES[b.d] + '/' + b.seg;
      }
    }
  }
  if (worst > 0.32) issues.push('digits compressed ' + (worst * 100).toFixed(0) + '%  (' + worstName + ')');

  // 2. fingertips driven through the palm
  let deep = 0, deepName = '';
  for (let d = 0; d < 5; d++) {
    const dg = rig.digits[d];
    const last = dg.segs[dg.segs.length - 1];
    for (const s of [0.5, 1.0, last.sMax * 0.98]) {
      const P = M.vmad(last.A, last.t, last.len * s);
      const into = intoPalm(rig, P);
      if (into > deep) { deep = into; deepName = dg.name; }
    }
  }
  if (deep > 0.34) issues.push('palm pad compressed ' + (deep * 100).toFixed(0) + '%  (' + deepName + ')');

  // 3. adjacent knuckle spread beyond what the web allows
  for (let d = 1; d < 4; d++) {
    const a = pose.digits[d], b = pose.digits[d + 1];
    const splay = Math.abs(a.mcpAbd - b.mcpAbd) / M.DEG;
    if (splay > 36) issues.push(rig.digits[d].name + '/' + rig.digits[d + 1].name +
      ' abduct ' + splay.toFixed(0) + '° apart (the web allows ~34)');
  }

  // 4. is a knuckle swallowed by the palm's own solid?
  for (let d = 1; d < 5; d++) {
    const pp = rig.digits[d].segs[1];
    const P = M.vmad(pp.A, pp.t, pp.len * 0.055);
    const dorsal = M.vmad(P, pp.dor, AN.segmentProfile(A, d, 1, 0.055)[1]);
    // nearest palm dorsal surface
    let cover = 0;
    for (let iu = 0; iu <= 18; iu++) {
      const u = M.lerp(0.80, 1.02, iu / 18);
      for (let iv = 0; iv <= 14; iv++) {
        const v = M.lerp(-0.2, 1.2, iv / 14);
        // the palm's solid stops where uDistal says it does
        if (u > rig.palm.uDistal(v, false)) continue;
        const sp = RG.palmSpine(rig, u, v);
        const off = M.vdot(M.vsub(dorsal, sp.P), sp.n);
        const lat = M.vlen(M.vsub(M.vsub(dorsal, sp.P), M.vmul(sp.n, off)));
        if (lat > 6) continue;
        const th = RG.palmThickDorsal(A, u, v);
        if (off < 0 && -off < th) cover = Math.max(cover, th + off);
      }
    }
    if (cover > 0.5) issues.push(rig.digits[d].name + ' knuckle buried ' + cover.toFixed(1) + 'mm inside the palm solid');
  }
  return issues;
}

let total = 0;
for (const key of PO.PRESET_KEYS) {
  const issues = check(key, PO.preset(A, key));
  total += issues.length;
  console.log((issues.length ? 'FAIL ' : 'ok   ') + key.padEnd(12) + (issues.length ? issues[0] : ''));
  for (let i = 1; i < issues.length; i++) console.log('              ' + issues[i]);
}
console.log('\n' + total + ' issues across ' + PO.PRESET_KEYS.length + ' presets');
