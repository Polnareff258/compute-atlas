/**
 * One machine language for every surface in the scene.
 *
 * The palette is graphite with a mineral cast, and it is deliberately dark: the
 * mass of a computing structure is not a light source, so almost everything
 * here sits between near-black and mid grey and the composition is carried by
 * the separation between those steps rather than by their absolute value. Hue
 * separates structural families; luminance tiers carry the form. The single
 * exception is the icy accent, and it is the exception precisely because it is
 * rare — a pale surface is only an accent while most of the frame is not pale.
 */
export const MACHINE_PALETTE = Object.freeze({
  /** Scene background and the deepest recessed read. */
  void: '#04070a',

  /** Structural shell tiers, ordered high → low orientation luminance. */
  shellHigh: '#8b9997',
  shellMid: '#4b585a',
  shellLow: '#283133',
  /** Recessed interior faces: present, never competing with the silhouette. */
  interior: '#121a1c',

  /** Thin layered surfaces. */
  membrane: '#7fa39e',
  membraneQuiet: '#3a5250',

  /** Route ports and ingress sockets. */
  port: '#d5e9e8',
  portQuiet: '#78928f',

  /** A domain that is present but not participating. */
  dormant: '#222b2e',

  /**
   * The pale icy accent: wafers, dies and edge strips.
   *
   * It is the only value in the palette allowed near the top of the range, and
   * the response curves are the only thing keeping it from becoming the scene's
   * dominant tone — most of the structure is not accent, and the accent class
   * spends most of its time below its own resting colour.
   */
  accent: '#dceeee',

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
 * an outer shell holds the frame and barely moves, while a recess is where the
 * machine's insides are and answers the most.
 *
 * The role set is the finish set. A surface's role and the class its geometry
 * bakes into are the same word, so a finish cannot be rendered by a curve that
 * was written for a different one.
 */
export type SurfaceRole =
  | 'shell'
  | 'edge'
  | 'recess'
  | 'accent'
  | 'membrane'
  | 'port';

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
 * There are four increments and they mean different things, which is the point
 * of keeping them apart. `activity` is the state of the thing this surface
 * belongs to; `focus` is whether it is the one being examined; `proximity` is
 * how close the running routing field is to this surface, which is how a
 * manifold lights where the flow actually is rather than everywhere at once.
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
  /** Added multiplier as the routing field arrives at this surface. */
  readonly gainFromProximity: number;
  /** Added openness at full activity. Blending tiers only. */
  readonly fadeFromActivity: number;
  /** Added openness at full focus. Blending tiers only. */
  readonly fadeFromFocus: number;
  /** Added openness as the routing field arrives. Blending tiers only. */
  readonly fadeFromProximity: number;
};

/**
 * The response curves, one per role, in one table.
 *
 * Ordering the tiers by how much they answer is the point. `recess` sits
 * deepest and rises furthest, so a structure that starts working reads as lit
 * from inside while the shell around it stays where it is — that is internal
 * luminance, and it is reachable on both backends precisely because it is only
 * a colour multiplier. `accent` travels furthest of all and rests low, because a
 * pale surface that is always pale is not an accent.
 */
export const SURFACE_RESPONSE_CURVES = Object.freeze({
  /** Structural mass. Holds the frame; a machine's shell does not flex. */
  shell: {
    gainAtRest: 0.93,
    gainFromActivity: 0.05,
    gainFromFocus: 0.02,
    gainFromProximity: 0.04,
    fadeFromActivity: 0,
    fadeFromFocus: 0,
    fadeFromProximity: 0,
  },
  /**
   * Corners and thin strips. Ordinary activity moves these a little, and the
   * view term in `CoreStructureView` moves them the rest of the way: they are
   * the surfaces whose grazing angle against the camera changes most as the
   * camera moves, so they are where a view-dependent response belongs.
   */
  edge: {
    gainAtRest: 0.84,
    gainFromActivity: 0.09,
    gainFromFocus: 0.05,
    gainFromProximity: 0.09,
    fadeFromActivity: 0,
    fadeFromFocus: 0,
    fadeFromProximity: 0,
  },
  /**
   * Set-back interiors. Sits low at rest and rises furthest, which is what makes
   * a working structure read as a lit interior rather than as one that has
   * merely been scaled up.
   */
  recess: {
    gainAtRest: 0.6,
    gainFromActivity: 0.3,
    gainFromFocus: 0.22,
    gainFromProximity: 0.2,
    fadeFromActivity: 0,
    fadeFromFocus: 0,
    fadeFromProximity: 0,
  },
  /** Wafers and dies. Rare, restless, and the only class with real headroom. */
  accent: {
    gainAtRest: 0.78,
    gainFromActivity: 0.42,
    gainFromFocus: 0.28,
    gainFromProximity: 0.3,
    fadeFromActivity: 0,
    fadeFromFocus: 0,
    fadeFromProximity: 0,
  },
  /**
   * Layered surfaces: the only tier with an alpha channel to open, so it is the
   * one place where a surface can thin as well as brighten — the interference
   * variation of a membrane is its openness moving, not a new effect.
   */
  membrane: {
    gainAtRest: 0.95,
    gainFromActivity: 0.08,
    gainFromFocus: 0.04,
    gainFromProximity: 0.06,
    fadeFromActivity: 0.26,
    fadeFromFocus: 0.42,
    fadeFromProximity: 0.18,
  },
  /** Sockets and ingress: where state crosses the boundary, so it answers most. */
  port: {
    gainAtRest: 0.86,
    gainFromActivity: 0.18,
    gainFromFocus: 0.1,
    gainFromProximity: 0.22,
    fadeFromActivity: 0,
    fadeFromFocus: 0,
    fadeFromProximity: 0,
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

/**
 * The nominal view axis the composition is authored against.
 *
 * Baked view response needs a view to be baked against, and the real camera is
 * only free within a narrow band: it dollies, it offsets, it takes a little
 * pointer parallax, and it never orbits. This names the axis that band is
 * centred on, so the `edge` class can be authored as a function of grazing
 * angle and the runtime term only has to carry the departure from it.
 */
export const STRUCTURE_VIEW_AXIS = Object.freeze([0, 0, 1] as const);
