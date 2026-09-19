import { describe, expect, it } from 'vitest';

import type { GraphPosition } from '../../graph/types';
import type { DomainIngress, DomainVisualNodeId } from '../routing/graphRoutes';
import { ROUTE_CLASS_ORDER } from '../routing/routeDash';
import { deriveDomainCircuits } from './domainCircuits';
import { deriveDomainEnvironment } from './domainEnvironments';

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

function circuitsFor(nodeId: DomainVisualNodeId, group: number, detail = 1) {
  const environment = deriveDomainEnvironment(
    nodeId,
    ANCHOR,
    ingressFor(ANCHOR),
    detail,
  );
  return deriveDomainCircuits(environment, group);
}

describe('deriveDomainCircuits', () => {
  it('is deterministic for a seed and changes with it', () => {
    expect(circuitsFor('graphics', 2, 1)).toEqual(
      circuitsFor('graphics', 2, 1),
    );

    const environment = deriveDomainEnvironment('graphics', ANCHOR, ingressFor(ANCHOR), 1);
    expect(deriveDomainCircuits(environment, 2, 17)).not.toEqual(
      deriveDomainCircuits(environment, 2, 23),
    );
  });

  it('gives every domain an interior flow of its own', () => {
    const signatures = new Set<string>();

    for (const nodeId of DOMAIN_IDS) {
      const circuits = circuitsFor(nodeId, 1);

      expect(circuits.length).toBeGreaterThanOrEqual(3);
      // A domain whose interior never leaves its heart would have no flow inside,
      // which is exactly the "icon" the brief replaces.
      expect(circuits.some((curve) => curve.route !== 'ambient')).toBe(true);
      signatures.add(JSON.stringify(circuits.map((curve) => curve.route)));
    }

    expect(signatures.size).toBe(DOMAIN_IDS.length);
  });

  it('writes only the domain route group, so hover lifts that domain alone', () => {
    for (const nodeId of DOMAIN_IDS) {
      const circuits = circuitsFor(nodeId, 3);

      expect(circuits.length).toBeGreaterThan(0);
      for (const curve of circuits) {
        expect(curve.group).toBe(3);
      }
    }
  });

  it('uses route classes the packed lane order knows about', () => {
    for (const nodeId of DOMAIN_IDS) {
      for (const curve of circuitsFor(nodeId, 1)) {
        expect(ROUTE_CLASS_ORDER).toContain(curve.route);
      }
    }
  });

  it('gives every curve a scene-wide unique id', () => {
    const ids = DOMAIN_IDS.flatMap((nodeId, index) =>
      circuitsFor(nodeId, index + 1).map((curve) => curve.id),
    );

    // Curve ids seed the packer's per-lane jitter, so a collision between two
    // domains would draw their interiors with identical phase.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stays inside the domain envelope it describes', () => {
    for (const nodeId of DOMAIN_IDS) {
      const environment = deriveDomainEnvironment(
        nodeId,
        ANCHOR,
        ingressFor(ANCHOR),
        1,
      );
      const reach = environment.extent * 1.8;

      for (const curve of deriveDomainCircuits(environment, 1)) {
        for (const point of [curve.start, curve.control, curve.end]) {
          const distance = Math.hypot(
            point[0] - ANCHOR[0],
            point[1] - ANCHOR[1],
            point[2] - ANCHOR[2],
          );
          expect(distance).toBeLessThanOrEqual(reach);
        }
      }
    }
  });

  it('leaves every curve finite and non-degenerate at every tier', () => {
    for (const nodeId of DOMAIN_IDS) {
      for (const detail of [0, 0.5, 0.75, 1]) {
        for (const curve of circuitsFor(nodeId, 1, detail)) {
          const values = [...curve.start, ...curve.control, ...curve.end];
          expect(values.every((value) => Number.isFinite(value))).toBe(true);
          expect(Number.isInteger(curve.id)).toBe(true);
          expect(Number.isInteger(curve.rank)).toBe(true);

          const length = Math.hypot(
            curve.end[0] - curve.start[0],
            curve.end[1] - curve.start[1],
            curve.end[2] - curve.start[2],
          );
          expect(length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('draws the same architecture at a low tier, just on a smaller envelope', () => {
    const environment = deriveDomainEnvironment('systems', ANCHOR, ingressFor(ANCHOR), 0);
    const curves = deriveDomainCircuits(environment, 4);

    // SAFE keeps the silhouette and the flow that explains it; the trim is a
    // reduction in the interior's layering, not a different domain.
    expect(curves.length).toBe(circuitsFor('systems', 4, 1).length);
    for (const curve of curves) {
      const distance = Math.hypot(
        curve.end[0] - ANCHOR[0],
        curve.end[1] - ANCHOR[1],
        curve.end[2] - ANCHOR[2],
      );
      expect(distance).toBeLessThanOrEqual(environment.extent * 1.8);
    }
  });
});
