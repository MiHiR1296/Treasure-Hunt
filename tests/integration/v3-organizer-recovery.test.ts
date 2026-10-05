import '../isolated-database';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createInitialState, executeControl } from '../../lib/engine';
import type { GameState, InteractiveNode } from '../../lib/engine/types';
import { getPool, transaction } from '../../lib/server/db';
import { controlRunGameplay, liveOperations } from '../../lib/server/v3/operations';
import { uploadV3Photo } from '../../lib/server/v3/media';
import { submitParallelLane } from '../../lib/server/v3/parallel';
import { materializeRunDefinition } from '../../lib/server/v3/runtime';
import { applyRunCommand, updateLiveRollup } from '../../lib/server/v3/runs';
import type { ParallelMechanic, ResolvedRunPlan, V3Definition } from '../../lib/v3/types';

const enabled = Boolean(process.env.DATABASE_URL);

before(async () => {
  if (!enabled) return;
  const schema = await readFile(new URL('../../database/v3.sql', import.meta.url), 'utf8');
  await getPool().query(schema);
});

after(async () => {
  if (enabled) await getPool().end();
});

function definition(id: string, node: InteractiveNode, parallelMechanics: ParallelMechanic[] = []): V3Definition {
  return {
    schemaVersion: 3,
    id,
    version: 1,
    title: 'Organizer recovery integration',
    settings: {
      mode: 'sequential',
      map: 'none',
      minTeamSize: 1,
      maxTeamSize: 6,
      sessionDurationSeconds: 3600,
      registrationOpen: true,
      photoRetention: 'after_verification',
      registrationMode: 'organizer-assigned',
      runPolicy: { mode: 'capped', maxOfficialRuns: 1 },
      leaderboardPolicy: {
        bestRunRule: 'score_then_time_then_completion',
        mainBoardEnabled: true,
        replayBoardEnabled: false,
        replayBoardPublic: false,
        timeVisibility: 'never',
        showProgress: true,
      },
      publicBoard: { enabled: false, status: 'live', teamIdentity: 'code_only', columns: ['rank', 'team_code', 'points'] },
      socialShare: { enabled: false, allowPersonalTitle: false },
      recognition: { enabled: false, peerVotingEnabled: false, votingWindowMinutes: 30, dataWeight: 0.7, peerWeight: 0.3 },
      routePlan: {
        startCheckpointId: 'start',
        finaleCheckpointId: 'start',
        requiredCheckpointIds: [],
        choose: { count: 0, fromCheckpointIds: [] },
        checkpointEstimates: { start: { durationMinutes: 1 } },
        travelEstimates: [],
      },
      challengePools: {},
      variableGenerators: {},
      fairnessPolicy: {
        minimumDistinctPlans: 1,
        durationToleranceMinutes: 0,
        maxResolvedRoutes: 10,
        requireTravelEstimates: true,
        walkingSpeedMetersPerMinute: 72,
        minutesPerDifficultyPoint: 1.5,
      },
      parallelMechanics,
    },
    checkpoints: [{
      id: 'start',
      title: 'Recovery gate',
      basePoints: 10,
      required: true,
      flow: { startNodeId: node.id, nodes: [node, { id: 'done', type: 'complete' }] },
      hints: [],
    }],
  };
}

type SeededRun = {
  huntId: string;
  teamId: string;
  runId: string;
  memberIds: string[];
  stateRevision: number;
};

