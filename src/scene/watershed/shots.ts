/**
 * The shot system: where the camera is, why, and for how long.
 *
 * Seven shots, as pure data and pure functions. No Three.js, no R3F, no clock.
 * The `CameraController` still owns the instance and the damped update — that
 * boundary is unchanged — and what it is handed is one of these framings,
 * already resolved for the current descriptor, aspect and active domain.
 *
 * Two things are deliberately *not* here. There is no interpolation between
 * shots: the controller owns the damping, and a transition written twice would
 * be two transitions that disagree at the moment the second one starts. And
 * there is no per-frame work: every function below is a function of its
 * arguments alone, so the whole system can be evaluated in a test.
 */
import { terrainHeight } from './terrainField';
import type { DomainId, Vector3, WatershedDescriptor } from './watershedDescriptor';

export type ShotId =
  | 'entry'
  | 'idleVista'
  | 'hoverReveal'
  | 'routeApproach'
  | 'domainArrival'
  | 'domainInspection'
  | 'returnVista';

/**
 * The shot order, exported so consumers iterate it in one agreed sequence.
 * `entry` leads because it is the only shot that starts moving before the
 * visitor does, and `returnVista` trails because it is where every other shot
 * comes back to.
 */
export const SHOT_IDS = Object.freeze([
  'entry',
  'idleVista',
  'hoverReveal',
  'routeApproach',
  'domainArrival',
  'domainInspection',
  'returnVista',
] as const satisfies readonly ShotId[]);

export type EasingName = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

/** A rectangle of the viewport, in fractions: 0 is the left or top edge. */
export type Rect = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

export type TypographyLayout = {
  readonly anchor: 'centre' | 'left' | 'bottom-left';
  /** Multiplier on the type ramp's title size. The entry page is the loud one. */
  readonly titleScale: number;
  /** How much of the text is on screen when the shot completes, `0`..`1`. */
  readonly reveal: number;
};

export type ShotFraming = {
  readonly id: ShotId;
  readonly position: Vector3;
  readonly lookTarget: Vector3;
  /** Distance to the look target. The depth-of-field focus plane. */
  readonly focalDistance: number;
  /** Vertical field of view, in degrees. */
  readonly fov: number;
  /** Seconds. `0` means the shot is a resting state rather than a transition. */
  readonly duration: number;
  readonly easing: EasingName;
  /** Where the subject is meant to sit. Asserted against in the tests. */
  readonly heroRegion: Rect;
  /**
   * The clearance the shot promises between the camera and any solid, in world
   * units. Small for a shot that flies through a channel, large for a vista.
   */
  readonly safeForeground: number;
  readonly lightDirection: Vector3;
  /** Multiplier on the world's fog density. Below one to look through, above to close in. */
  readonly fogResponse: number;
  readonly typography: TypographyLayout;
};

/**
 * The frame the composition is authored against, in fractions of the viewport.
 *
 * The brief's constraint is that the basin lands inside the central 55%, which
 * in these units is `0.225`..`0.775`. It is written as a rectangle rather than as
 * a number so that a shot whose subject is deliberately off-centre can widen or
 * shift it without inventing a second convention.
 */
export const CENTRAL_BAND: Rect = Object.freeze({ left: 0.225, top: 0.225, right: 0.775, bottom: 0.775 });

/**
 * The two targets the brief names, and the honest note about them.
 *
 * 2560×1440 and 1920×1080 are both 16:9, as is the 480×270 thumbnail. So the
 * "separate framing calibration" the brief asks for degenerates to a single
 * calibration for this stage's targets — there is no aspect difference to
 * calibrate against, and inventing one would be inventing a problem. The
 * function below still takes an aspect and is genuinely aspect-aware, because
 * the calibration is about the *frame* and the frame is what a future 21:9 or
 * 4:3 target would change. `shots.test.ts` asserts that both named targets
 * produce identical framings, so the claim is checked rather than asserted.
 */
export const TARGET_ASPECTS = Object.freeze({ '2560x1440': 16 / 9, '1920x1080': 16 / 9, '480x270': 16 / 9 });

