import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createInitialState, executeCommand, getPlayerView, type HuntDefinition, type PlayerView } from '../lib/engine';
import { visibleMediaUrls } from '../lib/server/media-references';
import { jsonBody, readBody } from '../lib/server/http';
import { HttpError } from '../lib/server/security';

const now = '2026-09-17T10:00:00.000Z';
const media = (suffix: string) => `/api/v2/media/00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
const hunt = (): HuntDefinition => ({
  schemaVersion: 1, id: 'media-boundary', version: 1, title: 'Media boundaries',
  checkpoints: [{ id: 'first', title: 'First', basePoints: 10, hints: [], flow: { startNodeId: 'answer', nodes: [
    { id: 'answer', type: 'verify_answer', prompt: 'Where?', answers: ['gate'], next: 'done' },
    { id: 'done', type: 'complete' },
  ] } }],
});

test('media authorization ignores URLs injected into team names, prose, puzzle input, or labels', () => {
  const forbidden = media('1'), allowed = media('2');
  const definition = hunt();
  definition.title = forbidden;
  definition.description = forbidden;
  definition.settings = { rules: forbidden, completionMessage: forbidden };
  definition.checkpoints[0].title = forbidden;
  const publicView = getPlayerView(definition, createInitialState(definition, 'team', now), now);
  const view: PlayerView & { teamName: string; members: string[] } = { ...publicView, teamName: forbidden, members: [forbidden] };
  view.node = { id: 'media', type: 'show_media', content: { type: 'video', url: allowed, title: forbidden, transcript: forbidden } };
  assert.deepEqual([...visibleMediaUrls(view)], [allowed]);
  view.node = { id: 'puzzle', type: 'puzzle', prompt: forbidden, puzzle: { type: 'text', prompt: forbidden }, progress: { revision: 1, completed: false, state: { type: 'text', value: forbidden } } };
  assert.equal(visibleMediaUrls(view).size, 0);
  view.node = { id: 'choice', type: 'choose_path', prompt: forbidden, choices: [{ id: 'north', label: forbidden }] };
  assert.equal(visibleMediaUrls(view).size, 0);
});

test('media access follows purchased hint and solved reward visibility, excluding future tasks and photo references', () => {
  const definition = hunt(), direct = media('3'), reward = media('4'), future = media('5'), reference = media('6');
  definition.checkpoints[0].hints = [
    { id: 'direct', title: 'Picture', cost: 2, content: { type: 'image', url: direct, alt: 'A clue' } },
    { id: 'riddle', title: 'Solve for a picture', cost: 4, content: { type: 'puzzle', puzzle: { type: 'text', prompt: 'Say north', answers: ['north'] }, reveal: { type: 'image', url: reward, alt: 'Reward clue' } } },
  ];
  definition.checkpoints[0].flow.nodes = [
    { id: 'answer', type: 'verify_answer', prompt: 'Where?', answers: ['gate'], next: 'picture' },
    { id: 'picture', type: 'show_media', content: { type: 'image', url: future, alt: 'Next clue' }, next: 'photo' },
    { id: 'photo', type: 'verify_image', prompt: 'Take a photo', referenceImages: [reference], next: 'done' },
    { id: 'done', type: 'complete' },
  ];
  let state = createInitialState(definition, 'team', now);
  const allowed = () => visibleMediaUrls(getPlayerView(definition, state, now));
  assert.equal(allowed().size, 0);
  state = executeCommand(definition, state, { type: 'use_hint', checkpointId: 'first', hintId: 'riddle' }, now).state;
  assert.equal(allowed().size, 0, 'purchase alone must not unlock a puzzle reward');
  state = executeCommand(definition, state, { type: 'save_hint_puzzle', checkpointId: 'first', hintId: 'riddle', expectedRevision: 0, value: { value: 'north' } }, now).state;
  assert.equal(allowed().size, 0, 'saving a correct answer must not unlock its reward');
  state = executeCommand(definition, state, { type: 'submit_hint_puzzle', checkpointId: 'first', hintId: 'riddle', expectedRevision: 1, value: { value: 'north' } }, now).state;
  assert.deepEqual([...allowed()], [reward]);
  state = executeCommand(definition, state, { type: 'use_hint', checkpointId: 'first', hintId: 'direct' }, now).state;
  assert.deepEqual(allowed(), new Set([direct, reward]));
  state = executeCommand(definition, state, { type: 'verify', checkpointId: 'first', nodeId: 'answer', value: 'gate' }, now).state;
  assert.deepEqual(allowed(), new Set([future, direct, reward]));
  state = executeCommand(definition, state, { type: 'continue', checkpointId: 'first', nodeId: 'picture' }, now).state;
  assert.equal(allowed().has(reference), false, 'human photo comparison references remain organizer-only');
  assert.equal(allowed().has(future), false, 'a previous action must not authorize unrelated later requests');
});

test('theme assets authorize only the current hunt logo, cover and background', () => {
  const definition = hunt();
  const logo = media('12'), cover = media('13'), background = media('14');
  definition.theme = { logoUrl: logo, coverUrl: cover, backgroundUrl: background };
  definition.description = media('99');
  const view = getPlayerView(definition, createInitialState(definition, 'team', now), now);
  assert.deepEqual(visibleMediaUrls(view), new Set([logo, cover, background]));
  delete view.hunt.theme?.backgroundUrl;
  assert.equal(visibleMediaUrls(view).has(background), false, 'a removed decorative asset must not remain authorized');
});

test('public puzzle tile media and camera guidance stay usable without authorizing descriptive text', () => {
  const definition = hunt();
  const view = getPlayerView(definition, createInitialState(definition, 'team', now), now);
  const tiles = ['7', '8', '9', '10'].map((id, index) => ({ id: `tile${index}`, imageUrl: media(id), alt: media('99') }));
  view.node = { id: 'jigsaw', type: 'puzzle', prompt: 'Arrange tiles', puzzle: { type: 'jigsaw', rows: 2, columns: 2, pieces: tiles }, progress: { revision: 0, completed: false, state: { type: 'jigsaw', order: tiles.map(tile => tile.id) } } };
  assert.deepEqual(visibleMediaUrls(view), new Set(tiles.map(tile => tile.imageUrl)));
  view.node = { id: 'rotation', type: 'puzzle', prompt: 'Turn tiles', puzzle: { type: 'rotation', columns: 2, tiles }, progress: { revision: 0, completed: false, state: { type: 'rotation', rotations: Object.fromEntries(tiles.map(tile => [tile.id, 0 as const])) } } };
  assert.deepEqual(visibleMediaUrls(view), new Set(tiles.map(tile => tile.imageUrl)));
  view.node = { id: 'guide', type: 'camera_guide', prompt: media('99'), referenceImageUrl: media('11') };
  assert.deepEqual(visibleMediaUrls(view), new Set([media('11')]));
});

test('HTTP JSON boundary rejects cross-origin writes, scalar payloads and oversized streams before work', async () => {
  const origin = process.env.APP_ORIGIN || 'https://hunt.example';
  const request = (body: string, requestOrigin = origin) => new NextRequest(`${origin}/api/v2/command`, { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' }, body });
  const status = (expected: number) => (error: unknown) => error instanceof HttpError && error.status === expected;
  await assert.rejects(() => jsonBody(request('{}', 'https://untrusted-origin.invalid')), status(403));
  await assert.rejects(() => jsonBody(request('[]')), status(400));
  await assert.rejects(() => jsonBody(request('null')), status(400));
  await assert.rejects(() => readBody(request('12345'), 4), status(413));
  assert.deepEqual(await jsonBody(request('{"requestId":"receipt"}')), { requestId: 'receipt' });
});
