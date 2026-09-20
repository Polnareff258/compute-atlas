import type { StructurePart, StructureTier } from '../materials/structureGeometry';
import { hashSigned, hashUnit, normalizeSeed } from '../seedRandom';
import type { DomainFieldDescriptor, DomainPhenomenon } from './domainPhenomena';

type Vector = readonly [number, number, number];

/**
 * The local geometry each phenomenon generates.
 *
 * The matter field gives every region its motion, but motion alone cannot say
 * *what kind* of computation is happening — five region-shaped clouds moving at
 * five different rates are still five clouds. What distinguishes them on screen
 * is that each one grows the temporary structure its own kind of work produces:
 * a sampling region grows sheets, a throughput region grows buses, a research
 * region grows almost nothing at all.
 *
 * Every family here is small, open and non-repeating by construction. The brief
 * forbids repeated boxes and evenly distributed fragments, and the way to obey
 * that is not to add noise to a grid but to build each family from a different
 * primitive in the first place.
 */

/** Structures are built in region-local space and then moved to the centre. */
function at(centre: Vector, local: Vector): Vector {
  return [centre[0] + local[0], centre[1] + local[1], centre[2] + local[2]];
}

function beam(
  centre: Vector,
  start: Vector,
  end: Vector,
  width: number,
  tier: StructureTier,
  surface: StructurePart['surface'],
): StructurePart {
  return {
    shape: 'span',
    tier,
    surface,
    start: at(centre, start),
    end: at(centre, end),
    width,
    depth: width,
  };
}

function plate(
  centre: Vector,
  local: Vector,
  rotation: Vector,
  halfExtents: Vector,
  tier: StructureTier,
  surface: StructurePart['surface'],
): StructurePart {
  return {
    shape: 'form',
    tier,
    surface,
    position: at(centre, local),
    rotation,
    scale: [halfExtents[0] * 2, halfExtents[1] * 2, halfExtents[2] * 2],
  };
}

function shell(
  centre: Vector,
  points: readonly Vector[],
  halfWidth: number | readonly number[],
  halfHeight: number | readonly number[],
  tier: StructureTier,
  surface: StructurePart['surface'],
  reference: Vector = [0, 1, 0],
): StructurePart {
  return {
    shape: 'path',
    tier,
    surface,
    points: points.map((point) => at(centre, point)),
    closed: false,
    halfWidth,
    halfHeight,
    chamfer: 0.24,
    reference,
  };
}

/**
 * AI: a branching hierarchy, self-similar across two scales.
 *
 * Built as a recursive split rather than a list of beams, so the smaller
 * branches are literally the same figure as the larger ones. That self-similarity
 * is the whole read: an inference tree is recognisable because its parts look
 * like its whole, and a hand-placed set of beams would look like a hand-placed
 * set of beams.
 */
function buildInference(
  descriptor: DomainFieldDescriptor,
  seed: number,
): StructurePart[] {
  const parts: StructurePart[] = [];
  const { extent: e, centre } = descriptor;

  const trunkEnd: Vector = [e[0] * 0.62, e[1] * 0.4, 0];
  parts.push(
    shell(
      centre,
      [[-e[0] * 0.9, -e[1] * 0.55, e[2] * 0.2], [0, -e[1] * 0.05, 0], trunkEnd],
      [0.1, 0.08, 0.05],
      [0.1, 0.08, 0.05],
      'primary',
      'shell',
    ),
  );

  const breadth = 4;
  for (let index = 0; index < breadth; index += 1) {
    const spread = (index / (breadth - 1)) * 2 - 1;
    const branchEnd: Vector = [
      trunkEnd[0] + spread * e[0] * 0.55,
      trunkEnd[1] + e[1] * (0.3 + Math.abs(spread) * 0.28),
      spread * e[2] * 0.45,
    ];
    parts.push(
      beam(centre, trunkEnd, branchEnd, 0.045, 'detail', 'edge'),
    );

    // Second scale: the same fan, a fifth the size, off each branch. This is the
    // self-similarity, and it is why the region reads as a hierarchy rather than
    // as a trident.
    for (let twig = 0; twig < 2; twig += 1) {
      const wobble = hashSigned(seed, index * 5 + twig + 1) * 0.35;
      parts.push(
        beam(
          centre,
          branchEnd,
          [
            branchEnd[0] + spread * e[0] * 0.2 + wobble * 0.3,
            branchEnd[1] + e[1] * 0.16,
            branchEnd[2] + wobble * e[2] * 0.3,
          ],
          0.024,
          'recess',
          'edge',
        ),
      );
    }

    // The candidate faces the branches are evaluating. Small, pale, and oriented
    // across the branch so they read as thing-being-decided rather than as more
    // structure.
    if (index % 2 === 0) {
      parts.push(
        plate(
          centre,
          [branchEnd[0], branchEnd[1] + e[1] * 0.1, branchEnd[2]],
          [0.3, spread * 0.7, 0.2],
          [e[0] * 0.26, 0.02, e[2] * 0.2],
          'detail',
          'accent',
        ),
      );
    }
  }

  return parts;
}

