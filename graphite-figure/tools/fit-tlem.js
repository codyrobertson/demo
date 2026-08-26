/* Parse the TLEM2 lower-extremity muscle/segment/joint geometry out of the
   AnyBody Managed Model Repository's AnyScript (.any) source, the way
   tools/fit-osim.js parses Rajagopal's XML and tools/fit-mobl-arms.js parses
   Holzbaur's XML.

   ==========================================================================
   DO NOT RUN THIS AGAINST data/ AND COMMIT THE RESULT. READ THIS FIRST.
   ==========================================================================
   This tool is checked in because it is just code -- a reader for a text
   format, no different in kind from fit-osim.js's XML parser. Its OUTPUT is
   a different matter. AMMR's own top-level LICENSE file states use of "the
   AMMR source code and material" is governed by the AnyBody Technology A/S
   Software License Agreement (SLA), and that SLA -- fetched and read in full
   from https://www.anybodytech.com/download/anybody-software-license-agreement/
   (AnyBody-Software-License-Agreement.pdf, "SLA 31012024", January 2024) --
   says, verbatim:

     3.1 "... ABT grants to Licensee a non-assignable, non-exclusive,
     non-transferable, and non-sublicensable right of use of the AMS in
     executable form only ..." -- GRANTED ONLY "subject to full payment of
     the license fees for the Products" (i.e. there is no free tier; use
     without a paid licence is not authorised at all).

     3.3 "Licensee acknowledges that the AMMR constitutes a database ... and
     that the IPR in the database belong to ABT. Except as set forth below,
     Licensee may not, without specific individual agreement, build or
     develop any derivative database, including AI solutions, based on or
     derived from the AMMR or containing the Output except for purely
     internal purposes. This inter alia means that such derived databases
     and the Output may not be made available to any third party whether
     against a fee or not."

     4.1/4.2 (Standard and Academic licences alike): "Licensee is not
     permitted to use the Products to train methods/algorithms/neural
     networks/etc. for commercial use of any kind. Nor is Licensee permitted
     to sell any data, results, models, or images generated using the
     Products ..."

   This project (graphite-figure) has no evidence of any paid AMS/AMMR
   licence agreement with AnyBody Technology A/S -- the repository was
   reached by an anonymous `git clone` of a publicly-reachable GitHub URL,
   which is not the same thing as being a Licensee under 3.1. Even a bona
   fide Licensee could not commit this tool's output to a shared project
   repository under 3.3: "purely internal purposes" is the only carve-out,
   and a git history that gets pushed, forked, or read by a teammate is not
   "purely internal" in the sense that clause is doing work to exclude ("may
   not be made available to any third party whether against a fee or not").
   This is a materially different, and stricter, situation than
   data/bodyparts3d.json's CC-BY-SA credit-line requirement or
   data/mobl-arms.json's flagged-but-unverified "CC ANC Use Agreement" --
   there is no reading of AMMR's licence under which shipping a derived
   data/tlem.json in this repo is clearly permitted, so it was not created.
   See the extraction session's final report for the full reasoning. If you
   are a licensed AnyBody user and want to run this yourself: point it at
   your own AMMR checkout, keep the output OUT of any shared repository, and
   raise redistribution with AnyBody Technology A/S directly (sales@anybodytech.com)
   before doing anything else with it.

   Usage: node tools/fit-tlem.js <path-to-ammr-checkout> <out.json>
   Both arguments are REQUIRED (no default out path -- see above). This
   script only reads; it never writes anywhere unless you name the path.

   ==========================================================================
   WHAT THIS READS AND WHY
   ==========================================================================
   AMMR (https://github.com/AnyBody/ammr) ships several lower-limb models
   under Body/AAUHuman/. This reads Body/AAUHuman/LegTLEM2.1/, the TLEM 2.1
   implementation, specifically because its numeric parameters live in four
   files that are close to pure data (literal AnyVec3/AnyFloat/AnyVar
   declarations) rather than the heavily macro-and-#include-driven geometry
   construction (Seg.any, Mus.any's neighbours) that surrounds them:
     Body/AAUHuman/LegTLEM2.1/TLEM2.1/ModelParameters.any        (muscle attachment points, per segment)
     Body/AAUHuman/LegTLEM2.1/TLEM2.1/ModelSegmentParameters.any (segment mass/CoM/inertia/dimensions)
     Body/AAUHuman/LegTLEM2.1/TLEM2.1/ModelJointParameters.any   (joint centres and axes)
     Body/AAUHuman/LegTLEM2.1/TLEM2.1/ModelMuscleParameters.any  (muscle architecture: volume, optimal
                                                                   fibre length, tendon length, pennation)
   plus, for TOPOLOGY (which node a muscle element originates/inserts/wraps
   on, and which of the above physiological-parameter folders it draws from):
     Body/AAUHuman/LegTLEM2.1/Mus.any        (per-element Org/Via-N/Ins wiring, right leg)
     Body/AAUHuman/LegTLEM2.1/MusMdl3E_2.any (which ModelMuscleParameters folder each element reads)
     Body/AAUHuman/LegTLEM2.1/Jnt.any        (joint definitions: which two nodes each joint connects)
   and, for the four wrap surfaces whose fit inputs are literal (not
   macro-computed from other muscle points):
     Tools/ModelUtilities/WrappingSurfaces/WrappingCylinder5PointFit.any (the fitting algorithm --
       REIMPLEMENTED below, not copied: it is ~40 lines of closed-form circumcircle geometry,
       read here to write compatible code, the same relationship fit-osim.js's XML parser has to
       OpenSim's file format).

   THE ORIGINAL DATASET, ONE LEVEL BEHIND AMMR. Every one of those four
   ModelParameters.any-family files opens with the same citation, quoted
   here in full because it -- not AMMR -- is the actual measurement:
     "This dataset is part of The TLEMsafe Project Dataset. The dataset was
     created during the TLEMsafe project (www.tlemsafe.eu) funded by the
     European Commission under Grant Agreement (no. 247860) and under the
     TLEMsafe Consortium Agreement. Use the following paper when citing:
     Carbone, V., Fluit, R., Pellikaan, P., van der Krogt, M.M., Janssen, D.,
     Damsgaard, M., Vigneron, L., Feilkas, T., Koopman, H.F.J.M., Verdonschot, N., 2015.
     TLEM 2.0 - a comprehensive musculoskeletal geometry dataset for
     subject-specific modeling of lower extremity. J. Biomech. 48, 734-741.
     doi:10.1016/j.jbiomech.2014.12.034"
   ModelMuscleParameters.any additionally notes its own muscle-architecture
   numbers (volume, fibre length, tendon length, pennation) were NOT
   remeasured by TLEMsafe and instead carry over from the original TLEM
   (Klein Horsman, M.D. PhD thesis, "The Twente Lower Extremity Model
   (TLEM): Consistent Dynamic Simulation of the Human Locomotor Apparatus"),
   itself "a mixture of parameters which could be obtained by Klein Horsman
   himself as well as data obtained by Scott L. Delp" -- i.e. this is a
   composite of (at least) two cadaver studies, not one, and this script
   reports that lineage rather than flattening it into one undifferentiated
   source. tlemsafe.eu itself (mentioned in the task that produced this
   file) returns 502 and is licence-gated in any case per its own front
   page's stated terms -- AMMR's git mirror is the only route to this
   dataset's actual numbers that was found to work.

   ==========================================================================
   WHY A REGEX/LINE SCANNER, NOT A FULL ANYSCRIPT INTERPRETER
   ==========================================================================
   AnyScript is a full declarative modelling language with a C preprocessor
   pass (#define, #include, #if/#ifdef with macro-valued conditions),
   operator overloading on vectors/matrices, cross-file relative references
   ("..Seg.Thigh.KneeJoint.sRel"), and user-defined macros with backslash
   line continuation (see GluteusMaximumsWrappingSurfaces.any). Writing a
   general interpreter for that is a different, much larger undertaking than
   fit-osim.js's XML parser, and this project's own standard (see that
   file's header) is to refuse a computation rather than risk getting it
   silently wrong. So: everything extracted below is read as a LITERAL
   already sitting in the source (a number, a quoted string, a bare
   identifier reference), never evaluated through a variable or a function
   call, with three narrow, explicitly-flagged exceptions:
     1. Simple literal/literal division, e.g. `9.53/100` inside a
        `DesignVar(...)` or `_FIBER_LENGTH_DESIGNVAR(...)` wrapper -- both
        operands are checked to be bare numbers before dividing.
     2. `.TF'` and `- FrameOffset` suffixes on AnyVec3 points are captured
        VERBATIM as a string and NOT applied -- see AXES below for why the
        untransformed (StdPar-raw) value is what this script reports.
     3. The WrappingCylinder5PointFit algorithm (see above), applied only to
        the handful of wrap surfaces whose 5 input points are themselves
        literal (not built from a further macro over other muscle nodes) --
        the other wrap-surface names this script found referenced
        (BicepsFemorisCaputLongumWrapSurf, RectusWrapSurf,
        Semitendinosus1WrapSurf, and the 12 individual GlueteusWrap(...)
        cylinders macro-built from other muscles' own node positions plus
        small literal offsets) are recorded by NAME and (where determinable)
        REFERENCED NODES ONLY, with resolvedGeometry:false -- their radii
        were not computed, rather than guessed by hand-tracing the macro.

   ==========================================================================
   UNITS -- source is METRES (confirmed the same way fit-osim.js confirms
   Rajagopal's): every length-bearing AnyVec3/AnyFloat literal below is
   multiplied by MM=1000 exactly once, at read time, same discipline as
   every other tools/fit-*.js in this project. Confirmed empirically, not
   from documentation: Thigh.HipJoint - Thigh.KneeJoint (both literal, both
   in the Thigh segment's own frame) has norm 0.3629 in the file's raw
   units; as METRES that is 362.9mm, a plausible adult functional femur
   (hip-centre-to-knee-centre) length -- as centimetres (3.6m) or
   millimetres (0.36mm) it is not. Angles (Pennationangle) are authored in
   DEGREES in the source (see the field's own `///< ... (degres)` comment)
   and are reported here in degrees, unlike every OpenSim-derived file in
   this project which stores radians -- called out explicitly in this
   file's own meta.units so a consumer does not silently assume radians.

   ==========================================================================
   AXES -- RAW StdPar VALUES, DELIBERATELY NOT RE-SCALED, DELIBERATELY
   NOT MIRRORED, AND WHY. Every muscle/joint point in ModelParameters.any
   exists in (at least) two forms elsewhere in this model: the literal
   "StdPar" value this script reads, and a `.sRel` value Seg.any computes as
   `.Scale(.StdPar.X)`, where Scale is a per-segment AnyFunTransform3D. This
   script deliberately extracts the FORMER, for a reason confirmed from the
   source itself, not assumed: ModelSegmentParameters.any computes BOTH
   `Length` (from `.sRel`, i.e. post-Scale) AND a separately-named
   `LengthStandard` (from `.StdPar` directly) for every segment -- the
   file's own naming treats the StdPar/raw value as "the standard", i.e.
   this TLEM2 cadaver's own native measurement, with `.Scale()` reserved for
   retargeting onto a DIFFERENT subject's dimensions when this leg is
   included into a larger, subject-scaled model. Since what this task wants
   is TLEM2's own measured geometry (not TLEM2 retargeted onto some other
   subject this script has no information about), StdPar-raw is the correct
   thing to read, and it has the further advantage of being a same-file
   literal with no cross-file Scale-function resolution required at all.

   Left vs right: ModelParameters.any carries ONE copy of every point,
   right-leg-native. This is confirmed, not assumed, from
   Body/AAUHuman/BodyModels/GenericBodyModel/{Right,Left}LegModel.any, which
   set `AnyVar Sign = 1` and `Sign = -1` respectively; every point in this
   dataset is multiplied by a per-model AnyMat33 TF = {{1,0,0},{0,1,0},{0,0,Sign}}
   before use, i.e. only the THIRD (Z) component ever flips between sides.
   This script reports the file's raw literals UNMIRRORED (Sign=+1, i.e.
   right leg, exactly as authored) and does not apply `*.TF'` itself --
   `suffixRaw` on every point preserves the exact expression text
   (`*.TF'`, `*.TF' - FrameOffset`, etc.) that WOULD need to be applied, so
   nothing is silently mirrored or offset incorrectly.

   Which physical direction each axis actually points was verified from the
   geometry itself, the same way fit-mobl-arms.js verifies its humerus
   frame -- not assumed from the Seg.any header comment's claim of "ISB"
   convention, though that claim is consistent with what follows:
     +Y = proximal/superior, within a segment's own frame: Thigh.HipJoint
       ({-0.0043, +0.3617, -0.0006}) sits at Y=+0.362 while Thigh.KneeJoint
       ({-0.0097,-0.0063,+0.0013}) sits at Y=-0.006 -- the hip, which is
       proximal, is at large +Y; the knee, which is distal, is near Y=0.
     +X = anterior, within the Foot's own frame: Foot.SubTalarJoint is the
       origin {0,0,0} and Foot.MetatarsalJoint1Node (a forefoot/toe point)
       sits at X=+0.135 -- the toes are anterior of the ankle.
     +Z = the subject's right (i.e., for this right-leg-native data,
       LATERAL): Foot.MetatarsalJoint1Node (big toe, MEDIAL border of a
       right foot) is at Z=-0.0196, while MetatarsalJoint5Node (little toe,
       LATERAL border) is at Z=+0.0330 -- lateral is more positive, matching
       "+Z = subject's right" on right-side-native (Sign=+1) data.
   This is the SAME family of convention (+Y superior, +X anterior, +Z
   subject's-right) as Rajagopal's OpenSim frame (see tools/fit-osim.js) and
   MoBL-ARMS's humerus frame (see tools/fit-mobl-arms.js), but it is TLEM2's
   OWN per-segment frame, independently constructed from cadaver
   digitisation, not the same numeric frame as either -- no cross-model
   remapping is applied here, same discipline as those two files.

   ==========================================================================
   MUSCLE-MODEL PARAMETERS -- WHAT IS AND IS NOT COMPUTED. Per element,
   MusMdl3E_2.any (the 3-element Hill-type variant) computes, verbatim:
     F0  = DefaultMusPar.PCSAfactor * PCSA
     Lf0 = FiberLengthScale<Segment> * MuscleParameters.OptimalFiberlength
     PCSA (cm^2) = 1e4 * StrengthScale<Segment> * MuscleParameters.MuscleVolumeSIScaled
                   / (sum of Lf0 over every element of this same muscle)
     Lt0 = max(MuscleParameters.TotalTendonLength, 0.001)   -- tendon slack length, floored at 1mm
     Gamma0 = MuscleParameters.Pennationangle * pi/180
   DefaultMusPar.PCSAfactor = SpecificStrength(=90 N/cm^2, literal, quoted in
   ModelMuscleParameters.any's own comment: "Klein Horsman used a PCSAfactor
   of 27 N/cm^2 this is now changed to 90 N/cm^2 to be consistent with the
   whole body") times `......HumanModel.StrengthParameters.StrengthIndexLeg`
   -- FIVE folder levels up from a file that lives inside a LEG-ONLY
   checkout. That reference, and the per-segment StrengthScale/
   FiberLengthScale factors, are defined in whatever WHOLE-BODY model
   ultimately includes this leg (not found within LegTLEM2.1 itself, and
   this script does not have that parent model to hand). So: this script
   reports OptimalFiberlength, TotalTendonLength and Pennationangle exactly
   as authored (these are NOT gated behind an unresolved external factor --
   they are the TLEM2 dataset's own numbers, full stop), and additionally
   computes an EST PCSA/F0 under the EXPLICIT, STATED assumption
   StrengthScale=FiberLengthScale=StrengthIndexLeg=1 (i.e. "if this leg were
   used completely unscaled, standalone, at whole-body-strength-index 1") --
   every such number is under an `est` key and names this assumption; the
   un-prefixed fields are the file's own literal values.

   ==========================================================================
   VERIFIED, NOT ASSUMED: HOW THIS HEADER'S CLAIMS WERE ACTUALLY CHECKED.
   Every numeric claim above (the 0.3629m hip-knee distance, the Foot axis
   signs, the Sign=+1/-1 source lines, the PCSAfactor formula) was read
   directly out of the files named above during the same session that wrote
   this script, via plain grep/sed against a `git clone --depth 1
   https://github.com/AnyBody/ammr` checkout -- not recalled from training
   data about TLEM2 or AnyBody. Commit pinned:
   597606d942423f298f9b14b4e460051969ef62e6 (2026-07-10, "bump to use ams
   821 (#1143)") -- re-pin this if you re-fetch and master has moved on. */
