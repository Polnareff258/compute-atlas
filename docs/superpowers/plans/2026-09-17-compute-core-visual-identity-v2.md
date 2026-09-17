# Compute Core Visual Identity V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the spherical Compute Core visual identity with a deterministic asymmetric computational topology whose structure, field and paths respond to visual state on WebGPU and WebGL2.

**Architecture:** Keep `ComputeCore` as the composition and interaction boundary. Move all new topology, field and trajectory math into pure deterministic generators; render those descriptors through reusable R3F/Three resources. Use a TSL/NodeMaterial GPU displacement path for the field with a shared precomputed WebGL2 fallback, while preserving `SceneHost`, `CameraController`, `QualityProfile`, telemetry, Graph and Command Bus boundaries.

**Tech Stack:** Next.js 16.3.5, React 19, TypeScript strict, Three.js r186, React Three Fiber 9, TSL/NodeMaterial, Vitest, existing WebGPU-first/WebGL2 fallback adapters.

**Spec:** `docs/superpowers/specs/2026-09-17-compute-core-visual-identity-v2-design.md`

## Global Constraints

- The dominant silhouette must not read as a central glowing sphere/cloud, recognizable icosahedron shell, uniform spherical particle boundary or three closed torus rings.
- The composition must retain a clear primary anchor, secondary regions, directional paths, field behavior and intentional negative space.
- Hover, focus and activity must change structure, path activation, flow direction, local density or fragment relationships before relying on opacity/color changes.
- `ComputeCore` must not import Graph, Commands, Agent, Ollama or DOM state.
- Preserve `ComputeCoreVisualState`: `dormant`, `awakening`, `idle`, `hover_response`, `focusing`, `agent_activity`.
- Preserve WebGPU-first selection and WebGL2 fallback; do not recreate the renderer or rewrite backend selection.
- Do not use `ShaderMaterial` for the new field. Use TSL/NodeMaterial where supported and a coherent precomputed fallback otherwise.
- Do not create per-particle React nodes, CPU-update 70k particles each frame, allocate arrays/vectors inside hot loops or recreate materials each frame.
- SAFE must preserve the same non-spherical identity while reducing field/topology/fragment/trajectory detail.
- Do not implement Command Palette, parser, Ollama, Agent Gateway, SSE, Agent Trace, Developer Overlay, Stage 11 performance tuning or Stage 12 final polish.
- Every production function added in this plan gets a failing test before implementation, unless it is a thin R3F view wrapper whose behavior is verified through pure descriptor tests and browser inspection.
- Completion requires focused tests, full tests, lint, strict typecheck, production build, WebGPU screenshots, WebGL2 screenshots and actual `view_image` silhouette inspection.

---

## File map and ownership

Create these pure data modules:

- `src/scene/core/coreTopology.ts` — deterministic anchor/satellite nodes and partial topology edges.
- `src/scene/core/coreTopology.test.ts` — topology determinism, finiteness, bounded connectivity and non-shell assertions.
- `src/scene/core/coreField.ts` — deterministic non-uniform field attributes and region descriptors.
- `src/scene/core/coreField.test.ts` — field determinism, finite attributes, void/stream distribution and quality scaling.
- `src/scene/core/coreTrajectories.ts` — deterministic partial paths and activation metadata.
- `src/scene/core/coreTrajectories.test.ts` — finite paths, varied endpoints, no default closed loops and deterministic output.

Create these visual modules:

- `src/scene/core/CoreNucleus.tsx` — compact irregular nucleus.
- `src/scene/core/CoreTopology.tsx` — instanced/merged node topology and bounded edge activation.
- `src/scene/core/CoreFragments.tsx` — asymmetric local membranes/fragments.
- `src/scene/core/CoreFlowField.tsx` — reusable point field with TSL GPU path and WebGL2-compatible fallback.
- `src/scene/core/CoreTrajectories.tsx` — broken path rendering and state-driven route activation.
- `src/scene/core/CoreSignals.tsx` — bounded directional signal propagation.
- `src/scene/core/coreMaterials.ts` — low-saturation palette and material factories; no per-frame material creation.

