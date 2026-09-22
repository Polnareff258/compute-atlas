# POLNAREFF SYSTEM Project Status

**As of:** 2026-09-20
**Repository:** `Polnareff258/compute-atlas`
**Current phase:** Phase 1
**Current stage:** Stage 3.5.4 — Total Visual Rebuild. The visual implementation of the Core, the domains, the routes, the matter field, the atmosphere and the domain layout has been **replaced**, not adjusted. The frame is now one rift structure, one instanced data-matter field, five regional phenomena and a procedural deep field, on one shading model and one post chain. Review brief: `docs/STAGE354_REBUILD_REVIEW_BRIEF.md`. Stage 6 is not started.

## Confirmed architecture

- Next.js App Router full-stack application.
- Three.js WebGPU-first renderer with WebGL2 fallback.
- Dynamic hybrid visual density: sparse idle state, denser response states.
- Typed Command Bus plus Zustand for serializable UI/system state.
- Server-only Ollama access through HTTP + SSE Agent Gateway.
- Agent whitelist tools and schema validation; no arbitrary code, shell, filesystem or DOM access.
- Boot state is serializable and isolated from Three.js objects; renderer initialization remains behind the existing runtime boundary.
- The scene's visual resources and interaction math are owned by the views under `src/scene/` that `SceneHost` mounts; none of them import Command or Agent modules. As of Stage 3.5.4 the old `ComputeCore` is gone — `src/scene/core/`, `src/scene/graph/`, `src/scene/routing/`, `Atmosphere` and the old surface materials have been deleted, not parked.

## Current progress

| Stage | Status | Evidence |
|---|---|---|
| Stage 0 — repository/architecture setup | Complete | Commit f633032; strict TypeScript, quality profiles and test harness are present. |
| Stage 1 — renderer bootstrap | Complete | Commit 2700f3b; WebGPU-first/WebGL2 adapter host, R3F scene shell, status UI and headless browser verification are complete. |
| Stage 2 — boot experience | Complete | Commit 36abdda; reducer, health seam, manifest, coordinator, visual bootstrap overlay, degraded path and skip path verified. |
| Stage 3 — Compute Core | Complete | Layered Core, quality budgets, inertial pointer response, WebGPU-compatible materials, telemetry seam and desktop browser evidence are complete. |
| Stage 4 — Knowledge Graph | Complete | Data-driven schema, deterministic spatial layout, graph interaction, camera focus and browser evidence are complete. |
| Stage 5 — Command Bus | Complete | Typed synchronous dispatch, graph/quality adapters, structured results and unavailable future commands are verified. |
| Stage 5.1 — corrective pass | Complete | Hover/focus ownership separated; runtime quality now reaches canvas/R3F DPR; AI handoff added. |
| Stage 3.5 — Compute Core Visual Identity V2 | Complete | Non-spherical V2 composition, structure-changing states, WebGPU/WebGL2 evidence and fallback correction are complete. |
| Stage 3.5.1 — Visual Composition Reconstruction | Superseded by Stage 3.5.2 | Deterministic machine topology, local field, five domain silhouettes and truthful draw-count telemetry were introduced here. Its own screenshot pass was never captured in-browser; Stage 3.5.2 rebuilt the visual layer and produced the evidence instead. |
| Stage 3.5.4 — Total Visual Rebuild | Implemented; captured on WebGPU and WebGL2 | The old Core, domain boxes, dashed routes, atmosphere and radial layout are gone from the render tree. One rift, one instanced data-matter field, five phenomena and a procedural deep field on one shading model. Reviewed in `docs/STAGE354_REBUILD_REVIEW_BRIEF.md`. |
| Stage 3.5.3 — Visual Convergence | Superseded by Stage 3.5.4 | Rebuilt the routing flowfield's density model (per world unit of route rather than per curve), blunted the hero Core's hulls so they close on a face instead of a point, unfolded the focused GRAPHICS stack into real layers, added `routeContract.ts` and `SurfaceInput.presence`, and closed two holes in the capture harness's own interaction evidence. Reviewed in `docs/STAGE353_REVIEW_BRIEF.md`. |
| Stage 3.5.2 — Visual Reconstruction | Superseded by Stage 3.5.3 | Rebuilt hero Core, semantic routing flowfield, five domain sub-environments, unified surface material and reduced-motion fix. 31 local evidence PNGs (plus the 7 historical V2 files), error 0 / fatal 0 on both backends. One known node-material mid-tone divergence is documented below. |
| Stage 6 — Command Palette | Not started | No palette UI has been added. |
| Stage 7 — backend/Ollama health | Not started | Browser gateway intentionally remains NOT INITIALIZED until this stage. |
| Stage 8 — Agent tool calling | Not started | No model or tool call is made from the browser. |
| Stage 9 — Agent Trace | Not started | No hidden reasoning is exposed. |
| Stage 10 — Developer Overlay | Not started | No telemetry overlay UI has been added. |
| Stage 11 — performance pass | Not started | Owns sustained GPU/frame-budget measurement and tuning. |
| Stage 12 — visual polish | Not started | Requires Graph interaction evidence first. |

## Stage 3 implementation

- src/scene/core/coreParameters.ts derives deterministic Core budgets from the existing quality profiles:
  - ULTRA: 72,000 particles, 3 cage detail, 3 orbitals, field resolution 48.
  - HIGH: 42,000 particles, 2 cage detail, 3 orbitals, field resolution 40.
  - MEDIUM: 18,000 particles, 2 cage detail, 2 orbitals, field resolution 32.
  - SAFE: 6,000 particles, 1 cage detail, 1 orbital, field resolution 24.
