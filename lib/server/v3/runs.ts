import { randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { createInitialState, executeCommand, parseCommand } from '../../engine';
import type { GameCommand, GameEvent, GameState, ScoreEntry } from '../../engine/types';
import { assertSessionPlayable, assertStartWindow, beginReviewClockPause, elapsedMilliseconds, timerRemaining } from '../../engine/session';
import { planRun } from '../../v3/planning';
import type { ContributionCategory, ResolvedRunPlan, V3Definition } from '../../v3/types';
import { getPool, transaction } from '../db';
import { canonicalJson, digest, HttpError } from '../security';
import { recalculateRecognition } from './recognition';
import { materializeRunDefinition, materializeRunParallelMechanics, seededEngineRoutes, v3PlayerView } from './runtime';
import { rateLimitV3 } from './security';

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
};

function validRequestId(requestId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new HttpError(400, 'A valid request ID is required.');
  }
}

export async function databaseNow(client: PoolClient) {
  return new Date((await client.query('select clock_timestamp() as at')).rows[0].at).toISOString();
}

async function loadRun(client: PoolClient, teamId: string, memberId: string, runId?: string, lock = false): Promise<RunRow> {
  const selector = runId ? 'r.id=$3' : "r.status='active'";
  const query = `select r.*,v.definition,t.canonical_code,t.display_name,m.name as member_name,h.status as hunt_status
    from hunt_v3.runs r
    join hunt_v3.teams t on t.id=r.team_id and t.status='active'
    join hunt_v3.hunts h on h.id=r.hunt_id
    join hunt_v3.team_members m on m.id=$2 and m.team_id=t.id and m.status='active'
    join hunt_v3.hunt_versions v on v.hunt_id=r.hunt_id and v.version=r.hunt_version
    where r.team_id=$1 and ${selector}
    order by r.run_number desc limit 1${lock ? ' for update of r' : ''}`;
  const values = runId ? [teamId, memberId, runId] : [teamId, memberId];
  const run = (await client.query(query, values)).rows[0] as RunRow | undefined;
  if (!run) throw new HttpError(404, runId ? 'Run not found.' : 'This team has no active run.');
  return run;
}

