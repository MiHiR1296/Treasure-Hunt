import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getPool } from './db';

const scrypt = promisify(scryptCallback);
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
export const ADMIN_SESSION_SECONDS = 60 * 60 * 12;
export const TEAM_COOKIE = 'hunt_v2_team';
export const ADMIN_COOKIE = 'hunt_v2_admin';
export const PREVIEW_COOKIE = 'hunt_v2_preview';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: { issues?: { path: string; message: string }[] }) { super(message); }
}
export const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export async function hashPin(pin: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(pin, salt, 64) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPin(pin: string, stored: string) {
  const [salt, hash] = stored.split(':');
  const derived = await scrypt(pin, salt, 64) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
export function verifyAdminPassword(password: string) {
  const configured = process.env.ORGANIZER_PASSWORD;
  if (!configured || configured.length < 12) throw new HttpError(503, 'Organizer sign-in is not configured.');
  return timingSafeEqual(Buffer.from(digest(password)), Buffer.from(digest(configured)));
}
export function createSessionToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: digest(token) };
}
export async function authenticate(token: string | undefined, role: 'team' | 'admin') {
  if (!token || token.length > 128) throw new HttpError(401, 'Please sign in to continue.');
  const { rows } = await getPool().query(
    'select team_id, player_name from hunt_v2.sessions where token_hash=$1 and role=$2 and expires_at>now()',
    [digest(token), role],
  );
  if (!rows[0]) throw new HttpError(401, 'Your session has expired. Please sign in again.');
  return rows[0] as { team_id: string; player_name: string };
}
// Shared database rate limits continue to work across processes and restarts.
export async function rateLimit(key: string, maximum = 15) {
  const { rows } = await getPool().query(`
    insert into hunt_v2.rate_limits (key,attempts) values ($1,1)
    on conflict (key) do update set
      attempts=case when hunt_v2.rate_limits.window_start < now()-interval '15 minutes' then 1 else hunt_v2.rate_limits.attempts+1 end,
      window_start=case when hunt_v2.rate_limits.window_start < now()-interval '15 minutes' then now() else hunt_v2.rate_limits.window_start end
    returning attempts`, [digest(key)]);
  if (rows[0].attempts > maximum) throw new HttpError(429, 'Too many attempts. Please try again in 15 minutes.');
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
