'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { newRequestId, V3RequestError, v3Request } from './api';
import type { HuntSummary, RegistrationMode, TeamSessionSummary } from './types';
import { cardStyle, inputStyle, primaryButton } from './ui';

type Intent = 'create' | 'join' | 'claim';

export function resolveLinkedHuntId(hunts: HuntSummary[], linked: string | null) {
  if (!linked) return hunts[0]?.id ?? '';
  const matches = hunts.filter(hunt => hunt.id === linked || hunt.slug === linked);
  return matches.length === 1 ? matches[0].id : '';
}

function intentFor(mode: RegistrationMode, preferred: Intent, registrationOpen: boolean): Intent {
  if (mode === 'rostered') return 'claim';
  if (mode === 'organizer-assigned') return 'join';
  if (!registrationOpen) return 'join';
  return preferred === 'claim' ? 'create' : preferred;
}

export default function Registration({ onRegistered }: { onRegistered: (summary: TeamSessionSummary) => void }) {
  const [hunts, setHunts] = useState<HuntSummary[]>([]);
  const [huntId, setHuntId] = useState('');
  const [preferredIntent, setPreferredIntent] = useState<Intent>('create');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pendingRequestId = useRef<string | null>(null);

  const selected = useMemo(() => hunts.find(hunt => hunt.id === huntId), [huntId, hunts]);
  const registrationMode = selected?.registrationMode ?? 'self-serve';
  const intent = intentFor(registrationMode, preferredIntent, selected?.registrationOpen !== false);

  const loadHunts = async () => {
    setLoading(true);
    try {
      const result = await v3Request<{ hunts: HuntSummary[] }>('/api/v3/hunts');
      setHunts(result.hunts);
      const linked = new URLSearchParams(window.location.search).get('hunt');
      const resolved = resolveLinkedHuntId(result.hunts, linked);
      setHuntId(current => current || resolved);
      setError(linked && !resolved
        ? 'This event link is invalid or ambiguous. Choose the event manually or ask the organizer for a fresh QR code.'
        : '');
    } catch (requestError) {
      setError(requestError instanceof V3RequestError ? requestError.message : 'The event list could not be loaded. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadHunts(); }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || busy) return;
    const form = new FormData(event.currentTarget);
    const otherMembers = String(form.get('otherMembers') ?? '').split('\n').map(value => value.trim()).filter(Boolean);
    setBusy(true);
    setError('');
    const requestId = pendingRequestId.current ?? newRequestId();
    pendingRequestId.current = requestId;
    try {
      const result = await v3Request<{ summary: TeamSessionSummary }>('/api/v3/session', {
        method: 'POST',
        body: JSON.stringify({
          requestId,
          huntId: selected.id,
          intent,
          playerName: form.get('playerName'),
          pin: form.get('pin'),
          ...(intent === 'create' ? {
            teamName: form.get('teamName'),
            ...(otherMembers.length ? { memberNames: otherMembers } : {}),
          } : { teamCode: form.get('teamCode') }),
          memberPin: form.get('memberPin'),
        }),
      });
      pendingRequestId.current = null;
      onRegistered(result.summary);
    } catch (requestError) {
      if (requestError instanceof V3RequestError && requestError.status !== 408 && requestError.status < 500) {
        pendingRequestId.current = null;
      }
      setError(requestError instanceof V3RequestError ? requestError.message : 'Registration was interrupted. Submit the same details again to recover safely.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="mx-auto max-w-xl pb-12">
    <section className="pb-7 pt-5 sm:pt-10">
      <p className="text-xs font-extrabold uppercase tracking-[0.24em] text-emerald-800">Treasure Hunt V3</p>
      <h1 className="mt-3 text-4xl font-black leading-[1.05] tracking-tight text-stone-950 sm:text-5xl">Your crew.<br />A fresh run.</h1>
      <p className="mt-4 max-w-lg text-base leading-relaxed text-stone-600">Join with your own identity so every solve, discovery, and clutch finish can be credited to the right teammate.</p>
    </section>

    <form onSubmit={submit} className={`${cardStyle} space-y-5`}>
      <label htmlFor="v3-hunt" className="block text-sm font-bold text-stone-800">Choose your hunt
        <select id="v3-hunt" value={huntId} onChange={event => setHuntId(event.target.value)} required disabled={busy || loading} className={inputStyle}>
          {!hunts.length && <option value="">{loading ? 'Finding live hunts…' : 'No hunts are open yet'}</option>}
          {hunts.map(hunt => <option key={hunt.id} value={hunt.id}>{hunt.title}</option>)}
        </select>
      </label>

      {selected && <div className="rounded-2xl bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-950">
        {registrationMode === 'self-serve' && (selected.registrationOpen ? <><strong>Open team registration.</strong> Create a new crew or join one with its official team code. Once the organizer approves a crew, only its already-declared names may join.</> : <><strong>New team registration is closed.</strong> Existing declared crew members can still join with their official team code.</>)}
        {registrationMode === 'organizer-assigned' && <><strong>Organizer-assigned teams.</strong> Use the team code and team PIN from your organizer, then choose your own private member PIN. Every teammate must join before the team starts its first run.</>}
        {registrationMode === 'rostered' && <><strong>Rostered event.</strong> Claim your listed identity using the team code, team PIN, your personal claim PIN, and the same name the organizer entered.</>}
      </div>}

      {registrationMode === 'self-serve' && <div className="grid grid-cols-2 gap-2 rounded-2xl bg-stone-100 p-1.5" aria-label="Registration choice">
        <button type="button" aria-pressed={intent === 'create'} onClick={() => setPreferredIntent('create')} disabled={busy || !selected?.registrationOpen} className={`min-h-11 rounded-xl px-3 text-sm font-bold ${intent === 'create' ? 'bg-white text-emerald-950 shadow-sm' : 'text-stone-600 disabled:opacity-40'}`}>Create a team</button>
        <button type="button" aria-pressed={intent === 'join'} onClick={() => setPreferredIntent('join')} disabled={busy} className={`min-h-11 rounded-xl px-3 text-sm font-bold ${intent === 'join' ? 'bg-white text-emerald-950 shadow-sm' : 'text-stone-600'}`}>Join a team</button>
      </div>}

      {intent === 'create' ? <>
        <label htmlFor="v3-team-name" className="block text-sm font-bold text-stone-800">Team nickname <span className="font-normal text-stone-500">(optional)</span>
          <input id="v3-team-name" name="teamName" maxLength={40} autoComplete="organization" disabled={busy} className={inputStyle} placeholder="Falcons" />
          <span className="mt-2 block text-xs font-normal leading-relaxed text-stone-500">Keep it recognizable. Your official code stays the team’s permanent identity even if the organizer changes this nickname.</span>
        </label>
      </> : <label htmlFor="v3-team-code" className="block text-sm font-bold text-stone-800">Official team code
        <input id="v3-team-code" name="teamCode" required maxLength={20} autoCapitalize="characters" autoComplete="off" disabled={busy} className={`${inputStyle} font-mono font-bold uppercase tracking-[0.12em]`} placeholder="T-014" />
      </label>}

      <label htmlFor="v3-player-name" className="block text-sm font-bold text-stone-800">{intent === 'claim' ? 'Your rostered name' : 'Your name'}
        <input id="v3-player-name" name="playerName" required maxLength={60} autoComplete="name" disabled={busy} className={inputStyle} placeholder={intent === 'claim' ? 'Exactly as shown on the roster' : 'Aarav'} />
      </label>

      {intent === 'create' && <label htmlFor="v3-other-members" className="block text-sm font-bold text-stone-800">Other crew members <span className="font-normal text-stone-500">(optional)</span>
        <textarea id="v3-other-members" name="otherMembers" rows={3} disabled={busy} className={inputStyle} placeholder="One name per line" />
        <span className="mt-2 block text-xs font-normal text-stone-500">Declare every teammate now. Organizer approval locks this list; each person should later join on their own device so contributions are authenticated.</span>
      </label>}

      <label htmlFor="v3-pin" className="block text-sm font-bold text-stone-800">Team PIN
        <input id="v3-pin" name="pin" type="password" inputMode="numeric" pattern="[0-9]{6,12}" minLength={6} maxLength={12} required autoComplete={intent === 'create' ? 'new-password' : 'current-password'} disabled={busy} className={inputStyle} placeholder="6 to 12 digits" />
      </label>

      <label htmlFor="v3-member-pin" className="block text-sm font-bold text-stone-800">{intent === 'claim' ? 'Personal claim PIN' : registrationMode === 'organizer-assigned' || intent === 'create' ? 'Choose your personal member PIN' : 'Choose or enter your personal member PIN'}
        <input id="v3-member-pin" name="memberPin" type="password" inputMode="numeric" pattern="[0-9]{6,12}" minLength={6} maxLength={12} required autoComplete="one-time-code" disabled={busy} className={inputStyle} placeholder="Your private 6-digit code" />
        <span className="mt-2 block text-xs font-normal text-stone-500">{registrationMode === 'rostered'
          ? 'Use the private claim PIN issued for your rostered name. It must differ from the shared team PIN.'
          : intent !== 'create'
            ? 'On your first join, this becomes your private rejoin PIN. Use the same PIN later, and do not reuse the shared team PIN.'
            : 'This identifies you—not just your team—so another teammate cannot claim your contributions. It must differ from the shared team PIN.'}</span>
      </label>

      {error && <p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950">{error}</p>}
      <button type="submit" disabled={busy || !selected} className={primaryButton}>{busy ? 'Checking your crew…' : intent === 'create' ? 'Create crew' : intent === 'claim' ? 'Claim my roster place' : 'Join this crew'}</button>
      {!hunts.length && !loading && <button type="button" onClick={() => void loadHunts()} className="min-h-11 w-full text-sm font-bold text-emerald-900 underline">Refresh available hunts</button>}
    </form>
  </div>;
}
