import test from 'node:test'
import assert from 'node:assert/strict'
import type { CheckpointDefinition, FlowNode } from '../lib/engine/types'
import {
  aggregateContributions,
  buildMainLeaderboard,
  buildReplayLeaderboard,
  calculateRecognitionResults,
  checkpointMaximumScore,
  deterministicIndex,
  enumerateEligibleRoutes,
  isRecognitionWindowOpen,
  planRun,
  planRunForFairnessRoute,
  publicParallelMechanics,
  renderVariableTemplate,
  resolveIntegrityPolicy,
  resolveVariables,
  selectBalancedPlan,
  validateFairness,
  validateParallelMechanics,
  validateRecognitionVote,
  VariableResolutionError,
  type CompletedRunRecord,
  type ContributionEvent,
  type RecognitionVote,
  type TeamMemberIdentity,
  type V3Definition,
} from '../lib/v3'

function checkpoint(id: string, points: number): CheckpointDefinition {
  return {
    id,
    title: id,
    basePoints: points,
    flow: { startNodeId: 'done', nodes: [{ id: 'done', type: 'complete' }] },
    hints: [],
  }
}

function definition(): V3Definition {
  return {
    schemaVersion: 3,
    id: 'v3-hunt',
    version: 7,
    title: 'V3 Hunt',
    checkpoints: [
      checkpoint('start', 10),
      checkpoint('library-qr', 20),
      checkpoint('library-riddle', 20),
      checkpoint('park', 20),
      checkpoint('finale', 10),
      {
        id: 'parallel', title: 'Parallel', basePoints: 20,
        flow: { startNodeId: 'gate', nodes: [
          { id: 'gate', type: 'verify_organizer', prompt: 'Finish both lanes.', next: 'done' },
          { id: 'done', type: 'complete' },
        ] },
        hints: [],
      },
    ],
    settings: {
      minTeamSize: 3,
      maxTeamSize: 4,
      registrationMode: 'rostered',
      integrityPolicy: {
        locationVerification: 'strict',
        selfServeApproval: 'organizer',
        rosterParticipation: 'freeze_at_run_start',
      },
      runPolicy: { mode: 'unlimited' },
      leaderboardPolicy: {
        bestRunRule: 'score_then_time_then_completion', mainBoardEnabled: true,
        replayBoardEnabled: true, replayBoardPublic: false,
        timeVisibility: 'after_second_eligible_run', showProgress: true,
      },
      publicBoard: {
        enabled: false, status: 'live', teamIdentity: 'code_and_name',
        columns: ['rank', 'team_code', 'team_name', 'points'],
      },
      socialShare: { enabled: true, allowPersonalTitle: true },
      recognition: { enabled: true, peerVotingEnabled: true, votingWindowMinutes: 60, dataWeight: 0.7, peerWeight: 0.3 },
      routePlan: {
        startCheckpointId: 'start', finaleCheckpointId: 'finale', requiredCheckpointIds: [],
        choose: { count: 1, fromCheckpointIds: ['library', 'park'] },
        checkpointEstimates: {
          start: { durationMinutes: 2 }, park: { durationMinutes: 5 }, finale: { durationMinutes: 2 },
        },
        travelEstimates: [
          { from: 'start', to: 'library', durationMinutes: 1 },
          { from: 'library', to: 'finale', durationMinutes: 1 },
          { from: 'start', to: 'park', durationMinutes: 1 },
          { from: 'park', to: 'finale', durationMinutes: 1 },
        ],
      },
      challengePools: {
        library: { id: 'library-pool', variants: [
          { id: 'qr', checkpointId: 'library-qr', estimatedDurationMinutes: 5 },
          { id: 'riddle', checkpointId: 'library-riddle', estimatedDurationMinutes: 5 },
        ] },
      },
      variableGenerators: {
        colour: { type: 'choice', values: ['BLUE', 'GREEN', 'RED'] },
        code: { type: 'code', alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', length: 7 },
        number: { type: 'integer', minimum: 2, maximum: 10, step: 2 },
      },
      fairnessPolicy: {
        minimumDistinctPlans: 3,
        durationToleranceMinutes: 0,
        maxResolvedRoutes: 100,
        requireTravelEstimates: true,
        walkingSpeedMetersPerMinute: 75,
        minutesPerDifficultyPoint: 3,
      },
      parallelMechanics: [{
        id: 'split-finish', checkpointId: 'parallel', nodeId: 'gate', timeWindowSeconds: 60,
        lanes: [
          { id: 'north', label: 'North QR', type: 'qr', token: 'PRIVATE-QR' },
          { id: 'south', label: 'South code', type: 'code', code: 'PRIVATE-CODE' },
          { id: 'proof', label: 'Fresh photo', type: 'photo' },
        ],
      }],
    },
  }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

test('integrity policy resolution fails closed field by field for legacy or malformed published data', () => {
  assert.deepEqual(resolveIntegrityPolicy(undefined), {
    locationVerification: 'strict',
    selfServeApproval: 'organizer',
    rosterParticipation: 'freeze_at_run_start',
  })
  assert.deepEqual(resolveIntegrityPolicy({
    integrityPolicy: {
      locationVerification: 'gps_photo',
      selfServeApproval: 'not-a-mode',
    },
  }), {
    locationVerification: 'gps_photo',
    selfServeApproval: 'organizer',
    rosterParticipation: 'freeze_at_run_start',
  })
})

function scoreBoundaryDefinition(totalMagnitude: number, options: { excluded: boolean; negative: boolean }): V3Definition {
  const amounts: number[] = []
  let remaining = totalMagnitude
  while (remaining > 0) {
    const amount = Math.min(1_000_000, remaining)
    amounts.push(options.negative ? -amount : amount)
    remaining -= amount
  }
  const checkpointCount = Math.ceil(amounts.length / 199)
  const checkpoints = Array.from({ length: checkpointCount }, (_, checkpointIndex): CheckpointDefinition => {
    const slice = amounts.slice(checkpointIndex * 199, (checkpointIndex + 1) * 199)
    const nodes: FlowNode[] = slice.map((amount, nodeIndex) => ({
      id: `award-${nodeIndex}`,
      type: 'add_points',
      amount,
      label: 'Boundary award',
      ...(options.excluded ? { rankingImpact: 'excluded' as const } : {}),
      next: nodeIndex === slice.length - 1 ? 'done' : `award-${nodeIndex + 1}`,
    }))
    nodes.push({ id: 'done', type: 'complete' })
    return {
      id: `boundary-${checkpointIndex}`,
      title: `Boundary ${checkpointIndex}`,
      basePoints: 0,
      flow: { startNodeId: slice.length ? 'award-0' : 'done', nodes },
      hints: [],
    }
  })
  const hunt = definition()
  hunt.checkpoints = checkpoints
  hunt.settings.routePlan = {
    startCheckpointId: checkpoints[0].id,
    finaleCheckpointId: checkpoints.at(-1)!.id,
    requiredCheckpointIds: checkpoints.slice(1, -1).map(checkpoint => checkpoint.id),
    choose: { count: 0, fromCheckpointIds: [] },
    checkpointEstimates: Object.fromEntries(checkpoints.map(checkpoint => [checkpoint.id, { durationMinutes: 1 }])),
    travelEstimates: [],
  }
  hunt.settings.challengePools = {}
  hunt.settings.fairnessPolicy.requireTravelEstimates = false
  hunt.settings.fairnessPolicy.durationToleranceMinutes = 0
  delete hunt.settings.parallelMechanics
  return hunt
}

test('private-seed resolution is deterministic, domain-separated, and seed-free', () => {
  const hunt = definition()
  const first = planRun(hunt, 'a-private-server-seed')
  const repeat = planRun(hunt, 'a-private-server-seed')
  assert.deepEqual(repeat, first)
  assert.equal(first.routeCheckpointIds[0], 'start')
  assert.equal(first.routeCheckpointIds.at(-1), 'finale')
  assert.equal(first.routeCheckpointIds.length, 3)
  assert.equal(first.checkpointIds.length, 3)
  assert.ok(!JSON.stringify(first).includes('a-private-server-seed'))
  assert.notEqual(resolveVariables('another-seed', hunt.settings.variableGenerators).code, first.variables.code)
  assert.equal(deterministicIndex('seed', 'one-domain', 10, 'x'), deterministicIndex('seed', 'one-domain', 10, 'x'))
})

test('balanced plan allocation prevents per-team repeats until the deck is exhausted and balances teams', () => {
  const hunt = definition()
  const routes = validateFairness(hunt).routes
  assert.equal(routes.length, 3)
  const usage: Array<{ routeKey: string; teamId: string }> = []
  const teamOne = Array.from({ length: routes.length }, (_, index) => {
    const selection = selectBalancedPlan(routes, usage, 'team-one', `seed-one-${index}`)
    usage.push({ routeKey: selection.route.routeKey, teamId: 'team-one' })
    return selection
  })
  assert.equal(new Set(teamOne.map(selection => selection.route.routeKey)).size, routes.length)
  assert.deepEqual(teamOne.map(selection => selection.cycle), [0, 0, 0])

  const repeat = selectBalancedPlan(routes, usage, 'team-one', 'seed-one-repeat')
  assert.equal(repeat.cycle, 1)
  const otherTeam = selectBalancedPlan(routes, usage, 'team-two', 'seed-two')
  assert.equal(otherTeam.eventUseCount, 1, 'new teams receive one of the event-wide least-used plans')

  const materialized = planRunForFairnessRoute(hunt, 'fresh-private-seed', routes[0])
  assert.deepEqual(materialized.routeCheckpointIds, routes[0].routeCheckpointIds)
  assert.deepEqual(materialized.checkpointIds, routes[0].checkpointIds)
  assert.ok(!JSON.stringify(materialized).includes('fresh-private-seed'))
})

test('route planning enumerates choices and permutations while enforcing avoided transitions', () => {
  const enumeration = enumerateEligibleRoutes({
    startCheckpointId: 'start', finaleCheckpointId: 'finale', requiredCheckpointIds: ['required'],
    choose: { count: 1, fromCheckpointIds: ['a', 'b'] },
    avoidTransitions: [{ from: 'start', to: 'required' }],
    checkpointEstimates: {}, travelEstimates: [],
  }, 20)
  assert.equal(enumeration.truncated, false)
  assert.deepEqual(enumeration.issues, [])
  assert.deepEqual(enumeration.routes, [
    ['start', 'a', 'required', 'finale'],
    ['start', 'b', 'required', 'finale'],
  ])
})

test('route enumeration bounds huge combination and permutation spaces before materializing them', { timeout: 1_000 }, () => {
  const result = enumerateEligibleRoutes({
    startCheckpointId: 'start',
    finaleCheckpointId: 'finale',
    requiredCheckpointIds: [],
    choose: { count: 50, fromCheckpointIds: Array.from({ length: 100 }, (_, index) => `place-${index}`) },
    shuffleSelectedCheckpoints: true,
    avoidTransitions: [],
    checkpointEstimates: {},
    travelEstimates: [],
  }, 100)
  assert.equal(result.truncated, true)
  assert.equal(result.routes.length, 100)
  assert.deepEqual(result.issues, [])
})

test('adding a variable does not reroll existing generated values and placeholders stay safe', () => {
  const generators = definition().settings.variableGenerators
  const original = resolveVariables('stable-seed', generators)
  const extended = resolveVariables('stable-seed', { ...generators, extra: { type: 'choice', values: ['A', 'B'] } })
  assert.deepEqual({ colour: extended.colour, code: extended.code, number: extended.number }, original)
  assert.equal(renderVariableTemplate('Find the {{ colour }} marker and enter {{code}}.', original), `Find the ${original.colour} marker and enter ${original.code}.`)
  assert.throws(() => renderVariableTemplate('Find {{missing}}.', original), (error: unknown) => error instanceof VariableResolutionError && error.code === 'unknown_variable')
  assert.throws(() => renderVariableTemplate('Do {{colour + 1}}.', original), (error: unknown) => error instanceof VariableResolutionError && error.code === 'invalid_template')
})

test('fairness validation exhaustively accepts equal route and challenge ceilings', () => {
  const report = validateFairness(definition())
  assert.equal(report.valid, true, JSON.stringify(report.issues))
  assert.equal(report.evaluatedRouteCount, 3)
  assert.equal(report.maximumScore, 40)
  assert.equal(report.minimumDurationMinutes, 11)
  assert.equal(report.maximumDurationMinutes, 11)
  assert.deepEqual(new Set(report.routes.map(route => route.maximumScore)), new Set([40]))
})

test('fairness validation fails closed for score, duration, and proof-limit advantages', () => {
  const hunt = definition()
  hunt.checkpoints.find(item => item.id === 'park')!.basePoints = 25
  hunt.settings.routePlan.checkpointEstimates.park.durationMinutes = 8
  hunt.settings.fairnessPolicy.durationToleranceMinutes = 1
  const codes = new Set(validateFairness(hunt).issues.map(issue => issue.code))
  assert.ok(codes.has('unequal_route_scores'))
  assert.ok(codes.has('route_duration_out_of_tolerance'))

  const limited = definition()
  limited.settings.fairnessPolicy.maxResolvedRoutes = 2
  assert.ok(validateFairness(limited).issues.some(issue => issue.code === 'route_limit_exceeded'))
})

test('competitive time tie-breaks require zero tolerance, complete travel estimates, and the configured plan capacity', () => {
  const unsafeClock = definition()
  unsafeClock.settings.fairnessPolicy.durationToleranceMinutes = 1
  unsafeClock.settings.fairnessPolicy.requireTravelEstimates = false
  const clockIssues = validateFairness(unsafeClock).issues
  assert.ok(clockIssues.some(issue => issue.code === 'unsafe_duration_tiebreak' && issue.path.endsWith('durationToleranceMinutes')))
  assert.ok(clockIssues.some(issue => issue.code === 'unsafe_duration_tiebreak' && issue.path.endsWith('requireTravelEstimates')))

  const insufficient = definition()
  insufficient.settings.fairnessPolicy.minimumDistinctPlans = 4
  const variation = validateFairness(insufficient).issues.find(issue => issue.code === 'insufficient_route_variation')
  assert.ok(variation)
  assert.match(variation.message, /produces 3 distinct structural plans/i)
})

test('source-bound bonuses are excluded from or included in the competitive fairness proof', () => {
  const excluded = definition()
  excluded.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'delight',
    nodes: [
      { id: 'delight', type: 'add_points', amount: 7, label: 'Secret flourish', rankingImpact: 'excluded', next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  const excludedReport = validateFairness(excluded)
  assert.equal(excludedReport.valid, true, JSON.stringify(excludedReport.issues))
  assert.deepEqual(new Set(excludedReport.routes.map(route => route.maximumScore)), new Set([40]))

  const competitive = clone(excluded)
  const award = competitive.checkpoints.find(item => item.id === 'park')!.flow.nodes[0]
  if (award.type !== 'add_points') throw new Error('Expected add-points fixture.')
  award.rankingImpact = 'competitive'
  assert.ok(validateFairness(competitive).issues.some(issue => issue.code === 'unequal_route_scores'))
})

test('fairness fails closed for scored dud QRs whose opportunity is not route-bound', () => {
  const competitive = definition()
  competitive.checkpoints.find(item => item.id === 'library-qr')!.flow = {
    startNodeId: 'scan',
    nodes: [
      { id: 'scan', type: 'verify_qr', prompt: 'Scan the marker.', token: 'RIGHT-MARKER', next: 'photo' },
      { id: 'photo', type: 'verify_image', prompt: 'Take a fresh marker photo.', referenceImages: [], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  competitive.dudQrs = [{ token: 'DUD-MARKER', message: 'Fun find!', points: 100 }]
  const report = validateFairness(competitive)
  assert.equal(report.valid, false)
  assert.ok(report.issues.some(issue =>
    issue.code === 'non_neutral_competitive_bonus' && issue.path === 'dudQrs[0].rankingImpact'))
  assert.deepEqual(new Set(report.routes.map(route => route.maximumScore)), new Set([40]), 'unreachable dud points must not inflate route ceilings')

  const excluded = clone(competitive)
  excluded.dudQrs![0].rankingImpact = 'excluded'
  const excludedReport = validateFairness(excluded)
  assert.equal(excludedReport.valid, true, JSON.stringify(excludedReport.issues))
  assert.deepEqual(new Set(excludedReport.routes.map(route => route.maximumScore)), new Set([40]))

  const unscored = clone(competitive)
  unscored.dudQrs = [{ token: 'DUD-MARKER', message: 'Fun find!' }]
  assert.equal(validateFairness(unscored).valid, true)
})

test('fairness excludes disabled hint rewards from ceilings and rejects every competitive hint puzzle bonus', () => {
  const puzzle = {
    type: 'word_search' as const,
    grid: [['A', 'B'], ['B', 'A']],
    words: ['AB', 'BA'],
    minimumWords: 1,
    bonusPerExtraWord: 100,
  }
  const disabledCheckpoint = checkpoint('disabled-hint', 10)
  disabledCheckpoint.hints = [{
    id: 'locked-bonus', title: 'Locked bonus', cost: 0, enabled: false,
    content: { type: 'puzzle', puzzle, reveal: { type: 'text', text: 'Done' } },
  }]
  assert.equal(checkpointMaximumScore(disabledCheckpoint), 10, 'disabled content is not an attainable score ceiling')

  const competitive = definition()
  competitive.checkpoints.find(item => item.id === 'park')!.hints = disabledCheckpoint.hints
  const report = validateFairness(competitive)
  assert.equal(report.valid, false)
  assert.ok(report.issues.some(issue =>
    issue.code === 'non_neutral_competitive_bonus' &&
    issue.path.endsWith('.hints[0].content.puzzle.bonusRankingImpact')))

  const excluded = clone(competitive)
  const excludedPuzzle = excluded.checkpoints.find(item => item.id === 'park')!.hints[0].content
  if (excludedPuzzle.type !== 'puzzle' || excludedPuzzle.puzzle.type !== 'word_search') throw new Error('Expected a word-search hint fixture.')
  excludedPuzzle.puzzle.bonusRankingImpact = 'excluded'
  const excludedReport = validateFairness(excluded)
  assert.equal(excludedReport.valid, true, JSON.stringify(excludedReport.issues))
  assert.deepEqual(new Set(excludedReport.routes.map(route => route.maximumScore)), new Set([40]))
})

test('competitive time bonuses fail closed even when route score ceilings match', () => {
  const hunt = definition()
  for (const checkpoint of hunt.checkpoints) {
    checkpoint.timeBonus = {
      withinSeconds: checkpoint.id === 'library-riddle' ? 1 : 3600,
      points: 10,
    }
  }
  const report = validateFairness(hunt)
  assert.ok(report.issues.some(issue =>
    issue.code === 'non_neutral_competitive_bonus' && issue.path.endsWith('.timeBonus.rankingImpact')),
  'equal maximum points do not prove that route-specific time thresholds are equally attainable')

  for (const checkpoint of hunt.checkpoints) checkpoint.timeBonus!.rankingImpact = 'excluded'
  assert.equal(validateFairness(hunt).issues.some(issue =>
    issue.path.endsWith('.timeBonus.rankingImpact')), false)
})

test('checkpoint ceilings include puzzle rewards earned before taking a fallback', () => {
  const checkpointWithFallback = checkpoint('puzzle-fallback', 10)
  checkpointWithFallback.flow = {
    startNodeId: 'puzzle',
    nodes: [
      {
        id: 'puzzle', type: 'puzzle', prompt: 'Find either word',
        puzzle: {
          type: 'word_search', grid: [['A', 'B'], ['B', 'A']], words: ['AB', 'BA'],
          minimumWords: 1, bonusPerExtraWord: 100,
        },
        next: 'done', fallback: { nodeId: 'fallback-points', label: 'Alternate route', enabled: true },
      },
      { id: 'fallback-points', type: 'add_points', amount: 100, label: 'Alternate route', next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.equal(checkpointMaximumScore(checkpointWithFallback), 210)

  const excluded = clone(checkpointWithFallback)
  const puzzleNode = excluded.flow.nodes[0]
  if (puzzleNode.type !== 'puzzle' || puzzleNode.puzzle.type !== 'word_search') throw new Error('Expected word-search fixture.')
  puzzleNode.puzzle.bonusRankingImpact = 'excluded'
  assert.equal(checkpointMaximumScore(excluded), 110)
})

test('disabled recovery fallbacks cannot inflate an executable route ceiling', () => {
  const disabledFallback: CheckpointDefinition = {
    id: 'disabled-fallback', title: 'Disabled fallback', basePoints: 10, hints: [],
    flow: {
      startNodeId: 'message',
      nodes: [
        {
          id: 'message', type: 'show_text', text: 'Continue.', next: 'done',
          fallback: { nodeId: 'bonus', label: 'Organizer recovery only', enabled: false },
        },
        { id: 'bonus', type: 'add_points', amount: 10, label: 'Unreachable bonus', next: 'done' },
        { id: 'done', type: 'complete' },
      ],
    },
  }
  assert.equal(checkpointMaximumScore(disabledFallback), 10)

  const hunt = definition()
  hunt.checkpoints = hunt.checkpoints.map(item => item.id === 'park'
    ? { ...disabledFallback, id: 'park', title: 'Park' }
    : item)
  assert.ok(validateFairness(hunt).issues.some(issue => issue.code === 'unequal_route_scores'),
    'an unreachable disabled fallback cannot make a lower-scoring route appear equal')
})

test('fairness keeps every official and excluded score cache inside PostgreSQL integer bounds', () => {
  const cases = [
    { excluded: false, negative: false, limit: 2_147_483_647 },
    { excluded: false, negative: true, limit: 2_147_483_648 },
    { excluded: true, negative: false, limit: 2_147_483_647 },
    { excluded: true, negative: true, limit: 2_147_483_648 },
  ]
  for (const boundary of cases) {
    const exact = validateFairness(scoreBoundaryDefinition(boundary.limit, boundary))
    assert.equal(exact.issues.some(issue => issue.code === 'score_cache_limit_exceeded'), false, JSON.stringify({ boundary, issues: exact.issues }))
    const overflow = validateFairness(scoreBoundaryDefinition(boundary.limit + 1, boundary))
    assert.ok(overflow.issues.some(issue => issue.code === 'score_cache_limit_exceeded'), JSON.stringify(boundary))
  }
})

test('fairness rejects unbounded scored retries but permits failure analytics without a score penalty', () => {
  const scoredRetries = definition()
  const park = scoredRetries.checkpoints.find(item => item.id === 'park')!
  park.wrongAttemptPenalty = 1
  park.flow = {
    startNodeId: 'answer',
    nodes: [
      { id: 'answer', type: 'verify_answer', prompt: 'Answer', answers: ['safe'], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.ok(validateFairness(scoredRetries).issues.some(issue =>
    issue.code === 'unbounded_score_cache' && issue.path.endsWith('.wrongAttemptPenalty')))

  delete park.wrongAttemptPenalty
  assert.equal(validateFairness(scoredRetries).issues.some(issue => issue.code === 'unbounded_score_cache'), false)
})

test('challenge variant score assertions are checked against engine graph ceilings', () => {
  const hunt = definition()
  hunt.checkpoints.find(item => item.id === 'library-riddle')!.basePoints = 21
  hunt.settings.challengePools.library.variants[0].scoreCeiling = 99
  const codes = validateFairness(hunt).issues.map(issue => issue.code)
  assert.ok(codes.includes('unequal_variant_scores'))
  assert.ok(codes.includes('variant_score_mismatch'))
})

test('fairness rejects seeded internal branches with different score ceilings', () => {
  const hunt = definition()
  const park = hunt.checkpoints.find(item => item.id === 'park')!
  park.flow = { startNodeId: 'route', nodes: [
    { id: 'route', type: 'random_branch', choices: [{ next: 'five', weight: 1 }, { next: 'two', weight: 1 }] },
    { id: 'five', type: 'add_points', amount: 5, label: 'Five', next: 'done' },
    { id: 'two', type: 'add_points', amount: 2, label: 'Two', next: 'done' },
    { id: 'done', type: 'complete' },
  ] }
  assert.ok(validateFairness(hunt).issues.some(issue => issue.code === 'unequal_random_branch_scores'))

  const variableHunt = definition()
  variableHunt.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'route', nodes: [
      { id: 'route', type: 'branch', condition: { type: 'variable', key: 'colour', equals: 'BLUE' }, ifTrue: 'five', ifFalse: 'two' },
      { id: 'five', type: 'add_points', amount: 5, label: 'Five', next: 'done' },
      { id: 'two', type: 'add_points', amount: 2, label: 'Two', next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.ok(validateFairness(variableHunt).issues.some(issue => issue.message.includes('Generated-variable branch')))
})

test('publication rejects hidden-duration branches, immediate fallbacks, and skewed variant weights', () => {
  const hiddenDuration = definition()
  const park = hiddenDuration.checkpoints.find(item => item.id === 'park')!
  park.flow = {
    startNodeId: 'route',
    nodes: [
      { id: 'route', type: 'random_branch', choices: [{ next: 'instant', weight: 1 }, { next: 'long-task', weight: 1 }] },
      { id: 'instant', type: 'show_text', text: 'Done.', next: 'done' },
      { id: 'long-task', type: 'verify_answer', prompt: 'Solve the long task.', answers: ['answer'], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.ok(validateFairness(hiddenDuration).issues.some(issue => issue.code === 'unmodeled_internal_variation'))

  const timeBranch = definition()
  timeBranch.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'route',
    nodes: [
      {
        id: 'route', type: 'branch', condition: { type: 'time', after: '08:00', before: '17:00' },
        ifTrue: 'short', ifFalse: 'long',
      },
      { id: 'short', type: 'show_text', text: 'Short task.', next: 'done' },
      { id: 'long', type: 'show_text', text: 'Potentially much longer task.', next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.ok(validateFairness(timeBranch).issues.some(issue =>
    issue.code === 'unmodeled_internal_variation' && issue.message.includes('time branches')))

  const playerChoice = definition()
  playerChoice.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'route',
    nodes: [
      {
        id: 'route', type: 'choose_path', prompt: 'Choose.',
        choices: [{ id: 'short', label: 'Short', next: 'short' }, { id: 'long', label: 'Long', next: 'long' }],
      },
      { id: 'short', type: 'show_text', text: 'Short task.', next: 'done' },
      { id: 'long', type: 'show_text', text: 'Potentially much longer task.', next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.ok(validateFairness(playerChoice).issues.some(issue =>
    issue.code === 'unmodeled_internal_variation' && issue.message.includes('Player-selected paths')))

  const fallback = definition()
  fallback.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'code',
    nodes: [
      { id: 'code', type: 'verify_code', prompt: 'Find the code.', code: 'STRONG-CODE', next: 'done', fallback: { nodeId: 'done', label: 'Skip', enabled: true } },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.ok(validateFairness(fallback).issues.some(issue => issue.code === 'competitive_fallback_not_allowed'))

  const weighted = definition()
  weighted.settings.challengePools.library.variants[1].weight = 9
  assert.ok(validateFairness(weighted).issues.some(issue => issue.code === 'unequal_variant_weights'))
})

test('GPS completion paths follow the selected location-verification policy while QR stays protected', () => {
  const gpsOnly = definition()
  gpsOnly.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'gps',
    nodes: [
      { id: 'gps', type: 'verify_gps', prompt: 'Arrive.', latitude: 19, longitude: 73, radiusMeters: 50, maxAccuracyMeters: 30, next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  gpsOnly.settings.integrityPolicy.locationVerification = 'gps_only'
  assert.equal(validateFairness(gpsOnly).issues.some(issue => issue.code === 'gps_requires_companion_evidence'), false)

  const compound = clone(gpsOnly)
  compound.settings.integrityPolicy.locationVerification = 'gps_photo'
  const compoundPark = compound.checkpoints.find(item => item.id === 'park')!
  compoundPark.flow = {
    startNodeId: 'gps',
    nodes: [
      { id: 'gps', type: 'verify_gps', prompt: 'Arrive.', latitude: 19, longitude: 73, radiusMeters: 50, maxAccuracyMeters: 30, next: 'photo' },
      { id: 'photo', type: 'verify_image', prompt: 'Show the current landmark.', referenceImages: [], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.equal(validateFairness(compound).issues.some(issue => issue.code === 'gps_requires_companion_evidence'), false)

  const missingPhoto = clone(gpsOnly)
  missingPhoto.settings.integrityPolicy.locationVerification = 'gps_photo'
  assert.ok(validateFairness(missingPhoto).issues.some(issue =>
    issue.code === 'gps_requires_companion_evidence' && issue.message.includes('photo')))

  const organizerOnly = clone(gpsOnly)
  organizerOnly.settings.integrityPolicy.locationVerification = 'gps_organizer'
  organizerOnly.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'gps',
    nodes: [
      { id: 'gps', type: 'verify_gps', prompt: 'Arrive.', latitude: 19, longitude: 73, radiusMeters: 50, maxAccuracyMeters: 30, next: 'marshal' },
      { id: 'marshal', type: 'verify_organizer', prompt: 'Meet the marshal.', next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.equal(validateFairness(organizerOnly).issues.some(issue => issue.code === 'gps_requires_companion_evidence'), false)
  assert.ok(validateFairness({
    ...compound,
    settings: {
      ...compound.settings,
      integrityPolicy: { ...compound.settings.integrityPolicy, locationVerification: 'gps_organizer' },
    },
  }).issues.some(issue => issue.code === 'gps_requires_companion_evidence'), 'photo alone cannot satisfy organizer mode')

  const strict = clone(organizerOnly)
  strict.settings.integrityPolicy.locationVerification = 'strict'
  strict.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'gps',
    nodes: [
      { id: 'gps', type: 'verify_gps', prompt: 'Arrive.', latitude: 19, longitude: 73, radiusMeters: 50, maxAccuracyMeters: 30, next: 'photo' },
      { id: 'photo', type: 'verify_image', prompt: 'Show the current landmark.', referenceImages: [], next: 'marshal' },
      { id: 'marshal', type: 'verify_organizer', prompt: 'Meet the marshal.', next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.equal(validateFairness(strict).issues.some(issue => issue.code === 'gps_requires_companion_evidence'), false)
  const strictWithoutOrganizer = clone(compound)
  strictWithoutOrganizer.settings.integrityPolicy.locationVerification = 'strict'
  assert.ok(validateFairness(strictWithoutOrganizer).issues.some(issue => issue.code === 'gps_requires_companion_evidence'))

  const qrOnly = definition()
  qrOnly.settings.integrityPolicy.locationVerification = 'gps_only'
  qrOnly.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'qr',
    nodes: [
      { id: 'qr', type: 'verify_qr', prompt: 'Scan the marker.', token: 'private-token', next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.ok(validateFairness(qrOnly).issues.some(issue => issue.code === 'qr_requires_companion_evidence'))

  const qrWithOrganizer = clone(qrOnly)
  qrWithOrganizer.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'qr',
    nodes: [
      { id: 'qr', type: 'verify_qr', prompt: 'Scan the marker.', token: 'private-token', next: 'marshal' },
      { id: 'marshal', type: 'verify_organizer', prompt: 'Show the live location to the marshal.', next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.equal(validateFairness(qrWithOrganizer).issues.some(issue => issue.code === 'qr_requires_companion_evidence'), false)

  const organizerBeforeQr = clone(qrWithOrganizer)
  organizerBeforeQr.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'marshal',
    nodes: [
      { id: 'marshal', type: 'verify_organizer', prompt: 'Meet the marshal.', next: 'qr' },
      { id: 'qr', type: 'verify_qr', prompt: 'Scan later.', token: 'private-token', next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.ok(validateFairness(organizerBeforeQr).issues.some(issue => issue.code === 'qr_requires_companion_evidence'),
    'evidence before the shareable verifier cannot corroborate the later action')

  qrWithOrganizer.settings.parallelMechanics = [{
    id: 'automatic-gate', checkpointId: 'park', nodeId: 'marshal', timeWindowSeconds: 60,
    lanes: [
      { id: 'one', label: 'First code', type: 'code', code: 'PRIVATE-CODE-ONE' },
      { id: 'two', label: 'Second code', type: 'code', code: 'PRIVATE-CODE-TWO' },
    ],
  }]
  assert.ok(validateFairness(qrWithOrganizer).issues.some(issue => issue.code === 'qr_requires_companion_evidence'),
    'a gate completed automatically by parallel lanes is not independent organizer proof')

  qrWithOrganizer.settings.parallelMechanics[0].lanes.push({ id: 'proof', label: 'Fresh proof', type: 'photo' })
  assert.equal(validateFairness(qrWithOrganizer).issues.some(issue => issue.code === 'qr_requires_companion_evidence'), false,
    'a parallel gate backed by a required reviewed-photo lane is independent companion evidence')
})

test('static answers and codes require companion evidence while run-scoped codes do not', () => {
  const staticCode = definition()
  staticCode.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'code',
    nodes: [
      { id: 'code', type: 'verify_code', prompt: 'Enter the code.', code: 'LONG-STATIC-CODE', next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.ok(validateFairness(staticCode).issues.some(issue =>
    issue.code === 'shareable_verifier_requires_companion_evidence'))

  const disabledFallback = clone(staticCode)
  const disabledFallbackPark = disabledFallback.checkpoints.find(item => item.id === 'park')!
  disabledFallbackPark.flow = {
    startNodeId: 'code',
    nodes: [
      {
        id: 'code', type: 'verify_code', prompt: 'Enter the code.', code: 'LONG-STATIC-CODE',
        next: 'photo', fallback: { nodeId: 'done', label: 'Organizer recovery only', enabled: false },
      },
      { id: 'photo', type: 'verify_image', prompt: 'Take fresh proof.', referenceImages: [], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.equal(validateFairness(disabledFallback).issues.some(issue =>
    issue.code === 'shareable_verifier_requires_companion_evidence'), false,
  'a disabled player fallback is not an executable evidence bypass')

  const staticAnswer = clone(staticCode)
  staticAnswer.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'answer',
    nodes: [
      { id: 'answer', type: 'verify_answer', prompt: 'Solve it.', answers: ['LONG STATIC ANSWER'], next: 'photo' },
      { id: 'photo', type: 'verify_image', prompt: 'Photograph today\'s marked object.', referenceImages: [], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.equal(validateFairness(staticAnswer).issues.some(issue =>
    issue.code === 'shareable_verifier_requires_companion_evidence'), false)

  const generated = clone(staticCode)
  generated.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'answer',
    nodes: [
      { id: 'answer', type: 'verify_answer', prompt: 'Enter the run code.', answers: ['{{code}}', 'ALT-{{code}}'], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.equal(validateFairness(generated).issues.some(issue =>
    issue.code === 'shareable_verifier_requires_companion_evidence'), false)

  const independentAlternatives = clone(generated)
  independentAlternatives.settings.variableGenerators.alternateCode = {
    type: 'code', alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', length: 7,
  }
  const independentAnswer = independentAlternatives.checkpoints.find(item => item.id === 'park')!.flow.nodes[0]
  if (independentAnswer.type !== 'verify_answer') throw new Error('Expected answer verifier.')
  independentAnswer.answers.push('{{alternateCode}}')
  assert.ok(validateFairness(independentAlternatives).issues.some(issue =>
    issue.code === 'shareable_verifier_requires_companion_evidence'),
  'independent accepted run codes multiply valid guesses and reduce aggregate verifier entropy')

  const oneStaticAlternative = clone(generated)
  const answerNode = oneStaticAlternative.checkpoints.find(item => item.id === 'park')!.flow.nodes[0]
  if (answerNode.type !== 'verify_answer') throw new Error('Expected answer verifier.')
  answerNode.answers.push('SHARED-BACKDOOR')
  assert.ok(validateFairness(oneStaticAlternative).issues.some(issue =>
    issue.code === 'shareable_verifier_requires_companion_evidence'))

  const staticPuzzle = definition()
  staticPuzzle.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'puzzle',
    nodes: [
      {
        id: 'puzzle', type: 'puzzle', prompt: 'Choose the answer.',
        puzzle: {
          type: 'multiple_choice', prompt: 'Which marker?',
          options: [{ id: 'blue', label: 'Blue' }, { id: 'green', label: 'Green' }],
          correctOptionId: 'blue',
        },
        next: 'done',
      },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.ok(validateFairness(staticPuzzle).issues.some(issue =>
    issue.code === 'shareable_verifier_requires_companion_evidence'),
  'a reusable puzzle solution can be forwarded just like a static answer')

  const generatedTextPuzzle = clone(staticPuzzle)
  generatedTextPuzzle.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'puzzle',
    nodes: [
      {
        id: 'puzzle', type: 'puzzle', prompt: 'Enter this run code.',
        puzzle: { type: 'text', prompt: 'Run code', answers: ['{{code}}'] }, next: 'done',
      },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.equal(validateFairness(generatedTextPuzzle).issues.some(issue =>
    issue.code === 'shareable_verifier_requires_companion_evidence'), false)

  const independentTextAnswers = clone(generatedTextPuzzle)
  independentTextAnswers.settings.variableGenerators.alternateCode = {
    type: 'code', alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', length: 7,
  }
  const textPuzzleNode = independentTextAnswers.checkpoints.find(item => item.id === 'park')!.flow.nodes[0]
  if (textPuzzleNode.type !== 'puzzle' || textPuzzleNode.puzzle.type !== 'text') throw new Error('Expected text puzzle.')
  textPuzzleNode.puzzle.answers.push('{{alternateCode}}')
  assert.ok(validateFairness(independentTextAnswers).issues.some(issue =>
    issue.code === 'shareable_verifier_requires_companion_evidence'))
})

test('shareable hint puzzles require companion evidence on every checkpoint path', () => {
  const staticHint = definition()
  const finale = staticHint.checkpoints.find(item => item.id === 'finale')!
  finale.hints = [{
    id: 'shortcut', title: 'Unlock the clue', cost: 0,
    content: {
      type: 'puzzle',
      puzzle: {
        type: 'multiple_choice', prompt: 'Which one?',
        options: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }],
        correctOptionId: 'one',
      },
      reveal: { type: 'text', text: 'Use your run-specific clue.' },
    },
  }]
  assert.ok(validateFairness(staticHint).issues.some(issue =>
    issue.path.endsWith('.hints[0].content.puzzle') &&
    issue.code === 'shareable_verifier_requires_companion_evidence'))

  const withPhoto = clone(staticHint)
  withPhoto.checkpoints.find(item => item.id === 'finale')!.flow = {
    startNodeId: 'photo',
    nodes: [
      { id: 'photo', type: 'verify_image', prompt: 'Take fresh proof.', referenceImages: [], next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  assert.equal(validateFairness(withPhoto).issues.some(issue =>
    issue.path.endsWith('.hints[0].content.puzzle') &&
    issue.code === 'shareable_verifier_requires_companion_evidence'), false)

  const generatedTextHint = clone(staticHint)
  const hint = generatedTextHint.checkpoints.find(item => item.id === 'finale')!.hints[0]
  if (hint.content.type !== 'puzzle') throw new Error('Expected puzzle hint.')
  hint.content.puzzle = { type: 'text', prompt: 'Enter the private run code.', answers: ['{{code}}'] }
  assert.equal(validateFairness(generatedTextHint).issues.some(issue =>
    issue.path.endsWith('.hints[0].content.puzzle') &&
    issue.code === 'shareable_verifier_requires_companion_evidence'), false)
})

test('parallel static codes require a photo lane but run-scoped generated codes do not', () => {
  const staticCodes = definition()
  staticCodes.settings.parallelMechanics![0].lanes = [
    { id: 'one', label: 'First static code', type: 'code', code: 'STATIC-CODE-ONE' },
    { id: 'two', label: 'Second static code', type: 'code', code: 'STATIC-CODE-TWO' },
  ]
  assert.ok(validateParallelMechanics(staticCodes).some(issue => issue.path.endsWith('.lanes')))

  const generatedCodes = clone(staticCodes)
  generatedCodes.settings.parallelMechanics![0].lanes = [
    { id: 'one', label: 'First run code', type: 'code', code: '{{code}}' },
    { id: 'two', label: 'Second run code', type: 'code', code: 'SOUTH-{{code}}' },
  ]
  assert.deepEqual(validateParallelMechanics(generatedCodes), [])

  const impossibleRoster = clone(staticCodes)
  impossibleRoster.settings.minTeamSize = 2
  impossibleRoster.settings.maxTeamSize = 2
  impossibleRoster.settings.parallelMechanics![0].lanes.push({ id: 'proof', label: 'Fresh proof', type: 'photo' })
  const rosterIssues = validateParallelMechanics(impossibleRoster)
  assert.ok(rosterIssues.some(issue => issue.message.includes('maximum team size')))
  assert.ok(rosterIssues.some(issue => issue.message.includes('Minimum team size')))

  const duplicateGate = clone(generatedCodes)
  duplicateGate.settings.parallelMechanics!.push({
    ...clone(duplicateGate.settings.parallelMechanics![0]),
    id: 'same-gate-second-mechanic',
  })
  assert.ok(validateParallelMechanics(duplicateGate).some(issue =>
    issue.message.includes('Only one parallel mechanic')))
})

test('parallel GPS lanes follow location policy without weakening QR and static-code rules', () => {
  const gpsParallel = definition()
  gpsParallel.settings.integrityPolicy.locationVerification = 'gps_only'
  gpsParallel.checkpoints.find(item => item.id === 'park')!.flow = {
    startNodeId: 'gate',
    nodes: [
      { id: 'gate', type: 'verify_organizer', prompt: 'Finish both lanes.', next: 'done' },
      { id: 'done', type: 'complete' },
    ],
  }
  gpsParallel.settings.parallelMechanics = [{
    id: 'park-split', checkpointId: 'park', nodeId: 'gate', timeWindowSeconds: 60,
    lanes: [
      { id: 'where', label: 'Reach the location', type: 'gps', location: { latitude: 19, longitude: 73, radiusMeters: 50, maxAccuracyMeters: 30 } },
      { id: 'code', label: 'Enter the run code', type: 'code', code: '{{code}}' },
    ],
  }]
  assert.deepEqual(validateParallelMechanics(gpsParallel), [])

  const photoPolicy = clone(gpsParallel)
  photoPolicy.settings.integrityPolicy.locationVerification = 'gps_photo'
  assert.ok(validateParallelMechanics(photoPolicy).some(issue => issue.path.endsWith('.lanes') && issue.message.includes('photo')))
  photoPolicy.settings.parallelMechanics![0].lanes.push({ id: 'proof', label: 'Fresh proof', type: 'photo' })
  assert.deepEqual(validateParallelMechanics(photoPolicy), [])

  const organizerPolicy = clone(gpsParallel)
  organizerPolicy.settings.integrityPolicy.locationVerification = 'gps_organizer'
  assert.deepEqual(validateParallelMechanics(organizerPolicy), [])
  assert.ok(validateFairness(organizerPolicy).issues.some(issue =>
    issue.code === 'gps_requires_companion_evidence' && issue.path.endsWith('.lanes')))
  organizerPolicy.checkpoints.find(item => item.id === 'park')!.flow.nodes = [
    { id: 'gate', type: 'verify_organizer', prompt: 'Finish both lanes.', next: 'marshal' },
    { id: 'marshal', type: 'verify_organizer', prompt: 'Show the location to the marshal.', next: 'done' },
    { id: 'done', type: 'complete' },
  ]
  assert.equal(validateFairness(organizerPolicy).issues.some(issue => issue.code === 'gps_requires_companion_evidence'), false)

  const strict = clone(gpsParallel)
  strict.settings.integrityPolicy.locationVerification = 'strict'
  strict.settings.parallelMechanics![0].lanes.push({ id: 'proof', label: 'Fresh proof', type: 'photo' })
  assert.deepEqual(validateParallelMechanics(strict), [])
  assert.ok(validateFairness(strict).issues.some(issue => issue.code === 'gps_requires_companion_evidence'))
  strict.checkpoints.find(item => item.id === 'park')!.flow.nodes = [
    { id: 'gate', type: 'verify_organizer', prompt: 'Finish all lanes.', next: 'marshal' },
    { id: 'marshal', type: 'verify_organizer', prompt: 'Show the location to the marshal.', next: 'done' },
    { id: 'done', type: 'complete' },
  ]
  assert.equal(validateFairness(strict).issues.some(issue => issue.code === 'gps_requires_companion_evidence'), false)

  const qrStillProtected = clone(gpsParallel)
  qrStillProtected.settings.parallelMechanics![0].lanes[0] = { id: 'where', label: 'Scan the marker', type: 'qr', token: 'PRIVATE-QR' }
  assert.ok(validateParallelMechanics(qrStillProtected).some(issue => issue.path.endsWith('.lanes') && issue.message.includes('QR')))
})

test('fairness rejects every automatic runtime branch with unequal score ceilings', () => {
  const conditions = [
    { type: 'time', after: '08:00', before: '17:00' } as const,
    { type: 'hint_used', hintId: 'help' } as const,
    { type: 'checkpoint_completed', checkpointId: 'start' } as const,
  ]
  for (const condition of conditions) {
    const hunt = definition()
    hunt.checkpoints.find(item => item.id === 'park')!.flow = {
      startNodeId: 'route', nodes: [
        { id: 'route', type: 'branch', condition, ifTrue: 'five', ifFalse: 'two' },
        { id: 'five', type: 'add_points', amount: 5, label: 'Five', next: 'done' },
        { id: 'two', type: 'add_points', amount: 2, label: 'Two', next: 'done' },
        { id: 'done', type: 'complete' },
      ],
    }
    const issue = validateFairness(hunt).issues.find(item => item.code === 'unequal_random_branch_scores')
    assert.ok(issue, `${condition.type} branches must fail publication when score ceilings differ`)
    assert.match(issue.message, new RegExp(condition.type.replaceAll('_', '-')))
  }
})

test('checkpoint ceiling follows only the best reachable branch and includes positive puzzle rewards', () => {
  const branching: CheckpointDefinition = {
    id: 'branching', title: 'Branching', basePoints: 10, timeBonus: { withinSeconds: 30, points: 2 }, hints: [],
    flow: { startNodeId: 'branch', nodes: [
      { id: 'branch', type: 'branch', condition: { type: 'variable', key: 'path', equals: 'a' }, ifTrue: 'five', ifFalse: 'puzzle' },
      { id: 'five', type: 'add_points', amount: 5, label: 'Five', next: 'done' },
      { id: 'puzzle', type: 'puzzle', prompt: 'Words', puzzle: { type: 'word_search', grid: [['A']], words: ['A', 'B', 'C'], minimumWords: 1, bonusPerExtraWord: 4 }, next: 'done' },
      { id: 'done', type: 'complete' },
    ] },
  }
  assert.equal(checkpointMaximumScore(branching), 20)
})

function run(overrides: Partial<CompletedRunRecord> & Pick<CompletedRunRecord, 'runId' | 'teamId' | 'teamCode'>): CompletedRunRecord {
  return {
    attemptNumber: 1, status: 'completed', eligible: true, score: 100,
    elapsedMilliseconds: 600_000, completedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  }
}

test('leaderboards select one best eligible run per team and reveal replay time only after run two', () => {
  const runs: CompletedRunRecord[] = [
    run({ runId: 'a1', teamId: 'a', teamCode: 'T-001', teamName: 'Falcons' }),
    run({ runId: 'a2', teamId: 'a', teamCode: 'T-001', teamName: 'Falcons', attemptNumber: 2, score: 110, elapsedMilliseconds: 900_000, completedAt: '2026-10-01T12:00:00.000Z' }),
    run({ runId: 'b1', teamId: 'b', teamCode: 'T-002', score: 110, elapsedMilliseconds: 840_000, completedAt: '2026-10-01T11:00:00.000Z' }),
    run({ runId: 'c1', teamId: 'c', teamCode: 'T-003', score: 110, elapsedMilliseconds: 840_000, completedAt: '2026-10-01T10:30:00.000Z' }),
    run({ runId: 'practice', teamId: 'd', teamCode: 'T-004', score: 999, practice: true }),
  ]
  const policy = definition().settings.leaderboardPolicy
  const main = buildMainLeaderboard(runs, policy)
  assert.deepEqual(main.map(entry => [entry.teamCode, entry.rank]), [['T-003', 1], ['T-002', 2], ['T-001', 3]])
  assert.equal(main.find(entry => entry.teamCode === 'T-002')?.visibleElapsedMilliseconds, undefined)
  assert.equal(main.find(entry => entry.teamCode === 'T-001')?.visibleElapsedMilliseconds, 900_000)
  assert.ok(!JSON.stringify(main.find(entry => entry.teamCode === 'T-002')).includes('840000'), 'a one-run public row must not leak its tie-break time')

  const replay = buildReplayLeaderboard(runs, policy)
  assert.equal(replay.length, 1)
  assert.equal(replay[0].teamCode, 'T-001')
  assert.equal(replay[0].scoreImprovementFromFirst, 10)
  assert.equal(replay[0].timeImprovementFromFirstMilliseconds, -300_000)
})

test('leaderboard completion ordering preserves PostgreSQL microseconds inside one JavaScript millisecond', () => {
  const runs: CompletedRunRecord[] = [
    run({
      runId: 'ffffffff-ffff-ffff-ffff-ffffffffffff', teamId: 'early', teamCode: 'T-001',
      completedAt: '2026-10-01T10:00:00.000001Z',
    }),
    run({
      runId: '00000000-0000-0000-0000-000000000000', teamId: 'late', teamCode: 'T-002',
      completedAt: '2026-10-01T10:00:00.000002Z',
    }),
    run({
      runId: '11111111-1111-1111-1111-111111111111', teamId: 'tie', teamCode: 'T-003',
      completedAt: '2026-10-01T10:00:00.000002Z',
    }),
  ]
  const main = buildMainLeaderboard(runs, definition().settings.leaderboardPolicy)
  assert.deepEqual(main.map(entry => [entry.teamCode, entry.rank]), [
    ['T-001', 1], ['T-002', 2], ['T-003', 3],
  ])
})

const members: TeamMemberIdentity[] = [
  { teamMemberId: 'm1', displayName: 'Aarav' },
  { teamMemberId: 'm2', displayName: 'Priya' },
  { teamMemberId: 'm3', displayName: 'Rohan' },
]

const contributions: ContributionEvent[] = [
  { id: 'e1', runId: 'r1', teamMemberId: 'm1', category: 'trailblazer', credit: 4, evidence: 'First GPS confirmation', occurredAt: '2026-10-01T10:01:00.000Z', verified: true },
  { id: 'e2', runId: 'r1', teamMemberId: 'm2', category: 'puzzle_ace', credit: 6, evidence: 'Solved word search', occurredAt: '2026-10-01T10:02:00.000Z', verified: true },
  { id: 'e3', runId: 'r1', teamMemberId: 'm2', category: 'codebreaker', credit: 2, evidence: 'Entered final code', occurredAt: '2026-10-01T10:03:00.000Z', verified: true },
]

function vote(overrides: Partial<RecognitionVote> & Pick<RecognitionVote, 'id' | 'voterMemberId' | 'recipientMemberId'>): RecognitionVote {
  return {
    runId: 'r1', category: 'puzzle_power', subtype: 'word_hunter', answerPath: ['Puzzle Power', 'Word Hunter'],
    revision: 1, createdAt: '2026-10-01T11:00:00.000Z', updatedAt: '2026-10-01T11:00:00.000Z',
    ...overrides,
  }
}

test('crew standings are positive-only and blended titles retain data, peer, and audited override layers', () => {
  const standings = aggregateContributions(members, [...contributions, contributions[0]])
  assert.deepEqual(standings.map(item => [item.displayName, item.rank, item.totalCredit]), [
    ['Priya', 1, 8], ['Aarav', 2, 4], ['Rohan', 3, 0],
  ])
  const votes = [
    vote({ id: 'v1', voterMemberId: 'm1', recipientMemberId: 'm2' }),
    vote({ id: 'v2', voterMemberId: 'm3', recipientMemberId: 'm2', subtype: 'pattern_breaker', answerPath: ['Puzzle Power', 'Pattern Breaker'] }),
  ]
  const results = calculateRecognitionResults({
    members, contributions, votes,
    overrides: [{ id: 'o1', teamMemberId: 'm2', title: 'Mastermind', reason: 'Event-specific wording', organizerId: 'organizer', createdAt: '2026-10-01T12:00:00.000Z' }],
  })
  const priya = results.find(result => result.teamMemberId === 'm2')!
  assert.equal(priya.calculatedTitle, 'Puzzle Ace')
  assert.equal(priya.blendedTitle, 'Mastermind')
  assert.equal(priya.dataAchievement.category, 'puzzle_ace')
  assert.equal(priya.peerRecognition?.votes, 1, 'different subtypes remain individually explainable')
  assert.equal(priya.override?.reason, 'Event-specific wording')
})

test('recognition blocks self-voting, applies edits by revision, and closes on time', () => {
  const self = vote({ id: 'self', voterMemberId: 'm1', recipientMemberId: 'm1' })
  assert.ok(validateRecognitionVote(self, members).includes('Self-recognition is not allowed.'))
  assert.equal(isRecognitionWindowOpen('2026-10-01T10:00:00.000Z', 60, '2026-10-01T11:00:00.000Z'), true)
  assert.equal(isRecognitionWindowOpen('2026-10-01T10:00:00.000Z', 60, '2026-10-01T11:00:00.001Z'), false)

  const original = vote({ id: 'old', voterMemberId: 'm1', recipientMemberId: 'm2' })
  const edited = vote({
    id: 'new', voterMemberId: 'm1', recipientMemberId: 'm3', category: 'crew_energy', subtype: 'helping_hand',
    answerPath: ['Crew Energy', 'Helping Hand'], revision: 2, updatedAt: '2026-10-01T11:05:00.000Z',
  })
  const results = calculateRecognitionResults({ members, contributions, votes: [original, edited] })
  assert.equal(results.find(item => item.teamMemberId === 'm2')?.peerRecognition, undefined)
  assert.equal(results.find(item => item.teamMemberId === 'm3')?.peerRecognition?.label, 'Helping Hand')
})

test('parallel mechanic validation requires distinct lanes and public projection removes secrets', () => {
  const hunt = definition()
  assert.deepEqual(validateParallelMechanics(hunt), [])
  const projection = publicParallelMechanics(hunt)
  assert.equal(projection[0].lanes.length, 3)
  assert.ok(!JSON.stringify(projection).includes('PRIVATE'))

  const invalid = clone(hunt)
  invalid.settings.parallelMechanics![0].lanes[1].id = 'north'
  assert.ok(validateParallelMechanics(invalid).some(issue => issue.message.includes('unique')))
})
