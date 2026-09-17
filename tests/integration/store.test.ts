import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getPool } from '../../lib/server/db';
import { applyTeamCommand, joinTeam, publishHunt, setHuntStatus, teamView } from '../../lib/server/store';
import { authenticate, HttpError } from '../../lib/server/security';
import type { GameState, HuntDefinition } from '../../lib/engine/types';

const enabled = Boolean(process.env.DATABASE_URL);
const huntId = `integration-${randomUUID()}`;
const definition: HuntDefinition = {
  schemaVersion: 1, id: huntId, version: 1, title: 'Transaction test',
  dudQrs: [{ token: 'dud-private-token', message: 'Try another code!' }],
  checkpoints: [
    { id: 'qr', title: 'QR task', basePoints: 20,
      flow: { startNodeId: 'scan', nodes: [
        { id: 'scan', type: 'verify_qr', prompt: 'Find the code', token: 'private-token', backupCode: 'SAFE42', next: 'done' },
        { id: 'done', type: 'complete' },
      ] },
      hints: [1, 2, 3].map(i => ({ id: `hint-${i}`, title: `Hint ${i}`, cost: i * 2, content: { type: 'text' as const, text: `Secret ${i}` } })),
    },
    { id: 'answer', title: 'Final task', basePoints: 10,
      flow: { startNodeId: 'question', nodes: [
        { id: 'question', type: 'verify_answer', prompt: 'The answer?', answers: ['private-answer'], next: 'done' },
        { id: 'done', type: 'complete' },
      ] }, hints: [],
    },
  ],
};

after(async () => {
  if (!enabled) return;
  await getPool().query('delete from hunt_v2.hunts where id=$1', [huntId]);
  await getPool().end();
});

test('PostgreSQL: independent devices, retries, refresh, scoring, auth, and rescue', { skip: !enabled }, async () => {
  await getPool().query(await readFile(new URL('../../database/v2.sql', import.meta.url), 'utf8'));
  await publishHunt(definition);
  await assert.rejects(publishHunt(definition), (error: unknown) => error instanceof HttpError && error.status === 409);
  const one = await joinTeam({ huntId, teamName: 'Explorers', playerName: 'Alice', pin: '123456', mode: 'create' });
  const two = await joinTeam({ huntId, teamName: 'EXPLORERS', playerName: 'Bob', pin: '123456', mode: 'join' });
  assert.equal(one.view.teamId, two.view.teamId);
  assert.notEqual(one.token, two.token);
  assert.equal((await authenticate(one.token, 'team')).team_id, one.view.teamId);
  await assert.rejects(authenticate(one.token, 'admin'));
  await assert.rejects(authenticate('invented-session', 'team'));
  await assert.rejects(joinTeam({ huntId, teamName: 'Explorers', playerName: 'Eve', pin: '999999', mode: 'join' }));
  const teamId = one.view.teamId;
  const raw = async () => (await getPool().query('select state from hunt_v2.teams where id=$1', [teamId])).rows[0].state as GameState;

  const hint = { type: 'use_hint', checkpointId: 'qr', hintId: 'hint-3' };
  const purchases = await Promise.all([applyTeamCommand(teamId, randomUUID(), hint), applyTeamCommand(teamId, randomUUID(), hint)]);
  assert.deepEqual(purchases.map(result => result.feedback.status).sort(), ['accepted', 'already_applied']);
  assert.equal((await raw()).ledger.length, 1);
  assert.equal((await teamView(teamId)).score, -6);
  assert.deepEqual(Object.keys((await raw()).hintUsage), ['hint-3']);
  const publicView = JSON.stringify(await teamView(teamId));
  for (const secret of ['private-token', 'SAFE42', 'private-answer', 'dud-private-token', 'Secret 1', 'Secret 2']) assert.equal(publicView.includes(secret), false);
  assert.equal(publicView.includes('Secret 3'), true);

  const wrongId = randomUUID();
  const wrong = { type: 'verify', checkpointId: 'qr', nodeId: 'scan', value: 'wrong' };
  assert.equal((await applyTeamCommand(teamId, wrongId, wrong)).feedback.scannerShouldStop, false);
  await applyTeamCommand(teamId, wrongId, wrong);
  assert.equal((await raw()).checkpoints.qr.nodes.scan.attempts, 1);
  await assert.rejects(applyTeamCommand(teamId, wrongId, { ...wrong, value: 'private-token' }), (error: unknown) => error instanceof HttpError && error.status === 409);
  assert.equal((await applyTeamCommand(teamId, randomUUID(), { ...wrong, value: 'dud-private-token' })).feedback.status, 'dud');
  await setHuntStatus(huntId, 'paused');
  await assert.rejects(applyTeamCommand(teamId, randomUUID(), wrong));
  assert.equal((await applyTeamCommand(teamId, wrongId, wrong)).feedback.status, 'rejected');
  await setHuntStatus(huntId, 'live');

  const successId = randomUUID();
  const correct = { ...wrong, value: 'SAFE42' };
  const completions = await Promise.allSettled([applyTeamCommand(teamId, successId, correct), applyTeamCommand(teamId, randomUUID(), correct)]);
  assert.equal(completions.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await raw()).ledger.filter(entry => entry.kind === 'checkpoint_completed').length, 1);
  assert.equal((await teamView(teamId)).score, 14);
  assert.equal((await teamView(teamId)).checkpoint?.id, 'answer');
  // The first request may lose the lock race. Replay the winner's receipt below.
  const receipt = (await getPool().query("select request_id from hunt_v2.command_receipts where team_id=$1 and feedback->>'scannerShouldStop'='true'", [teamId])).rows[0];
  assert.equal((await applyTeamCommand(teamId, receipt.request_id, correct)).view.checkpoint?.id, 'answer');
  await applyTeamCommand(teamId, randomUUID(), hint);
  assert.equal((await teamView(teamId)).score, 14);

  const rescue = { checkpointId: 'answer', nodeId: 'question', reason: 'The physical clue was damaged.' };
  const rescueId = randomUUID();
  assert.equal((await applyTeamCommand(teamId, rescueId, rescue, true)).view.status, 'completed');
  await applyTeamCommand(teamId, rescueId, rescue, true);
  const final = await raw();
  assert.equal(final.score, 24);
  assert.equal(final.ledger.reduce((sum, entry) => sum + entry.amount, 0), final.score);
  assert.equal(final.events.filter(event => event.type === 'organizer_override').length, 1);
  assert.equal(final.events.find(event => event.type === 'organizer_override')?.reason, rescue.reason);
});
