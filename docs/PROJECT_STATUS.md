# POLNAREFF SYSTEM Project Status

**As of:** 2026-09-17
**Repository:** initialized from an empty directory
**Current phase:** Phase 1
**Current stage:** Stage 3 complete; Stage 4 Knowledge Graph pending

## Confirmed architecture

- Next.js App Router full-stack application.
- Three.js WebGPU-first renderer with WebGL2 fallback.
- Dynamic hybrid visual density: sparse idle state, denser response states.
- Typed Command Bus plus Zustand for serializable UI/system state.
- Server-only Ollama access through HTTP + SSE Agent Gateway.
- Agent whitelist tools and schema validation; no arbitrary code, shell, filesystem or DOM access.
- Boot state is serializable and isolated from Three.js objects; renderer initialization remains behind the existing runtime boundary.
- Compute Core owns visual resources and interaction math; it has no Graph, Command or Agent imports.

## Current progress

| Stage | Status | Evidence |
|---|---|---|
| Stage 0 — repository/architecture setup | Complete | Commit f633032; strict TypeScript, quality profiles and test harness are present. |
| Stage 1 — renderer bootstrap | Complete | Commit 2700f3b; WebGPU-first/WebGL2 adapter host, R3F scene shell, status UI and headless browser verification are complete. |
| Stage 2 — boot experience | Complete | Commit 36abdda; reducer, health seam, manifest, coordinator, visual bootstrap overlay, degraded path and skip path verified. |
| Stage 3 — Compute Core | Complete | Layered Core, quality budgets, inertial pointer response, WebGPU-compatible materials, telemetry seam and desktop browser evidence are complete. |
| Stage 4 — Knowledge Graph | Not started | Schema and spatial interaction remain isolated for the next stage. |
| Stage 5 — Command Bus | Not started | No command routing has been added to the Core slice. |
| Stage 6 — Command Palette | Not started | No palette UI has been added. |
| Stage 7 — backend/Ollama health | Not started | Browser gateway intentionally remains NOT INITIALIZED until this stage. |
| Stage 8 — Agent tool calling | Not started | No model or tool call is made from the browser. |
| Stage 9 — Agent Trace | Not started | No hidden reasoning is exposed. |
| Stage 10 — Developer Overlay | Not started | No telemetry overlay UI has been added. |
| Stage 11 — performance pass | Not started | Owns sustained GPU/frame-budget measurement and tuning. |
| Stage 12 — visual polish | Not started | Requires Graph interaction evidence first. |

## Stage 3 implementation

- src/scene/core/coreParameters.ts derives deterministic Core budgets from the existing quality profiles:
  - ULTRA: 72,000 particles, 3 cage detail, 3 orbitals, field resolution 48.
  - HIGH: 42,000 particles, 2 cage detail, 3 orbitals, field resolution 40.
  - MEDIUM: 18,000 particles, 2 cage detail, 2 orbitals, field resolution 32.
  - SAFE: 6,000 particles, 1 cage detail, 1 orbital, field resolution 24.
- src/scene/core/ComputeCore.tsx owns one spatial group, stable resources, pointer normalization, awakening-to-idle transition, camera parallax and telemetry callback.
- CoreSeed, CoreCage, CoreEnergyField, CoreParticleShell and CoreOrbitals form the layered visual system.
- CoreEnergyField uses WebGPU/WebGL-compatible MeshBasicMaterial and procedural geometry; no ShaderMaterial compatibility warning remains.
- src/scene/camera/cameraController.ts contains scalar clamp/damping math and reduced-motion behavior with no per-frame allocations.
- src/telemetry/rendererTelemetry.ts reads renderer.info and frame delta into serializable snapshots; absent counters become null. telemetry=1 enables a throttled diagnostic console sink only; default UI remains unchanged.
- Quality budgets are explicit in src/config/quality.ts and passed from the renderer runtime into SceneHost/Core.

## Verification evidence

- npm run lint — pass.
- npm run typecheck — pass.
- npm test — 10 files, 34 tests passed.
- NEXT_TELEMETRY_DISABLED=1 npm run build — pass with Next 16.3.5.
- Chrome 1920×1080, clean dev service, boot=skip — canvas reports three.js r186 webgpu; boot reaches complete; graphics fact is WEBGPU READY; Compute Scene is ACTIVE; screenshot artifacts/stage3-compute-core-final-webgpu.png generated.
- Chrome 2560×1440, GPU-disabled fallback smoke — boot reaches complete; canvas is 2538×1286 within the desktop viewport; screenshot artifacts/stage3-compute-core-2560-fallback.png generated.
- Browser logs after the material correction contain no ShaderMaterial incompatibility or uncaught R3F error. Remaining messages are environment/library notices: Windows powerPreference is ignored, Three.Clock is deprecated, PCFSoftShadowMap is remapped by Three WebGPU, and one headless WebGPU zero-vertex draw warning.
- Telemetry/camera/budget focused tests pass. A sustained numeric FPS/frame-time budget was intentionally not recorded from the virtual-time/headless harness; Stage 11 owns that measurement on a real interactive desktop run.

## Handoff rule

An agent must read the spec, project status and phase plan before editing. Work one stage at a time, run focused and full verification, update this file with evidence, and leave later-stage functionality untouched unless the current stage boundary requires it.

## Immediate next action

Begin Stage 4 from the future plan map: create the data-driven Knowledge Graph schema and spatial node interaction boundary. Keep Compute Core visual states and camera controller independent from Command Bus and Agent Gateway implementation.