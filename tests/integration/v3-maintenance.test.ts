import '../isolated-database';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getPool } from '../../lib/server/db';
import { cleanupV3ExpiredMedia } from '../../lib/server/v3-maintenance.mjs';
import { readV3MediaRecord } from '../../lib/server/v3/media';
import { pendingPhotoReviews, reviewPhoto } from '../../lib/server/v3/operations';

const enabled = Boolean(process.env.DATABASE_URL);
let mediaDirectory = '';
let previousStorage: string | undefined;
let previousDirectory: string | undefined;

before(async () => {
  if (!enabled) return;
  const schema = await readFile(new URL('../../database/v3.sql', import.meta.url), 'utf8');
  await getPool().query(schema);
  mediaDirectory = await mkdtemp(path.join(os.tmpdir(), 'hunt-v3-maintenance-'));
  previousStorage = process.env.MEDIA_STORAGE;
  previousDirectory = process.env.MEDIA_DIRECTORY;
  process.env.MEDIA_STORAGE = 'filesystem';
  process.env.MEDIA_DIRECTORY = mediaDirectory;
});

after(async () => {
  if (!enabled) return;
  await getPool().end();
  await rm(mediaDirectory, { recursive: true, force: true });
  if (previousStorage === undefined) delete process.env.MEDIA_STORAGE;
  else process.env.MEDIA_STORAGE = previousStorage;
  if (previousDirectory === undefined) delete process.env.MEDIA_DIRECTORY;
  else process.env.MEDIA_DIRECTORY = previousDirectory;
});

