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
    // If puzzle doesn't require answer (auto-solved), show success message first
    // Don't auto-complete - let user see the success and proceed manually
    if (!step.answer_value) {
      // Show success message, user can proceed when ready
      // The completion message below will handle the UI feedback
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
        <div className="mb-4">
          <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">{step.title}</h3>
          {step.description && (
            <p className="text-base md:text-lg text-gray-700 mt-2 leading-relaxed">{step.description}</p>
          )}
        </div>
      )}

      {/* Puzzle component */}
      <PuzzleRenderer step={step} onSolved={handlePuzzleSolved} />

      {/* Answer handler */}
      {needsAnswer && (
        <div className="space-y-4">
          <div className="border-t-2 border-gray-300 pt-6">
            <h4 className="text-xl md:text-2xl font-bold text-gray-900 mb-4">
              {step.answer_type === 'qr_code' ? 'Scan QR Code' : 'Enter Answer'}
            </h4>
            <AnswerHandler step={step} onAnswerCorrect={handleAnswerCorrect} />
          </div>
        </div>
      )}

      {/* Completion message and proceed button */}
      {canProceed && (
        <div className="bg-green-50 border-2 border-green-300 rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="text-3xl">🎉</div>
            <div>
              <p className="text-green-900 font-bold text-lg">
                ✓ Step {stepNumber} completed!
              </p>
              {stepNumber < totalSteps ? (
                <p className="text-green-700 text-sm mt-1">
                  Great job! Click below to proceed to the next step.
                </p>
              ) : (
                <p className="text-green-700 text-sm mt-1">
                  All steps completed! Click below to finish this checkpoint.
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onStepComplete}
            className="w-full bg-green-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-green-700 transition-colors text-base"
          >
            {stepNumber < totalSteps ? 'Continue to Next Step →' : 'Complete Checkpoint ✓'}
          </button>
        </div>
      )}
    </div>
  );
}
