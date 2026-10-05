import type { CheckpointDefinition, FlowNode, PuzzleDefinition } from '../engine/types'
import type {
  ChallengeVariant,
  FairnessIssue,
  FairnessReport,
  FairnessRouteResult,
  TravelEstimate,
  V3Definition,
} from './types'
import { enumerateEligibleRoutes } from './planning'

class CheckpointGraphError extends Error {}

const POSTGRES_INTEGER_MAX = BigInt(2_147_483_647)
const POSTGRES_INTEGER_MIN_MAGNITUDE = BigInt(2_147_483_648)

interface ScoreCacheBounds {
  rankingPositive: bigint
  rankingNegative: bigint
  bonusPositive: bigint
  bonusNegative: bigint
}

const emptyScoreCacheBounds = (): ScoreCacheBounds => ({
  rankingPositive: BigInt(0),
  rankingNegative: BigInt(0),
  bonusPositive: BigInt(0),
  bonusNegative: BigInt(0),
})

function addScoreCacheBounds(...values: ScoreCacheBounds[]): ScoreCacheBounds {
  return values.reduce((total, value) => ({
    rankingPositive: total.rankingPositive + value.rankingPositive,
    rankingNegative: total.rankingNegative + value.rankingNegative,
    bonusPositive: total.bonusPositive + value.bonusPositive,
    bonusNegative: total.bonusNegative + value.bonusNegative,
  }), emptyScoreCacheBounds())
}

function maxScoreCacheBounds(...values: ScoreCacheBounds[]): ScoreCacheBounds {
  return values.reduce((maximum, value) => ({
    rankingPositive: maximum.rankingPositive > value.rankingPositive ? maximum.rankingPositive : value.rankingPositive,
    rankingNegative: maximum.rankingNegative > value.rankingNegative ? maximum.rankingNegative : value.rankingNegative,
    bonusPositive: maximum.bonusPositive > value.bonusPositive ? maximum.bonusPositive : value.bonusPositive,
    bonusNegative: maximum.bonusNegative > value.bonusNegative ? maximum.bonusNegative : value.bonusNegative,
  }), emptyScoreCacheBounds())
}

function scoreCacheEntry(amount: number, excluded = false): ScoreCacheBounds {
  if (!Number.isSafeInteger(amount)) throw new CheckpointGraphError('Every score amount must be a safe whole number.')
  const result = emptyScoreCacheBounds()
  const magnitude = BigInt(Math.abs(amount))
  if (amount >= 0) {
    if (excluded) result.bonusPositive = magnitude
    else result.rankingPositive = magnitude
  } else if (excluded) result.bonusNegative = magnitude
  else result.rankingNegative = magnitude
  return result
}

function puzzleGrossMaximumBonus(puzzle: PuzzleDefinition): number {
  if (puzzle.type === 'word_search') {
    return Math.max(0, puzzle.words.length - (puzzle.minimumWords ?? puzzle.words.length)) * Math.max(0, puzzle.bonusPerExtraWord ?? 0)
  }
  if (puzzle.type === 'quiz') {
    return Math.max(0, puzzle.questions.length - puzzle.minimumCorrect) * Math.max(0, puzzle.bonusPerAdditionalCorrect ?? 0)
  }
  return 0
}

function puzzleMaximumBonus(puzzle: PuzzleDefinition): number {
  if ((puzzle.type === 'word_search' || puzzle.type === 'quiz') && puzzle.bonusRankingImpact === 'excluded') return 0
  return puzzleGrossMaximumBonus(puzzle)
}

function puzzleScoreCacheBounds(puzzle: PuzzleDefinition): ScoreCacheBounds {
  let result = emptyScoreCacheBounds()
  const bonus = puzzleGrossMaximumBonus(puzzle)
  if (bonus > 0) {
    const excluded = (puzzle.type === 'word_search' || puzzle.type === 'quiz') && puzzle.bonusRankingImpact === 'excluded'
    result = addScoreCacheBounds(result, scoreCacheEntry(bonus, excluded))
  }
  if (puzzle.type === 'quiz') {
    for (const question of puzzle.questions) {
      if (question.skipPenalty) result = addScoreCacheBounds(result, scoreCacheEntry(-question.skipPenalty))
    }
  }
  return result
}

