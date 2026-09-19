import { NextRequest } from 'next/server';
import { handle, jsonBody, requireSession, textField } from '@/lib/server/http';
import { applyTeamCommand } from '@/lib/server/store';
import { cleanupMedia } from '@/lib/server/media';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) { return handle(async () => {
  await requireSession(request,'admin');const body=await jsonBody(request);const teamId=textField(body,'teamId');
  const result=await applyTeamCommand(teamId,textField(body,'requestId'),body.control,'control');
  await cleanupMedia();
  return result;
}); }
