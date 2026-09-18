# Stage 3.5.1 Visual Composition Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct POLNAREFF SYSTEM's default 3D scene so a text-free thumbnail reads as one large computational machine with distinct processing domains, directional GPU flow and explicit depth hierarchy.

**Architecture:** Preserve `RendererRuntime`, the WebGPU/WebGL2 adapter boundary, `SceneHost` semantic integration, graph reducer ownership, `CameraController`, Command Bus and telemetry seam. Replace only the visual descriptor/view layers with deterministic primary/secondary/ambient structure, a local anisotropic field, state-driven signal routes and five domain-specific processing-region silhouettes. Keep all high-count field work on GPU attributes/uniforms and keep CPU updates limited to scalar inputs and small active-signal buffers.

**Tech Stack:** Next.js 16.3.5, React 19.2, R3F 9.7, Three.js r186, TSL/`PointsNodeMaterial` for WebGPU, `PointsMaterial`/reusable geometry for WebGL2, TypeScript strict, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-19-stage351-visual-composition-reconstruction-design.md`

## Global Constraints

- Do not implement Stage 6, Command Palette, parser, Ollama, Agent Gateway, Agent Trace, Developer Overlay or Stage 11 performance work.
- Preserve deterministic descriptor generators, RendererRuntime, WebGPU/WebGL2 selection, Command Bus, graph reducer semantics, CameraController ownership, quality propagation, reduced motion and truthful telemetry.
- `ComputeCore` must not import Graph, Command or Agent modules; Graph schema and Command core remain framework-neutral.
- No CPU per-frame loop over tens of thousands of field samples; no per-frame geometry/material/buffer allocation.
- WebGPU ULTRA is the visual benchmark; WebGL2 must retain the same hero silhouette, domain silhouettes, route hierarchy and focus causality.
- Use `npm.cmd`; do not update dependencies or modify package configuration.
- Use v2rayN SOCKS5 proxy `socks5h://127.0.0.1:10808` for GitHub operations only.
- Every production behavior change gets a failing pure test first, then the minimal implementation and a focused green run.
- Keep the working tree free of `.npm-cache`, browser profiles, credentials and other machine-local files.

## File Map

Create or modify only the following responsibilities:

- `src/scene/core/coreTypes.ts`: serializable topology/field/parameter contracts and visual input types.
- `src/scene/core/coreParameters.ts`: quality-to-visual budgets and configured-vs-rendered budget mapping.
- `src/scene/core/coreTopology.ts`: deterministic primary/secondary/ambient form descriptors and state activation.
- `src/scene/core/coreField.ts`: deterministic local flow zones, compression attributes, voids and field-state mapping.
- `src/scene/core/coreTrajectories.ts`: classified open routes and source-to-target signal activation.
- `src/scene/core/coreTelemetry.ts`: pure actual field/sample/signal count derivation.
- `src/scene/core/CoreNucleus.tsx`: dense hero processing cluster and primary slabs.
- `src/scene/core/CoreTopologyView.tsx`: reusable oriented primary/secondary/ambient structural members.
- `src/scene/core/CoreFragments.tsx`: layered midground/foreground processing plates.
- `src/scene/core/CoreFlowField.tsx`: stable attributes, stream draw ranges and GPU field view.
- `src/scene/core/coreFlowMaterial.ts`: TSL displacement/compression and WebGL2 scalar fallback.
- `src/scene/core/CoreTrajectoryPaths.tsx`: route hierarchy and active path buffers.
- `src/scene/core/CoreSignals.tsx`: small moving signal buffer with bounded trails.
- `src/scene/core/ComputeCore.tsx`: composition scale/framing and telemetry integration only.
- `src/scene/graph/domainVisuals.ts`: deterministic visual variant descriptors for five domain ids.
- `src/scene/graph/domainVisuals.test.ts`: deterministic/distinct/bounded domain descriptor tests.
- `src/scene/graph/GraphNode.tsx`: variant processing-region view and reduced label weight.
- `src/scene/graph/GraphEdges.tsx`: bent route bundles and bounded source-to-domain pulse.
- `src/graph/layout.ts`: stronger depth-separated domain layout and deterministic route points.
- `src/scene/graph/KnowledgeGraph.tsx`: existing semantic hit-testing integration only if route-view props require it.
- `src/scene/SceneHost.tsx`: mount `Atmosphere`, preserve existing graph/core ownership.
- `src/scene/Atmosphere.tsx`: sparse background depth field without spherical HUD geometry.
- `src/renderer/RendererHost.tsx`: only if camera defaults or visual integration require a bounded framing change.
- `src/telemetry/rendererTelemetry.ts`: configured/rendered/active sample fields with actual `particleCount` semantics.
- `src/telemetry/rendererTelemetry.test.ts`: telemetry contract regression tests.
- `src/app/globals.css`: subdued diagnostics and legible masthead.
- Existing focused Core/graph/telemetry tests: update assertions to the new contracts, never remove behavioral coverage.
- `docs/PROJECT_STATUS.md`, `docs/AI_HANDOFF.md`: final Stage 3.5.1 evidence and handoff closeout.
- `artifacts/stage351-*.png`: local/browser evidence following the existing artifact policy.

