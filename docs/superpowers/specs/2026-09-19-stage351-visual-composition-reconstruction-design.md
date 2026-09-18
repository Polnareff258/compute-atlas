# Stage 3.5.1 — Visual Composition Reconstruction

**Date:** 2026-09-19  
**Status:** Draft for user review  
**Product:** POLNAREFF SYSTEM  
**Repository:** `Polnareff258/compute-atlas`  
**Slice:** Corrective visual reconstruction after Stage 3.5 V2

## 1. Decision summary

Stage 3.5.1 will rebuild the visual composition of the existing Compute Core and Knowledge Graph without changing their semantic ownership or the renderer boundary. The composition will read first as one large computational machine: a primary processing spine and clustered modules in the middle, directional routes and GPU field activity around that structure, and five domain processing regions integrated into the same spatial system.

The implementation uses a hybrid of explicit reusable geometry and a GPU-first anisotropic field. Explicit geometry establishes a thumbnail-readable silhouette and depth hierarchy; the WebGPU NodeMaterial field converts the particle budget into directional density, local compression and flow; WebGL2 shares the same deterministic descriptors and state mapping with a lower-detail material path. The design deliberately avoids relying on bloom, text labels, or color alone to establish hierarchy.

This is a corrective slice, not Stage 6. Command Palette, parsing, Ollama, Agent Gateway, Agent Trace, Developer Overlay and unrelated architecture changes remain out of scope.

## 2. Evidence and diagnosis

The repository was restored from `origin/master` at `eee487d59e0d8cc44269f47d35511fd61d558efd`. The working tree was clean before the baseline run. The new machine reports Node `v24.4.0`; `npm.cmd` is the functioning npm entry point because the PowerShell shim is broken. Dependencies were installed with the existing `package-lock.json` and no package versions were changed.

Static baseline results:

- `npm.cmd run lint`: pass.
- `npm.cmd run typecheck`: pass.
- `npm.cmd test`: 21 files, 136 tests passed.
- `NEXT_TELEMETRY_DISABLED=1 npm.cmd run build`: pass with Next `16.3.5`.

Live browser baseline:

- Backend: `WEBGPU READY`, `Three.js WebGPURenderer`.
- Browser viewport: `1280×720`.
- Effective device pixel ratio: `2`.
- Canvas drawing buffer: `2560×1440`.
- The live still frame visibly shows five uniform circular HUD nodes dominating a small central cluster. The Core is made mostly from low-contrast lines and several detached point clouds. The primary route is not readable at thumbnail size. The left-bottom backend/quality panel reads as developer diagnostics rather than product composition.
- Existing committed visual reference: `artifacts/stage35-core-v2-overview-webgpu.png`. A new machine-specific baseline capture will be produced during implementation before code changes are evaluated.

Implementation facts behind the diagnosis:

- `ComputeCore` currently scales the entire composition from `0.84` toward `1.0`, while the camera remains at `[0, 0, 6]` with a default `48°` field of view.
- `CoreNucleus` contains three small wireframe boxes. `CoreFragments` emits short parallel line membranes, and `CoreTopologyView` uses one line material for all active edges.
- `deriveCoreTopologyActivation()` normally activates only one idle edge and one or two response edges, so the topology descriptor budget does not become a visible primary structure.
- `deriveCoreField()` caps visible field samples at `fieldResolution² * 4`; ULTRA therefore has a 9,216-sample field while telemetry still reports the configured 72,000 particle budget. The samples are mostly long ribbon bands, which read as detached clouds rather than a local processing field.
- Every domain view is the same torus plus wireframe icosahedron template, and graph edges are straight star connections from the semantic Core node to each domain.
- `Atmosphere.tsx` is not mounted by `SceneHost`; the background currently comes primarily from CSS gradients and the empty dark scene.
- The existing architecture already provides useful seams: deterministic descriptors, stable resources, state-driven activation, `RendererRuntime`, the WebGPU/WebGL2 adapter boundary, graph reducer ownership, camera controller damping and truthful telemetry.

## 3. Goals

The slice is complete only when a first-time viewer can read the still frame as a large, active computational device before reading any label.

The visual goals are:

