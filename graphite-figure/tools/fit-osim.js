/* Parse the Rajagopal et al. (2016) OpenSim full-body model into the compact
   data module the figure project ships.
   Usage: node tools/fit-osim.js [path-to-Rajagopal2016.osim] [out.json]
   Defaults: data/Rajagopal2016.osim -> data/rajagopal.json

   WHY THIS MODEL, AT ALL. src/00-anthro.js samples a body from ANSUR II,
   which measures palpable landmarks to sub-millimetre precision on 6,068
   people and cannot measure a single joint CENTRE, because a joint centre is
   inside the body. Every one of those is currently a regression marked EST
   in that file. Rajagopal et al. built and validated a musculoskeletal model
   against imaging and gait data for exactly this reason, and it ships as an
   .osim — an XML description of bodies, joints and muscle geometry fitted to
   one real, dissected/imaged subject. This script turns that XML into JSON;
   it does not turn it into millimetres of somebody's memory of a paper's
   tables. Everything below is read out of the file, not reconstructed.

   To regenerate:
     curl -sSLO 'https://raw.githubusercontent.com/opensim-org/opensim-models/master/Models/Rajagopal/Rajagopal2016.osim'
     mv Rajagopal2016.osim data/
     node tools/fit-osim.js
   The authoritative source is SimTK project 9106 (https://simtk.org/projects/full_body);
   the opensim-org/opensim-models mirror above is OpenSim's own reference copy
   and is what this was actually fetched from and fit against — commit
   d9b05d470b1a481c222372c85b75772faf8f7792 (2025-11-05), verified byte-identical
   between `git clone` and the raw URL above at extraction time. That repo's own
   README says the only changes from the original publication are the XML
   container being upgraded to OpenSim 4.5's format and one muscle-DYNAMICS
   property (fiber_damping) being set to match a later paper's recommendation —
   neither touches a body, a joint centre, a path point or a wrap surface, which
   is everything this script reads. If master ever moves the file, re-pin the
   commit above rather than trusting a re-fetch silently.

   WHY A HAND-WRITTEN PARSER. .osim is plain, machine-generated XML with no
   namespaces, no CDATA and no entities (verified against this file before
   writing this). A ~150-line recursive-descent parser handles all of it and
   keeps this project at zero npm dependencies, same as tools/fit-ansur.js.

   UNITS — converted ONCE, HERE, and nowhere else in this project. The .osim
   is in metres (length_units=meters, confirmed from the file itself); the
   figure project is in millimetres throughout (see src/00-anthro.js). Every
   length-bearing number below — positions, path points, wrap-surface
   dimensions, fibre/tendon lengths, the translational pelvis coordinates —
   is multiplied by the one MM constant defined below, and every such site
   multiplies by that same constant rather than a locally-retyped 1000, so a
   unit bug would be a one-line fix instead of a grep-and-pray; angles stay
   in radians (the project's own convention, per src/00-refdata.js); mass
   stays in kg; inertia is scaled by MM^2 to kg*mm^2 so it stays
   dimensionally consistent with a file that is otherwise all millimetres
   (multiply back by 1e-6 for the SI kg*m^2 the biomechanics literature quotes).

   AXES — documented here, NOT remapped. Every position in this file is
   expressed in ITS OWN BODY's local frame, and empirically (gravity is
   (0,-9.80665,0), and the right hip joint centre sits at +Z / left at -Z
   from the pelvis origin, mirrored) that frame is +X anterior, +Y superior,
   +Z the subject's right — the standard OpenSim gait-model convention. That
   is a DIFFERENT convention from both of graphite-figure's: the world frame
   in src/00-anthro.js (+X superior, +Y the figure's own left, +Z anterior)
   and the per-bone frame in src/10-skeleton.js (+X proximal-to-distal along
   THAT bone, which varies per bone and is defined by a forward solve, not by
   a fixed rotation). Relabelling OpenSim's axes into graphite's world frame
   is one fixed permutation; relabelling into graphite's per-bone frame is
   not, because that frame doesn't exist until the skeleton is solved. So the
   permutation is not applied here — src/00-osim.js hands back exactly what
   is in the file (in mm), and whoever wires a joint centre onto a solved
   bone frame does that rotation deliberately, once, at the point where both
   frames actually exist, rather than having it happen silently in a data file.

   SEGMENT LENGTHS — computed by subtracting two points that are ALREADY in
   the same body's local frame (a joint's location_in_child, which is that
   body's own proximal joint centre, and the next joint's location_in_parent,
   which is that same body's distal joint centre, both authored directly in
   that body's axes) — never by composing frames across a chain of bodies.
   Composing the fixed PhysicalOffsetFrame orientations correctly (most
   joints carry a few degrees of one, e.g. tibial torsion) needs OpenSim's
   exact body-fixed XYZ Euler convention pinned down exactly right, and
   getting that silently wrong would produce a number that looks exactly as
   trustworthy as everything else here and is not. So anything that would
   need it — total standing height, a foot length that runs through the
   calcaneus — is reported as "not computed" rather than guessed.

   MUSCLE REGION (upper/lower body) is decided from which bodies a muscle's
   OWN path points actually touch, not from its name. It happens that every
   Millard2012EquilibriumMuscle name in this file already ends _r/_l and
   reads as a lower-limb muscle, which would make a name-based classifier
   look right for the wrong reason; checking the path itself is the same
   amount of code and is checking the actual fact instead of a naming habit. */
