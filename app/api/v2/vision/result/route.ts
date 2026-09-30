import { NextRequest } from 'next/server'
import { eligibleForAutoApproval, type PhotoVisionResult } from '@/lib/engine/vision'
import type { VisionReviewConfiguration } from '@/lib/engine/types'
import { handle } from '@/lib/server/http'
import { applyTeamCommand, getTeamRecord } from '@/lib/server/store'
import { visionWorkerJson } from '@/lib/server/vision-http'
import { completeVisionJob, reserveVisionApplyRevision, setVisionApplyStatus } from '@/lib/server/vision-jobs'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  return handle(async () => {
    const body = await visionWorkerJson(request)
    const job = await completeVisionJob({ jobId: body.jobId, leaseToken: body.leaseToken, model: body.model, promptVersion: body.promptVersion, result: body.result })
    if (job.kind !== 'photo_review' || job.apply_status === 'approved') return { jobId: job.id, status: job.status, applyStatus: job.apply_status }
    const payload = job.payload as typeof job.payload & { configuration: VisionReviewConfiguration }
    const result = job.result as PhotoVisionResult
    if (payload.configuration.mode !== 'auto_approve') return { jobId: job.id, status: job.status, applyStatus: 'not_applicable' }
    const apply = async (expectedRevision:number) => {
      await applyTeamCommand(job.team_id!,job.id,{ type:'approve_action',checkpointId:job.checkpoint_id,nodeId:job.node_id,expectedRevision,
        reason:`Local vision auto-approval: ${result.reason}` },'control',{ role:'system',name:'Local vision worker' })
      return setVisionApplyStatus(job.id,'approved')
    }
    if (job.apply_revision !== null) {
      try { return { jobId:job.id,status:job.status,applyStatus:await apply(job.apply_revision) } }
      catch { return { jobId:job.id,status:job.status,applyStatus:await setVisionApplyStatus(job.id,'stale') } }
    }
    try {
      const team = await getTeamRecord(job.team_id!)
      const checkpoint = team.definition.checkpoints.find(item => item.id === job.checkpoint_id)
      const node = checkpoint?.flow.nodes.find(item => item.id === job.node_id)
      const progress = team.state.checkpoints[job.checkpoint_id!]?.nodes[job.node_id!]
      if (team.state.definitionVersion !== job.definition_version || team.state.activeCheckpointId !== job.checkpoint_id || node?.type !== 'verify_image'
        || node.vision?.mode !== 'auto_approve' || progress?.pendingPhotoId !== job.media_id || progress.photoStatus !== 'pending') {
        const applyStatus=await setVisionApplyStatus(job.id,'stale')
        return { jobId: job.id, status: job.status, applyStatus }
      }
      if (!eligibleForAutoApproval(payload.configuration,result,Boolean(node.location))) {
        const applyStatus=await setVisionApplyStatus(job.id,'ineligible')
        return { jobId: job.id, status: job.status, applyStatus }
      }
      const applyStatus=await apply(await reserveVisionApplyRevision(job.id,team.state.revision))
      return { jobId: job.id, status: job.status, applyStatus }
    } catch {
      // The recommendation remains visible to the organizer; an apply race or
      // transient failure must never reject the player's pending photograph.
      const applyStatus=await setVisionApplyStatus(job.id,'stale')
      return { jobId: job.id, status: job.status, applyStatus }
    }
  })
}
