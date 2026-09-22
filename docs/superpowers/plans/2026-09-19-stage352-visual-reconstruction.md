# Stage 3.5.2 Visual Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the residual "dark graph + boxes + thin lines + dots" read with one large computational structure: layered surfaces, cinematic depth, a semantic routing flowfield, and five local computational domains.

**Architecture:** Keep every ownership seam (`RendererRuntime` backend/quality/lifecycle, `SceneHost` semantic integration, Camera Bus/graph schema, graph reducer, `CameraController`, deterministic descriptors, quality/DPR propagation, truthful telemetry, disposal). Rewrite only the descriptor and view layers, and introduce two shared visual systems that all three surfaces consume: a procedural surface material family and one route-dash signal language.

**Tech Stack:** Next.js 16.3.5, React 19.2, R3F 9.7, Three.js r186, TSL `*NodeMaterial` for WebGPU, built-in materials for WebGL2, TypeScript strict, Vitest 5.

**Spec:** the Stage 3.5.2 brief (user-supplied, `POLNAREFF SYSTEM — Stage 3.5.2 Visual Reconstruction Brief`).

## Global Constraints

- Do not enter Stage 6; no Agent, Ollama, command palette or developer overlay. Do not touch Stages 7–12.
- Preserve: `RendererRuntime` ownership of backend/quality/lifecycle, `SceneHost` as semantic boundary, Command Bus and Graph schema, domain semantic ids, graph reducer/controller, `CameraController` control, deterministic descriptor architecture, quality profile and DPR propagation, truthful telemetry, geometry/material/buffer disposal.
- `ComputeCore` must not import Graph, Command or Agent modules. Graph/Command core must not import Three.js or R3F.
- No per-frame allocation of geometry, materials, buffers or vectors. No CPU per-frame loop over tens of thousands of samples.
- No fabricated hardware telemetry. Reported counts stay derived from real descriptors.
- WebGL2 keeps the same hero silhouette, domain silhouettes, route hierarchy and focus causality at lower density; it is not required to replicate full GPU advection.
- Use `npm.cmd`; do not update dependencies or modify package configuration.
- Every production behaviour change gets a failing pure test first, then the minimal implementation and a focused green run.
- Keep the working tree free of machine-local files. Do not touch the pre-existing uncommitted user changes (`vitest.config.ts`, the capture scripts, and their supporting tests).

## Prohibitions carried from the brief

No global brightening/opacity/scale as the primary fix; no starfields, dust, grid floors, matrix glyphs or nebulae; no more random thin lines or random points filling background; Core must not become a spaceship/engine/reactor/cyberpunk machinery; the five domains must not become five unrelated art styles; no semantically empty shader effects; no Graph/Command/Agent data-model changes to accommodate visual shortcuts.

## Design decisions

1. **Surface material family** (`src/scene/materials/`). Because no external assets exist, the hero structure is parametric and built from primitives, but it must read with mass and internal layering. Orientation-dependent luminance is *baked per box face* into a shared vertex-colour buffer at module load (one geometry, many instanced members), multiplied by per-instance activity colour. Depth attenuation comes from the existing `FogExp2`. Membranes get a real dithered fade via a generated 4×4 Bayer `alphaMap`. A WebGPU-only TSL `MeshBasicNodeMaterial` adds view-dependent edge response; WebGL2 uses a back-face shell to achieve the same read with built-ins.
2. **One signal language** (`src/scene/routing/`). Every route — Core trunk, Core signal, Graph edge — is the same quadratic Bézier descriptor and renders as a stretched luminous dash. WebGPU runs count/phase/life advection in the vertex shader over a ribbon-quad buffer. WebGL2 renders pre-sampled route ribbons plus a bounded CPU-updated instanced dash set (hundreds, not thousands).
3. **Graph edge topology becomes a real route hierarchy**: `Core port → shared trunk → branch → domain ingress`. Idle exposes only the strong primary route; focus reveals the full connection.
4. **Reduced motion is a real input** passed `matchMedia → RendererHost → SceneHost → views`, and it freezes time advance, circulation and camera drift rather than dimming the canvas.
5. **Composition** is choreographed by camera translate/dolly/reframe plus per-surface state weights; the Core group itself does not rotate on focus.

## File Map

**Create**

