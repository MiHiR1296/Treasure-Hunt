import '../isolated-database';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { getPool } from '../../lib/server/db';
import { elapsedMilliseconds } from '../../lib/engine/session';
import { validateFairness } from '../../lib/v3/fairness';
import type { V3Definition } from '../../lib/v3/types';
import { publicLeaderboard, teamLeaderboards } from '../../lib/server/v3/leaderboards';
import { authorizeV3Media, uploadV3Photo } from '../../lib/server/v3/media';
import { createOrganizerTeam, liveOperations, pendingPhotoReviews, reviewPhoto } from '../../lib/server/v3/operations';
import { parallelPhotoReviewStatus, submitParallelLane } from '../../lib/server/v3/parallel';
import { privateRecognition, saveRecognitionVote } from '../../lib/server/v3/recognition';
import { registerV3Team, teamSessionSummary } from '../../lib/server/v3/registration';
import { applyRunCommand, createRun, currentRunView } from '../../lib/server/v3/runs';
import { authenticateV3, createV3AdminSession, digest, V3_TEAM_COOKIE, v3RequestSource } from '../../lib/server/v3/security';

const enabled = Boolean(process.env.DATABASE_URL);

function definition(id: string, registrationMode: V3Definition['settings']['registrationMode'] = 'self-serve'): V3Definition {
  return {
    schemaVersion: 3,
    id,
    version: 1,
    title: 'V3 runtime integration',
    settings: {
      mode: 'sequential',
      map: 'none',
      rules: 'Stay together.',
      minTeamSize: 2,
      maxTeamSize: 6,
      sessionDurationSeconds: 3600,
      registrationOpen: true,
      completionMessage: 'Great run.',
      photoRetention: 'after_verification',
      registrationMode,
      runPolicy: { mode: 'unlimited' },
      leaderboardPolicy: {
        bestRunRule: 'score_then_time_then_completion',
        mainBoardEnabled: true,
        replayBoardEnabled: true,
        replayBoardPublic: true,
        timeVisibility: 'after_second_eligible_run',
        showProgress: true,
      },
      publicBoard: {
        enabled: true,
        slug: `${id}-board`,
        title: 'Public V3 board',
        status: 'live',
        teamIdentity: 'code_and_name',
        columns: ['rank', 'team_code', 'team_name', 'points', 'runs', 'time'],
      },
      socialShare: { enabled: true, organizerHandle: '@organizer', campaignHashtag: '#V3Hunt', allowPersonalTitle: true },
      recognition: { enabled: true, peerVotingEnabled: true, votingWindowMinutes: 60, dataWeight: 0.7, peerWeight: 0.3 },
      routePlan: {
        startCheckpointId: 'start',
        finaleCheckpointId: 'finale',
        requiredCheckpointIds: [],
        choose: { count: 0, fromCheckpointIds: [] },
        shuffleSelectedCheckpoints: false,
        avoidTransitions: [],
        checkpointEstimates: { start: { durationMinutes: 1 }, finale: { durationMinutes: 1 } },
        travelEstimates: [{ from: 'start', to: 'finale', durationMinutes: 0 }],
      },
      challengePools: {},
      variableGenerators: {
        northLaneCode: { type: 'literal', value: 'NORTH-7' },
      },
      fairnessPolicy: {
        minimumDistinctPlans: 1,
        durationToleranceMinutes: 0,
        maxResolvedRoutes: 100,
        requireTravelEstimates: true,
        walkingSpeedMetersPerMinute: 72,
        minutesPerDifficultyPoint: 1.5,
      },
      parallelMechanics: [{
        id: 'split-gate',
        checkpointId: 'start',
        nodeId: 'parallel-gate',
        timeWindowSeconds: 120,
        lanes: [
          { id: 'north', label: 'North code', type: 'code', code: '{{northLaneCode}}' },
          { id: 'south', label: 'South code', type: 'code', code: 'SOUTH-9' },
        ],
      }],
    },
    checkpoints: [
      {
        id: 'start',
        title: 'Split start',
        basePoints: 10,
        required: true,
        flow: {
          startNodeId: 'seeded-opening',
          nodes: [
            {
              id: 'seeded-opening', type: 'branch',
              condition: { type: 'variable', key: 'northLaneCode', equals: 'NORTH-7' },
              ifTrue: 'remember-seed', ifFalse: 'parallel-gate',
            },
            { id: 'remember-seed', type: 'set_variable', key: 'automaticMarker', value: 'kept', next: 'delight-points' },
            { id: 'delight-points', type: 'add_points', amount: 3, label: 'Secret flourish', rankingImpact: 'excluded', next: 'parallel-gate' },
            { id: 'parallel-gate', type: 'verify_organizer', prompt: 'Two teammates complete separate lanes.', next: 'done' },
            { id: 'done', type: 'complete' },
          ],
        },
        hints: [],
      },
      {
        id: 'finale',
        title: 'Finale',
        basePoints: 10,
        required: true,
        flow: {
          startNodeId: 'finish',
          nodes: [
            { id: 'finish', type: 'show_text', text: 'Finish together.', next: 'done' },
            { id: 'done', type: 'complete' },
          ],
        },
        hints: [],
      },
    ],
  };
}

async function insertHunt(value: V3Definition, status = 'live') {
  const fairness = validateFairness(value);
  assert.equal(fairness.valid, true, JSON.stringify(fairness.issues));
  await getPool().query(
    `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,registration_open,latest_version,settings)
      values($1,$2,$3,$4,$5,true,1,$6)`,
    [value.id, value.title, value.id, status, value.settings.registrationMode.replaceAll('-', '_'), value.settings],
  );
  await getPool().query(
    `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,1,$2,$3,$4,$5)`,
    [value.id, value, 'a'.repeat(64), { valid: true, issues: [] }, fairness],
  );
  await getPool().query(
    `insert into hunt_v3.public_boards(
      hunt_id,slug,enabled,title,event_status,visible_columns,main_board_visible,replay_board_visible,team_name_mode)
      values($1,$2,true,'Public V3 board','live',$3,true,true,'display_name')`,
    [value.id, `${value.id}-board`, value.settings.publicBoard.columns],
  );
}

async function approveTestTeam(teamId: string) {
  await getPool().query("update hunt_v3.teams set approval_status='approved' where id=$1", [teamId]);
}

async function taskStartedAt(runId: string, checkpointId: string, nodeId: string) {
  const value = (await getPool().query(
    `select engine_state #>> array['checkpoints',$2,'nodes',$3,'startedAt'] as started_at
      from hunt_v3.runs where id=$1`,
    [runId, checkpointId, nodeId],
  )).rows[0]?.started_at as string | undefined;
  assert.ok(value, `expected active task epoch for ${checkpointId}/${nodeId}`);
  return value;
}

async function finishRun(
  teamId: string,
  firstMemberId: string,
  secondMemberId: string,
  runId: string,
) {
  const firstRequest = randomUUID();
  const first = await submitParallelLane({
    teamId,
    memberId: firstMemberId,
    runId,
    requestId: firstRequest,
    mechanicId: 'split-gate',
    laneId: 'north',
    evidence: { value: 'NORTH-7' },
  });
  assert.equal(first.accepted, true);
  assert.equal(first.remaining, 1);
  await assert.rejects(
    submitParallelLane({
      teamId,
      memberId: firstMemberId,
      runId,
      requestId: randomUUID(),
      mechanicId: 'split-gate',
      laneId: 'south',
      evidence: { value: 'SOUTH-9' },
    }),
    /different teammate/i,
  );
  const secondRequest = randomUUID();
  const secondInput = {
    teamId,
    memberId: secondMemberId,
    runId,
    requestId: secondRequest,
    mechanicId: 'split-gate',
    laneId: 'south',
    evidence: { value: 'SOUTH-9' },
  };
  const second = await submitParallelLane(secondInput);
  assert.equal(second.accepted, true);
  assert.equal(second.remaining, 0);
  assert.equal(second.view.checkpoint?.id, 'finale');
  assert.deepEqual(
    await submitParallelLane(secondInput).then(result => ({ accepted: result.accepted, remaining: result.remaining })),
    { accepted: true, remaining: 0 },
    'the same lane request replays after the mechanic has advanced',
  );

  const finishRequest = randomUUID();
  const command = { type: 'continue' as const, checkpointId: 'finale', nodeId: 'finish' };
  const completed = await applyRunCommand(teamId, firstMemberId, runId, finishRequest, command);
  assert.equal(completed.view.status, 'completed');
  assert.equal(completed.view.score, 20);
  assert.equal(completed.view.bonusScore, 3);
  assert.deepEqual(
    (await getPool().query('select score,bonus_score from hunt_v3.runs where id=$1', [runId])).rows[0],
    { score: 20, bonus_score: 3 },
    'source-bound excluded points stay visible but cannot affect official ranking score',
  );
  const replayed = await applyRunCommand(teamId, firstMemberId, runId, finishRequest, command);
  assert.equal(replayed.view.status, 'completed', 'the committed command can be recovered after completion');
  return completed.view;
}

before(async () => {
  if (!enabled) return;
  const schema = await readFile(new URL('../../database/v3.sql', import.meta.url), 'utf8');
  await getPool().query(schema);
});

after(async () => {
  if (enabled) await getPool().end();
});

