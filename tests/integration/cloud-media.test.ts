import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { NextRequest } from 'next/server';
import { getPool } from '../../lib/server/db';
import { uploadAsset, readMedia, makeJigsaw, deleteAsset } from '../../lib/server/media';
import { drainMediaDeletions, validateMediaStorage } from '../../lib/server/media-storage.mjs';
import { ADMIN_COOKIE, createSessionToken, HttpError } from '../../lib/server/security';

const enabled = Boolean(process.env.DATABASE_URL);
after(async () => { if (enabled) await getPool().end(); });

test('cloud media stays private, supports jigsaws, and retries failed remote deletions', { skip: !enabled }, async t => {
  await getPool().query(await readFile(new URL('../../database/v2.sql', import.meta.url), 'utf8'));
  const saved = { ...process.env };
  Object.assign(process.env, { MEDIA_STORAGE: 'supabase', SUPABASE_URL: 'https://storage.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-server-key', SUPABASE_STORAGE_BUCKET: 'test-private', MEDIA_DIRECTORY: '/unused-ephemeral-path' });
  const objects = new Map<string, Buffer>();
  const ids: string[] = [];
  let deletionUnavailable = false;
  let publicBucket = false;
  let downloads = 0;
  const session = createSessionToken();
  t.after(async () => {
    await getPool().query('delete from hunt_v2.media where id=any($1::uuid[])', [ids]);
    deletionUnavailable = false;
    await drainMediaDeletions(getPool());
    await getPool().query('delete from hunt_v2.sessions where token_hash=$1', [session.hash]);
    for (const key of ['MEDIA_STORAGE', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET', 'MEDIA_DIRECTORY']) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  });
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const request = new URL(url);
    assert.equal(request.origin, 'https://storage.example.test');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer test-server-key');
    assert.equal(headers.get('apikey'), 'test-server-key');
    if (request.pathname === '/storage/v1/bucket/test-private') return Response.json({ public: publicBucket });
    if (init.method === 'DELETE') {
      if (deletionUnavailable) return new Response('Provider unavailable', { status: 503 });
      for (const key of JSON.parse(String(init.body)).prefixes) objects.delete(key);
      return Response.json([]);
    }
    const key = request.pathname.split('/').at(-1)!;
    if (init.method === 'POST') {
      assert.equal(headers.get('x-upsert'), 'false');
      if (objects.has(key)) return new Response('Already exists', { status: 409 });
      objects.set(key, Buffer.from(init.body as Uint8Array));
      return Response.json({ Key: key });
    }
    downloads++;
    return objects.has(key) ? new Response(new Uint8Array(objects.get(key)!)) : new Response('Missing', { status: 404 });
  });
  publicBucket = true;
  await assert.rejects(validateMediaStorage(), /must be private/);
  publicBucket = false;
  await validateMediaStorage();
  const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#17826a' } }).png().toBuffer();
  const id = randomUUID(); ids.push(id);
  const file = new File([new Uint8Array(image)], 'cloud.png', { type: 'image/png' });
  const uploaded = await uploadAsset(id, file);
  assert.equal((await uploadAsset(id, file)).id, uploaded.id);
  assert.equal(objects.size, 1, 'replaying an upload does not create another object');
  await assert.rejects(readMedia(new NextRequest('https://hunt.example.test/api/v2/media'), id),
    (error: unknown) => error instanceof HttpError && error.status === 403);
  assert.equal(downloads, 0, 'authorization happens before the private storage download');
  await getPool().query("insert into hunt_v2.sessions(token_hash,role,expires_at) values($1,'admin',now()+interval '1 hour')", [session.hash]);
  const request = new NextRequest('https://hunt.example.test/api/v2/media', { headers: { cookie: `${ADMIN_COOKIE}=${session.token}` } });
  const first = await readMedia(request, id);
  process.env.MEDIA_DIRECTORY = '/a-different-empty-instance';
  assert.deepEqual((await readMedia(request, id)).bytes, first.bytes, 'read does not depend on an instance filesystem');
  const puzzle = await makeJigsaw(id, 2, 2);
  assert.equal(puzzle.type, 'jigsaw');
  if (puzzle.type !== 'jigsaw') assert.fail('Expected jigsaw');
  ids.push(...puzzle.pieces.map(piece => piece.id));
  assert.equal(objects.size, 5);
  const removed = puzzle.pieces[0].id;
  const key = (await getPool().query('select storage_key from hunt_v2.media where id=$1', [removed])).rows[0].storage_key;
  deletionUnavailable = true;
  await deleteAsset(removed);
  assert.equal(objects.has(key), true);
  assert.equal((await getPool().query('select 1 from hunt_v2.media_deletions where storage_key=$1', [key])).rowCount, 1);
  await assert.rejects(readMedia(request, removed), (error: unknown) => error instanceof HttpError && error.status === 404);
  await assert.rejects(drainMediaDeletions(getPool()), /503/);
  deletionUnavailable = false;
  await drainMediaDeletions(getPool());
  assert.equal(objects.has(key), false);
  assert.equal((await getPool().query('select 1 from hunt_v2.media_deletions where storage_key=$1', [key])).rowCount, 0);
});
