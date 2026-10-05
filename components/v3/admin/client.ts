import type {
  AnalyticsBreakdownRow,
  AnalyticsResponse,
  LiveAlert,
  LiveOperationsResponse,
  LiveRun,
  LiveTeam,
  Metric,
  RecognitionAuditResponse,
  ValidationIssue,
} from './types';

export class V3AdminRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'V3AdminRequestError';
  }
}

export async function adminRequest<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new V3AdminRequestError(
        typeof data.error === 'string' ? data.error : 'This request could not be completed. Please try again.',
        response.status,
        Array.isArray(data.issues) ? data.issues.filter(isIssue) : [],
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof V3AdminRequestError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new V3AdminRequestError('The event server took too long to respond. Check the connection and try again.', 408);
    }
    throw new V3AdminRequestError('The event server could not be reached. Check the connection and try again.', 0);
  } finally {
    window.clearTimeout(timeout);
  }
}

function isIssue(value: unknown): value is ValidationIssue {
  return Boolean(value) && typeof value === 'object'
    && typeof (value as ValidationIssue).path === 'string'
    && typeof (value as ValidationIssue).message === 'string';
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};
const text = (...values: unknown[]) => values.find(value => typeof value === 'string') as string | undefined;
const number = (...values: unknown[]) => {
  const value = values.find(item => typeof item === 'number' || (typeof item === 'string' && item.trim() !== ''));
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

function normalizeRun(value: unknown): LiveRun | null {
  if (!value || typeof value !== 'object') return null;
  const row = object(value);
  // A flattened live-team row also has its own team `id`; prefer explicit run
  // identifiers so organizer actions never target the team UUID as a run.
  const id = text(row.runId, row.run_id, row.activeRunId, row.active_run_id, row.id);
  if (!id) return null;
  return {
    id,
    runNumber: number(row.runNumber, row.run_number, row.attemptNumber) ?? 1,
    status: text(row.runStatus, row.run_status, row.status) ?? 'active',
    score: number(row.score, row.points) ?? 0,
    elapsedMilliseconds: number(row.elapsedMilliseconds, row.elapsed_ms) ?? null,
    progress: number(row.progress) ?? null,
    revision: number(row.revision, row.runRevision, row.run_revision, row.activeRunRevision, row.active_run_revision) ?? null,
    timed: row.timed === true || row.activeRunTimed === true || row.active_run_timed === true,
    currentCheckpointId: text(row.currentCheckpointId, row.current_checkpoint_id, row.checkpoint) ?? null,
    currentCheckpointLabel: text(row.currentCheckpointLabel, row.checkpointLabel) ?? null,
    currentNodeId: text(row.currentNodeId, row.current_node_id, row.activeNodeId, row.active_node_id) ?? null,
    currentNodeType: text(row.currentNodeType, row.current_node_type, row.activeNodeType, row.active_node_type) ?? null,
    parallelMechanic: row.parallelMechanic === true || row.parallel_mechanic === true || row.activeParallelMechanic === true || row.active_parallel_mechanic === true,
    routeVariant: text(row.routeVariant, row.route_variant) ?? null,
    challengeVariant: text(row.challengeVariant, row.challenge_variant) ?? null,
    completedAt: text(row.completedAt, row.completed_at) ?? null,
    ...(typeof row.eligible === 'boolean' ? { eligible: row.eligible } : {}),
    ...(typeof row.practice === 'boolean' ? { practice: row.practice } : {}),
  };
}

function normalizeAlerts(value: unknown): LiveAlert[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (typeof item === 'string') return { id: `${index}`, kind: item, label: item.replaceAll('_', ' ') };
    const row = object(item);
    const kind = text(row.kind, row.type) ?? 'warning';
    return {
      id: text(row.id) ?? `${kind}-${index}`,
      kind,
      label: text(row.label, row.message) ?? kind.replaceAll('_', ' '),
      detail: text(row.detail),
      severity: text(row.severity) as LiveAlert['severity'],
    };
  });
}

