import type {
  ContributionCategory,
  ContributionEvent,
  ContributionStanding,
  PeerRecognitionCategory,
  PeerRecognitionSubtype,
  RecognitionOverride,
  RecognitionResult,
  RecognitionVote,
  TeamMemberIdentity,
} from './types'
import { PEER_RECOGNITION_SUBTYPES } from './types'

const CONTRIBUTION_CATEGORIES: readonly ContributionCategory[] = [
  'trailblazer', 'puzzle_ace', 'codebreaker', 'eagle_eye', 'clutch_player', 'team_spark',
]

export const DEFAULT_TITLE_LIBRARY: Readonly<Record<ContributionCategory, string>> = {
  trailblazer: 'Trailblazer',
  puzzle_ace: 'Puzzle Ace',
  codebreaker: 'Codebreaker',
  eagle_eye: 'Eagle Eye',
  clutch_player: 'Clutch Player',
  team_spark: 'Team Spark',
}

const PEER_LABELS: Readonly<Record<PeerRecognitionSubtype, string>> = {
  word_hunter: 'Word Hunter',
  pattern_breaker: 'Pattern Breaker',
  number_wizard: 'Number Wizard',
  first_finder: 'First Finder',
  swift_scout: 'Swift Scout',
  qr_sprinter: 'QR Sprinter',
  detail_detective: 'Detail Detective',
  logic_linker: 'Logic Linker',
  riddle_reader: 'Riddle Reader',
  calm_captain: 'Calm Captain',
  momentum_maker: 'Momentum Maker',
  helping_hand: 'Helping Hand',
}

const PEER_TO_CONTRIBUTION: Readonly<Record<PeerRecognitionSubtype, ContributionCategory>> = {
  word_hunter: 'puzzle_ace',
  pattern_breaker: 'puzzle_ace',
  number_wizard: 'puzzle_ace',
  first_finder: 'trailblazer',
  swift_scout: 'trailblazer',
  qr_sprinter: 'eagle_eye',
  detail_detective: 'eagle_eye',
  logic_linker: 'codebreaker',
  riddle_reader: 'codebreaker',
  calm_captain: 'team_spark',
  momentum_maker: 'clutch_player',
  helping_hand: 'team_spark',
}

function emptyCategories(): Record<ContributionCategory, number> {
  return {
    trailblazer: 0,
    puzzle_ace: 0,
    codebreaker: 0,
    eagle_eye: 0,
    clutch_player: 0,
    team_spark: 0,
  }
}

export function aggregateContributions(
  members: readonly TeamMemberIdentity[],
  events: readonly ContributionEvent[],
  runIds?: ReadonlySet<string>,
): ContributionStanding[] {
  const memberMap = new Map(members.map(member => [member.teamMemberId, member]))
  if (memberMap.size !== members.length) throw new Error('Team member IDs must be unique.')
  const aggregates = new Map(members.map(member => [member.teamMemberId, {
    member,
    categoryCredits: emptyCategories(),
    evidenceCount: 0,
  }]))
  const seenEvents = new Set<string>()
  for (const event of events) {
    if (seenEvents.has(event.id)) continue
    seenEvents.add(event.id)
    if (runIds && !runIds.has(event.runId)) continue
    if (!event.verified) continue
    if (!Number.isFinite(event.credit) || event.credit <= 0) throw new RangeError('Verified contribution credits must be finite positive numbers.')
    const aggregate = aggregates.get(event.teamMemberId)
    if (!aggregate) throw new Error(`Contribution actor "${event.teamMemberId}" is not a team member.`)
    aggregate.categoryCredits[event.category] += event.credit
    aggregate.evidenceCount++
  }
  const ordered = [...aggregates.values()].map(aggregate => ({
    teamMemberId: aggregate.member.teamMemberId,
    displayName: aggregate.member.displayName,
    rank: 0,
    totalCredit: CONTRIBUTION_CATEGORIES.reduce((sum, category) => sum + aggregate.categoryCredits[category], 0),
    categoryCredits: aggregate.categoryCredits,
    evidenceCount: aggregate.evidenceCount,
  })).sort((left, right) => right.totalCredit - left.totalCredit || right.evidenceCount - left.evidenceCount || left.displayName.localeCompare(right.displayName))
  let rank = 0
  ordered.forEach((standing, index) => {
    if (index === 0 || standing.totalCredit !== ordered[index - 1].totalCredit) rank = index + 1
    standing.rank = rank
  })
  return ordered
}