test('PostgreSQL V3 runtime: self-serve registration, isolated replays, idempotency, recognition, parallel play and public privacy', { skip: !enabled }, async () => {
  const huntId = `v3-runtime-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(huntId));

  const registrationRequestId = randomUUID();
  const aliceInput = {
    requestId: registrationRequestId,
    huntId,
    intent: 'create' as const,
    playerName: 'Alice',
    teamName: 'Falcons',
    pin: '246824',
    memberPin: '111111',
    memberNames: ['Bob'],
    requestSource: `runtime-create-${huntId}`,
  };
  const [alice, duplicateRegistration] = await Promise.all([
    registerV3Team(aliceInput),
    registerV3Team(aliceInput),
  ]);
  assert.equal(duplicateRegistration.summary.team.id, alice.summary.team.id, 'registration request IDs prevent duplicate teams');
  assert.deepEqual(
    await Promise.all([alice.token, duplicateRegistration.token].map(token => authenticateV3(token, 'team').then(session => session.memberName))),
    ['Alice', 'Alice'],
    'every response from the same registration request remains usable regardless of response order',
  );
  assert.equal(Number((await getPool().query('select count(*)::int as count from hunt_v3.teams where hunt_id=$1', [huntId])).rows[0].count), 1);
  assert.match(alice.summary.team.code, /^T-\d{3,}$/);
  const bob = await registerV3Team({
    requestId: randomUUID(),
    huntId,
    intent: 'join',
    playerName: 'Bob',
    teamCode: alice.summary.team.code,
    pin: '246824',
    memberPin: '222222',
    requestSource: `runtime-bob-${huntId}`,
  });
  assert.equal(bob.summary.team.id, alice.summary.team.id);
  await approveTestTeam(alice.summary.team.id);
  await assert.rejects(
    registerV3Team({
      requestId: randomUUID(), huntId, intent: 'join', playerName: 'Bob', teamCode: alice.summary.team.code,
      pin: '246824', memberPin: '999999', requestSource: `runtime-hijack-${huntId}`,
    }),
    /personal member PIN is incorrect/i,
  );
  assert.equal((await authenticateV3(bob.token, 'team')).memberName, 'Bob', 'a failed reclaim does not revoke the real member session');

  await getPool().query("update hunt_v3.hunts set status='paused' where id=$1", [huntId]);
  const pausedBob = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Bob', teamCode: alice.summary.team.code,
    pin: '246824', memberPin: '222222', requestSource: `runtime-paused-rejoin-${huntId}`,
  });
  assert.equal((await authenticateV3(pausedBob.token, 'team')).memberName, 'Bob', 'an existing member can recover a session while the event is paused');
  assert.equal(Number((await getPool().query('select count(*)::int as count from hunt_v3.runs where hunt_id=$1', [huntId])).rows[0].count), 0,
    're-authentication during a pause does not start a run or gameplay action');
  await getPool().query("update hunt_v3.hunts set status='live' where id=$1", [huntId]);

  const createRequest = randomUUID();
  const [created, duplicate] = await Promise.all([
    createRun(alice.summary.team.id, alice.summary.member.id, createRequest),
    createRun(alice.summary.team.id, alice.summary.member.id, createRequest),
  ]);
  assert.equal(created.runId, duplicate.runId);
  const initialized = (await getPool().query('select engine_state,resolved_variables from hunt_v3.runs where id=$1', [created.runId])).rows[0];
  assert.deepEqual(initialized.resolved_variables, { northLaneCode: 'NORTH-7' });
  assert.deepEqual(initialized.engine_state.variables, { northLaneCode: 'NORTH-7', automaticMarker: 'kept' });
  assert.equal(initialized.engine_state.checkpoints.start.activeNodeId, 'parallel-gate');
  assert.equal(created.score, 0);
  assert.equal(created.bonusScore, 3);
  assert.equal(created.checkpoints?.[1]?.id, 'stage:2', 'a future authored checkpoint ID is replaced by an ordinal');
  assert.equal(created.summary?.checkpoints[1]?.id, 'stage:2', 'the summary uses the same redacted future ID');
  assert.equal(JSON.stringify(created).includes('finale'), false, 'the future route is absent from the player response');
  assert.equal(JSON.stringify(created).includes('NORTH-7'), false, 'parallel secrets stay out of the player view');
  assert.equal(JSON.stringify(created).includes('privateSeed'), false);
  await finishRun(alice.summary.team.id, alice.summary.member.id, bob.summary.member.id, created.runId);

  const voteRequest = randomUUID();
  const voteInput = {
    teamId: alice.summary.team.id,
    memberId: alice.summary.member.id,
    runId: created.runId,
    requestId: voteRequest,
    recipientMemberId: bob.summary.member.id,
    category: 'crew_energy' as const,
    subtype: 'helping_hand' as const,
  };
  const vote = await saveRecognitionVote(voteInput);
  assert.equal(vote.saved, true);
  await getPool().query(
    `insert into hunt_v3.rate_limits(key,attempts) values($1,10)
      on conflict(key) do update set attempts=10,window_start=now()`,
    [digest(`recognition-vote:member:${alice.summary.member.id}:run:${created.runId}`)],
  );
  assert.equal((await saveRecognitionVote(voteInput)).replayed, true, 'an exact receipt replay bypasses the novel-edit throttle');
  await assert.rejects(
    saveRecognitionVote({ ...voteInput, requestId: randomUUID(), subtype: 'momentum_maker' }),
    /too many attempts/i,
    'novel vote revisions are bounded before they can amplify immutable result rows',
  );
  await getPool().query(
    "update hunt_v3.runs set started_at=now()-interval '3 hours',completed_at=now()-interval '2 hours' where id=$1",
    [created.runId],
  );
  const voteReplay = await saveRecognitionVote(voteInput);
  assert.equal(voteReplay.replayed, true, 'a committed vote remains retryable after its window closes');

  await assert.rejects(
    createRun(alice.summary.team.id, alice.summary.member.id, randomUUID(), true),
    /practice is unavailable.*unlimited official attempts/i,
    'an unlimited competition cannot use practice mode to scout outside official allocator accounting',
  );
  const replay = await createRun(alice.summary.team.id, alice.summary.member.id, randomUUID());
  assert.notEqual(replay.runId, created.runId);
  assert.equal(replay.runNumber, 2);
  await finishRun(alice.summary.team.id, alice.summary.member.id, bob.summary.member.id, replay.runId);
  const persisted = await getPool().query(
    'select id,run_number,status,private_seed from hunt_v3.runs where team_id=$1 order by run_number',
    [alice.summary.team.id],
  );
  assert.equal(persisted.rowCount, 2);
  assert.deepEqual(persisted.rows.map(row => row.status), ['completed', 'completed']);
  assert.notEqual(persisted.rows[0].private_seed, persisted.rows[1].private_seed);

  const privateBoards = await teamLeaderboards(huntId, alice.summary.team.id);
  assert.equal(privateBoards.main.entries.length, 1, 'only the best run represents a team');
  assert.equal(privateBoards.replay.unlocked, true);
  assert.equal(privateBoards.replay.entries[0].runCount, 2);
  const publicBoard = await publicLeaderboard(`${huntId}-board`);
  const publicJson = JSON.stringify(publicBoard);
  assert.equal(publicJson.includes('Alice'), false);
  assert.equal(publicJson.includes('Bob'), false);
  assert.equal(publicJson.includes('helping_hand'), false);
  assert.equal(publicJson.includes('voterMemberId'), false);
});

test('PostgreSQL V3 runs freeze their starting roster and admit late check-ins only on the next run', { skip: !enabled }, async () => {
  const huntId = `v3-run-roster-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(huntId, 'rostered'));
  const assigned = await createOrganizerTeam({
    huntId,
    requestId: randomUUID(),
    displayName: 'Frozen Crew',
    memberNames: ['Captain', 'Scout', 'Late Joiner'],
    pin: '864201',
    credentialSecret: 'integration-run-roster-secret',
    actor: 'Test organizer',
    sessionHash: 'a'.repeat(64),
  });
  const captainCredential = assigned.memberCredentials.find(member => member.name === 'Captain');
  const scoutCredential = assigned.memberCredentials.find(member => member.name === 'Scout');
  const lateCredential = assigned.memberCredentials.find(member => member.name === 'Late Joiner');
  assert.ok(captainCredential && scoutCredential && lateCredential);
  const captain = await registerV3Team({
    requestId: randomUUID(),
    huntId,
    intent: 'claim',
    playerName: 'Captain',
    teamCode: assigned.code,
    pin: '864201',
    memberPin: captainCredential.claimPin,
    requestSource: `run-roster-create-${huntId}`,
  });
  const scout = await registerV3Team({
    requestId: randomUUID(),
    huntId,
    intent: 'claim',
    playerName: 'Scout',
    teamCode: captain.summary.team.code,
    pin: '864201',
    memberPin: scoutCredential.claimPin,
    requestSource: `run-roster-scout-${huntId}`,
  });
  const firstRun = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());

  const late = await registerV3Team({
    requestId: randomUUID(),
    huntId,
    intent: 'claim',
    playerName: 'Late Joiner',
    teamCode: captain.summary.team.code,
    pin: '864201',
    memberPin: lateCredential.claimPin,
    requestSource: `run-roster-late-${huntId}`,
  });
  assert.equal(late.summary.activeRun, null, 'a late check-in does not receive the active run ID');
  assert.equal(late.summary.latestRun, null, 'a late check-in does not receive a non-participating run summary');
  assert.equal(Number((await getPool().query(
    'select count(*)::int as count from hunt_v3.run_members where run_id=$1',
    [firstRun.runId],
  )).rows[0].count), 2);

  await assert.rejects(
    currentRunView(captain.summary.team.id, late.summary.member.id, firstRun.runId),
    /locked to its starting roster/i,
  );
  await assert.rejects(
    applyRunCommand(
      captain.summary.team.id,
      late.summary.member.id,
      firstRun.runId,
      randomUUID(),
      { type: 'continue', checkpointId: 'start', nodeId: 'parallel-gate' },
    ),
    /locked to its starting roster/i,
  );
  await assert.rejects(
    getPool().query(
      `insert into hunt_v3.run_members(run_id,team_id,member_id,member_name_snapshot)
        values($1,$2,$3,'Late Joiner')`,
      [firstRun.runId, captain.summary.team.id, late.summary.member.id],
    ),
    /membership is frozen/i,
    'the database rejects a service regression that tries to append a late member',
  );
  const photoId = randomUUID();
  const photoTaskStartedAt = await taskStartedAt(firstRun.runId, 'start', 'parallel-gate');
  await getPool().query(
    `insert into hunt_v3.media(
      id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,kind,content_type,bytes,content_hash,storage_key,retention,
      task_started_at)
      values($1,$2,$3,$4,$5,'start','parallel-gate','photo','image/jpeg',1,$6,$7,'keep',$8::timestamptz)`,
    [photoId, huntId, captain.summary.team.id, firstRun.runId, captain.summary.member.id,
      digest(photoId), `${photoId}-${randomUUID()}`, photoTaskStartedAt],
  );
  const mediaRequest = (token: string) => new NextRequest(`http://localhost/api/v3/media/${photoId}`, {
    headers: { cookie: `${V3_TEAM_COOKIE}=${token}` },
  });
  await assert.rejects(
    authorizeV3Media(mediaRequest(late.token), photoId),
    /not available for your current task/i,
    'a late check-in cannot read media from the active run',
  );
  assert.equal((await authorizeV3Media(mediaRequest(captain.token), photoId)).id, photoId);

  await finishRun(captain.summary.team.id, captain.summary.member.id, scout.summary.member.id, firstRun.runId);
  await assert.rejects(
    privateRecognition(captain.summary.team.id, late.summary.member.id, firstRun.runId),
    /locked to its starting roster/i,
    'a late check-in cannot read the completed run contribution board',
  );
  const replay = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  assert.equal(Number((await getPool().query(
    'select count(*)::int as count from hunt_v3.run_members where run_id=$1',
    [replay.runId],
  )).rows[0].count), 3, 'the next run snapshots every checked-in member');
  assert.equal(
    (await currentRunView(captain.summary.team.id, late.summary.member.id, replay.runId)).runId,
    replay.runId,
    'the late check-in can participate once included in a new starting roster',
  );
});

