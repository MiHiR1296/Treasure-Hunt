'use client';

/* eslint-disable @next/next/no-img-element -- Private review photographs require the organizer cookie. */

import { useEffect, useState } from 'react';
import type { FlowNode, HuntDefinition, OrganizerControl } from '@/lib/engine/types';
import { parseControl } from '@/lib/engine/validation';
import { actionClass, buttonClass, Field, inputClass, NumberField, TextField } from '../Fields';
import { nodeLabels } from '../model';
import { adminRequest, AdminRequestError, eventLabels, requestId, scoreLabels, type OperationProps, type OrganizerTeam } from './client';

interface PendingControl { teamId: string; requestId: string; control: OrganizerControl }

const controlLabels: Record<OrganizerControl['type'], string> = {
  approve_action: 'Approve current step', skip_action: 'Skip current step', reset_action: 'Restart current step',
  reject_photo: 'Ask for another photo', skip_checkpoint: 'Skip current checkpoint', move_checkpoint: 'Move to a checkpoint',
  adjust_score: 'Adjust team score', reset_hint: 'Reset a used hint', enable_fallback: 'Change recovery route availability',
};

function History({ team }: { team: OrganizerTeam }) {
  const checkpointTitle = (id: string) => team.view.checkpoints?.find(checkpoint => checkpoint.id === id)?.title || id;
  const totals = Object.entries(scoreLabels).map(([kind, label]) => ({ label, count: team.ledger.filter(entry => entry.kind === kind).length, amount: team.ledger.filter(entry => entry.kind === kind).reduce((sum, entry) => sum + entry.amount, 0) })).filter(item => item.count);
  return <details className="mt-5 border-t border-slate-200 pt-3"><summary className="cursor-pointer py-2 font-semibold text-teal-800">Score breakdown & recent activity</summary>
    <div className="mt-4 space-y-6"><div><h4 className="font-semibold">Score breakdown</h4><dl className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 text-sm">{totals.map(item => <div key={item.label} className="flex justify-between gap-3"><dt>{item.label}</dt><dd className="font-semibold tabular-nums">{item.amount > 0 ? '+' : ''}{item.amount}</dd></div>)}<div className="flex justify-between gap-3 border-t border-slate-200 pt-2 font-bold"><dt>Total score</dt><dd>{team.view.score}</dd></div></dl><ul className="mt-3 divide-y divide-slate-100 text-sm">{team.ledger.slice(-20).reverse().map(entry => <li key={entry.id} className="flex justify-between gap-3 py-3"><div><p className="font-medium">{scoreLabels[entry.kind]}</p><p className="mt-1 text-xs text-slate-500">{checkpointTitle(entry.checkpointId)}{entry.hintId ? ` · ${entry.hintId}` : ''}</p>{entry.reason && <p className="mt-1 text-xs">{entry.reason}</p>}<time dateTime={entry.at} className="mt-1 block text-xs text-slate-500">{new Date(entry.at).toLocaleString()}</time></div><span className="whitespace-nowrap font-semibold">{entry.amount > 0 ? '+' : ''}{entry.amount} pts</span></li>)}</ul></div>
      <div><h4 className="font-semibold">Recent activity</h4><ol className="mt-3 space-y-3 text-sm">{team.events.slice(-20).reverse().map(entry => <li key={entry.id} className={`rounded-lg border p-3 ${entry.reason ? 'border-amber-200 bg-amber-50' : 'border-slate-200'}`}><p className="font-semibold">{eventLabels[entry.type] || entry.type}</p>{entry.checkpointId && <p className="mt-1 text-slate-600">{checkpointTitle(entry.checkpointId)}</p>}{entry.reason && <p className="mt-2 whitespace-pre-wrap"><strong>Reason:</strong> {entry.reason}</p>}<time dateTime={entry.at} className="mt-2 block text-xs text-slate-500">{new Date(entry.at).toLocaleString()}</time></li>)}</ol></div>
      <p className="text-xs text-slate-500">Showing the latest 20 score entries and events. Totals include the full ledger.</p>
    </div>
  </details>;
}

