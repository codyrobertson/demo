/* Turn the 5 TLEM2 bone meshes bundled with the msk-STAPLE MATLAB toolbox
   into a compact catalogue-plus-geometry-summary, the same move
   tools/fit-bodyparts3d.js makes for BodyParts3D: read every triangle for
   real, keep a bounding box / vertex mean / enclosed volume, not the
   triangles themselves.
   Usage: node tools/fit-staple-tlem2.js [path-to-msk-STAPLE-checkout] [out.json]
   Defaults: data/msk-STAPLE -> data/staple-tlem2.json

   ==========================================================================
   WHAT THIS IS. msk-STAPLE (https://github.com/modenaxe/msk-STAPLE) is a
   MATLAB toolbox, not primarily a data source -- but it ships, as its
   default worked-example input, 5 binary-STL bone surface meshes at
   bone_datasets/TLEM2/stl/ (femur_r, tibia_r, pelvis, talus_r, foot_r):
   the bone geometry for the SAME TLEM2 cadaver specimen that
   tools/fit-tlem.js reads AnyScript muscle/joint parameters from (both cite
   the identical paper -- Carbone et al. 2015, see below -- and STAPLE's own
   bone_datasets/TLEM2/README.md repeats that citation verbatim). That
   makes this a genuinely independent SECOND route to part of the same
   underlying specimen, obtained from a differently-licensed repository, and
   a real cross-check opportunity: see VERIFICATION at the bottom of this
   script for how the femur here compares to tools/fit-tlem.js's femur.

   msk-STAPLE also ships 8 OTHER bone datasets (TLEM2_CT, TLEM2_MRI,
   VAKHUM_CT, LHDL_CT, ICL_MRI, JIA_MRI, JIA_ANKLE_MRI, MC22) -- NOT
   extracted here. Checked directly (not assumed): every one of those stores
   its triangulation as a MATLAB `triangulation` object serialised via
   MCOS (MATLAB Class Object System) inside a compressed .mat container --
   confirmed by decompressing e.g. bone_datasets/TLEM2_CT/tri/femur_r.mat's
   miCOMPRESSED element (Node's builtin zlib.inflateSync, no npm dependency
   needed for that part) and finding the literal bytes "MCOS" and
   "triangulation" in the decompressed header, NOT a plain numeric struct
   with e.g. `.Points`/`.ConnectivityList` fields. MCOS's on-disk layout is
   not published by MathWorks (even SciPy's widely-used `scipy.io.loadmat`
   explicitly cannot read MCOS-serialised class objects, only plain
   structs/arrays), so reverse-engineering it well enough to trust the
   output would be exactly the kind of "looks plausible, silently wrong"
   result this project's whole approach refuses to ship. Only the
   bone_datasets/TLEM2/stl/ directory (plain binary STL, a format this
   project already has a verified reader for -- see below) was extracted.

   To regenerate:
     git clone --depth 1 https://github.com/modenaxe/msk-STAPLE data/msk-STAPLE
     node tools/fit-staple-tlem2.js

   PROVENANCE OF THE BONE MESHES THEMSELVES:
   Carbone, V., Fluit, R., Pellikaan, P., van der Krogt, M.M., Janssen, D.,
   Damsgaard, M., Vigneron, L., Feilkas, T., Koopman, H.F.J.M.,
   Verdonschot, N. (2015) "TLEM 2.0 - a comprehensive musculoskeletal
   geometry dataset for subject-specific modeling of lower extremity."
   J. Biomech. 48, 734-741. doi:10.1016/j.jbiomech.2014.12.034 -- the exact
   same citation tools/fit-tlem.js's ModelParameters.any/etc. carry, quoted
   here from bone_datasets/TLEM2/README.md, which reproduces it verbatim.

   PROVENANCE OF THIS PARTICULAR PACKAGING (the STL files, as bundled):
   https://github.com/modenaxe/msk-STAPLE, pinned commit
   eec7db1c1a54363b23b344956f972d8c4ede198f (2024-02-08, "fix visitor
   counter"). Cite per the toolbox's own NOTICE.txt: Modenese, Luca, and
   Jean-Baptiste Renault (2021) "Automatic Generation of Personalised
   Skeletal Models of the Lower Limb from Three-Dimensional Bone
   Geometries." J. Biomech. 116:110186. doi:10.1016/j.jbiomech.2020.110186

   LICENSE -- Creative Commons Attribution-NonCommercial 4.0 International
   (CC BY-NC 4.0), quoted verbatim from the repository's own LICENSE.txt and
   NOTICE.txt. The repository's own README states, as a banner: "STAPLE is
   released under a non-commercial license and it is free to use for
   academic purposes only. For any other use please contact the authors."
   THIS RESTRICTION APPLIES TO THE DATA EXTRACTED BELOW. graphite-figure is
   currently a non-commercial project, so extraction/redistribution here is
   within the license's terms (Share + Adapt permitted for NonCommercial
   purposes, with attribution) -- but this file, and anything derived from
   it, MUST NOT be used commercially without contacting the STAPLE authors,
   and any redistribution MUST carry the attribution above. This is a
   meaningfully DIFFERENT, and much less restrictive, situation than
   data/tlem.json's source (AMMR): CC BY-NC is a standard, well-understood
   open license that explicitly permits Sharing and Adapting for
   NonCommercial purposes -- it is not a paid-license-only EULA that bars
   redistribution of derived data outright. See tools/fit-tlem.js's header
   for that contrast in full.

   ==========================================================================
   WHY A HAND-WRITTEN BINARY-STL READER, AND WHY IT IS TRUSTED HERE:
   identical format and identical reasoning to tools/fit-bodyparts3d.js's
   readStl() (80-byte header, uint32 LE triangle count, 50 bytes/triangle:
   12B normal + 3x12B vertex + 2B attribute) -- verified again here, freshly,
   against THESE 5 files specifically (not assumed to hold just because it
   held for a different dataset): every file's size equals
   84 + 50*triangleCount exactly (checked in the loop below; the script
   throws otherwise). All 5 headers begin with the ASCII text "Creat..."
   (a human-readable string in the 80-byte header is normal for binary STL
   written by common meshing tools; it does not make the file ASCII STL --
   the byte-count check is what actually distinguishes the two, not the
   header text).

   UNITS -- MILLIMETRES, confirmed empirically (not documented in words in
   this dataset): femur_r.stl's own bounding box is 71.0 x 414.0 x 113.9 in
   the file's raw units. 414 as a femur BONE LENGTH (proximal tip to distal
   condyles) in millimetres is an entirely plausible adult value -- as
   centimetres (4.14m) or metres (0.414mm) it is not.

   AXES -- PARTIALLY verified, said plainly which part. The dominant
   (largest) bounding-box axis is the SECOND stored coordinate (index 1,
   "Y") for both femur_r (414.0 of 71.0/414.0/113.9) and tibia_r (353.2 of
   66.5/353.2/83.7) -- consistent with Y being the proximal-distal axis,
   the same role Y plays in tools/fit-tlem.js's TLEM2 frame (independently
   confirmed there from HipJoint/KneeJoint literals) and in
   data/rajagopal.json's frame (+Y superior). pelvis.stl -- which, unlike
   the other four, carries no _r/_l suffix and is presumably the BILATERAL
   pelvis -- has its largest extent on the THIRD coordinate ("Z", 273.2mm),
   consistent with Z being the medio-lateral axis (matching Rajagopal's and
   tools/fit-tlem.js's own Z=subject's-right/mediolateral convention
   family) and with 273mm being a plausible bilateral pelvic breadth.
   NOT independently confirmed here: WHICH END of each axis is which (e.g.
   whether +Y is proximal or distal, whether +Z is left or right) -- a
   bounding box has no sense of sign, only extent, and this dataset has no
   asymmetric single-side landmark this script checks the way
   tools/fit-tlem.js's Foot.MetatarsalJoint1Node-vs-5Node check does. Said
   plainly rather than assumed: axes[] below records which axis is
   dominant for each bone, not which direction along it is anatomically
   positive.
   A SINGLE SHARED (lab/scanner) frame across all 5 bones is assumed, NOT
   independently confirmed -- unlike tools/fit-tlem.js's per-body local
   frames (each expressed relative to that body's own joint centre), these
   STL files carry no documented relationship to one another beyond both
   being outputs of the same segmentation pipeline; boundingBoxMm/vertexMeanMm
   below are only meaningful relative to each OTHER bone's own file if that
   assumption holds, which this script does not independently test.

   VOLUME IS APPROXIMATE -- identical caveat to tools/fit-bodyparts3d.js:
   enclosedVolumeMm3 assumes a closed, consistently-wound mesh; real
   segmented bone surfaces can be very slightly non-manifold, so this is an
   order-of-magnitude figure, not a certified measurement. */
