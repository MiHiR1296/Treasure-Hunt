'use client';

import { useState } from 'react';
import { AnswerType, PuzzleStep } from './types';
import TextAnswerInput from './TextAnswerInput';
import PuzzleQRScanner from './PuzzleQRScanner';

interface AnswerHandlerProps {
  step: PuzzleStep;
  onAnswerCorrect: () => void;
}

export default function AnswerHandler({ step, onAnswerCorrect }: AnswerHandlerProps) {
  const [error, setError] = useState('');

  const handleAnswerSubmit = (answer: string) => {
    // Validate answer
    const expectedAnswer = step.answer_value?.trim().toLowerCase() || '';
    const submittedAnswer = answer.trim().toLowerCase();

    if (!expectedAnswer) {
      // No answer required, proceed
      onAnswerCorrect();
      return;
    }

    if (submittedAnswer === expectedAnswer) {
      setError('');
      onAnswerCorrect();
    } else {
      setError('Incorrect answer. Please try again.');
    }
  };

  if (step.answer_type === 'qr_code') {
    return (
      <PuzzleQRScanner
        onAnswerSubmit={handleAnswerSubmit}
        expectedValue={step.answer_value || undefined}
      />
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      <TextAnswerInput
        onAnswerSubmit={handleAnswerSubmit}
        placeholder="Enter the answer to proceed..."
      />
    </div>
  );
}
