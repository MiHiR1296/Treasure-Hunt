import { NextRequest } from 'next/server';
import { handle, jsonBody } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { importV3Draft } from '@/lib/server/v3/authoring';
import { requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  return handle(async () => {
    await requireV3Session(request, 'admin');
    const body = await jsonBody(request);
    if (Object.keys(body).some(key => key !== 'definition')) throw new HttpError(400, 'Unsupported import fields.');
    const draft = await importV3Draft(body.definition);
    return { draft, published: false, message: 'Imported as an editable draft. Preview, validate, and publish it explicitly when ready.' };
  });
}
