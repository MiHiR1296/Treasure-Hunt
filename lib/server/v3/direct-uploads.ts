import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool, transaction } from '../db';
import { createMediaUploadUrl, mediaBackend, readIncomingMedia, removeIncomingMedia } from '../media-storage.mjs';
import { canonicalJson, digest, HttpError } from '../security';
import { lockV3Hunt, lockV3Team } from './locking';
import { activePhotoTask, uploadV3Photo } from './media';
import { assertPublishedIntegrityPolicy } from './runtime';
import { rateLimitV3 } from './security';

type Owner = { teamId: string; memberId: string };
type ClientMetadata = {
  size: number;
  contentType: string;
  sha256: string;
  checkpointId: string;
  nodeId: string;
  mechanicId?: string;
  laneId?: string;
  location?: unknown;
};
type Metadata = ClientMetadata & { taskStartedAt: string };
type Ticket = {
  id: string;
  owner_key: string;
  hunt_id: string;
  team_id: string;
  run_id: string;
  member_id: string;
  kind: 'photo';
  storage_key: string;
  payload_hash: string;
  metadata: Metadata;
  expires_at: Date;
  completed_at: Date | null;
  media_id: string | null;
  unexpired: boolean;
};

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const ownerKey = (owner: Owner) => `team:${owner.teamId}:member:${owner.memberId}`;
const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif']);

function parseMetadata(body: Record<string, unknown>): ClientMetadata {
  const size = Number(body.size);
  const contentType = String(body.contentType || '');
  const sha256 = String(body.sha256 || '');
  if (!Number.isInteger(size) || size <= 0 || size > 10_000_000) throw new HttpError(413, 'Choose a photo smaller than 10 MB.');
  if (!supportedImageTypes.has(contentType)) throw new HttpError(400, 'Choose a supported image.');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new HttpError(400, 'The upload needs a valid checksum.');
  const metadata: ClientMetadata = {
    size,
    contentType,
    sha256,
    checkpointId: String(body.checkpointId || ''),
    nodeId: String(body.nodeId || ''),
    ...(typeof body.mechanicId === 'string' && body.mechanicId ? { mechanicId: body.mechanicId } : {}),
    ...(typeof body.laneId === 'string' && body.laneId ? { laneId: body.laneId } : {}),
    ...(body.location !== undefined ? { location: body.location } : {}),
  };
  if (!metadata.checkpointId || !metadata.nodeId) throw new HttpError(400, 'Choose the active photo task before uploading.');
  return metadata;
}

function clientMetadata(metadata: Metadata): ClientMetadata {
  return {
    size: metadata.size,
    contentType: metadata.contentType,
    sha256: metadata.sha256,
    checkpointId: metadata.checkpointId,
    nodeId: metadata.nodeId,
    ...(metadata.mechanicId ? { mechanicId: metadata.mechanicId } : {}),
    ...(metadata.laneId ? { laneId: metadata.laneId } : {}),
    ...(Object.hasOwn(metadata, 'location') ? { location: metadata.location } : {}),
  };
}

function bindingHash(input: {
  id: string;
  ownerKey: string;
  huntId: string;
  teamId: string;
  runId: string;
  memberId: string;
  storageKey: string;
  expiresAt: string;
  metadata: Metadata;
}) {
  return digest(canonicalJson({ ...input, kind: 'photo' }));
}

function assertTicketIntegrity(row: Ticket) {
  const metadata = row.metadata;
  const expiresAt = new Date(row.expires_at);
  if (!metadata || typeof metadata !== 'object' || !Number.isInteger(metadata.size) || metadata.size <= 0 || metadata.size > 10_000_000 ||
    !supportedImageTypes.has(metadata.contentType) || !/^[a-f0-9]{64}$/.test(metadata.sha256) || !metadata.checkpointId || !metadata.nodeId ||
    !metadata.taskStartedAt || !Number.isFinite(Date.parse(metadata.taskStartedAt)) || !Number.isFinite(expiresAt.getTime())) {
    throw new HttpError(409, 'This upload receipt is invalid. Choose the file again.');
  }
  const expected = bindingHash({
    id: row.id,
    ownerKey: row.owner_key,
    huntId: row.hunt_id,
    teamId: row.team_id,
    runId: row.run_id,
    memberId: row.member_id,
    storageKey: row.storage_key,
    expiresAt: expiresAt.toISOString(),
    metadata,
  });
  if (row.payload_hash !== expected) throw new HttpError(409, 'This upload receipt changed after it was prepared. Choose the file again.');
}