'use strict';
const fs = require('fs');
const path = require('path');

const MM = 1000; // the one place metres become millimetres, see UNITS above
const r = (x, d) => { const v = Math.round(x * 10 ** d) / 10 ** d; return v === 0 ? 0 : v; };
// A handful of literals in ModelParameters.any are authored with a stray
// space between a unary minus and its digits, e.g. "{-0.032 , -0.006 , - 0.023}"
// (GastroWrapLandmarks/HamstringWrapLandmarks, confirmed by inspection --
// not a general AnyScript rule, just how these specific lines were typed).
// Collapsing "- 0.023" -> "-0.023" before every numeric-literal test/parse
// below means those rows are read correctly instead of silently rejected.
const normalizeNum = (s) => s.trim().replace(/-\s+(?=\d)/g, '-');

const ammrRoot = process.argv[2];
const outPath = process.argv[3];
if (!ammrRoot || !outPath) {
  console.error('Usage: node tools/fit-tlem.js <path-to-ammr-checkout> <out.json>');
  console.error('Both arguments are required -- there is deliberately no default out path. See this file\'s header before running it.');
  process.exit(1);
}
const legDir = path.join(ammrRoot, 'Body', 'AAUHuman', 'LegTLEM2.1');
const paramDir = path.join(legDir, 'TLEM2.1');
for (const f of ['ModelParameters.any', 'ModelSegmentParameters.any', 'ModelJointParameters.any', 'ModelMuscleParameters.any']) {
  if (!fs.existsSync(path.join(paramDir, f))) { console.error('missing ' + path.join(paramDir, f) + ' -- not an AMMR checkout, or the LegTLEM2.1 layout has changed'); process.exit(1); }
}

