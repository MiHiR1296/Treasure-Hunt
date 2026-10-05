import '../isolated-database';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getPool } from '../../lib/server/db';

const enabled = Boolean(process.env.DATABASE_URL);

before(async () => {
  if (!enabled) return;
  const schema = await readFile(new URL('../../database/v3.sql', import.meta.url), 'utf8');
  await getPool().query(schema);
  // The startup migration is deliberately repeatable.
  await getPool().query(schema);
});

after(async () => {
  if (enabled) await getPool().end();
});

test('PostgreSQL V3: run isolation, immutable evidence, score cache, recognition and media cleanup', { skip: !enabled }, async () => {
  const client = await getPool().connect();
  const huntId = `v3-schema-${randomUUID()}`;
  const teamId = randomUUID();
  const memberOne = randomUUID();
  const memberTwo = randomUUID();
  const runId = randomUUID();
  const mediaId = randomUUID();
  try {
    await client.query('begin');
    await client.query(
      `insert into hunt_v3.hunts(id,title,slug,settings)
        values($1,'V3 schema test',$2,'{}')`,
      [huntId, huntId],
    );
    await client.query(
      `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
        values($1,1,$2,$3,'{}',$4)`,
      [huntId, { schemaVersion: 3 }, 'a'.repeat(64), { valid: true, routes: [], issues: [] }],
    );
    await client.query('update hunt_v3.hunts set latest_version=1 where id=$1', [huntId]);
    await client.query(
      `insert into hunt_v3.teams(id,hunt_id,canonical_code,display_name,name_key,name_status,pin_hash,registration_source)
        values($1,$2,'T-001',null,null,'approved',$3,'self_serve')`,
      [teamId, huntId, 'x'.repeat(32)],
    );
    await client.query(
      `insert into hunt_v3.team_members(id,team_id,name,name_key) values
        ($1,$3,'Aarav','aarav'),($2,$3,'Priya','priya')`,
      [memberOne, memberTwo, teamId],
    );
    await client.query(
      `insert into hunt_v3.runs(
        id,team_id,hunt_id,hunt_version,run_number,private_seed,seed_commitment,
        route_plan,resolved_variables,engine_state,status,started_at)
        values($1,$2,$3,1,1,$4,$5,$6,'{}',$7,'active',clock_timestamp())`,
      [runId, teamId, huntId, 's'.repeat(32), 'b'.repeat(64), { routeCheckpointIds: ['start', 'finish'] }, {
        revision: 0,
        routeAssignments: [{
          checkpointId: 'start',
          nodeId: 'seeded-branch',
          choiceIndex: 0,
          nextNodeId: 'blue-route',
          algorithmVersion: 2,
          assignedAt: '2026-10-05T12:00:00.000Z',
          source: 'automatic',
        }],
      }],
    );
    await client.query(
      `insert into hunt_v3.run_members(run_id,team_id,member_id,member_name_snapshot) values
        ($1,$2,$3,'Aarav'),($1,$2,$4,'Priya')`,
      [runId, teamId, memberOne, memberTwo],
    );
    const event = (await client.query(
      `insert into hunt_v3.run_events(
        run_id,team_id,revision,ordinal,request_id,actor_kind,actor_member_id,event_type,details,occurred_at)
        values($1,$2,0,1,$3,'member',$4,'run_started','{}',clock_timestamp()) returning id`,
      [runId, teamId, randomUUID(), memberOne],
    )).rows[0];
    await client.query(
      `insert into hunt_v3.score_ledger(
        run_id,team_id,source_event_id,source_key,category,amount,reason,details)
        values($1,$2,$3,'checkpoint:start','checkpoint_completed',25,'Completed start','{}')`,
      [runId, teamId, event.id],
    );
    assert.deepEqual(
      (await client.query('select score,bonus_score from hunt_v3.runs where id=$1', [runId])).rows[0],
      { score: 25, bonus_score: 0 },
    );

    const maximumId = 'x'.repeat(100);
    const nodePuzzleKey = `puzzle:${maximumId}:${maximumId}:quiz:skip:${maximumId}`;
    const hintPuzzleKey = `puzzle:${maximumId}:hint:${maximumId}:quiz:bonus:49`;
    await client.query(
      `insert into hunt_v3.score_ledger(
        run_id,team_id,source_event_id,source_key,category,amount,counts_for_ranking,reason,details)
        values($1,$2,$3,$4,'skip_penalty',-1,false,$6,'{}'),
              ($1,$2,$3,$5,'action_points',1,false,$6,'{}')`,
      [runId, teamId, event.id, nodePuzzleKey, hintPuzzleKey, 'r'.repeat(1000)],
    );
    assert.equal(nodePuzzleKey.length > 180, true, 'maximum valid semantic IDs exceed the superseded ledger limit');
    assert.equal(
      (await client.query('select bonus_score from hunt_v3.runs where id=$1', [runId])).rows[0].bonus_score,
      0,
      'full-length puzzle source keys and a 1,000-character reason persist without changing their net cache',
    );

    await client.query('savepoint oversized_score_source');
    await assert.rejects(
      client.query(
        `insert into hunt_v3.score_ledger(
          run_id,team_id,source_event_id,source_key,category,amount,reason,details)
          values($1,$2,$3,$4,'action_points',1,'reason','{}')`,
        [runId, teamId, event.id, 'k'.repeat(513)],
      ),
      /score_ledger_source_key_length/i,
    );
    await client.query('rollback to savepoint oversized_score_source');

    await client.query('savepoint oversized_score_reason');
    await assert.rejects(
      client.query(
        `insert into hunt_v3.score_ledger(
          run_id,team_id,source_event_id,source_key,category,amount,reason,details)
          values($1,$2,$3,'reason-limit','action_points',1,$4,'{}')`,
        [runId, teamId, event.id, 'r'.repeat(1001)],
      ),
      /score_ledger_reason_length/i,
    );
    await client.query('rollback to savepoint oversized_score_reason');

    await client.query(
      `insert into hunt_v3.run_contributions(
        run_id,team_id,member_id,source_event_id,source_key,category,credit,evidence)
        values($1,$2,$3,$4,'event:start','trailblazer',2,$5)`,
      [runId, teamId, memberOne, event.id, { summary: 'Confirmed the first checkpoint' }],
    );
    await client.query(
      `insert into hunt_v3.recognition_votes(
        run_id,team_id,voter_member_id,recipient_member_id,revision,category,subtype,answer_path)
        values($1,$2,$3,$4,1,'trail_speed','first_finder',$5)`,
      [runId, teamId, memberTwo, memberOne, JSON.stringify(['trail_speed', 'first_finder'])],
    );

    await client.query('savepoint self_vote');
    await assert.rejects(
      client.query(
        `insert into hunt_v3.recognition_votes(
          run_id,team_id,voter_member_id,recipient_member_id,revision,category,subtype)
          values($1,$2,$3,$3,1,'crew_energy','helping_hand')`,
        [runId, teamId, memberOne],
      ),
      /recognition_votes.*check/i,
    );
    await client.query('rollback to savepoint self_vote');

    await client.query(
      `insert into hunt_v3.media(
        id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,kind,
        content_type,bytes,content_hash,storage_key,review_status,reviewed_at)
        values($1,$2,$3,$4,$5,'start','photo','photo','image/jpeg',100,$6,$7,'approved',clock_timestamp())`,
      [mediaId, huntId, teamId, runId, memberOne, 'c'.repeat(64), `v3/test/${mediaId}.jpg`],
    );
    await client.query('delete from hunt_v3.media where id=$1', [mediaId]);
    assert.equal(
      (await client.query('select count(*)::int as count from hunt_v3.media_deletions where storage_key=$1', [`v3/test/${mediaId}.jpg`])).rows[0].count,
      1,
    );

    await client.query('savepoint immutable_event');
    await assert.rejects(
      client.query("update hunt_v3.run_events set event_type='tampered' where id=$1", [event.id]),
      /append-only/i,
    );
    await client.query('rollback to savepoint immutable_event');

    await client.query('savepoint immutable_plan');
    await assert.rejects(
      client.query("update hunt_v3.runs set route_plan='{}' where id=$1", [runId]),
      /route.*immutable/i,
    );
    await client.query('rollback to savepoint immutable_plan');

    await client.query(
      `update hunt_v3.runs
        set engine_state=jsonb_set(engine_state,'{revision}','1'::jsonb)
        where id=$1`,
      [runId],
    );
    assert.equal(
      (await client.query("select engine_state->>'revision' as revision from hunt_v3.runs where id=$1", [runId])).rows[0].revision,
      '1',
      'normal engine-state progression remains mutable',
    );

    await client.query('savepoint immutable_seeded_assignments');
    await assert.rejects(
      client.query(
        `update hunt_v3.runs
          set engine_state=jsonb_set(engine_state,'{routeAssignments,0,nextNodeId}','"red-route"'::jsonb)
          where id=$1`,
        [runId],
      ),
      /route assignments.*immutable/i,
    );
    await client.query('rollback to savepoint immutable_seeded_assignments');

    const rls = (await client.query(
      `select count(*)::int as total,
        count(*) filter(where c.relrowsecurity)::int as protected
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='hunt_v3' and c.relkind='r'`,
    )).rows[0];
    assert.equal(rls.protected, rls.total);
  } finally {
    await client.query('rollback');
    client.release();
  }
});
