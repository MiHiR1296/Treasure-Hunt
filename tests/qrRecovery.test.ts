import assert from 'node:assert/strict';
import test from 'node:test';
import { newRequestId, savedCommand, savedPlayerView, storeCommand, storePlayerView, type PendingCommand } from '../components/v2/sessionClient';
import type { PlayerView } from '../lib/engine/types';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test('a QR request survives refresh with the exact receipt and value for safe retry', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: new MemoryStorage() });
  try {
    const request: PendingCommand = { teamId: 'team-a', requestId: newRequestId(), command: { type: 'verify', checkpointId: 'checkpoint', nodeId: 'qr', value: 'scanned-token' } };
    assert.match(request.requestId, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    storeCommand('team-a', request);
    assert.deepEqual(savedCommand('team-a'), request);
    assert.equal(savedCommand('team-b'), null);
    storeCommand('team-a', null);
    assert.equal(savedCommand('team-a'), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

test('unavailable browser storage does not prevent scanning or in-memory retries', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('Storage disabled'); } });
  try {
    assert.equal(savedCommand('team'), null);
    assert.equal(savedPlayerView(), null);
    assert.doesNotThrow(() => storeCommand('team', { teamId: 'team', requestId: 'receipt', command: { type: 'continue', checkpointId: 'checkpoint', nodeId: 'clue' } }));
  } finally {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});

test('offline refresh restores the last public task and logout clears the snapshot', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage });
  try {
    const view: PlayerView = {
      hunt: { id: 'hunt', title: 'The hunt' }, teamId: 'team', revision: 3, status: 'active', score: 12,
      progress: { completed: 1, total: 3 }, checkpoint: { id: 'second', title: 'The old tree', basePoints: 10, startedAt: '2026-09-17T00:00:00Z' },
      node: { id: 'qr', type: 'verify_qr', prompt: 'Find the code near the tree.', backupCodeEnabled: true }, hints: [],
    };
    storePlayerView(view);
    assert.deepEqual(savedPlayerView(), view);
    storePlayerView(null);
    assert.equal(savedPlayerView(), null);
    storage.setItem('hunt-v2-last-view', '{"teamId":"incomplete"}');
    assert.equal(savedPlayerView(), null);
    storage.setItem('hunt-v2-last-view', 'corrupt');
    assert.equal(savedPlayerView(), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});