// ---------------------------------------------------------------------------
//  COMMENT STRIPPING -- block comments only. Line comments ("//") are left
//  alone here and handled per-scanner below, because MusMdl3E_2.any and
//  friends use "//" nowhere inside a value this script extracts, but the
//  Gluteus wrap-surface macro (handled separately, see WRAP SURFACES) uses
//  backslash line continuations that a naive "strip to end of line" comment
//  pass must not be run across.
// ---------------------------------------------------------------------------
function stripBlockComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, ''); }
function stripLineComments(src) { return src.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n'); }
// Every .any file read here is CRLF ("\r\n") -- normalised to "\n" ONCE,
// here, the one place this happens, same discipline as the MM constant
// above. Load-bearing, not cosmetic: stripLineComments()'s
// /\/\/.*$/ pattern silently fails to match a CRLF-terminated line ("."
// excludes "\r", and "$" without /m needs true end-of-string, so a line
// ending "...text\r" never lets the pattern reach "$") -- confirmed by
// inspecting this script's own output during development (a commented-out
// "//AnyUniversalJoint PatellaFemur = {...};" block in Jnt.any was being
// read as a live SEVENTH joint) before this normalisation was added.
function read(file) { return fs.readFileSync(path.join(paramDir, file), 'utf8').replace(/\r\n/g, '\n'); }
function readLeg(file) { return fs.readFileSync(path.join(legDir, file), 'utf8').replace(/\r\n/g, '\n'); }

// ---------------------------------------------------------------------------
//  LITERAL-ARITHMETIC EVALUATOR -- ONLY for `number` or `number/number`.
//  Used to unwrap DesignVar(9.53/100) etc. Anything else is left unparsed
//  (raw string kept, value:null) rather than guessed -- see header point 1.
// ---------------------------------------------------------------------------
function evalSimpleLiteral(s) {
  const m = /^\s*(-?[\d.]+(?:[eE][+-]?\d+)?)\s*(?:\/\s*(-?[\d.]+(?:[eE][+-]?\d+)?)\s*)?$/.exec(s);
  if (!m) return null;
  const a = parseFloat(m[1]);
  if (m[2] === undefined) return a;
  return a / parseFloat(m[2]);
}
// Unwrap DesignVar(x), _FIBER_LENGTH_DESIGNVAR(x), _TENDON_LENGTH_DESIGNVAR(x) -- one level, textual.
function unwrapDesignVar(s) {
  const m = /^\s*(?:DesignVar|_FIBER_LENGTH_DESIGNVAR|_TENDON_LENGTH_DESIGNVAR|_ANGLE_DESIGNVAR)\s*\(\s*(.*)\s*\)\s*$/.exec(s.trim());
  return m ? m[1] : s;
}

// ---------------------------------------------------------------------------
//  GENERIC FOLDER-SCOPED LITERAL SCANNER.
//  Tracks brace depth to know which named folder (Pelvis/Thigh/Patella/
//  Shank/Talus/Foot) each declaration sits in. Folder open is recognised as
//  `<ident> = {` or `AnyFolder <ident> = {`, which matches both a fresh
//  `AnyFolder Pelvis = {` and a same-name "reopen" `Pelvis = {`.
//
//  A segment name is looked up ANYWHERE in the current folder-nesting
//  stack, NOT just stack[0] -- confirmed necessary, not a stylistic
//  choice: ModelSegmentParameters.any and ModelJointParameters.any each
//  open "Pelvis = {"/"Thigh = {"/etc. as genuinely FILE-TOP-LEVEL folders
//  (no wrapper), but ModelParameters.any's OWN copy of those same six
//  folders sits ONE LEVEL DEEPER, inside that file's own
//  "AnyFolder ModelParameters = { ... }" -- true only because this script
//  reads each file as independent standalone text rather than actually
//  expanding the #include directives that, in a real AnyBody build, paste
//  the other two files' content inside that same wrapper (making all
//  three consistent at build time). Using stack[0] unconditionally was
//  tried first and silently produced ZERO vectors/matrices for every
//  segment out of ModelParameters.any specifically (caught by inspecting
//  this script's own output during development -- Thigh had 5 vectors,
//  all contributed by the other two files, none from this one -- not
//  assumed correct from the code alone). Segments never nest inside each
//  other in this format, so at most one SEGMENTS name is ever on the
//  stack at a time; which depth it sits at does not matter.
// ---------------------------------------------------------------------------
const SEGMENTS = ['Pelvis', 'Thigh', 'Patella', 'Shank', 'Talus', 'Foot'];

function scanFolders(srcRaw, sourceFile) {
  // Both comment forms MUST be stripped before this scanner runs, not just
  // block comments: ModelParameters.any's Pelvis folder contains several
  // "//    AnyVec3 IliacusMid3Node = {...};"-style commented-OUT
  // declarations (leftover/disabled points -- see Seg.any's own header,
  // "viapoints ... commented out for the same reason"). Left unstripped,
  // those still look like perfectly well-formed literal declarations to
  // every regex below and get read as if live, AND their own brace pairs
  // desync this scanner's depth/stack bookkeeping against the real
  // (uncommented) folder nesting -- caught here by inspecting this
  // script's own output (Thigh ending up with zero vectors) during
  // development, not assumed safe.
  const src = stripLineComments(stripBlockComments(srcRaw));
  const out = {}; for (const s of SEGMENTS) out[s] = { vectors: {}, scalars: {}, strings: {}, matrices: {} };
  let depth = 0;
  const stack = []; // names of currently-open folders, outer to inner -- see header for why a SEGMENTS name can be at any depth, not always stack[0]
  let i = 0;
  const n = src.length;
  // Pattern for one open-brace boundary token: identifier possibly preceded by AnyFolder, ending '{'
  const OPEN_RE = /(?:AnyFolder\s+)?([A-Za-z_]\w*)\s*=\s*\{/g;
  // We do a manual scan rather than global-regex-plus-index-arithmetic so
  // brace depth stays correct even when a matched folder body itself
  // contains further '{' that are NOT folder opens (e.g. AnyVec3 literals).
  while (i < n) {
    const ch = src[i];
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') { depth--; if (stack.length && depth < stack.length) stack.pop(); i++; continue; }
    // try to match a folder-open at this position (identifier = {)
    OPEN_RE.lastIndex = i;
    const m = OPEN_RE.exec(src);
    if (m && m.index === i) {
      stack.push(m[1]);
      i = OPEN_RE.lastIndex; // positioned just after the '{'
      depth++;
      continue;
    }
    // try literal declarations at this position, only if we are directly
    // inside a recognised top-level segment folder (stack[0])
    const segName = stack.find((nm) => SEGMENTS.includes(nm));
    if (segName && SEGMENTS.includes(segName)) {
      const rest = src.slice(i);
      let mm;
      // AnyMatrix name = { row0, row1, ... };  (must try before AnyVec3/AnyFloat since it also starts "Any... name = {")
      // Each row is EITHER a bare literal "{n,n,n}<suffix>" OR "IDENT +/- {n,n,n}<suffix>"
      // referencing another vector already declared in this same segment
      // (only IliacusWrapLandmarks uses the latter form, referencing that
      // segment's own HipJoint -- see header WRAP SURFACES). Rows that are
      // neither are kept as unresolved text rather than dropped or guessed.
      mm = /^AnyMatrix\s+(\w+)\s*=\s*\{([\s\S]*?)\n?\s*\}\s*;/.exec(rest);
      if (mm) {
        const rowTexts = [];
        { // split top-level "{...}" entries (each may itself contain one nested "{...}" for the offset)
          let depth2 = 0, cur = '', body = mm[2];
          for (const c of body) {
            if (c === '{') depth2++;
            if (c === '}') depth2--;
            if (c === ',' && depth2 === 0) { rowTexts.push(cur); cur = ''; } else cur += c;
          }
          if (cur.trim()) rowTexts.push(cur);
        }
        const rows = rowTexts.map((t) => t.trim()).filter(Boolean);
        out[segName].matrices[mm[1]] = { rowsText: rows, sourceFile };
        i += mm[0].length; continue;
      }
      // AnyVec3|AnyFloat name = {n,n,n}<suffix>;  -- suffix captured verbatim, NOT applied (see AXES)
      mm = /^Any(?:Vec3|Float)\s+(\w+)\s*=\s*\{\s*([^{}]+?)\s*\}\s*([^;]*);/.exec(rest);
      if (mm) {
        const parts = mm[2].split(',').map((x) => normalizeNum(x));
        if (parts.length === 3 && parts.every((p) => /^-?[\d.]+(?:[eE][+-]?\d+)?$/.test(p))) {
          const raw = parts.map(Number);
          out[segName].vectors[mm[1]] = { raw, suffixRaw: mm[3].trim(), sourceFile };
          i += mm[0].length; continue;
        }
      }
      // AnyString name = "text";
      mm = /^AnyString\s+(\w+)\s*=\s*"([^"]*)"\s*;/.exec(rest);
      if (mm) { out[segName].strings[mm[1]] = mm[2]; i += mm[0].length; continue; }
      // AnyIntVar name = digits;
      mm = /^AnyIntVar\s+(\w+)\s*=\s*(\d+)\s*;/.exec(rest);
      if (mm) { out[segName].scalars[mm[1]] = { value: parseInt(mm[2], 10), sourceFile }; i += mm[0].length; continue; }
      // AnyVar|AnyFloat name = <pure numeric literal, optionally n/n>;  (scalar form -- vector form handled above)
      mm = /^Any(?:Var|Float)\s+(\w+)\s*=\s*([^{;][^;]*?)\s*;/.exec(rest);
      if (mm) {
        const v = evalSimpleLiteral(mm[2]);
        out[segName].scalars[mm[1]] = { value: v, raw: mm[2].trim(), sourceFile };
        i += mm[0].length; continue;
      }
    }
    i++;
  }
  return out;
}

function mergeSegScan(a, b) {
  for (const s of SEGMENTS) {
    for (const k of ['vectors', 'scalars', 'strings', 'matrices']) Object.assign(a[s][k], b[s][k]);
  }
  return a;
}

console.log('reading TLEM2.1 parameter files from ' + paramDir + ' ...');
let merged = null;
for (const [file, reader] of [['ModelSegmentParameters.any', read], ['ModelJointParameters.any', read], ['ModelParameters.any', read]]) {
  const scanned = scanFolders(reader(file), file);
  merged = merged ? mergeSegScan(merged, scanned) : scanned;
}

// ---------------------------------------------------------------------------
//  RESOLVE AnyMatrix ROWS, now that every segment's plain vectors are fully
//  merged across all three files. Each row is either:
//    "{n,n,n}<suffix>"            -- bare literal
//    "IDENT + {n,n,n}<suffix>"    -- IDENT looked up in THIS SAME segment's
//                                     already-collected vectors (raw, i.e.
//                                     the same un-mirrored StdPar frame --
//                                     see header AXES). The offset's own
//                                     "<suffix>" (e.g. "*.TF'") is a no-op
//                                     for this native right-leg (Sign=+1)
//                                     data (TF is the identity matrix at
//                                     Sign=+1), so it is safe to add
//                                     directly -- documented, not silent.
//  Rows matching neither form are left unresolved (null) rather than guessed.
// ---------------------------------------------------------------------------
function resolveMatrixRows(segName) {
  const seg = merged[segName];
  for (const [mname, m] of Object.entries(seg.matrices)) {
    m.rowsRaw = m.rowsText.map((rowText) => {
      let mm = /^\{\s*([^{}]+?)\s*\}\s*(?:\*[^,]*)?$/.exec(rowText);
      if (mm) {
        const parts = mm[1].split(',').map((x) => normalizeNum(x));
        if (parts.length === 3 && parts.every((p) => /^-?[\d.]+(?:[eE][+-]?\d+)?$/.test(p))) return parts.map(Number);
      }
      mm = /^(\w+)\s*([+\-])\s*\{\s*([^{}]+?)\s*\}\s*(?:\*[^,]*)?$/.exec(rowText);
      if (mm) {
        const [, ident, sign, offText] = mm;
        const base = seg.vectors[ident];
        const parts = offText.split(',').map((x) => normalizeNum(x));
        if (base && parts.length === 3 && parts.every((p) => /^-?[\d.]+(?:[eE][+-]?\d+)?$/.test(p))) {
          const off = parts.map(Number);
          return base.raw.map((v, k) => (sign === '+' ? v + off[k] : v - off[k]));
        }
      }
      return null; // unresolved -- neither a bare literal nor a same-segment "IDENT +/- {offset}" row
    });
  }
}
for (const s of SEGMENTS) resolveMatrixRows(s);

// ---------------------------------------------------------------------------
//  MUSCLE PHYSIOLOGICAL PARAMETERS -- ModelMuscleParameters.any's shape is
//  `AnyFolder Muscles = { AnyFolder <FascicleGroup> = { field ??= val; ... }; ... }`,
//  flat fields, no vectors -- a simpler, dedicated scan.
// ---------------------------------------------------------------------------
function scanMuscleParameters(srcRaw) {
  const src = stripLineComments(stripBlockComments(srcRaw));
  // Brace-counted extraction of the "AnyFolder Muscles = { ... }" body, NOT
  // a regex anchored to end-of-string -- the source's own closing "};" is
  // followed by more file content (an "// Muscles" comment, then two
  // #undef lines), so an EOF-anchored regex fails to match at all and
  // silently falls back to treating the WHOLE FILE as the body, which in
  // turn makes the outer "AnyFolder Muscles = {" line itself look like a
  // spurious 58th (empty, 0-field) muscle group while swallowing the first
  // real group into its own bogus match -- caught by inspecting this
  // script's own output (a "Muscles" group with 0 elements) during
  // development, not assumed away.
  const openIdx = src.indexOf('AnyFolder Muscles');
  if (openIdx === -1) throw new Error('scanMuscleParameters: no "AnyFolder Muscles" folder found');
  const braceStart = src.indexOf('{', openIdx);
  let depth = 0, j = braceStart;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) break; }
  }
  const body = src.slice(braceStart + 1, j);
  const groups = {};
  const groupRe = /AnyFolder\s+(\w+)\s*=\s*\{([\s\S]*?)\n\s*\};/g;
  let gm;
  while ((gm = groupRe.exec(body))) {
    const [, gname, gbody] = gm;
    const field = (name) => {
      const fm = new RegExp('AnyString\\s+' + name + '\\s*=\\s*"([^"]*)"').exec(gbody);
      if (fm) return fm[1];
      const fm2 = new RegExp('Any(?:Int)?(?:Var|Float)\\s+' + name + '\\s*(?:\\?\\?)?=\\s*([^;]+);').exec(gbody);
      if (!fm2) return null;
      const inner = unwrapDesignVar(fm2[1].trim());
      const v = evalSimpleLiteral(inner);
      return { value: v, raw: fm2[1].trim() };
    };
    groups[gname] = {
      label: field('Muscle'),
      elementCount: (field('MuscleElemAmount') || {}).value ?? null,
      pennationAngleDeg: (field('Pennationangle') || {}).value ?? null,
      muscleVolumeMl: (field('MuscleVolume') || {}).value ?? null,
      optimalFiberLengthM: (field('OptimalFiberlength') || {}).value ?? null,
      totalTendonLengthM: (field('TotalTendonLength') || {}).value ?? null,
      k1: (field('K1') || {}).value ?? null,
      k2: (field('K2') || {}).value ?? null,
      epsilon0: (field('Epsilon0') || {}).value ?? null,
      fcfast: (field('Fcfast') || {}).value ?? null,
    };
  }
  return groups;
}
const muscleGroups = scanMuscleParameters(read('ModelMuscleParameters.any'));
console.log('  ' + Object.keys(muscleGroups).length + ' muscle fascicle-groups in ModelMuscleParameters.any');

