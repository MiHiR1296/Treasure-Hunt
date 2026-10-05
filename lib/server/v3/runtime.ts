import type { CheckpointDefinition, GameState, HuntDefinition, PlayerView, RouteAssignment } from '../../engine/types';
import { getPlayerView } from '../../engine';
import { elapsedMilliseconds, playability } from '../../engine/session';
import { deterministicWeightedIndex } from '../../v3/seed';
import type { ParallelMechanic, ResolvedRunPlan, V3Definition } from '../../v3/types';
import { publicParallelMechanics } from '../../v3/planning';
import { renderVariableTemplate } from '../../v3/variables';

const structuralKeys = new Set([
  'id', 'type', 'next', 'ifTrue', 'ifFalse', 'startNodeId', 'checkpointId', 'nodeId',
  'hintId', 'puzzleItemId', 'key', 'direction', 'kind', 'rankingImpact', 'bonusRankingImpact',
]);

function resolveTemplates(value: unknown, variables: ResolvedRunPlan['variables'], key = ''): unknown {
  if (typeof value === 'string') {
    if (structuralKeys.has(key) || (!value.includes('{{') && !value.includes('}}'))) return value;
    return renderVariableTemplate(value, variables);
  }
  if (Array.isArray(value)) return value.map(item => resolveTemplates(item, variables, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, resolveTemplates(child, variables, childKey)]));
  }
  return value;
}

/** Produces the immutable, run-scoped definition consumed by the mature engine. */
export function materializeRunDefinition(definition: V3Definition, plan: ResolvedRunPlan): HuntDefinition {
  const byId = new Map(definition.checkpoints.map(checkpoint => [checkpoint.id, checkpoint]));
  const selected = new Set(plan.checkpointIds);
  const checkpoints = plan.checkpointIds.map((checkpointId, index) => {
    const source = byId.get(checkpointId);
    if (!source) throw new Error(`Run plan references missing checkpoint ${checkpointId}.`);
    const resolved = resolveTemplates(source, plan.variables) as CheckpointDefinition;
    return {
      ...resolved,
      required: true,
      prerequisites: index === 0 ? [] : [plan.checkpointIds[index - 1]],
    };
  });
  if (selected.size !== checkpoints.length) throw new Error('A run route cannot include the same engine checkpoint twice.');
  const settings = definition.settings;
  return {
    schemaVersion: 1,
    id: definition.id,
    version: definition.version,
    // The hunt title identifies the event in organizer/public-board records and
    // therefore remains event-scoped rather than varying between team runs.
    title: definition.title,
    ...(definition.description ? { description: resolveTemplates(definition.description, plan.variables) as string } : {}),
    ...(definition.theme ? { theme: resolveTemplates(definition.theme, plan.variables) as HuntDefinition['theme'] } : {}),
    ...(definition.dudQrs ? { dudQrs: resolveTemplates(definition.dudQrs, plan.variables) as HuntDefinition['dudQrs'] } : {}),
    checkpoints,
    settings: {
      mode: 'sequential',
      map: settings.map,
      rules: settings.rules ? resolveTemplates(settings.rules, plan.variables) as string : undefined,
      maxTeamSize: settings.maxTeamSize,
      minTeamSize: settings.minTeamSize,
      sessionDurationSeconds: settings.sessionDurationSeconds,
      registrationOpen: settings.registrationOpen,
      startsAt: settings.startsAt,
      endsAt: settings.endsAt,
      completionMessage: settings.completionMessage ? resolveTemplates(settings.completionMessage, plan.variables) as string : undefined,
      photoRetention: settings.photoRetention,
      leaderboard: 'hidden',
      assignmentVersion: 2,
    },
  };
}

/** Resolves run-scoped labels and private verifier values without templating structural IDs. */
export function materializeRunParallelMechanics(
  definition: V3Definition,
  plan: Pick<ResolvedRunPlan, 'variables'>,
): ParallelMechanic[] {
  return resolveTemplates(definition.settings.parallelMechanics ?? [], plan.variables) as ParallelMechanic[];
}

