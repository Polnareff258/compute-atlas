# POLNAREFF SYSTEM Project Status

**As of:** 2026-09-19
**Repository:** `Polnareff258/compute-atlas`
**Current phase:** Phase 1
**Current stage:** Stage 3.5.1 implementation is ready for review; local screenshot evidence and browser fallback checks remain incomplete. Stage 6 is not started.

## Confirmed architecture

- Next.js App Router full-stack application.
- Three.js WebGPU-first renderer with WebGL2 fallback.
- Dynamic hybrid visual density: sparse idle state, denser response states.
- Typed Command Bus plus Zustand for serializable UI/system state.
- Server-only Ollama access through HTTP + SSE Agent Gateway.
- Agent whitelist tools and schema validation; no arbitrary code, shell, filesystem or DOM access.
- Boot state is serializable and isolated from Three.js objects; renderer initialization remains behind the existing runtime boundary.
- Compute Core owns visual resources and interaction math; it has no Graph, Command or Agent imports.

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
| Stage 3.5.1 — Visual Composition Reconstruction | Implementation ready for review; evidence incomplete | Deterministic machine topology, local field, five domain silhouettes and truthful draw-count telemetry are implemented. WebGPU overview/focus/Escape were inspected live; required local screenshots and browser WebGL2/reduced-motion runs were not captured. |
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
