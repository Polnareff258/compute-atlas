import type { Camera, Vector3 as ThreeVector3 } from 'three';

import { GRAPH_MANIFEST } from '../../graph/graphManifest';
import type { DomainId, WatershedDescriptor } from '../watershed/watershedDescriptor';

/**
 * The five regions, as things on screen rather than only things in a field.
 *
 * ## Why this module has to exist
 *
 * The brief's own BEFORE analysis named this as the failure it was written against, in these
 * words: "two of five domains carry no label at idle… nothing on screen says they are there".
 * A region that exists only as a term in a density field is a region a visitor cannot point
 * at, and — more concretely — one a capture harness cannot click, because the harness resolves
 * its input from a label's own DOM rectangle rather than guessing coordinates. A composition
 * whose subjects have no on-screen presence is not addressable, and addressability is a
 * documented acceptance criterion rather than a nicety.
 *
 * ## What it projects, and what it deliberately does not
 *
 * Each region's `labelAnchor` — a world position the descriptor already carries — through the
 * live camera. Nothing here reads the frame buffer or inspects the scene graph: a projection
 * is six multiplications and it cannot disagree with what was drawn, because it is the same
 * matrix chain the vertices went through.
 *
 * What it does not do is decide whether a region is *worth* labelling. An earlier composition
 * had a prominence threshold, and the consequence was the defect above — regions suppressed at
 * idle and therefore invisible and unclickable. Every region is projected every frame here;
 * what changes with state is how the label is presented, never whether it exists.
 */

export type DomainLabelEntry = {
  readonly id: DomainId;
  readonly label: string;
  /** Screen position in CSS pixels. */
  readonly x: number;
  readonly y: number;
  /** False when the anchor is behind the camera or off the frame. */
  readonly visible: boolean;
  /** How prominent the label should be, `0`..`1`. */
  readonly presence: number;
  readonly hovered: boolean;
  readonly focused: boolean;
};

/** The five regions' names, read from the graph manifest so there is one source for them. */
const DOMAIN_LABELS: readonly { readonly id: DomainId; readonly label: string }[] = GRAPH_MANIFEST.nodes
  .filter((node) => node.kind === 'domain')
  .map((node) => ({ id: node.id as DomainId, label: node.label }));

export type DomainProjectionInput = {
  readonly descriptor: WatershedDescriptor;
  readonly camera: Camera;
  readonly width: number;
  readonly height: number;
  readonly hoveredDomainId: DomainId | null;
  readonly focusedDomainId: DomainId | null;
  /** Scratch vector, owned by the caller so this allocates nothing per frame. */
  readonly scratch: ThreeVector3;
};

/**
 * Typography follows attention instead of annotating the whole landscape.
 *
 * A dormant label remains just perceptible at full resolution so the regions are still
 * discoverable, but it drops out of the thumbnail and stops turning the composition back
 * into a diagram. Hover is the readable preview; focus gets the complete information budget.
 */
export function resolveDomainLabelPresence(hovered: boolean, focused: boolean): number {
  if (focused) return 1;
  if (hovered) return 0.78;
  return 0.045;
}

export function projectDomainLabels(input: DomainProjectionInput): DomainLabelEntry[] {
  const { descriptor, camera, width, height, scratch } = input;
  const entries: DomainLabelEntry[] = [];

  for (const definition of DOMAIN_LABELS) {
    const region = descriptor.domains.find((candidate) => candidate.id === definition.id);
    if (region === undefined) continue;

    const anchor = region.labelAnchor;
    scratch.set(anchor[0], anchor[1], anchor[2]);
    // The same matrix chain the geometry went through, so a label cannot be drawn somewhere
    // the region is not.
    scratch.project(camera);

    // `z > 1` is behind the camera. Without this check a region behind the viewer projects to
    // a mirrored position *in front* of it, and its label appears attached to a piece of empty
    // frame — the classic projection bug, and one that reads as the label being wrong rather
    // than as the region being hidden.
    const behind = scratch.z > 1;
    const x = (scratch.x * 0.5 + 0.5) * width;
    const y = (-scratch.y * 0.5 + 0.5) * height;
    const onFrame = x > -80 && x < width + 80 && y > -60 && y < height + 60;

    const hovered = input.hoveredDomainId === definition.id;
    const focused = input.focusedDomainId === definition.id;

    entries.push({
      id: definition.id,
      label: definition.label,
      x,
      y,
      visible: !behind && onFrame,
      // Dormant regions remain discoverable but do not flatten the idle frame into a labelled
      // diagram. Interaction supplies the contrast: hover makes the local environment legible,
      // focus gives it the full typographic budget.
      presence: resolveDomainLabelPresence(hovered, focused),
      hovered,
      focused,
    });
  }

  return entries;
}

/** The five ids in the manifest's own order, for a layer that has to render one node each. */
export const DOMAIN_LABEL_ORDER: readonly { readonly id: DomainId; readonly label: string }[] =
  DOMAIN_LABELS;
