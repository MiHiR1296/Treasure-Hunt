import type {
  FairnessRouteResult,
  ParallelMechanic,
  PublicParallelMechanic,
  ResolvedChallenge,
  ResolvedRunPlan,
  RoutePlanDefinition,
  V3Definition,
} from './types'
import { resolveIntegrityPolicy } from './types'
import { deterministicIndex, deterministicWeightedIndex } from './seed'
import { resolveVariables, usesStrongRunCodeTemplate } from './variables'

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
  if (new Set(pool.variants.map(variant => variant.checkpointId)).size !== pool.variants.length) {
    throw new RunPlanningError('invalid_challenge_pool', `Challenge pool "${pool.id}" must use a different checkpoint for every meaningful variant.`)
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

/**
 * Rebuilds an exhaustively validated structural plan while resolving fresh,
 * run-scoped variables from the private seed. The route result is private
 * publication data and is never accepted from a player request.
 */
export function planRunForFairnessRoute(
  definition: V3Definition,
  privateSeed: string,
  route: FairnessRouteResult,
): ResolvedRunPlan {
  if (route.routeCheckpointIds.length !== route.checkpointIds.length) {
    throw new RunPlanningError('invalid_route_plan', 'The validated route has mismatched physical and engine checkpoint counts.')
  }
  let pooledIndex = 0
  const challenges: ResolvedChallenge[] = route.routeCheckpointIds.map((routeCheckpointId, index) => {
    const checkpointId = route.checkpointIds[index]
    const pool = definition.settings.challengePools[routeCheckpointId]
    if (!pool) {
      if (checkpointId !== routeCheckpointId || !definition.checkpoints.some(checkpoint => checkpoint.id === checkpointId)) {
        throw new RunPlanningError('invalid_route_plan', `Validated route checkpoint "${routeCheckpointId}" no longer matches the published definition.`)
      }
      return { routeCheckpointId, checkpointId }
    }
    validatePool(definition, routeCheckpointId)
    const variantId = route.challengeVariantIds[pooledIndex++]
    const variant = pool.variants.find(candidate => candidate.id === variantId && candidate.checkpointId === checkpointId)
    if (!variant) {
      throw new RunPlanningError('invalid_challenge_pool', `Validated challenge variant "${variantId ?? ''}" no longer matches pool "${pool.id}".`)
    }
    return { routeCheckpointId, poolId: pool.id, variantId: variant.id, checkpointId }
  })
  if (pooledIndex !== route.challengeVariantIds.length) {
    throw new RunPlanningError('invalid_challenge_pool', 'The validated route contains unused challenge variants.')
  }
  return {
    routeCheckpointIds: [...route.routeCheckpointIds],
    checkpointIds: [...route.checkpointIds],
    challenges,
    variables: resolveVariables(privateSeed, definition.settings.variableGenerators),
  }
}

export interface PlanAllocationUsage {
  routeKey: string
  teamId: string
}

export interface BalancedPlanSelection {
  route: FairnessRouteResult
  /** Zero-based pass through the plan deck for this team. */
  cycle: number
  /** Number of prior event assignments of this exact structural plan. */
  eventUseCount: number
  /** Number of prior assignments of this plan to the requesting team. */
  teamUseCount: number
}

/**
 * Chooses from the least-used plans for the team first, then the least-used
 * plans event-wide. A private seed breaks only true ties, so the persistence
 * layer can serialize starts without making allocation predictable.
 */
export function selectBalancedPlan(
  routes: readonly FairnessRouteResult[],
  usage: readonly PlanAllocationUsage[],
  teamId: string,
  privateSeed: string,
): BalancedPlanSelection {
  if (!routes.length) throw new RunPlanningError('no_eligible_routes', 'The published plan deck is empty.')
  const known = new Set(routes.map(route => route.routeKey))
  if (known.size !== routes.length) throw new RunPlanningError('invalid_route_plan', 'The published plan deck contains duplicate keys.')
  const eventCounts = new Map(routes.map(route => [route.routeKey, 0]))
  const teamCounts = new Map(routes.map(route => [route.routeKey, 0]))
  for (const item of usage) {
    if (!known.has(item.routeKey)) continue
    eventCounts.set(item.routeKey, (eventCounts.get(item.routeKey) ?? 0) + 1)
    if (item.teamId === teamId) teamCounts.set(item.routeKey, (teamCounts.get(item.routeKey) ?? 0) + 1)
  }
  const minimumTeamUse = Math.min(...teamCounts.values())
  const leastUsedByTeam = routes.filter(route => teamCounts.get(route.routeKey) === minimumTeamUse)
  const minimumEventUse = Math.min(...leastUsedByTeam.map(route => eventCounts.get(route.routeKey) ?? 0))
  const candidates = leastUsedByTeam
    .filter(route => eventCounts.get(route.routeKey) === minimumEventUse)
    .sort((left, right) => left.routeKey.localeCompare(right.routeKey))
  const route = candidates[deterministicIndex(
    privateSeed,
    'balanced-plan-allocation',
    candidates.length,
    routes.map(candidate => candidate.routeKey).sort().join('\u001f'),
    teamId,
    minimumTeamUse,
    minimumEventUse,
  )]
  return {
    route,
    cycle: minimumTeamUse,
    eventUseCount: eventCounts.get(route.routeKey) ?? 0,
    teamUseCount: teamCounts.get(route.routeKey) ?? 0,
  }
}

export interface ParallelMechanicIssue { path: string; message: string }

/** Validates private lane configuration; the command layer still enforces one distinct actor per lane. */
export function validateParallelMechanics(
  definition: V3Definition,
  authoredSecurityDefinition: V3Definition = definition,
): ParallelMechanicIssue[] {
  const issues: ParallelMechanicIssue[] = []
  const mechanics = definition.settings.parallelMechanics ?? []
  if (new Set(mechanics.map(mechanic => mechanic.id)).size !== mechanics.length) {
    issues.push({ path: 'settings.parallelMechanics', message: 'Parallel mechanic IDs must be unique.' })
  }
  if (new Set(mechanics.map(mechanic => `${mechanic.checkpointId}\u0000${mechanic.nodeId}`)).size !== mechanics.length) {
    issues.push({ path: 'settings.parallelMechanics', message: 'Only one parallel mechanic may complete a checkpoint organizer gate.' })
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
    if (mechanic.lanes.length > (definition.settings.maxTeamSize ?? 50)) {
      issues.push({ path: `${path}.lanes`, message: 'Parallel lane count cannot exceed the maximum team size because every lane needs a distinct starting-roster member.' })
    }
    if (mechanic.lanes.length > (definition.settings.minTeamSize ?? 1)) {
      issues.push({ path: `${path}.lanes`, message: 'Minimum team size must be at least the parallel lane count so a legitimately started team cannot be trapped at this gate.' })
    }
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
    const authoredMechanic = authoredSecurityDefinition.settings.parallelMechanics?.find(source => source.id === mechanic.id)
    const hasGpsLane = mechanic.lanes.some(lane => lane.type === 'gps')
    const hasShareableNonGpsLane = mechanic.lanes.some(lane => {
      if (lane.type === 'qr') return true
      if (lane.type !== 'code') return false
      const authoredLane = authoredMechanic?.lanes.find(source => source.id === lane.id)
      const authoredCode = authoredLane?.type === 'code' ? authoredLane.code : lane.code
      return !usesStrongRunCodeTemplate(authoredCode, authoredSecurityDefinition.settings.variableGenerators)
    })
    const locationVerification = resolveIntegrityPolicy(definition.settings).locationVerification
    const gpsNeedsPhoto = hasGpsLane && (locationVerification === 'gps_photo' || locationVerification === 'strict')
    if ((hasShareableNonGpsLane || gpsNeedsPhoto) && !mechanic.lanes.some(lane => lane.type === 'photo')) {
      const reason = hasShareableNonGpsLane
        ? 'QR or static code values can be shared, so this parallel mechanic must also require a photo-evidence lane; a high-entropy run-scoped generated code is the only code-lane exception.'
        : 'This hunt requires every GPS parallel mechanic to include a photo-evidence lane.'
      issues.push({ path: `${path}.lanes`, message: reason })
    }
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
