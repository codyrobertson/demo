/* ============================================================================
   GRAPHITE FIGURE — src/00-mobl-arms.js
   The Holzbaur/MoBL-ARMS upper-extremity OpenSim model (see
   tools/fit-mobl-arms.js and data/mobl-arms.json), resolved into the things
   this project actually wants from it: where a shoulder/elbow/wrist joint
   centre sits, which of its 50 muscles and 4 ligaments cross a given body,
   how a slaved coordinate's value follows the one that actually drives it,
   and how to rescale any of that onto a figure of a different size.

   WHY THIS EXISTS. src/00-osim.js makes Rajagopal's LOWER-body geometry
   reachable, precisely because that file has zero upper-body muscles above
   the waist -- everything from the sternum up is a CoordinateActuator, a
   number with no path, no fibre length, no attachment site. This module is
   the same move for the arm: a deltoid, a pectoralis, a biceps, all with
   real path points measured (Holzbaur 2005) rather than assumed. It does not
   touch src/00-anthro.js or src/00-osim.js -- it just makes this second,
   independent measured source reachable the same way the first one is.

   AXES. Same convention and same caveat as src/00-osim.js: every vector
   handed back here is in the SOURCE MODEL's own per-body local frame, not
   remapped into graphite's world frame or a solved bone's own frame. See
   data/mobl-arms.json's meta.axes (written by tools/fit-mobl-arms.js) for
   exactly what was and was not independently verified about which way is
   anterior/superior/lateral in this specific file.

   SLAVED COORDINATES -- READ THIS BEFORE POSING THIS ARM. Only 7 of this
   model's 20 coordinates are independently drivable (elv_angle, shoulder_elv,
   shoulder_rot, elbow_flexion, pro_sup, deviation, flexion). The other 13
   describe the scapula/clavicle's own motion and are ALGEBRAIC FUNCTIONS of
   one of those 7, via a CoordinateCouplerConstraint -- OpenSim's standard
   stand-in for true scapulothoracic contact. slavedValue() below evaluates
   that function so a caller never has to set sternoclavicular_r2 by hand (or
   worse, leave it at zero, which is not where a raised arm's clavicle sits).
   It does this by PIECEWISE-LINEAR interpolation through the same
   SimmSpline breakpoints OpenSim itself fits a smooth curve through -- a
   deliberately honest approximation, not a re-implementation of OpenSim's
   actual spline math, and said so rather than left to look exact. Every
   constraint in this file has exactly one independent coordinate (checked
   at fit time, see tools/fit-mobl-arms.js's VERIFICATION), so slavedValue()
   takes a single number; it throws rather than silently mis-evaluating if
   that ever stops being true. */
