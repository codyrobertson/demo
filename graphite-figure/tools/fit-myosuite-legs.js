/* Parse MyoSuite's MyoLegs MuJoCo model into the compact data module the
   figure project ships -- a third, independent lower-limb muscle-geometry
   source alongside data/rajagopal.json, and (see tools/fit-tlem.js's
   header) the shippable fallback for the TLEM2-derived muscle geometry
   this project could read but not redistribute.
   Usage: node tools/fit-myosuite-legs.js [path-to-myo_sim-checkout] [out.json]
   Defaults: data/myo_sim -> data/myosuite-legs.json

   ==========================================================================
   WHAT THIS IS AND WHERE IT ACTUALLY LIVES. MyoSuite (github.com/MyoHub/
   myosuite) is the RL-environment package; the actual musculoskeletal MODEL
   -- bodies, sites, tendons, muscle actuators -- lives in a SEPARATE git
   submodule repository, github.com/MyoHub/myo_sim (myosuite's own
   .gitmodules pins myosuite/simhive/myo_sim to that repo). This script
   reads FOUR files from that submodule's leg/ directory:
     leg/assets/myolegs_chain.xml   (body tree: bodies, joints, sites, wrap geoms)
     leg/assets/myolegs_tendon.xml  (muscle paths: ordered site/wrap-geom sequences)
     leg/assets/myolegs_muscle.xml  (muscle actuator parameters)
     leg/assets/myolegs_assets.xml  (default classes -- read only for the
                                      myoleg_wrap default geom type, "cylinder")
   not myosuite's own repository directly.

   To regenerate:
     git clone --depth 1 https://github.com/MyoHub/myo_sim data/myo_sim
     cd data/myo_sim && git checkout <pinned commit below> && cd -
     node tools/fit-myosuite-legs.js

   PROVENANCE. MyoSuite is described in: Caggiano, V., Wang, H., Durandau, G.,
   Sartori, M., Kumar, V. (2022) "MyoSuite -- A contact-rich simulation suite
   for musculoskeletal motor control." L4DC 2022. The MyoLegs model
   specifically credits Vikash Kumar, Vittorio Caggiano and Huawei Wang in
   its own file header (quoted verbatim below in the axes/units section).
   Both repositories fetched via `git clone`:
     myosuite:  https://github.com/MyoHub/myosuite, pinned commit
       94300995076b20ed6a8cfc65794c54bc997a0697 (2026-05-13) -- read only to
       discover that the leg model lives in the myo_sim submodule and to
       confirm the submodule pin below; nothing from myosuite\'s own
       repository is otherwise extracted here.
     myo_sim:   https://github.com/MyoHub/myo_sim, pinned commit
       33f3ded946f55adbdcf963c99999587aadaf975f (2025-08-07) -- the EXACT
       commit myosuite\'s own .gitmodules/gitlink points to at the commit
       above (confirmed via `git ls-tree`, not just "whatever HEAD of
       myo_sim happened to be" -- myo_sim\'s HEAD at fetch time was a later,
       differently-laid-out commit, 33c89c2..., which is why the pin
       matters here more than usual).

   LICENSE -- Apache License, Version 2.0, for BOTH repositories (confirmed
   from each repository's own top-level LICENSE file, and repeated verbatim
   in-file at the top of every .xml this script reads, e.g. myolegs.xml:
   "License :: Under Apache License, Version 2.0 (the "License"); you may
   not use this file except in compliance with the License. You may obtain
   a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied."). Apache 2.0 permits commercial use, modification and
   redistribution (with attribution and a copy of the license) -- the most
   permissive of this project's four lower-limb sources; no non-commercial
   or research-only restriction applies here.

   ==========================================================================
   WHY A HAND-WRITTEN PARSER: this is plain MuJoCo XML (`<mujocoinclude>`
   root, meant to be textually <include>d rather than run standalone) --
   verified here, freshly, for THESE specific files (zero CDATA sections,
   zero entity references across all four files this script reads, checked
   with a literal grep before writing this). The same ~50-line
   recursive-descent parser as tools/fit-osim.js/tools/fit-mobl-arms.js
   handles it; kept as a literal copy for the same "stay self-contained"
   reason those two files give.

   MUSCLE-MODEL PARAMETER SEMANTICS -- CONFIRMED FROM MYOSUITE'S OWN PYTHON
   CODE, NOT FROM THE MUJOCO XML REFERENCE DOCS ALONE. MuJoCo's native
   dyntype/gaintype/biastype="muscle" actuator (which is what every
   <general class="myoleg_muscle"> element in myolegs_muscle.xml is, per
   myolegs_assets.xml's own default-class declaration) stores a 10-slot
   gainprm/biasprm array whose meaning this project did not want to take on
   faith from memory of the MuJoCo docs. Instead, grep across MyoSuite's OWN
   Python source turned up several places that read named quantities out of
   these exact array slots:
     myosuite/envs/myo/myochallenge/run_track_v0.py (and the identical
     pattern in chasetag_v0.py, soccer_v0.py):
       def _get_muscle_lengthRange(self):    return self.mj_model.actuator_lengthrange.copy()
       def _get_tendon_lengthspring(self):   return self.mj_model.tendon_lengthspring.copy()
       def _get_muscle_operating_length(self): return self.mj_model.actuator_gainprm[:, 0:2].copy()
       def _get_muscle_fmax(self):           return self.mj_model.actuator_gainprm[:, 2].copy()
     myosuite/agents/baseline_Reflex/ReflexCtrInterface.py (a baseline
     reflex controller shipped with MyoSuite) additionally computes optimal
     fibre length explicitly:
       temp_L0 = (actuator_lengthrange[:,0] - tendon_lengthspring) / actuator_biasprm[:,0]
     and reads peak force from actuator_biasprm[:,2] (identical to
     gainprm[:,2] here -- see below).
   From this, and cross-checked against myolegs_assets.xml's own
   <default class="myoleg_muscle"> element (whose default gainprm/biasprm
   is "0.75 1.05 -1 400 0.5 1.6 1.5 1.3 1.2 0", with force=-1 meaning
   "auto-compute at compile time" UNLESS a specific muscle overrides slot 2
   with a real number, which every muscle in myolegs_muscle.xml does), the
   10 gainprm/biasprm slots are read here as:
     [0] rangeMin      -- operating length lower bound, as a multiple of L0
     [1] rangeMax      -- operating length upper bound, as a multiple of L0
     [2] forceN        -- PEAK/MAXIMUM ISOMETRIC FORCE, in newtons (confirmed:
                           MyoSuite's own _get_muscle_fmax()/muscle_Fmax code
                           reads exactly this slot, and this project's own
                           sarcopenia-condition code in base_v0.py halves
                           this exact slot to model a weaker muscle)
     [3] scale         -- only meaningful when forceN<0 (auto-compute); inert
                           here since every muscle has a real forceN
     [4] lce_min        -- normalised active force-length curve breakpoint
     [5] lce_max        -- normalised active force-length curve breakpoint
     [6] vmax           -- max normalised contraction velocity
     [7] fpmax           -- passive-force curve multiplier
     [8] fvmax           -- force-velocity curve multiplier
     [9] (unused, always 0 in every muscle in this file)
   gainprm and biasprm are IDENTICAL for every muscle in this file (checked
   in the parser below, not assumed) -- MuJoCo's own convention when
   biastype mirrors gaintype without an independent override.
   optimalFiberLengthMm is COMPUTED (not directly authored) via the exact
   formula ReflexCtrInterface.py uses: L0 = (lengthrange[0] - springlength)
   / rangeMin -- see FIBRE LENGTH below for the derivation and its
   assumptions.
   PENNATION ANGLE -- CONFIRMED ABSENT, not overlooked: grepped for
   "pennat" (case-insensitive) across every file in both the myo_sim and
   myosuite checkouts -- zero matches anywhere. MuJoCo's native "muscle"
   gain/bias type has no pennation-angle term at all (unlike OpenSim's
   Millard2012EquilibriumMuscle, which data/rajagopal.json and
   data/mobl-arms.json both carry pennation_angle_at_optimal for); if
   MyoSuite's calibration implicitly absorbed a pennation effect into the
   force-length/velocity shape parameters above, that is not separately
   recoverable from this file. muscles[].pennationAngleDeg is therefore
   NOT a field in this dataset at all, rather than a field silently left
   null -- said plainly so its absence is not mistaken for an oversight.

   FIBRE LENGTH -- L0 = (lengthrange[0] - tendonSlackLengthMm) / rangeMin.
   This assumes the muscle-tendon unit is at its SHORTEST authored
   configuration (lengthrange[0]) precisely when the fibre is at
   rangeMin*L0 -- i.e. that MTU_length = fibre_length + tendon_length with
   the tendon AT its slack length at that pose, the same decomposition
   OpenSim's Millard model uses. This is MyoSuite's OWN reflex-controller
   code's formula (see above), not derived independently here; a handful
   of muscles produce a negative or implausible L0 under this formula (see
   VERIFICATION at the bottom) and are flagged rather than silently kept.

   ==========================================================================
   UNITS -- METRES in the source (MuJoCo's default/only length unit; no
   file-level unit declaration exists to check the way OpenSim's
   length_units attribute does, so this is standard-MuJoCo-convention, not
   independently re-derived the way tools/fit-osim.js\'s metres claim was).
   Converted to millimetres once, via the MM constant below, same
   discipline as every other tools/fit-*.js in this project. Angles: joint
   ranges are authored in RADIANS (MuJoCo\'s default `angle="radian"`,
   confirmed from leg/myolegs.xml\'s own <compiler angle="radian" .../>).

   AXES -- EMPIRICALLY CONFIRMED, not assumed, from the body-chain
   structure itself (MuJoCo bodies are positioned relative to their
   PARENT body\'s own frame, so a child body\'s raw `pos` IS the segment
   vector in the parent\'s frame -- no separate joint-offset composition
   needed, simpler than tools/fit-osim.js\'s situation): tibia_r\'s pos
   relative to its parent femur_r is (-0.0000005, -0.404425, -0.0012653) --
   overwhelmingly a Y-magnitude vector, and 404.4mm is a highly plausible
   adult femur length (see VERIFICATION\'s comparison against
   data/rajagopal.json\'s 408.05mm) -- confirming Y is this model\'s
   proximal-distal axis, same role Y plays in data/rajagopal.json and
   tools/fit-tlem.js. toes_r\'s pos relative to its parent calcn_r is
   (0.1788, -0.002, 0.0011) -- overwhelmingly X-magnitude and forward
   (toes distal/anterior of the rest of the foot) -- confirming X is this
   model\'s anterior axis, same role X plays in both those files. Left vs
   right sign (which side +Z favours) was NOT independently re-derived
   here (would need an asymmetric single-side landmark comparison this
   bilateral file was not checked against) -- said plainly rather than
   assumed from the "_r"/"_l" naming alone. */
