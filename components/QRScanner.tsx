'use client';

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

interface QRScannerProps {
  onScanSuccess: (decodedText: string) => void;
  onError?: (error: string) => void;
}

export default function QRScanner({ onScanSuccess, onError }: QRScannerProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string>('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      // Cleanup on unmount
      if (scannerRef.current) {
        scannerRef.current
          .stop()
          .then(() => {
            scannerRef.current?.clear();
          })
          .catch(() => {});
      }
    };
  }, []);

  const startScanning = async () => {
    if (!containerRef.current) return;

    try {
      const html5QrCode = new Html5Qrcode('qr-reader');
      scannerRef.current = html5QrCode;

      // Adjust QR box size for mobile
      const qrboxSize = Math.min(300, window.innerWidth * 0.8);
      
      await html5QrCode.start(
        { facingMode: 'environment' }, // Use back camera
        {
          fps: 10,
          qrbox: { width: qrboxSize, height: qrboxSize },
        },
        (decodedText) => {
          // Success callback
          onScanSuccess(decodedText);
          stopScanning();
        },
        (errorMessage) => {
          // Error callback - ignore common scanning errors that occur during normal scanning
          // These are expected when scanning wrong QR codes, taking time to focus, etc.
          const ignorableErrors = [
            'No QR code found',
            'No MultiFormat readers were able to detect the code',
            'QR code parse error',
            'error_Z',
            'NotFoundException',
          ];
          
          const shouldIgnore = ignorableErrors.some(ignorable => 
            errorMessage.includes(ignorable)
          );
          
          if (!shouldIgnore) {
            // Only show meaningful errors (like camera permission issues)
            setError(errorMessage);
          }
        }
      );

      setIsScanning(true);
      setError('');
    } catch (err: any) {
      console.error('Error starting scanner:', err);
      setError(err.message || 'Failed to start camera');
      onError?.(err.message);
    }
  };

  const stopScanning = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
        scannerRef.current = null;
        setIsScanning(false);
      } catch (err) {
        console.error('Error stopping scanner:', err);
      }
    }
  };

  return (
    <div className="w-full">
      <div
        id="qr-reader"
        ref={containerRef}
        className="w-full rounded-lg overflow-hidden"
      />
      
      {!isScanning && (
        <button
          onClick={startScanning}
          className="w-full mt-4 bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors text-base"
        >
          Start QR Scanner
        </button>
      )}

      {isScanning && (
        <button
          onClick={stopScanning}
          className="w-full mt-4 bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition-colors text-base"
        >
          Stop Scanner
        </button>
      )}

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <p className="mt-4 text-xs md:text-sm text-gray-600 text-center">
        Point your camera at the QR code
      </p>
    </div>
  );
}
