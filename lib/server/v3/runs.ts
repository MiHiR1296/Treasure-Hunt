import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { createInitialState, executeCommand, parseCommand } from '../../engine';
import type { PuzzleDefinition } from '../../engine/puzzles';
import { EngineError, type GameCommand, type GameEvent, type GameState, type HuntDefinition, type ScoreEntry } from '../../engine/types';
import { assertSessionPlayable, assertStartWindow, beginReviewClockPause, elapsedMilliseconds, timerRemaining } from '../../engine/session';
import { planRunForFairnessRoute, selectBalancedPlan } from '../../v3/planning';
import { resolveIntegrityPolicy, type ContributionCategory, type FairnessReport, type ResolvedRunPlan, type V3Definition } from '../../v3/types';
import { getPool, transaction } from '../db';
import { canonicalJson, digest, HttpError } from '../security';
import { lockV3Hunt } from './locking';
import { recalculateRecognition } from './recognition';
import { assertPublishedIntegrityPolicy, materializeRunDefinition, materializeRunParallelMechanics, seededEngineRoutes, v3PlayerView } from './runtime';
import { isV3Uuid, rateLimitV3, reserveV3RunAttempt } from './security';

type RunRow = {
  id: string;
  team_id: string;
  hunt_id: string;
  hunt_version: number;
  run_number: number;
  route_plan: ResolvedRunPlan;
  engine_state: GameState;
  status: 'waiting' | 'active' | 'completed' | 'abandoned' | 'disqualified';
  practice: boolean;
  eligible: boolean;
  score: number;
  started_at: string;
  completed_at: string | null;
  elapsed_ms: number | null;
  definition: V3Definition;
  canonical_code: string;
  display_name: string | null;
  member_name: string;
  hunt_status: string;
  contribution_eligible: boolean;
};

function validRequestId(requestId: string) {
  if (!isV3Uuid(requestId)) {
    throw new HttpError(400, 'A valid request ID is required.');
  }
}

export async function databaseNow(client: PoolClient) {
  return new Date((await client.query('select clock_timestamp() as at')).rows[0].at).toISOString();
}

async function loadRun(client: PoolClient, teamId: string, memberId: string, runId?: string, lock = false): Promise<RunRow> {
  const selector = runId ? 'r.id=$3' : "r.status='active'";
  const query = `select r.*,v.definition,t.canonical_code,t.display_name,m.name as member_name,h.status as hunt_status,
    rm.contribution_eligible
    from hunt_v3.runs r
    join hunt_v3.teams t on t.id=r.team_id and t.status='active'
    join hunt_v3.hunts h on h.id=r.hunt_id
    join hunt_v3.team_members m on m.id=$2 and m.team_id=t.id and m.status='active'
    join hunt_v3.run_members rm on rm.run_id=r.id and rm.team_id=t.id and rm.member_id=m.id
    join hunt_v3.hunt_versions v on v.hunt_id=r.hunt_id and v.version=r.hunt_version
    where r.team_id=$1 and ${selector}
    order by r.run_number desc limit 1${lock ? ' for update of r' : ''}`;
  const values = runId ? [teamId, memberId, runId] : [teamId, memberId];
  const run = (await client.query(query, values)).rows[0] as RunRow | undefined;
  if (!run) {
    const excludedStartingRoster = await client.query(
      `select 1 from hunt_v3.runs r
        join hunt_v3.teams t on t.id=r.team_id and t.status='active'
        join hunt_v3.team_members m on m.id=$2 and m.team_id=t.id and m.status='active'
        where r.team_id=$1 and ${selector}
          and not exists(
            select 1 from hunt_v3.run_members rm where rm.run_id=r.id and rm.member_id=m.id
          )
        limit 1`,
      values,
    );
    if (excludedStartingRoster.rowCount) {
      throw new HttpError(409, 'This adventure is already underway. You aren\'t part of this run.');
    }
    throw new HttpError(404, runId ? 'Run not found.' : 'This team has no active run.');
  }
  assertPublishedIntegrityPolicy(run.definition.settings);
  return run;
}

async function renderRun(client: PoolClient, run: RunRow, memberId: string) {
  const now = await databaseNow(client);
  const parallelProgress: Record<string, Array<{ laneId: string; memberId: string; memberName: string; occurredAt: string }>> = {};
  for (const mechanic of materializeRunParallelMechanics(run.definition, run.route_plan)) {
    const mechanicProgress = run.engine_state.checkpoints[mechanic.checkpointId];
    const mechanicStartedAt = mechanicProgress?.nodes[mechanic.nodeId]?.startedAt ?? mechanicProgress?.startedAt ?? run.started_at;
    const rows = (await client.query(
      `select event.details->>'laneId' as lane_id,
        event.actor_member_id,member.name as member_name,event.occurred_at
        from hunt_v3.run_events event join hunt_v3.team_members member on member.id=event.actor_member_id
        where event.run_id=$1 and event.event_type='parallel_lane_completed'
          and event.details->>'mechanicId'=$2
          and event.occurred_at>=$3::timestamptz
          and event.revision>=coalesce((
            select max(reset.revision) from hunt_v3.run_events reset
            where reset.run_id=event.run_id and reset.event_type='attempt_budget_reset'
              and reset.checkpoint_id=$4 and reset.node_id=$5
          ),0)
        order by event.occurred_at desc,event.id desc`,
      [run.id, mechanic.id, mechanicStartedAt, mechanic.checkpointId, mechanic.nodeId],
    )).rows;
    const byLane = new Map<string, { laneId: string; memberId: string; memberName: string; occurredAt: string }>();
    for (const row of rows) {
      const occurredAt = new Date(row.occurred_at).toISOString();
      if (elapsedMilliseconds(run.engine_state, occurredAt, now) > mechanic.timeWindowSeconds * 1000 || byLane.has(row.lane_id)) continue;
      byLane.set(row.lane_id, { laneId: row.lane_id, memberId: row.actor_member_id, memberName: row.member_name, occurredAt });
    }
    parallelProgress[mechanic.id] = [...byLane.values()];
  }
  const view = v3PlayerView({
    definition: run.definition,
    plan: run.route_plan,
    state: run.engine_state,
    now,
    huntStatus: run.hunt_status,
    run: { id: run.id, runNumber: run.run_number, practice: run.practice, eligible: run.eligible },
    team: { id: run.team_id, code: run.canonical_code, displayName: run.display_name },
    member: { id: memberId, name: run.member_name },
    parallelProgress,
  });
  const board = (await client.query('select enabled,slug from hunt_v3.public_boards where hunt_id=$1', [run.hunt_id])).rows[0];
  view.features.publicBoard = board?.enabled ? { enabled: true, slug: board.slug } : { enabled: false };
  return view;
}