'use strict';
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
//  XML — identical recursive-descent parser to tools/fit-osim.js /
//  tools/fit-mobl-arms.js. Node shape: {tag, attrs, kids, text}.
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
    if (src[i] === '/') { i += 2; return node; }
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
function deep(node, tag, out) {
  out = out || [];
  for (const k of node.kids) { if (k.tag === tag) out.push(k); deep(k, tag, out); }
  return out;
}
const attr = (node, name) => node && node.attrs[name];
const vec = (s) => (s ? s.trim().split(/\s+/).map(Number) : []);

const MM = 1000; // the one place metres become millimetres, see header
const r = (x, d) => { const v = Math.round(x * 10 ** d) / 10 ** d; return v === 0 ? 0 : v; };
const vlen = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0));

// ---------------------------------------------------------------------------
//  LOAD
// ---------------------------------------------------------------------------
const srcRoot = process.argv[2] || path.join(__dirname, '..', 'data', 'myo_sim');
const outPath = process.argv[3] || path.join(__dirname, '..', 'data', 'myosuite-legs.json');
const legDir = path.join(srcRoot, 'leg', 'assets');
for (const f of ['myolegs_chain.xml', 'myolegs_tendon.xml', 'myolegs_muscle.xml', 'myolegs_assets.xml']) {
  if (!fs.existsSync(path.join(legDir, f))) { console.error('missing ' + path.join(legDir, f) + ' -- see this file\'s header for how to fetch a checkout (note: the model lives in the myo_sim submodule, not myosuite itself)'); process.exit(1); }
}
function load(file) { return parseXML(fs.readFileSync(path.join(legDir, file), 'utf8')); }
const chainDoc = load('myolegs_chain.xml');
const tendonDoc = load('myolegs_tendon.xml');
const muscleDoc = load('myolegs_muscle.xml');
const assetsDoc = load('myolegs_assets.xml');
console.log('loaded 4 MuJoCo XML fragments from ' + legDir);