async function seedRun(input: {
  node: InteractiveNode;
  parallelMechanics?: ParallelMechanic[];
  memberNames?: string[];
}): Promise<SeededRun> {
  const suffix = randomUUID().slice(0, 8);
  const huntId = `recovery-${suffix}`;
  const teamId = randomUUID();
  const runId = randomUUID();
  const value = definition(huntId, input.node, input.parallelMechanics);
  const plan: ResolvedRunPlan = {
    routeCheckpointIds: ['start'],
    checkpointIds: ['start'],
    challenges: [{ routeCheckpointId: 'start', checkpointId: 'start' }],
    variables: {},
  };
  const startedAt = new Date(Date.now() - 30_000).toISOString();
  const state = createInitialState(materializeRunDefinition(value, plan), runId, startedAt);
  const names = input.memberNames ?? ['Runner'];
  const memberIds = names.map(() => randomUUID());
  state.startingRoster = names.map((name, index) => ({ id: memberIds[index], name }));
  await getPool().query(
    `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,registration_open,latest_version,settings)
      values($1,$2,$1,'live','organizer_assigned',false,1,$3)`,
    [huntId, value.title, value.settings],
  );
  await getPool().query(
    `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,1,$2,$3,'{}',$4)`,
    [huntId, value, randomUUID().replaceAll('-', '').repeat(2), { valid: true, issues: [], routes: [] }],
  );
  await getPool().query(
    `insert into hunt_v3.teams(id,hunt_id,canonical_code,name_status,pin_hash,registration_source)
      values($1,$2,'T-001','code_only',$3,'organizer_assigned')`,
    [teamId, huntId, 'p'.repeat(32)],
  );
  for (const [index, name] of names.entries()) await getPool().query(
    `insert into hunt_v3.team_members(id,team_id,name,name_key,status,checked_in_at)
      values($1,$2,$3,$4,'active',clock_timestamp())`,
    [memberIds[index], teamId, name, name.normalize('NFKC').trim().toLocaleLowerCase('en')],
  );
  await getPool().query(
    `insert into hunt_v3.runs(
      id,team_id,hunt_id,hunt_version,run_number,private_seed,seed_commitment,route_plan,resolved_variables,
      engine_state,status,score,progress,current_checkpoint_id,started_at)
      values($1,$2,$3,1,1,$4,$5,$6,'{}',$7,'active',0,0,$8,$9)`,
    [runId, teamId, huntId, 's'.repeat(32), 'a'.repeat(64), plan, state, state.activeCheckpointId, state.startedAt],
  );
  for (const [index, memberId] of memberIds.entries()) await getPool().query(
    `insert into hunt_v3.run_members(run_id,team_id,member_id,member_name_snapshot)
      values($1,$2,$3,$4)`,
    [runId, teamId, memberId, names[index]],
  );
  await getPool().query(
    `insert into hunt_v3.run_events(
      run_id,team_id,revision,ordinal,request_id,actor_kind,actor_member_id,event_type,details,occurred_at)
      values($1,$2,0,1,$3,'member',$4,'run_started','{}',$5)`,
    [runId, teamId, randomUUID(), memberIds[0], startedAt],
  );
  await transaction(client => updateLiveRollup(client, runId));
  return { huntId, teamId, runId, memberIds, stateRevision: state.revision };
}

const controlInput = (run: SeededRun, control: 'approve_current' | 'reset_current' | 'extend_session', overrides: Partial<Parameters<typeof controlRunGameplay>[0]> = {}) => ({
  huntId: run.huntId,
  teamId: run.teamId,
  runId: run.runId,
  requestId: randomUUID(),
  expectedRevision: run.stateRevision,
  control,
  reason: 'Field issue verified by the integration organizer',
  ...(control === 'extend_session' ? { seconds: 300 } : {}),
  actor: 'Integration organizer',
  sessionHash: 'f'.repeat(64),
  ...overrides,
});

test('PostgreSQL V3 organizer recovery: standalone gate approval is atomic, scored, and exactly replayable', { skip: !enabled }, async () => {
  const run = await seedRun({ node: { id: 'gate', type: 'verify_organizer', prompt: 'Ask the organizer.', next: 'done' } });
  const input = controlInput(run, 'approve_current');
  const [first, retry] = await Promise.all([controlRunGameplay(input), controlRunGameplay(input)]);
  assert.deepEqual(retry, first, 'concurrent identical requests return the one durable result');
  assert.equal(first.status, 'completed');
  assert.equal(first.revision, 1);

  const persisted = (await getPool().query(
    `select run.status,run.score,run.elapsed_ms,run.engine_state,
      (select count(*)::int from hunt_v3.score_ledger ledger where ledger.run_id=run.id) as ledger_count,
      (select coalesce(sum(amount),0)::int from hunt_v3.score_ledger ledger where ledger.run_id=run.id and counts_for_ranking) as ledger_score,
      (select count(*)::int from hunt_v3.command_receipts receipt where receipt.run_id=run.id and receipt.operation='run_gameplay_control') as receipts,
      (select count(*)::int from hunt_v3.admin_events audit where audit.run_id=run.id and audit.action='run_gameplay_recovery') as audits
      from hunt_v3.runs run where run.id=$1`,
    [run.runId],
  )).rows[0];
  assert.equal(persisted.status, 'completed');
  assert.equal(persisted.score, 10);
  assert.equal(persisted.engine_state.score, 10);
  assert.equal(Number(persisted.ledger_count), 1);
  assert.equal(Number(persisted.ledger_score), 10);
  assert.equal(Number(persisted.receipts), 1);
  assert.equal(Number(persisted.audits), 1);
});

