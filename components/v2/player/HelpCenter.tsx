'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { newRequestId, PlayerRequestError, playerRequest, savedDraft, storeDraft } from '../sessionClient'

type HelpKind = 'help' | 'camera' | 'gps' | 'network' | 'puzzle' | 'photo'
interface HelpRequest { requestId: string; teamId: string; kind: HelpKind; message: string; checkpointId?: string; nodeId?: string }
interface HelpData { help: { id: string; kind: string; message: string; status: string; response?: string; created_at: string }[]; messages: { id: string; message: string; created_at: string }[] }

export default function HelpCenter({ teamId, checkpointId, nodeId, disabled }: { teamId: string; checkpointId?: string; nodeId?: string; disabled: boolean }) {
  const key = `${teamId}:help`
  const [data, setData] = useState<HelpData>({ help: [], messages: [] })
  const [kind, setKind] = useState<HelpKind>('help')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState<HelpRequest | null>(null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => { try { setData(await playerRequest<HelpData>('/api/v2/help')) } catch { /* Keep previous organizer responses visible offline. */ } }, [])
  useEffect(() => {
    setPending(savedDraft<HelpRequest>(key)); void refresh()
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 8000)
    return () => window.clearInterval(timer)
  }, [key, refresh])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || disabled || (!pending && !message.trim())) return
    const request = pending || { requestId: newRequestId(), teamId, kind, message: message.trim(), ...(checkpointId ? { checkpointId } : {}), ...(nodeId ? { nodeId } : {}) }
    setBusy(true); setPending(request); storeDraft(key, request); setStatus('Sending your request…')
    try {
      await playerRequest('/api/v2/help', { method: 'POST', body: JSON.stringify(request) })
      setPending(null); storeDraft(key, null); setMessage(''); setStatus('Your organizer has your request. Their reply will appear here.'); await refresh()
    } catch (error) {
      if (error instanceof PlayerRequestError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) { setPending(null); storeDraft(key, null); setStatus(error.message) }
      else setStatus('Your request needs a result. Retry it safely when your connection returns.')
    } finally { setBusy(false) }
  }
  return <div className="space-y-4">
    {data.messages.length > 0 && <section aria-label="Organizer messages" className="rounded-2xl border border-sky-200 bg-sky-50 p-4"><h2 className="font-semibold">From your organizer</h2>{data.messages.slice(0, 5).map(item => <p key={item.id} className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{item.message}</p>)}</section>}
    <details className="rounded-2xl border border-stone-200 bg-white p-4 text-sm"><summary className="min-h-12 cursor-pointer py-3 font-semibold">Need help? Contact your organizer</summary>
      <p className="mb-4 leading-relaxed text-stone-600">Missing code, blocked permissions, or a puzzle problem? Your organizer can help your team continue remotely.</p>
      <form onSubmit={submit} className="space-y-3"><label className="block font-semibold">What went wrong?<select value={kind} disabled={disabled || busy || !!pending} onChange={event => setKind(event.target.value as HelpKind)} className="mt-2 min-h-12 w-full rounded-lg border border-stone-300 bg-white p-3">{(['help', 'camera', 'gps', 'network', 'puzzle', 'photo'] as const).map(value => <option key={value} value={value}>{value === 'help' ? 'I need assistance' : `${value.toUpperCase()} problem`}</option>)}</select></label><label className="block font-semibold">Tell the organizer<textarea value={pending?.message || message} disabled={disabled || busy || !!pending} onChange={event => setMessage(event.target.value)} maxLength={1000} rows={3} className="mt-2 w-full rounded-lg border border-stone-300 p-3" /></label><button type="submit" disabled={disabled || busy || (!pending && !message.trim())} className="hunt-action min-h-12 w-full rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Sending…' : pending ? 'Retry help request' : 'Send help request'}</button></form>
      {status && <p role="status" className="mt-3 leading-relaxed">{status}</p>}
      {data.help.length > 0 && <ul className="mt-4 space-y-3">{data.help.slice(0, 10).map(item => <li key={item.id} className="rounded-lg bg-stone-50 p-3"><p className="font-semibold">{item.status === 'resolved' ? 'Resolved' : 'Sent to organizer'}</p><p className="mt-1">{item.message}</p>{item.response && <p className="mt-2 whitespace-pre-wrap font-medium text-emerald-900">Reply: {item.response}</p>}</li>)}</ul>}
    </details>
  </div>
}