export async function currentRunView(teamId: string, memberId: string, runId?: string) {
  if (runId && !isV3Uuid(runId)) throw new HttpError(400, 'Invalid run.');
  return transaction(async client => {
    await client.query('set transaction isolation level repeatable read read only');
    return renderRun(client, await loadRun(client, teamId, memberId, runId), memberId);
  });
}

function runPolicy(settings: V3Definition['settings'], previousOfficialAttempts: number, requestedPractice: boolean) {
  if (previousOfficialAttempts === 0) {
    if (requestedPractice) throw new HttpError(409, 'Finish your first adventure before choosing a just-for-fun replay.');
    return { practice: false, eligible: true };
  }
  const policy = settings.runPolicy;
  if (policy.mode === 'disabled') throw new HttpError(409, 'This adventure is complete. Your organizer has turned off replays.');
  if (policy.mode === 'practice-only') return { practice: true, eligible: false };
  if (policy.mode === 'capped') {
    const maximum = policy.maxOfficialRuns ?? 1;
    if (previousOfficialAttempts >= maximum) {
      if (requestedPractice) return { practice: true, eligible: false };
      throw new HttpError(409, `Your crew has finished all ${maximum} scored attempts. Choose “Try again” to keep playing for fun.`);
    }
    if (requestedPractice) {
      throw new HttpError(409, `Your crew still has another scored attempt available. Start run ${previousOfficialAttempts + 1} when you are ready.`);
    }
    return { practice: false, eligible: true };
  }
  if (requestedPractice) {
    throw new HttpError(409, 'Every replay counts for this event. Choose “Try again” to begin your next adventure.');
  }
  return { practice: false, eligible: true };
}

async function terminalizeExpiredRun(
  client: PoolClient,
  run: { id: string; team_id: string; hunt_id: string; engine_state: GameState; definition: V3Definition },
  now: string,
) {
  const timerExpired = Boolean(run.engine_state.timer) && (timerRemaining(run.engine_state, now) ?? 1) <= 0;
  const scheduledEnd = !run.engine_state.timer ? run.definition.settings.endsAt : undefined;
  const scheduleExpired = Boolean(scheduledEnd) && Number.isFinite(Date.parse(scheduledEnd!)) && Date.parse(now) >= Date.parse(scheduledEnd!);
  if (!timerExpired && !scheduleExpired) return false;
  const action = timerExpired ? 'run_timed_out' : 'run_schedule_ended';
  const reason = timerExpired ? 'Session duration expired' : 'Published hunt end time passed';
  const elapsedMs = run.engine_state.startedAt ? elapsedMilliseconds(run.engine_state, run.engine_state.startedAt, now) : 0;
  const updated = await client.query(
    `update hunt_v3.runs set status='abandoned',eligible=false,elapsed_ms=$1,
      ineligibility_reason=coalesce(ineligibility_reason,$2),updated_at=$3
      where id=$4 and status='active' returning id`,
    [elapsedMs, reason, now, run.id],
  );
  if (!updated.rowCount) return false;
  const ordinal = Number((await client.query(
    'select coalesce(max(ordinal),0)+1 as ordinal from hunt_v3.run_events where run_id=$1 and revision=$2',
    [run.id, run.engine_state.revision],
  )).rows[0].ordinal);
  await client.query(
    `insert into hunt_v3.run_events(
      run_id,team_id,revision,ordinal,actor_kind,event_type,details,occurred_at)
      values($1,$2,$3,$4,'system',$5,$6,$7)`,
    [run.id, run.team_id, run.engine_state.revision, ordinal, action, {
      reason: timerExpired ? 'session_duration_expired' : 'hunt_schedule_ended',
      elapsedMs,
      ...(scheduledEnd ? { scheduledEnd } : {}),
    }, now],
  );
  await client.query(
    `insert into hunt_v3.admin_events(action,hunt_id,team_id,run_id,reason,details)
      values($1,$2,$3,$4,$5,$6)`,
    [action, run.hunt_id, run.team_id, run.id, reason, { elapsedMs, ...(scheduledEnd ? { scheduledEnd } : {}) }],
  );
  await updateLiveRollup(client, run.id);
  return true;
}

/**
 * Persist timer or immutable schedule expiry even when a team closes the
 * browser and never sends a follow-up command. Live/final organizer reads
 * invoke this bounded sweep so a stale run cannot remain provisional forever.
 */
