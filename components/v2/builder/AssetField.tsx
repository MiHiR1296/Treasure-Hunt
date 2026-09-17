'use client';

/* eslint-disable @next/next/no-img-element -- Authenticated media is resized by our upload server. */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { buttonClass, Field, inputClass } from './Fields';

export interface BuilderAsset { id: string; url: string; contentType: string; bytes: number }
export interface BuilderMediaServices { list: () => Promise<BuilderAsset[]>; upload: (file: File) => Promise<BuilderAsset> }
const MediaContext = createContext<BuilderMediaServices | null>(null);
export function BuilderMediaProvider({ services, children }: { services: BuilderMediaServices; children: ReactNode }) { return <MediaContext.Provider value={services}>{children}</MediaContext.Provider>; }

/** Network/storage are supplied by the host; the builder itself has no server dependency. */
export default function AssetField({ label, value, onChange, kind = 'image', hint }: { label: string; value: string; onChange: (url: string) => void; kind?: 'image' | 'audio' | 'video'; hint?: string }) {
  const services = useContext(MediaContext);
  const [assets, setAssets] = useState<BuilderAsset[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const latestChange = useRef(onChange); latestChange.current = onChange;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function upload(file: File) {
    if (!services || busy) return; setBusy(true); setError('');
    try { const asset = await services.upload(file); if (mounted.current) { latestChange.current(asset.url); setAssets(null); } }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Upload failed. Please try again.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function browse() {
    if (!services || busy) return;
    if (assets) { setAssets(null); return; }
    setBusy(true); setError('');
    try { const result = await services.list(); if (mounted.current) setAssets(result.filter(asset => asset.contentType.startsWith(kind + '/'))); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not load media.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <div className="space-y-2"><Field label={label} hint={hint}><input className={inputClass} value={value} onChange={event => onChange(event.target.value)} placeholder="Choose media or paste an asset URL" /></Field>
    {services && <div className="flex flex-wrap items-center gap-2"><label className={buttonClass + ' relative cursor-pointer overflow-hidden'}>{busy ? 'Working…' : 'Upload ' + kind}<input type="file" aria-label={'Upload for ' + label} accept={kind + '/*'} disabled={busy} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /></label><button type="button" className={buttonClass} disabled={busy} onClick={() => void browse()}>{assets ? 'Close media picker' : 'Choose from library'}</button></div>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {assets && <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3"><p className="mb-3 text-xs text-slate-500">Select an uploaded {kind}.</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{assets.map(asset => <button type="button" key={asset.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white p-2 text-left text-xs" onClick={() => { onChange(asset.url); setAssets(null); }}>{kind === 'image' && <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={asset.url} alt="Available event image" loading="lazy" className="mb-2 h-20 w-full object-contain" /></>}<span className="block truncate">{asset.id.slice(0, 8)}</span><span className="text-slate-500">{Math.ceil(asset.bytes / 1024)} KB</span></button>)}</div>{assets.length === 0 && <p className="text-sm text-slate-500">No {kind} files yet. Upload one above.</p>}</div>}
  </div>;
}
