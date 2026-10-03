# Stage 3.5.8 — Dual Visual Environments

**Date:** 2026-09-23
**Status:** Draft for user review
**Product:** POLNAREFF SYSTEM
**Decision:** Sculptural water-ink relief is the default; a flatter water-ink river is the alternate environment selectable on the page. Both use the same fluid pigment language.

## 1. Why this change exists

The September 23 ink iteration is not an adequate replacement for the preceding relief composition. At 1920×1080 and at 480×270, its mineral-yellow route becomes the dominant shape while the dark body reads as haze. The result is a thin drawn line rather than a substantial flowing river. Raising line intensity or adding more filaments would reinforce the defect.

The earlier multi-layer relief has a stronger silhouette, overlapping surface planes and orientation-dependent luminance, but its lower foreground is too empty and its distant crest can still resemble a generic mountain range. It must be refined, not merely restored. The target is an abstract computational landscape with visible mass, internal flow and a deliberate near/middle/far composition—not a realistic mountain photograph or a reactor.

Visual evidence to compare during implementation:

- Relief starting point: `artifacts/codex-reconstruction/pass63-final-polish/stage356-webgpu-ultra-1920x1080-idle.png`.
- Current ink symptom: `artifacts/codex-reconstruction/2026-09-23-final-visual-check/final-webgpu-ultra-webgpu-ultra-1920x1080-idle.png` and its 480×270 thumbnail.
- The historical pre-ink basin/volcano implementation is **not** the restoration target. Reuse its algorithms only where they serve the approved relief composition.

## 2. User-visible behavior

With no mode specified, the first visit opens in **Relief**. A compact, accessible `Relief / Ink` switch sits at the edge of the composition, below the masthead's information hierarchy. It is a mode choice, not a diagnostic control. It must not look like a sci-fi HUD, cover the main structure, or require a keyboard shortcut to discover.

Selecting **Ink** shows the alternate water-ink environment. Selecting **Relief** returns to the sculptural environment. The selection changes the visual interpretation and its camera framing, not the underlying world, graph, command bus or renderer. A mode switch must not replay boot, reset the current scroll position, clear graph focus, or replace the `CameraController`. Reduced-motion users receive an immediate or very short non-animated change.

The control is the primary interface. `?visual=relief|ink` initializes the selection for captures and shared links; clicking the control updates this parameter with `history.replaceState` without navigation. Unknown values resolve to Relief. Do not use local storage to override the deterministic default.

## 3. Art direction — Relief (default)

Relief recovers the earlier six-layer convergence's sense of mass while changing its composition from a narrow distant ridge to a broad, asymmetric computational landform. The strongest processing volume occupies the middle-right and extends into the lower foreground; one side may leave the viewport. The top-left remains quiet enough for the masthead. At 1920×1080, some lit or textured part of the form reaches into the lower quarter without filling that whole quarter uniformly. At thumbnail size the viewer must perceive one dominant three-dimensional structure, not a line, fog bank or row of similar peaks.

Its form consists of unequal, overlapping pigment folds rising into an asymmetric ink landscape. This is water-ink with relief, not solid graphite, stone, metallic plates or realistic terrain. Broad rounded ridges must dissolve into translucent washes; narrow troughs collect deeper pigment. Crests vary in width, curvature and height rather than repeating parallel peaks. The earlier version's indigo/cobalt depth and cyan ink diffusion are the starting point, with restrained silver-violet interference and only isolated mineral highlights. Surface orientation and layered absorption separate near and far folds without outlining every crest. Avoid broad bloom, stars, grid floors, decorative particles and regular contour lines.

Flow must affect the body rather than trace it. The authored river and shared ink field create broad depressions, directional shearing, suspended pigment and travelling compression within the relief. Ink concentrations stretch, curl and diffuse through the raised folds, with slow coherent deformation rather than random surface noise. Pointer drag bends the local pigment and launches a damped ripple with a slight colour shift; the ripple must feel coupled to the ink, not laid over hard rock. Hover and focus concentrate activity around the selected domain. Foreground washes contribute parallax and scale while leaving deliberate openings. A continuous emissive polyline is not a substitute for water.

## 4. Art direction — Ink (alternate)

The present violet/gold work is preserved as a development starting point, **not accepted unchanged as a finished option**. Its primary subject must become a broad, winding, density-bearing flow with asymmetric diffusion, eddies and persistent directional motion. The gold becomes a sparse bank-local mineral glint and occasional compression accent. A 480×270 image must still read as dark fluid moving through a lighter medium if the gold is hidden.