test('V3 maintenance preserves submitted review evidence and terminal reviews remain audit-only', { skip: !enabled }, async () => {
  const suffix = randomUUID().slice(0, 8);
  const huntId = `v3-maintenance-test-${suffix}`;
  const definition = {
    schemaVersion: 3,
    id: huntId,
    version: 1,
    title: 'Maintenance review evidence',
    settings: {},
    checkpoints: [],
  };
  await getPool().query(
    `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,latest_version,settings)
      values($1,'Maintenance review evidence',$1,'live','self_serve',1,'{}')`,
    [huntId],
  );
  await getPool().query(
    `insert into hunt_v3.hunt_versions(hunt_id,version,definition,content_hash,validation_report,fairness_report)
      values($1,1,$2,$3,'{}',$4)`,
    [huntId, definition, 'e'.repeat(64), { valid: true, issues: [], routes: [] }],
  );

  const identities = new Map<string, {
    teamId: string;
    memberId: string;
    runId: string;
    targetStatus: 'waiting' | 'active' | 'completed';
    taskStartedAt: string;
  }>();
  const addRun = async (key: string, code: string, status: 'waiting' | 'active' | 'completed') => {
    const teamId = randomUUID(), memberId = randomUUID(), runId = randomUUID();
    await getPool().query(
      `insert into hunt_v3.teams(id,hunt_id,canonical_code,pin_hash,registration_source,status)
        values($1,$2,$3,$4,'self_serve','active')`,
      [teamId, huntId, code, 'p'.repeat(32)],
    );
    await getPool().query(
      `insert into hunt_v3.team_members(id,team_id,name,name_key,status)
        values($1,$2,$3,$4,'active')`,
      [memberId, teamId, `Member ${key}`, `member-${key.toLowerCase()}`],
    );
    const startedAt = '2026-10-01T09:00:00.000Z';
    await getPool().query(
      `insert into hunt_v3.runs(
        id,team_id,hunt_id,hunt_version,run_number,private_seed,seed_commitment,route_plan,resolved_variables,
        engine_state,status,score,progress,started_at,completed_at,elapsed_ms)
        values($1,$2,$3,1,1,$4,$5,$6,'{}',$7,$8,17,0,$9,$10,$11)`,
      [runId, teamId, huntId, randomUUID().replaceAll('-', ''), randomUUID().replaceAll('-', '').repeat(2),
        { checkpointIds: [], routeCheckpointIds: [], variables: {}, challenges: [] },
        {
          revision: 0,
          status: 'active',
          startedAt,
          activeCheckpointId: 'checkpoint',
          clockPauses: [],
          checkpoints: {
            checkpoint: {
              status: 'active',
              activeNodeId: 'photo-node',
              nodes: { 'photo-node': { status: 'active', startedAt } },
            },
          },
          events: [],
          ledger: [],
        },
        'active', startedAt, null, null],
    );
    await getPool().query(
      `insert into hunt_v3.run_members(run_id,team_id,member_id,member_name_snapshot)
        values($1,$2,$3,$4)`,
      [runId, teamId, memberId, `Member ${key}`],
    );
    identities.set(key, { teamId, memberId, runId, targetStatus: status, taskStartedAt: startedAt });
  };
  await addRun('Active', 'T-701', 'active');
  await addRun('Waiting', 'T-702', 'waiting');
  await addRun('Terminal', 'T-703', 'completed');

  const media = new Map<string, string>();
  const addMedia = async (key: string, runKey: string, input: {
    submitted: boolean;
    reviewStatus?: 'pending' | 'approved';
    expired: boolean;
  }) => {
    const identity = identities.get(runKey)!;
    const id = randomUUID();
    const storageKey = `${randomUUID()}-${randomUUID()}`;
    const reviewStatus = input.reviewStatus ?? 'pending';
    await getPool().query(
      `insert into hunt_v3.media(
        id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,kind,content_type,bytes,content_hash,
        storage_key,review_status,review_reason,retention,created_at,submitted_at,reviewed_at,expires_at,task_started_at)
        values($1,$2,$3,$4,$5,'checkpoint','photo-node','photo','image/jpeg',10,$6,$7,$8,$9,'after_review',
          now()-interval '10 days',$10,$11,$12,$13::timestamptz)`,
      [id, huntId, identity.teamId, identity.runId, identity.memberId, id.replaceAll('-', '').repeat(2), storageKey,
        reviewStatus, reviewStatus === 'approved' ? 'Previously reviewed' : null,
        input.submitted ? new Date(Date.now() - 9 * 86_400_000).toISOString() : null,
        reviewStatus === 'approved' ? new Date(Date.now() - 8 * 86_400_000).toISOString() : null,
        input.expired ? new Date(Date.now() - 86_400_000).toISOString() : new Date(Date.now() + 6 * 86_400_000).toISOString(),
        identity.taskStartedAt],
    );
    media.set(key, id);
  };
  await addMedia('activePending', 'Active', { submitted: true, expired: true });
  await addMedia('waitingPending', 'Waiting', { submitted: true, expired: true });
  await addMedia('unsubmitted', 'Active', { submitted: false, expired: true });
  await addMedia('approved', 'Active', { submitted: true, reviewStatus: 'approved', expired: true });
  await addMedia('terminalPending', 'Terminal', { submitted: true, expired: false });

  const waiting = identities.get('Waiting')!;
  await getPool().query(
    `update hunt_v3.runs set status='waiting',engine_state=jsonb_set(engine_state,'{status}','"waiting"')
      where id=$1`,
    [waiting.runId],
  );
  const terminal = identities.get('Terminal')!;
  const terminalCompletedAt = '2026-10-01T10:00:00.000Z';
  await getPool().query(
    `update hunt_v3.runs set status='completed',completed_at=$1::timestamptz,elapsed_ms=3600000,
      engine_state=jsonb_set(
        jsonb_set(engine_state,'{status}','"completed"'),
        '{completedAt}',to_jsonb(($1::timestamptz)::text)
      )
      where id=$2`,
    [terminalCompletedAt, terminal.runId],
  );

  const removed = await cleanupV3ExpiredMedia(getPool());
  assert.ok(removed >= 2, 'ordinary expired uploads are removed');
  const remaining = (await getPool().query(
    'select id from hunt_v3.media where id=any($1::uuid[])',
    [[...media.values()]],
  )).rows.map(row => row.id);
  assert.ok(remaining.includes(media.get('activePending')!), 'submitted active evidence remains reviewable after nominal expiry');
  assert.ok(remaining.includes(media.get('waitingPending')!), 'submitted waiting evidence remains reviewable after nominal expiry');
  assert.equal(remaining.includes(media.get('unsubmitted')!), false, 'an unsubmitted expired upload is removed');
  assert.equal(remaining.includes(media.get('approved')!), false, 'reviewed expired evidence follows retention');
  assert.equal((await readV3MediaRecord(media.get('activePending')!)).id, media.get('activePending'));
  assert.equal((await readV3MediaRecord(media.get('waitingPending')!)).id, media.get('waitingPending'));

  const queue = await pendingPhotoReviews(huntId);
  assert.equal(queue.find(item => item.id === media.get('activePending'))?.runStatus, 'active');
  assert.equal(queue.find(item => item.id === media.get('waitingPending'))?.runStatus, 'waiting');
  assert.equal(queue.find(item => item.id === media.get('terminalPending'))?.runStatus, 'completed', 'terminal evidence remains visible for audit');

  const before = (await getPool().query(
    'select status,score,progress,completed_at,engine_state from hunt_v3.runs where id=$1',
    [terminal.runId],
  )).rows[0];
  const response = await reviewPhoto({
    mediaId: media.get('terminalPending')!,
    approved: true,
    reason: 'Reviewed after the run ended',
    requestId: randomUUID(),
    actor: 'maintenance test',
  });
  assert.deepEqual(
    { applied: response.applied, approved: response.approved, requestedApproval: response.requestedApproval, terminalStatus: response.terminalStatus },
    { applied: false, approved: false, requestedApproval: true, terminalStatus: 'completed' },
  );
  const afterRun = (await getPool().query(
    'select status,score,progress,completed_at,engine_state from hunt_v3.runs where id=$1',
    [terminal.runId],
  )).rows[0];
  assert.deepEqual(afterRun, before, 'terminal audit review cannot mutate or resurrect the completed result');
  const afterMedia = (await getPool().query(
    'select review_status,reviewed_at from hunt_v3.media where id=$1',
    [media.get('terminalPending')],
  )).rows[0];
  assert.equal(afterMedia.review_status, 'rejected');
  assert.ok(afterMedia.reviewed_at);
});
