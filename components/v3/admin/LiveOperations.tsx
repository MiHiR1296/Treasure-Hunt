'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newRequestId } from '../api';
import { adminRequest, normalizeRecognitionAudit, V3AdminRequestError } from './client';
import OperationsQueues from './OperationsQueues';
import type {
  AdminHunt,
  LiveAlert,
  LiveOperationsResponse,
  LiveRun,
  LiveTeam,
  PublicBoardAdminState,
  RecognitionAuditResponse,
  RecognitionResultAudit,
} from './types';
import {
  EmptyState,
  dangerButton,
  formatDuration,
  formatPercent,
  inputClass,
  labelize,
  panelClass,
  primaryButton,
  secondaryButton,
  SectionHeading,
  StatusPill,
} from './ui';
import RosterPanel from './RosterPanel';

interface LiveOperationsProps {
  hunt: AdminHunt;
  data: LiveOperationsResponse | null;
  loading: boolean;
  pending: string;
  problem?: string;
  onRefresh: () => Promise<void>;
  run: (key: string, operation: () => Promise<void>) => Promise<void>;
  notify: (message: string) => void;
  reportError: (error: unknown) => void;
}

type DisplayMode = 'cards' | 'table';
type TeamControlAction = 'approve' | 'disqualify' | 'restore';
type RunRecoveryAction = 'approve_current' | 'reset_current' | 'extend_session';

function alertTone(alert: LiveAlert): 'danger' | 'warning' | 'info' {
  if (alert.severity === 'critical') return 'danger';
  if (alert.severity === 'warning' || alert.kind === 'warning' || alert.kind === 'stalled' || alert.kind === 'fairness') return 'warning';
  return 'info';
}

function RunSummary({ run, kind }: { run: LiveRun | null; kind: 'active' | 'best' }) {
  if (!run) return <span className="text-sm text-slate-500">No {kind} run</span>;
  return <div className="space-y-1">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-black text-white">Run {run.runNumber}</span>
      <StatusPill tone={run.status === 'completed' ? 'good' : run.practice ? 'warning' : 'info'}>
        {run.practice ? 'Practice' : labelize(run.status)}
      </StatusPill>
    </div>
    <p className="text-sm text-slate-300"><strong className="text-white">{run.score}</strong> pts · {formatDuration(run.elapsedMilliseconds)}</p>
    {kind === 'active' && <p className="truncate text-xs text-slate-400" title={run.currentCheckpointLabel || run.currentCheckpointId || undefined}>
      {run.currentCheckpointLabel || run.currentCheckpointId || 'Checkpoint not reported'}
      {run.progress !== null ? ` · ${formatPercent(run.progress)}` : ''}
    </p>}
    {kind === 'active' && run.revision !== null && run.revision !== undefined && <p className="truncate text-[0.7rem] text-slate-500" title={run.currentNodeId || undefined}>
      Revision {run.revision} · {run.currentNodeId ? `Node ${run.currentNodeId}` : 'No current node'}
    </p>}
  </div>;
}

function VariantSummary({ run }: { run: LiveRun | null }) {
  if (!run?.routeVariant && !run?.challengeVariant) return <span className="text-slate-500">—</span>;
  return <div className="max-w-64 space-y-1 text-xs text-slate-300">
    {run.routeVariant && <p className="truncate" title={run.routeVariant}>Route: {run.routeVariant}</p>}
    {run.challengeVariant && <p className="truncate" title={run.challengeVariant}>Challenge: {run.challengeVariant}</p>}
  </div>;
}

function AlertChips({ alerts }: { alerts: LiveAlert[] }) {
  if (!alerts.length) return <StatusPill tone="good">On track</StatusPill>;
  const details = alerts.filter(alert => alert.detail && (alert.kind === 'fairness' || /duplicate member name/i.test(alert.label)));
  return <div className="space-y-2"><div className="flex flex-wrap gap-1.5">{alerts.map((alert, index) => <span title={alert.detail} key={alert.id || `${alert.kind}-${index}`}>
    <StatusPill tone={alertTone(alert)}>{labelize(alert.label)}</StatusPill>
  </span>)}</div>{details.map((alert, index) => <p key={`detail-${alert.id || index}`} className="max-w-72 text-xs leading-5 text-amber-100/80">{alert.detail}</p>)}</div>;
}

function TeamIdentity({ team }: { team: LiveTeam }) {
  return <div className="min-w-0">
    <div className="flex flex-wrap items-center gap-2"><p className="truncate text-base font-black tracking-tight text-white">
      <span className="text-amber-300">{team.code}</span>{team.displayName ? ` · ${team.displayName}` : ''}
    </p>{team.status === 'disqualified' ? <StatusPill tone="danger">Disqualified</StatusPill> : team.approvalStatus === 'pending' ? <StatusPill tone="warning">Approval pending</StatusPill> : <StatusPill tone="good">Approved</StatusPill>}</div>
    <p className="mt-1 truncate text-xs text-slate-400" title={team.memberNames.join(', ')}>
      {team.memberNames.length ? team.memberNames.join(', ') : 'Roster names unavailable'}
    </p>
    <p className="mt-1 text-xs font-semibold text-slate-300">{team.checkedInCount}/{team.memberCount} checked in · {team.runCount} run{team.runCount === 1 ? '' : 's'}</p>
  </div>;
}

