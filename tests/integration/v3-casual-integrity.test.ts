import '../isolated-database';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getPool } from '../../lib/server/db';
import {
  changeTeamCompetitionStatus,
  createOrganizerTeam,
  controlRunGameplay,
  liveOperations,
  reviewPhoto,
  setHuntLifecycle,
  setRegistrationOpen,
} from '../../lib/server/v3/operations';
import { teamLeaderboards } from '../../lib/server/v3/leaderboards';
import { activePhotoTask } from '../../lib/server/v3/media';
import { submitParallelLane } from '../../lib/server/v3/parallel';
import { privateRecognition, saveRecognitionVote } from '../../lib/server/v3/recognition';
import { registerV3Team } from '../../lib/server/v3/registration';
import { applyRunCommand, createRun, currentRunView } from '../../lib/server/v3/runs';
import { digest } from '../../lib/server/security';
import { validateFairness } from '../../lib/v3/fairness';
import type { IntegrityPolicy, V3Definition } from '../../lib/v3/types';

const enabled = Boolean(process.env.DATABASE_URL);

function definition(id: string, integrityPolicy: IntegrityPolicy): V3Definition {
  return {
    schemaVersion: 3,
    id,
    version: 1,
    title: 'Casual integrity integration',
    settings: {
      mode: 'sequential',
      map: 'none',
      rules: 'Play fairly and celebrate your crew.',
      minTeamSize: 1,
      maxTeamSize: 8,
      sessionDurationSeconds: 3600,
      registrationOpen: true,
      completionMessage: 'Finished.',
      photoRetention: 'after_verification',
      registrationMode: 'self-serve',
      integrityPolicy,
      runPolicy: { mode: 'unlimited' },
      leaderboardPolicy: {
        bestRunRule: 'score_then_time_then_completion',
        mainBoardEnabled: true,
        replayBoardEnabled: true,
        replayBoardPublic: false,
        timeVisibility: 'after_second_eligible_run',
        showProgress: true,
      },
      publicBoard: {
        enabled: false,
        status: 'live',
        teamIdentity: 'code_only',
        columns: ['rank', 'team_code', 'points'],
      },
      socialShare: { enabled: false, allowPersonalTitle: false },
      recognition: {
        enabled: true,
        peerVotingEnabled: true,
        votingWindowMinutes: 60,
        dataWeight: 0.7,
        peerWeight: 0.3,
      },
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
        answerCode: { type: 'code', alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', length: 8 },
        alphaCode: { type: 'code', alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', length: 8 },
        betaCode: { type: 'code', alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', length: 8 },
      },
      fairnessPolicy: {
        minimumDistinctPlans: 1,
        durationToleranceMinutes: 0,
        maxResolvedRoutes: 20,
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
          { id: 'alpha', label: 'Alpha code', type: 'code', code: '{{alphaCode}}' },
          { id: 'beta', label: 'Beta code', type: 'code', code: '{{betaCode}}' },
        ],
      }],
    },
    checkpoints: [
      {
        id: 'start',
        title: 'Start',
        basePoints: 10,
        required: true,
        hints: [],
        flow: {
          startNodeId: 'answer',
          nodes: [
            { id: 'answer', type: 'verify_answer', prompt: 'Enter the answer.', answers: ['{{answerCode}}'], next: 'parallel-gate' },
            { id: 'parallel-gate', type: 'verify_organizer', prompt: 'Two teammates complete linked lanes.', next: 'start-done' },
            { id: 'start-done', type: 'complete' },
          ],
        },
      },
      {
        id: 'finale',
        title: 'Finale',
        basePoints: 10,
        required: true,
        hints: [],
        flow: {
          startNodeId: 'finish',
          nodes: [
            { id: 'finish', type: 'show_text', text: 'Finish together.', next: 'finish-done' },
            { id: 'finish-done', type: 'complete' },
          ],
        },
      },
    ],
  };
}

async function insertHunt(value: V3Definition, status: 'ready' | 'live' = 'live') {
  const fairness = validateFairness(value);
  assert.equal(fairness.valid, true, JSON.stringify(fairness.issues));
  await getPool().query(
    `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,registration_open,latest_version,settings)
      values($1,$2,$1,$3,$4,true,1,$5)`,
    [value.id, value.title, status, value.settings.registrationMode.replaceAll('-', '_'), value.settings],
  );
  await getPool().query(
    `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,1,$2,$3,$4,$5)`,
    [value.id, value, 'a'.repeat(64), { valid: true, issues: [] }, fairness],
  );
}

async function createSelfServe(huntId: string, playerName: string, source: string) {
  return registerV3Team({
    requestId: randomUUID(),
    huntId,
    intent: 'create',
    playerName,
    teamName: `${playerName} Crew`,
    pin: '123456',
    memberPin: '654321',
    requestSource: source,
  });
}

async function joinTeam(input: {
  huntId: string;
  teamCode: string;
  playerName: string;
  memberPin: string;
  source: string;
  requestId?: string;
}) {
  return registerV3Team({
    requestId: input.requestId ?? randomUUID(),
    huntId: input.huntId,
    intent: 'join',
    playerName: input.playerName,
    teamCode: input.teamCode,
    pin: '123456',
    memberPin: input.memberPin,
    requestSource: input.source,
  });
}

async function finishWithLateMember(input: {
  teamId: string;
  captainId: string;
  lateId: string;
  runId: string;
}) {
  const variables = (await getPool().query(
    `select resolved_variables->>'answerCode' as answer_code,
      resolved_variables->>'alphaCode' as alpha_code,resolved_variables->>'betaCode' as beta_code
      from hunt_v3.runs where id=$1`,
    [input.runId],
  )).rows[0];
  const answerCode = String(variables.answer_code);
  const answer = await applyRunCommand(input.teamId, input.lateId, input.runId, randomUUID(), {
    type: 'verify', checkpointId: 'start', nodeId: 'answer', value: answerCode,
  });
  assert.equal(answer.feedback.status, 'accepted');
  assert.equal(answer.view.node?.id, 'parallel-gate');
  const alpha = await submitParallelLane({
    teamId: input.teamId,
    memberId: input.lateId,
    runId: input.runId,
    requestId: randomUUID(),
    mechanicId: 'split-gate',
    laneId: 'alpha',
    evidence: { value: variables.alpha_code },
  });
  assert.equal(alpha.accepted, true);
  assert.equal(alpha.remaining, 1);
  const beta = await submitParallelLane({
    teamId: input.teamId,
    memberId: input.captainId,
    runId: input.runId,
    requestId: randomUUID(),
    mechanicId: 'split-gate',
    laneId: 'beta',
    evidence: { value: variables.beta_code },
  });
  assert.equal(beta.accepted, true);
  assert.equal(beta.view.checkpoint?.id, 'finale');
  const finished = await applyRunCommand(input.teamId, input.captainId, input.runId, randomUUID(), {
    type: 'continue', checkpointId: 'finale', nodeId: 'finish',
  });
  assert.equal(finished.view.status, 'completed');
}

