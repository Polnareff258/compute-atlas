import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VISUAL_MODE,
  readVisualMode,
  replaceVisualModeInSearch,
} from './visualMode';

describe('visual mode URL state', () => {
  it('defaults to relief and only accepts visual=ink as ink', () => {
    expect(DEFAULT_VISUAL_MODE).toBe('relief');
    expect(readVisualMode('')).toBe('relief');
    expect(readVisualMode('?visual=relief')).toBe('relief');
    expect(readVisualMode('?visual=unknown')).toBe('relief');
    expect(readVisualMode('?visual=ink')).toBe('ink');
  });

  it('replaces only the visual query while preserving other search parameters', () => {
    expect(replaceVisualModeInSearch('?telemetry=1&visual=ink', 'relief')).toBe(
      '?telemetry=1&visual=relief',
    );
    expect(replaceVisualModeInSearch('?capture=wide', 'ink')).toBe(
      '?capture=wide&visual=ink',
    );
  });
});
