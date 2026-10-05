import type { PoolClient } from 'pg';
import { distanceMeters, executeOverride } from '../../engine';
import type { GameState, ScoreEntry } from '../../engine/types';
import { assertSessionPlayable, beginReviewClockPause, elapsedMilliseconds } from '../../engine/session';
import type { ParallelLane, ParallelMechanic, ResolvedRunPlan, V3Definition } from '../../v3/types';
import { getPool, transaction } from '../db';
import { canonicalJson, digest, HttpError } from '../security';
import { lockV3Hunt, lockV3Team } from './locking';
import { assertPublishedIntegrityPolicy, materializeRunDefinition, materializeRunParallelMechanics } from './runtime';
import { currentRunView, databaseNow, stateProgress, updateLiveRollup } from './runs';
import { recalculateRecognition } from './recognition';
import { isV3Uuid, rateLimitV3, reserveV3RunAttempt } from './security';

type ParallelEvidence = { value?: unknown; location?: unknown; mediaId?: unknown };
type EvidenceStatus = 'accepted' | 'rejected' | 'pending_review';

function textEvidence(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) throw new HttpError(400, 'Scan or enter valid evidence for this lane.');
  return value.normalize('NFKC').trim();
}

async function evidenceMatches(
  client: PoolClient,
  mechanicId: string,
  lane: ParallelLane,
  evidence: ParallelEvidence,
  identity: { runId: string; teamId: string; memberId: string; taskStartedAt: string },
) : Promise<EvidenceStatus> {
  if (lane.type === 'qr') return textEvidence(evidence.value) === lane.token ? 'accepted' : 'rejected';
  if (lane.type === 'code') {
    const submitted = textEvidence(evidence.value);
    const expected = lane.code.normalize('NFKC').trim();
    return (lane.caseSensitive ? submitted === expected : submitted.toLocaleLowerCase('en') === expected.toLocaleLowerCase('en')) ? 'accepted' : 'rejected';
  }
  if (lane.type === 'gps') {
    const location = evidence.location as { latitude?: unknown; longitude?: unknown; accuracyMeters?: unknown } | null;
    if (!location || ![location.latitude, location.longitude, location.accuracyMeters].every(Number.isFinite)) {
      throw new HttpError(400, 'Share a valid location reading for this lane.');
    }
    const latitude = Number(location.latitude), longitude = Number(location.longitude), accuracy = Number(location.accuracyMeters);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0) throw new HttpError(400, 'Share a valid location reading for this lane.');
    return accuracy <= lane.location.maxAccuracyMeters &&
      distanceMeters(latitude, longitude, lane.location.latitude, lane.location.longitude) <= lane.location.radiusMeters ? 'accepted' : 'rejected';
  }
  if (!isV3Uuid(evidence.mediaId)) throw new HttpError(400, 'Submit a reviewed photo for this lane.');
  const media = (await client.query(
    `select id,review_status from hunt_v3.media where id=$1 and run_id=$2 and team_id=$3 and member_id=$4
      and parallel_mechanic_id=$5 and parallel_lane_id=$6
      and task_started_at=$7::timestamptz
      and kind='photo' and (expires_at is null or expires_at>now()
        or (review_status='pending' and submitted_at is not null))`,
    [evidence.mediaId, identity.runId, identity.teamId, identity.memberId, mechanicId, lane.id, identity.taskStartedAt],
  )).rows[0];
  if (!media || media.review_status === 'rejected') return 'rejected';
  return media.review_status === 'approved' ? 'accepted' : 'pending_review';
}

function contribution(lane: ParallelLane) {
  if (lane.type === 'gps') return { category: 'trailblazer', summary: 'Completed a linked location lane' };
  if (lane.type === 'code') return { category: 'codebreaker', summary: 'Completed a linked code lane' };
  return { category: 'eagle_eye', summary: lane.type === 'photo' ? 'Completed a linked photo lane' : 'Completed a linked QR lane' };
}

async function nextOrdinal(client: PoolClient, runId: string, revision: number) {
  return Number((await client.query(
    'select coalesce(max(ordinal),0)+1 as ordinal from hunt_v3.run_events where run_id=$1 and revision=$2',
    [runId, revision],
  )).rows[0].ordinal);
}

