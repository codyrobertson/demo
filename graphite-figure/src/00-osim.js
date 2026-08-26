/* ============================================================================
   GRAPHITE FIGURE — src/00-osim.js
   The Rajagopal et al. (2016) OpenSim model (see tools/fit-osim.js and
   data/rajagopal.json), resolved into the handful of things this project
   actually wants from it: where a joint centre sits, which muscles cross a
   given body, and how to move either onto a figure of a different size.

   WHY THIS EXISTS. src/00-anthro.js samples a body from ANSUR II, which
   measures palpable landmarks and cannot measure a joint centre — a
   trochanterion is skin, a hip joint centre is bone, wrapped in muscle,
   under more skin. That file marks every such number EST and names the
   regression it came from. This module is the alternative to a regression:
   a joint centre measured, on an actual person, by the imaging Rajagopal's
   model was built and validated against. It does not replace the EST
   constants itself — src/00-anthro.js is not touched here — it just makes
   the real number reachable so that replacement can happen deliberately.

   AXES. Every vector handed back by jointCenter() and every path point on a
   muscle returned by musclesOn() is in the SOURCE MODEL's own convention, as
   read directly out of the file: +X anterior, +Y superior, +Z the subject's
   right, expressed in the relevant BODY's own local frame — not graphite's
   world frame (+X superior, +Y left, +Z anterior) and not a solved bone's
   own frame (+X proximal-to-distal, which does not exist until src/10-skeleton.js
   has actually solved a pose). See tools/fit-osim.js's header for why that
   remap is deliberately not done here: it is one fixed permutation into
   graphite's world frame, but there is no single fixed permutation into a
   per-bone frame that is itself the output of a forward solve, so folding it
   in here would either be wrong for the bone case or silently only half done.
   Whoever wires a joint centre onto a solved bone does that rotation once,
   at the point where both frames actually exist.

   SCALING. Rajagopal's model is ONE subject. Every path point, wrap surface
   and joint centre in it is relative to THAT subject's own segment lengths,
   which is exactly the fact scaleFactors()/scalePoint() exist to handle: a
   point is scaled by the ratio of the FIGURE's segment length to the MODEL's
   own, in the frame of whichever body it is expressed in — never by a
   single whole-body ratio, because a figure can be long in the femur and
   short in the forearm at the same time (that is the entire point of
   sampling from ANSUR's covariance rather than its marginals; see
   src/00-anthro.js). The assumption this makes, and the thing it does NOT
   do:
     - ASSUMES uniform scaling per segment: every point on a given bone is
       stretched by the same factor along every axis, as if that one bone
       were a rigid photograph scaled up or down. A real femur that is 10%
       longer is not uniformly 10% thicker in every direction, and a wrap
       cylinder's radius scaled this way is a reasonable first guess, not a
       measurement.
     - Does NOT correct for Rajagopal's subject being one specific person.
       A muscle insertion a few millimetres medial of "typical" on that one
       subject stays exactly that many scaled millimetres medial on every
       figure this produces. Scaling moves the model's geometry onto a body
       of a different SIZE; it cannot move it onto a body of different SHAPE.
     - Falls back to a single whole-figure ratio (standing pelvis height,
       the only whole-figure number both this model and src/00-anthro.js's
       root placement actually share) for every body this model has that
       graphite's ANSUR breakdown does not carry a matching segment for:
       pelvis, torso, hand, patella, talus, calcn, toes. That fallback is
       coarser than the per-segment ratios on purpose-built bones, not a
       hidden extra assumption — it is what "no matching measurement" means.
   ========================================================================== */
'use strict';
(function (GK) {
  let MODEL = null;
  /** the extraction produced by tools/fit-osim.js; injected rather than required so this file stays environment-free */
  function useModel(json) { MODEL = json; return MODEL; }
  function need() {
    if (!MODEL) throw new Error('osim: call useModel(json) first');
    return MODEL;
  }

  /**
   * The joint centre for a named joint (e.g. 'hip_r'), in its PARENT body's
   * own local frame, in millimetres — this is the number src/00-anthro.js's
   * EST hip/shoulder offsets are standing in for today. `body` says which
   * body's frame `location` is expressed in, because a point without a
   * named frame to go with it is not placed anywhere.
   */
  function jointCenter(name) {
    const j = need().joints.find((x) => x.name === name);
    if (!j) throw new Error('osim: no joint named "' + name + '"');
    return { body: j.parentBody, location: j.locationInParentMm.slice(), orientation: j.orientationInParentRad.slice() };
  }

  /** every muscle at least one of whose path points is fixed to the named body, full records (path, forces, wraps) and all */
  function musclesOn(bodyName) {
    return need().muscles.filter((m) => m.path.some((p) => p.body === bodyName));
  }

  // Which of graphite's ANSUR-derived segments (src/00-anthro.js's `seg`
  // object) governs the scale of each OpenSim body. Bodies not listed here
  // fall back to the whole-figure ratio in scaleFactors() -- see the header.
  const SEGMENT_OF_BODY = {
    femur_r: 'femur', femur_l: 'femur',
    tibia_r: 'tibia', tibia_l: 'tibia',
    humerus_r: 'humerus', humerus_l: 'humerus',
    // graphite's skeleton carries one rigid forearm bone (src/10-skeleton.js),
    // not a separate radius and ulna, so both map onto the one segment the figure was measured for
    ulna_r: 'forearm', ulna_l: 'forearm', radius_r: 'forearm', radius_l: 'forearm',
  };

  /**
   * factors[segment] = figureSeg[segment] / model.segmentLengthsMm[segment],
   * for every segment both sides actually have a length for, plus a
   * `fallback` ratio (figureRootHeightMm / model's own pelvisHeight, or 1 if
   * figureRootHeightMm is omitted) for every body SEGMENT_OF_BODY does not cover.
   * figureSeg is exactly what GK.anthro.segments(m) returns.
   */
  function scaleFactors(figureSeg, figureRootHeightMm) {
    const base = need().segmentLengthsMm;
    const factors = {};
    for (const key of ['femur', 'tibia', 'humerus', 'forearm']) {
      factors[key] = figureSeg[key] / base[key];
    }
    factors.fallback = figureRootHeightMm ? figureRootHeightMm / base.pelvisHeight : 1;
    return factors;
  }

  /** rescale a raw model-frame point (mm) for the body it belongs to, using the factors scaleFactors() produced; still in mm, still in that body's own frame */
  function scalePoint(point, bodyName, factors) {
    const key = SEGMENT_OF_BODY[bodyName];
    const k = key ? factors[key] : factors.fallback;
    return [point[0] * k, point[1] * k, point[2] * k];
  }

  GK.osim = {
    useModel, jointCenter, musclesOn, scaleFactors, scalePoint,
    segmentOfBody: SEGMENT_OF_BODY,
    get model() { return MODEL; },
  };
})(window.GK = window.GK || {});
