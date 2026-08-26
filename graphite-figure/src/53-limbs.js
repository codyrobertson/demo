/* ============================================================================
   GRAPHITE FIGURE — src/53-limbs.js
   The limbs' surface anatomy beyond bone, muscle and soft tissue: the forms
   at the joints and the extremities. A knee is a patella and two condyle
   planes, an ankle is two malleoli with a tendon behind it, a foot is a
   wedge with an instep — none of which fall out of capsules.

   Registered into the field's volume build so the extremities can be worked
   without the head or the torso moving underneath them.

   FRAME CONVENTIONS, CHECKED NUMERICALLY RATHER THAN ASSUMED (tools probe
   against the solved rig — see this file's own history): for the leg
   (femur, tibia) and the foot, frame[1] is medial when scaled by the bone's
   own `.sign` (+1 left, -1 right) and lateral scaled by its negative —
   frame[1] itself points the same way in WORLD space on both sides, since
   the left/right mirroring lives in the aim direction (frame[0]) and not in
   the perpendicular axes the solver completes it with. So "medial" needs
   the sign applied by the caller; nothing upstream does it. frame[2] is
   anterior for the leg and needs no such correction. The foot inherits the
   same frame[1] rule; its own frame[2] is dorsal (top-of-foot) rather than
   anterior, since the foot's long axis (frame[0]) already IS anterior. The
   arm (humerus, forearm) follows the identical pattern: frame[1]
   medial-by-sign, frame[2] anterior.
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;
  const { vadd, vsub, vmul, vmad, vnorm, lerp, clamp01 } = M;
  const UP = [1, 0, 0];   // world +X. Used where a height needs to be PINNED
                           // rather than reached via a frame axis that is
                           // only approximately vertical (frame[2] on a foot
                           // carries a percent or two of lateral lean).

  GK.field.registerVolumes('limbs', (ctx) => {
    const { rig, fig, m, g, put, vertR, smin, smax, sdSegSE, sdBlobSE, sdCapsule,
      frameAlong, exponentFor, CORE } = ctx;

// ---- the feet --------------------------------------------------------
/* WHAT WAS HERE: two straight-sided segments (heel-to-ball, ball-to-toe) of
   near-constant height, intersected with the floor. Every complaint on the
   review sheet is one shape away from that description — flat boots with no
   instep, no arch, no malleoli and no heel distinct from the shin.

   THE FLOOR CLAMP WAS NOT DOING WHAT ITS OWN COMMENT CLAIMED. "The floor is
   a half-space and the foot is intersected with it" was true of the code
   and false of the numbers: the old station centres sat at ANKLE height
   (~58mm on a 1623mm figure) and the tallest semi-axis reached only 27mm
   down from there, so the sole's own lowest point sat 27-45mm ABOVE the
   floor at every station a probe checked. The "flat sole" in the old
   renders was never the clamp firing — it was a wide, low superellipse
   looking flat on its own, floating a few centimetres up. Fixed here by
   pinning every station's centre well UNDER the true floor (PAD, below) and
   reaching back up to the dorsal height that matters with the semi-axis
   alone, so the clamp is what draws the sole at every station, not an
   accident of proportions.

   THE STATIONS. ANSUR gives four numbers for a foot — length, horizontal
   breadth, heel breadth, and the ankle's own height off the floor — and
   nothing about the profile between them. Those four sit exactly where the
   survey put them (ball at the breadth station, heel at the heel-breadth
   station, the waist under the malleoli); the stations threading them
   together — the instep's rise, the toes' narrowing — are EST, the same
   spirit as the ribcage's THORAX_W or the head's own vault stations. */
