#!/usr/bin/env node
/**
 * Renders a PNG as a terminal-readable luminance map plus a hue map.
 *
 * A text-only agent cannot look at a picture, and statistics alone cannot say
 * whether a composition *reads*. This closes the gap without a vision model: a
 * 96x54 grid of mean luminance, printed with a ramp, is legible enough to judge
 * where a subject is, whether it has a direction, and whether the frame has
 * negative space. The hue map beside it answers whether the palette is one family.
 *
 * Usage: node frame-ascii.mjs <file.png> [cols] [rows]
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
      rgb[i * 3 + 2] = palette[out[i] * 3 + 2];
    }
  }
  return { width, height, rgb };
}

const RAMP = ' .:-=+*#%@';

function main() {
  const [file, colsArg, rowsArg] = process.argv.slice(2);
  const cols = Number(colsArg ?? 96);
  const rows = Number(rowsArg ?? 40);
  const { width, height, rgb } = decodePng(readFileSync(file));

  const lum = new Float64Array(cols * rows);
  const red = new Float64Array(cols * rows);
  const green = new Float64Array(cols * rows);
  const blue = new Float64Array(cols * rows);
  const count = new Float64Array(cols * rows);

  for (let y = 0; y < height; y += 1) {
    const gy = Math.min(rows - 1, Math.floor((y / height) * rows));
    for (let x = 0; x < width; x += 1) {
      const gx = Math.min(cols - 1, Math.floor((x / width) * cols));
      const i = y * width + x;
      const g = gy * cols + gx;
      const r = rgb[i * 3];
      const gg = rgb[i * 3 + 1];
      const b = rgb[i * 3 + 2];
      lum[g] += 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      red[g] += r;
      green[g] += gg;
      blue[g] += b;
      count[g] += 1;
    }
  }

  let peak = 0;
  for (let i = 0; i < lum.length; i += 1) {
    lum[i] /= count[i];
    red[i] /= count[i];
    green[i] /= count[i];
    blue[i] /= count[i];
    if (lum[i] > peak) peak = lum[i];
  }

  console.log(`${file}  ${width}x${height}   peak luma ${peak.toFixed(1)}  grid ${cols}x${rows}`);
  console.log('--- luminance (ramp " .:-=+*#%@" over 0..peak) ---');
  for (let gy = 0; gy < rows; gy += 1) {
    let line = '';
    for (let gx = 0; gx < cols; gx += 1) {
      const v = lum[gy * cols + gx] / (peak || 1);
      line += RAMP[Math.min(RAMP.length - 1, Math.max(0, Math.round(v * (RAMP.length - 1))))];
    }
    console.log(line);
  }

  // The hue map: one letter per cell, from the cell's own dominant channel and its
  // saturation. `k` is near-black, `.` is a dim neutral, and the rest name the hue
  // family — enough to see at a glance whether the frame is one family or several.
  console.log('--- hue map (k=black .=neutral b=blue c=cyan v=violet w=bone/pink) ---');
  for (let gy = 0; gy < rows; gy += 1) {
    let line = '';
    for (let gx = 0; gx < cols; gx += 1) {
      const i = gy * cols + gx;
      const r = red[i];
      const g = green[i];
      const b = blue[i];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      if (max < 22) line += 'k';
      else if (sat < 0.10) line += '.';
      else if (r > b && r >= g) line += 'w';
      else if (b > r && g > r * 1.25) line += 'c';
      else if (r > g * 1.15) line += 'v';
      else line += 'b';
    }
    console.log(line);
  }
}

main();