Modify these existing modules:

- `src/scene/core/coreTypes.ts` — add serializable `CoreVisualInput` and V2 descriptor types without Graph/Agent references.
- `src/scene/core/coreParameters.ts` — map quality profiles to V2 budgets.
- `src/scene/core/coreParameters.test.ts` — update budget assertions for V2 names and monotonicity.
- `src/scene/core/ComputeCore.tsx` — compose V2 modules and provide one stable visual input/frame-loop seam.
- `src/scene/SceneHost.tsx` — only if V2 needs an existing semantic scalar passed through; no Graph imports inside Core.
- `src/renderer/RendererHost.tsx` or a focused renderer helper only if browser material support requires a verified compatibility seam.
- `docs/PROJECT_STATUS.md`, `docs/AI_HANDOFF.md`, `docs/superpowers/plans/2026-09-17-polnareff-system-phase1.md` — record Stage 3.5 only after browser evidence.

Remove the V1 component files after V2 integration and visual verification proves no consumer remains:

- `src/scene/core/CoreSeed.tsx`
- `src/scene/core/CoreCage.tsx`
- `src/scene/core/CoreEnergyField.tsx`
- `src/scene/core/CoreParticleShell.tsx`
- `src/scene/core/CoreOrbitals.tsx`

`src/scene/Atmosphere.tsx` is not part of the ComputeCore composition and must not be changed unless a browser audit proves it is mounted in the current scene and contributes a duplicated V1 sphere/ring silhouette.

---

### Task 1: Freeze V2 parameter and interaction contracts

**Files:**
- Modify: `src/scene/core/coreTypes.ts`
- Modify: `src/scene/core/coreParameters.ts`
- Test: `src/scene/core/coreParameters.test.ts`

**Interfaces:**

```ts
export type CoreVisualInput = {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly focusX: number;
  readonly focusY: number;
  readonly focusZ: number;
  readonly intensity: number;
  readonly visualState: ComputeCoreVisualState;
  readonly reducedMotion: boolean;
};

export type CoreParameters = {
  readonly profile: QualityProfile;
  readonly particleBudget: number;
  readonly topologyNodeBudget: number;
  readonly topologyEdgeBudget: number;
  readonly fragmentBudget: number;
  readonly trajectoryBudget: number;
  readonly fieldResolution: number;
  readonly allowBloom: boolean;
};
```

- [ ] **Step 1: Write failing parameter tests.** Replace V1-only `shellRadius`, `cageSegments` and `orbitalCount` assertions with exact assertions that all five semantic budgets are finite, positive and monotonic `ultra >= high >= medium >= safe`. Add a test that SAFE budgets remain non-zero for topology, fragments, trajectories and field detail.
- [ ] **Step 2: Run focused tests to verify RED.**

  Run: `npm exec vitest run src/scene/core/coreParameters.test.ts`

  Expected: FAIL because the V1 parameter contract does not expose the V2 budget fields.
- [ ] **Step 3: Implement the smallest parameter mapping.** Use existing `QualitySettings` values as the source of truth; derive V2 budgets from `coreParticleBudget`, `coreFieldResolution`, `graphDensity` and the existing profile ordering. Keep the values deterministic and do not add new quality profiles.
- [ ] **Step 4: Run focused tests to verify GREEN.**

  Run: `npm exec vitest run src/scene/core/coreParameters.test.ts`

  Expected: all parameter tests pass.
- [ ] **Step 5: Commit the contract.**

  ```text
  git add src/scene/core/coreTypes.ts src/scene/core/coreParameters.ts src/scene/core/coreParameters.test.ts
  git commit -m "refactor: define compute core v2 budgets"
  ```

### Task 2: Implement deterministic anchor topology data

