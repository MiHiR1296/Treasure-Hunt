/* eslint-disable @next/next/no-img-element -- Organizer and device image assets use their original access-controlled URLs. */
'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { Feedback, GameCommand, HuntTheme } from '@/lib/engine/types';
import { themeTextColor } from '@/lib/utils/colorContrast';
import CurrentTask, { inputStyle, primaryButton } from '@/components/v2/CurrentTask';
import HintPanel from '@/components/v2/HintPanel';
import { isPreviewSession, newRequestId, PlayerRequestError, playerRequest, savedCommand, savedPlayerView, storeCommand, storePlayerView, type ClientPlayerView, type PendingCommand } from '@/components/v2/sessionClient';
import HelpCenter from '@/components/v2/player/HelpCenter';
import Leaderboard from '@/components/v2/player/Leaderboard';
import PreviewControls from '@/components/v2/player/PreviewControls';
import CheckpointBadge from '@/components/v2/player/CheckpointBadge';
import type { ActionNotice } from '@/components/v2/player/ActionFeedback';
import FeedbackToast, { type FeedbackCue } from '@/components/v2/player/FeedbackToast';
import { useFeedbackCues } from '@/components/v2/player/useFeedbackCues';
import { describeActionFeedback } from '@/components/v2/player/feedbackModel';
import StageReview from '@/components/v2/player/StageReview';
import '@/components/v2/player/theme.css';
const RegionMap = dynamic(() => import('@/components/v2/player/RegionMap'), { ssr: false });

type HuntSummary = { id: string; title: string };
type ScopedNotice = ActionNotice & { checkpointId?: string; nodeId?: string; hintId?: string };

function HuntProgress({ checkpoints, stages, activeId, selectedId, iconStyle, onSelect }: { checkpoints: NonNullable<ClientPlayerView['checkpoints']>; stages: NonNullable<ClientPlayerView['stages']>; activeId?: string; selectedId?: string; iconStyle?: HuntTheme['checkpointIconStyle']; onSelect: (id: string | null) => void }) {
  const unlocked = new Map(stages.map(stage => [stage.id, stage]));
  return <ol aria-label="Hunt progress" className="flex min-h-11 items-center">
    {checkpoints.map((checkpoint, index) => {
      const current = checkpoint.id === activeId;
      const complete = checkpoint.status === 'completed' || checkpoint.status === 'skipped';
      const stage = unlocked.get(checkpoint.id);
      const selected = checkpoint.id === selectedId;
      const dot = current && iconStyle && iconStyle !== 'none' ? <CheckpointBadge style={iconStyle} index={index} status={checkpoint.status} /> : <span aria-hidden="true" className={`block rounded-full transition-all motion-reduce:transition-none ${current ? 'h-4 w-4 bg-[var(--hunt-primary,#065f46)] ring-4 ring-stone-200' : complete ? 'h-2.5 w-2.5 bg-[var(--hunt-primary,#065f46)]' : 'h-2.5 w-2.5 bg-stone-300'} ${selected && !current ? 'ring-4 ring-amber-200' : ''}`} />;
      return <li key={checkpoint.id} aria-current={current ? 'step' : undefined} className="flex items-center">
        {stage ? <button type="button" onClick={() => onSelect(current ? null : checkpoint.id)} aria-label={`${stage.title}, ${current ? 'current stage' : 'completed stage'}`} aria-pressed={selected} title={stage.title} className="hunt-action flex h-11 w-8 items-center justify-center rounded-full">{dot}</button> : <span aria-label={`Stage ${index + 1}, locked`} className="flex h-11 w-8 items-center justify-center">{dot}</span>}
      </li>;
    })}
  </ol>;
}

