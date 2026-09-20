#!/usr/bin/env node
/**
 * Stage 3.5.6 screenshot-and-evidence harness — zero npm dependencies.
 *
 * Drives an already-installed Chrome/Edge over the Chrome DevTools Protocol
 * using Node's built-in global `WebSocket` and `fetch`. Nothing is installed,
 * imported from `node_modules`, or written to `package.json`. The temporary
 * browser profile is created under the OS temp directory and removed again on
 * success, failure and Ctrl-C, so the repository never accumulates local junk.
 *
 * The page under test is a full-screen canvas. That single fact is what shapes
 * this harness: there is no DOM to assert on, so every claim it makes has to be
 * paid for either by reading state back out of the page or by measuring the
 * pixels it just captured.
 *
 * What it does
 *   1. Launches the browser headless (new headless mode) with a temp profile
 *      and GPU-flavoured flags for both the WebGPU backend and the WebGL2
 *      fallback.
 *   2. Reads the DevTools endpoint and attaches to a page target (flatten mode).
 *   3. Navigates to `/?boot=skip&telemetry=1` and waits for the scene to be
 *      *actually* ready: a DOM readiness probe plus successive screenshot frames
 *      that are stable and non-uniform in luminance. A near-black frame is never
 *      accepted, however long the run waits.
 *   4. Captures explicit viewport sizes through `Emulation.setDeviceMetricsOverride`.
 *   5. Produces a ~480x270 downscale with CDP `clip.scale`, so the real frame is
 *      downscaled rather than re-rendered.
 *   6. Supports a reduced-motion pass via `Emulation.setEmulatedMedia`
 *      (`prefers-reduced-motion: reduce`) applied before navigation.
 *   7. Collects `Runtime.consoleAPICalled`, `Runtime.exceptionThrown` and
 *      `Log.entryAdded`, and exits non-zero on uncaught exceptions, `NaN`,
 *      invalid/negative buffer sizes and WebGPU validation errors while
 *      allowlisting the benign notices this project is known to produce.
 *
 * The three evidence families
 *
 *   Static    One `idle` hero frame per size, plus a `clip.scale` thumbnail of
 *             that same frame. This is the frame every other family is compared
 *             against, so it is captured first and with the pointer parked.
 *
 *   Scroll    One frame per `--scroll-steps` value. The scroll is a REAL page
 *             scroll: `window.scrollTo(0, progress * (scrollHeight - innerHeight))`
 *             evaluated in the page. The achieved progress is then read back
 *             out of the page and printed next to the requested one, because a
 *             scroll harness that assumes its own scroll landed is a harness
 *             that will happily ship five identical frames and call them a
 *             story. (At the time of writing this app still has no scrollable
 *             height at all — `body { overflow: hidden }` — so the honest
 *             answer for every step is 0.00%, and that is what gets printed.)
 *
 *   Drag      Three frames per size that have to prove a pointer drag changed
 *             the picture: before (pointer parked away), during (button held
 *             down, captured after a path of `mouseMoved` events with
 *             `buttons: 1`), after (button released, pointer parked again).
 *             Plus a mask: the absolute per-pixel luminance difference between
 *             before and during, decoded and re-encoded in this process with
 *             `node:zlib` and the five PNG row filters. No image library. The
 *             run then prints the percentage of pixels that changed and the
 *             mean delta inside that region, and fails with `drag-not-visible`
 *             when the changed area is below 0.3% — a drag frame that shows
 *             nothing is worse than no frame.
 *
 * Exit codes
 *   0  all captures written and no fatal console output
 *   1  capture/readiness/interaction/drag-visibility failure, or fatal console output
 *   2  usage error (unknown flag, unparsable value, empty matrix)
 *   3  the app under test could not be reached or navigated to
 *
 * Examples
 *   # The default matrix for one backend
 *   node scripts/stage356-capture.mjs --backend webgpu --quality ultra
 *
 *   # WebGL2 fallback, reduced motion, thumbs, drag evidence
 *   node scripts/stage356-capture.mjs --backend webgl2 --reduced-motion --drag
 *
 *   # Validate the resolved matrix without launching a browser
 *   node scripts/stage356-capture.mjs --dry-run --scroll-steps 0,50,100 --reverse --drag
 *
 * Run `node scripts/stage356-capture.mjs --help` for the full flag list.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_OUT_DIR = 'artifacts/stage356';
const DEFAULT_BACKEND = 'webgpu';
const DEFAULT_QUALITY = 'ultra';
const DEFAULT_SIZES = '1920x1080,2560x1440';
const DEFAULT_SCROLL_STEPS = '0,25,50,75,100';
const DEFAULT_THUMB = '480x270';
const DEFAULT_NAME_PREFIX = 'stage356';
const DEFAULT_PARK = '50%,94%';
const DEFAULT_DRAG_STEPS = 12;
const DEFAULT_SETTLE_MS = 350;
const DEFAULT_READY_TIMEOUT_MS = 60_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_STABLE_FRAMES = 3;
const DEFAULT_STABILITY_THRESHOLD = 4;
const DEFAULT_MIN_SPREAD = 10;
const DEFAULT_MIN_LIT_FRACTION = 0.01;
const DEFAULT_MIN_MEAN = 4;
const DEFAULT_GRID = 16;
const DEFAULT_CHANGED_THRESHOLD = 8;
const DEFAULT_CHANGED_MIN_PERCENT = 0.3;
const DEFAULT_SCROLL_TOLERANCE = 0.02;

/**
 * How long a single frame is allowed to keep moving before the capture is
 * declared unstable.
 *
 * Readiness gets the full `--ready-timeout-ms`, because the first paint of a
 * WebGPU scene legitimately takes a while and a harness that gives up early
 * just re-runs. Per-frame stability is a different question: the scene has
 * already been proven startable by then, so a frame still moving after twelve
 * seconds is a finding, not a slow machine. The cap is what keeps a 25-frame
 * matrix from turning a single stuck frame into a 25-minute run.
 */
const DEFAULT_STABILITY_TIMEOUT_MS = 12_000;

/**
 * Readiness expression: what the page says about itself.
 *
 * Two things have to be true. A canvas has to exist and be laid out — a canvas
 * with no box is a canvas the renderer cannot size, and every frame taken from
 * it is a smaller picture in the corner of a bigger file. And the status line
 * has to have left its start-up states: `Starting — Ultra` is what the app
 * shows while the coordinator is still bringing adapters up, and
 * `Graphics unavailable` is what it shows when the backend probe failed
 * outright. Either one means "not ready", however pretty the frame looks.
 *
 * The quality tier is read out of the same line. The status copy is
 * `WebGPU — Ultra` / `WebGL2 fallback — Ultra` (see `statusCopy.ts`), so the
 * tier is whatever follows the em dash. An earlier harness probed a
 * `·`-separated format that this app no longer emits and silently reported
 * `quality: null` forever; the separator is matched loosely here so a copy
 * change does not quietly disable the check.
 */
const READY_EXPRESSION = `(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return { ready: false, reason: 'no-canvas' };
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    return { ready: false, reason: 'canvas-not-laid-out' };
  }
  const labelNode = document.querySelector('.renderer-status__label');
  const label = labelNode ? labelNode.textContent.trim() : null;
  if (label && /STARTING|INITIALIZING|UNAVAILABLE|DEGRADED/i.test(label)) {
    return { ready: false, reason: 'status:' + label, label };
  }
  const statusText = (document.querySelector('.renderer-status') || {}).textContent || '';
  const collapsed = statusText.replace(/\\s+/g, ' ').trim();
  const qualityMatch = collapsed.match(/[—·]\\s*([A-Za-z]+)/);
  const backend = /WEBGL2/i.test(collapsed)
    ? 'webgl2'
    : /WEBGPU/i.test(collapsed)
      ? 'webgpu'
      : null;
  return {
    ready: true,
    reason: label ? 'status:' + label : 'canvas-present',
    label,
    backend,
    quality: qualityMatch ? qualityMatch[1] : null,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    drawingWidth: canvas.width,
    drawingHeight: canvas.height,
  };
})()`;

/**
 * The scroll read-back, shared by the setter and the reader.
 *
 * `progress` is deliberately re-derived from `window.scrollY` rather than
 * echoed back from the value that was asked for. Echoing is how a scroll
 * harness proves nothing: the setter's argument is a number this process
 * already knows, so plumbing it into the report would print the request twice
 * and call the second one a measurement. Clamping and dividing the same way in
 * both places is what makes the two numbers comparable.
 *
 * `maxScroll === 0` is a real answer, not an error. A page with no scrollable
 * height has exactly one scroll position, and reporting `0.00%` for a request
 * of `50%` is the truth about that page.
 */
const SCROLL_STATE_BODY = `
    const doc = document.documentElement;
    const body = document.body;
    const bodyHeight = body ? body.scrollHeight : 0;
    const scrollHeight = Math.max(doc.scrollHeight, bodyHeight);
    const viewport = window.innerHeight;
    const maxScroll = Math.max(0, scrollHeight - viewport);
    const y = window.scrollY;
    const progress = maxScroll > 0 ? Math.min(1, Math.max(0, y / maxScroll)) : 0;
    return {
      y,
      maxScroll,
      scrollHeight,
      viewport,
      progress,
      documentScrollTop: doc.scrollTop,
      bodyScrollTop: body ? body.scrollTop : null,
      scrollBehavior: doc.style.scrollBehavior || null,
    };
`;


/**
 * The capture-only stylesheet used by `--text-hidden`.
 *
 * A frame is only worth judging as an image if the image is the only thing in
 * it, so this hides the three DOM layers that carry type: the masthead, the
 * renderer status caption and the boot overlay. With `?boot=skip` the boot
 * overlay is already at `opacity: 0`, but it is listed anyway — it is a
 * full-screen absolutely-positioned element, and "invisible because the phase
 * happens to be complete" is one state change away from "covering the frame".
 *
 * The vignette is deliberately NOT hidden. It is a DOM overlay too, but it is a
 * gradient rather than a text layer: it is part of the composition a visitor
 * actually sees, and removing it would produce a frame nobody ever looks at.
 * The flag is called `--text-hidden` and it hides text.
 */
const CAPTURE_MODE_STYLE_ID = 'stage356-capture-modes';

const CAPTURE_MODE_CSS = [
  'html.stage356-text-hidden .system-masthead,',
  'html.stage356-text-hidden .renderer-status,',
  'html.stage356-text-hidden .boot-experience { display: none !important; }',
].join('\n');

const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_CONNECTION = 3;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 4: 2, 6: 4 };

const BOOLEAN_FLAGS = new Set([
  'help',
  'dry-run',
  'verbose',
  'reduced-motion',
  'text-hidden',
  'reverse',
  'drag',
  'keep-profile',
  'lenient',
]);

const REPEATABLE_FLAGS = new Set(['chrome-arg', 'allow-console-error']);

const VALUE_FLAGS = new Set([
  'base-url',
  'out',
  'backend',
  'quality',
  'sizes',
  'name-prefix',
  'thumb',
  'scroll-steps',
  'settle-ms',
  'ready-timeout-ms',
  'stability-timeout-ms',
  'browser',
  'port',
  'park',
  'drag-steps',
  'changed-threshold',
  'changed-min',
  'stable-frames',
  'stability-threshold',
  'min-spread',
  'min-lit',
  'min-mean',
  'command-timeout',
]);

export class UsageError extends Error {}
export class ConnectionError extends Error {}

/**
 * Raised when the scene never became ready.
 *
 * Caught inside the run rather than at the top level so the browser is still
 * torn down, the temp profile is still removed, and the console summary line
 * is still printed. A readiness failure has to stay reportable — that is the
 * whole reason the readiness contract exists.
 */
class ReadinessAbort extends Error {}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseInteger(value, { name, min, max, fallback }) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new UsageError(`--${name} expects an integer, received "${value}"`);
  }
  if (min !== undefined && parsed < min) {
    throw new UsageError(`--${name} must be >= ${min}, received ${parsed}`);
  }
  if (max !== undefined && parsed > max) {
    throw new UsageError(`--${name} must be <= ${max}, received ${parsed}`);
  }
  return parsed;
}

