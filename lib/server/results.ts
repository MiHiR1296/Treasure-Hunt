import type { GameState } from '../engine/types';
import { elapsedMilliseconds, playability } from '../engine/session';
import { getPool, transaction } from './db';
import { teamQuery, toTeamView, type TeamRecord } from './store';
import { HttpError } from './security';
import { teamSummaryQuery } from './team-summaries';

export function resultSummary(team: TeamRecord, now: string) {
  const state = team.state, clock = playability(team.definition, state, team.status, now);
  return { id: team.id, name: team.name, huntId: team.hunt_id, version: state.definitionVersion, revision: state.revision,
    status: clock.code === 'running' ? (state.status === 'completed' ? 'completed' : 'running') : clock.code, score: state.score, startedAt: state.startedAt ?? null,
    completedAt: state.completedAt ?? null, deadlineAt: state.timer?.deadlineAt ?? null,
    elapsedSeconds: state.startedAt ? Math.floor(elapsedMilliseconds(state, state.startedAt, state.completedAt ?? now) / 1000) : null,
    completed: Object.values(state.checkpoints).filter(cp => cp.status === 'completed').length,
    skipped: Object.values(state.checkpoints).filter(cp => cp.status === 'skipped').length,
    hints: Object.keys(state.hintUsage).length, review: state.resultReview ?? null,
    reviewOutdated: !!state.resultReview && state.resultReview.reviewedRevision !== state.revision,
    extensions: state.timer?.extensions.length ?? 0, isPreview: team.is_preview };
}

export async function listResults(huntId: string, after = '', asOf?: string) {
  if (after && !/^[0-9a-f-]{36}$/i.test(after)) throw new HttpError(400, 'Invalid results cursor.');
  if (asOf && !Number.isFinite(Date.parse(asOf))) throw new HttpError(400, 'Invalid results cutoff.');
  const now = new Date((await getPool().query('select clock_timestamp() as at')).rows[0].at).toISOString();
  const cutoff = asOf ?? now;
  const { rows } = await getPool().query(`${teamSummaryQuery} where t.hunt_id=$1 and not t.is_preview and t.created_at<=$2 and ($3::uuid is null or t.id>$3::uuid) order by t.id limit 51`, [huntId, cutoff, after || null]);
  const page = rows.slice(0, 50);
  return { asOf: cutoff, measuredAt: now, teams: page.map(team => ({ ...resultSummary(team, now), registrationCutoff: cutoff, measuredAt: now })), next: rows.length > 50 ? page.at(-1).id : null };
}

/** Freeze membership of a summary export, not a long-lived DB transaction.
 * Every row still carries its own read time/revision. Late commits cannot slip
 * between UUID pages or silently replace an already exported team. */
export async function resultManifest(huntId: string) {
  const { rows } = await getPool().query('select id,clock_timestamp() as at from hunt_v2.teams where hunt_id=$1 and not is_preview order by id limit 10001', [huntId]);
  if (rows.length > 10000) throw new HttpError(400, 'This browser export supports up to 10,000 teams. Use the paginated results API for a larger event; no partial export was produced.');
  return { ids: rows.map(row => row.id as string), asOf: rows[0] ? new Date(rows[0].at).toISOString() : new Date().toISOString() };
}
export async function resultBatch(huntId: string, ids: unknown, asOf: string) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50 || ids.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) || new Set(ids).size !== ids.length || !Number.isFinite(Date.parse(asOf))) throw new HttpError(400, 'Invalid result batch.');
  const now = new Date((await getPool().query('select clock_timestamp() as at')).rows[0].at).toISOString();
  const { rows } = await getPool().query(`${teamSummaryQuery} where t.hunt_id=$1 and not t.is_preview and t.id=any($2::uuid[]) order by t.id`, [huntId, ids]);
  if (rows.length !== ids.length) throw new HttpError(409, 'A team was removed during export. Restart the export; no incomplete file was produced.');
  return { teams: rows.map(team => ({ ...resultSummary(team, now), registrationCutoff: asOf, measuredAt: now })) };
}

