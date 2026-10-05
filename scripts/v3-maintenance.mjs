import { Pool } from 'pg';
import { setTimeout } from 'node:timers/promises';
import { runV3Maintenance } from '../lib/server/v3-maintenance.mjs';
import { databaseConfig } from '../lib/server/database-config.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const pool = new Pool({ ...databaseConfig(), max: 1, statement_timeout: 10000 });
let running = true;
const shutdown = new AbortController();
process.on('SIGTERM', () => { running = false; shutdown.abort(); });
process.on('SIGINT', () => { running = false; shutdown.abort(); });
do {
  try {
    const result = await runV3Maintenance(pool);
    if (result.mediaRemoved || result.incomingRemoved) {
      console.log(`Removed ${result.mediaRemoved} expired media files and ${result.incomingRemoved} temporary uploads.`);
    }
  } catch (error) {
    console.error('V3 maintenance could not finish; it will retry.', error instanceof Error ? error.name : 'Unknown error');
    if (process.argv.includes('--once')) { process.exitCode = 1; break; }
  }
  if (process.argv.includes('--once')) break;
  if (running) await setTimeout(60_000, undefined, { signal: shutdown.signal }).catch(() => undefined);
} while (running);
await pool.end();
