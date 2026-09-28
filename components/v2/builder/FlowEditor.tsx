'use client';

import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps, type OnReconnect, type ReactFlowInstance,
} from '@xyflow/react';
import type { CheckpointDefinition, FlowNode, HuntDefinition } from '@/lib/engine/types';
import { actionClass, buttonClass, Field, inputClass } from './Fields';
import { nodeDescriptor, createNode } from './catalog';
import { addQrFallback, canConnect, newId, nodeTargets } from './model';
import NodeEditor, { TargetPicker } from './NodeEditor';
import FlowNodeCard, { type FlowCanvasNode, type FlowNodeCardData } from './FlowNodeCard';
import {
  appendNode, canConnectPort, connectPort, disconnectPort, projectEdges, removeNodeAndDisconnect,
  removeNodeAndReconnect, setStartNode, START_NODE_ID,
} from './graph/mutations';
import { outputPortFromId, outputPortId, outputPortLabel, outputPortTarget, outputPorts, type OutputPort } from './graph/ports';
import { applyFlowHistoryEntry, createFlowHistoryEntry, type FlowHistoryEntry } from './graph/history';

interface StartData extends Record<string, unknown> { targetLabel: string; connected: boolean }
type StartCanvasNode = Node<StartData, 'startNode'>;
type CanvasNode = FlowCanvasNode | StartCanvasNode;
interface CanvasEdgeData extends Record<string, unknown> { sourceId: string; port: OutputPort | { kind: 'start' } }
type CanvasEdge = Edge<CanvasEdgeData>;

const commonTypes: FlowNode['type'][] = ['show_text', 'verify_answer', 'verify_qr', 'verify_code', 'verify_gps', 'puzzle', 'verify_image', 'show_media', 'complete'];
const advancedTypes: FlowNode['type'][] = ['choose_path', 'branch', 'random_branch', 'set_variable', 'add_points', 'camera_guide', 'verify_organizer'];

function StartNode({ data, selected }: NodeProps<StartCanvasNode>) {
  return <div className={`min-w-32 rounded-full border-2 bg-teal-800 px-4 py-3 text-center text-white shadow-sm ${selected ? 'ring-4 ring-teal-700/20' : 'border-teal-900'}`}>
    <p className="text-xs font-extrabold tracking-widest">START</p>
    <p className="mt-1 max-w-28 truncate text-[10px] text-teal-100">{data.connected ? data.targetLabel : 'Not connected'}</p>
    <Handle type="source" id="start" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white !bg-teal-300" aria-label="Checkpoint start connection" />
  </div>;
}

const nodeTypes = { huntNode: FlowNodeCard, startNode: StartNode };

function summary(node: FlowNode): string {
  if (node.type === 'show_text') return node.text;
  if ('prompt' in node) return node.prompt;
  if (node.type === 'show_media') return `${node.content.type} content`;
  if (node.type === 'set_variable') return `${node.key} = ${String(node.value)}`;
  if (node.type === 'branch') return node.condition.type === 'variable' ? `If ${node.condition.key} matches` : `If ${node.condition.type.replaceAll('_', ' ')}`;
  if (node.type === 'random_branch') return `${node.choices.length} weighted routes`;
  if (node.type === 'add_points') return `${node.amount >= 0 ? '+' : ''}${node.amount} · ${node.label}`;
  return 'Checkpoint complete';
}

function autoPositions(checkpoint: CheckpointDefinition): Record<string, { x: number; y: number }> {
  const depths = new Map<string, number>();
  if (checkpoint.flow.startNodeId) depths.set(checkpoint.flow.startNodeId, 0);
  for (let pass = 0; pass < checkpoint.flow.nodes.length; pass += 1) {
    let changed = false;
    for (const node of checkpoint.flow.nodes) {
      const depth = depths.get(node.id);
      if (depth === undefined) continue;
      for (const target of nodeTargets(node)) {
        if (!checkpoint.flow.nodes.some(candidate => candidate.id === target)) continue;
        const proposed = Math.min(checkpoint.flow.nodes.length, depth + 1);
        if ((depths.get(target) ?? -1) < proposed) { depths.set(target, proposed); changed = true; }
      }
    }
    if (!changed) break;
  }
  const unconnectedDepth = Math.max(0, ...depths.values()) + 1;
  const rows = new Map<number, number>();
  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of checkpoint.flow.nodes) {
    const depth = depths.get(node.id) ?? unconnectedDepth;
    const row = rows.get(depth) ?? 0;
    rows.set(depth, row + 1);
    positions[node.id] = { x: 250 + depth * 290, y: 30 + row * 180 };
  }
  positions[START_NODE_ID] = { x: 25, y: 55 };
  return positions;
}

