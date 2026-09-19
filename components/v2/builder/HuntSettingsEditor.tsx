'use client';

import type { CheckpointDefinition, HuntDefinition, HuntSettings, HuntTheme } from '@/lib/engine/types';
import { CheckField, Field, inputClass, LocationFields, NumberField, TextField } from './Fields';
import { isoDate, localDate } from './NodeEditor';
import AssetField from './AssetField';

export default function HuntSettingsEditor({ value, onChange }: { value: HuntDefinition; onChange: (value: HuntDefinition) => void }) {
  const settings = value.settings || {};
  const theme = value.theme || {};
  const updateSettings = (update: Partial<HuntSettings>) => onChange({ ...value, settings: { ...settings, ...update } });
  const updateTheme = (update: Partial<HuntTheme>) => onChange({ ...value, theme: { ...theme, ...update } });
  return <details className="rounded-xl border border-slate-200 bg-white p-4">
    <summary className="cursor-pointer py-2 font-semibold">Game rules, schedule, map & appearance</summary>
    <div className="mt-5 space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="How checkpoints unlock"><select className={inputClass} value={settings.mode || 'sequential'} onChange={event => updateSettings({ mode: event.target.value as HuntSettings['mode'] })}><option value="sequential">In checkpoint order</option><option value="open">All available — players choose</option><option value="dependency">After required earlier checkpoints</option></select></Field>
        <Field label="Leaderboard visibility"><select className={inputClass} value={settings.leaderboard || 'live'} onChange={event => updateSettings({ leaderboard: event.target.value as HuntSettings['leaderboard'] })}><option value="live">Live during the hunt</option><option value="hidden">Hidden</option><option value="finish">Only when the team finishes</option></select></Field>
        <Field label="Ranking"><select className={inputClass} value={settings.ranking || 'points'} onChange={event => updateSettings({ ranking: event.target.value as HuntSettings['ranking'] })}><option value="points">Points</option><option value="progress">Checkpoint progress</option><option value="points_time">Points, then completion time</option></select></Field>
        <Field label="Checkpoint map"><select className={inputClass} value={settings.map || 'none'} onChange={event => updateSettings({ map: event.target.value as HuntSettings['map'] })}><option value="none">No map</option><option value="all">Show all configured checkpoint locations</option><option value="visited">Show visited checkpoint locations</option></select></Field>
      </div>
      <TextField label="Rules for players (optional)" value={settings.rules || ''} multiline onChange={rules => { const next = { ...settings }; if (rules) next.rules = rules; else delete next.rules; onChange({ ...value, settings: next }); }} />
      <TextField label="Completion message (optional)" value={settings.completionMessage || ''} multiline onChange={completionMessage => { const next = { ...settings }; if (completionMessage) next.completionMessage = completionMessage; else delete next.completionMessage; onChange({ ...value, settings: next }); }} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Hunt opens (optional)" type="datetime-local" value={localDate(settings.startsAt)} onChange={startsAt => { const next = { ...settings }; if (startsAt) next.startsAt = isoDate(startsAt); else delete next.startsAt; onChange({ ...value, settings: next }); }} />
        <TextField label="Hunt closes (optional)" type="datetime-local" value={localDate(settings.endsAt)} onChange={endsAt => { const next = { ...settings }; if (endsAt) next.endsAt = isoDate(endsAt); else delete next.endsAt; onChange({ ...value, settings: next }); }} />
      </div>
      <p className="text-xs text-slate-500">Opening and closing dates use this browser’s timezone.</p>
      <CheckField label="Allow teams to register" checked={settings.registrationOpen !== false} onChange={registrationOpen => updateSettings({ registrationOpen })} />
      <CheckField label="Limit the number of team members" checked={settings.maxTeamSize !== undefined} onChange={checked => { const next = { ...settings }; if (checked) next.maxTeamSize = 6; else delete next.maxTeamSize; onChange({ ...value, settings: next }); }} />
      {settings.maxTeamSize !== undefined && <NumberField label="Maximum team members" value={settings.maxTeamSize} min={1} max={1000} onChange={maxTeamSize => updateSettings({ maxTeamSize })} />}
      <Field label="Photo retention"><select className={inputClass} value={settings.photoRetention || 'after_verification'} onChange={event => updateSettings({ photoRetention: event.target.value as HuntSettings['photoRetention'] })}><option value="after_verification">Delete after verification</option><option value="after_event">Delete after the event</option><option value="retain">Keep until manually deleted</option></select></Field>
      <div className="space-y-4 border-t border-slate-200 pt-5">
        <h3 className="font-bold">Appearance</h3>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Main color"><input type="color" className={`${inputClass} h-12 p-1`} value={/^#[0-9a-f]{6}$/i.test(theme.primaryColor || '') ? theme.primaryColor : '#115e59'} onChange={event => updateTheme({ primaryColor: event.target.value })} /></Field><Field label="Text style"><select className={inputClass} value={theme.font || 'system'} onChange={event => updateTheme({ font: event.target.value as HuntTheme['font'] })}><option value="system">Simple / system font</option><option value="serif">Storybook / serif</option></select></Field></div>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Action button shape"><select className={inputClass} value={theme.buttonShape || 'rounded'} onChange={event => updateTheme({ buttonShape: event.target.value as HuntTheme['buttonShape'] })}><option value="rounded">Rounded corners</option><option value="pill">Pill</option><option value="square">Square corners</option></select></Field><Field label="Checkpoint icons"><select className={inputClass} value={theme.checkpointIconStyle || 'none'} onChange={event => updateTheme({ checkpointIconStyle: event.target.value as HuntTheme['checkpointIconStyle'] })}><option value="none">No extra icons</option><option value="numbers">Number badges</option><option value="symbols">Location and status symbols</option></select></Field></div>
        <Field label="Success animation" hint="Plays briefly after a successful action and at the finish. Players who request reduced motion always see a still result."><select className={inputClass} value={theme.successAnimation || 'none'} onChange={event => updateTheme({ successAnimation: event.target.value as HuntTheme['successAnimation'] })}><option value="none">Still</option><option value="pulse">Gentle pulse</option><option value="celebrate">Celebration</option></select></Field>
        <AssetField label="Logo image URL (optional)" value={theme.logoUrl || ''} onChange={logoUrl => { const next = { ...theme }; if (logoUrl) next.logoUrl = logoUrl; else delete next.logoUrl; onChange({ ...value, theme: next }); }} />
        <AssetField label="Cover image URL (optional)" value={theme.coverUrl || ''} onChange={coverUrl => { const next = { ...theme }; if (coverUrl) next.coverUrl = coverUrl; else delete next.coverUrl; onChange({ ...value, theme: next }); }} />
        <AssetField label="Background image URL (optional)" value={theme.backgroundUrl || ''} hint="Decorative image behind the page. Text and controls retain a solid background for readability." onChange={backgroundUrl => { const next = { ...theme }; if (backgroundUrl) next.backgroundUrl = backgroundUrl; else delete next.backgroundUrl; onChange({ ...value, theme: next }); }} />
        <CheckField label="Optional vibration feedback" checked={theme.feedback !== false} onChange={feedback => updateTheme({ feedback })} />
      </div>
    </div>
  </details>;
}