**Files:**
- Create: `src/scene/core/coreTopology.ts`
- Test: `src/scene/core/coreTopology.test.ts`

**Interfaces:**

```ts
export type CoreTopologyNode = {
  readonly id: number;
  readonly position: readonly [number, number, number];
  readonly weight: number;
  readonly region: 'anchor' | 'satellite' | 'route';
};

export type CoreTopologyEdge = {
  readonly id: number;
  readonly source: number;
  readonly target: number;
  readonly activationRank: number;
  readonly route: 'local' | 'directional' | 'signal';
};

export type CoreTopology = {
  readonly nodes: readonly CoreTopologyNode[];
  readonly edges: readonly CoreTopologyEdge[];
};

export function deriveCoreTopology(
  parameters: Pick<CoreParameters, 'topologyNodeBudget' | 'topologyEdgeBudget'>,
  seed?: number,
): CoreTopology;
```

- [ ] **Step 1: Write failing topology tests.** Test equal inputs produce deep-equal JSON; every position/weight is finite; node IDs are unique; edge indices are valid; no self-edge exists; edge count never exceeds the budget; at least one anchor and one satellite region exist; and the graph does not contain a complete shell by asserting edge count is below the complete graph count and each node is not forced to have shell-like degree.
- [ ] **Step 2: Run the topology tests and verify RED.**

  Run: `npm exec vitest run src/scene/core/coreTopology.test.ts`

  Expected: FAIL because the generator does not exist.
- [ ] **Step 3: Implement deterministic seeded points.** Use a small integer hash/low-discrepancy sequence with a fixed seed, explicitly place the primary anchor cluster first, then place bounded asymmetric satellites in different elevations/depths. Select nearest/bounded connections with deterministic tie-breaking and a strict edge budget. Do not use `Math.random()`.
- [ ] **Step 4: Run the topology tests and verify GREEN.**

  Run: `npm exec vitest run src/scene/core/coreTopology.test.ts`

  Expected: all topology tests pass.
- [ ] **Step 5: Commit the pure topology slice.**

  ```text
  git add src/scene/core/coreTopology.ts src/scene/core/coreTopology.test.ts
  git commit -m "feat: add deterministic compute core topology"
  ```

### Task 3: Implement deterministic non-uniform field data

**Files:**
- Create: `src/scene/core/coreField.ts`
- Test: `src/scene/core/coreField.test.ts`

**Interfaces:**

```ts
export type CoreFieldAttributes = {
  readonly positions: Float32Array;
  readonly drift: Float32Array;
  readonly phase: Float32Array;
  readonly region: Float32Array;
  readonly weight: Float32Array;
};

export type CoreFieldDescriptor = {
  readonly attributes: CoreFieldAttributes;
  readonly bounds: readonly [number, number, number];
  readonly streamCount: number;
};

export function deriveCoreField(
  parameters: Pick<CoreParameters, 'particleBudget' | 'fieldResolution'>,
  seed?: number,
): CoreFieldDescriptor;
```

- [ ] **Step 1: Write failing field tests.** Test deterministic typed-array contents, exact attribute lengths, finite values, bounded coordinates, more than one occupied region, non-zero void proportion and stream count greater than zero. Test that SAFE has fewer field samples than ULTRA while remaining non-empty.
- [ ] **Step 2: Run the field tests and verify RED.**

  Run: `npm exec vitest run src/scene/core/coreField.test.ts`

  Expected: FAIL because the generator does not exist.
- [ ] **Step 3: Implement the static field distribution.** Generate multiple deterministic ribbons/clusters with different widths, anchor attraction and directional bias. Reserve explicit void bands so the field has no spherical outer boundary. Store all hot-loop inputs in typed arrays; do not update the arrays in JavaScript per frame.
- [ ] **Step 4: Run the field tests and verify GREEN.**

  Run: `npm exec vitest run src/scene/core/coreField.test.ts`

  Expected: all field tests pass.
