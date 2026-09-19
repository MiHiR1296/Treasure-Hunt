// Copy an extracted, consistent media backup into an already restored cloud DB.
// The source files remain untouched; every remote object is read back and hashed.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { readMediaBytes, validateMediaStorage, writeMediaBytes } from '../lib/server/media-storage.mjs';

const source = process.argv[2];
if (!source || !path.isAbsolute(source)) throw new Error('Provide the absolute path to an extracted media backup.');
if (process.env.MEDIA_STORAGE !== 'supabase') throw new Error('Set MEDIA_STORAGE=supabase and configure the private destination bucket.');
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the restored cloud database.');
await validateMediaStorage();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10_000 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const { rows } = await pool.query(`select m.storage_key,m.content_type,m.bytes,m.content_hash from hunt_v2.media m
    left join hunt_v2.hunts h on h.id=m.hunt_id
    left join hunt_v2.teams t on t.id=m.team_id
    left join hunt_v2.hunt_versions v on v.hunt_id=t.hunt_id and v.version=(t.state->>'definitionVersion')::int
    where (m.expires_at is null or m.expires_at>now())
    and not (m.retention='after_event' and (coalesce(h.status in ('ended','archived'),false)
      or coalesce((v.definition->'settings'->>'endsAt')::timestamptz<=now(),false))) order by m.created_at`);
  let verified = 0;
  for (const row of rows) {
    if (!/^[0-9a-f-]{73}$/i.test(row.storage_key)) throw new Error('Invalid media key in destination database.');
    const bytes = await readFile(path.join(source, row.storage_key));
    if (bytes.length !== row.bytes || sha(bytes) !== row.content_hash) throw new Error('Source media does not match restored database metadata.');
    try { await writeMediaBytes(row.storage_key, bytes, row.content_type); }
    catch (error) {
      // A previous import may already have uploaded this immutable key.
      let existing;
      try { existing = await readMediaBytes(row.storage_key); } catch { throw error; }
      if (sha(existing) !== row.content_hash) throw error;
    }
    if (sha(await readMediaBytes(row.storage_key)) !== row.content_hash) throw new Error('Cloud media verification failed.');
    verified++;
  }
  console.log(`Verified ${verified} cloud media objects against the database and local backup.`);
} finally { await pool.end(); }
