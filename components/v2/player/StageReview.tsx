'use client';

import type { PlayerStageReview } from '@/lib/engine/types';

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
  </section>;
}
