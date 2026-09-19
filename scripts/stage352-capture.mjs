#!/usr/bin/env node
/**
 * Stage 3.5.2 screenshot capture harness — zero npm dependencies.
 *
 * Drives an already-installed Chrome/Edge over the Chrome DevTools Protocol
 * using Node's built-in global `WebSocket` and `fetch`. Nothing is installed,
 * imported from `node_modules`, or written to `package.json`. The temporary
 * browser profile is created under the OS temp directory and removed again on
 * success, failure and Ctrl-C, so the repository never accumulates local junk.
 *
 * What it does
 *   1. Launches the browser headless (new headless mode) with a temp profile
 *      and GPU-flavoured flags for both the WebGPU backend and the WebGL2 fallback.
 *   2. Reads the DevTools endpoint and attaches to a page target (flatten mode).
 *   3. Navigates to the URL and waits for the scene to be *actually* ready:
 *      a DOM readiness probe plus successive screenshot frames that are both
 *      stable and non-uniform in luminance. A near-black frame is never accepted.
 *   4. Drives real interaction states through CDP input events
 *      (`Input.dispatchMouseEvent` for hover/click, `Input.dispatchKeyEvent` for Escape).
 *   5. Captures explicit viewport sizes through `Emulation.setDeviceMetricsOverride`.
 *   6. Produces a ~480x270 downscale with CDP `clip.scale`, so the real frame is
 *      downscaled rather than re-rendered.
 *   7. Supports a reduced-motion pass via `Emulation.setEmulatedMedia`
 *      (`prefers-reduced-motion: reduce`) applied before navigation.
 *   8. Collects `Runtime.consoleAPICalled`, `Runtime.exceptionThrown` and
 *      `Log.entryAdded`, and exits non-zero on uncaught exceptions, `NaN`,
 *      invalid/negative buffer sizes, WebGPU validation errors or (unless
 *      allowlisted) console errors.
 *
 * URL contract used by the app under test
 *   ?boot=skip     skip the boot animation
 *   ?telemetry=1   log renderer telemetry to the console
 *
 * Exit codes
 *   0  every capture was written and no fatal console output was seen
 *   1  capture/readiness failure, or fatal console output
 *   2  usage error (unknown flag, unparsable value, empty matrix)
 *   3  the app under test could not be reached or could not be navigated to
 *
 * Examples
 *   # Full matrix for one backend
 *   node scripts/stage352-capture.mjs --base-url http://localhost:3000 \
 *     --out artifacts --backend webgpu --quality ultra \
 *     --sizes 1920x1080,2560x1440 \
 *     --states overview,hover-graphics,focus-graphics,escape \
 *     --coords graphics=1180,640
 *
 *   # Same matrix for the WebGL2 fallback, reduced motion, with a thumbnail
 *   node scripts/stage352-capture.mjs --backend webgl2 --quality ultra \
 *     --states overview,hover-graphics,focus-graphics,escape \
 *     --coords graphics=1180,640 --reduced-motion --thumb 480x270
 *
 *   # Validate the resolved matrix without launching a browser
 *   node scripts/stage352-capture.mjs --dry-run --backend webgpu \
 *     --states overview,hover-graphics,focus-graphics,escape
 *
 * Run `node scripts/stage352-capture.mjs --help` for the full flag list.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_OUT_DIR = 'artifacts';
const DEFAULT_SIZES = '1920x1080,2560x1440';
const DEFAULT_STATES = 'overview';
const DEFAULT_POINT = '960,540';
const DEFAULT_THUMB = '480x270';
const DEFAULT_THUMB_STATE = 'overview';
const DEFAULT_NAME_PREFIX = 'stage352';
const DEFAULT_READY_TIMEOUT_MS = 60_000;
const DEFAULT_STABLE_FRAMES = 3;
const DEFAULT_STABILITY_THRESHOLD = 4;
const DEFAULT_SETTLE_MS = 350;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_MIN_SPREAD = 10;
const DEFAULT_MIN_LIT_FRACTION = 0.01;
const DEFAULT_GRID = 16;
const DEFAULT_PARK_POINT = '4,4';

/** Readiness expression: the app is done booting when its status stops saying so. */
const DEFAULT_READY_EXPRESSION = `(() => {
  const canvas = document.querySelector('canvas');
  if (!canvas) return { ready: false, reason: 'no-canvas' };
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    return { ready: false, reason: 'canvas-not-laid-out' };
  }
  const labelNode = document.querySelector('.renderer-status__label');
  const label = labelNode ? labelNode.textContent.trim() : null;
  if (label && /INITIALIZING|DEGRADED|UNAVAILABLE/i.test(label)) {
    return { ready: false, reason: 'status:' + label, label };
  }
  const qualityNode = document.querySelector('.renderer-status__quality');
  return {
    ready: true,
    reason: label ? 'status:' + label : 'canvas-present',
    label,
    quality: qualityNode ? qualityNode.textContent.replace(/\\s+/g, ' ').trim() : null,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    drawingWidth: canvas.width,
    drawingHeight: canvas.height,
  };
})()`;

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
  'keep-profile',
  'lenient',
  'preflight',
  'allow-unready',
  'browser-log',
]);