'use strict';
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
//  XML — recursive-descent, just enough of it. Node shape: {tag, attrs, kids, text}.
//  text accumulates only what sits directly between this node's tags, which is
//  exactly what every leaf value in an .osim is (a name, a number, a vector of
//  numbers) — container nodes' `text` is stray whitespace and nothing here reads it.
// ---------------------------------------------------------------------------
function parseXML(src) {
  src = src.replace(/<\?xml[\s\S]*?\?>/, '').replace(/<!--[\s\S]*?-->/g, '');
  let i = 0;
  const n = src.length;
  const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  function skipWs() { while (i < n && isWs(src[i])) i++; }
  function parseAttrs() {
    const attrs = {};
    for (;;) {
      skipWs();
      const c = src[i];
      if (c === '>' || c === '/' || i >= n) break;
      const m = /^[A-Za-z_:][\w:.-]*/.exec(src.slice(i));
      if (!m) break;
      const name = m[0]; i += name.length;
      skipWs();
      if (src[i] !== '=') { attrs[name] = true; continue; }
      i++; skipWs();
      const q = src[i]; i++;
      const end = src.indexOf(q, i);
      attrs[name] = src.slice(i, end);
      i = end + 1;
    }
    return attrs;
  }
  function parseElement() {
    i++; // '<'
    const m = /^[A-Za-z_:][\w:.-]*/.exec(src.slice(i));
    const tag = m[0]; i += tag.length;
    const attrs = parseAttrs();
    skipWs();
    const node = { tag, attrs, kids: [], text: '' };
    if (src[i] === '/') { i += 2; return node; } // self-closing
    i++; // '>'
    for (;;) {
      const lt = src.indexOf('<', i);
      if (lt === -1) throw new Error('unterminated element <' + tag + '>');
      if (lt > i) node.text += src.slice(i, lt);
      i = lt;
      if (src[i + 1] === '/') { i = src.indexOf('>', i) + 1; break; }
      node.kids.push(parseElement());
    }
    return node;
  }
  skipWs();
  return parseElement();
}
const child = (node, tag) => node && node.kids.find((k) => k.tag === tag);
function deep(node, tag, out) {
  out = out || [];
  for (const k of node.kids) { if (k.tag === tag) out.push(k); deep(k, tag, out); }
  return out;
}
const text = (node) => (node ? node.text.trim() : '');
const bool = (node) => text(node) === 'true';
const num = (node) => parseFloat(text(node));
const vec = (node) => { const t = text(node); return t ? t.split(/\s+/).map(Number) : []; };
const attr = (node, name) => node && node.attrs[name];
/** '/ground' -> 'ground'; '/bodyset/pelvis' -> 'pelvis' */
const bodyOf = (socketPath) => { const p = (socketPath || '').split('/').filter(Boolean); return p[p.length - 1] || null; };

const MM = 1000; // the one place metres become millimetres
const r = (x, d) => { const v = Math.round(x * 10 ** d) / 10 ** d; return v === 0 ? 0 : v; }; // clean floating-point noise, not precision the file never had
const vmm = (node, d) => vec(node).map((v) => r(v * MM, d));
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vlen = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);

