import { EngineError, type GameState, type HuntDefinition, type Playability } from './types'

export const hasLobby = (definition: HuntDefinition) => !!definition.settings?.sessionDurationSeconds || (definition.settings?.minTeamSize ?? 1) > 1

/** Only actual pauses reduce elapsed time. Extensions never do. */
export function elapsedMilliseconds(state: GameState, from: string, to: string): number {
  const start = Date.parse(from), end = Date.parse(to)
  const paused = (state.timer?.pauses ?? []).reduce((sum, pause) => sum + Math.max(0, Math.min(end, Date.parse(pause.endedAt ?? to)) - Math.max(start, Date.parse(pause.startedAt))), 0)
  return Math.max(0, end - start - paused)
}
export function timerRemaining(state: GameState, now: string): number | undefined {
  if (!state.timer) return undefined
  const open = state.timer.pauses.find(pause => !pause.endedAt)
  return Math.max(0, (Date.parse(state.timer.deadlineAt) - Date.parse(open?.startedAt ?? now)) / 1000)
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
  } else if (!ignoreSchedule && definition.settings?.endsAt && Date.parse(now) >= Date.parse(definition.settings.endsAt)) return { allowed: false, code: 'ended', message: 'This hunt has ended. Your progress is saved.' }
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
