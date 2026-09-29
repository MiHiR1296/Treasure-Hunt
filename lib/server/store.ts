import { randomUUID } from 'node:crypto';
import { createInitialState, executeCommand, executeControl, executeOverride, getPlayerView, parseCommand } from '../engine';
import type { GameState, HuntDefinition, OrganizerControl, OrganizerOverride, PlayerView } from '../engine/types';
import { EngineError } from '../engine/types';
import { parseControl, validateRosterNames } from '../engine/validation';
import { assertSessionPlayable, assertStartWindow, hasLobby, pauseSession, playability } from '../engine/session';
import { assignRoutes } from './routes';
import { teamSummaryQuery, organizerSummaryView } from './team-summaries';
import { appendActivity, databaseNow, type CommandActor } from './activity';
import type { PoolClient } from 'pg';
import { getPool, transaction } from './db';
import { assertPlayable, listDrafts } from './hunts';
import type { HuntStatus } from './hunts';
import { canonicalJson, createSessionToken, digest, hashPin, HttpError, rateLimit, SESSION_SECONDS, verifyPin } from './security';

export { listHunts, publishHunt, setHuntStatus } from './hunts';
export interface TeamRecord { id: string; name: string; hunt_id: string; state: GameState; definition: HuntDefinition; status: HuntStatus; is_preview: boolean; last_activity: string; created_at: string }
export type TeamView = PlayerView & { teamName: string; members: string[]; isPreview: boolean; eventStatus: HuntStatus; roster?: { minimum: number; maximum: number; ready: boolean } };
export const teamQuery = `select t.*,h.status,v.definition from hunt_v2.teams t
  join hunt_v2.hunts h on h.id=t.hunt_id
  join hunt_v2.hunt_versions v on v.hunt_id=t.hunt_id and v.version=(t.state->>'definitionVersion')::int`;

export function toTeamView(team: TeamRecord, members: string[] = [], now = new Date().toISOString()): TeamView {
  const minimum = team.definition.settings?.minTeamSize ?? 1, maximum = team.definition.settings?.maxTeamSize ?? 50;
  return { ...getPlayerView(team.definition, team.state, now), teamName: team.name, members, isPreview: team.is_preview, eventStatus: team.status,
    playability: playability(team.definition, team.state, team.is_preview ? 'live' : team.status, now, team.is_preview),
    ...(hasLobby(team.definition) ? { roster: { minimum, maximum, ready: members.length >= minimum && members.length <= maximum } } : {}) };
}
export async function getTeamRecord(teamId: string): Promise<TeamRecord> {
  const { rows } = await getPool().query(`${teamQuery} where t.id=$1`, [teamId]);
  if (!rows[0]) throw new HttpError(404, 'Team not found.');
  return rows[0];
}

