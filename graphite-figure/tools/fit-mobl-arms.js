/* Parse the Holzbaur/MoBL-ARMS upper-extremity OpenSim model into the compact
   data module the figure project ships.
   Usage: node tools/fit-mobl-arms.js [path-to-MOBL_ARMS_fixed_41.osim] [out.json]
   Defaults: data/MOBL_ARMS_fixed_41.osim -> data/mobl-arms.json

   WHY THIS MODEL, AT ALL. data/rajagopal.json (tools/fit-osim.js) is a
   full-body model, but its own meta.notCovered and its ForceSet both say the
   same thing: everything at or above the shoulder in that file is a
   CoordinateActuator, not a muscle. There is no deltoid, pectoralis,
   latissimus, biceps or triceps geometry anywhere in this project. This
   model is that geometry: Holzbaur et al. (2005) built the kinematic
   skeleton and moment-arm-validated muscle paths from cadaveric and imaging
   data; Saul et al. (2015) added the Millard2012 muscle-tendon dynamics
   ("Benchmarking of dynamic simulation predictions..."); McFarland et al.
   (2019) is the specific revision fetched here, adding an updated shoulder
   range of motion and the glenohumeral/coracohumeral ligaments. It is
   distributed as "MoBL-ARMS" (Musculoskeletal Modeling LaBoratory - Arm and
   Shoulder), 11 real bodies, 20 coordinates and 50 Millard2012EquilibriumMuscle
   actuators from clavicle to fingertip, with ZERO CoordinateActuators -- this
   model is muscle-driven end to end, which is the entire reason it exists here.

   To regenerate:
     curl -sSLo MOBL_ARMS_fixed_41.osim 'https://gitlab.inria.fr/auctus-team/components/modelisation/humanmodels/opensim_models/-/raw/master/upper_body/unimanual/MoBL-ARMS%20Upper%20Extremity%20Model/MOBL_ARMS_fixed_41.osim'
     mv MOBL_ARMS_fixed_41.osim data/
     node tools/fit-mobl-arms.js

   PROVENANCE. The canonical distribution is SimTK project 657, "Upper
   Extremity Dynamic Model" (https://simtk.org/projects/upexdyn), maintained
   by Katherine Saul and Wendy Murray, files served under a "Creative Commons
   ANC Use Agreement" per the project page. SimTK gates the actual file
   download behind an account login (confirmed here: both listed downloads
   redirect to /account/login.php), so this was fetched instead from a public
   mirror that is not itself the point of origin: the AUCTUS team at INRIA
   keeps a small OpenSim-model collection at
   https://gitlab.inria.fr/auctus-team/components/modelisation/humanmodels/opensim_models,
   whose upper_body/unimanual/"MoBL-ARMS Upper Extremity Model"/ directory
   holds this exact file plus its Readme.txt and the three source papers
   (Holzbaur 2005, Saul 2015, McFarland 2019) unmodified -- consistent with a
   straight unzip of the SimTK download. Pinned commit
   a08233a14fdb17d1bd88e79a8774d3b6de79db0b (2021-08-06, "initial upload of
   models", Antun Skuric) -- the ONLY commit that has ever touched this path
   in that repository's history, so there is no later revision to silently
   drift onto. sha256 of the fetched file:
   1dd78c05340dfedb4db51b85ba5353a84ab58ecd6a7f3f5e0b4fec134591bf98

   CITATION (verbatim from the distribution's own Readme.txt): "The computer
   model was modified from Saul et al. (2015) as described by McFarland et
   al. (2019) to include an updated range of motion at the shoulder,
   ligaments models representing the glenohumeral and coracohumeral
   ligaments, and updated muscle model (Millard et al., 2013) with
   force-length and tendon curves matching the original model's respective
   curves." Holzbaur, K.R., Murray, W.M., Delp, S.L. (2005) Ann Biomed Eng
   33(6):829-40. Saul, K.R. et al. (2015) Comput Methods Biomech Biomed Engin
   18(13):1445-58. McFarland, D.C. et al. (2019) J Biomech Eng 141(12).

   WHY MORE THAN fit-osim.js EXTRACTS. Three things in this file are not
   incidental the way Rajagopal's two patella couplers were, so they are not
   skipped the way those were:
     - CONSTRAINTS. 13 of this model's 20 coordinates are not driven by
       muscles or dynamics at all -- they are slaved to elv_angle,
       shoulder_elv, deviation or flexion by a CoordinateCouplerConstraint
       (a SimmSpline of one coordinate onto another), the standard OpenSim
       trick for approximating scapulothoracic rhythm without a true
       scapulothoracic contact constraint. Skip this and 13/20 of the file's
       own coordinates are meaningless numbers with no story for how they
       move. So constraintset is extracted in full: which coordinate drives
       which, and the spline breakpoints of the driving function.
     - LIGAMENTS. McFarland's own stated reason for this revision. Four
       (coracohumeral + 3-part glenohumeral) are real passive restraints on
       this model, not muscles -- extracted separately, in their own actual
       shape (resting_length, pcsa_force, a force_length_curve spline), not
       forced into the Millard muscle schema they do not share.
     - WrapTorus. Used 11 times in this file (mostly wrist/forearm tendons)
       and NOT present in Rajagopal2016.osim, so fit-osim.js only ever had to
       warn about it. Implemented here for real: inner_radius/outer_radius.

   WHY A HAND-WRITTEN PARSER, UNITS, AXES-NOT-REMAPPED: identical reasoning
   to tools/fit-osim.js -- same file format (plain OpenSim XML, verified here
   too: zero CDATA sections, zero entity references), same one-place mm
   conversion (MM constant below), same refusal to remap a per-body local
   frame into any other frame. See that file's header for the full argument;
   it is not re-derived here.

   AXES, THIS FILE SPECIFICALLY. Rajagopal's own convention was confirmed
   from a mirrored left/right pair, which this single "Right"-arm-only model
   does not have. What this file DOES have is real, cross-checkable anatomy:
   on the humerus body's own frame, PECM1 (pec major, inserts anterior lip of
   the bicipital groove) and SUBSCAP (subscapularis, inserts the lesser
   tubercle, also anterior) both land at X > 0 (+0.0117, +0.0140), while
   INFSP (infraspinatus, inserts the POSTERIOR facet of the greater
   tubercle) lands at X < 0 (-0.0089); DELT1 (clavicular/anterior deltoid,
   X=+0.0090) sits anterior of DELT3 (scapular/posterior deltoid, X=+0.0021)
   on the same shared insertion region, same direction. Four independent
   muscle-anatomy facts, one consistent sign: +X is anterior here too, same
   as Rajagopal. The rotator-cuff group inserting near Y=0 (proximal, at the
   humeral head) versus the deltoid tuberosity insertions at Y far negative
   (~-0.08 to -0.14, well distal down the shaft) is the same story for +Y
   being the proximal-toward-shoulder direction, which is superior at this
   model's reference pose -- again matching Rajagopal. +Z (lateral/the
   subject's right) is carried over from the same SIMM/OpenSim authoring
   convention and Rajagopal's own finding, NOT independently re-derived from
   this file the way X and Y just were -- said plainly rather than implied. */