async function waitForLockWaiters(blockerPid: number, expected: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = Number((await getPool().query(
      `select count(*)::int as count from pg_stat_activity
        where datname=current_database() and pid<>$1 and wait_event_type='Lock'`,
      [blockerPid],
    )).rows[0].count);
    if (waiting >= expected) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Expected ${expected} transaction(s) to wait at the hunt lock.`);
}

async function taskStartedAt(runId: string, checkpointId: string, nodeId: string) {
  const startedAt = (await getPool().query(
    `select engine_state #>> array['checkpoints',$2,'nodes',$3,'startedAt'] as started_at
      from hunt_v3.runs where id=$1`,
    [runId, checkpointId, nodeId],
  )).rows[0]?.started_at as string | undefined;
  assert.ok(startedAt);
  return startedAt;
}

before(async () => {
  if (!enabled) return;
  await getPool().query(await readFile(new URL('../../database/v3.sql', import.meta.url), 'utf8'));
});

after(async () => {
  if (enabled) await getPool().end();
});

test('automatic self-serve starts immediately while organizer approval remains a real gate', { skip: !enabled }, async () => {
  const automaticHuntId = `v3-auto-approval-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(automaticHuntId, {
    locationVerification: 'gps_only',
    selfServeApproval: 'automatic',
    rosterParticipation: 'flexible_fixed_scoring',
  }));
  const automatic = await createSelfServe(automaticHuntId, 'Auto Captain', `auto-${automaticHuntId}`);
  assert.equal(automatic.summary.team.approvalStatus, 'approved');
  assert.equal('approvalMethod' in automatic.summary.team, false, 'player summaries do not reveal organizer integrity configuration');
  assert.deepEqual(
    (await getPool().query(
      'select approval_status,approval_method from hunt_v3.teams where id=$1',
      [automatic.summary.team.id],
    )).rows[0],
    { approval_status: 'approved', approval_method: 'automatic' },
  );
  assert.ok((await createRun(automatic.summary.team.id, automatic.summary.member.id, randomUUID())).runId);

  const manualHuntId = `v3-manual-approval-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(manualHuntId, {
    locationVerification: 'strict',
    selfServeApproval: 'organizer',
    rosterParticipation: 'freeze_at_run_start',
  }));
  const manual = await createSelfServe(manualHuntId, 'Manual Captain', `manual-${manualHuntId}`);
  assert.equal(manual.summary.team.approvalStatus, 'pending');
  await assert.rejects(
    createRun(manual.summary.team.id, manual.summary.member.id, randomUUID()),
    /organizer's go-ahead/i,
  );
});

test('tightening automatic approval to organizer review fails closed until a named approval', { skip: !enabled }, async () => {
  const huntId = `v3-approval-transition-${randomUUID().slice(0, 8)}`;
  const automaticDefinition = definition(huntId, {
    locationVerification: 'gps_only',
    selfServeApproval: 'automatic',
    rosterParticipation: 'flexible_fixed_scoring',
  });
  await insertHunt(automaticDefinition);
  const captain = await createSelfServe(huntId, 'Transition Captain', `transition-create-${huntId}`);
  assert.equal(captain.summary.team.approvalStatus, 'approved');

  const reviewedDefinition = structuredClone(automaticDefinition);
  reviewedDefinition.version = 2;
  reviewedDefinition.settings.integrityPolicy.selfServeApproval = 'organizer';
  const reviewedFairness = validateFairness(reviewedDefinition);
  assert.equal(reviewedFairness.valid, true, JSON.stringify(reviewedFairness.issues));
  await getPool().query(
    `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,2,$2,$3,$4,$5)`,
    [huntId, reviewedDefinition, 'c'.repeat(64), { valid: true, issues: [] }, reviewedFairness],
  );
  await getPool().query(
    'update hunt_v3.hunts set latest_version=2,settings=$2 where id=$1',
    [huntId, reviewedDefinition.settings],
  );

  const refreshed = await joinTeam({
    huntId,
    teamCode: captain.summary.team.code,
    playerName: 'Transition Captain',
    memberPin: '654321',
    source: `transition-refresh-${huntId}`,
  });
  assert.equal(refreshed.summary.team.approvalStatus, 'pending');
  assert.equal('approvalMethod' in refreshed.summary.team, false);
  await assert.rejects(
    createRun(captain.summary.team.id, captain.summary.member.id, randomUUID()),
    /organizer's go-ahead/i,
  );
  const admin = await liveOperations(huntId);
  assert.equal(admin.hunts[0].integrityPolicy.selfServeApproval, 'organizer');
  assert.equal(admin.teams[0].approvalStatus, 'pending');
  assert.equal(admin.teams[0].approvalMethod, 'automatic');
  await changeTeamCompetitionStatus({
    huntId,
    teamId: captain.summary.team.id,
    action: 'approve',
    reason: 'Roster reviewed after event policy tightened',
    expectedRevision: 1,
    requestId: randomUUID(),
    actor: 'Transition organizer',
    sessionHash: 'd'.repeat(64),
  });
  assert.ok((await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID())).runId);
  assert.deepEqual(
    (await getPool().query(
      'select approval_status,approval_method from hunt_v3.teams where id=$1',
      [captain.summary.team.id],
    )).rows[0],
    { approval_status: 'approved', approval_method: 'organizer' },
  );
});

test('relaxing organizer approval to automatic promotes a pending team once at run start', { skip: !enabled }, async () => {
  const huntId = `v3-approval-relaxed-${randomUUID().slice(0, 8)}`;
  const reviewedDefinition = definition(huntId, {
    locationVerification: 'gps_photo',
    selfServeApproval: 'organizer',
    rosterParticipation: 'freeze_at_run_start',
  });
  await insertHunt(reviewedDefinition);
  const captain = await createSelfServe(huntId, 'Relaxed Captain', `relaxed-create-${huntId}`);
  assert.deepEqual(
    (await getPool().query(
      'select approval_status,approval_method,competition_revision from hunt_v3.teams where id=$1',
      [captain.summary.team.id],
    )).rows[0],
    { approval_status: 'pending', approval_method: null, competition_revision: 1 },
  );

  const automaticDefinition = structuredClone(reviewedDefinition);
  automaticDefinition.version = 2;
  automaticDefinition.settings.integrityPolicy = {
    locationVerification: 'gps_only',
    selfServeApproval: 'automatic',
    rosterParticipation: 'flexible_fixed_scoring',
  };
  const automaticFairness = validateFairness(automaticDefinition);
  assert.equal(automaticFairness.valid, true, JSON.stringify(automaticFairness.issues));
  await getPool().query(
    `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,2,$2,$3,$4,$5)`,
    [huntId, automaticDefinition, '9'.repeat(64), { valid: true, issues: [] }, automaticFairness],
  );
  await getPool().query(
    'update hunt_v3.hunts set latest_version=2,settings=$2 where id=$1',
    [huntId, automaticDefinition.settings],
  );

  const refreshed = await joinTeam({
    huntId,
    teamCode: captain.summary.team.code,
    playerName: 'Relaxed Captain',
    memberPin: '654321',
    source: `relaxed-refresh-${huntId}`,
  });
  assert.equal(refreshed.summary.team.approvalStatus, 'approved',
    'the player projection reflects the active automatic policy without exposing its implementation');
  assert.equal('approvalMethod' in refreshed.summary.team, false);

  const requestId = randomUUID();
  const started = await createRun(captain.summary.team.id, captain.summary.member.id, requestId);
  assert.ok(started.runId);
  assert.deepEqual(
    (await getPool().query(
      'select approval_status,approval_method,competition_revision from hunt_v3.teams where id=$1',
      [captain.summary.team.id],
    )).rows[0],
    { approval_status: 'approved', approval_method: 'automatic', competition_revision: 2 },
    'run start persists one auditable automatic promotion',
  );
  const audit = (await getPool().query(
    `select before_state,after_state,details from hunt_v3.admin_events
      where hunt_id=$1 and team_id=$2 and action='team_auto_approved'`,
    [huntId, captain.summary.team.id],
  )).rows;
  assert.deepEqual(audit, [{
    before_state: { approvalStatus: 'pending', approvalMethod: null, competitionRevision: 1 },
    after_state: { approvalStatus: 'approved', approvalMethod: 'automatic', competitionRevision: 2 },
    details: { policy: 'automatic', source: 'run_start' },
  }]);
  assert.equal(
    (await createRun(captain.summary.team.id, captain.summary.member.id, requestId)).runId,
    started.runId,
    'an exact create replay does not repeat the approval transition',
  );
  assert.equal(Number((await getPool().query(
    "select count(*)::int as count from hunt_v3.admin_events where hunt_id=$1 and team_id=$2 and action='team_auto_approved'",
    [huntId, captain.summary.team.id],
  )).rows[0].count), 1);
  assert.equal((await getPool().query(
    'select competition_revision from hunt_v3.teams where id=$1',
    [captain.summary.team.id],
  )).rows[0].competition_revision, 2);
});

test('organizer approval stays team-level when declared and new members check in', { skip: !enabled }, async () => {
  const huntId = `v3-team-level-approval-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(huntId, {
    locationVerification: 'gps_only',
    selfServeApproval: 'organizer',
    rosterParticipation: 'flexible_fixed_scoring',
  }));
  const captain = await registerV3Team({
    requestId: randomUUID(),
    huntId,
    intent: 'create',
    playerName: 'Approved Captain',
    teamName: 'Approved Crew',
    memberNames: ['Declared Scout'],
    pin: '123456',
    memberPin: '654321',
    requestSource: `team-level-create-${huntId}`,
  });
  await changeTeamCompetitionStatus({
    huntId,
    teamId: captain.summary.team.id,
    action: 'approve',
    reason: 'Approved this crew for play',
    expectedRevision: 1,
    requestId: randomUUID(),
    actor: 'Approval organizer',
    sessionHash: '7'.repeat(64),
  });

  const declared = await joinTeam({
    huntId,
    teamCode: captain.summary.team.code,
    playerName: 'Declared Scout',
    memberPin: '224466',
    source: `team-level-declared-${huntId}`,
  });
  assert.deepEqual(
    (await getPool().query(
      'select approval_status,approval_method,competition_revision from hunt_v3.teams where id=$1',
      [captain.summary.team.id],
    )).rows[0],
    { approval_status: 'approved', approval_method: 'organizer', competition_revision: 3 },
    'the first claim of a predeclared identity advances the audit revision without revoking team approval',
  );
  const run = await createRun(captain.summary.team.id, declared.summary.member.id, randomUUID());

  const late = await joinTeam({
    huntId,
    teamCode: captain.summary.team.code,
    playerName: 'New Helper',
    memberPin: '335577',
    source: `team-level-new-${huntId}`,
  });
  assert.equal(late.summary.activeRun?.id, run.runId);
  assert.deepEqual(
    (await getPool().query(
      'select approval_status,approval_method,competition_revision from hunt_v3.teams where id=$1',
      [captain.summary.team.id],
    )).rows[0],
    { approval_status: 'approved', approval_method: 'organizer', competition_revision: 4 },
    'a newly added flexible participant advances the audit revision without revoking team approval',
  );
  assert.equal(
    (await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID())).runId,
    run.runId,
    'team-level approval remains sufficient to resume the active run',
  );
});

