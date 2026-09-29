'use client';
import { useEffect, useState } from 'react';
import type { listResults, resultActivity, resultBatch, resultHistory, resultManifest, teamResult } from '@/lib/server/results';
import { resultsCsv } from '@/lib/engine/reporting';
import { buttonClass, Field, inputClass } from '../Fields';
import { adminRequest, type OperationProps } from './client';
import { TeamControls } from './TeamOperations';

type Page = Awaited<ReturnType<typeof listResults>>;
type Report = Awaited<ReturnType<typeof teamResult>>;
type Activity = Awaited<ReturnType<typeof resultActivity>>;
const date = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Not recorded';
function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type })), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ResultsPanel({ dashboard, pending, run, refresh, notify }: OperationProps) {
  const [huntId, setHuntId] = useState(dashboard.hunts[0]?.id ?? '');
  const [page, setPage] = useState<Page | null>(null), [problem, setProblem] = useState('');
  const [report, setReport] = useState<Report | null>(null), [activity, setActivity] = useState<Activity | null>(null);
  const [entries, setEntries] = useState<Activity['entries']>([]);
  useEffect(() => {
    let active = true; setPage(null); setReport(null); setProblem('');
    if (huntId) void adminRequest<Page>(`/api/v2/admin/results?huntId=${encodeURIComponent(huntId)}`).then(result => { if (active) setPage(result); }).catch(error => { if (active) setProblem(error.message); });
    return () => { active = false; };
  }, [huntId]);
  const activityUrl = (value: Report, cursor?: Activity['next']) => `/api/v2/admin/results?teamId=${value.summary.id}&section=activity&throughRevision=${value.summary.revision}${cursor ? `&afterRevision=${cursor.revision}&afterOrdinal=${cursor.ordinal}` : ''}`;
  async function inspect(id: string) {
    const value = await adminRequest<Report>(`/api/v2/admin/results?teamId=${id}`);
    const events = await adminRequest<Activity>(activityUrl(value));
    setReport(value); setActivity(events); setEntries(events.entries);
  }
  async function exportSummaries() {
    const manifest = await adminRequest<Awaited<ReturnType<typeof resultManifest>>>(`/api/v2/admin/results?huntId=${encodeURIComponent(huntId)}&manifest=1`);
    const all: Page['teams'] = [];
    for (let offset = 0; offset < manifest.ids.length; offset += 50) {
      const result = await adminRequest<Awaited<ReturnType<typeof resultBatch>>>('/api/v2/admin/results', 'POST', { huntId, ids: manifest.ids.slice(offset, offset + 50), asOf: manifest.asOf }); all.push(...result.teams);
    }
    download(`${huntId}-results.csv`, resultsCsv(all), 'text/csv;charset=utf-8');
    notify(`Exported ${all.length} teams. Each row identifies its state revision; this is not an official winner declaration.`);
  }
  async function exportTeam(value: Report) {
    let chunk = await adminRequest<Activity>(activityUrl(value)); const audit = [...chunk.entries];
    while (chunk.next) { chunk = await adminRequest<Activity>(activityUrl(value, chunk.next)); audit.push(...chunk.entries); }
    async function history(section: 'events' | 'ledger' | 'help') {
      let offset: number | null = 0; const all: Awaited<ReturnType<typeof resultHistory>>['entries'] = [];
      do {
        const part: Awaited<ReturnType<typeof resultHistory>> = await adminRequest(`/api/v2/admin/results?teamId=${value.summary.id}&section=${section}&throughRevision=${value.summary.revision}&count=${value.counts[section]}&offset=${offset}&asOf=${encodeURIComponent(value.measuredAt)}`);
        all.push(...part.entries); offset = part.next;
      } while (offset !== null);
      return all;
    }
    const events = await history('events'), ledger = await history('ledger'), help = await history('help');
    download(`${value.summary.id}-revision-${value.summary.revision}.json`, JSON.stringify({ ...value, team: { ...value.team, events, ledger }, help, audit, notes: 'Engine snapshot through the specified team revision and entry counts. Help replies reflect export read time for requests present at the cutoff. Older uncaptured measurements cannot be reconstructed. Declared names are not verified identities. Photo bytes follow the retention policy.' }, null, 2), 'application/json');
    notify(`Exported the complete recorded history through team revision ${value.summary.revision}.`);
  }
  return <section className="space-y-5">
    <h2 className="text-2xl font-bold">Results & organizer review</h2>
    <p className="text-sm leading-6 text-slate-600">All live teams are available here, including incomplete and expired teams. Review status is private and does not change points, public standings, or declare winners.</p>
    <p className="text-xs text-slate-600">Exports contain private rosters and recorded player evidence, not configured hunt solutions, QR secrets or GPS targets. Store downloaded records securely.</p>
    <div className="flex flex-wrap items-end gap-3"><Field label="Results hunt"><select className={inputClass} value={huntId} disabled={Boolean(pending)} onChange={event => setHuntId(event.target.value)}>{dashboard.hunts.map(hunt => <option key={hunt.id} value={hunt.id}>{hunt.title}</option>)}</select></Field><button className={buttonClass} disabled={Boolean(pending) || !huntId} onClick={() => void run('export-results', exportSummaries)}>Export all team summaries (CSV)</button><button className={buttonClass} disabled={Boolean(pending) || !huntId} onClick={() => void run('refresh-results', async () => { setPage(await adminRequest<Page>(`/api/v2/admin/results?huntId=${encodeURIComponent(huntId)}`)); })}>Refresh results</button></div>
    {problem && <p role="alert" className="text-red-800">{problem}</p>}
    <div className="grid gap-3 md:grid-cols-2">{page?.teams.map(team => <article key={team.id} className="space-y-2 rounded-xl border bg-white p-4"><div className="flex justify-between gap-3"><h3 className="font-bold">{team.name}</h3><strong>{team.score} pts</strong></div><p className="text-sm">{team.status} · v{team.version} · {team.completed} completed / {team.skipped} skipped · {team.hints} hints</p><p className="text-xs text-slate-600">Start: {date(team.startedAt)}<br />Deadline: {date(team.deadlineAt)}<br />Required finish: {date(team.completedAt)}</p><p className="text-sm">Review: {team.review?.status ?? 'pending'}{team.reviewOutdated ? ' — outdated; team changed' : ''}</p><button className={buttonClass} disabled={Boolean(pending)} onClick={() => void run('inspect-result', () => inspect(team.id))}>Inspect result: {team.name}</button></article>)}</div>
    {page?.next && <button className={buttonClass} disabled={Boolean(pending)} onClick={() => void run('more-results', async () => { const next = await adminRequest<Page>(`/api/v2/admin/results?huntId=${encodeURIComponent(huntId)}&asOf=${encodeURIComponent(page.asOf)}&after=${page.next}`); setPage({ ...next, teams: [...page.teams, ...next.teams] }); })}>Load more teams</button>}
    {page && !page.teams.length && <p>No live teams have registered in this hunt.</p>}
    {report && <article aria-label="Detailed team result" className="space-y-5 rounded-xl border border-teal-300 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xl font-bold">{report.summary.name} · revision {report.summary.revision}</h3><button className={buttonClass} disabled={Boolean(pending)} onClick={() => void run('export-team', () => exportTeam(report))}>Export complete team record (JSON)</button></div>
      <p className="text-sm">Snapshot: {date(report.measuredAt)}. Elapsed time excludes recorded organizer pauses, not extensions. Reopened/optional play and interventions remain visible.</p>
      <div className="grid gap-4 sm:grid-cols-2"><div><h4 className="font-bold">Starting roster</h4><p>{report.startingRoster?.map(member => member.name).join(', ') ?? (report.team.view.status === 'waiting' ? 'Captured when this team starts.' : 'Not captured for this older session.')}</p><h4 className="mt-3 font-bold">Current declared roster</h4><p>{report.members.map(member => member.name).join(', ')}</p></div><div><h4 className="font-bold">Timer & review</h4><p>Elapsed: {report.summary.elapsedSeconds === null ? 'not started' : `${report.summary.elapsedSeconds} seconds`}</p><p>Review: {report.review?.status ?? 'pending'}{report.summary.reviewOutdated ? ' (outdated)' : ''}</p>{report.review && <p className="text-sm">{report.review.reviewer} · {date(report.review.at)} · {report.review.note}</p>}{report.timer?.extensions.map((item, i) => <p key={i} className="mt-2 text-sm">+{item.seconds / 60} minutes at {date(item.at)}: {item.reason}<br />Deadline: {date(item.previousDeadline)} → {date(item.deadlineAt)}</p>)}{report.timer?.pauses.map((item, i) => <p key={i} className="mt-2 text-sm">Pause: {date(item.startedAt)} → {item.endedAt ? date(item.endedAt) : 'still paused'}</p>)}</div></div>
      <details><summary className="cursor-pointer py-2 font-bold">Stored route assignments</summary>{report.assignments ? <ul className="space-y-2 text-sm">{report.assignments.map(item => <li key={`${item.checkpointId}:${item.nodeId}`}>{item.checkpointId} / {item.nodeId}: route {item.choiceIndex + 1} → {item.nextNodeId} · algorithm {item.algorithmVersion} · {item.source} · {date(item.assignedAt)}</li>)}</ul> : <p>Legacy deterministic routes have not yet been materialized for this team.</p>}</details>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-3 text-left font-bold">Checkpoint timing — not proof of physical location</caption><thead><tr>{['Checkpoint', 'Status', 'Wall seconds', 'Excluding pauses', 'Selected seconds', 'Visits', 'Failures', 'Hint purchases'].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{report.checkpoints.map(cp => <tr key={cp.id} className="border-t"><td className="p-2">{report.team.definition.checkpoints.find(item => item.id === cp.id)?.title ?? cp.id}</td>{[cp.status, cp.wallSeconds, cp.elapsedSeconds, cp.selectedSeconds, cp.visits, cp.failures, cp.purchases].map((value, i) => <td className="p-2" key={i}>{value ?? 'Not recorded'}</td>)}</tr>)}</tbody></table></div>
      <p className="text-xs text-slate-600">Wall time describes the latest recorded checkpoint attempt. Selected time totals recorded visits, excluding pauses; it may include earlier attempts. Neither measures time physically spent at a location. Missing older measurements are marked “Not recorded”.</p>
      <div><h4 className="font-bold">Score breakdown</h4><dl className="mt-2 grid gap-2 sm:grid-cols-2">{Object.entries(report.team.ledgerTotals).map(([kind, total]) => <div key={kind} className="flex justify-between gap-3 rounded bg-slate-50 p-2 text-sm"><dt>{kind.replaceAll('_', ' ')}</dt><dd>{total} pts</dd></div>)}</dl><p className="mt-2 text-sm font-bold">Total: {report.summary.score} points</p></div>
      <TeamControls team={report.team} pending={pending} run={run} refresh={async () => { await refresh(); await inspect(report.summary.id); setPage(await adminRequest<Page>(`/api/v2/admin/results?huntId=${encodeURIComponent(huntId)}`)); }} notify={notify} />
      <details><summary className="cursor-pointer py-2 font-bold">Checkpoint answers, ledger, and original engine events</summary><p className="text-sm">The complete JSON export includes every retained node, discovery, recorded answer, score entry and event. The Live operations inspector also provides a formatted private-solutions view.</p><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-3 text-xs">{JSON.stringify({ checkpoints: report.team.checkpoints, ledger: report.team.ledger, events: report.team.events }, null, 2)}</pre></details>
      <p className="text-xs text-slate-600">Inspector: latest 100 engine events and ledger entries (plus active hint charges), and first 100 help requests. Full recorded totals: {report.counts.events} events, {report.counts.ledger} ledger entries, {report.counts.help} help requests. Export retrieves every page without truncation.</p>
      <details><summary className="cursor-pointer py-2 font-bold">Help requests & replies ({report.help.length} shown)</summary>{report.help.map(item => <p key={item.id} className="py-2 text-sm">{date(item.created_at)} · {item.kind}: {item.message}<br />{item.response ?? 'No reply yet'} · {item.status}</p>)}</details>
      <h4 className="font-bold">Recorded activity & submitted answers</h4><p className="text-xs text-slate-600">Detailed capture began {date(report.activityCoverage.first_at)}. Older uncaptured values are unavailable. Answers are captured only for steps with recording enabled; the latest-20 display cache is not the export limit.</p>
      <ol className="max-h-[32rem] space-y-3 overflow-auto">{entries.map(item => <li key={`${item.revision}:${item.ordinal}`} className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{item.type.replaceAll('_', ' ')}</strong> · {date(item.at)}<p className="text-xs">Revision {item.revision} · {item.actor.declaredName ?? item.actor.role}</p><pre className="mt-1 whitespace-pre-wrap break-all text-xs">{JSON.stringify(item.details, null, 2)}</pre>{typeof item.details.mediaId === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item.details.mediaId) && <p><a className="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={`/api/v2/media/${item.details.mediaId}`} target="_blank" rel="noreferrer">Open private photo evidence</a><span className="block text-xs text-slate-600">Available only while the configured retention policy keeps this photo. Submission and review records remain after deletion.</span></p>}</li>)}</ol>
      {activity?.next && <button className={buttonClass} disabled={Boolean(pending)} onClick={() => void run('more-activity', async () => { const next = await adminRequest<Activity>(activityUrl(report, activity.next)); setEntries(previous => [...previous, ...next.entries]); setActivity(next); })}>Load more recorded activity</button>}
    </article>}
  </section>;
}