'use strict';
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
//  XML — identical recursive-descent parser to tools/fit-osim.js. Node shape:
//  {tag, attrs, kids, text}. Kept as a literal copy rather than a shared
//  require so this script stays as self-contained as its sibling.
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
const bodyOf = (socketPath) => { const p = (socketPath || '').split('/').filter(Boolean); return p[p.length - 1] || null; };

const MM = 1000; // the one place metres become millimetres -- see header
const r = (x, d) => { const v = Math.round(x * 10 ** d) / 10 ** d; return v === 0 ? 0 : v; };
const vmm = (node, d) => vec(node).map((v) => r(v * MM, d));
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vlen = (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);

// ---------------------------------------------------------------------------
//  LOAD
// ---------------------------------------------------------------------------
const osimPath = process.argv[2] || path.join(__dirname, '..', 'data', 'MOBL_ARMS_fixed_41.osim');
const outPath = process.argv[3] || path.join(__dirname, '..', 'data', 'mobl-arms.json');
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
//  Phantom bodies (clavphant, scapphant, humphant, humphant1, proximal_row)
//  are the standard OpenSim decomposition trick for a multi-axis joint built
//  from chained single-axis CustomJoints -- they carry a nominal 0.0001 kg,
//  not real inertia. Flagged from the MASS, not the name, same reasoning
//  fit-osim.js uses for muscle region: a fact read off the data is worth
//  more than a fact assumed from a naming habit ("*phant" happens to be
//  every one of them here, but that is not what phantom means).
// ---------------------------------------------------------------------------
const bodySet = child(model, 'BodySet');
const bodyNodes = deep(bodySet, 'Body');
const PHANTOM_MASS_KG = 0.001; // real segments here are >=0.15kg; the decomposition frames are 0.0001kg
const bodies = bodyNodes.map((b) => {
  const massKg = r(num(child(b, 'mass')), 6);
  return {
    name: attr(b, 'name'),
    massKg,
    phantom: massKg <= PHANTOM_MASS_KG,
    massCenterMm: vmm(child(b, 'mass_center'), 3),
    inertiaKgMm2: vec(child(b, 'inertia')).map((v) => r(v * MM * MM, 3)),
  };
});
const bodyNames = new Set(bodies.map((b) => b.name));
bodyNames.add('ground');

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
      } else if (wt === 'WrapTorus') {
        surf.innerRadiusMm = r(num(child(w, 'inner_radius')) * MM, 3);
        surf.outerRadiusMm = r(num(child(w, 'outer_radius')) * MM, 3);
      }
      wrapSurfaces.push(surf);
    }
  }
}

