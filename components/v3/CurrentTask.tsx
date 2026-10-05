'use client';

import CurrentTask, { type SendCommand } from '@/components/v2/CurrentTask';
import ActionFeedback, { type ActionNotice } from '@/components/v2/player/ActionFeedback';
import type { PlayerNode } from '@/lib/engine/types';
import V3PhotoVerification from './PhotoVerification';
import ParallelMechanic from './ParallelMechanic';
import type { PublicParallelMechanic, V3PlayerView } from './types';

export default function V3CurrentTask({ teamId, currentMemberId, runId, checkpointId, node, disabled, send, parallelMechanic, onView, notice, clearNotice }: {
  teamId: string;
  currentMemberId: string;
  runId: string;
  checkpointId: string;
  node: PlayerNode;
  disabled: boolean;
  send: SendCommand;
  parallelMechanic?: PublicParallelMechanic;
  onView: (view: V3PlayerView) => void;
  notice?: ActionNotice | null;
  clearNotice?: () => void;
}) {
  if (node.type === 'verify_organizer' && parallelMechanic) {
    return <div className="space-y-5">
      {node.clue && <p className="whitespace-pre-line text-lg leading-relaxed text-stone-700">{node.clue}</p>}
      <p className="whitespace-pre-line text-lg leading-relaxed text-stone-700">{node.prompt}</p>
      <ParallelMechanic teamId={teamId} currentMemberId={currentMemberId} runId={runId} mechanic={parallelMechanic} disabled={disabled} onView={onView} />
      <ActionFeedback notice={notice} />
    </div>;
  }
  if (node.type !== 'verify_image') {
    return <CurrentTask teamId={runId} checkpointId={checkpointId} node={node} disabled={disabled} send={send} notice={notice} clearNotice={clearNotice} />;
  }
  return <div className="space-y-5">
    {node.clue && <p className="whitespace-pre-line text-lg leading-relaxed text-stone-700">{node.clue}</p>}
    <p className="whitespace-pre-line text-lg leading-relaxed text-stone-700">{node.prompt}</p>
    <V3PhotoVerification teamId={teamId} runId={runId} checkpointId={checkpointId} node={node} disabled={disabled} send={send} />
    <ActionFeedback notice={notice} />
    {node.fallback?.enabled && <button type="button" disabled={disabled} className="min-h-12 w-full rounded-2xl border border-emerald-800 px-4 py-3 font-bold text-emerald-950 disabled:opacity-50" onClick={() => void send({ type: 'use_fallback', checkpointId, nodeId: node.id })}>{node.fallback.label || 'Try another way'}</button>}
  </div>;
}
