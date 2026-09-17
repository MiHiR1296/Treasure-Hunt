import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { NextRequest } from 'next/server';
import type { PuzzleDefinition } from '../engine/puzzles/types';
import { calculateDistance } from '../utils/geolocation';
import { getPool, transaction } from './db';
import { ADMIN_COOKIE, authenticate, HttpError, PREVIEW_COOKIE, TEAM_COOKIE } from './security';
import { getTeamRecord, toTeamView } from './store';
import { lockMediaReferences, visibleMediaUrls } from './media-references';
import { assertPlayable } from './hunts';

const mediaDirectory = () => process.env.MEDIA_DIRECTORY || path.join(process.cwd(), '.data', 'media');
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
interface MediaRecord { id: string; hunt_id: string | null; team_id: string | null; checkpoint_id: string | null; node_id: string | null; kind: 'asset' | 'photo'; content_type: string; bytes: number; content_hash: string; storage_key: string; retention: string; expires_at: string | null; reviewed_at: string | null }
const publicMedia = (media: MediaRecord) => ({ id: media.id, url: `/api/v2/media/${media.id}`, contentType: media.content_type, bytes: media.bytes });

export async function prepareImage(input: Buffer): Promise<Buffer> {
  try {
    const image = sharp(input, { limitInputPixels: 40_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!['jpeg','png','webp','avif','heif'].includes(metadata.format || '')) throw new Error('Unsupported image');
    return await image.rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:82}).toBuffer();
  } catch { throw new HttpError(400, 'Use a JPEG, PNG, WebP, or AVIF image under 40 megapixels.'); }
}

function mediaType(input: Buffer, declared: string): string {
  const webm = input.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  const mp4 = input.subarray(4,8).toString('ascii') === 'ftyp';
  const mp3 = input.subarray(0,3).toString('ascii') === 'ID3' || (input[0] === 0xff && (input[1] & 0xe0) === 0xe0);
  const ogg = input.subarray(0,4).toString('ascii') === 'OggS';
  if (declared === 'video/mp4' && mp4) return 'video/mp4';
  if (declared === 'audio/mp4' && mp4) return 'audio/mp4';
  if (['video/webm','audio/webm'].includes(declared) && webm) return declared;
  if (declared === 'audio/mpeg' && mp3) return 'audio/mpeg';
  if (declared === 'audio/ogg' && ogg) return 'audio/ogg';
  throw new HttpError(400, 'Use a supported image, MP3, MP4, WebM, or Ogg file.');
}

async function saveMedia(input: { id: string; bytes: Buffer; contentType: string; kind: 'asset' | 'photo'; huntId?: string; teamId?: string; checkpointId?: string; nodeId?: string; retention?: 'after_review' | 'after_event' | 'keep' }) {
  if (!isUuid(input.id)) throw new HttpError(400, 'A valid upload request ID is required.');
  const contentHash = createHash('sha256').update(input.bytes).digest('hex');
  const existing = await getPool().query('select * from hunt_v2.media where id=$1', [input.id]);
  if (existing.rows[0]) {
    const row = existing.rows[0] as MediaRecord;
    if (row.content_hash !== contentHash || row.team_id !== (input.teamId ?? null) || row.kind !== input.kind || row.checkpoint_id !== (input.checkpointId ?? null) || row.node_id !== (input.nodeId ?? null)) throw new HttpError(409, 'This upload ID belongs to another file or task.');
    return publicMedia(row);
  }
  const key = `${input.id}-${randomUUID()}`;
  const filePath = path.join(mediaDirectory(), key);
  await mkdir(mediaDirectory(), { recursive: true, mode: 0o700 });
  await writeFile(filePath, input.bytes, { flag: 'wx', mode: 0o600 });
  try {
    const { rows } = await getPool().query(`insert into hunt_v2.media(id,hunt_id,team_id,checkpoint_id,node_id,kind,content_type,bytes,content_hash,storage_key,retention,expires_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,case when $6='photo' and $11='after_review' then now()+interval '7 days' else null end) on conflict do nothing returning *`,
    [input.id,input.huntId ?? null,input.teamId ?? null,input.checkpointId ?? null,input.nodeId ?? null,input.kind,input.contentType,input.bytes.length,contentHash,key,input.retention || 'keep']);
    if (!rows[0]) {
      await unlink(filePath);
      return saveMedia(input);
    }
    return publicMedia(rows[0]);
  } catch (error) { await unlink(filePath).catch(() => undefined); throw error; }
}

