import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../lib/server/security';
import { saveV3Draft, previewV3Draft, publishV3Draft } from '../lib/server/v3/authoring';
import { submitParallelLane } from '../lib/server/v3/parallel';
import { privateRecognition } from '../lib/server/v3/recognition';
import { applyRunCommand, currentRunView } from '../lib/server/v3/runs';
import { isV3Uuid, requireV3Uuid } from '../lib/server/v3/security';

test('V3 UUID validation accepts canonical database UUIDs and rejects permissive 36-character shapes', () => {
  const valid = randomUUID();
  assert.equal(isV3Uuid(valid), true);
  assert.equal(isV3Uuid(valid.toUpperCase()), true);
  assert.equal(isV3Uuid('00000000-0000-0000-0000-000000000000'), true, 'PostgreSQL accepts the nil UUID');

  for (const value of [
    `-${'a'.repeat(35)}`,
    `${'a'.repeat(35)}-`,
    'abcd'.repeat(9),
    '-'.repeat(36),
    '00000000-0000-0000-0000-00000000000g',
    ` ${valid}`,
    `${valid} `,
  ]) {
    assert.equal(value.length === 36 || value.trim().length === 36, true, 'fixture remains a plausible boundary value');
    assert.equal(isV3Uuid(value), false, `rejected malformed UUID: ${JSON.stringify(value)}`);
    assert.throws(
      () => requireV3Uuid(value),
      (error: unknown) => error instanceof HttpError && error.status === 400,
    );
  }
});

test('V3 services reject malformed UUIDs before opening a database query', async () => {
  const malformed = 'abcd'.repeat(9);
  const teamId = randomUUID();
  const memberId = randomUUID();
  const rejectedAsBadRequest = (error: unknown) => error instanceof HttpError && error.status === 400;

  await assert.rejects(currentRunView(teamId, memberId, malformed), rejectedAsBadRequest);
  await assert.rejects(
    applyRunCommand(teamId, memberId, malformed, randomUUID(), { type: 'continue', checkpointId: 'start', nodeId: 'next' }),
    rejectedAsBadRequest,
  );
  await assert.rejects(privateRecognition(teamId, memberId, malformed), rejectedAsBadRequest);
  await assert.rejects(submitParallelLane({
    teamId,
    memberId,
    runId: malformed,
    requestId: randomUUID(),
    mechanicId: 'gate',
    laneId: 'north',
    evidence: { value: 'proof' },
  }), rejectedAsBadRequest);
  await assert.rejects(saveV3Draft({}, malformed, 1, randomUUID()), rejectedAsBadRequest);
  await assert.rejects(previewV3Draft({
    draftId: malformed,
    revision: 1,
    generation: randomUUID(),
    adminSessionHash: 'a'.repeat(64),
  }), rejectedAsBadRequest);
  await assert.rejects(publishV3Draft({
    draftId: randomUUID(),
    revision: 1,
    generation: malformed,
    adminSessionHash: 'a'.repeat(64),
  }), rejectedAsBadRequest);
});
