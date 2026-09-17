'use client';

import type { RendererRuntimeState } from '../renderer/runtime';
import { getRendererStatusCopy } from './statusCopy';

export function RendererStatus({ state }: { state: RendererRuntimeState }) {
  const copy = getRendererStatusCopy(state);

  return (
    <aside className={`renderer-status renderer-status--${copy.tone}`}>
      <p className="renderer-status__eyebrow">GRAPHICS BACKEND</p>
      <p className="renderer-status__label">{copy.label}</p>
      <p className="renderer-status__detail">{copy.detail}</p>
      <p className="renderer-status__quality">
        QUALITY / {state.quality.toUpperCase()}
        <span aria-hidden="true"> · </span>
        RUNTIME / {state.status.toUpperCase()}
      </p>
    </aside>
  );
}
