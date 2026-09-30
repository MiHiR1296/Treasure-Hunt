import { NextRequest } from 'next/server'
import { handle, jsonBody, requireSession } from '@/lib/server/http'
import { createTargetProfileJob, getTargetProfileJob } from '@/lib/server/vision-jobs'
import { HttpError } from '@/lib/server/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  return handle(async () => {
    await requireSession(request, 'admin')
    const body = await jsonBody(request)
    if (Object.keys(body).some(key => !['targetName','scope','referenceImages'].includes(key))) throw new HttpError(400, 'Unsupported target profile fields.')
    return { job: await createTargetProfileJob({ targetName: body.targetName, scope: body.scope, referenceImages: body.referenceImages }) }
  })
}

export async function GET(request: NextRequest) {
  return handle(async () => {
    await requireSession(request, 'admin')
    return { job: await getTargetProfileJob(new URL(request.url).searchParams.get('id') || '') }
  })
}
