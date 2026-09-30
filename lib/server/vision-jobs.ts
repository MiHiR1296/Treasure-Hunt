import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { VisionComparisonScope, VisionReviewConfiguration, VisionTargetProfile } from '../engine/types'
import { parseGeneratedVisionProfile, parsePhotoVisionResult, VISION_PROFILE_PROMPT_VERSION, VISION_REVIEW_PROMPT_VERSION, type PhotoVisionResult } from '../engine/vision'
import { getPool, transaction } from './db'
import { canonicalJson, digest, HttpError } from './security'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const mediaPath = /^\/api\/v2\/media\/([0-9a-f-]{36})$/i
const scopes: VisionComparisonScope[] = ['same_physical_subject', 'same_named_place', 'same_make_model', 'same_kind']

interface PhotoJobPayload {
  targetName: string
  scope: VisionComparisonScope
  mode: VisionReviewConfiguration['mode']
  configuration: VisionReviewConfiguration
  referenceMediaIds: string[]
  requiredModel: string
  promptVersion: string
}
interface ProfileJobPayload { targetName: string; scope: VisionComparisonScope; referenceMediaIds: string[]; requiredModel: string; promptVersion: string }
export interface VisionJobRecord {
  id: string
  kind: 'target_profile' | 'photo_review'
  status: 'queued' | 'leased' | 'completed' | 'failed' | 'cancelled'
  hunt_id: string | null
  definition_version: number | null
  team_id: string | null
  media_id: string | null
  checkpoint_id: string | null
  node_id: string | null
  payload: PhotoJobPayload | ProfileJobPayload
  result: PhotoVisionResult | VisionTargetProfile | null
  result_hash: string | null
  attempts: number
  apply_status: 'not_applicable' | 'pending' | 'approved' | 'stale' | 'ineligible' | 'failed' | null
  apply_revision: number | null
  lease_token_hash: string | null
  lease_expires_at: string | null
  worker_id: string | null
  model: string | null
  prompt_version: string | null
  last_error: string | null
  created_at: string
  completed_at: string | null
}

function expectedModel() { return process.env.VISION_MODEL?.trim() || 'qwen3.8:27b-mlx' }

export function referenceMediaId(value: string): string | null {
  const match = mediaPath.exec(value)
  return match && uuid.test(match[1]) ? match[1] : null
}

export function requireVisionWorker(authorization: string | null) {
  const configured = process.env.VISION_WORKER_TOKEN
  if (!configured || configured.length < 32) throw new HttpError(503, 'The local vision worker is not configured.')
  const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  const left = Buffer.from(digest(supplied)), right = Buffer.from(digest(configured))
  if (!supplied || left.length !== right.length || !timingSafeEqual(left, right)) throw new HttpError(401, 'Worker authentication failed.')
}

function cleanTargetName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200 || /[\u0000-\u001f\u007f]/.test(value)) throw new HttpError(400, 'Enter a target name of at most 200 characters.')
  return value.trim()
}

function cleanScope(value: unknown): VisionComparisonScope {
  if (!scopes.includes(value as VisionComparisonScope)) throw new HttpError(400, 'Choose what the references are meant to identify.')
  return value as VisionComparisonScope
}

async function assertAssetMedia(client: PoolClient, referenceImages: unknown): Promise<string[]> {
  if (!Array.isArray(referenceImages) || referenceImages.length < 2 || referenceImages.length > 30) throw new HttpError(400, 'Choose between 2 and 30 reference images.')
  const ids = referenceImages.map(value => typeof value === 'string' ? referenceMediaId(value) : null)
  if (ids.some(value => !value) || new Set(ids).size !== ids.length) throw new HttpError(400, 'Image assistance requires distinct images uploaded to this application.')
  const result = await client.query("select id from hunt_v2.media where id=any($1::uuid[]) and kind='asset' and (expires_at is null or expires_at>now())", [ids])
  if (result.rowCount !== ids.length) throw new HttpError(409, 'One or more reference images are missing. Choose them from the media library again.')
  return ids as string[]
}

export async function createTargetProfileJob(input: { targetName: unknown; scope: unknown; referenceImages: unknown }) {
  return transaction(async client => {
    const targetName = cleanTargetName(input.targetName), scope = cleanScope(input.scope)
    const referenceMediaIds = await assertAssetMedia(client, input.referenceImages)
    const pending = await client.query("select count(*)::int as count from hunt_v2.vision_jobs where kind='target_profile' and status in ('queued','leased')")
    if (pending.rows[0].count >= 20) throw new HttpError(429, 'Too many target profiles are already waiting. Let the worker finish before generating more.')
    const payload: ProfileJobPayload = { targetName, scope, referenceMediaIds, requiredModel: expectedModel(), promptVersion: VISION_PROFILE_PROMPT_VERSION }
    const { rows } = await client.query(`insert into hunt_v2.vision_jobs(kind,payload,apply_status) values('target_profile',$1,'not_applicable') returning id,status,created_at`, [payload])
    return rows[0] as { id: string; status: string; created_at: string }
  })
}

