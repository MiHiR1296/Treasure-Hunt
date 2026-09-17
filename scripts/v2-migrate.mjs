import { readFile } from 'node:fs/promises';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before running migrations.');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(await readFile(new URL('../database/v2.sql', import.meta.url), 'utf8'));
  console.log('V2 database schema is ready. V1 tables were not modified.');
} finally {
  await pool.end();
}
