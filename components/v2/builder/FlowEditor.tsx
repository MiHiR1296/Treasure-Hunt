'use client';

import { useId, useMemo, useState } from 'react';
import type { CheckpointDefinition, FlowNode, HuntDefinition } from '@/lib/engine/types';
import { actionClass, buttonClass, Field, inputClass } from './Fields';
import { addQrFallback, canConnect, createNode, insertNode, newId, nodeLabels, nodeTargets, removeNode } from './model';
import NodeEditor, { TargetPicker } from './NodeEditor';

const availableTypes: FlowNode['type'][] = ['show_text', 'show_media', 'verify_answer', 'verify_qr', 'verify_code', 'verify_gps', 'puzzle', 'camera_guide', 'verify_image', 'verify_organizer', 'choose_path', 'branch', 'random_branch', 'set_variable', 'add_points'];

function FlowCanvas({ checkpoint, selectedId, connectingFrom, onSelect }: {
  checkpoint: CheckpointDefinition; selectedId: string; connectingFrom?: string; onSelect: (id: string) => void;
}) {
  const markerId = `flow-arrow-${useId().replace(/:/g, '')}`;
  const layout = useMemo(() => {
    const depths = new Map<string, number>([[checkpoint.flow.startNodeId, 0]]);
    // Bounded passes also allow the editor to show an invalid imported graph safely.
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
    const lastDepth = Math.max(0, ...depths.values()) + 1;
    const counts = new Map<number, number>();
    const points = new Map<string, { x: number; y: number }>();
    checkpoint.flow.nodes.forEach(node => {
      const depth = depths.get(node.id) ?? lastDepth;
      const column = counts.get(depth) || 0;
      counts.set(depth, column + 1);
      points.set(node.id, { x: 24 + column * 244, y: 28 + depth * 130 });
    });
    return { points, width: Math.max(290, Math.max(1, ...counts.values()) * 244 + 40), height: (Math.max(0, ...counts.keys()) + 1) * 130 + 30 };
  }, [checkpoint]);

  return <div className="max-h-[36rem] overflow-auto rounded-xl border border-slate-200 bg-slate-50" role="region" aria-label="Editable checkpoint flow" tabIndex={0}>
    <div className="relative" style={{ width: layout.width, height: layout.height }}>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0" width={layout.width} height={layout.height}>
        <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="#64748b" /></marker></defs>
        {checkpoint.flow.nodes.flatMap(node => {
          const source = layout.points.get(node.id)!;
          return nodeTargets(node).flatMap((targetId, index) => {
            const target = layout.points.get(targetId);
            if (!target) return [];
            const sx = source.x + 100; const sy = source.y + 82; const tx = target.x + 100; const ty = target.y;
            return [<path key={`${node.id}:${index}:${targetId}`} d={`M ${sx} ${sy} C ${sx} ${sy + 30}, ${tx} ${ty - 30}, ${tx} ${ty - 3}`} fill="none" stroke={node.id === selectedId ? '#0f766e' : '#94a3b8'} strokeWidth="2" markerEnd={`url(#${markerId})`} />];
          });
        })}
      </svg>
      {checkpoint.flow.nodes.map((node, index) => {
        const point = layout.points.get(node.id)!;
        const preview = node.type === 'show_text' ? node.text : 'prompt' in node ? node.prompt : 'Award points and continue';
        const selectable = !connectingFrom || canConnect(checkpoint, connectingFrom, node.id);
        return <button key={node.id} type="button" onClick={() => onSelect(node.id)} disabled={!selectable} aria-pressed={selectedId === node.id} className={`absolute h-[84px] w-[200px] rounded-xl border-2 p-3 text-left shadow-sm disabled:opacity-40 ${connectingFrom && selectable ? 'border-dashed border-teal-700 bg-teal-50' : node.id === selectedId ? 'border-teal-700 bg-white ring-2 ring-teal-700/10' : node.type === 'complete' ? 'border-teal-200 bg-teal-50' : 'border-slate-200 bg-white'}`} style={{ left: point.x, top: point.y }}>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">{node.id === checkpoint.flow.startNodeId ? 'Start · ' : ''}{node.type === 'complete' ? 'Finish' : `Step ${index + 1}`}</span>
          <span className="mt-0.5 block truncate text-sm font-bold text-slate-800">{nodeLabels[node.type] || node.type}</span>
          <span className="mt-1 block truncate text-xs text-slate-500">{preview || 'Select to configure'}</span>
        </button>;
      })}
    </div>
  </div>;
}

