import { NextRequest,NextResponse } from 'next/server';
import { handle } from '@/lib/server/http';
import { authorizeMedia, readMedia } from '@/lib/server/media';
import { createMediaReadUrl, mediaBackend } from '@/lib/server/media-storage.mjs';
export const runtime='nodejs';
export async function GET(request:NextRequest,context:{params:Promise<{id:string}>}) {return handle(async()=>{
  const id=(await context.params).id;
  if(mediaBackend()==='supabase') {
    const media=await authorizeMedia(request,id);
    const remaining=media.expires_at?Math.floor((new Date(media.expires_at).getTime()-Date.now())/1000):60;
    const response=NextResponse.redirect(await createMediaReadUrl(media.storage_key,Math.max(1,Math.min(60,remaining))),307);
    response.headers.set('Referrer-Policy','no-referrer');
    return response;
  }
  const {media,bytes}=await readMedia(request,id);
  const headers:Record<string,string>={'Content-Type':media.content_type,'X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Content-Security-Policy':"default-src 'none'"};
  const range=request.headers.get('range');
  if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match)return new NextResponse(null,{status:416,headers:{'Content-Range':`bytes */${bytes.length}`}});
    const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;
    if(start>end||start>=bytes.length)return new NextResponse(null,{status:416,headers:{'Content-Range':`bytes */${bytes.length}`}});
    return new NextResponse(new Uint8Array(bytes.subarray(start,end+1)),{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(end-start+1)}});
  }
  return new NextResponse(new Uint8Array(bytes),{headers:{...headers,'Content-Length':String(bytes.length)}});
});}