// ---------------------------------------------------------------------------
//  JOINTS + KINEMATIC TREE — identical shape to tools/fit-osim.js.
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

  // Every coordinate in this file is rotational (checked below, in
  // VERIFICATION) -- no ground_pelvis-style translational root exists in an
  // isolated "fixed" arm model -- but the detection is still read from the
  // file's own SpatialTransform rather than assumed, same discipline as
  // fit-osim.js, so a future revision that adds one is not silently wrong.
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
      coordinate: text(child(ax, 'coordinates')) || null,
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
const allCoordNames = new Set(joints.flatMap((j) => j.coordinates.map((c) => c.name)));

// ---------------------------------------------------------------------------
//  CONSTRAINTS — see header. A CoordinateCouplerConstraint drives one
//  dependent coordinate as coupled_coordinates_function(independent
//  coordinate(s)); every one in this file is a SimmSpline of exactly one
//  independent coordinate, but independent_coordinate_names is read as the
//  space-separated list the format actually allows, not assumed singular.
// ---------------------------------------------------------------------------
const constraintObjs = child(child(model, 'ConstraintSet'), 'objects');
const constraints = [];
for (const c of (constraintObjs ? constraintObjs.kids : [])) {
  if (c.tag !== 'CoordinateCouplerConstraint') {
    console.warn('constraint "' + attr(c, 'name') + '" has unrecognised type ' + c.tag + ', skipped');
    continue;
  }
  const fnHolder = child(c, 'coupled_coordinates_function');
  const fn = fnHolder && fnHolder.kids[0];
  constraints.push({
    name: attr(c, 'name'),
    enforced: bool(child(c, 'isEnforced')),
    dependentCoordinate: text(child(c, 'dependent_coordinate_name')),
    independentCoordinates: text(child(c, 'independent_coordinate_names')).split(/\s+/).filter(Boolean),
    scaleFactor: num(child(c, 'scale_factor')),
    function: fn ? fn.tag : null,
    // x/y stay in radians: every coordinate in this file is rotational (see
    // JOINTS above), so unlike vmm() elsewhere, no MM scaling ever applies here
    x: fn ? vec(child(fn, 'x')) : null,
    y: fn ? vec(child(fn, 'y')) : null,
  });
}
const dependentCoordNames = new Set(constraints.map((c) => c.dependentCoordinate));
const independentCoordNames = [...allCoordNames].filter((n) => !dependentCoordNames.has(n)).sort();