export async function getTargetProfileJob(id: string) {
  if (!uuid.test(id)) throw new HttpError(400, 'Choose a valid profile job.')
  const { rows } = await getPool().query(`select id,status,result,last_error,created_at,completed_at from hunt_v2.vision_jobs where id=$1 and kind='target_profile'`, [id])
  if (!rows[0]) throw new HttpError(404, 'Target profile job not found.')
  return rows[0] as Pick<VisionJobRecord, 'id' | 'status' | 'result' | 'last_error' | 'created_at' | 'completed_at'>
}

export async function enqueuePhotoVisionJob(client: PoolClient, input: { huntId: string; definitionVersion: number; teamId: string; mediaId: string; checkpointId: string; nodeId: string; referenceImages: string[]; configuration: VisionReviewConfiguration }) {
  const selected = input.configuration.profile?.referenceSelections.map(item => item.index) ?? input.referenceImages.slice(0, 6).map((_, index) => index)
  const selectedUrls = selected.map(index => input.referenceImages[index]).filter((value): value is string => typeof value === 'string')
  const referenceMediaIds = await assertAssetMedia(client, selectedUrls)
  const payload: PhotoJobPayload = { targetName: input.configuration.targetName, scope: input.configuration.scope, mode: input.configuration.mode,
    configuration: input.configuration, referenceMediaIds, requiredModel: expectedModel(), promptVersion: VISION_REVIEW_PROMPT_VERSION }
  await client.query(`insert into hunt_v2.vision_jobs(kind,hunt_id,definition_version,team_id,media_id,checkpoint_id,node_id,payload,apply_status)
    values('photo_review',$1,$2,$3,$4,$5,$6,$7,$8) on conflict(media_id) where kind='photo_review' do nothing`,
  [input.huntId,input.definitionVersion,input.teamId,input.mediaId,input.checkpointId,input.nodeId,payload,input.configuration.mode === 'auto_approve' ? 'pending' : 'not_applicable'])
}

export async function heartbeatVisionWorker(input: { workerId: unknown; model: unknown; status: unknown; details?: unknown }) {
  if (typeof input.workerId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(input.workerId) || typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200 || !['idle','working','stopping'].includes(String(input.status))) throw new HttpError(400, 'Invalid worker heartbeat.')
  const details = input.details && typeof input.details === 'object' && !Array.isArray(input.details) && JSON.stringify(input.details).length <= 2000 ? input.details : {}
  await getPool().query(`insert into hunt_v2.vision_workers(id,model,status,details,last_seen_at) values($1,$2,$3,$4,now())
    on conflict(id) do update set model=excluded.model,status=excluded.status,details=excluded.details,last_seen_at=excluded.last_seen_at`, [input.workerId,input.model.trim(),input.status,details])
  return { ok: true }
}

export async function claimVisionJob(workerId: unknown) {
  if (typeof workerId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(workerId)) throw new HttpError(400, 'Provide a valid worker ID.')
  const leaseToken = randomBytes(32).toString('base64url'), leaseHash = digest(leaseToken)
  return transaction(async client => {
    const { rows } = await client.query(`with candidate as (
      select id from hunt_v2.vision_jobs where attempts<3 and available_at<=now()
      and (status='queued' or (status='leased' and lease_expires_at<now())) order by case when kind='photo_review' then 0 else 1 end,created_at for update skip locked limit 1
    ) update hunt_v2.vision_jobs j set status='leased',attempts=attempts+1,lease_token_hash=$2,lease_expires_at=now()+interval '5 minutes',worker_id=$1,
      started_at=coalesce(started_at,now()),updated_at=now() from candidate where j.id=candidate.id returning j.*`, [workerId,leaseHash])
    if (!rows[0]) return null
    const job = rows[0] as VisionJobRecord
    const mediaIds = [...(job.payload.referenceMediaIds ?? []), ...(job.media_id ? [job.media_id] : [])]
    return { id: job.id, kind: job.kind, payload: job.payload, mediaIds, leaseToken, leaseExpiresAt: job.lease_expires_at, attempts: job.attempts }
  })
}

export async function renewVisionLease(jobId: unknown, leaseToken: unknown) {
  if (typeof jobId !== 'string' || !uuid.test(jobId) || typeof leaseToken !== 'string') throw new HttpError(400, 'Invalid job lease.')
  const { rowCount } = await getPool().query(`update hunt_v2.vision_jobs set lease_expires_at=now()+interval '5 minutes',updated_at=now()
    where id=$1 and status='leased' and lease_token_hash=$2 and lease_expires_at>now()`, [jobId,digest(leaseToken)])
  if (!rowCount) throw new HttpError(409, 'This job lease expired or was replaced.')
  return { ok: true }
}

export async function authorizeVisionMedia(jobId: string, mediaId: string, leaseToken: string) {
  if (!uuid.test(jobId) || !uuid.test(mediaId) || !leaseToken) throw new HttpError(400, 'Invalid media lease.')
  const { rows } = await getPool().query(`select media_id,payload from hunt_v2.vision_jobs where id=$1 and status='leased' and lease_token_hash=$2 and lease_expires_at>now()`, [jobId,digest(leaseToken)])
  const job = rows[0] as { media_id: string | null; payload: PhotoJobPayload | ProfileJobPayload } | undefined
  if (!job || (job.media_id !== mediaId && !job.payload.referenceMediaIds.includes(mediaId))) throw new HttpError(403, 'This media is not assigned to the active job.')
}

