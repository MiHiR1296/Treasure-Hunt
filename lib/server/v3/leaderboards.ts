import {
  buildMainLeaderboardFromSelections,
  buildReplayLeaderboardFromSelections,
} from '../../v3/leaderboard';
import type {
  BestRunSelection,
  CompletedRunRecord,
  LeaderboardPolicy,
  MainLeaderboardEntry,
  V3Definition,
} from '../../v3/types';
import type { PoolClient } from 'pg';
import { getPool } from '../db';
import { HttpError } from '../security';

type Queryable = Pick<PoolClient, 'query'>;

type ProjectionRow = {
  team_id: string;
  canonical_code: string;
  display_name: string | null;
  eligible_completed_runs: number | string;
  eligible_run_count: number | string;
  best_run_id: string | null;
  best_run_number: number | null;
  best_score: number | null;
  best_elapsed_ms: number | string | null;
  best_completed_at: string | null;
  best_progress_completed: number | null;
  best_progress_total: number | null;
  first_run_id: string | null;
  first_run_number: number | null;
  first_score: number | null;
  first_elapsed_ms: number | string | null;
  first_completed_at: string | null;
  current_run_id: string | null;
  current_run_number: number | null;
  current_status: 'waiting' | 'active' | null;
  current_score: number | null;
  current_progress_completed: number | null;
  current_progress_total: number | null;
};

type OperationalSelection = {
  teamId: string;
  teamCode: string;
  teamName?: string;
  score: number;
  runId?: string;
  attemptNumber?: number;
  eligibleCompletedRuns: number;
  runCount: number;
  status: MainLeaderboardEntry['status'];
  provisional: boolean;
  progress?: { completed: number; total: number };
  elapsedMilliseconds?: number;
  completedAt?: string;
};

type LeaderboardProjection = {
  official: BestRunSelection[];
  operational: OperationalSelection[];
};

/**
 * Collapse run history in PostgreSQL. Only one narrow best/first/count row per
 * active team crosses the application boundary; engine_state and private run
 * material never enter the leaderboard read path.
 */