test('flexible late members act immediately and receive verified contribution credit', { skip: !enabled }, async () => {
  const huntId = `v3-flexible-roster-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(huntId, {
    locationVerification: 'gps_only',
    selfServeApproval: 'automatic',
    rosterParticipation: 'flexible',
  }));
  const captain = await createSelfServe(huntId, 'Flexible Captain', `flex-create-${huntId}`);
  const run = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  const late = await joinTeam({
    huntId,
    teamCode: captain.summary.team.code,
    playerName: 'Flexible Scout',
    memberPin: '222222',
    source: `flex-late-${huntId}`,
  });
  assert.equal(late.summary.activeRun?.id, run.runId);
  const playerJson = JSON.stringify(late.summary);
  for (const privateField of ['approvalMethod', 'integrityPolicy', 'locationVerification', 'selfServeApproval', 'rosterParticipation']) {
    assert.equal(playerJson.includes(privateField), false, `player session redacts ${privateField}`);
  }
  assert.equal((await currentRunView(captain.summary.team.id, late.summary.member.id, run.runId)).runId, run.runId);
  await finishWithLateMember({
    teamId: captain.summary.team.id,
    captainId: captain.summary.member.id,
    lateId: late.summary.member.id,
    runId: run.runId,
  });
  assert.equal((await getPool().query(
    'select contribution_eligible from hunt_v3.run_members where run_id=$1 and member_id=$2',
    [run.runId, late.summary.member.id],
  )).rows[0].contribution_eligible, true);
  assert.ok(Number((await getPool().query(
    'select coalesce(sum(credit),0) as credit from hunt_v3.run_contributions where run_id=$1 and member_id=$2',
    [run.runId, late.summary.member.id],
  )).rows[0].credit) > 0);
  const board = await privateRecognition(captain.summary.team.id, captain.summary.member.id, run.runId);
  assert.ok(board.standings.some(member => member.teamMemberId === late.summary.member.id));
  assert.ok(board.results.some(result => result.memberId === late.summary.member.id));
  const leaderboard = await teamLeaderboards(huntId, captain.summary.team.id);
  assert.equal(leaderboard.main.entries.some(entry => entry.teamCode === captain.summary.team.code), true,
    'an automatically approved team can earn a ranked result');
  assert.equal((await saveRecognitionVote({
    teamId: captain.summary.team.id,
    memberId: captain.summary.member.id,
    runId: run.runId,
    requestId: randomUUID(),
    recipientMemberId: late.summary.member.id,
    category: 'crew_energy',
    subtype: 'helping_hand',
    requestSource: `flex-vote-${huntId}`,
  })).saved, true);
});

test('fixed-scoring late members can progress but cannot receive contribution or recognition records', { skip: !enabled }, async () => {
  const huntId = `v3-fixed-roster-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(huntId, {
    locationVerification: 'gps_only',
    selfServeApproval: 'automatic',
    rosterParticipation: 'flexible_fixed_scoring',
  }));
  const captain = await createSelfServe(huntId, 'Fixed Captain', `fixed-create-${huntId}`);
  const run = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  const late = await joinTeam({
    huntId,
    teamCode: captain.summary.team.code,
    playerName: 'Fixed Helper',
    memberPin: '333333',
    source: `fixed-late-${huntId}`,
  });
  assert.equal(late.summary.activeRun?.id, run.runId, 'late fixed-scoring members still join the live attempt');
  await finishWithLateMember({
    teamId: captain.summary.team.id,
    captainId: captain.summary.member.id,
    lateId: late.summary.member.id,
    runId: run.runId,
  });
  assert.deepEqual(
    (await getPool().query(
      `select contribution_eligible,
        (select count(*)::int from hunt_v3.run_contributions contribution
          where contribution.run_id=participant.run_id and contribution.member_id=participant.member_id) as contributions
        from hunt_v3.run_members participant where run_id=$1 and member_id=$2`,
      [run.runId, late.summary.member.id],
    )).rows[0],
    { contribution_eligible: false, contributions: 0 },
    'normal verifier and parallel-lane progression both skip personal credit for a fixed-scoring late member',
  );
  const board = await privateRecognition(captain.summary.team.id, late.summary.member.id, run.runId);
  assert.equal(board.standings.some(member => member.teamMemberId === late.summary.member.id), false);
  assert.equal(board.results.some(result => result.memberId === late.summary.member.id), false);
  assert.ok(board.voting);
  assert.equal(board.voting!.teammates.some(member => member.teamMemberId === late.summary.member.id), false);
  assert.equal((await saveRecognitionVote({
    teamId: captain.summary.team.id,
    memberId: late.summary.member.id,
    runId: run.runId,
    requestId: randomUUID(),
    recipientMemberId: captain.summary.member.id,
    category: 'crew_energy',
    subtype: 'helping_hand',
    requestSource: `fixed-vote-out-${huntId}`,
  })).saved, true, 'a helper may still celebrate an eligible teammate');
  await assert.rejects(
    saveRecognitionVote({
      teamId: captain.summary.team.id,
      memberId: captain.summary.member.id,
      runId: run.runId,
      requestId: randomUUID(),
      recipientMemberId: late.summary.member.id,
      category: 'crew_energy',
      subtype: 'helping_hand',
      requestSource: `fixed-vote-in-${huntId}`,
    }),
    /eligible for crew recognition/i,
  );
  await assert.rejects(
    getPool().query(
      `insert into hunt_v3.run_contributions(
        run_id,team_id,member_id,source_key,category,credit,evidence)
        values($1,$2,$3,$4,'team_spark',1,'{}'::jsonb)`,
      [run.runId, captain.summary.team.id, late.summary.member.id, `manual-${randomUUID()}`],
    ),
    /not eligible for contribution recognition/i,
    'the database rejects a future code path that tries to manufacture credit',
  );
  await assert.rejects(
    getPool().query(
      `insert into hunt_v3.recognition_votes(
        run_id,team_id,voter_member_id,recipient_member_id,revision,category,subtype,answer_path)
        values($1,$2,$3,$4,1,'crew_energy','helping_hand',$5::jsonb)`,
      [run.runId, captain.summary.team.id, captain.summary.member.id, late.summary.member.id,
        JSON.stringify(['crew_energy', late.summary.member.id, 'helping_hand'])],
    ),
    /cannot receive recognition/i,
    'the database rejects a direct peer vote for a fixed-scoring participant',
  );
  await assert.rejects(
    getPool().query(
      `insert into hunt_v3.recognition_results(
        run_id,team_id,member_id,revision,headline_title,data_title,evidence_summary,peer_summary,
        contribution_score,peer_score,server_weight,peer_weight,calculation_version)
        values($1,$2,$3,1,'Manufactured title','Manufactured data','{}','{}',0,0,0.7,0.3,'test')`,
      [run.runId, captain.summary.team.id, late.summary.member.id],
    ),
    /not eligible for contribution recognition/i,
    'the database rejects a direct calculated result for a fixed-scoring participant',
  );
  const captainResultId = (await getPool().query(
    `select id from hunt_v3.recognition_results where run_id=$1 and member_id=$2
      order by revision desc,id desc limit 1`,
    [run.runId, captain.summary.member.id],
  )).rows[0]?.id;
  assert.ok(captainResultId);
  await assert.rejects(
    getPool().query(
      `insert into hunt_v3.recognition_overrides(
        run_id,team_id,member_id,result_id,headline_title,reason,organizer_actor)
        values($1,$2,$3,$4,'Manufactured override','Direct eligibility probe','Integration organizer')`,
      [run.runId, captain.summary.team.id, late.summary.member.id, captainResultId],
    ),
    /not eligible for contribution recognition/i,
    'the database rejects a direct organizer override targeting a fixed-scoring participant',
  );
  await assert.rejects(
    getPool().query(
      'update hunt_v3.run_members set contribution_eligible=true where run_id=$1 and member_id=$2',
      [run.runId, late.summary.member.id],
    ),
    /append-only/i,
    'snapshot identity and eligibility are immutable after enrollment',
  );
  await assert.rejects(
    getPool().query(
      'delete from hunt_v3.run_members where run_id=$1 and member_id=$2',
      [run.runId, late.summary.member.id],
    ),
    /append-only/i,
    'a run-member snapshot cannot be deleted to erase its fixed-scoring eligibility audit',
  );
});

