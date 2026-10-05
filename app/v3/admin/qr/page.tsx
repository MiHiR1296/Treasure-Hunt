import type { Metadata } from 'next';
import { Suspense } from 'react';
import V3QrPrintPack from '@/components/v3/admin/V3QrPrintPack';

export const metadata: Metadata = {
  title: 'Private QR print pack · Treasure Hunt V3',
  robots: { index: false, follow: false },
};

export default function V3QrPrintPage() {
  return <Suspense fallback={<main className="min-h-screen bg-white p-8 text-slate-900">Preparing the private QR pack…</main>}>
    <V3QrPrintPack />
  </Suspense>;
}
