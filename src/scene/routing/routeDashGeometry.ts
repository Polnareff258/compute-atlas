import * as THREE from 'three';

import {
  ROUTE_CLASS_INDEX,
  sampleRoutePoint,
  sampleRouteTangent,
  deriveRouteAcross,
  type RouteCurve,
  type RouteDashAttributes,
} from './routeDash';

/** One channel of the interleaved dash vertex, and the packed values behind it. */
type DashChannel = {
  readonly name: string;
  readonly size: number;
  readonly data: Float32Array;
};

/**
 * Copies the packed dash attributes onto a real BufferGeometry.
 *
 * Ribbon quads are used rather than instanced quads so every attribute is an
 * ordinary vertex attribute: `instancedBufferAttribute` needs the concrete
 * attribute object at material-build time, which the material factory
 * deliberately does not have.
 *
 * The field needs twelve channels per vertex, and WebGPU refuses a pipeline whose
 * vertex buffer count exceeds `maxVertexBuffers` (8): bound as twelve separate
 * attributes the render pipeline never builds and the frame never reaches the
 * screen. Three groups attributes that share one `InterleavedBuffer` into a single
 * vertex buffer, so the layout is written as one stride with a per-channel offset
 * rather than as twelve independent buffers.
 */
export function createRouteDashGeometry(
  attributes: RouteDashAttributes,
): THREE.BufferGeometry {
  const { vertexCount } = attributes;
  const channels: readonly DashChannel[] = [
    // A zeroed position keeps three's bounding-sphere and draw-count maths valid;
    // the material's position node replaces it entirely, and the caller disables
    // frustum culling.
    { name: 'position', size: 3, data: new Float32Array(vertexCount * 3) },
    { name: 'dashCorner', size: 2, data: attributes.corner },
    { name: 'dashStart', size: 3, data: attributes.start },
    { name: 'dashControl', size: 3, data: attributes.control },
    { name: 'dashEnd', size: 3, data: attributes.end },
    { name: 'dashPhase', size: 1, data: attributes.phase },
    { name: 'dashSpeed', size: 1, data: attributes.speed },
    { name: 'dashLength', size: 1, data: attributes.length },
    { name: 'dashWidth', size: 1, data: attributes.width },
    { name: 'dashRoute', size: 1, data: attributes.route },
    { name: 'dashGroup', size: 1, data: attributes.group },
    { name: 'dashBrightness', size: 1, data: attributes.brightness },
  ];

  let stride = 0;
  const layout = channels.map((channel) => {
    const offset = stride;
    stride += channel.size;
    return { name: channel.name, size: channel.size, data: channel.data, offset };
  });

  const packed = new Float32Array(vertexCount * stride);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const base = vertex * stride;
    for (const channel of layout) {
      const source = vertex * channel.size;
      for (let component = 0; component < channel.size; component += 1) {
        // A short source array would otherwise leave zeros in some lanes and
        // stale values in others; zero is the one value every channel reads as
        // "absent" rather than as a position at the origin of the route.
        packed[base + channel.offset + component] =
          channel.data[source + component] ?? 0;
      }
    }
  }

  const buffer = new THREE.InterleavedBuffer(packed, stride);
  const geometry = new THREE.BufferGeometry();
  for (const channel of layout) {
    geometry.setAttribute(
      channel.name,
      new THREE.InterleavedBufferAttribute(buffer, channel.size, channel.offset),
    );
  }
  geometry.setIndex(new THREE.BufferAttribute(attributes.indices, 1));

  return geometry;
}

/** Sample counts per profile tier; the ribbon is a channel, not a polyline. */
const RIBBON_MIN_SAMPLES = 8;
const RIBBON_MAX_SAMPLES = 24;
/**
 * The channel has to be a band, not a hairline.
 *
 * At the scene's framing a world unit is roughly two hundred pixels, so the
 * previous few-thousandths width resolved to one or two pixels and the entire
 * routing field read as scratched wire irrespective of how many packets were
 * riding it. A channel that is several pixels wide is what lets the eye follow a
 * route, and it is what the packets then have something to sit inside.
 */
const RIBBON_MIN_WIDTH = 0.08;
const RIBBON_MAX_WIDTH = 0.2;

