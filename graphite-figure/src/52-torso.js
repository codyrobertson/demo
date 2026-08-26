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
   V and the notch was what was missing at its point. */
{
  const sk = rig.bones.skull;
  if (sk) {
    const fr = sk.frame;
    const cy = m.headbreadth * 0.5, cz = m.headlength * 0.5;
    const notchH = m.suprasternaleheight - fig.rootHeight;
    const notchZ = m.chestdepth * 0.30;
    for (const sgn of [1, -1]) {
      // the mastoid, behind and below the ear
      const A = vmad(vmad(vmad(sk.A, fr[0], -m.mentonsellionlength * 0.22),
        fr[2], -cz * 0.24), fr[1], sgn * cy * 0.66);
      // and the notch, where the two of them nearly meet
      const B = [notchH, sgn * m.biacromialbreadth * 0.055, notchZ];
      const F = frameAlong(A, B, [1, 0, 0]);
      const w = m.neckcircumference * 0.055;      // EST: a strap ~17mm across
      put('trunk', (P, f) => sdSegSE(P, A, B, F,
        w * 0.9, w * 0.75, w * 1.25, w * 0.85, 2.1, w * 0.7, f));
    }
  }
}

/* THE SUPRASTERNAL NOTCH: the small hollow at the top of the sternum, right
   where the two SCM straps above nearly meet. ANSUR does not measure it —
   nothing surveys a dimple — so its size is EST, anchored to suprasternale
   height, which IS measured, and centred on the midline between the straps.

   Cut the way the head's eye sockets are cut (51-head.js): the cutter's
   centre sits mostly in FRONT of the skin, so only its posterior cap bites,
   which leaves a shallow scoop rather than a puncture straight through the
   manubrium. No `f` on a cut, matching the crotch and the eye sockets —
   the hollow is a fixed landmark, not a soft-tissue form that should swell
   or shrink with the fat solve. */
{
  const notchH = m.suprasternaleheight - fig.rootHeight;
  const notchZ = m.chestdepth * 0.30;             // same anterior reference the SCM heads use
  const ax = 8, ay = 9, az = 11;                  // EST: ~2cm across, a few mm deep
  const bite = 4;                                 // EST: how much of the cutter actually carves in
  const C = [notchH, 0, notchZ + az - bite];
  put('trunk', (P) => sdBlobSE(P, C, ID, ax, ay, az, 2.2), true);
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
  put('trunk', (P, f) => sdSegSE(P, Sh, Acr, F2,
    tj * 1.3, tj * 0.9, tj * 0.85, tj * 0.75, 2.3, undefined, f));
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
  put('trunk', (P, f) => sdSegSE(P, Med, Acr, F,
    ts * 1.15, ts * 0.6, ts * 0.7, ts * 0.5, 2.3, ts * 0.55, f));

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
   soft-tissue profile. */
{
  const p = rig.bones.pelvis;
  const C = vmad(vmad(p.A, p.frame[0], -34), p.frame[2], -m.buttockdepth * 0.30);
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
   about where it sits, only how big it is. Same technique as the
   suprasternal notch: the cutter sits mostly in front of the skin and
   only its posterior cap bites. */
{
  const h = m.waistheightomphalion - fig.rootHeight;
  const z = g.waistDepth * 0.5;
  const ax = 7, ay = 7, az = 9;
  const bite = 3.5;
  const C = [h, 0, z * 0.62 + az - bite];
  put('trunk', (P) => sdBlobSE(P, C, ID, ax, ay, az, 2.2), true);
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
   crease and the modelled one agree. */
for (const sgn of [1, -1]) {
  const h = m.buttockheight - fig.rootHeight;
  const yMid = sgn * m.hipbreadth * 0.24;
  const A = [h + 2, yMid - sgn * 34, -m.buttockdepth * 0.30];
  const B = [h - 3, yMid + sgn * 34, -m.buttockdepth * 0.58];
  const F = frameAlong(A, B, [1, 0, 0]);
  put('trunk', (P) => sdSegSE(P, A, B, F, 7, 5, 7, 6, 2.2, 6), true);
}

  });
})(window.GK = window.GK || {});
