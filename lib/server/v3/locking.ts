import type { PoolClient } from 'pg';

type HuntLockMode = 'key_share' | 'update';
type TeamLockMode = 'share' | 'update';

/**
 * V3 write transactions use one explicit parent-to-child lock order:
 *
 *   hunt -> team -> run -> dependent rows (media/results/board)
 *
 * PostgreSQL foreign-key checks also take row locks. Taking the parent locks
 * up front prevents an otherwise-hidden child -> parent edge when an audit or
 * event row is inserted near the end of a transaction.
 */
export async function lockV3Hunt(client: PoolClient, huntId: string, mode: HuntLockMode = 'key_share') {
  const clause = mode === 'update' ? 'for update' : 'for key share';
  return (await client.query(
    `select id from hunt_v3.hunts where id=$1 ${clause}`,
    [huntId],
  )).rows[0] as { id: string } | undefined;
}

export async function lockV3Team(
  client: PoolClient,
  huntId: string,
  teamId: string,
  mode: TeamLockMode = 'share',
) {
  const clause = mode === 'update' ? 'for update' : 'for share';
  return (await client.query(
    `select id from hunt_v3.teams where id=$1 and hunt_id=$2 ${clause}`,
    [teamId, huntId],
  )).rows[0] as { id: string } | undefined;
}
