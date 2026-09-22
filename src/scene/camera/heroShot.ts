import { CAMERA_FOV_DEGREES, type CameraPose } from './cameraController';
import { KEY_LIGHT } from '../watershed/shots';
import type { Rect, ShotFraming } from '../watershed/shots';
import type { Vector2 } from '../watershed/terrainField';
import type { Vector3, WatershedDescriptor } from '../watershed/watershedDescriptor';

/**
 * The resting framing of the ink composition.
 *
 * ## What the subject is
 *
 * The **convergence**, not one river. A probe of the live world prints seven courses,
 * and the widest of them is a near-straight diagonal. Framing that one alone composes a
 * single band receding into the distance — which is the "ribbon with sharp edges" the
 * first vision pass named, and it is a correct description: a straight band seen from an
 * oblique camera *is* a triangle. The world's actual subject is where the courses meet.
 * The basin at the centre is fed from several directions, so a frame that contains the
 * junction contains several curves at once.
 *
 * ## Pitch
 *
 * Steeper than the landscape framing this replaces, shallower than a map. Steep enough
 * that a meander's lateral wander sweeps across the frame, since a curve seen end-on
 * shows nothing; shallow enough that the frame still has a near edge, a far edge and a
 * direction of travel, which is what the veil needs in order to parallax and what a true
 * top-down view would destroy.
 */

/**
 * The eye's height as a multiple of the basin's radius.
 *
 * Just under two basin radii. The former overview height kept every domain and almost the
 * complete route in frame, which made the system read as a diagram. Idle is now a close
 * encounter with the convergence: foreground pigment is allowed to leave the viewport and
 * dormant regions are only hinted at. The scroll passage moves through the convergence rather
 * than restoring a diagrammatic overview.
 */
const EYE_BASIN_MULTIPLE = 1.86;

/** The eye's floor and ceiling, whatever the world's scale. */
const MIN_EYE = 260;
const MAX_EYE = 820;

/**
 * How far back along the course the eye sits, as a fraction of its own height.
 *
 * This, with the height, sets the standing pitch. It is also the parallax term: the near
 * ground of the frame is water, the far ground is the basin, and the veil's height is
 * chosen to separate from both.
 */
const BACKSTEP = 0.52;

/**
 * Where along the principal course the camera turns off, as a fraction of its arc length
 * measured back from the mouth.
 *
 * Near the mouth, so the camera stands at the head of the confluence with the course it
 * came down laid out ahead of it rather than behind.
 */
const STAND_AT = 0.46;

/**
 * How much of the way from the camera's own station toward the basin the view aims.
 *
 * **This is the composition's balance control, and it replaced aiming at the basin.**
 * Aiming at the basin put the whole subject in the lower third of the frame with two
 * thirds of empty ground above it: the camera was far enough back and high enough that
 * the confluence projected below the centre line, and everything above it was the far
 * field, which is where this world has nothing. Pulling the aim back toward the camera
 * steepens the pitch, and steepening the pitch fills the frame with the near course —
 * the thing actually worth looking at. The basin stays in frame either way; what changes
 * is how much of the picture is water rather than ground.
 *
 * Just under halfway keeps the convergence above centre while letting the near course occupy
 * the foreground. The tighter idle eye means this no longer has to pull back toward the camera
 * merely to fill empty ground.
 */
const AIM_TOWARD_BASIN = 0.74;

export type HeroVistaOptions = {
  /** `0`..`1`. Above the resting value the eye lifts a little, for hover response. */
  readonly lift?: number;
};

/** A course the ink system draws, as the framing needs it. */
export type HeroCourse = {
  readonly spine: readonly Vector2[];
  readonly width: number;
  readonly flowRate: number;
  readonly feeds: 'basin' | 'domain';
};

