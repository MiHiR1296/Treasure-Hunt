import { NextRequest } from 'next/server';
import { handle, jsonBody, requireSession, sessionResponse, textField } from '@/lib/server/http';
import { simulatePreview, startPreview } from '@/lib/server/operations';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) { return handle(async () => { await requireSession(request,'admin'); const body=await jsonBody(request);
  if (body.action) return simulatePreview(textField(body,'teamId'),textField(body,'requestId'),textField(body,'action'),typeof body.value==='string'?body.value:undefined);
  const result=await startPreview({huntId:typeof body.huntId==='string'?body.huntId:undefined,draftId:typeof body.draftId==='string'?body.draftId:undefined,definition:body.definition});
  return sessionResponse({view:result.view,url:result.url},result.token,'preview',request);
}); }