async function leaderboardProjection(
  huntId: string,
  database: Queryable,
): Promise<LeaderboardProjection> {
  const { rows } = await database.query(
    `with eligible_counts as (
      select r.team_id,
        count(*) filter(where r.status='completed') as eligible_completed_runs,
        count(*) filter(where r.status in ('waiting','active','completed')) as eligible_run_count
      from hunt_v3.runs r
      where r.hunt_id=$1 and r.eligible and not r.practice
      group by r.team_id
    )
    select t.id as team_id,t.canonical_code,t.display_name,
      coalesce(c.eligible_completed_runs,0) as eligible_completed_runs,
      coalesce(c.eligible_run_count,0) as eligible_run_count,
      best.id as best_run_id,best.run_number as best_run_number,best.score as best_score,
      best.elapsed_ms as best_elapsed_ms,
      to_char(best.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as best_completed_at,
      round(best.progress*best.progress_total)::integer as best_progress_completed,
      best.progress_total as best_progress_total,
      first.id as first_run_id,first.run_number as first_run_number,first.score as first_score,
      first.elapsed_ms as first_elapsed_ms,
      to_char(first.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as first_completed_at,
      current.id as current_run_id,current.run_number as current_run_number,current.status as current_status,
      current.score as current_score,
      round(current.progress*current.progress_total)::integer as current_progress_completed,
      current.progress_total as current_progress_total
    from hunt_v3.teams t
    left join eligible_counts c on c.team_id=t.id
    left join lateral (
      select r.id,r.run_number,r.score,r.elapsed_ms,r.completed_at,r.progress,
        case
          when jsonb_typeof(r.route_plan->'checkpointIds')='array' then jsonb_array_length(r.route_plan->'checkpointIds')
          when jsonb_typeof(r.route_plan->'routeCheckpointIds')='array' then jsonb_array_length(r.route_plan->'routeCheckpointIds')
          else 0
        end as progress_total
      from hunt_v3.runs r
      where r.hunt_id=$1 and r.team_id=t.id and r.status='completed' and r.eligible and not r.practice
      order by r.score desc,r.elapsed_ms asc,r.completed_at asc,r.id asc
      limit 1
    ) best on true
    left join lateral (
      select r.id,r.run_number,r.score,r.elapsed_ms,r.completed_at
      from hunt_v3.runs r
      where r.hunt_id=$1 and r.team_id=t.id and r.status='completed' and r.eligible and not r.practice
      order by r.run_number asc,r.completed_at asc,r.id asc
      limit 1
    ) first on true
    left join lateral (
      select r.id,r.run_number,r.status,r.score,r.progress,
        case
          when jsonb_typeof(r.route_plan->'checkpointIds')='array' then jsonb_array_length(r.route_plan->'checkpointIds')
          when jsonb_typeof(r.route_plan->'routeCheckpointIds')='array' then jsonb_array_length(r.route_plan->'routeCheckpointIds')
          else 0
        end as progress_total
      from hunt_v3.runs r
      where best.id is null and r.hunt_id=$1 and r.team_id=t.id
        and r.status in ('waiting','active') and r.eligible and not r.practice
      order by r.run_number desc,r.created_at desc,r.id asc
      limit 1
    ) current on true
    where t.hunt_id=$1 and t.status='active'
    order by t.canonical_code asc`,
    [huntId],
  );
  const official: BestRunSelection[] = [];
  const operational: OperationalSelection[] = [];
  for (const row of rows as ProjectionRow[]) {
    const shared = {
      teamId: row.team_id,
      teamCode: row.canonical_code,
      ...(row.display_name ? { teamName: row.display_name } : {}),
      status: 'completed' as const,
      eligible: true,
      practice: false,
    };
    const run = (prefix: 'best' | 'first'): CompletedRunRecord => {
      const progressTotal = prefix === 'best' ? Number(row.best_progress_total) : 0;
      const progressCompleted = prefix === 'best' ? Number(row.best_progress_completed) : 0;
      return {
        ...shared,
        runId: row[`${prefix}_run_id`]!,
        attemptNumber: row[`${prefix}_run_number`]!,
        score: row[`${prefix}_score`]!,
        elapsedMilliseconds: Number(row[`${prefix}_elapsed_ms`]),
        completedAt: row[`${prefix}_completed_at`]!,
        ...(Number.isSafeInteger(progressTotal) && progressTotal > 0 && Number.isSafeInteger(progressCompleted) ? {
          progress: { completed: Math.max(0, Math.min(progressTotal, progressCompleted)), total: progressTotal },
        } : {}),
      };
    };
    const eligibleCompletedRuns = Number(row.eligible_completed_runs);
    const runCount = Number(row.eligible_run_count);
    if (row.best_run_id && row.first_run_id) {
      const bestRun = run('best');
      official.push({ ...shared, bestRun, firstRun: run('first'), eligibleCompletedRuns });
      operational.push({
        teamId: row.team_id,
        teamCode: row.canonical_code,
        ...(row.display_name ? { teamName: row.display_name } : {}),
        score: bestRun.score,
        runId: bestRun.runId,
        attemptNumber: bestRun.attemptNumber,
        eligibleCompletedRuns,
        runCount,
        status: 'completed',
        provisional: false,
        ...(bestRun.progress ? { progress: bestRun.progress } : {}),
        elapsedMilliseconds: bestRun.elapsedMilliseconds,
        completedAt: bestRun.completedAt,
      });
      continue;
    }
    const progressTotal = Number(row.current_progress_total);
    const progressCompleted = Number(row.current_progress_completed);
    operational.push({
      teamId: row.team_id,
      teamCode: row.canonical_code,
      ...(row.display_name ? { teamName: row.display_name } : {}),
      score: row.current_score ?? 0,
      ...(row.current_run_id ? { runId: row.current_run_id } : {}),
      ...(row.current_run_number ? { attemptNumber: row.current_run_number } : {}),
      eligibleCompletedRuns,
      runCount,
      status: row.current_status ?? 'registered',
      provisional: true,
      ...(row.current_run_id && Number.isSafeInteger(progressTotal) && progressTotal > 0 && Number.isSafeInteger(progressCompleted) ? {
        progress: { completed: Math.max(0, Math.min(progressTotal, progressCompleted)), total: progressTotal },
      } : {}),
    });
  }
  return { official, operational };
}

