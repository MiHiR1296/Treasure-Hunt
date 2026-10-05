'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { newRequestId, V3RequestError, v3Request } from './api';
import { inputStyle, primaryButton } from './ui';

type HelpKind = 'help' | 'camera' | 'gps' | 'network' | 'puzzle' | 'photo';
type SupportView = {
  requests: Array<{ id: string; kind: string; message: string; status: string; response?: string | null; createdAt: string }>;
  messages: Array<{ id: string; message: string; from: string; createdAt: string }>;
};
type PendingHelp = { requestId: string; kind: HelpKind; message: string };

export default function SupportPanel({ runId, checkpointId, nodeId, suggestedKind = 'help' }: {
  runId?: string;
  checkpointId?: string;
  nodeId?: string;
  suggestedKind?: HelpKind;
}) {
  const [support, setSupport] = useState<SupportView | null>(null);
  const [kind, setKind] = useState<HelpKind>(suggestedKind);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<PendingHelp | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const read = useCallback(async () => {
    try { setSupport(await v3Request<SupportView>('/api/v3/support')); }
    catch { /* A previous response remains useful during a weak connection. */ }
  }, []);
  useEffect(() => {
    void read();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void read(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [read]);

  const send = async (request: PendingHelp) => {
    if (busy) return;
    setBusy(true); setPending(request); setStatus('Sending your request…');
    try {
      await v3Request('/api/v3/support', {
        method: 'POST',
        body: JSON.stringify({ ...request, runId, checkpointId, nodeId }),
      });
      setPending(null); setMessage(''); setStatus('The organizer has your request. Replies will appear here.');
      await read();
    } catch (error) {
      const permanent = error instanceof V3RequestError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
      if (permanent) setPending(null);
      setStatus(error instanceof V3RequestError ? error.message : 'Connection interrupted. Retry the same request below.');
    } finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) return;
    void send({ requestId: newRequestId(), kind, message: message.trim() });
  };
  const latestMessages = support?.messages.slice(0, 3) ?? [];
  const ownRequests = support?.requests.slice(0, 3) ?? [];

  return <details className="mt-7 rounded-2xl border border-stone-200 bg-white px-5">
    <summary className="min-h-14 cursor-pointer py-4 font-bold text-stone-800">Need help or an organizer update?</summary>
    <div className="space-y-5 border-t border-stone-100 pb-5 pt-4">
      {!!latestMessages.length && <section><h2 className="text-xs font-black uppercase tracking-wide text-emerald-800">Organizer messages</h2><ul className="mt-2 space-y-2">{latestMessages.map(item => <li key={item.id} className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-950"><p>{item.message}</p><p className="mt-1 text-xs text-emerald-700">{item.from} · {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></li>)}</ul></section>}
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <label className="text-sm font-bold">Help with<select value={kind} onChange={event => setKind(event.target.value as HelpKind)} className={inputStyle} disabled={busy}><option value="help">Something else</option><option value="camera">Camera</option><option value="gps">Location</option><option value="network">Connection</option><option value="puzzle">Puzzle</option><option value="photo">Photo</option></select></label>
          <label className="text-sm font-bold">What is happening?<textarea value={message} onChange={event => setMessage(event.target.value)} className={inputStyle} rows={3} maxLength={1000} disabled={busy} placeholder="Give the organizer enough detail to help quickly." /></label>
        </div>
        <button type="submit" disabled={busy || !message.trim()} className={primaryButton}>{busy ? 'Sending…' : 'Ask the organizer'}</button>
        {pending && !busy && <button type="button" onClick={() => void send(pending)} className="min-h-11 w-full text-sm font-bold text-emerald-900 underline">Retry the same request</button>}
        {status && <p role="status" className="text-sm text-stone-600">{status}</p>}
      </form>
      {!!ownRequests.length && <section><h2 className="text-xs font-black uppercase tracking-wide text-stone-500">Your recent requests</h2><ul className="mt-2 space-y-2">{ownRequests.map(request => <li key={request.id} className="rounded-xl bg-stone-50 p-3 text-sm"><div className="flex justify-between gap-3"><span className="font-bold capitalize">{request.kind}</span><span className="text-xs font-bold uppercase text-stone-500">{request.status}</span></div><p className="mt-1 text-stone-600">{request.message}</p>{request.response && <p className="mt-2 border-l-2 border-emerald-400 pl-3 text-emerald-900"><strong>Organizer:</strong> {request.response}</p>}</li>)}</ul></section>}
    </div>
  </details>;
}
