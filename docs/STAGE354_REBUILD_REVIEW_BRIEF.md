# Stage 3.5.4 — Total Visual Rebuild: review brief

Written to be read **instead of** the transcript. Every claim below carries either
a command that reproduces it or a file that contains it.

Supersedes `docs/STAGE354_REVIEW_BRIEF.md` — the "Identity Re-Foundation" pass
over `e8384e2..a880637`. That pass's subject was an apertured monolith with a
bezel rail on a four-plate backdrop, and none of it is in the render tree any
more. It also supersedes `docs/STAGE353_REVIEW_BRIEF.md` for regeneration.

Baseline: `5711cbf`. This stage is `9a452d9` — 27 files, +5579 / −400, pushed to
`origin/master`. Review the diff `5711cbf..9a452d9`.

> **Addendum.** The sections below describe `9a452d9`. A further pass over the
> large-flat-face problem followed it and is recorded in §12, which supersedes
> §9's first bullet and §6's items 6 and 7.

---

## 1. What the brief asked for, and what was built

The brief was 让网站尽可能酷炫、震撼、高级, with an explicit list of representations
that were to be treated as **discardable old schemes**: a grey polygon Core, a
lofted hull, a computational monolith, a central object with five peripheral
nodes, `BoxGeometry` domains, thin connecting lines, a sparse dashed flow field,
small pulsing spheres, and a dark background with a few labels.

Every item on that list is gone from the render tree. What is mounted is:

| Element | File | What it is |
|---|---|---|
| Deep field | `src/scene/backdrop/DeepField.tsx`, `backdropStructure.ts` | Six folded, tapering far structures with their own gain and depth floor, plus a fog stack. Not plates. |
| The rift | `src/scene/hero/riftStructure.ts`, `RiftStructureView.tsx` | Two massifs entering from opposite corners, a throat, a barrel of ring ribs, a baffle stack, membranes, bundled fibres, feet. 815 lines of composition. |
| Data matter | `src/scene/matter/{dataMatter,dataMatterMaterial,DataMatterView}` | One instanced draw call. 120,000 units at ULTRA, positioned, oriented, stretched and tinted entirely in the vertex shader. |
| Five phenomena | `src/scene/domains/{domainPhenomena,domainGeometry,DomainField}` | Five regions, five field behaviours, five geometry families, five finishes. |
| Post | `src/scene/post/PostPipeline.tsx` | Bloom, DOF, chromatic aberration, hand-built vignette, all driven from one energy term. |
| Shading | `src/scene/materials/energyMaterial.ts` | One authored TSL model for every solid surface in the scene. |

`SceneHost.tsx` mounts exactly those five. The old tree is still on disk and is
**not imported by anything** — see §6.

## 2. The four layers the brief named

**巨型数据裂隙与计算腔体.** `RIFT_AXIS_RAW = [1, 0.92, −0.86]`, the rift's centre at
`[1.9, 1.5, −0.9]`, throat half-extents `[6.4, 2.9, 2.6]`. The near massif's first
control point is `[-36, -30, 19.5]` — outside the frame to the left and below, and
*behind* the idle lens plane at z = 20, so the structure is already large when it
enters shot. Its greatest reach is **1.4×** the idle frustum's half-extents: the
hero cannot be seen whole, by construction.

**可凝聚和解体的信息物质.** `dataMatterMaterial.ts` names seven configurations —
volumetric cloud, flowing filament, compressed stream, luminous ribbon, membrane
surface, structural lattice, local pocket — and they are not seven systems. They
are seven regions of one parameter space, which is why the frame reads as one
substance reconfiguring. The unit is a streak whose length/width ratio is greater
than one everywhere in its range (`STREAK_VAPOUR_LENGTH = 0.42` against
`STREAK_VAPOUR_WIDTH = 0.06`), because a unit that is wider than it is long is a
dot, and a hundred thousand dots is 随机星尘.

**高密度语义流束.** The corridor: a two-scale gaussian around the signal segment
(`CORRIDOR_CORE_RADIUS = 1.6` at full strength, `CORRIDOR_SPILL_RADIUS = 6.2` at
22%). It reaches the throat's own walls, which a single 1.7-radius gaussian did
not — that revision measured a frame peaking at 0.70 luminance with bloom
thresholded at 0.72, i.e. a frame that was *literally* unable to bloom.

**五个具有不同场行为的计算区域.** `domainPhenomena.ts`: `inference`, `sampling`,
`branching`, `throughput`, `probe`, separated by `organisation`, `pressure` and
`rate` *before* any colour is chosen. Colour is downstream of motion — a region
reads as GRAPHICS because its matter is organised into dense sampling sheets that
interfere, and only then because that reads cool.

