import { describe, expect, it } from 'vitest';

import { meanderCourse } from '../ink/riverCourse';
import { createWatershedDescriptor } from '../watershed/watershedDescriptor';
import { atArc, heroVista, resolveScrollLateral, resolveScrollPose } from './heroShot';

function fixture() {
  const descriptor = createWatershedDescriptor(2026, 1);
  const courses = descriptor.rivers.map((river) => ({
    spine: meanderCourse({ spine: river.spine, width: river.width }, 2026),
    width: river.width,
    flowRate: river.flowRate,
    feeds: river.feeds,
  }));
  return { descriptor, courses };
}

describe('heroVista', () => {
  it('presents the river broadside on entry so its meander crosses the frame', () => {
    const { descriptor, courses } = fixture();
    const shot = heroVista(descriptor, 16 / 9, courses);
    const principal = [...courses]
      .filter((course) => course.feeds === 'basin')
      .sort((a, b) => b.width * b.flowRate - a.width * a.flowRate)[0]!;
    const tangent = atArc(principal.spine, 0.9).forward;
    const dx = shot.lookTarget[0] - shot.position[0];
    const dz = shot.lookTarget[2] - shot.position[2];
    const horizontal = Math.hypot(dx, dz);
    const axialShare = Math.abs((dx * tangent[0] + dz * tangent[1]) / horizontal);
    const pitch = Math.atan2(shot.position[1] - shot.lookTarget[1], horizontal);

    expect(axialShare).toBeLessThan(0.60);
    expect(pitch).toBeGreaterThan(0.82);
  });

  it('opens close enough that the river reads as the hero at thumbnail scale', () => {
    const { descriptor, courses } = fixture();
    const shot = heroVista(descriptor, 16 / 9, courses);
    const intendedEye = descriptor.basin.radius * 1.86;

    expect(shot.position[1]).toBeCloseTo(intendedEye, 4);
  });
});

describe('resolveScrollLateral', () => {
  it('moves the scroll camera onto a restrained three-quarter arc', () => {
    expect(resolveScrollLateral(0)).toBeCloseTo(0.75, 6);
    expect(resolveScrollLateral(0.48)).toBeCloseTo(0.50, 6);
    expect(resolveScrollLateral(0.78)).toBeCloseTo(0.30, 6);
    expect(resolveScrollLateral(1)).toBeCloseTo(0.34, 6);
  });

  it('clamps progress and remains continuous between authored stations', () => {
    expect(resolveScrollLateral(-1)).toBeCloseTo(0.75, 6);
    expect(resolveScrollLateral(2)).toBeCloseTo(0.34, 6);
    expect(resolveScrollLateral(0.63)).toBeLessThan(0.50);
    expect(resolveScrollLateral(0.63)).toBeGreaterThan(0.30);
  });
});

describe('resolveScrollPose reveal', () => {
  it('ends in an immersive confluence view instead of retreating to a diagram overview', () => {
    const { descriptor, courses } = fixture();
    const pose = resolveScrollPose(descriptor, 16 / 9, courses, 1);
    const baseEye = descriptor.basin.radius * 1.86;

    expect(pose.position[1]).toBeGreaterThanOrEqual(baseEye * 0.60);
    expect(pose.position[1]).toBeLessThanOrEqual(baseEye * 0.66);
  });
});

describe('course camera sampling', () => {
  it('keeps forward direction continuous across an internal course bend', () => {
    const spine = [
      [0, 0],
      [100, 0],
      [100, 100],
      [200, 100],
    ] as const;
    const bend = 1 / 3;
    const before = atArc(spine, bend - 1e-3).forward;
    const after = atArc(spine, bend + 1e-3).forward;
    const dot = Math.max(-1, Math.min(1, before[0] * after[0] + before[1] * after[1]));

    expect((Math.acos(dot) * 180) / Math.PI).toBeLessThan(12);
  });

  it('keeps the authored 0.48 and 0.78 stations continuous', () => {
    const { descriptor, courses } = fixture();
    const samples = [0.48 - 1e-3, 0.48, 0.48 + 1e-3, 0.78 - 1e-3, 0.78, 0.78 + 1e-3].map(
      (progress) => resolveScrollPose(descriptor, 16 / 9, courses, progress),
    );

    for (const sample of samples) {
      expect(sample.position.every(Number.isFinite)).toBe(true);
      expect(sample.lookTarget.every(Number.isFinite)).toBe(true);
    }

    const positionDistance = (a: readonly number[], b: readonly number[]) =>
      Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    expect(positionDistance(samples[0]!.position, samples[2]!.position)).toBeLessThan(20);
    expect(positionDistance(samples[3]!.position, samples[5]!.position)).toBeLessThan(20);
  });
});
