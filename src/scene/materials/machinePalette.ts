/**
 * One machine language for every surface in the scene.
 *
 * The palette is deliberately narrow: luminance tiers carry the composition,
 * hue only separates structural families. Nothing here is bright enough to
 * substitute for real form, mass or negative space.
 */
export const MACHINE_PALETTE = Object.freeze({
  /** Scene background and the deepest recessed read. */
  void: '#050609',

  /** Structural shell tiers, ordered high → low orientation luminance. */
  shellHigh: '#cbdcd4',
  shellMid: '#8ea69f',
  shellLow: '#546a67',
  /** Recessed interior faces: present, never competing with the silhouette. */
  interior: '#26302f',

  /** Thin layered surfaces. */
  membrane: '#a3c0b6',
  membraneQuiet: '#5a7571',

  /** Route ports and ingress sockets. */
  port: '#d6e6de',
  portQuiet: '#7d958e',

  /** A domain that is present but not participating. */
  dormant: '#3c494b',

  /** Signal language shared by Core routes, Core signals and Graph routes. */
  routePrimary: '#cfe3d8',
  routeSecondary: '#9cb7af',
  routeAmbient: '#5d7874',
  routeSignal: '#e8f4ec',
  routeIngress: '#b9d4c9',

  /** Text and non-geometric accents. */
  ink: '#dce6e2',
  quiet: '#7f8889',
});

export type MachinePalette = typeof MACHINE_PALETTE;

/**
 * The physical read of a surface, which is what decides how it answers state.
 *
 * Roles are not brightness settings. Each one names a different kind of surface
 * in the machine, and the response curve attached to it follows from that:
 * a structural shell holds the frame and barely moves, a socket is where state
 * enters the machine and answers most.
 */
export type SurfaceRole = 'volume' | 'beam' | 'port' | 'interior' | 'membrane';

/**
 * One surface's answer to the machine's state.
 *
 * Two channels, both of them plain numbers written to plain material
 * properties: a multiplier on the surface's own colour, and — for the tiers
 * that blend — an openness that becomes an alpha.
 *
 * The gain is the whole of a solid's vocabulary. An opaque material ignores
 * `opacity`, so a solid whose response was written to `opacity` would respond
 * to nothing at all; that is not a hypothetical, it is what this scene shipped
 * with, and it is why every solid's answer is a colour multiplier now.
 *
 * Resting below 1 is deliberate. The multiplier is the only lever an opaque
 * surface has, so it needs somewhere to travel: a surface that rests at full
 * brightness can only ever be clipped by its own activity.
 */
export type SurfaceResponseCurve = {
  /** Colour multiplier with nothing happening. */
  readonly gainAtRest: number;
  /** Added multiplier at full activity. */
  readonly gainFromActivity: number;
  /** Added multiplier at full focus. */
  readonly gainFromFocus: number;
  /** Added openness at full activity. Blending tiers only. */
  readonly fadeFromActivity: number;
  /** Added openness at full focus. Blending tiers only. */
  readonly fadeFromFocus: number;
};

/**
 * The response curves, one per role, in one table.
 *
 * Ordering the tiers by how much they answer is the point: the recessed
 * interior rises furthest, so a domain that starts working reads as lit from
 * inside while the shell around it stays where it is. That is internal
 * luminance, and it is reachable on both backends precisely because it is only
 * a colour multiplier.
 */
export const SURFACE_RESPONSE_CURVES = Object.freeze({
  /** Structural mass. Holds the frame; a machine's shell does not flex. */
  volume: {
    gainAtRest: 0.94,
    gainFromActivity: 0.05,
    gainFromFocus: 0.02,
    fadeFromActivity: 0,
    fadeFromFocus: 0,
  },
  /** Long thin conduits between assemblies: a little more life than the shell. */
  beam: {
    gainAtRest: 0.92,
    gainFromActivity: 0.08,
    gainFromFocus: 0.03,
    fadeFromActivity: 0,
    fadeFromFocus: 0,
  },
  /** Sockets and ingress: where state crosses the boundary, so it answers most. */
  port: {
    gainAtRest: 0.88,
    gainFromActivity: 0.16,
    gainFromFocus: 0.09,
    fadeFromActivity: 0,
    fadeFromFocus: 0,
  },
  /**
   * Recessed internal machinery. Sits deep and dark at rest and rises furthest,
   * which is what makes a working domain read as a lit interior rather than as
   * a domain that has merely been scaled up.
   */
  interior: {
    gainAtRest: 0.72,
    gainFromActivity: 0.26,
    gainFromFocus: 0.16,
    fadeFromActivity: 0,
    fadeFromFocus: 0,
  },
  /**
   * Layered surfaces: the only tier with an alpha channel to open, and the only
   * one already tuned by eye, so its openness increments are unchanged.
   */
  membrane: {
    gainAtRest: 0.96,
    gainFromActivity: 0.07,
    gainFromFocus: 0.03,
    fadeFromActivity: 0.34,
    fadeFromFocus: 0.5,
  },
} as const satisfies Readonly<Record<SurfaceRole, SurfaceResponseCurve>>);

/** Structural luminance tiers, ordered from the key-facing tier downwards. */
export const STRUCTURE_TIERS = Object.freeze([
  MACHINE_PALETTE.shellHigh,
  MACHINE_PALETTE.shellMid,
  MACHINE_PALETTE.shellLow,
  MACHINE_PALETTE.interior,
] as const);

/**
 * Key direction used to bake orientation-dependent luminance into structure
 * geometry. It points over the viewer's shoulder, slightly upper-right, so the
 * default framing gets a stable mass read without any runtime lighting.
 */
export const STRUCTURE_KEY_DIRECTION = Object.freeze([
  0.42, 0.6, 0.68,
] as const);