// ---------------------------------------------------------------------------
//  MUSCLES + LIGAMENTS
//  One pass over ForceSet's own <objects>, same as fit-osim.js. This file
//  additionally contains Ligament forces (4: the McFarland-added
//  glenohumeral x3 + coracohumeral), which do not share the Millard muscle
//  schema (no max_isometric_force/optimal_fiber_length/tendon_slack_length/
//  pennation_angle_at_optimal -- instead resting_length, pcsa_force and a
//  force_length_curve spline) and are recorded in their own shape rather
//  than forced into the muscle one. Zero CoordinateActuators exist in this
//  file (checked below) -- there is no torque-actuator fallback to record.
// ---------------------------------------------------------------------------
const forceObjs = child(child(model, 'ForceSet'), 'objects');
const muscles = [];
const ligaments = [];
const actuators = [];
let conditionalPts = 0, movingPts = 0;
const muscleClassesSeen = new Set();

function readPath(f) {
  const gp = child(f, 'GeometryPath');
  const ppObjs = child(child(gp, 'PathPointSet'), 'objects');
  const bodiesTouched = new Set();
  const pathPoints = (ppObjs ? ppObjs.kids : []).map((p) => {
    if (p.tag === 'ConditionalPathPoint') conditionalPts++;
    if (p.tag === 'MovingPathPoint') movingPts++;
    const pbody = bodyOf(text(child(p, 'socket_parent_frame')));
    bodiesTouched.add(pbody);
    const loc = child(p, 'location');
    return {
      name: attr(p, 'name'), type: p.tag, conditional: p.tag !== 'PathPoint',
      body: pbody, locationMm: loc ? vmm(loc, 4) : null,
    };
  });
  const wrapObjs = child(child(gp, 'PathWrapSet'), 'objects');
  const wraps = (wrapObjs ? wrapObjs.kids : []).map((w) => ({
    wrapObject: text(child(w, 'wrap_object')), method: text(child(w, 'method')),
    range: vec(child(w, 'range')),
  }));
  return { pathPoints, wraps, bodiesTouched };
}

for (const f of forceObjs.kids) {
  if (f.tag === 'CoordinateActuator') {
    actuators.push({ name: attr(f, 'name'), coordinate: text(child(f, 'coordinate')), optimalForceN: num(child(f, 'optimal_force')) });
    continue;
  }
  if (f.tag === 'Ligament') {
    const { pathPoints, wraps } = readPath(f);
    const fl = child(f, 'SimmSpline'); // the ligament's force_length_curve, named via its `name` attr not its tag
    ligaments.push({
      name: attr(f, 'name'),
      restingLengthMm: r(num(child(f, 'resting_length')) * MM, 4),
      pcsaForceN: r(num(child(f, 'pcsa_force')), 3),
      forceLengthCurve: fl ? { function: fl.tag, x: vec(child(fl, 'x')), y: vec(child(fl, 'y')) } : null,
      path: pathPoints, wraps,
    });
    continue;
  }
  if (!/Muscle$/.test(f.tag)) { console.warn('force "' + attr(f, 'name') + '" has unrecognised type ' + f.tag + ', skipped'); continue; }
  muscleClassesSeen.add(f.tag);
  const { pathPoints, wraps } = readPath(f);
  muscles.push({
    name: attr(f, 'name'),
    maxIsometricForceN: r(num(child(f, 'max_isometric_force')), 3),
    optimalFiberLengthMm: r(num(child(f, 'optimal_fiber_length')) * MM, 4),
    tendonSlackLengthMm: r(num(child(f, 'tendon_slack_length')) * MM, 4),
    pennationAngleAtOptimalRad: r(num(child(f, 'pennation_angle_at_optimal')), 6),
    path: pathPoints, wraps,
  });
}

