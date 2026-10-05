import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { databaseConfig } from '../lib/server/database-config.mjs';
import { mediaStorageIsEmpty, readMediaBytes, validateMediaStorage, writeMediaBytes } from '../lib/server/media-storage.mjs';
import {
  RESTORE_ACK,
  assertSafeMediaDirectory,
  configuredMediaTarget,
  databaseTarget,
  loadManifest,
  postgresProgramMajor,
  postgresServerMajor,
  requireEnvironment,
  runProgram,
  schemaTableCounts,
  sha256File,
} from './v3-backup-common.mjs';

const sourceArgument = process.argv.slice(2).find(argument => !argument.startsWith('--'));
const { directory, manifest } = await loadManifest(sourceArgument);
const describe = process.argv.includes('--describe-targets');
const databaseDestination = databaseTarget();
const mediaDestination = configuredMediaTarget();
if (describe) {
  console.log(`V3_RESTORE_DATABASE_TARGET=${databaseDestination}`);
  console.log(`V3_RESTORE_MEDIA_TARGET=${mediaDestination.label}`);
  process.exit(0);
}
requireEnvironment('V3_RESTORE_ACK', RESTORE_ACK);
requireEnvironment('V3_RESTORE_DATABASE_TARGET', databaseDestination);
requireEnvironment('V3_RESTORE_MEDIA_TARGET', mediaDestination.label);

const dump = path.join(directory, manifest.database.file);
if (await sha256File(dump) !== manifest.database.sha256) throw new Error('The database archive checksum does not match its manifest.');
for (const item of manifest.media.items) {
  const bytes = await readFile(path.join(directory, 'media', item.storageKey));
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== item.bytes || hash !== item.sha256) throw new Error(`Backup media ${item.storageKey} failed verification.`);
}
await runProgram('pg_restore', ['--list', dump], { label: 'pg_restore' });
const pgRestoreMajor = await postgresProgramMajor('pg_restore');
await assertSafeMediaDirectory(mediaDestination, { mustBeEmpty: true });
await validateMediaStorage();
if (!await mediaStorageIsEmpty()) throw new Error('The configured media destination is not empty. Use a new private bucket or directory.');

let pool = new Pool({ ...databaseConfig(), max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
try {
  const [schema, version] = await Promise.all([
    pool.query("select to_regnamespace('hunt_v3') is not null as present"),
    pool.query('show server_version_num'),
  ]);
  if (schema.rows[0].present) throw new Error('The destination already contains hunt_v3. Restore only into a fresh target.');
  const destinationServerMajor = postgresServerMajor(version.rows[0].server_version_num);
  if (destinationServerMajor < manifest.postgres.sourceServerMajor) {
    throw new Error(`The destination PostgreSQL ${destinationServerMajor} is older than backup source ${manifest.postgres.sourceServerMajor}.`);
  }
  if (pgRestoreMajor !== destinationServerMajor) {
    throw new Error(`pg_restore major ${pgRestoreMajor} does not match destination PostgreSQL ${destinationServerMajor}. Use the matching client tools.`);
  }
} finally {
  await pool.end();
}

await runProgram('pg_restore', [
  '--no-owner',
  '--no-privileges',
  '--single-transaction',
  '--exit-on-error',
  '--no-password',
  '--dbname',
  databaseDestination.slice(databaseDestination.lastIndexOf('/') + 1),
  dump,
], { label: 'pg_restore' });

for (const item of manifest.media.items) {
  const bytes = await readFile(path.join(directory, 'media', item.storageKey));
  await writeMediaBytes(item.storageKey, bytes, item.contentType);
  const restored = await readMediaBytes(item.storageKey);
  if (restored.length !== item.bytes || createHash('sha256').update(restored).digest('hex') !== item.sha256) {
    throw new Error(`Restored media ${item.storageKey} failed verification. Discard this restore target.`);
  }
}

pool = new Pool({ ...databaseConfig(), max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
try {
  const restoredCounts = await schemaTableCounts(pool);
  if (JSON.stringify(restoredCounts) !== JSON.stringify(manifest.tableCounts)) {
    throw new Error('Restored V3 table counts do not match the backup. Discard this restore target.');
  }
} finally {
  await pool.end();
}
console.log(`Verified V3 restore with ${manifest.media.count} media objects in ${databaseDestination}.`);