## 3. What changed about the graph

The Graph still exists as the underlying semantic topology; `src/graph/` is
unchanged in its contracts. What changed is the projection:

- `NODE_LAYOUT` — five domains at radii **17.7, 15.6, 12.1, 10.7, 8.4** and depths
  from z = +7 to z = −13. Five distinct distances, no ring, no sphere.
- No edge is drawn. The route is the matter field's corridor, and it lights the
  structure it passes through (`corridorTerm`).
- Text is a budget: at rest only the regions at or above
  `NAMED_DOMAIN_PROMINENCE = 0.35` carry their name. Focus withdraws every label
  but one; a description appears only on the region being examined.

## 4. Interaction

- **Idle** — `IDLE_CORRIDOR = 0.4`. Non-zero on purpose: a foundry at rest still
  has metal moving through it, and a zero corridor deletes the one term that
  draws matter entering from far and reconfiguring at the throat.
- **Hover** — `HOVER_ACTIVITY = 0.58`, corridor strength +0.42, the pointed-at
  region takes load 0.72 while the others fall to 0.35 of their rest load.
- **Focus** — `FOCUS_ACTIVITY = 0.92`, corridor +0.55, the focused region takes
  0.95, the camera advances along the active flow and DOF opens
  (`PostPipeline`, `depthOfField={quality === 'ultra'}`).
- **Escape** — `CLOSE_RATE = 1.7` against `OPEN_RATE = 2.6`. Escape is a
  retraction, not a cut.

Harness assertions that must not regress, all passing: hover must land; focus
must withdraw the other domains' labels (`labelCount === 1`); Escape must restore
idle (`labelCount > 1`, no hovered names); reduced-motion readiness is exact
buffer equality.

## 5. Measurements

Reproduce any of these with:

```
node scripts/stage352-capture.mjs --out <dir> --backend webgpu --quality ultra \
  --sizes 1920x1080 --states idle --telemetry 1 --verbose
```

Sixty-second idle run, 1920×1080 ULTRA:

```
fps 36–45 · frame time 22–28 ms · drawCalls 49 · triangles 483,200
geometries 22 · textures 26 · particleCount 120,000
configuredFieldBudget 120,000 · renderedFieldSamples 120,000
activeSignalSamples 48,000
```

`geometries` and `textures` are flat across the whole run. The field is **one**
draw call out of 49. FPS was measured in a **dev** build with HMR active; a
production measurement belongs to Stage 11.

Frame luminance, idle 1920×1080 ULTRA: whole-frame mean 0.114, centre mean 0.309,
peak 1.000, 47.6% of pixels in the bottom histogram bin and 0.2% in the top —
a dark frame with a small blown-out core, which is what allows a threshold-0.72
bloom to contribute anything at all.

WebGPU against WebGL2 on the same frame: spread 252.1 against 252.1 (idle) and
251.6 against 251.6 (focus-GRAPHICS). Both backends run the same
`WebGPURenderer`, WebGL2 via `forceWebGL`, in `canvasAdapters.ts` — so this is
one shader graph, and the difference a reviewer should look for is not shading
but the absence of compute and storage buffers.

## 6. Defects this stage found by measuring, and fixed

1. **Telemetry reported a number about a different thing.** `sampleRendererTelemetry`
   read `info.render.calls`, which three.js documents as "since the app has been
   started" and which `Info.reset()` does not clear — `reset()` zeroes
   `drawCalls`, `frameCalls`, `triangles`, `points` and `lines` and leaves `calls`
   alone. A sixty-second run reported **319,000 draw calls** against a real cost
   of 49. Now reads `render.drawCalls`; `rendererTelemetry.test.ts` pins a
   fixture containing both counters with `calls` deliberately the larger.
2. **Every domain label was at twice its region's distance.** `labelAnchor` was
   authored as an absolute world position and rendered inside a group already
   translated to `centre`. Three of five projected off-frame at 1920×1080, which
   made hover, focus, reframe and escape unreachable for the domain the whole
   choreography is built around. The harness said so: `[interaction-not-landed]`.
3. **A dead constant that named a decision made elsewhere.** `IDLE_INFLOW` in
   `deriveFieldState.ts` was never read; the idle corridor strength lives in
   `fieldUniforms.IDLE_CORRIDOR`.
4. **A circulation that never circulated.** `dataMatterMaterial` computed
   `swirled` and then positioned units from `dispersed`, so the vortex about the
   spine only set *orientation*. The field had a direction of travel it never
   travelled in.
5. **A layout that put three domains outside the frustum.** `NODE_LAYOUT` was
   re-authored against the idle frustum; depth separation now comes from z.
