/* ============================================================================
   GRAPHITE FIGURE — src/51-head.js
   The head: its volumes, and nothing else.

   Registered into the field's volume build rather than written inline in
   50-field.js, so the head can be worked to portrait quality without anyone
   else's region moving underneath it. Everything arrives in ctx: the solved
   rig, the sampled measurements, the primitives, and put(part, sdf, cut).

   Conventions, since everything here hangs off them: the skull bone's frame
   is +X up toward the vertex, +Y the figure's left, +Z anterior. Station 0
   of the head part is the tragion; tragion-to-vertex above it and
   menton-to-sellion below it are both measured.
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;
  const { vadd, vsub, vmul, vmad, vdot, vnorm, lerp, clamp01 } = M;

  GK.field.registerVolumes('head', (ctx) => {
    const { rig, fig, m, g, put, vertR, smin, smax, sdSegSE, sdBlobSE,
      frameAlong, exponentFor, CORE } = ctx;
// ---- the head --------------------------------------------------------
/* A HEAD IS A SET OF PLANES, NOT A SECTION CHANGING. FOURTH PASS.
   Three earlier versions, three different failures.

   The first was a single superellipsoid on head length, breadth and
   height: the right size and a featureless egg. The second was a
   braincase plus a separate jaw, which read as two balls on a stalk
   however much fascia was thrown at the join. The third — the one this
   replaces — fixed both of those the same way, by making the head ONE
   section changing along one axis: a vault leaning forward the whole
   way down to a chin, the same construction the ribcage uses. Against a
   silhouette it worked. Against the review sheet it did not: "scuffed,"
   and the direction given was "more planar like Asaro." A render of
   that version, head only, three-quarter, showed exactly why — the
   brow ridge and the cheekbone were each a separate rounded capsule
   glued onto a smooth stack, and at portrait scale a glued-on capsule
   reads as a cap brim, not as bone. Every added feature had its own
   silhouette edge, so the underlying mass itself was still a melon and
   the features were lumps on it. Smooth curvature has no edge for a
   shadow to stop at — it oozes from light to dark across the whole
   form — and that is what "scuffed" was a verdict on.

   The Asaro planes-of-the-head construction fixes this at the root
   because it does not add features to a round mass, it builds the mass
   FROM flat planes: forehead, brow shelf, temple, cheek, jaw, occiput,
   crown, each one a half-space, and the head is where they all
   intersect. A shadow terminates where two planes meet — a plane edge,
   not a gradient — because the normal is piecewise-near-constant on
   each facet and jumps at the boundary between them. That is the one
   property a smooth section stack cannot have at any exponent: raising
   a superellipse's n flattens a facet's MIDDLE but the curvature has to
   go somewhere, and it piles up at the facet's edge instead of
   vanishing, which is a rounded-off corner, not a break.

   THE CONSTRUCTION: every plane is a half-space, dot(P-A, n) for a
   point A on the plane and an outward unit normal n. The planes combine
   by smooth intersection (smax, k = 4-5mm — crisp enough to read as an
   edge, soft enough not to alias at pencil scale) into one convex-ish
   polytope, which is then smax'd against a single bounding ellipsoid
   sized from the SAME measured numbers the old stack used. That last
   step is not decoration: two planes meeting at a shallow corner can
   reach further from the axis along their shared diagonal than either
   one does along its own normal — a cube's corner is out at its
   half-width times root 3, not root 1 — and nothing about a chain of
   smax operations stops that on its own. The ellipsoid is what stops
   it, on every diagonal at once, without having to reason about which
   pair of planes might be the offending one.

   THIS IS ALSO WHY THE OLD FAILURES DO NOT COME BACK, structurally
   rather than by discipline. The two-balls failure (construction #2)
   was two closed solids meeting across a step; this is one solid, the
   intersection of everything at once, so there is no second solid to
   meet. The end-cap pinch (construction #3, see the archived stack
   logic this replaces) was two free ends of a chain each needing an
   explicit axial cap or the smin between neighbouring segments bulged;
   a polytope has no free ends — every direction is already bounded by
   SOME plane or by the envelope ellipsoid, so the vertex and the chin
   are just two more facets, not special cases.

   THE THREE BREAKS THAT MATTER MOST, in the order they matter: the
   zygomatic ridge (front cheek plane meets side cheek plane, running
   from the outer orbit back toward the ear — this is the edge a
   drawing lives or dies on in three-quarter light); the brow-to-temple
   corner (forehead/brow meets the temple's near-vertical side); the
   jaw line (ramus meets the underside). All three are CONVEX edges —
   the surface pokes outward along them, both adjoining planes receding
   away — which is exactly the case smax-of-half-spaces produces for
   free at every plane-to-plane join. Concavities are a different
   problem and stay a different technique: the eye sockets and the
   nose-root notch are still cuts (smax against a negative blob), the
   same mechanism as before and proven safe already.

   THE STAR-SHAPE CONSTRAINT, and why this construction respects it
   without having to be told to. radiusAlong root-finds outward from
   the head's own axis, one straight ray per (station, angle) — so
   every surface point has to be reachable by walking out from the axis
   without the field going outside-inside-outside along the way. A
   half-space is trivially star-shaped from any point on its inner
   side. An intersection of half-spaces is star-shaped from any point
   in the intersection, because the whole region is convex. Smax
   softens the corners but does not introduce concavity at the scale
   k=4-5mm sits against a head sized in centimetres. So the entire core
   mass is safe by construction, and the only places that need the same
   "small negative breaks are fine" reasoning the eye sockets already
   relied on are the handful of actual cuts — there are no more of them
   than there were before. */
{
  const sk = rig.bones.skull;
  if (sk) {
    const fr = sk.frame;                            // +X up, +Y left, +Z front
    const along = frameAlong;
    const up = m.tragiontopofhead, dn = m.mentonsellionlength;
    // half-breadth at the parietals (the skull's true widest), half-depth
    // (tragion-to-vertex has no AP counterpart, so headlength stands in for
    // the whole vault's depth), half-breadth at the cheekbones — all three
    // measured, all three scaled down by CORE.head for the same reason the
    // torso's CORE fractions are less than one: the fraction is bone-plus-
    // scalp, thin, and the rest is the fat term solved against circumference.
    const cy = CORE.head * m.headbreadth * 0.5;
    const cz = CORE.head * m.headlength * 0.5;
    const zy = CORE.head * m.bizygomaticbreadth * 0.5;

    /* THE CANON. Four numbers a life-drawing manual states as fact and
       ANSUR has no landmark for, because they are ratios between OTHER
       landmarks rather than landmarks themselves: the eyes sit at the
       vertical mid-height of the whole head; the base of the nose is
       halfway from the brow to the chin (equivalently: brow-to-nose-base
       and nose-base-to-chin are the same span, the classic facial
       "thirds"); the ears run from the brow line to the nose base; the
       mouth sits a third of the way up from the chin to the nose base.
       Encoding them as formulas rather than as separately-tuned station
       heights is what makes them checkable, and it is also what let this
       whole rebuild swap the mass underneath them for a different
       construction without touching a single one of these four lines —
       they are ratios between OTHER canon heights and the two measured
       spans, not positions on the old stack, so they carried over intact.

       browH is NOT put at 0.16 * up, tempting as that is — SITES has
       head circumference sampled at exactly s=0.16 of tragion-to-vertex
       (50-field.js, read-only here), and putting the brow there too
       looked like one fewer place for two numbers to silently disagree.
       It is the opposite: the ear's canon span runs from browH down to
       noseBaseH, so browH is also the ear's own top. With the two
       heights equal, fitFat measured the ear's girth instead of the
       skull's at every seed alike and solved for far too little soft
       tissue: 5 of 6 seeds failed girthcheck against 1 before this file
       was touched. 0.08 * up is the value that both passes girthcheck (1
       of 6, matching the count before this file was touched) and stays
       visibly above eyeH on all three test seeds — found empirically
       across three tries because the collision is through sdSegSE's own
       t = project(P, A, B) on the ear's tilted axis, not a plain
       distance, and this rebuild changes nothing about the ear's axis or
       the sampling site it was tuned against, so the number did not need
       re-deriving. */
    const browH = up * 0.08;
    const eyeH = (up - dn) * 0.5;                    // canon: mid vertex-to-chin
    const noseBaseH = (browH - dn) * 0.5;            // canon: halfway brow-to-chin
    const mouthH = -dn + (noseBaseH + dn) / 3;        // canon: a third up from chin

    /* THE SIZE BUDGET, and this is the one place the numbers here were
       genuinely SOLVED rather than reasoned to, because two effects push
       against each other in a way hand arithmetic kept getting wrong by
       a factor of two or three.

       The first effect is the one the brief for this rebuild predicted:
       every plane is grown outward by `f`, the solved scalp thickness,
       and the vertex and chin are each capped by a plane whose normal
       has a vertical component, so a core that exactly spans measured
       vertex-to-chin comes out taller once the scalp is added — pulling
       the top and bottom stations in by roughly `f` before the scalp
       goes back on is the right shape of fix.

       The second effect is not one a smooth section stack has at all,
       and it is BIGGER than the first: a faceted polytope's cross-section
       at any one height has less perimeter than a smooth superellipse
       covering the same reach (that is the whole point of facets — a
       hexagon inscribed in a circle is shorter around than the circle),
       so fitFat's bisection has to solve for a THICKER scalp to hit the
       same measured circumference than the old smooth stack ever needed
       — 15-20mm on the first working version of this file, not the ~7mm
       the smooth stack (and this rebuild's own header) expected. Most of
       that gap turned out to be a bug, not a property of planar
       construction: the chin bevels (below) had no height falloff at
       all and were quietly clipping a corner out of the ring at the
       girth-check site, up near the temple. Fixing that brought the
       solved scalp down to 7-13mm, close to what a smooth head needs —
       but not all the way, and the residual is the honest cost of facets
       having less perimeter per unit reach than curves do.

       Both effects together are why TOP_MARGIN and BOT_MARGIN below are
       NEGATIVE: the core is told to overshoot the measured vertex and
       chin by a few millimetres before the scalp is added, not undershoot
       them.

       WHY A FRACTION NOW, NOT THE FLAT -3.5mm THIS FILE SHIPPED WITH
       FIRST. A flat millimetre count cannot know the one thing that
       actually drives how much overshoot a given body needs: fitFat's
       own solved `f`, which is not a fixed number but swings 5-12mm
       across ordinary bodies (see THE SIZE BUDGET above), by however
       much THAT body's bare polytope perimeter happens to fall short of
       ITS OWN measured circumference. -3.5mm flat drew three of eight
       sampled bodies under the 0.97 floor (0.952-0.969) — and all three
       had the SMALLEST solved `f` in the sample (4.9-7.0mm, against a
       4.9-11.9mm range): too little scalp came back to fill in what a
       fixed pre-shrink held back, because the pre-shrink did not grow
       with the body the way the shortfall it is compensating for does.
       A fraction of the body's own measured envelope — tragiontopofhead
       + mentonsellionlength, per the brief this rebuild's follow-up
       gave — does not know `f` either (no closed form here can: `f` is
       solved AFTER this file's planes exist, from a bisection against
       the drawn circumference, not before). What it does do is scale
       the overshoot to the body's own size instead of applying one
       adult's number to every adult, which is enough: the band has
       plenty of headroom on the high side (0.97-1.06, and the worst
       sampled body reached only 1.025 even before this change), so
       raising the floor by scaling up does not put anyone through the
       ceiling. Solved empirically the same way the flat number was —
       against tools/proportions.js across eight bodies — because no
       single clean formula in up, dn, cy or cz reproduced the right
       answer for both the tallest and the shortest body in the sample
       at once; the fraction below is the compromise that clears the
       most checks across all eight, not a number with a closed-form
       derivation behind it. */
    const measH = up + dn;                    // tragiontopofhead + mentonsellionlength

    /* THE SECOND-ORDER TERM, found only once the fraction above met its
       OWN new neighbour: `head drawn H/W`, the EST canon band this file
       had never threatened before. A narrow-breadth body draws its
       ears and scalp as a LARGER fraction of its own small headbreadth
       than a wide-breadth body does (same mechanism as THE TEMPLE'S
       RATIO below, just visible here as a side effect rather than the
       main event) — so the same measH-scaled margin that fixed the
       floor for an ordinary body pushed a narrow-breadth one (134mm,
       against a ~150mm mean) hard enough into H/W's 1.50 ceiling that
       clearing it needed less margin specifically for that body, not a
       smaller MARGIN_BASE for everyone — a flat reduction big enough to
       help it dropped `stature / drawn head H`'s population MEAN under
       6.9 instead (that check is judged on the mean deliberately, see
       its own comment in tools/proportions.js, and a systematic height
       cut against every body moves the mean regardless of which body
       needed the cut).

       headbreadth is what the two bodies that actually collided on
       this — one narrow, one merely average — differ on, so it is what
       the correction reads, the same "proxy for a later-solved number"
       relationship roundness has to `f` in every comment below this
       one. CLAMPED to the range this was checked against: an
       unclamped linear term is exactly what turned into a NEW failure
       the first time this fix used roundness the same way for the
       temple plane (see the clamp on that one) — extrapolated past a
       calibration sample's own range, a term tuned to correct eight
       bodies can overcorrect a ninth harder than the flat number it
       replaced ever did. */

    /* RE-FIT A THIRD TIME, once restoring the rear planes' depth (see
       THE TRAP, A THIRD TIME, by the occiput planes below) gave solved
       `f` back most of its old range. MARGIN_BASE and MARGIN_K were both
       fit against a fitFat regime that no longer exists once cz*0.78 down
       there puts head `f` back near 6-9mm instead of the 3-7mm the
       regression this pass fixes left behind — and a MARGIN_FRAC sized
       for a thin f overshoots vertexH once a healthy f is added on top of
       it. `vertex overshoot mm` (drawn crown past measured stature) is
       the check that catches it, and it caught the two widest-headbreadth
       bodies in the sample first — seed 1 (160.1) and seed 4 (162.5),
       both close enough to the OLD upper clamp of 163 that MARGIN_K's own
       headbreadth term was, by construction, handing them MORE margin
       than an average body: exactly backwards from what a body already
       close to overshooting its own stature needs once f is no longer
       anaemic. MARGIN_BASE raised 0.027 to 0.0285 to keep `head drawn H /
       measured H`'s own floor clear now that less of its margin is
       coming from a thin f; the UPPER breadth clamp tightened 163 to 155
       so the widest bodies stop drawing extra margin they no longer need
       — the LOWER clamp (138) is untouched, since the narrow-body H/W fix
       above still depends on it. Solved against tools/proportions.js
       across the same eight bodies, same discipline as everything else
       re-fit this pass. */
    const MARGIN_BASE = 0.0285, MARGIN_K = 0.0016;   // EST, solved against tools/proportions.js
    const breadthForMargin = Math.max(138, Math.min(155, m.headbreadth));
    const MARGIN_FRAC = MARGIN_BASE - MARGIN_K * (150 - breadthForMargin);
    const TOP_MARGIN = -MARGIN_FRAC * measH, BOT_MARGIN = -MARGIN_FRAC * measH;
    const vertexH = up - TOP_MARGIN;
    const chinH = -dn + BOT_MARGIN;
    const parietalH = up * 0.50;             // EST: where the skull is at its true widest
    const zygoH = lerp(noseBaseH, eyeH, 0.40);  // EST: cheekbone height, below the orbit
    const jawH = lerp(chinH, mouthH, 0.50);     // EST: the angle of the jaw
    /* NOT the ear's mid-height. Two constructions anchored the occipital
       ridge at (browH+noseBaseH)/2 on the reasoning that the ear's centre
       is "ear height" — and the profile curve, finally measured instead of
       squinted at, put the skull's most-posterior point at 21mm BELOW the
       tragion, with the whole rear above it retreating in one straight
       diagonal. That diagonal was the hood's rear edge both times. The
       inion sits on the BROW's horizontal — the Frankfurt-plane fact every
       skull diagram shows — so the ridge anchors at browH, and everything
       below it curves in toward the nape instead of everything above it
       fleeing forward. */
    const occiputH = browH;

    const U = fr[0], L = fr[1], F = fr[2];
    const Un = vmul(U, -1), Fn = vmul(F, -1);
    const RAD = Math.PI / 180;
    // A normal built by leaning a cardinal direction toward a second one,
    // by an angle in degrees. base and toward must be unit and mutually
    // perpendicular (true of every U/L/F combination here), which is what
    // lets `base + toward*tan(deg)` normalise into an exact-angle tilt
    // without carrying sin/cos through every call site.
    const tilt = (base, toward, deg) => vnorm(vadd(base, vmul(toward, Math.tan(deg * RAD))));
    // two-way lean: a plane whose primary direction gets pulled toward TWO
    // neighbours at once (a diagonal facet, like a chin bevel, that also
    // has to fade out with height rather than reaching all the way up the
    // face at full strength — see the note by PLANES below on why every
    // paired side plane needs at least one U-leaning component)
    const tilt2 = (base, t1, d1, t2, d2) =>
      vnorm(vadd(vadd(base, vmul(t1, Math.tan(d1 * RAD))), vmul(t2, Math.tan(d2 * RAD))));
    const pt = (h, y, z) => vmad(vmad(vmad(sk.A, U, h), L, y), F, z);
    const pdist = (P, A, n, f) => vdot(vsub(P, A), n) - (f || 0);

    /* THE PLANES. Each is one half-space: a point on the plane (a canon
       height, a lateral offset as a fraction of the measured half-
       breadths, a forward or backward offset as a fraction of the
       measured half-depth) and an outward normal, built by tilting a
       cardinal direction toward a neighbour by an EST angle. The angle
       is what a life-drawing plane reference gives that facet; nothing
       in ANSUR measures a facet's own tilt, the same honesty the ear's
       15° already had.

       Heights and offsets share the SAME variables the old stack used
       (cy, cz, zy, browH, eyeH, noseBaseH, mouthH) for the same reason:
       they are the measured numbers, and a construction that used
       different ones would be re-guessing a body this file already
       knows precisely. */
    const K = 5;       // EST: plane-to-plane smax radius — crisp break, no alias
    const K_ENV = 6;    // EST: slightly softer where the envelope ellipsoid catches a corner

    const PLANES = [];
    const addPlane = (h, y, z, base, toward, deg) =>
      PLANES.push({ A: pt(h, y, z), n: tilt(base, toward, deg) });
    const addPlane2 = (h, y, z, base, t1, d1, t2, d2) =>
      PLANES.push({ A: pt(h, y, z), n: tilt2(base, t1, d1, t2, d2) });

    // ---- front group, midline -----------------------------------------
    // forehead: tilted back so it recedes toward the crown — EST 12°, the
    // shallow end of the 10-15° a planes-of-the-head reference gives it
    addPlane(browH, 0, cz * 0.93, F, U, 12);
    // brow shelf: the underside, receding DOWN into the socket — the
    // opposite tilt direction from the forehead sharing almost the same
    // anchor is what puts a projecting ridge exactly at browH, which is
    // the supraorbital ridge a life-drawing reference calls out by name
    addPlane(browH, 0, cz * 0.95, F, Un, 20);
    // muzzle/mouth plane: sets back a little from the cheek toward the
    // mouth ring, EST 6° — shallow, because the lips themselves (below)
    // are what supplies the mouth's own local projection, not this plane
    addPlane(mouthH, 0, cz * 0.78, F, Un, 6);
    // chin front pad: forward of the muzzle plane again (a real profile's
    // brow-nose-lips-chin undulation), nearly vertical
    addPlane(chinH, 0, cz * 0.90, F, Un, 6);
    // the crown's flat top facet — pure +U, no tilt: this single line is
    // what used to be the vault's own explicit end cap (capTop()) in the
    // old stack. A polytope needs no special case for a free end because
    // every direction is already some plane's inside, so this facet is
    // just one more entry rather than a different code path
    addPlane(vertexH, 0, 0, U, F, 0);
    /* THE PHARAOH'S HOOD, which is what two occiput facets drew instead
       of a skull. At az 90 the flat crown-top plane (F-independent,
       deg 90 in this family's own terms) met the single upper-occiput
       plane (deg 22 from Fn toward U) directly, a 68-degree jump taken
       in one smax step — and a corner that sharp does not read as a
       rounded skull however soft K is, it reads as a crease, because
       the angle between the two planes' normals (not K) is what sets
       how far a convex smax corner bulges. Worse than the crease itself:
       that corner sat some 20+mm BEHIND the tragion (F worked out
       negative at U = vertexH, the flat top's own height) rather than
       over it, because the flat top plane does not care about F at all
       and so extends exactly as far back as whatever plane stops it —
       here, a single steep wall anchored at the ridge. The two together
       drew a flat plateau roofing a near-vertical drop straight down to
       the ear-height ridge: a nemes headdress silhouette, not a crown.

       THE FIX IS MORE FACETS, NOT A ROUNDER ONE — a single replacement
       angle for the old 22 still meets the flat top at whatever angle
       it is given, and the review asked for "at least two more facets
       back there": a crown-to-occiput transition plane, and a rounder
       upper-occiput tilt below it. Three steps of roughly 32 degrees
       apiece (90 to the transition's 58, 58 to the revised upper-
       occiput's 26) read as a curve for the same reason the front of
       the face gets six planes from brow to chin instead of one: each
       individual smax join is softer when the planes either side of it
       are closer in angle, corner bulge included, and the CUMULATIVE
       effect of several gentle joins is a dome, not a wedge.

       PLACING occTransH/occTransZ is not free of the same trap the
       original single plane fell into, and it caught this rebuild once
       already: an early attempt anchored the transition too low (60%
       of the way from ridge to crown) with too shallow a depth, and
       because a FLATTER plane's own crossing with F=0 falls at a LOWER
       U the flatter it is (U = h + |z|/tan(deg), which shrinks as
       tan(deg) grows), that plane started overruling the crown-top cap
       barely halfway up the head — drawn headH fell from 231mm to
       200mm on seed 12345, a bald dome instead of a shaved-in temple.
       The fix is the same identity read the other way: solve h and z
       TOGETHER so the plane's crossing at F=0 lands close to vertexH
       (not partway down), which is the same condition as its crossing
       at U=vertexH landing close to F=0 — one straight line, so pinning
       either point pins the other. h_t at 75% of the way from ridge to
       crown with z_t at cz*0.55 back is what solves both at once for a
       representative head; the upper-occiput revision below needed the
       identical check, which is why its own new angle stops at 26
       degrees; the arithmetic for both is in tools/ (scratch), not
       carried here, because the smax chain and the envelope ellipsoid
       both still touch the final position enough that this is a
       starting point confirmed against renders, not a closed form
       trusted past them.

       UPPER-OCCIPUT'S OWN new angle — 26, not the file's first attempt
       at 34 — answers the same trap a second time. 34 degrees is
       "rounder" in isolation, but at the ridge's own anchor (cz*0.83
       back) it crosses F=0 at U=86, more than 35mm below vertexH: the
       same premature dome the transition plane's bad first placement
       caused, from the OTHER facet. 26 degrees keeps that crossing at
       U=127, just past vertexH, so upper-occiput still only governs
       where it always did — behind the ear, not overhead — and the
       roundING is left entirely to the new transition plane above it,
       which is what "at least two more facets" asked for rather than
       one facet doing double duty.

       The most-posterior point does not move: upper-occiput and
       lower-occiput still share the one anchor, at ear height, exactly
       as the construction this replaces did — that instruction was
       already correct, and nothing about fixing the top touches it. */
    /* With the ridge raised to the brow line, the three rear tilts change
       jobs: the upper occiput stays NEAR-VERTICAL (12 degrees) so the back
       of the skull keeps its depth through the vault's middle half — the
       measured curve used to lose 30mm of depth between the ear and
       two-thirds height, which is the retreat that read as a wedge — and
       the transition plane starts higher and turns harder, carrying the
       curve into the crown in the last fifth. Below the ridge the nape
       steepens to 22, since the hollow now has real overhang to tuck
       under. EST throughout, against the measured profile curve. */
    const occTransH = lerp(occiputH, vertexH, 0.82);
    addPlane(occTransH, 0, -cz * 0.58, Fn, U, 50);      // crown-to-occiput transition
    addPlane(occiputH, 0, -cz * 0.78, Fn, U, 12);       // upper occiput: stay deep
    addPlane(occiputH, 0, -cz * 0.78, Fn, Un, 22);      // nape, tucking under the ridge

    /* THE TRAP, A THIRD TIME — SUSPECTED, THEN RULED OUT BY ITS OWN
       ALGEBRA, WHICH IS WHAT LEFT ROOM TO FIND THE REAL CAUSE.
       The profile pass above regressed two of the eight proportion-gate
       bodies (crown width, drawn H/W, drawn H — see tools/proportions.js)
       and the suspect was this file's own documented failure a third
       time: a rear plane's F=0 crossing (U = h0 + |z0|/tan(deg), the
       identity this file already derived twice above) landing below a
       body's vertexH, overruling the crown cap. Redone for THIS plane set
       against all eight sampled bodies, including the roundest (seed 2:
       headbreadth 161.5, headlength 197.7) and the most elongated (seed
       3: 134.3, 182.0) — it does not hold: crossTrans = occTransH +
       cz*0.58/tan(50) sits 21-26mm ABOVE vertexH on every one of the
       eight, and crossUpper, the near-vertical 12-degree plane, sits
       230-275mm above it — nowhere near overruling anything. The
       suspicion was reasonable, it is the same SHAPE of bug on record
       twice already, but the numbers said no, and chasing the wrong
       mechanism would have meant re-shortening a profile that
       tools/profcurve.js had just finished getting right.

       THE REAL MECHANISM is one level removed: not the crown cap, the
       GIRTH SITE. SITES samples head circumference at s=0.24 of
       tragion-to-vertex (50-field.js), which lands 19-22mm above
       occiputH on these eight bodies — close enough to the near-vertical
       upper-occiput's own anchor that its BARE (unscalped) reach there
       barely falls off before the anchor's own maximum depth. Measured
       directly (fat forced to 0, ringAt at s=0.24, all eight bodies): the
       bare perimeter at that one station grew 44-51mm, UNIFORMLY across
       every body, the moment occiputH rose to browH and upper-occiput
       went near-vertical — a real and correct consequence of giving the
       vault its depth back, not a bug in it. But fitFat solves ONE
       thickness per body from THAT one station against the body's
       measured head girth, and applies it to every plane in this file
       alike; a bare shape that already reaches most of the way to its
       target circumference gets told to add almost nothing on top.
       Solved `f` (tools/girthcheck.js) collapsed from a 9.8mm mean
       (6.1-12.5mm range, healthy) to a 3.8mm mean (0.6-6.7mm, one body
       nearly bald) — and because that thinner scalp grows EVERY facet in
       this file by less, not only the rear ones, the crown band measured
       narrow on all eight sampled bodies (`head crown W / measured W`,
       0.907-0.980 against a 0.98 floor) though not one of the planes that
       actually draws the crown had changed. The rear planes did not eat
       the crown's own width; they starved the shared scalp budget
       everything else in this file was still depending on.

       THE FIX matches the mechanism it actually is: cz*0.86 pulled to
       cz*0.78 on both the upper-occiput and nape anchors — DEPTH only,
       not the 12/22-degree tilts and not occiputH's own height, so
       tools/profcurve.js's two numbers (posterior ridge, crown apex —
       both governed by HEIGHT and by occiputH, neither of which this
       touches) come out identical before and after on all three probed
       seeds. Solved empirically against tools/proportions.js across the
       same eight bodies, same as every other constant in this file:
       cz*0.78 is not a re-derivation of the crossing algebra above (that
       algebra never predicted a problem here, so it cannot size a fix for
       one) — it is the depth that puts solved `f` back in a healthy band
       (6.3mm mean, 2.9-8.8mm range on the eight gate bodies) without
       giving back so much of the vault's own depth that the wedge this
       file's whole profile pass was written to close starts reopening.
       The per-body terms downstream of `f` — the temple base and the ear
       standoff base, both below — needed re-fitting to the same restored
       budget for the identical reason; the crownW floor and the H/W
       ceiling only cleared once temple and ear stopped assuming a scalp
       this thick. */
    // jaw underside, from under the chin back toward the throat: the
    // floor rises going backward, which both caps the chin's own bottom
    // (replacing the old stack's capBot()) and gives the underside its
    // slope toward the neck
    addPlane(chinH, 0, cz * 0.50, Un, Fn, 24);

    /* THE TEMPLE'S RATIO IS NOT A CONSTANT, and finding that out cost a
       tenth of a point on either end of a band. headW and crownW
       (proportions.js) both charge the skull's own lateral planes for
       going too wide on some bodies while ANOTHER body needs every bit
       of the same planes just to clear its OWN floor — seed 2 (headbreadth
       161.5, headlength 197.7) sat at 0.995 of its own measured width in
       the crown band, seed 3 (134.3, 182.0) sat at 1.105, and the two
       failures in the brief (`head drawn W / measured W` over on seed 3,
       1.217; crown 1.104) are exactly this, not a single body being an
       outlier. A flat ratio applied to both bodies' own cy — already
       "a fraction of the body's own headbreadth", per CORE.head above —
       moves both by the same fraction of their own size and so preserves
       the gap between them; it cannot close it.

       What DOES differ between those two bodies, checked directly, is
       ROUNDNESS: headbreadth/headlength, 0.817 for the seed that needed
       the least pull-in and 0.738 for the one that needed the most. This
       is not a coincidence dressed as a formula — it is the same
       mechanism THE SIZE BUDGET above already named for height: an
       elongated head (breadth small relative to length) has less bare-
       polytope perimeter per millimetre of cy than a round one does, so
       fitFat's bisection solves it a THICKER scalp to reach its own
       measured circumference, and that scalp grows the temple plane
       right along with every other one. Roundness is a stand-in for that
       solved thickness, available here when the flat ratio it corrects
       is not (fitFat runs after these planes exist), the same honest
       relationship the height margin above has to `f` — a proxy, not a
       prediction, but one that moves the right way on both of the
       bodies that actually failed. Solved empirically against
       tools/proportions.js across eight bodies, same as TOP_MARGIN: no
       closed form in headbreadth and headlength alone reproduced the
       right pull-in for the roundest AND the most elongated body in the
       sample at once, so ROUND_REF and TEMPLE_K are the compromise that
       clears all eight with room on both ends of the band, not a number
       derived rather than fitted.

       CLAMPED to [0.72, 0.82], the range the eight sampled bodies
       actually spanned (0.722-0.817) — this is a linear correction
       fitted to that range, not a physical law, and it does not stay
       true past it. Left unclamped, a wider seed sample found a body
       round enough (0.865) that the SAME formula swung the temple, and
       the ear right after it, wider than the flat ratio this replaced
       ever put them — an overcorrection worse than the problem, from
       trusting one straight line further than the eight points that
       fitted it. */

    /* THE BASE ALSO MOVED, 1.06 to 1.14, in the SAME pass that pulled the
       rear planes' depth back in (see THE TRAP, A THIRD TIME, above) — a
       second, independent draw on the same shared scalp budget fitFat's
       collapse had thinned. Pulling the occiput back in recovered MOST of
       the lost `f`, not all of it: 6.3mm mean against the 9.8mm this file
       was drawing on when 1.06 was fit, so the temple plane, like every
       plane in this file, is still getting less free width from the
       solved scalp than it was tuned against, and needed its own base
       raised to compensate directly. TEMPLE_K and ROUND_REF are
       UNCHANGED — the roundness-conditioned SLOPE that widens an
       elongated head's temple relative to a round one's was never the
       broken part, only the flat amount every body gets regardless of
       roundness was. Re-solved the same way, against
       tools/proportions.js across the same eight bodies. */
    const ROUND_REF = 0.78, TEMPLE_K = 2.2;   // EST, solved against tools/proportions.js — see above
    const roundness = Math.max(0.72, Math.min(0.82, m.headbreadth / m.headlength));
    const templeRatio = 1.14 - TEMPLE_K * (ROUND_REF - roundness);

    // ---- paired: side group + the paired front/crown facets -----------
    for (const sgn of [1, -1]) {
      const side = vmul(L, sgn);
      // crown side facets, doming over from the flat top — 2 of the "2-3
      // crown facets": the flat top above plus these two account for all
      // three without needing a fourth, since the top facet already
      // supplies the third
      addPlane(vertexH, sgn * cy * 0.30, 0, U, side, 27);
      // parietal: the skull's true widest point, nearly vertical, easing
      // inward toward the crown above it
      addPlane(parietalH, sgn * cy * 1.10, cz * 0.30, side, U, 6);
      // temple: flat, near-vertical, easing in toward the crown the same
      // way the parietal does, at a narrower base offset than it —
      // narrower still on an elongated head, wider on a round one (see
      // THE TEMPLE'S RATIO above)
      addPlane(browH, sgn * cy * templeRatio, cz * 0.45, side, U, 3);
      // front cheek: below the orbit, tilting back down toward the mouth
      // ring — meets the side cheek plane below at the zygomatic ridge,
      // the single most important break this file draws
      addPlane(zygoH, sgn * cy * 0.36, cz * 0.85, F, Un, 9);
      // side of the cheek, below the zygomatic arch, easing inward toward
      // the jaw
      addPlane(zygoH, sgn * zy * 0.82, cz * 0.40, side, Un, 11);
      // jaw ramus
      addPlane(jawH, sgn * zy * 0.68, cz * 0.35, side, Un, 8);
      // the two chin bevels: the front pad's own corners, turned to face
      // diagonally forward-and-out rather than left unrounded. Also leaned
      // toward -U (fades out going up) — without that second lean this
      // plane has no height component AT ALL (pure F/L blend), so it does
      // not stay confined near the chin the way its anchor implies: left
      // as a single tilt it reached all the way up to the temple/forehead
      // ring at full strength and clipped a corner out of it, which is
      // what the girth solve read as ~78mm of missing bare circumference
      // at the head's own fitFat site and answered with a 15-20mm scalp
      // instead of the ~7mm a properly local bevel needs. Every OTHER
      // paired side plane already leans toward U or away from it for
      // exactly this reason (see parietal, temple, side cheek, ramus); the
      // chin bevel was the one built without checking that it did too.
      addPlane2(chinH, sgn * zy * 0.20, cz * 0.80, F, side, 38, Un, 26);
    }

    /* THE ENVELOPE. A single ellipsoid, meant to catch the diagonal
       corners a chain of half-space intersections leaves unbounded (a
       cube's corner is out at its half-width times root 3, not root 1)
       without having to reason about which pair of planes is the
       offending one — see the header note. That is a smaller job than it
       first looks: this rebuild's actual tuning found the ellipsoid
       matters far less than the planes themselves for where the drawn
       surface ends up, and sized tight it actively works AGAINST the
       planes rather than only backstopping them. An ellipsoid's own
       reach falls off away from each of its three pure axes (an ellipse
       gives up width to gain height, off-axis, by the shape of its own
       equation), and the head's own girth site sits well off the polar
       axis — high enough to be past the chin, off-centre enough to be
       most of the way to the temple. A tight ellipsoid intersected there
       quietly ate width the individual planes were never asked to give
       up, which is what a bare (unscalped) ring at that site measuring
       80mm short of CORE.head's own target circumference turned out to
       be — not the planes being too narrow, the ellipsoid choking the
       ring between them. Sized generously instead (comfortably over
       every paired plane's own offset, on every axis), it does the one
       job it is for — the true diagonal corners, mostly near the crown
       and the chin-bevel corners — without competing with the planes for
       the ordinary width and depth of the head. n=2, a true ellipsoid
       rather than a superellipse, so what corner-rounding it does add is
       predictable. */
    const envAx = (vertexH - chinH) * 0.5 * 1.10;
    const envAy = cy * 1.22;
    const envAz = cz * 1.22;
    const envC = pt((vertexH + chinH) * 0.5, 0, -cz * 0.02);

    const coreSdf = (P, f) => {
      let d = pdist(P, PLANES[0].A, PLANES[0].n, f);
      for (let i = 1; i < PLANES.length; i++) d = smax(d, pdist(P, PLANES[i].A, PLANES[i].n, f), K);
      return smax(d, sdBlobSE(P, envC, fr, envAx, envAy, envAz, 2, f), K_ENV);
    };
    put('head', coreSdf);

    /* THE NOSE. In profile it is the most identifying thing on a head,
       and it is the one part of a face that is a FORM rather than a mark:
       no amount of line work on a flat face plane produces it, because
       what a nose does is break the silhouette. ANSUR measures nothing
       about it — menton-to-sellion reaches its root and stops — so every
       number here is EST, anchored to the head depth that IS measured.

       Still a WEDGE built from the same root/tip/base ramp the smooth
       stack used (root, tip and base project further forward in that
       order, uncapped in the middle, for the reasons the two paragraphs
       below record) — that structure is proven and this rebuild does not
       reopen it. What changes is the cross-section: SHARPENED, with two
       explicit bevel planes smax'd onto each ramp segment so the bridge
       reads as a top ridge and two side facets meeting it, the same
       technique as the head's own planes rather than a rounded capsule.

       The forward reach also came down hard, from the smooth stack's
       1.19cz to 1.03cz, as part of the same depth budget the head's own
       planes are on. Depth is not one proportions.js checks, but the
       brief's own targets are (drawn depth, nose tip to occiput, <=1.06
       of headlength), and the nose tip is what a bare-bones budget of
       "occiput reach plus nose reach plus twice the scalp" spends most
       of its overshoot on — a faceted core's own bare circumference
       already needs more solved scalp than a smooth one (see THE SIZE
       BUDGET above), which eats into the same depth allowance from the
       other side. Pulling BOTH ends in — the occiput from cz*1.00 to
       cz*0.83, the nose tip from cz*1.19 to cz*1.03 — is what clears
       1.06 on every one of seeds 12345/777/4242 without flattening the
       nose to nothing, which a cut at the tip alone would have done;
       0.03cz of forward reach beyond the root and base is not a large
       nose, but it is still visibly one in every render checked.

       THE ROOT/TIP/BASE RAMP, NOT A BUMP — which failed twice, in the
       stack this replaces. First as a symmetric capsule bulging most at
       its own midpoint: it receded at both ends, and a real nose does
       not recede at the tip. Second, more subtly, as a BEAK: root-to-tip
       and tip-to-base each given their own explicit cap, which pinched
       the bridge to a point from both sides because the tip where they
       meet is an interior joint, not a free end. Left uncapped, both
       segments take their axial thickness from their own local width at
       every point instead of one borrowed value, and the ridge runs
       through the tip rather than closing on it. Nothing about
       sharpening the cross-section touches either of those two facts, so
       both fixes carry over unchanged. */
    {
      const tipH = lerp(noseBaseH, eyeH, 0.32);
      const P0 = vmad(vmad(sk.A, U, eyeH), F, cz * 0.96);        // root, at sellion height
      const P1 = vmad(vmad(sk.A, U, tipH), F, cz * 1.03);        // tip: the most forward point on the head
      const P2 = vmad(vmad(sk.A, U, noseBaseH), F, cz * 0.98);   // base, at the measured nose-base
      const f1 = along(P0, P1, L), f2 = along(P1, P2, L);
      const wR = cy * 0.075, wT = cy * 0.15, wB = cy * 0.17;   // EST: root narrow, base flared at the alae
      const NK = 4;    // EST: tighter than the head's own K — a nose bridge is a small form
      const bevel = (P, A, fseg, half, deg, f) => {
        const core = sdSegSE(P, A === P0 ? P0 : P1, A === P0 ? P1 : P2, fseg,
          A === P0 ? wR : wT, A === P0 ? wR * 1.3 : wT * 1.05,
          A === P0 ? wT : wB, A === P0 ? wT * 1.05 : wB * 1.25, 3.4, undefined, f);
        // the segment's own lateral axis (fseg[1]) is what "left" and
        // "right" mean on the bridge; tilting each bevel's normal up
        // toward fseg[2] (the segment's own outward-from-face axis) by
        // 35° is what puts the ridge along the ramp's ridge line instead
        // of along its belly
        let dd = core;
        for (const sgn of [1, -1]) {
          const n = tilt(vmul(fseg[1], sgn), fseg[2], 35);
          dd = smax(dd, pdist(P, A, n, f), NK);
        }
        return dd;
      };
      put('head', (P, f) => bevel(P, P0, f1, wR, 0, f));
      put('head', (P, f) => bevel(P, P1, f2, wT, 0, f));

      /* THE ROOT NOTCH. Without it the bridge simply starts, unioned flat
         against the forehead/brow-shelf edge — a nose that begins rather
         than one that is set INTO the face. A shallow cut right at the
         sellion, small enough to stay clear of the eye sockets on either
         side, gives the bridge a floor to rise out of. Same technique as
         the eye sockets below: centred mostly above the point it marks so
         only its lower edge actually bites. Unchanged from the smooth
         stack — the sellion's own position did not move. */
      const rc = vmad(vmad(sk.A, U, eyeH + cy * 0.05), F, cz * 1.02);
      put('head', (P) => sdBlobSE(P, rc, fr, cy * 0.09, cy * 0.065, cy * 0.09, 2), true);
    }

    /* THE EYE SOCKETS, which are the one part of a face that has to be
       taken AWAY. Everything else here adds or is a plane's own
       intersection — and a face built only from additions is a face with
       no eyes in it, because an eye sits in a hollow. So these are cuts,
       the same mechanism and the same numbers the smooth stack used: the
       socket's own position and size are about the eye, not about what
       kind of mass surrounds it, so nothing about going planar moved
       them. Sized up from the first pass, which read as barely a shadow
       at portrait scale: the vertical reach was 0.20 of half-breadth
       (about 14mm) and is now 0.28 (about 20mm). Centred at eyeH — the
       same canon height the self-test checks — with the lateral offset
       at 0.42 of half-breadth so the pair leaves the root-notch cut, at
       0.09 of half-breadth, clear daylight either side of the midline. */
    for (const sgn of [1, -1]) {
      const c = vmad(vmad(vmad(sk.A, U, eyeH), F, cz * 1.10), L, sgn * cy * 0.42);
      put('head', (P) => sdBlobSE(P, c, fr, cy * 0.28, cy * 0.24, cy * 0.34, 2.1), true);
    }

    /* THE BROW RIDGE and THE CHEEKBONE are no longer built here — this is
       the biggest single change this rebuild makes, and it is worth
       saying plainly why. Both used to be a separate sdSegSE capsule,
       unioned on top of the smooth stack: a flattened oval for the brow
       spanning nearly the full width, a thinner flattened one for the
       cheekbone running back toward the ear. Rendered at portrait scale
       (head only, three-quarter, seed 12345) the brow one did not read
       as a supraorbital ridge — it read as the brim of a cap, a hard
       silhouette edge sitting ON TOP of the smooth forehead below it,
       because a capsule glued onto a smooth mass has its OWN silhouette
       and the join between the two shows as a seam whatever the fascia
       blend. The cheekbone capsule had an earlier, related failure on
       record: a near-circular cross-section (0.11 by 0.09 of half-
       breadth) at a scale where a thin round ridge sitting at a shallow
       angle to the sampling rays does not resample consistently ring to
       ring, and traced as a jittering line rather than an edge — the
       "wiggly worm" on an old review sheet. Flattening it to 0.22 by
       0.08 fixed the sampling jitter and left the seam-against-a-smooth-
       mass problem untouched, because that problem was never about the
       capsule's own cross-section.

       Both ridges are now simply WHERE TWO PLANES MEET: the brow is the
       forehead plane meeting the brow-shelf plane, the cheekbone is the
       front-cheek plane meeting the side-cheek plane, both defined
       above. There is no added capsule and so no seam for one to show —
       the ridge is a property of the underlying mass, which is the
       entire point of building a head from planes instead of adding
       features to a smooth one. The "wiggly worm" lesson still explains
       exactly why a thin round ridge was the wrong primitive here; it
       just no longer needs a fix within its own technique, because the
       technique changed. */

    /* THE LIPS. A small step at the canon height a third of the way up
       from the chin to the nose base: lips are a change in surface angle
       more than they are a projection, and the failure mode on record
       here is a fat little pillow, not a flat one. Pulled in slightly
       from the smooth stack's cz*1.00 anchor to cz*0.90, which is still
       a clear ~8-9mm proud of the muzzle plane's own cz*0.78 at this
       height — enough to read as lips sitting on the mouth plane, not
       so much that they re-inflate the depth budget the planes above
       were sized against. */
    {
      const half = cy * 0.30;   // EST: mouth width, roughly under the nose alae
      /* cz*0.82, walked in from 0.90: the measured profile put the lip
         pillow at z=108 against the brow's own 101-108 — a muzzle as proud
         as the forehead reads as a duckbill from the side. Ten millimetres
         behind the brow plane is where a mouth sits. */
      const A = vmad(vmad(sk.A, U, mouthH), F, cz * 0.82);
      const B = vmad(A, L, -half * 2);
      const Fr = [L, U, F];
      put('head', (P, f) => sdSegSE(P, vmad(A, L, half), B, Fr,
        cy * 0.045, cy * 0.038, cy * 0.045, cy * 0.038, 2.4, cy * 0.03, f));
    }

    /* THE CHIN BOSS is also gone as a separate shape — merged into the
       chin planes rather than layered on top of them. The smooth stack
       needed a boss because its own jaw taper had to stay a plausible
       cross-section rather than a point, which left it under-projecting;
       a round blob added the rest of the forward reach a chin actually
       has. The chin front pad here does not have that constraint — it is
       a flat facet at its own explicit forward offset (cz*0.90, "a
       little behind the brow" the way the header of this file has always
       wanted), so the projection is a property of the plane's own
       position instead of a second shape added to reach it. */

    /* THE EARS, which sit ON the tragion because the tragion IS the ear.
       Kept as the smooth stack's own flattened-oval-angled-back capsule —
       ears are cartilage, not bone, and nothing about "more planar" asks
       for a faceted ear. Standoff pulled in from cy*1.02 (fractionally
       PAST the skull's own widest point) and thinned from a cy*0.19 max
       cross-section to cy*0.14, because the proportions critic
       (tools/proportions.js) charges the whole head's drawn width against
       ears included, and the old figures — 1.17 of measured headbreadth,
       against a crown-only (no-ear) band of 0.98-1.10 — were the ear
       standing nearly a full old-parietal's-width proud of the skull
       rather than sitting against it. (An EARLIER pass through this
       rebuild recorded the standoff as pulled specifically to cy*0.90;
       the number actually committed was cy*1.00, and the two sat
       undetected against each other for a full construction because
       nothing checked the comment against the code it was describing —
       worth naming so the next person trusts the CODE over the prose
       when the two disagree, here or anywhere else in this file.)

       THE STANDOFF IS NOW A FORMULA, not the flat cy*1.00 that mismatch
       left behind, for the identical reason the temple plane's ratio
       is (see THE TEMPLE'S RATIO IS NOT A CONSTANT, in the paired loop
       above): the ear is the single widest thing on the head on most
       bodies, so `head drawn W / measured W` is really an ear check
       wearing a head-shaped costume, and it inherits the same tension
       — a round-headed body (roundness 0.817) needed room to breathe
       up near the 1.20 ceiling's OPPOSITE problem, `shoulders / drawn
       head W` and the H/W canon both crowding THEIR ceilings when the
       ear was pulled in enough for an elongated body (0.738) to clear
       1.20. EAR_K is solved the same way TEMPLE_K was — against
       tools/proportions.js across eight bodies, not derived — and
       shares ROUND_REF and the same clamped `roundness` rather than
       computing its own version of the same fact about the body. */

    /* THE BASE MOVED HERE TOO, 0.99 to 1.03, the same shared-scalp-budget
       story as the temple's own base above: less free width comes back
       from `f` now than when 0.99 was fit, and `shoulders / drawn head W`
       felt it first — two of eight bodies over the 3.10 ceiling once the
       occiput's depth was restored (above) and the crown-band floor
       cleared without also widening the ear that mostly sets this
       check. EAR_K keeps its own value and keeps sharing ROUND_REF — a
       round head still needs proportionally less of this bump than an
       elongated one does, that relationship did not change, only the
       flat floor under it did. NOTE: pushed to 1.04 in a coarser search
       first, one body's OWN drawn-W reading dropped sharply (1.062 to
       0.986) instead of continuing to rise with it — found empirically,
       not chased to a root cause, but real enough that 1.03 is a wall
       found by testing rather than a floor left on the table; do not
       push this one on faith. Solved against tools/proportions.js across
       the same eight bodies. */
    const EAR_K = 1.2;   // EST, solved against tools/proportions.js — see above
    const earRatio = 1.03 - EAR_K * (ROUND_REF - roundness);
    {
      const TILT = 15 * Math.PI / 180;
      const D = vnorm(vsub(vmul(U, Math.cos(TILT)), vmul(F, Math.sin(TILT))));   // up-and-back
      const Dp = vnorm(vadd(vmul(U, Math.sin(TILT)), vmul(F, Math.cos(TILT))));  // the flat oval's width
      const half = (browH - noseBaseH) * 0.5 / Math.cos(TILT);
      for (const sgn of [1, -1]) {
        const mid = vmad(vmad(vmad(sk.A, U, (browH + noseBaseH) * 0.5), F, cz * 0.00),
          L, sgn * cy * earRatio);
        const A = vmad(mid, D, half);    // top, tipped back
        const B = vmad(mid, D, -half);   // base
        const Fr = [D, L, Dp];
        put('head', (P, f) => sdSegSE(P, A, B, Fr,
          cy * 0.11, cy * 0.17, cy * 0.085, cy * 0.13, 2.2, cy * 0.09, f));
      }
    }
  }
}

  });

  // the head part's own sampling and blend, kept beside its geometry
  GK.field.tweakPart('head', { fascia: 26, ns: 44, na: 52 });
})(window.GK = window.GK || {});
