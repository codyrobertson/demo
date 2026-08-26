/* Where the shoulder joint centre is, and how much shorter a bone is than the
   landmarks used to measure it — both derived from ANSUR II rather than from
   a regression written for a different landmark set.
   Usage: node tools/fit-arm.js <dir with male.csv and female.csv>

   THE PROBLEM. ANSUR measures acromion-to-radiale and radiale-to-stylion.
   Those are distances between BONY LANDMARKS on the surface, and a chain of
   joint centres is shorter: the acromion sits above and lateral to the
   glenohumeral centre, the radiale is the radial head rather than the elbow
   axis, the stylion is the styloid rather than the wrist axis. Chain the
   measured lengths and the arm comes out long — measured on the figure
   project, 25mm at the wrist and 269mm across the span.

   The usual answer is a published regression. But the survey already contains
   the answer, twice over, in measurements it took independently of the ones
   the chain consumes:

     SPAN pins the horizontal composition. Regress span on biacromial breadth
     and the arm segments across all 6,068 subjects and the coefficients say
     directly how much of each the span actually credits.

     WRIST HEIGHT pins the vertical one. The survey is measured in a defined
     standing posture, so at rest the chain must reproduce it: acromial height
     minus wrist height minus the arm is the drop from the acromion to the
     joint the arm swings from.

   Neither number is anyone's estimate. They are what 6,068 people measure. */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] ||
  '/tmp/claude-0/-home-user-demo/eba2bb92-6c3b-58f7-9b91-b25e7808f1a6/scratchpad/ansur';

function read(file) {
  const lines = fs.readFileSync(file, 'latin1').split(/\r?\n/).filter(l => l.length);
  const head = lines[0].split(',').map(s => s.trim());
  const idx = {}; head.forEach((h, i) => { idx[h] = i; });
  return lines.slice(1).map(l => {
    const f = l.split(',');
    const r = {};
    for (const k of ['span', 'biacromialbreadth', 'acromionradialelength',
      'radialestylionlength', 'handlength', 'acromialheight', 'wristheight']) r[k] = parseFloat(f[idx[k]]);
    return r;
  });
}
const rows = read(path.join(dir, 'male.csv')).concat(read(path.join(dir, 'female.csv')));
const n = rows.length;
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };

/** ordinary least squares by normal equations; p is five, so this is fine */
function ols(X, y) {
  const p = X[0].length;
  const M = [];
  for (let a = 0; a < p; a++) {
    const row = [];
    for (let b = 0; b < p; b++) {
      let s = 0; for (let i = 0; i < X.length; i++) s += X[i][a] * X[i][b];
      row.push(s);
    }
    let s = 0; for (let i = 0; i < X.length; i++) s += X[i][a] * y[i];
    row.push(s);
    M.push(row);
  }
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    const t = M[c]; M[c] = M[piv]; M[piv] = t;
    const d = M[c][c];
    for (let j = c; j <= p; j++) M[c][j] /= d;
    for (let r = 0; r < p; r++) {
      if (r === c || !M[r][c]) continue;
      const f = M[r][c];
      for (let j = c; j <= p; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map(r => r[p]);
}

const X = rows.map(r => [r.biacromialbreadth, r.acromionradialelength,
  r.radialestylionlength, r.handlength, 1]);
const y = rows.map(r => r.span);
const co = ols(X, y);
const pred = X.map(x => x.reduce((s, v, k) => s + v * co[k], 0));
const res = y.map((v, i) => v - pred[i]);

console.log('ANSUR II, n=' + n);
console.log('\nspan regressed on its parts:');
['biacromial', 'acromion->radiale', 'radiale->stylion', 'hand', 'const']
  .forEach((nm, k) => console.log('   ' + (co[k] >= 0 ? '+' : '') + co[k].toFixed(4) + '  ' + nm));
console.log('   residual sd ' + sd(res).toFixed(1) + 'mm');

// Each arm appears twice in a span, so a coefficient of 2.0 would mean the
// span credits a segment's full measured length. It does not.
const kUpper = co[1] / 2, kFore = co[2] / 2, kHand = co[3] / 2;
const K = (kUpper + kFore) / 2;
const inboard = (1 - co[0]) / 2;

console.log('\nread as fractions of the full measured length:');
console.log('   upper arm  ' + kUpper.toFixed(4));
console.log('   forearm    ' + kFore.toFixed(4) + '   (the two agree to ' +
  Math.abs(kUpper - kFore).toFixed(4) + ', so one factor covers both)');
console.log('   hand       ' + kHand.toFixed(4) + '   (a hand contributes essentially all of itself)');
console.log('   biacromial ' + co[0].toFixed(4) + '   -> the span swings from a base ' +
  (100 * (1 - co[0])).toFixed(1) + '% narrower than acromion to acromion');

// the vertical, from the resting posture the survey was measured in
const drop = rows.map(r => r.acromialheight - r.wristheight -
  K * (r.acromionradialelength + r.radialestylionlength));
const dropFrac = rows.map((r, i) => drop[i] / r.biacromialbreadth);

console.log('\nacromion to glenohumeral centre:');
console.log('   inboard  ' + inboard.toFixed(4) + ' of biacromial  = ' +
  (inboard * mean(rows.map(r => r.biacromialbreadth))).toFixed(1) + 'mm at the mean');
console.log('   drop     ' + mean(dropFrac).toFixed(4) + ' of biacromial  = ' +
  mean(drop).toFixed(1) + 'mm at the mean  (sd ' + sd(drop).toFixed(1) + ')');

console.log('\nconstants for src/00-anthro.js:');
console.log('   JOINT_CENTRE_K = ' + K.toFixed(4));
console.log('   GH_INBOARD     = ' + inboard.toFixed(4));
console.log('   GH_DROP        = ' + mean(dropFrac).toFixed(4));
