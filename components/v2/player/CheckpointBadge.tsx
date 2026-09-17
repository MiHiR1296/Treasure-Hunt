import type { HuntTheme, PlayerCheckpoint } from '@/lib/engine/types';

/** Decorative: checkpoint names and status remain visible text beside the badge. */
export default function CheckpointBadge({ style, index, status }: { style?: HuntTheme['checkpointIconStyle']; index: number; status: PlayerCheckpoint['status'] }) {
  if (!style || style === 'none') return null;
  return <span aria-hidden="true" data-checkpoint-icon={style} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--hunt-primary,#065f46)] text-sm font-bold text-[var(--hunt-on-primary,#ffffff)]">
    {style === 'numbers' ? index + 1 : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" focusable="false">
      {status === 'completed' ? <path d="m5 12 4 4L19 6" /> : status === 'skipped' ? <><path d="M5 12h14m-5-5 5 5-5 5" /></> : status === 'locked' ? <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></> : <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>}
    </svg>}
  </span>;
}
