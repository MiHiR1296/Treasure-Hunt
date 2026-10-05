import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, lstat, mkdir, open, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const V3_BACKUP_FORMAT = 'treasure-hunt-v3-backup-1';
export const BACKUP_ACK = 'WRITES_QUIESCED';
export const RESTORE_ACK = 'EMPTY_TARGETS_AND_APP_STOPPED';

const SHA256 = /^[0-9a-f]{64}$/;
const STORAGE_KEY = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function requireEnvironment(name, expected) {
  if (process.env[name] !== expected) {
    throw new Error(`Set ${name}=${expected} after satisfying that condition.`);
  }
}

export function databaseTarget(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  let url;
  try { url = new URL(connectionString); } catch { throw new Error('DATABASE_URL must be a PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use postgres:// or postgresql://.');
  let database;
  try { database = decodeURIComponent(url.pathname.slice(1)); } catch { throw new Error('DATABASE_URL contains an invalid database name.'); }
  if (!url.hostname || !url.username || !database || database.includes('/')) {
    throw new Error('DATABASE_URL must explicitly name one database user, host, and database.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  return `${hostname.includes(':') ? `[${hostname}]` : hostname}:${url.port || '5432'}/${database}`;
}

/** @param {Record<string, string | undefined>} [environment] */
export function configuredMediaTarget(environment = process.env) {
  if (!['filesystem', 'supabase'].includes(environment.MEDIA_STORAGE || '')) {
    throw new Error('Set MEDIA_STORAGE explicitly to filesystem or supabase.');
  }
  if (environment.MEDIA_STORAGE === 'filesystem') {
    const directory = environment.MEDIA_DIRECTORY;
    if (!directory || !path.isAbsolute(directory)) throw new Error('Set MEDIA_DIRECTORY to an explicit absolute path.');
    const normalized = path.normalize(directory);
    if (path.parse(normalized).root === normalized) throw new Error('MEDIA_DIRECTORY cannot be a filesystem root.');
    return { backend: 'filesystem', label: `filesystem:${normalized}`, directory: normalized };
  }
  let origin;
  try { origin = new URL(environment.SUPABASE_URL); } catch { throw new Error('SUPABASE_URL is required for Supabase media.'); }
  if (origin.protocol !== 'https:' || origin.origin !== environment.SUPABASE_URL) {
    throw new Error('SUPABASE_URL must be an HTTPS origin without a path or trailing slash.');
  }
  const bucket = environment.SUPABASE_STORAGE_BUCKET || 'treasure-hunt-v3-media';
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(bucket)) throw new Error('SUPABASE_STORAGE_BUCKET is invalid.');
  return { backend: 'supabase', label: `supabase:${origin.host}/${bucket}`, directory: null };
}

export async function assertSafeMediaDirectory(target, { mustBeEmpty = false } = {}) {
  if (target.backend !== 'filesystem' || !target.directory) return;
  let details;
  try { details = await lstat(target.directory); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!mustBeEmpty) throw new Error(`MEDIA_DIRECTORY does not exist: ${target.directory}`);
    await mkdir(target.directory, { recursive: true, mode: 0o700 });
    details = await lstat(target.directory);
  }
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error('MEDIA_DIRECTORY must be a real directory, not a file or symbolic link.');
  }
  if (mustBeEmpty && (await readdir(target.directory)).length) {
    throw new Error('The filesystem media destination is not empty. Use a new directory.');
  }
}

