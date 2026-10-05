import '../isolated-database';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getPool } from '../../lib/server/db';
import { publicLeaderboard } from '../../lib/server/v3/leaderboards';
import {
  changeTeamCompetitionStatus,
  controlRunGameplay,
  createOrganizerTeam,
  freezePublicBoard,
  reviewPhoto,
  setRegistrationOpen,
  setHuntLifecycle,
} from '../../lib/server/v3/operations';
import { registerV3Team } from '../../lib/server/v3/registration';
import { privateRecognition } from '../../lib/server/v3/recognition';
import { applyRunCommand, createRun, currentRunView } from '../../lib/server/v3/runs';
import { authenticateV3 } from '../../lib/server/v3/security';
import { validateFairness } from '../../lib/v3/fairness';
import type { V3Definition } from '../../lib/v3/types';

const enabled = Boolean(process.env.DATABASE_URL);

function definition(id: string, registrationMode: V3Definition['settings']['registrationMode']): V3Definition {
  return {
    schemaVersion: 3,
    id,
    version: 1,
    title: 'Competition approval integration',
    settings: {
      mode: 'sequential',
      map: 'none',
      rules: 'Use one approved team identity.',
      minTeamSize: 1,
      maxTeamSize: 6,
      sessionDurationSeconds: 3600,
      registrationOpen: true,
      completionMessage: 'Finished.',
      photoRetention: 'after_verification',
      registrationMode,
      integrityPolicy: { locationVerification: 'strict', selfServeApproval: 'organizer', rosterParticipation: 'freeze_at_run_start' },
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
        title: 'Approval board',
        status: 'live',
        teamIdentity: 'code_and_name',
        columns: ['rank', 'team_code', 'team_name', 'points', 'completion_status'],
      },
      socialShare: { enabled: false, allowPersonalTitle: false },
      recognition: { enabled: false, peerVotingEnabled: false, votingWindowMinutes: 60, dataWeight: 0.7, peerWeight: 0.3 },
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
      variableGenerators: {},
      fairnessPolicy: {
        minimumDistinctPlans: 1,
        durationToleranceMinutes: 0,
        maxResolvedRoutes: 50,
        requireTravelEstimates: true,
        walkingSpeedMetersPerMinute: 72,
        minutesPerDifficultyPoint: 1.5,
      },
      parallelMechanics: [],
    },
    checkpoints: [
      {
        id: 'start', title: 'Start', basePoints: 10, required: true, hints: [],
        flow: {
          startNodeId: 'start-message',
          nodes: [
            { id: 'start-message', type: 'show_text', text: 'Begin.', next: 'start-done' },
            { id: 'start-done', type: 'complete' },
          ],
        },
      },
      {
        id: 'finale', title: 'Finale', basePoints: 10, required: true, hints: [],
        flow: {
          startNodeId: 'finish-message',
          nodes: [
            { id: 'finish-message', type: 'show_text', text: 'Finish.', next: 'finish-done' },
            { id: 'finish-done', type: 'complete' },
          ],
        },
      },
    ],
  };
}

async function insertHunt(value: V3Definition) {
  const fairness = validateFairness(value);
  assert.equal(fairness.valid, true, JSON.stringify(fairness.issues));
  await getPool().query(
    `insert into hunt_v3.hunts(
      id,title,slug,status,registration_mode,registration_open,latest_version,settings)
      values($1,$2,$1,'ready',$3,true,1,$4)`,
    [value.id, value.title, value.settings.registrationMode.replaceAll('-', '_'), value.settings],
  );
  await getPool().query(
    `insert into hunt_v3.hunt_versions(
      hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,1,$2,$3,$4,$5)`,
    [value.id, value, 'a'.repeat(64), { valid: true, issues: [] }, fairness],
  );
  await getPool().query(
    `insert into hunt_v3.public_boards(
      hunt_id,slug,enabled,title,event_status,visible_columns,main_board_visible,replay_board_visible,team_name_mode)
      values($1,$2,true,'Approval board','live',$3,true,true,'display_name')`,
    [value.id, value.settings.publicBoard.slug, value.settings.publicBoard.columns],
  );
}

async function completeSimpleRun(teamId: string, memberId: string, runId: string) {
  let view = await currentRunView(teamId, memberId, runId);
  for (let step = 0; step < 10 && view.status === 'active'; step += 1) {
    assert.equal(view.node?.type, 'show_text', 'the compact policy fixture should expose only continue actions');
    view = (await applyRunCommand(teamId, memberId, runId, randomUUID(), {
      type: 'continue', checkpointId: view.checkpoint!.id, nodeId: view.node!.id,
    })).view;
  }
  assert.equal(view.status, 'completed');
  return view;
}