'use strict';
(function (GK) {
  let MODEL = null;
  function useModel(json) { MODEL = json; return MODEL; }
  function need() {
    if (!MODEL) throw new Error('mobl: call useModel(json) first');
    return MODEL;
  }

  /** the joint centre for a named joint (e.g. 'elbow'), in its PARENT body's own local frame, millimetres */
  function jointCenter(name) {
    const j = need().joints.find((x) => x.name === name);
    if (!j) throw new Error('mobl: no joint named "' + name + '"');
    return { body: j.parentBody, location: j.locationInParentMm.slice(), orientation: j.orientationInParentRad.slice() };
  }

  /** every muscle at least one of whose path points is fixed to the named body */
  function musclesOn(bodyName) {
    return need().muscles.filter((m) => m.path.some((p) => p.body === bodyName));
  }

  /** every ligament at least one of whose path points is fixed to the named body */
  function ligamentsOn(bodyName) {
    return need().ligaments.filter((l) => l.path.some((p) => p.body === bodyName));
  }

  /** names of the 7 coordinates this model actually drives dynamically -- everything else is slaved, see header */
  function independentCoordinateNames() {
    const dependent = new Set(need().constraints.map((c) => c.dependentCoordinate));
    const all = new Set();
    for (const j of need().joints) for (const c of j.coordinates) all.add(c.name);
    return [...all].filter((n) => !dependent.has(n)).sort();
  }

  function constraintFor(dependentName) {
    const c = need().constraints.find((x) => x.dependentCoordinate === dependentName);
    return c || null;
  }

  /** true if `name` is a coordinate whose value is dictated by a CoordinateCouplerConstraint rather than set directly */
  function isSlaved(name) {
    return constraintFor(name) !== null;
  }

  /**
   * The value a slaved coordinate takes when its one independent coordinate
   * is at `value` (radians) -- piecewise-linear through the source
   * SimmSpline's own breakpoints. See header: an approximation of OpenSim's
   * actual (smoother) spline, not a copy of it. Throws for a name that is
   * not slaved, or a slave whose constraint has other than one independent
   * coordinate (not present in this model today -- see tools/fit-mobl-arms.js).
   */
  function slavedValue(dependentName, value) {
    const c = constraintFor(dependentName);
    if (!c) throw new Error('mobl: "' + dependentName + '" is not a slaved coordinate (see independentCoordinateNames())');
    if (c.independentCoordinates.length !== 1) throw new Error('mobl: constraint "' + c.name + '" has ' + c.independentCoordinates.length + ' independent coordinates, slavedValue() only handles exactly one');
    const xs = c.x, ys = c.y;
    if (value <= xs[0]) return ys[0] + (value - xs[0]) * ((ys[1] - ys[0]) / (xs[1] - xs[0])); // linear extrapolation off the first segment
    if (value >= xs[xs.length - 1]) {
      const n = xs.length;
      return ys[n - 1] + (value - xs[n - 1]) * ((ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2])); // off the last segment
    }
    for (let i = 0; i < xs.length - 1; i++) {
      if (value >= xs[i] && value <= xs[i + 1]) {
        const t = (value - xs[i]) / (xs[i + 1] - xs[i]);
        return ys[i] + t * (ys[i + 1] - ys[i]);
      }
    }
    throw new Error('mobl: slavedValue(' + dependentName + ', ' + value + ') fell through -- non-monotonic breakpoints?');
  }

  // Which of graphite's ANSUR-derived segments (src/00-anthro.js's `seg`
  // object) governs the scale of each MoBL-ARMS body. Mirrors
  // src/00-osim.js's SEGMENT_OF_BODY exactly in spirit: bodies not listed
  // here fall back to the whole-figure ratio in scaleFactors() below.
  const SEGMENT_OF_BODY = {
    humerus: 'humerus',
    // graphite's skeleton carries one rigid forearm bone (src/10-skeleton.js),
    // not a separate radius and ulna, so both map onto the one segment measured for the figure
    ulna: 'forearm', radius: 'forearm',
  };

  /**
   * factors[segment] = figureSeg[segment] / model.segmentLengthsMm[segment],
   * for 'humerus' and 'forearm', plus a `fallback` ratio
   * (figureSeg.clavicle / model's own segmentLengthsMm.clavicle, or 1 if
   * figureSeg carries no clavicle) for every body SEGMENT_OF_BODY does not
   * cover (clavicle, scapula, hand, proximal_row and the phantom bodies).
   * figureSeg is exactly what GK.anthro.segments(m) returns -- which
   * already carries a (EST) clavicle length, so unlike src/00-osim.js's
   * version of this function there is no second whole-figure-height
   * argument here: a hip- or stature-scale number has nothing correctly
   * comparable to scale THIS model's segments against (it is an isolated,
   * torso-fixed arm with no pelvis and no standing height of its own), so
   * rather than accept one and produce a wrong-order-of-magnitude ratio,
   * the fallback anchors on the one comparable, same-order-of-magnitude
   * quantity both sources actually have: a clavicle length.
   */
  function scaleFactors(figureSeg) {
    const base = need().segmentLengthsMm;
    const factors = {};
    for (const key of ['humerus', 'forearm']) {
      factors[key] = figureSeg[key] / base[key];
    }
    factors.fallback = figureSeg.clavicle ? figureSeg.clavicle / base.clavicle : 1;
    return factors;
  }

  /** rescale a raw model-frame point (mm) for the body it belongs to, using the factors scaleFactors() produced; still in mm, still in that body's own frame */
  function scalePoint(point, bodyName, factors) {
    const key = SEGMENT_OF_BODY[bodyName];
    const k = key ? factors[key] : factors.fallback;
    return [point[0] * k, point[1] * k, point[2] * k];
  }

  GK.mobl = {
    useModel, jointCenter, musclesOn, ligamentsOn,
    independentCoordinateNames, isSlaved, slavedValue,
    scaleFactors, scalePoint, segmentOfBody: SEGMENT_OF_BODY,
    get model() { return MODEL; },
  };
})(window.GK = window.GK || {});
