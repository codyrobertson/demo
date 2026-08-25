/* ============================================================================
   GRAPHITE KINEMATICS — 60 · render
   Curves in surface space become graphite on paper. Back-facing runs fade over
   the horizon; occluded runs are not deleted but ghosted, the way a draughtsman
   leaves construction visible beneath the finished line.
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math;
  const AN = GK.anatomy;
  const RG = GK.rig;
  const F = GK.features;
  const D = GK.dorsal;
  const PEN = GK.pencil;
  const { TAU, DEG, clamp, clamp01, lerp, smoothstep } = M;
  const { vadd, vsub, vmul, vmad, vdot, vnorm } = M;

  // =========================================================================
  //  DEPTH FIELD
  //  Two peeled layers, each carrying the identity of the part that wrote it.
  //  Identity is what makes the test honest: a silhouette must never be
  //  occluded by the solid it is the silhouette *of*, and without an id the
  //  only way to prevent that is to shrink every part until its contact edges
  //  leak. With an id, self is simply skipped and nothing has to be shrunk.
  // =========================================================================
  class DepthField {
    constructor(w, h, div) {
      this.div = div || 2;
      this.w = Math.ceil(w / this.div); this.h = Math.ceil(h / this.div);
      const n = this.w * this.h;
      this.z0 = new Float32Array(n); this.i0 = new Int16Array(n);
      this.z1 = new Float32Array(n); this.i1 = new Int16Array(n);
      this.clear();
    }
    clear() {
      this.z0.fill(-1e18); this.z1.fill(-1e18);
      this.i0.fill(-1); this.i1.fill(-1);
      return this;
    }
    /** rasterise a triangle owned by part `id`, peeling two layers */
    tri(ax, ay, az, bx, by, bz, cx, cy, cz, id) {
      const d = this.div, W = this.w, H = this.h;
      const z0 = this.z0, i0 = this.i0, z1 = this.z1, i1 = this.i1;
      ax /= d; ay /= d; bx /= d; by /= d; cx /= d; cy /= d;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      if (x1 < x0 || y1 < y0) return;
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-12) return;
      const iden = 1 / den;
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const l0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) * iden;
          if (l0 < -0.003) continue;
          const l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) * iden;
          if (l1 < -0.003) continue;
          const l2 = 1 - l0 - l1;
          if (l2 < -0.003) continue;
          const zz = l0 * az + l1 * bz + l2 * cz;
          const i = y * W + x;
          if (zz > z0[i]) {
            if (i0[i] !== id) { z1[i] = z0[i]; i1[i] = i0[i]; }
            z0[i] = zz; i0[i] = id;
          } else if (id !== i0[i] && zz > z1[i]) {
            z1[i] = zz; i1[i] = id;
          }
        }
      }
    }
    quad(a, b, c, d, id) {
      this.tri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], id);
      this.tri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], id);
    }

    /** depth of the nearest surface at a cell, whoever wrote it */
    frontAny(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return -1e18;
      const i = cy * this.w + cx;
      return this.i0[i] === -1 ? -1e18 : this.z0[i];
    }

    /** depth of the nearest surface at a cell that is NOT part `id` */
    frontOther(cx, cy, id) {
      if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return -1e18;
      const i = cy * this.w + cx;
      if (this.i0[i] === -1) return -1e18;
      if (this.i0[i] !== id) return this.z0[i];
      return this.i1[i] === -1 ? -1e18 : this.z1[i];
    }

    /** local steepness of the depth field, in scene units per cell */
    slope(cx, cy) {
      const W = this.w, H = this.h, z = this.z0;
      if (cx < 1 || cy < 1 || cx >= W - 1 || cy >= H - 1) return 0;
      const i = cy * W + cx;
      const l = z[i - 1], r = z[i + 1], u = z[i - W], d = z[i + W];
      if (l < -1e17 || r < -1e17 || u < -1e17 || d < -1e17) return 0;
      return Math.max(Math.abs(r - l), Math.abs(d - u)) * 0.5;
    }

    /** slope(), addressed by screen pixel like behind() and stepBehind() rather than by cell */
    slopeAt(x, y) {
      return this.slope(Math.round(x / this.div - 0.5), Math.round(y / this.div - 0.5));
    }

    /**
     * How hidden is a point at (x, y) lying at depth z on part `id`?
     * Returns 0 (clear) .. 1 (buried), antialiased over the four cells the
     * sample straddles, with the tolerance widened where the depth field is
     * steep — which is exactly where a silhouette grazes and a fixed
     * tolerance would carve a halo out of the line.
     */
    hidden(x, y, z, id, tol, soft, includeSelf) {
      const fx = x / this.div - 0.5, fy = y / this.div - 0.5;
      const cx = Math.floor(fx), cy = Math.floor(fy);
      let acc = 0, wsum = 0;
      for (let j = 0; j <= 1; j++) {
        for (let i = 0; i <= 1; i++) {
          const gx = cx + i, gy = cy + j;
          const w = (i ? (fx - cx) : (1 - (fx - cx))) * (j ? (fy - cy) : (1 - (fy - cy)));
          if (w <= 0) continue;
          wsum += w;
          const zf = includeSelf ? this.frontAny(gx, gy) : this.frontOther(gx, gy, id);
          if (zf <= -1e17) continue;
          const t = tol + this.slope(gx, gy) * 1.6;
          acc += w * clamp01((zf - z - t) / soft);
        }
      }
      return wsum > 0 ? acc / wsum : 0;
    }

    /** how far in FRONT of a point the nearest other surface sits */
    behind(x, y, z, id) {
      const cx = Math.round(x / this.div - 0.5), cy = Math.round(y / this.div - 0.5);
      const zf = this.frontOther(cx, cy, id);
      return zf <= -1e17 ? 0 : Math.max(0, zf - z);
    }

    /**
     * The depth step a silhouette describes: how far BEHIND it the next
     * surface lies. Infinite when the line is drawn against nothing at all.
     * A contour is only as strong as the step it reports — where two forms
     * merge, the step is small and so is the line, which is the difference
     * between a thenar swelling into a palm and a cylinder laid on top of it.
     */
    stepBehind(x, y, z, id) {
      const cx = Math.round(x / this.div - 0.5), cy = Math.round(y / this.div - 0.5);
      const zf = this.frontOther(cx, cy, id);
      if (zf <= -1e17) return Infinity;
      const d = z - zf;
      return d > 0 ? d : Infinity;
    }
  }

  /**
   * Fill the depth field with every solid part of the hand, one identity per
   * rendered segment plus one for the palm. Parts are rasterised at very
   * nearly full size: with identities there is nothing to protect against.
   */
  function rasterise(rig, view, df, shrink, ids) {
    const A = rig.anatomy;
    shrink = shrink === undefined ? 0.965 : shrink;
    const NA = 20;
    for (let d = 0; d < 5; d++) {
      const dg = rig.digits[d];
      for (const sg of dg.segs) {
        if (!sg.rendered) continue;
        const id = ids.digit[d][sg.seg];
        const NS = sg.seg === dg.segs.length - 1 ? 11 : 8;
        let prev = null;
        for (let i = 0; i <= NS; i++) {
          const s = sg.sMin + (sg.sMax - sg.sMin) * (i / NS);
          const ring = [];
          for (let k = 0; k < NA; k++) {
            const a = (k / NA) * TAU;
            const q = RG.digitSurface(rig, d, sg.seg, s, a);
            const axis = vmad(sg.A, sg.t, sg.len * s);
            const P = M.vlerp(axis, q.P, shrink);
            const p = view.px(P);
            ring.push([p[0], p[1], view.near(P)]);
          }
          if (prev) for (let k = 0; k < NA; k++) {
            const k2 = (k + 1) % NA;
            df.quad(prev[k], prev[k2], ring[k2], ring[k], id);
          }
          prev = ring;
        }
      }
    }
    // The first web, as the wedge it actually is: a palmar face and a
    // dorsal face, plus a rim strip closing the free margin between them.
    // Rasterised as a bare mid-sheet this fills nothing from anywhere near
    // edge-on - a membrane projects to a sliver - which is why the thumb
    // used to read as a lump laid beside the hand rather than joined to it.
    {
      const w = RG.firstWeb(rig, view);
      const proj = (P) => { const p = view.px(P); return [p[0], p[1], view.near(P)]; };
      const NT = w.thSide.length - 1, NC = 6;
      for (const side of [1, -1]) {
        for (let i = 0; i < NT; i++) {
          const t0 = i / NT, t1 = (i + 1) / NT;
          for (let k = 0; k < NC; k++) {
            const k0 = k / NC, k1 = (k + 1) / NC;
            df.quad(proj(w.wedgeAt(t0, k0, side)), proj(w.wedgeAt(t0, k1, side)),
              proj(w.wedgeAt(t1, k1, side)), proj(w.wedgeAt(t1, k0, side)), ids.palm);
          }
        }
      }
      for (let k = 0; k < NC; k++) {
        const k0 = k / NC, k1 = (k + 1) / NC;
        df.quad(proj(w.wedgeAt(1, k0, 1)), proj(w.wedgeAt(1, k1, 1)),
          proj(w.wedgeAt(1, k1, -1)), proj(w.wedgeAt(1, k0, -1)), ids.palm);
      }
    }
    const NU = 30, NB = 36, id = ids.palm;
    const uTop = [];
    for (let k = 0; k <= NB; k++) {
      const beta = k / NB;
      const v = RG.palmSurface(rig, 1.0, beta).v;
      uTop.push(rig.palm.uDistal(v, beta < 0.5));
    }
    let prevRow = null;
    for (let i = 0; i <= NU; i++) {
      const row = [];
      for (let k = 0; k <= NB; k++) {
        const u = lerp(-0.42, uTop[k], i / NU);
        const s = RG.palmSurface(rig, u, k / NB);
        const P = M.vlerp(s.spine, s.P, shrink);
        const p = view.px(P);
        row.push([p[0], p[1], view.near(P)]);
      }
      if (prevRow) for (let k = 0; k < NB; k++) df.quad(prevRow[k], prevRow[k + 1], row[k + 1], row[k], id);
      prevRow = row;
    }
  }

  /** stable part identities: one per rendered segment, one for the palm */
  function buildIds(rig) {
    const ids = { palm: 0, digit: [] };
    let next = 1;
    for (let d = 0; d < 5; d++) {
      const row = [];
      for (const sg of rig.digits[d].segs) {
        row[sg.seg] = sg.rendered ? next++ : -1;
        sg.pid = row[sg.seg];
      }
      ids.digit.push(row);
    }
    rig.palm.pid = 0;
    ids.count = next;
    return ids;
  }

  // =========================================================================
  //  CURVE PROJECTION
  // =========================================================================

  /**
   * How much a mark should give way to graphite already down nearby — the
   * paper's own memory of what has already been drawn, read straight out of
   * the deposition field rather than inferred from geometry. Several
   * individually reasonable marks (a handful of named palm creases, a ring
   * of knuckle contour, a field of ridge texture) can each be exactly where
   * they belong and still converge, from one view, into the same few
   * screen pixels; nothing about any single one of them is wrong, so
   * nothing about any single one of them would flag it. What they share is
   * that the paper under them is getting dark, and that a hand notices.
   */
  function crowdGive(g, x, y) {
    if (!g) return 1;
    const ink = g.densityAt(x, y, 14);
    return 1 - 0.97 * smoothstep(clamp01((ink - 0.02) / 0.08));
  }

  /**
   * Turn a surface curve into screen points with per-point visibility.
   * vis combines the horizon fade with the occlusion test.
   */
  function projectCurve(rig, view, df, cv, opt) {
    const A = rig.anatomy;
    const n = cv.pts.length;
    const out = new Array(n);
    const eps = opt.eps === undefined ? 0.9 : opt.eps;
    const gap = opt.gap === undefined ? 2.2 : opt.gap;
    const ids = opt.ids;
    const myId = cv.on === 'digit' ? ids.digit[cv.d][cv.seg]
      : cv.on === 'palm' ? ids.palm : -1;
    let prevP = null, prevp = null;
    for (let i = 0; i < n; i++) {
      const q = cv.pts[i];
      let P, N = null;
      if (cv.on === 'digit') {
        const sp = RG.digitSurface(rig, cv.d, cv.seg, q[0], q[1]);
        N = RG.digitNormal(rig, cv.d, cv.seg, q[0], q[1]);
        P = q[2] ? vmad(sp.P, N, q[2]) : sp.P;
      } else if (cv.on === 'palm') {
        const sp = RG.palmSurface(rig, q[0], q[1]);
        N = RG.palmNormal(rig, q[0], q[1]);
        P = q[2] ? vmad(sp.P, N, q[2]) : sp.P;
      } else {
        P = q;
      }
      const p = view.px(P);
      const near = view.near(P);
      let vis = 1;
      if (N) {
        const f = vdot(N, view.e);
        // Fine detail compresses as it turns away and must be gone well
        // before the horizon, or every ridge on the far side stacks into a
        // black band along the silhouette.
        const h0 = opt.horizon === undefined ? 0.015 : opt.horizon;
        vis = smoothstep(clamp01((f - h0) / (h0 > 0.1 ? 0.34 : 0.22)));
        // Facing isn't the only way a surface compresses: a segment seen
        // close to end-on foreshortens along its whole LENGTH even where it
        // still faces the eye well around its girth, and every mark meant to
        // be spaced out along that length lands on the next one. Compare how
        // far this step actually moved on the page to how far it moved on
        // the surface — that ratio drops well before the facing test does,
        // in exactly this case, because it is sensitive to the direction of
        // the surface's motion and not just its tilt.
        if (prevP) {
          const dWorld = M.vdist(P, prevP);
          if (dWorld > 1e-6) {
            const dScreen = Math.hypot(p[0] - prevp[0], p[1] - prevp[1]);
            const mag = dScreen / (dWorld * view.scale);
            vis *= smoothstep(clamp01(mag / 0.85));
          }
        }
      }
      prevP = P; prevp = p;
      // The skeleton is construction, not surface: it is drawn through the
      // flesh that contains it, so it takes no occlusion test at all.
      if (cv.xray) { out[i] = [p[0], p[1], 1, near, 0]; continue; }
      // Facing and occlusion are different kinds of invisible and must not be
      // conflated. A mark on the far side of the surface is simply not in the
      // picture; a mark this side of it that another form covers is
      // construction, and construction is what gets ghosted.
      let hid = 0, behind = 0, give = 1;
      if (vis > 0.004) {
        hid = df.hidden(p[0], p[1], near, myId, eps, gap);
        behind = df.behind(p[0], p[1], near, myId);
        give = crowdGive(opt.g, p[0], p[1]);
      }
      const decay = Math.exp(-Math.max(0, behind - 2) / 11);
      out[i] = [p[0], p[1], vis * (1 - hid) * give, near, vis * hid * decay * give];
    }
    return out;
  }

  /** split a visibility-tagged polyline into runs above a threshold */
  /**
   * Split a visibility-tagged polyline into the runs worth drawing.
   * `idx` names which slot carries the visibility for this pass, so the same
   * point list can yield a finished run and a ghosted one without either
   * having to be inferred from the other.
   */
  function runs(pts, lo, idx, maxJump) {
    const res = [];
    let cur = null;
    const jump2 = maxJump ? maxJump * maxJump : 0;
    for (let i = 0; i < pts.length; i++) {
      if (jump2 && cur && i > 0) {
        const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
        if (dx * dx + dy * dy > jump2) cur = null;
      }
      const v = pts[i][idx];
      if (v > lo) {
        if (!cur) { cur = { pts: [], vis: [] }; res.push(cur); }
        cur.pts.push([pts[i][0], pts[i][1]]);
        cur.vis.push(v);
      } else if (cur) {
        // carry one fading point past the edge so the mark tapers out
        cur.pts.push([pts[i][0], pts[i][1]]); cur.vis.push(v * 0.5);
        cur = null;
      }
    }
    return res.filter(r => r.pts.length >= 2);
  }

  // =========================================================================
  //  RENDERER
  // =========================================================================
  // how far from the horizon each kind of mark gives up
  const FINE_LAYERS = {
    ridge: 0.30, print: 0.26, hatch: 0.30, hair: 0.24, vein: 0.22, tendon: 0.22,
    fold: 0.12, crease: 0.09, palmcrease: 0.12, nail: 0.10
  };

  const state_noop = false;

  const DEFAULT_LAYERS = {
    contour: true, crease: true, fold: true, nail: true, print: true,
    palmcrease: true, ridge: true, vein: true, tendon: true, hair: true,
    hatch: true, bone: false, label: false
  };

  class Renderer {
    constructor(w, h) {
      this.w = w; this.h = h;
      this.g = null;
      this.cacheSeed = null;
    }

    /** rebuild only what depends on the seed */
    anatomyFor(seed) {
      if (!this._an || this._anSeed !== seed) {
        this._an = AN.buildAnatomy(seed);
        this._anSeed = seed;
      }
      return this._an;
    }

    /**
     * Settle a pose against its own contacts, memoised so the draft pass and
     * the plate that follows it share one solve.
     */
    settle(A, pose, iters) {
      if (state_noop) return pose;
      const key = this._anSeed + '|' + iters + '|' + JSON.stringify(pose);
      if (this._ck === key) return this._cp;
      const out = GK.pose.resolveContacts(A, pose, { iters });
      this._ck = key; this._cp = out;
      return out;
    }

    build(state) {
      const A = this.anatomyFor(state.seed);
      const pose = state.contacts === false ? state.pose
        : this.settle(A, state.pose, (state.quality || 0) >= 1 ? 20 : 10);
      const rig = RG.solve(A, pose);
      const V = state.view;
      const view = new RG.View(V.az, V.el, V.roll || 0, 1, [0, 0, 0], 0, 0);

      // ---- auto-frame -----------------------------------------------------
      // Measure the real outline rather than a scatter of landmarks: a curled
      // fingertip, a fat thenar or a foreshortened knuckle ring all sit
      // outside any convenient set of key points, and the drawing gets clipped.
      // Projection is linear, so a cheap pass at unit scale gives exact bounds.
      view.scale = 1; view.cx = 0; view.cy = 0;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      const swallow = (pts) => {
        for (const p of pts) {
          if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
          if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
        }
      };
      for (let d = 0; d < 5; d++) {
        const c = RG.digitContour(rig, view, d, { steps: 5 });
        swallow(c.left); swallow(c.right); swallow(c.cap);
        for (const r of c.rings) swallow(r);
      }
      const fsil = RG.palmSilhouette(rig, view, { nu: 20, nb: 44, u0: -0.44, u1: 1.03 });
      swallow(fsil.sideA); swallow(fsil.sideB); swallow(fsil.cap);

      const margin = state.margin === undefined ? 0.88 : state.margin;
      const zoom = V.zoom === undefined ? 1 : V.zoom;
      const scale = Math.min(this.w * margin / Math.max(1e-6, x1 - x0),
        this.h * margin / Math.max(1e-6, y1 - y0)) * zoom;
      view.scale = scale;
      view.cx = this.w * 0.5 - scale * (x0 + x1) * 0.5;
      view.cy = this.h * 0.5 - scale * (y0 + y1) * 0.5;
      // millimetres per pixel, for depth tolerances
      view.mmPerPx = 1 / scale;

      // ---- depth field ----------------------------------------------------
      const ids = buildIds(rig);
      const df = new DepthField(this.w, this.h, (state.quality || 0) >= 1 ? 1 : 2);
      rasterise(rig, view, df, undefined, ids);

      // ---- feature curves -------------------------------------------------
      const L = Object.assign({}, DEFAULT_LAYERS, state.layers || {});
      const det = state.detail || {};
      const q = state.quality === undefined ? 1 : state.quality;
      const curves = [];
      if (L.crease || L.fold) F.digitFolds(rig, curves);
      if (L.crease) F.webs(rig, curves);
      if (L.nail) F.nails(rig, curves);
      if (L.print && (det.print === undefined ? 1 : det.print) > 0.02) F.fingerprints(rig, curves, q);
      if (L.palmcrease) F.palmCreases(rig, curves);
      if (L.ridge && (det.ridge === undefined ? 1 : det.ridge) > 0.02) F.palmRidges(rig, curves, q);
      if (L.tendon) D.tendons(rig, curves);
      if (L.vein) D.veins(rig, curves);
      if (L.fold) D.knuckleField(rig, curves);
      if (L.hair) D.hair(rig, curves);
      if (L.hatch) D.skinLattice(rig, curves, det.lattice === undefined ? 0.6 : det.lattice);
      if (L.bone) D.skeleton(rig, view, curves);

      return { A, rig, view, df, ids, curves, layers: L };
    }

    draw(state) {
      const t0 = Date.now();
      const built = this.build(state);
      const { rig, view, df, ids, curves, layers } = built;
      const A = built.A;
      const stl = state.style || {};
      const q = state.quality === undefined ? 1 : state.quality;
      const ss = q >= 2 ? 2 : 1;
      if (!this.g || this.g.w !== this.w || this.g.h !== this.h || this.g.ss !== ss || this.g.seed !== state.seed) {
        this.g = new PEN.Graphite(this.w, this.h, ss, state.seed);
      } else {
        this.g.clear();
      }
      const g = this.g;
      const grade = PEN.gradeAt(stl.grade === undefined ? 3 : stl.grade);
      const toneScale = stl.tone === undefined ? 1 : stl.tone;
      const wobScale = stl.wobble === undefined ? 1 : stl.wobble;
      const ghost = stl.ghost === undefined ? 0.14 : stl.ghost;
      const det = state.detail || {};
      const layerGain = {
        print: det.print === undefined ? 1 : det.print,
        ridge: det.ridge === undefined ? 1 : det.ridge,
        hatch: det.lattice === undefined ? 1 : det.lattice,
        hair: det.hair === undefined ? 1 : det.hair,
        vein: det.vein === undefined ? 1 : det.vein
      };
      // Tolerances in scene units. Identity keeps a part from occluding
      // itself, so these only have to absorb rasterisation error.
      const eps = Math.max(0.30, view.mmPerPx * 1.1);
      const gap = Math.max(0.90, view.mmPerPx * 3.2);

      const put = (r, style, extraTone) => {
        g.stroke(r.pts, {
          grade,
          tone: (style.tone || 0.5) * toneScale * (extraTone === undefined ? 1 : extraTone),
          weight: style.weight, passes: style.passes, taper: style.taper,
          wobble: (style.wobble || 1) * wobScale, jitter: style.jitter,
          grain: style.grain, phase: (style.phase || 0) * 0.137 + 3.1,
          vis: r.vis
        });
      };

      // ---- feature curves --------------------------------------------------
      for (const cv of curves) {
        const gain = layerGain[cv.style.layer];
        if (gain !== undefined && gain <= 0.02) continue;
        const fine = FINE_LAYERS[cv.style.layer] || 0;
        const pp = projectCurve(rig, view, df, cv, { eps, gap, ids, horizon: fine, g });
        // Fold and crease carry the knuckle's own structure (the crest of a
        // bent joint, the wrinkle it leaves), toned for where they usually
        // sit: spaced out across an open hand, with plenty else nearby to
        // read them against. Over an open patch of paper — nothing else
        // within reach, which is exactly what a fist seen from above does
        // to its own knuckle row — that same tone is too little to carry
        // the line alone, so lean on it harder there. crowdGive already
        // handles the opposite problem (too much nearby, not too little),
        // so this only ever adds where the page is still genuinely bare.
        let press = 1;
        if ((cv.style.layer === 'fold' || cv.style.layer === 'crease') && pp.length) {
          const mid = pp[pp.length >> 1];
          const bare = 1 - clamp01(g.densityAt(mid[0], mid[1], 14) / 0.12);
          press = lerp(1, 2.8, bare);
        }
        const tone = (gain === undefined ? 1 : clamp(gain, 0, 2)) * press;
        for (const r of runs(pp, 0.05, 2)) put(r, cv.style, tone);

        if (ghost > 0.01 && cv.style.layer !== 'print' && cv.style.layer !== 'ridge' &&
          cv.style.layer !== 'hatch' && cv.style.layer !== 'hair') {
          for (const r of runs(pp, 0.06, 4)) {
            put(r, F.st(cv.style, { passes: 1, taper: 0.85 }), tone * ghost);
          }
        }
      }

      // ---- contours --------------------------------------------------------
      if (layers.contour) this._contours(rig, view, df, ids, g, grade, stl, toneScale, wobScale, ghost, eps, gap);

      built.ms = Date.now() - t0;
      this.last = built;
      return built;
    }

    _contours(rig, view, df, ids, g, grade, stl, toneScale, wobScale, ghost, eps, gap) {
      const search = stl.search === undefined ? 0.35 : stl.search;

      /**
       * pts carry [x, y, near, partId, gain]. Everything about whether a mark
       * survives is decided here: how much of it another part covers, how
       * deeply, and whether it rides an overlapping edge worth pressing on.
       */
      const emit = (pts, style, opts) => {
        opts = opts || {};
        const selfTol = opts.selfTest ? eps * 3 + 1.6 : 0;
        // slots: 0 x, 1 y, 2 front, 3 near, 4 ghost, 5 gain, 6 part id
        const tagged = pts.map(p => {
          const id = p[3] === undefined ? -1 : p[3];
          let v = 1 - df.hidden(p[0], p[1], p[2], id, eps, gap);
          // The palm outline is a per-section extreme, not a true silhouette:
          // where the sheet's own sections overlap in screen space, one can
          // dive inside the form. Testing it against the palm's own front
          // surface throws away exactly those points and nothing else.
          if (opts.selfTest) v *= 1 - df.hidden(p[0], p[1], p[2], id, selfTol, gap * 2, true);
          const behind = df.behind(p[0], p[1], p[2], id);
          const step = df.stepBehind(p[0], p[1], p[2], id);
          const merge = step === Infinity ? 1 : 0.16 + 0.84 * smoothstep(clamp01(step / 13));
          // A shallow step doesn't always mean a weak edge — two knuckles
          // pressed together part with almost no depth between them, yet the
          // surface still turns hard right there. Weight by whichever signal
          // for "this is a real edge" is stronger: the separation behind it,
          // or the turn the surface itself is taking underfoot.
          const turn = smoothstep(clamp01(df.slopeAt(p[0], p[1]) / 0.35));
          const gain = (p[4] === undefined ? 1 : p[4]) * Math.max(merge, turn) * crowdGive(g, p[0], p[1]);
          const decay = Math.exp(-Math.max(0, behind - 2) / 11);
          return [p[0], p[1], v * gain, p[2], (1 - v) * decay * gain, gain, id];
        });
        // Overlap emphasis: where this form passes in front of another, a
        // draughtsman leans on the line. Probe just outside the contour and
        // ask whether something sits behind it there.
        for (let i = 0; i < tagged.length; i++) {
          const p = tagged[i];
          const a = tagged[Math.max(0, i - 1)], b = tagged[Math.min(tagged.length - 1, i + 1)];
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const dl = Math.hypot(dx, dy) || 1;
          const nx = -dy / dl * 5, ny = dx / dl * 5;
          let best = 0;
          for (const sgn of [-1, 1]) {
            const bh = df.behind(p[0] + nx * sgn, p[1] + ny * sgn, p[3], p[6]);
            if (bh > 0.5 && bh < 70) best = Math.max(best, clamp01(bh / 14));
          }
          p[2] *= 1 + best * 0.55;
        }
        for (const r of runs(tagged, 0.06, 2, opts.maxJump)) {
          g.stroke(r.pts, {
            grade, tone: style.tone * toneScale, weight: style.weight,
            passes: style.passes, taper: style.taper,
            wobble: (style.wobble || 1) * wobScale, jitter: style.jitter,
            phase: (style.phase || 0) * 0.137 + 11.7, vis: r.vis
          });
        }
        if (ghost > 0.01 && !opts.noGhost) {
          for (const r of runs(tagged, 0.08, 4, opts.maxJump)) {
            if (M.polyLen(r.pts) < 22) continue;
            g.stroke(r.pts, {
              grade, tone: style.tone * toneScale * ghost * 0.9, weight: style.weight * 0.85,
              passes: 1, taper: 0.85, wobble: (style.wobble || 1) * wobScale * 1.3,
              jitter: style.jitter, phase: (style.phase || 0) * 0.31 + 5.3, vis: r.vis
            });
          }
        }
        // the searching lines a hand lays down beside the one it means
        if (search > 0.02 && !opts.noSearch) {
          for (let k = 0; k < 2; k++) {
            const off = (k === 0 ? 1 : -1) * (1.6 + k * 1.4);
            const shifted = tagged.map((p, i) => {
              const a = tagged[Math.max(0, i - 1)], b = tagged[Math.min(tagged.length - 1, i + 1)];
              const dx = b[0] - a[0], dy = b[1] - a[1];
              const dl = Math.hypot(dx, dy) || 1;
              return [p[0] - dy / dl * off, p[1] + dx / dl * off, p[2], p[3], p[4], p[5], p[6]];
            });
            for (const r of runs(shifted, 0.30, 2, opts.maxJump)) {
              // A hand searches alongside a line it is committing to, not
              // beside every twelve-pixel fragment a busy pose leaves behind.
              if (M.polyLen(r.pts) < 46) continue;
              g.stroke(r.pts, {
                grade, tone: style.tone * toneScale * 0.16 * search, weight: style.weight * 0.8,
                passes: 1, taper: 0.9, wobble: (style.wobble || 1) * wobScale * 1.9,
                jitter: style.jitter * 2.0, phase: (style.phase || 0) * 0.7 + k * 21.3, vis: r.vis
              });
            }
          }
        }
      };

      // A rail that leaps across the picture is not one line: a digit turning
      // through the view hands its silhouette from one flank to the other.
      const jumpD = Math.max(12, this.w * 0.030);
      const fw = RG.firstWeb(rig, view);
      // Where the web meets the thumb, the thumb's boundary is not free: it
      // runs into tissue that belongs to both. The union outline closes
      // unconditionally and knows nothing about that, so it draws a finished
      // edge straight across the join, and at the elevations where the web is
      // edge-on - and therefore drawing almost nothing itself - that edge is
      // the whole reason the thumb reads as a rounded form sitting beside the
      // hand rather than part of it.
      const webAngles = fw.thSide.map(P => view.px(P));
      for (let d = 0; d < 5; d++) {
        // A digit pointing at the eye is drawn as one form, not as pieces -
        // but how compact it reads is a continuous function of the view
        // (digitUnion.edgeOn), not a threshold, because an orbit or a
        // range-of-motion tour crosses whatever threshold there were
        // constantly. So both treatments are drawn through the transition,
        // the ordinary one fading out as the union fades in, and - the part
        // a plain cross-fade would still get wrong - the rails and cap are
        // pulled toward the union's own outline as they go, looked up by
        // angle about its centroid, so what fades out is already sitting
        // where what fades in will be, and neither pop is left uncovered
        // for the other to fill.
        const un = RG.digitUnion(rig, view, d);
        const edgeOn = un.edgeOn || 0;
        if (edgeOn > 0.004) {
          let outline = un.outline;
          if (d === AN.THUMB) {
            outline = outline.map((p) => {
              const a = Math.atan2(p[1] - un.cy, p[0] - un.cx);
              let near = 9;
              for (const w of webAngles) {
                const b = Math.atan2(w[1] - un.cy, w[0] - un.cx);
                let dA = Math.abs(a - b);
                if (dA > Math.PI) dA = Math.PI * 2 - dA;
                if (dA < near) near = dA;
              }
              return [p[0], p[1], p[2], p[3], p[4] * smoothstep(clamp01((near - 0.16) / 0.30))];
            });
          }
          emit(outline, F.st(F.S.contour, { tone: 0.94 * edgeOn, phase: d * 37 + 60 }),
            { noSearch: true, selfTest: false, maxJump: jumpD });
        }
        if (edgeOn >= 0.996) continue;
        const fade = 1 - edgeOn;
        const bend = edgeOn <= 0.004 ? (pts => pts) : (pts => pts.map((p) => {
          const u = un.at(Math.atan2(p[1] - un.cy, p[0] - un.cx));
          return [lerp(p[0], u[0], edgeOn), lerp(p[1], u[1], edgeOn), lerp(p[2], u[2], edgeOn), p[3], p[4]];
        }));
        // The whole-digit union answers a digit gone compact. It does not
        // answer a curled finger seen from the palm, which still spans the
        // picture while its last bone is dead end-on - there the tip cap is
        // the silhouette, drawn a size smaller than the tube behind it, and
        // the finger reads as a tube with a disc laid on top. So the last
        // bone gets an outline of its own, and whatever rail runs inside it
        // gives way, since that is the stretch it has replaced.
        const tu = RG.tipUnion(rig, view, d);
        const tipMix = (tu.tipOn || 0) * fade;
        if (tipMix > 0.004) {
          emit(tu.outline, F.st(F.S.contour, { tone: 0.94 * tipMix, phase: d * 37 + 70 }),
            { noSearch: true, selfTest: false, maxJump: jumpD });
        }
        const yieldTip = tipMix <= 0.004 ? (pts => pts) : (pts => pts.map((p) => {
          const dx = p[0] - tu.cx, dy = p[1] - tu.cy;
          const o = tu.at(Math.atan2(dy, dx));
          const R = Math.hypot(o[0] - tu.cx, o[1] - tu.cy);
          const k = 1 - tipMix * (1 - smoothstep(clamp01((Math.hypot(dx, dy) / Math.max(1e-6, R) - 0.92) / 0.22)));
          return [p[0], p[1], p[2], p[3], p[4] * k];
        }));
        const c = RG.digitContour(rig, view, d, { steps: 12 });
        emit(yieldTip(bend(c.right)), F.st(F.S.contour, { tone: fade, phase: d * 37 + 1 }), { maxJump: jumpD });
        emit(yieldTip(bend(c.left)), F.st(F.S.contour, { tone: fade, phase: d * 37 + 3 }), { maxJump: jumpD });
        // A ring or a tip cap is only an outline where the tube points away
        // from the eye. Pointing toward it, the near half of the same tube
        // covers the far half — and identity exclusion, which is what keeps a
        // silhouette from occluding itself, would otherwise let it through.
        if (c.cap.length) emit(bend(c.cap), F.st(F.S.contour, { tone: 0.80 * fade * (1 - tipMix), phase: d * 37 + 2 }),
          { noSearch: true, selfTest: true, maxJump: jumpD });
        for (let ri = 0; ri < c.rings.length; ri++) {
          // where a digit foreshortens, its knuckle ring IS the outline
          emit(bend(c.rings[ri]), F.st(F.S.contour, { tone: 0.95 * fade, phase: d * 37 + 40 + ri }),
            { noSearch: true, noGhost: true, selfTest: true, maxJump: jumpD });
        }
      }

      const u0 = -0.44, u1 = 1.030;
      const sil = RG.palmSilhouette(rig, view, { nu: 56, nb: 96, u0, u1 });
      const tagPalm = (arr, fade) => arr.map((p, k) => {
        const u = lerp(u0, u1, k / (arr.length - 1));
        return [p[0], p[1], p[2], ids.palm,
          fade === false ? 1 : smoothstep(clamp01((u + 0.40) / 0.30))];
      });
      const jump = Math.max(14, this.w * 0.035);
      emit(tagPalm(sil.sideA), F.st(F.S.contour, { tone: 0.90, phase: 200 }), { maxJump: jump, selfTest: true });
      emit(tagPalm(sil.sideB), F.st(F.S.contour, { tone: 0.90, phase: 201 }), { maxJump: jump, selfTest: true });
      emit(tagPalm(sil.cap, false),
        F.st(F.S.contourSoft, { tone: 0.30, taper: 0.86, phase: 202 }), { noSearch: true, selfTest: true });
      // The thumb's commissure, as the outline of the wedge it actually is:
      // a closed band running up the thumb's own flank, across the free
      // margin, back down the palm's, and across the depth of the
      // commissure — where it bulges most, and where a bare mid-sheet had
      // nothing to show at all. selfTest buries whatever part of that band
      // faces away behind the part that covers it.
      emit(fw.band, F.st(F.S.contour, { tone: 1.05, weight: 1.18, taper: 0.5, phase: 208 }),
        { maxJump: jump, selfTest: true });
      // the free margins of the webs, spanning finger to finger
      const webs = RG.webContours(rig, view);
      for (let i = 0; i < webs.length; i++) {
        emit(webs[i], F.st(F.S.contour, { tone: 0.72, taper: 0.68, phase: 210 + i }),
          { noSearch: true, maxJump: jump });
      }
    }

    resolve(state) {
      const stl = (state && state.style) || {};
      return this.g.resolve({
        paper: stl.paper || [244, 241, 232],
        ink: stl.ink || [26, 25, 23],
        k: stl.k === undefined ? 1.55 : stl.k,
        gamma: stl.gamma === undefined ? 1.0 : stl.gamma,
        sheen: stl.sheen,
        vignette: stl.vignette,
        paperGrain: stl.paperGrain
      });
    }
  }

  GK.render = { Renderer, DepthField, rasterise, buildIds, projectCurve, runs, DEFAULT_LAYERS };
})(window.GK = window.GK || {});
