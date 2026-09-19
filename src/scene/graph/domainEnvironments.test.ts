import { describe, expect, it } from 'vitest';

import { QUALITY_PROFILES } from '../../config/quality';
import type { GraphPosition } from '../../graph/types';
import type { DomainIngress, DomainVisualNodeId } from '../routing/graphRoutes';
import {
  deriveDomainEnvironment,
  type DomainEnvironment,
} from './domainEnvironments';

const DOMAIN_IDS: readonly DomainVisualNodeId[] = [
  'ai',
  'graphics',
  'game-analysis',
  'systems',
  'research',
];

const ANCHOR: GraphPosition = [3, 1.4, -0.6];

function ingressFor(anchor: GraphPosition): DomainIngress {
  return {
    position: [anchor[0] - 0.18, anchor[1] + 0.05, anchor[2] - 0.02],
    direction: [-1, 0.2, -0.1],
    halfWidth: 0.09,
  };
}

function environmentFor(
  nodeId: DomainVisualNodeId,
  detail: number,
): DomainEnvironment {
  return deriveDomainEnvironment(nodeId, ANCHOR, ingressFor(ANCHOR), detail);
}

/**
 * The mass a domain is built on, with the small fittings the tier trim drops.
 *
 * Compared by shape rather than by number: the frame scales with detail, so what
 * has to survive a tier change is which members exist, not their sizes.
 */
function structuralFrame(environment: DomainEnvironment) {
  return environment.frame
    .filter((part) => !part.membrane || part.tier !== 'detail')
    .map((part) => `${part.shape}:${part.tier}:${part.membrane}`);
}

