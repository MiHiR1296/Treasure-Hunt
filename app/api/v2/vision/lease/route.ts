import { NextRequest } from 'next/server'
import { handle } from '@/lib/server/http'
import { visionWorkerJson } from '@/lib/server/vision-http'
import { renewVisionLease } from '@/lib/server/vision-jobs'

export const runtime = 'nodejs'
export async function POST(request: NextRequest) { return handle(async () => { const body = await visionWorkerJson(request); return renewVisionLease(body.jobId,body.leaseToken) }) }