for (const side of ['L', 'R']) {
  const f = rig.bones['foot.' + side];
  if (!f) continue;
  const fr = f.frame;
  const sgn = f.sign;
  const med = vmul(fr[1], sgn);           // toward the other foot
  const L = f.len;

  const hAnkle = m.lateralmalleolusheight;         // ankle height off the floor — measured
  const hb = CORE.foot * m.heelbreadth * 0.5;
  const bb = CORE.foot * m.footbreadthhorizontal * 0.5;
  const bm = m.bimalleolarbreadth * 0.5;
  const floor = -rig.figure.rootHeight;

  /* WHY EVERY STATION'S SEMI-AXIS IS STILL HALF ITS OWN TOP HEIGHT, EVEN
     THOUGH THE CONSTRAINT THAT ORIGINALLY FORCED IT IS GONE. A station
     centred at half its own target height, with a semi-axis of that same
     half, lands its bottom exactly on the floor (0) and its top exactly on
     the target — cheap, exact, and independent of whatever the target
     height actually is. That part of the construction never depended on
     the axis and still does not.

     What DID depend on the axis was how low the target could go. ringAt()
     samples this part from whatever axisAt() hands it, and until the
     registration at the end of this side's loop below, that was the
     DEFAULT: f.A + frame[0]*len*s, which runs at the ankle's own height for
     the foot's entire length, because the foot's frame[0] carries no
     height component at all. Move a station's target far enough below
     that fixed height and the ray-march's very first sample (radiusAlong's
     `f(lo)`, a fraction of a millimetre off the axis) comes back outside
     the solid, and the whole ring returns null — not a thinner foot, no
     foot at all at that station. A probe against this file's own first
     attempt confirmed it: pinning centres near the floor while the axis
     stayed up at ankle height collapsed the rendered range to a sliver
     behind the ankle and nothing forward of it. That is why every target
     below used to sit at 1.05-1.52x ankle height even at the toe tip — not
     a foot's real profile, the sampling ray's own ceiling.

     The registration below replaces that fixed axis with one that slopes
     from the ankle down toward the toes, so the targets below can finally
     taper the way a dorsum does: near ankle height at the instep, down to
     a 25-30mm toe box. They still have to clear THAT axis — checked by
     hand against the widest spread of ankle heights this generator
     produces (53-97mm across 300 seeds), several millimetres to spare at
     every station — and the render is the check that actually counts. */
  const at = (t, centreAboveFloor) => {
    const P = vmad(f.A, fr[0], t * L);
    return vmad(P, UP, (floor + centreAboveFloor) - P[0]);
  };

  // [fraction of footlength forward of the ankle, half-width, dorsal height
  // above the floor, exponent]
  const ST = [
    // The waist and its filler station are sized to roughly match the LEG
    // part's own bimalleolar-width bone capsule at the same 3D point (a
    // probe measured that capsule at ~82mm across, symmetric). The two
    // parts are still independently silhouetted, though (see this file's
    // header — parts do not share a field), and from dead-on the side the
    // tibia's round end and this wedge's own profile do not coincide
    // exactly: the traced outline shows a short jagged run right at the
    // seam where the nearer surface alternates between the two. Tried
    // narrower and wider waists and an extra filler station (still here);
    // none of it removed the crossing, only moved it, and going wider than
    // this started reading as a swollen ankle instead. Left as a diagnosed
    // rather than a fixed issue — a real fix likely means the leg part's
    // own end needs to taper toward this wedge's shape, which is 50-field's
    // bone capsule and the muscle layer's own tricepsSurae taper, not this
    // file's to rebuild.
    [-0.30, hb * 0.58, hAnkle * 1.30, 2.2],   // the heel, behind the ankle — calcaneus
    [-0.16, hb, hAnkle * 1.48, 2.3],          // the heel's own widest point — heelbreadth's station
    [0.00, bm * 0.94, hAnkle * 1.15, 2.2],    // the ankle waist; the malleoli ride on top of this
    [0.11, bb * 0.80, hAnkle * 1.08, 2.3],    // filling the gap the tibia's own round flare leaves
    [0.22, bb * 0.80, hAnkle * 1.00, 2.3],    // the instep — the true peak, near ankle height, then it slopes down
    [0.68, bb, hAnkle * 0.72, 2.6],           // the ball — footbreadthhorizontal's own station
    [0.85, bb * 0.56, Math.max(36, hAnkle * 0.46), 2.2],  // toes narrowing and dropping toward the tip
    [0.97, bb * 0.20, 29, 2.0],               // the toe tip — a 25-30mm toe box, rounding into the floor
  ];
  for (let i = 0; i < ST.length - 1; i++) {
    const s0 = ST[i], s1 = ST[i + 1];
    const az0 = s0[2] * 0.5, az1 = s1[2] * 0.5;
    const A = at(s0[0], az0), B = at(s1[0], az1);
    // Caps only at the two true ends of the chain, and small ones — every
    // interior join is overlapped by its neighbour, and a small cap there
    // shows as a bulge rather than a taper (the same reasoning 51-head.js's
    // vault stations use, carried over unchanged).
    const cap = i === 0 ? Math.min(s0[1], az0) * 0.80
      : i === ST.length - 2 ? Math.min(s1[1], az1) * 0.70 : undefined;
    const n = s0[3];
    // Every station above is built so centre-height equals its own
    // semi-axis, which already makes the sole meet the floor exactly
    // (see the comment above at()) — max()'d against the floor half-space
    // anyway, as a safety net rather than a load-bearing part of the
    // construction, and because max() distributes over min() cleanly (a
    // per-segment clamp composes the same as one clamp after the union).
    put('foot.' + side, (P, ff) => Math.max(
      sdSegSE(P, A, B, fr, s0[1], az0, s1[1], az1, n, cap, ff), floor - P[0]));
  }

  /* THE MEDIAL ARCH. Not a hollow carved into the sole — the sole is a
     floor clamp and stays flat by construction, and undercutting it would
     fight that directly. What a drawing needs is the silhouette cue: from
     the front the medial border rises and tucks in through the midfoot
     while the lateral border runs low and nearly straight to the ground.
     So this is a second, thin, additive ridge on the medial side only —
     the same technique 51-head.js uses for the brow and the cheekbone, not
     a new one — fading out at the heel and again at the ball, which is
     where a real arch's rise begins and ends. */
  {
    const archAy = bb * 0.16;                       // EST: a subtle ridge, not a bulge
    // Rescaled alongside the dorsum heights above, by the same amount —
    // this ridge is drawn relative to the base surface it rises from, and
    // that surface just dropped. Chosen to keep the ridge's rise ABOVE its
    // local base the same as before at the peak (AB), and to keep it
    // fading at-or-just-below the base at both ends (AA near the ankle,
    // AC near the ball) the same way it did before — the ratios matched by
    // hand against the old numbers, not rederived from anything measured.
    const AA = vmad(at(-0.02, hAnkle * 1.10), med, bm * 0.55);
    const AB = vmad(at(0.20, hAnkle * 1.15), med, bb * 0.72);
    const AC = vmad(at(0.50, hAnkle * 0.85), med, bb * 0.55);
    put('foot.' + side, (P, ff) => smin(
      sdSegSE(P, AA, AB, fr, archAy, archAy * 0.9, archAy * 1.15, archAy, 2.4, archAy * 0.7, ff),
      sdSegSE(P, AB, AC, fr, archAy * 1.15, archAy, archAy * 0.7, archAy * 0.6, 2.4, archAy * 0.5, ff),
      6));
  }

  /* THE FOOT'S OWN SAMPLING AXIS — the lift on the constraint the comment
     above the ST table describes. 50-field.js's axisAt() honours a
     part-supplied axis instead of walking the bone when one is registered;
     this is that registration, kept here beside the geometry it exists to
     serve rather than in 50-field.js, because only the foot's own build
     knows what its rings actually need to sweep around.

     One straight line per side: from the ankle (f.A, its own solved
     height) down to a point ~20mm above the floor at the toe end (s=1,
     the same forward fraction `at()` uses above). frame[0] runs along that
     line; frame[1] and frame[2] are frameAlong()'s own completion of it —
     lateral and sagittal-perpendicular, respectively, the same as the
     bone's own frame, just tipped by the slope.

     Unclamped on purpose. For s<0 — the heel, behind the ankle — the SAME
     line is simply extrapolated backward, which raises it a little rather
     than dropping it further, because going backward along a line that
     slopes down going forward means going up. That is not a special case
     bolted on for the heel: it falls out of using one line for the whole
     part, and it happens to land right — the heel stations above (left
     unchanged, at 1.30-1.48x ankle height) were already sized on a heel
     pad standing a little proud of the ankle, and the extrapolated axis
     stays under that with room to spare at every ankle height this
     generator produces.

     Takes `rig` as its own argument and reads rig.bones fresh from it on
     every call, rather than closing over this side's own `f` or `floor`
     from the loop above. TWEAKS (50-field.js) is ONE table shared by every
     figure a process ever builds — girthcheck.js alone solves two hundred
     of them in a single run — so a closure that captured one figure's
     ankle position would hand every other figure that same one. Reading
     `rig` fresh is what makes the registration safe to make once, here,
     rather than rebuild per figure. */
  GK.field.tweakPart('foot.' + side, {
    axis: (rig, s) => {
      const bf = rig.bones['foot.' + side];
      if (!bf) return null;
      const fl = -rig.figure.rootHeight;
      const A = bf.A;
      const toe = vmad(bf.A, bf.frame[0], bf.len);
      const B = vmad(toe, UP, (fl + 20) - toe[0]);
      return { C: M.vlerp(A, B, s), fr: frameAlong(A, B, [0, 1, 0]) };
    },
  });
}

