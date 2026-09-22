import type { RendererBackend } from './types';

export type WebGpuAdapterDetails = {
  readonly name?: string;
};

/**
 * Whether a context can be rendered into at a given format.
 *
 * A verdict with a reason rather than a boolean, because the failure it
 * describes is the kind that otherwise shows up as an empty frame: a
 * framebuffer that is incomplete does not throw, it silently draws nothing.
 */
export type TargetProbe = {
  readonly ok: boolean;
  readonly reason?: string;
};

export type CapabilityProbe = {
  requestWebGpuAdapter: () => Promise<WebGpuAdapterDetails | null>;
  createWebGl2Context: () => WebGL2RenderingContext | null;
  /**
   * Whether an `RGBA16F` render target is actually renderable on this context.
   *
   * Not the same question as "is there a WebGL2 context", and the difference is
   * the whole reason the ink field can be blank on a machine that reports
   * WebGL2: the field lives in a half-float render target, and WebGL2 makes that
   * renderable only through `EXT_color_buffer_float` (or its half-float
   * predecessor). A context that exists without either will accept the texture
   * and refuse the framebuffer.
   */
  probeHalfFloatRenderTarget: (context: WebGL2RenderingContext) => TargetProbe;
  /**
   * Gives back the context `createWebGl2Context` built, once its verdict is in.
   *
   * Separate from `createWebGl2Context` because the probe context has to survive
   * the framebuffer question, and a paired release is the only way to express
   * "the caller is done with it". A browser probe creates a hidden canvas and a
   * real context on it; see `releaseWebGl2Context` for why dropping the canvas is
   * not the same as releasing the context.
   */
  releaseWebGl2Context: (context: WebGL2RenderingContext) => void;
};

/**
 * The format the ink field's simulation targets are allocated in.
 *
 * Named here rather than in the field, because which one is available is a
 * property of the *context*, which is what this module is about; the field only
 * chooses what to allocate.
 */
export type InkTargetFormat = 'rgba16f' | 'rgba8';

export type RendererCapabilityReport = {
  readonly webgpu: boolean;
  readonly webgl2: boolean;
  readonly preferredBackend: RendererBackend;
  readonly adapterName?: string;
  readonly reason?: string;
  /**
   * Whether a WebGL2 context here can carry the ink field's half-float target.
   *
   * Always `false` when there is no WebGL2 context at all, so a consumer can
   * read this without first checking `webgl2`.
   */
  readonly webgl2HalfFloatTarget: boolean;
  /** Why the half-float target was refused, when it was. */
  readonly inkTargetReason?: string;
};

