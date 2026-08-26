/* ============================================================================
   GRAPHITE FIGURE — src/53-limbs.js
   The limbs' surface anatomy beyond bone, muscle and soft tissue: the forms
   at the joints and the extremities. A knee is a patella and two condyle
   planes, an ankle is two malleoli with a tendon behind it, a foot is a
   wedge with an instep — none of which fall out of capsules.

   Registered into the field's volume build so the extremities can be worked
   without the head or the torso moving underneath them.
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;
  const { vadd, vsub, vmul, vmad, vnorm, lerp, clamp01 } = M;

  GK.field.registerVolumes('limbs', (ctx) => {
    const { rig, fig, m, g, put, vertR, smin, smax, sdSegSE, sdBlobSE, sdCapsule,
      frameAlong, exponentFor, CORE } = ctx;

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

  });
})(window.GK = window.GK || {});
