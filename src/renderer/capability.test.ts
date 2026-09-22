import { describe, expect, it } from 'vitest';

import {
  detectRendererCapabilities,
  probeHalfFloatRenderTarget,
  releaseWebGl2Context,
  resolveInkTargetFormat,
  type CapabilityProbe,
  type RendererCapabilityReport,
} from './capability';

/**
 * A hand-built WebGL2 context, because the question the probe asks cannot be
 * asked of jsdom or of a machine that happens to have a working GPU.
 *
 * These doubles are what makes the difference between "there is a WebGL2
 * context" and "that context can actually be rendered into at half float"
 * testable at all — the second is the one the ink field's blank frame was made
 * of, and it is invisible to any check that only looks for a context object.
 */
const GL = {
  TEXTURE_2D: 0x0de1,
  RGBA16F: 0x881a,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  LINEAR: 0x2601,
  CLAMP_TO_EDGE: 0x812f,
  FRAMEBUFFER: 0x8d40,
  COLOR_ATTACHMENT0: 0x8ce0,
  FRAMEBUFFER_COMPLETE: 0x8cd5,
  FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: 0x8cd7,
} as const;

type FakeGl = {
  context: WebGL2RenderingContext;
  deletedTextures: number;
  deletedFramebuffers: number;
  boundFramebuffer: number | null;
  allocatedFormat: number | null;
  attached: boolean;
};

let textureIds = 0;
let framebufferIds = 0;

function createFakeGl(options: {
  extensions?: readonly string[];
  status?: number;
  refuseTexture?: boolean;
} = {}): FakeGl {
  const extensions = new Set(options.extensions ?? []);
  const state: FakeGl = {
    context: null as unknown as WebGL2RenderingContext,
    deletedTextures: 0,
    deletedFramebuffers: 0,
    boundFramebuffer: null,
    allocatedFormat: null,
    attached: false,
  };

  const context = {
    ...GL,
    getExtension: (name: string) => (extensions.has(name) ? { name } : null),
    createTexture: () => (options.refuseTexture ? null : { kind: 'texture', id: ++textureIds }),
    createFramebuffer: () => ({ kind: 'framebuffer', id: ++framebufferIds }),
    bindTexture: () => undefined,
    texStorage2D: (...args: unknown[]) => {
      state.allocatedFormat = args[2] as number;
    },
    texParameteri: () => undefined,
    bindFramebuffer: (_target: number, framebuffer: unknown) => {
      state.boundFramebuffer = framebuffer === null ? null : 1;
    },
    framebufferTexture2D: () => {
      state.attached = true;
    },
    checkFramebufferStatus: () =>
      options.status ?? GL.FRAMEBUFFER_COMPLETE,
    deleteTexture: () => {
      state.deletedTextures += 1;
    },
    deleteFramebuffer: () => {
      state.deletedFramebuffers += 1;
    },
  };

  state.context = context as unknown as WebGL2RenderingContext;
  return state;
}

function createProbe(
  report: Partial<RendererCapabilityReport> & Pick<RendererCapabilityReport, 'webgpu' | 'webgl2'>,
  overrides: {
    halfFloat?: boolean;
    halfFloatThrows?: boolean;
    webGl2Throws?: boolean;
  } = {},
): CapabilityProbe {
  return {
    requestWebGpuAdapter: async () =>
      report.webgpu ? { name: report.adapterName ?? 'Test Adapter' } : null,
    createWebGl2Context: () => {
      if (overrides.webGl2Throws) throw new Error('context creation failed');
      return report.webgl2 ? ({} as WebGL2RenderingContext) : null;
    },
    probeHalfFloatRenderTarget: () => {
      if (overrides.halfFloatThrows) throw new Error('probe exploded');
      return overrides.halfFloat === false
        ? { ok: false, reason: 'no EXT_color_buffer_float' }
        : { ok: true };
    },
    releaseWebGl2Context: () => undefined,
  };
}

