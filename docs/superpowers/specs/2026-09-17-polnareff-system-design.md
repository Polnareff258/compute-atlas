# POLNAREFF SYSTEM Phase 1 Design

**Date:** 2026-09-17  
**Status:** Approved for implementation  
**Current execution slice:** Stage 0 — repository/architecture setup; Stage 1 — renderer bootstrap

## 1. Product intent

POLNAREFF SYSTEM is an Interactive Personal Computing Environment. The website is itself the primary artifact: a desktop-first, GPU-first computational space that can later host projects, experiments, agents, and runnable demos.

Phase 1 must establish a coherent visual and interaction foundation rather than a conventional portfolio shell. A visitor should enter through a real bootstrap sequence, arrive in a persistent Compute Core space, explore a data-driven 3D knowledge graph, and use both deterministic commands and a local Ollama agent to affect the same command pipeline.

## 2. Confirmed decisions

| Decision | Choice | Consequence |
|---|---|---|
| Application shape | Next.js App Router full-stack | Browser-facing UI and server-only local integrations live in one project. |
| Renderer strategy | Three.js WebGPU first, WebGL2 fallback | ULTRA can use the preferred backend while unsupported environments remain usable. |
| Idle visual density | Dynamic hybrid | Idle mode is sparse and precise; boot, hover, expansion and agent actions can increase density. |
| State/control | Typed Command Bus + Zustand | All input sources produce commands; observable state is centralized and testable. |
| Agent transport | HTTP + SSE | Public trace events can stream, requests can be aborted, and the gateway remains proxy-friendly. |
| Package/runtime | npm-compatible Node project, pnpm available | Lockfile choice will be fixed during bootstrap after dependency resolution. |

## 3. Roles and boundaries

| Role | Responsibilities | Explicitly not responsible for |
|---|---|---|
| Desktop visitor | Explore the compute space, focus graph nodes, run commands, optionally use the local agent. | Managing server configuration or issuing arbitrary system operations. |
| Maintainer | Add graph content, visual modules, commands, tools, quality profiles and tests. | Exposing Ollama or bypassing command/tool validation. |
| Renderer runtime | Detect graphics capability, choose WebGPU/WebGL2, render the current scene, expose real counters. | Owning navigation meaning, Agent policy or DOM manipulation. |
| Graph controller | Map graph state and commands to camera/topology transitions. | Calling Ollama or knowing how an LLM produced a command. |
| Command system | Validate and dispatch typed commands from mouse, keyboard, palette and Agent. | Rendering, arbitrary code execution, or direct DOM access. |
| Agent gateway | Resolve deterministic commands first; proxy constrained natural-language requests to local Ollama; emit public events. | Accepting arbitrary tools, shell/filesystem access, hidden chain-of-thought, or public Ollama access. |
| Maintainer/agent implementer | Read the status, spec and plan; implement one slice and report evidence. | Assuming unverified hardware metrics or declaring completion without checks. |

## 4. Scope

### Phase 1 must include

1. Renderer capability detection with real WebGPU/WebGL2 fallback state.
2. Quality profiles: ULTRA, HIGH, MEDIUM, SAFE, with ULTRA as the default desktop target.
3. Visual boot sequence with real capability/health facts where available.
4. Compute Core scene with layered procedural structure, energy field, particles and orbital relationships.
5. Data-driven knowledge graph with CORE, AI, GRAPHICS, GAME ANALYSIS, SYSTEMS and RESEARCH.
6. Typed command bus shared by pointer, keyboard, palette and Agent.
7. Ctrl+K command palette with deterministic commands and history.
8. Server-only Ollama gateway with whitelist tools, schema validation, timeout, abort, response limits and SSE public events.
9. Agent Trace showing user input, intent, model, public tool events, result, status and latency; never hidden reasoning.
10. Developer overlay with real FPS/frame time, backend, quality profile, draw calls/triangles when available, particle count, health and Agent timing.
11. Unit tests for command parsing, command dispatch, graph state, tool validation and Ollama response validation.

### Later

PlayerLab, DLSS Lab, project database, accounts, multiplayer, cloud database, complex RAG/memory, complete mobile layout and Cloudflare deployment automation.

### Explicitly out of scope

Fake GPU utilization, VRAM, temperature or power numbers; arbitrary Agent JavaScript; direct browser-to-Ollama traffic; arbitrary shell/filesystem/DOM tools; a traditional hero/skills/project-card/contact portfolio layout.

## 5. User flows and acceptance criteria

### 5.1 Bootstrap flow

