import '../isolated-database';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getPool, transaction } from '../../lib/server/db';
import { eventAnalytics, liveOperations, setHuntLifecycle, updatePublicBoard } from '../../lib/server/v3/operations';
import { updateLiveRollup } from '../../lib/server/v3/runs';

const enabled = Boolean(process.env.DATABASE_URL);

before(async () => {
  if (!enabled) return;
  const schema = await readFile(new URL('../../database/v3.sql', import.meta.url), 'utf8');
  await getPool().query(schema);
});

after(async () => {
  if (enabled) await getPool().end();
});

test('PostgreSQL V3 operations: lifecycle revisions and public-board settings round-trip', { skip: !enabled }, async () => {
  const suffix = randomUUID().slice(0, 8);
  const huntId = `v3-operations-${suffix}`;
  const boardSlug = `v3-operations-${suffix}-board`;
  await getPool().query(
    `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,settings)
      values($1,'Operations test',$1,'ready','self_serve','{}')`,
    [huntId],
  );
  await getPool().query(
    `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,1,$2,$3,'{}',$4)`,
    [huntId, {
      schemaVersion: 3,
      id: huntId,
      version: 1,
      title: 'Operations test',
      settings: {
        leaderboardPolicy: {
          bestRunRule: 'score_then_time_then_completion', mainBoardEnabled: true,
          replayBoardEnabled: true, replayBoardPublic: true,
          timeVisibility: 'after_second_eligible_run', showProgress: true,
        },
      },
      checkpoints: [],
    }, 'a'.repeat(64), { valid: true, issues: [], routes: [] }],
  );
  await getPool().query('update hunt_v3.hunts set latest_version=1 where id=$1', [huntId]);
  await getPool().query(
    `insert into hunt_v3.public_boards(
      hunt_id,slug,enabled,title,cover_ref,event_status,visible_columns,
      main_board_visible,replay_board_visible,team_name_mode)
      values($1,$2,true,'Live operations','/api/v3/media/cover','live',$3,false,true,'code_only')`,
    [huntId, boardSlug, ['rank', 'team_code', 'points', 'runs']],
  );
  // Frozen/final rows must reference a real snapshot under the V3 schema.
  const snapshot = (await getPool().query(
    `insert into hunt_v3.public_board_snapshots(hunt_id,board_kind,rows,source_cutoff,generated_by)
      values($1,'combined','[]',clock_timestamp(),'test') returning id`,
    [huntId],
  )).rows[0];
  await getPool().query(
    "update hunt_v3.public_boards set event_status='frozen',current_snapshot_id=$1,frozen_at=clock_timestamp() where hunt_id=$2",
    [snapshot.id, huntId],
  );

  const initial = await liveOperations(huntId);
  assert.deepEqual(initial.publicBoard, {
    enabled: true,
    slug: boardSlug,
    url: `/board/${boardSlug}`,
    title: 'Live operations',
    cover: '/api/v3/media/cover',
    status: 'frozen',
    columns: ['rank', 'team_code', 'points', 'runs'],
    mainBoardVisible: false,
    replayBoardVisible: true,
    showTeamNames: false,
  });
  assert.equal(initial.hunts.find(hunt => hunt.id === huntId)?.lifecycleRevision, 1);

  await setHuntLifecycle(huntId, 'live', 1, 'Integration organizer');
  await assert.rejects(
    setHuntLifecycle(huntId, 'paused', 1, 'Integration organizer'),
    /changed.*refresh/i,
  );
  await setHuntLifecycle(huntId, 'paused', 2, 'Integration organizer');
  await setHuntLifecycle(huntId, 'live', 3, 'Integration organizer');
  assert.deepEqual(
    (await getPool().query('select status,lifecycle_revision from hunt_v3.hunts where id=$1', [huntId])).rows[0],
    { status: 'live', lifecycle_revision: 4 },
  );

  await getPool().query('update hunt_v3.hunts set latest_version=99 where id=$1', [huntId]);
  await assert.rejects(
    transaction(client => updatePublicBoard(client, {
      huntId,
      enabled: true,
      title: 'Must roll back',
      cover: '/api/v3/media/must-not-stick',
      status: 'frozen',
      columns: ['rank', 'team_code', 'points'],
      mainVisible: true,
      replayVisible: false,
      teamNameMode: 'code_only',
      actor: 'Integration organizer',
    })),
    /not found/i,
  );
  assert.deepEqual(
    (await getPool().query('select title,event_status,current_snapshot_id,cover_ref from hunt_v3.public_boards where hunt_id=$1', [huntId])).rows[0],
    { title: 'Live operations', event_status: 'frozen', current_snapshot_id: snapshot.id, cover_ref: '/api/v3/media/cover' },
    'a failed snapshot rebuild leaves the previous frozen board intact',
  );
  await getPool().query('update hunt_v3.hunts set latest_version=1 where id=$1', [huntId]);

  await transaction(client => updatePublicBoard(client, {
    huntId,
    enabled: true,
    title: 'Updated board',
    cover: '/api/v3/media/new-cover',
    status: 'frozen',
    columns: ['rank', 'team_code', 'points', 'time'],
    mainVisible: true,
    replayVisible: false,
    teamNameMode: 'code_only',
    actor: 'Integration organizer',
  }));
  const updated = await liveOperations(huntId);
  assert.equal(updated.publicBoard?.cover, '/api/v3/media/new-cover');
  assert.equal(updated.publicBoard?.status, 'frozen');
  assert.equal(updated.publicBoard?.showTeamNames, false);
  assert.deepEqual(updated.publicBoard?.columns, ['rank', 'team_code', 'points', 'time']);
  assert.notEqual(
    (await getPool().query('select current_snapshot_id from hunt_v3.public_boards where hunt_id=$1', [huntId])).rows[0].current_snapshot_id,
    snapshot.id,
    'saving a frozen board atomically replaces the prior snapshot',
  );

  await transaction(client => updatePublicBoard(client, {
    huntId,
    enabled: false,
    title: 'Private board',
    status: 'live',
    columns: ['rank', 'team_code', 'points'],
    mainVisible: true,
    replayVisible: false,
    teamNameMode: 'code_only',
    actor: 'Integration organizer',
  }));
  assert.equal((await liveOperations(huntId)).publicBoard?.cover, '/api/v3/media/new-cover', 'omitting cover preserves the existing asset');

  const teamId = randomUUID();
  const memberId = randomUUID();
  const runId = randomUUID();
  const startedAt = new Date(Date.now() - 20 * 60_000).toISOString();
  const pauseStartedAt = new Date(Date.now() - 15 * 60_000).toISOString();
  const pauseEndedAt = new Date(Date.now() - 10 * 60_000).toISOString();
  await getPool().query(
    `insert into hunt_v3.teams(id,hunt_id,canonical_code,name_status,pin_hash,registration_source)
      values($1,$2,'T-001','code_only',$3,'self_serve')`,
    [teamId, huntId, 'p'.repeat(32)],
  );
  await getPool().query(
    `insert into hunt_v3.team_members(id,team_id,name,name_key,claim_pin_hash,claimed_at,checked_in_at)
      values($1,$2,'Runner','runner',$3,clock_timestamp(),clock_timestamp())`,
    [memberId, teamId, 'm'.repeat(32)],
  );
  const state = {
    schemaVersion: 1,
    definitionId: huntId,
    definitionVersion: 1,
    teamId,
    revision: 0,
    status: 'active',
    activeCheckpointId: null,
    checkpoints: {},
    hintUsage: {},
    ledger: [],
    events: [],
    score: 0,
    startedAt,
    clockPauses: [{ startedAt: pauseStartedAt, endedAt: pauseEndedAt, reason: 'organizer' }],
  };
  await getPool().query(
    `insert into hunt_v3.runs(
      id,team_id,hunt_id,hunt_version,run_number,private_seed,seed_commitment,route_plan,
      engine_state,status,started_at,updated_at)
      values($1,$2,$3,1,1,$4,$5,$6,$7,'active',$8,clock_timestamp()-interval '20 minutes')`,
    [runId, teamId, huntId, 's'.repeat(32), 'b'.repeat(64), { routeCheckpointIds: [], challenges: [] }, state, startedAt],
  );
  await getPool().query(
    `insert into hunt_v3.run_members(run_id,team_id,member_id,member_name_snapshot)
      values($1,$2,$3,'Runner')`,
    [runId, teamId, memberId],
  );
  await getPool().query(
    `insert into hunt_v3.run_events(
      run_id,team_id,revision,ordinal,actor_kind,actor_member_id,event_type,details,occurred_at)
      values($1,$2,0,1,'member',$3,'parallel_lane_completed','{}',clock_timestamp()-interval '1 minute')`,
    [runId, teamId, memberId],
  );
  await getPool().query(
    `insert into hunt_v3.help_requests(id,hunt_id,team_id,run_id,member_id,kind,message)
      values($1,$2,$3,$4,$5,'help','Need a clue')`,
    [randomUUID(), huntId, teamId, runId, memberId],
  );
  await transaction(client => updateLiveRollup(client, runId));
  await setHuntLifecycle(huntId, 'paused', 4, 'Integration organizer');
  assert.equal(
    ((await getPool().query('select engine_state from hunt_v3.runs where id=$1', [runId])).rows[0].engine_state.clockPauses as Array<{ endedAt?: string }>).some(pause => !pause.endedAt),
    true,
    'pausing a live event pauses active run clocks',
  );
  await assert.rejects(
    setHuntLifecycle(huntId, 'archived', 5, 'Integration organizer'),
    /cannot move directly from paused to archived/i,
    'a paused hunt with an open run cannot be irreversibly archived',
  );
  assert.deepEqual(
    (await getPool().query(
      `select hunt.status,hunt.lifecycle_revision,run.status as run_status,run.eligible
        from hunt_v3.hunts hunt join hunt_v3.runs run on run.hunt_id=hunt.id
        where hunt.id=$1 and run.id=$2`,
      [huntId, runId],
    )).rows[0],
    { status: 'paused', lifecycle_revision: 5, run_status: 'active', eligible: true },
    'a rejected archive leaves both lifecycle and active-run eligibility unchanged',
  );
  await setHuntLifecycle(huntId, 'live', 5, 'Integration organizer');
  assert.equal(
    ((await getPool().query('select engine_state from hunt_v3.runs where id=$1', [runId])).rows[0].engine_state.clockPauses as Array<{ endedAt?: string }>).some(pause => !pause.endedAt),
    false,
    'resuming a paused event resumes its active run clocks',
  );

  const live = await liveOperations(huntId);
  const liveTeam = live.teams.find(team => team.id === teamId);
  assert.ok(liveTeam);
  assert.ok(Number(liveTeam.elapsedMilliseconds) >= 14.9 * 60_000 && Number(liveTeam.elapsedMilliseconds) <= 15.1 * 60_000);
  assert.equal(liveTeam.alerts.some(alert => alert.type === 'stalled'), false, 'parallel events count as recent activity');
  const filtered = await liveOperations(huntId, 'not-a-real-team');
  assert.equal(filtered.teams.length, 0);
  assert.deepEqual(filtered.alerts, { help: 1, photos: 0, stalled: 0, fairness: 0 }, 'global alerts are independent of search and row limits');

  await setHuntLifecycle(huntId, 'ended', 6, 'Integration organizer');
  assert.deepEqual(
    (await getPool().query('select status,eligible,ineligibility_reason from hunt_v3.runs where id=$1', [runId])).rows[0],
    { status: 'abandoned', eligible: false, ineligibility_reason: 'Hunt ended by organizer' },
    'ending is irreversible and terminalizes every open attempt',
  );
  await assert.rejects(
    setHuntLifecycle(huntId, 'live', 7, 'Integration organizer'),
    /cannot move directly from ended to live/i,
    'an ended hunt cannot be reopened; paused is the reversible operator state',
  );
  await assert.rejects(
    setHuntLifecycle(huntId, 'archived', 7, 'Integration organizer'),
    /cannot move directly from ended to archived/i,
    'ending cannot be used as the first step of an archive-reset-reopen chain',
  );
  await getPool().query("update hunt_v3.hunts set status='archived' where id=$1", [huntId]);
  await assert.rejects(
    setHuntLifecycle(huntId, 'ready', 7, 'Integration organizer'),
    /cannot move directly from archived to ready/i,
    'an archived hunt identity is terminal; a reset requires a new hunt identity',
  );

  const unusedHuntId = `v3-unused-archive-${suffix}`;
  await getPool().query(
    `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,settings)
      values($1,'Unused archive',$1,'ready','self_serve','{}')`,
    [unusedHuntId],
  );
  await setHuntLifecycle(unusedHuntId, 'archived', 1, 'Integration organizer');
  assert.deepEqual(
    (await getPool().query('select status,lifecycle_revision from hunt_v3.hunts where id=$1', [unusedHuntId])).rows[0],
    { status: 'archived', lifecycle_revision: 2 },
    'an unused ready hunt can be archived without creating ghost runs',
  );
  await assert.rejects(
    setHuntLifecycle(unusedHuntId, 'ready', 2, 'Integration organizer'),
    /cannot move directly from archived to ready/i,
  );
});

