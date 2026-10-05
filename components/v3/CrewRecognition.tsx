'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { newRequestId, V3RequestError, v3Request } from './api';
import {
  contributionLabels,
  peerCategoryLabels,
  peerSubtypeLabels,
  type ContributionCategory,
  type PeerRecognitionCategory,
  type PeerRecognitionSubtype,
  type RecognitionView,
  type VisibleRecognitionResult,
} from './types';
import { cardStyle, primaryButton, secondaryButton } from './ui';

const categories = Object.keys(peerCategoryLabels) as PeerRecognitionCategory[];

function strongestCategory(credits: Record<ContributionCategory, number>): ContributionCategory {
  return (Object.keys(credits) as ContributionCategory[]).reduce((best, category) => credits[category] > credits[best] ? category : best, 'team_spark');
}

function ResultLayers({ result, own }: { result: VisibleRecognitionResult; own: boolean }) {
  return <article className={`rounded-2xl border p-4 ${own ? 'border-emerald-300 bg-emerald-50' : 'border-stone-200 bg-stone-50'}`}>
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-wide text-stone-500">{own ? 'Your crew title' : 'Crew title'}</p><h4 className="mt-1 text-xl font-black text-stone-950">{result.headlineTitle}</h4></div>
      <span aria-hidden="true" className="text-2xl">✦</span>
    </div>
    <dl className="mt-4 space-y-3 text-sm">
      <div><dt className="font-bold text-stone-900">Verified achievement</dt><dd className="mt-0.5 text-stone-600">{result.dataAchievement.title}{result.dataAchievement.evidenceCount ? ` · ${result.dataAchievement.evidenceCount} confirmed moments` : ''}</dd></div>
      <div><dt className="font-bold text-stone-900">Celebrated by the crew</dt><dd className="mt-0.5 text-stone-600">{result.peerRecognition ? `${result.peerRecognition.title}${result.peerRecognition.explanation ? ` — ${result.peerRecognition.explanation}` : ''}` : 'Waiting for an optional teammate kudos.'}</dd></div>
      {result.organizerExplanation && <div><dt className="font-bold text-stone-900">Organizer note</dt><dd className="mt-0.5 text-stone-600">{result.organizerExplanation}</dd></div>}
    </dl>
  </article>;
}

