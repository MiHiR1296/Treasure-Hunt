'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { PlayerHint } from '@/lib/engine/types';
import type { SendCommand } from './CurrentTask';
import { primaryButton } from './CurrentTask';
import MediaContent from './player/MediaContent';
import ActionFeedback, { type ActionNotice } from './player/ActionFeedback';
const PuzzlePlayer = dynamic(() => import('./puzzles/PuzzlePlayer'));

export default function HintPanel({ teamId, checkpointId, hints, disabled, send, notice, clearNotice }: {
  teamId: string; checkpointId: string; hints: PlayerHint[]; disabled: boolean; send: SendCommand; notice?: ActionNotice & { hintId?: string }; clearNotice?: () => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (!hints.length) return null;
  return (
    <section aria-label="Hints" className="space-y-3 border-t border-stone-200 pt-5">
      {hints.map((hint) => <div key={hint.id}>
        {hint.status === 'used' && <div className="border-l-2 border-amber-400 pl-4">
          <div className="flex items-center justify-between gap-4"><h2 className="font-semibold">{hint.title}</h2><span className="shrink-0 text-xs font-semibold text-stone-500">Hint used</span></div>
          {hint.content && <div className="mt-3">{hint.content.type === 'puzzle' ? <div className="space-y-4">{hint.content.reveal ? <MediaContent content={hint.content.reveal} /> : <><p className="text-sm text-stone-600">Solve this to reveal the hint. Your team is charged only once.</p><PuzzlePlayer definition={hint.content.puzzle} state={hint.content.progress.state} feedback={notice?.hintId === hint.id ? notice : undefined} clearFeedback={clearNotice} draftKey={`${teamId}:${checkpointId}:${hint.id}:hint-puzzle:${hint.content.progress.revision}`} disabled={disabled} onChange={async value => {
          if (hint.content?.type !== 'puzzle') return;
          const result = await send({ type: 'submit_hint_puzzle', checkpointId, hintId: hint.id, expectedRevision: hint.content.progress.revision, value });
          if (!result) throw new Error('Puzzle move needs confirmation.');
        }} /></>}</div> : <MediaContent content={hint.content} />}</div>}
        </div>}
        {hint.status === 'locked' && <p className="text-sm text-stone-500">{hint.reason || 'This hint is not available yet.'}</p>}
        {notice?.hintId === hint.id && <div className="mt-3"><ActionFeedback notice={notice} testId="hint-feedback" /></div>}
        {hint.status === 'available' && (confirmId === hint.id ? <div className="space-y-3">
          <p className="text-sm leading-relaxed">{hint.cost > 0 ? `Reveal this hint for ${hint.cost} points? Your team is charged once.` : 'Reveal this free hint for your team?'}</p>
          <button type="button" disabled={disabled} className={primaryButton} onClick={async () => {
            const feedback = await send({ type: 'use_hint', checkpointId, hintId: hint.id });
            if (feedback) setConfirmId(null);
          }}>Reveal hint{hint.cost > 0 ? ` · ${hint.cost} points` : ''}</button>
          <button type="button" disabled={disabled} onClick={() => setConfirmId(null)} className="hunt-action min-h-12 w-full rounded-lg px-4 py-2 font-semibold text-stone-700">Keep looking</button>
        </div> : <button type="button" aria-label="View hint options" disabled={disabled} onClick={() => setConfirmId(hint.id)} className="hunt-action inline-flex min-h-11 items-center gap-2 px-1 text-sm font-semibold text-emerald-900 disabled:opacity-50"><span aria-hidden="true">?</span><span>Need a hint?</span><span className="font-normal text-stone-500">{hint.cost === 0 ? 'Free' : `−${hint.cost} pts`}</span></button>)}
      </div>)}
    </section>
  );
}
