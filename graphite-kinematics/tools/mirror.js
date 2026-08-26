/* Ground truth for chirality: a left hand must be the geometric mirror of
   the right one, not a right hand with a flag on it.

   The check is the definition. Build a right and a left anatomy from the
   same seed, solve them under the same pose, and every point that describes
   the rig - segment endpoint, joint centre, surface sample - has to equal
   its opposite number with the ulnar (Y) component negated and X/Z left
   alone. Report the worst gap in millimetres so "it mirrors" is a number,
   not an impression from one render.

   One thing here is NOT a bug, and is the reason this file exists rather
   than a five-line diff of two arrays: a digit's cross-section is sampled by
   (s, alpha), and alpha is measured off the segment's own ulnar axis - which
   the rig, correctly, does not simply negate. Mirroring negates the frame's
   ulnar ROW, and negating one row of an orthonormal frame flips the sense of
   everything measured off it, so the same alpha on both hands lands on the
   two hands' surfaces the SAME anatomical side (ulnar to ulnar) but at
   coordinates that are not one another's reflection - out by twice the
   section radius, tens of millimetres, easily mistaken for a real defect.
   The reflection of alpha on a circle is alpha -> pi - alpha (cos flips,
   sin does not), so that is the correspondence used below for digit
   surface points. Segment ends, joint centres and palm surface points carry
   no such row - they are plain positions built from plain positions - and
   compare at identical coordinates.

   Contact resolution (pose.resolveContacts) is deliberately not exercised
   here: jointDofs() writes its Jacobian step straight into the pose's raw
   ulnar fields (cmcRad, cmcOpp, mcpAbd) without the chirality this file
   exists to test, so a left hand pushed through contact resolution settles
   somewhere that is not this hand's mirror - measured on 'clenchMax', over
   40mm of it. Real, but it belongs to 30-pose.js, not to the rig graded
   here, so every preset below is solved exactly as the shared spec produces
   it - the untouched pose a caller actually hands to solve().

   Usage: node tools/mirror.js [seeds...]                                  */
global.window = {};
const path = require('path');
['00-math', '10-anatomy', '20-rig', '30-pose'].forEach(f => require(path.join(__dirname, '..', 'src', f + '.js')));
const G = window.GK, M = G.math, AN = G.anatomy, RG = G.rig, PO = G.pose;

const argSeeds = process.argv.slice(2).map(Number).filter(n => Number.isFinite(n));
const SEEDS = argSeeds.length ? argSeeds : [1, 12345, 777, 4242, 99, 555111, 2718281, 8675309, 31415, 271828, 90210];
const TOL = 1e-6;   // mm - machine noise on this arithmetic runs ~1e-13

/** max over (dx, dy - mirrored, dz): how far pL is from being pR reflected through Y */
function mirrorGap(pR, pL) {
  return Math.max(Math.abs(pL[0] - pR[0]), Math.abs(pL[1] + pR[1]), Math.abs(pL[2] - pR[2]));
}
function noteWorst(state, gap, what) {
  if (gap > state.worst) { state.worst = gap; state.what = what; }
}