function compareOperationalCore(left: OperationalSelection, right: OperationalSelection) {
  const score = right.score - left.score;
  if (score) return score;
  if (left.provisional !== right.provisional) return left.provisional ? 1 : -1;
  if (!left.provisional && !right.provisional) {
    const elapsed = (left.elapsedMilliseconds ?? Number.POSITIVE_INFINITY) -
      (right.elapsedMilliseconds ?? Number.POSITIVE_INFINITY);
    if (elapsed) return elapsed;
    const completion = (left.completedAt ?? '').localeCompare(right.completedAt ?? '');
    if (completion) return completion;
    return 0;
  }
  const leftTotal = left.progress?.total ?? 0;
  const rightTotal = right.progress?.total ?? 0;
  const leftCompleted = left.progress?.completed ?? 0;
  const rightCompleted = right.progress?.completed ?? 0;
  const progress = rightCompleted * (leftTotal || 1) - leftCompleted * (rightTotal || 1);
  if (progress) return progress;
  const statusOrder: Record<OperationalSelection['status'], number> = {
    active: 0,
    waiting: 1,
    registered: 2,
    completed: 3,
  };
  return statusOrder[left.status] - statusOrder[right.status];
}

function buildOperationalMainEntries(
  selections: readonly OperationalSelection[],
  policy: LeaderboardPolicy,
): MainLeaderboardEntry[] {
  if (!policy.mainBoardEnabled) return [];
  const ordered = [...selections].sort((left, right) =>
    compareOperationalCore(left, right) ||
    (left.runId ?? '').localeCompare(right.runId ?? '') ||
    left.teamCode.localeCompare(right.teamCode),
  );
  let rank = 0;
  return ordered.map((selection, index) => {
    if (index === 0 || compareOperationalCore(selection, ordered[index - 1]) !== 0) rank = index + 1;
    const revealTime = !selection.provisional && selection.elapsedMilliseconds !== undefined &&
      (policy.timeVisibility === 'always' ||
        (policy.timeVisibility === 'after_second_eligible_run' && selection.eligibleCompletedRuns >= 2));
    return {
      rank,
      teamId: selection.teamId,
      teamCode: selection.teamCode,
      ...(selection.teamName ? { teamName: selection.teamName } : {}),
      score: selection.score,
      ...(selection.runId ? { bestRunId: selection.runId } : {}),
      ...(selection.attemptNumber ? { bestAttemptNumber: selection.attemptNumber } : {}),
      eligibleCompletedRuns: selection.eligibleCompletedRuns,
      runCount: selection.runCount,
      status: selection.status,
      provisional: selection.provisional,
      ...(selection.progress ? { progress: selection.progress } : {}),
      ...(revealTime ? { visibleElapsedMilliseconds: selection.elapsedMilliseconds } : {}),
    };
  });
}

async function huntLeaderboardContext(huntId: string, database: Queryable) {
  const hunt = (await database.query(
    `select h.id,h.title,h.slug,h.latest_version,v.definition
      from hunt_v3.hunts h join hunt_v3.hunt_versions v on v.hunt_id=h.id and v.version=h.latest_version
      where h.id=$1`,
    [huntId],
  )).rows[0] as { id: string; title: string; slug: string; latest_version: number; definition: V3Definition } | undefined;
  if (!hunt) throw new HttpError(404, 'Hunt not found.');
  return hunt;
}

function privateRows<T extends { teamId: string; bestRunId?: string }>(entries: readonly T[], viewerTeamId: string) {
  return entries.map(({ teamId, bestRunId: _bestRunId, ...entry }) => ({
    ...entry,
    isOwnTeam: teamId === viewerTeamId,
  }));
}

export async function teamLeaderboards(huntId: string, viewerTeamId: string, suppliedDatabase?: Queryable) {
  const database = suppliedDatabase ?? getPool();
  const hunt = await huntLeaderboardContext(huntId, database);
  const policy = hunt.definition.settings.leaderboardPolicy;
  if (!policy.mainBoardEnabled && !policy.replayBoardEnabled) {
    return {
      hunt: { id: hunt.id, title: hunt.title },
      main: { visible: false, entries: [] },
      replay: {
        enabled: false,
        visible: false,
        unlocked: false,
        unlockMessage: 'Complete a second eligible run to unlock replay times and improvement.',
        entries: [],
      },
    };
  }
  const projection = await leaderboardProjection(huntId, database);
  const viewerRunCount = projection.official.find(selection => selection.teamId === viewerTeamId)?.eligibleCompletedRuns ?? 0;
  const main = buildOperationalMainEntries(projection.operational, policy);
  const replayUnlocked = policy.replayBoardEnabled && viewerRunCount >= 2;
  const replay = replayUnlocked ? buildReplayLeaderboardFromSelections(projection.official, policy) : [];
  return {
    hunt: { id: hunt.id, title: hunt.title },
    main: { visible: policy.mainBoardEnabled, entries: privateRows(main, viewerTeamId) },
    replay: {
      enabled: policy.replayBoardEnabled,
      visible: replayUnlocked,
      unlocked: replayUnlocked,
      unlockMessage: policy.replayBoardEnabled && !replayUnlocked ? 'Complete a second eligible run to unlock replay times and improvement.' : undefined,
      entries: privateRows(replay, viewerTeamId),
    },
  };
}

