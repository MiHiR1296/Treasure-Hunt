import { NextRequest } from 'next/server';
import { handle, jsonBody, textField } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { previewV3Draft } from '@/lib/server/v3/authoring';
import { requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'admin');
    const body = await jsonBody(request);
    if (Object.keys(body).some(key => !['draftId', 'revision', 'generation'].includes(key))) {
      throw new HttpError(400, 'Unsupported preview fields.');
    }
    if (!Number.isSafeInteger(body.revision)) throw new HttpError(400, 'A valid draft revision is required.');
    return previewV3Draft({
      draftId: textField(body, 'draftId'),
      revision: Number(body.revision),
      generation: textField(body, 'generation'),
      adminSessionHash: session.sessionHash,
    });
  });
}