'use strict';
const fs = require('fs');
const path = require('path');

const srcDir = process.argv[2] || path.join(__dirname, '..', 'data', 'msk-STAPLE');
const outPath = process.argv[3] || path.join(__dirname, '..', 'data', 'staple-tlem2.json');
const stlDir = path.join(srcDir, 'bone_datasets', 'TLEM2', 'stl');
if (!fs.existsSync(stlDir)) {
  console.error('no directory at ' + stlDir + ' -- see the header of this file for how to fetch a checkout');
  process.exit(1);
}

// ---------------------------------------------------------------------------
//  MESHES -- binary STL, identical layout and identical per-triangle
//  divergence-theorem volume accumulation to tools/fit-bodyparts3d.js's
//  readStl(); kept as a literal copy (not a shared require) so this script
//  stays as self-contained as every other tools/fit-*.js in this project.
// ---------------------------------------------------------------------------
function readStl(file) {
  const buf = fs.readFileSync(file);
  const n = buf.readUInt32LE(80);
  const expected = 84 + 50 * n;
  if (buf.length !== expected) throw new Error(file + ': size ' + buf.length + ' != expected ' + expected + ' for ' + n + ' triangles -- not the binary STL layout this script assumes');
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  let sx = 0, sy = 0, sz = 0, vol6 = 0;
  let off = 84;
  for (let i = 0; i < n; i++) {
    off += 12; // skip stored normal
    const x1 = buf.readFloatLE(off), y1 = buf.readFloatLE(off + 4), z1 = buf.readFloatLE(off + 8);
    const x2 = buf.readFloatLE(off + 12), y2 = buf.readFloatLE(off + 16), z2 = buf.readFloatLE(off + 20);
    const x3 = buf.readFloatLE(off + 24), y3 = buf.readFloatLE(off + 28), z3 = buf.readFloatLE(off + 32);
    off += 36 + 2;
    for (const [x, y, z] of [[x1, y1, z1], [x2, y2, z2], [x3, y3, z3]]) {
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (z < minz) minz = z; if (z > maxz) maxz = z;
      sx += x; sy += y; sz += z;
    }
    vol6 += x1 * (y2 * z3 - z2 * y3) - y1 * (x2 * z3 - z2 * x3) + z1 * (x2 * y3 - y2 * x3);
  }
  const nv = n * 3;
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    triangles: n,
    fileSizeBytes: buf.length,
    boundingBoxMm: { min: [minx, miny, minz].map(r2), max: [maxx, maxy, maxz].map(r2), sizeMm: [maxx - minx, maxy - miny, maxz - minz].map(r2) },
    vertexMeanMm: nv ? [r2(sx / nv), r2(sy / nv), r2(sz / nv)] : null,
    enclosedVolumeMm3: Math.round(Math.abs(vol6) / 6),
  };
}

