'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';

interface CircularRotatePuzzleProps {
  imageUrl: string;
  segments?: number;
  correctRotations?: number[];
  onSolved?: () => void;
  initialState?: { rotations?: number[]; completed?: boolean };
  onStateChange?: (state: { rotations: number[]; completed: boolean }) => void;
}

export default function CircularRotatePuzzle({
  imageUrl,
  segments = 8,
  correctRotations = [],
  onSolved,
  initialState,
  onStateChange,
}: CircularRotatePuzzleProps) {
  const [rotations, setRotations] = useState<number[]>(
    initialState?.rotations || Array(segments).fill(0)
  );
  const [isSolved, setIsSolved] = useState(initialState?.completed || false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkSolution();
  }, [rotations, correctRotations]);

  const checkSolution = () => {
    if (correctRotations.length === 0) return;

    const normalized = rotations.map((r, i) => {
      const normalizedRot = ((r % 360) + 360) % 360;
      const normalizedCorrect = ((correctRotations[i] % 360) + 360) % 360;
      return Math.abs(normalizedRot - normalizedCorrect) < 5; // 5 degree tolerance
    });

    if (normalized.every(Boolean) && !isSolved) {
      setIsSolved(true);
      if (onStateChange) {
        onStateChange({ rotations, completed: true });
      }
      if (onSolved) {
        onSolved();
      }
    } else if (!normalized.every(Boolean) && isSolved) {
      setIsSolved(false);
      if (onStateChange) {
        onStateChange({ rotations, completed: false });
      }
    }
  };

  const handleRotate = (index: number, direction: 'left' | 'right') => {
    const newRotations = [...rotations];
    const step = direction === 'left' ? -90 : 90;
    newRotations[index] = (newRotations[index] + step) % 360;
    setRotations(newRotations);
    
    if (onStateChange) {
      onStateChange({ rotations: newRotations, completed: isSolved });
    }
  };

  const segmentAngle = 360 / segments;
  const radius = 150; // pixels

  return (
    <div className="w-full space-y-4">
      <div className="bg-white rounded-lg p-8 border-2 border-gray-200 flex items-center justify-center">
        <div
          ref={containerRef}
          className="relative"
          style={{ width: radius * 2, height: radius * 2 }}
        >
          {Array.from({ length: segments }).map((_, index) => {
            const angle = (index * segmentAngle * Math.PI) / 180;
            const x = radius + radius * Math.cos(angle - Math.PI / 2);
            const y = radius + radius * Math.sin(angle - Math.PI / 2);

            return (
              <div
                key={index}
                className="absolute"
                style={{
                  left: `${x}px`,
                  top: `${y}px`,
                  transform: `translate(-50%, -50%) rotate(${rotations[index]}deg)`,
                  transformOrigin: 'center',
                  width: `${radius * 1.5}px`,
                  height: `${radius * 1.5}px`,
                  transition: 'transform 0.3s ease',
                }}
              >
                <div
                  className="relative w-full h-full overflow-hidden rounded-full"
                  style={{
                    clipPath: `polygon(50% 50%, ${50 + 50 * Math.cos((index * segmentAngle - segmentAngle / 2) * Math.PI / 180)}% ${50 + 50 * Math.sin((index * segmentAngle - segmentAngle / 2) * Math.PI / 180)}%, ${50 + 50 * Math.cos((index * segmentAngle + segmentAngle / 2) * Math.PI / 180)}% ${50 + 50 * Math.sin((index * segmentAngle + segmentAngle / 2) * Math.PI / 180)}%)`,
                  }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage: `url(${imageUrl})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      transform: `rotate(${-rotations[index]}deg)`,
                      transformOrigin: 'center',
                    }}
                  />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleRotate(index, 'left')}
                      className="w-8 h-8 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 transition-colors text-sm"
                      title="Rotate left"
                    >
                      ↺
                    </button>
                    <button
                      onClick={() => handleRotate(index, 'right')}
                      className="w-8 h-8 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 transition-colors text-sm"
                      title="Rotate right"
                    >
                      ↻
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="text-center space-y-2">
        <p className="text-sm text-gray-600">
          Click the rotation buttons on each segment to align the image
        </p>
        {isSolved && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-green-800 font-semibold">✓ Puzzle solved!</p>
          </div>
        )}
      </div>
    </div>
  );
}
