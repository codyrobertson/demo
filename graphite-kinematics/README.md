# Graphite Kinematics

A fully articulated generative hand, drawn as flat pencil linework.

Nothing here is drawn — everything is *derived*. A skeleton of twenty-seven bones is
solved through twenty-five degrees of freedom, every one bounded by measured joint
limits; the silhouette, the creases, the fingerprints and the folds all fall out of
that solution and are laid down as graphite on paper.

See [PHILOSOPHY.md](PHILOSOPHY.md) for what the piece is *for*.

---

## Status

The engine is working: rig, surfaces, occlusion, features and the graphite renderer
all run end to end. The interactive viewer is still to come.

## Layout

```
PHILOSOPHY.md        the algorithmic philosophy this expresses
src/00-math.js       seeded RNG, value noise, vectors, curves
src/10-anatomy.js    bone metrics, joint envelopes, per-seed hand generation
src/20-rig.js        forward kinematics, surface parametrisation, silhouettes
src/30-pose.js       presets, anatomical coupling, sampling, range-of-motion tour
src/40-pencil.js     the graphite deposition field
src/50-features.js   creases, folds, webs, nails, fingerprints, palmar lines
src/55-dorsal.js     tendons, veins, hair, skin lattice, skeleton
src/60-render.js     projection, depth field, occlusion, mark laying
tools/               offline render harness (node, writes PNGs)
vendor/p5.min.js     vendored so the viewer works offline
```

## How it fits together

**Anatomy → rig.** `buildAnatomy(seed)` grows one unique hand: bone lengths perturbed
within real anthropometric variance, a fingerprint class drawn per digit from
population frequencies, a palmar crease pattern that is occasionally simian, a fresh
venous network. `solve(anatomy, pose)` runs forward kinematics over the chain and
hands back world-space frames.

**Surface coordinates.** Every mark is authored in the parameter space of the surface
it lives on — `(s, alpha)` along and around a digit segment, `(u, beta)` along and
around the palm. A crease drawn once in flat parameter space is therefore correct in
any pose and from any angle: it curves where the finger curves, foreshortens where the
finger turns, and vanishes over the horizon of its own silhouette.

**Folds answer the joints.** Fold count, depth, spacing and darkness are continuous
functions of joint angle. On the flexion side skin gathers — one faint line becomes a
bunched sheaf as the joint shuts. On the extension side the wrinkle lattice is drawn
taut and erased. The metacarpophalangeal crease sits *distal* to its own joint.

**Occlusion.** A two-layer peeled depth field carries the identity of the part that
wrote each fragment, so a silhouette is never occluded by the solid it belongs to,
tolerances widen where the depth field is steep, and every contour is weighted by the
depth step it actually describes — which is why a thenar swells into a palm instead of
sitting on top of it. What is hidden is ghosted rather than deleted, fading with depth.

**The mark.** Graphite accumulates into a float field and is tone-mapped once, at the
end, through a saturating response, so overlapping passes darken as layered graphite
does and never as stacked opacity. Pressure tapers at both ends of a stroke, a
low-frequency wobble runs along each path, and the paper has grain that modulates
deposition.

## Rendering offline

```bash
node tools/shot.js  <preset> <seed> <az> <el> [out.png] [size]
node tools/sheet.js <out.png> "preset:az:el,..." [cell] [cols] [seed]
node tools/iso.js   <preset> <az> <el> <out.png>    # per-layer isolation strip
node tools/fit.js                                   # refit thumb opposition by IK
```

Presets: `rest flat spread fist grip pinch ok point peace thumbsUp claw cup tripod
hook wave countThree hyperextend clenchMax`.

Azimuth 0 looks at the back of the hand, 180 at the palm, ±90 at the flanks;
elevation tips toward the fingertips.