test('PostgreSQL V3 runtime: rostered identities require personal PINs and replace older sessions', { skip: !enabled }, async () => {
  const huntId = `v3-roster-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(huntId, 'rostered'));
  const rosterRequestId = randomUUID();
  await assert.rejects(
    createOrganizerTeam({
      huntId, requestId: randomUUID(), displayName: 'Empty roster', memberNames: [], pin: '864285',
      credentialSecret: 'integration-roster-secret', actor: 'Test organizer', sessionHash: 'a'.repeat(64),
    }),
    /enter 1 to 200 roster members/i,
  );
  const createRoster = () => createOrganizerTeam({
    huntId, requestId: rosterRequestId, displayName: 'Owls', memberNames: ['Priya', 'Rohan'], pin: '864286',
    credentialSecret: 'integration-roster-secret', actor: 'Test organizer', sessionHash: 'a'.repeat(64),
  });
  const [created, concurrentReplay] = await Promise.all([createRoster(), createRoster()]);
  assert.deepEqual(concurrentReplay, created, 'concurrent create-team retries allocate one team and one credential set');
  assert.deepEqual(
    await createRoster(),
    created,
    'a lost create-team response replays the same team and private credentials',
  );
  await assert.rejects(
    createOrganizerTeam({
      huntId,
      requestId: rosterRequestId,
      displayName: 'Different Owls',
      memberNames: ['Priya', 'Rohan'],
      pin: '864286',
      credentialSecret: 'integration-roster-secret',
      actor: 'Test organizer',
      sessionHash: 'a'.repeat(64),
    }),
    /already used with different details/i,
    'one request ID cannot be reused to create a different roster',
  );
  assert.equal(
    Number((await getPool().query('select count(*)::int as count from hunt_v3.teams where hunt_id=$1', [huntId])).rows[0].count),
    1,
    'concurrent organizer retries create exactly one team',
  );
  const rosterReceipt = (await getPool().query(
    `select response from hunt_v3.command_receipts
      where scope_key=$1 and request_id=$2`,
    [`admin:create-team:${huntId}`, rosterRequestId],
  )).rows[0]?.response;
  assert.deepEqual(rosterReceipt, { teamId: created.teamId, code: created.code, displayName: created.displayName });
  const serializedReceipt = JSON.stringify(rosterReceipt);
  assert.equal(serializedReceipt.includes(created.pin), false, 'the receipt never stores the team PIN');
  for (const credential of created.memberCredentials) {
    assert.equal(serializedReceipt.includes(credential.claimPin), false, 'the receipt never stores a member PIN');
  }
  const priya = created.memberCredentials.find(member => member.name === 'Priya');
  assert.ok(priya);
  await assert.rejects(
    registerV3Team({ requestId: randomUUID(), huntId, intent: 'claim', playerName: 'Priya', teamCode: created.code, pin: '864286', memberPin: '000000' }),
    /personal member PIN is incorrect/i,
  );
  const first = await registerV3Team({
    requestId: randomUUID(),
    huntId,
    intent: 'claim',
    playerName: 'Priya',
    teamCode: created.code,
    pin: '864286',
    memberPin: priya.claimPin,
  });
  const second = await registerV3Team({
    requestId: randomUUID(),
    huntId,
    intent: 'claim',
    playerName: 'Priya',
    teamCode: created.code,
    pin: '864286',
    memberPin: priya.claimPin,
  });
  await assert.rejects(authenticateV3(first.token, 'team'), /session has expired/i);
  assert.equal((await authenticateV3(second.token, 'team')).memberName, 'Priya');
  const claim = (await getPool().query(
    `select claim_method from hunt_v3.roster_claims where member_id=$1 and status='active'`,
    [second.summary.member.id],
  )).rows[0];
  assert.equal(claim.claim_method, 'member_pin');
});

test('PostgreSQL V3 runs: capped practice unlocks only after competition and reuses a seen structure', { skip: !enabled }, async () => {
  const huntId = `v3-run-policy-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId);
  hunt.settings.runPolicy = { mode: 'capped', maxOfficialRuns: 1 };
  await insertHunt(hunt);

  const captain = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'Captain', teamName: 'Clock Crew',
    pin: '424242', memberPin: '111111', memberNames: ['Scout'], requestSource: `policy-create-${huntId}`,
  });
  await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Scout', teamCode: captain.summary.team.code,
    pin: '424242', memberPin: '222222', requestSource: `policy-join-${huntId}`,
  });
  await approveTestTeam(captain.summary.team.id);
  await assert.rejects(
    createRun(captain.summary.team.id, captain.summary.member.id, randomUUID(), true),
    /official run before starting practice/i,
  );

  const started = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  const state = (await getPool().query('select engine_state from hunt_v3.runs where id=$1', [started.runId])).rows[0].engine_state;
  assert.ok(state.timer);
  state.timer.deadlineAt = new Date(Date.now() - 60_000).toISOString();
  await getPool().query('update hunt_v3.runs set engine_state=$1 where id=$2', [state, started.runId]);

  await assert.rejects(
    createRun(captain.summary.team.id, captain.summary.member.id, randomUUID()),
    /used all 1 official runs/i,
  );
  const expired = (await getPool().query(
    'select status,eligible,elapsed_ms from hunt_v3.runs where id=$1',
    [started.runId],
  )).rows[0];
  assert.deepEqual({ status: expired.status, eligible: expired.eligible }, { status: 'abandoned', eligible: false });
  assert.notEqual(expired.elapsed_ms, null);

  const summary = await getPool().connect().then(async client => {
    try { return await teamSessionSummary(client, captain.summary.team.id, captain.summary.member.id); }
    finally { client.release(); }
  });
  assert.equal(summary.activeRun, null);
  assert.equal(summary.completedOfficialRuns, 0);
  assert.equal(summary.officialAttemptCount, 1);
  assert.equal(summary.remainingOfficialRuns, 0);

  const practice = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID(), true);
  assert.equal(practice.practice, true);
  assert.equal(practice.eligible, false);
  const attempts = (await getPool().query(
    `select private_seed,plan_key,allocation_cycle,practice,eligible,route_plan,engine_state
      from hunt_v3.runs where team_id=$1 order by run_number`,
    [captain.summary.team.id],
  )).rows;
  assert.equal(attempts.length, 2);
  assert.notEqual(attempts[0].private_seed, attempts[1].private_seed, 'practice still receives fresh run-scoped values');
  assert.equal(attempts[1].plan_key, attempts[0].plan_key, 'practice cannot reveal an unseen structural plan');
  assert.deepEqual(attempts[1].route_plan.checkpointIds, attempts[0].route_plan.checkpointIds);
  assert.deepEqual(attempts[1].route_plan.challenges, attempts[0].route_plan.challenges);
  assert.deepEqual(
    attempts[1].engine_state.routeAssignments.map((assignment: { checkpointId: string; nodeId: string; choiceIndex: number; nextNodeId: string }) => ({
      checkpointId: assignment.checkpointId,
      nodeId: assignment.nodeId,
      choiceIndex: assignment.choiceIndex,
      nextNodeId: assignment.nextNodeId,
    })),
    attempts[0].engine_state.routeAssignments.map((assignment: { checkpointId: string; nodeId: string; choiceIndex: number; nextNodeId: string }) => ({
      checkpointId: assignment.checkpointId,
      nodeId: assignment.nodeId,
      choiceIndex: assignment.choiceIndex,
      nextNodeId: assignment.nextNodeId,
    })),
    'practice also preserves the already-exposed internal seeded branches',
  );
  assert.equal(attempts[1].allocation_cycle, attempts[0].allocation_cycle + 1);
  const startedEvent = (await getPool().query(
    "select details from hunt_v3.run_events where run_id=$1 and event_type='run_started'",
    [practice.runId],
  )).rows[0].details;
  assert.equal(startedEvent.practiceSourceRunId, started.runId, 'the reused official source is privately auditable');

  const otherCaptain = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'Other Captain', teamName: 'Other Clock Crew',
    pin: '525252', memberPin: '333333', memberNames: ['Other Scout'], requestSource: `policy-other-create-${huntId}`,
  });
  await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Other Scout', teamCode: otherCaptain.summary.team.code,
    pin: '525252', memberPin: '444444', requestSource: `policy-other-join-${huntId}`,
  });
  await approveTestTeam(otherCaptain.summary.team.id);
  const otherOfficial = await createRun(otherCaptain.summary.team.id, otherCaptain.summary.member.id, randomUUID());
  const otherStarted = (await getPool().query(
    "select details from hunt_v3.run_events where run_id=$1 and event_type='run_started'",
    [otherOfficial.runId],
  )).rows[0].details;
  assert.equal(otherStarted.priorEventUses, 1, 'practice runs do not consume or distort the official allocation deck');
});

test('PostgreSQL V3 auth: limits, personal identity, lock scope, team size and revocation fail closed', { skip: !enabled }, async () => {
  const huntId = `v3-auth-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId);
  hunt.settings.maxTeamSize = 2;
  await insertHunt(hunt);

  await assert.rejects(
    registerV3Team({
      requestId: randomUUID(), huntId, intent: 'create', playerName: 'Asha', teamName: 'Too Many',
      pin: '123456', memberPin: '111111', memberNames: ['Bela', 'Chirag'], requestSource: `oversize-${huntId}`,
    }),
    /at most 2 members/i,
  );
  const asha = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'Asha', teamName: 'Secure Crew',
    pin: '123456', memberPin: '111111', memberNames: ['Bela'], requestSource: `create-${huntId}`,
  });

  const blocker = await getPool().connect();
  let bela: Awaited<ReturnType<typeof registerV3Team>>;
  try {
    await blocker.query('begin');
    await blocker.query('select id from hunt_v3.hunts where id=$1 for update', [huntId]);
    const blockerPid = Number((await blocker.query('select pg_backend_pid() as pid')).rows[0].pid);
    const join = registerV3Team({
      requestId: randomUUID(), huntId, intent: 'join', playerName: 'Bela', teamCode: asha.summary.team.code,
      pin: '123456', memberPin: '222222', requestSource: `join-${huntId}`,
    });
    let observedParentWait = false;
    const deadline = Date.now() + 2_000;
    while (!observedParentWait && Date.now() < deadline) {
      observedParentWait = Boolean((await getPool().query(
        `select exists(
          select 1 from pg_stat_activity activity
          where activity.pid<>$1 and $1=any(pg_blocking_pids(activity.pid))
        ) as blocked`,
        [blockerPid],
      )).rows[0].blocked);
      if (!observedParentWait) await new Promise(resolve => setTimeout(resolve, 10));
    }
    await blocker.query('rollback');
    bela = await join;
    assert.equal(observedParentWait, true, 'joining locks the hunt parent before the team so concurrent lifecycle changes cannot invert lock order');
  } finally {
    await blocker.query('rollback').catch(() => undefined);
    blocker.release();
  }
  assert.equal(bela.summary.member.name, 'Bela');
  await getPool().query("update hunt_v3.team_members set status='removed' where id=$1", [bela.summary.member.id]);
  await assert.rejects(
    registerV3Team({
      requestId: randomUUID(), huntId, intent: 'join', playerName: 'Bela', teamCode: asha.summary.team.code,
      pin: '123456', memberPin: '222222', requestSource: `removed-${huntId}`,
    }),
    /member was removed/i,
  );
  assert.equal((await getPool().query('select status from hunt_v3.team_members where id=$1', [bela.summary.member.id])).rows[0].status, 'removed');

  await getPool().query("update hunt_v3.teams set status='disabled' where id=$1", [asha.summary.team.id]);
  await assert.rejects(authenticateV3(asha.token, 'team'), /session has expired|membership changed/i);
  assert.ok((await getPool().query('select revoked_at from hunt_v3.sessions where token_hash=$1', [digest(asha.token)])).rows[0].revoked_at);

  const assignedId = `v3-assigned-${randomUUID().slice(0, 8)}`;
  const assigned = definition(assignedId, 'organizer-assigned');
  assigned.settings.maxTeamSize = 1;
  await insertHunt(assigned);
  await assert.rejects(
    createOrganizerTeam({
      huntId: assignedId, requestId: randomUUID(), memberNames: ['One'], pin: '654321',
      credentialSecret: 'integration-roster-secret', actor: 'Test organizer', sessionHash: 'a'.repeat(64),
    }),
    /do not use a fixed member roster/i,
  );
  const assignedTeam = await createOrganizerTeam({
    huntId: assignedId, requestId: randomUUID(), displayName: 'Assigned Crew', memberNames: [], pin: '654321',
    credentialSecret: 'integration-roster-secret', actor: 'Test organizer', sessionHash: 'a'.repeat(64),
  });
  assert.deepEqual(assignedTeam.memberCredentials, []);
  const assignedMember = await registerV3Team({
    requestId: randomUUID(), huntId: assignedId, intent: 'join', playerName: 'One', teamCode: assignedTeam.code,
    pin: '654321', memberPin: '333333', requestSource: `assigned-first-${assignedId}`,
  });
  assert.equal(assignedMember.summary.member.name, 'One');
  await assert.rejects(
    registerV3Team({
      requestId: randomUUID(), huntId: assignedId, intent: 'join', playerName: 'One', teamCode: assignedTeam.code,
      pin: '654321', memberPin: '444444', requestSource: `assigned-wrong-${assignedId}`,
    }),
    /personal member PIN is incorrect/i,
  );
  await assert.rejects(
    registerV3Team({
      requestId: randomUUID(), huntId: assignedId, intent: 'join', playerName: 'Two', teamCode: assignedTeam.code,
      pin: '654321', memberPin: '444444', requestSource: `assigned-full-${assignedId}`,
    }),
    /team is full/i,
  );

  const blockedSource = `blocked-${randomUUID()}`;
  await getPool().query(
    'insert into hunt_v3.rate_limits(key,attempts) values($1,300)',
    [digest(`registration:source:${blockedSource}`)],
  );
  await assert.rejects(
    registerV3Team({
      requestId: randomUUID(), huntId: assignedId, intent: 'join', playerName: 'Anyone', teamCode: 'T-999',
      pin: '654321', memberPin: '333333', requestSource: blockedSource,
    }),
    /too many attempts/i,
  );

  const previousPassword = process.env.ORGANIZER_PASSWORD;
  process.env.ORGANIZER_PASSWORD = 'correct horse battery staple';
  const adminSource = `blocked-admin-${randomUUID()}`;
  await getPool().query(
    'insert into hunt_v3.rate_limits(key,attempts) values($1,12)',
    [digest(`organizer-signin:source:${adminSource}`)],
  );
  try {
    await assert.rejects(
      createV3AdminSession('correct horse battery staple', 'Organizer', adminSource),
      /too many attempts/i,
      'a correct password cannot bypass the pre-verification source limit',
    );
  } finally {
    if (previousPassword === undefined) delete process.env.ORGANIZER_PASSWORD;
    else process.env.ORGANIZER_PASSWORD = previousPassword;
  }

  const previousRender = process.env.RENDER;
  process.env.RENDER = 'true';
  try {
    assert.equal(v3RequestSource({ headers: new Headers({ 'x-forwarded-for': 'spoofed, 203.0.113.8' }) }), 'forwarded:203.0.113.8');
    assert.equal(v3RequestSource({ headers: new Headers({ 'x-real-ip': '198.51.100.9', 'x-forwarded-for': '203.0.113.10' }) }), 'forwarded:203.0.113.10');
  } finally {
    if (previousRender === undefined) delete process.env.RENDER;
    else process.env.RENDER = previousRender;
  }
  assert.equal(v3RequestSource({ headers: new Headers({ 'x-forwarded-for': 'attacker-controlled' }) }), 'unavailable');
});

test('PostgreSQL V3 commands: novel state-neutral writes are bounded while exact receipt replays survive throttling', { skip: !enabled }, async () => {
  const huntId = `v3-command-limit-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId);
  hunt.settings.minTeamSize = 1;
  hunt.settings.parallelMechanics = [];
  hunt.checkpoints[0].title = 'Hint start';
  hunt.checkpoints[0].flow = {
    startNodeId: 'read',
    nodes: [
      { id: 'read', type: 'show_text', text: 'Read this before continuing.', next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  };
  hunt.checkpoints[0].hints = [{
    id: 'nudge',
    title: 'A gentle nudge',
    cost: 0,
    content: { type: 'text', text: 'Take your time and read the prompt.' },
  }];
  await insertHunt(hunt);

  const player = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'Reader', teamName: 'Hint Crew',
    pin: '481516', memberPin: '234211', requestSource: `command-limit-${huntId}`,
  });
  await approveTestTeam(player.summary.team.id);
  const run = await createRun(player.summary.team.id, player.summary.member.id, randomUUID());
  const command = { type: 'use_hint' as const, checkpointId: 'start', hintId: 'nudge' };
  const originalRequestId = randomUUID();
  const first = await applyRunCommand(player.summary.team.id, player.summary.member.id, run.runId, originalRequestId, command);
  assert.equal(first.feedback.status, 'accepted');

  // The first use plus 29 unique state-neutral repeats fills the 30-command
  // hint bucket. Each accepted repeat used to be able to grow immutable rows
  // without any bound.
  for (let index = 0; index < 29; index++) {
    const repeated = await applyRunCommand(player.summary.team.id, player.summary.member.id, run.runId, randomUUID(), command);
    assert.equal(repeated.feedback.status, 'already_applied');
  }
  const beforeRejected = (await getPool().query(
    `select
      (select count(*)::int from hunt_v3.run_events where run_id=$1) as events,
      (select count(*)::int from hunt_v3.command_receipts where run_id=$1 and operation='run_command') as receipts`,
    [run.runId],
  )).rows[0];
  await assert.rejects(
    applyRunCommand(player.summary.team.id, player.summary.member.id, run.runId, randomUUID(), command),
    /too many attempts/i,
  );
  const afterRejected = (await getPool().query(
    `select
      (select count(*)::int from hunt_v3.run_events where run_id=$1) as events,
      (select count(*)::int from hunt_v3.command_receipts where run_id=$1 and operation='run_command') as receipts`,
    [run.runId],
  )).rows[0];
  assert.deepEqual(afterRejected, beforeRejected, 'a throttled novel request creates no audit event or receipt');

  const replay = await applyRunCommand(player.summary.team.id, player.summary.member.id, run.runId, originalRequestId, command);
  assert.equal(replay.feedback.status, 'accepted', 'the original committed request remains replayable after the throttle is exhausted');
  const afterReplay = (await getPool().query(
    `select
      (select count(*)::int from hunt_v3.run_events where run_id=$1) as events,
      (select count(*)::int from hunt_v3.command_receipts where run_id=$1 and operation='run_command') as receipts`,
    [run.runId],
  )).rows[0];
  assert.deepEqual(afterReplay, beforeRejected, 'an exact replay does not append another audit event or receipt');
});

