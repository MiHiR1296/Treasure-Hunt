import './isolated-database';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createInitialState, executeCommand } from '../lib/engine';
import type { HuntDefinition } from '../lib/engine/types';
import { getPool } from '../lib/server/db';
import { applyTeamCommand, joinTeam } from '../lib/server/store';
import { authenticate, canonicalJson, digest } from '../lib/server/security';

// Run seed against main's schema in a separate disposable DB, apply v2.sql,
// then run verify. No production DB or application binary is touched.
const id = 'migration-compatibility-fixture', teamId = '8b79bf49-55ce-4ec1-ac0e-cfc703ceea8a', receiptId = 'e7f1365e-98bb-42d6-9109-75996684614a';
const now = '2026-01-01T00:00:00.000Z', token = 'disposable-legacy-session-fixture-only';
const definition: HuntDefinition = { schemaVersion: 1, id, title: 'Legacy fixture', version: 1, checkpoints: [{ id: 'one', title: 'One', basePoints: 10, hints: [{ id: 'hint', title: 'Legacy hint', cost: 2, content: { type: 'text', text: 'Purchased clue' } }], flow: { startNodeId: 'answer', nodes: [{ id: 'answer', type: 'verify_answer', prompt: 'Question', answers: ['yes'], next: 'done' }, { id: 'done', type: 'complete' }] } }] };
const command = { type: 'use_hint' as const, checkpointId: 'one', hintId: 'hint' };
const expected = executeCommand(definition, createInitialState(definition, teamId, now), command, now);
async function main() { try {
  if (process.argv[2] === 'seed') {
    await getPool().query("insert into hunt_v2.hunts(id,title,version,definition,status) values($1,$2,1,$3,'live')", [id, definition.title, definition]);
    await getPool().query('insert into hunt_v2.hunt_versions(hunt_id,version,definition) values($1,1,$2)', [id, definition]);
    await getPool().query('insert into hunt_v2.drafts(id,definition,revision) values($1,$2,7)', [id, definition]);
    await getPool().query("insert into hunt_v2.teams(id,hunt_id,name,name_key,pin_hash,state) values($1,$2,'Old team','old team','fixture-only',$3)", [teamId, id, expected.state]);
    await getPool().query("insert into hunt_v2.sessions(token_hash,role,team_id,player_name,expires_at) values($1,'team',$2,'Legacy member',clock_timestamp()+interval '1 day')", [digest(token), teamId]);
    await getPool().query('insert into hunt_v2.command_receipts(team_id,request_id,payload_hash,feedback) values($1,$2,$3,$4)', [teamId, receiptId, digest(canonicalJson({ override: false, command })), expected.feedback]);
    console.log('Seeded pre-upgrade published definition, draft, active state, purchased hint, ledger, receipt and nullable legacy session.');
  } else if (process.argv[2] === 'verify') {
    const generation = (await getPool().query('select generation from hunt_v2.drafts where id=$1', [id])).rows[0].generation;
    for (let retry = 0; retry < 2; retry++) await getPool().query(await readFile(new URL('../database/v2.sql', import.meta.url), 'utf8'));
    const draft = (await getPool().query('select * from hunt_v2.drafts where id=$1', [id])).rows[0];
    assert.equal(draft.generation, generation); assert.equal(draft.revision, 7); assert.deepEqual(draft.definition, definition);
    const session = await authenticate(token, 'team'); assert.equal(session.team_id, teamId); assert.equal(session.member_id, null);
    const recovered = await applyTeamCommand(teamId, receiptId, command); assert.deepEqual(recovered.feedback, expected.feedback); assert.equal(recovered.view.score, -2);
    assert.deepEqual((await getPool().query('select state from hunt_v2.teams where id=$1', [teamId])).rows[0].state, expected.state);
    const newlyJoined = await joinTeam({ huntId: id, teamName: 'New legacy team', playerName: 'Alice', pin: '123456', mode: 'create' });
    assert.equal(newlyJoined.view.status, 'active'); assert.equal(newlyJoined.view.timer, undefined);
    console.log('PASS: existing-data migration, repeat migration, legacy session, receipt, points, hints, definition, draft and immediate-start compatibility.');
  } else throw new Error('Choose seed or verify.');
} finally { await getPool().end(); } }
void main().catch(error => { console.error(error); process.exitCode = 1; });
