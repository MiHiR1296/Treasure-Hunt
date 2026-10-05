import type {
  ParallelMechanic,
  PublicParallelMechanic,
  ResolvedChallenge,
  ResolvedRunPlan,
  RoutePlanDefinition,
  V3Definition,
} from './types'
import { deterministicIndex, deterministicWeightedIndex } from './seed'
import { resolveVariables } from './variables'

const DEFAULT_ENUMERATION_LIMIT = 10_000
const HARD_ENUMERATION_LIMIT = 100_000

export class RunPlanningError extends Error {
  constructor(public readonly code: 'invalid_route_plan' | 'route_limit_exceeded' | 'no_eligible_routes' | 'invalid_challenge_pool', message: string) {
    super(message)
    this.name = 'RunPlanningError'
  }
}

export interface RouteEnumeration {
  routes: string[][]
  truncated: boolean
  issues: string[]
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

function combinations<T>(values: readonly T[], count: number, onValue: (value: T[]) => boolean): boolean {
  const selected: T[] = []
  const visit = (start: number): boolean => {
    if (selected.length === count) {
      return onValue([...selected])
    }
    for (let index = start; index <= values.length - (count - selected.length); index++) {
      selected.push(values[index])
      if (!visit(index + 1)) return false
      selected.pop()
    }
    return true
  }
  return visit(0)
}

function permutations<T>(values: readonly T[], onValue: (value: T[]) => boolean): boolean {
  const used = Array(values.length).fill(false) as boolean[]
  const selected: T[] = []
  const visit = (): boolean => {
    if (selected.length === values.length) return onValue([...selected])
    for (let index = 0; index < values.length; index++) {
      if (used[index]) continue
      used[index] = true
      selected.push(values[index])
      if (!visit()) return false
      selected.pop()
      used[index] = false
    }
    return true
  }
  return visit()
}

function basicRouteIssues(plan: RoutePlanDefinition): string[] {
  const issues: string[] = []
  const routeIds = [plan.startCheckpointId, plan.finaleCheckpointId, ...plan.requiredCheckpointIds, ...plan.choose.fromCheckpointIds]
  if (routeIds.some(id => typeof id !== 'string' || !id.trim())) issues.push('Every route checkpoint needs a non-empty ID.')
  if (plan.startCheckpointId === plan.finaleCheckpointId) issues.push('Start and finale checkpoints must be different.')
  if (!unique(plan.requiredCheckpointIds)) issues.push('Required route checkpoint IDs must be unique.')
  if (!unique(plan.choose.fromCheckpointIds)) issues.push('Selectable route checkpoint IDs must be unique.')
  const fixed = new Set([plan.startCheckpointId, plan.finaleCheckpointId, ...plan.requiredCheckpointIds])
  if (fixed.size !== plan.requiredCheckpointIds.length + 2) issues.push('Start, finale, and required route checkpoint IDs must not overlap.')
  if (plan.choose.fromCheckpointIds.some(id => fixed.has(id))) issues.push('Selectable route checkpoints must not also be fixed route checkpoints.')
  if (!Number.isSafeInteger(plan.choose.count) || plan.choose.count < 0 || plan.choose.count > plan.choose.fromCheckpointIds.length) {
    issues.push('Route choose.count must be an integer within the selectable checkpoint list.')
  }
  for (const [index, transition] of (plan.avoidTransitions ?? []).entries()) {
    if (!transition.from || !transition.to || transition.from === transition.to) issues.push(`Avoided transition ${index + 1} is invalid.`)
  }
  return issues
}

function containsAvoidedTransition(route: readonly string[], avoided: ReadonlySet<string>): boolean {
  return route.slice(1).some((checkpoint, index) => avoided.has(`${route[index]}\u0000${checkpoint}`))
}

/** Enumerates every eligible physical route or reports that the proof limit was exceeded. */
export function enumerateEligibleRoutes(plan: RoutePlanDefinition, requestedLimit = DEFAULT_ENUMERATION_LIMIT): RouteEnumeration {
  const issues = basicRouteIssues(plan)
  if (issues.length) return { routes: [], truncated: false, issues }
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, HARD_ENUMERATION_LIMIT)
    : DEFAULT_ENUMERATION_LIMIT
  const avoided = new Set((plan.avoidTransitions ?? []).map(edge => `${edge.from}\u0000${edge.to}`))
  const routes: string[][] = []
  let truncated = false
  let examinedCandidates = 0
  const add = (middle: string[]) => {
    // Bound proof work, not only accepted routes. Avoid rules can otherwise
    // make a huge combinatorial space yield very few routes and keep the
    // publisher traversing for an unbounded amount of time.
    if (examinedCandidates === limit) {
      truncated = true
      return false
    }
    examinedCandidates++
    const route = [plan.startCheckpointId, ...middle, plan.finaleCheckpointId]
    if (containsAvoidedTransition(route, avoided)) return true
    routes.push(route)
    return true
  }

