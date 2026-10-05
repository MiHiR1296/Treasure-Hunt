import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool, transaction } from '../db';
import { canonicalJson, digest, hashPin, HttpError, verifyPin } from '../security';
import { formatTeamCode, normalizedKey, validateMemberName, validateOptionalTeamName } from './names';
import { createSessionToken, rateLimitV3, SESSION_SECONDS } from './security';

export type RegistrationIntent = 'create' | 'join' | 'claim';
export interface RegistrationInput {
  requestId: string;
  huntId: string;
  intent: RegistrationIntent;
  playerName: unknown;
  pin: unknown;
  memberPin?: unknown;
  teamCode?: unknown;
  teamName?: unknown;
  memberNames?: unknown;
  requestSource?: string;
}

type HuntRegistrationRow = {
  id: string;
  title: string;
  slug: string;
  status: string;
  registration_mode: 'self_serve' | 'organizer_assigned' | 'rostered';
  registration_open: boolean;
  next_team_number: number;
  settings: Record<string, unknown>;
};

class RegistrationReplayNeeded extends Error {}

const acceptsRegistration = (status: string) => ['ready', 'live', 'paused'].includes(status);

function registrationRequestId(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, 'A valid registration request ID is required.');
  }
  return value;
}

function pinValue(value: unknown) {
  if (typeof value !== 'string' || !/^\d{6,12}$/.test(value)) throw new HttpError(400, 'Use a team PIN with 6 to 12 digits.');
  return value;
}

function memberPinValue(value: unknown) {
  if (typeof value !== 'string' || !/^\d{6,12}$/.test(value)) throw new HttpError(400, 'Use your personal 6 to 12 digit member PIN.');
  return value;
}

function teamCodeValue(value: unknown) {
  if (typeof value !== 'string') throw new HttpError(400, 'Enter the team code from your organizer or teammate.');
  const code = value.normalize('NFKC').trim().toUpperCase();
  if (!/^T-\d{3,}$/.test(code)) throw new HttpError(400, 'Team codes look like T-014.');
  return code;
}

function rosterNames(value: unknown, playerName: string, maximum: number) {
  if (value === undefined) return [playerName];
  if (!Array.isArray(value)) throw new HttpError(400, 'Team members must be a list of names.');
  const names = [playerName, ...value.map(validateMemberName)];
  if (names.length > maximum) throw new HttpError(400, `A team may have at most ${maximum} members.`);
  const unique = new Map(names.map(name => [normalizedKey(name), name]));
  if (unique.size !== names.length) throw new HttpError(400, 'Each team member name must be different.');
  return [...unique.values()];
}

async function applyRegistrationRateLimits(input: RegistrationInput, teamCode: string | null) {
  const source = input.requestSource?.slice(0, 180) || 'server';
  // The source bucket cannot be evaded by changing a name/team code. The
  // target bucket limits distributed guessing against one team or hunt.
  // Event Wi-Fi commonly places a whole school behind one public address, so
  // source ceilings allow a real check-in wave while six-digit credentials and
  // the team target bucket still make enumeration impractical.
  await rateLimitV3(`registration:source:${source}`, 300);
  await rateLimitV3(`registration:hunt-source:${input.huntId}:${source}`, 300);
  await rateLimitV3(
    `registration:target:${input.huntId}:${teamCode ?? 'new-team'}`,
    teamCode ? 250 : 150,
  );
}

type JoinPreflight = {
  hunt: HuntRegistrationRow;
  team: {
    id: string;
    pin_hash: string;
    status: string;
    approval_status: 'pending' | 'approved';
    registration_source: 'self_serve' | 'organizer_assigned' | 'roster_import';
  };
  member: { id: string; status: string; claimed_at: string | null; claim_pin_hash: string | null } | null;
  newMemberPinHash: string | null;
};

function assertNewMemberAllowed(
  team: { approval_status: string; registration_source: string },
  hasRuns: boolean,
) {
  if (team.registration_source === 'roster_import') {
    throw new HttpError(404, 'Choose your name exactly as it appears on the organizer roster.');
  }
  if (team.registration_source === 'self_serve' && team.approval_status === 'approved') {
    throw new HttpError(409, 'This team roster was locked when the organizer approved it. Join using a name already declared for the team.');
  }
  if (team.registration_source === 'organizer_assigned' && hasRuns) {
    throw new HttpError(409, 'This team roster was locked when its first run started. Join using an existing member name or ask the organizer for help.');
  }
}

