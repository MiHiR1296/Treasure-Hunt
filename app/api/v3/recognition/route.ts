import { NextRequest } from 'next/server';
import { handle, jsonBody, textField } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { PEER_RECOGNITION_SUBTYPES, type PeerRecognitionCategory, type PeerRecognitionSubtype } from '@/lib/v3/types';
import { privateRecognition, saveRecognitionVote } from '@/lib/server/v3/recognition';
import { requireV3Session, v3RequestSource } from '@/lib/server/v3/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const categories = Object.keys(PEER_RECOGNITION_SUBTYPES) as PeerRecognitionCategory[];
const subtypes = new Set<PeerRecognitionSubtype>(Object.values(PEER_RECOGNITION_SUBTYPES).flat());

export async function GET(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'team');
    const runId = request.nextUrl.searchParams.get('runId');
    const scope = request.nextUrl.searchParams.get('scope') === 'all' ? 'all' : 'run';
    if (!runId || !/^[0-9a-f-]{36}$/i.test(runId)) throw new HttpError(400, 'Choose a completed run.');
    return privateRecognition(session.teamId, session.memberId, runId, scope);
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'team');
    const body = await jsonBody(request);
    if (Object.keys(body).some(key => !['runId', 'requestId', 'recipientMemberId', 'category', 'subtype'].includes(key))) {
      throw new HttpError(400, 'Unsupported recognition fields.');
    }
    const category = textField(body, 'category') as PeerRecognitionCategory;
    const subtype = textField(body, 'subtype') as PeerRecognitionSubtype;
    if (!categories.includes(category) || !subtypes.has(subtype)) throw new HttpError(400, 'Choose an available crew strength.');
    return saveRecognitionVote({
      teamId: session.teamId,
      memberId: session.memberId,
      runId: textField(body, 'runId'),
      requestId: textField(body, 'requestId'),
      recipientMemberId: textField(body, 'recipientMemberId'),
      category,
      subtype,
      requestSource: v3RequestSource(request),
    });
  });
}