// ---------------------------------------------------------------------------
//  LOAD
// ---------------------------------------------------------------------------
const osimPath = process.argv[2] || path.join(__dirname, '..', 'data', 'Rajagopal2016.osim');
const outPath = process.argv[3] || path.join(__dirname, '..', 'data', 'rajagopal.json');
if (!fs.existsSync(osimPath)) {
  console.error('no .osim at ' + osimPath + ' -- see the header of this file for the curl command to fetch one');
  process.exit(1);
}
const raw = fs.readFileSync(osimPath, 'utf8');
const doc = parseXML(raw);
const model = child(doc, 'Model');
if (!model || doc.tag !== 'OpenSimDocument') throw new Error(osimPath + ' does not look like an OpenSim model document');
const modelName = attr(model, 'name');
console.log('model: ' + modelName + '  (' + (fs.statSync(osimPath).size / 1024).toFixed(0) + ' kB source)');
console.log('length_units=' + text(child(model, 'length_units')) + '  gravity=' + text(child(model, 'gravity')));

// ---------------------------------------------------------------------------
//  BODIES + WRAP SURFACES
//  Wrap objects are declared inside the Body they are fixed to, not in their
//  own top-level set, so both come out of one pass over BodySet.
// ---------------------------------------------------------------------------
const bodySet = child(model, 'BodySet');
const bodyNodes = deep(bodySet, 'Body');
const bodies = bodyNodes.map((b) => ({
  name: attr(b, 'name'),
  massKg: r(num(child(b, 'mass')), 6),
  massCenterMm: vmm(child(b, 'mass_center'), 3),
  // [Ixx Iyy Izz Ixy Ixz Iyz] about the mass centre; kg*m^2 in the source, scaled
  // by MM^2 alongside every length here so the whole file stays one unit system
  inertiaKgMm2: vec(child(b, 'inertia')).map((v) => r(v * MM * MM, 3)),
}));
const bodyNames = new Set(bodies.map((b) => b.name));
bodyNames.add('ground'); // the implicit world body: never in BodySet, always the tree root

const WRAP_TAGS = ['WrapCylinder', 'WrapEllipsoid', 'WrapSphere', 'WrapTorus'];
const wrapSurfaces = [];
for (const b of bodyNodes) {
  const bname = attr(b, 'name');
  for (const wt of WRAP_TAGS) {
    for (const w of deep(b, wt)) {
      const surf = {
        name: attr(w, 'name'), type: wt, body: bname,
        active: bool(child(w, 'active')),
        quadrant: text(child(w, 'quadrant')) || null,
        // Euler angle, not a length -- stays in radians like everything else angular here
        xyzBodyRotationRad: vec(child(w, 'xyz_body_rotation')),
        translationMm: vmm(child(w, 'translation'), 3),
      };
      if (wt === 'WrapCylinder') {
        surf.radiusMm = r(num(child(w, 'radius')) * MM, 3);
        surf.lengthMm = r(num(child(w, 'length')) * MM, 3);
      } else if (wt === 'WrapSphere') {
        surf.radiusMm = r(num(child(w, 'radius')) * MM, 3);
      } else if (wt === 'WrapEllipsoid') {
        surf.dimensionsMm = vmm(child(w, 'dimensions'), 3);
      } else {
        // not present in Rajagopal2016.osim (verified: every wrap object in this
        // file is a WrapCylinder) -- flagged rather than silently mis-shaped if a
        // future model revision introduces one
        console.warn('WrapTorus "' + surf.name + '": dimension fields not specifically handled, check the model by hand');
      }
      wrapSurfaces.push(surf);
    }
  }
}

