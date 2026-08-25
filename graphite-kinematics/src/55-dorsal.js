/* ============================================================================
   GRAPHITE KINEMATICS — 55 · dorsal & construction
   Extensor tendons, the dorsal venous network, hair, skin lattice, and the
   skeleton itself: eight carpals, five metacarpals, fourteen phalanges.
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math;
  const AN = GK.anatomy;
  const R = GK.rig;
  const F = GK.features;
  const { TAU, DEG, clamp, clamp01, lerp, smoothstep } = M;
  const { vadd, vsub, vmul, vmad, vdot, vcross, vnorm, vlerp } = M;
  const HALF = Math.PI / 2;
  const { S, st, palmCurve, uvSpline, flexFrac, PALMAR, DORSAL } = F;

  // =========================================================================
  //  EXTENSOR TENDONS
  //  Four cords running from the wrist to the metacarpal heads. They stand
  //  proud when the fingers extend and sink away as they curl.
  // =========================================================================
  function tendons(rig, out) {
    const A = rig.anatomy;
    const prom = A.tendons.prominence;
    for (let d = 1; d < 5; d++) {
      const v = (d - 1) / 3;
      const ext = 1 - flexFrac(A, d, 'MCP', Math.max(0, rig.pose.digits[d].mcpFlex));
      const lift = clamp01(-rig.pose.digits[d].mcpFlex / (26 * DEG));
      const vis = clamp01(ext * 0.85 + lift * 0.5) * prom;
      if (vis < 0.06) continue;
      // A cord only reads where it stands proud of the metacarpal, over the
      // distal half of the back of the hand. Run it from wrist to knuckle and
      // it becomes a straight radiating spoke, which is not what a hand does.
      const ctrl = [
        [0.30, lerp(0.42, v, 0.52)],
        [0.52, lerp(0.44, v, 0.74)],
        [0.74, lerp(0.46, v, 0.92)],
        [0.92, v],
        [1.02, v]
      ];
      const mid = uvSpline(ctrl, 34);
      for (const sgn of [-1, 1]) {
        const off = mid.map(p => [p[0], p[1] + sgn * 0.026 * (0.4 + 0.6 * p[0])]);
        out.push({
          on: 'palm', pts: palmCurve(rig, off, false, 0.35 * vis),
          style: st(S.tendon, { tone: (0.16 + 0.34 * vis), taper: 0.94, phase: F.nextPhase() })
        });
      }
      // the tendon crest itself, brightest over the metacarpal shaft
      out.push({
        on: 'palm', pts: palmCurve(rig, mid, false, 0.6 * vis),
        style: st(S.tendon, { tone: 0.06 + 0.15 * vis, weight: 0.6, taper: 0.95, phase: F.nextPhase() })
      });
    }
    // extensor pollicis longus and the snuffbox, when the thumb extends
    const tExt = clamp01(-(rig.pose.digits[0].cmcRad || 0) / (24 * DEG)) +
      clamp01(-(rig.pose.digits[0].mcpFlex || 0) / (12 * DEG)) * 0.4;
    if (tExt > 0.1) {
      for (const off of [-0.055, 0.055]) {
        out.push({
          on: 'palm',
          pts: palmCurve(rig, uvSpline([[0.06, -0.10 + off], [0.34, -0.34 + off], [0.62, -0.54 + off], [0.86, -0.66 + off]], 26), false, 0.3),
          style: st(S.tendon, { tone: 0.43 + 0.93 * clamp01(tExt), phase: 1340 + (off > 0 ? 1 : 0) })
        });
      }
    }
  }

  // =========================================================================
  //  DORSAL VENOUS NETWORK
  //  Grown, not drawn: trunks rise from the wrist, meander, and branch toward
  //  the knuckles, each vessel rendered as its pair of walls.
  // =========================================================================
  function veins(rig, out) {
    const A = rig.anatomy;
    const V = A.veins;
    if (V.strength < 0.08) return;
    const rng = new M.Rng(A.seed ^ 0x6e01);
    const noise = new M.Noise(A.seed ^ 0x6e02);
    const segsOut = [];

    function grow(u, v, du, dv, cal, depth) {
      if (depth > 4 || cal < 0.28 || u > 1.02) return;
      const pts = [[u, v]];
      let cu = u, cv = v, dU = du, dV = dv;
      const steps = rng.int(9, 20);
      for (let i = 0; i < steps; i++) {
        const n = (noise.n2(cu * 5.2 + depth * 3.1, cv * 5.2) - 0.5) * 2;
        dV += n * 0.055 * V.meander;
        dU += (0.024 - dU) * 0.16;
        const L = 0.052;
        cu += dU * L * 1.0;
        cv += dV * L * 1.0;
        if (cu > 1.03 || cv < -0.50 || cv > 1.30) break;
        pts.push([cu, cv]);
      }
      if (pts.length < 3) return;
      segsOut.push({ pts, cal });
      if (rng.chance(V.branchProb) && depth < 4) {
        const side = rng.chance(0.5) ? 1 : -1;
        grow(cu, cv, dU * 0.9, dV + side * rng.range(0.5, 1.3), cal * rng.range(0.52, 0.74), depth + 1);
        grow(cu, cv, dU, dV - side * rng.range(0.1, 0.5), cal * rng.range(0.72, 0.92), depth + 1);
      } else if (depth < 4) {
        grow(cu, cv, dU, dV, cal * 0.86, depth + 1);
      }
    }

    for (let i = 0; i < V.trunks; i++) {
      const v0 = lerp(-0.18, 1.06, (i + 0.5) / V.trunks) + rng.sym(0.10);
      grow(rng.range(0.02, 0.14), v0, 1, rng.sym(0.5), V.caliber * rng.range(0.9, 1.35), 0);
    }

    for (let i = 0; i < segsOut.length; i++) {
      const sgm = segsOut[i];
      const sm = M.chaikin(sgm.pts, 2);
      const halfW = 0.0065 * sgm.cal;
      for (const sgn of [-1, 1]) {
        const wall = sm.map((p, k) => {
          const t = k / (sm.length - 1);
          const taper = Math.sin(Math.PI * clamp01(t * 0.9 + 0.05));
          return [p[0], p[1] + sgn * halfW * (0.55 + 0.45 * taper)];
        });
        out.push({
          on: 'palm', pts: palmCurve(rig, wall, false, 0.5 * sgm.cal),
          style: st(S.vein, { tone: 0.64 * V.strength * clamp01(sgm.cal), phase: 1400 + i * 2 + (sgn > 0 ? 1 : 0) })
        });
      }
    }
  }

  // =========================================================================
  //  DORSAL KNUCKLE FIELD
  //  Broad arcs over the metacarpal heads, plus the interosseous hollows.
  // =========================================================================
  function knuckleField(rig, out) {
    const A = rig.anatomy;
    for (let d = 1; d < 5; d++) {
      const v = (d - 1) / 3;
      const f = flexFrac(A, d, 'MCP', Math.max(0, rig.pose.digits[d].mcpFlex));
      const taut = clamp01(1 - f * 1.5);
      const rows = 2 + Math.round(taut * 3);
      for (let i = 0; i < rows; i++) {
        const u = 0.995 - i * 0.045 - taut * 0.01;
        out.push({
          on: 'palm',
          pts: palmCurve(rig, uvSpline([[u - 0.012, v - 0.115], [u, v], [u - 0.012, v + 0.115]], 16), false, 0.15),
          style: st(S.wrinkle, { tone: 0.23 + 0.85 * taut * (1 - i * 0.22), phase: F.nextPhase() })
        });
      }
      // the knuckle rises; mark its crest when the joint is bent
      if (f > 0.25) {
        out.push({
          on: 'palm',
          pts: palmCurve(rig, uvSpline([[1.015, v - 0.14], [1.045, v], [1.015, v + 0.14]], 20), false, 0.55),
          style: st(S.crease, { tone: 0.30 + 0.86 * (f - 0.25) / 0.75, weight: 0.95, phase: F.nextPhase() })
        });
      }
    }
    // The clefts between the knuckles. This is the single most characteristic
    // thing about the back of a closed hand, and it only exists when the
    // joints are bent: with the hand open the heads sit level and the skin
    // runs smooth across them.
    for (let d = 1; d < 4; d++) {
      const vGap = ((d - 1) + 0.5) / 3;
      const fA = flexFrac(A, d, 'MCP', Math.max(0, rig.pose.digits[d].mcpFlex));
      const fB = flexFrac(A, d + 1, 'MCP', Math.max(0, rig.pose.digits[d + 1].mcpFlex));
      const f = Math.min(fA, fB);
      if (f < 0.22) continue;
      const k = (f - 0.22) / 0.78;
      out.push({
        on: 'palm',
        pts: palmCurve(rig, uvSpline([
          [1.035, vGap], [0.985, vGap - 0.004], [0.925, vGap], [0.855, vGap + 0.006]
        ], 24), false, -0.55 - 0.9 * k),
        style: st(S.crease, { tone: 0.34 + 0.78 * k, weight: 0.92, phase: F.nextPhase() })
      });
      // a shorter companion, the way a deep cleft doubles at its mouth
      if (k > 0.45) {
        out.push({
          on: 'palm',
          pts: palmCurve(rig, uvSpline([[1.02, vGap + 0.030], [0.965, vGap + 0.026], [0.915, vGap + 0.030]], 16), false, -0.35),
          style: st(S.creaseFine, { tone: 0.5 + 0.8 * (k - 0.45) / 0.55, phase: F.nextPhase() })
        });
      }
    }

    // The crown of a bent knuckle carries a small central depression: the
    // extensor hood is thin where it passes over the head, and the skin dips
    // into it. Not everyone shows one.
    if (A.knuckles.dimple) {
      for (let d = 1; d < 5; d++) {
        const v = (d - 1) / 3;
        const f = flexFrac(A, d, 'MCP', Math.max(0, rig.pose.digits[d].mcpFlex));
        if (f < 0.52) continue;
        out.push({
          on: 'palm',
          pts: palmCurve(rig, uvSpline([[1.028, v - 0.030], [1.042, v], [1.028, v + 0.030]], 12), false, 0.35),
          style: st(S.fold, { tone: 1.1 * (f - 0.52) / 0.48, weight: 0.7, phase: F.nextPhase() })
        });
      }
    }

    // hollows between the metacarpals (the dorsal interossei)
    for (let d = 1; d < 4; d++) {
      const v = (d - 0.5) / 3;
      out.push({
        on: 'palm',
        pts: palmCurve(rig, uvSpline([[0.42, v], [0.66, v + 0.008], [0.90, v]], 20), false, -0.25),
        style: st(S.hatch, { tone: 0.90, weight: 0.55, phase: F.nextPhase() })
      });
    }
    // first dorsal interosseous: the bulge in the thumb web
    const spread = clamp01(((rig.pose.digits[0].cmcRad || 0) * -1 + (rig.pose.digits[0].cmcAbd || 0)) / (40 * DEG));
    out.push({
      on: 'palm',
      pts: palmCurve(rig, uvSpline([[0.94, -0.26], [0.80, -0.34], [0.62, -0.33], [0.48, -0.26]], 22), false, 0.2),
      style: st(S.fold, { tone: 0.41 + 0.70 * clamp01(spread), phase: F.nextPhase() })
    });
  }

  // =========================================================================
  //  HAIR
  // =========================================================================
  function hair(rig, out) {
    const A = rig.anatomy;
    const H = A.hair;
    if (H.density < 0.04) return;
    const rng = new M.Rng(A.seed ^ 0x7a01);

    // over the proximal phalanges
    for (let d = 1; d < 5; d++) {
      const n = Math.round(H.density * 13);
      for (let i = 0; i < n; i++) {
        const s = rng.range(0.18, 0.88);
        const a = DORSAL + rng.sym(0.85);
        const L = rng.range(0.035, 0.085) * H.length;
        const lean = H.lean + rng.sym(0.5);
        out.push({
          on: 'digit', d, seg: 1,
          pts: [[s, a, 0.1], [s + L * 0.6, a + lean * 0.10, 0.6], [s + L, a + lean * 0.20, 1.1]],
          style: st(S.hair, { tone: 0.53 + 0.67 * rng.f(), phase: F.nextPhase() })
        });
      }
      // a sparser tuft over the middle phalanx
      const n2 = Math.round(H.density * 5);
      for (let i = 0; i < n2; i++) {
        const s = rng.range(0.2, 0.8);
        const a = DORSAL + rng.sym(0.7);
        const L = rng.range(0.05, 0.11) * H.length;
        out.push({
          on: 'digit', d, seg: 2,
          pts: [[s, a, 0.1], [s + L, a + (H.lean + rng.sym(0.4)) * 0.16, 0.9]],
          style: st(S.hair, { tone: 0.40 + 0.53 * rng.f(), phase: F.nextPhase() })
        });
      }
    }
    // over the back of the hand
    const n3 = Math.round(H.density * 46);
    for (let i = 0; i < n3; i++) {
      const u = rng.range(0.18, 0.98);
      const v = rng.range(-0.38, 1.14);
      const L = rng.range(0.028, 0.062) * H.length;
      const lean = H.lean + rng.sym(0.6);
      out.push({
        on: 'palm',
        pts: palmCurve(rig, [[u, v], [u + L * 0.6, v + lean * 0.022], [u + L, v + lean * 0.045]], false, 0.9),
        style: st(S.hair, { tone: 0.37 + 0.53 * rng.f(), phase: F.nextPhase() })
      });
    }
  }

  // =========================================================================
  //  SKIN LATTICE
  //  The fine diamond mesh of dorsal skin. Barely there, but its absence is
  //  the difference between skin and rubber.
  // =========================================================================
  function skinLattice(rig, out, amount) {
    if (amount <= 0.01) return;
    const A = rig.anatomy;
    const rng = new M.Rng(A.seed ^ 0x8b01);
    const n = Math.round(150 * amount);
    for (let i = 0; i < n; i++) {
      const u = rng.range(0.10, 1.0);
      const v = rng.range(-0.50, 1.20);
      const L = rng.range(0.03, 0.075);
      const ang = (rng.chance(0.5) ? 0.72 : -0.72) + rng.sym(0.22);
      out.push({
        on: 'palm',
        pts: palmCurve(rig, [[u - Math.cos(ang) * L * 0.5, v - Math.sin(ang) * L], [u + Math.cos(ang) * L * 0.5, v + Math.sin(ang) * L]], false, 0),
        style: st(S.hatch, { tone: 0.50 + 0.60 * rng.f(), phase: F.nextPhase() })
      });
    }
    // and on the dorsum of the digits
    for (let d = 1; d < 5; d++) {
      for (let seg = 1; seg <= 2; seg++) {
        const m = Math.round(16 * amount);
        for (let i = 0; i < m; i++) {
          const s = rng.range(0.12, 0.9);
          const a = DORSAL + rng.sym(0.8);
          const L = rng.range(0.05, 0.11);
          const ang = (rng.chance(0.5) ? 1 : -1);
          out.push({
            on: 'digit', d, seg,
            pts: [[s - L * 0.5, a - ang * 0.13], [s + L * 0.5, a + ang * 0.13]],
            style: st(S.hatch, { tone: 0.50 + 0.50 * rng.f(), phase: F.nextPhase() })
          });
        }
      }
    }
  }

  // =========================================================================
  //  SKELETON — twenty-seven bones
  // =========================================================================
  const CARPAL_NAMES = ['scaphoid', 'lunate', 'triquetrum', 'pisiform',
    'trapezium', 'trapezoid', 'capitate', 'hamate'];
  // position in the carpal block (x distal, y ulnar, z palmar), and radii
  const CARPALS = [
    { p: [-2, -9.5, 1.0], r: [7.0, 5.2, 5.0] },   // scaphoid
    { p: [-4, -1.5, -0.5], r: [5.4, 5.0, 4.6] },  // lunate
    { p: [-5, 6.0, 0.0], r: [4.8, 4.4, 4.4] },    // triquetrum
    { p: [-4, 7.0, 5.6], r: [3.4, 3.2, 3.0] },    // pisiform
    // the trapezium carries the thumb's saddle: it sits well radial and
    // palmar of the rest of the distal row, up against the base of MC1
    { p: [6, -16.0, 5.5], r: [5.6, 4.6, 4.4] },   // trapezium
    { p: [7, -5.0, -1.0], r: [4.2, 3.8, 3.8] },   // trapezoid
    { p: [6, 0.5, 0.0], r: [6.4, 5.2, 5.2] },     // capitate
    { p: [5, 7.5, 1.5], r: [5.6, 4.8, 4.8] }      // hamate
  ];

  /** an ellipse on a plane facing the eye, used to draw bone ends and carpals */
  function billboardEllipse(view, C, rx, ry, n) {
    const e = view.e;
    let up = [1, 0, 0];
    if (Math.abs(vdot(e, up)) > 0.97) up = [0, 0, -1];
    const r = vnorm(vcross(up, e));
    const u = vnorm(vcross(e, r));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      pts.push([
        C[0] + r[0] * Math.cos(a) * rx + u[0] * Math.sin(a) * ry,
        C[1] + r[1] * Math.cos(a) * rx + u[1] * Math.sin(a) * ry,
        C[2] + r[2] * Math.cos(a) * rx + u[2] * Math.sin(a) * ry
      ]);
    }
    return pts;
  }

  function skeleton(rig, view, out) {
    const A = rig.anatomy;
    const sc = A.size;
    const style = st(S.bone, { tone: 1.0 });

    // carpals
    for (let i = 0; i < CARPALS.length; i++) {
      const c = CARPALS[i];
      const P = vadd(rig.origin, M.mApply(rig.root, [c.p[0] * sc + 6 * sc, c.p[1] * sc, c.p[2] * sc]));
      out.push({
        on: 'world', xray: true, pts: billboardEllipse(view, P, c.r[0] * sc, c.r[1] * sc, 26),
        style: st(style, { tone: 0.88, phase: F.nextPhase() }), close: true, name: CARPAL_NAMES[i]
      });
    }

    // metacarpals and phalanges: a shaft with condyles at each end
    for (let d = 0; d < 5; d++) {
      const dg = rig.digits[d];
      for (let seg = 0; seg < dg.segs.length; seg++) {
        const sg = dg.segs[seg];
        const [wa] = AN.segmentProfile(A, d, seg, 0.5);
        const shaft = wa * (seg === 0 ? 0.30 : 0.34);
        const head = wa * (seg === 0 ? 0.46 : 0.50);
        // two shaft walls: broad at each end, waisted through the diaphysis
        for (const sgn of [-1, 1]) {
          const pts = [];
          for (let i = 0; i <= 18; i++) {
            const t = i / 18;
            const w = lerp(shaft, head, Math.pow(Math.abs(Math.cos(Math.PI * t)), 1.6));
            pts.push(vadd(vmad(sg.A, sg.t, sg.len * t), vmul(sg.ul, sgn * w)));
          }
          out.push({ on: 'world', xray: true, pts, style: st(style, { phase: F.nextPhase() }) });
        }
        // condyles
        out.push({
          on: 'world', xray: true, pts: billboardEllipse(view, sg.A, head * 1.02, head * 0.92, 20),
          style: st(style, { tone: 0.76, phase: F.nextPhase() }), close: true
        });
        out.push({
          on: 'world', xray: true, pts: billboardEllipse(view, sg.B, head * 1.06, head * 0.96, 20),
          style: st(style, { tone: 0.76, phase: F.nextPhase() }), close: true
        });
      }
    }

    // radius and ulna, entering from the forearm
    const fl = 95 * sc;
    for (const [sgn, rr] of [[-1, 9], [1, 7.5]]) {
      const axis = rig.root[0], side = rig.root[1];
      const pts = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const p = vmad(rig.origin, axis, -lerp(6, fl, t) * 1);
        pts.push(vadd(p, vmul(side, sgn * rr * sc * lerp(1.25, 0.75, t))));
      }
      out.push({ on: 'world', xray: true, pts, style: st(style, { tone: 0.71, phase: F.nextPhase() }) });
    }
  }

  // =========================================================================
  //  FOREARM STUB — the drawing has to end somewhere
  // =========================================================================
  function forearm(rig, view, out, len) {
    const A = rig.anatomy;
    len = (len === undefined ? 46 : len) * A.size;
    const nU = 16;
    for (const sgn of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= nU; i++) {
        const t = i / nU;
        const u = -t * (len / (rig.palm.gridSpanU || 1));
        const s = R.palmSurface(rig, -t * 0.55, sgn < 0 ? 0.0 : 0.5);
        pts.push([-t * 0.55, sgn < 0 ? 0.0 : 0.5, 0]);
      }
      out.push({
        on: 'palm',
        pts: pts.map(p => [p[0], p[1] === 0 ? 0.0 : 0.5, 0]),
        style: st(S.contourSoft, { tone: 0.58, taper: 0.9, phase: F.nextPhase() })
      });
    }
  }

  GK.dorsal = { tendons, veins, knuckleField, hair, skinLattice, skeleton, forearm, billboardEllipse, CARPAL_NAMES };
})(window.GK = window.GK || {});
