import { NextRequest } from 'next/server';
import { handle, jsonBody, readBody, requireSameOrigin } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { completeV3DirectUpload, prepareV3DirectUpload } from '@/lib/server/v3/direct-uploads';
import { uploadV3Photo } from '@/lib/server/v3/media';
import { rateLimitV3, requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'team');
    requireSameOrigin(request);
    await rateLimitV3(`photo-request:member:${session.memberId}`, 100);
    if (request.headers.get('content-type')?.includes('application/json')) {
      const body = await jsonBody(request);
      if (body.action === 'prepare_upload') return prepareV3DirectUpload({ teamId: session.teamId, memberId: session.memberId }, body);
      if (body.action === 'complete_upload') return completeV3DirectUpload({ teamId: session.teamId, memberId: session.memberId }, body.requestId);
      throw new HttpError(400, 'Choose a supported upload action.');
    }
    const bytes = await readBody(request, 11_000_000);
    let form: FormData;
    try { form = await new Response(new Uint8Array(bytes), { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData(); }
    catch { throw new HttpError(400, 'Choose a photo to upload.'); }
    if (form.get('teamId') !== session.teamId) throw new HttpError(409, 'Your team session changed. Refresh before uploading.');
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'Choose a photo to upload.');
    let location: unknown;
    try { location = form.get('location') ? JSON.parse(String(form.get('location'))) : undefined; }
    catch { throw new HttpError(400, 'Check your location again.'); }
    return { media: await uploadV3Photo(session.teamId, session.memberId, {
      id: String(form.get('requestId')),
      checkpointId: String(form.get('checkpointId')),
      nodeId: String(form.get('nodeId')),
      mechanicId: form.get('mechanicId') ? String(form.get('mechanicId')) : undefined,
      laneId: form.get('laneId') ? String(form.get('laneId')) : undefined,
      file,
      location,
    }) };
  });
}
