# Stage 3.5.2 Review Brief

**Purpose:** let a reviewing agent start from facts instead of re-deriving them. Everything below was measured in this worktree; nothing is inherited from an earlier stage's claims. If you only read one file before reviewing, read this one.

**Baseline:** branch `master`, review baseline `0dc19de0e54bb5dbd141cfb2a3a1459881aa4aa5`. Task 8 of `docs/superpowers/plans/2026-09-19-stage352-visual-reconstruction.md` is complete.

**Verdict this brief asserts:** Stage 3.5.2 is implemented and captured on both backends; all checks green; **two fixed defects and one unresolved, localised material divergence** are documented below. It is ready for Visual Review / Sol Review.

---

## 1. Do not re-derive these

Re-running any of this costs tokens and changes nothing unless you suspect the brief is wrong.

- `npm.cmd run typecheck` — pass. `npm.cmd run lint` — pass. `npm.cmd test` — **32 files, 237 tests pass**. `NEXT_TELEMETRY_DISABLED=1 npm.cmd run build` — pass on Next.js 16.3.5.
- WebGPU capture: 10 files, 34 console messages — info 25, warning 9, **error 0, fatal 0**.
- WebGL2 capture: 10 files, 28 console messages — info 24, warning 4, **error 0, fatal 0**. No NaN, invalid buffer or WebGPU validation error on either backend.
- Reduced motion, same scene sampled twice ~3 s apart in one session: normal **1.82% of pixels (37,772 px) changed**; reduced **0.00% (0 px) changed**, mean luminance identical to three decimals.
- SAFE vs ULTRA: **16.60%** (overview) / **17.08%** (hover) of pixels differ; ULTRA p99.9 215 / peak 255 against SAFE 147 / 231.
- Pre-existing user changes are intact and unmodified: `vitest.config.ts`, the capture scripts, and their supporting tests. The current canonical local launcher is `START_POLNAREFF.cmd`.
- No dependency, `package.json` entry or machine-local file was added. The capture harness uses Node 24's built-in `WebSocket` only.

## 2. Review in this order

1. **Boundaries first** — `src/scene/SceneHost.tsx` (semantic integration), `src/renderer/RendererHost.tsx` (backend/quality/lifecycle), `src/scene/camera/cameraController.ts` (camera ownership). Confirm no ownership moved.
2. **`grep -rn "from '.*\\(graph\\|commands\\|agent\\)" src/scene/core/` returns nothing** — `ComputeCore` must stay Graph/Command/Agent-blind. Same check for Three.js/R3F inside `src/graph/` and `src/commands/` core.
3. **The React/GPU split** — `src/scene/core/CoreStructureView.tsx`, `src/scene/routing/RouteDashes.tsx`. Continuous scalars must go through refs and uniforms; React must only see discrete state. No per-frame allocation of vectors, arrays or materials.
4. **Disposal** — every new GPU resource must be released from an unmount effect. Check `CoreStructureView`, `DomainEnvironmentView`, `RouteDashes`, `Atmosphere`. Note: the plan named a `createResourceLease`/`disposeAll` helper that was never built; per-view ownership is what shipped.
5. **Materials** — `src/scene/materials/surfaceMaterial.ts`, `surfaceGeometry.ts`, `structureGeometry.ts`. Solids must write depth and occlude; membranes must blend and not write depth. Confirm no large-area flat `MeshBasicMaterial` read survives and that the fix is structure, not brightening.
6. **Visual behaviour** — inspect `artifacts/stage352-*.png` if present (section 5); otherwise regenerate (section 6).

Do not scan the whole repository. The file map in `docs/AI_HANDOFF.md` lists exactly what changed.

## 3. What shipped

| Area | Files | Role |
|---|---|---|
| Hero structure | `src/scene/core/coreStructure.ts`, `coreStructureGeometry.ts`, `CoreStructureView.tsx` | Diagonal spine, asymmetric processing volume, central void, secondary assemblies, route ports with ingress, viewport-clipped slices |
| Shared geometry | `src/scene/materials/structureGeometry.ts` | Bakes a structure into solid + membrane geometry; tier colour and per-face orientation luminance pre-multiplied into vertex colours |
| Shared material | `src/scene/materials/surfaceMaterial.ts`, `surfaceGeometry.ts` | One factory for both backends (`node` / `standard`), roles `volume \| beam \| port \| membrane` |
| Core circulation | `src/scene/core/coreCirculation.ts` | Internal dash field: compression zone, ingress accumulation, source-to-target burst, arrival wake |
| Route dashes | `src/scene/routing/routeDash.ts`, `routeDashMaterial.ts`, `RouteDashes.tsx`, `graphRoutes.ts` | Same signal language along graph routes; GPU advection on WebGPU, bounded CPU instanced dash on WebGL2 |
| Domains | `src/scene/graph/domainEnvironments.ts`, `domainCircuits.ts`, `DomainEnvironment.tsx` | Five local computational behaviours from one machine language: ingress, internal topology, local response, state change |
| Reduced motion | `src/renderer/reducedMotion.ts`, `RendererHost.tsx`, `SceneHost.tsx` | Media query → host → scene; the scene stops rather than dimming |
| Status copy | `src/ui/statusCopy.ts`, `RendererStatus.tsx` | Compresses to `WEBGPU · ULTRA`; diagnostics deferred to the future overlay |

