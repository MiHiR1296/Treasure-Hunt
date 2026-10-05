import '../isolated-database';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import sharp from 'sharp';
import { getPool } from '../../lib/server/db';
import { canonicalJson, digest, HttpError } from '../../lib/server/security';
import { completeV3DirectUpload, prepareV3DirectUpload } from '../../lib/server/v3/direct-uploads';
import { uploadV3Photo } from '../../lib/server/v3/media';
import { createRun } from '../../lib/server/v3/runs';
import { validateFairness } from '../../lib/v3/fairness';
import type { V3Definition } from '../../lib/v3/types';

const enabled = Boolean(process.env.DATABASE_URL);
const status = (code: number) => (error: unknown) => error instanceof HttpError && error.status === code;

before(async () => {
  if (enabled) await getPool().query(await readFile(new URL('../../database/v3.sql', import.meta.url), 'utf8'));
});
after(async () => { if (enabled) await getPool().end(); });

function photoDefinition(id: string): V3Definition {
  return {
    schemaVersion: 3,
    id,
    version: 1,
    title: 'Bound direct upload test',
    settings: {
      mode: 'sequential',
      map: 'none',
      rules: 'Use fresh evidence.',
      minTeamSize: 1,
      maxTeamSize: 4,
      sessionDurationSeconds: 3600,
      registrationOpen: true,
      completionMessage: 'Complete.',
      photoRetention: 'after_verification',
      registrationMode: 'organizer-assigned',
      runPolicy: { mode: 'unlimited' },
      leaderboardPolicy: {
        bestRunRule: 'score_then_time_then_completion',
        mainBoardEnabled: false,
        replayBoardEnabled: false,
        replayBoardPublic: false,
        timeVisibility: 'after_second_eligible_run',
        showProgress: true,
      },
      publicBoard: {
        enabled: false,
        status: 'live',
        teamIdentity: 'code_only',
        columns: ['rank', 'team_code', 'points'],
      },
      socialShare: { enabled: false, allowPersonalTitle: false },
      recognition: { enabled: false, peerVotingEnabled: false, votingWindowMinutes: 30, dataWeight: 0.7, peerWeight: 0.3 },
      routePlan: {
        startCheckpointId: 'start',
        finaleCheckpointId: 'finale',
        requiredCheckpointIds: [],
        choose: { count: 0, fromCheckpointIds: [] },
        shuffleSelectedCheckpoints: false,
        avoidTransitions: [],
        checkpointEstimates: { start: { durationMinutes: 1 }, finale: { durationMinutes: 1 } },
        travelEstimates: [{ from: 'start', to: 'finale', durationMinutes: 0 }],
      },
      challengePools: {},
      variableGenerators: {},
      fairnessPolicy: {
        minimumDistinctPlans: 1,
        durationToleranceMinutes: 0,
        maxResolvedRoutes: 10,
        requireTravelEstimates: true,
        walkingSpeedMetersPerMinute: 72,
        minutesPerDifficultyPoint: 1.5,
      },
      parallelMechanics: [],
    },
    checkpoints: [
      {
        id: 'start',
        title: 'Photograph the start',
        basePoints: 10,
        required: true,
        hints: [],
        flow: {
          startNodeId: 'photo',
          nodes: [
            { id: 'photo', type: 'verify_image', prompt: 'Take a current photo.', referenceImages: [], next: 'done' },
            { id: 'done', type: 'complete' },
          ],
        },
      },
      {
        id: 'finale',
        title: 'Finale',
        basePoints: 10,
        required: true,
        hints: [],
        flow: {
          startNodeId: 'finish',
          nodes: [
            { id: 'finish', type: 'show_text', text: 'Finish.', next: 'done' },
            { id: 'done', type: 'complete' },
          ],
        },
      },
    ],
  };
}

