'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DATA_ROOT = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/app/data';
const LAVALINK_URL = 'http://127.0.0.1:2333/version';
const LAVALINK_JAR = path.join(__dirname, 'Lavalink.jar');
const STARTUP_TIMEOUT_MS = 180000;

if (!process.env.LAVALINK_PASSWORD) {
  // Keep Lavalink bound to loopback and give every deployment a private,
  // automatically generated password. No Railway variable is required.
  process.env.LAVALINK_PASSWORD = crypto.randomBytes(32).toString('hex');
}

const password = process.env.LAVALINK_PASSWORD;
const requestedHeap = String(process.env.LAVALINK_JAVA_XMX || '512m').trim();
const javaHeap = /^\d{2,4}[mMgG]$/.test(requestedHeap) ? requestedHeap : '512m';

let javaProcess = null;
let botProcess = null;
let javaExited = false;
let botExited = false;
let shuttingDown = false;
let killTimer = null;

function finishIfStopped() {
  if (!shuttingDown) return;
  if ((!javaProcess || javaExited) && (!botProcess || botExited)) {
    if (killTimer) clearTimeout(killTimer);
    process.exit(process.exitCode == null ? 0 : process.exitCode);
  }
}

function shutdown(code, reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = Number.isInteger(code) ? code : 1;
  if (reason) console.error('[Supervisor] ' + reason);

  if (botProcess && !botExited) {
    try { botProcess.kill('SIGTERM'); } catch (_) {}
  }
  if (javaProcess && !javaExited) {
    try { javaProcess.kill('SIGTERM'); } catch (_) {}
  }

  killTimer = setTimeout(() => {
    if (botProcess && !botExited) {
      try { botProcess.kill('SIGKILL'); } catch (_) {}
    }
    if (javaProcess && !javaExited) {
      try { javaProcess.kill('SIGKILL'); } catch (_) {}
    }
    process.exit(process.exitCode == null ? 1 : process.exitCode);
  }, 12000);
  if (typeof killTimer.unref === 'function') killTimer.unref();
  finishIfStopped();
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForLavalink() {
  const startedAt = Date.now();
  let lastLogAt = 0;
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (javaExited || (javaProcess && javaProcess.exitCode !== null)) {
      throw new Error('The Lavalink Java process exited before becoming ready.');
    }

    try {
      const response = await fetch(LAVALINK_URL, {
        headers: { Authorization: password },
        signal: AbortSignal.timeout(2500),
      });
      if (response.ok) {
        const version = await response.text();
        console.log('[Supervisor] Lavalink is ready:', version.trim() || 'version endpoint responded');
        return;
      }
    } catch (_) {
      // Lavalink may still be resolving its YouTube plugin dependencies.
    }

    if (Date.now() - lastLogAt > 15000) {
      console.log('[Supervisor] Waiting for Lavalink and its YouTube plugin to become ready...');
      lastLogAt = Date.now();
    }
    await wait(1000);
  }
  throw new Error('Lavalink did not become ready within ' + Math.round(STARTUP_TIMEOUT_MS / 1000) + ' seconds.');
}

async function main() {
  if (!fs.existsSync(LAVALINK_JAR)) {
    throw new Error('Lavalink.jar is missing. Rebuild the Railway service from the repository Dockerfile.');
  }
  fs.mkdirSync(path.join(DATA_ROOT, '.java-home'), { recursive: true });

  const javaArgs = [
    '-Xms128m',
    '-Xmx' + javaHeap,
    '-XX:+UseG1GC',
    '-Duser.home=' + path.join(DATA_ROOT, '.java-home'),
    '-jar',
    LAVALINK_JAR,
  ];

  console.log('[Supervisor] Starting Lavalink in the same Railway container.');
  javaProcess = spawn('java', javaArgs, {
    cwd: __dirname,
    env: process.env,
    stdio: 'inherit',
  });
  javaProcess.once('error', error => {
    javaExited = true;
    shutdown(1, 'Could not start Java/Lavalink: ' + (error.message || error));
  });
  javaProcess.once('exit', (code, signal) => {
    javaExited = true;
    if (!shuttingDown) {
      shutdown(code === 0 ? 1 : (code == null ? 1 : code),
        'Lavalink exited unexpectedly (code ' + code + ', signal ' + signal + ').');
    } else {
      finishIfStopped();
    }
  });

  await waitForLavalink();
  if (shuttingDown) return;

  console.log('[Supervisor] Starting the Discord bot.');
  botProcess = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    cwd: __dirname,
    env: process.env,
    stdio: 'inherit',
  });
  botProcess.once('error', error => {
    botExited = true;
    shutdown(1, 'Could not start the Discord bot: ' + (error.message || error));
  });
  botProcess.once('exit', (code, signal) => {
    botExited = true;
    if (!shuttingDown) {
      shutdown(code === 0 ? 0 : (code == null ? 1 : code),
        'Discord bot exited (code ' + code + ', signal ' + signal + '); stopping Lavalink too.');
    } else {
      finishIfStopped();
    }
  });
}

process.on('SIGTERM', () => shutdown(0, 'Received SIGTERM; stopping both processes.'));
process.on('SIGINT', () => shutdown(0, 'Received SIGINT; stopping both processes.'));

main().catch(error => {
  shutdown(1, error && error.message ? error.message : String(error));
});
