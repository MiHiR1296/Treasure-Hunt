import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

// Real child processes exercise startup ordering and signal handling without
// connecting to, or modifying, an organizer's event database.
async function fixture(t: TestContext, options: { migrationFailure?: boolean; workerFailure?: boolean; env?: Record<string, string> } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hunt-cloud-start-'));
  await mkdir(path.join(root, 'scripts'));
  await mkdir(path.join(root, 'lib/server'), { recursive: true });
  await mkdir(path.join(root, 'node_modules/next/dist/bin'), { recursive: true });
  await mkdir(path.join(root, 'media'));
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await copyFile(new URL('../scripts/v2-cloud-start.mjs', import.meta.url), path.join(root, 'scripts/v2-cloud-start.mjs'));
  await copyFile(new URL('../lib/server/media-storage.mjs', import.meta.url), path.join(root, 'lib/server/media-storage.mjs'));
  await writeFile(path.join(root, 'scripts/v2-migrate.mjs'), `
    import { writeFileSync } from 'node:fs';
    writeFileSync('migration-started', 'yes');
    process.exit(${options.migrationFailure ? 1 : 0});
  `);
  const child = (name: string) => `
    import { writeFileSync, existsSync } from 'node:fs';
    if (!existsSync('migration-started')) process.exit(2);
    writeFileSync('${name}-started', process.env.APP_ORIGIN);
    process.on('SIGTERM', () => { writeFileSync('${name}-stopped', 'yes'); process.exit(0); });
    ${name === 'worker' && options.workerFailure ? "setInterval(() => { if (existsSync('web-started')) process.exit(7); }, 20);" : 'setInterval(() => {}, 1000);'}
  `;
  await writeFile(path.join(root, 'node_modules/next/dist/bin/next'), child('web'));
  await writeFile(path.join(root, 'scripts/v2-maintenance.mjs'), child('worker'));
  const env = { ...process.env };
  for (const key of ['APP_ORIGIN', 'RENDER_EXTERNAL_URL', 'RAILWAY_PROJECT_ID', 'RAILWAY_PUBLIC_DOMAIN', 'RAILWAY_VOLUME_MOUNT_PATH']) delete env[key];
  const processUnderTest = spawn(process.execPath, ['scripts/v2-cloud-start.mjs'], {
    cwd: root,
    env: { ...env, DATABASE_URL: 'postgresql://unused.invalid/hunt', ORGANIZER_PASSWORD: 'fixture-password-only',
      APP_ORIGIN: 'https://hunt.example.test', MEDIA_STORAGE: 'filesystem', MEDIA_DIRECTORY: path.join(root, 'media'), ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  processUnderTest.stdout.on('data', chunk => { output += chunk; });
  processUnderTest.stderr.on('data', chunk => { output += chunk; });
  const closed = once(processUnderTest, 'close');
  t.after(async () => {
    if (processUnderTest.exitCode === null && processUnderTest.signalCode === null) processUnderTest.kill('SIGTERM');
    await closed;
    await rm(root, { recursive: true, force: true });
  });
  const waitFor = async (file: string) => {
    for (let i = 0; i < 150; i++) {
      try { return await readFile(path.join(root, file), 'utf8'); } catch { await delay(20); }
    }
    assert.fail(`Timed out waiting for ${file}: ${output}`);
  };
  return { root, processUnderTest, closed, waitFor, output: () => output };
}

test('cloud startup migrates, runs both processes and shuts down both on SIGTERM', { timeout: 10_000 }, async t => {
  const f = await fixture(t, { env: { APP_ORIGIN: '', RAILWAY_PUBLIC_DOMAIN: 'demo.up.railway.app' } });
  assert.equal(await f.waitFor('web-started'), 'https://demo.up.railway.app');
  assert.equal(await f.waitFor('worker-started'), 'https://demo.up.railway.app');
  f.processUnderTest.kill('SIGTERM');
  assert.equal((await f.closed)[0], 0);
  assert.equal(await f.waitFor('web-stopped'), 'yes');
  assert.equal(await f.waitFor('worker-stopped'), 'yes');
});

test('cloud startup refuses to serve after a failed migration', { timeout: 10_000 }, async t => {
  const f = await fixture(t, { migrationFailure: true });
  assert.equal((await f.closed)[0], 1);
  assert.match(f.output(), /Database migration failed/);
  await assert.rejects(readFile(path.join(f.root, 'web-started')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(f.root, 'worker-started')), { code: 'ENOENT' });
});

test('a failed retention worker stops the web process and fails the cloud service', { timeout: 10_000 }, async t => {
  const f = await fixture(t, { workerFailure: true });
  assert.equal((await f.closed)[0], 1);
  assert.match(f.output(), /media retention worker stopped unexpectedly/);
  assert.equal(await f.waitFor('web-stopped'), 'yes');
});

test('Railway without durable media fails before any migration or server starts', { timeout: 10_000 }, async t => {
  const f = await fixture(t, { env: { RAILWAY_PROJECT_ID: 'fixture-project' } });
  assert.equal((await f.closed)[0], 1);
  assert.match(f.output(), /Attach a persistent media volume/);
  await assert.rejects(readFile(path.join(f.root, 'migration-started')), { code: 'ENOENT' });
});
