import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CASUAL_INTEGRITY_POLICY,
  hasExplicitIntegrityPolicy,
  parseDefinitionForPlayStyle,
  readIntegrityPolicy,
  withIntegrityPolicy,
} from '../components/v3/admin/integrityPolicy';

test('play-style editor shows casual defaults for a valid draft without an explicit policy', () => {
  const definition = parseDefinitionForPlayStyle(JSON.stringify({
    schemaVersion: 3,
    id: 'casual-hunt',
    settings: { registrationMode: 'self-serve' },
  }));
  assert.ok(definition);
  assert.equal(hasExplicitIntegrityPolicy(definition), false);
  assert.deepEqual(readIntegrityPolicy(definition), CASUAL_INTEGRITY_POLICY);
});

test('play-style editor writes exact policy values without disturbing the rest of the draft', () => {
  const definition = {
    schemaVersion: 3,
    id: 'prize-hunt',
    title: 'Prize Hunt',
    settings: { registrationMode: 'self-serve', runPolicy: { mode: 'capped', maxOfficialRuns: 2 } },
    checkpoints: [{ id: 'start' }],
  };
  const updated = withIntegrityPolicy(definition, {
    locationVerification: 'strict',
    selfServeApproval: 'organizer',
    rosterParticipation: 'freeze_at_run_start',
  });

  assert.deepEqual(readIntegrityPolicy(updated), {
    locationVerification: 'strict',
    selfServeApproval: 'organizer',
    rosterParticipation: 'freeze_at_run_start',
  });
  assert.equal(hasExplicitIntegrityPolicy(updated), true);
  assert.equal(updated.title, definition.title);
  assert.deepEqual((updated.settings as Record<string, unknown>).runPolicy, { mode: 'capped', maxOfficialRuns: 2 });
  assert.deepEqual(updated.checkpoints, definition.checkpoints);
  assert.equal(hasExplicitIntegrityPolicy(definition), false, 'the source draft stays immutable');
});

test('play-style editor never overwrites malformed JSON', () => {
  assert.equal(parseDefinitionForPlayStyle('{"settings":'), null);
  assert.equal(parseDefinitionForPlayStyle('[]'), null);
});

test('an incomplete saved policy can be repaired with the casual preset', () => {
  const definition = { settings: { integrityPolicy: { locationVerification: 'not-a-mode' } } };
  assert.equal(hasExplicitIntegrityPolicy(definition), false);
  assert.deepEqual(readIntegrityPolicy(definition), CASUAL_INTEGRITY_POLICY);
  assert.equal(hasExplicitIntegrityPolicy(withIntegrityPolicy(definition, CASUAL_INTEGRITY_POLICY)), true);
});
