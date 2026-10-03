export type VisualMode = 'relief' | 'ink';

export const DEFAULT_VISUAL_MODE: VisualMode = 'relief';

/** Unknown or missing values intentionally resolve to the deterministic default. */
export function readVisualMode(search: string): VisualMode {
  return new URLSearchParams(search).get('visual') === 'ink'
    ? 'ink'
    : DEFAULT_VISUAL_MODE;
}

/** Updates only the visual selection, retaining every other query parameter. */
export function replaceVisualModeInSearch(
  search: string,
  visualMode: VisualMode,
): string {
  const params = new URLSearchParams(search);
  params.set('visual', visualMode);
  const nextSearch = params.toString();
  return nextSearch.length > 0 ? `?${nextSearch}` : '';
}