/** The key light. Above and behind the camera's left shoulder, so the basin is front-lit. */
const KEY_LIGHT: Vector3 = [-0.38, 0.66, 0.65];

/** FOV, in degrees. Matches `CAMERA_FOV_DEGREES`; owned here so a shot may differ. */
const SHOT_FOV = 48;

// --- Projection --------------------------------------------------------------

export type ProjectedPoint = {
  /** Viewport fractions. May fall outside `0`..`1`; that is the caller's business. */
  readonly x: number;
  readonly y: number;
  /** Distance along the view axis. Negative means the point is behind the camera. */
  readonly depth: number;
};

function subtract(a: Vector3, b: Vector3): Vector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vector3, b: Vector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: Vector3): Vector3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * Project a world point into the frame.
 *
 * A hand-written projection rather than a camera object, because the tests need
 * to ask the same question the renderer answers and a `Matrix4` reached through
 * a scene graph is not available to a pure test. It is the same arithmetic the
 * renderer does: view basis, perspective divide, then the y flip from
 * right-handed world space to top-down viewport space.
 */
export function projectPoint(point: Vector3, framing: ShotFraming, aspect: number): ProjectedPoint {
  const forward = normalize(subtract(framing.lookTarget, framing.position));
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);

  const toPoint = subtract(point, framing.position);
  const depth = dot(toPoint, forward);
  const tanHalf = Math.tan((framing.fov * Math.PI) / 360);

  if (depth <= 1e-6) {
    // Behind the camera or on the plane of the lens. Reported rather than
    // clamped: a caller that clamps this silently gets a point pinned to the
    // frame edge and never learns it was pointing backwards.
    return { x: Number.NaN, y: Number.NaN, depth };
  }

  const ndcX = dot(toPoint, right) / (depth * tanHalf * aspect);
  const ndcY = dot(toPoint, up) / (depth * tanHalf);

  return { x: 0.5 + ndcX / 2, y: 0.5 - ndcY / 2, depth };
}

export function insideRect(point: { x: number; y: number }, rect: Rect): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

// --- Framing construction ----------------------------------------------------

function distanceOf(a: Vector3, b: Vector3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function framing(
  id: ShotId,
  position: Vector3,
  lookTarget: Vector3,
  rest: Omit<ShotFraming, 'id' | 'position' | 'lookTarget' | 'focalDistance' | 'fov'>,
): ShotFraming {
  return {
    id,
    position,
    lookTarget,
    focalDistance: distanceOf(position, lookTarget),
    fov: SHOT_FOV,
    ...rest,
  };
}

/** The fields a shot authors, as opposed to the ones its pose derives. */
type AuthoredShot = Omit<ShotFraming, 'id' | 'position' | 'lookTarget' | 'focalDistance' | 'fov'>;

/**
 * A shot that is another shot moved, rebuilt through `framing` rather than
 * spread from it.
 *
 * `focalDistance` is derived from the pose, so spreading a base framing carries
 * the base's focal distance onto a camera that is no longer standing there. The
 * hover did exactly that — six units closer to an 800-unit subject, still
 * reporting the vista's 803 — and the fallback did it too, which is the worse
 * case because a fallback is the path nobody looks at. Taking `AuthoredShot`
 * rather than the whole framing means the derived field cannot be carried at
 * all, so this is the only way to move a pose.
 */
function movedFrom(
  base: ShotFraming,
  id: ShotId,
  position: Vector3,
  overrides: Partial<AuthoredShot> = {},
): ShotFraming {
  return framing(id, position, base.lookTarget, {
    duration: base.duration,
    easing: base.easing,
    heroRegion: base.heroRegion,
    safeForeground: base.safeForeground,
    lightDirection: base.lightDirection,
    fogResponse: base.fogResponse,
    typography: base.typography,
    ...overrides,
  });
}

/**
 * How far back the idle camera must stand for the basin to sit inside
 * `CENTRAL_BAND`, derived rather than chosen.
 *
 * The binding constraint is vertical, and it is the basin's *core* — half its
 * radius, the bowl rather than the rim — that has to sit inside the band. The
 * rim is allowed to run past the band and even out of frame; a vista in which
 * the basin's full 380-unit width had to fit inside 55% of the frame would put
 * the camera 3800 units away and every other feature would be a smudge.
 *
 * `halfHeight / distance = tan(fov/2)`, and the band's half-extent is
 * `(CENTRAL_BAND.right - 0.5)`, so:
 *
 *   distance >= coreRadius / (tan(fov/2) * bandHalf)
 *
 * Returned as a *minimum*, so the corridor's own position decides the final
 * number and this only says whether that position is far enough back.
 */
export function minimumVistaDistance(coreRadius: number, fov = SHOT_FOV): number {
  const bandHalf = CENTRAL_BAND.right - 0.5;
  return coreRadius / (Math.tan((fov * Math.PI) / 360) * bandHalf);
}

/** The highest ground under a corridor's axis, sampled, with the same margin the descriptor uses. */
function corridorGround(descriptor: WatershedDescriptor): number {
  const corridor = descriptor.cameraCorridors.find((candidate) => candidate.id === 'idle');
  return corridor ? corridor.from[1] : 0;
}

/** The river that carries a domain's flow: the highest-rate tributary that reaches it. */
export function riverForDomain(descriptor: WatershedDescriptor, domainId: DomainId) {
  const candidates = descriptor.rivers.filter((river) => river.domainId === domainId);
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, river) => (river.flowRate > best.flowRate ? river : best));
}

