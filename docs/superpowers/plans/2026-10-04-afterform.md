# AFTERFORM Visual Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the complete AFTERFORM visual presentation site: a live four-stage sculpture journey, native-scroll chapter navigation, responsive static fallbacks, and optional synthesized ambient audio.

**Architecture:** The root agent builds the live Three.js sculpture and metal shader in `ExperienceCanvas`, and owns page/layout integration and final serial verification. The reference agent owns the deterministic journey progress, quality budget, and their tests. This UI agent provides the `Showcase.tsx` client shell, CSS module, synthesized audio toggle, and optimized storyboard fallback. Canvas is dynamically mounted only after the reduced-motion preference is known.

**Tech Stack:** Next.js 16, React 19, Three.js 0.186, React Three Fiber 9, Drei 10, TypeScript, CSS Modules, browser IntersectionObserver and Web Audio APIs; no added dependencies.

**Spec:** `docs/visual-showcase/2026-10-04-afterform-design.md` and the implementation decisions supplied by the parent task.

## Global Constraints

- UI agent modifies only `src/visual-showcase/Showcase.tsx`, `src/visual-showcase/showcase.module.css`, `src/visual-showcase/AudioToggle.tsx`, and `public/afterform/*`; root owns `ExperienceCanvas.tsx` and page/layout integration; the reference agent owns `journey.ts` and its tests.
- Do not add dependencies or commit changes.
- Read the local Next.js client-component and CSS guides before implementation.
- `ExperienceCanvas` is a default dynamic import with `ssr: false`, rendered only after reduced-motion preference is known and only when reduced motion is off.
- Canvas props are `{ onReady: () => void; onFailure: () => void; reducedMotion: boolean }`.
- Preserve native scrolling, native chapter anchors, keyboard access, a 64px maximum header, 44px minimum touch targets, and visible focus.
- Static frame source is the four-panel storyboard; static fallback and reduced-motion presentation must work without mounting the Canvas.
- Audio is off by default; create an AudioContext only after an explicit button click and clean up on unmount.
- Do not describe performance as measured; no fake loading delay.

## Review Focus

- Reduced-motion users must not download or mount the Canvas; verify the Canvas is absent after enabling the system preference and reloading.
- JavaScript-disabled or pre-hydration rendering must still expose the title, chapter content, and static first frame.
- WebGL initialization failure and context loss must show a readable fallback and retry action.
- At 390×844, navigation and hero copy must not overlap or create horizontal overflow.
- Audio must stay silent until clicked and stop or suspend when the page is hidden or the component unmounts.

---

### Task 1: Live sculpture and scene lifecycle (root agent)

**Files:**
- Create or modify: `src/visual-showcase/ExperienceCanvas.tsx`
- Create or modify: `src/visual-showcase/sculpture.ts`
- Create or modify: `src/visual-showcase/materials.ts`

**Interfaces:**
- Consumes: `getJourney(progress)` and `getQuality(mobile)` from `journey.ts`.
- Produces: default `ExperienceCanvas({ onReady: () => void, onFailure: () => void, reducedMotion: boolean })`; one full-screen live canvas with real ribbon geometry, silver shader, camera response, and particles.

- [ ] Build the procedural sculpture geometry and particle field using Three.js resources with explicit disposal.
- [ ] Add the silver and dust shader materials and animate camera, form, melt, fracture, echo, and pointer response from the shared journey state.
- [ ] Pause the frame loop while the document is hidden; signal first rendered frame with `onReady`; signal WebGL fallback or context loss with `onFailure`.
- [ ] Verify the component stays within the declared props contract and does not add unrelated scene modules or dependencies.

### Task 2: Continuous journey and quality budget (reference agent)

**Files:**
- Create or modify: `src/visual-showcase/journey.ts`
- Create or modify: `src/visual-showcase/journey.test.ts`

**Interfaces:**
- Produces: `getJourney(progress)` with normalized form, melt, fracture, echo weights and chapter index; `getQuality(mobile)` with DPR and particle budgets.

- [ ] Define bounded progress clamping and smooth transitions for all four stages.
- [ ] Set desktop DPR cap 1.5 and mobile DPR cap 1; return device-appropriate particle counts.
- [ ] Add tests for boundaries, monotonic transitions, finite normalized values, and desktop/mobile quality values.
- [ ] Run the focused journey tests and report their result to the root agent.

### Task 3: Showcase layout and chapter controls (UI agent)

**Files:**
- Modify: `src/visual-showcase/Showcase.tsx`
- Modify: `src/visual-showcase/showcase.module.css`
- Create: `public/afterform/storyboard.png`

**Interfaces:**
- Consumes: default `ExperienceCanvas` from `./ExperienceCanvas`, with `onReady`, `onFailure`, and `reducedMotion` props; existing native browser scroll behavior.
- Produces: default-exported `Showcase` component; four sections with IDs `form`, `melt`, `fracture`, `echo`; static storyboard fallback at `/afterform/storyboard.png`.

- [ ] Copy `docs/visual-showcase/afterform-storyboard.png` to `public/afterform/storyboard.png` without altering its image content.
- [ ] Implement a client component that delays its reduced-motion decision until mount, conditionally renders the no-SSR dynamic Canvas only when motion is allowed, and retains static SSR content.
- [ ] Add a single 64px-or-shorter header with AFTERFORM, FORM/MELT/FRACTURE/ECHO anchor links, active `aria-current`, and the audio control.
- [ ] Add four 130dvh sections, native anchors, title/copy, exact chapter phrases, and a final replay link to `#form`; use an IntersectionObserver to update the active chapter.
- [ ] Add Canvas-ready fade-in, initialization/context-loss fallback text and retry action, and static storyboard state for reduced motion.
- [ ] Style the graphite background, responsive hero and sections, focus-visible state, compact rectangular controls, safe-area spacing, and touch targets; prevent horizontal overflow at 390px.
- [ ] Verify `src/visual-showcase/ExperienceCanvas.tsx` exports the promised default component before wiring the dynamic import; coordinate only through that interface.
- [ ] Run `npm run typecheck` and inspect the page in a browser at desktop and 390×844 widths; verify native anchor navigation, active chapter state, and fallback rendering.

### Task 4: Optional synthesized ambient sound (UI agent)

**Files:**
- Create: `src/visual-showcase/AudioToggle.tsx`

**Interfaces:**
- Produces: default `AudioToggle` component with accessible button label and visible `Sound off` / `Sound on` text; no props required.

- [ ] Implement a default-off toggle that creates a low-level ambient Web Audio oscillator graph only in the click handler.
- [ ] Suspend audio while `document.visibilityState` is hidden; resume only when sound remains enabled and the page becomes visible.
- [ ] Stop nodes, remove listeners, and close the AudioContext during cleanup; handle unsupported AudioContext without breaking the page.
- [ ] Verify the toggle starts silent, responds to click and keyboard activation, and releases audio on unmount; run `npm run typecheck`.

### Task 5: Route integration and full verification (root agent)

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/layout.tsx` only as required for the showcase route and document metadata
- Verify all plan outputs.

**Interfaces:**
- Consumes: `Showcase`, `AudioToggle`, Canvas callbacks, storyboard public asset, and chapter-progress behavior supplied by the reference agent.

- [ ] Replace the existing page with the AFTERFORM showcase entry and update layout metadata only as needed.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` serially after all parallel interfaces are present.
- [ ] Browser-check desktop and mobile layout, chapter transitions, reduced-motion static frames, retry behavior, focus visibility, and silent-by-default audio.
- [ ] Confirm no horizontal overflow, no missing asset requests, and no Canvas import in reduced-motion mode.
