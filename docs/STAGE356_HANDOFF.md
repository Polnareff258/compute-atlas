# Stage 3.5.6 — current-state technical handoff

Replaces the previous version of this file, which referenced a superseded commit, described the
deleted Voronoi corridor/basin construction as live, and carried blocking issues that have since
been fixed. Everything below is written against the code as it stands.

    HEAD      04b367e  "docs: record the fifth console warning, and the dev-server restart requirement"
    branch    master, working tree carries the uncommitted Stage 3.5.x visual work
    evidence  artifacts/baseline-035f360/   (50 files, prefix baseline-035f360-*)
              artifacts/stage35x-verify/   (post-repair runs, prefix s356*)

The tree is **not** clean, and the last commit is **not** where the picture comes from: the approved
frames in `artifacts/codex-reconstruction/pass63-final-polish` were captured from the uncommitted
working tree, which is the state everything below describes.

## 1. Verified state of the checks

| check | result |
|---|---|
| `npm run typecheck` | passes |
| `npm run lint` | passes, 0 errors 0 warnings |
| `npm test` | **269 passed of 269, 37 files, no timeout** |
| browser console | error 0, fatal 0 on every capture batch |

The single failure this table used to carry — `src/scene/watershed/terrainGeometry.test.ts` →
*"builds a mesh at ULTRA detail within a sane budget"*, passing in isolation at 2.9 s and failing
only under a parallel suite — has been **closed by removing the module**, not by raising the
timeout. The confirmation the previous version deferred ("only its own test imports it") was re-run
against the current tree: no production module, view, script or test outside its own file imported
`buildTerrainGeometry`, and nothing imported `rowWarp` or `terrainSampleXZ` either. So
`terrainGeometry.ts` and `terrainGeometry.test.ts` are deleted, and the two comments that pointed at
the deleted module (`groundField.ts`'s basin reach, `terrainMaterial.ts`'s baked-vertex-colour note)
now say what they mean themselves. `watershedDescriptor.terrainResolution` is kept — it is an
art-directed ladder and `watershedDescriptor.test.ts` still asserts it — with its doc recording that
no live geometry picks it up. The lesson the module carried is not lost: the sRGB-versus-linear
vertex-colour error it documents belonged to a CPU vertex attribute, and the live path passes
`new Color('#rrggbb')` uniforms, which convert on construction.

A full suite run of the repaired tree is **7.3 s**, against 6.6 s before the deletion — the parallel
suite no longer has a single test sitting one second under the cliff.

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

**Simulation** (`new THREE.RenderTarget`, no depth, ping-ponged by copy rather than by swapping):
`read` and `write`, sized by `INK_QUALITY[tier].simulationResolution` — **1024 / 640 / 256 / 192**
across ULTRA / HIGH / MEDIUM / SAFE. (This line read 512/384/256/192 and was wrong for the two
tiers above MEDIUM.) Type is `RGBA16F` when the capability probe proved a complete half-float
framebuffer on the running context, and `RGBA8` when it could not — see §8.

At the top of the field's first `step`, and only there, the two targets are also advanced through
`planInkSettlement()` — the field's own integrator, its own decay rates and its own velocity field,
with the autonomous clock held at zero — so the state the first presented frame samples is the
fixed point the running simulation is heading for rather than the raw bake. See §8.

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
`THREE.Clock` deprecation, `powerPreference` ignored on Windows, HMR notice, and one that a later
reading of the dev server's own log added to this list —
`THREE.WebGPURenderer: PCFSoftShadowMap has been removed. Using PCFShadowMap instead.`, reported
from the ink field's render calls. It is benign (this composition has no shadow-casting lights) but
it is emitted repeatedly, it is attributable to a file in this stage, and an earlier version of
this document listed only four warnings. Recorded because a console accounting that omits a
repeating warning is not an accounting.

