import { describe, expect, it } from 'vitest';

import { deriveScrollChoreography } from './scrollChoreography';

describe('deriveScrollChoreography typography exit', () => {
  it('removes the masthead before the close descent crosses its screen space', () => {
    expect(deriveScrollChoreography(0.10).textOpacity).toBe(1);
    expect(deriveScrollChoreography(0.25).textOpacity).toBe(0);
    expect(deriveScrollChoreography(0.50).textOpacity).toBe(0);
  });
});
