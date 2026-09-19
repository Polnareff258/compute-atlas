'use client';

import type { RendererAdapterBackend } from '../../renderer/runtime';
import { RouteDashes } from '../routing/RouteDashes';
import type { RouteCurve, RouteFlowState } from '../routing/routeDash';

type GraphEdgesProps = {
  /**
   * Trunks, branches, approaches and each domain's internal circuits.
   *
   * Derived by the integration boundary, which also reports on them, so the
   * field that is drawn and the field that is described cannot disagree.
   */
  readonly curves: readonly RouteCurve[];
  /**
   * Owned by the scene, because the Core's circulation and the Graph routes share
   * one signal language and therefore one field state.
   */
  readonly flowRef: React.RefObject<RouteFlowState>;
  readonly backend: RendererAdapterBackend;
  readonly reducedMotion: boolean;
  /** Highest route class lane the quality profile exposes. */
  readonly lanes: number;
  readonly detail: number;
};

/**
 * Routing as a real channel: `Core port -> shared trunk -> branch -> domain
 * ingress -> that domain's own interior`.
 *
 * There is deliberately no per-edge line and no travelling sphere: a route here
 * is a luminous packet moving along a channel, which is the same signal language
 * the Core's own circulation uses.
 */
export function GraphEdges({
  curves,
  flowRef,
  backend,
  reducedMotion,
  lanes,
  detail,
}: GraphEdgesProps) {
  return (
    <group name="graph-routes">
      <RouteDashes
        backend={backend}
        curves={curves}
        detail={detail}
        flowRef={flowRef}
        lanes={lanes}
        reducedMotion={reducedMotion}
      />
    </group>
  );
}
