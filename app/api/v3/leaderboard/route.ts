import { NextRequest } from 'next/server';
import { handle } from '@/lib/server/http';
import { getPool } from '@/lib/server/db';
import { HttpError } from '@/lib/server/security';
import { teamLeaderboards } from '@/lib/server/v3/leaderboards';
import { requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return handle(async () => {
    const session = await requireV3Session(request, 'team');
    const team = (await getPool().query('select hunt_id from hunt_v3.teams where id=$1', [session.teamId])).rows[0];
    if (!team) throw new HttpError(404, 'Team not found.');
    return teamLeaderboards(team.hunt_id, session.teamId);
  });
}
