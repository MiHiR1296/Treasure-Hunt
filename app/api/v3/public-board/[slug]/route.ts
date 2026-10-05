import { NextRequest } from 'next/server';
import { handle } from '@/lib/server/http';
import { publicLeaderboard } from '@/lib/server/v3/leaderboards';
import { digest, HttpError } from '@/lib/server/security';
import { v3RequestSource } from '@/lib/server/v3/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PUBLIC_READ_WINDOW_MS = 60_000;
const PUBLIC_READS_PER_WINDOW = 2_400;
const PUBLIC_SOURCE_BUCKETS = 4_096;
const publicReadWindows = new Map<string, { startedAt: number; reads: number }>();

function enforcePublicReadWindow(key: string) {
  const now = Date.now();
  const current = publicReadWindows.get(key);
  if (current && now - current.startedAt < PUBLIC_READ_WINDOW_MS) {
    current.reads += 1;
    if (current.reads > PUBLIC_READS_PER_WINDOW) throw new HttpError(429, 'This board is refreshing too quickly. Please wait a moment.');
    return;
  }
  if (publicReadWindows.size >= PUBLIC_SOURCE_BUCKETS) {
    for (const [source, window] of publicReadWindows) {
      if (now - window.startedAt >= PUBLIC_READ_WINDOW_MS) publicReadWindows.delete(source);
    }
    while (publicReadWindows.size >= PUBLIC_SOURCE_BUCKETS) {
      const oldest = publicReadWindows.keys().next().value as string | undefined;
      if (!oldest) break;
      publicReadWindows.delete(oldest);
    }
  }
  publicReadWindows.set(key, { startedAt: now, reads: 1 });
}

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const slug = (await context.params).slug;
    const source = v3RequestSource(request);
    // A high in-process ceiling stops a single-source request storm without a
    // write on every poll or blocking a school/event NAT with many screens.
    // The short promise cache in the service coalesces the expensive SQL work.
    if (source !== 'unavailable') enforcePublicReadWindow(digest(`${source}:${slug.slice(0, 100)}`));
    return publicLeaderboard(slug);
  });
}
