import type { SessionRunSummary, TeamSessionSummary } from './types';

/**
 * Choose the run that the player page may open. A member waiting outside the
 * current frozen-roster run must stay in the lobby even if they participated
 * in an older completed run.
 */
export function sessionRunTarget(
  summary: Pick<TeamSessionSummary, 'activeRun' | 'latestRun' | 'waitingForNextRun'>,
): SessionRunSummary | null {
  if (summary.activeRun) return summary.activeRun;
  if (summary.waitingForNextRun) return null;
  return summary.latestRun?.status === 'completed' ? summary.latestRun : null;
}
