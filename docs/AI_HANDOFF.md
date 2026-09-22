# Compute Atlas AI Handoff

## Repository

Repository: Polnareff258/compute-atlas
Default branch: master
Current branch: `master`
Stage 3.5.4 implementation commit: `9a452d9` (`feat: rebuild the scene as a rift, a
data-matter field and five phenomena`), baseline `5711cbf`. Same-stage follow-ups,
all pushed: `13a55bc` (massif segmentation and a second bake term), `faee10c`
(post-change cost in the brief), `2f1b3f2` (the old scene tree deleted). Push
target: `origin/master` via the configured v2rayN proxy,
`git -c http.proxy=http://127.0.0.1:10808 push origin master` (port 10808; 8088
does not work).

### Opening the site

`START_POLNAREFF.cmd` in the repository root — double-click to start the
development server, or pass `--no-open` to keep the browser closed. It checks
port 3000 before starting, never stops an unrelated process, waits for the
POLNAREFF SYSTEM page to become ready, and opens `http://localhost:3000`.

## Product

Compute Atlas is the repository for POLNAREFF SYSTEM, an interactive personal computing environment.
It is a desktop-first local graphics system rather than a portfolio or dashboard.
The current product surface is a single computational space: one rift structure, one GPU-resident data-matter field, and five regional phenomena that are the Knowledge Graph's nodes made visible as work rather than as marks. There is no drawn graph — no centre node, no radial edges, no five labels around a middle.
Future stages add deterministic commands, a local Agent gateway and runnable experiments.

## Current Stage

Stage 3.5.4 — Total Visual Rebuild — is implemented and captured on both
backends, and committed as `9a452d9`. It replaced the
visual implementation rather than adjusting it: the grey polygon Core, the
lofted hull, the `BoxGeometry` domains, the dashed routes, the four-plate
atmosphere and the radius-5 radial layout are all gone from the render tree.
Next: Visual Review / Sol Review. Stage 6 is not started and must remain out of
scope until separately requested.

Read `docs/STAGE354_REBUILD_REVIEW_BRIEF.md` before reviewing. It is written to be
read instead of a transcript and supersedes `docs/STAGE354_REVIEW_BRIEF.md` (the
earlier "Identity Re-Foundation" pass, whose subject no longer exists in the
render tree) and `docs/STAGE353_REVIEW_BRIEF.md` for regeneration.

Stage 3.5.4 supersedes the Stage 3.5.3 visual layer. 3.5.3 superseded 3.5.2, which
superseded 3.5.1. Stage 3.5.1 never produced its own screenshots, so nothing in
`artifacts/` is Stage 3.5.1 evidence; the `stage35-*` files are historical V2
evidence only, and every `stage35x-*` claim older than the current run should be
regenerated rather than trusted.
Stage 3.5 is an inserted visual identity slice, not a replacement for the existing
Stage 0–5.1 history.
Do not start Stage 6 work in a Stage 3.5 review.

## Architecture

Browser
├─ RendererHost
│  └─ RendererRuntime
│     ├─ WebGPU adapter  ─┐
│     └─ WebGL2 adapter  ─┴─ both construct the same WebGPURenderer,
│                             WebGL2 via `forceWebGL`
├─ R3F SceneHost
│  ├─ DeepField            (procedural far field + fog)
│  ├─ RiftStructureView    (the hero: one geometry per surface class)
│  ├─ DataMatterView       (one instanced draw call, 120k units at ULTRA)
│  ├─ DomainField          (five regional phenomena)
│  └─ PostPipeline         (bloom, DOF, fringe, vignette)
├─ CommandBus
│  └─ semantic adapters
└─ future Agent Gateway

The browser owns presentation and local interaction.
RendererRuntime owns backend lifecycle, observable renderer quality, and — as of
this stage — who resets the renderer's own draw-call counter.
SceneHost composes the R3F scene and maps semantic interaction to camera behaviour.

## Hard Boundaries

- No visual module imports Command or Agent. The old `ComputeCore`, whose boundary
  this bullet used to name, is deleted as of 3.5.4; `src/scene/` mounts five view
  modules, none of which import Command or Agent.
