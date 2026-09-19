# Compute Atlas AI Handoff

## Repository

Repository: Polnareff258/compute-atlas
Default branch: master
Current branch: `master`
Stage 3.5.2 implementation commit: latest local commit at handoff; see `git log -1` for the SHA. Push target: `origin/master` via the configured v2rayN proxy.

## Product

Compute Atlas is the repository for POLNAREFF SYSTEM, an interactive personal computing environment.
It is a desktop-first local graphics system rather than a portfolio or dashboard.
The current product surface is a GPU-first Compute Core surrounded by a spatial Knowledge Graph.
Future stages add deterministic commands, a local Agent gateway and runnable experiments.

## Current Stage

Stage 3.5.2 visual reconstruction is implemented and captured on both backends.
Next: Visual Review / Sol Review, carrying the one documented node-material divergence as an open item.
Stage 6 is not started and must remain out of scope until separately requested.

Stage 3.5.2 supersedes the Stage 3.5.1 visual layer. Stage 3.5.1 never produced its own screenshots, so nothing in `artifacts/` is Stage 3.5.1 evidence — the `stage352-*` files are this stage's, and the `stage35-*` files are historical V2 evidence only.
Stage 3.5 is an inserted visual identity slice, not a replacement for the existing Stage 0–5.1 history.
Do not start Stage 6 work in a Stage 3.5 review.

## Architecture

Browser
├─ RendererHost
│  └─ RendererRuntime
│     ├─ WebGPU adapter
│     └─ WebGL2 adapter
├─ R3F SceneHost
│  ├─ ComputeCore
│  ├─ deterministic topology / field / trajectory descriptors
│  ├─ GPU-first field material + WebGL2 fallback
│  └─ KnowledgeGraph
├─ CommandBus
│  └─ semantic adapters
└─ future Agent Gateway

The browser owns presentation and local interaction.
RendererRuntime owns backend lifecycle and observable renderer quality.
SceneHost composes the R3F scene and maps semantic interaction to camera/Core behavior.

## Hard Boundaries

- ComputeCore does not import Graph, Command or Agent.
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

## Current State Ownership

Graph hover owner: SceneHost-local GraphInteractionState reducer, written by canvas pointer boundary actions.
Graph focus owner: the same reducer; pointer click and GraphController both emit FOCUS_NODE/CLEAR_FOCUS semantics.
Quality owner: RendererRuntime state, observable by RendererHost; SceneHost receives quality as a prop.
Renderer backend owner: RendererRuntime plus the selected WebGPU/WebGL2 adapter.
Renderer DPR owner: the active renderer handle plus the R3F RootStore setDpr seam.
Camera focus owner: SceneHost's existing CameraController; Graph only supplies semantic interaction.
Compute Core response owner: SceneHost maps graph state to ComputeCoreVisualState; ComputeCore remains graph-blind.
Compute Core visual owner: ComputeCore composes deterministic structure, circulation and signal views and stays graph-blind.
Stage 3.5.2 structure owner: `coreStructure.ts` supplies the spine, processing volume, void, ports and slices; `coreStructureGeometry.ts` and `structureGeometry.ts` bake them into solid and membrane geometry; `CoreStructureView.tsx` mounts them.
Stage 3.5.2 circulation owner: `coreCirculation.ts` supplies the deterministic route field and its stretched-dash samples. Only discrete semantic state (hover, focus, quality, reduced motion) crosses from React; continuous intensity, time and progress stay in refs and uniforms.
Stage 3.5.2 domain-view owner: `domainEnvironments.ts` supplies perimeter descriptors and `domainCircuits.ts` the per-domain local topology; `DomainEnvironment.tsx` renders them. `KnowledgeGraph` retains hover/focus reducer ownership and `GraphEdges.tsx` draws view-only routes.
Stage 3.5.2 material owner: `surfaceMaterial.ts` is the single factory for every structural role on both backends; `surfaceGeometry.ts` owns baked orientation luminance and the bounded membrane opacity band.
Stage 3.5.2 reduced-motion owner: `reducedMotion.ts` reads and subscribes to the media query; `RendererHost` passes the preference into `SceneHost`, which is where motion actually stops.
Stage 3.5.2 telemetry owner: `SceneHost` samples `src/telemetry/rendererTelemetry.ts` from `coreCirculation` counts, distinguishing configured field budget, rendered field samples and active signal samples; `particleCount` remains rendered field samples.

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

Do not add palette, parser, Ollama, Agent, SSE, trace, overlay, Stage 11 or Stage 12 work while reviewing Stage 3.5.2.

