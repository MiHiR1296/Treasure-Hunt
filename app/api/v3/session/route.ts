import { NextRequest } from 'next/server';
import { handle, jsonBody, textField } from '@/lib/server/http';
import { getPool, transaction } from '@/lib/server/db';
import { HttpError } from '@/lib/server/security';
import { registerV3Team, teamSessionSummary } from '@/lib/server/v3/registration';
import { V3_TEAM_COOKIE, digest, requireV3Session, v3RequestSource, v3SessionResponse } from '@/lib/server/v3/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'team');
    return transaction(async client => ({ summary: await teamSessionSummary(client, session.teamId, session.memberId) }));
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const body = await jsonBody(request);
    const allowed = ['requestId', 'huntId', 'intent', 'playerName', 'pin', 'memberPin', 'teamCode', 'teamName', 'memberNames'];
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new HttpError(400, 'Unsupported registration fields.');
    if (!['create', 'join', 'claim'].includes(String(body.intent))) throw new HttpError(400, 'Choose whether to create or join a team.');
    const result = await registerV3Team({
      requestId: textField(body, 'requestId'),
      huntId: textField(body, 'huntId'),
      intent: body.intent as 'create' | 'join' | 'claim',
      playerName: body.playerName,
      pin: body.pin,
      memberPin: body.memberPin,
      teamCode: body.teamCode,
      teamName: body.teamName,
      memberNames: body.memberNames,
      requestSource: v3RequestSource(request),
    });
    return v3SessionResponse({ summary: result.summary }, result.token, 'team', request);
  });
}

export async function DELETE(request: NextRequest) {
  return handle(async () => {
    await jsonBody(request);
    const token = request.cookies.get(V3_TEAM_COOKIE)?.value;
    if (token) await getPool().query('update hunt_v3.sessions set revoked_at=coalesce(revoked_at,now()) where token_hash=$1', [digest(token)]);
    return v3SessionResponse({ ok: true }, '', 'team', request);
  });
}