- V2 pure descriptor generators do not contain Three.js objects; scene resources stay in R3F view modules.
- Graph data and graph reducer do not import Three.js objects, Agent or Command core.
- Graph core does not import Agent.
- Command core does not import React, Three.js or R3F.
- Renderer does not own navigation semantics.
- Agent must produce validated Commands through an explicit gateway.
- Browser never calls Ollama directly.
- No hidden reasoning is exposed in UI or trace data.
- No fabricated hardware telemetry is allowed.
- One stage at a time; deferred features stay deferred.
- No global command bus singleton and no window.commandBus.

## Stable Contracts

Command: readonly serializable discriminated union; current implemented commands are NAVIGATE_HOME, FOCUS_NODE and SET_QUALITY.
CommandSource: pointer, keyboard, palette, agent or system.
CommandExecutionResult: synchronous executed/unavailable/failed/rejected result with the source command.
GraphInteractionState: serializable hoveredNodeId, focusedNodeId and derived idle/hovering/focused phase.
GraphController: focusNode(id) and clearFocus(); it dispatches semantic graph actions only.
RendererRuntime: start(), stop(), setQuality(profile), getState(); it owns backend/runtime quality state.
RendererHandle: backend identity, setQuality(settings) and dispose(); the active handle reapplies renderer policy.
QualityProfile: ultra, high, medium or safe.
CameraController: pointer/focus targets, visual state and damped update; SceneHost owns its instance.

## Implemented

Stage 0 — Repository architecture, strict TypeScript, quality profiles, test harness and documented boundaries.
Stage 1 — WebGPU-first renderer bootstrap with WebGL2 fallback and R3F root ownership.
Stage 2 — Real boot state machine, manifest/health checks, skip path and degraded shell.
Stage 3 — Layered Compute Core, camera controller, reduced motion and serializable telemetry seam.
Stage 4 — Data-driven Knowledge Graph, deterministic layout, spatial hover/focus and camera integration.
Stage 5 — Typed synchronous Command Bus, registry, results and graph/renderer semantic adapters.
Stage 5.1 — Independent hover/focus ownership, runtime-to-renderer quality propagation, truthful WebGL2 status and this handoff.
Stage 3.5 — Asymmetric Compute Core V2 composition, structure-changing states, WebGPU/WebGL2 browser evidence and fallback point-size correction.
Stage 3.5.1 — Deterministic route hierarchy, compact zoned GPU field, layered nucleus, five domain silhouettes, bent graph routes and explicit configured/rendered/signal telemetry counts. Its visual layer is superseded by Stage 3.5.2, and it never produced its own screenshots.
Stage 3.5.2 — Rebuilt hero Core (diagonal structural spine, asymmetric processing volume, central void, route ports and ingress, structural slices), a semantic routing flowfield of velocity-stretched dashes with route compression and arrival wake, five distinct domain sub-environments, one shared procedural surface material across both backends, and a reduced-motion path that stops the scene instead of dimming the canvas. Captured on WebGPU and WebGL2 at 1920×1080 and 2560×1440 with 31 local artifacts.
Stage 3.5.4 — Total Visual Rebuild. Replaced the Core, the domains, the routes, the matter field, the atmosphere and the domain layout. One rift structure entering from two opposite corners, one instanced data-matter field (120,000 units at ULTRA, positioned and shaded entirely in the vertex shader), five regional phenomena distinguished by field behaviour before colour, a procedural deep field, and one authored TSL shading model for every solid surface, on a post chain of bloom, depth of field, chromatic aberration and a hand-built vignette. Both backends run the same shader graph. Also fixed by measurement: telemetry reading a cumulative draw-call counter, a label anchor added twice, a dead idle-inflow constant, a circulation term that only set orientation, a layout that put three domains outside the frustum, rims that could not vary across a plane, veins that traced contours, and four hook-return mutations the React Compiler rules reject.
Stage 3.5.3 — Rebuilt the routing flowfield's density model (per world unit of route rather than per curve, packet length a world-unit quantity capped at a third of its route, count floor 1), blunted the hero Core's hulls so they close on a face instead of tapering to a point, unfolded the focused GRAPHICS stack into four near-equal canted layers, added a graph-neutral `routeContract.ts` and `SurfaceInput.presence`, and closed two holes in the capture harness's own interaction evidence (Escape did not prove hover had cleared; reduced motion was judged ready by a coarse signature an easing camera passes).

## Current State Ownership