function privateSolution(node: FlowNode): string | null {
  switch (node.type) {
    case 'verify_answer': return `Accepted answers: ${node.answers.filter(Boolean).join(' · ')}`;
    case 'verify_code': return `Correct code: ${node.code}`;
    case 'verify_qr': return node.backupCode ? `Backup code: ${node.backupCode}` : 'Scan the printed QR material.';
    case 'puzzle': {
      const puzzle = node.puzzle;
      if (puzzle.type === 'text') return `Accepted answers: ${puzzle.answers.join(' · ')}`;
      if (puzzle.type === 'crossword') return `Crossword answers: ${puzzle.entries.map(entry => `${entry.id}: ${entry.answer}`).join(' · ')}`;
      if (puzzle.type === 'multiple_choice') return `Correct choice: ${puzzle.options.find(option => option.id === puzzle.correctOptionId)?.label || puzzle.correctOptionId}`;
      if (puzzle.type === 'matching') return `Correct pairs: ${puzzle.solution.map(pair => `${puzzle.left.find(item => item.id === pair.leftId)?.label || pair.leftId} → ${puzzle.right.find(item => item.id === pair.rightId)?.label || pair.rightId}`).join(' · ')}`;
      if (puzzle.type === 'sequence') return `Correct order: ${puzzle.solution.map(id => puzzle.items.find(item => item.id === id)?.label || id).join(' → ')}`;
      if (puzzle.type === 'word_search') return `Find all words: ${puzzle.words.join(' · ')}`;
      return `Puzzle type: ${puzzle.type}. Open Design if you need to inspect its visual solution.`;
    }
    default: return null;
  }
}

function stepCopy(node: FlowNode): string | null {
  if (node.type === 'show_text') return node.text;
  if ('prompt' in node) return node.prompt;
  if (node.type === 'show_media') return `Show ${node.content.type} content to the team.`;
  if (node.type === 'set_variable') return `Remember ${node.key} = ${String(node.value)}.`;
  if (node.type === 'add_points') return `${node.label}: ${node.amount > 0 ? '+' : ''}${node.amount} points.`;
  if (node.type === 'complete') return 'Complete this checkpoint and award its points.';
  return null;
}

function TeamRouteAndSolutions({ team, definition }: { team: OrganizerTeam; definition?: HuntDefinition }) {
  if (!definition) return null;
  return <details className="mt-4 rounded-lg border border-teal-200 bg-teal-50/40 p-3">
    <summary className="cursor-pointer py-2 text-sm font-semibold text-teal-900">Route & private solutions</summary>
    <p className="mt-2 text-xs leading-5 text-slate-600">Organizer-only reference for this team’s pinned hunt version. The active step is marked below; answers never go to player devices.</p>
    <ol className="mt-4 space-y-3">{definition.checkpoints.map((checkpoint, checkpointIndex) => {
      const progress = team.checkpoints[checkpoint.id];
      const isCurrent = team.view.checkpoint?.id === checkpoint.id;
      return <li key={checkpoint.id}><details open={isCurrent} className="rounded-lg border border-slate-200 bg-white p-3"><summary className="cursor-pointer"><span className="font-semibold">{checkpointIndex + 1}. {checkpoint.title}</span><span className="ml-2 text-xs capitalize text-slate-600">· {progress?.status || 'not started'}</span></summary>
        <ol className="mt-3 space-y-3 border-l-2 border-slate-100 pl-3">{checkpoint.flow.nodes.map((node, index) => {
          const isActive = team.view.checkpoint?.id === checkpoint.id && team.view.node?.id === node.id;
          const solution = privateSolution(node);
          const copy = stepCopy(node);
          return <li key={node.id} className={isActive ? 'rounded bg-amber-50 p-2 ring-1 ring-amber-300' : 'py-1'}><p className="text-sm"><span className="mr-2 font-mono text-xs text-slate-500">{index + 1}</span><strong>{nodeLabels[node.type] || node.type}</strong>{isActive && <span className="ml-2 text-xs font-semibold text-amber-800">TEAM IS HERE</span>}</p>{copy && <p className="mt-1 whitespace-pre-line text-xs leading-5 text-slate-600">{copy}</p>}{solution && <p className="mt-1 break-words rounded bg-teal-50 px-2 py-1 text-xs font-semibold leading-5 text-teal-950">{solution}</p>}</li>;
        })}</ol>
      </details></li>;
    })}</ol>
  </details>;
}