export function heroVista(
  descriptor: WatershedDescriptor,
  aspect: number,
  courses: readonly HeroCourse[],
  options: HeroVistaOptions = {},
): ShotFraming {
  const basin = descriptor.basin;
  const radius = Math.max(20, basin.radius);
  const eye = clamp(radius * EYE_BASIN_MULTIPLE, MIN_EYE, MAX_EYE);
  const lifted = eye * (1 + (options.lift ?? 0) * 0.1);

  const principal = principalCourse(courses, descriptor);
  const stand = atArc(principal.spine, 1 - STAND_AT);

  /*
   * The eye stands back along the course's *tangent*, not radially out from the basin. A
   * radial stand-off would put the camera somewhere the water is not and the frame would
   * open on empty ground; standing on the course means the near edge of the picture
   * always has water in it, which is the whole reason this reads as an approach rather
   * than as an aerial photograph.
   */
  const position: Vector3 = [
    stand.point[0] - stand.forward[0] * lifted * BACKSTEP,
    lifted,
    stand.point[1] - stand.forward[1] * lifted * BACKSTEP,
  ];
  const lookTarget: Vector3 = [
    stand.point[0] + (basin.centre[0] - stand.point[0]) * AIM_TOWARD_BASIN,
    0,
    stand.point[1] + (basin.centre[1] - stand.point[1]) * AIM_TOWARD_BASIN,
  ];

  const heroRegion: Rect =
    aspect >= 1.6
      ? { left: 0.14, top: 0.24, right: 0.88, bottom: 0.94 }
      : { left: 0.05, top: 0.24, right: 0.95, bottom: 0.94 };

  const focalDistance = Math.hypot(
    lookTarget[0] - position[0],
    lookTarget[1] - position[1],
    lookTarget[2] - position[2],
  );

  return {
    id: 'idleVista',
    position,
    lookTarget,
    focalDistance,
    fov: CAMERA_FOV_DEGREES,
    // A resting state. The controller's own drift keeps the frame alive, and the brief
    // forbids an orbit — the composition is the point.
    duration: 0,
    easing: 'linear',
    heroRegion,
    // The surface can be cut by up to the material's own scour depth and built by its
    // settle height, so a clearance in the hundreds is a guarantee rather than a
    // coincidence. Deliberately well under the eye height so the two are not the same
    // number restated.
    safeForeground: Math.max(140, lifted * 0.34),
    lightDirection: KEY_LIGHT,
    fogResponse: 0.6,
    typography: { anchor: 'bottom-left', titleScale: 0.34, reveal: 1 },
  };
}

/**
 * The course the camera stands on.
 *
 * The widest one that feeds the basin, because that is the one carrying the most water
 * into the junction and therefore the one whose approach the picture can be composed
 * along. Falls back to the widest course of any kind, and then to a straight line across
 * the world, so this cannot return nothing for an unusual descriptor — a framing function
 * that can fail is a framing function that fails on the one build nobody tests.
 */
function principalCourse(
  courses: readonly HeroCourse[],
  descriptor: WatershedDescriptor,
): { spine: readonly Vector2[] } {
  const ranked = [...courses].sort((a, b) => {
    const feedsBasin = (course: HeroCourse) => (course.feeds === 'basin' ? 1 : 0);
    const delta = feedsBasin(b) - feedsBasin(a);
    if (delta !== 0) return delta;
    return b.width * b.flowRate - a.width * a.flowRate;
  });
  const chosen = ranked[0];
  if (chosen !== undefined && chosen.spine.length >= 2) return chosen;

  const { extent } = descriptor.field;
  return {
    spine: [
      [extent.minX, extent.minZ],
      [extent.maxX, extent.maxZ],
    ],
  };
}

/**
 * A point on a polyline at a given fraction of its arc length, with its tangent.
 *
 * Walks the polyline rather than indexing it: the courses this receives are resampled
 * and unevenly curved, so `spine[Math.floor(t * length)]` would put the camera at a
 * different *place* for every world even when `t` was the same — and the camera's place
 * is what the whole frame is composed against.
 */
