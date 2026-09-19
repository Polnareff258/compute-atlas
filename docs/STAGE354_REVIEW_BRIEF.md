# Stage 3.5.4 — Visual Identity Re-Foundation: review brief

Written to be read **instead of** the transcript. If you are reviewing this
stage, everything you need to check is below, and every claim carries either a
command that reproduces it or a file that contains it.

Supersedes `docs/STAGE353_REVIEW_BRIEF.md` for regeneration. That stage's entry
checks passed and its visual layer is largely gone: this stage was licensed to
delete, merge and rewrite the visual implementation of the Core, the domains,
the routes, the field, the atmosphere and the camera, and it did.

Baseline: `03ce476` (`feat: make the routing field a density per unit of route,
and blunt the Core`). This stage is the five commits after it:

```
e8384e2  rebuild the hero as an apertured monolith on one surface system
b132878  give the backdrop a value of its own, and the mass a body
f134f1a  make the routing field a volume, and the Core a mass with a slot
7642d0b  grade the backdrop, move the parting rail, and cut the idle routes to two
a880637  keep the idle weave a texture, and stop it reading as scribble
```

`03ce476..a880637` is 28 files, +3654 / −1106. Every lower-layer boundary in
§11 is intact.

---

## 1. What was actually wrong

Named from the frames, then root-caused to an expression. The brief's complaint
was "a low-poly Three.js diagram, not a computational environment"; that
decomposed into eight defects, each of which had a specific cause.

**1.1 The Core was a body with a hole through it.**
`APERTURE_FLOOR` was drawn at the `interior` tier, which resolves to the same
value as the void beyond the frame. The opening was therefore not a recess the
eye looks into, it was a hole through the body to the background — and a ring
with a hole in it is a picture frame. Compounding it, the parting rail ran down
the *middle* of the deck, immediately against the dark aperture, so rail and
opening merged into one dark outline and the whole front read as a rectangular
frame around a void.
→ `APERTURE_FLOOR` is `primary` on a `recess` surface, and the rail is outset
`BEZEL_RAIL_OUTSET = 0.66` of the wall width so the aperture's lip is lit plate.
This was the single largest visual change of the stage.

**1.2 The aperture was too large for the body, so the body read as a wall.**
At `2.12 × 1.51` the opening was 59% of the body's width and 52% of its height.
The wall thickness ratio was `0.23 : 0.56` — 2.4:1, which read as a torus.
→ The wall was walked out to `0.32 : 1.32` (4.4:1) and the opening is now
`1.86 × 1.03` — 52% of the width, 36% of the height. The documented conclusion is
that the ratio stopped mattering once the opening was the right size, which is
the correct cause to have found.

**1.3 The backdrop was four nested rectangles, not a gradient.**
Four plates stepped roughly five luminance on local values of 8–16. A probe
across the left background of an idle capture read `7.9 → 13.1 → 15.7`: **steps
of five, on a local value of eight**, so every edge was a third again as bright
as what it sat on.
→ Seven plates over a narrower ladder; the largest step in the stack fell from
`0.17` to `0.10` of a fog factor, and the per-plate roll became a monotone fan
(an alternating roll reads as a pinwheel; a fan reads as one layered field).
Separately, the stack had been drawn in the `interior` tier, which is dark
enough that the whole backdrop resolved *below* the scene background — the
"background" was a hole slightly blacker than the void. `backdrop` is now its
own palette tier.

**1.4 Idle drew five complete routes from the Core to five domains.**
`ROUTE_VISIBILITY_FLOOR` was `0.12`, which culled only the routes that were
already gone. The idle domain group weight was `0.34`, comfortably above it. So
idle was a hub with spokes drawn on it — the brief's "central node with five
radial lines", exactly.
→ The floor is `0.26`, above what a domain carries at rest, and the idle domain
group weight is `0.2`. Idle now shows the two shared trunks and nothing else.
**Nothing was deleted**: the same curves at the same weights fall below a
threshold that already existed and moved.

**1.5 The routing field was sparse dashes with no volume.**
Every packet was drawn exactly on its curve, so a route was a line with dots on
it however many dots there were, and the only way to make traffic read as heavy
was to draw more of them.
→ Packets of one route are scattered across a per-class band with an independent
through-axis (`ROUTE_CLASS_SPREAD`, `deriveDashScatter`), the band tightens
toward the Core and opens toward the destination (`deriveDashSpread`), and it
deploys with the field's own `compression`. One route is now a braid of
filaments that accumulates into a sheet under additive blending, and `secondary`
and `signal` bands are narrower than `primary`, so a trunk is a cable and an
ingress is a socket.