async function preflightJoin(
  input: RegistrationInput,
  code: string,
  playerName: string,
  teamPin: string,
  memberPin: string,
): Promise<JoinPreflight> {
  const result = await getPool().query(
    `select h.id,h.title,h.slug,h.status,h.registration_mode,h.registration_open,h.next_team_number,h.settings,
      t.id as team_id,t.pin_hash as team_pin_hash,t.status as team_status,
      t.approval_status,t.registration_source,
      exists(select 1 from hunt_v3.runs run where run.team_id=t.id) as team_has_runs,
      m.id as member_id,m.status as member_status,m.claimed_at,m.claim_pin_hash
      from hunt_v3.hunts h
      left join hunt_v3.teams t on t.hunt_id=h.id and t.canonical_code=$2
      left join hunt_v3.team_members m on m.team_id=t.id and m.name_key=$3
      where h.id=$1`,
    [input.huntId, code, normalizedKey(playerName)],
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, 'Hunt not found.');
  const hunt: HuntRegistrationRow = {
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    registration_mode: row.registration_mode,
    registration_open: row.registration_open,
    next_team_number: row.next_team_number,
    settings: row.settings,
  };
  if (!acceptsRegistration(hunt.status)) throw new HttpError(409, 'This hunt is not accepting players right now.');
  if (row.registration_source === 'roster_import' && input.intent !== 'claim') {
    throw new HttpError(409, 'Choose your rostered identity and use its personal member PIN.');
  }
  if (!row.team_id || !await verifyPin(teamPin, row.team_pin_hash)) throw new HttpError(401, 'Team code or PIN is incorrect.');
  if (row.team_status !== 'active') throw new HttpError(409, 'This team is not active. Ask the organizer for help.');
  const member = row.member_id ? {
    id: row.member_id as string,
    status: row.member_status as string,
    claimed_at: row.claimed_at as string | null,
    claim_pin_hash: row.claim_pin_hash as string | null,
  } : null;
  if (member?.status === 'removed') throw new HttpError(409, 'This member was removed from the team. Ask the organizer for help.');
  const team = {
    id: row.team_id as string,
    pin_hash: row.team_pin_hash as string,
    status: row.team_status as string,
    approval_status: row.approval_status as 'pending' | 'approved',
    registration_source: row.registration_source as 'self_serve' | 'organizer_assigned' | 'roster_import',
  };
  if (!member) assertNewMemberAllowed(team, Boolean(row.team_has_runs));
  if (member?.claim_pin_hash) {
    if (!await verifyPin(memberPin, member.claim_pin_hash)) throw new HttpError(401, 'The personal member PIN is incorrect.');
    return { hunt, team, member, newMemberPinHash: null };
  }
  if (team.registration_source === 'roster_import') {
    throw new HttpError(409, 'This roster place needs a personal member PIN from the organizer.');
  }
  return {
    hunt,
    team,
    member,
    newMemberPinHash: await hashPin(memberPin),
  };
}

function registrationPayloadHash(
  input: RegistrationInput,
  playerName: string,
  teamCode: string | null,
) {
  const teamName = input.intent === 'create' ? validateOptionalTeamName(input.teamName) : null;
  const memberNames = input.intent === 'create' && input.memberNames !== undefined
    ? (Array.isArray(input.memberNames) ? input.memberNames.map(validateMemberName) : (() => { throw new HttpError(400, 'Team members must be a list of names.'); })())
    : [];
  return digest(canonicalJson({
    operation: 'team_registration',
    huntId: input.huntId,
    intent: input.intent,
    playerName,
    teamCode,
    teamName,
    memberNames,
  }));
}