6. **Rims that could not vary across a plane.** A fresnel term is a function of
   the view angle, and on a large flat member at a grazing angle the view angle
   is the same everywhere on it — so the term resolved to one value over the
   member's entire area. That is the pale unbroken wedge in the bottom-left of
   the frame. The rim and the base now both take a slow world-space
   `surfaceDensity` field, which gives a plane a reason to differ from one end to
   the other. `shell.rimGain` also came down from 0.78 to 0.55; `edge` is
   unchanged at 1.05, because a rim is *for* cut edges.
7. **Veins that traced contours rather than veins.** The isolation line traces the
   zero set of a fractal field, and a fractal with its energy in its base octave
   traces a few long closed curves — a topographic map on any large flat surface.
   Four octaves at diminish 0.68 rather than three at 0.5 makes the zero set
   branch instead of loop.
8. **Hook-return mutation.** `DomainField` and `PostPipeline` wrote to values
   returned from hooks (materials from `useMemo`, `gl.info.autoReset` from
   `useThree`), which the React Compiler lint rules reject. The membrane blend
   state is now set where the material is made, the frame loop reaches its
   materials through a ref, and who resets the render counter is decided in
   `canvasAdapters.configureRenderer` — where the renderer is created, and where
   the counter's meaning belongs.

## 7. Acceptance matrix

Every entry below was captured, opened and inspected. `error 0, fatal 0` on every
batch.

| Entry | Result |
|---|---|
| WebGPU ULTRA 1920×1080 idle | spread 252.1, lit 79.1% |
| WebGPU ULTRA 1920×1080 hover-GRAPHICS | assertion passed |
| WebGPU ULTRA 1920×1080 focus-GRAPHICS | assertion passed, labelCount 1 |
| WebGPU ULTRA 1920×1080 focus-AI | assertion passed |
| WebGPU ULTRA 1920×1080 Escape | assertion passed, idle restored, no hovered names |
| WebGPU ULTRA 2560×1440 idle | spread 252.9, lit 81.3% |
| 480×270 thumbnail | composition holds |
| text-hidden | spread 252.9, holds |
| reduced-motion | byte-exact readiness |
| WebGL2 idle / focus-GRAPHICS | spread 252.1 / 251.6, same art direction |
| MEDIUM idle | spread 249.9, lit 73.1% |
| SAFE idle | spread 229.1, lit 64.2% |

Verification, run at `9a452d9`:

```
npm.cmd test        → 35 files, 312 tests, all pass
npm.cmd run typecheck → clean
npm.cmd run lint      → 0 errors, 0 warnings
npm.cmd run build     → pass on Next 16.3.5
```

Reproduce a whole row, e.g.:

```
node scripts/stage352-capture.mjs --out "$TEMP/review" --backend webgpu \
  --quality ultra --sizes 1920x1080 \
  --states idle,hover-graphics,focus-graphics,focus-ai,escape
```

## 8. Quality degradation

`src/config/quality.ts`. ULTRA carries the full system: 120,000 units, DOF, bloom,
full membranes, `coreStructureDetail 1`, `domainDetail 1`. HIGH keeps every layer
and drops density to 70,000 with 0.82/0.86 detail. MEDIUM drops transparent layers
and the post chain to 32,000 and 0.6/0.68. SAFE goes to 8,000 and 0.12/0.4 and
keeps only the silhouette, the main flow bundles and the domain transformation —
which is what the SAFE capture is there to prove, and it does: the rift's
silhouette and the lit throat survive at 8,000 units.

## 9. Remaining visual risks — stated plainly

- **Large flat faces are still the weakest thing in the frame.** A sweep through
  four or five control points is a plane. The near blade takes the most screen
  area of any member in the focus frame and is still the flattest surface in it.
  The surface-density and rim terms give it value variation; they do not give it
  structure. A viewer who dislikes the frame will say "flat polygons", and they
  will be pointing at that blade.
- The veining reads as a branching network on large surfaces rather than as a
  contour, but the fix is a weighting, not a different basis.
- FPS 36–45 in dev, not 60. Stage 11 owns the real measurement.
- RESEARCH is very dark at idle by design, at the edge of readable.
- No automated visual regression: the matrix is inspected, not diffed against a
  baseline.

## 10. Boundaries held

- `RendererRuntime` still owns backend, quality, DPR and lifecycle;
  `canvasAdapters` gained one line about who resets the render counter and no
  other responsibility.
- `SceneHost` remains the semantic integration boundary.
- `CameraController` ownership is unchanged; this stage added one named
  composition floor, `MIN_FOCUS_DISTANCE`, and restated its test as a two-sided
  hero contract (throat framed whole *and* machine overflowing).