function canRequire(hunt: HuntDefinition, sourceId: string, targetId: string): boolean {
  const visited = new Set<string>();
  const reachesSource = (id: string): boolean => {
    if (id === sourceId) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return Boolean(hunt.checkpoints.find(checkpoint => checkpoint.id === id)?.prerequisites?.some(reachesSource));
  };
  return !reachesSource(targetId);
}

export function CheckpointSettingsEditor({ value, hunt, onChange }: { value: CheckpointDefinition; hunt: HuntDefinition; onChange: (value: CheckpointDefinition) => void }) {
  return <details className="rounded-lg border border-slate-200 bg-slate-50 p-4">
    <summary className="cursor-pointer py-2 text-sm font-semibold">Location, optional checkpoints & scoring rules</summary>
    <div className="mt-4 space-y-4">
      <CheckField label="This checkpoint is required to finish the hunt" checked={value.required !== false} onChange={required => onChange({ ...value, required })} />
      <TextField label="Group or stage (optional)" value={value.group || ''} onChange={group => { const next = { ...value }; if (group) next.group = group; else delete next.group; onChange(next); }} />
      {hunt.settings?.mode === 'dependency' && hunt.checkpoints.length > 1 && <fieldset className="rounded-lg border border-slate-200 bg-white p-3"><legend className="px-1 text-sm font-semibold">Complete these checkpoints first</legend>{hunt.checkpoints.filter(checkpoint => checkpoint.id !== value.id).map(checkpoint => <CheckField key={checkpoint.id} label={checkpoint.title} checked={value.prerequisites?.includes(checkpoint.id) || false} disabled={!canRequire(hunt, value.id, checkpoint.id)} onChange={checked => onChange({ ...value, prerequisites: checked ? [...(value.prerequisites || []), checkpoint.id] : value.prerequisites?.filter(id => id !== checkpoint.id) })} />)}</fieldset>}
      <CheckField label="Give this checkpoint a map location" checked={Boolean(value.location)} onChange={checked => { const next = { ...value }; if (checked) next.location = { latitude: 0, longitude: 0, radiusMeters: 75 }; else delete next.location; onChange(next); }} />
      {value.location && <LocationFields value={value.location} onChange={location => onChange({ ...value, location: { ...location, radiusMeters: location.radiusMeters! } })} />}
      <div className="grid gap-4 sm:grid-cols-2"><NumberField label="Wrong-attempt penalty" value={value.wrongAttemptPenalty || 0} min={0} max={1000000} onChange={wrongAttemptPenalty => onChange({ ...value, wrongAttemptPenalty })} hint="Points deducted for an unsuccessful verification attempt. Zero allows free retries." /><NumberField label="Skip penalty" value={value.skipPenalty || 0} min={0} max={1000000} onChange={skipPenalty => onChange({ ...value, skipPenalty })} /></div>
      <CheckField label="Award a bonus for finishing quickly" checked={Boolean(value.timeBonus)} onChange={checked => { const next = { ...value }; if (checked) next.timeBonus = { withinSeconds: 300, points: 5 }; else delete next.timeBonus; onChange(next); }} />
      {value.timeBonus && <div className="grid gap-4 sm:grid-cols-2"><NumberField label="Finish within (seconds)" value={value.timeBonus.withinSeconds} min={1} max={31536000} onChange={withinSeconds => onChange({ ...value, timeBonus: { ...value.timeBonus!, withinSeconds } })} /><NumberField label="Bonus points" value={value.timeBonus.points} min={0} max={1000000} onChange={points => onChange({ ...value, timeBonus: { ...value.timeBonus!, points } })} /></div>}
    </div>
  </details>;
}