- src/scene/core/ComputeCore.tsx owns one spatial group, stable resources, pointer normalization, awakening-to-idle transition, camera parallax and telemetry callback.
- CoreSeed, CoreCage, CoreEnergyField, CoreParticleShell and CoreOrbitals form the layered visual system.
- CoreEnergyField uses WebGPU/WebGL-compatible MeshBasicMaterial and procedural geometry; no ShaderMaterial compatibility warning remains.
- src/scene/camera/cameraController.ts contains scalar clamp/damping math and reduced-motion behavior with no per-frame allocations.
- src/telemetry/rendererTelemetry.ts reads renderer.info and frame delta into serializable snapshots; absent counters become null. telemetry=1 enables a throttled diagnostic console sink only; default UI remains unchanged.
- Quality budgets are explicit in src/config/quality.ts and passed from the renderer runtime into SceneHost/Core.

## Verification evidence

- npm run lint — pass.
- npm run typecheck — pass.
- npm test — 10 files, 34 tests passed.
- NEXT_TELEMETRY_DISABLED=1 npm run build — pass with Next 16.3.5.
- Chrome 1920×1080, clean dev service, boot=skip — canvas reports three.js r186 webgpu; boot reaches complete; graphics fact is WEBGPU READY; Compute Scene is ACTIVE; screenshot artifacts/stage3-compute-core-final-webgpu.png generated.
- Chrome 2560×1440, GPU-disabled fallback smoke — boot reaches complete; canvas is 2538×1286 within the desktop viewport; screenshot artifacts/stage3-compute-core-2560-fallback.png generated.
- Browser logs after the material correction contain no ShaderMaterial incompatibility or uncaught R3F error. Remaining messages are environment/library notices: Windows powerPreference is ignored, Three.Clock is deprecated, PCFSoftShadowMap is remapped by Three WebGPU, and one headless WebGPU zero-vertex draw warning.
- Telemetry/camera/budget focused tests pass. A sustained numeric FPS/frame-time budget was intentionally not recorded from the virtual-time/headless harness; Stage 11 owns that measurement on a real interactive desktop run.

## Handoff rule

An agent must read the spec, project status and phase plan before editing. Work one stage at a time, run focused and full verification, update this file with evidence, and leave later-stage functionality untouched unless the current stage boundary requires it.

## Immediate next action

Visual Review / Sol Review of Stage 3.5.1, with the evidence gaps below resolved or explicitly accepted. Do not begin Stage 6 unless separately requested.

## Stage 4 implementation

Stage 4 adds the first spatial Knowledge Graph without widening the existing renderer or Compute Core boundaries:

- `src/graph/types.ts` defines the serializable `GraphNode`, `GraphEdge`, `GraphManifest`, `GraphPosition` and `GraphLayout` contracts. The graph schema contains no Three.js, DOM, command or Agent objects.
- `src/graph/graphManifest.ts` is the single source of truth for the six stable node ids: `core`, `ai`, `graphics`, `game-analysis`, `systems` and `research`. The initial topology is the five-edge star rooted at `core`.
- `src/graph/layout.ts` derives a deterministic, finite, depth-separated layout. `graphDensity` changes only deterministic edge subdivision detail; it never duplicates or removes semantic nodes.
- `src/graph/interaction.ts` provides a serializable reducer for pointer enter/leave, focus, focus switching and clear-focus actions. Scene-local React state is used because Stage 4 does not require a global graph store.
- `src/scene/graph/KnowledgeGraph.tsx`, `GraphNode.tsx` and `GraphEdges.tsx` render the manifest-driven domain nodes and edges. The graph remains a visual interaction surface and does not import Command or Agent modules.
- `SceneHost` is the integration boundary: it maps graph hover/focus to the existing `CameraController` and to `ComputeCoreVisualState` (`hover_response` / `focusing`). `ComputeCore` remains graph-independent.
- `deriveCameraFocusTarget()` converts a graph position to a bounded normalized focus direction consumed by the existing damped camera controller. Escape clears focus and returns the camera target to the overview.

### Stage 4 verification evidence

- `npm test` — pass: 14 test files, 45 tests.
- `npm run lint` — pass.
- `npm run typecheck` — pass.
- `NEXT_TELEMETRY_DISABLED=1 npm run build` — pass with Next 16.3.5.
- WebGPU browser run at 1920×1080 (`boot=skip`) — actual viewport 1898×926, `Three.js WebGPURenderer`, five semantic domain labels, hover response, GRAPHICS focus, and Escape unfocus verified. Screenshots: `artifacts/stage4-graph-overview-webgpu.png`, `artifacts/stage4-graph-hover-webgpu.png`, `artifacts/stage4-graph-focused-webgpu.png`.
- WebGL2 fallback run at 2560×1440 (`--disable-gpu`) — actual viewport 2538×1342, `Three.js WebGLRenderer`, all five labels visible and GRAPHICS focus verified. Screenshot: `artifacts/stage4-graph-fallback.png`.
- Browser runs reported no uncaught exceptions or app/R3F errors. Remaining messages are known environment/library warnings: React DevTools/HMR, Three.Clock deprecation, WebGPU PCFSoftShadowMap remapping, Windows `powerPreference` handling, and headless adapter/zero-vertex warnings. No fabricated GPU utilization or hardware telemetry was introduced.
- Sustained FPS/GPU utilization claims remain intentionally out of scope for Stage 4; Stage 11 owns that measurement.


## Stage 5 implementation

Stage 5 establishes the typed command boundary without adding a palette, parser, Agent or overlay:

- `src/commands/types.ts` retains the strict serializable command union and source union as readonly contracts.
- `src/commands/result.ts` defines structured `executed`, `rejected`, `unavailable` and `failed` execution results plus the public dispatch event seam.
- `src/commands/registry.ts` provides a typed registry with duplicate registration rejection. It uses no `any`, no stringly-typed handler table and no silent overwrite.
- `src/commands/bus.ts` provides synchronous deterministic dispatch. Missing handlers return `unavailable`; handler exceptions become `failed`; subscriber exceptions are isolated from command execution.
- `src/commands/commandEnvironment.ts` defines injected semantic capabilities only. The command core imports no Three.js, React, R3F, Agent or Ollama module.
- `src/commands/adapters/graphCommands.ts` maps `FOCUS_NODE` and `NAVIGATE_HOME` to `focusNode` and `clearFocus`. `src/graph/graphController.ts` converts those capabilities into the existing Stage 4 interaction actions, preserving one graph state source of truth.
- `src/commands/adapters/rendererCommands.ts` maps `SET_QUALITY` to the existing renderer quality seam. RendererRuntime is the canonical quality owner; RendererHost forwards the runtime quality to both the active renderer handle and the R3F scene store, while SceneHost receives it as a prop for Core/Graph.
- `SceneHost` constructs the bus through dependency injection and exposes a lifecycle callback for future palette/Agent sources. No global service locator or DOM/Three.js mutation was added.
- `OPEN_SECTION`, `SYSTEM_STATUS`, `SET_DEV_OVERLAY` and `SURPRISE_ME` remain unregistered and truthfully return `unavailable` until their owning stages exist. No random or fake system behavior was introduced.

