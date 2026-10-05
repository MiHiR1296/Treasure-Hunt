import '../isolated-database';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getPool } from '../../lib/server/db';
import { createRun } from '../../lib/server/v3/runs';
import { validateFairness } from '../../lib/v3/fairness';
import type { V3Definition } from '../../lib/v3/types';

const enabled = Boolean(process.env.DATABASE_URL);

function checkpoint(id: string, points = 0) {
  return {
    id,
    title: id,
    basePoints: points,
    flow: { startNodeId: 'done', nodes: [{ id: 'done', type: 'complete' as const }] },
    hints: [],
  };
}

function allocationDefinition(id: string): V3Definition {
  return {
    schemaVersion: 3,
    id,
    version: 1,
    title: 'Balanced allocation integration',
    settings: {
      mode: 'sequential',
      map: 'none',
      minTeamSize: 1,
      maxTeamSize: 4,
      registrationOpen: false,
      registrationMode: 'organizer-assigned',
      integrityPolicy: { locationVerification: 'strict', selfServeApproval: 'organizer', rosterParticipation: 'freeze_at_run_start' },
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
      recognition: { enabled: false, peerVotingEnabled: false, votingWindowMinutes: 30, dataWeight: 1, peerWeight: 0 },
      routePlan: {
        startCheckpointId: 'start',
        finaleCheckpointId: 'finale',
        requiredCheckpointIds: [],
        choose: { count: 1, fromCheckpointIds: ['location-a', 'location-b'] },
        shuffleSelectedCheckpoints: false,
        checkpointEstimates: {
          start: { durationMinutes: 1 },
          'location-a': { durationMinutes: 2 },
          'location-b': { durationMinutes: 2 },
          finale: { durationMinutes: 1 },
        },
        travelEstimates: [
          { from: 'start', to: 'location-a', durationMinutes: 1 },
          { from: 'location-a', to: 'finale', durationMinutes: 1 },
          { from: 'start', to: 'location-b', durationMinutes: 1 },
          { from: 'location-b', to: 'finale', durationMinutes: 1 },
        ],
      },
      challengePools: {
        'location-a': {
          id: 'pool-a',
          variants: [
            { id: 'a-one', checkpointId: 'a-one', estimatedDurationMinutes: 2, scoreCeiling: 10, weight: 1 },
            { id: 'a-two', checkpointId: 'a-two', estimatedDurationMinutes: 2, scoreCeiling: 10, weight: 1 },
          ],
        },
        'location-b': {
          id: 'pool-b',
          variants: [
            { id: 'b-one', checkpointId: 'b-one', estimatedDurationMinutes: 2, scoreCeiling: 10, weight: 1 },
            { id: 'b-two', checkpointId: 'b-two', estimatedDurationMinutes: 2, scoreCeiling: 10, weight: 1 },
          ],
        },
      },
      variableGenerators: {},
      fairnessPolicy: {
        minimumDistinctPlans: 4,
        durationToleranceMinutes: 0,
        maxResolvedRoutes: 100,
        requireTravelEstimates: true,
        walkingSpeedMetersPerMinute: 72,
        minutesPerDifficultyPoint: 1.5,
      },
      parallelMechanics: [],
    },
    checkpoints: [checkpoint('start'), checkpoint('a-one', 10), checkpoint('a-two', 10), checkpoint('b-one', 10), checkpoint('b-two', 10), checkpoint('finale')],
  };
}

async function seedHunt(id: string) {
  const definition = allocationDefinition(id);
  const fairness = validateFairness(definition);
  assert.equal(fairness.valid, true, JSON.stringify(fairness.issues));
  assert.equal(fairness.routes.length, 4);
  await getPool().query(
    `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,registration_open,latest_version,settings)
      values($1,$2,$1,'live','organizer_assigned',false,1,$3)`,
    [id, definition.title, definition.settings],
  );
  await getPool().query(
    `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,1,$2,$3,$4,$5)`,
    [id, definition, randomUUID().replaceAll('-', '').padEnd(64, '0'), { valid: true, issues: [] }, fairness],
  );
  return fairness;
}

async function seedTeam(huntId: string, ordinal: number) {
  const teamId = randomUUID();
  const memberId = randomUUID();
  const code = `T-${String(ordinal).padStart(3, '0')}`;
  await getPool().query(
    `insert into hunt_v3.teams(
      id,hunt_id,canonical_code,name_status,pin_hash,registration_source,approval_status,status)
      values($1,$2,$3,'code_only',$4,'organizer_assigned','approved','active')`,
    [teamId, huntId, code, 'p'.repeat(32)],
  );
  await getPool().query(
    `insert into hunt_v3.team_members(
      id,team_id,name,name_key,claim_pin_hash,status,claimed_at,checked_in_at)
      values($1,$2,$3,$4,$5,'active',now(),now())`,
    [memberId, teamId, `Member ${ordinal}`, `member-${ordinal}`, 'm'.repeat(32)],
  );
  return { teamId, memberId };
}

before(async () => {
  if (!enabled) return;
  await getPool().query(await readFile(new URL('../../database/v3.sql', import.meta.url), 'utf8'));
});

after(async () => {
  if (enabled) await getPool().end();
});

test('PostgreSQL V3 balanced deck prevents team repeats before exhaustion and balances concurrent starts', { skip: !enabled }, async () => {
  const repeatHuntId = `v3-plan-repeat-${randomUUID().slice(0, 8)}`;
  await seedHunt(repeatHuntId);
  const repeatTeam = await seedTeam(repeatHuntId, 1);
  for (let attempt = 0; attempt < 5; attempt++) {
    const run = await createRun(repeatTeam.teamId, repeatTeam.memberId, randomUUID());
    assert.equal(run.status, 'completed');
  }
  const repeated = (await getPool().query(
    `select plan_key,allocation_cycle from hunt_v3.runs
      where team_id=$1 order by run_number`,
    [repeatTeam.teamId],
  )).rows;
  assert.equal(new Set(repeated.slice(0, 4).map(row => row.plan_key)).size, 4, 'a team consumes every structural plan before a repeat');
  assert.deepEqual(repeated.slice(0, 4).map(row => row.allocation_cycle), [0, 0, 0, 0]);
  assert.equal(repeated[4].allocation_cycle, 1, 'the first repeat is explicitly recorded as the next deck cycle');

  const concurrentHuntId = `v3-plan-concurrent-${randomUUID().slice(0, 8)}`;
  const fairness = await seedHunt(concurrentHuntId);
  const teams = await Promise.all(Array.from({ length: 12 }, (_, index) => seedTeam(concurrentHuntId, index + 1)));
  await Promise.all(teams.map(team => createRun(team.teamId, team.memberId, randomUUID())));
  const counts = (await getPool().query(
    `select plan_key,count(*)::int as count from hunt_v3.runs
      where hunt_id=$1 group by plan_key order by plan_key`,
    [concurrentHuntId],
  )).rows;
  assert.equal(counts.length, fairness.routes.length);
  assert.deepEqual(counts.map(row => row.count), [3, 3, 3, 3], 'the hunt-row lock makes concurrent allocation an even deck deal');
});