async function findTicket(id: unknown, owner: Owner, client: PoolClient | ReturnType<typeof getPool> = getPool(), required = true): Promise<Ticket | undefined> {
  if (!uuid(id)) throw new HttpError(400, 'A valid upload request ID is required.');
  const row = (await client.query(
    `select upload.*,upload.expires_at>clock_timestamp() as unexpired
      from hunt_v3.media_uploads upload where upload.id=$1`,
    [id],
  )).rows[0] as Ticket | undefined;
  if (!row && !required) return undefined;
  if (!row || row.owner_key !== ownerKey(owner) || row.team_id !== owner.teamId || row.member_id !== owner.memberId || row.kind !== 'photo') {
    throw new HttpError(403, 'This upload does not belong to your session.');
  }
  assertTicketIntegrity(row);
  return row;
}

async function completedMedia(row: Ticket, owner: Owner, client: PoolClient | ReturnType<typeof getPool> = getPool()) {
  const pinned = (await client.query(
    `select version.definition from hunt_v3.runs run
      join hunt_v3.hunt_versions version on version.hunt_id=run.hunt_id and version.version=run.hunt_version
      where run.id=$1 and run.team_id=$2 and run.hunt_id=$3`,
    [row.run_id, row.team_id, row.hunt_id],
  )).rows[0];
  if (!pinned) throw new HttpError(410, 'This uploaded file is no longer available. Choose it again.');
  assertPublishedIntegrityPolicy(pinned.definition?.settings);
  const media = (await client.query(
    `select media.id,media.content_type,media.bytes
      from hunt_v3.media media
      join hunt_v3.run_members participant
        on participant.run_id=media.run_id and participant.team_id=media.team_id and participant.member_id=media.member_id
      where media.id=$1 and media.hunt_id=$2 and media.team_id=$3 and media.run_id=$4 and media.member_id=$5
        and participant.member_id=$6 and media.kind='photo'
        and media.checkpoint_id=$7 and media.node_id=$8
        and media.parallel_mechanic_id is not distinct from $9
        and media.parallel_lane_id is not distinct from $10
        and media.task_started_at=$11::timestamptz
        and (media.expires_at is null or media.expires_at>clock_timestamp())`,
    [row.media_id ?? row.id, row.hunt_id, owner.teamId, row.run_id, owner.memberId, owner.memberId,
      row.metadata.checkpointId, row.metadata.nodeId, row.metadata.mechanicId ?? null, row.metadata.laneId ?? null,
      row.metadata.taskStartedAt],
  )).rows[0];
  if (!media) throw new HttpError(410, 'This uploaded file is no longer available. Choose it again.');
  return { media: { id: media.id, url: `/api/v3/media/${media.id}`, contentType: media.content_type, bytes: media.bytes } };
}

async function activeTicketTask(
  row: Ticket,
  owner: Owner,
  client: PoolClient | ReturnType<typeof getPool> = getPool(),
) {
  return activePhotoTask(owner.teamId, owner.memberId, {
    ...clientMetadata(row.metadata),
    expectedRunId: row.run_id,
    expectedTaskStartedAt: row.metadata.taskStartedAt,
  }, client);
}

function translateDatabaseError(error: unknown): never {
  const databaseError = error as { constraint?: string };
  if (databaseError.constraint === 'media_upload_ticket_expired') {
    throw new HttpError(410, 'This upload expired. Choose the file again.');
  }
  if (databaseError.constraint === 'media_upload_ticket_binding') {
    throw new HttpError(409, 'This upload no longer matches its prepared run and task. Choose the file again.');
  }
  if (databaseError.constraint === 'media_task_epoch_binding') {
    throw new HttpError(409, 'This upload no longer matches its active task. Choose the file again.');
  }
  throw error;
}