function normalizeTeam(value: unknown, index: number): LiveTeam {
  const row = object(value);
  const members = Array.isArray(row.memberNames) ? row.memberNames : Array.isArray(row.members) ? row.members : [];
  const memberNames = members.map(member => typeof member === 'string' ? member : text(object(member).name, object(member).displayName)).filter((name): name is string => Boolean(name));
  const activeSource = row.activeRun ?? (row.activeRunId || row.active_run_id ? row : null);
  const rawBestSource = row.bestRun ?? (row.bestRunId || row.best_run_id ? {
    id: row.bestRunId ?? row.best_run_id,
    runNumber: row.bestRunNumber,
    score: row.bestScore,
    elapsedMilliseconds: row.bestElapsedMilliseconds,
    status: 'completed',
  } : null);
  const bestSource = rawBestSource && typeof rawBestSource === 'object'
    ? { ...object(rawBestSource), status: text(object(rawBestSource).status) ?? 'completed' }
    : null;
  return {
    teamId: text(row.teamId, row.team_id, row.id) ?? `team-${index}`,
    code: text(row.code, row.teamCode, row.canonicalCode, row.canonical_code) ?? 'Team',
    displayName: text(row.displayName, row.display_name, row.teamName) ?? null,
    status: text(row.status) ?? 'active',
    approvalStatus: text(row.approvalStatus, row.approval_status) === 'pending' ? 'pending' : 'approved',
    approvalMethod: (() => {
      const method = text(row.approvalMethod, row.approval_method);
      return method === 'automatic' || method === 'organizer' ? method : null;
    })(),
    competitionRevision: number(row.competitionRevision, row.competition_revision) ?? 1,
    memberNames,
    memberCount: number(row.memberCount, row.member_count) ?? memberNames.length,
    checkedInCount: number(row.checkedInCount, row.checked_in_count) ?? 0,
    runCount: number(row.runCount, row.run_count) ?? 0,
    activeRun: normalizeRun(activeSource),
    bestRun: normalizeRun(bestSource),
    alerts: normalizeAlerts(row.alerts),
    lastActivityAt: text(row.lastActivityAt, row.last_activity_at) ?? null,
  };
}

export function normalizeLiveResponse(value: unknown): LiveOperationsResponse {
  const data = object(value);
  const teams = Array.isArray(data.teams) ? data.teams.map(normalizeTeam) : [];
  const huntRows = Array.isArray(data.hunts) ? data.hunts.map(object) : [];
  const selectedId = text(data.selectedHuntId, data.selected_hunt_id);
  const selected = huntRows.find(hunt => hunt.id === selectedId) ?? huntRows[0];
  const nestedBoard = object(selected?.publicBoard);
  const boardSource = data.publicBoard && typeof data.publicBoard === 'object'
    ? object(data.publicBoard)
    : nestedBoard;
  const boardSlug = text(boardSource.slug);
  const boardStatus = text(boardSource.status);
  const boardColumns = Array.isArray(boardSource.columns)
    ? boardSource.columns.filter((column): column is string => typeof column === 'string')
    : [];
  const publicBoard = Object.keys(boardSource).length ? {
    enabled: boardSource.enabled === true,
    slug: boardSlug ?? null,
    url: text(boardSource.url) ?? (boardSlug ? `/board/${boardSlug}` : null),
    title: text(boardSource.title),
    cover: text(boardSource.cover) ?? null,
    status: (boardStatus === 'frozen' || boardStatus === 'final' ? boardStatus : 'live') as 'live' | 'frozen' | 'final',
    // Code-only is the privacy-safe fallback when an older response omits the setting.
    showTeamNames: boardSource.showTeamNames === true,
    mainBoardVisible: boardSource.mainBoardVisible !== false,
    replayBoardVisible: boardSource.replayBoardVisible === true,
    columns: boardColumns,
  } : null;
  const alertTotals = object(data.alerts);
  return {
    ...(data.hunt && typeof data.hunt === 'object'
      ? { hunt: data.hunt as LiveOperationsResponse['hunt'] }
      : selected ? { hunt: selected as unknown as LiveOperationsResponse['hunt'] } : {}),
    generatedAt: text(data.generatedAt, data.generated_at, data.measuredAt, data.measured_at) ?? new Date().toISOString(),
    teams,
    ...(publicBoard ? { publicBoard } : {}),
    ...(Object.keys(alertTotals).length ? { alerts: {
      help: number(alertTotals.help) ?? 0,
      photos: number(alertTotals.photos) ?? 0,
      stalled: number(alertTotals.stalled) ?? 0,
      fairness: number(alertTotals.fairness) ?? 0,
    } } : {}),
  };
}

