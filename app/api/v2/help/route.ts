import { NextRequest } from 'next/server';
import { handle, jsonBody, requireSession, textField } from '@/lib/server/http';
import { HttpError } from '@/lib/server/security';
import { submitHelp, teamMessages } from '@/lib/server/operations';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) { return handle(async () => teamMessages((await requireSession(request,'team')).team_id)); }
export async function POST(request: NextRequest) { return handle(async () => { const session=await requireSession(request,'team'); const body=await jsonBody(request);
  if(body.teamId!==session.team_id) throw new HttpError(409,'Your team session changed. Refresh before asking for help.');
  return {help:await submitHelp(session.team_id,{requestId:textField(body,'requestId'),kind:textField(body,'kind'),message:textField(body,'message',1000),checkpointId:typeof body.checkpointId==='string'?body.checkpointId:undefined,nodeId:typeof body.nodeId==='string'?body.nodeId:undefined})};
}); }