test('PostgreSQL V3 organizer recovery: ownership, stale revision, terminal, and disqualified guards fail closed', { skip: !enabled }, async () => {
  const stale = await seedRun({ node: { id: 'answer', type: 'verify_code', prompt: 'Code', code: 'K7-SECRET', next: 'done' } });
  await assert.rejects(controlRunGameplay(controlInput(stale, 'reset_current', { expectedRevision: 99 })), /changed.*refresh/i);
  await assert.rejects(controlRunGameplay(controlInput(stale, 'reset_current', { huntId: 'wrong-hunt' })), /not found/i);
  await assert.rejects(controlRunGameplay(controlInput(stale, 'reset_current', { teamId: randomUUID() })), /not found/i);
  assert.equal(Number((await getPool().query('select count(*)::int as count from hunt_v3.admin_events where run_id=$1', [stale.runId])).rows[0].count), 0);

  const terminal = await seedRun({ node: { id: 'answer', type: 'verify_code', prompt: 'Code', code: 'K7-SECRET', next: 'done' } });
  await getPool().query("update hunt_v3.runs set status='abandoned' where id=$1", [terminal.runId]);
  await assert.rejects(controlRunGameplay(controlInput(terminal, 'reset_current')), /only an active run/i);
  assert.equal((await getPool().query('select status from hunt_v3.runs where id=$1', [terminal.runId])).rows[0].status, 'abandoned');

  const disqualified = await seedRun({ node: { id: 'answer', type: 'verify_code', prompt: 'Code', code: 'K7-SECRET', next: 'done' } });
  await getPool().query("update hunt_v3.teams set status='disqualified' where id=$1", [disqualified.teamId]);
  await getPool().query("update hunt_v3.runs set status='disqualified',eligible=false,ineligibility_reason='Test disqualification' where id=$1", [disqualified.runId]);
  await assert.rejects(controlRunGameplay(controlInput(disqualified, 'reset_current')), /not eligible|only an active run/i);
  assert.deepEqual(
    (await getPool().query('select status,eligible from hunt_v3.runs where id=$1', [disqualified.runId])).rows[0],
    { status: 'disqualified', eligible: false },
  );
});

test('PostgreSQL V3 organizer recovery: exhausted guesses gain an append-only audited allowance', { skip: !enabled }, async () => {
  const run = await seedRun({ node: { id: 'answer', type: 'verify_code', prompt: 'Code', code: 'K7-SECRET', next: 'done' } });
  for (let attempt = 0; attempt < 6; attempt++) await applyRunCommand(
    run.teamId,
    run.memberIds[0],
    run.runId,
    randomUUID(),
    { type: 'verify', checkpointId: 'start', nodeId: 'answer', value: `wrong-${attempt}` },
  );
  await assert.rejects(
    applyRunCommand(run.teamId, run.memberIds[0], run.runId, randomUUID(), { type: 'verify', checkpointId: 'start', nodeId: 'answer', value: 'one-more' }),
    /too many attempts/i,
  );
  assert.equal(Number((await getPool().query('select count(*)::int as count from hunt_v3.run_attempt_reservations where run_id=$1', [run.runId])).rows[0].count), 6);
  const currentRevision = Number((await getPool().query("select engine_state->>'revision' as revision from hunt_v3.runs where id=$1", [run.runId])).rows[0].revision);
  const reset = controlInput(run, 'reset_current', { expectedRevision: currentRevision });
  const [first, retry] = await Promise.all([controlRunGameplay(reset), controlRunGameplay(reset)]);
  assert.deepEqual(retry, first);
  assert.equal(first.additionalAttemptScopes, 1);
  assert.equal(Number((await getPool().query('select count(*)::int as count from hunt_v3.run_attempt_allowances where run_id=$1', [run.runId])).rows[0].count), 1);
  assert.equal(Number((await getPool().query('select count(*)::int as count from hunt_v3.run_attempt_reservations where run_id=$1', [run.runId])).rows[0].count), 6, 'reset never deletes rejected guesses');

  const completed = await applyRunCommand(
    run.teamId,
    run.memberIds[0],
    run.runId,
    randomUUID(),
    { type: 'verify', checkpointId: 'start', nodeId: 'answer', value: 'K7-SECRET' },
  );
  assert.equal(completed.view.status, 'completed');
  assert.equal(completed.view.score, 10);
  assert.equal(Number((await getPool().query('select count(*)::int as count from hunt_v3.run_attempt_reservations where run_id=$1', [run.runId])).rows[0].count), 7);
  await assert.rejects(getPool().query('delete from hunt_v3.run_attempt_allowances where run_id=$1', [run.runId]), /append-only/i);
});

