'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { Html5Qrcode } from 'html5-qrcode';
import { cameraErrorMessage, QRScanSession, type ScanHandler } from '@/lib/utils/qrScanSession';

interface QRScannerProps {
  onScanSuccess: ScanHandler;
  onError?: (error: string) => void;
}

type Camera = { scanner: Html5Qrcode; ready: Promise<unknown>; release?: Promise<void> };
type Phase = 'idle' | 'starting' | 'scanning' | 'stopping';

function releaseCamera(camera: Camera): Promise<void> {
  if (!camera.release) {
    camera.release = (async () => {
      await camera.ready.catch(() => undefined);
      try {
        if (camera.scanner.isScanning) await camera.scanner.stop();
      } finally {
        try { camera.scanner.clear(); } catch { /* Already removed on unmount. */ }
      }
    })().catch(() => undefined);
  }
  return camera.release;
}

export default function QRScanner({ onScanSuccess, onError }: QRScannerProps) {
  const readerId = `qr-reader-${useId().replace(/:/g, '')}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const cameraRef = useRef<Camera | null>(null);
  const sessionRef = useRef<QRScanSession | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const onScanRef = useRef(onScanSuccess);
  const onErrorRef = useRef(onError);
  onScanRef.current = onScanSuccess;
  onErrorRef.current = onError;
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [validating, setValidating] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const updatePhase = (next: Phase) => {
    phaseRef.current = next;
    if (mounted.current) setPhase(next);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      sessionRef.current?.dispose();
      trackRef.current?.stop();
      trackRef.current = null;
      const camera = cameraRef.current;
      cameraRef.current = null;
      if (camera) void releaseCamera(camera);
    };
  }, []);

  const stop = async () => {
    const currentGeneration = ++generation.current;
    sessionRef.current?.dispose();
    const camera = cameraRef.current;
    cameraRef.current = null;
    updatePhase('stopping');
    if (camera) await releaseCamera(camera);
    trackRef.current?.stop();
    trackRef.current = null;
    if (mounted.current && generation.current === currentGeneration) {
      setValidating(false);
      setTorchOn(false);
      setTorchSupported(false);
      updatePhase('idle');
    }
  };

  const start = async () => {
    if (phaseRef.current !== 'idle' || !containerRef.current) return;
    const currentGeneration = ++generation.current;
    const isCurrent = () => mounted.current && generation.current === currentGeneration;
    const session = new QRScanSession();
    sessionRef.current = session;
    updatePhase('starting');
    setMessage('');
    let camera: Camera | undefined;
    try {
      if (!window.isSecureContext) throw new Error('Camera requires a secure connection.');
      const { Html5Qrcode: Scanner } = await import('html5-qrcode');
      if (!isCurrent()) return;
      const scanner = new Scanner(readerId, { verbose: false });
      camera = { scanner, ready: Promise.resolve() };
      cameraRef.current = camera;
      camera.ready = scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (width, height) => {
          const size = Math.floor(Math.min(width, height) * 0.75);
          return { width: size, height: size };
        } },
        (decodedText) => {
          if (!isCurrent()) return;
          void session.scan(decodedText, async (value) => {
            if (isCurrent()) setValidating(true);
            return onScanRef.current(value);
          }).then(async (result) => {
            if (!isCurrent() || result.status === 'ignored') return;
            setValidating(false);
            if (result.status === 'accepted') {
              setMessage(result.message || 'Code accepted.');
              await stop();
            } else {
              setMessage(result.message || 'That code does not match. Keep scanning or use a backup code.');
            }
          }).catch(() => {
            if (!isCurrent()) return;
            setValidating(false);
            setMessage('We could not check that code. Check your connection and try again.');
          });
        },
        () => { /* Missing a code in a camera frame is normal. */ },
      );
      await camera.ready;
      if (!isCurrent()) {
        await releaseCamera(camera);
        return;
      }
      updatePhase('scanning');
      const video = containerRef.current?.querySelector('video');
      const stream = video?.srcObject;
      if (stream instanceof MediaStream) {
        const track = stream.getVideoTracks()[0];
        trackRef.current = track || null;
        const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
        setTorchSupported(capabilities?.torch === true);
      }
    } catch (error) {
      if (camera) await releaseCamera(camera);
      if (!isCurrent()) return;
      cameraRef.current = null;
      const friendly = !window.isSecureContext
        ? 'Open the secure HTTPS link from your organizer to use the camera, or use a backup code.'
        : cameraErrorMessage(error);
      setMessage(friendly);
      onErrorRef.current?.(friendly);
      updatePhase('idle');
    }
  };

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track) return;
    try {
      const torchConstraint: MediaTrackConstraintSet & { torch: boolean } = { torch: !torchOn };
      await track.applyConstraints({ advanced: [torchConstraint] });
      if (mounted.current && trackRef.current === track) setTorchOn(!torchOn);
    } catch {
      if (mounted.current) {
        setTorchSupported(false);
        setMessage('Flashlight is unavailable on this device. Move to a brighter spot.');
      }
    }
  };

  return (
    <div className="w-full">
      <div id={readerId} ref={containerRef} className="w-full overflow-hidden rounded-xl" />
      {phase === 'idle' ? (
        <button type="button" onClick={() => void start()} className="mt-4 min-h-12 w-full rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-700">
          Start QR scanner
        </button>
      ) : (
        <div className="mt-4 flex gap-3">
          {torchSupported && <button type="button" onClick={() => void toggleTorch()} aria-pressed={torchOn} className="min-h-12 flex-1 rounded-xl bg-gray-100 px-4 py-3 font-semibold text-gray-900">{torchOn ? 'Flashlight off' : 'Flashlight on'}</button>}
          <button type="button" onClick={() => void stop()} disabled={phase === 'stopping'} className="min-h-12 flex-1 rounded-xl bg-gray-800 px-4 py-3 font-semibold text-white disabled:opacity-60">
            {phase === 'starting' ? 'Cancel camera' : phase === 'stopping' ? 'Stopping…' : 'Stop scanner'}
          </button>
        </div>
      )}
      <p role="status" aria-live="polite" className="mt-3 text-sm text-gray-700">
        {validating ? 'Checking code…' : message || (phase === 'starting' ? 'Opening your camera…' : 'Point your camera at the QR code. Incorrect codes keep the camera open.')}
      </p>
    </div>
  );
}
