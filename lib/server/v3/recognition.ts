import type { PoolClient } from 'pg';
import {
  PEER_RECOGNITION_SUBTYPES,
  type ContributionEvent,
  type PeerRecognitionCategory,
  type PeerRecognitionSubtype,
  type RecognitionVote,
  type TeamMemberIdentity,
  type V3Definition,
} from '../../v3/types';
import { aggregateContributions, calculateRecognitionResults, isRecognitionWindowOpen, validateRecognitionVote } from '../../v3/recognition';
import { getPool, transaction } from '../db';
import { canonicalJson, digest, HttpError } from '../security';
import { lockV3Hunt, lockV3Team } from './locking';
import { assertPublishedIntegrityPolicy } from './runtime';
import { isV3Uuid, rateLimitV3 } from './security';

type RecognitionContext = {
  run: {
    id: string;
    team_id: string;
    hunt_id: string;
    status: string;
    completed_at: string | null;
    recognition_closes_at: string | null;
  };
  definition: V3Definition;
  now: string;
};

async function context(client: PoolClient, teamId: string, runId: string, lock = false): Promise<RecognitionContext> {
  const row = (await client.query(
    `select r.id,r.team_id,r.hunt_id,r.status,r.completed_at,r.recognition_closes_at,v.definition,clock_timestamp() as now
      from hunt_v3.runs r join hunt_v3.hunt_versions v on v.hunt_id=r.hunt_id and v.version=r.hunt_version
      join hunt_v3.teams t on t.id=r.team_id and t.status='active'
      where r.id=$1 and r.team_id=$2${lock ? ' for update of r' : ''}`,
    [runId, teamId],
  )).rows[0];
  if (!row) throw new HttpError(404, 'Run not found.');
  assertPublishedIntegrityPolicy((row.definition as V3Definition).settings);
  return { run: row, definition: row.definition, now: new Date(row.now).toISOString() };
}

async function runMembers(client: PoolClient, runId: string, contributionEligibleOnly = false): Promise<TeamMemberIdentity[]> {
  const { rows } = await client.query(
    `select member_id as "teamMemberId",member_name_snapshot as "displayName"
      from hunt_v3.run_members where run_id=$1 and (not $2::boolean or contribution_eligible)
      order by joined_run_at,member_id`,
    [runId, contributionEligibleOnly],
  );
  return rows;
}

async function contributionEvents(client: PoolClient, runIds: string[]): Promise<ContributionEvent[]> {
  if (!runIds.length) return [];
  const { rows } = await client.query(
    `select id::text,run_id as "runId",member_id as "teamMemberId",category,credit,evidence,created_at as "occurredAt"
      from hunt_v3.run_contributions where run_id=any($1::uuid[]) order by created_at,id`,
    [runIds],
  );
  return rows.map(row => ({
    ...row,
    credit: Number(row.credit),
    evidence: typeof row.evidence?.summary === 'string' ? row.evidence.summary : 'Verified team contribution',
    occurredAt: new Date(row.occurredAt).toISOString(),
    verified: true,
  }));
}

async function latestVotes(client: PoolClient, runId: string): Promise<RecognitionVote[]> {
  const { rows } = await client.query(
    `select distinct on (voter_member_id)
      id::text,run_id as "runId",voter_member_id as "voterMemberId",recipient_member_id as "recipientMemberId",
      category,subtype,answer_path as "answerPath",revision,created_at as "createdAt",created_at as "updatedAt",is_withdrawal
      from hunt_v3.recognition_votes where run_id=$1
      order by voter_member_id,revision desc,id desc`,
    [runId],
  );
  return rows.filter(row => !row.is_withdrawal).map(row => ({
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }));
}