1. The app starts in a dark environment, not a spinner.
2. The boot sequence queries graphics capability, backend health, project manifest and Ollama health through real interfaces.
3. Ready/degraded/offline states are rendered as truthful states.
4. Visual layers appear as the corresponding stage becomes ready: core geometry, particle shell, graph shell and system transition.
5. A backend or Ollama failure does not blank the app; the shell remains navigable.

### 5.2 Compute-space flow

1. The visitor sees a central Compute Core and spatial graph nodes.
2. Pointer movement produces restrained parallax and camera inertia.
3. Hover emphasizes the target path and changes particle flow without making unrelated nodes disappear.
4. Selecting a node transitions the camera and expands the data-driven graph.

### 5.3 Command/Agent flow

1. Ctrl+K opens POLNAREFF COMMAND.
2. `projects`, `graph`, `graph ai`, `graph graphics`, `graph systems`, `home`, `status`, `agent`, `dev:on`, `dev:off`, `quality ultra`, `quality high`, `quality medium`, `help` and `surprise me` resolve without an LLM request.
3. Natural language that cannot be safely classified is sent to the server gateway, never directly to Ollama.
4. A tool call is schema-validated, transformed into a typed command and dispatched through the same bus as UI input.
5. Agent Trace shows only public events and measured timing.

### 5.4 Baseline quality

- TypeScript strict mode and lint/typecheck pass.
- Core command and validation behavior has unit coverage.
- The project starts locally with a documented command.
- Browser verification checks console errors, backend selection and initial visual shell.
- Performance instrumentation uses measurements from the running renderer; it never fabricates unavailable hardware telemetry.

## 6. Architecture

```text
Browser
  ├─ App Shell / UI
  ├─ R3F Scene Host
  │    └─ Renderer Runtime (WebGPU → WebGL2 fallback)
  ├─ Input Adapters (pointer / keyboard / palette)
  │    └─ Typed Command Bus
  │         ├─ Zustand state
  │         ├─ Graph Controller
  │         ├─ Quality Controller
  │         └─ Agent Trace / Dev Overlay state
  └─ /api/agent SSE client
       ↓
Next.js server route: Agent Gateway
  ├─ deterministic command matcher
  ├─ request limits / timeout / abort
  ├─ tool schema validation and whitelist
  └─ Ollama localhost adapter
```

The renderer is a consumer of state and commands. It is not the source of product meaning. The Agent is a producer of validated commands. It is not a UI controller. This keeps a future renderer replacement, deterministic replay and Agent hardening possible without rewriting scene code.

## 7. Module contracts

### 7.1 Renderer runtime

- **Purpose:** Detect actual browser graphics capabilities, create the preferred renderer, provide backend state and frame instrumentation.
- **Consumes:** `QualityProfile`, canvas mount target, renderer options.
- **Produces:** `RendererBackend = 'webgpu' | 'webgl2' | 'unavailable'`, readiness status, renderer metadata, per-frame metrics.
- **Errors:** capability unavailable, adapter/device initialization failure, context creation failure. These become `degraded`/`fallback` state and never throw through the app shell.
- **Does not:** decide graph navigation, call the Agent, or manufacture hardware telemetry.

### 7.2 Scene host and visual controllers

- **Purpose:** Render Boot Scene, Compute Core and Graph transitions from state.
- **Consumes:** graph state, boot phase, quality profile, pointer intent, graph commands.
- **Produces:** scene visuals and measured geometry/particle counters.
- **Errors:** local visual module failure should be isolated to a fallback scene layer.
- **Does not:** parse natural language or call server APIs.

### 7.3 Command Bus

- **Purpose:** Normalize all input sources into typed, serializable commands.
- **Command shape:**

```ts
type Command =
  | { type: 'NAVIGATE_HOME'; source: CommandSource }
  | { type: 'FOCUS_NODE'; source: CommandSource; nodeId: GraphNodeId }
  | { type: 'OPEN_SECTION'; source: CommandSource; sectionId: string }
  | { type: 'SYSTEM_STATUS'; source: CommandSource }
  | { type: 'SET_QUALITY'; source: CommandSource; profile: QualityProfile }
  | { type: 'SET_DEV_OVERLAY'; source: CommandSource; visible: boolean }
  | { type: 'SURPRISE_ME'; source: CommandSource };
```

- **Sources:** `pointer`, `keyboard`, `palette`, `agent`, `system`.
- **Errors:** invalid command is rejected with a typed result; unknown commands never reach visual controllers.
- **Does not:** execute arbitrary callbacks supplied by an Agent.

### 7.4 Graph schema/controller

