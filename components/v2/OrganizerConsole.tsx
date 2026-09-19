'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PuzzleDefinition } from '@/lib/engine/puzzles/types';
import { actionClass, buttonClass, Field, inputClass } from './builder/Fields';
import { adminRequest, AdminRequestError, type Dashboard } from './builder/organizer/client';
import DraftWorkspace from './builder/organizer/DraftWorkspace';
import TeamOperations from './builder/organizer/TeamOperations';
import { AnalyticsPanel, EventList } from './builder/organizer/EventPanels';
import MediaLibrary from './builder/organizer/MediaLibrary';

type Tab = 'design' | 'events' | 'live' | 'insights' | 'media';
const tabs: { id: Tab; label: string }[] = [{ id: 'design', label: 'Design' }, { id: 'events', label: 'Events' }, { id: 'live', label: 'Live control' }, { id: 'insights', label: 'Insights' }, { id: 'media', label: 'Media' }];

export default function OrganizerConsole() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [password, setPassword] = useState('');
  const [tab, setTab] = useState<Tab>('events');
  const [pending, setPending] = useState('');
  const [problem, setProblem] = useState<AdminRequestError | null>(null);
  const [notice, setNotice] = useState('');
  const [importedPuzzle, setImportedPuzzle] = useState<PuzzleDefinition | null>(null);
  const refreshSequence = useRef(0);
  const busy = useRef(false);

  const reportError = useCallback((error: unknown) => {
    const failure = error instanceof AdminRequestError ? error : new AdminRequestError('The action could not be completed. Please try again.', 0);
    setProblem(failure);
    if (failure.status === 401) { setAuthenticated(false); setDashboard(null); }
  }, []);

  const refresh = useCallback(async (initial = false) => {
    const sequence = ++refreshSequence.current;
    try {
      const data = await adminRequest<Dashboard>('/api/v2/admin');
      if (sequence !== refreshSequence.current) return;
      setDashboard({ ...data, drafts: data.drafts || [], help: data.help || [], photos: data.photos || [] });
      setAuthenticated(true);
    } catch (error) {
      if (sequence !== refreshSequence.current) return;
      if (initial && error instanceof AdminRequestError && error.status === 401) setAuthenticated(false);
      else { reportError(error); if (initial) setAuthenticated(false); }
    }
  }, [reportError]);

  useEffect(() => { void refresh(true); }, [refresh]);
  useEffect(() => {
    if (!authenticated) return;
    const update = () => { if (!busy.current && document.visibilityState === 'visible') void refresh(); };
    const interval = window.setInterval(update, 15000);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(interval); window.removeEventListener('focus', update); };
  }, [authenticated, refresh]);

  const run = useCallback(async (key: string, operation: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true; setPending(key); setProblem(null); setNotice('');
    try { await operation(); } catch (error) { reportError(error); }
    finally { busy.current = false; setPending(''); }
  }, [reportError]);

  const openRequests = (dashboard?.help.filter(help => help.status === 'open').length || 0) + (dashboard?.photos.length || 0);
  const operations = dashboard ? { dashboard, pending, run, refresh, notify: setNotice } : null;

  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8"><div className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><Link href="/v2" className="text-sm font-semibold text-teal-800 hover:underline">← Player home</Link><p className="mt-6 text-xs font-bold uppercase tracking-widest text-teal-800">Treasure Hunt V2</p><h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Organizer console</h1><p className="mt-3 text-slate-600">Build an adventure. Follow your teams. Keep the event moving.</p></div>
      {authenticated && <div className="flex gap-2"><button type="button" className={buttonClass} disabled={Boolean(pending)} onClick={() => void run('refresh', () => refresh())}>{pending === 'refresh' ? 'Refreshing…' : 'Refresh'}</button><button type="button" className={buttonClass} disabled={Boolean(pending)} onClick={() => void run('logout', async () => { await adminRequest('/api/v2/admin/session', 'DELETE', {}); refreshSequence.current += 1; setDashboard(null); setAuthenticated(false); setImportedPuzzle(null); })}>Sign out</button></div>}
    </header>
    {problem && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900"><p>{problem.message}</p>{problem.issues.length > 0 && <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{problem.issues.map((issue, index) => <li key={index}><strong>{issue.path}</strong>: {issue.message}</li>)}</ul>}{problem.status === 409 && <p className="mt-2 text-sm">Refresh to see the latest team progress or saved draft. Your local draft recovery is preserved.</p>}</div>}
    {notice && <p role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-teal-950">{notice}</p>}
    {authenticated === null && <p role="status" className="py-12 text-slate-600">Checking your organizer session…</p>}
    {authenticated === false && <section className="max-w-md rounded-2xl border border-slate-200 bg-white p-6 sm:p-8"><h2 className="text-xl font-bold">Organizer sign in</h2><p className="mt-2 text-sm leading-6 text-slate-600">Enter the organizer password configured for this server.</p><form className="mt-6 space-y-4" onSubmit={event => { event.preventDefault(); void run('login', async () => { await adminRequest('/api/v2/admin/session', 'POST', { password }); setPassword(''); await refresh(); }); }}><Field label="Password"><input className={inputClass} type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></Field><button className={actionClass + ' w-full'} disabled={Boolean(pending)}>{pending === 'login' ? 'Signing in…' : 'Sign in'}</button></form></section>}
    {authenticated && operations && <>
      <nav aria-label="Organizer sections" className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2">{tabs.map(item => <button type="button" key={item.id} disabled={Boolean(pending)} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)} className={tab === item.id ? actionClass : buttonClass}>{item.label}{item.id === 'live' && openRequests > 0 ? ' (' + openRequests + ')' : ''}</button>)}</nav>
      {tab === 'design' && <DraftWorkspace {...operations} importedPuzzle={importedPuzzle} onPuzzleImported={() => setImportedPuzzle(null)} />}
      {tab === 'events' && <EventList {...operations} />}
      {tab === 'live' && <TeamOperations {...operations} />}
      {tab === 'insights' && <AnalyticsPanel dashboard={operations.dashboard} active />}
      {tab === 'media' && <MediaLibrary active pending={pending} run={run} notify={setNotice} onCreatePuzzle={puzzle => { setImportedPuzzle(puzzle); setTab('design'); }} />}
    </>}
  </div></main>;
}
