import { randomUUID } from 'node:crypto';
import { getPool, transaction } from '../db';
import { canonicalJson, digest, HttpError } from '../security';
import { rateLimitV3 } from './security';

const uuid = (value: string) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const helpKinds = new Set(['help', 'camera', 'gps', 'network', 'puzzle', 'photo']);

export async function playerSupport(teamId: string, memberId: string) {
  const team = (await getPool().query(
    `select team.hunt_id from hunt_v3.teams team
      join hunt_v3.team_members member on member.team_id=team.id and member.id=$2 and member.status='active'
      where team.id=$1 and team.status='active'`,
    [teamId, memberId],
  )).rows[0];
  if (!team) throw new HttpError(401, 'Your team membership changed. Sign in again.');
  const [requests, messages] = await Promise.all([
    getPool().query(
      `select id,kind,message,status,response,checkpoint_id,node_id,created_at,resolved_at
        from hunt_v3.help_requests where team_id=$1 and member_id=$2
        order by created_at desc limit 20`,
      [teamId, memberId],
    ),
    getPool().query(
      `select id,message,created_by,created_at from hunt_v3.messages
        where hunt_id=$1 and (team_id is null or team_id=$2)
        order by created_at desc limit 30`,
      [team.hunt_id, teamId],
    ),
  ]);
  return {
    requests: requests.rows.map(row => ({
      id: row.id,
      kind: row.kind,
      message: row.message,
      status: row.status,
      response: row.response,
      checkpointId: row.checkpoint_id,
      nodeId: row.node_id,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    })),
    messages: messages.rows.map(row => ({ id: row.id, message: row.message, from: row.created_by, createdAt: row.created_at })),
  };
}

