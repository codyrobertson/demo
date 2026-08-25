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
  //    atKey   for offsets that are not constants across figures. A hip is
  //            half a pelvis away from the midline and a wide pelvis puts it
  //            further out, so the offset is resolved per figure and looked
  //            up here rather than written down.
  //    rest    [flex, abd, twist] in radians, baked in before any pose,
  //            relative to the parent. Right for the small stuff: the
  //            thoracic kyphosis and the lumbar lordosis are a couple of
  //            degrees per level and are naturally said that way.
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
  //
  //  Vertebrae are declared individually rather than as one "spine" bone.
  //  A spine posed as a single rotation reads as a broom handle: the whole
  //  point of a back is that flexion is distributed unevenly along it, that
  //  the lumbar spine carries most sagittal range and almost no axial, and
  //  that the thoracic spine is the other way round because the ribs stop it.
  // =========================================================================

  const LUMBAR = 5, THORACIC = 12, CERVICAL = 7;

  function buildTree() {
    const T = [];
    const add = (b) => { T.push(b); return b; };

    add({ id: 'pelvis', parent: '', at: [0, 0, 0], rest: [0, 0, 0], len: 'pelvis', dof: {} });
    // the sacrum runs up from the root to the base of L5, so the lumbar
    // chain simply continues from its distal end like every other chain

    // ---- spine -----------------------------------------------------------
    // Walked distally as a chain, L5 first. The rest curve is the resting
    // sagittal profile: lordosis through the lumbar, kyphosis through the
    // thoracic, a shallow lordosis again through the cervical. Authored per
    // level as a small angle rather than as one bend, so that flattening the
    // lumbar curve — which is most of what "standing up straight" is —
    // remains a thing a pose can ask for.
    let prev = 'pelvis';
    for (let i = 0; i < LUMBAR; i++) {
      const id = 'L' + (LUMBAR - i);                 // L5 .. L1 walking up
      add({
        id, parent: prev,
        rest: [-0.055, 0, 0], len: 'lumbarSeg',
        dof: { flex: 'lumbarFlex', abd: 'lumbarSide', twist: 'lumbarTwist' },
      });
      prev = id;
    }
    for (let i = 0; i < THORACIC; i++) {
      const id = 'T' + (THORACIC - i);               // T12 .. T1
      add({
        id, parent: prev,
        rest: [0.042, 0, 0], len: 'thoracicSeg',
        dof: { flex: 'thoracicFlex', abd: 'thoracicSide', twist: 'thoracicTwist' },
      });
      prev = id;
    }
    const T1 = prev;
    for (let i = 0; i < CERVICAL; i++) {
      const id = 'C' + (CERVICAL - i);               // C7 .. C1
      add({
        id, parent: prev,
        rest: [-0.030, 0, 0], len: 'cervicalSeg',
        // Axial rotation is not spread evenly up the neck: roughly half of
        // it happens at C1-C2 alone, and a neck that rotates uniformly reads
        // as a hose. The weight is applied in distribute(), keyed off this.
        dof: { flex: 'cervicalFlex', abd: 'cervicalSide', twist: 'cervicalTwist' },
      });
      prev = id;
    }
    add({ id: 'skull', parent: prev, rest: [0, 0, 0], len: 'skull', dof: {} });

    // ---- shoulder girdle and arm ----------------------------------------
    // The clavicle leaves the spine at T1, forward and to the side; the
    // scapula rides on the ribcage at its far end; the humerus hangs from
    // the scapula, not from the trunk. Skipping the girdle and hanging an
    // arm off the chest is the single most common way a figure comes out
    // wrong: the shoulder cannot then rise, and a raised arm tears away
    // from the body instead of carrying the shoulder with it.
    add({
      // out along the shoulder, a little up and a little back
      id: 'clavicle', parent: T1, atKey: 'sc', aim: [0.16, 0.97, -0.18],
      len: 'clavicle', side: true, lat: 1,
      dof: { flex: 'clavElev', abd: 'clavProt', twist: null },
    });
    add({
      // the glenoid sits below and behind the acromion, and the blade lies
      // on the ribcage some 35 degrees forward of the coronal plane
      id: 'scapula', parent: 'clavicle', aim: [-0.34, 0.88, -0.33], roll: 0.61,
      len: 'scapula', side: true, lat: 1,
      dof: { flex: 'scapTilt', abd: 'scapRot', twist: 'scapWing' },
    });
    add({
      // straight down, with a few degrees of outward hang
      id: 'humerus', parent: 'scapula', aim: [-0.995, 0.10, 0],
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
      id: 'femur', parent: 'pelvis', atKey: 'hip', aim: [-0.996, -0.090, 0],
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
    const s = b.sign === undefined ? 1 : b.sign;
    return [pick('flex'), pick('abd') * s, pick('twist') * s];
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

      const [af, aa, at2] = anglesFor(fig, pose, b);
      const posed = mMul(TWIST(at2), mMul(ABD(aa), FLEX(af)));

      let frame;
      if (b.aim) {
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
      const len = (fig.len[b.len] === undefined ? 0 : fig.len[b.len]);
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
