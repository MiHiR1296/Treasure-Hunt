import { NextRequest } from 'next/server';
import { handle, requireSession } from '@/lib/server/http';
import { eventAnalytics } from '@/lib/server/operations';
import { HttpError } from '@/lib/server/security';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) { return handle(async () => { await requireSession(request,'admin'); const id=request.nextUrl.searchParams.get('huntId'); if(!id) throw new HttpError(400,'Choose a hunt.'); return eventAnalytics(id); }); }
