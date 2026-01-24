'use client';

import { useState } from 'react';
import QRScanner from './QRScanner';
import ErrorPopup from './ErrorPopup';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (decodedText: string) => void;
  expectedValue?: string;
  isDudQr?: boolean;
  dudMessage?: string;
}

export default function QRScannerModal({
  isOpen,
  onClose,
  onScanSuccess,
  expectedValue,
  isDudQr,
  dudMessage,
}: QRScannerModalProps) {
  const [showErrorPopup, setShowErrorPopup] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  if (!isOpen) return null;

  const handleScan = (decodedText: string) => {
    // If this is a dud QR, show dud message
    if (isDudQr) {
      setErrorMessage(dudMessage || 'Try again! This is not the right QR code.');
      setShowErrorPopup(true);
      return;
    }

    // If expected value is provided, validate
    if (expectedValue && decodedText.trim() !== expectedValue.trim()) {
      setErrorMessage('Incorrect QR code. Please try again.');
      setShowErrorPopup(true);
      return;
    }

    // Valid QR code
    setShowErrorPopup(false);
    onScanSuccess(decodedText);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Scan QR Code</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl font-bold"
            >
              ×
            </button>
          </div>

          <div className="space-y-4">
            <QRScanner
              onScanSuccess={handleScan}
              onError={(error) => {
                setErrorMessage(error || 'Failed to scan QR code');
                setShowErrorPopup(true);
              }}
            />
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-200 text-gray-800 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {showErrorPopup && (
        <ErrorPopup
          message={errorMessage}
          onClose={() => setShowErrorPopup(false)}
          onTryAgain={() => setShowErrorPopup(false)}
        />
      )}
    </>
  );
}
