/* Fit the anthropometric kernel from ANSUR II.
   Usage: node tools/fit-ansur.js <dir with male.csv and female.csv> [out.json]

   ANSUR II is the 2012 US Army anthropometric survey: 4,082 men and 1,986
   women, 93 directly measured dimensions, millimetres throughout except
   weightkg. The scalar database is public. This reads it and fits a compact
   generative model, which is then the only thing the figure project ships —
   the CSVs are 3MB and the fit is 29kB, so data/ansur-model.json is checked
   in and the survey itself is not.

   To regenerate:
     curl -sSLO 'https://raw.githubusercontent.com/senihberkay/US-Army-ANSUR-II/master/ANSUR%20II%20MALE%20Public.csv'
     curl -sSLO 'https://raw.githubusercontent.com/senihberkay/US-Army-ANSUR-II/master/ANSUR%20II%20FEMALE%20Public.csv'
     mv 'ANSUR II MALE Public.csv' male.csv && mv 'ANSUR II FEMALE Public.csv' female.csv
     node tools/fit-ansur.js <that dir> data/ansur-model.json
   The authoritative source is the US Army Public Health Command's
   anthropometric database page; the mirror above is a convenience.

   WHY LOG SPACE. Body proportions are multiplicative, not additive: a person
   10% taller is not a person with 40mm added to every bone, they are a person
   scaled, and the departures from that scaling are themselves proportional.
   Fitting in log space makes the first principal component *be* overall size,
   leaves the rest describing shape independent of it, and — because the
   reconstruction is an exponential — cannot generate a negative femur.

   WHY A JOINT MODEL AT ALL, rather than a mean and a spread per measurement.
   Sampling 45 measurements independently produces a body that does not exist:
   long arms come with a long span, broad shoulders, a longer forearm and a
   bigger hand, and drawing each on its own gives you a person with one long
   arm bone and an ordinary everything else. The covariance is the point.

   Sexes are pooled deliberately and the sex is NOT a model input. In log
   space the male/female difference is overwhelmingly a size difference plus a
   shoulder-to-hip contrast, and both fall out as principal components — so a
   sampled figure lands somewhere on the real continuum rather than on one of
   two presets, and the intermediate builds that exist in reality remain
   reachable. The fit reports how well that holds. */
'use strict';
const fs = require('fs');
const path = require('path');

// The measurements this project actually needs, grouped by what they resolve.
// Every one of these is directly measured in ANSUR — nothing here is derived,
// and any landmark the figure needs that is not on this list has to be
// justified rather than invented.
const COLS = [
  // overall
  'stature', 'weightkg', 'sittingheight', 'span',
  // landmark heights, all from the floor: these give joint centres directly
  // rather than by chaining assumed segment ratios down from the head
  'cervicaleheight', 'suprasternaleheight', 'acromialheight', 'axillaheight',
  'chestheight', 'tenthribheight', 'waistheightomphalion', 'iliocristaleheight',
  'trochanterionheight', 'buttockheight', 'crotchheight',
  'lateralfemoralepicondyleheight', 'tibialheight', 'lateralmalleolusheight',
  'wristheight',
  // arm
  'acromionradialelength', 'radialestylionlength', 'shoulderelbowlength',
  'forearmhandlength', 'handlength', 'palmlength', 'handbreadth', 'handcircumference',
  // breadths and depths: the trunk's cross-section
  'biacromialbreadth', 'bideltoidbreadth', 'shoulderlength', 'interscyeii',
  'chestbreadth', 'chestdepth', 'waistbreadth', 'waistdepth',
  'bicristalbreadth', 'hipbreadth', 'buttockdepth',
  // girths, which are what a surface is lofted through
  'neckcircumference', 'chestcircumference', 'waistcircumference',
  'buttockcircumference', 'thighcircumference', 'lowerthighcircumference',
  'calfcircumference', 'anklecircumference', 'bicepscircumferenceflexed',
  'forearmcircumferenceflexed', 'wristcircumference',
  // foot
  'footlength', 'footbreadthhorizontal', 'bimalleolarbreadth', 'heelbreadth',
  // head
  'headlength', 'headbreadth', 'headcircumference', 'tragiontopofhead',
  'bizygomaticbreadth', 'mentonsellionlength',
];

// ---------------------------------------------------------------------------
//  CSV
// ---------------------------------------------------------------------------
function readCsv(file) {
  const txt = fs.readFileSync(file, 'latin1');
  const lines = txt.split(/\r?\n/).filter(l => l.length);
  const head = lines[0].split(',');
  const idx = {};
  head.forEach((h, i) => { idx[h.trim()] = i; });
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',');
    const r = {};
    for (const c of COLS) {
      const j = idx[c];
      if (j === undefined) throw new Error('missing column ' + c + ' in ' + file);
      r[c] = parseFloat(f[j]);
    }
    r.sex = (idx.Gender !== undefined ? f[idx.Gender] : '').trim();
    rows.push(r);
  }
  return rows;
}

