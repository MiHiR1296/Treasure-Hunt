import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLinkedHuntId } from '../components/v3/Registration';
import type { HuntSummary } from '../components/v3/types';

function hunt(id: string, slug: string): HuntSummary {
  return {
    id,
    slug,
    title: id,
    status: 'live',
    registrationMode: 'self-serve',
    registrationOpen: true,
    minTeamSize: 1,
    maxTeamSize: 10,
  };
}

test('join links resolve an immutable ID or unique slug without falling into another event', () => {
  const hunts = [hunt('hunt-one', 'night-walk'), hunt('hunt-two', 'museum-run')];
  assert.equal(resolveLinkedHuntId(hunts, 'hunt-one'), 'hunt-one');
  assert.equal(resolveLinkedHuntId(hunts, 'museum-run'), 'hunt-two');
  assert.equal(resolveLinkedHuntId(hunts, 'missing'), '');
  assert.equal(resolveLinkedHuntId(hunts, null), 'hunt-one');
});

test('an ID/slug collision is rejected instead of selecting an arbitrary event', () => {
  const hunts = [hunt('hunt-one', 'museum-run'), hunt('museum-run', 'other-slug')];
  assert.equal(resolveLinkedHuntId(hunts, 'museum-run'), '');
});
