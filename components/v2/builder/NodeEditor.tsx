'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { CheckpointDefinition, Condition, DisplayContent, FlowNode, HuntDefinition, VariableValue, VisionComparisonScope, VisionTargetProfile } from '@/lib/engine/types';
import { actionClass, buttonClass, CheckField, Field, inputClass, LocationFields, NumberField, TextField } from './Fields';
import { canConnect, isInteractiveNode, newId, nodeLabels } from './model';
import { ContentEditor } from './HintEditor';
import PuzzleEditor from './PuzzleEditor';
import AssetField, { useBuilderMedia } from './AssetField';

function ValueEditor({ value, onChange }: { value: VariableValue; onChange: (value: VariableValue) => void }) {
  return <div className="space-y-3"><Field label="Value type"><select className={inputClass} value={typeof value} onChange={event => onChange(event.target.value === 'boolean' ? true : event.target.value === 'number' ? 0 : '')}><option value="boolean">Yes / no</option><option value="string">Text</option><option value="number">Number</option></select></Field>
    {typeof value === 'boolean' ? <CheckField label="Yes / true" checked={value} onChange={onChange} /> : typeof value === 'number' ? <NumberField label="Value" value={value} step="any" onChange={onChange} /> : <TextField label="Value" value={value} onChange={onChange} />}
  </div>;
}

function knownVariables(hunt: HuntDefinition): { key: string; types: Set<string> }[] {
  const variables = new Map<string, Set<string>>();
  for (const node of hunt.checkpoints.flatMap(checkpoint => checkpoint.flow.nodes)) if (node.type === 'set_variable') {
    const types = variables.get(node.key) ?? new Set<string>();
    types.add(typeof node.value); variables.set(node.key, types);
  }
  return [...variables].map(([key, types]) => ({ key, types })).sort((a, b) => a.key.localeCompare(b.key));
}

