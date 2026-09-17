import { NextRequest } from 'next/server';
import { handle, requireSession } from '@/lib/server/http';
import { leaderboard } from '@/lib/server/operations';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) { return handle(async () => leaderboard((await requireSession(request,'team')).team_id)); }