function domainById(descriptor: WatershedDescriptor, domainId: DomainId) {
  return descriptor.domains.find((domain) => domain.id === domainId);
}

/** The point on a river at a fraction along its course, and the direction it is going. */
function alongRiver(
  spine: readonly (readonly [number, number])[],
  fraction: number,
): { point: readonly [number, number]; forward: readonly [number, number] } {
  const lengths: number[] = [];
  let total = 0;
  for (let index = 0; index < spine.length - 1; index += 1) {
    const step = Math.hypot(spine[index + 1]![0] - spine[index]![0], spine[index + 1]![1] - spine[index]![1]);
    lengths.push(step);
    total += step;
  }

  let travelled = total * fraction;
  for (let index = 0; index < lengths.length; index += 1) {
    if (travelled <= lengths[index]!) {
      const t = lengths[index] === 0 ? 0 : travelled / lengths[index]!;
      const a = spine[index]!;
      const b = spine[index + 1]!;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const length = Math.hypot(dx, dz) || 1;
      return { point: [a[0] + dx * t, a[1] + dz * t], forward: [dx / length, dz / length] };
    }
    travelled -= lengths[index]!;
  }

  const last = spine[spine.length - 1]!;
  return { point: last, forward: [0, -1] };
}

// --- The shots ---------------------------------------------------------------

/**
 * The entry shot: inside the gate, with the world beyond it.
 *
 * The camera starts high and back — above the near bank, outside where any
 * visitor would think to stand — and looks down the length of the watershed.
 * The gate is not geometry the descriptor knows about; it is the first frame's
 * crop of the strata and the light, which is why this shot's `safeForeground`
 * is the largest of the seven: the entry move must never intersect anything.
 */
function entryShot(descriptor: WatershedDescriptor): ShotFraming {
  const corridor = descriptor.cameraCorridors.find((candidate) => candidate.id === 'idle');
  const ground = corridorGround(descriptor);
  const basin = descriptor.basin;

  const position: Vector3 = [(corridor?.from[0] ?? 0) + 6, ground + 46, (corridor?.from[2] ?? 480) + 90];
  const lookTarget: Vector3 = [basin.centre[0], descriptor.basinFloor + 30, basin.centre[1]];

  return framing('entry', position, lookTarget, {
    duration: 3.2,
    easing: 'easeInOut',
    heroRegion: { left: 0.3, top: 0.28, right: 0.7, bottom: 0.78 },
    safeForeground: 40,
    lightDirection: KEY_LIGHT,
    fogResponse: 1.35,
    typography: { anchor: 'centre', titleScale: 1, reveal: 0 },
  });
}

/**
 * The idle vista, framed from the descriptor's own camera corridor.
 *
 * The camera stands at the corridor's far end and looks at the basin. It is
 * allowed to drift and forbidden to orbit: an orbit would change the
 * composition continuously, and the composition is the thing this stage is
 * about. The drift is the controller's business; this is the pose it drifts
 * around, and it is a pose the descriptor guarantees is clear of the world.
 */