---

### Task 1: Re-establish baseline and correct telemetry semantics

**Files:**
- Modify: `src/scene/core/coreTypes.ts`
- Modify: `src/scene/core/coreParameters.ts`
- Create: `src/scene/core/coreTelemetry.ts`
- Create: `src/scene/core/coreTelemetry.test.ts`
- Modify: `src/telemetry/rendererTelemetry.ts`
- Modify: `src/telemetry/rendererTelemetry.test.ts`
- Modify: `src/scene/core/ComputeCore.tsx`

**Interfaces:**
- `CoreParameters` produces `configuredFieldBudget`, `fieldSampleBudget`, `activeSignalBudget`, structural budgets and `fieldResolution`.
- `CoreTelemetryCounts` is `{ configuredFieldBudget: number; renderedFieldSamples: number; activeSignalSamples: number }`.
- `deriveCoreTelemetryCounts(parameters, field, trajectories, visualInput)` returns finite counts from actual deterministic descriptors and current state.
- `RendererTelemetrySnapshot` keeps `particleCount` as the actual rendered field sample count for compatibility and adds `configuredFieldBudget`, `renderedFieldSamples` and `activeSignalSamples`.

- [ ] **Step 1: Write failing telemetry tests.**

Add tests proving a field descriptor with zero-weight gaps reports fewer `renderedFieldSamples` than its configured budget, an active signal count changes by visual state, and `sampleRendererTelemetry()` copies all three explicit count fields while setting `particleCount === renderedFieldSamples`.

- [ ] **Step 2: Run focused tests and verify the expected red state.**

Run:

```text
npm.cmd test -- src/scene/core/coreTelemetry.test.ts src/telemetry/rendererTelemetry.test.ts
```

Expected: failure because the explicit telemetry count contract and pure derivation do not exist yet.

- [ ] **Step 3: Implement the count contract.**

Use the existing field stream/weight logic to count visible samples for the active stream count. Use `deriveCoreTrajectoryActivation()` to count active signal paths/samples without iterating the full field. Keep `particleCount` as the actual rendered field draw count, not the configured 72,000 budget.

- [ ] **Step 4: Integrate telemetry into `ComputeCore`.**

Compute the pure counts from stable `field`, `trajectories`, `parameters` and the sampled `viewInput`. Pass the explicit counts to `sampleRendererTelemetry()` at the existing 4 Hz seam. Do not change the callback frequency or add UI.

- [ ] **Step 5: Run focused and existing Core tests.**

Run:

```text
npm.cmd test -- src/scene/core src/telemetry
```

Expected: all focused tests pass and existing deterministic/finite tests remain green.

---

### Task 2: Build deterministic machine topology and route classes

**Files:**
- Modify: `src/scene/core/coreTypes.ts`
- Modify: `src/scene/core/coreParameters.ts`
- Modify: `src/scene/core/coreTopology.ts`
- Modify: `src/scene/core/coreTopology.test.ts`
- Modify: `src/scene/core/coreTrajectories.ts`
- Modify: `src/scene/core/coreTrajectories.test.ts`

**Interfaces:**
- `CoreTopologyRegion` is `'anchor' | 'primary' | 'secondary' | 'route' | 'foreground'`.
- `CoreTopologyRoute` is `'primary' | 'secondary' | 'ambient' | 'signal'`.
- Nodes expose finite `position`, `scale`, `weight`, `region` and `depthBand`.
- Edges expose finite `source`, `target`, `activationRank`, `route` and `importance`.
- `CoreTopologyActivation` returns separate primary, secondary and ambient edge ids, active nodes and a compatibility `activeEdgeIds` union.
- Trajectory routes are classified as `primary`, `secondary`, `ambient` or `signal`.

- [ ] **Step 1: Write failing descriptor tests.**

Add tests for deterministic equal-seed output, finite node scales/depth bands, at least two primary routes at ULTRA, bounded secondary/ambient counts, no self edges, open trajectories, and distinct route-class counts at ULTRA and SAFE.

