import type { BootPhase, BootState } from './types';

export type BootPhaseCopy = {
  readonly eyebrow: string;
  readonly label: string;
  readonly detail: string;
  readonly index: string;
};

const PHASE_COPY: Readonly<Record<BootPhase, BootPhaseCopy>> = {
  idle: {
    eyebrow: 'BOOTSTRAP // 00',
    label: 'AWAITING INITIALIZATION',
    detail: 'Preparing local graphics environment',
    index: '00',
  },
  probing_graphics: {
    eyebrow: 'BOOTSTRAP // 01',
    label: 'PROBING GRAPHICS',
    detail: 'Detecting available rendering backends',
    index: '01',
  },
  initializing_renderer: {
    eyebrow: 'BOOTSTRAP // 02',
    label: 'INITIALIZING RENDERER',
    detail: 'Constructing the preferred graphics pipeline',
    index: '02',
  },
  checking_systems: {
    eyebrow: 'BOOTSTRAP // 03',
    label: 'CHECKING SYSTEMS',
    detail: 'Aggregating local project and service state',
    index: '03',
  },
  constructing_scene: {
    eyebrow: 'BOOTSTRAP // 04',
    label: 'CONSTRUCTING SCENE',
    detail: 'Mounting the compute environment',
    index: '04',
  },
  ready: {
    eyebrow: 'BOOTSTRAP // 05',
    label: 'READY FOR ENTRY',
    detail: 'Compute environment is waiting for input',
    index: '05',
  },
  entering: {
    eyebrow: 'BOOTSTRAP // 06',
    label: 'ENTERING COMPUTE ENVIRONMENT',
    detail: 'Reorganizing the visual field',
    index: '06',
  },
  complete: {
    eyebrow: 'SYSTEM // ONLINE',
    label: 'COMPUTE ENVIRONMENT ACTIVE',
    detail: 'Local visual system is running',
    index: '07',
  },
  degraded: {
    eyebrow: 'SYSTEM // DEGRADED',
    label: 'CONTINUING WITH LIMITED SYSTEMS',
    detail: 'The visual shell remains available',
    index: 'DE',
  },
};

export function getBootPhaseCopy(state: BootState): BootPhaseCopy {
  return PHASE_COPY[state.phase];
}