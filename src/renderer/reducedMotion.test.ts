import { describe, expect, it, vi } from 'vitest';

import {
  REDUCED_MOTION_MEDIA_QUERY,
  deriveReducedMotionPreference,
  subscribeReducedMotionPreference,
} from './reducedMotion';

describe('deriveReducedMotionPreference', () => {
  it('reads only the boolean match from the media query list', () => {
    expect(deriveReducedMotionPreference({ matches: true })).toBe(true);
    expect(deriveReducedMotionPreference({ matches: false })).toBe(false);
  });

  it('treats absent media query support as no preference', () => {
    expect(deriveReducedMotionPreference(null)).toBe(false);
    expect(deriveReducedMotionPreference(undefined)).toBe(false);
  });

  it('never coerces a non-boolean match into a preference', () => {
    expect(
      deriveReducedMotionPreference({
        matches: 1,
      } as unknown as Pick<MediaQueryList, 'matches'>),
    ).toBe(false);
  });
});

describe('subscribeReducedMotionPreference', () => {
  it('reports the current preference immediately and forwards later changes', () => {
    const listeners = new Set<() => void>();
    let matches = true;
    const mediaQueryList = {
      get matches() {
        return matches;
      },
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        listeners.delete(listener),
    };
    const matchMedia = vi.fn(() => mediaQueryList);
    vi.stubGlobal('window', { matchMedia });

    const observed: boolean[] = [];
    const unsubscribe = subscribeReducedMotionPreference((value) =>
      observed.push(value),
    );

    expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_MEDIA_QUERY);
    expect(observed).toEqual([true]);

    matches = false;
    for (const listener of listeners) listener();
    expect(observed).toEqual([true, false]);

    unsubscribe();
    expect(listeners.size).toBe(0);

    vi.unstubAllGlobals();
  });

  it('returns an inert teardown when the platform has no media query support', () => {
    vi.stubGlobal('window', {});
    const observed: boolean[] = [];
    const unsubscribe = subscribeReducedMotionPreference((value) =>
      observed.push(value),
    );

    expect(observed).toEqual([]);
    expect(() => unsubscribe()).not.toThrow();

    vi.unstubAllGlobals();
  });
});