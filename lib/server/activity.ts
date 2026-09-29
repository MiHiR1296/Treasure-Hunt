import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import type { GameState, HuntDefinition } from '../engine/types';

export interface CommandActor { role: 'team' | 'admin' | 'system'; name?: string; memberId?: string | null; sessionHash?: string }
export async function databaseNow(client: PoolClient): Promise<string> {
  const { rows } = await client.query('select clock_timestamp() as at');
  return new Date(rows[0].at).toISOString();
}
/** Audit explains the state; it is never another writable progression model. */
export async function appendActivity(client: PoolClient, definition: HuntDefinition, before: GameState | null, after: GameState, now: string, actor: CommandActor, command?: unknown) {
  if (before?.revision === after.revision) return;
  const records: { type: string; details: unknown; at: string }[] = after.events.slice(before?.events.length ?? 0).map(entry => ({ type: entry.type, details: entry, at: entry.at }));
  const input = command as { type?: string; checkpointId?: string; nodeId?: string; value?: string } | undefined;
  if (input?.type === 'verify' && input.checkpointId && input.nodeId) {
    const node = definition.checkpoints.find(cp => cp.id === input.checkpointId)?.flow.nodes.find(n => n.id === input.nodeId);
    if (node?.type === 'verify_answer' && node.recordAnswerAttempts === true) records.push({ type: 'answer_submitted', at: now, details: { checkpointId: input.checkpointId, nodeId: input.nodeId, value: input.value, accepted: !records.some(entry => entry.type === 'verification_failed') } });
  }
  for (const [checkpointId, checkpoint] of Object.entries(after.checkpoints)) for (const [nodeId, node] of Object.entries(checkpoint.nodes)) {
    const previous = before?.checkpoints[checkpointId]?.nodes[nodeId];
    if (node.pendingPhotoId && node.pendingPhotoId !== previous?.pendingPhotoId) records.push({ type: 'photo_evidence_submitted', at: now, details: { checkpointId, nodeId, mediaId: node.pendingPhotoId } });
    if (previous?.photoStatus === 'pending' && (node.photoStatus !== 'pending' || (checkpoint.status === 'skipped' && before?.checkpoints[checkpointId]?.status !== 'skipped'))) records.push({ type: 'photo_evidence_reviewed', at: now, details: { checkpointId, nodeId, mediaId: previous.pendingPhotoId, outcome: checkpoint.status === 'skipped' ? 'checkpoint_skipped' : node.photoStatus ?? 'reset', reason: (command as { reason?: string } | undefined)?.reason } });
    const known = new Set(before?.checkpoints[checkpointId]?.nodes[nodeId]?.puzzleDiscoveries?.map(item => item.itemId) ?? []);
    for (const discovery of node.puzzleDiscoveries ?? []) if (!known.has(discovery.itemId)) records.push({ type: discovery.solvedAt ? 'puzzle_discovered' : 'historical_solve_observed', at: discovery.solvedAt ?? now, details: { checkpointId, nodeId, ...discovery, solvedAt: discovery.solvedAt ?? null } });
  }
  if (!before) records.push({ type: 'team_registered', at: now, details: { routeAssignments: after.routeAssignments ?? [], waiting: after.status === 'waiting' } });
  if (before?.status === 'waiting' && after.startedAt) records.push({ type: 'starting_roster', at: now, details: { members: after.startingRoster, startedAt: after.startedAt, deadlineAt: after.timer?.deadlineAt } });
  if (after.timer?.extensions.length !== before?.timer?.extensions.length && after.timer?.extensions.length) records.push({ type: 'time_allowance', at: now, details: after.timer.extensions.at(-1) });
  if (after.resultReview && after.resultReview.reviewedRevision !== before?.resultReview?.reviewedRevision) records.push({ type: 'review_status_changed', at: now, details: after.resultReview });
  // Never persist an authentication token/hash in an audit payload.
  const identity = { role: actor.role, ...(actor.name ? { declaredName: actor.name } : {}), ...(actor.memberId ? { memberId: actor.memberId } : {}),
    ...(actor.sessionHash ? { sessionReference: createHash('sha256').update(`audit-session:${actor.sessionHash}`).digest('hex') } : {}) };
  if (records.length) await client.query(`insert into hunt_v2.team_activity(team_id,revision,ordinal,at,actor,type,details)
    select $1,$2,(item.ordinality-1)::int,(item.value->>'at')::timestamptz,$3,item.value->>'type',item.value->'details'
    from jsonb_array_elements($4::jsonb) with ordinality as item(value,ordinality)`, [after.teamId, after.revision, identity, JSON.stringify(records)]);
}
