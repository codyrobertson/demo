/* ============================================================================
   GRAPHITE FIGURE — src/00-bodyparts3d.js
   BodyParts3D/Anatomography (see tools/fit-bodyparts3d.js and
   data/bodyparts3d.json), resolved into the things this project wants from
   an anatomical mesh ATLAS rather than a kinematic MODEL: find a structure
   by name, look up its catalogue id, get its bounding box/volume summary,
   and walk from a composite organ (e.g. "skeletal system") down to the
   actual meshed structures that make it up.

   WHAT THIS IS NOT. Every other 00-*.js in this project (00-anthro,
   00-osim, 00-mobl-arms) resolves toward POSED, SCALED geometry -- a joint
   centre, a muscle path, something a figure of a given size can be built
   from. This file does not, because data/bodyparts3d.json does not carry
   the triangles themselves (see that file's own header for why: 1.3GB of
   source, catalogued rather than shipped) -- what is here is bounding
   boxes and volumes of ONE reference individual's segmented structures, a
   reference atlas to check a build against or to browse by name, not a
   thing to scale a figure onto the way scalePoint() in the other two files
   does. There is deliberately no scaleFactors()/scalePoint() pair here.

   AXES. data/bodyparts3d.json's own meta.axes applies unchanged: (x, y, z)
   exactly as BodyParts3D's STL files store it, millimetres, third
   component superior. This is a THIRD convention in this project, after
   OpenSim's Y-up (00-osim.js, 00-mobl-arms.js) and graphite's own world
   frame (+X superior) -- not reconciled here, same discipline as those
   two files: report what the source says, let whoever actually places
   this against a solved skeleton do that rotation once, deliberately. */
'use strict';
(function (GK) {
  let MODEL = null;
  function useModel(json) { MODEL = json; return MODEL; }
  function need() {
    if (!MODEL) throw new Error('bp3d: call useModel(json) first');
    return MODEL;
  }

  /** English name for a catalogue id (e.g. 'FMA7163' -> 'skin'), or null if the id is not in the catalogue at all */
  function name(id) {
    const n = need().catalog[id];
    return n === undefined ? null : n;
  }

  /** every catalogue entry {id, name, hasMesh} whose name contains `q`, case-insensitively -- the way to go from "I want the deltoid" to an id */
  function search(q) {
    const needle = q.toLowerCase();
    return need().parts.filter((p) => p.name.toLowerCase().includes(needle))
      .map((p) => ({ id: p.id, name: p.name, hasMesh: p.hasMesh }));
  }

  /** the geometry summary for one meshed structure (triangles, boundingBoxMm, vertexMeanMm, enclosedVolumeMm3), or null if `id` has no mesh of its own (see hasMesh in the catalogue, and atomicPartsOf() below for composites) */
  function mesh(id) {
    const m = need().meshes[id];
    return m || null;
  }

  /** direct children of `id` in BodyParts3D's own "conventional" navigation tree (data/bodyparts3d.json's hierarchy[]) -- e.g. children('FMA23881') (skeletal system) includes individual bones and bone groups. Not recursive; compose it yourself if you need the whole subtree. */
  function children(id) {
    return need().hierarchy.filter((h) => h.id === id).map((h) => ({ id: h.partId, name: name(h.partId) }));
  }

  /**
   * Every ACTUAL MESH that makes up `id`: if `id` itself has a mesh,
   * that is the whole answer ([id]); otherwise `id` is a composite (e.g.
   * "intervertebral disk") and this recurses through compositeOf until it
   * bottoms out at meshed (atomic) ids, in source order, each id appearing
   * once. Cycle-guarded (visited set) even though nothing in the release
   * notes claims the composite table is acyclic -- a data fact this project
   * has not independently verified is not a fact this function trusts.
   */
  function atomicPartsOf(id) {
    const out = [];
    const seen = new Set();
    (function walk(x) {
      if (seen.has(x)) return;
      seen.add(x);
      if (need().meshes[x]) { out.push(x); return; }
      const comp = need().compositeOf[x];
      if (!comp) return; // neither meshed nor composite: a catalogue entry with no known geometry at all
      for (const p of comp.primitives) walk(p);
    })(id);
    return out;
  }

  GK.bp3d = {
    useModel, name, search, mesh, children, atomicPartsOf,
    get model() { return MODEL; },
  };
})(window.GK = window.GK || {});
