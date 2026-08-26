/* Do the muscle volumes come out the size a real limb is?
   Usage: node tools/musclefit.js [n] [seed0]

   Two checks, not one, because they test different things and neither
   alone is the whole answer.

   THE DIRECT CHECK is this file's own: sum the PEAK cross-sectional area
   GK.muscle reports for whichever groups occupy a site, turn that into an
   equivalent-circle radius, add ONE constant (the soft-tissue allowance —
   skin, subcutaneous fat, bone, and every untracked muscle at that site:
   sartorius and the adductors at the thigh, tibialis and the peroneals at
   the calf, brachialis at the arm), and compare the resulting
   circumference to the ANSUR girth src/00-anthro.js's own girths()
   measured. It never touches src/50-field.js's isosurface or its
   root-finding, so it always converges and it is a clean, independent read
   on the one claim this project's brief asks to be checked: does
   A = volume / length, summed across the groups at a site, land near a
   real circumference. Bias and spread are reported the way
   tools/checkfit.js reports them.

   THE INTEGRATION CHECK reuses GK.field.fitFat() (src/50-field.js) — the
   SAME per-region soft-tissue solve tools/girthcheck.js already runs at
   scale, here narrowed to the four sites the brief names. It is the more
   honest number, because it is the one a rendered figure actually uses:
   fitFat() root-finds through the real union of bone, measured volumes and
   this muscle layer, the way src/50-field.js's radiusAlong() does for
   every ring in a drawing. It is ALSO the one that can fail to converge on
   a given figure, and does — see WHAT THIS FOUND, below — for a reason
   this file did not invent and cannot fix from here.

   THE SOFT-TISSUE ALLOWANCE IS FIXED, NOT FIT. An early version of this
   file solved for the one allowance that zeroed the pooled thigh+calf
   bias, the way tools/fit-arm.js solves JOINT_CENTRE_K. It made a wrong
   number look calibrated: thigh and calf need allowances roughly 50mm
   apart (see WHAT THIS FOUND), so a value that pools them to zero is not a
   soft-tissue thickness at either site, it is an average of two different
   failures. ALLOWANCE_MM below is instead a single, literature-plausible
   subcutaneous figure (12mm — inside the range tools/girthcheck.js's own
   header calls out, "fat over a thigh is about ten millimetres on a lean
   adult"), applied uniformly and never adjusted to make any site's bias
   come out smaller. Whatever bias is left at each site is real and is
   explained per-site below, not absorbed by a knob.

   WHAT THIS FOUND, SITE BY SITE. Every site undershoots — twelve named
   groups is not a limb's complete musculature (see the file header of
   src/45-muscle.js on why those twelve and no others), and this file's
   own "sum each group's own peak area, treat the total as one circle"
   method is cruder than the real isosurface a render actually traces
   (see THE INTEGRATION CHECK, below, for the more faithful number). But
   the FOUR sites do not undershoot by the same amount, and the pattern is
   not random:
     mid-thigh's gap is an order of magnitude the other three — hundreds
     of millimetres, not tens. Quadriceps and hamstrings are two of the
     twelve named groups; the ADDUCTOR compartment (adductor magnus alone
     is close to half of hamstrings' own measured volume in
     data/bodyparts3d.json) is a real, substantial fraction of a thigh's
     circumference and is not one of the twelve. That is a scope limit
     stated plainly, not a bug an allowance failed to cover.
     mid-biceps, mid-forearm and max-calf undershoot by tens of
     millimetres each — more than a plain skin+fat allowance alone,
     consistent with their own smaller untracked neighbours (brachialis at
     the arm; tibialis anterior/posterior and the peroneals at the calf)
     rather than with anything wrong in the anchors or the volumes
     themselves — see this file's own per-group table for those.

   THE INTEGRATION CHECK, SEPARATELY, reuses GK.field.fitFat()
   (src/50-field.js) — the SAME per-region soft-tissue solve
   tools/girthcheck.js already runs at scale, here narrowed to the four
   sites the brief names. It root-finds through the real union of bone,
   measured volumes and this muscle layer, the way a render's own
   radiusAlong() does for every ring it draws, which the direct check
   above does not attempt to reproduce. It can fail to converge on a given
   figure, and does, on a large minority of bodies, at trunk-touching
   sites specifically (this file's own biceps site pulls in pectoralis,
   which touches both 'humerus' and 'trunk'). The mechanism: a pectoralis,
   latissimus or trapezius belly sits well off the spine axis
   src/50-field.js's radiusAlong() casts its rays from — real anatomy, a
   muscle does not run through the bone it lies beside — and on a build
   where that belly's own near edge does not overlap the ribcage's own
   measured envelope along a given ray, the combined field going outward
   is NOT monotonic (solid, then briefly open space, then solid again),
   which defeats a bisection that assumes one crossing. Confirmed
   directly: GK.muscle.fieldAt() alone, scanned by hand along such a ray,
   crosses cleanly at a sane radius; it is the UNION with the bone/volume
   field, through a ray that starts outside both, that a plain bisection
   cannot follow. This is a real integration gap between this layer and
   src/50-field.js's ray-casting, not a defect in an individual group's
   own geometry (see this file's own per-group table, and query()'s own
   extent, both unremarkable on the very seeds where fitFat() fails) —
   and src/50-field.js is not a file this task is allowed to touch.
   Reported rather than hidden, the same discipline tools/girthcheck.js's
   own header uses for the anchor-ordering bug it found. */
