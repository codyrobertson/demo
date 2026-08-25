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
  const { vadd, vsub, vmul, vmad, vdot, vcross, vnorm, vlen, vdist, vlerp, vcopy, mApply, mMul, mOrtho } = M;

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
          // Every segment begins a little *before* its own joint, and how much
          // before depends on how hard that joint is bent.
          //
          // A joint is two cylinders hinged together, and on the OUTSIDE of a
          // bend their ends part company: to keep the two solids reading as
          // one across a bend of angle t, the distal one has to reach back
          // about r * tan(t/2) past the hinge. At zero it costs nothing, which
          // is why this went unnoticed - a relaxed hand is fine. Hard flexed
          // it is most of a phalanx: measured on a maximal clench, the depth
          // field had open pipe ends where the knuckles should be, occlusion
          // failed in every one of those gaps, and the drawing came out as a
          // scatter of separate sausages rather than a fist.
          //
          // The proximal phalanx carries an extra fixed amount on top, because
          // its condyle has to plug into the end of the palm. That condyle is
          // the knuckle: it has to belong to the digit, or the palm's own
          // solid swallows it and a fist comes out with no knuckles at all.
          sMin: seg === 0 ? 0 : -((seg === 1 ? 0.12 : 0) + jointReach(A, d, seg, len, joints[seg].flex)),
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
    // closes with the thumb instead of being a fixed lobe. One representative
    // point (the old approach) stands in fine for a thumb near rest, but
    // opposition and cupping swing the metacarpal enough that a single sample
    // stops speaking for the rest of it, and the border reaches for the wrong
    // place while the base of the bone goes uncovered. Track several points
    // along its length instead, and let each u pull toward whichever of them
    // is relevant there.
    const tmc = rig.digits[0].segs[0];
    const palmRef = {
      grid, norms, nu: PALM_NU, u0: PALM_U0, u1: PALM_U1, knots: V_KNOTS,
      vLo: () => -3, vHi: () => 3
    };
    rig.palm = palmRef;
    const samples = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0].map((sv) => {
      const P = vmad(tmc.A, tmc.t, tmc.len * sv);
      let bestD = 1e18, bu = 0.5, bv = -0.5;
      for (let iu = 0; iu <= 16; iu++) {
        for (let iv = 0; iv <= 32; iv++) {
          const uu = lerp(-0.15, 1.05, iu / 16), vv = lerp(-1.45, 0.05, iv / 32);
          const q = palmSpine(rig, uu, vv).P;
          const dd = (q[0] - P[0]) ** 2 + (q[1] - P[1]) ** 2 + (q[2] - P[2]) ** 2;
          if (dd < bestD) { bestD = dd; bu = uu; bv = vv; }
        }
      }
      return { sv, u: bu, v: clamp(bv, -1.35, -0.10) };
    });
    const head = samples[samples.length - 1];   // the metacarpal head
    const track = samples.slice().sort((p, q) => p.u - q.u);
    // v the border should reach for at a given u, held flat past either end
    // of the tracked span rather than extrapolated, which is what lets the
    // wrist taper (below) and the web pinch (in vHi) still have the last word
    const thumbVAt = (u) => {
      if (u <= track[0].u) return track[0].v;
      if (u >= track[track.length - 1].u) return track[track.length - 1].v;
      for (let i = 0; i < track.length - 1; i++) {
        const a = track[i], b = track[i + 1];
        if (u <= b.u) return lerp(a.v, b.v, inv(u, a.u, b.u));
      }
      return track[track.length - 1].v;
    };
    const thumbV = thumbVAt(0.55), thumbU = 0.55;
    // The thenar's resting profile: a lobe over the thumb metacarpal that
    // returns to the rim at both ends - into the wrist proximally, into the
    // first web distally.
    const lobe = (u, c, wProx, wDist) =>
      Math.exp(-Math.pow((u - c) / (u < c ? wProx : wDist), 2));
    // wider proximally, where the eminence runs back to the wrist, than
    // distally, where it has to be off the sheet by the metacarpal heads -
    // past them the space between the rays is web, not palm, and a border
    // still carrying thenar width out there draws as a straight radial edge
    const REF_C = 0.46, REF_W = 0.54, REF_WD = 0.34, REF_A = 0.52;
    /** furthest the border may be drawn beyond that resting profile */
    const EMAX = 0.30;

    rig.palm = {
      grid, norms,
      nu: PALM_NU, u0: PALM_U0, u1: PALM_U1,
      knots: V_KNOTS, thumbV, thumbU,
      // The borders carry the eminences: the radial edge swells over the
      // thenar and pulls back in at the thumb web, the ulnar edge over the
      // hypothenar. Extrapolating past the outer metacarpals does the work.
      vLo: (u) => {
        const uu = clamp(u, -0.6, 1.3);
        const ref = -0.20 - REF_A * lobe(uu, REF_C, REF_W, REF_WD);
        // Muscle does not follow bone wherever the bone goes. The thenar is
        // anchored on the carpus and tethered across the first web, so an
        // abducting thumb draws it out only so far before the web - not the
        // palm - takes up the rest, and however the thumb is held the border
        // must still come back to the rim past the metacarpal head, or the
        // sheet keeps its full width out through the knuckles and reads as a
        // flat wedge. So the tracked bone enters as a saturating excursion
        // beyond the resting lobe, through a lobe of its own centred on the
        // head, and never as a position. Opposition, which swings the bone
        // back across the palm, leaves the resting thenar standing rather
        // than flattening it: the muscle bunches, it does not vanish.
        const want = Math.min(0, thumbVAt(uu) - ref);
        const extra = -EMAX * (1 - Math.exp(want / EMAX));
        const raw = Math.min(-0.20, ref + extra * lobe(uu, head.u, 0.46, 0.24));
        return VMID - (VMID - raw) * wristNarrow(uu);
      },
      /** where the radial border sits for a hand with the thumb at rest */
      vLoRef: (u) => {
        const uu = clamp(u, -0.6, 1.3);
        const raw = -0.20 - REF_A * lobe(uu, REF_C, REF_W, REF_WD);
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
    // Padding, and it thins at both ends. Toward the wrist because the
    // tendons run straight over the carpus with nothing under them; toward
    // the knuckles because the metacarpal heads are subcutaneous, which is
    // the whole reason a knuckle shows at all. Carried at full depth to the
    // distal edge it swallowed the base of the proximal phalanx - measured
    // at rest, the little finger's knuckle sat 3mm inside the palm's own
    // solid, and in a cupped hand 4.6mm.
    let base = 4.4;
    base *= lerp(0.46, 1.0, smoothstep(clamp01((u + 0.30) / 0.56)));
    base *= lerp(1.0, 0.26, smoothstep(clamp01((u - 0.86) / 0.22)));
    // and thinnest of all over the fifth head, which is the most
    // subcutaneous bone on the hand - it is the one that breaks in a
    // boxer's fracture, and the one whose knuckle stands proudest
    base *= lerp(1.0, 0.62, smoothstep(clamp01((v - 0.70) / 0.32)) *
      smoothstep(clamp01((u - 0.80) / 0.24)));
    // the shafts of the metacarpals show through as low ridges
    base += 0.9 * Math.pow(Math.abs(Math.cos(Math.PI * 3 * v)), 3) *
      M.smoothstep(clamp01((v + 0.20) / 0.28)) *
      (1 - smoothstep(clamp01((u - 0.86) / 0.20)));
    // and the heads themselves sit on top of it, at their own depth: they
    // are bone, so they do not thin with the padding around them
    let t = base;
    for (let i = 0; i < 4; i++) {
      const vc = i / 3;
      t += (1.1 + 4.4 * kn[i]) * A.knuckles.prominence *
        Math.exp(-Math.pow((u - 0.985) / 0.145, 2)) *
        Math.exp(-Math.pow((v - vc) / 0.155, 2));
    }
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
    // palmNormal is a difference of these, so the dent turns the normal too
    return { P: rig.soft ? softPoint(rig, P) : P, v, palmar, spine: sp.P, n: sp.n, off, thick, wrap };
  }

  /** numeric surface normal on the palm */
  function palmNormal(rig, u, beta) {
    const h = 0.006;
    // c0 answers both what palmSurface(rig, u, beta) used to be asked for
    // twice: the centre point for the finite difference, and .n/.palmar for
    // the orientation reference below. Calling it a second time returned the
    // same object every time - rig and (u, beta) are exactly what it reads -
    // so the second call was never disagreeing with the first, only paying
    // for palmSpine and the thickness fields all over again to reconfirm it.
    const c0 = palmSurface(rig, u, beta);
    const p0 = c0.P;
    const pu = palmSurface(rig, clamp(u + h, -0.1, 1.12), beta).P;
    const pb = palmSurface(rig, u, beta + h).P;
    const Tu = vsub(pu, p0), Tb = vsub(pb, p0);
    let N = vnorm(vcross(Tb, Tu));
    const ref = vmul(c0.n, c0.palmar ? 1 : -1);
    if (vdot(N, ref) < 0) N = vmul(N, -1);
    return N;
  }

  // =========================================================================
  //  DIGIT SURFACE
  // =========================================================================

  /**
   * Where a section's centre sits off its bone axis, in the bone's own frame.
   *
   * Only the thumb's metacarpal uses this: the thenar is muscle piled on the
   * palmar-radial side of the HAND, not a sleeve centred on the bone. Which
   * frame that displacement belongs to matters as soon as the metacarpal's
   * axial set changes - tie it to the bone's own dorsal axis and the muscle
   * rotates with the roll and slides off the bone it is there to cover. So
   * segmentProfile gives the magnitude and this resolves the direction, out
   * of the hand's palmar axis and into the section's plane.
   */
  function sectionOffset(rig, d, seg, pr) {
    const m = -(pr[3] || 0), u = pr[2] || 0;
    if (!m) return [u, 0];
    const sg = rig.digits[d].segs[seg];
    const cu = vdot(rig.root[2], sg.ul), cd = vdot(rig.root[2], sg.dor);
    const n = Math.hypot(cu, cd);
    if (n < 1e-6) return [u, -m];
    return [u + m * (cu / n), m * (cd / n)];
  }

  /**
   * Surface point on a digit segment; alpha 0 = ulnar, +pi/2 = dorsal.
   *
   * `pr0`, when the caller already has it, is this section's segmentProfile
   * - optional, and only ever passed by a caller about to ask digitNormal
   * for the same (d, seg, s) right after, so it can hand that call the
   * profile back too instead of making it re-derive one this function
   * already has sitting in a local variable. Every other caller leaves it
   * out and gets exactly what this function always computed for itself.
   */
  function digitSurface(rig, d, seg, s, alpha, pr0) {
    const A = rig.anatomy;
    const sg = rig.digits[d].segs[seg];
    const pr = pr0 || AN.segmentProfile(A, d, seg, s);
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const off = sectionOffset(rig, d, seg, pr);
    const offU = off[0], offD = off[1];
    const P = [
      sg.A[0] + sg.t[0] * sg.len * s + sg.ul[0] * (pr[0] * ca + offU) + sg.dor[0] * (pr[1] * sa + offD),
      sg.A[1] + sg.t[1] * sg.len * s + sg.ul[1] * (pr[0] * ca + offU) + sg.dor[1] * (pr[1] * sa + offD),
      sg.A[2] + sg.t[2] * sg.len * s + sg.ul[2] * (pr[0] * ca + offU) + sg.dor[2] * (pr[1] * sa + offD)
    ];
    return { P: rig.soft ? softPoint(rig, P) : P, a: pr[0], b: pr[1], seg: sg, pr, off };
  }


  // =========================================================================
  //  SOFT CONTACT — WHAT THE BALL DOES TO THE HAND
  //
  //  A hand holding a ball is not a hand with a ball drawn next to it. Skin
  //  gives: the pads flatten where they take the weight, and the tissue that
  //  went out of the dent has to go somewhere, so it stands up in a low ring
  //  around it. Without that the ball reads as pasted on however carefully
  //  the fingers are placed around it, because every edge stays exactly as
  //  round as it was when nothing was touching it.
  //
  //  Done here - in the surface itself - rather than as marks laid over the
  //  top, so everything that reads the surface inherits it at once: the
  //  silhouette bends round the dent because the silhouette is traced from
  //  this surface, the modelling turns because the normal turns, and a
  //  crease crossing the contact rides over the ring instead of through it.
  // =========================================================================

  /**
   * Set up the ball's deformation of the hand, or clear it.
   *
   * The depth is measured against the undeformed hand - which is why `soft`
   * is cleared before sampling - and everything else scales off that, so a
   * ball resting on the palm dimples it and a ball squeezed hard dents deep
   * and throws up a correspondingly bigger ring.
   */
  function softContact(rig, amount) {
    rig.soft = null;
    const b = rig.ball;
    if (!b || !(amount > 0.01)) return;
    let pen = 0;
    const probe = (P) => {
      const v = b.r - Math.hypot(P[0] - b.C[0], P[1] - b.C[1], P[2] - b.C[2]);
      if (v > pen) pen = v;
    };
    for (let d = 0; d < 5; d++) {
      for (const sg of rig.digits[d].segs) {
        if (!sg.rendered) continue;
        for (let i = 0; i <= 6; i++) {
          const s = lerp(sg.sMin, sg.sMax, i / 6);
          for (let k = 0; k < 12; k++) probe(digitSurface(rig, d, sg.seg, s, (k / 12) * Math.PI * 2).P);
        }
      }
    }
    for (let i = 0; i <= 14; i++) {
      for (let k = 0; k <= 10; k++) {
        probe(palmSurface(rig, lerp(-0.2, 1.02, i / 14), (k / 10) * 0.5).P);
      }
    }
    if (pen < 0.12) return;
    rig.soft = {
      C: b.C, r: b.r, amount: clamp(amount, 0, 1.6), pen,
      // how sharply the skin turns into the contact. Zero would crease it
      // along the rim like a paper bag; a millimetre or so is knuckle skin.
      ease: 1.35,
      // how far out the displaced tissue reaches, and how high it stands
      rim: clamp(pen * 2.4, 2.4, 11),
      bulge: pen * 0.42,
    };
  }

  /**
   * The displacement at one point: how far it moves, and which way.
   *
   * Straight out along the radius from the ball's centre. Pushed to exactly
   * the sphere it would crease at the rim, so the press is a smooth minimum
   * rather than a clamp - deep in the contact it resolves the penetration
   * completely, and it lets go over the last millimetre instead of stopping
   * dead. The ring outside is the same tissue arriving, so it rises and
   * falls over the rim's width and is gone by the end of it.
   */
  function softField(sf, P) {
    const ax = P[0] - sf.C[0], ay = P[1] - sf.C[1], az = P[2] - sf.C[2];
    const rho = Math.sqrt(ax * ax + ay * ay + az * az);
    if (rho < 1e-6) return null;
    const rel = rho - sf.r;
    if (rel > sf.rim) return null;
    const e = sf.ease;
    const root = Math.sqrt(rel * rel + e * e);
    const press = 0.5 * (root - rel);
    const t = clamp01(rel / sf.rim);
    const ring = sf.bulge * 4 * t * (1 - t);
    const w = (press - ring) * sf.amount;
    // d/drho of the same, for the normal
    const dw = (0.5 * (rel / root - 1) - sf.bulge * 4 * (1 - 2 * t) / sf.rim) * sf.amount;
    return { u: [ax / rho, ay / rho, az / rho], w, dw };
  }

  /** a surface point, moved by the contact */
  function softPoint(rig, P) {
    const sf = rig.soft;
    if (!sf) return P;
    const f = softField(sf, P);
    if (!f) return P;
    return [P[0] + f.u[0] * f.w, P[1] + f.u[1] * f.w, P[2] + f.u[2] * f.w];
  }

  /**
   * The normal, turned by the contact.
   *
   * To first order a surface displaced by h along its own normal turns by the
   * tangential gradient of h, and h here is the radial displacement resolved
   * onto the normal. That is what makes the dent read: the rim catches the
   * light on its outer slope and loses it on the inner one, which is the only
   * thing that separates a pressed pad from a flat one.
   */
  function softNormal(rig, P, N) {
    const sf = rig.soft;
    if (!sf) return N;
    const f = softField(sf, P);
    if (!f) return N;
    const un = vdot(f.u, N);
    const g = f.dw * un;
    const gn = g * un;
    const t = [f.u[0] * g - N[0] * gn, f.u[1] * g - N[1] * gn, f.u[2] * g - N[2] * gn];
    return vnorm([N[0] - t[0], N[1] - t[1], N[2] - t[2]]);
  }

  /**
   * How far a segment reaches back past its own joint, as a fraction of its
   * length, so that its solid and its parent's stay one solid through a bend.
   *
   * Capped, because the geometric answer runs away as the bend approaches a
   * right angle and beyond - and because reaching back too far pushes the
   * narrower distal bone out through the palmar side of the wider one on the
   * INSIDE of the bend, which trades a hole for a lump.
   */
  function jointReach(A, d, seg, len, flex) {
    const bend = clamp(flex, 0, 2.4);
    if (bend < 0.05) return 0;
    const pr = AN.segmentProfile(A, d, seg, 0);
    const r = Math.max(pr[0], pr[1]);
    return Math.min(0.18, 0.62 * r * Math.tan(bend * 0.5) / Math.max(1e-6, len));
  }

  /** section centre of a digit segment, including any offset from segmentProfile */
  function sectionCenter(rig, d, seg, s) {
    const sg = rig.digits[d].segs[seg];
    const pr = AN.segmentProfile(rig.anatomy, d, seg, s);
    const off = sectionOffset(rig, d, seg, pr);
    return vmad(vmad(vmad(sg.A, sg.t, sg.len * s), sg.ul, off[0]), sg.dor, off[1]);
  }

  /**
   * Outward surface normal on a digit segment.
   *
   * `pr0`/`off0` let a caller that just computed digitSurface at this same
   * (d, seg, s) hand its segmentProfile and sectionOffset straight in,
   * rather than have this function spend a segmentProfile call and a
   * sectionOffset call re-deriving values it was just given the inputs to
   * skip. projectCurve, knuckleRings and firstWeb all call digitSurface and
   * digitNormal back to back at the same point for exactly this reason - a
   * curve needs both the surface and the way it faces - and passing them
   * through is arithmetically inert: p0 and o0 below end up holding the
   * identical values a bare call would have computed, just once instead of
   * twice.
   */
  function digitNormal(rig, d, seg, s, alpha, pr0, off0) {
    const A = rig.anatomy;
    const sg = rig.digits[d].segs[seg];
    const h = 0.004;
    const p0 = pr0 || AN.segmentProfile(A, d, seg, s);
    const p1 = AN.segmentProfile(A, d, seg, s + h);
    const da = (p1[0] - p0[0]) / h, db = (p1[1] - p0[1]) / h;
    // the section-centre offset (see sectionOffset) can also move with s
    const o0 = off0 || sectionOffset(rig, d, seg, p0), o1 = sectionOffset(rig, d, seg, p1);
    const dOffU = (o1[0] - o0[0]) / h, dOffD = (o1[1] - o0[1]) / h;
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    // dP/dalpha
    const Pa = [
      sg.ul[0] * (-p0[0] * sa) + sg.dor[0] * (p0[1] * ca),
      sg.ul[1] * (-p0[0] * sa) + sg.dor[1] * (p0[1] * ca),
      sg.ul[2] * (-p0[0] * sa) + sg.dor[2] * (p0[1] * ca)
    ];
    // dP/ds
    const Ps = [
      sg.t[0] * sg.len + sg.ul[0] * (da * ca + dOffU) + sg.dor[0] * (db * sa + dOffD),
      sg.t[1] * sg.len + sg.ul[1] * (da * ca + dOffU) + sg.dor[1] * (db * sa + dOffD),
      sg.t[2] * sg.len + sg.ul[2] * (da * ca + dOffU) + sg.dor[2] * (db * sa + dOffD)
    ];
    let N = vnorm(vcross(Pa, Ps));
    // guarantee outward orientation against the radial direction of the section
    const ref = [
      sg.ul[0] * ca + sg.dor[0] * sa,
      sg.ul[1] * ca + sg.dor[1] * sa,
      sg.ul[2] * ca + sg.dor[2] * sa
    ];
    if (vdot(N, ref) < 0) N = vmul(N, -1);
    return rig.soft ? softNormal(rig, digitSurface(rig, d, seg, s, alpha).P, N) : N;
  }


  // =========================================================================
  //  SILHOUETTE CONTOURS
  // =========================================================================

  /**
   * The knuckle rings of a digit.
   *
   * A digit's own outline is traced from its coverage (digitSilhouette), and
   * the knuckle is inside that trace rather than on it - so where a finger
   * foreshortens hard enough that the joint reads as a step in the form, the
   * ring has to be drawn in its own right. Only the metacarpophalangeal one:
   * a digit tapers along its length, so the proximal rim of a middle or
   * distal phalanx lies *inside* the segment behind it, and drawn as a ring
   * it reads as the open end of a pipe.
   */
  function knuckleRings(rig, view, d) {
    const A = rig.anatomy;
    const rings = [];
    for (const sg of rig.digits[d].segs) {
      if (!sg.rendered || sg.seg !== 1) continue;
      const f = Math.abs(vdot(sg.t, view.e));
      if (f < 0.50) continue;
      const gate = M.smoothstep(clamp01((f - 0.50) / 0.26));
      const sRing = -0.02;
      const ring = [];
      const N = 44;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const surf = digitSurface(rig, d, sg.seg, sRing, a);
        const fn = vdot(digitNormal(rig, d, sg.seg, sRing, a, surf.pr, surf.off), view.e);
        const q = surf.P;
        // only the arc where the surface grazes is an edge
        let g = gate * (1 - M.smoothstep(clamp01((Math.abs(fn) - 0.05) / 0.32)));
        // ...and where the web has buried it. This used to read `sRing <
        // webStart`, which looks like a comparison and is a constant: webStart
        // is a height times a smoothstep, so it is zero on the dorsal side and
        // never negative anywhere, and the ring is sampled at a fixed -0.02.
        // The test was therefore true at every angle on every finger in every
        // pose, and the knuckle - the one mark that says a foreshortened
        // finger has a joint in it rather than being a bent tube - has been
        // drawing at a quarter strength since it was written. What the damping
        // wants to know is whether there is any web at this angle at all.
        const web = AN.webStart(A, d, a);
        g *= lerp(1, 0.25, M.smoothstep(clamp01(web / 0.10)));
        const p = view.px(q);
        ring.push([p[0], p[1], view.near(q), sg.pid, g]);
      }
      rings.push(ring);
    }
    return rings;
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

  /** on-screen spine length across the metacarpals vs. the sheet's true (unforeshortened) width */
  function palmAxisRatio(rig, view, u0, u1) {
    const NC = 8;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, wSum = 0;
    for (let i = 0; i <= NC; i++) {
      const u = lerp(u0, u1, i / NC);
      const p = view.px(palmSpine(rig, u, VMID).P);
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
      wSum += vdist(palmSurface(rig, u, 0).P, palmSurface(rig, u, 0.5).P) * view.scale;
    }
    const axisSpan = Math.hypot(x1 - x0, y1 - y0);
    return axisSpan / Math.max(1e-6, wSum / (NC + 1));
  }

  /**
   * The palm's outline as a union: sample the whole sheet, take the radial
   * maximum about the projected centroid, bin by angle, fill the odd empty
   * bin from its neighbours. A digit answers the same problem by tracing the
   * border of what it covers, which assumes nothing about the projection's
   * shape; the palm can use the cheaper radial construction because,
   * foreshortened, it reads as a thin band rather than a blob, and a band
   * about its own centroid is star-shaped. What matters either way is only
   * that the surface is sampled densely enough to recover a boundary the
   * per-column extremes can't.
   *
   * Unlike a traced border, this one still has to survive palmSilhouette
   * callers' self-occlusion test, so a bin keeps the winning sample verbatim
   * rather than a radius reconstructed from a smoothed profile: a real point
   * is on the palm's own front surface by construction and passes; an
   * averaged one drifts depth and position out of step with each other and
   * reads as buried inside the solid it belongs to. A gap-filled bin
   * interpolates between two real neighbours, which stays close enough. Each
   * point carries the u it was won at, which is all splitRing needs to cut
   * the closed loop back into the two sides palmSilhouette hands its caller.
   */
  function palmUnionRing(rig, view, u0, u1) {
    const NS = 40, NA = 80, NBK = 128;
    const pts = [];
    for (let i = 0; i <= NS; i++) {
      const u = lerp(u0, u1, i / NS);
      for (let k = 0; k < NA; k++) {
        const q = palmSurface(rig, u, k / NA).P;
        const p = view.px(q);
        pts.push([p[0], p[1], view.near(q), u]);
      }
    }
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= pts.length; cy /= pts.length;
    const rad = new Float64Array(NBK).fill(-1);
    const ring = new Array(NBK);
    for (const p of pts) {
      const dx = p[0] - cx, dy = p[1] - cy;
      const r = Math.hypot(dx, dy);
      let b = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * NBK) % NBK;
      if (b < 0) b += NBK;
      if (r > rad[b]) { rad[b] = r; ring[b] = p; }
    }
    let filled = 0;
    for (let b = 0; b < NBK; b++) if (rad[b] >= 0) filled++;
    if (filled < NBK * 0.5) return null;
    for (let b = 0; b < NBK; b++) {
      if (ring[b]) continue;
      let lo = b, hi = b, n = 0;
      while (!ring[(lo + NBK) % NBK] && n++ < NBK) lo--;
      n = 0;
      while (!ring[hi % NBK] && n++ < NBK) hi++;
      const a = ring[((lo % NBK) + NBK) % NBK], c2 = ring[hi % NBK];
      ring[b] = [(a[0] + c2[0]) * 0.5, (a[1] + c2[1]) * 0.5, (a[2] + c2[2]) * 0.5, (a[3] + c2[3]) * 0.5];
    }
    return ring;
  }

  /**
   * Cuts palmUnionRing's closed loop into the two arcs running from its most
   * proximal point to its most distal one, then resamples each to NU+1
   * points at the same u values the rails use — not evenly by arc length —
   * so index i means the same column on both sides of a lerp between them.
   * Arc length would let a bump like the thenar land at a different index on
   * the two curves, so blending them would land on a point on neither.
   */
  function splitRing(ring, NU, u0, u1) {
    const NR = ring.length;
    let bWrist = 0, bTip = 0, uMin = Infinity, uMax = -Infinity;
    for (let b = 0; b < NR; b++) {
      if (ring[b][3] < uMin) { uMin = ring[b][3]; bWrist = b; }
      if (ring[b][3] > uMax) { uMax = ring[b][3]; bTip = b; }
    }
    const walk = (from, to) => {
      const out = [];
      let b = from;
      for (let n = 0; n <= NR; n++) {
        out.push(ring[b]);
        if (b === to) break;
        b = (b + 1) % NR;
      }
      return out;
    };
    const resample = (poly) => {
      const out = [];
      let j = 0;
      for (let i = 0; i <= NU; i++) {
        const target = lerp(u0, u1, i / NU);
        while (j < poly.length - 2 && poly[j + 1][3] < target) j++;
        const a = poly[j], b = poly[Math.min(poly.length - 1, j + 1)];
        const span = b[3] - a[3];
        const t = Math.abs(span) > 1e-9 ? clamp01((target - a[3]) / span) : 0;
        out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]);
      }
      return out;
    };
    return [resample(walk(bWrist, bTip)), resample(walk(bTip, bWrist).reverse())];
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
   *
   * Except the tangent itself can, the same way a per-section rail does: near
   * az 180 with the camera rising toward the fingertips, the sheet's u-axis
   * points almost straight at the eye, so a 0.012 step in u is nearly all
   * curvature and no slope, and the perpendicular built from it swings
   * wherever that curvature noise points rather than tracking the form. Each
   * column distrusts its own tangent exactly as far as a wide-baseline
   * reading of the same slope disagrees with it, and leans toward the wide
   * one by that amount — continuous in the disagreement, so nothing pops,
   * and at elevation 0, where the two already agree, it reproduces the old
   * rails exactly.
   *
   * That steadies the direction each column searches along, but a column is
   * still only one slice: once neighbouring slices project on top of each
   * other, u no longer orders the sheet on screen and no per-column extreme,
   * however carefully aimed, traces a boundary that doesn't cross itself.
   * The palm never gets small enough on screen to fall back to a whole
   * separate outline the way a foreshortened digit does — it just gets
   * thin — so palmUnionRing builds that fallback anyway, over the same
   * domain the rails cover, and every column fades its rail toward the
   * matching point on it in proportion to how thin the sheet reads
   * (palmAxisRatio). Both mechanisms are continuous functions of the view,
   * so an orbit through either transition never pops.
   */
  function palmSilhouette(rig, view, opts) {
    opts = opts || {};
    const NU = opts.nu || 54, NB = opts.nb || 96;
    const u0 = opts.u0 !== undefined ? opts.u0 : -0.44;
    const u1 = opts.u1 !== undefined ? opts.u1 : 1.03;
    const sideA = [], sideB = [];
    let prevA = null, prevB = null;
    const d2 = (a, b) => (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]);
    const WIDE = 0.28;
    const tangentAt = (u, h) => {
      const lo = Math.max(u0, u - h), hi = Math.min(u1, u + h);
      const t = view.dir(vsub(palmSurface(rig, hi, 0.25).P, palmSurface(rig, lo, 0.25).P));
      const tl = Math.hypot(t[0], t[1]);
      return tl > 1e-6 ? [t[0] / tl, t[1] / tl] : null;
    };
    const distrust = [];
    for (let i = 0; i <= NU; i++) {
      const u = lerp(u0, u1, i / NU);
      const tight = tangentAt(u, 0.012) || [0, 1];
      const wide = tangentAt(u, WIDE);
      let tx = tight[0], ty = tight[1], w = 0;
      if (wide) {
        const drift = Math.acos(clamp(tx * wide[0] + ty * wide[1], -1, 1)) * (180 / Math.PI);
        w = smoothstep(clamp01((drift - 8) / (30 - 8)));
        if (w > 0) {
          tx = lerp(tx, wide[0], w); ty = lerp(ty, wide[1], w);
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl; ty /= tl;
        }
      }
      distrust.push(w);
      const nx = -ty, ny = tx;
      let minD = 1e18, maxD = -1e18, minP = null, maxP = null;
      for (let k = 0; k < NB; k++) {
        const beta = k / NB;
        const q = palmSurface(rig, u, beta).P;
        const p = view.px(q);
        const dd = p[0] * nx + p[1] * ny;
        if (dd < minD) { minD = dd; minP = [p[0], p[1], view.near(q)]; }
        if (dd > maxD) { maxD = dd; maxP = [p[0], p[1], view.near(q)]; }
      }
      // Keep each side of the outline continuous. The extremum can hand off
      // between the palmar and dorsal faces as the sheet turns, and an
      // unordered pair leaves a chord stitched across the form.
      if (prevA && prevB && d2(minP, prevA) + d2(maxP, prevB) > d2(maxP, prevA) + d2(minP, prevB)) {
        const swap = minP; minP = maxP; maxP = swap;
      }
      sideA.push(minP); sideB.push(maxP);
      prevA = minP; prevB = maxP;
    }
    // A distrusted tangent still leaves a column free to pick between two
    // nearly-tied points on the loop, which is where the last of the jitter
    // survives. Leaning each point on its neighbours exactly as far as its
    // own tangent was distrusted mops that up without softening a column
    // that was never in question.
    const relax = (side) => {
      for (let pass = 0; pass < 3; pass++) {
        const src = side.map(p => p.slice());
        for (let i = 1; i < side.length - 1; i++) {
          const w = distrust[i] * 0.5;
          if (w <= 0) continue;
          for (let c = 0; c < 3; c++) {
            side[i][c] = lerp(src[i][c], (src[i - 1][c] + src[i][c] * 2 + src[i + 1][c]) * 0.25, w);
          }
        }
      }
    };
    relax(sideA); relax(sideB);

    // A steadied tangent still can't save a column once neighbouring columns
    // start projecting on top of each other — past that point u no longer
    // orders the sheet on screen, so no per-column extreme traces a boundary
    // that doesn't cross itself. That is the same collapse a digit answers by
    // tracing its coverage instead, one level up; the palm never gets compact
    // enough on screen for a blob, so instead every column fades toward the
    // union ring, in proportion to how thin the sheet reads.
    const ratio = palmAxisRatio(rig, view, u0, u1);
    const edgeOn = 1 - smoothstep(clamp01((ratio - 0.70) / (1.35 - 0.70)));
    if (edgeOn > 0.004) {
      const ring = palmUnionRing(rig, view, u0, u1);
      if (ring) {
        let [unionA, unionB] = splitRing(ring, NU, u0, u1);
        // The ring has no notion of which arc is "A": settle it once, by
        // whichever pairing agrees better with the rails where the rails are
        // themselves trusted, so the label can't flicker column to column.
        let same = 0, swapCost = 0;
        for (let i = 0; i <= NU; i++) {
          const wt = 1 - distrust[i];
          same += wt * (d2(sideA[i], unionA[i]) + d2(sideB[i], unionB[i]));
          swapCost += wt * (d2(sideA[i], unionB[i]) + d2(sideB[i], unionA[i]));
        }
        if (swapCost < same) { const t = unionA; unionA = unionB; unionB = t; }
        for (let i = 0; i <= NU; i++) {
          for (let c = 0; c < 3; c++) {
            sideA[i][c] = lerp(sideA[i][c], unionA[i][c], edgeOn);
            sideB[i][c] = lerp(sideB[i][c], unionB[i][c], edgeOn);
          }
        }
      }
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



  // =========================================================================
  //  THE OUTLINE OF A DIGIT, TRACED FROM ITS OWN COVERAGE
  //
  //  Every other way of finding a silhouette here starts from a cross-section
  //  and asks which way round it faces. That works while a finger runs across
  //  the picture and stops working the moment it turns to point at the eye:
  //  the two answers per section swing round and meet, so the rails spiral
  //  inward instead of ending on an edge, the tip has to be patched in from a
  //  second construction, and the patch and the rails then disagree about
  //  where the finger's edge is. Cross-fading between constructions cannot
  //  fix that, because there is no view in which both are right.
  //
  //  A silhouette is the boundary of what the form covers. So cover it: fill
  //  the digit's whole surface into a small mask, close the pinholes, and
  //  walk the border. One closed curve, joined by construction, correct from
  //  any direction, and with no assumption anywhere that the projection is
  //  star-shaped, convex, or longer than it is wide. The cost is a raster
  //  step per digit, which at this size is a few hundred microseconds.
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
    // Same hoist as DepthField.tri in 60-render.js, and for the same reason:
    // l1 and l2 are affine in (px, py), so the four coefficients below are
    // identical at every pixel this triangle covers and do not belong inside
    // the loop that visits them. The division by `d` stays a division, done
    // once per pixel exactly where it always was - turning it into a
    // multiply by a precomputed 1/d would change the rounding of every l1
    // and l2 in the mask by a bit that never shows on a smoothed, resampled
    // silhouette, but "never shows" is not the bar this file holds itself
    // to, so it is left a division.
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
   * The outline of one digit, as the border of everything it covers.
   *
   * `use: false` only when the digit renders to nothing at all. Points carry
   * screen position, the near-depth of the surface that put them there, the
   * identity of the bone that owns that surface - so the depth test can skip
   * the solid a line is the silhouette of - and a weight.
   */
  function digitSilhouette(rig, view, d, opts) {
    opts = opts || {};
    const dg = rig.digits[d];
    const segs = dg.segs.filter(sg => sg.rendered);
    if (!segs.length) return { use: false };
    const NA = opts.na || 30;
    const rings = [];
    for (const sg of segs) {
      const NS = opts.ns || 13;
      for (let i = 0; i <= NS; i++) {
        const s = sg.sMin + (sg.sMax - sg.sMin) * (i / NS);
        const row = [];
        for (let k = 0; k < NA; k++) {
          const a = (k / NA) * Math.PI * 2;
          const q = digitSurface(rig, d, sg.seg, s, a).P;
          const p = view.px(q);
          // The same two places a digit's edge is not its own edge, carried
          // on the surface itself so the border walk inherits them: the
          // thumb's metacarpal, which is thenar mass rather than a tube over
          // its proximal reach, and whatever a proximal phalanx has buried in
          // the web between it and its neighbour.
          let gn = 1;
          if (d === AN.THUMB && sg.seg === 0) gn = smoothstep(clamp01((s - 0.42) / 0.26));
          if (sg.seg === 1 && s < AN.webStart(rig.anatomy, d, a)) gn *= 0.22;
          row.push([p[0], p[1], view.near(q), gn]);
        }
        rings.push({ row, seg: sg.seg, s });
      }
    }
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
    const gx = (px) => (px - x0) / cell + PAD, gy = (py) => (py - y0) / cell + PAD;
    for (let r = 0; r + 1 < rings.length; r++) {
      const a = rings[r], b = rings[r + 1];
      const owner = a.seg;
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
    // follows the outside of the digit and not the inside of a crack.
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
    // a fingertip's curvature, coarse enough that the depth test isn't run
    // hundreds of times per digit for nothing.
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
      return [0, segs[0].seg, 1];
    };
    for (let i = 0; i <= NP; i++) {
      const want = (i / NP) * total;
      while (j < N && cum[j + 1] < want) j++;
      const a = pts[j % N], b = pts[(j + 1) % N];
      const seg = Math.max(1e-9, cum[j + 1] - cum[j]);
      const t = Math.max(0, Math.min(1, (want - cum[j]) / seg));
      const px = lerp(a[0], b[0], t), py = lerp(a[1], b[1], t);
      const [dz, own, gn] = sample(px, py);
      const sg = segs.find(z => z.seg === own) || segs[0];
      out.push([px, py, dz, sg.pid, gn]);
    }
    return { use: true, outline: out, area: total };
  }


  /**
   * The first web: the commissure between thumb and index. It is a genuine
   * sheet of skin, and it is what keeps a strongly opposed thumb attached to
   * the hand — the distal thumb metacarpal really does stand clear of the
   * palm, so without the web the thumb draws as an object floating beside it.
   *
   * Returns the free margin (the edge that shows in outline), a ladder of
   * rungs across the sheet, which the rasteriser fills so the web occludes,
   * and wedgeAt — because the commissure is not that ladder's bare sheet. It
   * is a wedge of real muscle, the adductor pollicis on the palmar side and
   * the bulkier first dorsal interosseous on the dorsal, and a membrane has
   * no depth to present when the hand turns edge-on: it projects to a
   * sliver and the thumb reads as a lump laid beside the hand rather than
   * joined to it. wedgeAt(t, k, side) offsets the ladder into a palmar and
   * a dorsal face — side +1 / -1, or 0 for the bare mid-sheet the ladder
   * already describes — tapered to nothing at k=0 and k=1, where the
   * commissure simply IS the thumb's or the index's own skin, so the two
   * faces close against those surfaces without a seam.
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
        const n = digitNormal(rig, d, seg, sv, a, q.pr, q.off);
        const dot = vdot(n, vnorm(vsub(target, q.P)));
        if (dot > bestDot) { bestDot = dot; best = a; }
      }
      return best;
    };
    const aTh = facingAlpha(0, 1, 0.30, ixMCP);
    const aIx = facingAlpha(1, 1, 0.30, thMCP);
    const aThM = facingAlpha(0, 0, 0.75, ixMCP);

    // The sheet runs from deep in the commissure out to a free margin between
    // the two digits. Deep matters: the thumb metacarpal stands some 30mm off
    // the palm's sheet, so no radial border drawn on that sheet can ever meet
    // it, and a web strung only between the two proximal phalanges leaves the
    // whole space between the rays open - which is what makes a thumb read as
    // a finger stuck on the side of the hand. So each side is a chain. The
    // thumb's climbs its metacarpal, crosses the MCP and runs onto the
    // phalanx; the index's starts on the palm's own radial border, so the two
    // solids meet with no seam, and sweeps onto the phalanx the same way.
    // Sample the pair as a ladder, one rung per step, the margin last.
    const HALF = 0.42;
    const sIxEnd = AN.webStart(A, 1, aIx) * 0.95;
    const atBorder = palmSurface(rig, 1.0, 0).P;
    const thRail = (t) => t < HALF
      ? digitSurface(rig, 0, 0, lerp(0.44, 1.0, t / HALF), aThM).P
      : digitSurface(rig, 0, 1, lerp(0, 0.38, (t - HALF) / (1 - HALF)), aTh).P;
    const ixRail = (t) => {
      if (t < HALF) return palmSurface(rig, lerp(0.42, 1.0, t / HALF), 0).P;
      const k = (t - HALF) / (1 - HALF);
      const onDigit = digitSurface(rig, 1, 1, lerp(0, sIxEnd, k), aIx).P;
      return M.vlerp(atBorder, onDigit, M.smoothstep(k));
    };
    const NR = 16;
    const thSide = [], ixSide = [];
    for (let i = 0; i <= NR; i++) {
      const t = i / NR;
      thSide.push(thRail(t));
      ixSide.push(ixRail(t));
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

    // ---- the wedge: real thickness, not a membrane ------------------------
    // A normal per rung, not one normal for the whole sheet: deep in the
    // commissure the wedge lies nearly flat against the palm, and by the
    // margin it has rolled out to stand between the two phalanges, so a
    // single normal borrowed from one end points the bulge the wrong way
    // over most of the other. Central differences on the rung midline give
    // the along-sheet tangent; the ladder's own width gives the across one.
    const spine = thSide.map((p, i) => M.vlerp(p, ixSide[i], 0.5));
    const rungNormal = thSide.map((p, i) => {
      const i0 = Math.max(0, i - 1), i1 = Math.min(NR, i + 1);
      const along = vsub(spine[i1], spine[i0]);
      const across = vsub(ixSide[i], thSide[i]);
      let n = vnorm(vcross(across, along));
      if (vdot(n, rig.root[2]) < 0) n = vmul(n, -1);   // palmar-positive
      return n;
    });
    const S = A.size, pad = A.palm.padding;
    // Roughly 8-12mm through at the depth of the commissure, tapering to
    // 2-4mm at the free margin; the interosseous outbulks the adductor, so
    // the dorsal face carries the larger share throughout.
    const throughAt = (t) => lerp(12.0, 3.5, smoothstep(clamp01(t))) * S * pad;
    const bow = (t, k) => t * Math.sin(Math.PI * k) * 0.18;
    /** a point on the wedge: t 0(deep)..1(margin), k 0(thumb)..1(index) flank, side -1 dorsal / 0 mid-sheet / +1 palmar */
    const wedgeAt = (t, k, side) => {
      t = clamp01(t); k = clamp01(k);
      const fi = t * NR;
      const i = Math.min(NR - 1, Math.floor(fi)), fr = fi - i;
      const a = M.vlerp(thSide[i], thSide[i + 1], fr), b = M.vlerp(ixSide[i], ixSide[i + 1], fr);
      const P = vmad(M.vlerp(a, b, k), prox, -M.vdist(a, b) * bow(t, k));
      if (!side) return P;
      // the taper that closes the wedge against the thumb's and the index's
      // own skin at k=0 and k=1 - without it the faces poke past surfaces
      // already modelled elsewhere and the join shows as a seam
      const taper = Math.sin(Math.PI * k);
      const through = throughAt(t) * taper;
      const n = M.vlerp(rungNormal[i], rungNormal[i + 1], fr);
      return vmad(P, n, side > 0 ? through * 0.42 : -through * 0.58);
    };
    // The wedge's own outline: a closed loop around its boundary, not a
    // search over its surface. Two of that boundary's four sides are
    // already known and already flat - thSide and ixSide, k=0 and k=1,
    // where the taper closes the wedge seamlessly against the thumb's and
    // the index's own skin - so only the other two, the free-standing ends
    // at t=0 and t=1, need a face chosen for them. Each end sweeps k with
    // whichever of the palmar or dorsal point is nearer the eye, blended
    // rather than switched so the loop never jumps as a view carries the
    // choice past its crossover. The t=1 end is the free margin and bulges
    // 2-4mm; the t=0 end is the depth of the commissure and bulges the
    // most, 8-12mm, which is the width this loop is chiefly for: a
    // membrane has nothing to show there at all.
    const NK_CAP = 16, EDGE_SOFT = 1.5;
    const capAt = (t) => {
      const pts = [];
      for (let j = 0; j <= NK_CAP; j++) {
        const k = j / NK_CAP;
        const qP = wedgeAt(t, k, 1), qD = wedgeAt(t, k, -1);
        const bl = smoothstep(clamp01((view.near(qP) - view.near(qD)) / EDGE_SOFT + 0.5));
        const q = M.vlerp(qD, qP, bl);
        const p = view.px(q);
        pts.push([p[0], p[1], view.near(q), rig.palm.pid, 1]);
      }
      return pts;
    };
    const flat = (rail) => rail.map((q) => {
      const p = view.px(q);
      return [p[0], p[1], view.near(q), rig.palm.pid, 1];
    });
    const band = flat(thSide).concat(capAt(1), flat(ixSide.slice().reverse()), capAt(0).reverse());
    return { thSide, ixSide, margin, PT, PI, sag, wedgeAt, band };
  }

  GK.rig = {
    FLEX, ABD, TWIST, IDENT, View, solve, abdGate,
    palmSpine, palmSurface, palmNormal, palmThickPalmar, palmThickDorsal, palmWrap,
    digitSurface, digitNormal, sectionCenter, softContact, knuckleRings, digitSilhouette, palmContour, palmSilhouette, webContours, firstWeb,
    PALM_NU, V_KNOTS
  };
})(window.GK = window.GK || {});
