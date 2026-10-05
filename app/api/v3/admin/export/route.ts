import { NextRequest, NextResponse } from 'next/server';
import { handle } from '@/lib/server/http';
import { getPool } from '@/lib/server/db';
import { HttpError } from '@/lib/server/security';
import { eventAnalytics } from '@/lib/server/v3/operations';
import { requireV3Session } from '@/lib/server/v3/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const csvCell = (value: unknown) => {
  const raw = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};

export async function GET(request: NextRequest) {
  return handle(async () => {
    await requireV3Session(request, 'admin');
    const huntId = request.nextUrl.searchParams.get('huntId');
    const kind = request.nextUrl.searchParams.get('kind') === 'private' ? 'private' : 'aggregate';
    const format = request.nextUrl.searchParams.get('format') === 'csv' ? 'csv' : 'json';
    if (!huntId) throw new HttpError(400, 'Choose a hunt.');
    let report: unknown;
    if (kind === 'aggregate') report = await eventAnalytics(huntId);
    else {
      const [teams, runs, contributions, votes, recognitionResults, recognitionOverrides] = await Promise.all([
        getPool().query(
          `select team.id,team.canonical_code,team.display_name,team.name_status,team.registration_source,team.status,
            coalesce(jsonb_agg(jsonb_build_object('id',member.id,'name',member.name,'status',member.status,'claimedAt',member.claimed_at,'checkedInAt',member.checked_in_at)
              order by member.created_at,member.id) filter(where member.id is not null),'[]') as members
            from hunt_v3.teams team left join hunt_v3.team_members member on member.team_id=team.id
            where team.hunt_id=$1 group by team.id order by team.canonical_code`, [huntId]),
        getPool().query(
          `select id,team_id,hunt_version,run_number,status,practice,eligible,ineligibility_reason,score,bonus_score,
            progress,current_checkpoint_id,started_at,completed_at,elapsed_ms,route_plan,resolved_variables
            from hunt_v3.runs where hunt_id=$1 order by team_id,run_number`, [huntId]),
        getPool().query(
          `select contribution.run_id,contribution.member_id,member.name,contribution.category,contribution.credit,
            contribution.evidence,contribution.created_at from hunt_v3.run_contributions contribution
            join hunt_v3.runs run on run.id=contribution.run_id join hunt_v3.team_members member on member.id=contribution.member_id
            where run.hunt_id=$1 order by contribution.created_at`, [huntId]),
        getPool().query(
          `select vote.run_id,voter.name as voter,recipient.name as recipient,vote.revision,vote.category,vote.subtype,
            vote.answer_path,vote.is_withdrawal,vote.created_at from hunt_v3.recognition_votes vote
            join hunt_v3.runs run on run.id=vote.run_id join hunt_v3.team_members voter on voter.id=vote.voter_member_id
            join hunt_v3.team_members recipient on recipient.id=vote.recipient_member_id
            where run.hunt_id=$1 order by vote.created_at`, [huntId]),
        getPool().query(
          `select result.run_id,result.member_id,member.name,result.revision,result.headline_title,result.data_title,
            result.peer_title,result.evidence_summary,result.peer_summary,result.contribution_score,result.peer_score,
            result.server_weight,result.peer_weight,result.calculation_version,result.created_at
            from hunt_v3.recognition_results result
            join hunt_v3.runs run on run.id=result.run_id
            join hunt_v3.team_members member on member.id=result.member_id
            where run.hunt_id=$1 order by result.run_id,result.member_id,result.revision`, [huntId]),
        getPool().query(
          `select override.run_id,override.member_id,member.name,override.result_id,override.replaces_override_id,
            override.headline_title,override.data_title,override.peer_title,override.explanation,override.reason,
            override.organizer_actor,override.created_at
            from hunt_v3.recognition_overrides override
            join hunt_v3.runs run on run.id=override.run_id
            join hunt_v3.team_members member on member.id=override.member_id
            where run.hunt_id=$1 order by override.created_at,override.id`, [huntId]),
      ]);
      report = {
        huntId,
        generatedAt: new Date().toISOString(),
        teams: teams.rows,
        runs: runs.rows,
        contributions: contributions.rows,
        recognitionVotes: votes.rows,
        recognitionResults: recognitionResults.rows,
        recognitionOverrides: recognitionOverrides.rows,
      };
    }
    const filename = `treasure-hunt-${huntId}-${kind}.${format}`;
    if (format === 'json') return new NextResponse(JSON.stringify(report, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' },
    });
    const flat = kind === 'aggregate'
      ? Object.entries(report as Record<string, unknown>).map(([key, value]) => ['aggregate', key, typeof value === 'object' ? JSON.stringify(value) : value])
      : (report as { teams: Array<Record<string, unknown>> }).teams.map(team => ['team', team.canonical_code, team.display_name, team.status, JSON.stringify(team.members)]);
    const csv = [['section', 'key', 'value', 'status', 'details'], ...flat].map(row => row.map(csvCell).join(',')).join('\n');
    return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' } });
  });
}
