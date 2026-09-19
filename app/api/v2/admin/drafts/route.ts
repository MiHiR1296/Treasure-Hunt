import { NextRequest } from 'next/server';
import { handle, jsonBody, requireSession } from '@/lib/server/http';
import { listDrafts, saveDraft } from '@/lib/server/hunts';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) { return handle(async () => { await requireSession(request,'admin'); return {drafts:await listDrafts()}; }); }
export async function POST(request: NextRequest) { return handle(async () => { await requireSession(request,'admin'); const body=await jsonBody(request); return {draft:await saveDraft(body.definition,body.expectedRevision === null ? null : Number(body.expectedRevision))}; }); }
