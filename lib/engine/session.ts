import { EngineError, type GameState, type HuntDefinition, type Playability } from './types'

export const hasLobby = (definition: HuntDefinition) => !!definition.settings?.sessionDurationSeconds || (definition.settings?.minTeamSize ?? 1) > 1

/** Only actual pauses reduce elapsed time. Extensions never do. */
export function elapsedMilliseconds(state: GameState, from: string, to: string): number {
  const start = Date.parse(from), end = Date.parse(to)
  const windows = [...(state.timer?.pauses ?? []), ...(state.clockPauses ?? [])]
    .map(pause => [Math.max(start, Date.parse(pause.startedAt)), Math.min(end, Date.parse(pause.endedAt ?? to))] as const)
    .filter(([windowStart, windowEnd]) => Number.isFinite(windowStart) && Number.isFinite(windowEnd) && windowEnd > windowStart)
    .sort((left, right) => left[0] - right[0])
  let paused = 0, cursor = Number.NEGATIVE_INFINITY
  for (const [windowStart, windowEnd] of windows) {
    if (windowEnd <= cursor) continue
    paused += windowEnd - Math.max(windowStart, cursor)
    cursor = windowEnd
  }
  return Math.max(0, end - start - paused)
}

/**
 * Excludes a completed server-controlled wait (for example photo moderation)
 * from ranking time. For countdown hunts only the newly uncovered portion is
 * added to the deadline, so overlapping organizer/review pauses never double
 * extend a run.
 */
export function excludeRunClockInterval(original: GameState, startedAt: string, endedAt: string, reason: 'review' = 'review'): GameState {
  const started = Date.parse(startedAt), ended = Date.parse(endedAt)
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended <= started) return original
  const baseline = original.startedAt ?? startedAt
  const pausedBefore = Math.max(0, ended - Date.parse(baseline) - elapsedMilliseconds(original, baseline, endedAt))
  const state = structuredClone(original)
  state.clockPauses ??= []
  if (!state.clockPauses.some(pause => pause.startedAt === startedAt && pause.endedAt === endedAt && pause.reason === reason)) {
    state.clockPauses.push({ startedAt, endedAt, reason })
  }
  const pausedAfter = Math.max(0, ended - Date.parse(baseline) - elapsedMilliseconds(state, baseline, endedAt))
  if (state.timer && pausedAfter > pausedBefore) {
    state.timer.deadlineAt = new Date(Date.parse(state.timer.deadlineAt) + pausedAfter - pausedBefore).toISOString()
  }
  return state
}
export function timerRemaining(state: GameState, now: string): number | undefined {
  if (!state.timer) return undefined
  const openStartedAt = [...state.timer.pauses, ...(state.clockPauses ?? [])]
    .filter(pause => !pause.endedAt)
    .map(pause => pause.startedAt)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0]
  return Math.max(0, (Date.parse(state.timer.deadlineAt) - Date.parse(openStartedAt ?? now)) / 1000)
}
export function playability(definition: HuntDefinition, state: GameState, status: string, now: string, ignoreSchedule = false): Playability {
  if (status === 'ended' || status === 'archived') return { allowed: false, code: 'ended', message: 'The organizer has ended this hunt. Your progress is saved.' }
  if (state.timer && !state.timer.pauses.some(pause => !pause.endedAt) && (timerRemaining(state, now) ?? 0) <= 0) return { allowed: false, code: 'expired', message: 'Your time has ended. Your progress is saved; ask the organizer if you need help.' }
  if (status === 'paused') return { allowed: false, code: 'paused', message: 'The organizer has paused this hunt. Your progress is saved.' }
  if (status !== 'live' || (!ignoreSchedule && definition.settings?.startsAt && Date.parse(now) < Date.parse(definition.settings.startsAt))) return { allowed: false, code: 'not_open', message: 'This hunt is not open for play yet.' }
  if (state.status === 'waiting') {
    if (!ignoreSchedule && definition.settings?.endsAt && Date.parse(now) >= Date.parse(definition.settings.endsAt)) return { allowed: false, code: 'ended', message: 'The latest start time has passed. Ask the organizer for help.' }
    return { allowed: false, code: 'waiting', message: 'Confirm your roster and start when your team is ready.' }
  }
  if (state.timer) {
    if (state.timer.pauses.some(pause => !pause.endedAt)) return { allowed: false, code: 'paused', message: 'Your timer is paused.' }
    if ((timerRemaining(state, now) ?? 0) <= 0) return { allowed: false, code: 'expired', message: 'Your time has ended. Your progress is saved; ask the organizer if you need help.' }
  } else {
    if (!ignoreSchedule && definition.settings?.endsAt && Date.parse(now) >= Date.parse(definition.settings.endsAt)) return { allowed: false, code: 'ended', message: 'This hunt has ended. Your progress is saved.' }
  }
  return { allowed: true, code: 'running' }
}
export function assertSessionPlayable(definition: HuntDefinition, state: GameState, status: string, now: string, ignoreSchedule = false) {
  const result = playability(definition, state, status, now, ignoreSchedule)
  if (!result.allowed) throw new EngineError(`session_${result.code}`, result.message!)
}
export function assertStartWindow(definition: HuntDefinition, status: string, now: string) {
  if (status !== 'live') throw new EngineError('session_not_open', 'The organizer must open or resume this hunt before you start.')
  if (definition.settings?.startsAt && Date.parse(now) < Date.parse(definition.settings.startsAt)) throw new EngineError('session_not_open', 'The start window has not opened yet.')
  if (definition.settings?.endsAt && Date.parse(now) >= Date.parse(definition.settings.endsAt)) throw new EngineError('session_ended', 'The latest start time has passed. Ask the organizer for help.')
}
/** Hunt lock -> team locks. Lifecycle callers persist this together with the status. */
export function pauseSession(original: GameState, now: string): GameState {
  if (!original.timer || (timerRemaining(original, now) ?? 0) <= 0 || original.timer.pauses.some(p => !p.endedAt)) return original
  const state = structuredClone(original)
  state.timer!.pauses.push({ startedAt: now }); state.revision++
  state.events.push({ id: `event-${state.events.length + 1}`, type: 'session_paused', at: now })
  return state
}
export function resumeSession(original: GameState, now: string): GameState {
  if (!original.timer?.pauses.some(p => !p.endedAt)) return original
  const state = structuredClone(original), timer = state.timer!
  const pause = timer.pauses.find(p => !p.endedAt)!
  timer.deadlineAt = new Date(Date.parse(timer.deadlineAt) + Math.max(0, Date.parse(now) - Date.parse(pause.startedAt))).toISOString()
  pause.endedAt = now; state.revision++
  state.events.push({ id: `event-${state.events.length + 1}`, type: 'session_resumed', at: now })
  return state
}

