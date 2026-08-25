/* ============================================================================
   GRAPHITE FIGURE — src/20-build.js
   buildFigure(seed) grows one body: resolved bone lengths in millimetres, the
   offsets that scale with build rather than with height, and the weights that
   say how a group rotation is shared out along a chain.

   PROVISIONAL SOURCE. The measurement tables below are Winter's segment
   lengths as fractions of stature (Biomechanics and Motor Control of Human
   Movement, seg. table), which are the numbers every figure text ultimately
   quotes. They live here only until src/00-refdata.js lands with sourced
   values and real population variance; buildFigure() already prefers GK.ref
   when it is present, so that swap is a deletion rather than a rewrite.
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;
  const { lerp, clamp } = M;

  // fractions of stature, proximal joint to distal joint unless noted
  const FRAC = {
    pelvis: 0.030,        // sacral promontory up to the base of L5
    lumbarSeg: 0.0200,    // 5 of them: 0.100 total
    thoracicSeg: 0.01317, // 12: 0.158
    cervicalSeg: 0.00743, // 7: 0.052
    skull: 0.130,         // chin to vertex
    clavicle: 0.105,
    scapula: 0.050,       // acromioclavicular out to the glenoid
    humerus: 0.186,       // acromion to lateral epicondyle
    forearm: 0.146,       // epicondyle to radial styloid
    femur: 0.245,         // greater trochanter to knee joint line
    tibia: 0.246,         // knee to lateral malleolus
    foot: 0.152,          // length, running forward from the ankle
  };

  // Half-widths, also as fractions of stature. These are the ones that carry
  // build rather than height: two people of the same stature differ far more
  // across the shoulders and the pelvis than they do along the femur.
  const HALF = { hip: 0.052, sc: 0.000, scDrop: -0.012, scFwd: 0.045 };

  /**
   * How a group rotation is shared out along a chain. These are not equal
   * splits and must not be: a lumbar spine flexed uniformly reads as a hose,
   * because the real thing bends most at L4-L5 and barely at all at L1.
   * Axial rotation is the opposite way round — the lumbar facets are oriented
   * to prevent it and the thoracic ones allow it, so a trunk twist that runs
   * through the low back is anatomically impossible and looks it.
   */
  function weights() {
    const g = {};
    const put = (ids, axis, w) => {
      const sum = w.reduce((a, b) => a + b, 0);
      ids.forEach((id, i) => {
        g[id] = g[id] || {};
        g[id][axis] = w[i] / sum;
      });
    };
    const L = ['L5', 'L4', 'L3', 'L2', 'L1'];
    put(L, 'flex', [0.28, 0.24, 0.20, 0.16, 0.12]);
    put(L, 'abd', [0.22, 0.22, 0.22, 0.18, 0.16]);
    put(L, 'twist', [0.20, 0.20, 0.20, 0.20, 0.20]);   // and the group value is tiny

    const T = [];
    for (let i = 12; i >= 1; i--) T.push('T' + i);
    put(T, 'flex', T.map((_, i) => 0.6 + 0.6 * (i / 11)));   // more range up the chest
    put(T, 'abd', T.map(() => 1));
    put(T, 'twist', T.map((_, i) => 1.4 - 0.8 * (i / 11)));  // most axial low, at T1-T4 least

    const C = [];
    for (let i = 7; i >= 1; i--) C.push('C' + i);
    put(C, 'flex', C.map(() => 1));
    put(C, 'abd', C.map(() => 1));
    // roughly half of cervical axial rotation happens at C1-C2 alone; spread
    // it evenly and the neck turns like a hose instead of like a neck
    put(C, 'twist', [0.6, 0.6, 0.7, 0.8, 0.9, 1.0, 4.4]);

    for (const s of ['L', 'R']) {
      for (const b of ['clavicle', 'scapula', 'humerus', 'forearm', 'femur', 'tibia', 'foot']) {
        g[b + '.' + s] = { flex: 1, abd: 1, twist: 1 };
      }
    }
    return g;
  }

  /**
   * Build is one number rather than a per-segment perturbation, plus a small
   * independent wobble on top. Perturbing every segment on its own produces
   * bodies that do not exist: real limb segments co-vary with stature much
   * more tightly than trunk breadths do, so a figure with a long femur and a
   * short tibia is not a rare person, it is a wrong one.
   */
  function buildFigure(seed, opts) {
    opts = opts || {};
    const rng = new M.Rng(seed ^ 0x5f37);
    const ref = GK.ref || null;

    const stature = opts.stature || lerp(1560, 1900, rng.gaussIn(0.5, 0.16, 0, 1));
    // one axis from light and narrow to heavy and broad, and one from
    // long-limbed to short-limbed; both are real and they are not the same
    const heft = rng.gaussIn(0.5, 0.19, 0, 1);
    const limb = rng.gaussIn(0.5, 0.15, 0, 1);

    const len = {};
    for (const k in FRAC) {
      const isLimb = /humerus|forearm|femur|tibia/.test(k);
      const f = FRAC[k] * (isLimb ? lerp(0.955, 1.045, limb) : 1)
        * lerp(0.992, 1.008, rng.f());     // the residual, which is small
      len[k] = f * stature;
    }

    const hipHalf = HALF.hip * lerp(0.90, 1.14, heft) * stature;
    const at = {
      hip: [-FRAC.pelvis * stature, hipHalf, 0],
      sc: [HALF.scDrop * stature, 0, HALF.scFwd * stature],
    };

    const fig = {
      seed, stature, heft, limb, len, at, groups: weights(),
      // biacromial breadth is carried by the clavicle's length rather than
      // by an offset, so broad shoulders are a longer collarbone — which is
      // what they anatomically are
      ref,
    };
    fig.len.clavicle *= lerp(0.93, 1.10, heft);
    return fig;
  }

  GK.figure = { buildFigure, FRAC, HALF, weights };
})(window.GK = window.GK || {});