// ---------------------------------------------------------------------------
//  SEGMENT LENGTHS — same-frame subtraction only, see tools/fit-osim.js's
//  header for why composing frames across bodies is refused here.
//  humerus and forearm are deliberately computed the SAME way Rajagopal's
//  are (forearm = the RADIUS bone specifically, matching ANSUR's
//  radiale-stylion definition) so the two models' numbers are comparable
//  without a unit or definition mismatch. clavicle/scapula/carpalRow are
//  this model's own segments with no ANSUR or Rajagopal counterpart --
//  reported anyway, clearly labelled, because a consumer scaling THIS
//  model's own wrap surfaces and phantom-joint offsets needs them too.
// ---------------------------------------------------------------------------
function segLenSameFrame(proximalJoint, distalJoint) {
  const pj = jointByName[proximalJoint], dj = jointByName[distalJoint];
  if (pj.childBody !== dj.parentBody) throw new Error('segLenSameFrame(' + proximalJoint + ',' + distalJoint + '): not the same body (' + pj.childBody + ' vs ' + dj.parentBody + ')');
  return r(vlen(vsub(dj.locationInParentMm, pj.locationInChildMm)), 2);
}
const segmentLengthsMm = {
  humerus: segLenSameFrame('shoulder2', 'elbow'),
  forearm: segLenSameFrame('radioulnar', 'radiocarpal'), // radius bone, matches Rajagopal's/ANSUR's definition
  clavicle: segLenSameFrame('sternoclavicular', 'unrotscap'),   // this model's own segment, no ANSUR/Rajagopal counterpart
  scapula: segLenSameFrame('acromioclavicular', 'unrothum'),    // ditto
  carpalRow: segLenSameFrame('radiocarpal', 'wrist_hand'),      // ditto -- proximal_row is itself a phantom (massless) body, so this is this model's own simplification of "wrist depth", not a measured carpal length
};

