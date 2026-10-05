'use client';

import { useRef, useState } from 'react';
import { newRequestId } from '../api';
import { adminRequest } from './client';
import type { AdminHunt } from './types';
import { inputClass, panelClass, primaryButton, secondaryButton, SectionHeading } from './ui';

type RunOperation = (key: string, operation: () => Promise<void>) => Promise<void>;
type CreatedTeam = {
  teamId: string;
  code: string;
  displayName: string | null;
  pin: string;
  memberCredentials: Array<{ name: string; claimPin: string }>;
};

function credentialsText(team: CreatedTeam) {
  return [
    `${team.code}${team.displayName ? ` · ${team.displayName}` : ''}`,
    `Team PIN: ${team.pin}`,
    ...team.memberCredentials.map(member => `${member.name}: ${member.claimPin}`),
  ].join('\n');
}

export function organizerTeamCreationAvailability(hunt: Pick<AdminHunt, 'status' | 'registrationOpen'>) {
  if (!['ready', 'live', 'paused'].includes(hunt.status)) {
    return { allowed: false, message: 'Team creation is unavailable after this event has ended.' };
  }
  if (hunt.registrationOpen === false) {
    return { allowed: false, message: 'Team creation is closed. Reopen it in Event lifecycle; existing teams can still join and check in.' };
  }
  return { allowed: true, message: '' };
}

export default function RosterPanel({ hunt, pending, run, onRefresh, notify }: {
  hunt: AdminHunt;
  pending: string;
  run: RunOperation;
  onRefresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [teamPin, setTeamPin] = useState('');
  const [members, setMembers] = useState('');
  const [created, setCreated] = useState<CreatedTeam | null>(null);
  const pendingRequest = useRef<{ fingerprint: string; requestId: string } | null>(null);
  if (hunt.registrationMode === 'self-serve') return null;

  const names = members.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const isRostered = hunt.registrationMode === 'rostered';
  const creationAvailability = organizerTeamCreationAvailability(hunt);
  const creationWindowOpen = creationAvailability.allowed;
  const submittedNames = isRostered ? names : [];
  const download = () => {
    if (!created) return;
    const url = URL.createObjectURL(new Blob([credentialsText(created)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${created.code.toLowerCase()}-private-credentials.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <section className={`${panelClass} p-5 sm:p-6`}>
    <SectionHeading eyebrow="Registration operations" title={isRostered ? 'Create a rostered team' : 'Create an assigned team'} detail={isRostered
      ? 'Enter or import the member roster. The server creates a canonical team code, team PIN, and a different private claim PIN for every person.'
      : 'Create the team before play. Share its canonical code and team PIN; each player chooses a private member PIN on their first join.'} actions={<button type="button" className={secondaryButton} disabled={!open && !creationWindowOpen} onClick={() => setOpen(value => !value)}>{open ? 'Close setup' : 'Add team'}</button>} />
    {!creationWindowOpen && <p role="status" className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm leading-6 text-amber-100">{creationAvailability.message}</p>}
    {open && <form className="mt-5 grid gap-4 lg:grid-cols-2" onSubmit={event => {
      event.preventDefault();
      if (!creationWindowOpen) return;
      void run('create-team', async () => {
        const fingerprint = JSON.stringify({ huntId: hunt.id, displayName: displayName.trim() || null, memberNames: submittedNames, pin: teamPin || null });
        const requestId = pendingRequest.current?.fingerprint === fingerprint
          ? pendingRequest.current.requestId
          : newRequestId();
        pendingRequest.current = { fingerprint, requestId };
        const result = await adminRequest<CreatedTeam>('/api/v3/admin/control', 'POST', {
          action: 'create_team',
          requestId,
          huntId: hunt.id,
          displayName: displayName.trim() || null,
          memberNames: submittedNames,
          ...(teamPin ? { pin: teamPin } : {}),
        });
        pendingRequest.current = null;
        setCreated(result);
        setDisplayName(''); setTeamPin(''); setMembers('');
        notify(`${result.code} created. Save the private credentials before closing this page.`);
        await onRefresh();
      });
    }}>
      <label className="text-sm font-bold text-slate-200">Display name <span className="font-normal text-slate-500">(optional)</span><input className={`${inputClass} mt-2`} disabled={!creationWindowOpen || Boolean(pending)} maxLength={40} value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Falcons" /></label>
      <label className="text-sm font-bold text-slate-200">Team PIN <span className="font-normal text-slate-500">(optional)</span><input className={`${inputClass} mt-2`} disabled={!creationWindowOpen || Boolean(pending)} inputMode="numeric" pattern="[0-9]{6,12}" minLength={6} maxLength={12} value={teamPin} onChange={event => setTeamPin(event.target.value.replace(/\D/g, ''))} placeholder="6–12 digits; generated if blank" /></label>
      {isRostered && <label className="text-sm font-bold text-slate-200 lg:col-span-2">Members, one per line<textarea className={`${inputClass} mt-2`} disabled={!creationWindowOpen || Boolean(pending)} required rows={6} value={members} onChange={event => setMembers(event.target.value)} placeholder={'Aarav\nPriya\nRohan'} /></label>}
      {isRostered && <label className="text-xs font-bold text-slate-400 lg:col-span-2">Import a single-column member file (.txt or .csv)<input type="file" disabled={!creationWindowOpen || Boolean(pending)} accept=".txt,.csv,text/plain,text/csv" className="mt-2 block w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-slate-800 file:px-4 file:font-bold file:text-white disabled:opacity-50" onChange={event => {
        const file = event.target.files?.[0];
        if (!file) return;
        void file.text().then(text => setMembers(text.split(/\r?\n/).map(line => line.replace(/^\s*"|"\s*$/g, '').trim()).filter(Boolean).join('\n')));
      }} /></label>}
      <div className="lg:col-span-2"><button className={primaryButton} disabled={!creationWindowOpen || Boolean(pending) || (isRostered && names.length === 0)}>{pending === 'create-team' ? 'Creating secure team…' : 'Create team & credentials'}</button></div>
    </form>}
    {created && <div className="mt-5 rounded-2xl border border-amber-300/30 bg-amber-300/[0.07] p-4">
      <p className="font-black text-amber-100">Save these private credentials now</p>
      <p className="mt-1 text-xs leading-5 text-amber-100/70">The database stores one-way PIN hashes. An exact network retry safely recovers the same creation response; save it now{created.memberCredentials.length ? ' and send each personal PIN only to its named player.' : '. Players will create their own private PIN when they first join.'}</p>
      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-black/30 p-3 text-sm text-white">{credentialsText(created)}</pre>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={primaryButton} onClick={download}>Download credentials</button><button type="button" className={secondaryButton} onClick={() => void navigator.clipboard.writeText(credentialsText(created)).then(() => notify('Private credentials copied.'))}>Copy</button><button type="button" className={secondaryButton} onClick={() => setCreated(null)}>I saved them</button></div>
    </div>}
  </section>;
}