const BONES = [
  { id: 'femur_r', name: 'right femur', side: 'right' },
  { id: 'tibia_r', name: 'right tibia (+ fibula, if segmented together -- not independently checked)', side: 'right' },
  { id: 'pelvis', name: 'pelvis (bilateral -- no _r/_l suffix in the source filename)', side: 'bilateral' },
  { id: 'talus_r', name: 'right talus', side: 'right' },
  { id: 'foot_r', name: 'right foot (remaining tarsals/metatarsals/phalanges as one mesh -- not independently checked which bones are included)', side: 'right' },
];

console.log('reading ' + BONES.length + ' STL meshes from ' + stlDir + ' ...');
const bones = {};
let totalTriangles = 0, totalBytes = 0;
for (const b of BONES) {
  const file = path.join(stlDir, b.id + '.stl');
  if (!fs.existsSync(file)) { console.warn('  missing expected file: ' + file); continue; }
  const g = readStl(file);
  bones[b.id] = { name: b.name, side: b.side, ...g };
  totalTriangles += g.triangles;
  totalBytes += g.fileSizeBytes;
  console.log('  ' + b.id + ': ' + g.triangles.toLocaleString() + ' triangles, bbox ' + g.boundingBoxMm.sizeMm.join(' x ') + ' mm');
}