// ---- the malleoli ------------------------------------------------------
/* Two ankle bones, not one flare. The tibia's own bone capsule (50-field.js,
   BONE_ENDS/BONE_FLARE) already swells the LEG part's distal end to
   bimalleolar breadth, and that is a fair account of the shaft — but it is
   a circle, and a circle cannot sit lower on one side than the other. There
   is no fibula modelled as its own bone here, so the lateral malleolus has
   no bone under it at all unless something is added, and neither malleolus
   is asymmetric until something says so.

   The asymmetry is real and small in the survey's own terms. The model's
   ankle height is already calibrated to the LATERAL malleolus specifically
   (00-anthro.js's own note: "very nearly true for the lateral malleolus"),
   so the lateral bump needs no correction at all — it sits at the height
   the whole ankle is already built to. The medial one sits ABOVE it. EST
   for how much: 11mm, the typical 10-15mm a tibial malleolus stands proud
   of the fibular one on a live ankle — no tape in this survey reaches it,
   only the fact that it is the medial one that is higher is not in doubt. */
for (const side of ['L', 'R']) {
  const f = rig.bones['foot.' + side];
  if (!f) continue;
  const fr = f.frame, sgn = f.sign;
  const med = vmul(fr[1], sgn);
  const bm = m.bimalleolarbreadth * 0.5;
  const ankleC = f.A;

  // lateral (fibular): the model's own calibrated ankle height, uncorrected
  // — and a touch posterior, since the fibula trails the tibia at the ankle
  const latC = vmad(vmad(ankleC, fr[0], -0.03 * f.len), med, -bm * 0.84);
  put('foot.' + side, (P, ff) => sdBlobSE(P, latC, fr,
    bm * 0.28, bm * 0.20, bm * 0.30, 2.2, ff));

  // medial (tibial): higher and a touch anterior, and slightly the larger
  // of the two — the tibial malleolus is the more prominent to the eye
  const medC = vmad(vmad(vmad(ankleC, fr[0], 0.02 * f.len), med, bm * 0.82), UP, 11);
  put('foot.' + side, (P, ff) => sdBlobSE(P, medC, fr,
    bm * 0.30, bm * 0.23, bm * 0.32, 2.2, ff));
}