1. Establish a Hero Compute Structure occupying roughly 45–60% of the central visual area at desktop overview framing.
2. Establish four visual levels: hero structure, processing domains, routes/signals, and atmosphere/telemetry.
3. Replace spaghetti topology with a small number of primary structural routes, a supporting secondary network and faint ambient traces.
4. Make the GPU field visibly directional, local, asymmetric and state-reactive rather than a generic point cloud.
5. Give AI, GRAPHICS, GAME ANALYSIS, SYSTEMS and RESEARCH distinct silhouettes while keeping a shared material language.
6. Make hover and focus show causal source-to-target movement or reorganization, not only a brighter label.
7. Add foreground, midground and background separation through scale, depth, occlusion and luminance.
8. Keep WebGPU ULTRA as the visual benchmark while preserving a coherent WebGL2 fallback.
9. Preserve reduced-motion behavior, deterministic generation, stable buffers, semantic graph state and truthful telemetry.
10. Perform at least two real browser screenshot iterations and inspect each still frame at full size and thumbnail size.

## 4. Non-goals and hard boundaries

- Do not start Stage 6 or add Command Palette UI.
- Do not add parsing, Ollama, Agent Gateway, Agent Trace or Developer Overlay.
- Do not change the graph data schema, command ownership, graph reducer semantics or renderer backend selection.
- Do not replace `RendererRuntime`, `CameraController`, the existing quality propagation seam or telemetry contract.
- Do not add CPU loops that update tens of thousands of particles each frame.
- Do not fabricate utilization, VRAM, temperature, power or adapter metrics.
- Do not use large bloom, stars, random space dust or bright cyberpunk cyan to mask weak composition.
- Do not require mouse movement before the default still frame has a clear hierarchy.
- Do not claim sustained performance measurement; that remains a later performance slice.

## 5. Proposed visual architecture

### 5.1 Composition model

The scene is organized around a midground machine with four nested structural layers:

```text
Hero Compute Structure
├─ Primary processing spine
├─ Dense primary cluster
├─ Secondary processing blocks
└─ Routing backbone

Processing Domains
├─ AI branching region
├─ GRAPHICS planar frame region
├─ GAME ANALYSIS decision region
├─ SYSTEMS stacked region
└─ RESEARCH open lattice region

Routes / Signals
├─ primary structural routes
├─ secondary domain bundles
└─ active signal particles / route pulses

Atmosphere / Telemetry
├─ shallow depth field
├─ low-frequency background gradient
└─ subdued runtime status
```

The hero is intentionally not a sphere, shell or closed orbital system. It is a massed arrangement of slabs, short volumes, partial planes and routing segments with an asymmetric void through the center-right side. That void makes the primary spine and signal direction legible.

### 5.2 Depth plan

- Foreground: a small number of larger fragments and signal traces positioned nearer the camera, with restrained opacity and clear parallax.
- Midground: the main spine, primary cluster, secondary blocks and the nearest domain structures. This layer carries the highest luminance and strongest silhouette.
- Background: a sparse field and distant domain traces, with lower opacity and a slightly cooler gray-green tone.

Depth is encoded by descriptor `z` values and material opacity/size bands. No full-scene rotation is used to manufacture depth. Camera movement remains a bounded response owned by `CameraController`.

### 5.3 Luminance plan

- Hero primary structure: highest structural contrast, but no broad overexposure.
- Active route and source-to-target signal: next highest contrast.
- Domain silhouettes: medium contrast, higher when hovered or focused.
- Secondary topology and field: lower contrast, still visible at desktop resolution.
- Ambient traces and telemetry: lowest contrast.

Line/material values must be calibrated against the screenshot, not selected only from code constants. The primary route must survive grayscale and blur/squint review.

## 6. Pure descriptor changes

The existing deterministic generator pattern remains the data boundary. Three.js objects stay in view components.

### 6.1 `coreTopology.ts`

Extend the topology descriptor so it can represent form rather than only endpoints:

```ts
type CoreTopologyRegion = 'anchor' | 'primary' | 'secondary' | 'route' | 'foreground';
type CoreTopologyRoute = 'primary' | 'secondary' | 'ambient' | 'signal';

type CoreTopologyNode = {
  readonly id: number;
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly weight: number;
  readonly region: CoreTopologyRegion;
  readonly depthBand: 'foreground' | 'midground' | 'background';
};

type CoreTopologyEdge = {
  readonly id: number;
  readonly source: number;
  readonly target: number;
  readonly activationRank: number;
  readonly route: CoreTopologyRoute;
  readonly importance: number;
};
```

