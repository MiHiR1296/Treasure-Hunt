import { createHash, randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { distanceMeters, getPlayerView } from '../../engine';
import type { GameState } from '../../engine/types';
import { playability } from '../../engine/session';
import type { ResolvedRunPlan, V3Definition } from '../../v3/types';
import { getPool } from '../db';
import { prepareImage } from '../media';
import { readMediaBytes, removeMediaBytes, writeMediaBytes } from '../media-storage.mjs';
import { HttpError } from '../security';
import { materializeRunDefinition, materializeRunParallelMechanics } from './runtime';
import { authenticateV3, rateLimitV3, V3_ADMIN_COOKIE, V3_TEAM_COOKIE } from './security';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

type V3MediaRecord = {
  id: string;
  hunt_id: string;
  team_id: string | null;
  run_id: string | null;
  member_id: string | null;
  checkpoint_id: string | null;
  node_id: string | null;
  parallel_mechanic_id: string | null;
  parallel_lane_id: string | null;
  kind: 'asset' | 'photo';
  content_type: string;
  bytes: number;
  content_hash: string;
  storage_key: string;
  review_status: 'pending' | 'approved' | 'rejected';
  retention: 'after_review' | 'after_event' | 'keep';
  expires_at: string | null;
};

const publicMedia = (media: V3MediaRecord) => ({ id: media.id, url: `/api/v3/media/${media.id}`, contentType: media.content_type, bytes: media.bytes });

type PhotoTaskInput = {
  checkpointId: string;
  nodeId: string;
  mechanicId?: string;
  laneId?: string;
  location?: unknown;
};

export async function activePhotoTask(teamId: string, memberId: string, input: PhotoTaskInput) {
  const row = (await getPool().query(
    `select r.id,r.hunt_id,r.engine_state,r.route_plan,v.definition,h.status as hunt_status,clock_timestamp() as now
      from hunt_v3.runs r join hunt_v3.hunt_versions v on v.hunt_id=r.hunt_id and v.version=r.hunt_version
      join hunt_v3.hunts h on h.id=r.hunt_id join hunt_v3.teams t on t.id=r.team_id and t.status='active'
      join hunt_v3.run_members m on m.run_id=r.id and m.member_id=$2
      join hunt_v3.team_members tm on tm.team_id=r.team_id and tm.id=$2 and tm.status='active'
      where r.team_id=$1 and r.status='active' order by r.run_number desc limit 1`,
    [teamId, memberId],
  )).rows[0] as ({ id: string; hunt_id: string; engine_state: GameState; route_plan: ResolvedRunPlan; definition: V3Definition; hunt_status: string; now: string } | undefined);
  if (!row) throw new HttpError(409, 'Start or resume a run before uploading a photo.');
  const definition = materializeRunDefinition(row.definition, row.route_plan);
  const clock = playability(definition, row.engine_state, row.hunt_status, new Date(row.now).toISOString());
  if (!clock.allowed) throw new HttpError(409, clock.message || 'This hunt is not open for play.');
  const checkpoint = definition.checkpoints.find(candidate => candidate.id === row.engine_state.activeCheckpointId);
  const progress = checkpoint && row.engine_state.checkpoints[checkpoint.id];
  const node = checkpoint?.flow.nodes.find(candidate => candidate.id === progress?.activeNodeId);
  if (checkpoint?.id !== input.checkpointId || node?.id !== input.nodeId) {
    throw new HttpError(409, 'Your team has moved on. Refresh before submitting a photo.');
  }
  let expectedLocation;
  if (input.mechanicId || input.laneId) {
    if (!input.mechanicId || !input.laneId) throw new HttpError(400, 'Choose both the linked task and photo lane.');
    const mechanic = materializeRunParallelMechanics(row.definition, row.route_plan).find(candidate => candidate.id === input.mechanicId);
    const lane = mechanic?.lanes.find(candidate => candidate.id === input.laneId);
    if (!mechanic || mechanic.checkpointId !== checkpoint.id || mechanic.nodeId !== node.id || !lane || lane.type !== 'photo') {
      throw new HttpError(409, 'This linked photo lane is not active. Refresh before submitting a photo.');
    }
    expectedLocation = lane.location;
  } else {
    if (node.type !== 'verify_image') throw new HttpError(409, 'This task is not accepting a standalone photo.');
    expectedLocation = node.location;
  }
  if (expectedLocation) {
    const location = input.location as { latitude?: unknown; longitude?: unknown; accuracyMeters?: unknown } | null;
    if (!location || ![location.latitude, location.longitude, location.accuracyMeters].every(Number.isFinite)) throw new HttpError(400, 'Check your location before photographing this landmark.');
    const latitude = Number(location.latitude), longitude = Number(location.longitude), accuracy = Number(location.accuracyMeters);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0 || accuracy > expectedLocation.maxAccuracyMeters ||
      distanceMeters(latitude, longitude, expectedLocation.latitude, expectedLocation.longitude) > expectedLocation.radiusMeters) {
      throw new HttpError(409, 'Get closer to the search area and try another location reading before sending your photo.');
    }
  }
  return { ...row, definition, node, parallelMechanicId: input.mechanicId ?? null, parallelLaneId: input.laneId ?? null };
}

