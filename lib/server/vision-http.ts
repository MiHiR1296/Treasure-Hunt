import { NextRequest } from 'next/server'
import { readBody } from './http'
import { requireVisionWorker } from './vision-jobs'
import { HttpError } from './security'

export async function visionWorkerJson(request: NextRequest): Promise<Record<string, unknown>> {
  requireVisionWorker(request.headers.get('authorization'))
  if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError(415, 'Please send JSON.')
  let value: unknown
  try { value = JSON.parse((await readBody(request, 64_000)).toString('utf8')) }
  catch { throw new HttpError(400, 'Please send a valid worker request.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Please send a valid worker request.')
  return value as Record<string, unknown>
}
