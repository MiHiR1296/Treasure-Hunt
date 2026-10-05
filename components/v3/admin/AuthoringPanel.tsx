'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminRequest, V3AdminRequestError } from './client';
import {
  CASUAL_INTEGRITY_POLICY,
  hasExplicitIntegrityPolicy,
  parseDefinitionForPlayStyle,
  readIntegrityPolicy,
  withIntegrityPolicy,
} from './integrityPolicy';
import PlayStylePanel from './PlayStylePanel';
import type { AuthoringKit, DraftSummary, ValidationIssue } from './types';
import { EmptyState, inputClass, panelClass, primaryButton, secondaryButton, SectionHeading, StatusPill } from './ui';

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const area = document.createElement('textarea');
  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

function validationIssues(draft: DraftSummary | null, local: ValidationIssue[]) {
  return local.length ? local : draft?.validation?.issues || [];
}

function Issues({ issues }: { issues: ValidationIssue[] }) {
  if (!issues.length) return <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-100"><strong>Validation passed.</strong> The draft still needs a human preview before publishing.</div>;
  return <div className="rounded-xl border border-rose-300/20 bg-rose-300/10 p-4 text-rose-100">
    <p className="font-black">{issues.length} issue{issues.length === 1 ? '' : 's'} to fix</p>
    <ol className="mt-3 max-h-64 list-decimal space-y-2 overflow-y-auto pl-5 text-sm">{issues.map((issue, index) => <li key={`${issue.path}-${index}`}><code className="rounded bg-black/20 px-1 py-0.5 text-rose-100">{issue.path}</code><span className="ml-2">{issue.message}</span></li>)}</ol>
  </div>;
}

function DraftPreview({ draft, pending, previewed, onReview, onPublish, onClose }: {
  draft: DraftSummary;
  pending: string;
  previewed: boolean;
  onReview: () => void;
  onPublish: () => void;
  onClose: () => void;
}) {
  const fairness = draft.validation?.fairness;
  const checkpoints = Array.isArray(draft.definition.checkpoints) ? draft.definition.checkpoints.length : 0;
  const title = typeof draft.definition.title === 'string' ? draft.definition.title : draft.title;
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/90 p-4 sm:p-8" role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="draft-preview-title" className={`${panelClass} mx-auto max-w-5xl p-5 sm:p-8`}>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-widest text-cyan-300">Human review gate · revision {draft.revision}</p><h3 id="draft-preview-title" className="mt-2 text-2xl font-black text-white">{title}</h3><p className="mt-2 text-sm text-slate-400">This preview summarizes what will be published. It does not publish or start the hunt.</p></div><button className={secondaryButton} type="button" onClick={onClose}>Close</button></div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/10 p-4"><p className="text-xs text-slate-500">Schema</p><p className="mt-1 text-xl font-black text-white">V{String(draft.definition.schemaVersion ?? '—')}</p></div>
        <div className="rounded-xl border border-white/10 p-4"><p className="text-xs text-slate-500">Checkpoints</p><p className="mt-1 text-xl font-black text-white">{checkpoints}</p></div>
        <div className="rounded-xl border border-white/10 p-4"><p className="text-xs text-slate-500">Routes evaluated</p><p className="mt-1 text-xl font-black text-white">{fairness?.evaluatedRouteCount ?? '—'}</p></div>
        <div className="rounded-xl border border-white/10 p-4"><p className="text-xs text-slate-500">Maximum score</p><p className="mt-1 text-xl font-black text-white">{fairness?.maximumScore ?? '—'}</p></div>
      </div>
      {fairness && <div className="mt-3 rounded-xl border border-white/10 p-4 text-sm text-slate-300"><strong className="text-white">Expected route duration:</strong> {fairness.minimumDurationMinutes ?? '—'}–{fairness.maximumDurationMinutes ?? '—'} minutes <span className="mx-2 text-slate-600">·</span> <StatusPill tone={fairness.valid ? 'good' : 'danger'}>{fairness.valid ? 'Fairness passed' : 'Fairness blocked'}</StatusPill></div>}
      <div className="mt-5"><Issues issues={draft.validation?.issues || []} /></div>
      <details className="mt-5 rounded-xl border border-white/10"><summary className="cursor-pointer px-4 py-3 font-bold text-slate-200">Inspect resolved draft JSON</summary><pre className="max-h-96 overflow-auto border-t border-white/10 bg-black/20 p-4 text-xs leading-5 text-slate-300">{JSON.stringify(draft.definition, null, 2)}</pre></details>
      <div className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4"><p className="font-black text-amber-100">Draft → validation → preview → publish</p><p className="mt-1 text-sm leading-6 text-amber-100/75">Publishing pins an immutable hunt version. Existing runs stay on their version. Review route rules, public-board privacy, scoring, answers, and physical instructions before continuing.</p><label className="mt-3 flex items-start gap-3 text-sm font-bold text-amber-50"><input className="mt-1" type="checkbox" checked={previewed} onChange={onReview} disabled={!draft.validation?.valid || pending === `preview-${draft.id}`} /> {pending === `preview-${draft.id}` ? 'Recording review of this revision…' : 'I reviewed this exact revision and its validation/fairness result.'}</label></div>
      <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" className={secondaryButton} onClick={onClose}>Keep editing</button><button type="button" className={primaryButton} disabled={!draft.validation?.valid || !previewed || Boolean(pending)} onClick={onPublish}>{pending === `publish-${draft.id}` ? 'Publishing…' : 'Publish immutable version'}</button></div>
    </section>
  </div>;
}