export async function joinTeam(input: { huntId: string; teamName: string; pin: string; playerName: string; mode: 'create' | 'join'; memberNames?: unknown }) {
  validateRosterNames([input.playerName]);
  const nameKey = input.teamName.normalize('NFKC').trim().toLocaleLowerCase('en');
  await rateLimit(`team-signin:${input.huntId}:${nameKey}`);
  const pinHash = input.mode === 'create' ? await hashPin(input.pin) : null;
  const session = createSessionToken();
  const view = await transaction(async client => {
    const { rows: hunts } = await client.query('select definition,status,is_preview from hunt_v2.hunts where id=$1 for share', [input.huntId]);
    if (!hunts[0] || hunts[0].is_preview) throw new HttpError(404, 'Hunt not found.');
    let definition = hunts[0].definition as HuntDefinition;
    let teamId: string;
    let state: GameState;
    let previous: GameState | null = null;
    let now = await databaseNow(client);
    let teamName = input.teamName.trim();
    if (input.mode === 'create') {
      if (hasLobby(definition)) {
        if (!['ready', 'live', 'paused'].includes(hunts[0].status) || definition.settings?.registrationOpen === false || (definition.settings?.endsAt && Date.parse(now) >= Date.parse(definition.settings.endsAt))) throw new EngineError('registration_closed', 'Registration is closed for this hunt. Existing members can still sign in.');
      } else assertPlayable(hunts[0].status, definition, true, Date.parse(now));
      teamId = randomUUID();
      state = createInitialState(definition, teamId, now, { waiting: hasLobby(definition), routeAssignments: assignRoutes(definition, teamId, now) });
      const result = await client.query(`insert into hunt_v2.teams(id,hunt_id,name,name_key,pin_hash,state)
        values($1,$2,$3,$4,$5,$6) on conflict(hunt_id,name_key) do nothing`,
      [teamId, input.huntId, teamName, nameKey, pinHash, state]);
      if (!result.rowCount) throw new HttpError(409, 'That team name is taken. Join it with its PIN or choose another name.');
    } else {
      const { rows } = await client.query('select id,name,pin_hash,state,is_preview from hunt_v2.teams where hunt_id=$1 and name_key=$2 for update', [input.huntId, nameKey]);
      if (!rows[0] || rows[0].is_preview || !await verifyPin(input.pin, rows[0].pin_hash)) throw new HttpError(401, 'Team name or PIN is incorrect.');
      teamId = rows[0].id;
      state = rows[0].state;
      previous = structuredClone(state);
      teamName = rows[0].name;
      const version = await client.query('select definition from hunt_v2.hunt_versions where hunt_id=$1 and version=$2', [input.huntId, state.definitionVersion]);
      definition = version.rows[0].definition;
      now = await databaseNow(client);
      // Authentication remains available after a pause, cutoff or expiry.
    }
    const { rows: members } = await client.query('select id,name,name_key from hunt_v2.members where team_id=$1 order by joined_at,id', [teamId]);
    const playerKey = input.playerName.normalize('NFKC').trim().toLocaleLowerCase('en');
    const requested = input.mode === 'create' && input.memberNames !== undefined ? validateRosterNames(input.memberNames) : [input.playerName.normalize('NFKC').trim()];
    if (input.mode === 'join' && input.memberNames !== undefined) throw new EngineError('invalid_roster', 'Edit the roster in the team lobby.');
    if (!requested.some(name => name.toLocaleLowerCase('en') === playerKey)) throw new EngineError('invalid_roster', 'Include your own player name in the roster.');
    for (const name of requested) {
      const key = name.toLocaleLowerCase('en');
      if (members.some(member => member.name_key === key)) continue;
      if (hasLobby(definition) && state.status !== 'waiting') throw new EngineError('roster_locked', 'This team has started. Sign in using a listed member name or ask the organizer to correct the roster.');
      if (members.length >= (definition.settings?.maxTeamSize ?? 50)) throw new HttpError(409, 'This team is full. Join using your existing player name or ask the organizer for help.');
      const member = { id: randomUUID(), name, name_key: key };
      await client.query('insert into hunt_v2.members(id,team_id,name,name_key) values($1,$2,$3,$4)', [member.id, teamId, name, key]);
      members.push(member);
      if (previous) { state.revision++; state.events.push({ id: `event-${state.events.length + 1}`, type: 'roster_updated', at: now, reason: `Member joined: ${name}` }); }
    }
    const member = members.find(item => item.name_key === playerKey)!;
    await client.query(`insert into hunt_v2.sessions(token_hash,role,team_id,player_name,expires_at,member_id)
      values($1,'team',$2,$3,now()+$4*interval '1 second',$5)`, [session.hash, teamId, member.name, SESSION_SECONDS, member.id]);
    if (previous && previous.revision !== state.revision) await client.query('update hunt_v2.teams set state=$1 where id=$2', [state, teamId]);
    await appendActivity(client, definition, previous, state, now, { role: 'team', name: member.name, memberId: member.id });
    // Correct access starts a fresh failure window and does not penalize a large team.
    await client.query('delete from hunt_v2.rate_limits where key=$1', [digest(`team-signin:${input.huntId}:${nameKey}`)]);
    return toTeamView({ id: teamId, name: teamName, hunt_id: input.huntId, state, definition, status: hunts[0].status, is_preview: false, last_activity: now, created_at: now }, members.map(member => member.name), now);
  });
  return { token: session.token, view };
}

