/* ============================================================================
   GRAPHITE FIGURE — src/00-myosuite-legs.js
   MyoSuite's MyoLegs MuJoCo model (see tools/fit-myosuite-legs.js and
   data/myosuite-legs.json), resolved into the things this project wants:
   which bodies a muscle crosses, its wrap surfaces, its architecture
   parameters, and joint centres/segment lengths — the same shape of
   question src/00-osim.js and src/00-mobl-arms.js answer for their own
   sources.

   WHY THIS EXISTS — A THIRD, INDEPENDENT LOWER-LIMB MUSCLE SOURCE.
   data/rajagopal.json is one imaged subject's OpenSim geometry. TLEM2's own
   AnyScript muscle geometry (tools/fit-tlem.js) could be read but not
   shipped here — see that file's header for the licensing reasoning.
   data/myosuite-legs.json is this project's actual SHIPPABLE fallback for
   lower-limb muscle paths: an 80-muscle bilateral MuJoCo model (Apache
   2.0), independently re-derived/calibrated rather than a cadaver
   measurement — its femur segment length (404.4mm) landing close to
   Rajagopal's own (408.05mm) is evidence the two are related (see
   tools/fit-myosuite-legs.js's VERIFICATION), not proof they are
   interchangeable for anything load-bearing.

   WHAT "MUSCLE-MODEL PARAMETERS" MEANS HERE — READ BEFORE COMPARING
   AGAINST data/rajagopal.json/data/mobl-arms.json. This source has NO
   pennation angle at all (a fact, not an omission — see
   data/myosuite-legs.json's own meta.pennationAngle). Its "optimal fibre
   length" is DERIVED by this project via a formula taken from MyoSuite's
   own shipped reflex controller, not authored directly in the source, and
   is null (not a guessed number) for 16 of the 80 muscles where that
   formula produces a geometrically-impossible negative value — see
   meta.fiberLengthNotComputable for exactly which, and why that is a
   property of the source data, not a bug in this extraction.

   AXES. Every position here is in the SOURCE MODEL's own convention: +X
   anterior, +Y proximal/superior (both empirically confirmed — see
   data/myosuite-legs.json's own meta.axes), medio-lateral sign not
   independently confirmed. Positions on `path[]` entries are in the
   attached BODY's own local MuJoCo frame (a body's children/sites/joints
   are all expressed relative to that body's own origin) — not graphite's
   world frame, not a solved bone frame. No remapping applied here, same
   discipline as src/00-osim.js and src/00-mobl-arms.js. */
'use strict';
(function (GK) {
  let MODEL = null;
  function useModel(json) { MODEL = json; return MODEL; }
  function need() {
    if (!MODEL) throw new Error('myosuiteLegs: call useModel(json) first');
    return MODEL;
  }

  /** every muscle at least one of whose path steps (site or wrap geom) is fixed to the named body */
  function musclesOn(bodyName) {
    return need().muscles.filter((m) => m.path.some((p) => p.body === bodyName) || m.originBody === bodyName || m.insertionBody === bodyName);
  }

  /** one muscle's full record by name (e.g. 'glmax1_r'), or null */
  function muscle(name) {
    return need().muscles.find((m) => m.name === name) || null;
  }

  /** the body chain entry for a named body (e.g. 'femur_r'): {name, parentBody, posMm, quat} -- posMm is that body's origin in its PARENT's own frame, or null if not found */
  function body(name) {
    return need().bodies.find((b) => b.name === name) || null;
  }

  /** a named joint's full record (name, body, type, axis, posMm, rangeRad), or null */
  function joint(name) {
    return need().joints.find((j) => j.name === name) || null;
  }

  GK.myosuiteLegs = {
    useModel, musclesOn, muscle, body, joint,
    get model() { return MODEL; },
  };
})(window.GK = window.GK || {});