  combinations(plan.choose.fromCheckpointIds, plan.choose.count, chosen => {
    const middle = [...plan.requiredCheckpointIds, ...chosen]
    if (plan.shuffleSelectedCheckpoints === false) {
      return add(middle)
    }
    return permutations(middle, add)
  })
  return { routes, truncated, issues }
}

function validatePool(definition: V3Definition, routeCheckpointId: string) {
  const pool = definition.settings.challengePools[routeCheckpointId]
  if (!pool) return
  if (!pool.variants.length) throw new RunPlanningError('invalid_challenge_pool', `Challenge pool "${pool.id}" has no variants.`)
  if (new Set(pool.variants.map(variant => variant.id)).size !== pool.variants.length) {
    throw new RunPlanningError('invalid_challenge_pool', `Challenge pool "${pool.id}" has duplicate variant IDs.`)
  }
  for (const variant of pool.variants) {
    if (!definition.checkpoints.some(checkpoint => checkpoint.id === variant.checkpointId)) {
      throw new RunPlanningError('invalid_challenge_pool', `Challenge variant "${variant.id}" references an unknown checkpoint.`)
    }
    if (variant.weight !== undefined && (!Number.isFinite(variant.weight) || variant.weight <= 0)) {
      throw new RunPlanningError('invalid_challenge_pool', `Challenge variant "${variant.id}" has an invalid weight.`)
    }
  }
}

/** Resolves a run deterministically and deliberately omits its private seed. */
export function planRun(definition: V3Definition, privateSeed: string): ResolvedRunPlan {
  if (!Number.isSafeInteger(definition.settings.fairnessPolicy.maxResolvedRoutes) || definition.settings.fairnessPolicy.maxResolvedRoutes < 1) {
    throw new RunPlanningError('invalid_route_plan', 'A positive route proof limit is required before a run can start.')
  }
  const enumeration = enumerateEligibleRoutes(definition.settings.routePlan, definition.settings.fairnessPolicy.maxResolvedRoutes)
  if (enumeration.issues.length) throw new RunPlanningError('invalid_route_plan', enumeration.issues.join(' '))
  if (enumeration.truncated) throw new RunPlanningError('route_limit_exceeded', 'The route space exceeds the configured proof limit.')
  if (!enumeration.routes.length) throw new RunPlanningError('no_eligible_routes', 'The route rules do not produce an eligible route.')
  const routeCheckpointIds = enumeration.routes[
    deterministicIndex(privateSeed, 'physical-route', enumeration.routes.length, definition.id, definition.version)
  ]
  const challenges: ResolvedChallenge[] = routeCheckpointIds.map(routeCheckpointId => {
    const pool = definition.settings.challengePools[routeCheckpointId]
    if (!pool) {
      if (!definition.checkpoints.some(checkpoint => checkpoint.id === routeCheckpointId)) {
        throw new RunPlanningError('invalid_route_plan', `Route checkpoint "${routeCheckpointId}" is not an engine checkpoint or challenge pool.`)
      }
      return { routeCheckpointId, checkpointId: routeCheckpointId }
    }
    validatePool(definition, routeCheckpointId)
    const variantIndex = deterministicWeightedIndex(
      privateSeed,
      'challenge-variant',
      pool.variants.map(variant => variant.weight ?? 1),
      definition.id,
      definition.version,
      routeCheckpointId,
    )
    const variant = pool.variants[variantIndex]
    return { routeCheckpointId, poolId: pool.id, variantId: variant.id, checkpointId: variant.checkpointId }
  })
  return {
    routeCheckpointIds: [...routeCheckpointIds],
    checkpointIds: challenges.map(challenge => challenge.checkpointId),
    challenges,
    variables: resolveVariables(privateSeed, definition.settings.variableGenerators),
  }
}