async function replayRegistration(
  input: RegistrationInput,
  payloadHash: string,
  teamPin: string,
  memberPin: string,
  playerName: string,
) {
  const scopeKey = `registration:${input.huntId}`;
  const receipt = (await getPool().query(
    `select payload_hash,response from hunt_v3.command_receipts
      where scope_key=$1 and request_id=$2 and operation='team_registration'`,
    [scopeKey, input.requestId],
  )).rows[0];
  if (!receipt) return null;
  if (receipt.payload_hash !== payloadHash) throw new HttpError(409, 'This registration request ID was already used with different details.');
  const teamId = receipt.response?.teamId;
  const memberId = receipt.response?.memberId;
  if (typeof teamId !== 'string' || typeof memberId !== 'string') throw new HttpError(409, 'This registration receipt is incomplete. Ask the organizer for help.');
  const identity = (await getPool().query(
    `select t.id as team_id,t.pin_hash,t.status as team_status,h.status as hunt_status,
      m.id as member_id,m.name,m.status as member_status,m.claim_pin_hash,
      exists(select 1 from hunt_v3.roster_claims claim where claim.member_id=m.id and claim.status='active') as has_active_claim
      from hunt_v3.teams t join hunt_v3.hunts h on h.id=t.hunt_id
      join hunt_v3.team_members m on m.team_id=t.id and m.id=$3
      where t.id=$2 and t.hunt_id=$1`,
    [input.huntId, teamId, memberId],
  )).rows[0];
  if (!identity || !identity.has_active_claim || identity.team_status !== 'active' || identity.member_status !== 'active' || !acceptsRegistration(identity.hunt_status)) {
    throw new HttpError(409, 'This team or member is no longer active. Ask the organizer for help.');
  }
  if (!identity.claim_pin_hash) throw new HttpError(409, 'This member does not have a personal member PIN. Ask the organizer for help.');
  const [teamMatches, memberMatches] = await Promise.all([
    verifyPin(teamPin, identity.pin_hash),
    verifyPin(memberPin, identity.claim_pin_hash),
  ]);
  if (!teamMatches) throw new HttpError(401, 'Team code or PIN is incorrect.');
  if (!memberMatches) throw new HttpError(401, 'The personal member PIN is incorrect.');
  const session = createSessionToken();
  const summary = await transaction(async client => {
    const current = (await client.query(
      `select t.pin_hash,t.status as team_status,m.claim_pin_hash,m.status as member_status
        from hunt_v3.teams t join hunt_v3.team_members m on m.team_id=t.id and m.id=$2
        where t.id=$1 for update of t,m`,
      [teamId, memberId],
    )).rows[0];
    if (!current || current.team_status !== 'active' || current.member_status !== 'active' ||
      current.pin_hash !== identity.pin_hash || current.claim_pin_hash !== identity.claim_pin_hash) {
      throw new HttpError(409, 'This team identity changed while you were signing in. Try again.');
    }
    const activeClaim = await client.query(
      "select id from hunt_v3.roster_claims where member_id=$1 and status='active' for share",
      [memberId],
    );
    if (!activeClaim.rowCount) throw new HttpError(409, 'This member claim is no longer active. Sign in again.');
    return establishReplaySession(client, session.hash, teamId, memberId);
  });
  return { token: session.token, summary };
}

export async function listV3Hunts() {
  const { rows } = await (await import('../db')).getPool().query(
    `select id,title,slug,status,registration_mode,registration_open,settings
      from hunt_v3.hunts
      where status in ('ready','live','paused')
      order by created_at`,
  );
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    registrationMode: String(row.registration_mode).replaceAll('_', '-'),
    registrationOpen: row.registration_open,
    minTeamSize: row.settings?.minTeamSize ?? 1,
    maxTeamSize: row.settings?.maxTeamSize ?? 50,
    coverUrl: row.settings?.coverUrl,
  }));
}

