import test from 'node:test';
import assert from 'node:assert/strict';
import { rankLeaderboard } from '../lib/server/operations';

function team(name: string, score: number, completed: number, seconds: number | null = null) {
  return { teamId: name.toLowerCase(), name, score, completed, total: 6, hints: 0, finished: seconds !== null, seconds };
}
const standings = (entries: ReturnType<typeof rankLeaderboard>) => entries.map(({ name, rank }) => ({ name, rank }));

test('points-only rankings share ties regardless of progress or finish time', () => {
  const teams = [team('Beta', 20, 5, 10), team('Gamma', 19, 6, 1), team('Alpha', 20, 1)];
  assert.deepEqual(standings(rankLeaderboard(teams, 'points')), [
    { name: 'Alpha', rank: 1 }, { name: 'Beta', rank: 1 }, { name: 'Gamma', rank: 3 },
  ]);
  assert.deepEqual(teams.map(entry => entry.name), ['Beta', 'Gamma', 'Alpha']);
});

test('progress-only rankings share ties regardless of score or finish time', () => {
  assert.deepEqual(standings(rankLeaderboard([
    team('Beta', 100, 3, 10), team('Gamma', 1000, 2, 1), team('Alpha', -5, 3),
  ], 'progress')), [
    { name: 'Alpha', rank: 1 }, { name: 'Beta', rank: 1 }, { name: 'Gamma', rank: 3 },
  ]);
});

test('points and time ranks by those two criteria and keeps equal unfinished teams tied', () => {
  assert.deepEqual(standings(rankLeaderboard([
    team('Echo', 20, 5), team('Beta', 20, 6, 10), team('Gamma', 20, 6, 20),
    team('Delta', 20, 1), team('Alpha', 20, 4, 10), team('Foxtrot', 19, 6, 1),
  ], 'points_time')), [
    { name: 'Alpha', rank: 1 }, { name: 'Beta', rank: 1 }, { name: 'Gamma', rank: 3 },
    { name: 'Delta', rank: 4 }, { name: 'Echo', rank: 4 }, { name: 'Foxtrot', rank: 6 },
  ]);
});
