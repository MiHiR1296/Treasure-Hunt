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

function cloudConfig(staging = false) {
  const origin = process.env.SUPABASE_URL;
  let url;
  try { url = new URL(origin); } catch { throw new Error('SUPABASE_URL is required for cloud media.'); }
  if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('SUPABASE_URL must be an HTTPS origin without a trailing slash.');
  const token = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for cloud media.');
  const bucket = staging ? process.env.SUPABASE_UPLOAD_BUCKET || 'treasure-hunt-v2-incoming'
    : process.env.SUPABASE_STORAGE_BUCKET || 'treasure-hunt-v2-media';
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
    throw new StorageError(response.status);
  }
  return response;
}

class StorageError extends Error {
  constructor(status) { super(`Private media storage request failed (${status}).`); this.status = status; }
}

/** A signing response must never redirect a browser to another origin or object. */
function signedObjectUrl(value, pathname) {
  const { origin } = cloudConfig();
  const url = new URL(`${origin}/storage/v1${value}`);
  if (url.origin !== origin || url.pathname !== `/storage/v1/${pathname}` || !url.searchParams.get('token')) {
    throw new Error('Private media storage returned an invalid signed URL.');
  }
  return url.href;
}

export async function validateUploadStorage() {
  const { bucket } = cloudConfig(true);
  const details = await (await storageRequest(`bucket/${bucket}`)).json();
  if (details.public !== false || Number(details.file_size_limit) > 20_000_000 || !details.file_size_limit) {
    throw new Error('Incoming media needs a private bucket with a maximum 20 MB file limit.');
  }
}

/** @param {string} key */
export async function createMediaUploadUrl(key) {
  validateKey(key);
  await validateUploadStorage();
  const { bucket } = cloudConfig(true);
  const endpoint = `object/upload/sign/${bucket}/${key}`;
  const data = await (await storageRequest(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-upsert': 'false' }, body: '{}',
  })).json();
  return signedObjectUrl(data.url, endpoint);
}

/** @param {string} key @param {number} maximum @returns {Promise<Buffer | null>} */
export async function readIncomingMedia(key, maximum) {
  validateKey(key);
  const { bucket } = cloudConfig(true);
  let response;
  try { response = await storageRequest(`object/${bucket}/${key}`); }
  catch (error) { if (error instanceof StorageError && error.status === 404) return null; throw error; }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The uploaded file is empty.');
  const chunks = [];
  let size = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > maximum) { await reader.cancel(); throw new Error('The uploaded file exceeds its declared size.'); }
    chunks.push(Buffer.from(part.value));
  }
  return Buffer.concat(chunks);
}

/** @param {string} key */
export async function removeIncomingMedia(key) {
  validateKey(key);
  const { bucket } = cloudConfig(true);
  const response = await storageRequest(`object/${bucket}`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }),
  });
  await response.body?.cancel();
}

/** Authorized downloads use short-lived URLs, including native video range requests. */
export async function createMediaReadUrl(key, expiresIn = 60) {
  validateKey(key);
  const { bucket } = cloudConfig();
  const endpoint = `object/sign/${bucket}/${key}`;
  const data = await (await storageRequest(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn }),
  })).json();
  return signedObjectUrl(data.signedURL, endpoint);
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