const REPEATABLE_FLAGS = new Set(['chrome-arg', 'allow-console-error']);

const VALUE_FLAGS = new Set([
  'base-url',
  'out',
  'backend',
  'quality',
  'sizes',
  'states',
  'point',
  'park',
  'coords',
  'thumb',
  'thumb-state',
  'name-prefix',
  'dsf',
  'boot',
  'telemetry',
  'query',
  'browser',
  'port',
  'gpu',
  'ready-timeout',
  'stable-frames',
  'stability-threshold',
  'settle-ms',
  'command-timeout',
  'min-spread',
  'min-lit',
  'ready-expression',
]);

const STATE_VERBS = new Set(['hover', 'focus', 'click', 'press', 'escape']);

export class UsageError extends Error {}
export class ConnectionError extends Error {}

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
    let name = equalsAt === -1 ? token.slice(2) : token.slice(2, equalsAt);
    let inlineValue = equalsAt === -1 ? undefined : token.slice(equalsAt + 1);
    let enabled = true;

    if (name.startsWith('no-') && BOOLEAN_FLAGS.has(name.slice(3))) {
      name = name.slice(3);
      enabled = false;
    }

    if (BOOLEAN_FLAGS.has(name)) {
      if (inlineValue !== undefined) {
        throw new UsageError(`--${name} is a boolean flag and takes no value`);
      }
      raw[name] = enabled;
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

  const backend = raw.backend ?? 'auto';
  if (!['auto', 'webgpu', 'webgl2'].includes(backend)) {
    throw new UsageError(`--backend must be auto, webgpu or webgl2 (received "${backend}")`);
  }

  const quality = raw.quality ?? 'ultra';
  if (!['ultra', 'high', 'medium', 'safe'].includes(quality)) {
    throw new UsageError(
      `--quality must be ultra, high, medium or safe (received "${quality}")`,
    );
  }

  const boot = raw.boot ?? 'skip';
  if (!['skip', 'full'].includes(boot)) {
    throw new UsageError(`--boot must be skip or full (received "${boot}")`);
  }

  const telemetry = raw.telemetry ?? '1';
  if (!['0', '1'].includes(telemetry)) {
    throw new UsageError(`--telemetry must be 0 or 1 (received "${telemetry}")`);
  }

  const gpu = raw.gpu ?? 'auto';
  if (!['auto', 'hardware', 'swiftshader', 'disabled'].includes(gpu)) {
    throw new UsageError(
      `--gpu must be auto, hardware, swiftshader or disabled (received "${gpu}")`,
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

  return {
    help: false,
    options: {
      baseUrl,
      outDir: path.resolve(PROJECT_ROOT, raw.out ?? DEFAULT_OUT_DIR),
      outDirLabel: raw.out ?? DEFAULT_OUT_DIR,
      backend,
      quality,
      sizes: parseSizeList(raw.sizes ?? DEFAULT_SIZES),
      states: parseStateList(raw.states ?? DEFAULT_STATES),
      point: raw.point ?? DEFAULT_POINT,
      park: raw.park ?? DEFAULT_PARK_POINT,
      coords: parseCoordinateMap(raw.coords),
      thumb: thumb === 'none' ? null : parseSize(thumb, '--thumb'),
      thumbState: raw['thumb-state'] ?? DEFAULT_THUMB_STATE,
      namePrefix: raw['name-prefix'] ?? DEFAULT_NAME_PREFIX,
      deviceScaleFactor: parseNumber(raw.dsf, {
        name: 'dsf',
        min: 0.25,
        max: 4,
        fallback: 1,
      }),
      boot,
      telemetry,
      query: raw.query ?? '',
      browserPath: raw.browser ? path.resolve(raw.browser) : null,
      port: parseInteger(raw.port, { name: 'port', min: 0, max: 65535, fallback: 0 }),
      gpu,
      readyTimeoutMs: parseInteger(raw['ready-timeout'], {
        name: 'ready-timeout',
        min: 1000,
        fallback: DEFAULT_READY_TIMEOUT_MS,
      }),
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
      settleMs: parseInteger(raw['settle-ms'], {
        name: 'settle-ms',
        min: 0,
        fallback: DEFAULT_SETTLE_MS,
      }),
      commandTimeoutMs: parseInteger(raw['command-timeout'], {
        name: 'command-timeout',
        min: 1000,
        fallback: DEFAULT_COMMAND_TIMEOUT_MS,
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
      extraChromeArgs: repeatable['chrome-arg'],
      allowConsoleErrorPatterns: repeatable['allow-console-error'],
      readyExpression: raw['ready-expression'] ?? DEFAULT_READY_EXPRESSION,
      dryRun: raw['dry-run'] === true,
      verbose: raw.verbose === true,
      reducedMotion: raw['reduced-motion'] === true,
      keepProfile: raw['keep-profile'] === true,
      lenient: raw.lenient === true,
      preflight: raw.preflight !== false,
      allowUnready: raw['allow-unready'] === true,
      browserLog: raw['browser-log'] === true,
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
 * A state spec is `[<verb>-]<label>[@x,y]`, for example `overview`,
 * `hover-graphics@1180,640`, `focus-graphics` or `escape`. The verb decides the
 * CDP input that is dispatched; the label only shapes the output file name.
 */
export function parseStateSpec(spec) {
  const trimmed = String(spec).trim();
  if (trimmed.length === 0) {
    throw new UsageError('--states contains an empty entry');
  }

  const atIndex = trimmed.indexOf('@');
  const head = atIndex === -1 ? trimmed : trimmed.slice(0, atIndex);
  const inlinePoint = atIndex === -1 ? null : trimmed.slice(atIndex + 1);

  if (atIndex !== -1 && inlinePoint.length === 0) {
    throw new UsageError(`--states entry "${trimmed}" has an empty @coordinate`);
  }

  const dashIndex = head.indexOf('-');
  const maybeVerb = dashIndex === -1 ? head : head.slice(0, dashIndex);
  const verb = STATE_VERBS.has(maybeVerb.toLowerCase()) ? maybeVerb.toLowerCase() : null;
  const label = verb === null ? head : head.slice(dashIndex + 1);

  if (verb === 'escape') {
    return {
      spec: trimmed,
      name: sanitizeSegment('escape'),
      verb,
      label: sanitizeSegment(label.length > 0 ? label : 'escape'),
      kind: 'escape',
      inlinePoint,
      resetsFocus: false,
    };
  }

  if (verb === null) {
    return {
      spec: trimmed,
      name: sanitizeSegment(head),
      verb: 'overview',
      label: sanitizeSegment(head),
      kind: 'none',
      inlinePoint,
      resetsFocus: true,
    };
  }

  if (label.length === 0) {
    throw new UsageError(`--states entry "${trimmed}" is missing a label after "${verb}-"`);
  }

  return {
    spec: trimmed,
    name: sanitizeSegment(head),
    verb,
    label: sanitizeSegment(label),
    kind: verb === 'hover' ? 'hover' : 'click',
    inlinePoint,
    resetsFocus: true,
  };
}

const COORDINATE_FRAGMENT = /^-?\d+(\.\d+)?%?$/;

function parseStateList(value) {
  // Coordinates contain a comma of their own, so a non-coordinate token that
  // follows one with an "@" is a continuation: hover-ai@30%,40%,escape.
  const entries = [];
  for (const token of String(value).split(',')) {
    const trimmed = token.trim();
    if (trimmed.length === 0) continue;
    const previous = entries[entries.length - 1];
    const continuesCoordinates =
      previous !== undefined &&
      previous.includes('@') &&
      !trimmed.includes('@') &&
      COORDINATE_FRAGMENT.test(trimmed);
    if (continuesCoordinates) entries[entries.length - 1] = `${previous},${trimmed}`;
    else entries.push(trimmed);
  }

  const states = entries.map((entry) => parseStateSpec(entry));
  if (states.length === 0) {
    throw new UsageError('--states needs at least one entry');
  }
  return states;
}

function parseCoordinateMap(value) {
  const map = new Map();
  if (value === undefined) return map;

  // Coordinates contain a comma themselves, so a token containing "=" starts a
  // new entry and the tokens after it belong to that entry: a=1,2,b=3,4.
  const entries = [];
  for (const token of String(value).split(',')) {
    const trimmed = token.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.includes('=')) entries.push(trimmed);
    else if (entries.length > 0) entries[entries.length - 1] += `,${trimmed}`;
    else {
      throw new UsageError(`--coords entries look like label=x,y (received "${trimmed}")`);
    }
  }

  for (const entry of entries) {
    const equalsAt = entry.indexOf('=');
    if (equalsAt <= 0 || equalsAt === entry.length - 1) {
      throw new UsageError(`--coords entries look like label=x,y (received "${entry}")`);
    }
    map.set(sanitizeSegment(entry.slice(0, equalsAt)), entry.slice(equalsAt + 1).trim());
  }
  return map;
}

/** Resolves `x,y`, `%` relative or fractional values against a viewport. */
export function resolvePoint(raw, viewport, sourceName) {
  const parts = String(raw).split(',');
  if (parts.length !== 2) {
    throw new UsageError(`${sourceName} expects "x,y" (received "${raw}")`);
  }

  const axis = (part, extent) => {
    const text = part.trim();
    if (/^-?\d+(\.\d+)?%$/.test(text)) {
      const ratio = Number(text.slice(0, -1)) / 100;
      return Math.round(ratio * extent);
    }
    const value = Number(text);
    if (!Number.isFinite(value)) {
      throw new UsageError(`${sourceName} expects numbers (received "${raw}")`);
    }
    return Math.round(value);
  };

  return {
    x: axis(parts[0], viewport.width),
    y: axis(parts[1], viewport.height),
  };
}

function resolveStatePoint(state, options, viewport) {
  const { width, height } = viewport;
  const clamp = (point) => ({
    x: Math.min(Math.max(point.x, 0), width - 1),
    y: Math.min(Math.max(point.y, 0), height - 1),
  });

  if (state.inlinePoint !== null) {
    return {
      ...clamp(resolvePoint(state.inlinePoint, viewport, `state "${state.spec}"`)),
      source: `inline @${state.inlinePoint}`,
    };
  }
  const byLabel = options.coords.get(state.label);
  if (byLabel !== undefined) {
    return {
      ...clamp(resolvePoint(byLabel, viewport, `--coords ${state.label}`)),
      source: `--coords ${state.label}`,
    };
  }
  const bySpec = options.coords.get(state.name);
  if (bySpec !== undefined) {
    return {
      ...clamp(resolvePoint(bySpec, viewport, `--coords ${state.name}`)),
      source: `--coords ${state.name}`,
    };
  }
  return {
    ...clamp(resolvePoint(options.point, viewport, '--point')),
    source: `--point ${options.point}`,
  };
}

export function buildCaptureUrl(options) {
  const search = new URLSearchParams();
  search.set('boot', options.boot);
  if (options.telemetry === '1') {
    search.set('telemetry', '1');
  }
  const extra = String(options.query).trim().replace(/^[?&]+/, '');
  if (extra.length > 0) {
    const extraParams = new URLSearchParams(extra);
    for (const [key, value] of extraParams) {
      search.set(key, value);
    }
  }
  return `${options.baseUrl}/?${search.toString()}`;
}

export function formatCaptureName({
  prefix,
  backend,
  quality,
  sizeLabel,
  stateName,
  reducedMotion,
  suffix = '',
}) {
  return [
    sanitizeSegment(prefix),
    sanitizeSegment(backend),
    sanitizeSegment(quality),
    sanitizeSegment(sizeLabel),
    stateName,
  ]
    .join('-')
    .concat(reducedMotion ? '-reduced' : '')
    .concat(suffix)
    .concat('.png');
}

export function resolvePlan(options) {
  const url = buildCaptureUrl(options);
  const jobs = [];
  for (const size of options.sizes) {
    for (const state of options.states) {
      const point =
        state.kind === 'none' || state.kind === 'escape'
          ? null
          : resolveStatePoint(state, options, size);
      jobs.push({
        size,
        state,
        point,
        isThumbSource: state.name === options.thumbState,
      });
    }
  }
  return { url, jobs, sizes: options.sizes };
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

  if (process.env.STAGE352_BROWSER && existsSync(process.env.STAGE352_BROWSER)) {
    return process.env.STAGE352_BROWSER;
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
  } else if (options.backend === 'webgl2') {
    // Belt and braces: these flags are unreliable on Windows, so `hideWebGpu`
    // also removes the API from the page before the app can probe for it.
    args.push('--disable-features=WebGPU,Vulkan');
  }

  if (options.gpu === 'swiftshader') {
    args.push('--use-angle=swiftshader', '--use-gl=angle');
  } else if (options.gpu === 'disabled') {
    args.push('--disable-gpu');
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
  const ownerFile = path.join(profileDir, 'stage352-owner.json');
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
// PNG decoding and frame analysis (no dependencies)
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

  const raw = zlib.inflateSync(Buffer.concat(idatParts));
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

/** Luminance spread and lit-pixel fraction; a flat dark frame means "not ready". */
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

// ---------------------------------------------------------------------------
// Console classification
// ---------------------------------------------------------------------------

const BENIGN_PATTERNS = [
  { id: 'react-devtools', re: /react devtools|download the react devtools/i },
  { id: 'fast-refresh', re: /\[fast refresh\]|hot reload|hmr/i },
  { id: 'three-clock', re: /three\.clock|clock:\s*.*deprecat/i },
  { id: 'shadow-remap', re: /pcfsoftshadowmap|shadow ?map.{0,30}remap/i },
  { id: 'power-preference', re: /powerpreference/i },
  { id: 'swiftshader-deprecation', re: /automatic fallback to software webgl|swiftshader/i },
  { id: 'favicon', re: /favicon\.ico/i },
  { id: 'devtools-noise', re: /devtools|autofill\.enable|preloaded using link preload/i },
];

const FATAL_PATTERNS = [
  { id: 'nan', re: /\bNaN\b/ },
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
    id: 'webgpu-validation',
    re: /(gpuvalidationerror|gpuinternalerror|gpuoutofmemoryerror|gpudevicelost|device lost|validation error|uncaptured (webgpu )?error|webgpu[^.\n]{0,40}validation)/i,
  },
  {
    id: 'renderer-abort',
    re: /(context lost|webgl: context lost|renderer process (crashed|gone)|out of memory)/i,
  },
];

/**
 * Classifies one collected message. `fatal` always fails the run; `error` fails
 * it unless `--lenient` is set. Allowlisted and known-environmental messages are
 * downgraded to `warning` so the harness stays loud without being noisy.
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

  for (const pattern of FATAL_PATTERNS) {
    if (pattern.re.test(text)) {
      return { ...base, severity: 'fatal', reason: pattern.id };
    }
  }

  for (const pattern of BENIGN_PATTERNS) {
    if (pattern.re.test(text)) {
      return { ...base, severity: 'warning', reason: pattern.id };
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
        const text = (params.args ?? []).map(formatRemoteObject).join(' ');
        record(
          { text: text.length > 0 ? text : `[${params.type}]` },
          { kind: 'console', level: params.type === 'error' ? 'error' : params.type },
        );
      });
      client.on('Runtime.exceptionThrown', (params, incoming) => {
        if (!owns(incoming)) return;
        const details = params.exceptionDetails ?? {};
        const description = details.exception?.description ?? details.text ?? 'Uncaught exception';
        record(
          { text: description },
          { kind: 'exception', level: 'error' },
        );
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

async function applyViewport(client, sessionId, size, options) {
  await client.send(
    'Emulation.setDeviceMetricsOverride',
    {
      width: size.width,
      height: size.height,
      deviceScaleFactor: options.deviceScaleFactor,
      mobile: false,
      screenWidth: size.width,
      screenHeight: size.height,
    },
    sessionId,
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
 * The app picks its backend from a capability probe, which is the honest thing
 * for it to do, so a capture run cannot ask it politely to take the fallback.
 * Chrome's `--disable-features=WebGPU` and `--disable-blink-features=WebGPU` are
 * both ignored on Windows, and the scene kept coming back as WEBGPU under a
 * `--backend webgl2` run. Shadowing the property on the navigator instance is
 * what actually simulates a machine without WebGPU, and it leaves the app's own
 * detection path untouched.
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

async function capturePng(client, sessionId, clip) {
  const params = { format: 'png', fromSurface: true, captureBeyondViewport: false };
  if (clip) params.clip = clip;
  const result = await client.send('Page.captureScreenshot', params, sessionId);
  if (!result.data) throw new Error('Page.captureScreenshot returned no data');
  return Buffer.from(result.data, 'base64');
}

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

async function dispatchEscape(client, sessionId) {
  const base = {
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27,
    modifiers: 0,
  };
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base }, sessionId);
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
}

async function applyState(client, sessionId, job, options, viewport) {
  const park = resolvePoint(options.park, viewport, '--park');

  // Park the pointer and clear focus so each state starts from a known baseline.
  // The escape state keeps the previous focus so it can prove that Escape cleared it.
  if (job.state.resetsFocus) {
    await dispatchMouse(client, sessionId, 'mouseMoved', park);
    await dispatchEscape(client, sessionId);
    await delay(Math.min(options.settleMs, 150));
  }

  if (job.state.kind === 'none') {
    return 'no-input';
  }
  if (job.state.kind === 'escape') {
    await dispatchEscape(client, sessionId);
    return 'key Escape';
  }

  // Move away first so the browser emits a real pointerover on the canvas.
  await dispatchMouse(client, sessionId, 'mouseMoved', park);
  await delay(40);
  await dispatchMouse(client, sessionId, 'mouseMoved', job.point);
  if (job.state.kind === 'hover') {
    return `mouseMoved ${job.point.x},${job.point.y} (${job.point.source})`;
  }

  await delay(job.state.verb === 'press' ? 60 : 80);
  await dispatchMouse(client, sessionId, 'mousePressed', job.point, 'left', 1);
  await delay(60);
  await dispatchMouse(client, sessionId, 'mouseReleased', job.point, 'left', 0);
  return `click ${job.point.x},${job.point.y} (${job.point.source})`;
}

/**
 * Readiness = the DOM probe says ready, the frame is not one flat colour, and
 * consecutive signatures have stopped moving for `stableFrames` samples.
 */
async function waitForReadyScene(client, sessionId, options) {
  const deadline = Date.now() + options.readyTimeoutMs;
  let previousSignature = null;
  let stableCount = 0;
  let lastProbe = null;
  let lastStats = null;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts += 1;
    lastProbe = await evaluate(client, sessionId, options.readyExpression);

    if (!lastProbe?.ready) {
      stableCount = 0;
      previousSignature = null;
      await delay(200);
      continue;
    }

    const png = await capturePng(client, sessionId);
    const image = decodePng(png);
    lastStats = analyzeFrame(image);
    const signature = frameSignature(image);

    const hasSpread =
      lastStats.spread >= options.minSpread && lastStats.litFraction >= options.minLitFraction;

    if (!hasSpread) {
      stableCount = 0;
      previousSignature = signature;
      await delay(options.settleMs);
      continue;
    }

    if (previousSignature) {
      const delta = signatureDelta(previousSignature, signature);
      stableCount = delta <= options.stabilityThreshold ? stableCount + 1 : 0;
    }
    previousSignature = signature;

    if (stableCount >= options.stableFrames - 1) {
      return { ready: true, probe: lastProbe, stats: lastStats, attempts, png };
    }

    await delay(options.settleMs);
  }

  return {
    ready: false,
    probe: lastProbe,
    stats: lastStats,
    attempts,
    reason: lastProbe?.ready
      ? `frames never stabilised within ${options.readyTimeoutMs} ms (last luminance spread ${lastStats ? lastStats.spread.toFixed(1) : 'n/a'})`
      : `readiness probe reported "${lastProbe?.reason ?? 'no response'}"`,
  };
}

// ---------------------------------------------------------------------------
// Preflight and main flow
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
    'stage352-capture - zero-dependency Chrome DevTools Protocol screenshot harness',
    '',
    'Usage:',
    '  node scripts/stage352-capture.mjs [flags]',
    '',
    'Core flags:',
    '  --base-url <url>        App origin to capture. Default http://localhost:3000',
    '  --out <dir>             Output directory for PNGs. Default artifacts/',
    '  --backend <name>        auto | webgpu | webgl2. Default auto.',
    '                          webgpu/webgl2 assert the page-reported backend.',
    '                          webgl2 also removes navigator.gpu from the page so',
    "                          the app's own capability probe takes the fallback.",
    '  --quality <name>        ultra | high | medium | safe. Default ultra.',
    '                          Dispatched to the dev build as the',
    '                          compute-atlas:dev-quality event after load.',
    '  --sizes <list>          Comma-separated <WxH>. Default 1920x1080,2560x1440',
    '  --states <list>         Comma-separated states. Default overview.',
    '                          Each entry is [<verb>-]<label>[@x,y] where the verb is',
    '                          overview | hover | focus | click | press | escape.',
    '                          e.g. overview,hover-graphics,focus-graphics,escape',
    '  --point <x,y>           Default pointer target for hover/focus. Default 960,540.',
    '                          Percentages are allowed, e.g. 62%,58%.',
    '  --coords <list>         Per-label coordinates, e.g. graphics=1180,640,ai=30%,40%',
    '  --park <x,y>            Pointer parking spot used to reset hover. Default 4,4',
    '',
    'Capture flags:',
    '  --reduced-motion        Emulate prefers-reduced-motion: reduce before navigation',
    '  --thumb <WxH|none>      Downscaled frame via CDP clip.scale. Default 480x270',
    '  --thumb-state <name>    Which state supplies the thumbnail. Default overview',
    '  --name-prefix <text>    File name prefix. Default stage352',
    '                          Names look like <prefix>-<backend>-<quality>-<WxH>-<state>[-reduced].png',
    '  --dsf <n>               Emulation device scale factor. Default 1',
    '  --boot <skip|full>      Boot animation query value. Default skip',
    '  --telemetry <0|1>       Telemetry console sink query value. Default 1',
    '  --query <k=v&k=v>       Extra query parameters appended to the capture URL',
    '',
    'Browser flags:',
    '  --browser <path>        Explicit Chrome/Edge executable (else auto-discovered)',
    '  --port <n>              Remote debugging port. 0 picks one automatically. Default 0',
    '  --gpu <name>            auto | hardware | swiftshader | disabled. Default auto',
    '  --chrome-arg <flag>     Extra Chrome flag. Repeatable',
    '  --browser-log           Print the captured browser stderr at the end',
    '  --keep-profile          Keep the temp user-data-dir (debugging only)',
    '',
    'Wait and tolerance flags:',
    '  --ready-timeout <ms>    Readiness deadline per capture. Default 60000',
    '  --stable-frames <n>     Consecutive stable frames required. Default 3',
    '  --stability-threshold <n>  Max mean luminance delta per 16x16 cell. Default 4',
    '  --min-spread <n>        Minimum luminance spread for a ready frame. Default 10',
    '  --min-lit <0..1>        Minimum fraction of lit pixels. Default 0.01',
    '  --settle-ms <ms>        Delay between input and sampling. Default 350',
    '  --command-timeout <ms>  Per-CDP-command timeout. Default 30000',
    '',
    'Failure handling:',
    '  --allow-console-error <regex>  Treat matching console errors as warnings. Repeatable',
    '  --lenient               Downgrade console errors to warnings (fatals still fail)',
    '  --allow-unready         Capture even when readiness never converged (unsafe)',
    '  --no-preflight          Skip the pre-flight reachability check of --base-url',
    '',
    'Diagnostics:',
    '  --dry-run               Print the resolved matrix and exit without a browser',
    '  --verbose               Print every console message and CDP detail',
    '  --help, -h              Show this help',
    '',
    'Exit codes: 0 success, 1 capture/fatal failure, 2 usage error, 3 unreachable app.',
    '',
    'Examples:',
    '  node scripts/stage352-capture.mjs --backend webgpu --quality ultra \\',
    '    --sizes 1920x1080,2560x1440 \\',
    '    --states overview,hover-graphics,focus-graphics,escape \\',
    '    --coords graphics=1180,640',
    '',
    '  node scripts/stage352-capture.mjs --backend webgl2 --reduced-motion \\',
    '    --states overview,hover-graphics,focus-graphics,escape',
  ];
  console.log(lines.join('\n'));
}

function printPlan(plan, options) {
  console.log('stage352-capture plan (dry run)');
  console.log(`  base url      : ${options.baseUrl}`);
  console.log(`  capture url   : ${plan.url}`);
  console.log(`  out dir       : ${options.outDir}`);
  console.log(`  browser       : ${options.browserPath ?? '(auto-discovered)'}`);
  console.log(`  backend       : ${options.backend}`);
  console.log(`  quality       : ${options.quality}`);
  console.log(`  reduced motion: ${options.reducedMotion ? 'yes' : 'no'}`);
  console.log(`  device scale  : ${options.deviceScaleFactor}`);
  console.log(`  thumbnail     : ${options.thumb ? `${options.thumb.label} from state "${options.thumbState}"` : 'none'}`);
  console.log(`  states        : ${options.states.map((state) => state.spec).join(', ')}`);
  console.log(`  captures      : ${plan.jobs.length}`);
  for (const job of plan.jobs) {
    const name = formatCaptureName({
      prefix: options.namePrefix,
      backend: options.backend === 'auto' ? 'auto' : options.backend,
      quality: options.quality,
      sizeLabel: job.size.label,
      stateName: job.state.name,
      reducedMotion: options.reducedMotion,
    });
    const input =
      job.state.kind === 'none'
        ? 'no input'
        : job.state.kind === 'escape'
          ? 'Escape'
          : `${job.state.kind} @ ${job.point.x},${job.point.y} (${job.point.source})`;
    console.log(`    - ${job.size.label} ${job.state.name.padEnd(18)} ${input.padEnd(42)} ${name}`);
    if (job.isThumbSource && options.thumb) {
      console.log(
        `      + thumbnail ${options.thumb.label} via clip.scale (no re-render) -> ${formatCaptureName({
          prefix: options.namePrefix,
          backend: options.backend === 'auto' ? 'auto' : options.backend,
          quality: options.quality,
          sizeLabel: job.size.label,
          stateName: job.state.name,
          reducedMotion: options.reducedMotion,
          suffix: `-thumb-${options.thumb.label}`,
        })}`,
      );
    }
  }
  return EXIT_SUCCESS;
}

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

    globalThis.__stage352BrowserPid = null;
  };
}

async function launchBrowser(options) {
  const executable = findBrowserExecutable(options.browserPath);
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'stage352-capture-'));
  const requestedPort = options.port > 0 ? options.port : 0;
  const stderr = createLineCollector();
  const stdout = createLineCollector(20);

  const child = spawn(executable, buildBrowserArgs(options, profileDir, requestedPort), {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  // Read by the synchronous signal/"exit" handler, so a crash cannot orphan it.
  globalThis.__stage352BrowserPid = child.pid;

  const state = {
    child,
    profileDir,
    client: null,
    keepProfile: options.keepProfile,
    executable,
    pid: child.pid,
  };
  child.stdout?.on('data', (chunk) => stdout.push(chunk));
  child.stderr?.on('data', (chunk) => stderr.push(chunk));
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

    return { state, client, port, version, executable, stderr, stdout, profileDir };
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
    globalThis.__stage352BrowserPid = null;
    throw error;
  }
}

async function runCapture(options) {
  const plan = resolvePlan(options);

  let preflight = null;
  if (options.preflight) {
    preflight = await preflightBaseUrl(options.baseUrl);
  }

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

  const captures = [];
  const failures = [];
  let reportedBackend = null;
  let pageQuality = null;
  const backendLabel = () => reportedBackend ?? (options.backend === 'auto' ? 'auto' : options.backend);

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

    const firstSize = plan.sizes[0];
    await applyViewport(browser.client, sessionId, firstSize, options);
    await navigate(browser.client, sessionId, plan.url, options.readyTimeoutMs);

    console.log(`Capturing ${plan.url}`);
    console.log(`  browser : ${browser.executable} (${browser.version.Browser ?? 'unknown'})`);
    console.log(`  endpoint: 127.0.0.1:${browser.port}`);
    console.log(`  out dir : ${options.outDir}`);

    await mkdir(options.outDir, { recursive: true });

    const initialReady = await waitForReadyScene(browser.client, sessionId, options);
    if (!initialReady.ready && !options.allowUnready) {
      failures.push({
        kind: 'readiness',
        text: `The scene never reported ready: ${initialReady.reason}`,
      });
    } else if (!initialReady.ready) {
      console.warn(`  warning: scene not ready (${initialReady.reason}); --allow-unready is set`);
    }

    if (initialReady.probe?.label) {
      if (/WEBGPU/i.test(initialReady.probe.label)) reportedBackend = 'webgpu';
      else if (/WEBGL2/i.test(initialReady.probe.label)) reportedBackend = 'webgl2';
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

    const ready = await waitForReadyScene(browser.client, sessionId, options);
    if (!ready.ready && !options.allowUnready) {
      failures.push({
        kind: 'readiness',
        text: `The scene never reported ready after the quality request: ${ready.reason}`,
      });
    } else if (!ready.ready) {
      console.warn(`  warning: scene not ready (${ready.reason}); --allow-unready is set`);
    }

    const probe = ready.probe ?? initialReady.probe ?? null;
    if (probe?.label) {
      if (/WEBGPU/i.test(probe.label)) reportedBackend = 'webgpu';
      else if (/WEBGL2/i.test(probe.label)) reportedBackend = 'webgl2';
      pageQuality = probe.quality ?? null;
    }
    console.log(
      `  status  : ${probe?.label ?? 'unknown'}${pageQuality ? ` | ${pageQuality}` : ''} (after ${ready.attempts} readiness samples)`,
    );

    if (options.backend !== 'auto' && reportedBackend !== null && reportedBackend !== options.backend) {
      failures.push({
        kind: 'backend',
        text: `Requested --backend ${options.backend} but the page reported ${reportedBackend} (${probe?.label ?? 'no status'}). Use --backend auto to accept the probed backend.`,
      });
    }
    if (pageQuality && !pageQuality.toUpperCase().includes(options.quality.toUpperCase())) {
      console.warn(
        `  warning: requested quality ${options.quality} but the page reports ${pageQuality}; the dev quality channel is development-only.`,
      );
    }

    for (const size of plan.sizes) {
      const sizeJobs = plan.jobs.filter((job) => job.size.label === size.label);
      await applyViewport(browser.client, sessionId, size, options);
      await delay(options.settleMs);

      for (const job of sizeJobs) {
        const inputDescription = await applyState(browser.client, sessionId, job, options, size);
        await delay(options.settleMs);

        const stability = await waitForReadyScene(browser.client, sessionId, options);
        if (!stability.ready && !options.allowUnready) {
          failures.push({
            kind: 'readiness',
            text: `${size.label} ${job.state.name}: ${stability.reason}`,
          });
        } else if (!stability.ready) {
          console.warn(`  warning: ${size.label} ${job.state.name} not ready (${stability.reason})`);
        }

        const png = stability.png ?? (await capturePng(browser.client, sessionId));
        const image = decodePng(png);
        const stats = analyzeFrame(image);
        const name = formatCaptureName({
          prefix: options.namePrefix,
          backend: backendLabel(),
          quality: options.quality,
          sizeLabel: size.label,
          stateName: job.state.name,
          reducedMotion: options.reducedMotion,
        });
        const filePath = path.join(options.outDir, name);
        await writeFile(filePath, png);

        const record = {
          filePath,
          name,
          size: `${image.width}x${image.height}`,
          state: job.state.name,
          input: inputDescription,
          spread: stats.spread,
          litFraction: stats.litFraction,
          mean: stats.mean,
          bytes: png.length,
        };
        captures.push(record);

        if (stats.spread < options.minSpread || stats.litFraction < options.minLitFraction) {
          failures.push({
            kind: 'flat-frame',
            text: `${name} looks flat (spread ${stats.spread.toFixed(1)}, lit ${(stats.litFraction * 100).toFixed(2)}%)`,
          });
        }

        console.log(
          `  ${name}  ${record.size}  spread ${stats.spread.toFixed(1)}  lit ${(stats.litFraction * 100).toFixed(2)}%  ${(png.length / 1024).toFixed(0)} KiB  [${inputDescription}]`,
        );

        if (job.isThumbSource && options.thumb) {
          const thumbnail = await captureThumbnail(browser.client, sessionId, size, options.thumb);
          const thumbImage = decodePng(thumbnail.png);
          const thumbName = formatCaptureName({
            prefix: options.namePrefix,
            backend: backendLabel(),
            quality: options.quality,
            sizeLabel: size.label,
            stateName: job.state.name,
            reducedMotion: options.reducedMotion,
            suffix: `-thumb-${options.thumb.label}`,
          });
          const thumbPath = path.join(options.outDir, thumbName);
          await writeFile(thumbPath, thumbnail.png);
          captures.push({
            filePath: thumbPath,
            name: thumbName,
            size: `${thumbImage.width}x${thumbImage.height}`,
            state: `${job.state.name} (thumbnail)`,
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
        }
      }
    }
  } finally {
    const logLines = options.browserLog || failures.length > 0 ? browser.stderr.lines() : [];
    const outLines = options.browserLog ? browser.stdout.lines() : [];
    await shutdown();
    if (logLines.length > 0) {
      console.log('  browser stderr (tail):');
      for (const line of logLines) console.log(`    | ${line}`);
    }
    if (outLines.length > 0) {
      console.log('  browser stdout (tail):');
      for (const line of outLines) console.log(`    | ${line}`);
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
  console.log(`  backend        : ${backendLabel()} (requested ${options.backend})`);
  console.log(`  quality        : ${options.quality}${pageQuality ? ` - page reports ${pageQuality}` : ''}`);
  console.log(`  reduced motion : ${options.reducedMotion ? 'emulated' : 'no'}`);
  console.log(`  viewports      : ${plan.sizes.map((size) => size.label).join(', ')}`);
  if (preflight) {
    console.log(`  preflight      : HTTP ${preflight.status} in ${preflight.durationMs} ms`);
  }
  console.log(`  files written  : ${captures.length}`);
  for (const capture of captures) {
    console.log(`    - ${capture.name} (${capture.size}, ${(capture.bytes / 1024).toFixed(0)} KiB)`);
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

  if (failures.length > 0) {
    console.error('');
    console.error(`FAILED - ${failures.length} problem(s):`);
    for (const failure of failures) {
      console.error(`  [${failure.kind}] ${failure.text.slice(0, 400)}`);
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
      console.error(`stage352-capture: ${error.message}`);
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
      return printPlan(resolvePlan(options), options);
    }
    return await runCapture(options);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`stage352-capture: ${error.message}`);
      return EXIT_USAGE;
    }
    if (error instanceof ConnectionError) {
      console.error(`stage352-capture: ${error.message}`);
      return EXIT_CONNECTION;
    }
    console.error(`stage352-capture failed: ${error?.stack ?? error}`);
    return EXIT_FAILURE;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const emergencyKill = () => {
    // Last-resort synchronous cleanup so Ctrl-C never leaves an orphan browser.
    const pid = globalThis.__stage352BrowserPid;
    if (Number.isInteger(pid)) killProcessTree(pid, { synchronous: true });
  };
  process.on('exit', emergencyKill);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.on(signal, () => {
      console.error(`\nstage352-capture: received ${signal}, cleaning up...`);
      emergencyKill();
      process.exit(130);
    });
  }

  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`stage352-capture failed: ${error?.stack ?? error}`);
      process.exitCode = EXIT_FAILURE;
    });
}