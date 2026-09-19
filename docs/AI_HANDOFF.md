# Compute Atlas AI Handoff

## Repository

Repository: Polnareff258/compute-atlas
Default branch: master
Current branch: `master`
Stage 3.5.1 implementation commit: latest local commit at handoff; see `git log -1` for the SHA. Push target: `origin/master` via the configured v2rayN proxy.

## Product

Compute Atlas is the repository for POLNAREFF SYSTEM, an interactive personal computing environment.
It is a desktop-first local graphics system rather than a portfolio or dashboard.
The current product surface is a GPU-first Compute Core surrounded by a spatial Knowledge Graph.
Future stages add deterministic commands, a local Agent gateway and runnable experiments.

## Current Stage

Stage 3.5.1 implementation ready for review; visual evidence closeout is incomplete.
Next: resolve the screenshot/browser-evidence gap, then Visual Review / Sol Review.
Stage 6 is not started and must remain out of scope until separately requested.

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
Stage 3.5.1 — Deterministic primary/secondary route hierarchy, compact zoned GPU field, layered processing nucleus, five distinct domain silhouettes, bent graph routes, sparse depth atmosphere and explicit configured/rendered/signal telemetry counts. Implementation is in the current worktree; local screenshots and browser WebGL2/reduced-motion verification remain outstanding.

## Current State Ownership

Graph hover owner: SceneHost-local GraphInteractionState reducer, written by canvas pointer boundary actions.
Graph focus owner: the same reducer; pointer click and GraphController both emit FOCUS_NODE/CLEAR_FOCUS semantics.
Quality owner: RendererRuntime state, observable by RendererHost; SceneHost receives quality as a prop.
Renderer backend owner: RendererRuntime plus the selected WebGPU/WebGL2 adapter.
Renderer DPR owner: the active renderer handle plus the R3F RootStore setDpr seam.
Camera focus owner: SceneHost's existing CameraController; Graph only supplies semantic interaction.
Compute Core response owner: SceneHost maps graph state to ComputeCoreVisualState; ComputeCore remains graph-blind.
Compute Core V2 visual owner: ComputeCore composes deterministic topology, field, fragment, trajectory and signal views; coreFlowMaterial.ts owns the WebGPU/WebGL2 material seam.
Stage 3.5.1 topology owner: `coreTopology.ts` supplies route/region/depth descriptors; `CoreTopologyView.tsx` owns instanced primary members and separate secondary/ambient/signal buffers.
Stage 3.5.1 field owner: `coreField.ts` supplies stable zoned attributes and visible sample counts; `coreFlowMaterial.ts` consumes bounded scalar state; only signal/route views update small per-frame buffers.
Stage 3.5.1 domain-view owner: `domainVisuals.ts` supplies deterministic silhouettes; `KnowledgeGraph` retains hover/focus reducer ownership; `GraphEdges.tsx` draws view-only bent routes and related pulses.
Stage 3.5.1 telemetry owner: `coreTelemetry.ts` distinguishes configured field budget, visible field samples and active signal samples; `rendererTelemetry.ts` preserves `particleCount` as visible field samples.

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

Do not add palette, parser, Ollama, Agent, SSE, trace, overlay, Stage 11 or Stage 12 work while reviewing Stage 3.5.

## Known Issues / Debt

- KnowledgeGraph pointer projection is O(N) per pointer move; this is acceptable for five domain nodes.
- The browser logs known library/environment notices: missing `/favicon.ico`, Three.Clock deprecation, WebGPU PCFSoftShadowMap remapping, headless powerPreference/zero-vertex notices and software WebGL2 ReadPixels notices.
- Stage 3.5.1 review gaps: only live WebGPU overview/focus/Escape were inspected in the Codex in-app browser (1280×720, DPR 2, 2560×1440 drawing buffer; adapter name unavailable). Browser WebGL2 fallback and active reduced-motion mode were not exercised. Two visual iterations were inspected in the UI, but browser URL policy blocked local screenshot export; no `artifacts/stage351-*.png` files exist. Do not cite Stage 3.5 screenshots as Stage 3.5.1 evidence.
- No sustained FPS, GPU utilization, VRAM or thermal claim has been made.
- The development-only quality dispatch event exists solely for browser verification; it is not a production command API or UI.

## Verification

Latest committed Stage 3.5 suite: 21 files, 136 tests passed.
Stage 3.5.1 validation: `npm.cmd test` passed, 24 files / 149 tests; `npm.cmd run typecheck` passed; ESLint over all changed source/test areas passed; `npm.cmd run build` passed on Next.js 16.3.5.
Stage 3.5.1 browser: WebGPU `boot=skip`, `Three.js WebGPURenderer`, `WEBGPU READY`, ULTRA; 1280×720 viewport, DPR 2, 2560×1440 drawing buffer, adapter name unavailable. GRAPHICS focus exposed its description; Escape cleared the focused state. Fresh post-fix console sample had no errors; known warnings: Three.Clock deprecation and WebGPU PCFSoftShadowMap remapping.
Stage 3.5.1 browser gaps: no actual WebGL2 or reduced-motion browser run; no local screenshot artifacts. Unit tests cover WebGL2 material selection and reduced-motion mapping but are not substitutes for those browser checks.
Previous Stage 3.5 screenshot evidence remains: `artifacts/stage35-core-v2-overview-webgpu.png`, `artifacts/stage35-core-v2-hover-webgpu.png`, `artifacts/stage35-core-v2-focused-webgpu.png`, `artifacts/stage35-core-v2-overview-2560-webgpu.png`, plus the corresponding WebGL2 files. These are historical V2 evidence only.

## Current Visual Review / Sol Review Guidance

Before reviewing Stage 3.5.1:
1. Read this file and the Stage 3.5.1 section in `docs/PROJECT_STATUS.md`.
2. Confirm the current HEAD and worktree against `origin/master`; preserve the documented evidence gaps.
3. Review only the relevant files listed below; do not scan the whole repository without evidence.
4. Treat the live WebGPU focus/Escape check as verified, but treat screenshot artifacts, browser WebGL2 fallback and reduced-motion browser behavior as open evidence gaps.
5. Keep Stage 6 and later work out of this review.

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

Compute Core V2:
src/scene/core/ComputeCore.tsx
src/scene/core/coreTopology.ts
src/scene/core/CoreTopologyView.tsx
src/scene/core/coreField.ts
src/scene/core/coreFlowMaterial.ts
src/scene/core/coreTrajectories.ts
src/scene/core/coreTelemetry.ts
src/scene/core/CoreNucleus.tsx
src/scene/core/CoreFlowField.tsx
src/scene/core/CoreTrajectoryPaths.tsx
src/scene/core/CoreSignals.tsx

Stage 3.5.1 Graph / atmosphere:
src/scene/graph/domainVisuals.ts
src/scene/graph/GraphNode.tsx
src/scene/graph/GraphEdges.tsx
src/scene/graph/KnowledgeGraph.tsx
src/graph/layout.ts
src/scene/atmosphereDescriptor.ts
src/scene/Atmosphere.tsx

Status:
src/ui/statusCopy.ts
src/ui/statusCopy.test.ts

Agent:
not implemented yet

## Next Gate

Resolve or explicitly accept the Stage 3.5.1 visual-evidence gaps, then perform Visual Review / Sol Review. Do not start Stage 6 as part of this task.
