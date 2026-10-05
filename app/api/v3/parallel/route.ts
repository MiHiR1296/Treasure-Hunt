import { NextRequest } from 'next/server';
import { handle, jsonBody, textField } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { parallelPhotoReviewStatus, submitParallelLane } from '@/lib/server/v3/parallel';
import { requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'team');
    const url = new URL(request.url);
    return parallelPhotoReviewStatus({
      teamId: session.teamId,
      memberId: session.memberId,
      runId: url.searchParams.get('runId') ?? '',
      mediaId: url.searchParams.get('mediaId') ?? '',
      mechanicId: url.searchParams.get('mechanicId') ?? '',
      laneId: url.searchParams.get('laneId') ?? '',
    });
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'team');
    const body = await jsonBody(request);
    if (Object.keys(body).some(key => !['runId', 'requestId', 'mechanicId', 'laneId', 'evidence'].includes(key))) {
      throw new HttpError(400, 'Unsupported parallel action fields.');
    }
    if (!body.evidence || typeof body.evidence !== 'object' || Array.isArray(body.evidence)) throw new HttpError(400, 'Provide evidence for this lane.');
    return submitParallelLane({
      teamId: session.teamId,
      memberId: session.memberId,
      runId: textField(body, 'runId'),
      requestId: textField(body, 'requestId'),
      mechanicId: textField(body, 'mechanicId'),
      laneId: textField(body, 'laneId'),
      evidence: body.evidence,
    });
  });
}
