import { describe, expect, it, vi } from 'vitest';
import { HalfFloatType, RenderTarget, UnsignedByteType } from 'three';

import { createInkField, planInkSettlement, type InkFieldRenderer } from './inkField';
import type { InkDensity } from './inkDensity';

/**
 * The field's schedule, without a GPU.
 *
 * Everything these assertions are about is *timing and allocation* rather than
 * pixels — how many passes a load costs, what the first presented frame is made
 * of, and which format the targets were asked for. All three are invisible in a
 * capture, which is exactly why they need a test: a settlement that silently did
 * not run looks like a slightly different picture, and a target allocated at the
 * wrong type looks like a picture that is merely a bit coarse.
 */

function createDensity(): InkDensity {
  const width = 8;
  const height = 8;
  return {
    data: new Float32Array(width * height * 4),
    fluvial: new Float32Array(width * height * 4),
    width,
    height,
    extent: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    channels: { body: 0, scour: 1, settle: 2, along: 3 },
    fluvialChannels: { tangentX: 0, tangentZ: 1, speed: 2, seed: 3 },
  };
}

type FakeRenderer = {
  renderer: InkFieldRenderer;
  renders: number;
  targets: unknown[];
};

function createFakeRenderer(): FakeRenderer {
  const state: FakeRenderer = {
    renderer: {
      setRenderTarget: (target: unknown) => {
        state.targets.push(target);
      },
      render: () => {
        state.renders += 1;
      },
    },
    renders: 0,
    targets: [],
  };
  return state;
}

function createField(options: { targetFormat?: 'rgba16f' | 'rgba8' } = {}) {
  return createInkField({
    density: createDensity(),
    quality: {
      simulationResolution: 8,
      diffusionScale: 1,
      carryErosion: true,
    },
    brushRadius: 12,
    ...options,
  });
}

describe('planInkSettlement', () => {
  it('uses a step size the integrator will actually accept', () => {
    // The shader clamps its own delta to this window. A settlement plan that
    // stepped outside it would be silently clamped, and the "8 simulated
    // seconds" it reports would be a number about a schedule nobody ran.
    const plan = planInkSettlement();

    expect(plan.stepSeconds).toBeGreaterThanOrEqual(1 / 240);
    expect(plan.stepSeconds).toBeLessThanOrEqual(1 / 20);
  });

  it('reports the time it claims to have simulated', () => {
    const plan = planInkSettlement();

    expect(plan.steps).toBeGreaterThan(1);
    expect(plan.seconds).toBeCloseTo(plan.steps * plan.stepSeconds, 10);
    // Long enough to be past the body channel's own decay time constant several
    // times over, which is what makes the seed's contribution disappear rather
    // than merely shrink.
    expect(plan.seconds).toBeGreaterThan(6);
  });

  it('bounds what a load pays for it', () => {
    // Two fullscreen passes per step — the advection and the copy that keeps the
    // shader graph pointing at one fixed target — plus the seed. This is the
    // budget the settlement is allowed to spend once per page load, and it is
    // asserted rather than described because raising it is a one-character edit.
    const plan = planInkSettlement();

    expect(2 * plan.steps + 1).toBeLessThanOrEqual(400);
  });
});

describe('createInkField', () => {
  it('seeds and settles before the first frame it can be asked for', () => {
    const field = createField();
    const fake = createFakeRenderer();
    const plan = planInkSettlement();

    field.step(fake.renderer, 0, 0, 0);

    // One seed pass, then two passes per settlement step. Asserted exactly,
    // because "it settled" and "it seeded and then did nothing" differ by three
    // hundred draw calls and by whether the frame is a texture or a river.
    expect(fake.renders).toBe(1 + 2 * plan.steps);
    // And leaves the default framebuffer bound, so whatever draws next draws to
    // the screen rather than into the simulation's read target.
    expect(fake.targets[fake.targets.length - 1]).toBeNull();

    field.dispose();
  });

  it('settles once, however many held frames follow', () => {
    const field = createField();
    const first = createFakeRenderer();
    field.step(first.renderer, 0, 0, 0);
    const afterSettling = first.renders;

    // Three more frames of the state reduced motion actually passes: no ambient
    // time, a live interaction clock, nothing pressed.
    for (let index = 0; index < 3; index += 1) {
      field.step(first.renderer, 0, 0, 1 / 60);
    }

    // Two passes each — the advection and the copy, which is what keeps the drag
    // response alive under the preference — and no second settlement.
    expect(first.renders).toBe(afterSettling + 3 * 2);

    field.dispose();
  });

  it('does no work at all for a frame that advances nothing', () => {
    const field = createField();
    const fake = createFakeRenderer();
    field.step(fake.renderer, 0, 0, 0);
    const afterSettling = fake.renders;

    field.step(fake.renderer, 0, 0, 0);
    field.step(fake.renderer, 0, 0, 0);

    expect(fake.renders).toBe(afterSettling);

    field.dispose();
  });

  it('still runs the simulation for an interaction-only frame', () => {
    // The direct-manipulation path: a zero ambient delta is the preference, and
    // a non-zero interaction delta is the visitor. Collapsing the two would take
    // the drag away, which is the one thing reduced motion must keep.
    const field = createField();
    const fake = createFakeRenderer();
    field.step(fake.renderer, 0, 0, 0);
    const afterSettling = fake.renders;

    field.step(fake.renderer, 0, 0, 1 / 60);

    expect(fake.renders).toBe(afterSettling + 2);

    field.dispose();
  });

  it('defaults the targets to half float and reports what it used', () => {
    const field = createField();

    expect(field.targetFormat).toBe('rgba16f');
    expect(field.sampleTexture.type).toBe(HalfFloatType);

    field.dispose();
  });

  it('allocates byte targets when the context could not give half float', () => {
    // Not merely a flag: the texture the simulation actually reads has to carry
    // the type, or the fallback would report a format it never allocated.
    const field = createField({ targetFormat: 'rgba8' });

    expect(field.targetFormat).toBe('rgba8');
    expect(field.sampleTexture.type).toBe(UnsignedByteType);

    field.dispose();
  });

  it('disposes both simulation targets and both authored textures', () => {
    // The field owns five things that hold GPU memory: two render targets, two
    // data textures and one quad geometry. `RenderTarget.dispose` is three's own
    // explicit release for a render target — it is what the renderer's texture
    // manager listens to — so counting it is the honest assertion that both
    // targets were released rather than the read one and a leak.
    const field = createField();
    const baseTexture = vi.spyOn(field.baseTexture, 'dispose');
    const fluvialTexture = vi.spyOn(field.fluvialTexture, 'dispose');
    const renderTarget = vi.spyOn(RenderTarget.prototype, 'dispose');

    field.dispose();

    expect(baseTexture).toHaveBeenCalledTimes(1);
    expect(fluvialTexture).toHaveBeenCalledTimes(1);
    // Read and write, and no third one.
    expect(renderTarget).toHaveBeenCalledTimes(2);

    renderTarget.mockRestore();
  });
});