// ---------------------------------------------------------------------------
//  JOINTS + KINEMATIC TREE
//  <objects> under JointSet contains nothing but joints, so every direct
//  child is one, generically, whatever OpenSim joint class it is.
// ---------------------------------------------------------------------------
const jointObjs = child(child(model, 'JointSet'), 'objects');
const joints = jointObjs.kids.map((j) => {
  const jname = attr(j, 'name');
  const spf = text(child(j, 'socket_parent_frame'));
  const scf = text(child(j, 'socket_child_frame'));
  const offsetFrames = {};
  for (const f of deep(child(j, 'frames') || j, 'PhysicalOffsetFrame')) {
    offsetFrames[attr(f, 'name')] = {
      body: bodyOf(text(child(f, 'socket_parent'))),
      translationMm: vmm(child(f, 'translation'), 4),
      orientationRad: vec(child(f, 'orientation')),
    };
  }
  const pf = offsetFrames[spf], cf = offsetFrames[scf];
  if (!pf || !cf) throw new Error('joint ' + jname + ': socket_parent_frame/socket_child_frame did not resolve to a PhysicalOffsetFrame');

  // Which coordinates are driven by a *translation* TransformAxis (only
  // ground_pelvis's pelvis_tx/ty/tz, in this model) decides which coordinates
  // are lengths (need the mm conversion) versus angles (stay radians) --
  // read from the file's own SpatialTransform, not assumed from the joint name.
  const st = child(j, 'SpatialTransform');
  const axisNodes = st ? deep(st, 'TransformAxis') : [];
  const translational = new Set();
  for (const ax of axisNodes) {
    if ((attr(ax, 'name') || '').startsWith('translation')) {
      const cn = text(child(ax, 'coordinates'));
      if (cn) translational.add(cn);
    }
  }
  const coordinates = deep(child(j, 'coordinates'), 'Coordinate').map((c) => {
    const cname = attr(c, 'name');
    const isLen = translational.has(cname);
    const scale = isLen ? MM : 1;
    const rng = vec(child(c, 'range'));
    return {
      name: cname, translational: isLen,
      defaultValue: r(num(child(c, 'default_value')) * scale, 4),
      min: r(rng[0] * scale, 4), max: r(rng[1] * scale, 4),
      clamped: bool(child(c, 'clamped')), locked: bool(child(c, 'locked')),
    };
  });
  const spatialTransform = axisNodes.length ? axisNodes.map((ax) => {
    const fn = ax.kids.find((k) => k.tag !== 'coordinates' && k.tag !== 'axis');
    return {
      name: attr(ax, 'name'),
      coordinate: text(child(ax, 'coordinates')) || null, // null = fixed at 0, not driven by any coordinate (e.g. hip's unused translation axes)
      axis: vec(child(ax, 'axis')),
      function: fn ? fn.tag : null,
    };
  }) : undefined;

  return {
    name: jname, type: j.tag,
    parentBody: pf.body, childBody: cf.body,
    locationInParentMm: pf.translationMm, orientationInParentRad: pf.orientationRad,
    locationInChildMm: cf.translationMm, orientationInChildRad: cf.orientationRad,
    coordinates, spatialTransform,
  };
});
const jointByName = {}; for (const j of joints) jointByName[j.name] = j;

// ---------------------------------------------------------------------------
//  MUSCLES + TORQUE ACTUATORS
//  Millard2012EquilibriumMuscle (and, generically, anything else whose tag
//  ends "Muscle") vs CoordinateActuator, in one pass over ForceSet's own
//  <objects> -- which, unlike the top-level defaults block, contains only
//  this model's actual forces.
// ---------------------------------------------------------------------------
const LOWER_BODIES = new Set(['pelvis', 'femur_r', 'femur_l', 'tibia_r', 'tibia_l',
  'patella_r', 'patella_l', 'talus_r', 'talus_l', 'calcn_r', 'calcn_l', 'toes_r', 'toes_l']);
const forceObjs = child(child(model, 'ForceSet'), 'objects');
const muscles = [];
const actuators = [];
let conditionalPts = 0, movingPts = 0;
const muscleClassesSeen = new Set();
for (const f of forceObjs.kids) {
  if (f.tag === 'CoordinateActuator') {
    actuators.push({ name: attr(f, 'name'), coordinate: text(child(f, 'coordinate')), optimalForceN: num(child(f, 'optimal_force')) });
    continue;
  }
  if (!/Muscle$/.test(f.tag)) { console.warn('force "' + attr(f, 'name') + '" has unrecognised type ' + f.tag + ', skipped'); continue; }
  muscleClassesSeen.add(f.tag);
  const mname = attr(f, 'name');
  const gp = child(f, 'GeometryPath');
  const ppObjs = child(child(gp, 'PathPointSet'), 'objects');
  const bodiesTouched = new Set();
  const pathPoints = (ppObjs ? ppObjs.kids : []).map((p) => {
    if (p.tag === 'ConditionalPathPoint') conditionalPts++;
    if (p.tag === 'MovingPathPoint') movingPts++;
    const pbody = bodyOf(text(child(p, 'socket_parent_frame')));
    bodiesTouched.add(pbody);
    const loc = child(p, 'location'); // absent on a MovingPathPoint, which instead has x/y/z_location functions
    return {
      name: attr(p, 'name'), type: p.tag, conditional: p.tag !== 'PathPoint',
      body: pbody,
      locationMm: loc ? vmm(loc, 4) : null,
    };
  });
  const wrapObjs = child(child(gp, 'PathWrapSet'), 'objects');
  const wraps = (wrapObjs ? wrapObjs.kids : []).map((w) => ({
    wrapObject: text(child(w, 'wrap_object')), method: text(child(w, 'method')),
    range: vec(child(w, 'range')), // path-point INDEX range, not a length
  }));
  const side = /_r$/.test(mname) ? 'r' : /_l$/.test(mname) ? 'l' : null;
  muscles.push({
    name: mname, side,
    region: [...bodiesTouched].some((bn) => !LOWER_BODIES.has(bn)) ? 'upper' : 'lower',
    maxIsometricForceN: r(num(child(f, 'max_isometric_force')), 3),
    optimalFiberLengthMm: r(num(child(f, 'optimal_fiber_length')) * MM, 4),
    tendonSlackLengthMm: r(num(child(f, 'tendon_slack_length')) * MM, 4),
    pennationAngleAtOptimalRad: r(num(child(f, 'pennation_angle_at_optimal')), 6),
    path: pathPoints, wraps,
  });
}

