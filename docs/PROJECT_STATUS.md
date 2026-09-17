# POLNAREFF SYSTEM Project Status

**As of:** 2026-09-17
**Repository:** initialized from an empty directory
**Current phase:** Phase 1
**Current stage:** Stage 5 complete; Stage 6 Command Palette pending

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

Begin Stage 6 from the future plan map: build the deterministic Command Palette UI over the existing Command Bus. Keep natural-language parsing and Agent Gateway work out of that slice.

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
- `src/commands/adapters/rendererCommands.ts` maps `SET_QUALITY` to the existing renderer quality seam. SceneHost applies the quality override to Core/Graph, while RendererHost forwards the same semantic setter to the runtime boundary.
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