test('fixed-scoring late photo approval progresses the team without manufacturing personal credit', { skip: !enabled }, async () => {
  const huntId = `v3-fixed-photo-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId, {
    locationVerification: 'gps_only',
    selfServeApproval: 'automatic',
    rosterParticipation: 'flexible_fixed_scoring',
  });
  hunt.settings.parallelMechanics = [];
  hunt.settings.variableGenerators = {};
  hunt.checkpoints[0].flow = {
    startNodeId: 'photo',
    nodes: [
      { id: 'photo', type: 'verify_image', prompt: 'Send a fresh landmark photo.', referenceImages: [], next: 'start-done' },
      { id: 'start-done', type: 'complete' },
    ],
  };
  await insertHunt(hunt);
  const captain = await createSelfServe(huntId, 'Photo Captain', `photo-create-${huntId}`);
  const run = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  const late = await joinTeam({
    huntId,
    teamCode: captain.summary.team.code,
    playerName: 'Photo Helper',
    memberPin: '343434',
    source: `photo-late-${huntId}`,
  });
  const mediaId = randomUUID();
  await getPool().query(
    `insert into hunt_v3.media(
      id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,kind,content_type,bytes,content_hash,storage_key,retention,
      task_started_at)
      values($1,$2,$3,$4,$5,'start','photo','photo','image/jpeg',1,$6,$7,'keep',$8::timestamptz)`,
    [mediaId, huntId, captain.summary.team.id, run.runId, late.summary.member.id,
      'f'.repeat(64), `${mediaId}-${randomUUID()}`, await taskStartedAt(run.runId, 'start', 'photo')],
  );
  const submitted = await applyRunCommand(captain.summary.team.id, late.summary.member.id, run.runId, randomUUID(), {
    type: 'submit_photo', checkpointId: 'start', nodeId: 'photo', mediaId,
  });
  assert.equal(submitted.feedback.status, 'accepted');
  const reviewed = await reviewPhoto({
    mediaId,
    approved: true,
    reason: 'Fresh landmark evidence confirmed',
    requestId: randomUUID(),
    actor: 'Photo organizer',
  });
  assert.equal(reviewed.approved, true);
  assert.equal((await currentRunView(captain.summary.team.id, late.summary.member.id, run.runId)).checkpoint?.id, 'finale');
  assert.equal(Number((await getPool().query(
    'select count(*)::int as count from hunt_v3.run_contributions where run_id=$1 and member_id=$2',
    [run.runId, late.summary.member.id],
  )).rows[0].count), 0);
});

test('photo review fails neutrally if retention removes evidence while the run lock is queued', { skip: !enabled }, async () => {
  const huntId = `v3-photo-retention-race-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId, {
    locationVerification: 'gps_only',
    selfServeApproval: 'automatic',
    rosterParticipation: 'flexible',
  });
  hunt.settings.parallelMechanics = [];
  hunt.settings.variableGenerators = {};
  hunt.checkpoints[0].flow = {
    startNodeId: 'photo',
    nodes: [
      { id: 'photo', type: 'verify_image', prompt: 'Send a fresh landmark photo.', referenceImages: [], next: 'start-done' },
      { id: 'start-done', type: 'complete' },
    ],
  };
  await insertHunt(hunt);
  const captain = await createSelfServe(huntId, 'Race Captain', `photo-race-create-${huntId}`);
  const run = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  const mediaId = randomUUID();
  await getPool().query(
    `insert into hunt_v3.media(
      id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,kind,content_type,bytes,content_hash,storage_key,retention,
      task_started_at)
      values($1,$2,$3,$4,$5,'start','photo','photo','image/jpeg',1,$6,$7,'after_review',$8::timestamptz)`,
    [mediaId, huntId, captain.summary.team.id, run.runId, captain.summary.member.id,
      'd'.repeat(64), `${mediaId}-${randomUUID()}`, await taskStartedAt(run.runId, 'start', 'photo')],
  );
  await applyRunCommand(captain.summary.team.id, captain.summary.member.id, run.runId, randomUUID(), {
    type: 'submit_photo', checkpointId: 'start', nodeId: 'photo', mediaId,
  });

  const blocker = await getPool().connect();
  let blockerOpen = false;
  try {
    await blocker.query('begin');
    blockerOpen = true;
    await blocker.query('select id from hunt_v3.runs where id=$1 for update', [run.runId]);
    const blockerPid = Number((await blocker.query('select pg_backend_pid() as pid')).rows[0].pid);
    const queuedReview = reviewPhoto({
      mediaId,
      approved: true,
      reason: 'Retention race regression',
      requestId: randomUUID(),
      actor: 'Race organizer',
    });
    void queuedReview.catch(() => undefined);
    await waitForLockWaiters(blockerPid, 1);
    await getPool().query('delete from hunt_v3.media where id=$1', [mediaId]);
    await blocker.query('commit');
    blockerOpen = false;
    await assert.rejects(queuedReview, /Photo not found/i);
    assert.equal(Number((await getPool().query(
      `select count(*)::int as count from hunt_v3.command_receipts
        where scope_key=$1 and operation like '%photo_review%'`,
      [`admin:photo:${mediaId}`],
    )).rows[0].count), 0, 'the lost evidence race creates no false review receipt');
  } finally {
    if (blockerOpen) await blocker.query('rollback').catch(() => undefined);
    blocker.release();
  }
});

