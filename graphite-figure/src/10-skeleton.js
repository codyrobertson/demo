/* ============================================================================
   GRAPHITE FIGURE — src/10-skeleton.js
   The bone tree, and the forward solve that turns a pose into world frames.

   FRAME CONVENTION. World is +X superior, +Y to the figure's own left, +Z
   anterior. Every bone carries an orthonormal frame whose **+X runs
   proximal to distal along the bone**, which is the same convention the hand
   project uses for a digit segment — deliberately, because it means the
   forearm's distal frame *is* a wrist mount and a hand can be planted on it
   with no adaptor and no change of basis. The other two axes are whatever
   the chain of rotations has carried them to; nothing here assumes them.

   The three rotations are the hand project's, for the same reason:
     FLEX  carries +X toward +Z   (distal toward anterior)  — sagittal
     ABD   carries +X toward +Y   (distal toward the left)  — coronal
     TWIST carries +Y toward +Z                             — axial

   TOPOLOGY IS HERE, MEASUREMENT IS NOT. This file says which bone hangs off
   which and what can rotate where; it does not say how long anything is.
   Lengths, girths and joint ranges come from src/00-refdata.js, resolved per
   seed by buildFigure(). The two are separated because topology is a fact
   about human beings and measurement is a distribution over them, and mixing
   them is how a generative figure ends up with one body at five scales.
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;
  const { mMul, mOrtho, mApply, vadd, vmad, IDENT } = M;

  /** carries +X toward +Z: sagittal-plane flexion */
  function FLEX(t) { const c = Math.cos(t), s = Math.sin(t); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; }
  /** carries +X toward +Y: coronal-plane abduction */
  function ABD(t) { const c = Math.cos(t), s = Math.sin(t); return [[c, s, 0], [-s, c, 0], [0, 0, 1]]; }
  /** carries +Y toward +Z: axial rotation about the bone's own long axis */
  function TWIST(t) { const c = Math.cos(t), s = Math.sin(t); return [[1, 0, 0], [0, c, s], [0, -s, c]]; }

  // =========================================================================
  //  THE TREE
  //
  //  Each entry is authored once and never varies between figures:
  //    id      unique name; a side-bearing bone is declared once and stamped
  //            out as id.L and id.R by mirror(), so the two sides cannot
  //            drift apart in the source
  //    parent  id of the bone it hangs from ('' for the root)
  //    at      OMITTED for the common case, which is that a bone starts
  //            where its parent ends — that is what a skeleton mostly is.
  //            Given, it is an offset from the parent's ORIGIN in the
  //            parent's own frame, as fractions of stature: a clavicle
  //            leaves the spine sideways and forward and neither of those is
  //            a distance along a vertebra.
  //    aimTo   the strongest form of all: a named world landmark this bone
  //            must END on. Its direction AND its length both fall out of
  //            the measurement, so neither is authored. The clavicle is the
  //            case that forced it — ANSUR measures acromial height and
  //            biacromial breadth, which between them fix exactly where the
  //            acromion is, so guessing a collarbone length and pointing it
  //            in a guessed direction was throwing away two measurements and
  //            landing the shoulder 27mm low and 36mm narrow.
  //    atKey   for offsets that are not constants across figures. A hip is
  //            half a pelvis away from the midline and a wide pelvis puts it
  //            further out, so the offset is resolved per figure and looked
  //            up here rather than written down.
  //    rest    [flex, abd, twist] in radians, baked in before any pose,
  //            relative to the parent. Right for the small stuff, and also
  //            for the standing spinal curve: every vertebra's flex here is
  //            one INCREMENT of it, from a couple of degrees to over ten
  //            depending on the level - see THE STANDING CURVE below.
  //    tilt    spine bones only. The CUMULATIVE world-frame sagittal angle
  //            this bone's own long axis sits at once every `rest` above it
  //            in the chain has been applied - a running sum, not another
  //            authored number; see THE STANDING CURVE. 20-build.js reads
  //            it to know how much a tilted vertebra's length has to be let
  //            out so its VERTICAL rise still matches the measured seg.
  //    aim     the alternative, and the right one for anything that starts a
  //            limb. A world direction the bone points in at rest, plus a
  //            roll about it. Euler angles on top of an accumulated frame
  //            cannot express "at rest this hangs straight down": the answer
  //            depends on every rotation above it, so a scapula tilted into
  //            its own plane — which is real, the scapula sits about 35
  //            degrees forward of the coronal plane — swings the whole arm
  //            backwards with it. Measured first pass: the wrist came out
  //            224mm behind the hip. Said as an aim, the arm hangs down
  //            whatever the girdle above it is doing.
  //    len     key into the resolved length table
  //    dof     which axes the joint actually has. A joint with no entry for
  //            an axis cannot rotate about it at all — an interphalangeal
  //            joint is a hinge and saying so here is what stops a solver
  //            quietly bending it sideways to reach something.
  //    lat     +1 if the bone's own +Y should be flipped on the right side.
  //    flip    per-axis sign, applied to the POSE value only. An aim bone's
  //            local +Y falls wherever the aim direction puts it, and for a
  //            limb aimed downward that is world-right on BOTH sides — so
  //            positive abduction would carry the limb across the midline,
  //            i.e. adduct it. Rather than leave callers to remember which
  //            limbs are inverted, each says so here and "abduct" means away
  //            from the midline everywhere. Caught by the span check: a
  //            T-pose built with positive abduction folded the arms inward
  //            and reported a 948mm span error.
  //
  //  Vertebrae are declared individually rather than as one "spine" bone.
  //  A spine posed as a single rotation reads as a broom handle: the whole
  //  point of a back is that flexion is distributed unevenly along it, that
  //  the lumbar spine carries most sagittal range and almost no axial, and
  //  that the thoracic spine is the other way round because the ribs stop it.
  // =========================================================================

  const LUMBAR = 5, THORACIC = 12, CERVICAL = 7;

  // =========================================================================
  //  THE STANDING CURVE
  //
  //  First pass had every rest angle below at 0. Correct segment lengths,
  //  correct stature, and the side view was a plank: a standing spine's
  //  S-curve is not a fact about segment LENGTH — 00-anthro.js's measured
  //  heights already have it baked in, since they were taken standing — it
  //  is a fact about which way each vertebra LEANS. So the lengths stay
  //  exactly what the survey measured, untouched, and the curve goes
  //  entirely into the flex component of `rest`, per vertebra.
  //
  //  Tilting a bone eats into its own vertical reach (rise = len*cos(tilt)),
  //  and left uncompensated that quietly shortened the figure by however
  //  much curve got added — tens of millimetres at these angles, not the
  //  sub-mm rounding error the previous, much smaller angles cost. 20-build
  //  .js's spineLen() is the fix: it lets each vertebra's length back out to
  //  seg/cos(tilt), so the MEASURED vertical rise is preserved exactly and
  //  the anterior offset falls out of the tilt for free. It needs `tilt` —
  //  the cumulative, world-frame sagittal angle this vertebra's own long
  //  axis makes with vertical — which is why every bone below carries one.
  //  It is a plain running sum and nothing fancier, because every rotation
  //  in this whole chain is flex-only (abd=twist=0): solve() never rotates
  //  any of it off world Y, so composing rest angles down a chain of
  //  pure-Y rotations just adds them. `rest`'s own flex value at a level is
  //  the INCREMENT; `tilt` is the running total after it.
  //
  //  MAGNITUDES. First pass set the sign by which region is "lordotic" and
  //  which is "kyphotic" and got it backward: same-signed, monotonic
  //  increments the whole way through a region, so each region's tilt just
  //  keeps compounding the last one's instead of undoing it, and the chain
  //  never turns back toward vertical until 60 degrees of forward lean had
  //  piled up at L1 alone — a figure bowing from the waist, not standing.
  //  Sign is a CURVATURE, not a direction of lean: what makes a lordosis a
  //  lordosis is that the chain leans anterior (+, toward +Z) approaching
  //  the region and has swung back PAST vertical to posterior (-) by its
  //  far end, or the reverse for a kyphosis — the region's OWN increments
  //  run the opposite way from the lean they start at, which is what turns
  //  the lean back rather than extending it. So pelvic tilt hands the chain
  //  a positive (anterior) starting lean, lumbar's own increments run
  //  NEGATIVE to spend it (and overshoot past vertical — that overshoot IS
  //  the lumbar hollow), thoracic's run POSITIVE to spend THAT and round
  //  the upper back the other way, cervical's run NEGATIVE again to bring
  //  the head back forward over it. Population means from the spine
  //  literature for the size of each swing, degrees:
  //    pelvic tilt        ~10-15, mean ~13-15 in asymptomatic adults on
  //                        pooled radiographic series — but that clinical PT
  //                        is the rotation of the pelvis about the HIP AXIS;
  //                        what this one zero-length bone actually needs to
  //                        supply is the SACRAL BASE's own orientation, the
  //                        surface L5 sits on and swings up from, which is
  //                        the separate, larger sacral-slope figure (~35-40,
  //                        pooled radiographic mean ~37-38) — real spines get
  //                        both angles from a separate sacrum and pelvis; one
  //                        zero-length bone here has to stand in for both, so
  //                        it is set nearer the sacral-slope end (25-30
  //                        rather than 10-15). Tried at the cited PT figure
  //                        first: with L5-S1 and L4-L5 alone spending 20+
  //                        degrees of the lumbar total each (see
  //                        LUMBAR_SHARE below), 12-15 degrees of starting
  //                        lean is gone within L5 alone, the chain is already
  //                        past vertical and falling before the lordosis
  //                        gets to do any work, and the render was a
  //                        continuous backward lean with no hollow in it at
  //                        all — corrected by giving it more to spend. 28,
  //                        EST, chosen by sweeping this against the lumbar
  //                        and thoracic numbers below for a visible lumbar
  //                        hollow without pushing either of THEM outside
  //                        their own cited ranges.
  //    lumbar lordosis    ~40-60, L1-S1. Reported means vary a lot by method
  //                        and which levels are counted — one Cobb L1-S1
  //                        series ~52, a stricter LLA method on a different
  //                        cohort ~33±12. 48 taken, toward the low side of
  //                        the wide range this file was given.
  //    thoracic kyphosis  ~30-45, T1-T12; ~44 mean in one 80-subject
  //                        asymptomatic series. 40 taken, near that but
  //                        nudged down slightly by the same sweep — the
  //                        upper end of the range overshot T1 past vertical
  //                        and into a forward lean by the time it reached
  //                        the shoulders.
  //    cervical lordosis  ~20-40. EST, and honestly higher than the C2-C7
  //                        Cobb literature specifically usually reports
  //                        (commonly ~10-18 by that one method) — taken
  //                        near the top of the wider range this file was
  //                        given, partly because this is the term that has
  //                        to close the loop: with the figures above, T1
  //                        sits a few degrees short of vertical, and the
  //                        cervical curve is what carries the head the rest
  //                        of the way back over the trunk — which is also
  //                        just true of a real neck, forward-head posture
  //                        and all. 26 taken; the skull's own aimTo (below)
  //                        absorbs whatever this doesn't close exactly.
  //  DISTRIBUTION within a region (xSHARE below — fraction of the regional
  //  total each level carries, same bottom-to-top order the loops below
  //  walk in, each array summing to 1). LUMBAR_SHARE's first two entries are
  //  a measured segmental breakdown: a CT study found L5-S1 42.7% and L4-L5
  //  25.2% of total lumbar lordosis — the bottom two levels alone are two
  //  thirds of the curve. Its other three levels are this file's own
  //  tapered EST, there being no source read yet that splits the top three.
  //  THORACIC_SHARE is left uniform for the opposite reason: no source read
  //  yet argues for any particular taper, so it does not invent one.
  //  CERVICAL_SHARE is a mild EST taper, heavier low, on the general pattern
  //  the lumbar data shows rather than on a neck-specific source.
  // =========================================================================
  const PELVIC_TILT = 28 * M.DEG;
  const LUMBAR_LORDOSIS = -48 * M.DEG;                              // spends the pelvic lean, and overshoots it
  const THORACIC_KYPHOSIS = 40 * M.DEG;                             // spends the overshoot, the other way
  const CERVICAL_LORDOSIS = -26 * M.DEG;                            // and spends THAT, back the first way again
  const LUMBAR_SHARE = [0.427, 0.252, 0.130, 0.100, 0.091];         // L5 .. L1, measured low two + EST taper
  const THORACIC_SHARE = new Array(THORACIC).fill(1 / THORACIC);    // T12 .. T1, EST uniform
  const CERVICAL_SHARE = [0.22, 0.19, 0.16, 0.14, 0.12, 0.10, 0.07]; // C7 .. C1, EST taper

  function buildTree() {
    const T = [];
    const add = (b) => { T.push(b); return b; };

    // pelvis's OWN rest stays [0,0,0] — PELVIC_TILT is folded into L5 below
    // instead, and only there. Tried on the pelvis bone itself first, which
    // reads naturally ("the sacral base's own orientation") since there is
    // no separate sacrum bone here — but the pelvis is also where the femur
    // hangs from (`atKey: 'hip'`, further down), and that offset is applied
    // in the PARENT's frame same as any other, so a tilted pelvis silently
    // dragged the hip joint centre round with it: legs unrotated (aim bones
    // read world direction, not the parent frame) but ANCHORED somewhere
    // else, and the sole came off the floor by two to three centimetres,
    // not the sub-2mm the vertex/span checks tolerate. Real pelvic tilt
    // rotates the pelvis approximately about the hip axis for exactly this
    // reason — the legs do not care what the low back is doing — so this
    // keeps the pelvis bone itself neutral and gives the tilt to the one
    // chain that should actually feel it.
    let cum = 0;
    add({ id: 'pelvis', parent: '', at: [0, 0, 0], rest: [0, 0, 0], tilt: cum, len: 'pelvis', dof: {} });
    // the sacrum runs up from the root to the base of L5, so the lumbar
    // chain simply continues from its distal end like every other chain

    // ---- spine -----------------------------------------------------------
    // Walked distally as a chain, L5 first. `dof`/weights() below (posed
    // range, and how unevenly it is shared out) are untouched by this pass —
    // lumbar still carries most sagittal pose range and almost no axial,
    // thoracic the other way round, exactly as before. What changed is only
    // the REST each level sits at before any pose is applied; see THE
    // STANDING CURVE above for where `d` and `tilt` below come from. L5
    // alone also carries PELVIC_TILT, folded in rather than given to the
    // pelvis bone — see the comment above.
    let prev = 'pelvis';
    for (let i = 0; i < LUMBAR; i++) {
      const id = 'L' + (LUMBAR - i);                 // L5 .. L1 walking up
      const d = (i === 0 ? PELVIC_TILT : 0) + LUMBAR_LORDOSIS * LUMBAR_SHARE[i];
      cum += d;
      add({
        id, parent: prev,
        rest: [d, 0, 0], tilt: cum, len: id,
        dof: { flex: 'lumbarFlex', abd: 'lumbarSide', twist: 'lumbarTwist' },
      });
      prev = id;
    }
    for (let i = 0; i < THORACIC; i++) {
      const id = 'T' + (THORACIC - i);               // T12 .. T1
      const d = THORACIC_KYPHOSIS * THORACIC_SHARE[i];
      cum += d;
      add({
        id, parent: prev,
        rest: [d, 0, 0], tilt: cum, len: id,
        dof: { flex: 'thoracicFlex', abd: 'thoracicSide', twist: 'thoracicTwist' },
      });
      prev = id;
    }
    const T1 = prev;
    for (let i = 0; i < CERVICAL; i++) {
      const id = 'C' + (CERVICAL - i);               // C7 .. C1
      const d = CERVICAL_LORDOSIS * CERVICAL_SHARE[i];
      cum += d;
      add({
        id, parent: prev,
        rest: [d, 0, 0], tilt: cum, len: id,
        // Axial rotation is not spread evenly up the neck: roughly half of
        // it happens at C1-C2 alone, and a neck that rotates uniformly reads
        // as a hose. The weight is applied in distribute(), keyed off this.
        dof: { flex: 'cervicalFlex', abd: 'cervicalSide', twist: 'cervicalTwist' },
      });
      prev = id;
    }
    add({ id: 'skull', parent: prev, aimTo: 'vertex', len: 'skull', dof: {} });

    // ---- shoulder girdle and arm ----------------------------------------
    // The clavicle leaves the spine at T1, forward and to the side; the
    // scapula rides on the ribcage at its far end; the humerus hangs from
    // the scapula, not from the trunk. Skipping the girdle and hanging an
    // arm off the chest is the single most common way a figure comes out
    // wrong: the shoulder cannot then rise, and a raised arm tears away
    // from the body instead of carrying the shoulder with it.
    add({
      // out along the shoulder, a little up and a little back
      id: 'clavicle', parent: T1, atKey: 'sc', aimTo: 'acromion',
      len: 'clavicle', side: true, lat: 1,
      dof: { flex: 'clavElev', abd: 'clavProt', twist: null },
    });
    add({
      // the glenoid sits below and behind the acromion, and the blade lies
      // on the ribcage some 35 degrees forward of the coronal plane
      id: 'scapula', parent: 'clavicle', aimTo: 'gh', roll: 0.61,
      len: 'scapula', side: true, lat: 1,
      dof: { flex: 'scapTilt', abd: 'scapRot', twist: 'scapWing' },
    });
    add({
      // straight down, with a few degrees of outward hang
      id: 'humerus', parent: 'scapula', aim: [-0.995, 0.10, 0], flip: { abd: -1 },
      len: 'humerus', side: true, lat: 1,
      dof: { flex: 'ghFlex', abd: 'ghAbd', twist: 'ghRot' },
    });
    add({
      // the carrying angle: the forearm does not continue the humerus, it
      // leaves it a few degrees laterally, and a figure without it reads as
      // a doll
      id: 'forearm', parent: 'humerus', rest: [0, 0.14, 0],
      len: 'forearm', side: true, lat: 1,
      dof: { flex: 'elbow', abd: null, twist: 'pronation' },
    });

    // ---- pelvis to foot --------------------------------------------------
    add({
      // femora run medially from the hips to the knees; the angle is larger
      // the wider the pelvis, which is why it is resolved per figure rather
      // than fixed here
      // down and medially: the femora converge on the knees, by more the
      // wider the pelvis, which is why the aim is nudged per figure below
      id: 'femur', parent: 'pelvis', atKey: 'hip', aim: [-0.996, -0.090, 0], flip: { abd: -1 },
      len: 'femur', side: true, lat: 1,
      dof: { flex: 'hipFlex', abd: 'hipAbd', twist: 'hipRot' },
    });
    add({
      // The shank does NOT get an aim, it gets a correction: an aim is a
      // world direction and a shank must follow the thigh when the hip
      // flexes. So it inherits the femur's frame and takes out the femur's
      // medial convergence, which is what leaves the knees closer together
      // than the hips and the ankles closer still — the thigh angles in, the
      // shank runs down.
      id: 'tibia', parent: 'femur', rest: [0, -0.090, 0],
      len: 'tibia', side: true, lat: 1,
      // A knee is a hinge with one qualification: through the last twenty
      // degrees of extension the tibia rotates externally as it locks. It is
      // a real rotation and it is what stops a straightened leg reading as a
      // pipe, so it is a driven axis rather than a free one.
      dof: { flex: 'knee', abd: null, twist: 'screwHome' },
    });
    add({
      // the foot leaves the ankle forwards, not downwards: a quarter turn
      // carrying the tibia's distal axis onto the local anterior one
      id: 'foot', parent: 'tibia', rest: [Math.PI / 2, 0, 0],
      len: 'foot', side: true, lat: 1,
      dof: { flex: 'ankle', abd: 'subtalar', twist: null },
    });

    return T;
  }

  /** stamp every side:true bone out as .L and .R, so the two sides share one source */
  function mirror(tree) {
    const out = [];
    for (const b of tree) {
      if (!b.side) { out.push(b); continue; }
      for (const s of ['L', 'R']) {
        const c = Object.assign({}, b);
        c.id = b.id + '.' + s;
        c.parent = tree.some(x => x.id === b.parent && x.side) ? b.parent + '.' + s : b.parent;
        c.sign = s === 'L' ? 1 : -1;
        out.push(c);
      }
    }
    return out;
  }

  const TREE = mirror(buildTree());
  const BY_ID = {};
  for (const b of TREE) BY_ID[b.id] = b;

  // =========================================================================
  //  SOLVE
  // =========================================================================

  /**
   * Angles for one bone, in radians. `pose.joints[id]` addresses a single
   * bone directly and always wins; otherwise the value comes from the
   * group the bone belongs to, divided across the levels of that group by
   * weight. Both exist because the two things a caller wants are "bend the
   * back" and "bend T7 specifically", and a rig that offers only the first
   * cannot be posed and one that offers only the second cannot be used.
   */
  function anglesFor(fig, pose, b) {
    const direct = (pose.joints && pose.joints[b.id]) || null;
    const g = fig.groups[b.id] || {};
    const pick = (axis) => {
      if (direct && direct[axis] !== undefined) return direct[axis];
      const key = b.dof[axis];
      if (!key) return 0;
      const share = g[axis] === undefined ? 1 : g[axis];
      const v = groupValue(pose, key);
      return v * share;
    };
    // the side-bearing axes reverse on the right, so one pose value means
    // the same thing anatomically on both sides — "abduct" is away from the
    // midline, not "toward +Y"
    // ANATOMICAL convention, deliberately: positive abduction is away from
    // the midline, positive rotation is external, on both sides. The side
    // sign and the per-bone axis flip are NOT applied here — they are
    // geometry, and they are applied when the frame is built. Applying them
    // first puts the angle in a different convention from the limit table
    // that is about to clamp it, and the clamp then reads an abduction as an
    // adduction: a T-pose came out with one arm horizontal and the other
    // hanging at 30 degrees, because the left arm's -90 hit the -30 degree
    // adduction stop while the right arm's +90 sailed through.
    return [pick('flex'), pick('abd'), pick('twist')];
  }

  /** a pose value by dotted key, e.g. 'lumbarFlex' or 'ghFlex' resolved per side later */
  function groupValue(pose, key) {
    const v = pose[key];
    return v === undefined ? 0 : v;
  }

  /**
   * Walk the tree once, parents before children, composing frames. Returns a
   * flat map of solved bones carrying, for each: the world origin A, the
   * world distal end B, the orthonormal frame, and the length.
   */
  function solve(fig, pose) {
    const rig = { figure: fig, pose, bones: {}, order: [] };
    const root = pose.root || {};
    const rootRot = mMul(TWIST(root.twist || 0), mMul(ABD(root.abd || 0), FLEX(root.flex || 0)));

    // PASS ONE: what every bone was ASKED for. Separate from the walk because
    // the joint limits are coupled sideways across the tree — a femur's
    // flexion range depends on how far the knee below it is bent, and the
    // walk reaches the femur first. Resolving every request up front means
    // the clamp sees the whole pose at once instead of the part of it that
    // happens to have been solved already.
    const raw = {};
    for (const b of TREE) raw[b.id] = anglesFor(fig, pose, b);
    const lim = GK.limits ? GK.limits.clampAll(fig, raw) : { angles: raw, clipped: [] };
    rig.angles = lim.angles;
    // What a pose asked for and could not have. Recorded rather than
    // swallowed: a clamp that leaves no trace makes an unreachable pose look
    // like a reached one, and the figure quietly stops matching the request.
    rig.clipped = lim.clipped;

    // PASS TWO: the walk itself, on angles that are now known to be legal.
    for (const b of TREE) {
      const p = b.parent ? rig.bones[b.parent] : null;
      if (b.parent && !p) throw new Error('bone ' + b.id + ' solved before its parent ' + b.parent);

      const pFrame = p ? p.frame : mOrtho(rootRot);
      const s = b.sign === undefined ? 1 : b.sign;

      // Where this bone starts. Most bones start where their parent ended,
      // which is what a skeleton mostly is; the exceptions are offsets from
      // the parent's origin, either authored as fractions of stature or, for
      // the ones that scale with build rather than with height, resolved per
      // figure and looked up.
      let A;
      if (b.atKey) {
        const o = fig.at[b.atKey];
        A = vadd(p ? p.A : (root.pos || [0, 0, 0]), mApply(pFrame, [o[0], o[1] * s, o[2]]));
      } else if (b.at) {
        const o = [b.at[0] * fig.stature, b.at[1] * fig.stature * s, b.at[2] * fig.stature];
        A = vadd(p ? p.A : (root.pos || [0, 0, 0]), mApply(pFrame, o));
      } else {
        A = p ? p.B.slice() : (root.pos || [0, 0, 0]).slice();
      }

      // anatomical angles in, geometry out: the side sign and the bone's own
      // axis flip are applied here, after the clamp has done its work in the
      // convention the measured ranges are written in
      const fl = b.flip || {};
      const [af0, aa0, at0] = rig.angles[b.id];
      const af = af0 * (fl.flex || 1);
      const aa = aa0 * s * (fl.abd || 1);
      const at2 = at0 * s * (fl.twist || 1);
      const posed = mMul(TWIST(at2), mMul(ABD(aa), FLEX(af)));

      let frame, lenOverride = null;
      if (b.aimTo) {
        // point at a measured landmark and stop there
        const t = fig.aimTargets[b.aimTo];
        const target = [t[0] - fig.rootHeight, t[1] * s, t[2]];
        const v = M.vsub(target, A);
        lenOverride = M.vlen(v);
        const want = M.vnorm(v);
        const ref = Math.abs(want[2]) > 0.94 ? [1, 0, 0] : [0, 0, 1];
        const zc = M.vnorm(M.vsub(ref, M.vmul(want, M.vdot(want, ref))));
        const base = mOrtho([want, M.vcross(zc, want), zc]);
        frame = mOrtho(mMul(base, mMul(TWIST(b.roll ? b.roll * s : 0), posed)));
      } else if (b.aim) {
        // An aim is a world direction, so it is resolved against the world
        // and then handed the pose in its own local terms. +Z is kept as
        // close to anterior as the aim allows, which is what makes flexion
        // mean "forward" on every limb without a per-limb sign table.
        const want = M.vnorm([b.aim[0], b.aim[1] * s, b.aim[2]]);
        const ref = Math.abs(want[2]) > 0.94 ? [1, 0, 0] : [0, 0, 1];
        const zc = M.vnorm(M.vsub(ref, M.vmul(want, M.vdot(want, ref))));
        const yc = M.vcross(zc, want);
        const base = mOrtho([want, yc, zc]);
        frame = mOrtho(mMul(base, mMul(TWIST(b.roll ? b.roll * s : 0), posed)));
      } else {
        const [rf, ra, rt] = b.rest;
        const rest = mMul(TWIST(rt * s), mMul(ABD(ra * s), FLEX(rf)));
        frame = mOrtho(mMul(pFrame, mMul(rest, posed)));
      }
      const len = lenOverride !== null ? lenOverride
        : (fig.len[b.len] === undefined ? 0 : fig.len[b.len]);
      const B = vmad(A, frame[0], len);

      rig.bones[b.id] = { id: b.id, spec: b, A, B, frame, len, sign: s };
      rig.order.push(b.id);
    }
    return rig;
  }

  /**
   * Where a hand goes, in exactly the shape solve(A, pose, mount) in the hand
   * project wants: the wrist position and the frame whose +X is distal. The
   * forearm's distal end and its own frame already are that, which is the
   * whole reason both projects put +X along the bone.
   */
  function wristMount(rig, side) {
    const f = rig.bones['forearm.' + side];
    if (!f) return null;
    return { origin: f.B.slice(), frame: f.frame, sign: f.sign };
  }

  GK.skel = {
    FLEX, ABD, TWIST,
    TREE, BY_ID, LUMBAR, THORACIC, CERVICAL,
    solve, wristMount, anglesFor,
  };
})(window.GK = window.GK || {});
