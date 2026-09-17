# POLNAREFF SYSTEM Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a runnable Next.js foundation and a verified WebGPU-first/WebGL2-fallback renderer bootstrap for POLNAREFF SYSTEM.

**Architecture:** Next.js App Router hosts the UI and server-only integration boundary. A typed renderer runtime detects and initializes WebGPU first, falls back to WebGL2, and exposes only stable capability/telemetry data to the scene host. The first slice deliberately stops before Compute Core, Agent and Graph implementation, but creates their module boundaries and test seams.

**Tech Stack:** Next.js App Router, React, TypeScript strict mode, Three.js, React Three Fiber, Zustand, Zod, Vitest, Playwright, ESLint.

**Spec:** `docs/superpowers/specs/2026-09-17-polnareff-system-design.md`

## Global Constraints

- Desktop-first, GPU-first; ULTRA is the primary visual target.
- WebGPU is preferred and WebGL2 is the fallback; no renderer-specific logic leaks into graph/Agent modules.
- The visual language is dark, precise, low-saturation and spatial; do not build a conventional portfolio/dashboard.
- TypeScript strict mode; do not introduce `any` for convenience.
- Do not fake GPU utilization, VRAM, power, temperature or other unavailable hardware telemetry.
- Ollama is never called directly from the browser and is not part of the current Stage 0/1 implementation.
- Commands, Graph, Agent, Renderer and UI stay in separate module boundaries.
- Every completed task gets targeted verification before the next task.

---

### Task 1: Initialize the repository and testable project shell

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `next-env.d.ts`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `src/config/env.ts`
- Create: `src/config/quality.ts`
- Create: `src/commands/types.ts`
- Create: `src/renderer/types.ts`
- Create: `src/graph/types.ts`
- Create: `src/agent/types.ts`
- Create: `tests/smoke/quality.test.ts`
- Create: `docs/PROJECT_STATUS.md`

**Interfaces:**
- Produces `QualityProfile`, `RendererBackend`, `CommandSource`, `GraphNodeId` and `AgentEvent` types that later tasks consume.
- Produces a root page that can render the Stage 1 shell without importing browser-only APIs on the server.

- [x] **Step 1: Create the minimal package manifest and scripts**

Use scripts with explicit verification targets:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Install only the dependencies required by the Stage 1 boundary: Next, React, React DOM, Three, `@react-three/fiber`, `@react-three/drei`, Zustand and Zod; install Vitest and its TypeScript/jsdom support as development dependencies. Add Playwright only when browser verification is implemented in a later Stage 2 task.

- [x] **Step 2: Add strict TypeScript and lint configuration**

Enable `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, and `noEmit`. Configure the Next ESLint flat config to cover `src` and `tests`, excluding `.next`, `node_modules` and generated files.

- [x] **Step 3: Define stable foundational types**

Define:

```ts
export type QualityProfile = 'ultra' | 'high' | 'medium' | 'safe';
export type RendererBackend = 'webgpu' | 'webgl2' | 'unavailable';
export type CommandSource = 'pointer' | 'keyboard' | 'palette' | 'agent' | 'system';
export type GraphNodeId = 'core' | 'ai' | 'graphics' | 'game-analysis' | 'systems' | 'research';
```

Keep these types framework-neutral so tests and server modules do not depend on R3F.

- [x] **Step 4: Create the first quality profile table**

Export immutable profiles with explicit fields: `particleBudget`, `maxDpr`, `allowBloom`, `graphDensity`, `pixelRatioScale`. Use ULTRA values suitable for desktop and progressively reduce budgets for HIGH/MEDIUM/SAFE. Keep values in one file and expose `getQualityProfile(profile)`.

- [x] **Step 5: Add a smoke test for the configuration contract**

Test that all four profiles exist, ULTRA has the highest particle budget, each max DPR is positive, and `getQualityProfile('ultra')` returns the same semantic values as the exported table.

- [x] **Step 6: Add a minimal app shell and status document**

Render a dark root shell with the product name and a placeholder mount point for the renderer. Document that Stage 0 is complete only after install, lint, typecheck, test and production build succeed.

- [x] **Step 7: Verify Task 1**

Run:

```text
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all commands exit successfully and no browser-only API is evaluated during the build.

