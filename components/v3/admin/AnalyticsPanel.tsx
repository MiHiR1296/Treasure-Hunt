'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminRequest, normalizeAnalyticsResponse, V3AdminRequestError } from './client';
import type { AdminHunt, AnalyticsBreakdownRow, AnalyticsResponse } from './types';
import { EmptyState, formatDuration, formatPercent, labelize, panelClass, secondaryButton, SectionHeading, StatusPill } from './ui';

function BreakdownTable({ rows, kind }: { rows: AnalyticsBreakdownRow[]; kind: 'checkpoint' | 'variant' | 'tie' | 'contribution' }) {
  if (!rows.length) return <EmptyState title="No data yet">This section will fill as eligible runs produce server-confirmed events.</EmptyState>;
  return <div className="overflow-x-auto rounded-xl border border-white/10">
    <table className="w-full min-w-[760px] text-left text-sm">
      <thead className="bg-white/[0.04] text-[0.67rem] uppercase tracking-widest text-slate-400"><tr>
        <th className="px-3 py-3">{kind === 'checkpoint' ? 'Checkpoint / puzzle' : kind === 'variant' ? 'Route / variant' : kind === 'tie' ? 'Tie group' : 'Contribution'}</th>
        {kind !== 'tie' && <><th className="px-3 py-3">Attempts</th><th className="px-3 py-3">Completed</th><th className="px-3 py-3">Failures</th></>}
        {kind === 'checkpoint' && <><th className="px-3 py-3">Hints</th><th className="px-3 py-3">Abandoned</th><th className="px-3 py-3">Median</th></>}
        {kind === 'variant' && <><th className="px-3 py-3">Avg score</th><th className="px-3 py-3">Avg time</th><th className="px-3 py-3">Fairness</th></>}
        {kind === 'tie' && <><th className="px-3 py-3">Teams</th><th className="px-3 py-3">Difference</th><th className="px-3 py-3">Status</th></>}
        {kind === 'contribution' && <><th className="px-3 py-3">Credits</th><th className="px-3 py-3">Share</th><th className="px-3 py-3">Detail</th></>}
      </tr></thead>
      <tbody className="divide-y divide-white/10">{rows.map((row, index) => <tr key={row.id || `${row.label}-${index}`} className="hover:bg-white/[0.02]">
        <td className="px-3 py-3 font-bold text-white">{row.label}{row.detail && <span className="mt-1 block max-w-sm text-xs font-normal text-slate-500">{row.detail}</span>}</td>
        {kind !== 'tie' && <><td className="px-3 py-3 text-slate-300">{row.attempts ?? '—'}</td><td className="px-3 py-3 text-slate-300">{row.completions ?? '—'}</td><td className="px-3 py-3 text-slate-300">{row.failures ?? '—'}</td></>}
        {kind === 'checkpoint' && <><td className="px-3 py-3 text-slate-300">{row.hints ?? '—'}</td><td className="px-3 py-3 text-slate-300">{row.abandonments ?? '—'}</td><td className="px-3 py-3 text-slate-300">{formatDuration(row.medianMilliseconds)}</td></>}
        {kind === 'variant' && <><td className="px-3 py-3 text-slate-300">{row.score ?? '—'}</td><td className="px-3 py-3 text-slate-300">{formatDuration(row.durationMilliseconds)}</td><td className="px-3 py-3"><StatusPill tone={row.status === 'warning' || (row.delta || 0) > 0 ? 'warning' : 'good'}>{row.status ? labelize(row.status) : row.delta == null ? 'No signal' : `Δ ${row.delta}`}</StatusPill></td></>}
        {kind === 'tie' && <><td className="px-3 py-3 text-slate-300">{row.value ?? row.attempts ?? '—'}</td><td className="px-3 py-3 text-slate-300">{row.delta ?? '—'}</td><td className="px-3 py-3"><StatusPill tone={row.status === 'resolved' ? 'good' : 'warning'}>{labelize(row.status || 'review')}</StatusPill></td></>}
        {kind === 'contribution' && <><td className="px-3 py-3 text-slate-300">{row.value ?? '—'}</td><td className="px-3 py-3 text-slate-300">{row.delta == null ? '—' : formatPercent(row.delta)}</td><td className="px-3 py-3 text-slate-400">{row.status ? labelize(row.status) : '—'}</td></>}
      </tr>)}</tbody>
    </table>
  </div>;
}

