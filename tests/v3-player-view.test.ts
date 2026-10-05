import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, executeCommand } from '../lib/engine';
import { materializeRunDefinition, v3PlayerView } from '../lib/server/v3/runtime';
import type { ResolvedRunPlan, V3Definition } from '../lib/v3/types';

const now = '2026-10-06T10:00:00.000Z';

function definition(): V3Definition {
  return {
    schemaVersion: 3,
    id: 'private-route-projection',
    version: 1,
    title: 'Private route projection',
    settings: {
      mode: 'sequential',
      map: 'all',
      registrationMode: 'self-serve',
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
        enabled: false,
        peerVotingEnabled: false,
        votingWindowMinutes: 60,
        dataWeight: 0.7,
        peerWeight: 0.3,
      },
      routePlan: {
        startCheckpointId: 'start',
        finaleCheckpointId: 'finale-private',
        requiredCheckpointIds: ['library'],
        choose: { count: 0, fromCheckpointIds: [] },
        shuffleSelectedCheckpoints: false,
        checkpointEstimates: {},
        travelEstimates: [],
      },
      challengePools: {
        library: {
          id: 'library-private-pool',
          variants: [{ id: 'riddle-private', checkpointId: 'library-riddle-private' }],
        },
      },
      variableGenerators: {},
      fairnessPolicy: {
        minimumDistinctPlans: 1,
        durationToleranceMinutes: 0,
        maxResolvedRoutes: 10,
        requireTravelEstimates: false,
        walkingSpeedMetersPerMinute: 75,
        minutesPerDifficultyPoint: 1,
      },
    },
    checkpoints: [
      {
        id: 'start',
        title: 'Public starting point',
        basePoints: 10,
        location: { latitude: 19.1, longitude: 72.1, radiusMeters: 50 },
        flow: {
          startNodeId: 'read',
          nodes: [
            { id: 'read', type: 'show_text', text: 'Begin here.', next: 'done' },
            { id: 'done', type: 'complete' },
          ],
        },
        hints: [],
      },
      {
        id: 'library-riddle-private',
        title: 'Secret library challenge',
        basePoints: 10,
        group: 'Secret library route',
        location: { latitude: 19.8765, longitude: 72.5432, radiusMeters: 40 },
        flow: {
          startNodeId: 'read',
          nodes: [
            { id: 'read', type: 'show_text', text: 'Current challenge.', next: 'done' },
            { id: 'done', type: 'complete' },
          ],
        },
        hints: [],
      },
      {
        id: 'finale-private',
        title: 'Secret finale',
        basePoints: 10,
        location: { latitude: 18.7654, longitude: 73.4321, radiusMeters: 30 },
        flow: {
          startNodeId: 'read',
          nodes: [
            { id: 'read', type: 'show_text', text: 'Finish here.', next: 'done' },
            { id: 'done', type: 'complete' },
          ],
        },
        hints: [],
      },
    ],
  };
}

const plan: ResolvedRunPlan = {
  routeCheckpointIds: ['start', 'library', 'finale-private'],
  checkpointIds: ['start', 'library-riddle-private', 'finale-private'],
  challenges: [
    { routeCheckpointId: 'start', checkpointId: 'start' },
    {
      routeCheckpointId: 'library',
      poolId: 'library-private-pool',
      variantId: 'riddle-private',
      checkpointId: 'library-riddle-private',
    },
    { routeCheckpointId: 'finale-private', checkpointId: 'finale-private' },
  ],
  variables: {},
};

function playerView(value: V3Definition, state: ReturnType<typeof createInitialState>) {
  return v3PlayerView({
    definition: value,
    plan,
    state,
    now,
    huntStatus: 'live',
    run: { id: '00000000-0000-0000-0000-000000000001', runNumber: 1, practice: false, eligible: true },
    team: { id: '00000000-0000-0000-0000-000000000002', code: 'T-014', displayName: 'Falcons' },
    member: { id: '00000000-0000-0000-0000-000000000003', name: 'Aarav' },
  });
}

