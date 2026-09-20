import type { DomainBehaviour } from '../watershed/watershedDescriptor';

/**
 * The five regions, as contributions to the one density field.
 *
 * ## Why this is a bake and not five objects
 *
 * The brief is explicit that the domains are not icons: "five domains, not icons, but small
 * computational sub-environments — internal density structure, local flow directions, route
 * ingress and egress, different deposition or oscillation behaviour". Every one of those four
 * things is already a concept in this composition, and all four live in the density field. So
 * a region is not a mesh placed at a location; it is a *term in the field*, and what makes it
 * a region is that the term is local.
 *
 * That choice also removes a whole class of failure. Five meshes over a world whose surfaces
 * are all displaced by the same field sampled by world position would be five more sets of
 * exactly-coincident surfaces — the z-fighting that a previous capture read as shattered
 * geometry — and they would need the ownership partition applied a third time, against a
 * growing set of neighbours. A field term has no surfaces and cannot conflict with any.
 *
 * ## What distinguishes the five
 *
 * Behaviour first, colour second, which is the brief's own ordering and the reason a
 * greyscale capture has to be able to tell them apart. Each behaviour gets a different
 * *pattern*: a delta is many shallow competing runnels, terraces are concentric steps, a
 * ravine is one deep cut, strata are broad bands, and an expanse is sparse and wide. The
 * `DomainTerrain` figures the descriptor already carries — amplitude, frequency, terrace,
 * step, invert — drive them, so the pattern a region shows is the one the descriptor asked
 * for rather than a second art direction layered on top of it.
 */

export type InkDomain = {
  readonly centre: readonly [number, number];
  readonly radius: number;
  readonly behaviour: DomainBehaviour;
  readonly terrain: {
    readonly amplitude: number;
    readonly frequency: number;
    readonly terrace: number;
    readonly step: number;
    readonly invert: number;
  };
};

export type DomainContribution = {
  /** Added to the body channel. */
  readonly body: number;
  /** Added to scour. */
  readonly scour: number;
  /** Added to settle. */
  readonly settle: number;
};

/**
 * How far past its own radius a region's influence decays, as a multiple.
 *
 * Wider than the basin's, because a region is not a place with an edge — it is a difference
 * in the physics of an area, and the brief's own note about the RESEARCH expanse says the
 * density field has "a deliberate empty zone", which is a statement about influence reaching
 * well past a boundary. The tail is what makes two adjacent regions meet rather than abut.
 */
const REACH_MULTIPLE = 2.1;

/**
 * How much of a region's pattern reaches the *body* channel versus the erosion channels.
 *
 * Weighted toward erosion and deposition rather than toward density, and that is the
 * distinction between a region and a stain: a term that only brightened the body would be a
 * tint drawn on the ground, whereas one that changes what the water has cut and left is a
 * difference in what is happening there.
 */
const BODY_SHARE = 0.34;

export function sampleDomainField(
  domains: readonly InkDomain[],
  x: number,
  z: number,
  seed: number,
): DomainContribution {
  let body = 0;
  let scour = 0;
  let settle = 0;

  for (let index = 0; index < domains.length; index += 1) {
    const domain = domains[index]!;
    const dx = x - domain.centre[0];
    const dz = z - domain.centre[1];
    const distance = Math.hypot(dx, dz);
    const reach = Math.max(1, domain.radius * REACH_MULTIPLE);
    if (distance > reach) continue;

    // A smooth envelope rather than a hard disc. The quadratic falloff is shared by every
    // behaviour so that a region's *edge* is the same kind of edge everywhere; what differs
    // between regions is the structure inside it, not how it ends.
    const t = 1 - distance / reach;
    const envelope = t * t * (3 - 2 * t);

    const pattern = domainPattern(domain, dx, dz, distance, seed + index * 977);
    const amplitude = Math.max(0, domain.terrain.amplitude) * envelope;

    body += pattern.body * amplitude * BODY_SHARE;
    scour += pattern.scour * amplitude;
    settle += pattern.settle * amplitude;
  }

  return { body, scour, settle };
}

/**
 * The structure inside one region, normalised to about `0`..`1` before amplitude.
 *
 * `distance` is passed in rather than recomputed because every behaviour needs it and the
 * caller has it — a radial pattern that recomputed its own radius would be a second place for
 * the two to disagree about where the centre is.
 */
