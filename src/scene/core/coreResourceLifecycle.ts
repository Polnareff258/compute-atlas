/**
 * One lease per topology-owned resource record. Layout-effect cleanup schedules
 * retirement at the next microtask checkpoint: React's synchronous StrictMode
 * cleanup/setup replay can retain the same record before any disposal occurs.
 * Generation checks invalidate stale retirements, even across repeated replays.
 * No GPU work or allocation happens here during visual-input/frame updates.
 */
export function createResourceLease(dispose: () => void) {
  let holders = 0;
  let generation = 0;
  let disposed = false;

  return {
    retain(): () => void {
      if (disposed) {
        throw new Error('Cannot retain retired structural resources');
      }
      holders += 1;
      generation += 1;
      let released = false;

      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        if (holders !== 0) return;

        const retirement = ++generation;
        queueMicrotask(() => {
          if (disposed || holders !== 0 || retirement !== generation) return;
          disposed = true;
          dispose();
        });
      };
    },
  };
}

/** Attempt every independently owned release before reporting failures. */
export function disposeAll(resources: readonly { dispose(): void }[]): void {
  const errors: unknown[] = [];
  for (const resource of resources) {
    try {
      resource.dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Failed to release structural resources');
  }
}
