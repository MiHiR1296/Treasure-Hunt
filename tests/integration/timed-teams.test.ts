import '../isolated-database';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { getPool } from '../../lib/server/db';
import { deleteDraft, publishDraft, publishHunt, saveDraft, setHuntStatus } from '../../lib/server/hunts';
import { applyTeamCommand, getTeamRecord, joinTeam, organizerSnapshot, teamView } from '../../lib/server/store';
import { listResults, resultActivity, resultBatch, resultHistory, resultManifest, teamResult } from '../../lib/server/results';
import { startPreview } from '../../lib/server/operations';
import { authenticate, digest, HttpError, TEAM_COOKIE } from '../../lib/server/security';
import { cleanupMedia, readMedia, uploadPhoto, validatePhotoTask } from '../../lib/server/media';
import { EngineError, type HuntDefinition } from '../../lib/engine/types';
import { jsonBody } from '../../lib/server/http';

const enabled = !!process.env.DATABASE_URL, ids: string[] = [];
let directory: string;
const fails = (code: string) => (e: unknown) => e instanceof EngineError && e.code === code;
const conflict = (e: unknown) => e instanceof HttpError && e.status === 409;
function definition(settings: HuntDefinition['settings'] = {}): HuntDefinition {
  const id = `timed-${randomUUID()}`; ids.push(id);
  return { schemaVersion: 1, id, version: 1, title: 'Timed integration', settings: { sessionDurationSeconds: 120, minTeamSize: 2, maxTeamSize: 4, assignmentVersion: 2, ...settings },
    checkpoints: [{ id: 'one', title: 'Question', basePoints: 10, hints: [
      { id: 'first', title: 'First hint', cost: 2, relevance: { nodeId: 'answer' }, content: { type: 'text', text: 'Look up' } },
      { id: 'later', title: 'Secret future hint', cost: 2, relevance: { nodeId: 'next' }, content: { type: 'text', text: 'Later clue' } },
    ], flow: { startNodeId: 'answer', nodes: [
      { id: 'answer', type: 'verify_answer', prompt: 'Private first task', answers: ['yes'], recordAnswerAttempts: true, next: 'next' },
      { id: 'next', type: 'verify_answer', prompt: 'Next task', answers: ['next'], next: 'done' }, { id: 'done', type: 'complete' },
    ] } }] };
}
const join = (huntId: string, names = ['Alice', 'Bob']) => joinTeam({ huntId, teamName: randomUUID(), playerName: 'Alice', pin: '123456', mode: 'create', memberNames: names });
const command = (teamId: string, command: unknown) => applyTeamCommand(teamId, randomUUID(), command);
const start = async (teamId: string) => command(teamId, { type: 'start_session', expectedRevision: (await teamView(teamId)).revision });
const control = async (teamId: string, control: object) => applyTeamCommand(teamId, randomUUID(), { ...control, expectedRevision: (await teamView(teamId)).revision, reason: 'Integration correction' }, 'control');
const deadline = (teamId: string, seconds: number) => getPool().query(`update hunt_v2.teams set state=jsonb_set(state,'{timer,deadlineAt}',to_jsonb(to_char(clock_timestamp()+$2*interval '1 second','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) where id=$1`, [teamId, seconds]);
before(async () => {
  if (!enabled) return;
  await getPool().query(await readFile(new URL('../../database/v2.sql', import.meta.url), 'utf8'));
  directory = await mkdtemp(path.join(tmpdir(), 'timed-hunt-tests-')); process.env.MEDIA_DIRECTORY = directory;
});
after(async () => {
  if (!enabled) return;
  await getPool().query('delete from hunt_v2.hunts where id=any($1::text[])', [ids]);
  await getPool().query('delete from hunt_v2.drafts where id=any($1::text[])', [ids]);
  await getPool().end(); if (directory) await rm(directory, { recursive: true, force: true });
});