function parseNumber(value, { name, min, max, fallback }) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new UsageError(`--${name} expects a finite number, received "${value}"`);
  }
  if (min !== undefined && parsed < min) {
    throw new UsageError(`--${name} must be >= ${min}, received ${parsed}`);
  }
  if (max !== undefined && parsed > max) {
    throw new UsageError(`--${name} must be <= ${max}, received ${parsed}`);
  }
  return parsed;
}

function sanitizeSegment(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/** `0 -> "00"`, `25 -> "25"`, `100 -> "100"`: sorts correctly as text. */
function padScrollStep(step) {
  return String(step).padStart(2, '0');
}

function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const raw = {};
  const repeatable = { 'chrome-arg': [], 'allow-console-error': [] };
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '-h' || token === '--help') {
      help = true;
      continue;
    }

    if (!token.startsWith('--')) {
      throw new UsageError(`Unexpected argument "${token}"; every option starts with --`);
    }

    const equalsAt = token.indexOf('=');
    const name = equalsAt === -1 ? token.slice(2) : token.slice(2, equalsAt);
    const inlineValue = equalsAt === -1 ? undefined : token.slice(equalsAt + 1);

    if (BOOLEAN_FLAGS.has(name)) {
      if (inlineValue !== undefined) {
        throw new UsageError(`--${name} is a boolean flag and takes no value`);
      }
      raw[name] = true;
      continue;
    }

    if (REPEATABLE_FLAGS.has(name)) {
      const value = inlineValue ?? argv[++index];
      if (value === undefined) {
        throw new UsageError(`--${name} needs a value`);
      }
      repeatable[name].push(value);
      continue;
    }

    if (!VALUE_FLAGS.has(name)) {
      throw new UsageError(`Unknown flag "--${name}". Run with --help to list the options.`);
    }

    const value = inlineValue ?? argv[++index];
    if (value === undefined) {
      throw new UsageError(`--${name} needs a value`);
    }
    raw[name] = value;
  }

  if (help) {
    return { help: true };
  }

  const backend = raw.backend ?? DEFAULT_BACKEND;
  if (!['webgpu', 'webgl2'].includes(backend)) {
    throw new UsageError(`--backend must be webgpu or webgl2 (received "${backend}")`);
  }

  const quality = raw.quality ?? DEFAULT_QUALITY;
  if (!['ultra', 'high', 'medium', 'safe'].includes(quality)) {
    throw new UsageError(
      `--quality must be ultra, high, medium or safe (received "${quality}")`,
    );
  }

  const thumb = raw.thumb ?? DEFAULT_THUMB;
  if (thumb !== 'none' && !/^\d+x\d+$/.test(thumb)) {
    throw new UsageError(`--thumb expects <WxH> or "none" (received "${thumb}")`);
  }

  const baseUrl = trimTrailingSlash(raw['base-url'] ?? DEFAULT_BASE_URL);
  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new UsageError(`--base-url is not a valid URL: "${baseUrl}"`);
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new UsageError(`--base-url must be http(s), received "${baseUrl}"`);
  }

  const readyTimeoutMs = parseInteger(raw['ready-timeout-ms'], {
    name: 'ready-timeout-ms',
    min: 1000,
    fallback: DEFAULT_READY_TIMEOUT_MS,
  });

  return {
    help: false,
    options: {
      baseUrl,
      outDir: path.resolve(PROJECT_ROOT, raw.out ?? DEFAULT_OUT_DIR),
      outDirLabel: raw.out ?? DEFAULT_OUT_DIR,
      backend,
      quality,
      sizes: parseSizeList(raw.sizes ?? DEFAULT_SIZES),
      namePrefix: raw['name-prefix'] ?? DEFAULT_NAME_PREFIX,
      thumb: thumb === 'none' ? null : parseSize(thumb, '--thumb'),
      scrollSteps: parseScrollSteps(raw['scroll-steps'] ?? DEFAULT_SCROLL_STEPS),
      reverse: raw.reverse === true,
      drag: raw.drag === true,
      park: raw.park ?? DEFAULT_PARK,
      dragSteps: parseInteger(raw['drag-steps'], {
        name: 'drag-steps',
        min: 3,
        max: 120,
        fallback: DEFAULT_DRAG_STEPS,
      }),
      changedThreshold: parseInteger(raw['changed-threshold'], {
        name: 'changed-threshold',
        min: 0,
        max: 255,
        fallback: DEFAULT_CHANGED_THRESHOLD,
      }),
      changedMinPercent: parseNumber(raw['changed-min'], {
        name: 'changed-min',
        min: 0,
        max: 100,
        fallback: DEFAULT_CHANGED_MIN_PERCENT,
      }),
      settleMs: parseInteger(raw['settle-ms'], {
        name: 'settle-ms',
        min: 0,
        fallback: DEFAULT_SETTLE_MS,
      }),
      readyTimeoutMs,
      stabilityTimeoutMs: Math.min(
        readyTimeoutMs,
        parseInteger(raw['stability-timeout-ms'], {
          name: 'stability-timeout-ms',
          min: 500,
          fallback: DEFAULT_STABILITY_TIMEOUT_MS,
        }),
      ),
      stableFrames: parseInteger(raw['stable-frames'], {
        name: 'stable-frames',
        min: 2,
        max: 20,
        fallback: DEFAULT_STABLE_FRAMES,
      }),
      stabilityThreshold: parseNumber(raw['stability-threshold'], {
        name: 'stability-threshold',
        min: 0,
        max: 64,
        fallback: DEFAULT_STABILITY_THRESHOLD,
      }),
      minSpread: parseNumber(raw['min-spread'], {
        name: 'min-spread',
        min: 0,
        max: 255,
        fallback: DEFAULT_MIN_SPREAD,
      }),
      minLitFraction: parseNumber(raw['min-lit'], {
        name: 'min-lit',
        min: 0,
        max: 1,
        fallback: DEFAULT_MIN_LIT_FRACTION,
      }),
      minMean: parseNumber(raw['min-mean'], {
        name: 'min-mean',
        min: 0,
        max: 255,
        fallback: DEFAULT_MIN_MEAN,
      }),
      commandTimeoutMs: parseInteger(raw['command-timeout'], {
        name: 'command-timeout',
        min: 1000,
        fallback: DEFAULT_COMMAND_TIMEOUT_MS,
      }),
      browserPath: raw.browser ? path.resolve(raw.browser) : null,
      port: parseInteger(raw.port, { name: 'port', min: 0, max: 65535, fallback: 0 }),
      extraChromeArgs: repeatable['chrome-arg'],
      allowConsoleErrorPatterns: repeatable['allow-console-error'],
      textHidden: raw['text-hidden'] === true,
      reducedMotion: raw['reduced-motion'] === true,
      lenient: raw.lenient === true,
      keepProfile: raw['keep-profile'] === true,
      dryRun: raw['dry-run'] === true,
      verbose: raw.verbose === true,
    },
  };
}

export function parseSize(value, name = '--sizes') {
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(String(value).trim());
  if (!match) {
    throw new UsageError(`${name} expects <WxH> such as 1920x1080 (received "${value}")`);
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 64 || height < 64) {
    throw new UsageError(`${name} viewport ${width}x${height} is too small to capture`);
  }
  return { width, height, label: `${width}x${height}` };
}

function parseSizeList(value) {
  const sizes = String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => parseSize(entry));
  if (sizes.length === 0) {
    throw new UsageError('--sizes needs at least one <WxH> entry');
  }
  return sizes;
}

/**
 * Scroll steps are whole percentage points of the page's scroll story.
 *
 * Integers only, because the step is also the file name (`scroll-50.png`) and a
 * step of `12.5` would put a dot in a name that is supposed to sort among its
 * neighbours. Duplicates are dropped rather than rejected: two identical steps
 * write the same file twice, and the second write quietly overwrites the first
 * with a frame that was captured at a different moment — a duplicate is a
 * mistake, but it is not a mistake worth failing a whole run over.
 */
export function parseScrollSteps(value) {
  const entries = String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new UsageError('--scroll-steps needs at least one percentage, e.g. 0,50,100');
  }

  const steps = [];
  for (const entry of entries) {
    const parsed = Number(entry);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      throw new UsageError(
        `--scroll-steps entries are whole percentages 0..100 (received "${entry}")`,
      );
    }
    if (parsed < 0 || parsed > 100) {
      throw new UsageError(`--scroll-steps percentage must be 0..100 (received ${parsed})`);
    }
    if (!steps.includes(parsed)) steps.push(parsed);
  }
  return steps;
}

/** Resolves `x,y` or `%`-relative values against a viewport. */
export function resolvePoint(raw, viewport) {
  const parts = String(raw).split(',');
  if (parts.length !== 2) {
    throw new UsageError(`pointer point expects "x,y" (received "${raw}")`);
  }

  const axis = (part, extent) => {
    const text = part.trim();
    if (/^-?\d+(\.\d+)?%$/.test(text)) {
      return Math.round((Number(text.slice(0, -1)) / 100) * extent);
    }
    const value = Number(text);
    if (!Number.isFinite(value)) {
      throw new UsageError(`pointer point expects numbers (received "${raw}")`);
    }
    return Math.round(value);
  };

  const clamp = (value, extent) => Math.min(Math.max(value, 0), extent - 1);
  return {
    x: clamp(axis(parts[0], viewport.width), viewport.width),
    y: clamp(axis(parts[1], viewport.height), viewport.height),
  };
}

// ---------------------------------------------------------------------------
// Naming and the resolved matrix
// ---------------------------------------------------------------------------

/**
 * File names are `<prefix>-<backend>-<quality>-<WxH>-<stage>[-<suffix>].png`.
 *
 * The viewport is in the name on purpose. A capture run is usually looked at
 * weeks later, next to frames from other runs, and a `idle.png` that has to be
 * opened to learn which viewport it came from is a file nobody trusts.
 */
export function formatCaptureName({ prefix, backend, quality, sizeLabel, stage, suffix = '' }) {
  return [
    sanitizeSegment(prefix),
    sanitizeSegment(backend),
    sanitizeSegment(quality),
    sanitizeSegment(sizeLabel),
    sanitizeSegment(stage),
  ]
    .join('-')
    .concat(suffix)
    .concat('.png');
}

/**
 * The whole capture matrix, resolved before any browser is launched.
 *
 * `--dry-run` prints this, which means the plan has to be complete enough to
 * answer the only question a dry run is asked: what files is this about to
 * write, and where. The plan therefore carries the file list, not just a count.
 */
export function resolvePlan(options) {
  const url = `${options.baseUrl}/?${new URLSearchParams({ boot: 'skip', telemetry: '1' }).toString()}`;
  const backendLabel = options.backend;
  const files = [];
  const scrollSteps = options.scrollSteps;
  const reverseSteps = options.reverse ? [...scrollSteps].reverse() : [];

  const push = (size, stage, kind, description, suffix = '') => {
    const name = formatCaptureName({
      prefix: options.namePrefix,
      backend: backendLabel,
      quality: options.quality,
      sizeLabel: size.label,
      stage,
      suffix,
    });
    files.push({ size, stage, kind, name, filePath: path.join(options.outDir, name), description });
  };

  for (const size of options.sizes) {
    push(size, 'idle', 'static', 'hero frame, pointer parked, scroll reset');
    if (options.thumb) {
      push(
        size,
        'idle',
        'thumbnail',
        `${options.thumb.label} downscale of the idle frame via clip.scale`,
        `-thumb-${options.thumb.label}`,
      );
    }
    for (const step of scrollSteps) {
      push(size, `scroll-${padScrollStep(step)}`, 'scroll', `page scroll at ${step}%`);
    }
    for (const step of reverseSteps) {
      push(size, `reverse-${padScrollStep(step)}`, 'scroll', `page scroll back at ${step}%`);
    }
    if (options.drag) {
      push(size, 'drag-before', 'drag', 'pointer parked away from the canvas centre');
      push(size, 'drag-during', 'drag', 'mid-drag, left button held down');
      push(size, 'drag-after', 'drag', 'button released, pointer parked again');
      push(size, 'drag-mask', 'drag-mask', 'absolute luminance difference before vs during');
    }
  }

  return { url, sizes: options.sizes, scrollSteps, reverseSteps, files };
}