async function waitForAnotherBackendLock(blockerPid: number, label: string, minimum = 1) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = Number((await getPool().query(
      `select count(*)::int as count from pg_stat_activity
        where datname=current_database() and pid<>$1 and wait_event_type='Lock'`,
      [blockerPid],
    )).rows[0].count);
    if (waiting >= minimum) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Expected ${minimum} backend${minimum === 1 ? '' : 's'} for ${label} to wait at the database lock barrier.`);
}

before(async () => {
  if (!enabled) return;
  await getPool().query(await readFile(new URL('../../database/v3.sql', import.meta.url), 'utf8'));
});

after(async () => {
  if (enabled) await getPool().end();
});

test('self-serve approval, registration close, disqualification and restoration preserve competition integrity', { skip: !enabled }, async () => {
  const huntId = `v3-team-control-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId, 'self-serve');
  const boardSlug = hunt.settings.publicBoard.slug!;
  await insertHunt(hunt);

  const registration = await registerV3Team({
    requestId: randomUUID(),
    huntId,
    intent: 'create',
    playerName: 'Asha',
    teamName: 'North Stars',
    memberNames: ['Bela'],
    pin: '123456',
    memberPin: '654321',
    requestSource: 'team-control-test',
  });
  const teamId = registration.summary.team.id;
  const memberId = registration.summary.member.id;
  assert.equal(registration.summary.team.approvalStatus, 'pending');
  assert.equal(registration.summary.team.competitionRevision, 1);
  await assert.rejects(createRun(teamId, memberId, randomUUID()), /organizer's go-ahead/i);
  assert.equal((await publicLeaderboard(boardSlug) as { main: unknown[] }).main.length, 0);

  const approveRequest = {
    huntId,
    teamId,
    action: 'approve' as const,
    reason: 'Roster and team identity checked at registration desk',
    expectedRevision: 1,
    requestId: randomUUID(),
    actor: 'Integration organizer',
    sessionHash: '1'.repeat(64),
  };
  const approvals = await Promise.all([
    changeTeamCompetitionStatus(approveRequest),
    changeTeamCompetitionStatus(approveRequest),
  ]);
  assert.deepEqual(approvals.map(result => result.replayed).sort(), [false, true]);
  assert.equal(approvals[0].approvalStatus, 'approved');
  assert.deepEqual(
    (await getPool().query(
      "select approval_status,competition_revision from hunt_v3.teams where id=$1",
      [teamId],
    )).rows[0],
    { approval_status: 'approved', competition_revision: 2 },
  );
  assert.equal(Number((await getPool().query(
    "select count(*) from hunt_v3.admin_events where team_id=$1 and action='team_approved'",
    [teamId],
  )).rows[0].count), 1, 'a concurrent retry creates one audit event');
  await assert.rejects(
    changeTeamCompetitionStatus({ ...approveRequest, requestId: randomUUID() }),
    /changed.*refresh/i,
  );
  const closeRegistrationRequest = {
    huntId,
    open: false,
    expectedRevision: 1,
    requestId: randomUUID(),
    actor: 'Integration organizer',
    sessionHash: '1'.repeat(64),
  };
  const closed = await setRegistrationOpen(closeRegistrationRequest);
  assert.equal(closed.lifecycleRevision, 2);
  assert.equal((await setRegistrationOpen(closeRegistrationRequest)).replayed, true);
  await assert.rejects(
    setRegistrationOpen({ ...closeRegistrationRequest, requestId: randomUUID(), open: true }),
    /changed.*refresh/i,
  );
  await setHuntLifecycle(huntId, 'live', 2, 'Integration organizer');
  assert.deepEqual(
    (await getPool().query('select status,registration_open,lifecycle_revision from hunt_v3.hunts where id=$1', [huntId])).rows[0],
    { status: 'live', registration_open: false, lifecycle_revision: 3 },
  );
  await assert.rejects(
    registerV3Team({
      requestId: randomUUID(), huntId, intent: 'create', playerName: 'Cheater', teamName: 'Late Crew',
      pin: '111111', memberPin: '222222', requestSource: 'team-control-test',
    }),
    /registration is closed/i,
  );
  const teammate = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Bela', teamCode: registration.summary.team.code,
    pin: '123456', memberPin: '222222', requestSource: 'team-control-test',
  });
  assert.equal(teammate.summary.team.id, teamId, 'an existing declared member can join after creation closes');
  assert.equal(teammate.summary.team.approvalStatus, 'approved');
  assert.equal(teammate.summary.team.competitionRevision, 3,
    'a first claim advances the roster audit revision without revoking team-level organizer approval');

  const first = await createRun(teamId, memberId, randomUUID());
  const atFinale = await applyRunCommand(teamId, memberId, first.runId, randomUUID(), {
    type: 'continue', checkpointId: 'start', nodeId: 'start-message',
  });
  const completed = await applyRunCommand(teamId, memberId, first.runId, randomUUID(), {
    type: 'continue', checkpointId: 'finale', nodeId: 'finish-message',
  });
  assert.equal(atFinale.view.checkpoint?.id, 'finale');
  assert.equal(completed.view.status, 'completed');
  assert.equal((await publicLeaderboard(boardSlug) as { main: Array<{ teamCode: string }> }).main[0]?.teamCode, registration.summary.team.code);

  const second = await createRun(teamId, memberId, randomUUID());
  await freezePublicBoard(huntId, false, 'Integration organizer');
  const disqualifyRequest = {
    huntId,
    teamId,
    action: 'disqualify' as const,
    reason: 'Duplicate team identity confirmed by the event desk',
    expectedRevision: 3,
    requestId: randomUUID(),
    actor: 'Integration organizer',
    sessionHash: '1'.repeat(64),
  };
  const disqualified = await changeTeamCompetitionStatus(disqualifyRequest);
  assert.equal(disqualified.status, 'disqualified');
  assert.equal(disqualified.competitionRevision, 4);
  assert.equal(disqualified.revokedSessions, 2);
  await assert.rejects(authenticateV3(registration.token, 'team'), /session has expired/i);
  await assert.rejects(authenticateV3(teammate.token, 'team'), /session has expired/i);
  assert.deepEqual(
    (await getPool().query('select run_number,status,eligible from hunt_v3.runs where team_id=$1 order by run_number', [teamId])).rows,
    [
      { run_number: 1, status: 'completed', eligible: false },
      { run_number: 2, status: 'disqualified', eligible: false },
    ],
  );
  assert.equal((await publicLeaderboard(boardSlug) as { main: unknown[] }).main.length, 0, 'even the rebuilt frozen board excludes a disqualified team');
  const replayedDisqualification = await changeTeamCompetitionStatus(disqualifyRequest);
  assert.equal(replayedDisqualification.replayed, true);
  assert.equal(Number((await getPool().query(
    "select count(*) from hunt_v3.admin_events where team_id=$1 and action='team_disqualified'",
    [teamId],
  )).rows[0].count), 1);
  await assert.rejects(
    changeTeamCompetitionStatus({ ...disqualifyRequest, reason: 'Changed reason' }),
    /request ID was already used/i,
  );

  const restored = await changeTeamCompetitionStatus({
    huntId,
    teamId,
    action: 'restore',
    reason: 'Identity review completed; future attempts may proceed',
    expectedRevision: 4,
    requestId: randomUUID(),
    actor: 'Integration organizer',
    sessionHash: '1'.repeat(64),
  });
  assert.equal(restored.status, 'active');
  assert.equal(restored.approvalStatus, 'approved');
  await assert.rejects(authenticateV3(registration.token, 'team'), /session has expired/i, 'restoration never revives a revoked session');
  assert.equal(Number((await getPool().query('select count(*) from hunt_v3.runs where team_id=$1 and eligible', [teamId])).rows[0].count), 0, 'restoration never re-eligibilizes prior runs');

  const signedInAgain = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Asha', teamCode: registration.summary.team.code,
    pin: '123456', memberPin: '654321', requestSource: 'team-control-test',
  });
  const future = await createRun(teamId, memberId, randomUUID());
  assert.equal(future.eligible, true, 'an explicitly restored, already-approved team may create a new eligible run');
  assert.equal(signedInAgain.summary.team.competitionRevision, 5);

  const competing = await Promise.allSettled([
    changeTeamCompetitionStatus({
      huntId, teamId, action: 'disqualify', reason: 'Concurrent decision A', expectedRevision: 5,
      requestId: randomUUID(), actor: 'Organizer A', sessionHash: '2'.repeat(64),
    }),
    changeTeamCompetitionStatus({
      huntId, teamId, action: 'disqualify', reason: 'Concurrent decision B', expectedRevision: 5,
      requestId: randomUUID(), actor: 'Organizer B', sessionHash: '3'.repeat(64),
    }),
  ]);
  assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(competing.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await getPool().query('select competition_revision from hunt_v3.teams where id=$1', [teamId])).rows[0].competition_revision, 6);
});