Graph hover owner: SceneHost-local GraphInteractionState reducer, written by canvas pointer boundary actions.
Graph focus owner: the same reducer; pointer click and GraphController both emit FOCUS_NODE/CLEAR_FOCUS semantics.
Quality owner: RendererRuntime state, observable by RendererHost; SceneHost receives quality as a prop.
Renderer backend owner: RendererRuntime plus the selected WebGPU/WebGL2 adapter.
Renderer DPR owner: the active renderer handle plus the R3F RootStore setDpr seam.
Camera focus owner: SceneHost's existing CameraController; Graph only supplies semantic interaction.
Compute Core response owner: **deleted in 3.5.4.** `ComputeCore`, `CoreStructureView`, `ComputeCoreVisualState` and the `coreStructure` / `coreStructureGeometry` / `coreParameters` / `coreCirculation` layer are gone from disk, not parked. The boundary the bullet described still holds in what replaced it: `SceneHost` maps graph state to field uniform state and the view layer is graph-blind.
Stage 3.5.2 domain-view owner: **deleted in 3.5.4.** `domainEnvironments`, `domainCircuits`, `DomainEnvironment`, `KnowledgeGraph` and `GraphEdges` are gone. Graph hover/focus reducer ownership stays where it was — `SceneHost`'s `GraphInteractionState` — and the five regions now render through `src/scene/domains/domainPhenomena.ts`.
Stage 3.5.2 material owner: **deleted in 3.5.4.** `surfaceMaterial.ts` and `surfaceResponse.ts` are gone. The single material factory is now `src/scene/materials/energyMaterial.ts`; `surfaceGeometry.ts` still owns baked orientation luminance.
Stage 3.5.2 reduced-motion owner: `reducedMotion.ts` reads and subscribes to the media query; `RendererHost` passes the preference into `SceneHost`, which is where motion actually stops.
Stage 3.5.4 telemetry owner: `SceneHost` samples `src/telemetry/rendererTelemetry.ts` from the matter field's sample counts, distinguishing configured field budget, rendered field samples and active signal samples; `particleCount` is derived from rendered field samples.
Stage 3.5.3 routing-contract owner: **deleted in 3.5.4.** `src/scene/routing/` is gone in full — `routeContract`, `routeDash`, `routeDashGeometry`, `routeDashMaterial`, `graphRoutes`, `routeFlow`, `routeTelemetry`, `RouteDashes` and their tests. The route-field scheme they served is not in the render tree.
Stage 3.5.3 field-density owner: **deleted in 3.5.4**, same directory. The invariant it encoded is still worth keeping in mind for any future counted field: count through the same function the packer calls, so telemetry cannot describe a field the renderer was not asked to draw.
Stage 3.5.3 presence owner: **deleted in 3.5.4.** `SurfaceInput.presence` and `surfaceResponse.ts` are gone with the shading model they fed. The one idea worth carrying forward: composition recession needs a scalar that can take a surface's whole response below its resting gain — brightness alone cannot express it.
Stage 3.5.4 scene owner: `SceneHost` mounts five views and nothing else — `DeepField`, `RiftStructureView`, `DataMatterView`, `DomainField`, `PostPipeline`. Adding a sixth visual system means adding it there, and the frame is otherwise shading.
Stage 3.5.4 composition owner: `src/scene/hero/riftStructure.ts` owns the hero's members, tiers and cavity, and `riftStructure.bounds` is `{min, max}` — **not** an array of half-extents. `cameraController.test.ts` asserts the two-sided contract: the throat framed whole (0.2–0.55 of a half-frame) *and* the machine overflowing (>1.4).
Stage 3.5.4 field owner: `src/scene/field/fieldUniforms.ts` is the single place a semantic interaction becomes a number the GPU reads, and the idle corridor strength (`IDLE_CORRIDOR = 0.4`) lives there, not in `deriveFieldState.ts`. `deriveFieldState.ts` decides only *what* is happening; `fieldUniforms.ts` decides how strongly.
Stage 3.5.4 matter owner: `src/scene/matter/dataMatterMaterial.ts` owns the whole data-matter reconfiguration. The CPU writes the uniform block and nothing per unit per frame. A unit is a streak whose length exceeds its width at every point of its parameter range; a unit that is wider than it is long is a dot, and the brief forbids a field of dots.
Stage 3.5.4 region owner: `src/scene/domains/domainPhenomena.ts` resolves each region's `centre`, `extent` and `labelAnchor`, and the anchor is **local to the region** — the view renders the label inside a group whose position is set to `centre` every frame. Anything authored as an absolute world position here will be added twice.
Stage 3.5.4 draw-count owner: `src/renderer/canvasAdapters.ts` decides whether the renderer resets its own `info` counter, from the quality profile. When the post pipeline owns the frame it issues one render per internal pass, and the default would report the cost of a fullscreen quad. `rendererTelemetry.ts` reads `info.render.drawCalls` (a frame) and deliberately not `info.render.calls` (cumulative since page load, and not cleared by `Info.reset()`).

