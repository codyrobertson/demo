/* ============================================================================
   GRAPHITE FIGURE — src/00-anthro.js
   The measurement engine. Sample one plausible adult from the fitted ANSUR II
   model, then resolve it into landmarks and segment lengths.

   WHAT IS MEASURED AND WHAT IS NOT — read this before trusting a number.

   ANSUR II records landmark HEIGHTS FROM THE FLOOR. That is worth more than
   it sounds: a femur is not estimated as a fraction of stature here, it is
   trochanterion height minus lateral femoral epicondyle height, both measured
   on the same person. Every one of these comes out that way:

       femur      trochanterion - lateral femoral epicondyle   measured
       shank      lateral femoral epicondyle - lat. malleolus  measured
       upper arm  acromion-radiale length                      measured
       forearm    radiale-stylion length                       measured
       hand       hand length                                  measured
       foot       foot length                                  measured
       C7 height  cervicale height                             measured
       head       stature - (tragion to top of head) etc.      measured

   What ANSUR cannot give is the depth of a joint CENTRE below the skin. A
   trochanterion is a bony landmark you can palpate; the hip joint centre is
   some way medial, posterior and inferior to it, and no tape measure reaches
   it. Those offsets are marked EST below with the regression they come from,
   and they are the one class of number here that is not a measurement. The
   right source for them is a musculoskeletal model fitted to imaging — the
   Rajagopal OpenSim model is the obvious candidate — and until that is wired
   in they stay flagged rather than quietly blended in with the measured ones.
   ========================================================================== */
