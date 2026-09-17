import { NextRequest } from 'next/server';
import { handle, jsonBody, readBody, requireSameOrigin, requireSession, textField } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { cleanupMedia, deleteAsset, listMedia, makeJigsaw, uploadAsset } from '@/lib/server/media';
export const runtime='nodejs';
export async function GET(request:NextRequest){return handle(async()=>{await requireSession(request,'admin');await cleanupMedia();return {media:await listMedia()};});}
export async function DELETE(request:NextRequest){return handle(async()=>{await requireSession(request,'admin');const body=await jsonBody(request);await deleteAsset(textField(body,'mediaId'));return {deleted:true};});}
export async function POST(request:NextRequest){return handle(async()=>{
  await requireSession(request,'admin');requireSameOrigin(request);
  if(request.headers.get('content-type')?.includes('application/json')) { const body=await jsonBody(request); return {puzzle:await makeJigsaw(textField(body,'mediaId'),Number(body.rows),Number(body.columns))}; }
  const bytes=await readBody(request,21_000_000);
  let form:FormData;try {form=await new Response(new Uint8Array(bytes),{headers:{'Content-Type':request.headers.get('content-type')||''}}).formData();}catch{throw new HttpError(400,'Choose a file to upload.');}
  const file=form.get('file');if(!(file instanceof File))throw new HttpError(400,'Choose a file to upload.');
  return {media:await uploadAsset(String(form.get('requestId')),file)};
});}
