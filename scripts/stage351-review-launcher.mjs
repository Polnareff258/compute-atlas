import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const SERVER_ORIGIN = 'http://127.0.0.1:3000';
const REVIEW_URL = `${SERVER_ORIGIN}/?boot=skip&telemetry=1`;
const PROJECT_TITLE = /<title(?:\s[^>]*)?>\s*POLNAREFF SYSTEM\s*<\/title>/i;
const PROBE_TIMEOUT_MS = 3000;
const STARTUP_TIMEOUT_MS = 90000;

export function classifyHttpResponse(statusCode, html) {
  if (statusCode !== 200) return 'occupied';
  return PROJECT_TITLE.test(html) ? 'project' : 'occupied';
}

export function classifyConnectionError(code) {
  return code === 'ECONNREFUSED' ? 'not-running' : 'occupied';
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
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] &&
      path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate));
}

function startDevServer() {
  if (!existsSync(path.join(PROJECT_ROOT, 'node_modules', 'next'))) {
    throw new Error('Project dependencies are missing. Run npm ci in the repository first.');
  }

  return new Promise((resolve, reject) => {
    const server = spawn(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', 'npm.cmd run dev -- --hostname 127.0.0.1'],
      {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    );

    server.once('error', reject);
    server.once('spawn', () => {
      server.unref();
      resolve();
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

  throw new Error('The local page did not become ready within 90 seconds.');
}

function openChrome() {
  const chromePath = findChromeExecutable();
  if (!chromePath) {
    throw new Error('Google Chrome was not found in its standard Windows install locations.');
  }

  return new Promise((resolve, reject) => {
    const browser = spawn(chromePath, ['--new-window', REVIEW_URL], {
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

export async function launchReview() {
  let status = await probeReviewServer();

  if (status === 'occupied') {
    throw new Error('Port 3000 is in use by something other than POLNAREFF SYSTEM. No process was stopped.');
  }

  if (status === 'not-running') {
    console.log('Starting the local development server…');
    await startDevServer();
    await waitForProjectServer();
  } else {
    console.log('Reusing the existing POLNAREFF SYSTEM server on port 3000.');
  }

  await openChrome();
  console.log(`Opened a new Chrome window at ${REVIEW_URL}`);
  console.log('Keep the address bar visible so the page URL can be verified.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launchReview().catch((error) => {
    console.error(`Could not open the Stage 3.5.1 review page: ${error.message}`);
    process.exitCode = 1;
  });
}
