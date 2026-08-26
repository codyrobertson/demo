/* ============================================================================
   GRAPHITE FIGURE — 00 · refdata
   Joint range-of-motion: measured active range per joint per axis, the
   couplings between joints that matter more than any single range does, and
   the small pure functions that resolve both. No rendering, no geometry, no
   rig, no segment lengths or girths — those are a fitted statistical model
   built directly from anthropometric survey data elsewhere; this file is the
   part that data cannot give, because it was never in it: no population
   survey measures how far a hip flexes with the knee bent. That has to come
   from the biomechanics and orthopaedic-goniometry literature instead, joint
   by joint, and that is what this file is.

   Every number below is either a published biomechanical/orthopaedic value —
   the comment above its block names the source — or is explicitly marked
   `est`. Where two sources disagree, the comment says so and says which was
   taken. A number with neither a citation nor an `est` tag does not belong
   in this file.

   Units. Every LITERAL table is in DEGREES, because that is how the source
   literature reports them and checking a number against its paper is the
   point of citing one. toRad() is the one place a degree becomes a radian;
   nowhere else in this file re-derives that conversion. Every function that
   returns an angle to a caller returns radians.

   Sign convention (every joint, unless a block says otherwise):
     sagittal   : flexion +, extension -              (0 = anatomical position)
     frontal    : abduction +, adduction -           (spine: lateral flexion is
                  reported symmetric in the sources; the sign carries no
                  left/right meaning here, only magnitude)
     transverse : external/lateral rotation +, internal/medial -
                  (forearm: pronation +, supination -; subtalar: inversion +,
                  eversion -)
   Three exceptions, each also noted at its own block: forearm neutral is
   mid-rotation (thumb up), not palms-forward; carrying angle and screw-home
   rotation are not free ranges, they are a single coupled VALUE at a given
   flexion, returned by their own function rather than by romFor(); the
   shoulder's acromion-clearance rotation is likewise a single required
   minimum, not a range.

   COUPLINGS. A joint's range is frequently not a constant — it is a function
   of where a DIFFERENT joint sits, because the muscle that limits it crosses
   both. Four are modelled here, each because a real, named, biarticular (or
   geometric) mechanism drives it, not because coupling everything to
   everything looked thorough:
     hip flexion   <- knee flexion   (hamstrings slacken)
     hip extension <- knee extension (rectus femoris slackens)
     shoulder rotation range <- abduction angle (capsule/torso clearance)
     shoulder elevation ceiling <- axial rotation (acromion clearance)
     ankle dorsiflexion <- knee flexion (gastrocnemius slackens)
   Every one of these is exposed as a function taking the OTHER joint's angle
   in context, never as prose alone.
   ========================================================================== */
