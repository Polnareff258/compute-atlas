import { describe, expect, it } from 'vitest';

import { meanderCourse } from '../ink/riverCourse';
import { createWatershedDescriptor } from '../watershed/watershedDescriptor';
import { heroVista, resolveScrollLateral, resolveScrollPose } from './heroShot';

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
  it('opens close enough that the river reads as the hero at thumbnail scale', () => {
    const { descriptor, courses } = fixture();
    const shot = heroVista(descriptor, 16 / 9, courses);
    const intendedEye = descriptor.basin.radius * 1.86;

    expect(shot.position[1]).toBeCloseTo(intendedEye, 4);
  });
});

describe('resolveScrollLateral', () => {
  it('moves the scroll camera onto a restrained three-quarter arc', () => {
    expect(resolveScrollLateral(0)).toBe(0);
    expect(resolveScrollLateral(0.48)).toBeCloseTo(0.16, 6);
    expect(resolveScrollLateral(0.78)).toBeCloseTo(0.30, 6);
    expect(resolveScrollLateral(1)).toBeCloseTo(0.34, 6);
  });

  it('clamps progress and remains continuous between authored stations', () => {
    expect(resolveScrollLateral(-1)).toBe(0);
    expect(resolveScrollLateral(2)).toBeCloseTo(0.34, 6);
    expect(resolveScrollLateral(0.63)).toBeGreaterThan(0.16);
    expect(resolveScrollLateral(0.63)).toBeLessThan(0.30);
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
