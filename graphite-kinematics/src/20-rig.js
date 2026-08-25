/* ============================================================================
   GRAPHITE KINEMATICS — 20 · rig
   Forward kinematics for the whole linkage, plus the surface parametrisation
   that every crease, ridge, nail and hair is authored in.

   World frame (right hand, right-handed basis):
       +X  distal    -X  proximal
       +Y  ulnar     -Y  radial
       +Z  palmar    -Z  dorsal
   Named rotations (explicit, so sign conventions are never in doubt):
       FLEX(t)  carries distal toward palmar
       ABD(t)   carries distal toward ulnar
       TWIST(t) carries ulnar toward palmar (axial roll / opposition)

   Surface coordinates on a digit segment: (s, alpha)
       s      0..1 along the bone, past 1 into the fingertip dome
       alpha  0 = ulnar flank, +pi/2 = dorsal, +-pi = radial, -pi/2 = palmar
   Surface coordinates on the palm: (u, beta)
       u      0 at the wrist, 1 at the knuckle line
       beta   0..1 once around the closed cross-section; 0..0.5 sweeps the
              palmar face radial->ulnar, 0.5..1 returns across the dorsum
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math;
  const AN = GK.anatomy;
  const { DEG, clamp, clamp01, lerp, smoothstep, inv } = M;
  const { vadd, vsub, vmul, vmad, vdot, vcross, vnorm, vlen, vlerp, vcopy, mApply, mMul, mOrtho } = M;

  // ------------------------------------------------------- named rotations
  /** carries +X toward +Z (distal -> palmar): flexion */
  function FLEX(t) { const c = Math.cos(t), s = Math.sin(t); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; }
  /** carries +X toward +Y (distal -> ulnar): abduction */
  function ABD(t) { const c = Math.cos(t), s = Math.sin(t); return [[c, s, 0], [-s, c, 0], [0, 0, 1]]; }
  /** carries +Y toward +Z (ulnar -> palmar): axial twist */
  function TWIST(t) { const c = Math.cos(t), s = Math.sin(t); return [[1, 0, 0], [0, c, s], [0, -s, c]]; }

  const IDENT = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  // =========================================================================
  //  VIEW — orthographic camera
  // =========================================================================
  class View {
    /**
     * @param az  0 = looking at the dorsum, PI = looking at the palm,
     *            +PI/2 = ulnar flank, -PI/2 = radial (thumb) flank
     * @param el  elevation toward the fingertips
     */
    constructor(az, el, roll, scale, center, cx, cy) {
      this.set(az, el, roll, scale, center, cx, cy);
    }
    set(az, el, roll, scale, center, cx, cy) {
      this.az = az; this.el = el; this.roll = roll || 0;
      this.scale = scale; this.center = center || [0, 0, 0];
      this.cx = cx; this.cy = cy;
      const ce = Math.cos(el), se = Math.sin(el);
      // e points from the scene toward the eye
      const e = [se, ce * Math.sin(az), -ce * Math.cos(az)];
      this.e = vnorm(e);
      let up = [1, 0, 0];                       // fingers up the page
      if (Math.abs(vdot(this.e, up)) > 0.985) up = [0, 0, -1];
      let r = vnorm(vcross(up, this.e));        // r x u = e
      let u = vnorm(vcross(this.e, r));
      if (this.roll) {
        const c = Math.cos(this.roll), s = Math.sin(this.roll);
        const r2 = vadd(vmul(r, c), vmul(u, s));
        const u2 = vadd(vmul(u, c), vmul(r, -s));
        r = r2; u = u2;
      }
      this.r = r; this.u = u;
      return this;
    }
    /** world -> screen [x, y] */
    px(P) {
      const dx = P[0] - this.center[0], dy = P[1] - this.center[1], dz = P[2] - this.center[2];
      return [
        this.cx + this.scale * (dx * this.r[0] + dy * this.r[1] + dz * this.r[2]),
        this.cy - this.scale * (dx * this.u[0] + dy * this.u[1] + dz * this.u[2])
      ];
    }
    /** larger = nearer the eye */
    near(P) { return P[0] * this.e[0] + P[1] * this.e[1] + P[2] * this.e[2]; }
    /** project a direction (no translation) to screen space */
    dir(D) {
      return [
        this.scale * (D[0] * this.r[0] + D[1] * this.r[1] + D[2] * this.r[2]),
        -this.scale * (D[0] * this.u[0] + D[1] * this.u[1] + D[2] * this.u[2])
      ];
    }
    /** cosine of the angle between a surface normal and the eye; >0 faces us */
    facing(N) { return vdot(N, this.e); }
  }

  // =========================================================================
  //  POSE -> SKELETON
  // =========================================================================

  /**
   * Collateral-ligament constraint: metacarpophalangeal abduction is free when
   * the joint is straight and almost eliminated by 90 degrees of flexion,
   * because the cam-shaped condyle draws the collateral ligaments taut.
   */
  function abdGate(flex) {
    return 1 - 0.88 * smoothstep(clamp01(flex / (78 * DEG)));
  }

  function solve(A, pose) {
    const rig = { anatomy: A, pose, digits: [], joints: [] };
    const W = pose.wrist;

    // forearm roll, then wrist deviation, then wrist flexion
    const root = mMul(TWIST(W.pron || 0), mMul(ABD(W.dev || 0), FLEX(W.flex || 0)));
    rig.root = mOrtho(root);
    rig.origin = [0, 0, 0];

    // carpus: a short block between the wrist crease and the metacarpal bases
    const carpalLen = 26 * A.size;
    rig.carpal = { frame: rig.root, A: vmad(rig.origin, rig.root[0], -carpalLen * 0.55), len: carpalLen };
    rig.forearm = {
      frame: mOrtho(mMul(TWIST(W.pron || 0), IDENT())),
      A: rig.origin
    };

    const arch = pose.arch || 0;

    for (let d = 0; d < 5; d++) {
      const bone = A.bones[d];
      const cmc = A.cmc[d];
      const P = pose.digits[d];
      const nSeg = bone.lengths.length;

      // ---- carpometacarpal frame -----------------------------------------
      let fan = cmc.fan, tilt = cmc.tilt, roll = cmc.roll;
      if (d === AN.THUMB) {
        fan += (P.cmcRad || 0);      // radial abduction / adduction, in-plane
        tilt += (P.cmcAbd || 0);     // palmar abduction, out of the palm plane
        // Opposition pronates the thumb so its pad turns to face the fingers:
        // that carries the metacarpal's roll further from the palm plane, not
        // back toward it.
        roll -= (P.cmcOpp || 0);
      } else {
        const mob = cmc.mobility * arch;
        tilt += mob + (P.cmcFlex || 0);
        roll += mob * 0.45;          // ulnar metacarpals supinate as the palm cups
      }
      const cmcAxA = rig.root[2];                       // in-plane swing
      const afterFan = mMul(rig.root, ABD(fan));
      const cmcAxF = vmul(afterFan[1], -1);              // out of the palm plane
      const afterTilt = mMul(afterFan, FLEX(tilt));
      const cmcAxT = vmul(afterTilt[0], -1);             // opposition (roll -= opp)
      let frame = mOrtho(mMul(afterTilt, TWIST(roll)));
      let origin = vadd(rig.origin, mApply(rig.root, cmc.pos));

      const segs = [];
      const joints = [];
      for (let seg = 0; seg < nSeg; seg++) {
        if (seg > 0) {
          // ---- joint rotation ---------------------------------------------
          let flexA = 0, abdA = 0, twistA = 0, abdScale = 1;
          if (d === AN.THUMB) {
            if (seg === 1) { flexA = P.mcpFlex || 0; abdA = (P.mcpAbd || 0); }
            else { flexA = P.ipFlex || 0; }
          } else {
            if (seg === 1) {
              flexA = P.mcpFlex || 0;
              abdScale = abdGate(flexA);
              abdA = (P.mcpAbd || 0) * abdScale;
            } else if (seg === 2) {
              flexA = P.pipFlex || 0;
            } else {
              flexA = P.dipFlex || 0;
              abdA = bone.clino * (d === AN.LITTLE ? 1 : 0.4);
            }
          }
          flexA += bone.camber[seg] || 0;
          // World rotation axes, so a contact solver can ask how moving this
          // joint would move a point. ABD turns about the parent frame's
          // dorsopalmar axis; FLEX about the abducted frame's mediolateral
          // one, in the negative sense (FLEX carries +X toward +Z).
          const axA = frame[2];
          const mid = mMul(frame, ABD(abdA));
          const axF = vmul(mid[1], -1);
          frame = mOrtho(mMul(mid, FLEX(flexA)));
          joints.push({
            digit: d, index: seg, name: bone.jointNames[seg],
            P: origin, frame, axA, axF, abdScale,
            flex: flexA, abd: abdA, twist: twistA
          });
        } else {
          joints.push({ digit: d, index: 0, name: 'CMC', P: origin, frame, flex: tilt, abd: fan, twist: roll, axA: cmcAxA, axF: cmcAxF, axT: cmcAxT });
        }

        const len = bone.lengths[seg];
        const start = origin;
        const end = vmad(origin, frame[0], len);
        const isLast = seg === nSeg - 1;
        segs.push({
          digit: d, seg, name: bone.segNames[seg],
          A: start, B: end, len, frame,
          t: frame[0], ul: frame[1], pa: frame[2], dor: vmul(frame[2], -1),
          // The proximal phalanx begins a little *before* its joint, so its
          // condyle plugs into the end of the palm. That condyle is the
          // knuckle: it has to belong to the digit, or the palm's own solid
          // swallows it and a fist comes out with no knuckles at all.
          sMin: seg === 1 ? -0.12 : 0,
          sMax: isLast ? 1 + AN.tipExtent(A, d) : 1,
          rendered: seg > 0 || d === AN.THUMB
        });
        origin = end;
      }
      rig.digits.push({ digit: d, name: bone.name, segs, joints, tip: origin });
      for (const j of joints) rig.joints.push(j);
    }

    // how far each knuckle has risen, for the dorsal thickness field
    A.__knuckle = [1, 2, 3, 4].map(d =>
      clamp01(Math.max(0, rig.digits[d].joints[1].flex) / (68 * DEG)));
    // The thenar is muscle, and it goes with the thumb: as the thumb swings
    // out of the palm plane the mass rises behind it. Without this the palm
    // stays flat, the metacarpal walks away from it, and the thumb reads as a
    // separate object floating beside the hand.
    {
      const T = pose.digits[0];
      A.__thenarLift = clamp01(((T.cmcAbd || 0) / (55 * DEG)) * 0.75 +
        ((T.cmcOpp || 0) / (75 * DEG)) * 0.45);
    }
    buildPalm(rig);
    A.__thenarV = rig.palm.thumbV * 0.72;
    return rig;
  }

  // =========================================================================
  //  PALM SURFACE
  //  A closed generalised tube whose cross-sections are spanned by the five
  //  metacarpals, so that cupping the hand deforms the sheet for free.
  // =========================================================================
  const PALM_NU = 41;
  const PALM_U0 = -0.55, PALM_U1 = 1.22;
  // The sheet is spanned by the four finger metacarpals. The thumb's is short
  // and steeply angled — carrying it as a control column tents the surface —
  // so the thenar is carried as thickness instead, over a radial border that
  // tracks where the thumb metacarpal actually lies.
  const V_KNOTS = [0, 1 / 3, 2 / 3, 1];
  const VMID = 0.42;
  /** the hand narrows sharply into the wrist */
  const wristNarrow = (u) => lerp(0.84, 1, smoothstep(clamp01((u + 0.30) / 0.46)));

  function buildPalm(rig) {
    const A = rig.anatomy;
    const smoothstep = M.smoothstep;
    const grid = [];      // [uIdx][mcIdx] -> spine point
    const norms = [];     // [uIdx][mcIdx] -> dorsal-to-palmar normal
    for (let i = 0; i < PALM_NU; i++) {
      const u = lerp(PALM_U0, PALM_U1, i / (PALM_NU - 1));
      const row = [];
      for (let d = 1; d < 5; d++) {
        const mc = rig.digits[d].segs[0];
        let P = vmad(mc.A, mc.t, mc.len * u);
        if (u < 0) {
          // Proximal of the carpus the metacarpals converge on one another;
          // a wrist does not. Blend onto the hand's own long axis so the
          // sheet runs out parallel-sided instead of pinching to a point.
          const alt = vmad(mc.A, rig.root[0], u * 62 * A.size);
          P = M.vlerp(P, alt, smoothstep(clamp01(-u / 0.22)));
        }
        row.push(P);
      }
      grid.push(row);
    }
    // normals from the local surface tangents
    for (let i = 0; i < PALM_NU; i++) {
      const row = [];
      for (let d = 0; d < 4; d++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(PALM_NU - 1, i + 1);
        const d0 = Math.max(0, d - 1), d1 = Math.min(3, d + 1);
        const Tu = vsub(grid[i1][d], grid[i0][d]);
        const Tv = vsub(grid[i][d1], grid[i][d0]);
        let n = vnorm(vcross(Tv, Tu));
        // orient palmar-ward using the carpal frame
        if (vdot(n, rig.root[2]) < 0) n = vmul(n, -1);
        row.push(n);
      }
      norms.push(row);
    }
    // Where does the thumb metacarpal sit, in the sheet's own coordinates?
    // The radial border is pulled out to meet it, so the thenar opens and
    // closes with the thumb instead of being a fixed lobe.
    const tmc = rig.digits[0].segs[0];
    const tMid = vmad(tmc.A, tmc.t, tmc.len * 0.62);
    const palmRef = {
      grid, norms, nu: PALM_NU, u0: PALM_U0, u1: PALM_U1, knots: V_KNOTS,
      vLo: () => -3, vHi: () => 3
    };
    rig.palm = palmRef;
    let thumbV = -0.55, thumbU = 0.55, best = 1e18;
    for (let iu = 0; iu <= 14; iu++) {
      for (let iv = 0; iv <= 30; iv++) {
        const uu = lerp(0.1, 1.0, iu / 14), vv = lerp(-1.4, 0.05, iv / 30);
        const q = palmSpine(rig, uu, vv).P;
        const dd = (q[0] - tMid[0]) ** 2 + (q[1] - tMid[1]) ** 2 + (q[2] - tMid[2]) ** 2;
        if (dd < best) { best = dd; thumbV = vv; thumbU = uu; }
      }
    }
    thumbV = clamp(thumbV, -1.25, -0.24);

    rig.palm = {
      grid, norms,
      nu: PALM_NU, u0: PALM_U0, u1: PALM_U1,
      knots: V_KNOTS, thumbV, thumbU,
      // The borders carry the eminences: the radial edge swells over the
      // thenar and pulls back in at the thumb web, the ulnar edge over the
      // hypothenar. Extrapolating past the outer metacarpals does the work.
      vLo: (u) => {
        const uu = clamp(u, -0.6, 1.3);
        // the radial border swings out to meet the thumb metacarpal, so the
        // thenar and the first web open and close with the thumb itself
        const reach = Math.min(0, (thumbV * 1.04) + 0.10);
        const raw = -0.20 + reach * Math.exp(-Math.pow((uu - 0.46) / 0.54, 2));
        return VMID - (VMID - raw) * wristNarrow(uu);
      },
      /** where the radial border sits for a hand with the thumb at rest */
      vLoRef: (u) => {
        const uu = clamp(u, -0.6, 1.3);
        const raw = -0.20 - 0.52 * Math.exp(-Math.pow((uu - 0.46) / 0.54, 2));
        return VMID - (VMID - raw) * wristNarrow(uu);
      },
      /**
       * Palm features are authored against a hand with the thumb at rest.
       * Rebasing them onto the live radial border keeps them inside the sheet
       * in every pose: without it, an adducted thumb pulls the border in and
       * everything beyond it collapses onto the rim as one black line.
       */
      mapV: function (u, v) {
        if (v >= VMID) return v;
        const ref = this.vLoRef(u), live = this.vLo(u);
        const span = VMID - ref;
        if (span < 1e-6) return v;
        return lerp(live, VMID, (v - ref) / span);
      },
      vHi: (u) => {
        const uu = clamp(u, -0.6, 1.3);
        const raw = 1 + 0.105 + 0.275 * Math.exp(-Math.pow((uu - 0.34) / 0.46, 2));
        return VMID + (raw - VMID) * wristNarrow(uu);
      },
      // The palm's own solid stops just past the metacarpal heads. The web
      // margin between two digits is not a property of the palm at all — it
      // is skin spanning from one finger's flank to the next — so it is built
      // from those flanks, in webContours, rather than guessed here.
      uDistal: (v, palmar) => palmar === false ? 1.045
        : 1.030 + 0.055 * (0.5 - 0.5 * Math.cos(Math.PI * 6 * clamp(v, 0, 1)))
    };
  }

  /** spine point + palmar normal at palm coordinates (u, v) */
  function palmSpine(rig, u, v) {
    const p = rig.palm;
    const fi = (clamp(u, p.u0, p.u1) - p.u0) / (p.u1 - p.u0) * (p.nu - 1);
    const vi = M.knotIndex(p.knots, v);
    // Catmull-Rom in v within each of four u-rows, then Catmull-Rom in u
    const i = clamp(Math.floor(fi), 0, p.nu - 2);
    const tu = clamp(fi - i, -0.6, 1.6);
    const rows = [Math.max(0, i - 1), i, i + 1, Math.min(p.nu - 1, i + 2)];
    const cp = [], cn = [];
    for (let k = 0; k < 4; k++) {
      cp.push(M.splineAt(p.grid[rows[k]], vi));
      cn.push(M.splineAt(p.norms[rows[k]], vi));
    }
    return {
      P: M.crV(cp[0], cp[1], cp[2], cp[3], tu),
      n: vnorm(M.crV(cn[0], cn[1], cn[2], cn[3], tu))
    };
  }

  /** palmar soft-tissue thickness (mm) at palm coordinates */
  function palmThickPalmar(A, u, v) {
    if (A.__thenarV === undefined) A.__thenarV = -0.52;
    const S = A.size, pad = A.palm.padding;
    let t = 9.0;
    // thenar eminence — the muscular ball of the thumb
    t += (6.0 + 9.5 * (A.__thenarLift || 0)) * A.palm.thenar *
      Math.exp(-Math.pow((v - A.__thenarV) / 0.34, 2)) *
      Math.exp(-Math.pow((u - 0.50) / 0.46, 2));
    // hypothenar eminence
    t += 6.4 * A.palm.hypothenar *
      Math.exp(-Math.pow((v - 1.14) / 0.26, 2)) *
      Math.exp(-Math.pow((u - 0.44) / 0.42, 2));
    // pads over the metacarpal heads
    t += 4.6 * Math.exp(-Math.pow((u - 0.97) / 0.17, 2)) *
      M.smoothstep(clamp01((v + 0.22) / 0.30)) *
      (0.72 + 0.28 * Math.cos(Math.PI * 3 * clamp01(v)));
    // central hollow
    t -= 3.2 * A.palm.hollow *
      Math.exp(-Math.pow((u - 0.60) / 0.24, 2)) *
      Math.exp(-Math.pow((v - 0.50) / 0.32, 2));
    // wrist narrows and thins
    t *= lerp(0.40, 1.0, smoothstep(clamp01((u + 0.30) / 0.54)));
    return Math.max(1.0, t) * S * pad;
  }

  /**
   * Dorsal soft-tissue thickness (mm). The back of the hand is thin, except
   * over the metacarpal heads — and those only rise into knuckles when the
   * joint below them flexes. A knuckle is the head rolling out from under the
   * extensor hood, not the phalanx: with the joint at ninety degrees the
   * phalanx's own condyle points distally and contributes nothing dorsally,
   * which is why a fist drawn from the phalanx alone comes out with a flat
   * back and no knuckles at all.
   */
  function palmThickDorsal(A, u, v) {
    const S = A.size;
    const kn = A.__knuckle || [0, 0, 0, 0];
    let t = 4.4;
    for (let i = 0; i < 4; i++) {
      const vc = i / 3;
      t += (1.1 + 4.4 * kn[i]) * A.knuckles.prominence *
        Math.exp(-Math.pow((u - 0.985) / 0.145, 2)) *
        Math.exp(-Math.pow((v - vc) / 0.155, 2));
    }
    // the shafts of the metacarpals show through as low ridges
    t += 0.9 * Math.pow(Math.abs(Math.cos(Math.PI * 3 * v)), 3) * M.smoothstep(clamp01((v + 0.20) / 0.28));
    t *= lerp(0.46, 1.0, smoothstep(clamp01((u + 0.30) / 0.56)));
    return Math.max(0.8, t) * S * A.palm.padding;
  }

  /** superelliptical wrap: 1 across the sheet, 0 at the borders */
  function palmWrap(rig, u, v) {
    const lo = rig.palm.vLo(u), hi = rig.palm.vHi(u);
    if (v <= lo || v >= hi) return 0;
    const x = (v - lo) / (hi - lo) * 2 - 1;    // -1..1
    return Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(x), 5)));
  }

  /**
   * Palm surface point at (u, beta).
   * beta 0..0.5 sweeps the palmar face from the radial border to the ulnar
   * border; 0.5..1 returns across the dorsum. Returns { P, N, v, palmar }.
   */
  function palmSurface(rig, u, beta) {
    const A = rig.anatomy;
    const lo = rig.palm.vLo(u), hi = rig.palm.vHi(u);
    const phi = M.TAU * beta;
    const v = lo + (hi - lo) * (0.5 - 0.5 * Math.cos(phi));
    const s = Math.sin(phi);
    const sp = palmSpine(rig, u, v);
    const wrap = Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(2 * (v - lo) / (hi - lo) - 1), 5)));
    const palmar = s >= 0;
    const thick = palmar ? palmThickPalmar(A, u, v) : palmThickDorsal(A, u, v);
    const off = thick * wrap * Math.abs(s);
    const P = vmad(sp.P, sp.n, palmar ? off : -off);
    return { P, v, palmar, spine: sp.P, n: sp.n, off, thick, wrap };
  }

  /** numeric surface normal on the palm */
  function palmNormal(rig, u, beta) {
    const h = 0.006;
    const p0 = palmSurface(rig, u, beta).P;
    const pu = palmSurface(rig, clamp(u + h, -0.1, 1.12), beta).P;
    const pb = palmSurface(rig, u, beta + h).P;
    const Tu = vsub(pu, p0), Tb = vsub(pb, p0);
    let N = vnorm(vcross(Tb, Tu));
    const c = palmSurface(rig, u, beta);
    const ref = vmul(c.n, c.palmar ? 1 : -1);
    if (vdot(N, ref) < 0) N = vmul(N, -1);
    return N;
  }

  // =========================================================================
  //  DIGIT SURFACE
  // =========================================================================

  /** surface point on a digit segment; alpha 0 = ulnar, +pi/2 = dorsal */
  function digitSurface(rig, d, seg, s, alpha) {
    const A = rig.anatomy;
    const sg = rig.digits[d].segs[seg];
    const pr = AN.segmentProfile(A, d, seg, s);
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const P = [
      sg.A[0] + sg.t[0] * sg.len * s + sg.ul[0] * pr[0] * ca + sg.dor[0] * pr[1] * sa,
      sg.A[1] + sg.t[1] * sg.len * s + sg.ul[1] * pr[0] * ca + sg.dor[1] * pr[1] * sa,
      sg.A[2] + sg.t[2] * sg.len * s + sg.ul[2] * pr[0] * ca + sg.dor[2] * pr[1] * sa
    ];
    return { P, a: pr[0], b: pr[1], seg: sg };
  }

  /** outward surface normal on a digit segment */
  function digitNormal(rig, d, seg, s, alpha) {
    const A = rig.anatomy;
    const sg = rig.digits[d].segs[seg];
    const h = 0.004;
    const p0 = AN.segmentProfile(A, d, seg, s);
    const p1 = AN.segmentProfile(A, d, seg, s + h);
    const da = (p1[0] - p0[0]) / h, db = (p1[1] - p0[1]) / h;
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    // dP/dalpha
    const Pa = [
      sg.ul[0] * (-p0[0] * sa) + sg.dor[0] * (p0[1] * ca),
      sg.ul[1] * (-p0[0] * sa) + sg.dor[1] * (p0[1] * ca),
      sg.ul[2] * (-p0[0] * sa) + sg.dor[2] * (p0[1] * ca)
    ];
    // dP/ds
    const Ps = [
      sg.t[0] * sg.len + sg.ul[0] * da * ca + sg.dor[0] * db * sa,
      sg.t[1] * sg.len + sg.ul[1] * da * ca + sg.dor[1] * db * sa,
      sg.t[2] * sg.len + sg.ul[2] * da * ca + sg.dor[2] * db * sa
    ];
    let N = vnorm(vcross(Pa, Ps));
    // guarantee outward orientation against the radial direction of the section
    const ref = [
      sg.ul[0] * ca + sg.dor[0] * sa,
      sg.ul[1] * ca + sg.dor[1] * sa,
      sg.ul[2] * ca + sg.dor[2] * sa
    ];
    if (vdot(N, ref) < 0) N = vmul(N, -1);
    return N;
  }

  /**
   * The two silhouette angles of a digit cross-section for a given view.
   * Exact for an elliptical section: the normal is perpendicular to the eye
   * when  cos(a)/A * (ul.e) + sin(a)/B * (dor.e) = 0.
   * Returns [alphaLeft, alphaRight] ordered by screen position.
   */
  function silhouetteAlphas(rig, view, d, seg, s) {
    const A = rig.anatomy;
    const sg = rig.digits[d].segs[seg];
    const pr = AN.segmentProfile(A, d, seg, s);
    const ue = vdot(sg.ul, view.e), de = vdot(sg.dor, view.e);
    let a1 = Math.atan2(-pr[1] * ue, pr[0] * de);
    let a2 = a1 + Math.PI;
    // order them by which side of the projected bone axis they land on
    const ts = view.dir(sg.t);
    const nx = -ts[1], ny = ts[0];
    const q1 = digitSurface(rig, d, seg, s, a1).P;
    const c = vmad(sg.A, sg.t, sg.len * s);
    const p1 = view.px(q1), pc = view.px(c);
    const side = (p1[0] - pc[0]) * nx + (p1[1] - pc[1]) * ny;
    return side >= 0 ? [a2, a1] : [a1, a2];
  }

  // =========================================================================
  //  SILHOUETTE CONTOURS
  // =========================================================================

  /**
   * A continuous outline for one digit, from the web line on one flank, over
   * the fingertip, and back down the other flank. Returns screen polylines
   * plus, for each point, the depth and whether it lies on the web boundary.
   */
  function digitContour(rig, view, d, opts) {
    opts = opts || {};
    const A = rig.anatomy;
    const dg = rig.digits[d];
    const segs = dg.segs.filter(sg => sg.rendered);
    const stepsPer = opts.steps || 13;
    const left = [], right = [];
    let prevL = null, prevR = null;
    const d2 = (a, b) => (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);

    for (let k = 0; k < segs.length; k++) {
      const sg = segs[k];
      const isLast = k === segs.length - 1;
      const n = isLast ? Math.round(stepsPer * 2.2) : stepsPer;
      for (let i = 0; i <= n; i++) {
        // cluster samples toward the tip, where the dome turns fastest
        let s;
        if (isLast) {
          const q = i / n;
          s = sg.sMin + (sg.sMax - sg.sMin) * (1 - Math.pow(1 - q, 1.55));
        } else {
          s = sg.sMin + (1 - sg.sMin) * (i / n);
        }
        const [a1, a2] = silhouetteAlphas(rig, view, d, sg.seg, s);
        const q1 = digitSurface(rig, d, sg.seg, s, a1).P;
        const q2 = digitSurface(rig, d, sg.seg, s, a2).P;
        let pA = view.px(q1), pB = view.px(q2);
        let nA = view.near(q1), nB = view.near(q2), aA = a1, aB = a2;
        // Keep each rail continuous: a foreshortened segment swings its
        // silhouette right around the section, and the naive left/right test
        // flips. Assign whichever pairing stays nearest the previous points.
        if (prevL && prevR && d2(pA, prevL) + d2(pB, prevR) > d2(pB, prevL) + d2(pA, prevR)) {
          let t;
          t = pA; pA = pB; pB = t;
          t = nA; nA = nB; nB = t;
          t = aA; aA = aB; aB = t;
        }
        // suppress whatever is buried in the interdigital web
        const okA = sg.seg !== 1 || s >= AN.webStart(A, d, aA);
        const okB = sg.seg !== 1 || s >= AN.webStart(A, d, aB);
        if (okA) { left.push([pA[0], pA[1], nA, sg.pid, 1]); prevL = pA; }
        if (okB) { right.push([pB[0], pB[1], nB, sg.pid, 1]); prevR = pB; }
      }
    }

    // A segment pointing at the eye has no left and right: its whole cross
    // section is silhouette. Where a digit foreshortens, its outline is the
    // ring at the joint — which is exactly what a knuckle is — so emit it and
    // let the grazing gate and the depth test keep only the visible arc.
    const rings = [];
    for (let k = 0; k < segs.length; k++) {
      const sg = segs[k];
      // Only the knuckle is a real step in the outline. A digit tapers along
      // its length, so the proximal rim of a middle or distal phalanx lies
      // *inside* the wider segment behind it — drawn as a ring it reads as the
      // open end of a pipe, and a foreshortened hand comes out as a bundle of
      // cut tubes.
      if (sg.seg !== 1) continue;
      const f = Math.abs(vdot(sg.t, view.e));
      if (f < 0.50) continue;
      const gate = M.smoothstep(clamp01((f - 0.50) / 0.26));
      const sRing = sg.seg === 1 ? -0.02 : 0.055;
      const ring = [];
      const N = 44;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const q = digitSurface(rig, d, sg.seg, sRing, a).P;
        const nrm = digitNormal(rig, d, sg.seg, sRing, a);
        const fn = vdot(nrm, view.e);
        let g = gate * (1 - M.smoothstep(clamp01((Math.abs(fn) - 0.05) / 0.32)));
        if (sg.seg === 1 && sRing < AN.webStart(A, d, a)) g *= 0.25;
        const p = view.px(q);
        ring.push([p[0], p[1], view.near(q), sg.pid, g]);
      }
      rings.push(ring);
    }

    // The rails already trace a rounded fingertip: the profile closes as a
    // quarter ellipse, so the dome draws itself. Only a strongly foreshortened
    // digit needs an explicit cap, and there the outline is the widest ring.
    const tipSeg = segs[segs.length - 1];
    const fore = Math.abs(vdot(tipSeg.t, view.e));
    const cap = [];
    if (fore > 0.58) {
      let bestS = 1, bestW = -1;
      for (let i = 0; i <= 12; i++) {
        const s = 1 + (tipSeg.sMax - 1) * (i / 12);
        const pr = AN.segmentProfile(A, d, tipSeg.seg, s);
        const p0 = view.px(digitSurface(rig, d, tipSeg.seg, s, 0).P);
        const p1 = view.px(digitSurface(rig, d, tipSeg.seg, s, Math.PI * 0.5).P);
        const c = view.px(vmad(tipSeg.A, tipSeg.t, tipSeg.len * s));
        const w = Math.max(Math.hypot(p0[0] - c[0], p0[1] - c[1]), Math.hypot(p1[0] - c[0], p1[1] - c[1]));
        if (w > bestW) { bestW = w; bestS = s; }
        void pr;
      }
      // Only the part of the ring that is actually a silhouette belongs in
      // the drawing: gate every point on how near its normal is to grazing.
      const gate = M.smoothstep(clamp01((fore - 0.58) / 0.20));
      const N = 40;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const q = digitSurface(rig, d, tipSeg.seg, bestS, a).P;
        const nrm = digitNormal(rig, d, tipSeg.seg, bestS, a);
        const f = vdot(nrm, view.e);
        const g = gate * (1 - M.smoothstep(clamp01((Math.abs(f) - 0.05) / 0.36)));
        const p = view.px(q);
        cap.push([p[0], p[1], view.near(q), tipSeg.pid, g]);
      }
    }
    return { left, right, cap, rings, outline: right.concat(cap, left.slice().reverse()) };
  }

  /** closed screen outline of the palm sheet, used for occlusion and contour */
  function palmContour(rig, view, opts) {
    opts = opts || {};
    const NU = opts.nu || 44, NB = opts.nb || 96;
    // walk the two long borders (beta = 0 and beta = 0.5) plus the end arcs
    const radial = [], ulnar = [];
    const u0 = opts.u0 !== undefined ? opts.u0 : -0.10;
    const u1 = opts.u1 !== undefined ? opts.u1 : 1.055;
    for (let i = 0; i <= NU; i++) {
      const u = lerp(u0, u1, i / NU);
      const a = palmSurface(rig, u, 0.0);
      const b = palmSurface(rig, u, 0.5);
      const pa = view.px(a.P), pb = view.px(b.P);
      radial.push([pa[0], pa[1], view.near(a.P)]);
      ulnar.push([pb[0], pb[1], view.near(b.P)]);
    }
    const capDistal = [], capWrist = [];
    for (let i = 0; i <= NB; i++) {
      const t = i / NB;
      const beta = 0.5 - t * 0.5;
      const vAt = palmSurface(rig, u1, beta).v;
      const d1 = palmSurface(rig, rig.palm.uDistal(vAt, true), beta);
      const w1 = palmSurface(rig, u0, 0.5 + t * 0.5);   // wrist, dorsal face
      const pd = view.px(d1.P), pw = view.px(w1.P);
      capDistal.push([pd[0], pd[1], view.near(d1.P)]);
      capWrist.push([pw[0], pw[1], view.near(w1.P)]);
    }
    return {
      radial, ulnar, capDistal, capWrist,
      outline: radial.concat(capDistal, ulnar.slice().reverse(), capWrist)
    };
  }

  /**
   * The true screen outline of the palm sheet, for any view.
   *
   * Scanning the surface for where the normal grazes is unusable here: the
   * cross-section has a cusp at each rim, where the offset closes to zero and
   * the normal flips, and the scan fills with spurious crossings. Instead take
   * the cross-section's projected extremes along the direction perpendicular
   * to the sheet's own screen tangent. That is well defined in every view —
   * face-on it returns the two borders, edge-on it returns the palmar and
   * dorsal faces — and it never degenerates.
   */
  function palmSilhouette(rig, view, opts) {
    opts = opts || {};
    const NU = opts.nu || 54, NB = opts.nb || 96;
    const u0 = opts.u0 !== undefined ? opts.u0 : -0.44;
    const u1 = opts.u1 !== undefined ? opts.u1 : 1.03;
    const sideA = [], sideB = [];
    let betaA1 = 0, betaB1 = 0.5;
    let prevA = null, prevB = null;
    const d2 = (a, b) => (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);
    for (let i = 0; i <= NU; i++) {
      const u = lerp(u0, u1, i / NU);
      const c0 = palmSurface(rig, u - 0.012, 0.25).P;
      const c1 = palmSurface(rig, u + 0.012, 0.25).P;
      let t = view.dir(vsub(c1, c0));
      let tl = Math.hypot(t[0], t[1]);
      if (tl < 1e-6) { t = [0, 1]; tl = 1; }
      const nx = -t[1] / tl, ny = t[0] / tl;
      let minD = 1e18, maxD = -1e18, minP = null, maxP = null, bMin = 0, bMax = 0.5;
      for (let k = 0; k < NB; k++) {
        const beta = k / NB;
        const q = palmSurface(rig, u, beta).P;
        const p = view.px(q);
        const dd = p[0] * nx + p[1] * ny;
        if (dd < minD) { minD = dd; minP = [p[0], p[1], view.near(q)]; bMin = beta; }
        if (dd > maxD) { maxD = dd; maxP = [p[0], p[1], view.near(q)]; bMax = beta; }
      }
      // Keep each side of the outline continuous. The extremum can hand off
      // between the palmar and dorsal faces as the sheet turns, and an
      // unordered pair leaves a chord stitched across the form.
      if (prevA && prevB && d2(minP, prevA) + d2(maxP, prevB) > d2(maxP, prevA) + d2(minP, prevB)) {
        const t = minP; minP = maxP; maxP = t;
        const tb = bMin; bMin = bMax; bMax = tb;
      }
      sideA.push(minP); sideB.push(maxP);
      prevA = minP; prevB = maxP;
      if (i === NU) { betaA1 = bMin; betaB1 = bMax; }
    }

    // The palm has no distal end to close: four digits leave through it. The
    // only real boundary there is the web margin on the palmar face, running
    // proximally under each digit and distally between them. Closing the
    // dorsal half as well lays a box straight across the knuckles.
    const cap = [];
    const N = 46;
    for (let i = 0; i <= N; i++) {
      const beta = 0.5 * (i / N);                      // palmar face only
      const v = palmSurface(rig, u1, beta).v;
      const q = palmSurface(rig, rig.palm.uDistal(v, true), beta).P;
      const p = view.px(q);
      cap.push([p[0], p[1], view.near(q)]);
    }
    return { sideA, sideB, cap, u0, u1 };
  }

  /**
   * The free margins of the three interdigital webs. Each is a sheet of skin
   * spanning between two adjacent proximal phalanges, so its edge runs from a
   * point on one digit's ulnar flank to a point on the next digit's radial
   * flank, sagging a little proximally in between. Building it from the
   * flanks is what keeps it registered with the fingers it belongs to: a
   * margin invented on the palm either pokes past them or leaves a slit.
   */
  function webContours(rig, view) {
    const A = rig.anatomy;
    const out = [];
    for (let d = 1; d < 4; d++) {
      const sgA = rig.digits[d].segs[1], sgB = rig.digits[d + 1].segs[1];
      const aA = 0, aB = Math.PI;                       // ulnar flank, radial flank
      const PA = digitSurface(rig, d, 1, AN.webStart(A, d, aA), aA).P;
      const PB = digitSurface(rig, d + 1, 1, AN.webStart(A, d + 1, aB), aB).P;
      // sag: pull the midpoint back toward the knuckles and a touch palmar
      const mid = M.vlerp(PA, PB, 0.5);
      const prox = vnorm(vadd(sgA.t, sgB.t));
      const palmar = vnorm(vadd(sgA.pa, sgB.pa));
      const gap = M.vdist(PA, PB);
      const M1 = vmad(vmad(mid, prox, -gap * 0.30), palmar, gap * 0.06);
      const pts = [];
      const ctrl = [PA, PA, M1, PB, PB];
      for (let i = 0; i <= 26; i++) {
        const q = M.splineAt(ctrl, 1 + (i / 26) * 2);
        const p = view.px(q);
        pts.push([p[0], p[1], view.near(q), rig.palm.pid, 1]);
      }
      out.push(pts);
    }
    return out;
  }

  /**
   * The outline of a whole digit as one form.
   *
   * A digit pointing at the eye has no useful per-segment silhouette: its
   * rails collapse, its knuckle ring and its tip cap survive as two detached
   * ellipses, and the drawing comes out as a scatter of cut tubes. What a
   * draughtsman draws there is the outer boundary of the entire digit. The
   * projection is compact and near-convex in exactly the case that matters,
   * so a radial maximum about the projected centroid recovers it.
   *
   * Returns `use: false` when the digit reads long enough to draw the ordinary
   * way, which is most of the time.
   */
  function digitUnion(rig, view, d) {
    const A = rig.anatomy;
    const dg = rig.digits[d];
    const segs = dg.segs.filter(sg => sg.rendered);
    // how compact is this digit on screen, relative to how thick it is?
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, wSum = 0, wN = 0;
    for (const sg of segs) {
      for (let i = 0; i <= 4; i++) {
        const sv = sg.sMin + (sg.sMax - sg.sMin) * (i / 4);
        const p = view.px(vmad(sg.A, sg.t, sg.len * sv));
        if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
        wSum += AN.segmentProfile(A, d, sg.seg, Math.min(sv, 1))[0] * view.scale * 2;
        wN++;
      }
    }
    const axisSpan = Math.hypot(x1 - x0, y1 - y0);
    const width = wSum / Math.max(1, wN);
    if (axisSpan > width * 2.1) return { use: false };

    // sample the whole digit's surface and take the radial maximum
    const pts = [];
    for (const sg of segs) {
      const NS = 9, NA = 24;
      for (let i = 0; i <= NS; i++) {
        const sv = sg.sMin + (sg.sMax - sg.sMin) * (i / NS);
        for (let k = 0; k < NA; k++) {
          const q = digitSurface(rig, d, sg.seg, sv, (k / NA) * Math.PI * 2).P;
          const p = view.px(q);
          pts.push([p[0], p[1], view.near(q)]);
        }
      }
    }
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= pts.length; cy /= pts.length;
    const NB = 128;
    const rad = new Float64Array(NB).fill(-1);
    const dep = new Float64Array(NB);
    for (const p of pts) {
      const dx = p[0] - cx, dy = p[1] - cy;
      const r = Math.hypot(dx, dy);
      let b = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * NB) % NB;
      if (b < 0) b += NB;
      if (r > rad[b]) { rad[b] = r; dep[b] = p[2]; }
    }
    // fill any empty bins from their neighbours, then smooth the profile
    // circularly: taking a per-bin maximum straight out gives a sawtooth.
    let filled = 0;
    for (let b = 0; b < NB; b++) if (rad[b] >= 0) filled++;
    if (filled < NB * 0.5) return { use: false };
    for (let b = 0; b < NB; b++) {
      if (rad[b] >= 0) continue;
      let lo = b, hi = b, n = 0;
      while (rad[(lo + NB) % NB] < 0 && n++ < NB) lo--;
      n = 0;
      while (rad[hi % NB] < 0 && n++ < NB) hi++;
      const a = rad[((lo % NB) + NB) % NB], c2 = rad[hi % NB];
      rad[b] = (a + c2) * 0.5;
      dep[b] = (dep[((lo % NB) + NB) % NB] + dep[hi % NB]) * 0.5;
    }
    for (let pass = 0; pass < 3; pass++) {
      const src = Float64Array.from(rad);
      const sd = Float64Array.from(dep);
      for (let b = 0; b < NB; b++) {
        const p0 = src[(b - 1 + NB) % NB], p2 = src[(b + 1) % NB];
        rad[b] = (p0 + src[b] * 2 + p2) * 0.25;
        dep[b] = (sd[(b - 1 + NB) % NB] + sd[b] * 2 + sd[(b + 1) % NB]) * 0.25;
      }
    }
    const outline = [];
    for (let b = 0; b <= NB; b++) {
      const i = b % NB;
      const th = (i / NB) * Math.PI * 2 - Math.PI;
      outline.push([cx + Math.cos(th) * rad[i], cy + Math.sin(th) * rad[i], dep[i], segs[0].pid, 1]);
    }
    return { use: true, outline };
  }

  /**
   * The first web: the commissure between thumb and index. It is a genuine
   * sheet of skin, and it is what keeps a strongly opposed thumb attached to
   * the hand — the distal thumb metacarpal really does stand clear of the
   * palm, so without the web the thumb draws as an object floating beside it.
   *
   * Returns the free margin (the edge that shows in outline) and a ladder of
   * rungs across the sheet, which the rasteriser fills so the web occludes.
   */
  function firstWeb(rig, view) {
    const A = rig.anatomy;
    const thPP = rig.digits[0].segs[1];
    const ixPP = rig.digits[1].segs[1];
    const ixMCP = ixPP.A, thMCP = thPP.A;

    // which way round each digit faces its neighbour
    const facingAlpha = (d, seg, sv, target) => {
      let best = 0, bestDot = -2;
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        const q = digitSurface(rig, d, seg, sv, a);
        const n = digitNormal(rig, d, seg, sv, a);
        const dot = vdot(n, vnorm(vsub(target, q.P)));
        if (dot > bestDot) { bestDot = dot; best = a; }
      }
      return best;
    };
    const aTh = facingAlpha(0, 1, 0.30, ixMCP);
    const aIx = facingAlpha(1, 1, 0.30, thMCP);

    // The sheet runs from deep in the palm out to a free margin between the
    // two digits. Sample it as a ladder: thumb side, index side, one rung per
    // step, with the margin the last rung.
    const NR = 9;
    const thSide = [], ixSide = [];
    for (let i = 0; i <= NR; i++) {
      const t = i / NR;
      thSide.push(digitSurface(rig, 0, 1, lerp(-0.25, 0.38, t), aTh).P);
      const sIx = lerp(-0.24, AN.webStart(A, 1, aIx) * 0.95, t);
      ixSide.push(digitSurface(rig, 1, 1, sIx, aIx).P);
    }
    // free margin: the distal rung, sagging back toward the palm
    const PT = thSide[NR], PI = ixSide[NR];
    const span = M.vdist(PT, PI);
    const mid = M.vlerp(PT, PI, 0.5);
    const prox = vnorm(vadd(thPP.t, ixPP.t));
    const sag = vmad(mid, prox, -span * 0.13);
    const margin = [];
    const ctrl = [PT, PT, sag, PI, PI];
    for (let i = 0; i <= 30; i++) {
      const q = M.splineAt(ctrl, 1 + (i / 30) * 2);
      const p = view.px(q);
      margin.push([p[0], p[1], view.near(q), rig.palm.pid, 1]);
    }
    return { thSide, ixSide, margin, PT, PI, sag };
  }

  GK.rig = {
    FLEX, ABD, TWIST, IDENT, View, solve, abdGate,
    palmSpine, palmSurface, palmNormal, palmThickPalmar, palmThickDorsal, palmWrap,
    digitSurface, digitNormal, silhouetteAlphas, digitContour, digitUnion, palmContour, palmSilhouette, webContours, firstWeb,
    PALM_NU, V_KNOTS
  };
})(window.GK = window.GK || {});