// ---------------------------------------------------------------------------
// Browser discovery and launch
// ---------------------------------------------------------------------------

export function findBrowserExecutable(overridePath) {
  if (overridePath) {
    if (!existsSync(overridePath)) {
      throw new UsageError(`--browser points at a missing file: ${overridePath}`);
    }
    return overridePath;
  }

  if (process.env.STAGE356_BROWSER && existsSync(process.env.STAGE356_BROWSER)) {
    return process.env.STAGE356_BROWSER;
  }

  const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files';
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA;

  const candidates = [
    process.env.CHROME_PATH,
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
    path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new UsageError(
      'No Chrome or Edge executable was found. Pass --browser <path> to point at one.',
    );
  }
  return found;
}

function buildBrowserArgs(options, profileDir, port) {
  const args = [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-extensions',
    '--disable-component-update',
    '--disable-sync',
    '--disable-translate',
    '--mute-audio',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--allow-file-access-from-files',
    '--enable-unsafe-swiftshader',
    `--window-size=${options.sizes[0].width},${options.sizes[0].height}`,
  ];

  if (options.backend === 'webgpu') {
    args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan');
  } else {
    // Belt and braces: these flags are unreliable on Windows, so `hideWebGpu`
    // also removes the API from the page before the app can probe for it.
    args.push('--disable-features=WebGPU,Vulkan');
  }

  args.push(...options.extraChromeArgs, 'about:blank');
  return args;
}

function createLineCollector(limit = 60) {
  const lines = [];
  let buffered = '';
  return {
    push(chunk) {
      buffered += chunk.toString('utf8');
      const parts = buffered.split(/\r?\n/);
      buffered = parts.pop() ?? '';
      for (const part of parts) {
        if (part.trim().length === 0) continue;
        lines.push(part);
        if (lines.length > limit) lines.shift();
      }
    },
    lines() {
      return buffered.trim().length > 0 ? [...lines, buffered] : [...lines];
    },
  };
}

/**
 * Spawns the browser, preferring piped stdio and surviving a sandbox that
 * forbids it.
 *
 * Piping the child's stdout and stderr is what makes a failed launch
 * diagnosable: Chrome's own message about a locked profile or a bad flag is the
 * only evidence there is, and it arrives on stderr. But `pipe` is implemented
 * over a named pipe, and a confined sandbox can refuse that outright —
 * `child_process.spawn` then throws `EPERM` synchronously, before any process
 * exists, which reads exactly like "Chrome will not launch" when it in fact
 * means "Chrome would have launched fine but its output cannot be captured".
 *
 * So the piped attempt is the default and `stdio: 'ignore'` is the fallback,
 * and the run records which one it got. Losing the browser log tail is a
 * visible, stated loss (`browser log: unavailable`), not a silent one.
 */
function spawnBrowser(executable, args) {
  try {
    const child = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return { child, piped: true };
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error;
    const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true });
    return { child, piped: false };
  }
}

async function readDevToolsPort(profileDir, deadline, isAlive) {
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  while (Date.now() < deadline) {
    if (!isAlive()) {
      throw new ConnectionError('The browser exited before its DevTools endpoint was ready');
    }
    try {
      const content = await readFile(portFile, 'utf8');
      const port = Number.parseInt(content.split(/\r?\n/)[0], 10);
      if (Number.isInteger(port) && port > 0) return port;
    } catch {
      // The file appears a moment after launch; keep polling.
    }
    await delay(100);
  }
  throw new ConnectionError('Timed out waiting for the browser DevTools port file');
}

async function fetchJson(url, { attempts = 40, intervalMs = 150 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status} from ${url}`);
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new ConnectionError(`Could not reach the browser DevTools endpoint: ${lastError?.message}`);
}

function killProcessTree(pid, { synchronous = false } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    const args = ['/pid', String(pid), '/T', '/F'];
    if (synchronous) spawnSync('taskkill', args, { stdio: 'ignore', windowsHide: true });
    else spawn('taskkill', args, { stdio: 'ignore', windowsHide: true, detached: false }).unref();
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

/**
 * A hard kill (TerminateProcess) cannot run any handler in this process, which
 * would leave the browser and its profile behind. This detached watchdog polls
 * the owning process and performs the same cleanup when the owner disappears.
 * It reads its instructions from a file in the temp profile, so deleting that
 * profile is also how the watchdog is retired after a clean shutdown.
 */
const WATCHDOG_SOURCE = `
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const ownerFile = process.argv[1];
const POLL_MS = 1500;

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error) && error.code === 'EPERM';
  }
}

function isBrowserProcess(pid) {
  try {
    const output = execFileSync('tasklist', ['/FI', 'PID eq ' + pid, '/NH'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    if (/no tasks|not found/i.test(output)) return true;
    if (/chrome\\.exe|msedge\\.exe/i.test(output)) return true;
    return !/\\.exe/i.test(output);
  } catch {
    return true;
  }
}

let owner = null;
try {
  owner = JSON.parse(readFileSync(ownerFile, 'utf8'));
} catch {
  owner = null;
}
if (!owner) process.exit(0);

const timer = setInterval(() => {
  if (isAlive(owner.parentPid) && existsSync(ownerFile)) return;
  clearInterval(timer);
  if (isAlive(owner.browserPid) && isBrowserProcess(owner.browserPid)) {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/pid', String(owner.browserPid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: 10000,
        });
      } else {
        process.kill(owner.browserPid, 'SIGKILL');
      }
    } catch {
      // Nothing left to kill.
    }
  }
  setTimeout(() => {
    try {
      rmSync(path.dirname(ownerFile), { recursive: true, force: true });
    } catch {
      // Best effort.
    }
    process.exit(0);
  }, 1200);
}, POLL_MS);
`;

function startOrphanWatchdog(profileDir, browserPid) {
  const ownerFile = path.join(profileDir, 'stage356-owner.json');
  try {
    writeFileSync(
      ownerFile,
      JSON.stringify({ parentPid: process.pid, browserPid, startedAt: Date.now() }),
    );
    const watchdog = spawn(
      process.execPath,
      ['--input-type=module', '-e', WATCHDOG_SOURCE, ownerFile],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    watchdog.unref();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// CDP client
// ---------------------------------------------------------------------------

class CdpClient {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();
  #closed = false;

  constructor(socket, commandTimeoutMs) {
    this.#socket = socket;
    this.commandTimeoutMs = commandTimeoutMs;
    socket.addEventListener('message', (event) => this.#handleMessage(event));
    socket.addEventListener('close', () => this.#failAll(new Error('DevTools socket closed')));
    socket.addEventListener('error', () => this.#failAll(new Error('DevTools socket errored')));
  }

  static async connect(url, commandTimeoutMs) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new ConnectionError(`Could not open the DevTools socket at ${url}`));
      };
      const cleanup = () => {
        socket.removeEventListener('open', onOpen);
        socket.removeEventListener('error', onError);
      };
      socket.addEventListener('open', onOpen);
      socket.addEventListener('error', onError);
    });
    return new CdpClient(socket, commandTimeoutMs);
  }

  #handleMessage(event) {
    let message;
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
    } catch {
      return;
    }

    if (message.id !== undefined) {
      const entry = this.#pending.get(message.id);
      if (!entry) return;
      this.#pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) {
        const error = new Error(
          `${entry.method} failed: ${message.error.message ?? JSON.stringify(message.error)}`,
        );
        error.cdpError = message.error;
        entry.reject(error);
      } else {
        entry.resolve(message.result ?? {});
      }
      return;
    }

    if (message.method) {
      const handlers = this.#listeners.get(message.method);
      if (!handlers) return;
      for (const handler of handlers) {
        try {
          handler(message.params ?? {}, message.sessionId ?? null);
        } catch {
          // A listener must never break the connection.
        }
      }
    }
  }

  #failAll(error) {
    this.#closed = true;
    for (const entry of this.#pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.#pending.clear();
  }

  send(method, params = {}, sessionId = null) {
    if (this.#closed) {
      return Promise.reject(new ConnectionError('DevTools connection is closed'));
    }
    const id = this.#nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out after ${this.commandTimeoutMs} ms`));
      }, this.commandTimeoutMs);
      this.#pending.set(id, { resolve, reject, method, timer });
      try {
        this.#socket.send(JSON.stringify(payload));
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  on(method, handler) {
    const handlers = this.#listeners.get(method) ?? new Set();
    handlers.add(handler);
    this.#listeners.set(method, handlers);
    return () => handlers.delete(handler);
  }

  close() {
    this.#closed = true;
    try {
      this.#socket.close();
    } catch {
      // Ignore.
    }
  }
}

// ---------------------------------------------------------------------------
// PNG decoding, analysis and encoding (no dependencies)
// ---------------------------------------------------------------------------

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  if (distanceUp <= distanceUpLeft) return up;
  return upLeft;
}

export function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < PNG_SIGNATURE.length) {
    throw new Error('decodePng expects a PNG buffer');
  }
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('decodePng received bytes that are not a PNG');
  }

  let offset = PNG_SIGNATURE.length;
  let header = null;
  const idatParts = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) {
      throw new Error(`Truncated PNG chunk ${type}`);
    }
    if (type === 'IHDR') {
      header = {
        width: buffer.readUInt32BE(dataStart),
        height: buffer.readUInt32BE(dataStart + 4),
        bitDepth: buffer[dataStart + 8],
        colorType: buffer[dataStart + 9],
        interlace: buffer[dataStart + 12],
      };
    } else if (type === 'IDAT') {
      idatParts.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!header) throw new Error('PNG is missing its IHDR chunk');
  if (header.bitDepth !== 8) {
    throw new Error(`Unsupported PNG bit depth ${header.bitDepth}`);
  }
  if (header.interlace !== 0) {
    throw new Error('Interlaced PNGs are not supported');
  }
  const channels = CHANNELS_BY_COLOR_TYPE[header.colorType];
  if (!channels) {
    throw new Error(`Unsupported PNG colour type ${header.colorType}`);
  }
  if (idatParts.length === 0) throw new Error('PNG has no IDAT data');

  const raw = inflateSync(Buffer.concat(idatParts));
  const stride = header.width * channels;
  if (raw.length < (stride + 1) * header.height) {
    throw new Error('PNG pixel data is shorter than its header claims');
  }

  const pixels = Buffer.alloc(stride * header.height);
  let cursor = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const line = raw.subarray(cursor, cursor + stride);
    cursor += stride;
    const current = pixels.subarray(y * stride, (y + 1) * stride);

    if (filter === 0) {
      line.copy(current);
    } else if (filter === 1) {
      for (let i = 0; i < stride; i += 1) {
        const left = i >= channels ? current[i - channels] : 0;
        current[i] = (line[i] + left) & 0xff;
      }
    } else if (filter === 2) {
      for (let i = 0; i < stride; i += 1) {
        current[i] = (line[i] + previous[i]) & 0xff;
      }
    } else if (filter === 3) {
      for (let i = 0; i < stride; i += 1) {
        const left = i >= channels ? current[i - channels] : 0;
        current[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xff;
      }
    } else if (filter === 4) {
      for (let i = 0; i < stride; i += 1) {
        const left = i >= channels ? current[i - channels] : 0;
        const upLeft = i >= channels ? previous[i - channels] : 0;
        current[i] = (line[i] + paethPredictor(left, previous[i], upLeft)) & 0xff;
      }
    } else {
      throw new Error(`Unsupported PNG filter type ${filter}`);
    }

    previous = current;
  }

  return { width: header.width, height: header.height, channels, data: pixels };
}

