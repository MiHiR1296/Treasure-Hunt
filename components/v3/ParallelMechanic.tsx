'use client';

import { useEffect, useState } from 'react';
import QRScanner from '@/components/QRScanner';
import { newRequestId, V3RequestError, v3Request } from './api';
import type { PublicParallelMechanic, V3PlayerView } from './types';
import { inputStyle, primaryButton } from './ui';
import ParallelPhotoLane from './ParallelPhotoLane';

type Lane = PublicParallelMechanic['lanes'][number];
type PendingLane = { requestId: string; lane: Lane; evidence: Record<string, unknown> };
type LaneResponse = {
  accepted: boolean;
  status: 'accepted' | 'rejected' | 'pending_review';
  mechanicCompleted: boolean;
  runCompleted: boolean;
  remaining: number;
  view: V3PlayerView;
};

export default function ParallelMechanic({ teamId, currentMemberId, runId, mechanic, disabled, onView }: {
  teamId: string;
  currentMemberId: string;
  runId: string;
  mechanic: PublicParallelMechanic;
  disabled: boolean;
  onView: (view: V3PlayerView) => void;
}) {
  const [selected, setSelected] = useState<Lane | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingLane | null>(null);
  const [message, setMessage] = useState('');
  const [, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!mechanic.windowExpiresAt) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [mechanic.windowExpiresAt]);
  const completedIds = new Set(mechanic.completedLanes.map(lane => lane.laneId));
  const submittedByMe = mechanic.completedLanes.some(lane => lane.memberId === currentMemberId);
  const secondsLeft = mechanic.windowPaused && mechanic.windowRemainingSeconds !== undefined
    ? Math.max(0, Math.ceil(mechanic.windowRemainingSeconds))
    : mechanic.windowExpiresAt ? Math.max(0, Math.ceil((Date.parse(mechanic.windowExpiresAt) - Date.now()) / 1000)) : null;

  const submit = async (request: PendingLane) => {
    if (busy || disabled) return null;
    setBusy(true); setPending(request); setMessage('Checking this lane…');
    try {
      const result = await v3Request<LaneResponse>('/api/v3/parallel', {
        method: 'POST',
        body: JSON.stringify({
          runId,
          requestId: request.requestId,
          mechanicId: mechanic.id,
          laneId: request.lane.id,
          evidence: request.evidence,
        }),
      });
      setPending(null);
      onView(result.view);
      if (result.status === 'pending_review') {
        setMessage('Your photo is waiting for organizer review. Teammates can keep working on other lanes; the run clock pauses if organizer review becomes the only remaining blocker.');
      } else if (result.accepted) {
        setSelected(null); setValue('');
        setMessage(result.mechanicCompleted ? 'Linked challenge complete. Your team is moving on.' : `Lane confirmed. ${result.remaining} lane${result.remaining === 1 ? '' : 's'} still need a different signed-in teammate.`);
      } else setMessage('That evidence did not match this lane. Check it and try again.');
      return result;
    } catch (error) {
      const permanent = error instanceof V3RequestError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
      if (permanent) setPending(null);
      setMessage(error instanceof V3RequestError ? error.message : 'Connection interrupted. Retry this same lane to check it safely.');
      return null;
    } finally { setBusy(false); }
  };

  const submitLocation = (lane: Lane) => {
    if (!navigator.geolocation) { setMessage('This browser cannot check location. Choose another lane or ask the organizer for help.'); return; }
    setBusy(true); setMessage('Finding your location…');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setBusy(false);
      const request = { requestId: newRequestId(), lane, evidence: { location: { latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: coords.accuracy } } };
      void submit(request);
    }, () => { setBusy(false); setMessage('Location is unavailable. Move into an open area, enable permission, and retry.'); }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  };

  return <div className="space-y-4">
    <div className="rounded-2xl bg-violet-50 p-4 text-sm leading-relaxed text-violet-950"><strong>Split up, then sync.</strong> Each lane must be confirmed by a different signed-in teammate within {mechanic.timeWindowSeconds} seconds. Open this team on each player’s phone.{secondsLeft !== null && <span className="mt-2 block font-black">Current link window: {mechanic.windowPaused ? 'paused · ' : ''}{secondsLeft}s left</span>}</div>
    {!!mechanic.completedLanes.length && <ul className="space-y-2">{mechanic.completedLanes.map(lane => <li key={lane.laneId} className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-950"><strong>{mechanic.lanes.find(item => item.id === lane.laneId)?.label ?? lane.laneId}</strong><span>✓ {lane.memberName}</span></li>)}</ul>}
    {submittedByMe && mechanic.remainingLaneIds.length > 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Your lane is confirmed. A different signed-in teammate must complete the next one.</p>}
    <div className="grid gap-2 sm:grid-cols-2">{mechanic.lanes.map(lane => <button type="button" key={lane.id} disabled={disabled || busy || completedIds.has(lane.id) || submittedByMe} aria-pressed={selected?.id === lane.id} onClick={() => { setSelected(lane); setValue(''); setMessage(''); }} className={`min-h-14 rounded-2xl border p-3 text-left text-sm font-bold ${selected?.id === lane.id ? 'border-violet-700 bg-violet-50 ring-2 ring-violet-200' : 'border-stone-200 bg-white'} disabled:opacity-50`}><span className="block text-xs uppercase tracking-wide text-stone-500">{lane.type}</span>{lane.label}{completedIds.has(lane.id) ? ' · complete' : ''}</button>)}</div>

    {selected?.type === 'code' && <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (value.trim()) void submit({ requestId: newRequestId(), lane: selected, evidence: { value } }); }}><label className="block text-sm font-bold">Enter your lane code<input className={inputStyle} value={value} onChange={event => setValue(event.target.value)} disabled={busy || disabled} autoComplete="off" /></label><button className={primaryButton} disabled={busy || disabled || !value.trim()}>{busy ? 'Checking…' : 'Confirm my lane'}</button></form>}
    {selected?.type === 'qr' && <QRScanner onScanSuccess={async value => ({ accepted: Boolean((await submit({ requestId: newRequestId(), lane: selected, evidence: { value } }))?.accepted), message: message || 'Lane checked.' })} />}
    {selected?.type === 'gps' && <button type="button" className={primaryButton} disabled={busy || disabled} onClick={() => submitLocation(selected)}>{busy ? 'Finding location…' : 'I’m at my lane'}</button>}
    {selected?.type === 'photo' && <ParallelPhotoLane teamId={teamId} runId={runId} checkpointId={mechanic.checkpointId} nodeId={mechanic.nodeId} mechanicId={mechanic.id} laneId={selected.id} disabled={disabled || busy} onSubmit={async (mediaId, registrationRequestId) => {
      if (registrationRequestId) {
        return (await submit({ requestId: registrationRequestId, lane: selected, evidence: { mediaId } }))?.status ?? 'pending_review';
      }
      const query = new URLSearchParams({ runId, mediaId, mechanicId: mechanic.id, laneId: selected.id });
      const review = await v3Request<{ status: 'pending' | 'approved' | 'rejected'; message?: string }>(`/api/v3/parallel?${query}`);
      if (review.status === 'pending') return 'pending_review';
      if (review.status === 'rejected') return 'rejected';
      return (await submit({ requestId: newRequestId(), lane: selected, evidence: { mediaId } }))?.status ?? 'pending_review';
    }} />}
    {pending && !busy && <button type="button" className={primaryButton} onClick={() => void submit(pending)}>Retry the same lane</button>}
    {message && <p role="status" className="rounded-2xl bg-stone-100 p-4 text-sm leading-relaxed text-stone-700">{message}</p>}
  </div>;
}
