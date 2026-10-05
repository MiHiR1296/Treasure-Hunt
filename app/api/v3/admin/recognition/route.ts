import { NextRequest } from 'next/server';
import { handle, jsonBody, textField } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { overrideRecognition, recognitionAudit } from '@/lib/server/v3/operations';
import { isV3Uuid, requireV3Session, requireV3Uuid } from '@/lib/server/v3/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handle(async () => {
    await requireV3Session(request, 'admin');
    const runId = request.nextUrl.searchParams.get('runId');
    if (!isV3Uuid(runId)) throw new HttpError(400, 'Choose a run.');
    return recognitionAudit(runId);
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'admin');
    const body = await jsonBody(request);
    if (body.action !== 'override') throw new HttpError(400, 'Unsupported recognition action.');
    return overrideRecognition({
      runId: requireV3Uuid(textField(body, 'runId'), 'Choose a valid run.'),
      memberId: requireV3Uuid(textField(body, 'memberId'), 'Choose a valid team member.'),
      headlineTitle: typeof body.headlineTitle === 'string' ? body.headlineTitle : undefined,
      dataTitle: typeof body.dataTitle === 'string' ? body.dataTitle : undefined,
      peerTitle: typeof body.peerTitle === 'string' ? body.peerTitle : undefined,
      explanation: typeof body.explanation === 'string' ? body.explanation : undefined,
      reason: textField(body, 'reason', 500),
      actor: session.organizerName,
    });
  });
}