The generator will define a compact primary spine and several deterministic secondary blocks before filling any quality-dependent detail. It will preserve semantic subsystem presence at SAFE. The primary edge set will be small enough to inspect manually; secondary and ambient edges may scale with quality but may not visually equalize with primary routes.

Activation will return separate ids for primary, secondary and ambient routes plus active processing nodes. State changes will therefore alter visible structure before material tone.

### 6.2 `coreField.ts`

Keep stable typed attributes but change their spatial meaning. Each field sample will be assigned to an anisotropic local zone with:

- position in one of several bounded processing bands;
- drift direction and phase;
- region id;
- density/weight;
- compression/void mask;
- depth band or depth bias.

The field must contain visible local attractors, directional compression and deterministic voids. Samples should be concentrated around the primary spine and secondary processing blocks rather than evenly spread across the full horizontal bounds. The descriptor remains immutable after creation.

`deriveCoreFieldState()` will return a bounded directional bias, activity, active zone count and target zone selected by `idle`, `hover_response`, `focusing` or `agent_activity`. It will never perform per-particle CPU simulation.

### 6.3 `coreTrajectories.ts`

Keep open partial paths, but classify them as primary, secondary, ambient or signal. Primary paths will use longer, fewer bends and a stronger spatial direction; secondary paths will be shorter and thinner; ambient traces will be sparse. Focus will select the route whose endpoint direction best matches the focus vector. Signal paths will expose a source and target zone so the view can animate a bounded source-to-target pulse.

### 6.4 `coreParameters.ts`

Replace V1 naming assumptions with budgets that describe the new form:

- primary node/block budget;
- secondary block budget;
- primary route budget;
- secondary/ambient route budget;
- field sample budget and field resolution;
- active signal budget;
- domain detail budget;
- optional field/material feature flags.

All budgets must remain monotonic from ULTRA to SAFE and keep at least one primary route, one secondary block and one domain silhouette in every quality profile.

## 7. Visual component design

### 7.1 `ComputeCore.tsx`

Remain the composition root and owner of the shared `CoreVisualInput` snapshot. It will:

- use a larger default scale and bounded off-center position so the Core is the first read;
- retain the existing 30 Hz React snapshot cap and scalar-only frame loop;
- pass deterministic descriptors and state to the child views;
- keep telemetry particle count semantics tied to the configured Core budget;
- keep graph/command/agent imports out of the module.

It must not become a second interaction or state owner.

### 7.2 `CoreNucleus.tsx` and `CoreTopologyView.tsx`

The nucleus becomes a dense processing cluster made from reusable box/plane/edge resources. The view will use separate materials or instanced batches for primary blocks, secondary blocks and route braces. Primary blocks are larger, layered and slightly depth-separated; secondary blocks support the silhouette without competing with it.

Primary routes should be rendered as thicker structural members using reusable geometry or instanced oriented bars rather than relying on platform-dependent `LineBasicMaterial.linewidth`. Secondary and ambient routes remain merged line buffers where appropriate. The view must not create a React object per topology node or route.

### 7.3 `CoreFragments.tsx`

Fragments become irregular processing plates and foreground structural traces. Their positions come from topology nodes and their scales come from deterministic descriptors. Each state may reveal or compress a bounded subset of fragments. The default idle state must still show a substantial midground form.

### 7.4 `CoreFlowField.tsx` and `coreFlowMaterial.ts`

The WebGPU path will use `PointsNodeMaterial` with stable field attributes and scalar uniforms. The vertex node will combine:

- local drift direction;
- field-zone density;
- temporal phase;
- directional activity;
- pointer/focus bias;
- bounded compression around the active target zone.

The field must visibly tighten into lanes or processing pockets during hover/focus. It must remain local to the machine and never become a complete enclosing shell.

The WebGL2 path will use the same positions, weights and stream selection with `PointsMaterial` and object-level scalar motion. It may have fewer visible samples, but it must retain the same asymmetric bands, central void and active-target direction.

### 7.5 `CoreTrajectoryPaths.tsx` and `CoreSignals.tsx`

