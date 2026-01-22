'use client';

import { useEffect, useState, useRef } from 'react';
import { isWithinRadius, formatDistance, calculateDistance } from '@/lib/utils/geolocation';

interface GPSDetectorProps {
  targetLat: number;
  targetLng: number;
  radiusMeters: number;
  onUnlock: () => void;
}

export default function GPSDetector({
  targetLat,
  targetLng,
  radiusMeters,
  onUnlock,
}: GPSDetectorProps) {
  const [isInside, setIsInside] = useState(false);
  const [distance, setDistance] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string>('');
  const [isWatching, setIsWatching] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isWatching) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy: acc } = position.coords;
        setAccuracy(acc);

        const dist = calculateDistance(latitude, longitude, targetLat, targetLng);
        setDistance(dist);

        const inside = isWithinRadius(latitude, longitude, targetLat, targetLng, radiusMeters);
        setIsInside(inside);

        if (inside) {
          onUnlock();
        }

        setError('');
      },
      (err) => {
        console.error('Geolocation error:', err);
        setError(err.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 15000,
      }
    );

    watchIdRef.current = watchId;

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [isWatching, targetLat, targetLng, radiusMeters, onUnlock]);

  const startWatching = () => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser');
      return;
    }

    setIsWatching(true);
  };

  const stopWatching = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsWatching(false);
  };

  return (
    <div className="w-full space-y-4">
      {!isWatching ? (
        <button
          onClick={startWatching}
          className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
        >
          Enable GPS Detection
        </button>
      ) : (
        <button
          onClick={stopWatching}
          className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition-colors"
        >
          Stop GPS Detection
        </button>
      )}

      {isWatching && (
        <div className="space-y-2">
          {distance !== null && (
            <div className="text-center">
              {isInside ? (
                <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
                  <p className="font-semibold">✓ You're at the location!</p>
                  <p className="text-sm mt-1">Checkpoint unlocked</p>
                </div>
              ) : (
                <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg">
                  <p className="font-semibold">📍 Distance: {formatDistance(distance)}</p>
                  <p className="text-sm mt-1">Keep moving closer...</p>
                </div>
              )}
            </div>
          )}

          {accuracy !== null && (
            <p className="text-xs text-gray-500 text-center">
              GPS Accuracy: ±{Math.round(accuracy)}m
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <p className="text-sm text-gray-600 text-center">
        Make sure location permissions are enabled in your browser
      </p>
    </div>
  );
}
