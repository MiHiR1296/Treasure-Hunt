import { randomUUID } from 'node:crypto';
import { createInitialState, executeCommand, executeControl, executeOverride, getPlayerView, parseCommand } from '../engine';
import type { GameState, HuntDefinition, OrganizerControl, OrganizerOverride, PlayerView } from '../engine/types';
import { getPool, transaction } from './db';
import { assertPlayable, listDrafts } from './hunts';
import type { HuntStatus } from './hunts';
import { canonicalJson, createSessionToken, digest, hashPin, HttpError, rateLimit, SESSION_SECONDS, verifyPin } from './security';

export { listHunts, publishHunt, setHuntStatus } from './hunts';
export interface TeamRecord { id: string; name: string; hunt_id: string; state: GameState; definition: HuntDefinition; status: HuntStatus; is_preview: boolean; last_activity: string; created_at: string }
export type TeamView = PlayerView & { teamName: string; members: string[]; isPreview: boolean; eventStatus: HuntStatus };
export const teamQuery = `select t.*,h.status,v.definition from hunt_v2.teams t
  join hunt_v2.hunts h on h.id=t.hunt_id
  join hunt_v2.hunt_versions v on v.hunt_id=t.hunt_id and v.version=(t.state->>'definitionVersion')::int`;

export function toTeamView(team: TeamRecord, members: string[] = []): TeamView {
  return { ...getPlayerView(team.definition, team.state, new Date().toISOString()), teamName: team.name, members, isPreview: team.is_preview, eventStatus: team.status };
}
export async function getTeamRecord(teamId: string): Promise<TeamRecord> {
  const { rows } = await getPool().query(`${teamQuery} where t.id=$1`, [teamId]);
  if (!rows[0]) throw new HttpError(404, 'Team not found.');
  return rows[0];
}

export async function joinTeam(input: { huntId: string; teamName: string; pin: string; playerName: string; mode: 'create' | 'join' }) {
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
    let teamName = input.teamName.trim();
    if (input.mode === 'create') {
      assertPlayable(hunts[0].status, definition, true);
      teamId = randomUUID();
      state = createInitialState(definition, teamId, new Date().toISOString());
      const result = await client.query(`insert into hunt_v2.teams(id,hunt_id,name,name_key,pin_hash,state)
        values($1,$2,$3,$4,$5,$6) on conflict(hunt_id,name_key) do nothing`,
      [teamId, input.huntId, teamName, nameKey, pinHash, state]);
      if (!result.rowCount) throw new HttpError(409, 'That team name is taken. Join it with its PIN or choose another name.');
    } else {
      const { rows } = await client.query('select id,name,pin_hash,state,is_preview from hunt_v2.teams where hunt_id=$1 and name_key=$2 for update', [input.huntId, nameKey]);
      if (!rows[0] || rows[0].is_preview || !await verifyPin(input.pin, rows[0].pin_hash)) throw new HttpError(401, 'Team name or PIN is incorrect.');
      teamId = rows[0].id;
      state = rows[0].state;
      teamName = rows[0].name;
      const version = await client.query('select definition from hunt_v2.hunt_versions where hunt_id=$1 and version=$2', [input.huntId, state.definitionVersion]);
      definition = version.rows[0].definition;
      assertPlayable(hunts[0].status, definition);
    }
    const { rows: members } = await client.query('select name,name_key from hunt_v2.members where team_id=$1', [teamId]);
    const playerKey = input.playerName.normalize('NFKC').trim().toLocaleLowerCase('en');
    if (!members.some(member => member.name_key === playerKey)) {
      if (members.length >= (definition.settings?.maxTeamSize ?? 50)) throw new HttpError(409, 'This team is full. Join using your existing player name or ask the organizer for help.');
      await client.query('insert into hunt_v2.members(id,team_id,name,name_key) values($1,$2,$3,$4)', [randomUUID(), teamId, input.playerName.trim(), playerKey]);
      members.push({ name: input.playerName.trim(), name_key: playerKey });
    }
    await client.query(`insert into hunt_v2.sessions(token_hash,role,team_id,player_name,expires_at)
      values($1,'team',$2,$3,now()+$4*interval '1 second')`, [session.hash, teamId, input.playerName.trim(), SESSION_SECONDS]);
    // Correct access starts a fresh failure window and does not penalize a large team.
    await client.query('delete from hunt_v2.rate_limits where key=$1', [digest(`team-signin:${input.huntId}:${nameKey}`)]);
    return { ...getPlayerView(definition, state, new Date().toISOString()), teamName, members: members.map(member => member.name), isPreview: false, eventStatus: hunts[0].status } as TeamView;
  });
  return { token: session.token, view };
}

export async function teamView(teamId: string) {
  const team = await getTeamRecord(teamId);
  const { rows } = await getPool().query('select name from hunt_v2.members where team_id=$1 order by joined_at', [teamId]);
  return toTeamView(team, rows.map(row => row.name));
}