test('PostgreSQL V3 analytics: only the exact score/time/completion key is an exact tie', { skip: !enabled }, async () => {
  const suffix = randomUUID().slice(0, 8);
  const huntId = `v3-ties-${suffix}`;
  await getPool().query(
    `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,settings)
      values($1,'Tie analysis',$1,'live','organizer_assigned','{}')`,
    [huntId],
  );
  await getPool().query(
    `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,1,$2,$3,'{}',$4)`,
    [huntId, { schemaVersion: 3 }, 'c'.repeat(64), { valid: true, issues: [], routes: [] }],
  );
  await getPool().query('update hunt_v3.hunts set latest_version=1 where id=$1', [huntId]);

  const completions = [
    '2026-10-05T12:00:00.000001Z',
    '2026-10-05T12:00:00.000002Z',
    '2026-10-05T12:00:00.000003Z',
    '2026-10-05T12:00:00.000003Z',
  ];
  for (const [index, completedAt] of completions.entries()) {
    const teamId = randomUUID(), runId = randomUUID();
    const code = `T-${String(index + 1).padStart(3, '0')}`;
    await getPool().query(
      `insert into hunt_v3.teams(id,hunt_id,canonical_code,name_status,pin_hash,registration_source)
        values($1,$2,$3,'code_only',$4,'organizer_assigned')`,
      [teamId, huntId, code, 'p'.repeat(32)],
    );
    await getPool().query(
      `insert into hunt_v3.runs(
        id,team_id,hunt_id,hunt_version,run_number,private_seed,seed_commitment,route_plan,
        engine_state,status,score,started_at,completed_at,elapsed_ms)
        values($1,$2,$3,1,1,$4,$5,$6,$7,'completed',100,$8::timestamptz-interval '10 minutes',$8,600000)`,
      [runId, teamId, huntId, `${index}`.repeat(32).slice(0, 32), `${index}`.repeat(64).slice(0, 64),
        { routeCheckpointIds: ['start', 'finish'], challenges: [] }, { status: 'completed' }, completedAt],
    );
  }

  const assigned = await eventAnalytics(huntId);
  assert.equal(assigned.peopleLabel, 'declared members');
  assert.deepEqual(assigned.registration, {
    teams: 4,
    'teams with declared members': 0,
    'checked-in teams': 0,
  });
  assert.deepEqual(assigned.ties, [{
    score: 100,
    elapsedMilliseconds: 600000,
    completedAt: '2026-10-05T12:00:00.000003Z',
    teams: 2,
  }]);

  await getPool().query("update hunt_v3.hunts set registration_mode='rostered' where id=$1", [huntId]);
  const rostered = await eventAnalytics(huntId);
  assert.equal(rostered.peopleLabel, 'rostered/check-in members');
  assert.deepEqual(rostered.registration, {
    teams: 4,
    'rostered teams': 0,
    'checked-in teams': 0,
  });
});