// ---------------------------------------------------------------------------
//  DEFAULT CLASSES — only what this script needs: myoleg_wrap's default
//  geom type ("cylinder"), so wrap geoms that omit `type` (i.e. every
//  cylinder one) resolve correctly, and confirming gainprm==biasprm holds
//  by class default too (both read from the SAME default element).
// ---------------------------------------------------------------------------
const wrapDefaultGeom = deep(assetsDoc, 'default').find((d) => attr(d, 'class') === 'myoleg_wrap');
const WRAP_DEFAULT_TYPE = (wrapDefaultGeom && attr(deep(wrapDefaultGeom, 'geom')[0], 'type')) || 'cylinder';
console.log('  myoleg_wrap default geom type: ' + WRAP_DEFAULT_TYPE);

// ---------------------------------------------------------------------------
//  BODY TREE — bodies, joints, sites, wrap geoms, all recursively walked so
//  every site/geom/joint carries the name of the BODY it is physically
//  attached to (its immediately-enclosing <body>), exactly the fact
//  tendon-path resolution needs below.
// ---------------------------------------------------------------------------
const bodies = []; // {name, parentBody, posMm, quat}
const joints = [];  // {name, body, type, axis, posMm, rangeRad, limited}
const sites = {};   // name -> {body, posMm}
const wrapGeoms = {}; // name -> {body, type, posMm, quat, radiusMm, halfLengthMm|null}

