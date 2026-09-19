import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, executeCommand, getPlayerView, type GameCommand, type HuntDefinition } from '../lib/engine';
import { describeActionFeedback } from '../components/v2/player/feedbackModel';

const now = '2026-09-17T12:00:00.000Z';
const definition: HuntDefinition = {
  schemaVersion: 1, id: 'feedback-semantics', version: 1, title: 'Feedback semantics',
  checkpoints: [{ id: 'first', title: 'The puzzle', basePoints: 20, hints: [
    { id: 'puzzle-hint', title: 'A clue', cost: 2, content: { type: 'puzzle', puzzle: { type: 'text', prompt: 'What points north?', answers: ['compass'] }, reveal: { type: 'text', text: 'Try the gate.' } } },
  ], flow: { startNodeId: 'answer', nodes: [
    { id: 'answer', type: 'puzzle', prompt: 'Solve the riddle.', puzzle: { type: 'text', prompt: 'What points north?', answers: ['compass'] }, next: 'done' },
    { id: 'done', type: 'complete' },
  ] } }],
};

test('incorrect text submissions explain the error while preserving the saved puzzle state', () => {
  const initial = createInitialState(definition, 'team', now);
  const command: GameCommand = { type: 'submit_puzzle', checkpointId: 'first', nodeId: 'answer', expectedRevision: 0, value: { value: 'needle' } };
  const result = executeCommand(definition, initial, command, now);
  assert.equal(result.feedback.status, 'accepted', 'the engine correctly saves the attempted answer');
  const next = getPlayerView(definition, result.state, now);
  const presentation = describeActionFeedback('wrong-answer', command, getPlayerView(definition, initial, now), next, result.feedback);
  assert.equal(presentation.notice.kind, 'error');
  assert.match(presentation.notice.message, /Not quite/);
  assert.equal(presentation.cue?.kind, 'error');
  assert.equal(presentation.celebrate, false);
  assert.equal(next.node?.type === 'puzzle' && next.node.progress.revision, 1);
});

test('a solved checkpoint celebrates its real points once, never on an unchanged replay', () => {
  const initial = createInitialState(definition, 'team', now);
  const command: GameCommand = { type: 'submit_puzzle', checkpointId: 'first', nodeId: 'answer', expectedRevision: 0, value: { value: 'compass' } };
  const result = executeCommand(definition, initial, command, now);
  const next = getPlayerView(definition, result.state, now);
  const presentation = describeActionFeedback('correct-answer', command, getPlayerView(definition, initial, now), next, result.feedback);
  assert.equal(presentation.celebrate, true);
  assert.equal(presentation.cue?.points, 20);
  assert.match(presentation.cue?.title || '', /complete/i);
  assert.equal(presentation.cue?.message, 'Your team finished with 20 points.');
  const replay = describeActionFeedback('correct-answer', command, next, next, result.feedback);
  assert.equal(replay.celebrate, false);
  assert.equal(replay.cue, null);
});

test('partial puzzle saves stay quiet and purchased hint puzzles distinguish wrong answers from success', () => {
  let state = createInitialState(definition, 'team', now);
  state = executeCommand(definition, state, { type: 'use_hint', checkpointId: 'first', hintId: 'puzzle-hint' }, now).state;
  const wrong: GameCommand = { type: 'submit_hint_puzzle', checkpointId: 'first', hintId: 'puzzle-hint', expectedRevision: 0, value: { value: 'needle' } };
  let before = getPlayerView(definition, state, now);
  const failed = executeCommand(definition, state, wrong, now);
  assert.equal(describeActionFeedback('hint-wrong', wrong, before, getPlayerView(definition, failed.state, now), failed.feedback).notice.kind, 'error');
  const right: GameCommand = { ...wrong, expectedRevision: 1, value: { value: 'compass' } };
  const solved = executeCommand(definition, failed.state, right, now);
  const success = describeActionFeedback('hint-right', right, getPlayerView(definition, failed.state, now), getPlayerView(definition, solved.state, now), solved.feedback);
  assert.equal(success.celebrate, true);
  assert.equal(success.cue?.points, undefined, 'revealing a hint reward does not invent points');

  const grid = structuredClone(definition);
  grid.checkpoints[0].flow.nodes[0] = { id: 'answer', type: 'puzzle', prompt: 'Fill the squares.', puzzle: { type: 'sudoku', size: 4, givens: [[1, 0, 0, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]] }, next: 'done' };
  state = createInitialState(grid, 'grid-team', now);
  before = getPlayerView(grid, state, now);
  const move: GameCommand = { type: 'submit_puzzle', checkpointId: 'first', nodeId: 'answer', expectedRevision: 0, value: { grid: [[1, 2, 0, 4], [3, 4, 1, 2], [2, 1, 4, 3], [4, 3, 2, 1]] } };
  const saved = executeCommand(grid, state, move, now);
  const quiet = describeActionFeedback('grid-move', move, before, getPlayerView(grid, saved.state, now), saved.feedback);
  assert.equal(quiet.notice.kind, 'info');
  assert.equal(quiet.cue, null);
  assert.equal(quiet.celebrate, false);
});
