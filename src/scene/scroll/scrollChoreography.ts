/**
 * The scroll story, as a pure function of how far down the page the visitor is.
 *
 * ## What this module is allowed to decide
 *
 * Everything about *the story* and nothing about the camera. It takes a normalized progress
 * and returns which act the page is in, how far into that act, how present the type is, and
 * four numbers that weight the composition's layers. It does not know where the camera is,
 * what a world is, or that three.js exists.
 *
 * That restriction is the brief's own and it is worth restating why: the scroll is an *input
 * source*, exactly like the pointer and the graph. `CameraController` owns the camera, applies
 * the damping, adds the handheld drift and resolves the final pose; the scroll supplies
 * intent. A scroll controller that wrote a camera position directly would be a second writer
 * of the one piece of state that decides what the frame looks like, and two writers of a
 * camera is a camera that fights itself the first time both are active. See
 * `heroShot.resolveScrollPose` for where this becomes a pose.
 *
 * ## Why the acts are weighted rather than switched
 *
 * Each act is a set of layer *weights*, and consecutive acts are interpolated. A story whose
 * acts were discrete would snap at every boundary, and the brief's requirement is a reversible
 * scroll with no cuts — a visitor scrolling back up must pass through exactly the frames they
 * passed through coming down. Interpolating weights makes that true by construction: the
 * returned state is a function of `progress` alone, so the same scroll position always
 * produces the same frame regardless of which direction it was reached from.
 */

export type ChoreographyStage = 'hero' | 'descent' | 'dissolution' | 'reveal';

/**
 * Where each act begins, as a fraction of the story.
 *
 * The brief's own numbers: the hero holds the first fifth, the descent takes it to just under
 * half, the material decomposition runs to three quarters, and the world reveal takes the
 * rest. Named rather than inlined because `deriveScrollChoreography` reads them in order and a
 * story whose boundaries are scattered through its own code is a story nobody can retune.
 */
const HERO_END = 0.2;
const DESCENT_END = 0.48;
const DISSOLUTION_END = 0.78;

export type LayerWeights = {
  /**
   * The 70% layer: wide pigment, soft boundaries. Present throughout, because it is the
   * composition's ground rather than an effect — but at its strongest during the
   * decomposition, which is the act about material rather than about place.
   */
  readonly pigment: number;
  /** The 20% layer: directional bedding. Rises as the camera drops and the flow is seen along its length. */
  readonly bedding: number;
  /** The 10% layer: the thalweg and the drag front. Highest where there is least else to look at. */
  readonly sharpness: number;
  /** The deposit granules, which the brief introduces only in the decomposition. */
  readonly granules: number;
};

export type ScrollChoreography = {
  /** Clamped to `0`..`1`. */
  readonly progress: number;
  readonly stage: ChoreographyStage;
  /** How far into the current act, `0`..`1`. */
  readonly stageProgress: number;
  /**
   * The type's presence, `0`..`1`.
   *
   * One number rather than a per-element set, because the brief asks for the text to leave
   * *quietly* and a set of independently animated elements is how a quiet exit becomes a
   * sequence of small events. The stylesheet applies this to every overlay layer at once.
   */
  readonly textOpacity: number;
  readonly layers: LayerWeights;
  /**
   * True once the story is complete and the scroll's own authority has settled.
   *
   * Reported rather than acted on here — see `cameraAuthority` for what is still owed before
   * this can mean "the frame is the visitor's again".
   */
  readonly released: boolean;
  /**
   * How much authority the scroll has over the camera, `0`..`1`.
   *
   * Eased in rather than switched, so the first pixel of scroll does not snatch the camera from
   * the resting shot, and then held — see below for why it no longer falls.
   */
  readonly cameraAuthority: number;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Smoothstep, for the boundaries between acts and for the authority's own ease-in. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Linear interpolation, clamped. */
function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t);
}

/**
 * The layer weights at each act's own boundary.
 *
 * Written as a table of the *resting* state of each act rather than as deltas, because the
 * numbers are what an art director would say out loud about each one, and a table of deltas
 * cannot be read without reconstructing the values it produces.
 */
const ACT_WEIGHTS: Readonly<Record<ChoreographyStage, LayerWeights>> = {
  // The hero is one subject and nothing else: the widest possible pigment, no granules, and the
  // sharpness at full — the meander's own line is the only crisp thing in it.
  hero: { pigment: 0.85, bedding: 0.45, sharpness: 1, granules: 0 },
  // The descent adds parallax and starts showing the flow's direction. Sharpness drops, because
  // the frame now has depth to read and a hard crest competes with it.
  descent: { pigment: 1, bedding: 0.8, sharpness: 0.62, granules: 0.15 },
  // The decomposition is about material: every layer at its fullest, because this is the act
  // whose whole content is that there are layers at all.
  dissolution: { pigment: 1, bedding: 1, sharpness: 0.45, granules: 1 },
  // The reveal returns to one sharp subject — the basin — with the material settled around it.
  // Granules drop back because a processing region is a place, not a sediment.
  reveal: { pigment: 0.8, bedding: 0.7, sharpness: 1, granules: 0.45 },
};