test('PostgreSQL V3 run creation bounds novel resumes while exact create receipts remain recoverable', { skip: !enabled }, async () => {
  const huntId = `v3-create-limit-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId);
  hunt.settings.minTeamSize = 1;
  hunt.settings.parallelMechanics = [];
  await insertHunt(hunt);
  const player = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'Resume Player', teamName: 'Resume Crew',
    pin: '246802', memberPin: '135792', requestSource: `create-limit-${huntId}`,
  });
  await approveTestTeam(player.summary.team.id);
  const originalRequestId = randomUUID();
  const run = await createRun(player.summary.team.id, player.summary.member.id, originalRequestId);
  for (let index = 0; index < 29; index++) {
    const resumed = await createRun(player.summary.team.id, player.summary.member.id, randomUUID());
    assert.equal(resumed.runId, run.runId);
  }
  await assert.rejects(
    createRun(player.summary.team.id, player.summary.member.id, randomUUID()),
    /too many attempts/i,
  );
  const key = digest(`run-create:novel:${player.summary.team.id}:${player.summary.member.id}`);
  assert.equal(Number((await getPool().query('select attempts from hunt_v3.rate_limits where key=$1', [key])).rows[0].attempts), 31);
  await assert.rejects(createRun(player.summary.team.id, player.summary.member.id, randomUUID()), /too many attempts/i);
  assert.equal(Number((await getPool().query('select attempts from hunt_v3.rate_limits where key=$1', [key])).rows[0].attempts), 32,
    'rejected reservations persist outside the run transaction');
  assert.equal((await createRun(player.summary.team.id, player.summary.member.id, originalRequestId)).runId, run.runId,
    'the original receipt bypasses an exhausted novel-create bucket');
});

test('PostgreSQL V3 concurrent commands do not exhaust the pool through nested limiter queries', { skip: !enabled }, async () => {
  const huntId = `v3-command-concurrency-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId);
  hunt.settings.minTeamSize = 1;
  hunt.settings.parallelMechanics = [];
  hunt.checkpoints[0].flow = {
    startNodeId: 'read',
    nodes: [
      { id: 'read', type: 'show_text', text: 'Read while the team checks a hint.', next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  };
  hunt.checkpoints[0].hints = [{ id: 'nudge', title: 'Nudge', cost: 0, content: { type: 'text', text: 'Keep reading.' } }];
  await insertHunt(hunt);
  const player = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'Concurrent Player', teamName: 'Concurrent Crew',
    pin: '246803', memberPin: '135793', requestSource: `command-concurrency-${huntId}`,
  });
  await approveTestTeam(player.summary.team.id);
  const run = await createRun(player.summary.team.id, player.summary.member.id, randomUUID());
  const requestIds = Array.from({ length: 20 }, () => randomUUID());
  const startedAt = Date.now();
  const results = await Promise.all(requestIds.map(requestId => applyRunCommand(
    player.summary.team.id,
    player.summary.member.id,
    run.runId,
    requestId,
    { type: 'use_hint', checkpointId: 'start', hintId: 'nudge' },
  )));
  assert.ok(Date.now() - startedAt < 4_000, '20 contenders complete below the five-second pool acquisition timeout');
  assert.equal(results.filter(result => result.feedback.status === 'accepted').length, 1);
  assert.equal(results.filter(result => result.feedback.status === 'already_applied').length, 19);
  assert.equal((await applyRunCommand(
    player.summary.team.id,
    player.summary.member.id,
    run.runId,
    requestIds[0],
    { type: 'use_hint', checkpointId: 'start', hintId: 'nudge' },
  )).feedback.status, results[0].feedback.status, 'an exact concurrent receipt remains replayable');
});

test('PostgreSQL V3 parallel commands have a broad novel-write cap with exact replay recovery', { skip: !enabled }, async () => {
  const huntId = `v3-parallel-limit-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(huntId));
  const captain = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'Limit Captain', teamName: 'Parallel Limit Crew',
    pin: '246804', memberPin: '135794', memberNames: ['Limit Scout'], requestSource: `parallel-limit-create-${huntId}`,
  });
  await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Limit Scout', teamCode: captain.summary.team.code,
    pin: '246804', memberPin: '975314', requestSource: `parallel-limit-join-${huntId}`,
  });
  await approveTestTeam(captain.summary.team.id);
  const run = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  const original = {
    teamId: captain.summary.team.id,
    memberId: captain.summary.member.id,
    runId: run.runId,
    requestId: randomUUID(),
    mechanicId: 'split-gate',
    laneId: 'north',
    evidence: { value: 'NORTH-7' },
  };
  assert.equal((await submitParallelLane(original)).accepted, true);
  const limiterKey = digest(`parallel-command:novel:${run.runId}:${captain.summary.member.id}`);
  await getPool().query(
    `insert into hunt_v3.rate_limits(key,attempts) values($1,400)
      on conflict(key) do update set attempts=400,window_start=now()`,
    [limiterKey],
  );
  assert.equal((await submitParallelLane(original)).accepted, true, 'an exact lane receipt bypasses the broad cap');
  const before = Number((await getPool().query(
    'select count(*)::int as count from hunt_v3.command_receipts where run_id=$1',
    [run.runId],
  )).rows[0].count);
  await assert.rejects(submitParallelLane({ ...original, requestId: randomUUID() }), /too many attempts/i);
  assert.equal(Number((await getPool().query('select attempts from hunt_v3.rate_limits where key=$1', [limiterKey])).rows[0].attempts), 401);
  assert.equal(Number((await getPool().query(
    'select count(*)::int as count from hunt_v3.command_receipts where run_id=$1',
    [run.runId],
  )).rows[0].count), before, 'a throttled parallel request creates no immutable receipt');
});

test('PostgreSQL V3 verifier attempts share one run/node budget across team members', { skip: !enabled }, async () => {
  const huntId = `v3-verifier-aggregate-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId);
  hunt.settings.parallelMechanics = [];
  hunt.checkpoints[0].flow = {
    startNodeId: 'answer',
    nodes: [
      { id: 'answer', type: 'verify_answer', prompt: 'Enter the answer.', answers: ['correct'], next: 'photo' },
      { id: 'photo', type: 'verify_image', prompt: 'Take fresh proof.', referenceImages: [], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  };
  await insertHunt(hunt);
  const captain = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'Verifier Captain', teamName: 'Verifier Crew',
    pin: '246805', memberPin: '135795', memberNames: ['Verifier Scout'], requestSource: `verifier-create-${huntId}`,
  });
  await approveTestTeam(captain.summary.team.id);
  const scout = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Verifier Scout', teamCode: captain.summary.team.code,
    pin: '246805', memberPin: '975315', requestSource: `verifier-join-${huntId}`,
  });
  const run = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  const lateMemberId = randomUUID();
  await getPool().query(
    `insert into hunt_v3.team_members(id,team_id,name,name_key,status,checked_in_at)
      values($1,$2,'Verifier Late Joiner',$3,'active',clock_timestamp())`,
    [lateMemberId, captain.summary.team.id, `verifier-late-${lateMemberId}`],
  );
  const aggregateKey = digest(`run-verifier:aggregate:${captain.summary.team.id}:${run.runId}:start:answer`);
  await assert.rejects(
    applyRunCommand(captain.summary.team.id, lateMemberId, run.runId, randomUUID(), {
      type: 'verify', checkpointId: 'start', nodeId: 'answer', value: 'correct',
    }),
    /starting roster/i,
    'a member who joined after the run began cannot spend the starting roster\'s answer budget',
  );
  assert.equal(
    (await getPool().query('select 1 from hunt_v3.run_attempt_reservations where scope_key=$1', [aggregateKey])).rowCount,
    0,
    'an unauthorized late member creates no aggregate attempt reservation',
  );
  const firstRequest = randomUUID();
  const firstCommand = { type: 'verify' as const, checkpointId: 'start', nodeId: 'answer', value: 'wrong-1' };
  for (let index = 0; index < 6; index++) {
    const result = await applyRunCommand(
      captain.summary.team.id,
      index % 2 ? scout.summary.member.id : captain.summary.member.id,
      run.runId,
      index === 0 ? firstRequest : randomUUID(),
      index === 0 ? firstCommand : { ...firstCommand, value: `wrong-${index + 1}` },
    );
    assert.equal(result.feedback.status, 'rejected');
  }
  await assert.rejects(
    applyRunCommand(captain.summary.team.id, scout.summary.member.id, run.runId, randomUUID(), {
      ...firstCommand, value: 'correct',
    }),
    /too many attempts/i,
    'a second identity cannot multiply the answer budget',
  );
  assert.equal(
    (await applyRunCommand(captain.summary.team.id, captain.summary.member.id, run.runId, firstRequest, firstCommand)).feedback.status,
    'rejected',
    'an exact committed request remains replayable after the aggregate bucket is exhausted',
  );
  assert.equal(Number((await getPool().query(
    'select count(*)::int as count from hunt_v3.run_attempt_reservations where scope_key=$1',
    [aggregateKey],
  )).rows[0].count), 6);
});

