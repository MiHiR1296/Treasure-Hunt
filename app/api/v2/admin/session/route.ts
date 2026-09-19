import { NextRequest } from 'next/server';
import { handle, jsonBody, sessionResponse } from '@/lib/server/http';
import { getPool } from '@/lib/server/db';
import { ADMIN_COOKIE, ADMIN_SESSION_SECONDS, createSessionToken, digest, HttpError, rateLimit, verifyAdminPassword } from '@/lib/server/security';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  return handle(async () => {
    const body = await jsonBody(request);
    if (typeof body.password !== 'string' || !body.password || body.password.length > 500) throw new HttpError(400, 'Enter your organizer password.');
    // A correct credential always lets an organizer rescue a live event. Failures
    // are throttled; deliberately bad requests cannot lock out the real organizer.
    if (!verifyAdminPassword(body.password)) {
      await rateLimit('organizer-signin-failures');
      throw new HttpError(401, 'Incorrect organizer password.');
    }
    const session = createSessionToken();
    await getPool().query(`insert into hunt_v2.sessions (token_hash,role,expires_at)
      values ($1,'admin',now()+$2*interval '1 second')`, [session.hash, ADMIN_SESSION_SECONDS]);
    return sessionResponse({ ok: true }, session.token, 'admin', request);
  });
}
export async function DELETE(request: NextRequest) {
  return handle(async () => {
    await jsonBody(request);
    const token = request.cookies.get(ADMIN_COOKIE)?.value;
    if (token) await getPool().query('delete from hunt_v2.sessions where token_hash=$1', [digest(token)]);
    return sessionResponse({ ok: true }, '', 'admin', request);
  });
}
