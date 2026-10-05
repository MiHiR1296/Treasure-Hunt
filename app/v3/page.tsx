/* eslint-disable @next/next/no-img-element -- Hunt artwork uses access-controlled organizer URLs. */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Feedback, GameCommand } from '@/lib/engine/types';
import { themeTextColor } from '@/lib/utils/colorContrast';
import HintPanel from '@/components/v2/HintPanel';
import type { ActionNotice } from '@/components/v2/player/ActionFeedback';
import '@/components/v2/player/theme.css';
import { newRequestId, normalizeRunSummary, readPendingCommand, V3RequestError, v3Request, writePendingCommand } from '@/components/v3/api';
import FinishExperience from '@/components/v3/FinishExperience';
import CurrentTask from '@/components/v3/CurrentTask';
import Leaderboards, { useTeamLeaderboards } from '@/components/v3/Leaderboards';
import Registration from '@/components/v3/Registration';
import SupportPanel from '@/components/v3/SupportPanel';
import TeamIdentity from '@/components/v3/TeamIdentity';
import type { PendingRunCommand, RunCommandResponse, TeamSessionSummary, V3PlayerView } from '@/components/v3/types';
import { cardStyle, primaryButton, secondaryButton } from '@/components/v3/ui';

function normalizeSummary(summary: TeamSessionSummary): TeamSessionSummary {
  return {
    ...summary,
    activeRun: normalizeRunSummary(summary.activeRun),
    latestRun: normalizeRunSummary(summary.latestRun),
    bestRun: normalizeRunSummary(summary.bestRun),
  };
}

function RunProgress({ view }: { view: V3PlayerView }) {
  if (!view.checkpoints?.length) return null;
  return <ol aria-label="Run progress" className="mt-4 flex items-center gap-1">
    {view.checkpoints.map((checkpoint, index) => {
      const complete = checkpoint.status === 'completed' || checkpoint.status === 'skipped';
      const current = checkpoint.id === view.checkpoint?.id;
      return <li key={checkpoint.id} className="flex items-center" title={checkpoint.title}>
        <span className={`flex h-8 min-w-8 items-center justify-center rounded-full text-xs font-black ${current ? 'bg-emerald-950 text-white ring-4 ring-emerald-100' : complete ? 'bg-emerald-200 text-emerald-950' : 'bg-stone-200 text-stone-500'}`}><span className="sr-only">{checkpoint.title}: </span>{complete ? '✓' : index + 1}</span>
        {index < view.checkpoints!.length - 1 && <span aria-hidden="true" className={`h-1 w-3 sm:w-6 ${complete ? 'bg-emerald-200' : 'bg-stone-200'}`} />}
      </li>;
    })}
  </ol>;
}