describe('probeHalfFloatRenderTarget', () => {
  it('refuses a context that advertises neither half-float renderable extension', () => {
    const { context } = createFakeGl();

    const verdict = probeHalfFloatRenderTarget(context);

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('EXT_color_buffer_float');
  });

  it('accepts a context whose RGBA16F framebuffer is complete', () => {
    const state = createFakeGl({ extensions: ['EXT_color_buffer_float'] });

    const verdict = probeHalfFloatRenderTarget(state.context);

    expect(verdict).toEqual({ ok: true });
    // The format really was asked for: a probe that allocated RGBA8 and then
    // reported success would pass while measuring nothing.
    expect(state.allocatedFormat).toBe(GL.RGBA16F);
    expect(state.attached).toBe(true);
  });

  it('accepts the half-float predecessor extension as well', () => {
    const state = createFakeGl({ extensions: ['EXT_color_buffer_half_float'] });

    expect(probeHalfFloatRenderTarget(state.context).ok).toBe(true);
  });

  it('refuses an extension that is advertised but cannot be rendered into', () => {
    // The failure this whole probe exists for. The extension is present, the
    // texture allocates, the attachment is made, and the driver still says the
    // framebuffer is not drawable — which draws nothing rather than throwing.
    const state = createFakeGl({
      extensions: ['EXT_color_buffer_float'],
      status: GL.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT,
    });

    const verdict = probeHalfFloatRenderTarget(state.context);

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('incomplete');
    expect(verdict.reason).toContain(GL.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT.toString(16));
  });

  it('deletes what it allocated, and unbinds, when the framebuffer is incomplete', () => {
    const state = createFakeGl({
      extensions: ['EXT_color_buffer_float'],
      status: GL.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT,
    });

    probeHalfFloatRenderTarget(state.context);

    expect(state.deletedTextures).toBe(1);
    expect(state.deletedFramebuffers).toBe(1);
    expect(state.boundFramebuffer).toBeNull();
  });

  it('allocates nothing at all when the extension is missing', () => {
    // The earlier return is the cheap path, and it has to stay cheap: this runs
    // once per load against a throwaway canvas, and an extension check that
    // allocated anyway would be asking a driver for a texture it has just said
    // it cannot render into.
    const state = createFakeGl();

    probeHalfFloatRenderTarget(state.context);

    expect(state.deletedTextures).toBe(0);
    expect(state.deletedFramebuffers).toBe(0);
    expect(state.attached).toBe(false);
  });

  it('reports a context that refuses to allocate as a verdict, not a crash', () => {
    const state = createFakeGl({
      extensions: ['EXT_color_buffer_float'],
      refuseTexture: true,
    });

    const verdict = probeHalfFloatRenderTarget(state.context);

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('refused');
  });

  it('survives a context that is not really a context', () => {
    // jsdom, a partial test double and a browser that handed back something
    // unexpected all land here. The verdict is what keeps the caller on the
    // RGBA8 path instead of taking the page down.
    const verdict = probeHalfFloatRenderTarget({} as WebGL2RenderingContext);

    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBeDefined();
  });
});