function TeamControls({ team, pending, run, refresh, notify }: Omit<OperationProps, 'dashboard'> & { team: OrganizerTeam }) {
  const [type, setType] = useState<OrganizerControl['type']>('approve_action');
  const [reason, setReason] = useState('');
  const [targetCheckpoint, setTargetCheckpoint] = useState(team.view.checkpoint?.id || team.view.checkpoints?.[0]?.id || '');
  const [hintId, setHintId] = useState('');
  const [amount, setAmount] = useState(0);
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [confirmation, setConfirmation] = useState<OrganizerControl | null>(null);
  const [savedAction, setSavedAction] = useState<PendingControl | null>(null);
  const [historyChecked, setHistoryChecked] = useState(false);
  const storageKey = `hunt-v2-organizer-control:${team.id}`;
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      const stored = JSON.parse(raw);
      if (stored.teamId !== team.id || typeof stored.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(stored.requestId)) return;
      setSavedAction({ teamId: stored.teamId, requestId: stored.requestId, control: parseControl(stored.control) });
    } catch { /* Invalid local recovery records cannot be sent as organizer controls. */ }
  }, [storageKey, team.id]);
  const checkpointId = team.view.checkpoint?.id || '';
  const nodeId = team.view.node?.id || '';
  const choices: OrganizerControl['type'][] = [
    ...(nodeId ? ['approve_action', 'skip_action', 'reset_action'] as const : []),
    ...(team.view.node?.type === 'verify_image' ? ['reject_photo'] as const : []),
    ...(checkpointId ? ['skip_checkpoint'] as const : []), 'move_checkpoint', 'adjust_score', 'reset_hint',
    ...(team.view.node?.fallback ? ['enable_fallback'] as const : []),
  ];
  const chosenType = choices.includes(type) ? type : choices[0];
  const reversedEntries = new Set(team.ledger.flatMap(entry => entry.reverses ? [entry.reverses] : []));
  const hintEntries = team.ledger.filter(entry => entry.kind === 'hint_used' && entry.checkpointId === targetCheckpoint && !reversedEntries.has(entry.id));

  function buildControl(): OrganizerControl | null {
    const base = { expectedRevision: team.view.revision, reason: reason.trim() };
    switch (chosenType) {
      case 'approve_action': case 'skip_action': case 'reset_action': case 'reject_photo': return nodeId ? { ...base, type: chosenType, checkpointId, nodeId } : null;
      case 'skip_checkpoint': return checkpointId ? { ...base, type: chosenType, checkpointId } : null;
      case 'move_checkpoint': return targetCheckpoint ? { ...base, type: chosenType, checkpointId: targetCheckpoint } : null;
      case 'adjust_score': return { ...base, type: chosenType, amount };
      case 'reset_hint': return hintId ? { ...base, type: chosenType, checkpointId: targetCheckpoint, hintId } : null;
      case 'enable_fallback': return { ...base, type: chosenType, checkpointId, nodeId, enabled: fallbackEnabled };
    }
  }

  function clearSavedAction() {
    try { sessionStorage.removeItem(storageKey); } catch { /* A retained receipt is still safe to retry. */ }
    setSavedAction(null); setHistoryChecked(false); setConfirmation(null);
  }

  function apply(control: OrganizerControl, retry?: PendingControl) {
    void run(`control:${team.id}`, async () => {
      const action = retry || { teamId: team.id, requestId: requestId(), control };
      try { sessionStorage.setItem(storageKey, JSON.stringify(action)); }
      catch { throw new AdminRequestError('This browser cannot save the retry receipt. Enable session storage before sending an organizer action.', 0); }
      setSavedAction(action);
      try { await adminRequest('/api/v2/admin/control', 'POST', action); }
      catch (error) {
        if (error instanceof AdminRequestError && error.status >= 400 && error.status < 500) clearSavedAction();
        throw error;
      }
      clearSavedAction(); setReason(''); notify(`${controlLabels[control.type]} saved for ${team.name}. The reason was recorded.`); await refresh();
    });
  }

  return <div className="mt-5 space-y-3 border-t border-slate-200 pt-4"><h4 className="font-semibold">Help this team continue</h4>
    {savedAction ? <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm"><p className="font-semibold">Organizer action awaiting confirmation</p><p>{controlLabels[savedAction.control.type]}{savedAction.control.type === 'adjust_score' ? `: ${savedAction.control.amount > 0 ? '+' : ''}${savedAction.control.amount} points` : ''}</p><p><strong>Reason:</strong> {savedAction.control.reason}</p><p>The response may have been lost. Retry sends the same saved request, so the server applies it once. Check the score and recent activity below before discarding.</p><button type="button" className={actionClass} disabled={Boolean(pending)} onClick={() => apply(savedAction.control, savedAction)}>Retry pending organizer action</button><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={historyChecked} onChange={event => setHistoryChecked(event.target.checked)} className="h-5 w-5 accent-teal-800" />I checked this team’s score and recent activity</label><button type="button" className={buttonClass} disabled={Boolean(pending) || !historyChecked} onClick={clearSavedAction}>Discard pending action</button></div>
      : confirmation ? <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm"><p className="font-semibold">Confirm: {controlLabels[confirmation.type]}</p><p>This changes {team.name}’s progress or score. {confirmation.type === 'adjust_score' ? `Score change: ${confirmation.amount > 0 ? '+' : ''}${confirmation.amount} points.` : ''}</p><p><strong>Reason:</strong> {confirmation.reason}</p><div className="flex flex-wrap gap-2"><button type="button" className={actionClass} disabled={Boolean(pending)} onClick={() => apply(confirmation)}>Confirm change</button><button type="button" className={buttonClass} disabled={Boolean(pending)} onClick={() => setConfirmation(null)}>Cancel</button></div></div>
      : <form className="space-y-3" onSubmit={event => { event.preventDefault(); const control = buildControl(); if (!control || !reason.trim()) return; if (['skip_action', 'skip_checkpoint', 'reset_action', 'reset_hint', 'move_checkpoint', 'adjust_score'].includes(control.type)) setConfirmation(control); else apply(control); }}>
        <fieldset disabled={Boolean(pending)} className="space-y-3"><Field label="Organizer action"><select className={inputClass} value={chosenType} onChange={event => setType(event.target.value as OrganizerControl['type'])}>{choices.map(choice => <option key={choice} value={choice}>{controlLabels[choice]}</option>)}</select></Field>
          {(chosenType === 'move_checkpoint' || chosenType === 'reset_hint') && <Field label="Checkpoint"><select className={inputClass} value={targetCheckpoint} onChange={event => { setTargetCheckpoint(event.target.value); setHintId(''); }}>{team.view.checkpoints?.map(checkpoint => <option key={checkpoint.id} value={checkpoint.id}>{checkpoint.title}</option>)}</select></Field>}
          {chosenType === 'reset_hint' && <Field label="Used hint"><select className={inputClass} value={hintId} onChange={event => setHintId(event.target.value)} required><option value="">Choose a used hint</option>{hintEntries.map(entry => <option key={entry.id} value={entry.hintId}>{team.view.hints.find(hint => hint.id === entry.hintId)?.title || entry.hintId}</option>)}</select></Field>}
          {chosenType === 'adjust_score' && <NumberField label="Points to add or deduct" value={amount} min={-1000000} max={1000000} onChange={setAmount} />}
          {chosenType === 'enable_fallback' && <Field label="Recovery route"><select className={inputClass} value={fallbackEnabled ? 'enabled' : 'disabled'} onChange={event => setFallbackEnabled(event.target.value === 'enabled')}><option value="enabled">Enable for this team</option><option value="disabled">Disable for this team</option></select></Field>}
          <Field label="Reason for organizer action"><input className={inputClass} required maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="QR damaged; team found the landmark" /></Field>
          <button type="submit" className={actionClass} disabled={!reason.trim()}>{controlLabels[chosenType]}</button>
        </fieldset>
      </form>}
  </div>;
}

