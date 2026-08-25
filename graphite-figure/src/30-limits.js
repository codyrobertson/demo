/* ============================================================================
   GRAPHITE FIGURE — src/30-limits.js
   Turn the measured ranges in 00-refdata.js into a per-bone envelope, and
   clamp a pose into it.

   WHY THIS IS NOT A TABLE LOOKUP. Two reasons, and both are the difference
   between a skeleton that cannot enter an impossible pose and one that merely
   has numbers written next to its joints.

   First, a group rotation is shared out along a chain by weight, so the thing
   that has to be clamped is not "lumbar flexion" but what L4-L5 individually
   ended up with. Ask the spine for 90 degrees of flexion and the answer is
   not that the request is legal or illegal; it is that L5-S1 takes 17 of it,
   which it has, and L1-L2 takes 11, which it also has. Clamping the group
   value would either forbid a reachable pose or permit an unreachable one
   depending on which level you checked.

   Second, half these ranges are not constants. Hip flexion depends on knee
   flexion, because the hamstrings cross both: straight-legged you get about
   95 degrees, knee bent about 120. Hip EXTENSION goes the other way, because
   rectus femoris also crosses both — bend the knee and you lose extension.
   Shoulder rotation range shrinks as the arm abducts. Ankle dorsiflexion
   depends on knee flexion through gastrocnemius. A limit table without those
   describes a body that can put its heel on its own shoulder with a straight
   knee.

   Which is why clamping needs a pass of its own. The couplings look sideways
   across the tree — a femur's limit depends on a tibia that the walk has not
   reached — so every requested angle is resolved first, then clamped with all
   of them in hand, and only then does anything get solved into a frame.
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;
  const D = Math.PI / 180;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /** the per-bone envelope, before any coupling: [min, max] radians per axis */
  function build(fig) {
    const R = GK.ref;
    if (!R) return null;
    const L = {};
    const sym = (deg) => [-deg * D, deg * D];
    const put = (id, flex, abd, twist) => { L[id] = { flex, abd, twist }; };

    // --- spine, level by level. The tables are per motion segment and the
    //     bones are named for the vertebra above each segment.
    R.LUMBAR_LEVELS.forEach((lv, i) => {
      // L1-L2 .. L5-S1 in the table; the chain is L5 (lowest) upward
      const id = 'L' + (i + 1);
      put(id, sym(lv.flexExt * 0.5), sym(lv.lat), sym(lv.rot));
    });
    R.THORACIC_LEVELS.forEach((lv, i) => {
      const id = 'T' + (i + 1);
      put(id, sym(lv.flexExt * 0.5), sym(lv.lat), sym(lv.rot));
    });
    R.CERVICAL_LEVELS.forEach((lv, i) => {
      // the table starts at C0-C1, which is the skull on the atlas; the bone
      // chain has no bone for it, so it is folded into C1
      const id = 'C' + Math.max(1, i);
      const cur = L[id];
      const f = [-lv.ext * D, lv.flex * D], a = sym(lv.lat), t = sym(lv.rot);
      if (cur) {
        cur.flex = [cur.flex[0] + f[0], cur.flex[1] + f[1]];
        cur.abd = [cur.abd[0] + a[0], cur.abd[1] + a[1]];
        cur.twist = [cur.twist[0] + t[0], cur.twist[1] + t[1]];
      } else put(id, f, a, t);
    });

    for (const s of ['L', 'R']) {
      // --- shoulder girdle. No measured table for the clavicle and scapula
      //     in isolation; these are the elevation/protraction the girdle is
      //     generally credited with, and they are EST.
      put('clavicle.' + s, sym(25), sym(20), sym(1));
      put('scapula.' + s, sym(20), sym(25), sym(15));
      put('humerus.' + s,
        [-R.SHOULDER.ext * D, R.SHOULDER.flex * D],
        [-R.SHOULDER.add * D, R.SHOULDER.abd * D],
        [-R.SHOULDER.rotAtSide.ext * D, R.SHOULDER.rotAtSide.int * D]);
      put('forearm.' + s,
        [-R.ELBOW.hyperext * D, R.ELBOW.flex * D],
        [0, 0],                                     // an elbow is a hinge
        [-R.FOREARM_ROM.pron * D, R.FOREARM_ROM.sup * D]);
      put('femur.' + s,
        [-R.HIP.extKneeExt * D, R.HIP.flexKneeExt * D],
        [-R.HIP.add * D, R.HIP.abd * D],
        [-R.HIP.rotProne.ext * D, R.HIP.rotProne.int * D]);
      put('tibia.' + s,
        [-R.KNEE.hyperext * D, R.KNEE.flex * D],
        [0, 0],                                     // and so is a knee
        sym(R.SCREW_HOME.deg));
      put('foot.' + s,
        [-R.ANKLE.plantar * D, R.ANKLE.dorsiKneeExt * D],
        [-R.SUBTALAR.eversion * D, R.SUBTALAR.inversion * D],
        [0, 0]);
    }
    return L;
  }

  /**
   * Clamp every requested angle into its envelope, widening or narrowing the
   * coupled ones first. `raw` is {boneId: [flex, abd, twist]} and the return
   * is the same shape, plus a record of what was clipped and by how much —
   * silently clamping is how a pose that cannot be reached looks like a pose
   * that was reached.
   */
  function clampAll(fig, raw) {
    const L = fig.limits;
    if (!L) return { angles: raw, clipped: [] };
    const R = GK.ref;
    const out = {}, clipped = [];

    for (const id in raw) {
      const lim = L[id];
      if (!lim) { out[id] = raw[id].slice(); continue; }
      let [f, a, t] = raw[id];
      let flex = lim.flex, abd = lim.abd, twist = lim.twist;

      // --- the couplings, each looking at a joint the tree walk has not
      //     necessarily reached yet, which is the reason this is a pass
      const side = id.slice(-2) === '.L' ? 'L' : (id.slice(-2) === '.R' ? 'R' : null);
      if (side && /^femur\./.test(id) && R) {
        const knee = Math.abs((raw['tibia.' + side] || [0])[0]);
        const hip = R.romFor('hip', 'flexExt', { kneeFlexionRad: knee });
        if (hip) flex = [hip.min, hip.max];
      }
      if (side && /^humerus\./.test(id) && R) {
        const rot = R.romFor('shoulder', 'rotation', { abductionRad: Math.abs(a) });
        if (rot) twist = [rot.min, rot.max];
      }
      if (side && /^foot\./.test(id) && R) {
        const knee = Math.abs((raw['tibia.' + side] || [0])[0]);
        const ank = R.romFor('ankle', 'flexExt', { kneeFlexionRad: knee });
        if (ank) flex = [ank.min, ank.max];
      }

      const cf = clamp(f, flex[0], flex[1]);
      const ca = clamp(a, abd[0], abd[1]);
      const ct = clamp(t, twist[0], twist[1]);
      if (Math.abs(cf - f) > 1e-9) clipped.push({ id, axis: 'flex', by: (f - cf) / D });
      if (Math.abs(ca - a) > 1e-9) clipped.push({ id, axis: 'abd', by: (a - ca) / D });
      if (Math.abs(ct - t) > 1e-9) clipped.push({ id, axis: 'twist', by: (t - ct) / D });
      out[id] = [cf, ca, ct];
    }
    return { angles: out, clipped };
  }

  /** total range a chain can deliver, for a caller that wants to ask before it asks */
  function chainRange(fig, ids, axis) {
    const L = fig.limits;
    let lo = 0, hi = 0;
    for (const id of ids) {
      if (!L || !L[id]) continue;
      lo += L[id][axis][0]; hi += L[id][axis][1];
    }
    return [lo, hi];
  }

  GK.limits = { build, clampAll, chainRange };
})(window.GK = window.GK || {});
