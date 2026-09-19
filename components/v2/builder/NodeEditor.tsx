'use client';

import type { CheckpointDefinition, Condition, DisplayContent, FlowNode, HuntDefinition, VariableValue } from '@/lib/engine/types';
import { actionClass, buttonClass, CheckField, Field, inputClass, LocationFields, NumberField, TextField } from './Fields';
import { canConnect, isInteractiveNode, newId, nodeLabels } from './model';
import { ContentEditor } from './HintEditor';
import PuzzleEditor from './PuzzleEditor';
import AssetField from './AssetField';

function ValueEditor({ value, onChange }: { value: VariableValue; onChange: (value: VariableValue) => void }) {
  return <div className="space-y-3"><Field label="Value type"><select className={inputClass} value={typeof value} onChange={event => onChange(event.target.value === 'boolean' ? true : event.target.value === 'number' ? 0 : '')}><option value="boolean">Yes / no</option><option value="string">Text</option><option value="number">Number</option></select></Field>
    {typeof value === 'boolean' ? <CheckField label="Yes / true" checked={value} onChange={onChange} /> : typeof value === 'number' ? <NumberField label="Value" value={value} step="any" onChange={onChange} /> : <TextField label="Value" value={value} onChange={onChange} />}
  </div>;
}

function ConditionEditor({ value, hunt, onChange }: { value: Condition; hunt: HuntDefinition; onChange: (value: Condition) => void }) {
  return <div className="space-y-4 rounded-lg bg-slate-50 p-3">
    <Field label="Check this condition"><select className={inputClass} value={value.type} onChange={event => {
      switch (event.target.value) {
        case 'variable': onChange({ type: 'variable', key: 'discovery', equals: true }); break;
        case 'checkpoint_completed': onChange({ type: 'checkpoint_completed', checkpointId: hunt.checkpoints[0]?.id || '' }); break;
        case 'hint_used': onChange({ type: 'hint_used', hintId: hunt.checkpoints.flatMap(checkpoint => checkpoint.hints)[0]?.id || '' }); break;
        case 'time': onChange({ type: 'time', after: '06:00', before: '18:00' }); break;
      }
    }}><option value="variable">A remembered value matches</option><option value="checkpoint_completed">A checkpoint is complete</option><option value="hint_used">A hint has been used</option><option value="time">Current time is in a window</option></select></Field>
    {value.type === 'variable' && <><TextField label="Remembered value name" value={value.key} onChange={key => onChange({ ...value, key })} /><ValueEditor value={value.equals} onChange={equals => onChange({ ...value, equals })} /></>}
    {value.type === 'checkpoint_completed' && <Field label="Checkpoint"><select className={inputClass} value={value.checkpointId} onChange={event => onChange({ ...value, checkpointId: event.target.value })}>{hunt.checkpoints.map(checkpoint => <option key={checkpoint.id} value={checkpoint.id}>{checkpoint.title}</option>)}</select></Field>}
    {value.type === 'hint_used' && <Field label="Hint"><select className={inputClass} value={value.hintId} onChange={event => onChange({ ...value, hintId: event.target.value })}><option value="">Choose a hint</option>{hunt.checkpoints.flatMap(checkpoint => checkpoint.hints.map(hint => <option key={hint.id} value={hint.id}>{checkpoint.title} · {hint.title || hint.id}</option>))}</select></Field>}
    {value.type === 'time' && <><TextField label="Daily window begins (UTC)" type="time" value={value.after} onChange={after => onChange({ ...value, after })} /><TextField label="Daily window ends (UTC)" type="time" value={value.before} onChange={before => onChange({ ...value, before })} /><p className="text-xs text-slate-500">The server checks UTC time. A window can cross midnight, for example 18:00–06:00.</p></>}
  </div>;
}

export function localDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function isoDate(value: string): string { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : ''; }