- [ ] **Step 5: Commit the pure field slice.**

  ```text
  git add src/scene/core/coreField.ts src/scene/core/coreField.test.ts
  git commit -m "feat: add deterministic compute core field data"
  ```

### Task 4: Implement broken trajectory data

**Files:**
- Create: `src/scene/core/coreTrajectories.ts`
- Test: `src/scene/core/coreTrajectories.test.ts`

**Interfaces:**

```ts
export type CoreTrajectory = {
  readonly id: number;
  readonly points: readonly (readonly [number, number, number])[];
  readonly activationRank: number;
  readonly route: 'dormant' | 'local' | 'directional' | 'signal';
};

export function deriveCoreTrajectories(
  parameters: Pick<CoreParameters, 'trajectoryBudget'>,
  seed?: number,
): readonly CoreTrajectory[];
```

- [ ] **Step 1: Write failing trajectory tests.** Test deterministic JSON, finite points, at least two distinct trajectory lengths, varied start/end positions, explicit non-zero endpoints and no trajectory whose sampled path is a closed loop. Test SAFE returns fewer paths but at least one.
- [ ] **Step 2: Run the trajectory tests and verify RED.**

  Run: `npm exec vitest run src/scene/core/coreTrajectories.test.ts`

  Expected: FAIL because the generator does not exist.
- [ ] **Step 3: Implement partial path sampling.** Use deterministic control points and a bounded quadratic/cubic interpolation helper. Generate arcs with visible start/end gaps and activation ranks. Keep path samples finite and small enough for merged line geometry.
- [ ] **Step 4: Run the trajectory tests and verify GREEN.**

  Run: `npm exec vitest run src/scene/core/coreTrajectories.test.ts`

  Expected: all trajectory tests pass.
- [ ] **Step 5: Commit the pure trajectory slice.**

  ```text
  git add src/scene/core/coreTrajectories.ts src/scene/core/coreTrajectories.test.ts
  git commit -m "feat: add broken compute core trajectories"
  ```

### Task 5: Add the renderer-compatible field material seam

**Files:**
- Create: `src/scene/core/coreFlowMaterial.ts`
- Test: `src/scene/core/coreFlowMaterial.test.ts`
- Modify: `src/scene/core/coreMaterials.ts`

**Interfaces:**

```ts
export type CoreFlowMaterialConfig = {
  readonly color: string;
  readonly pointSize: number;
  readonly webgpuPreferred: boolean;
};

export type CoreFlowMaterialHandle = {
  readonly material: THREE.Material;
  readonly backend: 'node' | 'standard';
  readonly updateInput: (input: CoreVisualInput, elapsedSeconds: number) => void;
  readonly dispose: () => void;
};

export function createCoreFlowMaterial(
  config: CoreFlowMaterialConfig,
): CoreFlowMaterialHandle;
```

- [ ] **Step 1: Inspect the installed Three.js exports before coding.** Verify r186 exposes `three/tsl` functions including `attribute`, `float`, `time`, `positionLocal`, `vec3`, `Fn`, and a point NodeMaterial with `positionNode`; verify the WebGL2 build can construct the selected NodeMaterial or document the standard material fallback in the test/implementation comments. Do not add a new dependency.
- [ ] **Step 2: Write failing material contract tests.** Test that the factory returns a material, identifies `node` or `standard`, has an idempotent `updateInput`, and disposes the material. Test that both backend selections produce a usable handle without `ShaderMaterial`.
- [ ] **Step 3: Run focused tests to verify RED.**

  Run: `npm exec vitest run src/scene/core/coreFlowMaterial.test.ts`

  Expected: FAIL because the factory does not exist.
- [ ] **Step 4: Implement the factory.** Build the TSL path from precomputed attributes and time-driven bounded displacement. Feed pointer/focus/intensity/activity as scalar uniform nodes or stable material inputs. Return a standard `PointsMaterial` fallback with the same precomputed field positions when NodeMaterial cannot be used on the active renderer. Keep material creation outside the frame loop.
- [ ] **Step 5: Run focused tests to verify GREEN.**

  Run: `npm exec vitest run src/scene/core/coreFlowMaterial.test.ts`

  Expected: all material contract tests pass with no `ShaderMaterial` construction.