// ---------------------------------------------------------------------------
//  ASSEMBLE + WRITE
// ---------------------------------------------------------------------------
const staple = {
  meta: {
    source: 'Bone geometry: Carbone, V., Fluit, R., Pellikaan, P., van der Krogt, M.M., Janssen, D., Damsgaard, M., Vigneron, L., Feilkas, T., Koopman, H.F.J.M., Verdonschot, N. (2015) "TLEM 2.0 - a comprehensive musculoskeletal geometry dataset for subject-specific modeling of lower extremity." J. Biomech. 48, 734-741. doi:10.1016/j.jbiomech.2014.12.034 -- the SAME cadaver/citation as data/tlem.json (tools/fit-tlem.js), obtained here from a second, independent, differently-licensed repository.',
    packagedBy: 'msk-STAPLE toolbox. Cite: Modenese, Luca, and Jean-Baptiste Renault (2021) "Automatic Generation of Personalised Skeletal Models of the Lower Limb from Three-Dimensional Bone Geometries." J. Biomech. 116:110186. doi:10.1016/j.jbiomech.2020.110186',
    fetchedFrom: 'https://github.com/modenaxe/msk-STAPLE (git clone), bone_datasets/TLEM2/stl/',
    fetchedFromCommit: 'eec7db1c1a54363b23b344956f972d8c4ede198f (2024-02-08, "fix visitor counter")',
    extractedDate: new Date().toISOString().slice(0, 10),
    license: 'Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0), verbatim from the repository\'s own LICENSE.txt/NOTICE.txt. The repository\'s own README states, as a banner: "STAPLE is released under a non-commercial license and it is free to use for academic purposes only. For any other use please contact the authors." graphite-figure is currently non-commercial, so this extraction is within the license\'s terms, but ANY COMMERCIAL USE OF THIS FILE REQUIRES CONTACTING THE STAPLE AUTHORS FIRST, and redistribution must carry the attribution above (both citations). This is NOT the same, more restrictive, situation as data/tlem.json (AMMR) -- see that file\'s own header for the contrast.',
    units: 'millimetres, EMPIRICALLY confirmed from femur_r\'s own bounding box (414mm dominant axis, a plausible femur length) -- see this script\'s header.',
    axes: 'PARTIALLY verified only -- see this script\'s header AXES section in full for exactly what was and was not checked. In short: the dominant bounding-box axis is Y (index 1) for femur_r/tibia_r (consistent with Y=proximal-distal, matching tools/fit-tlem.js and data/rajagopal.json\'s convention family) and Z (index 2) for pelvis (consistent with Z=mediolateral, same family) -- but WHICH END of each axis is anatomically positive was not independently re-derived here (no asymmetric per-side landmark available in a bounding-box-only summary), and whether all 5 files genuinely share one common frame is assumed, not tested.',
    volumeIsApproximate: 'enclosedVolumeMm3 assumes a closed, consistently-wound mesh -- order-of-magnitude, not a certified measurement. Same caveat as data/bodyparts3d.json.',
    notCovered: 'The other 8 bone_datasets/ directories in this repository (TLEM2_CT, TLEM2_MRI, VAKHUM_CT, LHDL_CT, ICL_MRI, JIA_MRI, JIA_ANKLE_MRI, MC22) were NOT extracted: their triangulations are MATLAB MCOS-serialised `triangulation` objects inside compressed .mat files, an undocumented binary format (confirmed by decompressing one and finding literal "MCOS"/"triangulation" bytes, not a plain numeric struct) -- see this script\'s header for the full reasoning. No triangle/vertex geometry is included below either, for the same reason as data/bodyparts3d.json -- catalogue and per-mesh summary only; fetch the specific .stl from the source above for the actual mesh.',
    stapleAlgorithms: 'STAPLE\'s own JOINT-CENTRE-FITTING ALGORITHMS (methods, not data -- these produce no numbers shipped in this file, they operate ON meshes like the ones summarised here) are described in full, with exact source file paths, in this script\'s own header comment block below this meta section -- see ALGORITHMS.',
  },
  bones,
  counts: {
    bones: Object.keys(bones).length,
    totalTriangles,
    totalSourceKB: Math.round(totalBytes / 1024),
  },
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(staple));
console.log('-> ' + outPath + '  ' + (fs.statSync(outPath).size / 1024).toFixed(0) + ' kB');