export async function terminalizeExpiredV3Runs(huntId: string, suppliedClient?: PoolClient) {
  const sweep = async (client: PoolClient) => {
    // Always acquire the parent before any run row. Besides keeping the
    // explicit lock graph acyclic, this covers the hunt FK acquired by the
    // timeout audit insert in terminalizeExpiredRun.
    const hunt = await lockV3Hunt(client, huntId);
    if (!hunt) return { examined: 0, expired: 0 };
    const now = await databaseNow(client);
    const observed = (await client.query(
      `select run.id,run.team_id,run.hunt_id,run.engine_state,version.definition
        from hunt_v3.runs run join hunt_v3.hunt_versions version
          on version.hunt_id=run.hunt_id and version.version=run.hunt_version
        where run.hunt_id=$1 and run.status='active'
        order by run.team_id,run.run_number,run.id`,
      [huntId],
    )).rows as Array<{ id: string; team_id: string; hunt_id: string; engine_state: GameState; definition: V3Definition }>;
    // Do not lock every healthy run on each five-second operations poll.
    // Select only rows that appeared expired at one database timestamp, then
    // re-read them under lock and re-check the authoritative pinned version.
    const candidateIds = observed
      .filter(run => {
        if (run.engine_state.timer) return (timerRemaining(run.engine_state, now) ?? 1) <= 0;
        const endsAt = run.definition.settings.endsAt;
        return Boolean(endsAt) && Number.isFinite(Date.parse(endsAt!)) && Date.parse(now) >= Date.parse(endsAt!);
      })
      .map(run => run.id);
    const candidateTeamIds = [...new Set(observed
      .filter(run => candidateIds.includes(run.id))
      .map(run => run.team_id))].sort();
    if (candidateTeamIds.length) await client.query(
      `select id from hunt_v3.teams
        where hunt_id=$1 and id=any($2::uuid[]) order by id for share`,
      [huntId, candidateTeamIds],
    );
    const rows = candidateIds.length ? (await client.query(
      `select run.id,run.team_id,run.hunt_id,run.engine_state,version.definition
        from hunt_v3.runs run join hunt_v3.hunt_versions version
          on version.hunt_id=run.hunt_id and version.version=run.hunt_version
        where run.hunt_id=$1 and run.id=any($2::uuid[]) and run.status='active'
        order by run.team_id,run.run_number,run.id
        for update of run`,
      [huntId, candidateIds],
    )).rows as Array<{ id: string; team_id: string; hunt_id: string; engine_state: GameState; definition: V3Definition }> : [];
    let expired = 0;
    for (const run of rows) if (await terminalizeExpiredRun(client, run, now)) expired += 1;
    return { examined: observed.length, expired };
  };
  return suppliedClient ? sweep(suppliedClient) : transaction(sweep);
}

