import { NextRequest } from 'next/server';
import { handle, jsonBody, requireSession, sessionResponse, teamCookie, textField } from '@/lib/server/http';
import { getPool } from '@/lib/server/db';
import { digest, HttpError } from '@/lib/server/security';
import { joinTeam, teamView } from '@/lib/server/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  return handle(async () => ({ view: await teamView((await requireSession(request, 'team')).team_id) }));
}
export async function POST(request: NextRequest) {
  return handle(async () => {
    const body = await jsonBody(request);
    if (request.headers.get('X-Hunt-Preview') === '1') throw new HttpError(400, 'Start a test session from the organizer preview. Your live team has not changed.');
    const pin = textField(body, 'pin', 12);
    if (!/^\d{4,12}$/.test(pin)) throw new HttpError(400, 'Use a PIN with 4 to 12 digits.');
    if (body.mode !== 'create' && body.mode !== 'join') throw new HttpError(400, 'Choose create or join team.');
    const result = await joinTeam({ huntId: textField(body, 'huntId'), teamName: textField(body, 'teamName', 60),
      playerName: textField(body, 'playerName', 60), pin, mode: body.mode });
    return sessionResponse({ view: result.view }, result.token, 'team', request);
  });
}
export async function DELETE(request: NextRequest) {
  return handle(async () => {
    await jsonBody(request);
    const token = request.cookies.get(teamCookie(request))?.value;
    if (token) await getPool().query('delete from hunt_v2.sessions where token_hash=$1', [digest(token)]);
    return sessionResponse({ ok: true }, '', request.headers.get('X-Hunt-Preview') === '1' ? 'preview' : 'team', request);
  });
}