function normalizeMetric(value: unknown, index: number): Metric {
  const row = object(value);
  if (typeof value === 'number' || typeof value === 'string') return { label: `Metric ${index + 1}`, value };
  return {
    label: text(row.label, row.name, row.key) ?? `Metric ${index + 1}`,
    value: (typeof row.value === 'number' || typeof row.value === 'string') ? row.value : number(row.count) ?? 0,
    detail: text(row.detail, row.description),
  };
}

function metrics(value: unknown): Metric[] {
  if (Array.isArray(value)) return value.map(normalizeMetric);
  const row = object(value);
  return Object.entries(row).map(([label, metric]) => ({ label: label.replaceAll('_', ' '), value: typeof metric === 'number' || typeof metric === 'string' ? metric : 0 }));
}

function normalizeRows(value: unknown): AnalyticsBreakdownRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const row = object(item);
    return {
      id: text(row.id) ?? `${index}`,
      label: text(row.label, row.name, row.title, row.checkpointId, row.checkpoint_id, row.variantId, row.variant_id, row.category)
        ?? (Array.isArray(row.route) ? row.route.join(' → ') : `Item ${index + 1}`),
      value: number(row.value, row.count, row.credits, row.teams),
      attempts: number(row.attempts, row.starts, row.runs, row.events),
      completions: number(row.completions, row.completed),
      failures: number(row.failures),
      hints: number(row.hints),
      abandonments: number(row.abandonments),
      medianMilliseconds: number(row.medianMilliseconds, row.median_ms)
        ?? (number(row.median_seconds) === undefined ? null : Number(row.median_seconds) * 1000),
      score: number(row.score, row.averageScore, row.average_score) ?? null,
      durationMilliseconds: number(row.durationMilliseconds, row.averageDurationMilliseconds, row.averageElapsedMilliseconds, row.average_elapsed_ms) ?? null,
      delta: number(row.delta, row.variance, row.improvement) ?? null,
      status: text(row.status),
      detail: text(row.detail, row.description),
    };
  });
}

export function normalizeAnalyticsResponse(value: unknown): AnalyticsResponse {
  const data = object(value);
  const improvement = object(data.improvement);
  const recognition = object(data.recognition);
  const funnelObject = object(data.funnel);
  const peopleLabel = text(data.peopleLabel) ?? 'members';
  const summarySource = data.summary ?? (Object.keys(funnelObject).length ? {
    teams: funnelObject.teams,
    [peopleLabel]: funnelObject.members,
    'checked in': funnelObject.checked_in,
    starts: funnelObject.starts,
    completions: funnelObject.completions,
    replays: funnelObject.replays,
  } : {
    teams: data.teams,
    members: data.members,
    starts: data.starts,
    completions: data.completions,
    replays: data.replays,
  });
  const funnel = Array.isArray(data.funnel) ? data.funnel : Object.keys(funnelObject).length ? [
    { label: 'Registered teams', value: number(funnelObject.teams) ?? 0 },
    { label: 'Runs started', value: number(funnelObject.starts) ?? 0 },
    { label: 'Runs completed', value: number(funnelObject.completions) ?? 0 },
    { label: 'Replay runs', value: number(funnelObject.replays) ?? 0 },
  ] : [];
  const contributionRows = normalizeRows(data.contributions);
  const contributionTotal = contributionRows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  contributionRows.forEach(row => { row.delta = contributionTotal ? (row.value ?? 0) / contributionTotal : 0; });
  const eligibleRecognitionMembers = number(recognition.eligibleMembers, recognition.eligible_members, funnelObject.members);
  const recognitionVoters = number(recognition.voters);
  return {
    generatedAt: text(data.generatedAt, data.generated_at, data.measuredAt, data.measured_at),
    summary: metrics(summarySource),
    funnel: funnel.map((item, index) => {
      const row = object(item);
      return { label: text(row.label, row.stage) ?? `Stage ${index + 1}`, value: number(row.value, row.count) ?? 0, rate: number(row.rate) };
    }),
    improvement: {
      teamsWithReplays: number(improvement.teamsWithReplays, improvement.teams_with_replays, improvement.teams) ?? 0,
      averageScoreImprovement: number(improvement.averageScoreImprovement, improvement.average_score_improvement) ?? 0,
      averageTimeImprovementMilliseconds: number(improvement.averageTimeImprovementMilliseconds, improvement.average_time_improvement_ms) ?? null,
      rows: normalizeRows(improvement.rows),
    },
    checkpoints: normalizeRows(data.checkpoints),
    variants: normalizeRows(data.variants ?? data.fairness ?? data.routes),
    contributions: contributionRows,
    recognition: {
      eligibleMembers: eligibleRecognitionMembers,
      voters: recognitionVoters,
      participationRate: number(recognition.participationRate, recognition.participation_rate)
        ?? (eligibleRecognitionMembers ? (recognitionVoters ?? 0) / eligibleRecognitionMembers : undefined),
      rows: normalizeRows(recognition.rows),
    },
    ties: Array.isArray(data.ties) ? data.ties.map((item, index) => {
      const row = object(item);
      const score = number(row.score) ?? 0;
      const elapsed = number(row.elapsedMilliseconds, row.elapsed_ms) ?? null;
      const completedAt = text(row.completedAt, row.completed_at);
      return {
        id: `${score}-${elapsed ?? 'unknown'}-${completedAt ?? index}`,
        label: `${score} points${elapsed === null ? '' : ` · ${Math.round(elapsed / 1000)} sec`}`,
        value: number(row.teams) ?? 0,
        delta: 0,
        status: 'exact tie',
        detail: completedAt ? `Same completion timestamp: ${completedAt}` : undefined,
      };
    }) : [],
    registration: metrics(data.registration),
  };
}