### Stage 5 verification evidence

- `npm test`: 17 test files and 59 tests passed, including 14 focused registry/bus/adapter tests.
- `npm run lint` — pass.
- `npm run typecheck` — pass.
- `NEXT_TELEMETRY_DISABLED=1 npm run build` — pass with Next 16.3.5.
- WebGPU browser regression at actual viewport 1898×926: Compute Core and five Graph labels rendered; hover, focus, and Escape unfocus passed; no uncaught exceptions or console error events.
- WebGL2 fallback browser regression at actual viewport 2538×1342: same Graph interactions passed; no uncaught exceptions or console error events.
- Dependency audit confirmed commands core has no Three.js/React/Agent imports; Graph and ComputeCore have no Command imports.
- Stage 6 Command Palette, natural-language parsing, Ollama and Agent work remain untouched.
## Stage 5.1 corrective pass

Stage 5.1 is a corrective pass over the Stage 5 seams. It does not introduce Command Palette, parsing, Ollama or Agent behavior.

- Graph hover and focus ownership are independent. `POINTER_ENTER_NODE` / `POINTER_LEAVE_NODE` own only real pointer hover; `FOCUS_NODE` / `CLEAR_FOCUS` own only focus. Programmatic `FOCUS_NODE` no longer synthesizes hover, so `NAVIGATE_HOME` cannot leave phantom hover behind.
- `GraphController` remains a semantic `focusNode(id)` / `clearFocus()` adapter and does not dispatch pointer actions or know pointer position.
- `RendererRuntime` remains the canonical observable quality state. `RendererHandle.setQuality(settings)` reapplies the active adapter's pixel ratio and size without recreating the renderer or changing backend selection.
- `deriveEffectiveDpr(devicePixelRatio, settings)` is the shared pure policy: finite positive browser DPR multiplied by `pixelRatioScale`, clamped by `maxDpr`. RendererHost applies the same result through the R3F RootStore `setDpr` seam and explicitly re-renders SceneHost with the new runtime quality.
- SceneHost no longer keeps duplicate `commandQuality` state. Core and Graph consume the quality prop delivered by the runtime-owned render path.
- WebGL2 `ready` status now reports `WEBGL2 READY` instead of the ambiguous initialization label when WebGPU is unavailable and WebGL2 is the selected backend.
- `docs/AI_HANDOFF.md` is the low-token entry point for future review; it indexes ownership, stable contracts, deferred work and verification without copying the full history.

### Stage 5.1 verification evidence

- `npm test`: 17 test files and 65 tests passed after the status-copy regression was included.
- `npm run lint` — pass.
- `npm run typecheck` — pass.
- `NEXT_TELEMETRY_DISABLED=1 npm run build` — pass on Next 16.3.5 before the documentation-only changes.
- WebGPU `boot=skip`: actual headless viewport CSS 758×426; status `WEBGPU READY`; Graph hover, GRAPHICS focus and Escape unfocus passed; no uncaught exception.
- WebGPU quality dispatch: ULTRA drawing buffer 758×426, SAFE 469×264, effective DPR `1 → 0.6187335092348285 → 1`; status and scene returned to ULTRA without recreating the renderer.
- WebGL2 fallback: actual CSS viewport 758×482; status `WEBGL2 READY`; Graph hover/focus passed; SAFE quality drawing buffer 469×298; no uncaught exception.
- Browser notices remain limited to known environment/library messages: React DevTools/HMR, Three.Clock deprecation, WebGPU PCFSoftShadowMap remapping, and headless `powerPreference`/zero-vertex notices. No fake GPU, VRAM, utilization or thermal metrics were added.
- No new Command Palette, parser, Ollama, Agent Gateway, SSE, Agent Trace, Developer Overlay or Stage 11/12 work was introduced.

### Stage 5.1 ownership audit

- Command core has no React, Three.js or R3F import.
- ComputeCore has no Graph, Command or Agent import.
- Graph has no Agent import and graph schema remains serializable.
- No global singleton, `window.commandBus`, arbitrary DOM mutation or renderer recreation was added.
- Quality changes do not alter WebGPU/WebGL2 backend selection.

### Stage 5.1 handoff

Stage 5.1 is complete. The next isolated slice is Stage 6 — Command Palette; do not start it as part of this record.

## Stage 3.5 — Compute Core Visual Identity V2

Stage 3.5 replaces the former spherical Core presentation with a structured, GPU-first composition while preserving the Stage 0–5.1 renderer, camera, Graph and Command boundaries. It intentionally stops before Command Palette, Ollama, Agent, Trace, Developer Overlay, Stage 11 performance tuning and Stage 12 final polish.

