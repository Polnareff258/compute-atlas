import { describe, it } from 'vitest';

import { createInkDensity } from './inkDensity';
import { meanderCourse } from './riverCourse';
import { createWatershedDescriptor } from '../watershed/watershedDescriptor';

/**
 * A diagnostic, not an assertion.
 *
 * This file exists to be read, not to pass. It prints the baked density field as an
 * ASCII map plus the numbers that decide whether the composition can work at all —
 * how wide each river is, where its spine runs, and how much of the world's area
 * carries a density above a few thresholds. Every one of those is a quantity the
 * material cannot create and the camera cannot fix, so when the captured frame does
 * not read as a river, this is the thing to look at before touching a shader.
 *
 * It asserts nothing on purpose: a probe with assertions becomes a test that has to
 * be maintained, and the numbers it prints are judgement calls rather than promises.
 */
describe('ink density probe', () => {
  it('prints the baked field', () => {
    const descriptor = createWatershedDescriptor(2026, 1);
    const extent = descriptor.field.extent;

    // The same meander the scene host applies, so the probe describes the field the
    // renderer actually draws rather than the descriptor's authoring lines.
    const courses = descriptor.rivers.map((river) => ({
      spine: meanderCourse({ spine: river.spine, width: river.width }, 2026),
      width: river.width,
      flowRate: river.flowRate,
    }));

    const density = createInkDensity({
      rivers: courses,
      deposits: descriptor.deposits,
      domains: descriptor.domains.map((domain) => ({
        centre: domain.centre,
        radius: domain.radius,
        behaviour: domain.behaviour,
        terrain: domain.terrain,
      })),
      basin: { centre: descriptor.basin.centre, radius: descriptor.basin.radius },
      extent,
      resolution: 640,
      seed: 2026,
    });

    const spanX = extent.maxX - extent.minX;
    const spanZ = extent.maxZ - extent.minZ;

    const lines: string[] = [];
    lines.push('');
    lines.push(`extent      : x ${extent.minX.toFixed(0)}..${extent.maxX.toFixed(0)}  z ${extent.minZ.toFixed(0)}..${extent.maxZ.toFixed(0)}  (${spanX.toFixed(0)} x ${spanZ.toFixed(0)})`);
    lines.push(`texture     : ${density.width} x ${density.height}`);
    lines.push(`rivers      : ${descriptor.rivers.length}`);
    for (const river of descriptor.rivers) {
      const xs = river.spine.map((p) => p[0]);
      const zs = river.spine.map((p) => p[1]);
      lines.push(
        `  ${river.id.padEnd(22)} width ${river.width.toFixed(1).padStart(6)}  rate ${river.flowRate.toFixed(2)}  feeds ${river.feeds.padEnd(6)}  spine x ${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)}  z ${Math.min(...zs).toFixed(0)}..${Math.max(...zs).toFixed(0)}  pts ${river.spine.length}`,
      );
    }
    lines.push(`basin       : centre ${descriptor.basin.centre[0].toFixed(0)},${descriptor.basin.centre[1].toFixed(0)}  radius ${descriptor.basin.radius.toFixed(0)}`);
    const xs = [descriptor.basin.centre[0], ...descriptor.domains.map((d) => d.centre[0])];
    const zs = [descriptor.basin.centre[1], ...descriptor.domains.map((d) => d.centre[1])];
    const worldSpanX = Math.max(...xs) - Math.min(...xs);
    const worldSpanZ = Math.max(...zs) - Math.min(...zs);
    lines.push(`world span  : x ${worldSpanX.toFixed(0)}  z ${worldSpanZ.toFixed(0)}  centroid ${((Math.min(...xs) + Math.max(...xs)) / 2).toFixed(0)},${((Math.min(...zs) + Math.max(...zs)) / 2).toFixed(0)}`);
    for (const d of descriptor.domains) {
      lines.push(`  region ${d.id.padEnd(14)} centre ${d.centre[0].toFixed(0).padStart(6)},${d.centre[1].toFixed(0).padStart(6)}  radius ${d.radius.toFixed(0).padStart(4)}  ${d.behaviour}`);
    }
    const halfFov = (48 * Math.PI / 180) / 2;
    lines.push(`reveal eye  : ${(Math.max(worldSpanZ / 2 / Math.tan(halfFov), worldSpanX / 2 / (Math.tan(halfFov) * (16 / 9))) * 1.35).toFixed(0)} (for 16:9, 35% margin)`);

    // Coverage: what fraction of the world carries a density at each threshold.
    const thresholds = [0.15, 0.3, 0.5, 0.75];
    const counts = thresholds.map(() => 0);
    let total = 0;
    for (let i = 0; i < density.width * density.height; i += 1) {
      const body = density.data[i * 4] ?? 0;
      total += 1;
      thresholds.forEach((t, index) => {
        if (body > t) counts[index] = (counts[index] ?? 0) + 1;
      });
    }
    for (let index = 0; index < thresholds.length; index += 1) {
      lines.push(
        `body > ${thresholds[index]}: ${(((counts[index] ?? 0) / total) * 100).toFixed(2)}% of the world`,
      );
    }

    // The map. ` ` is zero, and the ramp climbs to the deepest density.
    const cols = 96;
    const rows = 40;
    const ramp = ' .:-=+*#%@';
    lines.push('');
    lines.push('--- body ---');
    for (let gy = 0; gy < rows; gy += 1) {
      let line = '';
      for (let gx = 0; gx < cols; gx += 1) {
        const x = Math.min(density.width - 1, Math.floor(((gx + 0.5) / cols) * density.width));
        const y = Math.min(density.height - 1, Math.floor(((gy + 0.5) / rows) * density.height));
        const body = density.data[(y * density.width + x) * 4] ?? 0;
        line += ramp[Math.min(ramp.length - 1, Math.max(0, Math.round(body * (ramp.length - 1))))];
      }
      lines.push(line);
    }

    lines.push('');
    lines.push('--- scour ---');
    for (let gy = 0; gy < rows; gy += 1) {
      let line = '';
      for (let gx = 0; gx < cols; gx += 1) {
        const x = Math.min(density.width - 1, Math.floor(((gx + 0.5) / cols) * density.width));
        const y = Math.min(density.height - 1, Math.floor(((gy + 0.5) / rows) * density.height));
        const value = density.data[(y * density.width + x) * 4 + 1] ?? 0;
        line += ramp[Math.min(ramp.length - 1, Math.max(0, Math.round(value * (ramp.length - 1))))];
      }
      lines.push(line);
    }

    lines.push('');
    lines.push('--- settle ---');
    for (let gy = 0; gy < rows; gy += 1) {
      let line = '';
      for (let gx = 0; gx < cols; gx += 1) {
        const x = Math.min(density.width - 1, Math.floor(((gx + 0.5) / cols) * density.width));
        const y = Math.min(density.height - 1, Math.floor(((gy + 0.5) / rows) * density.height));
        const value = density.data[(y * density.width + x) * 4 + 2] ?? 0;
        line += ramp[Math.min(ramp.length - 1, Math.max(0, Math.round(value * (ramp.length - 1))))];
      }
      lines.push(line);
    }

    console.log(lines.join('\n'));
  });
});