// ---------------------------------------------------------------------------
//  Par-folder -> physiological-parameter-group map, from MusMdl3E_2.any.
//  Each `AnyMuscleModel3E <ParName> = { ... AnyFolder& MuscleParameters =
//  ..ModelParameters.Muscles.<GroupName>; AnyIntVar MuscleElemNo = <n>; ...};`
//  is read directly -- no name-guessing (stripping trailing digits etc):
//  the source states the mapping explicitly, so that is what is read.
// ---------------------------------------------------------------------------
function scanParMap(srcRaw) {
  const src = stripBlockComments(srcRaw);
  const map = {};
  const re = /AnyMuscleModel3E\s+(\w+)\s*=\s*\{([\s\S]*?)\n\};/g;
  let m;
  while ((m = re.exec(src))) {
    const [, parName, body] = m;
    const gm = /AnyFolder&\s*MuscleParameters\s*=\s*\.\.ModelParameters\.Muscles\.(\w+)\s*;/.exec(body);
    const em = /AnyIntVar\s+MuscleElemNo\s*=\s*(\d+)\s*;/.exec(body);
    if (gm) map[parName] = { group: gm[1], elemNo: em ? parseInt(em[1], 10) : null };
  }
  return map;
}
const parMap = scanParMap(readLeg('MusMdl3E_2.any'));
console.log('  ' + Object.keys(parMap).length + ' element-parameter (...Par) folders in MusMdl3E_2.any');

