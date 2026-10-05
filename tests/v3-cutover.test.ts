import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mediaStorageIsEmpty } from '../lib/server/media-storage.mjs';
import {
  V3_BACKUP_FORMAT,
  assertSafeMediaDirectory,
  configuredMediaTarget,
  createBackupDirectory,
  databaseTarget,
  loadManifest,
  validateManifest,
} from '../scripts/v3-backup-common.mjs';

test('cutover target labels contain no credentials and require explicit media configuration', () => {
  assert.equal(
    databaseTarget('postgresql://private-user:private-password@db.example.test:6543/hunt_restore?sslmode=verify-full'),
    'db.example.test:6543/hunt_restore',
  );
  assert.equal(databaseTarget('postgres://user:secret@[::1]/hunt'), '[::1]:5432/hunt');
  assert.throws(() => databaseTarget('https://example.test/hunt'), /postgres/);
  assert.throws(() => databaseTarget('postgresql://db.example.test/hunt'), /user/);
  assert.throws(() => configuredMediaTarget({}), /MEDIA_STORAGE/);
  assert.deepEqual(
    configuredMediaTarget({
      MEDIA_STORAGE: 'supabase',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_STORAGE_BUCKET: 'treasure-hunt-v3-media',
    }),
    { backend: 'supabase', label: 'supabase:project.supabase.co/treasure-hunt-v3-media', directory: null },
  );
});

test('backup destinations must be new absolute non-root directories', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'hunt-v3-cutover-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const destination = path.join(temporary, 'new-backup');
  assert.equal(await createBackupDirectory(destination), destination);
  await assert.rejects(createBackupDirectory('relative-backup'), /absolute/);
  await assert.rejects(createBackupDirectory(destination), /already exists/);
  await assert.rejects(createBackupDirectory(path.parse(destination).root), /filesystem root/);
});

test('restore filesystem validation refuses symlinks and non-empty targets', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'hunt-v3-media-target-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const target = path.join(temporary, 'empty');
  await assertSafeMediaDirectory({ backend: 'filesystem', label: `filesystem:${target}`, directory: target }, { mustBeEmpty: true });
  await writeFile(path.join(target, 'existing-object'), 'private');
  await assert.rejects(
    assertSafeMediaDirectory({ backend: 'filesystem', label: `filesystem:${target}`, directory: target }, { mustBeEmpty: true }),
    /not empty/,
  );
  const link = path.join(temporary, 'media-link');
  await symlink(target, link);
  await assert.rejects(
    assertSafeMediaDirectory({ backend: 'filesystem', label: `filesystem:${link}`, directory: link }),
    /symbolic link/,
  );
});

test('media restore preflight detects files in the configured durable directory', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'hunt-v3-media-empty-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const previousStorage = process.env.MEDIA_STORAGE;
  const previousDirectory = process.env.MEDIA_DIRECTORY;
  process.env.MEDIA_STORAGE = 'filesystem';
  process.env.MEDIA_DIRECTORY = temporary;
  t.after(() => {
    if (previousStorage === undefined) delete process.env.MEDIA_STORAGE;
    else process.env.MEDIA_STORAGE = previousStorage;
    if (previousDirectory === undefined) delete process.env.MEDIA_DIRECTORY;
    else process.env.MEDIA_DIRECTORY = previousDirectory;
  });
  assert.equal(await mediaStorageIsEmpty(), true);
  await writeFile(path.join(temporary, 'existing-private-object'), 'private');
  assert.equal(await mediaStorageIsEmpty(), false);
});

test('backup manifests reject traversal, duplicate objects, bad totals, and incomplete archives', async t => {
  const key = '00000000-0000-4000-8000-000000000001-00000000-0000-4000-8000-000000000002';
  const base = {
    format: V3_BACKUP_FORMAT,
    schema: 'hunt_v3',
    database: { file: 'database.dump', sha256: 'a'.repeat(64) },
    postgres: { sourceServerMajor: 17, pgDumpMajor: 17, pgRestoreVerifierMajor: 17 },
    tableCounts: { runs: 2 },
    media: { count: 1, totalBytes: 3, items: [{ storageKey: key, contentType: 'image/jpeg', bytes: 3, sha256: 'b'.repeat(64) }] },
  };
  assert.equal(validateManifest(base), base);
  assert.throws(() => validateManifest({ ...base, database: { ...base.database, file: '../database.dump' } }), /database archive/);
  assert.throws(() => validateManifest({ ...base, media: { ...base.media, totalBytes: 4 } }), /byte total/);
  assert.throws(() => validateManifest({ ...base, media: { count: 1, totalBytes: 3, items: [{ ...base.media.items[0], storageKey: '../secret' }] } }), /invalid object/);
  assert.throws(() => validateManifest({ ...base, media: { count: 2, totalBytes: 6, items: [base.media.items[0], base.media.items[0]] } }), /invalid object/);

  const directory = await mkdtemp(path.join(os.tmpdir(), 'hunt-v3-incomplete-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'format'), `${V3_BACKUP_FORMAT}\n`);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(base));
  await writeFile(path.join(directory, 'INCOMPLETE'), 'do not restore');
  await assert.rejects(loadManifest(directory), /INCOMPLETE/);
  await rm(path.join(directory, 'INCOMPLETE'));
  assert.deepEqual((await loadManifest(directory)).manifest, base);
});

test('V3 smoke performs read-only health and listing requests', async t => {
  const requests: Array<{ method?: string; url?: string }> = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/v3/health') response.end(JSON.stringify({ status: 'ok', engine: 'v3' }));
    else if (request.url === '/api/v3/hunts') response.end(JSON.stringify({ hunts: [] }));
    else if (request.url === '/api/v3/public-board/event-board') response.end(JSON.stringify({ title: 'The pin_hash detectives', rows: [] }));
    else { response.statusCode = 404; response.end('{}'); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const address = server.address();
  assert(address && typeof address === 'object');
  const child = spawn(process.execPath, ['scripts/v3-smoke.mjs'], {
    cwd: path.resolve('.'),
    env: { ...process.env, SMOKE_ORIGIN: `http://127.0.0.1:${address.port}`, SMOKE_PUBLIC_BOARD_SLUG: 'event-board' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 0, output);
  assert.match(output, /read-only smoke passed/);
  assert.deepEqual(requests, [
    { method: 'GET', url: '/api/v3/health' },
    { method: 'GET', url: '/api/v3/hunts' },
    { method: 'GET', url: '/api/v3/public-board/event-board' },
  ]);
});