- `src/scene/materials/machinePalette.ts`: shared luminance/route palette for structure, membrane and signal.
- `src/scene/materials/surfaceGeometry.ts`: shared unit box with baked per-face orientation luminance; Bayer alpha texture singleton.
- `src/scene/materials/surfaceMaterial.ts`: `createSurfaceMaterial()` returning a `node`/`standard` handle implementing the same visual spec.
- `src/scene/materials/surfaceMaterial.test.ts`
- `src/scene/routing/routeDash.ts`: shared route descriptor sampling, dash envelope, and state mapping.
- `src/scene/routing/routeDash.test.ts`
- `src/scene/routing/RouteDashes.tsx`: the dual-backend dash view consumed by Core and Graph.
- `src/scene/routing/graphRoutes.ts`: `Core port → trunk → branch → ingress` route derivation from the graph manifest.
- `src/scene/routing/graphRoutes.test.ts`
- `src/scene/core/coreStructure.ts`: deterministic hero structure descriptor (spine, processing volume, assemblies, membranes, void gaps, ports, foreground slices).
- `src/scene/core/coreStructure.test.ts`
- `src/scene/core/CoreStructureView.tsx`: renders the hero structure with the surface material family.
- `src/scene/graph/domainEnvironments.ts`: per-domain sub-environment descriptors (ingress, internal topology, membrane stack, local field response).
- `src/scene/graph/DomainEnvironment.tsx`: renders one domain sub-environment.
- `scripts/stage352-capture.mjs`: zero-dependency Chrome DevTools Protocol capture harness for the required evidence.

**Rewrite**

- `src/scene/core/coreTopology.ts`, `CoreNucleus.tsx`, `CoreTopologyView.tsx`, `CoreFragments.tsx`
- `src/scene/core/coreField.ts`, `coreFlowMaterial.ts`, `CoreFlowField.tsx`
- `src/scene/core/CoreTrajectoryPaths.tsx`, `CoreSignals.tsx`, `coreTrajectories.ts`
- `src/scene/graph/domainVisuals.ts`, `GraphNode.tsx`, `GraphEdges.tsx`, `KnowledgeGraph.tsx`
- `src/scene/Atmosphere.tsx`, `src/scene/atmosphereDescriptor.ts`
- `src/scene/camera/cameraController.ts` (additive framing only: translate/dolly/reframe)
- `src/config/quality.ts` (additive visual-tier fields)
- `src/ui/RendererStatus.tsx`, `src/ui/statusCopy.ts`, `src/app/globals.css`

**Surgical**

- `src/scene/SceneHost.tsx`: pass `reducedMotion` through; keep semantic wiring.
- `src/renderer/RendererHost.tsx`: read `matchMedia('(prefers-reduced-motion: reduce)')` and pass it down.
- `src/scene/core/ComputeCore.tsx`, `coreParameters.ts`, `coreTypes.ts`: composition, framing and telemetry integration.

**Delete** (merged into the routing system, no remaining references)

- `src/scene/core/coreField`'s point-cloud path is replaced in place, not deleted; `CoreSignals`' spherical pulse is removed outright.

**Docs/evidence**

- `docs/PROJECT_STATUS.md`, `docs/AI_HANDOFF.md`: Stage 3.5.2 closeout.
- `artifacts/stage352-*.png`: overview/hover/focus/escape × WebGPU/WebGL2, plus 2560 and 480 thumbnail.

## Reconciliation: the plan against what shipped

The plan above is the design as written before implementation. Everything it set out to do was delivered; where the shipped code differs, it is because the design was wrong on contact with the renderer. The differences, so a reviewer is not misled by the plan text:

- **"Rewrite" became "replace then delete."** `coreTopology.ts`, `CoreNucleus.tsx`, `CoreTopologyView.tsx`, `CoreFragments.tsx`, `coreField.ts`, `coreFlowMaterial.ts`, `CoreFlowField.tsx`, `CoreTrajectoryPaths.tsx`, `CoreSignals.tsx`, `coreTrajectories.ts`, `coreTelemetry.ts`, `coreResourceLifecycle.ts`, `domainVisuals.ts` and `GraphNode.tsx` were deleted outright, not rewritten. Their replacements are `coreStructure.ts`, `coreStructureGeometry.ts`, `CoreStructureView.tsx`, `coreCirculation.ts`, `src/scene/routing/*`, `src/scene/graph/domainEnvironments.ts`, `domainCircuits.ts` and `DomainEnvironment.tsx`.
- **Design decision 1's dithered membrane is gone.** See Task 2: the Bayer alpha map never rendered, and fixing the channel only exposed aliasing. Membranes blend.
- **Design decision 1's WebGL2 back-face shell was not needed** — once membranes blend, no second pass is required to get their read.
- **Design decision 2's WebGL2 pre-sampled ribbon was not built.** The bounded CPU-driven instanced dash set carries the same signal language, which was the actual requirement.
- **The `slice` material role was folded into `volume`**; the shipped roles are `volume | beam | port | membrane`.
- **`createResourceLease`/`disposeAll` were never built**; each view owns and releases its own resources.
- **`src/scene/core/coreCirculation.ts` is the Core's internal circulation**, distinct from the route dashes in `src/scene/routing/`. The plan did not name it.

---

### Task 1: Reduce motion as a real scene input

**Files:** `src/renderer/RendererHost.tsx`, `src/scene/SceneHost.tsx`, `src/app/globals.css`, `src/renderer/runtime.test.ts`