export async function createRun(teamId: string, memberId: string, requestId: string, requestedPractice = false) {
  validRequestId(requestId);
  const payloadHash = digest(canonicalJson({ operation: 'create_run', requestedPractice }));
  const scopeKey = `team:${teamId}:runs`;
  const preflightReceipt = (await getPool().query(
    'select payload_hash from hunt_v3.command_receipts where scope_key=$1 and request_id=$2',
    [scopeKey, requestId],
  )).rows[0];
  if (preflightReceipt?.payload_hash !== payloadHash) {
    // Reserve outside the run transaction. Holding one pool client while the
    // limiter acquires another can exhaust the small serverless connection
    // pool when several teams act at once.
    await rateLimitV3(`run-create:novel:${teamId}:${memberId}`, 30);
  }
  const outcome = await transaction(async client => {
    const identity = (await client.query(
      'select hunt_id,status from hunt_v3.teams where id=$1',
      [teamId],
    )).rows[0];
    if (!identity) throw new HttpError(404, 'Team not found.');
    if (identity.status !== 'active') throw new HttpError(409, 'This team is not allowed to start runs. Ask the organizer for help.');
    const hunt = (await client.query(
      `select h.*,v.definition,v.fairness_report
        from hunt_v3.hunts h join hunt_v3.hunt_versions v on v.hunt_id=h.id and v.version=h.latest_version
        where h.id=$1 for update of h`,
      [identity.hunt_id],
    )).rows[0] as ({ definition: V3Definition; fairness_report: FairnessReport } & Record<string, unknown>) | undefined;
    if (!hunt) throw new HttpError(404, 'Hunt not found.');
    assertPublishedIntegrityPolicy(hunt.definition.settings);
    const lockedIdentity = (await client.query(
      'select status,approval_status,approval_method,registration_source,competition_revision from hunt_v3.teams where id=$1 for update',
      [teamId],
    )).rows[0];
    if (!lockedIdentity || lockedIdentity.status !== 'active') {
      throw new HttpError(409, 'This team is not allowed to start runs. Ask the organizer for help.');
    }
    const integrityPolicy = resolveIntegrityPolicy(hunt.definition.settings);
    const needsOrganizerApproval = lockedIdentity.registration_source === 'self_serve' &&
      integrityPolicy.selfServeApproval === 'organizer' &&
      (lockedIdentity.approval_status !== 'approved' || lockedIdentity.approval_method !== 'organizer');
    if (needsOrganizerApproval) {
      throw new HttpError(409, 'Your crew is waiting for the organizer\'s go-ahead.');
    }
    if (lockedIdentity.registration_source === 'self_serve' &&
      integrityPolicy.selfServeApproval === 'automatic' &&
      lockedIdentity.approval_status !== 'approved') {
      const updatedApproval = (await client.query(
        `update hunt_v3.teams set approval_status='approved',approval_method='automatic',
          competition_revision=competition_revision+1 where id=$1
          returning competition_revision`,
        [teamId],
      )).rows[0];
      await client.query(
        `insert into hunt_v3.admin_events(action,hunt_id,team_id,before_state,after_state,details)
          values('team_auto_approved',$1,$2,$3,$4,$5)`,
        [identity.hunt_id, teamId, {
          approvalStatus: lockedIdentity.approval_status,
          approvalMethod: lockedIdentity.approval_method,
          competitionRevision: Number(lockedIdentity.competition_revision),
        }, {
          approvalStatus: 'approved',
          approvalMethod: 'automatic',
          competitionRevision: Number(updatedApproval.competition_revision),
        }, { policy: 'automatic', source: 'run_start' }],
      );
    }
    const member = (await client.query(
      "select id from hunt_v3.team_members where id=$1 and team_id=$2 and status='active' and checked_in_at is not null",
      [memberId, teamId],
    )).rows[0];
    if (!member) throw new HttpError(401, 'Check in with an active team membership before starting a run.');

    const receipt = (await client.query(
      'select payload_hash,response from hunt_v3.command_receipts where scope_key=$1 and request_id=$2',
      [scopeKey, requestId],
    )).rows[0];
    if (receipt) {
      if (receipt.payload_hash !== payloadHash) throw new HttpError(409, 'This request ID was already used for another action.');
      return renderRun(client, await loadRun(client, teamId, memberId, receipt.response.runId), memberId);
    }
    const fairnessReport = hunt.fairness_report;
    if (!fairnessReport?.valid) throw new HttpError(409, 'This adventure needs an organizer update before play can begin.');
    const planCapacity = fairnessReport.routes?.length ?? 0;
    // Publication rejects an oversized capped policy. Clamp defensively at
    // runtime as well so an old/manual database row cannot allocate more
    // capped official attempts than the validated deck contains. Unlimited
    // official replay remains an explicit organizer option.
    const configuredRunPolicy = hunt.definition.settings.runPolicy;
    const effectiveRunSettings: V3Definition['settings'] = configuredRunPolicy.mode === 'capped' &&
      (configuredRunPolicy.maxOfficialRuns ?? 1) > planCapacity
      ? { ...hunt.definition.settings, runPolicy: { mode: 'capped', maxOfficialRuns: planCapacity } }
      : hunt.definition.settings;
    const activeMembers = Number((await client.query(
      "select count(*)::int as count from hunt_v3.team_members where team_id=$1 and status='active' and checked_in_at is not null",
      [teamId],
    )).rows[0].count);
    const minimumMembers = Number(hunt.definition.settings.minTeamSize ?? 1);
    if (activeMembers < minimumMembers) {
      throw new HttpError(409, `At least ${minimumMembers} checked-in team members are required to start.`);
    }

    let active = (await client.query(
      `select run.id,run.team_id,run.hunt_id,run.engine_state,version.definition
        from hunt_v3.runs run join hunt_v3.hunt_versions version
          on version.hunt_id=run.hunt_id and version.version=run.hunt_version
        where run.team_id=$1 and run.status='active'
        order by run.run_number desc limit 1 for update of run`,
      [teamId],
    )).rows[0] as ({ id: string; team_id: string; hunt_id: string; engine_state: GameState; definition: V3Definition } | undefined);
    let terminalizedExpiredRun = false;
    if (active) {
      const now = await databaseNow(client);
      if (await terminalizeExpiredRun(client, active, now)) {
        terminalizedExpiredRun = true;
        active = undefined;
      }
    }
    if (active) {
      await client.query(
        `insert into hunt_v3.command_receipts(scope_key,request_id,operation,team_id,run_id,member_id,payload_hash,response)
          values($1,$2,'resume_run',$3,$4,$5,$6,$7)`,
        [scopeKey, requestId, teamId, active.id, memberId, payloadHash, { runId: active.id }],
      );
      return renderRun(client, await loadRun(client, teamId, memberId, active.id), memberId);
    }

    // Check the immutable publication window before run policy/allocation. If
    // this request just terminalized a ghost-active attempt, defer the error
    // until after COMMIT so the terminal transition is not rolled back.
    const startWindowNow = await databaseNow(client);
    try {
      assertStartWindow({ ...hunt.definition, schemaVersion: 1 }, String(hunt.status), startWindowNow);
    } catch (error) {
      if (terminalizedExpiredRun && error instanceof EngineError) {
        return { deferredEngineError: { code: error.code, message: error.message } } as const;
      }
      throw error;
    }

    const counts = (await client.query(
      `select count(*)::int as total,
        count(*) filter(
          where not practice
            and ineligibility_reason is distinct from 'Team disqualified by organizer'
        )::int as official,
        count(*) filter(where practice)::int as practice
        from hunt_v3.runs where team_id=$1`,
      [teamId],
    )).rows[0];
    let policy: ReturnType<typeof runPolicy>;
    try {
      // Practice is a one-way competition boundary. Once a team has rehearsed
      // any already-exposed route, a later disqualification restore or policy
      // change must not turn that identity back into an official competitor.
      // It may keep replaying, but every subsequent run stays practice-only.
      if (Number(counts.practice) > 0) {
        if (!requestedPractice) {
          throw new HttpError(409, 'This crew is now in replay mode. Choose “Try again” to keep playing, or ask the organizer for help.');
        }
        policy = { practice: true, eligible: false };
      } else {
        policy = runPolicy(effectiveRunSettings, Number(counts.official), requestedPractice);
      }
    } catch (error) {
      // The expired attempt is durable even when the organizer's run policy
      // prevents a replacement. Throwing inside this transaction would roll
      // the timeout back and leave the team trapped in a ghost active run.
      if (terminalizedExpiredRun && error instanceof HttpError) {
        return {
          deferredRunPolicyError: {
            status: error.status,
            message: error.message,
            details: error.details,
          },
        } as const;
      }
      throw error;
    }
    const privateSeed = randomBytes(32).toString('base64url');
    const routeKeyByDigest = new Map((fairnessReport.routes ?? []).map(route => [digest(route.routeKey), route.routeKey]));
    const allocationRows = (await client.query(
      `select id,team_id,plan_key,allocation_cycle,practice,engine_state from hunt_v3.runs
        where hunt_id=$1 and hunt_version=$2
        order by created_at,id`,
      [identity.hunt_id, hunt.definition.version],
    )).rows as Array<{
      id: string;
      team_id: string;
      plan_key: string;
      allocation_cycle: number;
      practice: boolean;
      engine_state: GameState;
    }>;
    const resolvedUsage = allocationRows.flatMap(row => {
      const routeKey = routeKeyByDigest.get(String(row.plan_key));
      return routeKey ? [{ row, teamId: String(row.team_id), routeKey }] : [];
    });
    const officialUsage = resolvedUsage.filter(item => !item.row.practice);
    const practiceRoutes = policy.practice
      ? (fairnessReport.routes ?? []).filter(route => officialUsage.some(item => item.teamId === teamId && item.routeKey === route.routeKey))
      : [];
    if (policy.practice && !practiceRoutes.length) {
      throw new HttpError(409, 'We could not prepare the next adventure. Ask the organizer for help.');
    }
    const allocation = policy.practice
      ? selectBalancedPlan(
        practiceRoutes,
        resolvedUsage.filter(item => item.row.practice && item.teamId === teamId),
        teamId,
        privateSeed,
      )
      : selectBalancedPlan(fairnessReport.routes ?? [], officialUsage, teamId, privateSeed);
    const planDigest = digest(allocation.route.routeKey);
    const practiceSource = policy.practice
      ? [...resolvedUsage].reverse().find(item => !item.row.practice && item.teamId === teamId && item.routeKey === allocation.route.routeKey)?.row
      : undefined;
    if (policy.practice && !practiceSource) {
      throw new HttpError(409, 'We could not prepare the next adventure. Ask the organizer for help.');
    }
    const allocationCycle = policy.practice
      ? Math.max(-1, ...allocationRows
        .filter(row => row.team_id === teamId && row.plan_key === planDigest)
        .map(row => Number(row.allocation_cycle))) + 1
      : allocation.cycle;
    const plan = planRunForFairnessRoute(hunt.definition, privateSeed, allocation.route);
    const now = startWindowNow;
    const runId = randomUUID();
    const engineDefinition = materializeRunDefinition(hunt.definition, plan);
    assertStartWindow(engineDefinition, String(hunt.status), now);
    const routeAssignments = practiceSource
      ? (practiceSource.engine_state.routeAssignments ?? []).map(assignment => ({ ...assignment, assignedAt: now }))
      : seededEngineRoutes(engineDefinition, privateSeed, now);
    const state = createInitialState(engineDefinition, runId, now, {
      routeAssignments,
      initialVariables: plan.variables,
    });
    state.startingRoster = (await client.query(
      "select id,name from hunt_v3.team_members where team_id=$1 and status='active' and checked_in_at is not null order by created_at,id",
      [teamId],
    )).rows;
    const runNumber = Number(counts.total) + 1;
    const completedAt = state.completedAt ?? null;
    const elapsedMs = completedAt && state.startedAt ? elapsedMilliseconds(state, state.startedAt, completedAt) : null;
    const recognitionClosesAt = completedAt && hunt.definition.settings.recognition.enabled
      ? new Date(Date.parse(completedAt) + hunt.definition.settings.recognition.votingWindowMinutes * 60_000).toISOString()
      : null;
    await client.query(
      `insert into hunt_v3.runs(
        id,team_id,hunt_id,hunt_version,run_number,private_seed,seed_commitment,plan_key,allocation_cycle,route_plan,resolved_variables,
        engine_state,status,practice,eligible,score,progress,current_checkpoint_id,started_at,completed_at,elapsed_ms,recognition_closes_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,0,$16,$17,$18,$19,$20,$21)`,
      [runId, teamId, identity.hunt_id, hunt.definition.version, runNumber, privateSeed, digest(privateSeed),
        planDigest, allocationCycle, plan, plan.variables, state,
        state.status === 'completed' ? 'completed' : 'active', policy.practice, policy.eligible, stateProgress(state),
        state.activeCheckpointId, state.startedAt ?? now, completedAt, elapsedMs, recognitionClosesAt],
    );
    await client.query(
      `insert into hunt_v3.run_members(run_id,team_id,member_id,member_name_snapshot)
        select $1,$2,id,name from hunt_v3.team_members
        where team_id=$2 and status='active' and checked_in_at is not null`,
      [runId, teamId],
    );
    const started = (await client.query(
      `insert into hunt_v3.run_events(run_id,team_id,revision,ordinal,event_type,actor_kind,actor_member_id,occurred_at,details,request_id)
        values($1,$2,0,1,'run_started','member',$3,$4,$5,$6) returning id`,
      [runId, teamId, memberId, now, {
        runNumber,
        practice: policy.practice,
        allocationCycle,
        priorEventUses: allocation.eventUseCount,
        priorTeamUses: allocation.teamUseCount,
        ...(practiceSource ? { practiceSourceRunId: practiceSource.id } : {}),
      }, requestId],
    )).rows[0];
    for (const [index, event] of state.events.entries()) {
      await client.query(
        `insert into hunt_v3.run_events(
          run_id,team_id,revision,ordinal,event_type,actor_kind,checkpoint_id,node_id,occurred_at,details,request_id)
          values($1,$2,0,$3,$4,'system',$5,$6,$7,$8,$9)`,
        [runId, teamId, index + 2, event.type, event.checkpointId ?? null, event.nodeId ?? null, event.at, event, requestId],
      );
    }
    for (const entry of state.ledger) await appendScore(client, runId, teamId, Number(started.id), entry);
    if (state.status === 'completed' && hunt.definition.settings.recognition.enabled) {
      await recalculateRecognition(client, teamId, runId);
    }
    await updateLiveRollup(client, runId);
    await client.query(
      `insert into hunt_v3.command_receipts(scope_key,request_id,operation,team_id,run_id,member_id,payload_hash,response)
        values($1,$2,'create_run',$3,$4,$5,$6,$7)`,
      [scopeKey, requestId, teamId, runId, memberId, payloadHash, { runId }],
    );
    return renderRun(client, await loadRun(client, teamId, memberId, runId), memberId);
  });
  if ('deferredRunPolicyError' in outcome && outcome.deferredRunPolicyError) {
    const error = outcome.deferredRunPolicyError;
    throw new HttpError(error.status, error.message, error.details);
  }
  if ('deferredEngineError' in outcome && outcome.deferredEngineError) {
    const error = outcome.deferredEngineError;
    throw new EngineError(error.code, error.message);
  }
  return outcome;
}

