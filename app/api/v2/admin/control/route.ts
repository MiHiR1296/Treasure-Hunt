import { NextRequest } from 'next/server';
import { handle, jsonBody, requireSession, textField } from '@/lib/server/http';
import { applyTeamCommand } from '@/lib/server/store';
import { cleanupMedia } from '@/lib/server/media';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) { return handle(async () => {
  const session=await requireSession(request,'admin');const body=await jsonBody(request);const teamId=textField(body,'teamId');
  const result=await applyTeamCommand(teamId,textField(body,'requestId'),body.control,'control',{role:'admin',name:'Organizer',sessionHash:session.sessionHash});
  await cleanupMedia();
  return result;
}); }
