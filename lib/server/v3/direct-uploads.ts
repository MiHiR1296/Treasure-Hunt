import { randomUUID } from 'node:crypto';
import { getPool } from '../db';
import { createMediaUploadUrl, mediaBackend, readIncomingMedia, removeIncomingMedia } from '../media-storage.mjs';
import { canonicalJson, digest, HttpError } from '../security';
import { activePhotoTask, uploadV3Photo } from './media';
import { rateLimitV3 } from './security';

type Owner = { teamId: string; memberId: string };
type Metadata = {
  size: number; contentType: string; sha256: string; checkpointId: string; nodeId: string;
  mechanicId?: string; laneId?: string; location?: unknown;
};
type Ticket = {
  id: string; owner_key: string; hunt_id: string; team_id: string; run_id: string; member_id: string;
  kind: 'photo'; storage_key: string; payload_hash: string; metadata: Metadata; expires_at: Date; completed_at: Date | null; media_id: string | null;
};
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const ownerKey = (owner: Owner) => `team:${owner.teamId}:member:${owner.memberId}`;

async function ticket(id: unknown, owner: Owner): Promise<Ticket> {
  if (!uuid(id)) throw new HttpError(400, 'A valid upload request ID is required.');
  const row = (await getPool().query('select * from hunt_v3.media_uploads where id=$1', [id])).rows[0] as Ticket | undefined;
  if (!row || row.owner_key !== ownerKey(owner) || row.team_id !== owner.teamId || row.member_id !== owner.memberId || row.kind !== 'photo') {
    throw new HttpError(403, 'This upload does not belong to your session.');
  }
  return row;
}

async function completedMedia(row: Ticket, owner: Owner) {
  const media = (await getPool().query(
    `select id,content_type,bytes from hunt_v3.media where id=$1 and team_id=$2 and member_id=$3 and kind='photo'
      and (expires_at is null or expires_at>now())`,
    [row.media_id ?? row.id, owner.teamId, owner.memberId],
  )).rows[0];
  if (!media) throw new HttpError(410, 'This uploaded file is no longer available. Choose it again.');
  return { media: { id: media.id, url: `/api/v3/media/${media.id}`, contentType: media.content_type, bytes: media.bytes } };
}

export async function prepareV3DirectUpload(owner: Owner, body: Record<string, unknown>) {
  if (!uuid(body.requestId)) throw new HttpError(400, 'A valid upload request ID is required.');
  const size = Number(body.size), contentType = String(body.contentType || ''), sha256 = String(body.sha256 || '');
  if (!Number.isInteger(size) || size <= 0 || size > 10_000_000) throw new HttpError(413, 'Choose a photo smaller than 10 MB.');
  if (!contentType.startsWith('image/') || !['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif'].includes(contentType)) throw new HttpError(400, 'Choose a supported image.');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new HttpError(400, 'The upload needs a valid checksum.');
  const metadata: Metadata = {
    size, contentType, sha256,
    checkpointId: String(body.checkpointId || ''),
    nodeId: String(body.nodeId || ''),
    ...(typeof body.mechanicId === 'string' && body.mechanicId ? { mechanicId: body.mechanicId } : {}),
    ...(typeof body.laneId === 'string' && body.laneId ? { laneId: body.laneId } : {}),
    ...(body.location !== undefined ? { location: body.location } : {}),
  };
  if (body.teamId !== owner.teamId) throw new HttpError(409, 'Your team session changed. Refresh before uploading.');
  const task = await activePhotoTask(owner.teamId, owner.memberId, metadata);
  if (mediaBackend() === 'filesystem') return { mode: 'multipart' as const };
  await rateLimitV3(`direct-upload:${ownerKey(owner)}`, 80);
  const payloadHash = digest(canonicalJson(metadata));
  await getPool().query(
    `insert into hunt_v3.media_uploads(
      id,owner_key,hunt_id,team_id,run_id,member_id,kind,storage_key,payload_hash,metadata)
      values($1,$2,$3,$4,$5,$6,'photo',$7,$8,$9) on conflict do nothing`,
    [body.requestId, ownerKey(owner), task.hunt_id, owner.teamId, task.id, owner.memberId,
      `${body.requestId}-${randomUUID()}`, payloadHash, metadata],
  );
  const row = await ticket(body.requestId, owner);
  if (row.payload_hash !== payloadHash) throw new HttpError(409, 'This upload ID belongs to another file or task. Choose the file again.');
  if (row.completed_at) return completedMedia(row, owner);
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new HttpError(410, 'This upload expired. Choose the file again.');
  await getPool().query("update hunt_v3.media_uploads set cleanup_after=now()+interval '125 minutes' where id=$1", [row.id]);
  return { mode: 'direct' as const, uploadUrl: await createMediaUploadUrl(row.storage_key) };
}

export async function completeV3DirectUpload(owner: Owner, id: unknown) {
  const row = await ticket(id, owner);
  if (row.completed_at) return completedMedia(row, owner);
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new HttpError(410, 'This upload expired. Choose the file again.');
  const bytes = await readIncomingMedia(row.storage_key, row.metadata.size);
  if (!bytes) {
    const latest = await ticket(id, owner);
    if (latest.completed_at) return completedMedia(latest, owner);
    throw new HttpError(503, 'The file has not finished uploading. Retry the same file.');
  }
  if (bytes.length !== row.metadata.size || digest(bytes) !== row.metadata.sha256) throw new HttpError(400, 'The uploaded file did not match. Choose it again.');
  const file = new File([new Uint8Array(bytes)], 'upload', { type: row.metadata.contentType });
  const media = await uploadV3Photo(owner.teamId, owner.memberId, {
    id: row.id,
    file,
    checkpointId: row.metadata.checkpointId,
    nodeId: row.metadata.nodeId,
    mechanicId: row.metadata.mechanicId,
    laneId: row.metadata.laneId,
    location: row.metadata.location,
  });
  await getPool().query('update hunt_v3.media_uploads set media_id=$1,completed_at=now() where id=$2', [media.id, row.id]);
  await removeIncomingMedia(row.storage_key).catch(() => undefined);
  return { media };
}
