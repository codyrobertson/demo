/* Every module, in the one order that works, with every dataset handed to
   the accessor that reads it.

   WHY THIS IS A FILE. Load order is not a preference here. Each module is an
   IIFE that captures the namespaces below it AT DEFINITION TIME, so 20-rig.js
   reaching for GK.anatomy before 10-anatomy.js has run leaves it holding
   undefined — and the failure surfaces much later, inside solve(), as a
   missing constant with nothing in the stack to say why. That order was
   copied into five tools, which then drifted: three of them knew about the
   muscle layer and two did not, so the same figure came out with muscles in
   one tool and without in another, and nothing said so.

   Optional by design: a module that is not on disk yet is skipped rather
   than fatal, because the layers are built in sequence and a tool that
   cannot run until every layer exists is a tool nobody can use while
   building one. GK.muscle absent means the field asks for a muscle layer,
   gets nothing, and reports that it is drawing skeleton plus soft tissue.
   Every consumer of an optional module has to tolerate its absence, and the
   summary this returns is how a tool tells the reader which ones it got. */
'use strict';
const path = require('path');
const HAND = '/home/user/demo/graphite-kinematics';
const HERE = path.join(__dirname, '..');

// The hand project, whose depth field, graphite and traced silhouette this
// one borrows wholesale. `render` pulls in pencil and features, so a tool
// that only wants geometry can stop at 30-pose.
const HAND_CORE = ['00-math', '10-anatomy', '20-rig', '30-pose'];
const HAND_DRAW = ['40-pencil', '50-features', '55-dorsal', '60-render'];

// The figure, bottom up: reference data, then the anthropometric kernel,
// then the skeleton, then what hangs on it.
const FIGURE = [
  '00-refdata',       // joint range of motion
  '00-anthro',        // the ANSUR fit: measurements, landmarks, segments
  '00-osim',          // Rajagopal, for cross-checking joint centres
  '00-mobl-arms',     // Holzbaur upper extremity: muscle paths and wrapping
  '00-bodyparts3d',   // measured anatomy: per-structure volume and extent
  '00-staple-tlem2',  // TLEM2 bone geometry, via msk-STAPLE (CC BY-NC)
  '00-myosuite-legs', // MyoLegs: 80 lower-limb muscles, Apache 2.0
  '05-trace',         // traced silhouettes
  '10-skeleton',      // bones, frames, the two-pass solve
  '30-limits',        // joint limits and their couplings
  '20-build',         // a figure from a seed
  '40-surface',       // superelliptic sections, still the section solver
  '45-muscle',        // the muscle layer, when it exists
  '50-field',         // the layered field and the skin over it
  '51-head',          // the head's volumes
  '52-torso',         // the trunk's surface anatomy
  '53-limbs',         // joint forms and extremities
  '60-draw',          // the inside of the outline: tone and landmark creases
];

// Datasets, and which accessor takes each. A dataset whose accessor did not
// load is skipped in silence; a dataset MISSING under an accessor that did
// load is worth knowing about, so it is reported.
const DATA = [
  ['anthro', 'ansur-model.json'],
  ['osim', 'rajagopal.json'],
  ['mobl', 'mobl-arms.json'],
  ['bp3d', 'bodyparts3d.json'],
  ['stapleTlem2', 'staple-tlem2.json'],
  ['myosuiteLegs', 'myosuite-legs.json'],
];

function tryRequire(p, name) {
  try { require(p); return true; } catch (e) {
    // only swallow "this file does not exist"; a syntax error inside a
    // module that IS there must not be reported as an absent layer
    if (e.code === 'MODULE_NOT_FOUND' && e.message.indexOf(name) >= 0) return false;
    throw e;
  }
}

/**
 * @param {object} opt  draw: also load the pencil and renderer (default true)
 * @returns {object} GK, with `GK._loaded` listing what was found and missed
 */
module.exports = function load(opt) {
  opt = opt || {};
  if (!global.window) global.window = {};
  const got = [], missed = [];
  const hand = HAND_CORE.concat(opt.draw === false ? [] : HAND_DRAW);
  for (const f of hand) require(path.join(HAND, 'src', f + '.js'));
  for (const f of FIGURE) {
    (tryRequire(path.join(HERE, 'src', f + '.js'), f) ? got : missed).push(f);
  }
  const GK = global.window.GK;
  for (const [ns, file] of DATA) {
    if (!GK[ns] || !GK[ns].useModel) continue;
    try { GK[ns].useModel(require(path.join(HERE, 'data', file))); } catch (e) { missed.push(file); }
  }
  GK._loaded = { got, missed, muscle: !!GK.muscle };
  return GK;
};