- Graph schema still contains no Three/R3F types; Command core still imports
  neither. No visual module imports Command or Agent.
- Deterministic descriptors, quality propagation, reduced motion, disposal and
  telemetry truthfulness are preserved or improved.
- No dependency, `package.json` entry or machine-local file was added.
- Stage 6 is not started. No Agent, Ollama, SSE, Trace or Developer Overlay was
  implemented.

## 11. The one thing a reviewer cannot check from this document

The frames. `.gitignore` excludes `artifacts/`, so the PNGs are not in the tree —
which is deliberate, and means a reviewer must re-run the harness (§7) rather
than trust a description of a picture. The captures live in the OS temp directory
for this machine only.

## 12. Addendum: the flat face, found by measurement

§9's first bullet named the large flat faces as this stage's weakest element and
said the fix would need structure, not shading. This is that pass. It is worth
reading as a method, because the method is the result: four of the five things
tried did not work, and each failure narrowed the search.

**What was tried, in order, and what it measured.**

1. **Ribbed cross-sections** (`structureGeometry.ribbedProfile`, `folds` on a
   path part). A wide sweep's face is one facet, so the section is broken into
   segments that step either side of the base line, eased to zero at the corners
   so the side walls stay vertical. This is real and it is kept — the massifs'
   edges are visibly faceted — but it did not fix the wedge, and a probe of the
   built geometry says why: the ribbed normals are in the buffer, 15–20° off the
   base face, and the face still rendered flat.
2. **Fanned section caps.** Ribbing makes a section non-convex, and the end-cap
   fan was from vertex 0, which is only correct for a convex outline. Caps now
   fan from the outline's own centre when the section is ribbed. This is a
   correctness fix, not a visual one, and it cost a test failure in the old
   tree's suite — `coreStructureGeometry.test.ts` pins `count % 4 === 0`, a
   quad-per-facet contract. The fan is therefore applied *only* to ribbed
   sections, so every convex part in the scene keeps the old vertex count.
3. **A per-facet bake** (`CLASS_FACET_TINT`). Orientation luminance is the dot
   product with the key direction, so a face pointing at the key takes very
   nearly one value however its normal tilts — which is the massif's case. This
   adds a small deterministic per-facet offset, hashed from where the facet is,
   view-independent so both backends bake the same number. Measured on the shell
   class: **37 distinct bake values before, 319 after.** Kept.
4. **A second octave of the surface-density field** (`SURFACE_DENSITY_FINE_*`).
   The broad term's features are 25 world units across and the massif is 30, so
   the member sampled it once. The two-scale field is what finally put visible
   mottling on the massif. Kept.
5. **The density on the corridor term.** The wedge survived all four of the
   above, and the reason is that it is *cyan*: the only cyan term in the material
   is `corridorTerm`, and it was the one term that never took the density field.
   Applying it is also what the brief asks for in words — 高密度语义流束, a
   bundle rather than a wash. Kept.

**What actually fixed it, and how it was found.** Five shading changes and the
wedge was still there, so the field was switched off entirely for one capture
(`SceneHost`, one line, reverted immediately). The wedge remained, now plainly a
member with a bright rim on its upper edge — so it was never a lighting problem.
It is the near massif's own sweep, and its silhouette is two nearly straight
parallel lines running the length of the corner. Ribbing changed the edge texture
and nothing else, and no lighting term can vary across a body whose outline does
not.

**The fix.** `segmentedShell` in `riftStructure.ts`: each massif is cut at its own
control points into separate members, pulled back from each other by
`SEGMENT_GAP = 0.05` and nudged off-axis by `SEGMENT_DRIFT = 0.2`, over a
continuous spine at `SEGMENT_SPINE = 0.42` of the section. The gaps put three
real joints into the outline and the spine keeps it one body.

The spine is there because the first cut had none and the SAFE capture caught it:
at a detail of 0.4 the fins are all that is left and the massif read as a chain
of shards floating in the dark — 随机漂浮的岩石, the one thing the brief names and
forbids. A spine in the `recess` finish closed it in the geometry and left it open
on screen, because an interior finish is dark enough to read as the void it is cut
from. It takes the body's own finish instead, so a joint reads as a narrowed
section rather than a break.

**What is still true.** The large faces are large, and the joints are the only
thing that breaks their outline. The veins on them still trace closed loops
rather than branching — §6 item 7's octave change reduced this and did not
remove it. And this pass is the clearest evidence for the brief's own process
requirement: none of it was visible in the code, and all of it was visible in a
capture.