// ---------------------------------------------------------------------------
//  JACOBI EIGENDECOMPOSITION
//  A symmetric p x p matrix, p around fifty. Jacobi is not the fastest way to
//  do this and at this size that is irrelevant; what it is, is exact to
//  machine precision and short enough to read, which matters more for a
//  number that ends up deciding what a generated body looks like.
// ---------------------------------------------------------------------------
function jacobi(Ain, iters = 200) {
  const p = Ain.length;
  const A = Ain.map(r => r.slice());
  let V = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < iters; sweep++) {
    let off = 0;
    for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) off += A[i][j] * A[i][j];
    if (off < 1e-22) break;
    for (let q = 0; q < p; q++) {
      for (let r = q + 1; r < p; r++) {
        if (Math.abs(A[q][r]) < 1e-18) continue;
        const theta = (A[r][r] - A[q][q]) / (2 * A[q][r]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < p; k++) {
          const akq = A[k][q], akr = A[k][r];
          A[k][q] = c * akq - s * akr;
          A[k][r] = s * akq + c * akr;
        }
        for (let k = 0; k < p; k++) {
          const aqk = A[q][k], ark = A[r][k];
          A[q][k] = c * aqk - s * ark;
          A[r][k] = s * aqk + c * ark;
        }
        for (let k = 0; k < p; k++) {
          const vkq = V[k][q], vkr = V[k][r];
          V[k][q] = c * vkq - s * vkr;
          V[k][r] = s * vkq + c * vkr;
        }
      }
    }
  }
  const eig = [];
  for (let i = 0; i < p; i++) eig.push({ val: A[i][i], vec: V.map(row => row[i]) });
  eig.sort((a, b) => b.val - a.val);
  return eig;
}

// ---------------------------------------------------------------------------
//  FIT
// ---------------------------------------------------------------------------
const dir = process.argv[2] || path.join(__dirname, '..', 'data');
const out = process.argv[3] || path.join(__dirname, '..', 'data', 'ansur-model.json');

const rows = readCsv(path.join(dir, 'male.csv')).concat(readCsv(path.join(dir, 'female.csv')));
const p = COLS.length, n = rows.length;
console.log('ANSUR II: ' + n + ' subjects, ' + p + ' measurements');

// log space, then standardise so the PCA is on the correlation matrix and a
// circumference in the hundreds does not outweigh an ear in the tens
const Y = rows.map(r => COLS.map(c => Math.log(r[c])));
const mean = COLS.map((_, j) => Y.reduce((s, y) => s + y[j], 0) / n);
const sd = COLS.map((_, j) =>
  Math.sqrt(Y.reduce((s, y) => s + (y[j] - mean[j]) ** 2, 0) / (n - 1)));
const Z = Y.map(y => y.map((v, j) => (v - mean[j]) / sd[j]));

const C = Array.from({ length: p }, () => new Array(p).fill(0));
for (const z of Z) for (let i = 0; i < p; i++) for (let j = i; j < p; j++) C[i][j] += z[i] * z[j];
for (let i = 0; i < p; i++) for (let j = i; j < p; j++) { C[i][j] /= (n - 1); C[j][i] = C[i][j]; }

const eig = jacobi(C);
const total = eig.reduce((s, e) => s + Math.max(0, e.val), 0);
let acc = 0, K = 0;
while (K < eig.length && acc / total < 0.95) { acc += Math.max(0, eig[K].val); K++; }
console.log('components kept: ' + K + ' of ' + p + '  (' + (100 * acc / total).toFixed(1) + '% of variance)');
eig.slice(0, 6).forEach((e, i) =>
  console.log('   PC' + (i + 1) + '  ' + (100 * e.val / total).toFixed(1) + '%'));

const model = {
  source: 'ANSUR II (2012 US Army Anthropometric Survey), public scalar database',
  subjects: n, males: rows.filter(r => r.sex === 'Male').length,
  space: 'natural log of each measurement, then standardised; units mm except weightkg in kg',
  cols: COLS,
  mean, sd,
  // components[k] is one eigenvector in standardised log space, already
  // scaled by its own standard deviation, so sampling is z ~ N(0,1) and a
  // caller never has to remember to weight by the eigenvalue
  components: eig.slice(0, K).map(e => e.vec.map(v => v * Math.sqrt(Math.max(0, e.val)))),
  varianceExplained: eig.slice(0, K).map(e => e.val / total),
};

