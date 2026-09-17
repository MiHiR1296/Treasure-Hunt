import { NextRequest,NextResponse } from 'next/server';
import { handle } from '@/lib/server/http';
import { readMedia } from '@/lib/server/media';
export const runtime='nodejs';
export async function GET(request:NextRequest,context:{params:Promise<{id:string}>}) {return handle(async()=>{
  const {media,bytes}=await readMedia(request,(await context.params).id);
  const headers:Record<string,string>={'Content-Type':media.content_type,'X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Content-Security-Policy':"default-src 'none'"};
  const range=request.headers.get('range');
  if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match)return new NextResponse(null,{status:416,headers:{'Content-Range':`bytes */${bytes.length}`}});
    const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1;
    if(start>end||start>=bytes.length)return new NextResponse(null,{status:416,headers:{'Content-Range':`bytes */${bytes.length}`}});
    return new NextResponse(new Uint8Array(bytes.subarray(start,end+1)),{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(end-start+1)}});
  }
  return new NextResponse(new Uint8Array(bytes),{headers:{...headers,'Content-Length':String(bytes.length)}});
});}