export async function uploadV3Photo(teamId: string, memberId: string, input: PhotoTaskInput & { id: string; file: File }) {
  if (!uuid(input.id)) throw new HttpError(400, 'A valid upload request ID is required.');
  if (!input.file.size || input.file.size > 10_000_000 || !input.file.type.startsWith('image/')) throw new HttpError(413, 'Choose a photo smaller than 10 MB.');
  await rateLimitV3(`photo-upload:member:${memberId}`, 40);
  await rateLimitV3(`photo-upload:team:${teamId}`, 120);
  const task = await activePhotoTask(teamId, memberId, input);
  const quota = (await getPool().query(
    `select count(*) filter(where review_status='pending')::int as pending,
      count(*) filter(where created_at>now()-interval '1 hour')::int as recent_count,
      coalesce(sum(bytes) filter(where created_at>now()-interval '1 hour'),0)::bigint as recent_bytes
      from hunt_v3.media where kind='photo' and team_id=$1 and member_id=$2 and run_id=$3
        and checkpoint_id=$4 and node_id=$5
        and parallel_mechanic_id is not distinct from $6 and parallel_lane_id is not distinct from $7
        and id<>$8 and (expires_at is null or expires_at>now())`,
    [teamId, memberId, task.id, input.checkpointId, input.nodeId, task.parallelMechanicId, task.parallelLaneId, input.id],
  )).rows[0];
  if (Number(quota.pending) >= 2) throw new HttpError(429, 'Two photos for this task are already waiting for review. Ask the organizer to review them before sending another.');
  if (Number(quota.recent_count) >= 12 || Number(quota.recent_bytes) + input.file.size > 60_000_000) {
    throw new HttpError(429, 'This player has reached the temporary photo limit for this task. Try again later or ask the organizer for help.');
  }
  const bytes = await prepareImage(Buffer.from(await input.file.arrayBuffer()));
  await activePhotoTask(teamId, memberId, input);
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  const existing = (await getPool().query('select * from hunt_v3.media where id=$1', [input.id])).rows[0] as V3MediaRecord | undefined;
  if (existing) {
    if (existing.content_hash !== contentHash || existing.team_id !== teamId || existing.run_id !== task.id || existing.member_id !== memberId ||
      existing.checkpoint_id !== input.checkpointId || existing.node_id !== input.nodeId ||
      existing.parallel_mechanic_id !== task.parallelMechanicId || existing.parallel_lane_id !== task.parallelLaneId) {
      throw new HttpError(409, 'This upload ID belongs to another file or task.');
    }
    return publicMedia(existing);
  }
  const storageKey = `${input.id}-${randomUUID()}`;
  await writeMediaBytes(storageKey, bytes, 'image/jpeg');
  try {
    const retention = task.definition.settings?.photoRetention === 'retain' ? 'keep'
      : task.definition.settings?.photoRetention === 'after_event' ? 'after_event' : 'after_review';
    const { rows } = await getPool().query(
      `insert into hunt_v3.media(
        id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,parallel_mechanic_id,parallel_lane_id,
        kind,content_type,bytes,content_hash,storage_key,review_status,retention,expires_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,'photo','image/jpeg',$10,$11,$12,'pending',$13,
          case when $13='after_review' then now()+interval '7 days' else null end)
        on conflict do nothing returning *`,
      [input.id, task.hunt_id, teamId, task.id, memberId, input.checkpointId, input.nodeId,
        task.parallelMechanicId, task.parallelLaneId, bytes.length, contentHash, storageKey, retention],
    );
    if (!rows[0]) {
      await removeMediaBytes(storageKey);
      const saved = (await getPool().query('select * from hunt_v3.media where id=$1', [input.id])).rows[0];
      if (!saved) throw new HttpError(409, 'The upload was retried at the same time. Retry once more.');
      return publicMedia(saved);
    }
    return publicMedia(rows[0]);
  } catch (error) {
    await removeMediaBytes(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function readV3MediaRecord(id: string): Promise<V3MediaRecord> {
  if (!uuid(id)) throw new HttpError(404, 'Media not found.');
  const { rows } = await getPool().query(
    `select media.* from hunt_v3.media media
      left join hunt_v3.hunts hunt on hunt.id=media.hunt_id
      left join hunt_v3.runs review_run on review_run.id=media.run_id and review_run.team_id=media.team_id
      where media.id=$1 and (
        (media.kind='photo' and media.review_status='pending' and media.submitted_at is not null
          and review_run.status in ('waiting','active'))
        or ((media.expires_at is null or media.expires_at>now())
          and not (media.retention='after_event' and hunt.status in('ended','archived')))
      )`,
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'This media is no longer available.');
  return rows[0];
}

export async function authorizeV3Media(request: NextRequest, id: string) {
  const media = await readV3MediaRecord(id);
  if (media.kind === 'asset') {
    const publicCover = await getPool().query(
      `select 1 from hunt_v3.public_boards where enabled and cover_ref=$1 limit 1`,
      [`/api/v3/media/${media.id}`],
    );
    if (publicCover.rowCount) return media;
  }
  const adminToken = request.cookies.get(V3_ADMIN_COOKIE)?.value;
  if (adminToken) {
    try { await authenticateV3(adminToken, 'admin'); return media; } catch { /* Try the player session. */ }
  }
  const teamToken = request.cookies.get(V3_TEAM_COOKIE)?.value;
  if (teamToken) {
    try {
      const session = await authenticateV3(teamToken, 'team');
      if (media.kind === 'photo' && media.team_id === session.teamId) return media;
      if (media.kind === 'asset') {
        const row = (await getPool().query(
          `select run.engine_state,run.route_plan,version.definition,hunt.status as hunt_status,clock_timestamp() as now
            from hunt_v3.runs run
            join hunt_v3.run_members participant on participant.run_id=run.id and participant.member_id=$2
            join hunt_v3.hunt_versions version on version.hunt_id=run.hunt_id and version.version=run.hunt_version
            join hunt_v3.hunts hunt on hunt.id=run.hunt_id
            where run.team_id=$1 order by run.run_number desc limit 1`,
          [session.teamId, session.memberId],
        )).rows[0] as ({ engine_state: GameState; route_plan: ResolvedRunPlan; definition: V3Definition; hunt_status: string; now: string } | undefined);
        if (row) {
          const definition = materializeRunDefinition(row.definition, row.route_plan);
          const view = getPlayerView(definition, row.engine_state, new Date(row.now).toISOString());
          const clock = playability(definition, row.engine_state, row.hunt_status, new Date(row.now).toISOString());
          if (!clock.allowed && row.engine_state.status !== 'completed') { view.node = null; view.hints = []; }
          const target = `/api/v3/media/${media.id}`;
          const containsVisibleReference = (value: unknown): boolean => {
            if (typeof value === 'string') return value === target;
            if (Array.isArray(value)) return value.some(containsVisibleReference);
            return Boolean(value) && typeof value === 'object' && Object.values(value as Record<string, unknown>).some(containsVisibleReference);
          };
          if (containsVisibleReference(view)) return media;
        }
      }
    } catch { /* Deny below. */ }
  }
  throw new HttpError(403, 'This media is not available for your current task.');
}

export async function readV3Media(request: NextRequest, id: string) {
  const media = await authorizeV3Media(request, id);
  try { return { media, bytes: await readMediaBytes(media.storage_key) as Buffer }; }
  catch { throw new HttpError(404, 'This media is no longer available.'); }
}
