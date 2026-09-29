import type { PlayerView } from '../engine/types';
import { elapsedMilliseconds, playability } from '../engine/session';
import type { TeamRecord } from './store';

// Select only summary fields in PostgreSQL: never transfer full event/answer/puzzle
// histories just to poll the dashboard or export one page of result summaries.
export const teamSummaryQuery = `select t.id,t.hunt_id,t.name,t.is_preview,t.created_at,t.last_activity,h.status,
  jsonb_build_object('definitionVersion',t.state->'definitionVersion','revision',t.state->'revision',
    'status',t.state->'status','score',t.state->'score','startedAt',t.state->'startedAt','completedAt',coalesce(t.state->'completedAt',
      case when t.state->>'status'='completed' then (select item->'at' from jsonb_array_elements(t.state->'events') with ordinality as e(item,n) where item->>'type'='hunt_completed' order by n desc limit 1) end),
    'activeCheckpointId',t.state->'activeCheckpointId','timer',t.state->'timer','resultReview',t.state->'resultReview',
    'hintUsage',coalesce((select jsonb_object_agg(key,true) from jsonb_each(t.state->'hintUsage')),'{}'::jsonb),
    'checkpoints',(select jsonb_object_agg(key,value-'nodes') from jsonb_each(t.state->'checkpoints')),
    'events',coalesce((select jsonb_agg(item order by n) from jsonb_array_elements(t.state->'events') with ordinality as e(item,n)
      where n>jsonb_array_length(t.state->'events')-30),'[]'::jsonb)) as state,
  jsonb_build_object('id',v.hunt_id,'title',v.definition->'title','settings',v.definition->'settings',
    'checkpoints',(select jsonb_agg(jsonb_build_object('id',cp->'id','title',cp->'title','basePoints',cp->'basePoints','required',coalesce(cp->'required','true'::jsonb)))
      from jsonb_array_elements(v.definition->'checkpoints') cp)) as definition
  from hunt_v2.teams t join hunt_v2.hunts h on h.id=t.hunt_id
  join hunt_v2.hunt_versions v on v.hunt_id=t.hunt_id and v.version=(t.state->>'definitionVersion')::int`;

export function organizerSummaryView(team: TeamRecord, now: string): PlayerView {
  const state = team.state, required = team.definition.checkpoints.filter(cp => cp.required !== false);
  const checkpoints = team.definition.checkpoints.map(cp => ({ id: cp.id, title: cp.title, status: state.checkpoints[cp.id].status, required: cp.required !== false }));
  const current = checkpoints.find(cp => cp.id === state.activeCheckpointId);
  return { hunt: { id: team.hunt_id, title: team.definition.title }, teamId: team.id, revision: state.revision, status: state.status, score: state.score,
    serverNow: now, playability: playability(team.definition, state, team.status, now),
    progress: { completed: checkpoints.filter(cp => cp.status === 'completed').length, total: checkpoints.length,
      requiredCompleted: required.filter(cp => ['completed', 'skipped'].includes(state.checkpoints[cp.id].status)).length, requiredTotal: required.length },
    checkpoint: current ? { id: current.id, title: current.title, basePoints: team.definition.checkpoints.find(cp => cp.id === current.id)!.basePoints, startedAt: state.checkpoints[current.id].startedAt ?? now } : null,
    node: null, checkpoints: [], stages: [], hints: [],
    summary: { startedAt: state.startedAt ?? now, ...(state.completedAt ? { completedAt: state.completedAt } : {}),
      elapsedSeconds: state.startedAt ? Math.floor(elapsedMilliseconds(state, state.startedAt, state.completedAt ?? now) / 1000) : 0,
      hintsUsed: Object.keys(state.hintUsage).length, checkpoints: [] } };
}