- [x] **Step 8: Commit Task 1**

```text
git add package.json package-lock.json tsconfig.json next.config.ts next-env.d.ts eslint.config.mjs vitest.config.ts .gitignore src tests docs/PROJECT_STATUS.md
git commit -m "chore: bootstrap polnareff system foundation"
```

### Task 2: Implement truthful renderer capability detection

**Files:**
- Create: `src/renderer/capability.ts`
- Create: `src/renderer/capability.test.ts`
- Modify: `src/renderer/types.ts`

**Interfaces:**
- Consumes browser capability probes through injected functions so tests do not require a GPU.
- Produces `RendererCapabilityReport` with `webgpu`, `webgl2`, `preferredBackend`, `adapterName?`, `reason?`.

- [x] **Step 1: Write failing capability tests**

Cover: WebGPU and WebGL2 available chooses WebGPU; WebGPU absent with WebGL2 available chooses WebGL2; WebGPU adapter request failure falls back to WebGL2; both unavailable returns `unavailable`; adapter names are optional and never invented.

- [x] **Step 2: Implement injected probes**

Use a `CapabilityProbe` interface with `requestWebGpuAdapter(): Promise<{ name?: string } | null>` and `createWebGl2Context(): WebGL2RenderingContext | null`. The production adapter may access `navigator.gpu` and a temporary canvas; the pure decision function must only consume probe results.

- [x] **Step 3: Add safe browser guards**

Return `unavailable` when `window`, `document`, `navigator.gpu` or canvas context APIs are missing. Catch capability exceptions and preserve a human-readable `reason` for diagnostics.

- [x] **Step 4: Run focused verification**

Run `npm test -- src/renderer/capability.test.ts` and `npm run typecheck`. Expected: all capability cases pass without requiring a browser.

- [x] **Step 5: Commit Task 2**

```text
git add src/renderer/capability.ts src/renderer/capability.test.ts src/renderer/types.ts
git commit -m "feat: detect webgpu and webgl2 capabilities"
```

### Task 3: Create the renderer runtime store and initialization boundary

**Files:**
- Create: `src/renderer/runtime.ts`
- Create: `src/renderer/runtimeStore.ts`
- Create: `src/renderer/runtime.test.ts`
- Modify: `src/renderer/types.ts`

**Interfaces:**
- Produces `RendererRuntimeState`: `{ status, backend, rendererName, adapterName, quality, error, startedAt }`.
- Produces `createRendererRuntime(options)` with `start()`, `stop()`, `setQuality(profile)` and `getState()`.
- Does not expose Three.js internals to consumers.

- [x] **Step 1: Write failing runtime state tests**

Test initial state, WebGPU success, WebGL fallback after WebGPU failure, unavailable state, quality changes, idempotent `stop()` and preservation of error reason on fallback.

- [x] **Step 2: Define renderer adapter seams**

Define a `RendererAdapter` interface with `initialize(canvas, quality): Promise<RendererHandle>`, `dispose()`, and `getSnapshot()`. Keep the WebGPU and WebGL construction details behind this interface.

- [x] **Step 3: Implement state transitions**

Use explicit states `idle`, `probing`, `initializing`, `ready`, `fallback`, `degraded`, `stopped`. Never throw initialization errors to the root app; convert them to state and allow the caller to render a fallback shell.

- [x] **Step 4: Wire a small Zustand store**

Store only serializable runtime state and actions that call the runtime boundary. Do not store Three.js objects in Zustand.

- [x] **Step 5: Verify Task 3**

Run `npm test -- src/renderer/runtime.test.ts` and `npm run typecheck`. Expected: the state machine tests pass with fake adapters and no DOM.

- [x] **Step 6: Commit Task 3**

```text
git add src/renderer/runtime.ts src/renderer/runtimeStore.ts src/renderer/runtime.test.ts src/renderer/types.ts
git commit -m "feat: add renderer runtime boundary"
```

### Task 4: Build the Stage 1 visual shell and R3F scene host