test('V3 player projection hides future authored route IDs, variant IDs, titles, groups, and locations', () => {
  const hunt = definition();
  const engineDefinition = materializeRunDefinition(hunt, plan);
  let state = createInitialState(engineDefinition, '00000000-0000-0000-0000-000000000001', now);

  const initial = playerView(hunt, state);
  assert.deepEqual(initial.checkpoints?.map(checkpoint => checkpoint.id), ['start', 'stage:2', 'stage:3']);
  assert.deepEqual(initial.summary?.checkpoints.map(checkpoint => checkpoint.id), ['start', 'stage:2', 'stage:3']);
  assert.deepEqual(initial.checkpoints?.[1], {
    id: 'stage:2',
    title: 'Stage 2',
    status: 'locked',
    required: true,
  });
  const serialized = JSON.stringify(initial);
  for (const secret of [
    'library-riddle-private',
    'library-private-pool',
    'riddle-private',
    'Secret library challenge',
    'Secret library route',
    'finale-private',
    'Secret finale',
    '19.8765',
    '18.7654',
  ]) assert.equal(serialized.includes(secret), false, `future player view leaked ${secret}`);

  state = executeCommand(
    engineDefinition,
    state,
    { type: 'continue', checkpointId: 'start', nodeId: 'read' },
    now,
  ).state;
  const advanced = playerView(hunt, state);
  assert.equal(advanced.checkpoint?.id, 'library-riddle-private', 'the current authored ID still supports commands');
  assert.equal(advanced.checkpoints?.[1].id, advanced.checkpoint?.id, 'the progress strip can identify its current stage');
  assert.equal(advanced.checkpoints?.[1].location?.latitude, 19.8765, 'the reached location is now available');
  assert.equal(advanced.checkpoints?.[2].id, 'stage:3');
  assert.equal(advanced.checkpoints?.[2].location, undefined);
  assert.equal(JSON.stringify(advanced).includes('finale-private'), false, 'the next authored checkpoint stays private');
});

test('V3 player projection exposes only the currently active parallel mechanic', () => {
  const hunt = definition();
  hunt.settings.routePlan = {
    startCheckpointId: 'parallel-stage',
    finaleCheckpointId: 'parallel-stage',
    requiredCheckpointIds: [],
    choose: { count: 0, fromCheckpointIds: [] },
    shuffleSelectedCheckpoints: false,
    checkpointEstimates: {},
    travelEstimates: [],
  };
  hunt.settings.challengePools = {};
  hunt.settings.parallelMechanics = [
    {
      id: 'current-mechanic',
      checkpointId: 'parallel-stage',
      nodeId: 'gate-one',
      timeWindowSeconds: 120,
      lanes: [
        { id: 'current-a', label: 'Current lane alpha', type: 'code', code: 'CURRENT-ALPHA' },
        { id: 'current-b', label: 'Current lane beta', type: 'code', code: 'CURRENT-BETA' },
      ],
    },
    {
      id: 'future-mechanic-secret',
      checkpointId: 'parallel-stage',
      nodeId: 'gate-two-secret',
      timeWindowSeconds: 120,
      lanes: [
        { id: 'future-a-secret', label: 'Future lane alpha secret', type: 'code', code: 'FUTURE-ALPHA' },
        { id: 'future-b-secret', label: 'Future lane beta secret', type: 'code', code: 'FUTURE-BETA' },
      ],
    },
  ];
  hunt.checkpoints = [{
    id: 'parallel-stage',
    title: 'Parallel stage',
    basePoints: 10,
    hints: [],
    flow: {
      startNodeId: 'gate-one',
      nodes: [
        { id: 'gate-one', type: 'verify_organizer', prompt: 'Complete the current lanes.', next: 'gate-two-secret' },
        { id: 'gate-two-secret', type: 'verify_organizer', prompt: 'Complete the future lanes.', next: 'done' },
        { id: 'done', type: 'complete' },
      ],
    },
  }];
  const parallelPlan: ResolvedRunPlan = {
    routeCheckpointIds: ['parallel-stage'],
    checkpointIds: ['parallel-stage'],
    challenges: [{ routeCheckpointId: 'parallel-stage', checkpointId: 'parallel-stage' }],
    variables: {},
  };
  const engineDefinition = materializeRunDefinition(hunt, parallelPlan);
  const state = createInitialState(engineDefinition, '00000000-0000-0000-0000-000000000011', now);
  const project = (huntStatus: string) => v3PlayerView({
    definition: hunt,
    plan: parallelPlan,
    state,
    now,
    huntStatus,
    run: { id: '00000000-0000-0000-0000-000000000011', runNumber: 1, practice: false, eligible: true },
    team: { id: '00000000-0000-0000-0000-000000000012', code: 'T-015', displayName: null },
    member: { id: '00000000-0000-0000-0000-000000000013', name: 'Priya' },
  });

  const live = project('live');
  assert.deepEqual(live.features.parallelMechanics.map(mechanic => mechanic.id), ['current-mechanic']);
  const serialized = JSON.stringify(live);
  for (const secret of ['future-mechanic-secret', 'gate-two-secret', 'future-a-secret', 'Future lane alpha secret']) {
    assert.equal(serialized.includes(secret), false, `future parallel task leaked ${secret}`);
  }
  assert.deepEqual(project('paused').features.parallelMechanics, [], 'paused gameplay does not disclose active lane metadata');
});
