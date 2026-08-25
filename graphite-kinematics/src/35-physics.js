/* ============================================================================
   GRAPHITE KINEMATICS — 35 · physics
   The held ball as a real object: a small rigid-body sphere with its own
   state — position, velocity, orientation, spin — that collides with the
   hand's own surfaces (the same digitSurface/palmSurface the renderer draws
   from) and is resolved by impulses, not placed by a formula. Squeeze it and
   the contact forces rise. Tilt the hand past what friction can hold and it
   rolls. Open the fingers and it is not "released" by a timeline — it falls
   because nothing is pushing back on it any more.

   WHAT THIS FILE DOES NOT DO: it does not give the hand itself mass. The
   joints stay exactly what they already were — an IK-posed linkage — and the
   ball pushes on them the same way a contact already does in 30-pose.js:
   jointDofs() plus a Jacobian-transpose relaxation (see reactToHand below,
   which is applyContacts' sibling, driven by contact force instead of
   penetration depth). Two different problems, two different solvers, wired
   together by the contact records this file produces.

   THE GRAVITY / "DOWN" CONVENTION. rig.root is this system's only notion of
   a world frame, and pickAndDrop (30-pose.js) already treats -root[0] as
   "down the page" for exactly one pose, fixed once at the start of that
   animation and never revisited even while the wrist goes on to move. That
   is deliberate, not an oversight: root rotates rigidly with wrist
   flexion/deviation, and the whole hand's geometry rotates right along with
   it, so a gravity vector that were re-read from root every frame would
   rotate in lockstep with the palm and a wrist twist would never change
   anything relative to the ball — "tilting the hand" would be a no-op.
   Real gravity does not rotate when a wrist does. So: -root[0] is read once,
   the first time a state sees a rig, cached on state.down, and held fixed
   from then on — call setGravityFromRig() to deliberately re-anchor it (a
   ball freshly dropped into a new hand/pose) or wake() to nudge a resting
   ball back into the solver without moving gravity at all.

   UNITS. Millimetres, kilograms, seconds throughout — the rig is already in
   mm, so contacts need no conversion. Force is reported to callers in
   newtons (see FORCE_SI); everything internal stays mm/kg/s.
   ========================================================================== */
