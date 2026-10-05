import { NextRequest } from 'next/server';
import { handle, jsonBody, textField } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { listV3Drafts, saveV3Draft } from '@/lib/server/v3/authoring';
import { requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handle(async () => {
    await requireV3Session(request, 'admin');
    return { drafts: await listV3Drafts() };
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    await requireV3Session(request, 'admin');
    const body = await jsonBody(request);
    if (Object.keys(body).some(key => !['draftId', 'revision', 'generation', 'definition'].includes(key))) throw new HttpError(400, 'Unsupported draft fields.');
    if (!Number.isSafeInteger(body.revision)) throw new HttpError(400, 'A valid draft revision is required.');
    return { draft: await saveV3Draft(body.definition, textField(body, 'draftId'), Number(body.revision), textField(body, 'generation')) };
  });
}