/**
 * GRAPHICS: sampling sheets.
 *
 * Five broad plates, deliberately near-coplanar and deliberately not parallel:
 * the interference between their planes is the phenomenon, so they have to be
 * close enough to beat against each other and far enough not to become one
 * surface. The region is the only one whose matter forms *sheets* rather than
 * streams, and the sheets are what the matter then condenses onto.
 */
function buildSampling(
  descriptor: DomainFieldDescriptor,
  seed: number,
): StructurePart[] {
  const parts: StructurePart[] = [];
  const { extent: e, centre } = descriptor;
  const sheets = 5;

  for (let index = 0; index < sheets; index += 1) {
    const t = index / (sheets - 1);
    const skew = hashSigned(seed, index + 300) * 0.14;
    parts.push(
      plate(
        centre,
        [
          (t - 0.5) * e[0] * 0.5,
          (t - 0.5) * e[1] * 0.9 + hashSigned(seed, index + 320) * 0.2,
          (t - 0.5) * e[2] * 0.6,
        ],
        [skew, 0.22 + t * 0.2, skew * 1.4],
        [e[0] * (0.95 - t * 0.3), 0.018, e[2] * (0.85 - t * 0.25)],
        index === 2 ? 'primary' : 'recess',
        'shell',
      ),
    );
  }

  // The sampling grid: a sparse lattice across the sheet stack. It is the one
  // place in the scene where a regular arrangement is correct, because a
  // sampling grid *is* regular — but it is drawn as lines rather than as cells,
  // and it is bounded by the sheets rather than filling a box.
  for (let index = 0; index < 9; index += 1) {
    const t = (index / 8) * 2 - 1;
    parts.push(
      beam(
        centre,
        [-e[0] * 0.85, t * e[1] * 0.8, -e[2] * 0.6],
        [e[0] * 0.85, t * e[1] * 0.8, e[2] * 0.6],
        0.016,
        'detail',
        'edge',
      ),
    );
  }

  return parts;
}

/**
 * GAME ANALYSIS: two state streams and the ghost of the one that was rolled back.
 *
 * The pair is the point. A single stream is just flow; two streams running in
 * parallel, one of which is a half-step behind and dimmer, is a state machine
 * with a history — and the divergence between them is where the interesting
 * frame is.
 */
function buildBranching(
  descriptor: DomainFieldDescriptor,
  seed: number,
): StructurePart[] {
  const parts: StructurePart[] = [];
  const { extent: e, centre } = descriptor;
  const rails = 2;

  for (let index = 0; index < rails; index += 1) {
    const offsetY = (index - (rails - 1) / 2) * e[1] * 1.05;
    const bend = hashSigned(seed, index + 400) * 0.3;
    parts.push(
      shell(
        centre,
        [
          [-e[0] * 0.95, offsetY, -e[2] * 0.5],
          [-e[0] * 0.2, offsetY + bend * e[1] * 0.3, 0],
          [e[0] * 0.35, offsetY - bend * e[1] * 0.25, e[2] * 0.4],
          [e[0] * 0.95, offsetY, e[2] * 0.5],
        ],
        [0.07, 0.07, 0.07, 0.07],
        [0.07, 0.07, 0.07, 0.07],
        index === 0 ? 'primary' : 'secondary',
        'shell',
      ),
    );
  }

  // The rollback ghost: the same rail, a step behind, dimmer and offset. Drawn
  // as a real member rather than as an afterimage effect, because an afterimage
  // is a thing the geometry can be, and a post-process would put it on
  // everything in the frame instead of on the one stream that rewound.
  parts.push(
    shell(
      centre,
      [
        [-e[0] * 0.8, -e[1] * 0.52, -e[2] * 0.4],
        [0, -e[1] * 0.62, -e[2] * 0.05],
        [e[0] * 0.6, -e[1] * 0.5, e[2] * 0.35],
      ],
      [0.05, 0.05, 0.05],
      [0.05, 0.05, 0.05],
      'recess',
      'membrane',
      [0, 1, 0],
    ),
  );

  // Comparison regions: where the two rails are compared, marked by a plate that
  // spans both of them.
  for (let index = 0; index < 3; index += 1) {
    const x = (index - 1) * e[0] * 0.55;
    parts.push(
      plate(
        centre,
        [x, 0, 0],
        [0, 0, 0],
        [0.05, e[1] * 0.62, e[2] * 0.22],
        'detail',
        'accent',
      ),
    );
  }

  return parts;
}

/**
 * SYSTEMS: a stack of buses under load.
 *
 * The only region in the scene whose structure is *ordered*, and the ordering is
 * the statement: a throughput machine is legible because you can see the layers
 * and count them. The vertical risers are what turn a stack of plates into a
 * bus, and the queue head — a small clamped mass at one end — is what turns a
 * bus into a bus under pressure.
 */
