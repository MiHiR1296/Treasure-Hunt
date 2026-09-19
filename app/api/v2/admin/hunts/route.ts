import { NextRequest } from 'next/server';
import { handle, jsonBody, requireSession, textField } from '@/lib/server/http';
import { cleanupMedia } from '@/lib/server/media';
import { HttpError } from '@/lib/server/security';
import { publishDraft, publishHunt, setHuntStatus, type HuntStatus } from '@/lib/server/hunts';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  return handle(async () => {
    await requireSession(request, 'admin');
    const body = await jsonBody(request);
    const options = { expectedVersion: typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined, status: body.status === 'ready' ? 'ready' as const : 'live' as const };
    const definition = typeof body.draftId === 'string'
      ? await publishDraft(body.draftId, Number(body.revision), options)
      : await publishHunt(body.definition, options);
    return { id: definition.id, title: definition.title, version: definition.version };
  });
}
export async function PATCH(request: NextRequest) {
  return handle(async () => {
    await requireSession(request, 'admin');
    const body = await jsonBody(request);
    if (!['ready','live','paused','ended','archived'].includes(String(body.status))) throw new HttpError(400, 'Choose a supported status.');
    await setHuntStatus(textField(body, 'huntId'), body.status as HuntStatus);
    if (body.status === 'ended' || body.status === 'archived') await cleanupMedia();
    return { ok: true };
  });
}