- [ ] **Step 2: Run the Core descriptor tests and verify red.**

Run:

```text
npm.cmd test -- src/scene/core/coreTopology.test.ts src/scene/core/coreTrajectories.test.ts
```

Expected: failures on the new region/scale/route-class assertions.

- [ ] **Step 3: Implement the primary processing spine.**

Replace the current mostly radial fixed positions with deterministic positions for a dense anchor cluster, a long primary spine, secondary blocks, route points and a small foreground band. Use fixed descriptors plus the existing seeded perturbation. Keep all values finite and bounded for SAFE.

- [ ] **Step 4: Implement route-aware activation.**

Make `idle` retain readable primary structure and a small secondary support set; make `hover_response` select a local route using pointer direction; make `focusing` select a directional route using focus direction; make `agent_activity` select bounded primary/secondary/signal paths. Material tone remains secondary to membership changes.

- [ ] **Step 5: Reclassify trajectories.**

Generate fewer longer primary routes, shorter secondary routes, sparse ambient traces and signal routes with explicit endpoints. Preserve open endpoints and deterministic sample counts. Update activation to expose active route ids and signal speed.

- [ ] **Step 6: Run the focused descriptor suite.**

Run:

```text
npm.cmd test -- src/scene/core/coreTopology.test.ts src/scene/core/coreTrajectories.test.ts src/scene/core/coreParameters.test.ts
```

Expected: pass with monotonic ULTRA/HIGH/MEDIUM/SAFE budgets and SAFE still containing hero structure descriptors.

---

### Task 3: Rebuild the local GPU flow field

**Files:**
- Modify: `src/scene/core/coreField.ts`
- Modify: `src/scene/core/coreField.test.ts`
- Modify: `src/scene/core/CoreFlowField.tsx`
- Modify: `src/scene/core/coreFlowMaterial.ts`
- Modify: `src/scene/core/coreFlowMaterial.test.ts`

**Interfaces:**
- `CoreFieldAttributes` adds stable `compression`, `zone` and `depthBias` arrays.
- `CoreFieldState` adds `targetZone` and `activeZoneCount` while preserving directional bias/activity/stream selection.
- `countVisibleCoreFieldSamples(descriptor, activeStreamCount)` returns the actual draw-range count.

- [ ] **Step 1: Write failing field tests.**

Add tests proving equal seed/parameters produce equal positions, drift, zone, compression and depth arrays; at least two explicit zero-weight voids exist; field zones are non-uniform; hover/focus map to different bounded target zones; and visible sample count is lower than configured budget when gaps/stream selection apply.

- [ ] **Step 2: Run the field/material tests and verify red.**

Run:

```text
npm.cmd test -- src/scene/core/coreField.test.ts src/scene/core/coreFlowMaterial.test.ts
```

- [ ] **Step 3: Generate local anisotropic zones.**

Replace broad detached ribbons with compact processing lanes around the primary spine and secondary blocks. Preserve asymmetric gaps, local attractors, depth bias and deterministic weight envelopes. Use a field sample budget that produces roughly 10k–30k high-quality samples at ULTRA rather than claiming 72k rendered points.

- [ ] **Step 4: Add GPU displacement and compression.**

Upload the new attributes once. In the WebGPU node position path, combine drift, phase, zone-weighted directional bias, compression around the active target and bounded pointer/focus offsets. Update only scalar uniforms in `useFrame`. In WebGL2, preserve the same positions/stream draw selection and apply bounded object/material scalar response without `ShaderMaterial`.

- [ ] **Step 5: Run focused field tests and static checks.**

Run:

```text
npm.cmd test -- src/scene/core/coreField.test.ts src/scene/core/coreFlowMaterial.test.ts
npm.cmd run typecheck
```

---

### Task 4: Turn the Core into a massed hero structure

**Files:**
- Modify: `src/scene/core/CoreNucleus.tsx`
- Modify: `src/scene/core/CoreTopologyView.tsx`
- Modify: `src/scene/core/CoreFragments.tsx`
- Modify: `src/scene/core/CoreTrajectoryPaths.tsx`
- Modify: `src/scene/core/CoreSignals.tsx`
- Modify: `src/scene/core/ComputeCore.tsx`

**Interfaces:**
- Primary routes use reusable oriented bars or instanced structural members; they do not depend on WebGL line width.
- Secondary and ambient routes use separate buffers/material levels.
- Signal buffers remain bounded by `activeSignalBudget` and are the only route-related positions updated each frame.

- [ ] **Step 1: Add view-level unit tests for route grouping.**

Extend pure resource/update tests or add focused helpers so active topology separates primary/secondary/ambient draw counts and signal updates remain bounded by the configured active signal budget. Do not add pixel tests.

