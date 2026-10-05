import type { ReactNode } from 'react';

export const primaryButton = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-amber-300 px-4 py-2.5 text-sm font-black text-slate-950 shadow-sm transition hover:bg-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-50';
export const secondaryButton = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-bold text-slate-100 transition hover:border-white/25 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-50';
export const dangerButton = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-2.5 text-sm font-bold text-rose-100 transition hover:bg-rose-400/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300 disabled:cursor-not-allowed disabled:opacity-50';
export const inputClass = 'min-h-11 w-full rounded-xl border border-white/15 bg-slate-950/70 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/20 disabled:opacity-60';
export const panelClass = 'rounded-2xl border border-white/10 bg-slate-900/80 shadow-[0_24px_70px_rgba(2,6,23,0.28)] backdrop-blur';

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.025] px-5 py-10 text-center">
    <p className="font-bold text-slate-200">{title}</p>
    <div className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-400">{children}</div>
  </div>;
}

export function SectionHeading({ eyebrow, title, detail, actions }: { eyebrow?: string; title: string; detail?: string; actions?: ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-4">
    <div>
      {eyebrow && <p className="text-[0.68rem] font-black uppercase tracking-[0.24em] text-cyan-300">{eyebrow}</p>}
      <h2 className="mt-1 text-xl font-black tracking-tight text-white sm:text-2xl">{title}</h2>
      {detail && <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{detail}</p>}
    </div>
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </div>;
}

export function StatusPill({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warning' | 'danger' | 'info'; children: ReactNode }) {
  const tones = {
    neutral: 'border-white/10 bg-white/5 text-slate-300',
    good: 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200',
    warning: 'border-amber-300/20 bg-amber-300/10 text-amber-200',
    danger: 'border-rose-300/20 bg-rose-300/10 text-rose-200',
    info: 'border-cyan-300/20 bg-cyan-300/10 text-cyan-200',
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${tones[tone]}`}>{children}</span>;
}

export function formatDuration(milliseconds: number | null | undefined) {
  if (!Number.isFinite(milliseconds)) return '—';
  const seconds = Math.max(0, Math.round(Number(milliseconds) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function formatPercent(value: number | null | undefined) {
  if (!Number.isFinite(value)) return '—';
  const normalized = Number(value) <= 1 ? Number(value) * 100 : Number(value);
  return `${Math.round(normalized)}%`;
}

export function labelize(value: string) {
  return value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}