async function renderRun(client: PoolClient, run: RunRow, memberId: string) {
  const now = await databaseNow(client);
  const parallelProgress: Record<string, Array<{ laneId: string; memberId: string; memberName: string; occurredAt: string }>> = {};
  for (const mechanic of materializeRunParallelMechanics(run.definition, run.route_plan)) {
    const mechanicStartedAt = run.engine_state.checkpoints[mechanic.checkpointId]?.startedAt ?? run.started_at;
    const rows = (await client.query(
      `select event.details->>'laneId' as lane_id,
        event.actor_member_id,member.name as member_name,event.occurred_at
        from hunt_v3.run_events event join hunt_v3.team_members member on member.id=event.actor_member_id
        where event.run_id=$1 and event.event_type='parallel_lane_completed'
          and event.details->>'mechanicId'=$2
          and event.occurred_at>=$3::timestamptz
        order by event.occurred_at desc,event.id desc`,
      [run.id, mechanic.id, mechanicStartedAt],
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
  return transaction(async client => {
    await client.query('set transaction isolation level repeatable read read only');
    return renderRun(client, await loadRun(client, teamId, memberId, runId), memberId);
  });
}

function runPolicy(settings: V3Definition['settings'], previousOfficialAttempts: number, requestedPractice: boolean) {
  if (previousOfficialAttempts === 0) {
    if (requestedPractice) throw new HttpError(409, 'Complete an official run before starting practice attempts.');
    return { practice: false, eligible: true };
  }
  const policy = settings.runPolicy;
  if (policy.mode === 'disabled') throw new HttpError(409, 'This hunt allows one official run per team.');
  if (policy.mode === 'capped' && previousOfficialAttempts >= (policy.maxOfficialRuns ?? 1)) {
    throw new HttpError(409, `This team has used all ${policy.maxOfficialRuns ?? 1} official runs.`);
  }
  const practice = requestedPractice || policy.mode === 'practice-only';
  return { practice, eligible: !practice };
}

async function terminalizeExpiredRun(
  client: PoolClient,
  run: { id: string; team_id: string; hunt_id: string; engine_state: GameState },
  now: string,
) {
  if (!run.engine_state.timer || (timerRemaining(run.engine_state, now) ?? 1) > 0) return false;
  const elapsedMs = run.engine_state.startedAt ? elapsedMilliseconds(run.engine_state, run.engine_state.startedAt, now) : 0;
  await client.query(
    `update hunt_v3.runs set status='abandoned',eligible=false,elapsed_ms=$1,updated_at=$2
      where id=$3 and status='active'`,
    [elapsedMs, now, run.id],
  );
  const ordinal = Number((await client.query(
    'select coalesce(max(ordinal),0)+1 as ordinal from hunt_v3.run_events where run_id=$1 and revision=$2',
    [run.id, run.engine_state.revision],
  )).rows[0].ordinal);
  await client.query(
    `insert into hunt_v3.run_events(
      run_id,team_id,revision,ordinal,actor_kind,event_type,details,occurred_at)
      values($1,$2,$3,$4,'system','run_timed_out',$5,$6)`,
    [run.id, run.team_id, run.engine_state.revision, ordinal, { reason: 'session_duration_expired', elapsedMs }, now],
  );
  await client.query(
    `insert into hunt_v3.admin_events(action,hunt_id,team_id,run_id,reason,details)
      values('run_timed_out',$1,$2,$3,'Session duration expired',$4)`,
    [run.hunt_id, run.team_id, run.id, { elapsedMs }],
  );
  await updateLiveRollup(client, run.id);
  return true;
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
    const identity = (await client.query("select hunt_id from hunt_v3.teams where id=$1 and status='active'", [teamId])).rows[0];
    if (!identity) throw new HttpError(404, 'Team not found.');
    const hunt = (await client.query(
      `select h.*,v.definition,v.fairness_report
        from hunt_v3.hunts h join hunt_v3.hunt_versions v on v.hunt_id=h.id and v.version=h.latest_version
        where h.id=$1 for share of h`,
      [identity.hunt_id],
    )).rows[0] as ({ definition: V3Definition; fairness_report: { valid?: boolean } } & Record<string, unknown>) | undefined;
    if (!hunt) throw new HttpError(404, 'Hunt not found.');
    await client.query('select id from hunt_v3.teams where id=$1 for update', [teamId]);
    const member = (await client.query("select id from hunt_v3.team_members where id=$1 and team_id=$2 and status='active'", [memberId, teamId])).rows[0];
    if (!member) throw new HttpError(401, 'Your team membership changed. Sign in again.');

    const receipt = (await client.query(
      'select payload_hash,response from hunt_v3.command_receipts where scope_key=$1 and request_id=$2',
      [scopeKey, requestId],
    )).rows[0];
    if (receipt) {
      if (receipt.payload_hash !== payloadHash) throw new HttpError(409, 'This request ID was already used for another action.');
      return renderRun(client, await loadRun(client, teamId, memberId, receipt.response.runId), memberId);
    }
    if (!hunt.fairness_report?.valid) throw new HttpError(409, 'This hunt version has not passed V3 fairness validation.');
    const activeMembers = Number((await client.query(
      "select count(*)::int as count from hunt_v3.team_members where team_id=$1 and status='active' and checked_in_at is not null",
      [teamId],
    )).rows[0].count);
    const minimumMembers = Number(hunt.definition.settings.minTeamSize ?? 1);
    if (activeMembers < minimumMembers) {
      throw new HttpError(409, `At least ${minimumMembers} checked-in team members are required to start.`);
    }

    let active = (await client.query(
      "select id,team_id,hunt_id,engine_state from hunt_v3.runs where team_id=$1 and status='active' order by run_number desc limit 1 for update",
      [teamId],
    )).rows[0] as ({ id: string; team_id: string; hunt_id: string; engine_state: GameState } | undefined);
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

    const counts = (await client.query(
      `select count(*)::int as total,
        count(*) filter(where not practice)::int as official
        from hunt_v3.runs where team_id=$1`,
      [teamId],
    )).rows[0];
    let policy: ReturnType<typeof runPolicy>;
    try {
      policy = runPolicy(hunt.definition.settings, Number(counts.official), requestedPractice);
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
    const plan = planRun(hunt.definition, privateSeed);
    const now = await databaseNow(client);
    const runId = randomUUID();
    const engineDefinition = materializeRunDefinition(hunt.definition, plan);
    assertStartWindow(engineDefinition, String(hunt.status), now);
    const state = createInitialState(engineDefinition, runId, now, {
      routeAssignments: seededEngineRoutes(engineDefinition, privateSeed, now),
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
        id,team_id,hunt_id,hunt_version,run_number,private_seed,seed_commitment,route_plan,resolved_variables,
        engine_state,status,practice,eligible,score,progress,current_checkpoint_id,started_at,completed_at,elapsed_ms,recognition_closes_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,$15,$16,$17,$18,$19)`,
      [runId, teamId, identity.hunt_id, hunt.definition.version, runNumber, privateSeed, digest(privateSeed), plan, plan.variables,
        state, state.status === 'completed' ? 'completed' : 'active', policy.practice, policy.eligible, stateProgress(state),
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
      [runId, teamId, memberId, now, { runNumber, practice: policy.practice }, requestId],
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
  if ('deferredRunPolicyError' in outcome) {
    const error = outcome.deferredRunPolicyError;
    throw new HttpError(error.status, error.message, error.details);
  }
  return outcome;
}

export function stateProgress(state: GameState) {
  const values = Object.values(state.checkpoints);
  return values.length ? values.filter(checkpoint => ['completed', 'skipped'].includes(checkpoint.status)).length / values.length : 0;
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
    const contribution = contributionFor(command, event);
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
    const interactionLimit = (type: string | undefined) =>
      type && ['jigsaw', 'sudoku', 'word_search', 'crossword', 'rotation', 'quiz', 'matching', 'sequence'].includes(type)
        ? 240
        : 20;
    if (command.type === 'verify') {
      await rateLimitV3(`run-verifier:${runId}:${memberId}:${command.checkpointId}:${command.nodeId}`, 12);
    } else if (command.type === 'submit_puzzle' || command.type === 'submit_hint_puzzle') {
      const preflightRun = (await getPool().query(
        `select v.definition,r.route_plan from hunt_v3.runs r
          join hunt_v3.teams t on t.id=r.team_id and t.status='active'
          join hunt_v3.team_members m on m.id=$3 and m.team_id=t.id and m.status='active'
          join hunt_v3.hunt_versions v on v.hunt_id=r.hunt_id and v.version=r.hunt_version
          where r.id=$1 and r.team_id=$2`,
        [runId, teamId, memberId],
      )).rows[0] as { definition: V3Definition; route_plan: ResolvedRunPlan } | undefined;
      const definition = preflightRun ? materializeRunDefinition(preflightRun.definition, preflightRun.route_plan) : undefined;
      if (command.type === 'submit_puzzle') {
        const node = definition?.checkpoints.find(checkpoint => checkpoint.id === command.checkpointId)
          ?.flow.nodes.find(candidate => candidate.id === command.nodeId);
        await rateLimitV3(
          `run-puzzle-submit:${runId}:${memberId}:${command.checkpointId}:${command.nodeId}`,
          interactionLimit(node?.type === 'puzzle' ? node.puzzle.type : undefined),
        );
      } else if (command.type === 'submit_hint_puzzle') {
        const hint = definition?.checkpoints.find(checkpoint => checkpoint.id === command.checkpointId)
          ?.hints.find(candidate => candidate.id === command.hintId);
        await rateLimitV3(
          `run-hint-puzzle-submit:${runId}:${memberId}:${command.checkpointId}:${command.hintId}`,
          interactionLimit(hint?.content.type === 'puzzle' ? hint.content.puzzle.type : undefined),
        );
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
    if (command.type === 'submit_photo') {
      const media = await client.query(
        `select id from hunt_v3.media where id=$1 and team_id=$2 and run_id=$3 and member_id=$4
          and checkpoint_id=$5 and node_id=$6 and kind='photo' and review_status='pending'
          and parallel_mechanic_id is null and parallel_lane_id is null
          and (expires_at is null or expires_at>now()) for update`,
        [command.mediaId, teamId, run.id, memberId, command.checkpointId, command.nodeId],
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
          returning submitted_at`,
        [now, command.mediaId, teamId, run.id, memberId, command.checkpointId, command.nodeId],
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