test('freeze-at-start lets a late member join the team but only snapshots them into the next run', { skip: !enabled }, async () => {
  const huntId = `v3-freeze-roster-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(huntId, {
    locationVerification: 'gps_only',
    selfServeApproval: 'automatic',
    rosterParticipation: 'freeze_at_run_start',
  }));
  const captain = await createSelfServe(huntId, 'Frozen Captain', `freeze-create-${huntId}`);
  const first = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  const late = await joinTeam({
    huntId,
    teamCode: captain.summary.team.code,
    playerName: 'Next Run Scout',
    memberPin: '444444',
    source: `freeze-late-${huntId}`,
  });
  assert.equal(late.summary.activeRun, null);
  assert.equal(late.summary.waitingForNextRun, true);
  assert.equal((await getPool().query(
    'select count(*)::int as count from hunt_v3.run_members where run_id=$1 and member_id=$2',
    [first.runId, late.summary.member.id],
  )).rows[0].count, 0);
  await assert.rejects(
    currentRunView(captain.summary.team.id, late.summary.member.id, first.runId),
    /already underway.*(?:aren't|not) part of this run/i,
  );
  await getPool().query(
    `update hunt_v3.runs set status='abandoned',eligible=false,ineligibility_reason='Integration next-run boundary'
      where id=$1`,
    [first.runId],
  );
  const next = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  assert.equal((await currentRunView(captain.summary.team.id, late.summary.member.id, next.runId)).runId, next.runId);
  assert.equal((await getPool().query(
    'select contribution_eligible from hunt_v3.run_members where run_id=$1 and member_id=$2',
    [next.runId, late.summary.member.id],
  )).rows[0].contribution_eligible, true, 'a starting member in the next run receives normal eligibility');
});

test('late flexible identities share the same team verifier budget', { skip: !enabled }, async () => {
  const huntId = `v3-late-budget-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(huntId, {
    locationVerification: 'gps_only',
    selfServeApproval: 'automatic',
    rosterParticipation: 'flexible',
  }));
  const captain = await createSelfServe(huntId, 'Budget Captain', `budget-create-${huntId}`);
  const run = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  const late = await joinTeam({
    huntId,
    teamCode: captain.summary.team.code,
    playerName: 'Budget Helper',
    memberPin: '555555',
    source: `budget-late-${huntId}`,
  });
  const secondLate = await joinTeam({
    huntId,
    teamCode: captain.summary.team.code,
    playerName: 'Budget Navigator',
    memberPin: '556655',
    source: `budget-second-late-${huntId}`,
  });
  const actors = [captain.summary.member.id, late.summary.member.id, secondLate.summary.member.id];
  const firstRequest = randomUUID();
  const firstCommand = { type: 'verify' as const, checkpointId: 'start', nodeId: 'answer', value: 'wrong-1' };
  for (let index = 0; index < 6; index += 1) {
    const result = await applyRunCommand(
      captain.summary.team.id,
      actors[index % actors.length],
      run.runId,
      index === 0 ? firstRequest : randomUUID(),
      index === 0 ? firstCommand : { ...firstCommand, value: `wrong-${index + 1}` },
    );
    assert.equal(result.feedback.status, 'rejected');
  }
  await assert.rejects(
    applyRunCommand(captain.summary.team.id, secondLate.summary.member.id, run.runId, randomUUID(), {
      ...firstCommand,
      value: 'correct',
    }),
    /too many attempts/i,
  );
  assert.equal(
    (await applyRunCommand(captain.summary.team.id, captain.summary.member.id, run.runId, firstRequest, firstCommand)).feedback.status,
    'rejected',
    'the exact first request remains replayable after the shared limit is full',
  );
  const aggregateKey = digest(`run-verifier:aggregate:${captain.summary.team.id}:${run.runId}:start:answer`);
  assert.equal(Number((await getPool().query(
    'select count(*)::int as count from hunt_v3.run_attempt_reservations where scope_key=$1',
    [aggregateKey],
  )).rows[0].count), 6);
});

