import type { FlowNode } from '@/lib/engine/types';

export type OutputPort =
  | { kind: 'next' }
  | { kind: 'fallback' }
  | { kind: 'branch'; branch: 'true' | 'false' }
  | { kind: 'choice'; choiceId: string }
  | { kind: 'random'; index: number };

export function outputPortId(port: OutputPort): string {
  switch (port.kind) {
    case 'next': return 'next';
    case 'fallback': return 'fallback';
    case 'branch': return `branch:${port.branch}`;
    case 'choice': return `choice:${port.choiceId}`;
    case 'random': return `random:${port.index}`;
  }
}

export function outputPorts(node: FlowNode): OutputPort[] {
  let ports: OutputPort[];
  switch (node.type) {
    case 'complete': ports = []; break;
    case 'branch': ports = [{ kind: 'branch', branch: 'true' }, { kind: 'branch', branch: 'false' }]; break;
    case 'choose_path': ports = node.choices.map(choice => ({ kind: 'choice', choiceId: choice.id })); break;
    case 'random_branch': ports = node.choices.map((_, index) => ({ kind: 'random', index })); break;
    default: ports = [{ kind: 'next' }];
  }
  if ('fallback' in node && node.fallback) ports.push({ kind: 'fallback' });
  return ports;
}

export function outputPortFromId(node: FlowNode, id: string | null | undefined): OutputPort | null {
  if (!id) return null;
  return outputPorts(node).find(port => outputPortId(port) === id) ?? null;
}

export function outputPortTarget(node: FlowNode, port: OutputPort): string {
  switch (port.kind) {
    case 'next': return 'next' in node ? node.next : '';
    case 'fallback': return 'fallback' in node ? node.fallback?.nodeId ?? '' : '';
    case 'branch': return node.type === 'branch' ? (port.branch === 'true' ? node.ifTrue : node.ifFalse) : '';
    case 'choice': return node.type === 'choose_path' ? node.choices.find(choice => choice.id === port.choiceId)?.next ?? '' : '';
    case 'random': return node.type === 'random_branch' ? node.choices[port.index]?.next ?? '' : '';
  }
}

export function outputPortLabel(node: FlowNode, port: OutputPort): string {
  switch (port.kind) {
    case 'next': return 'Next';
    case 'fallback': return 'Recovery';
    case 'branch': return port.branch === 'true' ? 'Matches' : 'Otherwise';
    case 'choice': return node.type === 'choose_path' ? node.choices.find(choice => choice.id === port.choiceId)?.label || 'Choice' : 'Choice';
    case 'random': return node.type === 'random_branch' ? `Route ${port.index + 1} · ${node.choices[port.index]?.weight ?? 0}` : `Route ${port.index + 1}`;
  }
}

export function setOutputPortTarget(node: FlowNode, port: OutputPort, targetId: string): FlowNode {
  switch (port.kind) {
    case 'next': return 'next' in node ? { ...node, next: targetId } : node;
    case 'fallback': return 'fallback' in node && node.fallback ? { ...node, fallback: { ...node.fallback, nodeId: targetId } } : node;
    case 'branch': return node.type === 'branch'
      ? port.branch === 'true' ? { ...node, ifTrue: targetId } : { ...node, ifFalse: targetId }
      : node;
    case 'choice': return node.type === 'choose_path'
      ? { ...node, choices: node.choices.map(choice => choice.id === port.choiceId ? { ...choice, next: targetId } : choice) }
      : node;
    case 'random': return node.type === 'random_branch'
      ? { ...node, choices: node.choices.map((choice, index) => index === port.index ? { ...choice, next: targetId } : choice) }
      : node;
  }
}

