import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { getPool } from '../../lib/server/db';
import { completeDirectUpload, prepareDirectUpload } from '../../lib/server/direct-uploads';
import { cleanupIncomingMedia } from '../../lib/server/maintenance.mjs';
import { ADMIN_COOKIE, createSessionToken, digest, HttpError } from '../../lib/server/security';
import { GET as download } from '../../app/api/v2/media/[id]/route';
import { POST as organizerUpload } from '../../app/api/v2/admin/media/route';
import { startPreview, simulatePreview } from '../../lib/server/operations';
import type { HuntDefinition } from '../../lib/engine/types';

const enabled = Boolean(process.env.DATABASE_URL);
after(async () => { if (enabled) await getPool().end(); });
const status = (code: number) => (error: unknown) => error instanceof HttpError && error.status === code;

test('direct uploads bind owner and checksum, retry safely, and authorize signed large-file downloads', { skip: !enabled }, async t => {
  await getPool().query(await readFile(new URL('../../database/v2.sql', import.meta.url), 'utf8'));
  const saved = { ...process.env };
  const env = { MEDIA_STORAGE: 'supabase', SUPABASE_URL: 'https://storage.example.test', SUPABASE_SERVICE_ROLE_KEY: 'server-only',
    SUPABASE_STORAGE_BUCKET: 'test-private', SUPABASE_UPLOAD_BUCKET: 'test-incoming', APP_ORIGIN: 'https://hunt.example.test' };
  Object.assign(process.env, env);
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const huntIds: string[] = [];
  const objects = new Map<string, Buffer>();
  const session = createSessionToken();
  let signatures = 0;
  let failDeletion = false;
  t.after(async () => {
    await getPool().query('delete from hunt_v2.media_uploads where id=any($1::uuid[])', [ids]);
    const removed = await getPool().query('delete from hunt_v2.media where id=any($1::uuid[]) returning storage_key', [ids]);
    await getPool().query('delete from hunt_v2.media_deletions where storage_key=any($1::text[])', [removed.rows.map(row => row.storage_key)]);
    await getPool().query('delete from hunt_v2.sessions where token_hash=$1', [session.hash]);
    await getPool().query('delete from hunt_v2.hunts where id=any($1::text[])', [huntIds]);
    await getPool().query('delete from hunt_v2.rate_limits where key=$1', [digest('direct-upload:organizer')]);
    for (const key of Object.keys(env)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  });
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const url = new URL(input);
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer server-only');
    const path = url.pathname.slice('/storage/v1/'.length);
    if (path === 'bucket/test-incoming') return Response.json({ public: false, file_size_limit: 20_000_000 });
    if (path.startsWith('object/upload/sign/')) {
      assert.equal(new Headers(init.headers).get('x-upsert'), 'false');
      return Response.json({ url: `/${path}?token=write-only-test` });
    }
    if (path.startsWith('object/sign/')) {
      signatures++;
      assert.ok(JSON.parse(String(init.body)).expiresIn <= 60);
      return Response.json({ signedURL: `/${path}?token=read-only-test` });
    }
    if (init.method === 'DELETE') {
      if (failDeletion) return new Response('unavailable', { status: 503 });
      for (const key of JSON.parse(String(init.body)).prefixes) objects.delete(`${path.slice('object/'.length)}/${key}`);
      return Response.json([]);
    }
    const key = path.slice('object/'.length);
    if (init.method === 'POST') { objects.set(key, Buffer.from(init.body as Uint8Array)); return Response.json({}); }
    return objects.has(key) ? new Response(new Uint8Array(objects.get(key)!)) : new Response('missing', { status: 404 });
  });
  const bytes = Buffer.alloc(6_000_000); bytes.write('ID3');
  const input = { requestId: ids[0], size: bytes.length, contentType: 'audio/mpeg', sha256: digest(bytes) };
  const prepared = await prepareDirectUpload({ kind: 'asset' }, input);
  assert.ok('uploadUrl' in prepared);
  if (!('uploadUrl' in prepared) || !prepared.uploadUrl) assert.fail('Expected direct upload');
  const key = new URL(prepared.uploadUrl).pathname.split('/').at(-1)!;
  await assert.rejects(completeDirectUpload({ kind: 'photo', teamId: randomUUID() }, ids[0]), status(403));
  await assert.rejects(prepareDirectUpload({ kind: 'asset' }, { ...input, sha256: 'a'.repeat(64) }), status(409));
  await assert.rejects(completeDirectUpload({ kind: 'asset' }, ids[0]), status(503));
  objects.set(`test-incoming/${key}`, bytes);
  const result = await completeDirectUpload({ kind: 'asset' }, ids[0]);
  assert.equal(result.media.bytes, 6_000_000);
  assert.equal(objects.has(`test-incoming/${key}`), false, 'raw upload is removed after validation');
  assert.deepEqual(await completeDirectUpload({ kind: 'asset' }, ids[0]), result);
  assert.deepEqual(await prepareDirectUpload({ kind: 'asset' }, input), result, 'lost finalize response reuses its committed result');
  assert.equal(objects.size, 1);

  const context = { params: Promise.resolve({ id: ids[0] }) };
  const anonymous = await download(new NextRequest('https://hunt.example.test/api/v2/media/'+ids[0]), context);
  assert.equal(anonymous.status, 403); assert.equal(signatures, 0);
  await getPool().query("insert into hunt_v2.sessions(token_hash,role,expires_at) values($1,'admin',now()+interval '1 hour')", [session.hash]);
  const response = await download(new NextRequest('https://hunt.example.test/api/v2/media/'+ids[0], {
    headers: { cookie: `${ADMIN_COOKIE}=${session.token}`, Range: 'bytes=0-99' },
  }), context);
  assert.equal(response.status, 307); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(new URL(response.headers.get('location')!).origin, 'https://storage.example.test');
  assert.equal((await response.arrayBuffer()).byteLength, 0, 'large bytes bypass the function response limit');
  assert.equal(signatures, 1);
  const wrongOrigin = await organizerUpload(new NextRequest('https://hunt.example.test/api/v2/admin/media', {
    method: 'POST', headers: { cookie: `${ADMIN_COOKIE}=${session.token}`, Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'prepare_upload', ...input }),
  }));
  assert.equal(wrongOrigin.status, 403);

  const corrupt = await prepareDirectUpload({ kind: 'asset' }, { ...input, requestId: ids[1] });
  if (!('uploadUrl' in corrupt) || !corrupt.uploadUrl) assert.fail('Expected direct upload');
  const corruptKey = new URL(corrupt.uploadUrl).pathname.split('/').at(-1)!;
  const altered = Buffer.from(bytes); altered[100] = 1; objects.set(`test-incoming/${corruptKey}`, altered);
  await assert.rejects(completeDirectUpload({ kind: 'asset' }, ids[1]), status(400));
  assert.equal((await getPool().query('select 1 from hunt_v2.media where id=$1', [ids[1]])).rowCount, 0);
  await getPool().query("update hunt_v2.media_uploads set expires_at=now()-interval '1 second' where id=$1", [ids[1]]);
  await assert.rejects(completeDirectUpload({ kind: 'asset' }, ids[1]), status(410));

  // A signed write token can be replayed after finalization. Its durable receipt
  // survives until the token expires, then removes any recreated raw object.
  objects.set(`test-incoming/${key}`, bytes);
  await getPool().query("update hunt_v2.media_uploads set cleanup_after=now()-interval '1 second' where id=any($1::uuid[])", [ids.slice(0,2)]);
  failDeletion = true;
  await assert.rejects(cleanupIncomingMedia(getPool()), /503/);
  assert.equal((await getPool().query('select 1 from hunt_v2.media_uploads where id=$1', [ids[0]])).rowCount, 1);
  failDeletion = false;
  assert.equal(await cleanupIncomingMedia(getPool()), 2);
  assert.equal(objects.size, 1, 'validated permanent media survives raw cleanup');

  const definition: HuntDefinition = { schemaVersion: 1, id: `direct-photo-${randomUUID()}`, version: 1, title: 'Photo upload test',
    checkpoints: [{ id: 'landmark', title: 'Landmark', basePoints: 20, hints: [], flow: { startNodeId: 'photo', nodes: [
      { id: 'photo', type: 'verify_image', prompt: 'Photograph the gate', referenceImages: [], next: 'done',
        location: { latitude: 19, longitude: 73, radiusMeters: 100, maxAccuracyMeters: 50 } },
      { id: 'done', type: 'complete' },
    ] } }] };
  const preview = await startPreview({ definition }); huntIds.push(preview.view.hunt.id);
  const teamId = preview.view.teamId;
  const photoBytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#126c53' } }).png().toBuffer();
  const photoInput = { requestId: ids[2], teamId, checkpointId: 'landmark', nodeId: 'photo', size: photoBytes.length,
    contentType: 'image/png', sha256: digest(photoBytes), location: { latitude: 19, longitude: 73, accuracyMeters: 5 } };
  await assert.rejects(prepareDirectUpload({ kind: 'photo', teamId }, { ...photoInput, location: { latitude: 0, longitude: 0, accuracyMeters: 5 } }), status(409));
  const preparedPhoto = await prepareDirectUpload({ kind: 'photo', teamId }, photoInput);
  if (!('uploadUrl' in preparedPhoto) || !preparedPhoto.uploadUrl) assert.fail('Expected photo upload');
  objects.set('test-incoming/'+new URL(preparedPhoto.uploadUrl).pathname.split('/').at(-1), photoBytes);
  const photo = await completeDirectUpload({ kind: 'photo', teamId }, ids[2]);
  assert.equal(photo.media.contentType, 'image/jpeg');
  assert.equal((await getPool().query('select team_id from hunt_v2.media where id=$1', [ids[2]])).rows[0].team_id, teamId);

  const late = await prepareDirectUpload({ kind: 'photo', teamId }, { ...photoInput, requestId: ids[3] });
  if (!('uploadUrl' in late) || !late.uploadUrl) assert.fail('Expected photo upload');
  objects.set('test-incoming/'+new URL(late.uploadUrl).pathname.split('/').at(-1), photoBytes);
  await simulatePreview(teamId, randomUUID(), 'success');
  await assert.rejects(completeDirectUpload({ kind: 'photo', teamId }, ids[3]), status(409), 'finalization rechecks a team that advanced during transfer');
  assert.equal((await getPool().query('select 1 from hunt_v2.media where id=$1', [ids[3]])).rowCount, 0);
});
