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

- [ ] **Step 1: Write failing capability tests**

Cover: WebGPU and WebGL2 available chooses WebGPU; WebGPU absent with WebGL2 available chooses WebGL2; WebGPU adapter request failure falls back to WebGL2; both unavailable returns `unavailable`; adapter names are optional and never invented.

- [ ] **Step 2: Implement injected probes**

Use a `CapabilityProbe` interface with `requestWebGpuAdapter(): Promise<{ name?: string } | null>` and `createWebGl2Context(): WebGL2RenderingContext | null`. The production adapter may access `navigator.gpu` and a temporary canvas; the pure decision function must only consume probe results.

- [ ] **Step 3: Add safe browser guards**

Return `unavailable` when `window`, `document`, `navigator.gpu` or canvas context APIs are missing. Catch capability exceptions and preserve a human-readable `reason` for diagnostics.

- [ ] **Step 4: Run focused verification**

Run `npm test -- src/renderer/capability.test.ts` and `npm run typecheck`. Expected: all capability cases pass without requiring a browser.

- [ ] **Step 5: Commit Task 2**

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

- [ ] **Step 1: Write failing runtime state tests**

Test initial state, WebGPU success, WebGL fallback after WebGPU failure, unavailable state, quality changes, idempotent `stop()` and preservation of error reason on fallback.

- [ ] **Step 2: Define renderer adapter seams**

Define a `RendererAdapter` interface with `initialize(canvas, quality): Promise<RendererHandle>`, `dispose()`, and `getSnapshot()`. Keep the WebGPU and WebGL construction details behind this interface.

- [ ] **Step 3: Implement state transitions**

Use explicit states `idle`, `probing`, `initializing`, `ready`, `fallback`, `degraded`, `stopped`. Never throw initialization errors to the root app; convert them to state and allow the caller to render a fallback shell.

- [ ] **Step 4: Wire a small Zustand store**

Store only serializable runtime state and actions that call the runtime boundary. Do not store Three.js objects in Zustand.

- [ ] **Step 5: Verify Task 3**

Run `npm test -- src/renderer/runtime.test.ts` and `npm run typecheck`. Expected: the state machine tests pass with fake adapters and no DOM.

- [ ] **Step 6: Commit Task 3**

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

- [ ] **Step 1: Add a browser-only renderer host**

Mount the canvas only from a client component. Keep server-rendered layout and page metadata safe. The host should tolerate a failed renderer initialization and retain the dark shell.

- [ ] **Step 2: Add a restrained atmospheric scene**

Use a low-frequency gradient/noise-like shader or simple procedural material with no character rain, binary filler or excessive cyan glow. Keep the first scene sparse and leave negative space for the future Compute Core.

- [ ] **Step 3: Add real status copy**

Display `WEBGPU READY`, `WEBGL2 FALLBACK`, or `GRAPHICS DEGRADED` based on runtime state. Show the quality profile from configuration. Do not show unavailable metrics.

- [ ] **Step 4: Add resize and reduced-motion handling**

Use R3F's canvas sizing and a CSS media query for reduced motion. The desktop layout is primary; ensure the shell remains legible at narrower widths without attempting a complete mobile design.

- [ ] **Step 5: Verify visually and statically**

Run `npm run dev`, open the local page, inspect the browser console, confirm the status reflects the actual backend, and capture a screenshot for review. Then run `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`.

- [ ] **Step 6: Commit Task 4**

```text
git add src/renderer/RendererHost.tsx src/scene src/ui src/app/page.tsx src/app/globals.css
git commit -m "feat: add gpu-first renderer bootstrap shell"
```

### Task 5: Close Stage 1 and update handoff status

**Files:**
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/superpowers/plans/2026-09-17-polnareff-system-phase1.md`

- [ ] **Step 1: Record completed work**

Mark Tasks 1–4 complete only with command output and browser evidence. Record the detected backend on the current machine, noting that another machine may choose WebGL2 or degraded mode.

- [ ] **Step 2: Record known gaps**

Explicitly list Boot Scene, Compute Core, Graph, Command Bus implementation, Agent Gateway and Developer Overlay as not implemented until their stages are executed.

- [ ] **Step 3: Run the full Stage 1 verification**

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then repeat the browser check after a clean dev-server restart.

- [ ] **Step 4: Commit the handoff**

```text
git add docs/PROJECT_STATUS.md docs/superpowers/plans/2026-09-17-polnareff-system-phase1.md
git commit -m "docs: close renderer bootstrap handoff"
```

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
