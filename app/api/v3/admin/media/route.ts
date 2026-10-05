import { NextRequest } from 'next/server';
import { handle, jsonBody, textField } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { pendingPhotoReviews, reviewPhoto } from '@/lib/server/v3/operations';
import { requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handle(async () => {
    await requireV3Session(request, 'admin');
    const huntId = request.nextUrl.searchParams.get('huntId');
    if (!huntId) throw new HttpError(400, 'Choose a hunt.');
    return { photos: await pendingPhotoReviews(huntId) };
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'admin');
    const body = await jsonBody(request);
    if (body.action !== 'review' || typeof body.approved !== 'boolean') throw new HttpError(400, 'Choose approve or reject.');
    return reviewPhoto({
      mediaId: textField(body, 'mediaId'),
      approved: body.approved,
      reason: textField(body, 'reason', 500),
      requestId: textField(body, 'requestId'),
      actor: session.organizerName,
    });
  });
}