export function normalizeRecognitionAudit(value: unknown): RecognitionAuditResponse {
  const data = object(value);
  const votes = Array.isArray(data.votes) ? data.votes.map((item, index) => {
    const row = object(item);
    return {
      id: text(row.id) ?? `${index}`,
      voterName: text(row.voterName, row.voter_name) ?? 'Unknown member',
      recipientName: text(row.recipientName, row.recipient_name) ?? 'Unknown member',
      category: text(row.category) ?? 'Recognition',
      subtype: text(row.subtype) ?? '',
      answerPath: Array.isArray(row.answerPath) ? row.answerPath.filter((part): part is string => typeof part === 'string') : undefined,
      updatedAt: text(row.updatedAt, row.updated_at, row.created_at),
    };
  }) : [];
  const contributions = Array.isArray(data.contributions) ? data.contributions.map((item, index) => {
    const row = object(item);
    return {
      id: text(row.id) ?? `${index}`,
      memberId: text(row.memberId, row.member_id) ?? '',
      memberName: text(row.memberName, row.member_name) ?? 'Unknown member',
      category: text(row.category) ?? 'team_spark',
      credit: number(row.credit) ?? 0,
      evidence: text(row.evidence, object(row.evidence).summary),
      occurredAt: text(row.occurredAt, row.created_at),
    };
  }) : [];
  const results = Array.isArray(data.results) ? data.results.map(item => {
    const row = object(item);
    return {
      memberId: text(row.memberId, row.member_id) ?? '',
      memberName: text(row.memberName, row.member_name, row.displayName) ?? 'Unknown member',
      headlineTitle: text(row.override_headline, row.headlineTitle, row.headline_title) ?? 'Team Spark',
      dataTitle: text(row.override_data, row.dataTitle, row.data_title),
      peerTitle: text(row.override_peer, row.peerTitle, row.peer_title),
      explanation: text(row.override_explanation, row.explanation, row.overrideExplanation),
      overridden: Boolean(row.overridden || row.override_id),
    };
  }) : [];
  return {
    ...(data.team && typeof data.team === 'object' ? { team: data.team as RecognitionAuditResponse['team'] } : {}),
    ...(data.run && typeof data.run === 'object' ? { run: data.run as RecognitionAuditResponse['run'] } : {}),
    votes,
    contributions,
    results,
  };
}