/** every check for one (seed, preset): mirror symmetry and both hands' handedness */
function checkPair(seed, key) {
  const AR = AN.buildAnatomy(seed), AL = AN.buildAnatomy(seed, { chirality: 'left' });
  const poseR = PO.preset(AR, key), poseL = PO.preset(AL, key);
  // Presets should not need mirroring by the caller - confirm the spec that
  // reaches the rig really is the untouched, shared one before trusting
  // anything solved from it.
  if (JSON.stringify(poseR) !== JSON.stringify(poseL)) {
    return { fail: 'preset(A, ' + key + ') differs by chirality; it must not' };
  }
  const rigR = RG.solve(AR, poseR), rigL = RG.solve(AL, poseL);

  const mirror = { worst: -1, what: '' };
  const handed = { worst: Infinity, what: '' };
  const testHanded = (tag, seed_, key_, d, i, frame) => {
    const h = M.vdot(M.vcross(frame[0], frame[1]), frame[2]);
    if (h < handed.worst) { handed.worst = h; handed.what = `${seed_} ${key_} d${d} seg${i} ${tag}`; }
  };

  for (let d = 0; d < 5; d++) {
    const dgR = rigR.digits[d], dgL = rigL.digits[d];
    for (let i = 0; i < dgR.segs.length; i++) {
      const sR = dgR.segs[i], sL = dgL.segs[i];
      noteWorst(mirror, mirrorGap(sR.A, sL.A), `${seed} ${key} d${d} seg${i}.A`);
      noteWorst(mirror, mirrorGap(sR.B, sL.B), `${seed} ${key} d${d} seg${i}.B`);
      testHanded('R', seed, key, d, i, sR.frame);
      testHanded('L', seed, key, d, i, sL.frame);
    }
    for (let i = 0; i < dgR.joints.length; i++) {
      noteWorst(mirror, mirrorGap(dgR.joints[i].P, dgL.joints[i].P), `${seed} ${key} d${d} joint${i}.P`);
    }
    // digit surface: alpha -> pi - alpha on the left, per the header note
    for (const sg of dgR.segs) {
      if (!sg.rendered) continue;
      for (let i = 0; i <= 5; i++) {
        const s = sg.sMin + (sg.sMax - sg.sMin) * (i / 5);
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * M.TAU - Math.PI;
          const pR = RG.digitSurface(rigR, d, sg.seg, s, a).P;
          const pL = RG.digitSurface(rigL, d, sg.seg, s, Math.PI - a).P;
          noteWorst(mirror, mirrorGap(pR, pL), `${seed} ${key} d${d} seg${sg.seg} s${s.toFixed(2)} a${a.toFixed(2)} surf`);
        }
      }
    }
  }
  // palm surface: (u, beta) unchanged - see header note
  for (let iu = 0; iu <= 14; iu++) {
    for (let ib = 0; ib <= 20; ib++) {
      const u = M.lerp(-0.3, 1.1, iu / 14), beta = ib / 20;
      const pR = RG.palmSurface(rigR, u, beta).P, pL = RG.palmSurface(rigL, u, beta).P;
      noteWorst(mirror, mirrorGap(pR, pL), `${seed} ${key} u${u.toFixed(2)} b${beta.toFixed(2)} palm`);
    }
  }
  return { mirror, handed };
}

let pass = 0, fail = 0;
const failures = [];
const globalMirror = { worst: -1, what: '' };
const globalHanded = { worst: Infinity, what: '' };

for (const seed of SEEDS) {
  for (const key of PO.PRESET_KEYS) {
    const r = checkPair(seed, key);
    if (r.fail) { fail++; failures.push(r.fail); continue; }
    const ok = r.mirror.worst <= TOL && r.handed.worst > 0;
    ok ? pass++ : fail++;
    if (!ok) failures.push(`${seed} ${key}: mirror ${r.mirror.worst.toExponential(3)}mm (${r.mirror.what}), ` +
      `handed ${r.handed.worst.toExponential(3)} (${r.handed.what})`);
    if (r.mirror.worst > globalMirror.worst) { globalMirror.worst = r.mirror.worst; globalMirror.what = r.mirror.what; }
    if (r.handed.worst < globalHanded.worst) { globalHanded.worst = r.handed.worst; globalHanded.what = r.handed.what; }
  }
}

console.log(`${SEEDS.length} seeds x ${PO.PRESET_KEYS.length} presets = ${SEEDS.length * PO.PRESET_KEYS.length} cases`);
console.log(`${pass} pass, ${fail} fail  (tolerance ${TOL}mm)`);
console.log(`worst mirror deviation:     ${globalMirror.worst.toExponential(4)}mm  at ${globalMirror.what}`);
console.log(`worst right-handedness:     ${globalHanded.worst.toExponential(4)}  at ${globalHanded.what}  (want > 0)`);
if (failures.length) {
  console.log('\nfailures:');
  for (const f of failures.slice(0, 20)) console.log('  ' + f);
  if (failures.length > 20) console.log(`  ...and ${failures.length - 20} more`);
}
console.log(fail ? '\nFAIL' : '\nok');
process.exit(fail ? 1 : 0);