export async function completeVisionJob(input: { jobId: unknown; leaseToken: unknown; model: unknown; promptVersion: unknown; result: unknown }) {
  if (typeof input.jobId !== 'string' || !uuid.test(input.jobId) || typeof input.leaseToken !== 'string' || typeof input.model !== 'string' || !input.model.trim() || input.model.length > 200 || typeof input.promptVersion !== 'string' || input.promptVersion.length > 100) throw new HttpError(400, 'Invalid vision result envelope.')
  const jobId=input.jobId, leaseToken=input.leaseToken, resultModel=input.model.trim(), promptVersion=input.promptVersion
  return transaction(async client => {
    const { rows } = await client.query('select * from hunt_v2.vision_jobs where id=$1 for update', [jobId])
    const job = rows[0] as VisionJobRecord | undefined
    if (!job || job.lease_token_hash !== digest(leaseToken)) throw new HttpError(409, 'This job lease expired or was replaced.')
    const payload = job.payload
    if (resultModel !== payload.requiredModel || promptVersion !== payload.promptVersion) throw new HttpError(409, 'The worker model or prompt version does not match this job.')
    const parsed = job.kind === 'photo_review' ? parsePhotoVisionResult(input.result) : parseGeneratedVisionProfile(input.result, payload.referenceMediaIds.length)
    if (!parsed) throw new HttpError(400, 'The worker returned an invalid structured result.')
    const resultHash = digest(canonicalJson(parsed))
    if (job.status === 'completed') {
      if (job.result_hash !== resultHash) throw new HttpError(409, 'This completed job already has a different result.')
      return job
    }
    if (job.status !== 'leased' || !job.lease_expires_at || Date.parse(job.lease_expires_at) <= Date.now()) throw new HttpError(409, 'This job lease expired or was replaced.')
    const updated = await client.query(`update hunt_v2.vision_jobs set status='completed',result=$2,result_hash=$3,model=$4,prompt_version=$5,last_error=null,completed_at=now(),updated_at=now()
      where id=$1 returning *`, [job.id,parsed,resultHash,resultModel,promptVersion])
    return updated.rows[0] as VisionJobRecord
  })
}

export async function failVisionJob(input: { jobId: unknown; leaseToken: unknown; errorCode: unknown }) {
  if (typeof input.jobId !== 'string' || !uuid.test(input.jobId) || typeof input.leaseToken !== 'string' || typeof input.errorCode !== 'string' || !/^[A-Z0-9_]{1,80}$/.test(input.errorCode)) throw new HttpError(400, 'Invalid worker failure report.')
  const { rows } = await getPool().query(`update hunt_v2.vision_jobs set status=case when attempts<3 then 'queued' else 'failed' end,
    available_at=case when attempts<3 then now()+(attempts*interval '30 seconds') else available_at end,last_error=$3,lease_expires_at=null,updated_at=now(),
    apply_status=case when attempts>=3 and kind='photo_review' then 'failed' else apply_status end
    where id=$1 and status='leased' and lease_token_hash=$2 returning status`, [input.jobId,digest(input.leaseToken),input.errorCode])
  if (!rows[0]) throw new HttpError(409, 'This job lease expired or was replaced.')
  return rows[0]
}

export async function setVisionApplyStatus(jobId: string, status: VisionJobRecord['apply_status']) {
  const { rows } = await getPool().query(`update hunt_v2.vision_jobs set apply_status=case when apply_status='approved' then 'approved' else $2 end,updated_at=now() where id=$1 returning apply_status`, [jobId,status])
  return rows[0]?.apply_status as VisionJobRecord['apply_status']
}

export async function reserveVisionApplyRevision(jobId: string, revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new HttpError(400, 'Invalid team revision for automatic approval.')
  const { rows } = await getPool().query(`update hunt_v2.vision_jobs set apply_revision=coalesce(apply_revision,$2),updated_at=now()
    where id=$1 and kind='photo_review' and status='completed' returning apply_revision`, [jobId,revision])
  if (!rows[0]) throw new HttpError(409, 'This vision job is no longer available.')
  return Number(rows[0].apply_revision)
}

export async function latestVisionWorker() {
  const { rows } = await getPool().query(`select id,model,status,last_seen_at,details,(last_seen_at>now()-interval '90 seconds') as online from hunt_v2.vision_workers order by last_seen_at desc limit 1`)
  return rows[0] ?? null
}

export async function visionQueueSummary() {
  const { rows } = await getPool().query(`select count(*) filter(where status='queued')::int as queued,
    count(*) filter(where status='leased')::int as processing,min(created_at) filter(where status in ('queued','leased')) as oldest
    from hunt_v2.vision_jobs`)
  return rows[0] as { queued:number; processing:number; oldest:string|null }
}