export function idleVista(descriptor: WatershedDescriptor, aspect: number): ShotFraming {
  const corridor = descriptor.cameraCorridors.find((candidate) => candidate.id === 'idle');
  const position: Vector3 = corridor
    ? [corridor.from[0], corridor.from[1], corridor.from[2] - 20]
    : [0, 40, 460];
  const lookTarget: Vector3 = [
    descriptor.basin.centre[0],
    descriptor.basinFloor + 26,
    descriptor.basin.centre[1],
  ];

  // The band as an authored rectangle rather than a computed one, because the
  // composition is the point: the basin sits a little below centre so the
  // rivers entering from far have the upper third of the frame to arrive in.
  const heroRegion: Rect =
    aspect >= 1.6
      ? { left: 0.33, top: 0.3, right: 0.67, bottom: 0.72 }
      : { left: 0.28, top: 0.3, right: 0.72, bottom: 0.72 };

  return framing('idleVista', position, lookTarget, {
    duration: 0,
    easing: 'linear',
    heroRegion,
    // The corridor is the real guarantee — it stands `minClearance` above the
    // highest ground it sweeps, and this camera stands inside it. This figure is
    // the shot's own, weaker, declared floor, deliberately below that guarantee
    // so the two are not the same number restated. It was 26, which the corridor
    // does not promise and the pose does not deliver.
    safeForeground: 20,
    lightDirection: KEY_LIGHT,
    fogResponse: 1,
    typography: { anchor: 'bottom-left', titleScale: 0.34, reveal: 1 },
  });
}

/**
 * Hover: the world answers and the camera does not.
 *
 * The offset is a few units and the same look target, so a hover reads as the
 * landscape rising to the pointer rather than as the camera being dragged to it.
 * That is the whole reason this shot exists as its own entry instead of being
 * `idleVista` plus a flag: the brief is explicit that hover is a change in the
 * world, and a shot whose position barely moves makes that impossible to get
 * wrong by accident.
 */
function hoverReveal(descriptor: WatershedDescriptor, aspect: number): ShotFraming {
  const base = idleVista(descriptor, aspect);
  return movedFrom(
    base,
    'hoverReveal',
    [base.position[0] + 2.5, base.position[1] + 1.5, base.position[2] - 6],
    { duration: 0.9, easing: 'easeOut', fogResponse: 0.94 },
  );
}

/**
 * Approaching a domain: the first half of the focus move, travelling with the
 * river.
 *
 * The camera sits behind and above the river's midpoint, looking down the
 * course toward the domain's mouth, so the flow leads the eye the way the brief
 * asks. The `safeForeground` is tight because the camera is flying down a
 * carved channel; the tests check the channel is wide enough for it.
 */
function routeApproach(
  descriptor: WatershedDescriptor,
  domainId: DomainId,
  aspect: number,
): ShotFraming {
  const domain = domainById(descriptor, domainId);
  const river = riverForDomain(descriptor, domainId);
  const anchor = domain?.centre ?? descriptor.basin.centre;

  if (!river) {
    // A region with no river to travel still needs a beat to arrive in, so this
    // keeps a duration even though the pose does not change.
    return restingVista(descriptor, aspect, 'routeApproach', {
      duration: 1.2,
      easing: 'easeInOut',
    });
  }

  const { point, forward } = alongRiver(river.spine, 0.62);
  const ground = terrainHeight(point[0], point[1], descriptor.field);
  const back = river.width * 1.6 + 26;

  const position: Vector3 = [point[0] - forward[0] * back, ground + 26, point[1] - forward[1] * back];
  const lookTarget: Vector3 = [anchor[0], ground + 12, anchor[1]];

  return framing('routeApproach', position, lookTarget, {
    duration: 1.4,
    easing: 'easeInOut',
    heroRegion: { left: 0.3, top: 0.26, right: 0.7, bottom: 0.8 },
    safeForeground: 12,
    lightDirection: KEY_LIGHT,
    fogResponse: 0.8,
    typography: { anchor: 'left', titleScale: 0.5, reveal: 0.35 },
  });
}

