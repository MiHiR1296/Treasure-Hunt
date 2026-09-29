import { NextRequest } from 'next/server';
import { handle, jsonBody, requireSession, textField } from '@/lib/server/http';
import { listResults, resultActivity, resultBatch, resultHistory, resultManifest, teamResult } from '@/lib/server/results';
import { HttpError } from '@/lib/server/security';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  return handle(async () => {
    await requireSession(request, 'admin');
    const params = request.nextUrl.searchParams, teamId = params.get('teamId');
    if (teamId) {
      if (!/^[0-9a-f-]{36}$/i.test(teamId)) throw new HttpError(400, 'Choose a valid team.');
      if (params.get('section') === 'activity') return resultActivity(teamId, Number(params.get('throughRevision')), Number(params.get('afterRevision') ?? -1), Number(params.get('afterOrdinal') ?? -1));
      const section = params.get('section');
      if (section === 'events' || section === 'ledger' || section === 'help') return resultHistory(teamId, section, Number(params.get('throughRevision')), Number(params.get('count')), Number(params.get('offset') ?? 0), params.get('asOf') ?? '');
      if (section) throw new HttpError(400, 'Unsupported result section.');
      return teamResult(teamId);
    }
    const huntId = params.get('huntId');
    if (!huntId) throw new HttpError(400, 'Choose a hunt.');
    if (params.get('manifest') === '1') return resultManifest(huntId);
    return listResults(huntId, params.get('after') ?? '', params.get('asOf') ?? undefined);
  });
}
export async function POST(request: NextRequest) {
  return handle(async () => {
    await requireSession(request, 'admin'); const body = await jsonBody(request);
    return resultBatch(textField(body, 'huntId'), body.ids, textField(body, 'asOf'));
  });
}
