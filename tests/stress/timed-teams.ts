import '../isolated-database';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { getPool } from '../../lib/server/db';
import { applyTeamCommand, getTeamRecord, joinTeam, organizerSnapshot, teamView } from '../../lib/server/store';
import { publishHunt } from '../../lib/server/hunts';
import { authenticate } from '../../lib/server/security';
import { listResults, resultActivity } from '../../lib/server/results';
import type { HuntDefinition } from '../../lib/engine/types';

if (!process.env.DATABASE_URL) throw new Error('A disposable test DATABASE_URL is required.');
const id = `stress-${randomUUID()}`, started = performance.now(), latency: number[] = [];
const rounds = Number(process.env.STRESS_ROUNDS ?? 8);
if (!Number.isInteger(rounds) || rounds < 8 || rounds > 1000) throw new Error('STRESS_ROUNDS must be 8–1000.');
let errors = 0, requests = 0, maxDashboardBytes = 0;
const definition: HuntDefinition = { schemaVersion: 1, id, version: 1, title: '100-team contention workload', settings: { sessionDurationSeconds: 7200, minTeamSize: 4, maxTeamSize: 4, assignmentVersion: 2 },
  checkpoints: [{ id: 'one', title: 'One', basePoints: 10, hints: [{ id: 'hint', title: 'Hint', cost: 2, content: { type: 'text', text: 'Clue' } }], flow: { startNodeId: 'router', nodes: [
    { id: 'router', type: 'random_branch', choices: [{ next: 'left', weight: 1 }, { next: 'right', weight: 1 }] },
    ...['left', 'right'].map(route => ({ id: route, type: 'verify_answer' as const, prompt: 'Answer?', answers: ['yes'], recordAnswerAttempts: true, next: 'done' })), { id: 'done', type: 'complete' },
  ] } }] };
async function measure<T>(work: () => Promise<T>) { const at = performance.now(); requests++; try { return await work(); } catch (error) { errors++; throw error; } finally { latency.push(performance.now() - at); } }
async function batches<T>(values: T[], width: number, work: (value: T) => Promise<void>) { for (let offset = 0; offset < values.length; offset += width) await Promise.all(values.slice(offset, offset + width).map(work)); }
async function main() { try {
  await getPool().query(await readFile(new URL('../../database/v2.sql', import.meta.url), 'utf8')); await publishHunt(definition);
  const teams: { id: string; sessions: Awaited<ReturnType<typeof authenticate>>[]; nodeId: string; assignments: unknown }[] = [];
  await batches(Array.from({ length: 100 }, (_, index) => index), 10, async index => {
    const teamName = `Team ${index}`, names = ['Alice', 'Bob', 'Carol', 'Dan'];
    const first = await joinTeam({ huntId: id, teamName, playerName: names[0], pin: '123456', mode: 'create', memberNames: names });
    const sessions = [await authenticate(first.token, 'team')];
    for (const playerName of names.slice(1)) sessions.push(await authenticate((await joinTeam({ huntId: id, teamName, playerName, pin: '123456', mode: 'join' })).token, 'team'));
    const starts = await Promise.all(sessions.map(session => measure(() => applyTeamCommand(first.view.teamId, randomUUID(), { type: 'start_session', expectedRevision: 0 }, false, { role: 'team', sessionHash: session.sessionHash }))));
    assert.equal(starts.filter(s => s.feedback.status === 'accepted').length, 1);
    teams.push({ id: first.view.teamId, sessions, nodeId: starts[0].view.node!.id, assignments: (await getTeamRecord(first.view.teamId)).state.routeAssignments });
  });
  const devices = teams.flatMap(team => team.sessions.map(session => ({ team, session })));
  // Four authenticated devices per team contend on one hint purchase.
  await Promise.all(devices.map(({ team, session }) => measure(() => applyTeamCommand(team.id, randomUUID(), { type: 'use_hint', checkpointId: 'one', hintId: 'hint' }, false, { role: 'team', sessionHash: session.sessionHash }))));
  for (let round = 0; round < rounds; round++) {
    await Promise.all([
      ...devices.map(({ team, session }) => measure(async () => {
        const receipt = randomUUID(), input = { type: 'verify', checkpointId: 'one', nodeId: team.nodeId, value: `wrong-${round}` };
        const actor = { role: 'team' as const, name: session.player_name, memberId: session.member_id, sessionHash: session.sessionHash };
        await applyTeamCommand(team.id, receipt, input, false, actor);
        // Drop the successful response, retry the same receipt, then poll.
        const replay = await applyTeamCommand(team.id, receipt, input, false, actor); assert.equal(replay.feedback.status, 'rejected');
        await teamView(team.id);
      })),
      measure(async () => { const dashboard = await organizerSnapshot(); maxDashboardBytes = Math.max(maxDashboardBytes, Buffer.byteLength(JSON.stringify(dashboard))); }),
    ]);
  }
  // Concentrated long history, then every audit page, not just the 20-item cache.
  for (let index = 0; index < 150; index++) await measure(() => applyTeamCommand(teams[0].id, randomUUID(), { type: 'verify', checkpointId: 'one', nodeId: teams[0].nodeId, value: `long-history-${index}` }));
  await batches(teams, 10, async team => {
    const requestId = randomUUID(), command = { type: 'verify', checkpointId: 'one', nodeId: team.nodeId, value: 'yes' };
    await Promise.all(Array.from({ length: 4 }, () => measure(() => applyTeamCommand(team.id, requestId, command))));
    const state = (await getTeamRecord(team.id)).state;
    assert.equal(state.score, 8); assert.equal(state.ledger.length, 2); assert.deepEqual(state.routeAssignments, team.assignments);
    assert.equal(state.events.filter(e => e.type === 'session_started').length, 1);
    let page = await resultActivity(team.id, state.revision), attempts = page.entries.filter(e => e.type === 'answer_submitted').length;
    while (page.next) { page = await resultActivity(team.id, state.revision, page.next.revision, page.next.ordinal); attempts += page.entries.filter(e => e.type === 'answer_submitted').length; }
    assert.equal(attempts, rounds * 4 + 1 + (team.id === teams[0].id ? 150 : 0));
  });
  let results = await listResults(id), count = results.teams.length;
  while (results.next) { results = await listResults(id, results.next, results.asOf); count += results.teams.length; }
  assert.equal(count, 100); assert.ok(getPool().totalCount <= 10);
  latency.sort((a, b) => a - b);
  console.log(JSON.stringify({ workload: '100 teams / 400 authenticated sessions; service + PostgreSQL (not HTTP or physical phones)', rounds, measuredOperations: requests, errors,
    p50Ms: Math.round(latency[Math.floor(latency.length * .5)]), p95Ms: Math.round(latency[Math.floor(latency.length * .95)]), p99Ms: Math.round(latency[Math.floor(latency.length * .99)]),
    elapsedSeconds: Math.round((performance.now() - started) / 1000), maxDashboardBytes, poolConnections: getPool().totalCount, teamsExported: count }, null, 2));
} finally { await getPool().query('delete from hunt_v2.hunts where id=$1', [id]); await getPool().end(); } }
void main().catch(error => { console.error(error); process.exitCode = 1; });