/** V3 records event-wide pauses even for untimed runs so leaderboard time stays fair. */
export function pauseRunClock(original: GameState, now: string): GameState {
  if (original.timer) return pauseSession(original, now)
  if (original.clockPauses?.some(pause => !pause.endedAt && pause.reason === 'organizer')) return original
  const state = structuredClone(original)
  state.clockPauses ??= []
  state.clockPauses.push({ startedAt: now, reason: 'organizer' })
  state.revision++
  state.events.push({ id: `event-${state.events.length + 1}`, type: 'session_paused', at: now })
  return state
}

export function resumeRunClock(original: GameState, now: string): GameState {
  if (original.timer) return resumeSession(original, now)
  const open = original.clockPauses?.find(pause => !pause.endedAt && pause.reason === 'organizer')
  if (!open) return original
  const state = structuredClone(original)
  state.clockPauses!.find(pause => !pause.endedAt && pause.reason === 'organizer')!.endedAt = now
  state.revision++
  state.events.push({ id: `event-${state.events.length + 1}`, type: 'session_resumed', at: now })
  return state
}

/** Persist a provisional moderation wait immediately so expiry cannot win the review race. */
export function beginReviewClockPause(original: GameState, sourceId: string, startedAt: string): GameState {
  if (!sourceId || !Number.isFinite(Date.parse(startedAt)) || original.clockPauses?.some(pause => !pause.endedAt && pause.reason === 'review' && pause.sourceId === sourceId)) return original
  const state = structuredClone(original)
  state.clockPauses ??= []
  state.clockPauses.push({ startedAt, reason: 'review', sourceId })
  return state
}

/**
 * Close the provisional moderation wait. Only the portion not already covered
 * by another pause extends a countdown deadline, so organizer/review overlap
 * cannot grant time twice.
 */
export function endReviewClockPause(original: GameState, sourceId: string, endedAt: string): GameState {
  const pauseIndex = original.clockPauses?.findIndex(pause => !pause.endedAt && pause.reason === 'review' && pause.sourceId === sourceId) ?? -1
  if (pauseIndex < 0 || !Number.isFinite(Date.parse(endedAt))) return original
  const state = structuredClone(original)
  const startedAt = state.clockPauses![pauseIndex].startedAt
  if (Date.parse(endedAt) <= Date.parse(startedAt)) return original
  state.clockPauses![pauseIndex].endedAt = endedAt
  if (state.timer) {
    // Other open reviews have not extended the persisted deadline yet. Remove
    // all of them from this delta calculation, then credit only the newly
    // closed interval against previously credited closed/organizer pauses.
    const withoutOpenReviews = structuredClone(original)
    withoutOpenReviews.clockPauses = (withoutOpenReviews.clockPauses ?? []).filter(
      pause => pause.reason !== 'review' || Boolean(pause.endedAt),
    )
    const withClosedReview = structuredClone(withoutOpenReviews)
    withClosedReview.clockPauses ??= []
    withClosedReview.clockPauses.push({ startedAt, endedAt, reason: 'review', sourceId })
    const baseline = original.startedAt ?? startedAt
    const wall = Math.max(0, Date.parse(endedAt) - Date.parse(baseline))
    const coveredWithout = Math.max(0, wall - elapsedMilliseconds(withoutOpenReviews, baseline, endedAt))
    const coveredWith = Math.max(0, wall - elapsedMilliseconds(withClosedReview, baseline, endedAt))
    if (coveredWith > coveredWithout) {
      state.timer.deadlineAt = new Date(Date.parse(state.timer.deadlineAt) + coveredWith - coveredWithout).toISOString()
    }
  }
  return state
}