test('PostgreSQL V3 code and QR lanes share one aggregate budget across team members', { skip: !enabled }, async () => {
  const huntId = `v3-parallel-aggregate-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(huntId));
  const captain = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'Lane Captain', teamName: 'Lane Crew',
    pin: '246806', memberPin: '135796', memberNames: ['Lane Scout'], requestSource: `lane-create-${huntId}`,
  });
  await approveTestTeam(captain.summary.team.id);
  const scout = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Lane Scout', teamCode: captain.summary.team.code,
    pin: '246806', memberPin: '975316', requestSource: `lane-join-${huntId}`,
  });
  const run = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  const first = {
    teamId: captain.summary.team.id,
    memberId: captain.summary.member.id,
    runId: run.runId,
    requestId: randomUUID(),
    mechanicId: 'split-gate',
    laneId: 'north',
    evidence: { value: 'wrong-1' },
  };
  for (let index = 0; index < 6; index++) {
    const result = await submitParallelLane(index === 0 ? first : {
      ...first,
      memberId: index % 2 ? scout.summary.member.id : captain.summary.member.id,
      requestId: randomUUID(),
      evidence: { value: `wrong-${index + 1}` },
    });
    assert.deepEqual({ accepted: result.accepted, status: result.status }, { accepted: false, status: 'rejected' });
  }
  await assert.rejects(
    submitParallelLane({ ...first, memberId: scout.summary.member.id, requestId: randomUUID(), evidence: { value: 'NORTH-7' } }),
    /too many attempts/i,
    'a second identity cannot multiply a code/QR lane budget',
  );
  assert.deepEqual(
    await submitParallelLane(first).then(result => ({ accepted: result.accepted, status: result.status })),
    { accepted: false, status: 'rejected' },
    'an exact failed lane request remains replayable after the aggregate bucket is exhausted',
  );
  const aggregateKey = digest(`parallel-lane:aggregate:${captain.summary.team.id}:${run.runId}:split-gate:north`);
  assert.equal(Number((await getPool().query(
    'select count(*)::int as count from hunt_v3.run_attempt_reservations where scope_key=$1',
    [aggregateKey],
  )).rows[0].count), 6);
});

test('PostgreSQL V3 reserves a transitioned parallel lane from the authoritative locked state', { skip: !enabled }, async t => {
  const huntId = `v3-parallel-transition-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId);
  hunt.checkpoints[0].flow = {
    startNodeId: 'intro',
    nodes: [
      { id: 'intro', type: 'show_text', text: 'Ready?', next: 'parallel-gate' },
      { id: 'parallel-gate', type: 'verify_organizer', prompt: 'Split up.', next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  };
  await insertHunt(hunt);
  const captain = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'Transition Captain', teamName: 'Parallel Transition Crew',
    pin: '246816', memberPin: '135716', memberNames: ['Transition Partner'], requestSource: `parallel-transition-create-${huntId}`,
  });
  await approveTestTeam(captain.summary.team.id);
  const partner = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Transition Partner', teamCode: captain.summary.team.code,
    pin: '246816', memberPin: '975316', requestSource: `parallel-transition-join-${huntId}`,
  });
  const run = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  assert.match(run.runId, /^[0-9a-f-]{36}$/i);
  await getPool().query(`
    create or replace function hunt_v3.test_delay_parallel_transition() returns trigger
    language plpgsql as $$ begin perform pg_sleep(0.5); return new; end $$;
    drop trigger if exists test_delay_parallel_transition on hunt_v3.runs;
    create trigger test_delay_parallel_transition before update on hunt_v3.runs
    for each row when (new.id='${run.runId}'::uuid)
    execute function hunt_v3.test_delay_parallel_transition();
  `);
  t.after(async () => {
    await getPool().query('drop trigger if exists test_delay_parallel_transition on hunt_v3.runs');
    await getPool().query('drop function if exists hunt_v3.test_delay_parallel_transition()');
  });
  const advance = applyRunCommand(captain.summary.team.id, captain.summary.member.id, run.runId, randomUUID(), {
    type: 'continue', checkpointId: 'start', nodeId: 'intro',
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  const laneRequestId = randomUUID();
  const lane = submitParallelLane({
    teamId: captain.summary.team.id, memberId: partner.summary.member.id, runId: run.runId,
    requestId: laneRequestId, mechanicId: 'split-gate', laneId: 'north', evidence: { value: 'WRONG' },
  });
  const [, laneResult] = await Promise.all([advance, lane]);
  assert.deepEqual({ accepted: laneResult.accepted, status: laneResult.status }, { accepted: false, status: 'rejected' });
  const aggregateKey = digest(`parallel-lane:aggregate:${captain.summary.team.id}:${run.runId}:split-gate:north`);
  assert.equal(Number((await getPool().query(
    'select count(*)::int as count from hunt_v3.run_attempt_reservations where scope_key=$1 and request_id=$2',
    [aggregateKey, laneRequestId],
  )).rows[0].count), 1);
});

