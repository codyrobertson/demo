/* ============================================================================
   GRAPHITE FIGURE — src/50-field.js
   The body as four nested layers, and the skin as an isosurface over them.

   WHAT THIS REPLACES, AND WHY. The first surface here lofted a superelliptical
   section along each bone and called the result a body. It is worth being
   precise about why that failed, because it failed in the way every
   procedural figure fails: it was the skeleton inflated. A tube around a
   femur is a tube. It has no idea that a vastus lateralis sits on its lateral
   side and not its medial one, that the tissue over a tibial crest is two
   millimetres thick and over a calf is forty, or that a shoulder is wide
   because a deltoid wraps a joint rather than because a bone is fat there.

       SKELETON  ->  MUSCLE / TENDON  ->  FASCIA + FAT  ->  SKIN

   Each contributes to one scalar field, and the skin is where that field
   crosses a threshold. So a muscle bulging pushes the skin out because it
   pushes the FIELD out; fat is its own regional term rather than a fudge on a
   radius; and fascia is the smoothness of the union rather than a filter
   applied afterwards.

   THE TORSO IS NOT A SPINE. The version before this one had the whole trunk
   root-finding outward from the vertebral rod, which is 28mm of bone with a
   fat offset on it — so the chest, the belly and the hips were one smooth
   taper and the figure came out a chess piece. A thorax is not a thick
   vertebra. It is a ribcage, and a ribcage is a measured object: ANSUR gives
   chest breadth, chest depth and chest circumference, waist breadth, waist
   depth and waist circumference, hip breadth, buttock depth and buttock
   circumference. Those are three real cross-sections, at three real heights,
   and they are what the trunk is built from here. The vertebral column is
   still in the field — it is what the ribcage hangs on, and it is why the
   spine sits at the BACK of the torso rather than down its middle, which is
   the single change that stops a trunk reading as a barrel.

   PARTS DO NOT SHARE A FIELD. Every part root-finds through the union of the
   things that belong to IT, not through everything in the body. The version
   before this one unioned all bones for every part, so a ray leaving the left
   femur medially found the right femur and the two thighs fused into a
   trouser leg. Real thighs touch and are still two thighs; what separates
   them in a drawing is not a gap, it is that each has its own silhouette. So
   the field is scoped per part, the parts are allowed to overlap in space,
   and the depth field sorts out which of them the viewer can see.

   THE RINGS SURVIVE. The drawing pipeline wants rings of surface samples — it
   traces the border of what a part covers, which is the one silhouette
   construction that does not fall apart when a limb points at the eye. So the
   field is not marched as a mesh. Each ring is found by root-finding outward
   from an axis: for a given station along a part and a given angle around it,
   walk out until the field crosses the threshold. That keeps the whole
   traced-silhouette and depth-field pipeline exactly as it is, and makes the
   surface an isosurface rather than a loft.

   WHY THE SKIN MUST NOT TRACE THE MUSCLES. A skin laid directly on the muscle
   field draws an anatomy chart, not a person: every intermuscular groove
   shows, at full depth, everywhere. Real skin sits over epimysium, deep
   fascia and subcutaneous tissue, which bridge the small gaps and suppress
   most of the grooves while leaving the few that genuinely show. That is the
   smooth-union radius below, and it is why the union is smooth rather than a
   max().
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;
  const { lerp, clamp, clamp01, vadd, vsub, vmad, vdot, vlen, vmul, vnorm } = M;

  // =========================================================================
  //  PRIMITIVES
  // =========================================================================

  /**
   * Smooth minimum, the polynomial form. This is the fascia: two bellies a
   * few millimetres apart merge into one surface with a shallow valley
   * between them rather than a crevasse, and the width of the blend is how
   * much soft tissue lies over them. A hard min() draws the anatomy chart.
   */
  function smin(a, b, k) {
    if (k <= 0) return Math.min(a, b);
    const h = clamp01(0.5 + 0.5 * (b - a) / k);
    return lerp(b, a, h) - k * h * (1 - h);
  }

  /** signed distance to a capsule: the primitive every bone is made of */
  function sdCapsule(P, A, B, ra, rb) {
    const ab = vsub(B, A), ap = vsub(P, A);
    const t = clamp01(vdot(ap, ab) / Math.max(1e-9, vdot(ab, ab)));
    const c = vmad(A, ab, t);
    return vlen(vsub(P, c)) - lerp(ra, rb, t);
  }

  /**
   * A capsule whose cross-section is a SUPERELLIPSE with independent
   * semi-axes at each end. This is the primitive every soft volume is made
   * of, and all three of those properties earn their place: a ribcage is
   * wider than it is deep, it is a different size at T3 than at T8, and it
   * is boxier than an ellipse — which is not a stylistic claim but a
   * measured one, since an ellipse through ANSUR's chest breadth and depth
   * comes out well short of ANSUR's chest circumference.
   *
   * The return is scaled by the smaller semi-axis so it carries roughly
   * millimetre units. It is not a true distance — no closed form for this
   * shape is — but the root-finder only needs the sign and smin() only needs
   * the scale to be sane near the surface, and both of those it has.
   */
  function sdSegSE(P, A, B, fr, a0, b0, a1, b1, n, cap) {
    const ab = vsub(B, A), ap = vsub(P, A);
    const t = clamp01(vdot(ap, ab) / Math.max(1e-9, vdot(ab, ab)));
    const c = vmad(A, ab, t);
    const d = vsub(P, c);
    const ay = lerp(a0, a1, t), az = lerp(b0, b1, t);
    // The axial term is not optional, and leaving it out is not a small
    // error: with only the two transverse axes measured, a "capsule" is an
    // infinite elliptical CYLINDER. The thoracic segments then ran the full
    // height of the figure, and the neck came out 897mm around against a
    // measured 312 — the ribcage was still there, at chest width, at C4.
    const aw = cap === undefined ? Math.min(ay, az) : cap;
    return seDist(Math.abs(vdot(d, fr[1])) / ay, Math.abs(vdot(d, fr[2])) / az,
      Math.abs(vdot(d, fr[0])) / aw, ay, az, aw, n);
  }

  /**
   * Distance to a superquadric with three independent semi-axes, from the
   * three already-normalised coordinates. One place, because the segment and
   * the blob differ only in where their axial coordinate comes from.
   */
  function seDist(u, v, w, ay, az, aw, n) {
    const e = n === 2 ? Math.hypot(u, v)
      : Math.pow(Math.pow(u, n) + Math.pow(v, n), 1 / n);
    const q = Math.hypot(e, w);
    if (q < 1e-6) return -Math.min(ay, az, aw);
    const ge = gradSE(u, v, e, ay, az, n) * (e / q);
    return (q - 1) / Math.hypot(ge, w / (q * aw));
  }

  /* WHY THE GRADIENT. An implicit surface scaled anisotropically does not
     return a distance: divide y by a wide semi-axis and z by a narrow one and
     the same numeric value means different millimetres in the two directions.
     Left uncorrected, a 43mm layer of fat over a pelvis 349mm wide and 218mm
     deep came out 70mm thick at the flanks and 43mm at the belly, and the
     hips finished 29% over their measured circumference — a modelling error
     that looks exactly like a tuning problem and is not one.

     For an implicit F, the distance to F = 0 is F / |grad F| to first order,
     and that is exact enough here because the root-finder only ever evaluates
     near the surface. This is |grad| for the superellipse. */
  function gradSE(u, v, e, ay, az, n) {
    if (e < 1e-6) return 1 / Math.min(ay, az);
    if (n === 2) return Math.hypot(u / ay, v / az) / e;
    const k = Math.pow(e, 1 - n);
    return k * Math.hypot(Math.pow(u, n - 1) / ay, Math.pow(v, n - 1) / az);
  }

  /**
   * A superellipsoid: a superelliptical cross-section that also closes off
   * along its own axis. The head is the one part of a body that is a closed
   * blob rather than a length of something, so it is the one part that wants
   * this rather than a capsule.
   */
  function sdBlobSE(P, C, fr, ax, ay, az, n) {
    const d = vsub(P, C);
    return seDist(Math.abs(vdot(d, fr[1])) / ay, Math.abs(vdot(d, fr[2])) / az,
      Math.abs(vdot(d, fr[0])) / ax, ay, az, ax, n);
  }

  // =========================================================================
  //  THE SKELETON
  // =========================================================================

  // EST throughout: ANSUR measures no bone breadths this project can use, and
  // Rajagopal carries inertias rather than shaft radii. These are the radius
  // of the bone plus its immediate periosteal tissue, as a fraction of the
  // bone's own length — which at least scales with the figure.
  const BONE_R = {
    clavicle: 0.09, scapula: 0.30,
    humerus: 0.085, forearm: 0.075,
    femur: 0.075, tibia: 0.070,
  };
  // Bones whose form is carried by a measured volume instead. Left in the
  // skeleton for the pose to hang on, kept out of the field so a capsule
  // does not sit inside a head and push it into a sphere.
  const SHAPED = { skull: 1, foot: 1, pelvis: 1 };

  function boneRadius(fig, id) {
    const base = id.replace(/\.[LR]$/, '');
    if (/^[LTC]\d+$/.test(base)) return fig.stature * 0.017;   // a vertebral body
    const k = BONE_R[base];
    if (k === undefined) return fig.stature * 0.008;
    return Math.max(4, (fig.len[base] || fig.stature * 0.05) * k);
  }

  /**
   * Bone. Tight, and deliberately so: these are the places the skin is close
   * to the skeleton, and they are what stop a figure reading as upholstered.
   * A clavicle, an olecranon, a tibial crest, a malleolus and an ASIS all
   * show through on a living body at any body fat, and they show because the
   * tissue over them is a couple of millimetres, not because they are bigger.
   */
  function boneField(rig, P, keep, f) {
    f = f || 0;
    let d = 1e9;
    for (const id of rig.order) {
      const b = rig.bones[id];
      if (!b.len) continue;
      if (SHAPED[id.replace(/\.[LR]$/, '')]) continue;
      if (keep && !keep(id)) continue;
      const r = boneRadius(rig.figure, id);
      // a capsule IS a true distance field, so here the thickness could
      // equally be subtracted; it is added for the same reason everywhere
      d = Math.min(d, sdCapsule(P, b.A, b.B, r + f, r * 0.92 + f));
    }
    return d;
  }

  // =========================================================================
  //  THE MEASURED VOLUMES
  //  A torso is not a spine, a head is not a capsule and a foot is not a
  //  cone. These are the parts of a body whose form ANSUR measured directly,
  //  built at their measured sizes and placed on the solved skeleton so they
  //  follow it when it moves.
  // =========================================================================

  /* HOW BIG IS THE CORE. Every circumference ANSUR took was taken over the
     skin, so it is skeleton plus muscle plus fat plus skin. These fractions
     are how much of that envelope is the structure UNDER the muscle — the
     ribcage inside the chest, the viscera inside the waist, the bony pelvis
     inside the buttock. They are EST and they are the honest place for the
     estimate to sit, because the rest of the envelope is then made of layers
     that have their own reasons: muscle from a musculoskeletal model, and a
     fat term solved against the measured circumference itself.

     While the muscle layer is absent the fat term absorbs what the muscles
     would have been, and comes out far too large. fitFat() reports that
     rather than hiding it. */
  const CORE = {
    thorax: 0.80,   // pectorals, lats, scapulae and skin are the other fifth
    abdomen: 0.86,  // the abdominal wall
    pelvis: 0.72,   // glutes, and they are the largest muscle in the body
    neck: 0.72,     // sternocleidomastoid and the upper trapezius
    head: 0.94,     // scalp, and it is thin
    foot: 0.90,
  };

  // Shape of the ribcage along its own length, as a fraction of the measured
  // chest breadth and depth. EST — ANSUR measured the chest at one height, so
  // the size is measured and the taper away from it is not.
  const THORAX_W = {
    1: [0.46, 0.52], 2: [0.60, 0.64], 3: [0.72, 0.75], 4: [0.82, 0.84],
    5: [0.90, 0.91], 6: [0.96, 0.96], 7: [0.99, 0.99], 8: [1.00, 1.00],
    9: [0.99, 0.98], 10: [0.96, 0.94], 11: [0.88, 0.88], 12: [0.78, 0.82],
  };
  // and the abdominal volume, over the lumbar spine
  const ABDOMEN_W = { L5: [0.96, 0.92], L4: [1.00, 0.98], L3: [1.00, 1.00], L2: [0.97, 0.99], L1: [0.92, 0.96] };

  /** the exponent that makes a section's perimeter the measured circumference */
  function exponentFor(a, b, circ) {
    if (!GK.surf || !circ) return 2.15;
    return GK.surf.solveExponent(a, b, circ);
  }

  /**
   * Build every measured volume for a solved figure, in world coordinates,
   * on the frames the skeleton actually solved — so the ribcage turns when
   * the thorax turns and the head turns when the neck does.
   *
   * `at` is the part name each volume belongs to. Volumes are scoped exactly
   * as bones are: the thorax belongs to the trunk and to nothing else.
   */
  function buildVolumes(rig) {
    const fig = rig.figure, g = fig.girth, m = fig.m;
    const V = [];
    const vertR = fig.stature * 0.017;
    const put = (at, sdf) => V.push({ at, sdf });
    // every closure below takes (P, f): f is how much soft tissue is wrapped
    // around that solid, applied to its semi-axes rather than subtracted
    // from its field. See volumeField() for why that distinction matters.

    // ---- the ribcage -----------------------------------------------------
    // Anterior offset is the whole point. The vertebral column is at the BACK
    // of the thorax, not down its centre, so the ribcage's axis sits forward
    // of the spine by half the chest depth less the thickness of a vertebra.
    // Without this the spine runs down the middle of the torso and the figure
    // is a barrel with a groove in it.
    {
      const kb = CORE.thorax * g.chestBreadth * 0.5;
      const kd = CORE.thorax * g.chestDepth * 0.5;
      const n = exponentFor(kb, kd, CORE.thorax * g.chest);
      for (let j = 1; j < 12; j++) {
        const b0 = rig.bones['T' + j], b1 = rig.bones['T' + (j + 1)];
        if (!b0 || !b1) continue;
        // T1 is the TOP of the thoracic spine and T12 the bottom, so the
        // profile runs down as j runs up
        const w0 = THORAX_W[j], w1 = THORAX_W[j + 1];
        const fr = b0.frame;
        const o0 = kd * w0[1] - vertR, o1 = kd * w1[1] - vertR;
        const A = vmad(b0.A, fr[2], o0), B = vmad(b1.A, b1.frame[2], o1);
        put('trunk', (P, f) => sdSegSE(P, A, B, fr,
          kb * w0[0] + f, kd * w0[1] + f, kb * w1[0] + f, kd * w1[1] + f, n));
      }
    }

    // ---- the abdominal volume -------------------------------------------
    {
      const kb = CORE.abdomen * g.waistBreadth * 0.5;
      const kd = CORE.abdomen * g.waistDepth * 0.5;
      const n = exponentFor(kb, kd, CORE.abdomen * g.waist);
      const ids = ['L5', 'L4', 'L3', 'L2', 'L1'];
      for (let j = 0; j < ids.length - 1; j++) {
        const b0 = rig.bones[ids[j]], b1 = rig.bones[ids[j + 1]];
        if (!b0 || !b1) continue;
        const w0 = ABDOMEN_W[ids[j]], w1 = ABDOMEN_W[ids[j + 1]];
        const fr = b0.frame;
        const A = vmad(b0.A, fr[2], kd * w0[1] - vertR);
        const B = vmad(b1.A, b1.frame[2], kd * w1[1] - vertR);
        put('trunk', (P, f) => sdSegSE(P, A, B, fr,
          kb * w0[0] + f, kd * w0[1] + f, kb * w1[0] + f, kd * w1[1] + f, n));
      }
    }

    // ---- the pelvic block ------------------------------------------------
    // The pelvis bone has no length by construction — the root IS the sacral
    // base — so its form cannot come from a capsule along it. It comes from
    // hip breadth, buttock depth and buttock circumference, spanning crest to
    // crotch, which are four measured numbers.
    {
      const p = rig.bones.pelvis;
      if (p) {
        const kb = CORE.pelvis * g.hipBreadth * 0.5;
        const kd = CORE.pelvis * m.buttockdepth * 0.5;
        const n = exponentFor(kb, kd, CORE.pelvis * g.hip);
        const top = fig.landmarks.iliacCrest[0] - fig.rootHeight;
        const bot = m.crotchheight - fig.rootHeight;
        const fr = p.frame;
        const off = kd - vertR;
        const A = vmad(vmad(p.A, fr[0], bot), fr[2], off);
        const B = vmad(vmad(p.A, fr[0], top), fr[2], off);
        // narrower at the crotch than at the crest: an iliac crest is the
        // widest part of a pelvis and the ischia are not
        // A short cap, explicitly, and one that does NOT take the soft
        // layer. The natural rounding for a solid this wide is 78mm, which
        // would hang the pelvis that far below the crotch — between the
        // legs, where there is nothing — and inflating it with the 54mm of
        // soft tissue the buttock needs would hang it 130mm down, which is
        // most of the way to the knee.
        put('trunk', (P, f) => sdSegSE(P, A, B, fr,
          kb * 0.82 + f, kd * 0.94 + f, kb + f, kd + f, n, 26));
      }
    }

    // ---- the neck --------------------------------------------------------
    {
      const e = GK.surf ? GK.surf.ellipseFor(CORE.neck * g.neck, 0.92) : null;
      if (e) {
        for (let j = 7; j > 1; j--) {
          const b0 = rig.bones['C' + j], b1 = rig.bones['C' + (j - 1)];
          if (!b0 || !b1) continue;
          const fr = b0.frame;
          const off = e[1] - vertR;
          const A = vmad(b0.A, fr[2], off), B = vmad(b1.A, b1.frame[2], off);
          // the neck thickens into the shoulders at its base
          const k0 = j >= 6 ? 1.14 : 1.0;
          put('trunk', (P, f) => sdSegSE(P, A, B, fr,
            e[0] * k0 + f, e[1] * k0 + f, e[0] + f, e[1] + f, 2.2));
        }
      }
    }

    // ---- the head --------------------------------------------------------
    // Measured in all three axes, which is unusual and worth using: head
    // length is the anteroposterior one, head breadth the lateral, and the
    // vertical is tragion-to-vertex plus the face below it. The exponent then
    // makes the horizontal section's perimeter the measured head
    // circumference — a head is not an ellipse either.
    {
      const s = rig.bones.skull;
      if (s) {
        const az = CORE.head * m.headlength * 0.5;    // anteroposterior
        const ay = CORE.head * m.headbreadth * 0.5;   // lateral
        const ax = CORE.head * (m.tragiontopofhead + m.mentonsellionlength) * 0.5;
        const n = exponentFor(az, ay, CORE.head * m.headcircumference);
        // the head's centre sits above the tragion by half the difference
        // between what is above it and what hangs below it
        const up = (m.tragiontopofhead - m.mentonsellionlength) * 0.5;
        const fr = s.frame;
        // and back: the face is forward of the ear, the occiput further back
        const C = vmad(vmad(s.A, fr[0], up), fr[2], az * 0.10);
        put('head', (P, f) => sdBlobSE(P, C, fr, ax + f, ay + f, az + f, n));
      }
    }

    // ---- the feet --------------------------------------------------------
    // A foot is a wedge with a flat bottom, and the flat bottom is not a
    // detail: a rounded sole makes a figure look like it is standing on
    // tiptoe. The floor is a half-space and the foot is intersected with it.
    for (const side of ['L', 'R']) {
      const f = rig.bones['foot.' + side];
      if (!f) continue;
      const fr = f.frame;
      const L = f.len;
      // the ankle is not at the heel: it stands about a quarter of the foot's
      // length forward of it, which is what puts a heel behind a leg
      const heel = vmad(f.A, fr[0], -0.25 * L);
      const ball = vmad(f.A, fr[0], 0.42 * L);
      const toe = vmad(f.A, fr[0], 0.74 * L);
      const hb = CORE.foot * m.heelbreadth * 0.5;
      const bb = CORE.foot * m.footbreadthhorizontal * 0.5;
      const ankleH = (m.lateralmalleolusheight) * 0.5;    // ankle to sole, roughly
      const floor = -rig.figure.rootHeight;
      put('foot.' + side, (P, f) => {
        const d = smin(
          sdSegSE(P, heel, ball, fr, hb + f, ankleH * 0.92 + f, bb + f, ankleH * 0.62 + f, 2.3),
          sdSegSE(P, ball, toe, fr, bb + f, ankleH * 0.62 + f, bb * 0.74 + f, ankleH * 0.30 + f, 2.6),
          10);
        // a sole is flat, and a rounded one makes a figure look like it is
        // standing on tiptoe
        return Math.max(d, floor - P[0]);
      });
    }

    return V;
  }

  /**
   * The measured volumes belonging to one part, each wrapped in `f`
   * millimetres of soft tissue.
   *
   * WHY THE SOFT LAYER IS NOT SUBTRACTED. A superquadric has no closed-form
   * distance, so what these primitives return is F/|grad F| — first order,
   * and exact only ON the surface. Subtracting a thickness from it asks for a
   * level set some way off that surface, where first order is no longer good:
   * 57mm of soft tissue over a pelvis 125mm in semi-breadth came out 24mm too
   * far, which is a 19% error in hip breadth that looks exactly like a tuning
   * problem and is not one. Growing the semi-axes instead is exact on each
   * principal axis and very close between them, and it is also the more
   * truthful statement — subcutaneous tissue is a thickness on a form, not an
   * offset on a number.
   */
  function volumeField(rig, P, part, f) {
    const V = rig.volumes || (rig.volumes = buildVolumes(rig));
    let d = 1e9;
    for (const v of V) if (v.at === part) d = Math.min(d, v.sdf(P, f || 0));
    return d;
  }

  // =========================================================================
  //  MUSCLE
  // =========================================================================

  /**
   * Delegated to GK.muscle when it is present; until then the field has
   * skeleton and fat only, and says so rather than quietly substituting a
   * bigger bone. A figure drawn without this layer is a figure with no
   * deltoid, no calf and no glute, and it should look like it.
   */
  function muscleField(rig, P, part, f) {
    if (!GK.muscle || !GK.muscle.fieldAt) return 1e9;
    return GK.muscle.fieldAt(rig, P, part, f || 0);
  }

  // =========================================================================
  //  SOFT TISSUE
  // =========================================================================

  /* WHAT THIS LAYER IS, AND WHAT IT IS STANDING IN FOR.
     Between the structures above and the skin sits everything that is neither:
     subcutaneous fat, deep fascia, and — for as long as GK.muscle is absent —
     the muscles as well. So the honest name for the number solved here is not
     "fat", it is "how much soft tissue this region needs to reach the
     circumference ANSUR measured". A thigh needing fifty millimetres of it is
     not a fat thigh, it is a thigh with no quadriceps in the model yet, and
     the report says so.

     Each region is solved SEPARATELY, against its own measured girth. One
     global amount with estimated regional weights was the earlier design, and
     it could not work: a single degree of freedom against seven measurements
     lands somewhere that satisfies none of them, and the failure looks like a
     shape problem rather than an arithmetic one. Solving per region makes the
     distribution measured rather than estimated, which is strictly better,
     and it makes the missing-muscle deficit legible per region instead of
     smeared across the whole body. */

  // The regions with no girth to solve against. EST, and small — a scalp and
  // the dorsum of a foot genuinely are thin.
  const SOFT_EST = { foot: 5 };

  // The trunk's soft layer is a profile, not a number: a belly is not a
  // chest. These are the anchors, at measured heights. Three of them —
  // buttock, omphalion and chest — are solved against measured
  // circumferences; the rest keep the estimated SHAPE, rescaled to sit
  // consistently with whichever of the three is nearest.
  const TRUNK_FAT = [
    ['crotchheight', 1.05], ['buttockheight', 1.30], ['iliocristaleheight', 1.28],
    ['waistheightomphalion', 1.34], ['tenthribheight', 1.02], ['chestheight', 0.62],
    ['suprasternaleheight', 0.46], ['cervicaleheight', 0.38], ['stature', 0.26],
  ];

  function fatAt(fig, part, h) {
    const base = part.replace(/\.[LR]$/, '');
    const soft = fig.soft || (fig.soft = {});
    if (base === 'trunk') {
      const T = soft.trunk;
      if (!T) return 0;
      if (h === undefined || h <= T[0][0]) return T[0][1];
      for (let i = 0; i < T.length - 1; i++) {
        if (h <= T[i + 1][0]) {
          return lerp(T[i][1], T[i + 1][1], (h - T[i][0]) / (T[i + 1][0] - T[i][0]));
        }
      }
      return T[T.length - 1][1];
    }
    const v = soft[base];
    return v === undefined ? (SOFT_EST[base] || 0) : v;
  }

  // =========================================================================
  //  SCOPE
  //  Which bones and which volumes each part's field is made of.
  // =========================================================================

  const KEEP = {
    trunk: (id) => /^(pelvis|[LTC]\d+|clavicle\.[LR]|scapula\.[LR])$/.test(id),
    head: (id) => /^(skull|C[123])$/.test(id),
  };
  const limbKeep = (ids) => (id) => ids.indexOf(id) >= 0;

  // =========================================================================
  //  THE SKIN
  // =========================================================================

  /**
   * How far out from an axis the skin sits. Root-found rather than evaluated:
   * the field is a union of things that do not compose into a closed form,
   * and bisection on a monotone-enough ray is both simple and exactly as
   * accurate as it is asked to be.
   *
   * A station outside the part's own solid — above the vertex, beyond the
   * toes — has no crossing to find, and the bisection converges to the axis.
   * That is not a failure, it is how the caps close.
   */
  function radiusAlong(rig, part, C, dir, opts) {
    opts = opts || {};
    const fascia = opts.fascia === undefined ? 14 : opts.fascia;
    const fat = opts.fat === undefined ? fatAt(rig.figure, part.name, opts.h) : opts.fat;
    const keep = part.keep;
    const f = (r) => {
      const P = vmad(C, dir, r);
      // fascia is the smoothness of the union; the soft layer is a thickness
      // ON each solid, wrapped before they are unioned — which is also the
      // right order, since subcutaneous tissue bridges fattened forms
      const solid = smin(boneField(rig, P, keep, fat), volumeField(rig, P, part.name, fat), fascia);
      return smin(solid, muscleField(rig, P, part.name, fat), fascia);
    };
    let lo = 0.5, hi = Math.max(80, rig.figure.stature * 0.32);
    if (f(hi) < 0) return hi;
    // no crossing on this ray: the station is past the end of the solid.
    // Zero rather than a half-millimetre, so a ring that has left the body
    // is distinguishable from one that is merely thin.
    if (f(lo) > 0) return 0;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) * 0.5;
      if (f(mid) < 0) lo = mid; else hi = mid;
    }
    return (lo + hi) * 0.5;
  }

  /**
   * Where a part's axis is at station `s`, and the frame to sweep around it.
   * A part built on one bone walks that bone; the trunk walks the whole
   * spine, because the trunk is ONE part. Sampling per vertebra and tracing
   * each separately draws a stack of discs — every ring becomes its own
   * closed silhouette and the seams between them are all visible.
   */
  function axisAt(rig, part, s) {
    if (part.chain) {
      const ids = part.chain;
      const f = s * (ids.length - 1);
      // NOT clamped, and that is the point. The spine starts at L5, but a
      // body does not: the buttocks hang 160mm below the sacral base, and a
      // trunk whose stations stop where its bones stop is a trunk that ends
      // at the waist. Below zero the first segment is extrapolated downward,
      // which is where the pelvic block already is.
      const i = Math.min(ids.length - 2, Math.max(0, Math.floor(f))), t = f - i;
      const b0 = rig.bones[ids[i]], b1 = rig.bones[ids[i + 1]];
      if (!b0 || !b1) return null;
      return { C: M.vlerp(b0.A, b1.A, t), fr: t < 0.5 ? b0.frame : b1.frame };
    }
    const b = rig.bones[part.bone];
    if (!b) return null;
    return { C: vmad(b.A, b.frame[0], b.len * s), fr: b.frame };
  }

  /** a ring of skin samples around a part, ready for the tracer and the depth field */
  function ringAt(rig, part, s, na, opts) {
    const ax = axisAt(rig, part, s);
    if (!ax) return null;
    const o = Object.assign({ h: ax.C[0] }, opts || {});
    const out = [];
    let wide = 0;
    for (let k = 0; k < na; k++) {
      const beta = (k / na) * Math.PI * 2;
      const dir = vadd(vmul(ax.fr[1], Math.cos(beta)), vmul(ax.fr[2], Math.sin(beta)));
      const r = radiusAlong(rig, part, ax.C, dir, o);
      if (r > 1.5) wide++;
      out.push(vmad(ax.C, dir, r));
    }
    return wide ? out : null;
  }

  /**
   * Where a part's solid actually starts and stops along its own axis.
   *
   * A station range has to be guessed wide, because the thing it has to
   * contain — a head that hangs below the bone it is built on, a heel behind
   * an ankle — is not the bone's own extent. Guessed wide, the outermost
   * rings sit in empty space, collapse to the axis, and the tracer joins them
   * into a needle: the spike out of the top of every skull in the first pass.
   * So the range is found rather than guessed, by bisection against the
   * field, and only then divided into stations — which also stops a fifth of
   * a part's rings being spent outside it.
   */
  function trimRange(rig, part) {
    const has = (s) => !!ringAt(rig, part, s, 8);
    const edge = (inside, outside) => {
      for (let i = 0; i < 12; i++) {
        const mid = (inside + outside) * 0.5;
        if (has(mid)) inside = mid; else outside = mid;
      }
      return outside;
    };
    // find any station that is inside, working in from both ends
    let mid = null;
    for (let i = 0; i <= 16 && mid === null; i++) {
      const s = part.s0 + (part.s1 - part.s0) * (i / 16);
      if (has(s)) mid = s;
    }
    if (mid === null) return part;
    part.s0 = edge(mid, part.s0);
    part.s1 = edge(mid, part.s1);
    return part;
  }

  function spineChain(rig) {
    const ids = [];
    for (let i = 5; i >= 1; i--) if (rig.bones['L' + i]) ids.push('L' + i);
    for (let i = 12; i >= 1; i--) if (rig.bones['T' + i]) ids.push('T' + i);
    for (let i = 7; i >= 1; i--) if (rig.bones['C' + i]) ids.push('C' + i);
    return ids;
  }

  /**
   * Every drawable part of the body, with the scope of its own field and the
   * range of stations it covers. The station range is what closes a part: a
   * head runs from below its own chin to above its own crown, so the rings
   * shrink to nothing at both ends and the cap is found rather than faked.
   */
  function parts(rig) {
    const out = [];
    out.push({
      name: 'trunk', chain: spineChain(rig), keep: KEEP.trunk,
      s0: -0.42, s1: 1.10, ns: 52, na: 30,
    });
    out.push({
      name: 'head', bone: 'skull', keep: KEEP.head,
      s0: -1.60, s1: 1.50, ns: 22, na: 24,
    });
    for (const side of ['L', 'R']) {
      const S = '.' + side;
      out.push({ name: 'humerus' + S, bone: 'humerus' + S, keep: limbKeep(['humerus' + S, 'scapula' + S]), s0: 0, s1: 1, ns: 14, na: 22 });
      out.push({ name: 'forearm' + S, bone: 'forearm' + S, keep: limbKeep(['forearm' + S]), s0: 0, s1: 1, ns: 14, na: 22 });
      out.push({ name: 'femur' + S, bone: 'femur' + S, keep: limbKeep(['femur' + S]), s0: 0, s1: 1, ns: 16, na: 24 });
      out.push({ name: 'tibia' + S, bone: 'tibia' + S, keep: limbKeep(['tibia' + S]), s0: 0, s1: 1, ns: 16, na: 24 });
      out.push({ name: 'foot' + S, bone: 'foot' + S, keep: limbKeep([]), s0: -0.50, s1: 1.00, ns: 14, na: 20 });
    }
    for (const p of out) {
      p.ring = (s, na) => ringAt(rig, p, s, na === undefined ? p.na : na);
      trimRange(rig, p);
    }
    return out;
  }

  // =========================================================================
  //  FITTING
  // =========================================================================

  /**
   * Solve the one global fat amount that makes this figure's girths the
   * measured ones. The regional weights say WHERE fat sits; ANSUR says how
   * much there is in total, through circumferences it actually measured. So
   * the shape of the distribution is estimated and its magnitude is not.
   *
   * One degree of freedom against seven measurements is a compromise, and the
   * per-site residuals are returned rather than swallowed — a fat term that
   * makes the thigh right and the chest 40mm wrong is a fact about the model,
   * and the model should have to say it out loud.
   */
  /* A girth is measured at a HEIGHT on a standing body, and comparing the
     model against it means sampling the model at that same height. The
     stations here were guessed once, and the chest girth was being checked
     at T3 — up in the shoulders, 140mm above where ANSUR put the tape. */
  const SITES = [
    { region: 'femur', part: 'femur.L', s: 0.35, girth: 'thigh' },
    { region: 'tibia', part: 'tibia.L', s: 0.28, girth: 'calf' },
    { region: 'humerus', part: 'humerus.L', s: 0.45, girth: 'biceps' },
    { region: 'forearm', part: 'forearm.L', s: 0.22, girth: 'forearm' },
    { region: 'head', part: 'head', s: 0.16, girth: 'head' },
    { region: 'trunk', part: 'trunk', at: 'chestheight', girth: 'chest' },
    { region: 'trunk', part: 'trunk', at: 'waistheightomphalion', girth: 'waist' },
    { region: 'trunk', part: 'trunk', at: 'buttockheight', girth: 'hip' },
  ];

  /**
   * The station along a chain whose ring sits at a given height above the
   * floor. Inverts the chain by walking it: the bones are stacked, so their
   * origins are monotone in height for any upright pose, and below the first
   * one the first segment extrapolates exactly as axisAt does.
   */
  function stationAtHeight(rig, part, mm) {
    const ids = part.chain;
    const h = mm - rig.figure.rootHeight;
    const y = ids.map((id) => rig.bones[id].A[0]);
    const n = ids.length - 1;
    if (h <= y[0]) return (h - y[0]) / Math.max(1e-6, y[1] - y[0]) / n;
    for (let i = 0; i < n; i++) {
      if (h <= y[i + 1]) return (i + (h - y[i]) / Math.max(1e-6, y[i + 1] - y[i])) / n;
    }
    return 1;
  }

  /**
   * Solve the soft-tissue thickness of every region against its own measured
   * circumference, and report how much each one needed.
   *
   * The number to watch is not whether the girths come out right — they do,
   * by construction, which is the point of solving rather than tuning. It is
   * how THICK the soft layer had to be. Subcutaneous fat over a thigh is
   * about ten millimetres on a lean adult. Anything far above that is the
   * model reporting, in millimetres, the size of the muscle it does not yet
   * have.
   */
  function fitFat(rig, sites) {
    const fig = rig.figure;
    sites = sites || SITES;
    fig.soft = {};
    // an initial trunk profile of zeros, so fatAt() has something to read
    // while the trunk anchors are being solved one at a time
    const anchors = TRUNK_FAT.map(([k, w]) => [fig.m[k] - fig.rootHeight, 0, w, k]);
    fig.soft.trunk = anchors;
    const P = {};
    for (const p of parts(rig)) P[p.name] = p;

    const measure = (st) => {
      const p = P[st.part];
      if (!p) return null;
      const s = st.at === undefined ? st.s : stationAtHeight(rig, p, fig.m[st.at]);
      const R = ringAt(rig, p, s, 36);
      if (!R) return null;
      let L = 0;
      for (let i = 0; i < R.length; i++) L += vlen(vsub(R[(i + 1) % R.length], R[i]));
      return L;
    };

    // Each site is one monotone 1-D problem: thicker soft tissue, longer
    // perimeter. Bisection, and no interaction between regions to worry
    // about — which is exactly what solving them separately buys.
    const solve = (st, set) => {
      const want = fig.girth[st.girth];
      let lo = 0, hi = 140;
      const at = (t) => { set(t); const g = measure(st); return g === null ? -1e9 : g - want; };
      if (at(hi) < 0) { set(hi); return { t: hi, got: measure(st), want, capped: true }; }
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) * 0.5;
        if (at(mid) < 0) lo = mid; else hi = mid;
      }
      const t = (lo + hi) * 0.5;
      set(t);
      return { t, got: measure(st), want };
    };

    const report = [];
    for (const st of sites) {
      let r;
      if (st.region === 'trunk') {
        const i = anchors.findIndex((a) => a[3] === st.at);
        r = solve(st, (t) => { anchors[i][1] = t; });
        r.where = st.at;
      } else {
        r = solve(st, (t) => { fig.soft[st.region] = t; });
      }
      r.region = st.region; r.girth = st.girth;
      report.push(r);
    }

    /* The trunk anchors that no tape reaches. Their estimated SHAPE is kept
       and its scale is taken from the nearest solved anchor, so the profile
       between the hip, the waist and the chest is measured and the profile
       beyond them is the estimate carried consistently rather than a second
       independent guess. */
    const solved = anchors.filter((a) => a[1] > 0);
    for (const a of anchors) {
      if (a[1] > 0) continue;
      let best = solved[0];
      for (const c of solved) if (Math.abs(c[0] - a[0]) < Math.abs(best[0] - a[0])) best = c;
      a[1] = best ? a[2] * (best[1] / best[2]) : 0;
    }
    return { soft: fig.soft, report, anchors };
  }

  GK.field = {
    smin, sdCapsule, sdSegSE, sdBlobSE,
    boneField, boneRadius, muscleField, volumeField, buildVolumes,
    fatAt, TRUNK_FAT, SOFT_EST, BONE_R, CORE, KEEP, stationAtHeight,
    radiusAlong, axisAt, ringAt, trimRange, spineChain, parts, fitFat, SITES,
  };
})(window.GK = window.GK || {});