// ---- the Achilles tendon ------------------------------------------------
/* A narrow vertical form from calf to heel, built across TWO parts — the
   leg's own field ends at the ankle and the foot's begins there, and the
   tendon does not respect that seam any more than the real one respects
   the joint capsule. So it is one line, split into two put() calls that
   meet exactly at the ankle: the upper half on 'leg', the lower half on
   'foot'.

   Anchored throughout to the TIBIA's own frame, including on the foot
   half — a frame belongs to a bone, not to whichever part happens to be
   asking for it, and the tibia's posterior is a well-defined direction
   whether the thing being built is scoped to 'leg' or to 'foot'.

   Widths are EST fractions of bimalleolar breadth: narrowest a little
   above the malleoli — the tendon proper — widening both up into the
   calf's own myotendinous junction and down into its footprint on the
   calcaneus. tendonLen (where that junction sits) is EST against the
   tibia's own measured length: a real Achilles is roughly a third of a
   shank long, and nothing in this survey measures it directly. */
for (const side of ['L', 'R']) {
  const ti = rig.bones['tibia.' + side], f = rig.bones['foot.' + side];
  if (!ti || !f) continue;
  const post = vmul(ti.frame[2], -1);
  const tibiaLen = fig.len.tibia || ti.len;
  const tendonLen = tibiaLen * 0.36;                  // EST
  const w0 = m.bimalleolarbreadth * 0.145;            // the myotendinous junction
  const w1 = m.bimalleolarbreadth * 0.105;            // the tendon's own narrowest point
  const w2 = m.bimalleolarbreadth * 0.170;            // its footprint on the calcaneus

  const topPt = vmad(vmad(ti.B, ti.frame[0], -tendonLen), post, w0 * 0.45);
  const narrowPt = vmad(ti.B, post, w1 * 1.05);
  put('leg.' + side, (P, ff) => sdSegSE(P, topPt, narrowPt, ti.frame,
    w0, w0 * 0.80, w1, w1 * 0.80, 2.3, undefined, ff));

  const heelIns = vmad(vmad(f.A, f.frame[0], -0.19 * f.len), UP, -m.lateralmalleolusheight * 0.20);
  put('foot.' + side, (P, ff) => sdSegSE(P, narrowPt, heelIns, ti.frame,
    w1, w1 * 0.80, w2, w2 * 0.90, 2.3, undefined, ff));

  /* THE HOLLOWS EITHER SIDE, TRIED AND DROPPED. A pair of shallow cuts
     flanking the cord read fine on the leg part alone, but the leg and
     foot are two independently-traced silhouettes meeting at this exact
     seam (see this file's header — parts do not share a field), and the
     cuts were enough to pull the leg's own edge away from the foot's at
     the join: the two outlines crossed instead of meeting, and what
     should have read as a tendon read as a stray notch. The raised cord
     survives without them; the grooves do not, and are reported rather
     than forced. */
}