- [ ] **Step 6: Commit the compatibility seam.**

  ```text
  git add src/scene/core/coreFlowMaterial.ts src/scene/core/coreFlowMaterial.test.ts src/scene/core/coreMaterials.ts
  git commit -m "feat: add compatible compute core flow material"
  ```

### Task 6: Build nucleus, topology and fragment views

**Files:**
- Create: `src/scene/core/CoreNucleus.tsx`
- Create: `src/scene/core/CoreTopology.tsx`
- Create: `src/scene/core/CoreFragments.tsx`
- Modify: `src/scene/core/coreMaterials.ts`

**Interfaces:**

```ts
type CoreStructuralViewProps = {
  readonly topology: CoreTopology;
  readonly visualInput: CoreVisualInput;
  readonly reducedMotion: boolean;
};

export function CoreNucleus(props: CoreStructuralViewProps): JSX.Element;
export function CoreTopology(props: CoreStructuralViewProps): JSX.Element;
export function CoreFragments(props: CoreStructuralViewProps): JSX.Element;
```

- [ ] **Step 1: Add pure activation tests before visual implementation.** In `coreTopology.test.ts`, add a `deriveCoreTopologyActivation(input)` assertion that idle activates a sparse baseline, hover activates a local branch, focus activates a directional route and agent activity activates more than one route. Assert active edge IDs change between states, not only scalar opacity.
- [ ] **Step 2: Run the topology suite and verify RED.**

  Run: `npm exec vitest run src/scene/core/coreTopology.test.ts`

  Expected: FAIL because state-dependent activation is not yet defined.
- [ ] **Step 3: Implement the activation function and views.** Keep activation deterministic from edge `activationRank` and `CoreVisualInput.visualState`. Render topology nodes through reusable instancing or merged geometry; render edges through bounded line buffers. Place fragments as offset planes/short line membranes, never as a shell. The nucleus must be compact and subordinate.
- [ ] **Step 4: Run the topology suite and focused typecheck.**

  Run: `npm exec vitest run src/scene/core/coreTopology.test.ts; npm run typecheck`

  Expected: activation tests pass and TypeScript remains strict.
- [ ] **Step 5: Commit the structural visual slice.**

  ```text
  git add src/scene/core/CoreNucleus.tsx src/scene/core/CoreTopology.tsx src/scene/core/CoreFragments.tsx src/scene/core/coreTopology.ts src/scene/core/coreTopology.test.ts src/scene/core/coreMaterials.ts
  git commit -m "feat: render asymmetric compute core structure"
  ```

### Task 7: Build the GPU flow field

**Files:**
- Create: `src/scene/core/CoreFlowField.tsx`
- Modify: `src/scene/core/coreField.ts`
- Modify: `src/scene/core/coreField.test.ts`

**Interfaces:**

```ts
type CoreFlowFieldProps = {
  readonly descriptor: CoreFieldDescriptor;
  readonly parameters: CoreParameters;
  readonly visualInput: CoreVisualInput;
};

export function CoreFlowField(props: CoreFlowFieldProps): JSX.Element;
```

- [ ] **Step 1: Add a field-state mapping test.** Assert that `idle`, `hover_response` and `focusing` produce distinct directional bias/activity inputs, and that `agent_activity` increases active stream count without changing the deterministic base attribute arrays.
- [ ] **Step 2: Run the field suite and verify RED.**

  Run: `npm exec vitest run src/scene/core/coreField.test.ts`

  Expected: FAIL because the field state mapping does not exist.