**Files:**
- Create: `src/renderer/RendererHost.tsx`
- Create: `src/scene/SceneHost.tsx`
- Create: `src/scene/Atmosphere.tsx`
- Create: `src/ui/SystemMasthead.tsx`
- Create: `src/ui/RendererStatus.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes renderer runtime state and quality profile.
- Produces a client-only scene host with a truthful backend label, quality label, and degraded fallback message.
- Does not implement graph navigation, Agent UI or fake hardware metrics.

- [x] **Step 1: Add a browser-only renderer host**

Mount the canvas only from a client component. Keep server-rendered layout and page metadata safe. The host should tolerate a failed renderer initialization and retain the dark shell.

- [x] **Step 2: Add a restrained atmospheric scene**

Use a low-frequency gradient/noise-like shader or simple procedural material with no character rain, binary filler or excessive cyan glow. Keep the first scene sparse and leave negative space for the future Compute Core.

- [x] **Step 3: Add real status copy**

Display `WEBGPU READY`, `WEBGL2 FALLBACK`, or `GRAPHICS DEGRADED` based on runtime state. Show the quality profile from configuration. Do not show unavailable metrics.

- [x] **Step 4: Add resize and reduced-motion handling**

Use R3F's canvas sizing and a CSS media query for reduced motion. The desktop layout is primary; ensure the shell remains legible at narrower widths without attempting a complete mobile design.

- [x] **Step 5: Verify visually and statically**

Run `npm run dev`, open the local page, inspect the browser console, confirm the status reflects the actual backend, and capture a screenshot for review. Then run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`.

- [x] **Step 6: Commit Task 4**

```text
git add src/renderer/RendererHost.tsx src/scene src/ui src/app/page.tsx src/app/globals.css
git commit -m "feat: add gpu-first renderer bootstrap shell"
```

### Task 5: Close Stage 1 and update handoff status

