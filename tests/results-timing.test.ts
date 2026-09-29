import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, executeCommand, executeControl } from '../lib/engine';
import type { HuntDefinition, GameState } from '../lib/engine/types';
import { checkpointTimings } from '../lib/server/results';
import { pauseSession, resumeSession } from '../lib/engine/session';

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();
const hunt: HuntDefinition = { schemaVersion: 1, id: 'visits', version: 1, title: 'Visits', settings: { mode: 'open', sessionDurationSeconds: 120 }, checkpoints: ['a', 'b'].map(id => ({ id, title: id, basePoints: 10, hints: [], flow: { startNodeId: 'answer', nodes: [{ id: 'answer', type: 'verify_answer', prompt: '?', answers: ['yes'], next: 'done' }, { id: 'done', type: 'complete' }] } })) };
const move = (state: GameState, id: string, seconds: number, definition = hunt) => executeControl(definition, state, { type: 'move_checkpoint', checkpointId: id, reason: 'Recovery', expectedRevision: state.revision }, at(seconds)).state;
const selected = (state: GameState, seconds: number) => checkpointTimings(state, at(seconds)).map(cp => [cp.id, cp.selectedSeconds, cp.visits]);

test('organizer return visits account for selected time, including older move-only histories', () => {
  let state = createInitialState(hunt, 'team', at(0));
  state = executeCommand(hunt, state, { type: 'choose_checkpoint', checkpointId: 'b' }, at(10)).state;
  state = move(state, 'a', 20);
  assert.deepEqual(selected(state, 30), [['a', 20, 2], ['b', 10, 1]]);
  const old = structuredClone(state); old.events = old.events.filter(e => e.type !== 'checkpoint_selected');
  assert.deepEqual(selected(old, 30), selected(state, 30));
  assert.deepEqual(selected(move(state, 'a', 25), 30), selected(state, 30), 'same selection does not create a visit');
  state = pauseSession(state, at(22)); state = resumeSession(state, at(27));
  assert.deepEqual(selected(state, 30), [['a', 15, 2], ['b', 10, 1]]);
});

test('organizer selection precedes automatic completion and records resumed unfinished work', () => {
  const automatic = structuredClone(hunt); automatic.checkpoints[1].flow = { startNodeId: 'done', nodes: [{ id: 'done', type: 'complete' }] };
  const state = move(createInitialState(automatic, 'team', at(0)), 'b', 10, automatic);
  assert.equal(state.activeCheckpointId, 'a');
  assert.deepEqual(selected(state, 30), [['a', 30, 2], ['b', 0, 1]]);
  const reopened = move(state, 'b', 35, automatic);
  assert.deepEqual(selected(reopened, 40), [['a', 40, 3], ['b', 0, 2]]);
  const player = executeCommand(automatic, createInitialState(automatic, 'team', at(0)), { type: 'choose_checkpoint', checkpointId: 'b' }, at(10)).state;
  assert.deepEqual(selected(player, 30), [['a', 30, 2], ['b', 0, 1]], 'no late selection event reopens the completed checkpoint');
});
