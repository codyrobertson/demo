/* ============================================================================
   GRAPHITE KINEMATICS — 00 · math
   Deterministic randomness, value noise, vector algebra, curve utilities.
   Everything downstream is a pure function of (seed, params). No Math.random.
   ========================================================================== */
(function (GK) {
  'use strict';

  // ---------------------------------------------------------------- constants
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  // ------------------------------------------------------------------- scalar
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = lerp;
  const inv = (v, a, b) => (b === a ? 0 : (v - a) / (b - a));
  const remap = (v, a, b, c, d) => lerp(c, d, clamp01(inv(v, a, b)));
  const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
  const smootherstep = (t) => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };
  const sstep = (a, b, v) => smoothstep(inv(v, a, b));
  const sign = Math.sign;

  // easing used by pose interpolation
  const ease = {
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    in: (t) => t * t * t,
    elasticOut: (t) => (t === 0 || t === 1) ? t
      : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1,
    breathe: (t) => 0.5 - 0.5 * Math.cos(TAU * t)
  };

  // ---------------------------------------------------------------------- rng
  // mulberry32 — small, fast, well-distributed, fully deterministic.
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class Rng {
    constructor(seed) { this.reseed(seed); }
    reseed(seed) {
      this.seed = (seed >>> 0) || 1;
      this._f = mulberry32(this.seed * 2654435761 % 4294967296);
      this._spare = null;
      return this;
    }
    /** uniform [0,1) */
    f() { return this._f(); }
    /** uniform [a,b) */
    range(a, b) { return a + (b - a) * this._f(); }
    /** integer [a,b] inclusive */
    int(a, b) { return a + Math.floor(this._f() * (b - a + 1)); }
    /** boolean with probability p */
    chance(p) { return this._f() < p; }
    /** signed uniform [-m,m] */
    sym(m) { return (this._f() * 2 - 1) * m; }
    /** gaussian via Box-Muller, cached spare */
    gauss(mu = 0, sd = 1) {
      if (this._spare !== null) { const s = this._spare; this._spare = null; return mu + sd * s; }
      let u = 0, v = 0, s = 0;
      do { u = this._f() * 2 - 1; v = this._f() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
      const m = Math.sqrt(-2 * Math.log(s) / s);
      this._spare = v * m;
      return mu + sd * u * m;
    }
    /** gaussian truncated to [lo,hi] */
    gaussIn(mu, sd, lo, hi) {
      for (let i = 0; i < 12; i++) { const g = this.gauss(mu, sd); if (g >= lo && g <= hi) return g; }
      return clamp(mu, lo, hi);
    }
    pick(arr) { return arr[Math.floor(this._f() * arr.length)]; }
    /** pick from [{v,w},...] by weight */
    weighted(table) {
      let total = 0; for (const e of table) total += e.w;
      let r = this._f() * total;
      for (const e of table) { r -= e.w; if (r <= 0) return e.v; }
      return table[table.length - 1].v;
    }
    shuffled(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this._f() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    }
    /** a fresh independent stream, derived deterministically */
    fork(salt) { return new Rng((this.seed ^ Math.imul(salt + 1, 0x9E3779B1)) >>> 0); }
  }

  // -------------------------------------------------------------- value noise
  // Own implementation so output never depends on the host p5 build.
  const P_SIZE = 512;
  class Noise {
    constructor(seed) {
      const r = mulberry32(((seed >>> 0) || 1) * 0x27D4EB2D % 4294967296);
      this.g = new Float32Array(P_SIZE);
      for (let i = 0; i < P_SIZE; i++) this.g[i] = r();
      this.perm = new Uint16Array(P_SIZE * 2);
      const p = new Uint16Array(P_SIZE);
      for (let i = 0; i < P_SIZE; i++) p[i] = i;
      for (let i = P_SIZE - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
      for (let i = 0; i < P_SIZE * 2; i++) this.perm[i] = p[i & (P_SIZE - 1)];
    }
    _h(i, j, k) {
      const pm = this.perm;
      // `& 1023 & 511` and `& 511` mask to the same nine bits - 511 is a
      // subset of the 1023 mask, so ANDing with 1023 first and throwing most
      // of it away with a second AND right after was never selecting
      // anything the single mask doesn't. Every hash this returns is called
      // eight times for one noise sample, so it is worth not asking twice.
      return this.g[pm[(pm[(pm[i & 511] + (j & 511)) & 511] + (k & 511)) & 511]];
    }
    /** 3-D value noise, output in [0,1] */
    n3(x, y, z) {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      const xf = x - xi, yf = y - yi, zf = z - zi;
      const u = smootherstep(xf), v = smootherstep(yf), w = smootherstep(zf);
      const c000 = this._h(xi, yi, zi), c100 = this._h(xi + 1, yi, zi);
      const c010 = this._h(xi, yi + 1, zi), c110 = this._h(xi + 1, yi + 1, zi);
      const c001 = this._h(xi, yi, zi + 1), c101 = this._h(xi + 1, yi, zi + 1);
      const c011 = this._h(xi, yi + 1, zi + 1), c111 = this._h(xi + 1, yi + 1, zi + 1);
      const x00 = lerp(c000, c100, u), x10 = lerp(c010, c110, u);
      const x01 = lerp(c001, c101, u), x11 = lerp(c011, c111, u);
      return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
    }
    n2(x, y) { return this.n3(x, y, 0.5); }
    n1(x) { return this.n3(x, 0.5, 0.5); }
    /** fractal sum, output in [0,1] */
    fbm(x, y, z, oct = 4, gain = 0.5, lac = 2.0) {
      let a = 0.5, f = 1, sum = 0, norm = 0;
      for (let i = 0; i < oct; i++) { sum += a * this.n3(x * f, y * f, z * f); norm += a; a *= gain; f *= lac; }
      return sum / norm;
    }
    /** signed fractal, roughly [-1,1] */
    sfbm(x, y, z, oct = 4) { return this.fbm(x, y, z, oct) * 2 - 1; }
  }

  // ------------------------------------------------------------------ vectors
  const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
  const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const vmad = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
  const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const vcross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
  const vlen = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
  const vdist = (a, b) => vlen(vsub(a, b));
  const vnorm = (a) => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const vlerp = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const vcopy = (a) => [a[0], a[1], a[2]];

  /** combine three basis vectors: o + e0*a + e1*b + e2*c */
  const vframe = (o, e0, a, e1, b, e2, c) => [
    o[0] + e0[0] * a + e1[0] * b + e2[0] * c,
    o[1] + e0[1] * a + e1[1] * b + e2[1] * c,
    o[2] + e0[2] * a + e1[2] * b + e2[2] * c
  ];

  // ------------------------------------------------------------------ 3x3 rot
  // Column-major-ish: m = [ex, ey, ez] each a vec3 — the frame's basis vectors.
  const IDENT = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  /** apply frame m to local vector v -> world */
  const mApply = (m, v) => [
    m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
    m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
    m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2]
  ];

  /** compose: result = parent applied to child (child expressed in parent) */
  const mMul = (p, c) => [mApply(p, c[0]), mApply(p, c[1]), mApply(p, c[2])];

  /** rotation about local X (long axis of a bone) — axial twist / pronation */
  function rotX(t) {
    const c = Math.cos(t), s = Math.sin(t);
    return [[1, 0, 0], [0, c, s], [0, -s, c]];
  }
  /** rotation about local Y (mediolateral axis) — flexion / extension */
  function rotY(t) {
    const c = Math.cos(t), s = Math.sin(t);
    return [[c, 0, -s], [0, 1, 0], [s, 0, c]];
  }
  /** rotation about local Z (dorsopalmar axis) — abduction / adduction */
  function rotZ(t) {
    const c = Math.cos(t), s = Math.sin(t);
    return [[c, s, 0], [-s, c, 0], [0, 0, 1]];
  }

  /** re-orthonormalise to kill accumulated float drift over long chains */
  function mOrtho(m) {
    const x = vnorm(m[0]);
    let y = vsub(m[1], vmul(x, vdot(m[1], x)));
    y = vnorm(y);
    const z = vcross(x, y);
    return [x, y, z];
  }

  // ------------------------------------------------------------------- curves
  /** uniform Catmull-Rom, scalar, given t and its already-computed powers */
  function crSt(p0, p1, p2, p3, t, t2, t3) {
    return 0.5 * ((2 * p1) + (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  /** uniform Catmull-Rom, scalar */
  function crS(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return crSt(p0, p1, p2, p3, t, t2, t3);
  }
  /** uniform Catmull-Rom, vec3
   *  t2 and t3 depend on t alone, not on which of the three coordinates is
   *  being blended, so computing them once here and handing them to crSt
   *  three times is the same nine multiplies crS would have done on its own
   *  three calls, minus the four of those nine that were computing the exact
   *  same t*t and t*t*t over again each time. */
  function crV(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return [
      crSt(p0[0], p1[0], p2[0], p3[0], t, t2, t3),
      crSt(p0[1], p1[1], p2[1], p3[1], t, t2, t3),
      crSt(p0[2], p1[2], p2[2], p3[2], t, t2, t3)
    ];
  }
  /** sample a Catmull-Rom spline through pts[] at fractional index fi (clamped ends) */
  function splineAt(pts, fi) {
    const n = pts.length;
    if (n === 0) return [0, 0, 0];
    if (n === 1) return vcopy(pts[0]);
    // Outside the knots, extend the end tangent linearly. Cubic extrapolation
    // diverges within a knot or two and folds the surface it is carrying.
    if (fi < 0) {
      const a = pts[0], b = pts[1];
      return [a[0] + (b[0] - a[0]) * fi, a[1] + (b[1] - a[1]) * fi, a[2] + (b[2] - a[2]) * fi];
    }
    if (fi > n - 1) {
      const a = pts[n - 1], b = pts[n - 2], k = fi - (n - 1);
      return [a[0] + (a[0] - b[0]) * k, a[1] + (a[1] - b[1]) * k, a[2] + (a[2] - b[2]) * k];
    }
    const i = clamp(Math.floor(fi), 0, n - 2);
    const t = clamp01(fi - i);
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    return crV(p0, p1, p2, p3, t);
  }
  /** scalar version of splineAt */
  function splineAtS(vals, fi) {
    const n = vals.length;
    if (n === 0) return 0;
    if (n === 1) return vals[0];
    const i = clamp(Math.floor(fi), 0, n - 2);
    const t = clamp01(fi - i);
    return crS(vals[Math.max(0, i - 1)], vals[i], vals[i + 1], vals[Math.min(n - 1, i + 2)], t);
  }
  /** convert a value to a fractional index within a monotone knot array */
  function knotIndex(knots, v) {
    const n = knots.length;
    if (v <= knots[0]) return (v - knots[0]) / (knots[1] - knots[0]);
    if (v >= knots[n - 1]) return n - 1 + (v - knots[n - 1]) / (knots[n - 1] - knots[n - 2]);
    for (let i = 0; i < n - 1; i++) {
      if (v <= knots[i + 1]) return i + (v - knots[i]) / (knots[i + 1] - knots[i]);
    }
    return n - 1;
  }

  /** piecewise-linear profile lookup: stops = [[x,y],...] sorted by x */
  function profile(stops, x) {
    const n = stops.length;
    if (x <= stops[0][0]) return stops[0][1];
    if (x >= stops[n - 1][0]) return stops[n - 1][1];
    for (let i = 0; i < n - 1; i++) {
      if (x <= stops[i + 1][0]) {
        const t = inv(x, stops[i][0], stops[i + 1][0]);
        return lerp(stops[i][1], stops[i + 1][1], smoothstep(t));
      }
    }
    return stops[n - 1][1];
  }

  /**
   * Closest approach between two 3-D segments. Returns the parameters on each
   * and the distance. Degenerate cases fall back to a point-on-segment solve.
   */
  function closestSeg(p1, q1, p2, q2) {
    const d1 = vsub(q1, p1), d2 = vsub(q2, p2), r = vsub(p1, p2);
    const a = vdot(d1, d1), e = vdot(d2, d2), f = vdot(d2, r), c = vdot(d1, r), b = vdot(d1, d2);
    let s = 0, t = 0;
    const den = a * e - b * b;
    if (den > 1e-9) s = clamp((b * f - c * e) / den, 0, 1);
    t = (b * s + f) / (e || 1);
    if (t < 0) { t = 0; s = clamp(-c / (a || 1), 0, 1); }
    else if (t > 1) { t = 1; s = clamp((b - c) / (a || 1), 0, 1); }
    const P1 = vmad(p1, d1, s), P2 = vmad(p2, d2, t);
    return { s, t, P1, P2, d: vdist(P1, P2) };
  }

  // -------------------------------------------------------------- 2-D polyline
  /** total length of a 2-D polyline */
  function polyLen(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  }
  /** resample a 2-D polyline to (roughly) even spacing */
  function resample(pts, spacing) {
    if (pts.length < 2) return pts.slice();
    const out = [pts[0]];
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const seg = Math.hypot(dx, dy);
      if (seg < 1e-9) continue;
      let d = spacing - carry;
      while (d <= seg) {
        const t = d / seg;
        out.push([a[0] + dx * t, a[1] + dy * t]);
        d += spacing;
      }
      carry = seg - (d - spacing);
    }
    const last = pts[pts.length - 1];
    const tail = out[out.length - 1];
    if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > spacing * 0.35) out.push(last);
    return out;
  }
  /** Chaikin corner-cutting; keeps endpoints */
  function chaikin(pts, iters = 1) {
    let p = pts;
    for (let k = 0; k < iters; k++) {
      if (p.length < 3) break;
      const out = [p[0]];
      for (let i = 0; i < p.length - 1; i++) {
        const a = p[i], b = p[i + 1];
        out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
        out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      out.push(p[p.length - 1]);
      p = out;
    }
    return p;
  }
  /** point-in-polygon, even-odd */
  function pointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  /** axis-aligned bounds of a 2-D point list */
  function bounds2(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    return [x0, y0, x1, y1];
  }

  GK.math = {
    TAU, DEG, clamp, clamp01, lerp, mix, inv, remap, smoothstep, smootherstep, sstep, sign, ease,
    mulberry32, Rng, Noise,
    v3, vadd, vsub, vmul, vmad, vdot, vcross, vlen, vdist, vnorm, vlerp, vcopy, vframe,
    IDENT, mApply, mMul, rotX, rotY, rotZ, mOrtho,
    crS, crV, splineAt, splineAtS, knotIndex, profile, closestSeg,
    polyLen, resample, chaikin, pointInPoly, bounds2
  };
})(window.GK = window.GK || {});