test('PostgreSQL V3 organizer recovery: different concurrent resets cannot both apply and time extension is revisioned', { skip: !enabled }, async () => {
  const run = await seedRun({ node: { id: 'answer', type: 'verify_code', prompt: 'Code', code: 'K7-SECRET', next: 'done' } });
  const resets = await Promise.allSettled([
    controlRunGameplay(controlInput(run, 'reset_current')),
    controlRunGameplay(controlInput(run, 'reset_current')),
  ]);
  assert.equal(resets.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(resets.filter(result => result.status === 'rejected').length, 1);
  assert.match(String((resets.find(result => result.status === 'rejected') as PromiseRejectedResult).reason), /changed.*refresh/i);
  assert.equal(Number((await getPool().query('select count(*)::int as count from hunt_v3.run_attempt_allowances where run_id=$1', [run.runId])).rows[0].count), 1);

  const state = (await getPool().query('select engine_state from hunt_v3.runs where id=$1', [run.runId])).rows[0].engine_state;
  const previousDeadline = Date.parse(state.timer.deadlineAt);
  const extended = await controlRunGameplay(controlInput(run, 'extend_session', { expectedRevision: state.revision }));
  assert.equal(extended.revision, state.revision + 1);
  const nextDeadline = Date.parse((await getPool().query('select engine_state from hunt_v3.runs where id=$1', [run.runId])).rows[0].engine_state.timer.deadlineAt);
  assert.equal(nextDeadline - previousDeadline, 300_000);
});

test('PostgreSQL V3 organizer recovery: a parallel reset retires old lanes without deleting history', { skip: !enabled }, async () => {
  const mechanic: ParallelMechanic = {
    id: 'split',
    checkpointId: 'start',
    nodeId: 'gate',
    timeWindowSeconds: 120,
    lanes: [
      { id: 'north', label: 'North', type: 'code', code: 'NORTH-7' },
      { id: 'south', label: 'South', type: 'code', code: 'SOUTH-9' },
    ],
  };
  const run = await seedRun({
    node: { id: 'gate', type: 'verify_organizer', prompt: 'Split up.', next: 'done' },
    parallelMechanics: [mechanic],
    memberNames: ['North Runner', 'South Runner'],
  });
  await assert.rejects(controlRunGameplay(controlInput(run, 'approve_current')), /linked teammate lanes.*cannot be bypassed/i);
  const first = await submitParallelLane({
    teamId: run.teamId,
    memberId: run.memberIds[0],
    runId: run.runId,
    requestId: randomUUID(),
    mechanicId: 'split',
    laneId: 'north',
    evidence: { value: 'NORTH-7' },
  });
  assert.equal(first.remaining, 1);
  await controlRunGameplay(controlInput(run, 'reset_current'));

  const afterReset = await submitParallelLane({
    teamId: run.teamId,
    memberId: run.memberIds[1],
    runId: run.runId,
    requestId: randomUUID(),
    mechanicId: 'split',
    laneId: 'south',
    evidence: { value: 'SOUTH-9' },
  });
  assert.equal(afterReset.mechanicCompleted, false);
  assert.equal(afterReset.remaining, 1, 'the north lane from before reset cannot satisfy the new window');
  const finished = await submitParallelLane({
    teamId: run.teamId,
    memberId: run.memberIds[0],
    runId: run.runId,
    requestId: randomUUID(),
    mechanicId: 'split',
    laneId: 'north',
    evidence: { value: 'NORTH-7' },
  });
  assert.equal(finished.mechanicCompleted, true);
  assert.equal(finished.runCompleted, true);
  assert.equal(Number((await getPool().query("select count(*)::int as count from hunt_v3.run_events where run_id=$1 and event_type='parallel_lane_completed'", [run.runId])).rows[0].count), 3, 'old accepted evidence remains immutable history');
  assert.equal(Number((await getPool().query("select count(*)::int as count from hunt_v3.run_events where run_id=$1 and event_type='attempt_budget_reset'", [run.runId])).rows[0].count), 1);
});

test('PostgreSQL V3 multipart upload: reset and final materialization share one task-epoch lock boundary', { skip: !enabled }, async t => {
  const previousStorage = process.env.MEDIA_STORAGE;
  const previousDirectory = process.env.MEDIA_DIRECTORY;
  const mediaDirectory = await mkdtemp(path.join(os.tmpdir(), 'hunt-v3-reset-race-'));
  process.env.MEDIA_STORAGE = 'filesystem';
  process.env.MEDIA_DIRECTORY = mediaDirectory;
  t.after(async () => {
    if (previousStorage === undefined) delete process.env.MEDIA_STORAGE;
    else process.env.MEDIA_STORAGE = previousStorage;
    if (previousDirectory === undefined) delete process.env.MEDIA_DIRECTORY;
    else process.env.MEDIA_DIRECTORY = previousDirectory;
    await rm(mediaDirectory, { recursive: true, force: true });
  });

  const mechanic: ParallelMechanic = {
    id: 'photo-split',
    checkpointId: 'start',
    nodeId: 'gate',
    timeWindowSeconds: 120,
    lanes: [
      { id: 'photo', label: 'Fresh photo', type: 'photo' },
      { id: 'code', label: 'Code', type: 'code', code: 'FRESH-9' },
    ],
  };
  const gate: InteractiveNode = { id: 'gate', type: 'verify_organizer', prompt: 'Split up.', next: 'done' };
  const run = await seedRun({ node: gate, parallelMechanics: [mechanic], memberNames: ['Photographer', 'Solver'] });
  const staleMediaId = randomUUID();
  const staleBytes = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 31, g: 97, b: 173 } },
  }).png().toBuffer();
  const staleFile = new File([new Uint8Array(staleBytes)], 'stale.png', { type: 'image/png' });

  const barrier = await getPool().connect();
  await barrier.query('begin');
  let committed = false;
  try {
    const locked = (await barrier.query(
      'select engine_state from hunt_v3.runs where id=$1 for update',
      [run.runId],
    )).rows[0] as { engine_state: GameState };
    const staleTaskStartedAt = locked.engine_state.checkpoints.start.nodes.gate.startedAt;
    assert.ok(staleTaskStartedAt);
    const pendingUpload = uploadV3Photo(run.teamId, run.memberIds[0], {
      id: staleMediaId,
      checkpointId: 'start',
      nodeId: 'gate',
      mechanicId: 'photo-split',
      laneId: 'photo',
      file: staleFile,
    }).then(value => ({ value, error: null }), error => ({ value: null, error }));

    let blockedAtFinalInsert = false;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !blockedAtFinalInsert) {
      blockedAtFinalInsert = Boolean((await getPool().query(
        `select 1 from pg_stat_activity
          where datname=current_database() and pid<>pg_backend_pid()
            and wait_event_type='Lock' and position('insert into hunt_v3.media' in query)>0
          limit 1`,
      )).rowCount);
      if (!blockedAtFinalInsert) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(blockedAtFinalInsert, true, 'the prepared multipart upload reaches the locked final insert before reset commits');

    const value = definition(run.huntId, gate, [mechanic]);
    const plan: ResolvedRunPlan = {
      routeCheckpointIds: ['start'],
      checkpointIds: ['start'],
      challenges: [{ routeCheckpointId: 'start', checkpointId: 'start' }],
      variables: {},
    };
    const resetAt = new Date(Date.parse(staleTaskStartedAt) + 1_000).toISOString();
    const reset = executeControl(materializeRunDefinition(value, plan), locked.engine_state, {
      type: 'reset_action',
      checkpointId: 'start',
      nodeId: 'gate',
      expectedRevision: locked.engine_state.revision,
      reason: 'Deterministic reset/upload barrier regression',
    }, resetAt);
    await barrier.query('update hunt_v3.runs set engine_state=$1,updated_at=$2 where id=$3', [reset.state, resetAt, run.runId]);
    await barrier.query('commit');
    committed = true;

    const staleOutcome = await pendingUpload;
    assert.equal(staleOutcome.value, null);
    assert.match(String(staleOutcome.error), /photo task changed/i);
    assert.equal((await getPool().query('select 1 from hunt_v3.media where id=$1', [staleMediaId])).rowCount, 0,
      'bytes prepared for the old epoch never materialize as media');

    const freshMediaId = randomUUID();
    const freshBytes = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 199, g: 73, b: 29 } },
    }).png().toBuffer();
    const fresh = await uploadV3Photo(run.teamId, run.memberIds[0], {
      id: freshMediaId,
      checkpointId: 'start',
      nodeId: 'gate',
      mechanicId: 'photo-split',
      laneId: 'photo',
      file: new File([new Uint8Array(freshBytes)], 'fresh.png', { type: 'image/png' }),
    });
    assert.equal(fresh.id, freshMediaId);
    const persisted = (await getPool().query(
      'select task_started_at from hunt_v3.media where id=$1',
      [freshMediaId],
    )).rows[0];
    assert.equal(new Date(persisted.task_started_at).toISOString(), resetAt);
    const submitted = await submitParallelLane({
      teamId: run.teamId,
      memberId: run.memberIds[0],
      runId: run.runId,
      requestId: randomUUID(),
      mechanicId: 'photo-split',
      laneId: 'photo',
      evidence: { mediaId: freshMediaId },
    });
    assert.equal(submitted.status, 'pending_review', 'fresh evidence from the replacement epoch remains usable');
  } finally {
    if (!committed) await barrier.query('rollback').catch(() => undefined);
    barrier.release();
  }
});