/**
 * Arrival: through the local membrane or channel, with the domain unfolding
 * before the move completes.
 *
 * The camera ends *inside* the region rather than outside looking at it. That
 * is the difference between arriving somewhere and being shown a picture of it,
 * and it is why `heroRegion` is the largest of the seven: at the end of this
 * shot the region is meant to fill the frame.
 */
function domainArrival(
  descriptor: WatershedDescriptor,
  domainId: DomainId,
  aspect: number,
): ShotFraming {
  const domain = domainById(descriptor, domainId);
  if (!domain) {
    return restingVista(descriptor, aspect, 'domainArrival', {
      duration: 1.1,
      easing: 'easeOut',
    });
  }

  const away = Math.atan2(
    domain.centre[1] - descriptor.basin.centre[1],
    domain.centre[0] - descriptor.basin.centre[0],
  );
  const stand = domain.radius * 0.55;

  const position: Vector3 = [
    domain.centre[0] + Math.cos(away) * stand,
    terrainHeight(domain.centre[0] + Math.cos(away) * stand, domain.centre[1] + Math.sin(away) * stand, descriptor.field) + 22,
    domain.centre[1] + Math.sin(away) * stand,
  ];
  const lookTarget: Vector3 = [
    domain.centre[0],
    terrainHeight(domain.centre[0], domain.centre[1], descriptor.field) + 14,
    domain.centre[1],
  ];

  return framing('domainArrival', position, lookTarget, {
    duration: 1.1,
    easing: 'easeOut',
    heroRegion: { left: 0.16, top: 0.14, right: 0.84, bottom: 0.86 },
    safeForeground: 14,
    lightDirection: KEY_LIGHT,
    fogResponse: 0.86,
    typography: { anchor: 'left', titleScale: 0.72, reveal: 0.8 },
  });
}

/**
 * The resting state of a focus: composed, stable, and still holding the basin.
 *
 * The camera pulls back and steps to one side so the region reads as *part of*
 * the watershed rather than as an isolated object — the brief's requirement that
 * the five belong to one world. Keeping the basin in frame is what does that,
 * and it is asserted in the tests rather than left to the framing's good
 * intentions.
 */
function domainInspection(
  descriptor: WatershedDescriptor,
  domainId: DomainId,
  aspect: number,
): ShotFraming {
  const domain = domainById(descriptor, domainId);
  if (!domain) {
    // A resting shot keeps no duration, so the fallback is a cut rather than a
    // move — the same rule the real inspection shot follows.
    return restingVista(descriptor, aspect, 'domainInspection');
  }

  const away = Math.atan2(
    domain.centre[1] - descriptor.basin.centre[1],
    domain.centre[0] - descriptor.basin.centre[0],
  );
  // Stepped round from the arrival's bearing so the move reads as a move, and
  // far enough out that the region's own terrain has a silhouette again.
  const bearing = away + 0.55;
  const stand = domain.radius * 0.95;

  const position: Vector3 = [
    domain.centre[0] + Math.cos(bearing) * stand,
    terrainHeight(domain.centre[0], domain.centre[1], descriptor.field) + 46,
    domain.centre[1] + Math.sin(bearing) * stand,
  ];
  const lookTarget: Vector3 = [
    domain.centre[0],
    terrainHeight(domain.centre[0], domain.centre[1], descriptor.field) + 10,
    domain.centre[1],
  ];

  return framing('domainInspection', position, lookTarget, {
    duration: 0,
    easing: 'linear',
    heroRegion: { left: 0.22, top: 0.2, right: 0.78, bottom: 0.82 },
    safeForeground: 20,
    lightDirection: KEY_LIGHT,
    fogResponse: 1.05,
    typography: { anchor: 'left', titleScale: 0.6, reveal: 1 },
  });
}

/**
 * Withdrawing, which is not the same as cutting back.
 *
 * A retraction moves through the space it arrived through, so the world is seen
 * receding rather than swapped. The position is the idle pose plus a little
 * height and distance, which puts the region and the basin in the same frame at
 * the end — the composition the visitor left.
 */
