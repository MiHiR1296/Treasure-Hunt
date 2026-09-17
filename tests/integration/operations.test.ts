import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { getPool } from '../../lib/server/db';
import { saveDraft, publishDraft, publishHunt, listHunts, setHuntStatus } from '../../lib/server/hunts';
import { applyTeamCommand, getTeamRecord, joinTeam, organizerSnapshot, teamView } from '../../lib/server/store';
import { startPreview, simulatePreview, leaderboard, eventAnalytics, submitHelp, resolveHelp, teamMessages, sendAnnouncement } from '../../lib/server/operations';
import { uploadAsset, uploadPhoto, readMedia, makeJigsaw, cleanupMedia, deleteHunt, deleteAsset } from '../../lib/server/media';
import { HttpError, TEAM_COOKIE } from '../../lib/server/security';
import type { HuntDefinition } from '../../lib/engine/types';

const enabled = Boolean(process.env.DATABASE_URL);
const huntIds: string[] = [];
const assets: string[] = [];
let directory: string;
const status = (code: number) => (error: unknown) => error instanceof HttpError && error.status === code;
const definition = (settings: HuntDefinition['settings'] = {}): HuntDefinition => {
  const id = `operations-${randomUUID()}`; huntIds.push(id);
  return { schemaVersion: 1, id, version: 1, title: 'Operations test', settings,
    checkpoints: [{ id: 'start', title: 'Start', basePoints: 20, flow: { startNodeId: 'scan', nodes: [
      { id: 'scan', type: 'verify_qr', prompt: 'Find the marker', token: 'private-qr', next: 'finish', fallback: { nodeId: 'code', label: 'Use the replacement clue', enabled: false } },
      { id: 'code', type: 'verify_code', prompt: 'Enter the replacement code', code: 'RECOVER', next: 'finish' },
      { id: 'finish', type: 'complete' },
    ] }, hints: [{ id: 'third', title: 'Independent hint', cost: 6, content: { type: 'text', text: 'Hidden information' } }] }],
  };
};
const join = (huntId: string, name: string = randomUUID()) => joinTeam({ huntId, teamName: name, playerName: 'Alice', pin: '123456', mode: 'create' });
const command = (teamId: string, value: unknown) => applyTeamCommand(teamId, randomUUID(), value);
const control = async (teamId: string, value: object) => applyTeamCommand(teamId, randomUUID(), { ...value, expectedRevision: (await teamView(teamId)).revision, reason: 'Integration recovery' }, 'control');

