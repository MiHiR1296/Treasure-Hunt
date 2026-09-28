import assert from 'node:assert/strict';
import test from 'node:test';
import type { CheckpointDefinition, HuntDefinition } from '../lib/engine/types';
import { addQrFallback, canConnect, duplicateCheckpoint, insertNode, removeNode } from '../components/v2/builder/model';
import { createNode, nodeCatalog } from '../components/v2/builder/catalog';
import { canConnectPort, connectPort, disconnectPort, projectEdges, removeNodeAndDisconnect, removeNodeAndReconnect, setStartNode } from '../components/v2/builder/graph/mutations';
import { outputPortFromId, outputPortId, outputPortTarget, outputPorts } from '../components/v2/builder/graph/ports';

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

test('the builder catalogue has an explicit factory for every supported node type including Finish', () => {
  const types = Object.keys(nodeCatalog) as (keyof typeof nodeCatalog)[];
  assert.equal(types.length, 16);
  for (const type of types) assert.equal(createNode(type, `${type}-test`, 'finish').type, type);
  assert.deepEqual(createNode('complete', 'another-finish'), { id: 'another-finish', type: 'complete' });
});

test('semantic ports project every route independently even when destinations converge', () => {
  const checkpoint: CheckpointDefinition = { ...fixture().checkpoints[0], flow: { startNodeId: 'choice', nodes: [
    { id: 'choice', type: 'choose_path', prompt: 'Choose', choices: [{ id: 'qr', label: 'Scan', next: 'finish' }, { id: 'gps', label: 'Walk', next: 'finish' }] },
    { id: 'finish', type: 'complete' },
  ] } };
  const choice = checkpoint.flow.nodes[0];
  assert.equal(choice.type, 'choose_path');
  const ports = outputPorts(choice);
  assert.deepEqual(ports.map(outputPortId), ['choice:qr', 'choice:gps']);
  assert.deepEqual(ports.map(port => outputPortTarget(choice, port)), ['finish', 'finish']);
  assert.deepEqual(projectEdges(checkpoint).map(edge => edge.id), ['start', 'choice::choice:qr', 'choice::choice:gps']);
});

test('connecting one semantic port never changes sibling routes or fallback', () => {
  const checkpoint: CheckpointDefinition = { ...fixture().checkpoints[0], flow: { startNodeId: 'branch', nodes: [
    { id: 'branch', type: 'branch', condition: { type: 'variable', key: 'found', equals: true }, ifTrue: 'a', ifFalse: 'b' },
    { id: 'a', type: 'show_text', text: 'A', next: 'finish', fallback: { nodeId: 'b', label: 'Recover', enabled: true } },
    { id: 'b', type: 'show_text', text: 'B', next: 'finish' }, { id: 'finish', type: 'complete' },
  ] } };
  const branch = checkpoint.flow.nodes[0];
  assert.equal(branch.type, 'branch');
  const truePort = outputPortFromId(branch, 'branch:true');
  assert.ok(truePort);
  const changed = connectPort(checkpoint, branch.id, truePort, 'finish');
  const result = changed.flow.nodes[0];
  assert.equal(result.type, 'branch');
  assert.equal(result.ifTrue, 'finish');
  assert.equal(result.ifFalse, 'b');
  const fallback = changed.flow.nodes.find(node => node.id === 'a');
  assert.ok(fallback && 'fallback' in fallback && fallback.fallback);
  assert.equal(fallback.fallback.nodeId, 'b');
});

test('disconnecting a route creates a saveable invalid draft without disturbing other ports', () => {
  const checkpoint = fixture().checkpoints[0];
  const clue = checkpoint.flow.nodes[0];
  const nextPort = outputPortFromId(clue, 'next');
  assert.ok(nextPort);
  const changed = disconnectPort(checkpoint, clue.id, nextPort);
  const result = changed.flow.nodes[0];
  assert.ok('next' in result);
  assert.equal(result.next, '');
  assert.equal(changed.flow.nodes.length, checkpoint.flow.nodes.length);
  assert.equal(checkpoint.flow.nodes[0].type === 'show_text' && checkpoint.flow.nodes[0].next, 'qr');
});

test('cycle validation evaluates the selected port and accepts another destination', () => {
  const checkpoint = fixture().checkpoints[0];
  const qr = checkpoint.flow.nodes.find(node => node.id === 'qr')!;
  const nextPort = outputPortFromId(qr, 'next')!;
  assert.equal(canConnectPort(checkpoint, qr.id, nextPort, 'clue'), false);
  assert.equal(canConnectPort(checkpoint, qr.id, nextPort, 'finish'), true);
});

test('safe and advanced deletion both clean start and hint references deterministically', () => {
  const checkpoint = fixture().checkpoints[0];
  const reconnected = removeNodeAndReconnect(checkpoint, 'clue', 'qr');
  assert.equal(reconnected.flow.startNodeId, 'qr');
  assert.equal(reconnected.hints[1].availability?.afterNodeId, undefined);
  assert.equal(reconnected.flow.nodes.some(node => node.id === 'clue'), false);

  const disconnected = removeNodeAndDisconnect(checkpoint, 'clue');
  assert.equal(disconnected.flow.startNodeId, '');
  assert.equal(disconnected.hints[1].availability?.afterNodeId, undefined);
  assert.equal(disconnected.flow.nodes.some(node => node.id === 'clue'), false);
});

test('START changes only startNodeId and multiple Finish nodes remain independent', () => {
  const checkpoint = fixture().checkpoints[0];
  const withFinish = { ...checkpoint, flow: { ...checkpoint.flow, nodes: [...checkpoint.flow.nodes, createNode('complete', 'finish-b')] } };
  const beforeNodes = JSON.stringify(withFinish.flow.nodes);
  const changed = setStartNode(withFinish, 'qr');
  assert.equal(changed.flow.startNodeId, 'qr');
  assert.equal(JSON.stringify(changed.flow.nodes), beforeNodes);
  assert.equal(changed.flow.nodes.filter(node => node.type === 'complete').length, 2);
});
