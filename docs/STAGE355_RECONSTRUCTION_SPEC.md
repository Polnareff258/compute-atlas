# Stage 3.5.5 — Cinematic Computational Landscape: reconstruction spec

Written before implementation, per the brief's step 3. It is the document the
implementation is held to; where it and the code disagree, one of them is wrong
and it should be said out loud rather than quietly.

Baseline: `ffc92aa`. This stage replaces Stage 3.5.4's art direction rather than
adjusting it.

---

## 1. What the BEFORE capture showed

Captured at `ffc92aa` on WebGPU ULTRA. The frames are in the transcript; the
findings that matter:

| # | Observation | Evidence |
|---|---|---|
| 1 | **Two of five domains carry no label at idle.** At both 1920×1080 and 2560×1440 the only labels in the DOM are GRAPHICS, GAME ANALYSIS and SYSTEMS. AI and RESEARCH sit below `NAMED_DOMAIN_PROMINENCE`, so nothing on screen says they are there. | `[interaction-not-landed] … no AI label in the DOM (GRAPHICS, GAME ANALYSIS, SYSTEMS)` — the harness resolves its click from a label's DOM rect, so it refuses to guess and **"Focus AI" cannot be produced as a BEFORE frame** |
| 2 | The hero is a single diagonal beam with the rest of the frame hanging off it. | idle 1920×1080 |
| 3 | Matter reads as a *wash* over the whole frame rather than as streams, because the units are distributed by region volume rather than assigned to a structure. | idle 1920×1080 |
| 4 | The palette is one family — cyan-grey — with no second hue anywhere. | idle, hover, focus |
| 5 | The domains differ by label and tint only. At focus, GRAPHICS and SYSTEMS are the same picture with different text. | focus-graphics vs focus-systems |
| 6 | Typography is a corner HUD: uppercase, wide-tracked, small, with `WEBGPU · ULTRA` sitting at the same visual weight as the product name. | any frame |

**Finding 1, stated precisely.** Hover and focus are picked by projecting each
region to screen space and taking the nearest (`DomainField.tsx:262`), so a
region with no label is still *technically* clickable if the pointer happens to
land on it. The defect is discoverability and evidence, not reachability: nothing
tells a visitor that AI or RESEARCH is there, and the capture harness refuses to
invent a click point. The requirement this stage takes on is therefore that every
region must announce itself — through terrain, flow and material — and that all
five must be addressable and capturable at both target sizes.

## 2. Reference principles, and how they were obtained

Six references were named. They were **rendered and looked at**, not summarised
from memory: each was loaded in Chrome at 1920×1080 through the local proxy and
screenshotted. Five returned their real pages. **Active Theory returned its
"YOUR BROWSER IS NOT SUPPORTED" fallback**, so that entry's *launched experience*
was not seen — what is recorded below from it is its fallback frame, which is
still that studio's own art direction. Lusion's launched experiences are
JS-routed and could not be reached headlessly; their project shells were seen
instead. Nothing below is claimed as a first-hand read of a piece that was not
actually displayed.

What the rendered pages actually showed, stated as transferable principles:

**P1 — Colour is a structure, not a decoration.** Every reference page is built
from one dominant hue plus a small number of accents. Lusion's Atlas page uses
saturated magenta on exactly three small elements (the wordmark, one section
label, one scroll hint) and white/grey everywhere else. The page reads as
designed *because* the accent is scarce.

**P2 — Backgrounds are smooth. Detail is local.** FIELD's gradients are long,
smooth ramps with no texture noise in them at all; the visual interest is in the
few objects, not in the field behind them. The failure mode this warns against is
a full-frame noise texture pretending to be detail.

**P3 — Type is large, light and sentence case; copy is short and narrow.**
Display type in the references runs roughly 90–110px at 1920 with light weight
and tight leading. Body copy is 14–16px in a measure of about 45–55 characters
with generous leading. Nowhere is a headline set in wide-tracked uppercase.

