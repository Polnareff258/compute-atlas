/**
 * One-click review launcher.
 *
 * Supersedes `stage351-review-launcher.mjs`, which was stage-named and pointed at
 * a visual layer that no longer exists. The behaviour is deliberately the same
 * because it was right: probe the port, reuse the server only if it is provably
 * ours, never stop a process we did not start, then open a browser.
 *
 * Two things it does that the earlier one did not:
 *
 *  1. It prints the dev-only quality one-liner. Quality cannot be selected from a
 *     URL — `RendererHost` listens for the `compute-atlas:dev-quality` event and
 *     only under `NODE_ENV === 'development'` — so the honest way to let a person
 *     change profile without the capture harness is to hand them the exact line
 *     to paste into DevTools. `tests/review-launcher.test.mjs` asserts that line
 *     names the same event the application actually listens for, so the hint
 *     cannot silently rot if the event is renamed.
 *
 *  2. `--prod` builds and serves the production bundle. The brief records FPS
 *     32–43 as a *dev* measurement with HMR active, and a fair look at
 *     performance needs the production build; Stage 11 owns the real
 *     measurement, but a person checking the site should be able to see it.
 *     Note that `next build` rewrites the import paths in `next-env.d.ts` from
 *     `.next/dev/...` to `.next/types/...`, which dirties the working tree; the
 *     launcher warns rather than silently reverting a tracked file.
 *
 * Usage:
 *   node scripts/review-launcher.mjs [--dev|--prod] [--capture] [--no-open]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const SERVER_ORIGIN = 'http://127.0.0.1:3000';

/**
 * `boot=skip` goes straight to the scene instead of replaying the boot sequence,
 * and `telemetry=1` turns on the throttled console sink. These match what the
 * capture harness requests, so a person looking at the page sees the same frame
 * the evidence PNGs were taken from.
 */
const REVIEW_URL = `${SERVER_ORIGIN}/?boot=skip&telemetry=1`;

const PROJECT_TITLE = /<title(?:\s[^>]*)?>\s*POLNAREFF SYSTEM\s*<\/title>/i;
const PROBE_TIMEOUT_MS = 3000;
const STARTUP_TIMEOUT_MS = 90000;
const BUILD_TIMEOUT_MS = 300000;

/** Must match the listener registered in `src/renderer/RendererHost.tsx`. */
const DEV_QUALITY_EVENT = 'compute-atlas:dev-quality';
const QUALITY_PROFILES = ['ultra', 'high', 'medium', 'safe'];
const CAPTURE_SCRIPT = path.join('scripts', 'stage352-capture.mjs');

/**
 * A response only counts as ours when it is a 200 *and* carries the product
 * title. Status alone is not enough: any dev server answers 200 on /, and
 * reusing a stranger's server on port 3000 would open the wrong page and then
 * report success.
 */
export function classifyHttpResponse(statusCode, html) {
  if (statusCode !== 200) return 'occupied';
  return PROJECT_TITLE.test(html) ? 'project' : 'occupied';
}

/**
 * Only a refused connection proves nothing is listening. Everything else
 * (timeout, reset, a proxy answering for an unrelated host) means *something*
 * is there, and the launcher must not start a second server on top of it.
 */
export function classifyConnectionError(code) {
  return code === 'ECONNREFUSED' ? 'not-running' : 'occupied';
}

export function parseLaunchOptions(argv) {
  const options = { mode: 'dev', capture: false, open: true, help: false };

  for (const argument of argv) {
    if (argument === '--dev') options.mode = 'dev';
    else if (argument === '--prod') options.mode = 'prod';
    else if (argument === '--capture') options.capture = true;
    else if (argument === '--no-open') options.open = false;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown option "${argument}". Try --help.`);
  }

  return options;
}

/** The exact line a person pastes into DevTools to change quality profile. */
export function devQualityHint(profile = 'safe') {
  return `window.dispatchEvent(new CustomEvent('${DEV_QUALITY_EVENT}', { detail: '${profile}' }))`;
}

export function captureCommand() {
  return [
    'node',
    CAPTURE_SCRIPT,
    '--out artifacts',
    '--base-url ' + SERVER_ORIGIN,
    '--backend webgpu',
    '--quality ultra',
    '--sizes 1920x1080',
    '--states overview,hover-graphics,focus-graphics,escape',
    '--thumb 480x270',
    '--name-prefix stage354',
  ].join(' ');
}

export const REVIEW_URLS = { origin: SERVER_ORIGIN, page: REVIEW_URL };

export function usage() {
  return [
    'Usage: node scripts/review-launcher.mjs [options]',
    '',
    '  --dev        Serve the dev build with HMR (default, fast to start).',
    '  --prod       Build and serve the production bundle. Slower to start,',
    '               but the frame rate is the one the bundle actually produces.',
    '  --capture    After the page is up, write the review frames to',
    '               artifacts/ and open the folder.',
    '  --no-open    Start or reuse the server without opening a browser.',
    '  --help       Print this.',
  ].join('\n');
}

export async function probeReviewServer(url = SERVER_ORIGIN) {
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return classifyHttpResponse(response.status, await response.text());
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'cause' in error
        ? error.cause?.code
        : undefined;
    return classifyConnectionError(code);
  }
}

function findChromeExecutable() {
  const candidates = [
    process.env.PROGRAMFILES &&
      path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] &&
      path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate));
}

function npm(script, extraArguments, stdio) {
  return spawn(
    process.env.ComSpec ?? 'cmd.exe',
    ['/d', '/s', '/c', `npm.cmd run ${script}${extraArguments ? ` -- ${extraArguments}` : ''}`],
    { cwd: PROJECT_ROOT, windowsHide: true, stdio },
  );
}

function startDetached(script, extraArguments) {
  return new Promise((resolve, reject) => {
    const child = npm(script, extraArguments, 'ignore');
    child.once('error', reject);
    child.once('spawn', () => {
      // The server must outlive this launcher, which exits as soon as the page
      // is open. Without both of these the child dies with the parent on
      // Windows when the console closes.
      child.unref();
      resolve();
    });
  });
}

/** Runs to completion with visible output; used for the production build. */
function runToCompletion(script, extraArguments, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = npm(script, extraArguments, 'inherit');
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`\`npm run ${script}\` did not finish within ${timeoutMs / 1000}s.`));
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`\`npm run ${script}\` exited with code ${code}.`));
    });
  });
}

