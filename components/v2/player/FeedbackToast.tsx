'use client';

import './feedback.css';

export interface FeedbackCue {
  id: string;
  kind: 'success' | 'error' | 'info';
  title: string;
  message?: string;
  points?: number;
}

export interface FeedbackToastProps {
  cue: FeedbackCue | null;
  onDismiss: () => void;
}

/** Keep this live region mounted; nearby inline feedback should not announce again. */
export function FeedbackToast({ cue, onDismiss }: FeedbackToastProps) {
  const points = cue?.points;
  const showPoints = points !== undefined && Number.isFinite(points) && points !== 0;
  return <div className="hunt-feedback-anchor" role={cue?.kind === 'error' ? 'alert' : 'status'} aria-live={cue?.kind === 'error' ? 'assertive' : 'polite'} aria-atomic="true">
    {cue && <div key={cue.id} data-testid="feedback-toast" className={`hunt-feedback-toast hunt-feedback-toast--${cue.kind}`}>
      <span className="hunt-feedback-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" focusable="false">
        {cue.kind === 'success' ? <path d="m5 12 4 4L19 6" /> : cue.kind === 'error' ? <><path d="M12 5v9" /><circle cx="12" cy="19" r="0.6" fill="currentColor" /></> : <><circle cx="12" cy="6" r="0.6" fill="currentColor" /><path d="M12 11v8" /></>}
      </svg></span>
      <div className="hunt-feedback-content"><p className="hunt-feedback-title">{cue.title}</p>{cue.message && <p className="hunt-feedback-message">{cue.message}</p>}
        {showPoints && <span data-testid="score-change" className={`hunt-feedback-points${points! < 0 ? ' hunt-feedback-points--deduction' : ''}`}>{points! > 0 ? '+' : ''}{points!.toLocaleString()} points</span>}
      </div>
      <button type="button" className="hunt-feedback-dismiss" aria-label="Dismiss feedback" onClick={onDismiss}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" focusable="false"><path d="m6 6 12 12M6 18 18 6" /></svg></button>
    </div>}
  </div>;
}

export default FeedbackToast;
