import type { CheckpointDefinition, HintDefinition } from '@/lib/engine/types';

interface HintNodeReference {
  availabilityNodeId: string | null;
  relevance: NonNullable<HintDefinition['relevance']> | null;
}
type HintNodeReferences = Record<string, HintNodeReference>;

export interface FlowHistorySnapshot {
  flow: CheckpointDefinition['flow'];
  hintNodeReferences: HintNodeReferences;
}

export interface FlowHistoryEntry {
  before: FlowHistorySnapshot;
  after: FlowHistorySnapshot;
}

function snapshot(checkpoint: CheckpointDefinition): FlowHistorySnapshot {
  return structuredClone({
    flow: checkpoint.flow,
    hintNodeReferences: Object.fromEntries(checkpoint.hints.map(hint => [hint.id, {
      availabilityNodeId: hint.availability?.afterNodeId ?? null,
      relevance: hint.relevance ? structuredClone(hint.relevance) : null,
    }])),
  });
}

export function createFlowHistoryEntry(before: CheckpointDefinition, after: CheckpointDefinition): FlowHistoryEntry {
  return { before: snapshot(before), after: snapshot(after) };
}

function sameRelevance(left: NonNullable<HintDefinition['relevance']> | null, right: NonNullable<HintDefinition['relevance']> | null): boolean {
  if (left === null || right === null) return left === right;
  return left.nodeId === right.nodeId && left.puzzleItemId === right.puzzleItemId && left.unlockAfterAttempts === right.unlockAfterAttempts && left.unlockAfterSeconds === right.unlockAfterSeconds && left.expireWhenSolved === right.expireWhenSolved;
}

function restoreNodeReferences(hints: HintDefinition[], from: HintNodeReferences, to: HintNodeReferences): HintDefinition[] {
  return hints.map(hint => {
    if (!Object.hasOwn(from, hint.id) || !Object.hasOwn(to, hint.id)) return hint;

    // A hint can be edited independently after the flow operation. Only undo
    // the reference when it still has the value written by that operation.
    const next = { ...hint };
    const currentAvailability = hint.availability?.afterNodeId ?? null;
    if (currentAvailability === from[hint.id].availabilityNodeId && currentAvailability !== to[hint.id].availabilityNodeId) {
      const availability = { ...hint.availability };
      const restored = to[hint.id].availabilityNodeId;
      if (restored === null) delete availability.afterNodeId;
      else availability.afterNodeId = restored;
      if (Object.keys(availability).length === 0) delete next.availability;
      else next.availability = availability;
    }
    const currentRelevance = hint.relevance ?? null;
    if (sameRelevance(currentRelevance, from[hint.id].relevance) && !sameRelevance(currentRelevance, to[hint.id].relevance)) {
      const restored = to[hint.id].relevance;
      if (restored === null) delete next.relevance;
      else next.relevance = structuredClone(restored);
    }
    return next;
  });
}

export function applyFlowHistoryEntry(checkpoint: CheckpointDefinition, entry: FlowHistoryEntry, direction: 'undo' | 'redo'): CheckpointDefinition {
  const from = direction === 'undo' ? entry.after : entry.before;
  const to = direction === 'undo' ? entry.before : entry.after;
  return {
    ...checkpoint,
    flow: structuredClone(to.flow),
    hints: restoreNodeReferences(checkpoint.hints, from.hintNodeReferences, to.hintNodeReferences),
  };
}
