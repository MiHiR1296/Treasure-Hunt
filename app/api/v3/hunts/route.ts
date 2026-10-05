import { handle } from '@/lib/server/http';
import { listV3Hunts } from '@/lib/server/v3/registration';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async () => ({ hunts: await listV3Hunts() }));
}
