'use client';

import { useState } from 'react';
import QRScanner from '@/components/QRScanner';
import type { ScanHandler } from '@/lib/utils/qrScanSession';

interface PuzzleQRScannerProps {
  onAnswerSubmit: ScanHandler;
  expectedValue?: string;
}

export default function PuzzleQRScanner({ onAnswerSubmit, expectedValue }: PuzzleQRScannerProps) {
  const [error, setError] = useState('');

  const handleScan: ScanHandler = async (decodedText) => {
    if (expectedValue && decodedText !== expectedValue) {
      setError('Incorrect QR code. Please scan the correct code.');
      return false;
    }
    setError('');
    return onAnswerSubmit(decodedText);
  };

  const handleError = (errorMessage: string) => {
    setError(errorMessage);
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-sm text-blue-800 mb-2">
          Scan the QR code to proceed to the next step.
        </p>
      </div>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      <QRScanner onScanSuccess={handleScan} onError={handleError} />
    </div>
  );
}
