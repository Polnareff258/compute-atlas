#!/usr/bin/env node
/**
 * Surface-quality metrics for a rendered frame, aimed at one question a vision model cannot
 * answer reliably and a human can only answer by squinting: **is the geometry shattered?**
 *
 * ## Why this is measurable
 *
 * Two coincident surfaces do not produce a smooth artefact. The depth test picks a winner
 * per fragment, and which surface wins varies pixel to pixel with the depth buffer's own
 * precision, so the result is a field of *isolated* pixels whose value disagrees with
 * everything around them. That is a specific signature and it is exactly what this computes:
 *
 *   - **speckle** — the fraction of pixels that differ from the 3x3 median of their
 *     neighbours by more than a threshold. A continuous surface scores near zero, because
 *     every pixel is close to the median of its neighbourhood by construction. A z-fighting
 *     surface scores in the percent.
 *   - **isolated extrema** — pixels that are a local maximum or minimum against all four
 *     neighbours by a wide margin. These are the visible "sparkle" of a depth conflict, and
 *     unlike speckle they are not produced by legitimate fine detail, because legitimate
 *     detail is spatially correlated.
 *   - **laplacian energy** — mean absolute second derivative. High on noise, low on a smooth
 *     gradient, and largely insensitive to how bright the frame is.
 *   - **plateau ratio** — the fraction of pixels with a near-zero horizontal gradient. This
 *     is the banding indicator: a field stored in too few bits produces wide flat terraces
 *     separated by one-step risers, which reads as contour lines through a soft gradient.
 *
 * Each is reported per frame and, more usefully, compared: run it over two frames and the
 * one with the higher speckle is the one with the depth conflict.
 *
 * Usage: node frame-quality.mjs <a.png> [b.png ...]
 */

import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  let palette = null;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x += 1) {
      const rawByte = raw[pos + x];
      const left = x >= channels ? out[rowStart + x - channels] : 0;
      const up = y > 0 ? out[prevStart + x] : 0;
      const upLeft = y > 0 && x >= channels ? out[prevStart + x - channels] : 0;
      let v;
      if (filter === 0) v = rawByte;
      else if (filter === 1) v = rawByte + left;
      else if (filter === 2) v = rawByte + up;
      else if (filter === 3) v = rawByte + ((left + up) >> 1);
      else {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        v = rawByte + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      out[rowStart + x] = v & 0xff;
    }
    pos += stride;
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    if (colorType === 0 || colorType === 4) {
      rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = out[i * channels];
    } else if (colorType === 2 || colorType === 6) {
      rgb[i * 3] = out[i * channels];
      rgb[i * 3 + 1] = out[i * channels + 1];
      rgb[i * 3 + 2] = out[i * channels + 2];
    } else {
      rgb[i * 3] = palette[out[i] * 3];
      rgb[i * 3 + 1] = palette[out[i] * 3 + 1];
      rgb[i * 3 + 2] = palette[out[i * 3 + 2] ?? 0];
    }
  }
  return { width, height, rgb };
}

const SPECKLE_THRESHOLD = 12;
const EXTREMA_THRESHOLD = 22;
const FLAT_THRESHOLD = 0.5;

function analyse(file) {
  const { width, height, rgb } = decodePng(readFileSync(file));
  const luma = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    luma[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
  }

  let speckle = 0;
  let extrema = 0;
  let total = 0;
  let laplacianSum = 0;
  let flat = 0;
  let gradientSamples = 0;
  const grid = 12;
  const cellSpeckle = new Float64Array(grid * grid);
  const cellCount = new Float64Array(grid * grid);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const c = luma[i];
      const up = luma[i - width];
      const down = luma[i + width];
      const left = luma[i - 1];
      const right = luma[i + 1];

      // The 3x3 median is approximated by the median of the four edge neighbours plus the
      // centre, which is enough to detect "agrees with nobody" without a sort per pixel.
      const neighbourhood = [c, up, down, left, right].sort((a, b) => a - b);
      const median = neighbourhood[2];
      const isSpeckle = Math.abs(c - median) > SPECKLE_THRESHOLD;
      if (isSpeckle) speckle += 1;

      const localMax = c - Math.max(up, down, left, right) > EXTREMA_THRESHOLD;
      const localMin = Math.min(up, down, left, right) - c > EXTREMA_THRESHOLD;
      if (localMax || localMin) extrema += 1;

      laplacianSum += Math.abs(4 * c - up - down - left - right);
      const horizontal = Math.abs(c - left);
      if (horizontal < FLAT_THRESHOLD) flat += 1;
      gradientSamples += 1;
      total += 1;

      const gx = Math.min(grid - 1, Math.floor((x / width) * grid));
      const gy = Math.min(grid - 1, Math.floor((y / height) * grid));
      if (isSpeckle) cellSpeckle[gy * grid + gx] += 1;
      cellCount[gy * grid + gx] += 1;
    }
  }

  let peakCell = 0;
  for (let index = 0; index < cellSpeckle.length; index += 1) {
    cellSpeckle[index] = (cellSpeckle[index] / Math.max(1, cellCount[index])) * 100;
    if (cellSpeckle[index] > peakCell) peakCell = cellSpeckle[index];
  }

  const ramp = ' .:-=+*#%@';
  const lines = [];
  lines.push(`  speckle            : ${((speckle / total) * 100).toFixed(3)}%  (${speckle} isolated px)`);
  lines.push(`  isolated extrema   : ${((extrema / total) * 100).toFixed(3)}%`);
  lines.push(`  laplacian energy   : ${(laplacianSum / total).toFixed(3)}`);
  lines.push(`  flat-pixel ratio   : ${((flat / gradientSamples) * 100).toFixed(1)}%`);
  lines.push(`  worst cell speckle : ${peakCell.toFixed(2)}%`);
  for (let gy = 0; gy < grid; gy += 1) {
    let line = '  ';
    for (let gx = 0; gx < grid; gx += 1) {
      const v = cellSpeckle[gy * grid + gx] / (peakCell || 1);
      line += ramp[Math.min(ramp.length - 1, Math.max(0, Math.round(v * (ramp.length - 1))))];
    }
    lines.push(line);
  }
  return { name: file.split(/[\\/]/).pop(), lines };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node frame-quality.mjs <a.png> [b.png ...]');
  process.exit(2);
}
for (const file of files) {
  console.log(`=== ${file.split(/[\\/]/).pop()} ===`);
  for (const line of analyse(file).lines) console.log(line);
  console.log('');
}
