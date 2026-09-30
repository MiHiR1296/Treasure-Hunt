import type { VisionReviewConfiguration, VisionTargetProfile } from './types'

export const VISION_PROFILE_PROMPT_VERSION = 'profile-v1'
export const VISION_REVIEW_PROMPT_VERSION = 'review-v1'

export interface PhotoVisionResult {
  decision: 'MATCH' | 'DIFFERENT' | 'UNCERTAIN'
  confidence: number
  quality: 'usable' | 'poor'
  profileAgreement: boolean
  evidence: string[]
  reason: string
  verificationPasses: number
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value)
}

function stringArray(value: unknown, minimum: number, maximum: number, length: number): value is string[] {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum && value.every(item => boundedString(item, length))
}

export function parsePhotoVisionResult(value: unknown): PhotoVisionResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (!['MATCH', 'DIFFERENT', 'UNCERTAIN'].includes(String(item.decision)) || typeof item.confidence !== 'number' || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) return null
  if (!['usable', 'poor'].includes(String(item.quality)) || typeof item.profileAgreement !== 'boolean') return null
  if (!stringArray(item.evidence, 0, 6, 300) || !boundedString(item.reason, 1000) || !Number.isSafeInteger(item.verificationPasses) || Number(item.verificationPasses) < 1 || Number(item.verificationPasses) > 2) return null
  if (Object.keys(item).some(key => !['decision', 'confidence', 'quality', 'profileAgreement', 'evidence', 'reason', 'verificationPasses'].includes(key))) return null
  return { decision: item.decision as PhotoVisionResult['decision'], confidence: item.confidence, quality: item.quality as PhotoVisionResult['quality'],
    profileAgreement: item.profileAgreement, evidence: item.evidence, reason: item.reason.trim(), verificationPasses: item.verificationPasses as number }
}

export function parseGeneratedVisionProfile(value: unknown, referenceCount: number): VisionTargetProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (item.version !== 1 || !boundedString(item.summary, 2000) || !stringArray(item.distinguishingFeatures, 1, 12, 300) || !stringArray(item.confusingAlternatives, 0, 12, 300)) return null
  if (!boundedString(item.model, 200) || item.promptVersion !== VISION_PROFILE_PROMPT_VERSION || !Array.isArray(item.referenceSelections) || item.referenceSelections.length < 2 || item.referenceSelections.length > 6) return null
  const seen = new Set<number>()
  for (const selection of item.referenceSelections) {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) return null
    const entry = selection as Record<string, unknown>
    if (!Number.isSafeInteger(entry.index) || Number(entry.index) < 0 || Number(entry.index) >= referenceCount || seen.has(Number(entry.index)) || !boundedString(entry.role, 200)) return null
    if (Object.keys(entry).some(key => !['index', 'role'].includes(key))) return null
    seen.add(Number(entry.index))
  }
  if (Object.keys(item).some(key => !['version', 'summary', 'distinguishingFeatures', 'confusingAlternatives', 'referenceSelections', 'model', 'promptVersion'].includes(key))) return null
  return { version: 1, summary: item.summary.trim(), distinguishingFeatures: item.distinguishingFeatures.map(value => value.trim()),
    confusingAlternatives: item.confusingAlternatives.map(value => value.trim()), referenceSelections: item.referenceSelections.map(value => ({ index: Number((value as Record<string, unknown>).index), role: String((value as Record<string, unknown>).role).trim() })),
    model: item.model.trim(), promptVersion: VISION_PROFILE_PROMPT_VERSION }
}

/** Model confidence contributes to this gate but can never satisfy it alone. */
export function eligibleForAutoApproval(configuration: VisionReviewConfiguration, result: PhotoVisionResult, hasRequiredLocation: boolean): boolean {
  return configuration.mode === 'auto_approve'
    && !!configuration.profile
    && (!configuration.requireLocationForAutoApproval || hasRequiredLocation)
    && result.decision === 'MATCH'
    && result.quality === 'usable'
    && result.profileAgreement
    && result.evidence.length >= configuration.minimumEvidence
    && result.verificationPasses === 2
    && result.confidence >= configuration.autoApproveThreshold
}