test('PostgreSQL V3 puzzle throttles allow stateful progress beyond 20 moves while capping text guesses', { skip: !enabled }, async () => {
  const quizHuntId = `v3-quiz-rate-${randomUUID().slice(0, 8)}`;
  const quizHunt = definition(quizHuntId);
  quizHunt.settings.minTeamSize = 1;
  quizHunt.settings.parallelMechanics = [];
  quizHunt.checkpoints[0].title = 'Long quiz';
  quizHunt.checkpoints[0].flow = {
    startNodeId: 'quiz',
    nodes: [
      {
        id: 'quiz',
        type: 'puzzle',
        prompt: 'Work through every question.',
        puzzle: {
          type: 'quiz',
          minimumCorrect: 21,
          questions: Array.from({ length: 21 }, (_, index) => ({
            id: `question-${index + 1}`,
            prompt: `Question ${index + 1}`,
            options: [
              { id: `answer-${index + 1}`, label: 'Answer' },
              { id: `other-${index + 1}`, label: 'Other' },
            ],
            correctOptionId: `answer-${index + 1}`,
          })),
        },
        next: 'photo',
      },
      { id: 'photo', type: 'verify_image', prompt: 'Take fresh quiz proof.', referenceImages: [], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  };
  await insertHunt(quizHunt);
  const quizPlayer = await registerV3Team({
    requestId: randomUUID(), huntId: quizHuntId, intent: 'create', playerName: 'Quiz Player',
    teamName: 'Quiz Crew', pin: '246801', memberPin: '135790', requestSource: `quiz-rate-${quizHuntId}`,
  });
  await approveTestTeam(quizPlayer.summary.team.id);
  const quizRun = await createRun(quizPlayer.summary.team.id, quizPlayer.summary.member.id, randomUUID());
  for (let index = 0; index < 21; index++) {
    const result = await applyRunCommand(
      quizPlayer.summary.team.id,
      quizPlayer.summary.member.id,
      quizRun.runId,
      randomUUID(),
      {
        type: 'submit_puzzle',
        checkpointId: 'start',
        nodeId: 'quiz',
        expectedRevision: index,
        value: { questionId: `question-${index + 1}`, optionId: null, skip: true },
      },
    );
    assert.equal(result.feedback.status, 'accepted');
  }
  const quizProgress = (await getPool().query(
    "select engine_state->'checkpoints'->'start'->'nodes'->'quiz'->'puzzle'->>'revision' as revision from hunt_v3.runs where id=$1",
    [quizRun.runId],
  )).rows[0];
  assert.equal(Number(quizProgress.revision), 21, 'the 21st legitimate stateful move is persisted');

  const textHuntId = `v3-text-rate-${randomUUID().slice(0, 8)}`;
  const textHunt = definition(textHuntId);
  textHunt.settings.minTeamSize = 1;
  textHunt.settings.parallelMechanics = [];
  textHunt.checkpoints[0].title = 'Text answer';
  textHunt.checkpoints[0].flow = {
    startNodeId: 'answer',
    nodes: [
      {
        id: 'answer',
        type: 'puzzle',
        prompt: 'Enter the secret answer.',
        puzzle: { type: 'text', prompt: 'What is the secret?', answers: ['correct'] },
        next: 'photo',
      },
      { id: 'photo', type: 'verify_image', prompt: 'Take fresh answer proof.', referenceImages: [], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  };
  await insertHunt(textHunt);
  const textPlayer = await registerV3Team({
    requestId: randomUUID(), huntId: textHuntId, intent: 'create', playerName: 'Text Player',
    teamName: 'Text Crew', pin: '864209', memberPin: '975310', memberNames: ['Text Partner'],
    requestSource: `text-rate-${textHuntId}`,
  });
  await approveTestTeam(textPlayer.summary.team.id);
  const textPartner = await registerV3Team({
    requestId: randomUUID(), huntId: textHuntId, intent: 'join', playerName: 'Text Partner',
    teamCode: textPlayer.summary.team.code, pin: '864209', memberPin: '975311', requestSource: `text-partner-${textHuntId}`,
  });
  const textRun = await createRun(textPlayer.summary.team.id, textPlayer.summary.member.id, randomUUID());
  const firstTextRequest = randomUUID();
  const firstTextCommand = {
    type: 'submit_puzzle' as const,
    checkpointId: 'start',
    nodeId: 'answer',
    expectedRevision: 0,
    value: { value: 'wrong-1' },
  };
  for (let index = 0; index < 6; index++) {
    const result = await applyRunCommand(
      textPlayer.summary.team.id,
      index % 2 ? textPartner.summary.member.id : textPlayer.summary.member.id,
      textRun.runId,
      index === 0 ? firstTextRequest : randomUUID(),
      index === 0 ? firstTextCommand : { ...firstTextCommand, expectedRevision: index, value: { value: `wrong-${index + 1}` } },
    );
    assert.equal(result.feedback.status, 'accepted');
  }
  await assert.rejects(
    applyRunCommand(textPlayer.summary.team.id, textPartner.summary.member.id, textRun.runId, randomUUID(), {
      type: 'submit_puzzle', checkpointId: 'start', nodeId: 'answer', expectedRevision: 6, value: { value: 'wrong-7' },
    }),
    /too many attempts/i,
    'a second identity cannot multiply the text-answer budget',
  );
  assert.equal(
    (await applyRunCommand(
      textPlayer.summary.team.id,
      textPlayer.summary.member.id,
      textRun.runId,
      firstTextRequest,
      firstTextCommand,
    )).feedback.status,
    'accepted',
    'an exact puzzle receipt remains replayable after the aggregate bucket is exhausted',
  );
  const textProgress = (await getPool().query(
    "select engine_state->'checkpoints'->'start'->'nodes'->'answer'->'puzzle'->>'revision' as revision from hunt_v3.runs where id=$1",
    [textRun.runId],
  )).rows[0];
  assert.equal(Number(textProgress.revision), 6, 'the throttled text guess does not mutate puzzle progress');
  const textAggregateKey = digest(`run-puzzle-submit:aggregate:${textPlayer.summary.team.id}:${textRun.runId}:start:answer`);
  assert.equal(Number((await getPool().query(
    'select count(*)::int as count from hunt_v3.run_attempt_reservations where scope_key=$1',
    [textAggregateKey],
  )).rows[0].count), 6);
});

test('PostgreSQL V3 multiple choice permits one final team submission instead of sequential brute force', { skip: !enabled }, async () => {
  const huntId = `v3-choice-final-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId);
  hunt.settings.minTeamSize = 1;
  hunt.settings.parallelMechanics = [];
  hunt.checkpoints[0].flow = {
    startNodeId: 'choice',
    nodes: [
      {
        id: 'choice',
        type: 'puzzle',
        prompt: 'Choose once.',
        puzzle: {
          type: 'multiple_choice',
          prompt: 'Which answer is correct?',
          options: [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }],
          correctOptionId: 'second',
        },
        next: 'photo',
      },
      { id: 'photo', type: 'verify_image', prompt: 'Take fresh choice proof.', referenceImages: [], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  };
  await insertHunt(hunt);
  const player = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'Choice Player', teamName: 'Choice Crew',
    pin: '246807', memberPin: '135797', requestSource: `choice-create-${huntId}`,
  });
  await approveTestTeam(player.summary.team.id);
  const run = await createRun(player.summary.team.id, player.summary.member.id, randomUUID());
  const firstRequest = randomUUID();
  const wrong = {
    type: 'submit_puzzle' as const,
    checkpointId: 'start',
    nodeId: 'choice',
    expectedRevision: 0,
    value: { optionId: 'first' },
  };
  const concurrentRetry = await Promise.all([
    applyRunCommand(player.summary.team.id, player.summary.member.id, run.runId, firstRequest, wrong),
    applyRunCommand(player.summary.team.id, player.summary.member.id, run.runId, firstRequest, wrong),
  ]);
  assert.deepEqual(concurrentRetry.map(result => result.view.status), ['active', 'active']);
  const choiceScopeKey = digest(`run-puzzle-submit:aggregate:${player.summary.team.id}:${run.runId}:start:choice`);
  assert.equal(Number((await getPool().query(
    'select count(*)::int as count from hunt_v3.run_attempt_reservations where scope_key=$1',
    [choiceScopeKey],
  )).rows[0].count), 1, 'simultaneous retries reserve one permanent final submission');
  await assert.rejects(
    applyRunCommand(player.summary.team.id, player.summary.member.id, run.runId, randomUUID(), {
      ...wrong, expectedRevision: 1, value: { optionId: 'second' },
    }),
    /too many attempts/i,
    'trying every public option cannot guarantee an official solve',
  );
  assert.equal((await applyRunCommand(
    player.summary.team.id, player.summary.member.id, run.runId, firstRequest, wrong,
  )).view.status, 'active', 'the single final submission remains idempotently replayable');
  const persisted = (await getPool().query('select status,score,engine_state from hunt_v3.runs where id=$1', [run.runId])).rows[0];
  assert.equal(persisted.status, 'active');
  assert.equal(persisted.score, 0);
  assert.equal(persisted.engine_state.checkpoints.start.nodes.choice.puzzle.revision, 1);
});

test('PostgreSQL V3 reserves a transitioned puzzle budget from the authoritative locked state', { skip: !enabled }, async t => {
  const huntId = `v3-transition-budget-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId);
  hunt.settings.minTeamSize = 1;
  hunt.settings.parallelMechanics = [];
  hunt.checkpoints[0].flow = {
    startNodeId: 'intro',
    nodes: [
      { id: 'intro', type: 'show_text', text: 'Ready?', next: 'choice' },
      {
        id: 'choice', type: 'puzzle', prompt: 'Choose once.',
        puzzle: {
          type: 'multiple_choice', prompt: 'Which is correct?',
          options: [{ id: 'wrong', label: 'Wrong' }, { id: 'right', label: 'Right' }], correctOptionId: 'right',
        },
        next: 'photo',
      },
      { id: 'photo', type: 'verify_image', prompt: 'Take fresh transition proof.', referenceImages: [], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  };
  await insertHunt(hunt);
  const player = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'Transition Player', teamName: 'Transition Crew',
    pin: '246815', memberPin: '135715', requestSource: `transition-create-${huntId}`,
  });
  await approveTestTeam(player.summary.team.id);
  const run = await createRun(player.summary.team.id, player.summary.member.id, randomUUID());
  assert.match(run.runId, /^[0-9a-f-]{36}$/i);
  await getPool().query(`
    create or replace function hunt_v3.test_delay_transition_update() returns trigger
    language plpgsql as $$ begin perform pg_sleep(0.5); return new; end $$;
    drop trigger if exists test_delay_transition_update on hunt_v3.runs;
    create trigger test_delay_transition_update before update on hunt_v3.runs
    for each row when (new.id='${run.runId}'::uuid)
    execute function hunt_v3.test_delay_transition_update();
  `);
  t.after(async () => {
    await getPool().query('drop trigger if exists test_delay_transition_update on hunt_v3.runs');
    await getPool().query('drop function if exists hunt_v3.test_delay_transition_update()');
  });
  const advance = applyRunCommand(player.summary.team.id, player.summary.member.id, run.runId, randomUUID(), {
    type: 'continue', checkpointId: 'start', nodeId: 'intro',
  });
  await new Promise(resolve => setTimeout(resolve, 100));
  const racedRequestId = randomUUID();
  const choose = applyRunCommand(player.summary.team.id, player.summary.member.id, run.runId, racedRequestId, {
    type: 'submit_puzzle', checkpointId: 'start', nodeId: 'choice', expectedRevision: 0,
    value: { optionId: 'right' },
  });
  const [, chosen] = await Promise.all([advance, choose]);
  assert.equal(chosen.feedback.status, 'accepted');
  const preflightMemberKey = digest(`run-puzzle-submit:${run.runId}:${player.summary.member.id}:start:choice`);
  assert.equal(
    (await getPool().query('select 1 from hunt_v3.rate_limits where key=$1', [preflightMemberKey])).rowCount,
    0,
    'the intentionally stale preflight did not see the newly active puzzle',
  );
  const aggregateKey = digest(`run-puzzle-submit:aggregate:${player.summary.team.id}:${run.runId}:start:choice`);
  assert.equal(Number((await getPool().query(
    'select count(*)::int as count from hunt_v3.run_attempt_reservations where scope_key=$1 and request_id=$2',
    [aggregateKey, racedRequestId],
  )).rows[0].count), 1, 'the locked state still reserves the transitioned node before accepting it');
});

test('PostgreSQL V3 stateful puzzle budgets cannot be multiplied by extra team identities', { skip: !enabled }, async () => {
  const huntId = `v3-matching-budget-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId);
  hunt.settings.parallelMechanics = [];
  hunt.checkpoints[0].flow = {
    startNodeId: 'matching',
    nodes: [
      {
        id: 'matching', type: 'puzzle', prompt: 'Match all five.',
        puzzle: {
          type: 'matching',
          left: ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, label: id.toUpperCase() })),
          right: ['1', '2', '3', '4', '5'].map(id => ({ id, label: id })),
          solution: [
            { leftId: 'a', rightId: '1' }, { leftId: 'b', rightId: '2' },
            { leftId: 'c', rightId: '3' }, { leftId: 'd', rightId: '4' }, { leftId: 'e', rightId: '5' },
          ],
        },
        next: 'photo',
      },
      { id: 'photo', type: 'verify_image', prompt: 'Take fresh matching proof.', referenceImages: [], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  };
  await insertHunt(hunt);
  const captain = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'Matching Captain', teamName: 'Matching Crew',
    pin: '246814', memberPin: '135714', memberNames: ['Matching Partner'], requestSource: `matching-create-${huntId}`,
  });
  await approveTestTeam(captain.summary.team.id);
  const partner = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Matching Partner', teamCode: captain.summary.team.code,
    pin: '246814', memberPin: '975314', requestSource: `matching-join-${huntId}`,
  });
  const run = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  const candidates = [
    ['2', '1', '3', '4', '5'], ['1', '2', '4', '3', '5'], ['2', '3', '4', '5', '1'],
    ['3', '4', '5', '1', '2'], ['4', '5', '1', '2', '3'], ['5', '4', '3', '2', '1'],
    ['2', '4', '1', '5', '3'], ['3', '1', '5', '2', '4'],
  ];
  for (const [index, rights] of candidates.entries()) {
    const result = await applyRunCommand(
      captain.summary.team.id,
      index % 2 ? partner.summary.member.id : captain.summary.member.id,
      run.runId,
      randomUUID(),
      {
        type: 'submit_puzzle', checkpointId: 'start', nodeId: 'matching', expectedRevision: index,
        value: { pairs: ['a', 'b', 'c', 'd', 'e'].map((leftId, pairIndex) => ({ leftId, rightId: rights[pairIndex] })) },
      },
    );
    assert.equal(result.feedback.status, 'accepted');
  }
  await assert.rejects(
    applyRunCommand(captain.summary.team.id, partner.summary.member.id, run.runId, randomUUID(), {
      type: 'submit_puzzle', checkpointId: 'start', nodeId: 'matching', expectedRevision: 8,
      value: { pairs: ['a', 'b', 'c', 'd', 'e'].map((leftId, index) => ({ leftId, rightId: String(index + 1) })) },
    }),
    /too many attempts/i,
    'cycling identities cannot enumerate the remaining matching permutations',
  );
  const scopeKey = digest(`run-puzzle-submit:aggregate:${captain.summary.team.id}:${run.runId}:start:matching`);
  assert.equal(Number((await getPool().query(
    'select count(*)::int as count from hunt_v3.run_attempt_reservations where scope_key=$1',
    [scopeKey],
  )).rows[0].count), 8);
});

test('PostgreSQL V3 photo review starts at accepted submission and parallel uploads require a lane submission', { skip: !enabled }, async () => {
  const normalHuntId = `v3-photo-${randomUUID().slice(0, 8)}`;
  const normalHunt = definition(normalHuntId);
  normalHunt.settings.minTeamSize = 1;
  normalHunt.settings.parallelMechanics = [];
  normalHunt.checkpoints[0].title = 'Photo start';
  normalHunt.checkpoints[0].flow = {
    startNodeId: 'photo',
    nodes: [
      { id: 'photo', type: 'verify_image', prompt: 'Send the landmark photo.', referenceImages: [], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  };
  await insertHunt(normalHunt);
  const photographer = await registerV3Team({
    requestId: randomUUID(), huntId: normalHuntId, intent: 'create', playerName: 'Photographer',
    teamName: 'Photo Crew', pin: '246810', memberPin: '135791', requestSource: `photo-create-${normalHuntId}`,
  });
  await approveTestTeam(photographer.summary.team.id);
  const normalRun = await createRun(photographer.summary.team.id, photographer.summary.member.id, randomUUID());
  const normalMediaId = randomUUID();
  const normalTaskStartedAt = await taskStartedAt(normalRun.runId, 'start', 'photo');
  await getPool().query(
    `insert into hunt_v3.media(
      id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,kind,content_type,bytes,content_hash,storage_key,retention,created_at,
      task_started_at)
      values($1,$2,$3,$4,$5,'start','photo','photo','image/jpeg',1,$6,$7,'keep',clock_timestamp()-interval '10 minutes',$8::timestamptz)`,
    [normalMediaId, normalHuntId, photographer.summary.team.id, normalRun.runId, photographer.summary.member.id,
      'c'.repeat(64), `${normalMediaId}-${randomUUID()}`, normalTaskStartedAt],
  );
  assert.equal((await pendingPhotoReviews(normalHuntId)).some(photo => photo.id === normalMediaId), false);
  assert.equal((await liveOperations(normalHuntId)).alerts.photos, 0);
  await assert.rejects(
    reviewPhoto({ mediaId: normalMediaId, approved: true, reason: 'Premature review', requestId: randomUUID(), actor: 'Test organizer' }),
    /not been submitted/i,
  );
  await applyRunCommand(photographer.summary.team.id, photographer.summary.member.id, normalRun.runId, randomUUID(), {
    type: 'submit_photo', checkpointId: 'start', nodeId: 'photo', mediaId: normalMediaId,
  });
  const normalAfterSubmit = (await getPool().query(
    `select run.engine_state,media.created_at,media.submitted_at
      from hunt_v3.runs run join hunt_v3.media media on media.run_id=run.id
      where run.id=$1 and media.id=$2`,
    [normalRun.runId, normalMediaId],
  )).rows[0];
  const provisionalNormalPause = normalAfterSubmit.engine_state.clockPauses.find(
    (pause: { reason?: string; sourceId?: string; endedAt?: string }) => pause.reason === 'review' && pause.sourceId === normalMediaId && !pause.endedAt,
  );
  assert.ok(provisionalNormalPause, 'accepted submission immediately freezes timeout and ranking clocks');
  assert.equal(Date.parse(provisionalNormalPause.startedAt), new Date(normalAfterSubmit.submitted_at).getTime());
  const normalScenarioNow = Date.now();
  const normalRunStart = new Date(normalScenarioNow - 180_000).toISOString();
  const normalPastStart = new Date(normalScenarioNow - 120_000).toISOString();
  provisionalNormalPause.startedAt = normalPastStart;
  normalAfterSubmit.engine_state.startedAt = normalRunStart;
  normalAfterSubmit.engine_state.timer.deadlineAt = new Date(normalScenarioNow - 60_000).toISOString();
  const submitted = (await getPool().query(
    `update hunt_v3.media set submitted_at=$1 where id=$2 returning created_at,submitted_at`,
    [normalPastStart, normalMediaId],
  )).rows[0];
  await getPool().query('update hunt_v3.runs set engine_state=$1,started_at=$2 where id=$3', [normalAfterSubmit.engine_state, normalRunStart, normalRun.runId]);
  assert.ok(new Date(submitted.submitted_at).getTime() - new Date(submitted.created_at).getTime() > 8 * 60_000);
  assert.equal((await pendingPhotoReviews(normalHuntId)).some(photo => photo.id === normalMediaId), true);
  assert.equal((await liveOperations(normalHuntId)).alerts.photos, 1);
  const resumedNormal = await createRun(photographer.summary.team.id, photographer.summary.member.id, randomUUID());
  assert.equal(resumedNormal.runId, normalRun.runId, 'deadline passage cannot abandon a run while organizer review is open');
  await reviewPhoto({ mediaId: normalMediaId, approved: true, reason: 'Landmark confirmed', requestId: randomUUID(), actor: 'Test organizer' });
  const normalPersisted = (await getPool().query('select status,eligible,engine_state from hunt_v3.runs where id=$1', [normalRun.runId])).rows[0];
  const normalState = normalPersisted.engine_state;
  const reviewPause = normalState.clockPauses.find((pause: { reason?: string; sourceId?: string }) => pause.reason === 'review' && pause.sourceId === normalMediaId);
  assert.ok(reviewPause);
  assert.equal(Date.parse(reviewPause.startedAt), new Date(submitted.submitted_at).getTime());
  assert.ok(Date.parse(reviewPause.endedAt) - Date.parse(reviewPause.startedAt) >= 119_000);
  assert.ok(Date.parse(reviewPause.endedAt) - Date.parse(reviewPause.startedAt) < 130_000);
  assert.equal(normalPersisted.status, 'active');
  assert.equal(normalPersisted.eligible, true);
  assert.ok(Date.parse(normalState.timer.deadlineAt) > Date.parse(reviewPause.endedAt), 'closing review extends the old deadline by the excluded wait');

  const parallelHuntId = `v3-parallel-photo-${randomUUID().slice(0, 8)}`;
  const parallelHunt = definition(parallelHuntId);
  parallelHunt.settings.parallelMechanics = [{
    id: 'split-gate', checkpointId: 'start', nodeId: 'parallel-gate', timeWindowSeconds: 120,
    lanes: [
      { id: 'north', label: 'North photo', type: 'photo' },
      { id: 'south', label: 'South code', type: 'code', code: 'SOUTH-9' },
    ],
  }];
  await insertHunt(parallelHunt);
  const captain = await registerV3Team({
    requestId: randomUUID(), huntId: parallelHuntId, intent: 'create', playerName: 'Captain',
    teamName: 'Parallel Crew', pin: '864208', memberPin: '111111', memberNames: ['Scout'],
    requestSource: `parallel-photo-create-${parallelHuntId}`,
  });
  const scout = await registerV3Team({
    requestId: randomUUID(), huntId: parallelHuntId, intent: 'join', playerName: 'Scout',
    teamCode: captain.summary.team.code, pin: '864208', memberPin: '222222',
    requestSource: `parallel-photo-join-${parallelHuntId}`,
  });
  await approveTestTeam(captain.summary.team.id);
  const parallelRun = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  const parallelMediaId = randomUUID();
  const parallelTaskStartedAt = await taskStartedAt(parallelRun.runId, 'start', 'parallel-gate');
  await getPool().query(
    `insert into hunt_v3.media(
      id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,parallel_mechanic_id,parallel_lane_id,
      kind,content_type,bytes,content_hash,storage_key,retention,created_at,task_started_at)
      values($1,$2,$3,$4,$5,'start','parallel-gate','split-gate','north','photo','image/jpeg',1,$6,$7,'keep',
        clock_timestamp()-interval '10 minutes',$8::timestamptz)`,
    [parallelMediaId, parallelHuntId, captain.summary.team.id, parallelRun.runId, captain.summary.member.id,
      'd'.repeat(64), `${parallelMediaId}-${randomUUID()}`, parallelTaskStartedAt],
  );
  assert.equal((await pendingPhotoReviews(parallelHuntId)).some(photo => photo.id === parallelMediaId), false);
  assert.equal((await liveOperations(parallelHuntId)).alerts.photos, 0);
  await assert.rejects(
    reviewPhoto({ mediaId: parallelMediaId, approved: true, reason: 'Premature lane review', requestId: randomUUID(), actor: 'Test organizer' }),
    /not been submitted/i,
  );
  const pending = await submitParallelLane({
    teamId: captain.summary.team.id,
    memberId: captain.summary.member.id,
    runId: parallelRun.runId,
    requestId: randomUUID(),
    mechanicId: 'split-gate',
    laneId: 'north',
    evidence: { mediaId: parallelMediaId },
  });
  assert.equal(pending.status, 'pending_review');
  const pendingReceiptCount = Number((await getPool().query(
    "select count(*)::int as count from hunt_v3.command_receipts where run_id=$1 and operation='parallel_lane_pending_review'",
    [parallelRun.runId],
  )).rows[0].count);
  for (let index = 0; index < 3; index++) {
    assert.deepEqual(await parallelPhotoReviewStatus({
      teamId: captain.summary.team.id,
      memberId: captain.summary.member.id,
      runId: parallelRun.runId,
      mediaId: parallelMediaId,
      mechanicId: 'split-gate',
      laneId: 'north',
    }), { status: 'pending' });
  }
  assert.equal(Number((await getPool().query(
    "select count(*)::int as count from hunt_v3.command_receipts where run_id=$1 and operation='parallel_lane_pending_review'",
    [parallelRun.runId],
  )).rows[0].count), pendingReceiptCount, 'read-only approval polling never grows command receipts');
  const beforeOtherLane = (await getPool().query('select engine_state from hunt_v3.runs where id=$1', [parallelRun.runId])).rows[0].engine_state;
  assert.equal(
    (beforeOtherLane.clockPauses ?? []).some((pause: { reason?: string; endedAt?: string }) => pause.reason === 'review' && !pause.endedAt),
    false,
    'parallel review does not grant free time while a player-action lane remains',
  );
  const codeLane = await submitParallelLane({
    teamId: captain.summary.team.id,
    memberId: scout.summary.member.id,
    runId: parallelRun.runId,
    requestId: randomUUID(),
    mechanicId: 'split-gate',
    laneId: 'south',
    evidence: { value: 'SOUTH-9' },
  });
  assert.equal(codeLane.accepted, true, 'the other lane remains playable while photo review is pending');
  assert.equal(codeLane.remaining, 1);
  const parallelAfterSubmit = (await getPool().query('select engine_state from hunt_v3.runs where id=$1', [parallelRun.runId])).rows[0].engine_state;
  const provisionalParallelPause = parallelAfterSubmit.clockPauses.find(
    (pause: { reason?: string; sourceId?: string; endedAt?: string }) => pause.reason === 'review' && pause.sourceId === parallelMediaId && !pause.endedAt,
  );
  assert.ok(provisionalParallelPause, 'parallel review freezes clocks once it is the sole remaining blocker');
  const parallelScenarioNow = Date.now();
  const parallelRunStart = new Date(parallelScenarioNow - 180_000).toISOString();
  const parallelPastStart = new Date(parallelScenarioNow - 120_000).toISOString();
  provisionalParallelPause.startedAt = parallelPastStart;
  parallelAfterSubmit.startedAt = parallelRunStart;
  parallelAfterSubmit.timer.deadlineAt = new Date(parallelScenarioNow - 60_000).toISOString();
  await getPool().query('update hunt_v3.runs set engine_state=$1,started_at=$2 where id=$3', [parallelAfterSubmit, parallelRunStart, parallelRun.runId]);
  await getPool().query('update hunt_v3.media set submitted_at=$1 where id=$2', [parallelPastStart, parallelMediaId]);
  assert.equal((await pendingPhotoReviews(parallelHuntId)).some(photo => photo.id === parallelMediaId), true);
  assert.equal((await liveOperations(parallelHuntId)).alerts.photos, 1);
  assert.equal(Number((await getPool().query(
    `select count(*)::int as count from hunt_v3.run_events
      where run_id=$1 and actor_member_id=$2 and event_type='parallel_photo_submitted'
        and details->>'mediaId'=$3`,
    [parallelRun.runId, captain.summary.member.id, parallelMediaId],
  )).rows[0].count), 1);
  const resumedParallel = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  assert.equal(resumedParallel.runId, parallelRun.runId, 'parallel moderation also prevents deadline terminalization');
  await reviewPhoto({ mediaId: parallelMediaId, approved: true, reason: 'Lane photo confirmed', requestId: randomUUID(), actor: 'Test organizer' });
  assert.deepEqual(await parallelPhotoReviewStatus({
    teamId: captain.summary.team.id,
    memberId: captain.summary.member.id,
    runId: parallelRun.runId,
    mediaId: parallelMediaId,
    mechanicId: 'split-gate',
    laneId: 'north',
  }), { status: 'approved' });
  const parallelReviewedState = (await getPool().query('select status,engine_state from hunt_v3.runs where id=$1', [parallelRun.runId])).rows[0];
  assert.equal(parallelReviewedState.status, 'active');
  assert.ok(Date.parse(parallelReviewedState.engine_state.timer.deadlineAt) > Date.now());
  assert.equal(
    parallelReviewedState.engine_state.clockPauses.some((pause: { reason?: string; sourceId?: string; endedAt?: string }) => pause.reason === 'review' && pause.sourceId === parallelMediaId && !pause.endedAt),
    false,
  );
  const accepted = await submitParallelLane({
    teamId: captain.summary.team.id,
    memberId: captain.summary.member.id,
    runId: parallelRun.runId,
    requestId: randomUUID(),
    mechanicId: 'split-gate',
    laneId: 'north',
    evidence: { mediaId: parallelMediaId },
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.remaining, 0);
  assert.equal(accepted.mechanicCompleted, true);
});

test('PostgreSQL V3 rejected normal and parallel photos receive no leaderboard-time credit', { skip: !enabled }, async () => {
  const normalHuntId = `v3-photo-reject-${randomUUID().slice(0, 8)}`;
  const normalHunt = definition(normalHuntId);
  normalHunt.settings.minTeamSize = 1;
  normalHunt.settings.parallelMechanics = [];
  normalHunt.checkpoints[0].flow = {
    startNodeId: 'photo',
    nodes: [
      { id: 'photo', type: 'verify_image', prompt: 'Send current evidence.', referenceImages: [], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  };
  await insertHunt(normalHunt);
  const photographer = await registerV3Team({
    requestId: randomUUID(), huntId: normalHuntId, intent: 'create', playerName: 'Reject Photographer',
    teamName: 'Reject Photo Crew', pin: '246811', memberPin: '135711', requestSource: `photo-reject-${normalHuntId}`,
  });
  await approveTestTeam(photographer.summary.team.id);
  const normalRun = await createRun(photographer.summary.team.id, photographer.summary.member.id, randomUUID());
  const normalMediaId = randomUUID();
  const normalTaskStartedAt = await taskStartedAt(normalRun.runId, 'start', 'photo');
  await getPool().query(
    `insert into hunt_v3.media(
      id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,kind,content_type,bytes,content_hash,storage_key,retention,created_at,
      task_started_at)
      values($1,$2,$3,$4,$5,'start','photo','photo','image/jpeg',1,$6,$7,'keep',clock_timestamp()-interval '10 minutes',$8::timestamptz)`,
    [normalMediaId, normalHuntId, photographer.summary.team.id, normalRun.runId, photographer.summary.member.id,
      digest(`normal-reject-${normalMediaId}`), `${normalMediaId}-${randomUUID()}`, normalTaskStartedAt],
  );
  await applyRunCommand(photographer.summary.team.id, photographer.summary.member.id, normalRun.runId, randomUUID(), {
    type: 'submit_photo', checkpointId: 'start', nodeId: 'photo', mediaId: normalMediaId,
  });
  const normalScenarioNow = Date.now();
  const normalStartedAt = new Date(normalScenarioNow - 180_000).toISOString();
  const normalReviewStartedAt = new Date(normalScenarioNow - 120_000).toISOString();
  const normalBeforeReject = (await getPool().query('select engine_state from hunt_v3.runs where id=$1', [normalRun.runId])).rows[0].engine_state;
  normalBeforeReject.startedAt = normalStartedAt;
  normalBeforeReject.clockPauses.find((pause: { sourceId?: string }) => pause.sourceId === normalMediaId).startedAt = normalReviewStartedAt;
  const normalDeadline = normalBeforeReject.timer.deadlineAt;
  await getPool().query('update hunt_v3.runs set engine_state=$1,started_at=$2 where id=$3', [normalBeforeReject, normalStartedAt, normalRun.runId]);
  await getPool().query('update hunt_v3.media set submitted_at=$1 where id=$2', [normalReviewStartedAt, normalMediaId]);
  await reviewPhoto({ mediaId: normalMediaId, approved: false, reason: 'Landmark not visible', requestId: randomUUID(), actor: 'Test organizer' });
  const normalAfterReject = (await getPool().query(
    `select run.engine_state,media.reviewed_at from hunt_v3.runs run join hunt_v3.media media on media.run_id=run.id
      where run.id=$1 and media.id=$2`,
    [normalRun.runId, normalMediaId],
  )).rows[0];
  assert.equal(normalAfterReject.engine_state.timer.deadlineAt, normalDeadline, 'normal rejection does not extend the countdown');
  assert.equal(normalAfterReject.engine_state.clockPauses.some(
    (pause: { sourceId?: string }) => pause.sourceId === normalMediaId,
  ), false, 'normal rejected evidence leaves no credited review interval');
  assert.ok(
    elapsedMilliseconds(normalAfterReject.engine_state, normalStartedAt, new Date(normalAfterReject.reviewed_at).toISOString()) >= 179_000,
    'normal review wait remains in competitive elapsed time',
  );

  const parallelHuntId = `v3-parallel-photo-reject-${randomUUID().slice(0, 8)}`;
  const parallelHunt = definition(parallelHuntId);
  parallelHunt.settings.parallelMechanics = [{
    id: 'split-gate', checkpointId: 'start', nodeId: 'parallel-gate', timeWindowSeconds: 120,
    lanes: [
      { id: 'north', label: 'North photo', type: 'photo' },
      { id: 'south', label: 'South code', type: 'code', code: 'SOUTH-9' },
    ],
  }];
  await insertHunt(parallelHunt);
  const captain = await registerV3Team({
    requestId: randomUUID(), huntId: parallelHuntId, intent: 'create', playerName: 'Reject Captain',
    teamName: 'Reject Parallel Crew', pin: '864211', memberPin: '111119', memberNames: ['Reject Scout'],
    requestSource: `parallel-reject-create-${parallelHuntId}`,
  });
  await approveTestTeam(captain.summary.team.id);
  const scout = await registerV3Team({
    requestId: randomUUID(), huntId: parallelHuntId, intent: 'join', playerName: 'Reject Scout',
    teamCode: captain.summary.team.code, pin: '864211', memberPin: '222229', requestSource: `parallel-reject-join-${parallelHuntId}`,
  });
  const parallelRun = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  const parallelMediaId = randomUUID();
  const parallelTaskStartedAt = await taskStartedAt(parallelRun.runId, 'start', 'parallel-gate');
  await getPool().query(
    `insert into hunt_v3.media(
      id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,parallel_mechanic_id,parallel_lane_id,
      kind,content_type,bytes,content_hash,storage_key,retention,created_at,task_started_at)
      values($1,$2,$3,$4,$5,'start','parallel-gate','split-gate','north','photo','image/jpeg',1,$6,$7,'keep',
        clock_timestamp()-interval '10 minutes',$8::timestamptz)`,
    [parallelMediaId, parallelHuntId, captain.summary.team.id, parallelRun.runId, captain.summary.member.id,
      digest(`parallel-reject-${parallelMediaId}`), `${parallelMediaId}-${randomUUID()}`, parallelTaskStartedAt],
  );
  await submitParallelLane({
    teamId: captain.summary.team.id, memberId: captain.summary.member.id, runId: parallelRun.runId,
    requestId: randomUUID(), mechanicId: 'split-gate', laneId: 'north', evidence: { mediaId: parallelMediaId },
  });
  await submitParallelLane({
    teamId: captain.summary.team.id, memberId: scout.summary.member.id, runId: parallelRun.runId,
    requestId: randomUUID(), mechanicId: 'split-gate', laneId: 'south', evidence: { value: 'SOUTH-9' },
  });
  const parallelScenarioNow = Date.now();
  const parallelStartedAt = new Date(parallelScenarioNow - 180_000).toISOString();
  const parallelReviewStartedAt = new Date(parallelScenarioNow - 120_000).toISOString();
  const parallelBeforeReject = (await getPool().query('select engine_state from hunt_v3.runs where id=$1', [parallelRun.runId])).rows[0].engine_state;
  parallelBeforeReject.startedAt = parallelStartedAt;
  parallelBeforeReject.clockPauses.find((pause: { sourceId?: string }) => pause.sourceId === parallelMediaId).startedAt = parallelReviewStartedAt;
  const parallelDeadline = parallelBeforeReject.timer.deadlineAt;
  await getPool().query('update hunt_v3.runs set engine_state=$1,started_at=$2 where id=$3', [parallelBeforeReject, parallelStartedAt, parallelRun.runId]);
  await getPool().query('update hunt_v3.media set submitted_at=$1 where id=$2', [parallelReviewStartedAt, parallelMediaId]);
  await reviewPhoto({ mediaId: parallelMediaId, approved: false, reason: 'Wrong landmark', requestId: randomUUID(), actor: 'Test organizer' });
  const parallelAfterReject = (await getPool().query(
    `select run.engine_state,media.reviewed_at from hunt_v3.runs run join hunt_v3.media media on media.run_id=run.id
      where run.id=$1 and media.id=$2`,
    [parallelRun.runId, parallelMediaId],
  )).rows[0];
  assert.equal(parallelAfterReject.engine_state.timer.deadlineAt, parallelDeadline, 'parallel rejection does not extend the countdown');
  assert.equal(parallelAfterReject.engine_state.clockPauses.some(
    (pause: { reason?: string; endedAt?: string }) => pause.reason === 'review' && !pause.endedAt,
  ), false, 'parallel rejection removes every provisional review blocker');
  assert.ok(
    elapsedMilliseconds(parallelAfterReject.engine_state, parallelStartedAt, new Date(parallelAfterReject.reviewed_at).toISOString()) >= 179_000,
    'parallel review wait remains in competitive elapsed time',
  );
});

test('PostgreSQL V3 rejects exact photo reuse across teams and retains the digest after media deletion', { skip: !enabled }, async t => {
  const previousDirectory = process.env.MEDIA_DIRECTORY;
  const previousStorage = process.env.MEDIA_STORAGE;
  const directory = await mkdtemp(path.join(tmpdir(), 'hunt-v3-photo-reuse-'));
  process.env.MEDIA_DIRECTORY = directory;
  process.env.MEDIA_STORAGE = 'filesystem';
  t.after(async () => {
    if (previousDirectory === undefined) delete process.env.MEDIA_DIRECTORY;
    else process.env.MEDIA_DIRECTORY = previousDirectory;
    if (previousStorage === undefined) delete process.env.MEDIA_STORAGE;
    else process.env.MEDIA_STORAGE = previousStorage;
    await rm(directory, { recursive: true, force: true });
  });

  const huntId = `v3-photo-reuse-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId);
  hunt.settings.minTeamSize = 1;
  hunt.settings.parallelMechanics = [];
  hunt.checkpoints[0].flow = {
    startNodeId: 'photo',
    nodes: [
      { id: 'photo', type: 'verify_image', prompt: 'Take a fresh photo.', referenceImages: [], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  };
  await insertHunt(hunt);
  const firstTeam = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'First Photographer', teamName: 'First Photo Team',
    pin: '246812', memberPin: '135712', requestSource: `photo-reuse-first-${huntId}`,
  });
  const secondTeam = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'Second Photographer', teamName: 'Second Photo Team',
    pin: '246813', memberPin: '135713', requestSource: `photo-reuse-second-${huntId}`,
  });
  await Promise.all([approveTestTeam(firstTeam.summary.team.id), approveTestTeam(secondTeam.summary.team.id)]);
  await Promise.all([
    createRun(firstTeam.summary.team.id, firstTeam.summary.member.id, randomUUID()),
    createRun(secondTeam.summary.team.id, secondTeam.summary.member.id, randomUUID()),
  ]);
  const image = await sharp({
    create: { width: 40, height: 40, channels: 3, background: '#126c53' },
  }).png().toBuffer();
  const file = () => new File([new Uint8Array(image)], 'fresh-proof.png', { type: 'image/png' });
  const firstMediaId = randomUUID();
  const firstUpload = await uploadV3Photo(firstTeam.summary.team.id, firstTeam.summary.member.id, {
    id: firstMediaId, file: file(), checkpointId: 'start', nodeId: 'photo',
  });
  assert.deepEqual(
    await uploadV3Photo(firstTeam.summary.team.id, firstTeam.summary.member.id, {
      id: firstMediaId, file: file(), checkpointId: 'start', nodeId: 'photo',
    }),
    firstUpload,
    'retrying the same upload ID and owner remains idempotent',
  );
  await assert.rejects(
    uploadV3Photo(secondTeam.summary.team.id, secondTeam.summary.member.id, {
      id: randomUUID(), file: file(), checkpointId: 'start', nodeId: 'photo',
    }),
    /exact photo was already used/i,
    'another team cannot recycle the same normalized image bytes',
  );
  const registeredHash = (await getPool().query(
    'select content_hash from hunt_v3.photo_evidence_hashes where hunt_id=$1',
    [huntId],
  )).rows[0].content_hash;
  const firstStorageKey = (await getPool().query(
    'select storage_key from hunt_v3.media where id=$1',
    [firstMediaId],
  )).rows[0].storage_key;
  await getPool().query('delete from hunt_v3.media where id=$1', [firstMediaId]);
  await assert.rejects(
    uploadV3Photo(secondTeam.summary.team.id, secondTeam.summary.member.id, {
      id: firstMediaId, file: file(), checkpointId: 'start', nodeId: 'photo',
    }),
    /exact photo was already used/i,
    'reusing the original upload ID cannot bypass cross-team ownership after media retention',
  );
  await assert.rejects(
    uploadV3Photo(secondTeam.summary.team.id, secondTeam.summary.member.id, {
      id: randomUUID(), file: file(), checkpointId: 'start', nodeId: 'photo',
    }),
    /exact photo was already used/i,
    'media retention cannot erase the event-wide anti-reuse digest',
  );
  assert.equal((await getPool().query(
    'select count(*)::int as count from hunt_v3.photo_evidence_hashes where hunt_id=$1 and content_hash=$2',
    [huntId, registeredHash],
  )).rows[0].count, 1);
  assert.equal((await readdir(directory)).length, 1, 'rejected reuse does not create an orphan media object');
  await getPool().query('delete from hunt_v3.media_deletions where storage_key=$1', [firstStorageKey]);
});

