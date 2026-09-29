import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, executeCommand, executeControl, getPlayerView, validateHunt } from '../lib/engine';
import { EngineError, type HuntDefinition, type GameState } from '../lib/engine/types';
import { assertStartWindow, elapsedMilliseconds, pauseSession, playability, resumeSession, timerRemaining } from '../lib/engine/session';
import { assignRoutes } from '../lib/server/routes';
import { validateRosterNames, parseCommand } from '../lib/engine/validation';
import { resultsCsv } from '../lib/engine/reporting';
import { newHuntSettings } from '../lib/engine/authoring';

test('new authoring defaults to two members without changing legacy definitions or explicit solo settings', () => {
  assert.deepEqual(newHuntSettings, { minTeamSize: 2, maxTeamSize: 4, sessionDurationSeconds: 7200, assignmentVersion: 2 });
  assert.equal(hunt(false).settings?.minTeamSize, undefined);
  assert.deepEqual(validateHunt(hunt()), [], 'explicit solo configuration remains supported');
});

const at = (seconds = 0) => new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();
const error = (code: string) => (e: unknown) => e instanceof EngineError && e.code === code;
function hunt(timed = true): HuntDefinition {
  return { schemaVersion: 1, id: 'timed-tests', version: 1, title: 'Clock tests', settings: timed ? { sessionDurationSeconds: 120, minTeamSize: 1, maxTeamSize: 4 } : {}, checkpoints: [{ id: 'one', title: 'First', basePoints: 10, hints: [], flow: { startNodeId: 'answer', nodes: [
    { id: 'answer', type: 'verify_answer', prompt: 'Question', answers: ['yes'], next: 'next' },
    { id: 'next', type: 'verify_answer', prompt: 'Next question', answers: ['next'], next: 'done' }, { id: 'done', type: 'complete' },
  ] } }] };
}
const answer = (state: GameState, h: HuntDefinition, seconds = 10) => executeCommand(h, state, { type: 'verify', checkpointId: 'one', nodeId: 'answer', value: 'yes' }, at(seconds)).state;

test('new weighted route distribution is independent across differently named routers; legacy routing is unchanged', () => {
  for (const weights of [[1, 1, 1], [1, 3, 6]]) {
    const h = hunt(false); h.settings!.assignmentVersion = 2;
    h.checkpoints = ['alpha', 'zebra'].map((id, index) => ({ id, title: id, hints: [], basePoints: 10, flow: { startNodeId: `router-${index}`, nodes: [
      { id: `router-${index}`, type: 'random_branch' as const, choices: weights.map((weight, i) => ({ weight, next: `task-${i}` })) },
      ...weights.map((_, i) => ({ id: `task-${i}`, type: 'verify_answer' as const, prompt: 'Question', answers: ['yes'], next: 'done' })), { id: 'done', type: 'complete' as const },
    ] } }));
    assert.deepEqual(validateHunt(h), []);
    const counts = [[0, 0, 0], [0, 0, 0]], cross = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let team = 0; team < 10000; team++) {
      const routes = assignRoutes(h, `fixed-team-${team}`, at());
      for (const [i, route] of routes.entries()) counts[i][route.choiceIndex]++;
      cross[routes[0].choiceIndex][routes[1].choiceIndex]++;
    }
    const total = weights.reduce((a, b) => a + b);
    for (let i = 0; i < 3; i++) {
      for (const count of counts) assert.ok(Math.abs(count[i] / 10000 - weights[i] / total) < 0.02);
      for (let j = 0; j < 3; j++) assert.ok(Math.abs(cross[i][j] / 10000 - weights[i] * weights[j] / total ** 2) < 0.015);
    }
    const assignments = assignRoutes(h, 'stable', at());
    assert.deepEqual(assignments, assignRoutes(h, 'stable', at()));
    let state = createInitialState(h, 'stable', at(), { routeAssignments: assignments });
    state = executeControl(h, state, { type: 'move_checkpoint', checkpointId: 'alpha', expectedRevision: state.revision, reason: 'Restart the route' }, at(1)).state;
    assert.deepEqual(state.routeAssignments, assignments);
    assert.equal(state.checkpoints.alpha.activeNodeId, assignments[0].nextNodeId);
    assert.equal(JSON.stringify(getPlayerView(h, state, at())).includes('routeAssignments'), false);
    delete h.settings!.assignmentVersion;
    for (let team = 0; team < 100; team++) {
      const id = `legacy-${team}`, legacy = createInitialState(h, id, at());
      const saved = createInitialState(h, id, at(), { routeAssignments: assignRoutes(h, id, at()) });
      assert.deepEqual(saved.checkpoints, legacy.checkpoints);
    }
    assert.equal(assignRoutes(h, 'preview', at(), { 'alpha:router-0': 2 })[0].nextNodeId, 'task-2');
    assert.throws(() => assignRoutes(h, 'preview', at(), { 'unknown:router': 0 }), error('invalid_preview'));
    assert.throws(() => parseCommand({ type: 'verify', checkpointId: 'alpha', nodeId: 'task-1', value: 'yes', routeChoices: { 'alpha:router-0': 2 } }), error('invalid_command'));
  }
});