(function (GK) {
  'use strict';

  // ---------------------------------------------------------------- constants
  // Prefers GK.math, which is already on the shared namespace by the time
  // this file loads in the one place that actually loads it today
  // (tools/stick.js requires the hand project's 00-math.js before anything
  // in this project). Falls back to a private, equivalent copy of just the
  // four primitives actually used here, so this file also stands up
  // completely alone (`global.window={}; require(...)`), which is how its
  // own self-check below is actually run.
  const M = GK.math || (function () {
    const DEG = Math.PI / 180;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const smoothstep = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
    return { DEG, clamp, lerp, smoothstep };
  })();
  const { DEG, clamp, lerp } = M;

  // -------------------------------------------------------------- provenance
  // Short citations, referenced by key from the block comments below rather
  // than repeated in full at every table.
  const SOURCES = {
    whitePanjabi: 'White & Panjabi, Clinical Biomechanics of the Spine (1978/1990) — in-vitro segmental spine ROM under a standardised pure moment. C0-C1 and C1-C2 rows below are this table directly; the subaxial rows (C2-C3..C7-T1) are the commonly-reproduced values from the same table, not independently re-confirmed against the primary source this pass.',
    lumbarSegmental: 'a multivariate radiographic study of 42 intact lumbar spines, level-by-level flexion-extension arc (L1-2 through L5-S1) — used directly for that one column; lateral bending and rotation per level are not from this study.',
    thoracicSegmental: 'an in-vitro segmental-flexibility study of the thoracic spine — T1-2 and T11-12 are that study\'s own reported means; the other ten levels are this file\'s interpolation along the well-attested regional pattern (stiff through the rib-braced mid-thoracic, loose at both transition zones).',
    aaos: 'American Academy of Orthopaedic Surgeons, Joint Motion: Method of Measuring and Recording — the standard clinical goniometry chart.',
    inman: 'Inman, Saunders & Abbott 1944 — the classic 2:1 scapulohumeral rhythm. Modern 3-D studies find the pooled ratio closer to ~2.3:1 and highly non-uniform across the arc; the classic scalar is used here as the simpler, still-standard teaching value.',
    screwHome: 'orthopaedic consensus on the knee screw-home mechanism: ~15deg of obligate external tibial rotation develops over the terminal ~20-30deg of extension (the larger medial femoral condyle running out of articular surface), locking the knee for standing.',
    silfverskiold: 'the Silfverskiold-test literature — ankle dorsiflexion measured with the knee extended (gastrocnemius, which crosses both joints, on stretch) versus flexed (gastrocnemius slack) — the standard clinical way to tell a tight gastrocnemius from a tight soleus.',
    hipRotationPosition: 'goniometric studies comparing hip rotation measured seated (~90deg hip flexion) against prone (hip near neutral extension) — both a measured mean and an SD, not a single textbook number.',
    hipSagittalCoupling: 'the Thomas-test / Ely-test literature: hip flexion range increases as the knee flexes because the hamstrings (crossing both joints posteriorly) slacken, and hip extension range decreases as the knee flexes because rectus femoris (crossing both joints anteriorly) tightens — the direction and the mechanism are standard orthopaedic-exam findings; the specific degree figures at each knee-flexed anchor are this file\'s own est, not this literature\'s numbers.',
    carryingAngle: 'radiographic/goniometric carrying-angle studies (pooled measured means ~9.3deg male / ~18.5deg female, both with several degrees of SD) — used in preference to the rounder 5-15/10-20 textbook rule-of-thumb because it is an actual measured sample.',
    shoulderClearance: 'subacromial-impingement biomechanics: past roughly 90-120deg of elevation the greater tuberosity approaches the acromion/coracoacromial arch, and clearing it needs external rotation — why full overhead elevation is pain-free and achievable in the externally-rotated "full can" position and mechanically blocks well short of 180deg in the internally-rotated "empty can" position (the basis of Neer\'s impingement sign). The threshold and the qualitative mechanism are standard; the specific ramp (linear, 0deg of required rotation at 120deg of elevation to a defensible ceiling at 180deg) is this file\'s own reasoned model, since no single source publishes it as a curve.'
  };

  const toRad = (deg) => deg * DEG;

  // ============================================================================
  // RANGE OF MOTION — degrees in every literal table; toRad() is the one
  // place that becomes radians. Neutral = anatomical standing position for
  // every joint except where a block says otherwise.
  // ============================================================================

  // ---- cervical spine (SOURCES.whitePanjabi). flex/ext are each their own
  // positive magnitude (asymmetric at the two upper levels — C0-1 is nearly
  // all extension, C1-2 nearly symmetric); lat and rot are reported "to one
  // side" and treated as left-right symmetric, matching how the source
  // itself reports them. `src` marks which rows are the directly-cited
  // measurement and which are the commonly-reproduced-but-not-reverified
  // subaxial figures. C1-2 alone carries roughly HALF of the neck's total
  // axial rotation (38.9 of the ~98deg the eight rows below sum to, one
  // side) — the reason a realistic neck rig cannot spread rotation evenly
  // across its seven bones.
  const CERVICAL_LEVELS = [
    { level: 'C0-C1', flex: 3.5, ext: 21.0, lat: 5.5, rot: 7.2, src: 'measured' },
    { level: 'C1-C2', flex: 11.5, ext: 10.9, lat: 6.7, rot: 38.9, src: 'measured' },
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
  // clinical ROM — the same well-documented gap noted again below for the
  // cervical total: in-vitro segmental sums (pure applied moment, no
  // muscular or soft-tissue limit) run higher than in-vivo global
  // measurement. Both are real numbers measuring different things; this
  // table is the segmental one, because that is what a per-vertebra rig needs.
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
  // the rhythm ratio; SOURCES.shoulderClearance for the elevation ceiling).
  // Rotation range is abduction-dependent, measured consistently larger with
  // the arm elevated than at the side; AAOS's 70/90 IR/ER figures are the
  // ~90deg-abduction convention most clinics use. The at-the-side anchor is
  // est, by the same capsular/torso-clearance logic documented for external
  // rotation specifically.
  const SHOULDER = {
    flex: 180, ext: 60, abd: 180, add: 30,   // add: est, AAOS's chart omits it
    rotAtSide: { int: 60, ext: 60 },          // est, abduction ~0
    rotAt90Abd: { int: 70, ext: 90 }          // SOURCES.aaos
  };
  // The classic scalar ratio (SOURCES.inman): scapulothoracic motion is 1/3
  // of total humeral elevation, glenohumeral the other 2/3 — a single ratio
  // applied across the whole 0-180deg arc, the simplification most
  // consistent with the commonly-cited "120deg GH / 60deg ST over the full
  // 180" headline result. Inman's own data also describes a "setting phase"
  // in the first ~30deg where the scapula moves relatively little; that
  // qualitative detail is real but is not separately modelled as a kink here
  // (a hard early-zero followed by a steeper post-30 ratio does NOT actually
  // reconcile back to the cited 120/60 endpoint under simple linear
  // arithmetic, so rather than encode an inconsistency this file uses the
  // single ratio that does match the cited number, and keeps the phase as a
  // documented qualitative note via SCAPULA_SETTING_PHASE below).
  const SCAPULOHUMERAL_RATIO = 2;
  const SCAPULA_SETTING_PHASE = 30; // deg of humeral elevation before the scapula
                                     // meaningfully joins in — informational, SOURCES.inman
  // Acromion clearance (SOURCES.shoulderClearance): below the threshold,
  // elevation needs no particular rotation; past it, the minimum external
  // rotation needed to keep elevating ramps up to rotationAt180 by full
  // overhead reach. rotationAt180 is deliberately smaller than
  // rotAt90Abd.ext (90deg) above — that number is the muscular/capsular
  // ROM ceiling for rotation, a different and larger quantity than the
  // minimum bony clearance modelled here.
  const SHOULDER_CLEARANCE = { elevationThreshold: 120, rotationAt180: 40 }; // rotationAt180: est

  // ---- elbow (SOURCES.aaos for flex/ext; SOURCES.carryingAngle for the
  // valgus angle, which AAOS's chart doesn't carry at all). The angle closes
  // toward ~0 by mid-flexion as the trochlea's asymmetric spiral rotates the
  // forearm back under the humerus — a real mechanism, but the closing curve
  // itself is this file's own smoothstep, not a digitised source curve.
  const ELBOW = { flex: 145, hyperext: 8 }; // hyperext: est, physiologic laxity,
                                             // larger in women and children
  const CARRYING_ANGLE = { male: 9.3, female: 18.5, average: 13.9 }; // deg, SOURCES.carryingAngle
                                                                      // pooled measured means
  const CARRYING_ANGLE_CLOSE_BY = 100; // deg of flexion by which the angle has closed to ~0. est.

  // ---- forearm (SOURCES.aaos). Some sources (Norkin/Levangie-style
  // goniometry texts, and graphite-kinematics' own wrist table) report up to
  // 85-90deg either way; AAOS's rounder 80/80 is used here as the primary
  // figure, noted as the point where sources disagree.
  // Neutral here is mid-rotation (thumb up), NOT palms-forward.
  const FOREARM_ROM = { pron: 80, sup: 80 };

  // ---- hip. Both sagittal directions are knee-position-coupled, by two
  // different biarticular muscles (SOURCES.hipSagittalCoupling): flexion
  // range grows as the knee flexes (hamstrings, crossing both joints
  // posteriorly, slacken); extension range SHRINKS as the knee flexes
  // (rectus femoris, crossing both joints anteriorly, tightens — the Ely's-
  // test mechanism). Both anchors share the same knee-flexion input, because
  // it is the same knee. Rotation is instead hip-flexion-position-coupled
  // (seated ~90deg flexion versus prone ~neutral extension give measurably
  // different rotation — SOURCES.hipRotationPosition, mean and SD both
  // real). Abd/add envelope numbers are SOURCES.aaos except where noted.
  const HIP = {
    flexKneeExt: 95,      // est synthesis — AAOS's flat 120 doesn't distinguish knee
                           // position; ~90-100 is the commonly quoted knee-extended
                           // figure (straight-leg-raise territory)
    flexKneeFlex: 122,     // est synthesis — ~120-125 is the commonly quoted
                           // knee-flexed figure (heel toward hip)
    extKneeExt: 30,        // SOURCES.aaos, at the knee-extended position that
                           // chart implicitly assumes; pelvis-stabilised
                           // (Thomas-test-controlled) measures commonly read
                           // lower, ~10-20 — AAOS's less-controlled 30 is used
                           // as the primary figure
    extKneeFlex: 10,       // est — reduced by rectus femoris tension; direction and
                           // mechanism are SOURCES.hipSagittalCoupling, the specific
                           // figure is this file's own estimate
    abd: 45, add: 25,      // abd: SOURCES.aaos; add: est, AAOS's chart omits it
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
    hipFlex: { min: -toRad(HIP.extKneeExt), max: toRad(HIP.flexKneeFlex) },
    hipRot: { min: -toRad(Math.max(HIP.rotSeated.int, HIP.rotProne.int)), max: toRad(Math.max(HIP.rotSeated.ext, HIP.rotProne.ext)) },
    shoulderRot: { min: -toRad(Math.max(SHOULDER.rotAtSide.int, SHOULDER.rotAt90Abd.int)), max: toRad(Math.max(SHOULDER.rotAtSide.ext, SHOULDER.rotAt90Abd.ext)) },
    ankleDorsi: { min: -toRad(ANKLE.plantar), max: toRad(ANKLE.dorsiKneeFlex) }
  };

  // ============================================================================
  // RESOLVERS — the small pure functions
  // ============================================================================

  function findLevel(table, level) { return table.find((r) => r.level === level) || null; }

  /**
   * romFor(joint, axis, context) -> {min, max} in RADIANS about the joint's
   * neutral (see the header comment for sign convention and the three
   * exceptions). `context` carries whatever a coupling needs — kneeFlexionRad
   * (hip flexExt, ankle dorsiPlantar), hipFlexionRad (hip rotation),
   * abductionRad (shoulder rotation), axialRotationRad (shoulder flexExt,
   * for the acromion-clearance ceiling) — and every context input is
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
        if (axis === 'flexExt') {
          // Acromion-clearance coupling: past SHOULDER_CLEARANCE.elevationThreshold,
          // the achievable ceiling depends on how much axial rotation is available
          // (context.axialRotationRad) — invert shoulderClearanceRotation() to find
          // the largest elevation that rotation clears. Omitted context = the full
          // static range, i.e. rotation is assumed sufficient.
          let maxElev = SHOULDER.flex;
          if (context.axialRotationRad !== undefined) {
            const rot = Math.abs(context.axialRotationRad) / DEG;
            const t = clamp(rot / SHOULDER_CLEARANCE.rotationAt180, 0, 1);
            maxElev = Math.min(maxElev, SHOULDER_CLEARANCE.elevationThreshold + t * (SHOULDER.flex - SHOULDER_CLEARANCE.elevationThreshold));
          }
          return { min: -toRad(SHOULDER.ext), max: toRad(maxElev) };
        }
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
          // one knee-flexion input drives both anchors, in opposite directions
          const t = clamp(context.kneeFlexionRad || 0, 0, toRad(KNEE.flex)) / toRad(KNEE.flex);
          const flexMax = lerp(HIP.flexKneeExt, HIP.flexKneeFlex, M.smoothstep(t));
          const extMax = lerp(HIP.extKneeExt, HIP.extKneeFlex, M.smoothstep(t));
          return { min: -toRad(extMax), max: toRad(flexMax) };
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

  /** minimum external rotation (radians, unsigned) needed to reach a given
   *  elevation without impinging the greater tuberosity on the acromion —
   *  0 at/below SHOULDER_CLEARANCE.elevationThreshold, ramping to
   *  rotationAt180 by full overhead elevation (SOURCES.shoulderClearance).
   *  romFor('shoulder','flexExt',{axialRotationRad}) is this function
   *  inverted: given the rotation you HAVE, how high you can go. */
  function shoulderClearanceRotation(elevationRad) {
    const elevDeg = clamp(elevationRad / DEG, 0, SHOULDER.flex);
    const span = SHOULDER.flex - SHOULDER_CLEARANCE.elevationThreshold;
    const t = span > 0 ? clamp((elevDeg - SHOULDER_CLEARANCE.elevationThreshold) / span, 0, 1) : 0;
    return toRad(SHOULDER_CLEARANCE.rotationAt180 * t);
  }

  /** elbow carrying angle (radians) at a given flexion and sex ('male' |
   *  'female' | omitted for the pooled average); the valgus angle present at
   *  extension closes toward 0 as the elbow flexes past
   *  ~CARRYING_ANGLE_CLOSE_BY degrees (SOURCES.carryingAngle for the base
   *  figure; the closing curve is this file's own model). */
  function carryingAngle(flexionRad, sex) {
    const full = sex === 'male' ? CARRYING_ANGLE.male : sex === 'female' ? CARRYING_ANGLE.female : CARRYING_ANGLE.average;
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
  // SELF-CHECK
  // ============================================================================
  /**
   * Internal consistency, not truth — this cannot tell a mis-transcribed
   * citation from a correct one, only that the numbers agree with each other
   * the way real anatomy has to. Two kinds of check, as asked: (a) every
   * static ROM entry has min <= max; (b) every coupled ROM query, swept
   * across its whole input range, still has min <= max and never escapes the
   * envelope its own two uncoupled anchors define. A few cheap extra
   * consistency checks (the scapulohumeral split summing back to its input,
   * the clearance ramp being monotonic) are folded in alongside those two
   * because they were already sitting right there once the joints above
   * were being exercised anyway.
   */
  function selfCheck() {
    const issues = [];
    const near = (a, b, tol, msg) => { if (Math.abs(a - b) > tol) issues.push(msg + ` (${a.toFixed(4)} vs ${b.toFixed(4)})`); };

    if (CERVICAL_LEVELS.length !== 8) issues.push('cervical ROM level count != 8 (C0-C1..C7-T1)');
    if (THORACIC_LEVELS.length !== 12) issues.push('thoracic ROM level count != 12 (T1-T2..T12-L1)');
    if (LUMBAR_LEVELS.length !== 5) issues.push('lumbar ROM level count != 5 (L1-L2..L5-S1)');

    // -- (a) every static ROM entry: min <= max --
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

    // -- (b) coupled ranges: min<=max at every sampled context, and never
    // escape the envelope their own two uncoupled anchors define --
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

      const shElev = romFor('shoulder', 'flexExt', { axialRotationRad: t * toRad(SHOULDER_CLEARANCE.rotationAt180) });
      if (shElev.min > shElev.max) issues.push('shoulder flexExt min>max at t=' + t);
      if (shElev.max > toRad(SHOULDER.flex) + 1e-9 || shElev.max < toRad(SHOULDER_CLEARANCE.elevationThreshold) - 1e-6) issues.push('shoulder flexExt clearance cap outside its expected band at t=' + t);

      const dorsi = romFor('ankle', 'dorsiPlantar', { kneeFlexionRad: t * toRad(90) });
      if (dorsi.min > dorsi.max) issues.push('ankle dorsiPlantar min>max at t=' + t);
      if (dorsi.max > ROM_ENVELOPE.ankleDorsi.max + 1e-9 || dorsi.min < ROM_ENVELOPE.ankleDorsi.min - 1e-9) issues.push('ankle dorsiPlantar escaped its envelope at t=' + t);

      const carryM = carryingAngle(t * toRad(150), 'male'), carryF = carryingAngle(t * toRad(150), 'female');
      if (carryM < -1e-9 || carryM > toRad(CARRYING_ANGLE.male) + 1e-6) issues.push('carryingAngle(male) out of bounds at t=' + t);
      if (carryF < -1e-9 || carryF > toRad(CARRYING_ANGLE.female) + 1e-6) issues.push('carryingAngle(female) out of bounds at t=' + t);

      const screw = screwHomeRotation(t * toRad(KNEE.flex));
      if (screw < -1e-9 || screw > toRad(SCREW_HOME.deg) + 1e-9) issues.push('screwHomeRotation out of bounds at t=' + t);

      const clr = shoulderClearanceRotation(t * toRad(SHOULDER.flex));
      if (clr < -1e-9 || clr > toRad(SHOULDER_CLEARANCE.rotationAt180) + 1e-9) issues.push('shoulderClearanceRotation out of bounds at t=' + t);
    }

    // -- hip sagittal coupling: flexion strictly grows and extension strictly
    // shrinks (or holds, never reverses) as the knee flexes -- the whole
    // point of SOURCES.hipSagittalCoupling being two DIFFERENT muscles
    {
      let prevFlexMax = null, prevExtMag = null;
      for (let i = 0; i <= 8; i++) {
        const r = romFor('hip', 'flexExt', { kneeFlexionRad: (i / 8) * toRad(KNEE.flex) });
        const extMag = -r.min; // r.min <= 0 by construction, so extMag >= 0
        if (prevFlexMax !== null && r.max < prevFlexMax - 1e-9) issues.push('hip flexion range is not monotonic non-decreasing with knee flexion at i=' + i);
        if (prevExtMag !== null && extMag > prevExtMag + 1e-9) issues.push('hip extension range is not monotonic non-increasing with knee flexion at i=' + i);
        prevFlexMax = r.max; prevExtMag = extMag;
      }
    }

    // -- scapulohumeral split: components sum to the input at every sampled
    // elevation, and the classic 180deg endpoint reproduces the cited 60deg
    // scapular share --
    for (let i = 0; i <= 6; i++) {
      const el = (i / 6) * toRad(SHOULDER.flex);
      const sp = scapulohumeralSplit(el);
      if (sp.glenohumeral < -1e-9 || sp.scapulothoracic < -1e-9) issues.push('scapulohumeralSplit produced a negative share at i=' + i);
      near(sp.glenohumeral + sp.scapulothoracic, el, 1e-6, 'scapulohumeralSplit components do not sum to the input at i=' + i);
    }
    near(scapulohumeralSplit(toRad(180)).scapulothoracic, toRad(60), 1e-6, 'scapulohumeralSplit(180deg) drifted from the cited 60deg scapular share');

    // -- shoulderClearanceRotation: monotonic, ~0 at/below threshold --
    {
      let prev = -1;
      for (let i = 0; i <= 12; i++) {
        const el = (i / 12) * toRad(SHOULDER.flex);
        const v = shoulderClearanceRotation(el);
        if (v < prev - 1e-9) issues.push('shoulderClearanceRotation is not monotonic at i=' + i);
        prev = v;
      }
      if (shoulderClearanceRotation(toRad(SHOULDER_CLEARANCE.elevationThreshold)) > 1e-9) issues.push('shoulderClearanceRotation is not ~0 at the threshold elevation');
    }

    return { ok: issues.length === 0, issueCount: issues.length, issues };
  }

  GK.ref = {
    SOURCES,
    CERVICAL_LEVELS, THORACIC_LEVELS, LUMBAR_LEVELS, LUMBAR_FLEX_SHARE,
    SHOULDER, SCAPULOHUMERAL_RATIO, SCAPULA_SETTING_PHASE, SHOULDER_CLEARANCE,
    ELBOW, CARRYING_ANGLE, CARRYING_ANGLE_CLOSE_BY, FOREARM_ROM,
    HIP, KNEE, SCREW_HOME, ANKLE, SUBTALAR,
    ROM_ENVELOPE,
    romFor, scapulohumeralSplit, shoulderClearanceRotation, carryingAngle, screwHomeRotation,
    selfCheck
  };
})(window.GK = window.GK || {});
