# Stage 3.5.6 — current-state technical handoff

Replaces the previous version of this file, which referenced a superseded commit, described the
deleted Voronoi corridor/basin construction as live, and carried blocking issues that have since
been fixed. Everything below is written against the code as it stands.

    HEAD      035f360  "fix: the simulation passes write state through outputNode, not colorNode"
    branch    master, in sync with origin/master, clean tree
    evidence  artifacts/baseline-035f360/  (50 files, prefix baseline-035f360-*)

This is a **preparation** document. No visual work was done in the commit that produced it.

## 1. Verified state of the checks

| check | result |
|---|---|
| `npm run typecheck` | passes |
| `npm run lint` | passes, 0 errors 0 warnings |
| `npm test` | **1 failed, 196 passed of 197** |
| browser console | error 0, fatal 0 on every capture batch |

The single failure is `src/scene/watershed/terrainGeometry.test.ts` → *"builds a mesh at ULTRA
detail within a sane budget"*. It **passes in isolation** (2.9 s) and fails only when the suite
runs in parallel, where competing workers push it past vitest's default 5 s per-test timeout. The
global timeout was deliberately **not** raised and the module was **not** deleted. That module is
not on the render path — only its own test imports it — but confirming that and removing it are a
separate decision for a later commit.

## 2. Rendering path map (read from the current source)

### What `SceneHost` mounts

- `<fogExp2>` — scene fog, density and tint from the descriptor.
- `<TerrainView>` — **the veil**: one translucent sheet of `buildInkVeil`, 96 world units above the
  ground, sampling the same density field. Drawn after the ground. Absent at MEDIUM and SAFE
  (`VEIL_PRESENCE` is 0), not mounted with zero gain.
- `<RiverView>` — **the hero surface**: one continuous grid of `buildInkSurface` over the whole
  world extent. `SURFACE_RESOLUTION` 768 along the long axis at detail 1, scaled by
  `settings.terrainDetail`, floored at 192 in `inkSurface`.

There is **no basin mesh and no corridor mesh**. `BasinView.tsx`, `inkBasin.ts` and
`buildInkCorridor` were deleted; the basin and the five regions are values of the density field,
not geometry.

`DomainLabels` is mounted by `RendererHost`, not `SceneHost` — the label layer lives in the host's
DOM tree because R3F's canvas is created imperatively by the host and a DOM overlay cannot be
rendered from inside it. `RendererHost` renders, in order: the canvas, the vignette,
`<DomainLabels>`, `<SystemMasthead>`, `<RendererStatus>`, `<BootExperience>`.

### Textures: static authored data vs GPU simulation state

**Static** (`new THREE.DataTexture`, uploaded once per descriptor, `FloatType`, linear, clamped):

- `baseTextureSource` — from `inkDensity().data`: R body, G scour, B settle, **A along**.
- `fluvialTextureSource` — from `inkDensity().fluvial`: R tangent X, G tangent Z, **B speed**,
  A seed noise.

**Simulation** (`new THREE.RenderTarget`, half-float, no depth, ping-ponged by copy rather than by
swapping): `read` and `write`, sized by `INK_QUALITY[tier].simulationResolution` (512/384/256/192).

### Where each channel is produced and consumed

| channel | produced | consumed |
|---|---|---|
| `body` | bake: river profile + pigment veil + region body | material pigment ramp, `pigmentGlow`, granules |
| `scour` | bake: outside-of-bend cut + regions | material `scourTerm`, vertex displacement down |
| `settle` | bake: inside-of-bend bar + descriptor deposits + basin gather + regions | `settleTerm` (base colour **and** emission), displacement up |
| `pressure` | **simulation only** — brush injection `brush · dt · PRESSURE_INJECT_RATE` | vertex lift (capped), `pressureTerm` in `sharpness` |
| `along` | bake: arc-length position of the winning river | bedding phase |
| `tangentX/Z`, `speed` | bake: the winning river's tangent and rate profile | advection velocity; `speed` also drives `primaryCore` |

`speed` is `flowRate · (0.35 + 0.65 · body_at_bake_time)` — computed **before** regions, basin and
veil are mixed in, and static. That is what makes it usable as a river selector; `primaryCore` is
`smoothstep(0.84, 0.95, speed)`.

### Where each interaction enters

| input | path |
|---|---|
| hover / focus | `graphInteraction` reducer → `activeDomainId` → `uniforms.setRegion(index, palette)` |
| scroll | `readScrollProgress()` per frame → `deriveScrollChoreography` → `uniforms.setScrollLayers(...)` **and** `cameraController.setScrollTrack(pose, authority)` |
| drag | pointer listeners → `updateBrush()` → `ink.setBrush(...)` → brush uniforms → the sim's injection terms |
| quality | Command Bus `SET_QUALITY` → `RendererRuntime` → `SceneHost` rebuilds the ink field at the new tier and the views rebuild their geometry |
| debug view | `?debug=N` read once → `uniforms.setDebugMode(N)` |

