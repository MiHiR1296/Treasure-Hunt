import { NextRequest } from 'next/server';
import { handle, jsonBody, textField } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { publishV3Draft } from '@/lib/server/v3/authoring';
import { requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'admin');
    const body = await jsonBody(request);
    if (Object.keys(body).some(key => !['draftId', 'revision', 'generation', 'expectedVersion'].includes(key))) throw new HttpError(400, 'Unsupported publish fields.');
    if (!Number.isSafeInteger(body.revision) || (body.expectedVersion !== undefined && !Number.isSafeInteger(body.expectedVersion))) throw new HttpError(400, 'Valid draft and hunt versions are required.');
    return publishV3Draft({
      draftId: textField(body, 'draftId'),
      revision: Number(body.revision),
      generation: textField(body, 'generation'),
      adminSessionHash: session.sessionHash,
      ...(body.expectedVersion !== undefined ? { expectedVersion: Number(body.expectedVersion) } : {}),
    });
  });
}
