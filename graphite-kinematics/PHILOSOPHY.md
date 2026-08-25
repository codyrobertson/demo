# Graphite Kinematics

*An algorithmic philosophy for the articulated hand*

---

## I. The Movement

**Graphite Kinematics** holds that the hand is not a shape to be drawn but a *mechanism to be solved*, and that the solution — if it is honest — draws itself. Every contour a hand presents to the eye is the downstream consequence of twenty-seven bones held in tension by ligament, tendon and skin. An artist who draws the outline is copying an effect. An algorithm that solves the linkage *generates* the cause, and the outline falls out of it for free, in every pose, from every angle, forever. This movement is built on that inversion. Nothing here is drawn. Everything here is *derived*.

The discipline is total. A hand has twenty-three meaningful degrees of freedom before the wrist is counted, and each one is bounded by real cartilage: the proximal interphalangeal joint will flex one hundred and ten degrees and will not hyperextend; the metacarpophalangeal joint spreads twenty degrees when straight and almost none when bent, because the collateral ligaments go taut as the cam-shaped condyle rolls under them. These are not aesthetic choices. They are constraints, and constraint is the engine of beauty. A generative hand that can fold backwards is not more expressive — it is broken, and the eye knows instantly. The pose space must be sampled only from within the manifold of the anatomically possible, and every sample inside it must be plausible. This is the product of painstaking calibration: joint limits measured, coupling ratios tuned, the two-thirds rule linking distal to proximal interphalangeal flexion, the quadriga that drags the little finger along when the ring finger closes. Every ratio in the system was chosen the way a master craftsman chooses a tolerance — because the mechanism fails without it.

## II. The Plane

Everything resolves to the plane. There is no shading in this world, no gradient, no rendered volume, no light source. There is only the mark — a graphite line laid on paper by a hand that is not perfectly steady. Form is carried entirely by *where the lines go* and *how many of them there are*. This is the severest constraint the movement imposes and its greatest source of power: a flat drawing that reads as a solid hand has earned that reading through the accuracy of its contour and the truth of its folds, not through the cheap trick of tone.

So the algorithm is planar twice over. It is planar in *output* — pure linework on paper, every stroke a curve in two dimensions. And it is planar in *construction* — every crease, every wrinkle set, every ridge of a fingerprint is authored in a two-dimensional surface coordinate system that is *wrapped onto* the three-dimensional form and then flattened back by an orthographic projection, so that a fold drawn once in flat parameter space is correct in every pose and from every viewing angle, curving where the finger curves, foreshortening where the finger turns away, vanishing over the horizon of its own silhouette. This is the meticulous part. This is where the hours go. Anyone can draw a knuckle wrinkle. Building a surface parametrisation in which the knuckle wrinkle *is a fact about the skin* rather than a mark about the picture is the work of someone who has thought about this for a very long time.

## III. The Fold

The fold is the movement's central subject, and folds obey a law: **skin does not stretch, it gathers**. On the flexion side of every joint the skin has surplus, and that surplus must go somewhere — so as the joint closes, one faint line becomes two, becomes three, becomes a tight bunched sheaf pressed into the crease. On the extension side the opposite: the lattice of diamond wrinkles over a straight knuckle is drawn taut and erased as the joint bends. Fold count, fold depth, fold spacing and fold darkness are all continuous functions of joint angle, and they must be, because a hand whose creases do not respond to its pose is a mannequin. The proximal interphalangeal joint takes two creases, not one. The metacarpophalangeal crease sits distal to its own joint, over the base of the proximal phalanx, which is a fact almost nobody draws correctly and which the algorithm gets right without being asked.

Below the folds, finer orders of structure, each generated rather than placed: friction ridges flowing around a core and a delta in loops and whorls and tented arches, sampled per digit from real dermatoglyphic frequencies; the palmar creases that palmistry gave romantic names to and anatomy gave none; the dorsal venous network branching from the wrist toward the knuckles; the nail with its lunula and its eponychial fold and its free edge. Detail is not decoration here — it is *evidence*. The reason the drawing convinces is that it keeps answering questions the viewer did not know they were asking.

## IV. The Mark

Graphite is a physical process and must be simulated as one. A pencil does not draw a line; it deposits particles into the tooth of a paper, and the darkness at any point is the accumulated deposit of every pass that crossed it. So the mark system is an accumulation field, not a stroke list: density is added, never composited, and tone-mapped once at the end through a saturating response, so overlapping passes darken exactly as layered graphite darkens and never as opacity stacks. Pressure tapers at the entry and exit of every stroke, because a hand lifts. A low-frequency wobble runs along each path, because a hand is not a plotter. The paper has grain, and the grain modulates deposition, because it does. Contours take three passes and search a little; creases take two; ridges take one, whisper-light. What is occluded is not deleted but *ghosted*, drawn faint, the way a draughtsman leaves construction visible under the finished line.

None of this is a filter applied afterward. It is the medium the geometry is expressed *in*, tuned across countless iterations until the accumulation constant, the grain scale, the taper exponent and the wobble wavelength sit in the exact relationship that makes a screen of pixels read as pressed graphite. That relationship is the movement's signature and it was expensive to find.

## V. The Seed

Every seed grows a *different hand* — not a different pose of the same hand, a different hand. Bone lengths perturb within real anthropometric variance. The fingerprint of each digit is drawn independently from the population distribution of arches, loops and whorls. The palmar crease pattern varies, and rarely — as rarely as in life — the two transverse creases fuse into a single one. The venous network is regrown. Knuckle hair is regrown. Nail curvature, web height, the depth of the transverse metacarpal arch, the exact set of the little finger's habitual camber: all of it resampled, all of it within the envelope of a real population. And then, orthogonally, the pose is sampled: from named intentions — the fist, the pinch, the point, the cup, the relaxed cascade of a hand at rest — or from the open manifold itself, joint by joint, coupled and constrained.

The result is that the algorithm does not produce a picture of a hand. It produces the *space of hands*, and the picture is only ever a single point sampled from it. Turn the seed and a stranger's hand appears. Turn the pose and it moves through its full range, every joint, every fold answering. This is what the movement is for.

---

*Process over product. Constraint over invention. The mechanism first, and the drawing as its shadow.*