- [ ] **Step 2: Run the new view helper tests and verify red.**

Run the focused Core suite and confirm the new grouping expectations fail before implementation.

- [ ] **Step 3: Implement the dense nucleus.**

Replace the three tiny wireframe boxes with layered processing slabs, offset plates and a compact central anchor. Use stable declarative geometry or memoized resources; do not create one component per particle. Scale the `ComputeCore` group so the combined field, spine, blocks and routes occupy the central 45–60% desktop visual area.

- [ ] **Step 4: Implement structural route hierarchy.**

Use reusable oriented bars/instanced meshes for primary routes. Keep secondary routes visible but lower in opacity/scale; keep ambient traces sparse and faint. Ensure the idle state still shows a connected machine silhouette rather than only an isolated point cluster.

- [ ] **Step 5: Implement layered fragments and signal semantics.**

Place a few foreground plates/traces at distinct z depth. Make hover/focus reveal local fragment relationships and source-to-target signal movement. Keep reduced motion static-but-structured by freezing travel while preserving selected routes and compression.

- [ ] **Step 6: Run Core tests, lint and typecheck.**

Run:

```text
npm.cmd test -- src/scene/core
npm.cmd run lint
npm.cmd run typecheck
```

---

### Task 5: Replace uniform Graph widgets with processing regions

**Files:**
- Create: `src/scene/graph/domainVisuals.ts`
- Create: `src/scene/graph/domainVisuals.test.ts`
- Modify: `src/scene/graph/GraphNode.tsx`
- Modify: `src/scene/graph/GraphEdges.tsx`
- Modify: `src/graph/layout.ts`
- Modify: `src/scene/graph/KnowledgeGraph.tsx` only if interaction props need a stable view seam

**Interfaces:**
- `DomainVisualKind` maps `ai`, `graphics`, `game-analysis`, `systems`, `research` to five distinct kinds.
- `deriveDomainVisualDescriptor(nodeId, detail)` returns deterministic bounded bars/plates/lattice members and a shared activation profile.
- Semantic node ids, manifest, graph reducer actions and projected hit testing remain unchanged.

- [ ] **Step 1: Write failing domain descriptor tests.**

Test equal inputs for deterministic output, all five ids for distinct `kind`, finite bounded bar descriptors, and at least three structural members per domain at ULTRA/detail 1.

- [ ] **Step 2: Run the descriptor test and verify red.**

Run:

```text
npm.cmd test -- src/scene/graph/domainVisuals.test.ts
```

- [ ] **Step 3: Implement five domain silhouettes.**

Use shared muted materials and distinct reusable bar/plate arrangements: branching AI, layered planar GRAPHICS, forked GAME ANALYSIS, stacked SYSTEMS and open RESEARCH lattice. Remove the torus-plus-wireframe-icosahedron template entirely.

- [ ] **Step 4: Rebuild graph route geometry.**

Change deterministic edge points from straight interpolation to a small bent/converging route bundle with one near-domain fan point. Add a bounded pulse mesh/point that travels from the Core endpoint to the domain endpoint only when the edge is related to hover/focus. Update only its scalar progress and position each frame.

- [ ] **Step 5: Reframe domain layout.**

Move domains slightly outward and separate z depth so the hero Core remains visually dominant while all five regions stay in frame at desktop overview. Keep layout finite and deterministic; update layout tests for the new positions/depth ordering.

- [ ] **Step 6: Run graph tests and static checks.**

Run:

```text
npm.cmd test -- src/graph src/scene/graph
npm.cmd run lint
npm.cmd run typecheck
```

---

### Task 6: Reconstruct atmosphere, camera framing and product UI weight

**Files:**
- Modify: `src/scene/Atmosphere.tsx`
- Modify: `src/scene/SceneHost.tsx`
- Modify: `src/renderer/RendererHost.tsx` only for bounded camera defaults
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write focused pure camera/atmosphere invariants.**

Extend camera tests for bounded default framing/focus targets and ensure reduced motion does not eliminate focus selection. Keep atmosphere visual constants out of algorithm tests; verify its descriptor generation if extracted.

- [ ] **Step 2: Run the focused camera tests and verify red for changed behavior.**

Run:

```text
npm.cmd test -- src/scene/camera
```

- [ ] **Step 3: Mount a subtle depth atmosphere.**

Replace old atmosphere sphere/rings with sparse distant traces/field points and low-frequency depth variation. Mount it in `SceneHost` behind the Core/Graph. Do not add stars or random dust.

- [ ] **Step 4: Adjust default framing.**