export function recognitionOptions(definition: V3Definition) {
  const serialized = JSON.stringify(definition.checkpoints);
  const supports = (value: string) => serialized.includes(`\"${value}\"`);
  const options: Record<PeerRecognitionCategory, PeerRecognitionSubtype[]> = {
    puzzle_power: [],
    trail_speed: ['first_finder', 'swift_scout'],
    clue_craft: [],
    crew_energy: ['calm_captain', 'momentum_maker', 'helping_hand'],
  };
  if (supports('word_search') || supports('crossword')) options.puzzle_power.push('word_hunter');
  if (supports('matching') || supports('sequence') || supports('rotation') || supports('jigsaw')) options.puzzle_power.push('pattern_breaker');
  if (supports('sudoku') || supports('quiz')) options.puzzle_power.push('number_wizard');
  if (supports('verify_qr')) options.trail_speed.push('qr_sprinter');
  if (supports('verify_image') || supports('camera_guide') || supports('show_media')) options.clue_craft.push('detail_detective');
  if (supports('branch') || supports('choose_path') || supports('verify_code')) options.clue_craft.push('logic_linker');
  if (supports('verify_answer') || supports('text')) options.clue_craft.push('riddle_reader');
  // Keep each question useful even for short hunts while never inventing a
  // subtype outside the supported, server-owned vocabulary.
  for (const category of Object.keys(options) as PeerRecognitionCategory[]) {
    if (!options[category].length) options[category] = [...PEER_RECOGNITION_SUBTYPES[category]];
  }
  return options;
}

export async function recalculateRecognition(client: PoolClient, teamId: string, runId: string) {
  const ctx = await context(client, teamId, runId);
  const members = await runMembers(client, runId);
  const eligibleMembers = await runMembers(client, runId, true);
  const eligibleMemberIds = new Set(eligibleMembers.map(member => member.teamMemberId));
  const contributions = await contributionEvents(client, [runId]);
  const votes = await latestVotes(client, runId);
  const settings = ctx.definition.settings.recognition;
  const results = calculateRecognitionResults({
    members,
    contributions,
    votes,
    dataWeight: settings.dataWeight,
    peerWeight: settings.peerWeight,
    titleLibrary: settings.titleLibrary,
    allowedSubtypes: recognitionOptions(ctx.definition),
  });
  for (const result of results.filter(result => eligibleMemberIds.has(result.teamMemberId))) {
    const revision = Number((await client.query(
      'select coalesce(max(revision),0)+1 as revision from hunt_v3.recognition_results where run_id=$1 and member_id=$2',
      [runId, result.teamMemberId],
    )).rows[0].revision);
    await client.query(
      `insert into hunt_v3.recognition_results(
        run_id,team_id,member_id,revision,headline_title,data_title,peer_title,evidence_summary,peer_summary,
        contribution_score,peer_score,server_weight,peer_weight,calculation_version)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'v3.1')`,
      [runId, teamId, result.teamMemberId, revision, result.blendedTitle, result.dataAchievement.label,
        result.peerRecognition?.label ?? null, result.dataAchievement, result.peerRecognition ?? {},
        result.dataAchievement.credit, result.peerRecognition?.votes ?? 0, settings.dataWeight, settings.peerWeight],
    );
  }
}

async function visibleResults(client: PoolClient, runId: string) {
  const { rows } = await client.query(
    `select distinct on (result.member_id)
      result.member_id,result.headline_title,result.data_title,result.peer_title,result.evidence_summary,result.peer_summary,
      override.headline_title as override_headline,override.data_title as override_data,override.peer_title as override_peer,
      override.explanation as override_explanation
      from hunt_v3.recognition_results result
      left join lateral (
        select * from hunt_v3.recognition_overrides candidate
        where candidate.run_id=result.run_id and candidate.member_id=result.member_id
        order by candidate.created_at desc,candidate.id desc limit 1
      ) override on true
      where result.run_id=$1 order by result.member_id,result.revision desc,result.id desc`,
    [runId],
  );
  return rows.map(row => ({
    memberId: row.member_id,
    headlineTitle: row.override_headline ?? row.headline_title,
    dataAchievement: {
      title: row.override_data ?? row.data_title,
      ...row.evidence_summary,
    },
    peerRecognition: row.peer_title || row.override_peer ? {
      title: row.override_peer ?? row.peer_title,
      ...row.peer_summary,
    } : null,
    ...(row.override_explanation ? { organizerExplanation: row.override_explanation } : {}),
  }));
}

