'use client';

import { useEffect, useRef, type ReactNode } from 'react';

export interface ActionNotice {
  id: string;
  kind: 'success' | 'error' | 'info';
  message: string;
}

/** The floating cue announces changes; this detail stays beside the action. */
export default function ActionFeedback({ notice, children, testId = 'task-feedback' }: { notice?: ActionNotice | null; children?: ReactNode; testId?: string }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice?.kind !== 'error' || !element.current) return;
    const bounds = element.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop || 0;
    const bottom = top + (viewport?.height || window.innerHeight);
    if (bounds.top < top + 12 || bounds.bottom > bottom - 12) element.current.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [notice?.id, notice?.kind]);
  if (!notice) return null;
  return <div ref={element} id={notice.id} data-testid={testId} className={`scroll-mb-4 rounded-xl border px-4 py-3 text-sm leading-relaxed ${notice.kind === 'error' ? 'border-amber-300 bg-amber-50 text-amber-950' : notice.kind === 'success' ? 'hunt-success-notice border-emerald-200 bg-emerald-50 text-emerald-950' : 'border-stone-200 bg-stone-50 text-stone-700'}`}>
    <p>{notice.message}</p>{children}
  </div>;
}