function luminanceAt(data, offset, channels) {
  if (channels === 1) return data[offset];
  if (channels === 2) return data[offset];
  const r = data[offset];
  const g = data[offset + 1];
  const b = data[offset + 2];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Luminance spread, mean and lit-pixel fraction; a flat dark frame means "not ready". */
export function analyzeFrame(image, { samples = 24_000 } = {}) {
  const { width, height, channels, data } = image;
  const total = width * height;
  const step = Math.max(1, Math.floor(total / samples));
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let count = 0;
  let lit = 0;

  for (let index = 0; index < total; index += step) {
    const luminance = luminanceAt(data, index * channels, channels);
    if (luminance < min) min = luminance;
    if (luminance > max) max = luminance;
    sum += luminance;
    count += 1;
    if (luminance > 8) lit += 1;
  }

  return {
    width,
    height,
    samples: count,
    mean: count > 0 ? sum / count : 0,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
    spread: Number.isFinite(min) && Number.isFinite(max) ? max - min : 0,
    litFraction: count > 0 ? lit / count : 0,
  };
}

/**
 * Byte equality of two decoded frames.
 *
 * The reduced-motion bar. A coarse signature answers "is the frame still moving
 * much", which is the right question for an animated scene and the wrong one
 * for a scene that claims to have stopped: an asymptotically easing camera
 * moves less than one signature cell between samples and passes. Two captures
 * taken that way came back differing on 174 pixels, which is exactly the amount
 * of motion the criterion exists to rule out.
 */
export function buffersEqual(left, right) {
  if (left === null || right === null) return false;
  if (left.length !== right.length) return false;
  return Buffer.from(left).equals(Buffer.from(right));
}

/** Coarse 16x16 luminance signature used for "are consecutive frames stable". */
export function frameSignature(image, grid = DEFAULT_GRID) {
  const { width, height, channels, data } = image;
  const sums = new Float64Array(grid * grid);
  const counts = new Float64Array(grid * grid);

  for (let y = 0; y < height; y += 1) {
    const cellY = Math.min(grid - 1, Math.floor((y * grid) / height));
    for (let x = 0; x < width; x += 1) {
      const cellX = Math.min(grid - 1, Math.floor((x * grid) / width));
      const cell = cellY * grid + cellX;
      sums[cell] += luminanceAt(data, (y * width + x) * channels, channels);
      counts[cell] += 1;
    }
  }

  const signature = new Float64Array(grid * grid);
  for (let index = 0; index < signature.length; index += 1) {
    signature[index] = counts[index] > 0 ? sums[index] / counts[index] : 0;
  }
  return signature;
}

export function signatureDelta(a, b) {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let index = 0; index < a.length; index += 1) {
    total += Math.abs(a[index] - b[index]);
  }
  return total / a.length;
}

/**
 * The absolute per-pixel luminance difference between two frames.
 *
 * Luminance, not channel-wise colour distance, because the number this feeds is
 * a claim about how much of the *picture* changed, and the mask has to be
 * readable as a greyscale PNG. Both metrics are derived the same way so the
 * percentage and the mean printed beside it describe the same pixels.
 *
 * The threshold exists because "every pixel differs" is true of any two frames
 * of a rendered scene: anti-aliasing, dithering and the tone curve all move
 * individual samples by a count or two between captures. At a threshold of 8
 * out of 255 those are noise; a real drag moves whole regions by tens.
 */