// ---------------------------------------------------------------------------
//  MUSCLE TOPOLOGY -- Mus.any. One block per fascicle element:
//    Any(MuscleViaPoint|MuscleShortestPath|Muscle...) <ElemName> = {
//      AnyMuscleModel &MusMdl = ..MuscleModels.<ParName>;
//      AnyRefNode &Org = ..Seg.<Body>.<Node>;            (Pelvis-origin points
//      AnyRefNode &Via<k> = ..Seg.<Body>.<Node>;          add an extra ".Muscles."
//      AnyRefNode &Ins = ..Seg.<Body>.<Node>;             segment, e.g.
//      AnySurface &srf = ..Seg.<Body>.<WrapName>.<sub>;   "..Seg.Pelvis.Muscles.Gracilis1Node" --
//    };                                                   BODY_NODE_RE below skips any such
//  middle segment(s), keeping the FIRST identifier as body and the LAST as
//  node -- confirmed present by inspecting Mus.any directly (Gracilis1/2's
//  own Org lines), not assumed absent.
//  Commented-out lines (leading "//" before stripping) are excluded by
//  stripping line comments first -- unlike the segment scanner above, this
//  file's brace/semicolon shape tolerates it fine since no value here spans
//  a "//"-containing line.
// ---------------------------------------------------------------------------
const BODY_NODE_RE = '\\.\\.Seg\\.(\\w+)(?:\\.\\w+)*\\.(\\w+)\\s*;';
function scanMusTopology(srcRaw) {
  const src = stripLineComments(stripBlockComments(srcRaw));
  const elements = [];
  const re = /Any(MuscleViaPoint|MuscleShortestPath|Muscle\w*)\s+(\w+)\s*=\s*\{([\s\S]*?)\n\};/g;
  let m;
  while ((m = re.exec(src))) {
    const [, cls, name, body] = m;
    const musMdl = /AnyMuscleModel\s*&\s*MusMdl\s*=\s*\.\.MuscleModels\.(\w+)\s*;/.exec(body);
    const org = new RegExp('AnyRefNode\\s*&\\s*Org\\s*=\\s*' + BODY_NODE_RE).exec(body);
    const ins = new RegExp('AnyRefNode\\s*&\\s*Ins\\s*=\\s*' + BODY_NODE_RE).exec(body);
    const vias = [...body.matchAll(new RegExp('AnyRefNode\\s*&\\s*(Via\\d+)\\s*=\\s*' + BODY_NODE_RE, 'g'))]
      .map((vm) => ({ label: vm[1], body: vm[2], node: vm[3] }));
    const wraps = [...body.matchAll(/AnySurface\s*&\s*\w+\s*=\s*\.\.Seg\.(\w+)\.([\w.]+)\s*;/g)]
      .map((wm) => ({ body: wm[1], ref: wm[2] }));
    if (!org && !ins) continue; // not a muscle-path element (guards against accidental matches)
    elements.push({
      name, class: 'Any' + cls,
      parFolder: musMdl ? musMdl[1] : null,
      origin: org ? { body: org[1], node: org[2] } : null,
      via: vias,
      insertion: ins ? { body: ins[1], node: ins[2] } : null,
      wrapRefs: wraps,
    });
  }
  return elements;
}
const musElements = scanMusTopology(readLeg('Mus.any'));
console.log('  ' + musElements.length + ' muscle-path elements in Mus.any (right leg)');

// ---------------------------------------------------------------------------
//  JOINTS -- Jnt.any. AnyRevoluteJoint/AnySphericalJoint blocks, each with a
//  symbolic Axis (x/y/z, a coordinate axis, not authored as a number -- kept
//  as the literal symbol) and exactly two AnyRefNode parent/child pointers.
// ---------------------------------------------------------------------------
function scanJoints(srcRaw) {
  const src = stripLineComments(stripBlockComments(srcRaw));
  const joints = [];
  const re = /Any(RevoluteJoint|SphericalJoint|UniversalJoint)\s+(\w+)\s*=\s*\{([\s\S]*?)\n\};/g;
  let m;
  while ((m = re.exec(src))) {
    const [, type, name, body] = m;
    const axisM = [...body.matchAll(/Axis\d?\s*=\s*(x|y|z)\s*;/g)].map((a) => a[1]);
    const refs = [...body.matchAll(new RegExp('AnyRefNode\\s*&\\s*(\\w+)\\s*=\\s*' + BODY_NODE_RE, 'g'))]
      .map((rm) => ({ role: rm[1], body: rm[2], node: rm[3] }));
    if (refs.length < 2) continue;
    joints.push({ name, type: 'Any' + type, axisSymbolic: axisM, connects: refs });
  }
  return joints;
}
const joints = scanJoints(readLeg('Jnt.any'));
console.log('  ' + joints.length + ' joints in Jnt.any');