// ---------------------------------------------------------------------------
//  ASSEMBLE + WRITE
// ---------------------------------------------------------------------------
const mobl = {
  meta: {
    modelName,
    lineage: 'Holzbaur, K.R., Murray, W.M., Delp, S.L. (2005) A model of the upper extremity for simulating musculoskeletal surgery and analyzing neuromuscular control. Ann Biomed Eng 33(6):829-40 -- original kinematic model. Saul, K.R., Hu, X., Goehler, C.M., et al. (2015) Benchmarking of dynamic simulation predictions in two software platforms using an upper limb musculoskeletal model. Comput Methods Biomech Biomed Engin 18(13):1445-58 -- Millard2012 muscle-tendon dynamics. McFarland, D.C., Binder-Markey, B.I., Nichols, J.A., et al. (2019) J Biomech Eng 141(12) -- this revision: updated shoulder ROM + glenohumeral/coracohumeral ligaments + Millard-2013-matched force-length/tendon curves.',
    citation: "The computer model was modified from Saul et al. (2015) as described by McFarland et al. (2019) to include an updated range of motion at the shoulder, ligaments models representing the glenohumeral and coracohumeral ligaments, and updated muscle model (Millard et al., 2013) with force-length and tendon curves matching the original model's respective curves.  (verbatim from the distribution's Readme.txt)",
    authoritativeSource: 'https://simtk.org/projects/upexdyn (SimTK project 657, "Upper Extremity Dynamic Model"; direct file download is account-login-gated, confirmed at extraction time)',
    license: 'SimTK project page states "Creative Commons ANC Use Agreement"; full license text was not reachable without a SimTK login, so only the citation requirement above (from the distribution\'s own Readme.txt) is reproduced here -- verify licensing terms directly against SimTK project 657 before any redistribution beyond this project.',
    fetchedFrom: 'https://gitlab.inria.fr/auctus-team/components/modelisation/humanmodels/opensim_models/-/raw/master/upper_body/unimanual/MoBL-ARMS%20Upper%20Extremity%20Model/MOBL_ARMS_fixed_41.osim (public mirror maintained by the AUCTUS team, INRIA -- not the point of origin; see authoritativeSource)',
    fetchedFromCommit: 'a08233a14fdb17d1bd88e79a8774d3b6de79db0b (2021-08-06, "initial upload of models") -- the only commit that has ever touched this file in that repository',
    fetchedFileSha256: '1dd78c05340dfedb4db51b85ba5353a84ab58ecd6a7f3f5e0b4fec134591bf98',
    extractedDate: new Date().toISOString().slice(0, 10),
    units: 'lengths and translations in millimetres (source file is metres; multiplied by 1000 once, in tools/fit-mobl-arms.js); inertia in kg*mm^2 (source kg*m^2, scaled by 1e6 to match); angles in radians; force in newtons; mass in kilograms',
    axes: "each position is in ITS OWN BODY's local frame as authored in the source file. On the humerus body specifically this was cross-checked here (not assumed): PECM1 and SUBSC (both anterior insertions) land at local X>0, INFSP (a posterior insertion) lands at X<0, and DELT1 (anterior deltoid) sits anterior of DELT3 (posterior deltoid) at the same shared insertion region -- four independent muscle-anatomy facts, one consistent sign, so +X is anterior here, matching Rajagopal. Rotator-cuff insertions near Y=0 (proximal, at the humeral head) versus deltoid-tuberosity insertions at Y far negative (well distal down the shaft) is the same kind of evidence for +Y being proximal/superior-at-reference, also matching Rajagopal. +Z (lateral / the subject's right) follows the same SIMM/OpenSim authoring convention and Rajagopal's own finding but was NOT independently re-derived from this file. This is NOT graphite-figure's world frame (+X superior, +Y left, +Z anterior); no remapping is applied here, matching tools/fit-osim.js.",
    phantomBodies: 'clavphant, scapphant, humphant, humphant1, proximal_row carry a nominal 0.0001kg mass -- OpenSim\'s standard trick for decomposing a multi-axis joint (here, scapulothoracic rhythm and the 3-axis glenohumeral rotation) into a chain of single-axis CustomJoints. They are not real anatomical segments; bodies.*.phantom flags them (by mass, not by name).',
    slaveCoordinates: (independentCoordNames.length) + ' of ' + allCoordNames.size + ' coordinates are independently actuated/dynamic (' + independentCoordNames.join(', ') + '); the remaining ' + dependentCoordNames.size + ' are algebraically SLAVED to one of those via a CoordinateCouplerConstraint (see constraints[]) and their own <range> in the source file is an arbitrary near-±99999.9 rad placeholder, NOT a physiological range of motion -- joints[].coordinates carries that placeholder through unchanged (min/max as authored) precisely so it is never mistaken for a measured limit; consult constraints[] for how a slaved coordinate actually moves.',
    noTrapezius: 'This model has no trapezius, rhomboid or serratus anterior muscle: scapular kinematics are entirely handled by the constraintset (elv_angle/shoulder_elv driving the scapula\'s phantom-body chain), not by a muscle actuator, which is the standard Holzbaur/Saul-lineage simplification. Deltoid, pectoralis, latissimus, biceps and triceps ARE present (see muscles[]); trapezius is not, and should not be assumed present just because this file exists.',
    notCovered: 'no forward kinematics is computed across the multi-joint scapulothoracic/glenohumeral chain, so no single "shoulder width" or "arm length" spanning multiple bodies is reported -- only same-body-frame segment lengths (see segmentLengthsMm and its comment in this script). Frames, Markers and ControllerSet are not extracted, out of scope for this pass. This file also carries 14 CoordinateLimitForce elements (a "_ligaments" and a "_damping" one per independent coordinate) -- OpenSim\'s scalar passive-stiffness-near-end-of-range model, not a 3D path, and a different kind of object from the 4 true path-based Ligaments above -- these are read by this script (see the console warnings it prints) but not extracted into this JSON; if per-coordinate passive stiffness curves are ever needed, that is where to add them.',
  },
  bodies,
  joints,
  tree: {
    root: 'ground',
    edges: joints.map((j) => ({ parent: j.parentBody, child: j.childBody, joint: j.name })),
  },
  constraints,
  muscles,
  ligaments,
  actuators,
  wrapSurfaces,
  segmentLengthsMm,
  counts: {
    bodies: bodies.length,
    bodiesReal: bodies.filter((b) => !b.phantom).length,
    joints: joints.length,
    coordinates: allCoordNames.size,
    coordinatesIndependent: independentCoordNames.length,
    coordinatesSlaved: dependentCoordNames.size,
    constraints: constraints.length,
    muscles: muscles.length,
    ligaments: ligaments.length,
    pathPoints: muscles.reduce((s, m) => s + m.path.length, 0) + ligaments.reduce((s, l) => s + l.path.length, 0),
    wrapSurfaces: wrapSurfaces.length,
    actuators: actuators.length,
  },
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(mobl));
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

