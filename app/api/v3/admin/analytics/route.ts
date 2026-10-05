import { NextRequest } from 'next/server';
import { handle } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { eventAnalytics } from '@/lib/server/v3/operations';
import { requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handle(async () => {
    await requireV3Session(request, 'admin');
    const huntId = request.nextUrl.searchParams.get('huntId');
    if (!huntId) throw new HttpError(400, 'Choose a hunt.');
    return eventAnalytics(huntId);
  });
}