test('organizer-assigned and rostered teams start approved and respect the atomic creation close', { skip: !enabled }, async () => {
  const secret = 'integration-credential-secret';
  for (const mode of ['organizer-assigned', 'rostered'] as const) {
    const huntId = `v3-${mode.replaceAll('-', '')}-${randomUUID().slice(0, 8)}`;
    await insertHunt(definition(huntId, mode));
    const created = await createOrganizerTeam({
      huntId,
      requestId: randomUUID(),
      displayName: mode === 'rostered' ? 'Roster Crew' : 'Assigned Crew',
      memberNames: mode === 'rostered' ? ['Aarav', 'Priya'] : [],
      credentialSecret: secret,
      actor: 'Integration organizer',
      sessionHash: '4'.repeat(64),
    });
    assert.deepEqual(
      (await getPool().query('select status,approval_status,competition_revision from hunt_v3.teams where id=$1', [created.teamId])).rows[0],
      { status: 'active', approval_status: 'approved', competition_revision: 1 },
    );
    await setRegistrationOpen({
      huntId,
      open: false,
      expectedRevision: 1,
      requestId: randomUUID(),
      actor: 'Integration organizer',
      sessionHash: '4'.repeat(64),
    });
    await setHuntLifecycle(huntId, 'live', 2, 'Integration organizer');
    await assert.rejects(
      createOrganizerTeam({
        huntId,
        requestId: randomUUID(),
        displayName: 'Too Late',
        memberNames: mode === 'rostered' ? ['Late Member'] : [],
        credentialSecret: secret,
        actor: 'Integration organizer',
        sessionHash: '4'.repeat(64),
      }),
      /team creation is closed/i,
    );
  }
});

test('self-serve approval remains team-level while freeze snapshots each run roster', { skip: !enabled }, async () => {
  const huntId = `v3-approval-roster-race-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(huntId, 'self-serve'));
  const registration = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'create', playerName: 'Captain', teamName: 'Race Crew',
    pin: '121212', memberPin: '343434', requestSource: 'approval-roster-race',
  });
  const approve = changeTeamCompetitionStatus({
    huntId,
    teamId: registration.summary.team.id,
    action: 'approve',
    reason: 'Desk verified the roster visible at approval time',
    expectedRevision: 1,
    requestId: randomUUID(),
    actor: 'Race organizer',
    sessionHash: '6'.repeat(64),
  });
  const lateJoin = registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Last Minute', teamCode: registration.summary.team.code,
    pin: '121212', memberPin: '565656', requestSource: 'approval-roster-race',
  });
  const raced = await Promise.allSettled([approve, lateJoin]);
  assert.equal(raced[1].status, 'fulfilled', 'team membership remains available under freeze-at-start');
  assert.ok(
    raced.filter(result => result.status === 'fulfilled').length >= 1,
    'the serialized winner commits; a stale approval may ask the organizer to refresh',
  );

  let state = (await getPool().query(
    'select approval_status,competition_revision from hunt_v3.teams where id=$1',
    [registration.summary.team.id],
  )).rows[0];
  if (state.approval_status === 'pending') {
    await changeTeamCompetitionStatus({
      huntId,
      teamId: registration.summary.team.id,
      action: 'approve',
      reason: 'Desk reviewed the member who won the approval race',
      expectedRevision: Number(state.competition_revision),
      requestId: randomUUID(),
      actor: 'Race organizer',
      sessionHash: '6'.repeat(64),
    });
  }
  state = (await getPool().query(
    'select approval_status,competition_revision from hunt_v3.teams where id=$1',
    [registration.summary.team.id],
  )).rows[0];
  assert.equal(state.approval_status, 'approved');
  const approvedRevision = Number(state.competition_revision);
  await setHuntLifecycle(huntId, 'live', 1, 'Race organizer');
  const run = await createRun(registration.summary.team.id, registration.summary.member.id, randomUUID());
  const afterStart = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'After Approval', teamCode: registration.summary.team.code,
    pin: '121212', memberPin: '787878', requestSource: 'approval-roster-race',
  });
  assert.equal(afterStart.summary.team.approvalStatus, 'approved', 'membership growth does not silently revoke team-level approval');
  assert.equal(afterStart.summary.team.competitionRevision, approvedRevision + 1,
    'a newly added member advances the auditable roster revision');
  assert.equal(afterStart.summary.activeRun, null);
  assert.equal(afterStart.summary.waitingForNextRun, true);
  assert.equal(Number((await getPool().query(
    'select count(*)::int as count from hunt_v3.run_members where run_id=$1 and member_id=$2',
    [run.runId, afterStart.summary.member.id],
  )).rows[0].count), 0, 'the current run keeps its immutable starting roster');
});

test('organizer-assigned late identities wait for the next run under freeze-at-start', { skip: !enabled }, async () => {
  const huntId = `v3-assigned-roster-lock-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(huntId, 'organizer-assigned'));
  const assigned = await createOrganizerTeam({
    huntId,
    requestId: randomUUID(),
    displayName: 'Assigned Lock Crew',
    memberNames: [],
    pin: '909090',
    credentialSecret: 'integration-credential-secret',
    actor: 'Integration organizer',
    sessionHash: '7'.repeat(64),
  });
  const captain = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Assigned Captain', teamCode: assigned.code,
    pin: '909090', memberPin: '808080', requestSource: 'assigned-roster-lock',
  });
  await setHuntLifecycle(huntId, 'live', 1, 'Integration organizer');
  const run = await createRun(assigned.teamId, captain.summary.member.id, randomUUID());
  const late = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Late Runner', teamCode: assigned.code,
    pin: '909090', memberPin: '707070', requestSource: 'assigned-roster-lock',
  });
  assert.equal(late.summary.waitingForNextRun, true);
  assert.equal(Number((await getPool().query(
    'select count(*)::int as count from hunt_v3.run_members where run_id=$1 and member_id=$2',
    [run.runId, late.summary.member.id],
  )).rows[0].count), 0);
  const recovered = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Assigned Captain', teamCode: assigned.code,
    pin: '909090', memberPin: '808080', requestSource: 'assigned-roster-lock',
  });
  assert.equal(recovered.summary.member.id, captain.summary.member.id, 'the roster lock does not block a legitimate session recovery');
});