/**
 * Continuous routing channel under the dashes.
 *
 * Bakes an along-route luminance gradient into vertex colours: brighter at the
 * source, thinning toward the ingress. That gradient is what makes the channel
 * read as directional even in a still frame with no dashes moving.
 */
export function createRouteRibbonGeometry(
  curves: readonly RouteCurve[],
  detail = 1,
): THREE.BufferGeometry {
  const bounded = Number.isFinite(detail) ? Math.min(1, Math.max(0, detail)) : 0;
  const samples = Math.max(
    RIBBON_MIN_SAMPLES,
    Math.round(RIBBON_MIN_SAMPLES + (RIBBON_MAX_SAMPLES - RIBBON_MIN_SAMPLES) * bounded),
  );
  const width = RIBBON_MIN_WIDTH + (RIBBON_MAX_WIDTH - RIBBON_MIN_WIDTH) * bounded;

  const vertexCount = curves.length * samples * 2;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  // Mirrors the dash attributes so the ribbon can dim with the same per-route
  // weights the dashes use, instead of needing its own state channel.
  const routeGroups = new Float32Array(vertexCount);
  const routeClasses = new Float32Array(vertexCount);
  const indices: number[] = [];
  const point: number[] = [0, 0, 0];
  const tangent: number[] = [0, 0, 0];
  const across: number[] = [0, 0, 0];

  curves.forEach((curve, curveIndex) => {
    const classBias =
      1 - ROUTE_CLASS_INDEX[curve.route] * 0.16 - Math.min(0.3, curve.rank * 0.05);

    for (let sample = 0; sample < samples; sample += 1) {
      const t = sample / (samples - 1);
      sampleRoutePoint(curve, t, point);
      sampleRouteTangent(curve, t, tangent);
      deriveRouteAcross(tangent, 0, across);

      // Source-bright, ingress-dim, plus a slight narrowing toward arrival.
      const taper = 1 - Math.pow(t, 1.6) * 0.55;
      const halfWidth = width * taper * 0.5;
      const luminance = Math.min(1, Math.max(0, (1 - t * 0.78) * classBias));

      for (let side = 0; side < 2; side += 1) {
        const vertex = (curveIndex * samples + sample) * 2 + side;
        const sign = side === 0 ? -1 : 1;
        positions[vertex * 3] = point[0]! + across[0]! * halfWidth * sign;
        positions[vertex * 3 + 1] = point[1]! + across[1]! * halfWidth * sign;
        positions[vertex * 3 + 2] = point[2]! + across[2]! * halfWidth * sign;
        colors[vertex * 3] = luminance;
        colors[vertex * 3 + 1] = luminance;
        colors[vertex * 3 + 2] = luminance;
        routeGroups[vertex] = curve.group;
        routeClasses[vertex] = ROUTE_CLASS_INDEX[curve.route];
      }
    }

    const base = curveIndex * samples * 2;
    for (let sample = 0; sample < samples - 1; sample += 1) {
      const near = base + sample * 2;
      indices.push(near, near + 1, near + 3, near, near + 3, near + 2);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('routeGroup', new THREE.BufferAttribute(routeGroups, 1));
  geometry.setAttribute('routeClass', new THREE.BufferAttribute(routeClasses, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * One low-density dash quad for the WebGL2 instanced path.
 *
 * Centred on the origin, so the view places a dash by setting the instance
 * matrix position to the dash centre and scaling to (arc length, width, 1).
 *
 * The WebGL2 fallback has no vertex shader to place dashes, so the view drives a
 * bounded instanced mesh on the CPU with the same envelope maths the GPU path
 * uses.
 */
export function createDashQuadGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const corners = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  const positions = new Float32Array(corners.length * 3);
  const colors = new Float32Array(corners.length * 3).fill(1);
  corners.forEach((corner, index) => {
    positions[index * 3] = corner[0]!;
    positions[index * 3 + 1] = corner[1]!;
    positions[index * 3 + 2] = 0;
  });
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  // `instanceColor` only declares a vertex attribute; the fragment stage needs
  // USE_COLOR, which requires a real (white) color attribute and vertexColors.
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}