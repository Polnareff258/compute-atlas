import type { ManifestSnapshot } from './types';

export const PROJECT_MANIFEST = Object.freeze({
  id: 'polnareff-system',
  name: 'POLNAREFF SYSTEM',
  version: '0.1.0',
  phase: 'phase-1',
  environment: 'local',
});

export function inspectProjectManifest(now: number): ManifestSnapshot {
  const valid =
    PROJECT_MANIFEST.id.length > 0 &&
    PROJECT_MANIFEST.name.length > 0 &&
    PROJECT_MANIFEST.version.length > 0;

  return {
    status: valid ? 'ready' : 'invalid',
    detail: valid
      ? 'Project manifest ' + PROJECT_MANIFEST.version + ' verified'
      : 'Project manifest is incomplete',
    checkedAt: now,
  };
}