Deleted, not rewritten: `coreTopology.ts`, `coreField.ts`, `coreFlowMaterial.ts`, `coreTrajectories.ts`, `coreTelemetry.ts`, `coreResourceLifecycle.ts`, `coreMaterials.ts`, `CoreNucleus.tsx`, `CoreTopologyView.tsx`, `CoreFragments.tsx`, `CoreFlowField.tsx`, `CoreTrajectoryPaths.tsx`, `CoreSignals.tsx`, `domainVisuals.ts`, `GraphNode.tsx`. The plan file carries a reconciliation section explaining each departure.

## 4. Defects found and fixed

Both were invisible to 237 passing tests; only running the acceptance matrix exposed them. A reviewer should treat these as the evidence that the matrix is worth running, not as a reason to re-run it.

- **The whole membrane tier rendered nothing, on both backends.** Ordered dither via an alpha map and alpha test. Three samples an alpha map in the **green** channel; the map was a single-channel red texture, so every membrane fragment was discarded against a constant zero. Proof: forcing the alpha test to 0 changed **4.60% of the frame (95,407 px)**. Fixing the channel only exposed the second half — at ~200 px per world unit a Bayer cell aliases into a visible checkerboard across the large plates and into diagonal moiré across the small ones — so the dither was replaced by a genuine bounded blend (`deriveMembraneOpacity`, 0.16–0.46).
- **`Atmosphere` diverged by backend.** Its node path drew the depth backdrop at (2,3,3) against a scene background of (5,6,9). It no longer takes a backend; the standard path is correct for a static, non-responsive surface. Now (26,33,33) at centre and (11–12,14–16,17) at the corners on WebGPU, matching WebGL2.

## 5. Open item — do not mistake this for a pass

**The WebGPU node material path renders the machine's mid-tones darker than the standard path. Not fixed.**

- Same frame at (1152,497): WebGPU **83** vs WebGL2 **143** (ratio 0.58, consistent across sampled pixels).
- Histograms: WebGPU p50 4 / p90 28 / p99 102 vs WebGL2 p50 26 / p90 69 / p99 155.
- Localisation: forcing the standard path on WebGPU reproduces the WebGL2 histogram to within 1–2 levels (p50 28/26, p90 70/69, p99 156/155, p99.9 219/208). The renderer's output transform, fog and colour management are therefore correct; the divergence is inside the node material path.
- Ruled out by inspection: three's `VertexColorNode` (plain attribute read, white fallback), the GLSL and node fog formulas (numerically equivalent), the node alpha path.

Do not describe WebGPU and WebGL2 output as identical in a review.

## 6. Evidence and how to regenerate it

> **Superseded for regeneration by `docs/STAGE353_REVIEW_BRIEF.md`.** The command
> below passes `--coords graphics=1180,640`, which is a fixed point that misses
> the pick zone and is now a *failure* rather than a frame — the harness derives
> the pointer position from the live DOM and exits non-zero when it cannot reach
> the domain. The section is kept as the 3.5.2 record; for a working command use
> the 3.5.3 brief.

**The 31 `artifacts/stage352-*.png` files are local only.** `.gitignore` excludes `artifacts/`; only the 7 historical `stage35-*` files were force-added past it. On a fresh clone, regenerate:

```bash
npm.cmd run dev          # Next dev server on :3000, then in a second shell:
node scripts/stage352-capture.mjs --base-url http://localhost:3000 \
  --out artifacts --backend webgpu --quality ultra \
  --sizes 1920x1080,2560x1440 \
  --states overview,hover-graphics,focus-graphics,escape \
  --coords graphics=1180,640 --thumb 480x270
# WebGL2: same command with --backend webgl2 (shadows navigator.gpu before document start)
# Reduced motion: add --reduced-motion
```

`--coords graphics=<x>,<y>` is the GRAPHICS domain label's position and is viewport-dependent; if a hover or focus frame shows no response, that point missed the label rather than the scene being broken. `--dry-run` prints the resolved coordinates for a given matrix. The app under test is reached through `?boot=skip&telemetry=1`, which the harness appends itself.

`node scripts/stage352-capture.mjs --help` lists every flag; `--dry-run` validates a matrix without launching a browser. The harness exits non-zero on uncaught exceptions, `NaN`, invalid buffer sizes, WebGPU validation errors or (unless allowlisted) console errors.

Acceptance-criterion coverage: WebGPU 1920×1080 and 2560×1440 ✓; the same frame at 480×270 ✓; hover field-bend and ingress response ✓; focus-GRAPHICS source-to-target choreography ✓; Escape restores ✓; WebGL2 overview/hover/focus/Escape ✓; reduced motion actually stops ✓; SAFE preserves core identity ✓; ULTRA increases structure ✓; console clean ✓.

**Not separately captured:** a formal text-hidden frame and a formal greyscale artifact. The luminance hierarchy is evidenced by the measured histograms in section 5, and the 480×270 downscale evidences the composition read at small size, but if you want those two artifacts they must be produced. Do not report them as existing.

## 7. Out of scope for this review

Stage 6 and later — no command palette, parser, Ollama, Agent Gateway, SSE, Agent Trace, Developer Overlay, or Stage 11 performance work. `agent_activity` exists as a **visual state only**; no Agent is implemented. No modified Agent, Command or Graph data model. No fabricated hardware telemetry: no FPS, GPU utilization, VRAM or thermal claim is made anywhere in this stage.

## 8. Working tree

Modified, deleted and untracked files are as listed by `git status`; the pre-existing user changes in section 1 are untouched. Nothing is committed — the tree is deliberately left for review. Force-adding the local captures past `.gitignore`, if wanted, is a commit-time decision, not something this stage assumes.
