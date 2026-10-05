import { drainMediaDeletions, removeIncomingMedia } from './media-storage.mjs';

/** Bounded batches fit both a long-running worker and a serverless cron. */
export async function cleanupV3ExpiredMedia(pool) {
  const predicate = `(
      (media.expires_at is not null and media.expires_at<=clock_timestamp())
      or (media.retention='after_event' and hunt.status in ('ended','archived'))
    ) and not (
      media.kind='photo' and media.review_status='pending' and media.submitted_at is not null
      and exists (
        select 1 from hunt_v3.runs review_run
        where review_run.id=media.run_id and review_run.team_id=media.team_id
          and review_run.status in ('waiting','active')
      )
    )`;
  const { rows } = await pool.query(
    `select media.id,media.hunt_id,media.team_id from hunt_v3.media media
      join hunt_v3.hunts hunt on hunt.id=media.hunt_id
      where ${predicate} order by media.created_at limit 100`,
  );
  let removed = 0;
  for (const row of rows) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select id from hunt_v3.hunts where id=$1 for share', [row.hunt_id]);
      if (row.team_id) await client.query('select id from hunt_v3.teams where id=$1 for share', [row.team_id]);
      const deleted = await client.query(
        `delete from hunt_v3.media media using hunt_v3.hunts hunt
          where media.id=$1 and hunt.id=media.hunt_id and (${predicate})`,
        [row.id],
      );
      removed += deleted.rowCount ?? 0;
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  await drainMediaDeletions(pool, 'hunt_v3');
  return removed;
}

export async function cleanupV3IncomingMedia(pool) {
  const { rows } = await pool.query(
    'select id,storage_key from hunt_v3.media_uploads where cleanup_after<=now() order by cleanup_after limit 100',
  );
  for (const row of rows) {
    await removeIncomingMedia(row.storage_key);
    await pool.query('delete from hunt_v3.media_uploads where id=$1 and cleanup_after<=now()', [row.id]);
  }
  return rows.length;
}

export async function runV3Maintenance(pool) {
  const mediaRemoved = await cleanupV3ExpiredMedia(pool);
  const incomingRemoved = await cleanupV3IncomingMedia(pool);
  const sessions = await pool.query('delete from hunt_v3.sessions where expires_at<=now() or revoked_at is not null');
  const rateLimits = await pool.query("delete from hunt_v3.rate_limits where window_start<now()-interval '1 day'");
  return {
    mediaRemoved,
    incomingRemoved,
    sessionsRemoved: sessions.rowCount,
    rateWindowsRemoved: rateLimits.rowCount,
  };
}