test('organizer-assigned run creation and queued join preserve one immutable per-run snapshot', { skip: !enabled }, async () => {
  const huntId = `v3-assigned-run-join-race-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(huntId, 'organizer-assigned'));
  const assigned = await createOrganizerTeam({
    huntId,
    requestId: randomUUID(),
    displayName: 'Assigned Race Crew',
    memberNames: [],
    pin: '919191',
    credentialSecret: 'integration-credential-secret',
    actor: 'Integration organizer',
    sessionHash: '8'.repeat(64),
  });
  const captain = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Race Captain', teamCode: assigned.code,
    pin: '919191', memberPin: '818181', requestSource: `assigned-run-join-captain-${huntId}`,
  });
  await setHuntLifecycle(huntId, 'live', 1, 'Integration organizer');

  const blocker = await getPool().connect();
  let blockerOpen = false;
  try {
    await blocker.query('begin');
    blockerOpen = true;
    await blocker.query('select id from hunt_v3.teams where id=$1 for update', [assigned.teamId]);
    const blockerPid = Number((await blocker.query('select pg_backend_pid() as pid')).rows[0].pid);
    const waitForLockWaiters = async (minimum: number) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const count = Number((await getPool().query(
          `select count(*)::int as count from pg_stat_activity
            where datname=current_database() and pid<>$1 and wait_event_type='Lock'`,
          [blockerPid],
        )).rows[0].count);
        if (count >= minimum) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.fail(`Expected at least ${minimum} transactions to wait behind the team-row barrier.`);
    };

    const firstRun = createRun(assigned.teamId, captain.summary.member.id, randomUUID());
    void firstRun.catch(() => undefined);
    await waitForLockWaiters(1);
    const lateJoin = registerV3Team({
      requestId: randomUUID(), huntId, intent: 'join', playerName: 'Queued Synthetic Runner', teamCode: assigned.code,
      pin: '919191', memberPin: '717171', requestSource: `assigned-run-join-late-${huntId}`,
    });
    void lateJoin.catch(() => undefined);
    await waitForLockWaiters(2);
    await blocker.query('commit');
    blockerOpen = false;

    const [runResult, joinResult] = await Promise.allSettled([firstRun, lateJoin]);
    assert.equal(runResult.status, 'fulfilled', 'the request queued first behind the team lock creates the first run');
    assert.equal(joinResult.status, 'fulfilled', 'the queued identity joins the persistent team after the run snapshot commits');
    assert.deepEqual(
      (await getPool().query('select name from hunt_v3.team_members where team_id=$1 order by created_at,id', [assigned.teamId])).rows,
      [{ name: 'Race Captain' }, { name: 'Queued Synthetic Runner' }],
      'the persistent roster records the late identity for a later attempt',
    );
    assert.deepEqual(
      (await getPool().query(
        `select member.member_id,member.member_name_snapshot
          from hunt_v3.run_members member join hunt_v3.runs run on run.id=member.run_id
          where run.team_id=$1 and run.run_number=1`,
        [assigned.teamId],
      )).rows,
      [{ member_id: captain.summary.member.id, member_name_snapshot: 'Race Captain' }],
      'the immutable first-run roster contains only identities committed before run creation',
    );
  } finally {
    if (blockerOpen) await blocker.query('rollback').catch(() => undefined);
    blocker.release();
  }
});

test('parent hunt locks are acquired before team and run mutation locks', { skip: !enabled }, async () => {
  const teamHuntId = `v3-hunt-team-order-${randomUUID().slice(0, 8)}`;
  await insertHunt(definition(teamHuntId, 'self-serve'));
  const pending = await registerV3Team({
    requestId: randomUUID(), huntId: teamHuntId, intent: 'create', playerName: 'Barrier Captain', teamName: 'Barrier Crew',
    pin: '131313', memberPin: '242424', requestSource: `hunt-team-barrier-${teamHuntId}`,
  });
  const huntTeamBlocker = await getPool().connect();
  let huntTeamOpen = false;
  try {
    await huntTeamBlocker.query('begin');
    huntTeamOpen = true;
    await huntTeamBlocker.query('select id from hunt_v3.hunts where id=$1 for update', [teamHuntId]);
    const blockerPid = Number((await huntTeamBlocker.query('select pg_backend_pid() as pid')).rows[0].pid);
    const approval = changeTeamCompetitionStatus({
      huntId: teamHuntId,
      teamId: pending.summary.team.id,
      action: 'approve',
      reason: 'Deterministic hunt-before-team barrier',
      expectedRevision: 1,
      requestId: randomUUID(),
      actor: 'Lock-order organizer',
      sessionHash: '9'.repeat(64),
    });
    void approval.catch(() => undefined);
    await waitForAnotherBackendLock(blockerPid, 'team competition control');
    const teamLock = await huntTeamBlocker.query(
      'select id from hunt_v3.teams where id=$1 for update nowait',
      [pending.summary.team.id],
    );
    assert.equal(teamLock.rowCount, 1, 'the waiting control has not taken the child team lock before the hunt lock');
    await huntTeamBlocker.query('commit');
    huntTeamOpen = false;
    assert.equal((await approval).approvalStatus, 'approved');
  } finally {
    if (huntTeamOpen) await huntTeamBlocker.query('rollback').catch(() => undefined);
    huntTeamBlocker.release();
  }

  const runHuntId = `v3-hunt-run-order-${randomUUID().slice(0, 8)}`;
  const runHunt = definition(runHuntId, 'organizer-assigned');
  runHunt.settings.recognition.enabled = true;
  await insertHunt(runHunt);
  const assigned = await createOrganizerTeam({
    huntId: runHuntId,
    requestId: randomUUID(),
    displayName: 'Run Barrier Crew',
    memberNames: [],
    pin: '353535',
    credentialSecret: 'integration-credential-secret',
    actor: 'Lock-order organizer',
    sessionHash: 'a'.repeat(64),
  });
  const captain = await registerV3Team({
    requestId: randomUUID(), huntId: runHuntId, intent: 'join', playerName: 'Run Barrier Captain', teamCode: assigned.code,
    pin: '353535', memberPin: '464646', requestSource: `hunt-run-barrier-${runHuntId}`,
  });
  await setHuntLifecycle(runHuntId, 'live', 1, 'Lock-order organizer');
  const run = await createRun(assigned.teamId, captain.summary.member.id, randomUUID());
  const revision = Number((await getPool().query(
    "select engine_state->>'revision' as revision from hunt_v3.runs where id=$1",
    [run.runId],
  )).rows[0].revision);
  const huntRunBlocker = await getPool().connect();
  let huntRunOpen = false;
  try {
    await huntRunBlocker.query('begin');
    huntRunOpen = true;
    await huntRunBlocker.query('select id from hunt_v3.hunts where id=$1 for update', [runHuntId]);
    const blockerPid = Number((await huntRunBlocker.query('select pg_backend_pid() as pid')).rows[0].pid);
    const recovery = controlRunGameplay({
      huntId: runHuntId,
      teamId: assigned.teamId,
      runId: run.runId,
      requestId: randomUUID(),
      expectedRevision: revision,
      control: 'extend_session',
      seconds: 60,
      reason: 'Deterministic hunt-before-run barrier',
      actor: 'Lock-order organizer',
      sessionHash: 'b'.repeat(64),
    });
    void recovery.catch(() => undefined);
    await waitForAnotherBackendLock(blockerPid, 'run recovery control');
    const runLock = await huntRunBlocker.query(
      'select id from hunt_v3.runs where id=$1 for update nowait',
      [run.runId],
    );
    assert.equal(runLock.rowCount, 1, 'the waiting recovery has not taken the child run lock before the hunt lock');
    await huntRunBlocker.query('commit');
    huntRunOpen = false;
    assert.equal((await recovery).control, 'extend_session');
  } finally {
    if (huntRunOpen) await huntRunBlocker.query('rollback').catch(() => undefined);
    huntRunBlocker.release();
  }

  // Exercise the lazy recognition-result path, which writes rows with both
  // team and run FKs. Two finish-screen reads must wait at the hunt parent and
  // then serialize on the run, rather than both allocating revision 1 or
  // acquiring a child lock before the lifecycle barrier.
  await getPool().query(
    `update hunt_v3.runs set status='completed',completed_at=clock_timestamp(),elapsed_ms=0,
      recognition_closes_at=clock_timestamp()+interval '1 hour' where id=$1`,
    [run.runId],
  );
  const recognitionBlocker = await getPool().connect();
  let recognitionBlockerOpen = false;
  try {
    await recognitionBlocker.query('begin');
    recognitionBlockerOpen = true;
    await recognitionBlocker.query('select id from hunt_v3.hunts where id=$1 for update', [runHuntId]);
    const blockerPid = Number((await recognitionBlocker.query('select pg_backend_pid() as pid')).rows[0].pid);
    const firstRead = privateRecognition(assigned.teamId, captain.summary.member.id, run.runId);
    const secondRead = privateRecognition(assigned.teamId, captain.summary.member.id, run.runId);
    void firstRead.catch(() => undefined);
    void secondRead.catch(() => undefined);
    await waitForAnotherBackendLock(blockerPid, 'recognition result materialization', 2);
    assert.equal((await recognitionBlocker.query(
      'select id from hunt_v3.teams where id=$1 for update nowait',
      [assigned.teamId],
    )).rowCount, 1);
    assert.equal((await recognitionBlocker.query(
      'select id from hunt_v3.runs where id=$1 for update nowait',
      [run.runId],
    )).rowCount, 1);
    await recognitionBlocker.query('commit');
    recognitionBlockerOpen = false;
    const [firstBoard, secondBoard] = await Promise.all([firstRead, secondRead]);
    assert.equal(firstBoard.results.length, 1);
    assert.equal(secondBoard.results.length, 1);
    assert.equal(Number((await getPool().query(
      'select count(*)::int as count from hunt_v3.recognition_results where run_id=$1',
      [run.runId],
    )).rows[0].count), 1, 'concurrent lazy reads materialize one result revision');
  } finally {
    if (recognitionBlockerOpen) await recognitionBlocker.query('rollback').catch(() => undefined);
    recognitionBlocker.release();
  }
});

test('disabled policy restores exactly the official slot invalidated by team disqualification', { skip: !enabled }, async () => {
  const huntId = `v3-disabled-restore-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId, 'organizer-assigned');
  hunt.settings.runPolicy = { mode: 'disabled' };
  await insertHunt(hunt);
  const assigned = await createOrganizerTeam({
    huntId, requestId: randomUUID(), displayName: 'Disabled Restore Crew', memberNames: [], pin: '575757',
    credentialSecret: 'integration-credential-secret', actor: 'Restore organizer', sessionHash: 'c'.repeat(64),
  });
  const captain = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Disabled Captain', teamCode: assigned.code,
    pin: '575757', memberPin: '686868', requestSource: `disabled-restore-${huntId}`,
  });
  await setHuntLifecycle(huntId, 'live', 1, 'Restore organizer');
  const first = await createRun(assigned.teamId, captain.summary.member.id, randomUUID());
  const initialRevision = captain.summary.team.competitionRevision;
  const disqualified = await changeTeamCompetitionStatus({
    huntId, teamId: assigned.teamId, action: 'disqualify', reason: 'Confirmed duplicate team identity', expectedRevision: initialRevision,
    requestId: randomUUID(), actor: 'Restore organizer', sessionHash: 'c'.repeat(64),
  });
  assert.equal(disqualified.newlyInvalidatedOfficialRuns, 1);
  const restored = await changeTeamCompetitionStatus({
    huntId, teamId: assigned.teamId, action: 'restore', reason: 'Identity issue resolved for future attempts', expectedRevision: initialRevision + 1,
    requestId: randomUUID(), actor: 'Restore organizer', sessionHash: 'c'.repeat(64),
  });
  assert.equal(restored.replacementOfficialRunsAvailable, 1);
  const signedInAgain = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Disabled Captain', teamCode: assigned.code,
    pin: '575757', memberPin: '686868', requestSource: `disabled-restore-again-${huntId}`,
  });
  assert.equal(signedInAgain.summary.officialAttemptCount, 1);
  assert.equal(signedInAgain.summary.officialAttemptSlotsUsed, 0);
  assert.equal(signedInAgain.summary.remainingOfficialRuns, 1);
  const replacement = await createRun(assigned.teamId, captain.summary.member.id, randomUUID());
  await completeSimpleRun(assigned.teamId, captain.summary.member.id, replacement.runId);
  await assert.rejects(createRun(assigned.teamId, captain.summary.member.id, randomUUID()), /turned off replays/i);
  assert.deepEqual(
    (await getPool().query(
      'select id,run_number,status,eligible,ineligibility_reason from hunt_v3.runs where team_id=$1 order by run_number',
      [assigned.teamId],
    )).rows,
    [
      { id: first.runId, run_number: 1, status: 'disqualified', eligible: false, ineligibility_reason: 'Team disqualified by organizer' },
      { id: replacement.runId, run_number: 2, status: 'completed', eligible: true, ineligibility_reason: null },
    ],
    'the historical result stays ineligible while one clean replacement consumes the disabled-policy slot',
  );
});