describe('deriveDomainEnvironment', () => {
  it('is deterministic for one domain and independent per domain', () => {
    for (const nodeId of DOMAIN_IDS) {
      expect(environmentFor(nodeId, 1)).toEqual(environmentFor(nodeId, 1));
    }

    // Different domains must be genuinely different builds, not one build with a
    // different label: that is the whole distinction the brief draws between five
    // sub-environments and five copies of one icon.
    const kinds = new Set(DOMAIN_IDS.map((nodeId) => environmentFor(nodeId, 1).kind));
    expect(kinds.size).toBe(DOMAIN_IDS.length);
  });

  it('carries one machine language: every domain shares the structure vocabulary', () => {
    for (const nodeId of DOMAIN_IDS) {
      const environment = environmentFor(nodeId, 1);

      expect(environment.frame.length).toBeGreaterThan(0);
      expect(environment.movables.length).toBeGreaterThan(0);
      expect(environment.extent).toBeGreaterThan(0);
      expect(environment.scale).toBeGreaterThan(0);
      // The envelope is centred on its anchor, so framing and labels agree with
      // where routing actually arrives.
      expect(environment.anchor).toEqual(ANCHOR);
      expect(environment.ingressLocal).toEqual([
        environment.ingress.position[0] - ANCHOR[0],
        environment.ingress.position[1] - ANCHOR[1],
        environment.ingress.position[2] - ANCHOR[2],
      ]);
    }
  });

  it('builds out with detail instead of brightening a fixed silhouette', () => {
    for (const nodeId of DOMAIN_IDS) {
      const sparse = environmentFor(nodeId, 0);
      const rich = environmentFor(nodeId, 1);

      expect(rich.extent).toBeGreaterThan(sparse.extent);
      expect(rich.movables.length).toBeGreaterThanOrEqual(sparse.movables.length);
      expect(rich.parts.length).toBeGreaterThanOrEqual(sparse.parts.length);
      expect(rich).not.toEqual(sparse);
    }
  });

  it('never trims the mass at SAFE, only the fittings above it', () => {
    for (const nodeId of DOMAIN_IDS) {
      const sparse = environmentFor(nodeId, 0);
      const rich = environmentFor(nodeId, 1);

      // A domain that lost its body at a low tier would stop being a
      // sub-environment and become an icon again.
      expect(structuralFrame(sparse)).toEqual(structuralFrame(rich));
      expect(sparse.frame.length).toBeGreaterThan(2);
    }
  });

  it('keeps both ingress jaws at every tier, so a domain always has a mouth', () => {
    for (const nodeId of DOMAIN_IDS) {
      for (const detail of [0, 0.33, 0.66, 1]) {
        const environment = environmentFor(nodeId, detail);
        const jaws = environment.movables.filter((movable) => movable.role === 'ingress');

        expect(jaws.length).toBe(2);
        // Widen, not drift: the jaws open the seam rather than sliding the whole
        // assembly off the route.
        const [upper, lower] = jaws;
        const part = upper!.travel;
        const opposite = lower!.travel;
        expect(part[0]).toBeCloseTo(-(opposite[0] ?? 0), 12);
        expect(part[1]).toBeCloseTo(-(opposite[1] ?? 0), 12);
        expect(part[2]).toBeCloseTo(-(opposite[2] ?? 0), 12);
      }
    }
  });

  it('brackets the ingress mouth with the jaws, in domain-local space', () => {
    for (const nodeId of DOMAIN_IDS) {
      const environment = environmentFor(nodeId, 1);
      const { ingressLocal, ingress } = environment;

      for (const jaw of environment.movables.filter(
        (movable) => movable.role === 'ingress',
      )) {
        if (jaw.part.shape !== 'span') throw new Error('ingress jaws are spans');
        const mouthward = Math.min(
          Math.hypot(
            jaw.part.start[0] - ingressLocal[0],
            jaw.part.start[1] - ingressLocal[1],
            jaw.part.start[2] - ingressLocal[2],
          ),
          Math.hypot(
            jaw.part.end[0] - ingressLocal[0],
            jaw.part.end[1] - ingressLocal[1],
            jaw.part.end[2] - ingressLocal[2],
          ),
        );

        // The jaw starts exactly one half-width off the mouth, so the two jaws
        // together span the opening the route arrives through.
        expect(mouthward).toBeCloseTo(ingress.halfWidth, 9);
      }
    }
  });

  it('bakes each movable exactly once, outside the frame it moves against', () => {
    for (const nodeId of DOMAIN_IDS) {
      const environment = environmentFor(nodeId, 1);

      // Movables are drawn separately from the merged mass, so no movable part
      // may also be baked into it, and none may be baked twice.
      expect(environment.parts.length).toBe(
        environment.frame.length + environment.movables.length,
      );
      for (const movable of environment.movables) {
        expect(environment.frame).not.toContain(movable.part);
      }
    }
  });

  it('gives every movable a distinct id so the view can track them individually', () => {
    for (const nodeId of DOMAIN_IDS) {
      const environment = environmentFor(nodeId, 1);
      const ids = environment.movables.map((movable) => movable.id);

      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('steps the interior by quality tier instead of dimming the same build', () => {
    const layersAt = (profile: keyof typeof QUALITY_PROFILES) =>
      deriveDomainEnvironment(
        'systems',
        ANCHOR,
        ingressFor(ANCHOR),
        QUALITY_PROFILES[profile].domainDetail,
      ).movables.filter((movable) => movable.role === 'interior').length;

    // Read through the real profiles rather than through the thresholds, so a
    // tier that stopped changing what is present would fail here.
    expect(layersAt('safe')).toBe(1);
    expect(layersAt('medium')).toBe(2);
    expect(layersAt('high')).toBeGreaterThan(layersAt('medium'));
    expect(layersAt('ultra')).toBe(layersAt('high'));
  });

  it('stays finite and positive for hostile detail values', () => {
    for (const nodeId of DOMAIN_IDS) {
      for (const detail of [Number.NaN, Number.POSITIVE_INFINITY, -5, 12]) {
        const environment = environmentFor(nodeId, detail);

        expect(Number.isFinite(environment.extent)).toBe(true);
        expect(environment.extent).toBeGreaterThan(0);
        expect(Number.isFinite(environment.scale)).toBe(true);
        expect(environment.movables.length).toBeGreaterThan(0);
        // A non-finite activation axis would poison every jaw travel built from it.
        for (const value of environment.activationAxis) {
          expect(Number.isFinite(value)).toBe(true);
        }
        for (const value of environment.ingressLocal) {
          expect(Number.isFinite(value)).toBe(true);
        }
        for (const movable of environment.movables) {
          for (const value of movable.travel) {
            expect(Number.isFinite(value)).toBe(true);
          }
        }
      }
    }
  });
});