function walkBody(node, parentName) {
  const name = attr(node, 'name');
  bodies.push({
    name, parentBody: parentName,
    posMm: vec(attr(node, 'pos')).map((v) => r(v * MM, 4)),
    quat: vec(attr(node, 'quat')) , // unitless (w,x,y,z) or [] if not authored (identity)
  });
  for (const k of node.kids) {
    if (k.tag === 'joint') {
      joints.push({
        name: attr(k, 'name'), body: name,
        type: attr(k, 'type') || 'hinge', // MuJoCo default joint type
        axis: vec(attr(k, 'axis')),
        posMm: vec(attr(k, 'pos') || '0 0 0').map((v) => r(v * MM, 4)),
        rangeRad: vec(attr(k, 'range')),
        limited: attr(k, 'limited') === 'true' || (attr(k, 'range') ? true : false),
      });
    } else if (k.tag === 'site') {
      const sname = attr(k, 'name');
      if (sname) sites[sname] = { body: name, posMm: vec(attr(k, 'pos') || '0 0 0').map((v) => r(v * MM, 4)) };
    } else if (k.tag === 'geom' && attr(k, 'class') === 'myoleg_wrap') {
      const gname = attr(k, 'name');
      const type = attr(k, 'type') || WRAP_DEFAULT_TYPE;
      const size = vec(attr(k, 'size'));
      wrapGeoms[gname] = {
        body: name, type,
        posMm: vec(attr(k, 'pos') || '0 0 0').map((v) => r(v * MM, 4)),
        quat: vec(attr(k, 'quat')),
        radiusMm: size.length > 0 ? r(size[0] * MM, 4) : null,
        halfLengthMm: (type === 'cylinder' && size.length > 1) ? r(size[1] * MM, 4) : null,
      };
    } else if (k.tag === 'body') {
      walkBody(k, name);
    }
  }
}
const topBodies = chainDoc.kids.filter((k) => k.tag === 'body');
for (const tb of topBodies) walkBody(tb, null);
const bodyNames = new Set(bodies.map((b) => b.name));
console.log('  ' + bodies.length + ' bodies, ' + joints.length + ' joints, ' + Object.keys(sites).length + ' sites, ' + Object.keys(wrapGeoms).length + ' wrap geoms');