function DraftCard({ draft, pending, previewed, onEdit, onPreview, onPublish }: {
  draft: DraftSummary;
  pending: string;
  previewed: boolean;
  onEdit: () => void;
  onPreview: () => void;
  onPublish: () => void;
}) {
  const issueCount = draft.validation?.issues?.length || 0;
  const fairness = draft.validation?.fairness;
  return <article className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-black text-white">{draft.title}</p><p className="mt-1 text-xs text-slate-500">Revision {draft.revision} · {new Date(draft.updatedAt).toLocaleString()}</p></div><StatusPill tone={draft.validation?.valid ? 'good' : 'danger'}>{draft.validation?.valid ? 'Valid draft' : `${issueCount} issue${issueCount === 1 ? '' : 's'}`}</StatusPill></div>
    <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-400"><p>Source <strong className="block text-slate-200">{draft.source || 'builder'}</strong></p><p>Routes checked <strong className="block text-slate-200">{fairness?.evaluatedRouteCount ?? '—'}</strong></p></div>
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" className={secondaryButton} onClick={onEdit}>Edit JSON</button><button type="button" className={secondaryButton} onClick={onPreview}>Preview</button><button type="button" className={secondaryButton} onClick={() => downloadJson(`${String(draft.definition.id || 'hunt')}-v3-draft.json`, draft.definition)}>Download</button><button type="button" className={primaryButton} disabled={!draft.validation?.valid || !previewed || Boolean(pending)} onClick={onPublish}>{pending === `publish-${draft.id}` ? 'Publishing…' : previewed ? 'Publish' : 'Preview first'}</button></div>
  </article>;
}

