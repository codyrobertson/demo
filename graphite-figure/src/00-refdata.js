/* ============================================================================
   GRAPHITE FIGURE — 00 · refdata
   Whole-body reference data: segment proportions, population variance, joint
   range-of-motion, and girths. Pure numbers and the pure functions that
   resolve them for a given (stature, build) — no rendering, no geometry, no
   rig, no seeded generation. This is the whole-body counterpart of what
   graphite-kinematics/src/10-anatomy.js is for the hand (NOMINAL + LIMITS +
   the per-seed build), except the figure project already splits "reference
   data" from "seeded generation" into two files — src/10-skeleton.js says so
   explicitly ("Lengths, girths and joint ranges come from src/00-refdata.js,
   resolved per seed by buildFigure()") — so the seeded draw of stature/build
   and the per-part jitter belong in 20-build.js's buildFigure(seed), and this
   file stops at the pure resolvers that function calls into: segments(stature,
   build), girths(stature, build), romFor(joint, axis, context). That is also
   exactly the signature the brief for this file asked for (segments(stature,
   build), not segments(seed)) so the two requirements agree.

   Every number below is either a published anthropometric/biomechanical
   value — the comment above its block names the source — or is explicitly
   marked `est`. Where two sources disagree, the comment says so and says
   which was used. A number with neither a citation nor an `est` tag does not
   belong in this file.

   Units. Every LITERAL table is in degrees or in fractions of stature,
   because that is how the source literature reports them and checking a
   number against its paper is the point of citing one. toRad() is the one
   place a degree becomes a radian; nowhere else in this file re-derives that
   conversion. Every function that returns an angle to a caller returns
   radians.

   Sign convention (every joint, unless a block says otherwise):
     sagittal   : flexion +, extension -              (0 = anatomical position)
     frontal    : abduction +, adduction -           (spine: lateral flexion is
                  reported symmetric in the sources; the sign carries no
                  left/right meaning here, only magnitude)
     transverse : external/lateral rotation +, internal/medial -
                  (forearm: pronation +, supination -; subtalar: inversion +,
                  eversion -)
   Two exceptions, both noted again at their own block: forearm neutral is
   mid-rotation (thumb up), not palms-forward; carrying angle and screw-home
   rotation are not free ranges, they are a single coupled VALUE at a given
   flexion, returned by their own function rather than by romFor().

   Two body-shape axes, both continuous, both independent of the stature
   scale:
     build : -1 (gynoid/pear: hips > shoulders) .. 0 (average) .. +1 (android/
             inverted-triangle: shoulders > hips). Calibrated against the real
             sex-mean difference in biacromial and girth measures below, so a
             build of +-1 lands near the male/female population mean, not at
             its tail.
     size  : there is no separate unitless size factor the way the hand has
             one — stature (mm) already IS the literal, measured quantity the
             hand's `size` stands in for, and it is the function argument.
   ========================================================================== */
