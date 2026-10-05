'use client';

import { useState } from 'react';
import { formatDuration } from './api';
import CrewRecognition from './CrewRecognition';
import Leaderboards, { useTeamLeaderboards } from './Leaderboards';
import ShareCard from './ShareCard';
import type { TeamSessionSummary, V3PlayerView, VisibleRecognitionResult } from './types';
import { cardStyle, primaryButton } from './ui';

function replayAvailability(summary: TeamSessionSummary) {
  const policy = summary.settings.runPolicy;
  if (summary.hasPracticeRun) return {
    allowed: true,
    practice: true,
    reason: 'This crew has entered practice, so every later run under this team identity remains practice-only. Ask the organizer if the registration needs correction; players cannot create an official restart.',
  };
  const replacementOfficialRun = summary.officialAttemptCount > 0 && summary.officialAttemptSlotsUsed === 0;
  if (policy.mode === 'disabled') return summary.remainingOfficialRuns === 0
    ? { allowed: false, reason: 'This event is set to one official attempt per team.' }
    : { allowed: true, practice: false, reason: 'The organizer restored your crew. Your disqualified result stays ineligible, and this replacement run is your official attempt.' };
  if (policy.mode === 'capped' && summary.remainingOfficialRuns === 0) {
    return {
      allowed: true,
      practice: true,
      reason: `Your crew has used all ${policy.maxOfficialRuns ?? 1} official attempts. Practice now reuses one of your already-seen structural routes, with fresh generated values, and cannot reveal another competition route.`,
    };
  }
  if (policy.mode === 'practice-only') return replacementOfficialRun
    ? {
      allowed: true,
      practice: false,
      reason: 'The organizer restored your crew. Your disqualified result stays ineligible, and this replacement run is official before practice resumes.',
    }
    : {
      allowed: true,
      practice: true,
      reason: 'Your next run is practice-only. It reuses your official structural route with fresh generated values and will not change the leaderboard.',
    };
  return { allowed: true, practice: false, reason: 'A replay creates a new seeded route and keeps this result intact.' };
}

export default function FinishExperience({ view, summary, busy, onReplay }: {
  view: V3PlayerView;
  summary: TeamSessionSummary;
  busy: boolean;
  onReplay: (practice: boolean) => Promise<void>;
}) {
  const { data: leaderboard, failed: leaderboardFailed } = useTeamLeaderboards(view.revision);
  const [ownRecognition, setOwnRecognition] = useState<VisibleRecognitionResult | null>(null);
  const availability = replayAvailability(summary);
  const ownEntry = leaderboard?.main.entries.find(entry => entry.isOwnTeam);
  const elapsedMilliseconds = view.summary ? view.summary.elapsedSeconds * 1000 : summary.latestRun?.elapsedMilliseconds;
  const best = summary.bestRun;
  const social = view.features?.socialShare;
  const publicBoard = view.features?.publicBoard;

  return <div className="space-y-6">
    <section className={`${cardStyle} overflow-hidden !bg-emerald-950 !text-white`}>
      <div className="flex items-start justify-between gap-4"><span aria-hidden="true" className="text-5xl text-emerald-200">✦</span><span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold uppercase tracking-wide">Run {view.runNumber}{view.practice ? ' · Practice' : ''}</span></div>
      <p className="mt-6 text-xs font-extrabold uppercase tracking-[0.2em] text-emerald-200">Finish confirmed</p>
      <h2 className="mt-2 text-4xl font-black tracking-tight">You found the finish.</h2>
      <p className="mt-3 max-w-lg leading-relaxed text-emerald-50/80">{view.hunt.settings?.completionMessage || 'Every solve, scan, and discovery is safely recorded for this run.'}</p>
      <dl className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl bg-white/10 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-emerald-200">Score</dt><dd className="mt-1 text-3xl font-black tabular-nums">{view.score}</dd></div>
        <div className="rounded-2xl bg-white/10 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-emerald-200">Rank</dt><dd className="mt-1 text-3xl font-black tabular-nums">{ownEntry ? `#${ownEntry.rank}` : '—'}</dd></div>
        <div className="rounded-2xl bg-white/10 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-emerald-200">Time</dt><dd className="mt-1 text-xl font-black tabular-nums">{formatDuration(elapsedMilliseconds)}</dd></div>
        <div className="rounded-2xl bg-white/10 p-4"><dt className="text-xs font-bold uppercase tracking-wide text-emerald-200">Team best</dt><dd className="mt-1 text-3xl font-black tabular-nums">{best?.score ?? view.score}</dd></div>
      </dl>
      {view.practice && <p className="mt-4 rounded-xl bg-amber-300/15 p-3 text-sm text-amber-100">Practice run: this result is saved for your crew but excluded from competitive ranking.</p>}
      {view.bonusScore !== 0 && <p className="mt-4 rounded-xl bg-violet-300/15 p-3 text-sm text-violet-100"><strong>{view.bonusScore > 0 ? '+' : ''}{view.bonusScore} extra points</strong> were recorded for the fun of the hunt and do not affect the leaderboard.</p>}
    </section>

    <section className="rounded-[1.75rem] border border-violet-200 bg-violet-50 p-5 sm:p-7">
      <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-700">Run it differently</p>
      <h2 className="mt-1 text-3xl font-black tracking-tight text-violet-950">Want to beat your best?</h2>
      <p className="mt-3 text-sm leading-relaxed text-violet-900">{availability.reason} Your previous runs, contribution history, and best result stay untouched.</p>
      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl bg-white p-4"><span className="block text-xs font-bold uppercase tracking-wide text-stone-500">This run</span><strong className="mt-1 block text-xl">{view.score} pts</strong></div>
        <div className="rounded-2xl bg-white p-4"><span className="block text-xs font-bold uppercase tracking-wide text-stone-500">Current best</span><strong className="mt-1 block text-xl">{best?.score ?? view.score} pts</strong></div>
      </div>
      {availability.allowed && <button type="button" disabled={busy} onClick={() => void onReplay(Boolean(availability.practice))} className={`${primaryButton} mt-5 !bg-violet-950 hover:!bg-violet-900`}>{busy ? 'Preparing a fresh route…' : availability.practice ? 'Try a practice replay' : 'Start another run'}</button>}
    </section>

    <Leaderboards board={leaderboard} failed={leaderboardFailed} />

    {view.features?.recognition?.enabled !== false && <CrewRecognition runId={view.runId} currentMemberId={summary.member.id} onOwnResult={setOwnRecognition} />}

    {social?.enabled !== false && <ShareCard
      huntTitle={view.hunt.title}
      teamLabel={summary.team.label}
      memberName={summary.member.name}
      score={view.score}
      rank={ownEntry?.rank}
      runNumber={view.runNumber}
      elapsedLabel={formatDuration(elapsedMilliseconds)}
      result={ownRecognition}
      organizerHandle={social?.organizerHandle}
      campaignHashtag={social?.campaignHashtag}
      publicBoardSlug={publicBoard?.enabled ? publicBoard.slug : undefined}
      allowPersonalTitle={social?.allowPersonalTitle}
    />}
  </div>;
}
