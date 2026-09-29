import { NextRequest } from 'next/server';
import { handle, requireSession } from '@/lib/server/http';
import { inspectTeam } from '@/lib/server/results';
import { HttpError } from '@/lib/server/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Explicit private operational inspection, never used by Results/export. */
export async function GET(request: NextRequest) {
  return handle(async () => {
    await requireSession(request, 'admin');
    const teamId = request.nextUrl.searchParams.get('teamId');
    if (!teamId || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(teamId)) throw new HttpError(400, 'Choose a valid team.');
    return inspectTeam(teamId);
  });
}