test('capped policy makes practice a permanent one-way boundary even after organizer restoration', { skip: !enabled }, async () => {
  const huntId = `v3-capped-restore-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId, 'organizer-assigned');
  hunt.settings.runPolicy = { mode: 'capped', maxOfficialRuns: 2 };
  hunt.settings.routePlan.choose = { count: 1, fromCheckpointIds: ['option-a', 'option-b'] };
  hunt.settings.routePlan.checkpointEstimates = {
    ...hunt.settings.routePlan.checkpointEstimates,
    'option-a': { durationMinutes: 1 },
    'option-b': { durationMinutes: 1 },
  };
  hunt.settings.routePlan.travelEstimates = [
    { from: 'start', to: 'option-a', durationMinutes: 1 },
    { from: 'start', to: 'option-b', durationMinutes: 1 },
    { from: 'option-a', to: 'finale', durationMinutes: 1 },
    { from: 'option-b', to: 'finale', durationMinutes: 1 },
  ];
  hunt.checkpoints.splice(1, 0,
    {
      id: 'option-a', title: 'Option A', basePoints: 10, hints: [],
      flow: { startNodeId: 'option-a-message', nodes: [
        { id: 'option-a-message', type: 'show_text', text: 'Route A.', next: 'option-a-done' },
        { id: 'option-a-done', type: 'complete' },
      ] },
    },
    {
      id: 'option-b', title: 'Option B', basePoints: 10, hints: [],
      flow: { startNodeId: 'option-b-message', nodes: [
        { id: 'option-b-message', type: 'show_text', text: 'Route B.', next: 'option-b-done' },
        { id: 'option-b-done', type: 'complete' },
      ] },
    },
  );
  await insertHunt(hunt);
  const assigned = await createOrganizerTeam({
    huntId, requestId: randomUUID(), displayName: 'Capped Restore Crew', memberNames: [], pin: '797979',
    credentialSecret: 'integration-credential-secret', actor: 'Restore organizer', sessionHash: 'd'.repeat(64),
  });
  const captain = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Capped Captain', teamCode: assigned.code,
    pin: '797979', memberPin: '808080', requestSource: `capped-restore-${huntId}`,
  });
  await setHuntLifecycle(huntId, 'live', 1, 'Restore organizer');
  const unrelated = await createRun(assigned.teamId, captain.summary.member.id, randomUUID());
  await getPool().query(
    `update hunt_v3.runs set status='abandoned',eligible=false,ineligibility_reason='Independent GPS integrity review'
      where id=$1`,
    [unrelated.runId],
  );
  const invalidated = await createRun(assigned.teamId, captain.summary.member.id, randomUUID());
  await completeSimpleRun(assigned.teamId, captain.summary.member.id, invalidated.runId);
  const firstPractice = await createRun(assigned.teamId, captain.summary.member.id, randomUUID(), true);
  await completeSimpleRun(assigned.teamId, captain.summary.member.id, firstPractice.runId);
  const secondPractice = await createRun(assigned.teamId, captain.summary.member.id, randomUUID(), true);
  await completeSimpleRun(assigned.teamId, captain.summary.member.id, secondPractice.runId);
  const preRestoreAllocation = (await getPool().query(
    `select id,plan_key,allocation_cycle,practice from hunt_v3.runs
      where team_id=$1 order by run_number`,
    [assigned.teamId],
  )).rows;
  assert.equal(new Set(preRestoreAllocation.slice(0, 2).map(row => row.plan_key)).size, 2);
  assert.deepEqual(preRestoreAllocation.slice(0, 2).map(row => row.allocation_cycle), [0, 0]);
  assert.deepEqual(preRestoreAllocation.slice(2).map(row => row.allocation_cycle), [1, 1]);
  assert.deepEqual(
    new Set(preRestoreAllocation.slice(2).map(row => row.plan_key)),
    new Set(preRestoreAllocation.slice(0, 2).map(row => row.plan_key)),
    'practice exhausts the two already-exposed structures without revealing a third plan',
  );
  const initialRevision = captain.summary.team.competitionRevision;
  const disqualified = await changeTeamCompetitionStatus({
    huntId, teamId: assigned.teamId, action: 'disqualify', reason: 'Second attempt used a duplicate identity', expectedRevision: initialRevision,
    requestId: randomUUID(), actor: 'Restore organizer', sessionHash: 'd'.repeat(64),
  });
  assert.equal(disqualified.newlyInvalidatedOfficialRuns, 1, 'the already-ineligible unrelated attempt is not reclassified');
  const restored = await changeTeamCompetitionStatus({
    huntId, teamId: assigned.teamId, action: 'restore', reason: 'Future participation approved after identity review', expectedRevision: initialRevision + 1,
    requestId: randomUUID(), actor: 'Restore organizer', sessionHash: 'd'.repeat(64),
  });
  assert.equal(restored.replacementOfficialRunsAvailable, 0);
  assert.equal(restored.officialReplacementBlockedByPractice, true);
  const signedInAgain = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Capped Captain', teamCode: assigned.code,
    pin: '797979', memberPin: '808080', requestSource: `capped-restore-again-${huntId}`,
  });
  assert.equal(signedInAgain.summary.officialAttemptCount, 2);
  assert.equal(signedInAgain.summary.officialAttemptSlotsUsed, 1);
  assert.equal(signedInAgain.summary.hasPracticeRun, true);
  assert.equal(signedInAgain.summary.remainingOfficialRuns, 0);
  await assert.rejects(
    createRun(assigned.teamId, captain.summary.member.id, randomUUID()),
    /now in replay mode/i,
    'a restore cannot convert knowledge gained in practice back into an official attempt',
  );
  const continuedPractice = await createRun(assigned.teamId, captain.summary.member.id, randomUUID(), true);
  assert.equal(continuedPractice.practice, true);
  await completeSimpleRun(assigned.teamId, captain.summary.member.id, continuedPractice.runId);
  assert.deepEqual(
    (await getPool().query(
      'select id,run_number,status,eligible,ineligibility_reason from hunt_v3.runs where team_id=$1 order by run_number',
      [assigned.teamId],
    )).rows,
    [
      { id: unrelated.runId, run_number: 1, status: 'abandoned', eligible: false, ineligibility_reason: 'Independent GPS integrity review' },
      { id: invalidated.runId, run_number: 2, status: 'completed', eligible: false, ineligibility_reason: 'Team disqualified by organizer' },
      { id: firstPractice.runId, run_number: 3, status: 'completed', eligible: false, ineligibility_reason: null },
      { id: secondPractice.runId, run_number: 4, status: 'completed', eligible: false, ineligibility_reason: null },
      { id: continuedPractice.runId, run_number: 5, status: 'completed', eligible: false, ineligibility_reason: null },
    ],
  );
});

test('an untimed run is terminalized once when its pinned publication schedule ends', { skip: !enabled }, async () => {
  const huntId = `v3-schedule-expiry-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId, 'organizer-assigned');
  hunt.settings.sessionDurationSeconds = undefined;
  // Keep the published version genuinely immutable. A short future boundary
  // lets the test observe the same database-clock transition as production.
  hunt.settings.endsAt = new Date(Date.now() + 3_000).toISOString();
  await insertHunt(hunt);
  const assigned = await createOrganizerTeam({
    huntId, requestId: randomUUID(), displayName: 'Schedule Expiry Crew', memberNames: [], pin: '818181',
    credentialSecret: 'integration-credential-secret', actor: 'Schedule organizer', sessionHash: 'e'.repeat(64),
  });
  const captain = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Schedule Captain', teamCode: assigned.code,
    pin: '818181', memberPin: '929292', requestSource: `schedule-expiry-${huntId}`,
  });
  await setHuntLifecycle(huntId, 'live', 1, 'Schedule organizer');
  const run = await createRun(assigned.teamId, captain.summary.member.id, randomUUID());
  assert.equal((await getPool().query("select engine_state ? 'timer' as timed from hunt_v3.runs where id=$1", [run.runId])).rows[0].timed, false);
  const before = await publicLeaderboard(hunt.settings.publicBoard.slug!) as unknown as { main: Array<{ teamCode: string; status?: string }> };
  assert.equal(before.main.find(row => row.teamCode === assigned.code)?.status, 'active', 'the open attempt is initially visible as active');

  while (!(await getPool().query(
    'select clock_timestamp()>=$1::timestamptz as expired',
    [hunt.settings.endsAt],
  )).rows[0].expired) await new Promise(resolve => setTimeout(resolve, 25));
  const after = await publicLeaderboard(hunt.settings.publicBoard.slug!) as unknown as { main: Array<{ teamCode: string; status?: string }> };
  assert.equal(after.main.find(row => row.teamCode === assigned.code)?.status, 'registered', 'the public board drops the expired provisional attempt');
  assert.deepEqual(
    (await getPool().query('select status,eligible,ineligibility_reason from hunt_v3.runs where id=$1', [run.runId])).rows[0],
    { status: 'abandoned', eligible: false, ineligibility_reason: 'Published hunt end time passed' },
  );
  await assert.rejects(createRun(assigned.teamId, captain.summary.member.id, randomUUID()), /latest start time has passed/i);
  assert.equal(Number((await getPool().query(
    "select count(*)::int as count from hunt_v3.run_events where run_id=$1 and event_type='run_schedule_ended'",
    [run.runId],
  )).rows[0].count), 1);
  assert.equal(Number((await getPool().query(
    "select count(*)::int as count from hunt_v3.admin_events where run_id=$1 and action='run_schedule_ended'",
    [run.runId],
  )).rows[0].count), 1);
});