test('multiple late identities cannot multiply a parallel-lane guess budget', { skip: !enabled }, async () => {
  const huntId = `v3-late-parallel-budget-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(huntId, {
    locationVerification: 'gps_only',
    selfServeApproval: 'automatic',
    rosterParticipation: 'flexible',
  }));
  const captain = await createSelfServe(huntId, 'Lane Budget Captain', `lane-budget-create-${huntId}`);
  const run = await createRun(captain.summary.team.id, captain.summary.member.id, randomUUID());
  const firstLate = await joinTeam({
    huntId,
    teamCode: captain.summary.team.code,
    playerName: 'Lane Budget Scout',
    memberPin: '565565',
    source: `lane-budget-late-a-${huntId}`,
  });
  const secondLate = await joinTeam({
    huntId,
    teamCode: captain.summary.team.code,
    playerName: 'Lane Budget Navigator',
    memberPin: '676676',
    source: `lane-budget-late-b-${huntId}`,
  });
  const answerCode = String((await getPool().query(
    "select resolved_variables->>'answerCode' as answer_code from hunt_v3.runs where id=$1",
    [run.runId],
  )).rows[0].answer_code);
  await applyRunCommand(captain.summary.team.id, firstLate.summary.member.id, run.runId, randomUUID(), {
    type: 'verify', checkpointId: 'start', nodeId: 'answer', value: answerCode,
  });
  const actors = [captain.summary.member.id, firstLate.summary.member.id, secondLate.summary.member.id];
  const firstRequest = randomUUID();
  const firstInput = {
    teamId: captain.summary.team.id,
    memberId: captain.summary.member.id,
    runId: run.runId,
    requestId: firstRequest,
    mechanicId: 'split-gate',
    laneId: 'alpha',
    evidence: { value: 'wrong-1' },
  };
  for (let index = 0; index < 6; index += 1) {
    const result = await submitParallelLane(index === 0 ? firstInput : {
      ...firstInput,
      memberId: actors[index % actors.length],
      requestId: randomUUID(),
      evidence: { value: `wrong-${index + 1}` },
    });
    assert.equal(result.status, 'rejected');
  }
  const alphaCode = String((await getPool().query(
    "select resolved_variables->>'alphaCode' as alpha_code from hunt_v3.runs where id=$1",
    [run.runId],
  )).rows[0].alpha_code);
  await assert.rejects(
    submitParallelLane({
      ...firstInput,
      memberId: secondLate.summary.member.id,
      requestId: randomUUID(),
      evidence: { value: alphaCode },
    }),
    /too many attempts/i,
  );
  assert.equal((await submitParallelLane(firstInput)).status, 'rejected');
  const aggregateKey = digest(`parallel-lane:aggregate:${captain.summary.team.id}:${run.runId}:split-gate:alpha`);
  assert.equal(Number((await getPool().query(
    'select count(*)::int as count from hunt_v3.run_attempt_reservations where scope_key=$1',
    [aggregateKey],
  )).rows[0].count), 6);
});

test('registration availability preserves live choice, retries exactly, and wins a queued create race', { skip: !enabled }, async () => {
  const huntId = `v3-registration-switch-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(huntId, {
    locationVerification: 'gps_only',
    selfServeApproval: 'automatic',
    rosterParticipation: 'flexible_fixed_scoring',
  }), 'ready');
  await setHuntLifecycle(huntId, 'live', 1, 'Switch organizer');
  assert.deepEqual(
    (await getPool().query(
      'select status,registration_open,lifecycle_revision from hunt_v3.hunts where id=$1',
      [huntId],
    )).rows[0],
    { status: 'live', registration_open: true, lifecycle_revision: 2 },
    'starting the event preserves the organizer\'s open-registration choice',
  );

  const closeRequest = {
    huntId,
    open: false,
    expectedRevision: 2,
    requestId: randomUUID(),
    actor: 'Switch organizer',
    sessionHash: 'a'.repeat(64),
  };
  const [closed, closeRetry] = await Promise.all([
    setRegistrationOpen(closeRequest),
    setRegistrationOpen(closeRequest),
  ]);
  assert.deepEqual([closed.replayed, closeRetry.replayed].sort(), [false, true]);
  assert.equal(closed.lifecycleRevision, 3);
  await assert.rejects(
    setRegistrationOpen({ ...closeRequest, requestId: randomUUID(), open: true }),
    /changed.*refresh/i,
  );
  const reopened = await setRegistrationOpen({
    ...closeRequest,
    open: true,
    expectedRevision: 3,
    requestId: randomUUID(),
  });
  assert.equal(reopened.lifecycleRevision, 4);

  const registrationRequestId = randomUUID();
  const registrationInput = {
    requestId: registrationRequestId,
    huntId,
    intent: 'create' as const,
    playerName: 'Retry Captain',
    teamName: 'Retry Crew',
    pin: '787878',
    memberPin: '898989',
    requestSource: `registration-retry-${huntId}`,
  };
  const registrations = await Promise.all([
    registerV3Team(registrationInput),
    registerV3Team(registrationInput),
  ]);
  assert.equal(registrations[0].summary.team.id, registrations[1].summary.team.id);
  assert.equal(registrations[0].summary.member.id, registrations[1].summary.member.id);
  assert.equal(Number((await getPool().query(
    "select count(*)::int as count from hunt_v3.admin_events where hunt_id=$1 and action='team_registered'",
    [huntId],
  )).rows[0].count), 1);

  const blocker = await getPool().connect();
  let blockerOpen = false;
  try {
    await blocker.query('begin');
    blockerOpen = true;
    await blocker.query('select id from hunt_v3.hunts where id=$1 for update', [huntId]);
    const blockerPid = Number((await blocker.query('select pg_backend_pid() as pid')).rows[0].pid);
    const racingClose = setRegistrationOpen({
      ...closeRequest,
      expectedRevision: 4,
      requestId: randomUUID(),
    });
    void racingClose.catch(() => undefined);
    await waitForLockWaiters(blockerPid, 1);
    const racingCreate = registerV3Team({
      requestId: randomUUID(),
      huntId,
      intent: 'create',
      playerName: 'Queued Captain',
      teamName: 'Queued Crew',
      pin: '565656',
      memberPin: '676767',
      requestSource: `registration-close-race-${huntId}`,
    });
    void racingCreate.catch(() => undefined);
    await waitForLockWaiters(blockerPid, 2);
    await blocker.query('commit');
    blockerOpen = false;
    assert.equal((await racingClose).registrationOpen, false);
    await assert.rejects(racingCreate, /registration is closed/i);
    assert.equal(Number((await getPool().query(
      "select count(*)::int as count from hunt_v3.teams where hunt_id=$1 and display_name='Queued Crew'",
      [huntId],
    )).rows[0].count), 0, 'the losing create cannot persist behind the atomic close');
  } finally {
    if (blockerOpen) await blocker.query('rollback').catch(() => undefined);
    blocker.release();
  }
});

