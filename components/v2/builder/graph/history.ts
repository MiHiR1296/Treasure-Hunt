import type { CheckpointDefinition, HintDefinition } from '@/lib/engine/types';

type HintNodeReferences = Record<string, string | null>;

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
    hintNodeReferences: Object.fromEntries(checkpoint.hints.map(hint => [hint.id, hint.availability?.afterNodeId ?? null])),
  });
}

export function createFlowHistoryEntry(before: CheckpointDefinition, after: CheckpointDefinition): FlowHistoryEntry {
  return { before: snapshot(before), after: snapshot(after) };
}

function restoreNodeReferences(hints: HintDefinition[], from: HintNodeReferences, to: HintNodeReferences): HintDefinition[] {
  return hints.map(hint => {
    if (!Object.hasOwn(from, hint.id) || !Object.hasOwn(to, hint.id) || from[hint.id] === to[hint.id]) return hint;

    // A hint can be edited independently after the flow operation. Only undo
    // the reference when it still has the value written by that operation.
    const current = hint.availability?.afterNodeId ?? null;
    if (current !== from[hint.id]) return hint;

    const availability = { ...hint.availability };
    const restored = to[hint.id];
    if (restored === null) delete availability.afterNodeId;
    else availability.afterNodeId = restored;
    if (Object.keys(availability).length === 0) {
      const next = { ...hint };
      delete next.availability;
      return next;
    }
    return { ...hint, availability };
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