type BoardRow = Record<string, unknown>;

function publicRows(entries: Array<Record<string, unknown>>, board: Record<string, unknown>): BoardRow[] {
  const columns = new Set(Array.isArray(board.visible_columns) ? board.visible_columns as string[] : []);
  const showNames = board.team_name_mode === 'display_name';
  return entries.map(entry => ({
    ...(columns.has('rank') ? { rank: entry.rank } : {}),
    ...(columns.has('team_code') ? { teamCode: entry.teamCode } : {}),
    ...(showNames && columns.has('team_name') && entry.teamName ? { teamName: entry.teamName } : {}),
    ...(columns.has('points') ? { points: entry.score } : {}),
    ...(columns.has('progress') && entry.progress ? { progress: entry.progress } : {}),
    ...(columns.has('runs') ? { runs: entry.runCount ?? entry.eligibleCompletedRuns } : {}),
    ...(columns.has('time') && entry.visibleElapsedMilliseconds !== undefined ? { elapsedMilliseconds: entry.visibleElapsedMilliseconds } : {}),
    ...(columns.has('completion_status') && typeof entry.status === 'string' ? { status: entry.status } : {}),
  }));
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Snapshots are durable JSON and may predate the current response contract.
 * Rebuild every row from the public allowlist instead of trusting persisted
 * object keys, so an imported or historically malformed snapshot cannot turn
 * into a stable-ID/private-state disclosure.
 */
function sanitizedSnapshotRows(rows: unknown[], board: Record<string, unknown>, kind: 'main' | 'replay') {
  const columns = new Set(Array.isArray(board.visible_columns) ? board.visible_columns as string[] : []);
  const showNames = board.team_name_mode === 'display_name';
  const statuses = new Set(['registered', 'waiting', 'active', 'completed']);
  return rows.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (row.board !== kind) return [];
    const rank = finiteNumber(row.rank);
    const points = finiteNumber(row.points);
    const runs = finiteNumber(row.runs);
    const elapsed = finiteNumber(row.elapsedMilliseconds);
    const progressValue = row.progress;
    const progress = progressValue && typeof progressValue === 'object' && !Array.isArray(progressValue)
      ? progressValue as Record<string, unknown>
      : null;
    const completed = finiteNumber(progress?.completed);
    const total = finiteNumber(progress?.total);
    return [{
      ...(columns.has('rank') && rank !== undefined && Number.isInteger(rank) && rank > 0 ? { rank } : {}),
      ...(columns.has('team_code') && typeof row.teamCode === 'string' ? { teamCode: row.teamCode.slice(0, 32) } : {}),
      ...(showNames && columns.has('team_name') && typeof row.teamName === 'string' ? { teamName: row.teamName.slice(0, 80) } : {}),
      ...(columns.has('points') && points !== undefined ? { points } : {}),
      ...(columns.has('progress') && completed !== undefined && total !== undefined &&
        Number.isInteger(completed) && Number.isInteger(total) && completed >= 0 && total > 0 && completed <= total
        ? { progress: { completed, total } } : {}),
      ...(columns.has('runs') && runs !== undefined && Number.isInteger(runs) && runs >= 0 ? { runs } : {}),
      ...(columns.has('time') && elapsed !== undefined && elapsed >= 0 ? { elapsedMilliseconds: elapsed } : {}),
      ...(columns.has('completion_status') && typeof row.status === 'string' && statuses.has(row.status) ? { status: row.status } : {}),
    }];
  });
}

type PublicBoardRecord = Record<string, unknown> & {
  hunt_id: string;
  latest_version: number;
  cache_revision: string;
  definition: V3Definition;
  snapshot_rows?: unknown[];
};

type LiveProjection = {
  generatedAt: string;
  main: BoardRow[];
  replay: BoardRow[];
};

const LIVE_CACHE_MILLISECONDS = 4_000;
const LIVE_CACHE_MAX_BOARDS = 128;
const liveProjectionCache = new Map<string, { expiresAt: number; projection: Promise<LiveProjection> }>();

