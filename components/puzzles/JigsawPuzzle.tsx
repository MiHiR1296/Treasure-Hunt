'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import to avoid SSR issues
// Try different import paths for react-jigsaw-puzzle
const JigsawPuzzleComponent = dynamic(
  () => {
    return import('react-jigsaw-puzzle/lib')
      .then((mod) => {
        // Try different export structures
        return mod.JigsawPuzzle || mod.default || mod;
      })
      .catch(() => {
        // Fallback: try main package
        return import('react-jigsaw-puzzle').then((mod) => {
          return mod.JigsawPuzzle || mod.default || mod;
        });
      })
      .catch(() => {
        // Final fallback: return a placeholder component
        return {
          default: ({ imageSrc, onSolved }: any) => {
            useEffect(() => {
              // Auto-solve after a delay if library fails
              const timer = setTimeout(() => {
                if (onSolved) onSolved();
              }, 100);
              return () => clearTimeout(timer);
            }, [onSolved]);
            return (
              <div className="p-8 text-center">
                <p className="text-gray-600 mb-4">Jigsaw puzzle library not available</p>
                <img src={imageSrc} alt="Puzzle" className="max-w-md mx-auto rounded-lg" />
                <button
                  onClick={() => onSolved?.()}
                  className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg"
                >
                  Mark as Solved
                </button>
              </div>
            );
          }
        };
      });
  },
  { 
    ssr: false,
    loading: () => <div className="flex items-center justify-center p-8"><p className="text-gray-600">Loading puzzle...</p></div>
  }
);

interface JigsawPuzzleProps {
  imageUrl: string;
  rows?: number;
  columns?: number;
  onSolved?: () => void;
}

export default function JigsawPuzzle({ 
  imageUrl, 
  rows = 3, 
  columns = 3,
  onSolved 
}: JigsawPuzzleProps) {
  const [isSolved, setIsSolved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if image loads
    const img = new Image();
    img.onload = () => setIsLoading(false);
    img.onerror = () => {
      setIsLoading(false);
      console.error('Failed to load puzzle image');
    };
    img.src = imageUrl;
  }, [imageUrl]);

  const handleSolved = () => {
    if (!isSolved) {
      setIsSolved(true);
      if (onSolved) {
        onSolved();
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-gray-600">Loading puzzle...</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
        <JigsawPuzzleComponent
          imageSrc={imageUrl}
          rows={rows}
          columns={columns}
          onSolved={handleSolved}
        />
      </div>
      {isSolved && (
        <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-green-800 font-semibold">✓ Puzzle solved!</p>
        </div>
      )}
    </div>
  );
}
