import { Pool, type PoolClient } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { databaseConfig } from './database-config.mjs';

const globalDb = globalThis as typeof globalThis & { huntPool?: Pool };
export function getPool(): Pool {
  if (!globalDb.huntPool) {
    const pool = new Pool({ ...databaseConfig(), max: process.env.VERCEL ? 3 : 10,
      idleTimeoutMillis: 5_000, connectionTimeoutMillis: 5_000, statement_timeout: 10_000 });
    if (process.env.VERCEL) attachDatabasePool(pool);
    globalDb.huntPool = pool;
  }
  return globalDb.huntPool;
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
