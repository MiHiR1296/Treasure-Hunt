'use client';

import { useMemo, useState } from 'react';
import type { CheckpointDefinition, HuntDefinition } from '@/lib/engine/types';
import { validateHunt } from '@/lib/engine/validation';
import { actionClass, buttonClass, NumberField, TextField } from './Fields';
import FlowEditor from './FlowEditor';
import HintEditor from './HintEditor';
import HuntSettingsEditor, { CheckpointSettingsEditor } from './HuntSettingsEditor';
import { createCheckpoint, duplicateCheckpoint, moveItem } from './model';

export interface HuntBuilderProps {
  value: HuntDefinition;
  onChange: (value: HuntDefinition) => void;
  disabled?: boolean;
}

export default function HuntBuilder({ value, onChange, disabled = false }: HuntBuilderProps) {
  const [selectedId, setSelectedId] = useState(value.checkpoints[0]?.id || '');
  const [removingCheckpoint, setRemovingCheckpoint] = useState(false);
  const selected = value.checkpoints.find(checkpoint => checkpoint.id === selectedId) || value.checkpoints[0];
  const selectedIndex = value.checkpoints.findIndex(checkpoint => checkpoint.id === selected?.id);
  const issues = useMemo(() => validateHunt(value), [value]);
  const updateCheckpoint = (checkpoint: CheckpointDefinition) => onChange({ ...value, checkpoints: value.checkpoints.map(candidate => candidate.id === checkpoint.id ? checkpoint : candidate) });

  return <fieldset disabled={disabled} className="min-w-0 space-y-6">
    <legend className="sr-only">Visual hunt builder</legend>
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField label="Hunt title" value={value.title} onChange={title => onChange({ ...value, title })} placeholder="A day of discovery" />
      <TextField label="Unique hunt ID" value={value.id} onChange={id => onChange({ ...value, id })} hint="Use letters, numbers, hyphens, or underscores. Keep this ID when publishing a new version of the same hunt." />
    </div>
    <TextField label="Introduction (optional)" value={value.description || ''} multiline onChange={description => {
      const result = { ...value }; if (description) result.description = description; else delete result.description; onChange(result);
    }} />
    <HuntSettingsEditor value={value} onChange={onChange} />
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-bold">Checkpoints</h3><p className="mt-1 text-sm text-slate-600">{!value.settings?.mode || value.settings.mode === 'sequential' ? 'Players follow this order.' : 'Players choose among unlocked checkpoints.'} Choose a checkpoint to build its flow and hints.</p></div><button type="button" className={actionClass} onClick={() => { const checkpoint = createCheckpoint(value); onChange({ ...value, checkpoints: [...value.checkpoints, checkpoint] }); setSelectedId(checkpoint.id); setRemovingCheckpoint(false); }}>Add checkpoint</button></div>
      <ol className="mt-4 flex flex-wrap gap-2">{value.checkpoints.map((checkpoint, index) => <li key={checkpoint.id}><button type="button" aria-pressed={selected?.id === checkpoint.id} onClick={() => { setSelectedId(checkpoint.id); setRemovingCheckpoint(false); }} className={`${buttonClass} ${selected?.id === checkpoint.id ? 'border-teal-700 bg-teal-50 text-teal-950 ring-1 ring-teal-700' : ''}`}><span className="mr-2 text-slate-500">{index + 1}.</span>{checkpoint.title || 'Untitled checkpoint'}</button></li>)}</ol>
    </div>
    {selected && <section className="space-y-6 rounded-xl border border-slate-200 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xl font-bold">Checkpoint {selectedIndex + 1}</h3><div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} disabled={selectedIndex === 0} onClick={() => onChange({ ...value, checkpoints: moveItem(value.checkpoints, selectedIndex, -1) })}>Move earlier</button>
        <button type="button" className={buttonClass} disabled={selectedIndex === value.checkpoints.length - 1} onClick={() => onChange({ ...value, checkpoints: moveItem(value.checkpoints, selectedIndex, 1) })}>Move later</button>
        <button type="button" className={buttonClass} onClick={() => { const checkpoint = duplicateCheckpoint(value, selected); const checkpoints = [...value.checkpoints]; checkpoints.splice(selectedIndex + 1, 0, checkpoint); onChange({ ...value, checkpoints }); setSelectedId(checkpoint.id); setRemovingCheckpoint(false); }}>Duplicate</button>
        <button type="button" className={buttonClass} disabled={value.checkpoints.length <= 1} onClick={() => setRemovingCheckpoint(!removingCheckpoint)}>Remove checkpoint</button>
      </div></div>
      {removingCheckpoint && <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm"><p>Remove “{selected.title}” and all its steps and hints from this draft? It will also be removed from other checkpoints’ prerequisites.</p><div className="flex gap-2"><button type="button" className={actionClass} onClick={() => { onChange({ ...value, checkpoints: value.checkpoints.filter(checkpoint => checkpoint.id !== selected.id).map(checkpoint => ({ ...checkpoint, ...(checkpoint.prerequisites ? { prerequisites: checkpoint.prerequisites.filter(id => id !== selected.id) } : {}) })) }); setSelectedId(''); setRemovingCheckpoint(false); }}>Remove from draft</button><button type="button" className={buttonClass} onClick={() => setRemovingCheckpoint(false)}>Keep checkpoint</button></div></div>}
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]"><TextField label="Checkpoint title" value={selected.title} onChange={title => updateCheckpoint({ ...selected, title })} /><NumberField label="Completion points" value={selected.basePoints} min={0} max={1000000} onChange={basePoints => updateCheckpoint({ ...selected, basePoints })} /></div>
      <CheckpointSettingsEditor value={selected} hunt={value} onChange={updateCheckpoint} />
      <FlowEditor key={selected.id} value={selected} hunt={value} onChange={updateCheckpoint} />
      <div className="border-t border-slate-200 pt-6"><HintEditor key={selected.id} value={selected.hints} nodes={selected.flow.nodes} usedIds={value.checkpoints.flatMap(checkpoint => checkpoint.hints.map(hint => hint.id))} onChange={hints => updateCheckpoint({ ...selected, hints })} /></div>
    </section>}
    <details className="rounded-xl border border-slate-200 p-4">
      <summary className="cursor-pointer py-2 font-semibold">Decoy QR codes <span className="font-normal text-slate-500">({value.dudQrs?.length || 0})</span></summary>
      <p className="mt-2 text-sm leading-6 text-slate-600">A recognized decoy shows your playful message and keeps the camera running.</p>
      <div className="mt-4 space-y-4">{value.dudQrs?.map((dud, index) => <div key={index} className="space-y-3 rounded-lg bg-slate-50 p-3"><TextField label={`Decoy ${index + 1} token`} value={dud.token} onChange={token => onChange({ ...value, dudQrs: value.dudQrs?.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, token } : candidate) })} /><TextField label="Player message" value={dud.message} onChange={message => onChange({ ...value, dudQrs: value.dudQrs?.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, message } : candidate) })} /><NumberField label="Decoy discovery points" value={dud.points || 0} min={-1000000} max={1000000} onChange={points => onChange({ ...value, dudQrs: value.dudQrs?.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, points } : candidate) })} hint="Award or deduct points once per team for finding this decoy. Use zero for a message only." /><button type="button" className={buttonClass} onClick={() => onChange({ ...value, dudQrs: value.dudQrs?.filter((_, candidateIndex) => candidateIndex !== index) })}>Remove decoy</button></div>)}</div>
      <button type="button" className={`${buttonClass} mt-4`} onClick={() => onChange({ ...value, dudQrs: [...(value.dudQrs || []), { token: Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join(''), message: 'A good find, but this is a decoy. Keep looking!' }] })}>Add decoy QR</button>
    </details>
    <div className={`rounded-xl border p-4 text-sm ${issues.length ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-teal-200 bg-teal-50 text-teal-950'}`}>
      <p className="font-semibold" role="status">{issues.length ? `${issues.length} configuration ${issues.length === 1 ? 'issue' : 'issues'} to resolve before publishing` : 'Configuration is ready for server validation.'}</p>
      {issues.length > 0 && <details className="mt-2"><summary className="cursor-pointer py-2">Show configuration issues</summary><ul className="mt-2 list-disc space-y-2 pl-5">{issues.map((issue, index) => <li key={index}><span className="font-semibold">{issue.path}</span>: {issue.message}</li>)}</ul></details>}
    </div>
  </fieldset>;
}

export { HuntBuilder };
