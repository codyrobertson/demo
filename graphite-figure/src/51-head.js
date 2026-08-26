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
   a head, and no tape measures those. */
{
  const sk = rig.bones.skull;
  if (sk) {
    const fr = sk.frame;                            // +X up, +Y left, +Z front
    const cz = CORE.head * m.headlength * 0.5;      // anteroposterior
    const cy = CORE.head * m.headbreadth * 0.5;     // lateral
    const zy = CORE.head * m.bizygomaticbreadth * 0.5;
    const up = m.tragiontopofhead, dn = m.mentonsellionlength;
    const n = exponentFor(cz, cy, CORE.head * m.headcircumference);

    /* height above the tragion | half-breadth | half-depth | how far the
       section's own centre sits forward of the ear.

       Eight stations, and the four above the brow are what make a dome.
       A first pass used two up there and the vault came out a cylinder
       with a lid: between the brow and the upper vault the width fell by
       seven per cent over forty millimetres, which is not a curve, and
       the head read as a slab from every angle. A cranium loses most of
       its width in its top third. */
    const ST = [
      [up * 0.93, cy * 0.30, cz * 0.32, cz * 0.02],   // vertex, less its own cap
      [up * 0.86, cy * 0.55, cz * 0.58, cz * 0.02],
      [up * 0.66, cy * 0.78, cz * 0.80, cz * 0.03],
      [up * 0.42, cy * 0.93, cz * 0.94, cz * 0.04],
      [up * 0.12, cy * 1.00, cz * 1.00, cz * 0.06],   // brow, the widest
      [-dn * 0.16, zy * 1.00, cz * 0.94, cz * 0.15],  // cheekbone
      [-dn * 0.55, zy * 0.74, cz * 0.72, cz * 0.26],  // the angle of the jaw
      [-dn * 0.90, zy * 0.40, cz * 0.44, cz * 0.44],  // chin
    ];
    const at = (st) => vmad(vmad(sk.A, fr[0], st[0]), fr[2], st[3]);
    const along = frameAlong;
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
       number here is EST, anchored to the face height and head length
       that ARE measured, and the shape is the ordinary one: a bridge
       running down and forward from the root, a tip beyond the brow
       line, and an underside coming back to the lip. */
    {
      const P0 = vmad(vmad(sk.A, fr[0], -dn * 0.02), fr[2], cz * 0.86);   // root
      const P1 = vmad(vmad(sk.A, fr[0], -dn * 0.40), fr[2], cz * 1.16);   // tip
      const P2 = vmad(vmad(sk.A, fr[0], -dn * 0.50), fr[2], cz * 0.94);   // under
      const f1 = along(P0, P1, fr[1]), f2 = along(P1, P2, fr[1]);
      const w = cy * 0.10;                       // EST: a nose root, ~7mm
      put('head', (P, f) => sdSegSE(P, P0, P1, f1, w, w * 0.9, w * 1.9, w * 1.7, 2.2, w * 0.6, f));
      put('head', (P, f) => sdSegSE(P, P1, P2, f2, w * 1.9, w * 1.7, w * 1.5, w * 1.2, 2.2, w * 0.5, f));
    }

    /* THE BROW. A shallow ridge, and shallow is the point: overdone it
       reads as a scowl, absent it leaves the forehead running smoothly
       into the eye socket and the face has no shelf to sit under. */
    {
      const b = cy * 0.56;
      const A = vmad(vmad(sk.A, fr[0], dn * 0.10), fr[2], cz * 0.94);
      const B = vmad(A, fr[1], -b * 2);
      const F = [fr[1], fr[0], fr[2]];
      put('head', (P, f) => sdSegSE(P, vmad(A, fr[1], b), B, F,
        cy * 0.13, cy * 0.10, cy * 0.13, cy * 0.10, 2.4, cy * 0.06, f));
    }

    /* THE EYE SOCKETS, which are the one part of a face that has to be
       taken AWAY. Everything else here adds — a brow, a nose, a
       cheekbone — and a face built only from additions is a face with no
       eyes in it, because an eye sits in a hollow. So these are cuts, and
       shallow ones: the sphere doing the cutting sits mostly in front of
       the face and only its back bites, which is what makes a scoop
       rather than a hole. */
    for (const sgn of [1, -1]) {
      const c = vmad(vmad(vmad(sk.A, fr[0], dn * 0.02), fr[2], cz * 1.16),
        fr[1], sgn * cy * 0.40);
      put('head', (P) => sdBlobSE(P, c, fr, cy * 0.20, cy * 0.36, cy * 0.34, 2.1), true);
    }

    /* THE CHEEKBONE, running from just in front of the ear forward and
       down under the eye. It is a narrow ridge and it does most of the
       work of saying which way a head is turned — the plane above it
       catches the light and the plane below it does not, and that step is
       a face's widest and most legible feature after the nose. */
    for (const sgn of [1, -1]) {
      const A = vmad(vmad(vmad(sk.A, fr[0], dn * 0.02), fr[2], -cz * 0.04),
        fr[1], sgn * cy * 0.86);
      const B = vmad(vmad(vmad(sk.A, fr[0], -dn * 0.06), fr[2], cz * 0.74),
        fr[1], sgn * cy * 0.46);
      const F = along(A, B, fr[0]);
      put('head', (P, f) => sdSegSE(P, A, B, F,
        cy * 0.11, cy * 0.09, cy * 0.13, cy * 0.10, 2.3, cy * 0.05, f));
    }

    /* THE EARS, which sit ON the tragion because the tragion IS the ear.
       Small, and worth the two solids anyway: an ear is the only thing
       breaking the silhouette of a head seen from the front or the back,
       and a head without them reads as a mannequin's block however good
       the vault is. */
    for (const sgn of [1, -1]) {
      const c = vmad(vmad(sk.A, fr[0], dn * 0.06), fr[2], -cz * 0.06);
      const A = vmad(c, fr[1], sgn * cy * 0.84);
      const B = vmad(c, fr[1], sgn * cy * 1.05);
      const F = [vmul(fr[1], sgn), fr[0], fr[2]];
      put('head', (P, f) => sdSegSE(P, A, B, F,
        dn * 0.30, dn * 0.17, dn * 0.26, dn * 0.14, 2.3, cy * 0.05, f));
    }
  }
}

  });

  // the head part's own sampling and blend, kept beside its geometry
  GK.field.tweakPart('head', { fascia: 26, ns: 44, na: 52 });
})(window.GK = window.GK || {});