function primaryDestinations(node: FlowNode): string[] {
  if (node.type === 'complete') return []
  if (node.type === 'branch') return [node.ifTrue, node.ifFalse]
  if (node.type === 'random_branch') return node.choices.map(choice => choice.next)
  if (node.type === 'choose_path') return node.choices.map(choice => choice.next)
  return [node.next]
}

function nodeAward(node: FlowNode): number {
  if (node.type === 'add_points') return node.rankingImpact === 'excluded' ? 0 : node.amount
  if (node.type === 'puzzle') return puzzleMaximumBonus(node.puzzle)
  return 0
}

function nodeScoreCacheBounds(node: FlowNode): ScoreCacheBounds {
  if (node.type === 'add_points') return scoreCacheEntry(node.amount, node.rankingImpact === 'excluded')
  if (node.type === 'puzzle') return puzzleScoreCacheBounds(node.puzzle)
  return emptyScoreCacheBounds()
}

function checkpointScoreCacheBounds(checkpoint: CheckpointDefinition): ScoreCacheBounds {
  const nodes = new Map(checkpoint.flow.nodes.map(node => [node.id, node]))
  const visiting = new Set<string>()
  const memo = new Map<string, ScoreCacheBounds>()
  const visit = (nodeId: string): ScoreCacheBounds => {
    const cached = memo.get(nodeId)
    if (cached) return cached
    const node = nodes.get(nodeId)
    if (!node) throw new CheckpointGraphError(`Checkpoint flow references unknown node "${nodeId}".`)
    if (visiting.has(nodeId)) throw new CheckpointGraphError('Checkpoint flow must not contain a cycle.')
    visiting.add(nodeId)
    const destinations = primaryDestinations(node).map(visit)
    const continuations = [...destinations]
    if ('fallback' in node && node.fallback) continuations.push(visit(node.fallback.nodeId))
    const continuation = continuations.length ? maxScoreCacheBounds(...continuations) : emptyScoreCacheBounds()
    const total = addScoreCacheBounds(nodeScoreCacheBounds(node), continuation)
    visiting.delete(nodeId)
    memo.set(nodeId, total)
    return total
  }

  let result = addScoreCacheBounds(
    scoreCacheEntry(checkpoint.basePoints),
    visit(checkpoint.flow.startNodeId),
  )
  if (checkpoint.timeBonus) {
    result = addScoreCacheBounds(result, scoreCacheEntry(checkpoint.timeBonus.points, checkpoint.timeBonus.rankingImpact === 'excluded'))
  }
  if (checkpoint.skipPenalty) result = addScoreCacheBounds(result, scoreCacheEntry(-checkpoint.skipPenalty))
  for (const hint of checkpoint.hints) {
    if (hint.enabled === false) continue
    if (hint.cost) result = addScoreCacheBounds(result, scoreCacheEntry(-hint.cost))
    if (hint.content.type === 'puzzle') result = addScoreCacheBounds(result, puzzleScoreCacheBounds(hint.content.puzzle))
  }
  return result
}

interface CheckpointScoreAnalysis {
  maximumScore: number
  unequalRandomBranches: Array<{ nodeId: string; choiceScores: number[] }>
  unequalAutomaticBranches: Array<{
    nodeId: string
    conditionType: Extract<FlowNode, { type: 'branch' }>['condition']['type']
    variableKey?: string
    choiceScores: number[]
  }>
}

