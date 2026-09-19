import { describe, expect, it } from 'vitest';

import { GRAPH_MANIFEST } from '../../graph/graphManifest';
import { deriveGraphLayout } from '../../graph/layout';
import type { GraphNodeId } from '../../graph/types';
import { deriveCoreStructure } from '../core/coreStructure';
import {
  BASE_CAMERA_DISTANCE,
  CAMERA_FOV_DEGREES,
  createCameraController,
  deriveCameraFraming,
} from './cameraController';

const ASPECT = 16 / 9;
const HALF_FOV_TAN = Math.tan((CAMERA_FOV_DEGREES * Math.PI) / 360);

const LAYOUT = deriveGraphLayout(GRAPH_MANIFEST);

const DOMAIN_IDS: readonly GraphNodeId[] = [
  'graphics',
  'ai',
  'game-analysis',
  'systems',
  'research',
];

/**
 * The framing the scene actually ships for one domain.
 *
 * Read from the layout rather than from the coordinates that happened to be in
 * this file when it was written: the layout moved to give the rebuilt Core room,
 * and a test holding yesterday's numbers would have gone on passing while
 * describing a composition that no longer existed.
 */
function framingForDomain(nodeId: GraphNodeId) {
  const position = LAYOUT[nodeId];
  const distance = Math.hypot(position[0], position[1], position[2]);
  return framingFor(
    position[0] / distance,
    position[1] / distance,
    distance,
    position[2] / distance,
  );
}

/** Where a world point lands across the half-frame at this framing. */
function screenX(framing: ReturnType<typeof deriveCameraFraming>, worldX: number): number {
  const halfWidth = framing.positionZ * HALF_FOV_TAN * ASPECT;
  return (worldX - framing.positionX) / halfWidth;
}

function screenY(framing: ReturnType<typeof deriveCameraFraming>, worldY: number): number {
  const halfHeight = framing.positionZ * HALF_FOV_TAN;
  return (worldY - framing.positionY) / halfHeight;
}

function framingFor(
  focusX: number,
  focusY: number,
  focusDistance: number,
  focusZ = 0,
) {
  return deriveCameraFraming({
    pointerX: 0,
    pointerY: 0,
    focusX,
    focusY,
    focusZ,
    focusDistance,
    response: 1,
    amplitudeScale: 1,
    aspect: ASPECT,
  });
}

describe('CameraController', () => {
  it('clamps pointer targets and converges with damping without overshooting', () => {
    const controller = createCameraController();
    controller.setPointerTarget(4, -4);
    controller.update(1 / 60);

    expect(controller.getPointerTargetX()).toBe(1);
    expect(controller.getPointerTargetY()).toBe(-1);
    expect(controller.getPointerX()).toBeGreaterThan(0);
    expect(controller.getPointerX()).toBeLessThanOrEqual(1);

    for (let index = 0; index < 180; index += 1) {
      controller.update(1 / 60);
    }

    expect(controller.getPointerX()).toBeCloseTo(1, 2);
    expect(controller.getPointerY()).toBeCloseTo(-1, 2);
    expect(controller.getPointerX()).toBeLessThanOrEqual(1);
    expect(controller.getPointerY()).toBeGreaterThanOrEqual(-1);
  });

  it('interpolates focus direction independently from pointer parallax', () => {
    const controller = createCameraController();
    controller.setFocusTarget(1, -0.5, 0.8);
    controller.update(0.2);

    expect(controller.getFocusX()).toBeGreaterThan(0);
    expect(controller.getFocusY()).toBeLessThan(0);
    expect(controller.getFocusZ()).toBeGreaterThan(0);
  });

  it('settles within a short finite transition when reduced motion is enabled', () => {
    const controller = createCameraController({ reducedMotion: true });
    controller.setPointerTarget(0.75, -0.25);
    controller.setFocusTarget(-0.5, 0.4, 0.3);
    controller.update(1 / 60);

    // Still in motion after one frame: reduced motion is a short transition,
    // not an instant snap and not a perpetual easing drift.
    expect(controller.getPointerX()).toBeGreaterThan(0);
    expect(controller.getPointerX()).toBeLessThan(0.75);
    expect(controller.getFocusX()).toBeLessThan(0);
    expect(controller.getFocusX()).toBeGreaterThan(-0.5);

    for (let index = 0; index < 30; index += 1) {
      controller.update(1 / 60);
    }

    expect(controller.getPointerX()).toBeCloseTo(0.75, 2);
    expect(controller.getPointerY()).toBeCloseTo(-0.25, 2);
    expect(controller.getFocusX()).toBeCloseTo(-0.5, 2);
    expect(controller.getFocusY()).toBeCloseTo(0.4, 2);
    expect(controller.getFocusZ()).toBeCloseTo(0.3, 2);
  });

  it('reduces displacement authority under reduced motion and keeps it whole otherwise', () => {
    expect(createCameraController().getAmplitudeScale()).toBe(1);

    const reducedScale = createCameraController({ reducedMotion: true }).getAmplitudeScale();
    expect(reducedScale).toBeGreaterThan(0);
    expect(reducedScale).toBeLessThan(1);
  });

  it('eases the focus distance so binding and releasing travel the same path', () => {
    const controller = createCameraController();
    expect(controller.getFocusDistance()).toBe(0);

    controller.setFocusDistance(3.44);
    controller.update(1 / 60);
    expect(controller.getFocusDistance()).toBeGreaterThan(0);
    expect(controller.getFocusDistance()).toBeLessThan(3.44);

    for (let index = 0; index < 180; index += 1) {
      controller.update(1 / 60);
    }
    expect(controller.getFocusDistance()).toBeCloseTo(3.44, 2);

    // A hostile distance cannot push the camera outside its own limits.
    controller.setFocusDistance(Number.NaN);
    for (let index = 0; index < 180; index += 1) {
      controller.update(1 / 60);
    }
    expect(controller.getFocusDistance()).toBeCloseTo(0, 3);
  });
});

