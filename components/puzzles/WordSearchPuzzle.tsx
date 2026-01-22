'use client';

import { useState, useRef, useEffect } from 'react';
import Image from 'next/image';

interface WordSearchPuzzleProps {
  imageUrl: string;
  words?: string[];
  targetWord?: string;
  onWordFound?: (word: string) => void;
  onAllWordsFound?: () => void;
}

export default function WordSearchPuzzle({
  imageUrl,
  words = [],
  targetWord,
  onWordFound,
  onAllWordsFound,
}: WordSearchPuzzleProps) {
  const [foundWords, setFoundWords] = useState<Set<string>>(new Set());
  const [selectedWord, setSelectedWord] = useState<string>('');
  const imageRef = useRef<HTMLDivElement>(null);

  const handleWordSelect = (word: string) => {
    const normalizedWord = word.trim().toLowerCase();
    const normalizedWords = words.map(w => w.trim().toLowerCase());
    const normalizedTarget = targetWord?.trim().toLowerCase();

    if (normalizedWords.includes(normalizedWord) || normalizedWord === normalizedTarget) {
      if (!foundWords.has(normalizedWord)) {
        const newFound = new Set(foundWords);
        newFound.add(normalizedWord);
        setFoundWords(newFound);

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
      <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
        <div className="relative w-full aspect-square max-w-2xl mx-auto">
          <Image
            src={imageUrl}
            alt="Word search puzzle"
            fill
            className="object-contain"
            unoptimized
          />
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Type the word you found:
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
              placeholder="Enter word..."
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

        {(words.length > 0 || targetWord) && (
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