## Known Issues / Debt

- KnowledgeGraph pointer projection is O(N) per pointer move; this is acceptable for five domain nodes.
- The browser logs known library/environment notices: missing `/favicon.ico`, Three.Clock deprecation, WebGPU PCFSoftShadowMap remapping, headless powerPreference/zero-vertex notices and software WebGL2 ReadPixels notices.
- **Open, localised, not fixed: the WebGPU node material path renders the machine's mid-tones darker than the standard path.** Same frame at (1152,497): WebGPU 83 against WebGL2 143, ratio 0.58 across sampled pixels. Histograms: WebGPU p50 4 / p90 28 / p99 102 against WebGL2 p50 26 / p90 69 / p99 155. Forcing the standard path on WebGPU reproduces the WebGL2 histogram to within 1–2 levels (p50 28/26, p90 70/69, p99 156/155, p99.9 219/208), which localises the divergence inside the node material path and not in the renderer's output transform, fog or colour management. Three's `VertexColorNode`, the GLSL and node fog formulas and the node alpha path were each checked and ruled out. Carried as debt; do not describe WebGPU and WebGL2 output as identical.
- Stage 3.5.1 evidence gaps are now historical: that stage never produced screenshots and its WebGL2/reduced-motion browser runs were never performed. Stage 3.5.2 re-ran all of them, so treat the `stage352-*` artifacts as the current evidence and the `stage35-*` files as historical V2 evidence only.
- No sustained FPS, GPU utilization, VRAM or thermal claim has been made.
- The development-only quality dispatch event exists solely for browser verification; it is not a production command API or UI.

## Verification

Stage 3.5.2 validation: `npm.cmd test` passed, 32 files / 237 tests; `npm.cmd run typecheck` passed; `npm.cmd run lint` passed; `NEXT_TELEMETRY_DISABLED=1 npm.cmd run build` passed on Next.js 16.3.5.

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

Before reviewing Stage 3.5.2:
1. Read `docs/STAGE352_REVIEW_BRIEF.md` first — it is written to be read instead of re-deriving the measured facts — then this file and the Stage 3.5.2 section in `docs/PROJECT_STATUS.md`.
2. Confirm the current HEAD and worktree against `origin/master`, and confirm the pre-existing user changes (`vitest.config.ts`, `START_STAGE351_REVIEW.cmd`, `scripts/`, `tests/stage351-review-launcher.test.mjs`) are still present and unmodified.
3. Review only the relevant files listed below; do not scan the whole repository without evidence.
4. Inspect the `artifacts/stage352-*.png` captures directly if they are present in your worktree; if they are not, regenerate them with `scripts/stage352-capture.mjs` rather than reviewing from these descriptions. Both backends, both resolutions, hover, focus, Escape, the 480×270 downscales, the reduced-motion pair and the SAFE-vs-ULTRA pair are all covered, so unlike Stage 3.5.1 there is no screenshot gap to accept.
5. Keep the node-material mid-tone divergence open rather than assuming the backends match.
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

Compute Core (Stage 3.5.2):
src/scene/core/ComputeCore.tsx
src/scene/core/CoreStructureView.tsx
src/scene/core/coreStructure.ts
src/scene/core/coreStructureGeometry.ts
src/scene/core/coreCirculation.ts
src/scene/core/coreParameters.ts
src/scene/core/coreTypes.ts

Structure / material system (Stage 3.5.2):
src/scene/materials/surfaceMaterial.ts
src/scene/materials/surfaceGeometry.ts
src/scene/materials/structureGeometry.ts
src/scene/materials/machinePalette.ts
src/scene/Atmosphere.tsx
src/scene/atmosphereDescriptor.ts

Domains / graph (Stage 3.5.2):
src/scene/graph/DomainEnvironment.tsx
src/scene/graph/domainEnvironments.ts
src/scene/graph/domainCircuits.ts
src/scene/graph/GraphEdges.tsx
src/scene/graph/KnowledgeGraph.tsx
src/graph/layout.ts

Reduced motion / UI (Stage 3.5.2):
src/renderer/reducedMotion.ts
src/renderer/RendererHost.tsx
src/ui/statusCopy.ts
src/ui/RendererStatus.tsx

Status:
src/ui/statusCopy.ts
src/ui/statusCopy.test.ts

Agent:
not implemented yet

## Next Gate

Perform Visual Review / Sol Review of Stage 3.5.2 against the captured artifacts, with the node-material mid-tone divergence reviewed as a known open item rather than a surprise. Do not start Stage 6 as part of this task.