- `src/scene/core/coreTopology.ts` defines a deterministic primary anchor, secondary regions and bounded fragments. The view layer renders the descriptors without random physics or a closed shell.
- `src/scene/core/coreField.ts` defines a deterministic ribbon-like field with directional drift, explicit void bands and immutable GPU attributes. `CoreFlowField` uses the existing WebGPU NodeMaterial seam and a standard WebGL2 fallback.
- `src/scene/core/coreTrajectories.ts` defines broken directional routes and signal activation. Hover, focus and agent activity alter active paths, stream counts, direction bias and local density; they are not color-only states.
- `ComputeCore` composes `CoreNucleus`, `CoreTopology`, `CoreFragments`, `CoreFlowField`, `CoreTrajectories` and `CoreSignals`. The old spherical V1 visual layers are no longer mounted, and ComputeCore remains Graph/Command/Agent independent.
- The browser gate found one real fallback defect: `PointsMaterial` interpreted the shared point size in world units and overexposed the field. `deriveCoreFlowStandardPointSize()` now applies a bounded world-unit policy only to WebGL2 fallback; its regression test fixes the 1.75 → 0.0315 mapping. WebGPU behavior is unchanged.

### Stage 3.5 verification evidence

- `npm exec vitest run src/scene/core`: 5 test files, 73 tests passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 21 test files, 136 tests passed.
- `NEXT_TELEMETRY_DISABLED=1 npm run build`: passed on Next 16.3.5.
- WebGPU at 1920×1080 with `boot=skip`: `WEBGPU READY`, `Three.js WebGPURenderer`, canvas 1920×1080, Graph hover/focus/Escape passed, reduced-motion interaction passed. Screenshots: `artifacts/stage35-core-v2-overview-webgpu.png`, `artifacts/stage35-core-v2-hover-webgpu.png`, `artifacts/stage35-core-v2-focused-webgpu.png`.
- WebGPU at 2560×1440: canvas 2560×1440, all five domain labels remained in frame and the V2 hierarchy remained legible. Screenshot: `artifacts/stage35-core-v2-overview-2560-webgpu.png`.
- WebGL2 fallback with the existing GPU-disabled verification path: `WEBGL2 READY`, `Three.js WebGLRenderer`, overview/hover/focus/Escape passed and the corrected asymmetric field remained coherent. Screenshots: `artifacts/stage35-core-v2-overview-webgl2.png`, `artifacts/stage35-core-v2-hover-webgl2.png`, `artifacts/stage35-core-v2-focused-webgl2.png`.
- No uncaught page errors or new V2 material warnings occurred. Known non-fatal messages remain: missing `/favicon.ico`, Windows adapter `powerPreference`, Three.Clock deprecation, WebGPU PCFSoftShadowMap remapping, WebGPU zero-vertex draw notice and software WebGL2 ReadPixels notices.
- The silhouette review passed: overview reads as an asymmetric anchor/region/path/field composition with deliberate voids and negative space, not a central ball, cloud, ring shell or random scatter. No FPS, GPU utilization, VRAM or thermal claim was made.

### Stage 3.5 ownership audit

- `ComputeCore.tsx` imports no Graph, Command or Agent module.
- Pure V2 descriptor generators contain no Three.js objects; material/view resources remain inside the scene layer.
- WebGPU/WebGL2 selection remains owned by the existing renderer adapters; the fallback correction does not recreate the renderer or alter backend selection.
- No Command Palette, parser, Ollama, Agent Gateway, SSE, Agent Trace, Developer Overlay or Stage 11/12 implementation was added.

### Stage 3.5 handoff

Stage 3.5 is complete. The next isolated slice remains Stage 6 — Command Palette; do not start it as part of this record.

## Stage 3.5.1 — Visual Composition Reconstruction

This corrective slice rebuilds the Core/Graph composition while keeping Stage 0–5.1 ownership boundaries intact. It does not start Stage 6 or introduce palette, parsing, Ollama, Agent Gateway, Trace, Developer Overlay or performance-measurement work.

- `src/scene/core/coreTopology.ts` now exposes deterministic primary, secondary, ambient and signal route classes, structural regions, depth bands and descriptor scales. `CoreTopologyView.tsx` renders primary links as instanced structural members and keeps the quieter route families in separate buffers.
- `src/scene/core/coreField.ts` builds bounded, anisotropic, zoned field samples with deterministic voids and explicit visible-draw counts. `coreFlowMaterial.ts` consumes the same state through WebGPU NodeMaterial and a simpler WebGL2 material path; reduced-motion behavior freezes travel.
- `src/scene/core/ComputeCore.tsx` composes the larger layered nucleus, topology, local field, trajectories and budgeted signals without importing Graph, Command or Agent ownership.
- `src/scene/graph/domainVisuals.ts`, `GraphNode.tsx`, `GraphEdges.tsx` and `src/graph/layout.ts` replace the uniform circular widgets/star edges with five deterministic silhouettes and bent, state-related routes. `SceneHost.tsx` mounts sparse distant atmosphere traces and registers `SphereGeometry` for the related pulse view.
- Renderer telemetry now separates configured field budget, visible rendered field samples and active signal samples; compatibility `particleCount` reports visible field samples rather than the configured budget.
- `src/scene/atmosphereDescriptor.ts` defines deterministic background traces. `globals.css` increases masthead readability and reduces renderer-status weight.

### Stage 3.5.1 verification and review status

- `npm.cmd test` — pass: 24 files, 149 tests.
- `npm.cmd run typecheck` — pass.
- ESLint over all changed source/test areas — pass. The full repository lint script was not used for this final check.
- `npm.cmd run build` — pass with Next.js 16.3.5; all routes generated.
- Codex in-app browser, `?boot=skip&telemetry=1`: `WEBGPU READY`, `Three.js WebGPURenderer`, ULTRA, 1280×720 viewport, DPR 2 and 2560×1440 canvas buffer. Adapter name was unavailable. No sustained performance or hardware metric is claimed.
- Live WebGPU review showed the overview, GRAPHICS focus/description, and Escape clearing focus; a fresh post-fix console sample contained no errors. Known non-fatal warnings: Three.Clock deprecation and WebGPU PCFSoftShadowMap remapping.
- Browser WebGL2 fallback and active `prefers-reduced-motion` were not exercised in this in-app session. Their material/state contracts are covered by the passing test suite, but that is not a browser-run substitute.
- Two live visual iterations were inspected, but the browser URL policy blocked converting the captured screenshot bytes into local downloadable files. No `artifacts/stage351-*.png` files were created; do not treat the older Stage 3.5 screenshots as Stage 3.5.1 evidence.
- Therefore this is implementation-ready for Visual Review / Sol Review, not an evidence-complete stage closeout. Stage 6 remains not started.