- **Purpose:** Store data-driven graph topology and convert focus/expand commands into graph state and camera intents.
- **Schema:** stable node IDs, labels, parent IDs, positions/anchors, child IDs, semantic group, visual weight and optional project references.
- **Produces:** selected node, visible node set, emphasized edges, camera target/transition intent.
- **Does not:** hard-code navigation in scene JSX or know which input source caused a command.

### 7.5 Agent Gateway

- **Purpose:** Accept a bounded natural-language request, resolve deterministic commands before LLM work, and stream validated public events.
- **Input:** `{ message: string, requestId: string, clientTimestamp?: number }` with maximum length.
- **Output:** SSE events: `request_started`, `intent`, `tool_call`, `tool_result`, `request_completed`, `request_failed`.
- **Allowed tools:** `focus_node`, `open_section`, `system_status`, `show_project`, `return_home`, `surprise_me`.
- **Security:** server-only Ollama URL, whitelist, Zod validation, timeout, abort propagation, maximum response length, rate-limit seam and no arbitrary code.
- **Does not:** mutate Zustand, call Three.js, emit hidden model reasoning or expose raw Ollama errors/credentials.

### 7.6 Telemetry/developer overlay

- **Purpose:** Present real runtime measurements and subsystem status in a restrained engineering overlay.
- **Consumes:** renderer counters, backend state, health state and Agent events.
- **Produces:** readable labels for FPS, frame time, draw calls, triangles, particle count, renderer, quality, backend and Agent timing.
- **Does not:** infer unavailable utilization/temperature/VRAM values.

## 8. Error and degradation policy

| Failure | Visible state | Behavior |
|---|---|---|
| WebGPU unavailable | `WEBGL2 FALLBACK` | Start the same scene with WebGL2-compatible effects. |
| WebGPU device init fails | `WEBGL2 FALLBACK` | Record the failure in diagnostics; continue. |
| WebGL2 unavailable | `GRAPHICS DEGRADED` | Render UI/boot shell and a non-blank fallback message. |
| Ollama offline | `LOCAL AGENT OFFLINE` | Deterministic commands continue; natural language returns a bounded offline result. |
| Gateway timeout/abort | `AGENT TIMEOUT` / `CANCELLED` | Close SSE cleanly, keep scene state intact. |
| Invalid model tool call | `TOOL REJECTED` | Do not dispatch; record safe validation failure in Trace. |
| Visual module exception | `SCENE LAYER DEGRADED` | Keep app shell and independent layers alive. |

## 9. Quality profiles

```ts
type QualityProfile = 'ultra' | 'high' | 'medium' | 'safe';
```

Profiles are data, not scattered conditionals. Each profile controls particle budget, DPR ceiling, post-processing allowance, shadow/texture policy and graph density. ULTRA targets 1920×1080 and 2560×1440 desktop GPUs. SAFE is a functional fallback, not the visual design baseline.

## 10. Testing and verification

- Unit: deterministic command matcher, command bus/reducer, graph schema/state transitions, Agent tool schemas, Ollama response parsing.
- Integration: Next.js gateway with mocked Ollama adapter; SSE event order; timeout/abort; offline behavior.
- Browser: boot path with mocked/unavailable health endpoints, keyboard palette, graph focus, console error scan and screenshot review.
- Runtime: renderer backend check, frame-time sampling, draw/triangle/particle counters, resize and context failure recovery where supported.
- Each stage closes only after the relevant tests and a running browser inspection pass.

## 11. Stage sequence

1. Stage 0 — repository, strict TypeScript, Next.js shell, module folders, docs and test harness.
2. Stage 1 — renderer capability detection, quality profiles, R3F host, background atmosphere and initial renderer diagnostics.
3. Stage 2 — boot scene and truthful bootstrap state machine.
4. Stage 3 — Compute Core visual system.
5. Stage 4 — data-driven Graph and spatial interaction.
6. Stage 5 — Command Bus and adapters.
7. Stage 6 — Command Palette.
8. Stage 7 — server health and Ollama availability.
9. Stage 8 — structured tool calling and deterministic-first gateway.
10. Stage 9 — Agent Trace.
11. Stage 10 — Developer Overlay.
12. Stage 11 — performance pass.
13. Stage 12 — visual polish and browser verification.

## 12. Current handoff

The project is an empty directory with Node 24, npm 11, pnpm 11 and Git available. No source files or existing conventions exist. The first implementation slice must establish a runnable app and a renderer boundary before adding scene complexity. Do not treat the absence of a full Compute Core in Stage 1 as a failure; Stage 1's acceptance is a real renderer bootstrap shell with truthful backend state and an extensible scene host.
