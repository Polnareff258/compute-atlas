# Compute Core Visual Identity V2

**Date:** 2026-09-17  
**Status:** Proposed for implementation  
**Slice:** Stage 3.5 — Compute Core Visual Identity V2

## 1. Decision summary

The current Compute Core is visually organized as a centered spherical reactor: nested icosahedrons, a spherical field, a Fibonacci particle shell and closed torus orbitals. Stage 3.5 replaces that identity with a distributed computational topology.

The recommended renderer route is TSL/NodeMaterial GPU vertex displacement with a visually coherent WebGL2 fallback. The semantic data, deterministic attributes and visual-state transitions are shared. WebGPU may use the richer GPU path; WebGL2 keeps the same asymmetric topology, fragments and broken trajectories with reduced field detail.

This is a visual subsystem correction, not a renderer, Graph, Command Bus or Agent redesign.

## 2. Goals

- Make the first impression read as an active computational process, not a glowing orb.
- Break spherical and rotational symmetry with deterministic asymmetric composition.
- Replace closed orbitals with partial trajectories that have direction and activation state.
- Replace the spherical particle shell with a non-uniform field of clusters, streams and voids.
- Make topology and signal activation respond to `idle`, `awakening`, `hover_response`, `focusing` and `agent_activity`.
- Preserve GPU-first behavior: reusable buffers, no per-particle React nodes, no CPU per-frame 70k particle updates and no per-frame allocation loops.
- Keep the existing WebGPU-first/WebGL2 fallback boundary and all Stage 0–5.1 contracts intact.

## 3. Non-goals

- No Command Palette, parser, Ollama, Agent Gateway, Agent Trace or Developer Overlay.
- No new Graph schema and no Graph import from ComputeCore.
- No renderer selection rewrite or backend-specific product state.
- No account, project database, content pages or mobile redesign.
- No Stage 11 performance tuning claim. Stage 3.5 only adds obvious regression guards and records measured browser observations.
- No bloom-heavy rescue pass or broad typography/HUD changes.

## 4. Existing boundaries to preserve

```text
SceneHost
  ├─ ComputeCore (visual resources + interaction math)
  │    ├─ deterministic core data
  │    ├─ GPU visual subsystems
  │    └─ ComputeCoreVisualState
  ├─ KnowledgeGraph
  └─ existing CameraController

RendererHost / RendererRuntime
  └─ WebGPU-first adapter → WebGL2 fallback
```

`ComputeCore` may read camera-controller scalar responses and its own visual state. It must not import Graph, Commands, Agent, Ollama or DOM state. `SceneHost` remains the semantic integration boundary.

## 5. Visual composition

### 5.1 Anchor cluster

The main anchor is a cluster of small irregular computational fragments, not one closed body. Fragments are intentionally offset in position, scale and orientation. A compact nucleus provides a local origin but is visually subordinate to the cluster.

The anchor cluster uses:

- weighted procedural nodes;
- bounded partial edges;
- small line/point fragments;
- local field attractors and voids;
- one or two active paths selected by visual state.

No layer may produce a complete spherical silhouette as its primary read.

### 5.2 Satellite structures

Four to six sparse satellites represent processing regions, routing nodes and field attractors. They are not decorative moons. Their positions are deterministic and asymmetric, with bounded depth separation so the composition remains legible at the existing camera distance.

The first implementation keeps them semantic-neutral. Future Graph domains may map to them through stable visual inputs, but Stage 3.5 does not import graph data.

### 5.3 Partial topology

`CoreTopology` renders a finite node set and a bounded edge set generated from deterministic seeded points. Connectivity is partial rather than a closed shell. Edge activation is derived from stable edge metadata and visual state:

- `idle`: a small inactive baseline;
- `awakening`: fragments assemble and a few edges fade in;
- `hover_response`: a local branch receives emphasis;
- `focusing`: one directional route is emphasized;
- `agent_activity`: several short signal paths propagate.

