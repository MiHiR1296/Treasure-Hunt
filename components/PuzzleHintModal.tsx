'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useTeam } from '@/lib/context/TeamContext';
import { PuzzleHint, PuzzleStep } from './puzzles/types';
import PuzzleRenderer from './puzzles/PuzzleRenderer';
import { loadPuzzleState, savePuzzleState, createDebouncedSave } from '@/lib/puzzles/puzzleState';

interface PuzzleHintModalProps {
  puzzleHint: PuzzleHint;
  checkpointId: string;
  onClose: () => void;
  onPointsUpdate?: (newPoints: number) => void;
}

export default function PuzzleHintModal({
  puzzleHint,
  checkpointId,
  onClose,
  onPointsUpdate,
}: PuzzleHintModalProps) {
  const { team } = useTeam();
  const [puzzleState, setPuzzleState] = useState<Record<string, any> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCompleted, setIsCompleted] = useState(false);
  const [showCompletionMessage, setShowCompletionMessage] = useState(false);

  // Convert puzzle hint to PuzzleStep format for PuzzleRenderer
  const puzzleStep: PuzzleStep = {
    id: puzzleHint.id,
    checkpoint_id: puzzleHint.checkpoint_id,
    step_order: puzzleHint.hint_slot,
    puzzle_type: puzzleHint.puzzle_type,
    puzzle_config: puzzleHint.puzzle_config,
    puzzle_image_url: puzzleHint.puzzle_image_url,
    answer_type: 'text' as const,
    answer_value: null,
    title: puzzleHint.title,
    description: puzzleHint.description,
    created_at: puzzleHint.created_at,
  };

  // Load saved state on mount
  useEffect(() => {
    if (team) {
      loadSavedState();
    }
  }, [team, puzzleHint.id]);

  const loadSavedState = async () => {
    if (!team) return;

    try {
      setIsLoading(true);
      const savedState = await loadPuzzleState(team.id, puzzleHint.id);
      
      if (savedState) {
        setPuzzleState(savedState);
        setIsCompleted(savedState.completed || false);
      } else {
        // Initialize empty state
        setPuzzleState({ completed: false });
      }
    } catch (error) {
      console.error('Error loading puzzle state:', error);
      setPuzzleState({ completed: false });
    } finally {
      setIsLoading(false);
    }
  };

  // Create debounced save function
  const debouncedSave = useCallback(
    createDebouncedSave(async () => {
      if (!team || !puzzleState) return;
      await savePuzzleState(team.id, puzzleHint.id, checkpointId, puzzleState);
    }, 1500),
    [team, puzzleHint.id, checkpointId, puzzleState]
  );

  // Handle state changes from puzzle
  const handleStateChange = useCallback((newState: Record<string, any>) => {
    setPuzzleState(newState);
    setIsCompleted(newState.completed || false);
    
    // Auto-save state
    debouncedSave();
  }, [debouncedSave]);

  // Handle puzzle completion
  const handlePuzzleSolved = useCallback(async () => {
    if (!team) return;

    const completedState = {
      ...puzzleState,
      completed: true,
    };

    setPuzzleState(completedState);
    setIsCompleted(true);
    setShowCompletionMessage(true);

    // Save completed state
    await savePuzzleState(team.id, puzzleHint.id, checkpointId, completedState);
  }, [team, puzzleHint.id, checkpointId, puzzleState]);

  // Handle close
  const handleClose = useCallback(async () => {
    // Save state one final time before closing
    if (team && puzzleState) {
      await savePuzzleState(team.id, puzzleHint.id, checkpointId, puzzleState);
    }
    onClose();
  }, [team, puzzleHint.id, checkpointId, puzzleState, onClose]);

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <p className="text-gray-600">Loading puzzle...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8 max-w-4xl w-full my-8 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            {puzzleHint.title && (
              <h2 className="text-2xl font-bold text-gray-900">{puzzleHint.title}</h2>
            )}
            {puzzleHint.description && (
              <p className="text-gray-600 mt-1">{puzzleHint.description}</p>
            )}
            {!puzzleHint.title && !puzzleHint.description && (
              <h2 className="text-2xl font-bold text-gray-900">Puzzle Hint</h2>
            )}
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 text-2xl font-bold"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Completion Message */}
        {showCompletionMessage && isCompleted && (
          <div className="mb-6 bg-green-50 border-2 border-green-200 rounded-lg p-6">
            {puzzleHint.show_custom_message && puzzleHint.completion_message ? (
              <div>
                <p className="text-green-900 font-semibold text-lg mb-4">
                  {puzzleHint.completion_message}
                </p>
                <button
                  onClick={() => {
                    setShowCompletionMessage(false);
                    handleClose();
                  }}
                  className="px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-colors"
                >
                  OK
                </button>
              </div>
            ) : (
              <div>
                <p className="text-green-900 font-semibold text-lg mb-4">
                  ✓ Puzzle completed!
                </p>
                <button
                  onClick={() => {
                    setShowCompletionMessage(false);
                    handleClose();
                  }}
                  className="px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-colors"
                >
                  OK
                </button>
              </div>
            )}
          </div>
        )}

        {/* Puzzle */}
        {!showCompletionMessage && (
          <div className="space-y-4">
            <PuzzleRenderer
              step={puzzleStep}
              onSolved={handlePuzzleSolved}
              initialState={puzzleState || undefined}
              onStateChange={handleStateChange}
            />
          </div>
        )}

        {/* Footer */}
        {!showCompletionMessage && (
          <div className="mt-6 pt-4 border-t border-gray-200">
            <p className="text-sm text-gray-500 text-center">
              Your progress is automatically saved. You can close this and return later.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
