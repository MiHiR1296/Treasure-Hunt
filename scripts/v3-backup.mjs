import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { databaseConfig } from '../lib/server/database-config.mjs';
import { readMediaBytes, validateMediaStorage } from '../lib/server/media-storage.mjs';
import {
  BACKUP_ACK,
  V3_BACKUP_FORMAT,
  assertSafeMediaDirectory,
  configuredMediaTarget,
  createBackupDirectory,
  databaseTarget,
  postgresProgramMajor,
  postgresServerMajor,
  requireEnvironment,
  runProgram,
  schemaTableCounts,
  sha256File,
  validStorageKey,
  writePrivateFile,
} from './v3-backup-common.mjs';

const describe = process.argv.includes('--describe-targets');
const destinationArgument = process.argv.slice(2).find(argument => !argument.startsWith('--'));
const databaseSource = databaseTarget();
const mediaSource = configuredMediaTarget();
if (describe) {
  console.log(`V3_BACKUP_DATABASE_SOURCE=${databaseSource}`);
  console.log(`V3_BACKUP_MEDIA_SOURCE=${mediaSource.label}`);
  process.exit(0);
}
requireEnvironment('V3_BACKUP_ACK', BACKUP_ACK);
requireEnvironment('V3_BACKUP_DATABASE_SOURCE', databaseSource);
requireEnvironment('V3_BACKUP_MEDIA_SOURCE', mediaSource.label);
await assertSafeMediaDirectory(mediaSource);
await validateMediaStorage();

const destination = await createBackupDirectory(destinationArgument);
await writePrivateFile(path.join(destination, 'INCOMPLETE'), Buffer.from('Backup did not complete. Do not restore this directory.\n'));
await mkdir(path.join(destination, 'media'), { mode: 0o700 });
const pool = new Pool({ ...databaseConfig(), max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
try {
  const schema = await pool.query("select to_regnamespace('hunt_v3') is not null as present");
  if (!schema.rows[0].present) throw new Error('The source database does not contain hunt_v3.');
  const sourceServerMajor = postgresServerMajor((await pool.query('show server_version_num')).rows[0].server_version_num);
  const pgDumpMajor = await postgresProgramMajor('pg_dump');
  const pgRestoreVerifierMajor = await postgresProgramMajor('pg_restore');
  if (pgDumpMajor !== sourceServerMajor) {
    throw new Error(`pg_dump major ${pgDumpMajor} does not match PostgreSQL ${sourceServerMajor}. Use the matching client tools.`);
  }
  if (pgRestoreVerifierMajor !== sourceServerMajor) {
    throw new Error(`pg_restore major ${pgRestoreVerifierMajor} does not match PostgreSQL ${sourceServerMajor}. Use the matching client tools.`);
  }
  const pending = await pool.query(
    `select
      (select count(*)::int from hunt_v3.media_uploads where completed_at is null) as uploads,
      (select count(*)::int from hunt_v3.media_deletions) as deletions`,
  );
  if (pending.rows[0].uploads) throw new Error('V3 has unfinished direct uploads. Finish or expire them before taking a backup.');
  if (pending.rows[0].deletions) throw new Error('V3 has pending media deletions. Run maintenance successfully before taking a backup.');

  const tableCounts = await schemaTableCounts(pool);
  const mediaRows = (await pool.query(
    `select storage_key,content_type,bytes,content_hash
      from hunt_v3.media order by storage_key`,
  )).rows;
  await runProgram('pg_dump', ['--format=custom', '--schema=hunt_v3', '--no-owner', '--no-privileges', '--no-password'], {
    stdoutFile: path.join(destination, 'database.dump'),
    label: 'pg_dump',
  });
  await runProgram('pg_restore', ['--list', path.join(destination, 'database.dump')], { label: 'pg_restore' });

  const mediaItems = [];
  let totalBytes = 0;
  for (const row of mediaRows) {
    if (!validStorageKey(row.storage_key)) throw new Error('The database contains an invalid media storage key.');
    const bytes = await readMediaBytes(row.storage_key);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== row.bytes || hash !== row.content_hash) {
      throw new Error(`Stored media ${row.storage_key} does not match its database metadata.`);
    }
    await writePrivateFile(path.join(destination, 'media', row.storage_key), bytes);
    mediaItems.push({ storageKey: row.storage_key, contentType: row.content_type, bytes: bytes.length, sha256: hash });
    totalBytes += bytes.length;
  }

  const afterCounts = await schemaTableCounts(pool);
  const afterMedia = (await pool.query(
    `select storage_key,content_type,bytes,content_hash
      from hunt_v3.media order by storage_key`,
  )).rows;
  if (JSON.stringify(tableCounts) !== JSON.stringify(afterCounts) || JSON.stringify(mediaRows) !== JSON.stringify(afterMedia)) {
    throw new Error('V3 changed while the backup was running. Keep writes stopped and create a new backup directory.');
  }
  const manifest = {
    format: V3_BACKUP_FORMAT,
    schema: 'hunt_v3',
    createdAt: new Date().toISOString(),
    source: { database: databaseSource, media: mediaSource.label },
    postgres: { sourceServerMajor, pgDumpMajor, pgRestoreVerifierMajor },
    database: { file: 'database.dump', sha256: await sha256File(path.join(destination, 'database.dump')) },
    tableCounts,
    media: { count: mediaItems.length, totalBytes, items: mediaItems },
  };
  await writePrivateFile(path.join(destination, 'manifest.json'), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  await writePrivateFile(path.join(destination, 'format'), Buffer.from(`${V3_BACKUP_FORMAT}\n`));
  // Re-read the dump after the final metadata write to catch local disk errors.
  if (await sha256File(path.join(destination, 'database.dump')) !== manifest.database.sha256) {
    throw new Error('The completed database archive failed its final checksum.');
  }
  // The format and manifest are written only after every hash and source-stability check passes.
  await unlink(path.join(destination, 'INCOMPLETE'));
  console.log(`V3 database and ${mediaItems.length} media objects backed up to ${destination}.`);
} catch (error) {
  console.error(`V3 backup failed; ${destination} remains marked INCOMPLETE.`);
  throw error;
} finally {
  await pool.end();
}
