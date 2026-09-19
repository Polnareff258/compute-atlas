import { describe, expect, it } from 'vitest';
import { classifyConnectionError, classifyHttpResponse } from '../scripts/stage351-review-launcher.mjs';

describe('Stage 3.5.1 review launcher safety checks', () => {
  it('reuses only a successful response carrying the POLNAREFF SYSTEM page title', () => {
    expect(
      classifyHttpResponse(200, '<html><head><title>POLNAREFF SYSTEM</title></head></html>'),
    ).toBe('project');

    expect(classifyHttpResponse(200, '<html><head><title>Unrelated service</title></head></html>')).toBe(
      'occupied',
    );
    expect(classifyHttpResponse(503, '<title>POLNAREFF SYSTEM</title>')).toBe('occupied');
  });

  it('starts the dev server only when the port is confirmed closed', () => {
    expect(classifyConnectionError('ECONNREFUSED')).toBe('not-running');
    expect(classifyConnectionError('ETIMEDOUT')).toBe('occupied');
    expect(classifyConnectionError('ECONNRESET')).toBe('occupied');
  });
});