// ---- the knee -----------------------------------------------------------
/* A patella is a rounded boss on the front, not a general swelling of the
   whole joint — concentrating the projection there, rather than spreading
   it around the joint the way the bone capsule's own circular flare does,
   is most of what stops the knee reading as one lump. Behind, standing,
   this section adds nothing at all: the popliteal fossa is flat until the
   knee bends, and the calf's own belly (45-muscle.js's tricepsSurae)
   already starts below the joint line, so the honest way to keep the back
   of a standing knee flat is to not put anything there rather than to
   carve something out.

   No ANSUR measurement reaches a patella — there is no knee breadth or
   depth in this survey, only the height its own landmark sits at — so
   every size below is EST, anchored to the tibia's own measured length. */
for (const side of ['L', 'R']) {
  const fe = rig.bones['femur.' + side], ti = rig.bones['tibia.' + side];
  if (!fe || !ti) continue;
  const kneeC = fe.B;                       // == ti.A, the joint centre, at measured knee height
  const ant = fe.frame[2];                  // anterior; needs no side correction
  const tibiaLen = fig.len.tibia || ti.len;

  const ph = tibiaLen * 0.095;              // half-height, proximal-distal
  const pw = tibiaLen * 0.115;              // half-width, medial-lateral
  const pd = tibiaLen * 0.062;              // how far it stands off the joint

  // centred mostly ABOVE the joint line, which is where a real patella
  // sits — it rides on the femur, not the tibia, through full extension
  const pc = vmad(vmad(kneeC, fe.frame[0], ph * 0.62), ant, pd * 0.88);
  put('leg.' + side, (P, ff) => sdBlobSE(P, pc, fe.frame, ph, pw, pd, 2.5, ff));
}