## Quality Propagation

SET_QUALITY enters through the existing Command Bus renderer adapter.
RendererHost calls RendererRuntime.setQuality(profile).
If a renderer is active, its RendererHandle.setQuality() reapplies canvas pixel ratio and size.
RendererHost also updates the R3F scene store DPR and explicitly re-renders SceneHost with runtime quality.
The pure policy is deriveEffectiveDpr(devicePixelRatio, settings).
Its rule is min(devicePixelRatio * pixelRatioScale, maxDpr), with finite positive input guards.
The same policy is used by canvas adapters and the R3F root configuration/update path.
Backend selection is not changed by quality changes.

## Known Deferred Features

- Stage 6: Command Palette UI and deterministic command completion/history.
- Stage 7: backend/Ollama health route and gateway health reporting.
- Stage 8: deterministic-first Agent Gateway, SSE and whitelist tool calling.
- Stage 9: public Agent Trace without hidden chain-of-thought.
- Stage 10: Developer Overlay and runtime counters.
- Stage 11: performance instrumentation and frame-budget tuning.
- Stage 12: final visual polish and regression pass.

Do not add palette, parser, Ollama, Agent, SSE, trace, overlay, Stage 11 or Stage 12 work while reviewing Stage 3.5.4.

## Known Issues / Debt

- Domain pointer projection is O(N) per pointer move; this is acceptable for five regions. It is now owned by `src/scene/domains/DomainField.tsx` — the `KnowledgeGraph` module that used to hold it is deleted.
- The browser logs known library/environment notices: missing `/favicon.ico`, Three.Clock deprecation, WebGPU PCFSoftShadowMap remapping, headless powerPreference/zero-vertex notices and software WebGL2 ReadPixels notices.
- **The node-material mid-tone divergence is closed, and the reason is architectural rather than numerical.** Both backends now construct the same `WebGPURenderer` (`forceWebGL: true` for the WebGL2 path) in `canvasAdapters.ts`, so there is one shader graph rather than two. Measured on the same frame and quality: idle spread 252.1 against 252.1, focus-GRAPHICS 251.6 against 251.6. What WebGL2 still cannot do is compute and storage buffers, and that is gated on the real backend rather than on the fallback.
- **Large flat faces are the main remaining visual risk.** A sweep through four or five control points is a plane and takes one value across its whole area. The rim and base terms now take a slow world-space density field, which is why the value hierarchy holds, but the near blade is still the flattest surface in the focus frame.
- FPS 36–45 at 1920×1080 ULTRA, measured in a **dev** build with HMR active. No production-build measurement exists; Stage 11 owns it.
- **The old visual tree has been deleted** (39 files, authorised by the user in two named batches): `src/scene/core/` in full, `src/scene/Atmosphere.tsx` + `atmosphere.test.ts` + `atmosphereDescriptor.ts`, `src/scene/graph/` in full, `src/scene/materials/{surfaceMaterial,surfaceResponse}.ts` + tests, and `src/scene/routing/` in full. The `graph/` and `routing/` directories no longer exist. Nothing was on the render path — an idle ULTRA capture after the deletion matches the pre-deletion frame (`spread 253.0` vs `252.8`). The architecture boundaries the brief protects (`RendererRuntime`, `SceneHost`, `CameraController`, the `ComputeCore` *contract*) are untouched; only the view layer went. See `docs/STAGE354_REBUILD_REVIEW_BRIEF.md` §13.
- Stage 3.5.1 evidence gaps are now historical: that stage never produced screenshots and its WebGL2/reduced-motion browser runs were never performed. Stage 3.5.2 re-ran all of them, so treat the `stage352-*` artifacts as the current evidence and the `stage35-*` files as historical V2 evidence only.
- No sustained FPS, GPU utilization, VRAM or thermal claim has been made.
- The development-only quality dispatch event exists solely for browser verification; it is not a production command API or UI.