export default function AuthoringPanel({ active, reportError, notify }: { active: boolean; reportError: (error: unknown) => void; notify: (message: string) => void }) {
  const [kit, setKit] = useState<AuthoringKit | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [publishedVersions, setPublishedVersions] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState('');
  const [problem, setProblem] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [editing, setEditing] = useState<DraftSummary | null>(null);
  const [localIssues, setLocalIssues] = useState<ValidationIssue[]>([]);
  const [previewDraft, setPreviewDraft] = useState<DraftSummary | null>(null);
  const [reviewedRevision, setReviewedRevision] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setProblem('');
    try {
      const [kitResponse, draftResponse, operationsResponse] = await Promise.all([
        adminRequest<AuthoringKit>('/api/v3/authoring-kit'),
        adminRequest<{ drafts: DraftSummary[] }>('/api/v3/admin/drafts'),
        adminRequest<{ hunts?: Array<{ id?: string; version?: number }> }>('/api/v3/admin/live'),
      ]);
      setKit(kitResponse);
      setDrafts(Array.isArray(draftResponse.drafts) ? draftResponse.drafts : []);
      setPublishedVersions(Object.fromEntries((operationsResponse.hunts || [])
        .filter((hunt): hunt is { id: string; version: number } => typeof hunt.id === 'string' && Number.isSafeInteger(hunt.version))
        .map(hunt => [hunt.id, hunt.version])));
    } catch (error) {
      setProblem(error instanceof V3AdminRequestError ? error.message : 'The authoring workspace could not be loaded.');
      reportError(error);
    } finally { setLoading(false); }
  }, [reportError]);

  useEffect(() => { if (active && !kit) void refresh(); }, [active, kit, refresh]);

  const currentIssues = useMemo(() => validationIssues(editing, localIssues), [editing, localIssues]);
  const editorDefinition = useMemo(() => parseDefinitionForPlayStyle(jsonText), [jsonText]);
  const editorIntegrityPolicy = useMemo(
    () => editorDefinition ? readIntegrityPolicy(editorDefinition) : CASUAL_INTEGRITY_POLICY,
    [editorDefinition],
  );
  const revisionKey = (draft: DraftSummary) => `${draft.id}:${draft.revision}:${draft.generation}`;

  const updateIntegrityPolicy = (policy: typeof editorIntegrityPolicy) => {
    if (!editorDefinition) return;
    setJsonText(JSON.stringify(withIntegrityPolicy(editorDefinition, policy), null, 2));
    setLocalIssues([]);
    setReviewedRevision('');
  };

  const parseEditor = () => {
    try {
      const definition = JSON.parse(jsonText) as unknown;
      if (!definition || typeof definition !== 'object' || Array.isArray(definition)) throw new Error('The top level must be a JSON object.');
      setLocalIssues([]);
      return definition as Record<string, unknown>;
    } catch (error) {
      setLocalIssues([{ path: '$', message: error instanceof Error ? error.message : 'Enter valid JSON.' }]);
      return null;
    }
  };

  const save = async () => {
    const definition = parseEditor();
    if (!definition) return;
    setPending('save-draft');
    setProblem('');
    try {
      const response = editing
        ? await adminRequest<{ draft: DraftSummary }>('/api/v3/admin/drafts', 'POST', { draftId: editing.id, revision: editing.revision, generation: editing.generation, definition })
        : await adminRequest<{ draft: DraftSummary }>('/api/v3/admin/import', 'POST', { definition });
      setEditing(response.draft);
      setJsonText(JSON.stringify(response.draft.definition, null, 2));
      setLocalIssues(response.draft.validation?.issues || []);
      setReviewedRevision('');
      await refresh();
      notify(editing ? 'Draft saved and revalidated.' : 'JSON imported as an editable draft. Nothing was published.');
    } catch (error) {
      if (error instanceof V3AdminRequestError) {
        setProblem(error.message);
        setLocalIssues(error.issues);
      }
      reportError(error);
    } finally { setPending(''); }
  };

  const publish = async (draft: DraftSummary) => {
    const key = revisionKey(draft);
    if (reviewedRevision !== key || !draft.validation?.valid) return;
    setPending(`publish-${draft.id}`);
    setProblem('');
    try {
      const definitionId = typeof draft.definition.id === 'string' ? draft.definition.id : draft.huntId || '';
      const expectedVersion = publishedVersions[definitionId];
      const response = await adminRequest<{ definition?: { version?: number }; publicBoardUrl?: string | null }>('/api/v3/admin/publish', 'POST', {
        draftId: draft.id, revision: draft.revision, generation: draft.generation,
        ...(expectedVersion === undefined ? {} : { expectedVersion }),
      });
      notify(`Published ${draft.title}${response.definition?.version ? ` as version ${response.definition.version}` : ''}.`);
      setPreviewDraft(null);
      setReviewedRevision('');
      await refresh();
    } catch (error) {
      if (error instanceof V3AdminRequestError) { setProblem(error.message); setLocalIssues(error.issues); }
      reportError(error);
    } finally { setPending(''); }
  };

  const acknowledgePreview = async (draft: DraftSummary) => {
    const key = revisionKey(draft);
    if (reviewedRevision === key) { setReviewedRevision(''); return; }
    setPending(`preview-${draft.id}`);
    setProblem('');
    try {
      await adminRequest('/api/v3/admin/preview', 'POST', {
        draftId: draft.id, revision: draft.revision, generation: draft.generation,
      });
      setReviewedRevision(key);
      notify('Review recorded for this exact draft revision.');
    } catch (error) {
      if (error instanceof V3AdminRequestError) setProblem(error.message);
      reportError(error);
    } finally { setPending(''); }
  };

  return <div className="space-y-5">
    <section className={`${panelClass} p-5 sm:p-6`}>
      <SectionHeading eyebrow="External AI, safe import" title="AI authoring kit" detail="Use Codex or another external assistant to create or repair the JSON. This website sends nothing to an AI provider, and imported content always lands as an editable draft." actions={<button type="button" className={secondaryButton} disabled={loading} onClick={() => void refresh()}>{loading ? 'Loading…' : 'Refresh kit'}</button>} />
      {problem && <p role="alert" className="mt-4 rounded-xl border border-rose-300/20 bg-rose-300/10 p-3 text-sm text-rose-100">{problem}</p>}
      {kit && <div className="mt-5 grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="space-y-3">
          <a className={`${secondaryButton} w-full`} href={kit.schemaUrl} download>Download V3 JSON Schema</a>
          <a className={`${secondaryButton} w-full`} href={kit.starterUrl} download>Download starter JSON</a>
          <a className={`${secondaryButton} w-full`} href={kit.annotatedExampleUrl} download>Open annotated example</a>
          <button type="button" className={`${primaryButton} w-full`} onClick={() => void copyText(kit.prompt).then(() => notify('AI authoring prompt copied.'))}>Copy Codex prompt</button>
          <p className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3 text-xs leading-5 text-amber-100">{kit.warning}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs font-black uppercase tracking-widest text-cyan-300">Ready-to-copy prompt</p><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-300">{kit.prompt}</pre></div>
      </div>}
      {kit && <ol className="mt-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">{kit.workflow.map((step, index) => <li key={`${step}-${index}`} className="rounded-xl border border-white/10 p-3 text-xs text-slate-300"><span className="mb-2 grid h-6 w-6 place-items-center rounded-full bg-cyan-300 font-black text-slate-950">{index + 1}</span>{step}</li>)}</ol>}
    </section>

    <section className={`${panelClass} p-5 sm:p-6`}>
      <SectionHeading title={editing ? `Edit ${editing.title}` : 'Import hunt JSON'} detail={editing ? `Saving updates draft revision ${editing.revision}; it never mutates a published version or an active run.` : 'Paste a complete V3 definition or choose a JSON file. Validation returns exact field paths.'} actions={editing ? <button type="button" className={secondaryButton} onClick={() => { setEditing(null); setJsonText(''); setLocalIssues([]); }}>New import</button> : undefined} />
      <PlayStylePanel
        disabled={!editorDefinition || Boolean(pending)}
        explicit={editorDefinition ? hasExplicitIntegrityPolicy(editorDefinition) : false}
        policy={editorIntegrityPolicy}
        onChange={updateIntegrityPolicy}
      />
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
        <div>
          <label className="text-sm font-bold text-slate-200">V3 JSON<textarea className={`${inputClass} mt-2 min-h-[28rem] resize-y font-mono text-xs leading-5`} spellCheck={false} value={jsonText} onChange={event => { setJsonText(event.target.value); setLocalIssues([]); }} placeholder={'{\n  "schemaVersion": 3,\n  ...\n}'} /></label>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={primaryButton} disabled={!jsonText.trim() || Boolean(pending)} onClick={() => void save()}>{pending === 'save-draft' ? 'Validating…' : editing ? 'Save and validate draft' : 'Import as editable draft'}</button><label className={`${secondaryButton} cursor-pointer`}>Choose JSON file<input className="sr-only" type="file" accept="application/json,.json" onChange={event => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(value => { setEditing(null); setJsonText(value); setLocalIssues([]); }); event.currentTarget.value = ''; }} /></label>{jsonText && <button type="button" className={secondaryButton} onClick={() => { const value = parseEditor(); if (value) downloadJson('treasure-hunt-v3-draft.json', value); }}>Download editor JSON</button>}</div>
        </div>
        <div><Issues issues={currentIssues} /><div className="mt-4 rounded-xl border border-white/10 p-4"><p className="font-black text-white">Publication safety</p><ol className="mt-3 space-y-3 text-sm text-slate-400"><li><strong className="text-cyan-300">1. Draft</strong> — import or save without affecting players.</li><li><strong className="text-cyan-300">2. Validate</strong> — engine, variables, routes, variants, scores, and expected duration.</li><li><strong className="text-cyan-300">3. Preview</strong> — a human checks the exact revision.</li><li><strong className="text-cyan-300">4. Publish</strong> — explicit action creates an immutable version.</li></ol></div></div>
      </div>
    </section>

    <section className={`${panelClass} p-5 sm:p-6`}>
      <SectionHeading title="Editable drafts" detail="Publishing is disabled until the exact valid revision has been previewed in this session." />
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{drafts.map(draft => <DraftCard key={`${draft.id}-${draft.revision}`} draft={draft} pending={pending} previewed={reviewedRevision === revisionKey(draft)} onEdit={() => { setEditing(draft); setJsonText(JSON.stringify(draft.definition, null, 2)); setLocalIssues(draft.validation?.issues || []); window.scrollTo({ top: 0, behavior: 'smooth' }); }} onPreview={() => setPreviewDraft(draft)} onPublish={() => void publish(draft)} />)}</div>
      {!loading && !drafts.length && <div className="mt-5"><EmptyState title="No V3 drafts yet">Download the starter, shape it with Codex, then import it above.</EmptyState></div>}
    </section>

    {!!Object.keys(publishedVersions).length && <section className={`${panelClass} p-5 sm:p-6`}>
      <SectionHeading title="Private production QR packs" detail="Each published version gets new server-only QR values. Print the pack for the exact version you will run; republishing always requires a reprint." />
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Object.entries(publishedVersions).map(([huntId, version]) => {
        const title = drafts.find(draft => draft.huntId === huntId || draft.definition.id === huntId)?.title || huntId;
        return <article key={huntId} className="rounded-2xl border border-white/10 bg-slate-950/55 p-4"><p className="font-black text-white">{title}</p><p className="mt-1 text-xs text-slate-400">Published version {version} · organizer-only secrets</p><a className={`${primaryButton} mt-4 w-full`} href={`/v3/admin/qr?huntId=${encodeURIComponent(huntId)}&version=${version}`} target="_blank" rel="noreferrer">Open printable QR pack</a></article>;
      })}</div>
    </section>}

    {previewDraft && <DraftPreview draft={previewDraft} pending={pending} previewed={reviewedRevision === revisionKey(previewDraft)} onReview={() => void acknowledgePreview(previewDraft)} onPublish={() => void publish(previewDraft)} onClose={() => setPreviewDraft(null)} />}
  </div>;
}
