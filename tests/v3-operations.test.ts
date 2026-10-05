import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyticsPeopleLabel,
  observedFairnessSignals,
  type ObservedFairnessGroup,
} from '../lib/server/v3/operations';

const group = (value: Partial<ObservedFairnessGroup> & Pick<ObservedFairnessGroup, 'kind' | 'cohortKey' | 'groupKey' | 'label'>): ObservedFairnessGroup => ({
  samples: 4,
  teamSamples: 4,
  averageScore: 100,
  medianElapsedMilliseconds: 600_000,
  ...value,
});

test('observed fairness signals require sampled peers and material score or time gaps', () => {
  const signals = observedFairnessSignals([
    group({ kind: 'route', cohortKey: 'all-routes', groupKey: '["start", "north", "finish"]', label: 'start → north → finish' }),
    group({
      kind: 'route',
      cohortKey: 'all-routes',
      groupKey: '["start", "south", "finish"]',
      label: 'start → south → finish',
      averageScore: 89,
      medianElapsedMilliseconds: 901_000,
    }),
    group({ kind: 'variant', cohortKey: 'library', groupKey: 'library:observation', label: 'observation' }),
    group({
      kind: 'variant',
      cohortKey: 'library',
      groupKey: 'library:riddle',
      label: 'riddle',
      averageScore: 90,
      medianElapsedMilliseconds: 900_000,
    }),
    group({
      kind: 'variant',
      cohortKey: 'park',
      groupKey: 'park:photo',
      label: 'photo',
    }),
    group({
      kind: 'variant',
      cohortKey: 'park',
      groupKey: 'park:riddle',
      label: 'riddle',
      samples: 12,
      teamSamples: 3,
      averageScore: 20,
      medianElapsedMilliseconds: 2_000_000,
    }),
  ]);

  assert.deepEqual(signals.map(signal => signal.groupKey), [
    '["start", "south", "finish"]',
    'library:riddle',
  ]);
  assert.match(signals[0].alert.detail, /4 eligible completions from 4 teams/i);
  assert.match(signals[0].alert.detail, /not proof of unfairness/i);
  assert.equal(signals[0].alert.severity, 'warning');
});

test('analytics member labels distinguish declared identities from organizer rosters', () => {
  assert.equal(analyticsPeopleLabel('self_serve'), 'declared members');
  assert.equal(analyticsPeopleLabel('organizer_assigned'), 'declared members');
  assert.equal(analyticsPeopleLabel('rostered'), 'rostered/check-in members');
});
