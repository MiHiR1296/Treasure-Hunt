import { spawn } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mediaBackend, validateMediaStorage } from '../lib/server/media-storage.mjs';

// A volume can belong to only one cloud service. Keep the HTTP server and
// retention worker together, and restart both if either process exits.
const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Map();
let stopping = false;
let killTimer;

function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children.keys()) child.kill('SIGTERM');
  killTimer = setTimeout(() => {
    for (const child of children.keys()) child.kill('SIGKILL');
  }, 10_000);
  killTimer.unref();
}

process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));

function start(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  const finished = new Promise(resolve => {
    child.once('error', () => {
      console.error(`Could not start ${name}.`);
      stop(1);
    });
    child.once('close', (code, signal) => {
      children.delete(child);
      if (!children.size) clearTimeout(killTimer);
      resolve({ code, signal });
    });
  });
  children.set(child, finished);
  return finished;
}

async function configure() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  if ((process.env.ORGANIZER_PASSWORD || '').length < 12) {
    throw new Error('ORGANIZER_PASSWORD must contain at least 12 characters.');
  }
  const origin = process.env.APP_ORIGIN
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
    || process.env.RENDER_EXTERNAL_URL;
  let parsed;
  try { parsed = new URL(origin); } catch { throw new Error('Set APP_ORIGIN to the public HTTPS origin.'); }
  if (parsed.protocol !== 'https:' || parsed.origin !== origin) {
    throw new Error('APP_ORIGIN must be an HTTPS origin without a path or trailing slash.');
  }
  process.env.APP_ORIGIN = origin;

  if (mediaBackend() === 'filesystem') {
    const directory = process.env.MEDIA_DIRECTORY;
    if (!directory || !path.isAbsolute(directory)) {
      throw new Error('Set MEDIA_DIRECTORY to an absolute path on a persistent volume.');
    }
    if (process.env.RAILWAY_PROJECT_ID) {
      const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH;
      if (!mount) throw new Error('Attach a persistent media volume before starting the Railway service.');
      // Resolve symlinks too: the media directory must actually be on the volume.
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const relative = path.relative(await realpath(mount), await realpath(directory));
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('MEDIA_DIRECTORY must be inside RAILWAY_VOLUME_MOUNT_PATH.');
      }
    }
  }
  await validateMediaStorage();
  const port = process.env.PORT || '3000';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('PORT must be between 1 and 65535.');
  }
  process.env.NODE_ENV = 'production';
  process.env.ENABLE_LEGACY_V1 = 'false';
  return port;
}

try {
  const port = await configure();
  if (!stopping) {
    const migration = await start('database migration', ['scripts/v2-migrate.mjs']);
    if (!stopping && migration.code !== 0) throw new Error('Database migration failed; the web server was not started.');
  }
  if (!stopping) {
    const watch = async (name, args) => {
      const result = await start(name, args);
      if (!stopping) {
        console.error(`${name} stopped unexpectedly (${result.signal || result.code}); restarting the service is required.`);
        stop(1);
      }
    };
    console.log('Starting the hunt server and media retention worker.');
    await Promise.all([
      watch('web server', ['node_modules/next/dist/bin/next', 'start', '--hostname', '0.0.0.0', '--port', port]),
      watch('media retention worker', ['scripts/v2-maintenance.mjs']),
    ]);
  }
} catch (error) {
  // Do not print connection strings, passwords, filesystem contents or stacks.
  console.error(error.code ? `Cloud startup failed (${error.code}). Check the database and media volume configuration.` : error.message);
  stop(1);
  await Promise.all(children.values());
}