**P4 — Metadata is set as an art label, not a diagnostic.** Refik Anadol's page
puts TITLE / CATEGORIES / LOCATIONS / DATE on one aligned row, each value in
white with a 9–10px grey uppercase label beneath it. This is the convention the
brief's "页面信息像艺术作品说明" is pointing at, and it is a *layout* — an aligned
grid — not a font choice.

**P5 — Media is cropped by the frame, and the frame is not filled.** Lusion crops
a film title with the panel edge. FutureDeluxe's hero is a band occupying about
three quarters of the viewport with a flat band below it. Neither fills the
screen edge to edge with content; both leave large deliberate emptiness.

**P6 — Particles read as depth when they vary in size and focus, and as
*organisation* when their colour is grouped in space.** Active Theory's fallback
frame has motes that are individually sized and defocused, with a blue-white
family in one region and a warm family in another. Uniform point sprites at one
size read as a texture; the same count with per-unit scale and per-region hue
reads as a place.

**P7 — The UI is quieter than the image by an order of magnitude.** Every
reference keeps navigation and captions tiny and low-contrast against a loud
image. None of them gives a system readout the same weight as the product name.

## 3. The concept: Computational Watershed

Not a landscape with a machine in it. The world *is* the computation: an
information watershed where flow carves terrain, slows into deposits, and gathers
in one basin.

**Convergence Basin** replaces the Core. It is not an object and has no surface
of its own. It is a region of the terrain — a broad depression with concentric
strata — defined by the four things that meet there: the layered surfaces, the
incoming rivers, the volumetric density, and the interior glow where flow
compresses. There is no sphere, no hole, no reactor, no white aperture.

Element inventory — what replaces what:

| Was (3.5.4) | Becomes (3.5.5) |
|---|---|
| `riftStructure` two massifs + throat + barrel + baffles | `watershed/terrain.ts` — a displaced heightfield with strata, channels, terraces and the basin |
| `RiftStructureView` four draw calls of authored geometry | `TerrainView` — one displaced mesh per material class, plus basin strata |
| `DataMatterView` units distributed by region volume | `FlowView` — units **assigned to structures** (river / stratum / sheet / delta / deposit) |
| `DeepField` six folded far structures | `HorizonView` — layered fog bands and a far terrain sheet, no authored silhouettes |
| `EnergyMaterial` one shading model | four: `terrainMaterial`, `membraneMaterial`, `riverMaterial`, `crystalMaterial` |
| `domainPhenomena` regions with geometry families | five **field behaviours** that modify terrain, flow and material together |
| `PostPipeline` bloom/DOF/fringe/vignette | same four effects, re-driven, plus volumetric fog on ULTRA |

Nothing from the old tree is kept "just in case". The old files are deleted once
the new ones are mounted, in one commit, exactly as 3.5.4's tree was.

## 4. Deterministic descriptor architecture

One pure module, no Three.js, no R3F, that turns a seed and a quality detail into
the whole world. Everything downstream — geometry, particles, materials, camera
framing, labels — reads from it.

```
watershedDescriptor
  seed                 number
  detail               number            0..1, from quality
  basin                { centre, radius, depth, terraceCount }
  rivers[]             { id, spine[], width, flowRate, feeds: 'basin'|'domain', domainId? }
  strata[]             { level, extent, material, flowBias }
  channels[]           { path[], depth, width }        carved into the terrain
  deposits[]           { centre, radius, style }        raised, crystal-bearing
  terrain              { resolution, amplitude, baseFrequencies[] }
  domains[5]           { id, centre, extent, behaviour, palette, labelAnchor }
  fog                  { density, heightFalloff, tint }
  cameraSafeCorridors[]  volumes the camera may occupy
  interestPoints[]     { position, weight, shot }       what the camera aims at
```

Composition constraints, enforced in the descriptor rather than hoped for:

- **C1** `interestPoints` are generated then *filtered*: a point is kept only if
  its projection at its shot's framing lands inside the hero region, and if at
  least `minSpacing` separates it from the already-kept set. Randomness proposes;
  this filter disposes.