- [ ] **Step 3: Implement the R3F field view.** Build one `BufferGeometry` from the descriptor, attach position/drift/phase/region/weight attributes, create the `CoreFlowMaterialHandle` once with `useMemo`, and update only stable scalar inputs in `useFrame`. Use TSL displacement for the preferred path; use the standard fallback material if construction fails or WebGL2 selects the compatible path. Do not rotate the entire field as a sphere.
- [ ] **Step 4: Run field tests, typecheck and focused build compilation.**

  Run: `npm exec vitest run src/scene/core/coreField.test.ts; npm run typecheck`

  Expected: field state tests pass and no type errors occur.
- [ ] **Step 5: Commit the flow field slice.**

  ```text
  git add src/scene/core/CoreFlowField.tsx src/scene/core/coreField.ts src/scene/core/coreField.test.ts
  git commit -m "feat: add gpu-first compute core flow field"
  ```

### Task 8: Build broken trajectories and signals

**Files:**
- Create: `src/scene/core/CoreTrajectories.tsx`
- Create: `src/scene/core/CoreSignals.tsx`
- Modify: `src/scene/core/coreTrajectories.ts`
- Modify: `src/scene/core/coreTrajectories.test.ts`

**Interfaces:**

```ts
type CoreTrajectoryViewProps = {
  readonly trajectories: readonly CoreTrajectory[];
  readonly visualInput: CoreVisualInput;
  readonly reducedMotion: boolean;
};

export function CoreTrajectories(props: CoreTrajectoryViewProps): JSX.Element;
export function CoreSignals(props: CoreTrajectoryViewProps): JSX.Element;
```

- [ ] **Step 1: Add state-dependent trajectory tests.** Assert idle activates only dormant/local ranks, hover activates a local route, focus activates a directional route, and agent activity activates multiple signal ranks. Assert the point data remains stable while active IDs change.
- [ ] **Step 2: Run the trajectory suite and verify RED.**

  Run: `npm exec vitest run src/scene/core/coreTrajectories.test.ts`

  Expected: FAIL because state activation is not yet defined.
- [ ] **Step 3: Implement merged line paths.** Render all trajectory samples through reusable line geometry. Use stable scalar progress and segment activation; show signal movement by changing active segment range or a bounded signal point along an existing path. Do not create a mesh per signal particle and do not close the paths.
- [ ] **Step 4: Run the trajectory suite and typecheck.**

  Run: `npm exec vitest run src/scene/core/coreTrajectories.test.ts; npm run typecheck`

  Expected: all trajectory tests pass.
- [ ] **Step 5: Commit the path slice.**

  ```text
  git add src/scene/core/CoreTrajectories.tsx src/scene/core/CoreSignals.tsx src/scene/core/coreTrajectories.ts src/scene/core/coreTrajectories.test.ts
  git commit -m "feat: add directional compute core trajectories"
  ```

### Task 9: Compose V2 in ComputeCore and remove V1 visual layers

**Files:**
- Modify: `src/scene/core/ComputeCore.tsx`
- Modify: `src/scene/core/coreTypes.ts`
- Delete after import audit: `src/scene/core/CoreSeed.tsx`
- Delete after import audit: `src/scene/core/CoreCage.tsx`
- Delete after import audit: `src/scene/core/CoreEnergyField.tsx`
- Delete after import audit: `src/scene/core/CoreParticleShell.tsx`
- Delete after import audit: `src/scene/core/CoreOrbitals.tsx`
- Modify only if required: `src/scene/SceneHost.tsx`

**Interfaces:**

```ts
export type ComputeCoreProps = {
  readonly quality: QualityProfile;
  readonly backend: RendererBackend;
  readonly reducedMotion?: boolean;
  readonly onTelemetry?: (snapshot: RendererTelemetrySnapshot) => void;
  readonly cameraController?: CameraController;
  readonly visualState?: ComputeCoreVisualState | null;
};
```

