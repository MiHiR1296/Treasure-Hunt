import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionRunTarget } from '../components/v3/sessionTarget';
import type { SessionRunSummary } from '../components/v3/types';

function run(id: string, status: SessionRunSummary['status']): SessionRunSummary {
  return {
    id,
    runNumber: 1,
    status,
    practice: false,
    eligible: true,
    score: 20,
    elapsedMilliseconds: status === 'completed' ? 60_000 : null,
  };
}

test('a frozen-roster late joiner stays in the waiting lobby instead of reopening an older finish', () => {
  assert.equal(sessionRunTarget({
    activeRun: null,
    latestRun: run('older-completed-run', 'completed'),
    waitingForNextRun: true,
  }), null);
});

test('session target prefers a participating active run and otherwise restores a completed result', () => {
  const active = run('active-run', 'active');
  assert.equal(sessionRunTarget({ activeRun: active, latestRun: null, waitingForNextRun: false }), active);
  const completed = run('completed-run', 'completed');
  assert.equal(sessionRunTarget({ activeRun: null, latestRun: completed, waitingForNextRun: false }), completed);
  assert.equal(sessionRunTarget({ activeRun: null, latestRun: run('abandoned-run', 'abandoned'), waitingForNextRun: false }), null);
});
