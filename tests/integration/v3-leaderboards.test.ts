import '../isolated-database';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { getPool } from '../../lib/server/db';
import { publicLeaderboard, teamLeaderboards } from '../../lib/server/v3/leaderboards';
import { freezePublicBoard, setHuntLifecycle } from '../../lib/server/v3/operations';

const enabled = Boolean(process.env.DATABASE_URL);

before(async () => {
  if (!enabled) return;
  const schema = await readFile(new URL('../../database/v3.sql', import.meta.url), 'utf8');
  await getPool().query(schema);
});

after(async () => {
  if (enabled) await getPool().end();
});

type TeamFixture = { id: string; code: string };

test('replay board is hidden when the configured run policy can never reach a second scored finish', { skip: !enabled }, async () => {
  const cases = [
    { mode: 'disabled', expected: false },
    { mode: 'practice-only', expected: false },
    { mode: 'capped', maxOfficialRuns: 1, expected: false },
    { mode: 'capped', maxOfficialRuns: 2, expected: true },
    { mode: 'unlimited', expected: true },
  ] as const;
  for (const [index, runPolicy] of cases.entries()) {
    const huntId = `v3-replay-availability-${index}-${randomUUID().slice(0, 8)}`;
    const teamId = randomUUID();
    const definition = {
      schemaVersion: 3,
      id: huntId,
      version: 1,
      title: 'Replay availability test',
      settings: {
        integrityPolicy: { locationVerification: 'gps_only', selfServeApproval: 'automatic', rosterParticipation: 'flexible_fixed_scoring' },
        runPolicy: runPolicy.mode === 'capped'
          ? { mode: runPolicy.mode, maxOfficialRuns: runPolicy.maxOfficialRuns }
          : { mode: runPolicy.mode },
        leaderboardPolicy: {
          bestRunRule: 'score_then_time_then_completion',
          mainBoardEnabled: true,
          replayBoardEnabled: true,
          replayBoardPublic: false,
          timeVisibility: 'after_second_eligible_run',
          showProgress: false,
        },
      },
      checkpoints: [],
    };
    await getPool().query(
      `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,latest_version,settings)
        values($1,$2,$1,'live','organizer_assigned',1,$3)`,
      [huntId, definition.title, definition.settings],
    );
    await getPool().query(
      `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
        values($1,1,$2,$3,$4,$5)`,
      [huntId, definition, String(index + 1).repeat(64), { valid: true, issues: [] }, { valid: true, issues: [], routes: [] }],
    );
    await getPool().query(
      `insert into hunt_v3.teams(
        id,hunt_id,canonical_code,pin_hash,registration_source,approval_status,approval_method)
        values($1,$2,'T-001',$3,'organizer_assigned','approved','organizer')`,
      [teamId, huntId, 'p'.repeat(32)],
    );
    const board = await teamLeaderboards(huntId, teamId);
    assert.equal(board.replay.enabled, runPolicy.expected, `unexpected replay availability for ${runPolicy.mode}`);
    assert.equal(board.replay.unlocked, false);
  }
});

