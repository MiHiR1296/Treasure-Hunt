import type { CheckpointDefinition, FlowNode } from '@/lib/engine/types';
import { outputPortId, outputPorts, outputPortTarget, setOutputPortTarget, type OutputPort } from './ports';

export const START_NODE_ID = '::builder-start::';

export interface ProjectedEdge {
  id: string;
  sourceId: string;
  port: OutputPort | { kind: 'start' };
  targetId: string;
}

export function projectEdges(checkpoint: CheckpointDefinition): ProjectedEdge[] {
  const ids = new Set(checkpoint.flow.nodes.map(node => node.id));
  const edges: ProjectedEdge[] = [];
  if (ids.has(checkpoint.flow.startNodeId)) edges.push({ id: 'start', sourceId: START_NODE_ID, port: { kind: 'start' }, targetId: checkpoint.flow.startNodeId });
  for (const node of checkpoint.flow.nodes) for (const port of outputPorts(node)) {
    const targetId = outputPortTarget(node, port);
    if (ids.has(targetId)) edges.push({ id: `${node.id}::${port.kind === 'choice' ? `choice:${port.choiceId}` : port.kind === 'branch' ? `branch:${port.branch}` : port.kind === 'random' ? `random:${port.index}` : port.kind}`, sourceId: node.id, port, targetId });
  }
  return edges;
}

export function nodeTargets(node: FlowNode): string[] {
  return outputPorts(node).map(port => outputPortTarget(node, port)).filter(Boolean);
}

function replaceNode(checkpoint: CheckpointDefinition, replacement: FlowNode): CheckpointDefinition {
  return { ...checkpoint, flow: { ...checkpoint.flow, nodes: checkpoint.flow.nodes.map(node => node.id === replacement.id ? replacement : node) } };
}

export function canConnectPort(checkpoint: CheckpointDefinition, sourceId: string, port: OutputPort, targetId: string): boolean {
  const source = checkpoint.flow.nodes.find(node => node.id === sourceId);
  if (!source || !outputPorts(source).some(candidate => outputPortId(candidate) === outputPortId(port))) return false;
  if (!targetId || sourceId === targetId || !checkpoint.flow.nodes.some(node => node.id === targetId)) return false;
  const prospective = replaceNode(checkpoint, setOutputPortTarget(source, port, targetId));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const cyclic = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const node = prospective.flow.nodes.find(candidate => candidate.id === id);
    const result = Boolean(node && nodeTargets(node).some(cyclic));
    visiting.delete(id); visited.add(id);
    return result;
  };
  return !prospective.flow.nodes.some(node => cyclic(node.id));
}

export function connectPort(checkpoint: CheckpointDefinition, sourceId: string, port: OutputPort, targetId: string): CheckpointDefinition {
  if (!canConnectPort(checkpoint, sourceId, port, targetId)) return checkpoint;
  const source = checkpoint.flow.nodes.find(node => node.id === sourceId)!;
  return replaceNode(checkpoint, setOutputPortTarget(source, port, targetId));
}

export function disconnectPort(checkpoint: CheckpointDefinition, sourceId: string, port: OutputPort): CheckpointDefinition {
  const source = checkpoint.flow.nodes.find(node => node.id === sourceId);
  return source ? replaceNode(checkpoint, setOutputPortTarget(source, port, '')) : checkpoint;
}

export function setStartNode(checkpoint: CheckpointDefinition, targetId: string): CheckpointDefinition {
  if (targetId && !checkpoint.flow.nodes.some(node => node.id === targetId)) return checkpoint;
  return { ...checkpoint, flow: { ...checkpoint.flow, startNodeId: targetId } };
}

export function appendNode(checkpoint: CheckpointDefinition, node: FlowNode): CheckpointDefinition {
  if (checkpoint.flow.nodes.some(candidate => candidate.id === node.id)) return checkpoint;
  return { ...checkpoint, flow: { ...checkpoint.flow, nodes: [...checkpoint.flow.nodes, node] } };
}

function rewriteReference(node: FlowNode, removedId: string, targetId: string): FlowNode {
  return outputPorts(node).reduce((current, port) => outputPortTarget(current, port) === removedId ? setOutputPortTarget(current, port, targetId) : current, node);
}

export function removeNodeAndReconnect(checkpoint: CheckpointDefinition, nodeId: string, reconnectTo: string): CheckpointDefinition {
  if (nodeId === reconnectTo || !checkpoint.flow.nodes.some(node => node.id === nodeId) || !checkpoint.flow.nodes.some(node => node.id === reconnectTo)) return checkpoint;
  const result: CheckpointDefinition = {
    ...checkpoint,
    flow: {
      startNodeId: checkpoint.flow.startNodeId === nodeId ? reconnectTo : checkpoint.flow.startNodeId,
      nodes: checkpoint.flow.nodes.filter(node => node.id !== nodeId).map(node => rewriteReference(node, nodeId, reconnectTo)),
    },
    hints: checkpoint.hints.map(hint => {
      if (hint.availability?.afterNodeId !== nodeId) return hint;
      const availability = { ...hint.availability }; delete availability.afterNodeId;
      return { ...hint, availability };
    }),
  };
  return hasCycle(result) ? checkpoint : result;
}

export function removeNodeAndDisconnect(checkpoint: CheckpointDefinition, nodeId: string): CheckpointDefinition {
  if (checkpoint.flow.nodes.length <= 1 || !checkpoint.flow.nodes.some(node => node.id === nodeId)) return checkpoint;
  return {
    ...checkpoint,
    flow: {
      startNodeId: checkpoint.flow.startNodeId === nodeId ? '' : checkpoint.flow.startNodeId,
      nodes: checkpoint.flow.nodes.filter(node => node.id !== nodeId).map(node => rewriteReference(node, nodeId, '')),
    },
    hints: checkpoint.hints.map(hint => {
      if (hint.availability?.afterNodeId !== nodeId) return hint;
      const availability = { ...hint.availability }; delete availability.afterNodeId;
      return { ...hint, availability };
    }),
  };
}

export function hasCycle(checkpoint: CheckpointDefinition): boolean {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const node = checkpoint.flow.nodes.find(candidate => candidate.id === id);
    const cycle = Boolean(node && nodeTargets(node).some(target => visit(target)));
    visiting.delete(id); visited.add(id);
    return cycle;
  };
  return checkpoint.flow.nodes.some(node => visit(node.id));
}
