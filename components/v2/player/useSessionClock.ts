'use client';
import { useEffect, useState } from 'react';
import type { PlayerView } from '@/lib/engine/types';

/** Display only. Re-anchor every server response; wall-clock changes cannot add time. */
export function useSessionClock(view: PlayerView | null) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const seconds = view?.timer?.remainingSeconds, paused = view?.timer?.paused;
  useEffect(() => {
    if (seconds === undefined) { setRemaining(null); return; }
    const received = performance.now();
    const update = () => setRemaining(Math.max(0, Math.ceil(seconds - (paused ? 0 : (performance.now() - received) / 1000))));
    update(); const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [seconds, paused, view?.serverNow, view?.teamId]);
  return remaining;
}