function returnVista(descriptor: WatershedDescriptor, aspect: number): ShotFraming {
  const base = idleVista(descriptor, aspect);
  return movedFrom(
    base,
    'returnVista',
    [base.position[0], base.position[1] + 14, base.position[2] + 42],
    {
      duration: 1.7,
      easing: 'easeInOut',
      safeForeground: 30,
      fogResponse: 1.12,
      typography: { anchor: 'bottom-left', titleScale: 0.34, reveal: 0.6 },
    },
  );
}

/**
 * The vista's pose, under some other shot's name.
 *
 * What a `routeApproach`, `domainArrival` or `domainInspection` *is* when no
 * region is bound, and what it becomes when a region has no river to travel: the
 * visitor stands in the vista and nothing moves. The alternative — handing back
 * the `idleVista` framing unchanged — means the record is keyed by one shot id
 * and its values claim another, so a consumer switching on `framing.id` to pick
 * a transition reads `idleVista` and gets a route approach. The id is the
 * caller's question, so the id is what comes back.
 */
function restingVista(
  descriptor: WatershedDescriptor,
  aspect: number,
  id: ShotId,
  overrides: Partial<AuthoredShot> = {},
): ShotFraming {
  const base = idleVista(descriptor, aspect);
  return movedFrom(base, id, base.position, overrides);
}

/**
 * All seven shots for a descriptor, an aspect and a state.
 *
 * `activeDomain` is the region a hover or focus is about; without one the route
 * and arrival shots rest in the vista, which is what the visitor sees when
 * nothing is bound.
 */
export function planShots(
  descriptor: WatershedDescriptor,
  aspect: number,
  activeDomain?: DomainId,
): Readonly<Record<ShotId, ShotFraming>> {
  const domain = activeDomain ?? 'graphics';

  return {
    entry: entryShot(descriptor),
    idleVista: idleVista(descriptor, aspect),
    hoverReveal: hoverReveal(descriptor, aspect),
    routeApproach: activeDomain
      ? routeApproach(descriptor, domain, aspect)
      : restingVista(descriptor, aspect, 'routeApproach'),
    domainArrival: activeDomain
      ? domainArrival(descriptor, domain, aspect)
      : restingVista(descriptor, aspect, 'domainArrival'),
    domainInspection: activeDomain
      ? domainInspection(descriptor, domain, aspect)
      : restingVista(descriptor, aspect, 'domainInspection'),
    returnVista: returnVista(descriptor, aspect),
  };
}

// --- C1: choosing what to look at --------------------------------------------

export type SelectedInterest = {
  readonly id: string;
  readonly position: Vector3;
  readonly weight: number;
  /** Where it lands in the frame at the shot it belongs to. */
  readonly projected: ProjectedPoint;
};

/**
 * The descriptor's interest points, filtered against the actual framing.
 *
 * This is constraint C1, and it is the one place the descriptor and the shot
 * system have to meet: the descriptor proposes points because it knows the
 * world, and this function disposes because only the framing knows whether a
 * point is worth looking at. A point behind the camera, outside its shot's hero
 * region, or crowding a point already kept is dropped — randomness proposes, the
 * frame disposes.
 *
 * Points are kept in descending weight, so which of two similar candidates
 * survives depends on their importance rather than on the order the descriptor
 * happened to emit them in.
 */
export function selectInterestPoints(
  descriptor: WatershedDescriptor,
  aspect: number,
  minSpacing = 120,
): readonly SelectedInterest[] {
  const shots = planShots(descriptor, aspect);
  const kept: SelectedInterest[] = [];

  const ranked = [...descriptor.interestPoints].sort((a, b) => b.weight - a.weight);

  for (const candidate of ranked) {
    const shot = shots[candidate.shot as ShotId];
    if (!shot) continue;

    const projected = projectPoint(candidate.position, shot, aspect);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) continue;
    if (!insideRect(projected, shot.heroRegion)) continue;
    if (kept.some((other) => distanceOf(other.position, candidate.position) < minSpacing)) continue;

    kept.push({ id: candidate.id, position: candidate.position, weight: candidate.weight, projected });
  }

  return kept;
}