export async function teamSessionSummary(client: PoolClient, teamId: string, memberId: string) {
  const team = (await client.query(
    `select t.id,t.canonical_code,t.display_name,t.status,t.approval_status,t.competition_revision,t.registration_source,
      h.id as hunt_id,h.title as hunt_title,h.slug,h.status as hunt_status,h.registration_mode,h.settings
      from hunt_v3.teams t join hunt_v3.hunts h on h.id=t.hunt_id where t.id=$1 and t.status='active'`,
    [teamId],
  )).rows[0];
  if (!team) throw new HttpError(404, 'Team not found.');
  const { rows: members } = await client.query(
    `select id,name,status,claimed_at,checked_in_at from hunt_v3.team_members
      where team_id=$1 and status<>'removed' order by created_at,id`,
    [teamId],
  );
  const member = members.find(item => item.id === memberId && item.status === 'active');
  if (!member) throw new HttpError(401, 'Your team membership changed. Sign in again.');
  const { rows: runs } = await client.query(
    `select id,run_number,status,practice,eligible,ineligibility_reason,score,elapsed_ms,progress,current_checkpoint_id,started_at,completed_at,
      exists(select 1 from hunt_v3.run_members participant where participant.run_id=runs.id and participant.member_id=$2) as participating
      from hunt_v3.runs runs where team_id=$1 order by run_number desc`,
    [teamId, memberId],
  );
  const participatingRuns = runs.filter(run => run.participating);
  const completed = runs.filter(run => run.status === 'completed' && run.eligible && !run.practice);
  const officialAttemptCount = runs.filter(run => !run.practice).length;
  const hasPracticeRun = runs.some(run => run.practice);
  // Results invalidated by an organizer disqualification remain immutable and
  // invisible to ranking, but restoration must replace the official slots
  // they consumed. Other failures/abandonments still consume policy slots.
  const officialAttemptSlotsUsed = runs.filter(run =>
    !run.practice && run.ineligibility_reason !== 'Team disqualified by organizer').length;
  const runPolicy = team.settings?.runPolicy ?? { mode: 'unlimited' };
  const maximumOfficialRuns = runPolicy.mode === 'disabled'
    ? 1
    : runPolicy.mode === 'capped'
      ? Number(runPolicy.maxOfficialRuns ?? 1)
      : null;
  const best = [...completed].sort((a, b) => b.score - a.score || (a.elapsed_ms ?? Infinity) - (b.elapsed_ms ?? Infinity) || Date.parse(a.completed_at) - Date.parse(b.completed_at))[0] ?? null;
  const runSummary = (run: Record<string, unknown> | null) => run ? {
    id: run.id,
    runNumber: run.run_number,
    status: run.status,
    practice: run.practice,
    eligible: run.eligible,
    score: run.score,
    elapsedMilliseconds: run.elapsed_ms === null ? null : Number(run.elapsed_ms),
    progress: run.progress === null ? null : Number(run.progress),
    currentCheckpointId: run.current_checkpoint_id,
    startedAt: run.started_at,
    completedAt: run.completed_at,
  } : null;
  return {
    hunt: {
      id: team.hunt_id,
      title: team.hunt_title,
      slug: team.slug,
      status: team.hunt_status,
      registrationMode: String(team.registration_mode).replaceAll('_', '-'),
    },
    team: {
      id: team.id,
      code: team.canonical_code,
      displayName: team.display_name,
      label: team.display_name ? `${team.canonical_code} · ${team.display_name}` : team.canonical_code,
      status: team.status,
      approvalStatus: team.approval_status,
      competitionRevision: Number(team.competition_revision),
      registrationSource: String(team.registration_source).replaceAll('_', '-'),
    },
    member: { id: member.id, name: member.name },
    members: members.map(item => ({ id: item.id, name: item.name, checkedIn: Boolean(item.checked_in_at) })),
    activeRun: runSummary(participatingRuns.find(run => run.status === 'active') ?? null),
    latestRun: runSummary(participatingRuns[0] ?? null),
    bestRun: runSummary(best),
    completedOfficialRuns: completed.length,
    officialAttemptCount,
    officialAttemptSlotsUsed,
    hasPracticeRun,
    remainingOfficialRuns: hasPracticeRun
      ? 0
      : maximumOfficialRuns === null
      ? null
      : Math.max(0, maximumOfficialRuns - officialAttemptSlotsUsed),
    settings: {
      minTeamSize: team.settings?.minTeamSize ?? 1,
      maxTeamSize: team.settings?.maxTeamSize ?? 50,
      runPolicy,
    },
  };
}

