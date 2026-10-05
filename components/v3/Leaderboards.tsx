'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDuration, v3Request } from './api';
import type { MainLeaderboardEntry, ReplayLeaderboardEntry, TeamLeaderboards } from './types';
import { cardStyle } from './ui';

export function useTeamLeaderboards(revision = 0, enabled = true) {
  const [data, setData] = useState<TeamLeaderboards | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const next = await v3Request<TeamLeaderboards>('/api/v3/leaderboard');
      setData(next);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const read = async () => {
      try {
        const next = await v3Request<TeamLeaderboards>('/api/v3/leaderboard');
        if (live) { setData(next); setFailed(false); }
      } catch { if (live) setFailed(true); }
    };
    void read();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void read();
    }, 15_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [revision, enabled]);

  return { data, failed, refresh };
}

function TeamName({ entry }: { entry: MainLeaderboardEntry }) {
  return <span><span className="font-mono text-xs font-black tracking-wide text-emerald-900">{entry.teamCode}</span>{entry.teamName ? <span> · {entry.teamName}</span> : null}{entry.provisional ? <span className="ml-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-amber-900">{entry.status}</span> : null}{entry.isOwnTeam ? <span className="sr-only">, your team</span> : null}</span>;
}

function MainBoard({ entries }: { entries: MainLeaderboardEntry[] }) {
  if (!entries.length) return <p className="py-6 text-center text-sm text-stone-500">Registered teams will appear here.</p>;
  const showTime = entries.some(entry => entry.visibleElapsedMilliseconds !== undefined);
  return <div className="overflow-x-auto">
    <table className="w-full min-w-[28rem] text-left text-sm">
      <thead className="text-xs uppercase tracking-wide text-stone-500"><tr><th className="pb-3 pr-3">Rank</th><th className="pb-3 pr-3">Team</th><th className="pb-3 pr-3 text-right">Points</th><th className="pb-3 text-right">Progress</th>{showTime && <th className="pb-3 pl-3 text-right">Time</th>}</tr></thead>
      <tbody>{entries.map(entry => <tr key={entry.teamCode} className={`border-t border-stone-100 ${entry.isOwnTeam ? 'bg-emerald-50/80 font-bold' : ''}`}>
        <td className="py-3 pr-3 font-black">#{entry.rank}</td>
        <td className="py-3 pr-3"><TeamName entry={entry} /></td>
        <td className="py-3 pr-3 text-right tabular-nums">{entry.score}</td>
        <td className="py-3 text-right tabular-nums">{entry.progress ? `${entry.progress.completed}/${entry.progress.total}` : '—'}</td>
        {showTime && <td className="py-3 pl-3 text-right font-mono tabular-nums">{entry.visibleElapsedMilliseconds === undefined ? '—' : formatDuration(entry.visibleElapsedMilliseconds)}</td>}
      </tr>)}</tbody>
    </table>
  </div>;
}

function ReplayBoard({ entries }: { entries: ReplayLeaderboardEntry[] }) {
  if (!entries.length) return <p className="py-6 text-center text-sm text-stone-500">Complete another scored run to join the replay board.</p>;
  return <div className="overflow-x-auto">
    <table className="w-full min-w-[38rem] text-left text-sm">
      <thead className="text-xs uppercase tracking-wide text-stone-500"><tr><th className="pb-3 pr-3">Rank</th><th className="pb-3 pr-3">Team</th><th className="pb-3 pr-3 text-right">Best</th><th className="pb-3 pr-3 text-right">Time</th><th className="pb-3 text-right">Lift</th></tr></thead>
      <tbody>{entries.map(entry => <tr key={entry.teamCode} className={`border-t border-stone-100 ${entry.isOwnTeam ? 'bg-violet-50/80 font-bold' : ''}`}>
        <td className="py-3 pr-3 font-black">#{entry.rank}</td>
        <td className="py-3 pr-3"><TeamName entry={entry} /><span className="mt-0.5 block text-xs font-normal text-stone-500">{entry.runCount} runs</span></td>
        <td className="py-3 pr-3 text-right tabular-nums">{entry.score} pts</td>
        <td className="py-3 pr-3 text-right font-mono tabular-nums">{formatDuration(entry.bestElapsedMilliseconds)}</td>
        <td className="py-3 text-right text-emerald-800">{entry.scoreImprovementFromFirst > 0 ? `+${entry.scoreImprovementFromFirst} pts` : entry.timeImprovementFromFirstMilliseconds > 0 ? `−${formatDuration(entry.timeImprovementFromFirstMilliseconds)}` : '—'}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export default function Leaderboards({ board, failed, defaultTab = 'main' }: {
  board: TeamLeaderboards | null;
  failed?: boolean;
  defaultTab?: 'main' | 'replay';
}) {
  const [tab, setTab] = useState<'main' | 'replay'>(defaultTab);
  useEffect(() => {
    if (!board) return;
    if (!board.main.visible && board.replay.enabled) setTab('replay');
    else if (!board.replay.enabled && board.main.visible) setTab('main');
  }, [board]);
  if (!board) return failed ? <p className="rounded-2xl border border-stone-200 bg-white p-4 text-sm text-stone-500">Standings will return when your connection improves.</p> : <div role="status" className="rounded-2xl border border-stone-200 bg-white p-5 text-sm text-stone-500">Loading the leaderboard…</div>;
  if (!board.main.visible && !board.replay.enabled) return null;
  const showTabs = board.main.visible && board.replay.enabled;
  const activeTab = tab === 'replay' && board.replay.enabled ? 'replay' : board.main.visible ? 'main' : 'replay';
  return <section className={cardStyle} aria-labelledby="v3-leaderboard-heading">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-xs font-extrabold uppercase tracking-[0.18em] text-emerald-800">Best results, with live progress while crews play</p><h2 id="v3-leaderboard-heading" className="mt-1 text-2xl font-black tracking-tight">Leaderboard</h2></div>
      {failed && <span className="text-xs text-amber-700">Showing the last update</span>}
    </div>
    {showTabs && <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-stone-100 p-1.5">
      <button type="button" aria-pressed={tab === 'main'} onClick={() => setTab('main')} className={`min-h-11 rounded-xl px-3 text-sm font-bold ${tab === 'main' ? 'bg-white text-emerald-950 shadow-sm' : 'text-stone-600'}`}>Main scoreboard</button>
      <button type="button" aria-pressed={tab === 'replay'} onClick={() => setTab('replay')} className={`min-h-11 rounded-xl px-3 text-sm font-bold ${tab === 'replay' ? 'bg-white text-violet-950 shadow-sm' : 'text-stone-600'}`}>Replay board</button>
    </div>}
    <p className="my-4 text-xs leading-relaxed text-stone-500">{activeTab === 'main' ? 'Highest completed score wins. Crews still playing are marked live, and time settles tied scores.' : 'Complete two scored runs to see your crew’s best time and improvement.'}</p>
    {activeTab === 'main'
      ? <MainBoard entries={board.main.entries} />
      : board.replay.unlocked && board.replay.visible
        ? <ReplayBoard entries={board.replay.entries} />
        : <div className="rounded-2xl border border-dashed border-violet-300 bg-violet-50 p-5 text-sm leading-relaxed text-violet-950"><strong>Your next scored run reveals more.</strong><br />{board.replay.unlockMessage || 'Complete two scored runs to see your best time and how much you improved.'}</div>}
  </section>;
}