## Stage 3.5.2 — Visual Reconstruction

This slice rebuilds the presentation layer — hero Core, routing flowfield, domain sub-environments, material system and UI typography — without moving any Stage 0–5.1 ownership boundary. It does not start Stage 6 and adds no palette, parser, Ollama, Agent Gateway, Trace or Developer Overlay.

- `src/scene/materials/structureGeometry.ts` bakes a whole structure into two geometries — solid and membrane — with tier colour and per-face orientation luminance pre-multiplied into vertex colours. A structure's mass therefore costs two draw calls rather than one per box, and the luminance a rotated face should carry is computed after its own transform, which is what gives large forms mass without a light.
- `src/scene/materials/surfaceGeometry.ts` owns the baked luminance response and the bounded membrane opacity band. `deriveSurfaceLuminance` produces six distinct monotonic tiers across a box; `deriveMembraneOpacity` keeps a membrane between 0.16 and 0.46 so it always reads as a layer and never as a wall.
- `src/scene/materials/surfaceMaterial.ts` is the single material factory for every structural role on both backends: a WebGPU `MeshBasicNodeMaterial` path and a `MeshBasicMaterial` path that share one visual spec. Solids write depth and occlude; membranes blend and do not.
- `src/scene/core/coreStructure.ts`, `coreStructureGeometry.ts` and `CoreStructureView.tsx` replace the stacked transparent boxes with one diagonal structural spine, one large asymmetric processing volume, secondary processing assemblies, a central void, route ports with real ingress and a small number of structural slices near the camera.
- `src/scene/core/coreCirculation.ts` is the Core's internal circulation: velocity-stretched dashes rather than dots, with a compression zone at the route throat, ingress accumulation, a source-to-target burst and an arrival wake.
- `src/scene/routing/routeDash.ts`, `routeDashMaterial.ts` and `RouteDashes.tsx` carry that same signal language along the graph routes. WebGPU advects dash count, phase, life and stretch in the vertex shader; WebGL2 drives a bounded instanced dash set on the CPU with the same envelope maths, so the two backends share one language rather than one look and one fallback.
- `src/scene/graph/DomainEnvironment.tsx` gives each of the five domains a distinct local computational behaviour — trunk-and-buffer for AI, layered framebuffer membrane and interference scan plane for GRAPHICS, comparison branch and decision chamber for GAME ANALYSIS, stepped processing stack and vertical bus for SYSTEMS, open interference sheet with lattice and probe endpoint for RESEARCH — all from the shared geometry/material language above.
- Reduced motion is now a real stop rather than a canvas opacity change: the preference travels from the media query through `RendererHost` into `SceneHost`, and under it the scene advances no duration, circulates no signals and drifts no camera.

### Stage 3.5.2 defects found and fixed

- **The membrane tier rendered nothing at all, on both backends.** The tier faded by ordered dither — an alpha map plus an alpha test, so it could stay in the depth pass without transparency sorting. Three samples an alpha map in the green channel and the map was built as a single-channel red texture, so every membrane fragment in the scene was discarded against a constant zero. Proven by forcing the alpha test to 0: **4.60% of the frame (95,407 px) changed** when membranes were allowed to draw. Fixing the channel only exposed the rest of the problem — at roughly two hundred pixels per world unit a Bayer cell aliases into a visible checkerboard across the large plates and into diagonal moiré across the small ones — so the dither was replaced with a genuine bounded blend. No test in the 237-test suite could have caught this; only running the acceptance matrix did.
- **The backdrop diverged by backend.** `Atmosphere` branched on backend and its node path drew the depth backdrop at (2,3,3) against the scene's own background of (5,6,9). It no longer takes a backend at all: the standard path is the correct permanent choice for a static, non-responsive surface. The same frame now reads (26,33,33) at centre and (11–12,14–16,17) at the corners on WebGPU, matching WebGL2.

### Stage 3.5.2 verification evidence

- `npm.cmd test` — pass: 32 files, 237 tests.
- `npm.cmd run typecheck` — pass. `npm.cmd run lint` — pass.
- `NEXT_TELEMETRY_DISABLED=1 npm.cmd run build` — pass on Next.js 16.3.5.
- Zero-dependency CDP capture harness (`scripts/stage352-capture.mjs`) against `?boot=skip&telemetry=1`, at 1920×1080 and 2560×1440 × {overview, hover-GRAPHICS, focus-GRAPHICS, Escape}, plus a 480×270 downscale of each overview. 31 `artifacts/stage352-*.png` files.
- **Those 31 captures are local only.** `.gitignore` excludes `artifacts/`, and only the 7 historical `stage35-*` files were force-added past it. Nothing in this stage's evidence travels with the repository: a reviewer on another machine must re-run `scripts/stage352-capture.mjs` (no dependency install required) rather than expect the PNGs in the tree. Force-adding them is a deliberate commit-time decision, not something this record assumes.
- WebGPU: 10 files, 34 console messages — info 25, warning 9, **error 0, fatal 0**. No NaN, invalid buffer or WebGPU validation error.
- WebGL2 (via shadowing `navigator.gpu` before document start): 10 files, 28 console messages — info 24, warning 4, **error 0, fatal 0**.
- Reduced motion is measured, not asserted. Sampling the same scene twice ~3 s apart inside one session: normal mode **1.82% of pixels (37,772 px) changed**; reduced motion **0.00% (0 px) changed**, mean luminance identical to three decimals. Evidence: `artifacts/stage352-motionprobe-{normal,reduced}-{a,b}.png`.
- Quality profiles change structure, not just counts. SAFE vs ULTRA differ by 16.60% (overview) and 17.08% (hover); ULTRA reaches p99.9 215 / peak 255 against SAFE's 147 / 231. The SAFE overview still reads as the Hero, its spine, all five domain silhouettes and the main routes.
- All pre-existing work-tree changes were preserved: `vitest.config.ts`, `scripts/`, and the capture/test sources remain in the tree. The current canonical local launcher is `START_POLNAREFF.cmd`; no dependency, `package.json` entry or machine-local file was added.