test('lobby redacts first task, rejects gameplay, and start cannot restart the timer', () => {
  const h = hunt(), waiting = createInitialState(h, 'team', at(), { waiting: true });
  const view = getPlayerView(h, waiting, at());
  assert.equal(view.status, 'waiting'); assert.equal(view.node, null); assert.equal(view.checkpoint, null);
  assert.deepEqual(view.checkpoints, []); assert.deepEqual(view.stages, []); assert.equal(view.timer, undefined);
  assert.throws(() => answer(waiting, h), error('session_waiting'));
  assert.throws(() => executeCommand(h, waiting, { type: 'start_session', expectedRevision: 4 }, at()), error('stale_roster'));
  const started = executeCommand(h, waiting, { type: 'start_session', expectedRevision: 0 }, at(30)).state;
  assert.equal(started.startedAt, at(30)); assert.equal(started.timer?.deadlineAt, at(150));
  assert.deepEqual(executeCommand(h, started, { type: 'start_session', expectedRevision: 0 }, at(500)).state, started);
});

test('personal deadline is exclusive, independent of latest-start cutoff and required completion', () => {
  const h = hunt(); h.settings!.endsAt = at(60);
  assert.doesNotThrow(() => assertStartWindow(h, 'live', at(59.999)));
  assert.throws(() => assertStartWindow(h, 'live', at(60)), error('session_ended'));
  let state = createInitialState(h, 'late-team', at(50));
  assert.equal(state.timer?.deadlineAt, at(170));
  assert.equal(playability(h, state, 'live', at(100)).allowed, true);
  state = answer(state, h, 169.999);
  assert.throws(() => executeCommand(h, state, { type: 'verify', checkpointId: 'one', nodeId: 'next', value: 'next' }, at(170)), error('session_expired'));
  state.status = 'completed'; state.completedAt = at(169.999);
  assert.equal(playability(h, state, 'live', at(170)).code, 'expired');
  assert.equal(playability(h, state, 'ended', at(100)).code, 'ended');
  const legacy = hunt(false); legacy.settings!.endsAt = at(60);
  assert.equal(playability(legacy, createInitialState(legacy, 'old-team', at()), 'live', at(60)).code, 'ended');
});

test('pause clips all elapsed intervals and does not revive already expired timers', () => {
  const h = hunt(); let state = createInitialState(h, 'team', at());
  state = pauseSession(state, at(30));
  assert.equal(timerRemaining(state, at(999)), 90);
  assert.throws(() => answer(state, h, 40), error('session_paused'));
  assert.deepEqual(pauseSession(state, at(50)), state);
  state = resumeSession(state, at(80));
  assert.equal(state.timer?.deadlineAt, at(170)); assert.deepEqual(resumeSession(state, at(90)), state);
  assert.equal(elapsedMilliseconds(state, at(), at(100)), 50000);
  assert.equal(elapsedMilliseconds(state, at(40), at(70)), 0);
  assert.equal(elapsedMilliseconds(state, at(40), at(90)), 10000);
  assert.equal(elapsedMilliseconds(state, at(10), at(40)), 20000);
  assert.deepEqual(pauseSession(state, at(170)), state);
});