// ---- the elbow ------------------------------------------------------------
/* The olecranon: a point at the back of the joint when the arm is near
   full extension, carried on the FOREARM's own frame rather than the
   humerus's — it is the proximal tip of the ulna, so it rotates WITH the
   forearm as the elbow bends. Anchoring it to the humerus instead would
   have kept it "behind the humerus" through a bend rather than "behind the
   elbow", which is not the same place once the joint moves.

   No elbow measurement exists in this survey — ANSUR reaches the wrist and
   the radiale, not the joint between them — so the size is EST against the
   forearm's own measured length. */
for (const side of ['L', 'R']) {
  const fa = rig.bones['forearm.' + side];
  if (!fa) continue;
  const post = vmul(fa.frame[2], -1);
  const forearmLen = fig.len.forearm || fa.len;

  const oh = forearmLen * 0.095;
  const ow = forearmLen * 0.072;
  const od = forearmLen * 0.068;
  const oc = vmad(vmad(fa.A, fa.frame[0], oh * 0.30), post, od * 0.85);
  put('arm.' + side, (P, ff) => sdBlobSE(P, oc, fa.frame, oh, ow, od, 2.3, ff));
}

// ---- the wrist ------------------------------------------------------------
/* Two styloid bumps, and a flattening. A wrist is wide across the styloids
   and thin front-to-back, where the mid-forearm is closer to round, and
   the difference is real: the tendons crossing the wrist ride close under
   the skin over a flat carpus, where the forearm's own belly is muscle
   over a roughly round pair of shafts.

   sdSegSE cannot narrow a cross-section by itself, and neither can
   anything else in this file: every put() only ever ADDS to a part's
   field (volumeField takes the union of its solids — see 50-field.js's own
   header on why the soft layer is grown rather than subtracted), so the
   round mid-forearm cannot be carved thinner from here. What this CAN do
   is add width at the styloids without adding matching depth, which pushes
   the ratio the right way even though the depth itself never shrinks —
   the flattening band below is exactly that, and no more than that. If the
   forearm needs to actually narrow front-to-back approaching the wrist,
   that is a cut this file does not have a part-safe way to make and is
   reported here rather than forced. */
for (const side of ['L', 'R']) {
  const fa = rig.bones['forearm.' + side];
  if (!fa) continue;
  const sgn = fa.sign;
  const med = vmul(fa.frame[1], sgn);
  const forearmLen = fig.len.forearm || fa.len;

  // ulnar styloid: medial, and a little proximal of the radial one
  const uc = vmad(vmad(fa.B, med, forearmLen * 0.062), fa.frame[0], forearmLen * 0.018);
  put('arm.' + side, (P, ff) => sdBlobSE(P, uc, fa.frame,
    forearmLen * 0.045, forearmLen * 0.040, forearmLen * 0.042, 2.2, ff));
  // radial styloid: lateral, and the more distal of the two
  const rc = vmad(vmad(fa.B, med, -forearmLen * 0.070), fa.frame[0], -forearmLen * 0.010);
  put('arm.' + side, (P, ff) => sdBlobSE(P, rc, fa.frame,
    forearmLen * 0.048, forearmLen * 0.044, forearmLen * 0.044, 2.2, ff));

  // the flattening band: wide in frame[1], reaching toward the styloids;
  // thin in frame[2]; fading to roughly round by mid-forearm
  const bandProx = vmad(fa.B, fa.frame[0], -forearmLen * 0.24);
  const ay0 = forearmLen * 0.058, az0 = forearmLen * 0.058;
  const ay1 = forearmLen * 0.100, az1 = forearmLen * 0.040;
  put('arm.' + side, (P, ff) => sdSegSE(P, bandProx, fa.B, fa.frame,
    ay0, az0, ay1, az1, 2.6, undefined, ff));
}

  });
})(window.GK = window.GK || {});