export function diffLuminance(before, after, { threshold = DEFAULT_CHANGED_THRESHOLD } = {}) {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error(
      `Cannot diff frames of different sizes: ${before.width}x${before.height} vs ${after.width}x${after.height}`,
    );
  }

  const { width, height } = before;
  const total = width * height;
  const mask = Buffer.alloc(total);
  let changed = 0;
  let sum = 0;
  let max = 0;

  for (let index = 0; index < total; index += 1) {
    const left = Math.round(luminanceAt(before.data, index * before.channels, before.channels));
    const right = Math.round(luminanceAt(after.data, index * after.channels, after.channels));
    const delta = Math.min(255, Math.abs(left - right));
    mask[index] = delta;
    if (delta > threshold) {
      changed += 1;
      sum += delta;
      if (delta > max) max = delta;
    }
  }

  return {
    width,
    height,
    mask,
    total,
    threshold,
    changed,
    changedFraction: total > 0 ? changed / total : 0,
    changedPercent: total > 0 ? (changed / total) * 100 : 0,
    meanDelta: changed > 0 ? sum / changed : 0,
    maxDelta: max,
  };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    c = CRC_TABLE[(c ^ buffer[index]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Encodes an 8-bit greyscale PNG, which is all the mask needs.
 *
 * Every row is written with filter type 0 (None). Choosing per-row filters
 * would shave a few kilobytes off a difference image that is mostly zeros, and
 * it would also mean writing the filter-selection heuristic and having a bug in
 * it crash a capture run at the very last step. The mask is evidence, not a
 * deliverable to be optimised.
 */
export function encodeGrayscalePng(width, height, pixels) {
  if (pixels.length < width * height) {
    throw new Error(
      `encodeGrayscalePng needs ${width * height} bytes of pixels, received ${pixels.length}`,
    );
  }

  const stride = width;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // colour type: greyscale
  header[10] = 0; // compression: deflate
  header[11] = 0; // filter method: adaptive
  header[12] = 0; // interlace: none

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Console classification
// ---------------------------------------------------------------------------

/**
 * Notices this project produces that are not findings.
 *
 * These are checked BEFORE the fatal patterns rather than after. The house
 * ordering downgrades benign text only once nothing fatal has matched, which is
 * right for an open-ended filter and wrong for a named allowlist: the whole
 * point of naming a notice is that the run must not fail on it, and a
 * `powerPreference`-related WebGPU warning that happens to mention a validation
 * detail would otherwise be promoted back to fatal by the very filter the
 * allowlist exists to survive.
 */
const ALLOWED_PATTERNS = [
  { id: 'favicon', re: /favicon\.ico/i },
  { id: 'three-clock', re: /three\.clock|clock[^.\n]{0,24}deprecat/i },
  { id: 'power-preference', re: /powerpreference/i },
  { id: 'hmr', re: /\[hmr\]|hot module replacement|\[fast refresh\]|hot reload/i },
  { id: 'react-devtools', re: /react devtools|download the react devtools/i },
  // Environmental noise that is not a finding about the app: an ASAR/devtools
  // probe, autofill, and the preload hint the Next.js dev server emits.
  { id: 'devtools-noise', re: /autofill\.enable|preloaded using link preload|devtools is now available/i },
  { id: 'swiftshader-note', re: /automatic fallback to software webgl|swiftshader/i },
];

const FATAL_PATTERNS = [
  { id: 'nan', re: /\bNaN\b/ },
  // Ahead of the buffer-size heuristics on purpose. A WebGPU validation error
  // that happens to mention a size — `GPUValidationError: Buffer size (0) is
  // invalid` — matches both, and both are fatal, so the exit code does not
  // care; the *report* does. Naming it after the generic heuristic throws away
  // the one word that says which subsystem broke.
  {
    id: 'webgpu-validation',
    re: /(gpuvalidationerror|gpuinternalerror|gpuoutofmemoryerror|gpudevicelost|device lost|validation error|uncaptured (webgpu )?error|webgpu[^.\n]{0,40}validation)/i,
  },
  {
    id: 'buffer-size',
    re: /(invalid|negative|illegal|out[- ]of[- ]range|not finite|overflow)[^.\n]{0,48}(buffer|size|length|allocation|dimension|stride|count)/i,
  },
  {
    id: 'buffer-size',
    re: /(buffer|size|length|allocation|dimension|stride)[^.\n]{0,32}\b(negative|invalid|NaN|undefined)\b/i,
  },
  {
    id: 'buffer-size',
    re: /(array buffer allocation failed|invalid array length|allocation size overflow|range ?error: ?invalid)/i,
  },
  {
    id: 'renderer-abort',
    re: /(context lost|webgl: context lost|renderer process (crashed|gone)|out of memory)/i,
  },
];

/**
 * Classifies one collected message. `fatal` always fails the run; `error` fails
 * it unless `--lenient` is set. Allowlisted and known-environmental messages
 * are downgraded to `warning` so the harness stays loud without being noisy.
 */
export function classifyConsoleEntry(entry, options = {}) {
  const { allowPatterns = [], kind = 'console', level = 'info' } = options;
  const text = String(entry ?? '');
  const base = { text, kind, level };

  for (const pattern of allowPatterns) {
    let re;
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      continue;
    }
    if (re.test(text)) {
      return { ...base, severity: 'warning', reason: `allowlisted (${pattern})` };
    }
  }

  for (const pattern of ALLOWED_PATTERNS) {
    if (pattern.re.test(text)) {
      return { ...base, severity: 'warning', reason: `allowed (${pattern.id})` };
    }
  }

  for (const pattern of FATAL_PATTERNS) {
    if (pattern.re.test(text)) {
      return { ...base, severity: 'fatal', reason: pattern.id };
    }
  }

  if (kind === 'exception') {
    return { ...base, severity: 'fatal', reason: 'uncaught-exception' };
  }
  if (level === 'error') {
    return { ...base, severity: 'error', reason: 'console-error' };
  }
  if (level === 'warning') {
    return { ...base, severity: 'warning', reason: 'console-warning' };
  }
  return { ...base, severity: 'info', reason: null };
}

function formatRemoteObject(argument) {
  if (!isPlainObject(argument)) return String(argument);
  if (argument.type === 'string') return argument.value ?? '';
  if ('value' in argument) return String(argument.value);
  if (argument.unserializableValue !== undefined) return String(argument.unserializableValue);
  if (argument.preview && Array.isArray(argument.preview.properties)) {
    const properties = argument.preview.properties
      .map((property) => `${property.name}: ${property.value ?? property.type}`)
      .join(', ');
    return `${argument.description ?? 'Object'} { ${properties}${argument.preview.overflow ? ', ...' : ''} }`;
  }
  return argument.description ?? argument.type ?? 'unknown';
}

export function createConsoleCollector({ allowPatterns = [], onEntry } = {}) {
  const entries = [];

  const record = (entry, classifyOptions) => {
    const classified = classifyConsoleEntry(entry.text, {
      allowPatterns,
      ...classifyOptions,
    });
    const stored = { ...classified, at: new Date().toISOString() };
    entries.push(stored);
    if (onEntry) onEntry(stored);
    return stored;
  };

  return {
    attach(client, sessionId) {
      const owns = (incoming) => sessionId === null || incoming === sessionId;
      client.on('Runtime.consoleAPICalled', (params, incoming) => {
        if (!owns(incoming)) return;
        const args = params.args ?? [];
        // A preview is truncated, and the renderer's telemetry snapshot is the
        // one console object whose *whole* value is the evidence: which backend
        // took which path, how many field samples were actually asked for, what
        // the quality tier resolved to. Expanding it over the object handle is
        // the difference between logging that telemetry exists and being able
        // to check what it said.
        const expand = args.map((argument) =>
          isPlainObject(argument) && typeof argument.objectId === 'string'
            ? client
                .send(
                  'Runtime.callFunctionOn',
                  {
                    objectId: argument.objectId,
                    functionDeclaration: 'function () { return JSON.stringify(this); }',
                    returnByValue: true,
                  },
                  sessionId,
                )
                .then((result) => result?.result?.value ?? null)
                .catch(() => null)
            : Promise.resolve(null),
        );
        Promise.all(expand).then((expanded) => {
          const text = args
            .map((argument, index) => expanded[index] ?? formatRemoteObject(argument))
            .join(' ');
          record(
            { text: text.length > 0 ? text : `[${params.type}]` },
            { kind: 'console', level: params.type === 'error' ? 'error' : params.type },
          );
        });
      });
      client.on('Runtime.exceptionThrown', (params, incoming) => {
        if (!owns(incoming)) return;
        const details = params.exceptionDetails ?? {};
        const description = details.exception?.description ?? details.text ?? 'Uncaught exception';
        record({ text: description }, { kind: 'exception', level: 'error' });
      });
      client.on('Log.entryAdded', (params, incoming) => {
        if (!owns(incoming)) return;
        const logEntry = params.entry ?? {};
        const text = [logEntry.text, logEntry.url].filter(Boolean).join(' ');
        record(
          { text: text.length > 0 ? text : '[log]' },
          { kind: `log:${logEntry.source ?? 'unknown'}`, level: logEntry.level ?? 'info' },
        );
      });
    },
    entries,
    summary() {
      const counts = { info: 0, warning: 0, error: 0, fatal: 0 };
      for (const entry of entries) counts[entry.severity] += 1;
      return {
        total: entries.length,
        counts,
        fatals: entries.filter((entry) => entry.severity === 'fatal'),
        errors: entries.filter((entry) => entry.severity === 'error'),
        warnings: entries.filter((entry) => entry.severity === 'warning'),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Session plumbing
// ---------------------------------------------------------------------------

async function attachPageSession(client) {
  const targets = await client.send('Target.getTargets');
  const pageTargets = (targets.targetInfos ?? []).filter((info) => info.type === 'page');
  const existing = pageTargets.find((info) => info.url.startsWith('about:blank')) ?? pageTargets[0];

  let targetId = existing?.targetId;
  if (!targetId) {
    const created = await client.send('Target.createTarget', { url: 'about:blank' });
    targetId = created.targetId;
  }

  const attached = await client.send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = attached.sessionId;
  if (!sessionId) throw new ConnectionError('Could not attach to the browser page target');
  return { sessionId, targetId };
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    const description =
      result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
    throw new Error(`Page evaluation failed: ${description}`);
  }
  return result.result?.value;
}

async function applyViewport(client, sessionId, size) {
  await client.send(
    'Emulation.setDeviceMetricsOverride',
    {
      width: size.width,
      height: size.height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: size.width,
      screenHeight: size.height,
    },
    sessionId,
  );

  // Settle, and this is not politeness — it is the difference between a real
  // measurement and a black frame.
  //
  // `setDeviceMetricsOverride` resizes the *screenshot*. The page re-lays-out
  // afterwards, and the canvas follows one step further behind that: this app
  // sizes its drawing buffer from `canvas.parentElement`'s box inside a
  // `ResizeObserver` (see `RendererHost`), so there are two asynchronous hops
  // between the override and a canvas that fills it. Capture immediately and
  // the screenshot is the requested size with the *previous* viewport's content
  // in its top-left corner and black to the right and below — a 2560x1440 file
  // holding a 1920x1080 frame. That failure was measured on this project as
  // `lit 59.98%`, which looks like a composition with a lot of dark sky in it;
  // only the black band along two edges says what it actually is.
  //
  // So wait for the thing that is actually wrong: the canvas, not the window.
  // Unless there is no canvas, which is the case for the first call — the
  // viewport is set once before the page is navigated to, and waiting for a
  // canvas on `about:blank` is waiting forever.
  const hasCanvas = await evaluate(
    client,
    sessionId,
    "document.querySelector('canvas') !== null",
  );
  if (hasCanvas !== true) return;

  const deadline = Date.now() + 4000;
  for (;;) {
    const settled = await evaluate(
      client,
      sessionId,
      `(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return false;
        if (window.innerWidth !== ${size.width} || window.innerHeight !== ${size.height}) {
          return false;
        }
        return canvas.clientWidth === ${size.width} && canvas.clientHeight === ${size.height};
      })()`,
    );
    if (settled === true) break;
    if (Date.now() > deadline) {
      const seen = await evaluate(
        client,
        sessionId,
        `(() => {
          const canvas = document.querySelector('canvas');
          const host = canvas && canvas.parentElement;
          return JSON.stringify({
            window: [window.innerWidth, window.innerHeight],
            canvas: canvas ? [canvas.clientWidth, canvas.clientHeight] : null,
            host: host ? [host.clientWidth, host.clientHeight] : null,
            style: canvas ? [canvas.style.width, canvas.style.height] : null,
          });
        })()`,
      );
      throw new Error(
        `Viewport ${size.width}x${size.height} did not settle: the canvas never grew to fill it (${seen}).`,
      );
    }
    await delay(40);
  }

  // Two more frames on top of the resize, because a canvas that has just been
  // resized has been resized but not yet *drawn* at its new size.
  await evaluate(
    client,
    sessionId,
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
  );
}

async function applyReducedMotion(client, sessionId, enabled) {
  await client.send(
    'Emulation.setEmulatedMedia',
    enabled
      ? {
          media: 'screen',
          features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        }
      : { media: 'screen', features: [] },
    sessionId,
  );
}

/**
 * Hides `navigator.gpu` before any page script runs.
 *
 * The app picks its backend from a capability probe (`detectRendererCapabilities`),
 * which is the honest thing for it to do, so a capture run cannot ask it
 * politely to take the fallback. Chrome's `--disable-features=WebGPU` and
 * `--disable-blink-features=WebGPU` are both ignored on Windows, and a
 * `--backend webgl2` run kept coming back as WebGPU. Shadowing the property on
 * the navigator instance is what actually simulates a machine without WebGPU,
 * and it leaves the app's own detection path untouched.
 */
async function hideWebGpu(client, sessionId) {
  await client.send(
    'Page.addScriptToEvaluateOnNewDocument',
    {
      source: [
        'try {',
        "  Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });",
        '} catch (error) {',
        '  void error;',
        '}',
      ].join('\n'),
    },
    sessionId,
  );
}

async function navigate(client, sessionId, url, timeoutMs) {
  const load = new Promise((resolve) => {
    const off = client.on('Page.loadEventFired', (params, incoming) => {
      if (incoming !== null && incoming !== sessionId) return;
      off();
      resolve('load');
    });
    setTimeout(() => {
      off();
      resolve('timeout');
    }, timeoutMs).unref?.();
  });

  const result = await client.send('Page.navigate', { url }, sessionId);
  if (result.errorText) {
    throw new ConnectionError(
      `Navigation to ${url} failed: ${result.errorText}. Is the dev server running at ${url}?`,
    );
  }
  return load;
}

async function capturePng(client, sessionId, clip) {
  const params = { format: 'png', fromSurface: true, captureBeyondViewport: false };
  if (clip) params.clip = clip;
  const result = await client.send('Page.captureScreenshot', params, sessionId);
  if (!result.data) throw new Error('Page.captureScreenshot returned no data');
  return Buffer.from(result.data, 'base64');
}

/**
 * The thumbnail is a downscale of the frame that was just captured, taken with
 * CDP's `clip.scale` so the browser resamples the real image rather than the
 * page re-rendering the scene at 480x270. A re-rendered thumbnail is a
 * different picture — different dpr, sometimes a different quality tier — and
 * comparing it against the full-size frame would be comparing two shots.
 */
async function captureThumbnail(client, sessionId, size, thumb) {
  const scale = thumb.width / size.width;
  const png = await capturePng(client, sessionId, {
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    scale,
  });
  return { png, scale };
}

async function dispatchMouse(client, sessionId, type, point, button = 'none', buttons = 0) {
  await client.send(
    'Input.dispatchMouseEvent',
    {
      type,
      x: Math.round(point.x),
      y: Math.round(point.y),
      button,
      buttons,
      clickCount: type === 'mouseMoved' ? 0 : 1,
      modifiers: 0,
      pointerType: 'mouse',
    },
    sessionId,
  );
}

/** Injects (or clears) the capture-only stylesheet used by `--text-hidden`. */
async function setTextHidden(client, sessionId, textHidden) {
  const expression = `(() => {
    const id = ${JSON.stringify(CAPTURE_MODE_STYLE_ID)};
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    document.documentElement.classList.toggle('stage356-text-hidden', ${textHidden ? 'true' : 'false'});
    const style = document.createElement('style');
    style.id = id;
    style.textContent = ${JSON.stringify(CAPTURE_MODE_CSS)};
    document.head.appendChild(style);
    return {
      textHidden: document.documentElement.classList.contains('stage356-text-hidden'),
      hidden: Array.from(document.querySelectorAll(
        '.system-masthead, .renderer-status, .boot-experience',
      )).length,
    };
  })()`;
  return evaluate(client, sessionId, expression);
}

/**
 * Scrolls the page to a fraction of its scroll story and reads the result back.
 *
 * `scroll-behavior: smooth` would turn this into an animation and the read-back
 * would return a position partway to the target. The inline style is forced to
 * `auto` for the duration of the call and restored afterwards, so the harness
 * never leaves a style the page did not set.
 */
function buildScrollExpression(progress) {
  return `(() => {
    // Names chosen to avoid every identifier that the spliced state body
    // declares. The two share one function scope, so a repeated const
    // declaration is a SyntaxError rather than a shadow - and three of them were
    // repeated, so the scroll pass failed three times for one reason before it
    // ran at all.
    const rootEl = document.documentElement;
    const savedBehavior = rootEl.style.scrollBehavior;
    rootEl.style.scrollBehavior = 'auto';
    const bodyElement = document.body;
    const scrollable = Math.max(
      0,
      Math.max(rootEl.scrollHeight, bodyElement ? bodyElement.scrollHeight : 0) - window.innerHeight,
    );
    window.scrollTo(0, Math.round(${progress} * scrollable));
    rootEl.style.scrollBehavior = savedBehavior;
${SCROLL_STATE_BODY}
  })()`;
}

async function scrollToProgress(client, sessionId, progress) {
  const state = await evaluate(client, sessionId, buildScrollExpression(progress));
  return isPlainObject(state) ? state : null;
}

// ---------------------------------------------------------------------------
// Readiness and per-frame stability
// ---------------------------------------------------------------------------

/**
 * A frame is acceptable only if it is not one flat colour AND not near-black.
 *
 * The near-black rule is separate from the lit-fraction rule on purpose. A
 * frame can clear a lit-fraction test on a few bright pixels while its mean is
 * still down in single digits, and a scene that has not started rendering yet
 * looks exactly like that: a couple of overlay pixels on a black canvas. Mean,
 * spread and lit fraction are three cheap ways of saying "there is a picture
 * here", and all three have to agree.
 */
function frameAcceptable(stats, options) {
  return (
    stats.spread >= options.minSpread &&
    stats.litFraction >= options.minLitFraction &&
    stats.mean >= options.minMean
  );
}

async function sampleFrame(client, sessionId) {
  const png = await capturePng(client, sessionId);
  const image = decodePng(png);
  return { png, image, stats: analyzeFrame(image), signature: frameSignature(image) };
}

/**
 * Readiness = the DOM probe says ready, the frame is not one flat colour, and
 * consecutive signatures have stopped moving for `stableFrames` samples.
 *
 * Under `--reduced-motion` the bar is equality rather than a threshold. Reduced
 * motion claims the scene has stopped, and a coarse signature that has stopped
 * *changing much* is a weaker statement: a camera still easing asymptotically
 * moves less than one grid cell between samples and passes it. Waiting for two
 * consecutive byte-identical frames asserts the actual claim, and it converges
 * because the scene really does stop.
 */
async function waitForStableFrame(client, sessionId, options, { requireProbe = false } = {}) {
  const budget = requireProbe ? options.readyTimeoutMs : options.stabilityTimeoutMs;
  const deadline = Date.now() + budget;
  let previousSignature = null;
  let previousFrame = null;
  let stableCount = 0;
  let lastProbe = null;
  let lastSample = null;
  let attempts = 0;
  let sawFlat = false;

  while (Date.now() < deadline) {
    attempts += 1;

    if (requireProbe) {
      lastProbe = await evaluate(client, sessionId, READY_EXPRESSION);
      if (!lastProbe?.ready) {
        stableCount = 0;
        previousSignature = null;
        await delay(200);
        continue;
      }
    }

    lastSample = await sampleFrame(client, sessionId);

    if (!frameAcceptable(lastSample.stats, options)) {
      sawFlat = true;
      stableCount = 0;
      previousSignature = lastSample.signature;
      previousFrame = lastSample.image.data;
      await delay(options.settleMs);
      continue;
    }

    const unchanged = previousFrame !== null && buffersEqual(previousFrame, lastSample.image.data);
    if (previousSignature) {
      const delta = signatureDelta(previousSignature, lastSample.signature);
      const settled = options.reducedMotion ? unchanged : delta <= options.stabilityThreshold;
      stableCount = settled ? stableCount + 1 : 0;
    }
    previousSignature = lastSample.signature;
    previousFrame = lastSample.image.data;

    if (stableCount >= options.stableFrames - 1) {
      return {
        ok: true,
        png: lastSample.png,
        image: lastSample.image,
        stats: lastSample.stats,
        probe: lastProbe,
        attempts,
        stable: true,
      };
    }

    await delay(options.settleMs);
  }

  const stats = lastSample?.stats ?? null;
  const reason = requireProbe && !lastProbe?.ready
    ? `readiness probe reported "${lastProbe?.reason ?? 'no response'}"`
    : stats === null
      ? 'no frame could be sampled at all'
      : sawFlat
        ? `frames never became a picture (mean ${stats.mean.toFixed(1)}, spread ${stats.spread.toFixed(1)}, lit ${formatPercent(stats.litFraction)})`
        : `frames never stabilised within ${budget} ms (last luminance spread ${stats.spread.toFixed(1)})`;

  return {
    ok: false,
    png: lastSample?.png ?? null,
    image: lastSample?.image ?? null,
    stats,
    probe: lastProbe,
    attempts,
    stable: false,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Evidence capture
// ---------------------------------------------------------------------------

/**
 * Samples a stable frame, writes it, and records what it measured.
 *
 * The frame is written even when stability never converged, and a failure is
 * pushed alongside it. That is deliberate: a run that fails to stabilise is far
 * easier to diagnose from the frame it was looking at than from a log line
 * saying it never settled, and the exit code already says the run is not clean.
 */
async function captureEvidence(client, sessionId, options, context, { size, stage, input, suffix = '' }) {
  const stability = await waitForStableFrame(client, sessionId, options);
  if (!stability.png || !stability.image) {
    return { ok: false, reason: stability.reason, attempts: stability.attempts };
  }

  const name = formatCaptureName({
    prefix: options.namePrefix,
    backend: context.backendLabel(),
    quality: options.quality,
    sizeLabel: size.label,
    stage,
    suffix,
  });
  const filePath = path.join(options.outDir, name);
  await writeFile(filePath, stability.png);

  const record = {
    name,
    filePath,
    size: `${stability.image.width}x${stability.image.height}`,
    stage,
    input,
    spread: stability.stats.spread,
    mean: stability.stats.mean,
    litFraction: stability.stats.litFraction,
    attempts: stability.attempts,
    bytes: stability.png.length,
  };
  context.captures.push(record);

  if (!stability.ok) {
    context.failures.push({
      kind: 'readiness',
      text: `${name}: ${stability.reason}`,
    });
  }
  if (!frameAcceptable(stability.stats, options)) {
    context.failures.push({
      kind: 'flat-frame',
      text: `${name} looks flat (mean ${stability.stats.mean.toFixed(1)}, spread ${stability.stats.spread.toFixed(1)}, lit ${formatPercent(stability.stats.litFraction)})`,
    });
  }

  console.log(
    `  ${name}  ${record.size}  mean ${record.mean.toFixed(1)}  spread ${record.spread.toFixed(1)}  lit ${formatPercent(record.litFraction)}  ${(record.bytes / 1024).toFixed(0)} KiB  [${input}]`,
  );

  return { ok: true, record, png: stability.png, image: stability.image, stats: stability.stats };
}

/**
 * Scrolls, proves the scroll landed, then captures.
 *
 * The requested and achieved progress are both reported. When the document has
 * no scrollable height the achieved value is 0 for every step and that is
 * reported as a warning rather than a failure — the page genuinely has one
 * scroll position, and failing the run would say the harness is broken when in
 * fact the story does not exist yet. When there IS a scroll story and the
 * position still does not match, that is a failure: it means the scroll was
 * issued and did not take, and the frame is not the frame it claims to be.
 */
async function captureScrollStep(client, sessionId, options, context, { size, step, stage, reverse }) {
  const requested = step / 100;
  const state = await scrollToProgress(client, sessionId, requested);
  const achieved = state?.progress ?? null;

  await delay(options.settleMs);

  const label = `${size.label} ${stage} (${step}% -> ${achieved === null ? 'n/a' : formatPercent(achieved)})`;
  const input = state
    ? `${stage} requested ${formatPercent(requested)} achieved ${formatPercent(achieved)} (y ${state.y} of ${state.maxScroll} px, scrollHeight ${state.scrollHeight}, viewport ${state.viewport})`
    : `${stage} requested ${formatPercent(requested)} (the page did not answer the scroll read-back)`;

  const outcome = await captureEvidence(client, sessionId, options, context, {
    size,
    stage,
    input,
  });

  if (state) {
    context.scrollReports.push({
      size: size.label,
      stage,
      reverse,
      requested,
      achieved,
      y: state.y,
      maxScroll: state.maxScroll,
      scrollHeight: state.scrollHeight,
      viewport: state.viewport,
      attempts: outcome.attempts ?? null,
    });

    if (state.maxScroll <= 0) {
      context.failures.push({
        kind: 'scroll-no-story',
        warnOnly: true,
        text: `${label}: the document has no scrollable height (scrollHeight ${state.scrollHeight} <= viewport ${state.viewport}), so every scroll frame is the idle composition by construction`,
      });
    } else if (Math.abs(achieved - requested) > DEFAULT_SCROLL_TOLERANCE) {
      context.failures.push({
        kind: 'scroll-not-landed',
        text: `${label}: requested ${formatPercent(requested)} but the page reports ${formatPercent(achieved)} (y ${state.y} of ${state.maxScroll} px). The scroll did not take, so this frame is not the frame it is named for.`,
      });
    }
  } else {
    context.failures.push({
      kind: 'scroll-not-landed',
      text: `${label}: the page did not answer the scroll read-back`,
    });
  }

  return outcome;
}

/**
 * The drag triple plus its mask.
 *
 * **Why the "during" frame has to be captured with the button still down.** A
 * drag that has already been released is indistinguishable from a frame of a
 * scene that happened to look slightly different: the pointer is back at rest,
 * nothing is held, and whatever the gesture did may already be decaying. Held
 * down is the state that only a drag can produce.
 *
 * **Why `button: 'none'` with `buttons: 1` on the moves.** That is what a real
 * mouse sends. `buttons` is the held-button bitmask; `button` names the button
 * that *caused* the event, and a move is not caused by one. Sending
 * `button: 'left'` on a move makes Chrome synthesise a press-shaped event, and
 * a handler that counts presses sees several of them for one gesture.
 *
 * **Why the scroll is reset first.** The triple is only comparable frame to
 * frame if all three come from the same place in the scroll story, and the
 * before/after frames are supposed to show the same resting state. A drag
 * captured at whatever offset the scroll pass happened to end on would differ
 * from every other drag run for a reason that has nothing to do with the drag.
 */
async function runDragSequence(client, sessionId, options, context, size) {
  const park = resolvePoint(options.park, size);
  const start = { x: Math.round(size.width * 0.34), y: Math.round(size.height * 0.52) };
  const end = { x: Math.round(size.width * 0.66), y: Math.round(size.height * 0.44) };

  await scrollToProgress(client, sessionId, 0);
  await delay(options.settleMs);

  // (1) before — pointer parked away from the canvas centre.
  await dispatchMouse(client, sessionId, 'mouseMoved', park);
  await delay(options.settleMs);
  const before = await captureEvidence(client, sessionId, options, context, {
    size,
    stage: 'drag-before',
    input: `pointer parked at ${park.x},${park.y}`,
  });

  if (!before.ok || !before.image) {
    context.failures.push({
      kind: 'drag-capture',
      text: `${size.label} drag-before could not be captured: ${before.reason}`,
    });
    return;
  }

  // (2) press, then walk a path with the button held.
  await dispatchMouse(client, sessionId, 'mouseMoved', start);
  await delay(80);
  await dispatchMouse(client, sessionId, 'mousePressed', start, 'left', 1);
  await delay(60);

  let lastPoint = start;
  const arc = size.height * 0.06;
  for (let index = 1; index <= options.dragSteps; index += 1) {
    const t = index / options.dragSteps;
    lastPoint = {
      x: Math.round(start.x + (end.x - start.x) * t),
      y: Math.round(start.y + (end.y - start.y) * t + Math.sin(t * Math.PI) * arc),
    };
    await dispatchMouse(client, sessionId, 'mouseMoved', lastPoint, 'none', 1);
    await delay(24);
  }
  await delay(options.settleMs);

  const during = await captureEvidence(client, sessionId, options, context, {
    size,
    stage: 'drag-during',
    input: `left button held, ${options.dragSteps} moves ${start.x},${start.y} -> ${lastPoint.x},${lastPoint.y}`,
  });

  // (3) release, then park again.
  await dispatchMouse(client, sessionId, 'mouseReleased', lastPoint, 'left', 0);
  await delay(options.settleMs);
  await dispatchMouse(client, sessionId, 'mouseMoved', park);
  await delay(options.settleMs);

  const after = await captureEvidence(client, sessionId, options, context, {
    size,
    stage: 'drag-after',
    input: `released at ${lastPoint.x},${lastPoint.y}, pointer parked at ${park.x},${park.y}`,
  });

  if (!during.ok || !during.image) {
    context.failures.push({
      kind: 'drag-capture',
      text: `${size.label} drag-during could not be captured: ${during.reason}`,
    });
    return;
  }

  // (4) the mask, computed here rather than in the browser.
  let diff;
  try {
    diff = diffLuminance(before.image, during.image, { threshold: options.changedThreshold });
  } catch (error) {
    context.failures.push({
      kind: 'drag-mask',
      text: `${size.label} drag mask could not be computed: ${error.message}`,
    });
    return;
  }

  const maskName = formatCaptureName({
    prefix: options.namePrefix,
    backend: context.backendLabel(),
    quality: options.quality,
    sizeLabel: size.label,
    stage: 'drag-mask',
  });
  const maskPath = path.join(options.outDir, maskName);
  const maskPng = encodeGrayscalePng(diff.width, diff.height, diff.mask);
  await writeFile(maskPath, maskPng);

  context.captures.push({
    name: maskName,
    filePath: maskPath,
    size: `${diff.width}x${diff.height}`,
    stage: 'drag-mask',
    input: `|luminance(before) - luminance(during)|, changed when > ${diff.threshold}`,
    bytes: maskPng.length,
  });

  const report = {
    size: size.label,
    before: before.record.name,
    during: during.record.name,
    after: after.ok ? after.record.name : null,
    mask: maskName,
    changedPercent: diff.changedPercent,
    changedPixels: diff.changed,
    totalPixels: diff.total,
    meanDelta: diff.meanDelta,
    maxDelta: diff.maxDelta,
    threshold: diff.threshold,
  };
  context.dragReports.push(report);

  console.log(
    `  ${maskName}  ${diff.width}x${diff.height}  ${(maskPng.length / 1024).toFixed(0)} KiB  [${diff.changed} of ${diff.total} px changed]`,
  );
  console.log(
    `  drag delta ${size.label}: ${diff.changedPercent.toFixed(3)}% of pixels changed (${diff.changed.toLocaleString('en-US')} px above ${diff.threshold}/255), mean delta ${diff.meanDelta.toFixed(2)} inside the changed region, max ${diff.maxDelta}/255`,
  );

  if (diff.changedPercent < options.changedMinPercent) {
    context.failures.push({
      kind: 'drag-not-visible',
      text: `${size.label}: the drag moved ${diff.changedPercent.toFixed(3)}% of pixels (${diff.changed} px), below the ${options.changedMinPercent}% floor. ${before.record.name} and ${during.record.name} are the same picture, so neither is evidence of a drag.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Preflight, help and the resolved-matrix print
// ---------------------------------------------------------------------------

async function preflightBaseUrl(baseUrl) {
  const started = Date.now();
  let response;
  try {
    response = await fetch(baseUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    const code =
      error?.cause?.code ?? error?.code ?? error?.cause?.name ?? error?.name ?? 'unknown error';
    throw new ConnectionError(
      [
        `No dev server responded at ${baseUrl} (${code}).`,
        'Is the dev server running? Start it in another terminal:',
        '  npm.cmd run dev -- --hostname 127.0.0.1',
        'Then run this capture again.',
      ].join('\n'),
    );
  }

  if (response.status >= 500) {
    throw new ConnectionError(
      `${baseUrl} answered with HTTP ${response.status}. The dev server is not serving the app yet.`,
    );
  }

  return { status: response.status, durationMs: Date.now() - started };
}

function printHelp() {
  const lines = [
    'stage356-capture - zero-dependency Chrome DevTools Protocol screenshot/evidence harness',
    '',
    'Usage:',
    '  node scripts/stage356-capture.mjs [flags]',
    '',
    'Core flags:',
    '  --base-url <url>        App origin to capture. Default http://localhost:3000',
    '                          The page is loaded at <base-url>/?boot=skip&telemetry=1',
    '  --out <dir>             Output directory for PNGs. Default artifacts/stage356',
    '  --backend <webgpu|webgl2>  Backend the run must actually reach. Default webgpu.',
    '                          webgl2 also removes navigator.gpu from the page before any',
    "                          script runs, so the app's own capability probe takes the",
    '                          fallback. The page-reported backend is asserted against it.',
    '  --quality <ultra|high|medium|safe>  Quality tier. Default ultra.',
    '                          Dispatched after load as the development-only',
    '                          compute-atlas:dev-quality CustomEvent.',
    '  --sizes <list>          Comma-separated <WxH>. Default 1920x1080,2560x1440',
    '  --name-prefix <text>    File name prefix. Default stage356',
    '                          Names look like <prefix>-<backend>-<quality>-<WxH>-<stage>.png',
    '  --thumb <WxH|none>      Downscaled idle frame via CDP clip.scale. Default 480x270',
    '',
    'Evidence flags:',
    '  --scroll-steps <list>   Whole percentages of the page scroll story to capture.',
    '                          Default 0,25,50,75,100. Duplicates are dropped.',
    '                          Files: <prefix>-...-scroll-<NN>.png (NN zero-padded).',
    '                          The achieved progress is read back from the page and printed.',
    '  --reverse               After reaching the last step, walk the list back to 0 and',
    '                          capture those frames too, as ...-reverse-<NN>.png',
    '  --drag                  Run the drag sequence per size and write four files:',
    '                          drag-before, drag-during (button held), drag-after, and',
    '                          drag-mask (absolute luminance difference, before vs during).',
    '                          Fails with drag-not-visible below --changed-min percent.',
    '  --drag-steps <n>        mouseMoved events along the drag path. Default 12',
    '  --park <x,y>            Where the pointer is parked. Percentages allowed. Default 50%,94%',
    '  --changed-threshold <n> Delta above which a pixel counts as changed. Default 8 (of 255)',
    '  --changed-min <pct>     Minimum changed-pixel percentage for a visible drag. Default 0.3',
    '',
    'Capture flags:',
    '  --reduced-motion        Emulate prefers-reduced-motion: reduce before navigation',
    '  --text-hidden           Hide the masthead, status caption and boot overlay so the',
    '                          frame can be judged as an image. Applied to every capture.',
    '',
    'Browser flags:',
    '  --browser <path>        Explicit Chrome/Edge executable (else auto-discovered)',
    '  --port <n>              Remote debugging port. 0 picks one automatically. Default 0',
    '  --chrome-arg <flag>     Extra Chrome flag. Repeatable',
    '  --keep-profile          Keep the temp user-data-dir (debugging only)',
    '',
    'Wait and tolerance flags:',
    '  --settle-ms <ms>        Delay after input and before sampling. Default 350',
    '  --ready-timeout-ms <ms> Readiness deadline. Default 60000',
    '  --stability-timeout-ms <ms>  Per-frame stability deadline. Default 12000',
    '  --stable-frames <n>     Consecutive stable frames required. Default 3',
    '  --stability-threshold <n>  Max mean luminance delta per 16x16 cell. Default 4',
    '  --min-spread <n>        Minimum luminance spread for an acceptable frame. Default 10',
    '  --min-lit <0..1>        Minimum fraction of lit pixels. Default 0.01',
    '  --min-mean <0..255>     Minimum mean luminance; near-black is never accepted. Default 4',
    '  --command-timeout <ms>  Per-CDP-command timeout. Default 30000',
    '',
    'Failure handling:',
    '  --allow-console-error <regex>  Treat matching console errors as warnings. Repeatable',
    '  --lenient               Downgrade console errors to warnings (fatals still fail)',
    '',
    'Diagnostics:',
    '  --dry-run               Print the resolved matrix and exit without a browser',
    '  --verbose               Print every console message and CDP detail',
    '  --help, -h              Show this help',
    '',
    'Exit codes: 0 success, 1 capture/readiness/interaction/drag failure,',
    '            2 usage error, 3 the app could not be reached.',
    '',
    'Examples:',
    '  node scripts/stage356-capture.mjs --backend webgpu --quality ultra',
    '',
    '  node scripts/stage356-capture.mjs --backend webgl2 --reduced-motion --drag \\',
    '    --sizes 1920x1080 --scroll-steps 0,50,100 --reverse',
    '',
    '  node scripts/stage356-capture.mjs --dry-run --drag --text-hidden',
    '',
    'Readiness is a contract, not a sleep: the DOM must report a sized canvas and a',
    'started renderer, and successive frames must be stable, non-uniform and not',
    'near-black before the first file is written.',
  ];
  console.log(lines.join('\n'));
}

function printPlan(plan, options, browserPath) {
  console.log('stage356-capture plan (dry run)');
  console.log(`  base url      : ${options.baseUrl}`);
  console.log(`  capture url   : ${plan.url}`);
  console.log(`  out dir       : ${options.outDir}`);
  console.log(`  browser       : ${browserPath}`);
  console.log(`  backend       : ${options.backend}${options.backend === 'webgl2' ? ' (navigator.gpu shadowed before document start)' : ''}`);
  console.log(`  quality       : ${options.quality} (dispatched as compute-atlas:dev-quality after load)`);
  console.log(`  viewports     : ${plan.sizes.map((size) => size.label).join(', ')}`);
  console.log(`  scroll steps  : ${plan.scrollSteps.map((step) => `${step}%`).join(', ')}`);
  console.log(
    `  reverse       : ${options.reverse ? `${plan.reverseSteps.map((step) => `${step}%`).join(', ')} (walking back to 0)` : 'off'}`,
  );
  console.log(`  drag          : ${options.drag ? `on, ${options.dragSteps} moves, floor ${options.changedMinPercent}% changed pixels` : 'off'}`);
  console.log(`  thumbnail     : ${options.thumb ? options.thumb.label : 'none'}`);
  console.log(`  text hidden   : ${options.textHidden ? 'yes (masthead, status, boot overlay)' : 'no'}`);
  console.log(`  reduced motion: ${options.reducedMotion ? 'yes (prefers-reduced-motion: reduce)' : 'no'}`);
  console.log(`  settle        : ${options.settleMs} ms, stable frames ${options.stableFrames}, threshold ${options.stabilityThreshold}`);
  console.log(`  readiness     : ${options.readyTimeoutMs} ms, stability ${options.stabilityTimeoutMs} ms, min mean ${options.minMean}`);
  console.log('');
  console.log(`  files to write: ${plan.files.length}`);
  for (const file of plan.files) {
    console.log(`    - ${file.size.label.padEnd(10)} ${file.name.padEnd(56)} ${file.description}`);
  }
  return EXIT_SUCCESS;
}

// ---------------------------------------------------------------------------
// Shutdown and launch
// ---------------------------------------------------------------------------

function createShutdown(browserState) {
  let finished = false;

  return async function shutdown({ silent = false } = {}) {
    if (finished) return;
    finished = true;

    if (browserState.client) {
      try {
        await browserState.client.send('Browser.close');
      } catch {
        // The browser may already be gone; the kill below is the safety net.
      }
      browserState.client.close();
    }

    if (browserState.child && browserState.child.exitCode === null) {
      killProcessTree(browserState.child.pid);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (browserState.child.exitCode !== null) break;
        await delay(150);
      }
      if (browserState.child.exitCode === null) {
        killProcessTree(browserState.child.pid);
        await delay(300);
      }
    }

    if (browserState.profileDir && !browserState.keepProfile) {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          await rm(browserState.profileDir, { recursive: true, force: true });
          break;
        } catch {
          await delay(250);
        }
      }
      if (!silent && existsSync(browserState.profileDir)) {
        console.warn(`  note: the temp profile ${browserState.profileDir} could not be removed`);
      }
    }

    globalThis.__stage356BrowserPid = null;
  };
}

async function launchBrowser(options) {
  const executable = findBrowserExecutable(options.browserPath);
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'stage356-capture-'));
  const requestedPort = options.port > 0 ? options.port : 0;
  const stderr = createLineCollector();
  const stdout = createLineCollector(20);

  const { child, piped } = spawnBrowser(
    executable,
    buildBrowserArgs(options, profileDir, requestedPort),
  );
  // Read by the synchronous signal/"exit" handler, so a crash cannot orphan it.
  globalThis.__stage356BrowserPid = child.pid;

  const state = {
    child,
    profileDir,
    client: null,
    keepProfile: options.keepProfile,
    executable,
    pid: child.pid,
    piped,
  };
  if (piped) {
    child.stdout?.on('data', (chunk) => stdout.push(chunk));
    child.stderr?.on('data', (chunk) => stderr.push(chunk));
  }
  child.on('error', () => {
    // Surfaced by the DevTools port wait below with the collected stderr tail.
  });

  if (!options.keepProfile) {
    state.watchdogArmed = startOrphanWatchdog(profileDir, child.pid);
    if (!state.watchdogArmed && options.verbose) {
      console.log('  [verbose] orphan watchdog was not armed; cleanup relies on this process');
    }
  }

  try {
    const deadline = Date.now() + 30_000;
    const isAlive = () => child.exitCode === null && !child.killed;

    let port = requestedPort;
    if (port === 0) {
      port = await readDevToolsPort(profileDir, deadline, isAlive);
    }

    const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    const wsUrl = version.webSocketDebuggerUrl;
    if (!wsUrl) {
      throw new ConnectionError('The browser did not expose a DevTools websocket URL');
    }

    const client = await CdpClient.connect(wsUrl, options.commandTimeoutMs);
    state.client = client;

    return { state, client, port, version, executable, stderr, stdout, profileDir, piped };
  } catch (error) {
    // Never leave a half-launched browser or its profile behind.
    const tail = stderr.lines();
    if (tail.length > 0) {
      console.error('  browser stderr (tail):');
      for (const line of tail) console.error(`    | ${line}`);
    }
    killProcessTree(child.pid);
    await delay(400);
    killProcessTree(child.pid);
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
    globalThis.__stage356BrowserPid = null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function runCapture(options) {
  const plan = resolvePlan(options);

  const preflight = await preflightBaseUrl(options.baseUrl);

  const browser = await launchBrowser(options);
  const shutdown = createShutdown(browser.state);
  const collector = createConsoleCollector({
    allowPatterns: options.allowConsoleErrorPatterns,
    onEntry: options.verbose
      ? (entry) => console.log(`  [console/${entry.severity}] ${entry.text}`)
      : (entry) => {
          if (entry.severity === 'fatal' || entry.severity === 'error') {
            console.error(`  [console/${entry.severity}] ${entry.text}`);
          }
        },
  });

  // Declared before `context` because `context.backendLabel` closes over them,
  // and the file names are written with the *reported* backend rather than the
  // requested one — a `--backend webgl2` run that silently landed on WebGPU
  // would otherwise name its frames for a backend they did not come from.
  let reportedBackend = null;
  let pageQuality = null;

  const context = {
    captures: [],
    failures: [],
    scrollReports: [],
    dragReports: [],
    backendLabel: () => reportedBackend ?? options.backend,
  };
  const { captures, failures } = context;

  try {
    const attached = await attachPageSession(browser.client);
    const { sessionId } = attached;
    collector.attach(browser.client, sessionId);

    for (const domain of ['Page.enable', 'Runtime.enable', 'Log.enable']) {
      try {
        await browser.client.send(domain, {}, sessionId);
      } catch (error) {
        if (domain !== 'Log.enable') throw error;
      }
    }

    if (options.reducedMotion) {
      await applyReducedMotion(browser.client, sessionId, true);
    }

    // A WebGL2 run has to actually reach the fallback, not merely request it.
    if (options.backend === 'webgl2') {
      await hideWebGpu(browser.client, sessionId);
    }

    await applyViewport(browser.client, sessionId, plan.sizes[0]);
    await navigate(browser.client, sessionId, plan.url, options.readyTimeoutMs);

    console.log(`Capturing ${plan.url}`);
    console.log(`  browser : ${browser.executable} (${browser.version.Browser ?? 'unknown'})`);
    console.log(`  endpoint: 127.0.0.1:${browser.port}`);
    console.log(`  out dir : ${options.outDir}`);
    if (!browser.piped) {
      console.log(
        '  note    : browser stdio could not be piped in this environment (EPERM on spawn); browser log is unavailable',
      );
    }

    await mkdir(options.outDir, { recursive: true });

    const initialReady = await waitForStableFrame(browser.client, sessionId, options, {
      requireProbe: true,
    });
    if (!initialReady.ok) {
      failures.push({
        kind: 'readiness',
        text: `The scene never reported ready: ${initialReady.reason}`,
      });
      // Nothing after this point can produce evidence: every frame the matrix
      // would write is a frame of a scene that never started, and a near-black
      // hero shot filed next to real ones is worse than no hero shot. So the
      // matrix is abandoned — but the run still reports, still tears the
      // browser down, and still exits non-zero, because a harness that dies
      // before its summary is a harness whose failure nobody can read.
      throw new ReadinessAbort(initialReady.reason);
    }

    // The dev build exposes a dev-only quality channel, and it is mounted after
    // the first paint, so the request is sent once the scene already runs.
    await evaluate(
      browser.client,
      sessionId,
      `(() => { window.dispatchEvent(new CustomEvent('compute-atlas:dev-quality', { detail: ${JSON.stringify(options.quality)} })); return true; })()`,
    ).catch((error) => {
      if (options.verbose) console.log(`  [verbose] quality dispatch: ${error.message}`);
    });

    const ready = await waitForStableFrame(browser.client, sessionId, options, {
      requireProbe: true,
    });
    if (!ready.ok) {
      failures.push({
        kind: 'readiness',
        text: `The scene never reported ready after the quality request: ${ready.reason}`,
      });
    }

    const probe = ready.probe ?? initialReady.probe ?? null;
    if (probe?.label) {
      reportedBackend = probe.backend ?? null;
      pageQuality = probe.quality ?? null;
    }
    console.log(
      `  status  : ${probe?.label ?? 'unknown'}${pageQuality ? ` | ${pageQuality}` : ''} (after ${ready.attempts} readiness samples)`,
    );

    if (reportedBackend !== null && reportedBackend !== options.backend) {
      failures.push({
        kind: 'backend',
        text: `Requested --backend ${options.backend} but the page reported ${reportedBackend} (${probe?.label ?? 'no status'}).`,
      });
    }
    if (pageQuality && !pageQuality.toUpperCase().includes(options.quality.toUpperCase())) {
      console.warn(
        `  warning: requested quality ${options.quality} but the page reports ${pageQuality}; the dev quality channel is development-only.`,
      );
    }

    if (options.textHidden) {
      const mode = await setTextHidden(browser.client, sessionId, true);
      console.log(
        `  overlay : text hidden (${mode?.hidden ?? 0} layer(s) matched), applied to every capture`,
      );
      await delay(options.settleMs);
    }

    for (const size of plan.sizes) {
      console.log('');
      console.log(`--- ${size.label} ---`);
      await applyViewport(browser.client, sessionId, size);
      await delay(options.settleMs);

      // (1) idle — the hero frame. Scroll reset, pointer parked: this is the
      // frame every other family is read against, so it has to be the resting
      // composition and not wherever the previous size left the page.
      const park = resolvePoint(options.park, size);
      await scrollToProgress(browser.client, sessionId, 0);
      await dispatchMouse(browser.client, sessionId, 'mouseMoved', park);
      await delay(options.settleMs);

      const idle = await captureEvidence(browser.client, sessionId, options, context, {
        size,
        stage: 'idle',
        input: `no input, scroll reset, pointer parked at ${park.x},${park.y}`,
      });

      if (idle.ok && options.thumb) {
        const thumbnail = await captureThumbnail(browser.client, sessionId, size, options.thumb);
        const thumbImage = decodePng(thumbnail.png);
        const thumbName = formatCaptureName({
          prefix: options.namePrefix,
          backend: context.backendLabel(),
          quality: options.quality,
          sizeLabel: size.label,
          stage: 'idle',
          suffix: `-thumb-${options.thumb.label}`,
        });
        const thumbPath = path.join(options.outDir, thumbName);
        await writeFile(thumbPath, thumbnail.png);
        captures.push({
          name: thumbName,
          filePath: thumbPath,
          size: `${thumbImage.width}x${thumbImage.height}`,
          stage: 'idle-thumb',
          input: `clip.scale ${thumbnail.scale.toFixed(4)}`,
          bytes: thumbnail.png.length,
        });
        console.log(
          `  ${thumbName}  ${thumbImage.width}x${thumbImage.height}  ${(thumbnail.png.length / 1024).toFixed(0)} KiB  [clip.scale ${thumbnail.scale.toFixed(4)}]`,
        );
        if (Math.abs(thumbImage.width - options.thumb.width) > 1) {
          console.warn(
            `  warning: thumbnail width ${thumbImage.width} does not match the requested ${options.thumb.width}`,
          );
        }
      } else if (!idle.ok) {
        console.log(`  SKIPPED thumbnail for ${size.label}: the idle frame was not captured`);
      }

      // (2) scroll keyframes.
      for (const step of plan.scrollSteps) {
        await captureScrollStep(browser.client, sessionId, options, context, {
          size,
          step,
          stage: `scroll-${padScrollStep(step)}`,
          reverse: false,
        });
      }

      // (2b) the return pass.
      for (const step of plan.reverseSteps) {
        await captureScrollStep(browser.client, sessionId, options, context, {
          size,
          step,
          stage: `reverse-${padScrollStep(step)}`,
          reverse: true,
        });
      }

      // (3) drag evidence.
      if (options.drag) {
        await runDragSequence(browser.client, sessionId, options, context, size);
      }
    }
  } catch (error) {
    if (!(error instanceof ReadinessAbort)) throw error;
    console.error(`  readiness aborted the matrix: ${error.message}`);
  } finally {
    const wantLogs =
      browser.piped && (options.verbose || context.failures.length > 0 || options.keepProfile);
    const logLines = wantLogs ? browser.stderr.lines() : [];
    const outLines = browser.piped && options.verbose ? browser.stdout.lines() : [];
    await shutdown();
    if (logLines.length > 0) {
      console.log('  browser stderr (tail):');
      for (const line of logLines) console.log(`    | ${line}`);
    }
    if (outLines.length > 0) {
      console.log('  browser stdout (tail):');
      for (const line of outLines) console.log(`    | ${line}`);
    }
    if (options.keepProfile) {
      console.log(`  temp profile kept at ${browser.profileDir}`);
    }
  }

  const consoleSummary = collector.summary();
  if (!options.lenient) {
    for (const entry of consoleSummary.errors) {
      failures.push({ kind: 'console-error', text: entry.text });
    }
  } else if (consoleSummary.errors.length > 0) {
    console.warn(`  warning: ${consoleSummary.errors.length} console error(s) tolerated by --lenient`);
  }
  for (const entry of consoleSummary.fatals) {
    failures.push({ kind: `fatal:${entry.reason}`, text: entry.text });
  }

  if (options.verbose) {
    for (const entry of collector.entries) {
      console.log(`  [console/${entry.severity}] ${entry.text}`);
    }
  }

  console.log('');
  console.log('capture summary');
  console.log(`  url            : ${plan.url}`);
  console.log(`  browser        : ${browser.executable}`);
  console.log(`  backend        : ${context.backendLabel()} (requested ${options.backend})`);
  console.log(`  quality        : ${options.quality}${pageQuality ? ` - page reports ${pageQuality}` : ''}`);
  console.log(`  reduced motion : ${options.reducedMotion ? 'emulated' : 'no'}`);
  console.log(`  text hidden    : ${options.textHidden ? 'yes' : 'no'}`);
  console.log(`  viewports      : ${plan.sizes.map((size) => size.label).join(', ')}`);
  console.log(`  preflight      : HTTP ${preflight.status} in ${preflight.durationMs} ms`);
  console.log(`  files written  : ${captures.length}`);
  for (const capture of captures) {
    console.log(`    - ${capture.name} (${capture.size}, ${(capture.bytes / 1024).toFixed(0)} KiB)`);
  }

  if (context.scrollReports.length > 0) {
    const worst = context.scrollReports.reduce(
      (most, report) => Math.max(most, Math.abs(report.achieved - report.requested)),
      0,
    );
    const storyless = context.scrollReports.filter((report) => report.maxScroll <= 0).length;
    console.log(
      `  scroll story   : ${storyless === context.scrollReports.length ? 'NONE - the document has no scrollable height' : `${storyless} of ${context.scrollReports.length} step(s) on a non-scrollable document`}`,
    );
    console.log(`  scroll drift   : ${formatPercent(worst)} worst requested-vs-achieved gap`);
    for (const report of context.scrollReports) {
      console.log(
        `    - ${report.size.padEnd(10)} ${report.stage.padEnd(14)} requested ${formatPercent(report.requested).padStart(7)} -> achieved ${formatPercent(report.achieved).padStart(7)}  (y ${report.y} of ${report.maxScroll} px, scrollHeight ${report.scrollHeight}, viewport ${report.viewport})`,
      );
    }
  }

  if (context.dragReports.length > 0) {
    console.log('  drag evidence  :');
    for (const report of context.dragReports) {
      console.log(
        `    - ${report.size}: ${report.changedPercent.toFixed(3)}% of pixels changed (${report.changedPixels.toLocaleString('en-US')} of ${report.totalPixels.toLocaleString('en-US')}), mean delta ${report.meanDelta.toFixed(2)}, max ${report.maxDelta}/255`,
      );
      console.log(`      ${report.before} -> ${report.during} (mask ${report.mask})`);
    }
  }

  console.log(
    `  console        : ${consoleSummary.total} message(s) - info ${consoleSummary.counts.info}, warning ${consoleSummary.counts.warning}, error ${consoleSummary.counts.error}, fatal ${consoleSummary.counts.fatal}`,
  );
  for (const entry of consoleSummary.warnings.slice(0, 8)) {
    console.log(`    ~ ${entry.text.slice(0, 160)}`);
  }
  if (consoleSummary.warnings.length > 8) {
    console.log(`    ~ ... ${consoleSummary.warnings.length - 8} more warning(s), use --verbose`);
  }

  const hardFailures = failures.filter((failure) => failure.warnOnly !== true);
  const warnings = failures.filter((failure) => failure.warnOnly === true);
  for (const warning of warnings) {
    console.warn(`  warning: [${warning.kind}] ${warning.text}`);
  }

  if (hardFailures.length > 0) {
    console.error('');
    console.error(`FAILED - ${hardFailures.length} problem(s):`);
    for (const failure of hardFailures) {
      console.error(`  [${failure.kind}] ${failure.text.slice(0, 600)}`);
    }
    return EXIT_FAILURE;
  }

  console.log('OK - all captures written, no fatal console output.');
  return EXIT_SUCCESS;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`stage356-capture: ${error.message}`);
      console.error('Run with --help to list the options.');
      return EXIT_USAGE;
    }
    throw error;
  }

  if (parsed.help) {
    printHelp();
    return EXIT_SUCCESS;
  }

  const options = parsed.options;

  try {
    if (options.dryRun) {
      const plan = resolvePlan(options);
      const browserPath = findBrowserExecutable(options.browserPath);
      return printPlan(plan, options, browserPath);
    }
    return await runCapture(options);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`stage356-capture: ${error.message}`);
      return EXIT_USAGE;
    }
    if (error instanceof ConnectionError) {
      console.error(`stage356-capture: ${error.message}`);
      return EXIT_CONNECTION;
    }
    console.error(`stage356-capture failed: ${error?.stack ?? error}`);
    return EXIT_FAILURE;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const emergencyKill = () => {
    // Last-resort synchronous cleanup so Ctrl-C never leaves an orphan browser.
    const pid = globalThis.__stage356BrowserPid;
    if (Number.isInteger(pid)) killProcessTree(pid, { synchronous: true });
  };
  process.on('exit', emergencyKill);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.on(signal, () => {
      console.error(`\nstage356-capture: received ${signal}, cleaning up...`);
      emergencyKill();
      process.exit(130);
    });
  }

  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`stage356-capture failed: ${error?.stack ?? error}`);
      process.exitCode = EXIT_FAILURE;
    });
}
