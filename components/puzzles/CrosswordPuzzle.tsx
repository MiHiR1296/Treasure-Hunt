'use client';

import { useState } from 'react';
import Image from 'next/image';

interface CrosswordPuzzleProps {
  imageUrl: string;
  answers?: string[];
  onSolved?: () => void;
}

export default function CrosswordPuzzle({ imageUrl, answers = [], onSolved }: CrosswordPuzzleProps) {
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  const [isComplete, setIsComplete] = useState(false);

  const handleAnswerChange = (index: number, value: string) => {
    const newAnswers = { ...userAnswers, [index]: value };
    setUserAnswers(newAnswers);

    // Check if all answers are correct
    if (answers.length > 0) {
      const allCorrect = answers.every((ans, idx) => {
        const userAns = newAnswers[idx]?.trim().toLowerCase() || '';
        return userAns === ans.trim().toLowerCase();
      });
      
      if (allCorrect && Object.keys(newAnswers).length === answers.length) {
        setIsComplete(true);
        if (onSolved) {
          onSolved();
        }
      } else {
        setIsComplete(false);
      }
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="bg-white rounded-lg p-4 border-2 border-gray-200">
        <div className="relative w-full aspect-square max-w-2xl mx-auto">
          <Image
            src={imageUrl}
            alt="Crossword puzzle"
            fill
            className="object-contain"
            unoptimized
          />
        </div>
      </div>

      {answers.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-semibold text-gray-900">Enter your answers:</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {answers.map((answer, index) => (
              <div key={index} className="space-y-1">
                <label className="text-sm font-medium text-gray-700">
                  Answer {index + 1}:
                </label>
                <input
                  type="text"
                  value={userAnswers[index] || ''}
                  onChange={(e) => handleAnswerChange(index, e.target.value)}
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                  placeholder={`Answer ${index + 1}`}
                />
              </div>
            ))}
          </div>
          {isComplete && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-green-800 font-semibold">✓ All answers correct!</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