- **C2** The basin's projection must land inside the central 55% of the frame at
  `idleVista`, at both target aspect ratios. Framing is calibrated per aspect.
- **C3** No river spine may pass within `nearClearance` of the camera corridor
  volume, so the near field cannot occlude the basin.
- **C4** Terrain amplitude is multiplied by a mask that falls to zero inside
  every camera-safe corridor. No large plane ever faces the lens. *(Implemented
  the other way round — see the correction at the end of §5.)*
- **C5** Highlights are budgeted: exactly one region may exceed the emissive
  threshold at a time; the descriptor assigns which, from interaction state.
- **C6** Detail is not uniformly distributed: the descriptor's density field has
  a deliberate empty zone (the RESEARCH expanse) and a deliberate dense zone (the
  basin rim).
- **C7** Per-seed variation is real: the noise octave offsets, terrace counts and
  river counts are all seed-derived, so two seeds do not produce the same density.

## 5. GPU technical route

The governing requirement is the brief's: *high counts must form structure, and a
hundred thousand evenly spread units is the one thing forbidden.* That single
sentence decides the route.

**Particles: analytic advection, not simulation.** Every unit is assigned at
build time to a structure — a river, a stratum, a membrane sheet, a domain delta,
or a deposit — and carries `(structureId, t0, span, seed)` as vertex attributes.
The vertex shader computes the unit's position from its structure's own curve at
`t0 + time * rate`, so a river unit is *on the river* by construction and cannot
be anywhere else. There is no state, no storage buffer, no ping-pong, and
therefore no possibility of the field drifting into an even wash, which is
precisely the failure being avoided.

This is a deliberate choice against `storage-buffer simulation`, which the brief
permits but does not require. It buys: determinism (a stage requirement), one
shader graph on both backends (a stage requirement), 300k+ units at one draw
call, and no unbounded state to leak. It costs: no true history-dependent
erosion. Erosion is therefore expressed as an *analytic function of flow* —
`erosion(x,z) = f(distanceAlongFlow, flowRate, curvature)` — which is stable,
tunable and art-directable, where a simulated one is none of those.

Adopted from the brief's list, and where each lives:

| Technique | Where | Profile |
|---|---|---|
| GPU heightfield deformation | `terrainMaterial` vertex displacement | all, amplitude scaled |
| flow-map terrain interaction | erosion term; flow field sampled by terrain | all |
| signed-distance fields | channel and basin shaping (distance to spine, radial bowl) | all, octaves reduced |
| raymarched volumetric fog | `VolumetricFog` fullscreen pass, depth-aware | ULTRA only |
| multi-phase particles | river units in particle / filament / band phases | ULTRA + HIGH |
| procedural erosion | descriptor channels + shader erosion | all |
| vertex-displaced membrane | `membraneMaterial` | HIGH+ |
| temporal trails | accumulation buffer in `PostPipeline` | ULTRA only |
| screen-space distortion | refraction offset from flow velocity near membranes | ULTRA + HIGH |
| selective bloom | bloom masked by the emissive term | all with `allowBloom` |
| depth of field | `dof` node, focus tied to the active shot's focal distance | ULTRA |
| volumetric light shafts | a second, cheaper march along the key light | ULTRA |
| caustic-like surface response | terrain term driven by flow compression | HIGH+ |
| iridescent thin-film shading | `membraneMaterial` interference term | HIGH+ |
| GPU-generated normal/detail fields | terrain normals from the displacement derivative | all |

**WebGL2 is not required to match.** WebGPU is the art target. WebGL2 runs the
same shader graph where TSL lowers to it, and drops the volumetric pass, the
trails and the distortion. It must be *tonally* the same picture, not the same
pixels.