export async function teamView(teamId: string) {
  return transaction(async client => {
    await client.query('set transaction isolation level repeatable read read only');
    const team = (await client.query(`${teamQuery} where t.id=$1`, [teamId])).rows[0];
    if (!team) throw new HttpError(404, 'Team not found.');
    const { rows } = await client.query('select name from hunt_v2.members where team_id=$1 order by joined_at,id', [teamId]);
    return toTeamView(team, rows.map(row => row.name), await databaseNow(client));
  });
}

async function replaceRoster(client: PoolClient, teamId: string, definition: HuntDefinition, names: string[], started: boolean) {
  const normalized = validateRosterNames(names), minimum = started ? (definition.settings?.minTeamSize ?? 1) : 1;
  if (normalized.length < minimum || normalized.length > (definition.settings?.maxTeamSize ?? 50)) throw new EngineError('invalid_roster', `This roster must have ${minimum} to ${definition.settings?.maxTeamSize ?? 50} members.`);
  const keys = normalized.map(name => name.toLocaleLowerCase('en'));
  // Member-bound sessions are revoked by the FK; legacy sessions with this name are revoked too.
  const legacy = (await client.query('select token_hash,player_name from hunt_v2.sessions where team_id=$1 and member_id is null', [teamId])).rows;
  const revoked = legacy.filter(session => typeof session.player_name !== 'string' || !keys.includes(session.player_name.normalize('NFKC').trim().toLocaleLowerCase('en'))).map(session => session.token_hash);
  if (revoked.length) await client.query('delete from hunt_v2.sessions where token_hash=any($1::text[])', [revoked]);
  await client.query('delete from hunt_v2.members where team_id=$1 and name_key <> all($2::text[])', [teamId, keys]);
  await client.query(`insert into hunt_v2.members(id,team_id,name,name_key) select gen_random_uuid(),$1,n,k from unnest($2::text[],$3::text[]) as names(n,k)
    on conflict(team_id,name_key) do update set name=excluded.name`, [teamId, normalized, keys]);
}

