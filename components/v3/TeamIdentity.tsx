import type { TeamSessionSummary, V3PlayerView } from './types';

export default function TeamIdentity({ summary, view, onLeave, busy }: {
  summary: TeamSessionSummary;
  view: V3PlayerView | null;
  onLeave: () => void;
  busy: boolean;
}) {
  const checkedIn = summary.members.filter(member => member.checkedIn).length;
  return <header className="mb-6 pt-5 sm:pt-8">
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-800">{summary.hunt.title}</p>
        <h1 className="mt-2 truncate text-2xl font-black tracking-tight text-stone-950">{summary.team.label}</h1>
        <p className="mt-1 text-sm text-stone-600">Playing as <strong>{summary.member.name}</strong>{view ? ` · Run ${view.runNumber}${view.practice ? ' · Practice' : ''}` : ''}</p>
      </div>
      <button type="button" onClick={onLeave} disabled={busy} className="min-h-11 shrink-0 px-2 text-sm font-bold text-stone-500 underline decoration-stone-300 underline-offset-4 disabled:opacity-50">Leave</button>
    </div>
    <div className="mt-4 rounded-2xl border border-stone-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-wide text-stone-500">
        <span>Crew roster</span><span>{checkedIn}/{summary.members.length} checked in</span>
      </div>
      <p className="mt-2 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-stone-800">{summary.members.map(member => member.name).join(', ')}</p>
    </div>
  </header>;
}
