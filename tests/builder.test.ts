import assert from 'node:assert/strict';
import test from 'node:test';
import type { CheckpointDefinition, HuntDefinition } from '../lib/engine/types';
import { addQrFallback, canConnect, duplicateCheckpoint, insertNode, removeNode } from '../components/v2/builder/model';

function fixture(): HuntDefinition {
  return { schemaVersion: 1, id: 'builder-test', version: 1, title: 'Builder test', checkpoints: [{
    id: 'checkpoint-1', title: 'Garden', basePoints: 20,
    flow: { startNodeId: 'clue', nodes: [{ id: 'clue', type: 'show_text', text: 'Find the gate', next: 'qr' }, { id: 'qr', type: 'verify_qr', prompt: 'Scan it', token: 'private-token', next: 'finish' }, { id: 'finish', type: 'complete' }] },
    hints: [{ id: 'hint-1', title: 'Look north', cost: 2, content: { type: 'text', text: 'North gate' } }, { id: 'hint-2', title: 'Closer', cost: 3, content: { type: 'text', text: 'By the tree' }, availability: { afterHintIds: ['hint-1'], afterNodeId: 'clue' } }],
  }] };
}

test('duplicating a checkpoint isolates hint IDs and remaps dependencies without mutating the original', () => {
  const hunt = fixture(); const before = JSON.stringify(hunt);
  const duplicate = duplicateCheckpoint(hunt, hunt.checkpoints[0]);
  assert.notEqual(duplicate.id, hunt.checkpoints[0].id);
  assert.equal(new Set([...hunt.checkpoints[0].hints, ...duplicate.hints].map(hint => hint.id)).size, 4);
  assert.deepEqual(duplicate.hints[1].availability?.afterHintIds, [duplicate.hints[0].id]);
  assert.equal(duplicate.hints[1].availability?.afterNodeId, 'clue');
  assert.equal(JSON.stringify(hunt), before);
});

test('inserting and removing a shared step preserves the converging routes', () => {
  const checkpoint: CheckpointDefinition = { ...fixture().checkpoints[0], flow: { startNodeId: 'branch', nodes: [
    { id: 'branch', type: 'choose_path', prompt: 'Choose', choices: [{ id: 'a', label: 'A', next: 'finish' }, { id: 'b', label: 'B', next: 'finish' }] }, { id: 'finish', type: 'complete' },
  ] } };
  const inserted = insertNode(checkpoint, { id: 'shared', type: 'show_text', text: 'Both routes pass here', next: 'finish' }, 'finish');
  const branch = inserted.flow.nodes[0];
  assert.equal(branch.type, 'choose_path');
  if (branch.type === 'choose_path') assert.deepEqual(branch.choices.map(choice => choice.next), ['shared', 'shared']);
  const removed = removeNode(inserted, 'shared', 'finish');
  assert.deepEqual(removed.flow, checkpoint.flow);
});

test('connection editor rejects cycles including a disabled recovery edge', () => {
  const checkpoint = fixture().checkpoints[0];
  assert.equal(canConnect(checkpoint, 'qr', 'finish'), true);
  assert.equal(canConnect(checkpoint, 'qr', 'clue'), false);
  assert.equal(canConnect(checkpoint, 'qr', 'qr'), false);
  const branch = { ...checkpoint, flow: { ...checkpoint.flow, nodes: checkpoint.flow.nodes.map(node => node.id === 'clue' ? { ...node, fallback: { nodeId: 'qr', label: 'Backup', enabled: false } } : node) } } as CheckpointDefinition;
  assert.equal(canConnect(branch, 'qr', 'clue'), false);
});

test('QR fallback creates two real verification paths that converge on the original continuation', () => {
  const checkpoint = fixture().checkpoints[0]; const before = JSON.stringify(checkpoint);
  const expanded = addQrFallback(checkpoint, 'qr');
  const clue = expanded.flow.nodes.find(node => node.id === 'clue');
  assert.ok(clue && 'next' in clue);
  const branch = expanded.flow.nodes.find(node => node.id === clue.next);
  assert.ok(branch?.type === 'choose_path');
  assert.equal(branch.choices[0].next, 'qr');
  const gps = expanded.flow.nodes.find(node => node.id === branch.choices[1].next);
  assert.ok(gps?.type === 'verify_gps');
  const code = expanded.flow.nodes.find(node => node.id === gps.next);
  assert.ok(code?.type === 'verify_code');
  assert.equal(code.next, 'finish');
  assert.equal(JSON.stringify(checkpoint), before);
});