(function (GK) {
  'use strict';

  // ---------------------------------------------------------------- constants
  // Prefers GK.math, which is already on the shared namespace by the time
  // this file loads in the one place that actually loads it today
  // (tools/stick.js requires the hand's 00-math.js before anything in this
  // project) — same Rng, same DEG, no drift between the two projects' random
  // streams. Falls back to a private, equivalent copy so this file also
  // stands up completely alone (`global.window={}; require(...)`), which is
  // how its own self-check below is actually run.
  const M = GK.math || (function () {
    const DEG = Math.PI / 180;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
    function mulberry32(a) {
      a = a >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    class Rng {
      constructor(seed) { this.reseed(seed); }
      reseed(seed) { this.seed = (seed >>> 0) || 1; this._f = mulberry32(this.seed * 2654435761 % 4294967296); this._spare = null; return this; }
      f() { return this._f(); }
      range(a, b) { return a + (b - a) * this._f(); }
      gauss(mu = 0, sd = 1) {
        if (this._spare !== null) { const s = this._spare; this._spare = null; return mu + sd * s; }
        let u = 0, v = 0, s = 0;
        do { u = this._f() * 2 - 1; v = this._f() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
        const m = Math.sqrt(-2 * Math.log(s) / s);
        this._spare = v * m;
        return mu + sd * u * m;
      }
      gaussIn(mu, sd, lo, hi) {
        for (let i = 0; i < 12; i++) { const g = this.gauss(mu, sd); if (g >= lo && g <= hi) return g; }
        return clamp(mu, lo, hi);
      }
    }
    return { DEG, clamp, clamp01, lerp, smoothstep, mulberry32, Rng };
  })();
  const { DEG, clamp, lerp, Rng } = M;

  // -------------------------------------------------------------- provenance
  // Short citations, referenced by key from the block comments below rather
  // than repeated in full at every table.
  const SOURCES = {
    drillisContini: 'Drillis & Contini 1966, Body Segment Parameters (NYU); reproduced as Winter, Biomechanics and Motor Control of Human Movement, Fig. 4.1 — segment length as a fraction of stature. The most-reproduced table in the field; treated as high-confidence.',
    ansurII: 'Gordon, Blackwell et al. 2014, 2012 Anthropometric Survey of U.S. Army Personnel (ANSUR II), Natick Soldier RD&E Center — a fit adult military sample, not general population; absolute means in cm, by sex.',
    spineLength: 'radiographic spinal-length literature (adult T1-T12 anterior column commonly ~250-300mm, L1-S1 ~150-180mm) — approximate, not a single named table.',
    vertebralMorphometry: 'general vertebral-body-height morphometry (the same craniocaudal-increase fact osteoporotic-fracture Genant grading leans on) — used only for the SHAPE of the per-vertebra split, not for absolute per-level numbers.',
    whitePanjabi: 'White & Panjabi, Clinical Biomechanics of the Spine (1978/1990) — in-vitro segmental spine ROM under a standardised pure moment. C0-C1 and C1-C2 rows below are this table directly; the subaxial rows (C2-C3..C7-T1) are the commonly-reproduced values from the same table, not independently re-confirmed against the primary source this pass.',
    lumbarSegmental: 'a multivariate radiographic study of 42 intact lumbar spines, level-by-level flexion-extension arc (L1-2 through L5-S1) — used directly for that one column; lateral bending and rotation per level are not from this study.',
    thoracicSegmental: 'an in-vitro segmental-flexibility study of the thoracic spine — T1-2 and T11-12 are that study\'s own reported means; the other ten levels are this file\'s interpolation along the well-attested regional pattern (stiff through the rib-braced mid-thoracic, loose at both transition zones).',
    aaos: 'American Academy of Orthopaedic Surgeons, Joint Motion: Method of Measuring and Recording — the standard clinical goniometry chart.',
    inman: 'Inman, Saunders & Abbott 1944 — the classic 2:1 scapulohumeral rhythm. Modern 3-D studies find the pooled ratio closer to ~2.3:1 and highly non-uniform across the arc; the classic scalar is used here as the simpler, still-standard teaching value.',
    screwHome: 'orthopaedic consensus on the knee screw-home mechanism: ~15deg of obligate external tibial rotation develops over the terminal ~20-30deg of extension (the larger medial femoral condyle running out of articular surface), locking the knee for standing.',
    silfverskiold: 'the Silfverskiold-test literature — ankle dorsiflexion measured with the knee extended (gastrocnemius, which crosses both joints, on stretch) versus flexed (gastrocnemius slack) — the standard clinical way to tell a tight gastrocnemius from a tight soleus.',
    hipRotationPosition: 'goniometric studies comparing hip rotation measured seated (~90deg hip flexion) against prone (hip near neutral extension) — both a measured mean and an SD, not a single textbook number.',
    carryingAngle: 'radiographic/goniometric carrying-angle studies (pooled measured means ~9.3deg male / ~18.5deg female, both with several degrees of SD) — used in preference to the rounder 5-15/10-20 textbook rule-of-thumb because it is an actual measured sample.'
  };

  const toRad = (deg) => deg * DEG;

  // ============================================================================
  // 1. SEGMENT PROPORTIONS — fraction of stature (H)
  // ============================================================================
  // Isometric throughout: segment = fraction * stature. Real allometry bends
  // slightly away from a straight line across the full height range, but
  // that is the same simplification Drillis & Contini's own table makes, and
  // it is exact enough over the range of statures a figure generator needs.

  // ---- head, neck (SOURCES.drillisContini) -----------------------------------
  const HEAD = 0.130;        // vertex to chin
  const HEAD_NECK = 0.182;   // vertex to C7/suprasternale — the other commonly
                              // tabulated figure. Neck is never its own D&C
                              // entry; it is this minus HEAD.
  const NECK = HEAD_NECK - HEAD;

  // ---- spine: cervical, thoracic, lumbar — whole and per-vertebra -----------
  // D&C has no spine breakdown at all; it treats the trunk as one segment.
  // The three regional totals below come from radiographic spinal-length
  // literature instead (SOURCES.spineLength — approx; converting an absolute
  // mm figure to a fraction of H assumes a ~1750mm reference stature, so
  // treat the third decimal as soft). Cervical's total is NECK again, repeated
  // here so a consumer building all three chains the same way (as
  // graphite-figure's own 10-skeleton.js does — seven C-bones, twelve T-bones,
  // five L-bones) has one uniform shape instead of a special case for the neck.
  const SPINE_CERVICAL = NECK;   // = 0.052H — independently cross-checked below:
                                  // 10-skeleton.js's own provisional cervicalSeg
                                  // total (7 * 0.00743) is 0.0520H, an exact match.
  const SPINE_THORACIC = 0.157;  // approx — ~275mm @ ~1750mm stature. 10-skeleton.js's
                                  // own provisional thoracicSeg total is 0.158H — close.
  const SPINE_LUMBAR = 0.095;    // approx — ~165mm @ ~1750mm stature. 10-skeleton.js's
                                  // own provisional lumbarSeg total is 0.100H — close.

  // Per-vertebra split: real vertebral bodies are NOT uniform height — anterior
  // body height increases craniocaudally through both the thoracic and lumbar
  // columns because the lower vertebrae carry more load (SOURCES.vertebralMorphometry).
  // The cervical column is its own shape: C1/C2 form a compact, specialised
  // craniocervical junction (the atlas has no real body; the axis is dominated
  // by the odontoid) rather than following the plain increasing gradient, then
  // C3-C7 increase gradually like the rest of the spine.
  // What follows in each *_RAW array is a set of RELATIVE weights on that
  // documented shape, normalised to sum to 1 and then scaled by the regional
  // total above — not independently measured per-vertebra fractions; there is
  // no source at that grain. est, for the shape only (the totals they sum to
  // are the real, cited numbers above).
  // Order: superior to inferior — C1..C7, T1..T12, L1..L5 (i.e. skull-to-sacrum
  // reading order). graphite-figure's own skeleton tree walks the opposite way
  // (T1 upward from the sacrum, so C7 first) — reverse the array if that is
  // the walk a consumer needs.
  const CERVICAL_RAW = [9, 10, 12, 13, 13.5, 14, 14.5];                       // C1..C7
  const THORACIC_RAW = [16, 17, 18, 19, 20, 21, 21.5, 22, 23, 24, 25.5, 27];  // T1..T12
  const LUMBAR_RAW = [25, 26, 27, 28, 30];                                    // L1..L5
  const normalizeWeights = (arr) => { const s = arr.reduce((a, b) => a + b, 0); return arr.map((v) => v / s); };
  const CERVICAL_VERTEBRA_WEIGHT = normalizeWeights(CERVICAL_RAW);
  const THORACIC_VERTEBRA_WEIGHT = normalizeWeights(THORACIC_RAW);
  const LUMBAR_VERTEBRA_WEIGHT = normalizeWeights(LUMBAR_RAW);

  // ---- shoulder / pelvis breadth: where `build` actually lives ---------------
  // Biacromial breadth computed from ANSUR II absolute means (ANSUR does not
  // itself publish these as stature fractions): male 41.1cm / 175.6cm stature
  // = 0.234H, female 36.7cm / 162.5cm = 0.226H (SOURCES.ansurII; the two
  // statures are the commonly-cited ANSUR II means, not independently
  // re-verified to the millimetre this pass — see STATURE_MM below).
  // The classic D&C figure for shoulder breadth commonly runs closer to
  // 0.25H, plausibly because it is bideltoid (over the muscle) rather than
  // biacromial (bone to bone) — a different landmark, not a contradiction —
  // and the skeleton is what this table is for, so biacromial is used.
  const SHOULDER_BREADTH_BASE = 0.230;     // (0.234 + 0.226) / 2
  const SHOULDER_BREADTH_BUILD = 0.004;    // half the male/female spread, ANSUR-derived

  // Bi-iliac (bony pelvis) breadth has no ANSUR-derived anchor here — ANSUR's
  // hip figure below is a soft-tissue circumference, a different landmark
  // entirely (see GIRTH). est throughout, from the general and well-attested
  // androgyny/Tanner-index fact that the pelvis is relatively — not
  // necessarily absolutely — wider than the shoulders in a gynoid build: a
  // roughly stature-independent ~280mm bi-iliac breadth in both sexes reads
  // as a LARGER fraction of the shorter female reference stature, which is
  // the direction this number encodes even without a firm absolute source.
  const BI_ILIAC_BASE = 0.165;             // est
  const BI_ILIAC_BUILD = -0.0065;          // est — opposite sign to shoulder: higher
                                            // build (more android) narrows it

  // Adult clavicle length from orthopaedic implant-sizing literature runs
  // ~150-155mm; 152/1750 ~ 0.087H. Flagged explicitly because graphite-figure's
  // own 20-build.js currently carries a PROVISIONAL clavicle fraction of
  // 0.105H, noticeably longer — that number is doing double duty as "half the
  // biacromial reach the shoulder needs to span" rather than measured bone
  // length (its own file says so: "biacromial breadth is carried by the
  // clavicle's length"). The two are different quantities; this file gives
  // the measured bone length, and a future integration should derive the
  // shoulder's lateral reach from SHOULDER_BREADTH above instead of from
  // clavicle length directly.
  const CLAVICLE = 0.087;

  const PELVIS_HEIGHT = 0.108; // est — iliac crest to symphysis/ischial level, no
                                // direct source found. NOT the same quantity as
                                // graphite-figure's own skeleton-tree `pelvis` key
                                // (sacral-promontory-to-L5, a small chain connector,
                                // ~0.030H) — same word, different landmark.

  // ---- limbs (SOURCES.drillisContini — the part of the table reproduced
  // verbatim in every kinesiology course, and the part with the least reason
  // to doubt). These four also match graphite-figure's own 20-build.js
  // provisional FRAC table exactly (humerus/forearm/femur/tibia), which is
  // expected: both ultimately come from the same Winter table.
  const UPPER_ARM = 0.186;   // acromion to lateral epicondyle
  const FOREARM = 0.146;     // lateral epicondyle to radial styloid
  const HAND = 0.108;        // stylion to dactylion — the CLINICAL landmark, wrist
                              // crease to fingertip pad. Will not equal the sum of
                              // graphite-kinematics' own per-bone metacarpal/phalanx
                              // lengths, which are radiographic bone-to-bone and
                              // start distal to the wrist crease and stop short of
                              // the fingertip pulp — different landmarks, not a bug.
  const THIGH = 0.245;       // greater trochanter to knee joint line
  const SHANK = 0.246;       // knee joint line to lateral malleolus
  const FOOT_LENGTH = 0.152;
  const FOOT_HEIGHT = 0.041; // est — instep/malleolus height off the ground. D&C
                              // tabulates foot BREADTH (0.055H) here, not height.

  const SEGMENT_FRACTION = {
    head: HEAD, neck: NECK,
    spine: {
      cervical: SPINE_CERVICAL, cervicalVertebraWeight: CERVICAL_VERTEBRA_WEIGHT,
      thoracic: SPINE_THORACIC, thoracicVertebraWeight: THORACIC_VERTEBRA_WEIGHT,
      lumbar: SPINE_LUMBAR, lumbarVertebraWeight: LUMBAR_VERTEBRA_WEIGHT
    },
    shoulderBreadth: SHOULDER_BREADTH_BASE,
    biIliacBreadth: BI_ILIAC_BASE,
    clavicle: CLAVICLE,
    pelvisHeight: PELVIS_HEIGHT,
    upperArm: UPPER_ARM, forearm: FOREARM, hand: HAND,
    thigh: THIGH, shank: SHANK, footLength: FOOT_LENGTH, footHeight: FOOT_HEIGHT
  };

  // build shifts breadth, not length: the sex/build differences the literature
  // documents are in shoulder and pelvis WIDTH, not in limb or trunk length as
  // a fraction of stature — deliberately not extending `build` to lengths
  // beyond what the evidence above actually supports.
  const SEGMENT_BUILD = { shoulderBreadth: SHOULDER_BREADTH_BUILD, biIliacBreadth: BI_ILIAC_BUILD };

  // ---- variance ---------------------------------------------------------------
  // Two classes of coefficient-of-variation, not one, because the best
  // evidence for "how much does a segment vary at a given stature" is the
  // forensic stature-ESTIMATION literature (Trotter & Gleser-style long-bone-
  // to-stature regressions): the standard error of a stature estimate built
  // from a limb long bone is consistently smaller than one built from a
  // trunk/vertebral measurement. That is the actual evidence behind "limb
  // segments co-vary with stature more tightly than trunk does" (the same
  // claim graphite-figure's own 20-build.js makes in its buildFigure()
  // comment) — it is not an invented percentage. The CV values pinning that
  // pattern down numerically below are themselves est, sized off the general
  // magnitude of those regression errors rather than one named table.
  const LIMB_CV = 0.035;     // est
  const TRUNK_CV = 0.070;    // est
  const BREADTH_CV = 0.045;  // est — skeletal like a limb, but `build` above already
                              // carries the biggest part of the shoulder/pelvis spread,
                              // so this is only the residual jitter on top of build.

  const SEGMENT_CV = {
    head: TRUNK_CV, neck: TRUNK_CV,
    spine: { cervical: TRUNK_CV, thoracic: TRUNK_CV, lumbar: TRUNK_CV },
    shoulderBreadth: BREADTH_CV, biIliacBreadth: BREADTH_CV,
    clavicle: LIMB_CV, pelvisHeight: TRUNK_CV,
    upperArm: LIMB_CV, forearm: LIMB_CV, hand: LIMB_CV,
    thigh: LIMB_CV, shank: LIMB_CV, footLength: LIMB_CV, footHeight: LIMB_CV
  };

  // ---- stature itself -----------------------------------------------------
  const STATURE_MM = { male: 1756, female: 1625 };  // approx, SOURCES.ansurII —
                                                      // commonly-cited means, not
                                                      // re-verified to the mm this pass
  const STATURE_SD_MM = { male: 66, female: 61 };    // approx, SOURCES.ansurII —
                                                      // both ~3.7-3.8% CV, which is
                                                      // this file's evidence for how
                                                      // tight an overall-size draw
                                                      // should be before any per-part
                                                      // residual is added on top

  // ============================================================================
  // 2. GIRTHS — fraction of stature (H), at the landmarks a surface loft needs
  // ============================================================================
  // ANSUR II (SOURCES.ansurII) publishes these as absolute cm, by sex, not as
  // stature fractions — the fractions below are this file's own division of
  // the commonly-cited ANSUR II absolute means by the commonly-cited ANSUR II
  // mean statures above, so they inherit that same "approx" softness. Girths
  // are also a genuinely worse fit for "fraction of stature" than lengths
  // are: waist and chest track adiposity as much as skeleton, which is why
  // their CV further down is the highest in the file, not an authoring slip.
  const GIRTH_ANSUR_CM = {
    male: { neck: 39.8, chestNipple: 105.9, waist: 103.0, hips: 105.6, midThigh: 62.5, upperArmRelaxed: 35.8, forearmMax: 31.0, wrist: 17.6, calf: 39.2 },
    female: { neck: 33.0, chestNipple: 94.7, waist: 97.9, hips: 109.8, midThigh: 61.6 }
    // ANSUR II female calf and wrist weren't recovered this pass; filled in
    // just below from the male value, scaled by a ratio est from the OTHER
    // sex-matched pairs above (which run 0.90-1.0, segment-dependent) rather
    // than left blank, so `build` still has something real to interpolate
    // against for every girth.
  };
  GIRTH_ANSUR_CM.female.calf = GIRTH_ANSUR_CM.male.calf * 0.95;    // est
  GIRTH_ANSUR_CM.female.wrist = GIRTH_ANSUR_CM.male.wrist * 0.93;  // est

  function girthFractionFromAnsur(sex, key) {
    return (GIRTH_ANSUR_CM[sex][key] * 10) / STATURE_MM[sex]; // cm -> mm, / stature mm
  }

  const GIRTH_KEYS = ['neck', 'chestNipple', 'waist', 'hips', 'midThigh', 'upperArmRelaxed', 'forearmMax', 'wrist', 'calf'];
  const GIRTH_FRACTION = {}, GIRTH_BUILD = {};
  for (const k of GIRTH_KEYS) {
    const m = girthFractionFromAnsur('male', k), f = girthFractionFromAnsur('female', k);
    GIRTH_FRACTION[k] = (m + f) / 2;
    GIRTH_BUILD[k] = (m - f) / 2;   // same convention as SEGMENT_BUILD: +1 build ~ male-typical
  }
  // Two landmarks ANSUR doesn't carry at all: knee and ankle girth. Both are
  // est, from commonly-quoted tape-measurement reference figures (knee
  // ~37cm, ankle ~23cm at a ~176cm reference stature) rather than a named
  // survey, and carry no build slope for lack of any sex-differenced source.
  GIRTH_FRACTION.knee = 0.210; GIRTH_BUILD.knee = 0;
  GIRTH_FRACTION.ankle = 0.131; GIRTH_BUILD.ankle = 0;
  // Flexing necessarily adds bulk over relaxed — the direction is not in
  // question, only the size of the increment, which is why this is a flat
  // add rather than its own sex-differenced anchor. est increment.
  GIRTH_FRACTION.upperArmFlexed = GIRTH_FRACTION.upperArmRelaxed + 0.014; // ~+2.5cm @ 1750mm
  GIRTH_BUILD.upperArmFlexed = GIRTH_BUILD.upperArmRelaxed;

  // est throughout — no per-measure SD was recovered from ANSUR this pass, so
  // this follows the well-attested general pattern instead: waist and chest,
  // adiposity-driven, vary far more across a population than a tape around
  // the wrist or ankle, which is mostly bone, ever does.
  const GIRTH_CV = {
    neck: 0.06, chestNipple: 0.09, waist: 0.13, hips: 0.09, midThigh: 0.10, knee: 0.07,
    calf: 0.08, ankle: 0.055, upperArmRelaxed: 0.10, upperArmFlexed: 0.10, forearmMax: 0.08, wrist: 0.05
  };

  // ============================================================================
  // 3. RANGE OF MOTION — degrees in every literal table; toRad() is the one
  //    place that becomes radians. Neutral = anatomical standing position for
  //    every joint except where a block says otherwise.
  // ============================================================================

  // ---- cervical spine (SOURCES.whitePanjabi). flex/ext are each their own
  // positive magnitude (asymmetric at the two upper levels — C0-1 is nearly
  // all extension, C1-2 nearly symmetric); lat and rot are reported "to one
  // side" and treated as left-right symmetric, matching how the source
  // itself reports them. `src` marks which rows are the directly-cited
  // measurement and which are the commonly-reproduced-but-not-reverified
  // subaxial figures.
  const CERVICAL_LEVELS = [
    { level: 'C0-C1', flex: 3.5, ext: 21.0, lat: 5.5, rot: 7.2, src: 'measured' },
    { level: 'C1-C2', flex: 11.5, ext: 10.9, lat: 6.7, rot: 38.9, src: 'measured' }, // most of the neck's own axial rotation lives right here
    { level: 'C2-C3', flex: 5.0, ext: 5.0, lat: 10.0, rot: 9.0, src: 'est' },
    { level: 'C3-C4', flex: 7.5, ext: 7.5, lat: 11.0, rot: 11.0, src: 'est' },
    { level: 'C4-C5', flex: 10.0, ext: 10.0, lat: 11.0, rot: 12.0, src: 'est' },
    { level: 'C5-C6', flex: 10.0, ext: 10.0, lat: 8.0, rot: 10.0, src: 'est' },
    { level: 'C6-C7', flex: 8.5, ext: 8.5, lat: 7.0, rot: 9.0, src: 'est' },
    { level: 'C7-T1', flex: 4.5, ext: 4.5, lat: 4.0, rot: 2.0, src: 'est' }
  ];

  // ---- thoracic spine (SOURCES.thoracicSegmental). flexExt is the combined
  // arc (the source doesn't split flex from ext at this grain); lat and rot
  // are one-side. Axial rotation breaks from the flex/ext U-shape (stiff
  // mid-thoracic, loose at both transition zones) and instead falls toward
  // the lumbar spine's near-zero rotation through the thoracolumbar junction
  // as the facets change orientation — that fall is itself part of the
  // source figure (T11-12 rot = 1.8, well below the pooled mid-thoracic
  // range); the peak location (T4-6) is est. These twelve levels sum to
  // ~58deg combined flexion-extension, well above the ~28deg a systematic
  // review reports for skin-surface/goniometer-measured whole-region
  // clinical ROM — the same well-documented gap as the cervical table above:
  // in-vitro segmental sums (pure applied moment, no muscular or soft-tissue
  // limit) run higher than in-vivo global measurement. Both are real
  // numbers measuring different things; this table is the segmental one,
  // because that is what a per-vertebra rig needs.
  const THORACIC_LEVELS = [
    { level: 'T1-T2', flexExt: 13.8, lat: 4.4, rot: 4.0, src: 'measured' },
    { level: 'T2-T3', flexExt: 7.0, lat: 3.8, rot: 4.6, src: 'est' },
    { level: 'T3-T4', flexExt: 4.5, lat: 3.0, rot: 5.0, src: 'est' },
    { level: 'T4-T5', flexExt: 3.2, lat: 2.6, rot: 5.2, src: 'est' },
    { level: 'T5-T6', flexExt: 2.8, lat: 2.3, rot: 5.0, src: 'est' },
    { level: 'T6-T7', flexExt: 2.6, lat: 2.1, rot: 4.6, src: 'est' },
    { level: 'T7-T8', flexExt: 2.6, lat: 2.1, rot: 4.2, src: 'est' },
    { level: 'T8-T9', flexExt: 2.8, lat: 2.3, rot: 3.8, src: 'est' },
    { level: 'T9-T10', flexExt: 3.2, lat: 2.6, rot: 3.2, src: 'est' },
    { level: 'T10-T11', flexExt: 3.8, lat: 3.0, rot: 2.4, src: 'est' },
    { level: 'T11-T12', flexExt: 5.1, lat: 3.5, rot: 1.8, src: 'measured' },
    { level: 'T12-L1', flexExt: 6.8, lat: 4.0, rot: 1.3, src: 'est' }
  ];

  // ---- lumbar spine. flexExt arc is SOURCES.lumbarSegmental, measured
  // directly at all five levels. lat and rot are est: lumbar axial rotation
  // in particular is well established as small at EVERY level, because the
  // facet joints are oriented near-sagittally and mechanically block it —
  // it is the reason a golf or batting swing's rotation comes from the
  // thoracic spine and the hips and not the low back — so the small,
  // gently-tapering numbers below express that fact; they are not a
  // level-by-level measurement.
  const LUMBAR_LEVELS = [
    { level: 'L1-L2', flexExt: 11.9, lat: 6.0, rot: 2.0, src: 'flexExt measured, lat/rot est' },
    { level: 'L2-L3', flexExt: 14.5, lat: 6.0, rot: 2.0, src: 'flexExt measured, lat/rot est' },
    { level: 'L3-L4', flexExt: 15.3, lat: 5.0, rot: 1.8, src: 'flexExt measured, lat/rot est' },
    { level: 'L4-L5', flexExt: 18.2, lat: 3.0, rot: 1.5, src: 'flexExt measured, lat/rot est' },
    { level: 'L5-S1', flexExt: 17.0, lat: 2.0, rot: 1.5, src: 'flexExt measured, lat/rot est' }
  ];
  // The source gives only the combined arc, not its flexion/extension split.
  // Whole-lumbar clinical measures commonly run close to a 3:1 flexion-heavy
  // split (e.g. ~50deg flexion / ~15deg extension at the regional level);
  // applied uniformly per level in the absence of a level-by-level split. est.
  const LUMBAR_FLEX_SHARE = 0.75;

  // ---- shoulder (SOURCES.aaos for the headline numbers; SOURCES.inman for
  // the rhythm ratio). Rotation range is abduction-dependent, measured
  // consistently larger with the arm elevated than at the side; AAOS's
  // 70/90 IR/ER figures are the ~90deg-abduction convention most clinics
  // use. The at-the-side anchor is est, by the same capsular/torso-clearance
  // logic documented for external rotation specifically.
  const SHOULDER = {
    flex: 180, ext: 60, abd: 180, add: 30,   // add: est, AAOS's chart omits it
    rotAtSide: { int: 60, ext: 60 },          // est, abduction ~0
    rotAt90Abd: { int: 70, ext: 90 }          // SOURCES.aaos
  };
  // The classic scalar ratio (SOURCES.inman): scapulothoracic motion is 1/3
  // of total humeral elevation, glenohumeral the other 2/3 — a single ratio
  // applied across the whole 0-180deg arc, which is the simplification most
  // consistent with the commonly-cited "120deg GH / 60deg ST over the full
  // 180" headline result. Inman's own data also describes a "setting phase"
  // in the first ~30deg where the scapula moves relatively little; that
  // qualitative detail is real but is not separately modelled as a kink here
  // (a hard early-zero followed by a steeper post-30 ratio does NOT actually
  // reconcile back to the cited 120/60 endpoint under simple linear
  // arithmetic, so rather than encode an inconsistency this file uses the
  // single ratio that does match the cited number, and keeps the phase as
  // a documented qualitative note via SCAPULA_SETTING_PHASE below).
  const SCAPULOHUMERAL_RATIO = 2;
  const SCAPULA_SETTING_PHASE = 30; // deg of humeral elevation before the scapula
                                     // meaningfully joins in — informational, SOURCES.inman

  // ---- elbow (SOURCES.aaos for flex/ext; SOURCES.carryingAngle for the
  // valgus angle, which AAOS's chart doesn't carry at all). The angle closes
  // toward ~0 by mid-flexion as the trochlea's asymmetric spiral rotates the
  // forearm back under the humerus — a real mechanism, but the closing curve
  // itself is this file's own smoothstep, not a digitised source curve.
  const ELBOW = { flex: 145, hyperext: 8 }; // hyperext: est, physiologic laxity,
                                             // larger in women and children
  const CARRYING_ANGLE = { base: 13.9, build: -4.6 }; // deg; SOURCES.carryingAngle pooled
                                                        // means (~9.3 male, ~18.5 female)
                                                        // -> base = their mean, build =
                                                        // half their spread
  const CARRYING_ANGLE_CLOSE_BY = 100; // deg of flexion by which the angle has closed to ~0. est.

  // ---- forearm (SOURCES.aaos). Some sources (Norkin/Levangie-style
  // goniometry texts, and graphite-kinematics' own wrist table) report up to
  // 85-90deg either way; AAOS's rounder 80/80 is used here as the primary
  // figure, noted as the point where sources disagree.
  // Neutral here is mid-rotation (thumb up), NOT palms-forward.
  const FOREARM_ROM = { pron: 80, sup: 80 };

  // ---- hip. Flexion is knee-position-coupled (rectus femoris and the
  // hamstrings slacken as the knee bends, letting the hip fold further — the
  // same reason a tucked cannonball jump folds deeper than a straight-leg
  // toe touch); rotation is hip-flexion-position-coupled (seated ~90deg
  // flexion versus prone ~neutral extension give measurably different
  // rotation — SOURCES.hipRotationPosition, mean and SD both real). Flex/ext/
  // abd/add envelope numbers are SOURCES.aaos except where noted.
  const HIP = {
    flexKneeExt: 95,     // est synthesis — AAOS's flat 120 doesn't distinguish knee
                          // position; ~90-100 is the commonly quoted knee-extended
                          // figure (straight-leg-raise territory)
    flexKneeFlex: 122,    // est synthesis — ~120-125 is the commonly quoted
                          // knee-flexed figure (heel toward hip)
    ext: 30,              // SOURCES.aaos; pelvis-stabilised (Thomas-test-controlled)
                          // measures commonly read lower, ~10-20 — AAOS's less-
                          // controlled 30 is used as the primary figure
    abd: 45, add: 25,     // abd: SOURCES.aaos; add: est, AAOS's chart omits it
    rotSeated: { int: 33, ext: 36 },  // SOURCES.hipRotationPosition, +-7deg SD both
    rotProne: { int: 36, ext: 45 }    // SOURCES.hipRotationPosition, +-9/+-10deg SD
  };

  // ---- knee (SOURCES.aaos for flexion; SOURCES.screwHome for the coupled
  // rotation, which is not a free DOF — it is an obligate rotation that
  // DEVELOPS over the terminal ~20-30deg of extension and is what locks the
  // knee for standing).
  const KNEE = { flex: 135, hyperext: 5 };          // hyperext: est, genu recurvatum laxity
  const SCREW_HOME = { deg: 15, overFlexDeg: 25 };  // SOURCES.screwHome

  // ---- ankle, subtalar. Dorsiflexion is knee-position-coupled through
  // gastrocnemius, which crosses both joints and goes slack once the knee
  // bends (SOURCES.silfverskiold). Plantarflexion is not meaningfully
  // knee-coupled — soleus, the dominant plantarflexor at a bent knee, is
  // uniarticular — so it gets a flat range. Subtalar figures are standard
  // orthopaedic-consensus values: ~2:1 inversion:eversion.
  const ANKLE = { dorsiKneeExt: 12, dorsiKneeFlex: 22, plantar: 45 };
  const SUBTALAR = { inversion: 25, eversion: 12 };

  // Outer bound across every context a coupling can produce — used by the
  // self-check below to confirm a coupled query can never walk outside the
  // envelope its own two anchors define.
  const ROM_ENVELOPE = {
    hipFlex: { min: -toRad(HIP.ext), max: toRad(HIP.flexKneeFlex) },
    hipRot: { min: -toRad(Math.max(HIP.rotSeated.int, HIP.rotProne.int)), max: toRad(Math.max(HIP.rotSeated.ext, HIP.rotProne.ext)) },
    shoulderRot: { min: -toRad(Math.max(SHOULDER.rotAtSide.int, SHOULDER.rotAt90Abd.int)), max: toRad(Math.max(SHOULDER.rotAtSide.ext, SHOULDER.rotAt90Abd.ext)) },
    ankleDorsi: { min: -toRad(ANKLE.plantar), max: toRad(ANKLE.dorsiKneeFlex) }
  };

  // ============================================================================
  // 4. RESOLVERS — the small pure functions
  // ============================================================================

  /** resolved segment lengths in mm for a given stature (mm) and build (-1..1) */
  function segments(stature, build) {
    build = build || 0;
    const s = SEGMENT_FRACTION;
    const cervicalLen = stature * s.spine.cervical;
    const thoracicLen = stature * s.spine.thoracic;
    const lumbarLen = stature * s.spine.lumbar;
    return {
      head: stature * s.head,
      neck: stature * s.neck,
      spine: {
        cervical: cervicalLen, cervicalPerVertebra: s.spine.cervicalVertebraWeight.map((w) => w * cervicalLen),
        thoracic: thoracicLen, thoracicPerVertebra: s.spine.thoracicVertebraWeight.map((w) => w * thoracicLen),
        lumbar: lumbarLen, lumbarPerVertebra: s.spine.lumbarVertebraWeight.map((w) => w * lumbarLen)
      },
      shoulderBreadth: stature * (s.shoulderBreadth + SEGMENT_BUILD.shoulderBreadth * build),
      biIliacBreadth: stature * (s.biIliacBreadth + SEGMENT_BUILD.biIliacBreadth * build),
      clavicle: stature * s.clavicle,
      pelvisHeight: stature * s.pelvisHeight,
      upperArm: stature * s.upperArm, forearm: stature * s.forearm, hand: stature * s.hand,
      thigh: stature * s.thigh, shank: stature * s.shank,
      footLength: stature * s.footLength, footHeight: stature * s.footHeight
    };
  }

  /** resolved girths in mm for a given stature (mm) and build (-1..1) */
  function girths(stature, build) {
    build = build || 0;
    const out = {};
    for (const k in GIRTH_FRACTION) out[k] = stature * (GIRTH_FRACTION[k] + (GIRTH_BUILD[k] || 0) * build);
    return out;
  }

  function findLevel(table, level) { return table.find((r) => r.level === level) || null; }

  /**
   * romFor(joint, axis, context) -> {min, max} in RADIANS about the joint's
   * neutral (see the header comment for sign convention and the two
   * exceptions). `context` carries whatever a coupling needs (level,
   * kneeFlexionRad, abductionRad, hipFlexionRad) — every context input is
   * clamped, so an out-of-range caller cannot walk the result outside
   * ROM_ENVELOPE. Returns null for an axis a joint doesn't have.
   */
  function romFor(joint, axis, context) {
    context = context || {};
    switch (joint) {
      case 'cervical': case 'thoracic': case 'lumbar': {
        const table = joint === 'cervical' ? CERVICAL_LEVELS : joint === 'thoracic' ? THORACIC_LEVELS : LUMBAR_LEVELS;
        const row = findLevel(table, context.level);
        if (!row) return null;
        if (axis === 'lateral') return { min: -toRad(row.lat), max: toRad(row.lat) };
        if (axis === 'rotation') return { min: -toRad(row.rot), max: toRad(row.rot) };
        if (axis !== 'flexExt') return null;
        if (joint === 'cervical') return { min: -toRad(row.ext), max: toRad(row.flex) };
        if (joint === 'thoracic') return { min: -toRad(row.flexExt * 0.5), max: toRad(row.flexExt * 0.5) }; // source gives only the combined arc; split evenly, no thoracic asymmetry documented at this grain
        { const flex = row.flexExt * LUMBAR_FLEX_SHARE; return { min: -toRad(row.flexExt - flex), max: toRad(flex) }; }
      }
      case 'shoulder': {
        if (axis === 'flexExt') return { min: -toRad(SHOULDER.ext), max: toRad(SHOULDER.flex) };
        if (axis === 'abdAdd') return { min: -toRad(SHOULDER.add), max: toRad(SHOULDER.abd) };
        if (axis === 'rotation') {
          // abduction 0..90deg spans the two anchors; beyond 90 this file has
          // no further data, so it holds at the 90deg figures rather than
          // extrapolating past what was measured.
          const t = clamp(context.abductionRad || 0, 0, Math.PI / 2) / (Math.PI / 2);
          const int = lerp(SHOULDER.rotAtSide.int, SHOULDER.rotAt90Abd.int, M.smoothstep(t));
          const ext = lerp(SHOULDER.rotAtSide.ext, SHOULDER.rotAt90Abd.ext, M.smoothstep(t));
          return { min: -toRad(int), max: toRad(ext) };
        }
        return null;
      }
      case 'elbow': return axis === 'flexExt' ? { min: -toRad(ELBOW.hyperext), max: toRad(ELBOW.flex) } : null;
      case 'forearm': return axis === 'pronSup' ? { min: -toRad(FOREARM_ROM.sup), max: toRad(FOREARM_ROM.pron) } : null;
      case 'hip': {
        if (axis === 'flexExt') {
          const t = clamp(context.kneeFlexionRad || 0, 0, toRad(KNEE.flex)) / toRad(KNEE.flex);
          const flexMax = lerp(HIP.flexKneeExt, HIP.flexKneeFlex, M.smoothstep(t));
          return { min: -toRad(HIP.ext), max: toRad(flexMax) };
        }
        if (axis === 'abdAdd') return { min: -toRad(HIP.add), max: toRad(HIP.abd) };
        if (axis === 'rotation') {
          // hipFlexionRad 0 = prone/near-extended .. PI/2 = seated; the two
          // measured anchors, interpolated, not extrapolated beyond 90deg.
          const t = clamp(context.hipFlexionRad || 0, 0, Math.PI / 2) / (Math.PI / 2);
          const int = lerp(HIP.rotProne.int, HIP.rotSeated.int, M.smoothstep(t));
          const ext = lerp(HIP.rotProne.ext, HIP.rotSeated.ext, M.smoothstep(t));
          return { min: -toRad(int), max: toRad(ext) };
        }
        return null;
      }
      case 'knee': return axis === 'flexExt' ? { min: -toRad(KNEE.hyperext), max: toRad(KNEE.flex) } : null;
      case 'ankle': {
        if (axis !== 'dorsiPlantar') return null;
        // 90deg of KNEE flexion is enough to fully slacken gastrocnemius —
        // well short of the knee's own 135deg — so that, not KNEE.flex, is
        // the coupling's own reference range.
        const t = clamp(context.kneeFlexionRad || 0, 0, toRad(90)) / toRad(90);
        const dorsi = lerp(ANKLE.dorsiKneeExt, ANKLE.dorsiKneeFlex, M.smoothstep(t));
        return { min: -toRad(ANKLE.plantar), max: toRad(dorsi) };
      }
      case 'subtalar': return axis === 'invEv' ? { min: -toRad(SUBTALAR.eversion), max: toRad(SUBTALAR.inversion) } : null;
      default: return null;
    }
  }

  /** how humeral elevation splits between the glenohumeral and scapulothoracic
   *  joints (Inman's classic 2:1 rhythm, SOURCES.inman) — both in radians,
   *  and by construction they always sum back to the input. */
  function scapulohumeralSplit(totalElevationRad) {
    const totalDeg = clamp(totalElevationRad / DEG, 0, SHOULDER.flex);
    const scapular = totalDeg / (SCAPULOHUMERAL_RATIO + 1);
    const glenohumeral = totalDeg - scapular;
    return { glenohumeral: toRad(glenohumeral), scapulothoracic: toRad(scapular) };
  }

  /** elbow carrying angle (radians) at a given flexion and build; the valgus
   *  angle present at extension closes toward 0 as the elbow flexes past
   *  ~CARRYING_ANGLE_CLOSE_BY degrees (SOURCES.carryingAngle for the base
   *  figure; the closing curve is this file's own model). */
  function carryingAngle(flexionRad, build) {
    const full = CARRYING_ANGLE.base + CARRYING_ANGLE.build * (build || 0);
    const t = clamp((flexionRad / DEG) / CARRYING_ANGLE_CLOSE_BY, 0, 1);
    return toRad(full) * (1 - M.smoothstep(t));
  }

  /** obligate external tibial rotation from the knee's screw-home mechanism,
   *  as a function of knee flexion (0 = full extension); radians, external+
   *  (SOURCES.screwHome). */
  function screwHomeRotation(flexionRad) {
    const t = clamp((flexionRad / DEG) / SCREW_HOME.overFlexDeg, 0, 1);
    return toRad(SCREW_HOME.deg) * (1 - M.smoothstep(t));
  }

  // ============================================================================
  // 5. SELF-CHECK
  // ============================================================================
  /**
   * Internal consistency, not truth — this cannot tell a mis-transcribed
   * citation from a correct one, only that the numbers agree with each other
   * the way real anatomy has to. Four kinds of check: (a) weight arrays and
   * derived totals sum the way their own construction promises; (b) every
   * static ROM entry has min <= max; (c) every coupled ROM query stays
   * inside its own envelope across a sweep of contexts, and still has
   * min <= max at each one; (d) girths and a small sampled population of
   * seeded bodies come out mechanically sane (positive, correctly ordered,
   * plausible). The seeded sampling in (d) is exactly the "seeded generator
   * perturbs within real limits" the variance tables exist for — kept local
   * to this check rather than exported, because graphite-figure's own
   * 20-build.js.buildFigure(seed) is the project's actual seeded generator
   * and this file supplies it data, not a second generator to compete with it.
   */
  function selfCheck() {
    const issues = [];
    const near = (a, b, tol, msg) => { if (Math.abs(a - b) > tol) issues.push(msg + ` (${a.toFixed(4)} vs ${b.toFixed(4)})`); };

    // -- (a) weight arrays sum to 1, and lengths match their construction --
    near(CERVICAL_VERTEBRA_WEIGHT.reduce((a, b) => a + b, 0), 1, 1e-9, 'cervicalVertebraWeight does not sum to 1');
    near(THORACIC_VERTEBRA_WEIGHT.reduce((a, b) => a + b, 0), 1, 1e-9, 'thoracicVertebraWeight does not sum to 1');
    near(LUMBAR_VERTEBRA_WEIGHT.reduce((a, b) => a + b, 0), 1, 1e-9, 'lumbarVertebraWeight does not sum to 1');
    if (CERVICAL_VERTEBRA_WEIGHT.length !== 7) issues.push('cervical vertebra count != 7');
    if (THORACIC_VERTEBRA_WEIGHT.length !== 12) issues.push('thoracic vertebra count != 12');
    if (LUMBAR_VERTEBRA_WEIGHT.length !== 5) issues.push('lumbar vertebra count != 5');
    if (CERVICAL_LEVELS.length !== 8) issues.push('cervical ROM level count != 8 (C0-C1..C7-T1)');

    near(SEGMENT_FRACTION.head + SEGMENT_FRACTION.neck, HEAD_NECK, 1e-9, 'head+neck drifted from the source head-and-neck figure');

    // classic total-leg-length cross-check: thigh+shank+footHeight ~ 0.53H
    const legSum = SEGMENT_FRACTION.thigh + SEGMENT_FRACTION.shank + SEGMENT_FRACTION.footHeight;
    near(legSum, 0.530, 0.012, 'thigh+shank+footHeight drifted from the classic ~0.53H total leg length');

    // per-vertebra lengths sum to the regional total, at an arbitrary stature
    const S = segments(1750, 0);
    near(S.spine.cervicalPerVertebra.reduce((a, b) => a + b, 0), S.spine.cervical, 1e-6, 'cervical per-vertebra does not sum to the regional total');
    near(S.spine.thoracicPerVertebra.reduce((a, b) => a + b, 0), S.spine.thoracic, 1e-6, 'thoracic per-vertebra does not sum to the regional total');
    near(S.spine.lumbarPerVertebra.reduce((a, b) => a + b, 0), S.spine.lumbar, 1e-6, 'lumbar per-vertebra does not sum to the regional total');

    // scapulohumeral split: components sum to the input at every sampled elevation,
    // and the classic 180deg endpoint reproduces the cited 60deg scapular share
    for (let i = 0; i <= 6; i++) {
      const el = (i / 6) * toRad(SHOULDER.flex);
      const sp = scapulohumeralSplit(el);
      if (sp.glenohumeral < -1e-9 || sp.scapulothoracic < -1e-9) issues.push('scapulohumeralSplit produced a negative share at i=' + i);
      near(sp.glenohumeral + sp.scapulothoracic, el, 1e-6, 'scapulohumeralSplit components do not sum to the input at i=' + i);
    }
    near(scapulohumeralSplit(toRad(180)).scapulothoracic, toRad(60), 1e-6, 'scapulohumeralSplit(180deg) drifted from the cited 60deg scapular share');

    // -- (b) every static ROM entry: min <= max --
    const staticChecks = [
      ...CERVICAL_LEVELS.flatMap((r) => ['flexExt', 'lateral', 'rotation'].map((axis) => ['cervical', axis, { level: r.level }])),
      ...THORACIC_LEVELS.flatMap((r) => ['flexExt', 'lateral', 'rotation'].map((axis) => ['thoracic', axis, { level: r.level }])),
      ...LUMBAR_LEVELS.flatMap((r) => ['flexExt', 'lateral', 'rotation'].map((axis) => ['lumbar', axis, { level: r.level }])),
      ['shoulder', 'flexExt', {}], ['shoulder', 'abdAdd', {}], ['shoulder', 'rotation', {}],
      ['elbow', 'flexExt', {}], ['forearm', 'pronSup', {}],
      ['hip', 'flexExt', {}], ['hip', 'abdAdd', {}], ['hip', 'rotation', {}],
      ['knee', 'flexExt', {}], ['ankle', 'dorsiPlantar', {}], ['subtalar', 'invEv', {}]
    ];
    for (const [joint, axis, ctx] of staticChecks) {
      const r = romFor(joint, axis, ctx);
      if (!r) { issues.push(`romFor(${joint},${axis}) returned null`); continue; }
      if (r.min > r.max) issues.push(`romFor(${joint},${axis},${JSON.stringify(ctx)}) has min > max`);
    }

    // -- (c) coupled ranges: min<=max at every sampled context, and never
    // escape the envelope those two anchors define --
    const N = 9;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const hipFlex = romFor('hip', 'flexExt', { kneeFlexionRad: t * toRad(KNEE.flex) });
      if (hipFlex.min > hipFlex.max) issues.push('hip flexExt min>max at t=' + t);
      if (hipFlex.max > ROM_ENVELOPE.hipFlex.max + 1e-9 || hipFlex.min < ROM_ENVELOPE.hipFlex.min - 1e-9) issues.push('hip flexExt escaped its envelope at t=' + t);

      const hipRot = romFor('hip', 'rotation', { hipFlexionRad: t * (Math.PI / 2) });
      if (hipRot.min > hipRot.max) issues.push('hip rotation min>max at t=' + t);
      if (hipRot.max > ROM_ENVELOPE.hipRot.max + 1e-9 || hipRot.min < ROM_ENVELOPE.hipRot.min - 1e-9) issues.push('hip rotation escaped its envelope at t=' + t);

      const shRot = romFor('shoulder', 'rotation', { abductionRad: t * (Math.PI / 2) });
      if (shRot.min > shRot.max) issues.push('shoulder rotation min>max at t=' + t);
      if (shRot.max > ROM_ENVELOPE.shoulderRot.max + 1e-9 || shRot.min < ROM_ENVELOPE.shoulderRot.min - 1e-9) issues.push('shoulder rotation escaped its envelope at t=' + t);

      const dorsi = romFor('ankle', 'dorsiPlantar', { kneeFlexionRad: t * toRad(90) });
      if (dorsi.min > dorsi.max) issues.push('ankle dorsiPlantar min>max at t=' + t);
      if (dorsi.max > ROM_ENVELOPE.ankleDorsi.max + 1e-9 || dorsi.min < ROM_ENVELOPE.ankleDorsi.min - 1e-9) issues.push('ankle dorsiPlantar escaped its envelope at t=' + t);

      const carry = carryingAngle(t * toRad(150), 0);
      if (carry < -1e-9 || carry > toRad(CARRYING_ANGLE.base) + 1e-6) issues.push('carryingAngle out of bounds at t=' + t);

      const screw = screwHomeRotation(t * toRad(KNEE.flex));
      if (screw < -1e-9 || screw > toRad(SCREW_HOME.deg) + 1e-9) issues.push('screwHomeRotation out of bounds at t=' + t);
    }

    // -- (d) girths: mechanically required orderings, and all positive --
    const g175 = girths(1750, 0);
    if (g175.upperArmFlexed < g175.upperArmRelaxed) issues.push('flexed upper arm girth is smaller than relaxed');
    if (g175.forearmMax < g175.wrist) issues.push('forearm max girth is smaller than wrist girth');
    for (const k in g175) if (!(g175[k] > 0)) issues.push('girth ' + k + ' is non-positive');
    for (const k in S) if (typeof S[k] === 'number' && !(S[k] > 0)) issues.push('segment ' + k + ' is non-positive');

    // seeded sampling: draw stature/build the way a caller (graphite-figure's
    // own buildFigure) would, jitter every segment by its own SEGMENT_CV on
    // top, and confirm a population of seeds stays plausible and internally
    // consistent — this is the actual exercise of "a seeded generator can
    // perturb within real limits", just not exported as one.
    const rng = new Rng(90210);
    const jitter = (cv) => rng.gaussIn(1, cv, 1 - 3 * cv, 1 + 3 * cv);
    let sampled = 0;
    for (const sex of ['male', 'female']) {
      for (let n = 0; n < 40; n++) {
        sampled++;
        const mu = STATURE_MM[sex], sd = STATURE_SD_MM[sex];
        const stature = rng.gaussIn(mu, sd, mu - 3.2 * sd, mu + 3.2 * sd);
        const buildMu = sex === 'male' ? 0.6 : -0.6;
        const build = rng.gaussIn(buildMu, 0.55, -2.2, 2.2);
        const nominal = segments(stature, build);
        const thigh = nominal.thigh * jitter(SEGMENT_CV.thigh);
        const shank = nominal.shank * jitter(SEGMENT_CV.shank);
        const shoulderBreadth = nominal.shoulderBreadth * jitter(SEGMENT_CV.shoulderBreadth);
        const biIliacBreadth = nominal.biIliacBreadth * jitter(SEGMENT_CV.biIliacBreadth);
        if (!(stature > 1300 && stature < 2100)) issues.push(`sampled ${sex} stature implausible: ${stature.toFixed(0)}mm`);
        if (!(thigh > 0 && shank > 0)) issues.push(`sampled ${sex} produced a non-positive leg segment`);
        if (!(shoulderBreadth > 0 && biIliacBreadth > 0)) issues.push(`sampled ${sex} produced a non-positive breadth`);
      }
    }
    // build's documented direction: pooled male draws should read broader in
    // the shoulder-to-pelvis relationship than pooled female draws, on
    // average, since that relationship is the entire reason build exists
    {
      const trial = (sex) => { const b = sex === 'male' ? 0.6 : -0.6; const s = segments(1700, b); return s.shoulderBreadth / s.biIliacBreadth; };
      if (!(trial('male') > trial('female'))) issues.push('build does not separate male/female-typical shoulder:hip ratio in the expected direction');
    }

    return { ok: issues.length === 0, issueCount: issues.length, sampledBodies: sampled, issues };
  }

  GK.ref = {
    SOURCES,
    SEGMENT_FRACTION, SEGMENT_CV, SEGMENT_BUILD,
    STATURE_MM, STATURE_SD_MM,
    GIRTH_FRACTION, GIRTH_BUILD, GIRTH_CV,
    CERVICAL_LEVELS, THORACIC_LEVELS, LUMBAR_LEVELS, LUMBAR_FLEX_SHARE,
    SHOULDER, SCAPULOHUMERAL_RATIO, SCAPULA_SETTING_PHASE,
    ELBOW, CARRYING_ANGLE, CARRYING_ANGLE_CLOSE_BY, FOREARM_ROM,
    HIP, KNEE, SCREW_HOME, ANKLE, SUBTALAR,
    ROM_ENVELOPE,
    segments, girths, romFor, scapulohumeralSplit, carryingAngle, screwHomeRotation,
    selfCheck
  };
})(window.GK = window.GK || {});
