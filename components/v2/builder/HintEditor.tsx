'use client';

import { useState } from 'react';
import type { DisplayContent, FlowNode, HintContent, HintDefinition } from '@/lib/engine/types';
import { buttonClass, CheckField, Field, inputClass, LocationFields, NumberField, TextField } from './Fields';
import { moveItem, newId, nodeLabels } from './model';
import PuzzleEditor from './PuzzleEditor';
import { defaultPuzzle } from './puzzleDefaults';
import AssetField from './AssetField';

export function defaultContent(type: HintContent['type']): HintContent {
  switch (type) {
    case 'text': return { type, text: '' };
    case 'image': return { type, url: '', alt: '' };
    case 'map': return { type, latitude: 0, longitude: 0, radiusMeters: 100 };
    case 'audio': case 'video': return { type, url: '', title: '' };
    case 'camera': return { type, description: '' };
    case 'puzzle': return { type, puzzle: defaultPuzzle('text'), reveal: { type: 'text', text: '' } };
    default: throw new Error(`Unsupported content type: ${type}`);
  }
}

export function ContentEditor({ value, onChange, allowPuzzle = true }: { value: HintContent; onChange: (value: HintContent) => void; allowPuzzle?: boolean }) {
  return <div className="space-y-4">
    <Field label="Content type"><select className={inputClass} value={value.type} onChange={event => onChange(defaultContent(event.target.value as HintContent['type']))}>
      <option value="text">Text</option><option value="image">Image</option><option value="map">Map / search area</option>
      <option value="audio">Audio</option><option value="video">Video</option><option value="camera">Camera guidance</option>{allowPuzzle && <option value="puzzle">Puzzle that reveals a hint</option>}
    </select></Field>
    {value.type === 'text' && <TextField label="Text to reveal" value={value.text} multiline onChange={text => onChange({ ...value, text })} />}
    {value.type === 'image' && <>
      <AssetField label="Image URL" value={value.url} onChange={url => onChange({ ...value, url })} hint="Choose an uploaded image, an HTTPS image, or a local asset path." />
      <TextField label="Description for players who cannot see the image" value={value.alt} onChange={alt => onChange({ ...value, alt })} />
    </>}
    {value.type === 'map' && <LocationFields value={value} onChange={location => onChange({ ...value, ...location, radiusMeters: location.radiusMeters! })} />}
    {(value.type === 'audio' || value.type === 'video') && <>
      <AssetField label={`${value.type === 'audio' ? 'Audio' : 'Video'} URL`} kind={value.type} value={value.url} onChange={url => onChange({ ...value, url })} />
      <TextField label="Media title" value={value.title} onChange={title => onChange({ ...value, title })} />
      <TextField label="Transcript / text alternative (optional)" value={value.transcript || ''} multiline onChange={transcript => { const next = { ...value }; if (transcript) next.transcript = transcript; else delete next.transcript; onChange(next); }} />
    </>}
    {value.type === 'camera' && <>
      <TextField label="Guidance instructions" value={value.description} multiline onChange={description => onChange({ ...value, description })} />
      <AssetField label="Reference image URL (optional)" value={value.referenceImageUrl || ''} onChange={referenceImageUrl => {
        const result = { ...value }; if (referenceImageUrl) result.referenceImageUrl = referenceImageUrl; else delete result.referenceImageUrl; onChange(result);
      }} />
      <CheckField label="Include direction to a location" checked={value.latitude !== undefined} onChange={checked => {
        const result = { ...value }; if (checked) { result.latitude = 0; result.longitude = 0; } else { delete result.latitude; delete result.longitude; } onChange(result);
      }} />
      {value.latitude !== undefined && <LocationFields value={{ latitude: value.latitude, longitude: value.longitude ?? 0 }} onChange={location => onChange({ ...value, latitude: location.latitude, longitude: location.longitude })} />}
    </>}
    {value.type === 'puzzle' && <>
      <PuzzleEditor value={value.puzzle} onChange={puzzle => onChange({ ...value, puzzle })} />
      <div className="space-y-3 rounded-lg bg-teal-50 p-3"><h4 className="text-sm font-bold">Reveal after solving</h4><ContentEditor value={value.reveal} allowPuzzle={false} onChange={reveal => onChange({ ...value, reveal: reveal as DisplayContent })} /></div>
    </>}
  </div>;
}