The ink variant may use flatter framing and more translucent field coverage than Relief. It must not inherit Relief's sculptural ridge merely recoloured purple, nor manufacture its river from an independent screen-space line. The moving pigment, drag ripple and highlights must derive from the same deterministic route/field coordinates so they remain spatially connected during scroll and focus.

Both environments share water-ink material behavior, restrained typography and the same five semantic domains. Relief is an oblique, volumetric ink landscape; Ink is a lower, broader river-like arrangement. The distinction is spatial form and camera choreography, not rock versus fluid. They are two interpretations of one computational world, not unrelated mini-sites.

### Reference use (updated 2026-10-03)

- Active Theory: https://activetheory.net/work . Study the live site's scroll continuity and transitions. The fetched HTML alone is a JavaScript shell and does not establish the rendered motion.
- Lusion project description: https://lusion.co/projects/ddd_2024/ . Its actual interactive launch target is https://1105-ddd2024-homepage.lusion.co/ . Do not mistake the case-study page for the complete experience.
- The onformative river video remains the pigment/flow reference, not a license to reduce the subject to a yellow route line.
- Public HTML snapshots may be kept under `artifacts/references/2026-10-03` for inspection. Do not import reference code or third-party media into the shipped site. HTML is supporting evidence; live visual observation and our own captured frames remain necessary.

## 5. Architecture and ownership

Introduce a narrow `VisualMode = 'relief' | 'ink'` selection owned by `RendererHost`. Pass it to `SceneHost`; do not put it in the graph schema, command semantics, GPU simulator or quality profile. `SceneHost` remains the semantic integration boundary and mounts exactly one mode-specific visual root. The current mount seam is the `TerrainView` / `RiverView` / `ConvergenceView` block near the end of `src/scene/SceneHost.tsx`.

The mode-specific roots own their geometry, material profiles and composition. Avoid one giant shader full of `mode === ...` branches: the relief and ink art directions must be independently tunable. Share `WatershedDescriptor`, deterministic courses, `InkField`, `FieldUniforms`, graph interaction, domain IDs, quality and renderer backend. Keep one `CameraController` as the sole camera writer; provide it mode-specific idle, hover, focus and scroll poses. A change at a nonzero scroll position blends toward the new mode's pose for that same progress instead of jumping back to the top. Mode-only geometry and materials dispose when unmounted; the shared field and runtime continue.

The current dirty worktree contains uncommitted visual changes. Implementation must preserve them while separating the modes. Do not reset the tree or copy an old commit over shared systems. In particular, do not revive the old `BasinView` wholesale and do not modify `RendererRuntime`, backend detection, telemetry semantics or the agent boundary as part of this visual slice.

## 6. Transition and interaction

The switch uses a restrained editorial transition no longer than 0.8 seconds: briefly lower visual exposure, reframe through `CameraController`, then reveal the selected environment. It must not keep two fullscreen translucent scenes superimposed during normal use; that produces ordering artifacts and confuses visual hierarchy. The transition is reversible and does not require a renderer restart. During the short handoff, pointer drag must not inject a stale brush hit into the newly selected image.

For both modes, scrolling remains continuous and reversible. Hover, focus and Escape continue to use the existing graph interaction state. The same domain selection must have recognisable consequences in either mode, though its surface response may differ. Reduced motion holds ambient deformation and skips the animated mode transition while preserving direct pointer interaction.

## 7. Quality and verification gates

Quality tiers alter tessellation, field resolution and optional secondary layers, not the fundamental silhouette. SAFE and WebGL2 must still show a recognisable Relief hero and a real Ink body. ULTRA should gain richer field deformation and surface response, not random extra points.

Implementation is not accepted on tests alone. Capture each mode at 1920×1080 and 2560×1440, inspect a 480×270 thumbnail, and compare idle, 50% and 100% scroll, drag before/during/after, hover, focus and Escape. Verify WebGPU Ultra, WebGL2 Safe and reduced motion with no fatal console errors. Check that switching at 50% scroll and while focused preserves state and that repeated switching does not grow live geometry/material/target counts. Keep the current truthful telemetry contract.

Relief passes only if the old mass/depth is retained and its foreground no longer reads as an unused dark half-frame. Ink passes only if the fluid body is the primary visual at thumbnail scale and the yellow line can be removed without collapsing the composition. The final default screenshot must feel like a premium realtime computational environment before any label is read.

## 8. Out of scope

No Stage 6 agent implementation, new content system, new graph schema, new renderer, new dependency, automatic mode rotation, shader-demo gallery, or performance-driven cancellation of the approved art direction. A later agent may drive either environment through existing semantic state, but this slice creates no agent tools.