## Verification

Stage 3.5.4 validation: `npm.cmd test` passed, 35 files / 312 tests; `npm.cmd run typecheck` passed; `npm.cmd run lint` passed with 0 errors and 0 warnings; `npm.cmd run build` passed on Next.js 16.3.5.

Stage 3.5.4 browser evidence, captured and inspected — WebGPU ULTRA 1920×1080 × {idle, hover-GRAPHICS, focus-GRAPHICS, focus-AI, escape}, 2560×1440 idle, a 480×270 thumbnail, text-hidden, reduced-motion, WebGL2 idle and focus-GRAPHICS, MEDIUM and SAFE idle, and a sixty-second idle run: **error 0, fatal 0** on every batch and every interaction assertion passed. The sixty-second run reported fps 36–45, frame time 22–28 ms, **49 draw calls per frame**, 483,200 triangles, 22 geometries and 26 textures — both flat across the whole run — with 120,000 rendered field samples against a 120,000 configured budget, of which 48,000 carried signal. The field is one draw call out of 49. Regenerate any of it with `scripts/stage352-capture.mjs`; the PNGs are local only.

Stage 3.5.2 validation (historical): `npm.cmd test` passed, 32 files / 237 tests; `npm.cmd run typecheck` passed; `npm.cmd run lint` passed; `NEXT_TELEMETRY_DISABLED=1 npm.cmd run build` passed on Next.js 16.3.5.

Stage 3.5.2 browser capture uses a zero-dependency Chrome DevTools Protocol harness over Node 24's built-in `WebSocket` (`scripts/stage352-capture.mjs`) against `?boot=skip&telemetry=1`. No dependency or `package.json` entry was added to support it; browser temp profiles live in the OS temp directory, never in the repository.
- WebGPU, 1920×1080 and 2560×1440 × {overview, hover-GRAPHICS, focus-GRAPHICS, Escape}: 10 files, 34 console messages — info 25, warning 9, error 0, fatal 0.
- WebGL2, the same matrix, reached by shadowing `navigator.gpu` before document start: 10 files, 28 console messages — info 24, warning 4, error 0, fatal 0. No NaN, invalid buffer or WebGPU validation error on either backend.
- A 480×270 downscale of each overview is captured alongside it; the Hero, the processing volume and the primary route stay recognisable at that size.
- Reduced motion is measured rather than asserted. Sampling the same scene twice ~3 s apart inside one session: normal mode 1.82% of pixels (37,772 px) changed; reduced motion 0.00% (0 px) changed, mean luminance identical to three decimals. Evidence: `artifacts/stage352-motionprobe-{normal,reduced}-{a,b}.png`.
- Quality profiles change structure, not only counts. SAFE vs ULTRA differ by 16.60% (overview) and 17.08% (hover); ULTRA reaches p99.9 215 / peak 255 against SAFE's 147 / 231. The SAFE overview still reads as the Hero, its spine, all five domain silhouettes and the main routes.
- 31 `artifacts/stage352-*.png` files in total, all local: `.gitignore` excludes `artifacts/` and only the 7 historical `stage35-*` files were force-added past it, so none of this stage's evidence is in the repository. Re-run `scripts/stage352-capture.mjs` to regenerate it; do not expect the PNGs to be present on a fresh clone.

Two real defects were found by running this matrix and fixed; neither was visible to the test suite:
- The entire membrane tier rendered nothing on both backends (three samples an alpha map in the green channel; the map was a single-channel red texture, so every membrane fragment was discarded against a constant zero). Forcing the alpha test to 0 changed 4.60% of the frame (95,407 px), which is the proof it had been drawing nothing. The dither was replaced with a bounded blend.
- `Atmosphere` diverged by backend on the depth backdrop: (2,3,3) on the node path against the scene background of (5,6,9). It no longer branches on backend and now reads (26,33,33) at centre and (11–12,14–16,17) at the corners on WebGPU, matching WebGL2.

## Current Visual Review / Sol Review Guidance

