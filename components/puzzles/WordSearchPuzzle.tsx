'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';

interface WordSearchPuzzleProps {
  imageUrl: string;
  words?: string[];
  targetWord?: string;
  showWordsList?: boolean;
  onWordFound?: (word: string) => void;
  onAllWordsFound?: () => void;
}

interface MarkedWord {
  word: string;
  path: { x: number; y: number }[];
  color: string;
}

export default function WordSearchPuzzle({
  imageUrl,
  words = [],
  targetWord,
  showWordsList = true,
  onWordFound,
  onAllWordsFound,
}: WordSearchPuzzleProps) {
  const [foundWords, setFoundWords] = useState<Set<string>>(new Set());
  const [selectedWord, setSelectedWord] = useState<string>('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<{ x: number; y: number }[]>([]);
  const [markedWords, setMarkedWords] = useState<MarkedWord[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  // Load image and setup canvas
  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas || !imageContainerRef.current) return;

      const container = imageContainerRef.current;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      
      // Set canvas size to match container
      canvas.width = containerWidth;
      canvas.height = containerHeight;
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Draw marked words on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw all marked words
    markedWords.forEach((marked) => {
      if (marked.path.length < 2) return;

      ctx.strokeStyle = marked.color;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(marked.path[0].x, marked.path[0].y);
      for (let i = 1; i < marked.path.length; i++) {
        ctx.lineTo(marked.path[i].x, marked.path[i].y);
      }
      ctx.stroke();
    });

    // Draw current path being drawn
    if (currentPath.length > 1 && isDrawing) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();
      ctx.moveTo(currentPath[0].x, currentPath[0].y);
      for (let i = 1; i < currentPath.length; i++) {
        ctx.lineTo(currentPath[i].x, currentPath[i].y);
      }
      ctx.stroke();
    }
  }, [markedWords, currentPath, isDrawing]);

  const getCanvasCoordinates = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas || !imageContainerRef.current) return null;

    const rect = imageContainerRef.current.getBoundingClientRect();
    let clientX: number, clientY: number;

    if ('touches' in e) {
      // Touch event
      if (e.touches.length === 0) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      // Mouse event
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const handleStart = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    const coords = getCanvasCoordinates(e);
    if (coords) {
      setIsDrawing(true);
      setCurrentPath([coords]);
    }
  };

  const handleMove = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!isDrawing) return;
    e.preventDefault();
    const coords = getCanvasCoordinates(e);
    if (coords) {
      setCurrentPath((prev) => [...prev, coords]);
    }
  };

  const handleEnd = () => {
    if (!isDrawing || currentPath.length < 2) {
      setIsDrawing(false);
      setCurrentPath([]);
      return;
    }

    // Mark the word as found (user has drawn on the puzzle)
    // We'll validate against the word list when they submit
    const color = `hsl(${Math.random() * 360}, 70%, 50%)`;
    const marked: MarkedWord = {
      word: '', // Will be validated when user types the word
      path: [...currentPath],
      color,
    };

    setMarkedWords((prev) => [...prev, marked]);
    setIsDrawing(false);
    setCurrentPath([]);
  };

  const handleWordSelect = (word: string) => {
    const normalizedWord = word.trim().toLowerCase();
    const normalizedWords = words.map(w => w.trim().toLowerCase());
    const normalizedTarget = targetWord?.trim().toLowerCase();

    if (normalizedWords.includes(normalizedWord) || normalizedWord === normalizedTarget) {
      if (!foundWords.has(normalizedWord)) {
        const newFound = new Set(foundWords);
        newFound.add(normalizedWord);
        setFoundWords(newFound);

        // Update the most recent marked word with the validated word
        if (markedWords.length > 0) {
          const lastMarked = markedWords[markedWords.length - 1];
          if (!lastMarked.word) {
            setMarkedWords((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { ...lastMarked, word: normalizedWord };
              return updated;
            });
          }
        }

        if (onWordFound) {
          onWordFound(word);
        }

        // Check if all words found
        const allFound = normalizedWords.every(w => newFound.has(w));
        if (normalizedTarget) {
          if (allFound && newFound.has(normalizedTarget) && onAllWordsFound) {
            onAllWordsFound();
          }
        } else if (allFound && onAllWordsFound) {
          onAllWordsFound();
        }
      }
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="bg-white rounded-lg p-4 border-2 border-gray-200 relative">
        <div
          ref={imageContainerRef}
          className="relative w-full aspect-square max-w-2xl mx-auto"
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
          style={{ touchAction: 'none', userSelect: 'none' }}
        >
          <div ref={imageRef} className="relative w-full h-full">
            <Image
              src={imageUrl}
              alt="Word search puzzle"
              fill
              className="object-contain"
              unoptimized
            />
          </div>
          <canvas
            ref={canvasRef}
            className="absolute inset-0 pointer-events-none"
            style={{ touchAction: 'none' }}
          />
        </div>
        <p className="text-xs text-gray-500 mt-2 text-center">
          Draw on the puzzle to mark words you find
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Type the word you marked:
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={selectedWord}
              onChange={(e) => setSelectedWord(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleWordSelect(selectedWord);
                  setSelectedWord('');
                }
              }}
              className="flex-1 px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
              placeholder="Enter word you marked..."
            />
            <button
              onClick={() => {
                handleWordSelect(selectedWord);
                setSelectedWord('');
              }}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Mark Found
            </button>
          </div>
        </div>

        {showWordsList && (words.length > 0 || targetWord) && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Words to find:</p>
            <div className="flex flex-wrap gap-2">
              {words.map((word, index) => {
                const isFound = foundWords.has(word.trim().toLowerCase());
                return (
                  <span
                    key={index}
                    className={`px-3 py-1 rounded-full text-sm ${
                      isFound
                        ? 'bg-green-100 text-green-800 line-through opacity-60'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {word}
                  </span>
                );
              })}
              {targetWord && (
                <span
                  className={`px-3 py-1 rounded-full text-sm font-semibold ${
                    foundWords.has(targetWord.trim().toLowerCase())
                      ? 'bg-indigo-100 text-indigo-800 line-through opacity-60'
                      : 'bg-indigo-200 text-indigo-900'
                  }`}
                >
                  {targetWord} (Clue Word)
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