export function stateProgress(state: GameState) {
  const values = Object.values(state.checkpoints);
  return values.length ? values.filter(checkpoint => ['completed', 'skipped'].includes(checkpoint.status)).length / values.length : 0;
}

function puzzleInteractionLimit(puzzle: PuzzleDefinition) {
  switch (puzzle.type) {
    case 'multiple_choice': return 1;
    // A quiz answer is immutable once recorded. Its allowance is exactly one
    // final choice per question plus the explicit finish action.
    case 'quiz': return puzzle.questions.length + 1;
    case 'text': return 6;
    // Stateful UI controls submit after each player move. These allowances
    // cover a plausible solve/correction path but stay well below permutation
    // enumeration for publishable puzzle sizes.
    case 'jigsaw': return puzzle.pieces.length * 3;
    case 'matching': return puzzle.left.length + Math.ceil(puzzle.left.length / 2);
    case 'sequence': return (puzzle.items.length * (puzzle.items.length - 1)) / 2 + Math.ceil(puzzle.items.length / 2);
    case 'rotation': return puzzle.tiles.length * 3;
    case 'sudoku': {
      const blanks = puzzle.givens.flat().filter(value => value === 0).length;
      return Math.max(3, blanks * 3);
    }
    case 'word_search': return puzzle.words.length * 4 + 2;
    case 'crossword': return Math.min(1_000, puzzle.entries.reduce((total, entry) => total + entry.answer.length, 0) * 2 + 4);
  }
}