export default function PlayerPage() {
  const [view, setView] = useState<ClientPlayerView | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [reviewStageId, setReviewStageId] = useState<string | null>(null);
  const [hunts, setHunts] = useState<HuntSummary[]>([]);
  const [huntId, setHuntId] = useState('');
  const [huntListError, setHuntListError] = useState('');
  const [linkedHuntUnavailable, setLinkedHuntUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sessionVerified, setSessionVerified] = useState(false);
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingCommand | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<ScopedNotice | null>(null);
  const [cue, setCue] = useState<FeedbackCue | null>(null);
  const { soundEnabled, toggleSound, unlock, playSuccess } = useFeedbackCues();
  const [syncMessage, setSyncMessage] = useState('');
  const busyRef = useRef(false);
  const pendingRef = useRef<PendingCommand | null>(null);
  const teamRef = useRef<string | null>(null);
  const verifiedRef = useRef(false);
  const epoch = useRef(0);
  const refreshSequence = useRef(0);
  const viewRef = useRef<ClientPlayerView | null>(null);
  const dismissCue = useCallback(() => setCue(null), []);
  const clearNotice = useCallback(() => { setNotice(null); setCue(null); }, []);

  useEffect(() => {
    if (!cue) return;
    const timer = window.setTimeout(() => {
      // Do not remove a keyboard user's currently focused dismiss button.
      if (!document.activeElement?.closest('[data-testid="feedback-toast"]')) setCue(current => current?.id === cue.id ? null : current);
    }, cue.kind === 'error' ? 8000 : 5000);
    return () => window.clearTimeout(timer);
  }, [cue]);

  const receive = useCallback((next: ClientPlayerView) => {
    if (viewRef.current?.teamId === next.teamId && viewRef.current.revision > next.revision) return;
    viewRef.current = next;
    if (teamRef.current !== next.teamId) {
      setReviewStageId(null);
      teamRef.current = next.teamId;
      const saved = savedCommand(next.teamId);
      pendingRef.current = saved;
      setPending(saved);
    }
    setView((previous) => previous?.teamId === next.teamId && previous.revision > next.revision ? previous : next);
  }, []);

  const refresh = useCallback(async () => {
    const generation = epoch.current;
    const sequence = ++refreshSequence.current;
    try {
      const result = await playerRequest<{ view: ClientPlayerView }>('/api/v2/session');
      if (generation !== epoch.current || sequence !== refreshSequence.current) return;
      receive(result.view);
      verifiedRef.current = true;
      setSessionVerified(true);
      setSyncMessage('');
    } catch (requestError) {
      if (generation !== epoch.current || sequence !== refreshSequence.current) return;
      if (requestError instanceof PlayerRequestError && requestError.status === 401) {
        if (teamRef.current) {
          setMode('join');
          setError('Your team session has ended. Join with your team name and PIN to continue.');
        }
        storePlayerView(null);
        verifiedRef.current = false;
        setSessionVerified(false);
        setView(null);
        viewRef.current = null;
        setNotice(null);
        setCue(null);
        teamRef.current = null;
        pendingRef.current = null;
        setPending(null);
        setSyncMessage('');
      } else {
        verifiedRef.current = false;
        setSessionVerified(false);
        setSyncMessage('Could not refresh your team’s progress. Your current task is still here. Check your connection and try again.');
      }
    } finally {
      if (generation === epoch.current && sequence === refreshSequence.current) setLoading(false);
    }
  }, [receive]);

  useEffect(() => {
    setPreviewMode(isPreviewSession());
    if (view && sessionVerified) storePlayerView(view);
  }, [view, sessionVerified]);

  useEffect(() => {
    if (reviewStageId && !view?.stages?.some(stage => stage.id === reviewStageId)) setReviewStageId(null);
  }, [reviewStageId, view]);

  const loadHunts = useCallback(async () => {
    try {
      const result = await playerRequest<{ hunts: HuntSummary[] }>('/api/v2/hunts');
      setHunts(result.hunts);
      setHuntListError('');
      const linkedHunt = new URLSearchParams(window.location.search).get('hunt');
      const available = !linkedHunt || result.hunts.some((hunt) => hunt.id === linkedHunt);
      setLinkedHuntUnavailable(!available);
      setHuntId((previous) => previous || (linkedHunt ? available ? linkedHunt : '' : result.hunts[0]?.id || ''));
    } catch {
      setHuntListError('We could not load the available hunts. Check your connection and try again.');
    }
  }, []);

  useEffect(() => {
    const cached = savedPlayerView();
    if (cached) {
      receive(cached);
      setLoading(false);
    }
    void refresh();
    void loadHunts();
    const update = () => { if (document.visibilityState === 'visible' && !busyRef.current) void refresh(); };
    const timer = window.setInterval(update, 8000);
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [refresh, loadHunts, receive]);

  const join = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || !huntId || previewMode) return;
    const form = new FormData(event.currentTarget);
    busyRef.current = true;
    setBusy(true);
    setError('');
    epoch.current += 1;
    try {
      const result = await playerRequest<{ view: ClientPlayerView }>('/api/v2/session', { method: 'POST', body: JSON.stringify({ huntId, mode, teamName: form.get('teamName'), pin: form.get('pin'), playerName: form.get('playerName') }) });
      receive(result.view);
      verifiedRef.current = true;
      setSessionVerified(true);
      setSyncMessage('');
      setNotice(null);
      setCue({ id: newRequestId(), kind: 'success', title: 'Your adventure starts here', message: 'Your team is ready. Let the adventure begin.' });
    } catch (requestError) {
      setError(requestError instanceof PlayerRequestError ? requestError.message : 'Connection interrupted. Try joining with the same team name and PIN to recover your team.');
    } finally {
      busyRef.current = false;
      setBusy(false);
      setLoading(false);
    }
  };

  const execute = async (request: PendingCommand): Promise<Feedback | null> => {
    if (busyRef.current || !verifiedRef.current || request.teamId !== teamRef.current) return null;
    const generation = epoch.current;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setNotice(null);
    setCue(null);
    unlock();
    try {
      const result = await playerRequest<{ view: ClientPlayerView; feedback: Feedback }>('/api/v2/command', { method: 'POST', body: JSON.stringify({ teamId: request.teamId, requestId: request.requestId, command: request.command }) });
      if (generation !== epoch.current || teamRef.current !== request.teamId) return null;
      storeCommand(request.teamId, null);
      pendingRef.current = null;
      setPending(null);
      const previous = viewRef.current;
      const response = previous && describeActionFeedback(request.requestId, request.command, previous, result.view, result.feedback);
      receive(result.view);
      if (response) {
        setNotice({ ...response.notice, ...('checkpointId' in request.command ? { checkpointId: request.command.checkpointId } : {}), ...('nodeId' in request.command ? { nodeId: request.command.nodeId } : {}), ...('hintId' in request.command ? { hintId: request.command.hintId } : {}) });
        setCue(response.cue);
        if (response.celebrate) {
          playSuccess();
          if (result.view.hunt.theme?.feedback && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) navigator.vibrate?.(35);
        }
      }
      setSyncMessage('');
      return result.feedback;
    } catch (requestError) {
      if (generation !== epoch.current || teamRef.current !== request.teamId) return null;
      setCue({ id: request.requestId, kind: 'error', title: 'This action needs another check', message: 'See the message beside your task.' });
      if (requestError instanceof PlayerRequestError && requestError.status >= 400 && requestError.status < 500 && ![408, 429].includes(requestError.status)) {
        storeCommand(request.teamId, null);
        pendingRef.current = null;
        setPending(null);
        setError((request.command.type.includes('puzzle') && (requestError.code === 'puzzle_conflict' || /teammate updated this puzzle/i.test(requestError.message)))
          ? `${requestError.message} Your teammate’s latest puzzle is shown below. Your earlier move was not applied; review the shared board before making your next move.`
          : requestError.message);
        await refresh();
      } else {
        setError('Connection interrupted. Retry this action to check its result safely.');
      }
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const send = async (command: GameCommand): Promise<Feedback | null> => {
    if (!view || !verifiedRef.current || busyRef.current || pendingRef.current) return null;
    const request = { requestId: newRequestId(), teamId: view.teamId, command };
    pendingRef.current = request;
    setPending(request);
    storeCommand(view.teamId, request);
    return execute(request);
  };

  const leave = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    epoch.current += 1;
    try {
      await playerRequest('/api/v2/session', { method: 'DELETE', body: '{}' });
      setView(null);
      viewRef.current = null;
      storePlayerView(null);
      verifiedRef.current = false;
      setSessionVerified(false);
      teamRef.current = null;
      pendingRef.current = null;
      setPending(null);
      setNotice(null);
      setCue(null);
      setError('');
      setMode('join');
    } catch { setError('We could not sign you out. Please try again.'); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const settings = view?.hunt.settings;
  const beforeStart = !!settings?.startsAt && Date.now() < Date.parse(settings.startsAt);
  const afterEnd = !!settings?.endsAt && Date.now() >= Date.parse(settings.endsAt);
  const eventBlocked = !!view && !view.isPreview && ((!!view.eventStatus && view.eventStatus !== 'live') || beforeStart || afterEnd);
  const disabled = busy || pending !== null || !sessionVerified || eventBlocked;
  const theme = view?.hunt.theme;
  const color = theme?.primaryColor || '#065f46';
  const reviewStage = reviewStageId ? view?.stages?.find(stage => stage.id === reviewStageId) : undefined;
  const taskNotice = notice && notice.checkpointId === view?.checkpoint?.id && notice.nodeId === view?.node?.id ? notice : null;
  const hintNotice = notice && notice.checkpointId === view?.checkpoint?.id && notice.hintId ? notice : undefined;
  const recovery = (error || syncMessage || (pending && !busy)) && <div role="alert" className="my-5 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">
    <p>{error || (pending ? 'Your last action needs a result. Retry to check it safely before continuing.' : syncMessage)}</p>
    {pending && sessionVerified ? <button type="button" disabled={busy} className={primaryButton} onClick={() => void execute(pending)}>{busy ? 'Checking…' : 'Retry last action'}</button> : syncMessage && <button type="button" disabled={busy} onClick={() => void refresh()} className="min-h-12 font-semibold underline">Try refreshing again</button>}
  </div>;
  return (
    <main data-button-shape={theme?.buttonShape} data-success-animation={theme?.successAnimation} data-hunt-background={theme?.backgroundUrl ? 'true' : undefined} className="hunt-player relative isolate min-h-screen bg-[#f5f3ed] px-4 pb-12 text-stone-900 sm:px-6" style={{ '--hunt-primary': color, '--hunt-on-primary': themeTextColor(color), fontFamily: theme?.font === 'serif' ? 'Georgia, serif' : undefined } as React.CSSProperties}>
      {theme?.backgroundUrl && <img src={theme.backgroundUrl} alt="" aria-hidden="true" data-hunt-background-image className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-60" />}
      <FeedbackToast cue={cue} onDismiss={dismissCue} />
      <div className="hunt-content relative mx-auto max-w-xl">
        <header className="flex items-center justify-between gap-4 py-6">
          <Link href={previewMode ? '/v2?preview=1' : '/v2'} className="flex items-center gap-3 font-bold tracking-tight"><span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-900 text-xl text-white">↗</span>Treasure Hunt</Link>
          {view && <button type="button" disabled={busy} onClick={() => void leave()} className="min-h-12 px-2 text-sm font-semibold text-stone-600 disabled:opacity-50">Leave team</button>}
        </header>

        {previewMode && !view && <p className="mb-4 rounded-xl bg-violet-100 p-4 text-sm text-violet-950">Organizer preview requires an active test session. <Link href="/v2/admin" className="font-semibold underline">Return to organizer space</Link> to start one.</p>}
        {previewMode && view?.isPreview && <PreviewControls view={view} refresh={refresh} />}
        {eventBlocked && <p role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">{beforeStart ? `Your hunt starts ${new Date(settings!.startsAt!).toLocaleString()}. Your team is ready.` : afterEnd || ['ended', 'archived'].includes(view?.eventStatus || '') ? 'This hunt has ended. Your saved results are below.' : 'Your organizer has paused play. Your progress is saved, and help remains available.'}</p>}

        {!view && recovery}
        {view && !sessionVerified && <div role="status" className="mb-5 rounded-xl border border-stone-300 bg-white p-4 text-sm leading-relaxed text-stone-700"><p>This is your saved progress. Connect to the event server to confirm your team and continue.</p><button type="button" disabled={busy} onClick={() => void refresh()} className="min-h-12 font-semibold text-emerald-800 underline">Reconnect to continue</button></div>}

        {loading ? <div role="status" className="rounded-3xl bg-white p-8 text-center text-stone-600">Finding your adventure…</div> : !view ? <>
          <section className="mb-6 pt-4">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-800">An adventure together</p>
            <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight">Follow the clues.<br />Find your way.</h1>
            <p className="mt-4 leading-relaxed text-stone-600">Pick your hunt and get your team ready. Your progress is saved as you go.</p>
          </section>
          <form onSubmit={join} className="space-y-5 rounded-3xl border border-stone-200 bg-white p-5 sm:p-7">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-stone-100 p-1">
              {(['create', 'join'] as const).map((item) => <button type="button" key={item} aria-pressed={mode === item} onClick={() => setMode(item)} disabled={busy} className={`min-h-12 rounded-lg px-3 font-semibold ${mode === item ? 'bg-white text-emerald-900 shadow-sm' : 'text-stone-600'}`}>{item === 'create' ? 'Create a team' : 'Join a team'}</button>)}
            </div>
            <label htmlFor="hunt" className="block text-sm font-semibold">Your hunt
              <select id="hunt" required value={huntId} onChange={(event) => setHuntId(event.target.value)} disabled={busy} className={inputStyle}>
                {(!hunts.length || !huntId) && <option value="">{hunts.length ? 'Choose an available hunt' : 'No hunts available yet'}</option>}
                {hunts.map((hunt) => <option key={hunt.id} value={hunt.id}>{hunt.title}</option>)}
              </select>
            </label>
            {linkedHuntUnavailable && <p role="status" className="text-sm leading-relaxed text-amber-800">The hunt in your link is not available right now. Check with your organizer, or choose a different hunt.</p>}
            {huntListError && <p role="alert" className="text-sm leading-relaxed text-amber-800">{huntListError}</p>}
            <label htmlFor="team-name" className="block text-sm font-semibold">Team name<input id="team-name" name="teamName" autoComplete="organization" required maxLength={60} disabled={busy} className={inputStyle} placeholder="The clue crew" /></label>
            <label htmlFor="team-pin" className="block text-sm font-semibold">Team PIN<input id="team-pin" name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,12}" autoComplete={mode === 'create' ? 'new-password' : 'current-password'} required minLength={4} maxLength={12} disabled={busy} className={inputStyle} placeholder="4 to 12 digits" /></label>
            <p className="-mt-2 text-xs leading-relaxed text-stone-500">{mode === 'create' ? 'Share your team name and PIN with teammates so they can join on their phones.' : 'Use the name and PIN shared by your teammate. Progress and hints are shared.'}</p>
            <label htmlFor="player-name" className="block text-sm font-semibold">Your name<input id="player-name" name="playerName" autoComplete="given-name" required maxLength={60} disabled={busy} className={inputStyle} /></label>
            <button type="submit" disabled={busy || !huntId || previewMode} className={primaryButton}>{busy ? 'Getting ready…' : mode === 'create' ? 'Start our adventure' : 'Join the adventure'}</button>
            {!hunts.length && <button type="button" onClick={() => void loadHunts()} className="min-h-12 w-full font-semibold text-emerald-800">Refresh available hunts</button>}
          </form>
          <p className="mt-6 text-center text-sm text-stone-600">Running an event? <Link href="/v2/admin" prefetch={false} className="font-semibold text-emerald-800 underline">Organizer space</Link></p>
        </> : <>
          {view.hunt.theme?.coverUrl && <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={view.hunt.theme.coverUrl} alt="" className="mb-5 max-h-56 w-full rounded-2xl object-cover" /></>}
          {view.hunt.theme?.logoUrl && <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={view.hunt.theme.logoUrl} alt={`${view.hunt.title} logo`} className="mb-4 max-h-16 max-w-48 object-contain" /></>}
          <section aria-label="Team progress" className="mb-8 border-b border-stone-300 pb-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0"><h1 className="truncate text-lg font-bold tracking-tight">{view.hunt.title}</h1>{view.teamName && <p className="mt-1 truncate text-sm text-stone-500">{view.teamName}</p>}</div>
              <p aria-label={`${view.score} points`} className="shrink-0 rounded-full bg-[var(--hunt-primary,#065f46)] px-3 py-1.5 text-sm font-semibold text-[var(--hunt-on-primary,#ffffff)]"><span key={cue?.points ? cue.id : 'score'} className={`tabular-nums ${cue?.points ? 'hunt-score-pop' : ''}`}>{view.score}</span> <span className="font-normal opacity-80">pts</span></p>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              {!!view.checkpoints?.length && <HuntProgress checkpoints={view.checkpoints} stages={view.stages ?? []} activeId={view.checkpoint?.id} selectedId={reviewStageId ?? view.checkpoint?.id} iconStyle={theme?.checkpointIconStyle} onSelect={setReviewStageId} />}
              <div className="ml-auto flex items-center gap-1">
                <button type="button" aria-label="Refresh" title="Refresh" onClick={() => void refresh()} disabled={busy} className="hunt-action flex h-11 w-11 items-center justify-center rounded-full text-xl text-stone-500 hover:bg-white disabled:opacity-50"><span aria-hidden="true">↻</span></button>
                <button type="button" aria-label={soundEnabled ? 'Sound on' : 'Sound off'} title={soundEnabled ? 'Sound on' : 'Sound off'} aria-pressed={soundEnabled} onClick={toggleSound} className="hunt-action flex h-11 w-11 items-center justify-center rounded-full text-lg text-stone-500 hover:bg-white"><span aria-hidden="true">{soundEnabled ? '♪' : '♩'}</span></button>
              </div>
            </div>
          </section>
          {view.checkpoints && settings?.mode && settings.mode !== 'sequential' && <section aria-label="Choose checkpoint" className="mb-5 space-y-2"><h2 className="font-bold">Choose your next destination</h2>{view.checkpoints.map((checkpoint, index) => <button key={checkpoint.id} type="button" disabled={disabled || checkpoint.status !== 'available'} onClick={() => void send({ type: 'choose_checkpoint', checkpointId: checkpoint.id })} className="hunt-action flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-stone-300 bg-white px-4 py-3 text-left disabled:opacity-60"><span className="flex items-center gap-3 font-semibold"><CheckpointBadge style={theme?.checkpointIconStyle} index={index} status={checkpoint.status} /><span>{checkpoint.title}{checkpoint.required ? '' : ' · optional'}</span></span><span className="text-xs capitalize">{checkpoint.status}</span></button>)}</section>}
          {view.checkpoints?.some(checkpoint => checkpoint.location) && <section className="mb-5"><button type="button" onClick={() => setShowMap(!showMap)} className="min-h-12 font-semibold text-emerald-900 underline">{showMap ? 'Hide hunt map' : 'Show hunt map'}</button>{showMap && <RegionMap points={view.checkpoints.filter(checkpoint => checkpoint.location).map(checkpoint => ({ ...checkpoint.location!, title: checkpoint.title }))} />}</section>}
          {reviewStage ? <StageReview stage={reviewStage} returnLabel={view.status === 'completed' ? 'Back to your finish' : 'Back to the current challenge'} onReturn={() => setReviewStageId(null)} /> : view.status === 'completed' ? <section className="hunt-task-arrive rounded-3xl border border-stone-200 bg-white p-7 text-center">
            {recovery}
            <span aria-hidden="true" className="hunt-success-mark text-5xl">✦</span><p className="mt-4 text-xs font-bold uppercase tracking-widest text-emerald-800">Every clue led here</p><h2 className="mt-3 text-3xl font-bold">You found your finish.</h2><p className="mt-4 leading-relaxed text-stone-600">{settings?.completionMessage || `Your team completed the hunt and earned ${view.score} points. Well played.`}</p>{view.summary && <div className="mt-5 space-y-3 text-left text-sm"><p>{Math.floor(view.summary.elapsedSeconds / 60)} minutes · {view.summary.hintsUsed} hints used</p><ul className="space-y-2">{view.summary.checkpoints.map((checkpoint, index) => <li key={checkpoint.id} className="flex items-center justify-between gap-3 border-t border-stone-100 pt-2"><span className="flex items-center gap-3"><CheckpointBadge style={theme?.checkpointIconStyle} index={index} status={checkpoint.status} /><span>{checkpoint.title} · {checkpoint.status}</span></span><strong>{checkpoint.points} points</strong></li>)}</ul></div>}
          </section> : view.checkpoint && view.node ? <div className="space-y-7">
            <section key={`${view.teamId}:${view.checkpoint.id}:${view.node.id}`} aria-labelledby="current-question" className="hunt-task-arrive py-1">
              <h2 id="current-question" className="mb-4 text-3xl font-bold leading-tight tracking-tight">{view.checkpoint.title}</h2>
              <CurrentTask teamId={view.teamId} checkpointId={view.checkpoint.id} node={view.node} send={send} disabled={disabled} notice={taskNotice} clearNotice={clearNotice} />
              {recovery}
            </section>
            <HintPanel key={view.checkpoint.id} teamId={view.teamId} checkpointId={view.checkpoint.id} hints={view.hints} disabled={disabled} send={send} notice={hintNotice} clearNotice={clearNotice} />
          </div> : <>{recovery}<p role="status">Waiting for your next clue. Refresh to check your progress.</p></>}
          <div className="mt-7 space-y-6">{(view.hunt.description || settings?.rules) && <details className="border-t border-stone-200 pt-2"><summary className="min-h-12 cursor-pointer py-3 font-semibold text-stone-700">How to play & rules</summary>{view.hunt.description && <p className="whitespace-pre-line text-sm leading-relaxed">{view.hunt.description}</p>}{settings?.rules && <p className={`${view.hunt.description ? 'mt-4 border-t border-stone-200 pt-4' : ''} whitespace-pre-line text-sm leading-relaxed`}>{settings.rules}</p>}</details>}<HelpCenter key={view.teamId} teamId={view.teamId} checkpointId={view.checkpoint?.id} nodeId={view.node?.id} disabled={!sessionVerified} />{settings?.leaderboard !== 'hidden' && <Leaderboard teamId={view.teamId} revision={view.revision} />}</div>
        </>}

      </div>
    </main>
  );
}