Before reviewing Stage 3.5.4:
1. Read `docs/STAGE354_REBUILD_REVIEW_BRIEF.md` first — it is written to be read instead of re-deriving the measured facts — then this file and the Stage 3.5.4 section in `docs/PROJECT_STATUS.md`.
2. Confirm the current HEAD and worktree against `origin/master`. The stage is committed; the tree is clean. Review the diff `5711cbf..HEAD`, which now also carries the deletion of the old tree.
3. Review only the live visual tree listed in the file map. The Stage 3.5.2/3.5.3 files that used to sit under it have been deleted, so there is nothing left to confuse with live behaviour.
4. Regenerate the frames with `scripts/stage352-capture.mjs` and open them. Do not review the visual layer from a description of it — this is the one part of the stage a document cannot carry.
5. Treat the flat-face risk as open. It is named in the brief's §9 and it is the thing a critic will point at.
6. Keep Stage 6 and later work out of this review.

Review the ownership seams before reviewing visual behavior.
Treat the reducer tests as the authority for hover/focus semantics.
Treat deriveEffectiveDpr and RendererHandle.setQuality as the authority for quality application.
Use browser evidence for renderer behavior; do not infer hardware metrics from labels.

## Review File Map

Command:
src/commands/types.ts
src/commands/result.ts
src/commands/bus.ts
src/commands/registry.ts
src/commands/commandEnvironment.ts
src/commands/adapters/graphCommands.ts
src/commands/adapters/rendererCommands.ts
src/commands/integration.test.ts

Graph:
src/graph/types.ts
src/graph/interaction.ts
src/graph/graphController.ts
src/graph/interaction.test.ts
src/scene/graph/KnowledgeGraph.tsx

Renderer/quality:
src/config/quality.ts
src/renderer/runtime.ts
src/renderer/runtime.test.ts
src/renderer/RendererHost.tsx
src/renderer/canvasAdapters.ts
tests/smoke/quality.test.ts

Scene integration:
src/scene/SceneHost.tsx
src/scene/camera/cameraController.ts
src/scene/camera/cameraController.test.ts

Live visual tree (Stage 3.5.4) — review these and only these for the frame:
src/scene/hero/riftStructure.ts
src/scene/hero/RiftStructureView.tsx
src/scene/matter/dataMatter.ts
src/scene/matter/dataMatterMaterial.ts
src/scene/matter/DataMatterView.tsx
src/scene/domains/domainPhenomena.ts
src/scene/domains/domainGeometry.ts
src/scene/domains/DomainField.tsx
src/scene/backdrop/backdropStructure.ts
src/scene/backdrop/DeepField.tsx
src/scene/field/agentActivity.ts
src/scene/field/deriveFieldState.ts
src/scene/field/fieldUniforms.ts
src/scene/post/PostPipeline.tsx

Shared systems (Stage 3.5.4):
src/scene/materials/energyMaterial.ts
src/scene/materials/structureGeometry.ts
src/scene/materials/machinePalette.ts
src/graph/layout.ts

Deleted in Stage 3.5.4 — this tree is gone, not parked. It is listed here only so
a reviewer does not go looking for it, and so no path in it is mistaken for live
behaviour:
src/scene/core/*  ·  src/scene/Atmosphere.tsx  ·  src/scene/atmosphereDescriptor.ts
src/scene/graph/*  (the directory no longer exists)
src/scene/routing/*  (the directory no longer exists)
src/scene/materials/{surfaceMaterial,surfaceResponse}.ts

Reduced motion / UI:
src/renderer/reducedMotion.ts
src/renderer/RendererHost.tsx
src/ui/statusCopy.ts
src/ui/statusCopy.test.ts
src/ui/RendererStatus.tsx

Telemetry:
src/telemetry/rendererTelemetry.ts
src/telemetry/rendererTelemetry.test.ts

Capture harness:
scripts/stage352-capture.mjs

Agent:
not implemented yet

## Next Gate

Perform Visual Review / Sol Review of Stage 3.5.4 against freshly captured frames. Read `docs/STAGE354_REBUILD_REVIEW_BRIEF.md` first. Regenerate the matrix rather than trusting any PNG description: `.gitignore` excludes `artifacts/`, the current captures live in the OS temp directory of one machine, and no baseline image set is committed. Keep the flat-face risk in §9 of that brief open rather than assuming it was solved. Do not start Stage 6 as part of this task, and do not delete the dead visual tree without naming it explicitly.