export async function prepareV3DirectUpload(owner: Owner, body: Record<string, unknown>) {
  if (!uuid(body.requestId)) throw new HttpError(400, 'A valid upload request ID is required.');
  if (body.teamId !== owner.teamId) throw new HttpError(409, 'Your team session changed. Refresh before uploading.');
  const requestedMetadata = parseMetadata(body);
  const existing = await findTicket(body.requestId, owner, getPool(), false);
  if (existing) {
    if (canonicalJson(clientMetadata(existing.metadata)) !== canonicalJson(requestedMetadata)) {
      throw new HttpError(409, 'This upload ID belongs to another file or task. Choose the file again.');
    }
    if (existing.completed_at) return completedMedia(existing, owner);
    if (!existing.unexpired) throw new HttpError(410, 'This upload expired. Choose the file again.');
    await activeTicketTask(existing, owner);
    await rateLimitV3(`direct-upload:${ownerKey(owner)}`, 80);
    await getPool().query("update hunt_v3.media_uploads set cleanup_after=greatest(cleanup_after,now()+interval '125 minutes') where id=$1", [existing.id]);
    return { mode: 'direct' as const, uploadUrl: await createMediaUploadUrl(existing.storage_key) };
  }

  const task = await activePhotoTask(owner.teamId, owner.memberId, requestedMetadata);
  if (mediaBackend() === 'filesystem') return { mode: 'multipart' as const };
  await rateLimitV3(`direct-upload:${ownerKey(owner)}`, 80);
  const id = body.requestId;
  const storageKey = `${id}-${randomUUID()}`;
  await transaction(async client => {
    // Ticket insertion has four parent FKs. Lock them explicitly in the same
    // parent-to-child order as organizer controls before PostgreSQL's FK
    // triggers acquire any implicit row locks.
    if (!await lockV3Hunt(client, task.hunt_id)) throw new HttpError(409, 'This hunt is no longer available.');
    if (!await lockV3Team(client, task.hunt_id, owner.teamId)) {
      throw new HttpError(409, 'This team is no longer available.');
    }
    const lockedRun = await client.query(
      'select id from hunt_v3.runs where id=$1 and team_id=$2 and hunt_id=$3 for share',
      [task.id, owner.teamId, task.hunt_id],
    );
    if (!lockedRun.rowCount) throw new HttpError(409, 'This run is no longer available.');
    const lockedMember = await client.query(
      'select id from hunt_v3.team_members where id=$1 and team_id=$2 for share',
      [owner.memberId, owner.teamId],
    );
    if (!lockedMember.rowCount) throw new HttpError(409, 'This player is no longer on the team.');
    const lockedParticipant = await client.query(
      'select member_id from hunt_v3.run_members where run_id=$1 and team_id=$2 and member_id=$3 for share',
      [task.id, owner.teamId, owner.memberId],
    );
    if (!lockedParticipant.rowCount) throw new HttpError(409, 'This player is not part of the run.');

    const currentTask = await activePhotoTask(owner.teamId, owner.memberId, {
      ...requestedMetadata,
      expectedRunId: task.id,
      expectedTaskStartedAt: task.taskStartedAt,
    }, client);
    const expiresAt = new Date((await client.query(
      "select clock_timestamp()+interval '15 minutes' as expires_at",
    )).rows[0].expires_at).toISOString();
    const metadata: Metadata = { ...requestedMetadata, taskStartedAt: currentTask.taskStartedAt };
    const payloadHash = bindingHash({
      id,
      ownerKey: ownerKey(owner),
      huntId: currentTask.hunt_id,
      teamId: owner.teamId,
      runId: currentTask.id,
      memberId: owner.memberId,
      storageKey,
      expiresAt,
      metadata,
    });
    await client.query(
      `insert into hunt_v3.media_uploads(
        id,owner_key,hunt_id,team_id,run_id,member_id,kind,storage_key,payload_hash,metadata,expires_at,cleanup_after)
        values($1,$2,$3,$4,$5,$6,'photo',$7,$8,$9,$10::timestamptz,$10::timestamptz+interval '110 minutes')
        on conflict do nothing`,
      [id, ownerKey(owner), currentTask.hunt_id, owner.teamId, currentTask.id, owner.memberId,
        storageKey, payloadHash, metadata, expiresAt],
    );
  });
  const row = (await findTicket(id, owner))!;
  if (canonicalJson(clientMetadata(row.metadata)) !== canonicalJson(requestedMetadata)) {
    throw new HttpError(409, 'This upload ID belongs to another file or task. Choose the file again.');
  }
  if (row.completed_at) return completedMedia(row, owner);
  if (!row.unexpired) throw new HttpError(410, 'This upload expired. Choose the file again.');
  await activeTicketTask(row, owner);
  return { mode: 'direct' as const, uploadUrl: await createMediaUploadUrl(row.storage_key) };
}

