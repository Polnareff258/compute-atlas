export type GraphNodeId =
  | 'core'
  | 'ai'
  | 'graphics'
  | 'game-analysis'
  | 'systems'
  | 'research';

export type GraphNodeKind = 'core' | 'domain';

export type GraphNode = {
  readonly id: GraphNodeId;
  readonly label: string;
  readonly description: string;
  readonly kind: GraphNodeKind;
  readonly parentId: GraphNodeId | null;
  readonly importance: number;
};

export type GraphEdge = {
  readonly id: string;
  readonly source: GraphNodeId;
  readonly target: GraphNodeId;
  readonly kind: 'primary';
  readonly strength: number;
};

export type GraphManifest = {
  readonly id: string;
  readonly version: number;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
};

export type GraphPosition = readonly [x: number, y: number, z: number];

export type GraphLayout = Readonly<Record<GraphNodeId, GraphPosition>>;