test('PostgreSQL V3 leaderboards project one best/first/count row per team and safely cache only live anonymous reads', { skip: !enabled }, async () => {
  const suffix = randomUUID().slice(0, 8);
  const huntId = `v3-leaderboard-${suffix}`;
  const boardSlug = `${huntId}-board`;
  const policy = {
    bestRunRule: 'score_then_time_then_completion',
    mainBoardEnabled: true,
    replayBoardEnabled: true,
    replayBoardPublic: true,
    timeVisibility: 'after_second_eligible_run',
    showProgress: true,
  } as const;
  const definition = {
    schemaVersion: 3,
    id: huntId,
    version: 1,
    title: 'Leaderboard projection test',
    settings: {
      integrityPolicy: { locationVerification: 'strict', selfServeApproval: 'organizer', rosterParticipation: 'freeze_at_run_start' },
      leaderboardPolicy: policy,
    },
    checkpoints: [],
  };
  await getPool().query(
    `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,settings)
      values($1,'Leaderboard projection test',$1,'live','self_serve','{}')`,
    [huntId],
  );
  await getPool().query(
    `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,1,$2,$3,'{}',$4)`,
    [huntId, definition, 'a'.repeat(64), { valid: true, issues: [], routes: [] }],
  );
  await getPool().query('update hunt_v3.hunts set latest_version=1 where id=$1', [huntId]);
  await getPool().query(
    `insert into hunt_v3.public_boards(
      hunt_id,slug,enabled,title,event_status,visible_columns,main_board_visible,replay_board_visible,team_name_mode)
      values($1,$2,true,'Live leaderboard','live',$3,true,true,'display_name')`,
    [huntId, boardSlug, ['rank', 'team_code', 'team_name', 'points', 'progress', 'runs', 'time']],
  );

  const teams = new Map<string, TeamFixture>();
  const addTeam = async (key: string, code: string, status = 'active') => {
    const team = { id: randomUUID(), code };
    teams.set(key, team);
    await getPool().query(
      `insert into hunt_v3.teams(
        id,hunt_id,canonical_code,display_name,name_key,name_status,pin_hash,registration_source,status)
        values($1,$2,$3,$4,$5,'approved',$6,'self_serve',$7)`,
      [team.id, huntId, code, `Team ${key}`, `team-${key.toLowerCase()}`, 'p'.repeat(32), status],
    );
    return team;
  };
  await addTeam('A', 'T-001');
  await addTeam('B', 'T-002');
  await addTeam('C', 'T-003');
  await addTeam('D', 'T-004');
  await addTeam('E', 'T-005');
  await addTeam('Hidden', 'T-999', 'archived');

  const addRun = async (input: {
    team: string;
    runNumber: number;
    score: number;
    elapsed: number;
    completedAt: string;
    id?: string;
    progress?: number;
    practice?: boolean;
    eligible?: boolean;
  }) => {
    const team = teams.get(input.team)!;
    const runId = input.id ?? randomUUID();
    const practice = input.practice ?? false;
    const eligible = input.eligible ?? !practice;
    await getPool().query(
      `insert into hunt_v3.runs(
        id,team_id,hunt_id,hunt_version,run_number,private_seed,seed_commitment,
        route_plan,resolved_variables,engine_state,status,practice,eligible,score,progress,
        started_at,completed_at,elapsed_ms)
        values($1,$2,$3,1,$4,$5,$6,$7,'{}',$8,'completed',$9,$10,$11,$12,
          $13::timestamptz-($14::bigint*interval '1 millisecond'),$13::timestamptz,$14)`,
      [runId, team.id, huntId, input.runNumber, randomUUID().replaceAll('-', ''), randomUUID().replaceAll('-', '').repeat(2),
        { routeCheckpointIds: ['start', 'middle', 'finish'], checkpointIds: ['start', 'middle', 'finish'] },
        { privatePayload: 'must-never-cross-the-leaderboard-boundary' }, practice, eligible, input.score,
        input.progress ?? 1, input.completedAt, input.elapsed],
    );
    return runId;
  };

  await addRun({ team: 'A', runNumber: 1, score: 100, elapsed: 600_000, completedAt: '2026-10-01T10:00:00.000001Z' });
  await addRun({ team: 'A', runNumber: 2, score: 110, elapsed: 900_000, completedAt: '2026-10-01T12:00:00.000001Z' });
  await addRun({ team: 'A', runNumber: 3, score: 999, elapsed: 1, completedAt: '2026-10-01T13:00:00.000001Z', practice: true });
  await addRun({ team: 'B', runNumber: 1, score: 110, elapsed: 840_000, completedAt: '2026-10-01T11:00:00.000001Z' });
  await addRun({
    team: 'C', runNumber: 1, score: 110, elapsed: 840_000, completedAt: '2026-10-01T10:30:00.000001Z',
    id: `10000000-0000-0000-0000-${randomUUID().replaceAll('-', '').slice(0, 12)}`, progress: 2 / 3,
  });
  await addRun({
    team: 'D', runNumber: 1, score: 110, elapsed: 840_000, completedAt: '2026-10-01T10:30:00.000001Z',
    id: `20000000-0000-0000-0000-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
  });
  await addRun({
    team: 'E', runNumber: 1, score: 110, elapsed: 840_000, completedAt: '2026-10-01T10:30:00.000002Z',
    id: `00000000-0000-0000-0000-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
  });
  await addRun({ team: 'Hidden', runNumber: 1, score: 5_000, elapsed: 1, completedAt: '2026-10-01T09:00:00.000001Z' });

  const queryText: string[] = [];
  const tracingDatabase = {
    query: async (text: string, values?: unknown[]) => {
      queryText.push(text);
      return getPool().query(text, values);
    },
  } as unknown as Pick<PoolClient, 'query'>;
  const privateBoard = await teamLeaderboards(huntId, teams.get('A')!.id, tracingDatabase);
  assert.equal(privateBoard.main.entries.length, 5, 'one row per active team crosses the server boundary');
  assert.equal(JSON.stringify(privateBoard).includes('teamId'), false, 'private standings do not disclose stable competitor IDs');
  assert.equal(JSON.stringify(privateBoard).includes('bestRunId'), false, 'private standings do not disclose run IDs');
  assert.equal(privateBoard.main.entries.filter(entry => entry.isOwnTeam).length, 1);
  assert.equal(privateBoard.main.entries.find(entry => entry.teamCode === 'T-001')?.isOwnTeam, true);
  assert.equal(privateBoard.main.entries.find(entry => entry.teamCode === 'T-002')?.isOwnTeam, false);
  assert.deepEqual(
    Object.fromEntries(privateBoard.main.entries.map(entry => [entry.teamCode, entry.rank])),
    { 'T-003': 1, 'T-004': 2, 'T-005': 3, 'T-002': 4, 'T-001': 5 },
    'score, elapsed time, full-microsecond completion time, and canonical code produce one deterministic winner',
  );
  assert.deepEqual(privateBoard.main.entries.find(entry => entry.teamCode === 'T-003')?.progress, { completed: 2, total: 3 });
  assert.equal(privateBoard.main.entries.find(entry => entry.teamCode === 'T-002')?.visibleElapsedMilliseconds, undefined);
  assert.equal(privateBoard.main.entries.find(entry => entry.teamCode === 'T-001')?.visibleElapsedMilliseconds, 900_000);
  assert.equal(privateBoard.replay.enabled, true);
  assert.equal(privateBoard.replay.unlocked, true);
  assert.deepEqual(privateBoard.replay.entries.map(entry => ({
    code: entry.teamCode,
    runs: entry.runCount,
    scoreLift: entry.scoreImprovementFromFirst,
    timeLift: entry.timeImprovementFromFirstMilliseconds,
  })), [{ code: 'T-001', runs: 2, scoreLift: 10, timeLift: -300_000 }]);
  const projectionSql = queryText.find(text => text.includes('eligible_counts')) ?? '';
  assert.ok(projectionSql, 'the run projection executes in PostgreSQL');
  assert.equal(projectionSql.includes('engine_state'), false, 'the leaderboard query never fetches engine state');
  assert.equal(projectionSql.includes('limit 1'), true, 'best and first run selection remains bounded per team');

  const firstLive = await publicLeaderboard(boardSlug) as { generatedAt: string; main: Array<Record<string, unknown>> };
  const repeatedLive = await publicLeaderboard(boardSlug) as { generatedAt: string; main: Array<Record<string, unknown>> };
  assert.equal(repeatedLive.generatedAt, firstLive.generatedAt, 'anonymous live reads share the short process-local snapshot');

  await addTeam('F', 'T-006');
  await addRun({ team: 'F', runNumber: 1, score: 999, elapsed: 60_000, completedAt: '2026-10-01T14:00:00.000001Z' });
  const cachedAfterRun = await publicLeaderboard(boardSlug) as { main: Array<Record<string, unknown>> };
  assert.equal(cachedAfterRun.main.some(row => row.teamCode === 'T-006'), false, 'a live cache has a deliberately short stale window');

  const client = await getPool().connect();
  try {
    await client.query('begin isolation level repeatable read');
    const transactionFresh = await publicLeaderboard(boardSlug, client) as { main: Array<Record<string, unknown>> };
    assert.equal(transactionFresh.main[0]?.teamCode, 'T-006', 'an explicit transaction client always bypasses the process cache');
    await client.query('update hunt_v3.public_boards set main_board_visible=false where hunt_id=$1', [huntId]);
    const transactionConfig = await publicLeaderboard(boardSlug, client) as { main: Array<Record<string, unknown>> };
    assert.deepEqual(transactionConfig.main, [], 'snapshot callers observe transaction-local board controls');
  } finally {
    await client.query('rollback');
    client.release();
  }

  const frozenRows = [{ board: 'main', rank: 1, teamCode: 'FROZEN', points: 321 }];
  const snapshotId = (await getPool().query(
    `insert into hunt_v3.public_board_snapshots(hunt_id,board_kind,rows,source_cutoff,generated_by)
      values($1,'combined',$2,clock_timestamp(),'leaderboard test') returning id`,
    [huntId, JSON.stringify(frozenRows)],
  )).rows[0].id;
  await getPool().query(
    `update hunt_v3.public_boards
      set event_status='frozen',current_snapshot_id=$1,frozen_at=clock_timestamp()
      where hunt_id=$2`,
    [snapshotId, huntId],
  );
  const frozen = await publicLeaderboard(boardSlug) as { frozen: boolean; main: Array<Record<string, unknown>> };
  assert.equal(frozen.frozen, true);
  assert.deepEqual(frozen.main, [{ rank: 1, teamCode: 'FROZEN', points: 321 }], 'frozen/final state bypasses any prior live cache');

  const indexes = (await getPool().query(
    `select indexname from pg_indexes
      where schemaname='hunt_v3' and indexname in ('runs_official_team_best','runs_official_team_first')`,
  )).rows.map(row => row.indexname).sort();
  assert.deepEqual(indexes, ['runs_official_team_best', 'runs_official_team_first']);
});