function RecognitionVoteFlow({ view, runId, onSaved }: { view: RecognitionView; runId: string; onSaved: () => Promise<void> }) {
  const voting = view.voting;
  const [category, setCategory] = useState<PeerRecognitionCategory | null>(voting?.ownVote?.category ?? null);
  const [teammate, setTeammate] = useState(voting?.ownVote?.recipientMemberId ?? '');
  const [subtype, setSubtype] = useState<PeerRecognitionSubtype | null>(voting?.ownVote?.subtype ?? null);
  const [editing, setEditing] = useState(!voting?.ownVote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  if (!voting?.enabled) return null;

  const selectCategory = (value: PeerRecognitionCategory) => {
    setCategory(value);
    setSubtype(null);
  };
  const options = category ? voting.options[category] ?? [] : [];
  const chosenMember = voting.teammates.find(member => member.teamMemberId === teammate);

  const submit = async () => {
    if (!category || !teammate || !subtype || busy) return;
    setBusy(true);
    setError('');
    try {
      await v3Request('/api/v3/recognition', {
        method: 'POST',
        body: JSON.stringify({ runId, requestId: newRequestId(), recipientMemberId: teammate, category, subtype }),
      });
      setSaved(true);
      setEditing(false);
      await onSaved();
    } catch (requestError) {
      setError(requestError instanceof V3RequestError ? requestError.message : 'Your kudos could not be saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!voting.open) return <p className="rounded-2xl bg-stone-100 p-4 text-sm text-stone-600">The crew-recognition window is closed. The titles above keep the verified result.</p>;
  if (!voting.teammates.length) return <p className="rounded-2xl bg-stone-100 p-4 text-sm text-stone-600">Kudos becomes available when another signed-in teammate is on the run roster.</p>;
  if (!editing) return <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
    <p className="font-bold text-violet-950">{saved ? 'Your crew kudos is saved.' : 'You celebrated a teammate.'}</p>
    <p className="mt-1 text-sm text-violet-800">{chosenMember?.displayName}{subtype ? ` · ${peerSubtypeLabels[subtype]}` : ''}</p>
    <button type="button" onClick={() => { setEditing(true); setSaved(false); }} className="mt-3 min-h-11 text-sm font-bold text-violet-950 underline">Update before the window closes</button>
  </div>;

  const step = !category ? 1 : !teammate ? 2 : 3;
  return <div className="rounded-3xl border border-violet-200 bg-violet-50/70 p-5">
    <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-black text-violet-950">Celebrate your crew</h3><span className="text-xs font-bold text-violet-700">Step {step} of 3</span></div>
    <p className="mt-1 text-sm leading-relaxed text-violet-800">One optional, private kudos. You cannot vote for yourself, and no answer is public.</p>

    <fieldset className="mt-5"><legend className="text-sm font-bold text-stone-900">1. What strength stood out?</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">{categories.map(item => <button type="button" key={item} aria-pressed={category === item} onClick={() => selectCategory(item)} className={`min-h-16 rounded-2xl border p-3 text-left text-sm ${category === item ? 'border-violet-700 bg-white ring-2 ring-violet-200' : 'border-violet-200 bg-white/70'}`}><span aria-hidden="true" className="mr-2">{peerCategoryLabels[item].icon}</span><strong>{peerCategoryLabels[item].title}</strong><span className="mt-1 block text-xs leading-relaxed text-stone-500">{peerCategoryLabels[item].prompt}</span></button>)}</div>
    </fieldset>

    {category && <fieldset className="mt-5"><legend className="text-sm font-bold text-stone-900">2. Who deserves it?</legend>
      <div className="mt-2 flex flex-wrap gap-2">{voting.teammates.map(member => <button type="button" key={member.teamMemberId} aria-pressed={teammate === member.teamMemberId} onClick={() => setTeammate(member.teamMemberId)} className={`min-h-11 rounded-full border px-4 text-sm font-bold ${teammate === member.teamMemberId ? 'border-violet-800 bg-violet-900 text-white' : 'border-violet-200 bg-white text-stone-800'}`}>{member.displayName}</button>)}</div>
    </fieldset>}

    {category && teammate && <fieldset className="mt-5"><legend className="text-sm font-bold text-stone-900">3. What did {chosenMember?.displayName ?? 'they'} do best?</legend>
      <div className="mt-2 grid gap-2">{options.map(item => <button type="button" key={item} aria-pressed={subtype === item} onClick={() => setSubtype(item)} className={`min-h-12 rounded-2xl border px-4 py-3 text-left text-sm font-bold ${subtype === item ? 'border-violet-700 bg-white ring-2 ring-violet-200' : 'border-violet-200 bg-white/70'}`}>{peerSubtypeLabels[item]}</button>)}</div>
    </fieldset>}

    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <button type="button" disabled={!category || !teammate || !subtype || busy} onClick={() => void submit()} className={`${primaryButton} mt-5 !bg-violet-950 hover:!bg-violet-900`}>{busy ? 'Saving kudos…' : voting.ownVote ? 'Update private kudos' : 'Save private kudos'}</button>
  </div>;
}

export default function CrewRecognition({ runId, currentMemberId, onOwnResult }: {
  runId: string;
  currentMemberId: string;
  onOwnResult?: (result: VisibleRecognitionResult | null) => void;
}) {
  const [scope, setScope] = useState<'run' | 'all'>('run');
  const [view, setView] = useState<RecognitionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const next = await v3Request<RecognitionView>(`/api/v3/recognition?runId=${encodeURIComponent(runId)}&scope=${scope}`);
      setView(next);
      setError('');
      onOwnResult?.(next.results.find(result => result.memberId === currentMemberId) ?? null);
    } catch (requestError) {
      setError(requestError instanceof V3RequestError ? requestError.message : 'Crew recognition could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [currentMemberId, onOwnResult, runId, scope]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  const positives = useMemo(() => (view?.standings ?? []).filter(standing => standing.totalCredit > 0), [view]);
  if (loading && !view) return <section className={cardStyle}><p role="status" className="text-sm text-stone-500">Building your private crew board…</p></section>;
  if (error && !view) return <section className={cardStyle}><p role="alert" className="text-sm text-amber-800">{error}</p><button type="button" onClick={() => void load()} className={`${secondaryButton} mt-4`}>Try crew board again</button></section>;
  if (!view?.enabled) return null;

  return <section className={cardStyle} aria-labelledby="crew-board-heading">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-extrabold uppercase tracking-[0.18em] text-violet-700">Private to your team</p><h2 id="crew-board-heading" className="mt-1 text-2xl font-black tracking-tight">Crew Contribution Board</h2></div>
      <div className="flex rounded-xl bg-stone-100 p-1 text-xs font-bold">
        <button type="button" aria-pressed={scope === 'run'} onClick={() => setScope('run')} className={`min-h-10 rounded-lg px-3 ${scope === 'run' ? 'bg-white shadow-sm' : 'text-stone-500'}`}>This run</button>
        <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')} className={`min-h-10 rounded-lg px-3 ${scope === 'all' ? 'bg-white shadow-sm' : 'text-stone-500'}`}>All team runs</button>
      </div>
    </div>
    <p className="mt-3 text-sm leading-relaxed text-stone-600">Only verified actions earn credit. This board celebrates positive contributions; failed attempts and peer-vote identities are never shown.</p>

    {positives.length ? <ol className="mt-5 space-y-2">{positives.map(standing => {
      const strongest = strongestCategory(standing.categoryCredits);
      return <li key={standing.teamMemberId} className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-stone-50 p-3">
        <span aria-label={`Rank ${standing.rank}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-950 font-black text-white">{standing.rank}</span>
        <div className="min-w-0 flex-1"><p className="truncate font-bold text-stone-950">{standing.displayName}{standing.teamMemberId === currentMemberId ? ' · You' : ''}</p><p className="text-xs text-stone-500">{contributionLabels[strongest]} · {standing.evidenceCount} confirmed moments</p></div>
        <strong className="shrink-0 text-sm text-emerald-900">{standing.totalCredit} credit</strong>
      </li>;
    })}</ol> : <p className="mt-5 rounded-2xl bg-stone-100 p-4 text-sm text-stone-600">Your verified crew moments will appear here as the server confirms them.</p>}

    {!!view.results.length && <div className="mt-6 space-y-3"><h3 className="text-sm font-black uppercase tracking-wide text-stone-500">Recognition cards</h3>{view.results.map(result => <ResultLayers key={result.memberId} result={result} own={result.memberId === currentMemberId} />)}</div>}
    <div className="mt-6"><RecognitionVoteFlow view={view} runId={runId} onSaved={load} /></div>
  </section>;
}
