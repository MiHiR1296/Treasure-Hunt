import { timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { getPool } from '@/lib/server/db';
import { handle } from '@/lib/server/http';
import { digest, HttpError } from '@/lib/server/security';
import { runMaintenance } from '@/lib/server/maintenance.mjs';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || secret.length < 32) throw new HttpError(503, 'Scheduled cleanup is not configured.');
    const supplied = request.headers.get('authorization') || '';
    if (!timingSafeEqual(Buffer.from(digest(supplied)), Buffer.from(digest(`Bearer ${secret}`)))) throw new HttpError(401, 'Scheduled cleanup authorization is required.');
    return { ok: true, ...await runMaintenance(getPool()) };
  });
}
