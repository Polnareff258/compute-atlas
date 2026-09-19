'use client';

import { useCallback, useEffect, useState } from 'react';

export const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Guards SSR and partial test doubles. This is the single place the media-query
 * result becomes a scene input, so the value stays a plain boolean across the
 * RendererHost → SceneHost → view boundary.
 */
export function deriveReducedMotionPreference(
  mediaQueryList: Pick<MediaQueryList, 'matches'> | null | undefined,
): boolean {
  return mediaQueryList?.matches === true;
}

export function readReducedMotionPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return deriveReducedMotionPreference(
    window.matchMedia(REDUCED_MOTION_MEDIA_QUERY),
  );
}

/** Subscribes immediately and reports every later change; returns a teardown. */
export function subscribeReducedMotionPreference(
  onPreferenceChange: (prefersReducedMotion: boolean) => void,
): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }

  const mediaQueryList = window.matchMedia(REDUCED_MOTION_MEDIA_QUERY);
  const handleChange = () =>
    onPreferenceChange(deriveReducedMotionPreference(mediaQueryList));

  onPreferenceChange(deriveReducedMotionPreference(mediaQueryList));
  mediaQueryList.addEventListener('change', handleChange);

  return () => mediaQueryList.removeEventListener('change', handleChange);
}

/**
 * Starts false so server and first client render agree, then adopts the real
 * preference from the subscription. The scene mounts later than this effect.
 */
export function useReducedMotionPreference(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const handlePreferenceChange = useCallback(
    (nextPreference: boolean) => setPrefersReducedMotion(nextPreference),
    [],
  );

  useEffect(
    () => subscribeReducedMotionPreference(handlePreferenceChange),
    [handlePreferenceChange],
  );

  return prefersReducedMotion;
}