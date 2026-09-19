# Stage 3.5.3 — Visual Convergence: review brief

Written to be read **instead of** the transcript. If you are reviewing this
stage, everything you need to check is below, and every claim carries either a
command that reproduces it or a file that contains it.

Supersedes `docs/STAGE352_REVIEW_BRIEF.md` for regeneration. The 3.5.2 entry
checks passed; the 3.5.2 **visual review did not**. This stage is the response to
that, and two of the 3.5.2 brief's own claims have since been shown to be wrong —
see §7.

Baseline: `3a16f91` (32 files / 237 tests, clean tree, typecheck/lint/build
passing). Current HEAD carries most of this stage; the remainder is in the
working tree.

---

## 1. What was actually wrong

Five defects, all named from the frame rather than from theory. Each was
root-caused to a specific expression, and the fix is at that expression.

**1.1 Coverage was a count per curve, so it was constant per curve.**
A route's ink is `packetCount × packetLengthInProgress`. Counting packets per
curve made that product the same on every route — 3.4 packet-lengths — whatever
the route's length. An eight-tenths-of-a-unit loop inside the Core and a
two-and-a-half-unit trunk therefore carried *identical* ink over their own spans:
the Core saturated into bright hooks while the trunks thinned into wire. That one
expression produced both halves of the complaint.
→ Density is now **per world unit of route** (`deriveRouteDashDensity`), and
packet length is a **world-unit quantity divided by the curve's own length**, so a
packet is the same streak wherever it runs.

**1.2 A packet could be most of its own route.**
The Core's ingress reaches are a sixth of a world unit long. A packet sized for a
trunk overhung both ends of its own reach, and a bent reach rendered that overhang
as a white hook laid across the hull.
→ `PACKET_LENGTH_CURVE_SHARE = 3`: a packet is never more than a third of its route.

**1.3 The count floor was a coverage floor.**
`MIN_PACKETS_PER_CURVE` was 3. On a reach that short the packet is already capped
to a third of it, so three of them lit the reach end to end: a saturated reach
renders as a solid bar, and a bent one as a chevron. Short runs are supposed to be
the *sparsest* part of the field.
→ The floor is 1. A route is never silently dropped; it is also no longer forced
to a coverage it has not earned.

**1.4 The hero Core was two pointed lenses on a stick.**
Every main hull's sections collapsed toward a tip (`t: 1 → 0.10/0.08`) under a
high chamfer (0.34/0.40), so the body tapered over its whole length and ended in a
point.
→ The taper now lives in the last eighth of the length, where a machined chamfer
lives, and the body closes on a real face. Chamfers are 0.22/0.26. The rule is
written on `HULL_UPPER` itself.

**1.5 A focused GRAPHICS was one blank white card with three edges behind it.**
The front layer was both the largest plate *and* the only `anchor` tier — the
brightest baked colour in the palette — so focus read as a white slab with
cardboard behind it.
→ All four layers are `primary`/`secondary`, near-equal in size, with real cant.

Separately, the 3.5.2 brief's §5 mid-tone divergence was **already fixed** by
`e30e427` before this stage began, and the 3.5.2 brief was never updated. §6 below
carries the measurement.

---

## 2. Changed, deleted, replaced

**Deleted:** `deriveDashesPerRoute`, `RouteDashAttributes.dashesPerRoute`,
`RouteFieldSample.dashesPerRoute`, and the hard-coded `--coords graphics=1180,640`
regeneration path. `FOREGROUND_SLICES` — the foreground slab set that read as
loose rectangles — is gone; one controlled foreground chip remains.

**Replaced:**

| Was | Is |
| --- | --- |
| packet count per curve | `deriveRouteDashDensity` (per world unit) + `deriveCurveDashCounts(curves, density, capacity?)` |
| progress-sized packets | `ROUTE_PACKET_LENGTH` in world units, capped by `PACKET_LENGTH_CURVE_SHARE` |
| `MIN_PACKETS_PER_CURVE = 3` | `1` |
| hulls tapering to a point | sectional hulls tapering in the last eighth |
| `anchor`-tier GRAPHICS front plate | four near-equal canted `primary`/`secondary` layers |
| escape verdict = focus cleared | escape verdict = focus **and hover** cleared |
| readiness = coarse signature stable | reduced motion: readiness = **byte-identical** frames |

**Added:** `src/scene/routing/routeContract.ts` (graph-neutral routing contract:
`CORE_ROUTE_GROUP`, `DOMAIN_ROUTE_GROUP_BASE`, `TRUNK_ROUTE_GROUP_BASE`,
`MAX_ROUTE_GROUPS`) so `coreCirculation.ts` no longer imports `graphRoutes.ts`;
`SurfaceInput.presence` in `surfaceResponse.ts`, the one input that can take a
surface *below* its resting response, which is what "the other domains recede"
needs and what brightness alone cannot express.

---

## 3. The field, measured

Numbers from the real derivation (`deriveGraphLayout(GRAPH_MANIFEST)` +
`deriveCoreStructure({structureDetail: 1})` + `deriveCoreCirculation` +
`deriveGraphRouting`), not from a fixture:

