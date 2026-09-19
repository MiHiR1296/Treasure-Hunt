import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { databaseConfig } from '../lib/server/database-config.mjs';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before running migrations.');
const pool = new pg.Pool(databaseConfig());
try {
  await pool.query(await readFile(new URL('../database/v2.sql', import.meta.url), 'utf8'));
  console.log('V2 database schema is ready. V1 tables were not modified.');
} finally {
  await pool.end();
}
