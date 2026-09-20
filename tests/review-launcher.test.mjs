import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QUALITY_PROFILES } from '../src/config/quality.ts';
import {
  captureCommand,
  classifyConnectionError,
  classifyHttpResponse,
  devQualityHint,
  parseLaunchOptions,
} from '../scripts/review-launcher.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('review launcher safety checks', () => {
  it('reuses only a successful response carrying the POLNAREFF SYSTEM page title', () => {
    expect(
      classifyHttpResponse(200, '<html><head><title>POLNAREFF SYSTEM</title></head></html>'),
    ).toBe('project');

    expect(
      classifyHttpResponse(200, '<html><head><title>Unrelated service</title></head></html>'),
    ).toBe('occupied');
    expect(classifyHttpResponse(503, '<title>POLNAREFF SYSTEM</title>')).toBe('occupied');
  });

  it('starts a server only when the port is confirmed closed', () => {
    expect(classifyConnectionError('ECONNREFUSED')).toBe('not-running');
    // Anything else means something is listening, and a second server must not
    // be started on top of it.
    expect(classifyConnectionError('ETIMEDOUT')).toBe('occupied');
    expect(classifyConnectionError('ECONNRESET')).toBe('occupied');
  });
});

describe('review launcher options', () => {
  it('serves the dev build and opens a browser when given no arguments', () => {
    expect(parseLaunchOptions([])).toEqual({
      mode: 'dev',
      capture: false,
      open: true,
      help: false,
    });
  });

  it('accepts the documented flags', () => {
    expect(parseLaunchOptions(['--prod']).mode).toBe('prod');
    expect(parseLaunchOptions(['--capture']).capture).toBe(true);
    expect(parseLaunchOptions(['--no-open']).open).toBe(false);
    expect(parseLaunchOptions(['--prod', '--capture', '--no-open'])).toMatchObject({
      mode: 'prod',
      capture: true,
      open: false,
    });
  });

  it('refuses an unknown option rather than silently ignoring a typo', () => {
    expect(() => parseLaunchOptions(['--prodd'])).toThrow(/Unknown option/);
  });
});

describe('the printed hints track the application', () => {
  it('offers exactly the quality profiles the application defines', () => {
    // A profile added to the config but not offered here, or named here but not
    // in the config, would print a line that does nothing.
    for (const profile of Object.keys(QUALITY_PROFILES)) {
      expect(devQualityHint(profile)).toContain(`'${profile}'`);
    }

    const hint = devQualityHint('safe');
    expect(hint.match(/'ultra'|'high'|'medium'|'safe'/g)).toEqual(['\'safe\'']);
  });

  it('dispatches the event name the renderer actually listens for', () => {
    // The hint is only useful if the event name matches. Reading the source is
    // the point: a rename in the renderer must fail here rather than reach a
    // person as a line that silently does nothing.
    const rendererHost = readFileSync(
      path.join(PROJECT_ROOT, 'src', 'renderer', 'RendererHost.tsx'),
      'utf8',
    );

    expect(hintEventName()).not.toBe('');
    expect(rendererHost).toContain(hintEventName());
    expect(rendererHost).toContain('addEventListener(devQualityEvent');
  });

  it('points the capture hint at a harness that exists', () => {
    const command = captureCommand();
    const script = command.split(' ').find((part) => part.endsWith('.mjs'));
    expect(script).toBeDefined();
    expect(() => readFileSync(path.join(PROJECT_ROOT, script), 'utf8')).not.toThrow();
  });
});

/** The event name the launcher prints, read back out of the hint it prints. */
function hintEventName() {
  const match = devQualityHint().match(/CustomEvent\('([^']+)'/);
  return match ? match[1] : '';
}