- [x] Add a `useReducedMotionPreference()` hook reading `matchMedia` with a change listener; pass the value into `SceneHost`.
- [x] Remove the CSS-only `prefers-reduced-motion { opacity }` rule; it masks motion instead of stopping it.
- [x] Freeze time: `coreCirculation`, `CoreStructureView`, `ComputeCore` and `Atmosphere` advance zero time and stop circulation under reduced motion while keeping static route selection and compression shape. (The modules named here in the plan — `CoreFlowField`, `CoreSignals`, `RouteDashes` — were replaced by `coreCirculation` during implementation.)
- [x] Stop perpetual camera drift under reduced motion; keep state transitions short and low-displacement.
- [x] Test: reduced-motion descriptor state reports zero advance and preserves static route selection. Measured in-browser as well: 1.82% of pixels moved over ~3 s normally, 0.00% under reduced motion.

### Task 2: Shared surface material family

**Files:** `src/scene/materials/*`

- [x] Bake per-face orientation luminance into one shared unit-box geometry; expose module-level singleton plus explicit release. (Baked per-face, at build time, into merged vertex colours — `structureGeometry.ts`.)
- [x] ~~Generate a 4×4 Bayer alpha `DataTexture` for dithered membrane fade.~~ **Superseded.** The dither never rendered: three samples an alpha map in the green channel and the map was a single-channel red texture, so every membrane fragment was discarded against a constant zero. Fixing the channel exposed the second half — at ~200 px per world unit a Bayer cell aliases into a visible checkerboard. The membrane is now a genuine bounded blend (`deriveMembraneOpacity`), which is the other half of what the material spec allowed.
- [x] `createSurfaceMaterial({ role, webgpuPreferred, ... })` returning `{ material, backend, updateInput, dispose }` with roles `volume | beam | port | membrane`. (The planned `slice` role was folded into `volume` — a slice is structural, not a distinct physical read.)
- [x] Node path: `MeshBasicNodeMaterial` with a view-edge term driven by a uniform; standard path: equivalent built-in material. (The planned back-face shell support flag was not needed: membranes blend, so no second pass is required.)
- [x] Tests: backend selected from the explicit seam, scalar inputs finite/bounded, dispose idempotent.

### Task 3: Deterministic hero structure descriptor

**Files:** `src/scene/core/coreStructure.ts`, `coreStructure.test.ts`, `coreTopology.ts`

- [x] Emit a diagonal structural spine, one large asymmetric processing volume, 1–2 secondary assemblies, a central void/gap band, route ports with ingress sockets, thin layered membranes, and a small number of foreground slices that the viewport clips.
- [x] Preserve the existing topology contract shape (nodes/edges/regions/routes/activation) so activation tests keep their authority; add structural members and ports. (`deriveCoreTopology` was itself replaced by `coreStructure.ts`; the tests moved with it.)
- [x] Keep budgets derived from quality, keep SAFE semantic, keep determinism, finiteness and asymmetry invariants.

### Task 4: Hero Core view

**Files:** `CoreStructureView.tsx`, `CoreNucleus.tsx`, `CoreTopologyView.tsx`, `CoreFragments.tsx`, `ComputeCore.tsx`

- [x] Render the hero structure at 50–60% of composition, slightly off-centre, first reading as one massed whole with internal layering.
- [x] Remove the transparent-box-stack read; membranes and slices replace it.
- [x] Composition state: idle / hover / focus / escape weights only; no Core rotation on focus.

### Task 5: Semantic routing flowfield

**Files:** `src/scene/routing/*`, `coreField.ts`, `coreFlowMaterial.ts`, `CoreFlowField.tsx`

- [x] Route descriptors carry position, velocity direction, age/lifetime, route identity and compression.
- [x] WebGPU: GPU advection with dashes stretched along velocity; source-to-target burst, route compression zone, ingress accumulation, arrival wake, surface disturbance near the active route. (`routeDashMaterial.ts` node channel.)
- [x] WebGL2: bounded instanced dashes driven on the CPU with the same envelope maths, so the two backends share one signal language rather than one look and one fallback. (The pre-sampled ribbon variant was not needed — the instanced dash carries the read.)
- [x] State behaviour: idle internal low-speed circulation; hover bends toward the target ingress and compresses; focus forms a continuous source-to-target flow; agent_activity reorganises multiple routes. `agent_activity` is a visual state only — no Agent is implemented.
- [x] Remove the spherical Graph pulse and unify the Core signals, Core circulation and Graph routes on the dash language.

### Task 6: Domains as sub-environments

**Files:** `domainEnvironments.ts`, `DomainEnvironment.tsx`, `domainVisuals.ts`, `GraphNode.tsx`, `GraphEdges.tsx`, `KnowledgeGraph.tsx`, `layout.ts`, `graphRoutes.ts`