function canDepend(hints: HintDefinition[], sourceId: string, prerequisiteId: string) {
  const visited = new Set<string>();
  const dependsOnSource = (id: string): boolean => {
    if (id === sourceId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return Boolean(hints.find(hint => hint.id === id)?.availability?.afterHintIds?.some(dependsOnSource));
  };
  return !dependsOnSource(prerequisiteId);
}

export default function HintEditor({ value, usedIds, nodes, onChange }: { value: HintDefinition[]; usedIds: string[]; nodes: FlowNode[]; onChange: (value: HintDefinition[]) => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const update = (hint: HintDefinition) => onChange(value.map(candidate => candidate.id === hint.id ? hint : candidate));
  return <section className="space-y-4">
    <div><h3 className="text-lg font-bold">Hints for this checkpoint</h3><p className="mt-1 text-sm leading-6 text-slate-600">Each hint has its own cost. Players choose freely unless you add prerequisites or a delay. A team is charged once per hint.</p></div>
    {value.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">No hints yet. Add content players can reveal when they need help.</p>}
    {value.map((hint, index) => <details key={hint.id} className="rounded-xl border border-slate-200 bg-white p-4" open={expandedId === hint.id} onToggle={event => {
      if (event.currentTarget.open) setExpandedId(hint.id); else setExpandedId(previous => previous === hint.id ? null : previous);
    }}>
      <summary className="cursor-pointer py-2 text-sm font-semibold">{index + 1}. {hint.title || 'New hint'} <span className="font-normal text-slate-500">· {hint.content.type} · {hint.cost ? `${hint.cost} points` : 'free'}</span></summary>
      <div className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_9rem]"><TextField label="Hint title" value={hint.title} onChange={title => update({ ...hint, title })} /><NumberField label="Point cost" value={hint.cost} min={0} max={1000000} onChange={cost => update({ ...hint, cost })} /></div>
        <ContentEditor value={hint.content} onChange={content => update({ ...hint, content })} />
        <NumberField label="Available after this many seconds" value={hint.availability?.afterSeconds || 0} min={0} max={31536000} onChange={afterSeconds => update({ ...hint, availability: { ...hint.availability, afterSeconds } })} hint="Time starts when the team reaches this checkpoint. Zero makes the hint available immediately." />
        <Field label="Available after completing a step (optional)"><select className={inputClass} value={hint.availability?.afterNodeId || ''} onChange={event => {
          const availability = { ...hint.availability }; if (event.target.value) availability.afterNodeId = event.target.value; else delete availability.afterNodeId; update({ ...hint, availability });
        }}><option value="">Any step in the checkpoint</option>{nodes.filter(node => node.type !== 'complete').map((node, index) => <option key={node.id} value={node.id}>{index + 1}. {nodeLabels[node.type] || node.type} ({node.id})</option>)}</select></Field>
        {value.length > 1 && <fieldset className="rounded-lg bg-slate-50 p-3"><legend className="px-1 text-sm font-semibold">Require these hints first (optional)</legend>
          {value.filter(candidate => candidate.id !== hint.id).map(candidate => <CheckField key={candidate.id} label={candidate.title || candidate.id} checked={hint.availability?.afterHintIds?.includes(candidate.id) || false} disabled={!canDepend(value, hint.id, candidate.id)} onChange={checked => {
            const previous = hint.availability?.afterHintIds || [];
            update({ ...hint, availability: { ...hint.availability, afterHintIds: checked ? [...previous, candidate.id] : previous.filter(id => id !== candidate.id) } });
          }} />)}
        </fieldset>}
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          <button type="button" className={buttonClass} disabled={index === 0} onClick={() => onChange(moveItem(value, index, -1))}>Move hint up</button>
          <button type="button" className={buttonClass} disabled={index === value.length - 1} onClick={() => onChange(moveItem(value, index, 1))}>Move hint down</button>
          <button type="button" className={buttonClass} onClick={() => onChange(value.filter(candidate => candidate.id !== hint.id).map(candidate => ({ ...candidate, ...(candidate.availability?.afterHintIds ? { availability: { ...candidate.availability, afterHintIds: candidate.availability.afterHintIds.filter(id => id !== hint.id) } } : {}) })))}>Remove hint</button>
        </div>
      </div>
    </details>)}
    <button type="button" className={buttonClass} onClick={() => { const id = newId('hint', usedIds); onChange([...value, { id, title: '', cost: 2, content: { type: 'text', text: '' } }]); setExpandedId(id); }}>Add hint</button>
  </section>;
}
