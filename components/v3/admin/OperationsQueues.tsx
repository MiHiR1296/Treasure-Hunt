'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminRequest, V3AdminRequestError } from './client';
import type { AdminHunt, LiveTeam } from './types';
import { EmptyState, inputClass, labelize, panelClass, primaryButton, secondaryButton, SectionHeading, StatusPill } from './ui';

type RunOperation = (key: string, operation: () => Promise<void>) => Promise<void>;

interface PhotoReview {
  id: string;
  teamId: string;
  runId: string;
  memberName: string;
  teamCode: string;
  teamName?: string | null;
  checkpointId: string;
  runStatus: 'waiting' | 'active' | 'completed' | 'abandoned' | 'disqualified';
  createdAt: string;
  url: string;
  referenceImages?: string[];
}

interface HelpRequest {
  id: string;
  kind: string;
  message: string;
  status: string;
  response?: string | null;
  checkpoint_id?: string | null;
  checkpointId?: string | null;
  created_at?: string;
  createdAt?: string;
  team_id?: string;
  teamId?: string;
  canonical_code?: string;
  teamCode?: string;
  display_name?: string | null;
  teamName?: string | null;
  member_name?: string;
  memberName?: string;
}

interface OrganizerMessage {
  id: string;
  message: string;
  created_by?: string;
  from?: string;
  created_at?: string;
  createdAt?: string;
  team_id?: string | null;
  teamId?: string | null;
  canonical_code?: string | null;
  teamCode?: string | null;
}

function requestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function PhotoCard({ photo, pending, run, reload }: { photo: PhotoReview; pending: string; run: RunOperation; reload: () => Promise<void> }) {
  const [reason, setReason] = useState('Photo evidence checked against the challenge instructions');
  const review = (approved: boolean) => {
    const key = `photo-${photo.id}`;
    void run(key, async () => {
      await adminRequest('/api/v3/admin/media', 'POST', { action: 'review', mediaId: photo.id, approved, reason: reason.trim(), requestId: requestId() });
      await reload();
    });
  };
  const terminal = !['waiting', 'active'].includes(photo.runStatus);
  return <article className="grid gap-4 rounded-2xl border border-white/10 bg-slate-950/55 p-4 sm:grid-cols-[10rem_1fr]">
    <a href={photo.url} target="_blank" rel="noreferrer" className="relative aspect-[4/3] overflow-hidden rounded-xl border border-white/10 bg-black"><Image src={photo.url} alt={`Pending evidence from ${photo.teamCode}`} fill sizes="160px" className="object-cover" unoptimized /></a>
    <div className="min-w-0"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-black text-white"><span className="text-amber-300">{photo.teamCode}</span>{photo.teamName ? ` · ${photo.teamName}` : ''}</p><p className="mt-1 text-xs text-slate-400">{photo.memberName} · {photo.checkpointId} · {new Date(photo.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></div><StatusPill tone={terminal ? 'neutral' : 'warning'}>{terminal ? `${labelize(photo.runStatus)} run · audit` : 'Photo review'}</StatusPill></div>
      {terminal && <p className="mt-2 rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs leading-5 text-slate-300">This run has ended. Closing the item records the organizer decision but cannot change the run, score, or result.</p>}
      {photo.referenceImages && photo.referenceImages.length > 0 && <p className="mt-2 text-xs text-slate-400">{photo.referenceImages.length} challenge reference image{photo.referenceImages.length === 1 ? '' : 's'} available.</p>}
      <label className="mt-3 block text-xs font-bold text-slate-300">Review reason<input className={`${inputClass} mt-1`} required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <div className="mt-3 flex flex-wrap gap-2">{terminal ? <button type="button" className={primaryButton} disabled={Boolean(pending) || !reason.trim()} onClick={() => review(false)}>{pending === `photo-${photo.id}` ? 'Saving…' : 'Close as not applied'}</button> : <><button type="button" className={primaryButton} disabled={Boolean(pending) || !reason.trim()} onClick={() => review(true)}>{pending === `photo-${photo.id}` ? 'Saving…' : 'Approve'}</button><button type="button" className={secondaryButton} disabled={Boolean(pending) || !reason.trim()} onClick={() => review(false)}>Request retry</button></>}<a className={secondaryButton} href={photo.url} target="_blank" rel="noreferrer">Open full image ↗</a></div>
    </div>
  </article>;
}

function HelpCard({ request, pending, run, reload }: { request: HelpRequest; pending: string; run: RunOperation; reload: () => Promise<void> }) {
  const [response, setResponse] = useState('');
  const teamCode = request.teamCode || request.canonical_code || 'Team';
  const teamName = request.teamName || request.display_name;
  const memberName = request.memberName || request.member_name || 'Member';
  const checkpoint = request.checkpointId || request.checkpoint_id;
  const createdAt = request.createdAt || request.created_at;
  const key = `help-${request.id}`;
  return <article className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-black text-white"><span className="text-amber-300">{teamCode}</span>{teamName ? ` · ${teamName}` : ''}</p><p className="mt-1 text-xs text-slate-400">{memberName}{checkpoint ? ` · ${checkpoint}` : ''}{createdAt ? ` · ${new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</p></div><StatusPill tone="info">{labelize(request.kind)}</StatusPill></div>
    <p className="mt-3 rounded-xl bg-white/[0.04] p-3 text-sm leading-6 text-slate-200">{request.message}</p>
    <form className="mt-3" onSubmit={event => { event.preventDefault(); void run(key, async () => { await adminRequest('/api/v3/admin/support', 'POST', { action: 'resolve', requestId: request.id, response: response.trim() }); setResponse(''); await reload(); }); }}><label className="text-xs font-bold text-slate-300">Reply and resolve<textarea className={`${inputClass} mt-1`} rows={2} required maxLength={2000} value={response} onChange={event => setResponse(event.target.value)} placeholder="Give the team a clear next step…" /></label><button className={`${primaryButton} mt-2`} disabled={Boolean(pending) || !response.trim()}>{pending === key ? 'Sending…' : 'Send reply & resolve'}</button></form>
  </article>;
}

