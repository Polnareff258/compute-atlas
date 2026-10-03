# Water-ink relief implementation checkpoint (2026-10-03)

This is an implementation checkpoint, not a visual-quality completion claim.

## Direction

Both modes are water-ink. Default `relief` is a raised, layered pigment landscape;
alternate `ink` retains the lower river interpretation. Neither should become solid
rock, metallic terrain, a bright route polyline, or unrelated visual styles.

## Implemented

- Page-visible 山水 / 河流 selection; URL `visual=relief|ink`, default relief.
- URL external-store subscription preserves SSR hydration and avoids effect-driven state initialization.
- One renderer, simulation, camera controller and graph state across switches.
- Independent `inkReliefMaterial.ts` for the default main surface. Broad field sampling,
  slowly shearing pigment folds, optical absorption, local semantic colour response,
  pressure-driven displacement and colour. No primary-route emissive contour.
- Relief convergence sheets regain arch/torsion with rounded asymmetric curvature;
  their pressure response samples the existing world field.
- Lower, oblique relief framing for idle and scroll; smooth camera clearance floor.
- Geometry and material disposal effects separated so replacing a mode's materials
  cannot dispose geometry still mounted in the other mode.

## Evidence

- Fresh TypeScript and scoped ESLint checks pass; full suite: 40 files / 320 tests pass.
- Latest locally inspected WebGPU idle:
  `artifacts/codex-reconstruction/2026-10-03-ink-relief-pass4/stage356-webgpu-ultra-1920x1080-idle.png`.
- This capture reports WebGPU Ultra, 1920×1080, console error 0 / fatal 0.
- Additional interaction/backend evidence is under
  `artifacts/codex-reconstruction/2026-10-03-ink-relief-final`.
- Earlier pass1/pass2 and `ink-relief-verified` captures predate the independent relief material.
  Do not use them as final material evidence.

## Remaining acceptance gaps

The wide ink volume and removal of the conspicuous diagnostic line are an improvement,
but several folds still read as overlapping sheets. More natural pigment breakup,
less uniform cyan, and intentional focal detail remain art tasks. This is not yet a
claim of Lusion-level finish. No 2560×1440, focused-mode switch, repeated-switch resource
count, or frame-rate invariance acceptance was performed in this checkpoint.

No commit or push was performed. Preserve the existing dirty worktree.

## Continued art pass

- Replaced relief-only absolute-value tapers with squared envelopes to remove
  centre-axis derivative cusps. A new test checks tangent continuity on both axes.
- Reduced convergence tilt, broadened its wash and quieted the additive filaments.
  Both material axes now feather before the mesh boundary; idle membranes are less opaque.
- Added anisotropic warped pigment breakup, darker pooling and violet/cobalt
  suspended veins to the independent relief material. These use the existing
  flow phase; no new clock or interaction simulation was introduced.
- Separated TerrainView geometry and material cleanup dependencies as well.
- Pass5 evidence is under `2026-10-03-ink-art-pass5-after`. It still shows a
  somewhat uniform cyan mass and overlapping central sheets. Pass6 reduces that
  sheet prominence; its browser evidence must be inspected before claiming it
  achieves the intended water-ink finish.

Pass6 WebGPU 1920 idle and drag-during were inspected directly. The drag has a
local blue/cyan chromatic response. The central contour still contains visible
overlapping sheets; pigment remains broader and more uniform than the reference.
Evidence: `artifacts/codex-reconstruction/2026-10-03-ink-art-pass6` (1920 and 2560
idle, scroll and drag PNGs, plus 480×270 thumbnails). Do not equate this capture
with artistic acceptance or frame-rate invariance verification.

Latest browser verification covers real WebGPU Ultra at 1920×1080 and 2560×1440
for idle, scroll and drag, with console error 0 / fatal 0 throughout. WebGL2 Safe
at 1920×1080 also reports console error 0 / fatal 0. These are runtime stability
observations only and do not change the remaining visual-quality gaps above.