function analyzeCheckpointScore(checkpoint: CheckpointDefinition): CheckpointScoreAnalysis {
  if (!Number.isFinite(checkpoint.basePoints)) throw new CheckpointGraphError('Checkpoint base points must be finite.')
  const nodes = new Map(checkpoint.flow.nodes.map(node => [node.id, node]))
  if (nodes.size !== checkpoint.flow.nodes.length) throw new CheckpointGraphError('Checkpoint node IDs must be unique.')
  const visiting = new Set<string>()
  const memo = new Map<string, number>()
  const unequalRandomBranches: CheckpointScoreAnalysis['unequalRandomBranches'] = []
  const unequalAutomaticBranches: CheckpointScoreAnalysis['unequalAutomaticBranches'] = []
  const visit = (nodeId: string): number => {
    const cached = memo.get(nodeId)
    if (cached !== undefined) return cached
    const node = nodes.get(nodeId)
    if (!node) throw new CheckpointGraphError(`Checkpoint flow references unknown node "${nodeId}".`)
    if (visiting.has(nodeId)) throw new CheckpointGraphError('Checkpoint flow must not contain a cycle.')
    visiting.add(nodeId)
    const destinations = primaryDestinations(node)
    if (node.type !== 'complete' && !destinations.length) throw new CheckpointGraphError(`Checkpoint node "${node.id}" has no destination.`)
    const destinationScores = destinations.map(visit)
    if (node.type === 'random_branch' && new Set(destinationScores).size > 1) {
      unequalRandomBranches.push({ nodeId: node.id, choiceScores: destinationScores })
    }
    if (node.type === 'branch' && new Set(destinationScores).size > 1) {
      unequalAutomaticBranches.push({
        nodeId: node.id,
        conditionType: node.condition.type,
        ...(node.condition.type === 'variable' ? { variableKey: node.condition.key } : {}),
        choiceScores: destinationScores,
      })
    }
    const continuationScores = [...destinationScores]
    if ('fallback' in node && node.fallback) continuationScores.push(visit(node.fallback.nodeId))
    const bestContinuation = continuationScores.length ? Math.max(...continuationScores) : 0
    const total = nodeAward(node) + bestContinuation
    visiting.delete(nodeId)
    memo.set(nodeId, total)
    return total
  }
  const flowMaximum = visit(checkpoint.flow.startNodeId)
  const timeBonus = checkpoint.timeBonus?.rankingImpact === 'excluded' ? 0 : Math.max(0, checkpoint.timeBonus?.points ?? 0)
  const profitableHintPuzzles = checkpoint.hints.reduce((total, hint) => {
    if (hint.enabled === false) return total
    if (hint.content.type !== 'puzzle') return total
    return total + Math.max(0, puzzleMaximumBonus(hint.content.puzzle) - Math.max(0, hint.cost))
  }, 0)
  return {
    maximumScore: checkpoint.basePoints + timeBonus + flowMaximum + profitableHintPuzzles,
    unequalRandomBranches,
    unequalAutomaticBranches,
  }
}

/** Maximum obtainable score for one checkpoint, independent of penalties. */
export function checkpointMaximumScore(checkpoint: CheckpointDefinition): number {
  return analyzeCheckpointScore(checkpoint).maximumScore
}

function durationFromEstimate(
  estimate: { estimatedDurationMinutes?: number; durationMinutes?: number; difficulty?: number } | undefined,
  minutesPerDifficultyPoint: number,
): number | undefined {
  const explicit = estimate?.estimatedDurationMinutes ?? estimate?.durationMinutes
  if (explicit !== undefined) return Number.isFinite(explicit) && explicit >= 0 ? explicit : undefined
  if (estimate?.difficulty !== undefined) return estimate.difficulty * minutesPerDifficultyPoint
  return undefined
}

function travelMinutes(estimate: TravelEstimate | undefined, walkingSpeed: number): number | undefined {
  if (!estimate) return undefined
  if (estimate.durationMinutes !== undefined) return Number.isFinite(estimate.durationMinutes) && estimate.durationMinutes >= 0 ? estimate.durationMinutes : undefined
  if (estimate.distanceMeters !== undefined && Number.isFinite(estimate.distanceMeters) && estimate.distanceMeters >= 0) {
    return estimate.distanceMeters / walkingSpeed
  }
  return undefined
}

function findTravel(definition: V3Definition, from: string, to: string): TravelEstimate | undefined {
  return definition.settings.routePlan.travelEstimates.find(estimate => estimate.from === from && estimate.to === to) ??
    definition.settings.routePlan.travelEstimates.find(estimate => estimate.bidirectional && estimate.from === to && estimate.to === from)
}

interface VariantChoice {
  routeCheckpointId: string
  variant?: ChallengeVariant
  checkpointId: string
}

function variantChoices(definition: V3Definition, routeCheckpointId: string): VariantChoice[] {
  const pool = definition.settings.challengePools[routeCheckpointId]
  if (!pool) return [{ routeCheckpointId, checkpointId: routeCheckpointId }]
  return pool.variants.map(variant => ({ routeCheckpointId, variant, checkpointId: variant.checkpointId }))
}