function Funnel({ analytics }: { analytics: AnalyticsResponse }) {
  const maximum = Math.max(1, ...analytics.funnel.map(step => step.value));
  if (!analytics.funnel.length) return <EmptyState title="No run funnel yet">Starts, completions, and replays will appear once teams begin.</EmptyState>;
  return <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{analytics.funnel.map((step, index) => {
    const computedRate = step.rate ?? (index === 0 ? 1 : step.value / maximum);
    return <li key={`${step.label}-${index}`} className="rounded-xl border border-white/10 bg-white/[0.025] p-4">
      <div className="flex items-baseline justify-between gap-3"><p className="text-sm font-bold text-slate-300">{step.label}</p><p className="text-2xl font-black text-white">{step.value}</p></div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-amber-300" style={{ width: `${Math.max(2, Math.min(100, computedRate <= 1 ? computedRate * 100 : computedRate))}%` }} /></div>
      <p className="mt-2 text-xs text-slate-500">{formatPercent(computedRate)} of funnel entry</p>
    </li>;
  })}</ol>;
}

export default function AnalyticsPanel({ hunt, active, reportError }: { hunt: AdminHunt; active: boolean; reportError: (error: unknown) => void }) {
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [localProblem, setLocalProblem] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setLocalProblem('');
    try {
      const response = await adminRequest<unknown>(`/api/v3/admin/analytics?huntId=${encodeURIComponent(hunt.id)}`);
      setAnalytics(normalizeAnalyticsResponse(response));
    } catch (error) {
      const message = error instanceof V3AdminRequestError ? error.message : 'Analytics could not be loaded.';
      setLocalProblem(message);
      reportError(error);
    } finally { setLoading(false); }
  }, [hunt.id, reportError]);

  useEffect(() => { if (active) void refresh(); }, [active, refresh]);

  const registration = useMemo(() => analytics?.registration || [], [analytics?.registration]);
  const aggregateExport = `/api/v3/admin/export?huntId=${encodeURIComponent(hunt.id)}&kind=aggregate&format=csv`;
  const privateExport = `/api/v3/admin/export?huntId=${encodeURIComponent(hunt.id)}&kind=private&format=json`;

  return <div className="space-y-5">
    <section className={`${panelClass} p-5 sm:p-6`}>
      <SectionHeading eyebrow="Run-aware reporting" title="Event analytics" detail="Every number is derived from server-confirmed runs and actions. Self-serve and organizer-assigned people counts are labelled as declared members; rostered events use rostered/check-in members." actions={<>
        <a className={secondaryButton} href={aggregateExport} download>Aggregate CSV</a>
        <a className={secondaryButton} href={privateExport} download>Private JSON</a>
        <button type="button" className={secondaryButton} disabled={loading} onClick={() => void refresh()}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </>} />
      {localProblem && <p role="alert" className="mt-4 rounded-xl border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">{localProblem}</p>}
      {loading && !analytics && <p role="status" className="py-12 text-center text-slate-400">Calculating run-aware analytics…</p>}
      {analytics && <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{analytics.summary.map((metric, index) => <div key={`${metric.label}-${index}`} className="rounded-xl border border-white/10 bg-white/[0.035] p-3"><p className="text-[0.65rem] font-black uppercase tracking-widest text-slate-500">{metric.label}</p><p className="mt-1 text-2xl font-black text-white">{metric.value}</p>{metric.detail && <p className="mt-1 text-xs text-slate-500">{metric.detail}</p>}</div>)}</div>}
      {analytics?.generatedAt && <p className="mt-3 text-xs text-slate-500">Snapshot calculated {new Date(analytics.generatedAt).toLocaleString()}</p>}
    </section>

    {analytics && <>
      <section className={`${panelClass} p-5 sm:p-6`}><SectionHeading title="Run funnel" detail="See where teams move from registration to first completion and replay." /><div className="mt-5"><Funnel analytics={analytics} /></div></section>

      <section className={`${panelClass} p-5 sm:p-6`}>
        <SectionHeading title="First run → best run" detail="Improvement is based on each repeat team’s first eligible completion and current best eligible completion." />
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4"><p className="text-xs font-black uppercase tracking-widest text-slate-500">Repeat teams</p><p className="mt-2 text-3xl font-black text-white">{analytics.improvement.teamsWithReplays}</p></div>
          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4"><p className="text-xs font-black uppercase tracking-widest text-slate-500">Avg score gain</p><p className="mt-2 text-3xl font-black text-emerald-300">+{analytics.improvement.averageScoreImprovement}</p></div>
          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-4"><p className="text-xs font-black uppercase tracking-widest text-slate-500">Avg time saved</p><p className="mt-2 text-3xl font-black text-cyan-300">{formatDuration(analytics.improvement.averageTimeImprovementMilliseconds)}</p></div>
        </div>
      </section>

      <section className={`${panelClass} p-5 sm:p-6`}><SectionHeading title="Checkpoint and puzzle health" detail="Completions, failures, hint demand, median solve time, and abandonment help identify confusing content." /><div className="mt-5"><BreakdownTable rows={analytics.checkpoints} kind="checkpoint" /></div></section>
      <section className={`${panelClass} p-5 sm:p-6`}><SectionHeading title="Route and variant fairness" detail="Compare score and time performance. A warning is an operational signal, not automatic proof that a route is unfair." /><div className="mt-5"><BreakdownTable rows={analytics.variants} kind="variant" /></div></section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className={`${panelClass} p-5 sm:p-6`}><SectionHeading title="Contribution distribution" detail="Positive, server-verified credits by category." /><div className="mt-5"><BreakdownTable rows={analytics.contributions} kind="contribution" /></div></section>
        <section className={`${panelClass} p-5 sm:p-6`}>
          <SectionHeading title="Recognition participation" detail="Peer voting is optional and private within each team." />
          <div className="mt-5 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/10 p-3"><p className="text-xs text-slate-500">Eligible</p><p className="mt-1 text-2xl font-black text-white">{analytics.recognition.eligibleMembers ?? '—'}</p></div>
            <div className="rounded-xl border border-white/10 p-3"><p className="text-xs text-slate-500">Voted</p><p className="mt-1 text-2xl font-black text-white">{analytics.recognition.voters ?? '—'}</p></div>
            <div className="rounded-xl border border-white/10 p-3"><p className="text-xs text-slate-500">Rate</p><p className="mt-1 text-2xl font-black text-white">{formatPercent(analytics.recognition.participationRate)}</p></div>
          </div>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className={`${panelClass} p-5 sm:p-6`}><SectionHeading title="Leaderboard tie analysis" detail="Best score ranks first; elapsed time and then earlier completion resolve remaining ties." /><div className="mt-5"><BreakdownTable rows={analytics.ties} kind="tie" /></div></section>
        <section className={`${panelClass} p-5 sm:p-6`}><SectionHeading title="Registration and check-in" detail="Understand the gap between teams registered, members declared or rostered, and people checked in." /><div className="mt-5 grid grid-cols-2 gap-3">{registration.map((metric, index) => <div key={`${metric.label}-${index}`} className="rounded-xl border border-white/10 bg-white/[0.025] p-4"><p className="text-xs font-black uppercase tracking-widest text-slate-500">{metric.label}</p><p className="mt-2 text-2xl font-black text-white">{metric.value}</p>{metric.detail && <p className="mt-1 text-xs text-slate-500">{metric.detail}</p>}</div>)}</div>{!registration.length && <div className="mt-5"><EmptyState title="No registration data">Registration conversion appears after teams or roster claims are recorded.</EmptyState></div>}</section>
      </div>
    </>}
  </div>;
}