Tune FOV, camera z, Core group position/scale and focus coefficients so the static overview is already spatial. Keep all movement bounded and avoid global rotation.

- [ ] **Step 5: Reduce diagnostic UI weight.**

Lower renderer-status opacity/detail and tighten placement while retaining truthful backend/quality copy. Slightly increase masthead readability. Do not remove telemetry capability or create an overlay.

- [ ] **Step 6: Run lint, typecheck and tests.**

Run the full static suite after the UI/camera changes.

---

### Task 7: Browser visual iteration and evidence capture

**Files:**
- Create/update only local evidence under `artifacts/stage351-*.png` following existing policy.
- Modify code only when screenshot review identifies a visual defect covered by Tasks 2–6.

- [ ] **Step 1: Capture and inspect the baseline.**

Start `npm.cmd run dev`, open `?boot=skip`, record OS, browser, viewport, DPR, canvas drawing buffer, backend, adapter name if exposed, quality and console logs. Save/verify `artifacts/stage351-baseline-newpc.png` before judging the new result.

- [ ] **Step 2: Capture first reconstruction pass.**

Capture WebGPU overview at the largest reliable desktop viewport. Inspect the image directly, then produce a 480×270 thumbnail and a grayscale/blur/squint review. Verify that the hero structure dominates without reading labels.

- [ ] **Step 3: Capture interaction states.**

Capture WebGPU hover GRAPHICS, focus GRAPHICS and Escape. Confirm that focus changes route/field/signal direction and that Escape returns overview. Inspect browser console for new errors.

- [ ] **Step 4: Perform the mandatory second visual pass.**

Adjust only evidence-backed issues: hero scale, route contrast, domain separation, field compression/density, framing or UI weight. Repeat overview/hover/focus screenshots and inspect them directly.

- [ ] **Step 5: Verify WebGL2 and reduced motion.**

Use the existing GPU-disabled fallback method. Capture WebGL2 overview/hover/focus and run reduced-motion overview/focus/Escape. Record actual selected backend and any known environment warnings; do not infer adapter name or hardware metrics.

- [ ] **Step 6: Save final required evidence.**

The final local set must include:

```text
artifacts/stage351-baseline-newpc.png
artifacts/stage351-overview-webgpu.png
artifacts/stage351-hover-webgpu.png
artifacts/stage351-focus-webgpu.png
artifacts/stage351-overview-webgl2.png
```

---

### Task 8: Full verification, documentation and focused commit

**Files:**
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/AI_HANDOFF.md`

- [ ] **Step 1: Run the complete verification suite.**

Run:

```text
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
$env:NEXT_TELEMETRY_DISABLED='1'; npm.cmd run build
```

Record real outputs, test counts, build version, browser backend results and known warnings. Do not claim sustained FPS/GPU utilization.

- [ ] **Step 2: Update project status.**

Add a `Stage 3.5.1 — Visual Composition Reconstruction` section describing baseline failure, hero reconstruction, topology/field/domain changes, telemetry correction, browser evidence, remaining weaknesses and final commit placeholder to be filled after commit. Replace the immediate next action with `Visual Review / Sol Review` and explicitly state Stage 6 was not started.

- [ ] **Step 3: Update AI handoff.**

Update HEAD to the real final SHA, current stage to Stage 3.5.1 complete, ownership map for the new visual layers, telemetry semantics, screenshots, actual environment/backend evidence, known warnings and `Next action = Visual Review / Sol Review`.

- [ ] **Step 4: Inspect the diff and commit.**

Run:

```text
git status
git diff --check
git diff --stat
```

Confirm no cache/browser profile/node_modules/machine config is staged. Commit with:

```text
git commit -m "feat: reconstruct stage 3.5.1 visual composition"
```

- [ ] **Step 5: Re-run final status and report.**

Verify the final SHA, clean/known workspace state and screenshot paths. Stop at `Stage 3.5.1 complete / Awaiting Visual Review / Sol Review`; do not push or begin Stage 6 unless separately requested.

## Plan Self-Review

- Spec coverage is mapped across Tasks 1–8: telemetry correction (1), machine topology (2), GPU field (3), hero form (4), domain redesign and route integration (5), depth/atmosphere/UI (6), two screenshot iterations and backend evidence (7), docs and completion boundary (8).
- No task changes Graph semantic ids, Command ownership, Agent/server code or backend selection.
- The telemetry plan explicitly makes `particleCount` the actual rendered field sample count while exposing configured and active counts separately.
- All visual state changes are defined as route/zone/membership changes before opacity/tone changes.
- Placeholder scan: no TBD/TODO/FIXME instructions are used.
