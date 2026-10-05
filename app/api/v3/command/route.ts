import { NextRequest } from 'next/server';
import { handle, jsonBody, textField } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { applyRunCommand } from '@/lib/server/v3/runs';
import { requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'team');
    const body = await jsonBody(request);
    if (Object.keys(body).some(key => !['runId', 'requestId', 'command'].includes(key))) throw new HttpError(400, 'Unsupported command fields.');
    return applyRunCommand(
      session.teamId,
      session.memberId,
      textField(body, 'runId'),
      textField(body, 'requestId'),
      body.command,
    );
  });
}
