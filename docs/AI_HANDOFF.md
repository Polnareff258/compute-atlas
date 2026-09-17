# Compute Atlas AI Handoff

## Repository

Repository: Polnareff258/compute-atlas
Default branch: master
Current HEAD: 68b3372 (verified implementation head before documentation commits)

## Product

Compute Atlas is the repository for POLNAREFF SYSTEM, an interactive personal computing environment.
It is a desktop-first local graphics system rather than a portfolio or dashboard.
The current product surface is a GPU-first Compute Core surrounded by a spatial Knowledge Graph.
Future stages add deterministic commands, a local Agent gateway and runnable experiments.

## Current Stage

Stage 5.1 complete: Command / Quality Seam Correction + AI Handoff
Next: Stage 6 — Command Palette

Stage 5.1 is a corrective pass, not a new main product phase.
Do not start Stage 6 work in a Stage 5.1 review.

## Architecture

Browser
├─ RendererHost
│  └─ RendererRuntime
│     ├─ WebGPU adapter
│     └─ WebGL2 adapter
├─ R3F SceneHost
│  ├─ ComputeCore
│  └─ KnowledgeGraph
├─ CommandBus
│  └─ semantic adapters
└─ future Agent Gateway

The browser owns presentation and local interaction.
RendererRuntime owns backend lifecycle and observable renderer quality.
SceneHost composes the R3F scene and maps semantic interaction to camera/Core behavior.

## Hard Boundaries

- ComputeCore does not import Graph, Command or Agent.
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

## Current State Ownership

Graph hover owner: SceneHost-local GraphInteractionState reducer, written by canvas pointer boundary actions.
Graph focus owner: the same reducer; pointer click and GraphController both emit FOCUS_NODE/CLEAR_FOCUS semantics.
Quality owner: RendererRuntime state, observable by RendererHost; SceneHost receives quality as a prop.
Renderer backend owner: RendererRuntime plus the selected WebGPU/WebGL2 adapter.
Renderer DPR owner: the active renderer handle plus the R3F RootStore setDpr seam.
Camera focus owner: SceneHost's existing CameraController; Graph only supplies semantic interaction.
Compute Core response owner: SceneHost maps graph state to ComputeCoreVisualState; ComputeCore remains graph-blind.

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

Do not add palette, parser, Ollama, Agent, SSE, trace or overlay work while reviewing Stage 5.1.

## Known Issues / Debt

- KnowledgeGraph pointer projection is O(N) per pointer move; this is acceptable for five domain nodes.
- The browser logs known library/environment notices: Three.Clock deprecation, WebGPU PCFSoftShadowMap remapping, and headless powerPreference/zero-vertex notices.
- No sustained FPS, GPU utilization, VRAM or thermal claim has been made.
- The development-only quality dispatch event exists solely for browser verification; it is not a production command API or UI.

## Verification

Latest focused Stage 5.1 tests: 29 tests passed across graph, command, runtime, quality and status seams.
Latest full suite before documentation: 17 test files, 64 tests passed; the status-copy regression adds one test.
npm run lint: pass.
npm run typecheck: pass.
NEXT_TELEMETRY_DISABLED=1 npm run build: pass on Next 16.3.5.
WebGPU browser: boot=skip, Three.js WebGPURenderer, WEBGPU READY, graph hover/focus/Escape pass, no uncaught exception.
WebGPU measured canvas at the headless viewport: CSS 758x426, ULTRA drawing 758x426, SAFE drawing 469x264, then ULTRA restored.
WebGPU effective DPR changed 1 → 0.6187335092348285 → 1 through SET_QUALITY dispatch.
WebGL2 browser: WebGL2 adapter selected with WEBGL2 READY, graph hover/focus pass, quality safe applied, no uncaught exception.
No app/R3F error events were observed. Known library warnings remain listed above.

## Sol Review Guidance

Before reviewing:
1. Read this file.
2. Read PROJECT_STATUS only if more history is needed.
3. Read only the files listed in Review File Map.
4. Do not scan the whole repository unless evidence requires it.
5. Confirm the current HEAD and working tree before making changes.
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

Status:
src/ui/statusCopy.ts
src/ui/statusCopy.test.ts

Agent:
not implemented yet

## Next Sol Review Gate

After Stage 6 is complete, before Stage 7/8 server and Agent work.

Review focus:
- browser/server ownership
- Command Bus ownership
- Graph/Scene ownership
- quality propagation and single observable state
- future Agent permission boundary
- SSE/Gateway design readiness
- deterministic command behavior before any LLM path

The next implementation task must explicitly stop at Stage 6 completion.