function routeVariantProducts(
  definition: V3Definition,
  route: readonly string[],
  remainingCapacity: () => number,
): { choices: VariantChoice[][]; truncated: boolean } {
  const dimensions = route.map(routeCheckpointId => variantChoices(definition, routeCheckpointId))
  const choices: VariantChoice[][] = []
  const current: VariantChoice[] = []
  let truncated = false
  const visit = (dimension: number) => {
    if (truncated) return
    if (dimension === dimensions.length) {
      if (remainingCapacity() - choices.length <= 0) {
        truncated = true
        return
      }
      choices.push([...current])
      return
    }
    for (const choice of dimensions[dimension]) {
      current.push(choice)
      visit(dimension + 1)
      current.pop()
      if (truncated) return
    }
  }
  visit(0)
  return { choices, truncated }
}

function formatRoute(route: readonly string[], variants: readonly VariantChoice[]): string {
  return route.map((checkpointId, index) => variants[index].variant ? `${checkpointId}:${variants[index].variant!.id}` : checkpointId).join(' > ')
}

/**
 * Proves score equality and checks estimated-duration tolerance for every
 * eligible physical route and every challenge-pool combination. Any proof
 * space larger than maxResolvedRoutes fails closed instead of sampling.
 */
export function validateFairness(definition: V3Definition): FairnessReport {
  const issues: FairnessIssue[] = []
  const issueKeys = new Set<string>()
  const addIssue = (issue: FairnessIssue) => {
    const key = `${issue.code}\u0000${issue.path}\u0000${issue.message}`
    if (!issueKeys.has(key)) {
      issueKeys.add(key)
      issues.push(issue)
    }
  }
  const policy = definition.settings.fairnessPolicy

  // A dud token can only be submitted while a verify_qr action is active. V3
  // does not yet bind dud opportunities to every possible internal flow path,
  // so a competitive award cannot be proven route-neutral. Keep these delight
  // points visible, but require them to be excluded from official ranking.
  for (const [index, dud] of (definition.dudQrs ?? []).entries()) {
    if ((dud.points ?? 0) !== 0 && dud.rankingImpact !== 'excluded') {
      addIssue({
        code: 'non_neutral_competitive_bonus',
        path: `dudQrs[${index}].rankingImpact`,
        message: 'A scored dud QR is not guaranteed to be reachable on every route. Set rankingImpact to "excluded" so it cannot change official score or rank.',
      })
    }
  }

  // Hint availability depends on runtime state (disabled flags, prerequisite
  // hints, node paths, timing, attempts, and solve expiry). Until that entire
  // state space is part of the proof, positive puzzle rewards inside hints must
  // be non-ranking. Flow-node puzzle rewards remain eligible for the normal
  // exhaustive checkpoint/route ceiling proof below.
  definition.checkpoints.forEach((checkpoint, checkpointIndex) => {
    checkpoint.hints.forEach((hint, hintIndex) => {
      if (hint.content.type !== 'puzzle' || puzzleGrossMaximumBonus(hint.content.puzzle) <= 0) return
      const puzzle = hint.content.puzzle
      if ((puzzle.type === 'word_search' || puzzle.type === 'quiz') && puzzle.bonusRankingImpact === 'excluded') return
      addIssue({
        code: 'non_neutral_competitive_bonus',
        path: `checkpoints[${checkpointIndex}].hints[${hintIndex}].content.puzzle.bonusRankingImpact`,
        message: 'A puzzle bonus inside an optional hint cannot be proven reachable on every route. Set bonusRankingImpact to "excluded" so it cannot change official score or rank.',
      })
    })
  })

  if (!Number.isSafeInteger(policy.maxResolvedRoutes) || policy.maxResolvedRoutes < 1 || policy.maxResolvedRoutes > 100_000 ||
    !Number.isFinite(policy.durationToleranceMinutes) || policy.durationToleranceMinutes < 0 ||
    !Number.isFinite(policy.walkingSpeedMetersPerMinute) || policy.walkingSpeedMetersPerMinute <= 0 ||
    !Number.isFinite(policy.minutesPerDifficultyPoint) || policy.minutesPerDifficultyPoint <= 0) {
    addIssue({ code: 'invalid_route_plan', path: 'settings.fairnessPolicy', message: 'Fairness limits, tolerance, walking speed, and difficulty duration must be valid positive bounds.' })
  }
  const proofLimit = Number.isSafeInteger(policy.maxResolvedRoutes) && policy.maxResolvedRoutes > 0
    ? Math.min(policy.maxResolvedRoutes, 100_000)
    : 1
  const physical = enumerateEligibleRoutes(definition.settings.routePlan, proofLimit)
  physical.issues.forEach(message => addIssue({ code: 'invalid_route_plan', path: 'settings.routePlan', message }))
  if (physical.truncated) addIssue({ code: 'route_limit_exceeded', path: 'settings.fairnessPolicy.maxResolvedRoutes', message: 'Physical route combinations exceed the configured proof limit; publishing cannot prove fairness.' })
  if (!physical.routes.length && !physical.issues.length) addIssue({ code: 'no_eligible_routes', path: 'settings.routePlan', message: 'Route constraints produce no eligible route.' })

  const routeLocationIds = new Set(physical.routes.flat())
  for (const candidate of definition.settings.routePlan.choose.fromCheckpointIds) {
    if (!physical.routes.some(route => route.includes(candidate))) {
      addIssue({ code: 'unreachable_route_choice', path: 'settings.routePlan.choose.fromCheckpointIds', message: `Selectable checkpoint "${candidate}" cannot occur in any eligible route.` })
    }
  }
  for (const poolLocation of Object.keys(definition.settings.challengePools)) {
    if (!routeLocationIds.has(poolLocation)) addIssue({ code: 'invalid_route_plan', path: `settings.challengePools.${poolLocation}`, message: 'Challenge pool is not referenced by any eligible route.' })
  }

  const checkpoints = new Map(definition.checkpoints.map(checkpoint => [checkpoint.id, checkpoint]))
  const scoreCache = new Map<string, number>()
  const scoreCacheBounds = new Map<string, ScoreCacheBounds>()
  const checkpointIndexes = new Map(definition.checkpoints.map((checkpoint, index) => [checkpoint.id, index]))
  const scoreFor = (checkpointId: string, path: string): number => {
    const cached = scoreCache.get(checkpointId)
    if (cached !== undefined) return cached
    const checkpoint = checkpoints.get(checkpointId)
    if (!checkpoint) {
      addIssue({ code: 'unknown_checkpoint', path, message: `Checkpoint "${checkpointId}" does not exist.` })
      return 0
    }
    try {
      const analysis = analyzeCheckpointScore(checkpoint)
      const cacheBounds = checkpointScoreCacheBounds(checkpoint)
      const score = analysis.maximumScore
      scoreCache.set(checkpointId, score)
      scoreCacheBounds.set(checkpointId, cacheBounds)
      if ((checkpoint.wrongAttemptPenalty ?? 0) > 0 && checkpoint.flow.nodes.some(node =>
        node.type === 'verify_answer' || node.type === 'verify_code' || node.type === 'verify_qr')) {
        addIssue({
          code: 'unbounded_score_cache',
          path: `checkpoints[${checkpointIndexes.get(checkpointId)}].wrongAttemptPenalty`,
          message: 'A wrong-attempt penalty can repeat without a lifetime cap and therefore cannot be proven safe for the score cache. Remove the scored penalty and track failures in analytics instead.',
        })
      }
      for (const branch of analysis.unequalRandomBranches) {
        addIssue({
          code: 'unequal_random_branch_scores',
          path: `${path}.flow.nodes.${branch.nodeId}`,
          message: `Seeded branch "${branch.nodeId}" has unequal reachable score ceilings (${branch.choiceScores.join(', ')}).`,
        })
      }
      for (const branch of analysis.unequalAutomaticBranches) {
        const generator = branch.variableKey
          ? definition.settings.variableGenerators[branch.variableKey]
          : undefined
        const label = branch.conditionType === 'variable' && generator && generator.type !== 'literal'
          ? 'Generated-variable branch'
          : `Automatic ${branch.conditionType.replaceAll('_', '-')} branch`
        addIssue({
          code: 'unequal_random_branch_scores',
          path: `${path}.flow.nodes.${branch.nodeId}`,
          message: `${label} "${branch.nodeId}" has unequal reachable score ceilings (${branch.choiceScores.join(', ')}).`,
        })
      }
      return score
    } catch (error) {
      addIssue({ code: 'invalid_checkpoint_graph', path, message: error instanceof Error ? error.message : 'Checkpoint graph is invalid.' })
      return 0
    }
  }
  const cacheBoundsFor = (checkpointId: string, path: string): ScoreCacheBounds => {
    if (!scoreCacheBounds.has(checkpointId)) scoreFor(checkpointId, path)
    return scoreCacheBounds.get(checkpointId) ?? emptyScoreCacheBounds()
  }

  for (const [routeCheckpointId, pool] of Object.entries(definition.settings.challengePools)) {
    const path = `settings.challengePools.${routeCheckpointId}`
    if (!pool.variants.length) addIssue({ code: 'empty_challenge_pool', path: `${path}.variants`, message: `Challenge pool "${pool.id}" has no variants.` })
    if (new Set(pool.variants.map(variant => variant.id)).size !== pool.variants.length) {
      addIssue({ code: 'invalid_route_plan', path: `${path}.variants`, message: `Challenge pool "${pool.id}" has duplicate variant IDs.` })
    }
    const variantScores = pool.variants.map((variant, index) => {
      if (variant.weight !== undefined && (!Number.isFinite(variant.weight) || variant.weight <= 0)) {
        addIssue({ code: 'invalid_route_plan', path: `${path}.variants[${index}].weight`, message: 'Challenge variant weight must be a finite positive number.' })
      }
      const score = scoreFor(variant.checkpointId, `${path}.variants[${index}].checkpointId`)
      if (variant.scoreCeiling !== undefined && variant.scoreCeiling !== score) {
        addIssue({ code: 'variant_score_mismatch', path: `${path}.variants[${index}].scoreCeiling`, message: `Declared score ceiling ${variant.scoreCeiling} does not match calculated ceiling ${score}.` })
      }
      return score
    })
    if (new Set(variantScores).size > 1) {
      addIssue({ code: 'unequal_variant_scores', path: `${path}.variants`, message: `Challenge variants at "${routeCheckpointId}" have different score ceilings (${variantScores.join(', ')}).` })
    }
  }

  const routes: FairnessRouteResult[] = []
  const dudScoreCacheBounds = (definition.dudQrs ?? []).reduce((total, dud) =>
    addScoreCacheBounds(total, scoreCacheEntry(dud.points ?? 0, dud.rankingImpact === 'excluded')),
  emptyScoreCacheBounds())
  let productTruncated = false
  for (const route of physical.routes) {
    const products = routeVariantProducts(definition, route, () => proofLimit - routes.length)
    if (products.truncated) {
      productTruncated = true
      break
    }
    for (const choices of products.choices) {
      let maximumScore = 0
      let routeScoreCacheBounds = dudScoreCacheBounds
      let estimatedDurationMinutes = 0
      const resolvedCheckpointIds = choices.map(choice => choice.checkpointId)
      const duplicateCheckpointIds = [...new Set(resolvedCheckpointIds.filter((checkpointId, index) => resolvedCheckpointIds.indexOf(checkpointId) !== index))]
      if (duplicateCheckpointIds.length) {
        addIssue({
          code: 'duplicate_resolved_checkpoint',
          path: 'settings.challengePools',
          message: `Resolved route "${formatRoute(route, choices)}" reuses engine checkpoint ${duplicateCheckpointIds.map(id => `"${id}"`).join(', ')}. Every physical stop must resolve to a distinct checkpoint.`,
          routeKeys: [formatRoute(route, choices)],
        })
      }
      choices.forEach((choice, index) => {
        const checkpointPath = choice.variant
          ? `settings.challengePools.${choice.routeCheckpointId}.variants`
          : `settings.routePlan`
        maximumScore += scoreFor(choice.checkpointId, checkpointPath)
        routeScoreCacheBounds = addScoreCacheBounds(routeScoreCacheBounds, cacheBoundsFor(choice.checkpointId, checkpointPath))
        const estimate = choice.variant ?? definition.settings.routePlan.checkpointEstimates[choice.routeCheckpointId]
        const duration = durationFromEstimate(estimate, policy.minutesPerDifficultyPoint)
        if (duration === undefined) {
          addIssue({ code: 'missing_duration_estimate', path: choice.variant
            ? `settings.challengePools.${choice.routeCheckpointId}.variants`
            : `settings.routePlan.checkpointEstimates.${choice.routeCheckpointId}`,
          message: `Checkpoint "${choice.routeCheckpointId}" needs a valid duration or difficulty estimate.` })
        } else estimatedDurationMinutes += duration
        if (index > 0) {
          const from = route[index - 1]
          const to = route[index]
          const estimateForTravel = findTravel(definition, from, to)
          const travel = travelMinutes(estimateForTravel, policy.walkingSpeedMetersPerMinute)
          if (travel === undefined && policy.requireTravelEstimates) {
            addIssue({ code: 'missing_travel_estimate', path: 'settings.routePlan.travelEstimates', message: `Travel estimate is missing for ${from} → ${to}.` })
          } else estimatedDurationMinutes += travel ?? 0
        }
      })
      const routeKey = formatRoute(route, choices)
      const cacheLimits: Array<{ value: bigint; limit: bigint; label: string }> = [
        { value: routeScoreCacheBounds.rankingPositive, limit: POSTGRES_INTEGER_MAX, label: 'official positive' },
        { value: routeScoreCacheBounds.rankingNegative, limit: POSTGRES_INTEGER_MIN_MAGNITUDE, label: 'official negative' },
        { value: routeScoreCacheBounds.bonusPositive, limit: POSTGRES_INTEGER_MAX, label: 'excluded-bonus positive' },
        { value: routeScoreCacheBounds.bonusNegative, limit: POSTGRES_INTEGER_MIN_MAGNITUDE, label: 'excluded-bonus negative' },
      ]
      for (const cache of cacheLimits) if (cache.value > cache.limit) {
        addIssue({
          code: 'score_cache_limit_exceeded',
          path: 'settings.routePlan',
          message: `Resolved route "${routeKey}" can accumulate ${cache.value.toString()} ${cache.label} points, exceeding the safe cache magnitude ${cache.limit.toString()}. Reduce or exclude score sources before publishing.`,
          routeKeys: [routeKey],
        })
      }
      routes.push({
        routeKey,
        routeCheckpointIds: [...route],
        checkpointIds: choices.map(choice => choice.checkpointId),
        challengeVariantIds: choices.flatMap(choice => choice.variant ? [choice.variant.id] : []),
        maximumScore,
        estimatedDurationMinutes,
      })
    }
  }
  if (productTruncated) addIssue({ code: 'route_limit_exceeded', path: 'settings.fairnessPolicy.maxResolvedRoutes', message: 'Resolved route and challenge combinations exceed the configured proof limit; publishing cannot prove fairness.' })

  const distinctScores = new Map<number, string[]>()
  for (const route of routes) distinctScores.set(route.maximumScore, [...(distinctScores.get(route.maximumScore) ?? []), route.routeKey])
  if (distinctScores.size > 1) {
    const summary = [...distinctScores.entries()].map(([score, routeKeys]) => `${score}: ${routeKeys.join(', ')}`).join('; ')
    addIssue({ code: 'unequal_route_scores', path: 'settings.routePlan', message: `Eligible routes have different maximum scores (${summary}).`, routeKeys: routes.map(route => route.routeKey) })
  }

  const durations = routes.map(route => route.estimatedDurationMinutes)
  const minimumDurationMinutes = durations.length ? Math.min(...durations) : undefined
  const maximumDurationMinutes = durations.length ? Math.max(...durations) : undefined
  if (minimumDurationMinutes !== undefined && maximumDurationMinutes !== undefined && maximumDurationMinutes - minimumDurationMinutes > policy.durationToleranceMinutes + 1e-9) {
    const shortest = routes.filter(route => Math.abs(route.estimatedDurationMinutes - minimumDurationMinutes) < 1e-9).map(route => route.routeKey)
    const longest = routes.filter(route => Math.abs(route.estimatedDurationMinutes - maximumDurationMinutes) < 1e-9).map(route => route.routeKey)
    addIssue({ code: 'route_duration_out_of_tolerance', path: 'settings.fairnessPolicy.durationToleranceMinutes', message: `Estimated duration ranges from ${minimumDurationMinutes.toFixed(2)} to ${maximumDurationMinutes.toFixed(2)} minutes, exceeding the ${policy.durationToleranceMinutes.toFixed(2)} minute tolerance. Shortest: ${shortest.join(', ')}. Longest: ${longest.join(', ')}.`, routeKeys: [...shortest, ...longest] })
  }

  return {
    valid: issues.length === 0,
    evaluatedRouteCount: routes.length,
    ...(routes.length ? { maximumScore: Math.max(...routes.map(route => route.maximumScore)) } : {}),
    ...(minimumDurationMinutes !== undefined ? { minimumDurationMinutes } : {}),
    ...(maximumDurationMinutes !== undefined ? { maximumDurationMinutes } : {}),
    routes,
    issues,
  }
}