The passive route buffer will be split into primary, secondary and ambient draw groups with different material tone/opacity. Active signals will be sampled from existing paths and rendered as a bounded point/short-trail batch. The frame loop may update only the small signal buffer and material scalar inputs, never the full field.

State semantics:

- `idle`: local attractor drift, two readable structural routes, low-rate signal motion.
- `hover_response`: field and one local branch bias toward pointer direction; one nearby route receives a stronger short trail.
- `focusing`: one source-to-target route becomes dominant and a signal visibly travels toward the focused domain region.
- `agent_activity`: reserved visual state may activate multiple signal routes, but no Agent integration is added.
- `reducedMotion`: preserve the selected route and static field compression while disabling continuous travel and long choreography.

## 8. Domain redesign

The graph manifest and semantic ids remain unchanged. `GraphNodeView` will select a deterministic visual variant by node id, not by a new graph schema.

### AI — branching routing cluster

Use a compact source block with two or three branching bars and a small central processing plate. The silhouette is directional and forked rather than circular. Hovering or focusing AI activates one branch and adds a short signal pulse from the Core route.

### GRAPHICS — planar framebuffer structure

Use layered rectangular frames or offset planes with an internal scanline/grid accent. The structure sits slightly forward in depth and uses a crisp planar silhouette. Focus aligns the active route with the frame stack.

### GAME ANALYSIS — decision topology

Use a forked decision shape with a central junction and two asymmetric downstream branches. The shape is sparse but unmistakably directional. Hover activates one branch; focus sends a signal along the selected branch.

### SYSTEMS — stacked system layers

Use three offset slabs or stepped layers with a short vertical spine. The silhouette reads as an ordered stack. Focus increases depth separation and activates the shortest structural route.

### RESEARCH — open exploratory lattice

Use an incomplete lattice of crossing bars and two open endpoints. It must remain visibly open and irregular, not a sphere or ring. Focus increases local lattice density and receives a signal from the Core.

All domain variants share the existing muted gray/white/desaturated green-cyan material language and the same hover/focus activation contract. No variant uses a circular border plus wireframe sphere template.

## 9. Graph and Core integration

`KnowledgeGraph` remains the semantic interaction owner. `GraphNodeView` and `GraphEdges` may change their visual geometry and route bundles, but pointer hit testing continues to use the existing projected domain positions and reducer actions.

Graph edges will be rendered as route bundles with a short near-domain fan or convergence segment. The semantic edge remains one edge in the manifest; the extra visual subdivision is deterministic view geometry. When no node is active, route bundles are quiet and support the hero silhouette. When a node is hovered or focused, the corresponding bundle gains route emphasis and a bounded signal pulse.

`SceneHost` continues to map graph hover/focus to `ComputeCoreVisualState`. It may pass a serializable target vector or domain activation descriptor into the visual graph layer, but it must not move command ownership or add a global store. `ComputeCore` remains graph-blind.

## 10. Camera, atmosphere and UI

### Camera

Keep `CameraController` damping and focus ownership. Adjust only the default composition constants and bounded response coefficients so the default view has controlled perspective depth and mild off-center framing. Focus must reframe without rotating the whole Core into a different identity. Escape must continue to clear focus.

### Atmosphere

Replace the currently unused spherical atmosphere concept with a subtle background depth layer. It may use a small static field of distant planes/traces and CSS low-frequency gradients. It must not use stars, random space dust, a complete wireframe sphere or broad rings. Mounting it in `SceneHost` is allowed because it is pure visual integration.

### UI reduction

Keep the real `RendererStatus` telemetry capability, but reduce its visual weight in the default product view: smaller opacity, quieter detail copy and tighter footprint. Do not delete backend truth, quality propagation or telemetry logging. The masthead remains visible and slightly more legible so the brand does not disappear at desktop scale.

## 11. Backend strategy

WebGPU is the primary visual benchmark. The implementation may expose richer field displacement, higher field density and stronger signal trails on WebGPU, provided the visual identity remains coherent at WebGL2.

WebGL2 must preserve:

- the larger central hero silhouette;
- primary/secondary route hierarchy;
- five distinct domain silhouettes;
- focus/hover source-to-target cause and effect;
- reduced-motion behavior;
- no shader compilation errors or invalid buffers.