export async function uploadAsset(id: string, file: File) {
  if (!file.size || file.size > 20_000_000) throw new HttpError(413, 'Use a file smaller than 20 MB.');
  const original = Buffer.from(await file.arrayBuffer());
  const image = file.type.startsWith('image/');
  return saveMedia({ id, bytes: image ? await prepareImage(original) : original, contentType: image ? 'image/jpeg' : mediaType(original,file.type), kind:'asset' });
}

export async function uploadPhoto(teamId: string, input: { id: string; checkpointId: string; nodeId: string; file: File; location?: unknown }) {
  if (!input.file.size || input.file.size > 10_000_000 || !input.file.type.startsWith('image/')) throw new HttpError(413, 'Choose a photo smaller than 10 MB.');
  const team = await getTeamRecord(teamId);
  if (!team.is_preview) assertPlayable(team.status,team.definition);
  const checkpoint = team.definition.checkpoints.find(item => item.id === team.state.activeCheckpointId);
  const progress = checkpoint && team.state.checkpoints[checkpoint.id];
  const node = checkpoint?.flow.nodes.find(item => item.id === progress?.activeNodeId);
  if (checkpoint?.id !== input.checkpointId || node?.id !== input.nodeId || node.type !== 'verify_image') throw new HttpError(409, 'Your team has moved on. Refresh before submitting a photo.');
  if (node.location) {
    const location = input.location as { latitude?: number; longitude?: number; accuracyMeters?: number } | null;
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || !Number.isFinite(location.accuracyMeters) || Math.abs(location.latitude!) > 90 || Math.abs(location.longitude!) > 180 || location.accuracyMeters! < 0) throw new HttpError(400, 'Check your location before photographing this landmark.');
    if (location.accuracyMeters! > node.location.maxAccuracyMeters || calculateDistance(location.latitude!,location.longitude!,node.location.latitude,node.location.longitude) > node.location.radiusMeters) throw new HttpError(409, 'Get closer to the search area and try another location reading before sending your photo.');
  }
  const bytes = await prepareImage(Buffer.from(await input.file.arrayBuffer()));
  const retention = team.definition.settings?.photoRetention;
  return saveMedia({ id:input.id,bytes,contentType:'image/jpeg',kind:'photo',huntId:team.hunt_id,teamId,checkpointId:input.checkpointId,nodeId:input.nodeId,
    retention: retention === 'retain' ? 'keep' : retention === 'after_event' ? 'after_event' : 'after_review' });
}

async function readRecord(id: string): Promise<MediaRecord> {
  if (!isUuid(id)) throw new HttpError(404, 'Media not found.');
  const { rows } = await getPool().query('select * from hunt_v2.media where id=$1 and (expires_at is null or expires_at>now())', [id]);
  if (!rows[0]) throw new HttpError(404, 'This media is no longer available.');
  return rows[0];
}

export async function canReadMedia(request: NextRequest, media: MediaRecord) {
  const admin = request.cookies.get(ADMIN_COOKIE)?.value;
  if (admin) {
    try { await authenticate(admin,'admin'); return true; } catch { /* Try a valid player session next. */ }
  }
  const url = `/api/v2/media/${media.id}`;
  if (media.kind === 'asset') {
    const visible = await getPool().query(`select id from hunt_v2.hunts where not is_preview and status in ('ready','live','paused')
      and (definition->'theme'->>'coverUrl'=$1 or definition->'theme'->>'logoUrl'=$1) limit 1`, [url]);
    if (visible.rowCount) return true;
  }
  for (const cookieName of [TEAM_COOKIE,PREVIEW_COOKIE]) {
    const token = request.cookies.get(cookieName)?.value;
    if (!token) continue;
    try {
      const session = await authenticate(token,'team');
      if (media.kind === 'photo') { if (media.team_id === session.team_id) return true; continue; }
      const team = await getTeamRecord(session.team_id);
      if (visibleMediaUrls(toTeamView(team)).has(url)) return true;
    } catch { /* Continue checking the other independent session. */ }
  }
  return false;
}

export async function readMedia(request: NextRequest, id: string) {
  const media = await readRecord(id);
  if (!await canReadMedia(request, media)) throw new HttpError(403, 'This media is not available for your current task.');
  if (!/^[0-9a-f-]{73}$/i.test(media.storage_key)) throw new HttpError(404, 'Media not found.');
  let bytes: Buffer;
  try { bytes = await readFile(path.join(mediaDirectory(),media.storage_key)); }
  catch { throw new HttpError(404, 'This media is no longer available.'); }
  return { media, bytes };
}

export async function listMedia() {
  const { rows } = await getPool().query("select * from hunt_v2.media where kind='asset' and (expires_at is null or expires_at>now()) order by created_at desc limit 300");
  return rows.map(publicMedia);
}