// every muscle AND ligament path point references a body that exists
for (const m of muscles) for (const p of m.path) {
  if (!bodyNames.has(p.body)) issues.push('muscle ' + m.name + ' path point ' + p.name + ' references unknown body "' + p.body + '"');
}
for (const l of ligaments) for (const p of l.path) {
  if (!bodyNames.has(p.body)) issues.push('ligament ' + l.name + ' path point ' + p.name + ' references unknown body "' + p.body + '"');
}

// no coordinate has min > max (note: 13 of these are the slave placeholder
// range, ~-99999.9..99999.9 -- still trivially min<max, still checked)
for (const j of joints) for (const c of j.coordinates) {
  if (c.min > c.max) issues.push('joint ' + j.name + ' coordinate ' + c.name + ': min ' + c.min + ' > max ' + c.max);
}

// every coordinate named by a constraint actually exists
for (const c of constraints) {
  if (!allCoordNames.has(c.dependentCoordinate)) issues.push('constraint ' + c.name + ': dependent coordinate "' + c.dependentCoordinate + '" does not exist');
  for (const n of c.independentCoordinates) if (!allCoordNames.has(n)) issues.push('constraint ' + c.name + ': independent coordinate "' + n + '" does not exist');
}

// every coordinate in this file is rotational -- the mm-vs-radian branch in
// the JOINTS section above should therefore never have fired
for (const j of joints) for (const c of j.coordinates) {
  if (c.translational) issues.push('joint ' + j.name + ' coordinate ' + c.name + ' is translational -- unexpected for this model, mm scaling may be wrong');
}

console.log(issues.length === 0 ? 'verification: PASS' : ('verification: FAIL (' + issues.length + ' issue(s))'));
for (const iss of issues) console.log('  - ' + iss);

console.log('\ncounts: ' + JSON.stringify(mobl.counts, null, 2).replace(/[{}"]/g, '').trim());
console.log('\nsegment lengths (mm, this model\'s own subject):');
for (const k in segmentLengthsMm) console.log('  ' + k.padEnd(16) + segmentLengthsMm[k]);
console.log('\nindependent coordinates (' + independentCoordNames.length + '): ' + independentCoordNames.join(', '));
console.log('muscle classes seen: ' + [...muscleClassesSeen].join(', '));
console.log('conditional path points: ' + conditionalPts + '   moving path points: ' + movingPts);
if (issues.length) process.exitCode = 1;