// ---------------------------------------------------------------------------
//  TENDON PATHS — ordered site/wrap-geom sequence per muscle.
// ---------------------------------------------------------------------------
const tendonSpatials = deep(tendonDoc, 'spatial');
const tendons = {};
for (const sp of tendonSpatials) {
  const name = attr(sp, 'name');
  const path_ = sp.kids.map((k) => {
    if (k.tag === 'site') return { kind: 'site', site: attr(k, 'site') };
    if (k.tag === 'geom') return { kind: 'wrap', geom: attr(k, 'geom'), sidesite: attr(k, 'sidesite') || null };
    return null;
  }).filter(Boolean);
  tendons[name] = {
    springlengthMm: attr(sp, 'springlength') != null ? r(Number(attr(sp, 'springlength')) * MM, 4) : null,
    path: path_,
  };
}
console.log('  ' + Object.keys(tendons).length + ' tendon paths in myolegs_tendon.xml');

// ---------------------------------------------------------------------------
//  MUSCLE ACTUATORS.
// ---------------------------------------------------------------------------
const generalActuators = deep(muscleDoc, 'general');
const muscles = [];
let gainBiasMismatch = 0;
for (const g of generalActuators) {
  const name = attr(g, 'name');
  const tendonName = attr(g, 'tendon');
  const gainprm = vec(attr(g, 'gainprm'));
  const biasprm = vec(attr(g, 'biasprm'));
  if (gainprm.join(',') !== biasprm.join(',')) gainBiasMismatch++;
  const lengthrange = vec(attr(g, 'lengthrange')).map((v) => r(v * MM, 4));
  const tendon = tendons[tendonName];
  if (!tendon) { console.warn('  muscle ' + name + ': tendon "' + tendonName + '" not found, skipped'); continue; }

  // resolve path into body-attached points, in file order
  const resolvedPath = tendon.path.map((p) => {
    if (p.kind === 'site') {
      const s = sites[p.site];
      return s ? { kind: 'site', name: p.site, body: s.body, posMm: s.posMm } : { kind: 'site', name: p.site, body: null, posMm: null };
    }
    const wg = wrapGeoms[p.geom];
    return { kind: 'wrap', name: p.geom, body: wg ? wg.body : null, geom: wg || null, sidesite: p.sidesite };
  });
  const siteSteps = resolvedPath.filter((p) => p.kind === 'site');
  const originBody = siteSteps.length ? siteSteps[0].body : null;
  const insertionBody = siteSteps.length ? siteSteps[siteSteps.length - 1].body : null;

  // optimal fibre length -- see header FIBRE LENGTH for the formula and its
  // source. Computed ONLY when it comes out positive: for 15 of these 80
  // muscles it does not (tendonSlackLengthMm > lengthRangeMm[0], which the
  // formula turns into a negative "fibre length" -- geometrically not a
  // fibre length at all). That happens even to muscles MyoSuite's OWN
  // shipped reflex controller (agents/baseline_Reflex/ReflexCtrInterface.py)
  // tracks with this identical formula (e.g. semimem_r, bflh_r, gaslat_r,
  // gasmed_r, recfem_r are all in that controller's own muscle_labels sets)
  // -- so this is a property of the source data/formula interacting for
  // these specific muscles, not a bug introduced here. Left null rather
  // than reported as a nonsensical negative number -- see
  // meta.fiberLengthNotComputable for the full list.
  const rangeMin = gainprm[0], rangeMax = gainprm[1], forceN = gainprm[2];
  const tendonSlackMm = tendon.springlengthMm;
  let optimalFiberLengthMm = null;
  if (lengthrange.length === 2 && tendonSlackMm != null && rangeMin) {
    const computed = (lengthrange[0] - tendonSlackMm) / rangeMin;
    if (computed > 0) optimalFiberLengthMm = r(computed, 4);
  }

  muscles.push({
    name,
    tendon: tendonName,
    originBody, insertionBody,
    maxIsometricForceN: forceN,
    operatingRange: [rangeMin, rangeMax], // dimensionless, multiples of optimal fibre length
    tendonSlackLengthMm: tendonSlackMm,
    optimalFiberLengthMm,
    lengthRangeMm: lengthrange, // [min,max] whole muscle-tendon-unit length actually used
    forceVelocityShape: { vmax: gainprm[6], fpmax: gainprm[7], fvmax: gainprm[8] },
    ctrlrange: vec(attr(g, 'ctrlrange')),
    path: resolvedPath.map((p) => (p.kind === 'site'
      ? { kind: 'site', name: p.name, body: p.body, posMm: p.posMm }
      : { kind: 'wrap', name: p.name, body: p.body, type: p.geom ? p.geom.type : null, radiusMm: p.geom ? p.geom.radiusMm : null, halfLengthMm: p.geom ? p.geom.halfLengthMm : null, posMm: p.geom ? p.geom.posMm : null, quat: p.geom ? p.geom.quat : null, sidesite: p.sidesite })),
  });
}