export function TargetPicker({ label, checkpoint, sourceId, value, onChange }: {
  label: string; checkpoint: CheckpointDefinition; sourceId: string; value: string; onChange: (value: string) => void;
}) {
  return <Field label={label}><select className={inputClass} value={value} onChange={event => onChange(event.target.value)}>
    {!checkpoint.flow.nodes.some(node => node.id === value) && <option value={value}>{value ? `Missing step: ${value}` : 'Choose a step'}</option>}
    {checkpoint.flow.nodes.map((node, index) => <option key={node.id} value={node.id} disabled={!canConnect(checkpoint, sourceId, node.id)}>{index + 1}. {nodeLabels[node.type] || node.type} ({node.id})</option>)}
  </select></Field>;
}

export default function NodeEditor({ checkpoint, hunt, node, onChange, onConnect, onAddQrFallback }: {
  checkpoint: CheckpointDefinition; hunt: HuntDefinition; node: FlowNode; onChange: (node: FlowNode) => void;
  onConnect: (choiceId?: string) => void; onAddQrFallback: () => void;
}) {
  return <div className="space-y-5">
    {node.type === 'show_text' && <TextField label="Clue or instructions" value={node.text} multiline onChange={text => onChange({ ...node, text })} />}
    {'prompt' in node && <TextField label="What should the player do?" value={node.prompt} multiline onChange={prompt => onChange({ ...node, prompt })} />}
    {node.type === 'verify_answer' && <>
      <TextField label="Accepted answers — one per line" value={node.answers.join('\n')} multiline onChange={text => onChange({ ...node, answers: text.split('\n') })} hint="Answers are checked on the server. Players do not receive this list." />
      <CheckField label="Answers must match letter case" checked={node.caseSensitive === true} onChange={caseSensitive => onChange({ ...node, caseSensitive })} />
    </>}
    {node.type === 'verify_code' && <>
      <TextField label="Correct code" value={node.code} onChange={code => onChange({ ...node, code })} />
      <CheckField label="Code must match letter case" checked={node.caseSensitive === true} onChange={caseSensitive => onChange({ ...node, caseSensitive })} />
    </>}
    {node.type === 'verify_qr' && <>
      <TextField label="QR token" value={node.token} onChange={token => onChange({ ...node, token })} hint="Publish to obtain printable QR materials in the organizer console." />
      <button type="button" className={buttonClass} onClick={() => {
        const bytes = crypto.getRandomValues(new Uint8Array(24));
        onChange({ ...node, token: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') });
      }}>Generate a random token</button>
      <TextField label="Backup code (optional)" value={node.backupCode || ''} onChange={backupCode => {
        const result = { ...node };
        if (backupCode) result.backupCode = backupCode; else delete result.backupCode;
        onChange(result);
      }} hint="A player can enter this code if camera access fails." />
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6">
        <p className="font-semibold">Recover from a missing QR</p><p className="mt-1">Add a second route that checks the player’s approximate location and a manual code. Configure its location and code before publishing.</p>
        <button type="button" className={`${buttonClass} mt-3`} onClick={onAddQrFallback}>Add GPS + code alternative route</button>
      </div>
    </>}
    {node.type === 'verify_gps' && <LocationFields value={node} accuracy onChange={location => onChange({ ...node, ...location, radiusMeters: location.radiusMeters!, maxAccuracyMeters: location.maxAccuracyMeters! })} />}
    {node.type === 'show_media' && <ContentEditor value={node.content} allowPuzzle={false} onChange={content => onChange({ ...node, content: content as DisplayContent })} />}
    {node.type === 'puzzle' && <PuzzleEditor value={node.puzzle} onChange={puzzle => onChange({ ...node, puzzle })} />}
    {node.type === 'camera_guide' && <>
      <AssetField label="Reference image URL (optional)" value={node.referenceImageUrl || ''} onChange={referenceImageUrl => { const result = { ...node }; if (referenceImageUrl) result.referenceImageUrl = referenceImageUrl; else delete result.referenceImageUrl; onChange(result); }} />
      <CheckField label="Guide toward a location" checked={node.latitude !== undefined} onChange={checked => { const result = { ...node }; if (checked) { result.latitude = 0; result.longitude = 0; } else { delete result.latitude; delete result.longitude; } onChange(result); }} />
      {node.latitude !== undefined && <LocationFields value={{ latitude: node.latitude, longitude: node.longitude ?? 0 }} onChange={location => onChange({ ...node, latitude: location.latitude, longitude: location.longitude })} />}
      <p className="text-sm leading-6 text-slate-600">Players compare the scene with your reference. Add a photo or another verification step after this guide when confirmation is needed.</p>
    </>}
    {node.type === 'verify_image' && <>
      {node.referenceImages.map((image, index) => <div key={index} className="space-y-2"><AssetField label={`Reference image ${index + 1}`} value={image} onChange={url => onChange({ ...node, referenceImages: node.referenceImages.map((candidate, candidateIndex) => candidateIndex === index ? url : candidate) })} /><button type="button" className={buttonClass} onClick={() => onChange({ ...node, referenceImages: node.referenceImages.filter((_, candidateIndex) => candidateIndex !== index) })}>Remove reference</button></div>)}
      <button type="button" className={buttonClass} onClick={() => onChange({ ...node, referenceImages: [...node.referenceImages, ''] })}>Add reference image</button>
      <CheckField label="Also require a GPS region" checked={Boolean(node.location)} onChange={checked => { const result = { ...node }; if (checked) result.location = { latitude: 0, longitude: 0, radiusMeters: 75, maxAccuracyMeters: 100 }; else delete result.location; onChange(result); }} />
      {node.location && <LocationFields value={node.location} accuracy onChange={location => onChange({ ...node, location: { ...location, radiusMeters: location.radiusMeters!, maxAccuracyMeters: location.maxAccuracyMeters! } })} />}
      <p className="rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950">Photographs require organizer review. Include an alternative route if the player cannot upload a photo.</p>
    </>}
    {node.type === 'verify_organizer' && <p className="rounded-lg bg-teal-50 p-3 text-sm leading-6 text-teal-950">The team waits here until an organizer approves the step. The approval and its reason are recorded.</p>}
    {node.type === 'set_variable' && <><TextField label="Remembered value name" value={node.key} onChange={key => onChange({ ...node, key })} hint="Use this same name in a conditional route later in the hunt." /><ValueEditor value={node.value} onChange={value => onChange({ ...node, value })} /></>}
    {node.type === 'add_points' && <><TextField label="Score entry label" value={node.label} onChange={label => onChange({ ...node, label })} /><NumberField label="Points to add or deduct" value={node.amount} min={-1000000} max={1000000} onChange={amount => onChange({ ...node, amount })} hint="Use a negative number for a deduction. This entry is recorded once when the team reaches this step." /></>}
    {node.type === 'branch' && <>
      <ConditionEditor value={node.condition} hunt={hunt} onChange={condition => onChange({ ...node, condition })} />
      <TargetPicker label="If the condition matches, continue to" checkpoint={checkpoint} sourceId={node.id} value={node.ifTrue} onChange={ifTrue => onChange({ ...node, ifTrue })} /><button type="button" className={buttonClass} onClick={() => onConnect('true')}>Connect matching route on canvas</button>
      <TargetPicker label="Otherwise, continue to" checkpoint={checkpoint} sourceId={node.id} value={node.ifFalse} onChange={ifFalse => onChange({ ...node, ifFalse })} /><button type="button" className={buttonClass} onClick={() => onConnect('false')}>Connect other route on canvas</button>
    </>}
    {node.type === 'random_branch' && <div className="space-y-4"><p className="text-sm text-slate-600">Equal weights give equal chances. A route with weight 2 is twice as likely as one with weight 1.</p>{node.choices.map((choice, index) => <div key={index} className="space-y-3 rounded-lg border border-slate-200 p-3"><TargetPicker label={`Route ${index + 1}`} checkpoint={checkpoint} sourceId={node.id} value={choice.next} onChange={next => onChange({ ...node, choices: node.choices.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, next } : candidate) })} /><NumberField label="Relative weight" value={choice.weight} min={1} max={1000000} onChange={weight => onChange({ ...node, choices: node.choices.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, weight } : candidate) })} /><div className="flex gap-2"><button type="button" className={buttonClass} onClick={() => onConnect(`random:${index}`)}>Connect on canvas</button><button type="button" className={buttonClass} disabled={node.choices.length <= 2} onClick={() => onChange({ ...node, choices: node.choices.filter((_, candidateIndex) => candidateIndex !== index) })}>Remove route</button></div></div>)}<button type="button" className={buttonClass} onClick={() => onChange({ ...node, choices: [...node.choices, { next: node.choices[0]?.next || '', weight: 1 }] })}>Add random route</button></div>}
    {node.type === 'choose_path' && <div className="space-y-4">
      <p className="text-sm text-slate-600">Players choose one route. Different routes can reconnect at the same later step.</p>
      {node.choices.map((choice, index) => <div key={choice.id} className="space-y-3 rounded-lg border border-slate-200 p-3">
        <TextField label={`Route ${index + 1} label`} value={choice.label} onChange={label => onChange({ ...node, choices: node.choices.map(candidate => candidate.id === choice.id ? { ...candidate, label } : candidate) })} />
        <TargetPicker label="Leads to" checkpoint={checkpoint} sourceId={node.id} value={choice.next} onChange={next => onChange({ ...node, choices: node.choices.map(candidate => candidate.id === choice.id ? { ...candidate, next } : candidate) })} />
        <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => onConnect(choice.id)}>Connect this route on canvas</button><button type="button" className={buttonClass} disabled={node.choices.length <= 2} onClick={() => onChange({ ...node, choices: node.choices.filter(candidate => candidate.id !== choice.id) })}>Remove route</button></div>
      </div>)}
      <button type="button" className={buttonClass} disabled={node.choices.length >= 20} onClick={() => onChange({ ...node, choices: [...node.choices, { id: newId('route', node.choices.map(choice => choice.id)), label: 'Another route', next: node.choices[0]?.next || '' }] })}>Add route</button>
    </div>}
    {node.type === 'complete' && <p className="rounded-lg bg-teal-50 p-4 text-sm leading-6 text-teal-950">Reaching this step awards this checkpoint’s points once and continues the hunt. Points and hint costs are configured outside the flow.</p>}
    {isInteractiveNode(node) && <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
      <CheckField label="Provide an alternative way to continue" checked={Boolean(node.fallback)} onChange={checked => {
        const result = { ...node }; if (checked) result.fallback = { nodeId: checkpoint.flow.nodes.find(candidate => candidate.type === 'complete' && canConnect(checkpoint, node.id, candidate.id))?.id || '', label: 'Try another way', enabled: true }; else delete result.fallback; onChange(result);
      }} />
      {node.fallback && <><TextField label="Player recovery button" value={node.fallback.label} onChange={label => onChange({ ...node, fallback: { ...node.fallback!, label } })} /><TargetPicker label="Recovery route starts at" checkpoint={checkpoint} sourceId={node.id} value={node.fallback.nodeId} onChange={nodeId => onChange({ ...node, fallback: { ...node.fallback!, nodeId } })} /><CheckField label="Available immediately (organizer can change this live)" checked={node.fallback.enabled} onChange={enabled => onChange({ ...node, fallback: { ...node.fallback!, enabled } })} /><p className="text-xs leading-5 text-slate-600">Choose a verification step for a recovery challenge, or Finish checkpoint to let the team continue without further verification.</p></>}
    </div>}
    {'next' in node && <div className="space-y-3 border-t border-slate-200 pt-4">
      <TargetPicker label="After success, continue to" checkpoint={checkpoint} sourceId={node.id} value={node.next} onChange={next => onChange({ ...node, next })} />
      <button type="button" className={actionClass} onClick={() => onConnect()}>Connect next step on canvas</button>
    </div>}
  </div>;
}
