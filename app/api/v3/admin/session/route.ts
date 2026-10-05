import { NextRequest } from 'next/server';
import { handle, jsonBody } from '@/lib/server/http';
import { getPool } from '@/lib/server/db';
import { HttpError } from '@/lib/server/security';
import {
  V3_ADMIN_COOKIE,
  createV3AdminSession,
  digest,
  v3RequestSource,
  v3SessionResponse,
} from '@/lib/server/v3/security';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return handle(async () => {
    const body = await jsonBody(request);
    if (typeof body.password !== 'string' || !body.password || body.password.length > 500) {
      throw new HttpError(400, 'Enter your organizer password.');
    }
    const name = typeof body.name === 'string' ? body.name : 'Organizer';
    const session = await createV3AdminSession(body.password, name, v3RequestSource(request));
    return v3SessionResponse({ ok: true }, session.token, 'admin', request);
  });
}

export async function DELETE(request: NextRequest) {
  return handle(async () => {
    await jsonBody(request);
    const token = request.cookies.get(V3_ADMIN_COOKIE)?.value;
    if (token) await getPool().query('update hunt_v3.sessions set revoked_at=coalesce(revoked_at,now()) where token_hash=$1', [digest(token)]);
    return v3SessionResponse({ ok: true }, '', 'admin', request);
  });
}