The camera is written **only** by `CameraController`: `SceneHost` sets its scroll track and shot
sequence, then applies `getResolvedPose()` to the R3F camera each frame. Animated state is written
through uniforms, refs and GPU buffers; React carries only low-frequency semantic state.

### Ownership

`RendererRuntime` owns backend, quality and lifecycle; `RendererHost` owns the canvas, the R3F
root, the container ResizeObserver and the DOM overlays; `SceneHost` owns the semantic integration
and the frame loop; `CameraController` owns the camera. Telemetry is sampled in `SceneHost` every
0.25 s and reports configured budget, rendered samples and active signal separately — the budget is
never reported as a rendered count.

### Disposal

- `inkField.dispose()` — seed/advect/copy materials, both render targets, both data textures, the
  quad geometry. Called from a `useEffect` cleanup in `SceneHost`.
- `inkMaterial` / `veilMaterial` — each returns a `dispose()` that disposes its material; the views
  dispose geometry and material together in a `useEffect` cleanup keyed on the same dependencies
  they were built with.
- `flowField` — disposed on the effect that builds it.

## 3. What each diagnostic mode shows

`?debug=N`. Raw-channel views are shown as their own value in grey, never auto-ranged — a view that
normalised itself would make an empty channel look identical to a saturated one.

    0  final                        7  surface without emission
    1  body                         8  settle emission only
    2  scour                        9  depth fade
    3  settle                      10  emission without settle
    4  pressure                    11  pigment emission
    5  base colour                 12  sharpness emission
    6  emission (all)              13  primary core

`emission` is the sum of three named nodes — `pigmentEmission`, `sharpnessEmission`,
`settleEmission` — and every emission view **references** those nodes rather than restating them. An
earlier version re-typed one of them with a different gain and silently measured a different
formula.

## 4. Repairs made in the three commits before this one

**The surface is continuous.** Each river previously got its own graded corridor mesh with the
quads belonging to another river deleted, on the theory that the survivors formed a partition. They
did not: the corridors were independently generated grids, so a quad one gave up was never replaced
by another and the world had a hole along every midline between two rivers. A coverage rule
expressed through topology cannot be robust when the topology is generated per feature. There is
now one grid.

**The camera has an explicit frustum.** `CAMERA_NEAR` / `CAMERA_FAR` were absent, so the default far
of 1000 applied to a world 2000 units across and a scroll station standing at an eye height near
1150. The whole final act of the story was clipped, and everything beyond a kilometre was silently
missing from every other frame.

**A region height was being used as a density.** `DomainTerrain.amplitude` is a world-space height
built as `BASE_AMPLITUDE · k` (values 10 to 92). It was multiplied into `scour` and `settle`, which
are 0..1 fractions, so every region saturated on contact — three channels pinned at p90 = 1.000 over
roughly half the world.

**The brush injection is a rate.** It was a raw per-frame addition, so the response was frame-rate
dependent and each channel settled at `a / (k·dt)` — a factor of sixty too high at 60 Hz. Injections
are now `rate · dt`, every channel has a ceiling above the authored maximum, and the geometric
response to pressure is capped.

**The thalweg reads `primaryCore`,** not the composite `body`. The old form was `smoothstep(0.90,
0.99, body)`, and by then `body` contains the rivers, the veil and five regions — so it was never a
centreline. `THALWEG_GAIN` is deleted and the assembled `sharpness` is clamped to 0..1 before the
power.

**The simulation passes write through `outputNode`, not `colorNode`.** `colorNode` is a `vec3`
output and `NodeMaterial` assigns alpha one unconditionally for an opaque material
(`NodeMaterial.js:899`), so the `vec4` the seed, advection and copy passes returned had its fourth
component discarded. The material reads that channel as `pressure`, so pressure was saturated
**from the first frame** — which pinned `sharpness` at its ceiling and made a narrow highlight the
illumination of 84% of the picture. `outputNode` replaces the result after the built-in
diffuse/opacity handling (`NodeMaterial.js:547`), which is the seam a data pass wants; `transparent`
was rejected because a blending pass would mix with its target instead of replacing it, and
`NoBlending` is now stated explicitly.

## 5. Browser evidence at this commit

All frames at `035f360`, `boot=skip` applied, prefix `baseline-035f360-*` in
`artifacts/baseline-035f360/`.

**Luminance and coverage.** Fixed thresholds pass through the same display pipeline for every
frame, so these numbers are comparable **across these captures** and are diagnostics only — they
are not a substitute for looking at the picture, and are not transform-invariant.

