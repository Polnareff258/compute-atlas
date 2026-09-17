'use client';

import { useEffect } from 'react';

import { getBootPhaseCopy } from './bootCopy';
import { BootFacts } from './BootFacts';
import type { BootState } from './types';

export type BootExperienceProps = {
  readonly state: BootState;
  readonly onEnter: () => void;
};

function canEnter(state: BootState): boolean {
  return state.phase === 'ready' || state.phase === 'degraded';
}

export function BootExperience({ state, onEnter }: BootExperienceProps) {
  const copy = getBootPhaseCopy(state);
  const entryAvailable = canEnter(state);

  useEffect(() => {
    if (!entryAvailable) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      onEnter();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [entryAvailable, onEnter]);

  return (
    <section
      className={'boot-experience boot-experience--' + state.phase}
      aria-label="POLNAREFF SYSTEM bootstrap"
      aria-live="polite"
      data-phase={state.phase}
    >
      <div className="boot-experience__grid" aria-hidden="true" />
      <header className="boot-experience__header">
        <div>
          <p className="boot-experience__brand">POLNAREFF SYSTEM</p>
          <p className="boot-experience__descriptor">
            INTERACTIVE PERSONAL COMPUTING ENVIRONMENT
          </p>
        </div>
        <p className="boot-experience__sequence">LOCAL / {copy.index}</p>
      </header>

      <div className="boot-experience__body">
        <div className="boot-experience__signal" aria-hidden="true">
          <span className="boot-experience__signal-ring boot-experience__signal-ring--outer" />
          <span className="boot-experience__signal-ring boot-experience__signal-ring--middle" />
          <span className="boot-experience__signal-ring boot-experience__signal-ring--inner" />
          <span className="boot-experience__signal-axis boot-experience__signal-axis--horizontal" />
          <span className="boot-experience__signal-axis boot-experience__signal-axis--vertical" />
        </div>
        <div className="boot-experience__copy">
          <p className="boot-experience__eyebrow">{copy.eyebrow}</p>
          <h1>{copy.label}</h1>
          <p className="boot-experience__detail">{copy.detail}</p>
          {state.error ? (
            <p className="boot-experience__error">{state.error}</p>
          ) : null}
        </div>
      </div>

      <div className="boot-experience__facts">
        <BootFacts state={state} />
        <div className="boot-experience__action">
          {entryAvailable ? (
            <button type="button" onClick={onEnter}>
              <span>ENTER COMPUTE ENVIRONMENT</span>
              <kbd>ENTER</kbd>
            </button>
          ) : (
            <p>
              {state.phase === 'complete'
                ? 'SYSTEM RUNNING / POINTER INPUT ENABLED'
                : 'INITIALIZING LOCAL SYSTEMS'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}