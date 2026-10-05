'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { adminRequest, V3AdminRequestError } from './client';

type Pack = {
  hunt: { id: string; title: string; slug: string; version: number; publishedAt: string };
  joinPath: string;
  items: Array<{ fieldPath: string; groupPath: string; logicalName: string; kind: 'qr_token' | 'backup_code'; value: string }>;
  warning: string;
};

export default function V3QrPrintPack() {
  const query = useSearchParams();
  const huntId = query.get('huntId') || '';
  const version = Number(query.get('version') || '') || undefined;
  const [pack, setPack] = useState<Pack | null>(null);
  const [problem, setProblem] = useState('');
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (!huntId) { setProblem('Choose a published hunt from the authoring workspace.'); return; }
    void adminRequest<Pack>('/api/v3/admin/qr', 'POST', { huntId, ...(version ? { version } : {}) })
      .then(setPack)
      .catch(error => setProblem(error instanceof V3AdminRequestError ? error.message : 'The private QR pack could not be loaded.'));
  }, [huntId, version]);
  const groups = useMemo(() => {
    const grouped = new Map<string, Pack['items']>();
    for (const item of pack?.items ?? []) grouped.set(item.groupPath, [...(grouped.get(item.groupPath) ?? []), item]);
    return [...grouped.entries()];
  }, [pack]);
  if (problem) return <main className="min-h-screen bg-slate-950 p-6 text-white"><p role="alert">{problem}</p><a className="mt-4 inline-block underline" href="/v3/admin">Back to organizer console</a></main>;
  if (!pack || !origin) return <main className="min-h-screen bg-slate-950 p-6 text-white">Loading private QR pack…</main>;
  const joinUrl = `${origin}${pack.joinPath}`;
  return <main className="min-h-screen bg-stone-100 p-4 text-stone-950 print:bg-white print:p-0">
    <header className="mx-auto mb-5 max-w-6xl rounded-2xl bg-slate-950 p-5 text-white print:rounded-none print:bg-white print:text-black">
      <p className="text-xs font-black uppercase tracking-widest">Private organizer material · {pack.hunt.id}</p>
      <h1 className="mt-2 text-3xl font-black">{pack.hunt.title} · Version {pack.hunt.version}</h1>
      <p className="mt-2 text-sm text-amber-200 print:text-black">{pack.warning}</p>
      <div className="mt-4 flex gap-3 print:hidden"><button type="button" onClick={() => window.print()} className="rounded-xl bg-cyan-300 px-4 py-3 font-black text-slate-950">Print this exact version</button><a href="/v3/admin" className="rounded-xl border border-white/30 px-4 py-3 font-bold">Back</a></div>
    </header>
    <div className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 print:grid-cols-2">
      <section className="break-inside-avoid rounded-2xl border-2 border-stone-300 bg-white p-5 text-center">
        <p className="text-xs font-black uppercase tracking-widest text-stone-500">Player entry</p><h2 className="mt-2 text-xl font-black">Join {pack.hunt.title}</h2>
        <div className="mt-4 flex justify-center"><QRCodeSVG value={joinUrl} size={240} marginSize={4} level="M" title={`Join ${pack.hunt.title}`} /></div>
        <p className="mt-3 break-all font-mono text-xs">{joinUrl}</p>
      </section>
      {groups.map(([groupPath, items]) => {
        const token = items.find(item => item.kind === 'qr_token');
        const backup = items.find(item => item.kind === 'backup_code');
        const label = token?.logicalName || backup?.logicalName || groupPath;
        return <section key={groupPath} className="break-inside-avoid rounded-2xl border-2 border-stone-300 bg-white p-5 text-center">
          <p className="text-xs font-black uppercase tracking-widest text-stone-500">Version {pack.hunt.version} · {groupPath}</p><h2 className="mt-2 text-xl font-black">{label.replaceAll(/[-_]/g, ' ')}</h2>
          {token && <div className="mt-4 flex justify-center"><QRCodeSVG value={token.value} size={240} marginSize={4} level="M" title={`${label} QR`} /></div>}
          {backup && <p className="mt-4">Printed backup: <strong className="font-mono text-lg">{backup.value}</strong></p>}
          {!token && backup && <p className="mt-2 text-sm text-stone-600">Backup code only; no QR token is configured for this item.</p>}
        </section>;
      })}
    </div>
  </main>;
}