describe('detectRendererCapabilities', () => {
  it('prefers WebGPU when an adapter and WebGL2 are available', async () => {
    const report = await detectRendererCapabilities(createProbe({ webgpu: true, webgl2: true }));

    expect(report).toEqual({
      webgpu: true,
      webgl2: true,
      preferredBackend: 'webgpu',
      adapterName: 'Test Adapter',
      webgl2HalfFloatTarget: true,
    });
  });

  it('falls back to WebGL2 when WebGPU is unavailable', async () => {
    const report = await detectRendererCapabilities(createProbe({ webgpu: false, webgl2: true }));

    expect(report).toEqual({
      webgpu: false,
      webgl2: true,
      preferredBackend: 'webgl2',
      webgl2HalfFloatTarget: true,
    });
  });

  it('keeps WebGL2 available when the WebGPU probe throws', async () => {
    const report = await detectRendererCapabilities({
      ...createProbe({ webgpu: false, webgl2: true }),
      requestWebGpuAdapter: async () => {
        throw new Error('adapter request failed');
      },
    });

    expect(report).toEqual({
      webgpu: false,
      webgl2: true,
      preferredBackend: 'webgl2',
      webgl2HalfFloatTarget: true,
      reason: 'WebGPU probe failed: adapter request failed',
    });
  });

  it('reports an unavailable renderer when neither backend can be created', async () => {
    const report = await detectRendererCapabilities(createProbe({ webgpu: false, webgl2: false }));

    expect(report).toEqual({
      webgpu: false,
      webgl2: false,
      preferredBackend: 'unavailable',
      webgl2HalfFloatTarget: false,
      reason: 'WebGPU and WebGL2 are unavailable',
    });
  });

  it('records a refused half-float target without calling WebGL2 unavailable', async () => {
    const report = await detectRendererCapabilities(
      createProbe({ webgpu: false, webgl2: true }, { halfFloat: false }),
    );

    expect(report.webgl2).toBe(true);
    expect(report.webgl2HalfFloatTarget).toBe(false);
    expect(report.inkTargetReason).toBe('no EXT_color_buffer_float');
    // Not a downgrade of the backend: the fallback target is a different answer
    // to a different question, and reporting it as a backend failure would send
    // the runtime looking for a backend it already has.
    expect(report.preferredBackend).toBe('webgl2');
    expect(report.reason).toBeUndefined();
  });

  it('treats a probe that throws as a refused target rather than a dead backend', async () => {
    const report = await detectRendererCapabilities(
      createProbe({ webgpu: false, webgl2: true }, { halfFloatThrows: true }),
    );

    expect(report.webgl2).toBe(true);
    expect(report.webgl2HalfFloatTarget).toBe(false);
    expect(report.inkTargetReason).toBe('half-float target probe failed: probe exploded');
  });

  it('reports a context that could not be created at all', async () => {
    const report = await detectRendererCapabilities(
      createProbe({ webgpu: false, webgl2: false }, { webGl2Throws: true }),
    );

    expect(report).toMatchObject({
      webgl2: false,
      webgl2HalfFloatTarget: false,
      preferredBackend: 'unavailable',
      reason: 'WebGL2 probe failed: context creation failed',
    });
  });
});