export async function applyTeamCommand(teamId: string, requestId: string, input: unknown, mode: boolean | 'control' = false, actor: CommandActor = { role: mode ? 'admin' : 'team' }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new HttpError(400, 'A valid request ID is required.');
  const command = mode === 'control' ? parseControl(input) : mode ? parseOverride(input) : parseCommand(input);
  // Preserve hashes for receipts written by the foundation release.
  const payloadHash = digest(canonicalJson(mode === 'control' ? { control: true, command } : { override: mode, command }));
  return transaction(async client => {
    const identity = await client.query('select hunt_id from hunt_v2.teams where id=$1', [teamId]);
    if (!identity.rows[0]) throw new HttpError(404, 'Team not found.');
    // Consistent hunt -> team lock order is shared by joins and live operations.
    const { rows: hunts } = await client.query('select status from hunt_v2.hunts where id=$1 for share', [identity.rows[0].hunt_id]);
    if (!hunts[0]) throw new HttpError(404, 'Hunt not found.');
    const { rows: teams } = await client.query('select * from hunt_v2.teams where id=$1 for update', [teamId]);
    if (!teams[0]) throw new HttpError(404, 'Team not found.');
    const state = teams[0].state as GameState;
    const { rows: versions } = await client.query('select definition from hunt_v2.hunt_versions where hunt_id=$1 and version=$2', [teams[0].hunt_id, state.definitionVersion]);
    const definition = versions[0].definition as HuntDefinition;
    const now = await databaseNow(client);
    if (actor.sessionHash) {
      const session = await client.query('select 1 from hunt_v2.sessions where token_hash=$1 and expires_at>$2 and (team_id=$3 or role=\'admin\')', [actor.sessionHash, now, teamId]);
      if (!session.rowCount) throw new HttpError(401, 'Your membership or session changed. Sign in again.');
    }
    const { rows: receipts } = await client.query('select payload_hash,feedback from hunt_v2.command_receipts where team_id=$1 and request_id=$2', [teamId, requestId]);
    let { rows: members } = await client.query('select id,name from hunt_v2.members where team_id=$1 order by joined_at,id', [teamId]);
    const viewOf = (value: GameState) => toTeamView({ ...teams[0], definition, state: value, status: hunts[0].status }, members.map(row => row.name), now);
    if (receipts[0]) {
      if (receipts[0].payload_hash !== payloadHash) throw new HttpError(409, 'This request ID was already used for a different action.');
      return { view: viewOf(state), feedback: receipts[0].feedback };
    }
    const type = 'type' in command ? command.type : undefined;
    if (!mode) {
      if (type === 'start_session' && state.status === 'waiting') {
        if (!teams[0].is_preview) assertStartWindow(definition, hunts[0].status, now);
        if (members.length < (definition.settings?.minTeamSize ?? 1) || members.length > (definition.settings?.maxTeamSize ?? 50)) throw new EngineError('invalid_roster', 'Complete your roster before starting.');
      } else if (type === 'update_roster') {
        if (!hasLobby(definition) || state.status !== 'waiting') throw new EngineError('roster_locked', 'The roster can only be edited before starting.');
        if (['ended', 'archived'].includes(hunts[0].status)) throw new EngineError('session_ended', 'This hunt has ended. Ask the organizer to correct the roster.');
      } else if (type !== 'start_session') assertSessionPlayable(definition, state, teams[0].is_preview ? 'live' : hunts[0].status, now, teams[0].is_preview);
    }
    if (!mode && command && typeof command === 'object' && 'type' in command && command.type === 'submit_photo') {
      const photo = command as { mediaId: string; checkpointId: string; nodeId: string };
      const { rows } = await client.query("select id from hunt_v2.media where id=$1 and team_id=$2 and checkpoint_id=$3 and node_id=$4 and kind='photo' and (expires_at is null or expires_at>$5)", [photo.mediaId, teamId, photo.checkpointId, photo.nodeId, now]);
      if (!rows[0]) throw new HttpError(400, 'Take or upload a photo for this task before submitting it.');
    }
    let result;
    if (type === 'update_roster' || type === 'correct_roster' || type === 'review_result') {
      const mutation = command as Extract<ReturnType<typeof parseCommand> | OrganizerControl, { type: 'update_roster' | 'correct_roster' | 'review_result' }>;
      if (mutation.expectedRevision !== state.revision) throw new EngineError('stale_control', 'This team changed. Refresh before applying your changes.');
      const updated = structuredClone(state); updated.revision++;
      if (mutation.type === 'review_result') {
        updated.resultReview = { status: mutation.status, note: mutation.note, at: now, reviewer: actor.sessionHash ? `Organizer session ${digest(`audit-session:${actor.sessionHash}`).slice(0, 12)}` : actor.name ?? 'Organizer', reviewedRevision: updated.revision };
        updated.events.push({ id: `event-${updated.events.length + 1}`, type: 'result_reviewed', at: now, reason: `${mutation.status}: ${mutation.note}` });
      } else {
        await replaceRoster(client, teamId, definition, mutation.names, state.status !== 'waiting');
        updated.events.push({ id: `event-${updated.events.length + 1}`, type: 'roster_updated', at: now, reason: JSON.stringify({ names: mutation.names, ...('reason' in mutation ? { reason: mutation.reason } : {}) }) });
        members = (await client.query('select id,name from hunt_v2.members where team_id=$1 order by joined_at,id', [teamId])).rows;
      }
      result = { state: updated, feedback: { status: 'accepted' as const, message: mutation.type === 'review_result' ? 'Review recorded. Public standings are unchanged.' : 'Roster saved.', scannerShouldStop: false } };
    } else {
      const source = type === 'start_session' && state.status === 'waiting' ? { ...state, startingRoster: members.map(member => ({ id: member.id, name: member.name })) } : state;
      result = mode === 'control' ? executeControl(definition, source, command as OrganizerControl, now)
      : mode ? executeOverride(definition, state, command as OrganizerOverride, now)
        : executeCommand(definition, source, command as ReturnType<typeof parseCommand>, now);
      if (type === 'extend_session' && hunts[0].status === 'paused') result.state = pauseSession(result.state, now);
    }
    if (!result.state.routeAssignments) result.state.routeAssignments = assignRoutes(definition, teamId, now);
    // Review the exact photograph consumed by this transition, inside its receipt
    // transaction. Replaying an old approval must never delete a later upload.
    for (const [checkpointId, checkpoint] of Object.entries(state.checkpoints)) {
      for (const [nodeId, node] of Object.entries(checkpoint.nodes)) {
        if (!node.pendingPhotoId || node.photoStatus !== 'pending') continue;
        const afterCheckpoint = result.state.checkpoints[checkpointId];
        const after = afterCheckpoint?.nodes[nodeId];
        if (after?.pendingPhotoId === node.pendingPhotoId && after.photoStatus === 'pending' && afterCheckpoint.status !== 'skipped') continue;
        await client.query(`update hunt_v2.media set reviewed_at=$3,
          expires_at=case when retention='after_review' then $3::timestamptz else expires_at end
          where id=$1 and team_id=$2 and kind='photo'`, [node.pendingPhotoId, teamId, now]);
      }
    }
    await client.query('update hunt_v2.teams set state=$1,last_activity=$3 where id=$2', [result.state, teamId, now]);
    await appendActivity(client, definition, state, result.state, now, actor, command);
    await client.query('insert into hunt_v2.command_receipts(team_id,request_id,payload_hash,feedback) values($1,$2,$3,$4)', [teamId, requestId, payloadHash, result.feedback]);
    return { view: viewOf(result.state), feedback: result.feedback };
  });
}