test('PostgreSQL V3 parallel photos are one-time evidence within an immutable task epoch', { skip: !enabled }, async () => {
  const mechanic: ParallelMechanic = {
    id: 'one-time-photo',
    checkpointId: 'start',
    nodeId: 'gate',
    timeWindowSeconds: 0.001,
    lanes: [
      { id: 'photo', label: 'Fresh photo', type: 'photo' },
      { id: 'code', label: 'Code', type: 'code', code: 'PAIR-4' },
    ],
  };
  const run = await seedRun({
    node: { id: 'gate', type: 'verify_organizer', prompt: 'Provide two fresh actions.', next: 'done' },
    parallelMechanics: [mechanic],
    memberNames: ['Photographer', 'Solver'],
  });
  const insertApprovedPhoto = async (id: string) => {
    const taskStartedAt = (await getPool().query(
      `select engine_state #>> array['checkpoints','start','nodes','gate','startedAt'] as started_at
        from hunt_v3.runs where id=$1`,
      [run.runId],
    )).rows[0].started_at;
    await getPool().query(
      `insert into hunt_v3.media(
        id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,parallel_mechanic_id,parallel_lane_id,
        kind,content_type,bytes,content_hash,storage_key,review_status,review_reason,reviewed_at,retention,task_started_at)
        values($1,$2,$3,$4,$5,'start','gate','one-time-photo','photo','photo','image/jpeg',1,$6,$7,
          'approved','Integration approval',clock_timestamp(),'keep',$8::timestamptz)`,
      [id, run.huntId, run.teamId, run.runId, run.memberIds[0], id.replaceAll('-', '').repeat(2),
        `${id}-${randomUUID()}`, taskStartedAt],
    );
    return taskStartedAt as string;
  };

  const firstMediaId = randomUUID();
  const firstEpoch = await insertApprovedPhoto(firstMediaId);
  const first = await submitParallelLane({
    teamId: run.teamId,
    memberId: run.memberIds[0],
    runId: run.runId,
    requestId: randomUUID(),
    mechanicId: mechanic.id,
    laneId: 'photo',
    evidence: { mediaId: firstMediaId },
  });
  assert.equal(first.accepted, true);
  assert.equal(first.remaining, 1);
  const recorded = (await getPool().query(
    `select details from hunt_v3.run_events
      where run_id=$1 and event_type='parallel_lane_completed' and details->>'mediaId'=$2`,
    [run.runId, firstMediaId],
  )).rows;
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].details.mediaId, firstMediaId, 'accepted photo completion records its consumed media identity');

  await new Promise(resolve => setTimeout(resolve, 25));
  await assert.rejects(
    submitParallelLane({
      teamId: run.teamId,
      memberId: run.memberIds[0],
      runId: run.runId,
      requestId: randomUUID(),
      mechanicId: mechanic.id,
      laneId: 'photo',
      evidence: { mediaId: firstMediaId },
    }),
    /already used.*fresh photo/i,
    'an approved image cannot restart the linked-task time window after its first completion ages out',
  );
  assert.equal(Number((await getPool().query(
    `select count(*)::int as count from hunt_v3.run_events
      where run_id=$1 and event_type='parallel_lane_completed' and details->>'mediaId'=$2`,
    [run.runId, firstMediaId],
  )).rows[0].count), 1);

  const revision = Number((await getPool().query(
    "select engine_state->>'revision' as revision from hunt_v3.runs where id=$1",
    [run.runId],
  )).rows[0].revision);
  await controlRunGameplay(controlInput(run, 'reset_current', { expectedRevision: revision }));
  const staleAfterReset = await submitParallelLane({
    teamId: run.teamId,
    memberId: run.memberIds[0],
    runId: run.runId,
    requestId: randomUUID(),
    mechanicId: mechanic.id,
    laneId: 'photo',
    evidence: { mediaId: firstMediaId },
  });
  assert.equal(staleAfterReset.accepted, false, 'a reset creates a new epoch that rejects previously approved evidence');
  assert.equal(staleAfterReset.status, 'rejected');

  const freshMediaId = randomUUID();
  const nextEpoch = await insertApprovedPhoto(freshMediaId);
  assert.notEqual(nextEpoch, firstEpoch);
  const fresh = await submitParallelLane({
    teamId: run.teamId,
    memberId: run.memberIds[0],
    runId: run.runId,
    requestId: randomUUID(),
    mechanicId: mechanic.id,
    laneId: 'photo',
    evidence: { mediaId: freshMediaId },
  });
  assert.equal(fresh.accepted, true, 'freshly reviewed evidence remains valid after the reset');
});

