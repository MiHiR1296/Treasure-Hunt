import { randomUUID } from 'node:crypto';
import { createInitialState } from '../engine';
import type { GameCommand, GameState, HuntDefinition, OrganizerControl } from '../engine/types';
import { getPool, transaction } from './db';
import { publishInTransaction, validatedDefinition } from './hunts';
import { canonicalJson, createSessionToken, digest, hashPin, HttpError, SESSION_SECONDS } from './security';
import { applyTeamCommand, getTeamRecord, teamQuery, toTeamView, type TeamRecord } from './store';

export async function startPreview(input: { huntId?: string; draftId?: string; definition?: unknown }) {
  const session = createSessionToken();
  const teamId = randomUUID();
  const pinHash = await hashPin(randomUUID());
  return transaction(async client => {
    let definition: HuntDefinition;
    if (input.definition || input.draftId) {
      let source = input.definition;
      if (input.draftId) {
        const { rows } = await client.query('select definition from hunt_v2.drafts where id=$1', [input.draftId]);
        if (!rows[0]) throw new HttpError(404, 'Draft not found.');
        source = rows[0].definition;
      }
      const parsed = validatedDefinition(source);
      definition = await publishInTransaction(client, { ...parsed, id: `preview-${randomUUID()}`, version: 1 }, { preview: true });
    } else {
      const { rows } = await client.query('select definition from hunt_v2.hunts where id=$1 and not is_preview for share', [input.huntId]);
      if (!rows[0]) throw new HttpError(404, 'Hunt not found.');
      definition = rows[0].definition;
    }
    const state = createInitialState(definition, teamId, new Date().toISOString());
    const name = `Preview ${new Date().toLocaleTimeString('en-GB')}`;
    const { rows } = await client.query(`insert into hunt_v2.teams(id,hunt_id,name,name_key,pin_hash,state,is_preview)
      values($1,$2,$3,$4,$5,$6,true) returning *`, [teamId, definition.id, name, teamId, pinHash, state]);
    await client.query(`insert into hunt_v2.sessions(token_hash,role,team_id,player_name,expires_at)
      values($1,'team',$2,'Organizer preview',now()+$3*interval '1 second')`, [session.hash, teamId, SESSION_SECONDS]);
    return { token: session.token, view: toTeamView({ ...rows[0], definition, status: 'live' }), url: '/v2?preview=1' };
  });
}

