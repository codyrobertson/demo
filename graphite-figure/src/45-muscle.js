/* ============================================================================
   GRAPHITE FIGURE — src/45-muscle.js
   Grouped anatomical masses: one procedural volume per muscle GROUP (not per
   muscle), anchored to the solved skeleton, standing between the bones
   (src/10-skeleton.js) and the isosurface fields that loft a shell over them
   (src/50-field.js). This is a PROXY system: the goal is the silhouette a
   figure drawing needs — a belly, a taper, a wrap over the joint it
   crosses — not a fibre-accurate simulation. Fifteen groups, not eighty-plus
   muscles (twelve at this file's first pass; adductors, brachialis and
   tibialisAnterior joined them later — see THE THREE NAMED GAPS below —
   and a sixteenth, peroneals, was built, measured, checked and then taken
   back out, which is also recorded there).

   WHAT IS MEASURED, FROM WHERE, AND WHAT IS NOT.

   ANCHORS (where a group starts and ends).
     LOWER BODY (glutes, quadriceps, hamstrings, adductors, triceps surae,
     tibialis anterior): real attachment sites out of the Rajagopal et al.
     (2016) model (data/rajagopal.json, via src/00-osim.js) —
     origin/insertion centroids from actual path points, a transverse
     spread from how those points scatter, a wrap radius from the model's
     own WrapCylinder objects.
     UPPER BODY except trapezius (deltoid, pectoralis, latissimus, biceps
     brachii, brachialis, triceps brachii, the forearm mass): real
     attachment sites out of the Holzbaur/MoBL-ARMS model
     (data/mobl-arms.json, via src/00-mobl-arms.js) — same technique,
     second independent source.
     TRAPEZIUS: MoBL-ARMS has no trapezius, rhomboid or serratus anterior —
     its own header says so ("noTrapezius": scapular kinematics there are
     driven by a constraint, not a muscle). So trapezius alone is anchored
     to a skeletal landmark (T1, the clavicle's own graphite parent) with a
     one-line reason, EST, the same discipline src/00-anthro.js uses for its
     own regression offsets. It is the one entry left in UPPER_EST below,
     structured so a better source can replace it without reshaping
     anything else — see UPPER_EST's own comment.

   VOLUME (how big a group is). data/bodyparts3d.json carries an ENCLOSED
   VOLUME per named, individually segmented muscle head, measured off one
   real reference specimen (see BP3D_GROUPS below for exactly which heads
   sum into which group). That volume is scaled onto the actual figure being
   built by src/00-anthro.js's own measured girths, not guessed:
       V_target = V_ref * (L_target / L_ref) * (girth_target / girth_ref)^2
   L is a SKELETAL reference length (SOURCE_REF_LEN_MM: Rajagopal's or
   MoBL-ARMS's own femur/tibia/humerus/forearm), not the reference mesh's
   own bounding box — that box reaches further than this file's own
   simplified anchors do (a real rectus femoris' box runs past the hip;
   this file's own quadriceps starts at the femur, see LOWER_TOPOLOGY's own
   comment on why), and comparing this figure's Lmm against a box built for
   the longer span silently shrank every group — caught by this project's
   own musclefit run, see localMmClosureFor()'s comment on the fix. Girth is
   the ANSUR circumference of whichever limb segment the group sits
   on/acts on (GIRTH_SITE below). Cross-section area then falls out as
   A = V / L (see stationsFor() below, where this figure's own Lmm cancels
   back out of that division — area does not shrink just because a pose
   happens to shorten the sweep; that is bulge()'s job, applied after) — no
   free "how big should this be" scale constant survives this file at all.
   The one thing bodyparts3d's own header admits is approximate is the
   volume itself (a closed-mesh assumption that is not always exactly true);
   this file does not pretend otherwise, and tools/musclefit.js's own
   report says plainly where the result still falls short and why (three of
   its four named gaps — the adductor compartment, brachialis, tibialis
   anterior — are narrower now than when it was written; see THE THREE
   NAMED GAPS below for by how much, and tools/musclefit2.js for the check
   that measured it. mid-forearm, its fourth site, is untouched by this
   pass — no group here claims it).

   ARCHITECTURE. A fusiform belly, a multipennate cap and a broad convergent
   sheet do not distribute the same volume the same way along a sweep, so
   each group is tagged (ARCH below): fusiform (biceps brachii, brachialis,
   the forearm mass), bipennate (quadriceps), multipennate (deltoid, triceps
   brachii, triceps surae, tibialis anterior), convergent (pectoralis,
   latissimus, trapezius, gluteal — broad origin narrowing to a point),
   strap (the abdominal mass, hamstrings, adductors). The tag sets where the
   belly's plateau sits along the sweep and how sharp the tendon taper at
   each end is; the taper's WIDTH is not
   guessed either — both Rajagopal and MoBL-ARMS carry a tendon slack length
   and an optimal fibre length per muscle, and tendonFractionOf() below
   turns those into a real fraction of the muscle-tendon unit that is tendon.

   THE VOLUME MODEL, PER GROUP: a centreline from origin to insertion; a
   cross-section that is an ELLIPSE, never a circle (src/40-surface.js's own
   header: "a circular cross-section is why procedural figures read as
   balloon animals" — this file exists to give that header's LIMB table
   something measured to loft over instead of an EST ratio); belly area
   varies along the sweep by architecture type, proximal tendon -> belly ->
   distal tendon; bulge(jointAngleRad) — shortening the origin-insertion
   distance thickens the belly, radius ~ 1/sqrt(length), volume conserved to
   first order; wrap — the centreline is nudged off the bone's own axis by a
   radius read from a real WrapCylinder where the group has one.

   THE THREE NAMED GAPS, AND THE ONE THAT STAYED A GAP.
     This file's own header used to end its VOLUME section on "twelve named
     groups is not a limb's complete musculature — the adductor compartment
     at the thigh above all", quoting tools/musclefit.js's own report. Three
     specific groups closed part of that: adductors (LOWER_TOPOLOGY, below
     — magnus/longus/brevis, real Rajagopal anchors, pelvis to femur),
     brachialis (UPPER_TOPOLOGY — real MoBL-ARMS anchors, humerus to ulna),
     tibialisAnterior (LOWER_TOPOLOGY — real Rajagopal anchors, tibia to
     calcn). Measured with tools/musclefit2.js (companion to musclefit.js,
     same direct area-sum check, the three new groups added to the sites
     they actually occupy): mid-thigh's own undershoot narrows about 14%
     (adductors is real and substantial, but sartorius, gracilis and the
     simplifications already documented in quadriceps'/hamstrings' own
     comments are still missing — this was always going to be the
     partial one), mid-biceps about 20%, max-calf about 19%. Checked
     against tools/girthcheck.js too, over 12 bodies: thigh soft-tissue mm
     dropped from 51.8 to 48.0 with adductors alone changing nothing else;
     biceps and calf stayed EXACTLY unchanged (27.1mm, 16.7mm, to the
     millimetre this file prints and to four decimals underneath it) —
     not a bug, see brachialis's and tibialisAnterior's own comments below:
     both groups' own real peak sits past the one specific height ANSUR's
     protocol happens to measure at, so a real, visible, correctly-anchored
     addition can leave that one number exactly alone. A fourth group,
     peroneals, was built the same way, measured clean, and reverted after
     rendering showed why — see LOWER_TOPOLOGY's own comment on it, right
     after tibialisAnterior's table entry, for the full account.

   THE TWO PUBLIC ENTRY POINTS.
     GK.muscle.query(rig) — a sampled centreline with world-space elliptical
     cross-sections and an extent, per group, per side: introspection, or a
     future dedicated lofter.
     GK.muscle.fieldAt(rig, P, part, f) — what src/50-field.js ACTUALLY
     calls: a signed-distance-style scalar for the muscle belonging to that
     part, so it can be smin()'d in with the bone and soft-tissue fields.
     `f` is soft tissue thickness in millimetres, solved per region by
     src/50-field.js's own fitFat() — it is ADDED to this file's ellipse
     semi-axes, never subtracted from the returned distance (see that
     file's volumeField() doc comment for the first-order reason why not).

   Millimetres throughout, radians for angles.
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;
  const {
    lerp, clamp, clamp01, smoothstep, sstep,
    vadd, vsub, vmul, vmad, vdot, vcross, vlen, vnorm, vlerp,
    mMul, mOrtho,
  } = M;

  // =========================================================================
  //  SIDE MIRRORING — proved once, numerically, rather than assumed.
  //  For every side-bearing bone this file anchors to that is built from
  //  `aim` (femur, humerus) or from `rest` chained onto one (tibia, foot) —
  //  see src/10-skeleton.js — re-expressing the SAME source-model offset in
  //  the LEFT bone's local frame instead of the RIGHT's changes exactly one
  //  coefficient: frame[0] (along the bone) and frame[2] (== world
  //  anterior, exactly, whenever the bone's aim/rest chain has zero net Z
  //  at rest — true of every one of those bones) keep their sign; frame[1]
  //  flips. Checked with a script against the actual solver, not derived on
  //  paper: for an arbitrary test vector, mApplyInv(femur.L, vec) equalled
  //  [v0, -v1, v2] built from mApplyInv(femur.R, vec) to float precision,
  //  and the same held for tibia, humerus, forearm and foot. So every
  //  anchor below is authored once, for the right side, and mirrored here —
  //  which also means a wrong sign shows up as a muscle on one side only,
  //  not as a subtle whole-body error.
  // =========================================================================
  function mirrorLocal(v, side) { return side === 'R' ? v : [v[0], -v[1], v[2]]; }

  // =========================================================================
  //  MATH HELPERS
  // =========================================================================

  /** inverse of M.mApply: the local coordinates of a WORLD vector in an
   *  orthonormal frame — frame rows are unit and mutually perpendicular, so
   *  the inverse is just three dot products */
  function unapply(fr, world) { return [vdot(world, fr[0]), vdot(world, fr[1]), vdot(world, fr[2])]; }

  // ---- the rest-pose frame of a bone, from constants alone --------------
  // Only valid for a bone built from `aim` or `rest` — NOT `aimTo`, whose
  // target is a measured landmark and so varies per figure (clavicle,
  // scapula, skull: see anchorsByFraction() below for how those three are
  // handled instead). For an aim/rest bone, every joint angle is zero at
  // pose={} regardless of which figure is asked (10-skeleton.js's own
  // anglesFor() returns 0 for every axis when the pose supplies nothing),
  // so the rest-pose ORIENTATION — not the position, which does depend on
  // the figure's own lengths — is a fixed constant. Computed here by
  // literally repeating solve()'s own frame construction with posed =
  // identity, rather than copying its numbers, so this tracks
  // 10-skeleton.js if that file's constants ever move.
  const _restFrameCache = {};
  function restFrame(id) {
    if (_restFrameCache[id]) return _restFrameCache[id];
    const b = GK.skel.BY_ID[id];
    if (!b) throw new Error('muscle: no bone "' + id + '"');
    let fr;
    if (!b.parent) {
      fr = M.IDENT();
    } else if (b.aimTo) {
      throw new Error('muscle: "' + id + '" is aimTo-anchored, its rest frame is per-figure, not a constant restFrame() can give — see anchorsByFraction()');
    } else {
      const s = b.sign === undefined ? 1 : b.sign;
      if (b.aim) {
        // an `aim` bone's frame is a WORLD direction resolved directly — it
        // does not compose through the parent's frame at all (matches
        // solve()'s own aim branch), so the parent's restFrame is never
        // needed here, which matters: humerus's parent is scapula, and
        // scapula is aimTo-anchored (not restFrame()-able) — humerus must
        // not force that evaluation just because it has a parent.
        const want = vnorm([b.aim[0], b.aim[1] * s, b.aim[2]]);
        const ref = Math.abs(want[2]) > 0.94 ? [1, 0, 0] : [0, 0, 1];
        const zc = vnorm(vsub(ref, vmul(want, vdot(want, ref))));
        const yc = vcross(zc, want);
        const base = mOrtho([want, yc, zc]);
        const roll = b.roll ? b.roll * s : 0;
        fr = mOrtho(mMul(base, GK.skel.TWIST(roll)));
      } else {
        const pF = restFrame(b.parent);
        const [rf, ra, rt] = b.rest || [0, 0, 0];
        const rest = mMul(GK.skel.TWIST(rt * s), mMul(GK.skel.ABD(ra * s), GK.skel.FLEX(rf)));
        fr = mOrtho(mMul(pF, rest));
      }
    }
    _restFrameCache[id] = fr;
    return fr;
  }

  // =========================================================================
  //  LOCAL FIELD PRIMITIVES
  //  The same technique src/50-field.js uses (smooth-min union, an ellipse-
  //  section capsule via the implicit-surface gradient correction),
  //  reproduced locally rather than called through GK.field. The dependency
  //  runs muscle -> field (that file's muscleField() asks GK.muscle, not the
  //  other way — see this file's own fieldAt() below), so this module must
  //  stand on its own; ~25 lines duplicated is cheaper than a backwards
  //  dependency that breaks the moment someone loads one file without the
  //  other.
  // =========================================================================

  function smin(a, b, k) {
    if (k <= 0) return Math.min(a, b);
    const h = clamp01(0.5 + 0.5 * (b - a) / k);
    return lerp(b, a, h) - k * h * (1 - h);
  }

  /** signed distance to a capsule-like segment whose cross-section is a
   *  pure ellipse (ay along `u`, az along `v`) that lerps from (a0,b0) at A
   *  to (a1,b1) at B; `w` is the segment's own direction, for the rounded
   *  axial cap. Same gradient-corrected construction as src/50-field.js's
   *  sdSegSE with n fixed at 2 (an ellipse, never a superellipse — the
   *  header's whole point is the section is measured, not a guessed
   *  exponent). */
  function sdSegE(P, A, B, u, v, w, a0, b0, a1, b1) {
    const ab = vsub(B, A), ap = vsub(P, A);
    const t = clamp01(vdot(ap, ab) / Math.max(1e-9, vdot(ab, ab)));
    const c = vmad(A, ab, t);
    const d = vsub(P, c);
    const ay = Math.max(1, lerp(a0, a1, t)), az = Math.max(1, lerp(b0, b1, t)), aw = Math.min(ay, az);
    const uu = vdot(d, u) / ay, vv = vdot(d, v) / az, ww = vdot(d, w) / aw;
    const e = Math.hypot(uu, vv);
    const q = Math.hypot(e, ww);
    if (q < 1e-6) return -Math.min(ay, az, aw);
    const ge = (e < 1e-6 ? 1 / Math.min(ay, az) : Math.hypot(uu / ay, vv / az) / e) * (e / q);
    return (q - 1) / Math.hypot(ge, ww / (q * aw));
  }

  // =========================================================================
  //  ARCHITECTURE PROFILES — see the file header. `peakT`/`plateau` are
  //  EST, chosen to read as the named architecture; `profileIntegral` is
  //  exact for the chosen shape and turns a MEAN area (volume / length)
  //  into the actual PEAK area a caller sees.
  // =========================================================================
  const ARCH = {
    fusiform: { peakT: 0.50, plateau: 0.14 },
    bipennate: { peakT: 0.50, plateau: 0.22 },
    multipennate: { peakT: 0.48, plateau: 0.34 },
    convergent: { peakT: 0, plateau: 0 },        // wide origin, no proximal taper — see archProfile()
    strap: { peakT: 0.50, plateau: 0.62 },
  };
  const TENDON_AREA_FRAC = 0.09; // a tendon is not zero area; the floor a taper approaches, as a fraction of peak

  function archProfile(archId, tendonFrac, t) {
    t = clamp01(t);
    const tf = clamp(tendonFrac, 0.03, 0.46);
    if (archId === 'convergent') {
      const fallStart = 1 - tf;
      return t <= fallStart ? 1 : lerp(1, TENDON_AREA_FRAC, sstep(fallStart, 1, t));
    }
    const a = ARCH[archId] || ARCH.fusiform;
    const half = Math.max(0.03, a.plateau * 0.5);
    const lo = clamp(a.peakT - half, tf, 1 - tf);
    const hi = clamp(a.peakT + half, lo, 1 - tf);
    if (t <= lo) return lerp(TENDON_AREA_FRAC, 1, sstep(0, Math.max(lo, 1e-4), t));
    if (t >= hi) return lerp(1, TENDON_AREA_FRAC, sstep(hi, Math.max(hi + 1e-4, 1), t));
    return 1;
  }

  const _integralCache = {};
  function profileIntegral(archId, tendonFrac) {
    const key = archId + '|' + tendonFrac.toFixed(3);
    if (_integralCache[key] !== undefined) return _integralCache[key];
    const N = 64;
    let s = 0;
    for (let i = 0; i <= N; i++) { const w = (i === 0 || i === N) ? 0.5 : 1; s += w * archProfile(archId, tendonFrac, i / N); }
    return (_integralCache[key] = s / N);
  }

  // =========================================================================
  //  SHARED EXTRACTION HELPERS — work identically against Rajagopal's
  //  muscles[] and MoBL-ARMS's muscles[], because tools/fit-osim.js and
  //  tools/fit-mobl-arms.js extracted both into the same field names
  //  (path[].body, path[].locationMm, maxIsometricForceN,
  //  optimalFiberLengthMm, tendonSlackLengthMm, pennationAngleAtOptimalRad,
  //  wraps[].wrapObject, joints[].locationInParentMm/locationInChildMm).
  // =========================================================================

  /** points on `bodyName`, across every muscle in the list — filters out
   *  conditional/moving path points with no location at the reference pose
   *  (both source files carry a few, `locationMm: null`) */
  function pointsOnBody(muscles, bodyName) {
    const pts = [];
    for (const m of muscles) for (const p of m.path) if (p.body === bodyName && p.locationMm) pts.push(p.locationMm);
    return pts;
  }

  /** ONE point per muscle on `bodyName`: the FIRST (origin=true) or LAST
   *  (origin=false) occurrence in that muscle's own recorded path order.
   *
   *  Why not every point: a muscle with a short, simple path (most of
   *  Rajagopal's) touches its origin body once or twice, at the start, and
   *  "every point" is exactly the origin fan. A muscle with a long path
   *  that CURVES ALONG a body before leaving it (MoBL-ARMS's triceps and
   *  biceps both carry several via points strung down the humerus shaft,
   *  toward the elbow, before the path ever reaches the forearm) is a
   *  different case: "every point on the origin body" pulls the centroid
   *  toward the belly's own distal end and destroys the span. Since every
   *  OpenSim path here is authored proximal to distal, first-per-muscle
   *  recovers "the origin end" in both cases; the cost is that a genuine
   *  origin fan spread across MULTIPLE points on the SAME muscle (rather
   *  than across different muscles in the group) is under-counted — a
   *  narrower ellipse than the true footprint, never a wider or
   *  mispositioned one. */
  function endPointsOnBody(muscles, bodyName, origin) {
    const pts = [];
    for (const m of muscles) {
      const path = origin ? m.path : m.path.slice().reverse();
      for (const p of path) if (p.body === bodyName && p.locationMm) { pts.push(p.locationMm); break; }
    }
    return pts;
  }

  function centroid(pts) {
    const c = [0, 0, 0];
    for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    const n = Math.max(1, pts.length);
    return [c[0] / n, c[1] / n, c[2] / n];
  }

  /** half-range (max-min)/2 of one coordinate, floored so a tight cluster
   *  (e.g. quadriceps' four tendons converging on one point) does not
   *  collapse the ellipse to a line */
  function halfRange(pts, axis, floorMm) {
    if (!pts.length) return floorMm;
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { lo = Math.min(lo, p[axis]); hi = Math.max(hi, p[axis]); }
    return Math.max(floorMm, (hi - lo) / 2);
  }

  /** where a named joint sits, in the frame of `body` — its parent OR its
   *  child side (a source model records both separately; jointCenter()
   *  helpers in 00-osim.js/00-mobl-arms.js only ever hand back the parent
   *  side, so the child side is read off the model directly here) */
  function jointInBody(model, jointName, body) {
    const j = model.joints.find((x) => x.name === jointName);
    if (!j) throw new Error('muscle: no joint "' + jointName + '" in this model');
    if (j.parentBody === body) return j.locationInParentMm;
    if (j.childBody === body) return j.locationInChildMm;
    throw new Error('muscle: joint "' + jointName + '" does not touch body "' + body + '"');
  }

  /** wrap-cylinder radius, averaged over whichever of the group's member
   *  muscles reference one on `body` — 0 ("no measured wrap here") if none
   *  do; WrapEllipsoid/WrapTorus objects carry no single radius and are
   *  skipped rather than guessed at */
  function wrapRadiusOn(model, muscles, body) {
    const seen = {};
    let sum = 0, n = 0;
    for (const m of muscles) {
      for (const w of (m.wraps || [])) {
        if (seen[w.wrapObject]) continue;
        seen[w.wrapObject] = true;
        const surf = model.wrapSurfaces.find((s) => s.name === w.wrapObject);
        if (surf && surf.body === body && surf.type === 'WrapCylinder' && surf.radiusMm != null) { sum += surf.radiusMm; n++; }
      }
    }
    return n ? sum / n : 0;
  }

  /** unweighted mean tendon fraction (tendon-slack-length / muscle-tendon-
   *  unit-length, the unit length approximated as tendonSlack + fibre*cos
   *  pennation) across a group's member muscles */
  function tendonFractionOf(muscles) {
    let sum = 0, n = 0;
    for (const m of muscles) {
      const mtu = m.tendonSlackLengthMm + m.optimalFiberLengthMm * Math.cos(m.pennationAngleAtOptimalRad);
      if (mtu > 0) { sum += m.tendonSlackLengthMm / mtu; n++; }
    }
    return n ? clamp(sum / n, 0.05, 0.42) : 0.15;
  }

  // =========================================================================
  //  LOWER-BODY TOPOLOGY — measured, from Rajagopal. Which muscle-name
  //  PREFIXES fall in each group, and which Rajagopal bodies anchor it —
  //  see BASE_TO_BONE below for the graphite bone each maps to.
  // =========================================================================
  const LOWER_TOPOLOGY = {
    gluteal: {
      match: /^gl(max|med|min)[123]_r$/,
      originBase: 'pelvis', insertionBase: 'femur_r',
      arch: 'convergent', primaryJoint: { key: 'hipFlex', bone: 'femur' },
      touches: ['trunk', 'femur'],
    },
    quadriceps: {
      // recfem's true origin is the pelvis (AIIS) too, but 3 of its 4
      // member muscles (the vasti) originate on the femur alone, and the
      // femur is where the group's own visible bulk sits — so the origin
      // centroid is taken from femur-body points only. recfem's pelvis
      // point still counts toward the group's own volume via BodyParts3D,
      // it just does not pull the origin anchor proximal of where the
      // belly actually reads as starting.
      match: /^(vasint|vaslat|vasmed|recfem)_r$/,
      originBase: 'femur_r', insertionBase: 'tibia_r',
      arch: 'bipennate', primaryJoint: { key: 'knee', bone: 'tibia' },
      touches: ['femur', 'tibia'],
    },
    hamstrings: {
      // bfsh (biceps femoris short head) does not cross the hip — its own
      // origin is on the femur. One of four member muscles' origin folded
      // into a pelvis-anchored group centroid is the kind of approximation
      // a GROUP proxy exists to make.
      match: /^(bflh|bfsh|semimem|semiten)_r$/,
      originBase: 'pelvis', insertionBase: 'tibia_r',
      arch: 'strap', primaryJoint: { key: 'knee', bone: 'tibia' },
      touches: ['trunk', 'femur', 'tibia'],
    },
    // THE ADDUCTOR COMPARTMENT — this file's own header names it the
    // biggest single gap (~40mm of stand-in soft tissue at the thigh,
    // against a real subcutaneous ~10mm), and data/rajagopal.json carries
    // it whole: addbrev_r, addlong_r, and adductor magnus split into four
    // OpenSim sub-bellies (addmagProx/Mid/Dist/Isch_r — one anatomical
    // muscle, split there for its own moment-arm fidelity across hip
    // range, not four separate muscles; data/bodyparts3d.json agrees,
    // carrying magnus as one named part). All six originate on the pelvis
    // and insert on the femur — architecturally gluteal's and hamstrings'
    // own case again (pelvis -> femur), so this group is pelvis-anchored
    // the same way, patched by fixPelvisOrigins() below alongside them.
    //
    // addmagIsch_r is the "hamstring part" of adductor magnus — it really
    // does originate on the ischial tuberosity, next to the hamstrings
    // proper, and its own femur point sits at y=-387.97mm of a 408.05mm
    // reference femur (segmentLengthsMm.femur): 95% of the way down the
    // shaft, at the adductor tubercle above the medial condyle, not
    // mid-thigh. Folding it into one centroid with addbrev_r/addlong_r
    // (whose own femur points sit at y=-118 and y=-239) pulls the group's
    // insertion anchor back up toward the thigh's middle — the same trade
    // hamstrings' own comment just above already makes for bfsh, for the
    // same reason: a GROUP proxy is exactly where this belongs, not a
    // defect to work around. What is not thrown away: the origin fan
    // really does run from the pubic body to the ischial tuberosity
    // (addlong_r's pelvis point sits at x=-7.58mm anterior, addmagIsch_r's
    // at x=-89.62mm — most of the pelvis's own 154.5mm reference width),
    // so oSpreadX carries that into `aspect` rather than discarding it,
    // and every member muscle's own WrapCylinder (AB/AL/AMprox/AMmid/
    // AMdist/AMisch_at_*, radii 16.5-40mm, all on femur_r) still feeds
    // wrapInsertionMm, nudging the centreline medially the same way
    // quadriceps' and tricepsSurae's own wraps already do.
    //
    // arch 'strap', not 'bipennate' or 'convergent': the real compartment
    // reads as a continuous sheet running most of the femur's length, not
    // a single spindle-shaped belly with one bulge — the same call
    // hamstrings makes for the same reason (a broad band, pelvis to past
    // mid-thigh). 'trunk' in touches follows gluteal's and hamstrings' own
    // pelvis-anchored precedent directly above, and cannot reproduce the
    // pec/lat-style far-end bar this file's header warns a trunk-touching
    // belly can cause: checked directly in src/50-field.js, the 'trunk'
    // PART's own muscleKeys is NO_MUSCLE_BULK (that file's own "WHERE THE
    // MUSCLES SUPPLY THE SHAPE, AND WHERE THEY DOUBLE-COUNT" section —
    // ANSUR's chest/waist/hip breadth-and-depth measurements already carry
    // the trunk's true form, so no group's own field is ever consulted for
    // the trunk's own shape, adductors' included). 'trunk' here only
    // widens where GK.muscle.query()/introspection reports this group
    // touching, which is honest — the proximal end genuinely is groin-side
    // geometry — and costs nothing to get wrong, since it draws nothing.
    adductors: {
      match: /^(addbrev|addlong|addmag(Prox|Mid|Dist|Isch))_r$/,
      originBase: 'pelvis', insertionBase: 'femur_r',
      arch: 'strap', primaryJoint: { key: 'hipFlex', bone: 'femur' },
      touches: ['trunk', 'femur'],
    },
    tricepsSurae: {
      // both gastrocnemius heads originate on the femur, just above the
      // condyles; soleus originates on the tibia and is not separately
      // anchored — same group-proxy approximation as bfsh above.
      match: /^(gasmed|gaslat|soleus)_r$/,
      originBase: 'femur_r', insertionBase: 'calcn_r',
      arch: 'multipennate', primaryJoint: { key: 'ankle', bone: 'foot' },
      touches: ['femur', 'tibia', 'foot'],
    },
    // ANTEROLATERAL SHIN — the calf's own missing compartment, named in
    // this file's own header: tricepsSurae above is the posterior
    // compartment alone, so a bare-anterior shin was never a bug, it was
    // this group not existing yet. tibant_r (tibialis anterior) is one
    // muscle, origin/insertion both plain measured points (no wraps in
    // data/rajagopal.json for it, same as several existing groups — see
    // wrapRadiusOn()'s own "0 means none measured" contract). Its own
    // tibia origin point sits at [x=15.4, z=16.2]mm from the knee (+x
    // anterior, +z lateral, this file's meta.axes) — anterolateral, as
    // real tibialis anterior is: against the tibial crest and the lateral
    // condyle. Its own tendon is long relative to its belly (a raw
    // tendon-slack/MTU ratio of 0.78, well past tendonFractionOf()'s 0.42
    // ceiling — clamped there like any other group, not special-cased),
    // which is real anatomy: the belly itself sits in the upper two-thirds
    // of the shin, tapering to tendon well before the ankle.
    tibialisAnterior: {
      match: /^tibant_r$/,
      originBase: 'tibia_r', insertionBase: 'calcn_r',
      arch: 'multipennate', primaryJoint: { key: 'ankle', bone: 'foot' },
      touches: ['tibia', 'foot'],
    },
    // PERONEALS — ATTEMPTED, REVERTED. Worth recording in full because the
    // data side worked perfectly; the reason it is not here is downstream.
    //
    // perlong_r/perbrev_r (peroneus/fibularis longus and brevis;
    // data/bodyparts3d.json's own catalogue uses "fibularis", checked
    // directly) anchor exactly like tibialisAnterior above — same
    // originBase 'tibia_r', same insertionBase 'calcn_r', zero new code —
    // and BUILT cleanly: real measured points, a sensible volume (58.5 +
    // 15.8 cm3), a smooth own-field taper verified the same way
    // tibialisAnterior's was (GK.muscle.fieldAt() probed in isolation along
    // its own peak width axis: a plain symmetric bump, no discontinuity).
    // fibularis tertius exists in the bodyparts3d catalogue too but has no
    // matching Rajagopal muscle (this model does not carry it separately
    // from edl_r), so it would have been left out on this file's own
    // "anchors and volume must name the same muscles" rule regardless.
    //
    // What killed it was rendered, not computed. tibialisAnterior alone
    // (above) draws a clean anterolateral shin — one moderate crease where
    // belly gives way to tendon, the kind a real lean shin shows. Adding
    // peroneals alongside it, at seed 12345, turned the same shin's front
    // contour into a multi-step staircase (tools/skin.js 12345 90 0, framed
    // to the shin): four-plus sharp corners over about 90mm of height,
    // visible even at whole-figure scale — matching this file's own
    // warning to look for exactly this shape of failure. Isolated with
    // GK.field.radiusAlong() called directly, station by station: EACH
    // group's own field is smooth on its own (confirmed the same way for
    // both — a plain rise and fall, no jump, matching stationsFor()'s own
    // linearly-interpolated a/b down to the millimetre). Disabling only
    // peroneals' touches and re-rendering the identical figure reproduced
    // tibialisAnterior's own clean taper exactly; re-enabling it brought
    // the staircase straight back. So the fault is neither anchor: it is
    // src/50-field.js's radiusAlong(), which finds a ring's radius by
    // marching out from the bone axis and bisecting at the FIRST crossing
    // to outside (that file's own header, "THE FIRST CROSSING, NOT ANY
    // CROSSING", documents exactly this failure mode for a detached
    // shoulder belly). Two comparably-sized, independently-tapering limb
    // bellies this close together — tibialisAnterior peaking around 70-80%
    // down the tibia, peroneals a little further on — can make that march
    // non-monotone along some rays: which one the ray reaches first
    // depends on angle and height, so the reported radius hands off
    // between them rather than blending, and the handoff is what draws as
    // a corner. Never a problem with one such belly next to bone and
    // tricepsSurae; this is the first time three comparably-sized limb
    // bellies have overlapped in one small region, and it is a
    // src/50-field.js fix, not a src/45-muscle.js one, so it is not this
    // task's to make. The topology below is commented out rather than
    // deleted, so a future radiusAlong() that blends rather than marches
    // can re-enable it by uncommenting, unchanged:
    //
    // RE-ENABLED after radiusAlong() gained a step clamp: the march used to
    // trust the field as a distance and leap the thin gap between two
    // comparably-sized bellies, welding them on that ray; steps are now
    // capped near the fascia radius, so the gap cannot be jumped. If the
    // shin staircases again, this is the block to switch off first.
    peroneals: {
      match: /^per(long|brev)_r$/,
      originBase: 'tibia_r', insertionBase: 'calcn_r',
      arch: 'fusiform', primaryJoint: { key: 'ankle', bone: 'foot' },
      touches: ['tibia', 'foot'],
    },
  };
  const BASE_TO_BONE = { pelvis: 'pelvis', femur_r: 'femur', tibia_r: 'tibia', calcn_r: 'foot' };

  /** origin/insertion body's joint to the rest of the chain, expressed in
   *  ITS OWN frame — femur's own local origin IS the hip centre already
   *  (hip_r.locationInChildMm == [0,0,0] in data/rajagopal.json), so only
   *  pelvis, tibia and calcn need an actual joint looked up */
  function lowerJointCenterFor(model, base, otherBase) {
    if (base === 'pelvis') return jointInBody(model, 'hip_r', 'pelvis');
    if (base === 'femur_r') return [0, 0, 0];
    if (base === 'tibia_r') return jointInBody(model, 'walker_knee_r', 'tibia_r');
    if (base === 'calcn_r') {
      // calcn's own local origin is the subtalar joint (talus-calcn), not
      // the ankle graphite's foot bone starts at — composed via the talus,
      // ignoring the ankle/subtalar joints' own small axis cant (~10
      // degrees combined). That costs precision in where the Achilles
      // footprint sits relative to the ankle, not in the belly's own shape.
      const subtalarInTalus = jointInBody(model, 'subtalar_r', 'talus_r');
      return subtalarInTalus.map((x) => x); // talus origin == ankle exactly (ankle_r.locationInChildMm == [0,0,0])
    }
    throw new Error('muscle: no joint rule for Rajagopal body "' + base + '"');
  }

  let LOWER = null;

  /** Build LOWER from data/rajagopal.json (via GK.osim), once, lazily. */
  function deriveLower() {
    if (LOWER) return LOWER;
    if (!GK.osim || !GK.osim.model) throw new Error('muscle: call GK.osim.useModel(json) before using lower-body groups');
    const model = GK.osim.model;
    const out = {};
    for (const name in LOWER_TOPOLOGY) {
      const T = LOWER_TOPOLOGY[name];
      const muscles = model.muscles.filter((m) => T.match.test(m.name));
      if (!muscles.length) throw new Error('muscle: group "' + name + '" matched no Rajagopal muscles — check LOWER_TOPOLOGY');

      const originJoint = lowerJointCenterFor(model, T.originBase, T.insertionBase);
      const insertionJoint = lowerJointCenterFor(model, T.insertionBase, T.originBase);
      const originPts = endPointsOnBody(muscles, T.originBase, true).map((p) => vsub(p, originJoint));
      const insertionPts = endPointsOnBody(muscles, T.insertionBase, false).map((p) => vsub(p, insertionJoint));
      if (!originPts.length || !insertionPts.length) throw new Error('muscle: group "' + name + '" has no measured points on its own origin/insertion body');

      const originBone = BASE_TO_BONE[T.originBase], insertionBone = BASE_TO_BONE[T.insertionBase];
      out[name] = buildGroupFromClusters(name, T.arch, T.primaryJoint, T.touches,
        originBone, originPts, centroid(originPts),
        insertionBone, insertionPts, centroid(insertionPts),
        tendonFractionOf(muscles),
        wrapRadiusOn(model, muscles, T.originBase), wrapRadiusOn(model, muscles, T.insertionBase),
        muscles, model);
    }
    LOWER = out;
    return out;
  }

  // =========================================================================
  //  UPPER-BODY TOPOLOGY — measured, from MoBL-ARMS, except trapezius.
  //  See BASE_TO_BONE_MOBL for the graphite bone each MoBL-ARMS body maps
  //  to; 'ground' (pectoralis' and latissimus' true origin, since this is
  //  an arm-only model and the torso is implicitly fixed) is re-based onto
  //  the clavicle's own local origin — see groundToClavicle() — because
  //  that IS what "ground" represents here: the sternoclavicular joint sits
  //  27mm from it (data/mobl-arms.json's own joints[]).
  // =========================================================================
  const BASE_TO_BONE_MOBL = { clavicle: 'clavicle', scapula: 'scapula', humerus: 'humerus', ulna: 'forearm', radius: 'forearm', proximal_row: 'forearm', hand: 'forearm' };

  const UPPER_TOPOLOGY = {
    deltoid: {
      match: /^DELT[123]$/,
      // origin spans BOTH clavicle (DELT1) and scapula (DELT2/DELT3) —
      // see deltoidOriginPoints() below, which re-bases the scapula points
      // onto the clavicle so both land in one cluster
      originBase: 'clavicle', insertionBase: 'humerus',
      arch: 'multipennate', primaryJoint: { key: 'ghAbd', bone: 'humerus' },
      // 'trunk' deliberately absent, for the same reason pectoralis' and
      // latissimus' own comment gives, plus one this project's own
      // rendered test and its own fitFat() found independently: deltoid
      // is anatomically defensible in both scopes (it does originate off
      // the trunk-side skeleton), but for a DRAWING it reads as the
      // shoulder's roundness ON THE ARM, and having the trunk ring root-
      // find past a belly sitting out at the shoulder is what a chest
      // measurement jumping to the far side of the shoulder turned out to
      // be. Scoped to 'humerus' only — the visible loss is a slightly
      // squarer trunk/shoulder join than a real deltoid gives it.
      touches: ['humerus'],
    },
    pectoralis: {
      match: /^PECM[123]$/,
      originBase: 'ground', insertionBase: 'humerus',
      arch: 'convergent', primaryJoint: null, // origin (chest wall) and insertion (humerus) are several joints apart
      // 'humerus' deliberately absent — see the note where 'touches' is
      // read (fieldAt()'s own header) and this file's musclefit report.
      // A belly running diagonally from the trunk's own axis to the
      // limb's is real anatomy (pec/lat genuinely bridge the two), but
      // src/50-field.js's arm ring casts its rays from the ARM's own
      // straight axis, and a ray from THAT axis can pass close to this
      // belly's far (trunk) end at a large, direction-dependent radius
      // completely unrelated to how wide the shoulder actually is —
      // this project's own rendered test caught it as a bar reaching
      // far outside the body's own silhouette. Scoped to 'trunk' only,
      // where the belly's own near (trunk) end is what the ring casts
      // against, and the far (humeral) end simply is not drawn — a real
      // loss of a small visible bulge at the armpit, kept small
      // deliberately rather than risk it again the other direction.
      touches: ['trunk'],
    },
    latissimus: {
      match: /^LAT[123]$/,
      originBase: 'ground', insertionBase: 'humerus',
      arch: 'convergent', primaryJoint: null,
      touches: ['trunk'], // see pectoralis' own comment just above — same reason
    },
    bicepsBrachii: {
      match: /^BIC(long|short)$/,
      // true origins (supraglenoid tubercle, coracoid) are on the scapula;
      // anchored to the humerus instead, at whichever humerus-body via
      // points the model itself carries along the shaft, so the belly
      // rides the humerus and the elbow stays a direct joint from this
      // anchor (see primaryJoint) — the same trade this file made before
      // real data existed, now informed by where MoBL-ARMS's own path
      // actually runs rather than guessed.
      originBase: 'humerus', insertionBase: 'radius',
      arch: 'fusiform', primaryJoint: { key: 'elbow', bone: 'forearm' },
      touches: ['humerus', 'forearm'],
    },
    // BRACHIALIS — named in this file's own header as the arm's own gap:
    // biceps brachii alone tapers to tendon well above the elbow, and
    // nothing else in the twelve original groups fills the distal humerus
    // out to it. data/mobl-arms.json carries BRA directly (Holzbaur's own
    // model, same source biceps/triceps/the forearm mass already use), and
    // forearmMass's own comment just above already explains why BRA was
    // excluded from THAT group rather than silently missing: the task
    // naming "biceps brachii"/"triceps brachii" as specific muscles left
    // brachialis nameless until now, not unmodelled by accident.
    // Origin: BRA-P1, the path's own first point on the humerus body, at
    // [x=6.8, y=-173.9]mm from the shoulder (this file's meta.axes: +x
    // anterior, +y superior) — 60% of the way down a 290.72mm reference
    // humerus, anterior face, i.e. genuinely mid-shaft-anterior, not an
    // artefact of endPointsOnBody()'s own first-point rule (the path's
    // OWN next two points, P2/P3, are its conditional elbow-wrap via
    // points, correctly left out of the origin cluster the same way this
    // file's own header describes for triceps/biceps). Insertion: BRA-P4,
    // the path's own last point, on the ulna near the coronoid process —
    // forearmSidePoints() picks it up unchanged (BRA has no radius-body
    // point, so that half of the union is simply empty; the function does
    // not need to know that in advance). No WrapCylinder on this muscle in
    // data/mobl-arms.json (wraps: []), so wrapOriginMm/wrapInsertionMm are
    // both 0 here — a straight sweep, same as several existing groups get
    // where no wrap was measured.
    // The origin sitting 60% down the shaft, and the insertion just past
    // the elbow, is exactly what places this group's own belly on the
    // DISTAL half of the upper arm where biceps' own taper leaves a gap —
    // not tuned to do that, just where BRA's own recorded path already is.
    brachialis: {
      match: /^BRA$/,
      originBase: 'humerus', insertionBase: 'ulna',
      arch: 'fusiform', primaryJoint: { key: 'elbow', bone: 'forearm' },
      touches: ['humerus', 'forearm'],
    },
    tricepsBrachii: {
      match: /^TRI(long|lat|med)$/,
      originBase: 'humerus', insertionBase: 'ulna',
      arch: 'multipennate', primaryJoint: { key: 'elbow', bone: 'forearm' },
      touches: ['humerus', 'forearm'],
    },
    forearmMass: {
      // every wrist/finger flexor, extensor, pronator and supinator MoBL-
      // ARMS carries — the common flexor/extensor origin on the humeral
      // epicondyles down to where the bellies give way to tendon in the
      // forearm. Excludes brachialis (BRA) and anconeus (ANC): the task's
      // own group list names "biceps brachii"/"triceps brachii" as
      // specific muscles, not a generic elbow-flexor/extensor compartment,
      // and BRA/ANC are neither of those nor part of the wrist/finger mass.
      match: /^(BRD|ECRL|ECRB|ECU|FCR|FCU|PL|PT|PQ|SUP|FDSL|FDSR|FDSM|FDSI|FDPL|FDPR|FDPM|FDPI|EDCL|EDCR|EDCM|EDCI|EDM|EIP|EPL|EPB|FPL|APL)$/,
      originBase: 'humerus', insertionBase: 'radius',
      arch: 'fusiform', primaryJoint: { key: 'elbow', bone: 'forearm', weak: true },
      touches: ['humerus', 'forearm'],
    },
  };

  /** MoBL-ARMS' own joint chain composes several zero-length "phantom"
   *  bodies between clavicle and humerus for scapulothoracic rhythm (see
   *  data/mobl-arms.json's meta.phantomBodies); every one of those joints'
   *  locationInChildMm is exactly [0,0,0] (checked directly against the
   *  file), so a body's own local origin, relative to whichever real body
   *  is above it, is just the sum of the intervening locationInParentMm
   *  values at the reference (zero-coordinate) pose. */
  function mobjBodyOriginRelative(model, body, relativeTo) {
    const CHAIN = {
      scapula: [['sternoclavicular', 'clavicle'], ['unrotscap', 'clavphant'], ['acromioclavicular', 'scapula']],
      humerus: [['unrothum', 'scapphant'], ['shoulder0', 'humphant'], ['shoulder1', 'humphant1'], ['shoulder2', 'humerus']],
    };
    if (body === 'humerus' && relativeTo === 'scapula') {
      return CHAIN.humerus.reduce((acc, [joint]) => vadd(acc, jointInBody(model, joint, joint === 'unrothum' ? 'scapula' : model.joints.find((j) => j.name === joint).parentBody)), [0, 0, 0]);
    }
    if (body === 'scapula' && relativeTo === 'clavicle') {
      return vadd(jointInBody(model, 'unrotscap', 'clavicle'), jointInBody(model, 'acromioclavicular', 'clavphant'));
    }
    throw new Error('muscle: no mobl phantom-chain rule for ' + body + ' relative to ' + relativeTo);
  }

  /** pectoralis'/latissimus' origin points are fixed to 'ground' in MoBL-
   *  ARMS (this is an arm-only model; the torso is implicit) — re-based
   *  onto the clavicle's own local origin via the sternoclavicular joint,
   *  which sits 27mm from ground's own origin in this file's own data */
  function groundToClavicle(model, groundPt) {
    return vsub(groundPt, jointInBody(model, 'sternoclavicular', 'ground'));
  }

  /** deltoid's origin spans clavicle (DELT1) and scapula (DELT2/DELT3) —
   *  gathered into ONE cluster, all relative to the clavicle's own origin */
  function deltoidOriginPoints(model, muscles) {
    const onClavicle = endPointsOnBody(muscles, 'clavicle', true);
    const scapRel = mobjBodyOriginRelative(model, 'scapula', 'clavicle');
    const onScapula = endPointsOnBody(muscles, 'scapula', true).map((p) => vadd(p, scapRel));
    return onClavicle.concat(onScapula);
  }

  /** biceps'/triceps'/the forearm mass's forearm-side points land on
   *  'ulna' (already relative to the elbow: ulna's own local origin IS the
   *  elbow, elbow.locationInChildMm == [0,0,0]) or on 'radius' (re-based
   *  onto ulna's origin via the radioulnar joint) */
  function forearmSidePoints(model, muscles) {
    const onUlna = endPointsOnBody(muscles, 'ulna', false);
    const radRel = jointInBody(model, 'radioulnar', 'ulna');
    const onRadius = endPointsOnBody(muscles, 'radius', false).map((p) => vadd(p, radRel));
    return onUlna.concat(onRadius);
  }

  let UPPER = null;

  function deriveUpper() {
    if (UPPER) return UPPER;
    if (!GK.mobl || !GK.mobl.model) throw new Error('muscle: call GK.mobl.useModel(json) before using MoBL-ARMS-anchored upper-body groups');
    const model = GK.mobl.model;
    const out = {};
    for (const name in UPPER_TOPOLOGY) {
      const T = UPPER_TOPOLOGY[name];
      const muscles = model.muscles.filter((m) => T.match.test(m.name));
      if (!muscles.length) throw new Error('muscle: group "' + name + '" matched no MoBL-ARMS muscles — check UPPER_TOPOLOGY');

      let originPts, originJoint;
      if (name === 'deltoid') {
        originPts = deltoidOriginPoints(model, muscles); originJoint = [0, 0, 0]; // already clavicle-relative
      } else if (T.originBase === 'ground') {
        originPts = endPointsOnBody(muscles, 'ground', true).map((p) => groundToClavicle(model, p)); originJoint = [0, 0, 0];
      } else if (T.originBase === 'humerus') {
        originPts = endPointsOnBody(muscles, 'humerus', true); originJoint = [0, 0, 0]; // humerus own origin == shoulder joint, taken as the reference directly
      } else {
        throw new Error('muscle: no origin rule for upper group "' + name + '"');
      }

      let insertionPts;
      if (T.insertionBase === 'humerus') insertionPts = endPointsOnBody(muscles, 'humerus', false);
      else insertionPts = forearmSidePoints(model, muscles); // 'radius' or 'ulna'
      if (!originPts.length || !insertionPts.length) throw new Error('muscle: group "' + name + '" has no measured points on its own origin/insertion body');

      const originBone = name === 'deltoid' || T.originBase === 'ground' ? 'clavicle' : BASE_TO_BONE_MOBL[T.originBase];
      const insertionBone = BASE_TO_BONE_MOBL[T.insertionBase];
      out[name] = buildGroupFromClusters(name, T.arch, T.primaryJoint, T.touches,
        originBone, originPts, centroid(originPts),
        insertionBone, insertionPts, centroid(insertionPts),
        tendonFractionOf(muscles),
        wrapRadiusOn(model, muscles, T.originBase === 'ground' ? 'ground' : (name === 'deltoid' ? 'clavicle' : T.originBase)),
        wrapRadiusOn(model, muscles, T.insertionBase),
        muscles, model);
    }
    UPPER = out;
    return out;
  }

  // =========================================================================
  //  SHARED GROUP BUILDER — turns two point clusters (already re-based onto
  //  their own bone's local origin) into the normalized shape every group
  //  ends up in, whichever source they came from. Bone-local vectors for
  //  femur/tibia/humerus/forearm/foot go through restFrame()/unapply(),
  //  which is figure-independent and exact (see the header on restFrame()
  //  and on mirrorLocal()). Bone-local vectors for clavicle/scapula CANNOT
  //  — those bones' rest orientation is aimTo-anchored and so varies per
  //  figure — so they are stored instead as a FRACTION of that bone's own
  //  resolved length, read directly off the source point's own local axes
  //  (its "how far toward the distal end / how far lateral / how far
  //  anterior", each already a convention-independent physical quantity,
  //  divided by that same body's own segment length) and reapplied through
  //  frame[0]/[1]/[2] AT QUERY TIME, when the actual figure's actual
  //  clavicle/scapula orientation exists to reapply it against. This is a
  //  looser claim than restFrame()'s exact algebra — it trusts that a
  //  fraction-of-length transfers between two source conventions, not that
  //  it is identical — and is the only anchor available for a bone whose
  //  own orientation moves with the figure being posed.
  // =========================================================================
  const FRACTION_BONES = { clavicle: 1 };
  const SEG_LEN_MOBL = { clavicle: 137.76 }; // data/mobl-arms.json's own segmentLengthsMm

  // The along/width/depth -> raw-(x,y,z) correspondence used for every
  // OTHER bone (raw y = along, raw z = width, raw x = depth) is really
  // "along = whichever raw axis this bone's own length actually runs on",
  // which for a near-VERTICAL limb bone (humerus, femur, ...) happens to be
  // raw Y (superior). The clavicle is not vertical — it runs mostly side to
  // side — and checking data/mobl-arms.json's own joints[] confirms it: the
  // clavicle's distal end (the unrotscap joint) sits at [-14.33, 20.07,
  // 135.54] relative to the clavicle's own origin, i.e. almost entirely on
  // raw Z (135.5mm of a 137.76mm-long bone), not raw Y. So "along" for the
  // clavicle is read off THAT direction specifically — computed once,
  // lazily, from the model itself rather than assumed — and the remaining
  // (perpendicular) component is what is left for width/depth, rather than
  // reusing the raw point's un-adjusted x/y/z, which double-counts the
  // clavicle's own length into what should be a small transverse offset (a
  // bug this project's own testing caught: a deltoid origin computed the
  // old way landed 120mm above the shoulder instead of on the clavicle).
  let _clavicleAxisRaw = null;
  function clavicleAxisRaw(model) {
    if (_clavicleAxisRaw) return _clavicleAxisRaw;
    return (_clavicleAxisRaw = vnorm(jointInBody(model, 'unrotscap', 'clavicle')));
  }

  function localVectorFor(boneBase, rawPoint, model) {
    // rawPoint already relative to that body's own local origin, in the
    // SOURCE model's own raw convention (x=anterior, y=superior, z=right —
    // data/rajagopal.json's and data/mobl-arms.json's own meta.axes)
    if (boneBase === 'pelvis') return { kind: 'local', vecR: [0, 0, 0] }; // placeholder — overwritten by fixPelvisOrigins(), which has no single fixed bone frame to resolve against (see its own header)
    if (FRACTION_BONES[boneBase]) {
      const L = SEG_LEN_MOBL[boneBase] || 100;
      const axis = clavicleAxisRaw(model);
      const alongMm = vdot(rawPoint, axis);
      const perp = vsub(rawPoint, vmul(axis, alongMm));
      // The perpendicular remainder's own raw x/y/z is what is left once
      // the along-the-bone direction is removed — mapped onto width/depth
      // the same way the vertical bones are (raw z-ish -> width, raw x-ish
      // -> depth), a pragmatic carry-over rather than a re-derived,
      // independently-checked correspondence the way restFrame()'s bones
      // are. NOT small by construction, and it matters which: deltoid's
      // clavicle point is genuinely close to the clavicle, and this
      // formula places it correctly. Pectoralis' and latissimus' points
      // arrive here via groundToClavicle() — 'ground' is this arm-only
      // model's fixed-world frame, and a real latissimus origin is on the
      // LUMBAR spine, hundreds of millimetres from the clavicle in that
      // frame; the perpendicular residual for it is genuinely that large,
      // not an error to be trusted at face value the way deltoid's is.
      // Clamped rather than trusted raw: this project's own testing
      // caught the unclamped version as a belly extending far outside the
      // body's own silhouette (a lumpy horizontal bar off the shoulder).
      // The honest fix is a dedicated spine-level anchor for pectoralis
      // and latissimus' own broad, distant origin, matching how trapezius
      // and the abdominal mass are already anchored (UPPER_EST /
      // groupsTable()'s own abdominal entry) — not implemented here for
      // lack of time; this clamp is the stopgap that keeps the belly from
      // leaving its own body while that is still true.
      const FRAC_CAP = 0.55;
      return {
        kind: 'fraction', along: clamp(alongMm / L, -0.15, 1.15),
        width: clamp(vdot(perp, [0, 0, 1]) / L, -FRAC_CAP, FRAC_CAP),
        depth: clamp(vdot(perp, [1, 0, 0]) / L, -FRAC_CAP, FRAC_CAP),
      };
    }
    const anat = [rawPoint[1], -rawPoint[2], rawPoint[0]]; // (superior, left, anterior)
    return { kind: 'local', vecR: unapply(restFrame(boneBase + '.R'), anat) };
  }

  // restFrame()/unapply() derives vecR from the SOURCE model's own
  // reference specimen (Rajagopal's own subject for femur/tibia/foot,
  // MoBL-ARMS's own subject for humerus/forearm) — a rotation only, never
  // scaled by any figure's own bone length, so vecR is still in THAT
  // reference specimen's OWN millimetres. Reapplying it unscaled to a
  // figure with a shorter or longer bone either buries the anchor inside
  // the bone or pushes it past the next joint entirely — this project's own
  // testing caught it as a bimodal failure (about half of sampled bodies)
  // in tools/girthcheck.js, wherever a bone happened to sit far enough from
  // the reference length. So every 'local'-kind vector is rescaled here, at
  // query time, by THIS figure's own resolved bone length over the source
  // model's reference length for that same bone — the same ratio
  // GK.osim.scaleFactors() computes for Rajagopal-sourced points, done
  // directly here because MoBL-ARMS-sourced ones (humerus, forearm) have no
  // equivalent helper of their own.
  const SOURCE_REF_LEN_MM = {
    femur: 408.05, tibia: 396.47,       // data/rajagopal.json's own segmentLengthsMm
    humerus: 290.72, forearm: 243.95,   // data/mobl-arms.json's own segmentLengthsMm
  };

  function localMmClosureFor(lv, boneBase) {
    if (lv.kind === 'fraction') {
      return (rig, side) => { const b = rig.bones[boneBase + '.' + side]; const L = b ? b.len : 0; return [lv.along * L, lv.width * L, lv.depth * L]; };
    }
    const ref = SOURCE_REF_LEN_MM[boneBase];
    return (rig, side) => {
      const b = rig.bones[(boneBase === 'pelvis' ? 'pelvis' : boneBase + '.' + side)];
      const k = (ref && b && b.len) ? b.len / ref : 1;
      return vmul(lv.vecR, k);
    };
  }

  function buildGroupFromClusters(name, arch, primaryJoint, touches,
    originBone, originPts, originCentroid,
    insertionBone, insertionPts, insertionCentroid,
    tendonFrac, wrapOriginMm, wrapInsertionMm, muscles, sourceModel) {

    const FLOOR = 6; // mm — a tendon's own footprint is not a point
    const oSpreadX = halfRange(originPts, 0, FLOOR), oSpreadZ = halfRange(originPts, 2, FLOOR);
    const iSpreadX = halfRange(insertionPts, 0, FLOOR), iSpreadZ = halfRange(insertionPts, 2, FLOOR);
    const aspect = clamp(Math.sqrt((oSpreadZ / oSpreadX) * (iSpreadZ / iSpreadX)), 0.55, 2.6);

    const originLV = localVectorFor(originBone, originCentroid, sourceModel);
    const insertionLV = localVectorFor(insertionBone, insertionCentroid, sourceModel);

    return {
      name, region: 'measured', arch, primaryJoint, touches,
      origin: { frameBone: originBone, refBone: originBone, refIsB: false, localMm: localMmClosureFor(originLV, originBone) },
      insertion: { frameBone: insertionBone, refBone: insertionBone, refIsB: false, localMm: localMmClosureFor(insertionLV, insertionBone) },
      aspect, tendonFrac,
      wrapOriginMm, wrapInsertionMm,
      bp3d: null, // filled in by attachVolumes()
    };
  }

  // =========================================================================
  //  PELVIS-ANCHORED ORIGINS (gluteal, hamstrings) — SPECIAL CASE.
  //  The pelvis bone has no length of its own (src/10-skeleton.js: "the
  //  root IS the sacral base"), so there is no "fraction of pelvis length"
  //  to lean on the way there is for every other bone. Instead the origin
  //  is stored as an offset from the HIP — a point BOTH systems place
  //  precisely (Rajagopal's jointCenter('hip_r'); graphite's own
  //  rig.bones['femur.<side>'].A) — scaled by the SAME femur-length ratio
  //  the group's own insertion side already needs, and added to
  //  fig.at.hip (graphite's own, exact, per-figure hip-in-pelvis-frame
  //  offset) at query time.
  // =========================================================================
  function isPelvisAnchored(group) { return group.origin.frameBone === 'pelvis'; }

  // Patch the pelvis-anchored groups' origin closures once LOWER exists —
  // done as a second pass rather than inline above because it needs
  // `femur`'s OWN resolved length at query time, which localMmClosureFor()
  // does not carry for every one of them (femur is the group's INSERTION
  // bone for gluteal and for adductors, so those two already have it from
  // their own plain insertion closure; hamstrings' insertion is tibia, so
  // it does not, and needs this pass for that reason as much as for the
  // origin itself).
  function fixPelvisOrigins(lower, model) {
    for (const name of ['gluteal', 'hamstrings', 'adductors']) {
      const g = lower[name];
      const T = LOWER_TOPOLOGY[name];
      const muscles = model.muscles.filter((m) => T.match.test(m.name));
      const hipJoint = jointInBody(model, 'hip_r', 'pelvis');
      const pts = endPointsOnBody(muscles, 'pelvis', true).map((p) => vsub(p, hipJoint));
      const c = centroid(pts);
      const anat = [c[1], -c[2], c[0]]; // (superior, left, anterior), relative to the hip
      g.origin = {
        frameBone: 'pelvis', refBone: 'femur', refIsB: false,
        localMm: (rig, side) => anat, // Rajagopal-scale mm; scaled below at query time by the femur ratio, same as the group's own insertion-side scaling
        _rajAnat: anat,
      };
    }
  }

  // =========================================================================
  //  ANCHOR RESOLUTION
  // =========================================================================
  // Most anchoring bones are side-bearing (femur, tibia, humerus, forearm,
  // foot, clavicle, scapula); the pelvis and every spine vertebra (T1, T8,
  // T12, ...) are not — 10-skeleton.js declares those once, not per side —
  // so `.R`/`.L` is only appended when GK.skel actually mirrored that id.
  function boneId(base, side) { return GK.skel.BY_ID[base + '.' + side] ? base + '.' + side : base; }

  function anchorWorld(rig, side, anchor) {
    const fb = rig.bones[boneId(anchor.frameBone, side)];
    const rb = rig.bones[boneId(anchor.refBone, side)];
    if (!fb || !rb) return null;
    if (anchor.frameBone === 'pelvis' && anchor.refBone === 'femur') {
      // the pelvis-anchored special case: offset-from-hip (Rajagopal mm,
      // scaled by the femur length ratio) + fig.at.hip (exact, per-figure)
      const femurRef = GK.osim.model.segmentLengthsMm.femur;
      const k = rb.len / femurRef;
      const scaled = vmul(anchor.localMm(rig, side), k);
      const hip = rig.figure.at.hip;
      /* RIGHT-SIDE CONVENTION, and only once. Every local vector in this
         file is expressed as Rajagopal expresses it — for the RIGHT limb —
         and mirrorLocal() below is what turns it into a left one. This line
         used to apply its own side sign as well, so the left leg got flipped
         twice and landed back on the right: gluteal.L's station centres ran
         from y = -83 to +124, starting on the wrong side of the body and
         crossing the midline to reach their own femur. Measured on the
         drawing, the left thigh's own outline reached 216mm across its axis
         to a point 143mm the WRONG side of the midline.
         quadriceps and triceps surae were unaffected and that is the tell:
         they anchor to the femur, which the skeleton has already mirrored,
         while the pelvis is a midline bone and has not. */
      const hipInPelvis = [hip[0], -Math.abs(hip[1]), hip[2]];
      const local = mirrorLocal(vadd(hipInPelvis, scaled), side);
      return vadd(fb.A, M.mApply(fb.frame, local));
    }
    const ref = anchor.refIsB ? rb.B : rb.A;
    const local = mirrorLocal(anchor.localMm(rig, side), side);
    return vadd(ref, M.mApply(fb.frame, local));
  }

  /** the two in-plane directions for an anchor's own bone, world-space,
   *  side-corrected the same way anchorWorld() side-corrects the position.
   *  frame[1]/frame[2] read as (lateral, anterior) for every bone this file
   *  anchors width/depth against — verified against src/40-surface.js's own
   *  trunk convention and against the known hip-spacing sign; NOT relied on
   *  for the foot, whose own rest orientation is a quarter-turn away from
   *  every other limb bone's (10-skeleton.js: "the foot leaves the ankle
   *  forwards, not downwards"), so triceps surae's insertion end carries no
   *  width/depth spread of its own (see attachVolumes()/stationsFor()). */
  /**
   * Make every station's cross-section frame actually perpendicular to that
   * station's own axis.
   *
   * WHY THIS IS NOT A TIDINESS. width and depth come from an anchor BONE's
   * frame, on the documented assumption that frame[1]/frame[2] read as
   * lateral and anterior for every bone anchored against. That holds for
   * every bone in this skeleton but one: the scapula is a 55mm strut running
   * medially and slightly down from the acromion to the glenohumeral centre,
   * not a long bone standing up, so ITS frame[1] points very nearly along
   * the deltoid's own length. Measured on the deltoid's own stations, the
   * width axis and the segment axis came out at a dot product of -0.99 —
   * parallel, where they must be perpendicular.
   *
   * A cross-section frame lying along the belly instead of across it does
   * not make the belly slightly wrong. It transposes it: displacement along
   * the muscle gets divided by the cross-section's small semi-axis and
   * displacement across it by the long one, so the solid is a disc lying
   * flat along the arm rather than a section cut across it. The field then
   * reports "inside" out to 453mm from the midline — a shoulder is 217 —
   * and the drawing grew a horizontal plank out of each shoulder, wider than
   * the figure and with a squared-off end. Same family as the clavicle
   * long-axis bug already fixed above, and found the same way: by measuring
   * the frame rather than trusting the comment that describes it.
   *
   * The axis is the trustworthy part — it is the difference of two station
   * centres and cannot be misread. So keep it, project the anchor's width
   * onto the plane across it, and rebuild depth as the third leg. Where the
   * anchor's width is SO nearly parallel to the axis that the residual is
   * meaningless, fall back to world lateral and then world anterior, which
   * are perpendicular to almost any belly's axis and are at worst a roll
   * about an axis that is still correct.
   */
  function orthonormalise(stations) {
    if (stations.length < 2) return;
    for (let i = 0; i < stations.length; i++) {
      const st = stations[i];
      const prev = stations[Math.max(0, i - 1)], next = stations[Math.min(stations.length - 1, i + 1)];
      const ax = vnorm(vsub(next.center, prev.center));
      if (vlen(ax) < 1e-9) continue;
      let w = vsub(st.width, vmul(ax, vdot(st.width, ax)));
      if (vlen(w) < 0.2) {
        // The anchor's width was useless here, but its DEPTH still carries
        // the belly's anatomical roll, and roll is not free to choose: the
        // section is elliptical, so turning it a quarter-turn points the
        // long semi-axis where the short one belongs. Reaching straight for
        // a world axis instead cost a 576mm spike out of one thigh and not
        // the other, because the two sides fell back differently.
        w = vcross(st.depth, ax);
        if (vlen(w) < 0.2) {
          for (const guess of [[0, 1, 0], [0, 0, 1], [1, 0, 0]]) {
            w = vsub(guess, vmul(ax, vdot(guess, ax)));
            if (vlen(w) > 0.2) break;
          }
        }
      }
      w = vnorm(w);
      st.axis = ax;
      st.width = w;
      st.depth = vnorm(vcross(ax, w));
    }
  }

  function anchorAxes(rig, side, anchor) {
    const fb = rig.bones[boneId(anchor.frameBone, side)];
    const s = side === 'R' ? 1 : -1;
    return { width: vmul(fb.frame[1], s), depth: fb.frame[2] };
  }

  // =========================================================================
  //  TRAPEZIUS — the one EST anchor. MoBL-ARMS has no trapezius (see file
  //  header); everything about its POSITION here is a skeletal-landmark
  //  offset, one line of justification each, structured exactly like every
  //  measured group above (same origin/insertion shape) so a future
  //  trapezius extraction — from wherever one eventually comes — drops in
  //  by replacing this one entry, not by touching anything downstream of
  //  it. Its VOLUME is not estimated: see BP3D_GROUPS.
  // =========================================================================
  const UPPER_EST = {
    trapezius: {
      arch: 'convergent', aspect: 1.8, tendonFrac: 0.12,
      primaryJoint: { key: 'clavElev', bone: 'clavicle' }, // T1 is the clavicle's own graphite parent — a direct joint
      touches: ['trunk'],
      // EST: occiput-to-T12 spinous processes is what the whole muscle
      // spans; T1 (the cervicothoracic junction, and the clavicle's own
      // graphite parent) stands in for that centroid, posterior since
      // spinous processes are the back of the spine, not its centre.
      origin: { frameBone: 'T1', refBone: 'T1', refIsB: false, localMm: () => [0, 0, -32] },
      // EST: right at the clavicle's own acromial end — upper trap's
      // insertion band is centred almost exactly there.
      insertion: { frameBone: 'clavicle', refBone: 'clavicle', refIsB: true, localMm: () => [0, 0, 0] },
    },
  };

  // =========================================================================
  //  BODYPARTS3D VOLUME — see the file header's VOLUME section. Which
  //  right-side catalogue NAMES (data/bodyparts3d.json) sum into each
  //  group's volume and bounding box; must match the same muscles the
  //  group's own anchors above are built from (a group's SIZE and its
  //  SHAPE should not silently disagree about what "this group" contains).
  // =========================================================================
  const BP3D_GROUPS = {
    gluteal: ['right gluteus maximus', 'right gluteus medius', 'right gluteus minimus'],
    quadriceps: ['right vastus lateralis', 'right vastus medialis', 'right vastus intermedius', 'right rectus femoris'],
    hamstrings: ['long head of right biceps femoris', 'short head of right biceps femoris', 'right semimembranosus', 'right semitendinosus'],
    // magnus, longus, brevis only — matching adductors' own LOWER_TOPOLOGY
    // match exactly (addbrev/addlong/addmag*_r). data/bodyparts3d.json also
    // separately catalogues "right adductor minimus" (12.7cm3, the
    // smallest of the four) but data/rajagopal.json carries no matching
    // muscle of its own — most sources fold minimus into magnus's own most
    // proximal fibres, which is exactly where addmagProx_r already sits —
    // so it is left out of the sum on the same rule this table's own
    // header states: a group's size and its shape must name the same
    // muscles.
    adductors: ['right adductor magnus', 'right adductor longus', 'right adductor brevis'],
    tricepsSurae: ['medial head of right gastrocnemius', 'lateral head of right gastrocnemius', 'right soleus'],
    deltoid: ['clavicular part of right deltoid', 'acromial part of right deltoid', 'spinal part of right deltoid'],
    pectoralis: ['clavicular part of right pectoralis major', 'sternocostal part of right pectoralis major', 'abdominal part of right pectoralis major'],
    latissimus: ['right latissimus dorsi'],
    trapezius: ['ascending part of right trapezius', 'transverse part of right trapezius', 'descending part of right trapezius'],
    bicepsBrachii: ['long head of right biceps brachii', 'short head of right biceps brachii'],
    // single named part in data/bodyparts3d.json's own catalogue — unlike
    // biceps/triceps it is not split into heads there
    brachialis: ['right brachialis'],
    tricepsBrachii: ['long head of right triceps brachii', 'lateral head of right triceps brachii', 'medial head of right triceps brachii'],
    tibialisAnterior: ['right tibialis anterior'],
    // peroneals: attempted and reverted — see LOWER_TOPOLOGY's own comment
    // on it, just above tibialisAnterior's table entry, for why. Not
    // listed here for the same reason its GIRTH_SITE entry below is not:
    // GROUP_NAMES never names it, so nothing tries to attach a volume to a
    // group that no longer exists in the table.
    abdominal: ['right rectus abdominis', 'right external oblique', 'right internal oblique'],
    forearmMass: [
      'right brachioradialis', 'right extensor carpi radialis longus', 'right extensor carpi radialis brevis',
      'humeral head of right extensor carpi ulnaris', 'ulnar head of right extensor carpi ulnaris',
      'right flexor carpi radialis', 'humeral head of right flexor carpi ulnaris', 'ulnar head of right flexor carpi ulnaris',
      'right palmaris longus', 'humeral head of right pronator teres', 'ulnar head of right pronator teres', 'right pronator quadratus',
      'right supinator', 'humeroulnar head of right flexor digitorum superficialis', 'radial head of right flexor digitorum superficialis',
      'right flexor digitorum profundus', 'right extensor digitorum', 'right extensor digiti minimi', 'right extensor indicis',
      'right extensor pollicis longus', 'right extensor pollicis brevis', 'right flexor pollicis longus', 'right abductor pollicis longus',
    ],
  };

  // The reference specimen's own segment lengths (data/bodyparts3d.json,
  // ONE adult male, stature 1655mm) — bounding box, third/superior axis, of
  // the named whole bone. Used only to turn a girth ratio into a reference
  // girth (see girthRefEstimate()); the muscle's own LENGTH term in the
  // scaling formula comes from that muscle's own bounding box, not from
  // this table — see attachVolumes().
  let REF_SEGMENT_MM = null;
  function refSegmentLengths() {
    if (REF_SEGMENT_MM) return REF_SEGMENT_MM;
    const bones = { femur: 'right femur', tibia: 'right tibia', humerus: 'right humerus', forearm: 'right ulna' };
    const out = {};
    for (const k in bones) {
      const id = bp3dIdByName(bones[k]);
      out[k] = id ? GK.bp3d.mesh(id).boundingBoxMm.sizeMm[2] : null;
    }
    return (REF_SEGMENT_MM = out);
  }

  // Which ANSUR girth, and which reference segment, sizes each group's
  // cross-section term (girth_target/girth_ref)^2 — "the segment the
  // muscle acts on", per the brief. Where no single segment obviously
  // applies (abdominal, and gluteal's pelvis-anchored end) femur stands in
  // as a general body-size proxy — it is the group's OWN length term
  // (below) that actually carries most of the sizing signal for those two.
  const GIRTH_SITE = {
    gluteal: { girth: 'hip', seg: 'femur' },
    quadriceps: { girth: 'thigh', seg: 'femur' },
    hamstrings: { girth: 'thigh', seg: 'femur' },
    adductors: { girth: 'thigh', seg: 'femur' }, // same site as quadriceps/hamstrings — one ANSUR thigh circumference, no separate medial measurement exists to size against
    tricepsSurae: { girth: 'calf', seg: 'tibia' },
    deltoid: { girth: 'bideltoid', seg: 'humerus' }, // a breadth, not a circumference — 00-anthro.js's girths() deliberately carries no shoulder circumference (not in the fitted column set); bideltoid is the measured shoulder-width stand-in it names for exactly this
    pectoralis: { girth: 'chest', seg: 'humerus' },
    latissimus: { girth: 'chest', seg: 'humerus' },
    trapezius: { girth: 'neck', seg: 'humerus' },
    bicepsBrachii: { girth: 'biceps', seg: 'humerus' },
    brachialis: { girth: 'biceps', seg: 'humerus' }, // same site as biceps/triceps — brachialis sits under/distal to biceps on the same segment, no separate ANSUR site for it
    tricepsBrachii: { girth: 'biceps', seg: 'humerus' },
    tibialisAnterior: { girth: 'calf', seg: 'tibia' }, // same site as tricepsSurae — anterior/posterior share the one ANSUR calf circumference
    abdominal: { girth: 'waist', seg: 'femur' },
    forearmMass: { girth: 'forearm', seg: 'forearm' },
  };

  let _bp3dNameMap = null;
  function bp3dIdByName(name) {
    if (!_bp3dNameMap) {
      _bp3dNameMap = {};
      for (const p of GK.bp3d.model.parts) if (p.hasMesh) _bp3dNameMap[p.name.toLowerCase()] = p.id;
    }
    return _bp3dNameMap[name.toLowerCase()] || null;
  }

  /** the population's own mean(girth)/mean(segment length), from the fitted
   *  ANSUR model — sampled once, cached — used to turn the reference
   *  specimen's OWN measured segment length into an estimated reference
   *  girth for that same segment (see attachVolumes()) */
  const _girthRefCache = {};
  function girthRefEstimate(girthKey, segKey) {
    const key = girthKey + '|' + segKey;
    if (_girthRefCache[key] !== undefined) return _girthRefCache[key];
    if (!GK.anthro || !GK.anthro.model) throw new Error('muscle: call GK.anthro.useModel(json) before using measured-volume groups');
    const N = 80;
    let gSum = 0, sSum = 0;
    for (let i = 0; i < N; i++) {
      const m = GK.anthro.sampleBody(9001 + i * 613);
      gSum += GK.anthro.girths(m)[girthKey];
      sSum += GK.anthro.segments(m)[segKey];
    }
    const ratio = gSum / sSum;
    const refSeg = refSegmentLengths()[segKey];
    return (_girthRefCache[key] = refSeg ? ratio * refSeg : null);
  }

  /** attach a measured volume (+ bounding box, for the sanity check) to
   *  every group, from data/bodyparts3d.json, once. Idempotent: called
   *  from both deriveLower()/deriveUpper()'s callers and from
   *  attachEst()'s trapezius path. */
  function volumeFor(name) {
    const names = BP3D_GROUPS[name];
    if (!names) throw new Error('muscle: no BP3D_GROUPS entry for "' + name + '"');
    let volMm3 = 0;
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    let found = 0;
    for (const n of names) {
      const id = bp3dIdByName(n);
      if (!id) continue;
      const mesh = GK.bp3d.mesh(id);
      if (!mesh) continue;
      found++;
      volMm3 += mesh.enclosedVolumeMm3;
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], mesh.boundingBoxMm.min[k]); hi[k] = Math.max(hi[k], mesh.boundingBoxMm.max[k]); }
    }
    if (!found) throw new Error('muscle: none of BP3D_GROUPS["' + name + '"] were found in data/bodyparts3d.json — name mismatch?');
    return { volMm3, lengthRefMm: hi[2] - lo[2], boxMm: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
  }

  // =========================================================================
  //  NORMALIZED GROUP TABLE
  // =========================================================================
  const GROUP_NAMES = ['deltoid', 'pectoralis', 'latissimus', 'trapezius', 'abdominal',
    'gluteal', 'quadriceps', 'hamstrings', 'adductors', 'tricepsSurae', 'tibialisAnterior',
    'bicepsBrachii', 'brachialis', 'tricepsBrachii', 'forearmMass'];

  /**
   * pectoralis' and latissimus' origins are re-based from MoBL-ARMS's
   * 'ground' body (see groundToClavicle()'s own comment: this is an arm-
   * only model, so a chest-wall or lumbar-spine origin is fixed straight
   * to its world frame rather than to any body on the arm). Treating that
   * as a small offset from the clavicle — which localVectorFor()'s
   * FRACTION_BONES path does for every OTHER clavicle/scapula anchor —
   * is wrong specifically here: a real latissimus origin is on the LUMBAR
   * spine, hundreds of millimetres from the clavicle, and even clamped
   * (see localVectorFor()'s own comment) that measured-but-misapplied
   * point still read as a belly reaching out past the shoulder — this
   * project's own rendered test caught it as a lumpy bar outside the
   * body's own silhouette. So the origin is overridden here to a plain
   * skeletal-landmark offset, same discipline and same shape as
   * trapezius/the abdominal mass just below: EST, one line of anatomical
   * reasoning each, not a measurement. Only the ORIGIN changes — the
   * INSERTION (on the humerus) and the VOLUME (bodyparts3d) stay exactly
   * as measured, and are most of what shapes the swept belly anyway.
   */
  function fixChestBackOrigins(upper) {
    upper.pectoralis.origin = {
      // EST: mid-sternum, T3-ish — pec major's clavicular and upper
      // sternocostal fibres both converge roughly here.
      frameBone: 'T3', refBone: 'T3', refIsB: false, localMm: () => [0, 0, 95],
    };
    upper.latissimus.origin = {
      // EST: T9-ish, at the back — the real origin (thoracolumbar fascia,
      // T7 down to the iliac crest) has no single point; this is the
      // least-arbitrary one-vertebra stand-in for that span's own centroid.
      frameBone: 'T9', refBone: 'T9', refIsB: false, localMm: () => [0, 0, -55],
    };
  }

  let TABLE = null;
  function groupsTable() {
    if (TABLE) return TABLE;
    const lower = deriveLower();
    fixPelvisOrigins(lower, GK.osim.model);
    const upper = deriveUpper();
    fixChestBackOrigins(upper);
    const out = Object.assign({}, lower, upper);

    // abdominal has no separate anchor topology above (its own origin and
    // insertion are simple fixed skeletal offsets — pubis to xiphoid, see
    // the EST table just below — not something either measured source
    // carries, since neither model includes a trunk), so it is built here,
    // alongside trapezius.
    out.abdominal = {
      name: 'abdominal', region: 'measured-shape-est-anchor', arch: 'strap', primaryJoint: null, touches: ['trunk'],
      // EST: pubic symphysis — below and anterior of the root (which sits
      // at the sacral base, see 10-skeleton.js/20-build.js).
      origin: { frameBone: 'pelvis', refBone: 'pelvis', refIsB: false, localMm: () => [-90, 0, 55] },
      // EST: xiphoid/costal cartilage, well anterior of the vertebral body
      // T8 sits at the back of.
      insertion: { frameBone: 'T8', refBone: 'T8', refIsB: false, localMm: () => [0, 0, 155] },
      aspect: 1.9, tendonFrac: 0.08, wrapOriginMm: 0, wrapInsertionMm: 0, bp3d: null,
    };
    for (const name in UPPER_EST) out[name] = Object.assign({ name, region: 'est-anchor', bp3d: null }, UPPER_EST[name]);

    for (const name of GROUP_NAMES) out[name].bp3d = volumeFor(name);
    TABLE = out;
    return out;
  }

  function upperOnlyTable() {
    const out = {};
    for (const name in UPPER_EST) out[name] = Object.assign({ name, region: 'est-anchor', bp3d: null }, UPPER_EST[name]);
    return out;
  }

  /** all 12 groups if GK.osim/GK.mobl/GK.bp3d/GK.anthro all have a model
   *  loaded; the trapezius-only EST table otherwise — the same graceful
   *  degradation GK.field's own muscleField() uses when GK.muscle itself is
   *  absent. Whichever data file is missing is exactly what blocks the
   *  lower-body/MoBL-anchored groups from appearing; nothing here silently
   *  substitutes an estimate for a group whose real source is not loaded. */
  function availableGroups() {
    const ready = !!(GK.osim && GK.osim.model && GK.mobl && GK.mobl.model && GK.bp3d && GK.bp3d.model && GK.anthro && GK.anthro.model);
    return ready ? groupsTable() : upperOnlyTable();
  }

  // =========================================================================
  //  REST LENGTH (for volume conservation) AND BULGE
  // =========================================================================
  function restRig(rig) { return rig._muscleRestRig || (rig._muscleRestRig = GK.skel.solve(rig.figure, {})); }

  function anchorPair(rig, side, group) {
    const A = anchorWorld(rig, side, group.origin);
    const B = anchorWorld(rig, side, group.insertion);
    return (A && B) ? { A, B } : null;
  }

  /**
   * Volume-conserving radial scale for the CURRENT pose already baked into
   * `rig`, relative to that same figure's rest pose — no joint angle
   * argument needed, and correct for a group that crosses more than one
   * joint (hamstrings, triceps surae), because it reads the actual solved
   * distance rather than modelling one joint in isolation.
   */
  function currentStretch(rig, side, group) {
    const cur = anchorPair(rig, side, group);
    const rest = anchorPair(restRig(rig), side, group);
    if (!cur || !rest) return 1;
    const Lcur = Math.max(1, vlen(vsub(cur.B, cur.A)));
    const Lrest = Math.max(1, vlen(vsub(rest.B, rest.A)));
    return Lcur / Lrest;
  }

  /**
   * bulge(groupName, jointAngleRad, opts): the single-joint preview named in
   * the task — "biceps on elbow flexion, gastrocnemius on plantarflexion,
   * quadriceps on knee extension" — for a group whose primaryJoint is a
   * DIRECT parent/child pair (every group that has one is exactly such a
   * pair). Returns null for a group with no primaryJoint (pectoralis,
   * latissimus, abdominal — genuinely not driven by one joint); use
   * query(rig) at the pose you want instead, which has no such limitation
   * (it is what fieldAt() actually uses, via currentStretch() above).
   */
  function bulge(groupName, jointAngleRad, opts) {
    opts = opts || {};
    const activation = clamp01(opts.activation || 0);
    const groups = availableGroups();
    const g = groups[groupName];
    if (!g) throw new Error('muscle: no group "' + groupName + '"');
    if (!g.primaryJoint) return null;

    const childBase = g.primaryJoint.bone;
    const childSpec = GK.skel.BY_ID[childBase + '.R'];
    const parentBase = childSpec.parent.replace(/\.[LR]$/, '');
    const childFrame = restFrame(childBase + '.R');
    const parentFrame = restFrame(parentBase === 'pelvis' ? 'pelvis' : parentBase + '.R');
    const childRelToParent = [unapply(parentFrame, childFrame[0]), unapply(parentFrame, childFrame[1]), unapply(parentFrame, childFrame[2])];

    const nominal = { bones: {} };
    nominal.bones[childBase + '.R'] = { len: 300 };
    nominal.bones[g.origin.frameBone === 'pelvis' ? 'pelvis' : g.origin.frameBone + '.R'] = { len: 300 };
    const insertionLocal = g.insertion.localMm(nominal, 'R');
    const insertionInParentAtRest = M.mApply(childRelToParent, insertionLocal);

    const originFrame = g.origin.frameBone === 'pelvis' ? M.IDENT() : restFrame(g.origin.frameBone + '.R');
    const originLocal = g.origin.localMm(nominal, 'R');
    const originWorldStyle = M.mApply(originFrame, originLocal);
    const originInParent = g.origin.frameBone === parentBase || g.origin.frameBone === 'pelvis'
      ? (g.origin.frameBone === 'pelvis' ? originWorldStyle : originLocal)
      : unapply(parentFrame, originWorldStyle);

    const rotated = M.mApply(GK.skel.FLEX(jointAngleRad), insertionInParentAtRest);
    const Lrest = vlen(vsub(insertionInParentAtRest, originInParent));
    const Lnow = vlen(vsub(rotated, originInParent));
    const stretch = Lnow / Math.max(1, Lrest);
    const radiusScale = clamp(Math.sqrt(1 / Math.max(0.25, stretch)) * (1 + 0.12 * activation), 0.6, 1.9);
    return { stretch, radiusScale, activation };
  }

  // =========================================================================
  //  STATIONS — the sampled centreline+cross-section a group presents at a
  //  solved pose, for one side. Shared by query() and fieldAt().
  // =========================================================================
  const N_STATIONS = 9;

  function stationsFor(rig, side, group) {
    const originId = boneId(group.origin.frameBone, side), insertId = boneId(group.insertion.frameBone, side);
    if (!rig.bones[originId] || !rig.bones[insertId]) return null;
    const A = anchorWorld(rig, side, group.origin);
    const B = anchorWorld(rig, side, group.insertion);
    if (!A || !B) return null;

    const oAxes = anchorAxes(rig, side, group.origin);
    const iAxes = anchorAxes(rig, side, group.insertion);
    // A width/depth AXIS, not a signed vector: sdSegE reads it only through
    // vdot(...) inside a hypot() (see uu/vv there), so flipping either one's
    // sign changes nothing about the ellipse it describes. Lerping between
    // two independently-built bone frames is not sign-free, though —
    // vlerp(oAxes.width, iAxes.width, t) passes through the zero vector at
    // whatever t the two nearly cancel, and vnorm of a near-zero vector is
    // noise, not a direction. A group whose ends sit on bones far apart in
    // the tree (hamstrings: pelvis -> tibia, crossing both hip and knee)
    // hits this for real, not just in theory — it read as a station's width
    // snapping to an unrelated direction mid-sweep, i.e. a belly flaring out
    // to the side where nothing anchors it. Re-picking iAxes' hemisphere to
    // match oAxes' first removes the crossing without touching either end's
    // own cross-section.
    if (vdot(oAxes.width, iAxes.width) < 0) iAxes.width = vmul(iAxes.width, -1);
    if (vdot(oAxes.depth, iAxes.depth) < 0) iAxes.depth = vmul(iAxes.depth, -1);

    const stretch = currentStretch(rig, side, group);
    // sqrt(1/stretch): shorten -> thicken, lengthen -> thin, conserving
    // area*length to first order — deliberately mild, clamped so a fully
    // locked-out joint does not send a belly to zero or to a spike
    const radiusScale = clamp(Math.sqrt(1 / Math.max(0.2, stretch)), 0.55, 1.85);

    const Lmm = Math.max(20, vlen(vsub(B, A)));

    // AREA = VOLUME / LENGTH — see the file header's VOLUME section. No
    // free scale constant: V is bodyparts3d's own measured (summed) volume,
    // rescaled onto THIS figure by its own length ratio and by an ANSUR
    // girth ratio squared (cross-section grows with the square of a linear
    // build measurement, same as any other area).
    const site = GIRTH_SITE[group.name];
    const girthRef = site ? girthRefEstimate(site.girth, site.seg) : null;
    let meanArea;
    if (group.bp3d && site && girthRef) {
      // Lref is the SKELETAL reference length (REF_SEGMENT_MM), not the
      // bodyparts3d mesh's own bounding-box extent (group.bp3d.lengthRefMm,
      // still carried for the "not wider than the real box" sanity check
      // elsewhere). The two are not the same span: a real rectus femoris'
      // bounding box reaches past the hip, while this file's own
      // quadriceps anchor deliberately starts at the femur (see
      // LOWER_TOPOLOGY's own comment on why) — comparing Lmm (measured on
      // THAT shorter convention) against a bbox built for the longer one
      // silently shrank the whole lower body by roughly the difference,
      // which is exactly what this project's own musclefit run caught. The
      // skeletal reference keeps both sides of the ratio on the same
      // convention: how this file's own OWN anchors span the SAME named
      // bone, on the reference specimen versus on the target figure. It
      // also means Lmm itself cancels out of the area below (V/L undoes
      // the L the volume was just scaled BY) — length is not free to drop
      // from this formula, it is simply not double-counted in it, which is
      // the correct behaviour: AREA should not shrink just because THIS
      // pose's bulge happens to shorten the sweep; that is bulge()'s job
      // (radiusScale, applied after this block), not volume-scaling's.
      const Lref = Math.max(20, SOURCE_REF_LEN_MM[site.seg] || group.bp3d.lengthRefMm);
      const girthTarget = rig.figure.girth[site.girth];
      const volumeMm3 = group.bp3d.volMm3 * (Lmm / Lref) * Math.pow(girthTarget / girthRef, 2);
      meanArea = volumeMm3 / Lmm;
    } else {
      // should not happen once availableGroups() has decided this group is
      // usable at all (see that function) — falls back to something small
      // and visibly wrong rather than NaN/undefined propagating silently
      meanArea = 400;
    }
    const peak = meanArea / Math.max(0.15, profileIntegral(group.arch, group.tendonFrac));

    const stations = [];
    for (let i = 0; i < N_STATIONS; i++) {
      const t = i / (N_STATIONS - 1);
      const shape = archProfile(group.arch, group.tendonFrac, t);
      const area = Math.max(1, peak * shape) * radiusScale * radiusScale;
      let a = Math.sqrt(area * group.aspect / Math.PI);
      let b = Math.sqrt(area / (Math.PI * group.aspect));
      // safety clamp: a belly must not extend past what its own anchors and
      // its own measured volume can justify — caps the semi-axes at a
      // generous multiple of the sweep's own length so a bad ratio anywhere
      // upstream reads as "a bit fat", never as a spike
      const cap = Lmm * 0.9;
      if (a > cap) { const k = cap / a; a *= k; b *= k; }
      if (b > cap) { const k = cap / b; a *= k; b *= k; }

      let C = vlerp(A, B, t);
      const wOrigin = (group.wrapOriginMm || 0) * (1 - sstep(0, 0.35, t));
      const wInsert = (group.wrapInsertionMm || 0) * sstep(0.65, 1, t);
      const wrapOut = Math.max(wOrigin, wInsert) * 0.35; // a fraction of the measured radius — a centreline nudge, not the wrap surface itself
      const depthDir = vnorm(vlerp(oAxes.depth, iAxes.depth, t));
      C = vmad(C, depthDir, wrapOut);

      stations.push({ t, center: C, width: vnorm(vlerp(oAxes.width, iAxes.width, t)), depth: depthDir, a, b, area });
    }
    orthonormalise(stations);
    return { name: group.name, side, arch: group.arch, A, B, stretch, radiusScale, meanArea, peakArea: peak, lengthMm: Lmm, bp3d: group.bp3d, stations };
  }

  // =========================================================================
  //  QUERY — the public introspection API
  // =========================================================================
  function query(rig) {
    const groups = availableGroups();
    const out = { groups: {} };
    for (const name in groups) {
      const g = groups[name];
      const sides = {};
      for (const side of ['L', 'R']) {
        const s = stationsFor(rig, side, g);
        if (!s) continue;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const st of s.stations) {
          for (const sign of [-1, 1]) {
            const p = vadd(vadd(st.center, vmul(st.width, sign * st.a)), vmul(st.depth, sign * st.b));
            x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
            y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
            z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]);
          }
        }
        s.extent = { min: [x0, y0, z0], max: [x1, y1, z1] };
        sides[side] = s;
      }
      out.groups[name] = { region: g.region, arch: g.arch, touches: g.touches, sides };
    }
    return out;
  }

  // =========================================================================
  //  FIELD — what src/50-field.js actually calls:
  //  GK.muscle.fieldAt(rig, P, part, f). `part` is one of that file's own
  //  part names ('trunk', 'head', 'humerus.L', 'forearm.R', 'femur.L',
  //  'tibia.R', 'foot.L', ...); groups are attributed to a part by
  //  `touches` above, using the SAME part names, so a change to
  //  50-field.js's own part list needs a matching edit here — there is no
  //  way to derive one from the other, since "which parts does a belly
  //  geometrically pass near" is a fact about anatomy, not something that
  //  follows from its two endpoint bones alone (hamstrings, for instance,
  //  touches femur without being anchored to it at either end). `f` is
  //  soft-tissue thickness in mm, ADDED to the semi-axes — see the file
  //  header.
  // =========================================================================
  const FASCIA_K = 8; // mm — how readily two groups sharing a part blend into one form; small, so distinct bellies still show a groove

  function fieldAt(rig, P, part, f) {
    f = f || 0;
    let groups;
    try { groups = availableGroups(); } catch (e) { return 1e9; }
    const base = part.replace(/\.[LR]$/, '');
    const side = /\.[LR]$/.test(part) ? part.slice(-1) : null;

    const cache = rig._muscleFieldCache || (rig._muscleFieldCache = {});
    let d = 1e9, any = false;
    for (const name in groups) {
      const g = groups[name];
      if (g.touches.indexOf(base) < 0) continue;
      for (const s of (side ? [side] : ['L', 'R'])) {
        const key = name + '.' + s;
        let st = cache[key];
        if (st === undefined) { st = stationsFor(rig, s, g); cache[key] = st; }
        if (!st) continue;
        any = true;
        for (let i = 0; i < st.stations.length - 1; i++) {
          const s0 = st.stations[i], s1 = st.stations[i + 1];
          const w = vnorm(vadd(s0.width, s1.width));
          const dep = vnorm(vadd(s0.depth, s1.depth));
          const ax = vnorm(vsub(s1.center, s0.center));
          d = smin(d, sdSegE(P, s0.center, s1.center, w, dep, ax, s0.a + f, s0.b + f, s1.a + f, s1.b + f), 3);
        }
      }
    }
    return any ? d : 1e9;
  }

  GK.muscle = {
    query, fieldAt, bulge,
    availableGroups, GROUP_NAMES,
    // exposed for tools/musclefit.js and for debugging, not part of the
    // "clean query" the task asks for
    _internal: {
      restFrame, unapply, mirrorLocal, archProfile, profileIntegral,
      stationsFor, currentStretch, anchorWorld, girthRefEstimate, refSegmentLengths, GIRTH_SITE, BP3D_GROUPS,
    },
  };
})(window.GK = window.GK || {});