No backend-specific fake status is introduced. The existing runtime remains the authority for selected backend and quality.

## 12. Testing strategy

Before implementation, add or extend pure tests for:

- deterministic topology descriptors for equal seed and parameters;
- finite positions, scales and route indices;
- bounded primary/secondary/ambient counts;
- deterministic field descriptors with non-uniform weights and explicit voids;
- bounded field zone/state mapping;
- finite open trajectory samples and route classes;
- monotonic quality budgets with semantic structure present at SAFE;
- state mapping that changes route/zone membership for idle, hover and focus;
- deterministic domain variant descriptors or geometry inputs;
- no invalid graph indices and unchanged graph reducer semantics.

Existing renderer, camera, telemetry, command and graph tests must remain passing. Do not add screenshot-pixel tests or tests for individual CSS color constants; use pure structural invariants for algorithms and browser evidence for the visual result.

## 13. Browser verification loop

The implementation must follow this loop rather than waiting until the end:

1. Capture the current V2 baseline in the new machine/browser and record backend, viewport, DPR, canvas size and console messages.
2. Implement the first reconstruction pass.
3. Run the dev server with `?boot=skip`, inspect a WebGPU overview screenshot and compare it at full size and `480×270` thumbnail size.
4. Adjust hero scale, route contrast, domain silhouettes and field density based on what is actually visible.
5. Capture a second WebGPU overview and inspect hover GRAPHICS, focus GRAPHICS and Escape.
6. Verify reduced motion and WebGL2 fallback overview/hover/focus with fresh screenshots.
7. Inspect console logs. Existing known warnings may remain; new R3F errors, shader/material errors, invalid buffers, NaN values or WebGPU validation errors must be fixed before completion.

The final evidence set is:

```text
artifacts/stage351-baseline-newpc.png
artifacts/stage351-overview-webgpu.png
artifacts/stage351-hover-webgpu.png
artifacts/stage351-focus-webgpu.png
artifacts/stage351-overview-webgl2.png
```

If the browser harness cannot save a screenshot directly, the live screenshot must still be inspected and a reproducible capture method must be recorded rather than claiming an absent file. A screenshot is not accepted merely because the page rendered without an exception.

## 14. Completion gates

The slice may be marked complete only when all of the following are true:

- The central hero structure is the first read without labels.
- The thumbnail still shows one dominant machine-like silhouette, spatial domain distribution and a readable primary route.
- Primary, secondary and ambient structures are visibly distinct in grayscale or squint review.
- Domain silhouettes are different at a glance and no longer use the shared HUD sphere template.
- Hover/focus change route, density, signal direction or local structure, not only text/color.
- WebGPU ULTRA is materially richer than WebGL2 while WebGL2 remains coherent.
- Reduced motion, Escape, hover, focus and boot skip remain functional.
- No new uncaught exception, shader compile error, invalid buffer, NaN or WebGPU validation error is present.
- `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd test` and disabled-telemetry build all pass after the final changes.
- `docs/PROJECT_STATUS.md` and `docs/AI_HANDOFF.md` state `Stage 3.5.1 complete`, record the actual environment/backend evidence, list remaining weaknesses and state `Next action = Visual Review / Sol Review`.
- The final Git commit is focused on Stage 3.5.1 and does not include cache, browser profile, credentials or machine-specific configuration.
- The work stops before Stage 6.

## 15. Remaining weaknesses to report honestly

The final report must call out any of the following if still present: inability to obtain a real adapter name, missing sustained FPS/GPU utilization data, browser harness viewport differences, known library warnings, WebGL2 field simplification, residual label clipping, domain regions that remain too icon-like, or any screenshot where the thumbnail hierarchy is not decisive. The absence of a metric must be reported as unavailable rather than inferred.

## 16. Documentation closeout

After visual verification, update:

- `docs/PROJECT_STATUS.md`: add a Stage 3.5.1 implementation/evidence section, replace the stale Stage 6 immediate-next-action text, and record the final actual commit SHA.
- `docs/AI_HANDOFF.md`: update HEAD, current stage, implementation ownership, verification evidence, screenshots, known warnings and the explicit next action `Visual Review / Sol Review`.

Neither document may imply that Stage 6 has begun or that visual quality is complete merely because static tests pass.
