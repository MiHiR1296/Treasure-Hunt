import { NextRequest } from 'next/server';
import { handle, jsonBody, requireSession, textField } from '@/lib/server/http';
import { applyTeamCommand } from '@/lib/server/store';
import { HttpError } from '@/lib/server/security';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  return handle(async () => {
    const session = await requireSession(request, 'team');
    const body = await jsonBody(request);
    if (textField(body, 'teamId') !== session.team_id) throw new HttpError(409, 'Your team session changed in another tab. Refresh to continue with the current team.');
    return applyTeamCommand(session.team_id, textField(body, 'requestId'), body.command);
  });
}