**1.6 Every packet was sized in curve progress, so a packet was a blob on one
route and a hairline on the next.**
A fixed slice of progress is 25 pixels on a two-and-a-half-unit trunk and five on
an eight-tenths loop inside the Core, and the width was an absolute 3–5 px —
which is the number a packet has to be wrong in to read as wire.
→ Packet length is a world-unit quantity divided by the curve's own length, and
width is a fraction of that packet's own world length, so every packet on every
route is between 4:1 and 6:1 and none can become a dot at any quality profile.

**1.7 The membranes never rendered at all.**
The membrane tier faded by ordered dither: an alpha map plus an alpha test.
Three samples an alpha map in the green channel; the map was built as a
single-channel red texture; every membrane fragment in the scene was discarded
against a constant zero. The second half of the defect was waiting behind the
first — at roughly two hundred pixels per world unit, a Bayer cell of one or two
pixels aliases into a visible checkerboard across a large plate.
→ A genuine blend, `deriveMembraneOpacity(fade) = 0.16 + fade × 0.3`. This is
the one defect in the list that no screenshot could have shown and no test
caught, because a membrane that is invisible is indistinguishable from a
membrane that is absent.

**1.8 The Core's scale had outgrown the camera.**
`BASE_CAMERA_DISTANCE` was `9.1`, which was right for the Core it was measured
against. The Core was then rebuilt and `LOCAL_BOUNDS` grew by half again
(`[1.5, 1.05, 0.85]` → `[1.84, 1.5, 0.68]`, `CORE_SCALE 1.34` → `2.2`), and nobody
re-measured. By the new bounds the mass read at `0.81` of the frame's height,
and counting the folds that leave the outline it filled the height edge to edge:
the hero was the page.
→ `BASE_CAMERA_DISTANCE = 11.5`, which puts the hero's `4.05 × 3.30` half-extents
at `0.64` of the frame's height and `0.45` of its width.

---

## 2. Modified visual systems

Seven systems. Each owns one thing, and the seams between them are named where a
reviewer would otherwise have to guess.

**2.1 The Core — `core/coreStructure.ts` (the largest single file in the stage).**
One asymmetric closed-path monolith: `MONOLITH` (a stepper open deck), four
folded shells (`CROWN_FOLD`, `FLANK_FOLD`, `INNER_SHELF`, `LOWER_LIP`), a front
bezel derived from the monolith's own points and pushed radially outward, ten
wafers, compute dies, an interior bus, five aperture membranes, four machined
routing manifolds, two attached processing assemblies with three shoulder
plates, edge liners and a foreground blade. Detail gates at `WAFER_DETAIL 0.25`,
`MANIFOLD_DETAIL 0.45`, `MEMBRANE_DETAIL 0.6`, `ASSEMBLY_DETAIL 0.72`,
`DIE_DETAIL 0.88`. Geometry language is descriptor-driven: `CoreStructureShape`
is now `hull | volume | beam | membrane | port | slice | path`, where `path` is a
new tapered swept profile with per-point width and height, and `hull` takes
per-section half-extents and a chamfer.

**2.2 The surface system — `materials/machinePalette.ts`,
`materials/surfaceGeometry.ts`, `materials/structureGeometry.ts`,
`core/CoreStructureView.tsx`.**
One palette and one response table for every surface in the scene. The role set
is now `shell | edge | recess | accent | membrane | port`, and each role carries
seven response increments (`gainAtRest`, `gainFromActivity`, `gainFromFocus`,
`gainFromProximity`, and three fade equivalents), so a surface can answer the
routing field's *proximity* independently of its own activity — which is what
lets a manifold light where the flow is rather than everywhere at once.
Geometry is baked per `SurfaceClass` with orientation luminance and depth
darkening pre-multiplied into vertex colours (`CLASS_DEPTH_DARKENING`: shell
0.34, edge 0.18, recess 0.62, accent 0.12, membrane 0.5). The shell ladder was
lowered across the board — `shellHigh #cbdcd4 → #7c8a88`, `shellMid #8ea69f →
#475456`, `shellLow #546a67 → #263133` — because a body whose brightest face
lands in the middle of the range leaves the pale accent nothing to be an accent
against.

