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
  const [flashlightOn, setFlashlightOn] = useState(false);
  const [flashlightSupported, setFlashlightSupported] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);

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

      // Get the video track from the scanner's video element after it starts
      // Wait a bit for the video element to be created
      setTimeout(() => {
        try {
          const videoElement = document.querySelector('#qr-reader video') as HTMLVideoElement;
          if (videoElement && videoElement.srcObject) {
            const stream = videoElement.srcObject as MediaStream;
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) {
              videoTrackRef.current = videoTrack;
              
              // Check if flashlight is supported
              const capabilities = videoTrack.getCapabilities();
              if (capabilities.torch !== undefined) {
                setFlashlightSupported(true);
              } else {
                // Try to check if applyConstraints with torch works
                videoTrack.applyConstraints({ advanced: [{ torch: false }] } as any)
                  .then(() => {
                    setFlashlightSupported(true);
                  })
                  .catch(() => {
                    setFlashlightSupported(false);
                  });
              }
            }
          }
        } catch (err) {
          console.warn('Could not access video track for flashlight:', err);
          setFlashlightSupported(false);
        }
      }, 500);
    } catch (err: any) {
      console.error('Error starting scanner:', err);
      setError(err.message || 'Failed to start camera');
      onError?.(err.message);
    }
  };

  const stopScanning = async () => {
    // Turn off flashlight before stopping
    if (flashlightOn && videoTrackRef.current) {
      try {
        await toggleFlashlight(false);
      } catch (err) {
        console.warn('Error turning off flashlight:', err);
      }
    }

    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
        scannerRef.current = null;
        setIsScanning(false);
        setFlashlightOn(false);
      } catch (err) {
        console.error('Error stopping scanner:', err);
      }
    }

    // Release video track
    if (videoTrackRef.current) {
      videoTrackRef.current.stop();
      videoTrackRef.current = null;
    }
  };

  const toggleFlashlight = async (turnOn: boolean) => {
    if (!videoTrackRef.current) return;

    try {
      const constraints: any = {
        advanced: [{ torch: turnOn }]
      };

      await videoTrackRef.current.applyConstraints(constraints);
      setFlashlightOn(turnOn);
    } catch (err: any) {
      console.warn('Flashlight not supported or error:', err);
      setFlashlightSupported(false);
      // Try alternative method for some browsers
      try {
        const settings = videoTrackRef.current.getSettings();
        await videoTrackRef.current.applyConstraints({
          ...settings,
          torch: turnOn
        } as any);
        setFlashlightOn(turnOn);
      } catch (altErr) {
        console.warn('Alternative flashlight method also failed:', altErr);
      }
    }
  };

  const handleFlashlightToggle = () => {
    toggleFlashlight(!flashlightOn);
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
        <div className="flex gap-3 mt-4">
          {flashlightSupported && (
            <button
              onClick={handleFlashlightToggle}
              className={`flex-1 py-3 rounded-lg font-semibold transition-colors text-base ${
                flashlightOn
                  ? 'bg-yellow-500 text-gray-900 hover:bg-yellow-600'
                  : 'bg-gray-600 text-white hover:bg-gray-700'
              }`}
              aria-label={flashlightOn ? 'Turn off flashlight' : 'Turn on flashlight'}
            >
              {flashlightOn ? '🔦 Flashlight On' : '💡 Flashlight Off'}
            </button>
          )}
          <button
            onClick={stopScanning}
            className="flex-1 bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition-colors text-base"
          >
            Stop Scanner
          </button>
        </div>
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