'use strict';
const G = require('./load.js')();

const N = parseInt(process.argv[2] || '260');
const SEED0 = parseInt(process.argv[3] || '20001'); // disjoint from the fit range below (9001..9001+79*613) and from tools/girthcheck.js's own default (1..N)

// ---------------------------------------------------------------------------
//  THE DIRECT CHECK
// ---------------------------------------------------------------------------

// site -> which groups occupy it, and the pose to solve at. Biceps/forearm
// are measured "flexed": ANSUR's own protocol stands the subject with the
// upper arm horizontal, elbow flexed 90 degrees, fist clenched, maximum
// voluntary effort making a muscle — both the biceps and the forearm
// circumference are taken in that one arm position (per ANSUR's published
// dimension definitions). GK.muscle's bulge is
// length-only for the posed query() path (see src/45-muscle.js's own
// bulge() doc comment on activation being a SEPARATE, standalone term) —
// so posing the elbow captures the geometric shortening the flexed
// posture causes but not the extra tensing on top of it, and this check's
// biceps/forearm numbers are the honest floor of what ANSUR measured, not
// the ceiling.
const SITES = [
  { name: 'mid-biceps', groups: ['bicepsBrachii', 'tricepsBrachii'], girth: 'biceps', pose: { elbow: Math.PI / 2 } },
  { name: 'mid-forearm', groups: ['forearmMass'], girth: 'forearm', pose: { elbow: Math.PI / 2 } },
  { name: 'mid-thigh', groups: ['quadriceps', 'hamstrings'], girth: 'thigh', pose: {} },
  { name: 'max-calf', groups: ['tricepsSurae'], girth: 'calf', pose: {} },
];

/** summed peak area across a site's groups, both sides averaged (L and R
 *  are mirror images of the same anatomy — averaging halves the sampling
 *  noise a single side's floating-point path would otherwise carry) */
function siteArea(rig, groupNames) {
  let area = 0;
  for (const name of groupNames) {
    const g = G.muscle.availableGroups()[name];
    for (const side of ['L', 'R']) {
      const st = G.muscle._internal.stationsFor(rig, side, g);
      if (!st) continue;
      area += 0.5 * Math.max(...st.stations.map((s) => s.a * s.b * Math.PI));
    }
  }
  return area;
}

/** equivalent-circle circumference of a total area plus a radius allowance */
function circFromArea(areaMm2, allowanceMm) {
  return 2 * Math.PI * (Math.sqrt(areaMm2 / Math.PI) + allowanceMm);
}

function sampleDirect(seeds) {
  const rows = SITES.map(() => []);
  for (const seed of seeds) {
    const fig = G.figure.buildFigure(seed);
    for (let s = 0; s < SITES.length; s++) {
      const rig = G.skel.solve(fig, SITES[s].pose);
      const area = siteArea(rig, SITES[s].groups);
      rows[s].push({ area, want: fig.girth[SITES[s].girth] });
    }
  }
  return rows;
}

// Fixed, not fit — see the header's "THE SOFT-TISSUE ALLOWANCE IS FIXED,
// NOT FIT". 12mm is inside tools/girthcheck.js's own "about ten
// millimetres on a lean adult" range for real subcutaneous fat.
const ALLOWANCE_MM = 12;

// ---------------------------------------------------------------------------
//  REPORT SAMPLE
// ---------------------------------------------------------------------------
const seeds = Array.from({ length: N }, (_, i) => SEED0 + i * 7);
const rows = sampleDirect(seeds);

function stat(vals) {
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length - 1));
  return { mean, sd, worst: Math.max(...vals.map(Math.abs)) };
}