function runAttemptBudget(
  definition: HuntDefinition,
  state: GameState,
  command: GameCommand,
  teamId: string,
  runId: string,
) {
  if (command.type === 'verify') {
    const node = definition.checkpoints.find(checkpoint => checkpoint.id === command.checkpointId)
      ?.flow.nodes.find(candidate => candidate.id === command.nodeId);
    const isCurrentNode = state.activeCheckpointId === command.checkpointId &&
      state.checkpoints[command.checkpointId]?.activeNodeId === command.nodeId;
    if (isCurrentNode && node && ['verify_qr', 'verify_code', 'verify_answer'].includes(node.type)) {
      return {
        scope: `run-verifier:aggregate:${teamId}:${runId}:${command.checkpointId}:${command.nodeId}`,
        maximum: 6,
      };
    }
  }
  if (command.type === 'submit_puzzle') {
    const node = definition.checkpoints.find(checkpoint => checkpoint.id === command.checkpointId)
      ?.flow.nodes.find(candidate => candidate.id === command.nodeId);
    const isCurrentNode = state.activeCheckpointId === command.checkpointId &&
      state.checkpoints[command.checkpointId]?.activeNodeId === command.nodeId;
    if (isCurrentNode && node?.type === 'puzzle') {
      return {
        scope: `run-puzzle-submit:aggregate:${teamId}:${runId}:${command.checkpointId}:${command.nodeId}`,
        maximum: puzzleInteractionLimit(node.puzzle),
      };
    }
  }
  if (command.type === 'submit_hint_puzzle') {
    const hint = definition.checkpoints.find(checkpoint => checkpoint.id === command.checkpointId)
      ?.hints.find(candidate => candidate.id === command.hintId);
    if (state.activeCheckpointId === command.checkpointId && hint?.content.type === 'puzzle') {
      return {
        scope: `run-hint-puzzle-submit:aggregate:${teamId}:${runId}:${command.checkpointId}:${command.hintId}`,
        maximum: puzzleInteractionLimit(hint.content.puzzle),
      };
    }
  }
  return undefined;
}

function contributionFor(command: GameCommand, event: GameEvent): { category: ContributionCategory; credit: number; evidence: string } | null {
  if (event.type === 'puzzle_completed') return { category: 'puzzle_ace', credit: 3, evidence: 'Completed a verified puzzle' };
  if (event.type === 'hunt_completed') return { category: 'clutch_player', credit: 3, evidence: 'Completed the decisive final action' };
  if (event.type === 'checkpoint_completed') return { category: 'trailblazer', credit: 1, evidence: 'Confirmed a checkpoint' };
  if (event.type !== 'action_completed') return null;
  if (command.type === 'verify_gps') return { category: 'trailblazer', credit: 2, evidence: 'Confirmed a location' };
  if (command.type === 'submit_photo') return { category: 'eagle_eye', credit: 2, evidence: 'Submitted accepted photo evidence' };
  if (command.type === 'verify') return { category: 'codebreaker', credit: 2, evidence: 'Solved a verified answer or code' };
  if (command.type === 'submit_puzzle') return { category: 'puzzle_ace', credit: 2, evidence: 'Solved a puzzle' };
  return { category: 'team_spark', credit: 1, evidence: 'Moved the team forward' };
}

