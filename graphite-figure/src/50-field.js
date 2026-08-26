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
  function sdSegSE(P, A, B, fr, a0, b0, a1, b1, n, cap, f) {
    f = f || 0;
    const ab = vsub(B, A), ap = vsub(P, A);
    const t = clamp01(vdot(ap, ab) / Math.max(1e-9, vdot(ab, ab)));
    const c = vmad(A, ab, t);
    const d = vsub(P, c);
    const cy = lerp(a0, a1, t), cz = lerp(b0, b1, t);
    const ay = cy + f, az = cz + f;
    n = nOffset(n, Math.min(cy, cz), f);
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
  function sdBlobSE(P, C, fr, ax, ay, az, n, f) {
    f = f || 0;
    n = nOffset(n, Math.min(ax, ay, az), f);
    ax += f; ay += f; az += f;
    const d = vsub(P, C);
    return seDist(Math.abs(vdot(d, fr[1])) / ay, Math.abs(vdot(d, fr[2])) / az,
      Math.abs(vdot(d, fr[0])) / ax, ay, az, ax, n);
  }

  /**
   * What a superellipse's exponent becomes when the form is wrapped in `f`
   * millimetres of something.
   *
   * Growing the semi-axes and leaving the exponent alone is not an offset,
   * it is a scaling, and the difference shows: a pelvis solved to n = 3.2
   * against its measured buttock circumference is a rounded rectangle, and
   * grown by the 54mm of soft tissue the buttock needs it stays a rounded
   * rectangle — the hips came out with hard vertical flanks and square
   * corners. Offsetting a convex form ROUNDS it. Every corner picks up `f`
   * of radius, and in the limit any bounded convex shape offset far enough
   * is a circle.
   *
   * The exact offset of a superellipse is not a superellipse and has no
   * useful closed form, so this is the cheapest thing with both limits
   * right: unchanged at f = 0, tending to an ellipse once f passes the
   * form's own smaller semi-axis. EST in the sense that the RATE between
   * those two ends is a guess; the two ends themselves are not.
   */
  function nOffset(n, semi, f) {
    if (!f || n <= 2) return n;
    return 2 + (n - 2) * semi / (semi + f);
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
  /**
   * Which bones a part's field is made of, resolved ONCE.
   *
   * This used to be a predicate called per bone per field evaluation, which
   * meant a regular expression matched against forty bone names inside the
   * innermost loop of a root-finder — several million times per figure. The
   * scope of a part is a fact about the skeleton, not about the point being
   * sampled, so it is answered once and carried.
   */
  function bonesFor(rig, keep) {
    const out = [];
    for (const id of rig.order) {
      const b = rig.bones[id];
      if (!b.len) continue;
      if (SHAPED[id.replace(/\.[LR]$/, '')]) continue;
      if (keep && !keep(id)) continue;
      out.push({ A: b.A, B: b.B, r: boneRadius(rig.figure, id) });
    }
    return out;
  }

  function boneField(rig, P, bones, f) {
    f = f || 0;
    let d = 1e9;
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i];
      // a capsule IS a true distance field, so here the thickness could
      // equally be subtracted; it is added for the same reason everywhere
      const t = sdCapsule(P, b.A, b.B, b.r + f, b.r * 0.92 + f);
      if (t < d) d = t;
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
          kb * w0[0], kd * w0[1], kb * w1[0], kd * w1[1], n, undefined, f));
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
          kb * w0[0], kd * w0[1], kb * w1[0], kd * w1[1], n, undefined, f));
      }
    }

    // ---- the pelvic block ------------------------------------------------
    /* The pelvis bone has no length by construction — the root IS the sacral
       base — so its form cannot come from a capsule along it. It comes from
       measurements, and ANSUR happens to have measured this region twice, at
       two different heights: BICRISTAL breadth across the iliac crests, and
       HIP breadth at the trochanters below them. Those are not the same
       number — 290mm against 349mm on this figure — and which one goes where
       decides the whole shape of the hips.

       The first version used hip breadth at the crest and tapered DOWNWARD
       from it, which is the taper upside down: it made the widest point of
       the pelvis its top edge, and the hips came out as a rectangle hanging
       off the waist. The widest point of a pelvis is the trochanters. So the
       block is two segments — narrowing up from the trochanters to the
       crests, narrowing down from the trochanters into the thighs — and both
       ends of the upper one are measured. */
    {
      const p = rig.bones.pelvis;
      if (p) {
        const kTro = CORE.pelvis * g.hipBreadth * 0.5;
        const kCre = CORE.pelvis * m.bicristalbreadth * 0.5;
        const dTro = CORE.pelvis * m.buttockdepth * 0.5;
        // the crest section is shallower than the buttock's: it is the waist's
        // depth, which is measured, rather than a fraction of the buttock's
        const dCre = CORE.pelvis * g.waistDepth * 0.5;
        const n = exponentFor(kTro, dTro, CORE.pelvis * g.hip);
        const fr = p.frame;
        const at = (mm, off) => vmad(vmad(p.A, fr[0], mm - fig.rootHeight), fr[2], off);
        const A = at(m.crotchheight, dTro * 0.90 - vertR);
        const T = at(m.trochanterionheight, dTro - vertR);
        const C = at(fig.landmarks.iliacCrest[0], dCre - vertR);
        // A short cap, explicitly, and one that does NOT take the soft layer.
        // The natural rounding for a solid this wide is 78mm, which would
        // hang the pelvis that far below the crotch — between the legs, where
        // there is nothing — and inflating it with the 58mm of soft tissue
        // the buttock needs would hang it 136mm down, most of the way to the
        // knee.
        put('trunk', (P, f) => sdSegSE(P, A, T, fr,
          kTro * 0.86, dTro * 0.90, kTro, dTro, n, 26, f));
        put('trunk', (P, f) => sdSegSE(P, T, C, fr,
          kTro, dTro, kCre, dCre, n, undefined, f));
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
            e[0] * k0, e[1] * k0, e[0], e[1], 2.2, undefined, f));
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
        put('head', (P, f) => sdBlobSE(P, C, fr, ax, ay, az, n, f));
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
          sdSegSE(P, heel, ball, fr, hb, ankleH * 0.92, bb, ankleH * 0.62, 2.3, undefined, f),
          sdSegSE(P, ball, toe, fr, bb, ankleH * 0.62, bb * 0.74, ankleH * 0.30, 2.6, undefined, f),
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
  function volumeField(vols, P, f) {
    let d = 1e9;
    for (let i = 0; i < vols.length; i++) {
      const t = vols[i].sdf(P, f || 0);
      if (t < d) d = t;
    }
    return d;
  }

  /** the volumes belonging to one part, resolved once for the same reason */
  function volumesFor(rig, name) {
    const V = rig.volumes || (rig.volumes = buildVolumes(rig));
    return V.filter((v) => v.at === name);
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
  /**
   * Delegated to GK.muscle when it is present; until then the field has
   * skeleton and fat only, and says so rather than quietly substituting a
   * bigger bone. A figure drawn without this layer is a figure with no
   * deltoid, no calf and no glute, and it should look like it.
   *
   * `keys` rather than the part's own name, because the two modules do not
   * have to agree on how a body is cut into drawable pieces and should not
   * be made to. A drawing wants an arm to be one form; a muscle atlas is
   * organised by the bone each group acts on. So the part carries the list
   * of regions it spans and asks for each — which also meant that merging
   * the humerus and forearm parts into one arm silently dropped every arm
   * muscle, until this took a list.
   */
  function muscleField(rig, P, part, f) {
    if (!GK.muscle || !GK.muscle.fieldAt) return 1e9;
    const keys = part.muscleKeys || [part.name];
    let d = 1e9;
    for (const k of keys) d = Math.min(d, GK.muscle.fieldAt(rig, P, k, f || 0));
    return d;
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

  /**
   * Piecewise-linear through [key, mm] anchors, holding flat beyond the ends.
   * The table MUST be sorted ascending by key — see the note in fitFat about
   * what happens when it is not, which is nothing, silently.
   */
  function alongTable(T, x) {
    if (!T || !T.length) return 0;
    if (x === undefined || x <= T[0][0]) return T[0][1];
    for (let i = 0; i < T.length - 1; i++) {
      if (x <= T[i + 1][0]) {
        const w = T[i + 1][0] - T[i][0];
        // two landmarks can land on the same millimetre; take the upper
        if (w < 1e-6) return T[i + 1][1];
        return lerp(T[i][1], T[i + 1][1], (x - T[i][0]) / w);
      }
    }
    return T[T.length - 1][1];
  }

  /* A LIMB IS NOT A CYLINDER, AND ANSUR SAYS SO TWICE.
     The first version solved one thickness per region, so a thigh had the
     same soft tissue at the knee as at the groin and came out a tube — no
     knee, no ankle, no wrist, and two thighs whose outlines ran parallel all
     the way down. But the survey measured each limb at BOTH ends: thigh and
     lower thigh, calf and ankle, forearm and wrist. Two anchors per limb is
     a measured taper, and it costs nothing but reading the second column.

     The humerus is the exception, and is marked as such: there is no elbow
     circumference in this survey, so its distal anchor is not measured. It
     is tied to the forearm's proximal thickness instead, on the grounds that
     skin is continuous across an elbow. That is a constraint, not a
     measurement, and it is the only one here. */
  function fatAt(fig, part, h, s) {
    const base = part.replace(/\.[LR]$/, '');
    const soft = fig.soft || (fig.soft = {});
    if (base === 'trunk') return alongTable(soft.trunk, h);
    const v = soft[base];
    if (v === undefined) return SOFT_EST[base] || 0;
    return Array.isArray(v) ? alongTable(v, s) : v;
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
    const fat = opts.fat === undefined ? fatAt(rig.figure, part.name, opts.h, opts.s) : opts.fat;
    const bones = part._bones || (part._bones = bonesFor(rig, part.keep));
    const vols = part._vols || (part._vols = volumesFor(rig, part.name));
    const f = (r) => {
      const P = vmad(C, dir, r);
      // fascia is the smoothness of the union; the soft layer is a thickness
      // ON each solid, wrapped before they are unioned — which is also the
      // right order, since subcutaneous tissue bridges fattened forms
      const solid = smin(boneField(rig, P, bones, fat), volumeField(vols, P, fat), fascia);
      return smin(solid, muscleField(rig, P, part, fat), fascia);
    };
    /* THE FIRST CROSSING, NOT ANY CROSSING.
       Skin is the first surface you meet walking out from a bone. That
       sounds like a distinction without a difference, and it is — right up
       until the field contains something detached out along the ray, at
       which point plain bisection between the axis and the far bound will
       happily return the OUTSIDE of that thing.

       It did. The trunk's field includes the muscles that touch the trunk,
       the deltoid among them, and a deltoid sits out at the shoulder. Once
       the soft layer grew thick enough for the smooth union to bridge the
       gap, the chest ring stopped being the chest and jumped to the far side
       of the shoulder: on one figure the chest circumference went 748mm,
       827mm, then 2401mm as the soft layer went 0, 10, 40 — non-monotone, so
       the solver above, which assumes more tissue means more girth, landed
       anywhere at all. It reported one body 152% out and looked exactly like
       a muscle that needed tuning.

       So march out from the axis while inside, and only bisect once the sign
       has actually flipped. The march is sphere-tracing: the field is close
       enough to a distance that stepping by most of its own magnitude is
       both safe and fast, and the 0.75 keeps it honest where it is not. */
    const hi0 = Math.max(80, rig.figure.stature * 0.32);
    let lo = 0.5;
    if (f(lo) > 0) return 0;   // the station is past the end of the solid
    let hi = -1;
    for (let r = lo, i = 0; r < hi0 && i < 64; i++) {
      const v = f(r);
      if (v > 0) { hi = r; break; }
      lo = r;
      r += Math.max(1.5, -v * 0.75);
    }
    if (hi < 0) return hi0;    // solid all the way out; nothing to find
    // 14 halvings of a bracket a few millimetres wide is well under a micron
    for (let i = 0; i < 14; i++) {
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
  /**
   * The points a chain part sweeps between, and the frame at each.
   *
   * The subtlety is the last one. A chain of bones gives its stations from
   * the bones' ORIGINS, so a chain of n bones has n stations and stops at
   * the last bone's start — which for the spine barely showed (the top of
   * C1 is a millimetre of neck) and for a leg would have thrown the entire
   * tibia away. So the far end of the last bone is a node too.
   */
  function chainNodes(rig, ids) {
    const out = [];
    for (const id of ids) {
      const b = rig.bones[id];
      if (b) out.push({ P: b.A, fr: b.frame });
    }
    const last = rig.bones[ids[ids.length - 1]];
    if (last) out.push({ P: last.B, fr: last.frame });
    return out;
  }

  function axisAt(rig, part, s) {
    if (part.chain) {
      const nd = part.nodes || (part.nodes = chainNodes(rig, part.chain));
      const f = s * (nd.length - 1);
      // NOT clamped, and that is the point. The spine starts at L5, but a
      // body does not: the buttocks hang 160mm below the sacral base, and a
      // trunk whose stations stop where its bones stop is a trunk that ends
      // at the waist. Below zero the first segment is extrapolated downward,
      // which is where the pelvic block already is.
      const i = Math.min(nd.length - 2, Math.max(0, Math.floor(f))), t = f - i;
      return { C: M.vlerp(nd[i].P, nd[i + 1].P, t), fr: t < 0.5 ? nd[i].fr : nd[i + 1].fr };
    }
    const b = rig.bones[part.bone];
    if (!b) return null;
    return { C: vmad(b.A, b.frame[0], b.len * s), fr: b.frame };
  }

  /** a ring of skin samples around a part, ready for the tracer and the depth field */
  function ringAt(rig, part, s, na, opts) {
    const ax = axisAt(rig, part, s);
    if (!ax) return null;
    const o = Object.assign({ h: ax.C[0], s }, opts || {});
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
      name: 'trunk', chain: spineChain(rig), keep: KEEP.trunk, muscleKeys: ['trunk'],
      s0: -0.42, s1: 1.10, ns: 52, na: 30,
    });
    out.push({
      name: 'head', bone: 'skull', keep: KEEP.head, muscleKeys: ['head'],
      s0: -1.60, s1: 1.50, ns: 22, na: 24,
    });
    /* A LIMB IS ONE PART. Drawn as two — an upper and a lower — each closes
       its own silhouette, and where they meet both end caps are exposed: the
       thigh's distal rim is three millimetres wider than the calf's proximal
       one, so a hard line got ruled straight across every knee and every
       elbow. Nothing is wrong with either radius; the seam is an artefact of
       cutting a form in half and asking each half to have an outline.

       As one chain part the joint is an interior station: no cap, no seam,
       one continuous soft-tissue profile from hip to ankle, and one
       silhouette — which is also what an arm is, to a pencil. */
    for (const side of ['L', 'R']) {
      const S = '.' + side;
      out.push({
        name: 'arm' + S, chain: ['humerus' + S, 'forearm' + S],
        keep: limbKeep(['humerus' + S, 'forearm' + S, 'scapula' + S]),
        muscleKeys: ['humerus' + S, 'forearm' + S],
        s0: 0, s1: 1, ns: 30, na: 22,
      });
      out.push({
        name: 'leg' + S, chain: ['femur' + S, 'tibia' + S],
        keep: limbKeep(['femur' + S, 'tibia' + S]),
        muscleKeys: ['femur' + S, 'tibia' + S],
        s0: 0, s1: 1, ns: 34, na: 24,
      });
      out.push({ name: 'foot' + S, bone: 'foot' + S, keep: limbKeep([]), muscleKeys: ['foot' + S], s0: -0.50, s1: 1.00, ns: 14, na: 20 });
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
  /* Stations are where the survey put the tape, as fractions along the bone:
     thigh circumference at the gluteal furrow, lower thigh just above the
     knee, calf at its maximum, ankle at its minimum above the malleoli,
     forearm at its maximum, wrist at the stylion. EST in the sense that the
     fraction is read off the definition rather than given as a number; the
     circumference at it is measured. */
  const SITES = [
    { region: 'leg', part: 'leg.L', bone: 'femur.L', s: 0.10, girth: 'thigh' },
    { region: 'leg', part: 'leg.L', bone: 'femur.L', s: 0.88, girth: 'lowerThigh' },
    { region: 'leg', part: 'leg.L', bone: 'tibia.L', s: 0.25, girth: 'calf' },
    { region: 'leg', part: 'leg.L', bone: 'tibia.L', s: 0.92, girth: 'ankle' },
    { region: 'arm', part: 'arm.L', bone: 'humerus.L', s: 0.45, girth: 'biceps' },
    { region: 'arm', part: 'arm.L', bone: 'forearm.L', s: 0.20, girth: 'forearm' },
    { region: 'arm', part: 'arm.L', bone: 'forearm.L', s: 0.96, girth: 'wrist' },
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
    const nd = part.nodes || (part.nodes = chainNodes(rig, part.chain));
    const h = mm - rig.figure.rootHeight;
    const y = nd.map((q) => q.P[0]);
    const n = nd.length - 1;
    if (h <= y[0]) return (h - y[0]) / Math.max(1e-6, y[1] - y[0]) / n;
    for (let i = 0; i < n; i++) {
      if (h <= y[i + 1]) return (i + (h - y[i]) / Math.max(1e-6, y[i + 1] - y[i])) / n;
    }
    return 1;
  }

  /**
   * A chain station from a station along ONE of the chain's bones. Bone i
   * runs from node i to node i+1, so this is just where that bone sits in
   * the sequence — which is what lets a measurement taken "a tenth of the
   * way down the femur" address a part that is the whole leg.
   */
  function stationOf(rig, part, boneId, sLocal) {
    if (!part.chain) return sLocal;
    const nd = part.nodes || (part.nodes = chainNodes(rig, part.chain));
    const i = part.chain.indexOf(boneId);
    if (i < 0) return sLocal;
    return (i + clamp01(sLocal)) / (nd.length - 1);
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
    // Anchor tables, empty-valued, so fatAt() has something to read while
    // they are being solved one at a time. Each site sits exactly ON its own
    // anchor, and a piecewise-linear table's value at an anchor is that
    // anchor — so the sites do not interact and can be solved independently
    // in any order, which is the whole reason for this shape.
    /* SORTED BY HEIGHT, AND IT IS NOT A TIDINESS. TRUNK_FAT is written in the
       order those landmarks sit on a mean body — crotch, buttock, crest,
       omphalion, tenth rib, chest — and on a mean body they do. On an
       INDIVIDUAL body they do not always: the iliac crest and the omphalion
       are two millimetres apart on average and either can be the higher, and
       the sample is drawn per figure. Out of order, alongTable() walks past
       the waist anchor and returns an interpolation of its neighbours, so
       solving that anchor changes nothing at all — the bisection ran to its
       140mm ceiling and the waist stayed at its unsoftened 794mm against a
       measured 932. It failed on two seeds in four and passed on the rest,
       which is exactly the shape of bug that ships. */
    const trunkAnchors = TRUNK_FAT.map(([k, w]) => [fig.m[k] - fig.rootHeight, 0, w, k])
      .sort((a2, b2) => a2[0] - b2[0]);
    fig.soft.trunk = trunkAnchors;
    const limb = {};
    const P0 = {};
    for (const p of parts(rig)) P0[p.name] = p;
    for (const st of sites) {
      if (st.region === 'trunk' || st.at !== undefined) continue;
      const key = st.bone === undefined ? st.s : stationOf(rig, P0[st.part], st.bone, st.s);
      (limb[st.region] || (limb[st.region] = [])).push([key, 0, st]);
    }
    for (const r in limb) { limb[r].sort((a2, b2) => a2[0] - b2[0]); fig.soft[r] = limb[r]; }

    const P = P0;

    const stationFor = (st) => {
      const p = P[st.part];
      if (st.at !== undefined) return stationAtHeight(rig, p, fig.m[st.at]);
      return st.bone === undefined ? st.s : stationOf(rig, p, st.bone, st.s);
    };
    const measure = (st) => {
      const p = P[st.part];
      if (!p) return null;
      const s = stationFor(st);
      const R = ringAt(rig, p, s, 28);
      if (!R) return null;
      let L = 0;
      for (let i = 0; i < R.length; i++) L += vlen(vsub(R[(i + 1) % R.length], R[i]));
      return L;
    };

    // Each site is one monotone 1-D problem: thicker soft tissue, longer
    // perimeter. Bisection, and no interaction between sites to worry about.
    const solve = (st, set) => {
      const want = fig.girth[st.girth];
      let lo = 0, hi = 140;
      const at = (t) => { set(t); const g = measure(st); return g === null ? -1e9 : g - want; };
      if (at(hi) < 0) { set(hi); return { t: hi, got: measure(st), want, capped: true }; }
      for (let i = 0; i < 16; i++) {
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
        const i = trunkAnchors.findIndex((a2) => a2[3] === st.at);
        r = solve(st, (t) => { trunkAnchors[i][1] = t; });
      } else {
        const tab = fig.soft[st.region];
        const i = tab.findIndex((a2) => a2[2] === st);
        r = solve(st, (t) => { tab[i][1] = t; });
      }
      r.region = st.region; r.girth = st.girth;
      report.push(r);
    }

    /* No elbow circumference exists in this survey, and with the arm as one
       part none is needed: the profile runs continuously from the biceps
       station to the forearm's, and the elbow gets whatever lies between
       them. That is an interpolation across an unmeasured region rather than
       a constraint invented to bridge two separately-solved parts, which is
       what the split version had to do. */

    /* The trunk anchors that no tape reaches. Their estimated SHAPE is kept
       and its scale is taken from the nearest solved anchor, so the profile
       between the hip, the waist and the chest is measured and the profile
       beyond them is the estimate carried consistently rather than a second
       independent guess. */
    const solved = trunkAnchors.filter((a2) => a2[1] > 0);
    for (const a2 of trunkAnchors) {
      if (a2[1] > 0) continue;
      let best = solved[0];
      for (const c of solved) if (Math.abs(c[0] - a2[0]) < Math.abs(best[0] - a2[0])) best = c;
      a2[1] = best ? a2[2] * (best[1] / best[2]) : 0;
    }
    return { soft: fig.soft, report, anchors: trunkAnchors };
  }

  GK.field = {
    smin, sdCapsule, sdSegSE, sdBlobSE, nOffset,
    boneField, bonesFor, boneRadius, muscleField, volumeField, volumesFor, buildVolumes,
    fatAt, alongTable, TRUNK_FAT, SOFT_EST, BONE_R, CORE, KEEP, stationAtHeight,
    radiusAlong, axisAt, ringAt, trimRange, spineChain, parts, fitFat, SITES,
  };
})(window.GK = window.GK || {});
