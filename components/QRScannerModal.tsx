'use client';

import { useEffect, useRef } from 'react';
import QRScanner from './QRScanner';
import type { ScanHandler } from '@/lib/utils/qrScanSession';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: ScanHandler;
  expectedValue?: string;
  isDudQr?: boolean;
  dudMessage?: string;
}

export default function QRScannerModal({ isOpen, onClose, onScanSuccess, expectedValue, isDudQr, dudMessage }: QRScannerModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (isOpen) dialog?.showModal();
    else dialog?.close();
  }, [isOpen]);

  const handleScan: ScanHandler = async (decodedText) => {
    if (isDudQr) return { accepted: false, message: dudMessage || 'A decoy! Keep looking for the right code.' };
    if (expectedValue && decodedText.trim() !== expectedValue.trim()) {
      return { accepted: false, message: 'That is not the right QR code. Keep scanning.' };
    }
    return onScanSuccess(decodedText);
  };

  return (
    <dialog ref={dialogRef} onCancel={onClose} aria-label="Scan QR code" className="w-[calc(100%_-_2rem)] max-w-xl rounded-2xl bg-white p-6 text-gray-900 backdrop:bg-black/60">
      {isOpen && <>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold">Scan QR code</h2>
          <button type="button" onClick={onClose} className="min-h-12 rounded-lg px-4 py-2 font-semibold text-gray-600">Close</button>
        </div>
        <QRScanner onScanSuccess={handleScan} />
      </>}
    </dialog>
  );
}
