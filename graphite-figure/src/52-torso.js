/* ============================================================================
   GRAPHITE FIGURE — src/52-torso.js
   The trunk's surface anatomy: everything the ribcage, abdomen and pelvis
   blocks in 50-field.js do not say. Neck straps, the shoulder's slope, the
   chest plane, the back's ridges and furrow, the crest of the pelvis, the
   navel, and the gluteal fold — worked in that order, worst-first, off the
   review sheet.

   Registered into the field's volume build so the torso can be worked
   without the head or the limbs moving underneath it.

   A HOUSE RULE THAT COST AN AFTERNOON, WRITTEN DOWN SO IT IS NOT RELEARNED.
   volumeField() unions every solid on this list with a plain min(), not a
   smin() — the smoothing only happens once, afterward, between the whole
   trunk volume and the bones and muscles. So two of THIS file's own solids
   meeting head-on can still crease, and — the sharper trap — a thin ridge
   with a shallow base cross-section is not thin once radiusAlong() adds the
   region's soft-tissue term to it: `f` runs 25-40mm across the neck-to-chest
   band, so an 8-17mm base radius comes out 3-5x its authored size. A ridge
   whose long axis runs nearly LATERAL (small height change over a long
   sideways reach) then reads, at any single height, as a thick tilted slab:
   slice it horizontally and the slice is nearly its whole length at once,
   not a sliver that grows with height. That is what "coat-hanger" turned
   out to mean in field terms, and it is the reasoning every ridge below was
   checked against — steep runs taper gracefully under fat, shallow ones
   don't, and the fix is never a smaller base radius, because fat swallows
   that either way. See the trapezius section for the probe that found it.
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;
  const { vadd, vsub, vmul, vmad, vnorm, lerp, clamp01 } = M;
  // World-axis frame, for the handful of cuts and pads anchored directly to
  // [height, lateral, anterior] points rather than to a bone's own frame.
  const ID = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  /* WHY THE TRUNK'S OWN BONE SCOPE DROPS CLAVICLE AND SCAPULA.
     Probed directly — sampling the TRUNK part's own widest ring, exactly
     the way tools/proportions.js's "shoulders" check does, then asking
     which of that ring's own contributors (50-field.js's boneField vs this
     file's own volumeField) was actually closest to zero AT that point —
     the trunk's widest point across four sample bodies was never one of
     this file's own shoulder features. It was the SCAPULA bone capsule
     (50-field.js's BONE_R.scapula, a flat 30% of the scapula's own length,
     no taper) sitting on the acromion, wrapped in the region's ordinary
     soft-tissue term: on a 1750mm figure, a 22mm capsule plus 38mm of
     regional fat put the trunk's own corner 60mm past the acromion before
     this file's trapezius or scapular-spine ropes got a vote, and — the
     part that makes it a bug rather than a coincidence — neither number
     has anything to do with bideltoid breadth. Both scale with this body's
     overall SIZE and FAT, which is why the very same mechanism landed
     within band on two of the four sampled bodies and missed by 12-17% on
     the other two: it is answering "how big is this body", not "how far
     does this body's deltoid reach past its own acromion", and those two
     questions only happen to agree by coincidence.

     The clavicle capsule alone, underneath the scapula's, is smaller but
     still not small enough to leave room for a body whose gap is genuinely
     narrow — 16.5mm of bone plus 38mm of the SAME unrelated regional fat
     is 54.5mm on that same figure, against a measured gap of 26mm. Since a
     smooth union can only ever bulge OUTWARD (smin's own floor is
     min(a,b), never more), no amount of resizing this file's OWN volumes
     can pull the corner back IN while either bone capsule still reaches
     further — addition alone can fix the two bodies this rebuilt corner
     undershoots, never the one it overshoots. BONE_R and the fat table
     that feeds both capsules are 50-field.js's shared constants, used by
     other parts (BONE_R.scapula by the arm too), so they are not this
     file's numbers to retune.

     What IS this file's to decide is which bones the TRUNK part's own
     field is built from — tweakPart is the sanctioned way to do that from
     outside 50-field.js (51-head.js and 53-limbs.js already do exactly
     this for other parts) without touching that file's shared tables at
     all. Dropping clavicle and scapula from the trunk's OWN bone scope
     costs it nothing visible: both bones stay exactly where they were for
     posing and for every anchor below that reads their positions (Acr is
     still `clavicle.B`), and the arm part keeps its own, separate copy of
     the scapula (50-field.js's own `limbKeep` for 'arm') untouched. All it
     removes is two capsules that were never the trunk's own documented
     shoulder shape to begin with — they were filling in, uncontrolled,
     for a corner this file now sizes on purpose, directly against the one
     measurement that names the gap: bideltoid breadth. See the trapezius
     and scapular-spine sections below for where that measurement goes in. */
  GK.field.tweakPart('trunk', { keep: (id) => /^(pelvis|[LTC]\d+)$/.test(id) });

  GK.field.registerVolumes('torso', (ctx) => {
    const { rig, fig, m, g, put, vertR, smin, smax, sdSegSE, sdBlobSE,
      frameAlong, exponentFor, CORE } = ctx;
/* THE STERNOCLEIDOMASTOID, which is what makes a neck a neck.
   Everything else in this file builds the neck as a tapered tube on the
   cervical spine, and a tube is what it drew: correct in circumference,
   correct in taper, and unmistakably a length of pipe with a head on it.
   A real neck is not smooth. Two straps run from behind each ear forward
   and down to the notch between the collar bones, and the hollow they
   make between them at the front, and the flat plane they leave behind
   them, are most of what a neck's surface IS.

   Both ends are anchored to measured landmarks: the upper to the skull's
   own frame just behind and below the ear, the lower to suprasternale
   height, which ANSUR measures. The thickness is EST.

   Left alone by the pass that fixed the trapezius below: this segment runs
   mostly DOWN (175mm of drop against a 45mm lateral shift), so the
   plank-under-fat failure that ate the shoulder line does not apply to it —
   a steep ridge slices into a thin sliver at any one height by construction.
   What it still lacked was a hollow for its own two heads to converge INTO;
   that is the suprasternal notch immediately below, added rather than
   pulling the straps closer, because the straps were already reading as a
   V and the notch was what was missing at its point.

   THAT "STEEP RIDGE" CLAIM WAS TRUE AND STILL LET 21 OF 200 SEEDS THROUGH
   OVER THE TAPE. The mid-neck girth site (50-field.js SITES, `girth:
   'neck'`) samples midway between the measured C7 station and the top of
   the cervical chain; probed at that same station with soft tissue pinned
   at f=0 (radiusAlong's own `fat` opt, so this is exactly what fitFat
   measures before it adds anything), the BARE ring came out over the tape
   on 14 of 200 seeds outright and left fitFat unable to converge within
   0.5% on 21 (tools/girthcheck.js 200, "trunk @ neck"; worst seed 141 at
   +5.5%, seed 21 at +5.2%, 11 of the 21 clamped at exactly zero fat). A
   bare neck should sit a few PERCENT under the tape on essentially every
   body — subcutaneous fat here is a few millimetres, not a few percent of
   the circumference — and it already did on the other 179.

   ATTRIBUTED by disabling candidate volumes in a scratch copy and
   re-measuring the same station the site does. Bones plus 50-field.js's
   own core neck tube (deliberately 0.72 of measured circumference, to
   leave room for fat) sit 24-25% UNDER the tape on every seed tried,
   failing or passing alike — never the cause. The trapezius below never
   reaches this station at all: its own near end sits AT C7 height and runs
   further DOWN from there to the shoulder, and disabling it changed the
   ring by nothing, to a tenth of a millimetre, on every seed checked
   (21, 6, 41, 1, 12345). What's left is this pair, and it is the entire
   excess: on seed 21, bones-plus-core alone measures 267.8mm against a
   358.9mm tape; adding just these two straps back puts it at 377.7mm — all
   110mm of the gap from two ropes the comment above calls "~17mm across."

   THE WIDTH WAS NEVER THE PROBLEM. `w` below already tracks
   fig.girth.neck 1:1, which is fair — a wider-necked body earns a wider
   strap. What doesn't track it is where the two ends SIT: the mastoid end
   off head measurements (mentonsellionlength, headbreadth, headlength),
   the notch end off suprasternaleheight and biacromialbreadth, neither
   pair growing in step with neck circumference across the population. On
   the worst seeds the mid-neck ring sits only 6-15mm below the mastoid —
   barely down from the strap's still near-full-width top end, instead of
   well below it where the taper has had room to work. Checked over a
   200-seed sample: how far the mastoid sits above THIS body's own measured
   neck base (cervicaleheight, i.e. C7 — `neckRun` below) scaled by neck
   circumference and divided by headbreadth correlates -0.85 with the bare
   ring's own error, well past headbreadth/neckcircumference alone (0.62)
   or neckRun alone (-0.61): the failure is a body whose head-anchored
   strap has too little of ITS OWN neck to taper through before the ring,
   not simply a wide head or a short neck in isolation.

   FIXED by scaling the strap's width by that ratio against a reference,
   floored so it never disappears (the V still has to read) and ceilinged
   at 1 so an ordinarily-proportioned body's strap is exactly what it was —
   a resize against a measured ratio, the survey's own statement of this
   body's neck relative to what already anchors the strap, not a smaller
   version of the 0.055 constant, which would have thinned every body's
   strap by the same fraction and done nothing for the ones whose
   PROPORTIONS, not their overall size, put them over the tape. Calibrated
   against tools/girthcheck.js 200: a reference of 175 cleared the bare
   ring everywhere but left 8 seeds still failing after fitFat solved a
   nonzero thickness for them — margin enough to stop the clamp, too thin
   for the solver to land inside 0.5% before its own iteration budget ran
   out, because the ring's nearest contributor switches between the core
   tube and this pair as f grows and the girth-vs-fat curve it rides is not
   as smooth as the solver assumes. 220, floored at 0.5, is the smallest
   reference tried that brought the residual down to 2 (seeds 21 and 141,
   both within 5% and neither clamped nor capped) while holding the neck's
   own solved-fat mean at 4.8mm — up from 3.3mm now that the solve has room
   to use, still inside the 2-6mm a real neck's subcutaneous layer runs.
   Pushing the floor lower (0.35) did not improve seed 21 further; it made
   it worse (3.0% against 1.5%), which is the same non-smooth curve talking
   and not a sign that less strap is always safer. */
{
  const sk = rig.bones.skull;
  if (sk) {
    const fr = sk.frame;
    const cy = m.headbreadth * 0.5, cz = m.headlength * 0.5;
    const notchH = m.suprasternaleheight - fig.rootHeight;
    const notchZ = m.chestdepth * 0.30;
    // The mastoid's own height, independent of side (the lateral offset
    // below doesn't move it materially) — how far above THIS body's own
    // measured neck base the strap's upper end sits. See the section
    // comment above for what this feeds and why.
    const mastoidH = vmad(vmad(sk.A, fr[0], -m.mentonsellionlength * 0.22), fr[2], -cz * 0.24)[0];
    const neckRun = Math.max(30, mastoidH - (m.cervicaleheight - fig.rootHeight));
    const scmSafety = neckRun * m.neckcircumference / m.headbreadth;
    const SCM_SAFE_REF = 220, SCM_SAFE_FLOOR = 0.5;   // EST: see the probe above
    const scmK = Math.min(1, Math.max(SCM_SAFE_FLOOR, scmSafety / SCM_SAFE_REF));
    for (const sgn of [1, -1]) {
      // the mastoid, behind and below the ear
      const A = vmad(vmad(vmad(sk.A, fr[0], -m.mentonsellionlength * 0.22),
        fr[2], -cz * 0.24), fr[1], sgn * cy * 0.66);
      // and the notch, where the two of them nearly meet
      const B = [notchH, sgn * m.biacromialbreadth * 0.055, notchZ];
      const F = frameAlong(A, B, [1, 0, 0]);
      // EST: a strap ~17mm across at scmK=1 (an ordinarily-proportioned
      // body); scaled down toward SCM_SAFE_FLOOR only on the bodies whose
      // head-to-neck proportions put the bare ring over the tape.
      const w = m.neckcircumference * 0.055 * scmK;
      put('trunk', (P, f) => sdSegSE(P, A, B, F,
        w * 0.9, w * 0.75, w * 1.25, w * 0.85, 2.1, w * 0.7, f));
    }
  }
}

/* THE SUPRASTERNAL NOTCH: the small hollow at the top of the sternum, right
   where the two SCM straps above nearly meet. ANSUR does not measure it —
   nothing surveys a dimple — so its size is EST, anchored to suprasternale
   height, which IS measured, and centred on the midline between the straps.

   A CUT HAS TO SIT ON THE SKIN, NOT GUESS AT IT, AND A GUESS BUILT FROM
   waistdepth/chestdepth alone IS TOO SHALLOW TO TRUST. Both this cut and the
   navel below were first built the way the head's eye sockets are — cutter
   mostly in front of the skin, only its posterior cap biting — using
   `chestdepth * 0.30` as the stand-in for "where the skin is." That number
   is the MEASURED, unfattened half-depth; the true skin is that plus this
   region's soft-tissue term, which is solved per body and is NOT available
   here — volumeField() calls every cut's sdf with f FIXED AT ZERO, on
   purpose, so a cut stays a fixed landmark rather than one that swells with
   the fat solve. Built at 0.30 the cutter's own centre came out around
   70-90mm off the sternum on a 1623mm figure, against a probed true skin
   position of 95 to 190mm across a 60-body sample — the cutter was 20 to
   100mm shy of the skin, and radiusAlong()'s march-then-bisect (50-field.js)
   stops at the FIRST place the field goes positive, so it read the cutter's
   own near face as the body's outline: a puncture straight into the ribcage
   on ordinary bodies, not a shallow scoop, and it showed up as chest girth
   overshooting by double digits on some seeds.

   Fixed by anchoring to something that already tracks the fat solve without
   needing to read it: chest CIRCUMFERENCE, fixed per body before fitFat()
   ever runs, rather than chest depth. Probed the same 60-body sample for
   where the true skin sits as a fraction of it — 0.104 to 0.154, never
   lower — and this uses 0.095, under the observed floor on purpose so a
   body outside the sample still lands the cutter short of the skin rather
   than past it. Short means the notch reads shallower on some builds and
   the cutter floats clear of the skin doing nothing on a few; that failure
   is invisible. Long means a puncture; that failure is a hole in the chest.
   Not a symmetric trade. */
{
  const notchH = m.suprasternaleheight - fig.rootHeight;
  const az = 8;                                    // EST: a few mm of actual bite
  const nearEdge = g.chest * 0.095;                 // EST floor, under the probed 0.104-0.154
  const C = [notchH, 0, nearEdge + az];
  put('trunk', (P) => sdBlobSE(P, C, ID, 7, 8, az, 2.2), true);
}

/* THE TRAPEZIUS, as the slope a shoulder hangs from — and the review
   sheet's worst item, "a coat-hanger with epaulette steps."

   THE FIRST VERSION, AND WHY IT COAT-HANGERED. One straight segment from
   T1 (on the spine, y=0) out to the acromion, sized down hard after an
   earlier review caught it drawing a linebacker's hump. Sizing it down
   did not fix this failure, because this failure was never about size.
   Probed directly — sampling the field's own half-width at the shoulder
   height, station by station — the silhouette went 85mm, 85mm, 211mm
   across a five-millimetre change in height, a cliff, not a slope. What
   was happening: that segment ran 178mm sideways for only 46mm of drop
   (14 degrees off horizontal), and radiusAlong() adds this region's fat —
   25 to 30mm here — to BOTH of a ridge's cross-sectional semi-axes before
   anything else happens. A ridge lying nearly flat, fattened till its own
   cross-section is comparable to its whole height range, sliced by a
   horizontal plane at any one height, gives back nearly its FULL sideways
   length at once — not a sliver that grows as the slice moves down. That
   is the cliff, and it is also, read the other way, most of why the neck
   looked buried: the plank's top edge sat at T1's own height, 35mm below
   the chin, already at close to full shoulder width.

   Shrinking the base radius further would not have helped — the fat term
   dominates a thin ridge's cross-section regardless of what the base was,
   so a thinner ridge coat-hangers on schedule, just a little later. The
   only lever that changes the SLOPE ANGLE is where the two ends sit, and
   the two true ends (near the neck, at the acromion) are fixed by anatomy.
   So: two shorter segments instead of one long one, bent at a shoulder
   point, the way a real trapezius reads — steep off the neck, flattening
   as it nears the ball of the shoulder. The medial end also moved OFF the
   spine to the neck's own flank, just outside the 14%-thickened base the
   neck tube already carries at C7/C6 (50-field.js) — there is no reason to
   re-cover ground the neck tube already covers, and starting there instead
   of at the midline roughly halves the lateral distance being bridged.

   Checked the same way it was broken: the same height-sampling probe now
   shows a monotone climb from the neck's own width up to shoulder width,
   nowhere more than about 20mm of jump between five-millimetre steps. */
/* THE ACROMIAL TIP, AND WHY IT CARRIES BIDELTOID BREADTH DIRECTLY.
   Everything above closes this rope exactly on the acromion, which is
   right for a BONE landmark — but tools/proportions.js's own "shoulders"
   check does not measure a bone landmark, it measures the widest point of
   this PART, anywhere along it, against bideltoidbreadth: a tape run
   outboard of both deltoids. 45-muscle.js's own deltoid group is what that
   tape actually measures, and it is deliberately scoped OFF the trunk
   entirely (see its own comment on 'touches': putting a shoulder-belly
   into the TRUNK's field is what welded the chest-girth ring to the far
   side of it and made chest circumference non-monotone in soft-tissue
   thickness — not a mistake to repeat here). So the trunk's own corner has
   to carry bideltoid breadth's information some other way, and the only
   candidate already sitting at the right point is this rope's own
   acromial tip.

   Measured directly: half of (bideltoidbreadth - biacromialbreadth) is
   exactly how many millimetres of tissue sit outboard of the acromion on
   THIS body — not an estimate, the two are both ANSUR fields already in
   `m`. Sized against it here, at the one end (t=1) where this segment
   already terminates on the acromion, leaving the Sh end above untouched
   (still tj-scaled, still fully fleshed by the region's own soft-tissue
   term) so the slope's own look near the neck does not change.

   WHY THIS IS FAT-INDEPENDENT, AND WHY THAT TAKES NO SUBTRACTION. Before
   this, the acromial tip's width was `tj * 0.85` PLUS whatever the
   region's solved soft-tissue term added on top — and that second term is
   sized against chest/waist/hip adiposity, which has nothing to do with
   how far a deltoid bulges past its own acromion. Probed across a sample:
   two bodies with nearly identical deltoid gaps came out 30mm+ apart in
   drawn shoulder width purely because one carried more trunk fat, and —
   the sharper failure — the body with the SMALLEST measured gap (narrowest
   shoulders relative to its own frame) was overshooting the loudest,
   because it was also the biggest-framed, highest-fat body of the sample,
   and fat was doing the deciding instead of the gap.

   The fix is not to cancel `f` against the cap — sdSegSE never adds it in
   the first place. Read its own cap line (50-field.js): `const aw = cap
   === undefined ? Math.min(ay, az) : cap`, where ay/az (=cy+f/cz+f) are
   what `f` feeds. That ternary is the whole mechanism: `f` reaches the
   axial cap ONLY on the undefined branch, the ordinary blunt-taper case
   every other sdSegSE call in this file uses. Pass a cap explicitly, as
   here, and `f` never touches it — not because it was subtracted back out,
   but because that branch is never taken. An EARLIER version of this
   comment claimed the opposite (`f` "cancelled" here and "added straight
   back on" by sdSegSE) and shipped `deltGap * DELT_KW - f` on the strength
   of that claim, which is simply false against the code above; the
   subtraction it justified made the reach SHRINK as `f` grew — 25-40mm
   across this region — and hit the floor on exactly the highest-fat
   bodies, losing the measured-gap information on the very seeds this fix
   was for. Passing the cap explicitly already gives fat-independence for
   free; `deltGap * DELT_KW` alone is the whole cap, at any body fatness,
   and the fascia blend with the still-fleshed Sh end 46mm away keeps the
   tip from reading as a bare knuckle. The floor is the ORIGINAL tj-based
   size, so a body with a small gap never goes narrower than the rope
   already was. */
const deltGap = Math.max(0, (m.bideltoidbreadth - m.biacromialbreadth) * 0.5);
/* EST fraction of the measured gap this cap reaches for. Solved the way
   TEMPLE_K and EAR_K were (51-head.js) — against tools/proportions.js's
   "shoulders / bideltoid" row across seeds 1-30, not derived: the cap's own
   value and the ring's actual lateral reach are related by the smin blend
   and the segment's axis (not quite 100% lateral — see the F2 comment
   above), so there is no closed form from "fraction of the gap" to "mm the
   silhouette moves" to solve directly.

   0.90, tried first on the reasoning that "90% of the gap" is a plausible
   physical fraction, undershot the 0.96 floor on five of thirty seeds
   (3, 16, 22, 27, 28) even though the cap-to-reach relation is short of
   1:1 (see below), so the cap needed to reach past the raw gap, not stop
   short of it. 1.0 already clears three of those five (16, 22, 27); seed
   28 needed 1.15 to get close (0.959) and 1.20 to actually clear. 1.20 is
   the smallest value tested that clears every seed but 3 without pushing
   any ratio past 1.05 (ceiling is 1.12) or adding a new failure to
   "shoulders / drawn head W" beyond the set 1.15 already had.

   SEED 3'S FAILURE WAS NEVER THIS DIAL'S, AND ITS FIRST EXPLANATION HERE
   WAS WRONG TWICE — kept as a record because both wrong answers were
   plausible enough to ship. First blamed: the hip ("this body's widest
   trunk point is its correctly-drawn pelvis") — true numbers, stale
   conclusion, because the proportions critic then began measuring
   shoulders at shoulder level and the ratio DROPPED to 0.878: the hip had
   been propping the reading up, not holding it back. Then blamed: the
   drawn acromion — refuted to ten significant figures, since aimTo makes
   the clavicle's far end EQUAL half of measured biacromial breadth by
   construction, every seed. The real cause was the trunk part's ANGULAR
   SAMPLING: this body has the smallest biacromial of its cohort, its
   acromial tip is the narrowest feature in angle as seen from the spine,
   and the then-12-degree ring grid straddled a true 204mm peak with rays
   reading 157mm and 64mm either side. Sampled finely, this seed's ratio
   is 1.035 and the whole population clusters 1.031-1.038 — meaning the
   1.20 below is well-tuned for the CONTINUOUS geometry, and needed no
   change when the grid was refined (50-field.js, the trunk's na). A dial
   should not be turned to compensate a sampler. */
const DELT_KW = 1.20;
for (const side of ['L', 'R']) {
  const sgn = side === 'L' ? 1 : -1;
  const c7 = rig.bones.C7, cl = rig.bones['clavicle.' + side];
  if (!c7 || !cl) continue;
  // EST circle-equivalent neck radius, at the same 14% base-of-neck
  // thickening the neck tube itself carries at C7/C6 — so this starts
  // just outside skin the neck already owns, not inside it and not
  // stranded past it.
  const neckR = (m.neckcircumference / (2 * Math.PI)) * 1.14;
  const N = [c7.A[0], sgn * neckR * 1.08, c7.A[2] - 8];
  const Acr = cl.B;                                // the acromion, measured
  // the shoulder point: bent so the FIRST leg carries most of the height
  // drop over less than half the lateral distance (steep, off the neck)
  // and the second carries the rest over the remaining reach (shallow,
  // into the acromion, where the deltoid takes over anyway)
  const Sh = [lerp(N[0], Acr[0], 0.70), lerp(N[1], Acr[1], 0.42), lerp(N[2], Acr[2], 0.50)];
  const tj = m.biacromialbreadth * 0.024;          // EST: a slim rope, not a pad
  const F1 = frameAlong(N, Sh, [1, 0, 0]);
  put('trunk', (P, f) => sdSegSE(P, N, Sh, F1,
    tj * 1.0, tj * 0.7, tj * 1.3, tj * 0.9, 2.3, undefined, f));
  const F2 = frameAlong(Sh, Acr, [1, 0, 0]);
  /* The lateral reach beyond Acr does NOT come from a1/b1 here — this leg
     runs "shallow, into the acromion" (see the comment above), which in
     frame terms means F2's own AXIS (frameAlong's fr[0]) is already almost
     entirely lateral (measured: 90-98% of it is world Y across a sample of
     bodies), so the plane PERPENDICULAR to that axis — the one a1/b1 size
     — is close to the height/depth plane and barely touches lateral reach
     at all. What extends past Acr laterally is the ROUNDED END CAP: with
     `cap` left undefined elsewhere in this file it defaults to
     min(a1,b1), which is what every other use of sdSegSE wants (a blunt
     taper), but here it is the one dial that is actually aimed down this
     segment's own (near-lateral) axis, so it is the one sized against the
     measured gap — see the acromial-tip comment above. */
  put('trunk', (P, f) => sdSegSE(P, Sh, Acr, F2,
    tj * 1.3, tj * 0.9, tj * 0.85, tj * 0.75, 2.3,
    Math.max(tj * 0.7, deltGap * DELT_KW), f));
}

/* THE PECTORAL PLANE. The lower pec border is one of the strongest lines a
   male torso has, and the double-count warning is sharpest right here:
   ANSUR's chest circumference already went over the pectorals, so this is
   a SHAPE correction — moving mass from a generic round cross-section to
   an anterior plane — and not a volume to be added on top. Kept flat and
   thin on purpose, both for that reason and because the region's own fat
   (~40mm, the largest anywhere on the trunk) will do most of the work
   regardless of how this is sized, exactly as the trapezius above found.

   Run from the sternum to just short of the anterior axillary fold, and
   tilted UP as it goes lateral — sternum anchor below axilla height,
   outer end approaching it — rather than flat, so the mass concentrates
   toward the armpit the way a real pec does instead of reading as a bar
   the width of the chest. "Ending ~nipple line" is chest height itself:
   ANSUR takes chest circumference at that height because it IS
   approximately bust point on a standing man, so the measured landmark
   already is the anchor the review sheet asked for. */
for (const sgn of [1, -1]) {
  const hA = lerp(m.suprasternaleheight, m.chestheight, 0.62) - fig.rootHeight;
  const hB = lerp(m.chestheight, m.axillaheight, 0.35) - fig.rootHeight;
  const A = [hA, sgn * m.chestbreadth * 0.13, m.chestdepth * 0.40];
  const B = [hB, sgn * m.chestbreadth * 0.44, m.chestdepth * 0.32];
  const F = frameAlong(A, B, [1, 0, 0]);
  const t = m.chestbreadth * 0.019;                // EST: shallow, thickening laterally below.
  // Sized twice. The first pass (0.034, reaching to 0.64 of chest breadth)
  // read fine in a still image and broke girthcheck on 2 of 6 seeds — up
  // to 19.5% over measured chest circumference, the fat solve unable to
  // thin the layer enough to compensate. Worst on the seeds where axilla
  // height sits CLOSE above chest height (44mm on one failing seed against
  // 99mm on a passing one): the whole mass then sits almost exactly on the
  // ring the girth is measured against instead of straddling it, so its
  // full lateral reach counts against that one ring at full strength. Both
  // the reach and the cross-section came down.
  put('trunk', (P, f) => sdSegSE(P, A, B, F,
    t * 0.5, t * 0.45, t * 1.15, t * 0.8, 2.4, t * 0.4, f));
}

/* THE BACK, which the review sheet called out as an empty panel — no
   scapular spines, no erector spinae, no sacral flattening. Three features,
   all thin ridges or a shallow flattening, none of them big enough to
   compete with the chest for double-counting: the back was never separately
   measured the way the chest, waist and hip breadths and depths were, so
   there is no girth being duplicated here, only shape being added to a
   cross-section ANSUR only fixed the OUTLINE of. */

/* Scapular spine, medial border to acromion, plus a shallow fullness just
   below it for infraspinatus. The spine of the scapula runs from the
   vertebral border up and out to the acromion — literally the same point
   the trapezius above already ends on — so that end is shared rather than
   re-derived. The medial end has no measured landmark; anchored to T3 (the
   spine's root sits at roughly that level) and offset out from the
   vertebral column by a fraction of across-back breadth (interscyeii),
   which IS measured, rather than of stature — EST fraction, measured
   anchor. */
for (const side of ['L', 'R']) {
  const sgn = side === 'L' ? 1 : -1;
  const t3 = rig.bones.T3, cl = rig.bones['clavicle.' + side];
  if (!t3 || !cl) continue;
  const Acr = cl.B;
  const medY = sgn * m.interscyeii * 0.22;         // EST: well inboard of the full across-back width
  const Med = [t3.A[0], medY, t3.A[2] - vertR * 0.3];
  const F = frameAlong(Med, Acr, [1, 0, 0]);
  const ts = m.interscyeii * 0.046;                // EST: a thin ridge, not a bar
  // The end cap here runs the same near-lateral gauntlet the trapezius's
  // own acromial tip does — Med sits close in to the spine and Acr sits
  // far out, so this rope's own axis is mostly world Y too, and it is the
  // CAP (aimed down that axis), not the a1/b1 cross-section, that reaches
  // past Acr. Sized the same way and for the same reason as the
  // trapezius's own tip just above — see that section's own comment, and
  // the file header's note on why the trunk's bone scope no longer carries
  // a competing capsule at this exact point.
  put('trunk', (P, f) => sdSegSE(P, Med, Acr, F,
    ts * 1.15, ts * 0.6, ts * 0.7, ts * 0.5, 2.3,
    Math.max(ts * 0.55, deltGap * DELT_KW), f));

  // infraspinatus: a small fullness tucked under the spine's medial half,
  // not a second bar reaching all the way to the acromion. It first went in
  // as a shallow pad running the SAME full medial-to-acromion distance as
  // the spine above it, and it broke chest girth on one seed in the wider
  // sample — not by being big, its own anchors sit 50-75mm above chest
  // height, but by being SHALLOW-ANGLED over that reach (28mm of drop
  // across ~85mm sideways, the same ratio that coat-hangered the trapezius
  // before this file's other fix), so past a fat threshold its cross-section
  // reached straight down into the chest ring as one wide slab. Shortened to
  // stop at the spine's midpoint instead of its acromial end, which keeps
  // the same shallow angle but roughly halves the sideways reach and, with
  // it, the width of any slab that angle can produce.
  const Mi = [Med[0] - 34, medY * 1.08, Med[2] - 4];
  const Ai = [lerp(Med[0], Acr[0], 0.55) - 34, lerp(medY, Acr[1], 0.55), lerp(Med[2], Acr[2], 0.55) - 6];
  const Fi = frameAlong(Mi, Ai, [1, 0, 0]);
  const ti = m.interscyeii * 0.036;
  put('trunk', (P, f) => sdSegSE(P, Mi, Ai, Fi,
    ti * 0.8, ti * 0.55, ti * 0.95, ti * 0.5, 2.2, ti * 0.45, f));
}

/* Erector spinae: two ropes flanking the spine from mid-thoracic down to
   the sacrum, following the vertebral chain station by station rather than
   one straight segment, because the thoracic-to-lumbar curve is real
   enough over that length (T7 to the sacrum is 285mm on this figure) that
   a straight chord would cut inside it at the kyphosis and float clear of
   it at the lordosis. Left OFF the spine bone itself at the midline —
   the ropes are offset, the bone is not, so the gap between them is the
   furrow rather than a separate cut. Widens through the lumbar region,
   which is where a real erector mass is thickest, and narrows again
   approaching the sacrum. */
for (const sgn of [1, -1]) {
  const STA = [
    { b: rig.bones.T7, lat: 18, post: 2 },
    { b: rig.bones.T10, lat: 23, post: 4 },
    { b: rig.bones.L2, lat: 29, post: 7 },
    { b: rig.bones.L5, lat: 26, post: 6 },
    { b: rig.bones.pelvis, lat: 18, post: 2 },
  ].filter((s) => s.b);
  for (let i = 0; i < STA.length - 1; i++) {
    const s0 = STA[i], s1 = STA[i + 1];
    const fr0 = s0.b.frame, fr1 = s1.b.frame;
    const A = vmad(vmad(s0.b.A, fr0[1], sgn * s0.lat), fr0[2], -s0.post);
    const B = vmad(vmad(s1.b.A, fr1[1], sgn * s1.lat), fr1[2], -s1.post);
    const F = frameAlong(A, B, [1, 0, 0]);
    const cap = i === 0 ? 8 : i === STA.length - 2 ? 8 : undefined;
    put('trunk', (P, f) => sdSegSE(P, A, B, F, 13, 9, 13, 9, 2.4, cap, f));
  }
}

/* The sacral flattening, and — the same feature, not a second one — the
   hollow at the TOP of the gluteal cleft the side-view item further down
   asks for. Real skin sits close to bone over the sacrum, between the two
   erector ropes above and the cleft below, and both review items describe
   that one shallow triangle from two directions. A wide, shallow, blunt
   CUT rather than a ridge: this is an absence of tissue, not a form. No
   `f` — like the notch and the crotch cut, a fixed landmark rather than a
   soft-tissue profile.

   Anchored the same way the notch, navel and gluteal fold ended up
   anchored: hip CIRCUMFERENCE, fixed before the fat solve, floored under a
   probed ratio (0.051-0.063 across a small sample at this exact point)
   rather than the `buttockdepth`-fraction guess that put the other three
   cuts through the skin. This one never actually failed girthcheck —
   nothing sits at this height, so no measured ring runs through it — but
   the failure mode is the same bug wearing a disguise, and finding it
   after it ships in a render is worse than finding it here. */
{
  const p = rig.bones.pelvis;
  const nearEdge = g.hip * 0.045;                   // EST floor, under the probed 0.051-0.063
  const C = vmad(vmad(p.A, p.frame[0], -34), p.frame[2], -nearEdge);
  put('trunk', (P) => sdBlobSE(P, C, ID, 62, 46, 15, 2.3), true);
}

/* THE ILIAC CREST, the shelf where the hip bone shows at the top of the
   pelvic block. Both heights and both breadths involved are measured —
   iliocristale height for where the shelf sits, bicristal breadth for how
   far out — so only the crest's own front-to-back run and its cross-section
   are EST. Runs from near the ASIS (anterior, more prominent) back toward
   the PSIS (posterior, less so, and a touch lower — the crest is not
   level), matching CORE.pelvis and the pelvis's own frame so this rides
   the same block 50-field.js already sized rather than a second, competing
   guess at the pelvis's own dimensions. */
for (const sgn of [1, -1]) {
  const p = rig.bones.pelvis;
  const fr = p.frame;
  const h = m.iliocristaleheight - fig.rootHeight;
  const yLat = sgn * CORE.pelvis * m.bicristalbreadth * 0.5;
  const dAnt = CORE.pelvis * g.waistDepth * 0.5;
  const front = vmad(vmad(vmad(p.A, fr[0], h), fr[2], dAnt * 0.55), fr[1], yLat);
  const back = vmad(vmad(vmad(p.A, fr[0], h - 9), fr[2], -dAnt * 0.35), fr[1], yLat);
  const F = frameAlong(front, back, [1, 0, 0]);
  const tc = 9;                                    // EST: a slight shelf, not a rim
  put('trunk', (P, f) => sdSegSE(P, front, back, F,
    tc, tc * 0.65, tc * 0.7, tc * 0.55, 2.3, tc * 0.5, f));
}

/* THE NAVEL: a small cut, dead front, at waistheightomphalion — which is
   the measured landmark it is named for, so there is nothing to estimate
   about where it sits, only how big it is.

   Same bug as the suprasternal notch above, worse here because the waist
   carries more soft tissue than anywhere else on the trunk (TRUNK_FAT's
   own anchor weights peak at the omphalion). Built the first time off
   `waistDepth * 0.5`, the cutter's near edge landed 60-70mm off the navel
   on a mean figure against a probed true skin position of 137 to 266mm —
   short by anywhere from 70 to 200mm, and on the worst-sampled body that
   read as chest — sorry, WAIST — girth overshooting by 250mm of ring
   perimeter, not a dimple. Same fix, same reasoning: anchor to waist
   CIRCUMFERENCE, fixed before the fat solve runs, and floor the ratio
   under the probed range (0.184 to 0.227 across 10 bodies at the extremes
   of the sample, several more in between) rather than at its centre. */
{
  const h = m.waistheightomphalion - fig.rootHeight;
  const az = 8;
  const nearEdge = g.waist * 0.175;                 // EST floor, under the probed 0.184-0.227
  const C = [h, 0, nearEdge + az];
  put('trunk', (P) => sdBlobSE(P, C, ID, 7, 7, az, 2.2), true);
}

/* THE GLUTEAL FOLD, seen from the side. The glute's general roundness is
   not this file's to draw — it comes from the muscle layer, on the LEG
   part, in 45-muscle.js — but the trunk owns the pelvic block underneath
   it, and the block's own posterior curve is what the fold has to cut
   into. A shallow horizontal cut per side at buttock height, offset off
   the midline toward the centre of each cheek rather than across both:
   the fold is two creases, not one, and a single cut spanning the midline
   would carve into the cleft this file already shallowed above instead of
   marking the fold. Small and shallow for the same reason the notch and
   navel are — this is a crease, not a rim — and it sits right at the
   height 60-draw.js already draws its landmark line at, so the drawn
   crease and the modelled one agree.

   The same skin-position bug as the notch and navel above cost this one
   too, and cost it twice over: `buttockdepth`-fraction anchors again, AND
   the two ends had the geometry backwards. Probed against buttock
   CIRCUMFERENCE — fixed before the fat solve, same fix as above — the
   inner end (nearer the cleft) sits at 0.071 to 0.079 of it and the outer
   end (nearer the hip's side, where the buttock is shallower front-to-back)
   at only 0.048 to 0.062. The first version had both ratios roughly right
   in isolation but PUT THE DEEPER NUMBER ON THE SHALLOWER END — the outer
   point reached further back than the inner one ever did, which is the
   fold's two ends in the wrong order regardless of how well either was
   anchored. Both floored under their probed ranges, same reasoning: short
   is an invisible fold on a few bodies, long is a puncture into the pelvis. */
for (const sgn of [1, -1]) {
  const h = m.buttockheight - fig.rootHeight;
  const yMid = sgn * m.hipbreadth * 0.24;
  const A = [h + 2, yMid - sgn * 34, -g.hip * 0.062];   // inner, nearer the cleft: deeper
  const B = [h - 3, yMid + sgn * 34, -g.hip * 0.040];   // outer, toward the hip: shallower
  const F = frameAlong(A, B, [1, 0, 0]);
  put('trunk', (P) => sdSegSE(P, A, B, F, 7, 5, 7, 6, 2.2, 6), true);
}

  });
})(window.GK = window.GK || {});