'use strict';
(function (GK) {
  const M = GK.math;

  let MODEL = null;
  /** the fit produced by tools/fit-ansur.js; injected rather than required so this file stays environment-free */
  function useModel(m) { MODEL = m; return MODEL; }

  /**
   * One body, drawn from the joint distribution. z is 20 standard normals —
   * the latent the user of this module actually holds — and everything else
   * follows from the covariance ANSUR measured, so a figure that comes out
   * long in the arm comes out long in the span, the forearm and the hand
   * along with it, at the rates real people do.
   */
  function sampleBody(seed, opts) {
    if (!MODEL) throw new Error('anthro: call useModel(json) first');
    opts = opts || {};
    const rng = new M.Rng((seed >>> 0) || 1);
    const K = MODEL.components.length, P = MODEL.cols.length;
    const z = opts.z || Array.from({ length: K }, () => rng.gauss(0, 1) * (opts.spread || 1));

    const m = {};
    for (let j = 0; j < P; j++) {
      let s = 0;
      for (let k = 0; k < K; k++) s += z[k] * MODEL.components[k][j];
      // the variance the kept components do not carry, restored as
      // independent noise: without it every sample is under-dispersed and
      // over-correlated at the same time, and a synthetic population comes
      // out with the thigh a fixed fraction of the leg
      s += MODEL.residual[j] * rng.gauss(0, 1);
      m[MODEL.cols[j]] = Math.exp(MODEL.mean[j] + MODEL.sd[j] * s);
    }
    m.z = z;
    m.seed = seed;
    return m;
  }

  // =========================================================================
  //  LANDMARKS
  //  World is +X superior, +Y to the figure's own left, +Z anterior, origin
  //  on the floor between the feet. Heights come straight out of the sample;
  //  lateral and anteroposterior placement is where the estimates live.
  // =========================================================================

  /**
   * Hip joint centre spacing, as a fraction of bicristale breadth.
   *
   * This is the one number here that ANSUR genuinely cannot supply: a
   * trochanterion can be palpated, a hip joint centre cannot, and the survey
   * has no landmark inside the pelvis. It began as a Bell-style regression at
   * 0.34, carrying a known substitution — Bell's is written for the inter-ASIS
   * distance and ANSUR measures the iliac crests, which are not the same
   * landmark.
   *
   * Calibrated instead against the Rajagopal musculoskeletal model, whose
   * pelvis width IS a hip-centre-to-hip-centre distance measured by imaging:
   * against leg length, 0.34 came out 19.6% wide, and 0.284 lands on it. Two
   * independent routes then agree — Bell's own coefficient against inter-ASIS
   * is 0.28, and this is 0.284 against bicristale.
   *
   * tools/crosscheck.js is the comparison, and states its own limit: a single
   * imaged subject settles a large disagreement about a number no tape can
   * reach, and settles nothing about a few percent.
   */
  const HJC_FROM_BICRISTALE = 0.284;
  // DERIVED, not estimated — see tools/fit-arm.js, which fits these from the
  // survey itself across all 6,068 subjects. Span pins the horizontal and the
  // resting wrist height pins the vertical, and neither is a measurement the
  // chain consumes, so both are free ground truth.
  //
  // The guesses these replace were 0.085 and 0.075. The drop was close; the
  // inboard offset was out by 45%, which is most of a 269mm span error.
  const GH_INBOARD = 0.1232;   // of biacromial breadth: 49mm at the mean
  const GH_DROP = 0.0849;      // of biacromial breadth: 34mm at the mean

  /**
   * Surface landmarks are not joint centres, and the gap is not small. The
   * acromion sits above and lateral to the glenohumeral centre; the radiale
   * is the radial head rather than the elbow axis; the stylion is the styloid
   * rather than the wrist axis. Chain the measured lengths and every arm is
   * long — 25mm at the wrist, 269mm across the span.
   *
   * The span regression gives the correction directly and gives it twice: the
   * upper arm enters a span at 0.9247 of its measured length and the forearm
   * at 0.9240. Those were fitted independently and agree to seven parts in
   * ten thousand, which is a much stronger statement than either alone — one
   * factor covers both because the same kind of landmark offset is at each
   * end of both bones. A hand, whose length is already measured to the
   * fingertip rather than to a joint, enters at 0.979.
   */
  const JOINT_CENTRE_K = 0.9244;
  // EST: knee and ankle joint centres are taken at the palpated landmark
  // heights, which is very nearly true for the lateral epicondyle and the
  // lateral malleolus — both sit within a few millimetres of the axis.
  const KNEE_AT_EPICONDYLE = 1.0;

  function landmarks(m) {
    const L = {};
    const half = (w) => w * 0.5;

    L.floor = [0, 0, 0];
    L.vertex = [m.stature, 0, 0];
    // tragion-to-top-of-head is the upper head; the rest of the head height
    // is below it, so the skull's own base sits at stature minus head length
    L.headTop = [m.stature, 0, 0];
    L.tragion = [m.stature - m.tragiontopofhead, 0, 0];
    L.c7 = [m.cervicaleheight, 0, 0];
    L.suprasternale = [m.suprasternaleheight, 0, m.chestdepth * 0.32];
    L.chest = [m.chestheight, 0, 0];
    L.tenthRib = [m.tenthribheight, 0, 0];
    L.waist = [m.waistheightomphalion, 0, 0];
    L.iliacCrest = [m.iliocristaleheight, half(m.bicristalbreadth), 0];
    L.trochanter = [m.trochanterionheight, half(m.hipbreadth) * 0.92, 0];
    L.crotch = [m.crotchheight, 0, 0];
    L.buttock = [m.buttockheight, 0, -m.buttockdepth * 0.5];

    // joint centres
    L.hip = [m.trochanterionheight, half(m.bicristalbreadth) * HJC_FROM_BICRISTALE * 2 * 0.5, 0];
    L.hip[1] = half(m.bicristalbreadth * HJC_FROM_BICRISTALE * 2);
    L.acromion = [m.acromialheight, half(m.biacromialbreadth), 0];
    L.gh = [
      m.acromialheight - m.biacromialbreadth * GH_DROP,
      m.biacromialbreadth * (0.5 - GH_INBOARD),
      0,
    ];
    L.knee = [m.lateralfemoralepicondyleheight * KNEE_AT_EPICONDYLE, 0, 0];
    L.ankle = [m.lateralmalleolusheight, 0, 0];
    L.wrist = [m.wristheight, 0, 0];
    L.heel = [0, 0, -m.footlength * 0.25];
    L.toe = [0, 0, m.footlength * 0.75];
    return L;
  }

  /**
   * Segment lengths in millimetres. Every entry says where it came from,
   * because the difference between "measured on 6,068 people" and "a ratio
   * someone wrote down" is the whole point of this file.
   */
  function segments(m) {
    const s = {};
    // --- measured directly, or as a difference of two measured heights
    s.femur = m.trochanterionheight - m.lateralfemoralepicondyleheight;
    s.tibia = m.lateralfemoralepicondyleheight - m.lateralmalleolusheight;
    s.humerus = m.acromionradialelength * JOINT_CENTRE_K;
    s.forearm = m.radialestylionlength * JOINT_CENTRE_K;
    s.humerusSurface = m.acromionradialelength;   // kept: the surface still needs it
    s.forearmSurface = m.radialestylionlength;
    s.hand = m.handlength;
    s.foot = m.footlength;
    s.footHeight = m.lateralmalleolusheight;
    // The skull BONE runs from the atlas up to the vertex, and the atlas
    // sits at about tragion level — so this is tragion-to-top-of-head and
    // nothing else. Adding the face height (menton to sellion) on top of it
    // put every figure 103 to 126mm taller than the stature it was sampled
    // at: the face hangs forward and down off this bone, it does not extend
    // it. Face height is still carried, in m.mentonsellionlength, for the
    // surface to use.
    s.headLen = m.tragiontopofhead;
    // --- trunk, as differences between measured landmark heights
    s.neck = m.cervicaleheight;                       // absolute height, split below
    s.spineC7toTroch = m.cervicaleheight - m.trochanterionheight;
    s.skull = m.stature - m.cervicaleheight;
    // EST: the sacral base is not palpated in ANSUR. Taken at the iliac
    // crest height, which puts L5-S1 within about a centimetre on an adult.
    s.sacrumHeight = m.iliocristaleheight;
    s.lumbar = (m.tenthribheight - m.iliocristaleheight);
    s.thoracic = (m.cervicaleheight - m.tenthribheight);
    s.lumbarSeg = s.lumbar / 5;
    s.thoracicSeg = s.thoracic / 12;
    // EST: cervicale is C7's spinous process; the atlas sits roughly at the
    // level of the tragion, so the cervical column is taken between them.
    s.cervical = Math.max(40, (m.stature - m.tragiontopofhead) - m.cervicaleheight);
    s.cervicalSeg = s.cervical / 7;
    s.clavicle = m.biacromialbreadth * 0.5 * 0.86;    // EST: sternoclavicular is at the midline, acromial end inboard of the acromion
    s.scapula = m.biacromialbreadth * GH_INBOARD * 1.4;
    return s;
  }

  /** girths at the landmarks a surface gets lofted through, in millimetres of circumference */
  function girths(m) {
    return {
      neck: m.neckcircumference, chest: m.chestcircumference,
      waist: m.waistcircumference, hip: m.buttockcircumference,
      thigh: m.thighcircumference, lowerThigh: m.lowerthighcircumference,
      calf: m.calfcircumference, ankle: m.anklecircumference,
      biceps: m.bicepscircumferenceflexed, forearm: m.forearmcircumferenceflexed,
      wrist: m.wristcircumference, shoulder: m.shouldercircumference,
      head: m.headcircumference,
      chestBreadth: m.chestbreadth, chestDepth: m.chestdepth,
      waistBreadth: m.waistbreadth, waistDepth: m.waistdepth,
      hipBreadth: m.hipbreadth, bideltoid: m.bideltoidbreadth,
    };
  }

  GK.anthro = { useModel, sampleBody, landmarks, segments, girths, GH_INBOARD, GH_DROP, JOINT_CENTRE_K, HJC_FROM_BICRISTALE, get model() { return MODEL; } };
})(window.GK = window.GK || {});