function parseOverride(input: unknown): OrganizerOverride {
  const value = input as Partial<OrganizerOverride> | null;
  if (!value || typeof value.checkpointId !== 'string' || typeof value.nodeId !== 'string' || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 500) {
    throw new HttpError(400, 'Choose a current step and enter a reason for the override.');
  }
  return { checkpointId: value.checkpointId, nodeId: value.nodeId, reason: value.reason.trim() };
}

export async function organizerSnapshot() {
  const { rows: hunts } = await getPool().query('select id,title,version,status,definition,lifecycle_revision as "lifecycleRevision" from hunt_v2.hunts where not is_preview order by created_at desc');
  const { rows: teams } = await getPool().query(`${teamSummaryQuery} order by t.last_activity desc limit 200`);
  const now = new Date((await getPool().query('select clock_timestamp() as at')).rows[0].at).toISOString();
  const teamCount = await getPool().query('select count(*)::int as count from hunt_v2.teams');
  const { rows: help } = await getPool().query(`select r.*,t.name as team_name,t.hunt_id from hunt_v2.help_requests r join hunt_v2.teams t on t.id=r.team_id order by r.created_at desc limit 300`);
  const { rows: photos } = await getPool().query(`select m.id,m.team_id,m.checkpoint_id,m.node_id,m.created_at,t.name as team_name,t.hunt_id,v.definition from hunt_v2.media m join hunt_v2.teams t on t.id=m.team_id
    join hunt_v2.hunt_versions v on v.hunt_id=t.hunt_id and v.version=(t.state->>'definitionVersion')::int
    where m.kind='photo' and m.reviewed_at is null and (m.expires_at is null or m.expires_at>now())
    and t.state->'checkpoints'->m.checkpoint_id->'nodes'->m.node_id->>'pendingPhotoId'=m.id::text
    and t.state->'checkpoints'->m.checkpoint_id->'nodes'->m.node_id->>'photoStatus'='pending'
    order by m.created_at`);
  // Review against the same landmark definition the team joined, even after a
  // newer version changes its reference set. These images stay admin-only.
  const reviewPhotos = photos.map(photo => {
    const { definition, ...fields } = photo;
    const node = (definition as HuntDefinition).checkpoints.find(checkpoint => checkpoint.id === photo.checkpoint_id)?.flow.nodes.find(node => node.id === photo.node_id);
    return { ...fields, referenceImages: node?.type === 'verify_image' ? node.referenceImages : [] };
  });
  return { hunts, drafts: await listDrafts(), help, photos: reviewPhotos, teamTotal: teamCount.rows[0].count, teams: teams.map((team: TeamRecord) => ({
    id: team.id, name: team.name, huntId: team.hunt_id, version: team.state.definitionVersion, isPreview: team.is_preview, lastActivity: team.last_activity,
    view: organizerSummaryView(team, now), ledger: [], events: team.state.events,
    checkpoints: {}, detailed: false,
  })) };
}
