'use client'

import { useEffect, useState } from 'react'
import { newRequestId, PlayerRequestError, playerRequest, savedDraft, storeDraft, type ClientPlayerView } from '../sessionClient'
interface PreviewRequest { teamId: string; requestId: string; action: string; value?: string }
export default function PreviewControls({ view, refresh }: { view: ClientPlayerView; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [target, setTarget] = useState('')
  const [hint, setHint] = useState('')
  const [pending, setPending] = useState<PreviewRequest | null>(null)
  const key = `${view.teamId}:preview-control`
  useEffect(() => { setPending(savedDraft<PreviewRequest>(key)) }, [key])
  const run = async (action: string, value?: string) => {
    if (busy) return
    const request = pending || { teamId: view.teamId, requestId: newRequestId(), action, ...(value ? { value } : {}) }
    setBusy(true); setMessage(''); setPending(request); storeDraft(key, request)
    try { await playerRequest('/api/v2/admin/preview', { method: 'POST', body: JSON.stringify(request) }); setPending(null); storeDraft(key, null); await refresh() }
    catch (error) {
      if (error instanceof PlayerRequestError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) { setPending(null); storeDraft(key, null); await refresh(); setMessage(error.message) }
      else setMessage('The simulation needs a result. Retry it before testing another action.')
    }
    finally { setBusy(false) }
  }
  return <section className="mb-5 rounded-2xl border-2 border-violet-500 bg-violet-50 p-4"><h2 className="font-bold text-violet-950">Organizer preview · test team</h2><p className="mt-1 text-sm text-violet-900">This session does not affect real standings.</p><div className="mt-3 flex flex-wrap gap-2">{(['success', 'wrong', 'gps', 'fallback'] as const).map(action => <button key={action} type="button" disabled={busy || !!pending} onClick={() => void run(action)} className="min-h-12 rounded-lg border border-violet-400 bg-white px-3 text-sm font-semibold disabled:opacity-50">{action === 'success' ? 'Simulate success' : action === 'wrong' ? 'Wrong answer' : action === 'gps' ? 'GPS arrival' : 'Try fallback'}</button>)}</div><div className="mt-3 flex gap-2"><select aria-label="Preview hint" value={hint} onChange={event => setHint(event.target.value)} className="min-h-12 min-w-0 flex-1 rounded-lg border p-2"><option value="">Choose hint</option>{view.hints.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><button disabled={busy || !!pending || !hint} type="button" onClick={() => void run('hint', hint)} className="min-h-12 rounded-lg border border-violet-400 bg-white px-3 text-sm font-semibold disabled:opacity-50">Use hint</button></div><div className="mt-3 flex gap-2"><select aria-label="Preview checkpoint" value={target} onChange={event => setTarget(event.target.value)} className="min-h-12 min-w-0 flex-1 rounded-lg border p-2"><option value="">Choose checkpoint</option>{view.checkpoints?.map(checkpoint => <option key={checkpoint.id} value={checkpoint.id}>{checkpoint.title}</option>)}</select><button disabled={busy || !!pending || !target} type="button" onClick={() => void run('jump', target)} className="min-h-12 rounded-lg border border-violet-400 bg-white px-3 text-sm font-semibold disabled:opacity-50">Jump</button></div>{pending && !busy && <button type="button" onClick={() => void run(pending.action, pending.value)} className="mt-3 min-h-12 rounded-lg bg-violet-800 px-4 font-semibold text-white">Retry simulation</button>}{message && <p role="alert" className="mt-3 text-sm text-violet-950">{message}</p>}</section>
}
