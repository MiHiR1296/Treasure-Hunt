import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnalyticsResponse, normalizeLiveResponse } from '../components/v3/admin/client';

test('live organizer normalization round-trips lifecycle and all public-board controls', () => {
  const response = normalizeLiveResponse({
    measuredAt: '2026-10-05T12:00:00.000Z',
    selectedHuntId: 'night-hunt',
    hunts: [{
      id: 'night-hunt', title: 'Night Hunt', slug: 'night-hunt', status: 'paused',
      lifecycleRevision: 9,
      publicBoard: {
        enabled: true,
        slug: 'night-live',
        url: '/board/night-live',
        title: 'Night Hunt Live',
        cover: '/api/v3/media/11111111-1111-1111-1111-111111111111',
        status: 'frozen',
        showTeamNames: true,
        mainBoardVisible: false,
        replayBoardVisible: true,
        columns: ['rank', 'team_code', 'team_name', 'points', 'time'],
      },
    }],
    alerts: { help: 3, photos: 4, stalled: 2, fairness: 1 },
    teams: [],
  });

  assert.equal(response.hunt?.lifecycleRevision, 9);
  assert.deepEqual(response.alerts, { help: 3, photos: 4, stalled: 2, fairness: 1 });
  assert.deepEqual(response.publicBoard, {
    enabled: true,
    slug: 'night-live',
    url: '/board/night-live',
    title: 'Night Hunt Live',
    cover: '/api/v3/media/11111111-1111-1111-1111-111111111111',
    status: 'frozen',
    showTeamNames: true,
    mainBoardVisible: false,
    replayBoardVisible: true,
    columns: ['rank', 'team_code', 'team_name', 'points', 'time'],
  });
});

test('older live responses fall back to code-only public identity', () => {
  const response = normalizeLiveResponse({
    selectedHuntId: 'safe-hunt',
    hunts: [{
      id: 'safe-hunt', title: 'Safe Hunt', slug: 'safe-hunt', status: 'ready',
      publicBoard: { enabled: false, slug: 'safe-hunt', status: 'live' },
    }],
    teams: [],
  });

  assert.equal(response.publicBoard?.showTeamNames, false);
  assert.deepEqual(response.publicBoard?.columns, []);
});

test('flattened live rows use the active run ID instead of the team ID', () => {
  const response = normalizeLiveResponse({
    teams: [{
      id: '11111111-1111-1111-1111-111111111111',
      activeRunId: '22222222-2222-2222-2222-222222222222',
      code: 'T-014',
      status: 'archived',
      runNumber: 2,
      runStatus: 'active',
      score: 45,
      runRevision: 7,
      activeRunTimed: true,
      currentNodeId: 'organizer-gate',
      currentNodeType: 'verify_organizer',
      parallelMechanic: false,
    }],
  });

  assert.equal(response.teams[0]?.teamId, '11111111-1111-1111-1111-111111111111');
  assert.equal(response.teams[0]?.activeRun?.id, '22222222-2222-2222-2222-222222222222');
  assert.equal(response.teams[0]?.activeRun?.status, 'active');
  assert.equal(response.teams[0]?.activeRun?.revision, 7);
  assert.equal(response.teams[0]?.activeRun?.timed, true);
  assert.equal(response.teams[0]?.activeRun?.currentNodeId, 'organizer-gate');
  assert.equal(response.teams[0]?.activeRun?.currentNodeType, 'verify_organizer');
  assert.equal(response.teams[0]?.activeRun?.parallelMechanic, false);
});

test('analytics preserves the completion instant that makes an exact tie exact', () => {
  const response = normalizeAnalyticsResponse({
    ties: [{
      score: 100,
      elapsedMilliseconds: 600_000,
      completedAt: '2026-10-05T12:00:00.123456Z',
      teams: 2,
    }],
  });

  assert.deepEqual(response.ties, [{
    id: '100-600000-2026-10-05T12:00:00.123456Z',
    label: '100 points · 600 sec',
    value: 2,
    delta: 0,
    status: 'exact tie',
    detail: 'Same completion timestamp: 2026-10-05T12:00:00.123456Z',
  }]);
});
