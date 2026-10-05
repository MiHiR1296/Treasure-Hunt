import { NextRequest } from 'next/server';
import { handle, jsonBody, textField } from '@/lib/server/http';
import { transaction } from '@/lib/server/db';
import { HttpError } from '@/lib/server/security';
import {
  createOrganizerTeam,
  freezePublicBoard,
  renameTeam,
  setHuntLifecycle,
  updatePublicBoard,
} from '@/lib/server/v3/operations';
import { requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'admin');
    const body = await jsonBody(request);
    const action = textField(body, 'action');
    if (action === 'rename_team') {
      const name = body.displayName === null || body.displayName === '' ? null : textField(body, 'displayName', 80);
      return renameTeam(textField(body, 'teamId'), name, textField(body, 'reason', 500), session.organizerName);
    }
    if (action === 'create_team') {
      return createOrganizerTeam({
        huntId: textField(body, 'huntId'),
        requestId: textField(body, 'requestId'),
        displayName: body.displayName === undefined || body.displayName === null ? null : textField(body, 'displayName', 80),
        memberNames: body.memberNames,
        pin: typeof body.pin === 'string' ? body.pin : undefined,
        credentialSecret: process.env.ORGANIZER_PASSWORD || '',
        actor: session.organizerName,
        sessionHash: session.sessionHash,
      });
    }
    if (action === 'set_hunt_status') {
      if (!Number.isSafeInteger(body.expectedRevision)) throw new HttpError(400, 'A current lifecycle revision is required.');
      return setHuntLifecycle(textField(body, 'huntId'), textField(body, 'status'), Number(body.expectedRevision), session.organizerName);
    }
    if (action === 'update_public_board') {
      if (typeof body.enabled !== 'boolean' || typeof body.mainVisible !== 'boolean' || typeof body.replayVisible !== 'boolean' ||
        !Array.isArray(body.columns) || !body.columns.every(column => typeof column === 'string') ||
        !['live', 'frozen', 'final'].includes(String(body.status)) || !['code_only', 'display_name'].includes(String(body.teamNameMode))) {
        throw new HttpError(400, 'Choose valid public-board settings.');
      }
      return transaction(client => updatePublicBoard(client, {
        huntId: textField(body, 'huntId'),
        enabled: body.enabled as boolean,
        title: textField(body, 'title', 160),
        ...(body.cover === undefined
          ? {}
          : { cover: body.cover === null || body.cover === '' ? null : textField(body, 'cover', 500) }),
        status: body.status as 'live' | 'frozen' | 'final',
        columns: body.columns as string[],
        mainVisible: body.mainVisible as boolean,
        replayVisible: body.replayVisible as boolean,
        teamNameMode: body.teamNameMode as 'code_only' | 'display_name',
        actor: session.organizerName,
      }));
    }
    if (action === 'freeze_public_board' || action === 'finalize_public_board') {
      return freezePublicBoard(textField(body, 'huntId'), action === 'finalize_public_board', session.organizerName);
    }
    throw new HttpError(400, 'Unsupported organizer action.');
  });
}
