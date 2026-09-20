# Stage 3.5.6 — handoff: the ink-density river field

Written for a reader who has not seen the work. It states what changed, what is
evidenced, what is broken, and the one question that is currently blocking.

## 1. The brief this is answering

Turn the site from a procedural-terrain / Three.js demo into a realtime creative
technology showcase whose first impression is *one abstract data river, formed by
erosion, deposition, diffusion and computation density, which the visitor can
disturb by dragging and travel along by scrolling into a large computing
environment.* The one reference quality named first is river curvature; the
forbidden list includes closed river banks, glass ribbons, concentric circles,
uniform particle fields, and uppercase wide-tracked technical labels.

Hard constraints that must not be broken: `RendererRuntime` owns backend and
quality, `SceneHost` is the semantic integration boundary, `CameraController`
owns the camera, the Command Bus and graph semantics stay intact, the descriptor
stays deterministic and free of Three.js, telemetry stays truthful, and no frame
may be driven by React state.

## 2. Repository state

    repository : Polnareff258/compute-atlas
    branch     : master
    commit     : 3ad10df  "feat: drive the composition from an advected ink-density river field"
    baseline   : 220fb43  (the review baseline; unchanged when this work began)
    tree       : clean, in sync with origin/master

    npm run typecheck   passes
    npm run lint        passes, 0 errors 0 warnings
    npm test            26 files / 197 tests pass
    browser console     0 errors, 0 fatals on every capture batch

## 3. What was rebuilt

Everything in `src/scene/ink/` is new and is the composition:

| file | what it owns |
|---|---|
| `inkDensity.ts` | the CPU bake of the river's density field: body, scour, settle, along, plus a fluvial texture carrying the tangent and speed |
| `inkField.ts` | GPU advection of that field, with the pointer as a pressure imprint |
| `inkMaterial.ts` | the hero shading model, written as a 70/20/10 hierarchy |
| `inkSurface.ts` | the graded corridor the ground is built from |
| `inkBasin.ts` | the convergence basin, partitioned against the corridors |
| `inkDomains.ts` | the five regions, as local terms in the field |
| `riverCourse.ts` | the curvature the descriptor's authoring lines do not carry |

Supporting: `src/scene/scroll/scrollChoreography.ts` (progress to act, layer
weights, type opacity, camera authority), `src/scene/domains/domainLabels.ts` and
`src/ui/DomainLabels.tsx` (the five regions projected to screen and carried in the
DOM), `src/scene/camera/heroShot.ts` (the resting framing and the scroll stations),
and rewrites of `RiverView`, `TerrainView` and `BasinView`.

`CameraController` gained a scroll track that it *blends over* the shot it is
already playing. The scroll supplies a pose; it never writes to a camera.

## 4. Defects found by measurement, and fixed

Each of these was found by running the thing rather than by reading it.

1. **Coincident surfaces.** Every corridor is displaced by the same density field
   sampled by world position, so any two overlapping corridors are *exactly*
   coincident surfaces and z-fight. A vision pass described the result as
   "shattered, jagged, disconnected fragments — a graphical glitch", 2/10. Fixed
   by a Voronoi ownership partition in `inkSurface`, and the same rule applied
   from the other side in `inkBasin`.
2. **A saturated shading term.** The normal response dotted a raw density gradient
   divided by a 0.0035 UV offset into the key direction. Its magnitude is in the
   hundreds, so it exceeded the clamp on essentially every fragment and the frame
   was uniformly lit. Fixed by normalising the gradient to a unit direction.
3. **Reduced motion that did not reduce motion.** Three clocks (the ink field, the
   flow phase, the camera drift) kept running under the preference, so the capture
   harness's readiness probe could never stabilise and the reduced-motion frame
   could not be produced at all. Now all three hold.
4. **The scroll camera returned to the opening pose at the end of the story.**
   `cameraAuthority` was written to fall to zero exactly at progress 1, and
   releasing authority means the controller blends back toward the shot it is
   playing — which is the opening framing. Measured through the projected DOM
   labels: 981,389 at progress 0 against 984,389 at progress 1.
5. **An off-by-one that made the computed reveal framing unreachable** — the
   condition selecting the final station used `===` where the loop had already
   settled on the last index, so it never fired.

## 5. What is verified, with numbers

Baseline against current, 1920x1080 ULTRA WebGPU, same seed:

| metric | baseline 220fb43 | now |
|---|---|---|
| luminance p50 | 45.8 | 16.6 |
| luminance p90 | 67.7 | 138.5 |
| luminance p99.9 | 124.5 | 171.3 |
| spread (p99.9 - p1) | 103.2 | 161.4 |
| near-grey share | 0.04% | 3.75% |
| worst single colour share | 6.5% | 46.8% (near-black) |

Other measured results:

- **Drag**: 4.30% of pixels change (89,172 px), against a 0.3% visibility floor.
  The difference mask is a narrow elongated streak with a taper, not a circle.
- **Scroll**: document 3024 px against a 1080 viewport, i.e. a 1.8-viewport range.
  All five keyframes land with 0.00% drift.
- **Reverse scroll**: every reverse frame matches its forward counterpart
  (33.8/33.8, 58.2/58.3, 48.3/48.4, 50.1/50.1, 34.1/34.1); at 50% only 3.75% of
  pixels differ, mean absolute difference 1.99 of 255, concentrated in the water.
- **Surface quality**: speckle 0.040% against the baseline's 0.039% and isolated
  extrema 0.002% against 0.001% — i.e. the current frame has the same isolated
  noise as a frame known to be clean, which is the evidence that the z-fighting is
  gone. WebGL2 measures 0.041%, confirming both backends run one shader graph.
- **Quality tiers differ structurally**: ULTRA against SAFE 9.15% of pixels,
  against MEDIUM 3.67%. For scale, the reverse-scroll comparison above is 3.75%.

Evidence tooling is in `scripts/`: `stage356-capture.mjs` (the CDP harness, with
scroll, reverse and drag evidence), `frame-stats.mjs`, `frame-ascii.mjs`,
`frame-quality.mjs`, `frame-diff.mjs`, and the in-repo diagnostic
`src/scene/ink/inkDensity.probe.test.ts` which prints the baked field.

## 6. The blocking problem

**At the end of the scroll story, none of the five regions is within the frame.**

The last act is called "world reveal" and is supposed to show the river opening
into the basin with the five regions around it. Measured through the projected DOM
labels at progress 1: **0 of 5 visible.**

What was measured about the world:

    world span  : x 960  z 760   centroid 40,-480
      region ai             centre -440, -520   radius 220  delta
      region graphics       centre  520, -310   radius 240  terraces
      region game-analysis  centre -440, -100   radius 200  ravine
      region systems        centre  480, -640   radius 250  strata
      region research       centre  -40, -860   radius 280  expanse
    required eye for 16:9 with 35% margin: 1152

The station that was in use sat at an eye of about 213 — roughly five times too
low to contain them. That has now been replaced by a computed `revealStation()`
which derives the eye from the descriptor's own basin and region centres and
radii, and the off-by-one that stopped it being selected has been fixed. **It
still does not work**: at progress 1 the visible-region count is still 0, and the
sampled label's transform is frozen at its progress-0.5 value, which means the
projection is judging every region not visible.

Hand calculation says an eye of 1152 should cover them: the regions sit within
-440..+520 and -560..+200 of the look target, while the frame half-extents at that
height are about 885 across and 533 deep. The measurement disagrees, so there is a
further defect that has not been located.

**The next diagnostic, and it should be done before any further framing change:**
at progress 1, print the projection's own intermediates — the camera position and
look target actually in use, and for each region the projected x, y and z, the
`behind` flag, and the `onFrame` flag. That distinguishes the two candidate causes:
the camera not reaching the computed station, versus the visibility test
rejecting regions that are in frame.

Everything after that is framing work, and doing it before that measurement is
known to be blind — the previous round was spent on a framing change that the
measurement then showed had no effect.

## 7. What is not done, stated plainly

- The reveal does not frame the five regions (above).
- The scroll's hand-off to free interaction is owed. Releasing the scroll's
  authority currently means returning to the opening pose, which is why the
  falloff was removed. A correct hand-off needs the controller to adopt the arrival
  pose as its own resting pose and then give up authority, so that hover and focus
  continue from where the story ended.
- `shots.ts`'s focus choreography still travels the descriptor's straight
  authoring spines, so a focus move runs beside the visible river rather than along
  it. Known and recorded, confined to the secondary shots.
- The upper third of the held frame is still empty: the far field fades before any
  content arrives there.
- Gradient energy is 0.74 against the baseline's 0.874, so the frame is still
  softer than the composition it replaced.
- Domain hover and focus do not make a region locally clear. The regions are terms
  in the field and are labelled, but they do not yet respond individually.
- No resource soak, and MEDIUM/SAFE were captured once each.

## 8. A constraint on how this was verified

The vision backends available to the agent were rate-limited for essentially the
whole session. Almost every visual judgement in section 5 therefore comes from
pixel measurement rather than from looking: the four `frame-*.mjs` tools were
written to make questions like "is the geometry shattered" answerable numerically,
and the DOM label projection turned out to be a better diagnostic than the pixel
statistics for the scroll — it caught the camera returning to the opening pose,
which the pixel metrics had hidden behind a simultaneous change in shading.

The practical consequence for whoever picks this up: **prefer a measurement over a
reading, and where a claim cannot be measured, say it cannot.**