export function validateRecognitionVote(
  vote: RecognitionVote,
  members: readonly TeamMemberIdentity[],
  allowedSubtypes: Partial<Record<PeerRecognitionCategory, readonly PeerRecognitionSubtype[]>> = PEER_RECOGNITION_SUBTYPES,
): string[] {
  const issues: string[] = []
  const memberIds = new Set(members.map(member => member.teamMemberId))
  if (!memberIds.has(vote.voterMemberId)) issues.push('Voter is not a current team member.')
  if (!memberIds.has(vote.recipientMemberId)) issues.push('Recipient is not a current team member.')
  if (vote.voterMemberId === vote.recipientMemberId) issues.push('Self-recognition is not allowed.')
  if (!(allowedSubtypes[vote.category] ?? []).includes(vote.subtype)) issues.push('Recognition subtype is not available for that category and hunt content.')
  if (!Number.isSafeInteger(vote.revision) || vote.revision < 1) issues.push('Recognition vote revision must be a positive integer.')
  if (!vote.answerPath.length || vote.answerPath.length > 10 || vote.answerPath.some(answer => !answer || answer.length > 200)) issues.push('Recognition answer path must contain 1 to 10 bounded answers.')
  if (!Number.isFinite(Date.parse(vote.createdAt)) || !Number.isFinite(Date.parse(vote.updatedAt))) issues.push('Recognition vote timestamps are invalid.')
  return issues
}

export function isRecognitionWindowOpen(completedAt: string, windowMinutes: number, now: string): boolean {
  const completed = Date.parse(completedAt)
  const current = Date.parse(now)
  return Number.isFinite(completed) && Number.isFinite(current) && Number.isFinite(windowMinutes) && windowMinutes >= 0 && current <= completed + windowMinutes * 60_000
}

function activeVotes(
  votes: readonly RecognitionVote[],
  members: readonly TeamMemberIdentity[],
  runIds?: ReadonlySet<string>,
  allowedSubtypes?: Partial<Record<PeerRecognitionCategory, readonly PeerRecognitionSubtype[]>>,
): RecognitionVote[] {
  const latest = new Map<string, RecognitionVote>()
  for (const vote of votes) {
    if (runIds && !runIds.has(vote.runId)) continue
    const validation = validateRecognitionVote(vote, members, allowedSubtypes)
    if (validation.length) throw new Error(`Invalid recognition vote "${vote.id}": ${validation.join(' ')}`)
    const key = `${vote.runId}\u0000${vote.voterMemberId}`
    const existing = latest.get(key)
    if (!existing || vote.revision > existing.revision ||
      (vote.revision === existing.revision && (Date.parse(vote.updatedAt) > Date.parse(existing.updatedAt) || (Date.parse(vote.updatedAt) === Date.parse(existing.updatedAt) && vote.id > existing.id)))) {
      latest.set(key, vote)
    }
  }
  return [...latest.values()]
}

function dominantCategory(values: Readonly<Record<ContributionCategory, number>>): ContributionCategory {
  return CONTRIBUTION_CATEGORIES.reduce((best, category) => values[category] > values[best] ? category : best, 'team_spark')
}

function latestOverrides(overrides: readonly RecognitionOverride[], memberIds: ReadonlySet<string>): Map<string, RecognitionOverride> {
  const result = new Map<string, RecognitionOverride>()
  for (const override of overrides) {
    if (!memberIds.has(override.teamMemberId)) throw new Error('Recognition override recipient is not a team member.')
    if (!override.title.trim() || !override.reason.trim()) throw new Error('Recognition overrides need a title and audit reason.')
    if (!Number.isFinite(Date.parse(override.createdAt))) throw new Error('Recognition override timestamp is invalid.')
    const existing = result.get(override.teamMemberId)
    if (!existing || Date.parse(override.createdAt) > Date.parse(existing.createdAt) || (Date.parse(override.createdAt) === Date.parse(existing.createdAt) && override.id > existing.id)) result.set(override.teamMemberId, override)
  }
  return result
}

