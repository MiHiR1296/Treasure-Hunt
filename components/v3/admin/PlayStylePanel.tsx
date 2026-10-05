import type {
  IntegrityPolicy,
  LocationVerificationPolicy,
  RosterParticipationPolicy,
  SelfServeApprovalPolicy,
} from './integrityPolicy';
import { CASUAL_INTEGRITY_POLICY } from './integrityPolicy';
import { secondaryButton, StatusPill } from './ui';

interface PlayStylePanelProps {
  disabled: boolean;
  explicit: boolean;
  policy: IntegrityPolicy;
  onChange: (policy: IntegrityPolicy) => void;
}

const locationOptions: Array<{ value: LocationVerificationPolicy; label: string; detail: string }> = [
  { value: 'gps_only', label: 'GPS only', detail: 'Best for casual play: quickest setup, but browser location can be spoofed.' },
  { value: 'gps_photo', label: 'GPS + photo', detail: 'Players reach the area and add a fresh photo from the spot.' },
  { value: 'gps_organizer', label: 'GPS + organizer', detail: 'Players reach the area, then a staff member gives the go-ahead.' },
  { value: 'strict', label: 'Strict', detail: 'Use both on-location evidence and staff review where the hunt asks for it.' },
];

const approvalOptions: Array<{ value: SelfServeApprovalPolicy; label: string; detail: string }> = [
  { value: 'automatic', label: 'Let new crews start', detail: 'Best for casual play: self-created teams can begin as soon as the event is live.' },
  { value: 'organizer', label: 'Check crews first', detail: 'A staff member gives each self-created crew the go-ahead before play.' },
];

const rosterOptions: Array<{ value: RosterParticipationPolicy; label: string; detail: string }> = [
  { value: 'flexible', label: 'Flexible crew', detail: 'Teammates who join during a run can play and share in crew highlights.' },
  { value: 'flexible_fixed_scoring', label: 'Flexible play, steady scoring', detail: 'Late teammates can help, while guess limits stay team-wide and crew highlights stay with the starting crew.' },
  { value: 'freeze_at_run_start', label: 'Starting crew only', detail: 'Only teammates checked in when the run begins can take part in that run.' },
];

function OptionGroup<T extends string>({
  legend,
  name,
  options,
  value,
  disabled,
  onChange,
}: {
  legend: string;
  name: string;
  options: Array<{ value: T; label: string; detail: string }>;
  value: T;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return <fieldset className="rounded-xl border border-white/10 p-4" disabled={disabled}>
    <legend className="px-1 text-sm font-black text-white">{legend}</legend>
    <div className="mt-2 space-y-2">{options.map(option => <label key={option.value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${value === option.value ? 'border-cyan-300/50 bg-cyan-300/10' : 'border-white/10 bg-white/[0.025] hover:bg-white/[0.05]'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
      <input className="mt-1" type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} />
      <span><strong className="block text-sm text-slate-100">{option.label}</strong><span className="mt-1 block text-xs leading-5 text-slate-400">{option.detail}</span></span>
    </label>)}</div>
  </fieldset>;
}

export default function PlayStylePanel({ disabled, explicit, policy, onChange }: PlayStylePanelProps) {
  const casual = policy.locationVerification === CASUAL_INTEGRITY_POLICY.locationVerification
    && policy.selfServeApproval === CASUAL_INTEGRITY_POLICY.selfServeApproval
    && policy.rosterParticipation === CASUAL_INTEGRITY_POLICY.rosterParticipation;
  return <section className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.045] p-4 sm:p-5" aria-labelledby="play-style-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2"><h3 id="play-style-heading" className="text-lg font-black text-white">How should this hunt work?</h3>{casual && <StatusPill tone="good">Casual setup</StatusPill>}</div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Start relaxed, then add extra check-ins only when the event needs them. These choices update the draft below; save and validate before publishing.</p>
      </div>
      <button type="button" className={secondaryButton} disabled={disabled || (casual && explicit)} onClick={() => onChange(CASUAL_INTEGRITY_POLICY)}>{casual && explicit ? 'Casual defaults applied' : 'Use casual defaults'}</button>
    </div>
    {disabled
      ? <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">Open a draft or paste valid hunt JSON to choose its play style.</p>
      : <div className="mt-5 grid gap-3 xl:grid-cols-3">
        <OptionGroup legend="Location check" name="integrity-location" options={locationOptions} value={policy.locationVerification} disabled={disabled} onChange={locationVerification => onChange({ ...policy, locationVerification })} />
        <OptionGroup legend="New self-serve crews" name="integrity-approval" options={approvalOptions} value={policy.selfServeApproval} disabled={disabled} onChange={selfServeApproval => onChange({ ...policy, selfServeApproval })} />
        <OptionGroup legend="Joining during a run" name="integrity-roster" options={rosterOptions} value={policy.rosterParticipation} disabled={disabled} onChange={rosterParticipation => onChange({ ...policy, rosterParticipation })} />
      </div>}
    {!disabled && !explicit && <p className="mt-3 text-xs text-cyan-100/70">This draft has no saved play-style block yet, so the casual defaults are shown. Choose an option or apply the defaults to add it to the JSON.</p>}
    {!disabled && <p className="mt-3 rounded-xl border border-white/10 bg-black/10 p-3 text-xs leading-5 text-slate-300"><strong className="text-white">Planning a prize event?</strong> Choose “Check crews first” and “Starting crew only,” then close new crew creation before play. Casual defaults keep everyday setup fast and friendly.</p>}
  </section>;
}