export async function simulatePreview(teamId: string, requestId: string, action: string, value?: string) {
  const team = await getTeamRecord(teamId);
  if (!team.is_preview) throw new HttpError(403, 'Simulation is available only for a test session.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new HttpError(400, 'A valid request ID is required.');
  const payloadHash = digest(canonicalJson({ action, value: value ?? null }));
  const previous = await getPool().query('select * from hunt_v2.preview_commands where team_id=$1 and request_id=$2', [teamId,requestId]);
  if (previous.rows[0]) {
    if (previous.rows[0].payload_hash !== payloadHash) throw new HttpError(409, 'This simulation request was already used for another action.');
    return applyTeamCommand(teamId,requestId,previous.rows[0].command,previous.rows[0].is_control ? 'control' : false);
  }
  const apply = async (command: GameCommand | OrganizerControl, isControl = false) => {
    // Preserve the derived target and revision before execution, including races
    // and responses lost after commit. Simulations use the same engine receipts.
    await getPool().query(`insert into hunt_v2.preview_commands(team_id,request_id,payload_hash,command,is_control)
      values($1,$2,$3,$4,$5) on conflict do nothing`, [teamId,requestId,payloadHash,command,isControl]);
    const saved = (await getPool().query('select * from hunt_v2.preview_commands where team_id=$1 and request_id=$2', [teamId,requestId])).rows[0];
    if (saved.payload_hash !== payloadHash) throw new HttpError(409, 'This simulation request was already used for another action.');
    return applyTeamCommand(teamId,requestId,saved.command,saved.is_control ? 'control' : false);
  };
  const checkpoint = team.definition.checkpoints.find(item => item.id === team.state.activeCheckpointId);
  const progress = checkpoint && team.state.checkpoints[checkpoint.id];
  const node = checkpoint?.flow.nodes.find(item => item.id === progress?.activeNodeId);
  if (action === 'jump' && value) {
    return apply({ type: 'move_checkpoint', checkpointId: value, expectedRevision: team.state.revision, reason: 'Preview checkpoint jump' }, true);
  }
  if (!checkpoint || !node) throw new HttpError(409, 'Choose another checkpoint to continue testing.');
  const address = { checkpointId: checkpoint.id, nodeId: node.id };
  if (action === 'success') return apply({ type: 'approve_action', ...address, expectedRevision: team.state.revision, reason: 'Simulated success in preview' }, true);
  let command: GameCommand;
  if (action === 'hint' && value) command = { type: 'use_hint', checkpointId: checkpoint.id, hintId: value };
  else if (action === 'fallback') command = { type: 'use_fallback', ...address };
  else if (action === 'wrong' && ['verify_qr','verify_answer','verify_code'].includes(node.type)) command = { type: 'verify', ...address, value: `wrong-${randomUUID()}` };
  else if (action === 'gps' && node.type === 'verify_gps') command = { type: 'verify_gps', ...address, location: { latitude: node.latitude, longitude: node.longitude, accuracyMeters: 5 } };
  else throw new HttpError(400, 'This simulation does not apply to the current task.');
  return apply(command);
}

export async function submitHelp(teamId: string, input: { requestId: string; kind: string; message: string; checkpointId?: string; nodeId?: string }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId) || !['help','camera','gps','network','puzzle','photo'].includes(input.kind) || !input.message.trim() || input.message.length > 1000) throw new HttpError(400, 'Describe the help you need in a short message.');
  return transaction(async client => {
    const { rows } = await client.query('select state from hunt_v2.teams where id=$1 for update', [teamId]);
    if (!rows[0]) throw new HttpError(404, 'Team not found.');
    const state = rows[0].state as GameState;
    const existing = await client.query('select * from hunt_v2.help_requests where id=$1 and team_id=$2', [input.requestId, teamId]);
    if (existing.rows[0]) {
      if (existing.rows[0].message !== input.message.trim() || existing.rows[0].kind !== input.kind) throw new HttpError(409, 'That request ID was already used for another help request.');
      return existing.rows[0];
    }
    if (input.checkpointId && input.checkpointId !== state.activeCheckpointId) throw new HttpError(409, 'Your team has moved on. Refresh before asking for help.');
    const active = state.activeCheckpointId ? state.checkpoints[state.activeCheckpointId] : null;
    if (input.nodeId && input.nodeId !== active?.activeNodeId) throw new HttpError(409, 'Your team has moved on. Refresh before asking for help.');
    const recent = await client.query("select id from hunt_v2.help_requests where team_id=$1 and status='open' and kind=$2 and created_at>now()-interval '1 minute' limit 1", [teamId, input.kind]);
    if (recent.rows[0]) throw new HttpError(429, 'Your help request is already with the organizer. You can check its reply below.');
    const result = await client.query(`insert into hunt_v2.help_requests(id,team_id,checkpoint_id,node_id,kind,message)
      values($1,$2,$3,$4,$5,$6) returning *`, [input.requestId, teamId, state.activeCheckpointId, active?.activeNodeId, input.kind, input.message.trim()]);
    await client.query('update hunt_v2.teams set last_activity=now() where id=$1', [teamId]);
    return result.rows[0];
  });
}

export async function teamMessages(teamId: string) {
  const team = await getTeamRecord(teamId);
  const help = await getPool().query('select id,kind,message,status,response,created_at,resolved_at from hunt_v2.help_requests where team_id=$1 order by created_at desc limit 30', [teamId]);
  const messages = await getPool().query('select id,message,created_at from hunt_v2.messages where hunt_id=$1 and (team_id=$2 or team_id is null) order by created_at desc limit 30', [team.hunt_id, teamId]);
  return { help: help.rows, messages: messages.rows };
}

export async function resolveHelp(id: string, response: string) {
  if (!response.trim() || response.length > 2000) throw new HttpError(400, 'Enter a reply to the team.');
  return transaction(async client => {
    const result = await client.query("update hunt_v2.help_requests set status='resolved',response=$1,resolved_at=now() where id=$2 returning team_id", [response.trim(), id]);
    if (!result.rows[0]) throw new HttpError(404, 'Help request not found.');
    await client.query('insert into hunt_v2.admin_events(action,details) values($1,$2)', ['help_resolved', { id, teamId: result.rows[0].team_id, response: response.trim() }]);
  });
}

export async function sendAnnouncement(huntId: string, message: string, teamId?: string) {
  if (!message.trim() || message.length > 2000) throw new HttpError(400, 'Enter a message of at most 2,000 characters.');
  return transaction(async client => {
    if (teamId) {
      const team = await client.query('select id from hunt_v2.teams where id=$1 and hunt_id=$2', [teamId, huntId]);
      if (!team.rows[0]) throw new HttpError(404, 'Team not found in this hunt.');
    }
    await client.query('insert into hunt_v2.messages(id,hunt_id,team_id,message) values($1,$2,$3,$4)', [randomUUID(), huntId, teamId ?? null, message.trim()]);
    await client.query('insert into hunt_v2.admin_events(action,hunt_id,details) values($1,$2,$3)', ['announcement', huntId, { teamId, message: message.trim() }]);
  });
}