async function fixture(label: string) {
  const huntId = `direct-${label}-${randomUUID().slice(0, 8)}`;
  const definition = photoDefinition(huntId);
  const fairness = validateFairness(definition);
  assert.equal(fairness.valid, true, JSON.stringify(fairness.issues));
  const teamId = randomUUID();
  const memberId = randomUUID();
  const otherMemberId = randomUUID();
  await getPool().query(
    `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,registration_open,latest_version,settings)
      values($1,$2,$1,'live','organizer_assigned',true,1,$3)`,
    [huntId, definition.title, definition.settings],
  );
  await getPool().query(
    `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,1,$2,$3,$4,$5)`,
    [huntId, definition, digest(canonicalJson(definition)), { valid: true, issues: [] }, fairness],
  );
  await getPool().query(
    `insert into hunt_v3.teams(id,hunt_id,canonical_code,pin_hash,registration_source)
      values($1,$2,'T-001',$3,'organizer_assigned')`,
    [teamId, huntId, 'a'.repeat(64)],
  );
  await getPool().query(
    `insert into hunt_v3.team_members(id,team_id,name,name_key,status,checked_in_at)
      values($1,$3,'Owner','owner','active',clock_timestamp()),
        ($2,$3,'Teammate','teammate','active',clock_timestamp())`,
    [memberId, otherMemberId, teamId],
  );
  const run = await createRun(teamId, memberId, randomUUID());
  const state = (await getPool().query('select engine_state from hunt_v3.runs where id=$1', [run.runId])).rows[0].engine_state;
  assert.equal(state.activeCheckpointId, 'start');
  assert.equal(state.checkpoints.start.activeNodeId, 'photo');
  return { huntId, teamId, memberId, otherMemberId, runId: run.runId, state };
}

type Prepared = Awaited<ReturnType<typeof prepareV3DirectUpload>>;
function directUrl(prepared: Prepared) {
  if (!('mode' in prepared) || prepared.mode !== 'direct') assert.fail('Expected cloud direct-upload mode.');
  return prepared.uploadUrl;
}