function buildThroughput(
  descriptor: DomainFieldDescriptor,
  seed: number,
): StructurePart[] {
  const parts: StructurePart[] = [];
  const { extent: e, centre } = descriptor;
  const buses = 6;

  for (let index = 0; index < buses; index += 1) {
    const t = index / (buses - 1);
    const y = (t - 0.5) * e[1] * 1.7;
    parts.push(
      plate(
        centre,
        [0, y, 0],
        [0, 0, 0],
        [e[0] * (0.98 - t * 0.12), 0.045, e[2] * (0.9 - t * 0.1)],
        index % 2 === 0 ? 'primary' : 'secondary',
        'shell',
      ),
      // Risers every third bus: the stack is one machine rather than six plates.
      ...[0, 1, 2].map((slot) =>
        plate(
          centre,
          [(slot - 1) * e[0] * 0.62, y + e[1] * 0.08, 0],
          [0, 0, 0],
          [0.05, e[1] * 0.1, e[2] * 0.8],
          'detail',
          'edge',
        ),
      ),
    );

    // Queue pressure: the outermost bus carries a clamped mass at the head.
    if (index === buses - 1) {
      parts.push(
        plate(
          centre,
          [e[0] * 0.72, y, 0],
          [0, 0, 0],
          [e[0] * 0.2, 0.09, e[2] * 0.5],
          'anchor',
          'accent',
        ),
      );
    }
  }

  void seed;
  return parts;
}

/**
 * RESEARCH: almost nothing, deliberately.
 *
 * This is the one region whose defining property is sparsity, and the way to
 * draw sparsity is to spend very little on it. Four long probes into depth and
 * two analysis slices — and the slices are placed where a probe has returned
 * something rather than evenly, so the region reads as a place where something
 * was found rather than as a place that was measured.
 */
function buildProbe(
  descriptor: DomainFieldDescriptor,
  seed: number,
): StructurePart[] {
  const parts: StructurePart[] = [];
  const { extent: e, centre } = descriptor;
  const probes = 4;

  for (let index = 0; index < probes; index += 1) {
    const angle = (index / probes) * Math.PI * 2 + hashSigned(seed, index + 500) * 0.4;
    const length = e[0] * (0.7 + hashUnit(seed, index + 520) * 0.9);
    parts.push(
      beam(
        centre,
        [0, 0, 0],
        [Math.cos(angle) * length, hashSigned(seed, index + 540) * e[1] * 0.8, Math.sin(angle) * length * 0.8],
        0.022,
        'detail',
        'edge',
      ),
    );
  }

  for (let index = 0; index < 2; index += 1) {
    const angle = index * 2.4 + 0.6;
    parts.push(
      plate(
        centre,
        [Math.cos(angle) * e[0] * 0.5, e[1] * (index === 0 ? 0.3 : -0.25), Math.sin(angle) * e[2] * 0.5],
        [0.4, angle, 0.3],
        [e[0] * 0.5, 0.012, e[2] * 0.42],
        'recess',
        'membrane',
      ),
    );
  }

  return parts;
}

const BUILDERS: Readonly<
  Record<
    DomainPhenomenon,
    (descriptor: DomainFieldDescriptor, seed: number) => StructurePart[]
  >
> = {
  inference: buildInference,
  sampling: buildSampling,
  branching: buildBranching,
  throughput: buildThroughput,
  probe: buildProbe,
};

/**
 * A translucent skin around the region.
 *
 * Every domain has one, and it is the same construction in all five: an open
 * swept shell that wraps the envelope without closing. It is what makes a region
 * read as a *pocket* — a bounded piece of the substrate where something is
 * happening — rather than as a cluster of parts floating in the frame, and
 * because it is a membrane it is the one surface in the region that answers an
 * interaction by thinning.
 */
function buildSkin(
  descriptor: DomainFieldDescriptor,
  seed: number,
): StructurePart[] {
  const { extent: e, centre } = descriptor;
  const rise = e[1] * 1.5;
  const bow = hashSigned(seed, 700) * 0.2;

  return [
    shell(
      centre,
      [
        [-e[0] * 1.02, -rise, -e[2] * 0.9],
        [-e[0] * 0.55, rise * (0.72 + bow), -e[2] * 0.5],
        [e[0] * 0.5, rise * (0.94 - bow), e[2] * 0.4],
        [e[0] * 1.02, -rise * 0.9, e[2] * 0.9],
      ],
      [0.03, 0.028, 0.028, 0.03],
      [0.03, 0.028, 0.028, 0.03],
      'recess',
      'membrane',
      [0, 0, 1],
    ),
  ];
}

export function buildDomainParts(
  descriptor: DomainFieldDescriptor,
  seed = 17,
): readonly StructurePart[] {
  const normalised = normalizeSeed(seed + descriptor.kind * 13);
  return [
    ...BUILDERS[descriptor.phenomenon](descriptor, normalised),
    ...buildSkin(descriptor, normalised),
  ];
}