Activation changes material scalar state or reusable attribute values; it does not recreate geometry or materials each frame.

### 5.4 Broken trajectories

`CoreTrajectories` replaces all closed torus geometry. It uses deterministic partial polylines or sampled Bezier/Catmull-Rom-like arcs with varied lengths, endpoints and orientations. Dormant paths remain faint or partially absent. Active paths expose directional signal movement.

There must be no default presentation of three large concentric rings.

### 5.5 Fragmented field

`CoreFragments` and `CoreFlowField` provide local anisotropic field patches, membranes and streams. The field intentionally contains sparse voids and does not wrap the complete anchor in a shell.

## 6. Renderer strategy

### 6.1 Shared semantic input

The high-frequency visual subsystems consume a renderer-friendly interaction snapshot derived inside ComputeCore:

```ts
type CoreVisualInput = {
  pointerX: number;
  pointerY: number;
  focusX: number;
  focusY: number;
  focusZ: number;
  intensity: number;
  visualState: ComputeCoreVisualState;
  reducedMotion: boolean;
};
```

This is not Graph state and contains no Three.js object. It may be kept local to the scene implementation if no external consumer needs it.

### 6.2 GPU field path

The ULTRA/HIGH field uses stable precomputed attributes such as position, phase, drift direction, region and point weight. TSL/NodeMaterial vertex logic derives bounded temporal displacement from those attributes and scalar state inputs. The implementation must not allocate vectors or arrays in the frame loop.

The exact TSL node API will be confirmed against the installed Three.js version before implementation. If a required node material capability is unavailable or unstable on the current WebGPU path, the implementation falls back to the shared precomputed flow representation rather than reintroducing an incompatible `ShaderMaterial` path.

### 6.3 WebGL2 fallback

WebGL2 receives the same deterministic topology, fragments and trajectory data. Field displacement may use reduced node/material detail, static flow attributes and object-level scalar drift. The fallback must preserve the V2 silhouette and interaction cause/effect even when it has fewer field samples.

### 6.4 SAFE profile

SAFE retains the same identity. It reduces field count, topology edge count, fragment detail and trajectory subdivisions. It must not switch back to a spherical shell or closed-ring composition.

## 7. Module design

### `coreTopology.ts`

Pure deterministic generator for node positions, weights and bounded partial connections.

Input: quality-derived topology budget and fixed seed.  
Output: serializable/frozen numeric descriptors with finite positions and indices.  
Owns: topology generation and state-independent metadata.  
Does not own: Three.js geometry, materials, React or animation.

### `coreField.ts`

Pure deterministic generator for field attributes and region descriptors.

Input: particle budget, field bounds, fixed seed and quality detail.  
Output: typed-array-friendly positions, phase, drift and weights.  
Owns: non-uniform distribution and stable flow metadata.  
Does not own: per-frame CPU simulation or renderer objects.

### `coreTrajectories.ts`

Pure deterministic generator for partial paths and signal metadata.

Input: trajectory budget and fixed seed.  
Output: finite sampled paths, length, direction and activation rank.  
Owns: broken path geometry data.  
Does not own: state transitions or camera behavior.

### `coreParameters.ts`

Maps the existing `QualityProfile` to V2 budgets. The public function remains `getCoreParameters(profile)`, but V1-only names such as shell radius and orbital count are removed or replaced once all consumers migrate.

Required monotonic behavior: ULTRA ≥ HIGH ≥ MEDIUM ≥ SAFE for particle/field/topology/fragment/trajectory detail. Semantic visual subsystems remain present in every profile.

### Visual components

- `CoreNucleus.tsx`: compact irregular nucleus.
- `CoreTopology.tsx`: instanced/line topology and state-dependent activation.
- `CoreFlowField.tsx`: reusable point field and GPU displacement/fallback material.
- `CoreFragments.tsx`: local membranes and asymmetric fragments.
- `CoreTrajectories.tsx`: partial paths and active signal segments.
- `CoreSignals.tsx`: bounded state-driven propagation accents.