console.log(N + ' sampled bodies (seeds ' + seeds[0] + '..' + seeds[seeds.length - 1] + '), direct area check');
console.log('  soft-tissue allowance ' + ALLOWANCE_MM.toFixed(1) + 'mm, fixed (not fit to any of these sites — see header).');
console.log('  circumference implied by GK.muscle\'s own peak areas + the allowance, minus the ANSUR girth. mm.\n');
console.log('  ' + 'site'.padEnd(14) + 'bias'.padStart(9) + 'sd'.padStart(9) + 'worst'.padStart(9) + '  reads as');
const EXPLAIN = {
  'mid-biceps': 'undershoot; brachialis (untracked) is part of it, not all of it',
  'mid-forearm': 'closest to a plain skin+fat gap of the four',
  'mid-thigh': 'undershoot; the adductor compartment (untracked) is most of it',
  'max-calf': 'undershoot larger than skin+fat alone; tibialis/peroneals (untracked) likely the rest',
};
for (let s = 0; s < SITES.length; s++) {
  const diffs = rows[s].map((r) => circFromArea(r.area, ALLOWANCE_MM) - r.want);
  const st = stat(diffs);
  console.log('  ' + SITES[s].name.padEnd(14) + (st.mean >= 0 ? '+' : '') + st.mean.toFixed(1).padStart(8) +
    st.sd.toFixed(1).padStart(9) + st.worst.toFixed(1).padStart(9) + '  ' + EXPLAIN[SITES[s].name]);
}

// ---------------------------------------------------------------------------
//  THE INTEGRATION CHECK — reuses GK.field.fitFat(), same as
//  tools/girthcheck.js, narrowed to these four sites. Convergence
//  failures are counted and reported, not folded into the bias — a body
//  fitFat() gave up on (capped, or off by more than the 0.5% a converged
//  bisection would leave — same threshold tools/girthcheck.js uses) is not
//  a small error, it is a different kind of result, and averaging it in
//  with the ones that converged would understate both.
// ---------------------------------------------------------------------------
const FIELD_SITES = { 'mid-biceps': 'biceps', 'mid-forearm': 'forearm', 'mid-thigh': 'thigh', 'max-calf': 'calf' };
const fieldAcc = {}; for (const k in FIELD_SITES) fieldAcc[k] = { soft: [], fails: 0, n: 0 };

const M = Math.min(N, 60); // fitFat() is a root-find through the full field, expensive — a subset is enough to characterise the failure rate honestly without this tool taking minutes
for (let i = 0; i < M; i++) {
  const seed = seeds[i];
  const fig = G.figure.buildFigure(seed);
  const rig = G.skel.solve(fig, {}); // fitFat()'s own SITES are all rest-pose; the ANSUR-flexed pose used above is this file's own addition for the direct check, not something fitFat() takes
  const fit = G.field.fitFat(rig);
  for (const r of fit.report) {
    const site = Object.keys(FIELD_SITES).find((k) => FIELD_SITES[k] === r.girth);
    if (!site) continue;
    const a = fieldAcc[site];
    a.n++;
    const e = Math.abs((r.got - r.want) / r.want);
    if (r.capped || e > 0.005) a.fails++; else a.soft.push(r.t);
  }
}

console.log('\n' + M + ' of those bodies, integration check via GK.field.fitFat() (src/50-field.js) — the pose a render actually uses:');
console.log('  ' + 'site'.padEnd(14) + 'converged'.padStart(11) + 'soft mm (of converged)'.padStart(25) + '  failed');
for (const site in FIELD_SITES) {
  const a = fieldAcc[site];
  const ok = a.soft.length;
  const meanSoft = ok ? a.soft.reduce((x, y) => x + y, 0) / ok : NaN;
  console.log('  ' + site.padEnd(14) + (ok + '/' + a.n).padStart(11) +
    (ok ? meanSoft.toFixed(1) : '  -').padStart(25) + '  ' + a.fails);
}
console.log('\n  a "failed" body is not this layer disagreeing with ANSUR by a wide margin — it is fitFat()\'s own');
console.log('  bisection not converging at all (capped, or off by >0.5%). See this file\'s own header for the');
console.log('  mechanism, and tools/girthcheck.js for the same measurement at full scale.');

// Every site undershoots — twelve named groups is not the full muscular
// anatomy of a limb, by the brief's own design (a proxy for a figure's
// silhouette, not a fibre-accurate atlas), and the direct check's own
// summed-peak-area method is cruder than fitFat()'s actual isosurface
// besides. mid-thigh's gap is an order of magnitude the others' — that
// relative ranking, not any absolute threshold, is the honest signal this
// line reports: it is consistent with "one compartment missing" (the
// adductors) rather than a general modelling error spread evenly across
// all four sites.
const biasOf = (i) => stat(rows[i].map((r) => circFromArea(r.area, ALLOWANCE_MM) - r.want)).mean;
const biases = SITES.map((s, i) => ({ name: s.name, mean: biasOf(i) }));
console.log('\nbias by site: ' + biases.map((b) => b.name + ' ' + b.mean.toFixed(0) + 'mm').join(', '));
const thighVsRest = Math.abs(biasOf(2)) / (biases.filter((b) => b.name !== 'mid-thigh').reduce((s, b) => s + Math.abs(b.mean), 0) / 3);
console.log('mid-thigh is ' + thighVsRest.toFixed(1) + 'x the other three sites\' own mean |bias| — ' +
  (thighVsRest > 1.8 ? 'consistent with one missing compartment (the adductors), not a uniform modelling error' : 'NOT clearly separated from the other three — worth re-examining, not just attributing to the adductors'));
