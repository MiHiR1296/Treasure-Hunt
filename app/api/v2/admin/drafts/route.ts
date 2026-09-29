import { NextRequest } from 'next/server';
import { handle, jsonBody, requireSession, textField } from '@/lib/server/http';
import { deleteDraft, listDrafts, saveDraft } from '@/lib/server/hunts';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) { return handle(async () => { await requireSession(request,'admin'); return {drafts:await listDrafts()}; }); }
export async function POST(request: NextRequest) { return handle(async () => { await requireSession(request,'admin'); const body=await jsonBody(request); return {draft:await saveDraft(body.definition,body.expectedRevision === null ? null : Number(body.expectedRevision), typeof body.generation === 'string' ? body.generation : undefined)}; }); }
export async function DELETE(request: NextRequest) { return handle(async () => { await requireSession(request,'admin'); const body=await jsonBody(request); await deleteDraft(textField(body,'id'),Number(body.revision),textField(body,'generation')); return {ok:true}; }); }