- [x] AI: trunk forking into a packet buffer. GRAPHICS: layered framebuffer membranes with an interference scan plane. GAME ANALYSIS: comparison branch with a decision chamber. SYSTEMS: stepped processing stack with a vertical bus. RESEARCH: open interference sheet with a lattice and probe endpoint.
- [x] Each domain carries ingress, internal small topology, local field response and state change — not four to six boxes.
- [x] Remap semantic edges to `Core port → shared trunk → branch → domain ingress`; idle exposes few routes, focus reveals all.
- [x] Idle: 2–3 domains medium-visible, rest dormant/dimmed. Hover: target membrane opens, ingress opens, other domains lose presence, one line of copy. Focus GRAPHICS: Core right third, GRAPHICS left third, non-target domains become outlines.

### Task 7: Composition, typography and quality tiers

**Files:** `cameraController.ts`, `Atmosphere.tsx`, `RendererStatus.tsx`, `statusCopy.ts`, `globals.css`, `config/quality.ts`

- [x] Camera focus becomes translate/dolly/reframe; Escape smoothly restores idle framing, brightness and flow without a jump.
- [x] Atmosphere: only low-frequency depth gradient and very weak large-scale structure hints.
- [x] Status compresses to `WEBGPU · ULTRA`; full diagnostics reserved for the future Developer Overlay; reduce small uppercase and wide tracking; labels never dominate composition.
- [x] Quality profiles change *what* is present: SAFE keeps hero silhouette/spine/primary route/domain silhouette; MEDIUM adds main membranes and low-density flow; HIGH adds secondary surfaces and full interaction response; ULTRA adds full GPU advection, trails, surface wake and highest route density. Verified: SAFE vs ULTRA differ by 16.60% (overview) and 17.08% (hover).

### Task 8: Tests, verification and evidence

**Files:** all touched test files, `scripts/stage352-capture.mjs`, `artifacts/stage352-*.png`, `docs/*`

- [x] Update focused Core/graph/telemetry/material tests to the new contracts; never remove behavioural coverage. `npm.cmd test` — 32 files, 237 tests.
- [x] `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd test`, `NEXT_TELEMETRY_DISABLED=1 npm.cmd run build` all pass with the pre-existing user changes untouched.
- [x] Capture with the CDP harness: WebGPU and WebGL2 × overview/hover/focus/escape, 1920×1080 and 2560×1440, plus a 480×270 downscale and a reduced-motion still. 31 `artifacts/stage352-*.png` files — local only, since `.gitignore` excludes `artifacts/`; regenerate with `scripts/stage352-capture.mjs`.
- [x] Console shows no fatal error, NaN, invalid buffer or WebGPU validation error. WebGPU: 34 messages, error 0 / fatal 0. WebGL2: 28 messages, error 0 / fatal 0.
- [x] Update `docs/PROJECT_STATUS.md` and `docs/AI_HANDOFF.md` with real evidence and honest gaps.

## Plan Self-Review

- Boundary safety: no seam in the preserved list is modified; `ComputeCore` gains no Graph/Command/Agent import (the Core learns target direction only through the existing `CameraController` scalar channel plus a locally derived port zone).
- The reduced-motion gap is closed at the source (`matchMedia`), not in CSS.
- Every new GPU/Three resource is owned by the view component that creates it and released from an unmount effect — geometries and each material handle, in `CoreStructureView`, `DomainEnvironmentView`, `RouteDashes` and `Atmosphere`. (The plan named a `createResourceLease`/`disposeAll` pair; that helper was not built, and the per-view ownership above is what actually shipped.)
- Determinism: structure, field, routes and domain environments are pure functions of `(parameters, seed)`; equal inputs produce equal descriptors.
- Honest telemetry: reported field/signal counts derive from the real descriptors and stream draw ranges.

## Post-implementation findings

- The membrane tier rendered nothing at all on both backends. The alpha map was built as a single-channel red texture and three samples an alpha map in the green channel, so every membrane fragment in the scene was discarded against a constant zero. Forcing the alpha test to 0 changed 4.60% of the frame (95,407 px), which is the proof it had been drawing nothing. Replaced with a bounded blend — see Task 2.
- `Atmosphere` diverged by backend on the depth backdrop: (2,3,3) on the node path against a scene background of (5,6,9). It no longer branches on backend and now matches WebGL2 on both.
- **Unresolved:** the WebGPU node material path renders the machine's mid-tones darker than the standard path. Same frame at (1152,497): WebGPU 83 against WebGL2 143. Forcing the standard path on WebGPU reproduces the WebGL2 histogram to within 1–2 levels (p50 28/26, p90 70/69, p99 156/155, p99.9 219/208), which localises it inside the node material path rather than in the renderer's output transform, fog or colour management. Documented, not fixed.
