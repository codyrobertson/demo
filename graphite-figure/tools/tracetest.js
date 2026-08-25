/* Does traceCoverage generalise past the digit it was proved on?
   Usage: node tools/tracetest.js

   The defining property is the one tools/outline.js checks for a hand's
   fingers: sample the swept surface, project it, and every sample must
   land inside the outline traced from it. Here the surfaces are not
   anatomy - a tapered tube, a strongly bent one, a twisting elliptical
   loft (a forearm's actual cross-section), a waisted form narrower in the
   middle than either end - and one of them is swept end-on, pointing
   straight at the eye, because that is the view every cross-section-facing
   method breaks on and the entire reason this tracer exists instead. */
'use strict';
global.window = {};
const path = require('path');
const HAND = '/home/user/demo/graphite-kinematics';
const HERE = path.join(__dirname, '..');
require(path.join(HAND, 'src', '00-math.js'));
require(path.join(HAND, 'src', '20-rig.js'));       // for View
require(path.join(HAND, 'src', '10-anatomy.js'));
require(path.join(HERE, 'src', '05-trace.js'));

const G = window.GK, M = G.math, RG = G.rig, TR = G.trace, DEG = M.DEG;
const { vadd, vsub, vmul, vdot, vnorm, vcross, lerp } = M;

// signed distance from p to a closed polyline: negative inside. Identical
// in method to tools/outline.js's sdf - same check, different geometry.
function sdf(p, poly) {
  let d = 1e9, inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const L2 = vx * vx + vy * vy;
    let t = L2 > 1e-12 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    d = Math.min(d, Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t)));
    if ((a[1] > p[1]) !== (b[1] > p[1]) &&
        p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? -d : d;
}

// A stable perpendicular pair for a cross-section at some tangent T: pick a
// world hint, swap it out if it is ever near-parallel to T, and derive the
// pair from what is left. The same construction View itself uses for its
// own screen axes, and for the same reason - it is the one way to turn a
// single direction into a frame that does not flip or degenerate.
function perp(T, hint) {
  let H = hint || [0, 1, 0];
  if (Math.abs(vdot(T, H)) > 0.98) H = [0, 0, 1];
  const N1 = vnorm(vsub(H, vmul(T, vdot(T, H))));
  const N2 = vcross(T, N1);
  return [N1, N2];
}

// ---------------------------------------------------------------- shapes
// Each shape is surfacePoint(t, theta) -> world [x, y, z], t in [0,1] along
// its length, theta in [0, 2*PI) once around its cross-section. Every shape
// runs along world +X, so el = +-90 is an exact end-on view of all of them
// regardless of how each one bends or tapers along the way.

// 1. straight, tapered: the plain case everything else is a stress test of.
function mkStraightCylinder() {
  const AXIS = [1, 0, 0], LEN = 320, R0 = 34, R1 = 16;
  const [N1, N2] = perp(AXIS);
  return (t, theta) => {
    const C = vmul(AXIS, t * LEN);
    const r = lerp(R0, R1, t);
    return vadd(C, vadd(vmul(N1, r * Math.cos(theta)), vmul(N2, r * Math.sin(theta))));
  };
}

// 2. strongly bent: a 150-degree arc, so the tangent at one end points
// almost back the way the tangent at the other end came from - the
// condition under which a per-section facing test has two answers that
// have to be reconciled, and a coverage trace has nothing to reconcile.
function mkBentCylinder() {
  const BEND = 150 * DEG, BR = 210, TR0 = 30, TR1 = 22;
  const C = (t) => { const a = t * BEND; return [BR * Math.sin(a), 0, BR * (1 - Math.cos(a))]; };
  const Tan = (t) => { const a = t * BEND; return vnorm([Math.cos(a), 0, Math.sin(a)]); };
  return (t, theta) => {
    const c = C(t), T = Tan(t);
    const [N1, N2] = perp(T);           // hint's default [0,1,0] is never parallel to a tangent confined to the XZ plane
    const r = lerp(TR0, TR1, t);
    return vadd(c, vadd(vmul(N1, r * Math.cos(theta)), vmul(N2, r * Math.sin(theta))));
  };
}

// 3. a non-circular cross-section that rotates along the length: what a
// forearm actually is (the flexor/extensor mass rotating around the
// radius-ulna axis from elbow to wrist), the case "which way does the
// cross-section face" was never a well-posed question for even head-on.
function mkEllipseLoft() {
  const AXIS = [1, 0, 0], LEN = 260, A0 = 30, A1 = 17, B0 = 20, B1 = 13, TWIST = 170 * DEG;
  const [E1, E2] = perp(AXIS);
  return (t, theta) => {
    const C = vmul(AXIS, t * LEN);
    const a = lerp(A0, A1, t), b = lerp(B0, B1, t);
    const phi = t * TWIST, cp = Math.cos(phi), sp = Math.sin(phi);
    const e1 = vadd(vmul(E1, cp), vmul(E2, sp));
    const e2 = vadd(vmul(E1, -sp), vmul(E2, cp));
    return vadd(C, vadd(vmul(e1, a * Math.cos(theta)), vmul(e2, b * Math.sin(theta))));
  };
}

// 4. a waist narrower than both ends: r(t) = waist + (end-waist)*(2t-1)^2,
// a long bone's own shaft-and-epiphyses profile turned into a stress case -
// the middle rings must not go missing from a silhouette whose extremes on
// both sides are wider than they are.
function mkWaisted() {
  const AXIS = [1, 0, 0], LEN = 300, REND = 34, RWAIST = 14;
  const [N1, N2] = perp(AXIS);
  return (t, theta) => {
    const C = vmul(AXIS, t * LEN);
    const u = 2 * t - 1;
    const r = RWAIST + (REND - RWAIST) * u * u;
    return vadd(C, vadd(vmul(N1, r * Math.cos(theta)), vmul(N2, r * Math.sin(theta))));
  };
}