export async function submitHelp(input: {
  teamId: string;
  memberId: string;
  requestId: string;
  kind: string;
  message: string;
  runId?: string;
  checkpointId?: string;
  nodeId?: string;
}) {
  if (!uuid(input.requestId) || (input.runId && !uuid(input.runId))) throw new HttpError(400, 'A valid help request ID is required.');
  if (!helpKinds.has(input.kind)) throw new HttpError(400, 'Choose a supported help category.');
  const message = input.message.normalize('NFKC').trim();
  if (!message || message.length > 1000) throw new HttpError(400, 'Describe what your team needs in 1 to 1000 characters.');
  const payloadHash = digest(canonicalJson({
    kind: input.kind,
    message,
    runId: input.runId ?? null,
    checkpointId: input.checkpointId ?? null,
    nodeId: input.nodeId ?? null,
  }));
  const scopeKey = `member:${input.memberId}:support`;
  const preflightReceipt = (await getPool().query(
    'select payload_hash from hunt_v3.command_receipts where scope_key=$1 and request_id=$2',
    [scopeKey, input.requestId],
  )).rows[0];
  if (preflightReceipt?.payload_hash !== payloadHash) {
    await rateLimitV3(`support:${input.teamId}:${input.memberId}`, 20);
  }
  return transaction(async client => {
    const team = (await client.query(
      `select team.hunt_id from hunt_v3.teams team
        join hunt_v3.team_members member on member.team_id=team.id and member.id=$2 and member.status='active'
        where team.id=$1 and team.status='active' for share of team`,
      [input.teamId, input.memberId],
    )).rows[0];
    if (!team) throw new HttpError(401, 'Your team membership changed. Sign in again.');
    const receipt = (await client.query(
      'select payload_hash,response from hunt_v3.command_receipts where scope_key=$1 and request_id=$2',
      [scopeKey, input.requestId],
    )).rows[0];
    if (receipt) {
      if (receipt.payload_hash !== payloadHash) throw new HttpError(409, 'This request ID was already used for another help request.');
      return receipt.response;
    }
    let run: { id: string; engine_state: { activeCheckpointId?: string; checkpoints?: Record<string, { activeNodeId?: string }> } } | undefined;
    if (input.runId) run = (await client.query(
      `select run.id,run.engine_state from hunt_v3.runs run
        join hunt_v3.run_members member on member.run_id=run.id and member.member_id=$3
        where run.id=$1 and run.team_id=$2`,
      [input.runId, input.teamId, input.memberId],
    )).rows[0];
    else run = (await client.query(
      `select run.id,run.engine_state from hunt_v3.runs run
        join hunt_v3.run_members member on member.run_id=run.id and member.member_id=$2
        where run.team_id=$1 order by (run.status='active') desc,run.run_number desc limit 1`,
      [input.teamId, input.memberId],
    )).rows[0];
    if (input.runId && !run) throw new HttpError(404, 'That run does not belong to your session.');
    const checkpointId = input.checkpointId?.slice(0, 160) || run?.engine_state.activeCheckpointId || null;
    const nodeId = input.nodeId?.slice(0, 160) || (checkpointId ? run?.engine_state.checkpoints?.[checkpointId]?.activeNodeId : null) || null;
    await client.query(
      `insert into hunt_v3.help_requests(id,hunt_id,team_id,run_id,member_id,checkpoint_id,node_id,kind,message)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [input.requestId, team.hunt_id, input.teamId, run?.id ?? null, input.memberId, checkpointId, nodeId, input.kind, message],
    );
    const response = { ok: true, request: { id: input.requestId, status: 'open', kind: input.kind, message } };
    await client.query(
      `insert into hunt_v3.command_receipts(scope_key,request_id,operation,team_id,run_id,member_id,payload_hash,response)
        values($1,$2,'help_request',$3,$4,$5,$6,$7)`,
      [scopeKey, input.requestId, input.teamId, run?.id ?? null, input.memberId, payloadHash, response],
    );
    return response;
  });
}

export async function adminSupport(huntId: string) {
  const hunt = (await getPool().query('select id,title from hunt_v3.hunts where id=$1', [huntId])).rows[0];
  if (!hunt) throw new HttpError(404, 'Hunt not found.');
  const [requests, messages] = await Promise.all([
    getPool().query(
      `select request.id,request.kind,request.message,request.status,request.response,request.checkpoint_id,
        request.node_id,request.created_at,request.resolved_at,team.id as team_id,team.canonical_code,
        team.display_name,member.id as member_id,member.name as member_name,request.run_id
        from hunt_v3.help_requests request join hunt_v3.teams team on team.id=request.team_id
        join hunt_v3.team_members member on member.id=request.member_id
        where request.hunt_id=$1 order by (request.status='open') desc,request.created_at desc limit 300`,
      [huntId],
    ),
    getPool().query(
      `select message.id,message.message,message.created_by,message.created_at,message.team_id,team.canonical_code
        from hunt_v3.messages message left join hunt_v3.teams team on team.id=message.team_id
        where message.hunt_id=$1 order by message.created_at desc limit 100`,
      [huntId],
    ),
  ]);
  return { hunt, requests: requests.rows, messages: messages.rows };
}

export async function resolveHelp(input: { requestId: string; response: string; actor: string }) {
  if (!uuid(input.requestId)) throw new HttpError(400, 'Choose a valid help request.');
  const response = input.response.normalize('NFKC').trim();
  if (!response || response.length > 2000) throw new HttpError(400, 'Write a response in 1 to 2000 characters.');
  return transaction(async client => {
    const request = (await client.query('select * from hunt_v3.help_requests where id=$1 for update', [input.requestId])).rows[0];
    if (!request) throw new HttpError(404, 'Help request not found.');
    if (request.status === 'resolved') throw new HttpError(409, 'This help request is already resolved.');
    const resolvedAt = new Date((await client.query('select clock_timestamp() as at')).rows[0].at).toISOString();
    await client.query(
      `update hunt_v3.help_requests set status='resolved',response=$1,resolved_at=$2,resolved_by=$3 where id=$4`,
      [response, resolvedAt, input.actor, input.requestId],
    );
    await client.query(
      `insert into hunt_v3.admin_events(action,actor,hunt_id,team_id,run_id,member_id,reason,details)
        values('help_resolved',$1,$2,$3,$4,$5,$6,$7)`,
      [input.actor, request.hunt_id, request.team_id, request.run_id, request.member_id, response, { requestId: input.requestId }],
    );
    return { ok: true, resolvedAt };
  });
}

export async function sendOrganizerMessage(input: { huntId: string; teamId?: string | null; message: string; actor: string }) {
  const message = input.message.normalize('NFKC').trim();
  if (!message || message.length > 2000) throw new HttpError(400, 'Write a message in 1 to 2000 characters.');
  return transaction(async client => {
    const hunt = (await client.query('select id from hunt_v3.hunts where id=$1', [input.huntId])).rows[0];
    if (!hunt) throw new HttpError(404, 'Hunt not found.');
    if (input.teamId) {
      const team = (await client.query('select id from hunt_v3.teams where id=$1 and hunt_id=$2', [input.teamId, input.huntId])).rows[0];
      if (!team) throw new HttpError(404, 'Team not found in this hunt.');
    }
    const id = randomUUID();
    await client.query(
      `insert into hunt_v3.messages(id,hunt_id,team_id,message,created_by) values($1,$2,$3,$4,$5)`,
      [id, input.huntId, input.teamId ?? null, message, input.actor],
    );
    await client.query(
      `insert into hunt_v3.admin_events(action,actor,hunt_id,team_id,details)
        values('message_sent',$1,$2,$3,$4)`,
      [input.actor, input.huntId, input.teamId ?? null, { messageId: id, audience: input.teamId ? 'team' : 'all' }],
    );
    return { ok: true, id };
  });
}