export async function privateRecognition(teamId: string, memberId: string, runId: string, scope: 'run' | 'all' = 'run') {
  if (![teamId, memberId, runId].every(isV3Uuid)) throw new HttpError(400, 'Choose a valid completed run.');
  return transaction(async client => {
    const identity = (await client.query(
      'select hunt_id from hunt_v3.runs where id=$1 and team_id=$2',
      [runId, teamId],
    )).rows[0];
    if (!identity || !await lockV3Hunt(client, identity.hunt_id) ||
      !await lockV3Team(client, identity.hunt_id, teamId)) {
      throw new HttpError(404, 'Run not found.');
    }
    // This read can lazily materialize the first recognition result. Take the
    // same parent-first run lock as vote saves so two teammates opening the
    // finish screen cannot both choose the same next result revision, and a
    // disqualification cannot form a run -> team lock inversion through FKs.
    const ctx = await context(client, teamId, runId, true);
    const currentRunMembers = await runMembers(client, runId);
    const recognitionEligibleMembers = await runMembers(client, runId, true);
    if (!currentRunMembers.some(member => member.teamMemberId === memberId)) {
      throw new HttpError(409, 'This contribution board belongs to the crew who played this run.');
    }
    if (ctx.run.status !== 'completed') throw new HttpError(409, 'Crew recognition opens when the run is complete.');
    const settings = ctx.definition.settings.recognition;
    if (!settings.enabled) return { enabled: false, standings: [], results: [] };
    const runIds = scope === 'all'
      ? (await client.query("select id from hunt_v3.runs where team_id=$1 and status='completed' order by run_number", [teamId])).rows.map(row => row.id as string)
      : [runId];
    const memberRows = (await client.query(
      `select participant.member_id as "teamMemberId",
        (array_agg(participant.member_name_snapshot order by participant.joined_run_at desc))[1] as "displayName"
        from hunt_v3.run_members participant
        where participant.run_id=any($1::uuid[]) and participant.contribution_eligible
        group by participant.member_id
        order by min(participant.joined_run_at),participant.member_id`,
      [runIds],
    )).rows as TeamMemberIdentity[];
    const contributions = await contributionEvents(client, runIds);
    const standings = aggregateContributions(memberRows, contributions, new Set(runIds));
    let results = await visibleResults(client, runId);
    if (!results.length) {
      await recalculateRecognition(client, teamId, runId);
      results = await visibleResults(client, runId);
    }
    const ownVote = (await latestVotes(client, runId)).find(vote => vote.voterMemberId === memberId) ?? null;
    const closesAt = ctx.run.recognition_closes_at ?? (ctx.run.completed_at
      ? new Date(Date.parse(ctx.run.completed_at) + settings.votingWindowMinutes * 60_000).toISOString()
      : null);
    return {
      enabled: true,
      scope,
      standings,
      results,
      voting: {
        enabled: settings.peerVotingEnabled,
        open: Boolean(ctx.run.completed_at && isRecognitionWindowOpen(ctx.run.completed_at, settings.votingWindowMinutes, ctx.now)),
        closesAt,
        ownVote,
        options: recognitionOptions(ctx.definition),
        teammates: recognitionEligibleMembers.filter(member => member.teamMemberId !== memberId),
      },
    };
  });
}