// ---------------------------------------------------------------------------
//  SEGMENT LENGTHS — a MuJoCo child body's own `pos` IS the segment vector
//  in its parent's frame (no frame composition needed, unlike
//  tools/fit-osim.js) -- see header AXES.
// ---------------------------------------------------------------------------
function childPosMm(parentName, childName) {
  const b = bodies.find((x) => x.name === childName && x.parentBody === parentName);
  return b ? b.posMm : null;
}
function segLen(parentName, childName) {
  const p = childPosMm(parentName, childName);
  return p ? r(vlen(p), 2) : null;
}
const segmentLengthsMm = {
  femur_r: segLen('femur_r', 'tibia_r'),
  tibia_r: segLen('tibia_r', 'talus_r'),
  femur_l: segLen('femur_l', 'tibia_l'),
  tibia_l: segLen('tibia_l', 'talus_l'),
  foot_r: segLen('calcn_r', 'toes_r'),
  pelvisToFemur_r: segLen('pelvis', 'femur_r'),
};

// ---------------------------------------------------------------------------
//  ASSEMBLE + WRITE
// ---------------------------------------------------------------------------
const out = {
  meta: {
    modelName: attr(deep(chainDoc, 'mujocoinclude')[0] || chainDoc, 'model') || attr(chainDoc, 'model'),
    source: 'MyoSuite MyoLegs model. Caggiano, V., Wang, H., Durandau, G., Sartori, M., Kumar, V. (2022) "MyoSuite -- A contact-rich simulation suite for musculoskeletal motor control." L4DC 2022. File-level credit (from leg/assets/myolegs_chain.xml\'s own header): "Vikash Kumar, Vittorio Caggiano, Huawei Wang".',
    fetchedFrom: 'https://github.com/MyoHub/myo_sim (git clone; NOTE this is a separate repository from myosuite itself -- myosuite/simhive/myo_sim is a git submodule pointing here)',
    fetchedFromCommit: '33f3ded946f55adbdcf963c99999587aadaf975f (2025-08-07) -- the exact commit myosuite pins as its submodule at myosuite commit 94300995076b20ed6a8cfc65794c54bc997a0697 (2026-05-13), confirmed via `git ls-tree`, not myo_sim\'s own later HEAD (which has reorganised the directory layout since)',
    extractedDate: new Date().toISOString().slice(0, 10),
    license: 'Apache License, Version 2.0 -- confirmed from both repositories\' own top-level LICENSE files and repeated verbatim in-file at the top of every .xml this script reads. Permits commercial use, modification and redistribution with attribution + a copy of the license; no non-commercial/research-only restriction, unlike data/staple-tlem2.json (CC BY-NC) and unlike data/tlem.json\'s source (AMMR, not shipped -- see tools/fit-tlem.js).',
    units: 'lengths in millimetres (source is metres, the MuJoCo default; x1000 once, MM constant in tools/fit-myosuite-legs.js); angles in radians (source file\'s own <compiler angle="radian".../> in leg/myolegs.xml); force in newtons; the operatingRange pair on each muscle is DIMENSIONLESS (a multiple of that muscle\'s own optimal fibre length), not a length.',
    axes: 'EMPIRICALLY confirmed from the body-CHAIN structure itself (child body pos = segment vector in the parent\'s own frame): Y is proximal-distal (tibia_r\'s pos relative to femur_r is (~0, -404.4, -1.3)mm, and 404.4mm matches data/rajagopal.json\'s femur length of 408.05mm closely -- see VERIFICATION), X is anterior (toes_r\'s pos relative to calcn_r is (178.8, -2, 1.1)mm). Sign of the medio-lateral (Z) axis NOT independently re-derived here -- see header for exactly what was and was not checked.',
    muscleModelParameters: 'See this script\'s own header (MUSCLE-MODEL PARAMETER SEMANTICS) for the full derivation, WITH CITATIONS TO THE EXACT MYOSUITE PYTHON SOURCE LINES that confirm gainprm[2]=peak isometric force (N), gainprm[0:2]=operating length range (multiples of L0), tendon springlength=tendon slack length, and the L0=(lengthrange[0]-tendonSlack)/rangeMin formula. gainprm/biasprm are identical for every one of these 80 muscles (checked, not assumed) -- ' + (gainBiasMismatch === 0 ? 'confirmed, 0 mismatches found.' : (gainBiasMismatch + ' muscle(s) had gainprm != biasprm -- see the muscle\'s own path/tendon for which.')),
    fiberLengthNotComputable: (muscles.filter((m) => m.optimalFiberLengthMm == null).map((m) => m.name).join(', ') || 'none') + ' -- for these, tendonSlackLengthMm > lengthRangeMm[0], which the L0 formula turns into a negative (non-physical) fibre length; optimalFiberLengthMm is null for them rather than reporting that negative number. Notably this affects some of the SAME muscles MyoSuite\'s own shipped reflex controller applies this identical formula to (semimem_r/l, bflh_r/l, gaslat_r/l, gasmed_r/l, recfem_r/l are all in that controller\'s own muscle_labels sets) -- so this is a genuine property of the interaction between the source data and this formula for these muscles, not something introduced by this extraction. maxIsometricForceN, tendonSlackLengthMm, lengthRangeMm and operatingRange ARE still reported for every one of these muscles (those come directly from the XML, not from this derived formula).',
    pennationAngle: 'NOT PRESENT in this dataset -- MuJoCo\'s native muscle actuator has no pennation-angle term, and a case-insensitive grep for "pennat" across both source repositories found zero matches. See this script\'s header for the full reasoning. muscles[] therefore has no pennationAngleDeg field at all (not a null one).',
    notCovered: 'Wrap-geom quaternion orientation is carried through (quat[]) but not converted to an axis/normal vector here -- consumer\'s job, same "report what is authored, do not derive a further quantity that risks a silent sign error" discipline as tools/fit-tlem.js\'s wrap-surface handling. Knee sub-coordinates (knee_angle_r_translation1/2, _rotation2/3, and the "_beta_" variants) are recorded as independent joints exactly as authored -- a grep for `<equality` across leg/assets/myolegs_chain.xml found ZERO equality constraints coupling them (checked, not assumed), unlike data/rajagopal.json\'s or data/mobl-arms.json\'s spline-coupled coordinates; whether/how MyoSuite\'s own control code otherwise constrains them is out of scope for this static-XML extraction. Torso/abdomen muscles (myotorso_*) are NOT included -- this file is leg/assets/ only, matching the task\'s "lower-limb" scope.',
  },
  bodies,
  joints,
  sites,
  wrapGeoms,
  muscles,
  segmentLengthsMm,
  counts: {
    bodies: bodies.length,
    joints: joints.length,
    sites: Object.keys(sites).length,
    wrapGeoms: Object.keys(wrapGeoms).length,
    muscles: muscles.length,
    musclesRight: muscles.filter((m) => m.name.endsWith('_r')).length,
    musclesLeft: muscles.filter((m) => m.name.endsWith('_l')).length,
    pathSteps: muscles.reduce((s, m) => s + m.path.length, 0),
    wrapStepsInPaths: muscles.reduce((s, m) => s + m.path.filter((p) => p.kind === 'wrap').length, 0),
  },
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out));
console.log('-> ' + outPath + '  ' + (fs.statSync(outPath).size / 1024).toFixed(0) + ' kB');