- [ ] **Step 1: Add an integration test for visual input derivation.** Test that the existing camera controller scalar values and visual state produce finite `CoreVisualInput`, that hover/focus change intensity/state, and that no GraphNodeId or Command type is required.
- [ ] **Step 2: Run the Core tests and verify RED.**

  Run: `npm exec vitest run src/scene/core/coreParameters.test.ts src/scene/core/coreTopology.test.ts src/scene/core/coreField.test.ts src/scene/core/coreTrajectories.test.ts`

  Expected: the new composition/integration assertions fail before V2 is wired.
- [ ] **Step 3: Replace the V1 composition.** Memoize topology, field and trajectory descriptors by V2 parameters; derive the scalar input from existing controller getters; compose `CoreNucleus`, `CoreTopology`, `CoreFragments`, `CoreFlowField`, `CoreTrajectories` and `CoreSignals`. Keep one frame loop for elapsed time, controller update, visual input scalars and telemetry. Remove all V1 components from the mounted tree.
- [ ] **Step 4: Audit imports before deleting V1 files.**

  Run: `rg -n "CoreSeed|CoreCage|CoreEnergyField|CoreParticleShell|CoreOrbitals" src tests`

  Expected: only the V1 files and their now-obsolete references are found; no Graph, Command or Agent file references them.
- [ ] **Step 5: Delete the unused V1 visual files and update R3F registrations.** Remove `IcosahedronGeometry`/`TorusGeometry` registrations from `SceneHost` only when no remaining mounted scene uses them. Preserve registrations used by Graph nodes or other scenes.
- [ ] **Step 6: Run all Core tests, lint and typecheck.**

  Run: `npm exec vitest run src/scene/core; npm run lint; npm run typecheck`

  Expected: all Core tests pass with no lint/type errors.
- [ ] **Step 7: Commit the V2 composition.**

  ```text
  git add src/scene/core src/scene/SceneHost.tsx
  git commit -m "feat: compose compute core visual identity v2"
  ```

### Task 10: Browser validation and silhouette iteration

**Files:**
- Create: `artifacts/stage35-core-v2-overview-webgpu.png`
- Create: `artifacts/stage35-core-v2-hover-webgpu.png`
- Create: `artifacts/stage35-core-v2-focused-webgpu.png`
- Create when fallback is available: `artifacts/stage35-core-v2-overview-webgl2.png`, `artifacts/stage35-core-v2-hover-webgl2.png`, `artifacts/stage35-core-v2-focused-webgl2.png`
- Modify only for verified defects: V2 visual modules or `src/scene/SceneHost.tsx`

- [ ] **Step 1: Run focused browser build prerequisites.** Run `npm run lint`, `npm run typecheck`, `npm test` and `NEXT_TELEMETRY_DISABLED=1 npm run build` before starting the browser.
- [ ] **Step 2: Start the local dev server.** Run `NEXT_TELEMETRY_DISABLED=1 npm run dev -- --hostname 127.0.0.1` and use `?boot=skip` for repeatable scene inspection.
- [ ] **Step 3: Verify WebGPU at 1920×1080.** Confirm actual backend is WebGPU, no uncaught exception or new material warning occurs, Graph remains visible, pointer parallax remains restrained and Core overview is structurally legible.
- [ ] **Step 4: Capture overview, hover and focused screenshots.** Use CDP screenshot capture, then inspect each image with `view_image`. Ignore UI copy during the first pass and judge only silhouette/hierarchy.
- [ ] **Step 5: Run the silhouette checklist.** Reject and iterate if the image reads primarily as a ball/cloud, random scatter, closed ring system, uniform sphere or all-over rotation. Confirm anchor, satellites, paths, field voids and negative space are visible.
- [ ] **Step 6: Verify structure-changing interactions.** Confirm hover activates a local branch or flow bias, focus activates a directional path/framing change and agent_activity can be exercised through an internal visual-state test seam only if one already exists. Do not add Agent or UI work for this check.
- [ ] **Step 7: Verify 2560×1440 WebGPU when available.** Confirm the primary anchor and graph remain inside the frame, labels are readable and no trajectory/fragment clipping changes the hierarchy.
- [ ] **Step 8: Verify WebGL2 fallback.** Repeat overview/hover/focus capture with the existing fallback method. Confirm the silhouette remains asymmetric and coherent even if field detail is reduced.
- [ ] **Step 9: If the silhouette fails, return to Tasks 6–9.** Change structure/data/activation relationships, not only colors or opacity. Re-run the relevant focused tests and browser screenshots after every visual correction.

