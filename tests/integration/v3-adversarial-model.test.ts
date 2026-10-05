import '../isolated-database';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getPool } from '../../lib/server/db';
import { validateV3Definition } from '../../lib/server/v3/authoring';
import { publicLeaderboard } from '../../lib/server/v3/leaderboards';
import {
  changeTeamCompetitionStatus,
  createOrganizerTeam,
  setHuntLifecycle,
} from '../../lib/server/v3/operations';
import { registerV3Team } from '../../lib/server/v3/registration';
import { applyRunCommand, createRun, currentRunView } from '../../lib/server/v3/runs';
import { digest } from '../../lib/server/v3/security';
import { validateFairness } from '../../lib/v3/fairness';
import type { V3Definition } from '../../lib/v3/types';

const enabled = Boolean(process.env.DATABASE_URL);
const MODEL_SEED = 0x5eedc0de;
const PRIVATE_SENTINEL = 'MODEL-PRIVATE-SENTINEL-DO-NOT-PROJECT-9X7Q';

type Player = { teamId: string; teamCode: string; memberId: string; name: string };
type ImmutableRun = {
  hunt_version: number;
  private_seed: string;
  seed_commitment: string;
  plan_key: string;
  allocation_cycle: number;
  route_plan: unknown;
  resolved_variables: unknown;
};