async function waitForProjectServer() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const status = await probeReviewServer();
    if (status === 'project') return;
    if (status === 'occupied') {
      throw new Error('Port 3000 did not serve POLNAREFF SYSTEM. No process was stopped.');
    }
    await delay(750);
  }

  throw new Error(`The local page did not become ready within ${STARTUP_TIMEOUT_MS / 1000} seconds.`);
}

function openChrome(url) {
  const chromePath = findChromeExecutable();
  if (!chromePath) {
    throw new Error('Google Chrome was not found in its standard Windows install locations.');
  }

  return new Promise((resolve, reject) => {
    const browser = spawn(chromePath, ['--new-window', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });

    browser.once('error', reject);
    browser.once('spawn', () => {
      browser.unref();
      resolve();
    });
  });
}

function openFolder(directory) {
  const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'start', '', directory], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.once('error', () => {});
  child.unref();
}

function openCaptureFolder() {
  const outputDirectory = path.join(PROJECT_ROOT, 'artifacts');
  openFolder(outputDirectory);
}

export async function runCapture() {
  console.log('Capturing the review frames. This drives Chrome itself, about a minute.\n');
  await new Promise((resolve, reject) => {
    const [command, ...rest] = captureCommand().split(' ');
    const child = spawn(command, rest, { cwd: PROJECT_ROOT, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`The capture harness exited with code ${code}.`)),
    );
  });
}

export async function launchReview(options = parseLaunchOptions([])) {
  if (options.help) {
    console.log(usage());
    return;
  }

  const status = await probeReviewServer();

  if (status === 'occupied') {
    throw new Error(
      'Port 3000 is in use by something other than POLNAREFF SYSTEM. No process was stopped.',
    );
  }

  if (status === 'project') {
    console.log('Reusing the POLNAREFF SYSTEM server already on port 3000.');
  } else if (options.mode === 'prod') {
    console.log('Building the production bundle…\n');
    await runToCompletion('build', '', BUILD_TIMEOUT_MS);
    console.log('\nStarting the production server…');
    await startDetached('start', '--hostname 127.0.0.1');
    await waitForProjectServer();
    console.log(
      'Note: `next build` rewrites next-env.d.ts to the build paths. ' +
        '`git checkout -- next-env.d.ts` restores it.',
    );
  } else {
    console.log('Starting the local development server…');
    await startDetached('dev', '--hostname 127.0.0.1');
    await waitForProjectServer();
  }

  if (options.capture) {
    await runCapture();
    openCaptureFolder();
  }

  if (options.open) {
    await openChrome(REVIEW_URL);
  }

  console.log('');
  console.log(`Review page : ${REVIEW_URL}`);
  console.log('Hover a region to load it, click to focus it, Escape to withdraw.');
  if (options.mode === 'dev') {
    console.log('');
    console.log('Quality profile (paste into DevTools; dev build only):');
    for (const profile of QUALITY_PROFILES) {
      console.log(`  ${profile.padEnd(7)} ${devQualityHint(profile)}`);
    }
  } else {
    console.log('');
    console.log('A production build ignores the dev quality event; it runs the profile it detected.');
  }
  console.log('');
  console.log('Frames instead of a browser:');
  console.log(`  ${captureCommand()}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try {
    options = parseLaunchOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }

  if (options) {
    launchReview(options).catch((error) => {
      console.error(`Could not open the review page: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