### Task 11: Documentation, audit, commit and push

**Files:**
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/AI_HANDOFF.md`
- Modify: `docs/superpowers/plans/2026-09-17-polnareff-system-phase1.md`

- [ ] **Step 1: Run the final verification commands.**

  ```text
  npm exec vitest run src/scene/core
  npm run lint
  npm run typecheck
  npm test
  NEXT_TELEMETRY_DISABLED=1 npm run build
  ```

  Record exact test counts, backend results, screenshot paths and known non-fatal browser warnings. Do not claim FPS/GPU utilization without a real measurement.
- [ ] **Step 2: Run the dependency boundary audit.** Confirm `ComputeCore` imports no Graph/Command/Agent, pure core generators import no Three.js, and no Command Palette/Ollama files were added.
- [ ] **Step 3: Update project status.** Add `Stage 3.5 — Compute Core Visual Identity V2 = Complete` only after the silhouette checklist passes. Record V1→V2 changes, renderer results, tests, screenshots and remaining visual weaknesses. Keep Stage 6 pending.
- [ ] **Step 4: Update AI handoff.** Add the current stage, V2 module map, ownership boundaries, verification evidence and any real debt. Do not paste source code or claim a performance pass.
- [ ] **Step 5: Append the Stage 3.5 implementation record to the Phase 1 plan.** Do not rewrite Stage 0–5.1 history.
- [ ] **Step 6: Commit documentation.**

  ```text
  git add docs/PROJECT_STATUS.md docs/AI_HANDOFF.md docs/superpowers/plans/2026-09-17-polnareff-system-phase1.md artifacts/stage35-core-v2-*.png
  git commit -m "docs: close compute core visual identity v2"
  ```
- [ ] **Step 7: Push through v2rayN and verify remote state.**

  ```text
  git -c http.proxy=socks5://127.0.0.1:10808 push origin master
  git status --short
  git log --oneline -5
  ```

  Expected: push succeeds, working tree is clean, Stage 6 remains the next stage and no later-stage feature is present.

## Rollback points

- Before Task 2: only parameter contract changes exist; revert the parameter commit to restore the V1 Core contract.
- Before Task 5: pure descriptors can be reviewed independently without touching the scene.
- Before Task 9: all new visual modules can be removed while V1 files remain intact.
- Before Task 10: V2 is mounted but not documented complete; use the last composition commit to compare/revert the visual system.
- Never use `git reset --hard`; revert a specific local commit if a completed slice must be backed out.

## Plan self-review

- Spec coverage: composition hierarchy is covered by Tasks 2, 6 and 10; structure-changing state is covered by Tasks 6–8; silhouette-first browser review is covered by Task 10; WebGPU/WebGL2 and SAFE identity are covered by Tasks 5, 7 and 10; docs and Stage 6 boundary are covered by Task 11.
- Boundary audit: pure generators do not depend on Three.js; ComputeCore remains the only visual composition owner; SceneHost/CameraController/RendererRuntime contracts remain stable.
- Placeholder scan: no TBD/TODO/“implement later” steps are used; conditional TSL compatibility is an explicit tested material seam with a defined standard fallback.
- Type consistency: `CoreParameters`, `CoreTopology`, `CoreFieldDescriptor`, `CoreTrajectory`, `CoreVisualInput` and all view prop names are defined before later tasks consume them.
- Visual acceptance: tests alone cannot close Stage 3.5; actual screenshots and `view_image` silhouette inspection are mandatory.