before(async () => {
  if (!enabled) return;
  await getPool().query(await readFile(new URL('../../database/v2.sql', import.meta.url), 'utf8'));
  directory = await mkdtemp(path.join(tmpdir(), 'treasure-hunt-media-'));
  process.env.MEDIA_DIRECTORY = directory;
});
after(async () => {
  if (!enabled) return;
  await getPool().query('delete from hunt_v2.hunts where id=any($1::text[])', [huntIds]);
  await getPool().query('delete from hunt_v2.drafts where id=any($1::text[])', [huntIds]);
  await getPool().query('delete from hunt_v2.media where id=any($1::uuid[])', [assets]);
  await getPool().end();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('PostgreSQL: draft conflicts, version pinning, memberships and isolated previews', { skip: !enabled }, async () => {
  const hunt = definition({ maxTeamSize: 2 });
  const draft = await saveDraft(hunt, null);
  assert.equal(draft.revision, 1);
  await assert.rejects(saveDraft(hunt, null), status(409));
  const publication = await publishDraft(hunt.id, 1);
  const first = await join(hunt.id, 'Pinned team');
  const edited = structuredClone(hunt);
  edited.title = 'Changed title';
  const node = edited.checkpoints[0].flow.nodes[0];
  if (node.type === 'verify_qr') node.token = 'new-version-token';
  const saved = await saveDraft(edited, 2);
  await assert.rejects(saveDraft(hunt, 2), status(409));
  await publishDraft(hunt.id, saved.revision, { expectedVersion: publication.version });
  const second = await join(hunt.id);
  assert.equal((await getTeamRecord(first.view.teamId)).state.definitionVersion, 1);
  assert.equal((await getTeamRecord(second.view.teamId)).state.definitionVersion, 2);
  const teammate = await joinTeam({ huntId: hunt.id, teamName: 'PINNED TEAM', playerName: 'Bob', pin: '123456', mode: 'join' });
  assert.equal(teammate.view.hunt.title, hunt.title);
  assert.deepEqual(teammate.view.members.sort(), ['Alice', 'Bob']);
  await assert.rejects(joinTeam({ huntId: hunt.id, teamName: 'Pinned team', playerName: 'Carol', pin: '123456', mode: 'join' }), status(409));
  await joinTeam({ huntId: hunt.id, teamName: 'Pinned team', playerName: 'ALICE', pin: '123456', mode: 'join' });
  assert.equal((await command(first.view.teamId, { type: 'verify', checkpointId: 'start', nodeId: 'scan', value: 'private-qr' })).view.status, 'completed');
  assert.equal((await command(second.view.teamId, { type: 'verify', checkpointId: 'start', nodeId: 'scan', value: 'private-qr' })).feedback.status, 'rejected');
  const preview = await startPreview({ huntId: hunt.id });
  assert.equal(preview.view.isPreview, true);
  const simulationId = randomUUID();
  await simulatePreview(preview.view.teamId, simulationId, 'success');
  assert.equal((await simulatePreview(preview.view.teamId, simulationId, 'success')).view.status, 'completed');
  await assert.rejects(simulatePreview(preview.view.teamId, simulationId, 'wrong'), status(409));
  assert.equal((await leaderboard(second.view.teamId)).entries.length, 2);
  assert.equal((await eventAnalytics(hunt.id)).teams, 2);
  const draftPreview = await startPreview({ definition: edited }); huntIds.push(draftPreview.view.hunt.id);
  assert.equal((await listHunts()).some(item => item.id === draftPreview.view.hunt.id), false);
  await assert.rejects(simulatePreview(first.view.teamId, randomUUID(), 'success'), status(403));
  await publishHunt({ ...edited, settings: { ...edited.settings, startsAt: new Date(Date.now()+3600000).toISOString() } }, { expectedVersion: 2 });
  await joinTeam({ huntId: hunt.id, teamName: 'Pinned team', playerName: 'Alice', pin: '123456', mode: 'join' });
  await assert.rejects(join(hunt.id), status(409));
});

test('PostgreSQL: help replies, live fallback, score controls and lifecycle retain receipts', { skip: !enabled }, async () => {
  const hunt = definition(); await publishHunt(hunt);
  const team = await join(hunt.id); const teamId = team.view.teamId;
  const help = { requestId: randomUUID(), kind: 'camera', message: 'The marker is missing', checkpointId: 'start', nodeId: 'scan' };
  const first = await submitHelp(teamId, help);
  assert.equal((await submitHelp(teamId, help)).id, first.id);
  await assert.rejects(submitHelp(teamId, { ...help, message: 'Changed' }), status(409));
  await resolveHelp(first.id, 'A replacement route is now available.');
  await sendAnnouncement(hunt.id, 'Water station is open.');
  const messages = await teamMessages(teamId);
  assert.equal(messages.help[0].response, 'A replacement route is now available.');
  assert.equal(messages.messages[0].message, 'Water station is open.');
  await assert.rejects(command(teamId, { type: 'use_fallback', checkpointId: 'start', nodeId: 'scan' }));
  await control(teamId, { type: 'enable_fallback', checkpointId: 'start', nodeId: 'scan', enabled: true });
  assert.equal((await teamView(teamId)).node?.fallback?.enabled, true);
  await command(teamId, { type: 'use_fallback', checkpointId: 'start', nodeId: 'scan' });
  assert.equal((await teamView(teamId)).node?.id, 'code');
  await command(teamId, { type: 'verify', checkpointId: 'start', nodeId: 'code', value: 'RECOVER' });
  const requestId = randomUUID();
  const correction = { type: 'adjust_score', amount: 5, expectedRevision: (await teamView(teamId)).revision, reason: 'Compensating for damaged marker' };
  await applyTeamCommand(teamId, requestId, correction, 'control');
  await setHuntStatus(hunt.id, 'paused');
  assert.equal((await applyTeamCommand(teamId, requestId, correction, 'control')).view.score, 25);
  await assert.rejects(applyTeamCommand(teamId, randomUUID(), correction, 'control'));
  await assert.rejects(join(hunt.id), status(409));
  await setHuntStatus(hunt.id, 'ended');
  await setHuntStatus(hunt.id, 'archived');
  assert.equal((await listHunts()).some(item => item.id === hunt.id), false);
  const state = (await getTeamRecord(teamId)).state;
  assert.equal(state.ledger.reduce((sum, entry) => sum + entry.amount, 0), state.score);
  assert.equal(state.ledger.filter(entry => entry.kind === 'organizer_adjustment').length, 1);
  await assert.rejects(deleteHunt(hunt.id, 'wrong'), status(400));
  await deleteHunt(hunt.id, hunt.id);
  await assert.rejects(teamView(teamId), status(404));
});

test('PostgreSQL: puzzle revision conflicts, durable hint puzzles, safe public data and rankings', { skip: !enabled }, async () => {
  const hunt = definition({ leaderboard: 'finish', ranking: 'points_time' });
  hunt.checkpoints[0].flow = { startNodeId: 'puzzle', nodes: [
    { id: 'puzzle', type: 'puzzle', prompt: 'Choose the direction', puzzle: { type: 'multiple_choice', prompt: 'Which way?', options: [{ id: 'a', label: 'Left' }, { id: 'b', label: 'Right' }], correctOptionId: 'b' }, next: 'finish' },
    { id: 'finish', type: 'complete' },
  ] };
  hunt.checkpoints[0].hints[0].content = { type: 'puzzle', puzzle: { type: 'text', prompt: 'Unlock this clue', answers: ['secret-key'] }, reveal: { type: 'text', text: 'Turn right' } };
  await publishHunt(hunt); const team = await join(hunt.id); const teamId = team.view.teamId;
  assert.equal((await leaderboard(teamId)).visible, false);
  const serialized = JSON.stringify(await teamView(teamId));
  assert.equal(serialized.includes('correctOptionId'), false);
  assert.equal(serialized.includes('secret-key'), false);
  await command(teamId, { type: 'use_hint', checkpointId: 'start', hintId: 'third' });
  await command(teamId, { type: 'submit_hint_puzzle', checkpointId: 'start', hintId: 'third', expectedRevision: 0, value: { value: 'secret-key' } });
  const hint = (await teamView(teamId)).hints[0].content;
  assert.equal(hint?.type === 'puzzle' && hint.reveal?.type === 'text' && hint.reveal.text, 'Turn right');
  const save = { type: 'save_puzzle', checkpointId: 'start', nodeId: 'puzzle', expectedRevision: 0, value: { optionId: 'a' } };
  const races = await Promise.allSettled([command(teamId, save), command(teamId, save)]);
  assert.equal(races.filter(item => item.status === 'fulfilled').length, 1);
  const view = await teamView(teamId);
  assert.equal(view.node?.type === 'puzzle' && view.node.progress.revision, 1);
  const id = randomUUID(); const correct = { ...save, type: 'submit_puzzle', expectedRevision: 1, value: { optionId: 'b' } };
  await applyTeamCommand(teamId, id, correct);
  await applyTeamCommand(teamId, id, correct);
  assert.equal((await teamView(teamId)).score, 14);
  assert.equal((await leaderboard(teamId)).visible, true);
  assert.equal((await eventAnalytics(hunt.id)).completed, 1);
  await control(teamId, { type: 'move_checkpoint', checkpointId: 'start' });
  assert.equal((await leaderboard(teamId)).visible, false);
  assert.equal((await eventAnalytics(hunt.id)).completed, 0);
});

test('PostgreSQL: private media, compressed photos, stale review replay and retention', { skip: !enabled }, async () => {
  const bytes = await sharp({ create: { width: 2200, height: 1800, channels: 3, background: '#417877' } }).png().toBuffer();
  const file = () => new File([new Uint8Array(bytes)], 'landmark.png', { type: 'image/png' });
  const source = await uploadAsset(randomUUID(), file()); assets.push(source.id);
  const background = await uploadAsset(randomUUID(), file()); assets.push(background.id);
  const puzzle = await makeJigsaw(source.id, 2, 2);
  assert.equal(puzzle.type, 'jigsaw');
  if (puzzle.type === 'jigsaw') assets.push(...puzzle.pieces.map(piece => piece.id));
  const hunt = definition({ photoRetention: 'after_verification' });
  hunt.theme = { backgroundUrl: background.url };
  hunt.checkpoints[0].flow = { startNodeId: 'photo', nodes: [
    { id: 'photo', type: 'verify_image', prompt: 'Photograph the landmark', referenceImages: [source.url], next: 'again' },
    { id: 'again', type: 'verify_image', prompt: 'Photograph the detail', referenceImages: [source.url], next: 'finish' },
    { id: 'finish', type: 'complete' },
  ] };
  hunt.checkpoints[0].hints[0].content = { type: 'image', url: source.url, alt: 'Reference' };
  await publishHunt(hunt); const team = await join(hunt.id); const another = await join(hunt.id);
  assert.equal(JSON.stringify(team.view).includes(source.url), false);
  const updated = structuredClone(hunt);
  delete updated.theme;
  updated.checkpoints[0].flow.nodes.forEach(node => { if (node.type === 'verify_image') node.referenceImages = []; });
  await publishHunt(updated, { expectedVersion: 1 });
  await assert.rejects(deleteAsset(source.id), status(409));
  await assert.rejects(deleteAsset(background.id), status(409));
  const request = (token: string) => new NextRequest('http://localhost/api/v2/media', { headers: { cookie: `${TEAM_COOKIE}=${token}` } });
  const maliciousName = await join(hunt.id, source.url);
  assert.equal((await readMedia(request(team.token), background.id)).media.id, background.id, 'a pinned team retains its published background');
  await assert.rejects(readMedia(request(maliciousName.token), background.id), status(403));
  await assert.rejects(readMedia(request(''), background.id), status(403));
  await assert.rejects(readMedia(request(maliciousName.token), source.id), status(403));
  await assert.rejects(readMedia(request(team.token), source.id), status(403));
  await command(team.view.teamId, { type: 'use_hint', checkpointId: 'start', hintId: 'third' });
  const image = await readMedia(request(team.token), source.id);
  assert.equal((await sharp(image.bytes).metadata()).width, 1600);
  const upload = { id: randomUUID(), checkpointId: 'start', nodeId: 'photo', file: file() };
  const photo = await uploadPhoto(team.view.teamId, upload);
  assert.equal((await uploadPhoto(team.view.teamId, upload)).id, photo.id);
  await assert.rejects(readMedia(request(another.token), photo.id), status(403));
  await assert.rejects(command(another.view.teamId, { type: 'submit_photo', checkpointId: 'start', nodeId: 'photo', mediaId: photo.id }), status(400));
  await command(team.view.teamId, { type: 'submit_photo', checkpointId: 'start', nodeId: 'photo', mediaId: photo.id });
  const review = (await organizerSnapshot()).photos.find(item => item.id === photo.id);
  assert.deepEqual(review?.referenceImages, [source.url], 'organizer sees the private references pinned to this team, not the new version');
  const receipt = randomUUID(); const approval = { type: 'approve_action', checkpointId: 'start', nodeId: 'photo', expectedRevision: (await teamView(team.view.teamId)).revision, reason: 'Landmark confirmed' };
  await applyTeamCommand(team.view.teamId, receipt, approval, 'control');
  await assert.rejects(readMedia(request(team.token), photo.id), status(404));
  const next = await uploadPhoto(team.view.teamId, { ...upload, id: randomUUID(), nodeId: 'again' });
  await command(team.view.teamId, { type: 'submit_photo', checkpointId: 'start', nodeId: 'again', mediaId: next.id });
  await applyTeamCommand(team.view.teamId, receipt, approval, 'control');
  assert.equal((await readMedia(request(team.token), next.id)).media.id, next.id);
  assert.equal((await organizerSnapshot()).photos.some(item => item.id === next.id), true);
  await control(team.view.teamId, { type: 'reject_photo', checkpointId: 'start', nodeId: 'again' });
  await cleanupMedia();
  await assert.rejects(readMedia(request(team.token), next.id), status(404));
});

test('PostgreSQL: after-event photo retention follows pinned schedule and unused asset deletion is safe', { skip: !enabled }, async () => {
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#edcc71' } }).png().toBuffer();
  const file = () => new File([new Uint8Array(bytes)], 'small.png', { type: 'image/png' });
  const asset = await uploadAsset(randomUUID(), file()); assets.push(asset.id);
  await deleteAsset(asset.id); await deleteAsset(asset.id);
  const missing = definition(); missing.theme = { coverUrl: asset.url };
  await assert.rejects(publishHunt(missing), status(400));
  await assert.rejects(saveDraft(missing,null), status(400));
  const hunt = definition({ photoRetention: 'after_event', endsAt: new Date(Date.now()+3600000).toISOString() });
  hunt.checkpoints[0].flow = { startNodeId:'photo',nodes:[{ id:'photo',type:'verify_image',prompt:'Take a photo',referenceImages:[],next:'done' },{id:'done',type:'complete'}] };
  await publishHunt(hunt); const team = await join(hunt.id);
  const photo = await uploadPhoto(team.view.teamId,{id:randomUUID(),checkpointId:'start',nodeId:'photo',file:file()});
  const request = new NextRequest('http://localhost/api/v2/media',{headers:{cookie:`${TEAM_COOKIE}=${team.token}`}});
  await publishHunt({...hunt,settings:{...hunt.settings,endsAt:new Date(Date.now()-1000).toISOString()}},{expectedVersion:1});
  await cleanupMedia();
  assert.equal((await readMedia(request,photo.id)).media.id,photo.id);
  await setHuntStatus(hunt.id,'ended');
  await assert.rejects(readMedia(request,photo.id),status(404), 'event expiry is enforced even while the cleanup worker is sleeping');
  await cleanupMedia();
  await assert.rejects(readMedia(request,photo.id),status(404));
});

test('PostgreSQL: schedule and registration gates do not block preview', { skip: !enabled }, async () => {
  const hunt = definition({ startsAt: new Date(Date.now() + 3600000).toISOString() });
  await publishHunt(hunt);
  await assert.rejects(join(hunt.id), status(409));
  const preview = await startPreview({ huntId: hunt.id });
  assert.equal((await simulatePreview(preview.view.teamId, randomUUID(), 'success')).view.status, 'completed');
  const closed = definition({ registrationOpen: false }); await publishHunt(closed);
  await assert.rejects(join(closed.id), status(409));
});