| frame | p50 | p90 | p99 | <32 | >64 | >128 |
|---|---|---|---|---|---|---|
| WebGPU ULTRA 1920×1080 idle | 28.0 | 71.0 | 184.5 | 59.2% | 12.4% | 3.37% |
| ↳ 480×270 thumbnail | 28.0 | 70.8 | 184.3 | 59.3% | 12.28% | 3.34% |
| WebGPU ULTRA 2560×1440 idle | 27.9 | 71.0 | 180.8 | 59.6% | 12.22% | 3.33% |
| WebGL2 ULTRA 1920×1080 idle | 28.1 | 71.8 | 184.4 | 59.0% | 12.6% | 3.38% |
| reduced motion 1920×1080 idle | 27.2 | 100.3 | 175.4 | 61.9% | 19.59% | 5.38% |
| debug 4 (pressure) | 24.1 | 37.1 | 41.4 | 76.9% | 0.19% | 0.07% |
| debug 12 (sharpness emission) | 24.6 | 39.4 | 170.8 | 73.2% | 4.19% | 3.02% |
| debug 13 (primary core) | 24.6 | 39.4 | 195.9 | 73.1% | 4.48% | 3.59% |

WebGPU and WebGL2 agree to within 0.6 on p50 and 0.01 percentage points on >128, which is the
expected result of both backends constructing the same `WebGPURenderer` and therefore one shader
graph.

**Scroll.** Document 3024 px against a 1080 viewport — a 1.8-viewport range. All five keyframes
(0/25/50/75/100) landed with **0.00% drift**, at both 1920×1080 and 2560×1440.

**Drag.** WebGPU 3.561% of pixels changed (73,834 px, mean delta 13.01/255). WebGL2 3.664%
(75,975 px, mean delta 13.34/255). Both well above the harness's 0.3% visibility floor.

**Debug views confirm the pressure repair.** Mode 4 lights 0.19% of the frame above luma 64 at
idle, against 90.83% before the `outputNode` fix. Mode 12 now measures 4.19% against mode 13's
4.48% — the relationship that must hold once pressure stops masking the corrected thalweg.

**Console.** error 0 and fatal 0 on every batch. The warnings are the known environment set:
favicon 404, `THREE.Clock` deprecation, `powerPreference` ignored on Windows, HMR notice, and one
that a later reading of the dev server's own log added to this list —
`THREE.WebGPURenderer: PCFSoftShadowMap has been removed. Using PCFShadowMap instead.`, reported
from the ink field's render calls. It is benign (this composition has no shadow-casting lights) but
it is emitted repeatedly, it is attributable to a file in this stage, and an earlier version of
this document listed only four warnings. Recorded because a console accounting that omits a
repeating warning is not an accounting.

### Running it

Start the dev server before capturing:

    cd D:\Documents\ClaudeCode\WebDesign
    npm run dev          # http://localhost:3000

It has to be a *fresh* process. A dev server left running across several commits went stale during
this work and served a module graph that predated a material change, which made a correct fix look
like it had had no effect at all; the wrong conclusion stood until the server was restarted.


## 6. Verified and unverified

**Verified by running it:** the checks in §1; both backends' idle and drag; the scroll range and all
five keyframes; the debug views; the reduced-motion idle frame; both backends agreeing numerically.

**Not verified — and not to be claimed as passing:**

- **Under reduced motion the drag produces exactly zero pixel change.** The harness reports
  `the drag moved 0.000% of pixels (0 px)`, below its 0.3% floor, and refuses to write the frames.
  This is a direct consequence of the reduced-motion repair: `SceneHost` passes `delta = 0` to
  `ink.step`, which holds everything including the brush injection, so the drag writes nothing.
  Direct manipulation should still work under the preference and currently does not.
- **No sustained-drag evidence.** A ~5 s hold and release frames at 0/1/3/5 s are not captured; the
  harness has no hold-duration option and adding one was out of scope for a preparation commit.
- **No frame-rate consistency evidence.** 30/60/120 FPS were not tested; the browser tooling here
  cannot control frame rate reliably, so this is untested rather than passing.
- **Reduced-motion ambient stop is measured only indirectly.** Two samples were captured but the
  difference between them is not reported here as a stop, because the two runs capture at
  comparable scene clocks — that makes them a determinism check, not a motion probe.
- MEDIUM and SAFE were not captured in this baseline.

## 7. Current visual state, stated factually

No art direction is proposed here; these are observations for the next model.

- The primary route renders as a **thick, near-white continuous highlight**.
- The **rectangular boundary of the world surface is still visible** — the grid covers the extent
  and its edge is where the geometry ends.
- **Domain local structure is poorly distinguishable** — the five regions exist as terms in the
  density field and carry DOM labels, but do not read as five distinct environments.
- **Surface hierarchy and depth are unfinished**; the frame has a dark base and a bright core but
  little between them.
- **Soft coverage is not implemented.** The surface is opaque, and the material's stated reason for
  that (sorting corridors, bed and basin against each other) is obsolete — those meshes no longer
  exist.
- The **final luminance hierarchy has not been rebuilt** since the emission repair.

This is **not a finished or shippable visual state**, and the previous handoff's framing of the work
as complete should not be carried forward.
