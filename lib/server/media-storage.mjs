import { access, constants, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function mediaBackend() {
  const backend = process.env.MEDIA_STORAGE || 'filesystem';
  if (!['filesystem', 'supabase'].includes(backend)) throw new Error('MEDIA_STORAGE must be filesystem or supabase.');
  return backend;
}

const directory = () => process.env.MEDIA_DIRECTORY || path.join(process.cwd(), '.data', 'media');

/** @param {string} key */
function validateKey(key) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key)) {
    throw new Error('Invalid media storage key.');
  }
}

function cloudConfig() {
  const origin = process.env.SUPABASE_URL;
  let url;
  try { url = new URL(origin); } catch { throw new Error('SUPABASE_URL is required for cloud media.'); }
  if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('SUPABASE_URL must be an HTTPS origin without a trailing slash.');
  const token = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for cloud media.');
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'treasure-hunt-v2-media';
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(bucket)) throw new Error('Use a simple lowercase SUPABASE_STORAGE_BUCKET name.');
  return { origin, token, bucket };
}

/** @param {string} endpoint @param {RequestInit} [options] */
async function storageRequest(endpoint, options = {}) {
  const { origin, token } = cloudConfig();
  const response = await fetch(`${origin}/storage/v1/${endpoint}`, {
    ...options,
    headers: { ...options.headers, apikey: token, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
    cache: 'no-store',
  });
  if (!response.ok) {
    await response.body?.cancel();
    // Never include credential headers or provider response bodies in logs.
    throw new Error(`Private media storage request failed (${response.status}).`);
  }
  return response;
}

export async function validateMediaStorage() {
  if (mediaBackend() === 'filesystem') {
    await mkdir(directory(), { recursive: true, mode: 0o700 });
    await access(directory(), constants.R_OK | constants.W_OK | constants.X_OK);
    return;
  }
  const { bucket } = cloudConfig();
  const details = await (await storageRequest(`bucket/${bucket}`)).json();
  if (details.public !== false) throw new Error('The cloud media bucket must be private.');
}

/** @param {string} key @param {Buffer} bytes @param {string} contentType */
export async function writeMediaBytes(key, bytes, contentType) {
  validateKey(key);
  if (mediaBackend() === 'filesystem') {
    await mkdir(directory(), { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory(), key), bytes, { flag: 'wx', mode: 0o600 });
    return;
  }
  const { bucket } = cloudConfig();
  const response = await storageRequest(`object/${bucket}/${key}`, {
    method: 'POST', headers: { 'Content-Type': contentType, 'x-upsert': 'false', 'Cache-Control': 'no-store' },
    body: new Uint8Array(bytes),
  });
  await response.body?.cancel();
}

/** @param {string} key @returns {Promise<Buffer>} */
export async function readMediaBytes(key) {
  validateKey(key);
  if (mediaBackend() === 'filesystem') return readFile(path.join(directory(), key));
  const { bucket } = cloudConfig();
  return Buffer.from(await (await storageRequest(`object/${bucket}/${key}`)).arrayBuffer());
}

/** @param {string} key */
export async function removeMediaBytes(key) {
  validateKey(key);
  if (mediaBackend() === 'filesystem') {
    try { await unlink(path.join(directory(), key)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return;
  }
  const { bucket } = cloudConfig();
  const response = await storageRequest(`object/${bucket}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }),
  });
  await response.body?.cancel();
}

/** @param {import('pg').Pool} pool */
export async function drainMediaDeletions(pool) {
  const { rows } = await pool.query('select storage_key from hunt_v2.media_deletions order by created_at limit 100');
  for (const row of rows) {
    await removeMediaBytes(row.storage_key);
    await pool.query('delete from hunt_v2.media_deletions where storage_key=$1', [row.storage_key]);
  }
  return rows.length;
}
