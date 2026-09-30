import { drainMediaDeletions, removeIncomingMedia } from './media-storage.mjs';

/** Bounded batches also fit a serverless scheduled invocation. */
export async function cleanupExpiredMedia(pool) {
  const predicate = `(m.expires_at is not null and m.expires_at<=clock_timestamp()) or (m.retention='after_event' and
      (h.status in ('ended','archived') or (v.definition->'settings'->>'sessionDurationSeconds' is null and (v.definition->'settings'->>'endsAt')::timestamptz<=clock_timestamp())))`;
  const { rows } = await pool.query(`select m.id,m.hunt_id,m.team_id from hunt_v2.media m
    left join hunt_v2.hunts h on h.id=m.hunt_id
    left join hunt_v2.teams t on t.id=m.team_id
    left join hunt_v2.hunt_versions v on v.hunt_id=t.hunt_id and v.version=(t.state->>'definitionVersion')::int
    where ${predicate}
    order by m.created_at limit 100`);
  for (const row of rows) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      if (row.hunt_id) await client.query('select id from hunt_v2.hunts where id=$1 for share', [row.hunt_id]);
      if (row.team_id) await client.query('select id from hunt_v2.teams where id=$1 for share', [row.team_id]);
      // Recheck after lifecycle/review locks. The deletion trigger queues bytes
      // only after this transaction commits; provider failure cannot lose the job.
      await client.query(`delete from hunt_v2.media where id in (select m.id from hunt_v2.media m
        left join hunt_v2.hunts h on h.id=m.hunt_id left join hunt_v2.teams t on t.id=m.team_id
        left join hunt_v2.hunt_versions v on v.hunt_id=t.hunt_id and v.version=(t.state->>'definitionVersion')::int
        where m.id=$1 and (${predicate}))`, [row.id]);
      await client.query('commit');
    } catch (error) { await client.query('rollback'); throw error; }
    finally { client.release(); }
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
  const visionProfiles = await pool.query(`delete from hunt_v2.vision_jobs where id in (select id from hunt_v2.vision_jobs
    where kind='target_profile' and status in ('completed','failed','cancelled') and updated_at<now()-interval '1 day' order by updated_at limit 100)`);
  await pool.query("delete from hunt_v2.vision_workers where last_seen_at<now()-interval '30 days'");
  const sessions = await pool.query('delete from hunt_v2.sessions where expires_at<=now()');
  const rateLimits = await pool.query("delete from hunt_v2.rate_limits where window_start<now()-interval '1 day'");
  return { mediaRemoved, incomingRemoved, visionProfilesRemoved: visionProfiles.rowCount, sessionsRemoved: sessions.rowCount, rateWindowsRemoved: rateLimits.rowCount };
}