test('PostgreSQL: atomic starts, roster races, session revocation and immutable starting roster', { skip: !enabled }, async () => {
  const h = definition(); await publishHunt(h); const team = await join(h.id, ['Alice']); const id = team.view.teamId;
  assert.equal(team.view.status, 'waiting'); assert.equal(JSON.stringify(team.view).includes('Private first task'), false);
  await assert.rejects(start(id), fails('invalid_roster'));
  await assert.rejects(command(id, { type: 'update_roster', expectedRevision: 0, names: ['Alice', 'Ａlice'] }));
  await assert.rejects(command(id, { type: 'update_roster', expectedRevision: 0, names: ['Alice', 'B', 'C', 'D', 'E'] }), fails('invalid_roster'));
  await command(id, { type: 'update_roster', expectedRevision: 0, names: ['Alice', 'Bob'] });
  await control(id, { type: 'review_result', status: 'flagged', note: 'Recheck after the team starts' });
  const waitingReview = (await getTeamRecord(id)).state.resultReview;
  const revision = (await teamView(id)).revision;
  const results = await Promise.allSettled([
    command(id, { type: 'start_session', expectedRevision: revision }),
    command(id, { type: 'update_roster', expectedRevision: revision, names: ['Alice', 'Carol'] }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  if ((await teamView(id)).status === 'waiting') await start(id);
  const original = (await getTeamRecord(id)).state;
  assert.deepEqual(original.resultReview, waitingReview); assert.equal((await teamResult(id)).summary.reviewOutdated, true);
  await Promise.all(Array.from({ length: 8 }, () => command(id, { type: 'start_session', expectedRevision: 0 })));
  assert.deepEqual((await getTeamRecord(id)).state, original);
  assert.equal(original.events.filter(e => e.type === 'session_started').length, 1);
  await assert.rejects(joinTeam({ huntId: h.id, teamName: team.view.teamName, playerName: 'Eve', pin: '123456', mode: 'join' }), fails('roster_locked'));
  await control(id, { type: 'correct_roster', names: ['Bob', 'Carol'] });
  assert.deepEqual((await getTeamRecord(id)).state.startingRoster, original.startingRoster);
  await assert.rejects(authenticate(team.token, 'team'));
  await assert.rejects(applyTeamCommand(id, randomUUID(), { type: 'verify', checkpointId: 'one', nodeId: 'answer', value: 'yes' }, false, { role: 'team', sessionHash: digest(team.token) }), (e: unknown) => e instanceof HttpError && e.status === 401);
});

test('PostgreSQL: deadline checked after lock, lost receipt recovery, pause/resume publication and reopen', { skip: !enabled }, async () => {
  const h = definition(); await publishHunt(h); const team = await join(h.id), id = team.view.teamId; await start(id);
  const requestId = randomUUID(), wrong = { type: 'verify', checkpointId: 'one', nodeId: 'answer', value: 'wrong' };
  await applyTeamCommand(id, requestId, wrong);
  const blocker = await getPool().connect();
  await blocker.query('begin'); await blocker.query('select id from hunt_v2.teams where id=$1 for update', [id]);
  // Request starts while time remains, but receives its team lock after expiration.
  const blocked = command(id, wrong); const rejected = assert.rejects(blocked, fails('session_expired'));
  await blocker.query(`update hunt_v2.teams set state=jsonb_set(state,'{timer,deadlineAt}',to_jsonb(to_char(clock_timestamp()-interval '1 second','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) where id=$1`, [id]);
  await blocker.query('commit'); blocker.release(); await rejected;
  const expired = (await getTeamRecord(id)).state;
  assert.equal((await applyTeamCommand(id, requestId, wrong)).feedback.status, 'rejected');
  assert.equal((await getTeamRecord(id)).state.revision, expired.revision);
  await setHuntStatus(h.id, 'paused');
  assert.equal((await getTeamRecord(id)).state.timer?.pauses.length, 0, 'expired before pause is not revived');
  await control(id, { type: 'extend_session', seconds: 60 });
  const frozen = (await getTeamRecord(id)).state;
  assert.equal(frozen.timer?.pauses.length, 1); assert.equal((await teamView(id)).timer?.paused, true);
  await publishHunt({ ...h, title: 'Future version' }, { expectedVersion: 1 });
  assert.equal((await getTeamRecord(id)).status, 'paused'); assert.equal((await getTeamRecord(id)).state.definitionVersion, 1);
  await setHuntStatus(h.id, 'live'); const resumed = (await getTeamRecord(id)).state;
  await setHuntStatus(h.id, 'live'); assert.deepEqual((await getTeamRecord(id)).state, resumed);
  assert.ok(Date.parse(resumed.timer!.deadlineAt) >= Date.parse(frozen.timer!.deadlineAt));
  assert.equal(resumed.timer!.pauses.filter(p => !!p.endedAt).length, 1);
  assert.equal(resumed.startedAt, expired.startedAt);
  await command(id, wrong);
  await setHuntStatus(h.id, 'paused');
  await assert.rejects(command(id, wrong), fails('session_paused'));
  assert.equal((await joinTeam({ huntId: h.id, teamName: team.view.teamName, playerName: 'Bob', pin: '123456', mode: 'join' })).view.teamId, id);
});

test('PostgreSQL: purchase/solve race has exact ledger, durable attempts exceed display cache, reviews become outdated', { skip: !enabled }, async () => {
  const h = definition(); await publishHunt(h); const team = await join(h.id), id = team.view.teamId; await start(id);
  const wrong = { type: 'verify', checkpointId: 'one', nodeId: 'answer', value: 'wrong' };
  await Promise.all(Array.from({ length: 26 }, (_, i) => command(id, { ...wrong, value: `guess-${i}` })));
  const purchases = await Promise.allSettled([command(id, { type: 'use_hint', checkpointId: 'one', hintId: 'first' }), command(id, { ...wrong, value: 'yes' })]);
  const state = (await getTeamRecord(id)).state;
  assert.equal(state.checkpoints.one.nodes.answer.answerAttempts?.length, 20);
  assert.equal(state.score, purchases[0].status === 'fulfilled' ? -2 : 0);
  assert.equal(state.ledger.reduce((sum, entry) => sum + entry.amount, 0), state.score);
  await assert.rejects(command(id, { type: 'use_hint', checkpointId: 'one', hintId: 'later', deadlineAt: 'forged' }), fails('invalid_command'));
  const audit = await resultActivity(id, state.revision);
  assert.equal(audit.entries.filter(e => e.type === 'answer_submitted').length, 27);
  await control(id, { type: 'review_result', status: 'approved', note: 'Checked manually' });
  assert.equal((await teamResult(id)).summary.reviewOutdated, false);
  await command(id, { type: 'verify', checkpointId: 'one', nodeId: 'next', value: 'next' });
  assert.equal((await teamResult(id)).summary.reviewOutdated, true);
  assert.ok((await listResults(h.id)).teams.some(t => t.id === id));
  const summary = (await organizerSnapshot()).teams.find(t => t.id === id)!;
  assert.deepEqual(summary.checkpoints, {}); assert.deepEqual(summary.ledger, []);
  assert.equal(JSON.stringify(summary).includes('guess-'), false);
});

test('PostgreSQL: draft generation prevents delete/recreate ABA and publication/delete races', { skip: !enabled }, async () => {
  const h = definition(), original = await saveDraft(h, null);
  await deleteDraft(h.id, original.revision, original.generation); await deleteDraft(h.id, original.revision, original.generation);
  const recreated = await saveDraft(h, null); assert.notEqual(original.generation, recreated.generation);
  await assert.rejects(deleteDraft(h.id, original.revision, original.generation), conflict);
  await assert.rejects(saveDraft(h, original.revision, original.generation), conflict);
  await assert.rejects(publishDraft(h.id, original.revision, { generation: original.generation }), conflict);
  const raced = await Promise.allSettled([publishDraft(h.id, recreated.revision, { generation: recreated.generation }), deleteDraft(h.id, recreated.revision, recreated.generation)]);
  assert.equal(raced.filter(r => r.status === 'fulfilled').length, 1);
});

test('PostgreSQL: timed photo survives latest-start cutoff and expiry; approval records actual review time', { skip: !enabled }, async () => {
  const h = definition({ photoRetention: 'after_event' });
  h.checkpoints[0].hints = [];
  h.checkpoints[0].flow = { startNodeId: 'photo', nodes: [{ id: 'photo', type: 'verify_image', prompt: 'Photograph', referenceImages: ['/private-reference.jpg'], next: 'done' }, { id: 'done', type: 'complete' }] };
  await publishHunt(h); const team = await join(h.id), id = team.view.teamId; await start(id);
  const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const media = await uploadPhoto(id, { id: randomUUID(), checkpointId: 'one', nodeId: 'photo', file: new File([new Uint8Array(bytes)], 'photo.png', { type: 'image/png' }) });
  const photoCommand = { type: 'submit_photo', checkpointId: 'one', nodeId: 'photo', mediaId: media.id }, receipt = randomUUID();
  await applyTeamCommand(id, receipt, photoCommand); await deadline(id, -1);
  await getPool().query(`update hunt_v2.hunt_versions set definition=jsonb_set(definition,'{settings,endsAt}',to_jsonb(to_char(clock_timestamp()-interval '1 second','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) where hunt_id=$1`, [h.id]);
  await cleanupMedia();
  const request = new NextRequest(`http://localhost/api/v2/media/${media.id}`, { headers: { cookie: `${TEAM_COOKIE}=${team.token}` } });
  assert.ok(await readMedia(request, media.id));
  await assert.rejects(validatePhotoTask(id, { checkpointId: 'one', nodeId: 'photo' }), fails('session_expired'));
  await assert.rejects(command(id, photoCommand), fails('session_expired'));
  await applyTeamCommand(id, receipt, photoCommand);
  await control(id, { type: 'approve_action', checkpointId: 'one', nodeId: 'photo' });
  const report = await teamResult(id), activity = await resultActivity(id, report.summary.revision);
  const submitted = activity.entries.find(e => e.type === 'photo_evidence_submitted'), reviewed = activity.entries.find(e => e.type === 'photo_evidence_reviewed');
  assert.ok(submitted && reviewed); assert.ok(new Date(reviewed.at).getTime() >= new Date(submitted.at).getTime());
  assert.equal(report.summary.completedAt, new Date(reviewed.at).toISOString());
  await setHuntStatus(h.id, 'ended'); await cleanupMedia();
  await assert.rejects(readMedia(request, media.id), (e: unknown) => e instanceof HttpError && e.status === 404);
});

test('PostgreSQL: previews stay isolated and forced assignment maps are never live mutations', { skip: !enabled }, async () => {
  const h = definition(); const nodes = h.checkpoints[0].flow.nodes;
  nodes.unshift({ id: 'router', type: 'random_branch', choices: [{ next: 'answer', weight: 1 }, { next: 'next', weight: 1 }] }); h.checkpoints[0].flow.startNodeId = 'router';
  await publishHunt(h);
  const preview = await startPreview({ huntId: h.id, routeChoices: { 'one:router': 1 } });
  await start(preview.view.teamId); assert.equal((await teamView(preview.view.teamId)).node?.id, 'next');
  const before = (await getTeamRecord(preview.view.teamId)).state.routeAssignments;
  const second = await startPreview({ huntId: h.id, routeChoices: { 'one:router': 0 } });
  assert.notEqual(preview.view.teamId, second.view.teamId); assert.deepEqual((await getTeamRecord(preview.view.teamId)).state.routeAssignments, before);
  assert.deepEqual((await listResults(h.id)).teams, []);
});

test('PostgreSQL: paged legacy history exports retain an exact prefix during later corrections', { skip: !enabled }, async () => {
  const h = definition(); await publishHunt(h); const team = await join(h.id), id = team.view.teamId; await start(id);
  for (let index = 0; index < 105; index++) await control(id, { type: 'adjust_score', amount: 1 });
  const original = (await getTeamRecord(id)).state, report = await teamResult(id);
  assert.equal(report.counts.ledger, 105); assert.equal(report.team.ledger.length, 100); assert.equal(report.team.ledgerTotals.organizer_adjustment, 105);
  await control(id, { type: 'adjust_score', amount: -1 });
  const first = await resultHistory(id, 'ledger', report.summary.revision, report.counts.ledger, 0, report.measuredAt);
  assert.equal(first.entries.length, 100); assert.equal(first.next, 100);
  const last = await resultHistory(id, 'ledger', report.summary.revision, report.counts.ledger, first.next!, report.measuredAt);
  assert.equal(last.next, null); assert.deepEqual([...first.entries, ...last.entries], original.ledger);
  await assert.rejects(resultHistory(id, 'ledger', report.summary.revision, 9999, 9900, report.measuredAt), conflict);
});

test('PostgreSQL: summary export freezes team membership, excludes previews and refuses incomplete batches', { skip: !enabled }, async () => {
  const h = definition(); await publishHunt(h); const first = await join(h.id);
  await startPreview({ huntId: h.id });
  const manifest = await resultManifest(h.id); assert.deepEqual(manifest.ids, [first.view.teamId]);
  const second = await join(h.id);
  const batch = await resultBatch(h.id, manifest.ids, manifest.asOf);
  assert.equal(batch.teams.length, 1); assert.equal(batch.teams[0].id, first.view.teamId);
  assert.equal(batch.teams[0].registrationCutoff, manifest.asOf); assert.equal(batch.teams[0].revision, first.view.revision);
  assert.equal((await resultManifest(h.id)).ids.length, 2);
  await getPool().query('delete from hunt_v2.teams where id=$1', [first.view.teamId]);
  await assert.rejects(resultBatch(h.id, [first.view.teamId, second.view.teamId], manifest.asOf), conflict);
});

test('PostgreSQL: failure while writing audit rolls back state, charge and receipt together', { skip: !enabled }, async () => {
  const h = definition(); await publishHunt(h); const team = await join(h.id), id = team.view.teamId; await start(id);
  const original = (await getTeamRecord(id)).state, requestId = randomUUID(), hint = { type: 'use_hint', checkpointId: 'one', hintId: 'first' };
  await getPool().query(`create or replace function hunt_v2.test_reject_audit() returns trigger language plpgsql as $$ begin if NEW.team_id::text=TG_ARGV[0] then raise exception 'Injected disposable-test audit failure'; end if; return NEW; end $$`);
  await getPool().query(`create trigger test_reject_audit before insert on hunt_v2.team_activity for each row execute function hunt_v2.test_reject_audit('${id}')`);
  try {
    await assert.rejects(applyTeamCommand(id, requestId, hint), /Injected disposable-test audit failure/);
    assert.deepEqual((await getTeamRecord(id)).state, original);
    assert.equal((await getPool().query('select 1 from hunt_v2.command_receipts where team_id=$1 and request_id=$2', [id, requestId])).rowCount, 0);
  } finally { await getPool().query('drop trigger test_reject_audit on hunt_v2.team_activity'); await getPool().query('drop function hunt_v2.test_reject_audit()'); }
  await applyTeamCommand(id, requestId, hint); await applyTeamCommand(id, requestId, hint);
  const state = (await getTeamRecord(id)).state; assert.equal(state.score, -2); assert.equal(state.ledger.length, 1);
  const audit = await resultActivity(id, state.revision); assert.equal(audit.entries.filter(e => e.type === 'hint_used').length, 1);
});

test('PostgreSQL: maximal 100-checkpoint graph within the authoring payload limit starts and reports safely', { skip: !enabled }, async () => {
  const h = definition({ minTeamSize: 1 }), headers = { Origin: process.env.APP_ORIGIN ?? 'http://localhost:3000', 'Content-Type': 'application/json' };
  let previous = h.checkpoints;
  for (let length = 2; length <= 200; length++) {
    h.checkpoints = Array.from({ length: 100 }, (_, checkpoint) => ({ id: `c${checkpoint}`, title: `Checkpoint ${checkpoint}`, basePoints: 1, hints: [], flow: {
      startNodeId: 'n0', nodes: Array.from({ length }, (_, node) => node === length - 1 ? { id: `n${node}`, type: 'complete' as const } : { id: `n${node}`, type: 'set_variable' as const, key: 'n', value: node, next: `n${node + 1}` }),
    } }));
    if (Buffer.byteLength(JSON.stringify({ definition: h })) > 511_000) { h.checkpoints = previous; break; }
    previous = h.checkpoints;
  }
  const body = JSON.stringify({ definition: h }); assert.ok(Buffer.byteLength(body) > 490_000);
  const parsed = await jsonBody(new NextRequest('http://localhost:3000/api/v2/admin/hunts', { method: 'POST', headers, body }));
  await publishHunt(parsed.definition); const team = await join(h.id, ['Alice']); await start(team.view.teamId);
  const state = (await getTeamRecord(team.view.teamId)).state;
  assert.equal(state.status, 'completed'); assert.equal(state.score, 100); assert.equal(state.ledger.length, 100);
  const report = await teamResult(team.view.teamId); assert.equal(report.checkpoints.length, 100); assert.equal(report.counts.ledger, 100);
  assert.ok(Buffer.byteLength(JSON.stringify((await listResults(h.id)).teams)) < 3000, 'summary excludes the large node graph');
  await assert.rejects(jsonBody(new NextRequest('http://localhost:3000/api/v2/admin/hunts', { method: 'POST', headers, body: JSON.stringify({ definition: h, padding: 'x'.repeat(512_001) }) })), (error: unknown) => error instanceof HttpError && error.status === 413);
});