// ---------------------------------------------------------------------------
//  SEGMENT LENGTHS — see header. Same-frame subtraction only.
// ---------------------------------------------------------------------------
function segLenSameFrame(proximalJoint, distalJoint) {
  const pj = jointByName[proximalJoint], dj = jointByName[distalJoint];
  if (pj.childBody !== dj.parentBody) throw new Error('segLenSameFrame(' + proximalJoint + ',' + distalJoint + '): not the same body (' + pj.childBody + ' vs ' + dj.parentBody + ')');
  return r(vlen(vsub(dj.locationInParentMm, pj.locationInChildMm)), 2);
}
const segmentLengthsMm = {
  femur: segLenSameFrame('hip_r', 'walker_knee_r'),
  tibia: segLenSameFrame('walker_knee_r', 'ankle_r'),
  humerus: segLenSameFrame('acromial_r', 'elbow_r'),
  forearm: segLenSameFrame('radioulnar_r', 'radius_hand_r'), // radius bone: matches ANSUR's radiale-stylion (radius-based) definition
  // the pair the whole task exists for: what 00-anthro.js's EST regressions guess at
  pelvisWidth: r(vlen(vsub(jointByName.hip_r.locationInParentMm, jointByName.hip_l.locationInParentMm)), 2),
  shoulderWidth: r(vlen(vsub(jointByName.acromial_r.locationInParentMm, jointByName.acromial_l.locationInParentMm)), 2),
  pelvisToShoulder: r(vlen(jointByName.acromial_r.locationInParentMm), 2), // torso's own frame; torso origin = the lumbosacral (back) joint
  pelvisHeight: jointByName.ground_pelvis.coordinates.find((c) => c.name === 'pelvis_ty').defaultValue, // standing height of the pelvis origin above the ground, in this model's own reference pose
};

// ---------------------------------------------------------------------------
//  ASSEMBLE + WRITE
// ---------------------------------------------------------------------------
const osim = {
  meta: {
    modelName,
    source: 'Rajagopal, A., Dembia, C.L., DeMers, M.S., Delp, D.D., Hicks, J.L., Delp, S.L. (2016) Full-body musculoskeletal model for muscle-driven simulation of human gait. IEEE Transactions on Biomedical Engineering. doi:10.1109/TBME.2016.2586891',
    authoritativeSource: 'https://simtk.org/projects/full_body (SimTK project 9106)',
    fetchedFrom: 'https://raw.githubusercontent.com/opensim-org/opensim-models/master/Models/Rajagopal/Rajagopal2016.osim',
    fetchedFromCommit: 'd9b05d470b1a481c222372c85b75772faf8f7792 (2025-11-05)',
    extractedDate: new Date().toISOString().slice(0, 10),
    units: 'lengths and translations in millimetres (source file is metres; multiplied by 1000 once, in tools/fit-osim.js); inertia in kg*mm^2 (source kg*m^2, scaled by 1e6 to match); angles in radians; force in newtons; mass in kilograms',
    axes: "each position is in ITS OWN BODY's local frame as authored in the source file: +X anterior, +Y superior, +Z the subject's right (confirmed here from the file's own gravity vector and from the mirrored sign of the left/right hip joint centres). This is NOT graphite-figure's world frame (+X superior, +Y left, +Z anterior) or its per-bone frame (+X proximal-to-distal); no remapping is applied -- see the AXES section of tools/fit-osim.js's header for why.",
    notCovered: 'no full forward kinematics is computed, so a total standing height and a foot length through the calcaneus are not reported (see SEGMENT LENGTHS in the header); ConstraintSet (2 patella CoordinateCouplerConstraints) is not extracted, out of scope for this pass.',
  },
  bodies,
  joints,
  tree: {
    root: 'ground',
    edges: joints.map((j) => ({ parent: j.parentBody, child: j.childBody, joint: j.name })),
  },
  muscles,
  actuators, // torque-driven coordinates (lumbar spine + everything at/above the shoulder) -- see meta and the report this script prints
  wrapSurfaces,
  segmentLengthsMm,
  counts: {
    bodies: bodies.length,
    joints: joints.length,
    coordinates: joints.reduce((s, j) => s + j.coordinates.length, 0),
    muscles: muscles.length,
    musclesUpperBody: muscles.filter((m) => m.region === 'upper').length,
    pathPoints: muscles.reduce((s, m) => s + m.path.length, 0),
    wrapSurfaces: wrapSurfaces.length,
    actuators: actuators.length,
  },
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(osim));
console.log('-> ' + outPath + '  ' + (fs.statSync(outPath).size / 1024).toFixed(0) + ' kB');