export default function TeamOperations(props: OperationProps) {
  const { dashboard, pending, run, refresh, notify } = props;
  const [huntId, setHuntId] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState('');
  const [announcementHunt, setAnnouncementHunt] = useState('');
  const [announcementTeam, setAnnouncementTeam] = useState('');
  const teams = dashboard.teams.filter(team => (showPreview || !team.isPreview) && (!huntId || team.huntId === huntId));
  const openHelp = dashboard.help.filter(help => help.status === 'open' && (!huntId || help.hunt_id === huntId));
  const broadcastHunt = announcementHunt || dashboard.hunts[0]?.id || '';
  const activity = teams.flatMap(team => team.events.slice(-30).map(event => ({ event, team }))).sort((left, right) => right.event.at.localeCompare(left.event.at)).slice(0, 30);

  return <section className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-2xl font-bold">Run the event</h2><p className="mt-2 text-sm text-slate-600">Team progress, rescue controls, photo reviews, and help requests update every 15 seconds.</p></div><Field label="Filter by hunt"><select className={inputClass} value={huntId} onChange={event => setHuntId(event.target.value)}><option value="">All hunts</option>{dashboard.hunts.map(hunt => <option key={hunt.id} value={hunt.id}>{hunt.title}</option>)}</select></Field></div>
    <details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer py-2 font-semibold">Send an event message</summary><form className="mt-4 space-y-4" onSubmit={event => { event.preventDefault(); void run('announcement', async () => { await adminRequest('/api/v2/admin/help', 'POST', { huntId: broadcastHunt, ...(announcementTeam ? { teamId: announcementTeam } : {}), message: announcement }); setAnnouncement(''); notify('Event message sent.'); await refresh(); }); }}><fieldset className="space-y-4" disabled={Boolean(pending)}><Field label="Hunt"><select className={inputClass} value={broadcastHunt} onChange={event => { setAnnouncementHunt(event.target.value); setAnnouncementTeam(''); }}>{dashboard.hunts.map(hunt => <option key={hunt.id} value={hunt.id}>{hunt.title}</option>)}</select></Field><Field label="Recipients"><select className={inputClass} value={announcementTeam} onChange={event => setAnnouncementTeam(event.target.value)}><option value="">All teams in this hunt</option>{dashboard.teams.filter(team => team.huntId === broadcastHunt && !team.isPreview).map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></Field><TextField label="Message" value={announcement} multiline onChange={setAnnouncement} /><button className={actionClass} disabled={!announcement.trim() || !broadcastHunt}>Send message</button></fieldset></form></details>
    <div className="space-y-3"><h3 className="text-xl font-bold">Open help requests ({openHelp.length})</h3>{openHelp.length === 0 && <p className="text-sm text-slate-500">No teams are waiting for a reply.</p>}{openHelp.map(help => <article key={help.id} className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="font-semibold">{help.team_name} · {help.kind}</p><p className="whitespace-pre-wrap text-sm">{help.message}</p><p className="text-xs text-slate-500">{new Date(help.created_at).toLocaleString()}</p><form className="space-y-3" onSubmit={event => { event.preventDefault(); void run(`help:${help.id}`, async () => { await adminRequest('/api/v2/admin/help', 'POST', { helpId: help.id, message: replies[help.id] }); setReplies(previous => ({ ...previous, [help.id]: '' })); notify(`Reply sent to ${help.team_name}; the request is resolved.`); await refresh(); }); }}><Field label={`Reply to ${help.team_name}`}><textarea className={inputClass} required maxLength={2000} disabled={Boolean(pending)} value={replies[help.id] || ''} onChange={event => setReplies(previous => ({ ...previous, [help.id]: event.target.value }))} /></Field><button className={actionClass} disabled={Boolean(pending) || !replies[help.id]?.trim()}>Reply & resolve</button></form></article>)}</div>
    <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-teal-800" checked={showPreview} onChange={event => setShowPreview(event.target.checked)} />Show preview teams</label>
    <details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer py-2 font-semibold">Event activity feed</summary><p className="mt-2 text-xs text-slate-500">The latest 30 events across teams matching the filters above.</p><ol className="mt-3 max-h-96 space-y-3 overflow-y-auto">{activity.map(({ event, team }) => <li key={`${team.id}:${event.id}`} className="rounded-lg bg-slate-50 p-3 text-sm"><p><time dateTime={event.at} className="mr-2 text-xs text-slate-500">{new Date(event.at).toLocaleTimeString()}</time><strong>{team.name}</strong> · {eventLabels[event.type] || event.type}{event.amount !== undefined ? ` (${event.amount > 0 ? '+' : ''}${event.amount} points)` : ''}</p>{event.checkpointId && <p className="mt-1 text-xs text-slate-600">{team.view.checkpoints?.find(checkpoint => checkpoint.id === event.checkpointId)?.title || event.checkpointId}</p>}{event.reason && <p className="mt-1 text-xs text-slate-600">{event.reason}</p>}</li>)}</ol>{activity.length === 0 && <p className="mt-3 text-sm text-slate-500">Team activity will appear here after players join.</p>}</details>
    <div className="grid gap-5 xl:grid-cols-2">{teams.map(team => <article key={team.id} className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3"><div><h3 className="text-xl font-bold">{team.name}{team.isPreview && <span className="ml-2 rounded bg-indigo-50 px-2 py-1 text-xs text-indigo-800">Test session</span>}</h3><p className="mt-1 text-sm text-slate-500">{team.view.hunt.title} · v{team.version}</p></div><p className="whitespace-nowrap text-lg font-bold text-teal-800">{team.view.score} pts</p></div>
      <p className="mt-4 font-semibold">{team.view.status === 'completed' ? 'Hunt finished' : team.view.checkpoint?.title || 'Choosing next checkpoint'}</p><p className="mt-1 text-sm text-slate-600">{team.view.progress.completed} of {team.view.progress.total} checkpoints completed</p>
      <p className="mt-2 text-sm text-slate-600">{team.view.node ? nodeLabels[team.view.node.type] : team.view.status === 'completed' ? 'Finished' : 'Choosing a checkpoint'} · {team.view.summary?.hintsUsed ?? team.ledger.filter(entry => entry.kind === 'hint_used' && !team.ledger.some(refund => refund.reverses === entry.id)).length} hints used{openHelp.some(help => help.team_id === team.id) ? ' · Help requested' : ''}</p>
      {team.view.node && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm leading-6">{team.view.node.type === 'show_text' ? team.view.node.text : 'prompt' in team.view.node ? team.view.node.prompt : `Viewing ${team.view.node.content.type} content`}</p>}
      <p className="mt-3 text-xs text-slate-500">Last activity: {new Date(team.lastActivity).toLocaleString()}</p>
      <details className="mt-4 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer py-2 text-sm font-semibold">Checkpoint progression</summary><ol className="mt-3 space-y-3 text-sm">{team.view.checkpoints?.map(checkpoint => { const progress = team.checkpoints[checkpoint.id]; const nodes = Object.values(progress?.nodes || {}); const attempts = nodes.reduce((sum, node) => sum + node.attempts, 0); return <li key={checkpoint.id}><div className="flex justify-between gap-3"><span>{checkpoint.title}{!checkpoint.required ? ' (optional)' : ''}</span><span className="capitalize text-slate-600">{checkpoint.status}</span></div>{nodes.length > 0 && <p className="mt-1 text-xs text-slate-500">{nodes.filter(node => node.status === 'completed' || node.status === 'skipped').length} steps passed · {attempts} verification attempts</p>}</li>; })}</ol></details>
      <TeamRouteAndSolutions team={team} definition={team.definition} />
      {dashboard.photos.filter(photo => photo.team_id === team.id).map(photo => <div key={photo.id} className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="mb-3 font-semibold">Photo awaiting review</p><img src={`/api/v2/media/${photo.id}`} alt={`Checkpoint photograph submitted by ${team.name}`} className="max-h-80 w-full rounded-lg object-contain" /><a className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-teal-800 underline" href={`/api/v2/media/${photo.id}`} target="_blank" rel="noreferrer">Open full image</a>{photo.referenceImages?.length > 0 && <div className="mt-3 space-y-3 border-t border-amber-200 pt-3"><p className="text-sm font-semibold">Expected landmark references</p><p className="text-xs text-slate-600">Compare with the references from this team’s hunt version.</p><div className="grid gap-3 sm:grid-cols-2">{photo.referenceImages.map((url, index) => <a key={`${url}:${index}`} href={url} target="_blank" rel="noreferrer" className="rounded-lg border border-amber-200 bg-white p-2"><img src={url} alt={`Expected landmark reference ${index + 1} for ${team.name}`} className="max-h-56 w-full object-contain" /><span className="mt-2 block text-xs font-semibold text-teal-800 underline">Open reference {index + 1}</span></a>)}</div></div>}<p className="mt-3 text-xs text-slate-600">Use Approve current step or Ask for another photo below.</p></div>)}
      <TeamControls key={`${team.id}:${team.view.checkpoint?.id}:${team.view.node?.id}`} team={team} pending={pending} run={run} refresh={refresh} notify={notify} />
      <History team={team} />
    </article>)}</div>
    {teams.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-6 text-slate-500">No teams match this filter.</p>}
  </section>;
}
