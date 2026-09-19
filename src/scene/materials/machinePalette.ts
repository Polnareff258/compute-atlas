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