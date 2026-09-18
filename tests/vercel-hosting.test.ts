import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { databaseConfig } from '../lib/server/database-config.mjs';
import { GET as maintenance } from '../app/api/v2/maintenance/route';
import { uploadMedia } from '../components/v2/mediaUpload';
import { requireSameOrigin } from '../lib/server/http';

test('Vercel accepts only the configured hunt and provider-supplied project origins', t => {
  const values = { VERCEL: '1', APP_ORIGIN: 'https://hunt.mrbtstudio.com', ADDITIONAL_ORIGINS: '',
    VERCEL_URL: 'hunt-specific-deployment.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'hunt-specific-project.vercel.app' };
  const saved = { ...process.env }; Object.assign(process.env, values);
  t.after(() => { for (const key of Object.keys(values)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
  for (const origin of [values.APP_ORIGIN, `https://${values.VERCEL_URL}`, `https://${values.VERCEL_PROJECT_PRODUCTION_URL}`]) {
    assert.doesNotThrow(() => requireSameOrigin(new NextRequest(values.APP_ORIGIN+'/api/v2/session', { headers: { origin } })));
  }
  for (const origin of ['https://mrbtstudio.com', 'https://someone-else.vercel.app']) {
    assert.throws(() => requireSameOrigin(new NextRequest(values.APP_ORIGIN+'/api/v2/session', { headers: { origin } })));
  }
});

test('an explicit database CA preserves verified TLS despite URL overrides', () => {
  const result = databaseConfig('postgresql://user:example@db.example.test:5432/postgres?sslmode=no-verify&ssl=false', 'certificate\\nline');
  assert.equal(result.ssl?.rejectUnauthorized, true);
  assert.equal(result.ssl?.ca, 'certificate\nline');
  assert.equal(new URL(result.connectionString).searchParams.has('sslmode'), false);
  assert.equal(new URL(result.connectionString).searchParams.has('ssl'), false);
  assert.deepEqual(databaseConfig('postgresql://localhost/test', ''), { connectionString: 'postgresql://localhost/test' });
});

test('scheduled cleanup rejects unconfigured or unauthenticated requests before accessing data', async t => {
  const saved = process.env.CRON_SECRET;
  t.after(() => { if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved; });
  delete process.env.CRON_SECRET;
  assert.equal((await maintenance(new NextRequest('https://hunt.example.test/api/v2/maintenance'))).status, 503);
  process.env.CRON_SECRET = 'cron-fixture-only-'.repeat(3);
  assert.equal((await maintenance(new NextRequest('https://hunt.example.test/api/v2/maintenance'))).status, 401);
  assert.equal((await maintenance(new NextRequest('https://hunt.example.test/api/v2/maintenance', { headers: { authorization: 'Bearer invalid' } }))).status, 401);
});

test('large uploads send only metadata through the app and recover a lost storage response', async t => {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(6_000_000)], 'large.mp3', { type: 'audio/mpeg' }));
  form.set('requestId', '00000000-0000-4000-8000-000000000001');
  let bytesSent = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://storage.example.test/signed-write');
    assert.equal(options.credentials, 'omit');
    assert.equal(new Headers(options.headers).has('authorization'), false);
    bytesSent = (options.body as Blob).size;
    throw new Error('Response lost after upload');
  });
  const calls: string[] = [];
  const media = { id: String(form.get('requestId')), url: '/api/v2/media/test', contentType: 'audio/mpeg', bytes: 6_000_000 };
  const result = await uploadMedia(form, async body => {
    assert.ok(!(body instanceof FormData));
    assert.ok(JSON.stringify(body).length < 1000);
    calls.push(String(body.action));
    return body.action === 'prepare_upload' ? { mode: 'direct', uploadUrl: 'https://storage.example.test/signed-write' } : { media };
  });
  assert.equal(bytesSent, 6_000_000);
  assert.deepEqual(calls, ['prepare_upload', 'complete_upload']);
  assert.deepEqual(result, { media });
});
