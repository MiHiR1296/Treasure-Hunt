import type {
  BestRunSelection,
  CompletedRunRecord,
  LeaderboardPolicy,
  MainLeaderboardEntry,
  ReplayLeaderboardEntry,
} from './types'

function completionTime(run: CompletedRunRecord): number {
  if (!run.completedAt) return Number.POSITIVE_INFINITY
  const value = Date.parse(run.completedAt)
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

function completionOrderKey(run: CompletedRunRecord): string | null {
  if (!run.completedAt || completionTime(run) === Number.POSITIVE_INFINITY) return null
  const utc = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(run.completedAt)
  if (utc) return `${utc[1]}.${(utc[2] ?? '').padEnd(6, '0').slice(0, 6)}Z`
  return `${new Date(completionTime(run)).toISOString().slice(0, -1)}000Z`
}

function compareCompletion(left: CompletedRunRecord, right: CompletedRunRecord): number {
  const leftKey = completionOrderKey(left)
  const rightKey = completionOrderKey(right)
  if (leftKey && rightKey) return leftKey.localeCompare(rightKey)
  return completionTime(left) - completionTime(right)
}

export function isEligibleCompletedRun(run: CompletedRunRecord): boolean {
  return run.status === 'completed' && run.eligible && !run.practice &&
    Number.isFinite(run.score) && Number.isFinite(run.elapsedMilliseconds) && run.elapsedMilliseconds >= 0 &&
    completionTime(run) !== Number.POSITIVE_INFINITY
}

/** Negative means left ranks ahead: score, elapsed time, then earlier completion. */
export function compareCompletedRuns(left: CompletedRunRecord, right: CompletedRunRecord): number {
  return right.score - left.score ||
    left.elapsedMilliseconds - right.elapsedMilliseconds ||
    compareCompletion(left, right) ||
    left.runId.localeCompare(right.runId)
}

function sameRank(left: CompletedRunRecord, right: CompletedRunRecord): boolean {
  return left.score === right.score &&
    left.elapsedMilliseconds === right.elapsedMilliseconds &&
    completionOrderKey(left) === completionOrderKey(right)
}

export function selectBestRuns(runs: readonly CompletedRunRecord[]): BestRunSelection[] {
  const byTeam = new Map<string, CompletedRunRecord[]>()
  for (const run of runs) {
    if (!isEligibleCompletedRun(run)) continue
    byTeam.set(run.teamId, [...(byTeam.get(run.teamId) ?? []), run])
  }
  return [...byTeam.values()].map(teamRuns => {
    const ordered = [...teamRuns].sort(compareCompletedRuns)
    const firstRun = [...teamRuns].sort((left, right) =>
      left.attemptNumber - right.attemptNumber || compareCompletion(left, right) || left.runId.localeCompare(right.runId),
    )[0]
    const bestRun = ordered[0]
    return {
      teamId: bestRun.teamId,
      teamCode: bestRun.teamCode,
      ...(bestRun.teamName ? { teamName: bestRun.teamName } : {}),
      bestRun,
      firstRun,
      eligibleCompletedRuns: teamRuns.length,
    }
  })
}

function rankSelections(selections: readonly BestRunSelection[]): Array<BestRunSelection & { rank: number }> {
  const ordered = [...selections].sort((left, right) =>
    compareCompletedRuns(left.bestRun, right.bestRun) || left.teamCode.localeCompare(right.teamCode),
  )
  let currentRank = 0
  return ordered.map((selection, index) => {
    if (index === 0 || !sameRank(selection.bestRun, ordered[index - 1].bestRun)) currentRank = index + 1
    return { ...selection, rank: currentRank }
  })
}

function visibleTime(selection: BestRunSelection, policy: LeaderboardPolicy): number | undefined {
  if (policy.timeVisibility === 'always') return selection.bestRun.elapsedMilliseconds
  if (policy.timeVisibility === 'after_second_eligible_run' && selection.eligibleCompletedRuns >= 2) return selection.bestRun.elapsedMilliseconds
  return undefined
}

function mainEntry(selection: BestRunSelection & { rank: number }, policy: LeaderboardPolicy): MainLeaderboardEntry {
  const time = visibleTime(selection, policy)
  return {
    rank: selection.rank,
    teamId: selection.teamId,
    teamCode: selection.teamCode,
    ...(selection.teamName ? { teamName: selection.teamName } : {}),
    score: selection.bestRun.score,
    bestRunId: selection.bestRun.runId,
    bestAttemptNumber: selection.bestRun.attemptNumber,
    eligibleCompletedRuns: selection.eligibleCompletedRuns,
    runCount: selection.eligibleCompletedRuns,
    status: 'completed',
    provisional: false,
    ...(selection.bestRun.progress ? { progress: selection.bestRun.progress } : {}),
    ...(time !== undefined ? { visibleElapsedMilliseconds: time } : {}),
  }
}

export function buildMainLeaderboard(
  runs: readonly CompletedRunRecord[],
  policy: LeaderboardPolicy,
): MainLeaderboardEntry[] {
  return buildMainLeaderboardFromSelections(selectBestRuns(runs), policy)
}

/**
 * Build the main board from one server-projected best/first-run selection per
 * team. This keeps ranking rules shared with the in-memory domain helper while
 * allowing PostgreSQL to collapse large run histories before returning rows.
 */
export function buildMainLeaderboardFromSelections(
  selections: readonly BestRunSelection[],
  policy: LeaderboardPolicy,
): MainLeaderboardEntry[] {
  if (!policy.mainBoardEnabled) return []
  return rankSelections(selections).map(selection => mainEntry(selection, policy))
}

export function buildReplayLeaderboard(
  runs: readonly CompletedRunRecord[],
  policy: LeaderboardPolicy,
): ReplayLeaderboardEntry[] {
  return buildReplayLeaderboardFromSelections(selectBestRuns(runs), policy)
}

/** See buildMainLeaderboardFromSelections. */
export function buildReplayLeaderboardFromSelections(
  selections: readonly BestRunSelection[],
  policy: LeaderboardPolicy,
): ReplayLeaderboardEntry[] {
  if (!policy.replayBoardEnabled) return []
  return rankSelections(selections.filter(selection => selection.eligibleCompletedRuns >= 2)).map(selection => ({
    ...mainEntry(selection, { ...policy, timeVisibility: 'always' }),
    runCount: selection.eligibleCompletedRuns,
    bestElapsedMilliseconds: selection.bestRun.elapsedMilliseconds,
    scoreImprovementFromFirst: selection.bestRun.score - selection.firstRun.score,
    timeImprovementFromFirstMilliseconds: selection.firstRun.elapsedMilliseconds - selection.bestRun.elapsedMilliseconds,
  }))
}
