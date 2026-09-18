# Task 7 — GPU Flow Field

## Status

Complete locally; committed after the verification recorded below. This slice is not mounted in `ComputeCore` yet and does not claim browser, WebGPU build/link, or fallback visual verification.

## TDD

- RED: `npm exec vitest run src/scene/core/coreField.test.ts` ran before `deriveCoreFieldState` existed. The new mapping tests failed as expected with `TypeError: deriveCoreFieldState is not a function`; existing descriptor tests remained green (10 passed, 3 failed).
- GREEN: after implementing the pure mapping and field view, the same focused suite passed 13/13.

## Changes

- `src/scene/core/coreField.ts`
  - Added the serializable `CoreFieldState` contract and deterministic `deriveCoreFieldState`.
  - Idle, hover response, focus, and agent activity now produce bounded direction/activity controls; agent activity selects up to three existing streams without mutating descriptor arrays.
- `src/scene/core/coreField.test.ts`
  - Added deterministic state-difference, immutable descriptor, agent stream-count, finite/bounded and JSON-serializable state tests.
- `src/scene/core/CoreFlowField.tsx`
  - Added an unmounted R3F view that constructs one indexed `BufferGeometry` from the descriptor with `position`, `coreDrift`, `corePhase`, `coreRegion`, and `coreWeight` attributes.
  - Reorders static point indices once by stream, then changes only draw range and material scalar input per visual-state update.
  - Uses the existing material-handle seam, a Task 6-style resource lease, and a frame loop that updates only stable input plus elapsed time.

## Verification

Fresh command run before commit:

```text
npm exec vitest run src/scene/core/coreField.test.ts  -> 1 file, 13 passed
npm run typecheck                                  -> exit 0
npm run lint                                       -> exit 0
git diff --check                                   -> exit 0
```

## Boundary check

- No `ComputeCore.tsx` or `SceneHost.tsx` modification; Task 7 does not mount the new field.
- No Graph, Command, Agent, Palette, Ollama, SSE, telemetry, renderer-selection, or `ShaderMaterial` code was introduced.
- `CoreFieldDescriptor` stays Three-free and its base typed arrays are never written by state mapping or the frame loop.
- `CoreFlowField` does not inspect renderer capability. It requests the existing preferred material path; the material factory retains its synchronous fallback behavior. The renderer-selected WebGL2 material path remains an integration concern for the later mount/browser gate.

## Concerns / deferred verification

- Actual R3F mounting, WebGPU shader build/link, WebGL2 fallback selection, and silhouette verification are intentionally deferred to Task 9/10. This task supplies the deterministic geometry and lifecycle seam only.
- Field point count and stream selection are quality-derived but have not received a Stage 11 performance measurement.

## Review fix round 1

### Status

Addressed both Important findings from the Task 7 review. The fix is limited to the existing Task 7 view/test scope and is not mounted into ComputeCore.

### TDD evidence

- RED: after adding the review tests, `npm exec vitest run src/scene/core/coreField.test.ts` reported 16 tests with 3 failures: WebGL2 incorrectly returned `node`, `deriveCoreFlowFieldIndex` was absent, and the dependent stream-visibility test could not run.
- GREEN: after the implementation, the focused suite passed 16/16.

### Finding 1 — backend/material seam

- Extended `CoreFlowFieldProps` with `backend: RendererBackend`.
- `createCoreFlowFieldResources` now receives the backend from its caller; it does not inspect renderer state.
- `backend === 'webgpu'` requests the existing `PointsNodeMaterial` path. `webgl2` and `unavailable` request the existing standard material path.
- Added a resource test proving all three backend choices.
- This prop extension is intentional: the original Task 7 prop omitted the renderer-owned backend, so a future ComputeCore composition could not select WebGL2 without adding forbidden capability detection inside the field view. ComputeCore/SceneHost remain unchanged in this fix.

### Finding 2 — void/index contract

- Added `deriveCoreFlowFieldIndex`, a one-time deterministic static index builder.
- Samples are ordered by stream and only weights `> 0` enter the index; zero-weight void samples remain in all descriptor arrays but cannot be drawn.
- Added `streamOffsets` and `deriveCoreFlowFieldDrawCount` so `activeStreamCount` changes the visible stream prefix without per-frame filtering, typed-array construction, or Three.js allocation.
- Added tests for exact zero-weight exclusion, preserved stream order, draw-range counts, agent stream expansion, and unchanged base arrays.

### Verification

Fresh final run before commit:

```text
npm exec vitest run src/scene/core/coreField.test.ts  -> 1 file, 16 passed
npm run typecheck                                  -> exit 0
npm run lint                                       -> exit 0
git diff --check                                   -> exit 0
```

The focused test process still emits the existing Three CJS deprecation warning caused by the R3F/Three import path; it is not a test failure or lint/typecheck diagnostic.

### Boundary check

- Changed only `src/scene/core/CoreFlowField.tsx` and `src/scene/core/coreField.test.ts` in this fix round; no `ComputeCore.tsx`, `SceneHost.tsx`, renderer architecture, `coreFlowMaterial.ts`, Graph, Command, Agent, or Stage 8/9 code was changed.
- Backend ownership remains with the caller; field code only consumes the typed backend value.
- Descriptor arrays remain immutable; void visibility is represented by the static index contract.