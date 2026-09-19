import type { GraphNodeId } from '../../graph/types';

export type DomainVisualNodeId = Exclude<GraphNodeId, 'core'>;
export type DomainVisualKind = 'branching' | 'planar' | 'forked' | 'stacked' | 'lattice';

export type DomainVisualMember = {
  readonly position: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
};

export type DomainVisualDescriptor = {
  readonly nodeId: DomainVisualNodeId;
  readonly kind: DomainVisualKind;
  readonly members: readonly DomainVisualMember[];
  readonly activationAxis: readonly [number, number, number];
};

type DomainVisualPreset = Omit<DomainVisualDescriptor, 'nodeId'>;

const DOMAIN_PRESETS: Readonly<Record<DomainVisualNodeId, DomainVisualPreset>> = {
  ai: {
    kind: 'branching',
    activationAxis: [1, 0.22, 0.08],
    members: [
      { position: [0, 0, 0], scale: [0.12, 0.66, 0.12], rotation: [0, 0, 0] },
      { position: [-0.24, 0.22, 0.04], scale: [0.42, 0.085, 0.1], rotation: [0, 0, -0.54] },
      { position: [0.25, 0.2, -0.02], scale: [0.4, 0.08, 0.09], rotation: [0, 0, 0.56] },
      { position: [-0.38, -0.12, 0.06], scale: [0.3, 0.07, 0.09], rotation: [0, 0, 0.18] },
      { position: [0.4, -0.1, -0.06], scale: [0.28, 0.07, 0.08], rotation: [0, 0, -0.16] },
      { position: [0, 0.54, 0.04], scale: [0.24, 0.06, 0.08], rotation: [0, 0, 0.12] },
    ],
  },
  graphics: {
    kind: 'planar',
    activationAxis: [0.06, 0.12, 1],
    members: [
      { position: [0, 0.18, 0], scale: [0.86, 0.07, 0.52], rotation: [0.06, 0.12, 0.02] },
      { position: [-0.04, 0.02, 0.06], scale: [0.72, 0.055, 0.44], rotation: [-0.08, -0.06, -0.08] },
      { position: [0.02, -0.15, -0.04], scale: [0.58, 0.045, 0.38], rotation: [0.04, 0.16, 0.07] },
      { position: [-0.24, -0.29, 0.1], scale: [0.3, 0.035, 0.22], rotation: [0, 0.08, -0.18] },
      { position: [0.28, 0.34, -0.09], scale: [0.28, 0.035, 0.2], rotation: [0, -0.1, 0.14] },
    ],
  },
  'game-analysis': {
    kind: 'forked',
    activationAxis: [0.82, 0.56, -0.08],
    members: [
      { position: [0, -0.02, 0], scale: [0.12, 0.62, 0.12], rotation: [0, 0, 0.12] },
      { position: [-0.24, 0.22, 0.04], scale: [0.48, 0.08, 0.1], rotation: [0, 0, 0.52] },
      { position: [0.26, 0.18, -0.02], scale: [0.44, 0.08, 0.1], rotation: [0, 0, -0.5] },
      { position: [-0.4, 0.02, 0.08], scale: [0.26, 0.06, 0.08], rotation: [0, 0, -0.12] },
      { position: [0.42, -0.02, -0.08], scale: [0.24, 0.06, 0.08], rotation: [0, 0, 0.14] },
    ],
  },
  systems: {
    kind: 'stacked',
    activationAxis: [0.08, 1, 0.2],
    members: [
      { position: [0, 0.36, 0], scale: [0.78, 0.1, 0.46], rotation: [0, 0.06, 0] },
      { position: [-0.04, 0.12, 0.04], scale: [0.68, 0.11, 0.42], rotation: [0, -0.04, 0.02] },
      { position: [0.03, -0.14, -0.03], scale: [0.82, 0.095, 0.5], rotation: [0, 0.03, -0.02] },
      { position: [-0.02, -0.38, 0.02], scale: [0.62, 0.085, 0.38], rotation: [0, -0.07, 0] },
    ],
  },
  research: {
    kind: 'lattice',
    activationAxis: [0.68, 0.36, 0.62],
    members: [
      { position: [-0.04, 0, 0], scale: [0.78, 0.045, 0.06], rotation: [0, 0.16, 0.32] },
      { position: [0.03, 0.02, 0.02], scale: [0.76, 0.04, 0.06], rotation: [0, -0.12, -0.38] },
      { position: [0, 0.02, 0], scale: [0.68, 0.04, 0.06], rotation: [0.18, 0.22, 1.18] },
      { position: [-0.08, -0.16, 0.06], scale: [0.48, 0.035, 0.05], rotation: [0.12, -0.12, -0.72] },
      { position: [0.12, 0.18, -0.05], scale: [0.44, 0.035, 0.05], rotation: [-0.14, 0.08, 0.82] },
      { position: [0, 0, 0.1], scale: [0.08, 0.08, 0.08], rotation: [0.2, 0.3, 0.1] },
    ],
  },
};

function normalizedDetail(detail: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(detail) ? detail : 0));
}

/** Deterministic, bounded processing-region geometry for each semantic domain. */
export function deriveDomainVisualDescriptor(
  nodeId: DomainVisualNodeId,
  detail: number,
): DomainVisualDescriptor {
  const preset = DOMAIN_PRESETS[nodeId];
  const detailLevel = normalizedDetail(detail);
  const minimumMembers = Math.min(3, preset.members.length);
  const memberCount = Math.max(minimumMembers, Math.ceil(
    minimumMembers + (preset.members.length - minimumMembers) * detailLevel,
  ));

  return {
    nodeId,
    kind: preset.kind,
    activationAxis: preset.activationAxis,
    members: preset.members.slice(0, memberCount),
  };
}
