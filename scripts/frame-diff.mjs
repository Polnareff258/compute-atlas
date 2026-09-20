#!/usr/bin/env node
/**
 * Per-pixel difference between two PNGs, and the checks a scroll story needs.
 *
 * Written because the two things that would normally do this are unavailable here: the
 * sharp-based vision helpers fail on these captures, and a vision model cannot answer a
 * question about a 2-megapixel numerical comparison anyway.
 *
 * Reports:
 *   - the fraction of pixels differing by more than a threshold, and the mean absolute
 *     difference over the whole frame
 *   - a coarse grid showing *where* the differences are, so a claim like "the reverse scroll
 *     returns to the opening frame" can be checked rather than asserted
 *
 * Usage: node frame-diff.mjs <a.png> <b.png> [threshold] [grid]
 */

import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

export function decodePng(buffer) {
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
      rgb[i * 3 + 2] = palette[out[i] * 3 + 2];
    }
  }
  return { width, height, rgb };
}

function main() {
  const [fileA, fileB, thresholdArg, gridArg] = process.argv.slice(2);
  const threshold = Number(thresholdArg ?? 8);
  const grid = Number(gridArg ?? 12);

  const a = decodePng(readFileSync(fileA));
  const b = decodePng(readFileSync(fileB));
  if (a.width !== b.width || a.height !== b.height) {
    console.error(`size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    process.exit(1);
  }

  const total = a.width * a.height;
  let changed = 0;
  let absoluteSum = 0;
  let maxDelta = 0;
  const cells = new Float64Array(grid * grid);
  const cellCounts = new Float64Array(grid * grid);

  for (let y = 0; y < a.height; y += 1) {
    const gy = Math.min(grid - 1, Math.floor((y / a.height) * grid));
    for (let x = 0; x < a.width; x += 1) {
      const i = y * a.width + x;
      const la = 0.2126 * a.rgb[i * 3] + 0.7152 * a.rgb[i * 3 + 1] + 0.0722 * a.rgb[i * 3 + 2];
      const lb = 0.2126 * b.rgb[i * 3] + 0.7152 * b.rgb[i * 3 + 1] + 0.0722 * b.rgb[i * 3 + 2];
      const delta = Math.abs(la - lb);
      absoluteSum += delta;
      if (delta > maxDelta) maxDelta = delta;
      if (delta > threshold) changed += 1;
      const gx = Math.min(grid - 1, Math.floor((x / a.width) * grid));
      cells[gy * grid + gx] += delta;
      cellCounts[gy * grid + gx] += 1;
    }
  }

  const ramp = ' .:-=+*#%@';
  console.log(`${fileA.split(/[\\/]/).pop()}  vs  ${fileB.split(/[\\/]/).pop()}`);
  console.log(`  differing pixels (> ${threshold} luma): ${((changed / total) * 100).toFixed(3)}%  (${changed} of ${total})`);
  console.log(`  mean absolute difference              : ${(absoluteSum / total).toFixed(3)}`);
  console.log(`  max difference                        : ${maxDelta.toFixed(1)}`);
  console.log(`  --- where (mean |delta| per cell, grid ${grid}x${grid}) ---`);
  let peak = 0;
  for (let index = 0; index < cells.length; index += 1) {
    cells[index] /= cellCounts[index];
    if (cells[index] > peak) peak = cells[index];
  }
  for (let gy = 0; gy < grid; gy += 1) {
    let line = '  ';
    for (let gx = 0; gx < grid; gx += 1) {
      const v = cells[gy * grid + gx] / (peak || 1);
      line += ramp[Math.min(ramp.length - 1, Math.max(0, Math.round(v * (ramp.length - 1))))];
    }
    console.log(line);
  }
}

main();
