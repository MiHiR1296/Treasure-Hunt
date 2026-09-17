import type { CheckpointDefinition, FlowNode, HuntDefinition, InteractiveNode } from '@/lib/engine/types';
import { defaultPuzzle } from './puzzleDefaults';

export const nodeLabels: Record<string, string> = {
  show_text: 'Clue or text', show_media: 'Image, audio, or video', verify_answer: 'Answer a question',
  verify_code: 'Enter a code', verify_qr: 'Scan a QR', verify_gps: 'Reach a GPS region',
  choose_path: 'Choose a path', complete: 'Finish checkpoint', puzzle: 'Solve a puzzle',
  camera_guide: 'Camera guidance', verify_organizer: 'Organizer approval', verify_image: 'Photograph review',
  set_variable: 'Remember a value', branch: 'Conditional route', random_branch: 'Random route', add_points: 'Award or deduct points',
};

export function newId(prefix: string, used: Iterable<string> = []): string {
  const existing = new Set(used);
  let index = 1;
  while (existing.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

export function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

export function isInteractiveNode(node: FlowNode): node is InteractiveNode {
  return !['set_variable', 'branch', 'random_branch', 'add_points', 'complete'].includes(node.type);
}

export function nodeTargets(node: FlowNode): string[] {
  const targets = node.type === 'choose_path' || node.type === 'random_branch' ? node.choices.map(choice => choice.next) : node.type === 'branch' ? [node.ifTrue, node.ifFalse] : 'next' in node ? [node.next] : [];
  const fallback = 'fallback' in node ? node.fallback as { nodeId?: string; enabled?: boolean } | undefined : undefined;
  if (fallback?.nodeId) targets.push(fallback.nodeId);
  return targets;
}

export function rewriteTargets(node: FlowNode, from: string, to: string): FlowNode {
  let result: FlowNode = node.type === 'choose_path'
    ? { ...node, choices: node.choices.map(choice => ({ ...choice, next: choice.next === from ? to : choice.next })) }
    : node.type === 'random_branch' ? { ...node, choices: node.choices.map(choice => ({ ...choice, next: choice.next === from ? to : choice.next })) }
    : node.type === 'branch' ? { ...node, ifTrue: node.ifTrue === from ? to : node.ifTrue, ifFalse: node.ifFalse === from ? to : node.ifFalse }
    : 'next' in node && node.next === from ? { ...node, next: to } : { ...node };
  if ('fallback' in result) {
    const fallback = result.fallback as { nodeId?: string } | undefined;
    if (fallback?.nodeId === from) result = Object.assign({}, result, { fallback: { ...fallback, nodeId: to } });
  }
  return result;
}

export function canConnect(checkpoint: CheckpointDefinition, sourceId: string, targetId: string): boolean {
  if (!targetId || sourceId === targetId || !checkpoint.flow.nodes.some(node => node.id === targetId)) return false;
  const visited = new Set<string>();
  const reachesSource = (id: string): boolean => {
    if (id === sourceId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    const node = checkpoint.flow.nodes.find(candidate => candidate.id === id);
    return Boolean(node && nodeTargets(node).some(reachesSource));
  };
  return !reachesSource(targetId);
}

export function createCheckpoint(hunt: HuntDefinition): CheckpointDefinition {
  return {
    id: newId('checkpoint', hunt.checkpoints.map(checkpoint => checkpoint.id)),
    title: `Checkpoint ${hunt.checkpoints.length + 1}`,
    basePoints: 20,
    flow: { startNodeId: 'clue', nodes: [
      { id: 'clue', type: 'show_text', text: '', next: 'answer' },
      { id: 'answer', type: 'verify_answer', prompt: '', answers: [''], next: 'finish' },
      { id: 'finish', type: 'complete' },
    ] },
    hints: [],
  };
}

export function duplicateCheckpoint(hunt: HuntDefinition, checkpoint: CheckpointDefinition): CheckpointDefinition {
  const result = copy(checkpoint);
  result.id = newId('checkpoint', hunt.checkpoints.map(candidate => candidate.id));
  result.title = `${checkpoint.title} (copy)`;
  // A copied checkpoint must not become its own prerequisite.
  if (result.prerequisites) result.prerequisites = result.prerequisites.filter(id => id !== checkpoint.id);
  const usedHints = new Set(hunt.checkpoints.flatMap(candidate => candidate.hints.map(hint => hint.id)));
  const mapping = new Map(result.hints.map(hint => {
    const id = newId('hint', usedHints);
    usedHints.add(id);
    return [hint.id, id];
  }));
  result.hints = result.hints.map(hint => ({ ...hint, id: mapping.get(hint.id)!, ...(hint.availability ? {
    availability: { ...hint.availability, ...(hint.availability.afterHintIds ? { afterHintIds: hint.availability.afterHintIds.map(id => mapping.get(id) || id) } : {}) },
  } : {}) }));
  result.flow.nodes = result.flow.nodes.map(node => node.type === 'branch' && node.condition.type === 'hint_used' && mapping.has(node.condition.hintId)
    ? { ...node, condition: { ...node.condition, hintId: mapping.get(node.condition.hintId)! } } : node);
  return result;
}

export function createNode(type: FlowNode['type'], id: string, next: string): FlowNode {
  switch (type) {
    case 'show_text': return { id, type, text: '', next };
    case 'verify_answer': return { id, type, prompt: '', answers: [''], next };
    case 'verify_code': return { id, type, prompt: 'Enter the code you found.', code: '', next };
    case 'verify_qr': return { id, type, prompt: 'Find and scan the checkpoint QR.', token: '', next };
    case 'verify_gps': return { id, type, prompt: 'Check your location when you have arrived.', latitude: 0, longitude: 0, radiusMeters: 75, maxAccuracyMeters: 100, next };
    case 'choose_path': return { id, type, prompt: 'How would you like to continue?', choices: [{ id: 'primary', label: 'Main route', next }, { id: 'alternative', label: 'Alternative route', next }] };
    case 'complete': return { id, type };
    case 'show_media': return { id, type, content: { type: 'image', url: '', alt: '' }, next };
    case 'puzzle': return { id, type, prompt: 'Solve the puzzle to continue.', puzzle: defaultPuzzle('text'), next };
    case 'camera_guide': return { id, type, prompt: 'Match the reference with the landmark in front of you.', next };
    case 'verify_organizer': return { id, type, prompt: 'Show the organizer what you found. They will approve this step.', next };
    case 'verify_image': return { id, type, prompt: 'Photograph the landmark for organizer review.', referenceImages: [], next };
    case 'set_variable': return { id, type, key: 'discovery', value: true, next };
    case 'branch': return { id, type, condition: { type: 'variable', key: 'discovery', equals: true }, ifTrue: next, ifFalse: next };
    case 'random_branch': return { id, type, choices: [{ next, weight: 1 }, { next, weight: 1 }] };
    case 'add_points': return { id, type, amount: 5, label: 'Bonus', next };
    default: throw new Error(`The builder cannot create ${type} yet.`);
  }
}

/** Insert before a step, preserving all incoming routes, or leave disconnected for manual wiring. */
export function insertNode(checkpoint: CheckpointDefinition, node: FlowNode, beforeId?: string): CheckpointDefinition {
  if (!beforeId) return { ...checkpoint, flow: { ...checkpoint.flow, nodes: [...checkpoint.flow.nodes, node] } };
  const position = checkpoint.flow.nodes.findIndex(candidate => candidate.id === beforeId);
  if (position < 0) return checkpoint;
  const nodes = checkpoint.flow.nodes.map(candidate => rewriteTargets(candidate, beforeId, node.id));
  nodes.splice(position, 0, node);
  return { ...checkpoint, flow: { startNodeId: checkpoint.flow.startNodeId === beforeId ? node.id : checkpoint.flow.startNodeId, nodes } };
}

export function removeNode(checkpoint: CheckpointDefinition, nodeId: string, reconnectTo: string): CheckpointDefinition {
  if (nodeId === reconnectTo || !checkpoint.flow.nodes.some(node => node.id === reconnectTo)) return checkpoint;
  return { ...checkpoint, flow: {
    startNodeId: checkpoint.flow.startNodeId === nodeId ? reconnectTo : checkpoint.flow.startNodeId,
    nodes: checkpoint.flow.nodes.filter(node => node.id !== nodeId).map(node => rewriteTargets(node, nodeId, reconnectTo)),
  }, hints: checkpoint.hints.map(hint => {
    if (hint.availability?.afterNodeId !== nodeId) return hint;
    const availability = { ...hint.availability }; delete availability.afterNodeId;
    return { ...hint, availability };
  }) };
}

/** A real alternative route: QR OR GPS + manual code, converging on the former next step. */
export function addQrFallback(checkpoint: CheckpointDefinition, qrId: string): CheckpointDefinition {
  const qr = checkpoint.flow.nodes.find(node => node.id === qrId);
  if (!qr || qr.type !== 'verify_qr') return checkpoint;
  const used = new Set(checkpoint.flow.nodes.map(node => node.id));
  const branchId = newId('route', used); used.add(branchId);
  const gpsId = newId('fallback-gps', used); used.add(gpsId);
  const codeId = newId('fallback-code', used);
  const branch: FlowNode = { id: branchId, type: 'choose_path', prompt: 'Choose how to verify this location.', choices: [
    { id: 'qr', label: 'Scan the checkpoint QR', next: qrId },
    { id: 'backup', label: 'QR missing? Use location and backup code', next: gpsId },
  ] };
  const nodes: FlowNode[] = checkpoint.flow.nodes.map(node => rewriteTargets(node, qrId, branchId));
  nodes.push(branch, { id: gpsId, type: 'verify_gps', prompt: 'Check you are in the checkpoint area.', latitude: 0, longitude: 0, radiusMeters: 75, maxAccuracyMeters: 100, next: codeId },
    { id: codeId, type: 'verify_code', prompt: 'Enter the backup code for this location.', code: '', next: qr.next });
  return { ...checkpoint, flow: { startNodeId: checkpoint.flow.startNodeId === qrId ? branchId : checkpoint.flow.startNodeId, nodes } };
}

export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const destination = index + direction;
  if (destination < 0 || destination >= items.length) return items;
  const result = [...items];
  [result[index], result[destination]] = [result[destination], result[index]];
  return result;
}