```
density 13   curves 22   units 18.76   packets 244   coverage 1.30
```

Longest curves: 2.63 (34 packets), 2.12 (28), 1.77 (23), 1.64 (21), 1.61 (21).
Core spine streams 1.10–1.12 (14–15 each). Shortest reaches 0.13–0.32 (2–4 each).
`ROUTE_VISIBILITY_FLOOR = 0.12`, `RIBBON_CHANNEL_GAIN = 0.28`,
`WEBGL2_DASH_CEILING = 360` (a guard, not a governor — `capacity` scales the whole
field uniformly rather than truncating the packed order).

At ULTRA: `advected ? 2 + detail*11 : 1 + detail*4` → 13/unit on WebGPU,
5/unit on the instanced fallback. The measured frame reports
`renderedFieldSamples: 459`, `activeSignalSamples: 92`.

**Measured, not asserted, by the harness.** The console collector now expands
object arguments over their CDP handle (`Runtime.callFunctionOn` →
`JSON.stringify`), because a preview is truncated and the renderer telemetry
snapshot is the one console object whose whole value is the evidence:

```json
{"fps":64.1,"frameTimeMs":15.6,"drawCalls":884,"triangles":0,"geometries":55,
 "textures":2,"particleCount":459,"configuredFieldBudget":72000,
 "renderedFieldSamples":459,"activeSignalSamples":92,"backend":"webgpu",
 "quality":"ultra"}
```

`particleCount` is gone as an input and derived from `renderedFieldSamples`, as
the brief required.

---

## 4. Interaction evidence — and where the old evidence was wrong

The 3.5.2 harness trusted `--coords graphics=1180,640`, a fixed point that missed
the pick zone at 1920×1080. Its "hover" and "focus" frames showed an untouched
scene. `--coords` is now a failure when it misses, and the default path derives
candidate positions from the GRAPHICS label's **real DOM bounding rect** and
accepts one only once the DOM reports the expected state class. A miss pushes an
`interaction-not-landed` failure and **skips the screenshot**.

**Two holes found in this stage's own evidence chain, both closed:**

1. **Escape proved less than it claimed.** The verdict asserted focus had cleared
   but not that hover had. The harness parks the pointer at `(4,4)` — the corner
   the header bar covers — so the canvas never received a `pointermove`, R3F kept
   its last hovered node, and the routing flow target stayed bent toward GRAPHICS
   after Escape. Coincidentally the whole symptom: the Escape frame was a *hover
   frame with an idle camera*, and it differed from the overview by 11 KiB. The
   park is now verified (hovered set must go empty, with two fallback positions
   that are unambiguously inside the canvas) and a park that never lands fails the
   run. `readDomainState` carries `hoveredNames`; the escape verdict requires it
   empty. After the fix, Escape and overview show **the same composition** —
   identical camera and labels, only the packet phase differs.

2. **Reduced motion was measured too loosely.** Readiness used a coarse 16×16
   signature, which an asymptotically easing camera passes: two independent
   reduced-motion captures came back differing on 174 pixels of scene (0.01%,
   max delta 14/255). Under `--reduced-motion` the bar is now byte equality.
   Reduced motion is genuinely stopped — two independent runs are byte-identical
   at the **default** settle:

   ```
   b0b5cc37fcfb11ff9f4d43b47bdb4db5  rm-e/…-overview-reduced.png
   b0b5cc37fcfb11ff9f4d43b47bdb4db5  rm-f/…-overview-reduced.png
   ```

Neither of these was a scene defect. Both were the harness accepting a weaker
claim than the one being reported.

---

## 5. WebGPU against WebGL2, measured

Same frame, same state, point samples on structural surfaces:

| point | WebGPU | WebGL2 | Δ |
| --- | ---: | ---: | ---: |
| core upper hull | 93 | 90 | +3 |
| core lower hull | 137 | 133 | +4 |
| core spine | 62 | 56 | +6 |
| core void (route ink passes through) | 52 | 43 | +9 |
| graphics plate | 29 | 26 | +3 |
| game-analysis frame | 81 | 79 | +2 |
| systems plate | 35 | 34 | +1 |
| background | 19 | 18 | +1 |

Histograms, 1920×1080 overview: p10/p50/p90/p99 = 16/27/86/181 against
15/24/83/175. At 2560×1440: 5/18/52/178 against 5/17/48/172. Grayscale variants
agree to the same order.

**The 3.5.2 divergence is gone.** That brief recorded p50 4 against 26 — a ratio
of 0.58 — and it was real: `MeshBasicNodeMaterial`'s colour node read
`baseColor * vertexColor()` and three's `setupDiffuseColor` multiplied by
`vertexColor()` again, so every baked facet luminance was applied twice and
mid-tones were squared. Fixed in `e30e427`.

The residual +1…+4 levels are **not** material: they track WebGPU's denser route
field (244 packets at 13/unit against ~94 at 5/unit) bleeding through the sampled
regions, and they are uniform across a 4×4 grid rather than localised to any
surface. No systematic mid-tone divergence remains between the backends.

---

## 6. Acceptance matrix

