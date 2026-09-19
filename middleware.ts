import { NextRequest, NextResponse } from 'next/server';

// V1 still relies on public database mutations. Enable only during migration.
export function middleware(request: NextRequest) {
  if (process.env.ENABLE_LEGACY_V1 === 'true') return NextResponse.next();
  if (request.nextUrl.pathname === '/') return NextResponse.redirect(new URL('/v2', request.url));
  return new NextResponse('This legacy page is disabled. Open /v2 to play.', { status: 404 });
}

export const config = { matcher: ['/', '/admin/:path*', '/hunt/:path*', '/hunts/:path*', '/join/:path*'] };