export async function deleteAsset(id: string) {
  if (!isUuid(id)) throw new HttpError(400, 'Choose a valid media item.');
  const key = await transaction(async client => {
    await lockMediaReferences(client);
    const { rows } = await client.query("select storage_key from hunt_v2.media where id=$1 and kind='asset' for update", [id]);
    if (!rows[0]) return null;
    const reference = `%/api/v2/media/${id}%`;
    const used = await client.query(`select 1 from hunt_v2.hunt_versions where definition::text like $1
      union all select 1 from hunt_v2.drafts where definition::text like $1 limit 1`, [reference]);
    if (used.rowCount) throw new HttpError(409, 'This media is used by a saved draft or published event. Remove those references before deleting it.');
    await client.query('delete from hunt_v2.media where id=$1', [id]);
    return rows[0].storage_key as string;
  });
  if (key) await unlink(path.join(mediaDirectory(),key)).catch(() => undefined);
}

export async function makeJigsaw(mediaId: string, rows: number, columns: number): Promise<PuzzleDefinition> {
  if (![rows,columns].every(value => Number.isInteger(value) && value >= 2 && value <= 6)) throw new HttpError(400, 'Choose between 2 and 6 rows and columns.');
  const source = await readRecord(mediaId);
  if (source.kind !== 'asset' || source.content_type !== 'image/jpeg') throw new HttpError(400, 'Choose an image from the media library.');
  const size = 180;
  const image = await sharp(await readFile(path.join(mediaDirectory(),source.storage_key))).resize(columns * size,rows * size,{fit:'cover'}).toBuffer();
  const pieces: { id: string; imageUrl: string; alt: string }[] = [];
  const solution: string[] = [];
  for (let row=0;row<rows;row++) for (let column=0;column<columns;column++) {
    const id = randomUUID();
    const bytes = await sharp(image).extract({left:column*size,top:row*size,width:size,height:size}).jpeg({quality:85}).toBuffer();
    const media = await saveMedia({id,bytes,contentType:'image/jpeg',kind:'asset'});
    pieces.push({id,imageUrl:media.url,alt:'Puzzle piece'}); solution.push(id);
  }
  // Display order is independent of correct placement; private solution remains server-side.
  pieces.sort((a,b) => a.id.localeCompare(b.id));
  return { type:'jigsaw',rows,columns,pieces,solution };
}

export async function markPhotoReviewed(teamId: string, mediaId: string) {
  const { rows } = await getPool().query(`update hunt_v2.media set reviewed_at=now(),expires_at=case when retention='after_review' then now() else expires_at end
    where id=$1 and team_id=$2 and kind='photo' returning *`, [mediaId,teamId]);
  if (rows[0]?.retention === 'after_review') await unlink(path.join(mediaDirectory(),rows[0].storage_key)).catch(() => undefined);
}

export async function cleanupMedia() {
  const { rows } = await getPool().query(`select m.* from hunt_v2.media m left join hunt_v2.hunts h on h.id=m.hunt_id
    left join hunt_v2.teams t on t.id=m.team_id
    left join hunt_v2.hunt_versions v on v.hunt_id=t.hunt_id and v.version=(t.state->>'definitionVersion')::int
    where (m.expires_at is not null and m.expires_at<=now()) or (m.retention='after_event' and
      (h.status in ('ended','archived') or (v.definition->'settings'->>'endsAt')::timestamptz<=now()))`);
  for (const row of rows) {
    await unlink(path.join(mediaDirectory(),row.storage_key)).catch(() => undefined);
    await getPool().query('delete from hunt_v2.media where id=$1', [row.id]);
  }
  return rows.length;
}

export async function deleteHunt(huntId: string, confirmation: string) {
  if (confirmation !== huntId) throw new HttpError(400, 'Type the hunt ID to confirm deleting its event data.');
  const files = await transaction(async client => {
    const hunt = await client.query('select status from hunt_v2.hunts where id=$1 for update', [huntId]);
    if (!hunt.rows[0]) throw new HttpError(404, 'Hunt not found.');
    if (!['archived','ended'].includes(hunt.rows[0].status)) throw new HttpError(409, 'End or archive the hunt before deleting its data.');
    const media = await client.query('select storage_key from hunt_v2.media where hunt_id=$1', [huntId]);
    await client.query('delete from hunt_v2.hunts where id=$1', [huntId]);
    await client.query('delete from hunt_v2.drafts where id=$1', [huntId]);
    await client.query('delete from hunt_v2.admin_events where hunt_id=$1', [huntId]);
    return media.rows;
  });
  for (const file of files) await unlink(path.join(mediaDirectory(),file.storage_key)).catch(() => undefined);
}