function useTimer(view: V3PlayerView | null) {
  const [now, setNow] = useState(() => Date.now());
  const baseline = useRef<{ key: string; receivedAt: number; remaining: number } | null>(null);
  useEffect(() => {
    if (!view?.timer || view.timer.paused) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [view?.timer]);
  if (!view?.timer) return null;
  if (view.timer.paused) return Math.max(0, view.timer.remainingSeconds);
  const key = `${view.runId}:${view.revision}:${view.timer.deadlineAt}:${view.serverNow ?? ''}`;
  if (baseline.current?.key !== key) baseline.current = { key, receivedAt: Date.now(), remaining: view.timer.remainingSeconds };
  return Math.max(0, Math.ceil(baseline.current.remaining - (now - baseline.current.receivedAt) / 1000));
}

function RunLobby({ summary, busy, onStart }: { summary: TeamSessionSummary; busy: boolean; onStart: (practice: boolean) => Promise<void> }) {
  const policy = summary.settings.runPolicy;
  const firstRun = summary.officialAttemptCount === 0;
  const officialSlotAvailable = summary.remainingOfficialRuns === null || summary.remainingOfficialRuns > 0;
  const capped = policy.mode === 'capped' && !officialSlotAvailable;
  const approvalPending = summary.team.approvalStatus !== 'approved';
  const practice = !firstRun && (summary.hasPracticeRun || (policy.mode === 'practice-only' && summary.officialAttemptSlotsUsed > 0) || capped);
  const disabled = approvalPending || (!practice && policy.mode === 'disabled' && !officialSlotAvailable);
  return <section className={`${cardStyle} mt-2`}>
    <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-800">{approvalPending ? 'Registration received' : firstRun ? 'Crew ready' : 'Your run history is safe'}</p>
    <h2 className="mt-2 text-3xl font-black tracking-tight">{approvalPending ? 'Your team is waiting for approval.' : firstRun ? 'Start when everyone is ready.' : 'Ready for another route?'}</h2>
    <p className="mt-3 text-sm leading-relaxed text-stone-600">{approvalPending ? `Your crew is registered as ${summary.team.code}. The organizer must approve it before an official run can start. You can keep this page open; status refreshes automatically.` : firstRun ? 'The timer and your private seeded route begin when you tap below.' : practice ? summary.hasPracticeRun ? 'This team identity has entered practice, so every later replay stays practice-only. Ask the organizer if your registration needs correction; players cannot create an official restart.' : 'This replay is practice-only and reuses a structural route your crew already received. Fresh generated values keep it fun without revealing another competition route.' : 'A replay creates a separate run. It never resets or overwrites an earlier result.'}</p>
    {summary.bestRun && <div className="mt-5 rounded-2xl bg-emerald-50 p-4"><span className="text-xs font-bold uppercase tracking-wide text-emerald-700">Current best</span><p className="mt-1 text-2xl font-black text-emerald-950">{summary.bestRun.score} points</p></div>}
    {!disabled ? <button type="button" disabled={busy} onClick={() => void onStart(practice)} className={`${primaryButton} mt-5`}>{busy ? 'Building your route…' : firstRun ? 'Start Run 1' : practice ? 'Start practice run' : 'Start a new run'}</button> : <p className="mt-5 rounded-2xl bg-stone-100 p-4 text-sm text-stone-600">{approvalPending ? 'Waiting for the organizer. This team cannot enter the competition yet.' : 'The organizer has limited this hunt to one run.'}</p>}
  </section>;
}

function ActiveLeaderboard({ revision }: { revision: number }) {
  const [open, setOpen] = useState(false);
  const { data, failed } = useTeamLeaderboards(revision, open);
  return <details className="mt-7" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="min-h-12 cursor-pointer py-3 text-center text-sm font-bold text-emerald-900 underline underline-offset-4">See live standings</summary>
    <div className="mt-3"><Leaderboards board={data} failed={failed} /></div>
  </details>;
}

export default function V3PlayerPage() {
  const [summary, setSummary] = useState<TeamSessionSummary | null>(null);
  const [view, setView] = useState<V3PlayerView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingRunCommand | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const refreshSequence = useRef(0);
  const remaining = useTimer(view);

  const receiveView = useCallback((next: V3PlayerView) => {
    if (!mounted.current) return;
    setView(current => {
      if (current?.runId !== next.runId) return next;
      if (current.revision > next.revision) return current;
      if (current.revision === next.revision && Date.parse(current.serverNow ?? '') > Date.parse(next.serverNow ?? '')) return current;
      return next;
    });
    const saved = readPendingCommand(next.runId);
    setPending(saved);
  }, []);

  const loadSession = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const result = await v3Request<{ summary: TeamSessionSummary }>('/api/v3/session');
      const nextSummary = normalizeSummary(result.summary);
      if (!mounted.current || sequence !== refreshSequence.current) return;
      setSummary(nextSummary);
      const target = nextSummary.activeRun ?? (nextSummary.latestRun?.status === 'completed' ? nextSummary.latestRun : null);
      if (target) {
        const run = await v3Request<{ view: V3PlayerView }>(`/api/v3/runs?runId=${encodeURIComponent(target.id)}`);
        if (!mounted.current || sequence !== refreshSequence.current) return;
        receiveView(run.view);
      } else {
        setView(null);
        setPending(null);
      }
      setError('');
    } catch (requestError) {
      if (!mounted.current || sequence !== refreshSequence.current) return;
      if (requestError instanceof V3RequestError && requestError.status === 401) {
        setSummary(null); setView(null); setPending(null);
      } else setError('Could not refresh your latest progress. Your current screen is still available.');
    } finally {
      if (mounted.current && sequence === refreshSequence.current) setLoading(false);
    }
  }, [receiveView]);

  useEffect(() => {
    mounted.current = true;
    void loadSession();
    const update = () => { if (document.visibilityState === 'visible' && !busyRef.current) void loadSession(); };
    const timer = window.setInterval(update, 8000);
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [loadSession]);

  const register = (next: TeamSessionSummary) => {
    refreshSequence.current += 1;
    setSummary(normalizeSummary(next));
    setView(null);
    setError('');
    setLoading(false);
  };

  const startRun = async (practice: boolean) => {
    if (busyRef.current) return;
    refreshSequence.current += 1;
    busyRef.current = true; setBusy(true); setError(''); setNotice(null);
    try {
      const result = await v3Request<{ view: V3PlayerView }>('/api/v3/runs', {
        method: 'POST',
        body: JSON.stringify({ requestId: newRequestId(), practice }),
      });
      receiveView(result.view);
      await loadSession();
    } catch (requestError) {
      setError(requestError instanceof V3RequestError ? requestError.message : 'The run could not start. Try again with the same team session.');
    } finally { busyRef.current = false; setBusy(false); }
  };

  const execute = async (request: PendingRunCommand): Promise<Feedback | null> => {
    if (busyRef.current) return null;
    refreshSequence.current += 1;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const result = await v3Request<RunCommandResponse>('/api/v3/command', {
        method: 'POST',
        body: JSON.stringify({ runId: request.runId, requestId: request.requestId, command: request.command }),
      });
      writePendingCommand(request.runId, null);
      setPending(null);
      receiveView(result.view);
      setNotice({
        id: request.requestId,
        kind: result.feedback.status === 'accepted' || result.feedback.status === 'already_applied' ? 'success' : 'error',
        message: result.feedback.message,
      });
      if (result.view.status === 'completed') await loadSession();
      return result.feedback;
    } catch (requestError) {
      const permanent = requestError instanceof V3RequestError && requestError.status >= 400 && requestError.status < 500 && ![408, 429].includes(requestError.status);
      if (permanent) {
        writePendingCommand(request.runId, null);
        setPending(null);
        setError(requestError.message);
        await loadSession();
      } else setError('Connection interrupted. Retry the same action to safely check whether it was received.');
      return null;
    } finally { busyRef.current = false; setBusy(false); }
  };

  const send = async (command: GameCommand): Promise<Feedback | null> => {
    if (!view || busyRef.current || pending) return null;
    const request = { runId: view.runId, requestId: newRequestId(), command };
    writePendingCommand(view.runId, request);
    setPending(request);
    setNotice(null);
    return execute(request);
  };

  const leave = async () => {
    if (busyRef.current) return;
    refreshSequence.current += 1;
    busyRef.current = true; setBusy(true); setError('');
    try {
      await v3Request('/api/v3/session', { method: 'DELETE', body: '{}' });
      if (view) writePendingCommand(view.runId, null);
      setSummary(null); setView(null); setPending(null); setNotice(null);
    } catch (requestError) {
      setError(requestError instanceof V3RequestError ? requestError.message : 'We could not leave this team. Try again.');
    } finally { busyRef.current = false; setBusy(false); }
  };

  const theme = view?.hunt.theme;
  const primary = theme?.primaryColor || '#064e3b';
  const playBlocked = view?.playability ? !view.playability.allowed : summary?.hunt.status !== 'live';
  const commandDisabled = busy || pending !== null || playBlocked || remaining === 0;
  const noticeMatches = notice && view?.node ? notice : null;
  const parallelMechanic = view?.features?.parallelMechanics?.find(mechanic => mechanic.checkpointId === view.checkpoint?.id && mechanic.nodeId === view.node?.id);

  return <main
    className="hunt-player relative isolate min-h-screen bg-[#f6f5f0] px-4 pb-14 text-stone-950 sm:px-6"
    data-button-shape={theme?.buttonShape}
    data-success-animation={theme?.successAnimation}
    data-hunt-background={theme?.backgroundUrl ? 'true' : undefined}
    style={{ '--hunt-primary': primary, '--hunt-on-primary': themeTextColor(primary), fontFamily: theme?.font === 'serif' ? 'Georgia, serif' : undefined } as React.CSSProperties}
  >
    {theme?.backgroundUrl && <img src={theme.backgroundUrl} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-40" />}
    <div className="hunt-content relative mx-auto max-w-2xl">
      {!summary && <header className="flex items-center justify-between py-5"><Link href="/v3" className="flex items-center gap-3 font-black tracking-tight"><span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-950 text-lg text-white">↗</span>Treasure Hunt</Link></header>}
      {loading && !summary ? <div role="status" className={`${cardStyle} mt-8 text-center text-stone-500`}>Finding your team session…</div> : !summary ? <Registration onRegistered={register} /> : <>
        <TeamIdentity summary={summary} view={view} onLeave={() => void leave()} busy={busy} />
        {error && <div role="alert" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950"><p>{error}</p>{pending && <button type="button" disabled={busy} onClick={() => void execute(pending)} className="mt-3 min-h-11 font-bold underline">Retry last action</button>}{!pending && <button type="button" disabled={busy} onClick={() => void loadSession()} className="mt-3 min-h-11 font-bold underline">Refresh progress</button>}</div>}
        {!view ? <RunLobby summary={summary} busy={busy} onStart={startRun} /> : view.status === 'completed' ? <FinishExperience view={view} summary={summary} busy={busy} onReplay={startRun} /> : <div className="space-y-6">
          {theme?.coverUrl && <img src={theme.coverUrl} alt="" className="max-h-56 w-full rounded-[1.75rem] object-cover" />}
          <section className={cardStyle} aria-label="Current run summary">
            <div className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-800">Run {view.runNumber}{view.practice ? ' · Practice' : ''}</p><h2 className="mt-1 text-xl font-black">{view.checkpoint?.title || 'Getting the next clue…'}</h2></div>
              <div className="text-right"><p className="text-2xl font-black tabular-nums text-emerald-950">{view.score}</p><p className="text-xs font-bold uppercase tracking-wide text-stone-500">ranking points</p>{view.bonusScore !== 0 && <p className="mt-1 text-xs font-bold text-violet-700">{view.bonusScore > 0 ? '+' : ''}{view.bonusScore} extra</p>}</div>
            </div>
            <RunProgress view={view} />
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-stone-100 pt-3 text-sm text-stone-500">
              <span>{view.progress.completed}/{view.progress.total} checkpoints</span>
              {remaining !== null && <strong className={remaining === 0 ? 'text-red-700' : 'text-stone-800'}>{view.timer?.paused ? 'Paused · ' : ''}{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</strong>}
              <button type="button" disabled={busy} onClick={() => void loadSession()} className="min-h-10 px-2 font-bold text-emerald-900 underline">Refresh</button>
            </div>
          </section>

          {playBlocked && <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p>{view.playability?.message || 'The organizer has paused this event. Your run is safely saved.'}</p>{view.playability?.code === 'expired' && <button type="button" disabled={busy} onClick={() => void startRun(false)} className="mt-3 min-h-11 rounded-xl bg-amber-950 px-4 py-2 font-black text-white">Start a new run</button>}</div>}
          {view.status === 'waiting' ? <p className={`${cardStyle} text-sm text-stone-600`}>Your organizer will open this run shortly. Keep this page ready.</p> : view.checkpoint && view.node ? <section key={`${view.runId}:${view.checkpoint.id}:${view.node.id}`} className={cardStyle} aria-labelledby="current-task-heading">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-800">Current challenge</p>
            <h2 id="current-task-heading" className="mb-5 mt-1 text-3xl font-black tracking-tight">{view.checkpoint.title}</h2>
            <CurrentTask teamId={summary.team.id} currentMemberId={summary.member.id} runId={view.runId} checkpointId={view.checkpoint.id} node={view.node} disabled={commandDisabled} send={send} notice={noticeMatches} clearNotice={() => setNotice(null)} parallelMechanic={parallelMechanic} onView={receiveView} />
            <HintPanel teamId={view.runId} checkpointId={view.checkpoint.id} hints={view.hints} disabled={commandDisabled} send={send} clearNotice={() => setNotice(null)} />
          </section> : <p className={`${cardStyle} text-sm text-stone-600`}>Waiting for the next server-confirmed clue. Refresh to check your run.</p>}
          {view.features?.publicBoard?.enabled && view.features.publicBoard.slug && <Link href={`/board/${encodeURIComponent(view.features.publicBoard.slug)}`} className={secondaryButton}>Open public event board</Link>}
          <ActiveLeaderboard revision={view.revision} />
        </div>}
        {view && <SupportPanel runId={view.runId} checkpointId={view.checkpoint?.id} nodeId={view.node?.id} suggestedKind={view.node?.type === 'verify_gps' ? 'gps' : view.node?.type === 'verify_image' ? 'photo' : view.node?.type === 'puzzle' ? 'puzzle' : view.node?.type === 'camera_guide' ? 'camera' : 'help'} />}
      </>}
    </div>
  </main>;
}