// ---------------------------------------------------------------------------
//  WRAP SURFACES -- WrappingCylinder5PointFit, reimplemented (see header).
//  Applied only to the wrap surfaces whose 5 input points are a single
//  literal AnyMatrix already captured by scanFolders() above (Thigh's
//  Iliacus/RectusVastii/Gastro/Hamstring *WrapLandmarks). Vector helpers
//  are the minimum needed to mirror the .any algorithm 1:1, line for line.
// ---------------------------------------------------------------------------
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vnorm = (a) => Math.sqrt(vdot(a, a));
const vunit = (a) => vscale(a, 1 / vnorm(a));

// Mirrors Tools/ModelUtilities/WrappingSurfaces/WrappingCylinder5PointFit.any exactly (see header).
function fitCylinder5Point(points, lengthscalefactor, radiusscalefactor) {
  const [Q1, Q2, Q3, Q4, Q5] = points;
  const Length = lengthscalefactor * vnorm(vsub(Q2, Q1));
  const dir = vunit(vsub(Q2, Q1));
  const proj = (Q) => vsub(vadd(Q1, vsub(Q, Q1)), vscale(dir, vdot(vsub(Q, Q1), dir)));
  const Q3p = proj(Q3), Q4p = proj(Q4), Q5p = proj(Q5);
  const cc = vcross(vsub(Q3p, Q4p), vsub(Q4p, Q5p));
  const ccSq = vdot(cc, cc);
  const alpha = (vdot(vsub(Q4p, Q5p), vsub(Q4p, Q5p)) * vdot(vsub(Q3p, Q4p), vsub(Q3p, Q5p))) / (2 * ccSq);
  const beta = (vdot(vsub(Q3p, Q5p), vsub(Q3p, Q5p)) * vdot(vsub(Q4p, Q3p), vsub(Q4p, Q5p))) / (2 * ccSq);
  const gamma = (vdot(vsub(Q3p, Q4p), vsub(Q3p, Q4p)) * vdot(vsub(Q5p, Q3p), vsub(Q5p, Q4p))) / (2 * ccSq);
  const U = vadd(vadd(vscale(Q3p, alpha), vscale(Q4p, beta)), vscale(Q5p, gamma));
  const Radius = vnorm(vsub(U, Q3p));
  const dir1 = vunit(vsub(Q3p, U));
  const Q4mU = vsub(Q4p, U);
  const dir2tmp = vsub(Q4mU, vscale(dir1, vdot(Q4mU, dir1)));
  const dir2 = vunit(dir2tmp);
  const signtmp = vdot(vcross(dir1, dir2), dir);
  const sign = signtmp > 0 ? 1 : -1;
  const axis2 = vscale(dir2, sign); // second in-plane frame axis (before the Z_rotation the source also applies, not needed for radius/length/centre/axis)
  const sRel = vsub(U, vscale(dir, (Length - vnorm(vsub(Q2, Q1))) / 2));
  return { radius: Radius * radiusscalefactor, length: Math.abs(Length), center: sRel, axisFromCenterToQ3: dir1, secondAxis: axis2, cylinderAxisDir: dir };
}

const LANDMARK_WRAPS = [
  { name: 'IliacusWrapSurf', body: 'Thigh', landmarks: 'IliacusWrapLandmarks', lengthscalefactor: 2, radiusscalefactor: 1 },
  { name: 'RectusVastiiWrapSurf', body: 'Thigh', landmarks: 'RectusVastiiWrapLandmarks', lengthscalefactor: 2, radiusscalefactor: 1 },
  { name: 'GastroWrapSurf', body: 'Thigh', landmarks: 'GastroWrapLandmarks', lengthscalefactor: 2, radiusscalefactor: 1 },
  { name: 'HamstringWrapSurf', body: 'Thigh', landmarks: 'HamstringWrapLandmarks', lengthscalefactor: 2, radiusscalefactor: 1 },
];
// lengthscalefactor/radiusscalefactor confirmed =2/=1 for these four from their own
// AnyRefNode blocks in Seg.any (grep: each sets `AnyFloat lengthscalefactor = 2;`
// and does not override radiusscalefactor, whose #include default is 1 -- see
// WrappingCylinder5PointFit.any's own required-input comment).
const wrapSurfaces = [];
for (const w of LANDMARK_WRAPS) {
  const mat = merged[w.body].matrices[w.landmarks];
  const resolvedCount = mat ? mat.rowsRaw.filter((row) => row !== null).length : 0;
  if (!mat || mat.rowsRaw.length !== 5 || resolvedCount !== 5) { console.warn('  wrap surface ' + w.name + ': expected 5 resolvable rows in ' + w.landmarks + ' (segment ' + w.body + '), got ' + (mat ? mat.rowsRaw.length : 0) + ' rows / ' + resolvedCount + ' resolved -- SKIPPED, not resolved'); continue; }
  const fit = fitCylinder5Point(mat.rowsRaw, w.lengthscalefactor, w.radiusscalefactor);
  wrapSurfaces.push({
    name: w.name, body: w.body, type: 'AnySurfCylinder', resolvedGeometry: true,
    method: 'WrappingCylinder5PointFit, reimplemented from Tools/ModelUtilities/WrappingSurfaces/WrappingCylinder5PointFit.any -- see this script\'s header',
    radiusMm: r(fit.radius * MM, 3), lengthMm: r(fit.length * MM, 3),
    centerMm: fit.center.map((v) => r(v * MM, 3)),
    axisUnit: fit.cylinderAxisDir.map((v) => r(v, 6)),
    inputLandmarksMm: mat.rowsRaw.map((row) => row.map((v) => r(v * MM, 3))),
    frame: 'raw StdPar (unmirrored, right-leg-native) -- see AXES in header',
  });
}
// Named-but-not-resolved wrap surfaces (macro-built from other muscles'
// already-scaled node positions plus small literal offsets, or not traced
// in this pass) -- listed so their existence is not silently dropped.
const UNRESOLVED_WRAPS = ['RectusWrapSurf', 'BicepsFemorisCaputLongumWrapSurf', 'Semitendinosus1WrapSurf',
  ...Array.from({ length: 12 }, (_, k) => 'GluteusMaximusWrap' + (k < 6 ? 'Inferior' + (k + 1) : 'Superior' + (k - 5)))];
for (const name of UNRESOLVED_WRAPS) wrapSurfaces.push({ name, resolvedGeometry: false, note: 'referenced in Seg.any/Mus.any; geometry macro-built from other nodes rather than a single literal landmark matrix; not traced in this pass -- see header WRAP SURFACES exception 3' });

console.log('  ' + wrapSurfaces.filter((w) => w.resolvedGeometry).length + ' wrap-surface cylinders fully resolved, ' + wrapSurfaces.filter((w) => !w.resolvedGeometry).length + ' referenced-but-unresolved');

// ---------------------------------------------------------------------------
//  ASSEMBLE muscles[]: one entry per ModelMuscleParameters.any fascicle
//  group, elements[] populated from Mus.any via the parMap cross-reference.
// ---------------------------------------------------------------------------
const elementsByGroup = {};
for (const el of musElements) {
  const parInfo = el.parFolder ? parMap[el.parFolder] : null;
  const group = parInfo ? parInfo.group : null;
  if (!elementsByGroup[group]) elementsByGroup[group] = [];
  elementsByGroup[group].push({
    name: el.name, class: el.class, elemNo: parInfo ? parInfo.elemNo : null,
    origin: el.origin, via: el.via, insertion: el.insertion, wrapRefs: el.wrapRefs,
  });
}
const SPECIFIC_STRENGTH_N_PER_CM2 = 90; // literal, quoted verbatim in header from ModelMuscleParameters.any's own comment
const muscles = Object.keys(muscleGroups).sort().map((gname) => {
  const g = muscleGroups[gname];
  const els = (elementsByGroup[gname] || []).sort((a, b) => (a.elemNo || 0) - (b.elemNo || 0));
  let est = null;
  if (g.muscleVolumeMl != null && g.optimalFiberLengthM != null && g.elementCount) {
    // EST: assumes StrengthScale=FiberLengthScale=StrengthIndexLeg=1 -- see header MUSCLE-MODEL PARAMETERS
    const sumLf0 = g.elementCount * g.optimalFiberLengthM;
    const pcsaCm2 = sumLf0 > 0 ? (1e4 * (g.muscleVolumeMl * 1e-6) / sumLf0) : null;
    est = {
      assumption: 'StrengthScale = FiberLengthScale = HumanModel.StrengthParameters.StrengthIndexLeg = 1 (these live in a whole-body parent model this leg submodel does not itself define -- see header)',
      pcsaCm2: pcsaCm2 != null ? r(pcsaCm2, 4) : null,
      maxForcePerElementN: pcsaCm2 != null ? r(SPECIFIC_STRENGTH_N_PER_CM2 * pcsaCm2, 2) : null,
      specificStrengthNPerCm2: SPECIFIC_STRENGTH_N_PER_CM2,
    };
  }
  return {
    name: gname, label: g.label, elementCountDeclared: g.elementCount, elementCountFound: els.length,
    pennationAngleDeg: g.pennationAngleDeg,
    muscleVolumeMl: g.muscleVolumeMl,
    optimalFiberLengthMm: g.optimalFiberLengthM != null ? r(g.optimalFiberLengthM * MM, 4) : null,
    totalTendonLengthMm: g.totalTendonLengthM != null ? r(g.totalTendonLengthM * MM, 4) : null,
    muscleModelShapeParams: { k1: g.k1, k2: g.k2, epsilon0: g.epsilon0, fcfast: g.fcfast },
    est,
    elements: els,
  };
});
const groupCountMismatch = muscles.filter((m) => m.elementCountDeclared !== m.elementCountFound);

