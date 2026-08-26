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
  const { vadd, vsub, vmul, vmad, vnorm, lerp, clamp01 } = M;

  GK.field.registerVolumes('head', (ctx) => {
    const { rig, fig, m, g, put, vertR, smin, smax, sdSegSE, sdBlobSE,
      frameAlong, exponentFor, CORE } = ctx;
// ---- the head --------------------------------------------------------
/* A HEAD IS ONE SECTION CHANGING, NOT TWO SOLIDS MEETING.
   Two earlier versions got this wrong in opposite directions. The first
   was a single superellipsoid on head length, breadth and height: the
   right size and a featureless egg, because a head does not read as a
   head by being the right size. The second was a braincase plus a
   separate jaw, which read as two balls on a stalk however much fascia
   was thrown at the join — a step in depth of thirty millimetres between
   two closed forms is a step, and smoothing it only rounds the corner.

   What a head actually is, going down: a vault that is nearly spherical,
   widest at the brow, narrowing below the cheekbone, and leaning FORWARD
   the whole way, so the chin ends up well anterior of the ear and a
   little behind the brow. That is one section changing along one axis,
   which is the same construction the ribcage uses, and it gives a jaw
   without ever building one.

   Every width and depth here is a fraction of a measured number — head
   breadth, head length, bizygomatic breadth — and every height is a
   fraction of a measured one, tragion-to-vertex above and menton-to-
   sellion below. The fractions themselves are EST: they are the shape of
   a head, and no tape measures those.

   THIRD PASS, against a review sheet rather than a silhouette. The stack
   above rendered a believable SIZE from every angle and a caricature from
   every one of them too: a hooded egg, not a skull. Three things were
   wrong with the numbers rather than the idea.

   First, the width table narrowed almost a third by the time it was a
   third of the way up from the brow (0.93 of full breadth, then 0.78),
   which is what a narrowing cone does and not what a cranium does. A
   parietal stays close to its own widest breadth for most of the vault's
   height and only gives it up in the top quarter. Second, the forward-
   offset table was positive at every single station, brow to vertex —
   the whole vault leaning the SAME way the face does — so there was
   nowhere for the skull to be wider behind the ear than in front of it,
   which is the entire definition of an occiput. And third, the two end
   stations were given a fixed fraction of the measured span (0.93 of
   tragion-to-vertex, 0.90 of menton-to-sellion) and then a rounding cap
   ON TOP of that, so the actual vertex came out 7-10% past the measured
   one — a figure quietly taller in the skull than its own stature said.

   All three are fixed the same way: by computing rather than guessing
   the quantity that was wrong. The width table now stays above 0.9 of
   full breadth for four of its seven above-brow stations. The offset
   table is DRAWN, not signed uniformly — it rises through the face,
   peaks near the brow, and is negative for the whole upper vault, which
   is what puts the most-posterior point of the skull at ear height
   rather than at the crown and gives the crown itself room to recede
   into a forehead. And the two end stations solve for their own height
   given their own cap, so tragion-to-vertex and menton-to-sellion are
   hit on the nose rather than overshot. */
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
    const n = exponentFor(cz, cy, CORE.head * m.headcircumference);

    /* THE CANON. Four numbers a life-drawing manual states as fact and
       ANSUR has no landmark for, because they are ratios between OTHER
       landmarks rather than landmarks themselves: the eyes sit at the
       vertical mid-height of the whole head; the base of the nose is
       halfway from the brow to the chin (equivalently: brow-to-nose-base
       and nose-base-to-chin are the same span, the classic facial
       "thirds"); the ears run from the brow line to the nose base; the
       mouth sits a third of the way up from the chin to the nose base.
       Encoding them as formulas rather than as separately-tuned station
       heights is what makes them checkable — the self-test recomputes the
       same four ratios from the rendered geometry and they either hold or
       they don't, on every seed, rather than being a claim about the
       numbers below that nobody re-derives.

       browH doubles as the widest point of the vault AND the height
       fitFat() samples for head circumference (SITES has head at s=0.16,
       and s is a fraction of tragion-to-vertex on the skull bone, so
       0.16 * up is exactly this height) — one fewer place for the two to
       silently disagree. */
    const browH = up * 0.16;
    const eyeH = (up - dn) * 0.5;                    // canon: mid vertex-to-chin
    const noseBaseH = (browH - dn) * 0.5;            // canon: halfway brow-to-chin
    const mouthH = -dn + (noseBaseH + dn) / 3;        // canon: a third up from chin

    /* height above the tragion | half-breadth | half-depth | how far the
       section's own centre sits forward of the ear (negative: behind it).

       The two end stations solve their own height so the CAP lands on the
       measured number instead of past it — see the note above. Interior
       heights are plain fractions of up/dn, which is what they always
       were; only the fractions changed. */
    const capTop = () => Math.min(cy * 0.34, cz * 0.30) * 0.9;
    // NOT *0.9 here — see the note below on why the chin needs the looser
    // of the two.
    const capBot = () => Math.min(zy * 0.50, cz * 0.44);
    const ST = [
      [up - capTop(), cy * 0.34, cz * 0.30, -cz * 0.06],  // vertex
      [up * 0.68, cy * 0.62, cz * 0.52, -cz * 0.05],
      [up * 0.52, cy * 0.86, cz * 0.74, -cz * 0.02],
      [up * 0.34, cy * 0.99, cz * 1.00, cz * 0.05],   // occiput: widest AND deepest
      [browH, cy * 0.97, cz * 0.92, cz * 0.14],       // brow: widest at face height
      [-dn * 0.14, zy * 1.00, cz * 0.86, cz * 0.20],  // cheekbone, at its own measure
      [-dn * 0.58, zy * 0.76, cz * 0.62, cz * 0.30],  // the angle of the jaw
      /* chin. A first cut here narrowed hard (zy*0.42, against the jaw's
         0.76) AND pushed forward hard (offset cz*0.42) in the same short
         segment, which is a cone by construction — a shape that shrinks
         in cross-section and reaches further along its axis at the same
         end is a point, whatever it's called. It rendered as one, in
         profile, on every seed. Narrowing less (0.50) and reaching less
         (0.36 — the rest of the forward reach a real chin has comes from
         the boss below, which can be round about it in a way one more
         tapering stack station cannot) keeps this station a plausible
         jaw cross-section rather than a nose cast in the wrong place. */
      [-(dn - capBot()), zy * 0.50, cz * 0.44, cz * 0.36],  // chin
    ];
    const at = (st) => vmad(vmad(sk.A, fr[0], st[0]), fr[2], st[3]);
    for (let i = 0; i < ST.length - 1; i++) {
      const a0 = ST[i], a1 = ST[i + 1];
      const A = at(a0), B = at(a1);
      // Caps only at the two ends of the whole stack; in between the
      // segments overlap and a cap would show as a bulge inside the head.
      const cap = i === 0 ? Math.min(a0[1], a0[2]) * 0.9
        : i === ST.length - 2 ? Math.min(a1[1], a1[2]) * 0.9 : undefined;
      put('head', (P, f) => sdSegSE(P, A, B, fr, a0[1], a0[2], a1[1], a1[2], n, cap, f));
    }

    /* THE NOSE. In profile it is the most identifying thing on a head,
       and it is the one part of a face that is a FORM rather than a mark:
       no amount of line work on a smooth face plane produces it, because
       what a nose does is break the silhouette. ANSUR measures nothing
       about it — menton-to-sellion reaches its root and stops — so every
       number here is EST, anchored to the head depth that IS measured.

       A WEDGE, NOT A BUMP — which failed twice. First as a symmetric
       capsule bulging most at its own midpoint: it receded at both ends,
       and a real nose does not recede at the tip. Fixed by making the
       three points a RAMP instead of an arch: root, tip and base project
       further forward in that order so the surface keeps climbing until
       the tip and only turns back after it, with a flatter exponent
       (2.6, against the 2.2 everything round elsewhere uses) so it reads
       as two faces meeting at a ridge rather than a rounded pipe.

       Second, more subtly, as a BEAK: root-to-tip and tip-to-base were
       each given their own explicit cap, which is the right call at a
       stack's two true free ends (see the vault above) and the wrong one
       here, because the tip where they meet is not a free end, it is an
       interior joint — exactly the case the vault's own comment warns
       about. A cap forces ONE axial thickness across its whole segment,
       and root and tip are not close to the same size, so root's own
       small cap, forced onto the tip end too, pinched the bridge to a
       point and tip's own cap, forced back onto the same point from the
       other side, pinched it again — two capsule ends rounding toward
       each other instead of one continuous ridge passing through. Left
       uncapped, both segments take their axial thickness from their own
       local width at every point instead of one borrowed value, and the
       ridge runs through the tip rather than closing on it. */
    {
      const tipH = lerp(noseBaseH, eyeH, 0.32);
      const P0 = vmad(vmad(sk.A, fr[0], eyeH), fr[2], cz * 1.00);        // root, at sellion height
      const P1 = vmad(vmad(sk.A, fr[0], tipH), fr[2], cz * 1.19);        // tip: the most forward point on the head
      const P2 = vmad(vmad(sk.A, fr[0], noseBaseH), fr[2], cz * 1.06);   // base, at the measured nose-base
      const f1 = along(P0, P1, fr[1]), f2 = along(P1, P2, fr[1]);
      const wR = cy * 0.075, wT = cy * 0.15, wB = cy * 0.17;   // EST: root narrow, base flared at the alae
      put('head', (P, f) => sdSegSE(P, P0, P1, f1, wR, wR * 1.3, wT, wT * 1.05, 2.6, undefined, f));
      put('head', (P, f) => sdSegSE(P, P1, P2, f2, wT, wT * 1.05, wB, wB * 1.25, 2.6, undefined, f));

      /* THE ROOT NOTCH. Without it the bridge simply starts, at whatever
         width P0 was given, unioned flat against the brow — a nose that
         begins rather than one that is set INTO the face. A shallow cut
         right at the sellion, small enough to stay clear of the eye
         sockets on either side, gives the bridge a floor to rise out of.
         Same technique as the eye sockets below: centred mostly above the
         point it marks so only its lower edge actually bites. */
      const rc = vmad(vmad(sk.A, fr[0], eyeH + cy * 0.05), fr[2], cz * 1.05);
      put('head', (P) => sdBlobSE(P, rc, fr, cy * 0.09, cy * 0.065, cy * 0.09, 2), true);
    }

    /* THE BROW. A shallow ridge, and shallow is the point: overdone it
       reads as a scowl, absent it leaves the forehead running smoothly
       into the eye socket and the face has no shelf to sit under. Set at
       browH — the same height the vault is widest, which is where a real
       supraorbital ridge sits relative to the parietals. */
    {
      const half = cy * 0.62;   // EST: brows span less than temple-to-temple
      const A = vmad(vmad(sk.A, fr[0], browH), fr[2], cz * 1.04);
      const B = vmad(A, fr[1], -half * 2);
      const F = [fr[1], fr[0], fr[2]];
      put('head', (P, f) => sdSegSE(P, vmad(A, fr[1], half), B, F,
        cy * 0.15, cy * 0.11, cy * 0.15, cy * 0.11, 2.5, cy * 0.07, f));
    }

    /* THE EYE SOCKETS, which are the one part of a face that has to be
       taken AWAY. Everything else here adds — a brow, a nose, a
       cheekbone — and a face built only from additions is a face with no
       eyes in it, because an eye sits in a hollow. So these are cuts.

       Sized up from the first pass, which read as barely a shadow at
       portrait scale: the vertical reach was 0.20 of half-breadth (about
       14mm) and is now 0.28 (about 20mm), because a socket that shallow
       vanishes into the smin fascia before it ever reaches a printed
       page. Centred at eyeH — the same canon height the self-test
       checks — with the lateral offset pulled in to 0.42 (from 0.40) so
       the pair leaves the root-notch cut, at 0.09 of half-breadth, clear
       daylight either side of the midline instead of the two sockets
       meeting under the bridge. */
    for (const sgn of [1, -1]) {
      const c = vmad(vmad(vmad(sk.A, fr[0], eyeH), fr[2], cz * 1.16),
        fr[1], sgn * cy * 0.42);
      put('head', (P) => sdBlobSE(P, c, fr, cy * 0.28, cy * 0.24, cy * 0.34, 2.1), true);
    }

    /* THE CHEEKBONE, running from just behind the outer eye corner back
       toward the ear. It is a STEP — the plane above it catches the
       light and the plane below it does not — and a step needs a flat
       side, not a round one. The first pass gave it a near-circular
       cross-section (0.11 by 0.09 of half-breadth) at a scale where a
       thin round ridge sitting at a shallow angle to the sampling rays
       does not resample consistently ring to ring, and it traced as a
       jittering line rather than an edge — the "wiggly worm" on the
       review sheet. Flattened hard (0.22 by 0.08) it presents a face
       wide enough to sample the same way from its neighbours on both
       sides, which is what makes it read as a step instead of a seam. */
    for (const sgn of [1, -1]) {
      const A = vmad(vmad(vmad(sk.A, fr[0], eyeH + cy * 0.02), fr[2], cz * 1.10),
        fr[1], sgn * cy * 0.42);
      const B = vmad(vmad(vmad(sk.A, fr[0], -dn * 0.05), fr[2], cz * 0.55),
        fr[1], sgn * cy * 0.80);
      const F = along(A, B, fr[0]);
      put('head', (P, f) => sdSegSE(P, A, B, F,
        cy * 0.22, cy * 0.08, cy * 0.18, cy * 0.07, 2.4, cy * 0.06, f));
    }

    /* THE LIPS. Absent entirely before this pass — the jaw stack ran from
       cheekbone straight to chin with nothing marking the mouth at all.
       A small step, at the canon height a third of the way up from the
       chin to the nose base, is enough: lips are a change in surface
       angle more than they are a projection, and the failure mode here
       is a fat little pillow, not a flat one. */
    {
      const half = cy * 0.30;   // EST: mouth width, roughly under the nose alae
      const A = vmad(vmad(sk.A, fr[0], mouthH), fr[2], cz * 1.00);
      const B = vmad(A, fr[1], -half * 2);
      const F = [fr[1], fr[0], fr[2]];
      put('head', (P, f) => sdSegSE(P, vmad(A, fr[1], half), B, F,
        cy * 0.055, cy * 0.045, cy * 0.055, cy * 0.045, 2.4, cy * 0.03, f));
    }

    /* THE CHIN, as a BOSS rather than as wherever the jaw stack's own
       taper happens to end. The stack alone (see its own comment above)
       is kept a plausible cross-section rather than a point, which
       leaves it under-projecting — real profiles run close to plumb
       from brow to chin, and the stack alone falls short of that by
       itself. This is a small added knob, not a change to the stack,
       because the jaw still needs its own gentler taper for the stack
       to close cleanly without pointing; the roundness and the rest of
       the forward reach a chin actually has come from layering a ROUND
       blob on top of that taper, the same way the nose layers onto the
       face — one shape supplying bulk, a second supplying shape, rather
       than asking one stack station to be both at once.

       ax is kept inside the stack's own chin cap (dn*0.10 of headroom
       below this centre) rather than at a round number: past it, the
       boss's own lower edge pokes below the stack's true bottom and
       draws a small rectangular tab hanging under the jaw — seen on an
       earlier render of this pass, head-only, chin corner. */
    {
      const c = vmad(vmad(sk.A, fr[0], -dn * 0.90), fr[2], cz * 0.90);
      put('head', (P, f) => sdBlobSE(P, c, fr, dn * 0.10, zy * 0.26, cz * 0.14, 2.2, f));
    }

    /* THE EARS, which sit ON the tragion because the tragion IS the ear.
       A FLATTENED OVAL ANGLED BACK, not the short lateral nub the first
       pass drew — that version ran its long axis OUT from the head (a
       capsule from 0.84 to 1.05 of half-breadth, barely past the vault's
       own width at that height) rather than UP the side of it, so there
       was almost no ear left standing proud of the skull's own
       silhouette and none of it looked like an ear's actual proportions.

       Here the long axis runs from the brow line down to the nose base —
       the same span the canon assigns an ear — tipped back 15° off
       vertical (EST: ANSUR has no ear-angle landmark; 15° is the ordinary
       amount a life-drawing reference gives it, and it is also what
       "roughly parallel to the jaw line" comes out to against this jaw).
       The cross-section is genuinely flattened: thin along the skull's
       own lateral axis (an ear is not thick) and wide in the tilted
       fore-aft axis perpendicular to it (an ear is a disc, not a rod). */
    {
      const TILT = 15 * Math.PI / 180;
      const D = vnorm(vsub(vmul(fr[0], Math.cos(TILT)), vmul(fr[2], Math.sin(TILT))));   // up-and-back
      const Dp = vnorm(vadd(vmul(fr[0], Math.sin(TILT)), vmul(fr[2], Math.cos(TILT))));  // the flat oval's width
      const half = (browH - noseBaseH) * 0.5 / Math.cos(TILT);
      for (const sgn of [1, -1]) {
        const mid = vmad(vmad(vmad(sk.A, fr[0], (browH + noseBaseH) * 0.5), fr[2], cz * 0.02),
          fr[1], sgn * cy * 1.02);
        const A = vmad(mid, D, half);    // top, tipped back
        const B = vmad(mid, D, -half);   // base
        const F = [D, fr[1], Dp];
        put('head', (P, f) => sdSegSE(P, A, B, F,
          cy * 0.13, cy * 0.19, cy * 0.10, cy * 0.15, 2.2, cy * 0.10, f));
      }
    }
  }
}

  });

  // the head part's own sampling and blend, kept beside its geometry
  GK.field.tweakPart('head', { fascia: 26, ns: 44, na: 52 });
})(window.GK = window.GK || {});