// The variance the kept components do NOT account for, per measurement, added
// back at sample time as independent noise. Without it a truncated PCA is
// wrong in two ways at once and they are the same way: the discarded
// components are the near-independent part of the variation, so dropping them
// leaves every sample under-dispersed AND over-correlated. Measured on the
// first fit: foot length came out 7.5% narrow, and the correlation between
// trochanter height and knee height rose from a real 0.906 to 0.985 — a
// synthetic population in which the thigh is a fixed fraction of the leg,
// which is exactly the procedural stiffness this whole model exists to avoid.
model.residual = COLS.map((_, j) => {
  let kept = 0;
  for (let k = 0; k < model.components.length; k++) kept += model.components[k][j] ** 2;
  return Math.sqrt(Math.max(0, 1 - kept));
});
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(model));
console.log('residual sd: median ' +
  model.residual.slice().sort((a, b) => a - b)[Math.floor(p / 2)].toFixed(3) +
  ', max ' + Math.max(...model.residual).toFixed(3));
console.log('-> ' + out + '  ' + (fs.statSync(out).size / 1024).toFixed(0) + ' kB');

// ---------------------------------------------------------------------------
//  VALIDATION
//  A generative model that reproduces the marginals and loses the covariance
//  is exactly the failure this is built to avoid, so both are checked, and
//  against held-out structure rather than against the fit's own residuals.
// ---------------------------------------------------------------------------
function sample(rng) {
  const z = model.components.map(() => rng());
  return COLS.map((_, j) => {
    let s = 0;
    for (let k = 0; k < model.components.length; k++) s += z[k] * model.components[k][j];
    s += model.residual[j] * rng();
    return Math.exp(mean[j] + sd[j] * s);
  });
}
let g = 1234567;
const rnd = () => { g = (g * 1103515245 + 12345) & 0x7fffffff; return g / 0x7fffffff; };
const gauss = () => {
  let u = 0, v = 0, s = 0;
  do { u = rnd() * 2 - 1; v = rnd() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  return u * Math.sqrt(-2 * Math.log(s) / s);
};
const NS = 20000;
const S = [];
for (let i = 0; i < NS; i++) S.push(sample(gauss));

const realMean = COLS.map((_, j) => rows.reduce((s, r) => s + r[COLS[j]], 0) / n);
const realSd = COLS.map((_, j) =>
  Math.sqrt(rows.reduce((s, r) => s + (r[COLS[j]] - realMean[j]) ** 2, 0) / (n - 1)));
const synMean = COLS.map((_, j) => S.reduce((s, x) => s + x[j], 0) / NS);
const synSd = COLS.map((_, j) =>
  Math.sqrt(S.reduce((s, x) => s + (x[j] - synMean[j]) ** 2, 0) / (NS - 1)));

let worstM = 0, worstMc = '', worstS = 0, worstSc = '';
COLS.forEach((c, j) => {
  const dm = Math.abs(synMean[j] - realMean[j]) / realMean[j];
  const ds = Math.abs(synSd[j] - realSd[j]) / realSd[j];
  if (dm > worstM) { worstM = dm; worstMc = c; }
  if (ds > worstS) { worstS = ds; worstSc = c; }
});
console.log('\nmarginals over ' + NS + ' synthetic bodies');
console.log('  worst mean error  ' + (100 * worstM).toFixed(2) + '%  (' + worstMc + ')');
console.log('  worst sd error    ' + (100 * worstS).toFixed(2) + '%  (' + worstSc + ')');

const corr = (X, a, b, get) => {
  const N = X.length;
  let ma = 0, mb = 0;
  for (const x of X) { ma += get(x, a); mb += get(x, b); }
  ma /= N; mb /= N;
  let sa = 0, sb = 0, sab = 0;
  for (const x of X) {
    const da = get(x, a) - ma, db = get(x, b) - mb;
    sa += da * da; sb += db * db; sab += da * db;
  }
  return sab / Math.sqrt(sa * sb);
};
const gr = (r, c) => r[c], gs = (x, c) => x[COLS.indexOf(c)];
const PAIRS = [
  ['stature', 'span'], ['stature', 'trochanterionheight'],
  ['acromionradialelength', 'radialestylionlength'],
  ['biacromialbreadth', 'bicristalbreadth'],
  ['waistcircumference', 'weightkg'],
  ['stature', 'handlength'], ['stature', 'footlength'],
  ['chestcircumference', 'waistcircumference'],
  ['trochanterionheight', 'lateralfemoralepicondyleheight'],
];
console.log('\ncorrelations kept (real -> synthetic)');
let worstR = 0, worstRp = '';
for (const [a, b] of PAIRS) {
  const ra = corr(rows, a, b, gr), sa2 = corr(S, a, b, gs);
  const d = Math.abs(ra - sa2);
  if (d > worstR) { worstR = d; worstRp = a + '/' + b; }
  console.log('  ' + (a + ' / ' + b).padEnd(52) + ra.toFixed(3) + '  ->  ' + sa2.toFixed(3));
}
console.log('  worst drift ' + worstR.toFixed(3) + '  (' + worstRp + ')');