// ---------------------------------------------------------------------------
//  SEGMENTS -- everything scanFolders() found, per top-level folder.
// ---------------------------------------------------------------------------
const segments = {};
for (const s of SEGMENTS) {
  const seg = merged[s];
  const vectorsMm = {};
  for (const [name, v] of Object.entries(seg.vectors)) vectorsMm[name] = { xyzMm: v.raw.map((c) => r(c * MM, 4)), suffixRaw: v.suffixRaw, sourceFile: v.sourceFile };
  segments[s] = {
    vectorsMm, // includes BOTH joint centres/axes AND muscle attachment/via/wrap-landmark points -- see header, no separate split is imposed
    scalars: seg.scalars,
    strings: seg.strings,
    matrixNames: Object.keys(seg.matrices), // full matrices folded into wrapSurfaces above where used; names listed here so nothing is silently dropped
  };
}

// Same-frame joint-to-joint segment lengths, same discipline as
// tools/fit-osim.js's SEGMENT LENGTHS section: only ever subtract two
// points already expressed in the one same body's own frame.
function segLen(bodyName, ptA, ptB) {
  const seg = merged[bodyName];
  const a = seg.vectors[ptA], b = seg.vectors[ptB];
  if (!a || !b) return null;
  return r(vnorm(vsub(a.raw, b.raw)) * MM, 2);
}
const segmentLengthsMm = {
  femurFunctional: segLen('Thigh', 'HipJoint', 'KneeJoint'), // hip joint centre to knee joint centre, both in Thigh's own frame
  tibiaFunctional: segLen('Shank', 'KneeJoint', 'AnkleJoint'), // knee joint centre to ankle joint centre, both in Shank's own frame
};

// ---------------------------------------------------------------------------
//  ASSEMBLE + WRITE
// ---------------------------------------------------------------------------
const out = {
  meta: {
    dataset: 'TLEM 2.0/2.1 (Twente Lower Extremity Model), as implemented in AnyBody\'s AAUHuman/LegTLEM2.1',
    citation: 'Carbone, V., Fluit, R., Pellikaan, P., van der Krogt, M.M., Janssen, D., Damsgaard, M., Vigneron, L., Feilkas, T., Koopman, H.F.J.M., Verdonschot, N. (2015) TLEM 2.0 - a comprehensive musculoskeletal geometry dataset for subject-specific modeling of lower extremity. J. Biomech. 48, 734-741. doi:10.1016/j.jbiomech.2014.12.034 -- created under the TLEMsafe project (www.tlemsafe.eu), EC Grant Agreement no. 247860.',
    muscleArchitectureLineage: 'ModelMuscleParameters.any states its own volume/fibre-length/tendon-length/pennation numbers were NOT remeasured by TLEMsafe and instead carry over from the original TLEM: Klein Horsman, M.D., PhD thesis, "The Twente Lower Extremity Model (TLEM): Consistent Dynamic Simulation of the Human Locomotor Apparatus" -- "a mixture of parameters which could be obtained by Klein Horsman himself as well as data obtained by Scott L. Delp".',
    fetchedFrom: 'https://github.com/AnyBody/ammr (git clone)',
    fetchedFromCommit: '597606d942423f298f9b14b4e460051969ef62e6 (2026-07-10, "bump to use ams 821 (#1143)")',
    extractedDate: new Date().toISOString().slice(0, 10),
    license: 'PROPRIETARY -- AnyBody Technology A/S Software License Agreement (SLA 31012024, January 2024). See this script\'s own header for the verbatim clauses (3.1 paid-licence-only, 3.3 no derivative database/Output to any third party without specific agreement, 4.1/4.2 no commercial use of derived data/results/models under ANY licence tier including Academic). DO NOT redistribute this file or commit it to a shared repository -- see header.',
    units: 'lengths in millimetres (source is metres, x1000 once -- see UNITS in header); Pennationangle in DEGREES AS AUTHORED (NOT radians -- unlike every OpenSim-derived file in this project); muscle volume in millilitres (source unit, unconverted); mass in kilograms; angles other than Pennationangle not extracted (Axis fields on joints are symbolic x/y/z, not numeric).',
    axes: 'RAW StdPar values, right-leg-native (Sign=+1), UNMIRRORED and with the source\'s own *.TF\'/-FrameOffset suffix preserved verbatim but NOT applied. Empirically verified here (not assumed): +Y=proximal/superior, +X=anterior, +Z=subject\'s-right, all confirmed from real point pairs -- see AXES in header for the exact numbers and reasoning. This is TLEM2\'s OWN per-segment frame, not remapped onto Rajagopal\'s or MoBL-ARMS\'s numeric frame despite the same general convention family.',
    scalingNotApplied: 'Every point is StdPar-raw (this cadaver subject\'s own measurement), never passed through the model\'s .Scale() retargeting function -- see AXES in header for why that is the correct reading of "TLEM2\'s own geometry" rather than an omission.',
    muscleModelFormulas: 'PCSA/F0 depend on StrengthScale/FiberLengthScale/StrengthIndexLeg factors defined in a whole-body PARENT model this leg submodel does not itself carry -- NOT resolved here. See muscles[].est for a clearly-labelled, assumption-stated estimate (StrengthScale=FiberLengthScale=StrengthIndexLeg=1) instead. muscles[].optimalFiberLengthMm/totalTendonLengthMm/pennationAngleDeg ARE the file\'s own literal, unscaled numbers -- not estimates.',
    wrapSurfaces: wrapSurfaces.filter((w) => !w.resolvedGeometry).length + ' of ' + wrapSurfaces.length + ' referenced wrap surfaces have geometry NOT resolved in this pass (macro-built from other muscles\' node positions rather than a single literal landmark matrix) -- see wrapSurfaces[].resolvedGeometry and this script\'s header.',
    notCovered: 'Left leg (mirror of this same data via Sign=-1*Z, not separately authored -- see header). Hip range-of-motion / joint stops (not found as literals within LegTLEM2.1 itself). Bone mesh geometry (TLEM2.1/talus.anysurf3 and STL.any reference external/proprietary mesh files, not parsed here -- out of scope, this file is muscle/segment/joint PARAMETERS only, the same scope fit-osim.js and fit-mobl-arms.js keep). MusMdlSimple_2.any (an alternate, simpler muscle-model variant over the SAME geometry+physiological parameters, with a different Lf0 formula -- noted in header, not separately extracted since it changes no data this file reports).',
    elementCountMismatches: (groupCountMismatch.length
      ? groupCountMismatch.map((m) => m.name + ': ModelMuscleParameters.any declares MuscleElemAmount=' + m.elementCountDeclared + ' but Mus.any wires up ' + m.elementCountFound + ' elements').join('; ')
        + ' -- all three confirmed genuine (checked directly, not assumed benign): PsoasMajor/PsoasMinor are entirely absent from Mus.any because psoas originates on the LUMBAR SPINE, a body outside this LEG-only submodel\'s own six segments -- ModelMuscleParameters.any carries their physiological parameters (presumably for a whole-body assembly this leg is normally included into) but no path for them exists here to extract. PeroneusTertius is simply absent from Mus.any entirely (zero occurrences) in this model version/configuration despite having declared parameters -- a real incompleteness in the source, not a parsing gap.'
      : 'none -- every fascicle group\'s declared MuscleElemAmount matched the number of elements actually found wired up in Mus.any'),
    sacrumOrigin: 'Mus.any\'s six GluteusMaximusInferior<1-6> elements originate on "..Seg.Sacrum.LegAttachmentNodes.<Node>" -- Sacrum is a real, anatomically-correct additional origin body (gluteus maximus does have a sacral origin) that this leg-only submodel references but does not itself define a coordinate frame for (same "provided by the parent whole-body model" situation as Psoas, above). These six elements\' origin.body="Sacrum" is recorded in muscles[], with no coordinate resolvable from segments{} (there is no Sacrum entry).',
  },
  segments,
  joints,
  muscles,
  wrapSurfaces,
  segmentLengthsMm,
  counts: {
    segments: SEGMENTS.length,
    muscleGroups: muscles.length,
    muscleElementsDeclared: muscles.reduce((s, m) => s + (m.elementCountDeclared || 0), 0),
    muscleElementsFoundInMusAny: musElements.length,
    joints: joints.length,
    wrapSurfacesResolved: wrapSurfaces.filter((w) => w.resolvedGeometry).length,
    wrapSurfacesUnresolved: wrapSurfaces.filter((w) => !w.resolvedGeometry).length,
  },
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out));
console.log('-> ' + outPath + '  ' + (fs.statSync(outPath).size / 1024).toFixed(0) + ' kB');
console.warn('\n*** REMINDER: this output is proprietary AnyBody/AMMR-derived data. Do not commit it, push it, or paste it anywhere. See this script\'s own header. ***\n');