**The favicon 404 is gone from this list.** `src/app/icon.svg` now carries the app's icon under
Next's file convention, which emits `<link rel="icon" href="/icon.svg?…" sizes="any"
type="image/svg+xml">` into the head and serves the route at 200. The mark is drawn from
`WATERSHED_PALETTE` — `ink` ground, `cyan` core, `spectral` at the far end of the flow ramp — and
uses no colour the world does not already own. `THREE.Clock` is the one warning that stays, and it
is not fixable from this repository: the only `Clock` constructed is React Three Fiber's own, inside
its store factory, and R3F exposes no seam for it (no `clock` root option, and it writes
`state.clock.oldTime`, which `THREE.Timer` does not have). The evaluation is recorded at the call
site in `RendererHost.tsx` rather than acted on, because replacing it would mean patching a
dependency or globally filtering three's console output to delete one true deprecation notice.

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

- **No frame-rate consistency evidence.** 30/60/120 FPS were not tested; the browser tooling here
  cannot control frame rate reliably, so this is untested rather than passing.

Closed since this list was written, and now measured rather than open — see §8 for the numbers and
for `--drag-duration-ms`, `--reduced-motion-toggle`, `--measure-startup` and the harness's dynamic
frame rules: the reduced-motion drag (it writes pixels), the sustained-drag gap (a five-second
gesture is captured and its release is waited for as a stable state), the reduced-motion ambient
stop (two samples under the preference are compared as bytes), and MEDIUM/SAFE (both captured).

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

## 8. The Stage 3.5.x engineering pass

The visual work above was already approved and is unchanged by this section: no composition,
palette, camera angle, material brightness, ink morphology, typography or interaction timing was
touched. Everything below is either an initialisation defect, a capability check, a quality ladder
that was not being applied, or harness semantics. Evidence: `artifacts/stage35x-verify/`
(nine runs, prefix `s356*`, logs beside the PNGs).

### 8.1 Reduced motion was freezing the raw bake

`SceneHost` passes a zero ambient delta under the preference, and the advection shader's every term
is a function of that delta: the diffusion mix is `uDiffusion · dt`, so it went to zero; the decay
was `exp(dt · rate) = 1`, so nothing was pulled toward the authored river; and the backtrace offset
was `velocity · dt / span = 0`, so nothing moved. The preference therefore did not freeze a settled
field — it froze the seed, which is the one state in the field's life that is the bake's own
texture, region membranes and polygon boundaries included.

The repair is a **pre-computation, not a recolour**: `planInkSettlement()` runs the field's own
`advance` pass 160 times at a fixed 1/20 s step — about eight simulated seconds, two and a half
decay time constants — with the autonomous clock held at zero, so the frozen frame inherits the
integrator's fixed point under exactly the clock it will keep. It runs once, at the top of the first
`step`, in both modes.

**The pre-computation's cost was measured rather than estimated, and the first two answers were
wrong.** `--measure-startup` reports the main thread's long tasks
(`artifacts/stage35x-verify/run-s356v-ultra-1920x1080.log`):

| build | worst long task |
|---|---|
| 1 settlement step | 3646 ms |
| 160 steps (shipping) | 4282 ms |
| 640 steps | 3592 ms |

The 640-step run is the one that decides it: four times the shipping pass count costs *less* than
the baseline sample, so the settlement's own contribution is under the noise of a task that is
present with or without it. That task is roughly 3.6–4.3 s and is the **pre-existing** CPU
ink-density bake plus surface construction — the same order as `inkDensity.probe.test.ts`'s 1.6 s
under Node, and present at SAFE (3891 ms) where the simulation is 28× smaller. It is the largest
startup cost in the app and it is **not** addressed here; it is recorded because a 3.6-second
blocked main thread is the sort of thing that gets attributed to whatever change happened last.

### 8.2 Reduced motion and the camera

A preference change used to rebuild `CameraController`, and a replacement rig has no pose, so the
boot snap re-ran and the entry replayed. `CameraController` is now built once per visit and the
preference is a `setReducedMotion()` mode change; `setSequence` lands on the pose an intent *rests*
in — the last shot of the chain — instead of travelling through the ones it passes through. Entry,
focus and Escape therefore play no interpolation under the preference. Direct manipulation is
untouched: `resolveInkStepTiming` splits ambient from interaction time, the drag is interaction
time, and it still writes pixels.

Measured (`run-s356mt`): with the preference applied after load, two samples 350 ms apart are
**byte-identical**; the toggle moved **12.40%** of the frame against **7.91%** of the scene's own
drift over the same probe; withdrawing it moved **12.85%**.

### 8.3 Half-float targets are probed, not assumed

"WebGL2 exists" and "a `RGBA16F` framebuffer is renderable" are different questions, and a context
that answers the first and refuses the second draws nothing rather than throwing.
`probeHalfFloatRenderTarget` allocates the texture, attaches it, reads `checkFramebufferStatus`, and
unbinds and deletes on every path — including the paths where it refuses. `resolveInkTargetFormat`
turns that verdict into the field's allocation: `RGBA16F` on WebGPU and on a proven WebGL2 context,
`RGBA8` otherwise. The byte fallback keeps the advection and so keeps the drag, and states what it
costs — eight bits, a hard clamp at 1 where the half-float ceilings run to 1.2 and 1.8, and banding
the half-float target would not have had.

### 8.4 The fallback, and a backend name that was a lie

Two WebGPU failure modes are now distinguished, and the harness can force both. `--backend webgl2`
hides `navigator.gpu`, so the probe reports no adapter. `--fail-webgpu-init` advertises an adapter
whose `requestDevice()` rejects, which is where `WebGPUBackend.init` gives up.

That second run found a defect: **the status line read `WebGPU — Ultra` over a frame the console was
simultaneously explaining was drawn by WebGL2.** Three.js catches a failed WebGPU backend itself,
warns `WebGPU is not available, running under WebGL2 backend`, swaps in its own `WebGLBackend` and
**resolves `init()`** — so it never reaches the adapter as a rejection. `resolveBuiltBackend` now
asks the renderer what it built, and `RendererRuntime` judges fallback on
`handle.backend !== report.preferredBackend` rather than on which adapter ran, carrying the
adapter's `fallbackReason`. The run now reports `WebGL2 fallback — Ultra`, and its frame differs
from a plain WebGL2 run by **0.443%** of pixels (mean delta 0.29/255) — the same picture, correctly
labelled.

`CanvasSurface` handles the other half: a `HTMLCanvasElement` answers a context request once, so the
WebGL2 adapter *acquires* an element rather than using the one it was constructed with, and gets a
replacement if the failed WebGPU attempt may have claimed it. A half-built renderer is disposed
before the error is rethrown, because the runtime never received a handle for it and its own `stop`
cannot reach it.

### 8.5 The convergence volume had no quality ladder

Six sheets at 288×150 segments is 43,938 vertices apiece, and SAFE drew all six at that figure.
`CONVERGENCE_TIERS` now states two things per tier and nothing else — a segmentation and a layer
subset: ULTRA 288×150 / 220×72 with all six, HIGH at three quarters, MEDIUM at half with five
layers, SAFE at 88×46 / 66×22 with the three primaries (`rear-membrane`, `signal-tissue-a`,
`front-membrane`). No scale, height, rotation, gain or colour differs between tiers, and ULTRA is
the approved frame's own figures. Nothing downgrades automatically.

Measured idle luminance at 1920×1080: mean **23.45 / 23.46 / 22.71 / 21.76** and p99 **135.2 at all
four**, peak **230.4 at all four** — the ladder spends glow and keeps the composition.
Cross-capture pixel diffs between tiers are *not* offered as tier evidence: ULTRA-vs-SAFE measures
7.16% while ULTRA-vs-HIGH measures 4.56%, which is the field's own drift dominating the comparison,
not the ladder.

### 8.6 The capture harness was asking the wrong question of the held frame

Every capture waited for consecutive frames to stop changing, including the drag's mid-gesture
frame — which does not produce a better drag frame, it produces a frame of a drag that has already
been released. `drag-during` is now taken as found and judged as a moving frame by
`evaluateDynamicFrame`: the `--changed-min` floor unchanged, plus the changed set's bounding-box
coverage against a ceiling, its density inside that box, and both frames' clipped fraction. On the
five-second run (`--drag-duration-ms 5000`) the during frame reports **13.19%** changed at **37.5%**
coverage and **35.2%** density with **0.000%** clipped, and the release frame is still waited for as
a stable state.

### 8.7 What is still open

- The 3.6 s startup block in §8.1. Pre-existing, measured, not fixed.
- The canvas-rebuild path is unit-tested (`canvasSurface.test.ts`), not browser-tested: forcing a
  claimed canvas *and* a failing device needs an injection this harness does not have.
- `powerPreference` and `THREE.Clock` warnings remain, deliberately — see §5.
- `riverGeometry.ts`, `strataGeometry.ts`, `membraneMaterial.ts`, `riverMaterial.ts` and
  `terrainMaterial.ts` have no importer on the render path either. They cost no test time, so they
  were left alone rather than swept up with `terrainGeometry.ts`.
