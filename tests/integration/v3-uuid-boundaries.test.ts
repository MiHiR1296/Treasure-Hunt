import '../isolated-database';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { GET as getRun } from '../../app/api/v3/runs/route';
import { POST as postCommand } from '../../app/api/v3/command/route';
import { GET as getRecognitionAudit } from '../../app/api/v3/admin/recognition/route';
import { POST as adminControl } from '../../app/api/v3/admin/control/route';
import { POST as reviewMedia } from '../../app/api/v3/admin/media/route';
import { getPool } from '../../lib/server/db';
import { createSessionToken, V3_ADMIN_COOKIE, V3_TEAM_COOKIE } from '../../lib/server/v3/security';

const enabled = Boolean(process.env.DATABASE_URL);
const huntId = `v3-uuid-boundary-${randomUUID().slice(0, 8)}`;
const teamId = randomUUID();
const memberId = randomUUID();
const otherTeamId = randomUUID();
const otherMemberId = randomUUID();
const teamSession = createSessionToken();
const adminSession = createSessionToken();

function request(path: string, role: 'team' | 'admin', init?: { method?: string; headers?: HeadersInit; body?: BodyInit }) {
  const headers = new Headers(init?.headers);
  headers.set('cookie', `${role === 'team' ? V3_TEAM_COOKIE : V3_ADMIN_COOKIE}=${role === 'team' ? teamSession.token : adminSession.token}`);
  return new NextRequest(`http://localhost${path}`, { ...init, headers });
}

before(async () => {
  if (!enabled) return;
  await getPool().query(await readFile(new URL('../../database/v3.sql', import.meta.url), 'utf8'));
  await getPool().query(
    `insert into hunt_v3.hunts(id,title,slug,status,registration_mode,registration_open,settings)
      values($1,'UUID boundary hunt',$1,'live','organizer_assigned',false,'{}')`,
    [huntId],
  );
  await getPool().query(
    `insert into hunt_v3.teams(
      id,hunt_id,canonical_code,name_status,pin_hash,registration_source,approval_status,status)
      values($1,$3,'T-001','code_only',$4,'organizer_assigned','approved','active'),
        ($2,$3,'T-002','code_only',$4,'organizer_assigned','approved','active')`,
    [teamId, otherTeamId, huntId, 'p'.repeat(32)],
  );
  await getPool().query(
    `insert into hunt_v3.team_members(id,team_id,name,name_key,status,checked_in_at)
      values($1,$2,'Boundary Player','boundary-player','active',now()),
        ($3,$4,'Other Player','other-player','active',now())`,
    [memberId, teamId, otherMemberId, otherTeamId],
  );
  await getPool().query(
    `insert into hunt_v3.sessions(token_hash,role,team_id,member_id,organizer_name,expires_at)
      values($1,'team',$2,$3,null,now()+interval '1 hour'),
        ($4,'admin',null,null,'Boundary Admin',now()+interval '1 hour')`,
    [teamSession.hash, teamId, memberId, adminSession.hash],
  );
});

after(async () => {
  if (enabled) await getPool().end();
});

test('V3 player routes reject malformed UUID layouts before PostgreSQL casts them', { skip: !enabled }, async () => {
  const malformed = [
    `-${'a'.repeat(35)}`,
    `${'a'.repeat(35)}-`,
    'abcd'.repeat(9),
    '-'.repeat(36),
  ];
  for (const runId of malformed) {
    const response = await getRun(request(`/api/v3/runs?runId=${encodeURIComponent(runId)}`, 'team'));
    assert.equal(response.status, 400, `malformed run ID ${JSON.stringify(runId)} is a client error`);
    assert.equal((await response.json()).code, 'invalid_request');
  }

  const command = await postCommand(request('/api/v3/command', 'team', {
    method: 'POST',
    headers: { origin: 'http://localhost', 'content-type': 'application/json' },
    body: JSON.stringify({
      runId: 'abcd'.repeat(9),
      requestId: randomUUID(),
      command: { type: 'continue', checkpointId: 'start', nodeId: 'next' },
    }),
  }));
  assert.equal(command.status, 400);
  assert.equal((await command.json()).code, 'invalid_request');
});

test('canonical but cross-entity UUIDs remain authorization-safe', { skip: !enabled }, async () => {
  for (const runId of [randomUUID(), otherTeamId, otherMemberId]) {
    const response = await getRun(request(`/api/v3/runs?runId=${runId}`, 'team'));
    assert.equal(response.status, 404, 'a valid UUID outside this team is not exposed or treated as a server failure');
    assert.equal((await response.json()).code, 'not_found');
  }

  const adminResponse = await getRecognitionAudit(request(`/api/v3/admin/recognition?runId=${otherTeamId}`, 'admin'));
  assert.equal(adminResponse.status, 404, 'using a team UUID in a run field remains a normal not-found result');
});

test('V3 admin routes reject malformed resource and idempotency UUIDs', { skip: !enabled }, async () => {
  const malformedAudit = await getRecognitionAudit(request(
    `/api/v3/admin/recognition?runId=${encodeURIComponent(`${'a'.repeat(35)}-`)}`,
    'admin',
  ));
  assert.equal(malformedAudit.status, 400);

  const review = await reviewMedia(request('/api/v3/admin/media', 'admin', {
    method: 'POST',
    headers: { origin: 'http://localhost', 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'review',
      mediaId: `-${'a'.repeat(35)}`,
      requestId: 'abcd'.repeat(9),
      approved: false,
      reason: 'Boundary check',
    }),
  }));
  assert.equal(review.status, 400);
  assert.equal((await review.json()).code, 'invalid_request');

  const rename = await adminControl(request('/api/v3/admin/control', 'admin', {
    method: 'POST',
    headers: { origin: 'http://localhost', 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'rename_team',
      teamId: '-'.repeat(36),
      displayName: 'Never applied',
      reason: 'Boundary check',
    }),
  }));
  assert.equal(rename.status, 400);
  assert.equal((await rename.json()).code, 'invalid_request');
});
