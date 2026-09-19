'use client';

import type { RendererRuntimeState } from '../renderer/runtime';
import { getRendererStatusCopy } from './statusCopy';

/**
 * One line: what the scene is running on and at what tier.
 *
 * There is no eyebrow, no runtime state, no adapter name — the status is a
 * caption to the composition, not a panel competing with it.
 */
export function RendererStatus({ state }: { state: RendererRuntimeState }) {
  const copy = getRendererStatusCopy(state);

  return (
    <aside className={`renderer-status renderer-status--${copy.tone}`}>
      <span className="renderer-status__label">{copy.label}</span>
      {copy.detail ? (
        <span className="renderer-status__detail">{copy.detail}</span>
      ) : null}
    </aside>
  );
}
