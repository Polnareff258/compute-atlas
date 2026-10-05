import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

function ribbonPoint(u: number, v: number) {
  const angle = u * Math.PI * 2;
  const width = v * 0.57;
  const radius = 1.32 + 0.22 * Math.sin(angle * 2);
  const twist = angle * 0.5;
  return new Vector3(
    (radius + width * Math.cos(twist)) * Math.cos(angle),
    (radius + width * Math.cos(twist)) * Math.sin(angle) * 1.1,
    width * Math.sin(twist) + 0.38 * Math.sin(angle * 2),
  );
}

function random(seed: number) {
  const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function createRibbon() {
  const rows = 160, columns = 20;
  const positions: number[] = [], indices: number[] = [], uvs: number[] = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      positions.push(...ribbonPoint(row / rows, column / columns * 2 - 1).toArray());
      uvs.push(row / rows, column / columns);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column, b = a + columns + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const indexed = new BufferGeometry();
  indexed.setAttribute('position', new Float32BufferAttribute(positions, 3));
  indexed.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  indexed.setIndex(indices);
  indexed.computeVertexNormals();
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  const position = geometry.getAttribute('position');
  const centers: number[] = [], scatter: number[] = [];
  for (let i = 0; i < position.count; i += 3) {
    // Adjacent triangles travel together as broad shards rather than fine confetti.
    const sourceIndex = indices[i] ?? 0;
    const rowGroup = Math.floor(Math.floor(sourceIndex / (columns + 1)) / 8);
    const columnGroup = Math.floor((sourceIndex % (columns + 1)) / 4);
    const center = ribbonPoint((rowGroup * 8 + 4) / rows, (columnGroup * 4 + 2) / columns * 2 - 1);
    const seed = (rowGroup * 6 + columnGroup) * 11;
    const offset = [
      (random(seed + 1) - 0.5) * 12,
      (random(seed + 2) - 0.5) * 7,
      (random(seed + 3) - 0.5) * 15,
    ];
    for (let j = 0; j < 3; j++) { centers.push(...center.toArray()); scatter.push(...offset); }
  }
  geometry.setAttribute('aCenter', new Float32BufferAttribute(centers, 3));
  geometry.setAttribute('aScatter', new Float32BufferAttribute(scatter, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createParticleField(count: number) {
  const positions: number[] = [], scatter: number[] = [], seeds: number[] = [];
  for (let i = 0; i < count; i++) {
    positions.push(...ribbonPoint(random(i + 5), random(i + 18) * 2 - 1).toArray());
    scatter.push((random(i + 23) - 0.5) * 15, (random(i + 42) - 0.5) * 9, (random(i + 73) - 0.5) * 12);
    seeds.push(random(i + 91));
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aScatter', new Float32BufferAttribute(scatter, 3));
  geometry.setAttribute('aSeed', new Float32BufferAttribute(seeds, 1));
  return geometry;
}
