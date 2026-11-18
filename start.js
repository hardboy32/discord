'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DATA_ROOT = process.env.RAILWAY_VOLUME_MOUNT_PATH || '/app/data';
const LAVALINK_URL = 'http://127.0.0.1:2333/version';
const CIPHER_HEALTH_URL = 'http://127.0.0.1:8001/metrics';
const LAVALINK_JAR = path.join(__dirname, 'Lavalink.jar');
const CIPHER_BIN = path.join(__dirname, 'yt-cipher');
const STARTUP_TIMEOUT_MS = 180000;

// Forward only warnings/errors from child services; suppress routine INFO output.
function forwardImportantLogs(child, label) {
  const buffers = { stdout: '', stderr: '' };
  for (const streamName of ['stdout', 'stderr']) {
    const stream = child[streamName];
    if (!stream) continue;
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
      buffers[streamName] += chunk;
      const lines = buffers[streamName].split(/\r?\n/);
      buffers[streamName] = lines.pop() || '';
      for (const line of lines) {
        if (/\b(WARN|WARNING|ERROR|FATAL|SEVERE)\\b|\\b(error|failed|exception)\\b/i.test(line)) {
          console.error('[' + label + '] ' + line);
        }
      }
    });
    stream.on('end', () => {
      const line = buffers[streamName].trim();
      if (line && /\\b(WARN|WARNING|ERROR|FATAL|SEVERE)\\b|\\b(error|failed|exception)\\b/i.test(line)) {
        console.error('[' + label + '] ' + line);
      }
    });
  }
}

if (!process.env.LAVALINK_PASSWORD) {
  process.env.LAVALINK_PASSWORD = crypto.randomBytes(32).toString('hex');
}
if (!process.env.YT_CIPHER_PASSWORD) {
  process.env.YT_CIPHER_PASSWORD = crypto.randomBytes(32).toString('hex');
}

const password = process.env.LAVALINK_PASSWORD;
const cipherPassword = process.env.YT_CIPHER_PASSWORD;
const requestedHeap = String(process.env.LAVALINK_JAVA_XMX || '512m').trim();
const javaHeap = /^\d{2,4}[mMgG]$/.test(requestedHeap) ? requestedHeap : '512m';

let cipherProcess = null;
let javaProcess = null;
let botProcess = null;
let cipherExited = false;
let javaExited = false;
let botExited = false;
let shuttingDown = false;
let killTimer = null;

function finishIfStopped() {
  if (!shuttingDown) return;
  if ((!cipherProcess || cipherExited) && (!javaProcess || javaExited) && (!botProcess || botExited)) {
    if (killTimer) clearTimeout(killTimer);
    process.exit(process.exitCode == null ? 0 : process.exitCode);
  }
}

function shutdown(code, reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.exitCode = Number.isInteger(code) ? code : 1;
  if (reason) console.error('[Supervisor] ' + reason);

  for (const child of [botProcess, javaProcess, cipherProcess]) {
    if (child && child.exitCode === null && !child.killed) {
      try { child.kill('SIGTERM'); } catch (_) {}
    }
  }

  killTimer = setTimeout(() => {
    for (const child of [botProcess, javaProcess, cipherProcess]) {
      if (child && child.exitCode === null) {
        try { child.kill('SIGKILL'); } catch (_) {}
      }
    }
    process.exit(process.exitCode == null ? 1 : process.exitCode);
  }, 12000);
  if (typeof killTimer.unref === 'function') killTimer.unref();
  finishIfStopped();
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForService(url, label, headers = {}) {
  const startedAt = Date.now();
  let lastLogAt = 0;
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (shuttingDown) throw new Error('Startup cancelled.');
    if ((label === 'YouTube Cipher' && cipherExited) || (label === 'Lavalink' && javaExited)) {
      throw new Error(label + ' process exited before becoming ready.');
    }
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(2500),
      });
      if (response.ok) {
        const detail = label === 'Lavalink' ? (await response.text()).trim() : 'local cipher API responding';
        console.log('[Supervisor] ' + label + ' is ready' + (detail ? ': ' + detail : '.'));
        return;
      }
    } catch (_) {
      // The service may still be starting.
    }
    if (Date.now() - lastLogAt > 15000) {
      console.log('[Supervisor] Waiting for ' + label + ' to become ready...');
      lastLogAt = Date.now();
    }
    await wait(1000);
  }
  throw new Error(label + ' did not become ready within ' + Math.round(STARTUP_TIMEOUT_MS / 1000) + ' seconds.');
}

async function main() {
  if (!fs.existsSync(LAVALINK_JAR)) {
    throw new Error('Lavalink.jar is missing. Rebuild the Railway service from the repository Dockerfile.');
  }
  if (!fs.existsSync(CIPHER_BIN)) {
    throw new Error('The bundled YouTube Cipher binary is missing. Rebuild the Railway service from the repository Dockerfile.');
  }
  fs.mkdirSync(path.join(DATA_ROOT, '.java-home'), { recursive: true });

  console.log('[Supervisor] Starting the self-hosted YouTube Cipher in this Railway container.');
  cipherProcess = spawn(CIPHER_BIN, [], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: '8001',
      HOST: '127.0.0.1',
      API_TOKEN: cipherPassword,
      OVERRIDE_PLAYER_VARIANT: 'IAS',
    },
    stdio: 'inherit',
  });
  cipherProcess.once('error', error => {
    cipherExited = true;
    shutdown(1, 'Could not start YouTube Cipher: ' + (error.message || error));
  });
  cipherProcess.once('exit', (code, signal) => {
    cipherExited = true;
    if (!shuttingDown) {
      shutdown(code === 0 ? 1 : (code == null ? 1 : code),
        'YouTube Cipher exited unexpectedly (code ' + code + ', signal ' + signal + ').');
    } else {
      finishIfStopped();
    }
  });

  await waitForService(CIPHER_HEALTH_URL, 'YouTube Cipher');
  if (shuttingDown) return;

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

  await waitForService(LAVALINK_URL, 'Lavalink', { Authorization: password });
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
        'Discord bot exited (code ' + code + ', signal ' + signal + '); stopping Lavalink and YouTube Cipher too.');
    } else {
      finishIfStopped();
    }
  });
}

process.on('SIGTERM', () => shutdown(0, 'Received SIGTERM; stopping all processes.'));
process.on('SIGINT', () => shutdown(0, 'Received SIGINT; stopping all processes.'));

main().catch(error => {
  shutdown(1, error && error.message ? error.message : String(error));
});