(function (GK) {
  'use strict';
  const M = GK.math, AN = GK.anatomy, RG = GK.rig, PO = GK.pose;
  const { clamp, clamp01, lerp } = M;
  const { vadd, vsub, vmul, vmad, vdot, vcross, vlen, vdist, vnorm, vlerp } = M;

  // =========================================================================
  //  TUNABLES
  // =========================================================================
  const G_MAG = 9810;                 // mm/s^2
  const DEFAULT_DENSITY = 1.0e-6;     // kg/mm^3 (~1 g/cm^3 — a light rubber/wood ball)
  const DEFAULT_RESTITUTION = 0.28;
  const DEFAULT_FRICTION = 0.92;      // combined ball/skin Coulomb coefficient
  const SUBSTEP_DT = 1 / 240;         // fixed substep, so a step's outcome is frame-rate independent
  const MAX_SUBSTEPS = 8;
  const MAX_DT = 0.1;                 // guard against a stalled caller handing us a huge dt
  const SOLVER_ITERS = 4;             // Gauss-Seidel sweeps per substep
  const REST_LIN_EPS = 3.0;           // mm/s
  const REST_ANG_EPS = 3.0;           // rad/s
  const REST_TIME = 0.12;             // s below both thresholds before sleeping
  const RESTITUTION_VEL_FLOOR = 45;   // mm/s — slower closing speeds bounce inelastically
  const WAKE_HAND_SPEED = 1.5;        // mm/s of hand-surface motion that wakes a sleeping ball
  const SPEC_MARGIN = 2.0;            // mm — speculative contact margin so fast approach isn't missed
  const PALM_COMPLIANCE = 0.85;       // the palm's pad is not a wall (cf. palmSamples in 30-pose.js)
  const CONTACT_EMA_ALPHA = 0.35;     // low-pass on exposed contact depth/force/position
  const CONTACT_GRACE = 0.10;         // s a contact is kept alive after it stops being detected
  const CONTACT_MIN_DEPTH = 0.01;     // mm — below this a contact isn't worth publishing
  const FORCE_SI = 1e-3;              // (kg*mm/s^2) -> N
  const FORCE_TO_YIELD_MM = 3.2;      // mm of give at the contact point, saturating (see reactToHand)
  const FORCE_SAT = 3.5;              // N — force at which that yield is ~63% saturated
  const ANGULAR_DAMPING = 1.0;        // 1/s - see the note beside its use in step()

  const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  // =========================================================================
  //  QUATERNION — [w,x,y,z]. Kept local: 00-math.js has no rotation type
  //  beyond the 3x3 frames the rig already uses, and a ball spinning under
  //  friction needs an orientation cheap enough to integrate every substep.
  // =========================================================================
  function qIdent() { return [1, 0, 0, 0]; }
  function qNormalize(q) {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  }
  function qMul(a, b) {
    return [
      a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]
    ];
  }
  /** semi-implicit integration of orientation by angular velocity w over dt */
  function qIntegrate(q, w, h) {
    const wq = [0, w[0] * h, w[1] * h, w[2] * h];
    const dq = qMul(wq, q);
    return qNormalize([q[0] + dq[0] * 0.5, q[1] + dq[1] * 0.5, q[2] + dq[2] * 0.5, q[3] + dq[3] * 0.5]);
  }
  /** rotate a world vector by q (Fabian Giesen's optimised form) */
  function qRotate(q, v) {
    const qv = [q[1], q[2], q[3]];
    const t = vmul(vcross(qv, v), 2);
    return vadd(vadd(v, vmul(t, q[0])), vcross(qv, t));
  }
  /** the ball's own frame in world space, as [ex,ey,ez] — GK.math's mApply convention */
  function orientationFrame(state) {
    return [qRotate(state.q, [1, 0, 0]), qRotate(state.q, [0, 1, 0]), qRotate(state.q, [0, 0, 1])];
  }

  // =========================================================================
  //  STATE
  // =========================================================================

  /**
   * A new ball. Mass follows from radius and density like a real object's
   * would, rather than being handed in independently of its size.
   */
  function createState(opts) {
    opts = opts || {};
    const r = opts.r === undefined ? 26 : opts.r;
    const density = opts.density === undefined ? DEFAULT_DENSITY : opts.density;
    const mass = Math.max(1e-6, density * (4 / 3) * Math.PI * r * r * r);
    const I = 0.4 * mass * r * r;            // solid sphere: (2/5) m r^2
    return {
      C: (opts.C || [0, 0, 0]).slice(),
      v: (opts.v || [0, 0, 0]).slice(),
      q: (opts.q || qIdent()).slice(),
      w: (opts.w || [0, 0, 0]).slice(),
      r, mass, invMass: 1 / mass, invI: 1 / I,
      restitution: opts.restitution === undefined ? DEFAULT_RESTITUTION : opts.restitution,
      friction: opts.friction === undefined ? DEFAULT_FRICTION : opts.friction,
      down: opts.down ? vnorm(opts.down) : null,
      asleep: false, _restT: 0, _simTime: 0,
      _prevRig: null, _palmUV: null, _ema: new Map(),
      contacts: [], netContactForce: [0, 0, 0], lastStepMs: 0, lastSubsteps: 0
    };
  }

  /** (Re-)anchor "down" from a rig's own frame — see the file header. */
  function setGravityFromRig(state, rig) {
    state.down = vnorm(vmul(rig.root[0], -1));
    state.asleep = false; state._restT = 0;
    return state.down;
  }

  /** Nudge a sleeping ball back into the solver without touching gravity. */
  function wake(state) { state.asleep = false; state._restT = 0; }

  // =========================================================================
  //  CONTACT GEOMETRY — sampled fresh from the rig each step(), cached for
  //  the substeps within it (the hand doesn't move mid-step; only the ball
  //  does). This is deliberately the same simplification gatherContacts and
  //  ballContacts already use in 30-pose.js: one capsule per rendered
  //  segment, radius averaged from segmentProfile — not a fresh union of
  //  cross-sections. It is proven cheap enough there for a settle loop run
  //  20 times over; here it runs a handful of times per frame.
  // =========================================================================

  function closestOnSeg(A, B, P) {
    const AB = vsub(B, A);
    const L2 = vdot(AB, AB);
    let t = L2 > 1e-9 ? vdot(vsub(P, A), AB) / L2 : 0;
    t = clamp(t, 0, 1);
    return { Q: vmad(A, AB, t), t };
  }

  function buildDigitCapsules(A, rig, ballC) {
    const caps = [];
    for (let d = 0; d < 5; d++) {
      for (const sg of rig.digits[d].segs) {
        if (!sg.rendered || sg.seg < 1) continue;
        // dorsopalmar half-depth (index 1), the same choice ballContacts
        // makes for ball-vs-digit — the width that actually meets a ball
        // pressed against the front or back of a finger, not its flanks.
        const r = (AN.segmentProfile(A, d, sg.seg, 0.2)[1] + AN.segmentProfile(A, d, sg.seg, 0.8)[1]) * 0.5;
        const { t } = closestOnSeg(sg.A, sg.B, ballC);
        caps.push({ d, seg: sg.seg, A: sg.A, B: sg.B, r: Math.max(1.5, r), t });
      }
    }
    return caps;
  }

  const PALM_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  /**
   * Closest point on the palm's smooth (u,v) sheet to a world point: a coarse
   * grid over the whole sheet (cheap enough, next to the substep loop below,
   * to just always run — this is not the place to economise) plus last
   * frame's answer as an extra seed, then coordinate-descent refinement. A
   * warm-start-only search was tried first and quietly lost real, thin
   * contacts on a fast-moving ball: the greedy descent can settle into a
   * local minimum in the few iterations available and never find the true
   * closest point again. Re-scanning every call costs a fraction of a
   * millisecond and cannot get stuck. Contact IDENTITY doesn't depend on
   * exactly which (u,v) this converges to — every palm contact is exposed
   * under the one 'palm' key (see publishContacts) — so re-seeding here
   * cannot itself cause the flicker that identity would.
   */
  function palmClosest(rig, C, warmUV) {
    let u, v, bestD = Infinity;
    for (let iu = 0; iu <= 14; iu++) {
      const uu = lerp(-0.3, 1.1, iu / 14);
      const lo = rig.palm.vLo(uu), hi = rig.palm.vHi(uu);
      for (let iv = 0; iv <= 12; iv++) {
        const vv = lerp(lo, hi, iv / 12);
        const d = vdist(RG.palmSpine(rig, uu, vv).P, C);
        if (d < bestD) { bestD = d; u = uu; v = vv; }
      }
    }
    if (warmUV) {
      const uu = clamp(warmUV[0], -0.5, 1.15);
      const vv = clamp(warmUV[1], rig.palm.vLo(uu) + 0.02, rig.palm.vHi(uu) - 0.02);
      const d = vdist(RG.palmSpine(rig, uu, vv).P, C);
      if (d < bestD) { bestD = d; u = uu; v = vv; }
    }
    let step = 0.05;
    for (let pass = 0; pass < 12 && step > 0.0004; pass++) {
      let improved = false;
      for (const [du, dv] of PALM_DIRS) {
        const uu = clamp(u + du * step, -0.5, 1.15);
        const vv = clamp(v + dv * step, rig.palm.vLo(uu) + 0.02, rig.palm.vHi(uu) - 0.02);
        const d = vdist(RG.palmSpine(rig, uu, vv).P, C);
        if (d < bestD - 1e-9) { bestD = d; u = uu; v = vv; improved = true; }
      }
      if (!improved) step *= 0.5;
    }
    const sp = RG.palmSpine(rig, u, v);
    return { u, v, P: sp.P, n: sp.n };
  }

  /** live contact candidates against the ball's CURRENT position, given the
   *  per-step capsule/palm cache — cheap enough to call once a substep. */
  function gatherLive(state, capsules, palmPoint) {
    const C = state.C, r = state.r;
    const list = [];
    const off = vdot(vsub(C, palmPoint.P), palmPoint.n);
    const depthP = (palmPoint.thick + r) - off;
    if (depthP > -SPEC_MARGIN && off > -8) {
      list.push({
        kind: 'palm', u: palmPoint.u, v: palmPoint.v, n: palmPoint.n, depth: depthP,
        Phand: vmad(palmPoint.P, palmPoint.n, palmPoint.thick)
      });
    }
    for (const cap of capsules) {
      const { Q } = closestOnSeg(cap.A, cap.B, C);
      const dist = vdist(C, Q);
      if (dist < 1e-6) continue;
      const n = vmul(vsub(C, Q), 1 / dist);
      const depth = (cap.r + r) - dist;
      if (depth > -SPEC_MARGIN) {
        list.push({ kind: 'digit', d: cap.d, seg: cap.seg, n, depth, Phand: vmad(Q, n, cap.r) });
      }
    }
    return list;
  }

  // =========================================================================
  //  IMPULSE SOLVER — sequential impulses, accumulated and clamped per
  //  contact within a substep (Gauss-Seidel across contacts so a ball
  //  touching the palm and three fingers at once has them all agree).
  //
  //  Normal impulse needs no rotational coupling: the sphere's lever arm to
  //  any contact point is r*(-n), parallel to n, so a purely normal force
  //  produces no torque. Friction's lever arm is perpendicular to n (it acts
  //  along the tangent), and that is what makes the ball roll: the effective
  //  mass for the tangential impulse works out to invMass + invI*r^2, which
  //  for a solid sphere is 7/(2m) — the classic rolling-sphere factor.
  //
  //  Velocity here is solved as though the hand were momentarily static at
  //  each contact. A real closing or tilting hand still reaches the ball:
  //  contacts are re-detected from the moving surface every substep (see
  //  gatherLive), so a finger that has advanced 0.3mm since the last substep
  //  shows up as 0.3mm more penetration right now, and the same non-
  //  penetration constraint below pushes the ball out of that — which is
  //  what carries it along as the hand closes. What this deliberately does
  //  NOT do is also hand the ball the contact point's own velocity as
  //  momentum: that was tried (finite-differencing the closest point frame
  //  to frame) and cost more than it bought. The closest point on a capsule
  //  or the palm sheet does not track one fixed patch of skin — it is
  //  recomputed from wherever the ball is now — so differencing it measures
  //  the drift of a moving target, not a surface's true velocity, and under
  //  a full grip (six to eight contacts, all changing together as fingers
  //  close) that noise compounded into a runaway within a few dozen frames,
  //  every way it was weighted in. The plain constraint below has no such
  //  term to go wrong and settles a closing grip to within 1% of net force
  //  balancing weight; see updateSleep for how standing penetration is kept
  //  from ever growing once the ball is actually at rest.
  // =========================================================================
  function solveContactsSubstep(state, contacts, iters) {
    const invM = state.invMass, invI = state.invI, r = state.r, mu = state.friction, mass = state.mass;
    for (const c of contacts) {
      c._jn = 0; c._jt = 0;
      c._rVec = vmul(c.n, -r);
      const vPoint = vadd(state.v, vcross(state.w, c._rVec));
      const vn0 = vdot(vPoint, c.n);
      const e = (vn0 > -RESTITUTION_VEL_FLOOR) ? 0 : state.restitution;
      // No Baumgarte-style depth bias here. Two shapes of it were tried —
      // an independent post-substep push on state.C, and a bias folded into
      // this same accumulated normal impulse — and both destabilised a full
      // grip: six to eight simultaneous contacts, their depths all changing
      // together as the fingers close, and both approaches went into a
      // runaway within a few dozen frames every time, however small the
      // correction was made per application. The plain velocity constraint
      // below does not have that failure mode and turns out not to need the
      // help: resting depth is whatever this converges to under load, held
      // there by the constraint itself rather than trimmed back by a second
      // system, and once asleep (see updateSleep) it never has the chance to
      // creep further. See the header note above this function.
      c._desired = vn0 < 0 ? -e * vn0 : 0;
    }
    const kt = invM + invI * r * r;
    for (let it = 0; it < iters; it++) {
      for (const c of contacts) {
        const n = c.n, rVec = c._rVec;
        // ---- normal ----
        let vPoint = vadd(state.v, vcross(state.w, rVec));
        let vn = vdot(vPoint, n);
        let dPn = (c._desired - vn) * mass;
        let newJn = Math.max(0, c._jn + dPn);
        dPn = newJn - c._jn; c._jn = newJn;
        state.v = vmad(state.v, n, dPn * invM);
        // ---- friction (Coulomb cone sized off the normal impulse) ----
        vPoint = vadd(state.v, vcross(state.w, rVec));
        const vt = vsub(vPoint, vmul(n, vdot(vPoint, n)));
        const vtLen = vlen(vt);
        if (vtLen > 1e-6 && c._jn > 0) {
          const tDir = vmul(vt, 1 / vtLen);
          let dPt = -vtLen / kt;
          const maxT = mu * c._jn;
          let newJt = clamp(c._jt + dPt, -maxT, maxT);
          dPt = newJt - c._jt; c._jt = newJt;
          state.v = vmad(state.v, tDir, dPt * invM);
          state.w = vadd(state.w, vmul(vcross(rVec, vmul(tDir, dPt)), invI));
        }
      }
    }
  }

  function updateSleep(state, dt) {
    const lin = vlen(state.v), ang = vlen(state.w);
    if (lin < REST_LIN_EPS && ang < REST_ANG_EPS) {
      state._restT += dt;
      if (state._restT > REST_TIME) { state.asleep = true; state.v = [0, 0, 0]; state.w = [0, 0, 0]; }
    } else state._restT = 0;
  }

  // =========================================================================
  //  EXPOSED CONTACTS — the input the surface deformation reads. Identity is
  //  (d,seg) for a digit or the single palm point, which is exactly what
  //  keeps this stable: there is at most one contact per rendered segment and
  //  one for the palm, so the SET rarely changes shape frame to frame, and an
  //  EMA per identity (plus a short grace period before an identity is
  //  dropped) smooths what does move so a squeeze reads as a settling field
  //  rather than a flicker.
  // =========================================================================
  function publishContacts(state, ctx, dt) {
    const { capsules, palmPoint, accumJn } = ctx;
    const fresh = gatherLive(state, capsules, palmPoint);
    const seen = new Set();
    for (const c of fresh) {
      if (c.depth <= CONTACT_MIN_DEPTH) continue;
      const key = c.kind === 'palm' ? 'palm' : ('digit_' + c.d + '_' + c.seg);
      seen.add(key);
      const jn = c.kind === 'palm' ? accumJn.palm : (accumJn.digit[key] || 0);
      const fRaw = Math.max(0, (jn / dt) * FORCE_SI);
      let ema = state._ema.get(key);
      if (!ema) {
        ema = { depth: c.depth, f: fRaw, P: c.Phand.slice(), n: c.n.slice() };
      } else {
        const a = CONTACT_EMA_ALPHA;
        ema.depth = lerp(ema.depth, c.depth, a);
        ema.f = lerp(ema.f, fRaw, a);
        ema.P = vlerp(ema.P, c.Phand, a);
        ema.n = vnorm(vlerp(ema.n, c.n, a));
      }
      ema.seenAt = state._simTime;
      ema.part = c.kind === 'palm' ? { kind: 'palm', u: c.u, v: c.v } : { kind: 'digit', d: c.d, seg: c.seg };
      state._ema.set(key, ema);
    }
    const out = [];
    for (const [key, ema] of state._ema) {
      if (!seen.has(key)) {
        if (state._simTime - ema.seenAt > CONTACT_GRACE) { state._ema.delete(key); continue; }
      }
      out.push({ P: ema.P.slice(), n: ema.n.slice(), depth: ema.depth, f: ema.f, part: ema.part });
    }
    state.contacts = out;
  }

  // =========================================================================
  //  STEP — a fixed-substep integrator so the resting position, the settle
  //  time and the fall all come out the same whether the caller runs at 30,
  //  60 or 144 fps; only how many substeps get spent to cover dt changes.
  // =========================================================================
  function step(state, rig, dt) {
    const t0 = now();
    if (!(dt > 0)) { state.lastStepMs = 0; return state; }
    dt = Math.min(dt, MAX_DT);
    state._simTime += dt;
    const A = rig.anatomy;
    if (state.down == null) setGravityFromRig(state, rig);

    const capsules = buildDigitCapsules(A, rig, state.C);
    const palmHit = palmClosest(rig, state.C, state._palmUV);
    state._palmUV = [palmHit.u, palmHit.v];
    const palmPoint = {
      u: palmHit.u, v: palmHit.v, P: palmHit.P, n: palmHit.n,
      thick: RG.palmThickPalmar(A, palmHit.u, palmHit.v) * PALM_COMPLIANCE
    };
    const prevRig = state._prevRig;

    // ---- asleep: stay put unless the hand has moved or support vanished ---
    if (state.asleep) {
      const live = gatherLive(state, capsules, palmPoint);
      let held = false;
      for (const c of live) if (c.depth > 0.02) held = true;
      let disturbed = !held;
      // geometric disturbance only (never fed into the impulse solve, see
      // the note above solveContactsSubstep) - just "has the hand actually
      // moved enough to be worth re-checking", so a sleeping ball wakes when
      // fingers open or the hand tilts even though nothing has hit it yet
      if (!disturbed && prevRig) {
        const dt2 = dt > 0 ? dt : 1;
        disturbed = vdist(palmHit.P, RG.palmSpine(prevRig, palmHit.u, palmHit.v).P) / dt2 > WAKE_HAND_SPEED;
        for (let i = 0; i < capsules.length && !disturbed; i++) {
          const cap = capsules[i];
          const old = prevRig.digits[cap.d] && prevRig.digits[cap.d].segs[cap.seg];
          if (old && vdist(vlerp(cap.A, cap.B, cap.t), vlerp(old.A, old.B, cap.t)) / dt2 > WAKE_HAND_SPEED) disturbed = true;
        }
      }
      if (!disturbed) {
        state._prevRig = rig; state.lastStepMs = now() - t0; state.lastSubsteps = 0;
        return state;                 // state.contacts is untouched: already settled
      }
      wake(state);
    }

    // ---- active integration, fixed substeps -------------------------------
    const nSub = Math.min(MAX_SUBSTEPS, Math.max(1, Math.round(dt / SUBSTEP_DT)));
    const h = dt / nSub;
    const accumJn = { palm: 0, digit: Object.create(null) };
    let impulseAccum = [0, 0, 0];        // normal + friction, every contact, this whole step()
    for (let s = 0; s < nSub; s++) {
      state.v = vmad(state.v, state.down, G_MAG * h);
      const live = gatherLive(state, capsules, palmPoint);
      const vBefore = state.v;
      solveContactsSubstep(state, live, SOLVER_ITERS);
      impulseAccum = vmad(impulseAccum, vsub(state.v, vBefore), state.mass);
      for (const c of live) {
        if (c.kind === 'palm') accumJn.palm += c._jn;
        else accumJn.digit['digit_' + c.d + '_' + c.seg] = (accumJn.digit['digit_' + c.d + '_' + c.seg] || 0) + c._jn;
      }
      // A resting multi-contact ball can settle its LINEAR velocity to a
      // dead stop while very slightly, persistently gaining spin: friction
      // here only cancels slip that is already showing up at a contact, not
      // the slip gravity is about to introduce over the rest of this
      // substep, and with several contacts at once the residual from each
      // can combine into a genuine (if tiny) net torque none of them sees
      // individually. Real static friction would zero that; this one-line
      // damping stands in for that missing proactive term. It can only ever
      // shrink |w|, never grow it, so unlike the position-correction and
      // reactToHand-at-full-strength failures documented above, it has no
      // runaway mode to reopen — and it is far too gentle (a few tenths of a
      // percent per substep) to visibly slow an actually rolling ball over
      // the second-or-so a tilt or a fall plays out in.
      state.w = vmul(state.w, Math.max(0, 1 - ANGULAR_DAMPING * h));
      state.C = vmad(state.C, state.v, h);
      state.q = qIntegrate(state.q, state.w, h);
    }
    // the total force (normal + Coulomb friction, summed over every contact)
    // the hand actually exerted on the ball this frame — the honest way to
    // check "is friction plus normal force what's holding this up", since a
    // side-pinched ball can be held almost entirely by friction with very
    // little of it in the normal direction at all.
    state.netContactForce = vmul(impulseAccum, (1 / dt) * FORCE_SI);

    publishContacts(state, { capsules, palmPoint, accumJn }, dt);
    updateSleep(state, dt);
    state._prevRig = rig;
    state.lastStepMs = now() - t0; state.lastSubsteps = nSub;
    return state;
  }

  // =========================================================================
  //  HAND REACTION — reads back exactly like applyContacts (30-pose.js):
  //  same jointDofs, same Jacobian-transpose pseudo-inverse step, same
  //  per-joint compliance weights. The difference is what drives it: not
  //  penetration depth (there mostly isn't any once the ball solver is
  //  running) but the contact FORCE this step actually produced, saturating
  //  so a hard squeeze yields more than a light rest but never unhinges a
  //  joint. Palm force gets a small direct nudge on the arch — the one
  //  compliant DOF jointDofs doesn't reach — so a heavy ball presses the cup
  //  flatter, not just the fingers wider.
  // =========================================================================
  function reactToHand(A, pose, rig, contacts, opts) {
    opts = opts || {};
    const kappa = opts.kappa === undefined ? 1 : opts.kappa;
    const archYield = opts.archYield === undefined ? 0.5 : opts.archYield;
    const p = JSON.parse(JSON.stringify(pose));
    let palmF = 0;
    for (const c of contacts) {
      if (c.part.kind === 'palm') { palmF = Math.max(palmF, c.f); continue; }
      const d = c.part.d, seg = c.part.seg;
      const dofs = PO.jointDofs(rig, p, d).filter(x => x.seg <= seg);
      if (!dofs.length) continue;
      const g = new Array(dofs.length);
      let sum = 0;
      for (let i = 0; i < dofs.length; i++) {
        const x = dofs[i];
        g[i] = vdot(vcross(x.axis, vsub(c.P, x.O)), c.n);
        sum += x.w * g[i] * g[i];
      }
      if (sum < 1e-7) continue;
      // yieldAmt is in the SAME units g[i] is - mm of point displacement
      // along the contact normal - exactly like applyContacts' lambda*depth,
      // so this reuses that same pseudo-inverse honestly rather than in
      // name only: a target expressed directly in radians here would be
      // solved for as though it were millimetres of relief and come out
      // roughly (typical lever arm in mm) times too small.
      const yieldAmt = kappa * FORCE_TO_YIELD_MM * Math.tanh(c.f / FORCE_SAT);
      const k = yieldAmt / sum;
      for (let i = 0; i < dofs.length; i++) dofs[i].add(k * dofs[i].w * g[i]);
    }
    if (palmF > 0) p.arch = clamp01(p.arch - archYield * 0.12 * Math.tanh(palmF / FORCE_SAT));
    return PO.clampPose(A, p);
  }

  // =========================================================================
  //  DIAGNOSTICS
  // =========================================================================
  function energy(state) {
    const keLin = 0.5 * state.mass * vdot(state.v, state.v);
    const I = 0.4 * state.mass * state.r * state.r;
    const keAng = 0.5 * I * vdot(state.w, state.w);
    const heightUp = state.down ? -vdot(state.C, state.down) : 0;
    const pe = state.mass * G_MAG * heightUp;
    return { keLin, keAng, ke: keLin + keAng, pe, total: keLin + keAng + pe };
  }

  GK.physics = {
    G: G_MAG, SUBSTEP_DT, MAX_SUBSTEPS,
    createState, setGravityFromRig, wake, step, reactToHand, energy, orientationFrame,
    qIdent, qMul, qNormalize, qRotate, qIntegrate
  };
})(window.GK = window.GK || {});