function domainPattern(
  domain: InkDomain,
  dx: number,
  dz: number,
  distance: number,
  seed: number,
): { body: number; scour: number; settle: number } {
  const radius = Math.max(1, domain.radius);
  const normalised = Math.min(1, distance / radius);
  const angle = Math.atan2(dz, dx);
  const frequency = Math.max(0.5, domain.terrain.frequency);
  const terrace = Math.min(1, Math.max(0, domain.terrain.terrace));
  const phase = (seed % 1000) / 1000;

  switch (domain.behaviour) {
    /*
     * A delta: many shallow competing runnels.
     *
     * Radial spokes with a slowly varying width, so the region reads as a fan of small
     * channels rather than as a star. The `sin` on the angle is the spoke count and the
     * `sin` on the radius makes each spoke break and re-form rather than running straight to
     * the middle — which is what a delta's distributaries actually do, and what stops the
     * pattern reading as a wheel.
     */
    case 'delta': {
      const spokes = Math.sin(angle * Math.round(frequency * 7) + phase * 6.283);
      const broken = Math.sin(normalised * frequency * 9 + phase * 3.14);
      const value = (spokes * 0.5 + 0.5) * (broken * 0.35 + 0.65);
      return { body: value, scour: value * 0.85, settle: value * 0.55 };
    }

    /*
     * Terraces: concentric steps.
     *
     * The quantisation is the whole behaviour. `floor` on the normalised radius gives rings,
     * and the fractional part gives each ring a riser — the same construction the terrain's
     * basin strata use, applied at a region's scale and with the step height the descriptor
     * set. A region whose terraces were merely banded colour would be a pattern; one where
     * the ring is a *step* has an edge that catches the key light.
     */
    case 'terraces': {
      const steps = Math.max(2, Math.round(frequency * 3.2));
      const quantised = normalised * steps;
      const ring = quantised - Math.floor(quantised);
      const riser = Math.min(1, Math.max(0, (ring - 0.55) / 0.45));
      // The descriptor's terrace value means how much of the pattern is stepped
      // rather than smooth, so it is spent here as the blend between the two forms
      // instead of as a step height. Without it this behaviour and `strata` differ
      // only in scale, which is one behaviour with a parameter wearing two names.
      const steppedValue = (Math.floor(quantised) / steps) * 0.5 + riser * 0.5;
      const smoothValue = 0.5 + 0.5 * Math.sin(quantised * Math.PI);
      const value = steppedValue * terrace + smoothValue * (1 - terrace);
      return { body: value * 0.7, scour: value, settle: (1 - value) * 0.6 };
    }

    /*
     * A ravine: one deep cut.
     *
     * A single linear feature through the region, angled by the phase, with the cut at its
     * centre and deposition on both shoulders. It is the only behaviour that is directional,
     * which is what makes it readable in greyscale at a glance — and it is the reason the
     * brief gives the region's flow a *direction* rather than only a magnitude.
     */
    case 'ravine': {
      const tilt = phase * Math.PI;
      const across = dx * Math.sin(tilt) + dz * Math.cos(tilt);
      const width = radius * 0.22;
      const cut = Math.exp(-(across * across) / (width * width));
      const shoulder = Math.exp(-(across * across) / (width * width * 9));
      return { body: cut * 0.8, scour: cut, settle: Math.max(0, shoulder - cut) * 0.9 };
    }

    /*
     * Strata: broad concentric bands.
     *
     * Unlike terraces these are not steps — they are wide bands with soft edges, which is the
     * difference between a region that has been *cut* into layers and one that has been *laid
     * down* in them. The distinction matters because the brief gives SYSTEMS (Throughput
     * Strata) and GRAPHICS (Spectral Terraces) different behaviour, and two behaviours that
     * differed only in step height would be one behaviour with a parameter.
     */
    case 'strata': {
      const bands = Math.sin(normalised * Math.round(frequency * 5) * Math.PI + phase * 6.283);
      const smooth = bands * 0.5 + 0.5;
      // Strata are laid down rather than cut, so their `terrace` narrows the bands'
      // shoulders instead of quantising them: at 1 a band is a plate, at 0 it is a
      // gradient, and the two regions that use these behaviours are told apart by
      // which of those a viewer sees.
      const plate = smooth > 0.5 ? 1 : 0;
      const value = smooth * (1 - terrace) + plate * terrace;
      return { body: value * 0.6, scour: value * 0.45, settle: (1 - value) * 0.8 };
    }

    /*
     * An expanse: sparse, wide and mostly empty.
     *
     * The brief calls for a deliberate empty zone, and this is it. The pattern is a single
     * low-frequency undulation with almost no amplitude, so the region is mostly *absence* —
     * which in a composition where everything else is dense is itself a strong signal, and is
     * the reason this behaviour's value is deliberately close to a constant.
     */
    default: {
      const drift = Math.sin(normalised * 2.4 + phase * 6.283) * 0.5 + 0.5;
      const value = 0.18 + drift * 0.22;
      return { body: value * 0.5, scour: value * 0.3, settle: value * 0.35 };
    }
  }
}

/** The descriptor's own terrace step, applied to a region's relief where it has one. */
export function domainStepHeight(domain: InkDomain): number {
  return domain.terrain.step * Math.min(1, Math.max(0, domain.terrain.terrace));
}