**Files:**
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/superpowers/plans/2026-09-17-polnareff-system-phase1.md`

- [x] **Step 1: Record completed work**

Mark Tasks 1–4 complete only with command output and browser evidence. Record the detected backend on the current machine, noting that another machine may choose WebGL2 or degraded mode.

- [x] **Step 2: Record known gaps**

Explicitly list Boot Scene, Compute Core, Graph, Command Bus implementation, Agent Gateway and Developer Overlay as not implemented until their stages are executed.

- [x] **Step 3: Run the full Stage 1 verification**

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then repeat the browser check after a clean dev-server restart.

- [x] **Step 4: Commit the handoff**

```text
git add docs/PROJECT_STATUS.md docs/superpowers/plans/2026-09-17-polnareff-system-phase1.md
git commit -m "docs: close renderer bootstrap handoff"
```

### Stage 2: Implement the truthful Graphics Bootstrap experience

**Outcome:** Replace the Stage 1 static status presentation with a serializable boot state machine and a visual bootstrap sequence that reflects real renderer capability, renderer initialization, manifest readiness and explicit subsystem availability. The scene remains usable when a subsystem is unavailable; an unavailable Ollama gateway is represented as NOT INITIALIZED, never as ONLINE.

**Files:**
- Create: src/boot/types.ts
- Create: src/boot/bootMachine.ts
- Create: src/boot/bootMachine.test.ts
- Create: src/boot/health.ts
- Create: src/boot/health.test.ts
- Create: src/boot/bootCoordinator.ts
- Create: src/boot/manifest.ts
- Create: src/boot/BootExperience.tsx
- Create: src/boot/BootFacts.tsx
- Create: src/boot/bootCopy.ts
- Modify: src/renderer/RendererHost.tsx
- Modify: src/app/globals.css
- Modify: docs/PROJECT_STATUS.md

**Interfaces:**
- BootPhase = idle | probing_graphics | initializing_renderer | checking_systems | constructing_scene | ready | entering | complete | degraded.
- BootState is JSON-serializable and contains phase, startedAt, phaseStartedAt, minimumDurationMs, capability, renderer, health, manifest, reducedMotion, skipRequested, error and a bounded events array.
- BootAction is a closed union of BOOT_BEGIN, GRAPHICS_PROBED, RENDERER_INITIALIZED, SYSTEMS_CHECKED, SCENE_CONSTRUCTED, ENTER_REQUESTED, TRANSITION_COMPLETE, SKIP_REQUESTED and BOOT_DEGRADED.
- HealthSnapshot has independent backend, agent and projectManifest statuses: online, ready, offline, not_initialized, degraded or unknown, with truthful detail text and a probe timestamp.
- BootCoordinator accepts an injected clock and scheduler plus the existing renderer runtime boundary. Its completion timing is a presentation constraint only; phase truth comes from real runtime/capability/manifest inputs.

**Implementation steps:**

- [x] **Step 1: Define the serializable boot contract.**

  Add discriminated unions and readonly snapshots in src/boot/types.ts. Keep Three.js objects, DOM nodes, promises and renderer adapters out of the state. Add a stable event shape for public bootstrap facts: phase_started, capability_detected, renderer_ready, health_checked, scene_constructed, degraded, enter_requested, complete.

- [x] **Step 2: Write reducer-first transition tests.**

  In src/boot/bootMachine.test.ts, test the happy path through every phase, illegal actions being ignored without corrupting state, WebGPU-to-WebGL fallback preserving the capability reason, explicit degraded state, idempotent skip/enter actions, minimum visual duration gating, reduced-motion completion, and serialization with JSON.stringify.

- [x] **Step 3: Implement the pure boot reducer.**

  In src/boot/bootMachine.ts, make transitions deterministic and side-effect free. A renderer failure may enter degraded while retaining a functional shell; it must not throw into the page. ENTER_REQUESTED may only enter the transition phase after renderer and scene readiness are known. TRANSITION_COMPLETE may only produce complete after the coordinator confirms the minimum duration or reduced-motion policy.

- [x] **Step 4: Add project manifest and health aggregation seams.**

  Define an immutable PROJECT_MANIFEST in src/boot/manifest.ts. Add pure aggregateHealth() in src/boot/health.ts with injected probe results. Stage 2 probes the manifest and current renderer runtime only; backend and Ollama agent are explicitly not_initialized until their later server gateway stages exist. Do not perform direct Ollama calls from the browser.

- [x] **Step 5: Build the coordinator around the existing renderer runtime.**

  In src/boot/bootCoordinator.ts, orchestrate capability detection, the existing runtime.start(), health aggregation and scene readiness without moving Three.js implementation details into boot modules. Use performance.now()/Date.now() through an injected clock and a cancellable scheduler. A timer can delay presentation, but it cannot turn an unready subsystem into READY. Clean up listeners and scheduled work on unmount.

- [x] **Step 6: Build the boot visual language.**

  BootExperience.tsx renders a full-viewport overlay over the existing canvas with progressive fact rows, phase label, restrained progress geometry and a clear ENTER COMPUTE ENVIRONMENT affordance. BootFacts.tsx maps only typed boot facts to status rows. bootCopy.ts contains semantic copy for READY, FALLBACK, NOT INITIALIZED, DEGRADED and OFFLINE; no fake utilization, temperature, VRAM or power values.

- [x] **Step 7: Add real input and accessibility behavior.**

  Listen for Enter, Space, and pointer activation only while the boot state is ready or degraded. Support ?boot=skip for repeatable development verification and ?boot=full to force the full choreography. Respect prefers-reduced-motion by shortening presentation transitions while preserving truthful initialization. The boot overlay exposes a labelled status region and a keyboard-focusable enter control.

- [x] **Step 8: Integrate without widening the renderer boundary.**

  Update RendererHost.tsx to render the existing scene behind the overlay, feed it serializable boot visibility/transition state, and preserve the Stage 1 degraded shell if the runtime cannot initialize. Do not place graph, command, Agent or Three.js object references in boot state. Keep server-rendered page.tsx free of browser API access.

- [x] **Step 9: Verify Stage 2 before starting Stage 3.**

  Run focused boot tests, then npm run lint, npm run typecheck, npm test, and NEXT_TELEMETRY_DISABLED=1 npm run build. Start the dev server, capture full and skipped boot screenshots at desktop dimensions, inspect browser console and server logs, verify the real backend label, verify NOT INITIALIZED for the Agent gateway, and test the degraded path with a forced unavailable adapter. Record evidence in docs/PROJECT_STATUS.md and commit Stage 2 before any Compute Core implementation begins.

### Stage 3: Implement Compute Core visual system v1

**Outcome:** Replace the Stage 1 atmospheric placeholder with a single GPU-friendly Compute Core visual system that reads like a spatial computing instrument: an inner procedural seed, structural cage, restrained energy field, particle shell and orbital structures. The first version is self-contained and interaction-ready but does not yet implement Knowledge Graph topology or command routing.

**Files:**
- Create: src/scene/core/coreTypes.ts
- Create: src/scene/core/coreParameters.ts
- Create: src/scene/core/coreParameters.test.ts
- Create: src/scene/core/ComputeCore.tsx
- Create: src/scene/core/CoreSeed.tsx
- Create: src/scene/core/CoreCage.tsx
- Create: src/scene/core/CoreEnergyField.tsx
- Create: src/scene/core/CoreParticleShell.tsx
- Create: src/scene/core/CoreOrbitals.tsx
- Create: src/scene/core/coreMaterials.ts
- Create: src/scene/camera/cameraController.ts
- Create: src/scene/camera/cameraController.test.ts
- Create: src/telemetry/rendererTelemetry.ts
- Create: src/telemetry/rendererTelemetry.test.ts
- Modify: src/scene/SceneHost.tsx
- Modify: src/config/quality.ts
- Modify: src/app/globals.css
- Modify: docs/PROJECT_STATUS.md

**Interfaces:**
- ComputeCoreVisualState = dormant | awakening | idle | hover_response | focusing | agent_activity.
- ComputeCoreInteraction contains normalized pointer coordinates, target focus direction, intensity, transition progress and reduced-motion state. It is serializable and independent of R3F.
- CoreParameters is derived from QualityProfile and includes fixed particle budget, shell radius, cage segment budget, orbital count, field resolution and bloom eligibility.
- RendererTelemetrySnapshot contains measured fps, frameTimeMs, drawCalls, triangles, geometries, textures, particleCount, backend and quality; unavailable values are null, never fabricated.
- CameraController owns mutable interpolation refs and exposes setPointerTarget(), setFocusTarget(), setVisualState() and update(deltaSeconds). Components consume the controller without knowing graph or Agent semantics.

**Implementation steps:**

- [x] **Step 1: Define quality-derived core budgets.**

  Extend the existing quality table with explicit Core budgets. ULTRA targets the desktop GPU-first presentation, HIGH/MEDIUM reduce particle and field density, and SAFE reduces update cost and disables optional bloom. Add pure tests for monotonic budgets, finite values, and deterministic parameter output.

- [x] **Step 2: Write interaction and camera tests first.**

  Test pointer target clamping, damping convergence, focus interpolation, reduced-motion behavior and no overshoot. Keep the math in cameraController.ts as scalar operations on stable mutable values so the render loop does not allocate objects or arrays.

- [x] **Step 3: Implement the core state model.**

  Map boot completion to awakening, settle into idle, and expose explicit setters for future hover_response, focusing and agent_activity. State changes only alter visual parameters; they do not import command bus or Agent modules. Document the field behavior and transition math in coreTypes.ts comments.

- [x] **Step 4: Build the layered scene with stable GPU resources.**

  ComputeCore.tsx owns one group and stable refs. CoreSeed uses procedural geometry/material, CoreCage uses indexed line geometry, CoreEnergyField uses a bounded shader field, CoreParticleShell uses one points draw with reusable typed buffers, and CoreOrbitals uses instanced or line-based orbital structures. Avoid one React component per particle and avoid creating vectors/materials inside useFrame.

- [x] **Step 5: Add restrained animation and pointer response.**

  Use a single frame loop to update scalar uniforms, rotations and camera controller values. Pointer movement produces slight parallax and energy redistribution with inertia/damping. The core must remain legible and spatially quiet at rest; bloom, if available through the existing renderer path, is limited to the seed and energy field.

- [x] **Step 6: Add the telemetry seam without building the Developer Overlay.**

  Implement rendererTelemetry.ts as a sampler that reads the actual Three.js renderer info after frames render and accepts the measured particle count from core parameters. Publish a serializable snapshot through a callback/ref seam; do not add overlay UI, fake GPU metrics or a second render loop.

- [x] **Step 7: Integrate the camera and core into SceneHost.**

  Keep SceneHost responsible for scene composition and pass only serializable interaction/quality props into the core. Preserve the existing backend adapters and WebGL fallback. The core must remain mountable when the renderer is degraded, with optional layers reducing or disabling themselves from the same quality parameters.

- [x] **Step 8: Verify visual and performance behavior in a real browser.**

  Run focused tests and the full static suite. Start the dev server and capture screenshots at 1920x1080 and 2560x1440 for dormant/idle and pointer-response states. Inspect browser errors, confirm WebGPU/WebGL fallback behavior, sample measured frame time/FPS and renderer info for a sustained desktop run, and record draw-call/particle budgets in the status handoff. Refine shader contrast, depth, density and motion from screenshots before marking Stage 3 complete.

- [x] **Step 9: Commit the verified Compute Core slice.**

  Update docs/PROJECT_STATUS.md with the visual evidence, measured telemetry limitations and known gaps. Commit only after lint, typecheck, tests, disabled-telemetry production build and browser verification pass.
## Future plan map

The following stages are intentionally separate implementation slices and should not be collapsed into Stage 1:

- Stage 2: boot state machine and real health aggregation.
- Stage 3: layered Compute Core and GPU-friendly particle shell.
- Stage 4: graph schema, camera controller and spatial interactions.
- Stage 5: command types, registry, parser and dispatch tests.
- Stage 6: system-specific Command Palette.
- Stage 7: health routes and Ollama adapter.
- Stage 8: deterministic-first SSE Agent Gateway and whitelist validation.
- Stage 9: public Agent Trace.
- Stage 10: developer overlay and runtime counters.
- Stage 11: performance instrumentation and frame-budget pass.
- Stage 12: visual polish, browser verification and regression pass.

Each future stage must produce its own evidence and update `docs/PROJECT_STATUS.md` before moving on.

### Stage 4: Knowledge Graph

**Outcome:** Add a data-driven, serializable spatial Knowledge Graph around the existing Compute Core. This stage stops before Command Bus, Command Palette, Ollama, Agent Gateway, Agent Trace, Developer Overlay, Stage 11 performance tuning and Stage 12 final polish.

**Implementation record:**

- [x] Read the design spec, Phase 1 plan, project status, current git history and the existing renderer, boot, scene, camera, quality and Core modules before editing.
- [x] Extended `src/graph/types.ts` with serializable node, edge, manifest, position and layout contracts. Stable ids remain `core`, `ai`, `graphics`, `game-analysis`, `systems` and `research`.
- [x] Added `src/graph/graphManifest.ts` as the single source of truth. The initial topology is a minimal five-edge star from `core`; there are no speculative ontology or content pages.
- [x] Added `src/graph/layout.ts` with deterministic finite positions, elevation/depth separation, and density-controlled edge subdivision. Core remains at the origin and no semantic node is duplicated by quality profile.
- [x] Added `src/graph/interaction.ts` with a serializable reducer for pointer enter/leave, focus, focus switching and clear focus. Graph state remains local to SceneHost; no unnecessary Zustand state was introduced.
- [x] Added manifest-driven `KnowledgeGraph`, `GraphNode` and `GraphEdges` R3F views. Node states are idle, hovered, focused and dimmed; labels use the existing Drei dependency and edges use standard Three materials compatible with both renderers.
- [x] Kept `ComputeCore.tsx` independent from Graph. SceneHost maps graph hover/focus to `hover_response` / `focusing` and shares the existing camera controller instance.
- [x] Added `deriveCameraFocusTarget()` and camera focus tests. Focus uses the existing damped controller seam; Escape clears focus and restores the overview target. Reduced motion remains functional with shortened interpolation behavior.
- [x] Configured the custom R3F root event manager against the canvas parent so Html labels retain measurable layout while the graph interaction boundary listens to real canvas pointer events.
- [x] Added schema, layout, interaction and camera focus tests without introducing Command or Agent contracts.

**Verification record:**

- [x] `npm test`: 14 test files and 45 tests passed.
- [x] `npm run lint` passed.
- [x] `npm run typecheck` passed.
- [x] `NEXT_TELEMETRY_DISABLED=1 npm run build` passed on Next 16.3.5.
- [x] WebGPU browser evidence at 1920×1080 (`boot=skip`): actual viewport 1898×926, WebGPU renderer ready, five domain labels visible, hover on GRAPHICS, focus on GRAPHICS and Escape unfocus verified.
- [x] WebGL2 fallback evidence at 2560×1440 with GPU disabled: actual viewport 2538×1342, WebGL renderer ready, five domain labels visible and GRAPHICS focus verified.
- [x] Saved `artifacts/stage4-graph-overview-webgpu.png`, `artifacts/stage4-graph-hover-webgpu.png`, `artifacts/stage4-graph-focused-webgpu.png` and `artifacts/stage4-graph-fallback.png`.
- [x] Browser console collection found no uncaught exceptions or app/R3F errors. Known environment warnings remain documented in `docs/PROJECT_STATUS.md`; no unavailable GPU metrics were fabricated.

**Handoff:** Stage 4 is complete. The next isolated slice is Stage 5 — Command Bus; do not start it as part of this record.


### Stage 5: Command Bus

**Outcome:** Add a typed, synchronous, framework-neutral Command Bus and semantic adapters. This stage stops before Command Palette UI, natural-language parsing, Ollama, Agent Gateway, Agent tool calling, Agent Trace, Developer Overlay, Stage 11 performance work and Stage 12 polish.

**Implementation record:**

- [x] Read the design spec, Phase 1 plan, project status, current branch/history and the actual Stage 4 Command/Graph/Scene/Camera/Renderer/Quality interfaces before editing.
- [x] Kept the existing strict `CommandSource` and `Command` union, making command fields readonly and serializable.
- [x] Added `CommandExecutionResult` and public `CommandExecutionEvent` contracts with `executed`, `rejected`, `unavailable` and `failed` statuses.
- [x] Added `CommandRegistry` with typed handler lookup and explicit duplicate-registration failure. No `any`, silent overwrite or giant switch was introduced.
- [x] Added synchronous `createCommandBus`. Unregistered commands return `unavailable`; handler exceptions become `failed`; subscriber exceptions cannot alter execution results.
- [x] Added injected graph and renderer capability contracts. Graph handlers call only `focusNode` / `clearFocus`; quality handlers call only `setQuality`.
- [x] Added `src/graph/graphController.ts` as the semantic seam between command adapters and the existing GraphInteraction reducer. Pointer and Command Bus focus share the same graph state contract.
- [x] Integrated the bus lifecycle into SceneHost and RendererHost without a global singleton, DOM access or direct Three.js/camera/Core control.
- [x] Left `OPEN_SECTION`, `SYSTEM_STATUS`, `SET_DEV_OVERLAY` and `SURPRISE_ME` unregistered until their owning stages provide truthful behavior.

**Verification record:**

- [x] Wrote focused tests first and observed the expected red state before implementing production modules.
- [x] Focused command tests: 3 files, 14 tests passed.
- [x] Full test suite: 17 files, 59 tests passed.
- [x] `npm run lint` passed.
- [x] `npm run typecheck` passed.
- [x] `NEXT_TELEMETRY_DISABLED=1 npm run build` passed on Next 16.3.5.
- [x] Browser regression passed on WebGPU at actual 1898×926 and WebGL2 fallback at actual 2538×1342; Compute Core, five Graph labels, hover, focus and Escape unfocus remained functional with no uncaught exceptions or console error events.
- [x] Import audit confirmed commands core has no Three.js/React/Agent dependency and Graph/Core have no Command dependency.

**Handoff:** Stage 5 is complete. The next isolated slice is Stage 6 — Command Palette; do not start it as part of this record.