function TeamControlButtons({ team, onControl }: { team: LiveTeam; onControl: (team: LiveTeam, action: TeamControlAction) => void }) {
  if (team.status === 'disqualified') return <button type="button" className={secondaryButton} onClick={() => onControl(team, 'restore')}>Restore</button>;
  if (team.status !== 'active') return null;
  return <>{team.approvalStatus === 'pending' && <button type="button" className={primaryButton} onClick={() => onControl(team, 'approve')}>Approve</button>}<button type="button" className={dangerButton} onClick={() => onControl(team, 'disqualify')}>Disqualify</button></>;
}

function TeamCards({ teams, onAudit, onRename, onControl, onRecovery }: { teams: LiveTeam[]; onAudit: (team: LiveTeam) => void; onRename: (team: LiveTeam) => void; onControl: (team: LiveTeam, action: TeamControlAction) => void; onRecovery: (team: LiveTeam) => void }) {
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{teams.map(team => <article key={team.teamId} className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
    <div className="flex items-start justify-between gap-3">
      <TeamIdentity team={team} />
      <AlertChips alerts={team.alerts} />
    </div>
    <div className="mt-4 grid grid-cols-2 gap-3 border-y border-white/10 py-4">
      <div><p className="mb-2 text-[0.65rem] font-black uppercase tracking-widest text-slate-500">Active</p><RunSummary run={team.activeRun} kind="active" /></div>
      <div><p className="mb-2 text-[0.65rem] font-black uppercase tracking-widest text-slate-500">Best</p><RunSummary run={team.bestRun} kind="best" /></div>
    </div>
    <div className="mt-3"><VariantSummary run={team.activeRun} /></div>
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" className={secondaryButton} onClick={() => onRename(team)}>Rename</button>
      <TeamControlButtons team={team} onControl={onControl} />
      {team.activeRun?.status === 'active' && <button type="button" className={secondaryButton} onClick={() => onRecovery(team)}>Recover run</button>}
      {(team.bestRun || team.activeRun?.status === 'completed') && <button type="button" className={secondaryButton} onClick={() => onAudit(team)}>Recognition audit</button>}
    </div>
  </article>)}</div>;
}