export function checkpointTimings(state: GameState, now: string) {
  const selected = new Map<string, { selectedMilliseconds: number; visits: number }>();
  let current: string | undefined, since: string | undefined;
  const close = (at: string) => { if (current && since) selected.get(current)!.selectedMilliseconds += elapsedMilliseconds(state, since, at); current = undefined; since = undefined; };
  for (const entry of state.events) {
    if (entry.checkpointId && ['checkpoint_started', 'checkpoint_selected'].includes(entry.type) && entry.checkpointId !== current) {
      close(entry.at); current = entry.checkpointId; since = entry.at;
      const value = selected.get(current) ?? { selectedMilliseconds: 0, visits: 0 }; value.visits++; selected.set(current, value);
    }
    if (entry.checkpointId === current && ['checkpoint_completed', 'checkpoint_skipped'].includes(entry.type)) close(entry.at);
  }
  close(now);
  return Object.entries(state.checkpoints).map(([id, cp]) => ({ id, status: cp.status, startedAt: cp.startedAt ?? null, completedAt: cp.completedAt ?? null,
    wallSeconds: cp.startedAt ? Math.max(0, Math.floor((Date.parse(cp.completedAt ?? now) - Date.parse(cp.startedAt)) / 1000)) : null,
    elapsedSeconds: cp.startedAt ? Math.floor(elapsedMilliseconds(state, cp.startedAt, cp.completedAt ?? now) / 1000) : null,
    selectedSeconds: selected.has(id) ? Math.floor(selected.get(id)!.selectedMilliseconds / 1000) : null,
    visits: selected.get(id)?.visits ?? null,
    failures: state.events.filter(event => event.checkpointId === id && event.type === 'verification_failed').length,
    purchases: state.events.filter(event => event.checkpointId === id && event.type === 'hint_used').length }));
}

async function loadTeamReport(teamId: string, allowPreview = false) {
  return transaction(async client => {
  const identity = (await client.query('select hunt_id from hunt_v2.teams where id=$1', [teamId])).rows[0];
  if (!identity) throw new HttpError(404, 'Team not found.');
  // Short, shared locks give the report a precise revision/cutoff, in the same
  // hunt -> team order as accepted commands. New help requests also lock the team.
  await client.query('select id from hunt_v2.hunts where id=$1 for share', [identity.hunt_id]);
  const team = (await client.query(`${teamQuery} where t.id=$1 for share of t`, [teamId])).rows[0] as TeamRecord | undefined;
  if (!team || (team.is_preview && !allowPreview)) throw new HttpError(404, 'Team not found.');
  const now = new Date((await client.query('select clock_timestamp() as at')).rows[0].at).toISOString();
  const members = (await client.query('select id,name,joined_at from hunt_v2.members where team_id=$1 order by joined_at,id', [teamId])).rows;
  const helpCount = (await client.query('select count(*)::int as count from hunt_v2.help_requests where team_id=$1', [teamId])).rows[0].count as number;
  const counts = { events: team.state.events.length, ledger: team.state.ledger.length, help: helpCount };
  const activity = await client.query('select min(at) as first_at,count(*)::int as count from hunt_v2.team_activity where team_id=$1 and revision<=$2', [teamId, team.state.revision]);
  const help = (await client.query('select id,kind,message,status,response,created_at,resolved_at from hunt_v2.help_requests where team_id=$1 order by created_at,id limit 100', [teamId])).rows;
  const view = toTeamView(team, members.map(member => member.name), now);
  const reversed = new Set(team.state.ledger.flatMap(entry => entry.reverses ? [entry.reverses] : []));
  const ledger = team.state.ledger.filter((entry, index) => index >= team.state.ledger.length - 100 || (entry.kind === 'hint_used' && !reversed.has(entry.id)));
  const ledgerTotals: Record<string, number> = {};
  for (const entry of team.state.ledger) ledgerTotals[entry.kind] = (ledgerTotals[entry.kind] ?? 0) + entry.amount;
  return { summary: resultSummary(team, now), measuredAt: now, members, startingRoster: team.state.startingRoster ?? null,
    assignments: team.state.routeAssignments ?? null, timer: team.state.timer ?? null, review: team.state.resultReview ?? null,
    checkpoints: checkpointTimings(team.state, now), help, counts, activityCoverage: activity.rows[0],
    team: { id: team.id, name: team.name, huntId: team.hunt_id, version: team.state.definitionVersion, isPreview: team.is_preview, lastActivity: team.last_activity,
      view, ledger, ledgerTotals, historyCounts: counts, events: team.state.events.slice(-100), checkpoints: team.state.checkpoints, definition: team.definition, detailed: true } };
  });
}

