'use client';

import type { PlayerStageReview } from '@/lib/engine/types';
import MediaContent from './MediaContent';

export default function StageReview({ stage, returnLabel, onReturn }: { stage: PlayerStageReview; returnLabel: string; onReturn: () => void }) {
  return <section aria-labelledby="review-stage-title" className="hunt-task-arrive py-1">
    <button type="button" onClick={onReturn} className="hunt-action -ml-2 mb-4 min-h-11 px-2 text-sm font-semibold text-emerald-900 underline">← {returnLabel}</button>
    <h2 id="review-stage-title" className="text-3xl font-bold leading-tight tracking-tight">{stage.title}</h2>
    <ol className="mt-4 divide-y divide-stone-200 border-y border-stone-200">
      {stage.steps.map(step => <li key={step.id} className="py-5">
        <p className="whitespace-pre-line text-lg leading-relaxed text-stone-700">{step.text}</p>
        {step.response && <p className="mt-3 text-sm text-stone-600"><span className="font-semibold text-stone-900">Your result:</span> {step.response}</p>}
      </li>)}
    </ol>
    {!!stage.hints?.length && <div className="mt-5 space-y-4"><h3 className="font-bold">Your purchased hints</h3>{stage.hints.map(hint => <details key={hint.id} className="rounded-xl border border-stone-300 bg-white p-4"><summary className="cursor-pointer py-2 font-semibold">{hint.title} · {hint.cost} points paid</summary>{hint.content && (hint.content.type === 'puzzle' ? hint.content.reveal ? <MediaContent content={hint.content.reveal} /> : <p className="mt-3 text-sm">This hint puzzle was not solved. Its reward stays hidden; an organizer can help you revisit the checkpoint.</p> : <MediaContent content={hint.content} />)}</details>)}</div>}
  </section>;
}