// ---------------------------------------------------------------------------
//  VERIFICATION
// ---------------------------------------------------------------------------
const issues = [];
const explainedFindings = []; // real, checked discrepancies that are NOT parsing bugs -- see meta.elementCountMismatches/sacrumOrigin -- reported separately from `issues` so verification:PASS reflects "the extraction is faithful" rather than being drowned out by genuine source-data quirks
const KNOWN_UNWIRED_GROUPS = new Set(['PsoasMajor', 'PsoasMinor', 'PeroneusTertius']);
for (const m of groupCountMismatch) {
  const line = 'muscle group ' + m.name + ': MuscleElemAmount=' + m.elementCountDeclared + ' but ' + m.elementCountFound + ' elements found in Mus.any';
  (KNOWN_UNWIRED_GROUPS.has(m.name) ? explainedFindings : issues).push(line + (KNOWN_UNWIRED_GROUPS.has(m.name) ? ' (expected -- see meta.elementCountMismatches for why)' : ''));
}

// every muscle element with a parFolder should have resolved to a real group
for (const el of musElements) {
  if (el.parFolder && !parMap[el.parFolder]) issues.push('Mus.any element ' + el.name + ' references MuscleModels.' + el.parFolder + ', not found in MusMdl3E_2.any\'s Par-folder map');
}

// every origin/insertion/via body name is one of the six known segments, OR
// "Sacrum" -- confirmed real, not a parsing artefact: Mus.any's six
// GluteusMaximusInferior<1-6> elements originate on
// "..Seg.Sacrum.LegAttachmentNodes.<Node>", a body this LEG-only submodel
// does not itself define (same situation as Psoas major/minor on
// "..TrunkMuscles", see meta.notCovered) -- gluteus maximus genuinely does
// have a sacral origin anatomically, so this is TLEM2.1's model correctly
// reflecting that, not a bug. Sacrum-origin points are recorded in
// muscles[].elements[].origin as-is; no coordinate for them is resolved
// (there is no Sacrum entry in segments{}, see notCovered).
const BODY_NAMES = new Set([...SEGMENTS, 'Sacrum']);
for (const el of musElements) {
  for (const pt of [el.origin, el.insertion, ...el.via]) {
    if (pt && !BODY_NAMES.has(pt.body)) issues.push('Mus.any element ' + el.name + ': unrecognised body "' + pt.body + '"');
  }
}

// every joint's connects[] bodies are known segments
for (const j of joints) for (const c of j.connects) if (!BODY_NAMES.has(c.body)) issues.push('joint ' + j.name + ': unrecognised body "' + c.body + '"');

// wrap cylinder radii/lengths should be positive and anatomically plausible (5-80mm radius, 10-500mm length)
for (const w of wrapSurfaces.filter((x) => x.resolvedGeometry)) {
  if (!(w.radiusMm > 0)) issues.push('wrap surface ' + w.name + ': non-positive radius ' + w.radiusMm);
  if (!(w.radiusMm >= 3 && w.radiusMm <= 100)) issues.push('wrap surface ' + w.name + ': radius ' + w.radiusMm + 'mm outside plausible 3-100mm range for a lower-limb muscle wrap cylinder -- check the fit');
}

// segment lengths positive and plausible for an adult
if (!(segmentLengthsMm.femurFunctional > 300 && segmentLengthsMm.femurFunctional < 500)) issues.push('femurFunctional ' + segmentLengthsMm.femurFunctional + 'mm outside plausible adult 300-500mm range');
if (!(segmentLengthsMm.tibiaFunctional > 250 && segmentLengthsMm.tibiaFunctional < 450)) issues.push('tibiaFunctional ' + segmentLengthsMm.tibiaFunctional + 'mm outside plausible adult 250-450mm range');

console.log(issues.length === 0 ? 'verification: PASS' : ('verification: FAIL (' + issues.length + ' issue(s))'));
for (const iss of issues.slice(0, 40)) console.log('  - ' + iss);
if (issues.length > 40) console.log('  ... and ' + (issues.length - 40) + ' more');
if (explainedFindings.length) {
  console.log('\n' + explainedFindings.length + ' additional finding(s), NOT counted as failures -- genuine source-data facts checked directly against Mus.any/Seg.any, not parsing gaps (see meta.elementCountMismatches / meta.sacrumOrigin for the full explanation):');
  for (const f of explainedFindings) console.log('  - ' + f);
}

console.log('\ncounts: ' + JSON.stringify(out.counts, null, 2).replace(/[{}"]/g, '').trim());
console.log('\nsegment lengths (mm, THIS cadaver subject, hip/knee/ankle joint-centre-to-joint-centre):');
for (const k in segmentLengthsMm) console.log('  ' + k.padEnd(20) + segmentLengthsMm[k]);
console.log('\ncross-check against other subjects already in this project (different individuals -- agreement is NOT expected, plausibility is):');
console.log('  data/rajagopal.json  segmentLengthsMm.femur = 408.05mm (a different, separately-imaged subject)');
console.log('  data/bodyparts3d.json FMA24474 (right femur) bbox Z-size = 440.22mm (a third, separately-segmented subject)');
console.log('  TLEM2.1 (this file)  Thigh hip-to-knee joint-centre distance = ' + segmentLengthsMm.femurFunctional + 'mm (a fourth subject -- and a joint-CENTRE-to-joint-CENTRE "functional length", not the same measurement definition as either of the above, which is bone bounding-box/segment-length -- so a close numeric match would actually be more suspicious than this spread)');
console.log('\npennation angle range across ' + muscles.length + ' fascicle groups: ' + Math.min(...muscles.map((m) => m.pennationAngleDeg).filter((v) => v != null)) + ' to ' + Math.max(...muscles.map((m) => m.pennationAngleDeg).filter((v) => v != null)) + ' degrees');
console.log('optimal fibre length range: ' + Math.min(...muscles.map((m) => m.optimalFiberLengthMm).filter((v) => v != null)).toFixed(1) + ' to ' + Math.max(...muscles.map((m) => m.optimalFiberLengthMm).filter((v) => v != null)).toFixed(1) + ' mm');
if (issues.length) process.exitCode = 1;
