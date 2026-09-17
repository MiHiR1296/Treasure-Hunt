import { NextRequest } from 'next/server';
import { handle, readBody, requireSameOrigin, requireSession } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { uploadPhoto } from '@/lib/server/media';
export const runtime='nodejs';
export async function POST(request:NextRequest) { return handle(async()=>{
  const session=await requireSession(request,'team');requireSameOrigin(request);
  const bytes=await readBody(request,11_000_000);
  let form:FormData;try {form=await new Response(new Uint8Array(bytes),{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData();} catch {throw new HttpError(400,'Choose a photo to upload.');}
  if(form.get('teamId')!==session.team_id)throw new HttpError(409,'Your team session changed. Refresh before uploading.');
  const file=form.get('file');if(!(file instanceof File))throw new HttpError(400,'Choose a photo to upload.');
  let location:unknown;try {location=form.get('location')?JSON.parse(String(form.get('location'))):undefined;}catch{throw new HttpError(400,'Check your location again.');}
  return {media:await uploadPhoto(session.team_id,{id:String(form.get('requestId')),checkpointId:String(form.get('checkpointId')),nodeId:String(form.get('nodeId')),file,location})};
}); }
