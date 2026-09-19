import { handle } from '@/lib/server/http';
import { listHunts } from '@/lib/server/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() { return handle(async () => ({ hunts: await listHunts() })); }
