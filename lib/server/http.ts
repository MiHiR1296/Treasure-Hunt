import { NextRequest, NextResponse } from 'next/server';
import { EngineError } from '../engine/types';
import { ADMIN_COOKIE, ADMIN_SESSION_SECONDS, authenticate, HttpError, PREVIEW_COOKIE, SESSION_SECONDS, TEAM_COOKIE } from './security';

export function requireSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  const expected = [process.env.APP_ORIGIN || new URL(request.url).origin,
    ...(process.env.ADDITIONAL_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)];
  if (process.env.VERCEL === '1') {
    for (const host of [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
      if (host && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/i.test(host)) expected.push(`https://${host}`);
    }
  }
  if (!origin || !expected.includes(origin)) throw new HttpError(403, 'Please open this page from the event website.');
}

export async function readBody(request: NextRequest, limit: number): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'A request body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, 'This request is too large.'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function jsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  requireSameOrigin(request);
  if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError(415, 'Please send JSON.');
  const buffer = await readBody(request, 512_000);
  let body: unknown;
  try { body = JSON.parse(buffer.toString('utf8')); }
  catch { throw new HttpError(400, 'Please send a valid request.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Please send a valid request.');
  return body as Record<string, unknown>;
}

export function textField(body: Record<string, unknown>, field: string, max = 100) {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `Please provide a valid ${field}.`);
  return value.trim();
}
export async function requireSession(request: NextRequest, role: 'team' | 'admin') {
  return authenticate(request.cookies.get(role === 'admin' ? ADMIN_COOKIE : teamCookie(request))?.value, role);
}
export function teamCookie(request: NextRequest) {
  return request.headers.get('X-Hunt-Preview') === '1' ? PREVIEW_COOKIE : TEAM_COOKIE;
}
export function sessionResponse(data: unknown, token: string, role: 'team' | 'admin' | 'preview', request: NextRequest) {
  const response = NextResponse.json(data);
  response.cookies.set(role === 'admin' ? ADMIN_COOKIE : role === 'preview' ? PREVIEW_COOKIE : TEAM_COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: (request.headers.get('origin') || process.env.APP_ORIGIN || request.url).startsWith('https://'),
    path: '/api/v2', maxAge: token ? (role === 'admin' ? ADMIN_SESSION_SECONDS : SESSION_SECONDS) : 0,
  });
  return response;
}
export async function handle(work: () => Promise<unknown>) {
  try {
    const value = await work();
    const response = value instanceof NextResponse ? value : NextResponse.json(value);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    const known = error instanceof HttpError || error instanceof EngineError;
    const status = error instanceof HttpError ? error.status : error instanceof EngineError
      ? (error.code === 'invalid_command' || error.code === 'invalid_definition' ? 400 : 409) : 503;
    if (!known) console.error('V2 request failed', error instanceof Error ? error.name : 'Unknown error');
    return NextResponse.json({ error: known ? error.message : 'The event server is unavailable. Your saved progress is safe. Please try again.',
      ...(error instanceof HttpError && error.details?.issues ? { issues: error.details.issues } : {}) }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