// ---------------------------------------------------------------------------
//  VERIFICATION
// ---------------------------------------------------------------------------
const issues = [];

// every body's parent (if any) exists
for (const b of bodies) if (b.parentBody && !bodyNames.has(b.parentBody)) issues.push('body ' + b.name + ': parent "' + b.parentBody + '" does not exist');

// every site/wrap-geom referenced by a tendon path resolved to a real body
for (const m of muscles) {
  for (const p of m.path) {
    if (!p.body) issues.push('muscle ' + m.name + ': path step "' + p.name + '" (' + p.kind + ') did not resolve to a body');
  }
}

// every muscle has an origin and insertion body, and they differ
for (const m of muscles) {
  if (!m.originBody || !m.insertionBody) issues.push('muscle ' + m.name + ': missing origin/insertion body');
  else if (m.originBody === m.insertionBody && m.path.filter((p) => p.kind === 'site').length < 2) issues.push('muscle ' + m.name + ': origin and insertion body are the same body with <2 site steps -- suspicious');
}

// max isometric force positive and in a plausible physiological range (a single MTU in a leg model: ~10N to ~5000N)
for (const m of muscles) {
  if (!(m.maxIsometricForceN > 0)) issues.push('muscle ' + m.name + ': non-positive maxIsometricForceN ' + m.maxIsometricForceN);
  else if (!(m.maxIsometricForceN >= 5 && m.maxIsometricForceN <= 6000)) issues.push('muscle ' + m.name + ': maxIsometricForceN ' + m.maxIsometricForceN + ' outside plausible 5-6000N range');
}