### Stage 3.5.2 known gap, not fixed

The WebGPU node material path renders the machine's mid-tones darker than the standard path. Measured on the same frame at (1152,497): WebGPU 83 against WebGL2 143, a ratio of 0.58 that holds across sampled pixels. Histograms: WebGPU p50 4 / p90 28 / p99 102 against WebGL2 p50 26 / p90 69 / p99 155. Forcing the standard path on WebGPU reproduces the WebGL2 histogram to within 1–2 levels (p50 28/26, p90 70/69, p99 156/155, p99.9 219/208), which localises the divergence inside the node material path rather than in the renderer's output transform, fog or colour management. Three's `VertexColorNode` (a plain attribute read with a white fallback), the GLSL and node fog formulas (numerically equivalent) and the node alpha path were each checked and ruled out. This is documented rather than fixed; no performance or hardware claim is made from it.

### Stage 3.5.2 handoff

Stage 3.5.2 is implemented and captured. The next isolated slice remains Stage 6 — Command Palette; do not start it as part of this record.

## Stage 3.5.3 — Visual Convergence

This slice responds to the 3.5.2 **visual** review, which did not pass: the frame
still read as scattered rectangles, one dominant dark slab, segmented glowing
curves, five abstract icons and every label at once. It does not start Stage 6 and
adds no palette, parser, Ollama, Agent Gateway, Trace or Developer Overlay.

Full review brief: `docs/STAGE353_REVIEW_BRIEF.md`. It supersedes
`docs/STAGE352_REVIEW_BRIEF.md` for regeneration, and corrects two claims in it.

- `src/scene/routing/routeDash.ts` — density is **per world unit of route**.
  `deriveDashesPerRoute` counted packets per curve, which made coverage (count ×
  packet length) constant at 3.4 packet-lengths on every route regardless of its
  length: the Core's short loops saturated into bright hooks while the long trunks
  thinned into wire. `deriveRouteDashDensity`, `deriveCurveDashCounts` and
  `deriveRouteCurveLength` replace it; `ROUTE_PACKET_LENGTH` is a world-unit
  quantity divided by the curve's own length, capped so a packet is never more
  than a third of its route (`PACKET_LENGTH_CURVE_SHARE`); the count floor is 1
  rather than 3, because on a short reach a count floor is a *coverage* floor.
- `src/scene/routing/routeContract.ts` — graph-neutral routing contract
  (`CORE_ROUTE_GROUP`, `DOMAIN_ROUTE_GROUP_BASE`, `TRUNK_ROUTE_GROUP_BASE`,
  `MAX_ROUTE_GROUPS`), so `coreCirculation.ts` no longer imports `graphRoutes.ts`.
- `src/scene/core/coreStructure.ts` — the main hulls close on a face. Their
  sections used to collapse toward a tip over the whole length under a 0.34–0.40
  chamfer, so the body was two pointed lenses on a stick; the taper now lives in
  the last eighth, where a machined chamfer lives, and the chamfers are 0.22–0.26.
- `src/scene/graph/domainEnvironments.ts` — GRAPHICS' four framebuffer layers lost
  the `anchor` tier and were brought to near-equal size with real cant. The front
  plate had been both the largest and the brightest baked colour, so a focused
  GRAPHICS read as one blank white card with three edges behind it.
- `src/scene/materials/surfaceResponse.ts` — `SurfaceInput.presence`, the one
  input that can take a surface *below* its resting response. `gainAtRest` is a
  floor, so a receded surface handed `activity: 0` rendered exactly as a rested
  one; presence scales the resolved response, colour gain and membrane openness
  together, which is what "the other domains recede" requires.
- `scripts/stage352-capture.mjs` — two holes in the harness's own interaction
  evidence, both closed. Escape asserted focus had cleared but not hover; because
  the parked pointer never reached the canvas, the Escape frame was a hover frame
  with an idle camera. The park is now verified (hovered set must go empty, with
  fallbacks inside the canvas) and its verdict requires hover cleared. Reduced
  motion was judged ready by a coarse frame signature, which an asymptotically
  easing camera passes: two runs differed on 174 pixels. Under `--reduced-motion`
  readiness is now byte equality. The console collector also expands object
  arguments over their CDP handle, so the renderer telemetry snapshot is readable
  in full rather than truncated to a preview.

### Stage 3.5.3 measurements

- The real field: 22 curves, 18.76 world units, 244 packets, coverage 1.30 at
  ULTRA's advected density of 13/unit. The instanced fallback runs at 5/unit.
- WebGPU against WebGL2 on the same frame: point samples on structural surfaces
  differ by **+1 to +4 luminance levels**; histograms p50 27 against 24 (1920×1080)
  and 18 against 17 (2560×1440). The residual is uniform across a 4×4 grid and
  tracks WebGPU's denser route field, not the material. The 3.5.2 divergence
  (p50 4 against 26) was fixed in `e30e427` and the 3.5.2 brief was never updated.
- Reduced motion is byte-identical across two independent runs at the default
  settle: `b0b5cc37fcfb11ff9f4d43b47bdb4db5`.
- Escape and overview now show the same composition — identical camera and labels,
  differing only in packet phase — which is what proves Escape restored idle.

### Stage 3.5.3 verification evidence

- `npm.cmd test` — pass: 35 files, 293 tests.
- `npm.cmd run typecheck` — pass. `npm.cmd run lint` — pass.
- `NEXT_TELEMETRY_DISABLED=1 npm.cmd run build` — pass.
- Acceptance matrix: WebGPU and WebGL2 × ULTRA × {1920×1080, 2560×1440} ×
  {overview, hover-GRAPHICS, focus-GRAPHICS, Escape} × {plain, text-hidden,
  grayscale} + 480×270 thumbnails = 26 files per backend; SAFE on both backends;
  reduced motion on three runs. **error 0, fatal 0** on every batch.
