import { Pool } from 'pg';
import { setTimeout } from 'node:timers/promises';
import { drainMediaDeletions, removeMediaBytes } from '../lib/server/media-storage.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, statement_timeout: 10000 });
let running = true;
const shutdown = new AbortController();
process.on('SIGTERM', () => { running = false; shutdown.abort(); });
process.on('SIGINT', () => { running = false; shutdown.abort(); });
do {
  try {
    const { rows } = await pool.query(`select m.id,m.storage_key from hunt_v2.media m left join hunt_v2.hunts h on h.id=m.hunt_id
      left join hunt_v2.teams t on t.id=m.team_id
      left join hunt_v2.hunt_versions v on v.hunt_id=t.hunt_id and v.version=(t.state->>'definitionVersion')::int
      where (m.expires_at is not null and m.expires_at<=now()) or (m.retention='after_event' and
      (h.status in ('ended','archived') or (v.definition->'settings'->>'endsAt')::timestamptz<=now()))`);
    for (const row of rows) {
      if (!/^[0-9a-f-]{73}$/i.test(row.storage_key)) continue;
      await removeMediaBytes(row.storage_key);
      await pool.query('delete from hunt_v2.media where id=$1', [row.id]);
    }
    await drainMediaDeletions(pool);
    await pool.query('delete from hunt_v2.sessions where expires_at<=now()');
    await pool.query("delete from hunt_v2.rate_limits where window_start<now()-interval '1 day'");
    if (rows.length) console.log(`Removed ${rows.length} expired media files.`);
  } catch (error) {
    console.error('Maintenance could not finish; it will retry.', error instanceof Error ? error.name : 'Unknown error');
    if (process.argv.includes('--once')) { process.exitCode = 1; break; }
  }
  if (process.argv.includes('--once')) break;
  if (running) await setTimeout(60000,undefined,{signal:shutdown.signal}).catch(() => undefined);
} while (running);
await pool.end();
