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
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAnswerSubmit = (answer: string) => {
    // Prevent duplicate submissions
    if (isSubmitted || isSubmitting) {
      setError('Answer already submitted for this puzzle. Now answer the checkpoint question to unlock the next checkpoint.');
      return;
    }

    // Validate answer
    const expectedAnswer = step.answer_value?.trim().toLowerCase() || '';
    const submittedAnswer = answer.trim().toLowerCase();

    if (!expectedAnswer) {
      // No answer required, proceed
      setIsSubmitting(true);
      setIsSubmitted(true);
      onAnswerCorrect();
      return;
    }

    if (submittedAnswer === expectedAnswer) {
      setError('');
      setIsSubmitting(true);
      setIsSubmitted(true);
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
        <div className={`px-4 py-3 rounded-lg ${
          isSubmitted 
            ? 'bg-blue-50 border border-blue-200 text-blue-700' 
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {error}
        </div>
      )}
      {isSubmitted && !error && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
          ✓ Puzzle answer is correct! Now move on to the checkpoint question.
        </div>
      )}
      {!isSubmitted && (
        <TextAnswerInput
          onAnswerSubmit={handleAnswerSubmit}
          placeholder="Enter the answer to proceed..."
        />
      )}
    </div>
  );
}