- Captures are local only. `.gitignore` excludes `artifacts/`; a reviewer on
  another machine re-runs the harness rather than expecting PNGs in the tree.
- No dependency, `package.json` entry or machine-local file was added.

### Stage 3.5.3 remaining, real

- The three secondary processing pockets are stubs on canted hull surfaces, so at
  some angles the join is a soft shading boundary rather than a visible seat.
- RESEARCH is very dark at idle — the intended dormant-silhouette treatment, at
  the edge of readable on a dim display.
- The instanced fallback still reads as evenly spaced dashes at 5/unit. That is
  the deliberate low-density fallback, but it is what a WebGL2-only reviewer sees.
- No automated visual regression: the matrix is inspected, not compared to a
  baseline.

### Stage 3.5.3 handoff

Stage 3.5.3 is implemented and captured on both backends. The next isolated slice
remains Stage 6 — Command Palette; do not start it as part of this record.

## Stage 3.5.4 — Total Visual Rebuild

This slice was licensed to delete the visual implementation of the Core, the
domains, the routes, the field, the atmosphere, the graph views and the domain
layout, and it did. The entry checks of 3.5.3 passed and its visual layer is
mostly gone. Baseline for the diff is `5711cbf`.

Full review brief: `docs/STAGE354_REBUILD_REVIEW_BRIEF.md`. It supersedes
`docs/STAGE354_REVIEW_BRIEF.md` (the "Identity Re-Foundation" pass over
`e8384e2..a880637`), whose subject — an apertured monolith with a bezel rail — no
longer exists in the render tree.

### What replaced what

| Old | New | File |
|---|---|---|
| `CoreNucleus` / `CoreTopologyView` / `CoreStructureView` — a monolith with an aperture and a bezel rail | A rift: two massifs entering from opposite corners, a throat between them, a barrel of ribs, a baffle stack, membranes and bundled fibres | `src/scene/hero/riftStructure.ts` (815 lines), `RiftStructureView.tsx` |
| `CoreParticleShell` / `CoreEnergyField` — points and a shader field | One instanced data-matter field, 120,000 units, positioned and shaded entirely in the vertex shader | `src/scene/matter/*` |
| `GraphNode` / `GraphEdges` / `KnowledgeGraph` — boxes and connecting lines | Five regional *phenomena*, each a different field behaviour with its own geometry family | `src/scene/domains/*` |
| `RouteDashes` / `routeDashMaterial` — dashed lines between nodes | Gone from the render tree. The route is the matter field's semantic corridor, and it lights the structure it passes through | `src/scene/field/*`, `corridorTerm` in `energyMaterial.ts` |
| `Atmosphere` / four nested backdrop plates | A procedural deep field: folded, tapering far structures with their own gain and depth floor | `src/scene/backdrop/*` |
| `surfaceMaterial` + `surfaceResponse` — stock-material response curves | One authored TSL shading model for every solid surface in the scene | `src/scene/materials/energyMaterial.ts` |
| Five domains on a radius-5 ring around a centred body | Five domains at radii 8.4–17.7, on five different depths from z = +7 to z = −13 | `src/graph/layout.ts` |

### The four layers the brief asked for

1. **A giant data rift and a compute cavity.** `RIFT_AXIS_RAW = [1, 0.92, −0.86]`
   with `CAVITY_CENTRE = [1.9, 1.5, −0.9]` and half-extents `[6.4, 2.9, 2.6]`.
   The near massif is authored past the frame corner and *behind* the idle lens
   plane, so the machine is already large when it enters shot; its reach is 1.4×
   the idle frustum's half-extents, i.e. it cannot be seen whole.
2. **Information matter that condenses and disperses.** One instanced field whose
   units are in one of seven configurations at any moment — volumetric cloud,
   filament, compressed stream, ribbon, membrane, lattice, local pocket — all of
   them the *same* field at different points of its parameter space.
3. **High-density semantic stream bundles.** The corridor: a two-scale gaussian
   around the signal segment (`CORRIDOR_CORE_RADIUS = 1.6`,
   `CORRIDOR_SPILL_RADIUS = 6.2`) that both displaces the matter and lights the
   structure, at idle as well as under interaction (`IDLE_CORRIDOR = 0.4`).
4. **Five computational regions with different field behaviour.** `inference`
   (branch/merge), `sampling` (dense interfering sheets), `branching` (parallel
   state with rollback), `throughput` (saturated bus stacks), `probe` (sparse
   probes into depth). Distinguished by `organisation`, `pressure` and `rate`
   before any colour is chosen.

### Measurements

- Idle 1920×1080 ULTRA, sixty-second run: **fps 36–45, frame time 22–28 ms,
  49 draw calls per frame, 483,200 triangles, 22 geometries, 26 textures** —
  geometries and textures flat across the whole run, so nothing leaks.
- Field: **120,000 rendered samples** against a **120,000 configured budget**
  (ULTRA), of which **48,000** are carrying signal at idle. Draw calls for the
  whole scene are 49, of which the field is **one**.
- Luminance, idle 1920×1080 ULTRA: frame mean 0.114, centre mean 0.309, peak
  1.000, 47.6% of pixels in the bottom histogram bin, 0.2% in the top. A dark
  frame with a small blown-out core — which is what lets bloom at a threshold of
  0.72 fire at all.
- WebGPU against WebGL2, same frame and quality: spread 252.1 against 252.1 at
  idle, 251.6 against 251.6 at focus-GRAPHICS. Both backends run the same
  `WebGPURenderer` (WebGL2 via `forceWebGL`), so this is one shader graph.

### Verification evidence

