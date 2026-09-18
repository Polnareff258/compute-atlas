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