type NavigatorWithGpu = Navigator & {
  gpu?: {
    requestAdapter: (options?: {
      powerPreference?: 'low-power' | 'high-performance';
    }) => Promise<{
      info?: {
        device?: string;
        description?: string;
        vendor?: string;
      };
    } | null>;
  };
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/** Small, because the question is answerability and not bandwidth. */
const PROBE_SIZE = 4;

/**
 * Asks the context to answer the question the ink field depends on.
 *
 * The sequence is the one the field's own allocation performs — texture, storage
 * allocation at `RGBA16F`, framebuffer, colour attachment — because the ways
 * that can fail are not all extension flags. A driver can advertise
 * `EXT_color_buffer_float`, allocate the texture, and still answer
 * `FRAMEBUFFER_INCOMPLETE_ATTACHMENT`; only `checkFramebufferStatus` says so.
 *
 * Nothing is left bound and both objects are deleted before returning, in the
 * success path and in every failure path. The probe runs against a throwaway
 * canvas — the browser probe below creates one for the purpose — but a leaked
 * texture is still a leak, and a probe that leaves `FRAMEBUFFER` bound to its
 * own framebuffer would corrupt whatever the real renderer does next if it were
 * ever pointed at a live context.
 */
export function probeHalfFloatRenderTarget(
  context: WebGL2RenderingContext,
): TargetProbe {
  try {
    const extension =
      context.getExtension('EXT_color_buffer_float') ??
      context.getExtension('EXT_color_buffer_half_float');

    if (extension === null || extension === undefined) {
      return {
        ok: false,
        reason:
          'EXT_color_buffer_float and EXT_color_buffer_half_float are both missing',
      };
    }
  } catch (error) {
    return {
      ok: false,
      reason: `half-float extension probe failed: ${getErrorMessage(error)}`,
    };
  }

  let texture: WebGLTexture | null = null;
  let framebuffer: WebGLFramebuffer | null = null;

  try {
    texture = context.createTexture();
    framebuffer = context.createFramebuffer();

    if (texture === null || framebuffer === null) {
      return {
        ok: false,
        reason: 'the context refused a probe texture or framebuffer',
      };
    }

    context.bindTexture(context.TEXTURE_2D, texture);
    context.texStorage2D(
      context.TEXTURE_2D,
      1,
      context.RGBA16F,
      PROBE_SIZE,
      PROBE_SIZE,
    );
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);

    context.bindFramebuffer(context.FRAMEBUFFER, framebuffer);
    context.framebufferTexture2D(
      context.FRAMEBUFFER,
      context.COLOR_ATTACHMENT0,
      context.TEXTURE_2D,
      texture,
      0,
    );

    const status = context.checkFramebufferStatus(context.FRAMEBUFFER);

    if (status !== context.FRAMEBUFFER_COMPLETE) {
      return {
        ok: false,
        reason: `an RGBA16F framebuffer is incomplete (0x${status.toString(16)})`,
      };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `half-float target probe failed: ${getErrorMessage(error)}`,
    };
  } finally {
    try {
      context.bindFramebuffer(context.FRAMEBUFFER, null);
      context.bindTexture(context.TEXTURE_2D, null);
      if (framebuffer !== null) context.deleteFramebuffer(framebuffer);
      if (texture !== null) context.deleteTexture(texture);
    } catch {
      // The verdict above is already the answer. A context that refuses to
      // unbind is a context nothing further can be reported about.
    }
  }
}

/**
 * The format the ink field may allocate, given the backend that will run it.
 *
 * WebGPU answers `rgba16f` without a probe: renderable half-float storage is
 * part of the spec rather than an extension, and a device that could not write
 * to it could not run the surface shaders either.
 *
 * Anything that is not a live backend gets `rgba8` — the safer of the two, and
 * the one that cannot itself be the reason a frame failed.
 */
export function resolveInkTargetFormat(
  backend: RendererBackend,
  report: RendererCapabilityReport,
): InkTargetFormat {
  if (backend === 'webgpu') return 'rgba16f';
  if (backend === 'webgl2' && report.webgl2HalfFloatTarget) return 'rgba16f';
  return 'rgba8';
}

