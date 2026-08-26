/* Two independent sources, asked the same questions.
   Usage: node tools/crosscheck.js

   The figure's proportions come from ANSUR II: 6,068 people, measured with a
   tape over the skin. The Rajagopal musculoskeletal model comes from one
   person, measured by imaging, and its joint centres are inside the body
   where no tape reaches. They share no data, no method and no subjects.

   So where they can be made to answer the same question, agreement is
   evidence and disagreement is a bug in one of them. Everything below is a
   RATIO, deliberately: Rajagopal's subject's stature is not in the file, and
   a comparison that needs it would be comparing my guess at their height as
   much as anything else.

   WHAT THIS CAN AND CANNOT SETTLE. Rajagopal is n=1. An individual's limb
   ratios sit several percent either side of a population mean as a matter of
   course, so a few percent of disagreement here is not evidence of anything.
   What it can settle is a large disagreement, and it can settle the numbers
   ANSUR cannot measure at all — joint centre spacings, which are inside the
   body. Where a 6,068-subject fit and one imaged subject disagree about
   something the survey CAN measure, the survey wins.

   The sharpest question is the one this project just answered from ANSUR
   alone. Surface landmarks overstate joint-centre distances, and the span
   regression put that at 0.9244 for the arm. Rajagopal's segment lengths ARE
   joint-centre distances. If the correction is right, the two should now
   agree on how an arm compares to a leg; if it is wrong, they will not. */
'use strict';
const fs = require('fs');
const path = require('path');
const HERE = path.join(__dirname, '..');

const R = require(path.join(HERE, 'data', 'rajagopal.json'));
const S = R.segmentLengthsMm;

// The constants come from the source, not from a copy of it. A cross-check
// that hardcodes the value it is checking cannot notice when that value
// changes — this file did exactly that for one revision and went on
// reporting a 19.6% disagreement that had already been fixed.
global.window = {};
require('/home/user/demo/graphite-kinematics/src/00-math.js');
require(path.join(HERE, 'src', '00-anthro.js'));
const A = window.GK.anthro;
const K = A.JOINT_CENTRE_K;
const GH_INBOARD = A.GH_INBOARD;
const HJC_FROM_BICRISTALE = A.HJC_FROM_BICRISTALE;

// ANSUR, read straight from the survey rather than through the fitted model,
// so this checks the measurements and not the PCA.
const DIR = process.argv[2] ||
  '/tmp/claude-0/-home-user-demo/eba2bb92-6c3b-58f7-9b91-b25e7808f1a6/scratchpad/ansur';
function read(f) {
  const lines = fs.readFileSync(f, 'latin1').split(/\r?\n/).filter(l => l.length);
  const head = lines[0].split(',').map(x => x.trim());
  const idx = {}; head.forEach((h, i) => { idx[h] = i; });
  return lines.slice(1).map(l => {
    const c = l.split(',');
    const get = (k) => parseFloat(c[idx[k]]);
    return {
      stature: get('stature'),
      femur: get('trochanterionheight') - get('lateralfemoralepicondyleheight'),
      tibia: get('lateralfemoralepicondyleheight') - get('lateralmalleolusheight'),
      humerusSurf: get('acromionradialelength'),
      forearmSurf: get('radialestylionlength'),
      biacromial: get('biacromialbreadth'),
      bicristal: get('bicristalbreadth'),
      hipbreadth: get('hipbreadth'),
    };
  });
}
let rows = [];
try {
  rows = read(path.join(DIR, 'male.csv')).concat(read(path.join(DIR, 'female.csv')));
} catch (e) {
  console.error('needs the ANSUR CSVs; see tools/fit-ansur.js for the URLs');
  process.exit(2);
}
const mean = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;

const row = (name, mine, theirs, note) => {
  const d = 100 * (mine - theirs) / theirs;
  console.log('  ' + name.padEnd(38) +
    mine.toFixed(4).padStart(9) + theirs.toFixed(4).padStart(10) +
    ((d >= 0 ? '+' : '') + d.toFixed(1) + '%').padStart(9) + (note ? '   ' + note : ''));
};

console.log('Rajagopal 2016 (one subject, imaged) vs ANSUR II (' + rows.length + ', taped)\n');
console.log('  ' + 'ratio'.padEnd(38) + 'ANSUR'.padStart(9) + 'Rajagopal'.padStart(10) + 'diff'.padStart(9));

// --- 1. the arm-to-leg question, which is what JOINT_CENTRE_K answers.
//     The leg needs no correction: trochanterion and the lateral epicondyle
//     and malleolus all sit within a few mm of their joint axes, which is why
//     checkfit.js reports the knee and ankle correct to 1.6mm. The arm does.
console.log('\n  arm against leg — uncorrected, then corrected');
row('humerus / femur   (surface)', mean(r => r.humerusSurf) / mean(r => r.femur),
  S.humerus / S.femur);
row('humerus / femur   (x K)', K * mean(r => r.humerusSurf) / mean(r => r.femur),
  S.humerus / S.femur, '<- the test');
row('forearm / tibia   (surface)', mean(r => r.forearmSurf) / mean(r => r.tibia),
  S.forearm / S.tibia);
row('forearm / tibia   (x K)', K * mean(r => r.forearmSurf) / mean(r => r.tibia),
  S.forearm / S.tibia, '<- the test');

// --- 2. joint-centre spacings, which ANSUR cannot measure at all and which
//     are currently the project's remaining regressions.
console.log('\n  joint centre spacings, against the leg they hang from');
const legLen = mean(r => r.femur) + mean(r => r.tibia);
const rLeg = S.femur + S.tibia;
row('hip centre spacing / leg length',
  2 * HJC_FROM_BICRISTALE * mean(r => r.bicristal) / legLen,
  S.pelvisWidth / rLeg, '<- calibrated here');

const armLen = K * (mean(r => r.humerusSurf) + mean(r => r.forearmSurf));
const rArm = S.humerus + S.forearm;
row('shoulder centre spacing / arm length',
  (1 - 2 * GH_INBOARD) * mean(r => r.biacromial) / armLen,
  S.shoulderWidth / rArm, '<- derived from ANSUR');

console.log('\n  Rajagopal segment lengths (mm): femur ' + S.femur.toFixed(1) +
  '  tibia ' + S.tibia.toFixed(1) + '  humerus ' + S.humerus.toFixed(1) +
  '  forearm ' + S.forearm.toFixed(1));
console.log('  implied stature, from hip-to-ankle over its ANSUR fraction: ' +
  (rLeg / (legLen / mean(r => r.stature))).toFixed(0) + 'mm');
