import { NextRequest } from 'next/server';
import { handle, jsonBody, textField } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { adminSupport, resolveHelp, sendOrganizerMessage } from '@/lib/server/v3/support';
import { requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handle(async () => {
    await requireV3Session(request, 'admin');
    const huntId = request.nextUrl.searchParams.get('huntId');
    if (!huntId) throw new HttpError(400, 'Choose a hunt.');
    return adminSupport(huntId);
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'admin');
    const body = await jsonBody(request);
    const action = textField(body, 'action', 40);
    if (action === 'resolve') return resolveHelp({
      requestId: textField(body, 'requestId'),
      response: textField(body, 'response', 2000),
      actor: session.organizerName,
    });
    if (action === 'message') return sendOrganizerMessage({
      huntId: textField(body, 'huntId'),
      teamId: typeof body.teamId === 'string' && body.teamId ? body.teamId : null,
      message: textField(body, 'message', 2000),
      actor: session.organizerName,
    });
    throw new HttpError(400, 'Unsupported support action.');
  });
}