test('PostgreSQL V3 direct-upload receipts reject stale, foreign, expired, altered, and duplicate completion', { skip: !enabled }, async t => {
  const saved = { ...process.env };
  const env = {
    MEDIA_STORAGE: 'supabase',
    SUPABASE_URL: 'https://storage.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only',
    SUPABASE_STORAGE_BUCKET: 'test-private',
    SUPABASE_UPLOAD_BUCKET: 'test-incoming',
  };
  Object.assign(process.env, env);
  t.after(() => {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  const objects = new Map<string, Buffer>();
  let readBarrier: { arrivals: number; wait: Promise<void>; release: () => void } | null = null;
  let durableWriteBarrier: { arrivals: number; wait: Promise<void>; release: () => void } | null = null;
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer server-only');
    const path = url.pathname.slice('/storage/v1/'.length);
    if (path === 'bucket/test-incoming') return Response.json({ public: false, file_size_limit: 20_000_000 });
    if (path.startsWith('object/upload/sign/')) return Response.json({ url: `/${path}?token=write-only-test` });
    if (init.method === 'DELETE') {
      for (const key of JSON.parse(String(init.body)).prefixes) objects.delete(`${path.slice('object/'.length)}/${key}`);
      return Response.json([]);
    }
    const key = path.slice('object/'.length);
    if (init.method === 'POST') {
      if (durableWriteBarrier && key.startsWith('test-private/')) {
        const barrier = durableWriteBarrier;
        barrier.arrivals += 1;
        await barrier.wait;
      }
      objects.set(key, Buffer.from(init.body as Uint8Array));
      return Response.json({});
    }
    if (readBarrier && objects.has(key)) {
      const barrier = readBarrier;
      barrier.arrivals += 1;
      await barrier.wait;
    }
    return objects.has(key)
      ? new Response(new Uint8Array(objects.get(key)!))
      : new Response('missing', { status: 404 });
  });

  let imageNumber = 0;
  const image = async () => sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: { r: 20 + imageNumber++, g: 90, b: 150 },
    },
  }).png().toBuffer();
  const prepare = async (identity: Awaited<ReturnType<typeof fixture>>, bytes: Buffer, requestId = randomUUID()) => {
    const input = {
      requestId,
      teamId: identity.teamId,
      checkpointId: 'start',
      nodeId: 'photo',
      size: bytes.length,
      contentType: 'image/png',
      sha256: digest(bytes),
    };
    const prepared = await prepareV3DirectUpload({ teamId: identity.teamId, memberId: identity.memberId }, input);
    const storageKey = new URL(directUrl(prepared)).pathname.split('/').at(-1)!;
    return { input, prepared, storageKey };
  };

  await t.test('three distinct completions make progress with the production three-connection pool', async () => {
    const pool = getPool();
    const previousMaximum = pool.options.max;
    assert.ok(pool.totalCount <= 3, 'the regression starts before the test process has grown beyond the production pool');
    pool.options.max = 3;
    let releaseRead!: () => void;
    const waitForRead = new Promise<void>(resolve => { releaseRead = resolve; });
    readBarrier = { arrivals: 0, wait: waitForRead, release: releaseRead };
    let releaseWrite!: () => void;
    const waitForWrite = new Promise<void>(resolve => { releaseWrite = resolve; });
    durableWriteBarrier = { arrivals: 0, wait: waitForWrite, release: releaseWrite };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const uploads = [];
      for (let index = 0; index < 3; index++) {
        const identity = await fixture(`pool-three-${index}`);
        const bytes = await image();
        const upload = await prepare(identity, bytes);
        objects.set(`test-incoming/${upload.storageKey}`, bytes);
        uploads.push({ identity, upload });
      }
      const completions = Promise.all(uploads.map(({ identity, upload }) => completeV3DirectUpload(
        { teamId: identity.teamId, memberId: identity.memberId },
        upload.input.requestId,
      )));
      const arrivalDeadline = Date.now() + 4_000;
      while (readBarrier.arrivals < 3 && Date.now() < arrivalDeadline) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(readBarrier.arrivals, 3, 'all three completions pause together in provider I/O');
      await Promise.race([
        pool.query('select 1'),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Provider I/O retained all three database clients.')),
            500,
          );
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      releaseRead();
      const writeDeadline = Date.now() + 4_000;
      while (durableWriteBarrier.arrivals < 3 && Date.now() < writeDeadline) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(durableWriteBarrier.arrivals, 3, 'all three completions pause together during durable provider writes');
      await Promise.race([
        pool.query('select 1'),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Durable provider writes retained all three database clients.')),
            500,
          );
        }),
      ]);
      if (timeout) clearTimeout(timeout);
      releaseWrite();
      const completed = await Promise.race([
        completions,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Three direct completions exhausted the three-connection pool.')),
            4_000,
          );
        }),
      ]);
      assert.equal(completed.length, 3);
      assert.equal(new Set(completed.map(item => item.media.id)).size, 3);
    } finally {
      if (timeout) clearTimeout(timeout);
      releaseRead();
      releaseWrite();
      readBarrier = null;
      durableWriteBarrier = null;
      pool.options.max = previousMaximum;
    }
  });

  await t.test('ticket preparation follows hunt-to-team-to-run lock order during disqualification', async () => {
    const identity = await fixture('prepare-disqualify-order');
    const bytes = await image();
    const requestId = randomUUID();
    const input = {
      requestId,
      teamId: identity.teamId,
      checkpointId: 'start',
      nodeId: 'photo',
      size: bytes.length,
      contentType: 'image/png',
      sha256: digest(bytes),
    };
    const disqualify = await getPool().connect();
    await disqualify.query('begin');
    let committed = false;
    try {
      await disqualify.query('select id from hunt_v3.hunts where id=$1 for update', [identity.huntId]);
      const pendingPreparation = prepareV3DirectUpload(
        { teamId: identity.teamId, memberId: identity.memberId },
        input,
      ).then(value => ({ value, error: null }), error => ({ value: null, error }));

      let waitingOnHunt = false;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && !waitingOnHunt) {
        waitingOnHunt = Boolean((await getPool().query(
          `select 1 from pg_stat_activity
            where datname=current_database() and pid<>pg_backend_pid()
              and wait_event_type='Lock'
              and position('from hunt_v3.hunts where id=$1 for key share' in lower(query))>0
            limit 1`,
        )).rowCount);
        if (!waitingOnHunt) await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(waitingOnHunt, true, 'ticket preparation waits on the hunt before locking any child row');

      await disqualify.query("set local statement_timeout='1000ms'");
      await disqualify.query('select id from hunt_v3.teams where id=$1 for update', [identity.teamId]);
      await disqualify.query('select id from hunt_v3.runs where id=$1 for update', [identity.runId]);
      await disqualify.query("update hunt_v3.teams set status='disqualified' where id=$1", [identity.teamId]);
      await disqualify.query(
        "update hunt_v3.runs set status='disqualified',eligible=false,ineligibility_reason='Deterministic ticket race test' where id=$1",
        [identity.runId],
      );
      await disqualify.query('commit');
      committed = true;

      const outcome = await pendingPreparation;
      assert.equal(outcome.value, null);
      assert.ok(outcome.error instanceof HttpError);
      assert.equal(outcome.error.status, 409);
      assert.equal((await getPool().query('select 1 from hunt_v3.media_uploads where id=$1', [requestId])).rowCount, 0);
      assert.deepEqual(
        (await getPool().query('select status,eligible from hunt_v3.runs where id=$1', [identity.runId])).rows[0],
        { status: 'disqualified', eligible: false },
        'disqualification commits without a deadlock and no stale upload ticket is issued',
      );
    } finally {
      if (!committed) await disqualify.query('rollback').catch(() => undefined);
      disqualify.release();
    }
  });

  await t.test('a Run 1 ticket cannot materialize the recurring node in Run 2', async () => {
    const identity = await fixture('stale-run');
    const bytes = await image();
    const upload = await prepare(identity, bytes);
    objects.set(`test-incoming/${upload.storageKey}`, bytes);
    await getPool().query(
      "update hunt_v3.runs set status='abandoned',eligible=false,ineligibility_reason='Test replay' where id=$1",
      [identity.runId],
    );
    const replay = await createRun(identity.teamId, identity.memberId, randomUUID());
    assert.notEqual(replay.runId, identity.runId);
    assert.equal(replay.checkpoint?.id, 'start');
    assert.equal(replay.node?.id, 'photo');
    await assert.rejects(
      completeV3DirectUpload({ teamId: identity.teamId, memberId: identity.memberId }, upload.input.requestId),
      status(409),
    );
    assert.equal((await getPool().query('select 1 from hunt_v3.media where id=$1', [upload.input.requestId])).rowCount, 0);
  });

  await t.test('a reset copy of the same node is a different prepared task', async () => {
    const identity = await fixture('stale-task');
    const bytes = await image();
    const upload = await prepare(identity, bytes);
    objects.set(`test-incoming/${upload.storageKey}`, bytes);
    const changedState = structuredClone(identity.state);
    changedState.checkpoints.start.nodes.photo.startedAt = new Date(
      Date.parse(changedState.checkpoints.start.nodes.photo.startedAt) + 1_000,
    ).toISOString();
    await getPool().query('update hunt_v3.runs set engine_state=$1 where id=$2', [changedState, identity.runId]);
    await assert.rejects(
      completeV3DirectUpload({ teamId: identity.teamId, memberId: identity.memberId }, upload.input.requestId),
      status(409),
    );
    await assert.rejects(
      getPool().query(
        `insert into hunt_v3.media(
          id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,kind,content_type,bytes,content_hash,storage_key,retention,
          task_started_at)
          values($1,$2,$3,$4,$5,'start','photo','photo','image/jpeg',1,$6,$7,'keep',$8::timestamptz)`,
        [upload.input.requestId, identity.huntId, identity.teamId, identity.runId, identity.memberId,
          digest(`stale-task-${upload.input.requestId}`), `${upload.input.requestId}-${randomUUID()}`,
          changedState.checkpoints.start.nodes.photo.startedAt],
      ),
      (error: unknown) => (error as { constraint?: string }).constraint === 'media_upload_ticket_binding',
      'the database boundary rejects stale task materialization even if application checks are bypassed',
    );
  });

  await t.test('the exact prepared owner is required', async () => {
    const identity = await fixture('wrong-owner');
    const bytes = await image();
    const upload = await prepare(identity, bytes);
    objects.set(`test-incoming/${upload.storageKey}`, bytes);
    await assert.rejects(
      completeV3DirectUpload({ teamId: identity.teamId, memberId: identity.otherMemberId }, upload.input.requestId),
      status(403),
    );
    assert.equal((await getPool().query('select 1 from hunt_v3.media where id=$1', [upload.input.requestId])).rowCount, 0);
  });

  await t.test('database expiry is immutable and enforced at materialization', async () => {
    const identity = await fixture('expired');
    const bytes = await image();
    const requestId = randomUUID();
    const storageKey = `${requestId}-${randomUUID()}`;
    const expiresAt = new Date(Date.now() - 60_000).toISOString();
    const metadata = {
      size: bytes.length,
      contentType: 'image/png',
      sha256: digest(bytes),
      checkpointId: 'start',
      nodeId: 'photo',
      taskStartedAt: identity.state.checkpoints.start.nodes.photo.startedAt,
    };
    const ownerKey = `team:${identity.teamId}:member:${identity.memberId}`;
    const payloadHash = digest(canonicalJson({
      id: requestId,
      ownerKey,
      huntId: identity.huntId,
      teamId: identity.teamId,
      runId: identity.runId,
      memberId: identity.memberId,
      storageKey,
      expiresAt,
      metadata,
      kind: 'photo',
    }));
    await getPool().query(
      `insert into hunt_v3.media_uploads(
        id,owner_key,hunt_id,team_id,run_id,member_id,kind,storage_key,payload_hash,metadata,expires_at,cleanup_after)
        values($1,$2,$3,$4,$5,$6,'photo',$7,$8,$9,$10,$10::timestamptz+interval '2 hours')`,
      [requestId, ownerKey, identity.huntId, identity.teamId, identity.runId, identity.memberId,
        storageKey, payloadHash, metadata, expiresAt],
    );
    objects.set(`test-incoming/${storageKey}`, bytes);
    await assert.rejects(
      completeV3DirectUpload({ teamId: identity.teamId, memberId: identity.memberId }, requestId),
      status(410),
    );
    await assert.rejects(
      getPool().query(
        `insert into hunt_v3.media(
          id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,kind,content_type,bytes,content_hash,storage_key,retention,
          task_started_at)
          values($1,$2,$3,$4,$5,'start','photo','photo','image/jpeg',1,$6,$7,'keep',$8::timestamptz)`,
        [requestId, identity.huntId, identity.teamId, identity.runId, identity.memberId,
          digest(`expired-${requestId}`), `${requestId}-${randomUUID()}`, metadata.taskStartedAt],
      ),
      (error: unknown) => (error as { constraint?: string }).constraint === 'media_upload_ticket_expired',
    );
  });

  await t.test('changed metadata and changed bytes cannot reuse a receipt', async () => {
    const identity = await fixture('altered');
    const bytes = await image();
    const upload = await prepare(identity, bytes);
    await assert.rejects(
      prepareV3DirectUpload(
        { teamId: identity.teamId, memberId: identity.memberId },
        { ...upload.input, sha256: 'b'.repeat(64) },
      ),
      status(409),
    );
    await assert.rejects(
      getPool().query(
        "update hunt_v3.media_uploads set metadata=jsonb_set(metadata,'{sha256}',to_jsonb($2::text)) where id=$1",
        [upload.input.requestId, 'c'.repeat(64)],
      ),
      (error: unknown) => (error as { constraint?: string }).constraint === 'media_upload_ticket_binding',
      'the database receipt cannot be rewritten after signing',
    );
    const replacement = await image();
    await assert.rejects(
      uploadV3Photo(identity.teamId, identity.memberId, {
        id: upload.input.requestId,
        checkpointId: 'start',
        nodeId: 'photo',
        file: new File([new Uint8Array(replacement)], 'replacement.png', { type: 'image/png' }),
      }),
      status(409),
      'a cloud multipart request cannot bypass the immutable direct-upload receipt',
    );
    const altered = Buffer.from(bytes);
    altered[altered.length - 1] ^= 1;
    objects.set(`test-incoming/${upload.storageKey}`, altered);
    await assert.rejects(
      completeV3DirectUpload({ teamId: identity.teamId, memberId: identity.memberId }, upload.input.requestId),
      status(400),
    );
    assert.equal((await getPool().query('select 1 from hunt_v3.media where id=$1', [upload.input.requestId])).rowCount, 0);
  });

  await t.test('concurrent duplicate completion creates and returns exactly one media record', async () => {
    const identity = await fixture('concurrent');
    const bytes = await image();
    const requestId = randomUUID();
    const input = {
      requestId,
      teamId: identity.teamId,
      checkpointId: 'start',
      nodeId: 'photo',
      size: bytes.length,
      contentType: 'image/png',
      sha256: digest(bytes),
    };
    const owner = { teamId: identity.teamId, memberId: identity.memberId };
    const [firstPreparation, secondPreparation] = await Promise.all([
      prepareV3DirectUpload(owner, input),
      prepareV3DirectUpload(owner, input),
    ]);
    assert.equal(directUrl(secondPreparation), directUrl(firstPreparation), 'concurrent preparation reuses the winning immutable receipt');
    assert.equal((await getPool().query('select count(*)::int as count from hunt_v3.media_uploads where id=$1', [requestId])).rows[0].count, 1);
    const storageKey = new URL(directUrl(firstPreparation)).pathname.split('/').at(-1)!;
    const incomingKey = `test-incoming/${storageKey}`;
    objects.set(incomingKey, bytes);
    const durableBefore = [...objects.keys()].filter(key => key.startsWith('test-private/')).length;
    const [first, second] = await Promise.all([
      completeV3DirectUpload(owner, requestId),
      completeV3DirectUpload(owner, requestId),
    ]);
    assert.deepEqual(second, first);
    assert.equal((await getPool().query('select count(*)::int as count from hunt_v3.media where id=$1', [requestId])).rows[0].count, 1);
    const receipt = (await getPool().query(
      'select media_id,completed_at from hunt_v3.media_uploads where id=$1',
      [requestId],
    )).rows[0];
    assert.equal(receipt.media_id, requestId);
    assert.ok(receipt.completed_at);
    assert.equal(objects.has(incomingKey), false, 'validated raw bytes are removed once after completion');
    assert.equal([...objects.keys()].filter(key => key.startsWith('test-private/')).length, durableBefore + 1);
  });
});