`ComputeCore.tsx` remains the composition root and owns the shared frame-loop scalar inputs. Existing V1 component filenames may be deleted or retained only as compatibility-free implementation files; no duplicate V1 layer may remain mounted.

## 8. State and animation contract

The existing `ComputeCoreVisualState` union remains stable. V2 changes the visual response, not the state ownership.

Animation semantics:

- `idle`: sparse local drift, low baseline edge activation and dormant trajectories.
- `awakening`: deterministic fragment assembly and progressive field density.
- `hover_response`: local field bias toward pointer/camera response and nearby route emphasis.
- `focusing`: directional route activation using the existing focus scalars; no whole-core rotation.
- `agent_activity`: reserved state with bounded multi-path propagation, implemented as a visual parameter only and not wired to Agent in this slice.

Reduced motion remains functional. It should disable long temporal choreography and reduce propagation amplitude while preserving topology, hover, focus and fallback behavior.

## 9. Testing strategy

Before production implementation, add failing tests for:

- deterministic topology generation for equal seed/parameters;
- finite topology positions and indices;
- bounded edge count and absence of a complete closed shell;
- deterministic field attributes with sparse/non-uniform regions;
- finite trajectory samples with partial endpoints;
- monotonic quality budgets and semantic subsystem presence in SAFE;
- state-to-activation mapping for idle, hover and focus;
- JSON-safe descriptor data where applicable.

After implementation, run the focused Core suite, then lint, strict typecheck, full tests and disabled-telemetry production build.

## 10. Browser and visual verification

Run the local dev server with `boot=skip` and inspect:

- 1920×1080 WebGPU overview, hover and focus;
- 2560×1440 WebGPU when available;
- WebGL2 fallback overview, hover and focus;
- reduced-motion behavior;
- no uncaught exceptions or WebGPU material warnings introduced by V2;
- no label clipping or graph/Core framing regression;
- actual canvas/backend status and existing telemetry seam remain truthful.

Save overview, hover and focus screenshots under `artifacts/stage35-core-v2-*.png`. Use `view_image` for actual visual inspection. A short animation capture is optional and must not replace still-frame review.

The visual checklist is explicit:

- no obvious glowing sphere as the primary silhouette;
- no recognizable icosahedron shell;
- no three closed torus rings;
- no uniform spherical particle boundary;
- no constant rotation everywhere;
- sparse idle state and denser activity state;
- Core and Graph share restrained line/activation language;
- ULTRA is visibly richer without inventing hardware metrics;
- SAFE preserves the same non-spherical identity.

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| TSL API differs across installed Three.js build | Verify installed declarations first; isolate material code behind `CoreFlowField`; retain deterministic fallback. |
| Field still reads as a cloud/orb | Enforce voids, directional streams, asymmetric bounds and screenshot checklist. |
| Too many line draws | Use merged/instanced buffers and bounded topology/trajectory budgets. |
| React rerenders from animation | Keep animation in refs/material scalar state and stable `useMemo` resources. |
| Graph interaction loses Core response | Preserve `ComputeCoreVisualState` and SceneHost mapping tests/browser checks. |
| WebGL2 silhouette diverges | Share topology/fragment/path descriptors and validate both backends before completion. |
| V2 becomes a hidden Stage 12 polish pass | Stop at visual identity, document remaining weaknesses and do not tune sustained performance. |

## 12. Completion boundary

Stage 3.5 is complete only when the V1 spherical-reactor patterns are no longer the dominant read, the deterministic Core tests pass, both renderer paths remain coherent, screenshots are inspected and the project/status handoff explicitly keeps Stage 6 pending.

After that verification, commit the implementation and documentation, push through the configured v2rayN proxy, and stop. Do not begin Command Palette or Agent work.