function TeamTable({ teams, onAudit, onRename, onControl, onRecovery }: { teams: LiveTeam[]; onAudit: (team: LiveTeam) => void; onRename: (team: LiveTeam) => void; onControl: (team: LiveTeam, action: TeamControlAction) => void; onRecovery: (team: LiveTeam) => void }) {
  return <div className="overflow-x-auto rounded-2xl border border-white/10">
    <table className="min-w-[1120px] w-full border-collapse text-left text-sm">
      <thead className="bg-white/[0.04] text-[0.68rem] uppercase tracking-widest text-slate-400"><tr>
        <th className="px-4 py-3">Team & crew</th><th className="px-4 py-3">Check-in</th><th className="px-4 py-3">Active run</th>
        <th className="px-4 py-3">Best run</th><th className="px-4 py-3">Checkpoint</th><th className="px-4 py-3">Route / challenge</th>
        <th className="px-4 py-3">Alerts</th><th className="px-4 py-3"><span className="sr-only">Actions</span></th>
      </tr></thead>
      <tbody className="divide-y divide-white/10">{teams.map(team => <tr key={team.teamId} className="align-top hover:bg-white/[0.025]">
        <td className="px-4 py-3"><TeamIdentity team={team} /></td>
        <td className="whitespace-nowrap px-4 py-3 font-bold text-slate-200">{team.checkedInCount}/{team.memberCount}<span className="block text-xs font-normal text-slate-500">{team.runCount} run{team.runCount === 1 ? '' : 's'}</span></td>
        <td className="px-4 py-3"><RunSummary run={team.activeRun} kind="active" /></td>
        <td className="px-4 py-3"><RunSummary run={team.bestRun} kind="best" /></td>
        <td className="max-w-44 px-4 py-3 text-slate-300">{team.activeRun?.currentCheckpointLabel || team.activeRun?.currentCheckpointId || '—'}</td>
        <td className="px-4 py-3"><VariantSummary run={team.activeRun} /></td>
        <td className="px-4 py-3"><AlertChips alerts={team.alerts} /></td>
        <td className="px-4 py-3"><div className="flex flex-wrap gap-2"><button type="button" className={secondaryButton} onClick={() => onRename(team)}>Rename</button><TeamControlButtons team={team} onControl={onControl} />{team.activeRun?.status === 'active' && <button type="button" className={secondaryButton} onClick={() => onRecovery(team)}>Recover</button>}{(team.bestRun || team.activeRun?.status === 'completed') && <button type="button" className={secondaryButton} onClick={() => onAudit(team)}>Audit</button>}</div></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function RenameDialog({ team, huntId, pending, run, onClose, notify }: {
  team: LiveTeam;
  huntId: string;
  pending: string;
  run: LiveOperationsProps['run'];
  onClose: () => void;
  notify: LiveOperationsProps['notify'];
}) {
  const [name, setName] = useState(team.displayName || '');
  const [reason, setReason] = useState('Corrected team display name');
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="rename-team-title" className={`${panelClass} w-full max-w-md p-6`}>
      <p className="text-xs font-black uppercase tracking-widest text-amber-300">{team.code}</p>
      <h3 id="rename-team-title" className="mt-2 text-xl font-black text-white">Edit team display name</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">The canonical code never changes. Leave the optional display name blank to show only {team.code}.</p>
      <form className="mt-5 space-y-4" onSubmit={event => {
        event.preventDefault();
        void run(`rename-${team.teamId}`, async () => {
          await adminRequest('/api/v3/admin/control', 'POST', { action: 'rename_team', huntId, teamId: team.teamId, displayName: name.trim() || null, reason: reason.trim() });
          notify(`${team.code} display name updated.`);
          onClose();
        });
      }}>
        <label className="block text-sm font-bold text-slate-200">Display name<input className={`${inputClass} mt-2`} maxLength={40} value={name} onChange={event => setName(event.target.value)} autoFocus /></label>
        <label className="block text-sm font-bold text-slate-200">Audit reason<input className={`${inputClass} mt-2`} required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <div className="flex justify-end gap-2"><button type="button" className={secondaryButton} onClick={onClose}>Cancel</button><button className={primaryButton} disabled={Boolean(pending)}>{pending === `rename-${team.teamId}` ? 'Saving…' : 'Save name'}</button></div>
      </form>
    </section>
  </div>;
}

function TeamStatusDialog({ team, action, huntId, pending, run, onClose, notify }: {
  team: LiveTeam;
  action: TeamControlAction;
  huntId: string;
  pending: string;
  run: LiveOperationsProps['run'];
  onClose: () => void;
  notify: LiveOperationsProps['notify'];
}) {
  const [reason, setReason] = useState('');
  const pendingRequest = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const labels = action === 'approve'
    ? { title: 'Approve this team?', verb: 'Approve team', progress: 'Approving…', notice: 'approved for competition' }
    : action === 'disqualify'
      ? { title: 'Disqualify this team?', verb: 'Disqualify team', progress: 'Disqualifying…', notice: 'disqualified' }
      : { title: 'Restore this team?', verb: 'Restore team', progress: 'Restoring…', notice: 'restored' };
  const detail = action === 'approve'
    ? 'Approval allows this self-serve crew to start official runs. Confirm the code, nickname, and every person at check-in first. A browser cannot prove that one person did not register under another name; use rostered registration with organizer-issued identities for prize events.'
    : action === 'disqualify'
      ? 'Every team session will be revoked immediately. Open runs become disqualified and all existing results become permanently ineligible.'
      : 'Members must sign in again. Previously disqualified runs stay ineligible. If this team has already entered practice, restoration permits practice only. Any legitimate registration correction must be organizer-issued after the people involved are verified.';
  const key = `team-${action}-${team.teamId}`;

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="team-status-title" className={`${panelClass} w-full max-w-lg p-6`}>
      <p className="text-xs font-black uppercase tracking-widest text-amber-300">{team.code}{team.displayName ? ` · ${team.displayName}` : ''}</p>
      <h3 id="team-status-title" className="mt-2 text-xl font-black text-white">{labels.title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p>
      <form className="mt-5 space-y-4" onSubmit={event => {
        event.preventDefault();
        const normalizedReason = reason.trim();
        if (!normalizedReason) return;
        void run(key, async () => {
          const fingerprint = JSON.stringify({ teamId: team.teamId, action, expectedRevision: team.competitionRevision, reason: normalizedReason });
          const requestId = pendingRequest.current?.fingerprint === fingerprint
            ? pendingRequest.current.requestId
            : newRequestId();
          pendingRequest.current = { fingerprint, requestId };
          await adminRequest('/api/v3/admin/control', 'POST', {
            action: `${action}_team`,
            huntId,
            teamId: team.teamId,
            reason: normalizedReason,
            expectedRevision: team.competitionRevision,
            requestId,
          });
          pendingRequest.current = null;
          notify(`${team.code} ${labels.notice}.`);
          onClose();
        });
      }}>
        <label className="block text-sm font-bold text-slate-200">Required audit reason<textarea className={`${inputClass} mt-2`} required rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder={action === 'approve' ? 'Roster and team identity verified at check-in' : action === 'disqualify' ? 'Describe the rule breach or incident evidence' : 'Describe why the team may return'} autoFocus /></label>
        <div className="flex justify-end gap-2"><button type="button" className={secondaryButton} onClick={onClose}>Cancel</button><button className={action === 'disqualify' ? dangerButton : primaryButton} disabled={Boolean(pending) || !reason.trim()}>{pending === key ? labels.progress : labels.verb}</button></div>
      </form>
    </section>
  </div>;
}

function RunRecoveryDialog({ team, huntId, pending, run, onClose, notify }: {
  team: LiveTeam;
  huntId: string;
  pending: string;
  run: LiveOperationsProps['run'];
  onClose: () => void;
  notify: LiveOperationsProps['notify'];
}) {
  const activeRun = team.activeRun;
  const [reason, setReason] = useState('');
  const pendingRequest = useRef<{ fingerprint: string; requestId: string } | null>(null);
  if (!activeRun || activeRun.status !== 'active') return null;
  const revision = activeRun.revision;
  const nodeType = activeRun.currentNodeType || '';
  const canApprove = nodeType === 'verify_organizer' && !activeRun.parallelMechanic;
  const canReset = ['verify_qr', 'verify_code', 'verify_answer', 'puzzle'].includes(nodeType) || activeRun.parallelMechanic;
  const perform = (control: RunRecoveryAction) => {
    const normalizedReason = reason.trim();
    if (!normalizedReason || !Number.isSafeInteger(revision)) return;
    const key = `recover-${team.teamId}`;
    void run(key, async () => {
      const fingerprint = JSON.stringify({
        huntId,
        teamId: team.teamId,
        runId: activeRun.id,
        expectedRevision: revision,
        control,
        reason: normalizedReason,
        ...(control === 'extend_session' ? { seconds: 300 } : {}),
      });
      const requestId = pendingRequest.current?.fingerprint === fingerprint
        ? pendingRequest.current.requestId
        : newRequestId();
      pendingRequest.current = { fingerprint, requestId };
      await adminRequest('/api/v3/admin/control', 'POST', {
        action: 'recover_run',
        huntId,
        teamId: team.teamId,
        runId: activeRun.id,
        requestId,
        expectedRevision: revision,
        control,
        reason: normalizedReason,
        ...(control === 'extend_session' ? { seconds: 300 } : {}),
      });
      pendingRequest.current = null;
      notify(control === 'approve_current'
        ? `${team.code}'s current organizer gate was approved.`
        : control === 'reset_current'
          ? `${team.code}'s current task and attempt allowance were reset.`
          : `${team.code} received five additional minutes.`);
      onClose();
    });
  };
  const busy = pending === `recover-${team.teamId}`;

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="run-recovery-title" className={`${panelClass} w-full max-w-xl p-6`}>
      <p className="text-xs font-black uppercase tracking-widest text-amber-300">{team.code} · Run {activeRun.runNumber}</p>
      <h3 id="run-recovery-title" className="mt-2 text-xl font-black text-white">Audited run recovery</h3>
      <p className="mt-2 text-sm leading-6 text-slate-400">These controls apply only to the server’s current action. If the run changes first, the request is rejected instead of acting on a stale task.</p>
      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
        <p><strong className="text-white">Revision:</strong> {revision ?? 'Unavailable'}</p>
        <p className="mt-1 break-all"><strong className="text-white">Current:</strong> {activeRun.currentCheckpointLabel || activeRun.currentCheckpointId || 'Unknown checkpoint'} / {activeRun.currentNodeId || 'unknown node'}{nodeType ? ` · ${labelize(nodeType)}` : ''}</p>
        {activeRun.parallelMechanic && <p className="mt-2 text-xs text-amber-200">This is a linked teammate gate. Generic approval is disabled; reset starts a fresh lane window without deleting prior evidence.</p>}
      </div>
      <label className="mt-5 block text-sm font-bold text-slate-200">Required audit reason<textarea className={`${inputClass} mt-2`} required rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Describe the field issue and what you verified" autoFocus /></label>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
        {activeRun.timed && <button type="button" className={secondaryButton} disabled={busy || !reason.trim() || !Number.isSafeInteger(revision)} onClick={() => perform('extend_session')}>{busy ? 'Saving…' : 'Add 5 minutes'}</button>}
        {canReset && <button type="button" className={secondaryButton} disabled={busy || !reason.trim() || !Number.isSafeInteger(revision)} onClick={() => perform('reset_current')}>{busy ? 'Saving…' : 'Reset current task'}</button>}
        {canApprove && <button type="button" className={primaryButton} disabled={busy || !reason.trim() || !Number.isSafeInteger(revision)} onClick={() => perform('approve_current')}>{busy ? 'Saving…' : 'Approve organizer gate'}</button>}
      </div>
      {!canApprove && !canReset && !activeRun.timed && <p className="mt-4 text-xs text-amber-200">This task has no safe generic recovery control. Use its dedicated photo/help workflow.</p>}
    </section>
  </div>;
}

function RecognitionOverrideForm({ huntId, teamId, runId, result, pending, run, onSaved }: {
  huntId: string;
  teamId: string;
  runId: string;
  result: RecognitionResultAudit;
  pending: string;
  run: LiveOperationsProps['run'];
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [headlineTitle, setHeadlineTitle] = useState(result.headlineTitle);
  const [dataTitle, setDataTitle] = useState(result.dataTitle || '');
  const [peerTitle, setPeerTitle] = useState(result.peerTitle || '');
  const [explanation, setExplanation] = useState(result.explanation || '');
  const [reason, setReason] = useState('Organizer corrected the visible recognition result');
  const key = `recognition-${result.memberId}`;
  if (!open) return <button type="button" className={secondaryButton} onClick={() => setOpen(true)}>{result.overridden ? 'Edit override' : 'Override title'}</button>;
  return <form className="mt-4 grid gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.04] p-4 sm:grid-cols-2" onSubmit={event => {
    event.preventDefault();
    void run(key, async () => {
      await adminRequest('/api/v3/admin/recognition', 'POST', {
        action: 'override', huntId, teamId, runId, memberId: result.memberId,
        headlineTitle: headlineTitle.trim(), dataTitle: dataTitle.trim() || null,
        peerTitle: peerTitle.trim() || null, explanation: explanation.trim(),
        reason: reason.trim(),
      });
      await onSaved();
      setOpen(false);
    });
  }}>
    <label className="text-xs font-bold text-slate-300">Headline title<input required maxLength={80} className={`${inputClass} mt-1`} value={headlineTitle} onChange={event => setHeadlineTitle(event.target.value)} /></label>
    <label className="text-xs font-bold text-slate-300">Data title<input maxLength={80} className={`${inputClass} mt-1`} value={dataTitle} onChange={event => setDataTitle(event.target.value)} /></label>
    <label className="text-xs font-bold text-slate-300">Crew-voted title<input maxLength={80} className={`${inputClass} mt-1`} value={peerTitle} onChange={event => setPeerTitle(event.target.value)} /></label>
    <label className="text-xs font-bold text-slate-300 sm:col-span-2">Visible explanation<textarea maxLength={2000} rows={3} className={`${inputClass} mt-1`} value={explanation} onChange={event => setExplanation(event.target.value)} /></label>
    <label className="text-xs font-bold text-slate-300 sm:col-span-2">Private audit note<textarea required maxLength={500} rows={2} className={`${inputClass} mt-1`} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <div className="flex gap-2 sm:col-span-2"><button className={primaryButton} disabled={Boolean(pending)}>{pending === key ? 'Saving…' : 'Save audited override'}</button><button type="button" className={secondaryButton} onClick={() => setOpen(false)}>Cancel</button></div>
  </form>;
}

function RecognitionAudit({ team, huntId, pending, run, onClose, reportError }: {
  team: LiveTeam;
  huntId: string;
  pending: string;
  run: LiveOperationsProps['run'];
  onClose: () => void;
  reportError: LiveOperationsProps['reportError'];
}) {
  const selectedRun = team.bestRun || team.activeRun;
  const [audit, setAudit] = useState<RecognitionAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!selectedRun) return;
    setLoading(true);
    try {
      const response = await adminRequest<unknown>(`/api/v3/admin/recognition?huntId=${encodeURIComponent(huntId)}&teamId=${encodeURIComponent(team.teamId)}&runId=${encodeURIComponent(selectedRun.id)}`);
      setAudit(normalizeRecognitionAudit(response));
    } catch (error) { reportError(error); }
    finally { setLoading(false); }
  }, [huntId, reportError, selectedRun, team.teamId]);

  useEffect(() => { void load(); }, [load]);

  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/80" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="recognition-audit-title" className="h-full w-full max-w-3xl overflow-y-auto border-l border-white/10 bg-slate-950 p-5 shadow-2xl sm:p-8">
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-widest text-amber-300">Private organizer audit · {team.code}</p><h3 id="recognition-audit-title" className="mt-2 text-2xl font-black text-white">Recognition and contribution evidence</h3><p className="mt-2 text-sm text-slate-400">Run {selectedRun?.runNumber}. Raw actions and votes stay unchanged; an override adds a reasoned audit record.</p></div><button type="button" className={secondaryButton} onClick={onClose}>Close</button></div>
      {loading && <p role="status" className="mt-8 text-slate-400">Loading the named audit…</p>}
      {!loading && audit && <div className="mt-8 space-y-8">
        <section><h4 className="font-black text-white">Calculated results</h4><div className="mt-3 space-y-3">{audit.results.length ? audit.results.map(result => <article key={result.memberId} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black text-white">{result.memberName} · {result.headlineTitle}</p><p className="mt-1 text-sm text-slate-400">Data: {result.dataTitle || 'No specialist title'} · Crew: {result.peerTitle || 'No crew vote result'}</p>{result.explanation && <p className="mt-2 text-xs text-amber-200">Override reason: {result.explanation}</p>}</div>{result.overridden && <StatusPill tone="warning">Overridden</StatusPill>}</div><RecognitionOverrideForm huntId={huntId} teamId={team.teamId} runId={selectedRun!.id} result={result} pending={pending} run={run} onSaved={load} /></article>) : <EmptyState title="No calculated titles yet">Recognition may still be calculating, or this run has no attributable contributions.</EmptyState>}</div></section>
        <section><h4 className="font-black text-white">Verified contribution evidence</h4><div className="mt-3 overflow-x-auto rounded-xl border border-white/10"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-slate-400"><tr><th className="px-3 py-2">Member</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Credit</th><th className="px-3 py-2">Evidence</th></tr></thead><tbody className="divide-y divide-white/10">{audit.contributions.map((item, index) => <tr key={item.id || index}><td className="px-3 py-2 font-bold text-white">{item.memberName}</td><td className="px-3 py-2 text-slate-300">{labelize(item.category)}</td><td className="px-3 py-2 text-slate-300">+{item.credit}</td><td className="px-3 py-2 text-slate-400">{item.evidence || 'Verified server action'}</td></tr>)}</tbody></table></div>{!audit.contributions.length && <p className="mt-3 text-sm text-slate-500">No positive contribution credits were recorded.</p>}</section>
        <section><h4 className="font-black text-white">Named peer-vote audit</h4><div className="mt-3 space-y-2">{audit.votes.map(vote => <div key={vote.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm"><p className="font-bold text-white">{vote.voterName} → {vote.recipientName}</p><p className="mt-1 text-slate-400">{labelize(vote.category)} · {labelize(vote.subtype)}</p></div>)}{!audit.votes.length && <p className="text-sm text-slate-500">No teammate recognition votes were submitted.</p>}</div></section>
      </div>}
    </section>
  </div>;
}

function LifecycleControls({ hunt, pending, run, notify }: {
  hunt: AdminHunt;
  pending: string;
  run: LiveOperationsProps['run'];
  notify: LiveOperationsProps['notify'];
}) {
  const revision = hunt.lifecycleRevision;
  const status = hunt.status;
  const changeStatus = (next: 'live' | 'paused' | 'ended', label: string, confirmation?: string) => {
    if (!Number.isSafeInteger(revision)) return;
    if (confirmation && !window.confirm(confirmation)) return;
    void run('hunt-lifecycle', async () => {
      await adminRequest('/api/v3/admin/control', 'POST', {
        action: 'set_hunt_status',
        huntId: hunt.id,
        status: next,
        expectedRevision: revision,
      });
      notify(label);
    });
  };
  const busy = pending === 'hunt-lifecycle';
  const detail = status === 'ready' ? 'The event is published and accepting pre-event registration. Starting it permanently closes creation of new teams.'
    : status === 'live' ? 'Players can start runs and submit actions.'
      : status === 'paused' ? 'Active run clocks are paused and player actions are blocked.'
        : status === 'ended' ? 'The event is closed. Finalize the public board when results are ready.'
          : 'This event is archived.';

  return <section className={`${panelClass} p-5 sm:p-6`}>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="text-xs font-black uppercase tracking-widest text-cyan-300">Event lifecycle</p>
        <div className="mt-2 flex items-center gap-3"><h2 className="text-xl font-black text-white">{hunt.title}</h2><StatusPill tone={status === 'live' ? 'good' : status === 'paused' ? 'warning' : 'info'}>{labelize(status)}</StatusPill></div>
        <p className="mt-2 text-sm text-slate-400">{detail}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {status === 'ready' && <button type="button" className={primaryButton} disabled={busy || !Number.isSafeInteger(revision)} onClick={() => changeStatus('live', 'Event started. New team creation is closed.', `Start “${hunt.title}” now? New team creation will close immediately. Existing approved teams and members can still sign in and play.`)}>{busy ? 'Starting…' : 'Start event & close registration'}</button>}
        {status === 'live' && <button type="button" className={secondaryButton} disabled={busy || !Number.isSafeInteger(revision)} onClick={() => changeStatus('paused', 'Event paused.')}>{busy ? 'Pausing…' : 'Pause event'}</button>}
        {status === 'paused' && <button type="button" className={primaryButton} disabled={busy || !Number.isSafeInteger(revision)} onClick={() => changeStatus('live', 'Event resumed.')}>{busy ? 'Resuming…' : 'Resume event'}</button>}
        {(status === 'live' || status === 'paused') && <button type="button" className="min-h-11 rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-2 text-sm font-black text-rose-100 transition hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || !Number.isSafeInteger(revision)} onClick={() => changeStatus('ended', 'Event ended.', `End “${hunt.title}” now? Waiting and active runs will close as abandoned and become ineligible. Submitted photos must still be reviewed before the public board can be finalized. This action is recorded in the organizer audit.`)}>{busy ? 'Updating…' : 'End event'}</button>}
      </div>
    </div>
    {hunt.registrationMode === 'self-serve' && <p className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm leading-6 text-amber-100">
      <strong>Identity check required:</strong> self-serve registration proves a team PIN, not one human per team. Review every pending roster at check-in before approval. Use rostered or organizer-assigned identities for prize events.
    </p>}
    {!Number.isSafeInteger(revision) && <p className="mt-3 text-xs text-amber-200">Refresh the live event state before changing its lifecycle.</p>}
  </section>;
}

const boardColumns = [
  ['rank', 'Rank'], ['team_code', 'Team code'], ['team_name', 'Team name'], ['points', 'Points'],
  ['progress', 'Progress'], ['completion_status', 'Status'], ['runs', 'Runs'], ['time', 'Time'],
] as const;

function publicBoardForm(hunt: AdminHunt, board?: PublicBoardAdminState | null) {
  return {
    enabled: board?.enabled ?? false,
    title: board?.title || hunt.title,
    cover: board?.cover || '',
    status: board?.status || 'live' as 'live' | 'frozen' | 'final',
    // A missing setting must never opt an event into publishing team nicknames.
    showTeamNames: board?.showTeamNames ?? false,
    mainBoardVisible: board?.mainBoardVisible ?? true,
    replayBoardVisible: board?.replayBoardVisible ?? false,
    columns: board?.columns?.length ? [...board.columns] : ['rank', 'team_code', 'points', 'progress'],
  };
}

function PublicBoardPanel({ hunt, board, pending, run, notify }: {
  hunt: AdminHunt;
  board?: PublicBoardAdminState | null;
  pending: string;
  run: LiveOperationsProps['run'];
  notify: LiveOperationsProps['notify'];
}) {
  const [preview, setPreview] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState(() => publicBoardForm(hunt, board));
  const [dirty, setDirty] = useState(false);
  const lastServerState = useRef('');
  const lastHuntId = useRef('');
  const serverState = JSON.stringify([
    hunt.id, hunt.title, board?.enabled, board?.title, board?.cover, board?.status,
    board?.showTeamNames, board?.mainBoardVisible, board?.replayBoardVisible, board?.columns,
  ]);
  useEffect(() => {
    const eventChanged = lastHuntId.current !== hunt.id;
    const serverChanged = lastServerState.current !== serverState;
    if (serverChanged && (!dirty || eventChanged)) {
      setForm(publicBoardForm(hunt, board));
      setDirty(false);
    }
    lastServerState.current = serverState;
    lastHuntId.current = hunt.id;
  }, [board, dirty, hunt, serverState]);
  const boardUrl = board?.url || (board?.slug ? `/board/${board.slug}` : hunt.slug ? `/board/${hunt.slug}` : null);
  const updateForm = (update: (current: typeof form) => typeof form) => {
    setDirty(true);
    setForm(update);
  };

  return <section className={`${panelClass} p-5 sm:p-6`}>
    <SectionHeading eyebrow="Social-ready view" title="Public board" detail="Freeze the board before an announcement, or open the fullscreen preview for a clean screenshot. Player names and private recognition never appear here." actions={<>
      {boardUrl && <a href={boardUrl} target="_blank" rel="noreferrer" className={secondaryButton}>Open board ↗</a>}
      {boardUrl && <button type="button" className={primaryButton} onClick={() => setPreview(true)}>Fullscreen preview</button>}
    </>} />
    <form className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]" onSubmit={event => {
      event.preventDefault();
      void run('public-board', async () => {
        await adminRequest('/api/v3/admin/control', 'POST', {
          action: 'update_public_board', huntId: hunt.id, enabled: form.enabled, title: form.title,
          cover: form.cover.trim() || null,
          status: form.enabled ? form.status : 'live', columns: form.columns,
          mainVisible: form.mainBoardVisible, replayVisible: form.replayBoardVisible,
          teamNameMode: form.showTeamNames ? 'display_name' : 'code_only',
        });
        setDirty(false);
        notify('Public board settings updated.');
      });
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-bold text-slate-200 sm:col-span-2">Board title<input className={`${inputClass} mt-2`} required value={form.title} maxLength={160} onChange={event => updateForm(current => ({ ...current, title: event.target.value }))} /></label>
        <label className="text-sm font-bold text-slate-200 sm:col-span-2">Cover image reference <span className="font-normal text-slate-500">(optional)</span><input className={`${inputClass} mt-2`} value={form.cover} maxLength={500} placeholder="/api/v3/media/… or https://…" onChange={event => updateForm(current => ({ ...current, cover: event.target.value }))} /></label>
        <label className="text-sm font-bold text-slate-200">Board state<select className={`${inputClass} mt-2`} value={form.enabled ? form.status : 'live'} disabled={!form.enabled} onChange={event => updateForm(current => ({ ...current, status: event.target.value as typeof form.status }))}><option value="live">Live</option><option value="frozen">Frozen</option><option value="final">Final</option></select></label>
        <div className="space-y-2 text-sm text-slate-300">
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={form.enabled} onChange={event => updateForm(current => ({ ...current, enabled: event.target.checked, ...(!event.target.checked ? { status: 'live' as const } : {}) }))} /> Public URL enabled</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={form.showTeamNames} onChange={event => updateForm(current => ({ ...current, showTeamNames: event.target.checked }))} /> Show display names</label>
        </div>
        <div className="space-y-2 text-sm text-slate-300 sm:col-span-2">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.mainBoardVisible} onChange={event => updateForm(current => ({ ...current, mainBoardVisible: event.target.checked }))} /> Main scoreboard</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.replayBoardVisible} onChange={event => updateForm(current => ({ ...current, replayBoardVisible: event.target.checked }))} /> Public replay board</label>
        </div>
      </div>
      <fieldset className="rounded-xl border border-white/10 p-4"><legend className="px-1 text-sm font-black text-white">Visible columns</legend><div className="mt-2 grid grid-cols-2 gap-2">{boardColumns.map(([value, label]) => <label key={value} className="flex min-h-9 items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={form.columns.includes(value)} onChange={event => updateForm(current => ({ ...current, columns: event.target.checked ? [...current.columns, value] : current.columns.filter(item => item !== value) }))} /> {label}</label>)}</div></fieldset>
      <div className="lg:col-span-2"><button className={primaryButton} disabled={Boolean(pending) || !form.title.trim() || !form.columns.length}>{pending === 'public-board' ? 'Saving…' : 'Save public board'}</button></div>
    </form>
    {preview && boardUrl && <div ref={previewRef} className="fixed inset-0 z-[60] flex flex-col bg-slate-950" role="dialog" aria-modal="true" aria-label="Public board preview">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-950 p-3"><p className="font-black text-white">Public board preview · {hunt.title}</p><div className="flex gap-2"><button className={secondaryButton} type="button" onClick={() => { const target = previewRef.current; if (target?.requestFullscreen) void target.requestFullscreen(); else window.open(boardUrl, '_blank', 'noopener,noreferrer'); }}>Use browser fullscreen</button><button className={primaryButton} type="button" onClick={() => setPreview(false)}>Close preview</button></div></div>
      <iframe title={`${hunt.title} public leaderboard`} src={boardUrl} className="min-h-0 flex-1 bg-white" />
    </div>}
  </section>;
}

export default function LiveOperations({ hunt, data, loading, pending, problem, onRefresh, run, notify, reportError }: LiveOperationsProps) {
  const [query, setQuery] = useState('');
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [mode, setMode] = useState<DisplayMode>('table');
  const [renameTeam, setRenameTeam] = useState<LiveTeam | null>(null);
  const [auditTeam, setAuditTeam] = useState<LiveTeam | null>(null);
  const [teamControl, setTeamControl] = useState<{ team: LiveTeam; action: TeamControlAction } | null>(null);
  const [recoveryTeam, setRecoveryTeam] = useState<LiveTeam | null>(null);
  const currentHunt = data?.hunt?.id === hunt.id ? { ...hunt, ...data.hunt } : hunt;
  const teams = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (data?.teams || []).filter(team => {
      if (alertsOnly && team.alerts.length === 0) return false;
      if (!needle) return true;
      return [team.code, team.displayName || '', ...team.memberNames].some(value => value.toLocaleLowerCase().includes(needle));
    });
  }, [alertsOnly, data?.teams, query]);
  const totals = useMemo(() => ({
    teams: data?.teams.length || 0,
    active: data?.teams.filter(team => team.activeRun?.status === 'active').length || 0,
    checkedIn: data?.teams.reduce((sum, team) => sum + team.checkedInCount, 0) || 0,
    members: data?.teams.reduce((sum, team) => sum + team.memberCount, 0) || 0,
    alerts: data?.alerts
      ? data.alerts.help + data.alerts.photos + data.alerts.stalled + data.alerts.fairness
      : data?.teams.reduce((sum, team) => sum + team.alerts.length, 0) || 0,
  }), [data?.alerts, data?.teams]);

  return <div className="space-y-5">
    <LifecycleControls hunt={currentHunt} pending={pending} run={run} notify={notify} />
    <section className={`${panelClass} p-5 sm:p-6`}>
      <SectionHeading eyebrow="Event control" title="Live operations" detail="Five-second updates run only while this tab is visible. Search a canonical code, display name, or any rostered member." actions={<button type="button" className={secondaryButton} disabled={loading || Boolean(pending)} onClick={() => void onRefresh()}>{loading ? 'Refreshing…' : 'Refresh now'}</button>} />
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['Teams', totals.teams], ['Active runs', totals.active], ['Checked in', `${totals.checkedIn}/${totals.members}`], ['Alerts', totals.alerts], ['Last update', data ? new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-white/[0.035] p-3"><p className="text-[0.65rem] font-black uppercase tracking-widest text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-white">{value}</p></div>)}
      </div>
      {problem && <p role="status" className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">{problem} Existing live data remains on screen.</p>}
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="min-w-[16rem] flex-1 text-sm font-bold text-slate-200">Find a team or player<input type="search" className={`${inputClass} mt-2`} value={query} onChange={event => setQuery(event.target.value)} placeholder="T-014, Falcons, Aarav…" /></label>
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 px-3 text-sm font-bold text-slate-300"><input type="checkbox" checked={alertsOnly} onChange={event => setAlertsOnly(event.target.checked)} /> Alerts only</label>
        <div className="flex rounded-xl border border-white/10 p-1" role="group" aria-label="Team display mode"><button type="button" className={mode === 'table' ? primaryButton : secondaryButton} aria-pressed={mode === 'table'} onClick={() => setMode('table')}>Table</button><button type="button" className={mode === 'cards' ? primaryButton : secondaryButton} aria-pressed={mode === 'cards'} onClick={() => setMode('cards')}>Cards</button></div>
      </div>
      <p className="mt-3 text-xs text-slate-500">Showing {teams.length} of {data?.teams.length || 0} teams</p>
      <div className="mt-4">
        {loading && !data && <p role="status" className="py-10 text-center text-slate-400">Loading live teams…</p>}
        {!loading && data && teams.length === 0 && <EmptyState title="No teams match this view">Try another name or code, or turn off “Alerts only.”</EmptyState>}
        {teams.length > 0 && (mode === 'table'
          ? <TeamTable teams={teams} onAudit={setAuditTeam} onRename={setRenameTeam} onControl={(team, action) => setTeamControl({ team, action })} onRecovery={setRecoveryTeam} />
          : <TeamCards teams={teams} onAudit={setAuditTeam} onRename={setRenameTeam} onControl={(team, action) => setTeamControl({ team, action })} onRecovery={setRecoveryTeam} />)}
      </div>
    </section>
    <RosterPanel hunt={currentHunt} pending={pending} run={run} onRefresh={onRefresh} notify={notify} />
    <OperationsQueues hunt={currentHunt} teams={data?.teams || []} pending={pending} run={run} notify={notify} />
    <PublicBoardPanel hunt={currentHunt} board={data?.publicBoard} pending={pending} run={run} notify={notify} />
    {renameTeam && <RenameDialog team={renameTeam} huntId={currentHunt.id} pending={pending} run={run} onClose={() => setRenameTeam(null)} notify={notify} />}
    {teamControl && <TeamStatusDialog team={teamControl.team} action={teamControl.action} huntId={currentHunt.id} pending={pending} run={run} onClose={() => setTeamControl(null)} notify={notify} />}
    {recoveryTeam && <RunRecoveryDialog team={recoveryTeam} huntId={currentHunt.id} pending={pending} run={run} onClose={() => setRecoveryTeam(null)} notify={notify} />}
    {auditTeam && <RecognitionAudit team={auditTeam} huntId={currentHunt.id} pending={pending} run={run} onClose={() => setAuditTeam(null)} reportError={reportError} />}
  </div>;
}

export function explainLiveError(error: unknown) {
  return error instanceof V3AdminRequestError ? error.message : 'Live operations could not be refreshed.';
}