test('PostgreSQL V3 terminal photo reviews finalize evidence without resurrecting gameplay', { skip: !enabled }, async () => {
  const huntId = `v3-terminal-photo-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId);
  hunt.settings.minTeamSize = 1;
  hunt.settings.parallelMechanics = [];
  hunt.checkpoints[0].flow = {
    startNodeId: 'photo',
    nodes: [
      { id: 'photo', type: 'verify_image', prompt: 'Send evidence.', referenceImages: [], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  };
  await insertHunt(hunt);
  const player = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'Terminal Player', teamName: 'Terminal Crew',
    pin: '640286', memberPin: '357913', requestSource: `terminal-photo-${huntId}`,
  });
  await approveTestTeam(player.summary.team.id);
  const run = await createRun(player.summary.team.id, player.summary.member.id, randomUUID());
  const mediaId = randomUUID();
  const mediaTaskStartedAt = await taskStartedAt(run.runId, 'start', 'photo');
  await getPool().query(
    `insert into hunt_v3.media(
      id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,kind,content_type,bytes,content_hash,storage_key,retention,
      task_started_at)
      values($1,$2,$3,$4,$5,'start','photo','photo','image/jpeg',1,$6,$7,'after_review',$8::timestamptz)`,
    [mediaId, huntId, player.summary.team.id, run.runId, player.summary.member.id, 'e'.repeat(64),
      `${mediaId}-${randomUUID()}`, mediaTaskStartedAt],
  );
  await applyRunCommand(player.summary.team.id, player.summary.member.id, run.runId, randomUUID(), {
    type: 'submit_photo', checkpointId: 'start', nodeId: 'photo', mediaId,
  });
  const before = (await getPool().query(
    `select score,progress,completed_at,
      (select count(*)::int from hunt_v3.score_ledger where run_id=$1) as ledger_count,
      (select count(*)::int from hunt_v3.run_contributions where run_id=$1) as contribution_count
      from hunt_v3.runs where id=$1`,
    [run.runId],
  )).rows[0];
  await getPool().query(
    "update hunt_v3.runs set status='abandoned',eligible=false,ineligibility_reason='test terminal review' where id=$1",
    [run.runId],
  );
  const reviewInput = { mediaId, approved: true, reason: 'Late organizer approval', requestId: randomUUID(), actor: 'Test organizer' };
  const result = await reviewPhoto(reviewInput);
  assert.deepEqual(
    { applied: result.applied, approved: result.approved, requestedApproval: result.requestedApproval, terminalStatus: result.terminalStatus },
    { applied: false, approved: false, requestedApproval: true, terminalStatus: 'abandoned' },
  );
  assert.deepEqual(await reviewPhoto(reviewInput), result, 'the terminal disposition is exactly replayable');
  const after = (await getPool().query(
    `select run.status,run.score,run.progress,run.completed_at,run.engine_state,media.review_status,
      (select count(*)::int from hunt_v3.score_ledger where run_id=$1) as ledger_count,
      (select count(*)::int from hunt_v3.run_contributions where run_id=$1) as contribution_count
      from hunt_v3.runs run join hunt_v3.media media on media.run_id=run.id and media.id=$2
      where run.id=$1`,
    [run.runId, mediaId],
  )).rows[0];
  assert.equal(after.status, 'abandoned');
  assert.equal(after.review_status, 'rejected');
  assert.equal(after.score, before.score);
  assert.equal(after.progress, before.progress);
  assert.equal(after.completed_at, before.completed_at);
  assert.equal(after.ledger_count, before.ledger_count);
  assert.equal(after.contribution_count, before.contribution_count);
  assert.equal(
    after.engine_state.clockPauses.some((pause: { reason?: string; sourceId?: string; endedAt?: string }) =>
      pause.reason === 'review' && pause.sourceId === mediaId && !pause.endedAt),
    false,
    'terminal review closes the provisional clock interval without changing gameplay state',
  );
  assert.equal((await pendingPhotoReviews(huntId)).some(photo => photo.id === mediaId), false);
});