test('PostgreSQL V3 multipart upload follows hunt-to-team-to-run lock order during disqualification', { skip: !enabled }, async t => {
  const previousStorage = process.env.MEDIA_STORAGE;
  const previousDirectory = process.env.MEDIA_DIRECTORY;
  const mediaDirectory = await mkdtemp(path.join(os.tmpdir(), 'hunt-v3-disqualify-race-'));
  process.env.MEDIA_STORAGE = 'filesystem';
  process.env.MEDIA_DIRECTORY = mediaDirectory;
  t.after(async () => {
    if (previousStorage === undefined) delete process.env.MEDIA_STORAGE;
    else process.env.MEDIA_STORAGE = previousStorage;
    if (previousDirectory === undefined) delete process.env.MEDIA_DIRECTORY;
    else process.env.MEDIA_DIRECTORY = previousDirectory;
    await rm(mediaDirectory, { recursive: true, force: true });
  });

  const mechanic: ParallelMechanic = {
    id: 'disqualify-photo',
    checkpointId: 'start',
    nodeId: 'gate',
    timeWindowSeconds: 120,
    lanes: [
      { id: 'photo', label: 'Fresh photo', type: 'photo' },
      { id: 'code', label: 'Code', type: 'code', code: 'LOCK-4' },
    ],
  };
  const run = await seedRun({
    node: { id: 'gate', type: 'verify_organizer', prompt: 'Provide linked evidence.', next: 'done' },
    parallelMechanics: [mechanic],
    memberNames: ['Photographer', 'Solver'],
  });
  const mediaId = randomUUID();
  const bytes = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 73, g: 41, b: 181 } },
  }).png().toBuffer();

  const disqualify = await getPool().connect();
  await disqualify.query('begin');
  let committed = false;
  try {
    await disqualify.query('select id from hunt_v3.teams where id=$1 for update', [run.teamId]);
    const pendingUpload = uploadV3Photo(run.teamId, run.memberIds[0], {
      id: mediaId,
      checkpointId: 'start',
      nodeId: 'gate',
      mechanicId: mechanic.id,
      laneId: 'photo',
      file: new File([new Uint8Array(bytes)], 'disqualified.png', { type: 'image/png' }),
    }).then(value => ({ value, error: null }), error => ({ value: null, error }));

    let waitingOnTeam = false;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline && !waitingOnTeam) {
      waitingOnTeam = Boolean((await getPool().query(
        `select 1 from pg_stat_activity
          where datname=current_database() and pid<>pg_backend_pid()
            and wait_event_type='Lock' and position('insert into hunt_v3.media' in query)>0
          limit 1`,
      )).rowCount);
      if (!waitingOnTeam) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(waitingOnTeam, true, 'media materialization waits on the team lock before touching the run row');

    await disqualify.query("set local statement_timeout='1000ms'");
    await disqualify.query("update hunt_v3.teams set status='disqualified' where id=$1", [run.teamId]);
    await disqualify.query(
      "update hunt_v3.runs set status='disqualified',eligible=false,ineligibility_reason='Deterministic race test' where id=$1",
      [run.runId],
    );
    await disqualify.query('commit');
    committed = true;

    const outcome = await pendingUpload;
    assert.equal(outcome.value, null);
    assert.match(String(outcome.error), /photo task changed/i);
    assert.equal((await getPool().query('select 1 from hunt_v3.media where id=$1', [mediaId])).rowCount, 0);
    assert.deepEqual(
      (await getPool().query('select status,eligible from hunt_v3.runs where id=$1', [run.runId])).rows[0],
      { status: 'disqualified', eligible: false },
      'disqualification commits without a 40P01 deadlock and stale upload bytes fail closed',
    );
  } finally {
    if (!committed) await disqualify.query('rollback').catch(() => undefined);
    disqualify.release();
  }
});

