import { NextRequest } from 'next/server';
import { handle, jsonBody, textField } from '@/lib/server/http';
import { playerSupport, submitHelp } from '@/lib/server/v3/support';
import { requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'team');
    return playerSupport(session.teamId, session.memberId);
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'team');
    const body = await jsonBody(request);
    return submitHelp({
      teamId: session.teamId,
      memberId: session.memberId,
      requestId: textField(body, 'requestId'),
      kind: textField(body, 'kind', 40),
      message: textField(body, 'message', 1000),
      runId: typeof body.runId === 'string' ? body.runId : undefined,
      checkpointId: typeof body.checkpointId === 'string' ? body.checkpointId : undefined,
      nodeId: typeof body.nodeId === 'string' ? body.nodeId : undefined,
    });
  });
}
