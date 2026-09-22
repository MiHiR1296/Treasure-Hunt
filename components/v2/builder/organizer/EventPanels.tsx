'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { actionClass, buttonClass, Field, inputClass } from '../Fields';
import { adminRequest, type HuntStatus, type OperationProps, type PublishedHunt } from './client';
import './print.css';

const statusLabels: Record<HuntStatus, string> = { ready: 'Ready', live: 'Live', paused: 'Paused', ended: 'Ended', archived: 'Archived' };
const transitions: Record<HuntStatus, HuntStatus[]> = { ready: ['live', 'archived'], live: ['paused', 'ended'], paused: ['live', 'ended', 'archived'], ended: ['live', 'archived'], archived: ['ready'] };
const actionLabels: Record<HuntStatus, string> = { ready: 'Restore to ready', live: 'Open for play', paused: 'Pause hunt', ended: 'End event', archived: 'Archive event' };

function PrintQrMaterials({ hunt, origin }: { hunt: PublishedHunt; origin: string }) {
  const entryUrl = `${origin}/v2?hunt=${encodeURIComponent(hunt.id)}`;
  const cards = [
    { id: 'entry', label: `Join ${hunt.title}`, value: entryUrl, instruction: 'Scan to create or join your team.', link: entryUrl, backupCode: '' },
    ...hunt.definition.checkpoints.flatMap(checkpoint => checkpoint.flow.nodes.flatMap(node => node.type === 'verify_qr' ? [{ id: `${checkpoint.id}:${node.id}`, label: checkpoint.title, value: node.token, instruction: 'Scan this code in the treasure hunt when you reach this checkpoint.', link: '', backupCode: node.backupCode || '' }] : [])),
    ...(hunt.definition.dudQrs || []).map((dud, index) => ({ id: `decoy:${index}`, label: 'Mystery marker', value: dud.token, instruction: 'Scan this code in the treasure hunt.', link: '', backupCode: '' })),
  ];
  return <div className="hunt-print-sheet" role="group" aria-label={`QR print materials for ${hunt.title}`}>{cards.map(card => <section key={card.id} className="hunt-print-card"><p className="hunt-print-event">{hunt.title} · Version {hunt.version}</p><h1>{card.label}</h1><div className="hunt-print-code"><QRCodeSVG value={card.value} size={300} marginSize={4} level="M" title={card.label + ' QR'} /></div>{card.backupCode && <p className="hunt-print-backup">Printed backup: <strong>{card.backupCode}</strong></p>}<p className="hunt-print-instruction">{card.instruction}</p>{card.link && <p className="hunt-print-link">{card.link}</p>}</section>)}</div>;
}