function fixedUuid(label: string) {
  const hex = createHash('sha256').update(`${MODEL_SEED}:${label}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function deterministicRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
    return ((mixed ^ mixed >>> 14) >>> 0) / 4_294_967_296;
  };
}

function definition(id: string): V3Definition {
  return {
    schemaVersion: 3,
    id,
    version: 1,
    title: 'Deterministic adversarial model',
    settings: {
      mode: 'sequential',
      map: 'none',
      rules: 'Use only your starting roster and your own run.',
      minTeamSize: 2,
      maxTeamSize: 4,
      sessionDurationSeconds: 3600,
      registrationOpen: true,
      completionMessage: 'Model run complete.',
      photoRetention: 'after_verification',
      registrationMode: 'organizer-assigned',
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
        title: 'Adversarial model board',
        status: 'live',
        teamIdentity: 'code_and_name',
        columns: ['rank', 'team_code', 'team_name', 'points', 'progress', 'completion_status'],
      },
      socialShare: { enabled: false, allowPersonalTitle: false },
      recognition: {
        enabled: false,
        peerVotingEnabled: false,
        votingWindowMinutes: 60,
        dataWeight: 0.7,
        peerWeight: 0.3,
      },
      routePlan: {
        startCheckpointId: 'start',
        finaleCheckpointId: 'finale',
        requiredCheckpointIds: [],
        choose: { count: 1, fromCheckpointIds: ['route-a', 'route-b'] },
        shuffleSelectedCheckpoints: false,
        avoidTransitions: [],
        checkpointEstimates: {
          start: { durationMinutes: 1 },
          'route-a': { durationMinutes: 1 },
          'route-b': { durationMinutes: 1 },
          finale: { durationMinutes: 1 },
        },
        travelEstimates: [
          { from: 'start', to: 'route-a', durationMinutes: 0 },
          { from: 'route-a', to: 'finale', durationMinutes: 0 },
          { from: 'start', to: 'route-b', durationMinutes: 0 },
          { from: 'route-b', to: 'finale', durationMinutes: 0 },
        ],
      },
      challengePools: {},
      variableGenerators: {
        privateSentinel: { type: 'literal', value: PRIVATE_SENTINEL },
        answerCode: { type: 'code', alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', length: 8 },
      },
      fairnessPolicy: {
        minimumDistinctPlans: 2,
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
        id: 'start',
        title: 'Answer gate',
        basePoints: 10,
        required: true,
        hints: [],
        flow: {
          startNodeId: 'answer',
          nodes: [
            {
              id: 'answer',
              type: 'verify_answer',
              prompt: 'Enter the event answer.',
              answers: ['{{answerCode}}'],
              caseSensitive: false,
              next: 'private-bonus',
            },
            {
              id: 'private-bonus',
              type: 'add_points',
              amount: 3,
              label: 'Excluded model bonus',
              rankingImpact: 'excluded',
              next: 'start-done',
            },
            { id: 'start-done', type: 'complete' },
          ],
        },
      },
      {
        id: 'route-a',
        title: 'Route A',
        basePoints: 0,
        hints: [],
        flow: { startNodeId: 'route-a-done', nodes: [{ id: 'route-a-done', type: 'complete' }] },
      },
      {
        id: 'route-b',
        title: 'Route B',
        basePoints: 0,
        hints: [],
        flow: { startNodeId: 'route-b-done', nodes: [{ id: 'route-b-done', type: 'complete' }] },
      },
      {
        id: 'finale',
        title: 'Finale',
        basePoints: 10,
        required: true,
        hints: [],
        flow: {
          startNodeId: 'finish-message',
          nodes: [
            { id: 'finish-message', type: 'show_text', text: 'Finish together.', next: 'finish-done' },
            { id: 'finish-done', type: 'complete' },
          ],
        },
      },
    ],
  };
}

async function insertHunt(value: V3Definition) {
  const validation = validateV3Definition(value, { externalAuthoring: false });
  assert.deepEqual(validation.issues, [], JSON.stringify(validation.issues));
  const fairness = validation.fairness ?? validateFairness(value);
  assert.equal(fairness.valid, true, JSON.stringify(fairness.issues));
  await getPool().query(
    `insert into hunt_v3.hunts(
      id,title,slug,status,registration_mode,registration_open,latest_version,settings)
      values($1,$2,$1,'live','organizer_assigned',true,1,$3)`,
    [value.id, value.title, value.settings],
  );
  await getPool().query(
    `insert into hunt_v3.hunt_versions(
      hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,1,$2,$3,$4,$5)`,
    [value.id, value, 'a'.repeat(64), { valid: true, issues: [] }, fairness],
  );
  await getPool().query(
    `insert into hunt_v3.public_boards(
      hunt_id,slug,enabled,title,event_status,visible_columns,
      main_board_visible,replay_board_visible,team_name_mode)
      values($1,$2,true,'Adversarial model board','live',$3,true,true,'display_name')`,
    [value.id, value.settings.publicBoard.slug, value.settings.publicBoard.columns],
  );
}

async function createAssignedTeam(input: {
  huntId: string;
  label: string;
  displayName: string;
  teamPin: string;
  captainPin: string;
  scoutPin: string;
}) {
  const created = await createOrganizerTeam({
    huntId: input.huntId,
    requestId: fixedUuid(`${input.label}-create-team`),
    displayName: input.displayName,
    memberNames: [],
    pin: input.teamPin,
    credentialSecret: 'deterministic-adversarial-credential-secret',
    actor: 'Adversarial test organizer',
    sessionHash: 'd'.repeat(64),
  });
  const join = async (role: 'captain' | 'scout', memberPin: string) => {
    const name = `${input.label} ${role}`;
    const result = await registerV3Team({
      requestId: fixedUuid(`${input.label}-${role}-join`),
      huntId: input.huntId,
      intent: 'join',
      playerName: name,
      teamCode: created.code,
      pin: input.teamPin,
      memberPin,
      requestSource: `model-${input.huntId}-${input.label}-${role}`,
    });
    return { teamId: created.teamId, teamCode: created.code, memberId: result.summary.member.id, name } satisfies Player;
  };
  return {
    created,
    captain: await join('captain', input.captainPin),
    scout: await join('scout', input.scoutPin),
  };
}

before(async () => {
  if (!enabled) return;
  await getPool().query(await readFile(new URL('../../database/v3.sql', import.meta.url), 'utf8'));
});

after(async () => {
  if (enabled) await getPool().end();
});

test('PostgreSQL V3 deterministic adversarial command model preserves authority and ranking invariants', { skip: !enabled }, async () => {
  const trace: string[] = [];
  const immutableRuns = new Map<string, ImmutableRun>();
  const frozenRosters = new Map<string, string[]>();
  const expectedOpenRuns = new Map<string, string>();
  const random = deterministicRandom(MODEL_SEED);
  const huntId = `v3-adversarial-${randomUUID().slice(0, 8)}`;
  const boardSlug = `${huntId}-board`;

  const assertDatabaseInvariants = async (label: string) => {
    const openRows = (await getPool().query(
      `select team_id,id from hunt_v3.runs
        where hunt_id=$1 and status in ('waiting','active') order by team_id,id`,
      [huntId],
    )).rows as Array<{ team_id: string; id: string }>;
    assert.equal(new Set(openRows.map(row => row.team_id)).size, openRows.length, `${label}: at most one open run per team`);
    assert.deepEqual(
      Object.fromEntries(openRows.map(row => [row.team_id, row.id]).sort()),
      Object.fromEntries([...expectedOpenRuns.entries()].sort()),
      `${label}: database open runs match the state model`,
    );

    const invalidActors = await getPool().query(
      `select event.id,event.run_id,event.actor_member_id
        from hunt_v3.run_events event
        join hunt_v3.runs run on run.id=event.run_id
        left join hunt_v3.run_members member
          on member.run_id=event.run_id and member.team_id=event.team_id
          and member.member_id=event.actor_member_id
        where run.hunt_id=$1 and event.actor_kind='member'
          and (event.actor_member_id is null or member.member_id is null)`,
      [huntId],
    );
    assert.equal(invalidActors.rowCount, 0, `${label}: every member event actor belongs to the frozen run roster`);

    const rows = (await getPool().query(
      `select id,hunt_version,private_seed,seed_commitment,plan_key,allocation_cycle,
        route_plan,resolved_variables,score,bonus_score
        from hunt_v3.runs where hunt_id=$1 order by team_id,run_number`,
      [huntId],
    )).rows as Array<ImmutableRun & { id: string; score: number; bonus_score: number }>;
    for (const row of rows) {
      const immutable: ImmutableRun = {
        hunt_version: Number(row.hunt_version),
        private_seed: row.private_seed,
        seed_commitment: row.seed_commitment,
        plan_key: row.plan_key,
        allocation_cycle: Number(row.allocation_cycle),
        route_plan: row.route_plan,
        resolved_variables: row.resolved_variables,
      };
      const original = immutableRuns.get(row.id);
      if (original) assert.deepEqual(immutable, original, `${label}: run seed, plan, route and variables are immutable`);
      else immutableRuns.set(row.id, immutable);

      const roster = (await getPool().query(
        'select member_id from hunt_v3.run_members where run_id=$1 order by member_id',
        [row.id],
      )).rows.map(member => String(member.member_id));
      const originalRoster = frozenRosters.get(row.id);
      if (originalRoster) assert.deepEqual(roster, originalRoster, `${label}: starting roster remains frozen`);
      else frozenRosters.set(row.id, roster);
    }

    const cacheRows = (await getPool().query(
      `select run.id,run.score,run.bonus_score,
        coalesce(sum(ledger.amount) filter(where ledger.counts_for_ranking),0)::int as official_sum,
        coalesce(sum(ledger.amount) filter(where not ledger.counts_for_ranking),0)::int as bonus_sum
        from hunt_v3.runs run
        left join hunt_v3.score_ledger ledger on ledger.run_id=run.id
        where run.hunt_id=$1
        group by run.id order by run.id`,
      [huntId],
    )).rows;
    for (const row of cacheRows) {
      assert.equal(row.score, row.official_sum, `${label}: official score cache equals its ledger sum`);
      assert.equal(row.bonus_score, row.bonus_sum, `${label}: bonus cache equals its ledger sum`);
    }
  };

  const step = async <T>(label: string, action: () => Promise<T>, check = true) => {
    trace.push(`${trace.length + 1}. ${label}`);
    const result = await action();
    if (check) await assertDatabaseInvariants(label);
    return result;
  };

  const assertRedacted = (label: string, projection: unknown) => {
    const serialized = JSON.stringify(projection);
    assert.equal(serialized.includes(PRIVATE_SENTINEL), false, `${label}: private sentinel is redacted`);
    for (const run of immutableRuns.values()) {
      assert.equal(serialized.includes(run.private_seed), false, `${label}: private seed is redacted`);
      assert.equal(serialized.includes(run.seed_commitment), false, `${label}: seed commitment is redacted`);
      assert.equal(serialized.includes(run.plan_key), false, `${label}: structural plan key is redacted`);
    }
  };

  try {
    await step('publish the live organizer-assigned test hunt', async () => insertHunt(definition(huntId)));
    const alpha = await step('create and check in Alpha captain and scout', () => createAssignedTeam({
      huntId,
      label: 'Alpha',
      displayName: 'Model Alpha',
      teamPin: '410001',
      captainPin: '510001',
      scoutPin: '510002',
    }));
    const beta = await step('create and check in Beta captain and scout', () => createAssignedTeam({
      huntId,
      label: 'Beta',
      displayName: 'Model Beta',
      teamPin: '420001',
      captainPin: '520001',
      scoutPin: '520002',
    }));

    const alphaCreateRequest = fixedUuid('alpha-first-create');
    const alphaRun = await step('start Alpha Run 1', async () => {
      const run = await createRun(alpha.created.teamId, alpha.captain.memberId, alphaCreateRequest);
      expectedOpenRuns.set(alpha.created.teamId, run.runId);
      return run;
    });
    const betaRun = await step('start Beta Run 1', async () => {
      const run = await createRun(beta.created.teamId, beta.captain.memberId, fixedUuid('beta-first-create'));
      expectedOpenRuns.set(beta.created.teamId, run.runId);
      return run;
    });
    const runAnswer = async (runId: string) => String((await getPool().query(
      'select resolved_variables->>\'answerCode\' as answer from hunt_v3.runs where id=$1',
      [runId],
    )).rows[0].answer);
    const alphaAnswer = await runAnswer(alphaRun.runId);
    const betaAnswer = await runAnswer(betaRun.runId);
    assert.equal(frozenRosters.get(alphaRun.runId)?.length, 2);
    assert.equal(frozenRosters.get(betaRun.runId)?.length, 2);

    await step('replay Alpha create receipt and reject a changed practice payload', async () => {
      assert.equal(
        (await createRun(alpha.created.teamId, alpha.captain.memberId, alphaCreateRequest)).runId,
        alphaRun.runId,
      );
      await assert.rejects(
        createRun(alpha.created.teamId, alpha.captain.memberId, alphaCreateRequest, true),
        /request ID was already used/i,
      );
    });

    await step('concurrent Alpha create requests all resume the one open run', async () => {
      const resumed = await Promise.all(Array.from({ length: 5 }, (_, index) =>
        createRun(alpha.created.teamId, alpha.captain.memberId, fixedUuid(`alpha-resume-${index}`))));
      assert.deepEqual(new Set(resumed.map(run => run.runId)), new Set([alphaRun.runId]));
    });

    await step('wrong team, run, and member combinations cannot act', async () => {
      const command = { type: 'verify' as const, checkpointId: 'start', nodeId: 'answer', value: alphaAnswer };
      await assert.rejects(
        applyRunCommand(beta.created.teamId, beta.captain.memberId, alphaRun.runId, fixedUuid('wrong-team-run'), command),
        /run not found/i,
      );
      await assert.rejects(
        applyRunCommand(alpha.created.teamId, beta.captain.memberId, alphaRun.runId, fixedUuid('wrong-cross-team-member'), command),
        /run not found/i,
      );
      await assert.rejects(
        createRun(alpha.created.teamId, beta.captain.memberId, fixedUuid('wrong-create-member')),
        /check in with an active team membership/i,
      );
    });

    const lateMemberId = randomUUID();
    await step('late identities cannot join or mutate the frozen Alpha roster', async () => {
      await assert.rejects(
        registerV3Team({
          requestId: fixedUuid('alpha-late-api-join'),
          huntId,
          intent: 'join',
          playerName: 'Alpha late member',
          teamCode: alpha.created.code,
          pin: '410001',
          memberPin: '510003',
          requestSource: `model-${huntId}-alpha-late`,
        }),
        /roster was locked when its first run started/i,
      );
      await getPool().query(
        `insert into hunt_v3.team_members(id,team_id,name,name_key,status,checked_in_at)
          values($1,$2,'Injected late member',$3,'active',clock_timestamp())`,
        [lateMemberId, alpha.created.teamId, `injected-${lateMemberId}`],
      );
      await assert.rejects(
        getPool().query(
          `insert into hunt_v3.run_members(run_id,team_id,member_id,member_name_snapshot)
            values($1,$2,$3,'Injected late member')`,
          [alphaRun.runId, alpha.created.teamId, lateMemberId],
        ),
        /membership is frozen/i,
      );
      await assert.rejects(
        applyRunCommand(alpha.created.teamId, lateMemberId, alphaRun.runId, fixedUuid('late-member-command'), {
          type: 'verify', checkpointId: 'start', nodeId: 'answer', value: alphaAnswer,
        }),
        /starting roster/i,
      );
    });

    const alphaInitialView = await currentRunView(alpha.created.teamId, alpha.captain.memberId, alphaRun.runId);
    const betaInitialView = await currentRunView(beta.created.teamId, beta.captain.memberId, betaRun.runId);
    assertRedacted('Alpha initial player projection', alphaInitialView);
    assertRedacted('Beta initial player projection', betaInitialView);

    const duplicateCommandRequest = fixedUuid('alpha-duplicate-wrong-answer');
    const duplicateCommand = {
      type: 'verify' as const,
      checkpointId: 'start',
      nodeId: 'answer',
      value: 'wrong-1',
    };
    await step('concurrent exact command retries consume one durable attempt', async () => {
      const duplicateResults = await Promise.all([
        applyRunCommand(alpha.created.teamId, alpha.captain.memberId, alphaRun.runId, duplicateCommandRequest, duplicateCommand),
        applyRunCommand(alpha.created.teamId, alpha.captain.memberId, alphaRun.runId, duplicateCommandRequest, duplicateCommand),
      ]);
      assert.deepEqual(duplicateResults.map(result => result.feedback.status), ['rejected', 'rejected']);
      await assert.rejects(
        applyRunCommand(alpha.created.teamId, alpha.captain.memberId, alphaRun.runId, duplicateCommandRequest, {
          ...duplicateCommand,
          value: 'changed-payload',
        }),
        /request ID was already used/i,
      );
    });

    const alphaMembers = [alpha.captain, alpha.scout];
    const concurrentWrongAnswers = Array.from({ length: 3 }, (_, index) => ({
      member: alphaMembers[Math.floor(random() * alphaMembers.length)],
      value: `wrong-${index + 2}`,
      requestId: fixedUuid(`alpha-concurrent-wrong-${index + 2}`),
    }));
    await step(
      `three concurrent novel wrong answers: ${concurrentWrongAnswers.map(item => `${item.member.name}:${item.value}`).join(', ')}`,
      async () => {
        const results = await Promise.all(concurrentWrongAnswers.map(item => applyRunCommand(
          alpha.created.teamId,
          item.member.memberId,
          alphaRun.runId,
          item.requestId,
          { ...duplicateCommand, value: item.value },
        )));
        assert.equal(results.every(result => result.feedback.status === 'rejected'), true);
      },
    );

    for (let attempt = 5; attempt <= 6; attempt++) {
      const member = alphaMembers[Math.floor(random() * alphaMembers.length)];
      await step(`${member.name} submits bounded wrong answer ${attempt}`, async () => {
        const result = await applyRunCommand(
          alpha.created.teamId,
          member.memberId,
          alphaRun.runId,
          fixedUuid(`alpha-wrong-${attempt}`),
          { ...duplicateCommand, value: `wrong-${attempt}` },
        );
        assert.equal(result.feedback.status, 'rejected');
      });
    }

    await step('a seventh Alpha answer is rejected even from the other member', async () => {
      await assert.rejects(
        applyRunCommand(alpha.created.teamId, alpha.scout.memberId, alphaRun.runId, fixedUuid('alpha-seventh-answer'), {
          ...duplicateCommand,
          value: alphaAnswer,
        }),
        /too many attempts/i,
      );
      assert.equal(
        Number((await getPool().query(
          'select count(*)::int as count from hunt_v3.run_attempt_reservations where scope_key=$1',
          [digest(`run-verifier:aggregate:${alpha.created.teamId}:${alphaRun.runId}:start:answer`)],
        )).rows[0].count),
        6,
      );
    });

    await step('Beta solves and completes with authoritative score caches', async () => {
      const solved = await applyRunCommand(
        beta.created.teamId,
        beta.scout.memberId,
        betaRun.runId,
        fixedUuid('beta-correct-answer'),
        { type: 'verify', checkpointId: 'start', nodeId: 'answer', value: betaAnswer },
      );
      assert.equal(solved.view.checkpoint?.id, 'finale');
      const finishRequest = fixedUuid('beta-finish');
      const finishCommand = { type: 'continue' as const, checkpointId: 'finale', nodeId: 'finish-message' };
      const completed = await applyRunCommand(
        beta.created.teamId,
        beta.captain.memberId,
        betaRun.runId,
        finishRequest,
        finishCommand,
      );
      assert.deepEqual(
        { status: completed.view.status, score: completed.view.score, bonusScore: completed.view.bonusScore },
        { status: 'completed', score: 20, bonusScore: 3 },
      );
      assert.equal(
        (await applyRunCommand(
          beta.created.teamId,
          beta.captain.memberId,
          betaRun.runId,
          finishRequest,
          finishCommand,
        )).view.status,
        'completed',
      );
      expectedOpenRuns.delete(beta.created.teamId);
    });

    const boardBefore = await publicLeaderboard(boardSlug, getPool()) as { main: Array<{ teamCode: string }> };
    assert.deepEqual(new Set(boardBefore.main.map(row => row.teamCode)), new Set([alpha.created.code, beta.created.code]));
    assertRedacted('live public board before controls', boardBefore);
    assertRedacted(
      'Alpha player projection after exhausted attempts',
      await currentRunView(alpha.created.teamId, alpha.scout.memberId, alphaRun.runId),
    );
    assertRedacted(
      'Beta completed player projection',
      await currentRunView(beta.created.teamId, beta.scout.memberId, betaRun.runId),
    );

    const disqualifyRequest = {
      huntId,
      teamId: alpha.created.teamId,
      action: 'disqualify' as const,
      reason: 'Deterministic adversarial ordering check',
      // Organizer-assigned member joins each advance the competition revision;
      // the team began at 1 and its captain/scout check-ins advanced it to 3.
      expectedRevision: 3,
      requestId: fixedUuid('alpha-disqualify'),
      actor: 'Adversarial test organizer',
      sessionHash: 'e'.repeat(64),
    };
    await step('pause lifecycle concurrently with Alpha disqualification', async () => {
      const [lifecycle, disqualification] = await Promise.all([
        setHuntLifecycle(huntId, 'paused', 1, 'Adversarial test organizer'),
        changeTeamCompetitionStatus(disqualifyRequest),
      ]);
      assert.equal(lifecycle.ok, true);
      assert.equal(disqualification.status, 'disqualified');
      expectedOpenRuns.delete(alpha.created.teamId);
    });

    await step('control receipts replay exactly and reject changed payloads or stale lifecycle revisions', async () => {
      assert.equal((await changeTeamCompetitionStatus(disqualifyRequest)).replayed, true);
      await assert.rejects(
        changeTeamCompetitionStatus({ ...disqualifyRequest, reason: 'Changed disqualification reason' }),
        /request ID was already used/i,
      );
      await assert.rejects(
        setHuntLifecycle(huntId, 'paused', 1, 'Stale adversarial organizer'),
        /hunt changed/i,
      );
      await assert.rejects(
        createRun(alpha.created.teamId, alpha.captain.memberId, fixedUuid('disqualified-alpha-create')),
        /team is not allowed to start runs/i,
      );
    });

    const boardAfter = await publicLeaderboard(boardSlug, getPool()) as { main: Array<{ teamCode: string }> };
    assert.deepEqual(boardAfter.main.map(row => row.teamCode), [beta.created.code]);
    assertRedacted('public board after concurrent controls', boardAfter);
    const rankedCodes = new Set(boardAfter.main.map(row => row.teamCode));
    const rankedTeams = (await getPool().query(
      `select canonical_code,status,approval_status from hunt_v3.teams
        where hunt_id=$1 and canonical_code=any($2::text[])`,
      [huntId, [...rankedCodes]],
    )).rows;
    assert.equal(
      rankedTeams.every(team => team.status === 'active' && team.approval_status === 'approved'),
      true,
      'only approved active teams appear in the public ranking',
    );
    assert.equal(rankedCodes.has(alpha.created.code), false, 'the disqualified team is absent from the board');
    assert.equal(rankedCodes.has(beta.created.code), true, 'the approved active finisher remains ranked');

    await assertDatabaseInvariants('final model state');
  } catch (error) {
    const reproduction = `\nMODEL_SEED=${MODEL_SEED}\nACTION_TRACE:\n${trace.join('\n')}`;
    if (error instanceof Error) error.message += reproduction;
    throw error;
  }
});

test('PostgreSQL V3 generated command sequences preserve run, receipt, roster, score, and redaction invariants', { skip: !enabled, timeout: 90_000 }, async () => {
  const scenarioSeeds = [0x10203040, 0x51bada55, 0x7f4a7c15, 0xc001d00d, 0xf00dcafe];
  const coverage = new Set<string>();

  for (const scenarioSeed of scenarioSeeds) {
    const random = deterministicRandom(scenarioSeed);
    const huntId = `v3-generated-${scenarioSeed.toString(16)}-${randomUUID().slice(0, 8)}`;
    const trace: string[] = [];
    const immutableRuns = new Map<string, ImmutableRun>();
    const immutableEvents = new Map<string, string>();
    const immutableLedger = new Map<string, string>();
    const answerCodes = new Set<string>();
    let currentRunId: string | undefined;
    let lastCreate: { requestId: string; runId: string } | undefined;
    let lastCommand: {
      requestId: string;
      runId: string;
      command: { type: 'verify'; checkpointId: string; nodeId: string; value: string } |
        { type: 'continue'; checkpointId: string; nodeId: string };
    } | undefined;

    const failWithTrace = (error: unknown): never => {
      const reproduction = `\nGENERATED_SEQUENCE_SEED=0x${scenarioSeed.toString(16)}\nHUNT_ID=${huntId}\n` +
        `The action seed reproduces action selection; cryptographic run seeds and concurrency scheduling are recorded below.\n` +
        `ACTION_TRACE:\n${trace.join('\n')}`;
      if (error instanceof Error) error.message += reproduction;
      throw error;
    };

    try {
      await insertHunt(definition(huntId));
      const alpha = await createAssignedTeam({
        huntId,
        label: `Generated ${scenarioSeed} Alpha`,
        displayName: `Generated Alpha ${scenarioSeed}`,
        teamPin: '430001',
        captainPin: '530001',
        scoutPin: '530002',
      });
      const beta = await createAssignedTeam({
        huntId,
        label: `Generated ${scenarioSeed} Beta`,
        displayName: `Generated Beta ${scenarioSeed}`,
        teamPin: '430002',
        captainPin: '530003',
        scoutPin: '530004',
      });

      const runRow = async (runId: string) => (await getPool().query(
        `select id,status,private_seed,seed_commitment,plan_key,allocation_cycle,hunt_version,
          route_plan,resolved_variables,engine_state
          from hunt_v3.runs where id=$1`,
        [runId],
      )).rows[0];

      const assertInvariants = async (label: string) => {
        const runs = (await getPool().query(
          `select id,run_number,status,hunt_version,private_seed,seed_commitment,plan_key,
            allocation_cycle,route_plan,resolved_variables,score,bonus_score
            from hunt_v3.runs where hunt_id=$1 order by team_id,run_number`,
          [huntId],
        )).rows;
        const openByTeam = (await getPool().query(
          `select team_id,count(*)::int as count from hunt_v3.runs
            where hunt_id=$1 and status in ('waiting','active') group by team_id`,
          [huntId],
        )).rows;
        assert.equal(openByTeam.every(row => Number(row.count) <= 1), true, `${label}: at most one open run per team`);

        for (const teamId of [alpha.created.teamId, beta.created.teamId]) {
          const numberRows = (await getPool().query(
            'select run_number from hunt_v3.runs where team_id=$1 order by run_number',
            [teamId],
          )).rows.map(row => Number(row.run_number));
          assert.deepEqual(numberRows, Array.from({ length: numberRows.length }, (_, index) => index + 1), `${label}: run numbers stay contiguous`);
        }

        for (const run of runs) {
          const immutable: ImmutableRun = {
            hunt_version: Number(run.hunt_version),
            private_seed: String(run.private_seed),
            seed_commitment: String(run.seed_commitment),
            plan_key: String(run.plan_key),
            allocation_cycle: Number(run.allocation_cycle),
            route_plan: run.route_plan,
            resolved_variables: run.resolved_variables,
          };
          const first = immutableRuns.get(run.id);
          if (first) assert.deepEqual(immutable, first, `${label}: immutable run allocation changed`);
          else immutableRuns.set(run.id, immutable);
          const code = (run.resolved_variables as { answerCode?: unknown })?.answerCode;
          if (typeof code === 'string') answerCodes.add(code);
        }

        const rosters = (await getPool().query(
          `select run.id,run.team_id,array_agg(member.member_id order by member.member_id) as member_ids
            from hunt_v3.runs run join hunt_v3.run_members member on member.run_id=run.id
            where run.hunt_id=$1 group by run.id,run.team_id`,
          [huntId],
        )).rows;
        const expectedRosters = new Map([
          [alpha.created.teamId, [alpha.captain.memberId, alpha.scout.memberId].sort()],
          [beta.created.teamId, [beta.captain.memberId, beta.scout.memberId].sort()],
        ]);
        for (const roster of rosters) {
          assert.deepEqual(roster.member_ids, expectedRosters.get(roster.team_id), `${label}: run roster changed`);
        }

        const invalidActors = await getPool().query(
          `select event.id from hunt_v3.run_events event
            join hunt_v3.runs run on run.id=event.run_id
            left join hunt_v3.run_members member
              on member.run_id=event.run_id and member.team_id=event.team_id and member.member_id=event.actor_member_id
            where run.hunt_id=$1 and event.actor_kind='member'
              and (event.actor_member_id is null or member.member_id is null)`,
          [huntId],
        );
        assert.equal(invalidActors.rowCount, 0, `${label}: an event actor escaped the frozen roster`);

        const appendOnlySnapshots = async (
          table: 'run_events' | 'score_ledger',
          snapshots: Map<string, string>,
        ) => {
          const rows = (await getPool().query(
            `select item.id::text as id,row_to_json(item)::text as snapshot
              from hunt_v3.${table} item join hunt_v3.runs run on run.id=item.run_id
              where run.hunt_id=$1 order by item.id`,
            [huntId],
          )).rows as Array<{ id: string; snapshot: string }>;
          const currentIds = new Set(rows.map(row => row.id));
          for (const [id] of snapshots) assert.equal(currentIds.has(id), true, `${label}: ${table} row ${id} was deleted`);
          for (const row of rows) {
            const first = snapshots.get(row.id);
            if (first !== undefined) assert.equal(row.snapshot, first, `${label}: ${table} row ${row.id} was rewritten`);
            else snapshots.set(row.id, row.snapshot);
          }
        };
        await appendOnlySnapshots('run_events', immutableEvents);
        await appendOnlySnapshots('score_ledger', immutableLedger);

        const caches = (await getPool().query(
          `select run.id,run.score,run.bonus_score,
            coalesce(sum(ledger.amount) filter(where ledger.counts_for_ranking),0)::int as official_sum,
            coalesce(sum(ledger.amount) filter(where not ledger.counts_for_ranking),0)::int as bonus_sum
            from hunt_v3.runs run left join hunt_v3.score_ledger ledger on ledger.run_id=run.id
            where run.hunt_id=$1 group by run.id`,
          [huntId],
        )).rows;
        for (const cache of caches) {
          assert.equal(cache.score, cache.official_sum, `${label}: official score cache diverged`);
          assert.equal(cache.bonus_score, cache.bonus_sum, `${label}: bonus score cache diverged`);
        }

        const oversizedBuckets = await getPool().query(
          `select scope_key,count(*)::int as count from hunt_v3.run_attempt_reservations reservation
            join hunt_v3.runs run on run.id=reservation.run_id
            where run.hunt_id=$1 group by scope_key having count(*) > 6`,
          [huntId],
        );
        assert.equal(oversizedBuckets.rowCount, 0, `${label}: a verifier budget exceeded its lifetime cap`);

        const board = await publicLeaderboard(`${huntId}-board`, getPool()) as {
          main: Array<{ teamCode: string; status?: 'registered' | 'waiting' | 'active' | 'completed' }>;
          replay: Array<{ teamCode: string }>;
        };
        const serializedBoard = JSON.stringify(board);
        assert.equal(serializedBoard.includes(PRIVATE_SENTINEL), false, `${label}: public board leaked a private variable`);
        for (const immutable of immutableRuns.values()) {
          assert.equal(serializedBoard.includes(immutable.private_seed), false, `${label}: public board leaked a seed`);
          assert.equal(serializedBoard.includes(immutable.seed_commitment), false, `${label}: public board leaked a seed commitment`);
          assert.equal(serializedBoard.includes(immutable.plan_key), false, `${label}: public board leaked a plan key`);
        }
        for (const code of answerCodes) assert.equal(serializedBoard.includes(code), false, `${label}: public board leaked a run answer`);
        const rankedCodes = [...new Set([...board.main, ...board.replay].map(row => row.teamCode))];
        if (rankedCodes.length) {
          const rankedTeams = (await getPool().query(
            `select team.canonical_code,team.status,team.approval_status,
              exists(select 1 from hunt_v3.runs run where run.team_id=team.id
                and run.status='completed' and run.eligible and not run.practice) as has_completed,
              exists(select 1 from hunt_v3.runs run where run.team_id=team.id
                and run.status in ('waiting','active') and run.eligible and not run.practice) as has_open
              from hunt_v3.teams team
              where team.hunt_id=$1 and team.canonical_code=any($2::text[])
              order by team.canonical_code`,
            [huntId, rankedCodes],
          )).rows as Array<{
            canonical_code: string;
            status: string;
            approval_status: string;
            has_completed: boolean;
            has_open: boolean;
          }>;
          assert.equal(rankedTeams.length, rankedCodes.length, `${label}: every public row maps to one team`);
          const byCode = new Map(rankedTeams.map(team => [team.canonical_code, team]));
          for (const row of board.main) {
            const team = byCode.get(row.teamCode)!;
            assert.deepEqual([team.status, team.approval_status], ['active', 'approved'],
              `${label}: only active approved teams appear on the live board`);
            if (row.status === 'completed') assert.equal(team.has_completed, true,
              `${label}: completed board rows derive from an eligible official completion`);
            if (row.status === 'waiting' || row.status === 'active') assert.equal(team.has_open, true,
              `${label}: provisional board rows derive from an eligible official open run`);
          }
          for (const row of board.replay) assert.equal(byCode.get(row.teamCode)?.has_completed, true,
            `${label}: replay rows derive from an eligible official completion`);
        }
      };

      const assertPlayerRedacted = (label: string, projection: unknown) => {
        const serialized = JSON.stringify(projection);
        assert.equal(serialized.includes(PRIVATE_SENTINEL), false, `${label}: player view leaked a private variable`);
        for (const immutable of immutableRuns.values()) {
          assert.equal(serialized.includes(immutable.private_seed), false, `${label}: player view leaked a seed`);
          assert.equal(serialized.includes(immutable.seed_commitment), false, `${label}: player view leaked a seed commitment`);
          assert.equal(serialized.includes(immutable.plan_key), false, `${label}: player view leaked a plan key`);
        }
        for (const code of answerCodes) assert.equal(serialized.includes(code), false, `${label}: player view leaked a run answer`);
      };

      const createOrResume = async (step: number, concurrent = false) => {
        const allocationCount = Number((await getPool().query(
          'select count(*)::int as count from hunt_v3.runs where team_id=$1',
          [alpha.created.teamId],
        )).rows[0].count);
        const open = (await getPool().query(
          `select id from hunt_v3.runs where team_id=$1 and status in ('waiting','active')`,
          [alpha.created.teamId],
        )).rows[0] as { id: string } | undefined;
        if (allocationCount >= 5 && !open) {
          coverage.add('bounded-attempt-count');
          return;
        }
        const ids = concurrent
          ? [0, 1, 2].map(index => fixedUuid(`generated-${scenarioSeed}-${step}-create-${index}`))
          : [fixedUuid(`generated-${scenarioSeed}-${step}-create`)];
        const created = await Promise.all(ids.map(requestId => createRun(
          alpha.created.teamId,
          alpha.captain.memberId,
          requestId,
        )));
        assert.equal(new Set(created.map(run => run.runId)).size, 1, 'concurrent creates must converge on one open run');
        currentRunId = created[0].runId;
        lastCreate = { requestId: ids[0], runId: currentRunId };
        const allocation = await runRow(currentRunId);
        trace.push(`   allocation run=${currentRunId} privateSeed=${allocation.private_seed} ` +
          `commitment=${allocation.seed_commitment} plan=${allocation.plan_key} cycle=${allocation.allocation_cycle}`);
        coverage.add(concurrent ? 'concurrent-create' : 'create-or-resume');
      };

      await createOrResume(-1, true);
      await assertInvariants('initial generated run');

      for (let step = 0; step < 36; step++) {
        const action = Math.floor(random() * 10);
        trace.push(`${step + 1}. action=${action} run=${currentRunId ?? 'none'}`);
        const row = currentRunId ? await runRow(currentRunId) : undefined;
        const activeCheckpoint = row?.engine_state?.activeCheckpointId as string | null | undefined;
        const activeNode = activeCheckpoint ? row.engine_state?.checkpoints?.[activeCheckpoint]?.activeNodeId as string | null | undefined : undefined;

        if (action === 0 || !currentRunId) {
          await createOrResume(step, random() < 0.45);
        } else if (action === 1 && lastCreate) {
          const replay = await createRun(alpha.created.teamId, alpha.captain.memberId, lastCreate.requestId);
          assert.equal(replay.runId, lastCreate.runId);
          await assert.rejects(
            createRun(alpha.created.teamId, alpha.captain.memberId, lastCreate.requestId, true),
            /request ID was already used/i,
          );
          coverage.add('create-receipt-replay-and-conflict');
        } else if ((action === 2 || action === 3) && row.status === 'active' && activeCheckpoint === 'start' && activeNode === 'answer') {
          const attempts = Number((await getPool().query(
            'select count(*)::int as count from hunt_v3.run_attempt_reservations where run_id=$1',
            [currentRunId],
          )).rows[0].count);
          const correct = attempts >= 4 || (action === 3 && random() < 0.7);
          const value = correct ? String(row.resolved_variables.answerCode) : `generated-wrong-${scenarioSeed}-${step}`;
          const requestId = fixedUuid(`generated-${scenarioSeed}-${step}-verify`);
          const command = { type: 'verify' as const, checkpointId: 'start', nodeId: 'answer', value };
          if (random() < 0.35) {
            const results = await Promise.all([
              applyRunCommand(alpha.created.teamId, alpha.captain.memberId, currentRunId, requestId, command),
              applyRunCommand(alpha.created.teamId, alpha.captain.memberId, currentRunId, requestId, command),
            ]);
            assert.equal(results[0].feedback.status, results[1].feedback.status);
          } else {
            await applyRunCommand(alpha.created.teamId, random() < 0.5 ? alpha.captain.memberId : alpha.scout.memberId, currentRunId, requestId, command);
          }
          lastCommand = { requestId, runId: currentRunId, command };
          coverage.add(correct ? 'correct-verifier' : 'wrong-verifier');
        } else if (action === 4 && row.status === 'active' && activeCheckpoint === 'finale' && activeNode === 'finish-message') {
          const requestId = fixedUuid(`generated-${scenarioSeed}-${step}-continue`);
          const command = { type: 'continue' as const, checkpointId: 'finale', nodeId: 'finish-message' };
          await applyRunCommand(alpha.created.teamId, alpha.captain.memberId, currentRunId, requestId, command);
          lastCommand = { requestId, runId: currentRunId, command };
          coverage.add('completion-command');
        } else if (action === 5 && lastCommand) {
          await applyRunCommand(
            alpha.created.teamId,
            alpha.captain.memberId,
            lastCommand.runId,
            lastCommand.requestId,
            lastCommand.command,
          );
          coverage.add('command-receipt-replay');
        } else if (action === 6 && lastCommand?.command.type === 'verify') {
          await assert.rejects(
            applyRunCommand(alpha.created.teamId, alpha.captain.memberId, lastCommand.runId, lastCommand.requestId, {
              ...lastCommand.command,
              value: `${lastCommand.command.value}-mutated`,
            }),
            /request ID was already used/i,
          );
          coverage.add('command-receipt-conflict');
        } else if (action === 7 && currentRunId) {
          const foreignRequestId = fixedUuid(`generated-${scenarioSeed}-${step}-foreign`);
          await assert.rejects(
            applyRunCommand(alpha.created.teamId, beta.captain.memberId, currentRunId, foreignRequestId, {
              type: 'verify', checkpointId: 'start', nodeId: 'answer', value: 'stolen',
            }),
            /run not found/i,
          );
          const foreignArtifacts = await getPool().query(
            `select 'receipt' as kind from hunt_v3.command_receipts where request_id=$1
             union all
             select 'reservation' as kind from hunt_v3.run_attempt_reservations where request_id=$1
             union all
             select 'event' as kind from hunt_v3.run_events where request_id=$1`,
            [foreignRequestId],
          );
          assert.equal(foreignArtifacts.rowCount, 0, 'a cross-team rejection must leave no receipt, attempt reservation, or event');
          coverage.add('cross-team-rejection');
        } else if (action === 8) {
          const lateRequestId = fixedUuid(`generated-${scenarioSeed}-${step}-late-join`);
          const lateName = `Late ${scenarioSeed} ${step}`;
          await assert.rejects(registerV3Team({
            requestId: lateRequestId,
            huntId,
            intent: 'join',
            playerName: lateName,
            teamCode: alpha.created.code,
            pin: '430001',
            memberPin: '539999',
            requestSource: `generated-${scenarioSeed}-${step}-late-source`,
          }), /roster was locked when its first run started/i);
          assert.equal(Number((await getPool().query(
            'select count(*)::int as count from hunt_v3.team_members where team_id=$1 and name=$2',
            [alpha.created.teamId, lateName],
          )).rows[0].count), 0, 'a rejected late join must not create a member');
          assert.equal(Number((await getPool().query(
            `select count(*)::int as count from (
              select request_id from hunt_v3.command_receipts where request_id=$1
              union all select request_id from hunt_v3.run_attempt_reservations where request_id=$1
              union all select request_id from hunt_v3.run_events where request_id=$1
            ) artifact`,
            [lateRequestId],
          )).rows[0].count), 0, 'a rejected late join must not persist a receipt, attempt reservation, or event');
          coverage.add('late-member-rejection');
        } else if (currentRunId) {
          const projection = await currentRunView(alpha.created.teamId, alpha.scout.memberId, currentRunId);
          assertPlayerRedacted(`generated step ${step}`, projection);
          coverage.add('player-projection-redaction');
        }

        await assertInvariants(`generated step ${step}`);
      }

      const completeRun = async (
        teamId: string,
        captainId: string,
        finisherId: string,
        runId: string,
        requestLabel: string,
      ) => {
        let row = await runRow(runId);
        if (row.status === 'active' && row.engine_state.activeCheckpointId === 'start') {
          const attempts = Number((await getPool().query(
            'select count(*)::int as count from hunt_v3.run_attempt_reservations where run_id=$1',
            [runId],
          )).rows[0].count);
          assert.ok(attempts < 6, `${requestLabel}: generated run unexpectedly exhausted its verifier budget`);
          await applyRunCommand(
            teamId,
            captainId,
            runId,
            fixedUuid(`${requestLabel}-forced-answer`),
            { type: 'verify', checkpointId: 'start', nodeId: 'answer', value: String(row.resolved_variables.answerCode) },
          );
          coverage.add('correct-verifier');
          row = await runRow(runId);
        }
        if (row.status === 'active' && row.engine_state.activeCheckpointId === 'finale') {
          await applyRunCommand(
            teamId,
            finisherId,
            runId,
            fixedUuid(`${requestLabel}-forced-finish`),
            { type: 'continue', checkpointId: 'finale', nodeId: 'finish-message' },
          );
          coverage.add('completion-command');
          row = await runRow(runId);
        }
        assert.equal(row.status, 'completed', `${requestLabel}: forced completion did not finish the run`);
      };

      // Every trace completes three to five Alpha attempts. With two plans,
      // this necessarily exhausts the first deck before testing a repeat cycle.
      if (currentRunId) await completeRun(
        alpha.created.teamId,
        alpha.captain.memberId,
        alpha.scout.memberId,
        currentRunId,
        `generated-${scenarioSeed}-alpha-current`,
      );
      let alphaRows = (await getPool().query(
        `select id,plan_key,allocation_cycle from hunt_v3.runs
          where team_id=$1 order by run_number`,
        [alpha.created.teamId],
      )).rows as Array<{ id: string; plan_key: string; allocation_cycle: number }>;
      while (alphaRows.length < 3) {
        await createOrResume(1_000 + alphaRows.length);
        assert.ok(currentRunId, 'forced Alpha allocation did not return a run');
        await completeRun(
          alpha.created.teamId,
          alpha.captain.memberId,
          alpha.scout.memberId,
          currentRunId,
          `generated-${scenarioSeed}-alpha-${alphaRows.length + 1}`,
        );
        alphaRows = (await getPool().query(
          `select id,plan_key,allocation_cycle from hunt_v3.runs
            where team_id=$1 order by run_number`,
          [alpha.created.teamId],
        )).rows;
      }
      assert.ok(alphaRows.length >= 3 && alphaRows.length <= 5, 'generated Alpha attempt count stays within its bounded model');
      assert.equal(new Set(alphaRows.slice(0, 2).map(row => row.plan_key)).size, 2,
        'Alpha receives both structural plans before either repeats');
      assert.ok(alphaRows.some(row => Number(row.allocation_cycle) >= 1),
        'Alpha records a new allocation cycle after exhausting the two-plan deck');
      coverage.add('plan-deck-exhaustion');

      // Exercise allocation, gameplay, scoring, and redaction on the second
      // team too; cross-team tests are weaker if the foreign team never runs.
      const betaRunIds: string[] = [];
      for (let attempt = 1; attempt <= 2; attempt++) {
        const created = await createRun(
          beta.created.teamId,
          beta.captain.memberId,
          fixedUuid(`generated-${scenarioSeed}-beta-create-${attempt}`),
        );
        betaRunIds.push(created.runId);
        const allocation = await runRow(created.runId);
        trace.push(`   beta allocation run=${created.runId} privateSeed=${allocation.private_seed} ` +
          `commitment=${allocation.seed_commitment} plan=${allocation.plan_key} cycle=${allocation.allocation_cycle}`);
        await completeRun(
          beta.created.teamId,
          attempt % 2 ? beta.captain.memberId : beta.scout.memberId,
          attempt % 2 ? beta.scout.memberId : beta.captain.memberId,
          created.runId,
          `generated-${scenarioSeed}-beta-${attempt}`,
        );
        await assertInvariants(`generated Beta attempt ${attempt}`);
      }
      const betaAllocations = (await getPool().query(
        'select plan_key,allocation_cycle from hunt_v3.runs where team_id=$1 order by run_number',
        [beta.created.teamId],
      )).rows;
      assert.equal(betaAllocations.length, 2);
      assert.equal(new Set(betaAllocations.map(row => row.plan_key)).size, 2,
        'Beta also receives both structural plans before a repeat');
      assert.equal(betaAllocations.every(row => Number(row.allocation_cycle) === 0), true);
      coverage.add('both-teams-complete');

      assertPlayerRedacted(
        'final Alpha projection',
        await currentRunView(alpha.created.teamId, alpha.scout.memberId, alphaRows.at(-1)!.id),
      );
      assertPlayerRedacted(
        'final Beta projection',
        await currentRunView(beta.created.teamId, beta.scout.memberId, betaRunIds.at(-1)!),
      );
      coverage.add('player-projection-redaction');
      await assertInvariants('final generated state');
    } catch (error) {
      failWithTrace(error);
    }
  }

  const requiredCoverage = [
    'concurrent-create', 'create-or-resume', 'create-receipt-replay-and-conflict',
    'wrong-verifier', 'correct-verifier', 'completion-command', 'command-receipt-replay',
    'command-receipt-conflict', 'cross-team-rejection', 'late-member-rejection',
    'player-projection-redaction', 'plan-deck-exhaustion', 'both-teams-complete',
  ];
  assert.deepEqual(requiredCoverage.filter(item => !coverage.has(item)), [],
    `fixed generated seeds stopped covering required actions: ${JSON.stringify([...coverage].sort())}`);
});