async function pauseForSoleReviewBlockers(
  client: PoolClient,
  run: { id: string; engine_state: GameState },
  mechanic: ParallelMechanic,
  completedLaneIds: Set<string>,
  now: string,
  taskStartedAt: string,
) {
  const unresolved = mechanic.lanes.filter(lane => !completedLaneIds.has(lane.id));
  if (!unresolved.length) return run.engine_state;
  const pending = (await client.query(
    `select id,parallel_lane_id from hunt_v3.media
      where run_id=$1 and parallel_mechanic_id=$2 and review_status='pending' and submitted_at is not null
        and task_started_at=$3::timestamptz
      order by submitted_at,id`,
    [run.id, mechanic.id, taskStartedAt],
  )).rows as Array<{ id: string; parallel_lane_id: string }>;
  const pendingByLane = new Map(pending.map(media => [media.parallel_lane_id, media]));
  // Review time is excluded only when every unfinished lane is waiting on the
  // organizer. Any QR/code/GPS or approved-photo action still owed by players
  // keeps the competitive clock running.
  if (!unresolved.every(lane => pendingByLane.has(lane.id))) return run.engine_state;
  let adjustedState = run.engine_state;
  for (const lane of unresolved) {
    const media = pendingByLane.get(lane.id)!;
    adjustedState = beginReviewClockPause(adjustedState, media.id, now);
  }
  if (adjustedState !== run.engine_state) {
    const updated = await client.query(
      "update hunt_v3.runs set engine_state=$1,updated_at=$2 where id=$3 and status='active' returning id",
      [adjustedState, now, run.id],
    );
    if (!updated.rowCount) throw new HttpError(409, 'The run ended while the photo submission was being saved.');
    run.engine_state = adjustedState;
  }
  return adjustedState;
}