```
node scripts/stage352-capture.mjs --base-url http://localhost:3000 \
  --out <dir> --backend <webgpu|webgl2> --quality <ultra|safe> \
  --sizes 1920x1080,2560x1440 \
  --states overview,hover-graphics,focus-graphics,escape \
  --thumb 480x270 --text-hidden --grayscale
# add --reduced-motion for the reduced-motion artifacts
```

`--coords` is not used and must not be: the pointer position is derived from the
DOM and a miss fails the run. `--dry-run` validates a matrix without a browser.

| Batch | Files | Console |
| --- | ---: | --- |
| webgpu / ultra / 1920×1080 + 2560×1440 / 4 states / thumb / notext / gray | 26 | error 0, fatal 0 |
| webgl2 / ultra / same | 26 | error 0, fatal 0 |
| webgpu / safe / 1920×1080 / overview | 2 | error 0, fatal 0 |
| webgl2 / safe / 1920×1080 / overview | 2 | error 0, fatal 0 |
| reduced motion × 2 independent runs + webgl2 reduced | 6 | error 0, fatal 0 |

Every batch reported `OK - all captures written, no fatal console output`. Local
only — `.gitignore` excludes `artifacts/`.

**Criterion by criterion:**

- *Harness proves interaction landed* — yes; a miss is a failure, not a frame. §4.
- *Overview and focus visibly different* — yes, and by construction: focus reframes
  the camera so the Core sits in the right third and GRAPHICS in the left third,
  unfolds GRAPHICS into its four canted layers, and leaves one title and one line
  of description.
- *No giant black slab at 2560* — gone. The Core's hulls are lofted, not scaled
  boxes, and `LOCAL_BOUNDS` keeps the mass inside the frame.
- *Core first subject in the 480×270 thumbnail* — yes. Brightest and largest
  single form, centred, with the five domains as darker frames around it.
- *Composition holds with text hidden* — yes; `--text-hidden` frames are captured
  for all four states at both sizes.
- *Domains are processing regions, not icons* — GRAPHICS is four canted
  near-equal framebuffer layers; the others are layered frames and plates.
- *WebGPU's advantage is a structured flowfield* — 244 packets at 13/unit and
  coverage 1.30, evaluated in the vertex shader from attributes uploaded once;
  WebGL2 drives a bounded instanced set at 5/unit.
- *No systematic mid-tone divergence* — measured, §5.
- *Reduced motion: two identical samples* — byte-identical, §4.
- *SAFE preserves Hero identity* — same hulls, spine, void and ports at lower
  detail; the instanced route fallback is visibly sparser.
- *ULTRA's improvement is not more random points* — it is density per unit of
  route, GPU advection, and structure detail; the packet count is derived from
  route length rather than from a budget.

---

## 7. Corrected claims

Two statements in `docs/STAGE352_REVIEW_BRIEF.md` are wrong and should not be
carried forward:

1. §5 reports the node-material mid-tone divergence as open. It was fixed in
   `e30e427`, before this stage began. §5 above carries the measurement; §6 of
   that document now carries a supersession note.
2. §6 offers `--coords graphics=1180,640` as the regeneration command. That
   command now **fails by design** — the point misses the pick zone, and a miss
   is a failure rather than a screenshot.

---

## 8. Remaining, real

Stated plainly so a reviewer does not have to find them:

- **The pockets read faintly detached.** The three secondary processing pockets
  are stubs standing on canted hull surfaces, so at some camera angles the join is
  a soft shading boundary rather than a visible seat. Costed but not fixed: it
  needs the pockets placed on the hull's actual surface with its actual normal.
- **RESEARCH is very dark** at idle — the intended "dormant silhouette" treatment,
  but it is at the edge of readable on a dim display.
- **The instanced fallback still reads as evenly spaced dashes.** At 5/unit the
  eye resolves segments. That is the deliberate low-density fallback and the
  reason WebGPU exists, but it is the weakest visual tier and is what a WebGL2-only
  reviewer will see.
- **`deriveRouteDashAttributes` still packs every curve of the field into one
  ordered buffer per class.** Bounded by `WEBGL2_DASH_CEILING` on the instanced
  path and unbounded on the advected one; the advected path has no CPU pass, so
  this is a build-time cost, not a per-frame one — but it is a build-time cost that
  grows with route length.
- **No automated visual regression.** The matrix is captured and inspected, not
  compared against a baseline. Every finding above came from reading a frame.

---

## 9. Boundaries not crossed

RendererRuntime still owns backend/quality/DPR/lifecycle; `SceneHost` remains the
semantic integration boundary; `CameraController` owns camera behaviour;
ComputeCore does not import Graph/Command/Agent; Graph/Command core does not
import Three.js or R3F. No dependency was added, installed or modified. The
Command Bus and Graph schema are untouched, as are domain semantic ids,
deterministic descriptor architecture, truthful telemetry, reduced motion,
quality propagation and resource lifecycle. Stage 6 has not been started: no
command palette, parser, Agent, Ollama, SSE, Agent Trace or Developer Overlay.

Every new geometry, material, buffer and storage resource is disposed.
