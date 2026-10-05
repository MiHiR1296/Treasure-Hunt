import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../db';
import {
  ADMIN_SESSION_SECONDS,
  HttpError,
  SESSION_SECONDS,
  createSessionToken,
  digest,
  verifyAdminPassword,
} from '../security';

export const V3_TEAM_COOKIE = 'hunt_v3_team';
export const V3_ADMIN_COOKIE = 'hunt_v3_admin';

export type V3TeamSession = {
  role: 'team';
  teamId: string;
  memberId: string;
  memberName: string;
  sessionHash: string;
};

export type V3AdminSession = {
  role: 'admin';
  organizerName: string;
  sessionHash: string;
};

/**
 * Derive an abuse-control source at the HTTP boundary. Callers never accept a
 * source identifier from JSON. Forwarding headers are used only when a known
 * ingress is present; a direct server does not trust client-supplied IP headers.
 */
export function v3RequestSource(request: Pick<NextRequest, 'headers'>) {
  const forwarded = process.env.VERCEL
    ? request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for')
    : process.env.RENDER
      ? request.headers.get('x-forwarded-for')
      : null;
  if (forwarded) {
    // Use the right-most hop. A client-controlled value prepended to a trusted
    // proxy chain cannot create a fresh bucket for every password guess.
    const value = forwarded.split(',').map(item => item.trim()).filter(Boolean).at(-1);
    if (value) return `forwarded:${value.slice(0, 128)}`;
  }
  if (process.env.FLY_APP_NAME) {
    const value = request.headers.get('fly-client-ip')?.trim();
    if (value) return `fly-client-ip:${value.slice(0, 128)}`;
  }
  return 'unavailable';
}

export async function authenticateV3(token: string | undefined, role: 'team'): Promise<V3TeamSession>;
export async function authenticateV3(token: string | undefined, role: 'admin'): Promise<V3AdminSession>;
export async function authenticateV3(token: string | undefined, role: 'team' | 'admin'): Promise<V3TeamSession | V3AdminSession> {
  if (!token || token.length > 128) throw new HttpError(401, 'Please sign in to continue.');
  const sessionHash = digest(token);
  const { rows } = await getPool().query(
    `select s.role,s.team_id,s.member_id,s.organizer_name,m.name as member_name,t.status as team_status
      from hunt_v3.sessions s
      left join hunt_v3.team_members m on m.id=s.member_id and m.team_id=s.team_id and m.status='active'
      left join hunt_v3.teams t on t.id=s.team_id and t.status='active'
      where s.token_hash=$1 and s.role=$2 and s.revoked_at is null and s.expires_at>clock_timestamp()`,
    [sessionHash, role],
  );
  const session = rows[0];
  if (!session) throw new HttpError(401, 'Your session has expired. Please sign in again.');
  if (role === 'team') {
    if (!session.team_id || !session.member_id || !session.member_name || session.team_status !== 'active') {
      throw new HttpError(401, 'Your team membership changed. Please sign in again.');
    }
    return { role, teamId: session.team_id, memberId: session.member_id, memberName: session.member_name, sessionHash };
  }
  return { role, organizerName: session.organizer_name || 'Organizer', sessionHash };
}

export async function requireV3Session(request: NextRequest, role: 'team'): Promise<V3TeamSession>;
export async function requireV3Session(request: NextRequest, role: 'admin'): Promise<V3AdminSession>;
export async function requireV3Session(request: NextRequest, role: 'team' | 'admin') {
  const token = request.cookies.get(role === 'admin' ? V3_ADMIN_COOKIE : V3_TEAM_COOKIE)?.value;
  return role === 'team' ? authenticateV3(token, 'team') : authenticateV3(token, 'admin');
}

export function v3SessionResponse(data: unknown, token: string, role: 'team' | 'admin', request: NextRequest) {
  const response = NextResponse.json(data);
  response.cookies.set(role === 'admin' ? V3_ADMIN_COOKIE : V3_TEAM_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: (request.headers.get('origin') || process.env.APP_ORIGIN || request.url).startsWith('https://'),
    path: '/',
    maxAge: token ? (role === 'admin' ? ADMIN_SESSION_SECONDS : SESSION_SECONDS) : 0,
  });
  return response;
}

export async function createV3AdminSession(password: string, organizerName = 'Organizer', requestSource = 'server') {
  // Both limits run before the password comparison. The per-source bucket
  // stops one attacker; the much larger target bucket is a final distributed
  // abuse backstop and is deliberately never cleared after a success.
  await rateLimitV3(`organizer-signin:source:${requestSource}`, 12);
  await rateLimitV3('organizer-signin:target:admin', 500);
  if (!verifyAdminPassword(password)) throw new HttpError(401, 'Incorrect organizer password.');
  const session = createSessionToken();
  await getPool().query(
    `insert into hunt_v3.sessions(token_hash,role,organizer_name,expires_at)
      values($1,'admin',$2,now()+$3*interval '1 second')`,
    [session.hash, organizerName.normalize('NFKC').trim().slice(0, 100) || 'Organizer', ADMIN_SESSION_SECONDS],
  );
  return session;
}

/** Shared database throttling works across serverless instances and restarts. */
export async function rateLimitV3(key: string, maximum = 15) {
  const { rows } = await getPool().query(
    `insert into hunt_v3.rate_limits(key,attempts) values($1,1)
      on conflict(key) do update set
        attempts=case when hunt_v3.rate_limits.window_start<now()-interval '15 minutes' then 1 else hunt_v3.rate_limits.attempts+1 end,
        window_start=case when hunt_v3.rate_limits.window_start<now()-interval '15 minutes' then now() else hunt_v3.rate_limits.window_start end
      returning attempts`,
    [digest(key)],
  );
  if (rows[0].attempts > maximum) throw new HttpError(429, 'Too many attempts. Please try again in 15 minutes.');
}

export { createSessionToken, digest, SESSION_SECONDS };
