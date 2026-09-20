import type { Vector2 } from './terrainField';
import type { Stratum } from './watershedDescriptor';

/**
 * The Convergence Basin's layered sheets, as one mesh.
 *
 * **What these are.** Each sheet is a *level the basin has filled to*: the set of
 * ground below a given height, drawn as a translucent film. The descriptor picks
 * the heights and measures the radius each one turns out to have — see the note at
 * `STRATUM_FILLS` for why the radius cannot be chosen by hand — and this module
 * turns that stack into geometry. Four nested discs a few units above their own
 * shorelines, each with a rim and a dish, is the whole of it.
 *
 * **Why they are discs and not terraces.** The terrain's own strata quantise the
 * basin's radius into five treads, and those are *structure* — a countable
 * staircase. These are the other half: a staircase is what the ground did, and a
 * level is what arrived. One is a shape, the other is an event, and the brief asks
 * for both ("layered surfaces / data deposition"). They are deliberately not
 * aligned: the treads are at fixed radii and the sheets are at fixed heights, and
 * a seed that deepens the basin moves one without moving the other. Aligning them
 * would make the sheets decoration on the treads; leaving them independent is what
 * makes them read as a fill line across whatever the ground happened to be.
 *
 * **Why the rim is wavy.** A perfect circle in a landscape is the one shape nature
 * does not make, and its regularity is what makes an overlay read as an overlay.
 * The rim is perturbed by a three-lobed wave whose phase comes from the sheet's own
 * `flowBias`, scaled by the radial fraction so the distortion vanishes at the
 * centre. The amplitude is under the inset the descriptor already applies to the
 * radius, so the wave can never push a sheet past its own shoreline and into the
 * bowl's wall — see `STRATUM_INSET`.
 *
 * **What it costs.** At ULTRA, four sheets are 4,612 vertices and 8,704 triangles,
 * one draw call, no texture, and one fractal noise per fragment on a surface whose
 * fill is mostly transparent. It is a third of the river's vertex count for the
 * frame's central subject, which is the right way round.
 */

/** Rings of vertices from a sheet's centre to its rim, the rim included. */
const RADIAL_ROWS = 9;
const ANGULAR_SEGMENTS = 128;

/**
 * The two shape constants, and why they are this small.
 *
 * `RIM_WAVE` is the rim's three-lobed distortion as a fraction of the sheet's
 * radius, and `STRATUM_INSET` in the descriptor leaves 4.5% of headroom before a
 * sheet would reach the ground that defines it — so 3% is a rim that is visibly
 * not a circle and is still, at every angle, above its own shoreline.
 *
 * `SHEET_SAG` is how far a sheet bowls *down* toward the centre, in world units.
 * It exists because the brief asks for deformable membranes and a perfectly flat
 * disc is the one surface that reads as a decal rather than as a body: a film
 * under load dishes. It is deliberately tiny against the basin's 179-unit depth —
 * this is the shape of the film, not a second depression, and it must not be
 * mistaken for one.
 */
const RIM_WAVE = 0.03;
const SHEET_SAG = 2.5;

export type StrataGeometryOptions = {
  readonly strata: readonly Stratum[];
  /** The basin's centre in world XZ. The mesh is mounted at the origin. */
  readonly centre: Vector2;
};

export type StrataGeometry = {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** The sheet's own radius, per vertex, so the fragment stage can find its rim. */
  readonly sheetRadius: Float32Array;
  /**
   * The sheet's position in the stack, per vertex, from `0` at the lowest to `1`
   * at the highest.
   *
   * Normalised here rather than in the material because the material has one mesh
   * and not one per sheet — it cannot count what it is drawing, and a stack whose
   * colour ramp depended on a number the shader guessed would be a ramp that
   * changed the day a seed produced a fifth sheet.
   */
  readonly sheetT: Float32Array;
};

export function buildStrataGeometry(options: StrataGeometryOptions): StrataGeometry {
  const { strata, centre } = options;
  const [centreX, centreZ] = centre;
  const count = strata.length;

  const verticesPerSheet = 1 + RADIAL_ROWS * ANGULAR_SEGMENTS;
  const positions = new Float32Array(count * verticesPerSheet * 3);
  const sheetRadius = new Float32Array(count * verticesPerSheet);
  const sheetT = new Float32Array(count * verticesPerSheet);
  const indices = new Uint32Array(count * (ANGULAR_SEGMENTS + (RADIAL_ROWS - 1) * ANGULAR_SEGMENTS * 2) * 3);

  let v = 0;
  let i = 0;

  strata.forEach((stratum, sheet) => {
    const base = sheet * verticesPerSheet;
    const baseV = base * 3;

    const write = (r: number, angle: number, fraction: number) => {
      // Wavy at the rim, circular at the centre: scaled by the radial fraction, so
      // the distortion is a property of the edge rather than an offset of the disc.
      const wave = 1 + RIM_WAVE * fraction * Math.sin(angle * 3 + stratum.flowBias);
      const radius = r * wave;
      const sag = SHEET_SAG * (1 - fraction * fraction);

      positions[baseV + v] = centreX + Math.cos(angle) * radius;
      positions[baseV + v + 1] = stratum.level - sag;
      positions[baseV + v + 2] = centreZ + Math.sin(angle) * radius;
      sheetRadius[base + v / 3] = stratum.radius;
      sheetT[base + v / 3] = count > 1 ? sheet / (count - 1) : 1;
      v += 3;
    };

    write(0, 0, 0);

    for (let row = 1; row <= RADIAL_ROWS; row += 1) {
      // Biased toward the rim, because the rim is where the film's edge and its
      // brightest band are and a linear ring spacing spends rows on an interior
      // that is nearly uniform. This puts three of the nine rows inside the band
      // the material draws its edge in.
      const fraction = 1 - (1 - row / RADIAL_ROWS) ** 1.7;
      for (let segment = 0; segment < ANGULAR_SEGMENTS; segment += 1) {
        write(stratum.radius * fraction, (segment / ANGULAR_SEGMENTS) * Math.PI * 2, fraction);
      }
    }

    /*
     * Wound counter-clockwise as seen from above, which is what makes a sheet
     * front-facing under the default `FrontSide`. For a Y-up triangle, facing is
     * `ab.z * ac.x - ab.x * ac.z > 0`, and going *around* the disc in increasing
     * angle with the centre first gives `sin(θ₁ − θ₂)`, which is negative — the
     * obvious order is backwards, and getting it wrong renders the entire stack
     * invisible rather than wrong. A failure that looks exactly like not having
     * built it is worth stating in full.
     */
    for (let segment = 0; segment < ANGULAR_SEGMENTS; segment += 1) {
      const next = (segment + 1) % ANGULAR_SEGMENTS;
      indices[i] = base;
      indices[i + 1] = base + 1 + next;
      indices[i + 2] = base + 1 + segment;
      i += 3;
    }

    for (let row = 1; row < RADIAL_ROWS; row += 1) {
      const inner = base + 1 + (row - 1) * ANGULAR_SEGMENTS;
      const outer = base + 1 + row * ANGULAR_SEGMENTS;
      for (let segment = 0; segment < ANGULAR_SEGMENTS; segment += 1) {
        const next = (segment + 1) % ANGULAR_SEGMENTS;
        indices[i] = inner + segment;
        indices[i + 1] = outer + next;
        indices[i + 2] = outer + segment;
        i += 3;

        indices[i] = inner + segment;
        indices[i + 1] = inner + next;
        indices[i + 2] = outer + next;
        i += 3;
      }
    }

    v = 0;
  });

  return { positions, indices, sheetRadius, sheetT };
}