test('final board waits for gameplay, requires ended/no-open state, and blocks on pending photo review', { skip: !enabled }, async () => {
  const huntId = `v3-final-barrier-${randomUUID().slice(0, 8)}`;
  const hunt = definition(huntId, 'organizer-assigned');
  await insertHunt(hunt);
  const assigned = await createOrganizerTeam({
    huntId, requestId: randomUUID(), displayName: 'Final Barrier Crew', memberNames: [], pin: '141414',
    credentialSecret: 'integration-credential-secret', actor: 'Final organizer', sessionHash: 'f'.repeat(64),
  });
  const captain = await registerV3Team({
    requestId: randomUUID(), huntId, intent: 'join', playerName: 'Final Captain', teamCode: assigned.code,
    pin: '141414', memberPin: '252525', requestSource: `final-barrier-${huntId}`,
  });
  await setHuntLifecycle(huntId, 'live', 1, 'Final organizer');
  const run = await createRun(assigned.teamId, captain.summary.member.id, randomUUID());
  await assert.rejects(
    freezePublicBoard(huntId, true, 'Final organizer'),
    (error: unknown) => {
      const typed = error as { status?: number; details?: { issues?: Array<{ path: string }> } };
      assert.equal(typed.status, 409);
      assert.deepEqual(typed.details?.issues?.map(issue => issue.path), ['hunt.status', 'runs.status']);
      return true;
    },
  );

  const blocker = await getPool().connect();
  let blockerOpen = false;
  try {
    await blocker.query('begin');
    blockerOpen = true;
    await blocker.query('select id from hunt_v3.runs where id=$1 for update', [run.runId]);
    const blockerPid = Number((await blocker.query('select pg_backend_pid() as pid')).rows[0].pid);
    const command = applyRunCommand(assigned.teamId, captain.summary.member.id, run.runId, randomUUID(), {
      type: 'continue', checkpointId: 'start', nodeId: 'start-message',
    });
    void command.catch(() => undefined);
    await waitForAnotherBackendLock(blockerPid, 'gameplay command');
    const finalize = freezePublicBoard(huntId, true, 'Final organizer');
    void finalize.catch(() => undefined);
    await waitForAnotherBackendLock(blockerPid, 'gameplay plus finalization', 2);
    await blocker.query('commit');
    blockerOpen = false;
    assert.equal((await command).view.checkpoint?.id, 'finale', 'the accepted command commits before the finalizer crosses the hunt barrier');
    await assert.rejects(finalize, /final board is not ready/i, 'the finalizer re-checks current state after the command commits');
  } finally {
    if (blockerOpen) await blocker.query('rollback').catch(() => undefined);
    blocker.release();
  }

  const task = (await getPool().query(
    `select engine_state #>> array['checkpoints','finale','nodes','finish-message','startedAt'] as started_at
      from hunt_v3.runs where id=$1`,
    [run.runId],
  )).rows[0];
  assert.ok(task.started_at);
  const mediaId = randomUUID();
  await getPool().query(
    `insert into hunt_v3.media(
      id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,kind,content_type,bytes,content_hash,storage_key,
      review_status,retention,submitted_at,task_started_at)
      values($1,$2,$3,$4,$5,'finale','finish-message','photo','image/jpeg',1,$6,$7,'pending','after_review',clock_timestamp(),$8)`,
    [mediaId, huntId, assigned.teamId, run.runId, captain.summary.member.id, 'f'.repeat(64), `${mediaId}-fixture`, task.started_at],
  );

  await setHuntLifecycle(huntId, 'ended', 2, 'Final organizer');
  assert.deepEqual(
    (await getPool().query('select status,eligible,ineligibility_reason from hunt_v3.runs where id=$1', [run.runId])).rows[0],
    { status: 'abandoned', eligible: false, ineligibility_reason: 'Hunt ended by organizer' },
    'ending the event atomically closes an unfinished attempt instead of leaving a ghost active row',
  );
  assert.equal(Number((await getPool().query(
    "select count(*)::int as count from hunt_v3.admin_events where run_id=$1 and action='run_ended_by_organizer'",
    [run.runId],
  )).rows[0].count), 1);
  await assert.rejects(
    freezePublicBoard(huntId, true, 'Final organizer'),
    (error: unknown) => {
      const typed = error as { status?: number; details?: { issues?: Array<{ path: string }> } };
      assert.equal(typed.status, 409);
      assert.deepEqual(typed.details?.issues?.map(issue => issue.path), ['media.reviewStatus']);
      return true;
    },
  );
  await reviewPhoto({
    mediaId, approved: false, reason: 'Event ended before this evidence could affect play', requestId: randomUUID(), actor: 'Final organizer',
  });
  const finalized = await freezePublicBoard(huntId, true, 'Final organizer');
  assert.equal(finalized.ok, true);
  assert.equal((await getPool().query('select event_status from hunt_v3.public_boards where hunt_id=$1', [huntId])).rows[0].event_status, 'final');
});

test('team competition controls require a reason before changing state', { skip: !enabled }, async () => {
  await assert.rejects(
    changeTeamCompetitionStatus({
      huntId: 'missing-hunt',
      teamId: randomUUID(),
      action: 'approve',
      reason: '   ',
      expectedRevision: 1,
      requestId: randomUUID(),
      actor: 'Integration organizer',
      sessionHash: '5'.repeat(64),
    }),
    /give a reason/i,
  );
});