**2.3 The routing weave — `routing/routeDash.ts`, `routing/routeDashMaterial.ts`,
`routing/routeFlow.ts`, `routing/graphRoutes.ts`.**
The Hero GPU effect. One quadratic Bézier primitive for the Core's circulation
and the Graph routes alike; WebGPU evaluates it in the vertex shader, WebGL2
reproduces the same formulas on the CPU at lower density. The braid is
`ROUTE_CLASS_SPREAD` (`primary 0.085`, `secondary 0.055`, `signal 0.014`,
`ambient 0.035`) shaped by `deriveDashSpread`, with `ROUTE_FACING_AXIS` and a
blended fallback so a ribbon never tears at the axis handover. Motion is
`deriveDashEnvelope` (birth, carry, arrival wake) plus `compressRouteProgress`,
so packets bunch in front of an ingress under hover and focus instead of
travelling at constant spacing.

**2.4 The Graph→Core routing fold — `routing/graphRoutes.ts`.**
The manifest still owns five edges. The routing decides that two of them travel
a shared trunk before forking, so `Core port → shared trunk → branch → domain
ingress`. `IDLE_LEAD_WEIGHT 0.86` / `IDLE_TRAILING_WEIGHT 0.46`; a trunk that
carries the active domain goes to `0.78` on hover and `1` on focus while the
other falls to `0.12`/`0.05`.

**2.5 The domain bays — `graph/domainEnvironments.ts`,
`graph/DomainEnvironment.tsx`.**
Five architectures, not five frames: `packet-buffer` (AI: nested buffer layers
and branch compute slices), `framebuffer` (GRAPHICS: layered thin films and
sampling planes), `decision-chamber` (GAME ANALYSIS: paired comparison chambers
converging), `processing-stack` (SYSTEMS: vertical bus, dense decks, routing
backplane), `lattice` (RESEARCH: sparse probe structure and a transparent
analysis slice). Every one is now a closed body with a real back face and side
mass, `anchor..secondary` tiers, nothing thinner than about a tenth of a world
unit, and at least one `recess` panel and one membrane plate.

**2.6 The composition and the camera — `graph/layout.ts`,
`camera/cameraController.ts`.**
Domains moved out to radii that clear a Core with `4.05 × 3.30 × 1.50` half
extents (one excepted — see §10), and each carries a resting prominence:
core 1, graphics 0.74, systems 0.6, game-analysis 0.5, ai 0.28, research 0.24,
with `NAMED_DOMAIN_PROMINENCE = 0.35` deciding who carries a name at rest. The
camera is `CAMERA_FOV_DEGREES 48`, `BASE_CAMERA_DISTANCE 11.5`,
`IDLE_CAMERA_OFFSET_X -0.55`, `FOCUS_HALF_FRAMES 1.5`, per-axis aspect-resolved
framing, pointer parallax at 0.13/0.10 with damping 7/5, and reduced motion at
`AMPLITUDE_SCALE 0.42` with damping 12/11.

**2.7 The backdrop and the internal circulation — `scene/atmosphereDescriptor.ts`,
`scene/Atmosphere.tsx`, `core/coreCirculation.ts`.**
Seven nested plates plus a rear fill, sized by the angle they subtend from the
camera rather than by world constants, in the `backdrop` tier, `renderOrder -1`,
with every material pinned to `activity: 0, focus: 0`. The Core's own
circulation is three spine streams, one ingress reach per port and up to ten
crosslink loops through the aperture, in the same signal language as the routes.

---

## 3. Changed, deleted, replaced

