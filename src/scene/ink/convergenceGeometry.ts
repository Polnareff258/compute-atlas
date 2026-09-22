import { PlaneGeometry } from 'three';

import type { ConvergenceLayerKind, ConvergenceSegments } from './convergenceProfile';

/**
 * Builds the authored low-frequency silhouette of the convergence volume.
 *
 * The GPU still supplies the moving fine deformation. This geometry supplies
 * what a shader cannot recover from a flat plane: a stable arch, torsion across
 * the width and a silhouette that changes with the camera rather than merely
 * changing opacity.
 *
 * ## Why the segmentation is an argument
 *
 * This sheet's *shape* is a smooth function of normalised position — an arch, a
 * torsion and two low-frequency sweeps — so the grid resolution decides only how
 * finely that curve is sampled, never where it runs. That is what makes a quality
 * tier's segmentation a legitimate setting to change: a coarser grid is the same
 * silhouette measured at fewer points, and the profile's tiers are chosen to stay
 * inside the range where the sampled outline still reads as the same outline.
 *
 * It is required rather than defaulted, because a default would be a tier's
 * figures quietly applying to every caller that did not think about it, and the
 * whole point of the ladder is that each tier states what it draws.
 */
export function createConvergenceGeometry(
  radius: number,
  kind: ConvergenceLayerKind,
  segments: ConvergenceSegments,
) {
  const filament = kind === 'filament';
  const width = radius * (filament ? 3.65 : 4.40);
  const depth = radius * (filament ? 0.44 : 1.86);
  const [across, along] = segments;
  const geometry = new PlaneGeometry(width, depth, across, along);
  const position = geometry.attributes.position!;

  for (let index = 0; index < position.count; index += 1) {
    const sourceX = position.getX(index);
    const sourceY = position.getY(index);
    const u = sourceX / (width * 0.5);
    const v = sourceY / (depth * 0.5);
    const longitudinal = Math.max(0, 1 - u * u);
    const lateral = Math.max(0, 1 - Math.abs(v));
    const taper = filament ? 0.22 + Math.pow(longitudinal, 0.55) * 0.78 : 1;

    const arch =
      radius *
      (filament ? 0.12 : 0.20) *
      longitudinal *
      (0.78 + Math.cos(v * Math.PI) * 0.22);
    const torsion =
      radius *
      (filament ? 0.13 : 0.21) *
      v *
      Math.sin(u * Math.PI * 1.15);
    const foldedEdge =
      radius *
      (filament ? 0.018 : 0.032) *
      Math.sin((u * 2.8 + v * 1.7) * Math.PI) *
      lateral *
      longitudinal;
    const xSweep =
      radius *
      (filament ? 0.055 : 0.12) *
      Math.sin(v * Math.PI * 0.75) *
      (1 - Math.abs(u));
    const ySweep =
      radius *
      (filament ? 0.025 : 0.075) *
      Math.sin(u * Math.PI * 0.85) *
      (1 - v * v);
    const calligraphicDrift = filament
      ? radius * 0.04 * Math.sin(u * Math.PI * 0.95 + 0.6) * (0.25 + longitudinal * 0.75)
      : 0;
    const authoredMeander = filament
      ? radius *
        0.15 *
        (Math.sin(u * Math.PI * 0.72 + 0.2) * 0.72 +
          Math.sin(u * Math.PI * 1.7 - 0.35) * 0.28) *
        (0.34 + longitudinal * 0.66)
      : 0;

    position.setXYZ(
      index,
      sourceX + xSweep,
      sourceY * taper + ySweep + calligraphicDrift + authoredMeander,
      arch + torsion + foldedEdge - radius * (filament ? 0.07 : 0.10),
    );
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = `convergence-${kind}-geometry`;
  return geometry;
}
