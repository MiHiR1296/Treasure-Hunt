'use client';

import { useState } from 'react';
import { PuzzleStep } from './types';
import PuzzleRenderer from './PuzzleRenderer';
import AnswerHandler from './AnswerHandler';

interface PuzzleStepDisplayProps {
  step: PuzzleStep;
  stepNumber: number;
  totalSteps: number;
  onStepComplete: () => void;
}

export default function PuzzleStepDisplay({
  step,
  stepNumber,
  totalSteps,
  onStepComplete,
}: PuzzleStepDisplayProps) {
  const [puzzleSolved, setPuzzleSolved] = useState(false);
  const [answerCorrect, setAnswerCorrect] = useState(false);

  const handlePuzzleSolved = () => {
    setPuzzleSolved(true);
    // If puzzle doesn't require answer (auto-solved), complete step
    if (!step.answer_value) {
      onStepComplete();
    }
  };

  const handleAnswerCorrect = () => {
    setAnswerCorrect(true);
    onStepComplete();
  };

  // Some puzzles auto-complete (like jigsaw), others need answer
  // Only require answer if answer_value is set and not empty
  const needsAnswer = step.answer_value && step.answer_value.trim() !== '';
  const canProceed = puzzleSolved && (!needsAnswer || answerCorrect);

  return (
    <div className="w-full space-y-6">
      {/* Progress indicator */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-indigo-900">
            Step {stepNumber} of {totalSteps}
          </span>
          <span className="text-xs text-indigo-700">
            {Math.round((stepNumber / totalSteps) * 100)}% Complete
          </span>
        </div>
        <div className="w-full bg-indigo-200 rounded-full h-2">
          <div
            className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${(stepNumber / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      {/* Step title and description */}
      {step.title && (
        <div>
          <h3 className="text-xl font-bold text-gray-900">{step.title}</h3>
          {step.description && (
            <p className="text-gray-600 mt-2">{step.description}</p>
          )}
        </div>
      )}

      {/* Puzzle component */}
      <PuzzleRenderer step={step} onSolved={handlePuzzleSolved} />

      {/* Answer handler */}
      {needsAnswer && (
        <div className="space-y-4">
          <div className="border-t pt-4">
            <h4 className="text-lg font-semibold text-gray-900 mb-3">
              {step.answer_type === 'qr_code' ? 'Scan QR Code' : 'Enter Answer'}
            </h4>
            <AnswerHandler step={step} onAnswerCorrect={handleAnswerCorrect} />
          </div>
        </div>
      )}

      {/* Completion message */}
      {canProceed && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-green-800 font-semibold">
            ✓ Step {stepNumber} completed! Proceeding to next step...
          </p>
        </div>
      )}
    </div>
  );
}