// ---------------------------------------------------------------------------
//  VERIFICATION
// ---------------------------------------------------------------------------
const issues = [];

// exactly one root, every body reachable from it
{
  const childOf = {};
  for (const j of joints) {
    if (childOf[j.childBody]) issues.push('body ' + j.childBody + ' is the child of two joints: ' + childOf[j.childBody] + ' and ' + j.name);
    childOf[j.childBody] = j.name;
  }
  const roots = [...bodyNames].filter((n) => !childOf[n]);
  if (roots.length !== 1) issues.push('expected exactly one root, found ' + roots.length + ': ' + roots.join(','));
  const kidsOf = {};
  for (const j of joints) (kidsOf[j.parentBody] = kidsOf[j.parentBody] || []).push(j.childBody);
  const seen = new Set();
  (function walk(n) { seen.add(n); for (const c of kidsOf[n] || []) if (!seen.has(c)) walk(c); })(roots[0] || 'ground');
  for (const n of bodyNames) if (!seen.has(n)) issues.push('body ' + n + ' is not reachable from the root');
  console.log('kinematic tree: root=' + (roots[0] || '?') + ', ' + seen.size + '/' + bodyNames.size + ' bodies reachable');
}

// every joint's parent and child body exist
for (const j of joints) {
  if (!bodyNames.has(j.parentBody)) issues.push('joint ' + j.name + ': parent body "' + j.parentBody + '" does not exist');
  if (!bodyNames.has(j.childBody)) issues.push('joint ' + j.name + ': child body "' + j.childBody + '" does not exist');
}

// every muscle path point references a body that exists
for (const m of muscles) for (const p of m.path) {
  if (!bodyNames.has(p.body)) issues.push('muscle ' + m.name + ' path point ' + p.name + ' references unknown body "' + p.body + '"');
}

// no coordinate has min > max
for (const j of joints) for (const c of j.coordinates) {
  if (c.min > c.max) issues.push('joint ' + j.name + ' coordinate ' + c.name + ': min ' + c.min + ' > max ' + c.max);
}

// bonus: this model's left and right sides should be exact mirrors (same
// lengths, same masses, sign-flipped Z) -- if that ever stops holding, the
// segment-length numbers above (all read off the right side only) would be
// silently one-sided, so it's checked rather than assumed
{
  const byBase = {};
  for (const b of bodies) {
    const m = /^(.*)_([rl])$/.exec(b.name);
    if (!m) continue;
    byBase[m[1]] = byBase[m[1]] || {};
    byBase[m[1]][m[2]] = b;
  }
  for (const base in byBase) {
    const { r: br, l: bl } = byBase[base];
    if (br && bl && Math.abs(br.massKg - bl.massKg) > 1e-6) issues.push('body ' + base + '_r/_l masses differ: ' + br.massKg + ' vs ' + bl.massKg);
  }
}

console.log(issues.length === 0 ? 'verification: PASS' : ('verification: FAIL (' + issues.length + ' issue(s))'));
for (const iss of issues) console.log('  - ' + iss);

console.log('\ncounts: ' + JSON.stringify(osim.counts, null, 2).replace(/[{}"]/g, '').trim());
console.log('\nsegment lengths (mm, this model\'s own subject):');
for (const k in segmentLengthsMm) console.log('  ' + k.padEnd(16) + segmentLengthsMm[k]);
console.log('\nmuscle classes seen: ' + [...muscleClassesSeen].join(', '));
console.log('conditional path points: ' + conditionalPts + '   moving path points: ' + movingPts);
if (issues.length) process.exitCode = 1;