export async function createBackupDirectory(input) {
  if (!input || !path.isAbsolute(input)) throw new Error('Provide an absolute path for a new backup directory.');
  const destination = path.normalize(input);
  if (path.parse(destination).root === destination) throw new Error('The backup destination cannot be a filesystem root.');
  try {
    await lstat(destination);
    throw new Error('The backup destination already exists. Choose a new directory.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(destination, { mode: 0o700 });
  return destination;
}

export function validStorageKey(value) {
  return typeof value === 'string' && STORAGE_KEY.test(value);
}

export async function sha256File(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

export async function writePrivateFile(filename, bytes) {
  const handle = await open(filename, 'wx', 0o600);
  try { await handle.writeFile(bytes); } finally { await handle.close(); }
}

export async function runProgram(command, args, { stdoutFile, label = command } = {}) {
  const { spawn } = await import('node:child_process');
  const url = new URL(process.env.DATABASE_URL);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const postgresEnvironment = {
    PGHOST: hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
  };
  for (const [parameter, variable] of Object.entries({
    sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY',
    connect_timeout: 'PGCONNECT_TIMEOUT', application_name: 'PGAPPNAME', options: 'PGOPTIONS',
  })) {
    if (url.searchParams.has(parameter)) postgresEnvironment[variable] = url.searchParams.get(parameter);
  }
  let output;
  let stdout = 'ignore';
  if (stdoutFile) {
    output = await open(stdoutFile, 'wx', 0o600);
    stdout = output.fd;
  }
  try {
    await new Promise((resolve, reject) => {
      const childEnvironment = { ...process.env, ...postgresEnvironment };
      delete childEnvironment.DATABASE_URL;
      const child = spawn(command, args, {
        env: childEnvironment,
        stdio: ['ignore', stdout, 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', chunk => { if (stderr.length < 16_000) stderr += chunk; });
      child.once('error', error => reject(error.code === 'ENOENT'
        ? new Error(`${label} is not installed or is not available on PATH.`)
        : error));
      child.once('close', code => {
        if (code === 0) resolve();
        else {
          const redacted = stderr.replaceAll(process.env.DATABASE_URL || '', '[database URL redacted]').trim();
          reject(new Error(`${label} failed with exit code ${code}${redacted ? `: ${redacted}` : '.'}`));
        }
      });
    });
  } finally {
    await output?.close();
  }
}

export async function postgresProgramMajor(command) {
  const { spawn } = await import('node:child_process');
  const output = await new Promise((resolve, reject) => {
    const child = spawn(command, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.once('error', error => reject(error.code === 'ENOENT'
      ? new Error(`${command} is not installed or is not available on PATH.`)
      : error));
    child.once('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${command} --version failed.`)));
  });
  const match = String(output).match(/\b(\d+)(?:\.\d+)?\b/);
  if (!match) throw new Error(`Could not determine the ${command} major version.`);
  return Number(match[1]);
}

export function postgresServerMajor(serverVersionNumber) {
  const numeric = Number(serverVersionNumber);
  if (!Number.isSafeInteger(numeric) || numeric < 100000) throw new Error('PostgreSQL returned an invalid server version.');
  return Math.floor(numeric / 10000);
}

export async function schemaTableCounts(pool) {
  const tables = (await pool.query(
    `select table_name from information_schema.tables
      where table_schema='hunt_v3' and table_type='BASE TABLE' order by table_name`,
  )).rows.map(row => row.table_name);
  const result = {};
  for (const table of tables) {
    if (!/^[a-z0-9_]+$/.test(table)) throw new Error('Unexpected V3 table name.');
    const count = Number((await pool.query(`select count(*)::bigint as count from hunt_v3.${table}`)).rows[0].count);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`V3 table ${table} is too large to verify safely.`);
    result[table] = count;
  }
  return result;
}

export function validateManifest(value) {
  if (!value || typeof value !== 'object' || value.format !== V3_BACKUP_FORMAT || value.schema !== 'hunt_v3') {
    throw new Error('This is not a supported Treasure Hunt V3 backup manifest.');
  }
  if (!value.database || value.database.file !== 'database.dump' || !SHA256.test(value.database.sha256 || '')) {
    throw new Error('The V3 database archive metadata is invalid.');
  }
  if (!value.postgres || !Number.isSafeInteger(value.postgres.sourceServerMajor) || value.postgres.sourceServerMajor < 10 ||
    value.postgres.pgDumpMajor !== value.postgres.sourceServerMajor ||
    value.postgres.pgRestoreVerifierMajor !== value.postgres.sourceServerMajor) {
    throw new Error('The V3 PostgreSQL archive version metadata is invalid.');
  }
  if (!value.tableCounts || typeof value.tableCounts !== 'object' || Array.isArray(value.tableCounts)) {
    throw new Error('The V3 table-count manifest is invalid.');
  }
  for (const [table, count] of Object.entries(value.tableCounts)) {
    if (!/^[a-z0-9_]+$/.test(table) || !Number.isSafeInteger(count) || count < 0) throw new Error('The V3 table-count manifest is invalid.');
  }
  if (!value.media || !Array.isArray(value.media.items) || value.media.count !== value.media.items.length) {
    throw new Error('The V3 media manifest is invalid.');
  }
  const keys = new Set();
  let totalBytes = 0;
  for (const item of value.media.items) {
    if (!validStorageKey(item.storageKey) || keys.has(item.storageKey) || !SHA256.test(item.sha256 || '') ||
      !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || typeof item.contentType !== 'string' ||
      !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(item.contentType) || item.contentType.length > 120) {
      throw new Error('The V3 media manifest contains an invalid object.');
    }
    keys.add(item.storageKey);
    totalBytes += item.bytes;
  }
  if (!Number.isSafeInteger(value.media.totalBytes) || value.media.totalBytes !== totalBytes) {
    throw new Error('The V3 media byte total does not match its objects.');
  }
  return value;
}

export async function loadManifest(directory) {
  if (!directory || !path.isAbsolute(directory)) throw new Error('Provide an absolute V3 backup directory.');
  const normalized = path.normalize(directory);
  try {
    await access(path.join(normalized, 'INCOMPLETE'));
    throw new Error('This V3 backup is marked INCOMPLETE and cannot be restored.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const format = (await readFile(path.join(normalized, 'format'), 'utf8')).trim();
  if (format !== V3_BACKUP_FORMAT) throw new Error('This directory is not a supported Treasure Hunt V3 backup.');
  let parsed;
  try { parsed = JSON.parse(await readFile(path.join(normalized, 'manifest.json'), 'utf8')); }
  catch { throw new Error('The V3 backup manifest cannot be read.'); }
  return { directory: normalized, manifest: validateManifest(parsed) };
}
