'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HuntDefinition, PuzzleDefinition, ValidationIssue } from '@/lib/engine/types';
import { validateHunt } from '@/lib/engine/validation';
import HuntBuilder from '../HuntBuilder';
import { actionClass, buttonClass, Field, inputClass } from '../Fields';
import { createCheckpoint } from '../model';
import { BuilderMediaProvider } from '../AssetField';
import { adminRequest, AdminRequestError, type Asset, type Draft, type OperationProps, requestId } from './client';

interface Workspace { definition: HuntDefinition; revision: number | null; publishedVersion?: number; dirty: boolean; localKey?: string }
const storageKey = 'hunt-v2-organizer-drafts';

function editable(value: HuntDefinition): boolean {
  return Boolean(value && typeof value.title === 'string' && typeof value.id === 'string' && Array.isArray(value.checkpoints) && value.checkpoints.every(checkpoint => checkpoint && Array.isArray(checkpoint.hints) && checkpoint.flow && Array.isArray(checkpoint.flow.nodes)));
}

export default function DraftWorkspace({ dashboard, pending, run, refresh, notify, importedPuzzle, onPuzzleImported }: OperationProps & { importedPuzzle: PuzzleDefinition | null; onPuzzleImported: () => void }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [recoveries, setRecoveries] = useState<Record<string, Workspace>>({});
  const [storageProblem, setStorageProblem] = useState('');
  const [jsonOpen, setJsonOpen] = useState(false);
  const [json, setJson] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [publicationStatus, setPublicationStatus] = useState<'ready' | 'live'>('ready');
  const [previewUrl, setPreviewUrl] = useState('');
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const consumedPuzzle = useRef<PuzzleDefinition | null>(null);
  const issues = useMemo(() => workspace ? validateHunt(workspace.definition) : [], [workspace]);
  const mediaServices = useMemo(() => ({
    list: async () => (await adminRequest<{ media: Asset[] }>('/api/v2/admin/media')).media,
    upload: async (file: File) => { const form = new FormData(); form.set('file', file); form.set('requestId', requestId()); return (await adminRequest<{ media: Asset }>('/api/v2/admin/media', 'POST', form)).media; },
  }), []);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (stored && typeof stored === 'object') {
        const recovered = Object.fromEntries(Object.entries(stored).filter(([, value]) => value && typeof value === 'object' && 'definition' in value)) as Record<string, Workspace>;
        setRecoveries(recovered);
        const active = localStorage.getItem(storageKey + ':active');
        if (active && recovered[active]) setWorkspace(recovered[active]);
      }
    } catch { setStorageProblem('Local draft recovery is unavailable. Save your draft to the server before leaving.'); }
    finally { setHydrated(true); }
  }, []);

  const remember = useCallback((next: Workspace) => {
    setWorkspace(next);
    setRecoveries(previous => {
      const updated = { ...previous, [next.localKey || next.definition.id || 'unsaved']: next };
      try { localStorage.setItem(storageKey, JSON.stringify(updated)); localStorage.setItem(storageKey + ':active', next.localKey || next.definition.id || 'unsaved'); setStorageProblem(''); }
      catch { setStorageProblem('Local draft recovery is unavailable. Save your draft to the server before leaving.'); }
      return updated;
    });
  }, []);

  const load = useCallback((next: Workspace) => { remember({ ...next, localKey: next.localKey || requestId() }); setJsonOpen(false); setJsonError(''); setPreviewUrl(''); }, [remember]);
  useEffect(() => {
    if (!hydrated || !importedPuzzle || consumedPuzzle.current === importedPuzzle) return;
    consumedPuzzle.current = importedPuzzle;
    const current = workspace && editable(workspace.definition) ? workspace : { definition: { schemaVersion: 1 as const, id: `hunt-${requestId().slice(0, 8)}`, version: 1, title: 'Image puzzle hunt', checkpoints: [] }, revision: null, dirty: true };
    const checkpoint = createCheckpoint(current.definition);
    checkpoint.title = 'Jigsaw challenge';
    checkpoint.flow = { startNodeId: 'puzzle', nodes: [{ id: 'puzzle', type: 'puzzle', prompt: 'Arrange the image tiles to continue.', puzzle: importedPuzzle, next: 'finish' }, { id: 'finish', type: 'complete' }] };
    load({ ...current, definition: { ...current.definition, checkpoints: [...current.definition.checkpoints, checkpoint] }, dirty: true });
    onPuzzleImported();
  }, [hydrated, importedPuzzle, workspace, load, onPuzzleImported]);

  async function importFile(file: File, legacy: boolean) {
    if (file.size > 2_000_000) throw new AdminRequestError('Choose a JSON export smaller than 2 MB.', 400);
    let source: unknown;
    try { source = JSON.parse(await file.text()); } catch { throw new AdminRequestError('This file is not valid JSON. Choose a hunt export.', 400); }
    if (legacy) {
      const converted = await adminRequest<{ definition: HuntDefinition; issues: ValidationIssue[]; warnings: string[] }>('/api/v2/admin/import', 'POST', { source, huntId: `imported-${requestId().slice(0, 8)}` });
      load({ definition: converted.definition, revision: null, dirty: true }); setImportWarnings([...converted.warnings, ...converted.issues.map(issue => `${issue.path}: ${issue.message}`)]);
    } else {
      if (!editable(source as HuntDefinition)) throw new AdminRequestError('This file does not have a V2 hunt structure. Use Import V1 export for a legacy hunt.', 400);
      load({ definition: { ...(source as HuntDefinition), id: `imported-${requestId().slice(0, 8)}`, version: 1 }, revision: null, dirty: true }); setImportWarnings([]);
    }
    notify('Export loaded as a new draft. Review it before saving or publishing.');
  }
  function update(definition: HuntDefinition) {
    if (!workspace) return;
    setPreviewUrl('');
    remember({ ...workspace, definition, ...(definition.id === workspace.definition.id ? {} : { revision: null, publishedVersion: undefined }), dirty: true });
  }
  function exportDefinition(definition: HuntDefinition) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(definition, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `${definition.id.replace(/[^a-z0-9_-]/gi, '-') || 'hunt'}.json`;
    document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function loadDraft(draft: Draft) { load({ definition: draft.definition, revision: draft.revision, publishedVersion: dashboard.hunts.find(hunt => hunt.id === draft.id)?.version, dirty: false }); }

  async function save(current: Workspace): Promise<Workspace> {
    const { draft } = await adminRequest<{ draft: Draft }>('/api/v2/admin/drafts', 'POST', { definition: current.definition, expectedRevision: current.revision });
    const next = { ...current, definition: draft.definition, revision: draft.revision, dirty: false };
    remember(next); return next;
  }

  return <section className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-2xl font-bold">Design your adventure</h2><p className="mt-2 text-sm leading-6 text-slate-600">Build checkpoints and connect their actions. Save drafts freely; preview and publish after resolving configuration issues.</p></div><div className="flex flex-wrap gap-2"><button type="button" className={actionClass} disabled={Boolean(pending)} onClick={() => {
      const definition: HuntDefinition = { schemaVersion: 1, id: `hunt-${requestId().slice(0, 8)}`, version: 1, title: '', checkpoints: [] };
      definition.checkpoints = [createCheckpoint(definition)]; load({ definition, revision: null, dirty: true });
    }}>New hunt</button><button type="button" className={buttonClass} disabled={Boolean(pending)} onClick={() => load({ definition: { ...dashboard.example, id: `example-${requestId().slice(0, 8)}`, version: 1 }, revision: null, dirty: true })}>Use example</button></div></div>
    {storageProblem && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{storageProblem}</p>}
    {dashboard.templates && dashboard.templates.length > 0 && <div className="grid gap-3 md:grid-cols-3">{dashboard.templates.map(template => <button type="button" key={template.id} className="rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-teal-600 disabled:opacity-50" disabled={Boolean(pending)} onClick={() => load({ definition: { ...template.definition, id: `${template.id}-${requestId().slice(0, 8)}`, version: 1 }, revision: null, dirty: true })}><span className="block font-semibold">{template.title}</span><span className="mt-2 block text-sm leading-6 text-slate-600">{template.description}</span></button>)}</div>}
    <details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer py-2 font-semibold">Import a hunt export</summary><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Import V2 configuration"><input className={inputClass} type="file" accept="application/json,.json" disabled={Boolean(pending)} onChange={event => { const file = event.target.files?.[0]; if (file) void run('import', () => importFile(file, false)); event.target.value = ''; }} /></Field><Field label="Import V1 export"><input className={inputClass} type="file" accept="application/json,.json" disabled={Boolean(pending)} onChange={event => { const file = event.target.files?.[0]; if (file) void run('import', () => importFile(file, true)); event.target.value = ''; }} /></Field></div></details>
    {importWarnings.length > 0 && <details open className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><summary className="cursor-pointer py-2 font-semibold">Review imported content</summary><ul className="mt-2 list-disc space-y-2 pl-5">{importWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">Saved drafts</h3>{dashboard.drafts.length ? <ul className="mt-3 space-y-2">{dashboard.drafts.map(draft => <li key={draft.id}><button type="button" className={`${buttonClass} w-full text-left`} disabled={Boolean(pending)} onClick={() => loadDraft(draft)}>{draft.definition.title || draft.id}<span className="mt-1 block text-xs font-normal text-slate-500">Revision {draft.revision} · {draft.issues.length ? `${draft.issues.length} issues` : 'Ready to preview'}</span></button></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">Your saved drafts will appear here.</p>}</div>
      <div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">Recovery on this device</h3><p className="mt-2 text-xs leading-5 text-slate-500">Your edits are kept locally as you work. Saving a draft also stores it on the event server.</p><ul className="mt-3 space-y-2">{Object.entries(recoveries).filter(([, recovery]) => recovery.dirty).map(([key, recovery]) => <li key={key}><button type="button" className={`${buttonClass} w-full text-left`} disabled={Boolean(pending)} onClick={() => load(recovery)}>Recover {recovery.definition.title || recovery.definition.id || 'untitled draft'}</button></li>)}</ul></div>
    </div>
    <details className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer py-2 font-semibold">Start from a published hunt</summary><div className="mt-3 flex flex-wrap gap-2">{dashboard.hunts.map(hunt => <button type="button" className={buttonClass} key={hunt.id} disabled={Boolean(pending)} onClick={() => {
      const draft = dashboard.drafts.find(candidate => candidate.id === hunt.id);
      if (draft) loadDraft(draft); else load({ definition: hunt.definition, revision: null, publishedVersion: hunt.version, dirty: true });
    }}>{hunt.title} · v{hunt.version}</button>)}</div></details>
    {workspace && <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-teal-800">{workspace.dirty ? 'Unsaved changes' : `Saved draft · revision ${workspace.revision}`}</p><p className="mt-1 text-xs text-slate-500">Published versions remain fixed for teams already playing.</p></div><div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={Boolean(pending) || jsonOpen} onClick={() => { load({ definition: { ...structuredClone(workspace.definition), id: `hunt-${requestId().slice(0, 8)}`, title: `${workspace.definition.title || 'Untitled hunt'} (copy)`.slice(0, 200), version: 1 }, revision: null, dirty: true }); notify('A separate hunt draft is ready. Your original hunt and its teams are unchanged.'); }}>Duplicate as new hunt</button><button type="button" className={buttonClass} disabled={Boolean(pending) || jsonOpen} onClick={() => exportDefinition(workspace.definition)}>Export hunt</button><button type="button" className={buttonClass} disabled={Boolean(pending)} onClick={() => { if (!jsonOpen) setJson(JSON.stringify(workspace.definition, null, 2)); setJsonOpen(!jsonOpen); setJsonError(''); }}>{jsonOpen ? 'Use visual builder' : 'Advanced JSON'}</button></div></div>
      {jsonOpen || !editable(workspace.definition) ? <div className="space-y-3"><Field label="Advanced configuration"><textarea className={`${inputClass} font-mono`} rows={22} value={jsonOpen ? json : JSON.stringify(workspace.definition, null, 2)} disabled={Boolean(pending)} onChange={event => { setJsonOpen(true); setJson(event.target.value); }} /></Field>{jsonError && <p role="alert" className="text-sm text-red-700">{jsonError}</p>}<button type="button" className={buttonClass} disabled={Boolean(pending)} onClick={() => { try { const definition = JSON.parse(json); if (!editable(definition)) { setJsonError('Include a title, ID, checkpoints, flows, and hint arrays before using this configuration.'); return; } update(definition); setJsonError(''); setJsonOpen(false); } catch { setJsonError('This is not valid JSON. Your original draft is unchanged.'); } }}>Apply JSON to draft</button></div>
        : <BuilderMediaProvider services={mediaServices}><HuntBuilder key={workspace.localKey || workspace.definition.id} value={workspace.definition} onChange={update} disabled={Boolean(pending)} /></BuilderMediaProvider>}
      <div className="space-y-4 border-t border-slate-200 pt-5">
        <div className="flex flex-wrap items-end gap-3"><button type="button" className={buttonClass} disabled={Boolean(pending) || jsonOpen} onClick={() => void run('save-draft', async () => { await save(workspace); notify('Draft saved to the event server.'); await refresh(); })}>{pending === 'save-draft' ? 'Saving…' : 'Save draft'}</button><button type="button" className={buttonClass} disabled={Boolean(pending) || issues.length > 0 || jsonOpen} onClick={() => void run('preview', async () => { const result = await adminRequest<{ url: string }>('/api/v2/admin/preview', 'POST', { definition: workspace.definition }); setPreviewUrl(result.url); notify('Test session ready. Its progress is separate from the live leaderboard.'); await refresh(); })}>Start player preview</button><Field label="Publish as"><select className={inputClass} disabled={Boolean(pending)} value={publicationStatus} onChange={event => setPublicationStatus(event.target.value as 'ready' | 'live')}><option value="ready">Ready — start later</option><option value="live">Live — open now</option></select></Field><button type="button" className={actionClass} disabled={Boolean(pending) || issues.length > 0 || jsonOpen} onClick={() => void run('publish', async () => {
          const saved = workspace.dirty || workspace.revision === null ? await save(workspace) : workspace;
          const published = await adminRequest<{ version: number }>('/api/v2/admin/hunts', 'POST', { draftId: saved.definition.id, revision: saved.revision, expectedVersion: saved.publishedVersion, status: publicationStatus });
          remember({ ...saved, definition: { ...saved.definition, version: published.version }, revision: saved.revision! + 1, publishedVersion: published.version, dirty: false });
          notify(`Hunt published as ${publicationStatus}. New teams use version ${published.version}; existing teams keep their current version.`); await refresh();
        })}>{pending === 'publish' ? 'Publishing…' : 'Validate & publish hunt'}</button></div>
        {previewUrl && <a className="inline-flex min-h-11 items-center rounded-lg bg-teal-800 px-4 py-2 font-semibold text-white" href={previewUrl} target="_blank" rel="noreferrer">Open player preview ↗</a>}
        {issues.length > 0 && <p className="text-sm text-amber-800">Save your work now, or resolve {issues.length} configuration {issues.length === 1 ? 'issue' : 'issues'} before previewing or publishing.</p>}
      </div>
    </div>}
  </section>;
}