**One correction, made during implementation.** The table above originally read
"signed-distance fields — channel and basin carving (`smoothMin`)". The distance
fields are real and are used: the channels are distance-to-spine, the bowl is
distance-from-centre. The *smooth blend* is not, because the polynomial
smooth-min that every terrain generator reaches for returns `a − k/4` at
equality — so `smoothMax(g, g, k)` is `g + k/4` — which on a heightfield is a
flat lift over the whole world wherever a term lists at zero, and a visible
*step* of that lift at the exact radius where the blend stops being applied. The
silhouette cannot take a step, so carves and deposits are summed instead, which
is also what the geology does: a confluence cuts deeper, overlapping deposits
stack. The spec is wrong here and the code is right; recorded rather than
quietly edited, per this document's opening line.

**A second correction.** C4 above says terrain amplitude is masked to zero
inside every camera-safe corridor. The code does not mask the terrain: the
corridor's own floor is *measured from* the terrain, as
`highestGroundOverCapsule(axis, radius) + clearance + samplingMargin`, so the
camera floats above the highest ground the volume sweeps rather than the ground
being flattened where the camera is.

The two are opposite means to the same end, and the difference is not cosmetic.
Masking is a promise about the terrain that has to be re-checked every time the
field changes, and a mask wide enough to guarantee clearance is a flat patch —
which is precisely the "large plane facing the lens" the constraint exists to
forbid, and it would be visible as a plateau once the material starts displacing
vertices. Measuring is a promise about the *camera*, which is the thing that
actually has to move, and it is checkable in one comparison: `shots.test.ts`
asserts every shot's camera position clears the ground under it by at least the
`safeForeground` that shot promises. A corridor that named no height could not be
checked against either — which is why the descriptor measures it at build time
rather than writing it down.

What the mask was for — that no large plane ever faces the lens — is therefore
held by the *framing*, not by the field. The near field is designed around the one
place the camera stands: every river source is beyond `minZ` and every river
concludes at the basin, so nothing the descriptor can generate comes near the
corridor at all. Recorded, not quietly edited.

## 6. Materials

Four models, all authored in TSL, all reading the same flow field so they agree
about where the water is.

- **Terrain** — deep absorbent base; erosion detail from the flow field; wet or
  glassy response where flow rate is high; roughness, emissive and displacement
  all driven by flow. No contour lines anywhere; the strata read as *steps in the
  silhouette*, not as drawn bands on a surface.
- **Membrane** — thin-film interference (thickness from flow), directional
  dispersion by view angle, translucent absorption, a local scan/reconstruct
  band that sweeps only across active regions. Present only where the descriptor
  puts a sheet.
- **River** — three phases in one material: a dense particle core, a filament
  body, and a soft outer band. Centre dense, edges soft. Not a glowing tube: the
  brightness is in the *density*, which varies along the river.
- **Crystal / deposit** — appears only at deposition sites and high-density
  points; hard facet normals, internal refraction, per-facet hue shift. Never
  repeated across a large area.

## 7. Colour

Base: ink black `#04060c`, midnight blue, deep violet. Ambient: cobalt and
petroleum blue. Primary flow: electric cyan into spectral blue — the only hue
allowed to be bright, and only inside a river core.

Per-domain, applied to terrain tint, flow tint and material accents:

| Domain | Hue family |
|---|---|
| AI — Inference Delta | warm white and ultraviolet |
| GRAPHICS — Spectral Terraces | magenta, violet, iridescent white |
| GAME ANALYSIS — Prediction Ravine | amber with coral accents |
| SYSTEMS — Throughput Strata | cold white and deep cyan |
| RESEARCH — Discovery Expanse | indigo and mineral green |

**One highlight per frame.** The descriptor names which region is hot; everything
else is at least a stop below it. Colour follows field state and domain semantics,
never a random per-unit assignment.

## 8. Camera shot system

Seven shots, each fully specified, in `watershed/shots.ts` as pure data. The
CameraController's ownership is unchanged — it still owns the instance and the
damped update; the descriptor decides where it wants to be.