function teamMetrics(team: TeamRecord) {
  const checkpoints = Object.values(team.state.checkpoints);
  const startedAt = team.state.startedAt ? Date.parse(team.state.startedAt) : Math.min(...checkpoints.flatMap(progress => progress.startedAt ? [Date.parse(progress.startedAt)] : []));
  const completedAt = team.state.completedAt ?? (team.state.status === 'completed' ? team.state.events.findLast(event => event.type === 'hunt_completed')?.at : undefined);
  return { teamId: team.id, name: team.name, score: team.state.score, completed: checkpoints.filter(progress => ['completed','skipped'].includes(progress.status)).length,
    total: team.definition.checkpoints.length, hints: Object.keys(team.state.hintUsage).length, finished: Boolean(completedAt),
    seconds: completedAt && Number.isFinite(startedAt) ? Math.max(0, Math.floor((Date.parse(completedAt) - startedAt) / 1000)) : null };
}

/** Equal configured results share a rank; names only stabilize their display order. */
export function rankLeaderboard(entries: ReturnType<typeof teamMetrics>[], ranking: 'points' | 'progress' | 'points_time') {
  const compare = (a: typeof entries[number], b: typeof entries[number]) => {
    if (ranking === 'progress') return b.completed - a.completed;
    const points = b.score - a.score;
    if (points || ranking === 'points') return points;
    const aSeconds = a.seconds ?? Infinity, bSeconds = b.seconds ?? Infinity;
    return aSeconds === bSeconds ? 0 : aSeconds - bSeconds;
  };
  const ordered = [...entries].sort((a, b) => compare(a, b) || a.name.localeCompare(b.name));
  let rank = 1;
  return ordered.map((entry, index) => {
    if (index && compare(entry, ordered[index - 1]) !== 0) rank = index + 1;
    return { ...entry, rank };
  });
}

export async function leaderboard(teamId: string) {
  const viewer = await getTeamRecord(teamId);
  const mode = viewer.definition.settings?.leaderboard ?? 'live';
  const finished = Boolean(viewer.state.completedAt) || viewer.state.status === 'completed';
  if (mode === 'hidden' || (mode === 'finish' && !finished)) return { visible: false, reason: mode === 'hidden' ? 'The leaderboard is hidden for this hunt.' : 'The leaderboard will appear when your team finishes.', entries: [] };
  const { rows } = await getPool().query(`${teamQuery} where t.hunt_id=$1 and not t.is_preview`, [viewer.hunt_id]);
  const ranking = viewer.definition.settings?.ranking ?? 'points';
  const entries = rows.map((team: TeamRecord) => teamMetrics(team));
  return { visible: true, ranking, entries: rankLeaderboard(entries, ranking) };
}

export async function eventAnalytics(huntId: string) {
  const { rows } = await getPool().query(`${teamQuery} where t.hunt_id=$1 and not t.is_preview`, [huntId]);
  const teams = rows as TeamRecord[];
  const metrics = teams.map(teamMetrics);
  const help = await getPool().query("select r.kind,count(*)::int as count from hunt_v2.help_requests r join hunt_v2.teams t on t.id=r.team_id where t.hunt_id=$1 and not t.is_preview and r.status='open' group by r.kind", [huntId]);
  const checkpoints: Record<string, { id: string; title: string; completions: number; failures: number; hints: number; totalSeconds: number }> = {};
  for (const team of teams) for (const checkpoint of team.definition.checkpoints) {
    const summary = checkpoints[checkpoint.id] ??= { id: checkpoint.id, title: checkpoint.title, completions: 0, failures: 0, hints: 0, totalSeconds: 0 };
    const progress = team.state.checkpoints[checkpoint.id];
    if (progress.completedAt && progress.startedAt) { summary.completions++; summary.totalSeconds += Math.max(0, Date.parse(progress.completedAt) - Date.parse(progress.startedAt)) / 1000; }
    summary.failures += team.state.events.filter(event => event.checkpointId === checkpoint.id && event.type === 'verification_failed').length;
    summary.hints += Object.values(team.state.hintUsage).filter(usage => usage.checkpointId === checkpoint.id).length;
  }
  const now = Date.now();
  return { teams: teams.length, completed: metrics.filter(team => team.finished).length,
    averageScore: metrics.length ? metrics.reduce((sum, team) => sum + team.score, 0) / metrics.length : 0,
    stalled: teams.filter(team => team.state.status !== 'completed' && now - Date.parse(team.last_activity) > 10 * 60_000).map(team => ({ id: team.id, name: team.name, lastActivity: team.last_activity })),
    helpByKind: help.rows, checkpoints: Object.values(checkpoints).map(checkpoint => ({ ...checkpoint, averageSeconds: checkpoint.completions ? checkpoint.totalSeconds / checkpoint.completions : null })) };
}