test('PostgreSQL V3 live operations: sampled route and challenge outliers create cautious fairness alerts', { skip: !enabled }, async () => {
  const suffix = randomUUID().slice(0, 8);
  const huntId = `v3-fairness-live-${suffix}`;
  await getPool().query(
    `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,settings)
      values($1,'Observed fairness',$1,'live','self_serve','{}')`,
    [huntId],
  );
  await getPool().query(
    `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,1,$2,$3,'{}',$4)`,
    [huntId, { schemaVersion: 3 }, 'd'.repeat(64), { valid: true, issues: [], routes: [] }],
  );
  await getPool().query('update hunt_v3.hunts set latest_version=1 where id=$1', [huntId]);

  const teamIds: Array<{ id: string; slower: boolean }> = [];
  for (let index = 0; index < 8; index++) {
    const slower = index >= 4;
    const teamId = randomUUID(), runId = randomUUID();
    teamIds.push({ id: teamId, slower });
    const code = `T-${String(index + 1).padStart(3, '0')}`;
    const completedAt = `2026-10-05T13:${String(index).padStart(2, '0')}:00.000000Z`;
    const route = slower ? ['start', 'south', 'finish'] : ['start', 'north', 'finish'];
    const variant = slower ? 'riddle' : 'observation';
    const elapsed = slower ? 1_200_000 : 600_000;
    const score = slower ? 80 : 100;
    await getPool().query(
      `insert into hunt_v3.teams(id,hunt_id,canonical_code,name_status,pin_hash,registration_source)
        values($1,$2,$3,'code_only',$4,'self_serve')`,
      [teamId, huntId, code, 'p'.repeat(32)],
    );
    await getPool().query(
      `insert into hunt_v3.runs(
        id,team_id,hunt_id,hunt_version,run_number,private_seed,seed_commitment,route_plan,
        engine_state,status,score,started_at,completed_at,elapsed_ms)
        values($1,$2,$3,1,1,$4,$5,$6,$7,'completed',$8,$9::timestamptz-$10::bigint*interval '1 millisecond',$9,$10)`,
      [runId, teamId, huntId, `${index}`.repeat(32).slice(0, 32), `${index}`.repeat(64).slice(0, 64), {
        routeCheckpointIds: route,
        challenges: [{ routeCheckpointId: route[1], poolId: 'middle-stop', variantId: variant, checkpointId: `${route[1]}-${variant}` }],
      }, { status: 'completed' }, score, completedAt, elapsed],
    );
    await transaction(client => updateLiveRollup(client, runId));
  }

  const live = await liveOperations(huntId);
  assert.equal(live.alerts.fairness, 2, 'the global total counts route/variant signals independently of team filters');
  for (const team of teamIds) {
    const alerts = live.teams.find(row => row.id === team.id)?.alerts.filter(alert => alert.type === 'fairness') ?? [];
    assert.equal(alerts.length, team.slower ? 2 : 0);
    if (team.slower) {
      assert.ok(alerts.every(alert => alert.severity === 'warning'));
      assert.ok(alerts.every(alert => /operational signal.*not proof/i.test(alert.detail)));
    }
  }
  const filtered = await liveOperations(huntId, 'no-matching-team');
  assert.equal(filtered.teams.length, 0);
  assert.equal(filtered.alerts.fairness, 2, 'fairness totals do not disappear when the team list is searched');
});