test('extension adds allowance, reopen starts from now, neither deducts elapsed time or waiting', () => {
  const h = hunt(); let state = createInitialState(h, 'team', at());
  const extend = (seconds: number, now: number) => { state = executeControl(h, state, { type: 'extend_session', expectedRevision: state.revision, reason: 'Photo queue delay', seconds }, at(now)).state; };
  extend(30, 100); assert.equal(state.timer?.deadlineAt, at(150));
  extend(60, 200); assert.equal(state.timer?.deadlineAt, at(260));
  assert.equal(elapsedMilliseconds(state, at(), at(220)), 220000);
  state = pauseSession(state, at(220)); extend(60, 250);
  assert.equal(timerRemaining(state, at(500)), 100);
  state = resumeSession(state, at(300));
  assert.equal(state.timer?.deadlineAt, at(400));
  assert.equal(elapsedMilliseconds(state, at(), at(350)), 270000);
  assert.equal(state.timer?.extensions.length, 3);
});

test('hint redaction, sticky first solves, dependencies, disabled hints, and pause-adjusted delays', () => {
  const h = hunt(); h.checkpoints[0].hints = [
    { id: 'first', title: 'First secret title', cost: 2, content: { type: 'text', text: 'Answer secret' }, relevance: { nodeId: 'answer', unlockAfterSeconds: 10 }, showWhenLocked: false },
    { id: 'later', title: 'Future secret title', cost: 2, content: { type: 'text', text: 'Later secret' }, relevance: { nodeId: 'next' }, availability: { afterHintIds: ['first'] } },
    { id: 'off', title: 'Disabled title', cost: 2, content: { type: 'text', text: 'Disabled content' }, enabled: false },
  ];
  let state = createInitialState(h, 'team', at());
  assert.deepEqual(getPlayerView(h, state, at()).hints, []);
  state = pauseSession(state, at(5)); state = resumeSession(state, at(25));
  assert.deepEqual(getPlayerView(h, state, at(29)).hints, []);
  assert.deepEqual(getPlayerView(h, state, at(30)).hints.map(h => h.id), ['first']);
  state = answer(state, h, 31);
  assert.equal(state.checkpoints.one.nodes.answer.firstSolvedAt, at(31));
  assert.equal(getPlayerView(h, state, at(31)).hints[0].status, 'available', 'solved prerequisite need not be purchased');
  state = executeControl(h, state, { type: 'move_checkpoint', checkpointId: 'one', expectedRevision: state.revision, reason: 'Organizer replay' }, at(32)).state;
  assert.equal(state.checkpoints.one.nodes.answer.firstSolvedAt, at(31));
  assert.equal(getPlayerView(h, state, at(45)).hints.some(h => h.id === 'first'), false);
  assert.throws(() => executeCommand(h, state, { type: 'use_hint', checkpointId: 'one', hintId: 'first' }, at(45)), error('hint_locked'));
});

test('roster normalization blocks Unicode/case duplicates and forged client timer fields', () => {
  assert.deepEqual(validateRosterNames(['  Alice  ', 'Ｂob']), ['Alice', 'Bob']);
  assert.throws(() => validateRosterNames(['Alice', 'ＡLICE']));
  assert.throws(() => parseCommand({ type: 'start_session', expectedRevision: 0, deadlineAt: at(99999) }), error('invalid_command'));
  assert.throws(() => validateRosterNames(['']));
});

test('CSV protects spreadsheet formulas, quotes, newlines and tabs', () => {
  const csv = resultsCsv([{ name: '=IMPORTXML("secret")', score: 0 }, { name: '\t+cmd', score: -1 }, { name: 'Line\n"two"', score: 1 }] as Parameters<typeof resultsCsv>[0]);
  assert.ok(csv.includes("'=IMPORTXML")); assert.ok(csv.includes("'\t+cmd")); assert.ok(csv.includes('Line\n""two""'));
});

