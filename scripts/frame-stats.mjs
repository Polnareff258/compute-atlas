#!/usr/bin/env node
/**
 * Frame statistics for PNG captures — zero dependencies.
 *
 * Chrome writes 8-bit PNGs; this decodes them with node:zlib and reports the
 * measurements an art-direction critique actually needs, because a text-only
 * agent cannot look at a picture and should not pretend to.
 *
 * Reports
 *   - luminance percentiles (p50/p90/p99/p99.9/peak) and mean
 *   - "spread" (p99.9 - p1) on the same definition the capture harness uses
 *   - a spatial grid of mean luminance, so composition can be read as numbers
 *   - dominant colours by 5-bit-per-channel quantisation, with pixel share
 *   - saturation histogram and how much of the frame is near-greyscale
 *   - horizontal-gradient energy (a proxy for "how much visible structure")
 *
 * Usage: node frame-stats.mjs <file.png> [gridW] [gridH]
 */

import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  let palette = null;
  let transparency = null;

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      if (data.readUInt8(12) !== 0) throw new Error('interlaced PNG unsupported');
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      transparency = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));

  const channelsFor = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsFor[colorType];
  if (channels === undefined) throw new Error(`unsupported colour type ${colorType}`);

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
      let value;
      switch (filter) {
        case 0: value = rawByte; break;
        case 1: value = rawByte + left; break;
        case 2: value = rawByte + up; break;
        case 3: value = rawByte + ((left + up) >> 1); break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          value = rawByte + predictor;
          break;
        }
        default: throw new Error(`bad filter ${filter}`);
      }
      out[rowStart + x] = value & 0xff;
    }
    pos += stride;
  }

  // Normalise every colour type to RGB triples.
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    let r;
    let g;
    let b;
    if (colorType === 0 || colorType === 4) {
      r = g = b = out[i * channels];
    } else if (colorType === 2 || colorType === 6) {
      r = out[i * channels];
      g = out[i * channels + 1];
      b = out[i * channels + 2];
    } else {
      const index = out[i] * 3;
      r = palette[index];
      g = palette[index + 1];
      b = palette[index + 2];
      void transparency;
    }
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
  }

  return { width, height, rgb };
}

function main() {
  const [file, gridWArg, gridHArg] = process.argv.slice(2);
  if (!file) {
    console.error('usage: node frame-stats.mjs <file.png> [gridW] [gridH]');
    process.exit(2);
  }
  const gridW = Number(gridWArg ?? 12);
  const gridH = Number(gridHArg ?? 8);

  const { width, height, rgb } = decodePng(readFileSync(file));
  const total = width * height;

  const luma = new Float32Array(total);
  const saturation = new Float32Array(total);
  const quant = new Map();
  const gridSum = new Float64Array(gridW * gridH);
  const gridCount = new Float64Array(gridW * gridH);

  let sum = 0;
  let greyPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const r = rgb[i * 3];
      const g = rgb[i * 3 + 1];
      const b = rgb[i * 3 + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      luma[i] = l;
      sum += l;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      saturation[i] = sat;
      if (sat < 0.06) greyPixels += 1;

      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      quant.set(key, (quant.get(key) ?? 0) + 1);

      const gx = Math.min(gridW - 1, Math.floor((x / width) * gridW));
      const gy = Math.min(gridH - 1, Math.floor((y / height) * gridH));
      gridSum[gy * gridW + gx] += l;
      gridCount[gy * gridW + gx] += 1;
    }
  }

  const sorted = Float32Array.from(luma).sort();
  const pct = (p) => sorted[Math.min(total - 1, Math.max(0, Math.round((p / 100) * (total - 1))))];

  // Horizontal gradient energy: mean |dL/dx|, a cheap "is there structure" number.
  let gradSum = 0;
  let gradCount = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 1; x < width; x += 1) {
      gradSum += Math.abs(luma[y * width + x] - luma[y * width + x - 1]);
      gradCount += 1;
    }
  }

  let satSum = 0;
  for (let i = 0; i < total; i += 1) satSum += saturation[i];

  const top = [...quant.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([key, count]) => {
    const r = ((key >> 10) & 31) << 3;
    const g = ((key >> 5) & 31) << 3;
    const b = (key & 31) << 3;
    return {
      hex: `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`,
      share: `${((count / total) * 100).toFixed(2)}%`,
    };
  });

  const grid = [];
  for (let gy = 0; gy < gridH; gy += 1) {
    const row = [];
    for (let gx = 0; gx < gridW; gx += 1) {
      row.push(Math.round(gridSum[gy * gridW + gx] / gridCount[gy * gridW + gx]));
    }
    grid.push(row);
  }

  console.log(JSON.stringify({
    file,
    size: `${width}x${height}`,
    luma: {
      mean: +(sum / total).toFixed(2),
      p1: +pct(1).toFixed(1),
      p50: +pct(50).toFixed(1),
      p90: +pct(90).toFixed(1),
      p99: +pct(99).toFixed(1),
      p999: +pct(99.9).toFixed(1),
      peak: +pct(100).toFixed(1),
      spread: +(pct(99.9) - pct(1)).toFixed(1),
    },
    litFraction: `${(((total - sorted.filter((v) => v <= 2).length) / total) * 100).toFixed(2)}%`,
    meanSaturation: +(satSum / total).toFixed(4),
    nearGreyShare: `${((greyPixels / total) * 100).toFixed(2)}%`,
    horizontalGradientEnergy: +(gradSum / Math.max(1, gradCount)).toFixed(3),
    dominantColours: top,
    luminanceGrid: grid,
  }, null, 2));
}

main();
