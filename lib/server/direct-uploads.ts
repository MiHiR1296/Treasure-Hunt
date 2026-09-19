import { randomUUID } from 'node:crypto';
import { getPool } from './db';
import { canonicalJson, digest, HttpError, rateLimit } from './security';
import { uploadAsset, uploadPhoto, validatePhotoTask } from './media';
import { createMediaUploadUrl, mediaBackend, readIncomingMedia, removeIncomingMedia } from './media-storage.mjs';

type Owner = { kind: 'asset' } | { kind: 'photo'; teamId: string };
type Metadata = { size: number; contentType: string; sha256: string; checkpointId?: string; nodeId?: string; location?: unknown };
type Ticket = { id: string; owner_key: string; kind: 'asset' | 'photo'; storage_key: string; payload_hash: string; metadata: Metadata; expires_at: Date; completed_at: Date | null };
const ownerKey = (owner: Owner) => owner.kind === 'asset' ? 'organizer' : `team:${owner.teamId}`;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const types = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/heif', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg', 'video/mp4', 'video/webm']);

async function ticket(id: unknown, owner: Owner): Promise<Ticket> {
  if (!uuid(id)) throw new HttpError(400, 'A valid upload request ID is required.');
  const { rows } = await getPool().query('select * from hunt_v2.media_uploads where id=$1', [id]);
  const result = rows[0] as Ticket | undefined;
  if (!result || result.owner_key !== ownerKey(owner) || result.kind !== owner.kind) throw new HttpError(403, 'This upload does not belong to your session.');
  return result;
}

async function completedMedia(row: Ticket, owner: Owner) {
  const { rows } = await getPool().query(`select id,kind,team_id,content_type,bytes from hunt_v2.media
    where id=$1 and (expires_at is null or expires_at>now())`, [row.id]);
  const media = rows[0];
  if (!media || media.kind !== owner.kind || media.team_id !== (owner.kind === 'photo' ? owner.teamId : null)) {
    throw new HttpError(410, 'This uploaded file is no longer available. Choose the file again.');
  }
  return { media: { id: media.id, url: `/api/v2/media/${media.id}`, contentType: media.content_type, bytes: media.bytes } };
}

export async function prepareDirectUpload(owner: Owner, body: Record<string, unknown>) {
  if (mediaBackend() === 'filesystem') return { mode: 'multipart' as const };
  if (!uuid(body.requestId)) throw new HttpError(400, 'A valid upload request ID is required.');
  const size = Number(body.size);
  const contentType = String(body.contentType || '');
  const sha256 = String(body.sha256 || '');
  const limit = owner.kind === 'asset' ? 20_000_000 : 10_000_000;
  if (!Number.isInteger(size) || size <= 0 || size > limit) throw new HttpError(413, `Choose a file smaller than ${limit / 1_000_000} MB.`);
  if (!types.has(contentType) || (owner.kind === 'photo' && !contentType.startsWith('image/'))) throw new HttpError(400, 'Choose a supported image, audio, or video file.');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new HttpError(400, 'The upload needs a valid file checksum.');
  const metadata: Metadata = { size, contentType, sha256 };
  if (owner.kind === 'photo') {
    if (body.teamId !== owner.teamId) throw new HttpError(409, 'Your team session changed. Refresh before uploading.');
    metadata.checkpointId = String(body.checkpointId || ''); metadata.nodeId = String(body.nodeId || '');
    if (body.location !== undefined) metadata.location = body.location;
    await validatePhotoTask(owner.teamId, { checkpointId: metadata.checkpointId, nodeId: metadata.nodeId, location: metadata.location });
  }
  await rateLimit(`direct-upload:${ownerKey(owner)}`, 80);
  const payloadHash = digest(canonicalJson(metadata));
  const pool = getPool();
  await pool.query(`insert into hunt_v2.media_uploads(id,owner_key,kind,storage_key,payload_hash,metadata)
    values($1,$2,$3,$4,$5,$6) on conflict do nothing`, [body.requestId, ownerKey(owner), owner.kind, `${body.requestId}-${randomUUID()}`, payloadHash, metadata]);
  const row = await ticket(body.requestId, owner);
  if (row.payload_hash !== payloadHash) throw new HttpError(409, 'This upload ID belongs to another file or task. Choose the file again.');
  if (row.completed_at) return completedMedia(row, owner);
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new HttpError(410, 'This upload expired. Choose the file again.');
  // Signing again extends the provider token lifetime; cleanup must follow it.
  await pool.query("update hunt_v2.media_uploads set cleanup_after=now()+interval '125 minutes' where id=$1", [row.id]);
  return { mode: 'direct' as const, uploadUrl: await createMediaUploadUrl(row.storage_key) };
}

export async function completeDirectUpload(owner: Owner, id: unknown) {
  const row = await ticket(id, owner);
  if (row.completed_at) return completedMedia(row, owner);
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new HttpError(410, 'This upload expired. Choose the file again.');
  const bytes = await readIncomingMedia(row.storage_key, row.metadata.size);
  if (!bytes) {
    // A concurrent retry may have completed and removed the temporary object.
    const latest = await ticket(id, owner);
    if (latest.completed_at) return completedMedia(latest, owner);
    throw new HttpError(503, 'The file has not finished uploading. Retry the same file.');
  }
  if (bytes.length !== row.metadata.size || digest(bytes) !== row.metadata.sha256) throw new HttpError(400, 'The uploaded file did not match. Choose the file again.');
  const file = new File([new Uint8Array(bytes)], 'upload', { type: row.metadata.contentType });
  // The existing validators inspect bytes, strip image metadata, check GPS/task
  // state again, and create only one permanent media record for this request ID.
  const media = owner.kind === 'asset' ? await uploadAsset(row.id, file) : await uploadPhoto(owner.teamId, {
    id: row.id, file, checkpointId: row.metadata.checkpointId!, nodeId: row.metadata.nodeId!, location: row.metadata.location,
  });
  await getPool().query('update hunt_v2.media_uploads set completed_at=now() where id=$1', [row.id]);
  await removeIncomingMedia(row.storage_key).catch(() => undefined);
  return { media };
}
