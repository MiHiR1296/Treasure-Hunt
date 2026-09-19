import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importLegacy } from '../lib/server/legacy-import';

test('legacy import preserves hint identity and private verification while refusing invented progress', () => {
  const source = { hunts: [{ id: 'old', name: 'Old quest' }], checkpoints: [{ id: 'first', hunt_id: 'old', title: 'Start', points: 20, unlock_method: 'qr_code', qr_code_value: 'private-marker', hint_1: 'First clue', hint_3: 'Last clue', hint_cost: 4 }], progress: [{ team_id: 'alice', checkpoint_id: 'first', hints_used: 1 }] };
  const result = importLegacy(source);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.definition.checkpoints[0].hints.map(hint => hint.id), ['first-hint-1','first-hint-3']);
  assert.equal(result.warnings.some(warning => warning.includes('No hint identities')), true);
  assert.equal(JSON.stringify(result.definition).includes('alice'), false);
  assert.equal(source.checkpoints[0].qr_code_value, 'private-marker');
});

test('legacy puzzle configs without server-verifiable structure cannot silently publish', () => {
  const result = importLegacy({ hunts: [{ id: 'old', name: 'Old quest' }], checkpoints: [{ id: 'one', hunt_id: 'old', title: 'Picture hunt', unlock_method: 'manual_code', manual_code: 'OK', use_puzzle_chain: true }], puzzle_steps: [{ id: 'image-only', checkpoint_id: 'one', puzzle_type: 'word_search', puzzle_config: { words: ['TREE'] }, puzzle_image_url: 'https://example.com/grid.png', answer_value: 'TREE', answer_type: 'text' }] });
  assert.ok(result.issues.length > 0);
  assert.ok(result.warnings.some(warning => warning.includes('structured data')));
  assert.throws(() => importLegacy({ hunts: [{ id: 'one' }, { id: 'two' }] }));
});