function pruneLiveCache(now: number) {
  for (const [key, entry] of liveProjectionCache) {
    if (entry.expiresAt <= now) liveProjectionCache.delete(key);
  }
  while (liveProjectionCache.size >= LIVE_CACHE_MAX_BOARDS) {
    const oldest = liveProjectionCache.keys().next().value as string | undefined;
    if (!oldest) break;
    liveProjectionCache.delete(oldest);
  }
}

async function buildLiveProjection(
  board: PublicBoardRecord,
  database: Queryable,
  mode: 'operational' | 'final' = 'operational',
): Promise<LiveProjection> {
  const policy = board.definition.settings.leaderboardPolicy;
  const showMain = Boolean(board.main_board_visible) && policy.mainBoardEnabled;
  const showReplay = Boolean(board.replay_board_visible) && policy.replayBoardEnabled && policy.replayBoardPublic;
  if (!showMain && !showReplay) return { generatedAt: new Date().toISOString(), main: [], replay: [] };
  const projection = await leaderboardProjection(board.hunt_id, database);
  const mainEntries = mode === 'final'
    ? buildMainLeaderboardFromSelections(projection.official, policy)
    : buildOperationalMainEntries(projection.operational, policy);
  const main = publicRows(
    mainEntries as unknown as Array<Record<string, unknown>>,
    board,
  );
  const replay = publicRows(
    buildReplayLeaderboardFromSelections(projection.official, policy) as unknown as Array<Record<string, unknown>>,
    board,
  );
  return {
    generatedAt: new Date().toISOString(),
    main: showMain ? main : [],
    replay: showReplay ? replay : [],
  };
}

async function cachedLiveProjection(board: PublicBoardRecord, database: Queryable) {
  const now = Date.now();
  const key = `${board.hunt_id}:${board.latest_version}:${board.cache_revision}`;
  const cached = liveProjectionCache.get(key);
  if (cached && cached.expiresAt > now) return cached.projection;
  pruneLiveCache(now);
  const projection = buildLiveProjection(board, database);
  liveProjectionCache.set(key, { expiresAt: now + LIVE_CACHE_MILLISECONDS, projection });
  try {
    return await projection;
  } catch (error) {
    if (liveProjectionCache.get(key)?.projection === projection) liveProjectionCache.delete(key);
    throw error;
  }
}

export async function publicLeaderboard(
  slug: string,
  suppliedDatabase?: Queryable,
  projectionMode?: 'operational' | 'final',
) {
  if (slug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new HttpError(404, 'Public board not found.');
  const database = suppliedDatabase ?? getPool();
  const board = (await database.query(
    `select b.*,h.title as hunt_title,h.status as hunt_status,h.latest_version,v.definition,
      to_char(b.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cache_revision,
      s.rows as snapshot_rows,s.generated_at as snapshot_generated_at
      from hunt_v3.public_boards b
      join hunt_v3.hunts h on h.id=b.hunt_id
      join hunt_v3.hunt_versions v on v.hunt_id=h.id and v.version=h.latest_version
      left join hunt_v3.public_board_snapshots s on s.id=b.current_snapshot_id and s.hunt_id=b.hunt_id
      where b.slug=$1 and b.enabled`,
    [slug],
  )).rows[0] as PublicBoardRecord | undefined;
  if (!board) throw new HttpError(404, 'Public board not found.');
  if ((board.event_status === 'frozen' || board.event_status === 'final') && board.snapshot_rows) {
    const snapshot = Array.isArray(board.snapshot_rows) ? board.snapshot_rows as Array<Record<string, unknown>> : [];
    return {
      title: board.title,
      cover: board.cover_ref,
      status: board.event_status,
      columns: board.visible_columns,
      generatedAt: board.snapshot_generated_at,
      frozen: true,
      main: sanitizedSnapshotRows(snapshot, board, 'main'),
      replay: sanitizedSnapshotRows(snapshot, board, 'replay'),
    };
  }
  // Explicit Queryables are used by the atomic snapshot transaction and must
  // always observe their transaction-local board configuration and run cutoff.
  const mode = projectionMode ?? (board.event_status === 'final' ? 'final' : 'operational');
  const live = suppliedDatabase
    ? await buildLiveProjection(board, database, mode)
    : mode === 'final'
      ? await buildLiveProjection(board, database, 'final')
      : await cachedLiveProjection(board, database);
  return {
    title: board.title,
    cover: board.cover_ref,
    status: board.event_status,
    columns: board.visible_columns,
    generatedAt: live.generatedAt,
    frozen: false,
    main: live.main,
    replay: live.replay,
  };
}