export interface CalculateRecognitionInput {
  members: readonly TeamMemberIdentity[]
  contributions: readonly ContributionEvent[]
  votes: readonly RecognitionVote[]
  dataWeight?: number
  peerWeight?: number
  titleLibrary?: Partial<Record<ContributionCategory, string>>
  overrides?: readonly RecognitionOverride[]
  runIds?: ReadonlySet<string>
  allowedSubtypes?: Partial<Record<PeerRecognitionCategory, readonly PeerRecognitionSubtype[]>>
}

export function calculateRecognitionResults(input: CalculateRecognitionInput): RecognitionResult[] {
  const dataWeight = input.dataWeight ?? 0.7
  const peerWeight = input.peerWeight ?? 0.3
  if (![dataWeight, peerWeight].every(value => Number.isFinite(value) && value >= 0) || dataWeight + peerWeight <= 0) {
    throw new RangeError('Recognition weights must be non-negative with a positive total.')
  }
  const weightTotal = dataWeight + peerWeight
  const dataShare = dataWeight / weightTotal
  const peerShare = peerWeight / weightTotal
  if (Object.values(input.titleLibrary ?? {}).some(title => typeof title !== 'string' || !title.trim() || title.length > 100)) {
    throw new RangeError('Custom recognition titles must contain 1 to 100 characters.')
  }
  const titles = { ...DEFAULT_TITLE_LIBRARY, ...(input.titleLibrary ?? {}) }
  const standings = aggregateContributions(input.members, input.contributions, input.runIds)
  const votes = activeVotes(input.votes, input.members, input.runIds, input.allowedSubtypes)
  const overrides = latestOverrides(input.overrides ?? [], new Set(input.members.map(member => member.teamMemberId)))

  return standings.map(standing => {
    const memberVotes = votes.filter(vote => vote.recipientMemberId === standing.teamMemberId)
    const contributionTotal = standing.totalCredit
    const peerCounts = emptyCategories()
    for (const vote of memberVotes) peerCounts[PEER_TO_CONTRIBUTION[vote.subtype]]++
    const peerTotal = memberVotes.length
    const blended = emptyCategories()
    for (const category of CONTRIBUTION_CATEGORIES) {
      const serverSupport = contributionTotal ? standing.categoryCredits[category] / contributionTotal : 0
      const peerSupport = peerTotal ? peerCounts[category] / peerTotal : 0
      blended[category] = serverSupport * dataShare + peerSupport * peerShare
    }
    const calculatedCategory = contributionTotal || peerTotal ? dominantCategory(blended) : 'team_spark'
    const calculatedTitle = titles[calculatedCategory]
    const dataCategory = contributionTotal ? dominantCategory(standing.categoryCredits) : 'team_spark'
    const evidence = [...new Map(input.contributions
      .filter(event => event.verified && event.teamMemberId === standing.teamMemberId && event.category === dataCategory && (!input.runIds || input.runIds.has(event.runId)))
      .map(event => [event.id, event.evidence])).values()]

    const voteCounts = new Map<string, { vote: RecognitionVote; count: number }>()
    for (const vote of memberVotes) {
      const key = `${vote.category}\u0000${vote.subtype}`
      const item = voteCounts.get(key)
      if (item) item.count++
      else voteCounts.set(key, { vote, count: 1 })
    }
    const peer = [...voteCounts.values()].sort((left, right) => right.count - left.count || left.vote.subtype.localeCompare(right.vote.subtype))[0]
    const override = overrides.get(standing.teamMemberId)
    return {
      teamMemberId: standing.teamMemberId,
      displayName: standing.displayName,
      blendedTitle: override?.title ?? calculatedTitle,
      calculatedTitle,
      dataAchievement: {
        category: dataCategory,
        label: titles[dataCategory],
        credit: standing.categoryCredits[dataCategory],
        evidenceCount: evidence.length,
        evidenceSummary: evidence.slice(0, 3),
      },
      ...(peer ? { peerRecognition: {
        category: peer.vote.category,
        subtype: peer.vote.subtype,
        label: PEER_LABELS[peer.vote.subtype],
        votes: peer.count,
        explanation: `${peer.count} teammate${peer.count === 1 ? '' : 's'} celebrated this strength.`,
      } } : {}),
      ...(override ? { override } : {}),
    }
  })
}