describe('deriveCameraFraming', () => {
  it('frames idle off centre, with the Core right of the middle', () => {
    const framing = framingFor(0, 0, 0);

    expect(framing.focus).toBe(0);
    expect(framing.positionZ).toBe(BASE_CAMERA_DISTANCE);
    // Idle is off centre but not off frame: the Core still owns the composition.
    expect(screenX(framing, 0)).toBeGreaterThan(0);
    expect(screenX(framing, 0)).toBeLessThan(0.2);
  });

  it('puts the Core and the bound domain on opposite thirds', () => {
    // GRAPHICS, the domain the focus choreography reframes against.
    const framing = framingForDomain('graphics');
    const graphicsX = LAYOUT.graphics[0];

    expect(framing.focus).toBeCloseTo(1, 6);
    expect(screenX(framing, 0)).toBeCloseTo(1 / 3, 1);
    expect(screenX(framing, graphicsX)).toBeCloseTo(-1 / 3, 1);
    // Both ends of the active route are inside the frame, on opposite sides of
    // its centre, and neither is against an edge.
    expect(screenX(framing, 0)).toBeGreaterThan(0);
    expect(screenX(framing, graphicsX)).toBeLessThan(0);
    expect(Math.abs(screenX(framing, 0))).toBeLessThan(0.55);
    expect(Math.abs(screenX(framing, graphicsX))).toBeLessThan(0.55);
  });

  it('reframes every domain by its own distance rather than one tuned constant', () => {
    for (const nodeId of DOMAIN_IDS) {
      const position = LAYOUT[nodeId];
      const framing = framingForDomain(nodeId);

      // Whichever domain is bound, both ends of the route land inside the frame
      // on opposite sides of its centre, and neither reaches an edge.
      expect(framing.focus).toBeCloseTo(1, 6);
      const ends: readonly (readonly [number, number])[] = [
        [0, 0],
        [position[0], position[1]],
      ];
      for (const [x, y] of ends) {
        expect(Math.abs(screenX(framing, x))).toBeLessThanOrEqual(0.34);
        expect(Math.abs(screenY(framing, y))).toBeLessThanOrEqual(0.34);
      }
      // The two ends are mirror images about the frame centre: the Core moves
      // away from the domain's side, which is what leaves the route between them
      // running across the middle of the composition.
      expect(screenX(framing, 0)).toBeCloseTo(-screenX(framing, position[0]), 2);
      expect(screenY(framing, 0)).toBeCloseTo(-screenY(framing, position[1]), 2);
      // The active route really is the subject of the frame: its two ends sit a
      // third apart in the direction the offset runs, not huddled near the axis.
      expect(
        Math.hypot(
          screenX(framing, 0) - screenX(framing, position[0]),
          screenY(framing, 0) - screenY(framing, position[1]),
        ),
      ).toBeGreaterThan(0.4);
    }
  });

  it('never rotates toward the target, so the Core keeps one presentation', () => {
    const idle = framingFor(0, 0, 0);
    const focused = framingForDomain('graphics');

    expect(idle.yaw).toBe(0);
    expect(idle.pitch).toBe(0);
    expect(focused.yaw).toBe(0);
    expect(focused.pitch).toBe(0);
    // The camera really moved: this is a translate and a dolly, not a re-aim.
    // It is a dolly *out* for a domain at GRAPHICS' distance, which is what
    // makes room for both ends of the route; the assertions are on the two
    // things that have to hold whatever the domain is — the camera slid a long
    // way sideways, and the subject did not turn.
    expect(focused.positionX).toBeLessThan(idle.positionX - 1);
    expect(focused.positionZ).not.toBe(idle.positionZ);
  });

  it('keeps the hero at three fifths of the frame at the idle distance', () => {
    // Both numbers are read rather than guessed: the Core's own half-extent
    // comes from the built structure, and the frame's from the rig. This is the
    // composition contract the idle distance is derived against — the reason
    // `BASE_CAMERA_DISTANCE` moved when the Core was rebuilt — so a test holding
    // yesterday's constants would go on passing while describing a frame the
    // page no longer draws.
    const hero = deriveCoreStructure({ structureDetail: 1 }, 17);
    const halfWidth = BASE_CAMERA_DISTANCE * HALF_FOV_TAN * ASPECT;
    const fraction = hero.bounds[0] / halfWidth;

    expect(fraction).toBeGreaterThan(0.5);
    expect(fraction).toBeLessThan(0.68);

    // And the reframe distance the bound domains ask for stays inside the rig's
    // own range, so the thirds are never broken by the clamp.
    for (const nodeId of DOMAIN_IDS) {
      const framing = framingForDomain(nodeId);
      expect(framing.positionZ).toBeGreaterThan(BASE_CAMERA_DISTANCE * 0.6);
      expect(framing.positionZ).toBeLessThan(BASE_CAMERA_DISTANCE * 2);
    }
  });

  it('keeps the dolly inside a usable range at every aspect and distance', () => {
    for (const aspect of [0.5, 1, ASPECT, 3]) {
      for (const distance of [Math.hypot(2.35, 1.75, 1.05), 60]) {
        const framing = deriveCameraFraming({
          pointerX: 0,
          pointerY: 0,
          focusX: 0.5,
          focusY: 0.5,
          focusZ: 0,
          focusDistance: distance,
          response: 1,
          amplitudeScale: 1,
          aspect,
        });

        expect(Number.isFinite(framing.positionX)).toBe(true);
        expect(Number.isFinite(framing.positionY)).toBe(true);
        // The rig's usable range, stated against the composition rather than as
        // a bare number: the dolly never comes closer than three fifths of the
        // idle distance and never pulls back further than twice it, which keeps
        // the Core somewhere between a quarter and three fifths of the frame.
        expect(framing.positionZ).toBeGreaterThanOrEqual(BASE_CAMERA_DISTANCE * 0.6);
        expect(framing.positionZ).toBeLessThanOrEqual(BASE_CAMERA_DISTANCE * 2);
      }
    }
  });

  it('stays finite for hostile viewport and focus inputs', () => {
    const framing = deriveCameraFraming({
      pointerX: Number.NaN,
      pointerY: Number.POSITIVE_INFINITY,
      focusX: Number.NaN,
      focusY: Number.NaN,
      focusZ: Number.NaN,
      focusDistance: Number.NaN,
      response: 1,
      amplitudeScale: 1,
      aspect: 0,
    });

    expect(Number.isFinite(framing.positionX)).toBe(true);
    expect(Number.isFinite(framing.positionY)).toBe(true);
    expect(Number.isFinite(framing.positionZ)).toBe(true);
    expect(framing.focus).toBe(0);
  });
});