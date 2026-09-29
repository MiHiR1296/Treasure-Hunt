import { createHash } from 'node:crypto';
import { EngineError, type HuntDefinition, type RouteAssignment } from '../engine/types';

/** This server-only SHA dependency never enters the player/engine bundle. */
export function assignRoutes(definition: HuntDefinition, teamId: string, now: string, overrides?: unknown): RouteAssignment[] {
  if (overrides !== undefined && (!overrides || typeof overrides !== 'object' || Array.isArray(overrides))) throw new EngineError('invalid_preview', 'Choose valid preview routes.');
  const forced = (overrides ?? {}) as Record<string, unknown>, consumed = new Set<string>();
  const assignments: RouteAssignment[] = [];
  for (const checkpoint of definition.checkpoints) for (const node of checkpoint.flow.nodes) {
    if (node.type !== 'random_branch') continue;
    const key = `${checkpoint.id}:${node.id}`, version = definition.settings?.assignmentVersion ?? 1;
    let fraction: number;
    if (version === 2) {
      const hash = createHash('sha256').update(JSON.stringify(['treasure-hunt-route', 2, definition.id, definition.version, teamId, checkpoint.id, node.id])).digest();
      fraction = hash.readUIntBE(0, 6) / 281474976710656;
    } else {
      let hash = 2166136261;
      for (const char of `${teamId}:${checkpoint.id}:${node.id}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
      fraction = (hash >>> 0) / 4294967296;
    }
    let position = fraction * node.choices.reduce((sum, item) => sum + item.weight, 0);
    let choiceIndex = node.choices.length - 1;
    for (const [index, choice] of node.choices.entries()) { position -= choice.weight; if (position < 0) { choiceIndex = index; break; } }
    const selected = forced[key];
    if (selected !== undefined) {
      consumed.add(key);
      if (typeof selected !== 'number' || !Number.isInteger(selected) || selected < 0 || selected >= node.choices.length) throw new EngineError('invalid_preview', 'That preview route is not available.');
      choiceIndex = selected;
    }
    assignments.push({ checkpointId: checkpoint.id, nodeId: node.id, choiceIndex, nextNodeId: node.choices[choiceIndex].next, algorithmVersion: version, assignedAt: now, source: selected === undefined ? 'automatic' : 'preview' });
  }
  if (Object.keys(forced).some(key => !consumed.has(key))) throw new EngineError('invalid_preview', 'A preview router no longer exists. Refresh the preview choices.');
  return assignments;
}
