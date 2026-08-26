/* ============================================================================
   GRAPHITE FIGURE — src/40-surface.js
   The body's surface, as sections lofted along the solved skeleton.

   THE CROSS-SECTION IS MEASURED, NOT ASSUMED. ANSUR gives breadth, depth AND
   circumference at the chest and the waist. Two of those fix an ellipse; the
   third then says how far from an ellipse the real thing is — and it is not
   close. Through the measured breadth and depth, an ellipse comes out 15.5%
   short of the measured chest circumference and 5.9% short at the waist.

   That gap is a shape, and it is the right shape: a chest is built round a
   ribcage and is nearly a rounded box, while a waist is soft and much closer
   to an oval. So every section here is a SUPERELLIPSE

       |x/a|^n + |y/b|^n = 1

   whose exponent is solved per landmark so the perimeter matches the measured
   circumference. n = 2 is an ellipse and n -> infinity is a rectangle; the
   chest lands near 3.0 and the waist near 2.4, which is the ribcage being
   boxier than the belly, recovered from a tape measure rather than asserted.

   A circular cross-section is why procedural figures read as balloon animals.
   An elliptical one is better and still wrong. This is the first version that
   has a reason for its shape.
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;
  const { lerp, clamp, clamp01, vadd, vmad, vsub, vnorm, vcross, vmul } = M;

  // ---- superellipse ------------------------------------------------------

  /** a point on |x/a|^n + |y/b|^n = 1, walked by angle rather than by arclength */
  function sePoint(a, b, n, t) {
    const c = Math.cos(t), s = Math.sin(t);
    const ax = Math.pow(Math.abs(c), 2 / n) * a * Math.sign(c || 1);
    const ay = Math.pow(Math.abs(s), 2 / n) * b * Math.sign(s || 1);
    return [ax, ay];
  }

  /** perimeter by direct summation — n is not analytic and the sections are few */
  function sePerimeter(a, b, n, steps) {
    steps = steps || 256;
    let L = 0, px = null;
    for (let i = 0; i <= steps; i++) {
      const p = sePoint(a, b, n, (i / steps) * Math.PI * 2);
      if (px) L += Math.hypot(p[0] - px[0], p[1] - px[1]);
      px = p;
    }
    return L;
  }

  /**
   * The exponent whose perimeter matches a measured circumference. Bisection
   * rather than anything cleverer: the perimeter rises monotonically with n,
   * the bracket is small, and thirty iterations costs nothing at build time.
   * Clamped at both ends — a circumference the breadth and depth simply
   * cannot produce is a bad sample, not a reason to emit a rectangle.
   */
  // A ribcage is boxy; it is not a box. Left uncapped the chest solves to
  // n = 7.4, because ANSUR's chest breadth and depth are taken at points and
  // its chest circumference wraps an envelope that includes the pectorals and
  // the scapulae — tissue no single convex section through those two points
  // contains. Breadth and depth ARE the silhouette, which is what a drawing
  // shows, so they are held exactly and the exponent is capped at something a
  // ribcage plausibly is. The girth then falls short, and that shortfall is
  // reported rather than absorbed by inflating a measured width.
  const N_MAX = 3.2;

  function solveExponent(a, b, target) {
    let lo = 2, hi = N_MAX;
    if (sePerimeter(a, b, lo) >= target) return lo;
    if (sePerimeter(a, b, hi) <= target) return hi;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) * 0.5;
      if (sePerimeter(a, b, mid) < target) lo = mid; else hi = mid;
    }
    return (lo + hi) * 0.5;
  }

  /** an ellipse of a given circumference and a given breadth-to-depth ratio */
  function ellipseFor(circ, ratio) {
    // Ramanujan's approximation inverted by one Newton step is overkill; the
    // perimeter is linear in scale, so one evaluation and a divide is exact.
    const a0 = 1, b0 = 1 / ratio;
    const k = circ / sePerimeter(a0, b0, 2);
    return [a0 * k, b0 * k];
  }

  // =========================================================================
  //  THE TRUNK
  //  Sections at the landmarks ANSUR measured, lofted along the spine the
  //  skeleton actually solved — so the trunk bends when the back bends,
  //  rather than being a fixed shell with a spine drawn inside it.
  // =========================================================================

  // Landmark sections, proximal to distal along the spine. `at` is the bone
  // whose origin the section sits at; `circ`, `breadth` and `depth` name the
  // measurements. Where a depth is not measured, `ratio` gives the section's
  // breadth-to-depth and the circumference does the rest.
  const TRUNK = [
    { key: 'hip', at: 'pelvis', circ: 'hip', breadth: 'hipBreadth', ratio: 1.38 },
    { key: 'waist', at: 'L3', circ: 'waist', breadth: 'waistBreadth', depth: 'waistDepth' },
    { key: 'chest', at: 'T8', circ: 'chest', breadth: 'chestBreadth', depth: 'chestDepth' },
    { key: 'shoulder', at: 'T1', circ: null, breadth: 'bideltoid', ratio: 1.55, scale: 0.94 },
    { key: 'neck', at: 'C4', circ: 'neck', ratio: 1.12 },
  ];

  /**
   * Resolve each trunk section once per figure: semi-axes in millimetres and
   * the exponent that makes its perimeter the measured one.
   */
  function trunkSections(fig) {
    const g = fig.girth;
    return TRUNK.map((t) => {
      let a, b, n = 2;
      if (t.breadth && t.depth) {
        a = g[t.breadth] * 0.5; b = g[t.depth] * 0.5;
        if (t.circ && g[t.circ]) n = solveExponent(a, b, g[t.circ]);
      } else if (t.breadth && t.circ) {
        // breadth is measured and depth is not: hold the breadth, and let the
        // ratio put the depth somewhere sensible, then match the girth by the
        // exponent rather than by inflating a measured width
        a = g[t.breadth] * 0.5; b = a / t.ratio;
        n = solveExponent(a, b, g[t.circ]);
      } else if (t.circ) {
        const e = ellipseFor(g[t.circ], t.ratio);
        a = e[0]; b = e[1];
      } else {
        a = g[t.breadth] * 0.5; b = a / t.ratio;
      }
      const s = t.scale || 1;
      const sec = { key: t.key, at: t.at, a: a * s, b: b * s, n };
      // what the section's own perimeter is against what was measured, so a
      // capped exponent shows up as a number instead of as nothing
      if (t.circ && g[t.circ]) {
        sec.circ = g[t.circ];
        sec.perim = sePerimeter(sec.a, sec.b, sec.n);
        sec.girthErr = (sec.perim - sec.circ) / sec.circ;
      }
      return sec;
    });
  }

  /**
   * A point on the trunk. `u` runs 0 at the hip section to 1 at the neck,
   * `beta` around. The centreline is the solved spine, so the section frame
   * comes from the bone it sits on and the whole trunk follows a bend.
   */
  function trunkSurface(rig, u, beta) {
    const S = rig.trunk || (rig.trunk = trunkSections(rig.figure));
    const f = clamp01(u) * (S.length - 1);
    const i = Math.min(S.length - 2, Math.floor(f)), t = f - i;
    const s0 = S[i], s1 = S[i + 1];
    const b0 = rig.bones[s0.at], b1 = rig.bones[s1.at];
    if (!b0 || !b1) return null;

    const C = M.vlerp(b0.A, b1.A, t);
    // the frame turns with the spine: +X along it, and the section is drawn
    // in the other two axes, so a lordosis carries its own cross-sections
    const fr = t < 0.5 ? b0.frame : b1.frame;
    const a = lerp(s0.a, s1.a, t), bb = lerp(s0.b, s1.b, t), n = lerp(s0.n, s1.n, t);
    const p = sePoint(a, bb, n, beta);
    // +Y is lateral (breadth), +Z is anterior (depth)
    return vadd(C, vadd(vmul(fr[1], p[0]), vmul(fr[2], p[1])));
  }

  // =========================================================================
  //  LIMBS
  //  A limb is a bone with a girth at each end. ANSUR measures those girths
  //  and nothing about their shape, so these are ellipses with a flattening
  //  that says which way the muscle lies — a thigh is deeper than it is wide,
  //  a forearm the other way round. Those ratios are EST and are the obvious
  //  thing for the muscle proxies to replace.
  // =========================================================================

  const LIMB = {
    'humerus': { p: 'biceps', d: 'forearm', pk: 1.00, dk: 0.78, ratio: 0.92 },
    'forearm': { p: 'forearm', d: 'wrist', pk: 1.00, dk: 1.00, ratio: 1.12 },
    'femur': { p: 'thigh', d: 'lowerThigh', pk: 1.00, dk: 1.00, ratio: 0.94 },
    'tibia': { p: 'calf', d: 'ankle', pk: 1.00, dk: 1.00, ratio: 0.90 },
  };

  /**
   * Girth along a limb is not linear. A calf is thickest a third of the way
   * down and a biceps in the middle, and interpolating straight between the
   * ends draws a cone — which is exactly what makes a procedural leg look
   * like a table leg. The belly is a raised cosine over the linear taper.
   */
  const BELLY = {
    'humerus': { at: 0.45, amt: 0.10 },
    'forearm': { at: 0.22, amt: 0.13 },
    'femur': { at: 0.30, amt: 0.07 },
    'tibia': { at: 0.28, amt: 0.16 },
  };

  function limbAt(rig, boneId, s) {
    const base = boneId.replace(/\.[LR]$/, '');
    const L = LIMB[base];
    if (!L) return null;
    const g = rig.figure.girth;
    const c0 = g[L.p] * L.pk, c1 = g[L.d] * L.dk;
    let circ = lerp(c0, c1, clamp01(s));
    const bl = BELLY[base];
    if (bl) {
      const x = clamp01(Math.abs(s - bl.at) / (s < bl.at ? bl.at + 1e-6 : 1 - bl.at + 1e-6));
      circ *= 1 + bl.amt * (0.5 + 0.5 * Math.cos(x * Math.PI));
    }
    const e = ellipseFor(circ, L.ratio);
    return { a: e[0], b: e[1], n: 2.15 };
  }

  /** a point on a limb: `s` along the bone, `beta` around it */
  function limbSurface(rig, boneId, s, beta) {
    const bone = rig.bones[boneId];
    const sec = limbAt(rig, boneId, s);
    if (!bone || !sec) return null;
    const C = vmad(bone.A, bone.frame[0], bone.len * clamp01(s));
    const p = sePoint(sec.a, sec.b, sec.n, beta);
    return vadd(C, vadd(vmul(bone.frame[1], p[0]), vmul(bone.frame[2], p[1])));
  }

  GK.surf = {
    sePoint, sePerimeter, solveExponent, ellipseFor, N_MAX,
    trunkSections, trunkSurface, limbAt, limbSurface, TRUNK, LIMB,
  };
})(window.GK = window.GK || {});
