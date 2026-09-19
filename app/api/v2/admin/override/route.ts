import { NextRequest } from 'next/server';
import { handle, jsonBody, requireSession, textField } from '@/lib/server/http';
import { applyTeamCommand } from '@/lib/server/store';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  return handle(async () => {
    await requireSession(request, 'admin');
    const body = await jsonBody(request);
    return applyTeamCommand(textField(body, 'teamId'), textField(body, 'requestId'),
      { checkpointId: body.checkpointId, nodeId: body.nodeId, reason: body.reason }, true);
  });
}