export default function OperationsQueues({ hunt, teams, pending, run, notify }: {
  hunt: AdminHunt;
  teams: LiveTeam[];
  pending: string;
  run: RunOperation;
  notify: (message: string) => void;
}) {
  const [photos, setPhotos] = useState<PhotoReview[]>([]);
  const [requests, setRequests] = useState<HelpRequest[]>([]);
  const [messages, setMessages] = useState<OrganizerMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState('all');

  const reload = useCallback(async () => {
    try {
      const [mediaResponse, supportResponse] = await Promise.all([
        adminRequest<{ photos?: PhotoReview[] }>(`/api/v3/admin/media?huntId=${encodeURIComponent(hunt.id)}`),
        adminRequest<{ requests?: HelpRequest[]; messages?: OrganizerMessage[] }>(`/api/v3/admin/support?huntId=${encodeURIComponent(hunt.id)}`),
      ]);
      setPhotos(Array.isArray(mediaResponse.photos) ? mediaResponse.photos : []);
      setRequests(Array.isArray(supportResponse.requests) ? supportResponse.requests : []);
      setMessages(Array.isArray(supportResponse.messages) ? supportResponse.messages : []);
      setProblem('');
    } catch (error) {
      setProblem(error instanceof V3AdminRequestError ? error.message : 'The support queues could not be refreshed.');
    } finally { setLoading(false); }
  }, [hunt.id]);

  useEffect(() => {
    void reload();
    const poll = () => { if (document.visibilityState === 'visible') void reload(); };
    const interval = window.setInterval(poll, 15_000);
    document.addEventListener('visibilitychange', poll);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', poll); };
  }, [reload]);

  const openRequests = useMemo(() => requests.filter(request => request.status === 'open'), [requests]);

  return <section className={`${panelClass} p-5 sm:p-6`}>
    <SectionHeading eyebrow="Action queue" title="Help, photos, and team messages" detail="Resolve the event’s human-in-the-loop work without losing the fast team overview." actions={<button type="button" className={secondaryButton} disabled={loading} onClick={() => void reload()}>{loading ? 'Refreshing…' : 'Refresh queue'}</button>} />
    {problem && <p role="status" className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">{problem} Existing queue items remain visible.</p>}
    <div className="mt-5 flex flex-wrap gap-2"><StatusPill tone={openRequests.length ? 'info' : 'good'}>{openRequests.length} open help</StatusPill><StatusPill tone={photos.length ? 'warning' : 'good'}>{photos.length} photos to review</StatusPill><StatusPill tone="neutral">{messages.length} recent messages</StatusPill></div>

    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <div><h3 className="font-black text-white">Help requests</h3><div className="mt-3 space-y-3">{openRequests.slice(0, 12).map(request => <HelpCard key={request.id} request={request} pending={pending} run={run} reload={reload} />)}{!loading && !openRequests.length && <EmptyState title="No teams waiting">New help requests will appear here.</EmptyState>}</div></div>
      <div><h3 className="font-black text-white">Pending photo evidence</h3><div className="mt-3 space-y-3">{photos.slice(0, 12).map(photo => <PhotoCard key={photo.id} photo={photo} pending={pending} run={run} reload={reload} />)}{!loading && !photos.length && <EmptyState title="Photo queue is clear">Pending organizer-verification photos will appear here.</EmptyState>}</div></div>
    </div>

    <form className="mt-6 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4 lg:grid-cols-[14rem_1fr_auto] lg:items-end" onSubmit={event => {
      event.preventDefault();
      void run('organizer-message', async () => {
        await adminRequest('/api/v3/admin/support', 'POST', { action: 'message', huntId: hunt.id, teamId: audience === 'all' ? null : audience, message: message.trim() });
        setMessage('');
        notify(audience === 'all' ? 'Message sent to every team.' : 'Message sent to the selected team.');
        await reload();
      });
    }}>
      <label className="text-xs font-bold text-slate-300">Audience<select className={`${inputClass} mt-1`} value={audience} onChange={event => setAudience(event.target.value)}><option value="all">All teams</option>{teams.map(team => <option key={team.teamId} value={team.teamId}>{team.code}{team.displayName ? ` · ${team.displayName}` : ''}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-300">Organizer message<input className={`${inputClass} mt-1`} required maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} placeholder="Route update, encouragement, weather notice…" /></label>
      <button className={primaryButton} disabled={Boolean(pending) || !message.trim()}>{pending === 'organizer-message' ? 'Sending…' : 'Send message'}</button>
    </form>
  </section>;
}