test('crossword discoveries remain sticky after erasure and reset, including undated legacy solves', () => {
  const h = hunt(); h.checkpoints[0].flow = { startNodeId: 'puzzle', nodes: [
    { id: 'puzzle', type: 'puzzle', prompt: 'Crossword', puzzle: { type: 'crossword', rows: 2, columns: 3, entries: [
      { id: 'cat', clue: 'A pet', answer: 'CAT', row: 0, column: 0, direction: 'across' },
      { id: 'dog', clue: 'Another pet', answer: 'DOG', row: 1, column: 0, direction: 'across' },
    ] }, next: 'done' }, { id: 'done', type: 'complete' },
  ] };
  h.checkpoints[0].hints = [{ id: 'cat-help', title: 'CAT help', cost: 2, content: { type: 'text', text: 'Hint' }, relevance: { nodeId: 'puzzle', puzzleItemId: 'cat' } }];
  const save = (state: GameState, grid: string[][]) => executeCommand(h, state, { type: 'save_puzzle', checkpointId: 'one', nodeId: 'puzzle', expectedRevision: state.checkpoints.one.nodes.puzzle.puzzle!.revision, value: { grid } }, at(10)).state;
  let state = save(createInitialState(h, 'team', at()), [['C', 'A', 'T'], ['', '', '']]);
  const legacy = structuredClone(state); delete legacy.checkpoints.one.nodes.puzzle.puzzleDiscoveries;
  state = save(state, [['', '', ''], ['', '', '']]);
  assert.deepEqual(state.checkpoints.one.nodes.puzzle.puzzleDiscoveries, [{ itemId: 'cat', solvedAt: at(10) }]);
  assert.deepEqual(getPlayerView(h, state, at(11)).hints, []);
  state = executeControl(h, state, { type: 'reset_action', checkpointId: 'one', nodeId: 'puzzle', expectedRevision: state.revision, reason: 'Restart' }, at(12)).state;
  assert.deepEqual(getPlayerView(h, state, at(13)).hints, []);
  const erasedLegacy = save(legacy, [['', '', ''], ['', '', '']]);
  assert.deepEqual(erasedLegacy.checkpoints.one.nodes.puzzle.puzzleDiscoveries, [{ itemId: 'cat' }], 'do not invent a historical solve timestamp');
  assert.deepEqual(getPlayerView(h, erasedLegacy, at(13)).hints, []);
  const resetLegacy = executeControl(h, legacy, { type: 'reset_action', checkpointId: 'one', nodeId: 'puzzle', expectedRevision: legacy.revision, reason: 'Restart older save' }, at(12)).state;
  assert.deepEqual(resetLegacy.checkpoints.one.nodes.puzzle.puzzleDiscoveries, [{ itemId: 'cat' }]);
});

test('required finish permits optional play only before the personal deadline', () => {
  const h = hunt(); h.settings!.mode = 'open'; const optional = structuredClone(h.checkpoints[0]); optional.id = 'optional'; optional.required = false; h.checkpoints.push(optional);
  let state = answer(createInitialState(h, 'team', at()), h);
  state = executeCommand(h, state, { type: 'verify', checkpointId: 'one', nodeId: 'next', value: 'next' }, at(15)).state;
  assert.equal(state.status, 'completed'); const completedAt = state.completedAt;
  state = executeCommand(h, state, { type: 'choose_checkpoint', checkpointId: 'optional' }, at(20)).state;
  assert.equal(state.activeCheckpointId, 'optional'); assert.equal(state.completedAt, completedAt);
  assert.throws(() => executeCommand(h, state, { type: 'verify', checkpointId: 'optional', nodeId: 'answer', value: 'yes' }, at(120)), error('session_expired'));
});

test('checkpoint time bonus excludes pauses but not extra allowance', () => {
  const h = hunt(); h.checkpoints[0].timeBonus = { withinSeconds: 20, points: 5 };
  let state = pauseSession(createInitialState(h, 'team', at()), at(5)); state = resumeSession(state, at(105));
  state = answer(state, h, 110);
  state = executeCommand(h, state, { type: 'verify', checkpointId: 'one', nodeId: 'next', value: 'next' }, at(115)).state;
  assert.equal(state.score, 15); assert.equal(getPlayerView(h, state, at(115)).summary?.elapsedSeconds, 15);
  state = createInitialState(h, 'slow-team', at()); state = executeControl(h, state, { type: 'extend_session', seconds: 120, expectedRevision: 0, reason: 'Assistance' }, at(100)).state;
  state = answer(state, h, 150); state = executeCommand(h, state, { type: 'verify', checkpointId: 'one', nodeId: 'next', value: 'next' }, at(151)).state;
  assert.equal(state.score, 10); assert.equal(getPlayerView(h, state, at(151)).summary?.elapsedSeconds, 151);
});