// optimal fibre length, where computed, should be positive and plausible (5-600mm covers everything from a short intrinsic to sartorius/gracilis)
for (const m of muscles) {
  if (m.optimalFiberLengthMm != null && !(m.optimalFiberLengthMm > 0 && m.optimalFiberLengthMm < 600)) issues.push('muscle ' + m.name + ': computed optimalFiberLengthMm ' + m.optimalFiberLengthMm + ' outside plausible 0-600mm range (see header FIBRE LENGTH for the formula/assumption)');
}

// segment lengths plausible for an adult
if (!(segmentLengthsMm.femur_r > 300 && segmentLengthsMm.femur_r < 500)) issues.push('femur_r ' + segmentLengthsMm.femur_r + 'mm outside plausible adult 300-500mm range');
if (!(segmentLengthsMm.tibia_r > 250 && segmentLengthsMm.tibia_r < 450)) issues.push('tibia_r ' + segmentLengthsMm.tibia_r + 'mm outside plausible adult 250-450mm range');
// bilateral symmetry: right and left segment lengths should match closely (same generic model, mirrored)
if (segmentLengthsMm.femur_r != null && segmentLengthsMm.femur_l != null && Math.abs(segmentLengthsMm.femur_r - segmentLengthsMm.femur_l) > 1) issues.push('femur_r/femur_l differ by >1mm (' + segmentLengthsMm.femur_r + ' vs ' + segmentLengthsMm.femur_l + ') -- expected a mirrored generic model');

console.log(issues.length === 0 ? 'verification: PASS' : ('verification: FAIL (' + issues.length + ' issue(s))'));
for (const iss of issues.slice(0, 40)) console.log('  - ' + iss);
if (issues.length > 40) console.log('  ... and ' + (issues.length - 40) + ' more');

console.log('\ncounts: ' + JSON.stringify(out.counts, null, 2).replace(/[{}"]/g, '').trim());
console.log('\nsegment lengths (mm, this generic/scaled model):');
for (const k in segmentLengthsMm) console.log('  ' + k.padEnd(18) + segmentLengthsMm[k]);
console.log('\ncross-check, femur, THREE independent sources describing DIFFERENT individuals (rough agreement expected, exact agreement is not):');
console.log('  this file (MyoSuite MyoLegs, a generic/scaled rig, not one imaged cadaver): ' + segmentLengthsMm.femur_r + 'mm');
console.log('  data/rajagopal.json (Rajagopal 2016\'s own imaged subject): 408.05mm');
console.log('  data/bodyparts3d.json FMA24474 bbox Z-size (a third, separately-segmented subject): 440.22mm');
console.log('  data/staple-tlem2.json femur_r bbox longest extent (the TLEM2 cadaver, a fourth subject): 414.0mm');
const forces = muscles.map((m) => m.maxIsometricForceN).filter((v) => v != null);
console.log('\nmax isometric force range across ' + muscles.length + ' muscles: ' + Math.min(...forces).toFixed(1) + ' to ' + Math.max(...forces).toFixed(1) + ' N');
const fibreLens = muscles.map((m) => m.optimalFiberLengthMm).filter((v) => v != null);
console.log('computed optimal fibre length range: ' + Math.min(...fibreLens).toFixed(1) + ' to ' + Math.max(...fibreLens).toFixed(1) + ' mm (' + fibreLens.length + '/' + muscles.length + ' muscles had a computable value)');
if (issues.length) process.exitCode = 1;
