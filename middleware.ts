import { NextRequest, NextResponse } from 'next/server';

// V1 still relies on public database mutations. Enable only during migration.
export function middleware(request: NextRequest) {
  if (process.env.ENABLE_LEGACY_V1 === 'true') return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (path === '/') return NextResponse.redirect(new URL('/v3', request.url));
  if (path === '/v2' || path.startsWith('/v2/')) {
    return NextResponse.redirect(new URL(path.startsWith('/v2/admin') ? '/v3/admin' : '/v3', request.url));
  }
  if (path === '/api/v2' || path.startsWith('/api/v2/')) {
    return NextResponse.json({ error: 'Treasure Hunt V2 is archived. Start a new V3 session.', code: 'version_retired' }, { status: 410 });
  }
  return new NextResponse('This legacy page is disabled. Open /v3 to play.', { status: 404 });
}

export const config = { matcher: ['/', '/v2/:path*', '/api/v2/:path*', '/admin/:path*', '/hunt/:path*', '/hunts/:path*', '/join/:path*'] };