function VariableKeyField({ label, value, hunt, onChange }: { label: string; value: string; hunt: HuntDefinition; onChange: (value: string) => void }) {
  const listId = `variables-${useId().replace(/:/g, '')}`;
  const variables = knownVariables(hunt);
  return <Field label={label}><input className={inputClass} list={listId} value={value} onChange={event => onChange(event.target.value)} /><datalist id={listId}>{variables.map(variable => <option key={variable.key} value={variable.key}>{[...variable.types].join(' / ')}</option>)}</datalist><p className="mt-1 text-xs leading-5 text-slate-500">Choose a value already used in this hunt or enter a deliberate new name.</p></Field>;
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
    {value.type === 'variable' && <><VariableKeyField label="Remembered value name" value={value.key} hunt={hunt} onChange={key => onChange({ ...value, key })} /><ValueEditor value={value.equals} onChange={equals => onChange({ ...value, equals })} />{(() => { const known = knownVariables(hunt).find(variable => variable.key === value.key); return known && !known.types.has(typeof value.equals) ? <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">This condition compares a {typeof value.equals}, but the existing assignments use {[...known.types].join(' / ')}. Confirm that the types should differ.</p> : null; })()}</>}
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

const scopeLabels: Record<VisionComparisonScope,string> = {
  same_physical_subject: 'The same individual physical object', same_named_place: 'The same named place or landmark',
  same_make_model: 'The same make and model', same_kind: 'The same kind or species',
};

function VisionEditor({ node,onChange }: { node: Extract<FlowNode,{type:'verify_image'}>; onChange:(node:Extract<FlowNode,{type:'verify_image'}>)=>void }) {
  const [jobId,setJobId]=useState(''),[status,setStatus]=useState(''),[error,setError]=useState('');
  const mounted=useRef(true), latest=useRef(node), latestChange=useRef(onChange); latest.current=node; latestChange.current=onChange;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
  const vision=node.vision;
  async function request(url:string,options?:RequestInit) {
    const response=await fetch(url,{...options,cache:'no-store',credentials:'same-origin',headers:options?.body?{'Content-Type':'application/json'}:undefined});
    const value=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(typeof value.error==='string'?value.error:'The profile request could not be completed.');
    return value as {job:{id:string;status:string;result?:VisionTargetProfile;last_error?:string}};
  }
  async function generate() {
    if(!vision||jobId)return;setError('');setStatus('Queued for the local vision worker…');
    try {
      const created=await request('/api/v2/admin/vision-profile',{method:'POST',body:JSON.stringify({targetName:vision.targetName,scope:vision.scope,referenceImages:node.referenceImages})});
      if(!mounted.current)return;setJobId(created.job.id);
      for(let attempt=0;attempt<150&&mounted.current;attempt++) {
        await new Promise(resolve=>window.setTimeout(resolve,2000));
        const response=await request(`/api/v2/admin/vision-profile?id=${encodeURIComponent(created.job.id)}`),job=response.job;
        if(!mounted.current)return;
        setStatus(job.status==='leased'?'The Mac is analyzing the references…':job.status==='queued'?'Waiting for the Mac worker…':job.status);
        if(job.status==='completed'&&job.result) {
          const current=latest.current;if(!current.vision)return;
          latestChange.current({...current,vision:{...current.vision,profile:job.result}});setStatus('Profile generated. Review it, then save the draft.');setJobId('');return;
        }
        if(job.status==='failed'||job.status==='cancelled')throw new Error(job.last_error?`Profile generation failed (${job.last_error}).`:'Profile generation failed.');
      }
      throw new Error('Profile generation is still taking too long. It can be tried again when the worker is available.');
    } catch(reason) {if(mounted.current){setError(reason instanceof Error?reason.message:'Profile generation failed.');setStatus('');setJobId('')}}
  }
  if(!vision)return <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><CheckField label="Use the local image-review assistant" checked={false} onChange={checked=>{if(checked)onChange({...node,vision:{mode:'assisted',targetName:'',scope:'same_named_place',autoApproveThreshold:.98,minimumEvidence:2,requireLocationForAutoApproval:Boolean(node.location)}})}} /><p className="mt-2 text-xs leading-5 text-slate-600">The organizer can generate a private target profile from the reference set. Existing human review remains available.</p></div>;
  return <div className="space-y-4 rounded-lg border border-teal-200 bg-teal-50/40 p-4">
    <CheckField label="Use the local image-review assistant" checked onChange={checked=>{if(!checked){const result={...node};delete result.vision;onChange(result)}}} />
    <TextField label="Target name" value={vision.targetName} onChange={targetName=>onChange({...node,vision:{...vision,targetName,profile:undefined}})} hint="For example: Royal Enfield Bullet 350 or Kalyan Durgadi Fort main gate." />
    <Field label="What must match?"><select className={inputClass} value={vision.scope} onChange={event=>onChange({...node,vision:{...vision,scope:event.target.value as VisionComparisonScope,profile:undefined}})}>{Object.entries(scopeLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
    <button type="button" className={actionClass} disabled={Boolean(jobId)||!vision.targetName.trim()||node.referenceImages.length<2} onClick={()=>void generate()}>{jobId?'Generating profile…':vision.profile?'Regenerate profile from references':'Generate profile from references'}</button>
    <p className="text-xs leading-5 text-slate-600">Uses 2–30 application-managed reference images. The worker automatically chooses up to six varied views for later comparisons.</p>
    {status&&<p role="status" className="text-sm text-teal-900">{status}</p>}{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {vision.profile&&<div className="space-y-2 rounded-lg border border-teal-200 bg-white p-3 text-sm"><p className="font-semibold">Generated target profile</p><p>{vision.profile.summary}</p><p className="text-xs"><strong>Visible identity cues:</strong> {vision.profile.distinguishingFeatures.join(' · ')}</p>{vision.profile.confusingAlternatives.length>0&&<p className="text-xs"><strong>Close alternatives:</strong> {vision.profile.confusingAlternatives.join(' · ')}</p>}<p className="text-xs text-slate-500">{vision.profile.referenceSelections.map(item=>`Reference ${item.index+1}: ${item.role}`).join(' · ')} · {vision.profile.model} · {vision.profile.promptVersion}</p></div>}
    <Field label="Assistant behavior"><select className={inputClass} value={vision.mode} onChange={event=>onChange({...node,vision:{...vision,mode:event.target.value as typeof vision.mode}})}><option value="shadow">Shadow — record only</option><option value="assisted">Assisted — advise the organizer</option><option value="auto_approve">Auto-approve qualifying matches</option></select></Field>
    {vision.mode==='auto_approve'&&<div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-sm leading-6 text-amber-950">Only a two-pass MATCH with usable quality, profile agreement, enough visible evidence, and the threshold below can advance. Every other outcome remains for human review.</p><NumberField label="Minimum model confidence" value={vision.autoApproveThreshold} min={0.5} max={1} step={0.01} onChange={autoApproveThreshold=>onChange({...node,vision:{...vision,autoApproveThreshold}})} /><NumberField label="Minimum visible evidence items" value={vision.minimumEvidence} min={1} max={6} onChange={minimumEvidence=>onChange({...node,vision:{...vision,minimumEvidence}})} /><CheckField label="Require this action's GPS check for automatic approval" checked={vision.requireLocationForAutoApproval} onChange={requireLocationForAutoApproval=>onChange({...node,vision:{...vision,requireLocationForAutoApproval}})} /></div>}
  </div>;
}

function ReferenceSetUploader({ node,onChange }: { node:Extract<FlowNode,{type:'verify_image'}>; onChange:(node:Extract<FlowNode,{type:'verify_image'}>)=>void }) {
  const services=useBuilderMedia(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function upload(files:FileList|null) {
    if(!services||!files?.length||busy)return;setBusy(true);setError('');
    try {
      const available=Math.max(0,30-node.referenceImages.length),selected=Array.from(files).filter(file=>file.type.startsWith('image/')).slice(0,available),urls:string[]=[];
      if(!selected.length)throw new Error(available?'Choose one or more image files.':'This step already has the maximum 30 references.');
      for(const file of selected)urls.push((await services.upload(file)).url);
      const vision=node.vision?{...node.vision,profile:undefined}:undefined;
      onChange({...node,referenceImages:[...node.referenceImages,...urls],...(vision?{vision}:{})});
    } catch(reason) {setError(reason instanceof Error?reason.message:'The reference set could not be uploaded.');}
    finally {setBusy(false);}
  }
  if(!services)return null;
  return <div className="space-y-2"><label className={`${buttonClass} relative inline-flex cursor-pointer overflow-hidden`}>{busy?'Uploading reference set…':'Upload several reference images'}<input type="file" accept="image/*" multiple disabled={busy} className="absolute inset-0 cursor-pointer opacity-0" onChange={event=>{void upload(event.target.files);event.target.value=''}} /></label>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<p className="text-xs text-slate-500">Select several images in one picker. A changed reference set requires regenerating its target profile.</p></div>;
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
      <TextField label="Answer shown in completed-stage history (optional)" value={node.recapAnswer || ''} onChange={recapAnswer => { const result = { ...node }; if (recapAnswer) result.recapAnswer = recapAnswer; else delete result.recapAnswer; onChange(result); }} hint="Use a short public recap. Leave blank to show only ‘Answer accepted’." />
      <CheckField label="Answers must match letter case" checked={node.caseSensitive === true} onChange={caseSensitive => onChange({ ...node, caseSensitive })} />
      <CheckField label="Keep the latest submitted answers for organizers" checked={node.recordAnswerAttempts === true} onChange={recordAnswerAttempts => onChange({ ...node, recordAnswerAttempts })} />
      {node.recordAnswerAttempts && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">Records submitted answers, outcomes and server times privately for organizers. The inspector shows the latest 20 (500 characters each); Results retains all new submissions up to the command length limit. Older uncaptured answers cannot be recovered. Enable this only when your event’s privacy policy allows it.</p>}
    </>}
    {node.type === 'verify_code' && <>
      <TextField label="Correct code" value={node.code} onChange={code => onChange({ ...node, code })} />
      <TextField label="Answer shown in completed-stage history (optional)" value={node.recapAnswer || ''} onChange={recapAnswer => { const result = { ...node }; if (recapAnswer) result.recapAnswer = recapAnswer; else delete result.recapAnswer; onChange(result); }} hint="Leave blank to keep the code private and show only ‘Code accepted’." />
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
      {node.referenceImages.map((image, index) => <div key={index} className="space-y-2"><AssetField label={`Reference image ${index + 1}`} value={image} onChange={url => onChange({ ...node, referenceImages: node.referenceImages.map((candidate, candidateIndex) => candidateIndex === index ? url : candidate),...(node.vision?{vision:{...node.vision,profile:undefined}}:{}) })} /><button type="button" className={buttonClass} onClick={() => onChange({ ...node, referenceImages: node.referenceImages.filter((_, candidateIndex) => candidateIndex !== index),...(node.vision?{vision:{...node.vision,profile:undefined}}:{}) })}>Remove reference</button></div>)}
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => onChange({ ...node, referenceImages: [...node.referenceImages, ''],...(node.vision?{vision:{...node.vision,profile:undefined}}:{}) })}>Add reference image</button><ReferenceSetUploader node={node} onChange={onChange} /></div>
      <CheckField label="Also require a GPS region" checked={Boolean(node.location)} onChange={checked => { const result = { ...node }; if (checked) result.location = { latitude: 0, longitude: 0, radiusMeters: 75, maxAccuracyMeters: 100 }; else delete result.location; onChange(result); }} />
      {node.location && <LocationFields value={node.location} accuracy onChange={location => onChange({ ...node, location: { ...location, radiusMeters: location.radiusMeters!, maxAccuracyMeters: location.maxAccuracyMeters! } })} />}
      <VisionEditor node={node} onChange={onChange} />
      <p className="rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950">Manual organizer review always remains available. Include an alternative route if the player cannot upload a photo.</p>
    </>}
    {node.type === 'verify_organizer' && <p className="rounded-lg bg-teal-50 p-3 text-sm leading-6 text-teal-950">The team waits here until an organizer approves the step. The approval and its reason are recorded.</p>}
    {node.type === 'set_variable' && <><VariableKeyField label="Remembered value name" value={node.key} hunt={hunt} onChange={key => onChange({ ...node, key })} /><ValueEditor value={node.value} onChange={value => onChange({ ...node, value })} />{(() => { const known = knownVariables(hunt).find(variable => variable.key === node.key); return known && (known.types.size > 1 || !known.types.has(typeof node.value)) ? <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">This variable is assigned with more than one value type. Prefer one consistent type throughout the hunt.</p> : null; })()}</>}
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