test('PostgreSQL V3 multipart quota serializes concurrent different upload IDs per task epoch', { skip: !enabled }, async t => {
  const previousStorage = process.env.MEDIA_STORAGE;
  const previousDirectory = process.env.MEDIA_DIRECTORY;
  const mediaDirectory = await mkdtemp(path.join(os.tmpdir(), 'hunt-v3-photo-quota-'));
  process.env.MEDIA_STORAGE = 'filesystem';
  process.env.MEDIA_DIRECTORY = mediaDirectory;
  t.after(async () => {
    if (previousStorage === undefined) delete process.env.MEDIA_STORAGE;
    else process.env.MEDIA_STORAGE = previousStorage;
    if (previousDirectory === undefined) delete process.env.MEDIA_DIRECTORY;
    else process.env.MEDIA_DIRECTORY = previousDirectory;
    await rm(mediaDirectory, { recursive: true, force: true });
  });

  const mechanic: ParallelMechanic = {
    id: 'quota-photo',
    checkpointId: 'start',
    nodeId: 'gate',
    timeWindowSeconds: 120,
    lanes: [
      { id: 'photo', label: 'Fresh photo', type: 'photo' },
      { id: 'code', label: 'Code', type: 'code', code: 'QUOTA-2' },
    ],
  };
  const run = await seedRun({
    node: { id: 'gate', type: 'verify_organizer', prompt: 'Provide linked evidence.', next: 'done' },
    parallelMechanics: [mechanic],
    memberNames: ['Photographer', 'Solver'],
  });
  const inputs = await Promise.all([31, 97, 163].map(async red => ({
    id: randomUUID(),
    file: new File([new Uint8Array(await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: red, g: 83, b: 149 } },
    }).png().toBuffer())], `${red}.png`, { type: 'image/png' }),
  })));
  const outcomes = await Promise.allSettled(inputs.map(input => uploadV3Photo(run.teamId, run.memberIds[0], {
    ...input,
    checkpointId: 'start',
    nodeId: 'gate',
    mechanicId: mechanic.id,
    laneId: 'photo',
  })));
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 2);
  const rejected = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
  assert.match(String(rejected.reason), /two photos.*waiting for review/i);
  assert.equal(Number((await getPool().query(
    `select count(*)::int as count from hunt_v3.media
      where run_id=$1 and task_started_at=(
        select (engine_state #>> array['checkpoints','start','nodes','gate','startedAt'])::timestamptz
        from hunt_v3.runs where id=$1
      ) and review_status='pending'`,
    [run.runId],
  )).rows[0].count), 2, 'the final locked quota check cannot be oversubscribed by different media IDs');
});

test('PostgreSQL V3 live operations: duplicate normalized member names are an organizer-only review signal', { skip: !enabled }, async () => {
  const run = await seedRun({ node: { id: 'answer', type: 'verify_code', prompt: 'Code', code: 'K7-SECRET', next: 'done' } });
  const secondTeamId = randomUUID();
  await getPool().query(
    `insert into hunt_v3.teams(id,hunt_id,canonical_code,name_status,pin_hash,registration_source)
      values($1,$2,'T-002','code_only',$3,'organizer_assigned')`,
    [secondTeamId, run.huntId, 'q'.repeat(32)],
  );
  await getPool().query(
    `insert into hunt_v3.team_members(id,team_id,name,name_key,status,checked_in_at)
      values($1,$2,'  RUNNER  ','runner','active',clock_timestamp())`,
    [randomUUID(), secondTeamId],
  );
  const live = await liveOperations(run.huntId);
  const warnings = live.teams.flatMap(team => team.alerts.filter(alert => alert.type === 'warning' && /duplicate member name/i.test(alert.label)));
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every(alert => /review signal, not proof/i.test(alert.detail || '')));
});