**Deleted outright.** `VOID_MEMBRANES`, `BACK_MEMBRANE`, `FOREGROUND_CHIP` and
the whole "cut processing volume with a real void between its halves" layout in
`coreStructure.ts`; the `spineDirection` axis; the membrane *sweep* in
`coreCirculation.ts` (its own comment: the widest membrane is the full width of
the body, so the sweep was "a luminous arc spanning the entire hero — the single
largest piece of geometry in the Core that was not the Core"); the dither
alpha-map path in `surfaceGeometry.ts` (§1.7); the `membrane: boolean` field on
baked parts; and the `'volume'` and `'beam'` roles with their palette keys.

**Replaced by a different construction.**
- The Core: lofted hulls with a pointed taper → a closed-path monolith with a
  stepped deck, an aperture and folds. `LOCAL_BOUNDS [1.5, 1.05, 0.85]` →
  `[1.84, 1.5, 0.68]`, `CORE_SCALE 1.34` → `2.2`.
- `CoreStructureView`'s `{ solid, membrane }` material pair → one material per
  `SurfaceClass`, with `EDGE_VIEW_GAIN 1.1` capped at `EDGE_VIEW_CEILING 0.42`
  standing in for a rim light (a full fresnel "would put a rim light on every
  corner in the scene and make the mass look wet").
- The backdrop: three fixed-size world-space planes (`60×34`, `48×27`, `40×23`
  at z −21/−14.5/−10.2, "three draw calls, one value") → seven angle-derived
  plates plus a rear fill.
- The domains: a wide slab ("an icon of a machine") → a frame of thin members
  ("a wireframe of one") → the current closed bodies. The second attempt's own
  note is the useful part: a domain is drawn at about 250 px across, and an open
  front bounded by four members is, at that size, the *outline* of a rectangle.
- `DomainEnvironment`'s labels: every label used to sit at a fixed
  `+0.66 × extent` above its anchor, which for GRAPHICS is exactly where the
  route arrives, and its opaque plate "drew a black rectangle over the route's
  arrival and swallowed the one thing the focus frame is about".
- Domain movable materials: tinted with the palette's port colours, so every
  moving layer rendered as `portQuiet × tier` — "two mid-tones multiplied into a
  dark olive, which is why a focused GRAPHICS was a small dark-green mass under
  a bright Core". Now `#ffffff` under an `accent` / `port` role.
- GRAPHICS' front layer: it was both the largest plate *and* the only `anchor`
  tier, so a focused GRAPHICS was "one blank white card with three edges behind
  it". No layer is `anchor` now.
- SYSTEMS' decks: a tenth of a unit tall and a tenth of that deep ("which is a
  shelf") → `0.2 × scale` tall.
- The Core's crosslinks: one curve from every interior volume to the centre of
  the mass, which at twenty-five volumes "became a white starburst" → an
  angle-sorted loop of at most ten.
- `DomainEnvironment`'s `parts`: was `[...frame, ...movables]`, so at rest each
  movable sat on its own baked copy — "three to five coplanar pairs fighting for
  the same depth" — and once it moved, the merged copy stayed behind as a ghost.
  Now `trimmed.frame` only.

**Not deleted, but re-thresholded.** The five domain routes (§1.4), the route
packet count floor (`MIN_PACKETS_PER_CURVE` 3 → 1), the camera's
`MIN_CAMERA_DISTANCE` 4 → 5.

**A bug fixed in passing.** `coreCirculation.ts`'s crosslinks ran ids 40..52 and
the ingress runs 60..66. When the aperture was rebuilt with twice the interior,
the crosslinks reached 64 and five ids became shared — five streams drawn with
another route's brightness. Ids are now derived from three named bases.

---

## 4. WebGPU against WebGL2, measured

Same frame, same state, same quality. The capture harness was run twice on
WebGPU and once on WebGL2 at identical settings.

| pair | mean &#124;Δ&#124; | >2 | >12 | peak |
| --- | ---: | ---: | ---: | ---: |
| WebGPU vs WebGPU (independent runs) | 0.212 | 0.39% | 0.32% | 206 |
| WebGPU vs WebGL2, ULTRA 1920×1080 | 2.140 | 27.06% | 1.31% | 214 |
| WebGPU vs WebGL2, reduced motion | 2.117 | 27.04% | 1.32% | 217 |
| WebGPU vs WebGL2, SAFE | 2.216 | 28.75% | 1.23% | 193 |

`scripts/stage352-capture` is deterministic to a mean of 0.212 levels, so the
backend difference is real and roughly ten times the noise. It is **not**
animation phase: freezing the field (`--reduced-motion`, which drives
`motionScale` to 0 and takes every packet to a fixed representative phase)
leaves the number unchanged at 2.117. And it is **not** geometry density: it is
the same at SAFE, which has almost no interior. Point probes on matched
coordinates:

| point | WebGPU | WebGL2 | Δ |
| --- | ---: | ---: | ---: |
| backdrop, upper left | 8.65 | 8.58 | +0.07 |
| backdrop, lower right | 9.29 | 9.29 | 0.00 |
| backdrop, mid left | 7.86 | 7.79 | +0.07 |
| aperture interior | 38.09 | 35.16 | +2.93 |
| deck, lower left | 22.87 | 22.58 | +0.29 |
| deck, mid | 23.58 | 22.80 | +0.78 |
| mass, mid left | 29.37 | 27.66 | +1.71 |
| front face | 71.23 | 67.23 | +4.00 |
| front face, upper | 81.01 | 76.30 | +4.71 |
| crown assembly edge | 52.44 | 41.72 | +10.72 |

Histograms, 1920×1080 overview, frozen field: WebGPU p10/p50/p90/p99 =
`6.7 / 9.7 / 79.0 / 99.5`; WebGL2 `6.5 / 9.5 / 74.2 / 92.8`.

So: **the darks agree exactly and the brights do not.** The background is within
0.07 of a level; a lit face is 4–5 levels higher on WebGPU, a ~6% relative gain,
and the frame's single largest per-pixel difference is a route streak (peak 214)
landing where one backend had ink and the other did not.

This is the residual of the `e30e427` fix and it is **not root-caused here**.
The 3.5.2 double-apply is genuinely gone — that was a p50 ratio of 0.58;
`MeshBasicMaterial` is now the one structural path on both backends and
`MeshBasicNodeMaterial` is gone from structure entirely. What is left is a
one-directional, bright-arm-only gain whose shape is consistent with a
pre-fog multiplier (a gain applied before the fog blend would attenuate to
nothing at the backdrop's depth, which is what the probes show), but that is a
hypothesis, not a measurement, and it is not offered as a cause. §10 carries it
as an open item.

**On WebGL2's field specifically.** The CPU fallback repositions every packet
each frame, so it carries `deriveRouteDashDensity(false, detail)` = 1 + 4·detail
against the GPU field's 2 + 11·detail, under a `WEBGL2_DASH_CEILING` of 360
packets for the whole field. On the WebGL2 focus frame the Core→GRAPHICS trunk
reads as a chain of discrete bright dashes; on WebGPU at the same state it reads
as a bundle of filaments with visible compression. That difference is designed
and documented, and it is the one place where the Hero effect is materially
weaker on the fallback. The field's *selection* — which routes exist, which
culled, where a packet sits in its band — is identical, because the fallback
calls the same `deriveRouteDashIntensity`, `deriveDashScatter` and
`deriveDashSpread` the shader reproduces.

---

## 5. How each quality profile degrades

Measured against ULTRA on the same frame, same state, same backend:

| profile | mean &#124;Δ&#124; vs ULTRA | >2 | what changed on the frame |
| --- | ---: | ---: | --- |
| SAFE | 4.852 | 37.61% | no wafers, manifolds, dies or deck plates; two route lanes; the five bays at their frames only |
| MEDIUM | 3.768 | 36.78% | interior wafers and the four manifolds appear; three route lanes; the full trunk routing is drawn |
| HIGH | 3.504 | 36.36% | deck plates and the thicker interior set; four route lanes |
| ULTRA | 0 | 0 | everything, at full weave density |

`src/config/quality.ts` carries `coreStructureDetail` / `coreRouteLanes` /
`domainDetail` / `graphDensity` as safe `0.12 / 2 / 0.4 / 0.4`, medium
`0.6 / 3 / 0.68 / 0.65`, high `0.82 / 4 / 0.86 / 0.85`, ultra `1 / 4 / 1 / 1`,
plus `coreParticleBudget` and `pixelRatioScale`. SAFE keeps the monolith, the
aperture, the bezel rails, the two shared trunks and all five bay silhouettes —
the identity survives because those are the elements the identity is made of.
Direct measurement of SAFE against MEDIUM: mean |Δ| 1.885, 7.47% of pixels above
2, peak 221 — two visibly different frames.

**The harness's `spread` number is not a richness measure and must not be read as
one.** It is `max − min` over 24 000 sampled pixels (`analyzeFrame`,
`scripts/stage352-capture.mjs:1487`). Three consecutive ULTRA idle runs on this
machine reported `242.1`, `237.1` and `230.9`, and SAFE and MEDIUM both reported
`227.4` — the same two statistics can coincide while 7.47% of the frame differs.
It exists to catch a flat dark frame that has not loaded, which is what
`--min-spread` (default 10) is for. The profile ladder above is the measurement
to cite.

---

## 6. Motion, states and reduced motion

- **Idle** — the Core is the subject; the field runs `advectionSpeed 0.55`,
  `compression 0.18`, `wake 0.12`, `bendAmount 0`, `coreWeight 0.42`. Two trunks
  are visible and no branches. `coreWeight` was tried at 0.55 and reverted: at
  0.55 the aperture fills with bright crossings at every angle and the field
  stops reading as flow — "a weave drawn in light lines is a weave, and the same
  weave drawn bright is scribble."
- **Hover** — the target bay brightens through `presence` and `pose`, its route
  group goes to `0.86`, its trunk to `0.78`, unrelated domains to `0.14`, the
  field to `compression 0.58` and `bendAmount 0.16`.
- **Focus GRAPHICS** — the camera translates and dollies so the aperture, the
  active trunk and the bay form a diagonal; the other bays drop to
  `RECEDED_DOMAIN_PRESENCE = 0.26`; the target's route group is `1`, its trunk
  `1`, the rest `0.05`; `coreWeight 0.92`, `compression 0.88`, `wake 0.85`.
- **Escape** — everything above eases back at `APPROACH_RATE 3.4`
  (frame-rate-independent, pinned to 1 on a large step), with no teleport and no
  residual luminance.
- **Reduced motion** — `motionScale 0` freezes the field at a representative
  phase (`deriveDashPhase` returns `(phase + 0.42) % 1`), `REDUCED_MOTION_RATE
  22` shortens every transition, and `AMPLITUDE_SCALE 0.42` reduces pointer and
  focus damping. Composition, material layering and state distinction are all
  kept: the reduced-motion focus frame shows the same framing, the same receded
  bays and the same trunk filaments as the animated one.

The one motion transfer function is `easeApproach`, shared by routes, membranes
and domain poses, so a domain's membrane and the signal arriving at its ingress
cannot settle at different speeds.

---

## 7. Acceptance matrix

```
node scripts/stage352-capture.mjs --out <dir> --backend <webgpu|webgl2> \
  --quality <ultra|safe|medium|high> --sizes <WxH[,WxH]> \
  --states [<verb>-]<label>[@x,y][,<label>...] --thumb WxH [--text-hidden] \
  [--reduced-motion]
# add --no-assert only for exploratory frames; the default runs the assertions.
```

| batch | backend / quality / size / states | files | console |
| --- | --- | ---: | --- |
| A | webgpu / ultra / 1920×1080 / overview, hover-graphics, focus-graphics, escape | 5 | error 0, fatal 0 |
| B | A + `--text-hidden` | 7 | error 0, fatal 0 |
| C | webgpu / ultra / 2560×1440 / overview | 2 | error 0, fatal 0 |
| D | webgl2 / ultra / 1920×1080 / overview, hover-graphics, focus-graphics | 4 | error 0, fatal 0 |
| E | webgpu / ultra / 1920×1080 / overview, focus-graphics / `--reduced-motion` | 3 | error 0, fatal 0 |
| F | webgpu / safe, medium, high / 1920×1080 / overview | 6 | error 0, fatal 0 |

One 480×270 thumbnail is written per batch, from the `overview` state, which is
the file count's off-by-one in every row.

Every batch reported `OK - all captures written, no fatal console output`. The
interaction assertions passed without `--coords`: the pointer position is
derived from the DOM and a miss fails the run, so the four states in batch A are
evidence that the hover and the click actually landed (`mouseMoved 417,751 (dom
1/114)`, `click 417,751 (dom 1/114 (reused))`, `key Escape (from focused
GRAPHICS)`).

**Screenshot locations.** `artifacts/` is gitignored and these live in the OS
temp directory, as the working tree must stay free of machine-local files. All
paths below are under `%TEMP%`:

```
s354-A/   webgpu ultra 1920x1080   overview | hover-graphics | focus-graphics | escape
s354-B/   the same, plus -notext variants and the 480x270 thumbnail
s354-C/   webgpu ultra 2560x1440   overview (+ thumbnail)
s354-D/   webgl2 ultra 1920x1080   overview | hover-graphics | focus-graphics
s354-E/   webgpu ultra reduced-motion  overview | focus-graphics
s354-q-safe|medium|high|ultra/     the profile ladder, 1920x1080 overview
s354-gl2-safe/                     webgl2 safe overview (the backend delta at SAFE)
s354-rm-gpu|rm-gl2/                frozen-frame backend pair
s354-q-ultra-b/                    a second identical ULTRA run (the noise baseline)
s354-matrix.log                    every command and every capture line from §7
```

Also in `%TEMP%`, and outside the repo: `s354-diff.mjs` (zero-dependency PNG
decoder plus a mean-|Δ| / thresholded-pixel differ), `s354-hist.mjs`
(percentiles on the harness's own 24 000-sample stride) and `s354-probe.mjs`
(point probes). §4's numbers come from those three.

---

## 8. Test results

```
npm.cmd run typecheck   clean
npm.cmd run lint        clean
npm.cmd run test        35 files, 312 tests, all passing
npm.cmd run build       Compiled successfully in 1637ms
                        Finished TypeScript in 4.9s
                        Generating static pages using 4 workers (3/3)
```

Tests changed by this stage: `coreStructure.test.ts` and
`coreStructureGeometry.test.ts` were largely rewritten around the new
descriptor vocabulary; `routeDash.test.ts` gained the visibility-floor
composition, the packet aspect-ratio bounds and the world-unit sizing fixture;
`atmosphere.test.ts` gained the plate-count, spacing and roll-fan contracts;
`surfaceMaterial.test.ts` and `surfaceResponse.test.ts` gained the class and
proximity channels. Three of those were rewritten *because* the capture round
found the code wrong, not the other way round:

- the packet aspect ratio assertion was widened to `< 0.12` / `< 0.07` only
  after the width was structurally tied to the packet's own length, so the ratio
  is guaranteed rather than asserted into place;
- the world-unit sizing fixture had a stub curve short enough that
  `PACKET_LENGTH_CURVE_SHARE` was binding, so it was measuring the cap instead of
  the sizing — the stub is now 1.3 world units and the cap has its own assertion;
- `deriveRouteVisibility`'s test was rewritten to the composition's actual
  weights (0.55 / 0.86 / 0.46 above the floor; 0.2 / 0.14 / 0.05 removed).

---

## 9. Corrected claims

**9.1 Five comments asserted things the code no longer did.** Found while
assembling this brief and corrected in the same commit, because a stale comment
in this repo is a false claim, not a cosmetic problem:

- `CoreStructureView.tsx` said "two folded shells ... three machined routing
  manifolds"; the structure pushes four folds and four manifolds.
- `structureGeometry.ts` said members "bake into two geometries — solid and
  membrane — so a whole structure costs two draw calls"; it bakes five buffers
  and a view mounts the ones `usedSurfaceClasses` returns.
- `Atmosphere.tsx` said "three large depth-separated planes in the machine's
  recessed tier"; the descriptor builds seven plus a rear fill in the `backdrop`
  tier.
- `layout.ts` said the domains "sit at 5.8–7.0, which clears the mass on every
  side". Measured: 6.24 / 5.80 / 5.64 / 4.70 / 3.41. Four clear; one does not
  (§10).
- `layout.ts` cited the background as `#050609`, which is the old
  `MACHINE_PALETTE.void`; it is `#04070a` now.
- Several comments record "before" values that predate the stage baseline
  (camera `9.1` against a baseline of `7.6`, `SPINE_OVERSHOOT` "used to be 1.14"
  against a baseline of `0.78`, prominence "raised from 0.22 and 0.17" against a
  baseline of 0.28 and 0.24). Those are stage-internal history and are left in
  place, but a reviewer comparing them against `03ce476` will find the baseline
  already carried the "after" value.

**9.2 The 3.5.3 brief's parity claim was too strong.** That brief concluded "no
systematic mid-tone divergence remains between the backends" on the evidence of
p10/p50/p90/p99 = 16/27/86/181 against 15/24/83/175. That is a +3.6% p90 gap,
which is the same effect measured in §4 today (+6.5% at p90, +4 to +5 levels on
a lit face). The claim should have been that the 3.5.2 *double-apply* was fixed
— which it was, and which was a p50 ratio of 0.58 — not that divergence was gone.

**9.3 A defect that only a frame could find.** The first `DECK_PLATES` attempt
used `detail` on a `recess` surface at small scale. It passed every test and
read on the frame as dark specks and damage rather than machined panels. Fixed
by moving to `secondary` on `shell` and scaling up 1.5× — the entire difference
between a laid-in panel and a chip out of the deck.

---

## 10. Remaining, real

Ordered by how much a reviewer should care. None of these is hidden by the
claims above.

**10.1 The Core's silhouette is closer to an octagon than to a machined
monolith.** It is a large rounded mass. The folds, the deck stepping and the
bezel give it depth and a lit rim, but the outline is still a many-sided
silhouette rather than a body with hard machined planes. At 480×270 the
identity holds — one dark mass, one aperture, one bright trunk — but a reviewer
looking for the brief's "clear Hero silhouette" will find a rounded one.

**10.2 The aperture's interior reads as a dark chamber with bright crossings.**
The wafers, dies, bus and membranes are there and they are tiered correctly, but
at the idle framing the aperture is still mostly a dark recess with a few bright
lines through it rather than a lit shelf of layered wafers. The brief asked for
"precisely arranged thin wafers, membranes and compute dies" and this is the
weakest part of the Core.

**10.3 The Hero effect is a braid, not yet a volume.** The weave forms visible
filaments, sheets and compression zones on WebGPU, which is most of what the
brief asked for, but it does not yet have *depth*: the packets are flat
ribbons scattered through a shallow band, so the effect reads as a dense cable
rather than as flow through a volume. The strongest remaining item.

**10.4 GAME ANALYSIS overlaps the Core and is partly occluded by it.** It sits
3.41 world units from the Core's origin against half-extents of 4.05 × 3.30 ×
1.50, so it is inside the Core's box on every axis at once: the crown passes in
front of its lower members and it reads as mounted on the machine rather than
standing beside it. It is the only domain in that position; the other four clear
the mass. This was found by measuring a claim the comment made and the layout no
longer satisfied (§9.1), and it is left as it is rather than moved a third time,
because moving it changes the idle composition and the focus choreography and
needs its own capture round.

**10.5 The domain bays read as clusters of overlapping plates.** Each is a
distinct architecture in its part list and each has a closed body, but at the
framing they are viewed at, the plates still overlap into a cluster rather than
separating into legible sub-assemblies. GRAPHICS is the clearest of the five and
the one the focus state reframes against; RESEARCH is the least legible, and it
is also the largest thing in the upper left of the focus frame — a faint
translucent slice with a hard rectangular edge that competes with the subject
more than a receded domain at `presence 0.26` should.

**10.6 The weave's densest core clips to white.** The route colours are pale
green-cyan (`routePrimary #cfe3d8`, `routeSignal #e8f4ec`), but packets are
drawn additively at `brightness 0.45..1.0` of that colour, so anywhere three or
more filaments overlap the result saturates to pure white and the authored tint
is lost. It reads as a bright cable rather than as a tinted signal. The fix is a
per-packet amplitude scaled for the braid's typical overlap, which is a real
change to a balance three commits were spent calibrating, so it is recorded here
rather than made.

**10.7 The residual WebGPU/WebGL2 bright-arm gain (§4) is unexplained.** Measured,
isolated to the bright end, independent of quality and of the routing field, and
not root-caused. It is not the fixed double-apply.

**10.8 Two acceptance frames were captured but not individually inspected.**
The WebGL2 focus frame and the reduced-motion focus frame were both captured
with assertions passing and both were opened during this stage; the WebGL2
*hover* frame in batch D was not opened. Everything else in §7's matrix was
looked at.

---

## 11. Boundaries not crossed

- **`RendererRuntime`** still owns backend selection, quality, DPR and
  lifecycle; this stage changed no renderer code.
- **`SceneHost`** is still the semantic integration boundary.
- **`CameraController`** still owns the camera; `layout.ts` states explicitly
  that the Core's off-centre placement is a camera concern and is not encoded in
  the layout.
- **`ComputeCore`** imports no Graph, Command or Agent module.
- **`graph/` and `commands/` import no Three or R3F.** Verified by grep; the
  only file in the repo that imports Three outside `src/scene/` is
  `src/renderer/canvasAdapters.ts`.
- **Deterministic descriptor generation**: every structure is derived from
  `(parameters, seed)` through `hashUnit` / `hashSigned` / `normalizeSeed`; no
  `Math.random` anywhere in the visual path.
- **Telemetry** reports the field's real density, because `deriveRouteDashDensity`
  and `deriveCurveDashCounts` are shared by the packer and by telemetry rather
  than duplicated.
- **Disposal**: geometry, materials and buffer geometries are disposed in the
  same effects that allocate them; no resource introduced this stage leaks on
  unmount.
- **No dependency was added, installed or modified.** `package.json` is
  untouched; the capture harness and every measurement tool in §7 and §4 are
  zero-dependency scripts over Node's built-in `WebSocket` and `zlib`.
- **Out of scope and untouched**: no Agent, Ollama, SSE, Trace or Developer
  Overlay. The seams are pure visual inputs (`activity`, `focus`, `proximity`,
  `presence` at the surface level; `domainActivity`/`routeCongestion` remain
  unwired).
