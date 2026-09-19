import { NextRequest } from 'next/server';
import { handle, jsonBody, requireSession, textField } from '@/lib/server/http';
import { resolveHelp, sendAnnouncement } from '@/lib/server/operations';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) { return handle(async () => { await requireSession(request,'admin'); const body=await jsonBody(request);
  if(body.helpId) await resolveHelp(textField(body,'helpId'),textField(body,'message',2000));
  else await sendAnnouncement(textField(body,'huntId'),textField(body,'message',2000),typeof body.teamId==='string'?body.teamId:undefined);
  return {ok:true};
}); }