export async function applyTeamCommand(teamId: string, requestId: string, input: unknown, mode: boolean | 'control' = false) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new HttpError(400, 'A valid request ID is required.');
  const command = mode === 'control' ? input as OrganizerControl : mode ? parseOverride(input) : parseCommand(input);
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
    const now = new Date().toISOString();
    const { rows: receipts } = await client.query('select payload_hash,feedback from hunt_v2.command_receipts where team_id=$1 and request_id=$2', [teamId, requestId]);
    const { rows: members } = await client.query('select name from hunt_v2.members where team_id=$1 order by joined_at', [teamId]);
    const viewOf = (value: GameState) => toTeamView({ ...teams[0], definition, state: value, status: hunts[0].status }, members.map(row => row.name));
    if (receipts[0]) {
      if (receipts[0].payload_hash !== payloadHash) throw new HttpError(409, 'This request ID was already used for a different action.');
      return { view: viewOf(state), feedback: receipts[0].feedback };
    }
    if (!mode && !teams[0].is_preview) assertPlayable(hunts[0].status, definition);
    if (!mode && command && typeof command === 'object' && 'type' in command && command.type === 'submit_photo') {
      const photo = command as { mediaId: string; checkpointId: string; nodeId: string };
      const { rows } = await client.query("select id from hunt_v2.media where id=$1 and team_id=$2 and checkpoint_id=$3 and node_id=$4 and kind='photo' and (expires_at is null or expires_at>now())", [photo.mediaId, teamId, photo.checkpointId, photo.nodeId]);
      if (!rows[0]) throw new HttpError(400, 'Take or upload a photo for this task before submitting it.');
    }
    const result = mode === 'control' ? executeControl(definition, state, command as OrganizerControl, now)
      : mode ? executeOverride(definition, state, command as OrganizerOverride, now)
        : executeCommand(definition, state, command as ReturnType<typeof parseCommand>, now);
    // Review the exact photograph consumed by this transition, inside its receipt
    // transaction. Replaying an old approval must never delete a later upload.
    for (const [checkpointId, checkpoint] of Object.entries(state.checkpoints)) {
      for (const [nodeId, node] of Object.entries(checkpoint.nodes)) {
        if (!node.pendingPhotoId || node.photoStatus !== 'pending') continue;
        const afterCheckpoint = result.state.checkpoints[checkpointId];
        const after = afterCheckpoint?.nodes[nodeId];
        if (after?.pendingPhotoId === node.pendingPhotoId && after.photoStatus === 'pending' && afterCheckpoint.status !== 'skipped') continue;
        await client.query(`update hunt_v2.media set reviewed_at=now(),
          expires_at=case when retention='after_review' then now() else expires_at end
          where id=$1 and team_id=$2 and kind='photo'`, [node.pendingPhotoId, teamId]);
      }
    }
    await client.query('update hunt_v2.teams set state=$1,last_activity=now() where id=$2', [result.state, teamId]);
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
  const { rows: hunts } = await getPool().query('select id,title,version,status,definition from hunt_v2.hunts where not is_preview order by created_at desc');
  const { rows: teams } = await getPool().query(`${teamQuery} order by t.last_activity desc`);
  const { rows: help } = await getPool().query(`select r.*,t.name as team_name,t.hunt_id from hunt_v2.help_requests r join hunt_v2.teams t on t.id=r.team_id order by r.created_at desc limit 300`);
  const { rows: photos } = await getPool().query(`select m.id,m.team_id,m.checkpoint_id,m.node_id,m.created_at,t.name as team_name,t.hunt_id from hunt_v2.media m join hunt_v2.teams t on t.id=m.team_id
    where m.kind='photo' and m.reviewed_at is null and (m.expires_at is null or m.expires_at>now())
    and t.state->'checkpoints'->m.checkpoint_id->'nodes'->m.node_id->>'pendingPhotoId'=m.id::text
    and t.state->'checkpoints'->m.checkpoint_id->'nodes'->m.node_id->>'photoStatus'='pending'
    order by m.created_at`);
  // Review against the same landmark definition the team joined, even after a
  // newer version changes its reference set. These images stay admin-only.
  const definitions = new Map<string, HuntDefinition>(teams.map((team: TeamRecord) => [team.id, team.definition]));
  const reviewPhotos = photos.map(photo => {
    const node = definitions.get(photo.team_id)?.checkpoints.find(checkpoint => checkpoint.id === photo.checkpoint_id)?.flow.nodes.find(node => node.id === photo.node_id);
    return { ...photo, referenceImages: node?.type === 'verify_image' ? node.referenceImages : [] };
  });
  return { hunts, drafts: await listDrafts(), help, photos: reviewPhotos, teams: teams.map((team: TeamRecord) => ({
    id: team.id, name: team.name, huntId: team.hunt_id, version: team.state.definitionVersion, isPreview: team.is_preview, lastActivity: team.last_activity,
    view: toTeamView(team), ledger: team.state.ledger, events: team.state.events,
    checkpoints: team.state.checkpoints, definition: team.definition,
  })) };
}
