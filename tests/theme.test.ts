import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, getPlayerView, parseHuntDefinition, validateHunt, type HuntDefinition } from '../lib/engine';

const hunt = (): HuntDefinition => ({ schemaVersion: 1, id: 'theme-test', version: 1, title: 'Theme test', checkpoints: [{ id: 'start', title: 'Start', basePoints: 10, hints: [], flow: { startNodeId: 'clue', nodes: [{ id: 'clue', type: 'show_text', text: 'Follow the path.', next: 'done' }, { id: 'done', type: 'complete' }] } }] });
const at = '2026-09-17T10:00:00Z';

test('controlled theme options survive publication and public projection without mutating the published definition', () => {
  const definition = hunt();
  definition.theme = { backgroundUrl: '/api/v2/media/00000000-0000-4000-8000-000000000001', buttonShape: 'pill', checkpointIconStyle: 'symbols', successAnimation: 'celebrate' };
  const published = parseHuntDefinition(definition);
  const view = getPlayerView(published, createInitialState(published, 'team', at), at);
  assert.deepEqual(view.hunt.theme, definition.theme);
  view.hunt.theme!.buttonShape = 'square';
  assert.equal(published.theme!.buttonShape, 'pill');
  const plain = hunt();
  assert.deepEqual(validateHunt(plain), []);
  assert.equal(getPlayerView(plain, createInitialState(plain, 'team', at), at).hunt.theme, undefined, 'existing hunts do not acquire new visual defaults');
});

test('theme accepts only controlled presets and safe media URLs, never arbitrary styling or executable assets', () => {
  for (const theme of [
    { buttonShape: 'calc(100vw)' }, { checkpointIconStyle: '<script>' }, { successAnimation: 'spin 1s infinite' },
    { backgroundUrl: 'javascript:alert(1)' }, { backgroundUrl: 'data:image/svg+xml,<svg />' },
    { backgroundUrl: '//example.com/background.png' }, { backgroundUrl: 'https://user:secret@example.com/bg.png' },
    { css: 'body { display: none }' },
  ]) assert.ok(validateHunt({ ...hunt(), theme }).some(issue => issue.path.startsWith('hunt.theme')), JSON.stringify(theme));
  assert.deepEqual(validateHunt({ ...hunt(), theme: { buttonShape: 'square', checkpointIconStyle: 'numbers', successAnimation: 'pulse', backgroundUrl: 'https://example.com/background.png' } }), []);
  assert.deepEqual(validateHunt({ ...hunt(), theme: { buttonShape: 'rounded', checkpointIconStyle: 'none', successAnimation: 'none' } }), []);
});