/* ==========================================================================
   ALGORITHMS -- STAPLE's methods for deriving joint axes/centres from bone
   meshes. Read directly from the .m source (paths given below), described
   here precisely enough to reimplement -- these are METHODS, not data, and
   nothing in this script executes them (that would need a mesh-processing
   stack: triangle slicing, mesh dilation/erosion, etc. -- well beyond a
   zero-dependency Node script, and not attempted). All formulas/thresholds
   below are transcribed from the source, not from memory of the published
   paper -- verify against the .m files themselves (paths given) before
   reimplementing for anything load-bearing.

   1. FEMORAL HEAD CENTRE -- TWO independent pipelines in STAPLE, both
      converging on the same closed-form sphere fit:

      sphereFit() -- STAPLE/GIBOC-core/SubFunctions/FittingFun/sphereFit.m
      The shared primitive both pipelines call: a CLOSED-FORM (non-iterative)
      linear least-squares sphere fit (attributed to Alan Jennings, Univ. of
      Dayton). For points X (n x 3), build:
        A = [[mean(x(x-x̄)),        2*mean(x(y-ȳ)),        2*mean(x(z-z̄))],
             [0,                    mean(y(y-ȳ)),          2*mean(y(z-z̄))],
             [0,                    0,                      mean(z(z-z̄))]]
        A = A + A'  (symmetrise)
        B = [mean((x²+y²+z²)(x-x̄)), mean((x²+y²+z²)(y-ȳ)), mean((x²+y²+z²)(z-z̄))]'
        center = A⁻¹B  (solve the 3x3 linear system)
        radius = sqrt(mean(|X - center|²))
      This minimises sum((x-xc)²+(y-yc)²+(z-zc)²-r²)² algebraically -- a
      standard "algebraic distance" sphere fit, not a true geometric
      (orthogonal-distance) fit, but fast and closed-form.

      Pipeline A -- GIBOC method (default in STAPLE):
      STAPLE/algorithms/private/GIBOC_femur_fitSphere2FemHead.m
        1. Find the most-proximal mesh point along the (already-estimated)
           proximal-distal axis Z0; grow a small patch around it
           (TriDilateMesh, a mesh-region-growing dilation by triangle
           adjacency).
        2. Estimate a first medio-lateral axis Y0 from
           normalize(cross(cross(Z0, top-patch-centroid - volume-centroid), Z0)).
        3. Find the most-medial point along Y0; grow a second patch there.
        4. Union the two patches; FIRST sphereFit() on their points.
        5. DILATE the unioned patch further (by 1.5x the fitted radius,
           scaled by a mesh-resolution coefficient) and fit AGAIN.
        6. Reject outliers from the dilated patch by TWO conditions, applied
           together if they leave >20 points, else condition 1 alone: (a)
           face-normal within acosd(0.975)=~12.9deg of the radial direction
           from the fitted centre; (b) face incenter within 10% of the
           fitted radius from the sphere surface.
        7. Final sphereFit() on the surviving points. Warns if RMSE>25mm.

      Pipeline B -- Kai et al. (2014) method, offered as a faster/simpler
      alternative: STAPLE/algorithms/private/Kai2014_femur_fitSphere2FemHead.m
      (cites Kai, S. et al., J. Biomech. 47(5):1229-1233, 2014,
      doi:10.1016/j.jbiomech.2013.12.013)
        1. Find the most-proximal point along the inertial Z0 axis.
        2. SLICE the proximal femur with planes perpendicular to Z0,
           starting 0.25mm below the most-proximal point and stepping down
           1mm at a time (TriPlanIntersect -- a mesh/plane intersection
           producing one or more closed boundary curves per slice).
        3. While slicing: if a slice has >1 curve, keep only the
           LARGEST-AREA curve's points (the rest are femoral-neck/other
           artefacts) and track the running maximum area; STOP slicing once
           the area of the largest curve starts DECREASING (interpreted as
           having passed from the roughly-spherical head into the
           narrower neck) or once exactly one curve remains after having
           seen >1 previously.
        4. sphereFit() on all accumulated slice-boundary points (filtered to
           the medial side only, via the Y0 axis). Warns if RMSE>20mm.

      Both write CS.CenterFH_Renault/RadiusFH_Renault (GIBOC) or
      CS.CenterFH_Kai/RadiusFH_Kai (Kai) -- i.e. STAPLE keeps both estimates
      rather than silently picking one.

   2. KNEE CENTRE + FLEXION AXIS -- TWO further alternatives on the femur
      side, both operating on the two POSTERIOR CONDYLE point sets (already
      segmented from the distal femur by an earlier step,
      GIBOC_femur_filterCondyleSurf.m/sliceFemoralCondyles.m -- not detailed
      here):

      Two-sphere method: STAPLE/algorithms/CS_femur_SpheresOnCondyles.m
        sphereFit() separately on the lateral condyle points and the medial
        condyle points -> center_lat/radius_lat, center_med/radius_med.
        KneeCenter = 0.5*(center_lat + center_med). The mediolateral knee
        axis Z = normalize(center_lat - center_med) * (side sign, +1 right/
        -1 left); the femur's mechanical (proximal-distal) axis
        Y = normalize(CenterFH_Renault - KneeCenter); X = cross(Y,Z),
        re-orthogonalised.

      Cylinder method (more accurate, used by default):
      STAPLE/algorithms/CS_femur_CylinderOnCondyles.m, which explicitly
      DEPENDS ON the two-sphere method above to seed its initial guess:
        Axe0 = center_lat - center_med (initial axis)
        Center0 = midpoint of the two sphere centres
        Radius0 = mean of the two sphere radii
        [x0n, an, rn] = lscylinder(pooled_condyle_points, Center0, Axe0,
                                    Radius0, tolp=0.001, tolg=0.001)
        -- a nonlinear Gauss-Newton least-squares CYLINDER fit (the LSGE
        toolbox, I.M. Smith, National Physical Laboratory, 2002; see
        STAPLE/GIBOC-core/SubFunctions/FittingFun/LSGE/lscylinder.m for the
        full iteration -- minimises the sum of squared radial distances
        from each point to the fitted cylinder surface, iterating point-
        on-axis x0n, axis direction an and radius rn from the sphere-based
        seed until the step length / gradient tolerances are met).
        The fitted axis an becomes the knee flexion/extension axis; the
        knee centre is the midpoint of the two condyles' area-centroids
        PROJECTED onto that cylinder axis (not the sphere-based KneeCenter).

   3. TIBIAL PLATEAU / KNEE CENTRE (tibia side):
      STAPLE/algorithms/CS_tibia_Ellipse.m
        1. Fit a least-squares plane to the proximal tibial epiphysis
           articular-surface points (lsplane(), constrained roughly
           perpendicular to the already-estimated proximal-distal axis).
        2. Fit an ELLIPSE to the boundary curve of that articular surface,
           projected onto the fitted plane
           (fitEllipseOnTibialCondylesEdge.m).
        3. The ellipse's CENTROID is the tibial-side knee-centre estimate;
           its major axis gives a further mediolateral-direction estimate,
           reconciled with the femur-side Y0 by a sign check
           (sign(Yelps'*CS.Y0)).

   4. PELVIS COORDINATE SYSTEM (the ISB/Wu-et-al.-2002 standard):
      STAPLE/algorithms/CS_pelvis_ISB.m -- the WHOLE function, verbatim
      logic (it is 6 lines):
        Z = normalize(RASIS - LASIS)                         -- mediolateral
        pseudoX = normalize( midpoint(RASIS,LASIS) - midpoint(RPSIS,LPSIS) )  -- roughly anterior
        Y = normalize(cross(Z, pseudoX))                      -- superior
        X = normalize(cross(Y, Z))                            -- true anterior (re-orthogonalised)
        origin = midpoint(RASIS, LASIS)
      NOTE, worth recording: this is the textbook ISB pelvis frame
      definition (four bony landmarks: right/left ASIS + right/left PSIS),
      and it produces the SAME +X-anterior/+Y-superior/+Z-subject's-right
      convention that tools/fit-osim.js independently confirmed, from
      totally different evidence (gravity vector + mirrored hip joint
      centres), inside Rajagopal's own OpenSim pelvis frame. Two unrelated
      projects implementing the same published ISB standard converging on
      the same signed convention is a genuine (if informal) cross-check
      that neither project's axis-verification was a fluke -- not proof
      that Rajagopal's actual numeric frame and STAPLE's algorithm would
      agree bit-for-bit on any real specimen, just that they mean the same
      thing by "+X/+Y/+Z" when they say it.
   ========================================================================== */

