'use client';

import { useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import type { FlowNode } from '@/lib/engine/types';
import { nodeDescriptor } from './catalog';
import { outputPortId, type OutputPort } from './graph/ports';

export interface FlowNodeCardData extends Record<string, unknown> {
  node: FlowNode;
  ports: { port: OutputPort; label: string; connected: boolean; invalid: boolean }[];
  summary: string;
  warningCount: number;
}

export type FlowCanvasNode = Node<FlowNodeCardData, 'huntNode'>;

export default function FlowNodeCard({ id, data, selected }: NodeProps<FlowCanvasNode>) {
  const descriptor = nodeDescriptor(data.node.type);
  const finish = data.node.type === 'complete';
  const updateNodeInternals = useUpdateNodeInternals();
  const portSignature = data.ports.map(({ port }) => outputPortId(port)).join('|');
  useEffect(() => { updateNodeInternals(id); }, [id, portSignature, updateNodeInternals]);
  return <div className={`min-w-[13rem] rounded-xl border-2 bg-white shadow-sm transition ${selected ? 'border-teal-700 ring-4 ring-teal-700/10' : finish ? 'border-teal-300' : data.warningCount ? 'border-amber-300' : 'border-slate-200'}`}>
    <Handle type="target" id="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-slate-500" aria-label={`Connect into ${descriptor.shortLabel}`} />
    <div className={`rounded-t-[0.6rem] px-3 py-2 ${finish ? 'bg-teal-50' : data.warningCount ? 'bg-amber-50' : 'bg-slate-50'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{descriptor.shortLabel}</span>
        {data.warningCount > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900" aria-label={`${data.warningCount} connection warnings`}>⚠ {data.warningCount}</span>}
      </div>
      <p className="mt-1 max-w-[12rem] truncate text-sm font-bold text-slate-900">{data.summary || descriptor.label}</p>
      <p className="mt-0.5 max-w-[12rem] truncate font-mono text-[10px] text-slate-500">{data.node.id}</p>
    </div>
    {data.ports.length > 0 && <div className="space-y-1 px-3 py-2">
      {data.ports.map(({ port, label, connected, invalid }) => <div key={outputPortId(port)} className={`relative flex min-h-6 items-center justify-between gap-3 text-[11px] ${invalid ? 'font-semibold text-amber-800' : 'text-slate-600'}`}>
        <span className="max-w-[10rem] truncate">{port.kind === 'fallback' ? '◇ ' : ''}{label}</span>
        <span aria-hidden="true" className={connected ? 'text-teal-700' : 'text-amber-600'}>{connected ? '●' : '○'}</span>
        <Handle type="source" id={outputPortId(port)} position={Position.Right} className={`!right-[-1.05rem] !h-3 !w-3 !border-2 !border-white ${port.kind === 'fallback' ? '!rounded-sm !bg-amber-500' : invalid ? '!bg-amber-500' : '!bg-teal-700'}`} aria-label={`${label} connection`} />
      </div>)}
    </div>}
  </div>;
}