async function insertEngineLedger(
  client: PoolClient,
  runId: string,
  teamId: string,
  sourceEventId: number,
  entries: ScoreEntry[],
) {
  for (const entry of entries) {
    if (!entry.amount) continue;
    await client.query(
      `insert into hunt_v3.score_ledger(run_id,team_id,source_event_id,source_key,category,amount,counts_for_ranking,reason,details,created_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [runId, teamId, sourceEventId, entry.id, entry.kind, entry.amount, entry.countsForRanking !== false, entry.reason ?? entry.kind, entry, entry.at],
    );
  }
}

async function finishMechanic(
  client: PoolClient,
  run: { id: string; team_id: string; engine_state: GameState; definition: V3Definition; route_plan: ResolvedRunPlan },
  mechanic: ParallelMechanic,
  memberId: string,
  requestId: string,
  now: string,
) {
  const definition = materializeRunDefinition(run.definition, run.route_plan);
  const before = run.engine_state;
  const result = executeOverride(definition, before, {
    checkpointId: mechanic.checkpointId,
    nodeId: mechanic.nodeId,
    reason: `System-confirmed parallel mechanic: ${mechanic.id}`,
  }, now);
  const completedAt = result.state.completedAt ?? null;
  const elapsedMs = completedAt && result.state.startedAt ? elapsedMilliseconds(result.state, result.state.startedAt, completedAt) : null;
  const recognitionClosesAt = completedAt && run.definition.settings.recognition.enabled
    ? new Date(Date.parse(completedAt) + run.definition.settings.recognition.votingWindowMinutes * 60_000).toISOString()
    : null;
  await client.query(
    `update hunt_v3.runs set engine_state=$1,status=$2,progress=$3,current_checkpoint_id=$4,
      completed_at=$5,elapsed_ms=$6,recognition_closes_at=$7,updated_at=$8 where id=$9`,
    [result.state, result.state.status === 'completed' ? 'completed' : 'active', stateProgress(result.state),
      result.state.activeCheckpointId, completedAt, elapsedMs, recognitionClosesAt, now, run.id],
  );
  let ordinal = 1;
  const gate = (await client.query(
    `insert into hunt_v3.run_events(run_id,team_id,revision,ordinal,request_id,actor_kind,actor_member_id,event_type,checkpoint_id,node_id,details,occurred_at)
      values($1,$2,$3,$4,$5,'member',$6,'parallel_gate_completed',$7,$8,$9,$10) returning id`,
    [run.id, run.team_id, result.state.revision, ordinal++, requestId, memberId, mechanic.checkpointId, mechanic.nodeId, { mechanicId: mechanic.id }, now],
  )).rows[0];
  for (const event of result.state.events.slice(before.events.length)) {
    await client.query(
      `insert into hunt_v3.run_events(run_id,team_id,revision,ordinal,request_id,actor_kind,actor_member_id,event_type,checkpoint_id,node_id,details,occurred_at)
        values($1,$2,$3,$4,$5,'member',$6,$7,$8,$9,$10,$11)`,
      [run.id, run.team_id, result.state.revision, ordinal++, requestId, memberId, event.type,
        event.checkpointId ?? null, event.nodeId ?? null, event, event.at],
    );
  }
  await insertEngineLedger(client, run.id, run.team_id, gate.id, result.state.ledger.slice(before.ledger.length));
  if (result.state.status === 'completed' && before.status !== 'completed' && run.definition.settings.recognition.enabled) {
    await recalculateRecognition(client, run.team_id, run.id);
  }
  return result.state.status === 'completed';
}

export async function submitParallelLane(input: {
  teamId: string;
  memberId: string;
  runId: string;
  requestId: string;
  mechanicId: string;
  laneId: string;
  evidence: ParallelEvidence;
}) {
  if (![input.teamId, input.runId, input.requestId, input.memberId].every(isV3Uuid)) throw new HttpError(400, 'Invalid parallel action identity.');
  const payloadHash = digest(canonicalJson({ operation: 'parallel_lane', mechanicId: input.mechanicId, laneId: input.laneId, evidence: input.evidence }));
  const scopeKey = `run:${input.runId}:parallel`;
  const preflightReceipt = (await getPool().query(
    'select payload_hash from hunt_v3.command_receipts where scope_key=$1 and request_id=$2',
    [scopeKey, input.requestId],
  )).rows[0];
  if (preflightReceipt?.payload_hash !== payloadHash) {
    await rateLimitV3(`parallel-command:member:${input.teamId}:${input.memberId}`, 800);
    await rateLimitV3(`parallel-command:novel:${input.runId}:${input.memberId}`, 400);
    const preflightRun = (await getPool().query(
      `select v.definition from hunt_v3.runs r
        join hunt_v3.teams t on t.id=r.team_id and t.status='active'
        join hunt_v3.run_members rm on rm.run_id=r.id and rm.member_id=$3
        join hunt_v3.team_members m on m.id=rm.member_id and m.team_id=t.id and m.status='active'
        join hunt_v3.hunt_versions v on v.hunt_id=r.hunt_id and v.version=r.hunt_version
        where r.id=$1 and r.team_id=$2`,
      [input.runId, input.teamId, input.memberId],
    )).rows[0] as { definition: V3Definition } | undefined;
    if (preflightRun) assertPublishedIntegrityPolicy(preflightRun.definition.settings);
    const mechanic = preflightRun?.definition.settings.parallelMechanics?.find(candidate => candidate.id === input.mechanicId);
    const lane = mechanic?.lanes.find(candidate => candidate.id === input.laneId);
    if (mechanic && lane) {
      await rateLimitV3(
        `parallel-lane:${input.runId}:${input.memberId}:${mechanic.id}:${lane.id}`,
        lane.type === 'photo' ? 240 : lane.type === 'gps' ? 60 : 12,
      );
    }
  }
  const response = await transaction(async client => {
    const identity = (await client.query(
      'select hunt_id from hunt_v3.runs where id=$1 and team_id=$2',
      [input.runId, input.teamId],
    )).rows[0];
    if (!identity || !await lockV3Hunt(client, identity.hunt_id) ||
      !await lockV3Team(client, identity.hunt_id, input.teamId)) {
      throw new HttpError(404, 'Run not found.');
    }
    const run = (await client.query(
      `select r.*,v.definition,h.status as hunt_status from hunt_v3.runs r
        join hunt_v3.hunt_versions v on v.hunt_id=r.hunt_id and v.version=r.hunt_version
        join hunt_v3.hunts h on h.id=r.hunt_id
        join hunt_v3.teams t on t.id=r.team_id and t.status='active'
        where r.id=$1 and r.team_id=$2 for update of r`,
      [input.runId, input.teamId],
    )).rows[0] as ({ id: string; team_id: string; status: string; engine_state: GameState; definition: V3Definition; route_plan: ResolvedRunPlan; hunt_status: string } | undefined);
    if (!run) throw new HttpError(404, 'Run not found.');
    assertPublishedIntegrityPolicy(run.definition.settings);
    const member = (await client.query(
      `select rm.contribution_eligible from hunt_v3.run_members rm
        join hunt_v3.team_members member on member.id=rm.member_id and member.team_id=$3 and member.status='active'
        where rm.run_id=$1 and rm.member_id=$2`,
      [run.id, input.memberId, input.teamId],
    )).rows[0];
    if (!member) throw new HttpError(401, 'Join this run before completing a lane.');
    const receipt = (await client.query('select payload_hash,response from hunt_v3.command_receipts where scope_key=$1 and request_id=$2', [scopeKey, input.requestId])).rows[0];
    if (receipt) {
      if (receipt.payload_hash !== payloadHash) throw new HttpError(409, 'This request ID was already used for another action.');
      return receipt.response as { accepted: boolean; status: EvidenceStatus; mechanicCompleted: boolean; runCompleted: boolean; remaining: number };
    }
    if (run.status !== 'active') throw new HttpError(409, 'This run is not accepting parallel actions.');
    const mechanic = materializeRunParallelMechanics(run.definition, run.route_plan).find(candidate => candidate.id === input.mechanicId);
    const lane = mechanic?.lanes.find(candidate => candidate.id === input.laneId);
    if (!mechanic || !lane) throw new HttpError(404, 'Parallel lane not found.');
    if (run.engine_state.activeCheckpointId !== mechanic.checkpointId || run.engine_state.checkpoints[mechanic.checkpointId]?.activeNodeId !== mechanic.nodeId) {
      throw new HttpError(409, 'Your team has moved to another task. Refresh to continue.');
    }
    if (lane.type === 'code' || lane.type === 'qr') {
      await reserveV3RunAttempt(client, {
        scope: `parallel-lane:aggregate:${input.teamId}:${input.runId}:${mechanic.id}:${lane.id}`,
        runId: run.id,
        teamId: input.teamId,
        requestId: input.requestId,
        payloadHash,
        maximum: 6,
      });
    }
    const now = await databaseNow(client);
    assertSessionPlayable(materializeRunDefinition(run.definition, run.route_plan), run.engine_state, run.hunt_status, now);
    const mechanicProgress = run.engine_state.checkpoints[mechanic.checkpointId];
    const mechanicStartedAt = mechanicProgress?.nodes[mechanic.nodeId]?.startedAt ?? mechanicProgress?.startedAt ?? run.engine_state.startedAt ?? now;
    const recent = (await client.query(
      `select id,actor_member_id,details,occurred_at from hunt_v3.run_events
        where run_id=$1 and event_type='parallel_lane_completed' and details->>'mechanicId'=$2
        and occurred_at>=$3::timestamptz
        and revision>=coalesce((
          select max(reset.revision) from hunt_v3.run_events reset
          where reset.run_id=$1 and reset.event_type='attempt_budget_reset'
            and reset.checkpoint_id=$4 and reset.node_id=$5
        ),0)
        order by occurred_at,id`,
      [run.id, mechanic.id, mechanicStartedAt, mechanic.checkpointId, mechanic.nodeId],
    )).rows;
    const active = recent.filter(event => elapsedMilliseconds(run.engine_state, new Date(event.occurred_at).toISOString(), now) <= mechanic.timeWindowSeconds * 1000);
    if (active.some(event => event.details.laneId === lane.id)) throw new HttpError(409, 'That lane is already complete in the current window.');
    if (active.some(event => event.actor_member_id === input.memberId)) throw new HttpError(409, 'A different teammate must complete the next lane.');
    const evidenceStatus = await evidenceMatches(client, mechanic.id, lane, input.evidence, {
      runId: run.id,
      teamId: input.teamId,
      memberId: input.memberId,
      taskStartedAt: mechanicStartedAt,
    });
    if (lane.type === 'photo' && evidenceStatus === 'accepted') {
      const consumed = await client.query(
        `select 1 from hunt_v3.run_events event
          where event.run_id=$1 and event.event_type='parallel_lane_completed'
            and event.checkpoint_id=$2 and event.node_id=$3
            and event.details->>'mechanicId'=$4 and event.details->>'laneId'=$5
            and event.details->>'mediaId'=$6
            and event.occurred_at>=$7::timestamptz
            and event.revision>=coalesce((
              select max(reset.revision) from hunt_v3.run_events reset
              where reset.run_id=event.run_id and reset.event_type='attempt_budget_reset'
                and reset.checkpoint_id=$2 and reset.node_id=$3
            ),0)
          limit 1`,
        [run.id, mechanic.checkpointId, mechanic.nodeId, mechanic.id, lane.id, input.evidence.mediaId, mechanicStartedAt],
      );
      if (consumed.rowCount) {
        throw new HttpError(409, 'That approved photo was already used for this task. Take and review a fresh photo.');
      }
    }
    if (evidenceStatus === 'pending_review') {
      const saved = { accepted: false, status: evidenceStatus, mechanicCompleted: false, runCompleted: false, remaining: mechanic.lanes.length - new Set(active.map(item => item.details.laneId)).size };
      const submitted = lane.type === 'photo' ? await client.query(
        `update hunt_v3.media set submitted_at=$1
          where id=$2 and run_id=$3 and team_id=$4 and member_id=$5
            and parallel_mechanic_id=$6 and parallel_lane_id=$7
            and task_started_at=$8::timestamptz
            and kind='photo' and review_status='pending' and submitted_at is null
          returning id,submitted_at`,
        [now, input.evidence.mediaId, run.id, input.teamId, input.memberId, mechanic.id, lane.id, mechanicStartedAt],
      ) : { rowCount: 0, rows: [] as Array<{ id: string; submitted_at: string }> };
      if (submitted.rowCount) {
        const ordinal = await nextOrdinal(client, run.id, run.engine_state.revision);
        await client.query(
          `insert into hunt_v3.run_events(
            run_id,team_id,revision,ordinal,request_id,actor_kind,actor_member_id,event_type,checkpoint_id,node_id,details,occurred_at)
            values($1,$2,$3,$4,$5,'member',$6,'parallel_photo_submitted',$7,$8,$9,$10)`,
          [run.id, run.team_id, run.engine_state.revision, ordinal, input.requestId, input.memberId,
            mechanic.checkpointId, mechanic.nodeId,
            { mediaId: input.evidence.mediaId, mechanicId: mechanic.id, laneId: lane.id }, now],
        );
      }
      await pauseForSoleReviewBlockers(
        client,
        run,
        mechanic,
        new Set(active.map(item => String(item.details.laneId))),
        now,
        mechanicStartedAt,
      );
      await updateLiveRollup(client, run.id);
      await client.query(
        `insert into hunt_v3.command_receipts(scope_key,request_id,operation,team_id,run_id,member_id,payload_hash,response)
          values($1,$2,'parallel_lane_pending_review',$3,$4,$5,$6,$7)`,
        [scopeKey, input.requestId, input.teamId, run.id, input.memberId, payloadHash, saved],
      );
      return saved;
    }
    const accepted = evidenceStatus === 'accepted';
    const ordinal = await nextOrdinal(client, run.id, run.engine_state.revision);
    const event = (await client.query(
      `insert into hunt_v3.run_events(run_id,team_id,revision,ordinal,request_id,actor_kind,actor_member_id,event_type,checkpoint_id,node_id,details,occurred_at)
        values($1,$2,$3,$4,$5,'member',$6,$7,$8,$9,$10,$11) returning id`,
      [run.id, run.team_id, run.engine_state.revision, ordinal, input.requestId, input.memberId,
        accepted ? 'parallel_lane_completed' : 'parallel_lane_failed', mechanic.checkpointId, mechanic.nodeId,
        {
          mechanicId: mechanic.id,
          laneId: lane.id,
          laneType: lane.type,
          ...(lane.type === 'photo' ? { mediaId: input.evidence.mediaId } : {}),
        }, now],
    )).rows[0];
    let mechanicCompleted = false, runCompleted = false;
    const successful = accepted ? [...active, { actor_member_id: input.memberId, details: { laneId: lane.id } }] : active;
    if (accepted) {
      if (lane.type === 'photo') await client.query(
        `update hunt_v3.media set expires_at=case when retention='after_review' then $1::timestamptz else expires_at end
          where id=$2 and run_id=$3 and member_id=$4`,
        [now, input.evidence.mediaId, run.id, input.memberId],
      );
      if (member.contribution_eligible) {
        const credit = contribution(lane);
        await client.query(
          `insert into hunt_v3.run_contributions(run_id,team_id,member_id,source_event_id,source_key,category,credit,evidence,created_at)
            values($1,$2,$3,$4,$5,$6,2,$7,$8)
            on conflict(run_id,member_id,source_key) do nothing`,
          [run.id, run.team_id, input.memberId, event.id, `parallel:${mechanic.id}:${lane.id}`, credit.category,
            { summary: credit.summary, mechanicId: mechanic.id, laneId: lane.id }, now],
        );
      }
      const completeLanes = new Set(successful.map(item => item.details.laneId));
      if (mechanic.lanes.every(candidate => completeLanes.has(candidate.id))) {
        mechanicCompleted = true;
        runCompleted = await finishMechanic(client, run, mechanic, input.memberId, input.requestId, now);
      } else {
        await pauseForSoleReviewBlockers(client, run, mechanic, completeLanes, now, mechanicStartedAt);
      }
    }
    const remaining = accepted
      ? Math.max(0, mechanic.lanes.length - new Set(successful.map(item => item.details.laneId)).size)
      : mechanic.lanes.length - new Set(active.map(item => item.details.laneId)).size;
    const saved = { accepted, status: evidenceStatus, mechanicCompleted, runCompleted, remaining };
    await updateLiveRollup(client, run.id);
    await client.query(
      `insert into hunt_v3.command_receipts(scope_key,request_id,operation,team_id,run_id,member_id,payload_hash,response)
        values($1,$2,'parallel_lane',$3,$4,$5,$6,$7)`,
      [scopeKey, input.requestId, input.teamId, run.id, input.memberId, payloadHash, saved],
    );
    return saved;
  });
  return { ...response, view: await currentRunView(input.teamId, input.memberId, input.runId) };
}

/** Read-only polling path for a member's own submitted parallel photo. */
export async function parallelPhotoReviewStatus(input: {
  teamId: string;
  memberId: string;
  runId: string;
  mediaId: string;
  mechanicId: string;
  laneId: string;
}) {
  if (![input.teamId, input.runId, input.mediaId, input.memberId].every(isV3Uuid)) {
    throw new HttpError(400, 'Invalid parallel photo identity.');
  }
  if (![input.mechanicId, input.laneId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 160)) {
    throw new HttpError(400, 'Invalid parallel photo lane.');
  }
  const row = (await getPool().query(
    `select media.review_status,media.review_reason,media.checkpoint_id,media.node_id,
      version.definition,run.route_plan
      from hunt_v3.media media
      join hunt_v3.runs run on run.id=media.run_id and run.team_id=media.team_id
      join hunt_v3.teams team on team.id=run.team_id and team.status='active'
      join hunt_v3.run_members participant on participant.run_id=run.id and participant.member_id=$3
      join hunt_v3.team_members member on member.id=participant.member_id and member.team_id=team.id and member.status='active'
      join hunt_v3.hunt_versions version on version.hunt_id=run.hunt_id and version.version=run.hunt_version
      where media.id=$1 and media.run_id=$2 and media.team_id=$4 and media.member_id=$3
        and media.kind='photo' and media.parallel_mechanic_id=$5 and media.parallel_lane_id=$6
        and media.submitted_at is not null`,
    [input.mediaId, input.runId, input.memberId, input.teamId, input.mechanicId, input.laneId],
  )).rows[0] as ({
    review_status: 'pending' | 'approved' | 'rejected';
    review_reason: string | null;
    checkpoint_id: string;
    node_id: string;
    definition: V3Definition;
    route_plan: ResolvedRunPlan;
  } | undefined);
  if (!row) throw new HttpError(404, 'Submitted parallel photo not found.');
  assertPublishedIntegrityPolicy(row.definition.settings);
  const mechanic = materializeRunParallelMechanics(row.definition, row.route_plan).find(candidate => candidate.id === input.mechanicId);
  const lane = mechanic?.lanes.find(candidate => candidate.id === input.laneId);
  if (!mechanic || !lane || lane.type !== 'photo' || mechanic.checkpointId !== row.checkpoint_id || mechanic.nodeId !== row.node_id) {
    throw new HttpError(409, 'This linked photo no longer matches the published lane.');
  }
  return {
    status: row.review_status,
    ...(row.review_status === 'rejected' && row.review_reason ? { message: row.review_reason } : {}),
  };
}
