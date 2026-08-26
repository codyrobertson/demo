/* ============================================================================
   GRAPHITE FIGURE — src/00-staple-tlem2.js
   The 5 TLEM2 bone meshes bundled with the msk-STAPLE toolbox (see
   tools/fit-staple-tlem2.js and data/staple-tlem2.json), resolved the same
   way src/00-bodyparts3d.js resolves BodyParts3D: a bounding-box/volume
   ATLAS to look up or sanity-check against, not a scaled kinematic model.

   WHAT THIS IS NOT — same disclaimer as src/00-bodyparts3d.js, for the same
   reason: data/staple-tlem2.json does not carry the meshes' actual
   triangles (see that file's own header — 11MB of source STL, catalogued
   rather than shipped), so there is no scaleFactors()/scalePoint() pair
   here. What IS here: 5 named bones, each with a bounding box, a crude
   vertex-mean point, and an approximate enclosed volume.

   WHY THIS EXISTS ALONGSIDE src/00-bodyparts3d.js. BodyParts3D is ONE
   whole-body reference individual, 934 structures, muscle+bone+organ
   alike. This is a DIFFERENT, much smaller individual: just 5 lower-limb
   bones (femur_r, tibia_r, pelvis, talus_r, foot_r) from the TLEM2 cadaver
   — the SAME specimen tools/fit-tlem.js reads AnyScript muscle/joint
   parameters from (see that file's header for why THAT extraction was not
   shipped as data/tlem.json — a licensing decision, not a data-quality
   one). Having this bone geometry reachable lets a caller sanity-check a
   TLEM2-derived joint centre or segment length against the actual bone
   surface it should sit inside, independently of BodyParts3D's different
   reference individual.

   LICENSE — Creative Commons Attribution-NonCommercial 4.0 International.
   See data/staple-tlem2.json's own meta.license (written by
   tools/fit-staple-tlem2.js) for the verbatim terms and the required
   citations. Any commercial use of this data requires contacting the
   STAPLE authors first — this module does not enforce that, it is a
   fact about the data it resolves, repeated here so it is not missed.

   AXES. data/staple-tlem2.json's own meta.axes applies unchanged, and it
   is a PARTIAL verification, not a full one — read it before trusting a
   sign. In short: Y is the dominant (proximal-distal-like) axis for
   femur_r/tibia_r, Z is dominant (medio-lateral-like) for pelvis, matching
   the general convention family of data/rajagopal.json and
   tools/fit-tlem.js — but WHICH END of each axis is anatomically positive
   was not independently confirmed for this specific mesh set (unlike
   BodyParts3D's skin-height check or TLEM2's own metatarsal check), and
   whether all 5 meshes share one common frame is assumed, not tested. */
'use strict';
(function (GK) {
  let MODEL = null;
  function useModel(json) { MODEL = json; return MODEL; }
  function need() {
    if (!MODEL) throw new Error('staple: call useModel(json) first');
    return MODEL;
  }

  /** the geometry summary for one bone (e.g. 'femur_r'): {name, side, triangles, boundingBoxMm, vertexMeanMm, enclosedVolumeMm3}, or null if not present */
  function bone(id) {
    const b = need().bones[id];
    return b || null;
  }

  /** every bone id this file has ({id, name, side}), in source order */
  function list() {
    const bones = need().bones;
    return Object.keys(bones).map((id) => ({ id, name: bones[id].name, side: bones[id].side }));
  }

  GK.stapleTlem2 = {
    useModel, bone, list,
    get model() { return MODEL; },
  };
})(window.GK = window.GK || {});