test('PostgreSQL V3 leaderboard fields come only from eligible completed official runs once a team has one', { skip: !enabled }, async () => {
  const suffix = randomUUID().slice(0, 8);
  const huntId = `v3-leaderboard-source-${suffix}`;
  const boardSlug = `${huntId}-board`;
  const teamId = randomUUID();
  const policy = {
    bestRunRule: 'score_then_time_then_completion',
    mainBoardEnabled: true,
    replayBoardEnabled: true,
    replayBoardPublic: true,
    timeVisibility: 'after_second_eligible_run',
    showProgress: true,
  } as const;
  const definition = {
    schemaVersion: 3,
    id: huntId,
    version: 1,
    title: 'Leaderboard source isolation test',
    settings: {
      integrityPolicy: { locationVerification: 'strict', selfServeApproval: 'organizer', rosterParticipation: 'freeze_at_run_start' },
      leaderboardPolicy: policy,
    },
    checkpoints: [],
  };
  await getPool().query(
    `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,settings,latest_version)
      values($1,'Leaderboard source isolation test',$1,'live','self_serve','{}',1)`,
    [huntId],
  );
  await getPool().query(
    `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,1,$2,$3,'{}',$4)`,
    [huntId, definition, 'b'.repeat(64), { valid: true, issues: [], routes: [] }],
  );
  await getPool().query(
    `insert into hunt_v3.public_boards(
      hunt_id,slug,enabled,title,event_status,visible_columns,main_board_visible,replay_board_visible,team_name_mode)
      values($1,$2,true,'Source-isolated leaderboard','live',$3,true,true,'display_name')`,
    [huntId, boardSlug, ['rank', 'team_code', 'points', 'progress', 'runs', 'time', 'completion_status']],
  );
  await getPool().query(
    `insert into hunt_v3.teams(
      id,hunt_id,canonical_code,display_name,name_key,name_status,pin_hash,registration_source,approval_status,status)
      values($1,$2,'T-091','Source Team',$3,'approved',$4,'self_serve','approved','active')`,
    [teamId, huntId, `source-team-${suffix}`, 'p'.repeat(32)],
  );

  const addRun = async (input: {
    runNumber: number;
    status: 'active' | 'completed';
    score: number;
    progress: number;
    elapsed?: number;
    completedAt?: string;
    practice?: boolean;
    eligible?: boolean;
  }) => {
    const completed = input.status === 'completed';
    const practice = input.practice ?? false;
    const eligible = input.eligible ?? !practice;
    await getPool().query(
      `insert into hunt_v3.runs(
        id,team_id,hunt_id,hunt_version,run_number,private_seed,seed_commitment,
        route_plan,resolved_variables,engine_state,status,practice,eligible,score,progress,
        started_at,completed_at,elapsed_ms)
        values($1,$2,$3,1,$4,$5,$6,$7,'{}','{}',$8,$9,$10,$11,$12,$13,$14,$15)`,
      [randomUUID(), teamId, huntId, input.runNumber, randomUUID().replaceAll('-', ''),
        randomUUID().replaceAll('-', '').repeat(2),
        { checkpointIds: ['start', 'middle', 'finish'] }, input.status, practice, eligible,
        input.score, input.progress, '2026-10-03T09:00:00.000001Z',
        completed ? input.completedAt : null, completed ? input.elapsed : null],
    );
  };

  await addRun({
    runNumber: 1, status: 'completed', score: 100, progress: 1 / 3,
    elapsed: 700_000, completedAt: '2026-10-03T10:00:00.000001Z',
  });
  await addRun({
    runNumber: 2, status: 'completed', score: 120, progress: 2 / 3,
    elapsed: 600_000, completedAt: '2026-10-03T11:00:00.000001Z',
  });
  await addRun({
    runNumber: 3, status: 'completed', score: 9_999, progress: 1,
    elapsed: 1, completedAt: '2026-10-03T12:00:00.000001Z', practice: true,
  });
  await addRun({
    runNumber: 4, status: 'completed', score: 8_888, progress: 1,
    elapsed: 2, completedAt: '2026-10-03T13:00:00.000001Z', eligible: false,
  });
  await addRun({ runNumber: 5, status: 'active', score: 7_777, progress: 1, eligible: true });

  const privateBoard = await teamLeaderboards(huntId, teamId, getPool());
  const privateMain = privateBoard.main.entries[0];
  assert.deepEqual({
    score: privateMain?.score,
    progress: privateMain?.progress,
    time: privateMain?.visibleElapsedMilliseconds,
    eligibleCompletedRuns: privateMain?.eligibleCompletedRuns,
    runCount: privateMain?.runCount,
    status: privateMain?.status,
  }, {
    score: 120,
    progress: { completed: 2, total: 3 },
    time: 600_000,
    eligibleCompletedRuns: 2,
    runCount: 2,
    status: 'completed',
  }, 'the team board projects every displayed result field from eligible completed official history');
  assert.equal(privateBoard.replay.entries[0]?.runCount, 2);

  const publicBoard = await publicLeaderboard(boardSlug, getPool()) as {
    main: Array<Record<string, unknown>>;
    replay: Array<Record<string, unknown>>;
  };
  assert.deepEqual(publicBoard.main[0], {
    rank: 1,
    teamCode: 'T-091',
    points: 120,
    progress: { completed: 2, total: 3 },
    runs: 2,
    elapsedMilliseconds: 600_000,
    status: 'completed',
  });
  assert.deepEqual(publicBoard.replay[0], {
    rank: 1,
    teamCode: 'T-091',
    points: 120,
    progress: { completed: 2, total: 3 },
    runs: 2,
    elapsedMilliseconds: 600_000,
    status: 'completed',
  });
});