async function appendRunAudit(
  client: PoolClient,
  run: RunRow,
  before: GameState,
  after: GameState,
  memberId: string,
  requestId: string,
  command: GameCommand,
) {
  const events = after.events.slice(before.events.length);
  const nextOrdinal = Number((await client.query(
    'select coalesce(max(ordinal),0)+1 as ordinal from hunt_v3.run_events where run_id=$1 and revision=$2',
    [run.id, after.revision],
  )).rows[0].ordinal);
  const commandEvent = (await client.query(
    `insert into hunt_v3.run_events(run_id,team_id,revision,ordinal,event_type,actor_kind,actor_member_id,occurred_at,details,request_id)
      values($1,$2,$3,$4,'command_accepted','member',$5,$6,$7,$8) returning id`,
    [run.id, run.team_id, after.revision, nextOrdinal, memberId, events[0]?.at ?? new Date().toISOString(), { commandType: command.type }, requestId],
  )).rows[0];
  const baseOrdinal = nextOrdinal + 1;
  for (const [index, event] of events.entries()) {
    const saved = (await client.query(
      `insert into hunt_v3.run_events(run_id,team_id,revision,ordinal,event_type,actor_kind,actor_member_id,checkpoint_id,node_id,occurred_at,details,request_id)
        values($1,$2,$3,$4,$5,'member',$6,$7,$8,$9,$10,$11) returning id`,
      [run.id, run.team_id, after.revision, baseOrdinal + index, event.type, memberId,
        event.checkpointId ?? null, event.nodeId ?? null, event.at, event, requestId],
    )).rows[0];
    const contribution = run.contribution_eligible ? contributionFor(command, event) : null;
    if (contribution) await client.query(
      `insert into hunt_v3.run_contributions(run_id,team_id,member_id,source_event_id,source_key,category,credit,evidence,created_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [run.id, run.team_id, memberId, saved.id, `event:${after.revision}:${baseOrdinal + index}:${contribution.category}`,
        contribution.category, contribution.credit, { summary: contribution.evidence, eventType: event.type, checkpointId: event.checkpointId, nodeId: event.nodeId }, event.at],
    );
  }
  const ledger = after.ledger.slice(before.ledger.length);
  for (const entry of ledger) await appendScore(client, run.id, run.team_id, commandEvent.id, entry);
}

async function appendScore(client: PoolClient, runId: string, teamId: string, sourceEventId: number, entry: ScoreEntry) {
  if (entry.amount === 0) return;
  await client.query(
    `insert into hunt_v3.score_ledger(run_id,team_id,source_event_id,source_key,category,amount,counts_for_ranking,reason,details,created_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [runId, teamId, sourceEventId, entry.id, entry.kind, entry.amount, entry.countsForRanking !== false, entry.reason ?? entry.kind, entry, entry.at],
  );
}

export async function updateLiveRollup(client: PoolClient, runId: string) {
  const source = (await client.query(
    `select r.status,r.started_at,r.elapsed_ms,r.engine_state,clock_timestamp() as measured_at,
      greatest(r.updated_at,coalesce((select max(event.occurred_at) from hunt_v3.run_events event where event.run_id=r.id),r.updated_at)) as last_activity_at
      from hunt_v3.runs r where r.id=$1`,
    [runId],
  )).rows[0];
  if (!source) return;
  const measuredAt = new Date(source.measured_at).toISOString();
  const state = source.engine_state as GameState;
  const activeElapsed = source.status === 'active' && state.startedAt
    ? elapsedMilliseconds(state, state.startedAt, measuredAt)
    : source.elapsed_ms === null ? null : Number(source.elapsed_ms);
  await client.query(
    `insert into hunt_v3.live_team_rollups(
      team_id,hunt_id,active_run_id,best_run_id,run_number,member_count,checked_in_count,run_count,
      run_status,score,elapsed_ms,progress,current_checkpoint_id,route_variant,challenge_variant,last_activity_at,updated_at)
      select r.team_id,r.hunt_id,case when r.status in ('waiting','active') then r.id end,
        (select best.id from hunt_v3.runs best where best.team_id=r.team_id and best.status='completed' and best.eligible and not best.practice
          order by best.score desc,best.elapsed_ms asc,best.completed_at asc limit 1),
        r.run_number,
        (select count(*)::int from hunt_v3.team_members m where m.team_id=r.team_id and m.status in ('active','rostered')),
        (select count(*)::int from hunt_v3.team_members m where m.team_id=r.team_id and m.checked_in_at is not null),
        (select count(*)::int from hunt_v3.runs all_runs where all_runs.team_id=r.team_id),
        r.status,r.score,$2::bigint,r.progress,r.current_checkpoint_id,
        (select string_agg(value,' > ') from jsonb_array_elements_text(r.route_plan->'routeCheckpointIds') as route(value)),
        (select string_agg(value->>'variantId',', ') from jsonb_array_elements(r.route_plan->'challenges') as challenge(value) where value ? 'variantId'),
        $3::timestamptz,now()
      from hunt_v3.runs r where r.id=$1
      on conflict(team_id) do update set
        hunt_id=excluded.hunt_id,active_run_id=excluded.active_run_id,best_run_id=excluded.best_run_id,
        run_number=excluded.run_number,member_count=excluded.member_count,checked_in_count=excluded.checked_in_count,
        run_count=excluded.run_count,run_status=excluded.run_status,score=excluded.score,elapsed_ms=excluded.elapsed_ms,
        progress=excluded.progress,current_checkpoint_id=excluded.current_checkpoint_id,route_variant=excluded.route_variant,
        challenge_variant=excluded.challenge_variant,last_activity_at=excluded.last_activity_at,updated_at=now()`,
    [runId, activeElapsed, source.last_activity_at],
  );
}

export async function applyRunCommand(teamId: string, memberId: string, runId: string, requestId: string, input: unknown) {
  if (!isV3Uuid(runId)) throw new HttpError(400, 'Invalid run.');
  validRequestId(requestId);
  const command = parseCommand(input);
  if (command.type === 'start_session' || command.type === 'update_roster') throw new HttpError(400, 'Run and roster controls use their dedicated V3 actions.');
  const payloadHash = digest(canonicalJson({ operation: 'run_command', command }));
  const scopeKey = `run:${runId}`;
  const preflightReceipt = (await getPool().query(
    'select payload_hash from hunt_v3.command_receipts where scope_key=$1 and request_id=$2',
    [scopeKey, requestId],
  )).rows[0];
  if (preflightReceipt?.payload_hash !== payloadHash) {
    // Reserve all novel-command buckets before opening a transaction. The
    // limiter deliberately persists rejected attempts; a later receipt check
    // under the run lock closes the race with a concurrent identical request.
    // The member-wide backstop prevents a client from evading the per-run
    // bucket (and growing arbitrary limiter keys) by inventing run UUIDs.
    await rateLimitV3(`run-command:member:${teamId}:${memberId}`, 800);
    await rateLimitV3(`run-command:novel:${runId}:${memberId}`, 400);
    const needsAggregateAttemptBudget = command.type === 'verify' || command.type === 'submit_puzzle' || command.type === 'submit_hint_puzzle';
    const preflightRun = needsAggregateAttemptBudget ? (await getPool().query(
      `select v.definition,r.route_plan,r.engine_state from hunt_v3.runs r
        join hunt_v3.teams t on t.id=r.team_id and t.status='active'
        join hunt_v3.run_members rm on rm.run_id=r.id and rm.team_id=t.id and rm.member_id=$3
        join hunt_v3.team_members m on m.id=rm.member_id and m.team_id=t.id and m.status='active'
        join hunt_v3.hunt_versions v on v.hunt_id=r.hunt_id and v.version=r.hunt_version
        where r.id=$1 and r.team_id=$2`,
      [runId, teamId, memberId],
    )).rows[0] as { definition: V3Definition; route_plan: ResolvedRunPlan; engine_state: GameState } | undefined : undefined;
    const definition = preflightRun ? materializeRunDefinition(preflightRun.definition, preflightRun.route_plan) : undefined;
    const preflightBudget = definition && preflightRun
      ? runAttemptBudget(definition, preflightRun.engine_state, command, teamId, runId)
      : undefined;
    if (command.type === 'verify') {
      if (preflightBudget) {
        await rateLimitV3(`run-verifier:${runId}:${memberId}:${command.checkpointId}:${command.nodeId}`, 12);
      }
    } else if (command.type === 'submit_puzzle' || command.type === 'submit_hint_puzzle') {
      if (command.type === 'submit_puzzle') {
        if (preflightBudget) {
          await rateLimitV3(
            `run-puzzle-submit:${runId}:${memberId}:${command.checkpointId}:${command.nodeId}`,
            Math.max(12, preflightBudget.maximum),
          );
        }
      } else if (command.type === 'submit_hint_puzzle') {
        if (preflightBudget) {
          await rateLimitV3(
            `run-hint-puzzle-submit:${runId}:${memberId}:${command.checkpointId}:${command.hintId}`,
            Math.max(12, preflightBudget.maximum),
          );
        }
      }
    } else if (command.type === 'verify_gps') {
      await rateLimitV3(`run-gps:${runId}:${memberId}:${command.checkpointId}:${command.nodeId}`, 60);
    } else if (command.type === 'use_hint') {
      await rateLimitV3(`run-hint-use:${runId}:${memberId}`, 30);
    } else if (command.type === 'save_puzzle' || command.type === 'save_hint_puzzle') {
      await rateLimitV3(`run-puzzle-save:${runId}:${memberId}`, 240);
    }
  }
  return transaction(async client => {
    const identity = (await client.query("select hunt_id from hunt_v3.teams where id=$1 and status='active'", [teamId])).rows[0];
    if (!identity) throw new HttpError(404, 'Team not found.');
    const hunt = (await client.query('select status from hunt_v3.hunts where id=$1 for share', [identity.hunt_id])).rows[0];
    await client.query("select id from hunt_v3.teams where id=$1 and status='active' for share", [teamId]);
    const run = await loadRun(client, teamId, memberId, runId, true);
    const receipt = (await client.query(
      'select payload_hash,response from hunt_v3.command_receipts where scope_key=$1 and request_id=$2',
      [scopeKey, requestId],
    )).rows[0];
    if (receipt) {
      if (receipt.payload_hash !== payloadHash) throw new HttpError(409, 'This request ID was already used for another action.');
      return { view: await renderRun(client, run, memberId), feedback: receipt.response.feedback };
    }
    const definition = materializeRunDefinition(run.definition, run.route_plan);
    if (run.status !== 'active') throw new HttpError(409, 'This run is already complete. Start a replay to continue.');
    const attemptBudget = runAttemptBudget(definition, run.engine_state, command, teamId, run.id);
    if (attemptBudget) {
      await reserveV3RunAttempt(client, {
        ...attemptBudget,
        runId: run.id,
        teamId,
        requestId,
        payloadHash,
      });
    }
    const photoTaskStartedAt = command.type === 'submit_photo'
      ? run.engine_state.checkpoints[command.checkpointId]?.nodes[command.nodeId]?.startedAt
      : undefined;
    if (command.type === 'submit_photo' && !photoTaskStartedAt) {
      throw new HttpError(409, 'This photo belongs to an earlier task. Refresh and upload a new photo.');
    }
    if (command.type === 'submit_photo') {
      const media = await client.query(
        `select id from hunt_v3.media where id=$1 and team_id=$2 and run_id=$3 and member_id=$4
          and checkpoint_id=$5 and node_id=$6 and kind='photo' and review_status='pending'
          and parallel_mechanic_id is null and parallel_lane_id is null
          and task_started_at=$7::timestamptz
          and (expires_at is null or expires_at>now()) for update`,
        [command.mediaId, teamId, run.id, memberId, command.checkpointId, command.nodeId, photoTaskStartedAt],
      );
      if (!media.rowCount) throw new HttpError(400, 'Take or upload a photo for this task before submitting it.');
    }
    const now = await databaseNow(client);
    assertSessionPlayable(definition, run.engine_state, String(hunt?.status ?? run.hunt_status), now);
    const result = executeCommand(definition, run.engine_state, command, now);
    let reviewStartedAt: string | undefined;
    if (command.type === 'submit_photo') {
      const submitted = await client.query(
        `update hunt_v3.media set submitted_at=coalesce(submitted_at,$1)
          where id=$2 and team_id=$3 and run_id=$4 and member_id=$5
            and checkpoint_id=$6 and node_id=$7 and kind='photo' and review_status='pending'
            and parallel_mechanic_id is null and parallel_lane_id is null
            and task_started_at=$8::timestamptz
          returning submitted_at`,
        [now, command.mediaId, teamId, run.id, memberId, command.checkpointId, command.nodeId, photoTaskStartedAt],
      );
      if (!submitted.rowCount) throw new HttpError(409, 'This photo is no longer available for review. Upload it again.');
      reviewStartedAt = new Date(submitted.rows[0].submitted_at).toISOString();
    }
    const nextState = command.type === 'submit_photo'
      ? beginReviewClockPause(result.state, command.mediaId, reviewStartedAt!)
      : result.state;
    const elapsedMs = nextState.status === 'completed' && nextState.startedAt
      ? elapsedMilliseconds(nextState, nextState.startedAt, nextState.completedAt ?? now)
      : null;
    const recognitionClosesAt = nextState.status === 'completed' && nextState.completedAt && run.definition.settings.recognition.enabled
      ? new Date(Date.parse(nextState.completedAt) + run.definition.settings.recognition.votingWindowMinutes * 60_000).toISOString()
      : null;
    await client.query(
      `update hunt_v3.runs set engine_state=$1,status=$2,progress=$3,current_checkpoint_id=$4,
        completed_at=$5,elapsed_ms=$6,recognition_closes_at=$7,updated_at=$8 where id=$9`,
      [nextState, nextState.status === 'completed' ? 'completed' : 'active', stateProgress(nextState),
        nextState.activeCheckpointId, nextState.completedAt ?? null, elapsedMs, recognitionClosesAt, now, run.id],
    );
    await appendRunAudit(client, run, run.engine_state, nextState, memberId, requestId, command);
    if (nextState.status === 'completed' && run.engine_state.status !== 'completed' && run.definition.settings.recognition.enabled) {
      await recalculateRecognition(client, teamId, run.id);
    }
    await updateLiveRollup(client, run.id);
    await client.query(
      `insert into hunt_v3.command_receipts(scope_key,request_id,operation,team_id,run_id,member_id,payload_hash,response)
        values($1,$2,'run_command',$3,$4,$5,$6,$7)`,
      [scopeKey, requestId, teamId, run.id, memberId, payloadHash, { feedback: result.feedback }],
    );
    const refreshed = await loadRun(client, teamId, memberId, run.id);
    return { view: await renderRun(client, refreshed, memberId), feedback: result.feedback };
  });
}