export default function FlowEditor({ value, hunt, onChange }: { value: CheckpointDefinition; hunt: HuntDefinition; onChange: (value: CheckpointDefinition) => void }) {
  const [selectedId, setSelectedId] = useState(value.flow.startNodeId);
  const [newType, setNewType] = useState<FlowNode['type']>('show_text');
  const [insertBefore, setInsertBefore] = useState(value.flow.nodes.find(node => node.type === 'complete')?.id || '');
  const [connecting, setConnecting] = useState<{ sourceId: string; choiceId?: string } | null>(null);
  const [removing, setRemoving] = useState(false);
  const [reconnectTo, setReconnectTo] = useState('');
  const selected = value.flow.nodes.find(node => node.id === selectedId) || value.flow.nodes[0];
  const beforeId = value.flow.nodes.some(node => node.id === insertBefore) ? insertBefore : '';

  function replace(node: FlowNode) { onChange({ ...value, flow: { ...value.flow, nodes: value.flow.nodes.map(candidate => candidate.id === node.id ? node : candidate) } }); }

  function select(id: string) {
    if (connecting) {
      if (!canConnect(value, connecting.sourceId, id)) return;
      const source = value.flow.nodes.find(node => node.id === connecting.sourceId);
      if (source?.type === 'choose_path' && connecting.choiceId) replace({ ...source, choices: source.choices.map(choice => choice.id === connecting.choiceId ? { ...choice, next: id } : choice) });
      else if (source?.type === 'branch') replace({ ...source, ...(connecting.choiceId === 'true' ? { ifTrue: id } : { ifFalse: id }) });
      else if (source?.type === 'random_branch' && connecting.choiceId?.startsWith('random:')) replace({ ...source, choices: source.choices.map((choice, index) => index === Number(connecting.choiceId!.slice(7)) ? { ...choice, next: id } : choice) });
      else if (source && 'next' in source) replace({ ...source, next: id });
      setConnecting(null);
    } else { setSelectedId(id); setRemoving(false); }
  }

  return <section className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
      <Field label="Add an action"><select className={inputClass} value={newType} onChange={event => setNewType(event.target.value as FlowNode['type'])}>{availableTypes.map(type => <option key={type} value={type}>{nodeLabels[type]}</option>)}</select></Field>
      <Field label="Insert before"><select className={inputClass} value={beforeId} onChange={event => setInsertBefore(event.target.value)}><option value="">Unconnected — wire on canvas</option>{value.flow.nodes.map((node, index) => <option key={node.id} value={node.id}>{index + 1}. {nodeLabels[node.type] || node.type}</option>)}</select></Field>
      <button type="button" className={`${actionClass} self-end`} onClick={() => {
        const terminal = value.flow.nodes.find(node => node.type === 'complete')?.id || '';
        const node = createNode(newType, newId(newType.replaceAll('_', '-'), value.flow.nodes.map(candidate => candidate.id)), beforeId || terminal);
        onChange(insertNode(value, node, beforeId || undefined));
        setSelectedId(node.id); setRemoving(false);
      }}>Add step</button>
    </div>
    <Field label="Checkpoint starts at"><select className={inputClass} value={value.flow.startNodeId} onChange={event => onChange({ ...value, flow: { ...value.flow, startNodeId: event.target.value } })}>{value.flow.nodes.map((node, index) => <option key={node.id} value={node.id}>{index + 1}. {nodeLabels[node.type] || node.type}</option>)}</select></Field>
    {connecting && <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-teal-50 p-3 text-sm text-teal-950"><p>Select the next step on the canvas. Connections that would create a loop are disabled.</p><button type="button" className={buttonClass} onClick={() => setConnecting(null)}>Cancel connection</button></div>}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,1fr)]">
      <div className="space-y-2"><p className="text-xs leading-5 text-slate-500">Select a card to edit it. Use its connection button to draw a route to another card. Arrows show play order.</p><FlowCanvas checkpoint={value} selectedId={selected?.id || ''} connectingFrom={connecting?.sourceId} onSelect={select} /></div>
      {selected && <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-5 flex items-start justify-between gap-3"><div><h4 className="text-lg font-bold">{nodeLabels[selected.type] || selected.type}</h4><p className="mt-1 font-mono text-xs text-slate-500">{selected.id}</p></div>{selected.type !== 'complete' && <button type="button" className={buttonClass} onClick={() => { setRemoving(!removing); setReconnectTo(nodeTargets(selected)[0] || value.flow.nodes.find(node => node.type === 'complete')?.id || ''); }}>Remove step</button>}</div>
        {removing ? <div className="space-y-4 rounded-lg bg-amber-50 p-4">
          <p className="text-sm leading-6">Remove this step and send all routes entering it to the step below. Its outgoing route choices will be removed.</p>
          <TargetPicker label="Reconnect incoming routes to" checkpoint={value} sourceId={selected.id} value={reconnectTo} onChange={setReconnectTo} />
          <div className="flex gap-2"><button type="button" className={actionClass} disabled={!canConnect(value, selected.id, reconnectTo)} onClick={() => { onChange(removeNode(value, selected.id, reconnectTo)); setSelectedId(reconnectTo); setRemoving(false); }}>Remove and reconnect</button><button type="button" className={buttonClass} onClick={() => setRemoving(false)}>Keep step</button></div>
        </div> : <NodeEditor key={selected.id} checkpoint={value} hunt={hunt} node={selected} onChange={replace} onConnect={choiceId => setConnecting({ sourceId: selected.id, choiceId })} onAddQrFallback={() => { const result = addQrFallback(value, selected.id); onChange(result); setSelectedId(result.flow.nodes.find(node => node.type === 'choose_path' && node.choices.some(choice => choice.next === selected.id))?.id || selected.id); }} />}
      </div>}
    </div>
  </section>;
}