const STAGE_ORDER: readonly ChoreographyStage[] = ['hero', 'descent', 'dissolution', 'reveal'];

function mixWeights(from: LayerWeights, to: LayerWeights, t: number): LayerWeights {
  return {
    pigment: lerp(from.pigment, to.pigment, t),
    bedding: lerp(from.bedding, to.bedding, t),
    sharpness: lerp(from.sharpness, to.sharpness, t),
    granules: lerp(from.granules, to.granules, t),
  };
}

export function deriveScrollChoreography(progressInput: number): ScrollChoreography {
  const progress = clamp01(progressInput);

  let stage: ChoreographyStage;
  let stageStart: number;
  let stageEnd: number;
  if (progress < HERO_END) {
    stage = 'hero';
    stageStart = 0;
    stageEnd = HERO_END;
  } else if (progress < DESCENT_END) {
    stage = 'descent';
    stageStart = HERO_END;
    stageEnd = DESCENT_END;
  } else if (progress < DISSOLUTION_END) {
    stage = 'dissolution';
    stageStart = DESCENT_END;
    stageEnd = DISSOLUTION_END;
  } else {
    stage = 'reveal';
    stageStart = DISSOLUTION_END;
    stageEnd = 1;
  }

  const stageProgress =
    stageEnd > stageStart ? clamp01((progress - stageStart) / (stageEnd - stageStart)) : 1;

  /*
   * The weights at this exact progress.
   *
   * The blend is between the *current* act's resting weights and the next act's, driven by the
   * current act's own progress — so the frame changes continuously across a boundary rather
   * than stepping at it. Eased, so an act begins and ends gently: a linear blend between two
   * weight tables has a visible corner where it starts and stops.
   */
  const currentIndex = STAGE_ORDER.indexOf(stage);
  const next = STAGE_ORDER[Math.min(STAGE_ORDER.length - 1, currentIndex + 1)] ?? stage;
  const eased = smoothstep(0, 1, stageProgress);
  const layers = mixWeights(ACT_WEIGHTS[stage], ACT_WEIGHTS[next], eased);

  /*
   * The type leaves during the descent, and it leaves early in it.
   *
   * From `0.232` to `0.344` of the whole story — about a third of the way down the page the
   * picture is alone. The brief's constraint is that the hero is text-poor and the world is
   * text-free, and leaving the type until the decomposition would mean the frame's most
   * interesting passage is still competing with a title.
   *
   * Computed from *absolute* progress rather than from the act's own progress, and that is the
   * reversibility requirement rather than a stylistic choice: an act-relative fade is a
   * function of two numbers, and any two-number form can produce two different opacities for
   * one scroll position — which is a frame that differs depending on which direction the
   * visitor arrived from.
   */
  const textOpacity = 1 - smoothstep(HERO_END + 0.032, HERO_END + 0.144, progress);

  /*
   * Authority over the camera: it rises over the first two hundredths and then stays.
   *
   * **It used to fall again over the last seventh, and that was a visible defect.** The intent
   * was the brief's hand-off — "at the end, release the scroll camera control and enter the
   * existing free-interaction environment" — but releasing authority means the controller
   * blends back toward the shot it was playing, and that shot is the *opening* framing. So a
   * visitor who scrolled to the bottom arrived at the basin and then watched the camera travel
   * all the way back to where they started.
   *
   * Measured rather than argued, and the measurement came from somewhere unexpected: the
   * projected DOM label for the AI region sat at 981,389 at progress 0 and at 984,389 at
   * progress 1, having been at 885,619 in between. The pixel statistics had not caught it,
   * because the frames at 0 and 1 also differ in their material layer weights — so a changed
   * picture was read as a travelled camera when only the shading had moved.
   *
   * The hand-off is still owed, and it is now owed *correctly*: it needs the controller to
   * adopt the arrival pose as its own resting pose and then give up authority, so hover and
   * focus continue from where the story ended rather than from where it began. That is a change
   * to `CameraController`, and a falloff here was the wrong place to attempt it — a falloff can
   * only ever express "return", never "hand over".
   */
  const cameraAuthority = smoothstep(0, 0.02, progress);

  return {
    progress,
    stage,
    stageProgress,
    textOpacity,
    layers,
    released: progress >= 0.995,
    cameraAuthority,
  };
}

/**
 * How tall the scroll story is, as a multiple of the viewport.
 *
 * The brief asks for an opening of one and a half to two viewports, and that is the scrollable
 * *distance* rather than the document height: the document is one viewport taller than its
 * scroll range, because the last viewport of scrolling arrives at the bottom of the page.
 * `1.8` here means 2.8 viewports of document.
 */
export const SCROLL_VIEWPORTS = 1.8;

/**
 * The document height the story needs, in CSS pixels.
 *
 * Exported so the stylesheet and the reader agree on one number rather than two. The stylesheet
 * sets the spacer's height from this at runtime; there is no constant in the CSS for it,
 * because a copy of the number there is a copy that stops matching the moment this changes.
 */
export function scrollDocumentHeight(viewportHeight: number): number {
  return Math.round(viewportHeight * (1 + SCROLL_VIEWPORTS));
}