export async function detectRendererCapabilities(
  probe: CapabilityProbe,
): Promise<RendererCapabilityReport> {
  let webGpuAdapter: WebGpuAdapterDetails | null = null;
  let webGpuFailure: string | undefined;

  try {
    webGpuAdapter = await probe.requestWebGpuAdapter();
  } catch (error) {
    webGpuFailure = `WebGPU probe failed: ${getErrorMessage(error)}`;
  }

  let webgl2 = false;
  let webGl2Failure: string | undefined;
  let halfFloat: TargetProbe = {
    ok: false,
    reason: 'no WebGL2 context to probe',
  };

  try {
    const context = probe.createWebGl2Context();
    webgl2 = context !== null;

    if (context !== null) {
      // Nested, so that a probe which throws is reported as "no half-float
      // target" rather than as "no WebGL2" — the two lead to different
      // fallbacks, and collapsing them would silently skip the RGBA8 path on
      // exactly the machines it exists for.
      try {
        halfFloat = probe.probeHalfFloatRenderTarget(context);
      } catch (error) {
        halfFloat = {
          ok: false,
          reason: `half-float target probe failed: ${getErrorMessage(error)}`,
        };
      } finally {
        /*
         * Handed back in a `finally`, and after every question has been asked of
         * it. Order is the safety argument here rather than a detail: releasing a
         * context before the framebuffer probe would make every machine look like
         * one that cannot render half float, and WebGL2 would quietly move to the
         * byte target everywhere. `finally` covers the throwing path, which is
         * the one that would otherwise leak the most.
         *
         * A release that throws is swallowed rather than escalated: the verdict
         * is already decided by this point, and a context that will not let go is
         * not a reason to lose it.
         */
        try {
          probe.releaseWebGl2Context(context);
        } catch {
          // See above.
        }
      }
    }
  } catch (error) {
    webGl2Failure = `WebGL2 probe failed: ${getErrorMessage(error)}`;
  }

  const webgpu = webGpuAdapter !== null;
  const preferredBackend: RendererBackend = webgpu
    ? 'webgpu'
    : webgl2
      ? 'webgl2'
      : 'unavailable';
  const report: RendererCapabilityReport = {
    webgpu,
    webgl2,
    preferredBackend,
    webgl2HalfFloatTarget: webgl2 && halfFloat.ok,
  };

  const withInkTarget = (
    base: RendererCapabilityReport,
  ): RendererCapabilityReport =>
    webgl2 && !halfFloat.ok && halfFloat.reason !== undefined
      ? { ...base, inkTargetReason: halfFloat.reason }
      : base;

  if (webGpuAdapter?.name) {
    return withInkTarget({ ...report, adapterName: webGpuAdapter.name });
  }

  if (!webgpu && webGpuFailure) {
    return withInkTarget({ ...report, reason: webGpuFailure });
  }

  if (!webgpu && !webgl2 && webGl2Failure) {
    return withInkTarget({ ...report, reason: webGl2Failure });
  }

  if (!webgpu && !webgl2) {
    return withInkTarget({ ...report, reason: 'WebGPU and WebGL2 are unavailable' });
  }

  return withInkTarget(report);
}

/**
 * Hands the probe's context back to the browser.
 *
 * A `HTMLCanvasElement` that is dropped is *collectable*, and the WebGL context
 * sitting on it is released when that collection happens — which is not a time
 * anybody can name, and not a guarantee at all while anything still references
 * the context object. `WEBGL_lose_context.loseContext()` releases the context's
 * resources there and then.
 *
 * It matters because contexts are a counted resource: a page gets a bounded
 * number of them, and when the limit is reached the browser takes the oldest one
 * away. This probe runs once per runtime start — and `RendererHost`'s effect
 * cleanup runs on every unmount and, in development, on every double-invoked
 * mount — so the contexts that accumulate are the probe's, while the one that
 * would be evicted first is exactly the renderer's. The probe does not need to
 * be the reason a working scene loses its context.
 *
 * Best effort by construction: the extension is optional in WebGL2, a context
 * may already be lost, and a context that refuses to be asked is not an error
 * worth failing a capability report over.
 */
export function releaseWebGl2Context(context: WebGL2RenderingContext): void {
  try {
    const extension = context.getExtension('WEBGL_lose_context') as {
      loseContext?: () => void;
    } | null;
    extension?.loseContext?.();
  } catch {
    // Optional extension, possibly-lost context, partial double: all the same
    // answer, which is that there is nothing more to do here.
  }
}

export function createBrowserCapabilityProbe(): CapabilityProbe {
  return {
    requestWebGpuAdapter: async () => {
      if (typeof navigator === 'undefined') {
        return null;
      }

      const navigatorWithGpu = navigator as NavigatorWithGpu;
      if (!navigatorWithGpu.gpu) {
        return null;
      }

      const adapter = await navigatorWithGpu.gpu.requestAdapter({
        powerPreference: 'high-performance',
      });

      if (!adapter) {
        return null;
      }

      const adapterInfo = adapter.info;
      const adapterName = [
        adapterInfo?.device,
        adapterInfo?.description,
        adapterInfo?.vendor,
      ].find((value): value is string => Boolean(value));

      return adapterName ? { name: adapterName } : {};
    },
    createWebGl2Context: () => {
      if (typeof document === 'undefined') {
        return null;
      }

      const canvas = document.createElement('canvas');
      return canvas.getContext('webgl2');
    },
    probeHalfFloatRenderTarget,
    releaseWebGl2Context,
  };
}
