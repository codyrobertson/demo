/* ============================================================================
   GRAPHITE FIGURE — src/05-trace.js
   The coverage tracer: turn an ordered stack of already-projected
   cross-sections into the outline of everything they cover.

   Lifted from graphite-kinematics' digitSilhouette, where fillTri and
   traceBorder below were proved on a hand's digits. Building the rings - a
   body part's own surface parametrisation, walked ring by ring and
   projected to the screen - stays the caller's job, one per body part, the
   same way it always was; everything from "here is a stack of rings" to
   "here is its outline" is body-part-agnostic, so it moves here once
   instead of being re-solved per limb.
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;
  const { lerp } = M;

  // =========================================================================
  //  THE OUTLINE OF A FORM, TRACED FROM ITS OWN COVERAGE
  //
  //  Every other way of finding a silhouette starts from a cross-section and
  //  asks which way round it faces. That works while a limb runs across the
  //  picture and stops working the moment it turns to point at the eye: the
  //  two answers per section swing round and meet, so the rails spiral
  //  inward instead of ending on an edge, the tip has to be patched in from
  //  a second construction, and the patch and the rails then disagree about
  //  where the form's edge is. Cross-fading between constructions cannot fix
  //  that, because there is no view in which both are right.
  //
  //  A silhouette is the boundary of what the form covers. So cover it: fill
  //  the form's whole surface into a small mask, close the pinholes, and
  //  walk the border. One closed curve, joined by construction, correct from
  //  any direction, and with no assumption anywhere that the projection is
  //  star-shaped, convex, or longer than it is wide. The cost is a raster
  //  step per form, which at this size is a few hundred microseconds.
  // =========================================================================

  /** scanline-fill one triangle into a coverage/depth/owner mask */
  function fillTri(m, ax, ay, az, ag, bx, by, bz, bg, cx, cy, cz, cg, owner) {
    const W = m.w, H = m.h;
    let y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    let y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    let x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    let x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
    if (y1 < y0 || x1 < x0) return;
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-12) return;
    // The four coefficients below are affine in (px, py), so they are the
    // same at every pixel this triangle covers and do not belong inside the
    // loop that visits them - the same hoist any barycentric rasteriser
    // needs, and for the same reason: l1 and l2 are affine in (px, py), so
    // recomputing their pieces per pixel would be paying for an invariant.
    // The division by `d` stays a division, done once per pixel exactly
    // where it always was - turning it into a multiply by a precomputed 1/d
    // would change the rounding of every l1 and l2 in the mask by a bit
    // that never shows on a smoothed, resampled silhouette, but "never
    // shows" is not the bar this file holds itself to, so it is left a
    // division.
    const A1 = by - cy, B1 = cx - bx;
    const A2 = cy - ay, B2 = ax - cx;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5, dpy = py - cy;
      const rowB1 = B1 * dpy, rowB2 = B2 * dpy;
      const row = y * W;
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, dpx = px - cx;
        const l1 = (A1 * dpx + rowB1) / d;
        if (l1 < -0.002) continue;
        const l2 = (A2 * dpx + rowB2) / d;
        if (l2 < -0.002) continue;
        const l3 = 1 - l1 - l2;
        if (l3 < -0.002) continue;
        const zz = l1 * az + l2 * bz + l3 * cz;
        const i = row + x;
        if (!m.cov[i] || zz > m.dep[i]) {
          m.dep[i] = zz; m.own[i] = owner;
          m.gn[i] = l1 * ag + l2 * bg + l3 * cg;
        }
        m.cov[i] = 1;
      }
    }
  }

  /**
   * Walk the border of a filled mask, Moore-neighbourhood, once round.
   *
   * Returns cell coordinates in order, once round.
   */
  function traceBorder(m) {
    const W = m.w, H = m.h, cov = m.cov;
    let sx = -1, sy = -1;
    for (let y = 0; y < H && sy < 0; y++) {
      for (let x = 0; x < W; x++) if (cov[y * W + x]) { sx = x; sy = y; break; }
    }
    if (sy < 0) return null;
    const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : cov[y * W + x];
    const out = [];
    let cxi = sx, cyi = sy, dir = 6, guard = W * H * 4;
    while (guard-- > 0) {
      out.push([cxi, cyi]);
      // the first neighbour clockwise from where we came in
      let nx = 0, ny = 0, nd = 0, found = false;
      const from = (dir + 6) % 8;
      for (let k = 0; k < 8; k++) {
        const t = (from + k) % 8;
        const ax = cxi + DX[t], ay = cyi + DY[t];
        if (at(ax, ay)) { nx = ax; ny = ay; nd = t; found = true; break; }
      }
      if (!found) break;
      // Jacob's criterion: back at the start and about to repeat the first
      // step, so the loop is closed. Testing the start cell alone would cut
      // it short at any one-cell isthmus; testing arrival direction alone
      // walks the whole border twice.
      if (out.length > 2 && cxi === sx && cyi === sy && nx === out[1][0] && ny === out[1][1]) {
        out.pop();
        break;
      }
      cxi = nx; cyi = ny; dir = nd;
    }
    return out.length > 8 ? out : null;
  }

  /**
   * The outline of a form, as the border of everything its cross-sections
   * cover.
   *
   * `rings` is an ordered stack of already-projected cross-sections, walking
   * once around each: [{ row: [[x, y, near, gain], ...], id }, ...], every
   * row the same length. Consecutive rings are stitched into quads and
   * rasterised into a small mask; `id` marks which solid a ring's coverage
   * belongs to and is carried straight onto the id of every output point it
   * wins, so a caller doing a depth test downstream can skip the solid a
   * line is the silhouette of.
   *
   * `use: false` only when the stack rasterises to nothing at all. Points
   * carry screen position, the near-depth of the surface that put them
   * there, that id, and a weight.
   */
  function traceCoverage(rings, opts) {
    opts = opts || {};
    if (!rings || !rings.length) return { use: false };
    // na and ns - points per ring, rings per segment - shaped the rings
    // themselves, so they have nothing left to do once the rings arrive
    // already built; the ring width is a fact about the data now, not a
    // separate option. n, smooth and tap still govern the walk from here.
    const NA = rings[0].row.length;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const r of rings) for (const p of r.row) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    if (!(x1 > x0) || !(y1 > y0)) return { use: false };
    // A cell fine enough that the border is smooth after filtering, and a
    // two-cell margin so the closing pass has room to work in.
    const cell = Math.max(0.6, Math.min(2.2, (x1 - x0 + y1 - y0) * 0.5 / 150));
    const PAD = 3;
    const W = Math.ceil((x1 - x0) / cell) + PAD * 2;
    const H = Math.ceil((y1 - y0) / cell) + PAD * 2;
    if (W < 6 || H < 6 || W * H > 4e6) return { use: false };
    const m = {
      w: W, h: H, cov: new Uint8Array(W * H),
      dep: new Float32Array(W * H), own: new Int16Array(W * H),
      gn: new Float32Array(W * H),
    };
    // own[] defaults to 0, and the pinhole pass below can mark a cell
    // covered without any triangle ever having written its owner - so an
    // unclaimed cell must default to a ring's real id, not to whatever a
    // typed array happens to zero-fill with. digitSilhouette got this for
    // free, because its raw owner was a per-digit segment index and 0 was
    // always a valid one; a caller's id has no such reserved value (ring
    // ids that never happen to include 0 would otherwise leak a bogus
    // owner at every seam a pixel was never actually painted on).
    m.own.fill(rings[0].id);
    const gx = (px) => (px - x0) / cell + PAD, gy = (py) => (py - y0) / cell + PAD;
    for (let r = 0; r + 1 < rings.length; r++) {
      const a = rings[r], b = rings[r + 1];
      const owner = a.id;
      for (let k = 0; k < NA; k++) {
        const k2 = (k + 1) % NA;
        const p0 = a.row[k], p1 = a.row[k2], p2 = b.row[k2], p3 = b.row[k];
        fillTri(m, gx(p0[0]), gy(p0[1]), p0[2], p0[3], gx(p1[0]), gy(p1[1]), p1[2], p1[3],
          gx(p2[0]), gy(p2[1]), p2[2], p2[3], owner);
        fillTri(m, gx(p0[0]), gy(p0[1]), p0[2], p0[3], gx(p2[0]), gy(p2[1]), p2[2], p2[3],
          gx(p3[0]), gy(p3[1]), p3[2], p3[3], owner);
      }
    }
    // Close the pinholes a quad mesh leaves along its own seams, so the walk
    // follows the outside of the form and not the inside of a crack.
    {
      const t = new Uint8Array(m.cov);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (t[i]) continue;
        if (t[i - 1] && t[i + 1]) { m.cov[i] = 1; continue; }
        if (t[i - W] && t[i + W]) m.cov[i] = 1;
      }
    }
    const border = traceBorder(m);
    if (!border) return { use: false };
    // Back to pixels, then filtered: a walk over cells is a staircase, and a
    // staircase drawn with a pencil is a burr on every step.
    let pts = border.map(([bx, by]) => [(bx - PAD + 0.5) * cell + x0, (by - PAD + 0.5) * cell + y0]);
    // A tap for tools that want to see the construction rather than its
    // result: the coverage mask, and the staircase before it is filtered.
    // Off the hot path entirely - nothing here runs unless one is passed.
    if (opts.tap) opts.tap({ cell, x0, y0, pad: PAD, w: W, h: H, cov: m.cov, own: m.own, raw: pts.map(q => q.slice()) });
    const N = pts.length;
    for (let pass = 0; pass < (opts.smooth === undefined ? 4 : opts.smooth); pass++) {
      const src = pts;
      pts = new Array(N);
      for (let i = 0; i < N; i++) {
        const a = src[(i - 1 + N) % N], b = src[i], c = src[(i + 1) % N];
        pts[i] = [(a[0] + b[0] * 2 + c[0]) * 0.25, (a[1] + b[1] * 2 + c[1]) * 0.25];
      }
    }
    // Resample by arclength: the walk clusters points on the diagonals.
    const cum = [0];
    for (let i = 1; i <= N; i++) {
      const a = pts[i - 1], b = pts[i % N];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[N];
    if (!(total > 1)) return { use: false };
    // one point every few pixels: fine enough that a chord never shows on
    // the tightest curvature the form presents, coarse enough that the
    // depth test isn't run hundreds of times per form for nothing.
    const NP = Math.max(64, Math.min(opts.n || 400, Math.round(total / 4)));
    // Two things pull the walk inside the form it is tracing: it runs on cell
    // centres, half a cell in, and every smoothing pass shortens a convex
    // curve a little more. Both are known, so push the whole loop back out
    // along its own normal rather than leaving the drawing a hair narrow.
    {
      let area = 0;
      for (let i = 0; i < N; i++) {
        const a = pts[i], b = pts[(i + 1) % N];
        area += a[0] * b[1] - b[0] * a[1];
      }
      const sgn = area > 0 ? 1 : -1;
      const off = cell * 1.15;
      const src = pts;
      pts = new Array(N);
      for (let i = 0; i < N; i++) {
        const a = src[(i - 1 + N) % N], b = src[i], c = src[(i + 1) % N];
        const tx = c[0] - a[0], ty = c[1] - a[1];
        const L = Math.hypot(tx, ty);
        if (L < 1e-9) { pts[i] = b; continue; }
        pts[i] = [b[0] + (ty / L) * off * sgn, b[1] - (tx / L) * off * sgn];
      }
    }
    const out = [];
    let j = 0;
    const sample = (px, py) => {
      const cx2 = Math.round(gx(px)), cy2 = Math.round(gy(py));
      for (let rad = 0; rad < 4; rad++) {
        for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
          if (rad > 0 && Math.abs(dx) !== rad && Math.abs(dy) !== rad) continue;
          const xx = cx2 + dx, yy = cy2 + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const i = yy * W + xx;
          if (m.cov[i]) return [m.dep[i], m.own[i], m.gn[i]];
        }
      }
      return [0, rings[0].id, 1];
    };
    for (let i = 0; i <= NP; i++) {
      const want = (i / NP) * total;
      while (j < N && cum[j + 1] < want) j++;
      const a = pts[j % N], b = pts[(j + 1) % N];
      const seg = Math.max(1e-9, cum[j + 1] - cum[j]);
      const t = Math.max(0, Math.min(1, (want - cum[j]) / seg));
      const px = lerp(a[0], b[0], t), py = lerp(a[1], b[1], t);
      const [dz, own, gn] = sample(px, py);
      out.push([px, py, dz, own, gn]);
    }
    if (opts.tap) opts.tap({ final: out });
    return { use: true, outline: out, area: total };
  }

  GK.trace = { traceCoverage, fillTri, traceBorder };
})(window.GK = window.GK || {});