export function EventList({ dashboard, pending, run, refresh, notify }: OperationProps) {
  const [confirm, setConfirm] = useState<{ id: string; status?: HuntStatus; remove?: boolean } | null>(null);
  const [deleteText, setDeleteText] = useState('');
  const [preview, setPreview] = useState('');
  const [origin, setOrigin] = useState('');
  const [printHunt, setPrintHunt] = useState<PublishedHunt | null>(null);
  const [printRoot, setPrintRoot] = useState<HTMLElement | null>(null);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    const root = document.createElement('div'); root.id = 'hunt-print-root'; document.body.appendChild(root); setPrintRoot(root);
    return () => { root.remove(); document.body.classList.remove('printing-hunt-qrs'); };
  }, []);
  useEffect(() => {
    if (!printHunt || !printRoot) return;
    document.body.classList.add('printing-hunt-qrs');
    const finished = () => { document.body.classList.remove('printing-hunt-qrs'); setPrintHunt(null); };
    window.addEventListener('afterprint', finished);
    const frame = window.requestAnimationFrame(() => window.print());
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('afterprint', finished); document.body.classList.remove('printing-hunt-qrs'); };
  }, [printHunt, printRoot]);
  function update(id: string, status: HuntStatus) { void run(`status:${id}`, async () => { await adminRequest('/api/v2/admin/hunts', 'PATCH', { huntId: id, status }); setConfirm(null); notify(`Hunt is now ${statusLabels[status].toLowerCase()}.`); await refresh(); }); }
  return <section className="space-y-5">{printRoot && printHunt && createPortal(<PrintQrMaterials hunt={printHunt} origin={origin} />, printRoot)}<div><h2 className="text-2xl font-bold">Published events</h2><p className="mt-2 text-sm text-slate-600">Manage registration and play status. Existing teams keep the definition version they joined.</p></div>
    {preview && <a href={preview} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-lg bg-teal-800 px-4 py-2 font-semibold text-white">Open player preview ↗</a>}
    {dashboard.hunts.map(hunt => <article key={hunt.id} className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-xl font-bold">{hunt.title}</h3><p className="mt-1 text-sm text-slate-600">{hunt.definition.checkpoints.length} checkpoints · Version {hunt.version} · <strong>{statusLabels[hunt.status]}</strong></p><p className="mt-2 font-mono text-xs text-slate-500">{hunt.id}</p></div><div className="flex flex-wrap gap-2"><Link href={`/v2?hunt=${encodeURIComponent(hunt.id)}`} className={buttonClass}>Open player link</Link><button type="button" className={buttonClass} disabled={Boolean(pending)} onClick={() => void run(`preview:${hunt.id}`, async () => { const result = await adminRequest<{ url: string }>('/api/v2/admin/preview', 'POST', { huntId: hunt.id }); setPreview(result.url); notify('A separate player test session is ready.'); await refresh(); })}>Preview as player</button>{transitions[hunt.status].map(status => <button key={status} type="button" className={status === 'live' ? actionClass : buttonClass} disabled={Boolean(pending)} onClick={() => { if (status === 'ended' || status === 'archived') setConfirm({ id: hunt.id, status }); else update(hunt.id, status); }}>{actionLabels[status]}</button>)}</div></div>
      {confirm?.id === hunt.id && <div className="mt-5 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
        {confirm.remove ? <><p className="font-semibold">Permanently delete this event and its teams, sessions, progress, messages, and event photos?</p><p>This cannot be undone. Enter <strong className="font-mono">{hunt.id}</strong> to confirm.</p><input aria-label="Event ID to confirm deletion" className={inputClass} value={deleteText} onChange={event => setDeleteText(event.target.value)} /><button type="button" className="min-h-11 rounded-lg bg-red-700 px-4 py-2 font-semibold text-white disabled:opacity-40" disabled={Boolean(pending) || deleteText !== hunt.id} onClick={() => void run(`delete:${hunt.id}`, async () => { await adminRequest('/api/v2/admin/hunts/delete', 'POST', { huntId: hunt.id, confirmation: deleteText }); setConfirm(null); setDeleteText(''); notify('Event data deleted.'); await refresh(); })}>Delete event data permanently</button></>
          : <><p>{confirm.status === 'ended' ? 'End this event? Players will stop progressing. Saved results remain available, and you can reopen it later.' : 'Archive this event? It will leave the available hunt list. Its saved data remains available.'}</p><button type="button" className={actionClass} disabled={Boolean(pending)} onClick={() => update(hunt.id, confirm.status!)}>Confirm {confirm.status === 'ended' ? 'end event' : 'archive'}</button></>}
        <button type="button" className={`${buttonClass} ml-2`} disabled={Boolean(pending)} onClick={() => { setConfirm(null); setDeleteText(''); }}>Cancel</button>
      </div>}
      <details className="mt-5 border-t border-slate-100 pt-4"><summary className="cursor-pointer py-2 font-semibold text-teal-800">QR materials</summary><button type="button" className={`${buttonClass} mt-3`} disabled={!origin || Boolean(pending)} onClick={() => setPrintHunt(hunt)}>Print QR materials</button><div className="mt-4 flex flex-wrap gap-4">{origin && <div className="rounded-xl border-2 border-teal-700 bg-white p-4"><p className="mb-3 font-semibold">Join {hunt.title}</p><QRCodeSVG value={`${origin}/v2?hunt=${encodeURIComponent(hunt.id)}`} size={180} marginSize={4} title={`Entry QR for ${hunt.title}`} /><p className="mt-3 max-w-60 break-all text-xs">{origin}/v2?hunt={hunt.id}</p></div>}{hunt.definition.checkpoints.flatMap(checkpoint => checkpoint.flow.nodes.flatMap(node => node.type === 'verify_qr' ? [<div key={`${checkpoint.id}:${node.id}`} className="max-w-full rounded-xl border border-slate-200 bg-white p-4"><p className="mb-3 font-semibold">{checkpoint.title}</p><QRCodeSVG value={node.token} size={160} marginSize={4} title={`${checkpoint.title} checkpoint QR`} /><p className="mt-3 max-w-60 break-all font-mono text-xs text-slate-600">{node.token}</p>{node.backupCode && <p className="mt-2 text-sm">Printed backup: <strong className="font-mono">{node.backupCode}</strong></p>}</div>] : []))}{hunt.definition.dudQrs?.map((dud, index) => <div key={dud.token} className="rounded-xl border border-dashed border-amber-300 bg-white p-4"><p className="mb-3 font-semibold">Decoy {index + 1}</p><QRCodeSVG value={dud.token} size={160} marginSize={4} title={`Decoy QR ${index + 1}`} /><p className="mt-3 max-w-60 text-xs">{dud.message}</p></div>)}</div></details>
      {(hunt.status === 'ended' || hunt.status === 'archived') && <details className="mt-4 border-t border-slate-100 pt-3"><summary className="cursor-pointer py-2 text-sm font-semibold text-red-700">Data cleanup</summary><p className="mt-2 text-sm text-slate-600">Delete this event only when you no longer need its team data or results.</p><button type="button" className={`${buttonClass} mt-3`} disabled={Boolean(pending)} onClick={() => { setConfirm({ id: hunt.id, remove: true }); setDeleteText(''); }}>Delete event data…</button></details>}
    </article>)}
    {dashboard.hunts.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-6 text-slate-500">Publish your first draft from Design to create an event.</p>}
  </section>;
}

interface Analytics { teams: number; completed: number; averageScore: number; stalled: { id: string; name: string; lastActivity: string }[]; helpByKind: { kind: string; count: number }[]; checkpoints: { id: string; title: string; completions: number; failures: number; hints: number; averageSeconds: number | null }[] }

export function AnalyticsPanel({ dashboard, active }: { dashboard: OperationProps['dashboard']; active: boolean }) {
  const [huntId, setHuntId] = useState(''); const [data, setData] = useState<Analytics | null>(null); const [error, setError] = useState(''); const [reload, setReload] = useState(0);
  const selected = huntId || dashboard.hunts[0]?.id || '';
  useEffect(() => {
    if (!active || !selected) return; let cancelled = false; setData(null); setError('');
    void adminRequest<Analytics>(`/api/v2/admin/analytics?huntId=${encodeURIComponent(selected)}`).then(result => { if (!cancelled) setData(result); }).catch(failure => { if (!cancelled) setError(failure instanceof Error ? failure.message : 'Could not load analytics.'); });
    return () => { cancelled = true; };
  }, [active, selected, reload]);
  return <section className="space-y-5"><h2 className="text-2xl font-bold">Event insights</h2><div className="flex flex-wrap items-end gap-3"><Field label="Hunt"><select className={inputClass} value={selected} onChange={event => setHuntId(event.target.value)}>{dashboard.hunts.map(hunt => <option key={hunt.id} value={hunt.id}>{hunt.title}</option>)}</select></Field><button type="button" className={buttonClass} onClick={() => setReload(value => value + 1)}>Refresh insights</button></div>
    {error && <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-950">{error}</p>}
    {selected && !data && !error && <p role="status" className="text-slate-500">Loading event insights…</p>}
    {data && <><div className="grid gap-4 sm:grid-cols-3">{[{ label: 'Teams', value: data.teams }, { label: 'Finished', value: data.completed }, { label: 'Average score', value: data.averageScore.toFixed(1) }].map(item => <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">{item.label}</p><p className="mt-2 text-3xl font-bold">{item.value}</p></div>)}</div><p className="text-xs text-slate-500">Preview sessions are excluded from these results.</p>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full text-left text-sm"><caption className="p-4 text-left font-bold">Checkpoint health</caption><thead className="bg-slate-50"><tr>{['Checkpoint','Completions','Wrong attempts','Hints used','Average completion time'].map(label => <th key={label} className="p-3 font-semibold">{label}</th>)}</tr></thead><tbody>{data.checkpoints.map(checkpoint => <tr key={checkpoint.id} className="border-t border-slate-100"><th className="p-3 font-medium">{checkpoint.title}</th><td className="p-3">{checkpoint.completions}</td><td className="p-3">{checkpoint.failures}</td><td className="p-3">{checkpoint.hints}</td><td className="p-3">{checkpoint.averageSeconds === null ? '—' : `${Math.round(checkpoint.averageSeconds / 60)} min`}</td></tr>)}</tbody></table></div>
      <div className="grid gap-4 md:grid-cols-2"><section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-bold">Teams inactive for 10+ minutes</h3><ul className="mt-3 space-y-2 text-sm">{data.stalled.map(team => <li key={team.id}>{team.name}<span className="block text-xs text-slate-500">Last activity {new Date(team.lastActivity).toLocaleString()}</span></li>)}</ul>{!data.stalled.length && <p className="mt-3 text-sm text-slate-500">No stalled teams.</p>}</section><section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-bold">Open help by category</h3><ul className="mt-3 space-y-2 text-sm">{data.helpByKind.map(item => <li key={item.kind}>{item.kind}: {item.count}</li>)}</ul>{!data.helpByKind.length && <p className="mt-3 text-sm text-slate-500">No open help requests.</p>}</section></div>
    </>}
  </section>;
}
