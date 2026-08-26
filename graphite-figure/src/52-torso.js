/* ============================================================================
   GRAPHITE FIGURE — src/52-torso.js
   The trunk's surface anatomy: everything the ribcage, abdomen and pelvis
   blocks in 50-field.js do not say. Neck straps, the shoulder's slope, and
   the forms of the chest and back.

   Registered into the field's volume build so the torso can be worked
   without the head or the limbs moving underneath it.
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;
  const { vadd, vsub, vmul, vmad, vnorm, lerp, clamp01 } = M;

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
   height, which ANSUR measures. The thickness is EST. */
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

/* THE TRAPEZIUS, as the slope a shoulder hangs from. The clavicle and
   the scapula are thin struts, so without this the neck met the shoulder
   at a corner and the figure had the squared-off look of a coat hanger.
   Both ends measured: the medial end sits on the cervical spine, the
   lateral end on the acromion the clavicle already aims at. */
for (const side of ['L', 'R']) {
  const cl = rig.bones['clavicle.' + side], c7 = rig.bones.C7;
  if (!cl || !c7) continue;
  /* Sized DOWN hard after the first review sheet: at 0.075 of biacromial,
     with its medial end at C7's own height, this drew a linebacker's hump
     that swallowed the neck from every angle — the classic no-neck figure.
     The upper trapezius is a SLOPE, not a mass: it starts below C7, stays
     thin, and its job in silhouette is only to make the neck-to-shoulder
     transition a curve instead of a corner. */
  const t1 = rig.bones.T1 || c7;
  const A = vmad(t1.A, t1.frame[2], -vertR * 0.5);
  const B = vmad(cl.B, cl.frame[2], -m.chestdepth * 0.10);
  const F = frameAlong(A, B, [1, 0, 0]);
  const t = m.biacromialbreadth * 0.042;          // EST
  put('trunk', (P, f) => sdSegSE(P, A, B, F,
    t * 1.1, t * 0.7, t * 0.9, t * 0.8, 2.3, t * 0.5, f));
}

  });
})(window.GK = window.GK || {});