// ---------------------------------------------------------------------------
//  VERIFICATION
// ---------------------------------------------------------------------------
const issues = [];

for (const id in bones) {
  const b = bones[id];
  if (b.triangles <= 0) issues.push('bone ' + id + ': non-positive triangle count ' + b.triangles);
  for (let a = 0; a < 3; a++) if (b.boundingBoxMm.min[a] > b.boundingBoxMm.max[a]) issues.push('bone ' + id + ': bbox min > max on axis ' + a);
}
if (!bones.femur_r) issues.push('expected femur_r.stl is missing');
if (!bones.pelvis) issues.push('expected pelvis.stl is missing');

// plausibility: femur/tibia dominant-axis extent should be a plausible adult bone length
if (bones.femur_r) {
  const femurLen = Math.max(...bones.femur_r.boundingBoxMm.sizeMm);
  if (!(femurLen > 350 && femurLen < 500)) issues.push('femur_r dominant-axis extent ' + femurLen + 'mm outside plausible adult 350-500mm range');
}
if (bones.tibia_r) {
  const tibiaLen = Math.max(...bones.tibia_r.boundingBoxMm.sizeMm);
  if (!(tibiaLen > 300 && tibiaLen < 450)) issues.push('tibia_r dominant-axis extent ' + tibiaLen + 'mm outside plausible adult 300-450mm range');
}

