/* eslint-disable @next/next/no-img-element -- The optional public cover is an organizer-controlled event asset. */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDuration, V3RequestError, v3Request } from './api';
import type { PublicBoardRow, PublicBoardView } from './types';

function hasField<K extends keyof PublicBoardRow>(rows: PublicBoardRow[], field: K) {
  return rows.some(row => row[field] !== undefined);
}

function BoardTable({ rows, columns }: { rows: PublicBoardRow[]; columns: string[] }) {
  const configured = new Set(columns);
  const showRank = configured.has('rank');
  const showTeamCode = configured.has('team_code');
  const showTeamName = configured.has('team_name') && hasField(rows, 'teamName');
  const showPoints = hasField(rows, 'points');
  const showProgress = hasField(rows, 'progress');
  const showRuns = hasField(rows, 'runs');
  const showTime = hasField(rows, 'elapsedMilliseconds');
  const showStatus = hasField(rows, 'status');
  if (!rows.length) return <div className="rounded-3xl border border-dashed border-white/25 bg-white/5 px-6 py-16 text-center text-emerald-50/70"><span aria-hidden="true" className="text-4xl">⌛</span><p className="mt-3 font-bold">Registered teams will appear here.</p></div>;
  return <>
    <div className="space-y-3 sm:hidden">
      {rows.map((row, index) => {
        const identity = [showTeamCode ? row.teamCode : undefined, showTeamName ? row.teamName : undefined].filter(Boolean).join(' · ') || `Team ${index + 1}`;
        return <article key={`${row.teamCode ?? row.rank ?? 'row'}:${index}`} aria-label={`Leaderboard result for ${identity}`} className="rounded-3xl border border-white/15 bg-white/[0.07] p-5 shadow-2xl backdrop-blur-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">{showTeamCode && <p className="font-mono text-xs font-black tracking-[0.12em] text-emerald-200">{row.teamCode}</p>}{showTeamName && row.teamName && <p className="mt-1 break-words text-xl font-black text-white">{row.teamName}</p>}</div>
            {showRank && <p className="shrink-0 text-3xl font-black tabular-nums text-emerald-200">#{row.rank}</p>}
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
            {showPoints && <div className="rounded-2xl bg-white/[0.06] p-3"><dt className="text-xs font-bold uppercase tracking-wider text-emerald-100/60">Points</dt><dd className="mt-1 text-2xl font-black tabular-nums text-white">{row.points ?? '—'}</dd></div>}
            {showProgress && <div className="rounded-2xl bg-white/[0.06] p-3"><dt className="text-xs font-bold uppercase tracking-wider text-emerald-100/60">Progress</dt><dd className="mt-1 font-black tabular-nums text-white">{row.progress ? `${row.progress.completed}/${row.progress.total}` : '—'}</dd></div>}
            {showRuns && <div className="rounded-2xl bg-white/[0.06] p-3"><dt className="text-xs font-bold uppercase tracking-wider text-emerald-100/60">Runs</dt><dd className="mt-1 font-black tabular-nums text-white">{row.runs ?? '—'}</dd></div>}
            {showTime && <div className="rounded-2xl bg-white/[0.06] p-3"><dt className="text-xs font-bold uppercase tracking-wider text-emerald-100/60">Time</dt><dd className="mt-1 font-mono font-black tabular-nums text-white">{formatDuration(row.elapsedMilliseconds)}</dd></div>}
            {showStatus && <div className="col-span-2 rounded-2xl bg-white/[0.06] p-3"><dt className="text-xs font-bold uppercase tracking-wider text-emerald-100/60">Status</dt><dd className="mt-1 font-black capitalize text-white">{row.status ?? '—'}</dd></div>}
          </dl>
        </article>;
      })}
    </div>
    <div className="hidden overflow-x-auto rounded-3xl border border-white/15 bg-white/[0.07] shadow-2xl backdrop-blur-sm sm:block">
    <table className="w-full min-w-[38rem] text-left">
      <thead className="border-b border-white/15 text-xs uppercase tracking-[0.16em] text-emerald-100/65"><tr>{showRank && <th className="px-5 py-4 sm:px-7">Rank</th>}{(showTeamCode || showTeamName) && <th className="px-5 py-4 sm:px-7">Team</th>}{showPoints && <th className="px-5 py-4 text-right sm:px-7">Points</th>}{showProgress && <th className="px-5 py-4 text-right sm:px-7">Progress</th>}{showRuns && <th className="px-5 py-4 text-right sm:px-7">Runs</th>}{showTime && <th className="px-5 py-4 text-right sm:px-7">Time</th>}{showStatus && <th className="px-5 py-4 text-right sm:px-7">Status</th>}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={`${row.teamCode ?? row.rank ?? 'row'}:${index}`} className="border-b border-white/10 last:border-0">
        {showRank && <td className="px-5 py-5 text-2xl font-black tabular-nums text-emerald-200 sm:px-7">#{row.rank}</td>}
        {(showTeamCode || showTeamName) && <td className="px-5 py-5 sm:px-7">{showTeamCode && <span className="font-mono text-xs font-black tracking-[0.12em] text-emerald-200">{row.teamCode}</span>}{showTeamName && row.teamName && <span className={`${showTeamCode ? 'ml-2' : ''} text-lg font-bold text-white`}>{showTeamCode ? '· ' : ''}{row.teamName}</span>}</td>}
        {showPoints && <td className="px-5 py-5 text-right text-2xl font-black tabular-nums text-white sm:px-7">{row.points ?? '—'}</td>}
        {showProgress && <td className="px-5 py-5 text-right font-bold tabular-nums text-emerald-50 sm:px-7">{row.progress ? `${row.progress.completed}/${row.progress.total}` : '—'}</td>}
        {showRuns && <td className="px-5 py-5 text-right font-bold tabular-nums text-emerald-50 sm:px-7">{row.runs ?? '—'}</td>}
        {showTime && <td className="px-5 py-5 text-right font-mono font-bold tabular-nums text-emerald-50 sm:px-7">{formatDuration(row.elapsedMilliseconds)}</td>}
        {showStatus && <td className="px-5 py-5 text-right text-sm font-bold capitalize text-emerald-50 sm:px-7">{row.status ?? '—'}</td>}
      </tr>)}</tbody>
    </table>
    </div>
  </>;
}

