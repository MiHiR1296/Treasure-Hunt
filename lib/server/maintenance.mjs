import { drainMediaDeletions, removeIncomingMedia, removeMediaBytes } from './media-storage.mjs';

/** Bounded batches also fit a serverless scheduled invocation. */
export async function cleanupExpiredMedia(pool) {
  const { rows } = await pool.query(`select m.id,m.storage_key from hunt_v2.media m
    left join hunt_v2.hunts h on h.id=m.hunt_id
    left join hunt_v2.teams t on t.id=m.team_id
    left join hunt_v2.hunt_versions v on v.hunt_id=t.hunt_id and v.version=(t.state->>'definitionVersion')::int
    where (m.expires_at is not null and m.expires_at<=now()) or (m.retention='after_event' and
      (h.status in ('ended','archived') or (v.definition->'settings'->>'endsAt')::timestamptz<=now()))
    order by m.created_at limit 100`);
  for (const row of rows) {
    await removeMediaBytes(row.storage_key);
    await pool.query('delete from hunt_v2.media where id=$1', [row.id]);
  }
  await drainMediaDeletions(pool);
  return rows.length;
}

export async function cleanupIncomingMedia(pool) {
  const { rows } = await pool.query('select id,storage_key from hunt_v2.media_uploads where cleanup_after<=now() order by cleanup_after limit 100');
  for (const row of rows) {
    await removeIncomingMedia(row.storage_key);
    await pool.query('delete from hunt_v2.media_uploads where id=$1 and cleanup_after<=now()', [row.id]);
  }
  return rows.length;
}

export async function runMaintenance(pool) {
  const mediaRemoved = await cleanupExpiredMedia(pool);
  const incomingRemoved = await cleanupIncomingMedia(pool);
  const sessions = await pool.query('delete from hunt_v2.sessions where expires_at<=now()');
  const rateLimits = await pool.query("delete from hunt_v2.rate_limits where window_start<now()-interval '1 day'");
  return { mediaRemoved, incomingRemoved, sessionsRemoved: sessions.rowCount, rateWindowsRemoved: rateLimits.rowCount };
}