export default function FlowEditor({ value, hunt, onChange, disabled = false }: { value: CheckpointDefinition; hunt: HuntDefinition; onChange: (value: CheckpointDefinition) => void; disabled?: boolean }) {
  const [selectedId, setSelectedId] = useState(value.flow.startNodeId || value.flow.nodes[0]?.id || '');
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() => autoPositions(value));
  const [pendingPort, setPendingPort] = useState<{ sourceId: string; port: OutputPort } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [reconnectTo, setReconnectTo] = useState('');
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(() => new Set());
  const [statusMessage, setStatusMessage] = useState('');
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<CanvasNode, CanvasEdge> | null>(null);
  const undoStack = useRef<FlowHistoryEntry[]>([]);
  const redoStack = useRef<FlowHistoryEntry[]>([]);
  const editGroup = useRef<{ key: string; at: number } | null>(null);
  const nodeSignature = value.flow.nodes.map(node => node.id).join('|');
  const selected = value.flow.nodes.find(node => node.id === selectedId) || value.flow.nodes[0];

  useEffect(() => {
    setPositions(previous => {
      const generated = autoPositions(value);
      const next = { ...previous };
      for (const id of [START_NODE_ID, ...value.flow.nodes.map(node => node.id)]) next[id] ??= generated[id];
      return next;
    });
  // Position reconciliation only depends on node identity, not field edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeSignature]);

  const commit = useCallback((next: CheckpointDefinition, message: string, group = '') => {
    if (disabled || next === value || JSON.stringify({ flow: next.flow, hints: next.hints }) === JSON.stringify({ flow: value.flow, hints: value.hints })) return;
    const now = Date.now();
    const coalesce = Boolean(group && editGroup.current?.key === group && now - editGroup.current.at < 800);
    const entry = createFlowHistoryEntry(value, next);
    if (coalesce && undoStack.current.length > 0) undoStack.current[undoStack.current.length - 1].after = entry.after;
    else undoStack.current.push(entry);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    editGroup.current = group ? { key: group, at: now } : null;
    onChange(next); setStatusMessage(message);
  }, [disabled, onChange, value]);

  const undo = useCallback(() => {
    if (disabled) return;
    const entry = undoStack.current.pop();
    if (!entry) return;
    redoStack.current.push(entry); editGroup.current = null;
    onChange(applyFlowHistoryEntry(value, entry, 'undo')); setStatusMessage('Undid the last flow change.');
  }, [disabled, onChange, value]);

  const redo = useCallback(() => {
    if (disabled) return;
    const entry = redoStack.current.pop();
    if (!entry) return;
    undoStack.current.push(entry); editGroup.current = null;
    onChange(applyFlowHistoryEntry(value, entry, 'redo')); setStatusMessage('Redid the flow change.');
  }, [disabled, onChange, value]);

  const ids = useMemo(() => new Set(value.flow.nodes.map(node => node.id)), [value.flow.nodes]);
  const nodes = useMemo<CanvasNode[]>(() => {
    const startTarget = value.flow.nodes.find(node => node.id === value.flow.startNodeId);
    const start: StartCanvasNode = { id: START_NODE_ID, type: 'startNode', position: positions[START_NODE_ID] ?? { x: 25, y: 55 }, data: { targetLabel: startTarget ? nodeDescriptor(startTarget.type).shortLabel : '', connected: Boolean(startTarget) }, selectable: true, deletable: false };
    return [start, ...value.flow.nodes.map((node): FlowCanvasNode => {
      const ports = outputPorts(node).map(port => {
        const target = outputPortTarget(node, port);
        return { port, label: outputPortLabel(node, port), connected: ids.has(target), invalid: !target || !ids.has(target) };
      });
      const data: FlowNodeCardData = { node, ports, summary: summary(node), warningCount: ports.filter(port => port.invalid).length };
      return { id: node.id, type: 'huntNode', position: positions[node.id] ?? { x: 250, y: 30 }, data, selected: node.id === selected?.id, deletable: false };
    })];
  }, [ids, positions, selected?.id, value.flow.nodes, value.flow.startNodeId]);

  const edges = useMemo<CanvasEdge[]>(() => projectEdges(value).map(edge => {
    const fallback = edge.port.kind === 'fallback';
    const source = edge.port.kind === 'start' ? undefined : value.flow.nodes.find(node => node.id === edge.sourceId);
    const label = source && edge.port.kind !== 'start' ? outputPortLabel(source, edge.port) : '';
    return {
      id: edge.id, source: edge.sourceId, target: edge.targetId,
      sourceHandle: edge.port.kind === 'start' ? 'start' : outputPortId(edge.port), targetHandle: 'target',
      data: { sourceId: edge.sourceId, port: edge.port }, label,
      selected: selectedEdges.has(edge.id), reconnectable: disabled ? false : 'target',
      markerEnd: { type: MarkerType.ArrowClosed, color: fallback ? '#d97706' : '#0f766e' },
      style: { stroke: fallback ? '#d97706' : '#64748b', strokeWidth: 2, strokeDasharray: fallback ? '7 5' : undefined },
      labelStyle: { fill: fallback ? '#92400e' : '#475569', fontSize: 10, fontWeight: 600 },
    };
  }), [disabled, selectedEdges, value]);

  const validConnection = useCallback((connection: Connection | CanvasEdge) => {
    if (disabled || !connection.source || !connection.target || connection.target === START_NODE_ID) return false;
    if (connection.source === START_NODE_ID) return ids.has(connection.target);
    const source = value.flow.nodes.find(node => node.id === connection.source);
    const port = source ? outputPortFromId(source, connection.sourceHandle) : null;
    return Boolean(port && canConnectPort(value, source!.id, port, connection.target));
  }, [disabled, ids, value]);

  const makeConnection = useCallback((connection: Connection) => {
    if (disabled || !validConnection(connection) || !connection.source || !connection.target) return;
    if (connection.source === START_NODE_ID) commit(setStartNode(value, connection.target), 'Changed the checkpoint start.');
    else {
      const source = value.flow.nodes.find(node => node.id === connection.source);
      const port = source ? outputPortFromId(source, connection.sourceHandle) : null;
      if (source && port) commit(connectPort(value, source.id, port, connection.target), `Connected ${outputPortLabel(source, port)}.`);
    }
  }, [commit, disabled, validConnection, value]);

  const reconnectEdge = useCallback<OnReconnect<CanvasEdge>>((oldEdge, connection) => {
    if (disabled || !connection.target || !validConnection(connection)) return;
    const port = oldEdge.data?.port;
    if (!port) return;
    if (port.kind === 'start') commit(setStartNode(value, connection.target), 'Changed the checkpoint start.');
    else commit(connectPort(value, oldEdge.data!.sourceId, port, connection.target), 'Reconnected the route.');
  }, [commit, disabled, validConnection, value]);

  const deleteEdges = useCallback((deleted: CanvasEdge[]) => {
    if (disabled) return;
    let next = value;
    for (const edge of deleted) {
      const port = edge.data?.port;
      if (!port) continue;
      next = port.kind === 'start' ? setStartNode(next, '') : disconnectPort(next, edge.data!.sourceId, port);
    }
    commit(next, `${deleted.length === 1 ? 'Route' : 'Routes'} disconnected.`);
    setSelectedEdges(new Set());
  }, [commit, disabled, value]);

  const selectNode = useCallback((id: string) => {
    if (id === START_NODE_ID) return;
    if (pendingPort) {
      if (disabled) return;
      const source = value.flow.nodes.find(node => node.id === pendingPort.sourceId);
      const next = connectPort(value, pendingPort.sourceId, pendingPort.port, id);
      if (next !== value && source) commit(next, `Connected ${outputPortLabel(source, pendingPort.port)}.`);
      setPendingPort(null);
    } else { setSelectedId(id); setRemoving(false); }
  }, [commit, disabled, pendingPort, value]);

  function replace(node: FlowNode) {
    if (disabled) return;
    const next = { ...value, flow: { ...value.flow, nodes: value.flow.nodes.map(candidate => candidate.id === node.id ? node : candidate) } };
    commit(next, `Updated ${nodeDescriptor(node.type).shortLabel}.`, `edit:${node.id}`);
  }

  function addNode(type: FlowNode['type']) {
    if (disabled) return;
    const node = createNode(type, newId(type.replaceAll('_', '-'), value.flow.nodes.map(candidate => candidate.id)));
    const next = appendNode(value, node);
    const anchor = selected ? positions[selected.id] : undefined;
    setPositions(previous => ({ ...previous, [node.id]: anchor ? { x: anchor.x + 290, y: anchor.y + 80 } : { x: 300, y: 200 } }));
    commit(next, `Added ${nodeDescriptor(type).shortLabel}.`); setSelectedId(node.id); setRemoving(false);
  }

  function requestInspectorConnection(choiceId?: string) {
    if (disabled || !selected) return;
    const port: OutputPort | null = selected.type === 'choose_path' && choiceId ? { kind: 'choice', choiceId }
      : selected.type === 'branch' ? { kind: 'branch', branch: choiceId === 'true' ? 'true' : 'false' }
      : selected.type === 'random_branch' && choiceId?.startsWith('random:') ? { kind: 'random', index: Number(choiceId.slice(7)) }
      : 'next' in selected ? { kind: 'next' } : null;
    if (port) { setPendingPort({ sourceId: selected.id, port }); setStatusMessage(`Choose a destination for ${outputPortLabel(selected, port)}.`); }
  }

  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    if (disabled) return;
    for (const change of changes) if (change.type === 'position' && change.position) setPositions(previous => ({ ...previous, [change.id]: change.position! }));
  }, [disabled]);

  const onEdgesChange = useCallback((changes: EdgeChange<CanvasEdge>[]) => {
    setSelectedEdges(previous => {
      const next = new Set(previous);
      for (const change of changes) if (change.type === 'select') change.selected ? next.add(change.id) : next.delete(change.id);
      return next;
    });
  }, []);

  function resetLayout() {
    if (disabled) return;
    setPositions(autoPositions(value)); setStatusMessage('Automatically arranged the checkpoint flow.');
    window.setTimeout(() => void flowInstance?.fitView({ padding: 0.08, duration: 300 }), 0);
  }

  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <Field label="Checkpoint starts at"><select className={inputClass} value={value.flow.startNodeId} onChange={event => commit(setStartNode(value, event.target.value), 'Changed the checkpoint start.')}><option value="">Not connected</option>{value.flow.nodes.map(node => <option key={node.id} value={node.id}>{nodeDescriptor(node.type).shortLabel} · {node.id}</option>)}</select></Field>
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={disabled || undoStack.current.length === 0} onClick={undo}>Undo</button><button type="button" className={buttonClass} disabled={disabled || redoStack.current.length === 0} onClick={redo}>Redo</button><button type="button" className={buttonClass} disabled={disabled} onClick={resetLayout}>Auto arrange</button><button type="button" className={buttonClass} disabled={disabled} onClick={() => void flowInstance?.fitView({ padding: 0.08, duration: 300 })}>Fit flow</button></div>
    </div>
    {pendingPort && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-teal-50 p-3 text-sm text-teal-950"><p>Select a destination card, or drag from the highlighted node handle. Routes that create a loop are rejected.</p><button type="button" className={buttonClass} onClick={() => setPendingPort(null)}>Cancel connection</button></div>}
    <p className="sr-only" aria-live="polite">{statusMessage}</p>
    <div className="grid min-w-0 gap-4 xl:grid-cols-[13rem_minmax(0,1fr)_22rem]">
      <aside className="rounded-xl border border-slate-200 bg-white p-3" aria-label="Node library">
        <h4 className="text-sm font-bold">Add a step</h4><p className="mt-1 text-xs leading-5 text-slate-500">Add it, then connect its sockets on the canvas.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-1">{commonTypes.map(type => <button key={type} type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-teal-600 hover:bg-teal-50" title={nodeDescriptor(type).description} onClick={() => addNode(type)}><span className="block text-xs font-semibold">+ {nodeDescriptor(type).shortLabel}</span></button>)}</div>
        <details className="mt-3 border-t border-slate-200 pt-3"><summary className="cursor-pointer py-2 text-xs font-bold text-slate-700">Logic & advanced</summary><div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-1">{advancedTypes.map(type => <button key={type} type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-teal-600 hover:bg-teal-50" title={nodeDescriptor(type).description} onClick={() => addNode(type)}><span className="block text-xs font-semibold">+ {nodeDescriptor(type).shortLabel}</span></button>)}</div></details>
      </aside>
      <div className="min-w-0 space-y-2">
        <p className="text-xs leading-5 text-slate-500">Drag nodes to arrange them. Drag a socket to connect it. Select an edge and press Delete to disconnect it. Dashed amber routes are player recovery paths.</p>
        <div className="h-[38rem] overflow-hidden rounded-xl border border-slate-200 bg-slate-50" role="region" aria-label="Editable checkpoint flow">
          <ReactFlow<CanvasNode, CanvasEdge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={setFlowInstance} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeClick={(_, node) => selectNode(node.id)} onConnect={makeConnection} onReconnect={reconnectEdge} onEdgesDelete={deleteEdges} isValidConnection={validConnection} nodesDraggable={!disabled} nodesConnectable={!disabled} elementsSelectable={!disabled} edgesReconnectable={!disabled} deleteKeyCode={disabled ? null : ['Backspace', 'Delete']} fitView fitViewOptions={{ padding: 0.08 }} minZoom={0.25} maxZoom={1.75} connectionRadius={28} elevateEdgesOnSelect>
            <Background gap={22} size={1} color="#cbd5e1" /><Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>
      <aside className="min-w-0 rounded-xl border border-slate-200 bg-white p-4" aria-label="Step settings">
        <Field label="Selected step"><select className={inputClass} value={selected?.id || ''} onChange={event => selectNode(event.target.value)}>{value.flow.nodes.map(node => <option key={node.id} value={node.id}>{nodeDescriptor(node.type).shortLabel} · {node.id}</option>)}</select></Field>
        {selected && <div className="mt-5">
          <div className="mb-5 flex items-start justify-between gap-3"><div><h4 className="text-lg font-bold">{nodeDescriptor(selected.type).label}</h4><p className="mt-1 font-mono text-xs text-slate-500">{selected.id}</p></div><button type="button" className={buttonClass} disabled={disabled || value.flow.nodes.length <= 1 || (selected.type === 'complete' && value.flow.nodes.filter(node => node.type === 'complete').length <= 1)} onClick={() => { setRemoving(!removing); setReconnectTo(nodeTargets(selected)[0] || value.flow.nodes.find(node => node.id !== selected.id && node.type === 'complete')?.id || ''); }}>Remove</button></div>
          {removing ? <div className="space-y-4 rounded-lg bg-amber-50 p-4">
            <p className="text-sm leading-6">Safely remove this step and redirect every incoming route. Hint availability tied to it will also be cleared.</p>
            <TargetPicker label="Reconnect incoming routes to" checkpoint={value} sourceId={selected.id} value={reconnectTo} onChange={setReconnectTo} />
            <div className="flex flex-wrap gap-2"><button type="button" className={actionClass} disabled={disabled || !canConnect(value, selected.id, reconnectTo)} onClick={() => { const next = removeNodeAndReconnect(value, selected.id, reconnectTo); if (next !== value) { commit(next, `Removed ${nodeDescriptor(selected.type).shortLabel} and reconnected its routes.`); setSelectedId(reconnectTo); } setRemoving(false); }}>Remove & reconnect</button><button type="button" className={buttonClass} disabled={disabled} onClick={() => { const next = removeNodeAndDisconnect(value, selected.id); if (next !== value) { commit(next, `Removed ${nodeDescriptor(selected.type).shortLabel}; incoming routes are disconnected.`); setSelectedId(next.flow.startNodeId || next.flow.nodes[0]?.id || ''); } setRemoving(false); }}>Remove without reconnecting</button><button type="button" className={buttonClass} disabled={disabled} onClick={() => setRemoving(false)}>Cancel</button></div>
          </div> : <NodeEditor key={selected.id} checkpoint={value} hunt={hunt} node={selected} onChange={replace} onConnect={requestInspectorConnection} onAddQrFallback={() => { const result = addQrFallback(value, selected.id); commit(result, 'Added a GPS and code alternative route.'); const branch = result.flow.nodes.find(node => node.type === 'choose_path' && node.choices.some(choice => choice.next === selected.id)); if (branch) setSelectedId(branch.id); }} />}
        </div>}
      </aside>
    </div>
  </section>;
}
