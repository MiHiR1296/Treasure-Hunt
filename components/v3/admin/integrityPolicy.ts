import {
  CASUAL_INTEGRITY_POLICY as DOMAIN_CASUAL_INTEGRITY_POLICY,
  type IntegrityPolicy,
  type LocationVerificationMode,
  type RosterParticipationMode,
  type SelfServeApprovalMode,
} from '@/lib/v3/types';

export type LocationVerificationPolicy = LocationVerificationMode;
export type SelfServeApprovalPolicy = SelfServeApprovalMode;
export type RosterParticipationPolicy = RosterParticipationMode;
export type { IntegrityPolicy };

export const CASUAL_INTEGRITY_POLICY: IntegrityPolicy = {
  ...DOMAIN_CASUAL_INTEGRITY_POLICY,
};

const locationVerificationValues = new Set<LocationVerificationPolicy>([
  'gps_only',
  'gps_photo',
  'gps_organizer',
  'strict',
]);
const selfServeApprovalValues = new Set<SelfServeApprovalPolicy>(['automatic', 'organizer']);
const rosterParticipationValues = new Set<RosterParticipationPolicy>([
  'flexible',
  'freeze_at_run_start',
  'flexible_fixed_scoring',
]);

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseDefinitionForPlayStyle(value: string): Record<string, unknown> | null {
  try {
    return object(JSON.parse(value));
  } catch {
    return null;
  }
}

export function readIntegrityPolicy(definition: Record<string, unknown>): IntegrityPolicy {
  const settings = object(definition.settings);
  const policy = object(settings?.integrityPolicy);
  const locationVerification = policy?.locationVerification;
  const selfServeApproval = policy?.selfServeApproval;
  const rosterParticipation = policy?.rosterParticipation;
  return {
    locationVerification: locationVerificationValues.has(locationVerification as LocationVerificationPolicy)
      ? locationVerification as LocationVerificationPolicy
      : CASUAL_INTEGRITY_POLICY.locationVerification,
    selfServeApproval: selfServeApprovalValues.has(selfServeApproval as SelfServeApprovalPolicy)
      ? selfServeApproval as SelfServeApprovalPolicy
      : CASUAL_INTEGRITY_POLICY.selfServeApproval,
    rosterParticipation: rosterParticipationValues.has(rosterParticipation as RosterParticipationPolicy)
      ? rosterParticipation as RosterParticipationPolicy
      : CASUAL_INTEGRITY_POLICY.rosterParticipation,
  };
}

export function hasExplicitIntegrityPolicy(definition: Record<string, unknown>): boolean {
  const policy = object(object(definition.settings)?.integrityPolicy);
  return Boolean(policy)
    && locationVerificationValues.has(policy?.locationVerification as LocationVerificationPolicy)
    && selfServeApprovalValues.has(policy?.selfServeApproval as SelfServeApprovalPolicy)
    && rosterParticipationValues.has(policy?.rosterParticipation as RosterParticipationPolicy);
}

export function withIntegrityPolicy(
  definition: Record<string, unknown>,
  policy: IntegrityPolicy,
): Record<string, unknown> {
  const settings = object(definition.settings) ?? {};
  return {
    ...definition,
    settings: {
      ...settings,
      integrityPolicy: { ...policy },
    },
  };
}
