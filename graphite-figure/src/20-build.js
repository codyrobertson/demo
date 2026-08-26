/* ============================================================================
   GRAPHITE FIGURE — src/20-build.js
   buildFigure(seed) grows one body: resolved bone lengths in millimetres, the
   offsets that scale with build rather than with height, and the weights that
   say how a group rotation is shared out along a chain.

   MEASUREMENT COMES FROM DATA. Nothing in this file is a proportion any
   more. src/00-anthro.js samples a body from a model fitted to ANSUR II —
   6,068 adults, 93 directly measured dimensions — and this turns that sample
   into the bone lengths and offsets the skeleton wants. What is left here is
   the one thing a tape-measure survey cannot record: how a group rotation is
   shared out along a chain of vertebrae.
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;
  const { lerp, clamp } = M;

  /**
   * How a group rotation is shared out along a chain. These are not equal
   * splits and must not be: a lumbar spine flexed uniformly reads as a hose,
   * because the real thing bends most at L4-L5 and barely at all at L1.
   * Axial rotation is the opposite way round — the lumbar facets are oriented
   * to prevent it and the thoracic ones allow it, so a trunk twist that runs
   * through the low back is anatomically impossible and looks it.
   */
  function weights() {
    const g = {};
    const put = (ids, axis, w) => {
      const sum = w.reduce((a, b) => a + b, 0);
      ids.forEach((id, i) => {
        g[id] = g[id] || {};
        g[id][axis] = w[i] / sum;
      });
    };
    const L = ['L5', 'L4', 'L3', 'L2', 'L1'];
    put(L, 'flex', [0.28, 0.24, 0.20, 0.16, 0.12]);
    put(L, 'abd', [0.22, 0.22, 0.22, 0.18, 0.16]);
    put(L, 'twist', [0.20, 0.20, 0.20, 0.20, 0.20]);   // and the group value is tiny

    const T = [];
    for (let i = 12; i >= 1; i--) T.push('T' + i);
    put(T, 'flex', T.map((_, i) => 0.6 + 0.6 * (i / 11)));   // more range up the chest
    put(T, 'abd', T.map(() => 1));
    put(T, 'twist', T.map((_, i) => 1.4 - 0.8 * (i / 11)));  // most axial low, at T1-T4 least

    const C = [];
    for (let i = 7; i >= 1; i--) C.push('C' + i);
    put(C, 'flex', C.map(() => 1));
    put(C, 'abd', C.map(() => 1));
    // roughly half of cervical axial rotation happens at C1-C2 alone; spread
    // it evenly and the neck turns like a hose instead of like a neck
    put(C, 'twist', [0.6, 0.6, 0.7, 0.8, 0.9, 1.0, 4.4]);

    for (const s of ['L', 'R']) {
      for (const b of ['clavicle', 'scapula', 'humerus', 'forearm', 'femur', 'tibia', 'foot']) {
        g[b + '.' + s] = { flex: 1, abd: 1, twist: 1 };
      }
    }
    return g;
  }

  /**
   * A region's vertebrae, individually rescaled. `seg` is 00-anthro.js's one
   * measured average for the region (e.g. seg.lumbarSeg) — the vertical rise
   * a LEVEL BONE would need if it stood dead straight. 10-skeleton.js no
   * longer stands them straight: each carries a `tilt`, the cumulative
   * sagittal angle THE STANDING CURVE (there) puts it at, and tilting a bone
   * without lengthening it would have eaten cos(tilt) of that rise. So each
   * level is let back out to seg/cos(tilt) here instead, which is exactly
   * enough to put the lost rise back — no more, since a bone this short of
   * 90 degrees of tilt never needs much — and leaves the anterior offset to
   * fall out of the tilt for free rather than being authored anywhere.
   * `prefix`+1..`count` walks the same id scheme buildTree() used to name
   * them (L1..L5, T1..T12, C1..C7), so this and the tree cannot drift apart.
   */
  function spineLen(seg, prefix, count) {
    const out = {};
    for (let i = 1; i <= count; i++) {
      const id = prefix + i;
      const b = GK.skel.BY_ID[id];
      const tilt = (b && b.tilt) || 0;
      out[id] = seg / Math.cos(tilt);
    }
    return out;
  }

  /**
   * One body, from the ANSUR II fit. Nothing here is a ratio: the femur is a
   * measured trochanterion height minus a measured lateral epicondyle height
   * on the same synthetic person, and it arrives already correlated with the
   * tibia, the span, the hand and the stature at the rates the survey found.
   */
  function buildFigure(seed, opts) {
    opts = opts || {};
    if (!GK.anthro || !GK.anthro.model) {
      throw new Error('buildFigure: load the ANSUR fit first, via GK.anthro.useModel(...)');
    }
    const m = GK.anthro.sampleBody(seed, opts);
    const seg = GK.anthro.segments(m);
    const Lm = GK.anthro.landmarks(m);
    const rootH = seg.sacrumHeight;

    const len = {
      // Zero, and it has to be. The root is placed AT the iliac crest,
      // which is also where the lumbar measurements start, so any length
      // given to the sacrum here is added to the spine a second time. The
      // first pass gave it the crest-to-trochanter rise and the figure came
      // out 195mm taller than its own stature — a hundred and ninety-five
      // millimetres of spine that no measurement asked for. The sacrum's
      // own form belongs to the pelvic volume, not to the bone chain.
      pelvis: 0,
      ...spineLen(seg.lumbarSeg, 'L', GK.skel.LUMBAR),
      ...spineLen(seg.thoracicSeg, 'T', GK.skel.THORACIC),
      ...spineLen(seg.cervicalSeg, 'C', GK.skel.CERVICAL),
      skull: seg.headLen,
      clavicle: seg.clavicle,
      scapula: seg.scapula,
      humerus: seg.humerus,
      forearm: seg.forearm,
      femur: seg.femur,
      tibia: seg.tibia,
      foot: seg.foot,
    };

    // Offsets are differences between two measured heights on the same
    // person, not fractions of stature. The root sits at the sacral base.
    //
    // `sc`'s two components — a height (suprasternale below cervicale) and
    // a depth (chest-depth-derived, in Lm.suprasternale's own Z) — are
    // WORLD-frame deltas from the C7/T1 junction: m.cervicaleheight is what
    // 00-anthro.js's segments() stacks the thoracic column up TO, so the
    // delta is measured from that junction, not from T1's own origin a
    // segment below it — which is exactly why the clavicle is parented at
    // C7 now rather than T1 (10-skeleton.js): atKey applies its offset
    // from the PARENT's own ORIGIN (solve() — `p.A`, not `p.B`), and C7.A
    // IS the C7/T1 junction where T1.A was a whole thoracic segment short
    // of it.
    //
    // That alone was one bug, and it predates THE STANDING CURVE — a
    // straight spine would have been off by one segment's worth of height
    // and never shown it, because nothing downstream checked the
    // clavicle's own length. THE STANDING CURVE added a second, worse one
    // on top: atKey's offset is applied in the PARENT's own FRAME, which
    // used to be fine because every vertebra's frame WAS the world frame —
    // no longer true once C7 carries its own share of cervical tilt. The
    // same [dHeight, 0, dDepth] handed through a tilted frame no longer
    // lands at the world-frame position it was measured as; it inherits
    // the parent's lean on top of it. Both together stretched the
    // clavicle, whose OTHER end is pinned exact to the survey's acromion
    // by its own aimTo, to close the gap — 189mm solved against a 156.8mm
    // measured length at seed 12345, 21.7% over on average across 60
    // seeds, entirely from the origin sitting in the wrong place; the
    // length itself was never wrong.
    //
    // Fixed the parent (10-skeleton.js) for the first bug; this rotates
    // the WORLD-frame delta BACKWARD by the parent's own tilt for the
    // second, so the rotation solve() is about to apply cancels back out
    // and the sternoclavicular joint lands at the same world-frame spot
    // regardless of how much curve its parent happens to be carrying. The
    // tilt is a fixed property of the tree (THE STANDING CURVE), not of
    // any one figure, so it is read once here rather than re-derived.
    const scParent = GK.skel.BY_ID.C7;
    const scTilt = (scParent && scParent.tilt) || 0;
    const ct = Math.cos(scTilt), st = Math.sin(scTilt);
    const scUp = Lm.suprasternale[0] - m.cervicaleheight;   // world height delta, C7/T1 junction -> SC joint
    const scFwd = Lm.suprasternale[2];                      // world anterior delta
    // Both bugs fixed and the clavicle STILL solved 16%+ over length — a
    // third thing, and a curve-independent one: `at.sc`'s lateral (Y)
    // component was a flat 0, i.e. the sternoclavicular joint sits exactly
    // on the midline, while aimTo:'acromion' (above) pins the clavicle's
    // OTHER end at the FULL half-biacromial-breadth. A straight line
    // between a point on the midline and a point half-biacromial-breadth
    // off it is at minimum that half-breadth long, by Pythagoras, before
    // the height or depth components add anything at all — and
    // s.clavicle (00-anthro.js) is 0.86 of that same half-breadth. 0.86
    // of a distance is always less than the distance, so the clavicle
    // was being asked to come in UNDER a floor its own two endpoints set:
    // no anterior offset, no height offset, no curve fix of any kind can
    // reach it while the origin sits on the midline. This is exactly the
    // gap 00-anthro.js's own comment on s.clavicle names and half-solves
    // — "acromial end inboard of the acromion" softens the ACROMIAL end,
    // but aimTo still closes on the acromion exactly (rightly: checkfit's
    // acromion-height check needs it to), leaving nothing to soften the
    // STERNAL end. SC_INBOARD gives the origin back the width the real
    // sternum has — the two sternoclavicular joints sit either side of
    // the manubrium, not stacked on top of each other — pulling the
    // origin off the midline by a fraction of biacromial breadth. Swept
    // against the same measurement as the other two fixes: 0.10 lands
    // clavicle.L.len at fig.len.clavicle's own ±5% band for nearly all of
    // 60 seeds (mean +1.4%, worst +7.3%/-3.3%); much below it and the old
    // floor reappears, much above it and the joint sits implausibly far
    // off the sternum. EST — no ANSUR column measures manubrium width —
    // and the roomiest of the three fixes, because it is doing double
    // duty for a second uncorrected inset (see above) as well as its own.
    const SC_INBOARD = 0.10;
    const at = {
      hip: [Lm.hip[0] - rootH, Lm.hip[1], 0],
      sc: [scUp * ct + scFwd * st, SC_INBOARD * m.biacromialbreadth, scFwd * ct - scUp * st],
    };

    const fig = {
      seed, m, seg, landmarks: Lm, girth: GK.anthro.girths(m),
      stature: m.stature, rootHeight: rootH,
      len, at, groups: weights(),
    };
    // the measured joint envelope, per bone, so a pose can be clamped into
    // something a body can actually do
    fig.limits = GK.limits ? GK.limits.build(fig) : null;
    // Landmarks a bone is required to END on, in world coordinates (height
    // above the floor, lateral half-offset, anterior). The clavicle takes
    // both its length and its direction from this rather than from a guess.
    fig.aimTargets = {
      acromion: [m.acromialheight, m.biacromialbreadth * 0.5, 0],
      // the scapula ends ON the glenohumeral centre, so the humerus swings
      // from where the survey says it swings from rather than from a guess
      gh: Lm.gh,
      // Stature is the single best-measured dimension in the survey, so the
      // head ends on it rather than on a head length that has to be inferred
      // from tragion-to-vertex plus an atlas offset nobody palpated. That
      // offset was the residual -5.8mm the critic kept reporting.
      vertex: [m.stature, 0, 0],
    };
    return fig;
  }

  GK.figure = { buildFigure, weights };
})(window.GK = window.GK || {});
