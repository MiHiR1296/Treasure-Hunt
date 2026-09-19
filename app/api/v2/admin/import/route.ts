import { NextRequest } from 'next/server';
import { handle, jsonBody, requireSession } from '@/lib/server/http';
import { importLegacy } from '@/lib/server/legacy-import';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  return handle(async () => {
    await requireSession(request,'admin');
    const body = await jsonBody(request);
    return importLegacy(body.source, typeof body.huntId === 'string' ? body.huntId : undefined);
  });
}