| Shot | Framing intent | Duration | Notes |
|---|---|---|---|
| `entry` | Inside the light-and-film gate, world beyond | 3.2s | the only shot that starts moving before the user does |
| `idleVista` | Basin in the central 55%, rivers leading in from frame left | — | slow drift, **no orbit**; per-aspect calibration |
| `hoverReveal` | Same framing, upstream path brightening | 0.9s | camera barely moves; the *world* responds, not the camera |
| `routeApproach` | Aligned to the active river, travelling with it | 1.4s | first half of the focus move |
| `domainArrival` | Through the local membrane/channel | 1.1s | second half; the domain unfolds *before* arrival completes |
| `domainInspection` | Stable, beautiful, composed; basin still in frame | — | the resting state of a focus |
| `returnVista` | Back out to `idleVista` framing | 1.7s | retraction, not a cut |

Each shot carries: `position`, `lookTarget`, `focalDistance`, `fov`, `duration`,
`easing`, `safeForeground`, `heroRegion`, `lightDirection`, `fogResponse`,
`typography`. Invariants asserted in tests: no shot's camera position lies inside
solid terrain; every `lookTarget` is in front of the camera; `heroRegion` is
inside the frame; the focus sequence is monotone in distance toward the domain.

## 9. Typography and UI

The UI stops being a HUD. Default visible elements, and nothing else:

- `POLNAREFF SYSTEM` — the product name, set as a wordmark, not as a heading
- one line of environment description, 14–18px
- the current domain or state, when there is one
- one minimal navigation hint

Type ramp: title 64–112px, subtitle 18–28px, description 14–18px, system status
10–12px. Sentence case, normal letter-spacing. Backend, quality and telemetry stay
truthful but shrink and move to the corner — `WEBGPU · ULTRA` must never read as
brand.

The entry overlay is a real editorial page: ink background, a slow spectral
gradient, a large title, one accurate sentence, a few status lines, one clear
invitation to enter. Entering: the title splits and recedes, the gradient becomes
the volumetric field, the camera passes through the gate, the terrain resolves.

No spinner, no progress ring, no progress bar as the visual subject.

## 10. Quality degradation

| | ULTRA | HIGH | MEDIUM | SAFE |
|---|---|---|---|---|
| units | 320k | 180k | 64k | 14k |
| terrain resolution | 1 | 0.8 | 0.55 | 0.28 |
| strata / terraces | all | all | reduced | silhouette only |
| membranes | all | all | one | none |
| volumetric fog | yes | no | no | no |
| trails, distortion, shafts | yes | no | no | no |
| crystals | yes | yes | fewer | none |
| bloom / DOF | both | bloom | none | none |

SAFE must still show the silhouette, the basin, at least one river and the domain
transformation. It must not degrade into boxes and points.

## 11. Order of work

Per the brief, and not negotiable:

1. References — **done**, §2
2. BEFORE capture — **done**, §1
3. This spec — **done**
4. Remove the old visual tree
5. Entry typography + `idleVista` — **the first screenshot must be good on its own**
6. Terrain, basin, rivers
7. The five domains
8. Hover / focus / escape choreography
9. WebGPU ULTRA complete
10. WebGL2, reduced-motion, quality fallback
11. Three rounds of capture-and-critique

Step 5 is the gate. If the idle frame is not a publishable image, nothing later
matters and the work returns to step 5.

## 12. Acceptance

The brief's matrix, plus the checks this spec adds:

- entry page, entry midpoint, idle 1920 / 2560, thumbnail, no-text idle, hover
  GRAPHICS, focus GRAPHICS / AI / SYSTEMS, escape restored, reduced-motion,
  WebGL2 fallback, and a 5–10 minute resource soak
- **all five domains addressable at 1920×1080 and 2560×1440** (BEFORE finding 1)
- idle frame publishable standalone
- no rift, no rail, no large flat plates, no white aperture
- focus GRAPHICS / AI / SYSTEMS distinguishable at a glance, in greyscale
- camera stays composed in every state; no clipping through terrain
- no-text frames still read as a composed image
- resource counts flat across the soak; zero shader validation errors

**Failure clause.** If the result can still be described as "an abstract model
with particles on a dark background", the stage has failed and iterates again.