// ------------------------------------------------------------- the check
function buildRings(surfacePoint, view, NR, NA) {
  const rings = [];
  for (let i = 0; i <= NR; i++) {
    const t = i / NR;
    const row = [];
    for (let k = 0; k < NA; k++) {
      const theta = (k / NA) * Math.PI * 2;
      const P = surfacePoint(t, theta);
      const p = view.px(P);
      row.push([p[0], p[1], view.near(P), 1]);
    }
    rings.push({ row, id: 0 });
  }
  return rings;
}

let n = 0, viewFails = 0, unused = 0, gapFails = 0, worst = 0, worstWhat = '';
const allFar = [];
const PASS = 3.0;      // px; outline.js's own "clearly bad" bar is 4px

function runView(label, surfacePoint, az, el, NR, NA) {
  const view = new RG.View(az, el, 0, 2.4, [0, 0, 0], 0, 0);
  const rings = buildRings(surfacePoint, view, NR, NA);
  const res = TR.traceCoverage(rings, {});
  n++;
  if (!res.use) { unused++; viewFails++; worstWhat = `${label} az${(az/DEG).toFixed(0)} el${(el/DEG).toFixed(0)} NOUSE`; return; }
  const o = res.outline;
  // closed, and no jumps - the same regression outline.js runs
  const close = Math.hypot(o[0][0] - o[o.length - 1][0], o[0][1] - o[o.length - 1][1]);
  let jump = 0, span = 0;
  for (let i = 1; i < o.length; i++) {
    const s2 = Math.hypot(o[i][0] - o[i - 1][0], o[i][1] - o[i - 1][1]);
    span += s2; if (s2 > jump) jump = s2;
  }
  const gapped = close > 3 || jump > (span / (o.length - 1)) * 3.5;
  if (gapped) gapFails++;
  // and it contains the surface it was traced from - denser, independently
  // gridded than the rings that built it, so this is not just re-checking
  // the same points the tracer already saw.
  const NRc = NR + 7, NAc = NA + 7;
  let far = 0;
  for (let i = 0; i <= NRc; i++) {
    const t = i / NRc;
    for (let k = 0; k < NAc; k++) {
      const theta = (k / NAc) * Math.PI * 2;
      const P = surfacePoint(t, theta);
      const d = sdf(view.px(P), o);
      if (d > far) far = d;
    }
  }
  allFar.push(Math.max(0, far));
  if (far > worst) { worst = far; worstWhat = `${label} az${(az/DEG).toFixed(0)} el${(el/DEG).toFixed(0)}`; }
  if (far > PASS || gapped) viewFails++;
}

const AZ = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
const EL = [-90, -60, -30, -10, 0, 10, 30, 60, 90];

const SHAPES = [
  ['straight tapered cylinder', mkStraightCylinder(), 30, 32],
  ['strongly bent cylinder', mkBentCylinder(), 48, 32],
  ['rotating-ellipse loft (forearm)', mkEllipseLoft(), 36, 36],
  ['waisted form', mkWaisted(), 36, 32],
];

const t0 = Date.now();
const perShape = {};
for (const [label, fn, NR, NA] of SHAPES) {
  const before = { n, viewFails, gapFails };
  for (const el of EL) for (const az of AZ) runView(label, fn, az * DEG, el * DEG, NR, NA);
  perShape[label] = { n: n - before.n, fails: viewFails - before.viewFails, gaps: gapFails - before.gapFails };
}

// the dedicated case: end-on, pointing straight at the eye. el = +-90 makes
// the view direction exactly [1,0,0] (or its opposite) - every shape above
// runs along world +X for exactly this reason, so this is a true axial
// view, not an approach to one.
const before = { n, viewFails, gapFails };
for (const [label, fn, NR, NA] of SHAPES) {
  for (const el of [-90, 90]) for (const az of AZ) runView('END-ON ' + label, fn, az * DEG, el * DEG, NR, NA);
}
const endOn = { n: n - before.n, fails: viewFails - before.viewFails, gaps: gapFails - before.gapFails };

allFar.sort((a, b) => a - b);
const q = (f) => allFar.length ? allFar[Math.min(allFar.length - 1, Math.floor(allFar.length * f))].toFixed(3) : 'n/a';

console.log(`${n} view instances across ${SHAPES.length} shapes, ${unused} traced to nothing (${Date.now() - t0}ms)`);
console.log('per shape (all viewing angles, including end-on since el=+-90 is in the sweep):');
for (const [label] of SHAPES) {
  const s = perShape[label];
  console.log(`  ${label.padEnd(32)} ${s.n - s.fails}/${s.n} pass  (gaps: ${s.gaps})`);
}
console.log(`END-ON dedicated sweep (el = +-90 only, all shapes): ${endOn.n - endOn.fails}/${endOn.n} pass  (gaps: ${endOn.gaps})`);
console.log(`surface outside its own outline (px): median ${q(0.5)}  p90 ${q(0.9)}  p99 ${q(0.99)}  max ${worst.toFixed(3)}`);
console.log(`  worst: ${worstWhat}`);
console.log(`broken or jumping loops: ${gapFails}`);
console.log(`TOTAL: ${n - viewFails}/${n} pass, ${viewFails} fail (pass bar: <= ${PASS}px, closed, no jumps)`);
const bad = viewFails > 0;
console.log(bad ? 'FAIL' : 'ok');
process.exit(bad ? 1 : 0);