/** Operational solutions inspection is explicit and separate from Results/export.
 * The inspector supports preview recovery, but no Results path may opt into it. */
export async function inspectTeam(teamId: string) {
  return { team: (await loadTeamReport(teamId, true)).team };
}

/** Allowlist configuration metadata, including the nested view: don't export
 * private definitions or incidentally include configured maps/hint content. */
export async function teamResult(teamId: string) {
  const report = await loadTeamReport(teamId), { definition, view } = report.team;
  return { ...report, team: { ...report.team,
    definition: { id: definition.id, title: definition.title, checkpoints: definition.checkpoints.map(cp => ({ id: cp.id, title: cp.title, basePoints: cp.basePoints, required: cp.required !== false })) },
    view: { hunt: { id: definition.id, title: definition.title }, teamId: view.teamId, revision: view.revision, status: view.status, score: view.score,
      serverNow: view.serverNow, playability: view.playability, timer: view.timer, progress: view.progress, members: view.members,
      checkpoint: view.checkpoint, node: view.node ? { id: view.node.id, type: view.node.type, ...(view.node.fallback ? { fallback: view.node.fallback } : {}) } : null,
      checkpoints: view.checkpoints?.map(cp => ({ id: cp.id, title: cp.title, status: cp.status, required: cp.required })),
      hints: view.hints.map(hint => ({ id: hint.id, title: hint.title })),
    },
  } };
}

/** Engine events and ledger are append-only. Ordinal cutoffs preserve the inspected
 * revision across concurrent corrections; help replies are labelled as read-time data. */
export async function resultHistory(teamId: string, section: 'events' | 'ledger' | 'help', throughRevision: number, count: number, offset: number, asOf: string) {
  if (![throughRevision, count, offset].every(Number.isSafeInteger) || throughRevision < 0 || count < 0 || offset < 0 || offset > count || !Number.isFinite(Date.parse(asOf))) throw new HttpError(400, 'Invalid history cursor.');
  const team = (await getPool().query("select (state->>'revision')::int as revision from hunt_v2.teams where id=$1 and not is_preview", [teamId])).rows[0];
  if (!team) throw new HttpError(404, 'Team not found.');
  if (team.revision < throughRevision) throw new HttpError(409, 'The team no longer matches this export. Reload the result.');
  const size = Math.min(100, count - offset);
  const rows = section === 'help'
    ? (await getPool().query('select id,kind,message,status,response,created_at,resolved_at from hunt_v2.help_requests where team_id=$1 and created_at<=$2 order by created_at,id limit $3 offset $4', [teamId, asOf, size, offset])).rows
    : (await getPool().query(`select item from hunt_v2.teams t, jsonb_array_elements(t.state->$2) with ordinality as e(item,n) where t.id=$1 and n>$3 and n<=$4 order by n limit 100`, [teamId, section, offset, count])).rows.map(row => row.item);
  if (rows.length !== size) throw new HttpError(409, 'History changed during export. Reload the result; no incomplete export was produced.');
  return { section, throughRevision, count, asOf, measuredAt: new Date().toISOString(), entries: rows, next: offset + rows.length < count ? offset + rows.length : null };
}

export async function resultActivity(teamId: string, throughRevision: number, afterRevision = -1, afterOrdinal = -1) {
  if (![throughRevision, afterRevision, afterOrdinal].every(Number.isSafeInteger) || throughRevision < 0 || afterRevision < -1 || afterOrdinal < -1) throw new HttpError(400, 'Invalid activity cursor.');
  if (!(await getPool().query('select 1 from hunt_v2.teams where id=$1 and not is_preview', [teamId])).rowCount) throw new HttpError(404, 'Team not found.');
  const { rows } = await getPool().query(`select revision,ordinal,at,actor,type,details from hunt_v2.team_activity where team_id=$1 and revision<=$2 and (revision,ordinal)>($3,$4) order by revision,ordinal limit 101`, [teamId, throughRevision, afterRevision, afterOrdinal]);
  const entries = rows.slice(0, 100), last = entries.at(-1);
  return { throughRevision, entries, next: rows.length > 100 ? { revision: last.revision, ordinal: last.ordinal } : null };
}
