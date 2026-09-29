'use client';

import { useEffect, useState } from 'react';
import type { Feedback, GameCommand } from '@/lib/engine/types';
import type { ClientPlayerView } from '../sessionClient';
import { inputStyle, primaryButton } from '../CurrentTask';

export default function SessionLobby({ view, disabled, send }: { view: ClientPlayerView; disabled: boolean; send: (command: GameCommand) => Promise<Feedback | null> }) {
  const [names, setNames] = useState(''), [dirty, setDirty] = useState(false), [revision, setRevision] = useState(view.revision);
  useEffect(() => {
    if (!dirty) { setNames((view.members ?? []).map(member => typeof member === 'string' ? member : member.name ?? member.playerName ?? '').join('\n')); setRevision(view.revision); }
  }, [view.members, view.revision, dirty]);
  const mayStart = view.playability?.code === 'waiting' && view.roster?.ready !== false;
  return <section aria-label="Team lobby" className="space-y-5 rounded-3xl border border-stone-200 bg-white p-6">
    <h2 className="text-2xl font-bold">Get your team ready</h2>
    <p className="text-sm leading-6 text-stone-600">Your clues are hidden and your timer has not started. Enter everyone’s name; they do not need to sign in together. Anyone with the team PIN can edit this roster before starting.</p>
    <label className="block text-sm font-semibold">Team roster — one name per line<textarea aria-label="Team roster" rows={5} className={inputStyle} disabled={disabled} value={names} onChange={event => { setNames(event.target.value); setDirty(true); }} /></label>
    <p className="text-sm text-stone-600">{view.roster?.minimum ?? 1}–{view.roster?.maximum ?? 50} members. Names are declared by your team, not verified identities.</p>
    <button type="button" className="min-h-12 font-semibold text-emerald-900 underline disabled:opacity-40" disabled={disabled || !dirty} onClick={async () => { const result = await send({ type: 'update_roster', expectedRevision: revision, names: names.split('\n').map(name => name.trim()).filter(Boolean) }); if (result?.status === 'accepted') setDirty(false); }}>Save roster</button>
    {dirty && <div className="text-sm text-amber-800"><p>Save roster changes before starting. {revision !== view.revision && 'Another teammate changed this team. Your unsaved names have been kept.'}</p>{revision !== view.revision && <button type="button" className="min-h-12 underline" disabled={disabled} onClick={() => { if (window.confirm('Replace these unsaved names with the latest saved team roster?')) setDirty(false); }}>Reload saved roster</button>}</div>}
    <p className="text-sm leading-6">{view.hunt.settings?.sessionDurationSeconds ? `Start begins your shared ${Math.round(view.hunt.settings.sessionDurationSeconds / 60)}-minute timer immediately. Offline time still counts. New actions stop at zero; the organizer can help if needed.` : 'Start reveals your first clue and locks the team roster.'}</p>
    <button type="button" className={primaryButton} disabled={disabled || dirty || !mayStart} onClick={() => void send({ type: 'start_session', expectedRevision: view.revision })}>Start team hunt</button>
  </section>;
}