test('organizer-assigned and rostered creation can be closed, reopened, and preserved into live play', { skip: !enabled }, async () => {
  for (const mode of ['organizer-assigned', 'rostered'] as const) {
    const huntId = `v3-registration-${mode.replaceAll('-', '')}-${randomUUID().slice(0, 8)}`;
    const hunt = definition(huntId, {
      locationVerification: 'gps_only',
      selfServeApproval: 'automatic',
      rosterParticipation: 'flexible_fixed_scoring',
    });
    hunt.settings.registrationMode = mode;
    await insertHunt(hunt, 'ready');
    const close = await setRegistrationOpen({
      huntId,
      open: false,
      expectedRevision: 1,
      requestId: randomUUID(),
      actor: 'Mode organizer',
      sessionHash: 'e'.repeat(64),
    });
    assert.equal(close.lifecycleRevision, 2);
    const createInput = {
      huntId,
      requestId: randomUUID(),
      displayName: `${mode} Crew`,
      memberNames: mode === 'rostered' ? ['Roster Member'] : [],
      pin: '202020',
      credentialSecret: 'integration-credential-secret',
      actor: 'Mode organizer',
      sessionHash: 'e'.repeat(64),
    };
    await assert.rejects(createOrganizerTeam(createInput), /team creation is closed/i);
    const reopen = await setRegistrationOpen({
      huntId,
      open: true,
      expectedRevision: 2,
      requestId: randomUUID(),
      actor: 'Mode organizer',
      sessionHash: 'e'.repeat(64),
    });
    assert.equal(reopen.lifecycleRevision, 3);
    assert.ok((await createOrganizerTeam({ ...createInput, requestId: randomUUID() })).teamId);
    await setHuntLifecycle(huntId, 'live', 3, 'Mode organizer');
    assert.deepEqual(
      (await getPool().query(
        'select status,registration_open from hunt_v3.hunts where id=$1',
        [huntId],
      )).rows[0],
      { status: 'live', registration_open: true },
    );
    assert.ok((await createOrganizerTeam({
      ...createInput,
      requestId: randomUUID(),
      displayName: `${mode} Live Crew`,
      memberNames: mode === 'rostered' ? ['Live Roster Member'] : [],
      pin: '303030',
    })).teamId);
  }
});

