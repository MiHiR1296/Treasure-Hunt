import { createHmac, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { executeControl } from '../../engine';
import type { GameState, ScoreEntry } from '../../engine/types';
import { elapsedMilliseconds, endReviewClockPause, pauseRunClock, resumeRunClock } from '../../engine/session';
import type { ResolvedRunPlan, V3Definition } from '../../v3/types';
import { getPool, transaction } from '../db';
import { canonicalJson, digest, hashPin, HttpError, verifyPin } from '../security';
import { formatTeamCode, normalizedKey, validateMemberName, validateOptionalTeamName } from './names';
import { publicLeaderboard } from './leaderboards';
import { materializeRunDefinition, materializeRunParallelMechanics } from './runtime';
import { recalculateRecognition } from './recognition';
import { stateProgress, updateLiveRollup } from './runs';

const OBSERVED_FAIRNESS_MIN_SAMPLES = 4;
const OBSERVED_FAIRNESS_SCORE_GAP = 10;
const OBSERVED_FAIRNESS_SCORE_RATIO = 0.1;
const OBSERVED_FAIRNESS_TIME_GAP_MS = 5 * 60_000;
const OBSERVED_FAIRNESS_TIME_RATIO = 0.2;

export interface ObservedFairnessGroup {
  kind: 'route' | 'variant';
  cohortKey: string;
  groupKey: string;
  label: string;
  samples: number;
  teamSamples: number;
  averageScore: number;
  medianElapsedMilliseconds: number;
}

export interface ObservedFairnessSignal extends ObservedFairnessGroup {
  alert: {
    id: string;
    type: 'fairness';
    label: string;
    detail: string;
    severity: 'warning';
  };
}

const rounded = (value: number) => Number(value.toFixed(1));

/**
 * Observed fairness is an operational signal, not a publication verdict. It is
 * deliberately conservative: a cohort needs two independently sampled groups,
 * and a group must clear both an absolute and relative materiality floor.
 */
export function observedFairnessSignals(groups: readonly ObservedFairnessGroup[]): ObservedFairnessSignal[] {
  const eligible = groups.filter(group =>
    group.samples >= OBSERVED_FAIRNESS_MIN_SAMPLES &&
    group.teamSamples >= OBSERVED_FAIRNESS_MIN_SAMPLES &&
    Number.isFinite(group.averageScore) &&
    Number.isFinite(group.medianElapsedMilliseconds) &&
    group.medianElapsedMilliseconds >= 0,
  );
  const cohorts = new Map<string, ObservedFairnessGroup[]>();
  for (const group of eligible) {
    const key = `${group.kind}\u0000${group.cohortKey}`;
    cohorts.set(key, [...(cohorts.get(key) ?? []), group]);
  }

  const signals: ObservedFairnessSignal[] = [];
  for (const peers of cohorts.values()) {
    if (peers.length < 2) continue;
    const bestScore = Math.max(...peers.map(group => group.averageScore));
    const fastestMedian = Math.min(...peers.map(group => group.medianElapsedMilliseconds));
    const scoreThreshold = Math.max(OBSERVED_FAIRNESS_SCORE_GAP, Math.abs(bestScore) * OBSERVED_FAIRNESS_SCORE_RATIO);
    const timeThreshold = Math.max(OBSERVED_FAIRNESS_TIME_GAP_MS, fastestMedian * OBSERVED_FAIRNESS_TIME_RATIO);
    for (const group of peers) {
      const scoreGap = bestScore - group.averageScore;
      const timeGap = group.medianElapsedMilliseconds - fastestMedian;
      const observations: string[] = [];
      if (scoreGap >= scoreThreshold) observations.push(`${rounded(scoreGap)} fewer average points`);
      if (timeGap >= timeThreshold) observations.push(`${rounded(timeGap / 60_000)} minutes slower median time`);
      if (!observations.length) continue;
      const kindLabel = group.kind === 'route' ? 'route' : 'challenge variant';
      signals.push({
        ...group,
        alert: {
          id: `fairness:${group.kind}:${group.cohortKey}:${group.groupKey}`,
          type: 'fairness',
          label: group.kind === 'route' ? 'Observed route gap' : 'Observed variant gap',
          detail: `Across ${group.samples} eligible completions from ${group.teamSamples} teams, ${kindLabel} “${group.label}” has ${observations.join(' and ')} than its sampled peers. This is an operational signal for review, not proof of unfairness.`,
          severity: 'warning',
        },
      });
    }
  }
  return signals.sort((left, right) => left.alert.id.localeCompare(right.alert.id));
}

export function analyticsPeopleLabel(registrationMode: string) {
  return registrationMode === 'rostered' ? 'rostered/check-in members' : 'declared members';
}

async function observedFairnessGroups(huntId: string): Promise<ObservedFairnessGroup[]> {
  const { rows } = await getPool().query(
    `with eligible as (
      select id,team_id,score::float8 as score,elapsed_ms::float8 as elapsed_ms,route_plan
      from hunt_v3.runs
      where hunt_id=$1 and status='completed' and eligible and not practice and elapsed_ms is not null
    ), route_observations as (
      select id,team_id,score,elapsed_ms,route_plan->'routeCheckpointIds' as route_ids,
        (select string_agg(part.value,' → ' order by part.ordinality)
          from jsonb_array_elements_text(route_plan->'routeCheckpointIds') with ordinality part(value,ordinality)) as label
      from eligible where jsonb_typeof(route_plan->'routeCheckpointIds')='array'
    ), variant_observations as (
      select eligible.id,eligible.team_id,eligible.score,eligible.elapsed_ms,
        coalesce(nullif(challenge.value->>'poolId',''),nullif(challenge.value->>'routeCheckpointId','')) as cohort_key,
        challenge.value->>'variantId' as variant_id
      from eligible
      cross join lateral jsonb_array_elements(coalesce(eligible.route_plan->'challenges','[]'::jsonb)) challenge(value)
      where nullif(challenge.value->>'variantId','') is not null
        and coalesce(nullif(challenge.value->>'poolId',''),nullif(challenge.value->>'routeCheckpointId','')) is not null
    )
    select 'route' as kind,'all-routes' as cohort_key,route_ids::text as group_key,label,
      count(*)::int as samples,count(distinct team_id)::int as team_samples,avg(score)::float8 as average_score,
      percentile_cont(0.5) within group(order by elapsed_ms)::float8 as median_elapsed_ms
    from route_observations group by route_ids,label
    union all
    select 'variant' as kind,cohort_key,cohort_key||':'||variant_id as group_key,variant_id as label,
      count(*)::int as samples,count(distinct team_id)::int as team_samples,avg(score)::float8 as average_score,
      percentile_cont(0.5) within group(order by elapsed_ms)::float8 as median_elapsed_ms
    from variant_observations group by cohort_key,variant_id`,
    [huntId],
  );
  return rows.map(row => ({
    kind: row.kind as 'route' | 'variant',
    cohortKey: String(row.cohort_key),
    groupKey: String(row.group_key),
    label: String(row.label),
    samples: Number(row.samples),
    teamSamples: Number(row.team_samples),
    averageScore: Number(row.average_score),
    medianElapsedMilliseconds: Number(row.median_elapsed_ms),
  }));
}

export async function liveOperations(huntId?: string, search = '') {
  const { rows: hunts } = await getPool().query(
    `select h.id,h.title,h.slug,h.status,h.registration_mode,h.registration_open,h.latest_version,h.lifecycle_revision,
      b.enabled as public_board_enabled,b.slug as public_board_slug,b.title as public_board_title,
      b.cover_ref as public_board_cover_ref,b.event_status as public_board_status,
      b.visible_columns as public_board_columns,b.main_board_visible as public_board_main_visible,
      b.replay_board_visible as public_board_replay_visible,b.team_name_mode as public_board_team_name_mode
      from hunt_v3.hunts h left join hunt_v3.public_boards b on b.hunt_id=h.id
      order by h.created_at desc`,
  );
  const selected = huntId || hunts[0]?.id;
  if (!selected) return { measuredAt: new Date().toISOString(), hunts, teams: [], alerts: { help: 0, photos: 0, stalled: 0, fairness: 0 } };
  if (!hunts.some(hunt => hunt.id === selected)) throw new HttpError(404, 'Hunt not found.');
  const term = search.normalize('NFKC').trim().slice(0, 100);
  const measuredAt = new Date((await getPool().query('select clock_timestamp() as at')).rows[0].at).toISOString();
  const { rows: teams } = await getPool().query(
    `select t.id,t.canonical_code,t.display_name,t.name_status,t.status,t.created_at,
      coalesce(m.members,'[]'::jsonb) as members,coalesce(m.member_count,0) as member_count,
      coalesce(m.checked_in_count,0) as checked_in_count,
      live.active_run_id,live.best_run_id,live.run_number,live.run_count,live.current_checkpoint_id,
      live.score,live.elapsed_ms,live.progress,live.run_status,live.route_variant,live.challenge_variant,
      coalesce(live.alerts,'[]'::jsonb) as cached_alerts,
      (displayed.route_plan->'routeCheckpointIds')::text as fairness_route_key,
      coalesce((select array_agg(
        coalesce(nullif(challenge.value->>'poolId',''),nullif(challenge.value->>'routeCheckpointId',''))||':'||(challenge.value->>'variantId')
        order by challenge.ordinality)
        from jsonb_array_elements(coalesce(displayed.route_plan->'challenges','[]'::jsonb)) with ordinality challenge(value,ordinality)
        where nullif(challenge.value->>'variantId','') is not null
          and coalesce(nullif(challenge.value->>'poolId',''),nullif(challenge.value->>'routeCheckpointId','')) is not null),array[]::text[]) as fairness_variant_keys,
      coalesce(activity.last_activity_at,live.last_activity_at,t.updated_at) as last_activity_at,live.updated_at,
      (exists(select 1 from jsonb_array_elements(coalesce(active.engine_state->'clockPauses','[]'::jsonb)) pause(value)
          where not (pause.value ? 'endedAt'))
        or exists(select 1 from jsonb_array_elements(coalesce(active.engine_state->'timer'->'pauses','[]'::jsonb)) pause(value)
          where not (pause.value ? 'endedAt'))) as active_clock_paused,
      best.score as best_score,best.elapsed_ms as best_elapsed_ms,best.run_number as best_run_number,
      coalesce(help.open_help,0) as open_help,coalesce(photo.pending_photos,0) as pending_photos,
      (live.run_status='active' and coalesce(activity.last_activity_at,live.last_activity_at,t.updated_at)<clock_timestamp()-interval '10 minutes') as stalled
      from hunt_v3.teams t
      left join hunt_v3.live_team_rollups live on live.team_id=t.id
      left join hunt_v3.runs active on active.id=live.active_run_id
      left join hunt_v3.runs displayed on displayed.id=coalesce(live.active_run_id,live.best_run_id)
      left join lateral (
        select max(event.occurred_at) as last_activity_at from hunt_v3.run_events event where event.run_id=active.id
      ) activity on true
      left join hunt_v3.runs best on best.id=live.best_run_id
      left join lateral (
        select jsonb_agg(jsonb_build_object('id',member.id,'name',member.name,'status',member.status,'checkedIn',member.checked_in_at is not null) order by member.created_at,member.id) as members,
          count(*)::int as member_count,count(*) filter(where member.checked_in_at is not null)::int as checked_in_count
        from hunt_v3.team_members member where member.team_id=t.id and member.status<>'removed'
      ) m on true
      left join lateral (select count(*)::int as open_help from hunt_v3.help_requests request where request.team_id=t.id and request.status='open') help on true
      left join lateral (select count(*)::int as pending_photos from hunt_v3.media item where item.team_id=t.id and item.kind='photo' and item.review_status='pending' and item.submitted_at is not null) photo on true
      where t.hunt_id=$1 and ($2='' or t.canonical_code ilike '%'||$2||'%' or coalesce(t.display_name,'') ilike '%'||$2||'%'
        or exists(select 1 from hunt_v3.team_members member where member.team_id=t.id and member.name ilike '%'||$2||'%'))
      order by coalesce(live.last_activity_at,t.updated_at) desc,t.canonical_code limit 500`,
    [selected, term],
  );
  const [globalAlertsResult, fairnessGroups] = await Promise.all([
    getPool().query(
      `select
      (select count(*)::int from hunt_v3.help_requests request
        join hunt_v3.teams team on team.id=request.team_id
        where team.hunt_id=$1 and team.status<>'archived' and request.status='open') as help,
      (select count(*)::int from hunt_v3.media item
        join hunt_v3.teams team on team.id=item.team_id
        where team.hunt_id=$1 and team.status<>'archived' and item.kind='photo' and item.review_status='pending' and item.submitted_at is not null) as photos,
      (select count(*)::int from hunt_v3.live_team_rollups live
        join hunt_v3.teams team on team.id=live.team_id
        join hunt_v3.runs active on active.id=live.active_run_id
        where team.hunt_id=$1 and team.status<>'archived' and live.run_status='active'
        and greatest(active.updated_at,coalesce((select max(event.occurred_at) from hunt_v3.run_events event where event.run_id=active.id),active.updated_at))
          <clock_timestamp()-interval '10 minutes') as stalled`,
      [selected],
    ),
    observedFairnessGroups(selected),
  ]);
  const globalAlerts = globalAlertsResult.rows[0];
  const fairnessSignals = observedFairnessSignals(fairnessGroups);
  const routeSignals = new Map(fairnessSignals.filter(signal => signal.kind === 'route').map(signal => [signal.groupKey, signal.alert]));
  const variantSignals = new Map(fairnessSignals.filter(signal => signal.kind === 'variant').map(signal => [signal.groupKey, signal.alert]));
  const fairnessAlertsFor = (team: typeof teams[number]) => [
    ...(team.fairness_route_key && routeSignals.has(team.fairness_route_key) ? [routeSignals.get(team.fairness_route_key)!] : []),
    ...((Array.isArray(team.fairness_variant_keys) ? team.fairness_variant_keys : []) as string[])
      .flatMap(key => variantSignals.has(key) ? [variantSignals.get(key)!] : []),
  ];
  const publicBoard = (hunt: typeof hunts[number]) => hunt.public_board_slug ? {
    enabled: Boolean(hunt.public_board_enabled),
    slug: hunt.public_board_slug,
    url: `/board/${hunt.public_board_slug}`,
    title: hunt.public_board_title,
    cover: hunt.public_board_cover_ref,
    status: hunt.public_board_status,
    columns: Array.isArray(hunt.public_board_columns) ? hunt.public_board_columns : [],
    mainBoardVisible: Boolean(hunt.public_board_main_visible),
    replayBoardVisible: Boolean(hunt.public_board_replay_visible),
    showTeamNames: hunt.public_board_team_name_mode === 'display_name',
  } : null;
  const selectedHunt = hunts.find(hunt => hunt.id === selected)!;
  return {
    measuredAt,
    hunts: hunts.map(hunt => ({
      id: hunt.id,
      title: hunt.title,
      slug: hunt.slug,
      status: hunt.status,
      registrationMode: String(hunt.registration_mode).replaceAll('_', '-'),
      registrationOpen: hunt.registration_open,
      version: hunt.latest_version,
      lifecycleRevision: hunt.lifecycle_revision,
      publicBoard: publicBoard(hunt),
    })),
    selectedHuntId: selected,
    publicBoard: publicBoard(selectedHunt),
    teams: teams.map(team => ({
      id: team.id,
      code: team.canonical_code,
      displayName: team.display_name,
      label: team.display_name ? `${team.canonical_code} · ${team.display_name}` : team.canonical_code,
      nameStatus: team.name_status,
      status: team.status,
      members: team.members,
      memberCount: team.member_count,
      checkedInCount: team.checked_in_count,
      activeRunId: team.active_run_id,
      bestRunId: team.best_run_id,
      runNumber: team.run_number,
      runCount: team.run_count,
      checkpoint: team.current_checkpoint_id,
      score: team.score ?? 0,
      elapsedMilliseconds: team.elapsed_ms === null ? null : Number(team.elapsed_ms)
        + (team.active_run_id && team.run_status === 'active' && selectedHunt.status === 'live'
          && !team.active_clock_paused && team.updated_at
          ? Math.max(0, Date.parse(measuredAt) - new Date(team.updated_at).getTime())
          : 0),
      progress: team.progress === null ? 0 : Number(team.progress),
      runStatus: team.run_status,
      routeVariant: team.route_variant,
      challengeVariant: team.challenge_variant,
      bestRun: team.best_run_id ? { id: team.best_run_id, runNumber: team.best_run_number, score: team.best_score, elapsedMilliseconds: Number(team.best_elapsed_ms) } : null,
      lastActivityAt: team.last_activity_at,
      alerts: [
        ...(team.stalled ? [{ type: 'stalled', label: 'Stalled 10+ min' }] : []),
        ...(team.open_help ? [{ type: 'help', label: `${team.open_help} help request${team.open_help === 1 ? '' : 's'}` }] : []),
        ...(team.pending_photos ? [{ type: 'photo', label: `${team.pending_photos} photo${team.pending_photos === 1 ? '' : 's'} to review` }] : []),
        ...fairnessAlertsFor(team),
        ...(Array.isArray(team.cached_alerts) ? team.cached_alerts : []),
      ],
    })),
    alerts: {
      help: Number(globalAlerts.help),
      photos: Number(globalAlerts.photos),
      stalled: Number(globalAlerts.stalled),
      fairness: fairnessSignals.length,
    },
  };
}

export async function eventAnalytics(huntId: string) {
  const hunt = (await getPool().query('select id,title,registration_mode from hunt_v3.hunts where id=$1', [huntId])).rows[0];
  if (!hunt) throw new HttpError(404, 'Hunt not found.');
  const [counts, improvements, checkpoints, routes, variants, contributions, recognition, ties, registration] = await Promise.all([
    getPool().query(
      `select
        (select count(*)::int from hunt_v3.teams where hunt_id=$1 and status<>'archived') as teams,
        (select count(*)::int from hunt_v3.team_members m join hunt_v3.teams t on t.id=m.team_id where t.hunt_id=$1 and m.status<>'removed') as members,
        (select count(*)::int from hunt_v3.team_members m join hunt_v3.teams t on t.id=m.team_id where t.hunt_id=$1 and m.checked_in_at is not null) as checked_in,
        count(*)::int as runs,count(*) filter(where started_at is not null)::int as starts,
        count(*) filter(where status='completed')::int as completions,
        count(*) filter(where run_number>1)::int as replays,
        count(distinct team_id) filter(where status='completed')::int as finishing_teams
        from hunt_v3.runs where hunt_id=$1`, [huntId]),
    getPool().query(
      `with eligible as (
        select *,row_number() over(partition by team_id order by run_number) as first_order,
          row_number() over(partition by team_id order by score desc,elapsed_ms asc,completed_at asc) as best_order
        from hunt_v3.runs where hunt_id=$1 and status='completed' and eligible and not practice
      ), repeat_teams as (
        select team_id from eligible group by team_id having count(*)>=2
      ), paired as (
        select first.team_id,first.score as first_score,best.score as best_score,
          first.elapsed_ms as first_time,best.elapsed_ms as best_time
        from eligible first join eligible best using(team_id) join repeat_teams using(team_id)
        where first.first_order=1 and best.best_order=1
      ) select count(*)::int as teams,
        coalesce(avg(best_score-first_score),0)::float as average_score_improvement,
        coalesce(avg(first_time-best_time),0)::float as average_time_improvement_ms,
        coalesce(max(best_score-first_score),0)::int as maximum_score_improvement from paired`, [huntId]),
    getPool().query(
      `with scoped_runs as (
        select id,status from hunt_v3.runs where hunt_id=$1
      ), starts as (
        select event.run_id,event.checkpoint_id,min(event.occurred_at) as started_at
        from hunt_v3.run_events event join scoped_runs run on run.id=event.run_id
        where event.event_type='checkpoint_started' and event.checkpoint_id is not null
        group by event.run_id,event.checkpoint_id
      ), completions as (
        select event.run_id,event.checkpoint_id,min(event.occurred_at) as completed_at
        from hunt_v3.run_events event join scoped_runs run on run.id=event.run_id
        where event.event_type='checkpoint_completed' and event.checkpoint_id is not null
        group by event.run_id,event.checkpoint_id
      ), timing as (
        select start.checkpoint_id,count(*)::int as attempts,count(finish.completed_at)::int as completions,
          count(*) filter(where run.status in('abandoned','disqualified') and finish.completed_at is null)::int as abandonments,
          percentile_cont(0.5) within group(order by extract(epoch from (finish.completed_at-start.started_at)))
            filter(where finish.completed_at is not null) as median_seconds
        from starts start join scoped_runs run on run.id=start.run_id
        left join completions finish using(run_id,checkpoint_id)
        group by start.checkpoint_id
      ), event_counts as (
        select event.checkpoint_id,
          count(*) filter(where event.event_type in('verification_failed','parallel_lane_failed','photo_rejected'))::int as failures,
          count(*) filter(where event.event_type='hint_used')::int as hints
        from hunt_v3.run_events event join scoped_runs run on run.id=event.run_id
        where event.checkpoint_id is not null group by event.checkpoint_id
      ) select coalesce(timing.checkpoint_id,event_counts.checkpoint_id) as checkpoint_id,
        coalesce(timing.attempts,0) as attempts,coalesce(timing.completions,0) as completions,
        coalesce(event_counts.failures,0) as failures,coalesce(event_counts.hints,0) as hints,
        coalesce(timing.abandonments,0) as abandonments,timing.median_seconds
        from timing full join event_counts using(checkpoint_id)
        order by checkpoint_id`, [huntId]),
    getPool().query(
      `select route_plan->'routeCheckpointIds' as route, count(*)::int as runs,
        avg(score) filter(where status='completed' and eligible and not practice)::float as average_score,
        avg(elapsed_ms) filter(where status='completed' and eligible and not practice)::float as average_elapsed_ms,
        count(*) filter(where status='completed' and eligible and not practice)::int as completions
        from hunt_v3.runs where hunt_id=$1 group by route_plan->'routeCheckpointIds' order by runs desc`, [huntId]),
    getPool().query(
      `select challenge.value->>'variantId' as variant_id,count(*)::int as runs,
        avg(run.score) filter(where run.status='completed' and run.eligible and not run.practice)::float as average_score,
        avg(run.elapsed_ms) filter(where run.status='completed' and run.eligible and not run.practice)::float as average_elapsed_ms,
        count(*) filter(where run.status='completed' and run.eligible and not run.practice)::int as completions
        from hunt_v3.runs run
        cross join lateral jsonb_array_elements(run.route_plan->'challenges') challenge(value)
        where run.hunt_id=$1 and challenge.value ? 'variantId'
        group by challenge.value->>'variantId' order by runs desc,variant_id`, [huntId]),
    getPool().query(
      `select contribution.category,count(*)::int as events,sum(contribution.credit)::float as credits,
        count(distinct contribution.member_id)::int as members
        from hunt_v3.run_contributions contribution join hunt_v3.runs run on run.id=contribution.run_id
        where run.hunt_id=$1 group by contribution.category order by credits desc`, [huntId]),
    getPool().query(
      `with eligible as (
        select member.run_id,member.member_id from hunt_v3.run_members member
        join hunt_v3.runs run on run.id=member.run_id
        where run.hunt_id=$1 and run.status='completed' and run.recognition_closes_at is not null
      ), latest_votes as (
        select distinct on(vote.run_id,vote.voter_member_id)
          vote.run_id,vote.voter_member_id,vote.is_withdrawal,vote.revision
        from hunt_v3.recognition_votes vote join hunt_v3.runs run on run.id=vote.run_id
        where run.hunt_id=$1 order by vote.run_id,vote.voter_member_id,vote.revision desc,vote.id desc
      ) select
        (select count(*)::int from eligible) as eligible_members,
        count(*) filter(where not is_withdrawal)::int as voters,
        coalesce(sum(revision),0)::int as vote_revisions,
        count(distinct run_id) filter(where not is_withdrawal)::int as runs_with_votes
        from latest_votes`, [huntId]),
    getPool().query(
      `with best as (select distinct on(team_id) team_id,score,elapsed_ms,completed_at from hunt_v3.runs
        where hunt_id=$1 and status='completed' and eligible and not practice order by team_id,score desc,elapsed_ms asc,completed_at asc)
        select score,elapsed_ms,
          to_char(completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as completed_at,
          count(*)::int as teams
        from best group by score,elapsed_ms,completed_at having count(*)>1
        order by score desc,elapsed_ms,completed_at`, [huntId]),
    getPool().query(
      `select count(*)::int as teams,
        count(*) filter(where exists(select 1 from hunt_v3.team_members member where member.team_id=team.id))::int as teams_with_members,
        count(*) filter(where exists(select 1 from hunt_v3.team_members member where member.team_id=team.id and member.checked_in_at is not null))::int as checked_in_teams
        from hunt_v3.teams team where hunt_id=$1`, [huntId]),
  ]);
  const metrics = {
    hunt: { id: hunt.id, title: hunt.title },
    peopleLabel: analyticsPeopleLabel(hunt.registration_mode),
    funnel: counts.rows[0],
    improvement: improvements.rows[0],
    checkpoints: checkpoints.rows,
    routes: routes.rows.map(row => ({ ...row, averageElapsedMilliseconds: row.average_elapsed_ms === null ? null : Number(row.average_elapsed_ms) })),
    variants: [
      ...routes.rows.map(row => ({
        label: Array.isArray(row.route) ? `Route: ${row.route.join(' → ')}` : 'Route',
        runs: row.runs,
        completions: row.completions,
        average_score: row.average_score,
        average_elapsed_ms: row.average_elapsed_ms === null ? null : Number(row.average_elapsed_ms),
        detail: 'Physical route performance',
      })),
      ...variants.rows.map(row => ({
        label: `Variant: ${row.variant_id}`,
        runs: row.runs,
        completions: row.completions,
        average_score: row.average_score,
        average_elapsed_ms: row.average_elapsed_ms === null ? null : Number(row.average_elapsed_ms),
        detail: 'Challenge-pool variant performance',
      })),
    ],
    contributions: contributions.rows,
    recognition: recognition.rows[0],
    ties: ties.rows.map(row => ({ score: row.score, elapsedMilliseconds: Number(row.elapsed_ms), completedAt: row.completed_at, teams: row.teams })),
    registration: {
      teams: registration.rows[0].teams,
      [hunt.registration_mode === 'rostered' ? 'rostered teams' : 'teams with declared members']: registration.rows[0].teams_with_members,
      'checked-in teams': registration.rows[0].checked_in_teams,
    },
    measuredAt: new Date().toISOString(),
  };
  await getPool().query(
    `insert into hunt_v3.analytics_rollups(hunt_id,rollup_kind,scope_key,metrics,source_cutoff)
      values($1,'hunt',$2,$3,$4) on conflict(hunt_id,rollup_kind,scope_key,bucket_key)
      do update set metrics=excluded.metrics,source_cutoff=excluded.source_cutoff,refreshed_at=now()`,
    [huntId, `hunt:${huntId}`, metrics, metrics.measuredAt],
  );
  return metrics;
}

function derivedRosterPin(secret: string, context: string, used: Set<string>) {
  for (let nonce = 0; nonce < 100; nonce++) {
    const bytes = createHmac('sha256', secret).update(`${context}:${nonce}`).digest();
    const candidate = String(100000 + bytes.readUInt32BE(0) % 900000);
    if (!used.has(candidate)) return candidate;
  }
  throw new HttpError(503, 'Could not allocate private roster credentials. Try again.');
}

export async function createOrganizerTeam(input: {
  huntId: string;
  requestId: string;
  displayName?: string | null;
  memberNames: unknown;
  pin?: string;
  credentialSecret: string;
  actor: string;
  sessionHash: string;
}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) {
    throw new HttpError(400, 'A valid roster request ID is required.');
  }
  if (input.credentialSecret.length < 12) throw new HttpError(503, 'Roster credential recovery is not configured.');
  if (input.memberNames !== undefined && !Array.isArray(input.memberNames)) {
    throw new HttpError(400, 'Team members must be a list of names.');
  }
  const names = Array.isArray(input.memberNames) ? input.memberNames.map(validateMemberName) : [];
  if (names.length > 200) throw new HttpError(400, 'Enter no more than 200 roster members.');
  if (new Set(names.map(normalizedKey)).size !== names.length) throw new HttpError(400, 'Roster member names must be unique.');
  if (input.pin !== undefined && !/^\d{6,12}$/.test(input.pin)) throw new HttpError(400, 'Use a team PIN with 6 to 12 digits.');
  const displayName = validateOptionalTeamName(input.displayName);
  // A keyed fingerprint detects a changed caller-supplied PIN without putting a
  // fast, brute-forceable digest of a short numeric secret in the receipt row.
  const suppliedPinFingerprint = input.pin === undefined ? null : createHmac('sha256', input.credentialSecret)
    .update(`admin-create-team-pin:${input.pin}`)
    .digest('hex');
  const payloadHash = digest(canonicalJson({
    operation: 'admin_create_team',
    huntId: input.huntId,
    displayName,
    memberNames: names,
    suppliedPinFingerprint,
  }));
  const scopeKey = `admin:create-team:${input.huntId}`;
  const usedPins = new Set<string>();
  const plainPin = input.pin ?? derivedRosterPin(input.credentialSecret, `${input.huntId}:${input.requestId}:team`, usedPins);
  usedPins.add(plainPin);
  const memberCredentials = names.map((name, index) => {
    const claimPin = derivedRosterPin(
      input.credentialSecret,
      `${input.huntId}:${input.requestId}:member:${index}:${normalizedKey(name)}`,
      usedPins,
    );
    usedPins.add(claimPin);
    return { name, claimPin };
  });
  const replay = async (
    receipt: { operation: string; payload_hash: string; response: Record<string, unknown> },
    client?: PoolClient,
  ) => {
    if (receipt.operation !== 'admin_create_team' || receipt.payload_hash !== payloadHash) {
      throw new HttpError(409, 'This roster request ID was already used with different details.');
    }
    const { teamId, code } = receipt.response;
    if (typeof teamId !== 'string' || typeof code !== 'string') throw new HttpError(409, 'This roster receipt is incomplete. Refresh and ask for help.');
    // Credentials are reconstructed rather than stored in plaintext. Verify the
    // team PIN and one derived member PIN so a rotated server secret or later PIN
    // reset cannot make an exact retry return credentials that no longer work.
    const firstMember = memberCredentials[0];
    const persisted = (await (client ?? getPool()).query(
      firstMember
        ? `select team.pin_hash,member.claim_pin_hash
            from hunt_v3.teams team
            left join hunt_v3.team_members member on member.team_id=team.id and member.name_key=$2
            where team.id=$1`
        : 'select pin_hash from hunt_v3.teams where id=$1',
      firstMember ? [teamId, normalizedKey(firstMember.name)] : [teamId],
    )).rows[0];
    if (!persisted?.pin_hash ||
      !(await verifyPin(plainPin, persisted.pin_hash)) ||
      (firstMember && (!persisted.claim_pin_hash || !(await verifyPin(firstMember.claimPin, persisted.claim_pin_hash))))) {
      throw new HttpError(409, 'These roster credentials can no longer be recovered. Reset the team credentials before sharing them.');
    }
    return { teamId, code, displayName, memberCredentials, pin: plainPin };
  };
  const existingReceipt = (await getPool().query(
    'select operation,payload_hash,response from hunt_v3.command_receipts where scope_key=$1 and request_id=$2',
    [scopeKey, input.requestId],
  )).rows[0];
  if (existingReceipt) return replay(existingReceipt);
  const initialHunt = (await getPool().query(
    'select registration_mode,settings from hunt_v3.hunts where id=$1',
    [input.huntId],
  )).rows[0];
  if (!initialHunt) throw new HttpError(404, 'Hunt not found.');
  if (initialHunt.registration_mode === 'self_serve') throw new HttpError(409, 'Use player self-registration for this hunt, or change its registration mode first.');
  if (initialHunt.registration_mode === 'rostered' && names.length === 0) {
    throw new HttpError(400, 'Enter 1 to 200 roster members.');
  }
  if (initialHunt.registration_mode === 'organizer_assigned' && names.length > 0) {
    throw new HttpError(400, 'Organizer-assigned teams do not use a fixed member roster. Use rostered registration to pre-assign member identities.');
  }
  const initialMaximum = Number(initialHunt.settings?.maxTeamSize ?? 50);
  if (names.length > initialMaximum) throw new HttpError(400, `A team may have at most ${initialMaximum} members.`);
  // All scrypt work happens before the hunt row is locked for code allocation.
  const teamPinHash = await hashPin(plainPin);
  const memberPinHashes: string[] = [];
  // Keep CPU/memory bounded for large school rosters; none of this holds a DB lock.
  for (const member of memberCredentials) memberPinHashes.push(await hashPin(member.claimPin));
  const result = await transaction(async client => {
    const hunt = (await client.query('select * from hunt_v3.hunts where id=$1 for update', [input.huntId])).rows[0];
    if (!hunt) throw new HttpError(404, 'Hunt not found.');
    if (hunt.registration_mode === 'self_serve') throw new HttpError(409, 'Use player self-registration for this hunt, or change its registration mode first.');
    if (hunt.registration_mode !== initialHunt.registration_mode) throw new HttpError(409, 'Registration mode changed. Refresh and try again.');
    if (hunt.registration_mode === 'rostered' && names.length === 0) throw new HttpError(400, 'Enter 1 to 200 roster members.');
    if (hunt.registration_mode === 'organizer_assigned' && names.length > 0) {
      throw new HttpError(400, 'Organizer-assigned teams do not use a fixed member roster. Use rostered registration to pre-assign member identities.');
    }
    const maximum = Number(hunt.settings?.maxTeamSize ?? 50);
    if (names.length > maximum) throw new HttpError(400, `A team may have at most ${maximum} members.`);
    const receipt = (await client.query(
      'select operation,payload_hash,response from hunt_v3.command_receipts where scope_key=$1 and request_id=$2',
      [scopeKey, input.requestId],
    )).rows[0];
    if (receipt) return replay(receipt, client);
    const teamId = randomUUID(), code = formatTeamCode(hunt.next_team_number);
    await client.query(
      `insert into hunt_v3.teams(id,hunt_id,canonical_code,display_name,name_key,name_status,pin_hash,registration_source)
        values($1,$2,$3,$4,$5,$6,$7,$8)`,
      [teamId, input.huntId, code, displayName, displayName ? normalizedKey(displayName) : null,
        displayName ? 'approved' : 'code_only', teamPinHash, hunt.registration_mode === 'rostered' ? 'roster_import' : 'organizer_assigned'],
    );
    await client.query('update hunt_v3.hunts set next_team_number=next_team_number+1 where id=$1', [input.huntId]);
    for (const [index, name] of names.entries()) {
      await client.query(
        `insert into hunt_v3.team_members(id,team_id,name,name_key,claim_pin_hash,status) values($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), teamId, name, normalizedKey(name), memberPinHashes[index],
          hunt.registration_mode === 'rostered' ? 'rostered' : 'active'],
      );
    }
    await client.query(
      `insert into hunt_v3.admin_events(action,actor,session_token_hash,hunt_id,team_id,details)
        values('team_created',$1,$2,$3,$4,$5)`,
      [input.actor, input.sessionHash, input.huntId, teamId, { code, memberCount: names.length }],
    );
    await client.query(
      `insert into hunt_v3.command_receipts(
        scope_key,request_id,operation,team_id,payload_hash,response)
        values($1,$2,'admin_create_team',$3,$4,$5)`,
      [scopeKey, input.requestId, teamId, payloadHash, { teamId, code, displayName }],
    );
    return { teamId, code, displayName, memberCredentials, pin: plainPin };
  });
  return result;
}

export async function renameTeam(teamId: string, displayName: string | null, reason: string, actor: string) {
  const name = validateOptionalTeamName(displayName);
  if (!reason.trim() || reason.length > 500) throw new HttpError(400, 'Give a reason for the team-name change.');
  return transaction(async client => {
    const team = (await client.query('select * from hunt_v3.teams where id=$1 for update', [teamId])).rows[0];
    if (!team) throw new HttpError(404, 'Team not found.');
    await client.query(
      `update hunt_v3.teams set display_name=$1,name_key=$2,name_status=$3 where id=$4`,
      [name, name ? normalizedKey(name) : null, name ? 'renamed' : 'code_only', teamId],
    );
    await client.query(
      `insert into hunt_v3.admin_events(action,actor,hunt_id,team_id,reason,before_state,after_state)
        values('team_renamed',$1,$2,$3,$4,$5,$6)`,
      [actor, team.hunt_id, teamId, reason.trim(), { displayName: team.display_name }, { displayName: name }],
    );
    return { ok: true };
  });
}

export async function setHuntLifecycle(huntId: string, status: string, expectedRevision: number, actor: string) {
  const transitions: Record<string, string[]> = { ready: ['live', 'archived'], live: ['paused', 'ended'], paused: ['live', 'ended', 'archived'], ended: ['live', 'archived'], archived: ['ready'] };
  if (!Object.hasOwn(transitions, status)) throw new HttpError(400, 'Choose a supported hunt status.');
  return transaction(async client => {
    const hunt = (await client.query('select status,lifecycle_revision from hunt_v3.hunts where id=$1 for update', [huntId])).rows[0];
    if (!hunt) throw new HttpError(404, 'Hunt not found.');
    if (hunt.lifecycle_revision !== expectedRevision) throw new HttpError(409, 'This hunt changed. Refresh before updating it.');
    if (hunt.status !== status && !transitions[hunt.status]?.includes(status)) throw new HttpError(409, `Cannot move directly from ${hunt.status} to ${status}.`);
    if (hunt.status !== status) {
      const now = new Date((await client.query('select clock_timestamp() as at')).rows[0].at).toISOString();
      const runs = await client.query(
        `select run.id,run.team_id,run.engine_state from hunt_v3.runs run
          where run.hunt_id=$1 and run.status='active' order by run.team_id,run.run_number for update of run`,
        [huntId],
      );
      for (const run of runs.rows) {
        const before = run.engine_state as GameState;
        const shouldPause = hunt.status === 'live' && (status === 'paused' || status === 'ended');
        const shouldResume = status === 'live' && (hunt.status === 'paused' || hunt.status === 'ended');
        const after = shouldPause ? pauseRunClock(before, now)
          : shouldResume ? resumeRunClock(before, now) : before;
        if (after === before) continue;
        await client.query('update hunt_v3.runs set engine_state=$1,updated_at=$2 where id=$3', [after, now, run.id]);
        let ordinal = Number((await client.query(
          'select coalesce(max(ordinal),0)+1 as ordinal from hunt_v3.run_events where run_id=$1 and revision=$2',
          [run.id, after.revision],
        )).rows[0].ordinal);
        for (const event of after.events.slice(before.events.length)) {
          await client.query(
            `insert into hunt_v3.run_events(
              run_id,team_id,revision,ordinal,actor_kind,event_type,checkpoint_id,node_id,details,occurred_at)
              values($1,$2,$3,$4,'system',$5,$6,$7,$8,$9)`,
            [run.id, run.team_id, after.revision, ordinal++, event.type, event.checkpointId ?? null,
              event.nodeId ?? null, event, event.at],
          );
        }
        await updateLiveRollup(client, run.id);
      }
      await client.query('update hunt_v3.hunts set status=$1,lifecycle_revision=lifecycle_revision+1 where id=$2', [status, huntId]);
    }
    await client.query(`insert into hunt_v3.admin_events(action,actor,hunt_id,before_state,after_state) values('hunt_status_changed',$1,$2,$3,$4)`, [actor, huntId, { status: hunt.status }, { status }]);
    return { ok: true };
  });
}

export async function updatePublicBoard(client: PoolClient, input: {
  huntId: string; enabled: boolean; title: string; cover?: string | null; status: 'live' | 'frozen' | 'final'; columns: string[];
  mainVisible: boolean; replayVisible: boolean; teamNameMode: 'code_only' | 'display_name'; actor: string;
}) {
  const allowed = new Set(['rank', 'team_code', 'team_name', 'points', 'progress', 'completion_status', 'runs', 'time']);
  if (!input.columns.length || input.columns.some(column => !allowed.has(column))) throw new HttpError(400, 'Choose supported public-board columns.');
  if (!input.enabled && input.status !== 'live') throw new HttpError(409, 'Enable the public board before freezing it.');
  await client.query('set transaction isolation level repeatable read');
  const source = (await client.query(
    'select clock_timestamp() as at from hunt_v3.public_boards where hunt_id=$1',
    [input.huntId],
  )).rows[0];
  if (!source) throw new HttpError(404, 'Public board not found. Publish the hunt first.');
  const sourceCutoff = source.at as Date;
  const result = await client.query(
    `update hunt_v3.public_boards set enabled=$1,title=$2,
      cover_ref=case when $3::boolean then $4 else cover_ref end,event_status='live',visible_columns=$5,
      main_board_visible=$6,replay_board_visible=$7,team_name_mode=$8,current_snapshot_id=null,frozen_at=null
      where hunt_id=$9 returning slug`,
    [input.enabled, input.title.slice(0, 160), input.cover !== undefined, input.cover ?? null, input.columns,
      input.mainVisible, input.replayVisible, input.teamNameMode, input.huntId],
  );
  if (!result.rows[0]) throw new HttpError(404, 'Public board not found. Publish the hunt first.');
  await client.query(
    `insert into hunt_v3.admin_events(action,actor,hunt_id,details)
      values('public_board_updated',$1,$2,$3)`,
    [input.actor, input.huntId, {
      enabled: input.enabled,
      title: input.title.slice(0, 160),
      columns: input.columns,
      mainBoardVisible: input.mainVisible,
      replayBoardVisible: input.replayVisible,
      teamNameMode: input.teamNameMode,
      requestedStatus: input.status,
    }],
  );
  if (input.status !== 'live') return snapshotPublicBoard(client, input.huntId, input.status === 'final', input.actor, sourceCutoff);
  return { ok: true, url: input.enabled ? `/board/${result.rows[0].slug}` : null };
}

async function snapshotPublicBoard(client: PoolClient, huntId: string, final: boolean, actor: string, sourceCutoff: Date) {
  const board = (await client.query('select slug,enabled from hunt_v3.public_boards where hunt_id=$1 for update', [huntId])).rows[0];
  if (!board?.enabled) throw new HttpError(409, 'Enable the public board before freezing it.');
  // Project live rows on this transaction's stable snapshot. If projection or
  // persistence fails, the previous frozen board remains untouched.
  await client.query(
    `update hunt_v3.public_boards set event_status='live',current_snapshot_id=null,frozen_at=null where hunt_id=$1`,
    [huntId],
  );
  const projection = await publicLeaderboard(
    board.slug,
    client,
    final ? 'final' : 'operational',
  ) as { main?: unknown[]; replay?: unknown[] };
  const rows = [
    ...(projection.main ?? []).map(row => ({ board: 'main', ...row as Record<string, unknown> })),
    ...(projection.replay ?? []).map(row => ({ board: 'replay', ...row as Record<string, unknown> })),
  ];
  const frozenAt = (await client.query('select clock_timestamp() as at')).rows[0].at;
  const snapshot = (await client.query(
    `insert into hunt_v3.public_board_snapshots(hunt_id,board_kind,rows,source_cutoff,generated_by)
      values($1,'combined',$2,$3,$4) returning id`,
    [huntId, JSON.stringify(rows), sourceCutoff, actor],
  )).rows[0];
  await client.query(
    `update hunt_v3.public_boards set event_status=$1,current_snapshot_id=$2,frozen_at=$3 where hunt_id=$4`,
    [final ? 'final' : 'frozen', snapshot.id, frozenAt, huntId],
  );
  await client.query(
    `insert into hunt_v3.admin_events(action,actor,hunt_id,details) values($1,$2,$3,$4)`,
    [final ? 'public_board_finalized' : 'public_board_frozen', actor, huntId, { snapshotId: snapshot.id, rowCount: rows.length }],
  );
  return { ok: true, snapshotId: snapshot.id, rows: rows.length, url: `/board/${board.slug}` };
}

export async function freezePublicBoard(huntId: string, final: boolean, actor: string) {
  return transaction(async client => {
    await client.query('set transaction isolation level repeatable read');
    const source = (await client.query(
      'select clock_timestamp() as at from hunt_v3.public_boards where hunt_id=$1',
      [huntId],
    )).rows[0];
    if (!source) throw new HttpError(404, 'Public board not found. Publish the hunt first.');
    const sourceCutoff = source.at as Date;
    return snapshotPublicBoard(client, huntId, final, actor, sourceCutoff);
  });
}

export async function recognitionAudit(runId: string) {
  const run = (await getPool().query(
    `select r.id,r.team_id,r.hunt_id,r.run_number,t.canonical_code,t.display_name
      from hunt_v3.runs r join hunt_v3.teams t on t.id=r.team_id where r.id=$1`,
    [runId],
  )).rows[0];
  if (!run) throw new HttpError(404, 'Run not found.');
  const [votes, contributions, results] = await Promise.all([
    getPool().query(
      `select vote.id,vote.revision,vote.category,vote.subtype,vote.answer_path,vote.is_withdrawal,vote.created_at,
        voter.id as voter_id,voter.name as voter_name,recipient.id as recipient_id,recipient.name as recipient_name
        from hunt_v3.recognition_votes vote
        join hunt_v3.team_members voter on voter.id=vote.voter_member_id
        join hunt_v3.team_members recipient on recipient.id=vote.recipient_member_id
        where vote.run_id=$1 order by vote.voter_member_id,vote.revision,vote.id`, [runId]),
    getPool().query(
      `select contribution.*,member.name as member_name,event.event_type,event.details as event_details
        from hunt_v3.run_contributions contribution
        join hunt_v3.team_members member on member.id=contribution.member_id
        left join hunt_v3.run_events event on event.id=contribution.source_event_id
        where contribution.run_id=$1 order by contribution.created_at,contribution.id`, [runId]),
    getPool().query(
      `select result.*,member.name as member_name,
        override.id as override_id,override.headline_title as override_headline,override.data_title as override_data,
        override.peer_title as override_peer,override.explanation as override_explanation,override.reason as override_reason,
        override.organizer_actor,override.created_at as override_created_at
        from (select distinct on(member_id) * from hunt_v3.recognition_results where run_id=$1 order by member_id,revision desc,id desc) result
        join hunt_v3.team_members member on member.id=result.member_id
        left join lateral (select * from hunt_v3.recognition_overrides candidate where candidate.run_id=$1 and candidate.member_id=result.member_id order by created_at desc,id desc limit 1) override on true
        order by member.name`, [runId]),
  ]);
  return {
    run: { id: run.id, runNumber: run.run_number, teamId: run.team_id, teamCode: run.canonical_code, teamName: run.display_name, huntId: run.hunt_id },
    votes: votes.rows,
    contributions: contributions.rows,
    results: results.rows,
  };
}

export async function overrideRecognition(input: {
  runId: string; memberId: string; headlineTitle?: string; dataTitle?: string; peerTitle?: string;
  explanation?: string; reason: string; actor: string;
}) {
  const bounded = (value: string | undefined, maximum: number) => value?.normalize('NFKC').trim().slice(0, maximum) || null;
  const headline = bounded(input.headlineTitle, 100), data = bounded(input.dataTitle, 100), peer = bounded(input.peerTitle, 100), explanation = bounded(input.explanation, 2000);
  if (!headline && !data && !peer && !explanation) throw new HttpError(400, 'Change at least one visible recognition field.');
  if (!input.reason.trim() || input.reason.trim().length < 3 || input.reason.length > 500) throw new HttpError(400, 'Give a reason for this recognition override.');
  return transaction(async client => {
    const result = (await client.query(
      `select result.*,run.hunt_id from hunt_v3.recognition_results result join hunt_v3.runs run on run.id=result.run_id
        where result.run_id=$1 and result.member_id=$2 order by result.revision desc,result.id desc limit 1 for update of result`,
      [input.runId, input.memberId],
    )).rows[0];
    if (!result) throw new HttpError(404, 'Calculated recognition result not found.');
    const previous = (await client.query(
      `select id from hunt_v3.recognition_overrides where run_id=$1 and member_id=$2 order by created_at desc,id desc limit 1`,
      [input.runId, input.memberId],
    )).rows[0];
    const override = (await client.query(
      `insert into hunt_v3.recognition_overrides(
        run_id,team_id,member_id,result_id,replaces_override_id,headline_title,data_title,peer_title,explanation,reason,organizer_actor)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id,created_at`,
      [input.runId, result.team_id, input.memberId, result.id, previous?.id ?? null, headline, data, peer, explanation, input.reason.trim(), input.actor],
    )).rows[0];
    await client.query(
      `insert into hunt_v3.admin_events(action,actor,hunt_id,team_id,run_id,member_id,reason,details)
        values('recognition_overridden',$1,$2,$3,$4,$5,$6,$7)`,
      [input.actor, result.hunt_id, result.team_id, input.runId, input.memberId, input.reason.trim(), { overrideId: override.id, headline, data, peer, explanation }],
    );
    return { ok: true, overrideId: override.id, createdAt: override.created_at };
  });
}

export async function pendingPhotoReviews(huntId: string) {
  const { rows } = await getPool().query(
    `select media.id,media.team_id,media.run_id,media.member_id,media.checkpoint_id,media.node_id,
      media.parallel_mechanic_id,media.parallel_lane_id,media.submitted_at,
      team.canonical_code,team.display_name,member.name as member_name,version.definition,run.route_plan,
      run.status as run_status
      from hunt_v3.media media join hunt_v3.teams team on team.id=media.team_id
      join hunt_v3.team_members member on member.id=media.member_id
      join hunt_v3.runs run on run.id=media.run_id
      join hunt_v3.hunt_versions version on version.hunt_id=run.hunt_id and version.version=run.hunt_version
      where media.hunt_id=$1 and media.kind='photo' and media.review_status='pending'
        and media.submitted_at is not null
      order by media.submitted_at limit 200`,
    [huntId],
  );
  return rows.map(row => {
    const definition = materializeRunDefinition(row.definition, row.route_plan);
    const node = definition.checkpoints.find(checkpoint => checkpoint.id === row.checkpoint_id)?.flow.nodes.find(candidate => candidate.id === row.node_id);
    return {
      id: row.id,
      teamId: row.team_id,
      runId: row.run_id,
      memberId: row.member_id,
      memberName: row.member_name,
      teamCode: row.canonical_code,
      teamName: row.display_name,
      checkpointId: row.checkpoint_id,
      nodeId: row.node_id,
      mechanicId: row.parallel_mechanic_id,
      laneId: row.parallel_lane_id,
      runStatus: row.run_status,
      createdAt: row.submitted_at,
      url: `/api/v3/media/${row.id}`,
      referenceImages: node?.type === 'verify_image' ? node.referenceImages : [],
    };
  });
}

export async function reviewPhoto(input: { mediaId: string; approved: boolean; reason: string; requestId: string; actor: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(input.mediaId) || !/^[0-9a-f-]{36}$/i.test(input.requestId)) throw new HttpError(400, 'Choose a valid photo review.');
  if (!input.reason.trim() || input.reason.length > 500) throw new HttpError(400, 'Give a short review reason.');
  const scopeKey = `admin:photo:${input.mediaId}`;
  const payloadHash = digest(canonicalJson({ approved: input.approved, reason: input.reason.trim() }));
  return transaction(async client => {
    const receipt = (await client.query('select payload_hash,response from hunt_v3.command_receipts where scope_key=$1 and request_id=$2', [scopeKey, input.requestId])).rows[0];
    if (receipt) {
      if (receipt.payload_hash !== payloadHash) throw new HttpError(409, 'This review request ID was already used.');
      return receipt.response;
    }
    const identity = (await client.query('select team_id,run_id from hunt_v3.media where id=$1', [input.mediaId])).rows[0];
    if (!identity) throw new HttpError(404, 'Photo not found.');
    const run = (await client.query(
      `select run.*,version.definition from hunt_v3.runs run
        join hunt_v3.hunt_versions version on version.hunt_id=run.hunt_id and version.version=run.hunt_version
        where run.id=$1 and run.team_id=$2 for update of run`,
      [identity.run_id, identity.team_id],
    )).rows[0] as ({ id: string; team_id: string; hunt_id: string; status: string; engine_state: GameState; route_plan: ResolvedRunPlan; definition: V3Definition } | undefined);
    if (!run) throw new HttpError(404, 'Run not found.');
    const media = (await client.query('select * from hunt_v3.media where id=$1 for update', [input.mediaId])).rows[0];
    if (media.review_status !== 'pending') throw new HttpError(409, 'This photo was already reviewed.');
    if (!media.submitted_at) throw new HttpError(409, 'This photo has not been submitted for organizer review.');
    if (run.status !== 'active') {
      const now = new Date((await client.query('select clock_timestamp() as at')).rows[0].at).toISOString();
      const adjustedState = endReviewClockPause(run.engine_state, media.id, now);
      await client.query(
        `update hunt_v3.media set review_status='rejected',review_reason=$1,reviewed_at=$2,
          expires_at=case when retention='after_review' then $2::timestamptz else expires_at end where id=$3`,
        [`Not applied because the run is ${run.status}. ${input.reason.trim()}`, now, media.id],
      );
      if (adjustedState !== run.engine_state) {
        await client.query('update hunt_v3.runs set engine_state=$1,updated_at=$2 where id=$3', [adjustedState, now, run.id]);
      }
      const ordinal = Number((await client.query(
        'select coalesce(max(ordinal),0)+1 as ordinal from hunt_v3.run_events where run_id=$1 and revision=$2',
        [run.id, adjustedState.revision],
      )).rows[0].ordinal);
      await client.query(
        `insert into hunt_v3.run_events(
          run_id,team_id,revision,ordinal,request_id,actor_kind,event_type,checkpoint_id,node_id,details,occurred_at)
          values($1,$2,$3,$4,$5,'organizer','photo_review_not_applied',$6,$7,$8,$9)`,
        [run.id, run.team_id, adjustedState.revision, ordinal, input.requestId, media.checkpoint_id, media.node_id,
          { mediaId: media.id, requestedApproval: input.approved, terminalStatus: run.status }, now],
      );
      const response = {
        ok: true,
        applied: false,
        approved: false,
        requestedApproval: input.approved,
        terminalStatus: run.status,
        runId: run.id,
        parallel: Boolean(media.parallel_mechanic_id),
      };
      await client.query(
        `insert into hunt_v3.command_receipts(scope_key,request_id,operation,team_id,run_id,payload_hash,response)
          values($1,$2,'photo_review_not_applied',$3,$4,$5,$6)`,
        [scopeKey, input.requestId, run.team_id, run.id, payloadHash, response],
      );
      await client.query(
        `insert into hunt_v3.admin_events(action,actor,hunt_id,team_id,run_id,member_id,reason,details)
          values('photo_review_not_applied',$1,$2,$3,$4,$5,$6,$7)`,
        [input.actor, run.hunt_id, run.team_id, run.id, media.member_id, input.reason.trim(),
          { mediaId: media.id, requestedApproval: input.approved, terminalStatus: run.status }],
      );
      await updateLiveRollup(client, run.id);
      return response;
    }
    if (media.parallel_mechanic_id) {
      const mechanic = materializeRunParallelMechanics(run.definition, run.route_plan).find(candidate => candidate.id === media.parallel_mechanic_id);
      const lane = mechanic?.lanes.find(candidate => candidate.id === media.parallel_lane_id);
      if (!mechanic || !lane || lane.type !== 'photo' || mechanic.checkpointId !== media.checkpoint_id || mechanic.nodeId !== media.node_id) {
        throw new HttpError(409, 'This linked photo lane no longer matches the published hunt version.');
      }
      if (run.engine_state.activeCheckpointId !== mechanic.checkpointId ||
        run.engine_state.checkpoints[mechanic.checkpointId]?.activeNodeId !== mechanic.nodeId) {
        throw new HttpError(409, 'The team moved on from this linked task.');
      }
      const submission = await client.query(
        `select 1 from hunt_v3.run_events
          where run_id=$1 and actor_member_id=$2 and event_type='parallel_photo_submitted'
            and checkpoint_id=$3 and node_id=$4
            and details->>'mediaId'=$5 and details->>'mechanicId'=$6 and details->>'laneId'=$7
          limit 1`,
        [run.id, media.member_id, mechanic.checkpointId, mechanic.nodeId, media.id, mechanic.id, lane.id],
      );
      if (!submission.rowCount) throw new HttpError(409, 'This linked photo has not been submitted for its lane.');
      const now = new Date((await client.query('select clock_timestamp() as at')).rows[0].at).toISOString();
      const ordinal = Number((await client.query(
        'select coalesce(max(ordinal),0)+1 as ordinal from hunt_v3.run_events where run_id=$1 and revision=$2',
        [run.id, run.engine_state.revision],
      )).rows[0].ordinal);
      await client.query(
        `insert into hunt_v3.run_events(run_id,team_id,revision,ordinal,request_id,actor_kind,event_type,checkpoint_id,node_id,details,occurred_at)
          values($1,$2,$3,$4,$5,'organizer','parallel_photo_reviewed',$6,$7,$8,$9)`,
        [run.id, run.team_id, run.engine_state.revision, ordinal, input.requestId, mechanic.checkpointId, mechanic.nodeId,
          { mediaId: media.id, mechanicId: mechanic.id, laneId: lane.id, approved: input.approved }, now],
      );
      await client.query(
        `update hunt_v3.media set review_status=$1,review_reason=$2,reviewed_at=$3,
          expires_at=case when retention='after_review' then
            case when $1='approved' then $3::timestamptz+interval '30 minutes' else $3::timestamptz end
            else expires_at end where id=$4`,
        [input.approved ? 'approved' : 'rejected', input.reason.trim(), now, media.id],
      );
      let adjustedState = run.engine_state;
      // Approval/rejection ends the server-only wait. Until the browser submits
      // an approved lane again (or replaces a rejection), player action is the
      // blocker, so no parallel review interval may remain open.
      for (const pause of run.engine_state.clockPauses ?? []) {
        if (!pause.endedAt && pause.reason === 'review' && pause.sourceId) {
          adjustedState = endReviewClockPause(adjustedState, pause.sourceId, now);
        }
      }
      if (adjustedState !== run.engine_state) {
        const updated = await client.query(
          "update hunt_v3.runs set engine_state=$1,updated_at=$2 where id=$3 and status='active' returning id",
          [adjustedState, now, run.id],
        );
        if (!updated.rowCount) throw new HttpError(409, 'The run ended while this review was being saved.');
      }
      const response = { ok: true, approved: input.approved, runId: run.id, parallel: true };
      await client.query(
        `insert into hunt_v3.command_receipts(scope_key,request_id,operation,team_id,run_id,payload_hash,response)
          values($1,$2,'parallel_photo_review',$3,$4,$5,$6)`,
        [scopeKey, input.requestId, run.team_id, run.id, payloadHash, response],
      );
      await client.query(
        `insert into hunt_v3.admin_events(action,actor,hunt_id,team_id,run_id,member_id,reason,details)
          values('parallel_photo_reviewed',$1,$2,$3,$4,$5,$6,$7)`,
        [input.actor, run.hunt_id, run.team_id, run.id, media.member_id, input.reason.trim(),
          { mediaId: media.id, mechanicId: mechanic.id, laneId: lane.id, approved: input.approved }],
      );
      await updateLiveRollup(client, run.id);
      return response;
    }
    const definition = materializeRunDefinition(run.definition, run.route_plan);
    const state = run.engine_state;
    const checkpoint = state.checkpoints[media.checkpoint_id];
    const node = checkpoint?.nodes[media.node_id];
    if (state.activeCheckpointId !== media.checkpoint_id || checkpoint?.activeNodeId !== media.node_id || node?.pendingPhotoId !== media.id) {
      throw new HttpError(409, 'The team moved on or replaced this photo. Refresh the review queue.');
    }
    const now = new Date((await client.query('select clock_timestamp() as at')).rows[0].at).toISOString();
    const adjustedState = endReviewClockPause(state, media.id, now);
    const command = {
      type: input.approved ? 'approve_action' as const : 'reject_photo' as const,
      checkpointId: media.checkpoint_id,
      nodeId: media.node_id,
      expectedRevision: adjustedState.revision,
      reason: input.reason.trim(),
    };
    const result = executeControl(definition, adjustedState, command, now);
    const completedAt = result.state.completedAt ?? null;
    const elapsedMs = completedAt && result.state.startedAt ? elapsedMilliseconds(result.state, result.state.startedAt, completedAt) : null;
    const recognitionClosesAt = completedAt && run.definition.settings.recognition.enabled
      ? new Date(Date.parse(completedAt) + run.definition.settings.recognition.votingWindowMinutes * 60_000).toISOString() : null;
    const updatedRun = await client.query(
      `update hunt_v3.runs set engine_state=$1,status=$2,progress=$3,current_checkpoint_id=$4,completed_at=$5,elapsed_ms=$6,
        recognition_closes_at=$7,updated_at=$8 where id=$9 and status='active' returning id`,
      [result.state, result.state.status === 'completed' ? 'completed' : 'active', stateProgress(result.state), result.state.activeCheckpointId,
        completedAt, elapsedMs, recognitionClosesAt, now, run.id],
    );
    if (!updatedRun.rowCount) throw new HttpError(409, 'The run ended while this review was being saved.');
    let ordinal = 1, sourceEventId: number | null = null;
    for (const event of result.state.events.slice(state.events.length)) {
      const saved = (await client.query(
        `insert into hunt_v3.run_events(run_id,team_id,revision,ordinal,request_id,actor_kind,event_type,checkpoint_id,node_id,details,occurred_at)
          values($1,$2,$3,$4,$5,'organizer',$6,$7,$8,$9,$10) returning id`,
        [run.id, run.team_id, result.state.revision, ordinal++, input.requestId, event.type, event.checkpointId ?? null,
          event.nodeId ?? null, event, event.at],
      )).rows[0];
      sourceEventId ??= Number(saved.id);
    }
    if (!sourceEventId) {
      sourceEventId = Number((await client.query(
        `insert into hunt_v3.run_events(run_id,team_id,revision,ordinal,request_id,actor_kind,event_type,checkpoint_id,node_id,details,occurred_at)
          values($1,$2,$3,1,$4,'organizer','photo_reviewed',$5,$6,$7,$8) returning id`,
        [run.id, run.team_id, result.state.revision, input.requestId, media.checkpoint_id, media.node_id, { approved: input.approved }, now],
      )).rows[0].id);
    }
    const ledger = result.state.ledger.slice(state.ledger.length) as ScoreEntry[];
    for (const entry of ledger) if (entry.amount) await client.query(
      `insert into hunt_v3.score_ledger(run_id,team_id,source_event_id,source_key,category,amount,counts_for_ranking,reason,details,created_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [run.id, run.team_id, sourceEventId, entry.id, entry.kind, entry.amount, entry.countsForRanking !== false, entry.reason ?? entry.kind, entry, entry.at],
    );
    if (input.approved) await client.query(
      `insert into hunt_v3.run_contributions(run_id,team_id,member_id,source_event_id,source_key,category,credit,evidence,created_at)
        values($1,$2,$3,$4,$5,'eagle_eye',2,$6,$7)`,
      [run.id, run.team_id, media.member_id, sourceEventId, `photo-approved:${media.id}`, { summary: 'Submitted approved photo evidence', mediaId: media.id }, now],
    );
    await client.query(
      `update hunt_v3.media set review_status=$1,review_reason=$2,reviewed_at=$3,
        expires_at=case when retention='after_review' then $3::timestamptz else expires_at end where id=$4`,
      [input.approved ? 'approved' : 'rejected', input.reason.trim(), now, media.id],
    );
    if (result.state.status === 'completed' && state.status !== 'completed' && run.definition.settings.recognition.enabled) await recalculateRecognition(client, run.team_id, run.id);
    await updateLiveRollup(client, run.id);
    const response = { ok: true, approved: input.approved, runId: run.id };
    await client.query(
      `insert into hunt_v3.command_receipts(scope_key,request_id,operation,team_id,run_id,payload_hash,response)
        values($1,$2,'photo_review',$3,$4,$5,$6)`,
      [scopeKey, input.requestId, run.team_id, run.id, payloadHash, response],
    );
    await client.query(
      `insert into hunt_v3.admin_events(action,actor,hunt_id,team_id,run_id,member_id,reason,details)
        values('photo_reviewed',$1,$2,$3,$4,$5,$6,$7)`,
      [input.actor, run.hunt_id, run.team_id, run.id, media.member_id, input.reason.trim(), { mediaId: media.id, approved: input.approved }],
    );
    return response;
  });
}