export function seededEngineRoutes(
  definition: HuntDefinition,
  privateSeed: string,
  now: string,
): RouteAssignment[] {
  const assignments: RouteAssignment[] = [];
  for (const checkpoint of definition.checkpoints) for (const node of checkpoint.flow.nodes) {
    if (node.type !== 'random_branch') continue;
    const choiceIndex = deterministicWeightedIndex(
      privateSeed,
      'engine-random-branch',
      node.choices.map(choice => choice.weight),
      definition.id,
      definition.version,
      checkpoint.id,
      node.id,
    );
    assignments.push({
      checkpointId: checkpoint.id,
      nodeId: node.id,
      choiceIndex,
      nextNodeId: node.choices[choiceIndex].next,
      algorithmVersion: 2,
      assignedAt: now,
      source: 'automatic',
    });
  }
  return assignments;
}

export type V3PlayerView = PlayerView & {
  /** Official leaderboard score. Excluded delight points are reported separately. */
  bonusScore: number;
  runId: string;
  runNumber: number;
  practice: boolean;
  eligible: boolean;
  team: { id: string; code: string; displayName: string | null; label: string };
  member: { id: string; name: string };
  features: {
    recognition: { enabled: boolean; peerVotingEnabled: boolean };
    socialShare: { enabled: boolean; organizerHandle?: string; campaignHashtag?: string; allowPersonalTitle: boolean };
    publicBoard: { enabled: boolean; slug?: string };
    parallelMechanics: Array<ReturnType<typeof publicParallelMechanics>[number] & {
      completedLanes: Array<{ laneId: string; memberId: string; memberName: string; occurredAt: string }>;
      remainingLaneIds: string[];
      windowExpiresAt?: string;
      windowRemainingSeconds?: number;
      windowPaused?: boolean;
    }>;
  };
};

/**
 * Authored checkpoint IDs can identify both a physical route and the selected
 * challenge-pool variant. Keep those identifiers (and map coordinates) out of
 * the player projection until the run has actually reached that stage. The
 * colon cannot occur in an authored engine ID, so these ordinal placeholders
 * also cannot collide with a current/reached checkpoint in React lists.
 */
function redactFutureCheckpoints(view: PlayerView, state: GameState) {
  const publicId = (authoredId: string, index: number) =>
    state.checkpoints[authoredId]?.startedAt ? authoredId : `stage:${index + 1}`;

  view.checkpoints = view.checkpoints?.map((checkpoint, index) => {
    if (state.checkpoints[checkpoint.id]?.startedAt) return checkpoint;
    return {
      id: publicId(checkpoint.id, index),
      title: `Stage ${index + 1}`,
      status: checkpoint.status,
      required: checkpoint.required,
    };
  });
  if (view.summary) view.summary.checkpoints = view.summary.checkpoints.map((checkpoint, index) => {
    if (state.checkpoints[checkpoint.id]?.startedAt) return checkpoint;
    return {
      ...checkpoint,
      id: publicId(checkpoint.id, index),
      title: `Stage ${index + 1}`,
    };
  });
}

