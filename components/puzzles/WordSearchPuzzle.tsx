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

interface HighlightedWord {
  word: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  direction: 'horizontal' | 'vertical' | 'diagonal';
  isValid: boolean;
}

export default function WordSearchPuzzle({
  imageUrl,
  words = [],
  targetWord,
  showWordsList = false,
  onWordFound,
  onAllWordsFound,
}: WordSearchPuzzleProps) {
  const [foundWords, setFoundWords] = useState<Set<string>>(new Set());
  const [selectedWord, setSelectedWord] = useState<string>('');
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<{ x: number; y: number }[]>([]);
  const [highlightedWords, setHighlightedWords] = useState<HighlightedWord[]>([]);
  const [pendingHighlight, setPendingHighlight] = useState<HighlightedWord | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
      drawHighlights();
    };
    img.src = imageUrl;
  }, [imageUrl, highlightedWords]);

  // Draw highlights on canvas
  const drawHighlights = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw all highlighted words
    highlightedWords.forEach((highlight) => {
      if (highlight.isValid) {
        ctx.strokeStyle = '#10b981'; // Green for valid
        ctx.fillStyle = 'rgba(16, 185, 129, 0.2)'; // Light green fill
      } else {
        ctx.strokeStyle = '#ef4444'; // Red for invalid
        ctx.fillStyle = 'rgba(239, 68, 68, 0.2)'; // Light red fill
      }
      
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Draw highlight based on direction
      const dx = highlight.endX - highlight.startX;
      const dy = highlight.endY - highlight.startY;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      // Draw filled rectangle for the word
      ctx.beginPath();
      if (highlight.direction === 'horizontal') {
        ctx.rect(highlight.startX, highlight.startY - 15, length, 30);
      } else if (highlight.direction === 'vertical') {
        ctx.rect(highlight.startX - 15, highlight.startY, 30, length);
      } else {
        // Diagonal - draw a thicker line
        ctx.moveTo(highlight.startX, highlight.startY);
        ctx.lineTo(highlight.endX, highlight.endY);
        ctx.lineWidth = 8;
      }
      
      if (highlight.direction === 'horizontal' || highlight.direction === 'vertical') {
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.stroke();
      }
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

    // Draw pending highlight (word being validated)
    if (pendingHighlight) {
      ctx.strokeStyle = '#f59e0b'; // Orange for pending
      ctx.fillStyle = 'rgba(245, 158, 11, 0.2)';
      ctx.lineWidth = 4;
      
      const dx = pendingHighlight.endX - pendingHighlight.startX;
      const dy = pendingHighlight.endY - pendingHighlight.startY;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      ctx.beginPath();
      if (pendingHighlight.direction === 'horizontal') {
        ctx.rect(pendingHighlight.startX, pendingHighlight.startY - 15, length, 30);
      } else if (pendingHighlight.direction === 'vertical') {
        ctx.rect(pendingHighlight.startX - 15, pendingHighlight.startY, 30, length);
      } else {
        ctx.moveTo(pendingHighlight.startX, pendingHighlight.startY);
        ctx.lineTo(pendingHighlight.endX, pendingHighlight.endY);
        ctx.lineWidth = 8;
      }
      
      if (pendingHighlight.direction === 'horizontal' || pendingHighlight.direction === 'vertical') {
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.stroke();
      }
    }
  };

  useEffect(() => {
    drawHighlights();
  }, [highlightedWords, currentPath, isDrawing, pendingHighlight]);

  const getCanvasCoordinates = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas || !imageContainerRef.current) return null;

    const rect = imageContainerRef.current.getBoundingClientRect();
    let clientX: number, clientY: number;

    if ('touches' in e) {
      if (e.touches.length === 0) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const detectWordDirection = (path: { x: number; y: number }[]): 'horizontal' | 'vertical' | 'diagonal' | null => {
    if (path.length < 2) return null;

    const start = path[0];
    const end = path[path.length - 1];
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);

    // Determine direction based on dominant axis
    if (dx > dy * 2) return 'horizontal';
    if (dy > dx * 2) return 'vertical';
    if (dx > 0 && dy > 0) return 'diagonal';
    return null;
  };

  const handleStart = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    const coords = getCanvasCoordinates(e);
    if (coords) {
      setIsDrawing(true);
      setCurrentPath([coords]);
      setPendingHighlight(null);
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
    if (!isDrawing || currentPath.length < 10) {
      setIsDrawing(false);
      setCurrentPath([]);
      return;
    }

    // Detect direction and create highlight
    const direction = detectWordDirection(currentPath);
    if (!direction) {
      setIsDrawing(false);
      setCurrentPath([]);
      return;
    }

    const start = currentPath[0];
    const end = currentPath[currentPath.length - 1];

    const highlight: HighlightedWord = {
      word: '', // Will be validated
      startX: start.x,
      startY: start.y,
      endX: end.x,
      endY: end.y,
      direction,
      isValid: false,
    };

    setPendingHighlight(highlight);
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

        // Validate pending highlight
        if (pendingHighlight) {
          setHighlightedWords((prev) => [
            ...prev,
            { ...pendingHighlight, word: normalizedWord, isValid: true }
          ]);
          setPendingHighlight(null);
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
    } else {
      // Wrong word - remove pending highlight
      if (pendingHighlight) {
        // Show red highlight briefly, then remove
        setHighlightedWords((prev) => [
          ...prev,
          { ...pendingHighlight, word: word, isValid: false }
        ]);
        setTimeout(() => {
          setHighlightedWords((prev) => prev.filter(h => h !== pendingHighlight));
        }, 1000);
        setPendingHighlight(null);
      }
    }
    setSelectedWord('');
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
          Draw over words to select them. Type the word you found to validate.
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
                }
              }}
              className="flex-1 px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
              placeholder="Enter word you marked..."
            />
            <button
              onClick={() => handleWordSelect(selectedWord)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Validate
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