async function establishMemberSession(
  client: PoolClient,
  sessionHash: string,
  teamId: string,
  memberId: string,
) {
  const replacedClaims = await client.query(
    `update hunt_v3.roster_claims set status='released',ended_at=now(),ended_by='member',reason='Signed in again'
      where member_id=$1 and status='active' returning id`,
    [memberId],
  );
  if (replacedClaims.rowCount) {
    await client.query(
      `update hunt_v3.sessions set revoked_at=coalesce(revoked_at,now())
        where team_id=$1 and member_id=$2 and revoked_at is null`,
      [teamId, memberId],
    );
    await client.query(
      `insert into hunt_v3.roster_claim_events(team_id,member_id,action,details)
        values($1,$2,'released',$3)`,
      [teamId, memberId, { reason: 'Signed in again' }],
    );
  }
  await client.query(
    `insert into hunt_v3.sessions(token_hash,role,team_id,member_id,expires_at)
      values($1,'team',$2,$3,now()+$4*interval '1 second')`,
    [sessionHash, teamId, memberId, SESSION_SECONDS],
  );
  await client.query(
    `insert into hunt_v3.roster_claims(id,team_id,member_id,session_token_hash,claim_method,status)
      values($1,$2,$3,$4,'member_pin','active')`,
    [randomUUID(), teamId, memberId, sessionHash],
  );
  await client.query(
    `insert into hunt_v3.member_checkins(team_id,member_id,action,actor_kind,actor_member_id,method)
      values($1,$2,'check_in','member',$2,'claim')`,
    [teamId, memberId],
  );
  // Run membership is an immutable starting snapshot. Signing in after a run
  // starts checks this member in for the next run without granting access to
  // the active attempt.
  return teamSessionSummary(client, teamId, memberId);
}

/**
 * A retry of the same registration request must not revoke the session from an
 * earlier response: network response ordering is not deterministic. A later
 * registration with a different request ID still uses establishMemberSession
 * and revokes every older session for this identity.
 */
async function establishReplaySession(
  client: PoolClient,
  sessionHash: string,
  teamId: string,
  memberId: string,
) {
  await client.query(
    `insert into hunt_v3.sessions(token_hash,role,team_id,member_id,expires_at)
      values($1,'team',$2,$3,now()+$4*interval '1 second')`,
    [sessionHash, teamId, memberId, SESSION_SECONDS],
  );
  return teamSessionSummary(client, teamId, memberId);
}

