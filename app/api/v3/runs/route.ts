import { NextRequest } from 'next/server';
import { handle, jsonBody, textField } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { createRun, currentRunView } from '@/lib/server/v3/runs';
import { requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'team');
    const runId = request.nextUrl.searchParams.get('runId') || undefined;
    if (runId && !/^[0-9a-f-]{36}$/i.test(runId)) throw new HttpError(400, 'Invalid run.');
    return { view: await currentRunView(session.teamId, session.memberId, runId) };
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'team');
    const body = await jsonBody(request);
    if (Object.keys(body).some(key => !['requestId', 'practice'].includes(key))) throw new HttpError(400, 'Unsupported run fields.');
    if (body.practice !== undefined && typeof body.practice !== 'boolean') throw new HttpError(400, 'Practice must be true or false.');
    return { view: await createRun(session.teamId, session.memberId, textField(body, 'requestId'), body.practice === true) };
  });
}