console.log(issues.length === 0 ? 'verification: PASS' : ('verification: FAIL (' + issues.length + ' issue(s))'));
for (const iss of issues) console.log('  - ' + iss);

console.log('\ncounts: ' + JSON.stringify(staple.counts, null, 2).replace(/[{}"]/g, '').trim());

// Cross-check against the OTHER two sources this project already has for
// (parts of) the lower limb: data/rajagopal.json (a third individual) and
// tools/fit-tlem.js's TLEM2 AnyScript extraction (the SAME individual as
// this file, per the shared Carbone et al. 2015 citation -- so THIS
// comparison, unlike the Rajagopal one, is a same-subject check and
// closer agreement is actually expected, not just plausible).
if (bones.femur_r) {
  const femurBboxLen = Math.max(...bones.femur_r.boundingBoxMm.sizeMm);
  console.log('\ncross-check, femur:');
  console.log('  this file (STAPLE/TLEM2 bone mesh) femur_r bounding-box longest extent: ' + femurBboxLen.toFixed(1) + 'mm');
  console.log('  data/rajagopal.json (a DIFFERENT, separately-imaged subject) segmentLengthsMm.femur: 408.05mm -- agreement not expected');
  console.log('  data/bodyparts3d.json (a THIRD, separately-segmented subject) FMA24474 bbox Z-size: 440.22mm -- agreement not expected');
  console.log('  data/tlem.json, if it existed (see tools/fit-tlem.js -- NOT shipped, see that file\'s header) reports 368.01mm hip-JOINT-CENTRE-to-knee-JOINT-CENTRE for the SAME cadaver as this file -- expect THIS bbox extent (whole-bone, tip to tip) to be SOMEWHAT LARGER than that joint-centre-to-joint-centre figure, since the bone surface extends beyond both joint centres at each end; run tools/fit-tlem.js yourself against a licensed AMMR checkout to compare the actual number.');
}
if (issues.length) process.exitCode = 1;
