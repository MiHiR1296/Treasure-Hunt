'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AnalyticsPanel from './AnalyticsPanel';
import AuthoringPanel from './AuthoringPanel';
import { adminRequest, normalizeLiveResponse, V3AdminRequestError } from './client';
import LiveOperations, { explainLiveError } from './LiveOperations';
import type { AdminHunt, LiveOperationsResponse } from './types';
import { inputClass, panelClass, primaryButton, secondaryButton, StatusPill } from './ui';

type Tab = 'live' | 'analytics' | 'authoring';
const tabs: Array<{ id: Tab; label: string; description: string }> = [
  { id: 'live', label: 'Live control', description: 'Teams, alerts, rosters, and public board' },
  { id: 'analytics', label: 'Analytics', description: 'Runs, fairness, funnel, and recognition' },
  { id: 'authoring', label: 'Authoring', description: 'AI kit, JSON import, preview, and publish' },
];

export default function OrganizerConsole() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [hunts, setHunts] = useState<AdminHunt[]>([]);
  const [huntId, setHuntId] = useState('');
  const [tab, setTab] = useState<Tab>('live');
  const [live, setLive] = useState<LiveOperationsResponse | null>(null);
  const [loadingLive, setLoadingLive] = useState(false);
  const [liveProblem, setLiveProblem] = useState('');
  const [pending, setPending] = useState('');
  const [problem, setProblem] = useState<V3AdminRequestError | null>(null);
  const [notice, setNotice] = useState('');
  const polling = useRef(false);
  const liveSequence = useRef(0);

  const selectedHunt = useMemo(() => hunts.find(hunt => hunt.id === huntId) || null, [huntId, hunts]);

  const reportError = useCallback((error: unknown) => {
    const failure = error instanceof V3AdminRequestError
      ? error
      : new V3AdminRequestError('The action could not be completed. Please try again.', 0);
    setProblem(failure);
    if (failure.status === 401) {
      setAuthenticated(false);
      setLive(null);
    }
  }, []);

  const loadHunts = useCallback(async () => {
    const response = await adminRequest<{ hunts: AdminHunt[] }>('/api/v3/admin/live');
    const next = Array.isArray(response.hunts) ? response.hunts : [];
    setHunts(next);
    setHuntId(current => next.some(hunt => hunt.id === current) ? current : next[0]?.id || '');
  }, []);

  const checkSession = useCallback(async () => {
    try {
      await adminRequest('/api/v3/admin/drafts');
      setAuthenticated(true);
      await loadHunts();
    } catch (error) {
      if (error instanceof V3AdminRequestError && error.status === 401) setAuthenticated(false);
      else { setAuthenticated(false); reportError(error); }
    }
  }, [loadHunts, reportError]);

  useEffect(() => { void checkSession(); }, [checkSession]);

  const refreshLive = useCallback(async (quiet = false) => {
    if (!huntId || polling.current) return;
    polling.current = true;
    const sequence = ++liveSequence.current;
    if (!quiet) setLoadingLive(true);
    try {
      const response = await adminRequest<unknown>(`/api/v3/admin/live?huntId=${encodeURIComponent(huntId)}`);
      if (sequence !== liveSequence.current) return;
      const normalized = normalizeLiveResponse(response);
      setLive(normalized);
      if (normalized.hunt) {
        setHunts(current => current.map(hunt => hunt.id === normalized.hunt!.id ? { ...hunt, ...normalized.hunt } : hunt));
      }
      setLiveProblem('');
    } catch (error) {
      if (sequence !== liveSequence.current) return;
      setLiveProblem(explainLiveError(error));
      if (error instanceof V3AdminRequestError && error.status === 401) reportError(error);
    } finally {
      if (sequence === liveSequence.current) setLoadingLive(false);
      polling.current = false;
    }
  }, [huntId, reportError]);

  useEffect(() => {
    liveSequence.current += 1;
    setLive(null);
    setLiveProblem('');
    if (!authenticated || !huntId || tab !== 'live') return;
    void refreshLive();
    const poll = () => {
      if (document.visibilityState === 'visible') void refreshLive(true);
    };
    const interval = window.setInterval(poll, 5_000);
    const visibility = () => { if (document.visibilityState === 'visible') poll(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', poll);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', poll);
    };
  }, [authenticated, huntId, refreshLive, tab]);

  const run = useCallback(async (key: string, operation: () => Promise<void>) => {
    if (pending) return;
    setPending(key);
    setProblem(null);
    setNotice('');
    try {
      await operation();
      if (huntId) await refreshLive(true);
    } catch (error) { reportError(error); }
    finally { setPending(''); }
  }, [huntId, pending, refreshLive, reportError]);

  return <main className="min-h-screen bg-[#061018] bg-[radial-gradient(circle_at_top_right,rgba(8,145,178,0.14),transparent_34%),radial-gradient(circle_at_top_left,rgba(251,191,36,0.09),transparent_28%)] px-4 py-6 text-slate-100 sm:px-7 sm:py-8">
    <div className="mx-auto max-w-[100rem] space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div><Link href="/v3" className="text-sm font-bold text-cyan-300 hover:text-cyan-200 hover:underline">← Player home</Link><p className="mt-6 text-xs font-black uppercase tracking-[0.28em] text-amber-300">Treasure Hunt V3</p><h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-5xl">Event command centre</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">Know every team by code and crew. Keep the event moving. Turn clean live data into share-ready updates.</p></div>
        {authenticated && <div className="flex flex-wrap items-center gap-2"><StatusPill tone="good"><span className="mr-1.5 h-2 w-2 rounded-full bg-emerald-300" /> Organizer signed in</StatusPill><button type="button" className={secondaryButton} disabled={Boolean(pending)} onClick={() => void run('logout', async () => { await adminRequest('/api/v3/admin/session', 'DELETE', {}); liveSequence.current += 1; setAuthenticated(false); setLive(null); setHunts([]); setHuntId(''); })}>{pending === 'logout' ? 'Signing out…' : 'Sign out'}</button></div>}
      </header>

      {problem && <div role="alert" className="rounded-2xl border border-rose-300/20 bg-rose-300/10 p-4 text-rose-100"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black">{problem.message}</p>{problem.status === 409 && <p className="mt-1 text-sm text-rose-100/75">Reload the latest draft or event state before trying again.</p>}</div><button type="button" className="text-sm font-bold underline" onClick={() => setProblem(null)}>Dismiss</button></div>{problem.issues.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{problem.issues.map((issue, index) => <li key={`${issue.path}-${index}`}><code>{issue.path}</code>: {issue.message}</li>)}</ul>}</div>}
      {notice && <div role="status" className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-emerald-100"><div className="flex items-start justify-between gap-3"><p className="font-bold">{notice}</p><button type="button" className="text-sm font-bold underline" onClick={() => setNotice('')}>Dismiss</button></div></div>}

      {authenticated === null && <section className={`${panelClass} max-w-lg p-8`}><p role="status" className="text-slate-400">Checking your organizer session…</p></section>}

      {authenticated === false && <section className={`${panelClass} max-w-md p-6 sm:p-8`}>
        <p className="text-xs font-black uppercase tracking-widest text-cyan-300">Private operations</p><h2 className="mt-2 text-2xl font-black text-white">Organizer sign in</h2><p className="mt-2 text-sm leading-6 text-slate-400">Use the server’s organizer password. Team sessions cannot open this console.</p>
        <form className="mt-6 space-y-4" onSubmit={event => { event.preventDefault(); void run('login', async () => { await adminRequest('/api/v3/admin/session', 'POST', { password, name: 'Organizer' }); setPassword(''); setAuthenticated(true); await loadHunts(); }); }}>
          <label className="block text-sm font-bold text-slate-200">Organizer password<input className={`${inputClass} mt-2`} type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
          <button className={`${primaryButton} w-full`} disabled={Boolean(pending)}>{pending === 'login' ? 'Signing in…' : 'Open command centre'}</button>
        </form>
      </section>}

      {authenticated && <>
        <section className={`${panelClass} sticky top-2 z-30 p-3 sm:top-4 sm:p-4`}>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[15rem] flex-1 text-xs font-black uppercase tracking-widest text-slate-400">Event<select className={`${inputClass} mt-2 normal-case tracking-normal`} value={huntId} onChange={event => setHuntId(event.target.value)}><option value="">Choose an event</option>{hunts.map(hunt => <option key={hunt.id} value={hunt.id}>{hunt.title} · {hunt.status}</option>)}</select></label>
            <nav aria-label="Organizer sections" className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-white/10 p-1">{tabs.map(item => <button key={item.id} type="button" aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)} className={`${tab === item.id ? primaryButton : secondaryButton} shrink-0`} title={item.description}>{item.label}</button>)}</nav>
          </div>
        </section>

        {!selectedHunt && tab !== 'authoring' && <section className={`${panelClass} p-8 text-center`}><h2 className="text-xl font-black text-white">Choose an event</h2><p className="mt-2 text-sm text-slate-400">Live operations and analytics are scoped to one hunt so results never mix across events.</p></section>}
        {tab === 'live' && selectedHunt && <LiveOperations key={selectedHunt.id} hunt={selectedHunt} data={live} loading={loadingLive} pending={pending} problem={liveProblem} onRefresh={() => refreshLive()} run={run} notify={setNotice} reportError={reportError} />}
        {tab === 'analytics' && selectedHunt && <AnalyticsPanel key={selectedHunt.id} hunt={selectedHunt} active reportError={reportError} />}
        {tab === 'authoring' && <AuthoringPanel active notify={setNotice} reportError={reportError} />}
      </>}
    </div>
  </main>;
}