function atArc(
  spine: readonly Vector2[],
  t: number,
): { point: Vector2; forward: Vector2 } {
  if (spine.length < 2) {
    return { point: spine[0] ?? [0, 0], forward: [1, 0] };
  }

  let total = 0;
  for (let index = 1; index < spine.length; index += 1) {
    total += Math.hypot(
      spine[index]![0] - spine[index - 1]![0],
      spine[index]![1] - spine[index - 1]![1],
    );
  }
  if (total < 1e-6) return { point: spine[0]!, forward: [1, 0] };

  const target = Math.min(1, Math.max(0, t)) * total;
  let travelled = 0;
  for (let index = 1; index < spine.length; index += 1) {
    const a = spine[index - 1]!;
    const b = spine[index]!;
    const segment = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (travelled + segment < target) {
      travelled += segment;
      continue;
    }
    const local = segment < 1e-6 ? 0 : (target - travelled) / segment;
    return {
      point: [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local],
      forward: segment < 1e-6 ? [1, 0] : [(b[0] - a[0]) / segment, (b[1] - a[1]) / segment],
    };
  }

  const last = spine[spine.length - 1]!;
  const previous = spine[spine.length - 2]!;
  const segment = Math.hypot(last[0] - previous[0], last[1] - previous[1]) || 1;
  return {
    point: last,
    forward: [(last[0] - previous[0]) / segment, (last[1] - previous[1]) / segment],
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * The camera's pose partway down the scroll story.
 *
 * ## What it is not
 *
 * It is not a camera controller. This returns a *pose* — a position, a look target and a
 * field of view — and nothing here writes to a camera object. `SceneHost` hands the result
 * to `CameraController`, which blends it against the shot it is already playing, applies
 * its pointer damping and its handheld drift, and resolves the pose the frame is actually
 * drawn from. The scroll is therefore an input source alongside the pointer and the graph,
 * which is the boundary the brief draws and the reason there is no second writer of the one
 * piece of state that decides what the picture looks like.
 *
 * ## The four stations
 *
 * Two things change together as the story descends: the camera *travels* along the course,
 * and it *drops*. Travel alone would be a dolly and the brief forbids exactly that — "not
 * merely zooming the field of view or moving straight forward". Dropping alone would be a
 * crane shot over a place the visitor never approaches. Together they are the movement the
 * brief asks for: the camera lowers and advances along the river's own tangent, so the
 * near, middle and far layers separate as it goes.
 *
 * The numbers are fractions of the principal course's arc length and multiples of the eye
 * height the resting shot already set, so the whole descent rescales with the world rather
 * than being a set of world-unit constants that only work at one scale.
 */
export type ScrollStation = {
  /** Progress at which this station is held. */
  readonly at: number;
  /** Where along the course the camera stands, as a fraction of arc length. */
  readonly arc: number;
  /** Eye height, as a multiple of the resting eye. */
  readonly eye: number;
  /** Stand-off along the tangent, as a fraction of the eye's own height. */
  readonly backstep: number;
  /** How far from the station toward the basin the view aims, `0`..`1`. */
  readonly aim: number;
  /** Sideways travel along the course normal, as a fraction of eye height. */
  readonly lateral: number;
};

export const SCROLL_STATIONS: readonly ScrollStation[] = [
  // The resting shot, reproduced exactly. The authority easing means the scroll takes over
  // from this pose, so the two being equal is what makes the hand-over invisible.
  { at: 0, arc: 1 - STAND_AT, eye: 1, backstep: BACKSTEP, aim: AIM_TOWARD_BASIN, lateral: 0 },
  // The descent. Lower, closer to the mouth, and aiming further ahead now that the near
  // ground is worth looking at.
  { at: 0.48, arc: 0.56, eye: 0.74, backstep: 0.88, aim: 0.52, lateral: 0.16 },
  // The decomposition. Low and close; the flow is seen almost along its length.
  { at: 0.78, arc: 0.82, eye: 0.46, backstep: 0.98, aim: 0.78, lateral: 0.30 },
  // The reveal. Standing at the confluence, looking at the basin itself.
  { at: 1, arc: 0.97, eye: 0.33, backstep: 1.08, aim: 1, lateral: 0.34 },
];

/** Smoothstep, so a station is held rather than passed through at a corner. */
function stationEase(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * The sideways component of the scroll camera's path.
 *
 * Forward travel alone keeps the visible river on one screen axis and turns the
 * final reveal into a map-like column. A restrained move along the course normal
 * exposes the membrane spacing and makes the arrival a three-quarter view. The
 * function is separate so the choreography remains deterministic and testable.
 */
export function resolveScrollLateral(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  let lowerIndex = 0;
  for (let index = 0; index < SCROLL_STATIONS.length - 1; index += 1) {
    if (clamped >= SCROLL_STATIONS[index]!.at) lowerIndex = index;
  }
  const from = SCROLL_STATIONS[lowerIndex] ?? SCROLL_STATIONS[0]!;
  const to = SCROLL_STATIONS[lowerIndex + 1] ?? SCROLL_STATIONS[SCROLL_STATIONS.length - 1]!;
  const span = to.at - from.at;
  const t = span <= 1e-6 ? 1 : stationEase((clamped - from.at) / span);
  return mix(from.lateral, to.lateral, t);
}

/**
 * The pose the scroll asks for at a given progress.
 *
 * Continuous in `progress` by construction — every station is bracketed by the two around
 * it and the interpolation is a function of progress alone — which is what makes the scroll
 * reversible: the same position always resolves to the same pose, whichever direction the
 * visitor reached it from.
 */
/**
 * The reveal stays inside the computation.
 *
 * Earlier versions solved a camera height that contained all five domain discs.
 * The math was correct and the art direction was not: after the strongest close
 * passage, the camera retreated to a labelled overview and turned the last frame
 * back into a diagram. Domains are revealed through focus; the scroll ending is
 * allowed to remain a cinematic encounter with the confluence itself.
 */
const REVEAL_EYE_MULTIPLE = 0.63;

function revealStation(
  _descriptor: WatershedDescriptor,
  aspect: number,
  baseEye: number,
): ScrollStation {
  // Narrow frames need a little more breathing room because the confluence's
  // authored silhouette is wide. Desktop remains close enough that foreground
  // membranes may leave the viewport.
  const eye = baseEye * REVEAL_EYE_MULTIPLE * (aspect < 1.35 ? 1.12 : 1);

  return {
    at: 1,
    arc: 0.84,
    eye: eye / baseEye,
    backstep: 0.94,
    aim: 0.86,
    lateral: 0.44,
  };
}

export function resolveScrollPose(
  descriptor: WatershedDescriptor,
  aspect: number,
  courses: readonly HeroCourse[],
  progress: number,
): CameraPose {
  const resting = heroVista(descriptor, aspect, courses);
  const basin = descriptor.basin;
  const radius = Math.max(20, basin.radius);
  const baseEye = clamp(radius * EYE_BASIN_MULTIPLE, MIN_EYE, MAX_EYE);

  const clamped = Math.min(1, Math.max(0, progress));

  let lowerIndex = 0;
  for (let index = 0; index < SCROLL_STATIONS.length - 1; index += 1) {
    if (clamped >= (SCROLL_STATIONS[index]?.at ?? 0)) lowerIndex = index;
  }
  const from = SCROLL_STATIONS[lowerIndex] ?? SCROLL_STATIONS[0]!;
  const lastIndex = SCROLL_STATIONS.length - 1;
  // The final station is computed rather than tabulated: see `revealStation`. Every earlier
  // station stays a constant, because the approach is a composition and the reveal is a
  // measurement of the world it has to show.
  const to =
    // `>=`, not `===`: at progress 1 the loop above has already settled on the last
    // index, so the segment that has to use the computed station is the one where
    // `lowerIndex` *is* it. Written as `===` this never fired, which is exactly the
    // off-by-one the first version shipped with.
    lowerIndex + 1 >= lastIndex
      ? revealStation(descriptor, aspect, baseEye)
      : (SCROLL_STATIONS[lowerIndex + 1] ?? SCROLL_STATIONS[lastIndex]!);
  const span = to.at - from.at;
  const t = span <= 1e-6 ? 1 : stationEase((clamped - from.at) / span);

  const arc = mix(from.arc, to.arc, t);
  const eye = baseEye * mix(from.eye, to.eye, t);
  const backstep = mix(from.backstep, to.backstep, t);
  const aim = mix(from.aim, to.aim, t);
  const lateral = mix(from.lateral, to.lateral, t);

  const principal = principalCourse(courses, descriptor);
  const stand = atArc(principal.spine, arc);

  const position: Vector3 = [
    stand.point[0] - stand.forward[0] * eye * backstep - stand.forward[1] * eye * lateral,
    eye,
    stand.point[1] - stand.forward[1] * eye * backstep + stand.forward[0] * eye * lateral,
  ];
  const lookTarget: Vector3 = [
    stand.point[0] + (basin.centre[0] - stand.point[0]) * aim,
    0,
    stand.point[1] + (basin.centre[1] - stand.point[1]) * aim,
  ];
  void resting;

  return {
    position,
    lookTarget,
    fov: CAMERA_FOV_DEGREES,
    // Both unused by the blend — the controller supplies its own timing for the scroll
    // track, because the scroll's *position* is the visitor's input rather than a
    // transition the rig is playing.
    duration: 0,
    easing: 'linear',
  };
}
