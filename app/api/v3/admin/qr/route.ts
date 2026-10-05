import { NextRequest } from 'next/server';
import { handle, jsonBody, textField } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { organizerQrPack } from '@/lib/server/v3/authoring';
import { requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'admin');
    const body = await jsonBody(request);
    if (Object.keys(body).some(key => !['huntId', 'version'].includes(key))) throw new HttpError(400, 'Unsupported QR pack fields.');
    if (body.version !== undefined && !Number.isSafeInteger(body.version)) throw new HttpError(400, 'Choose a valid hunt version.');
    return organizerQrPack({
      huntId: textField(body, 'huntId'),
      ...(body.version === undefined ? {} : { version: Number(body.version) }),
      actor: session.organizerName,
    });
  });
}