export async function completeV3DirectUpload(owner: Owner, id: unknown) {
  if (!uuid(id)) throw new HttpError(400, 'A valid upload request ID is required.');
  try {
    let row = (await findTicket(id, owner))!;
    if (row.completed_at) return completedMedia(row, owner);
    if (!row.unexpired) throw new HttpError(410, 'This upload expired. Choose the file again.');
    await activeTicketTask(row, owner);

    // Provider reads and image decoding deliberately happen without a checked
    // out PostgreSQL client. Final binding is revalidated in the short media
    // materialization transaction below.
    const bytes = await readIncomingMedia(row.storage_key, row.metadata.size);
    if (!bytes) {
      row = (await findTicket(id, owner))!;
      if (row.completed_at) return completedMedia(row, owner);
      throw new HttpError(503, 'The file has not finished uploading. Retry the same file.');
    }
    if (bytes.length !== row.metadata.size || digest(bytes) !== row.metadata.sha256) {
      throw new HttpError(400, 'The uploaded file did not match. Choose it again.');
    }
    row = (await findTicket(id, owner))!;
    if (row.completed_at) return completedMedia(row, owner);
    if (!row.unexpired) throw new HttpError(410, 'This upload expired. Choose the file again.');
    await activeTicketTask(row, owner);

    const file = new File([new Uint8Array(bytes)], 'upload', { type: row.metadata.contentType });
    const media = await uploadV3Photo(owner.teamId, owner.memberId, {
      id: row.id,
      file,
      checkpointId: row.metadata.checkpointId,
      nodeId: row.metadata.nodeId,
      mechanicId: row.metadata.mechanicId,
      laneId: row.metadata.laneId,
      location: row.metadata.location,
      expectedRunId: row.run_id,
      expectedTaskStartedAt: row.metadata.taskStartedAt,
    });

    const completed = await transaction(async client => {
      // The media insert trigger normally completes the receipt in the same
      // statement. This conditional update also recovers an older committed
      // media row if a process died between its insert and receipt update.
      await client.query(
        `update hunt_v3.media_uploads upload
          set media_id=$1,completed_at=clock_timestamp()
          where upload.id=$2 and upload.completed_at is null and upload.expires_at>clock_timestamp()
            and exists(
              select 1 from hunt_v3.media media
              where media.id=$1 and media.hunt_id=upload.hunt_id and media.team_id=upload.team_id
                and media.run_id=upload.run_id and media.member_id=upload.member_id and media.kind=upload.kind
                and media.checkpoint_id=upload.metadata->>'checkpointId'
                and media.node_id=upload.metadata->>'nodeId'
                and media.task_started_at=(upload.metadata->>'taskStartedAt')::timestamptz
                and media.parallel_mechanic_id is not distinct from nullif(upload.metadata->>'mechanicId','')
                and media.parallel_lane_id is not distinct from nullif(upload.metadata->>'laneId','')
            )`,
        [media.id, row.id],
      );
      return (await findTicket(id, owner, client))!;
    });
    if (!completed.completed_at || completed.media_id !== media.id) {
      if (!completed.unexpired) throw new HttpError(410, 'This upload expired. Choose the file again.');
      throw new HttpError(409, 'This upload no longer matches its prepared run and task. Choose the file again.');
    }
    await removeIncomingMedia(row.storage_key).catch(() => undefined);
    return { media };
  } catch (error) {
    return translateDatabaseError(error);
  }
}