describe('releasing the probe\u2019s context', () => {
  /**
   * The probe builds a throwaway canvas, asks it for WebGL2, and drops it. The
   * canvas becomes unreachable, but the *context* is not free: a live WebGL
   * context holds GPU memory and counts against the browser's per-page context
   * limit — the one that, when it is reached, takes the oldest context away, and
   * the oldest context in this app is the probe's while the one that matters is
   * the renderer's. Waiting for a garbage collection that may not come is not a
   * release, so the probe loses the context explicitly.
   */
  it('loses the context through WEBGL_lose_context', () => {
    const asked: string[] = [];
    let lost = false;
    const context = {
      getExtension: (name: string) => {
        asked.push(name);
        return name === 'WEBGL_lose_context'
          ? {
              loseContext: () => {
                lost = true;
              },
            }
          : null;
      },
    } as unknown as WebGL2RenderingContext;

    releaseWebGl2Context(context);

    expect(asked).toEqual(['WEBGL_lose_context']);
    expect(lost).toBe(true);
  });

  it('does nothing when the context does not offer the extension', () => {
    const context = {
      getExtension: () => null,
    } as unknown as WebGL2RenderingContext;

    expect(() => releaseWebGl2Context(context)).not.toThrow();
  });

  it('survives a context that refuses to be asked at all', () => {
    // jsdom, a partial double, or a context already lost by someone else.
    const context = {
      getExtension: () => {
        throw new Error('context is gone');
      },
    } as unknown as WebGL2RenderingContext;

    expect(() => releaseWebGl2Context(context)).not.toThrow();
    expect(() => releaseWebGl2Context({} as WebGL2RenderingContext)).not.toThrow();
  });

  it('releases once, after the half-float verdict, and changes nothing about it', async () => {
    // The order is the whole safety argument: releasing before the framebuffer
    // probe would make every context look like one that cannot render half
    // float, which would silently move WebGL2 onto the RGBA8 path everywhere.
    const order: string[] = [];
    const report = await detectRendererCapabilities({
      requestWebGpuAdapter: async () => null,
      createWebGl2Context: () => ({}) as WebGL2RenderingContext,
      probeHalfFloatRenderTarget: () => {
        order.push('probe');
        return { ok: true };
      },
      releaseWebGl2Context: () => {
        order.push('release');
      },
    });

    expect(order).toEqual(['probe', 'release']);
    expect(report).toEqual({
      webgpu: false,
      webgl2: true,
      preferredBackend: 'webgl2',
      webgl2HalfFloatTarget: true,
    });
  });

  it('releases a context whose half-float target was refused', async () => {
    let released = 0;
    const report = await detectRendererCapabilities({
      requestWebGpuAdapter: async () => null,
      createWebGl2Context: () => ({}) as WebGL2RenderingContext,
      probeHalfFloatRenderTarget: () => ({ ok: false, reason: 'no EXT_color_buffer_float' }),
      releaseWebGl2Context: () => {
        released += 1;
      },
    });

    expect(released).toBe(1);
    // Still a usable backend, still on the byte target: the release says nothing
    // about either.
    expect(report).toMatchObject({
      webgl2: true,
      webgl2HalfFloatTarget: false,
      preferredBackend: 'webgl2',
      inkTargetReason: 'no EXT_color_buffer_float',
    });
  });

  it('releases even when the half-float probe throws', async () => {
    let released = 0;
    const report = await detectRendererCapabilities({
      requestWebGpuAdapter: async () => null,
      createWebGl2Context: () => ({}) as WebGL2RenderingContext,
      probeHalfFloatRenderTarget: () => {
        throw new Error('probe exploded');
      },
      releaseWebGl2Context: () => {
        released += 1;
      },
    });

    expect(released).toBe(1);
    expect(report).toMatchObject({ webgl2: true, webgl2HalfFloatTarget: false });
  });

  it('does not release anything when no context was created', async () => {
    let released = 0;
    await detectRendererCapabilities({
      requestWebGpuAdapter: async () => null,
      createWebGl2Context: () => null,
      probeHalfFloatRenderTarget: () => ({ ok: true }),
      releaseWebGl2Context: () => {
        released += 1;
      },
    });

    expect(released).toBe(0);
  });

  it('keeps the verdict when the release itself misbehaves', async () => {
    const report = await detectRendererCapabilities({
      requestWebGpuAdapter: async () => null,
      createWebGl2Context: () => ({}) as WebGL2RenderingContext,
      probeHalfFloatRenderTarget: () => ({ ok: true }),
      releaseWebGl2Context: () => {
        throw new Error('loseContext blew up');
      },
    });

    expect(report).toMatchObject({
      webgl2: true,
      webgl2HalfFloatTarget: true,
      preferredBackend: 'webgl2',
    });
  });
});

describe('resolveInkTargetFormat', () => {
  const withHalfFloat = (webgl2HalfFloatTarget: boolean): RendererCapabilityReport => ({
    webgpu: false,
    webgl2: true,
    preferredBackend: 'webgl2',
    webgl2HalfFloatTarget,
  });

  it('gives WebGPU the half-float target without asking', () => {
    // Renderable half-float storage is part of the WebGPU spec, not an
    // extension, and the capability report is about what WebGL2 can do.
    expect(resolveInkTargetFormat('webgpu', withHalfFloat(false))).toBe('rgba16f');
  });

  it('gives WebGL2 half float only when the context proved it', () => {
    expect(resolveInkTargetFormat('webgl2', withHalfFloat(true))).toBe('rgba16f');
    expect(resolveInkTargetFormat('webgl2', withHalfFloat(false))).toBe('rgba8');
  });

  it('never answers half float for a backend that is not running', () => {
    expect(
      resolveInkTargetFormat('unavailable', {
        webgpu: false,
        webgl2: false,
        preferredBackend: 'unavailable',
        webgl2HalfFloatTarget: false,
      }),
    ).toBe('rgba8');
  });
});
