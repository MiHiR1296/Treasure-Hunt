'use client'

import { useEffect, useState } from 'react'
import { playerRequest } from '../sessionClient'
interface Board { visible: boolean; reason?: string; ranking?: string; entries: { teamId: string; name: string; score: number; completed: number; total: number; hints: number; finished: boolean; seconds: number; rank: number }[] }
export default function Leaderboard({ teamId, revision }: { teamId: string; revision: number }) {
  const [board, setBoard] = useState<Board | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    const read = async () => { try { const next = await playerRequest<Board>('/api/v2/leaderboard'); if (live) { setBoard(next); setFailed(false) } } catch { if (live) setFailed(true) } }
    void read(); const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void read() }, 15000)
    return () => { live = false; window.clearInterval(timer) }
  }, [revision, teamId])
  if (!board) return failed ? <p className="text-sm text-stone-500">The leaderboard will return when your connection improves.</p> : null
  if (!board.visible) return <p className="text-sm text-stone-500">{board.reason || 'The organizer has hidden the leaderboard.'}</p>
  return <section className="rounded-2xl border border-stone-200 bg-white p-4"><h2 className="text-lg font-bold">Leaderboard</h2><p className="mt-1 text-xs text-stone-500">{board.ranking === 'progress' ? 'Ranked by checkpoints completed' : board.ranking === 'points_time' ? 'Ranked by points, then time' : 'Ranked by points'}</p><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="py-2 pr-3">Rank</th><th className="py-2 pr-3">Team</th><th className="py-2 pr-3">Points</th><th className="py-2">Progress</th></tr></thead><tbody>{board.entries.map(entry => <tr key={entry.teamId} className={`border-t border-stone-100 ${entry.teamId === teamId ? 'bg-emerald-50 font-semibold' : ''}`}><td className="py-3 pr-3">{entry.rank}</td><td className="py-3 pr-3">{entry.name}{entry.teamId === teamId ? ' (your team)' : ''}</td><td className="py-3 pr-3">{entry.score} pts</td><td className="py-3">{entry.completed}/{entry.total}{entry.finished ? ' ✓' : ''}</td></tr>)}</tbody></table></div>{failed && <p className="mt-2 text-xs text-stone-500">Showing the last received standings.</p>}</section>
}
