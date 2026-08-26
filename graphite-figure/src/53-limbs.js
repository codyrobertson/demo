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
    // nothing yet: the feet still come from 50-field.js's own block, and the
    // joint forms land here
  });
})(window.GK = window.GK || {});