test('PostgreSQL V3 live Main board includes provisional teams while Final and Replay remain completed-only', { skip: !enabled }, async () => {
  const suffix = randomUUID().slice(0, 8);
  const huntId = `v3-live-main-${suffix}`;
  const boardSlug = `${huntId}-board`;
  const definition = {
    schemaVersion: 3,
    id: huntId,
    version: 1,
    title: 'Live Main projection test',
    settings: {
      integrityPolicy: { locationVerification: 'strict', selfServeApproval: 'organizer', rosterParticipation: 'freeze_at_run_start' },
      leaderboardPolicy: {
        bestRunRule: 'score_then_time_then_completion',
        mainBoardEnabled: true,
        replayBoardEnabled: true,
        replayBoardPublic: true,
        timeVisibility: 'after_second_eligible_run',
        showProgress: true,
      },
    },
    checkpoints: [],
  };
  await getPool().query(
    `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,settings)
      values($1,'Live Main projection test',$1,'live','self_serve','{}')`,
    [huntId],
  );
  await getPool().query(
    `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,1,$2,$3,'{}',$4)`,
    [huntId, definition, 'c'.repeat(64), { valid: true, issues: [], routes: [] }],
  );
  await getPool().query('update hunt_v3.hunts set latest_version=1 where id=$1', [huntId]);
  await getPool().query(
    `insert into hunt_v3.public_boards(
      hunt_id,slug,enabled,title,event_status,visible_columns,main_board_visible,replay_board_visible,team_name_mode)
      values($1,$2,true,'Operational leaderboard','live',$3,true,true,'display_name')`,
    [huntId, boardSlug, ['rank', 'team_code', 'team_name', 'points', 'progress', 'runs', 'time', 'completion_status']],
  );

  const teams = new Map<string, TeamFixture>();
  const addTeam = async (key: string, code: string, status = 'active') => {
    const team = { id: randomUUID(), code };
    teams.set(key, team);
    await getPool().query(
      `insert into hunt_v3.teams(
        id,hunt_id,canonical_code,display_name,name_key,name_status,pin_hash,registration_source,status)
        values($1,$2,$3,$4,$5,'approved',$6,'self_serve',$7)`,
      [team.id, huntId, code, `Team ${key}`, `live-${key.toLowerCase()}-${suffix}`, 'p'.repeat(32), status],
    );
    return team;
  };
  await addTeam('Registered', 'T-101');
  await addTeam('Waiting', 'T-102');
  await addTeam('Replay', 'T-103');
  await addTeam('Tie', 'T-104');
  await addTeam('High', 'T-105');
  await addTeam('Practice', 'T-106');
  await addTeam('Archived', 'T-999', 'archived');

  const addRun = async (input: {
    team: string;
    runNumber: number;
    status: 'waiting' | 'active' | 'completed';
    score: number;
    progress: number;
    practice?: boolean;
    eligible?: boolean;
    elapsed?: number;
    completedAt?: string;
  }) => {
    const team = teams.get(input.team)!;
    const id = randomUUID();
    const practice = input.practice ?? false;
    const eligible = input.eligible ?? !practice;
    const completedAt = input.status === 'completed'
      ? input.completedAt ?? '2026-10-02T10:00:00.000001Z'
      : null;
    const startedAt = input.status === 'waiting' ? null : '2026-10-02T09:00:00.000001Z';
    await getPool().query(
      `insert into hunt_v3.runs(
        id,team_id,hunt_id,hunt_version,run_number,private_seed,seed_commitment,
        route_plan,resolved_variables,engine_state,status,practice,eligible,score,progress,
        started_at,completed_at,elapsed_ms)
        values($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [id, team.id, huntId, input.runNumber, randomUUID().replaceAll('-', ''), randomUUID().replaceAll('-', '').repeat(2),
        { checkpointIds: ['start', 'middle', 'finish'], privateRouteMarker: 'never-public' },
        { privateVariable: 'never-public' }, {
          schemaVersion: 1,
          definitionId: huntId,
          definitionVersion: 1,
          teamId: team.id,
          revision: 0,
          status: input.status,
          activeCheckpointId: null,
          checkpoints: {},
          hintUsage: {},
          ledger: [],
          events: [],
          score: input.score,
          ...(startedAt ? { startedAt } : {}),
          clockPauses: [],
          privatePayload: 'never-public',
        }, input.status,
        practice, eligible, input.score, input.progress, startedAt, completedAt,
        input.status === 'completed' ? input.elapsed ?? 3_600_000 : null],
    );
    return id;
  };

  await addRun({ team: 'Waiting', runNumber: 1, status: 'waiting', score: 0, progress: 0 });
  const activeReplayId = await addRun({ team: 'Replay', runNumber: 2, status: 'active', score: 999, progress: 2 / 3 });
  await addRun({ team: 'Tie', runNumber: 1, status: 'active', score: 40, progress: 1 / 3 });
  await addRun({ team: 'High', runNumber: 1, status: 'active', score: 90, progress: 2 / 3 });
  await addRun({ team: 'Practice', runNumber: 1, status: 'completed', score: 5_000, progress: 1, practice: true });
  await addRun({ team: 'Archived', runNumber: 1, status: 'active', score: 8_000, progress: 1 });

  const beforeCompletion = await publicLeaderboard(boardSlug, getPool()) as {
    main: Array<Record<string, unknown>>;
    replay: Array<Record<string, unknown>>;
  };
  assert.deepEqual(
    beforeCompletion.main.map(row => row.teamCode).sort(),
    ['T-101', 'T-102', 'T-103', 'T-104', 'T-105', 'T-106'],
    'every active registered team appears before the first official completion',
  );
  assert.equal(beforeCompletion.main.find(row => row.teamCode === 'T-101')?.status, 'registered');
  assert.equal(beforeCompletion.main.find(row => row.teamCode === 'T-102')?.status, 'waiting');
  assert.equal(beforeCompletion.main.find(row => row.teamCode === 'T-103')?.status, 'active');
  assert.equal(beforeCompletion.main.find(row => row.teamCode === 'T-106')?.status, 'registered', 'practice-only history is not an official candidate');
  assert.equal(beforeCompletion.main.find(row => row.teamCode === 'T-103')?.elapsedMilliseconds, undefined, 'provisional time is never revealed as an official tie-break');
  assert.deepEqual(beforeCompletion.replay, [], 'provisional teams never enter Replay');
  const beforeJson = JSON.stringify(beforeCompletion);
  for (const privateValue of [activeReplayId, teams.get('Replay')!.id, 'privatePayload', 'privateVariable', 'privateRouteMarker']) {
    assert.equal(beforeJson.includes(privateValue), false, `public board excludes ${privateValue}`);
  }

  await addRun({
    team: 'Replay', runNumber: 1, status: 'completed', score: 40, progress: 1,
    elapsed: 600_000, completedAt: '2026-10-02T10:00:00.000001Z',
  });
  const privateBoard = await teamLeaderboards(huntId, teams.get('Registered')!.id, getPool());
  const replayTeam = privateBoard.main.entries.find(row => row.teamCode === 'T-103');
  const tiedActive = privateBoard.main.entries.find(row => row.teamCode === 'T-104');
  assert.equal(privateBoard.main.entries.length, 6);
  assert.equal(privateBoard.main.entries[0].teamCode, 'T-105', 'a higher-scoring provisional row remains first on the live view');
  assert.deepEqual(
    { score: replayTeam?.score, status: replayTeam?.status, provisional: replayTeam?.provisional },
    { score: 40, status: 'completed', provisional: false },
    'an official completed best replaces and hides the higher-scoring active replay',
  );
  assert.ok((replayTeam?.rank ?? Infinity) < (tiedActive?.rank ?? -Infinity), 'a tied completed result ranks ahead of a provisional result');
  assert.equal(privateBoard.replay.unlocked, false, 'one completion does not unlock Replay even with another run active');
  const privateJson = JSON.stringify(privateBoard);
  assert.equal(privateJson.includes(activeReplayId), false);
  assert.equal(privateJson.includes(teams.get('Tie')!.id), false);

  await freezePublicBoard(huntId, false, 'leaderboard test');
  const frozen = await publicLeaderboard(boardSlug) as { status: string; main: Array<Record<string, unknown>> };
  assert.equal(frozen.status, 'frozen');
  assert.equal(frozen.main.length, 6, 'a frozen operational snapshot retains registered and in-progress teams');
  assert.equal(frozen.main.find(row => row.teamCode === 'T-104')?.status, 'active');

  const snapshot = (await getPool().query(
    'select current_snapshot_id from hunt_v3.public_boards where hunt_id=$1',
    [huntId],
  )).rows[0];
  const stored = (await getPool().query(
    'select rows from hunt_v3.public_board_snapshots where id=$1',
    [snapshot.current_snapshot_id],
  )).rows[0].rows as Array<Record<string, unknown>>;
  const polluted = stored.map((row, index) => index === 0 ? {
    ...row,
    teamId: teams.get('High')!.id,
    bestRunId: activeReplayId,
    engine_state: { answer: 'never-public' },
    progress: { completed: 2, total: 3, answer: 'never-public' },
  } : row);
  const pollutedSnapshot = (await getPool().query(
    `insert into hunt_v3.public_board_snapshots(hunt_id,board_kind,rows,source_cutoff,generated_by)
      values($1,'combined',$2,clock_timestamp(),'legacy import') returning id`,
    [huntId, JSON.stringify(polluted)],
  )).rows[0];
  await getPool().query(
    'update hunt_v3.public_boards set current_snapshot_id=$1 where hunt_id=$2',
    [pollutedSnapshot.id, huntId],
  );
  const sanitizedFrozen = await publicLeaderboard(boardSlug);
  const sanitizedJson = JSON.stringify(sanitizedFrozen);
  assert.equal(sanitizedJson.includes('teamId'), false);
  assert.equal(sanitizedJson.includes('bestRunId'), false);
  assert.equal(sanitizedJson.includes('engine_state'), false);
  assert.equal(sanitizedJson.includes('never-public'), false);

  await getPool().query(
    `update hunt_v3.public_boards set event_status='live',current_snapshot_id=null,frozen_at=null where hunt_id=$1`,
    [huntId],
  );
  await setHuntLifecycle(huntId, 'ended', 1, 'leaderboard test');
  await freezePublicBoard(huntId, true, 'leaderboard test');
  const final = await publicLeaderboard(boardSlug) as { status: string; main: Array<Record<string, unknown>>; replay: Array<Record<string, unknown>> };
  assert.equal(final.status, 'final');
  assert.deepEqual(final.main.map(row => row.teamCode), ['T-103'], 'Final contains official completed selections only');
  assert.equal(final.main[0]?.status, 'completed');
  assert.deepEqual(final.replay, []);
});

test('PostgreSQL V3 live reads terminalize an expired timed run even when the team sends no later request', { skip: !enabled }, async () => {
  const suffix = randomUUID().slice(0, 8);
  const huntId = `v3-timeout-sweep-${suffix}`;
  const boardSlug = `${huntId}-board`;
  const teamId = randomUUID();
  const runId = randomUUID();
  // Derive fixture time from PostgreSQL as well as measuring expiry there.
  // A container clock can trail the host clock by a few milliseconds, which
  // otherwise makes the exact two-minute elapsed assertion intermittently
  // report 119,99x ms despite correct timeout behavior.
  const fixtureClock = (await getPool().query(
    `select
      clock_timestamp() - interval '2 minutes' as started_at,
      clock_timestamp() - interval '1 minute' as deadline_at`,
  )).rows[0];
  const startedAt = new Date(fixtureClock.started_at).toISOString();
  const deadlineAt = new Date(fixtureClock.deadline_at).toISOString();
  const definition = {
    schemaVersion: 3,
    id: huntId,
    version: 1,
    title: 'Timed expiry projection test',
    settings: {
      integrityPolicy: { locationVerification: 'strict', selfServeApproval: 'organizer', rosterParticipation: 'freeze_at_run_start' },
      leaderboardPolicy: {
        bestRunRule: 'score_then_time_then_completion',
        mainBoardEnabled: true,
        replayBoardEnabled: false,
        replayBoardPublic: false,
        timeVisibility: 'after_second_eligible_run',
        showProgress: true,
      },
    },
    checkpoints: [],
  };
  await getPool().query(
    `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,settings,latest_version)
      values($1,'Timed expiry projection test',$1,'live','organizer_assigned','{}',1)`,
    [huntId],
  );
  await getPool().query(
    `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,1,$2,$3,'{}',$4)`,
    [huntId, definition, 'e'.repeat(64), { valid: true, issues: [], routes: [] }],
  );
  await getPool().query(
    `insert into hunt_v3.public_boards(
      hunt_id,slug,enabled,title,event_status,visible_columns,main_board_visible,replay_board_visible,team_name_mode)
      values($1,$2,true,'Timed live board','live',$3,true,false,'code_only')`,
    [huntId, boardSlug, ['rank', 'team_code', 'points', 'progress', 'completion_status']],
  );
  await getPool().query(
    `insert into hunt_v3.teams(
      id,hunt_id,canonical_code,name_status,pin_hash,registration_source,approval_status,status)
      values($1,$2,'T-401','code_only',$3,'organizer_assigned','approved','active')`,
    [teamId, huntId, 'p'.repeat(32)],
  );
  const state = {
    schemaVersion: 1,
    definitionId: huntId,
    definitionVersion: 1,
    teamId: runId,
    revision: 3,
    status: 'active',
    activeCheckpointId: null,
    checkpoints: {},
    hintUsage: {},
    ledger: [],
    events: [],
    score: 777,
    startedAt,
    timer: { durationSeconds: 60, deadlineAt, pauses: [], extensions: [] },
  };
  await getPool().query(
    `insert into hunt_v3.runs(
      id,team_id,hunt_id,hunt_version,run_number,private_seed,seed_commitment,
      route_plan,resolved_variables,engine_state,status,practice,eligible,score,progress,started_at)
      values($1,$2,$3,1,1,$4,$5,$6,'{}',$7,'active',false,true,777,0.5,$8)`,
    [runId, teamId, huntId, randomUUID().replaceAll('-', ''), 'f'.repeat(64),
      { routeCheckpointIds: ['start', 'finish'], checkpointIds: ['start', 'finish'] }, state, startedAt],
  );

  const board = await publicLeaderboard(boardSlug) as { main: Array<Record<string, unknown>> };
  assert.deepEqual(
    board.main.find(row => row.teamCode === 'T-401'),
    { rank: 1, teamCode: 'T-401', points: 0, status: 'registered' },
    'the expired provisional score is removed before the live projection is returned',
  );
  const run = (await getPool().query(
    'select status,eligible,elapsed_ms from hunt_v3.runs where id=$1',
    [runId],
  )).rows[0];
  assert.equal(run.status, 'abandoned');
  assert.equal(run.eligible, false);
  assert.ok(Number(run.elapsed_ms) >= 120_000);
  assert.equal(Number((await getPool().query(
    `select count(*)::int as count from hunt_v3.run_events
      where run_id=$1 and event_type='run_timed_out'`,
    [runId],
  )).rows[0].count), 1, 'the timeout has one immutable audit event');
  assert.equal((await getPool().query(
    'select run_status,active_run_id from hunt_v3.live_team_rollups where team_id=$1',
    [teamId],
  )).rows[0].active_run_id, null, 'the live rollup no longer points at an expired active run');

  await publicLeaderboard(boardSlug);
  assert.equal(Number((await getPool().query(
    `select count(*)::int as count from hunt_v3.run_events
      where run_id=$1 and event_type='run_timed_out'`,
    [runId],
  )).rows[0].count), 1, 'repeated live reads are idempotent');
});
