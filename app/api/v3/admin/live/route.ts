import { NextRequest } from 'next/server';
import { handle } from '@/lib/server/http';
import { liveOperations } from '@/lib/server/v3/operations';
import { requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handle(async () => {
    await requireV3Session(request, 'admin');
    return liveOperations(request.nextUrl.searchParams.get('huntId') || undefined, request.nextUrl.searchParams.get('q') || '');
  });
}