export interface ParallelMechanicIssue { path: string; message: string }

/** Validates private lane configuration; the command layer still enforces one distinct actor per lane. */
export function validateParallelMechanics(definition: V3Definition): ParallelMechanicIssue[] {
  const issues: ParallelMechanicIssue[] = []
  const mechanics = definition.settings.parallelMechanics ?? []
  if (new Set(mechanics.map(mechanic => mechanic.id)).size !== mechanics.length) {
    issues.push({ path: 'settings.parallelMechanics', message: 'Parallel mechanic IDs must be unique.' })
  }
  for (const [mechanicIndex, mechanic] of mechanics.entries()) {
    const path = `settings.parallelMechanics[${mechanicIndex}]`
    const checkpoint = definition.checkpoints.find(candidate => candidate.id === mechanic.checkpointId)
    const node = checkpoint?.flow.nodes.find(candidate => candidate.id === mechanic.nodeId)
    if (!checkpoint) issues.push({ path: `${path}.checkpointId`, message: 'Parallel mechanic checkpoint does not exist.' })
    else if (!node || node.type !== 'verify_organizer') issues.push({ path: `${path}.nodeId`, message: 'Parallel mechanics must finish at a verify_organizer gate.' })
    if (!Number.isSafeInteger(mechanic.timeWindowSeconds) || mechanic.timeWindowSeconds < 5 || mechanic.timeWindowSeconds > 86_400) {
      issues.push({ path: `${path}.timeWindowSeconds`, message: 'Time window must be between 5 seconds and 24 hours.' })
    }
    if (mechanic.lanes.length < 2 || mechanic.lanes.length > 20) issues.push({ path: `${path}.lanes`, message: 'Parallel mechanics need 2 to 20 distinct-member lanes.' })
    if (new Set(mechanic.lanes.map(lane => lane.id)).size !== mechanic.lanes.length) issues.push({ path: `${path}.lanes`, message: 'Parallel lane IDs must be unique.' })
    mechanic.lanes.forEach((lane, laneIndex) => {
      const lanePath = `${path}.lanes[${laneIndex}]`
      if (!lane.id.trim() || !lane.label.trim()) issues.push({ path: lanePath, message: 'Parallel lanes need an ID and player-facing label.' })
      if (lane.type === 'qr' && !lane.token) issues.push({ path: `${lanePath}.token`, message: 'QR lanes need a private token.' })
      if (lane.type === 'code' && !lane.code) issues.push({ path: `${lanePath}.code`, message: 'Code lanes need a private code.' })
      if ((lane.type === 'gps' || (lane.type === 'photo' && lane.location)) && !validLocation(lane.type === 'gps' ? lane.location : lane.location!)) {
        issues.push({ path: `${lanePath}.location`, message: 'Lane location is invalid.' })
      }
    })
  }
  return issues
}

function validLocation(location: { latitude: number; longitude: number; radiusMeters: number; maxAccuracyMeters: number }): boolean {
  return Number.isFinite(location.latitude) && location.latitude >= -90 && location.latitude <= 90 &&
    Number.isFinite(location.longitude) && location.longitude >= -180 && location.longitude <= 180 &&
    Number.isFinite(location.radiusMeters) && location.radiusMeters > 0 &&
    Number.isFinite(location.maxAccuracyMeters) && location.maxAccuracyMeters > 0
}

/** Safe player projection: verifier tokens, codes, and target coordinates stay server-side. */
export function publicParallelMechanics(
  definition: V3Definition,
  mechanics: readonly ParallelMechanic[] = definition.settings.parallelMechanics ?? [],
): PublicParallelMechanic[] {
  return mechanics.map(mechanic => ({
    id: mechanic.id,
    checkpointId: mechanic.checkpointId,
    nodeId: mechanic.nodeId,
    timeWindowSeconds: mechanic.timeWindowSeconds,
    lanes: mechanic.lanes.map(({ id, label, type }) => ({ id, label, type })),
  }))
}
