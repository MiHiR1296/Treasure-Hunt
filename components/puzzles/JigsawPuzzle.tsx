'use client';

import { useEffect, useState } from 'react';
import { JigsawPuzzle as ReactJigsawPuzzle } from 'react-jigsaw-puzzle/lib';
import 'react-jigsaw-puzzle/lib/jigsaw-puzzle.css';

interface JigsawPuzzleProps {
  imageUrl: string;
  rows?: number;
  columns?: number;
  onSolved?: () => void;
  initialState?: { completed?: boolean };
  onStateChange?: (state: { completed: boolean }) => void;
}

export default function JigsawPuzzle({
  imageUrl,
  rows = 3,
  columns = 3,
  onSolved,
  initialState,
  onStateChange,
}: JigsawPuzzleProps) {
  const [isCompleted, setIsCompleted] = useState(initialState?.completed || false);

  useEffect(() => {
    // Note: react-jigsaw-puzzle library doesn't support state restoration
    // We can only track completion status
    if (initialState?.completed && onStateChange) {
      onStateChange({ completed: true });
    }
  }, [initialState, onStateChange]);

  const handleSolved = () => {
    setIsCompleted(true);
    if (onStateChange) {
      onStateChange({ completed: true });
    }
    if (onSolved) {
      onSolved();
    }
  };

  return (
    <div className="w-full">
      {isCompleted && (
        <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4 mb-4">
          <p className="text-green-800 font-semibold text-center">
            ✓ Jigsaw puzzle already completed!
          </p>
        </div>
      )}
      <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
        <ReactJigsawPuzzle
          imageSrc={imageUrl}
          rows={rows}
          columns={columns}
          onSolved={handleSolved}
        />
      </div>
      <p className="text-sm text-gray-600 mt-4 text-center px-4">
        Drag pieces to solve the puzzle. They will snap together when placed correctly.
      </p>
    </div>
  );
}