export default function PublicBoard({ slug }: { slug: string }) {
  const [board, setBoard] = useState<PublicBoardView | null>(null);
  const [tab, setTab] = useState<'main' | 'replay'>('main');
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const reading = useRef(false);
  const read = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      const next = await v3Request<PublicBoardView>(`/api/v3/public-board/${encodeURIComponent(slug)}`);
      setBoard(next); setError(''); setStale(false);
    } catch (requestError) {
      const message = requestError instanceof V3RequestError ? requestError.message : 'The event board could not be loaded.';
      setStale(true);
      setError(message);
    } finally { reading.current = false; }
  }, [slug]);

  useEffect(() => {
    let live = true;
    const update = async () => { if (live && document.visibilityState === 'visible') await read(); };
    void update();
    const timer = window.setInterval(() => void update(), 5000);
    const visibility = () => { if (document.visibilityState === 'visible') void update(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { live = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [read]);

  const mainRows = useMemo(() => board?.main ?? board?.rows ?? [], [board]);
  const replayRows = board?.replay ?? [];
  const showReplay = replayRows.length > 0;
  useEffect(() => {
    if (board && mainRows.length === 0 && replayRows.length > 0) setTab('replay');
  }, [board, mainRows.length, replayRows.length]);
  const rows = tab === 'replay' && showReplay ? replayRows : mainRows;

  return <main className="min-h-screen bg-[#052e28] bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.28),transparent_40%),radial-gradient(circle_at_bottom_left,rgba(16,185,129,0.22),transparent_35%)] px-4 py-7 text-white sm:px-8 sm:py-10">
    <div className="mx-auto max-w-7xl">
      {!board ? error ? <div className="mx-auto mt-20 max-w-lg rounded-3xl bg-white p-7 text-center text-stone-900"><h1 className="text-2xl font-black">Board unavailable</h1><p className="mt-3 text-sm text-stone-600">{error}</p><button type="button" onClick={() => void read()} className="mt-5 min-h-12 rounded-2xl bg-emerald-950 px-5 py-3 font-bold text-white">Try again</button></div> : <p role="status" className="pt-24 text-center text-emerald-100">Loading live standings…</p> : <>
        <header className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.16em] ${board.status === 'live' ? 'bg-emerald-300 text-emerald-950' : board.status === 'final' ? 'bg-amber-300 text-amber-950' : 'bg-violet-300 text-violet-950'}`}>{board.status}</span>{board.frozen && <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white">Snapshot</span>}</div>
            <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-6xl">{board.title}</h1>
            <p className="mt-3 text-sm text-emerald-100/70">{board.status === 'final' ? 'One best completed run per team' : 'Best completed result · live progress while crews play'} · score first, time settles ties</p>
          </div>
          <div className="text-left text-xs text-emerald-100/60 sm:text-right"><p>{stale ? 'Connection interrupted · showing last standings' : board.status === 'live' ? 'Updates every 5 seconds while this screen is visible' : 'Organizer-controlled event result'}</p><p className="mt-1 tabular-nums">Updated {new Date(board.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p></div>
        </header>
        {typeof board.cover === 'string' && board.cover && <img src={board.cover} alt="" className="mb-7 max-h-64 w-full rounded-3xl object-cover" />}
        {showReplay && <div className="mb-5 inline-flex rounded-2xl bg-white/10 p-1.5">
          <button type="button" onClick={() => setTab('main')} aria-pressed={tab === 'main'} className={`min-h-11 rounded-xl px-5 text-sm font-bold ${tab === 'main' ? 'bg-white text-emerald-950' : 'text-white'}`}>Main scoreboard</button>
          <button type="button" onClick={() => setTab('replay')} aria-pressed={tab === 'replay'} className={`min-h-11 rounded-xl px-5 text-sm font-bold ${tab === 'replay' ? 'bg-white text-violet-950' : 'text-white'}`}>Replay board</button>
        </div>}
        <BoardTable rows={rows} columns={board.columns || []} />
        <footer className="mt-7 flex flex-wrap items-center justify-between gap-3 text-xs text-emerald-100/55"><span>Treasure Hunt V3</span><span>Team results only · player names and private recognition stay private</span></footer>
      </>}
    </div>
  </main>;
}