export async function registerV3Team(input: RegistrationInput) {
  registrationRequestId(input.requestId);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(input.huntId)) throw new HttpError(400, 'Choose a valid hunt.');
  if (!['create', 'join', 'claim'].includes(input.intent)) throw new HttpError(400, 'Choose whether to create or join a team.');
  const playerName = validateMemberName(input.playerName);
  const pin = pinValue(input.pin);
  const memberPin = memberPinValue(input.memberPin);
  if (pin === memberPin) throw new HttpError(400, 'Your personal member PIN must be different from the shared team PIN.');
  const code = input.intent === 'create' ? null : teamCodeValue(input.teamCode);
  const payloadHash = registrationPayloadHash(input, playerName, code);
  await applyRegistrationRateLimits(input, code);
  const replayed = await replayRegistration(input, payloadHash, pin, memberPin, playerName);
  if (replayed) return replayed;

  let preparedCreate: {
    displayName: string | null;
    teamPinHash: string;
    memberPinHash: string;
  } | null = null;
  let preparedJoin: JoinPreflight | null = null;
  if (input.intent === 'create') {
    const hunt = (await getPool().query(
      `select id,title,slug,status,registration_mode,registration_open,next_team_number,settings
        from hunt_v3.hunts where id=$1`,
      [input.huntId],
    )).rows[0] as HuntRegistrationRow | undefined;
    if (!hunt) throw new HttpError(404, 'Hunt not found.');
    if (!acceptsRegistration(hunt.status)) throw new HttpError(409, 'This hunt is not accepting players right now.');
    if (hunt.registration_mode !== 'self_serve') throw new HttpError(409, 'Teams for this hunt are created by the organizer. Join with your assigned team code.');
    if (!hunt.registration_open) throw new HttpError(409, 'Registration is closed. Existing teams can still sign in.');
    const maximum = Number(hunt.settings?.maxTeamSize ?? 50);
    rosterNames(input.memberNames, playerName, maximum);
    const displayName = validateOptionalTeamName(input.teamName);
    const [teamPinHash, memberPinHash] = await Promise.all([hashPin(pin), hashPin(memberPin)]);
    preparedCreate = {
      displayName,
      teamPinHash,
      memberPinHash,
    };
  } else {
    preparedJoin = await preflightJoin(input, code!, playerName, pin, memberPin);
  }
  const session = createSessionToken();

  const scopeKey = `registration:${input.huntId}`;
  let summary;
  try {
    summary = await transaction(async client => {
    let teamId: string;
    let memberId: string;
    if (input.intent === 'create') {
      const hunt = (await client.query(
        `select id,title,slug,status,registration_mode,registration_open,next_team_number,settings
          from hunt_v3.hunts where id=$1 for update`,
        [input.huntId],
      )).rows[0] as HuntRegistrationRow | undefined;
      const racedReceipt = await client.query(
        'select 1 from hunt_v3.command_receipts where scope_key=$1 and request_id=$2',
        [scopeKey, input.requestId],
      );
      if (racedReceipt.rowCount) throw new RegistrationReplayNeeded();
      if (!hunt) throw new HttpError(404, 'Hunt not found.');
      if (!acceptsRegistration(hunt.status)) throw new HttpError(409, 'This hunt is not accepting players right now.');
      if (hunt.registration_mode !== 'self_serve') throw new HttpError(409, 'Teams for this hunt are created by the organizer. Join with your assigned team code.');
      if (!hunt.registration_open) throw new HttpError(409, 'Registration is closed. Existing teams can still sign in.');
      const maximum = Number(hunt.settings?.maxTeamSize ?? 50);
      const names = rosterNames(input.memberNames, playerName, maximum);
      const prepared = preparedCreate!;
      teamId = randomUUID();
      const allocatedCode = formatTeamCode(hunt.next_team_number);
      const inserted = await client.query(
        `insert into hunt_v3.teams(
          id,hunt_id,canonical_code,display_name,name_key,name_status,registration_source,approval_status,status,pin_hash)
          values($1,$2,$3,$4,$5,case when $4::text is null then 'code_only' else 'approved' end,
            'self_serve','pending','active',$6)
          on conflict(hunt_id,name_key) where name_key is not null and name_status<>'rejected'
          do nothing returning id`,
        [teamId, hunt.id, allocatedCode, prepared.displayName,
          prepared.displayName ? normalizedKey(prepared.displayName) : null, prepared.teamPinHash],
      );
      if (!inserted.rowCount) throw new HttpError(409, 'That nickname is already in use. Choose another nickname or leave it blank.');
      await client.query('update hunt_v3.hunts set next_team_number=next_team_number+1,updated_at=now() where id=$1', [hunt.id]);
      memberId = randomUUID();
      for (const name of names) {
        const isCreator = normalizedKey(name) === normalizedKey(playerName);
        const id = isCreator ? memberId : randomUUID();
        await client.query(
          `insert into hunt_v3.team_members(id,team_id,name,name_key,claim_pin_hash,status,claimed_at,checked_in_at)
            values($1,$2,$3,$4,$5,'active',case when $6::boolean then now() end,case when $6::boolean then now() end)`,
          [id, teamId, name, normalizedKey(name), isCreator ? prepared.memberPinHash : null, isCreator],
        );
      }
      await client.query(
        `insert into hunt_v3.admin_events(action,hunt_id,team_id,details)
          values('team_registered',$1,$2,$3)`,
        [hunt.id, teamId, { code: allocatedCode, displayName: prepared.displayName, source: 'self_serve' }],
      );
    } else {
      const prepared = preparedJoin!;
      // Parent before child: the team row is mutated below and later inserts
      // carry hunt/team foreign keys. Locking the hunt first also makes a
      // first-run start versus late organizer-assigned join linearizable
      // without a hunt->team / team->hunt deadlock.
      const hunt = (await client.query(
        `select id,title,slug,status,registration_mode,registration_open,next_team_number,settings
          from hunt_v3.hunts where id=$1 for key share`,
        [input.huntId],
      )).rows[0] as HuntRegistrationRow | undefined;
      if (!hunt || !acceptsRegistration(hunt.status)) throw new HttpError(409, 'This hunt is not accepting players right now.');
      const team = (await client.query(
        `select id,pin_hash,status,approval_status,registration_source
          from hunt_v3.teams teams where hunt_id=$1 and canonical_code=$2 for update`,
        [input.huntId, code],
      )).rows[0];
      const racedReceipt = await client.query(
        'select 1 from hunt_v3.command_receipts where scope_key=$1 and request_id=$2',
        [scopeKey, input.requestId],
      );
      if (racedReceipt.rowCount) throw new RegistrationReplayNeeded();
      if (!team || team.id !== prepared.team.id || team.pin_hash !== prepared.team.pin_hash) {
        throw new HttpError(409, 'Team credentials changed while you were signing in. Try again.');
      }
      if (team.status !== 'active') throw new HttpError(409, 'This team is not active. Ask the organizer for help.');
      teamId = team.id;
      const existing = (await client.query(
        'select id,status,claimed_at,claim_pin_hash from hunt_v3.team_members where team_id=$1 and name_key=$2 for update',
        [teamId, normalizedKey(playerName)],
      )).rows[0];
      if (existing) {
        if (!prepared.member || existing.id !== prepared.member.id || existing.claim_pin_hash !== prepared.member.claim_pin_hash) {
          throw new HttpError(409, 'This member identity changed while you were signing in. Try again.');
        }
        if (existing.status === 'removed') throw new HttpError(409, 'This member was removed from the team. Ask the organizer for help.');
        memberId = existing.id;
        await client.query(
          `update hunt_v3.team_members set status='active',claim_pin_hash=coalesce(claim_pin_hash,$2),
            claimed_at=coalesce(claimed_at,now()),checked_in_at=coalesce(checked_in_at,now()) where id=$1`,
          [memberId, prepared.newMemberPinHash],
        );
      } else {
        if (prepared.member) throw new HttpError(409, 'This member identity changed while you were signing in. Try again.');
        // This must be a separate statement after the team-row lock. Under
        // READ COMMITTED, a SELECT ... FOR UPDATE that waited behind run
        // creation can retain the statement's older snapshot for a correlated
        // EXISTS. The post-lock statement sees the committed run, while the
        // shared team lock makes join-first versus run-first linearizable.
        const hasRuns = Boolean((await client.query(
          'select 1 from hunt_v3.runs where team_id=$1 limit 1',
          [teamId],
        )).rowCount);
        assertNewMemberAllowed(team, hasRuns);
        const count = Number((await client.query(
          "select count(*)::int as count from hunt_v3.team_members where team_id=$1 and status<>'removed'",
          [teamId],
        )).rows[0].count);
        const maximum = Number(hunt.settings?.maxTeamSize ?? 50);
        if (count >= maximum) throw new HttpError(409, 'This team is full. Ask the organizer to correct the roster.');
        memberId = randomUUID();
        await client.query(
          `insert into hunt_v3.team_members(id,team_id,name,name_key,claim_pin_hash,status,claimed_at,checked_in_at)
            values($1,$2,$3,$4,$5,'active',now(),now())`,
          [memberId, teamId, playerName, normalizedKey(playerName), prepared.newMemberPinHash],
        );
        // Membership growth and organizer competition controls serialize on the
        // team row. Advancing the shared revision prevents an approval based on
        // a stale roster from silently accepting a just-added identity.
        await client.query(
          'update hunt_v3.teams set competition_revision=competition_revision+1 where id=$1',
          [teamId],
        );
      }
      await client.query(
        `insert into hunt_v3.roster_claim_events(team_id,member_id,action,details)
          values($1,$2,'claimed',$3)`,
        [teamId, memberId, { registrationMode: hunt.registration_mode }],
      );
    }
    const result = await establishMemberSession(client, session.hash, teamId, memberId);
    await client.query(
      `insert into hunt_v3.command_receipts(
        scope_key,request_id,operation,team_id,member_id,payload_hash,response)
        values($1,$2,'team_registration',$3,$4,$5,$6)`,
      [scopeKey, input.requestId, teamId, memberId, payloadHash, { teamId, memberId }],
    );
    return result;
    });
  } catch (error) {
    if (!(error instanceof RegistrationReplayNeeded)) throw error;
    const raced = await replayRegistration(input, payloadHash, pin, memberPin, playerName);
    if (!raced) throw new HttpError(409, 'Registration changed while the request was being recovered. Try again.');
    return raced;
  }
  return { token: session.token, summary };
}