export async function saveRecognitionVote(input: {
  teamId: string;
  memberId: string;
  runId: string;
  requestId: string;
  recipientMemberId: string;
  category: PeerRecognitionCategory;
  subtype: PeerRecognitionSubtype;
  requestSource?: string;
}) {
  if (![input.teamId, input.memberId, input.runId, input.requestId, input.recipientMemberId].every(isV3Uuid)) {
    throw new HttpError(400, 'A valid recognition identity is required.');
  }
  const payloadHash = digest(canonicalJson({ operation: 'recognition_vote', recipientMemberId: input.recipientMemberId, category: input.category, subtype: input.subtype }));
  const scopeKey = `member:${input.memberId}:recognition:${input.runId}`;
  const preflightReceipt = (await getPool().query(
    'select payload_hash from hunt_v3.command_receipts where scope_key=$1 and request_id=$2',
    [scopeKey, input.requestId],
  )).rows[0];
  if (preflightReceipt?.payload_hash !== payloadHash) {
    const source = input.requestSource?.slice(0, 180) || 'server';
    await rateLimitV3(`recognition-vote:source:${source}`, 300);
    await rateLimitV3(`recognition-vote:run:${input.runId}`, 250);
    await rateLimitV3(`recognition-vote:member:${input.memberId}:run:${input.runId}`, 10);
  }
  return transaction(async client => {
    const replayReceipt = async () => {
      const receipt = (await client.query(
        'select payload_hash,response from hunt_v3.command_receipts where scope_key=$1 and request_id=$2',
        [scopeKey, input.requestId],
      )).rows[0];
      if (!receipt) return null;
      if (receipt.payload_hash !== payloadHash) throw new HttpError(409, 'This request ID was already used for another action.');
      return { saved: true, voteRevision: receipt.response?.voteRevision, replayed: true } as const;
    };
    const identity = (await client.query(
      'select hunt_id from hunt_v3.runs where id=$1 and team_id=$2',
      [input.runId, input.teamId],
    )).rows[0];
    if (!identity) throw new HttpError(404, 'Run not found.');
    if (!await lockV3Hunt(client, identity.hunt_id) ||
      !await lockV3Team(client, identity.hunt_id, input.teamId)) {
      throw new HttpError(404, 'Run not found.');
    }
    const ctx = await context(client, input.teamId, input.runId, true);
    const replay = await replayReceipt();
    if (replay) return replay;
    const settings = ctx.definition.settings.recognition;
    if (ctx.run.status !== 'completed' || !ctx.run.completed_at) throw new HttpError(409, 'Crew recognition opens when the run is complete.');
    if (!settings.enabled || !settings.peerVotingEnabled) throw new HttpError(409, 'Peer recognition is not enabled for this hunt.');
    if (!isRecognitionWindowOpen(ctx.run.completed_at, settings.votingWindowMinutes, ctx.now)) throw new HttpError(409, 'The crew recognition window has closed.');
    const members = await runMembers(client, input.runId);
    const eligibleRecipients = await runMembers(client, input.runId, true);
    if (!eligibleRecipients.some(member => member.teamMemberId === input.recipientMemberId)) {
      throw new HttpError(400, 'Choose a teammate who is eligible for crew recognition in this run.');
    }
    const previous = (await client.query(
      'select id,revision from hunt_v3.recognition_votes where run_id=$1 and voter_member_id=$2 order by revision desc,id desc limit 1',
      [input.runId, input.memberId],
    )).rows[0];
    if (Number(previous?.revision ?? 0) >= 10) {
      throw new HttpError(409, 'This crew kudos has reached its edit limit. Your latest saved choice remains active.');
    }
    const now = ctx.now;
    const vote: RecognitionVote = {
      id: 'pending',
      runId: input.runId,
      voterMemberId: input.memberId,
      recipientMemberId: input.recipientMemberId,
      category: input.category,
      subtype: input.subtype,
      answerPath: [input.category, input.recipientMemberId, input.subtype],
      revision: Number(previous?.revision ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
    };
    const issues = validateRecognitionVote(vote, members, recognitionOptions(ctx.definition));
    if (issues.length) throw new HttpError(400, issues.join(' '));
    await client.query(
      `insert into hunt_v3.recognition_votes(
        run_id,team_id,voter_member_id,recipient_member_id,revision,supersedes_vote_id,category,subtype,answer_path)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [input.runId, input.teamId, input.memberId, input.recipientMemberId, vote.revision, previous?.id ?? null,
        input.category, input.subtype, JSON.stringify(vote.answerPath)],
    );
    await recalculateRecognition(client, input.teamId, input.runId);
    await client.query(
      `insert into hunt_v3.command_receipts(scope_key,request_id,operation,team_id,run_id,member_id,payload_hash,response)
        values($1,$2,'recognition_vote',$3,$4,$5,$6,$7)`,
      [scopeKey, input.requestId, input.teamId, input.runId, input.memberId, payloadHash, { voteRevision: vote.revision }],
    );
    // Build inside the same transaction; do not open a nested transaction.
    const results = await visibleResults(client, input.runId);
    return { saved: true, voteRevision: vote.revision, replayed: false, results };
  });
}
