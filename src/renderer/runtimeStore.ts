import { create } from 'zustand';

import type { QualityProfile } from './types';
import type {
  RendererRuntime,
  RendererRuntimeState,
} from './runtime';

export type RendererRuntimeStore = RendererRuntimeState & {
  start: () => Promise<RendererRuntimeState>;
  stop: () => void;
  setQuality: (profile: QualityProfile) => void;
};

export function createRendererRuntimeStore(
  runtime: RendererRuntime,
) {
  return create<RendererRuntimeStore>((set) => ({
    ...runtime.getState(),
    start: async () => {
      const nextState = await runtime.start();
      set(nextState);
      return nextState;
    },
    stop: () => {
      runtime.stop();
      set(runtime.getState());
    },
    setQuality: (profile) => {
      runtime.setQuality(profile);
      set(runtime.getState());
    },
  }));
}