test('organizer-created teams obey lifecycle state as well as the creation switch', { skip: !enabled }, async () => {
  const huntId = `v3-organizer-ended-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId, {
    locationVerification: 'gps_only',
    selfServeApproval: 'automatic',
    rosterParticipation: 'flexible_fixed_scoring',
  });
  hunt.settings.registrationMode = 'organizer-assigned';
  await insertHunt(hunt, 'live');
  await setHuntLifecycle(huntId, 'ended', 1, 'Lifecycle organizer');
  await assert.rejects(
    createOrganizerTeam({
      huntId,
      requestId: randomUUID(),
      displayName: 'After End',
      memberNames: [],
      pin: '101010',
      credentialSecret: 'integration-credential-secret',
      actor: 'Lifecycle organizer',
      sessionHash: 'b'.repeat(64),
    }),
    /unavailable after this event has ended/i,
  );
});

test('legacy run history without an explicit policy blocks the clean V3 cutover', { skip: !enabled }, async () => {
  const huntId = `v3-legacy-policy-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId, {
    locationVerification: 'gps_only',
    selfServeApproval: 'automatic',
    rosterParticipation: 'flexible',
  });
  hunt.settings.parallelMechanics = [];
  hunt.settings.variableGenerators = {};
  hunt.checkpoints[0].flow = {
    startNodeId: 'photo',
    nodes: [
      {
        id: 'photo',
        type: 'verify_image',
        prompt: 'Photograph the location.',
        referenceImages: [],
        next: 'start-done',
      },
      { id: 'start-done', type: 'complete' },
    ],
  };
  await insertHunt(hunt);
  const registration = await createSelfServe(huntId, 'Cutover Captain', `cutover-${huntId}`);
  const createRequestId = randomUUID();
  const run = await createRun(registration.summary.team.id, registration.summary.member.id, createRequestId);
  assert.ok(run.runId);

  const controlRequestId = randomUUID();
  const revision = Number((await getPool().query(
    "select engine_state->>'revision' as revision from hunt_v3.runs where id=$1",
    [run.runId],
  )).rows[0].revision);
  await controlRunGameplay({
    huntId,
    teamId: registration.summary.team.id,
    runId: run.runId,
    requestId: controlRequestId,
    expectedRevision: revision,
    control: 'extend_session',
    seconds: 60,
    reason: 'Create an exact recovery receipt for the cutover regression',
    actor: 'Cutover organizer',
    sessionHash: '8'.repeat(64),
  });
  const mediaId = randomUUID();
  await getPool().query(
    `insert into hunt_v3.media(
      id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,kind,content_type,bytes,content_hash,storage_key,retention,
      task_started_at)
      values($1,$2,$3,$4,$5,'start','photo','photo','image/jpeg',1,$6,$7,'keep',$8::timestamptz)`,
    [mediaId, huntId, registration.summary.team.id, run.runId, registration.summary.member.id,
      'e'.repeat(64), `${mediaId}-${randomUUID()}`, await taskStartedAt(run.runId, 'start', 'photo')],
  );
  const photoRequestId = randomUUID();
  await applyRunCommand(registration.summary.team.id, registration.summary.member.id, run.runId, photoRequestId, {
    type: 'submit_photo', checkpointId: 'start', nodeId: 'photo', mediaId,
  });
  const reviewRequestId = randomUUID();
  await reviewPhoto({
    mediaId,
    approved: false,
    reason: 'Create an exact review receipt for the cutover regression',
    requestId: reviewRequestId,
    actor: 'Cutover organizer',
  });

  const malformed = structuredClone(hunt) as unknown as { version: number; settings: Record<string, unknown> };
  malformed.version = 2;
  delete malformed.settings.integrityPolicy;
  await assert.rejects(
    getPool().query(
      `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
        values($1,2,$2,$3,$4,$5)`,
      [huntId, malformed, 'b'.repeat(64), { valid: true, issues: [] }, validateFairness(hunt)],
    ),
    /complete integrityPolicy/i,
    'new malformed publications are rejected before they can own a run',
  );

  const before = (await getPool().query(
    `select run.engine_state,run.status,
      (select count(*)::int from hunt_v3.run_events event where event.run_id=run.id) as events,
      (select count(*)::int from hunt_v3.run_members participant where participant.run_id=run.id) as participants
      from hunt_v3.runs run where run.id=$1`,
    [run.runId],
  )).rows[0];
  const malformedDefinition = structuredClone(hunt) as unknown as Record<string, unknown>;
  delete ((malformedDefinition.settings as Record<string, unknown>).integrityPolicy);
  try {
    await getPool().query('alter table hunt_v3.hunt_versions disable trigger reject_immutable_mutation');
    await getPool().query(
      'update hunt_v3.hunt_versions set definition=$2 where hunt_id=$1 and version=1',
      [huntId, malformedDefinition],
    );
    await getPool().query('alter table hunt_v3.hunt_versions enable trigger reject_immutable_mutation');
    await assert.rejects(
      getPool().query('select hunt_v3.assert_run_integrity_policy_cutover()'),
      /cutover blocked.*clean-reimport and republish/i,
      'migration refuses every historical run pinned to a pre-policy definition',
    );
    const organizerUpdate = /needs an organizer update/i;
    await assert.rejects(
      createRun(registration.summary.team.id, registration.summary.member.id, createRequestId),
      organizerUpdate,
      'an exact create receipt cannot resume a run pinned to malformed content',
    );
    await assert.rejects(
      currentRunView(registration.summary.team.id, registration.summary.member.id, run.runId),
      organizerUpdate,
    );
    await assert.rejects(
      applyRunCommand(registration.summary.team.id, registration.summary.member.id, run.runId, photoRequestId, {
        type: 'submit_photo', checkpointId: 'start', nodeId: 'photo', mediaId,
      }),
      organizerUpdate,
      'an exact gameplay receipt cannot bypass the pinned-policy guard',
    );
    await assert.rejects(
      activePhotoTask(registration.summary.team.id, registration.summary.member.id, {
        checkpointId: 'start', nodeId: 'photo', expectedRunId: run.runId,
      }),
      organizerUpdate,
    );
    await assert.rejects(
      submitParallelLane({
        teamId: registration.summary.team.id,
        memberId: registration.summary.member.id,
        runId: run.runId,
        requestId: randomUUID(),
        mechanicId: 'missing-mechanic',
        laneId: 'missing-lane',
        evidence: { value: 'anything' },
      }),
      organizerUpdate,
    );
    await assert.rejects(
      privateRecognition(registration.summary.team.id, registration.summary.member.id, run.runId),
      organizerUpdate,
    );
    await assert.rejects(
      controlRunGameplay({
        huntId,
        teamId: registration.summary.team.id,
        runId: run.runId,
        requestId: controlRequestId,
        expectedRevision: revision,
        control: 'extend_session',
        seconds: 60,
        reason: 'Create an exact recovery receipt for the cutover regression',
        actor: 'Cutover organizer',
        sessionHash: '8'.repeat(64),
      }),
      organizerUpdate,
      'an exact organizer-control receipt cannot bypass the pinned-policy guard',
    );
    await assert.rejects(
      reviewPhoto({
        mediaId,
        approved: false,
        reason: 'Create an exact review receipt for the cutover regression',
        requestId: reviewRequestId,
        actor: 'Cutover organizer',
      }),
      organizerUpdate,
      'an exact photo-review receipt cannot bypass the pinned-policy guard',
    );
    await assert.rejects(
      joinTeam({
        huntId,
        teamCode: registration.summary.team.code,
        playerName: 'Cutover Late Member',
        memberPin: '919191',
        source: `cutover-late-${huntId}`,
      }),
      organizerUpdate,
      'late enrollment rolls back instead of creating a run participant under malformed pinned content',
    );
    assert.equal((await getPool().query(
      "select count(*)::int as count from hunt_v3.team_members where team_id=$1 and name='Cutover Late Member'",
      [registration.summary.team.id],
    )).rows[0].count, 0);
    const afterBlocked = (await getPool().query(
      `select run.engine_state,run.status,
        (select count(*)::int from hunt_v3.run_events event where event.run_id=run.id) as events,
        (select count(*)::int from hunt_v3.run_members participant where participant.run_id=run.id) as participants
        from hunt_v3.runs run where run.id=$1`,
      [run.runId],
    )).rows[0];
    assert.deepEqual(afterBlocked, before, 'blocked legacy runtime entrypoints leave run history and roster unchanged');
  } finally {
    await getPool().query('alter table hunt_v3.hunt_versions disable trigger reject_immutable_mutation').catch(() => undefined);
    await getPool().query(
      'update hunt_v3.hunt_versions set definition=$2 where hunt_id=$1 and version=1',
      [huntId, hunt],
    ).catch(() => undefined);
    await getPool().query('alter table hunt_v3.hunt_versions enable trigger reject_immutable_mutation').catch(() => undefined);
  }
  assert.equal((await getPool().query(
    `select hunt_v3.has_complete_integrity_policy(definition) as complete
      from hunt_v3.hunt_versions where hunt_id=$1 and version=1`,
    [huntId],
  )).rows[0].complete, true, 'the regression probe leaves immutable history untouched');
});