- `npm.cmd test` — pass: 35 files, 312 tests.
- `npm.cmd run typecheck` — pass. `npm.cmd run lint` — pass (0 errors, 0 warnings).
- `npm.cmd run build` — pass with Next 16.3.5.
- Acceptance matrix, captured and inspected: WebGPU ULTRA 1920×1080 ×
  {idle, hover-GRAPHICS, focus-GRAPHICS, focus-AI, escape}; 2560×1440 idle;
  480×270 thumbnail; text-hidden; reduced-motion; WebGL2 idle and
  focus-GRAPHICS; MEDIUM and SAFE idle; and a sixty-second idle run for console
  and resource state. **error 0, fatal 0** on every batch. Every interaction
  assertion passed (hover lands, focus withdraws the other labels, escape
  restores idle with no hovered name).
- Captures are local only. `.gitignore` excludes `artifacts/`; a reviewer
  re-runs `scripts/stage352-capture.mjs` rather than expecting PNGs in the tree.
- No dependency, `package.json` entry or machine-local file was added.

### Defects found and fixed by this stage's own captures

- `rendererTelemetry` reported `info.render.calls`, which three.js documents as
  cumulative since page load and which `Info.reset()` does not clear. A
  sixty-second run reported **319,000** draw calls against a real cost of 49.
  Now reads `render.drawCalls`, and the test pins a fixture containing both.
- `domainPhenomena.labelAnchor` was authored as an absolute world position and
  rendered inside a group already translated to `centre`, so every label landed
  at roughly twice its region's distance from the origin. Three of the five
  projected off-frame and the whole hover/focus/escape choreography was
  unreachable; the harness reported it as `[interaction-not-landed]`.
- `deriveFieldState.IDLE_INFLOW` was dead — the idle corridor strength had moved
  to `fieldUniforms.IDLE_CORRIDOR` and the constant was a second, unread name for
  the same decision.
- `dataMatterMaterial` computed `swirled` and then used `dispersed`: the whole
  circulation about the spine was an orientation-only effect.
- `NODE_LAYOUT` placed three of five domains outside the idle frustum.
- `DomainField` and `PostPipeline` mutated values returned from hooks
  (materials from `useMemo`, `gl.info.autoReset` from `useThree`). The membrane
  blend state is now set where the material is made, the frame loop reaches its
  materials through a ref, and the counter's ownership moved to
  `canvasAdapters.configureRenderer`, which is where the renderer is created.

### Stage 3.5.4 remaining, real

- **Large flat faces are still the main visual risk.** A single sweep through
  four or five control points is a plane, and a plane takes one value across its
  whole area. The surface-density and rim terms now vary across a member, which
  is why the value hierarchy holds, but the near blade is still the flattest
  thing in the frame at focus.
- The veining on large surfaces reads as a fine branching network rather than as
  a topographic contour — the isolation line traces the zero set of a fractal
  field, and a fractal with its energy in one octave traces closed islands. The
  octave weighting fixes it; a different noise basis would fix it more.
- FPS sits at 36–45 rather than 60 at 1920×1080 ULTRA, measured in a **dev**
  build with HMR active. A production-build measurement belongs to Stage 11.
- RESEARCH is very dark at idle — the intended dormant-silhouette treatment, at
  the edge of readable on a dim display.
- ~~The old visual tree is still on disk~~ **Resolved.** The tree
  (`src/scene/core/`, `src/scene/Atmosphere.tsx` + descriptor,
  `src/scene/graph/*`, `src/scene/routing/*`,
  `src/scene/materials/{surfaceMaterial,surfaceResponse}`) was deleted under
  explicit user authorisation — 39 files, all with zero importers. Nothing it
  contained was on the render path.

### Stage 3.5.4 addendum — the flat face

The first cut of 3.5.4 shipped with large flat faces named as its main visual
risk. A follow-up pass attacked them, and the record of *how* is the useful part.

Five changes were tried in order and four of them did not fix the problem: ribbed
path sections, a per-facet bake, a two-scale surface-density field, and the
density applied to the corridor term. Each is kept on its own merit — the bake
went from 37 distinct shell values to 319 — and none of them moved the wedge.

The wedge was identified by switching the matter field off for a single capture
and finding it still there, now plainly a structure member with a rim on its
upper edge. It is the near massif's own sweep, whose silhouette is two nearly
straight parallel lines. **A lighting term cannot vary across a body whose
outline does not.** Fixing it was geometry: `segmentedShell` cuts each massif at
its own control points into separate members with joints between them, over a
continuous spine that keeps the body one body. The spine exists because the first
segmented cut had none and the SAFE capture showed the massif as floating shards
— the one thing the brief explicitly forbids.

Full method and constants: `docs/STAGE354_REBUILD_REVIEW_BRIEF.md` §12.

### Stage 3.5.4 addendum — the old tree is deleted

The superseded schemes are no longer on disk. 39 files removed with no importers:
`src/scene/core/` in full (11), `src/scene/Atmosphere.tsx` + `atmosphere.test.ts` +
`atmosphereDescriptor.ts`, `src/scene/graph/` in full (7), `surfaceMaterial` and
`surfaceResponse` + tests, and `src/scene/routing/` in full (14). The `graph/` and
`routing/` directories no longer exist.

`routeContract` / `routeFlow` / `routeTelemetry` were not on the deletion list but
could not survive it — they existed only to consume `graphRoutes`, `routeDash` and
`coreStructure`, and deleting those left them uncompilable with no importers.

The architecture boundaries the brief protects are untouched: `RendererRuntime`,
`SceneHost`, `CameraController`, and `ComputeCore`'s contract. Only the Core *view*
layer went. `energyMaterial` / `structureGeometry` / `surfaceGeometry` /
`machinePalette` are the surviving material system.

`test` fell from 35 files / 312 tests to 20 / 110 — the 15 deleted test files
account for exactly the difference. `typecheck`, `lint` and `build` are clean, and
an idle ULTRA capture after the deletion matches the pre-deletion frame
(`spread 253.0` vs `252.8`, `error 0, fatal 0`), so nothing deleted was on the
render path. Details: `docs/STAGE354_REBUILD_REVIEW_BRIEF.md` §13.

### Stage 3.5.4 handoff

Stage 3.5.4 is implemented and captured on both backends. The next isolated
slice remains Stage 6 — Command Palette; do not start it as part of this record.