export function v3PlayerView(input: {
  definition: V3Definition;
  plan: ResolvedRunPlan;
  state: GameState;
  now: string;
  huntStatus: string;
  run: { id: string; runNumber: number; practice: boolean; eligible: boolean };
  team: { id: string; code: string; displayName: string | null };
  member: { id: string; name: string };
  parallelProgress?: Record<string, Array<{ laneId: string; memberId: string; memberName: string; occurredAt: string }>>;
}): V3PlayerView {
  const engineDefinition = materializeRunDefinition(input.definition, input.plan);
  const view = getPlayerView(engineDefinition, input.state, input.now);
  const rankingScore = input.state.ledger.reduce((total, entry) => total + (entry.countsForRanking === false ? 0 : entry.amount), 0);
  const bonusScore = input.state.ledger.reduce((total, entry) => total + (entry.countsForRanking === false ? entry.amount : 0), 0);
  view.score = rankingScore;
  if (view.summary) view.summary.checkpoints = view.summary.checkpoints.map(checkpoint => ({
    ...checkpoint,
    points: input.state.ledger
      .filter(entry => entry.checkpointId === checkpoint.id && entry.countsForRanking !== false)
      .reduce((total, entry) => total + entry.amount, 0),
  }));
  redactFutureCheckpoints(view, input.state);
  const clock = playability(engineDefinition, input.state, input.huntStatus, input.now);
  const gameplayHidden = input.state.status !== 'completed' && !clock.allowed;
  const selectedCheckpoints = new Set(input.plan.checkpointIds);
  const activeNodeId = input.state.activeCheckpointId
    ? input.state.checkpoints[input.state.activeCheckpointId]?.activeNodeId
    : undefined;
  const parallelMechanics = gameplayHidden ? [] : publicParallelMechanics(
    input.definition,
    materializeRunParallelMechanics(input.definition, input.plan),
  ).filter(mechanic =>
    selectedCheckpoints.has(mechanic.checkpointId) &&
    mechanic.checkpointId === input.state.activeCheckpointId &&
    mechanic.nodeId === activeNodeId);
  return {
    ...view,
    playability: clock,
    ...(gameplayHidden ? { node: null, hints: [] } : {}),
    // The engine's team key is the run UUID to isolate deterministic state.
    // The public API exposes the persistent team UUID separately and never the seed.
    teamId: input.team.id,
    bonusScore,
    runId: input.run.id,
    runNumber: input.run.runNumber,
    practice: input.run.practice,
    eligible: input.run.eligible,
    team: {
      ...input.team,
      label: input.team.displayName ? `${input.team.code} · ${input.team.displayName}` : input.team.code,
    },
    member: input.member,
    features: {
      recognition: {
        enabled: input.definition.settings.recognition.enabled,
        peerVotingEnabled: input.definition.settings.recognition.peerVotingEnabled,
      },
      socialShare: {
        enabled: input.definition.settings.socialShare.enabled,
        ...(input.definition.settings.socialShare.organizerHandle ? { organizerHandle: input.definition.settings.socialShare.organizerHandle } : {}),
        ...(input.definition.settings.socialShare.campaignHashtag ? { campaignHashtag: input.definition.settings.socialShare.campaignHashtag } : {}),
        allowPersonalTitle: input.definition.settings.socialShare.allowPersonalTitle,
      },
      publicBoard: {
        enabled: input.definition.settings.publicBoard.enabled,
        ...(input.definition.settings.publicBoard.slug ? { slug: input.definition.settings.publicBoard.slug } : {}),
      },
      parallelMechanics: parallelMechanics.map(mechanic => {
        const completedLanes = input.parallelProgress?.[mechanic.id] ?? [];
        const first = completedLanes.reduce<string | undefined>((earliest, lane) =>
          !earliest || Date.parse(lane.occurredAt) < Date.parse(earliest) ? lane.occurredAt : earliest, undefined);
        const remainingSeconds = first
          ? Math.max(0, mechanic.timeWindowSeconds - elapsedMilliseconds(input.state, first, input.now) / 1000)
          : undefined;
        return {
          ...mechanic,
          completedLanes,
          remainingLaneIds: mechanic.lanes.filter(lane => !completedLanes.some(item => item.laneId === lane.id)).map(lane => lane.id),
          ...(remainingSeconds !== undefined ? {
            windowRemainingSeconds: remainingSeconds,
            windowExpiresAt: new Date(Date.parse(input.now) + remainingSeconds * 1000).toISOString(),
            windowPaused: [...(input.state.timer?.pauses ?? []), ...(input.state.clockPauses ?? [])].some(pause => !pause.endedAt),
          } : {}),
        };
      }),
    },
  };
}
