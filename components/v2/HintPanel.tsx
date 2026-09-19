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
    <section aria-labelledby="hints-heading" className="space-y-3">
      <div>
        <h2 id="hints-heading" className="text-lg font-bold">Need a clue?</h2>
        <p className="mt-1 text-sm text-stone-600">Choose any available hint. Your whole team shares it.</p>
      </div>
      {hints.map((hint) => <div key={hint.id} className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex items-start justify-between gap-4">
          <div><h3 className="font-semibold">{hint.title}</h3><p className="mt-1 text-xs capitalize text-stone-500">{hint.type} hint</p></div>
          <span className="shrink-0 text-sm font-semibold text-stone-600">{hint.status === 'used' ? 'Revealed' : hint.cost === 0 ? 'Free' : `−${hint.cost} points`}</span>
        </div>
        {hint.status === 'used' && hint.content && <div className="mt-4">{hint.content.type === 'puzzle' ? <div className="space-y-4">{hint.content.reveal ? <MediaContent content={hint.content.reveal} /> : <><p className="text-sm text-stone-600">Solve this puzzle to reveal your hint. Your team is charged only once.</p><PuzzlePlayer definition={hint.content.puzzle} state={hint.content.progress.state} feedback={notice?.hintId === hint.id ? notice : undefined} clearFeedback={clearNotice} draftKey={`${teamId}:${checkpointId}:${hint.id}:hint-puzzle:${hint.content.progress.revision}`} disabled={disabled} onChange={async value => {
          if (hint.content?.type !== 'puzzle') return;
          const result = await send({ type: 'submit_hint_puzzle', checkpointId, hintId: hint.id, expectedRevision: hint.content.progress.revision, value });
          if (!result) throw new Error('Puzzle move needs confirmation.');
        }} /></>}</div> : <MediaContent content={hint.content} />}</div>}
        {hint.status === 'locked' && <p className="mt-3 text-sm text-stone-600">{hint.reason || 'This hint is not available yet.'}</p>}
        {notice?.hintId === hint.id && <div className="mt-3"><ActionFeedback notice={notice} testId="hint-feedback" /></div>}
        {hint.status === 'available' && (confirmId === hint.id ? <div className="mt-4 space-y-3 rounded-xl bg-amber-50 p-3">
          <p className="text-sm leading-relaxed">{hint.cost > 0 ? `Reveal this hint for ${hint.cost} points? Your team is charged once.` : 'Reveal this free hint for your team?'}</p>
          <button type="button" disabled={disabled} className={primaryButton} onClick={async () => {
            const feedback = await send({ type: 'use_hint', checkpointId, hintId: hint.id });
            if (feedback) setConfirmId(null);
          }}>Reveal hint{hint.cost > 0 ? ` · ${hint.cost} points` : ''}</button>
          <button type="button" disabled={disabled} onClick={() => setConfirmId(null)} className="hunt-action min-h-12 w-full rounded-lg px-4 py-2 font-semibold text-stone-700">Keep looking</button>
        </div> : <button type="button" disabled={disabled} onClick={() => setConfirmId(hint.id)} className="hunt-action mt-3 min-h-12 w-full rounded-xl border border-emerald-800 px-4 py-2 font-semibold text-emerald-800 disabled:opacity-50">View hint options</button>)}
      </div>)}
    </section>
  );
}
